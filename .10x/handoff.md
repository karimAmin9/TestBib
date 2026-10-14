# Handoff

## Current Handoff
From: SDE (phone-app Phase 2, browser engine) to QA / Security for review, then SDE for Phase 3.
- What was built and verified: `.10x/decisions/sde/phone-app.md` (Phase 2). Branch `phone-app-phase2-browser-engine`
  (stacked on `phone-app-phase1-shared-engine`).
- **Try it:** `npm --prefix frontend run engine`, `npm --prefix frontend start`, open http://localhost:4200/lab/engine.
- **Review focus:** worker protocol (`frontend/engine/wwwroot/engine-worker.js` ↔ `src/app/engine/bib-engine.ts`);
  `EngineApi.ReadImage` only accepts verifier-valid image names; pdf.js `intent: 'print'` (background rendering);
  CSP for Phase 4: .NET needs `'wasm-unsafe-eval'`, pdf.js needs `worker-src 'self'` and blob/data images.
- **Phase 3 next:** local library in IndexedDB using `BibEngine.convert` (store on `onConverted`, then the report),
  no login, blob URLs in reader/library, `navigator.storage.persist()`. Remove the lab page afterwards.
- Unchanged: owner decisions (phone-only PWA, Android, €0, no login/backups, GitHub Pages); AOT needs the owner's OK;
  the server stack stays until Phase 5. Docker Desktop is normally stopped on the owner's PC: start it for integration
  tests and stop it again with `docker desktop stop`.

## History
### 2026-10-14: SDE (phone-app Phase 1, shared engine) to QA / Security
- `backend/Bib.Conversion` library, NFKC hook, source-generated JSON; 88/88; identical fingerprints. Branch
  `phone-app-phase1-shared-engine`.

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
