# Releases: bundles for other people's computers

How a tsundoku release is built, what's in it, and how it's tested. Why there
are releases at all, and what was decided about them, is
[`DISTRIBUTION.md`](DISTRIBUTION.md). A served copy runs a release too, the
same Linux bundle, installed with `ops/workstation/install-release.sh`
([`SERVING.md`](SERVING.md)).

## Making one

```sh
git push origin main                  # the commit to ship, on origin first
git tag release/2026.10.29            # the commit to ship
git push origin release/2026.10.29    # the tag too: git push never sends one by itself
yarn run release 2026.10.29           # both platforms, from that tag
ops/release/android-apk.sh 2026.10.29 # both apps, from that tag, with the keystore
ops/release/smoke.sh 2026.10.29       # every bundle, where tsundoku has never been
                                      # (`… linux-x64` alone is enough to install, not to publish)
$EDITOR ops/release/notes/2026.10.29.txt
yarn run release:publish 2026.10.29   # this reaches every install
```

`yarn run release <version> --ref HEAD` builds a **trial** from a commit with
no tag (its `release.json` says `"trial": true`); `--platform win-x64` builds
one. Versions are dates, `YYYY.MM.DD[.N]`, and tags are `release/<version>`,
never `v*`.

**The tag goes to origin as soon as it is made**, before anything is built.
No build depends on it (`release`, `android-apk.sh` and `smoke.sh` read the
local tag, and nothing on GitHub listens for one: `site.yml` is the only
workflow). It is pushed because it is the release's only record of its source:
it says which commit an installed bundle came from, `install-release.sh`
fetches it from origin for the timers' checkout, and a tag on one disk alone is
lost with that disk. A version whose build or smoke test fails keeps its tag,
and the fix is the next `.N`.

Out come, under `$RELEASE_DIR/out/<version>/` (`RELEASE_DIR` defaults to
`/mnt/hdd2/tsundoku/release`):

| File                                        | What                                             |
| ------------------------------------------- | ------------------------------------------------ |
| `tsundoku-<version>-win-x64.exe`            | the Windows installer (about 240 MB)             |
| `tsundoku-<version>-win-x64.zip`            | the Windows bundle (about 290 MB)                |
| `tsundoku-<version>-linux-x64.tar.xz`       | the Linux bundle (about 240 MB)                  |
| `flaresolverr-3.4.6-<platform>.zip/.tar.gz` | FlareSolverr's own release, unmodified, optional |
| `SHA256SUMS`                                | all of the above                                 |

Nothing is published by this script: `yarn run release:publish <version>`
puts a smoke-tested version on dl.tsundoku.masshiro.pro, where people
download it and installs find it ([`UPDATES.md`](UPDATES.md)).

## The Android apps

The TV app ([`ANDROID.md`](ANDROID.md)) and the phone and tablet app
([`ANDROID.md`](ANDROID.md)) are two flavors of one Gradle build
under `android/`, and **`yarn run release` builds neither**: nothing a
bundle carries changes because of them. The APKs are made beside the
bundles, with the release's own version:

```sh
ops/release/android-apk.sh 2026.11.05             # both
ops/release/android-apk.sh 2026.11.05 --app phone # the phone and tablet app alone
ops/release/tv-apk.sh 2026.11.05                  # the TV app alone (--app tv)
# $RELEASE_DIR/out/2026.11.05/tsundoku-tv-2026.11.05.apk
# $RELEASE_DIR/out/2026.11.05/tsundoku-app-2026.11.05.apk

ops/release/android-apk.sh 0.0.0-trial --ref HEAD --out temp/apk # a trial
```

- **Built from the tag**, as the bundles are: a clean worktree of
  `release/<version>` under `$RELEASE_DIR/work/android-<version>`, whatever
  this checkout holds, and a version with no tag is refused, so an APK never
  carries a later commit, or uncommitted edits, signed under the tag's
  version. `--ref <commit>` builds a **trial**, which needs its own `--out`,
  so it can't land in a release's folder under the names `release:publish`
  ships. To try uncommitted work on a device, run Gradle directly
  ([`ANDROID.md`](ANDROID.md)). `tests/release-apk.spec.ts` runs the script
  against a pretend gradlew in a throwaway repository.
