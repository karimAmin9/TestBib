# phone-app: what was built

## Phase 1: shared engine (2026-10-14)
- **`backend/Bib.Conversion`** class library (net10.0, `IsTrimmable`): `PdfProcessor`, `ConversionVerifier`,
  `TextNormalizer`, `ImageExtractor`, `ImageInfo`, `PngEncoder`, `Models` (incl. `ConversionJson`), `IPageRenderer` +
  `RenderedPage` + crop/PNG helpers. Moved with `git mv` from `Bib.Api/Conversion/`; namespace
  `Bib.Api.Conversion` → `Bib.Conversion`. Depends only on PdfPig and System.IO.Hashing.
- **`Bib.Api/Processing/DocnetPageRenderer.cs`**: the PDFium renderer stays in the API (native, server only). The API
  references the library; PdfPig / System.IO.Hashing come transitively. Dockerfile copies `Bib.Conversion/` too.
- **NFKC hook**: `TextNormalizer.NfkcImplementation` (default `string.Normalize(FormKC)`) + `TextNormalizer.Nfkc`
  (ASCII returned as is). The browser host sets the implementation once at startup to JS `normalize('NFKC')`.
- **Source-generated JSON**: `ConversionJsonContext` registers every stored type; `ConversionJson.Serialize/Deserialize`
  resolve `JsonTypeInfo<T>` from it. Unregistered types now throw `NotSupportedException` (register them in the context).
- Tests: 88/88 (84 + `Nfkc` ×2 + `ConversionJsonTests` ×2). `ConversionJsonTests` pins the output to the previous
  reflection-based options, so JSON already stored in Postgres stays readable without a migration.
- Spike (`spikes/wasm-engine`) now references the library instead of copied sources: trimmed, reflection JSON off.

## Phase 2: browser engine (2026-10-14)
- **Async rendering in the shared engine**: `IPageRenderer.RenderAsync` (ValueTask), `PdfProcessor.ProcessAsync`;
  processor and verifier take an optional `pageDone(page, total)` progress callback. Server: `DocnetPageRenderer`
  completes synchronously, `BookConversionService` awaits; behavior unchanged (89/89).
- **`frontend/engine/` (Bib.Engine, .NET WebAssembly)**: `EngineApi` [JSExport] ProcessAsync → ReadCover/ReadImage →
  Verify → Reset, one book at a time, images in the in-memory file system; unexpected errors become
  "Unexpected error while converting this PDF." (like the server) and are logged to the browser console.
  `BrowserHost` [JSImport]s nfkc / progress / renderPage from module `bib-engine`; `JsPageRenderer` awaits renderPage.
  Source-generated `EngineJson`, reflection JSON off.
- **`wwwroot/engine-worker.js`**: hosts the runtime, serializes commands, answers render requests immediately.
- **Angular `src/app/engine/`**: `BibEngine.convert(pdf, fileName, { onProgress, onConverted })` → `{ book, report }`;
  `onConverted` fires before verification (book readable early). Worker and pdf.js are injection tokens
  (`ENGINE_WORKER`, `ENGINE_PAGES`) so the protocol is unit-tested with fakes. `verificationSummary()` maps the report
  like the server. `pdf-pages.ts`: pdf.js renders on the main thread (lazy chunk) with `intent: 'print'` because display
  rendering waits on requestAnimationFrame, which hidden pages never get (conversions stalled in the background).
- **Build**: `npm run engine` (`scripts/build-engine.mjs`) publishes into `public/engine/` (gitignored, no .br/.gz).
  pdf.js 6.3.289 (pinned, installed with the project's npm 11.17); worker, cmaps, standard fonts, wasm decoders and ICC
  profiles copied to `/pdfjs` by angular.json.
- **Lab page** `/lab/engine` (unlinked route): pick a PDF or `?pdf=<same-origin path>`; progress, timings, cover,
  badge, page viewer.

### Verified (Phase 2)
- In the browser (dev server, off-screen iframes): novel, illustrated, columns, drawings (vector page rendered by pdf.js,
  colours checked pixel by pixel), 270-page novel, 40 MB photo book: all converted and **Verified 1:1**.
- Production build: pdf.js is a lazy chunk (108 kB transfer); initial bundle unchanged (84 kB).
- Backend 89/89, frontend 39/39.

### Notes / tech debt (Phase 2)
- In the hidden browser pane the 270-page novel took 28 s (22.9 convert + 5.2 check) vs 16 s in the Phase 0 headless
  benchmark: cold engine start per run and background CPU priority. `spikes/wasm-engine/bench.mjs` stays the reference.
- pdf.js runs on the main thread: rendering a page briefly blocks the UI (covers, drawing pages, undecodable images only).
- The lab page and its `?pdf=` loader are test tooling; remove or hide them once Phase 3 has the real library flow.

## Verified (Phase 1)
- `dotnet build backend/Bib.slnx`: 0 warnings (trim analyzer on).
- Native and trimmed-browser fingerprints identical to Phase 0 for all five spike PDFs; browser speed unchanged
  (novel 16.2 s at 1×), memory lower (96 MB vs 115 MB). Bundle 3.4 MB brotli / 5.2 MB gzip.
- API Docker image builds; end to end in the Linux container: upload → Ready, Verified, PDFium cover.

## Deviations / tech debt
- `NfkcImplementation` is a static settable delegate (global state). Fine for one host per process; don't set it in
  tests that run in parallel.
- Conversion tests still live in `Bib.Api.Tests` (they use the PDFium renderer through `ConversionHarness`).
