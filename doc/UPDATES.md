# Updates

How a friend's install learns of a new version and installs it (card c182),
and where releases are published (card c180). Never automatic: tsundoku looks
and says so; the friend presses UPDATE.

## Where releases live: dl.tsundoku.masshiro.pro

Hansei's arrangement (its `doc/DESKTOP-RELEASE.md`): a folder on the VPS,
`~/tsundoku-releases`, served read-only by Caddy (`~/projects/caddy` on the VPS,
in `masshirodev/homelab`; mounted at `/srv/tsundoku-releases`, `file_server
browse`). Not GitHub: the repositories are private, and a private repo's release
assets answer 404 to anyone without a token. Its own subdomain because the
address is compiled into every install (`UPDATES` in
`ops/release/launcher/plan.ts`), so it has to outlive any other change to
masshiro.pro.

```
~/tsundoku-releases/
  latest.json             the signed announcement every install checks
  latest -> 2026.10.30.4/ moved by publish
  2026.10.30.4/           written once, never rewritten
    tsundoku-win-x64.exe        unversioned names: latest/<name> is a lasting link
    tsundoku-win-x64.zip
    tsundoku-linux-x64.tar.xz
    flaresolverr-3.4.6-win-x64.zip, flaresolverr-3.4.6-linux-x64.tar.gz
    SHA256SUMS  README.txt
```

`latest.json` and `latest/` are sent `no-cache`; a version folder
`immutable`. **A friend's lasting download link** is
`https://dl.tsundoku.masshiro.pro/latest/tsundoku-win-x64.exe`.

## The release key

`latest.json` is `{ "manifest": "<JSON as a string>", "signature": "<base64>" }`:
an ed25519 signature over exactly the manifest's bytes, so nothing has to agree
on how JSON is spelled. The manifest names the version, its date, the notes a
friend reads, and each file's name, size and SHA-256
(`src/lib/server/update-manifest.ts`).

- The private key is `~/.config/tsundoku/release-signing.pem` on the
  workstation (mode 600), made 2026-10-30, and nowhere else but its backup
  (below). Its public half, raw, is `RELEASE_KEY` in `update-manifest.ts`, in
  every build.
- An install refuses a `latest.json` whose signature isn't that key's, and an
  installer whose size or SHA-256 isn't the manifest's. The host only serves
  files; it is never trusted to choose them. Someone who took over the VPS
  could withhold an update, never push one.
- **Losing the key** means no install can verify a new release: every friend
  would install the next one by hand, from a build carrying a new key.
  **Back it up to Infisical** (project tsundoku, prod, in a folder
  `release`, secret `RELEASE_SIGNING_KEY`, the file as one line:
  `base64 -w0 ~/.config/tsundoku/release-signing.pem`). A folder, because
  `yarn run secrets:pull` copies the project's top level into the app's
  `.env`, where a signing key has no business. The machine identity here is
  Viewer-only, so that was the owner's step: done 2026-10-30.
- Not code signing: SmartScreen still warns on a first install. An update
  from inside tsundoku doesn't see that warning, since the installer was
  downloaded by tsundoku, not a browser (no mark of the web).

## Publishing

```sh
git tag release/2026.10.30.4
yarn run release 2026.10.30.4
ops/release/smoke.sh 2026.10.30.4           # writes out/<v>/.smoked when every platform passed
$EDITOR ops/release/notes/2026.10.30.4.txt  # what a friend reads: a few plain lines
yarn run release:publish 2026.10.30.4       # --dry-run signs and checks, uploads nothing
```

`publish` (`ops/release/publish.ts`) refuses a version smoke.sh didn't pass
whole (its `.smoked` mark), one without notes, and one already on the host. It
hard-links the files under their published names, signs `latest.json` and
opens it with the builds' public key (a mismatched key would publish a release
nobody can install), rsyncs the folder to `vps:tsundoku-releases/.<v>.part`,
renames it into place, points `latest` at it, and only then writes
`latest.json`. Last, it fetches `latest.json` and every file back over https,
as a friend's install will.

## On a friend's install

On only where the launcher sets `TSUNDOKU_UPDATES` (the release host) and the
build's version is a release's (`YYYY.MM.DD[.N]`): the workstation is
neither. `TSUNDOKU_UPDATES=off` in the data folder's `.env` stops it looking.

- **Looking** (`src/lib/server/updates.ts`): at most once a day, on any page
  load, without waiting for the answer; SETTINGS looks if the last check is
  over an hour old, and CHECK looks now. One GET of `latest.json`: Caddy's log
  sees the address, nothing else is sent.
- **Saying so**: the library shows one band, TSUNDOKU <v> IS OUT, until the
  friend opens SETTINGS (`tsundoku.update.seen` in the browser). SETTINGS >
  08 — DEVICES > UPDATES shows the version running, when it last looked, and
  what's new.
- **UPDATE** (Windows, installed by the installer: the launcher passes
  `TSUNDOKU_INSTALLED=1` when `uninstall.exe` is beside it): the server
  downloads the installer into `<data>/updates/<v>/`, checks its size and
  SHA-256 against the signed manifest, and starts it on its own, `/S
/RELAUNCH`. The installer stops tsundoku (as any update does), replaces the
  program, and starts the new one with `--no-browser`; the tab that pressed
  UPDATE polls `/api/updates` and reloads once the new version answers.
  Installers already run are deleted at the next check.
- **DOWNLOAD** everywhere else (Linux; Windows from the zip): the version's
  archive, and the steps (unpack beside, start the new one, delete the old).
  In place on Linux can come later.

## Tests

`tests/update-manifest.spec.ts` (signatures, tampering, malformed manifests,
version order), `tests/release-plan.spec.ts` (what the launcher passes). On
Windows, `ops/release/smoke/windows-update.ps1` runs in every release's smoke
test: Zen plays the release host on loopback (`serve-dir.mjs`), offering a
pretend 9999.01.01 whose installer is the one under test, signed with the real
key (`fake-update.ts`); tsundoku finds it, UPDATE downloads, checks and runs
it, and tsundoku must come back by itself on the same data.