- **Signed** when `TSUNDOKU_TV_KEYSTORE`, `TSUNDOKU_TV_KEYSTORE_PASSWORD`,
  `TSUNDOKU_TV_KEY_ALIAS` and `TSUNDOKU_TV_KEY_PASSWORD` are set and the
  keystore exists; the keystore is the publisher's and never in the
  repository (the steps to make one are in [`ANDROID.md`](ANDROID.md)). **One
  key signs both apps** (the two APKs carry the same certificate), and the
  variables keep the `TSUNDOKU_TV_` names from when the TV app was the only
  one.
- **`-debug`** otherwise: `tsundoku-tv-<version>-debug.apk` and
  `tsundoku-app-<version>-debug.apk`, debug-signed, for a device at hand.
- Each APK's line is appended to the release folder's `SHA256SUMS`, beside
  the bundles', so the same list covers everything in the folder.
- The version is also each app's user agent: `TsundokuTV/<version>` names a
  paired TV a TV in the computer's DEVICES, `TsundokuApp/<version>` a phone or
  tablet the app (`PHONE · APP`).
- **Not in a bundle, but in the release**: `release:publish` puts both
  APKs on the release host beside the bundles, signed into `latest.json`, and
  refuses a version without them. So run `android-apk.sh` before
  `release:publish`, with the keystore set. An installed app finds the next
  one by itself ([`UPDATES.md`](UPDATES.md), "The Android apps").
