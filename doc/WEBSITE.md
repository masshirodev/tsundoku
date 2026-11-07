# The website: tsundoku.masshiro.pro

One static page that says what tsundoku is, shows it, and gets a Windows or
Linux install running. Card c359 ("A website at tsundoku.masshiro.pro
(password-gated until the public release)") on the Tsundoku board.

It is **behind a password until the public release** ([`DISTRIBUTION.md`](DISTRIBUTION.md):
the repositories stay private until then): Caddy's `basic_auth` in front of
it, configured on the VPS, not here. The page itself is the public page it
will become and never mentions the gate.

- Brief: [`briefs/done/WEBSITE.md`](briefs/done/WEBSITE.md).
- Handoff: the Claude Design canvas "tsundoku — website [finished]"
  (`https://claude.ai/artifact/31c3ce92-56a9-49ce-9c04-5a71d6e1f3de`),
  mirrored byte for byte in [`handoffs/website/`](handoffs/website/). Like
  `design/handoff/`, the mirror is never edited, and Prettier and ESLint skip
  it. `Main.dc.html` there holds the designer's eleven calls; this document
  cites them by number.

## Commands

```sh
yarn run site            # build site/build/ from the live latest.json
yarn run site:serve      # look at it: http://localhost:42150/
yarn run site:test       # unit tests, then the page in Chromium (desktop and phone)
yarn run site:captures   # retake the figures (below); commit what changes
```

`yarn run site --manifest file.json --offline` builds from a saved
latest.json with no network at all (FlareSolverr's sizes are then left out
rather than guessed). The browser tests build that way, from
`site/test/fixtures/latest.json`, a real latest.json saved from the download
host: it is signed by the release key, so it opens exactly as the live one does.
It predates c614, so it has no `files.android` and the browser run covers the
page as most releases draw it. The app rows are covered by
`site/test/page.test.ts`, which renders a c614-shaped manifest signed with a key
of the tests' own (`readRelease(text, key)`), never the release key.

## What is where

| Path                                                                | What                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `site/build.ts`                                                     | The build: reads everything below, writes `site/build/`.                |
| `site/lib/data.ts`                                                  | Pure: opening latest.json, sizes, dates, escaping, tokens, font picks.  |
| `site/lib/page.ts`                                                  | The page's HTML, from the handoff. Copy lives here.                     |
| `site/src/site.css`                                                 | The page's CSS, every measurement the handoff's.                        |
| `site/src/order.js`                                                 | Which download a visitor sees first: shared by the page and the tests.  |
| `site/src/site.js`                                                  | The only script: theme, and the visitor's system.                       |
| `site/captures/`                                                    | The figures, committed, with `captures.json` (sizes for `<img>`).       |
| `site/captures.config.ts`, `captures-db.ts`, `test/captures.e2e.ts` | How the figures are taken.                                              |
| `site/test/`                                                        | Unit tests (`*.test.ts`, `node --test`) and `site.e2e.ts` (Playwright). |
| `.github/workflows/site.yml`                                        | Build and deploy.                                                       |

`site/` sits outside both suites' globs on purpose: vitest takes
`tests/**/*.spec.ts` and the app's Playwright takes `tests/**/*.e2e.ts`
(TESTING.md), so neither collects the site's files, and the site's own
configs collect nothing of the app's. Like `scripts/` and `ops/`, `site/` runs
under Node's type stripping and isn't in svelte-check's tsconfig; ESLint and
its own tests cover it.

## What the build reads, never types

- **The release.** `latest.json` from dl.tsundoku.masshiro.pro, opened with
  `openManifest()` (`src/lib/server/update-manifest.ts`) and the release key
  in every build, exactly as an installed copy opens it. A signature that
  doesn't verify, a missing download, or a host that doesn't answer **stops
  the build**: the page never offers a file the release key didn't sign for,
  and never goes out without a release. Version, date, notes and each file's
  size come from the manifest; the links are `latest/<name>`, which
  `ops/release/publish.ts` keeps pointing at the newest release, so a page
  built a day late still downloads the newest.
- **The Android apps (c614, c667)** are in the same signed manifest, under
  `files.android.app` and `files.android.tv`. A row is drawn only for an app
  the manifest carries, with its signed name, size and SHA-256; a manifest
  without them is not refused, because every release before c614 has none, and
  the page is built exactly as it was before with no app row. The live host
  answers 404 for `latest/tsundoku-app.apk` until a release with APKs is
  published, so a link is never drawn from an older manifest.
- **FlareSolverr.** It isn't in the signed manifest, so its version comes from
  `ops/release/versions.json` and its sizes from a HEAD request to `latest/`.
- **The colours.** The `:root` and `[data-theme='light']` custom properties of
  `src/lib/styles/colors.css`, copied into the CSS, plus the same light block
  under `prefers-color-scheme: light` (the app decides by its cookie; the
  site follows the system until the visitor chooses). The site's CSS uses the
  app's own token names (`--surface-page`, `--text-prose`, ...): every colour
  in the handoff turned out to be one of them (checked with
  `design-tools/reconcile-tokens.mjs`).
- **The fonts**, self-hosted: IBM Plex Mono 400/500 from IBM's complete build
  (it has ← and →; `src/lib/styles/fonts-mono.css` says why), Plex Sans Latin
  400/500, and Plex Sans JP only in the Fontsource chunks that hold 積ん読,
  the page's only Japanese (three chunks a weight).
- **Sizes** are whole megabytes of 1024², the number Windows' Explorer shows
  for the file once downloaded.

Every published asset is named `name.<10 hex>.ext` after its content
(captures, fonts, icons, CSS, script), so Caddy can serve them as immutable
and only `index.html` (and `version.json`) needs revalidating. ranma's site
does the same, so the two Caddy blocks differ only in tsundoku's `basic_auth`.

## The visitor's system (calls 02 and 03)

The HTML as built is the no-JavaScript page: Windows, Linux, macOS, then any
app rows, in that order, nothing tagged, the Windows installer on the accent
(most friends are on Windows), the hero button `↓ DOWNLOAD`, no theme button
(it is added by the script, so without it there's no dead control). `site.js`
then:

| Visitor | Rows                                                               | Tagged YOUR SYSTEM    | Accent                        | Hero button            |
| ------- | ------------------------------------------------------------------ | --------------------- | ----------------------------- | ---------------------- |
| Windows | Windows, Linux, macOS, then any app rows                           | Windows               | the installer                 | ↓ DOWNLOAD FOR WINDOWS |
| Linux   | Linux, Windows, macOS, then any app rows                           | Linux                 | the tar.xz                    | ↓ DOWNLOAD FOR LINUX   |
| macOS   | macOS, Windows, Linux, then any app rows                           | macOS                 | none: nothing is theirs       | ↓ DOWNLOAD             |
| phone   | the phone app (if any), the TV app (if any), then the desktop rows | the phone app, if any | the phone app, else installer | ↓ DOWNLOAD             |
| iOS     | the desktop rows, then any app rows                                | none                  | the Windows installer         | ↓ DOWNLOAD             |
| TV      | the TV app (if any), the phone app (if any), then the desktop rows | the TV app, if any    | the TV app, else installer    | ↓ DOWNLOAD             |

A release without `files.android` has no app rows at all, and every row above
the phone and iOS lines behaves exactly as it did before c667. A phone and an
iOS device also get the band above 04's rows ("ON A PHONE?"); a TV does not.

An iPhone, iPad or iPod is `ios`, never `phone`, even though it gets the band
and the same line about needing a computer: both APKs are Android's, so an app
row never leads, is tagged YOUR SYSTEM or takes the accent for it, and the
Windows installer keeps the accent as it did for a phone before c667. 06's
lead says the app is Android's, so an iOS reader is not offered it.

`navigator.userAgentData.platform` where Chromium offers it, else the user
agent. Android says Linux in its user agent, so phones are checked first; an
iPad asking for the desktop page says Mac, and its touch screen gives it away
(also `ios`). An Android television has no dependable "is a TV" flag, so the
names TV browsers use (`Android TV`, `Google TV`, `Fire TV`, `AFT…`, `BRAVIA`,
`SHIELD`) make it a TV, and an Android tablet without one stays a phone, which
the phone app serves too. The rules are `site/src/order.js`, one copy for the
page and the tests.

## Theme (call 04)

Dark (Graphite / lime) or light (Paper / ink) follows the system, in CSS. The
header's cell reads `/LIGHT` or `/DARK`, the app's own search commands, sets
`data-theme` on `<html>`, and is remembered in `localStorage` (guarded: a
private window that refuses storage just doesn't remember). Each figure is
captured in both palettes and CSS shows the one in force; the two reader
figures are dark only, as the reader is.

## Captures

`yarn run site:captures` builds the app, seeds a fresh library into a scratch
folder (on `/mnt/hdd2/tmp` when it exists, since `/tmp` is RAM on the
workstation, and removed afterwards), serves it, and takes the six figures of
the handoff's capture table with Playwright at device scale 2, as WebP, with
their sizes in `captures.json`. They're committed: a deploy never boots the
app, and a figure that changes shows up as a reviewable diff. Retake them when
a screen they show changes.

| Figure  | Screen                | Device           | Palettes |
| ------- | --------------------- | ---------------- | -------- |
| FIG. 1  | Library               | desktop 1440×900 | both     |
| FIG. 2  | Series (Frieren)      | tablet 800×1280  | both     |
| FIG. 3  | Library               | phone 412×915    | both     |
| FIG. 4  | Reader, controls up   | phone 412×915    | dark     |
| STILL A | Long strip (a manhwa) | phone 412×915    | dark     |
| STILL B | History               | phone 412×915    | both     |

**Nothing hidden ever reaches a figure.** The seed has a hidden Hentoid root
of doujinshi (`src/lib/server/fixtures.ts`, `HIDDEN_TITLES`). Reveal is never
turned on, and every shot is refused if a hidden title, the word HENTOID or
HIDDEN, or the word DOUJIN is anywhere in the page. `site/captures-db.ts`
readies the scratch database first, and only that one (it refuses any path
that isn't a capture run's):

- it clears the sample description every seed series carries ("Development
  sample. ... Hentoid has none ..."), which is right for development and
  wrong on a public page; the series screen then draws as it does for any
  series without one;
- it moves the seed's one visible doujin (Hoshi no Umi no Tabibito) into the
  hidden root, so the library figures name no doujinshi (call 09, and the
  brief).

Both change the data the app shows, never the picture of it.

## Deploy

`.github/workflows/site.yml` runs on a push to main that touches the site (or
the colours, the manifest code, the friend README, `versions.json`, the
lockfile), and on dispatch. `ops/release/publish.ts` dispatches it at the end
of a successful publish (`gh workflow run site.yml`; a failure there only
warns, since the release is already out), so the download block shows a new
version within minutes. The job runs the unit tests, builds from the live
latest.json, and rsyncs `site/build/` to the VPS:

```sh
rsync -rlz --delete-delay --delay-updates --checksum \
  -e 'ssh -p 8443 -i ~/.ssh/site -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=~/.ssh/known_hosts' \
  site/build/ masshiro@vps.example:public/
```

- **`SITE_DEPLOY_KEY`**: a key used for nothing else, locked on the VPS by
  `authorized_keys` (`restrict`, `command="rrsync -wo ~/sites/tsundoku"`) to
  writing that one folder: no shell, no reading, nothing else.
- **The destination is named**, `public/` (what Caddy serves), never a bare
  `host:`. Through rrsync they'd be the same folder, but without the lock a bare
  `host:` is the home directory, and an `rsync --delete` aimed at one deleted
  most of the VPS home on 2026-11-03 (Masshiro card c60).
- **`SITE_KNOWN_HOSTS`**: the VPS's host key line for `[vps.example]:8443`,
  pinned; it is never learned on first contact. SSH on the VPS listens on 8443.
- `--delay-updates` and `--delete-delay` swap the new files in at the end and
  remove the old after, so a visitor mid-deploy gets one version or the other.
  Old hashed assets go with the next deploy, which is safe because the new
  `index.html` no longer names them.

Install runs with `--ignore-scripts`: the site needs no native module, and
`prepare` wants the sibling kotoba checkout (`link:../kotoba`), which yarn
leaves as a dangling link on a runner. The site never imports kotoba.

The repository is private, so its Actions minutes are metered; a deploy is a
minute or two. The VPS side (Caddy's block with `basic_auth`, the read-only
mount of `~/sites`, the hub's `sites.yaml`, the probe expecting 401)
lives in the homelab repository on the VPS.

## Where it departs from the handoff

Each of these is deliberate; don't "fix" it back to the drawing.

- **Numbers.** The handoff draws `2026.10.30.4` and `[SIZE]`; the page shows
  whatever the signed manifest says. Notes are one paragraph per line of the
  manifest's `notes`.
- **IMPORT** says "your Mihon downloads and EPUBs in the library folder", not
  "CBZ files and EPUBs": a CBZ is only imported as a Mihon (or Hentoid)
  download (IMPORT-FORMATS.md), never as a loose file.
- **FlareSolverr's size** in its prose is the measured one ("about 311 MB",
  as its buttons say), not README.txt's "about 330 MB", which is the same file
  in decimal megabytes; two numbers for one file on one page read as a mistake.
- **The figures are captures, not the drawn renditions,** of the seed library
  as it is: its real titles, progress and chapters (Frieren is at chapter 140
  of 140, not 61 of 128), its striped covers, its AniList linking band. The
  handoff's drawings only placed them (Main.dc.html, section 03).
- **Two download rows the handoff does not draw** (c667). ANDROID and ANDROID
  TV are the desktop rows' own name/body/note markup, so 04 keeps its shape;
  they appear only when the signed manifest carries the apps, and their
  buttons, sizes and SHA-256 come from it. 06 and the phone band name the app
  in the same condition. The install line (allow installs from the browser;
  on a TV, a USB stick or a downloader app) is plain text in each row.
- **Phone captures are 412×915**, the handoff's frame, not the e2e `phone`
  project's Pixel 7 viewport (412×839): same device, the full screen height
  the frames draw.
- **FIG. 1 on a phone** is the desktop capture cropped from the right to
  1190/900, which is exactly the library without its 247px sidebar; the
  handoff draws that view at 4:3 without the sidebar.
- **Between phone and desktop.** The handoff draws 1440 and 390. Below 1080px
  the header's six anchors don't fit, so they go (the phone's header);
  below 900px the hero, WHAT IT DOES and STARTING IT stack, and the figures
  go two up. Below 600px is the handoff's phone, as drawn.
- **No `<template>` for OS states.** The handoff's Download-States board is
  five renders; the page is one document that the script reorders, so the
  no-JavaScript state is literally the HTML.
- **`gen-conformance.mjs` wasn't used.** The handoff's values are
  `{{holes}}` filled by the design runtime (`support.js`, not part of the
  export), so a machine extraction measures unresolved templates.
  `site/test/site.e2e.ts` pins the authored values by hand instead: header
  56/48px, gutters 24/16px, the 1200px column, hero 5fr/7fr, look
  10fr/7.2fr/7.2fr, the 380px stills column, 160px feature labels, 220px
  download names, 48px and 44px step numbers, 120px data labels, the footer's
  1:2:1:1, 44px controls and 48px hero buttons.

## Left to the owner

- **HELP**, the footer's slot and the last row of IF SOMETHING GOES WRONG:
  `DEFAULT_HELP` in `site/lib/page.ts`, "Ask whoever gave you tsundoku."
  (README.txt's own answer) until it says where to ask.
- **At the public release**: take the `basic_auth` off (VPS), add SOURCE → as a
  fifth footer cell, and drop `<meta name="robots" content="noindex">` from
  `site/lib/page.ts`. Docker compose, once built, becomes a row in 04 under
  Linux.

## What it does not do yet

- **The app rows wait for a release that carries them.** When c667 landed the
  live `latest.json` was 2026.11.05.1's, older than c614, with no
  `files.android`: the deployed page draws no app row, and offers no app in 06
  or the band, until the owner publishes a release with the APKs
  ([`UPDATES.md`](UPDATES.md), "The Android apps"). Nothing in the site has to
  change for that; the next deploy reads the new manifest.
- No page for older versions or notes: OLDER VERSIONS links Caddy's listing
  of dl.tsundoku.masshiro.pro, which has the checksums.
- The series figure shows the series screen's real FILE row, with its HIDE
  and DELETE buttons and the sample's `sample:library/...` path. Neither is
  hidden content, but whether HIDE belongs on a public figure is the owner's
  call; cropping or retaking FIG. 2 is the fix if not.
- No Open Graph image or social card.
- Not in svelte-check: `site/` is type-stripped TypeScript, linted and tested
  but not type-checked, like `scripts/` and `ops/`.
