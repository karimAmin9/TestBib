# Staff engineer standards
- Backend: minimal APIs grouped per feature, nullable enabled, ProblemDetails, async all the way, TimeProvider for time.
- Core processing logic (processor, verifier) is pure and has no ASP.NET/EF dependency → unit-testable.
- Frontend: standalone components, signals, inject(), new control flow (@if/@for), no innerHTML for book content.
- Tests: xUnit + FluentAssertions-free plain Assert (no license concerns); Testcontainers for Postgres.
- Features: [pdf-reader](pdf-reader.md)
