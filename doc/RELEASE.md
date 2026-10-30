# Releases: bundles for friends' computers

How a tsundoku release is built, what's in it, and how it's tested
(c176, c178). Why there are releases at all, and what was decided about
them, is [`DISTRIBUTION.md`](DISTRIBUTION.md). The workstation itself never
runs a release: it serves from its checkout ([`SERVING.md`](SERVING.md)).

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
| `tsundoku-<version>-win-x64.zip`            | the Windows bundle (293 MB on 2026-10-29)        |
| `tsundoku-<version>-linux-x64.tar.xz`       | the Linux bundle (237 MB)                        |
| `flaresolverr-3.4.6-<platform>.zip/.tar.gz` | FlareSolverr's own release, unmodified, optional |
| `SHA256SUMS`                                | all of the above                                 |

Nothing is published by the script. Where friends download from is c180
("Public releases repo: friend README, compose, bundles").

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
6. **The bundle** gets the launcher, `LICENSE`, `README.txt` (the friend's
   instructions, `ops/release/README.txt`), `release.json` (every commit and
   version in it) and `THIRD-PARTY-NOTICES.txt`, then is zipped (Windows) or
   tarred with xz (Linux).

## Pinned

| Component    | Version (2026-10-29)      | Why this one                                                                   |
| ------------ | ------------------------- | ------------------------------------------------------------------------------ |
| Node         | 24.16.0                   | the workstation's (mise). Only the program and its licence ship.               |
| JRE          | Temurin 21.0.13+9         | the engine needs Java 21 (its image is `distroless/java21`).                   |
| ffmpeg       | BtbN n8.1.3, LGPL, shared | LGPL rather than GPL; the shared build is half the size. `ffplay` is left out. |
| FlareSolverr | 3.4.6                     | the version the workstation's compose file runs.                               |

BtbN deletes old builds after a while, which is what the cache is for. To
change a pin, take the new file's checksum from its project (Node's
`SHASUMS256.txt`, Adoptium's API, GitHub's asset digest), never from a
download of your own, and say so in the commit.

## What's in a bundle

```
tsundoku/
  tsundoku.cmd | tsundoku     what a friend runs
  launcher/launch.ts, plan.ts
  app/                        build/, scripts/serve.ts and the three modules it imports, node_modules/
  node/                       node.exe | bin/node
  jre/                        Temurin
  engine/engine.jar
  ffmpeg/bin (+ lib on Linux)
  LICENSE  README.txt  release.json  THIRD-PARTY-NOTICES.txt
  flaresolverr/               only once its optional archive is unzipped here
```

## The launcher

`tsundoku.cmd` (or `tsundoku`) runs `launcher/launch.ts` with the bundle's
Node. It:

1. finds the data folder (`TSUNDOKU_HOME`, else the platform's: see
   [`DISTRIBUTION.md`](DISTRIBUTION.md), "One data directory"), reading the
   default folder's `.env` first, since it may point `TSUNDOKU_HOME`
   elsewhere, then that folder's own;
2. makes `ENGINE_TOKEN` there on a first start, as `serve` makes the
   sign-in token ([`SERVING.md`](SERVING.md), "Local");
3. if a tsundoku already answers on the port, opens it and exits;
4. starts the engine (`java -jar`, `ENGINE_HOST=127.0.0.1`, its APKs,
   preferences and app folder under `engine/` in the data folder) and
   FlareSolverr if present (`HOST=127.0.0.1`), each logging to `logs/`, and
   starts either again if it stops;
5. starts the app in its own window (`TSUNDOKU_SERVE=local`,
   `TSUNDOKU_SNAPSHOT=off`, the database in the data folder, the engine's
   and ffmpeg's addresses), and opens the browser once it answers
   (`--no-browser` or `TSUNDOKU_NO_BROWSER=1` not to);
6. stops everything when the app stops or the window closes (`taskkill /T`
   on Windows, the process group elsewhere), so FlareSolverr's Chrome goes
   too.

What it runs, with which environment, is `ops/release/launcher/plan.ts`,
pure and tested for both platforms in `tests/release-plan.spec.ts`. The data
folder's `.env` can set `PORT`, `ENGINE_PORT`, `SOLVER_PORT`,
`TSUNDOKU_SERVE` (`https` puts it on the tailnet, as on the workstation) and
`DATABASE_PATH`.

## Smoke test

`ops/release/smoke.sh <version>` runs every bundle on a machine that has
never seen tsundoku:

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
chapter's first page is an image, and the hidden local books stay hidden.
On Windows it also checks that nothing listens beyond 127.0.0.1 and that no
`java` or `node` outlives the launcher. 2026-10-29: all passed on both.

## Not in a release yet

- **macOS.** No machine to test it on, and FlareSolverr publishes no macOS
  build. The resolver and the launcher already know its paths.
- **An installer** for Windows (c179): a friend unzips the folder and runs
  `tsundoku.cmd`. Nothing is signed, so SmartScreen warns; the README says
  what to click.
- **JMdict lookups.** The dictionary isn't shipped (74 MB, built from
  EDRDG's data); without it, lookups are simply off (`KOTOBA_JMDICT`,
  [`JAPANESE.md`](JAPANESE.md)).
- **Windows paths in the library.** On Windows the importer stores series
  paths with backslashes, while `src/lib/server/paths.ts` compares with `/`.
  Reading and importing work (the smoke test). What compares paths (the
  delete's "only files inside the library" check, grouping books from two
  folders) is expected to misbehave there and hasn't been tried: c183
  ("Windows path audit: the library's paths are POSIX").
- **Updates** say nothing yet (c182).
