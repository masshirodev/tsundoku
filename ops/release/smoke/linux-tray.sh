#!/bin/sh
# The tray on Linux (doc/TRAY.md), smoke-tested by smoke.sh in its bare
# Debian container after the foreground run: no D-Bus there, so no icon, which
# is the case the tray must survive. ./tsundoku goes to the background and
# returns, a second start opens the running one rather than starting another,
# and --quit stops everything. The library and password are the probe's,
# from the run before.
set -u
b=${1:?usage: linux-tray.sh <bundle>}
data=$HOME/.local/share/tsundoku
failed=0
check() { if [ "$2" = 0 ]; then echo "ok   $1"; else echo "FAIL $1"; failed=$((failed + 1)); fi; }
answers() {
	"$b/node/bin/node" -e 'fetch("http://127.0.0.1:42143/manifest.webmanifest").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))'
}
# By executable and command line: this script's own names the bundle too.
servers() {
	n=0
	for p in /proc/[0-9]*; do
		[ "$(readlink "$p/exe" 2>/dev/null)" = "$b/node/bin/node" ] || continue
		tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q 'app/scripts/serve.ts' && n=$((n + 1))
	done
	echo $n
}
left() { readlink /proc/[0-9]*/exe 2>/dev/null | grep -c "^$b/"; }

echo "--- the tray"
first=$("$b/tsundoku" --no-browser)
echo "$first"
echo "$first" | grep -q 'in the background'
check './tsundoku returns, leaving tsundoku in the background' $?
up=1
for i in $(seq 1 90); do answers && { up=0; break; }; sleep 2; done
check 'and tsundoku answers' $up
pid=$("$b/node/bin/node" -p 'require(process.argv[1]).pid' "$data/tray.json" 2>/dev/null)
# Field 6 of /proc/<pid>/stat is the session: the tray's own, not this shell's.
[ -n "$pid" ] && [ "$(cut -d' ' -f6 "/proc/$pid/stat")" != "$(cut -d' ' -f6 /proc/$$/stat)" ]
check "the tray (pid $pid) is in a session of its own, so a closed terminal can't stop it" $?

# Without --no-browser: the tray asks the launcher to open a browser, and
# there's no xdg-open here. tsundoku must carry on regardless.
second=$("$b/tsundoku")
echo "$second"
echo "$second" | grep -q 'already running'
check 'a second start finds the running one' $?
sleep 3
[ "$(servers)" -eq 1 ] && answers
check "and doesn't start another ($(servers) server running)" $?

stopped=$("$b/tsundoku" --quit)
echo "$stopped"
echo "$stopped" | grep -q 'has stopped'
check '--quit stops it, and waits until it has' $?
check "nothing of the bundle left running ($(left))" "$(left)"
[ ! -e "$data/tray.json" ]
check 'and the tray took its address with it' $?
again=$("$b/tsundoku" --quit)
echo "$again" | grep -q "isn't running"
check '--quit with nothing running says so' $?

echo "--- tray.log"; tail -n 20 "$data/logs/tray.log"
echo "--- launcher.log"; tail -n 20 "$data/logs/launcher.log"
[ "$failed" -eq 0 ] || { echo "$failed failed"; exit 1; }
echo "all passed"
