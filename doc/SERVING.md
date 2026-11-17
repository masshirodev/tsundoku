# Serving

tsundoku runs on one computer, the workstation, and is read on the household's
devices over a tailnet, the home Wi-Fi ([`WIFI.md`](WIFI.md)) or the computer
itself. Development is `yarn run dev`, on localhost with no token. What a
device opens is a build:

```sh
yarn run build
yarn run serve     # https://<machine>.<tailnet>.ts.net:8443
```

## From boot, and again when it stops

**A workstation serves a released bundle, the same one a friend's install
runs**, not a checkout, so a bug in the bundle (a missing plugin host, an
engine that can't load current extensions) shows there too. `ops/` holds the
units and the script that do it on a Linux machine; their paths (the data
folder on `/mnt/hdd2/tsundoku`, the timers' checkout beside the repo) are one
machine's, to edit for another.

`ops/systemd/tsundoku.service` runs `~/.local/opt/tsundoku/current/tsundoku
--foreground --no-browser`: the bundle's launcher, which starts the engine
(`engine.jar`, on 4590), FlareSolverr (unpacked into the data folder) and the
app, and stops all three on a stop. It starts at boot without anyone logged in
(the user lingers: `loginctl enable-linger`), and `Restart=always` brings it
back ten seconds after it stops. At boot tailscaled may not be up yet; `serve`
exits until it is, and the unit keeps trying (`StartLimitIntervalSec=0`).

```sh
# a release onto the workstation (after ops/release/smoke.sh passed it)
ops/workstation/install-release.sh 2026.11.01.1

# back to an older one: the same script ("Going back", below)
ops/workstation/install-release.sh 2026.11.01

# what it's doing
systemctl --user status tsundoku
journalctl --user -u tsundoku -f          # and <data folder>/logs/
```

`install-release.sh` unpacks the version's bundle into
`~/.local/opt/tsundoku/<version>` (its SHA-256 checked, and only a version
that passed the smoke test), moves the timers' checkout (`tsundoku-jobs`,
beside the repo) to the same tag, points `current` at it and restarts. Older
bundles stay beside it. **A change reaches the workstation only in a
release**, as it reaches friends: there is no `yarn run build && restart`
deploy.

### Going back

Going back is `install-release.sh` with the older version, because three things
have to move together: the bundle (`current`), the timers' checkout and the
units linked from it. Repointing `current` by hand and restarting would leave
the timers on the newer tag, running newer code than the server.

**Going back past a migration takes a restore as well.** The served app only
migrates forward, so an older bundle runs on a newer schema without a word, and
the timers, at the older tag, refuse it with "Deploy first" in their journals
(`journalctl --user -u tsundoku-ocr`). That line is the sign. The way out is the
snapshot from before the migration, `<db>-pre-v<N>-<stamp>.sqlite` in
`BACKUP_DIR` ([`BACKUPS.md`](BACKUPS.md), "Restoring"), and what was read or
rated since it is lost.

The settings are the data folder's `.env` ([`SECRETS.md`](SECRETS.md)); the
launcher reads it, and the timers get it through `EnvironmentFile=`. Because
it names a `TSUNDOKU_TOKEN`, the launcher keeps the token's sign-in instead
of a friend's password ([`SIGN-IN.md`](SIGN-IN.md)).

Development still runs `yarn run serve` from a checkout; the sections below
about snapshots and `yarn run serve` describe that.

## HTTPS, through `tailscale serve`

The reader needs a **secure context**. WebAuthn (the `/reveal` fingerprint gate),
the screen wake lock, and service workers (offline chapters, installing the
PWA) all refuse plain http. So `serve` does this, by default:

1. Asks `tailscale status` for this machine's tailnet name, and checks that it
   has an HTTPS certificate. MagicDNS and HTTPS certificates have to be on in
   the Tailscale admin console.
2. Starts the app on **127.0.0.1:42143** only. Nothing but the local proxy can
   reach it, which is tighter than binding the tailnet address.
3. Makes sure `tailscale serve` maps **https port 8443** to it, and adds the
   mapping if it's missing (`tailscale serve --bg --https=8443
http://127.0.0.1:42143`). The mapping persists across reboots. It's
   **tailnet only**, `serve` and never `funnel`.
4. Sets `ORIGIN` to `https://<tailnet name>:8443`, so every POST passes
   SvelteKit's origin check, and cookies are `Secure`.

Tailscale owns the certificate and renews it itself, so there are no `tailscale
cert` files to rotate. `tailscale serve` accepts HTTPS on 443, 8443 and 10000
only; tsundoku takes 8443 by default, leaving 443 to whatever else the machine
serves. `serve` never overwrites a port that something else serves: it stops
and says to pick another with `TSUNDOKU_HTTPS_PORT`.

The pure parts (reading the tailnet name, the origin, whether a port is free,
ours or taken) are in `src/lib/server/bind.ts`, tested in `tests/bind.spec.ts`.

## Which library it serves

A served bundle's database is `DATABASE_PATH` in the data folder's `.env`
(absolute: [`SECRETS.md`](SECRETS.md)). A checkout's `.env` is development's.

`yarn run dev` doesn't put `.env` into `process.env`, so development keeps the
sample library in `data/tsundoku.sqlite`. `/scan` in the served app rescans
`LIBRARY_ROOT`.

Every other folder (covers, trash, the engine's store, OCR scratch) comes from
`TSUNDOKU_HOME` ([`DISTRIBUTION.md`](DISTRIBUTION.md), "One data directory"),
and snapshots from `BACKUP_DIR`. Both are in `.env` for scripts run by hand and
in every unit, so a unit stays right even if a pull drops them. Unset, they're
the per-OS defaults, `~/.local/share/tsundoku` on Linux, which is also where
`yarn run dev` keeps its covers and trash.

## Who migrates

**The served app, and nothing else that touches the live database.** The
timers (`tsundoku-ocr`, `tsundoku-sync`, `tsundoku-backup`) run `scripts/*.ts`
from a checkout, and a timer running code newer than the server would migrate
the live database under a server that doesn't know the schema.

So their units set `TSUNDOKU_MIGRATE=off`, and `getDb()` then refuses any
database whose `user_version` differs from the code's migrations, in either
direction, without touching it. A timer run between an edit and its deploy
fails with "Deploy first" in its journal, and the first run after the deploy
works. The served app migrates on its first request after a restart, snapshot
first as always ([`BACKUPS.md`](BACKUPS.md)).

The timers run from `tsundoku-jobs`, a checkout at the installed release's tag
that `install-release.sh` moves with each release, so their code and the
server's are the same version. `TSUNDOKU_MIGRATE=off` is the guard if the two
ever drift.

A one-off script run by hand against the live library (`yarn run links`,
`yarn run import`, …) runs from `tsundoku-jobs` with the data folder's
settings, so it's the released code:
`cd ../tsundoku-jobs && set -a && . <data folder>/.env && set +a && yarn run links`.
From a development checkout, whose `.env` is development's, it touches the
sample library only.

## Plain http

`TSUNDOKU_SERVE=http yarn run serve` binds the tailnet address directly on
plain http. A wildcard bind is refused unless `TSUNDOKU_BIND_ANY=1` says so by
name: on a machine with no firewall, 0.0.0.0 would be the whole LAN. The
fingerprint gate, the wake lock and offline caching don't work this way.

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
  reads it from there after. That `.env` is read after the project's, so a
  token in the project's always wins; it's where a friend's install keeps every
  setting, since the program's folder may not be theirs to write. This holds
  in every mode.
- A value of `TSUNDOKU_SERVE` that isn't `https`, `http` or `local` is
  refused.

The pure parts (`serveMode`, `localOrigin`, `loopbackRedirect`) are in
`bind.ts`, and the token in `src/lib/server/first-run.ts`, tested in
`tests/bind.spec.ts` and `tests/first-run.spec.ts`.

## Where it serves: `serving.json`

On every start, in every mode, `serve` writes `TSUNDOKU_HOME/serving.json`:
`{ pid, mode, origin, listen }` (`Serving` in `bind.ts`, read back by
`readServing`). A release's launcher opens `origin` and probes `listen`
from it ([`RELEASE.md`](RELEASE.md), "The launcher"), since only local
mode's origin is localhost. Under systemd nothing reads it. A data folder that
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

The installed app stays open on a tablet for days, and an open app runs the
build it loaded. After a deploy the server sends new data, but the old screens
don't know what to draw with it: a new screen shows on a device that opened the
app fresh and not on one that kept it open, and looks like a feature of one
device.

So the app asks for the build's version (`/_app/version.json`, which the
service worker leaves alone) every five minutes (`version.pollInterval` in
`vite.config.ts`) and whenever it comes back to the front. The first tap or
`goto()` after a deploy then loads the next screen whole, from the new build
(`src/routes/+layout.svelte`). Back and forward stay client-side, so history
doesn't jump. `tests/deploy-reload.e2e.ts` fakes a deploy and checks both.

## The server runs from a copy of the build

`yarn run serve` copies `build/` into `.serving/<timestamp>/` when it starts,
and runs from that copy. It deletes the copies older servers left behind.

This matters because `build/` is rebuilt in place, by `yarn run build` and by
every e2e run (Playwright builds before starting its preview server). A server
running straight out of `build/` would lose its scripts and styles to the
rebuild, and fail mid-chapter on the first request for one that is gone. With
the copy, the live server keeps serving what it started with until it's
restarted.

To ship a change from a checkout: `yarn run build`, then restart
`yarn run serve`.

A release runs with `TSUNDOKU_SNAPSHOT=off` (its launcher sets it): it's
never rebuilt in place, and its folder may not be writable, so it serves
`build/` as it is ([`RELEASE.md`](RELEASE.md)).
