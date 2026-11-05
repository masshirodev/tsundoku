#!/bin/sh
#
# Build tsundoku's Android apps (c236, c521; doc/TV-APP.md, doc/PHONE-APP.md,
# doc/RELEASE.md): the TV's, the phone and tablet one, or both. They are two
# flavors of one Gradle project (android/tv), so one build makes either.
#
#   ops/release/android-apk.sh <version> [--app tv|phone|both] [--out DIR]
#
# `--app both` is the default. ops/release/tv-apk.sh is this with --app tv.
#
# A release-signed APK when the four keystore variables are set, a debug-signed
# one called `-debug` when they are not: the real keystore is the owner's and
# never in the repository. One key signs both apps; the variables keep the
# TSUNDOKU_TV_ names they had before there was a second app. The main release
# script's bundles are untouched.
#
# The version is the release's date version (2026.11.02), which also goes into
# each app's own user agent: "TsundokuTV/2026.11.02" names a paired TV a TV in
# the computer's DEVICES, "TsundokuApp/2026.11.02" a phone or tablet the app.

set -eu

VERSION=${1:-}
if [ -z "$VERSION" ]; then
	echo "usage: ops/release/android-apk.sh <version> [--app tv|phone|both] [--out DIR]" >&2
	exit 2
fi
shift

OUT="/mnt/hdd2/tsundoku/release/out/$VERSION"
WHICH=both
while [ $# -gt 0 ]; do
	case "$1" in
		--app)
			WHICH=${2:?--app needs tv, phone or both}
			shift 2
			;;
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

case "$WHICH" in
	tv) FLAVORS="tv" ;;
	phone) FLAVORS="mobile" ;;
	both) FLAVORS="tv mobile" ;;
	*)
		echo "--app is tv, phone or both, not $WHICH" >&2
		exit 2
		;;
esac

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
	TYPE=release
	echo "building release-signed APKs for $VERSION: $WHICH"
else
	TYPE=debug
	echo "no keystore in TSUNDOKU_TV_*: building debug-signed APKs called -debug: $WHICH"
fi
TASKS=""
for f in $FLAVORS; do
	cap=$(printf '%s' "$f" | cut -c1 | tr a-z A-Z)$(printf '%s' "$f" | cut -c2-)
	typ=$(printf '%s' "$TYPE" | cut -c1 | tr a-z A-Z)$(printf '%s' "$TYPE" | cut -c2-)
	TASKS="$TASKS :app:assemble$cap$typ"
done
# shellcheck disable=SC2086 # one word per task
./gradlew --no-daemon $TASKS -PversionName="$VERSION"

mkdir -p "$OUT"
for f in $FLAVORS; do
	SOURCE="app/build/outputs/apk/$f/$TYPE/app-$f-$TYPE.apk"
	# The phone app is tsundoku-app: the flavor is "mobile", the file is
	# named for what a friend downloads.
	case "$f" in
		tv) BASE="tsundoku-tv" ;;
		mobile) BASE="tsundoku-app" ;;
	esac
	if [ "$TYPE" = release ]; then NAME="$BASE-$VERSION.apk"; else NAME="$BASE-$VERSION-debug.apk"; fi
	DEST="$OUT/$NAME"
	cp "$SOURCE" "$DEST"

	# SHA256SUMS is the release's list of files; an APK joins it like a bundle.
	SUM=$(sha256sum "$DEST" | cut -d' ' -f1)
	if [ -f "$OUT/SHA256SUMS" ]; then
		grep -v "  $NAME\$" "$OUT/SHA256SUMS" > "$OUT/SHA256SUMS.tmp" || true
		mv "$OUT/SHA256SUMS.tmp" "$OUT/SHA256SUMS"
	fi
	printf '%s  %s\n' "$SUM" "$NAME" >> "$OUT/SHA256SUMS"

	echo "$DEST"
	echo "sha256 $SUM"
done
