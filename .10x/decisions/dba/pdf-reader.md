# pdf-reader — schema
- `Books` (Id uuid PK, OwnerId FK→AspNetUsers cascade, Status/VerificationStatus as strings, VerificationJson jsonb). Indexes: OwnerId, Status (startup re-queue).
- `Chapters` (Id bigint PK, BookId FK cascade, Number, BlocksJson jsonb, RemovedJson jsonb). Unique (BookId, Number) — also the lookup index for reader.
- `ReadingProgress` PK (UserId, BookId), both FKs cascade.
- Deleting a user cascades to books/chapters/progress; files under storage must be removed separately (only done by DELETE /api/books today — see tech debt).
- Re-conversion deletes chapters with ExecuteDelete before inserting → no duplicate-key risk.
- Backups: pg_dump of `bib` + the storage volume together.