- **The website offers them too**: 04 — DOWNLOAD has a row for each app when
  the published `latest.json` carries `files.android.app` /
  `files.android.tv`, with the name, size and SHA-256 the manifest signs, and
  06 and the phone band name the app in the same breath. A release without
  them leaves the page without those rows, so the site needs no change: the
  next deploy reads the new manifest ([`WEBSITE.md`](WEBSITE.md), "The
  visitor's system").
- **`versionCode` is the date version** (YYYYMMDDNN), so every release
  installs over the one before.
- **Unsigned debug builds and signed releases cannot update each other.**

Nothing about the APKs runs in the smoke test: it needs a television or a
phone, which the smoke machines have not got.

## What `release` does

1. **The source is a commit.** The tag is checked out into a git worktree
   under `$RELEASE_DIR/work/<version>`, beside a link to the `kotoba`
   checkout next to this one (the app depends on `link:../kotoba`), installed
   with `--frozen-lockfile` and built with `TSUNDOKU_VERSION` set, which names
   the build so open tabs reload onto it. kotoba and tsundoku-engine must be
   committed; the engine's commit must be pushed, so anyone who asks for its
   source can have it.
2. **Only what the server loads ships.** The packer reads the server build's
   imports (rollup writes each at the start of a line) and installs just
   those packages, a handful (`better-sqlite3`, `sharp`, `htmlparser2`,
   `@simplewebauthn/server` and `/browser`, among them). The rest of
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
   and SHA-256, downloaded once into `$RELEASE_DIR/cache` and checked every
   time (a mismatch deletes the file and fails).
6. **The tray** ([`TRAY.md`](TRAY.md)) is built from the tag's
   `ops/release/tray/` with the building machine's Go: `tsundoku.exe` for
   Windows (a GUI program, checked in its PE header, with the icon and
   version info from go-winres), `launcher/tsundoku-tray` for Linux. The Go
   version goes into `release.json`, and the modules linked in go into
   `THIRD-PARTY-NOTICES.txt`.
7. **The bundle** gets the launcher, `LICENSE`, `README.txt` (the user's
   instructions, `ops/release/README.txt`), `release.json` (every commit and
   version in it) and `THIRD-PARTY-NOTICES.txt`, then is zipped (Windows) or
   tarred with xz (Linux).

## Pinned

| Component    | Version                   | Why this one                                                                   |
| ------------ | ------------------------- | ------------------------------------------------------------------------------ |
| Node         | 24.16.0                   | the development toolchain's. Only the program and its licence ship.            |
| JRE          | Temurin 21.0.13+9         | the engine needs Java 21 (its image is `distroless/java21`).                   |
| ffmpeg       | BtbN n8.1.3, LGPL, shared | LGPL rather than GPL; the shared build is half the size. `ffplay` is left out. |
| FlareSolverr | 3.4.6                     | the version the development compose file runs.                                 |

`ops/release/versions.json` is the source of truth; this table is what it
pins as written. BtbN deletes old builds after a while, which is what the
cache is for. To change a pin, take the new file's checksum from its project
(Node's `SHASUMS256.txt`, Adoptium's API, GitHub's asset digest), never from
a download of your own, and say so in the commit.

**The pinned ffmpeg fingerprints by itself.** It is built `--enable-chromaprint`
on both platforms: `ffmpeg -hide_banner -muxers` prints `E chromaprint
Chromaprint`, and a six-second tone through `-f chromaprint -fp_format raw`
gives 108 bytes, 27 points, exactly what `fpcalc` gives for the same tone
(measured on the pinned Linux archive, sha256 `6d2016ff…`). So a bundle needs
no chromaprint program beside it (`src/lib/server/anime/fingerprint.ts`
prefers the muxer), and the smoke test checks that the bundle's own ffmpeg
still can make points: a future pin without the muxer is the risk, not this
one. A distribution's ffmpeg may have no muxer (Arch's has none), so its
`fpcalc` from the `chromaprint` package is the development route
([`DISTRIBUTION.md`](DISTRIBUTION.md), "External binaries").

## What's in a bundle

```
tsundoku/
  tsundoku.exe | tsundoku     what a user runs: the tray (doc/TRAY.md)
  tsundoku.cmd                Windows: the launcher in a window
  launcher/launch.ts, plan.ts, tray.ts, log.ts
  launcher/tsundoku-tray      Linux: the tray, which ./tsundoku hands over to
  app/                        build/, scripts/serve.ts and the four modules it imports, node_modules/
  node/                       node.exe | bin/node
  jre/                        Temurin
  engine/engine.jar
  ffmpeg/bin (+ lib on Linux)
  LICENSE  README.txt  release.json  THIRD-PARTY-NOTICES.txt
  flaresolverr/               only once its optional archive is unzipped here
```

## The installer

`ops/release/installer/tsundoku.nsi`, built by `release` for Windows with
NSIS's own `makensis`, which runs natively on Linux (the `nsis` package): no
Wine, no Windows. Inno Setup would need Wine for every build. Named
`tsundoku-<version>-win-x64.exe`, never `*setup*.exe`: Windows treats that
name as an installer to elevate and shims.

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
  the folder whole: the directory page lets the user pick any folder.
- **The data folder is never touched**, by uninstalling or updating. An
  update is the new installer run over the old one: it stops a running
  tsundoku, replaces the program's folders whole so nothing of the old
  version lingers, and keeps a FlareSolverr unzipped beside it.
- It stops a running tsundoku **through WMI** (`Win32_Process.ExecutablePath`),
  only processes run from its folder, twice a second apart in case the
  launcher restarted a helper. Not `Get-Process`: the installer is 32-bit, so
  its `powershell` is too, and a 32-bit `Get-Process` can't read a 64-bit
  process's path, so it matches none of tsundoku's three processes and the
  update and the uninstall then fail on locked files.
- The icon is the app's typeset 積 (`installer/icon.sh` makes `tsundoku.ico`
  from `static/icons/icon-512.png`, cropping the small sizes to the glyph).
- **Unsigned**: SmartScreen warns, and the README says what to click. Signing
  is a decision of its own (a certificate costs money every year).

The launcher, not the installer, finds FlareSolverr: in the data folder
first, where it outlives reinstalls, then beside the program.

## The launcher

A user starts the **tray** ([`TRAY.md`](TRAY.md)): `tsundoku.exe`, or
`./tsundoku`, which hands over to it. The tray runs the launcher with `--tray`
and no window. It shows an icon with OPEN, the logs and QUIT, and started
again it opens the running copy. `tsundoku.cmd` and `./tsundoku --foreground`
run the launcher in a window, as below.

The launcher is `launcher/launch.ts`, run with the bundle's Node. It:

1. finds the data folder (`TSUNDOKU_HOME`, else the platform's: see
   [`DISTRIBUTION.md`](DISTRIBUTION.md), "One data directory"), reading the
   default folder's `.env` first, since it may point `TSUNDOKU_HOME`
   elsewhere, then that folder's own;
