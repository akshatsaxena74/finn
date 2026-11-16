// Zero-dependency local server that mirrors Vercel: /public is static, /api/<name>.js are functions
// exporting Web-standard GET/POST handlers. `npm run dev` -> http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 3000;

// load .env.local / .env (KEY=VALUE lines) without a dependency
for (const f of ['.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
        const file = path.join(ROOT, 'api', `${name}.js`);
        if (!fs.existsSync(file)) return send(res, 404, 'text/plain', 'no such function');
        const mod = await import(pathToFileURL(file).href + `?t=${fs.statSync(file).mtimeMs}`);
        const handler = mod[req.method] || mod.default?.fetch;
        if (!handler) return send(res, 405, 'text/plain', 'method not allowed');
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
        const request = new Request(url, { method: req.method, headers: req.headers, body });
        const t0 = Date.now();
        const response = await handler(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        console.log(`${req.method} ${url.pathname}${url.search} ${response.status} ${Date.now() - t0}ms`);
        return;
      }
      let p = path.join(ROOT, 'public', decodeURIComponent(url.pathname));
      if (!p.startsWith(path.join(ROOT, 'public'))) return send(res, 403, 'text/plain', 'forbidden');
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p)) p = path.join(ROOT, 'public', 'index.html'); // SPA fallback
      send(res, 200, TYPES[path.extname(p)] || 'application/octet-stream', fs.readFileSync(p));
    } catch (e) {
      console.error(e);
      send(res, 500, 'application/json', JSON.stringify({ error: e.message }));
    }
  })
  .listen(PORT, () => {
    console.log(`FINN dev server → http://localhost:${PORT}  (AI: ${process.env.GEMINI_API_KEY ? 'Gemini on' : 'off — cached/heuristic mode'})`);
    const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);
    if (lan.length) console.log(`On your phone (same Wi-Fi) → ${lan.join('  ')}`);
  });

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
