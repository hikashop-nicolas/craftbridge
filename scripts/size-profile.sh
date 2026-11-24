# Sourced by the wasm build scripts: SIZE_CONFIG builds the crates that are not on the drawing path for size. The form-script
# engine (boa) is among them: scripts run about 15% slower and the module is about 1.6 MB smaller (docs/wasm-size.md).
SIZE_CONFIG=""
for c in deckcraft-pptx deckcraft-engine deckcraft-media deckcraft-av1 deckcraft-vp9 deckcraft-h264 deckcraft-hevc deckcraft-isobmff deckcraft-matroska deckcraft-ogg deckcraft-opus deckcraft-bitstream symphonia tiff image-webp image serde_json pdf-writer krilla pdfcraft-engine pdfcraft-edit pdfcraft-forms pdfcraft-xfa pdfcraft-js pdfcraft-sign pdfcraft-crypt pdfcraft-optimize pdfcraft-preflight pdfcraft-compare \
  pdfcraft-redact pdfcraft-annot pdfcraft-organize pdfcraft-print pdfcraft-a11y pdfcraft-xfdf pdfcraft-audit \
  boa_engine boa_parser boa_ast boa_gc boa_interner boa_string regress; do
  SIZE_CONFIG="$SIZE_CONFIG --config profile.release.package.$c.opt-level=\"s\""
done
