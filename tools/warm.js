/* Warm-run any script in the sandbox: load it, pump N simulated seconds
   of Heartbeat, print the full output.
   Usage:  node tools/warm.js scripts/auto_fruit.lua [seconds]
   Exit 1 on any Lua error. */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const src = path.join(root, "src");

global.window = global;
const f = require(path.join(src, "fengari-web.min.js"));
const prelude = fs.readFileSync(path.join(src, "prelude.lua"), "utf8");
const scriptPath = path.join(root, process.argv[2] || "scripts/test.lua");
const seconds = Number(process.argv[3] || 60);
const script = fs.readFileSync(scriptPath, "utf8");
const lua = f.lua, laux = f.lauxlib;

const L = laux.luaL_newstate();
f.lualib.luaL_openlibs(L);
const out = [];
const pending = [];
let err = null;

lua.lua_pushcfunction(L, function (L2) {
  const n = lua.lua_gettop(L2), parts = [];
  for (let i = 1; i <= n; i++) { const s = lua.lua_tojsstring(L2, i); if (s != null) parts.push(String(s)); }
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
  else if (res !== 0) err = lua.lua_tojsstring(thread, -1);
  lua.lua_pushinteger(L2, 0);
  return 1;
});
lua.lua_setglobal(L, "_spawn");

function loadBlock(code, name) {
  const t = lua.lua_newthread(L);
  const r = laux.luaL_loadbuffer(L, f.to_luastring(code), code.length, "=" + name);
  if (r !== 0) { lua.lua_settop(L, 0); return "COMPILE " + lua.lua_tojsstring(L, -1); }
  lua.lua_xmove(L, t, 1);
  const res = lua.lua_resume(t, L, 0);
  lua.lua_settop(L, 0);
  if (res === lua.LUA_YIELD) pending.push(t);
  else if (res !== 0) return "RUN " + lua.lua_tojsstring(t, -1);
  return null;
}

const errp = loadBlock(prelude, "prelude");
if (errp) { console.log("prelude: " + errp); process.exit(1); }

const errs = loadBlock(script, "script");
if (errs) { console.log("script load: " + errs); process.exit(1); }

function fireHeartbeat() {
  lua.lua_getglobal(L, "_heartbeatCallback");
  if (lua.lua_type(L, -1) === lua.LUA_TFUNCTION) {
    lua.lua_pushnumber(L, 0.03);
    const rc = lua.lua_pcallk(L, 1, 0, 0, 0, undefined);
    if (rc !== 0) { err = lua.lua_tojsstring(L, -1); }
  }
  lua.lua_settop(L, 0);
}

const pumps = Math.round(seconds / 0.03);
console.log("warming " + scriptPath + " for " + seconds + "s (" + pumps + " pumps)…");
for (let i = 0; i < pumps; i++) {
  fireHeartbeat();
  const todo = pending.splice(0);
  for (const t of todo) {
    const r2 = lua.lua_resume(t, L, 0);
    if (r2 === lua.LUA_YIELD) pending.push(t);
    else if (r2 !== 0) { err = lua.lua_tojsstring(t, -1); break; }
  }
  if (i % 500 === 0) process.stderr.write("pump " + i + " (pending " + pending.length + ")\n");
  if (err) break;
}

console.log("--- output ---");
console.log(out.slice(2).join(""));
if (err) { console.log("ERROR: " + err); process.exit(1); }
console.log("--- OK: ran " + seconds + "s without errors (" + out.length + " prints) ---");