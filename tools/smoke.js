/* Smoke-test the assembled page's engine with a stub DOM.
   Run from repo root:  node tools/smoke.js  (reads Lua-Playground.html
   produced by tools/build.js). */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "Lua-Playground.html"), "utf8");
const lines = html.split("\n");
const appJs = lines.slice(lines.indexOf("<script>") + 1).join("\n")
  .replace("</script>\n</body></html>", "");

function stubEl() {
  const classes = new Set();
  return {
    _classes: classes,
    textContent: "",
    value: "",
    style: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (on ? classes.add(c) : classes.delete(c))),
      contains: (c) => classes.has(c),
    },
    addEventListener: () => {},
    appendChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    scrollTo: () => {},
    focus: () => {},
  };
}

const dom = stubEl();
const documentStub = {
  getElementById: () => {
    const e = stubEl();
    e.parentElement = { querySelector: () => null };
    return e;
  },
  createElement: (tag) => { const e = stubEl(); e.style = {}; return e; },
  querySelectorAll: (sel) => [],
  querySelector: () => null,
  addEventListener: () => {},
};
documentStub.getElementById("console-screen"); // ensure shape used in boot catch

const context = {
  window: null,
  document: documentStub,
  navigator: { clipboard: null },
  fetch: () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve([]) }),
  localStorage: { getItem: () => null, setItem: () => {} },
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => {},
  performance: null,
};
context.window = context;
context.globalThis = context;
global.window = context;
require(path.join(root, "src", "fengari-web.min.js"));
context.window.fengari = require.cache[require.resolve(path.join(root, "src", "fengari-web.min.js"))].exports;

let bootCb = null;
documentStub.addEventListener = (ev, cb) => { if (ev === "DOMContentLoaded") bootCb = cb; };

let threw = null;
try {
  vm.runInNewContext(appJs, context, { filename: "Lua-Playground.html" });
} catch (e) {
  threw = e;
}
if (threw) { console.log("APP EVAL FAILED:", threw.message); process.exit(1); }
if (!bootCb) { console.log("no DOMContentLoaded hook registered"); process.exit(1); }
bootCb();
if (dom.textContent && String(dom.textContent).indexOf("boot failed") !== -1) {
  console.log("BOOT FAILED:", dom.textContent);
  process.exit(1);
}

// exercise the SandboxSim renderer with a realistic world (checks for JS errors)
const LP = context.window.__LP__;
if (!LP || typeof LP.renderWorld !== "function") {
  console.log("no __LP__ renderer exposed");
  process.exit(1);
}
function ctx2d() {
  return {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
    fillRect: () => {}, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {},
    lineTo: () => {}, stroke: () => {}, fill: () => {}, arc: () => {}, closePath: () => {},
    fillText: () => {},
  };
}
const gview = { style: {} };
const hud = { appendChild: () => {}, removeChild: () => {} };
const renderCtx = {
  gview, cv: null, g2d: ctx2d(), hud, hudEls: {}, gviewShown: false, world: null, touched: true,
};
const world = {
  visible: true,
  player: { x: 1.5, z: -2, angle: 45, color: "#4fc3f7", name: "You", hp: 80, maxhp: 100 },
  mobs: [
    { id: 1, x: -4, z: 3, hp: 3, maxhp: 10, color: "#e57373", name: "mob" },
    { id: 2, x: -4.5, z: 3.2, hp: 10, maxhp: 10, color: "#e57373", name: "mob" },
  ],
  coins: [{ x: 2, z: 2 }, { x: -2, z: 3 }],
  gui: { b1: { id: "b1", text: "Blade $25", x: 0.66, y: 0.17, w: 0.32, h: 0.09, color: "#263c8a", textColor: "#fff" } },
};
try {
  LP.renderWorld(renderCtx, world);
  LP.renderWorld(renderCtx, { visible: true, player: { x: 0, z: 0, angle: 0 }, mobs: [], coins: [], gui: {} });
  console.log("SIM RENDER OK: renderWorld handled player/mobs/coins/gui without throwing");
} catch (e) {
  console.log("SIM RENDER FAILED:", e.message);
  process.exit(1);
}
console.log("SMOKE OK: engine evaluated + boot callback ran without throwing");