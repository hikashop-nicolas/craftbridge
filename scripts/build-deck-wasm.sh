#!/bin/sh
# Builds DeckCraft's engine to wasm from the exact fork commit in deckcraft.rev and writes wasm/deck/.
# Needs: git, a Rust toolchain with the wasm32-unknown-unknown target, wasm-bindgen-cli at the version in the engine's
# Cargo.lock (INSTALL_WASM_BINDGEN=1 installs it), and optionally wasm-opt from binaryen 133 or newer (SKIP_WASM_OPT=1
# leaves it out). DECKCRAFT_SRC picks the clone (default vendor/deckcraft).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
rev=$(tr -d '[:space:]' < "$here/deckcraft.rev")
src="${DECKCRAFT_SRC:-$here/vendor/deckcraft}"

# A folder that already holds build output (a CI cache of target/) is not a clone yet: start the repository in place.
if [ ! -d "$src/.git" ]; then
  git init --quiet "$src"
  git -C "$src" remote add origin https://github.com/hikashop-nicolas/deckcraft.git
fi
git -C "$src" fetch --quiet origin "$rev" 2>/dev/null || git -C "$src" cat-file -e "$rev^{commit}"
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
# The Japanese face is a file the host loads (shared with the PDF module); the engine's own copy would be a second one.
# Cold crates are built for size, the drawing and text ones for speed (size-first everywhere made rendering several times slower).
. "$here/scripts/size-profile.sh"
(cd "$src" && CRAFT_FONTS_EXTERNAL_CJK=1 CRAFT_FONTS_DIR="$here/vendor/fonts-input" CARGO_PROFILE_RELEASE_LTO=fat CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 cargo build -p deckcraft-wasm --target wasm32-unknown-unknown --release --locked $SIZE_CONFIG)
out="$here/wasm/deck"
rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" --out-name deckcraft_wasm \
  "${CARGO_TARGET_DIR:-$src/target}/wasm32-unknown-unknown/release/deckcraft_wasm.wasm"
"$here/scripts/copy-fonts.sh"
if [ -z "${SKIP_WASM_OPT:-}" ] && command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-simd \
    "$out/deckcraft_wasm_bg.wasm" -o "$out/deckcraft_wasm_bg.wasm"
fi
ls -l "$out"
