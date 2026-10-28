#!/bin/sh
# The CJK faces both engines take from files at run time, into wasm/fonts/ (prepare-fonts.sh lays out the input).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
in="$here/vendor/fonts-input/fonts"
mkdir -p "$here/wasm/fonts"
cp "$in/biz-ud-pgothic/BIZUDPGothic-Regular.ttf" "$in/nanum-gothic/NanumGothic-Regular.ttf" "$in/omnitext-hans/OmnitextHans-Regular.otf" "$here/wasm/fonts/"
