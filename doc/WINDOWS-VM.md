# The Windows test VM

tsundoku's Windows install ([`DISTRIBUTION.md`](DISTRIBUTION.md)) is tested on
**Zen**, a Windows 10 VirtualBox VM on the workstation, reached as
`ssh win-test`. It was set up on 2026-10-29 (c181 on the board).

Zen isn't only ours: it's the owner's VM for Windows-only apps. So a test
never leaves a trace in it, and never runs while it's open.

## Using it

```sh
ops/winvm/zen.sh up       # snapshot Zen as it is, boot it headless, wait for ssh
ssh win-test '...'        # PowerShell 5.1, as an administrator
ops/winvm/zen.sh down     # power off, put back the snapshot `up` took, delete it
ops/winvm/zen.sh status
```

`up` refuses while Zen is running (the owner is using it) or while an earlier
test's snapshot is still there; `down` clears that. Boot to SSH takes about
30 seconds. A rollback was checked on the day: a file written during a test is
gone after `down`.

Copy files in with `scp file win-test:` (they land in
`C:\Users\masshiro`). Commands run in Windows PowerShell 5.1, not
PowerShell 7: no `&&`, and `$ProgressPreference = 'SilentlyContinue'` keeps
progress records out of the output.

## What it is

| What      | Value                                                                                |
| --------- | ------------------------------------------------------------------------------------ |
| OS        | Windows 10 22H2 (19045), BIOS boot                                                   |
| Hardware  | 4 CPUs (was 1 before the tests), 8 GB                                                |
| Disks     | C: 50 GB (about 12 GB free), E: 48 GB (about 40 GB free): test libraries go on E:    |
| Network   | NIC 1 bridged (the owner's); NIC 2 NAT, `127.0.0.1:2222` to the guest's port 22      |
| SSH       | OpenSSH Server, automatic start, PowerShell as its shell                             |
| Account   | `masshiro`, an administrator, so SSH sessions are elevated                           |
| Key       | `~/.config/zen/id_ed25519`, outside the dotfiles; `Host win-test` in `~/.ssh/config` |
| Dev tools | none: no Node, no git. It's a friend's PC, which is the point                        |

Only `winget` is there to install anything, and a test shouldn't use it: a
friend's install has to work without it.

## Snapshots

- **`before-tsundoku`**: Zen exactly as the owner left it, before any of this.
- **`tsundoku-ready`**: after OpenSSH, the key and the second NIC. The base to
  return to if Zen ever breaks.
- **`tsundoku-test`**: exists only between `up` and `down`.

## How it was set up

Guest Additions can run commands in the guest (`VBoxManage guestcontrol`), but
only with a restricted token: Windows' UAC filters an administrator signed in
from outside, so installing a service needs one elevated step at the desktop.
That step was a script the owner ran once as administrator:

1. `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0`, `sshd`
   set to automatic and started, an inbound firewall rule for port 22.
2. The key in `C:\ProgramData\ssh\administrators_authorized_keys`, readable by
   Administrators and SYSTEM only (an administrator's keys are read from
   there, not from `~\.ssh`, and sshd ignores the file under any other ACL).
3. `HKLM:\SOFTWARE\OpenSSH\DefaultShell` set to Windows PowerShell.

The account password was in `~/.config/zen/password` (mode 600) for
`guestcontrol` during the setup; nothing needs it now.

Zen's automatic sign-in fails at boot ("The user name or password is
incorrect"), as it did before: Windows has an old password saved for it.
Nothing here depends on it.

## Starting over

If Zen is ever rebuilt, or another Windows VM replaces it: repeat the three
steps above, give it a NAT port forward to 22, and keep the `win-test` name.
Windows 11 instead would want a TPM (`swtpm` under QEMU, or VirtualBox's own),
which is why the QEMU plan in `DISTRIBUTION.md` named it.
