#!/bin/sh
# A bundle's own tools must fingerprint (doc/RELEASE.md, "Smoke test"; c297).
# Both binaries are named from the bundle, never from PATH: this workstation's
# Arch fpcalc passing is exactly how a bundle without one shipped.
set -eu
b=${1:?usage: fingerprint.sh <bundle> [work dir]}
work=${2:-}
if [ -z "$work" ]; then
	work=$(mktemp -d)
	trap 'rm -rf "$work"' EXIT
fi

ff="$b/ffmpeg/bin/ffmpeg"
fp="$b/fpcalc/fpcalc"
[ -x "$ff" ] || {
	echo "FAIL fingerprint: the bundle carries no ffmpeg ($ff)"
	exit 1
}
[ -x "$fp" ] || {
	echo "FAIL fingerprint: the bundle carries no fpcalc ($fp)"
	exit 1
}

# A tone is enough: it only has to reach chromaprint with points.
"$ff" -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=6' \
	-ac 1 -ar 11025 -f s16le pipe:1 |
	"$fp" -format s16le -rate 11025 -channels 1 -length 8 -raw -json - >"$work/fingerprint.json"

"$b/node/bin/node" -e '
	const fs = require("node:fs");
	const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
	if (!Array.isArray(j.fingerprint) || !j.fingerprint.length) {
		console.error("FAIL fingerprint: the bundle’s fpcalc returned no points");
		process.exit(1);
	}
	console.log("ok   fingerprint ·", j.fingerprint.length, "points");
' "$work/fingerprint.json"
