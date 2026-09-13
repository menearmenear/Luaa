/* Verify scripts/test.lua in the sandbox: inject clicks, pump heartbeats,
   assert the player tweens to the clicked point with precision.
   Run from repo root:  node tools/verify-script.js */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const src = path.join(root, "src");

global.window = global;
const f = require(path.join(src, "fengari-web.min.js"));
const prelude = fs.readFileSync(path.join(src, "prelude.lua"), "utf8");
const script = fs.readFileSync(path.join(root, "scripts", "test.lua"), "utf8");
const lua = f.lua, laux = f.lauxlib;

function makeState() {
  const L = laux.luaL_newstate();
  f.lualib.luaL_openlibs(L);
  const out = [];
  const pending = [];
  const state = { L, out, pending, err: null };
  lua.lua_pushcfunction(L, function (L2) {
    const n = lua.lua_gettop(L2), parts = [];
    for (let i = 1; i <= n; i++) { const s = lua.lua_tojsstring(L2, i); if (s != null) parts.push(s); }
    out.push(parts.join(""));
    return 0;
  });
  lua.lua_setglobal(L, "_iotab");
  lua.lua_pushcfunction(L, function (L2) {
    const fnAt = lua.lua_gettop(L2);
    const thread = lua.lua_newthread(L2);
    lua.lua_pushvalue(L2, 1); lua.lua_xmove(L2, thread, 1);
    for (let i = 2; i <= fnAt; i++) { lua.lua_pushvalue(L2, i); lua.lua_xmove(L2, thread, 1); }
    const res = lua.lua_resume(thread, L, fnAt - 1);
    if (res === lua.LUA_YIELD) pending.push(thread);
    else if (res !== 0) state.err = lua.lua_tojsstring(thread, -1);
    lua.lua_pushinteger(L2, 0);
    return 1;
  });
  lua.lua_setglobal(L, "_spawn");
  const r = laux.luaL_loadbuffer(L, f.to_luastring(prelude), prelude.length, "=prelude");
  if (r !== 0) throw new Error("prelude load: " + lua.lua_tojsstring(L, -1));
  const st = lua.lua_pcallk(L, 0, 0, 0, 0, undefined);
  if (st !== 0) throw new Error("prelude run: " + lua.lua_tojsstring(L, -1));
  return state;
}

function runChunkOnThread(state, code, name) {
  const { L } = state;
  const t = lua.lua_newthread(L);
  const r = laux.luaL_loadbuffer(L, f.to_luastring(code), code.length, "=" + name);
  if (r !== 0) { lua.lua_settop(L, 0); return "COMPILE " + lua.lua_tojsstring(L, -1); }
  lua.lua_xmove(L, t, 1);
  const res = lua.lua_resume(t, L, 0);
  lua.lua_settop(L, 0);
  if (res === lua.LUA_YIELD) state.pending.push(t);
  else if (res !== 0) return "RUN " + lua.lua_tojsstring(t, -1);
  return null;
}

function fireHeartbeat(state, dt) {
  const { L } = state;
  lua.lua_getglobal(L, "_heartbeatCallback");
  if (lua.lua_type(L, -1) === lua.LUA_TFUNCTION) {
    lua.lua_pushnumber(L, dt);
    const rc = lua.lua_pcallk(L, 1, 0, 0, 0, undefined);
    if (rc !== 0) { const m = lua.lua_tojsstring(L, -1); lua.lua_settop(L, 0); state.err = m; return; }
  }
  lua.lua_settop(L, 0);
}

function pump(state, n, dt) {
  for (let i = 0; i < n; i++) {
    fireHeartbeat(state, dt || 0.03);
    while (state.pending.length) {
      const t = state.pending.shift();
      const r2 = lua.lua_resume(t, state.L, 0);
      if (r2 === lua.LUA_YIELD) state.pending.push(t);
    }
  }
  return state.err;
}

function posOf(state) {
  const mark = runChunkOnThread(state, 'local a,b=SandboxSim.getPlayer() _iotab("##POS "..tostring(a).." "..tostring(b))', "pos");
  if (mark) throw new Error(mark);
  const line = state.out.slice().reverse().find((l) => l.includes("##POS "));
  if (!line) return [NaN, NaN];
  const m = line.match(/##POS (-?[\d.e-]+) (-?[\d.e-]+)/);
  return m ? [+m[1], +m[2]] : [NaN, NaN];
}

function allOut(state) { return state.out.join(""); }

function chk(label, cond) {
  console.log((cond ? "  ok  " : "  FAIL") + " " + label);
  return cond;
}

const st = makeState();
const loadErr = runChunkOnThread(st, script, "test.lua");
if (loadErr) { console.log("LOAD FAILED:", loadErr); process.exit(1); }
console.log("script loaded; booting tests...");
console.log(allOut(st).split("\n").filter(Boolean).join("\n"));

let fails = 0;

// 1) click (3,4) from spawn (0,0), pump, expect exact arrival
runChunkOnThread(st, '_dispatchEvent("click", 3, 4)', "click1");
pump(st, 200);
let [x, z] = posOf(st);
fails += chk("click (3,4) -> player at (3,4)", Math.abs(x - 3) < 1e-3 && Math.abs(z - 4) < 1e-3) ? 0 : 1;
fails += chk("printed 'landed' with error 0.000", allOut(st).includes("error 0.000")) ? 0 : 1;

// 2) re-click mid-world to (1,-2) while standing at marker
runChunkOnThread(st, '_dispatchEvent("click", 1, -2)', "click2");
pump(st, 300);
[x, z] = posOf(st);
fails += chk("re-click (1,-2) -> player at (1,-2)", Math.abs(x - 1) < 1e-3 && Math.abs(z + 2) < 1e-3) ? 0 : 1;

// 3) disable via GUI button, click should not move
runChunkOnThread(st, '_dispatchEvent("gui", "ENABLED")', "guiOff");
pump(st, 30);
[x, z] = posOf(st);
runChunkOnThread(st, '_dispatchEvent("click", 0, 0)', "click3");
pump(st, 120);
const [x2, z2] = posOf(st);
fails += chk("disabled: click (0,0) does not move", Math.abs(x2 - x) < 1e-3 && Math.abs(z2 - z) < 1e-3) ? 0 : 1;

// 4) toggle exact -> smooth still lands near target
runChunkOnThread(st, '_dispatchEvent("gui", "ENABLED")', "guiOn");
runChunkOnThread(st, '_dispatchEvent("gui", "EXACT")', "guiExact"); // SMOOTH
pump(st, 20);
runChunkOnThread(st, '_dispatchEvent("click", -5, 5)', "click4");
pump(st, 400);
const [x3, z3] = posOf(st);
fails += chk("smooth mode still lands at (-5,5)", Math.abs(x3 + 5) < 1e-2 && Math.abs(z3 - 5) < 1e-2) ? 0 : 1;

console.log(fails === 0 ? "\nSCRIPT OK" : "\n" + fails + " FAILURES");
process.exit(fails === 0 ? 0 : 1);