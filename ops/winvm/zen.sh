#!/bin/sh
# Drive Zen, the Windows 10 VirtualBox VM tsundoku is tested on
# (doc/WINDOWS-VM.md). Zen is also a VM in daily use for Windows-only apps, so a
# test never leaves a trace: `up` snapshots it as it is, `down` puts that back.
#
#   ops/winvm/zen.sh up       # snapshot as-is, boot headless, wait for ssh win-test
#   ops/winvm/zen.sh down     # power off, restore the snapshot `up` took, delete it
#   ops/winvm/zen.sh status
#
# This deployment's only, like ops/systemd (ops/README.md): it names this
# box's VM and SSH host.
set -eu

vm=${ZEN_VM:-Zen}
host=${ZEN_HOST:-win-test}
mark=tsundoku-test

state() { VBoxManage showvminfo "$vm" --machinereadable | sed -n 's/^VMState="\(.*\)"/\1/p'; }
pending() { VBoxManage snapshot "$vm" list --machinereadable 2>/dev/null | grep -q "=\"$mark\"$"; }

poweroff() {
	[ "$(state)" = poweroff ] && return
	# Ask Windows first; a cut power is the fallback, and harmless here since
	# the snapshot is restored right after.
	ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" 'Stop-Computer -Force' >/dev/null 2>&1 || true
	i=0
	while [ "$(state)" != poweroff ] && [ $i -lt 40 ]; do sleep 3; i=$((i + 1)); done
	[ "$(state)" = poweroff ] || VBoxManage controlvm "$vm" poweroff >/dev/null
}

case "${1:-}" in
up)
	if pending; then
		echo "a test is already under way (snapshot $mark exists); run \`$0 down\` first." >&2
		exit 1
	fi
	if [ "$(state)" != poweroff ] && [ "$(state)" != saved ] && [ "$(state)" != aborted ]; then
		echo "$vm is $(state): it's in use. Close it, then run this again." >&2
		exit 1
	fi
	VBoxManage snapshot "$vm" take "$mark" --description "Zen before a tsundoku test; \`zen.sh down\` restores it." >/dev/null
	VBoxManage startvm "$vm" --type headless >/dev/null
	printf 'waiting for %s' "$host"
	i=0
	until ssh -o BatchMode=yes -o ConnectTimeout=5 "$host" 'exit 0' >/dev/null 2>&1; do
		i=$((i + 1))
		[ $i -lt 60 ] || {
			echo " gave up after 5 minutes" >&2
			exit 1
		}
		printf .
		sleep 5
	done
	echo " up."
	;;
down)
	poweroff
	if pending; then
		VBoxManage snapshot "$vm" restore "$mark" >/dev/null
		VBoxManage snapshot "$vm" delete "$mark" >/dev/null
		echo "$vm is back as it was before \`up\`."
	else
		echo "$vm is off; no test snapshot to restore."
	fi
	;;
status)
	echo "$vm: $(state)$(pending && echo ', test under way' || true)"
	;;
*)
	echo "usage: $0 up|down|status" >&2
	exit 2
	;;
esac
