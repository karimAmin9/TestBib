// The engine in a Web Worker, so a long conversion never freezes the page.
import { dotnet } from './_framework/dotnet.js';

globalThis.bibNfkc = (s) => s.normalize('NFKC');
const runtime = await dotnet.create();
await runtime.runMain();
const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);

self.onmessage = (e) => {
  const t0 = performance.now();
  let json;
  try {
    json = exports.Engine.Convert(e.data);
  } catch (err) {
    json = JSON.stringify({ ok: false, error: String(err?.stack ?? err) });
  }
  self.postMessage({ type: 'result', json, wallMs: performance.now() - t0, heapMb: runtime.localHeapViewU8().byteLength / 1048576 });
};
self.postMessage({ type: 'ready' });
