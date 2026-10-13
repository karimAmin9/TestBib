# Status: pdf-reader
**Phase:** Delivery Complete. Self-hosted on the owner's PC (2026-10-13). Next: **phone-app**, the whole app on the
phone as an offline PWA (`.10x/decisions/devops/phone-app.md`), Phase 0 (WebAssembly spike) not started.

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
| 11 | phone-app P0: WebAssembly spike, go/no-go on phone performance | next |
| 12 | phone-app P1: shared `Bib.Conversion` library | planned |
| 13 | phone-app P2: browser engine (WASM worker + pdf.js renderer) | planned |
| 14 | phone-app P3: frontend local mode (IndexedDB, no login) | planned |
| 15 | phone-app P4: PWA + GitHub Actions → GitHub Pages | planned |
| 16 | phone-app P5: go-live on the phone, retire the server | planned (owner: enable Pages, push, install) |

**Tests:** backend 84/84, frontend 29/29 green (2026-10-13 run: backend only).
**Deploy history:**
- 2026-10-13: full stack on the owner's PC at 127.0.0.1:8080, verified end to end; DB empty and ready for use.

**2026-10-13 fix:** `backend/Bib.Api/Data/` (AppDbContext, entities, migrations) had never been committed because the
`.gitignore` rule `data/` also matches `Data/` on Windows. Rebuilt from the DBA schema and code usage, with a fresh
`InitialCreate` migration. Databases created from the original migrations would not match this history.
