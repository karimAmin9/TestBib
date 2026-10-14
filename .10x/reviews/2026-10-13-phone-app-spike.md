# phone-app Phase 0: conversion engine in the browser (spike report)

**Date:** 2026-10-13 · **Verdict: GO** with the .NET WebAssembly interpreter. Code: `spikes/wasm-engine/`.

## Question
Can the existing C# engine (`PdfProcessor` + `ConversionVerifier`, PdfPig) run in a phone browser fast enough,
with identical output? Thresholds set before measuring, for a 300-page novel at mid-range phone speed (4×):
≤ 1 min good · ≤ 3 min acceptable (one-time background job) · > 5 min or out of memory = no-go.

## Setup
- Repo sources compiled unchanged, except: PDFium renderer replaced by a blank-page stand-in (pdf.js does real
  rendering later), and NFKC routed through a replaceable function (see findings).
- .NET 10 `Microsoft.NET.Sdk.WebAssembly`, interpreter (no AOT, **no workload needed**), untrimmed.
- Headless Edge (Chromium) via DevTools protocol; DevTools CPU throttling 4× = "mid-tier mobile", 6× = "low-end mobile".
- Correctness: SHA-256 fingerprint over chapters JSON + every image file, compared with a native run.

## Results
| PDF | Native | Browser 1× | Browser 4× | Browser 6× | WASM memory | Output |
|---|---|---|---|---|---|---|
| long-novel, 270 pages, 1.4 MB | 1.25 s | 16.2 s | **101 s** | 169 s | 138 MB | identical, Pass |
| photos, 30 pages, 30 large JPEGs, 40.6 MB | 0.30 s | 3.2 s | **17.9 s** | – | 154 MB | identical, Pass |
| corpus novel / illustrated / columns | < 50 ms | < 1 s | – | – | 80 MB | identical, Pass |

- Split for the novel at 4×: processing 68 s, verification 33 s. Engine startup 0.15–1 s.
- Web Worker: works, same speed as the main thread (1×: 16.2 s vs 16.5 s), UI stays responsive.
- The interpreter is ~13× slower than native here. 4×-throttled ≈ 6× the 1× time.
- Bundle: 30.7 MB raw / 8.4 MB brotli untrimmed; 14 MB / 3.5 MB brotli trimmed.

## Findings that change the plan
1. **NFKC is not supported by .NET in the browser** (`PlatformNotSupportedException`). Fix: `TextNormalizer` gets a
   replaceable NFKC function; the browser host uses `String.prototype.normalize('NFKC')` (ICU in Chromium) via
   `[JSImport]`. Pure-ASCII text skips it. Native output unchanged (same fingerprints).
2. **Reflection-based JSON breaks under trimming** (positional record parameter names are stripped). Fix:
   source-generated `JsonSerializerContext` for `ConversionJson` (trim-safe, faster, also benefits the server).
   Needed for the 3.5 MB trimmed bundle.
3. **Verification is ~1/3 of the time.** Make the book readable after processing and verify in the background.
4. Throttled numbers are estimates. DevTools throttling does **not** apply to Web Workers, so phone estimates come
   from main-thread runs.

## Decisions
- GO with the interpreter. AOT (`wasm-tools` workload) stays an optional later build switch if the real phone feels
  slow; it doesn't change the architecture.
- Keep the 100 MB upload limit for now (≈150 MB WASM memory at 40 MB). Confirm on the device.
- Confirm on the owner's Android phone with their own PDFs as soon as a page can be hosted (Phase 4, or earlier).
