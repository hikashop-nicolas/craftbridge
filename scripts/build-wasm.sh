#!/bin/sh
# Builds the PDF engine to wasm from the exact fork commit in pdfcraft.rev and writes wasm/pdf/.
# Needs: git, sha256sum or shasum, a Rust toolchain with the wasm32-unknown-unknown target, wasm-bindgen-cli at the
# version in the engine's Cargo.lock, and (optionally) wasm-opt from binaryen 133 or newer (SKIP_WASM_OPT=1 leaves it out).
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

"$here/scripts/prepare-fonts.sh"
input="$here/vendor/fonts-input"

(cd "$src" && CRAFT_FONTS_DIR="$input" cargo build -p pdfcraft-wasm --target wasm32-unknown-unknown --release --locked)
out="$here/wasm/pdf"
rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" --out-name pdfcraft_wasm \
  "${CARGO_TARGET_DIR:-$src/target}/wasm32-unknown-unknown/release/pdfcraft_wasm.wasm"
if [ -z "${SKIP_WASM_OPT:-}" ] && command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
    "$out/pdfcraft_wasm_bg.wasm" -o "$out/pdfcraft_wasm_bg.wasm"
fi
ls -l "$out"