2. makes `ENGINE_TOKEN` there on a first start. The app's sign-in is a
   password the user chooses in the browser on first open
   (`TSUNDOKU_LOGIN=password`, [`SIGN-IN.md`](SIGN-IN.md)), unless the data
   folder's `.env` names a `TSUNDOKU_TOKEN`; `--reset-password` forgets it
   and exits;
3. if a tsundoku already answers on the port, opens it and exits;
4. starts the engine (`java -jar`, `ENGINE_HOST=127.0.0.1`, its APKs,
   preferences and app folder under `engine/` in the data folder, and
   `ENGINE_WEBVIEW=on` only where SETTINGS' WEBVIEW switch,
   `engine/webview.json`, is on: off on an install unless it is turned on;
   the switch is read at every engine start and watched, and a change
   restarts the engine: [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md),
   "tsundoku's side") and
   FlareSolverr if present (`HOST=127.0.0.1`), each logging to `logs/`, and
   starts either again if it stops. On Linux it first renames FlareSolverr's
   own `_internal/libreadline.so.8` to `.bundled-off` (`solverSetAside`):
   its PyInstaller build lends that folder to the `/bin/sh` it asks for
   Chrome's version, and a bash built on readline 8.3 (Arch's) then dies on
   `rl_print_keybinding`, so FlareSolverr exits on every start. Debian
   stable's older bash, where the smoke test runs, never shows it. It sets
   aside the bundled half of NSS the same way (`libnss3`, `libnssutil3`,
   `libsmime3`, `libnspr4`, `libplc4`, `libplds4`; `SOLVER_NSS`): the build
   has no `libsoftokn3`, so NSS loads the system's, and Arch's 3.129 one needs
   `NSSUTIL_3.108`, which the bundled nssutil lacks. NSS then fails to start,
   and Chrome aborts on the first certificate it checks (`FATAL:
nss_error=-5925`, a SIGABRT core per solve), so every HTTPS solve answers
   "the browser has closed the connection"; a solve of example.com reproduces
   it in one request;
