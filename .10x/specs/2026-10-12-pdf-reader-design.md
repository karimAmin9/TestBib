# Bib: a PDF-to-novel reader styled like ranobes.net

## Context
You want a website where you upload a PDF and it shows up as a "novel" in a library grid, like ranobes.net. Clicking a book opens a ranobes-style reader that shows the content as reflowed text with the images in place, not as a PDF. The frontend is Angular + TypeScript and the backend is C#. The folder `C:\Users\karim\bib` is empty except for `.vs/`, so this is a greenfield project. It gets a git repo now so it can be deployed later.

**Decisions you made:** multiple users with private libraries · one chapter per PDF page · PostgreSQL plus files on disk · v1 reader has prev/next with a chapter list, font/theme settings, and saved reading progress. Search and tags are out of scope for v1.

**Toolchain found:** .NET SDK 10.0.203, Node 24.19 / npm 11, git 2.48, Docker 29.

## Architecture
```
Angular SPA (frontend/) ──/api (dev proxy; same origin in prod)──> ASP.NET Core 10 Web API (backend/)
                                                                ├── PostgreSQL (EF Core, Npgsql)
                                                                ├── /data/books/{bookId}/... (original PDF, cover, images)
                                                                └── BackgroundService + Channel queue → PdfProcessor
```

### Backend (`backend/Bib.Api`, a single project; tests in `backend/Bib.Api.Tests`)
- **Auth:** ASP.NET Core Identity with `MapIdentityApi<AppUser>()` and **cookie** auth (HttpOnly, SameSite=Strict). Same-origin cookies mean no JWT sitting in localStorage, so there's less XSS exposure. Routes: `/api/auth/register|login|logout|me`.
- **Data model (EF Core + migrations):**
  - `Book` (Id Guid, OwnerId, Title, Author?, PageCount, Status {Processing, Ready, Failed}, Error?, CoverPath?, CreatedAt). Indexed on `OwnerId`.
  - `Chapter` (Id, BookId, Number, Title = "Page N", `Blocks` as jsonb). A block is `{type:"p",text}` or `{type:"img",src,w,h}`. Unique index on (BookId, Number).
  - `ReadingProgress` (UserId, BookId, ChapterNumber, ScrollPercent, UpdatedAt). The primary key is (UserId, BookId).
- **Upload flow:** `POST /api/books` (multipart, max 100 MB). It checks the `%PDF-` magic bytes, saves the file as `/data/books/{guid}/source.pdf`, and creates a Book with status Processing. Then it puts the book on a `Channel<Guid>` queue and returns 202. A `BookProcessingWorker : BackgroundService` takes items off the queue. On startup, books still marked Processing are queued again.
- **PdfProcessor** uses **UglyToad.PdfPig** (Apache-2.0, pure .NET) and runs once per page:
  1. Words come from `NearestNeighbourWordExtractor`, are grouped into blocks with `DocstrumBoundingBoxes`, and are put in order with `UnsupervisedReadingOrderDetector`. A block becomes a paragraph after its line breaks are joined and hyphenation is repaired.
  2. Images come from `page.GetImages()`. It tries `TryGetPng`, falls back to the raw bytes for DCT (JPEG) images, and saves them as `images/p{n}-{i}.{ext}`.
  3. Paragraphs and images are merged in vertical position order. Lone page-number blocks near the top or bottom margin are dropped.
  4. If a page has no extractable text (a scanned page), the whole page is rendered as a PNG with **Docnet.Core** (PDFium, MIT) and becomes a single image block.
  5. The cover is page 1 rendered with Docnet as a thumbnail. Title and author come from the PDF metadata, with the filename as the fallback. Both can be edited later.
  - Encrypted or corrupt PDFs set the status to Failed and record a readable error.
- **API endpoints:** every one filters on the current user's ID and returns 404 for books the user doesn't own.
  - `GET /api/books` lists books, with progress.
  - `GET /api/books/{id}` returns book details and the chapter list.
  - `PATCH /api/books/{id}` updates the title or author.
  - `DELETE /api/books/{id}` deletes the book.
  - `GET /api/books/{id}/chapters/{n}` returns a chapter's blocks, prev/next, and the total count.
  - `GET /api/books/{id}/cover` returns the cover image.
  - `GET /api/books/{id}/images/{file}` returns an image. The filename is checked against `^p\d+-\d+\.(png|jpg)$`, so path traversal isn't possible.
  - `PUT /api/books/{id}/progress` saves reading progress.
