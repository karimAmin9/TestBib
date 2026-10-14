# Spike: the conversion engine in the browser (phone-app Phase 0)

Throwaway code that answered one question: can the existing C# conversion engine (`PdfProcessor` +
`ConversionVerifier`) run on a phone, in the browser, fast enough? Answer: **yes, acceptable**. Results and
decisions are in [`.10x/reviews/2026-10-13-phone-app-spike.md`](../../.10x/reviews/2026-10-13-phone-app-spike.md).

| Path | What it is |
|---|---|
| `shared/` | Compiles the repo's `backend/Bib.Api/Conversion/*.cs` (minus the PDFium renderer) plus a blank-page renderer and `SpikeRunner` (timings + an output fingerprint over chapters JSON and image hashes) |
| `shared/patched/TextNormalizer.cs` | Copy of the repo file with a replaceable NFKC function (.NET in the browser has no NFKC) |
| `native/` | Same code as a console app: the baseline |
| `wasm/` | .NET 10 WebAssembly build (`Microsoft.NET.Sdk.WebAssembly`, no workload needed) with a test page that runs the engine on the main thread or in a Web Worker |
| `gen-pdfs.ps1` | Prints the stress PDFs with Edge: a 270-page novel and a 40 MB book with 30 large photos |
| `bench.mjs` | Serves the bundle, drives headless Edge over the DevTools protocol with CPU throttling, prints results |

Run it (Windows, Edge installed):

```bash
powershell -ExecutionPolicy Bypass -File spikes/wasm-engine/gen-pdfs.ps1
dotnet build spikes/wasm-engine/native -c Release
dotnet publish spikes/wasm-engine/wasm -c Release
node spikes/wasm-engine/bench.mjs
```

Native baseline: `spikes/wasm-engine/native/bin/Release/net10.0/Spike.Native.exe spikes/wasm-engine/pdfs/*.pdf`.
Open the test page by hand: `node spikes/wasm-engine/bench.mjs --serve 5300`, then
`http://127.0.0.1:5300/index.html?mode=worker&pdfs=novel.pdf` (or pick a PDF on the page).

Gotchas found on the way: delete `wasm/bin` and `wasm/obj` when switching trimming on/off (stale trimmed assemblies
get mixed in → `TypeLoadException`); DevTools CPU throttling does not apply to Web Workers, so throttled numbers
come from `mode=main`.
