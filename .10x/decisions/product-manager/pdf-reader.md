# pdf-reader — scope
## User stories (v1)
1. As a user I register/login and see only my own library.
2. I upload a PDF; it appears as a novel card (cover, title, author, pages) and shows processing state.
3. I open a book and see a ranobes-style detail page with chapter list ("Page N", one chapter per PDF page).
4. I read a chapter as reflowed text with images inline; prev/next, chapter dropdown, ←/→ keys.
5. I adjust theme (light/sepia/dark), font size, line height, width — persisted in browser.
6. My reading progress is saved; card shows "Continue: Page N".
7. I see whether the conversion was verified 1:1 against the PDF; differences are listed per page.
8. I can rename / delete a book.
## Out of scope v1
Search, tags/genres, public sharing, comments, ratings, OCR of scanned pages.
## Success criteria
- Text PDFs: 100% of pages Pass verification on fixture + corpus tests.
- Upload of a 300-page text PDF processed < 60 s on dev machine.
