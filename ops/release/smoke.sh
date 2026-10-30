#!/bin/sh
# tsundoku's release smoke test (doc/RELEASE.md, "Smoke test"): each bundle
# of a release, on a machine that has never seen tsundoku. Linux in a bare
# Debian container (no Node, no Java, no ffmpeg); Windows on Zen, the test VM
# (doc/WINDOWS-VM.md), rolled back afterwards. Both unzip the bundle, put a
# synthesised Mihon library in the data folder, start it, and run probe.mjs.
#
#   ops/release/smoke.sh 2026.10.29             # both
#   ops/release/smoke.sh 2026.10.29 linux-x64   # one
set -eu

version=${1:?usage: smoke.sh <version> [win-x64|linux-x64]}
only=${2:-}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
base=${RELEASE_DIR:-/mnt/hdd2/tsundoku/release}
out="$base/out/$version"
work="$base/smoke/$version"
rm -rf "$work"
mkdir -p "$work/library"

# The fixture the importer's specs use (tests/helpers/mihon-fixture.ts).
node --disable-warning=ExperimentalWarning -e \
	"import('$repo/tests/helpers/mihon-fixture.ts').then((m) => m.writeMihonFolder('$work/library'))"
(cd "$work/library" && zip -qr ../library.zip .)
status=0

if [ -z "$only" ] || [ "$only" = linux-x64 ]; then
	echo "== linux-x64"
	tar -xJf "$out/tsundoku-$version-linux-x64.tar.xz" -C "$work"
	docker run --rm -v "$work:/w" -v "$here/smoke:/s:ro" debian:stable-slim sh -c '
		export HOME=/root; mkdir -p /root/.local/share/tsundoku
		cp -r /w/library /root/.local/share/tsundoku/library
		/w/tsundoku/tsundoku --no-browser > /tmp/launch.log 2>&1 &
		launcher=$!
		for i in $(seq 1 90); do grep -q "Open http" /tmp/launch.log && break; sleep 2; done
		cat /tmp/launch.log; echo "--- probe"
		/w/tsundoku/node/bin/node /s/probe.mjs /w/tsundoku || exit 1
		# A closed terminal hangs up the launcher alone; it stops the rest (c187).
		# By executable, since this script'"'"'s own command line names the bundle too.
		echo "--- hang up"
		kill -HUP $launcher; sleep 5
		left=$(readlink /proc/[0-9]*/exe 2>/dev/null | grep -c "^/w/tsundoku/")
		echo "left running after a hangup: $left"
		[ "$left" -eq 0 ]' || status=1
fi

if [ -z "$only" ] || [ "$only" = win-x64 ]; then
	echo "== win-x64"
	"$repo/ops/winvm/zen.sh" up
	scp -q "$out/tsundoku-$version-win-x64.zip" win-test:bundle.zip
	scp -q "$out/tsundoku-$version-win-x64.exe" win-test:installer.exe
	scp -q "$work/library.zip" "$here/smoke/probe.mjs" "$here/smoke/windows.ps1" \
		"$here/smoke/windows-installer.ps1" win-test:
	echo "-- the zip"
	ssh -o BatchMode=yes win-test 'powershell -ExecutionPolicy Bypass -File $HOME\windows.ps1' || status=1
	echo "-- the installer: install, run, update while running, uninstall"
	ssh -o BatchMode=yes win-test 'powershell -ExecutionPolicy Bypass -File $HOME\windows-installer.ps1' || status=1
	# On a tailnet, only given a key to join one with: an ephemeral auth key
	# (Tailscale admin console > Settings > Keys), so Zen leaves the tailnet by
	# itself once logged out, and the snapshot takes Tailscale away again.
	if [ -n "${TSUNDOKU_SMOKE_TAILSCALE_KEY:-}" ]; then
		echo "-- on Tailscale (TSUNDOKU_SERVE=https)"
		msi="$base/cache/tailscale-setup-latest-amd64.msi"
		[ -f "$msi" ] || curl -fsSL -o "$msi" https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi
		scp -q "$msi" win-test:tailscale.msi
		scp -q "$here/smoke/probe-tailnet.mjs" "$here/smoke/set-password.mjs" "$here/smoke/windows-tailscale.ps1" win-test:
		ssh -o BatchMode=yes win-test \
			"powershell -ExecutionPolicy Bypass -File \$HOME\\windows-tailscale.ps1 -Key $TSUNDOKU_SMOKE_TAILSCALE_KEY" || status=1
	fi
	"$repo/ops/winvm/zen.sh" down
fi

rm -rf "$work"
[ $status -eq 0 ] && echo "smoke: all passed" || echo "smoke: FAILED"
exit $status
