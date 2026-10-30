#!/bin/sh
# Make tsundoku.ico, the installer's and the shortcuts' icon, from the app's
# own typeset 積 (static/icons/icon-512.png, scripts/icons.mjs; doc/INSTALL.md).
# The large sizes are the app icon scaled; the small ones are cropped to the
# glyph first, or at 16 px it is a grey smudge in its padding. Needs ImageMagick.
set -eu
cd "$(dirname "$0")"
src=../../../static/icons/icon-512.png
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
bg=$(magick "$src" -format '%[pixel:p{2,2}]' info:)
magick "$src" -fuzz 8% -trim +repage -background "$bg" -gravity center \
	-extent '%[fx:max(w,h)*1.12]x%[fx:max(w,h)*1.12]' "$tmp/tight.png"
magick "$src" -resize 256x256 "$tmp/256.png"
magick "$src" -resize 64x64 "$tmp/64.png"
for s in 48 32 24 16; do magick "$tmp/tight.png" -filter Lanczos -resize "${s}x${s}" "$tmp/$s.png"; done
magick "$tmp/256.png" "$tmp/64.png" "$tmp/48.png" "$tmp/32.png" "$tmp/24.png" "$tmp/16.png" tsundoku.ico
echo "tsundoku.ico: $(magick identify tsundoku.ico | awk '{print $3}' | tr '\n' ' ')"
