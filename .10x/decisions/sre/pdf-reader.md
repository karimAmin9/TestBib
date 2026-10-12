# pdf-reader: operations

## SLOs (initial, single-instance personal deployment)
- Availability of reading endpoints: 99% monthly.
- Conversion: 95% of PDFs under 100 pages are Ready within 60 s.
- Verification: at least 95% of text-based PDFs end as `Verified`. A drop in this rate signals a regression in layout heuristics.

## Signals
- `GET /health` (API, also proxied by nginx).
- Structured logs from `BookConversionService`, scoped with `BookId`:
  - "Converted {Pages} pages; verification {Status} ({Issues} pages with issues)"
  - warnings for "Conversion failed"
- DB queries:
  - stuck books: `select count(*) from "Books" where "Status"='Processing' and "CreatedAt" < now() - interval '15 minutes'`
  - quality: `select "VerificationStatus", count(*) from "Books" group by 1`

## Runbook
| Symptom | Action |
|---|---|
| Books stuck in "Converting…" | Check API logs for the BookId. Restarting the API re-queues all Processing books automatically. |
| Book "Failed" | The error message is shown on the card. Password-protected or damaged PDFs are expected failures. For "Unexpected error", check the logs (stack trace) and reproduce with the PDF in a fixture test. |
| Many "pages differ" | Open `GET /api/books/{id}/verification` and add the PDF (if shareable) to the corpus. Fix the heuristics, then delete and re-upload. |
| Everyone logged out after deploy | The data-protection keys volume (`{Storage:Root}/keys`) was lost or isn't mounted. |
| Disk filling up | Storage grows with the uploaded PDFs plus extracted images (`{Storage:Root}/books`). Deleting a book removes its folder. |

## Backups
Back up `pg_dump bib` and the `bookdata` volume together, nightly. Restore both from the same point in time.
