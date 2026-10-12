# pdf-reader — what was built
## Backend (`backend/Bib.Api`)
- `Conversion/PdfProcessor` — per page: NearestNeighbour words → Docstrum blocks → reading order → `MergeContinuations` (re-joins wrapped large-font lines Docstrum splits) → `SplitParagraphs` (gap > 2× font size or > 1.6× median pitch) → hyphen repair (recorded) → page-number removal in top/bottom 10% (recorded) → heading detection (≤3 lines, ≥1.25× dominant font size). Orphan-word safety net. Images: JPEG passthrough / PdfPig PNG / PDFium crop fallback; vector-only pages rendered. Placeholder metadata titles ("novel.html", "Document1") fall back to file name.
- `Conversion/ConversionVerifier` — ADR-005 checks on the *stored* chapters.
- `PngEncoder`, `ImageInfo` — no imaging library (ImageSharp dropped for licence reasons).
- `Processing/*` — Channel queue + BackgroundService, re-queue on startup, idempotent re-conversion.
- `Books/BookEndpoints` — all queries via `OwnedBy(userId)`; image names validated by regex.
- Data protection keys persisted under `{Storage:Root}/keys`.
## Frontend (`frontend/`)
- Angular 22 zoneless, standalone, signals. Pages: login/register, library (upload + polling), book detail (paged chapter list, edit/delete), reader (themes, font, spacing, width, ←/→, progress save/restore, verification note).
## Deviations from plan
- Added `h` (heading) block type — verifier treats it as text.
- Encrypted-PDF fixture not generated (PdfPig builder cannot encrypt); covered by exception mapping + "damaged PDF" tests.
- Non-ASCII/ligature fixture moved from code-generated PDFs (Standard-14 fonts can't encode ö) to the Edge-printed corpus.
## Tech debt
- Single-instance worker (ADR-004). Upload size check happens after the body is received (Kestrel limit 101 MB caps it).
- Book detail chapter list loads all chapter titles (fine up to thousands of pages).

## 2026-10-12 — ranobes.net look & responsive redesign
- Design taken from ranobes.net (via web.archive.org; live site is behind a CAPTCHA): charcoal page #3b3a3a, panel #474747 r8, text #ccc, muted #999, green accent #95ac7c, pill buttons #626262, Gotham-like font (Montserrat via @fontsource, self-hosted — no external requests, CSP unchanged).
- Shell: left icon rail (desktop) → sticky top bar + hamburger menu (≤760px).
- Library: ranobes "short story" list cards (cover, title, pills, byline, excerpt, READ pill bar, green Continue action) + sidebar (Continue/Recently added tabs, statistics). New `Book.Excerpt` (migration `BookExcerpt`).
- Book page: cover column with START READING/CHAPTERS LIST + facts, center info + scrolling chapter list, sidebar "Conversion check" bars + progress + manage.
- Reader: breadcrumbs, OPTIONS (inline settings), page select, « BACK / CHAPTERS LIST / NEXT » pills, nearby-pages sidebar ≥1080px. Images: width/height hints, max-width 100%, max-height 85vh (75vh phones) with object-fit contain, edge-to-edge on phones, rendered-vector pages shown at 1× (w/2), tap → fullscreen lightbox (Esc closes).
- Covers fall back to a generated placeholder when the image fails to load.
- 21st.dev skill was requested, but its MCP server is not connected and its React/Tailwind components don't fit Angular; built natively instead.
