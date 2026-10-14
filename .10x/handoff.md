# Handoff

## Current Handoff
From: SDE (phone-app Phase 3, local library) to QA / Security for review, then DevOps for Phase 4.
- What was built and verified: `.10x/decisions/sde/phone-app.md` (Phase 3). Branch `phone-app-phase3-local-library`
  (stacked on phases 1 and 2).
- **Try it:** `npm --prefix frontend run engine`, `npm --prefix frontend start`, http://localhost:4200: add a PDF.
- **Review focus:** IndexedDB transactions (`core/db.ts`: nothing but requests awaited inside); delete during a
  conversion; resume rules; object URL lifetime; no remaining server calls (verified: zero `/api` requests).
- **Phase 4 next (DevOps):** PWA (manifest, icons, Angular service worker incl. the engine and pdf.js files,
  "update available" prompt), CSP as `<meta>` (`script-src 'self' 'wasm-unsafe-eval'`, `img-src 'self' data: blob:`,
  `worker-src 'self'`), GitHub Pages under `/TestBib/` (base href, 404.html fallback), GitHub Actions: tests →
  `npm run engine` → `ng build` → deploy. Owner enables Pages and approves the push.
- The README Deployment section (Docker/Tailscale) is outdated for the local app; rewrite it in Phase 4.
- Unchanged: owner decisions (phone-only PWA, Android, €0, no login/backups, GitHub Pages); AOT needs the owner's OK;
  the server stack stays until Phase 5. Docker Desktop is normally stopped on the owner's PC: start it for integration
  tests and stop it again with `docker desktop stop`.

## History
### 2026-10-14: SDE (phone-app Phase 2, browser engine) to QA / Security
- Engine in a Web Worker (`frontend/engine`), pdf.js renderer, `BibEngine` client, lab page (removed in Phase 3).
  Branch `phone-app-phase2-browser-engine`.

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
