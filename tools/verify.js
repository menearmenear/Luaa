/* Verify every lesson snippet in src/body.html runs in the sandbox.
   Mirrors the real engine: fresh state per snippet, task.spawn resumes
   the new thread inline (like _spawn in engine.js), pumps yields, and
   fires RunService.Heartbeat each pump. Paths are repo-relative:
   run from repo root or anywhere via  node tools/verify.js */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const src = path.join(root, "src");

global.window = global;
const f = require(path.join(src, "fengari-web.min.js"));
const prelude = fs.readFileSync(path.join(src, "prelude.lua"), "utf8");
const body = fs.readFileSync(path.join(src, "body.html"), "utf8");
const lua = f.lua, laux = f.lauxlib;

const re = /<textarea class="code"[^>]*>([\s\S]*?)<\/textarea>/g;
const snippets = [];
let m;
while ((m = re.exec(body)) !== null) snippets.push(m[1]);
console.log("found", snippets.length, "snippets");

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
    const argCount = fnAt - 1;
    const res = lua.lua_resume(thread, L, argCount);
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

function fireHeartbeat(state) {
  lua.lua_getglobal(state.L, "_heartbeatCallback");
  if (lua.lua_type(state.L, -1) === lua.LUA_TFUNCTION) {
    lua.lua_pushnumber(state.L, 0.03);
    const rc = lua.lua_pcallk(state.L, 1, 0, 0, 0, undefined);
    if (rc !== 0) {
      const m = lua.lua_tojsstring(state.L, -1);
      lua.lua_settop(state.L, 0);
      return m;
    }
  }
  lua.lua_settop(state.L, 0);
  return null;
}

function runSnippet(snippet) {
  const state = makeState();
  const { L, out, pending } = state;
  const r = laux.luaL_loadbuffer(L, f.to_luastring(snippet), snippet.length, "=lesson");
  if (r !== 0) return { ok: false, err: "COMPILE: " + lua.lua_tojsstring(L, -1), out: out.join("") };

  const thread = lua.lua_newthread(L);
  lua.lua_pushvalue(L, 1);
  lua.lua_xmove(L, thread, 1);

  let mainFinished = false;
  let res = lua.lua_resume(thread, L, 0);
  if (res === lua.LUA_YIELD) pending.push(thread);
  else if (res !== 0) return { ok: false, err: "RUN: " + lua.lua_tojsstring(thread, -1), out: out.join("") };
  else mainFinished = true;

  let guard = 0;
  while (guard < 60000) {
    guard++;
    const hbErr = fireHeartbeat(state);
    if (hbErr) return { ok: false, err: "HEARTBEAT: " + hbErr, out: out.join("") };
    if (state.err) return { ok: false, err: "SPAWN: " + state.err, out: out.join("") };
    if (!pending.length) break;
    const t = pending.shift();
    const r2 = lua.lua_resume(t, L, 0);
    if (r2 === lua.LUA_YIELD) pending.push(t);
    else if (r2 !== 0) return { ok: false, err: "RUN: " + lua.lua_tojsstring(t, -1), out: out.join("") };
    else if (t === thread) mainFinished = true;
  }
  if (!mainFinished) return { ok: false, err: "RUN: did not finish", out: out.join("") };
  return { ok: true, err: "", out: out.join("") };
}

let fails = 0;
snippets.forEach((snp, i) => {
  const res = runSnippet(snp);
  if (!res.ok) {
    fails++;
    console.log(`\n--- snippet ${i + 1} FAILED (${res.err}) ---`);
    console.log(snp.split("\n").slice(0, 6).join("\n"));
    console.log("output so far:", res.out.slice(0, 300));
  } else {
    console.log(`snippet ${i + 1} ok — ${res.out.split("\n").length} drops`);
  }
});
console.log(fails === 0 ? "\nALL OK" : `\n${fails} FAILURES`);