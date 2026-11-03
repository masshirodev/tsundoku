#!/bin/sh
# A bundle's own ffmpeg must fingerprint (doc/RELEASE.md, "Smoke test"; c299).
# The app's first route to a fingerprint is ffmpeg's chromaprint muxer
# (src/lib/server/anime/fingerprint.ts), and the pinned BtbN build has it, so
# that is what is tested here: the binary is named from the bundle, never from
# PATH, since a future pin that drops the muxer is the risk this guards and
# this workstation's Arch ffmpeg cannot stand in for the bundle's.
set -eu
b=${1:?usage: fingerprint.sh <bundle> [work dir]}
work=${2:-}
if [ -z "$work" ]; then
	work=$(mktemp -d)
	trap 'rm -rf "$work"' EXIT
fi

ff="$b/ffmpeg/bin/ffmpeg"
[ -x "$ff" ] || {
	echo "FAIL fingerprint: the bundle carries no ffmpeg ($ff)"
	exit 1
}

# A tone is enough: it only has to reach chromaprint as points. Two seconds
# of raw 32-bit points is 0.25 s of audio, far past the four bytes that would
# separate "made points" from "made none".
bytes=$(
	"$ff" -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=14' \
		-ac 1 -ar 44100 -vn -t 6 -f chromaprint -fp_format raw pipe:1 | wc -c
)
if [ "$bytes" -lt 4 ]; then
	echo "FAIL fingerprint: the bundle's ffmpeg has no chromaprint muxer (wrote $bytes bytes)"
	exit 1
fi
echo "ok   fingerprint · $((bytes / 4)) points"