5. starts the app (`TSUNDOKU_SERVE=local`,
   `TSUNDOKU_SNAPSHOT=off`, the database in the data folder, the engine's
   and ffmpeg's addresses), and opens the browser once it answers
   (`--no-browser` or `TSUNDOKU_NO_BROWSER=1` not to), **where the app says
   it serves** (below);
6. stops everything when the app stops, the window closes, or the tray says
   `quit` or goes away (`taskkill /T` on Windows, the process group
   elsewhere), so FlareSolverr's Chrome goes too. A closed terminal is a
   SIGHUP to the launcher alone, since the app and the engine run in process
   groups of their own, so the launcher handles SIGHUP on every platform and
   stops them.

Run by the tray, its own lines go to `logs/launcher.log` too, and it waits
for no Enter ([`TRAY.md`](TRAY.md), "Talking to the launcher").

**The app's output goes to `logs/tsundoku.log`**, like the helpers', not to
the window, each line stamped and the file rotated ([`LOGS.md`](LOGS.md)).
Selecting text in a Windows console (QuickEdit) stops whatever writes to it
until Enter or Esc, so an app writing there would freeze mid-request while
someone copied the token from it. The window shows only the launcher's own
lines, and if the app stops by itself, the last twelve lines of its log,
waiting for Enter on Windows so they can be read.

**Where it opens.** `serve.ts` writes `serving.json` to the data folder on
every start: its pid, its mode, its origin and the address it listens on
(`Serving` in `src/lib/server/bind.ts`). The launcher deletes the file
before it starts the app, waits for one with the app's pid, probes its
`listen` address and opens its `origin`. Only local mode's origin is
`http://localhost`: with `TSUNDOKU_SERVE=https` it's the tailnet name
(`https://<pc>.<tailnet>.ts.net:8443`) and with `http` the tailnet address,
and a page opened on localhost there can't save (the origin check) or, in
`http` mode, doesn't load at all. A second start finds the running one the
same way: the last `serving.json`'s address first, then localhost.

On Windows, `serve.ts` runs `tailscale.exe` from Program Files: Tailscale's
installer doesn't put it on PATH.

What it runs, with which environment, is `ops/release/launcher/plan.ts`,
pure and tested for both platforms in `tests/release-plan.spec.ts`. The data
folder's `.env` can set `PORT`, `ENGINE_PORT`, `SOLVER_PORT`,
`TSUNDOKU_SERVE` (`https` puts it on the tailnet; the README, "Reading on
your phone or tablet", says how) and `DATABASE_PATH`.

**What a release runs without a build** (the launcher, serve.ts and the server
modules it carries) is TypeScript run by Node's own type stripping, which
refuses some TypeScript: parameter properties, enums, namespaces.
`tests/strip-types.spec.ts` parses each of them that way; Vitest and the
typecheck can't tell (a launcher class's `constructor(readonly file: string)`
would pass both and kill the bundle at start).

## Smoke test

`ops/release/smoke.sh <version>` runs every bundle on a machine that has
never seen tsundoku, **with the tests the release was tagged with**: it checks
`release/<version>` out (under `smoke-src/`) and runs that copy's smoke.sh, so
a later commit's tests never judge an older release, which may lack a stage
they check. The release script likewise takes the server modules a bundle
carries from the tag's own imports (`ops/release/modules.ts`), not from a list
in whichever copy runs it.

Imports don't reach everything: the novels plugin host is a file the server
**forks by path**, and the packages it lends to plugins (cheerio, dayjs,
htmlparser2, `@noble/ciphers`, protobufjs) appear in no import of the build.
Without them every novel source on every desktop install would say THE PLUGIN
HOST STOPPED. So `modules.ts` also carries any file named as a quoted
`'src/lib/server/...'` in `src/` (`spawnedFiles`), and the packages those
files `require` (`spawnedPackages`). A new file the server starts by path is
found the same way, as long as its path is written whole.

- **Linux** in a bare `debian:stable-slim` container: no Node, no Java, no
  ffmpeg, only what the bundle carries.
- **Windows** on a VirtualBox VM restored from a snapshot
  ([`WINDOWS-VM.md`](WINDOWS-VM.md)): `ops/winvm/zen.sh up`, copy the bundle
  in, `ops/release/smoke/windows.ps1`, `zen.sh down`, so the VM is left as it
  was.

**On a busy machine, give the run its own CPU weight.** The VM shares the CPU
with whatever else runs on the host, and the Windows half has checks with
fixed limits (the novels plugin host's 20 s answer, the updater's restart).
Under heavy load (a load average in the 40s) those checks can fail on the
installed copy while the zip passes every check; run as

```sh
systemd-run --user --scope --quiet -p CPUWeight=1000 ops/release/smoke.sh <version>
```

the same run passes at the same load. VirtualBox's VBoxSVC and the VM start on
demand inside the caller's cgroup, so the scope's weight is theirs too;
nothing else is paused or slowed by hand, its scopes keep the default weight
of 100 and only yield while the smoke run needs the CPU. A timed check that
fails on the installed copy while the zip passed, with the load high, is
this; read the load before taking it for a regression, and before spending
another run's Tailscale certificate.

Each unzips the bundle, puts the importer specs' synthesised libraries in the
data folder where a scan reads them ([`IMPORT-MIHON.md`](IMPORT-MIHON.md),
"Where it reads from"): the Mihon one (`tests/helpers/mihon-fixture.ts`) as
tsundoku's own device, `library/devices/tsundoku/Mihon/`, and the Hentoid one
(`tests/helpers/hentoid-fixture.ts`) at `library/H/.Hentoid/`. It starts the
launcher and runs `ops/release/smoke/probe.mjs` with the bundle's Node: 127.0.0.1 is
sent to localhost, the first-run token signs in, five screens answer, the
engine answers with its token and refuses without it, a scan imports the
fixtures' nine series and ten chapters and refuses the one broken file, every visible
chapter's first page is an image, the hidden Hentoid books stay hidden, and
the novels plugin host, started as the server starts it, loads a plugin that
requires each library it lends (no network).
First comes the **fingerprint** step (`smoke/fingerprint.sh`,
`smoke/fingerprint.ps1`): the bundle's own ffmpeg must make chromaprint
points of a tone (`-f chromaprint -fp_format raw`, failing under four bytes
with "the bundle's ffmpeg has no chromaprint muxer"). The binary is named from
the bundle, never from PATH: a step that named PATH would pass on a build
machine whose own ffmpeg has the muxer, with a bundle the app never takes.
On Linux, the launcher (`./tsundoku --foreground`) is then hung up as a
closed terminal does, and nothing of the bundle may be left running. Then the
tray (`smoke/linux-tray.sh`): `./tsundoku` returns, leaving tsundoku running
in a session of its own; a second start opens it and starts nothing; `--quit`
stops everything ([`TRAY.md`](TRAY.md), "Tests"). On Windows, `windows.ps1`
does the same with `tsundoku.exe`, then checks `tsundoku.cmd` still starts it
in a window.
Then the paths ([`DISTRIBUTION.md`](DISTRIBUTION.md), "Windows paths"): no
series path stored with a backslash, a DELETE moves the series' file into the
trash and out of the library, and a GROUP of two Hentoid books in sibling
folders (`nhentai/`, `nhentai2/`) takes the folder they share as its path. The
Mihon fixture sits in tsundoku's own device folder, not the library's own
`Mihon/`, where only a backup is read.
On Windows it also checks that nothing listens beyond 127.0.0.1 and that no
`java` or `node` outlives the launcher. Then the installer
(`smoke/windows-installer.ps1`): a silent install puts the program, the
Start-menu entry and the Apps entry in place (and no start at sign-in), the
probe passes on the installed copy, a second install while it runs stops it
and leaves the program whole, it starts again on the same data with no new
token, and the uninstaller removes the program, its shortcut and its Apps
entry, keeps the data folder, and leaves nothing running.

**On Tailscale**, only when `TSUNDOKU_SMOKE_TAILSCALE_KEY` holds an ephemeral
auth key from the tailnet's admin console (Settings > Keys), since nothing
else can put the VM on a tailnet unattended. Make it reusable and ephemeral;
it expires (90 days at most), and an expired one fails the stage, never skips
it. Keep it in the environment of the shell that runs smoke.sh.
`smoke/windows-tailscale.ps1 -Key` installs Tailscale, joins as
`zen-tsundoku-smoke-<MMDDhhmmss>`, a name of its own each run, writes the
README's `TSUNDOKU_SERVE=https` into the data folder's `.env`, starts the
launcher and runs `smoke/probe-tailnet.mjs`: `serving.json` says https on the
tailnet name, the launcher opened that and not localhost, a second start finds
it, the token signs in through `tailscale serve` with its certificate, three
screens answer there, and a save from localhost is refused (why it opens the
tailnet address). Then it removes the serve mapping and logs out, and the
snapshot takes Tailscale away. The first request there can take a few
seconds, Tailscale fetching the certificate; the probe waits up to a minute
for it, since that can outlast fetch's 10 s connect timeout.

**Why a new name each run.** The VM comes back from its snapshot as a new
node, so every run asks Let's Encrypt for a certificate, and Let's Encrypt
issues at most five a week for one exact name: with one fixed name, the sixth
run in a week fails on the probe's connect timeout, and Tailscale's log on the
VM says `429 rateLimited: too many certificates (5) already issued for this
exact set of identifiers`. A name per run spends the tailnet's other budget
instead: 50 certificates a week for the tailnet's domain as a whole (`ts.net`
is a public suffix, so each tailnet counts as its own domain), shared with
every other machine on it. A day of many releases fits; a loop of smoke runs
would not. Each run's node is ephemeral and leaves the admin console by itself
after it logs out.

