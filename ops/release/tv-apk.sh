#!/bin/sh
#
# Build the Android TV app's APK (c236; doc/TV-APP.md, doc/RELEASE.md).
#
#   ops/release/tv-apk.sh <version> [--out DIR]
#
# A release-signed APK when the four keystore variables are set, a debug-signed
# one called `-debug` when they are not: the real keystore is the owner's and
# never in the repository. The main release script's bundles are untouched.
#
# The version is the release's date version (2026.11.02), which also goes into
# the app's own user agent: "TsundokuTV/2026.11.02" is what the computer's
# DEVICES row reads, so a paired TV is named a TV.

set -eu

VERSION=${1:-}
if [ -z "$VERSION" ]; then
	echo "usage: ops/release/tv-apk.sh <version> [--out DIR]" >&2
	exit 2
fi
shift

OUT="/mnt/hdd2/tsundoku/release/out/$VERSION"
while [ $# -gt 0 ]; do
	case "$1" in
		--out)
			OUT=${2:?--out needs a directory}
			shift 2
			;;
		*)
			echo "unknown argument: $1" >&2
			exit 2
			;;
	esac
done

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
APP="$ROOT/android/tv"

# The SDK this machine has (AGENTS.md); an environment one wins.
: "${ANDROID_HOME:=$HOME/Android/Sdk}"
export ANDROID_HOME

signed() {
	[ -n "${TSUNDOKU_TV_KEYSTORE:-}" ] &&
		[ -f "${TSUNDOKU_TV_KEYSTORE}" ] &&
		[ -n "${TSUNDOKU_TV_KEYSTORE_PASSWORD:-}" ] &&
		[ -n "${TSUNDOKU_TV_KEY_ALIAS:-}" ] &&
		[ -n "${TSUNDOKU_TV_KEY_PASSWORD:-}" ]
}

# A Gradle daemon outlives a failed build, and this machine's java processes
# are not ours to kill by name (AGENTS.md): --stop, and by pid only if needed.
cd "$APP"
trap './gradlew --stop >/dev/null 2>&1 || true' EXIT INT TERM

if signed; then
	echo "building a release-signed APK for $VERSION"
	./gradlew --no-daemon :app:assembleRelease -PversionName="$VERSION"
	SOURCE="app/build/outputs/apk/release/app-release.apk"
	NAME="tsundoku-tv-$VERSION.apk"
else
	echo "no keystore in TSUNDOKU_TV_*: building a debug-signed APK called -debug"
	./gradlew --no-daemon :app:assembleDebug -PversionName="$VERSION"
	SOURCE="app/build/outputs/apk/debug/app-debug.apk"
	NAME="tsundoku-tv-$VERSION-debug.apk"
fi

mkdir -p "$OUT"
DEST="$OUT/$NAME"
cp "$SOURCE" "$DEST"

# SHA256SUMS is the release's list of files; the TV APK joins it like a bundle.
SUM=$(sha256sum "$DEST" | cut -d' ' -f1)
if [ -f "$OUT/SHA256SUMS" ]; then
	grep -v "  $NAME\$" "$OUT/SHA256SUMS" > "$OUT/SHA256SUMS.tmp" || true
	mv "$OUT/SHA256SUMS.tmp" "$OUT/SHA256SUMS"
fi
printf '%s  %s\n' "$SUM" "$NAME" >> "$OUT/SHA256SUMS"

echo "$DEST"
echo "sha256 $SUM"
