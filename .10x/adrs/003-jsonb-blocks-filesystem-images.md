# ADR-003: Chapter content as jsonb blocks; binaries on filesystem

**Status:** Accepted
**Date:** 2026-10-12
**Feature:** pdf-reader
**Author:** 10x-Team (Architect + DBA)

## Context
One chapter per PDF page. Content is an ordered mix of paragraphs and images.

## Decision
`Chapter.Blocks` is a jsonb array of `{type:"p",text}` / `{type:"img",src,w,h,sha256}`. Source PDF, cover and images live under `{Storage:Root}/books/{bookId}/`, served through authorized endpoints.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Pre-rendered HTML per chapter | Simple to render | XSS surface, harder to verify | Structured data is safer + verifiable |
| Images as bytea in Postgres | One backup unit | DB bloat, slow | Filesystem is cheaper; object storage later |
| Normalized Block table | Queryable | Many rows, no need to query blocks | YAGNI |

## Consequences
- Positive: Angular renders text via interpolation (no innerHTML); verifier compares structured data.
- Negative: two things to back up (DB + data volume).
- Risks: swap filesystem for S3-compatible storage behind `IBookStorage` when scaling out.
