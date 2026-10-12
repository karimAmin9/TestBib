# ADR-005: Post-conversion proof-reading (ConversionVerifier)

**Status:** Accepted
**Date:** 2026-10-12
**Feature:** pdf-reader

## Context
The user requires the produced words and images to match the PDF 1:1, checked both in tests and after every real conversion.

## Decision
After PdfProcessor, a separate ConversionVerifier re-opens the PDF independently and per page checks:
- character multiset of source letters (NFKC, no whitespace) == output text + recorded removals (`Chapter.Removed`),
- word multiset equality,
- word-order similarity via LCS (Warning below 98%),
- image count, file existence, decoded dimensions, SHA-256 of re-extracted bytes.
Result stored as `Book.Verification` (jsonb) and surfaced in UI. Reading is never blocked.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Tests only | Cheap | Real PDFs differ from fixtures | User asked for runtime check |
| OCR comparison of rendered page | Catches visual-only text | Slow, noisy, false positives | Text layer comparison is exact |

## Consequences
- Positive: every deviation is explained or flagged.
- Negative: processor must record all intentional removals (page numbers, hyphens), adds processing time (~1 extra parse).
