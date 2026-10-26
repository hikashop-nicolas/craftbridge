#!/bin/sh
# Builds the PDF engine to wasm from the exact fork commit in pdfcraft.rev and writes wasm/pdf/.
# Needs: git, sha256sum or shasum, a Rust toolchain with the wasm32-unknown-unknown target, wasm-bindgen-cli at the
# version in the engine's Cargo.lock, and (optionally) wasm-opt from binaryen.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
rev=$(tr -d '[:space:]' < "$here/pdfcraft.rev")
src="${PDFCRAFT_SRC:-$here/vendor/pdfcraft}"

# A folder that already holds build output (a CI cache of target/) is not a clone yet: start the repository in place.
if [ ! -d "$src/.git" ]; then
  git init --quiet "$src"
  git -C "$src" remote add origin https://github.com/hikashop-nicolas/pdfcraft.git
fi
git -C "$src" fetch --quiet origin "$rev"
git -C "$src" checkout --quiet --detach "$rev"

want=$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/[^0-9.]/, "", $0); print; exit }' "$src/Cargo.lock")
have=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)
if [ "$want" != "$have" ]; then
  if [ "${INSTALL_WASM_BINDGEN:-}" = 1 ]; then
    cargo install wasm-bindgen-cli --version "$want" --locked --force
  else
    echo "wasm-bindgen-cli $have does not match the engine's $want (cargo install wasm-bindgen-cli --version $want --locked, or set INSTALL_WASM_BINDGEN=1)" >&2
    exit 1
  fi
fi

# The fonts the engine draws added text and page marks with: craft-fonts at its pinned commit (the Japanese
# face, and the Arabic, Hebrew, Thai and Devanagari faces the web build keeps), plus our Simplified Chinese
# subset, which the engine's build script embeds because it is small.
fonts_rev=$(tr -d '[:space:]' < "$here/craft-fonts.rev")
fonts_src="${CRAFT_FONTS_SRC:-$here/vendor/craft-fonts}"
if [ ! -d "$fonts_src/.git" ]; then
  git init --quiet "$fonts_src"
  git -C "$fonts_src" remote add origin https://github.com/storytold/craft-fonts.git
fi
git -C "$fonts_src" fetch --quiet origin "$fonts_rev"
git -C "$fonts_src" checkout --quiet --detach "$fonts_rev"
input="$here/vendor/fonts-input"
rm -rf "$input"
mkdir -p "$input"
cp -R "$fonts_src/fonts" "$input/fonts"
mkdir -p "$input/fonts/omnitext-hans"
cp "$here"/fonts/omnitext-hans/* "$input/fonts/omnitext-hans/"
hans_sha=$( (sha256sum "$input/fonts/omnitext-hans/OmnitextHans-Regular.otf" 2>/dev/null || shasum -a 256 "$input/fonts/omnitext-hans/OmnitextHans-Regular.otf") | cut -d' ' -f1)
printf 'Omnitext Hans | Regular | fonts/omnitext-hans/OmnitextHans-Regular.otf | Hans | OFL-1.1 | fonts/omnitext-hans/OFL.txt | %s | subset of Noto Sans CJK SC (scripts/make-hans-subset.py)\n' "$hans_sha" >> "$input/fonts/manifest.txt"

(cd "$src" && CRAFT_FONTS_DIR="$input" cargo build -p pdfcraft-wasm --target wasm32-unknown-unknown --release --locked)
out="$here/wasm/pdf"
rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" --out-name pdfcraft_wasm \
  "${CARGO_TARGET_DIR:-$src/target}/wasm32-unknown-unknown/release/pdfcraft_wasm.wasm"
if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
    "$out/pdfcraft_wasm_bg.wasm" -o "$out/pdfcraft_wasm_bg.wasm"
fi
ls -l "$out"
