# Releases: bundles for friends' computers

How a tsundoku release is built, what's in it, and how it's tested
(c176, c178). Why there are releases at all, and what was decided about
them, is [`DISTRIBUTION.md`](DISTRIBUTION.md). Since 2026-11-01 (c228) the
workstation runs a release too, the same Linux bundle, installed with
`ops/workstation/install-release.sh` ([`SERVING.md`](SERVING.md)).

## Making one

```sh
git tag release/2026.10.29            # the commit to ship
yarn run release 2026.10.29           # both platforms, from that tag
ops/release/smoke.sh 2026.10.29       # every bundle, where tsundoku has never been
```

`yarn run release <version> --ref HEAD` builds a **trial** from a commit with
no tag (its `release.json` says `"trial": true`); `--platform win-x64` builds
one. Versions are dates, `YYYY.MM.DD[.N]`, as Lattice's are, and tags are
`release/<version>`, never `v*`.

Out come, under `/mnt/hdd2/tsundoku/release/out/<version>/`:

| File                                        | What                                             |
| ------------------------------------------- | ------------------------------------------------ |
| `tsundoku-<version>-win-x64.exe`            | the Windows installer (238 MB)                   |
| `tsundoku-<version>-win-x64.zip`            | the Windows bundle (293 MB on 2026-10-29)        |
| `tsundoku-<version>-linux-x64.tar.xz`       | the Linux bundle (237 MB)                        |
| `flaresolverr-3.4.6-<platform>.zip/.tar.gz` | FlareSolverr's own release, unmodified, optional |
| `SHA256SUMS`                                | all of the above                                 |

Nothing is published by this script: `yarn run release:publish <version>`
puts a smoke-tested version on dl.tsundoku.masshiro.pro, where friends
download it and installs find it ([`UPDATES.md`](UPDATES.md)).

## The Android TV app

The TV app ([`TV-APP.md`](TV-APP.md), c236) is its own Gradle build under
`android/tv/`, and **`yarn run release` does not build it**: nothing a bundle
carries changes because of it. An APK is made beside the bundles, with the
release's own version:

```sh
ops/release/tv-apk.sh 2026.11.02
# /mnt/hdd2/tsundoku/release/out/2026.11.02/tsundoku-tv-2026.11.02.apk
```

- **Signed** when `TSUNDOKU_TV_KEYSTORE`, `TSUNDOKU_TV_KEYSTORE_PASSWORD`,
  `TSUNDOKU_TV_KEY_ALIAS` and `TSUNDOKU_TV_KEY_PASSWORD` are set and the
  keystore exists; the keystore is the owner's and never in the repository
  (the steps to make one are in [`TV-APP.md`](TV-APP.md)).
- **`-debug`** otherwise: `tsundoku-tv-<version>-debug.apk`, debug-signed, for
  a TV at hand.
- Its line is appended to the release folder's `SHA256SUMS`, beside the
  bundles', so the same list covers everything in the folder.
- The version is also the app's user agent, `TsundokuTV/<version>`, which is
  what names a paired TV a TV in the computer's DEVICES.
- **Not in a bundle**: the APK is downloaded and installed on the TV
  separately (adb over the network, or a file), since a bundle is a
  friend's computer, not a television.
- **Unsigned debug builds and signed releases cannot update each other**, and
  `versionCode` stays 1 until a second APK ships.

Nothing about the APK runs in the smoke test: it needs a television, which the
smoke machines have not got.

## What `release` does

1. **The source is a commit.** The tag is checked out into a git worktree
   under `/mnt/hdd2/tsundoku/release/work/<version>`, beside a link to
   `~/projects/kotoba` (the app depends on `link:../kotoba`), installed with
   `--frozen-lockfile` and built with `TSUNDOKU_VERSION` set, which names the
   build so open tabs reload onto it. kotoba and tsundoku-engine must be
   committed; the engine's commit must be pushed, so a friend who asks for
   its source can have it.
2. **Only what the server loads ships.** The packer reads the server build's
   imports (rollup writes each at the start of a line) and installs just
   those packages: five on 2026-10-29 (`better-sqlite3`, `sharp`,
   `htmlparser2`, `@simplewebauthn/server` and `/browser`). The rest of
   `dependencies` (the fonts, hls.js, the adapter and its rollup, kotoba) is
   compiled into `build/`. An import that isn't a dependency fails the
   release, and so does one of `kotoba`, which must stay bundled.
