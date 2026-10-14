# Handoff

## Current Handoff
From: DevOps (phone-app Phase 4, PWA + GitHub Pages) to SRE / the owner.
- Decisions, pipeline, verification, rollback: `.10x/decisions/devops/phone-app.md` (Phase 4). Branch
  `phone-app-phase4-pwa-pages` (stacked on phases 1–3; one PR to `main` carries all four).
- **Go-live steps (owner):** Settings → Pages → Source: **GitHub Actions**; approve push + PR; merge → workflow
  "Test and publish" deploys to https://karimamin9.github.io/TestBib/ (≈5–10 min).
- **Smoke test after deploy:** open on the phone → install → add a PDF → "Verified 1:1"; airplane mode → app still
  opens and reads. Phase 5: real-phone timing with the owner's own PDFs, then retire the server.
- **Operate:** updates = push to main (banner on the phone); rollback = revert on main or re-run an earlier commit.
  Local check of a production build: `npm --prefix frontend run build:pages` + `serve:pages` (:4300/TestBib/).
- Legacy Docker frontend: CSP lacks `'wasm-unsafe-eval'`, conversion won't run there; removal in Phase 5.
- Unchanged: owner decisions (phone-only PWA, Android, €0, no login/backups, GitHub Pages); AOT needs the owner's OK.
  Docker Desktop is normally stopped on the owner's PC: start it for integration tests, stop with `docker desktop stop`.

## History
### 2026-10-14: SDE (phone-app Phase 3, local library) to QA / Security, then DevOps
- IndexedDB library without login, verified in the browser. Branch `phone-app-phase3-local-library`.

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
