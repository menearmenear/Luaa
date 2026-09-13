/* ============================================================
   Lua Playground engine — fengari + sandbox Roblox environment
   + SandboxSim visual mini-game renderer
   (app.js is generated: assembly replaces __PRELUDE_JSON__)
   ============================================================ */
(function () {
"use strict";

/* ---------- tiny helpers ---------- */
function $(id) { return document.getElementById(id); }
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function now() { return (window.performance && window.performance.now) ? window.performance.now() : Date.now(); }
function round2(n) { return Math.round(n * 100) / 100; }

/* ---------- the sandbox prelude (injected at build time) ---------- */
var PRELUDE = __PRELUDE_JSON__;

/* ============================================================
   1. RUNNER (fengari + coroutine scheduler)
   One fresh Lua state per run. The console keeps ONE state so
   your variables survive between lines, but we drop leftover
   coroutines before every line so stale output never bleeds in.
   ============================================================ */
var F = window.fengari;
var lua = F.lua, laux = F.lauxlib;

var ctxByState = new Map();   // lua main state -> run context
var activeCtx = null;         // context whose Lua is currently executing
var pending = [];             // {ref, TL, due, st}
var pumpTimer = null;
var simTimer = null;
var consoleState = null;
var runStart = 0;

function watchdog(L2) {
  if (now() - runStart > 3000) {
    laux.luaL_error(L2, "killed: script ran too long (no task.wait() in the loop?)");
  }
}

function setHook(TL) {
  try { lua.lua_sethook(TL, watchdog, lua.LUA_MASKCOUNT, 200000); } catch (e) {}
}

function feedOutput(s) {
  if (!activeCtx || !activeCtx.out) return;
  var out = activeCtx.out;
  out.classList.add("show");
  out.textContent += s;
  out.scrollTop = out.scrollHeight;
}

function luaErrStr(L2, idx) {
  try {
    var s = lua.lua_tojsstring(L2, idx);
    if (s !== null && s !== undefined) return String(s);
  } catch (e) {}
  return "unknown lua error";
}

function releaseRef(st, ref) {
  if (!ref || !st) return;
  try { laux.luaL_unref(st, lua.LUA_REGISTRYINDEX, ref); } catch (e) {}
}

function pendingFor(st) {
  for (var i = 0; i < pending.length; i++) if (pending[i].st === st) return true;
  return false;
}

function startPump() { if (!pumpTimer) pumpTimer = setInterval(tickAll, 30); }
function stopPump() { if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = null; } }
function startSims() { if (!simTimer) simTimer = setInterval(simTick, 66); }
function stopSims() { if (simTimer) { clearInterval(simTimer); simTimer = null; } }

function resumeRef(ref, TL, nargs, st, finishCb) {
  var ctx = ctxByState.get(st);
  activeCtx = ctx;
  runStart = now();
  setHook(TL);
  var res;
  try {
    res = lua.lua_resume(TL, st, nargs);
  } catch (e) {
    res = lua.LUA_ERRRUN;
    lua.lua_pushliteral(TL, "JS engine error: " + ((e && e.message) || String(e)));
  }
  if (res === lua.LUA_YIELD) {
    var seconds = 0.01;
    var top = lua.lua_gettop(TL);
    if (top > 0) {
      var v = lua.lua_tonumber(TL, top);
      if (typeof v === "number") seconds = v > 0 ? v : 0.01;
    }
    lua.lua_settop(TL, 0);
    pending.push({ ref: ref, TL: TL, due: now() + seconds * 1000, st: st });
    startPump();
    startSims();
  } else if (res === 0) {
    lua.lua_settop(TL, 0);
    releaseRef(st, ref);
    if (finishCb) finishCb();
  } else {
    var msg = luaErrStr(TL, -1);
    lua.lua_settop(TL, 0);
    releaseRef(st, ref);
    if (activeCtx && activeCtx.out) {
      activeCtx.out.classList.add("err");
      activeCtx.out.textContent += "!! " + msg + "\n";
      activeCtx.out.scrollTop = activeCtx.out.scrollHeight;
    }
    if (finishCb) finishCb();
  }
  activeCtx = null;
}

function tickAll() {
  var t = now();
  var due = [];
  for (var i = pending.length - 1; i >= 0; i--) {
    if (pending[i].due <= t) { due.push(pending[i]); pending.splice(i, 1); }
  }
  if (!pending.length) stopPump();
  for (var k = 0; k < due.length; k++) {
    var job = due[k];
    resumeRef(job.ref, job.TL, 0, job.st, null);
  }
}

function releaseAllForState(st) {
  for (var i = pending.length - 1; i >= 0; i--) {
    if (pending[i].st === st) {
      releaseRef(st, pending[i].ref);
      pending.splice(i, 1);
    }
  }
  if (!pending.length) stopPump();
}

function killAllRuns() {
  ctxByState.forEach(function (ctx, L) {
    releaseAllForState(L);
    if (ctx.gview) { ctx.gview.style.display = "none"; ctx.gviewShown = false; }
  });
  ctxByState.clear();
  stopPump();
  stopSims();
}

/* create a fresh sandbox state, loading the prelude inside */
function newState(ctx) {
  var L = laux.luaL_newstate();
  F.lualib.luaL_openlibs(L);

  lua.lua_pushcfunction(L, function (L2) {
    var n = lua.lua_gettop(L2), parts = [];
    for (var i = 1; i <= n; i++) {
      var s = lua.lua_tojsstring(L2, i);
      if (s !== null && s !== undefined) parts.push(s);
    }
    feedOutput(parts.join(""));
    return 0;
  });
  lua.lua_setglobal(L, "_iotab");

  lua.lua_pushcfunction(L, function (L2) {
    /* stack: [fn, args...] -> create + load thread with fn+args */
    var fnAt = lua.lua_gettop(L2);
    var thread = lua.lua_newthread(L2);          // [fn, args..., thread]
    var threadIdx = fnAt + 1;
    lua.lua_pushvalue(L2, 1);
    lua.lua_xmove(L2, thread, 1);
    for (var i = 2; i <= fnAt; i++) {
      lua.lua_pushvalue(L2, i);
      lua.lua_xmove(L2, thread, 1);
    }
    var argCount = fnAt - 1;
    var ref = laux.luaL_ref(L2, lua.LUA_REGISTRYINDEX, threadIdx);
    resumeRef(ref, thread, argCount, activeCtx.L, null);
    lua.lua_pushinteger(L2, 0);
    return 1;
  });
  lua.lua_setglobal(L, "_spawn");

  var r = laux.luaL_loadbuffer(L, F.to_luastring(PRELUDE), PRELUDE.length, "=prelude");
  if (r !== 0) {
    throw new Error("prelude failed to load: " + luaErrStr(L, -1));
  }
  activeCtx = ctx;
  var st = lua.lua_pcallk(L, 0, 0, 0, 0, undefined);
  activeCtx = null;
  if (st !== 0) {
    throw new Error("prelude failed to run: " + luaErrStr(L, -1));
  }
  return L;
}

/* run arbitrary Lua code on an already-registered state */
function runChunkOnState(L, code, outEl, statusEl, keepOutput) {
  var ctx = ctxByState.get(L);
  if (!ctx) { ctx = { L: L }; ctxByState.set(L, ctx); }
  ctx.out = outEl;
  ctx.statusEl = statusEl || null;
  ctx.keep = !!keepOutput;
  if (!keepOutput) {
    ensureGview(ctx);
    outEl.classList.remove("err");
    outEl.classList.add("show");
    outEl.textContent = "";
  }
  var t0 = now();
  var r = laux.luaL_loadbuffer(L, F.to_luastring(code), code.length, "=lesson");
  if (r !== 0) {
    var err = luaErrStr(L, -1);
    lua.lua_settop(L, 0);
    outEl.classList.add("err");
    outEl.classList.add("show");
    outEl.textContent += "!! " + err + "\n";
    outEl.scrollTop = outEl.scrollHeight;
    if (statusEl) { statusEl.textContent = "error"; statusEl.classList.add("show"); statusEl.style.color = "#f87171"; }
    return;
  }
  var thread = lua.lua_newthread(L);
  lua.lua_pushvalue(L, 1);
  lua.lua_xmove(L, thread, 1);
  var ref = laux.luaL_ref(L, lua.LUA_REGISTRYINDEX, 2);
  lua.lua_settop(L, 0); // drop the loaded chunk so the next runChunk / console line can't re-run it
  if (statusEl) {
    statusEl.classList.add("show");
    statusEl.textContent = "running…";
    statusEl.style.color = "#fbbf24";
  }
  resumeRef(ref, thread, 0, L, function () {
    if (statusEl) {
      statusEl.textContent = "finished in " + Math.max(0, Math.round(now() - t0)) + "ms";
      statusEl.style.color = "#22c55e";
    }
  });
}

/* public: run a lesson box (fresh sandbox, kills everything else) */
function runChunk(code, outEl, statusEl, keepOutput) {
  killAllRuns();
  var ctx = { L: null, out: outEl, statusEl: statusEl || null, keep: !!keepOutput };
  var L;
  try {
    L = newState(ctx);
  } catch (e) {
    outEl.classList.add("err");
    outEl.classList.add("show");
    outEl.textContent = "!! boot failed: " + (e && e.message) + "\n";
    if (statusEl) { statusEl.textContent = "error"; statusEl.classList.add("show"); }
    return;
  }
  ctx.L = L;
  ctxByState.set(L, ctx);
  runChunkOnState(L, code, outEl, statusEl, keepOutput);
}

/* public: console line (persistent console state, stale threads dropped) */
function runConsole(code) {
  killAllRuns();
  if (!consoleState) {
    var ctx = { L: null, out: $("console-screen"), keep: true };
    try { consoleState = newState(ctx); ctx.L = consoleState; }
    catch (e) { $("console-screen").textContent = "boot failed: " + (e && e.message); return; }
    ctxByState.set(consoleState, ctx);
  } else {
    releaseAllForState(consoleState);
    ctxByState.set(consoleState, { L: consoleState, out: $("console-screen"), keep: true });
  }
  runChunkOnState(consoleState, code, $("console-screen"), null, true);
}

/* ============================================================
   2. SandboxSim: render the Lua world to a canvas + clickable HUD
   ============================================================ */
function ensureGview(ctx) {
  if (ctx.gview) return ctx.gview;
  var out = ctx.out;
  if (!out || !out.parentElement) return null;

  var wrap = document.createElement("div");
  wrap.className = "gview";
  wrap.style.display = "none";
  var cv = document.createElement("canvas");
  cv.width = 480; cv.height = 300;
  var hud = document.createElement("div");
  hud.className = "ghud";
  wrap.appendChild(cv);
  wrap.appendChild(hud);

  cv.addEventListener("click", function (e) {
    ctx.touched = true;
    var r = cv.getBoundingClientRect();
    var px = e.clientX - r.left, py = e.clientY - r.top;
    var x = (px / r.width) * 480, y = (py / r.height) * 300;
    emitEvent(ctx, "click", round2((x / 480) * 24 - 12), round2((y / 300) * 15 - 7.5));
  });

  out.parentElement.insertBefore(wrap, out);
  ctx.gview = wrap;
  ctx.cv = cv;
  ctx.g2d = cv.getContext("2d");
  ctx.hud = hud;
  ctx.hudEls = {};
  ctx.gviewShown = false;
  ctx.world = null;
  ctx.touched = false;
  return wrap;
}

function pollWorld(ctx) {
  try {
    activeCtx = ctx;
    lua.lua_getglobal(ctx.L, "_frameJSON");
    var rc = lua.lua_pcallk(ctx.L, 0, 1, 0, 0, undefined);
    if (rc !== 0) { lua.lua_settop(ctx.L, 0); return ctx.world || null; }
    var s = lua.lua_tojsstring(ctx.L, -1);
    lua.lua_settop(ctx.L, 0);
    if (!s) return null;
    return JSON.parse(s);
  } catch (e) {
    return ctx.world || null;
  } finally {
    activeCtx = null;
  }
}

function fireHeartbeat(L, dt) {
  activeCtx = ctxByState.get(L);
  runStart = now();
  try {
    lua.lua_getglobal(L, "_heartbeatCallback");
    if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) { lua.lua_settop(L, 0); return; }
    lua.lua_pushnumber(L, dt);
    var rc = lua.lua_pcallk(L, 1, 0, 0, 0, undefined);
    if (rc !== 0) {
      var m = luaErrStr(L, -1);
      if (activeCtx && activeCtx.out) {
        activeCtx.out.classList.add("err");
        activeCtx.out.textContent += "!! " + m + "\n";
        activeCtx.out.scrollTop = activeCtx.out.scrollHeight;
      }
    }
    lua.lua_settop(L, 0);
  } catch (e) {
    try { lua.lua_settop(L, 0); } catch (e2) {}
  } finally {
    activeCtx = null;
  }
}

