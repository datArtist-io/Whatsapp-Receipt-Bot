// Local server that behaves like the Vercel deployment: static files from public/,
// /api/* from api/*.js, and receipt links under /r/. Run: npm run dev
const http = require("http");
const fs = require("fs");
const path = require("path");

if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const PUBLIC = path.join(__dirname, "public");

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith("/api/")) {
    const file = path.join(__dirname, "api", p.slice(5).replace(/\/$/, "") + ".js");
    if (!file.startsWith(path.join(__dirname, "api")) || !fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
    try { return await require(file)(req, res); } catch (e) { console.error(e); res.statusCode = 500; return res.end("Error"); }
  }
  if (p.startsWith("/r/")) return serveFile(res, path.join(PUBLIC, "r", "index.html"));
  if (p === "/dashboard") { res.statusCode = 307; res.setHeader("Location", "/app" + url.search); return res.end(); }
  let file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  else if (!path.extname(file)) file += ".html";
  serveFile(res, file);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Slipp running at http://localhost:${port}`));
module.exports = server;
