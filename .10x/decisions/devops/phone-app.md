# phone-app: run Bib entirely on the phone (installable offline web app)

**Date:** 2026-10-13 · **Status:** Phase 0 done, **GO** (report: `.10x/reviews/2026-10-13-phone-app-spike.md`);
Phases 1–2 done 2026-10-14 (`.10x/decisions/sde/phone-app.md`); Phase 3 next
**Supersedes:** [local-hosting](local-hosting.md) as the way to use Bib on the phone.

## Requirements (owner)
- Use Bib on the phone while the PC is off. App or website, either is fine.
- Getting a new version onto the phone after a code change must be easy.
- €0, no credit card. Books stored locally (on the phone), no server database, no backups.
- Single user. Phone: **Android** (Chrome).

## Options considered
| Option | Verdict |
|---|---|
| **B. Phone-only PWA**: conversion, storage and reader all on the phone; static hosting | **Chosen**: €0 without card, offline, books stay on the device |
| A. Current app on Oracle Always Free + auto-deploy | Rejected by owner: needs an Oracle account with card; data on a free cloud VM without backups |
| C. PC converts, phone keeps offline copies | Rejected: no new books while the PC is off |
| Native app (Capacitor/MAUI) | Not needed: Android installs PWAs; APK sideloading adds friction to every update |

## Target architecture
- **Angular PWA** (existing UI): installable, offline via the Angular service worker.
- **Conversion engine in the browser**: the existing C# `PdfProcessor` + `ConversionVerifier` (pure .NET except
  page rendering) compiled to **.NET 10 WebAssembly**, running in a **Web Worker** so the UI stays responsive.
  Shared `Bib.Conversion` library, the same code and fidelity tests as the server.
- **Page rendering**: `IPageRenderer` implemented with **pdf.js** (replaces PDFium/Docnet). pdf.js is async, so
  rendering becomes its own step between processing and verification.
- **Storage**: IndexedDB for books, chapters (blocks JSON), removals, verification, progress, and images/cover as
  Blobs. `navigator.storage.persist()` so Chrome doesn't evict it. Versioned schema with forward migrations so app
  updates never break stored books.
- **No accounts**: login/register, the auth guard and the interceptor are removed. `BooksApi` is replaced by a local
  library service with the same shape; image/cover URLs become blob URLs.
- **Hosting**: **GitHub Pages** (repo is public), base href `/TestBib/`, `404.html` SPA fallback, CSP as `<meta>`
  (needs `'wasm-unsafe-eval'` for .NET).
- **Updates**: push to `main` → GitHub Actions runs the tests, builds, and deploys to Pages → the app shows
  "Update available" on next open → tap to reload.

## Rollout (incremental; the server keeps running until Phase 5)
0. **Spike, go/no-go**: build the engine for WebAssembly; convert the corpus PDFs and a real long novel in Chrome
   with mobile CPU throttling; measure time and memory; decide interpreter vs AOT (`wasm-tools` workload) and the
   max file size.
   **Result (2026-10-13): GO.** 270-page novel ≈ 101 s at 4× (mid-range phone), 169 s at 6×; 40 MB photo book
   ≈ 18 s at 4×; ≈ 150 MB memory; output byte-identical to native. Interpreter, no AOT for now.
1. **Shared engine**: move `Conversion/` into a `Bib.Conversion` library; server and all tests unchanged and green.
   Plus, from the spike: replaceable NFKC in `TextNormalizer` (browser has none in .NET) and source-generated JSON
   in `ConversionJson` (trim-safe).
2. **Browser engine**: WASM worker + pdf.js renderer + JS API (`convert(pdf) → progress → result`). Book readable
   after processing; verification runs afterwards in the background (~1/3 of the time).
3. **Local mode in the frontend**: IndexedDB library service, no login, blob URLs, persistent storage.
4. **PWA + CI/CD**: manifest, icons, service worker, update banner; Actions workflow test → build → deploy Pages.
5. **Go-live**: owner enables Pages (Settings → Pages → Source: GitHub Actions), pushes, installs the app on the
   phone, tests a real book. Then retire the server: API, Postgres, Docker and compose removed, containers stopped.

## Risks
| Risk | Mitigation |
|---|---|
| Conversion too slow or out of memory on the phone (largest risk) | Phase 0 measures it first; AOT; lower upload limit; per-page processing |
| Books exist only in Chrome's storage for the site: clearing site data or uninstalling deletes them | Persistent storage; owner accepted no backups (export/import file can be added later) |
| pdf.js renders covers/scanned/vector-only pages differently from PDFium | Text and extracted images come from the same PdfPig code and are still verified; only rendered pages change |
| First load downloads several MB (.NET runtime) | Cached by the service worker; offline afterwards |
| An update breaks stored data | Versioned IndexedDB schema, migration tests |

## Rollback
- Until Phase 5 the server stack is untouched (`docker compose --profile full up -d`).
- Pages: re-run the deploy workflow on the previous commit; the app picks it up on next open. Schema migrations are
  forward-only, so a rollback across a schema change needs the old version to tolerate the newer schema (keep
  changes additive).