function emitEvent(ctx, type, a, b) {
  try {
    activeCtx = ctx;
    lua.lua_getglobal(ctx.L, "_dispatchEvent");
    lua.lua_pushliteral(ctx.L, type);
    if (typeof a === "number") lua.lua_pushnumber(ctx.L, a); else lua.lua_pushliteral(ctx.L, String(a == null ? "" : a));
    if (typeof b === "number") lua.lua_pushnumber(ctx.L, b); else lua.lua_pushliteral(ctx.L, String(b == null ? "" : b));
    var rc = lua.lua_pcallk(ctx.L, 3, 0, 0, 0, undefined);
    if (rc !== 0) {
      var m = luaErrStr(ctx.L, -1);
      lua.lua_settop(ctx.L, 0);
      if (ctx.out) { ctx.out.classList.add("err"); ctx.out.textContent += "!! " + m + "\n"; ctx.out.scrollTop = ctx.out.scrollHeight; }
    } else {
      lua.lua_settop(ctx.L, 0);
    }
  } catch (e) {
    try { lua.lua_settop(ctx.L, 0); } catch (e2) {}
  } finally {
    activeCtx = null;
  }
}

var lastSimTs = now();

function simTick() {
  var t = now();
  var dt = Math.min(0.1, (t - lastSimTs) / 1000);
  lastSimTs = t;
  var any = false;

  ctxByState.forEach(function (ctx, L) {
    if (!ctx.gview) return;
    var live = pendingFor(L);
    var show = ctx.world && ctx.world.visible;
    if (!live && !show) return;
    any = true;
    if (live) fireHeartbeat(L, dt);
    var world = pollWorld(ctx);
    if (world) renderWorld(ctx, world);
  });

  if (!any) stopSims();
}

