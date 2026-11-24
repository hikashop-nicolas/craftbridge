# The engines' wasm size

What makes up `wasm/pdf/pdfcraft_wasm_bg.wasm` and `wasm/deck/deckcraft_wasm_bg.wasm`, what has been trimmed, and what could be.
Measured on PdfCraft's carry at `3260713e4` (upstream main of 2026-11-23), built with
`scripts/build-wasm.sh`.

## Where the bytes are

The module is 26,200,912 bytes after `wasm-opt -Oz`: 19.0 MB of code and 7.2 MB of data.

Code by area, from the function names of the unoptimised build (23.0 MB of code before
`wasm-opt`; shares hold after it):

| Area | Code | Share |
|---|---|---|
| JavaScript interpreter for form scripts (boa) | 4.05 MB | 17.6% |
| Generic Rust (core, alloc, hash maps) | 4.05 MB | 17.6% |
| Image codecs (craft-image-codecs, tiff, exr, zune, image) | 3.96 MB | 17.2% |
| PDF parsing and rendering (hayro, craft-pdf) | 3.14 MB | 13.6% |
| Fonts and text shaping (skrifa, harfrust) | 1.72 MB | 7.5% |
| Signing and crypto | 0.90 MB | 3.9% |
| Engine and wasm glue | 0.66 MB | 2.9% |
| Text and object editing | 0.64 MB | 2.8% |
| XFA forms | 0.53 MB | 2.3% |
| Redaction | 0.46 MB | 2.0% |
| Annotations, pages, AcroForms, preflight, XFDF | 1.31 MB | 5.8% |
| Other | 1.61 MB | 7.0% |

Data (7.2 MB):

| What | Size |
|---|---|
| Noto Sans Arabic | 845 KB |
| Inter Regular and SemiBold | 832 KB |
| Noto Sans Devanagari | 278 KB |
| Noto Sans Thai | 219 KB |
| Dancing Script (typed signatures) | 134 KB |
| Noto Sans Hebrew | 66 KB |
| ICU line-break dictionaries for Thai, Lao, Khmer and Burmese (`LineSegmenter::new_dictionary`) | 1.77 MB by ICU's own count |
| The rest (Unicode tables, CMaps, ICC profiles, encodings) | about 3 MB |

Every craftbridge call Omnitext makes reaches the engine: there is no unused export to drop.
Size comes from what each feature pulls in.

## Cheap wins

Each measured by building the module with craftbridge's recipe (fat LTO, `wasm-bindgen`,
`wasm-opt -Oz`), against today's 26,200,912 bytes. Speed is the craftbridge corpus tests (open
and draw every page, edit, save, on 7 real PDFs, two runs each) and a busy form script.

