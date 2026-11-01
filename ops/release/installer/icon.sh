#!/bin/sh
# Make tsundoku.ico, the installer's and the shortcuts' icon, from the app's
# own typeset 積 (static/icons/icon-512.png, scripts/icons.mjs; doc/INSTALL.md).
# The large sizes are the app icon scaled; the small ones are cropped to the
# glyph first, or at 16 px it is a grey smudge in its padding. Needs ImageMagick.
# Also the tray's two (doc/TRAY.md): the same .ico for Windows' tray, and a
# 64 px PNG of the glyph for Linux's, which takes PNG and scales it itself.
# Both are committed, since the tray embeds them; tests/tray-icons.spec.ts
# fails when the tray's .ico isn't this one.
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
cp tsundoku.ico ../tray/icon/tsundoku.ico
magick "$tmp/tight.png" -filter Lanczos -resize 64x64 -strip ../tray/icon/tsundoku.png
echo "tsundoku.ico: $(magick identify tsundoku.ico | awk '{print $3}' | tr '\n' ' ')"
