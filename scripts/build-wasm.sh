#!/bin/sh
# Builds the PDF engine to wasm from the exact fork commit in pdfcraft.rev and writes wasm/pdf/.
# Needs: git, a Rust toolchain with the wasm32-unknown-unknown target, wasm-bindgen-cli at the
# version in the engine's Cargo.lock, and (optionally) wasm-opt from binaryen.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
rev=$(tr -d '[:space:]' < "$here/pdfcraft.rev")
src="${PDFCRAFT_SRC:-$here/vendor/pdfcraft}"

if [ ! -d "$src/.git" ]; then
  git clone --quiet https://github.com/hikashop-nicolas/pdfcraft.git "$src"
fi
git -C "$src" fetch --quiet origin
git -C "$src" checkout --quiet --detach "$rev"

want=$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/[^0-9.]/, "", $0); print; exit }' "$src/Cargo.lock")
have=$(wasm-bindgen --version | awk '{print $2}')
if [ "$want" != "$have" ]; then
  echo "wasm-bindgen-cli $have does not match the engine's $want (cargo install wasm-bindgen-cli --version $want --locked)" >&2
  exit 1
fi

(cd "$src" && cargo build -p pdfcraft-wasm --target wasm32-unknown-unknown --release --locked)
out="$here/wasm/pdf"
rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" --out-name pdfcraft_wasm \
  "$src/target/wasm32-unknown-unknown/release/pdfcraft_wasm.wasm"
if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
    "$out/pdfcraft_wasm_bg.wasm" -o "$out/pdfcraft_wasm_bg.wasm"
fi
ls -l "$out"
