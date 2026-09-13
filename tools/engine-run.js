/* End-to-end engine integration test on the REAL built page.
   Parses Lua-Playground.html into the stub DOM, evaluates app.js,
   then drives the Run buttons for lesson 16 (Click Tween) and
   lesson 17 (a script from scripts/) and asserts the sim CANVAS
   renders and reacts.
   Usage:  node tools/engine-run.js            (uses built file)
          node tools/engine-run.js --perf      (just lesson-16 tween)
   Exit 1 on any failed assertion. */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const root = path.join(__dirname, "..");
const { parseHTML } = require(path.join(__dirname, "dom.js"));

const html = fs.readFileSync(path.join(root, "Lua-Playground.html"), "utf8");
const scriptAt = html.lastIndexOf("<script>");
const bodyHtml = html.slice(0, scriptAt);
const appJs = html.slice(scriptAt + "<script>".length, html.indexOf("</script>", scriptAt));

const dom = parseHTML(bodyHtml);
const idMap = dom.idMap;
let clock = 0;
const intervals = new Map();
let bootCb = null;

function makeDoc() {
  return {
    body: dom.root,
    getElementById: (id) => idMap[id] || null,
    querySelector: (sel) => {
      const found = descendantsOf(dom.root, sel);
      return found;
    },
    querySelectorAll: (sel) => descendantsAll(dom.root, sel),
    createElement: (tag) => require(path.join(__dirname, "dom.js")).makeEl(tag),
    addEventListener: (ev, cb) => { if (ev === "DOMContentLoaded") bootCb = cb; },
    execCommand: () => false,
  };
}
function descendantsAll(el, sel) {
  const out = [];
  (function walk(e) { out.push(e); for (const c of e.children) walk(c); })(el);
  return out.filter((d) => d.tagName !== "BODY" && matchesSel(d, sel));
}
function descendantsOf(el, sel) {
  const all = descendantsAll(el, sel);
  return all[0] || null;
}
function matchesSel(el, sel) {
  sel = sel.trim();
  const attrM = /^([^\[\]]+)\[([^\]]+)="([^"]+)"\]/.exec(sel);
  const parts = attrM ? attrM[1].split(".") : sel.split(".");
  const tag = parts[0] || null;
  const cls = parts.slice(1).join(" ");
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (cls) { const s = new Set((el.className || "").split(/\s+/)); for (const c of cls.split(/\s+/)) { if (c && !s.has(c)) return false; } }
  if (attrM && el.getAttribute(attrM[2]) !== attrM[3]) return false;
  return true;
}

const scriptDir = path.join(root, "scripts");
const fetchStub = (url) => {
  const u = String(url);
  if (u.indexOf("api/scripts") !== -1) {
    const list = fs.readdirSync(scriptDir).filter((f) => /\.(lua|txt)$/.test(f))
      .map((f) => ({ name: f, size: fs.statSync(path.join(scriptDir, f)).size }));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(list), text: () => Promise.resolve("") });
  }
  const name = decodeURIComponent(u.replace(/^scripts\//, ""));
  const p = path.join(scriptDir, path.basename(name));
  if (fs.existsSync(p)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(fs.readFileSync(p, "utf8")) });
  return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
};

const context = {
  window: null,
  document: makeDoc(),
  navigator: { clipboard: { writeText: (t) => Promise.resolve() } },
  localStorage: { getItem: () => null, setItem: () => {} },
  setInterval: (fn, ms) => { intervals.set(fn, ms); return fn; },
  clearInterval: (fn) => { intervals.delete(fn); },
  setTimeout: () => 0,
  clearTimeout: () => {},
  performance: { now: () => clock },
  scrollTo: () => {},
  fetch: fetchStub,
  console: console,
};
context.window = context;
context.globalThis = context;
global.window = context;
require(path.join(root, "src", "fengari-web.min.js"));
context.window.fengari = require.cache[require.resolve(path.join(root, "src", "fengari-web.min.js"))].exports;

function flush() { return new Promise((r) => { setImmediate(() => r()); }); }

