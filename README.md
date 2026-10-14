# Bib: your PDFs as readable novels

Add a PDF and it shows up as a book in your library, laid out like a web-novel site. Open it and you read it
as reflowed text with the images in place, not as a PDF.
Every conversion is **proof-read automatically** against the original PDF. The badge on each book shows whether
the text and images matched 1:1.

Everything runs **on your device**: the PDF is converted in the browser and the library is stored there. Nothing is
uploaded, and there is no account.

| Part       | Tech |
|------------|------|
| App        | Angular 22 (standalone components, signals), TypeScript, SCSS |
| Conversion | `backend/Bib.Conversion` (C#) running as .NET 10 WebAssembly in a Web Worker: [PdfPig](https://github.com/UglyToad/PdfPig) for text, layout and images, [pdf.js](https://mozilla.github.io/pdf.js/) for covers and drawn pages |
| Storage    | IndexedDB in the browser (books, pages, images, original PDFs, check reports) |
| Legacy server | ASP.NET Core 10 API + PostgreSQL 17 (the previous version, still used by the backend tests; to be removed) |

## How it works

1. **Add:** the PDF is stored on the device and the book appears right away as *Converting…*. Conversions run
   one at a time in the background and resume if the app was closed in the middle.
2. **Convert:** `PdfProcessor` turns every PDF page into one chapter ("Page N") made of paragraphs and images,
   in reading order. Hyphenated line breaks are joined and page numbers in the margins are dropped. Both are
   *recorded* rather than silently lost. Images are extracted unchanged (JPEG passthrough, PNG otherwise).
   Pages that contain only vector drawings are rendered to PNG.
3. **Proof-read:** `ConversionVerifier` opens the PDF again on its own and checks every page against what was
   stored:
   - **Characters:** the PDF's text has exactly the same characters as the output plus the recorded removals.
     Ligatures are normalized with NFKC; nothing may be missing or added. A mismatch is a **Fail**.
   - **Words:** the word multisets match. A mismatch here alone is a **Warning**.
   - **Order:** word order is ≥ 98% identical, measured by LCS. Below that it's a **Warning**, since multi-column
     layouts can legitimately differ.
   - **Images:** the counts match, every file exists and decodes, its pixel size equals the PDF image, and its
     SHA-256 equals a fresh re-extraction from the PDF. Any mismatch is a **Fail**.

   The book is readable as soon as it is converted; the check runs afterwards (about a third of the time) and
   the result appears as *✓ Verified 1:1*, *⚠ N pages with notes*, or *⚠ N pages differ*. Affected pages show a
   note in the reader.
4. **Read:** the reader has prev/next buttons, a page dropdown, ←/→ keys, light/sepia/dark themes, font size,
   line spacing and column width. Reading progress is saved per book ("Continue: Page N").

## Development

Prerequisites: .NET SDK 10 and Node 24 for the app; Docker Desktop only for the backend integration tests.

Install the packages and build the conversion engine into `frontend/public/engine` (again after changing
`backend/Bib.Conversion`):

```bash
npm --prefix frontend install
```

```bash
npm --prefix frontend run engine
```

Start the dev server on http://localhost:4200:

```bash
npm --prefix frontend start
```

### Legacy server (being retired)

The previous version ran conversion and storage on a server. It is still in the repository (`backend/Bib.Api`,
`docker-compose.yml`) and covered by the backend tests, but the app no longer uses it. To run it anyway:
`docker compose up -d postgres`, then `dotnet run --project backend/Bib.Api` (http://localhost:5219).

### Two setups, two databases
Dev mode uses the database `bib_dev` and stores files in `backend/Bib.Api/data`; the Docker stack uses the database `bib` and the `bookdata` volume. Books uploaded in one setup are therefore not visible in the other.

### Tests

Run the backend tests. Integration tests start a throw-away Postgres container, so Docker must be running:

```bash
dotnet test backend/Bib.slnx
```

Run only the PDF fidelity, verifier and unit tests, which don't need Docker:

```bash
dotnet test backend/Bib.slnx --filter "FullyQualifiedName!~Integration"
```

Run the frontend tests (Vitest):

```bash
npm --prefix frontend test -- --watch=false
```

| Suite | What it proves |
|-------|----------------|
| `PdfProcessorFidelityTests` | PDFs generated in code with known content come out word-for-word, in order, with byte- or pixel-identical images |
| `CorpusTests` | Browser-printed PDFs (`Fixtures/corpus`, real fonts, ligatures, umlauts, columns, images) reproduce the source text exactly, and every page passes verification |
| `ConversionVerifierTests` | Mutation tests: a dropped, injected or changed word, a duplicated paragraph, a missing, swapped, resized or corrupted image, a missing or extra chapter are all detected, and clean output passes |
| `BooksApiTests` | Auth required, users isolated from each other, path traversal blocked, upload validation, progress, rename/delete (legacy server) |
| `ConversionJsonTests` | Stored JSON keeps exactly the earlier format |
| `library.service.spec` (frontend) | On-device library: background conversion, readable before the check, resume after closing the app, retry, delete mid-conversion, validation |
| `bib-engine.spec` (frontend) | Engine worker protocol: render requests, progress, errors, one conversion at a time |
| `app-updates.spec`, `book-cover.spec` (frontend) | Update prompt; covers never show a broken image while loading |

The corpus PDFs are regenerated with `backend/Bib.Api.Tests/Fixtures/corpus/generate.ps1` (Windows + Edge).

### Database migrations

```bash
cd backend && dotnet tool restore && dotnet ef migrations add <Name> --project Bib.Api -o Data/Migrations
```

## Deployment (GitHub Pages)

Every push to `main` runs all tests and, if they pass, publishes the app to
**https://karimamin9.github.io/TestBib/** (`.github/workflows/pages.yml`). Pull requests run the tests only.
One-time setup: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The site is static: no server, no account, no cost. The service worker caches the app and the conversion engine on
the first visit, so it works offline afterwards. Books never leave the device.

### On your phone (Android)

1. Open https://karimamin9.github.io/TestBib/ in Chrome.
2. Menu **⋮ → Install app** (or "Add to home screen").
3. Open Bib from the home screen. It works offline from now on.

Books live in the browser storage of that app. Uninstalling it, or clearing Chrome's data for the site, deletes them.

### Updates

Push to `main`; a few minutes later the new version is live. The app downloads it in the background and shows
**"A new version of Bib is ready" → Update now**. A conversion that was running restarts by itself after the update.

### Rollback

Revert the commit on `main`, or re-run the workflow for an earlier commit (Actions tab). Phones receive it as the
next update. Stored books are not affected; the storage schema only migrates forward, so keep schema changes additive.

### Try the production build locally

```bash
npm --prefix frontend run build:pages
```

```bash
npm --prefix frontend run serve:pages
```

Then open http://localhost:4300/TestBib/. localhost counts as a secure origin, so installing, offline use and updates
work as on the real site. Run `npm --prefix frontend run engine` first if the engine was never built.

### Legacy Docker stack

`docker compose --profile full up -d --build` still builds the previous server version (nginx + API + Postgres on
`127.0.0.1:8080`). It is no longer maintained and will be removed. Never run `docker compose down -v` while it holds
books you want to keep.

## Project notes

Design decisions, ADRs, the QA and security reviews, and the runbook are in [`.10x/`](.10x/).
