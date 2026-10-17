// Runs the .NET conversion engine (WebAssembly) in a Web Worker so a long conversion never freezes the page.
// The page side is frontend/src/app/engine/bib-engine.ts.
//
// Page → worker:  { id, type: 'process', pdf: ArrayBuffer, fileName } | { id, type: 'cover' }
//                 { id, type: 'image', name } | { id, type: 'verify', book: AssembledBook JSON } | { id, type: 'reset' }
//                 { type: 'rendered', renderId, width, height, bgra: ArrayBuffer } | { type: 'renderFailed', renderId, message }
// Worker → page:  { type: 'ready' } | { type: 'failed', message } | { type: 'progress', stage, done, total }
//                 { type: 'render', renderId, pageIndex, scale }   (the page renders with pdf.js)
//                 { id, type: 'result', value } | { id, type: 'error', message }
import { dotnet } from './_framework/dotnet.js';

const renders = new Map();
let nextRenderId = 1;

let api;
try {
  const runtime = await dotnet.create();
  runtime.setModuleImports('bib-engine', {
    nfkc: (text) => text.normalize('NFKC'),
    progress: (stage, done, total) => self.postMessage({ type: 'progress', stage, done, total }),
    renderPage: (pageIndex, scale) =>
      new Promise((resolve, reject) => {
        const renderId = nextRenderId++;
        renders.set(renderId, { resolve, reject });
        self.postMessage({ type: 'render', renderId, pageIndex, scale });
      }),
  });
  await runtime.runMain();
  const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
  api = exports.Bib.Engine.EngineApi;
} catch (e) {
  self.postMessage({ type: 'failed', message: String(e?.message ?? e) });
  throw e;
}

const commands = {
  process: ({ pdf, fileName }) => api.ProcessAsync(new Uint8Array(pdf), fileName),
  cover: () => api.ReadCover(),
  image: ({ name }) => api.ReadImage(name),
  verify: ({ book }) => api.Verify(book),
  reset: () => api.Reset(),
};

// Commands run one after another; render replies are handled immediately (a running process awaits them).
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.type === 'rendered' || data.type === 'renderFailed') {
    const render = renders.get(data.renderId);
    renders.delete(data.renderId);
    if (data.type === 'rendered') {
      render?.resolve({ width: data.width, height: data.height, bgra: new Uint8Array(data.bgra) });
    } else {
      render?.reject(new Error(data.message));
    }
    return;
  }

  queue = queue.then(async () => {
    try {
      const value = await commands[data.type](data);
      const transfer = value instanceof Uint8Array ? [value.buffer] : [];
      self.postMessage({ id: data.id, type: 'result', value }, transfer);
    } catch (e) {
      self.postMessage({ id: data.id, type: 'error', message: String(e?.message ?? e) });
    }
  });
};

self.postMessage({ type: 'ready' });