function step(dtms) {
  clock += dtms;
  for (const fn of Array.from(intervals.keys())) { if (intervals.get(fn) === 30) fn(); }
  // simTick runs at 66ms; only run if its interval is still scheduled
  for (const fn of Array.from(intervals.keys())) { if (intervals.get(fn) === 66) fn(); }
}
function drive(seconds, fps) {
  const per = Math.round(1000 / (fps || 60));
  const iters = Math.round(seconds * 1000 / per);
  const t0 = Date.now();
  for (let i = 0; i < iters; i++) {
    step(per);
    if (Date.now() - t0 > 15000) {
      console.log("  !! drive took >15s real at iter " + i + "/" + iters + " (sim " + clock.toFixed(0) + "ms)");
      break;
    }
  }
}
function clickEl(el, x, y) {
  const ev = { clientX: x, clientY: y, stopPropagation: () => {} };
  (el._events.click || []).forEach((fn) => fn(ev));
}
function textOf(el) { return stripTabs((el.textContent || "") + (el.innerHTML || "")); }
function stripTabs(s) { return s.replace(/[ \t]+/g, " ").replace(/\s+/g, " "); }

function gviewOf(ex) {
  return (ex.children || []).find((c) => String(c.className || "").indexOf("gview") !== -1);
}
function canvasOf(gv) { return gv && gv.children[0]; }
function hudOf(gv) { return gv && gv.children[1]; }
function hudTextOf(gv) {
  const hud = hudOf(gv);
  return (hud ? hud.children.map((c) => c.innerHTML || c.textContent).join(" | ") : "");
}