- ProblemDetails for errors, plus a health check at `/health`. Connection strings and the storage path come from configuration or environment variables, and no secrets are committed.

### Proof-reading: checking each conversion against the PDF after it runs
Every conversion runs `PdfProcessor` then **`ConversionVerifier`** (in a separate class, called from the worker after processing). The verifier re-opens the original PDF on its own and compares every page with the stored chapter.
- **Provenance:** The processor records everything it deliberately removes or changes on each page: dropped page-number blocks and hyphens joined across line breaks. These go in `Chapter.Removed` (jsonb), so every deviation from the source can be explained.
- **Words (1:1):**
  - Source glyphs come from `page.Letters`, normalized with NFKC (which splits ligatures like ﬁ into "fi") and with whitespace dropped.
  - Output glyphs are all paragraph text plus `Removed`, normalized the same way.
  - **Hard check:** the two character multisets must be identical, so nothing is missing, invented, or duplicated.
  - **Word check:** the source word list (`ContentOrderTextExtractor`, dehyphenated the same way) must equal the output word list as a multiset.
  - **Order check:** reading order can legitimately differ in multi-column layouts. So order similarity is measured with LCS over the word sequence. Below 98% it's a Warning, not a Fail.
- **Images (1:1):**
  - The number of images in `page.GetImages()` must equal the number of image blocks on that page.
  - Each stored file must exist, decode, and have pixel width/height equal to the PDF image's `WidthInSamples`/`HeightInSamples`.
  - The SHA-256 of the extracted bytes is stored at write time. The verifier re-extracts the image from the PDF and the hashes must match.
- **Scanned pages:** the page has 0 letters, exactly 1 rendered image, and the image size matches the page render size.
- **Result:** `Book.Verification` (jsonb) holds a per-page status of Pass, Warning, or Fail with diffs (missing words, extra words, image mismatches) and a summary.
  - The book's final status is `Ready` + `Verified`, or `Ready` + `HasDifferences`. Reading is never blocked.
  - The UI shows a "✓ Verified 1:1" badge on the card and detail page, or "⚠ N pages differ". The Reader shows a dismissible note on affected pages listing what differs.
  - `GET /api/books/{id}/verification` returns the full report.

### Testing strategy (fidelity first)
- **Ground-truth fixture tests (`PdfProcessorFidelityTests`):** test PDFs are generated in code with PdfPig's `PdfDocumentBuilder`, so the exact expected words and image bytes are known. Cases cover:
  - plain paragraphs over several pages
  - hyphenated line breaks
  - ligatures and non-ASCII (ä ö ü ß, “quotes”)
  - two columns
  - JPEG and PNG images placed between paragraphs
  - an image-only page
  - page numbers in footers
  - an empty page
  - an encrypted PDF (expected Failed)
  
  The assertions check that the output words equal the expected words **exactly and in order**, that images are byte-identical for JPEG and pixel-identical for PNG, that blocks are in the right position relative to each other, and that the page count equals the chapter count.
- **Real-world corpus tests:** `backend/Bib.Api.Tests/Fixtures/*.pdf` holds a few small public-domain PDFs (novel text, an illustrated book, a scanned page). Each goes through processor → verifier, and the test asserts every page is Pass, plus golden-file snapshots of the extracted text.
- **Verifier mutation tests (`ConversionVerifierTests`):** a correct output is corrupted on purpose: a dropped word, an injected word, a duplicated paragraph, a missing image file, a swapped image, a resized image, a missing image block. Each test asserts the verifier reports Fail with the right diff. Clean output must report Pass, so there are no false positives.
- **API integration tests** (`WebApplicationFactory` + Testcontainers Postgres):
  - upload → processing → Ready + Verified
  - the verification endpoint
  - auth required
  - user A can't see user B's books or images (404)
  - the image filename regex blocks traversal
  - chapter prev/next bounds
  - upload validation (non-PDF, over 100 MB)
