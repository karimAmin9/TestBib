# Handoff

## Current Handoff
From: SDE (phone-app Phase 1, shared engine) to QA / Security for review, then SDE for Phase 2.
- What was built and verified: `.10x/decisions/sde/phone-app.md`. Branch `phone-app-phase1-shared-engine`.
- **Review focus:** `backend/Bib.Conversion` must stay trim-safe and browser-safe. `ConversionJsonTests` guarantees
  stored JSON is unchanged (no DB migration). `TextNormalizer.NfkcImplementation` is process-global: set once by the
  browser host, never by the server or tests.
- **What to test:** `dotnet test backend/Bib.slnx` (88, needs Docker); the browser regression check
  `node spikes/wasm-engine/bench.mjs "worker, 1x"` (fingerprints must match `results-2026-10-13.txt`); the API image
  builds and converts in the Linux container (done 2026-10-14).
- **Phase 2 next** (`.10x/decisions/devops/phone-app.md`): browser engine = WASM worker + pdf.js `IPageRenderer` +
  JS API with progress; book readable after processing, verification afterwards.
- Unchanged: owner decisions (phone-only PWA, Android, €0, no login/backups, GitHub Pages); AOT needs the owner's OK;
  the server stack stays until Phase 5. Docker Desktop is normally stopped on the owner's PC: start it for integration
  tests and stop it again with `docker desktop stop`.

## History
### 2026-10-13: DevOps (phone-app Phase 0 spike) to SDE / Architect for Phase 1
- Spike **GO**: `.10x/reviews/2026-10-13-phone-app-spike.md`; code in `spikes/wasm-engine/`. Phase 1 scope: library,
  NFKC hook, source-generated JSON. Done 2026-10-14.

### 2026-10-13: DevOps (phone-app plan) to SDE / Architect
- Plan agreed; Phase 0 (spike) first.

### 2026-10-13: DevOps (local-hosting) to SRE / the owner
- Decisions: `.10x/decisions/devops/local-hosting.md`. Stack on the owner's PC at 127.0.0.1:8080, verified.
- Tailscale was never set up: superseded by phone-app the same day.

### 2026-10-12: DevOps/SRE to the next feature work
- Runbook: `.10x/decisions/sre/pdf-reader.md`
- Deploy: README "Deployment" + `.10x/decisions/devops/pdf-reader.md`
- Open items: CI pipeline, TLS proxy, strong DB password, container limits, email verification or closed registration.
- Candidate next features (PM backlog): search and tags, OCR for scanned PDFs, smarter chapters (PDF outline/bookmarks), EPUB import.