**The updater** (`smoke/windows-update.ps1`, [`UPDATES.md`](UPDATES.md),
"Tests"): offered a signed pretend 9999.01.01 by the VM itself, UPDATE
downloads, checks and runs the installer, and tsundoku comes back by itself on
the same data.

### Which run each path needs

| Run                                  | Writes, when it passes                 | Enough to                               |
| ------------------------------------ | -------------------------------------- | --------------------------------------- |
| `ops/release/smoke.sh <v>`           | `out/<v>/.smoked` (and the Linux mark) | publish, and install on a served copy   |
| `ops/release/smoke.sh <v> linux-x64` | `out/<v>/.smoked-linux-x64`            | install on a served copy, never publish |
| `ops/release/smoke.sh <v> win-x64`   | nothing                                | nothing on its own                      |

A served copy runs only the Linux bundle, so a release that only goes onto it
(no publish) needs only the Linux half, the container's run: seconds, with the
container image already pulled, where the whole run takes about twelve
minutes, most of it the VM's zip, installer, updater, Wi-Fi and Tailscale
stages. `publish` still requires the whole `.smoked`, because Windows users
get it too, and refuses a Linux-only version in those words: `<v> was
smoke-tested on Linux only: run the whole smoke test before publishing`.
Publishing a version first installed that way needs nothing special: run the
whole smoke test, then publish.