3. **Each platform's native modules.** The production install runs with
   `--pure-lockfile --ignore-scripts --ignore-platform` (the lockfile's
   versions, every `@img/sharp-*` variant), then keeps only the target's
   `@img` packages and fetches `better-sqlite3`'s prebuilt binary for the
   target with `prebuild-install --platform <os> --target <node version>`.
4. **The engine** is tsundoku-engine's shadow jar, built by its own
   `scripts/test.sh :server:shadowJar` in a JDK container.
5. **The rest is pinned** in `ops/release/versions.json`: each file's URL
   and SHA-256, downloaded once into `/mnt/hdd2/tsundoku/release/cache` and
   checked every time (a mismatch deletes the file and fails).
6. **The tray** ([`TRAY.md`](TRAY.md)) is built from the tag's
   `ops/release/tray/` with the workstation's Go: `tsundoku.exe` for
   Windows (a GUI program, checked in its PE header, with the icon and
   version info from go-winres), `launcher/tsundoku-tray` for Linux. The Go
   version goes into `release.json`, and the modules linked in go into
   `THIRD-PARTY-NOTICES.txt`.
7. **The bundle** gets the launcher, `LICENSE`, `README.txt` (the friend's
   instructions, `ops/release/README.txt`), `release.json` (every commit and
   version in it) and `THIRD-PARTY-NOTICES.txt`, then is zipped (Windows) or
   tarred with xz (Linux).

## Pinned

| Component    | Version (2026-10-29)      | Why this one                                                                   |
| ------------ | ------------------------- | ------------------------------------------------------------------------------ |
| Node         | 24.16.0                   | the workstation's (mise). Only the program and its licence ship.               |
| JRE          | Temurin 21.0.13+9         | the engine needs Java 21 (its image is `distroless/java21`).                   |
| ffmpeg       | BtbN n8.1.3, LGPL, shared | LGPL rather than GPL; the shared build is half the size. `ffplay` is left out. |
| fpcalc       | chromaprint 1.6.2         | the ffmpeg above has no chromaprint muxer, so openings and endings need it.    |
| FlareSolverr | 3.4.6                     | the version the workstation's compose file runs.                               |

BtbN deletes old builds after a while, which is what the cache is for. To
change a pin, take the new file's checksum from its project (Node's
`SHASUMS256.txt`, Adoptium's API, GitHub's asset digest), never from a
download of your own, and say so in the commit.

**fpcalc is chromaprint's own release** (`acoustid/chromaprint` v1.6.2,
`chromaprint-fpcalc-1.6.2-linux-x86_64.tar.gz` and `…-windows-x86_64.zip`),
pinned by the digests GitHub publishes for those assets
(`c968ad4a0821592a79b158fb2e1f46cbe0a22a0a1dbc0743c67d68e75d15d2bb` and
`b74369726676670af3ab0eadff45f960cf969fdf4a87a971ba37eaf8d530e874`), so
neither is a digest of our own download. The alternative — an ffmpeg build
with the chromaprint muxer — was not taken: the pinned build was measured to
have none, and no LGPL build of it with one was found, so a bundle carrying
chromaprint's own program is the certain way.

## What's in a bundle

```
tsundoku/
  tsundoku.exe | tsundoku     what a friend runs: the tray (doc/TRAY.md)
  tsundoku.cmd                Windows: the launcher in a window, as before the tray
  launcher/launch.ts, plan.ts, tray.ts, log.ts
  launcher/tsundoku-tray      Linux: the tray, which ./tsundoku hands over to
  app/                        build/, scripts/serve.ts and the four modules it imports, node_modules/
  node/                       node.exe | bin/node
  jre/                        Temurin
  engine/engine.jar
  ffmpeg/bin (+ lib on Linux)
  fpcalc/            chromaprint's fpcalc: openings and endings need it (c297)
  LICENSE  README.txt  release.json  THIRD-PARTY-NOTICES.txt
  flaresolverr/               only once its optional archive is unzipped here
```

## The installer

`ops/release/installer/tsundoku.nsi`, built by `release` for Windows with
NSIS's own `makensis`, which runs natively on Linux (the `nsis` package): no
Wine, no Windows. Inno Setup, which the plan named, would have needed Wine for
every build. Named `tsundoku-<version>-win-x64.exe`, never `*setup*.exe`:
Windows treats that name as an installer to elevate and shims.

- **Per user**, into `%LOCALAPPDATA%\Programs\tsundoku` (as VS Code's user
  installer does), with no administrator prompt.
- A **Start-menu entry**, for `tsundoku.exe`, the tray; **start at sign-in**
  is a checkbox, off by default, and starts it in the tray without opening
  the browser.
