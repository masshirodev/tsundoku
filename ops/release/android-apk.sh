#!/bin/sh
#
# Build tsundoku's Android apps (c236, c521; doc/ANDROID.md,
# doc/RELEASE.md): the TV's, the phone and tablet one, or both. They are two
# flavors of one Gradle project (android), so one build makes either.
#
#   ops/release/android-apk.sh <version> [--app tv|phone|both] [--out DIR]
#   ops/release/android-apk.sh <version> --ref <commit> --out DIR [--app ...]
#
# `--app both` is the default. ops/release/tv-apk.sh is this with --app tv.
#
# What ships is a commit, as for the bundles: the APKs are built from a clean
# worktree of the tag release/<version>, never from this working tree, and a
# version with no tag is refused. `--ref` builds a trial from any commit, and
# needs its own --out, so a trial can't land in a release's folder under the
# names publish.ts ships.
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

USAGE="usage: ops/release/android-apk.sh <version> [--app tv|phone|both] [--out DIR] [--ref COMMIT]"
VERSION=${1:-}
if [ -z "$VERSION" ]; then
	echo "$USAGE" >&2
	exit 2
fi
shift

BASE=${RELEASE_DIR:-/mnt/hdd2/tsundoku/release}
OUT=""
REF=""
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
		--ref)
			REF=${2:?--ref needs a commit}
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

if [ -n "$REF" ]; then
	if [ -z "$OUT" ]; then
		echo "--ref builds a trial, which needs its own --out: it never goes in $BASE/out/$VERSION." >&2
		exit 2
	fi
	COMMIT=$(git -C "$ROOT" rev-parse -q --verify "$REF^{commit}") || {
		echo "--ref $REF is no commit here." >&2
		exit 1
	}
else
	COMMIT=$(git -C "$ROOT" rev-parse -q --verify "refs/tags/release/$VERSION^{commit}") || {
		echo "no tag release/$VERSION: APKs are built from the tag (doc/RELEASE.md). For a trial from a commit: --ref HEAD --out DIR." >&2
		exit 1
	}
fi

# Named now: the build below runs from the worktree, and a relative --out means
# where this was called from.
case "${OUT:=$BASE/out/$VERSION}" in
	/*) ;;
	*) OUT="$PWD/$OUT" ;;
esac

# The SDK this machine has (AGENTS.md); an environment one wins. A worktree has
# no local.properties, so this is what Gradle finds it by.
: "${ANDROID_HOME:=$HOME/Android/Sdk}"
export ANDROID_HOME

signed() {
	[ -n "${TSUNDOKU_TV_KEYSTORE:-}" ] &&
		[ -f "${TSUNDOKU_TV_KEYSTORE}" ] &&
		[ -n "${TSUNDOKU_TV_KEYSTORE_PASSWORD:-}" ] &&
		[ -n "${TSUNDOKU_TV_KEY_ALIAS:-}" ] &&
		[ -n "${TSUNDOKU_TV_KEY_PASSWORD:-}" ]
}

SRC="$BASE/work/android-$VERSION"

# A Gradle daemon outlives a failed build, and this machine's java processes
# are not ours to kill by name (AGENTS.md): --stop, and by pid only if needed.
cleanup() {
	status=$?
	trap - EXIT
	cd "$ROOT"
	if [ -x "$SRC/android/gradlew" ]; then
		(cd "$SRC/android" && ./gradlew --stop >/dev/null 2>&1) || true
	fi
	git -C "$ROOT" worktree remove --force "$SRC" >/dev/null 2>&1 || true
	exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$BASE/work"
rm -rf "$SRC"
git -C "$ROOT" worktree prune
git -C "$ROOT" worktree add -q --detach "$SRC" "$COMMIT"
cd "$SRC/android"

if signed; then
	TYPE=release
	echo "building release-signed APKs for $VERSION from $COMMIT: $WHICH"
else
	TYPE=debug
	echo "no keystore in TSUNDOKU_TV_*: building debug-signed APKs called -debug for $VERSION from $COMMIT: $WHICH"
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
		tv) BASE_NAME="tsundoku-tv" ;;
		mobile) BASE_NAME="tsundoku-app" ;;
	esac
	if [ "$TYPE" = release ]; then NAME="$BASE_NAME-$VERSION.apk"; else NAME="$BASE_NAME-$VERSION-debug.apk"; fi
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
