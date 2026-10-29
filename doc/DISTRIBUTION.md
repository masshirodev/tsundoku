# Distribution: tsundoku on a friend's computer

Status: **plan, not built.** Everything below is what was decided on
2026-10-29 and how it will be done; nothing here ships yet. Cards on the
Tsundoku board carry the `Friends` label.

Until now tsundoku had exactly one install: this workstation, served over the
tailnet to the owner's tablet. Friends want to try it, some on Windows. This
document is how a stranger's machine gets a working tsundoku without the
source, the workstation's mounts, or Tailscale.

## What was decided

| Question         | Decision                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| How it's shipped | **Both**: a native install (most friends have no Docker), and Docker compose for those who do.         |
| Access           | **Repos stay private.** Friends get built artifacts only: public GHCR images and public release files. |
| Scope            | **Core + downloads**: library, importers, readers, anime, and downloading through the engine.          |
| Network          | **`http://localhost` by default** (a secure context), with today's Tailscale HTTPS mode as opt-in.     |

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

Each specific variable (`LIBRARY_ROOT`, `COVER_DIR`, ...) still wins. The
workstation sets `TSUNDOKU_HOME=/mnt/hdd2/tsundoku` (in Infisical, so
`secrets:pull` keeps it, and in every unit), which reproduces today's paths
exactly. **That must land before the defaults change**, or the timers and the
served app would quietly start a second, empty library under `~/.local/share`.
`yarn run dev` keeps `data/tsundoku.sqlite`, the sample library.

Path handling goes through `node:path` everywhere (some code joins with `/`),
and a spec runs the resolver under each platform's rules.

### 2. A `local` serve mode and a first-run token

`TSUNDOKU_SERVE=local`: the app on `127.0.0.1:42143`, `ORIGIN`
`http://localhost:42143`, no Tailscale. It is the default when the app runs
from a release (the launcher sets it); a checkout keeps `https` so the
workstation doesn't change. Without a token, a release generates one into
`TSUNDOKU_HOME/.env` on first start and prints it, instead of exiting.
Optional Tailscale: the friend sets `TSUNDOKU_SERVE=https`, as documented in
`SERVING.md`.

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

This box has no Windows. Two ways, an owner decision on the board: a local
Windows VM (QEMU/libvirt, plenty of RAM here) driven over SSH, or GitHub
Actions' Windows runners from the public releases repo (free there, but the
workflow then needs a token to read the private source). Either way a smoke
test installs the bundle, starts it, logs in, imports a synthesised Mihon
folder and opens a chapter.

## Why not just one of them

Docker alone is the least work and the most uniform, but most friends don't
have Docker Desktop and won't install it (WSL2, a reboot, a licence prompt) to
try a reader. Native alone would mean every friend also runs a JRE and
FlareSolverr by hand. So the native bundle is the main path, and Docker is the
one for people who already have it, and for Linux servers.
