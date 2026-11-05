#!/bin/sh
#
# The Android TV app's APK alone (c236; doc/TV-APP.md, doc/RELEASE.md): kept
# because the docs and the owner's habits name it. The build is
# android-apk.sh's, which also builds the phone and tablet app (c521).
#
#   ops/release/tv-apk.sh <version> [--out DIR]

set -eu
exec "$(dirname "$0")/android-apk.sh" "$@" --app tv
