/* Super-simple static server for the Lua Playground.
   Serves the repo root, defaulting to Lua-Playground.html at /.
   Usage:  node tools/serve.js [port]        (default port 8000)
   Listens on 0.0.0.0 so your phone's LAN IP works too. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const port = Number(process.argv[2] || process.env.PORT || 8000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".lua": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/Lua-Playground.html";
  const file = path.join(root, urlPath);
  if (!file.startsWith(root)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found: " + urlPath); return; }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
});

server.listen(port, "0.0.0.0", () => {
  const os = require("os");
  const nets = os.networkInterfaces();
  const lan = [];
  Object.keys(nets).forEach((k) => nets[k].forEach((a) => {
    if (a.family === "IPv4" && !a.internal) lan.push(a.address);
  }));
  console.log("Lua Playground running:");
  console.log("  http://localhost:" + port);
  lan.forEach((ip) => console.log("  http://" + ip + ":" + port));
});