# pdf-reader — system design
See spec `.10x/specs/2026-10-12-pdf-reader-design.md`.
## Components
- `Auth` — Identity API endpoints (cookie). ADR-002
- `Books` endpoints — upload/list/detail/patch/delete/chapter/cover/images/progress/verification
- `IBookStorage` (FileBookStorage) — paths under `{root}/books/{id}`
- `ProcessingQueue` (Channel<Guid>) + `BookProcessingWorker` — ADR-004
- `PdfProcessor` — pure: (pdf bytes, output dir) → ProcessedBook (chapters, blocks, removals, metadata)
- `ConversionVerifier` — pure: (pdf bytes, chapters, image dir) → VerificationReport. ADR-005
- `PageRenderer` (Docnet) — page → PNG
## Failure modes
- Encrypted/corrupt PDF → Failed with message. Worker crash mid-book → re-enqueued on startup (idempotent: deletes previous chapters/images first).
- Undecodable image → page rendered as image fallback, recorded as removal-free image block; verifier counts it as "rendered" not "missing".
