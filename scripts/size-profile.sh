# Sourced by the wasm build scripts: SIZE_CONFIG builds the crates that are not on the drawing path for size.
SIZE_CONFIG=""
for c in deckcraft-pptx deckcraft-engine deckcraft-media deckcraft-av1 deckcraft-vp9 deckcraft-h264 deckcraft-hevc deckcraft-isobmff deckcraft-matroska deckcraft-ogg deckcraft-opus deckcraft-bitstream symphonia tiff image-webp image serde_json pdf-writer krilla pdfcraft-engine pdfcraft-edit pdfcraft-forms pdfcraft-xfa pdfcraft-js pdfcraft-sign pdfcraft-crypt pdfcraft-optimize pdfcraft-preflight pdfcraft-compare; do
  SIZE_CONFIG="$SIZE_CONFIG --config profile.release.package.$c.opt-level=\"s\""
done
