#!/bin/sh
#
# The Android TV app's APK alone (doc/ANDROID.md, doc/RELEASE.md): kept
# because the docs name it. The build is android-apk.sh's, which also builds
# the phone and tablet app.
#
#   ops/release/tv-apk.sh <version> [--out DIR]

set -eu
exec "$(dirname "$0")/android-apk.sh" "$@" --app tv
