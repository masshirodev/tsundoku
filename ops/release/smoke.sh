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

# A release is tested with the scripts it was tagged with, never this
# checkout's: 2026.10.30.5's run used a smoke.sh that already tested a later
# commit's Wi-Fi, and was edited under it besides. So, unless this already is
# the tag's copy, check the tag out and run its own (a trial, with no tag,
# runs this one).
if [ -z "${TSUNDOKU_SMOKE_TAGGED:-}" ] && git -C "$repo" rev-parse -q --verify "refs/tags/release/$version" >/dev/null; then
	src="$base/smoke-src/$version"
	rm -rf "$src"
	git -C "$repo" worktree prune
	git -C "$repo" worktree add -q --detach "$src" "release/$version"
	ln -s "$repo/node_modules" "$src/node_modules"
	status=0
	TSUNDOKU_SMOKE_TAGGED=1 sh "$src/ops/release/smoke.sh" "$@" || status=$?
	git -C "$repo" worktree remove --force "$src"
	exit $status
fi
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
		/w/tsundoku/tsundoku --foreground --no-browser > /tmp/launch.log 2>&1 &
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
		[ "$left" -eq 0 ] || exit 1
		sh /s/linux-tray.sh /w/tsundoku' || status=1
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
	echo "-- the updater: offered a signed newer version, UPDATE, back by itself"
	node --disable-warning=ExperimentalWarning --experimental-strip-types "$here/smoke/fake-update.ts" \
		"$out/tsundoku-$version-win-x64.exe" "$work/latest.json"
	scp -q "$work/latest.json" "$here/smoke/serve-dir.mjs" "$here/smoke/set-password.mjs" \
		"$here/smoke/windows-update.ps1" win-test:
	ssh -o BatchMode=yes win-test 'powershell -ExecutionPolicy Bypass -File $HOME\windows-update.ps1' || status=1
	echo "-- over home Wi-Fi: the workstation as the phone, across the network"
	scp -q "$here/smoke/windows-wifi.ps1" "$here/smoke/set-password.mjs" win-test:
	ssh -o BatchMode=yes win-test 'powershell -ExecutionPolicy Bypass -File $HOME\windows-wifi.ps1' > "$work/wifi.log" 2>&1 &
	zen=$!
	url=''
	for i in $(seq 1 90); do
		url=$(ssh -o BatchMode=yes win-test 'Get-Content $HOME\wifi-code.txt -ErrorAction SilentlyContinue' 2>/dev/null | tr -d '\r')
		case "$url" in http*) break ;; esac
		sleep 2
	done
	jar="$work/wifi.jar"
	{
		# The code, then the welcome screen with the cookie it set; and a phone with no code.
		echo "pair $(curl -s -o /dev/null -c "$jar" -w '%{http_code} %{redirect_url}' "$url" | sed 's#http://[^/]*##')"
		w=$(curl -s -b "$jar" -w '\n%{http_code}' "${url%/pair/*}/welcome")
		echo "welcome $(echo "$w" | tail -1) $(echo "$w" | grep -q 'This phone is signed in' && echo signed-in)"
		echo "stranger $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "${url%/pair/*}/" | sed 's#http://[^/]*##; s#?.*##')"
	} > "$work/wifi-phone.txt"
	scp -q "$work/wifi-phone.txt" win-test:wifi-phone.txt
	wait $zen || status=1
	cat "$work/wifi.log"
	# On a tailnet, only given a key to join one with: an ephemeral auth key
	# (Tailscale admin console > Settings > Keys), so Zen leaves the tailnet by
	# itself once logged out, and the snapshot takes Tailscale away again.
	if [ -n "${TSUNDOKU_SMOKE_TAILSCALE_KEY:-}" ]; then
		echo "-- on Tailscale (TSUNDOKU_SERVE=https)"
		msi="$base/cache/tailscale-setup-latest-amd64.msi"
		[ -f "$msi" ] || curl -fsSL -o "$msi" https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi
		scp -q "$msi" win-test:tailscale.msi
		scp -q "$here/smoke/probe-tailnet.mjs" "$here/smoke/set-password.mjs" "$here/smoke/windows-tailscale.ps1" win-test:
		# A name of its own each run: Zen comes back from its snapshot as a new
		# node, which asks Let's Encrypt for a new certificate, and one name gets
		# five a week. The fixed `zen-tsundoku-smoke` ran out on 2026-10-30, the
		# ninth release that day, and the probe timed out waiting for it.
		node_name="zen-tsundoku-smoke-$(date -u +%m%d%H%M%S)"
		ssh -o BatchMode=yes win-test \
			"powershell -ExecutionPolicy Bypass -File \$HOME\\windows-tailscale.ps1 -Key $TSUNDOKU_SMOKE_TAILSCALE_KEY -Name $node_name" || status=1
	fi
	"$repo/ops/winvm/zen.sh" down
fi

rm -rf "$work"
# Only a version that passed everything here may be published
# (ops/release/publish.ts reads this mark). One platform's run doesn't count.
rm -f "$out/.smoked"
if [ $status -eq 0 ] && [ -z "$only" ]; then
	echo "$version $(date -u +%FT%TZ)" > "$out/.smoked"
fi
[ $status -eq 0 ] && echo "smoke: all passed" || echo "smoke: FAILED"
exit $status