function renderWorld(ctx, world) {
  var gv = ctx.gview;
  if (!gv) return;
  gv.style.display = "block";
  ctx.gviewShown = true;
  ctx.world = world;

  var W = 480, H = 300, g = ctx.g2d;
  function px(wx) { return ((wx + 12) / 24) * W; }
  function py(wz) { return ((wz + 7.5) / 15) * H; }

  g.fillStyle = "#0f1410";
  g.fillRect(0, 0, W, H);

  g.lineWidth = 1;
  for (var i = -12; i <= 12; i++) {
    g.strokeStyle = (i % 4 === 0) ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)";
    g.beginPath(); g.moveTo(px(i) + 0.5, 0); g.lineTo(px(i) + 0.5, H); g.stroke();
  }
  for (var j = -7; j <= 7; j++) {
    g.strokeStyle = "rgba(255,255,255,0.05)";
    g.beginPath(); g.moveTo(0, py(j) + 0.5); g.lineTo(W, py(j) + 0.5); g.stroke();
  }
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.strokeRect(0.5, 0.5, W - 1, H - 1);

  var coins = world.coins || [];
  g.fillStyle = "#ffd54f";
  for (var c = 0; c < coins.length; c++) {
    var cx = px(coins[c].x), cy = py(coins[c].z);
    g.beginPath();
    g.moveTo(cx, cy - 5); g.lineTo(cx + 4, cy); g.lineTo(cx, cy + 5); g.lineTo(cx - 4, cy);
    g.closePath(); g.fill();
  }

  var mobs = world.mobs || [];
  for (var m = 0; m < mobs.length; m++) {
    var mob = mobs[m], mx = px(mob.x), my = py(mob.z);
    g.fillStyle = mob.color || "#e57373";
    g.beginPath(); g.arc(mx, my, 11, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = 2; g.stroke();
    var bw = 22, bh = 3;
    g.fillStyle = "#23232c"; g.fillRect(mx - bw / 2, my - 20, bw, bh);
    var frac = Math.max(0, Math.min(1, (mob.hp || 0) / (mob.maxhp || 1)));
    g.fillStyle = frac > 0.35 ? "#4ade80" : "#f87171";
    g.fillRect(mx - bw / 2, my - 20, bw * frac, bh);
  }

  var p = world.player || {};
  var pw = px(p.x || 0), ph = py(p.z || 0);
  g.fillStyle = p.color || "#4fc3f7";
  g.beginPath(); g.arc(pw, ph, 12, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#ffffff"; g.lineWidth = 2; g.stroke();
  var rad = (p.angle || 0) * Math.PI / 180;
  var vx = Math.sin(rad), vz = -Math.cos(rad);
  g.strokeStyle = "#ffffff"; g.lineWidth = 3;
  g.beginPath(); g.moveTo(pw, ph); g.lineTo(pw + vx * 15, ph + vz * 15); g.stroke();
  g.fillStyle = "#ffffff"; g.font = "bold 11px sans-serif"; g.textAlign = "center";
  g.fillText(p.name || "You", pw, ph - 20);
  var fw = 26, fh = 3;
  g.fillStyle = "#23232c"; g.fillRect(pw - fw / 2, ph + 16, fw, fh);
  var pf = Math.max(0, Math.min(1, (p.hp || 0) / (p.maxhp || 1)));
  g.fillStyle = pf < 0.35 ? "#f87171" : "#4ade80";
  g.fillRect(pw - fw / 2, ph + 16, fw * pf, fh);

  if (!ctx.touched) {
    g.fillStyle = "rgba(255,255,255,0.4)";
    g.font = "12px sans-serif";
    g.fillText("click canvas to walk · click a red mob to fight", W / 2, 16);
  }

  var gui = world.gui || {};
  var seen = {};
  for (var id in gui) {
    seen[id] = true;
    var w = gui[id];
    var d = ctx.hudEls[id];
    if (!d) {
      d = document.createElement("div");
      d.className = "gbtn";
      ctx.hud.appendChild(d);
      ctx.hudEls[id] = d;
      (function (did) {
        d.addEventListener("click", function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          emitEvent(ctx, "gui", String(did), "");
        });
      })(id);
    }
    if (w.hide) { d.style.display = "none"; continue; }
    d.style.display = "flex";
    d.style.left = (w.x * 100) + "%";
    d.style.top = (w.y * 100) + "%";
    d.style.width = (w.w * 100) + "%";
    d.style.height = (w.h * 100) + "%";
    d.style.background = w.color || "rgba(38,50,96,0.92)";
    d.style.color = w.textColor || "#ffffff";
    d.style.fontSize = Math.max(10, Math.min(14, w.h * 100 * 0.34)) + "px";
    d.innerHTML = esc(w.text == null ? id : w.text).replace(/\n/g, "<br>");
  }
  for (var hid in ctx.hudEls) {
    if (!seen[hid]) { try { ctx.hud.removeChild(ctx.hudEls[hid]); } catch (e) {} delete ctx.hudEls[hid]; }
  }
}

