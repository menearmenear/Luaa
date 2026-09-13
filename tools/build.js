/* Build Lua-Playground.html from src/ (run from tools/: node tools/build.js) */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "src");

const prelude = fs.readFileSync(path.join(src, "prelude.lua"), "utf8");
const preludeJson = JSON.stringify(prelude);
const engine = fs.readFileSync(path.join(src, "engine.js"), "utf8")
  .replace("var PRELUDE = __PRELUDE_JSON__;", "var PRELUDE = " + preludeJson + ";");
const app = path.join(root, "app.js");
fs.writeFileSync(app, engine);
console.log("app.js written (" + engine.length + " bytes, prelude " + prelude.length + " chars)");

const head = fs.readFileSync(path.join(src, "head.html"), "utf8");
const fengari = fs.readFileSync(path.join(src, "fengari-web.min.js"), "utf8");
const body = fs.readFileSync(path.join(src, "body.html"), "utf8");
const installedApp = fs.readFileSync(app, "utf8");
const closing = "</script></head><body>\n" + body + "\n<script>\n" + installedApp + "</script>\n</body></html>\n";

const out = head + fengari + closing;
const target = path.join(root, "Lua-Playground.html");
fs.writeFileSync(target, out);
console.log("Lua-Playground.html written (" + out.length + " bytes)");