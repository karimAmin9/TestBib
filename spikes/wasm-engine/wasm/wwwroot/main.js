// Loads the .NET engine on the main thread or in a Web Worker, converts PDFs, records results in window.__results.
import { dotnet } from './_framework/dotnet.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'worker';
const out = document.getElementById('out');
const log = (line) => (out.textContent += line + '\n');
window.__results = [];

globalThis.bibNfkc = (s) => s.normalize('NFKC');

async function mainThreadEngine() {
  const runtime = await dotnet.create();
  await runtime.runMain();
  const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
  return async (bytes) => {
    const t0 = performance.now();
    const json = exports.Engine.Convert(bytes);
    return { json, wallMs: performance.now() - t0, heapMb: runtime.localHeapViewU8().byteLength / 1048576 };
  };
}

async function workerEngine() {
  const worker = new Worker('./worker.js', { type: 'module' });
  await new Promise((resolve, reject) => {
    worker.onmessage = (e) => e.data.type === 'ready' && resolve();
    worker.onerror = (e) => reject(new Error(e.message));
  });
  return (bytes) =>
    new Promise((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.postMessage(bytes, [bytes.buffer]);
    });
}

async function convert(engine, name, bytes) {
  const r = await engine(bytes);
  const result = { file: name, mode, sizeMb: +(bytes.byteLength / 1048576).toFixed(1), wallMs: Math.round(r.wallMs), wasmHeapMb: Math.round(r.heapMb), ...JSON.parse(r.json) };
  window.__results.push(result);
  log(JSON.stringify(result));
}

try {
  const t0 = performance.now();
  const engine = mode === 'main' ? await mainThreadEngine() : await workerEngine();
  window.__startupMs = Math.round(performance.now() - t0);
  log(`engine ready (${mode}) in ${window.__startupMs} ms`);

  for (const name of (params.get('pdfs') ?? '').split(',').filter(Boolean)) {
    const bytes = new Uint8Array(await (await fetch(`pdfs/${name}`)).arrayBuffer());
    await convert(engine, name, bytes);
  }
  document.getElementById('pick').onchange = async (e) => {
    const file = e.target.files[0];
    log(`converting ${file.name} …`);
    await convert(engine, file.name, new Uint8Array(await file.arrayBuffer()));
  };
} catch (e) {
  window.__error = String(e?.stack ?? e);
  log('ERROR ' + window.__error);
}
window.__done = true;
