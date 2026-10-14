// Spike benchmark: serves the published WebAssembly bundle, drives headless Edge (Chromium) over the DevTools
// protocol, applies CPU throttling (DevTools presets: 4x = mid-tier mobile, 6x = low-end mobile) and collects
// the results the page records. Node >= 22 (built-in WebSocket), no dependencies.
//   node bench.mjs [scenario-filter]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const here = import.meta.dirname;
const roots = { '/pdfs/': join(here, 'pdfs'), '/': join(here, 'wasm', 'bin', 'Release', 'net10.0', 'publish', 'wwwroot') };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.dat': 'application/octet-stream', '.pdf': 'application/pdf' };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const prefix = Object.keys(roots).find((p) => path.startsWith(p));
  const file = normalize(join(roots[prefix], path.slice(prefix.length) || 'index.html'));
  if (!file.startsWith(roots[prefix])) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
// `node bench.mjs --serve 5300` only serves the bundle (for opening the page in a browser by hand).
const serveOnly = process.argv[2] === '--serve';
await new Promise((r) => server.listen(serveOnly ? Number(process.argv[3]) : 0, '127.0.0.1', r));
const port = server.address().port;
if (serveOnly) {
  console.log(`serving on http://127.0.0.1:${port}/`);
  await new Promise(() => {});
}

const debugPort = 9333 + Math.floor(Math.random() * 500);
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(tmpdir(), 'bib-spike-cdp-' + debugPort)}`, 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((t) => t.type === 'page');
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const scenarios = [
  { name: 'corpus, worker, 1x', pdfs: 'novel.pdf,illustrated.pdf,columns.pdf', mode: 'worker', rate: 1 },
  { name: 'novel, main, 1x', pdfs: 'long-novel.pdf', mode: 'main', rate: 1 },
  { name: 'novel, worker, 1x', pdfs: 'long-novel.pdf', mode: 'worker', rate: 1 },
  { name: 'novel, main, 4x', pdfs: 'long-novel.pdf', mode: 'main', rate: 4 },
  { name: 'novel, worker, 4x', pdfs: 'long-novel.pdf', mode: 'worker', rate: 4 },
  { name: 'novel, main, 6x', pdfs: 'long-novel.pdf', mode: 'main', rate: 6 },
  { name: 'photos, worker, 1x', pdfs: 'photos.pdf', mode: 'worker', rate: 1 },
  { name: 'photos, main, 4x', pdfs: 'photos.pdf', mode: 'main', rate: 4 },
].filter((s) => !process.argv[2] || s.name.includes(process.argv[2]));

const rows = [];
for (const s of scenarios) {
  await cdp('Emulation.setCPUThrottlingRate', { rate: s.rate });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?mode=${s.mode}&pdfs=${s.pdfs}` });
  let state = null;
  const deadline = Date.now() + 20 * 60_000;
  while (!state && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await cdp('Runtime.evaluate', {
      expression: 'window.__done ? JSON.stringify({ results: window.__results, startupMs: window.__startupMs, error: window.__error }) : null',
      returnByValue: true,
    });
    state = r.result?.result?.value ? JSON.parse(r.result.result.value) : null;
  }
  if (!state) state = { error: 'timeout', results: [] };
  if (state.error) console.log(`${s.name}: ERROR ${state.error}`);
  for (const r of state.results) {
    rows.push({ scenario: s.name, startupMs: state.startupMs, ...r });
    console.log(`${s.name}\tstartup ${state.startupMs} ms\t${JSON.stringify(r)}`);
  }
}

await cdp('Emulation.setCPUThrottlingRate', { rate: 1 });
ws.close();
edge.kill();
server.close();
console.log('\n' + JSON.stringify(rows));
