/* Shared helpers for build/verify: inject scripts/test.lua into body.html. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function loadTestLua() {
  return fs.readFileSync(path.join(ROOT, "scripts", "test.lua"), "utf8");
}

function inject(body) {
  const ta = body.indexOf("@@TEST_LUA@@");
  if (ta === -1) return body;
  const lua = loadTestLua();
  return body.replace("@@TEST_LUA@@", esc(lua));
}

module.exports = { esc, inject, loadTestLua, ROOT };