- A second Start-menu entry, **Reset tsundoku password**
  (`tsundoku.cmd --reset-password`, [`SIGN-IN.md`](SIGN-IN.md)), in a window,
  since it has something to say.
- An entry in **Settings > Apps**, whose uninstaller removes what the
  installer put there **by name** (the program's folders and files, its
  shortcuts, its registry keys), then the folder only if it's empty. Never
  the folder whole: the directory page lets a friend pick any folder.
- **The data folder is never touched**, by uninstalling or updating. An
  update is the new installer run over the old one: it stops a running
  tsundoku, replaces the program's folders whole so nothing of the old
  version lingers, and keeps a FlareSolverr unzipped beside it.
- It stops a running tsundoku **through WMI** (`Win32_Process.ExecutablePath`),
  only processes run from its folder, twice a second apart in case the
  launcher restarted a helper. Not `Get-Process`: the installer is 32-bit, so
  its `powershell` is too, and a 32-bit `Get-Process` can't read a 64-bit
  process's path. On Zen it matched none of tsundoku's three processes, and
  the update and the uninstall then failed on locked files.
- The icon is the app's typeset 積 (`installer/icon.sh` makes `tsundoku.ico`
  from `static/icons/icon-512.png`, cropping the small sizes to the glyph).
- **Unsigned**: SmartScreen warns, and the README says what to click. Signing
  is a decision of its own (a certificate costs money every year).

The launcher, not the installer, finds FlareSolverr: in the data folder
first, where it outlives reinstalls, then beside the program.

## The launcher

Since c222 a friend starts the **tray** ([`TRAY.md`](TRAY.md)):
`tsundoku.exe`, or `./tsundoku`, which hands over to it. The tray runs the
launcher with `--tray` and no window. It shows an icon with OPEN, the logs
and QUIT, and started again it opens the running copy. `tsundoku.cmd` and
`./tsundoku --foreground` still run the launcher in a window, as below.

The launcher is `launcher/launch.ts`, run with the bundle's Node. It:

1. finds the data folder (`TSUNDOKU_HOME`, else the platform's: see
   [`DISTRIBUTION.md`](DISTRIBUTION.md), "One data directory"), reading the
   default folder's `.env` first, since it may point `TSUNDOKU_HOME`
   elsewhere, then that folder's own;
2. makes `ENGINE_TOKEN` there on a first start. The app's sign-in is a
   password the friend chooses in the browser on first open
   (`TSUNDOKU_LOGIN=password`, [`SIGN-IN.md`](SIGN-IN.md)), unless the data
   folder's `.env` names a `TSUNDOKU_TOKEN` (the workstation's own install,
   c228); `--reset-password` forgets it and exits;
3. if a tsundoku already answers on the port, opens it and exits;
4. starts the engine (`java -jar`, `ENGINE_HOST=127.0.0.1`, its APKs,
   preferences and app folder under `engine/` in the data folder) and
   FlareSolverr if present (`HOST=127.0.0.1`), each logging to `logs/`, and
   starts either again if it stops. On Linux it first renames FlareSolverr's
   own `_internal/libreadline.so.8` to `.bundled-off` (`solverSetAside`):
   its PyInstaller build lends that folder to the `/bin/sh` it asks for
   Chrome's version, and a bash built on readline 8.3 (Arch's) then dies on
   `rl_print_keybinding`, so FlareSolverr exits on every start. Found on the
   workstation, 2026-11-01; Debian stable's older bash, where the smoke test
   runs, never showed it;
