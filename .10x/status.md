# Status: pdf-reader
**Phase:** Delivery Complete. Self-hosted on the owner's PC (2026-10-13). Next: **phone-app**, the whole app on the
phone as an offline PWA (`.10x/decisions/devops/phone-app.md`). Phase 0 done: **GO**
(`.10x/reviews/2026-10-13-phone-app-spike.md`). Phase 1 done (2026-10-14): shared `Bib.Conversion` library.
Phase 2 done (2026-10-14): engine runs in the browser. Phase 3 done (2026-10-14): the app is local-only (IndexedDB
library, no login, no server calls). Phase 4 built (2026-10-14): installable offline PWA + Test-and-publish
workflow to GitHub Pages; waits for the owner to enable Pages and approve the push.

| # | Task | Status |
|---|------|--------|
| 1 | Repo, state, ADRs 001-005 | done |
| 2 | Backend scaffold, EF, Identity, migration | done (Data/ restored 2026-10-13, see below) |
| 3 | Fidelity tests + PdfProcessor | done |
| 4 | ConversionVerifier, mutation + corpus tests, worker | done |
| 5 | Endpoints + integration tests | done |
| 6 | Angular scaffold + auth | done |
| 7 | Library / Detail / Reader + verification UI | done |
| 8 | QA, security hardening, Docker, README | done |
| 9 | local-hosting: stack on PC, localhost-only ports, auto-restart | done |
| 10 | local-hosting: Tailscale on PC + phone, `tailscale serve` | dropped (superseded by phone-app) |
| 11 | phone-app P0: WebAssembly spike, go/no-go on phone performance | done: GO (~101 s / 270 pages at 4×, identical output) |
| 12 | phone-app P1: shared `Bib.Conversion` library + NFKC hook + source-generated JSON | done (88/88, identical output, 0 trim warnings) |
| 13 | phone-app P2: browser engine (WASM worker + pdf.js renderer) + lab page | done (all samples Verified 1:1 in the browser) |
| 14 | phone-app P3: frontend local mode (IndexedDB, no login) | done (add/convert/resume/read/delete verified in the browser) |
| 15 | phone-app P4: PWA + GitHub Actions → GitHub Pages | built + verified locally (offline, updates, CSP); first deploy pending owner |
| 16 | phone-app P5: go-live on the phone, retire the server | planned (owner: enable Pages, push, install) |

**Tests:** backend 89/89, frontend 51/51 (2026-10-14).
**Deploy history:**
- 2026-10-13: full stack on the owner's PC at 127.0.0.1:8080, verified end to end; DB empty and ready for use.

**2026-10-13 fix:** `backend/Bib.Api/Data/` (AppDbContext, entities, migrations) had never been committed because the
`.gitignore` rule `data/` also matches `Data/` on Windows. Rebuilt from the DBA schema and code usage, with a fresh
`InitialCreate` migration. Databases created from the original migrations would not match this history.
