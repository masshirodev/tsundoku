# Serving

tsundoku runs on the workstation and is read on the tablet over the tailnet.
Development is `yarn run dev`, on localhost with no token. What the tablet
opens is the build:

```sh
yarn run build
yarn run serve     # https://workstation.example.ts.net:8443
```

## From boot, and again when it stops

**Since 2026-11-01 the workstation runs the released Linux bundle, the one
friends run** (c228), not its checkout. Two bugs that friends hit while the
workstation looked fine (a bundle without the novels plugin host, c227; an
engine that couldn't load current extensions, c226) were invisible here by
construction. Now the workstation is a friend's install with the owner's
data.

`ops/systemd/tsundoku.service` runs `~/.local/opt/tsundoku/current/tsundoku
--foreground --no-browser`: the bundle's launcher, which starts the engine
(`engine.jar`, on 4590), FlareSolverr (unpacked into
`/mnt/hdd2/tsundoku/flaresolverr`) and the app, and stops all three on a
stop. It starts at boot without anyone logged in (the user lingers:
`loginctl enable-linger`), and `Restart=always` brings it back ten seconds
after it stops. At boot tailscaled may not be up yet; `serve` exits until it
is, and the unit keeps trying (`StartLimitIntervalSec=0`).

```sh
# a release onto the workstation (after ops/release/smoke.sh passed it)
ops/workstation/install-release.sh 2026.11.01.1

# back to an older one: point current at it, then restart
ln -sfn 2026.11.01/tsundoku ~/.local/opt/tsundoku/current
systemctl --user restart tsundoku

# what it's doing
systemctl --user status tsundoku
journalctl --user -u tsundoku -f          # and /mnt/hdd2/tsundoku/logs/
```

`install-release.sh` unpacks the version's bundle into
`~/.local/opt/tsundoku/<version>` (its SHA-256 checked, and only a version
smoke-tested whole), moves `~/projects/tsundoku-jobs` (the timers' checkout)
to the same tag, points `current` at it and restarts. Older bundles stay
beside it. **A change reaches the workstation only in a release**, as it
reaches friends: there's no `yarn run build && restart` deploy any more.

The settings are the data folder's `.env`, `/mnt/hdd2/tsundoku/.env`, written
from Infisical by `yarn run secrets:pull` ([`SECRETS.md`](SECRETS.md)); the
launcher reads it, and the timers get it through `EnvironmentFile=`. Because
it names a `TSUNDOKU_TOKEN`, the launcher keeps the token's sign-in instead
of a friend's password ([`SIGN-IN.md`](SIGN-IN.md)).

Until then the unit ran `scripts/serve.ts` from `~/projects/tsundoku`, and a
restart served whatever that working tree held, other agents' uncommitted
edits included. The sections below about snapshots and `yarn run serve`
describe that arrangement, which development still uses.

## HTTPS, through `tailscale serve`

The reader needs a **secure context**. WebAuthn (the `/reveal` fingerprint gate),
the screen wake lock, and service workers (offline chapters, installing the
PWA) all refuse plain http. So `serve` does this, by default:

1. Asks `tailscale status` for this machine's tailnet name, and checks that it
   has an HTTPS certificate. MagicDNS and HTTPS certificates have to be on in
   the Tailscale admin console; on this tailnet they are.
2. Starts the app on **127.0.0.1:42143** only. Nothing but the local proxy can
   reach it, which is tighter than the old tailnet-address bind.
3. Makes sure `tailscale serve` maps **https port 8443** to it, and adds the
   mapping if it's missing (`tailscale serve --bg --https=8443
http://127.0.0.1:42143`). The mapping persists across reboots. It's
   **tailnet only**, `serve` and never `funnel`.
4. Sets `ORIGIN` to `https://<tailnet name>:8443`, so every POST passes
   SvelteKit's origin check, and cookies are `Secure`.

Tailscale owns the certificate and renews it itself, so there are no `tailscale
cert` files to rotate. `tailscale serve` accepts HTTPS on 443, 8443 and 10000
only. **443 is taken on this machine** by another app's mapping (to port
42138), so tsundoku uses 8443; 10000 was Suwayomi's until c129 and is free
([`DOWNLOADING.md`](DOWNLOADING.md), "Suwayomi, retired"). `serve` never overwrites a port that something
else serves: it stops and says to pick another with `TSUNDOKU_HTTPS_PORT`.

The pure parts (reading the tailnet name, the origin, whether a port is free,
ours or taken) are in `src/lib/server/bind.ts`, tested in `tests/bind.spec.ts`.

## Which library it serves

The live database is `/mnt/hdd2/tsundoku/library.sqlite` (the data folder's
`.env`). Until c228 it was `data/library.sqlite` in the checkout, and the
checkout's `.env` named it; that file was moved on 2026-11-01 and the
checkout's `.env` is development's now.

Before that, `yarn run serve` read `.env`, where `DATABASE_PATH=data/library.sqlite` and
`LIBRARY_ROOT=/mnt/hdd2/tsundoku/tablet` pointed it at the real library: the
copy of the tablet's `Mihon/`, `Hentoid/` and `Library/`. `yarn run dev` doesn't
put `.env` into `process.env`, so development keeps the sample library in
`data/tsundoku.sqlite`. `/scan` in the served app rescans the tablet copy.

Every other folder (covers, trash, the engine's store, OCR scratch) comes from
`TSUNDOKU_HOME` ([`DISTRIBUTION.md`](DISTRIBUTION.md), "One data directory"),
which is `/mnt/hdd2/tsundoku` here, and snapshots from `BACKUP_DIR`
(`/mnt/backup/tsundoku`). Both are in `.env` for scripts run by hand and in
every unit, so a unit stays right even if a pull drops them. Unset, they'd be
the per-OS defaults, `~/.local/share/tsundoku` on Linux: a second, empty
library on `/`. That's also where `yarn run dev` keeps its covers and trash
since 2026-10-29, apart from the live ones.

## Who migrates

**The served app, and nothing else that touches the live database.** The
timers (`tsundoku-ocr`, `tsundoku-sync`, `tsundoku-backup`; `tsundoku-suwayomi-import` until c129) run `scripts/*.ts`
straight from the working tree, where a new migration rung sits for as long as
it is being written. On 2026-09-25 the OCR timer, firing mid-c67, climbed the
live database to rung 29 while the served app was still the previous build.
No rating was written in between and every value checked out, but the old
code was serving a schema it didn't know.

So their units set `TSUNDOKU_MIGRATE=off`, and `getDb()` then refuses any
database whose `user_version` differs from the code's ladder, in either
direction, without touching it. A timer run between an edit and its deploy
fails with "Deploy first" in its journal, and the first run after the deploy
works. The served app migrates on its first request after a restart, snapshot first
as always ([`BACKUPS.md`](BACKUPS.md)).

Since c228 the timers run from `~/projects/tsundoku-jobs`, a checkout at the
installed release's tag that `install-release.sh` moves with each release, so
their code and the server's are the same version. `TSUNDOKU_MIGRATE=off` stays:
it's the guard if the two ever drift.

A one-off script run by hand against the live library (`yarn run links`,
`yarn run import`, …) runs from `~/projects/tsundoku-jobs` with the data
folder's settings, so it's the released code:
`cd ~/projects/tsundoku-jobs && set -a && . /mnt/hdd2/tsundoku/.env && set +a && yarn run links`.
From `~/projects/tsundoku`, whose `.env` is development's, it touches the
sample library only.

## Plain http, the old way

`TSUNDOKU_SERVE=http yarn run serve` binds the tailnet address directly on
plain http, as kirisute does. A wildcard bind is still refused unless
`TSUNDOKU_BIND_ANY=1` says so by name: this box has no firewall, so 0.0.0.0
would be the whole LAN. The fingerprint gate, the wake lock and offline
caching don't work this way.

## Local, on the same computer

`TSUNDOKU_SERVE=local` is for a friend's install, which has no Tailscale
([`DISTRIBUTION.md`](DISTRIBUTION.md)). The app listens on **127.0.0.1** only,
whatever `HOST` says, and its origin is **http://localhost:42143**. Browsers
count localhost as a secure context, so installing the app, offline chapters,
the wake lock and the fingerprint gate all work without a certificate.

- **127.0.0.1 in the address bar is sent to localhost** (308, path kept,
  `src/hooks.server.ts`). ORIGIN has one value, and a page opened under the
  other name would load and then fail every save on the origin check.
- **No token yet, one is made**, except on a friend's install
  (`TSUNDOKU_LOGIN=password`), which signs in with a password chosen on first
  open instead ([`SIGN-IN.md`](SIGN-IN.md)). On a first start `serve` writes
  `TSUNDOKU_TOKEN` into `TSUNDOKU_HOME/.env` (mode 600), prints it once, and
  reads it from there after. That `.env` is read after the project's, so the
  workstation's own always wins; it's where a friend's install keeps every
  setting, since the program's folder may not be theirs to write. This holds
  in every mode, but the workstation always has its token.
- A value of `TSUNDOKU_SERVE` that isn't `https`, `http` or `local` is
  refused. Before `local` existed, anything but `https` meant the tailnet bind.

The pure parts (`serveMode`, `localOrigin`, `loopbackRedirect`) are in
`bind.ts`, and the token in `src/lib/server/first-run.ts`, tested in
`tests/bind.spec.ts` and `tests/first-run.spec.ts`.

## Where it serves: `serving.json`

On every start, in every mode, `serve` writes `TSUNDOKU_HOME/serving.json`:
`{ pid, mode, origin, listen }` (`Serving` in `bind.ts`, read back by
`readServing`). A release's launcher opens `origin` and probes `listen`
from it ([`RELEASE.md`](RELEASE.md), "The launcher"), since only local
mode's origin is localhost. On the workstation it's
`/mnt/hdd2/tsundoku/serving.json`, and nothing reads it. A data folder that
can't be written to doesn't stop the server.

`serve` finds `tailscale` on PATH, except on Windows, where Tailscale's
installer leaves PATH alone: there it's `%ProgramFiles%\Tailscale\tailscale.exe`
when that exists (`tailscaleCommand`).

## Variables

| Variable                    | Default   | Meaning                                                                |
| --------------------------- | --------- | ---------------------------------------------------------------------- |
| `TSUNDOKU_TOKEN`            | made once | The shared login token, in `.env` (or `TSUNDOKU_HOME/.env`).           |
| `TSUNDOKU_SERVE`            | `https`   | `https` through tailscale serve, `http`, or `local`.                   |
| `TSUNDOKU_LOGIN`            | unset     | `password`: a friend's sign-in, no token ([`SIGN-IN.md`](SIGN-IN.md)). |
| `TSUNDOKU_HOME`             | per OS    | The data folder every other folder derives from.                       |
| `TSUNDOKU_SNAPSHOT`         | on        | `off` runs `build/` itself, without the `.serving/` copy (a release).  |
| `TSUNDOKU_HTTPS_PORT`       | `8443`    | 443, 8443 or 10000.                                                    |
| `PORT`                      | `42143`   | The app's own port, on 127.0.0.1 (or the tailnet in http mode).        |
| `ORIGIN`                    | derived   | Only to override the derived one.                                      |
| `HOST`, `TSUNDOKU_BIND_ANY` | —         | http mode only.                                                        |

## Undoing it

`tailscale serve --https=8443 off` removes the mapping. The app is then only
reachable from the workstation itself.

## A deploy reaches the tablet

The installed app stays open on the tablet for days, and an open app runs the
build it loaded. After a deploy, the server sends new data, but the old
screens don't know what to draw with it: on 2026-10-04 the downloading screens
(c94) showed on the desktop, opened fresh, and not on the tablet. It looked
like a desktop-only feature.

So the app asks for the build's version (`/_app/version.json`, which the
service worker leaves alone) every five minutes (`version.pollInterval` in
`vite.config.ts`) and whenever it comes back to the front. The first tap or
`goto()` after a deploy then loads the next screen whole, from the new build
(`src/routes/+layout.svelte`). Back and forward stay client-side, so history
doesn't jump. `tests/deploy-reload.e2e.ts` fakes a deploy and checks both.

A build without this (anything before it) still needs one manual reload on
each device: close the app fully, or pull down to reload.

## The server runs from a copy of the build

`yarn run serve` copies `build/` into `.serving/<timestamp>/` when it starts,
and runs from that copy. It deletes the copies older servers left behind.

This matters because `build/` is rebuilt in place, by `yarn run build` and by
every e2e run (Playwright builds before starting its preview server). A server
running straight out of `build/` lost its scripts and styles to the rebuild,
and crashed on the first request for one that was gone. On 2026-09-23 that
happened mid-chapter on the tablet: the first two pages arrived, then nothing.
With the copy, the live server keeps serving what it started with until it's
restarted.

To ship a change: `yarn run build`, then restart `yarn run serve`.

A release runs with `TSUNDOKU_SNAPSHOT=off` (its launcher sets it): it's
never rebuilt in place, and its folder may not be writable, so it serves
`build/` as it is ([`RELEASE.md`](RELEASE.md)).
