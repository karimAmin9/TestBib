# Spike: the conversion engine in the browser (phone-app Phase 0)

Throwaway code that answered one question: can the existing C# conversion engine (`PdfProcessor` +
`ConversionVerifier`) run on a phone, in the browser, fast enough? Answer: **yes, acceptable**. Results and
decisions are in [`.10x/reviews/2026-10-13-phone-app-spike.md`](../../.10x/reviews/2026-10-13-phone-app-spike.md).

Since Phase 1 it references the real engine library (`backend/Bib.Conversion`), so it doubles as a regression
check: the fingerprints must stay as in `results-2026-10-13.txt` unless a conversion change is intended.

| Path | What it is |
|---|---|
| `shared/` | References `backend/Bib.Conversion`; adds a blank-page renderer and `SpikeRunner` (timings + an output fingerprint over chapters JSON and image hashes) |
| `native/` | Same code as a console app: the baseline |
| `wasm/` | .NET 10 WebAssembly build (`Microsoft.NET.Sdk.WebAssembly`, no workload needed, trimmed, reflection JSON off) with a test page that runs the engine on the main thread or in a Web Worker; sets `TextNormalizer.NfkcImplementation` to the browser's NFKC |
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

Results: `results-2026-10-13.txt` (Phase 0, untrimmed, copied sources) and `results-phase1-trimmed.txt` (Phase 1,
trimmed build of the real library: same fingerprints, same speed, 3.4 MB brotli / 5.2 MB gzip bundle).
