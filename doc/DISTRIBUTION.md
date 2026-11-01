# Distribution: tsundoku on a friend's computer

Status (2026-10-29): **phases 1, 2, 4 and 6 are built**: one data
directory, the local serve mode and first-run token, native bundles for
Windows and Linux with their launcher, and the Windows test VM with a smoke
test both bundles pass. How a release is made is [`RELEASE.md`](RELEASE.md).
The Windows installer is built too (an NSIS one, not Inno Setup: see
[`RELEASE.md`](RELEASE.md), "The installer"). Docker (3), publishing and
update notices are still the plan as decided that day. Cards on the Tsundoku board carry the `Friends` label.

Until now tsundoku had exactly one install: this workstation, served over the
tailnet to the owner's tablet. Friends want to try it, some on Windows. This
document is how a stranger's machine gets a working tsundoku without the
source, the workstation's mounts, or Tailscale.

## What was decided

| Question         | Decision                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| How it's shipped | **Both**: a native install (most friends have no Docker), and Docker compose for those who do.     |
| Access           | **Repos stay private** until the real public release. Friends get built artifacts only.            |
| Licence          | **PolyForm Noncommercial** for tsundoku. The engine keeps upstream's MPL-2.0 ("Licences", below).  |
| Windows testing  | **A local VM**: Zen, the owner's Windows 10 VirtualBox VM (phase 6).                               |
| Scope            | **Core + downloads**: library, importers, readers, anime, and downloading through the engine.      |
| Network          | **`http://localhost` by default** (a secure context), with today's Tailscale HTTPS mode as opt-in. |

