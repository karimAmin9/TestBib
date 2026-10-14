# SDE notes
- Features:
  - [pdf-reader](pdf-reader.md): server app (API, worker, Angular UI), done. Paths there predate the
    `Bib.Conversion` split: `backend/Bib.Api/Conversion/*` now lives in `backend/Bib.Conversion/`.
  - [phone-app](phone-app.md): run Bib entirely on the phone. Phases 1 (shared engine) and 2 (browser engine + lab
    page) done; Phase 3 (frontend local mode) next.
- Cross-cutting:
  - The conversion engine (`Bib.Conversion`) must stay trim-safe and browser-safe: no reflection-based JSON, no
    native dependencies, no APIs the browser lacks without a host hook (see `TextNormalizer.NfkcImplementation`).
  - `node spikes/wasm-engine/bench.mjs "worker, 1x"` is the browser regression check: fingerprints must not change
    unless a conversion change is intended.
