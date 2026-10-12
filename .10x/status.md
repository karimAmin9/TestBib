# Status: pdf-reader
**Phase:** Delivery Complete (local + Docker verified; public hosting not yet set up)

| # | Task | Status |
|---|------|--------|
| 1 | Repo, state, ADRs 001-005 | done |
| 2 | Backend scaffold, EF, Identity, migration | done |
| 3 | Fidelity tests + PdfProcessor | done |
| 4 | ConversionVerifier, mutation + corpus tests, worker | done |
| 5 | Endpoints + integration tests | done |
| 6 | Angular scaffold + auth | done |
| 7 | Library / Detail / Reader + verification UI | done |
| 8 | QA, security hardening, Docker, README | done |

**Tests:** backend 83/83, frontend 29/29 green.
**Release readiness:** ready for private/self-hosted use. Before public internet: see security review findings 1-5, add CI and TLS.