What a friend's install leaves out unless they set it up themselves: Ranobe,
Kumiko flashcards, mokuro OCR, Syncthing tablet sync, MAL/AniList links (they
need the friend's own client ids), and the nightly snapshot to `/mnt/backup`.
Each is already off when its variables are unset; the work is making sure
nothing _fails_ when they are.

## What ties it to this box today

Measured 2026-10-29, the things a fresh machine trips over:

- **Paths.** `/mnt/hdd2/tsundoku/...` is the hardcoded fallback for the library
  (`src/lib/server/import/index.ts`), covers (`covers.ts`), trash (`delete.ts`),
  the engine store (`engine/extensions.ts`, `novels/plugins.ts`), mokuro and OCR
  scratch (`japanese/ocr.ts`), and two scripts.
- **Serving.** `scripts/serve.ts` exits without `tailscale`, and refuses to start
  without a hand-made `TSUNDOKU_TOKEN`. The units are systemd.
- **kotoba** is `link:../kotoba`, and exports TypeScript source. It works because
  the build happens beside a kotoba checkout; it must end up bundled into the
  build output, since Node won't strip types inside `node_modules`.
- **The engine** is an image built locally from the private `tsundoku-engine`
  repo, and its compose file mounts `/mnt/hdd2` and pins `TZ=America/Cuiaba`.
- **External binaries**: `ffmpeg`/`ffprobe` for anime, FlareSolverr beside the
  engine, a Java runtime under the engine.
- **Native modules**: `better-sqlite3` and `sharp` are per-OS, per-architecture.

## The phases

### 1. One data directory (both paths need it)

`TSUNDOKU_HOME` becomes the root every default derives from: `library/`,
`covers/`, `trash/`, `engine/`, `ocr-scratch/`, and the database. Unset, it is
the platform's place for app data:

| OS      | Default `TSUNDOKU_HOME`                          |
| ------- | ------------------------------------------------ |
| Windows | `%LOCALAPPDATA%\tsundoku`                        |
| macOS   | `~/Library/Application Support/tsundoku`         |
| Linux   | `$XDG_DATA_HOME/tsundoku` (`~/.local/share/...`) |

Each specific variable (`LIBRARY_ROOT`, `COVER_DIR`, ...) still wins, and
`BACKUP_DIR` defaults to `TSUNDOKU_HOME/backups` (the workstation's is
`/mnt/backup/tsundoku`). The resolver is `src/lib/server/data-dirs.ts`; every
module that used to name `/mnt/hdd2` asks it, and `tests/data-dirs.spec.ts`
runs it under each platform's rules.

**How the workstation keeps its paths.** Since c228 the workstation runs
the released bundle with `/mnt/hdd2/tsundoku` as its data folder, settings in
its `.env` and the database at `/mnt/hdd2/tsundoku/library.sqlite`
([`SERVING.md`](SERVING.md)). Before that: `TSUNDOKU_HOME=/mnt/hdd2/tsundoku`
and `BACKUP_DIR=/mnt/backup/tsundoku` are set in every unit
(`ops/systemd/*.service`) and in `.env` for scripts run by hand, which
reproduces the old paths exactly. Without them the served app and the timers
would quietly start a second, empty library under `~/.local/share`. `.env` is
a copy of Infisical ([`SECRETS.md`](SECRETS.md)), so both keys belong there
too, or a pull drops them; the units stay right regardless. `yarn run dev`
keeps `data/tsundoku.sqlite`, the sample library, and now keeps its covers and
trash under `~/.local/share/tsundoku`, apart from the live ones. The test
runners give the app a temporary `TSUNDOKU_HOME` of their own.

#### Windows paths

**Every path server code makes is written with `/`, Windows included**
(`C:/Users/...`; c183, 2026-10-29). The library's own path logic
(`src/lib/server/paths.ts`) joins and compares with `/`: series paths and
entry files are stored that way, and "is this file inside the library?" is a
string comparison. `node:path` writes `\` on Windows, so the first Windows
bundle stored `C:\Users\...` beside a data folder of `C:/Users/...`, and the
comparison failed quietly: a DELETE dropped the series and left its files in
the library, outside the trash, to come back on the next scan.

So server code (`src/lib/server`, `src/routes`, `src/hooks.server.ts`,
`scripts`) imports its path functions from `src/lib/server/fspath.ts`, never
`node:path`, and ESLint refuses the latter there. `fspath` is `node:path`
writing `/` on Windows, where Node takes either spelling, and unchanged
elsewhere, where a backslash is an ordinary character in a file name. Its
`slash()` is for a path that arrives from outside (Syncthing's API, the OS).
`tests/fspath.spec.ts` runs it under Windows' rules, including
`paths.ts`'s own comparisons; the release smoke test checks a delete and a
grouping on Windows itself.

Not handled: Windows compares paths without regard to case, and the library
compares strings. Every path tsundoku stores comes from its own data folder,
so the case always agrees; a `LIBRARY_ROOT` typed in another case than an
existing library's would not.

### 2. A `local` serve mode and a first-run token

`TSUNDOKU_SERVE=local`: the app on `127.0.0.1:42143`, `ORIGIN`
`http://localhost:42143`, no Tailscale, and 127.0.0.1 redirected to localhost.
A release's launcher and image set it; a checkout keeps `https`, so the
workstation doesn't change. Without a token, `serve` makes one into
`TSUNDOKU_HOME/.env` on first start and prints it, instead of exiting
(a release's launcher has passwords instead since c189:
[`SIGN-IN.md`](SIGN-IN.md)). That
file is read after the project's `.env`, and is where a release keeps every
setting. Optional Tailscale: the friend sets `TSUNDOKU_SERVE=https`, and
the launcher opens the tailnet address the app prints (c186; the README's
"Reading on your phone or tablet" has the friend's steps).
[`SERVING.md`](SERVING.md), "Local, on the same computer", has the details.

Still open for a release: `serve` snapshots `build/` into `.serving/` beside
itself, which an install under Program Files can't write. The bundle's
launcher (phase 4) either runs the build directly, since a release is never
rebuilt in place, or points the snapshot at `TSUNDOKU_HOME`.

### 3. Docker images

- `ghcr.io/masshirodev/tsundoku`: Node 24 slim, the adapter-node build with
  production `node_modules`, `ffmpeg`. Built here, like Lattice's images, from
  a clean tree at a tag.
- `ghcr.io/masshirodev/tsundoku-engine`: the existing Dockerfile, published
  instead of built locally.
- A friend-facing `compose.yml`: tsundoku, engine, FlareSolverr; one volume for
  `TSUNDOKU_HOME`, a bind for the library, localhost-only ports, `TZ` from the
  host. Packages public, repos private.

### 4. Native bundles

**Built 2026-10-29** for `win-x64` and `linux-x64`; [`RELEASE.md`](RELEASE.md)
is how, and where it departs from this plan: a downloaded Temurin JRE rather
than a jlinked one, FlareSolverr as its own optional archive (it unpacks to
1.5 GB on Windows, a whole Chrome), and no macOS yet (nothing to test it on,
and FlareSolverr has no macOS build). The plan was one archive per platform,
each self-contained:

- a portable Node 24, the build, and production `node_modules` installed _for
  that platform_ (`better-sqlite3` and `sharp` both ship prebuilt binaries per
  OS/arch, fetched with the target named);
- the engine's shadow jar with a jlinked JRE (`tsundoku-engine` already has
  `build_jre.sh`, `package_windows.ps1` and an Inno Setup `setup.iss` from
  upstream, which are the starting point);
- FlareSolverr's own release binary, and `ffmpeg`;
- a launcher (`tsundoku.cmd` / `tsundoku`) that starts engine, FlareSolverr and
  the app, and opens the browser. Since c222 a friend starts it through the
  tray (`tsundoku.exe` / `./tsundoku`), with no window and an icon by the
  clock ([`TRAY.md`](TRAY.md)).

On Windows the archive is wrapped in an **Inno Setup installer**: Start-menu
entry, optional start-at-login, an uninstaller that leaves the library alone.
Unsigned at first, so SmartScreen will warn; signing is its own decision.

Downloads live on **dl.tsundoku.masshiro.pro** (changed 2026-10-30: the owner,
"we can serve the files on masshiro.pro, like hansei does"), not a public
releases repository as first planned: a folder on the VPS served by Caddy,
with the friend README beside the bundles, never source
([`UPDATES.md`](UPDATES.md)). Note what that means: a bundle carries the built
server JavaScript, readable if not pretty. That was accepted with "public
images only", since the image has it too.

### 5. Updating

The app already polls `/_app/version.json` for its own deploys. A release
build also looks for a newer release once a day and says so: a band on the
library, and SETTINGS > DEVICES > UPDATES. Never automatically, but since
2026-10-30 (the owner: "an updater for tsundoku?, not auto tho") UPDATE
installs it on a click on Windows: the signed manifest checked, the installer
run, tsundoku back by itself ([`UPDATES.md`](UPDATES.md)). Linux and the zip
download it. Docker friends `docker compose pull`.

### 6. Testing on Windows

**Built 2026-10-29**, on what was already here rather than a new VM: **Zen**,
the owner's Windows 10 VirtualBox VM, now with OpenSSH and reached as
`ssh win-test`. `ops/winvm/zen.sh up` snapshots it as it is and boots it;
`down` puts it back, so tests never touch what the owner keeps in it.
[`WINDOWS-VM.md`](WINDOWS-VM.md) has the details.

Windows 10 rather than 11 makes no difference to anything tsundoku touches
(paths, `%LOCALAPPDATA%`, Node 24, an installer, start at login). A Windows 11
VM under QEMU (OVMF, `swtpm` for the TPM it requires) stays the way to add 11
if it ever matters. The smoke test is `ops/release/smoke.sh`
([`RELEASE.md`](RELEASE.md), "Smoke test"): unzip, start, sign in, import a
synthesised Mihon folder, read every chapter's first page.

## Why not just one of them

Docker alone is the least work and the most uniform, but most friends don't
have Docker Desktop and won't install it (WSL2, a reboot, a licence prompt) to
try a reader. Native alone would mean every friend also runs a JRE and
FlareSolverr by hand. So the native bundle is the main path, and Docker is the
one for people who already have it, and for Linux servers.

## Licences

tsundoku is **PolyForm Noncommercial 1.0.0** (`LICENSE`): anyone may use,
change and share it for a noncommercial purpose, and nobody may sell it or
charge for hosting it. It was MIT until 2026-10-29 and moved because the owner
doesn't want it sold; MIT allows that. It is source-available, not open source
by the OSI's definition, and that is the trade. A copy someone already received
under MIT stays MIT for them; every copy since is PolyForm.

The licence's one condition on sharing is that the terms (or their URL) and the
`Required Notice:` line at the top of `LICENSE` travel with every copy. A
bundle carries `LICENSE` whole, so it does.

The rest of what ships isn't under that licence, and that decides what handing
a build to a friend obliges:

- **The LNReader shims** in `src/lib/server/novels/plugin-host.cjs` (the
  `@libs/*` fetch and storage that plugins are written against) are adapted
  from [lnreader-plugins](https://github.com/LNReader/lnreader-plugins), MIT.
  MIT allows that inside a noncommercial project, on the condition that its
  notice stays with that code: it's in the file's header, and the release's
  `THIRD-PARTY-NOTICES` lists it. kotoba is the owner's own and MIT, and is
  listed there too.
- **tsundoku-engine is MPL-2.0**, inherited from M-Extension-Server. MPL lets
  the engine's binary go out with its source kept private, but anyone who
  receives the binary is entitled to the source of the MPL files. Until the
  public release, the rule is: **a friend who asks for the engine's source
  gets it** (a collaborator invite is enough), and the release notes say so.
- **ffmpeg** is LGPL or GPL depending on the build chosen for a bundle. The
  bundle ships its licence and says where its source is, as ffmpeg's own
  builds do. Pick an LGPL build where one fits.
- **FlareSolverr** is MIT, and ships as its own release, unmodified, with
  the Chrome it carries under Chrome's terms. Its archive holds no licence
  file; THIRD-PARTY-NOTICES names it.
- Every third-party licence in a bundle is collected into
  `THIRD-PARTY-NOTICES.txt` by the release build: the packages the server
  loads, the ones compiled into `build/` (the fonts are OFL), Node, the JRE,
  the engine and ffmpeg.

At the public release, both repositories open and the first point goes away.
