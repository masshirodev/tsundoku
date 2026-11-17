# Distribution: tsundoku on another computer

tsundoku ships as a native bundle a person unpacks or installs on their own
computer, Windows or Linux, with no source checkout, no particular mounts and
no Tailscale. This doc says what makes that work: one data directory, the
local serve mode, the bundles and their installer, the Windows rules for
paths, testing on Windows, and what ships under which licence. How a release
is made is [`RELEASE.md`](RELEASE.md); how an install learns of a newer one is
[`UPDATES.md`](UPDATES.md).

People find tsundoku at **tsundoku.masshiro.pro**: one page that says what it
is and offers the newest release from dl.tsundoku.masshiro.pro, read from the
signed `latest.json` at each deploy, with the README's install steps laid out
([`WEBSITE.md`](WEBSITE.md)).

## What an install is

| Question | Answer                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- |
| Shipped  | A **native bundle** per platform (`win-x64`, `linux-x64`), and on Windows an installer around it. |
| Licence  | **PolyForm Noncommercial** for tsundoku. The engine keeps upstream's MPL-2.0 ("Licences", below). |
| Scope    | **Core and downloads**: library, importers, readers, anime, and downloading through the engine.   |
| Network  | **`http://localhost` by default** (a secure context), with the Tailscale HTTPS mode as an opt-in. |

