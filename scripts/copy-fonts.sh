#!/bin/sh
# The CJK faces both engines take from files at run time, and the Latin, Arabic and Hebrew faces other code (scoredit's PDF
# export) fetches, into wasm/fonts/ (prepare-fonts.sh lays out the input).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
in="$here/vendor/fonts-input/fonts"
mkdir -p "$here/wasm/fonts"
# Each file goes with its licence (SIL OFL 1.1 asks for it), as <file>.OFL.txt.
for f in biz-ud-pgothic/BIZUDPGothic-Regular.ttf nanum-gothic/NanumGothic-Regular.ttf omnitext-hans/OmnitextHans-Regular.otf \
  inter/Inter-Regular.ttf noto-sans-arabic/NotoSansArabic.ttf noto-sans-hebrew/NotoSansHebrew-Regular.ttf; do
  name=$(basename "$f")
  cp "$in/$f" "$here/wasm/fonts/$name"
  cp "$in/$(dirname "$f")/OFL.txt" "$here/wasm/fonts/${name%.*}.OFL.txt"
done
