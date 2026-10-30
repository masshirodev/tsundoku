# Distribution: tsundoku on a friend's computer

Status: **phases 1 and 2 are built** (2026-10-29: one data directory, the
local serve mode, a first-run token). The rest is the plan as decided that
day. Cards on the Tsundoku board carry the `Friends` label.

Until now tsundoku had exactly one install: this workstation, served over the
tailnet to the owner's tablet. Friends want to try it, some on Windows. This
document is how a stranger's machine gets a working tsundoku without the
source, the workstation's mounts, or Tailscale.

## What was decided

| Question         | Decision                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| How it's shipped | **Both**: a native install (most friends have no Docker), and Docker compose for those who do.     |
| Access           | **Repos stay private** until the real public release. Friends get built artifacts only.            |
| Licence          | **MIT** for tsundoku. The engine keeps upstream's MPL-2.0 ("Licences", below).                     |
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

**How the workstation keeps its paths.** `TSUNDOKU_HOME=/mnt/hdd2/tsundoku`
and `BACKUP_DIR=/mnt/backup/tsundoku` are set in every unit
(`ops/systemd/*.service`) and in `.env` for scripts run by hand, which
reproduces the old paths exactly. Without them the served app and the timers
would quietly start a second, empty library under `~/.local/share`. `.env` is
a copy of Infisical ([`SECRETS.md`](SECRETS.md)), so both keys belong there
too, or a pull drops them; the units stay right regardless. `yarn run dev`
keeps `data/tsundoku.sqlite`, the sample library, and now keeps its covers and
trash under `~/.local/share/tsundoku`, apart from the live ones. The test
runners give the app a temporary `TSUNDOKU_HOME` of their own.

**Windows paths are written with forward slashes** (`C:/Users/...`). The
library's own path logic (`src/lib/server/paths.ts`) joins and compares with
`/`, and Node accepts either. Whether the importers, which build paths from
what they read on disk, hold to that on Windows is the next thing the VM has
to answer (c183 ("Windows path audit: the library's paths are POSIX")).

### 2. A `local` serve mode and a first-run token

`TSUNDOKU_SERVE=local`: the app on `127.0.0.1:42143`, `ORIGIN`
`http://localhost:42143`, no Tailscale, and 127.0.0.1 redirected to localhost.
A release's launcher and image set it; a checkout keeps `https`, so the
workstation doesn't change. Without a token, `serve` makes one into
`TSUNDOKU_HOME/.env` on first start and prints it, instead of exiting. That
file is read after the project's `.env`, and is where a release keeps every
setting. Optional Tailscale: the friend sets `TSUNDOKU_SERVE=https`.
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

One archive per platform (`windows-x64`, `linux-x64`, `macos-arm64` at first),
each self-contained:

- a portable Node 24, the build, and production `node_modules` installed _for
  that platform_ (`better-sqlite3` and `sharp` both ship prebuilt binaries per
  OS/arch, fetched with the target named);
- the engine's shadow jar with a jlinked JRE (`tsundoku-engine` already has
  `build_jre.sh`, `package_windows.ps1` and an Inno Setup `setup.iss` from
  upstream, which are the starting point);
- FlareSolverr's own release binary, and `ffmpeg`;
- a launcher (`tsundoku.cmd` / `tsundoku`) that starts engine, FlareSolverr and
  the app, and opens the browser.

On Windows the archive is wrapped in an **Inno Setup installer**: Start-menu
entry, optional start-at-login, an uninstaller that leaves the library alone.
Unsigned at first, so SmartScreen will warn; signing is its own decision.

Downloads live on a **public releases repository** (`masshirodev/tsundoku-releases`):
a private repo's release assets can't be fetched by friends. It holds the
friend README, the compose file and the bundles, never source. Note what that
means: a bundle carries the built server JavaScript, readable if not pretty.
That was accepted with "public images only", since the image has it too.

### 5. Updating

The app already polls `/_app/version.json` for its own deploys. A release
build also compares its version with the latest release once a day and says so
on the settings page; it never updates itself. Docker friends `docker compose
pull`; native friends run the new installer, which keeps `TSUNDOKU_HOME`.

### 6. Testing on Windows

**Built 2026-10-29**, on what was already here rather than a new VM: **Zen**,
the owner's Windows 10 VirtualBox VM, now with OpenSSH and reached as
`ssh win-test`. `ops/winvm/zen.sh up` snapshots it as it is and boots it;
`down` puts it back, so tests never touch what the owner keeps in it.
[`WINDOWS-VM.md`](WINDOWS-VM.md) has the details.

Windows 10 rather than 11 makes no difference to anything tsundoku touches
(paths, `%LOCALAPPDATA%`, Node 24, an installer, start at login). A Windows 11
VM under QEMU (OVMF, `swtpm` for the TPM it requires) stays the way to add 11
if it ever matters. The smoke test, still to write with the bundle: install
it, start it, sign in, import a synthesised Mihon folder, open a chapter.

## Why not just one of them

Docker alone is the least work and the most uniform, but most friends don't
have Docker Desktop and won't install it (WSL2, a reboot, a licence prompt) to
try a reader. Native alone would mean every friend also runs a JRE and
FlareSolverr by hand. So the native bundle is the main path, and Docker is the
one for people who already have it, and for Linux servers.

## Licences

tsundoku is **MIT** (`LICENSE`), like kotoba. What ships beside it isn't all
MIT, and that decides what handing a build to a friend obliges:

- **tsundoku-engine is MPL-2.0**, inherited from M-Extension-Server. MPL lets
  the engine's binary go out with its source kept private, but anyone who
  receives the binary is entitled to the source of the MPL files. Until the
  public release, the rule is: **a friend who asks for the engine's source
  gets it** (a collaborator invite is enough), and the release notes say so.
- **ffmpeg** is LGPL or GPL depending on the build chosen for a bundle. The
  bundle ships its licence and says where its source is, as ffmpeg's own
  builds do. Pick an LGPL build where one fits.
- **FlareSolverr** is MIT; its licence goes in the bundle.
- Every third-party licence in a bundle or image is collected into a
  `THIRD-PARTY-NOTICES` file by the release build (c176).

At the public release, both repositories open and the first point goes away.