/* ============================================================
   3. SYNTAX HIGHLIGHTER
   ============================================================ */
var KEYWORDS = ["and","break","do","else","elseif","end","false","for","function","goto","if","in","local","nil","not","or","repeat","return","then","true","until","while"];
var GLOBALS = ["print","wait","spawn","delay","task","game","workspace","Players","ReplicatedStorage","RunService","HttpService","Lighting","Instance","newSignal","Vector3","Color3","CFrame","UDim2","UDim","SandboxSim","loadstring","getgenv","getexecutorname","identifyexecutor","getfpscap","setfpscap","getrawmetatable","hookmetamethod","hookfunction","clonefunction","newcclosure","iscclosure","checkcaller","printidentity","getnamecallmethod","setreadonly","isreadonly","setclipboard","getgc","getreg","getupvalues","getconstants","StarterGui","Debris","TweenService","TextChatService","_G","pairs","ipairs","select","tostring","tonumber","type","next","rawset","rawget","setmetatable","getmetatable","pcall","xpcall","require","coroutine","string","table","math","os","io"];
function highlight(src) {
  var out = [], i = 0, n = src.length;
  function tok(cls, txt) { out.push('<span class="' + cls + '">' + esc(txt) + '</span>'); }
  function plain(txt) { out.push(esc(txt)); }
  while (i < n) {
    var c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      var j = src.indexOf("\n", i); if (j === -1) j = n;
      tok("tk-cm", src.slice(i, j)); i = j; continue;
    }
    if (c === '"' || c === "'") {
      var q = c, j = i + 1;
      while (j < n && src[j] !== q && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      j = Math.min(j + 1, n);
      tok("tk-str", src.slice(i, j)); i = j; continue;
    }
    if (c === "[" && src[i + 1] === "[") {
      var j = src.indexOf("]]", i + 2); j = j === -1 ? n : j + 2;
      tok("tk-str", src.slice(i, Math.min(j, n))); i = Math.min(j, n); continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || "."))) {
      var j = i;
      while (j < n && /[0-9a-fA-FxXeE._]/.test(src[j])) {
        if (c === "." && j > i && src[j] === "." && src[j - 1] === ".") break;
        if (/[.]/.test(src[j]) && j > i && /[.]/.test(src[j - 1]) && j - i > 1) break;
        j++;
      }
      tok("tk-num", src.slice(i, j)); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      var j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      var w = src.slice(i, j);
      if (KEYWORDS.indexOf(w) !== -1) tok("tk-kw", w);
      else if (w === "true" || w === "false" || w === "nil") tok("tk-bool", w);
      else if (GLOBALS.indexOf(w) !== -1) tok("tk-gl", w);
      else tok("tk-fn", w);
      i = j; continue;
    }
    if (/[:.#%/*+\-<>()\[\]{}=,;@?]/.test(c)) {
      var j = i;
      while (j < n && /[:.#%/*+\-<>()\[\]{}=,;@?]/.test(src[j])) j++;
      tok("tk-sym", src.slice(i, j)); i = j; continue;
    }
    var j = i;
    while (j < n && !/[A-Za-z0-9_".`[-]/.test(src[j]) && j - i < 4) j++;
    if (j === i) j = i + 1;
    plain(src.slice(i, j)); i = j;
  }
  return out.join("");
}

function applyHighlight(ta) {
  var hl = ta.parentElement.querySelector(".hl");
  if (!hl) return;
  hl.innerHTML = highlight(ta.value) + "\n";
  hl.scrollLeft = ta.scrollLeft; hl.scrollTop = ta.scrollTop;
}

/* ============================================================
   4. UI BINDINGS
   ============================================================ */
var consoleScreen = null;

function setupPanes() {
  var learnPane = $("pane-learn"), conPane = $("pane-console");
  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () {
      var name = t.getAttribute("data-tab");
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.toggle("on", x === t); });
      learnPane.classList.toggle("on", name === "learn");
      conPane.classList.toggle("on", name === "console");
      if (name === "console") setTimeout(function () { var ta = $("console-in"); if (ta) ta.focus(); }, 60);
    });
  });
  document.querySelectorAll(".chap").forEach(function (ch) {
    ch.addEventListener("click", function () {
      document.querySelectorAll(".chap").forEach(function (c) { c.classList.toggle("on", c === ch); });
      var tid = ch.getAttribute("data-target");
      document.querySelectorAll(".lesson").forEach(function (l) { l.classList.toggle("on", l.id === tid); });
      window.scrollTo({ top: 0, behavior: "smooth" });
      try { localStorage.setItem("luaplay.last", tid); } catch (e) {}
    });
    ch.addEventListener("dblclick", function () { ch.classList.toggle("done"); saveProgress(); });
  });
  try {
    var last = localStorage.getItem("luaplay.last");
    if (last) {
      var c = document.querySelector('.chap[data-target="' + last + '"]');
      if (c) c.click();
    }
  } catch (e) {}
}

