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
