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
- **Saying so**: a modal on the library (below, "Told on entry"), and one
  band, TSUNDOKU <v> IS OUT, until the friend opens SETTINGS (`tsundoku.update.seen` in the browser). SETTINGS >
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

## Told on entry

A new version is also a **modal on the library** (card c208; the Getting
Started handoff, board 4: `doc/design/handoff/Start-Update*.dc.html`),
`src/routes/UpdateModal.svelte`. Its words and rules are
`src/lib/updates.ts`; the run it starts is `src/lib/update-run.svelte.ts`,
the same loop SETTINGS' UPDATE runs now, so the two can't differ.

- **Where**: the library, on the computer itself (`locals.via` is `local`),
  where updating works (the layout's `updateOffer`). Never the workstation,
  never a phone over Wi-Fi: the computer updates, not the phone. A phone over
  Tailscale does see it; UPDATE there still updates the computer.
- **When**: once the daily check has found the version, which doesn't wait,
  so usually the next open. **LATER** (and Escape, and the scrim) snoozes it
  for a day, for that version, in that browser
  (`tsundoku.update.later`); a newer version asks at once.
- **What it says**: the version, `RELEASED 2 NOV · 182 MB · SIGNED BY
TSUNDOKU'S RELEASE KEY`, the notes a line each, UPDATE → / LATER. On Linux
  and the zip, DOWNLOAD ↓ and the three steps.
- **UPDATE, in the modal**: Downloading (a 4 px bar and the count; HIDE puts
  it away and the library's band counts, `UPDATING · 41%`, with SHOW),
  Installing, Opening again (the tab waits, with a clock), then the reload. A
  failure says nothing was changed, with TRY AGAIN. After the reload the
  library says `UPDATED TO <v>` once (`tsundoku.update.done`), with ✕.
- **The band** `TSUNDOKU <v> IS OUT` stays as it was, until SETTINGS is
  opened.

**Where it departs from the handoff**

- **LATER is a day, not the whole version.** The handoff drew "quiet until
  the next version"; the owner, 2026-10-30: "later can mean a day... they
  can still update through the settings tho, just snooze the modal a day".
  The note under it says ASKED AGAIN TOMORROW.
- **The DOWNLOAD variant keeps the note** under its buttons, as the install
  one does; board 4E had none.
- **Only on the library.** "On entry" is the library, where the band was;
  a friend opening a bookmarked chapter isn't stopped mid-read.

**Not tested end to end**: the modal needs a release-dated build and a
manifest signed with the release key, which no test holds and none should.
`tests/updates-client.spec.ts` covers when it asks, every line it says and
the UPDATE loop (old server, nobody, the new one; a failure; a refusal);
the Windows smoke covers the server's side. It was checked by eye on
2026-10-30 against a dated build and a scratch-signed manifest, on the
desktop and the phone.

## The Android apps

The phone and tablet app and the TV app are sideloaded, so nothing else
updates them; they update themselves from the same host and the same signed
`latest.json` (card c614, "The Android apps update themselves: a signed APK
from the release host, offered in UPDATES and the library's modal";
[`PHONE-APP.md`](PHONE-APP.md), [`TV-APP.md`](TV-APP.md)).

- **Published with every release.** `ops/release/android-apk.sh <version>`
  builds both beside the bundles, release-signed; `release:publish` refuses a
  version without them, or with a `-debug` one (a debug-signed APK can't
  update an installed app, whose certificate is the keystore's). They go up
  as `tsundoku-app.apk` and `tsundoku-tv.apk`, in the manifest under
  `files.android.app` and `files.android.tv`, size and SHA-256 signed with
  the rest. **A friend's lasting link** for a first install is
  `https://dl.tsundoku.masshiro.pro/latest/tsundoku-app.apk`.
- **Looking** (`Updater.kt`): on launch at most once a day, never for a
  build whose version is no release (a local `1.0.0`), and when asked. One
  GET of `latest.json`, with a user agent of `tsundoku-app/<version>`.
- **Trust, as on a computer** (`ReleaseCheck.kt`): the manifest's ed25519
  signature checked against the same release key (`net.i2p.crypto:eddsa`,
  since Android 6 has no ed25519; a JVM test reads `RELEASE_KEY` out of
  `update-manifest.ts`, so the two copies can't drift), and the APK checked
  against the signed size and SHA-256 before anything installs it.
- **Newer** is the release-version order, and a dev build counts by its date
  (`2026.11.05-dev2` is offered `2026.11.05.1` and later). Android's
  `versionCode` is the date version as YYYYMMDDNN (`Versions.code`, and the
  same rule in `app/build.gradle.kts`), so every release is newer to the
  installer than the one before; before c614 it was always 1.
- **Installing** is Android's PackageInstaller. Android 8 and later ask once
  to allow installs from tsundoku (the app opens that switch and installs when
  you come back), and Android shows its own "Update this app?" the first
  time. From Android 12, an app that installed itself may update without
  asking again (`USER_ACTION_NOT_REQUIRED`). Never silent the first time:
  only an app store can be.
- **Saying so** is the web app's: the bridge gives the page `appUpdate()`
  (the version running, the phase, the release on offer), `appCheck()`, and
  the guarded `appDownload()` and `appInstall()`, and posts every change as
  `window.tsundokuAppUpdate(state)`. The owner chose (2026-11-05) to reuse
  what the computer has rather than draw anything new: a THIS APP row under
  SETTINGS' UPDATES, and the library's modal for the app. **Not built yet**:
  SETTINGS, the library page and the i18n messages are wave 25's while it
  runs, so the page side of c614 follows it. Until then the app checks and
  can install, and nothing on screen offers it.

## Tests

`tests/update-manifest.spec.ts` (signatures, tampering, malformed manifests,
version order), `tests/release-plan.spec.ts` (what the launcher passes),
`tests/updates-client.spec.ts` (the modal's rules and words, and the UPDATE
loop). On
Windows, `ops/release/smoke/windows-update.ps1` runs in every release's smoke
test: Zen plays the release host on loopback (`serve-dir.mjs`), offering a
pretend 9999.01.01 whose installer is the one under test, signed with the real
key (`fake-update.ts`); tsundoku finds it, UPDATE downloads, checks and runs
it, and tsundoku must come back by itself on the same data.
