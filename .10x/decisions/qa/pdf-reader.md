# pdf-reader: test strategy
- **Fidelity first:**
  - ground-truth generated PDFs (exact words and order, byte- or pixel-identical images)
  - a browser-printed corpus with real fonts
  - verifier mutation tests (every corruption detected, no false positives)
- **API integration** with a real Postgres (Testcontainers) for auth, isolation, path traversal, validation and rate limiting.
- **Frontend:** Vitest component tests for reader navigation, keys, progress, settings and the verification note; library polling and upload; guards; the verification badge.
- **Quality gate:** `dotnet test backend/Bib.slnx` and `npm --prefix frontend test -- --watch=false` are green, and every corpus page passes verification.
- When changing layout heuristics, regenerate the corpus with `backend/Bib.Api.Tests/Fixtures/corpus/generate.ps1`.
- Report: `.10x/reviews/2026-10-12-qa-report.md`