What a run does to marks already there (`recordSmoke`, `ops/release/smoked.ts`):

- A half that **passes alone takes nothing away**: a Linux run after a whole
  run leaves `.smoked` as it was, since it rebuilt nothing and found nothing
  wrong.
- A **Linux half that fails** deletes both marks, since both speak for the
  Linux bundle. A **Windows half that fails** deletes `.smoked` and leaves the
  Linux mark, which says nothing about Windows; so a whole run whose Windows
  half failed is still enough to install.
- A **Linux failure is recorded as soon as the Linux half ends**, before the
  Windows half starts, so the VM failing to come up (or any other unguarded
  step stopping the script under `set -e`) can't leave an earlier run's marks
  vouching for a bundle that just failed. Only what comes after that can be
  lost to an early stop: a run that stops before its end (say a bundle `tar`
  can't read, or the VM not coming up after a Linux half that passed) writes
  nothing else and deletes nothing else.

smoke.sh records the marks through `ops/release/smoked-mark.ts`, and
`install-release.sh` asks the same file whether either mark stands, so the rule
is written once, in `smoked.ts`, rather than once there and once in `find`.
A tag whose smoke.sh predates the Linux mark writes `.smoked` alone; its whole
run still installs and publishes, but any part-run of it (a Linux-only run
included) deletes `.smoked` and writes nothing, so such a version needs the
whole run both to install and to publish.

**A mark speaks for the bundles it tested** (`ops/release/smoked.ts`,
`tests/release-smoked.spec.ts`). `yarn run release` deletes both marks before
building, and every reader also refuses a bundle newer than the mark it reads,
which catches a bundle replaced any other way. The rule is the same for both
marks and counts every bundle of the version: a Windows bundle replaced after
a Linux run ends that run's mark too, since nothing but a hand replaces one
bundle alone. Rebuilding a version therefore means smoke-testing it again.
The APKs don't count, since no smoke test runs them: `android-apk.sh` can run
before or after smoke.sh, and leaves the marks alone. Each mark's line is
`<version> <when>`, with no checksums, because smoke.sh runs the tag's own copy
and the tags already made write exactly that.

## The engine's WebView, for a release

The engine's headless WebView (tsundoku-engine's `engine-webview`) ships
inside `engine.jar` like the rest of the engine: the bundle doesn't grow, and
Chromium is downloaded by the engine, on an install that turned the WebView
on, the first time an extension needs it.

- **Linux needs Xvfb** for it (`xvfb`; the README says how, in "Sources that
  need a browser of their own"), or a desktop `DISPLAY`. Without either,
  turning it on gives FAILED with what to install; nothing else changes.
  Windows needs nothing more, but is unproven (the engine's `FORK.md`,
  "Proven, and not").
- **THIRD-PARTY-NOTICES** names Chromium and JetBrains' JCEF, which the
  engine downloads rather than ships (`release.ts`, `notices`).
- **Either side alone is safe.** A tsundoku without its side starts the
  engine without `ENGINE_WEBVIEW`, so it stays off; an engine without the
  support has no `webview` capability, and BROWSE says WebView extensions
  can't run on it.

## Limits

- **No macOS release.** There is no machine to test it on, and FlareSolverr
  publishes no macOS build. The resolver and the launcher already know its
  paths.
- **No JMdict lookups in a release.** The dictionary isn't shipped (74 MB,
  built from EDRDG's data); without it, lookups are simply off
  (`KOTOBA_JMDICT`, [`JAPANESE.md`](JAPANESE.md)).
- **No updating in place on Linux**: there, UPDATE is a download and steps.
