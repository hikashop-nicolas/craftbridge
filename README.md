# craftbridge

Browser bindings for the [ArtCraft](https://github.com/storytold) engines, so a web page with its
own interface can use them. It carries no interface of its own.

Today: the **PDF engine** of [PdfCraft](https://github.com/storytold/pdfcraft), compiled to
WebAssembly and driven from a Web Worker. A page opens a PDF from bytes, draws pages and tiles to
RGBA, lists and rewrites text blocks, moves, rotates, inserts and deletes pages, undoes and
redoes, and saves. It is the PDF engine of [Omnitext](https://hikashop-nicolas.github.io/omnitext/).

Status: early. The API will change until Omnitext ships on it.

## How the pieces fit

- The engine stays in the PdfCraft repository. The Rust side of this bridge, `apps/pdfcraft-wasm`,
  is proposed upstream; until it is merged it lives on the `carry` branch of
  [hikashop-nicolas/pdfcraft](https://github.com/hikashop-nicolas/pdfcraft), a thin fork rebased on
  upstream.
- `pdfcraft.rev` pins the exact fork commit this repository builds. A build is reproducible: same
  commit, same Cargo.lock, same wasm-bindgen.
- `npm run build:wasm` checks out that commit, builds the wasm and writes `wasm/pdf/`. It needs a
  Rust toolchain with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` at the version in the
  engine's Cargo.lock, and (optionally) `wasm-opt`.
- `src/pdf/` is the TypeScript side: a worker that owns the wasm module and a small promise API.

## Fonts

The engine draws added text, headers, footers, watermarks and edited text in Cyrillic, Greek, Japanese and
Chinese from fonts built into the wasm, as vector glyphs (no font file ends up in the PDF):

- Latin, Greek and Cyrillic: Inter, bundled with the engine.
- Japanese: BIZ UDPGothic from [craft-fonts](https://github.com/storytold/craft-fonts), pinned in `craft-fonts.rev`.
- Simplified Chinese: `fonts/omnitext-hans/`, a 1.5 MB subset of Noto Sans CJK SC (GB 2312: 6763 hanzi and
  682 symbols), made by `scripts/make-hans-subset.py`. SIL OFL 1.1, renamed as the licence asks.
- Arabic, Hebrew, Thai and Devanagari come from craft-fonts too.

`npm run build:wasm` assembles these into the engine's font input. Korean and the other scripts have no face yet.

## Use

```ts
import { openPdf } from "craftbridge/pdf";

const pdf = await openPdf(bytes, { password });
const { width, height, rgba } = await pdf.render(0, 2);
await pdf.editTextBlock(0, 0, "New text");
const saved = await pdf.save();
pdf.close();
```

## Licence

MIT. The engines have their own licences (PdfCraft is MIT OR Apache-2.0). The ArtCraft name and
logos are trademarks of their owners and are not used here.

## Keeping the engine fork current

The engine is PdfCraft's `main` plus our `carry` branch (fixes not yet merged upstream). `scripts/sync-upstream.sh` merges
upstream's main into a scratch `carry-next`, builds the wasm and runs the tests of the crates we change; the weekly
workflow `.github/workflows/upstream-sync.yml` runs it and opens an issue when it conflicts or fails. `--push` publishes
`carry-next` to the fork; taking it means fast-forwarding `carry`, putting the new hash in `pdfcraft.rev` and running
`npm test` against a fresh `npm run build:wasm`. Sending our patches upstream keeps the merge small.