(async () => {
  try {
    vm.runInNewContext(appJs, context, { filename: "Lua-Playground.html" });
  } catch (e) {
    console.log("APP EVAL FAILED:", (e && e.message) || e);
    process.exit(1);
  }
  if (!bootCb) { console.log("no DOMContentLoaded hook"); process.exit(1); }
  bootCb();
  // let the fetch promise from setupScripts resolve
  await flush(); await flush();

  let fail = 0;
  const check = (name, cond, dbg) => {
    console.log((cond ? "  ok   " : "  FAIL ") + name + (cond || !dbg ? "" : "\n        " + dbg()));
    if (!cond) fail++;
  };

  const out = (el) => (el.textContent || "") + (el.innerHTML || "");

  /* ---------- LESSON 16: Click Tween ---------- */
  const lesson16 = idMap["tween"];
  const ex16 = lesson16 && lesson16.querySelector(".ex");
  const ta16 = ex16 && ex16.querySelector("textarea.code");
  const run16 = ex16 && ex16.querySelector(".run");
  const out16 = ex16 && ex16.querySelector(".out");
  check("lesson16 present: #tween section + .ex + textarea + run + out", !!(lesson16 && ex16 && ta16 && run16 && out16));

  clickEl(run16, 0, 0);
  drive(0.5, 30); // let the sim start + poll
  check("lesson16: Run starts the world (prints ready)", out(out16).indexOf("ready") !== -1,
    () => "run clicks " + (run16._events.click || []).length + " | out: " + JSON.stringify((out16.textContent || "").slice(0, 90)));
  let gv16 = gviewOf(ex16);
  check("lesson16: gview canvas created + shown", !!(gv16 && gv16.style && gv16.style.display === "block"),
    () => {
      const pl = context.window.__LP__ && context.window.__LP__.pollLog;
      const dbg = [];
      dbg.push("gv16=" + !!gv16 + " disp=" + (gv16 && JSON.stringify(gv16.style && gv16.style.display)));
      dbg.push("sim66Active=" + Array.from(intervals.entries()).some(([k, ms]) => ms === 66));
      dbg.push("exkids=" + (ex16.children || []).map((c) => (c.className || c.tagName)).join(","));
      const hud = hudOf(gv16);
      dbg.push("hudkids=" + (hud ? hud.children.length : "none"));
      dbg.push("poll=" + (pl ? JSON.stringify({ calls: pl.calls, luaErr: pl.luaErr, jsonErr: pl.jsonErr, vis: pl.lastVisible, first: pl.lastJson && pl.lastJson.slice(0, 60) }) : "noLD"));
      return dbg.join(" | ");
    });
  const firstHud = hudTextOf(gv16);
  check("lesson16: HUD with buttons drawn (ENABLED/EXACT present)", firstHud.indexOf("ENABLED") !== -1 && firstHud.indexOf("EXACT") !== -1);

  // click canvas at world (3, 4): px=((3+12)/24)*480=300, py=((4+7.5)/15)*300=230
  const cv16 = canvasOf(gv16);
  clickEl(cv16, 300, 230);
  drive(3, 30); // > 0.42s tween, plus margin
  let hudAfter = hudTextOf(gv16);
  check("lesson16: click tweens — HUD status 'landed'", /landed/i.test(hudAfter));
  check("lesson16: print log shows landed + error 0.000", /error 0\.000/.test(out(out16)));

  // GUI button toggle: EASE button
  const easeBtn16 = hudOf(gv16) && hudOf(gv16).children.find((c) => /EASE/.test(c.innerHTML || ""));
  if (easeBtn16) { clickEl(easeBtn16, 0, 0); }
  check("lesson16: EASE button toggles easing", !!easeBtn16);

  drive(1, 60);
  const poll = context.window.__LP__;
  check("__LP__ pollWorld/renderWorld exposed", !!(poll && poll.pollWorld && poll.renderWorld));

  /* ---------- LESSON 17: Your scripts (auto_fruit) ---------- */
  const lesson17 = idMap["scripts"];
  const ex17 = lesson17 && lesson17.querySelector(".ex");
  const ta17 = ex17 && ex17.querySelector("textarea.code");
  const run17 = ex17 && ex17.querySelector(".run");
  const out17 = ex17 && ex17.querySelector(".out");
  const pick = idMap["scripts-pick"];
  const loadBtn = idMap["scripts-load"];
  const explainBtn = idMap["scripts-explain"];
  const explainOut = idMap["scripts-explain-out"];
  check("lesson17 present + picker/load/explain", !!(lesson17 && ex17 && ta17 && run17 && out17 && pick && loadBtn && explainBtn));
  check("lesson17: script picker populated by /api/scripts", pick.children.some((o) => /auto_fruit/.test(o.textContent || "")));

  // pick + load auto_fruit.lua, then run it
  pick.value = "auto_fruit.lua";
  clickEl(loadBtn, 0, 0);
  await flush(); await flush(); await flush();
  check("lesson17: Load fills the textarea", (ta17.value || "").indexOf("Auto-Fruit") !== -1);

  clickEl(explainBtn, 0, 0);
  check("lesson17: Explain renders the explainer (not hidden)", explainOut.style.display === "block" && (explainOut.innerHTML || "").length > 200);

  clickEl(run17, 0, 0);
  drive(5, 30);
  let gv17 = gviewOf(ex17);
  check("lesson17: auto_fruit Run -> canvas shown + kill/sell prints", !!gv17 && /AUTO FRUIT|KILL|AutoSell|AutoBuy/.test(out(out17)),
    () => {
      const pl = context.window.__LP__ && context.window.__LP__.pollLog;
      const dbg = [];
      dbg.push("gv17=" + !!gv17 + " run17clicks=" + (run17._events.click || []).length);
      dbg.push("outHead=" + JSON.stringify(out(out17).slice(0, 160)));
      dbg.push("poll=" + (pl ? JSON.stringify({ calls: pl.calls, luaErr: pl.luaErr, jsonErr: pl.jsonErr, vis: pl.lastVisible }) : ""));
      return dbg.join(" | ");
    });
  check("lesson17: auto_fruit HUD shows Beli/mobs buttons", /Beli|mobs/.test(hudTextOf(gv17)));

  drive(70, 60); // ~70s more -> sells + another blade upgrade
  const outT = out(out17);
  check("lesson17: auto_fruit self-plays (kills happen)", /KILL/.test(outT) || /sold/.test(outT));
  check("lesson17: auto_sell economy (sold fruits)", /sold \d+ fruits/.test(outT));

  console.log(fail ? "ENGINE-RUN: " + fail + " checks FAILED" : "ENGINE-RUN OK");
  process.exit(fail ? 1 : 0);
})();