# pdf-reader — cross-cutting
- Ownership filter in one helper (`db.Books.Owned(userId)`), used by every endpoint.
- Text normalization (NFKC, whitespace) lives in one `TextNormalizer` used by both processor and verifier so they can't drift.
- Logging: structured ILogger with BookId scope in worker.
