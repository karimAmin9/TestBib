# pdf-reader — breakdown
1. Repo + state + ADRs
2. Backend scaffold, EF model, Identity, migration, docker-compose postgres
3. Fidelity fixture tests → PdfProcessor
4. ConversionVerifier + mutation tests + corpus tests; worker wiring
5. Endpoints + integration tests
6. Angular scaffold, auth, proxy
7. Library + upload/polling, Book detail, Reader + settings + progress, verification UI
8. QA/security pass, Dockerfiles, README
Risks: PDF layout heuristics (mitigated by verifier), Docnet native libs on Windows/Linux, Testcontainers needs Docker running.