| Change | Size | Saving | Speed | Where |
|---|---|---|---|---|
| Leave out the image codecs PdfCraft never accepts (EXR, WebP, JPEG XL, DDS, DICOM, ...) | 25,256,711 | 945,663 bytes | same | craft-libs features, then one PdfCraft line: [storytold/craft-libs#3329](https://github.com/storytold/craft-libs/pull/3329), [#3330](https://github.com/storytold/craft-libs/pull/3330) |
| Line breaking with ICU's LSTM models (`new_lstm`, 310 KB) instead of its dictionaries | 24,749,043 | 1,451,869 bytes | same | `crates/edit/src/linebreak.rs`, `icu_segmenter` feature `lstm` |
| Arabic, Thai and Hebrew faces loaded at run time like the CJK ones (Devanagari left out: nothing in the module can use it) | | about 1.4 MB | same | PdfCraft `crates/fonts/build.rs` (`CRAFT_FONTS_EXTERNAL`), craftbridge `src/pdf/fonts.ts` and `copy-fonts.sh` |
| `opt-level = "s"` also for the script engine (boa, regress) and the features off the drawing path (redaction, annotations, pages, signing, print, accessibility, XFDF, audit) | | about 1.6 MB | drawing same; busy script 15% slower (0.53 s against 0.45 s) | craftbridge `scripts/size-profile.sh` |
| The three rows above together | 21,665,128 | **4,535,784 bytes (17.3%)** | drawing and editing same; scripts 15% slower | |
| `opt-level = "z"` for every crate | 20,036,821 | 6,164,091 bytes | 1.5 to 2.2 times slower (the 55-page NIST report draws in 2.4 s against 1.1 s) | ruled out |

With the codec PR as well, the module would be about 20.7 MB.

Notes:
- The fonts change also removes a duplicate: craftbridge already ships `NotoSansArabic.ttf` and
  `NotoSansHebrew-Regular.ttf` as files in `wasm/fonts/` (for scoredit's PDF export) while the
  same bytes sat in the module. The host still fetches every external face before opening a PDF
  (`pdfFontFaces`); fetching a face only when a document needs its script would save the
  download too, but needs the engine to ask for it.
- The same change makes the OCR/stamp text planner (`crates/fonts/src/plan.rs`) see faces added
  at run time; it read only the built-in list, so it missed the host-supplied CJK faces too.
- LSTM line breaking is ICU's model-based segmenter for the same four scripts. It can break a
  little differently from the dictionaries on rare words; it is what ICU calls the choice for
  size-constrained builds.
- All 68 craftbridge tests pass on the combined module with the four faces supplied at run time.

## Bigger idea: run form scripts in the WebView's own JavaScript

The largest single area is boa, the JavaScript interpreter PdfCraft embeds to run the scripts
inside PDF forms (Acrobat JavaScript for AcroForms, and XFA's scripts). Omnitext already runs
in a JavaScript engine, so in principle those scripts could run there and the interpreter could
go, saving about 4 MB of code before optimisation (probably 2.5 to 3 MB after).

What it would take:

1. **A sandbox.** A PDF's scripts are written by whoever made the PDF. Inside boa they see only
   the objects the engine gives them. In the browser's engine they would see the network,
   storage and the page unless isolated: a sandboxed iframe, or a Worker under a strict content
   policy. ShadowRealm, the proper tool, is not in browsers yet.
2. **Synchronous calls.** Scripts read and write the document as they go
   (`getField("total").value`, `this.resolveNode(...)`, `xfa.host.messageBox`), and each call must
   return at once from the engine's document model in the wasm. That works on the wasm's own
   thread, which is the hardest place to sandbox, or across threads with `SharedArrayBuffer` and
   `Atomics.wait`, which needs cross-origin isolation headers (GitHub Pages cannot send them; a
   service worker can add them).
3. **The bridge.** About 6,800 of the 20,300 lines of `crates/js` call boa directly, with no
   interface for another engine. FormCalc, XFA's other script language, is PdfCraft's own Rust
   and would stay.
4. **Behaviour.** Time limits, re-entrancy, error texts and calculation order are tuned against
   the XFA corpus (`~/dev/xfa-corpus`); another engine would need that measured again.
5. **Upstream.** Done in our fork alone it would be thousands of lines to carry and rebase, the
   opposite of keeping carry close to upstream. The realistic form is an upstream "script
   backend" interface in `pdfcraft-js`: boa by default, a host-provided backend for web builds.
   Upstream's own web build is close to Cloudflare Pages' 25 MiB file limit, so they may want it.

Not started; the cheap wins come first.

## The slides engine (DeckCraft)

15,414,436 bytes before; 14,196,380 since DeckCraft's carry `f8821b07` (craftbridge `2f6af52`): the engine
takes a video's poster frame from the host (`poster` on `insert.video` and `media.posterFrame`), and the module is
built without its `video-posters` feature, which leaves the H.264, HEVC, VP9 and AV1 decoders out. Omnitext draws
the frame from a `<video>`. Media playback was already the host's.

Code before `wasm-opt`, by crate, 19.1 MB in all: the engine and document model 3.5 MB, generic Rust 3.0 MB, the
serde code generated for the command protocol's types 2.1 MB (one encoder and decoder per type, not the JSON
library itself), two font and shaping stacks 2.5 MB (skrifa/harfrust, and ttf-parser/rustybuzz through krilla),
image codecs 1.9 MB (PNG, JPEG, GIF, BMP, TIFF, WebP: all formats PowerPoint itself accepts).

Then 13,333,678 bytes since DeckCraft's carry `eb0d3b8d`: TIFF and WebP decoding is a `tiff-webp` feature of
deckcraft-render, left out of the slides module. `media.undecodable` lists the pictures the host should convert and
`media.setDisplay` takes a PNG or JPEG copy for each, which drawing, sizing, export, background removal and artistic
effects use while the file keeps the original bytes. Omnitext converts them when a deck opens and after slides are
reused or pasted; pictures it inserts are already PNG or JPEG.

Decoding every picture in the host instead was looked at and set aside: decoding runs through drawing, every
pixel-editing command, PDF export (in craft-libs' PDF code) and metafiles, all synchronously, and the encoders
(compress pictures, image and GIF export) share code with the decoders; perhaps 1 MB more, for a large refactor.

