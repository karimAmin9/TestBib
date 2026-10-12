# Bib: your PDFs as readable novels

Upload a PDF and it shows up as a book in your library, laid out like a web-novel site. Open it and you read it
as reflowed text with the images in place, not as a PDF.
Every conversion is **proof-read automatically** against the original PDF. The badge on each book shows whether
the text and images matched 1:1.

| Part      | Tech |
|-----------|------|
| Frontend  | Angular 22 (standalone components, signals), TypeScript, SCSS |
| Backend   | ASP.NET Core 10 minimal API, EF Core, ASP.NET Core Identity (cookie auth) |
| PDF       | [PdfPig](https://github.com/UglyToad/PdfPig) (text, layout, images) + PDFium via Docnet (page rendering) |
| Database  | PostgreSQL 17 |

## How it works

1. **Upload:** `POST /api/books` stores the PDF and queues it. The card shows *Converting…*.
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

   The result appears as *✓ Verified 1:1*, *⚠ N pages with notes*, or *⚠ N pages differ*. Affected pages show a
   note in the reader. The full report is at `GET /api/books/{id}/verification`.
4. **Read:** the reader has prev/next buttons, a page dropdown, ←/→ keys, light/sepia/dark themes, font size,
   line spacing and column width. Reading progress is saved per book ("Continue: Page N").

## Development

Prerequisites: .NET SDK 10, Node 24, Docker Desktop.

Start PostgreSQL:

```bash
docker compose up -d postgres
```

Run the API on http://localhost:5219. Migrations run automatically on startup:

```bash
dotnet run --project backend/Bib.Api
```

Install the frontend packages, then start the dev server on http://localhost:4200, which proxies `/api` to the API:

```bash
npm --prefix frontend install
```

```bash
npm --prefix frontend start
```

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
| `BooksApiTests` | Auth required, users isolated from each other, path traversal blocked, upload validation, progress, rename/delete |

The corpus PDFs are regenerated with `backend/Bib.Api.Tests/Fixtures/corpus/generate.ps1` (Windows + Edge).

### Database migrations

```bash
cd backend && dotnet tool restore && dotnet ef migrations add <Name> --project Bib.Api -o Data/Migrations
```

## Deployment

The whole stack builds into two containers plus Postgres:

```bash
POSTGRES_PASSWORD=change-me docker compose --profile full up -d --build
```

nginx serves the Angular app on port 8080 and proxies `/api` to the API on the same origin, which the
`SameSite=Strict` auth cookie requires. Put a TLS-terminating proxy in front of it in production. The API honours
`X-Forwarded-Proto`, so cookies are marked `Secure` behind HTTPS.

Configuration (environment variables):

| Variable | Purpose |
|----------|---------|
| `ConnectionStrings__Default` | PostgreSQL connection string |
| `Storage__Root` | Directory for PDFs, covers and extracted images (mount a volume) |
| `Database__MigrateOnStartup` | `true` by default |

Back up **both** the Postgres volume and the storage volume.

## Project notes

Design decisions, ADRs, the QA and security reviews, and the runbook are in [`.10x/`](.10x/).