5. starts the app (`TSUNDOKU_SERVE=local`,
   `TSUNDOKU_SNAPSHOT=off`, the database in the data folder, the engine's
   and ffmpeg's addresses), and opens the browser once it answers
   (`--no-browser` or `TSUNDOKU_NO_BROWSER=1` not to), **where the app says
   it serves** (below);
6. stops everything when the app stops, the window closes, or the tray says
   `quit` or goes away (`taskkill /T`
   on Windows, the process group elsewhere), so FlareSolverr's Chrome goes
   too. A closed terminal is a SIGHUP to the launcher alone, since the app
   and the engine run in process groups of their own; until 2026.10.30.2 it
   was handled only on Windows, and on Linux both outlived the launcher
   (c187).

Run by the tray, its own lines go to `logs/launcher.log` too, and it waits
for no Enter ([`TRAY.md`](TRAY.md), "Talking to the launcher").

**The app's output goes to `logs/tsundoku.log`**, like the helpers', not to
the window, each line stamped and the file rotated ([`LOGS.md`](LOGS.md)). Selecting text in a Windows console (QuickEdit) stops whatever
writes to it until Enter or Esc, so an app writing there froze mid-request
while a friend copied the token from it: suspected behind a "500 NetworkError"
right after signing in on 2026.10.30 (not reproduced; c189). The window shows
only the launcher's own lines, and if the app stops by itself, the last
twelve lines of its log, waiting for Enter on Windows so they can be read.

**Where it opens.** `serve.ts` writes `serving.json` to the data folder on
every start: its pid, its mode, its origin and the address it listens on
(`Serving` in `src/lib/server/bind.ts`). The launcher deletes the file
before it starts the app, waits for one with the app's pid, probes its
`listen` address and opens its `origin`. Only local mode's origin is
`http://localhost`: with `TSUNDOKU_SERVE=https` it's the tailnet name
(`https://<pc>.<tailnet>.ts.net:8443`) and with `http` the tailnet address,
and a page opened on localhost there can't save (the origin check) or, in
`http` mode, doesn't load at all. Release 2026.10.30 always opened
localhost, so Tailscale didn't work in it (c186). A second start finds the
running one the same way: the last `serving.json`'s address first, then
localhost.

On Windows, `serve.ts` runs `tailscale.exe` from Program Files: Tailscale's
installer doesn't put it on PATH.

What it runs, with which environment, is `ops/release/launcher/plan.ts`,
pure and tested for both platforms in `tests/release-plan.spec.ts`. The data
folder's `.env` can set `PORT`, `ENGINE_PORT`, `SOLVER_PORT`,
`TSUNDOKU_SERVE` (`https` puts it on the tailnet, as on the workstation; the
friend's README, "Reading on your phone or tablet", says how) and
`DATABASE_PATH`.

**What a release runs without a build** (the launcher, serve.ts and the server
modules it carries) is TypeScript run by Node's own type stripping, which
refuses some TypeScript: parameter properties, enums, namespaces.
`tests/strip-types.spec.ts` parses each of them that way; Vitest and the
typecheck can't tell (2026.10.30.8's first build died on a launcher class's
`constructor(readonly file: string)`, caught by the smoke test).

## Smoke test

`ops/release/smoke.sh <version>` runs every bundle on a machine that has
never seen tsundoku, **with the tests the release was tagged with**: it checks
`release/<version>` out (under `smoke-src/`) and runs that copy's smoke.sh, so
a later commit's tests never judge an older release (2026.10.30.5's first run
did, and failed on a stage it couldn't have). The release script likewise
takes the server modules a bundle carries from the tag's own imports
(`ops/release/modules.ts`), not from a list in whichever copy runs it.

Imports don't reach everything: the novels plugin host is a file the server
**forks by path**, and the packages it lends to plugins (cheerio, dayjs,
htmlparser2, `@noble/ciphers`, protobufjs) appear in no import of the build.
2026.10.31.3 shipped without either, so every novel source on every desktop
install said THE PLUGIN HOST STOPPED. `modules.ts` now also carries any file
named as a quoted `'src/lib/server/...'` in `src/` (`spawnedFiles`), and the
packages those files `require` (`spawnedPackages`). A new file the server
starts by path is found the same way, as long as its path is written whole.

- **Linux** in a bare `debian:stable-slim` container: no Node, no Java, no
  ffmpeg, only what the bundle carries.
- **Windows** on Zen ([`WINDOWS-VM.md`](WINDOWS-VM.md)): `zen.sh up`, copy
  the bundle in, `ops/release/smoke/windows.ps1`, `zen.sh down`, so Zen is
  left as it was.

Each unzips the bundle, puts the importer specs' synthesised Mihon library
(`tests/helpers/mihon-fixture.ts`) in the data folder, starts the launcher
and runs `ops/release/smoke/probe.mjs` with the bundle's Node: 127.0.0.1 is
sent to localhost, the first-run token signs in, five screens answer, the
engine answers with its token and refuses without it, a scan imports the
fixture's seven series and refuses its one broken file, every visible
chapter's first page is an image, the hidden local books stay hidden, and
the novels plugin host, started as the server starts it, loads a plugin that
requires each library it lends (no network: c227 would have failed here).
First comes the **fingerprint** step (`smoke/fingerprint.sh`,
`smoke/fingerprint.ps1`, c297): the bundle's own ffmpeg makes a tone and the
bundle's own `fpcalc` must make points of it. Both binaries are named from
the bundle, never from PATH: this workstation's Arch `fpcalc` passing is
exactly how a bundle without one shipped, and a step that names PATH would
pass here while every friend's season fell back to AniSkip alone.
On Linux, the launcher (`./tsundoku --foreground`) is then hung up as a
closed terminal does, and nothing of the bundle may be left running (c187: on
2026.10.30.1, two were). Then the tray (`smoke/linux-tray.sh`): `./tsundoku`
returns, leaving tsundoku running in a session of its own; a second start
opens it and starts nothing; `--quit` stops everything ([`TRAY.md`](TRAY.md),
"Tests"). On Windows, `windows.ps1` does the same with `tsundoku.exe`, then
checks `tsundoku.cmd` still starts it in a window.
Then the paths (c183, [`DISTRIBUTION.md`](DISTRIBUTION.md), "Windows
paths"): no series path stored with a backslash, a DELETE moves the series'
file into the trash and out of the library, and a GROUP of the two local
books takes the folder they share as its path. Run on the bundle before c183,
the first two failed on Windows; since, all pass on both.
On Windows it also checks that nothing listens beyond 127.0.0.1 and that no
`java` or `node` outlives the launcher. Then the installer
(`smoke/windows-installer.ps1`): a silent install puts the program, the
Start-menu entry and the Apps entry in place (and no start at sign-in), the
probe passes on the installed copy, a second install while it runs stops it
and leaves the program whole, it starts again on the same data with no new
token, and the uninstaller removes the program, its shortcut and its Apps
entry, keeps the data folder, and leaves nothing running. 2026-10-29: all passed on both.

**On Tailscale** (c186), only when `TSUNDOKU_SMOKE_TAILSCALE_KEY` holds an
ephemeral auth key from the tailnet's admin console (Settings > Keys), since
nothing else can put Zen on a tailnet unattended. The owner made one on
2026-10-30 (reusable, ephemeral, 90 days: renew it each quarter; an expired
one fails the stage, never skips it) and keeps it in `~/.config/myconf/.env`,
which interactive shells load. A shell started before a change there doesn't
have it: `set -a; . ~/.config/myconf/.env; set +a` first.
`smoke/windows-tailscale.ps1 -Key` installs Tailscale, joins as
`zen-tsundoku-smoke-<MMDDhhmmss>`, a name of its own each run, writes the README's `TSUNDOKU_SERVE=https` into the
data folder's `.env`, starts the launcher and runs `smoke/probe-tailnet.mjs`:
`serving.json` says https on the tailnet name, the launcher opened that and
not localhost, a second start finds it, the token signs in through
`tailscale serve` with its certificate, three screens answer there, and a
save from localhost is refused (why it opens the tailnet address). Then it
removes the serve mapping and logs out, and the snapshot takes Tailscale
away. 2026-10-30, on 2026.10.30.1's bundle: all passed, with Zen signed in
by hand instead of a key. The first request there took 4 s, Tailscale
fetching the certificate; the probe waits up to a minute for it, since once
it outlasted fetch's 10 s connect timeout.

**Why a new name each run.** Zen comes back from its snapshot as a new
node, so every run asks Let's Encrypt for a certificate, and Let's Encrypt
issues at most five a week for one exact name. With the one fixed name,
2026.10.30.9's smoke failed twice on the probe's connect timeout: Tailscale's
log on Zen said `429 rateLimited: too many certificates (5) already issued for
this exact set of identifiers`. A name per run spends the tailnet's other
budget instead: 50 certificates a week for `example.ts.net` as a whole
(`ts.net` is a public suffix, so each tailnet counts as its own domain),
shared with the owner's own machines. A day of many releases fits; a loop of
smoke runs would not. Each run's node is ephemeral and leaves the admin
console by itself after it logs out.

**The updater** (`smoke/windows-update.ps1`, [`UPDATES.md`](UPDATES.md),
"Tests"): offered a signed pretend 9999.01.01 by Zen itself, UPDATE downloads,
checks and runs the installer, and tsundoku comes back by itself on the same
data. A run of smoke.sh that passes on every platform writes `out/<v>/.smoked`,
which publishing requires.

## Not in a release yet

- **macOS.** No machine to test it on, and FlareSolverr publishes no macOS
  build. The resolver and the launcher already know its paths.
- **JMdict lookups.** The dictionary isn't shipped (74 MB, built from
  EDRDG's data); without it, lookups are simply off (`KOTOBA_JMDICT`,
  [`JAPANESE.md`](JAPANESE.md)).
- **Updating in place on Linux**: there, UPDATE is a download and steps.
