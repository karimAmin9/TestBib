# pdf-reader — implementation approach
- Processor: per page, words via NearestNeighbourWordExtractor → DocstrumBoundingBoxes → UnsupervisedReadingOrderDetector; each block's text lines joined with spaces; line ending in '-' followed by lowercase letter → join and record '-' removal. Page-number artifact = block whose text is only digits (or roman numerals) and lies in top/bottom 10% of page → removed + recorded.
- Images: PdfPig IPdfImage.TryGetPng; else if DCTDecode → RawBytes as .jpg; else render page fallback. Block position by image Bounds.Top; text block by BoundingBox.Top; sort desc by top.
- Tricky parts: hyphen join must apply identically in verifier word list; NFKC on both sides; empty pages produce chapter with zero blocks (still a chapter).
