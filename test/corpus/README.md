# Test corpus

Real documents, none made by us, that the engine must keep opening, drawing, reading and saving whatever
the upstream PdfCraft does next. `test/corpus.test.ts` runs every one of them through the real wasm engine
(`npm run build:wasm` first; without it the suite skips, like `wasm.test.ts`).

`manifest.json` records where each file comes from, its licence, its SHA-256 (the test fails if a file
changes) and what it exercises. Only documents whose licence can be proven from the source belong here:
public domain, Creative Commons, or a permissive open-source licence. Never a document from an Adobe product,
a company's brochure or anything "free to download".

To add one: download it, read its licence off the document or its source page, add a manifest entry and a
row in `test/corpus.test.ts` (page count, a phrase, an ink range read from a first run you checked by eye).
