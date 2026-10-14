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

## Verified
- `dotnet build backend/Bib.slnx`: 0 warnings (trim analyzer on).
- Native and trimmed-browser fingerprints identical to Phase 0 for all five spike PDFs; browser speed unchanged
  (novel 16.2 s at 1×), memory lower (96 MB vs 115 MB). Bundle 3.4 MB brotli / 5.2 MB gzip.
- API Docker image builds; end to end in the Linux container: upload → Ready, Verified, PDFium cover.

## Deviations / tech debt
- `NfkcImplementation` is a static settable delegate (global state). Fine for one host per process; don't set it in
  tests that run in parallel.
- Conversion tests still live in `Bib.Api.Tests` (they use the PDFium renderer through `ConversionHarness`).
