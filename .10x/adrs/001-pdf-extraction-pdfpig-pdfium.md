# ADR-001: PDF extraction with PdfPig + PDFium (Docnet) fallback

**Status:** Accepted
**Date:** 2026-10-12
**Feature:** pdf-reader
**Author:** 10x-Team (Architect + Staff Engineer)

## Context
We need text with reading order and embedded images out of arbitrary PDFs, from C#. Pages without text (scans) must still be readable. License must allow future commercial deployment.

## Decision
Use UglyToad.PdfPig (Apache-2.0) for letters/words/blocks/reading order and image extraction. Use Docnet.Core (PDFium, MIT/BSD) only to render whole pages to PNG (scanned pages, cover thumbnail).

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| iText 7 | Mature | AGPL / commercial license | Licensing |
| PyMuPDF sidecar | Best extraction quality | AGPL, second runtime | Licensing + ops complexity |
| Render pages as images only | Trivial, 100% visual fidelity | Not text, defeats the purpose | Requirement is text |

## Consequences
### Positive
- Pure .NET text path, permissive licenses, word positions available for verification.
### Negative
- Reading order heuristics can fail on complex layouts; some exotic image encodings (JBIG2, CCITT) can't be converted to PNG.
### Risks
- Mitigated by ConversionVerifier (ADR-005) flagging differences, and by page-render fallback for undecodable images.

## Dependencies
- Native pdfium binaries shipped by Docnet must be present in the Docker image (linux-x64).
