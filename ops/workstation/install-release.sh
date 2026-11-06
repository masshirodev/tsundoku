#!/bin/sh
# Put a published release on the workstation (doc/SERVING.md; card c228).
# The workstation runs the same Linux bundle friends do, not its checkout:
#
#   ops/workstation/install-release.sh 2026.11.01.1
#
# 1. Unpacks the version's Linux bundle into ~/.local/opt/tsundoku/<version>
#    (on the SSD: it's the program, not the library), from the release's own
#    output folder, its SHA-256 checked against the release's SHA256SUMS.
# 2. Moves ~/projects/tsundoku-jobs, the checkout the timers run from
#    (backup, OCR, sync), to the same tag, and installs its packages.
#    Never ~/projects/tsundoku itself: that's where work in progress lives.
# 3. Points ~/.local/opt/tsundoku/current at the new bundle and restarts
#    tsundoku.service, which starts `current/tsundoku --foreground`.
#
# The data folder (/mnt/hdd2/tsundoku: its .env, the database, the library)
# is the release's own business and isn't touched here. Older bundles stay
# beside the new one, so going back is pointing `current` at one again.
set -eu

version=${1:?usage: install-release.sh <version>}
repo=$(cd "$(dirname "$0")/../.." && pwd)
out=${RELEASE_OUT:-/mnt/hdd2/tsundoku/release/out}/$version
opt=$HOME/.local/opt/tsundoku
jobs=$(dirname "$repo")/tsundoku-jobs
archive=tsundoku-$version-linux-x64.tar.xz

[ -f "$out/.smoked" ] || {
	echo "$version wasn't smoke-tested whole (no $out/.smoked): run ops/release/smoke.sh first." >&2
	exit 1
}
# The mark speaks for the bundles it tested (ops/release/smoked.ts, the same rule).
rebuilt=$(find "$out" -maxdepth 1 -type f -name "tsundoku-$version-*" -newer "$out/.smoked")
[ -z "$rebuilt" ] || {
	echo "$version changed after its smoke test: run ops/release/smoke.sh again. $rebuilt" >&2
	exit 1
}
(cd "$out" && grep " $archive\$" SHA256SUMS | sha256sum -c --quiet -) || {
	echo "$archive doesn't match its SHA256SUMS." >&2
	exit 1
}

# 1. The bundle.
if [ ! -x "$opt/$version/tsundoku/tsundoku" ]; then
	rm -rf "$opt/.$version.part"
	mkdir -p "$opt/.$version.part"
	tar -xJf "$out/$archive" -C "$opt/.$version.part"
	mv "$opt/.$version.part" "$opt/$version"
fi

# 2. The timers' checkout, at the same tag.
tag=release/$version
git -C "$repo" fetch -q origin "refs/tags/$tag:refs/tags/$tag" 2>/dev/null || true
if [ -d "$jobs" ]; then
	git -C "$jobs" checkout -q --detach "$tag"
else
	git -C "$repo" worktree add -q --detach "$jobs" "$tag"
fi
(cd "$jobs" && yarn install --frozen-lockfile --non-interactive --silent)

# The units, from that checkout once its tag has the bundle's own (this
# script came with them): a unit edited in ~/projects/tsundoku then reaches
# systemd only with a release. Before that tag, they stay linked as they were.
if [ -f "$jobs/ops/workstation/install-release.sh" ]; then
	for u in tsundoku.service tsundoku-backup.service tsundoku-backup.timer \
		tsundoku-ocr.service tsundoku-ocr.timer tsundoku-sync.service tsundoku-sync.timer; do
		ln -sfn "$jobs/ops/systemd/$u" "$HOME/.config/systemd/user/$u"
	done
fi

# 3. Switch, and restart.
ln -sfn "$version/tsundoku" "$opt/current"
systemctl --user daemon-reload
systemctl --user restart tsundoku.service
echo "tsundoku $version is the workstation's now ($opt/current)."