What an install leaves out unless its owner sets it up: Ranobe (a separate
reading catalogue tsundoku reports progress to, [`RANOBE.md`](RANOBE.md)),
Kumiko flashcards (a separate self-hosted app the dictionary can add cards
to, through `KUMIKO_URL` and `KUMIKO_TOKEN`), mokuro OCR, Syncthing tablet
sync, MAL and AniList links (they need the person's own client ids), and a
nightly snapshot to a backup disk. Each is off when its variables are unset,
and nothing fails when they are.

Docker alone would be the least work and the most uniform, but most people
don't have Docker Desktop and won't install it (WSL2, a reboot, a licence
prompt) to try a reader. So the native bundle carries everything the app
needs, a JRE and FlareSolverr included, and nobody runs those by hand.

## What a machine needs

The things a fresh machine would otherwise trip over, and how each is met:

- **Paths.** Every default derives from one data directory (below); nothing
  in `src/` names a fixed disk. The release scripts' own working folder
  (`RELEASE_DIR`) and the workstation's systemd units are the only fixed
  paths left, and neither ships.
- **Serving.** A bundle serves on localhost and needs no Tailscale; its
  launcher makes the sign-in ([`SIGN-IN.md`](SIGN-IN.md)).
- **kotoba** is `link:../kotoba` in `package.json`, and exports TypeScript
  source. A build happens beside a kotoba checkout, and kotoba is bundled
  into the build output, since Node won't strip types inside
  `node_modules`. The same link is why `yarn add` in a git worktree damages
  the lock: see [Adding a dependency](#adding-a-dependency-in-a-worktree).
- **The engine** is built from `tsundoku-engine` and ships in the bundle as
  its shadow jar under a JRE. A checkout runs it from `ops/engine/compose.yml`,
  which mounts the engine's data folder (`ENGINE_DATA`) and takes `TZ` from
  the environment (UTC by default).
- **External binaries**: `ffmpeg`/`ffprobe` for anime, FlareSolverr beside the
  engine, a Java runtime under the engine. An episode's opening and ending are
  found with chromaprint ([`ANIME.md`](ANIME.md), "Openings and endings"), and
  a bundle's pinned ffmpeg carries chromaprint's muxer itself, so it needs no
  program beside it ([`RELEASE.md`](RELEASE.md), "Pinned"). An ffmpeg without
  the muxer (Arch's, for one) falls back to `fpcalc` from the `chromaprint`
  package (`FPCALC`, `src/lib/server/anime/fingerprint.ts`).
- **Native modules**: `better-sqlite3` and `sharp` are per-OS,
  per-architecture, so each bundle installs them for its own platform.

## One data directory

`TSUNDOKU_HOME` is the root every default derives from: `library/`,
`covers/`, `trash/`, `engine/`, `ocr-scratch/`, and the database. Unset, it
is the platform's place for app data:

| OS      | Default `TSUNDOKU_HOME`                          |
| ------- | ------------------------------------------------ |
| Windows | `%LOCALAPPDATA%\tsundoku`                        |
| macOS   | `~/Library/Application Support/tsundoku`         |
| Linux   | `$XDG_DATA_HOME/tsundoku` (`~/.local/share/...`) |

Each specific variable (`LIBRARY_ROOT`, `COVER_DIR`, ...) still wins, and
`BACKUP_DIR` defaults to `TSUNDOKU_HOME/backups`. The resolver is
`src/lib/server/data-dirs.ts`; every module asks it for its paths, and
`tests/data-dirs.spec.ts` runs it under each platform's rules.

**A served install with its data elsewhere** sets the folder rather than
taking the default. The workstation runs the released bundle with its data
folder on a large disk, settings in that folder's `.env` and the database
beside them ([`SERVING.md`](SERVING.md)); its systemd units
(`ops/systemd/*.service`) set `TSUNDOKU_HOME` and `BACKUP_DIR` too, as must
the `.env` used by scripts run by hand ([`SECRETS.md`](SECRETS.md)). Without
them the served app and the timers would quietly start a second, empty
library under `~/.local/share`. `yarn run dev` keeps `data/tsundoku.sqlite`,
the sample library, and keeps its covers and trash under
`~/.local/share/tsundoku`, apart from a served install's. The test runners
give the app a temporary `TSUNDOKU_HOME` of their own.

### Windows paths

**Every path server code makes is written with `/`, Windows included**
(`C:/Users/...`). The library's own path logic (`src/lib/server/paths.ts`)
joins and compares with `/`: series paths and entry files are stored that
way, and "is this file inside the library?" is a string comparison.
`node:path` writes `\` on Windows, so a path made with it would be stored as
`C:\Users\...` beside a data folder of `C:/Users/...`, and the comparison
would fail quietly: a DELETE would drop the series and leave its files in
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

Windows compares paths without regard to case, and the library compares
strings. Every path tsundoku stores comes from its own data folder, so the
case always agrees; a `LIBRARY_ROOT` typed in another case than an existing
library's would not.

## The local serve mode

`TSUNDOKU_SERVE=local`: the app on `127.0.0.1:42143`, `ORIGIN`
`http://localhost:42143`, no Tailscale, and 127.0.0.1 redirected to
localhost. A release's launcher sets it; a checkout keeps `https`. Without a
token, `serve` makes one into `TSUNDOKU_HOME/.env` on first start and prints
it, instead of exiting; a release's launcher uses passwords instead
([`SIGN-IN.md`](SIGN-IN.md)). That file is read after the project's `.env`,
and is where a release keeps every setting. For Tailscale, the person sets
`TSUNDOKU_SERVE=https`, and the launcher opens the tailnet address the app
prints (the README's "Reading on your phone or tablet" has the steps).
[`SERVING.md`](SERVING.md), "Local, on the same computer", has the details.

A checkout's `serve` runs from a snapshot of `build/` in `.serving/`, so a
rebuild can't pull files out from under it. A release's launcher sets
`TSUNDOKU_SNAPSHOT=off` (`scripts/serve.ts`): a release is never rebuilt in
place, and an install under Program Files can't write beside itself.

## The bundles

One archive per platform, `win-x64` and `linux-x64`, each self-contained
([`RELEASE.md`](RELEASE.md) is how they're built):

- a portable Node 24, the build, and production `node_modules` installed _for
  that platform_ (`better-sqlite3` and `sharp` both ship prebuilt binaries per
  OS/arch, fetched with the target named);
- the engine's shadow jar with a downloaded Temurin JRE;
- `ffmpeg`;
- a launcher that starts the engine, FlareSolverr and the app, and opens the
  browser. It is started through the tray (`tsundoku.exe` / `./tsundoku`),
  with no window and an icon by the clock ([`TRAY.md`](TRAY.md)).

FlareSolverr is its own optional archive: it unpacks to 1.5 GB on Windows, a
whole Chrome.

On Windows the archive is wrapped in an **NSIS installer**
(`ops/release/installer/tsundoku.nsi`; [`RELEASE.md`](RELEASE.md), "The
installer"): a Start-menu entry, optional start at sign-in, and an
uninstaller that leaves the library alone. It is unsigned, so SmartScreen
warns.

Downloads live on **dl.tsundoku.masshiro.pro**: a folder served by Caddy,
with the README beside the bundles ([`UPDATES.md`](UPDATES.md)). A bundle
carries the built server JavaScript, readable if not pretty.

## Updating

The app polls `/_app/version.json` for its own deploys. A release build also
looks for a newer release once a day and says so: a band on the library, and
SETTINGS > DEVICES > UPDATES. It never updates by itself. On Windows, UPDATE
installs the new release on a click: the signed manifest checked, the
installer run, tsundoku back by itself ([`UPDATES.md`](UPDATES.md)). On Linux
and from the zip, UPDATE downloads it.

## Testing on Windows

A Windows 10 VirtualBox VM, **Zen**, with OpenSSH, reached as
`ssh win-test`. `ops/winvm/zen.sh up` snapshots it as it is and boots it;
`down` puts it back, so tests never touch what else the VM holds.
[`WINDOWS-VM.md`](WINDOWS-VM.md) has the details.

Windows 10 rather than 11 makes no difference to anything tsundoku touches
(paths, `%LOCALAPPDATA%`, Node 24, an installer, start at sign-in). A
Windows 11 VM under QEMU (OVMF, `swtpm` for the TPM it requires) is the way
to add 11 if it ever matters. The smoke test is `ops/release/smoke.sh`
([`RELEASE.md`](RELEASE.md), "Smoke test"): unzip, start, sign in, import a
synthesised Mihon folder, read every chapter's first page.

## Adding a dependency in a worktree

**Why a git worktree is different.** `package.json` has `"kotoba":
"link:../kotoba"`, which yarn resolves from the checkout's root. Beside the
main checkout that is the kotoba checkout next to it; inside a worktree
elsewhere it is a `kotoba` folder beside the worktree, which does not exist.
Measured with `yarn add is-odd@3.0.1` in such a worktree:

- every yarn command that installs (`yarn add`, `yarn remove`, `yarn install`,
  `--frozen-lockfile` included) re-makes `node_modules/kotoba` as
  `../../kotoba`, a dangling link: `yarn run check` then cannot resolve
  `kotoba`, and `prepare`'s dictionary sync fails behind its `|| true`;
- a command that rewrites the lock (`yarn add`, `yarn remove`) also drops
  kotoba's own dependencies from `yarn.lock`, because it cannot read their
  names: today that is `@patdx/kuromoji`'s four-line entry. It deletes
  `node_modules/@patdx/kuromoji` too, which nothing here misses (kotoba is
  resolved through its real path, so its imports come from the kotoba
  checkout's own `node_modules`);
- the `kotoba` line in `package.json` and its `"kotoba@link:../kotoba"` lock
  entry are left as they are;
- relinking `node_modules/kotoba` _before_ the add changes nothing (yarn reads
  the path from `package.json`, not through `node_modules`), and
  `yarn install --frozen-lockfile` does not notice the pruned entry (it passes
  on both the pruned and the restored lock).

In the main checkout none of this happens: the same `yarn add` beside a
`kotoba` checkout changes only the new package's lines.

**The steps**, from the worktree's root, in this order (`$KOTOBA` is the
kotoba checkout beside the main one):

```sh
# 1. Add the package (-D for a devDependency).
yarn add <package>@<version>

# 2. Relink kotoba (untracked; every install breaks it again, so this is
#    always the last yarn step's follow-up), and sync its dictionary.
ln -sfn "$KOTOBA" node_modules/kotoba
node node_modules/kotoba/scripts/sync-dict.js static/dict

# 3. Put back the lock entries of kotoba's dependencies that yarn dropped,
#    each where it stood in HEAD's lock. Prints what it restored; a second
#    run restores nothing. The script follows kotoba's direct dependencies
#    only: a dependency of one of those is pruned the same way, and its
#    block is put back from `git show HEAD:yarn.lock` too (nothing kotoba
#    depends on has one today -- `@patdx/kuromoji` has no dependencies --
#    so this is the rule for the first that does).
node - <<'JS'
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const deps = Object.keys(
	JSON.parse(readFileSync('node_modules/kotoba/package.json', 'utf8')).dependencies ?? {}
);
const blocks = (s) => s.split('\n\n');
const key = (b) => b.split('\n')[0];
const ours = (b) => deps.some((d) => key(b).replace(/^"/, '').startsWith(`${d}@`));
const old = blocks(execFileSync('git', ['show', 'HEAD:yarn.lock'], { encoding: 'utf8' }));
const now = blocks(readFileSync('yarn.lock', 'utf8'));
const have = new Set(now.map(key));
for (const [i, b] of old.entries()) {
	if (!ours(b) || have.has(key(b))) continue;
	const next = old.slice(i + 1).find((n) => have.has(key(n)));
	now.splice(next ? now.findIndex((n) => key(n) === key(next)) : now.length, 0, b);
	have.add(key(b));
	console.log(`restored ${key(b)}`);
}
writeFileSync('yarn.lock', now.join('\n\n'));
JS

# 4. Check what the commit will carry.
git diff package.json | grep -E '^[-+][^-+]'  # one + line: the new package
git diff yarn.lock | grep -E '^-[^-]'         # nothing
git diff yarn.lock | grep -E '^\+[^ +]'       # the new package's entries only
readlink node_modules/kotoba                  # the kotoba checkout
yarn run check
```

How to tell it went wrong: step 4's second command prints a line. A
`-"@patdx/kuromoji@…"` (or another of kotoba's dependencies) means step 3 did
not run or ran before step 2. A removed entry belonging to a **dependency of
one of kotoba's dependencies** is the same prune, not the new package changing
an entry: the script could not read that deeper tree either, so put its block
back from `git show HEAD:yarn.lock` as well. Any other removed line is the new
package changing an existing entry (a range it shares, now resolved to a newer
version): read it, and say so in the commit. `yarn run check` failing to
resolve `kotoba` means step 2 did not follow the last yarn command, a
`yarn remove` or a `yarn install` included.

The new package's licence reaches the release's `THIRD-PARTY-NOTICES` with no
change to the release build ([Licences](#licences)).

## Licences

tsundoku is **PolyForm Noncommercial 1.0.0** (`LICENSE`): anyone may use,
change and share it for a noncommercial purpose, and nobody may sell it or
charge for hosting it. It is source-available, not open source by the OSI's
definition, and that is the trade.

The licence's one condition on sharing is that the terms (or their URL) and the
`Required Notice:` line at the top of `LICENSE` travel with every copy. A
bundle carries `LICENSE` whole, so it does.

The rest of what ships isn't under that licence, and that decides what handing
a build to someone obliges:

- **The LNReader shims** in `src/lib/server/novels/plugin-host.cjs` (the
  `@libs/*` fetch and storage that plugins are written against) are adapted
  from [lnreader-plugins](https://github.com/LNReader/lnreader-plugins), MIT.
  MIT allows that inside a noncommercial project, on the condition that its
  notice stays with that code: it's in the file's header, and the release's
  `THIRD-PARTY-NOTICES` lists it. [kotoba](https://github.com/masshirodev/kotoba)
  is MIT, and is listed there too.
- **tsundoku-engine is MPL-2.0**, inherited from M-Extension-Server. Anyone
  who receives the engine's binary is entitled to the source of the MPL
  files, and gets it from
  [tsundoku-engine](https://github.com/masshirodev/tsundoku-engine).
- **ffmpeg** is LGPL or GPL depending on the build chosen for a bundle. The
  bundle ships its licence and says where its source is, as ffmpeg's own
  builds do. An LGPL build is preferred where one fits; the pinned one
  carries chromaprint, so nothing else has to ship for fingerprints.
- **FlareSolverr** is MIT, and ships as its own release, unmodified, with
  the Chrome it carries under Chrome's terms. Its archive holds no licence
  file; THIRD-PARTY-NOTICES names it.
- Every third-party licence in a bundle is collected into
  `THIRD-PARTY-NOTICES.txt` by the release build: the packages the server
  loads, the ones compiled into `build/` (the fonts are OFL), Node, the JRE,
  the engine and ffmpeg. A compiled package is every entry of `dependencies`
  the server doesn't load, with the licence file it ships, so a font added
  there is listed with no change to the release: OpenDyslexic
  (`@fontsource/opendyslexic`, OFL-1.1) ships its `LICENSE` and is listed
  beside Plex.

## Limits

- There is no Docker image of tsundoku itself; only the engine's compose
  file (`ops/engine/compose.yml`), for a checkout.
- There is no macOS bundle: nothing to test it on, and FlareSolverr has no
  macOS build. The data directory already has macOS's default.
- The Windows installer is not code-signed.