function saveProgress() {
  try {
    var d = [];
    document.querySelectorAll(".chap.done").forEach(function (c) { d.push(c.getAttribute("data-target")); });
    localStorage.setItem("luaplay.done", JSON.stringify(d));
  } catch (e) {}
}
function loadProgress() {
  try {
    JSON.parse(localStorage.getItem("luaplay.done") || "[]").forEach(function (id) {
      var c = document.querySelector('.chap[data-target="' + id + '"]');
      if (c) c.classList.add("done");
    });
  } catch (e) {}
}

function legacyCopy(text, done) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
  done(ok);
}

function bindCopy(btn, text) {
  btn.addEventListener("click", function () {
    function done(worked) {
      if (btn._t) clearTimeout(btn._t);
      var old = btn.textContent;
      btn.textContent = worked ? "Copied!" : "Select manually";
      btn._t = setTimeout(function () { btn.textContent = old; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
  });
}

function setupExamples() {
  document.querySelectorAll(".ex").forEach(function (ex) {
    var ta = ex.querySelector("textarea.code");
    var run = ex.querySelector(".run");
    var copy = ex.querySelector(".copy");
    var out = ex.querySelector(".out");
    var status = ex.querySelector(".status");
    if (!ta || !run || !out) return;

    ta.addEventListener("input", function () { applyHighlight(ta); });
    ta.addEventListener("scroll", function () {
      var hl = ta.parentElement.querySelector(".hl");
      if (hl) { hl.scrollLeft = ta.scrollLeft; hl.scrollTop = ta.scrollTop; }
    });

    run.addEventListener("click", function () {
      runChunk(ta.value, out, status, false);
      ex._played = true; saveProgress();
    });
    if (copy) bindCopy(copy, ta.value);
  });
}

var CONSOLE_HINT = "print('hello from the Lua Playground console!')\n\nfor i = 1, 5 do\n  print('tick', i)\n  task.wait(0.4)\nend";

function setupConsole() {
  consoleScreen = $("console-screen");
  var pin = $("console-in"), btn = $("console-run"), clear = $("console-clear"), reset = $("console-reset");

  function runNow() {
    var code = pin.value;
    if (!code.trim()) return;
    consoleScreen.appendChild(el("div", "pw", esc(code.split("\n")[0])));
    runConsole(code);
    pin.value = "";
    pin.focus();
  }
  btn.addEventListener("click", runNow);
  pin.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runNow(); }
  });
  clear.addEventListener("click", function () { consoleScreen.textContent = ""; pin.focus(); });
  reset.addEventListener("click", function () {
    killAllRuns();
    consoleState = null;
    consoleScreen.textContent = "-- fresh sandbox ready.\n";
    pin.focus();
  });

  if ($("console-hint")) $("console-hint").addEventListener("click", function () {
    pin.value = CONSOLE_HINT;
    pin.focus();
  });
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener("DOMContentLoaded", function () {
  setupPanes();
  setupExamples();
  setupConsole();
  loadProgress();
  document.querySelectorAll("textarea.code").forEach(function (ta) { applyHighlight(ta); });
  var first = document.querySelector(".chap");
  if (first) first.classList.add("on");
  var lesson = document.querySelector(".lesson");
  if (lesson) lesson.classList.add("on");
});

/* exposed for testing (and handy in the browser console) */
window.__LP__ = {
  renderWorld: renderWorld,
  pollWorld: pollWorld,
  emitEvent: emitEvent,
  ensureGview: ensureGview,
  highlight: highlight,
};
})();