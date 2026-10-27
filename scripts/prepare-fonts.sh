#!/bin/sh
# Lays out vendor/fonts-input for the engines' build scripts (CRAFT_FONTS_DIR).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
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

