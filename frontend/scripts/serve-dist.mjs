// Serves the GitHub Pages build locally the way Pages does: under /TestBib/, 404.html for unknown paths,
// 10-minute caching. localhost counts as secure, so the service worker and installing work as on the real site.
// Usage: npm run serve:pages [-- port]   (after npm run build:pages)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const base = '/TestBib/';
const root = join(import.meta.dirname, '..', 'dist', 'frontend', 'browser');
const port = Number(process.argv[2] ?? 4300);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain',
};

async function file(path) {
  const info = await stat(path).catch(() => null);
  if (info?.isDirectory()) return file(join(path, 'index.html'));
  return info ? { path, body: await readFile(path) } : null;
}

createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (!url.startsWith(base)) {
    res.writeHead(302, { Location: base }).end();
    return;
  }
  const path = normalize(join(root, url.slice(base.length)));
  if (!path.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  const found = await file(path);
  const served = found ?? (await file(join(root, '404.html')));
  res
    .writeHead(found ? 200 : 404, {
      'Content-Type': types[extname(served.path)] ?? 'application/octet-stream',
      'Cache-Control': 'max-age=600',
    })
    .end(served.body);
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} at http://localhost:${port}${base}`));