- **Frontend tests:** Reader navigation (buttons and keys), settings persistence, progress saving (debounced), rendering of the verification badge and page warning, the upload/polling state machine, and the auth guard.

### Frontend (`frontend/`, Angular latest: standalone components, signals, SCSS, no UI library)
- `core/`: `AuthService` (with a `me` signal), `authGuard`, an HTTP interceptor (`withCredentials`, 401 → /login), and `BooksApi`.
- **Pages:**
  - `/login` and `/register`.
  - `/` is the **Library**: a ranobes-like grid of cover cards showing title, author, page count, and a "Continue: Page N" badge. An upload card supports drag-and-drop with a progress bar. Cards that are Processing poll every 2 s until Ready or Failed.
  - `/book/:id` is the **Book detail** page: a ranobes-style info panel with the cover, title, author, and "Start reading" / "Continue reading", plus a paginated chapter list.
  - `/book/:id/read/:n` is the **Reader**. It's a centered text column that renders blocks (`<p>` and `<img loading="lazy">`), with prev/next buttons at the top and bottom, a chapter dropdown, and keyboard ←/→. A settings popover controls the theme (light, sepia, dark), font size, line height, and column width, all stored in localStorage as CSS variables. Progress is saved (debounced) on chapter change and scroll, and scroll position is restored when you come back.
- The styling imitates ranobes' layout: a dark top bar, a card grid, and a reader with a comfortable serif. It doesn't copy their assets or branding.
- `proxy.conf.json` sends `/api` to `http://localhost:5xxx`.

### Repo and deployment readiness
```
bib/
├── .gitignore  (.vs/, bin/, obj/, node_modules/, dist/, data/, .angular/, appsettings.*.local.json)
├── README.md   (dev setup + run instructions)
├── docker-compose.yml   (postgres:17 for dev; api + web services ready for later deploy)
├── backend/  Bib.sln, Bib.Api/, Bib.Api.Tests/, Dockerfile
├── frontend/ Angular app, Dockerfile (nginx serving dist and proxying /api)
└── .10x/     team state: spec, ADRs, decisions/<role>/pdf-reader.md, status.md, handoff.md
```

## Execution order (each step committed)
1. `git init`, add `.gitignore`, and create `.10x/` with the spec at `specs/2026-10-12-pdf-reader-design.md`, the ADRs (001 PdfPig+PDFium extraction, 002 cookie Identity auth, 003 jsonb blocks + filesystem images, 004 background processing queue), and the decisions files for cto, pm, architect, staff, em, and senior. Commit.
2. Scaffold the backend (`dotnet new webapi`, plus the xunit test project), add EF Core/Npgsql, Identity, and the entities, then the first migration. Add docker-compose with Postgres.
3. Write the fidelity fixture tests first (test-first), then build PdfProcessor until they pass.
3b. Build ConversionVerifier with its mutation tests, add the corpus tests, and wire processor → verifier into the worker.
4. Build the Books, chapters, images, and progress endpoints, with integration tests (`WebApplicationFactory` + Testcontainers Postgres) that include an ownership-isolation test.
5. Scaffold Angular and add core, auth, and the proxy.
6. Build the Library page with upload and polling, then Book detail, then the Reader with settings and progress.
7. Run the QA and security pass and write `.10x/reviews/`. Add Dockerfiles, record the devops/sre decisions, and finish the README.

## Verification
- `dotnet test backend/` must be all green. That covers the fidelity tests (exact words and order, identical images), the verifier mutation tests (every corruption is detected and clean output passes), the corpus tests (all pages Pass), and the API integration tests (auth, isolation, path validation, bounds).
- In the end-to-end run below, also check that the uploaded book shows "✓ Verified 1:1" and that `GET /api/books/{id}/verification` reports every page as Pass.
- `ng test` runs component and service specs for the reader navigation and settings persistence.
- End to end: `docker compose up -d postgres` → `dotnet run` (api) → `npm start` (frontend). In the built-in browser, register, upload a sample PDF containing images, and watch the card go from Processing to Ready. Open it, read pages 1→2 with the buttons and arrow keys, check that the images render, switch to the dark theme and a bigger font, reload, and confirm the settings and the "Continue: Page 2" badge persist. Then register a second user and confirm the library is empty and that the first user's book URL returns 404.
