# Downloading on the workstation

Mihon on Android (tablet, phone, Waydroid) keeps pausing and halting its
downloads, however much leeway it's given. The workstation doesn't. So
manga can also be downloaded here, by
[Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server), which runs
Mihon's own extensions (the [Keiyoushi](https://keiyoushi.github.io) repo) on
the JVM. tsundoku still doesn't download anything itself
([`ARCHITECTURE.md`](ARCHITECTURE.md), "Web novels"): Suwayomi writes files,
and tsundoku imports them.

Set up 2026-10-03 (c75).

## The idea: Suwayomi is one more device

Suwayomi writes **Mihon's download layout**, and its backups are **Mihon's
`.tachibk`**. So it gets a device folder like the phone and Waydroid
([`SYNC.md`](SYNC.md), "Other devices"), and the importer reads it with no
code of its own:

```
$LIBRARY_ROOT/devices/suwayomi/Mihon/
  downloads/<Source> (<LANG>)/<Series>/<Scanlator>_<Chapter>.cbz
  autobackup/org.suwayomi.tachidesk[.auto]_<date>_<time>.tachibk
```

Measured 2026-10-03 against Suwayomi v2.4.2366 and the tablet's copy of the
same chapters:

- **Source ids are Mihon's.** The id belongs to the extension, not the app, so
  a series is keyed `mihon:<source id>:<url>` as on the tablet. All nine
  sources of the library that Keiyoushi has matched by id.
- **Chapter URLs are the same** (`/chapters/01J76…` for Weeb Central).
- **The folders are Mihon's,** one level down: Suwayomi writes them under
  `downloads/mangas/`, so that subfolder is what's mounted here.
- **The CBZs differ in small ways:** no `_<hash>` suffix in the name, pages
  deflated rather than stored (`src/lib/server/zip.ts` reads both),
  `<Translator>` filled in, and no `<SourceMihon>` (the folder name gives the
  source).
- **The backup decodes** with the Mihon reader as it is.

So a series Suwayomi downloads that the tablet also has becomes **one
series**, its chapters from whichever device has them. A chapter both have
keeps the copy already there. That was checked on the live library with The
Spark in Your Eyes: the tablet's 212–218, Suwayomi's 219, one series.

## How it's set up

| Piece                 | Where                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| The container         | `ops/suwayomi/compose.yml` (`ghcr.io/suwayomi/suwayomi-server:stable`)   |
| Its unit              | `ops/systemd/tsundoku-suwayomi.service`, a user unit                     |
| Its data              | `/mnt/hdd2/tsundoku/suwayomi` (database, settings, extensions)           |
| Downloads and backups | `$LIBRARY_ROOT/devices/suwayomi/Mihon/{downloads,autobackup}`            |
| Web UI                | `http://127.0.0.1:4567`, on the workstation only                         |
| The import timer      | `ops/systemd/tsundoku-suwayomi-import.{service,timer}`: every 10 minutes |
| The timer's step      | `scripts/suwayomi-import.ts` (`yarn run suwayomi-import`)                |
| The rules             | `src/lib/import/suwayomi.ts`, tested in `tests/suwayomi-domain.spec.ts`  |

**Docker never starts it on its own** (`restart: 'no'`). The systemd unit does,
with `RequiresMountsFor=/mnt/hdd2`. A container started before the disk is
mounted would write the downloads onto `/`, under the empty mount point.

**The unit makes the mount points first.** The two library folders are
mounted inside Suwayomi's data folder, and Docker would create those mount
points as root, leaving Suwayomi (uid 1000) unable to write next to them.

**localhost only, no login.** Nothing else on the network needs it; it's
used from the workstation's browser. Reaching it from the tablet is a later
decision (below).

Installed 2026-10-03:

```sh
ln -s ~/projects/tsundoku/ops/systemd/tsundoku-suwayomi.service \
      ~/projects/tsundoku/ops/systemd/tsundoku-suwayomi-import.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tsundoku-suwayomi.service tsundoku-suwayomi-import.timer
```

### Extensions

The Keiyoushi repo is set by `EXTENSION_STORES` in the compose file. The
extensions installed are the library's Mihon sources that Keiyoushi has:
Asura Scans, Toonily, Toonily.me, Mangahere, MangaDex, Weeb Central, Omega
Scans, Kumaraw, Webtoons.com. Install more from the web UI (_Browse →
Extensions_).

**Bato.to ("XBatCat" on the tablet) and Hitomi aren't in Keiyoushi** (71
series of the library between them: two Bato.to source ids, one Hitomi).
They keep downloading on Android until a repo that carries them is added.

## The library, restored from the tablet

On 2026-10-03 the tablet's newest backup (`app.mihon.debug_2026-10-03_07-58`)
was restored into Suwayomi (_Settings → Backup → Restore_, or the
`restoreBackup` mutation), so it starts with the same library: 365 series in
the 12 rating categories, 54,339 chapters, 20,103 of them read. The other 406
manga in the backup were only browsed in Mihon and stay out of the library,
as there.

Its backups now carry the whole library, keyed as the tablet's are, so an
import merges into the series already here. A forced import right after
the restore created no series and no chapters (6,856 and 65,674 before and
after). Ratings, shelves and other edits in tsundoku are left alone, as on
every rescan.

Series from sources not installed came over as well, but can't be updated
or downloaded. Run `validateBackup` on a backup to list them before a
restore. For the tablet's, these are missing: **not in Keiyoushi:** Bato.to (the
two ids the tablet calls XBatCat), Hitomi, NHentai, Toonily.net, Animated
Glitched Scans; **in Keiyoushi, not installed:** Luscious, Everia.club,
AHottie, Elite Babes, Playmate Hunter, nHentai.com (unoriginal).

With the library in it, Suwayomi checks about 400 series for new chapters
every 12 hours. Auto-download is off, so nothing downloads on its own.
Turning it on (_Settings → Downloads_) downloads new chapters of the whole
library onto `/mnt/hdd2`.

## Using it

From tsundoku, on any device: open a series and press **NEXT 10** on its
DOWNLOAD row, or tap a chapter that isn't downloaded (below, "From
tsundoku"). Within ten minutes of a chapter landing, tsundoku imports it,
while the rest of the queue is still downloading: the band, the NEW shelf
and covers, as START SCAN.

Suwayomi's own web UI (`http://127.0.0.1:4567`, the workstation only) is
still there for what tsundoku doesn't do: extensions, and series tsundoku
doesn't have yet. **Add a series to Suwayomi's library before downloading it
there.** The backup only carries library series. A download of a series not
in the library is keyed by its folder (`mihon-dir:…`,
[`IMPORT-MIHON.md`](IMPORT-MIHON.md)) and won't merge with the tablet's copy
until it's added and a backup lists it. Downloading from tsundoku does that
step itself.

## From tsundoku

Since 2026-10-04 (c94, "Drive Suwayomi's downloads from tsundoku"),
downloading is driven from tsundoku's own screens, on every device. The
server talks to Suwayomi's GraphQL API on localhost
(`src/lib/server/suwayomi.ts`). Suwayomi stays bound to localhost, with no
login, and still does all the downloading. The rules are pure and tested
(`src/lib/library/downloads.ts`, `tests/downloads-domain.spec.ts`). The
screens come from the handoff in `doc/design/handoff/`: `Index Series
Download.dc.html`, `Index Downloads.dc.html` and the canvas `Download
States.dc.html` (brief: [`briefs/done/DOWNLOADS.md`](briefs/done/DOWNLOADS.md)).

**It's off unless `SUWAYOMI_URL` is set** (`http://127.0.0.1:4567` on the
workstation; [`SECRETS.md`](SECRETS.md)). Without it, no screen draws a
DOWNLOAD row, a QUEUE cell or DOWNLOADS. The e2e build depends on this: only
`tests/downloads-flow.e2e.ts` turns it on, against a fake Suwayomi.

**How a series and a chapter are matched.** A series is a Suwayomi manga by
its key, `mihon:<source id>:<url>` (the source id and URL Suwayomi itself
has), and a chapter is a Suwayomi chapter by its URL. Series keyed any other
way (Hentoid, EPUB, a `mihon-dir:` folder) have nothing to download.

### The series screen

- **DOWNLOAD** sits under CONTINUE, shaped like the LINK row: what's missing,
  what's under way, then **NEXT 10** (accent) and **ALL N**. NEXT 10 queues
  at once: the next unread chapters with no file, in reading order. When
  nothing of the series is on disk yet, it reads **FIRST 10**. ALL N asks
  first: the span, the size at this series' own average chapter, the queue it
  joins, and that read chapters are left out. The confirmation is a URL
  (`?download=all`), so it opens without script too. Read chapters with no
  file are never in either.
- **The row is the button.** A tap on a chapter with no file queues it, and a
  tap on a failed one retries it. A long press still marks through. Each row
  says where it is in its status column: QUEUED, DOWNLOADING · 31 / 54 with an
  ink bar (accent stays reading's), FAILED · 3 TRIES with a 3px ink rule on
  its left edge, IMPORTING (Suwayomi has it, the import hasn't run yet), then
  the plain row.
- **SELECT** puts DOWNLOAD first in the bulk bar, counted: the selected
  chapters it would queue or retry. On a phone the five actions wrap into two
  rows.
- **FILE** counts the queue: `393 OF 612 DOWNLOADED · 4 QUEUED · 1 FAILED`.
- **No extension for its source** (Bato.to, Hitomi): no DOWNLOAD row and no
  disabled button. The FILE line says it once: `BATO.TO DOWNLOADS ON THE
TABLET`, named by the series' `source` tag.
- **Suwayomi not answering, or the device offline:** the row stays where it
  was, with its cells at 0.35, and the second line says why: `○ NOT ANSWERING
· SUWAYOMI ON THE WORKSTATION · SINCE 14:02` or `○ OFFLINE · DOWNLOADING
NEEDS THE WORKSTATION`. That row is one of only two places outside SETTINGS
  that name Suwayomi; the other is the queue's own not-answering band.

**What a download does in Suwayomi.** First it puts the manga in Suwayomi's
library (`updateManga`, `inLibrary: true`), the step "Using it" asks for,
so the next backup keys the download as the tablet's copy. Then it queues
the chapters (`enqueueChapterDownloads`) and starts the downloader, unless
the queue was paused from tsundoku. A chapter Suwayomi doesn't list yet gets
one refresh from the source (`fetchMangaAndChapters`). If the source still
doesn't have it, the page says how many weren't there (`N NOT AT THE
SOURCE`).

### The queue

`/downloads`, reached from a **QUEUE** cell in the library's top bar (QUEUE
over its count, before SELECT, only while something is queued) and from
**DOWNLOADS** in the desktop sidebar's foot (always there, under HISTORY).

- A progress band names what's downloading now and links the last hour's
  arrivals to the NEW shelf: what's finished is the NEW shelf's business, not the queue's.
- **01 — FAILED** comes first, with RETRY ALL, and RETRY and ✕ on each. ✕
  takes it out of the queue, and the chapter stays NOT DOWNLOADED.
- **02 — QUEUE** lists series in Suwayomi's order, each with its count and
  span. MORE ↓ opens one (`?open=<manga>`, so without script too):
  ↑ TO THE TOP, CANCEL N, and its next four chapters. After twenty series,
  `+ N MORE SERIES`.
- **PAUSE / RESUME** in the top bar stops and starts Suwayomi's downloader.
  RESUME is the accent cell while paused, and the band says since when.
- The library shows failures as a band, like POSSIBLE DUPLICATES:
  `05 DOWNLOADS FAILED`, the series, REVIEW →.

**Hidden means hidden.** With reveal off, a hidden series' chapters aren't
listed, named or counted: not in the queue, not in the QUEUE cell, not in the
failures band. A queue of hidden series alone reads as empty. A manga
tsundoku hasn't imported yet can't be judged, so it counts as hidden until
it has been (with reveal on it shows under Suwayomi's title). Every action
re-reads the queue and acts only on what the viewer can see.

**Cost.** The whole queue is one request (about 100 KB for 2,316 chapters)
and is kept for two seconds, so a page and its chrome ask once. Every page
load asks for the QUEUE cell's counts with an 800 ms timeout. While Suwayomi
isn't answering it isn't asked again for fifteen seconds, and the last counts
come back dimmed.

### Where it departs from the handoff

- **No reason for a failure.** The mock reads `FAILED · NOT FOUND`,
  `TIMED OUT`, `PAGES MISSING` with a time. Suwayomi's queue item
  (`DownloadType`) has `position, progress, state, tries, chapter, manga`,
  and nothing else: it says that a chapter failed and how often it tried,
  never why or when. So rows read `FAILED · 3 TRIES`, and the failures band's
  detail names the series instead of reasons.
- **PAUSED SINCE** is only known when tsundoku paused it
  (`settings.downloads_paused_at`). Paused from Suwayomi's web UI, the band
  says PAUSED with no time. Resumed there, tsundoku's pause clears itself.
- **The card is c94**, not the c93 the handoff names.
- **ALL N counts what it can queue.** The mock draws `ALL 213` beside
  `213 unread chapters not downloaded`, including the four queued. Here the
  cell counts only what it would actually queue, so its number can be
  smaller than the line's.
- **Ten or fewer to queue** shows one cell (`NEXT 7`) rather than NEXT and an
  ALL of the same chapters.

## The import timer

`suwayomi-import` asks the running app to import, never imports itself,
for the reason in [`SYNC.md`](SYNC.md), "Why the app imports, not the timer".
It asks only when **the downloads changed since the last import**: the
count, the bytes and the newest mtime of every file, kept in
`~/.local/state/tsundoku/suwayomi.json` and written only once the app accepted
the scan. A count alone would miss one chapter deleted and another
downloaded.

**A running queue doesn't hold it back.** Until 2026-10-04 it waited for an
empty queue, so that a chapter being written wouldn't import with half its
pages. With 3,945 chapters queued that meant nothing imported for days. It
also wasn't needed, as measured that day with `inotifywait` on the downloads
folder:

- Suwayomi gathers a chapter's pages outside the downloads folder, then
  creates its CBZ in place and writes it in one go, taking milliseconds;
- a zip's index (the end of central directory) is written last, so a CBZ cut
  off at 10, 50, 90 or 99% has none, and `src/lib/server/zip.ts` refuses it
  ("not a zip").

So a chapter caught mid-write is skipped as unreadable and imported by the
next run. It never imports with half its pages. That holds only for CBZs: with
CBZ off (`DOWNLOAD_AS_CBZ` in the compose file pins it on), a chapter is a
folder that fills page by page, so the timer reads `settings.downloadAsCbz`
and then still waits for the queue (`suwayomiDecision`,
`src/lib/import/suwayomi.ts`).

**Before asking, it takes a backup** (`createBackup`) into `autobackup/`,
keeping its three newest. Suwayomi's own backup is daily. Without a fresh
one, a series added and downloaded since would import keyed by its folder
until the daily backup came, and only then be folded under its URL
([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the backup knows it"). Suwayomi's own
`.auto_` backups land in the same folder and are pruned by its `BACKUP_TTL`
(14 days).

`yarn run suwayomi-import -- --force` asks regardless of the fingerprint.
If Suwayomi isn't answering, the timer logs it and does nothing.

## Read progress: tsundoku's

Suwayomi has its own read state. **tsundoku stays the source of truth**:

- what's read in Suwayomi's web UI comes in through its backup and, as with
  every device, **only moves forward**;
- nothing is written back to Suwayomi. It's a downloader here, not a reader.

## Disk

Downloads land on `/mnt/hdd2`, beside the rest of the library. Only the
image (about 1.4 GB) is on `/`. Nothing is deleted: chapters stay until
deleted in Suwayomi, and a delete there marks them not downloaded at the next
import, like any device's.

## Checking on it

```sh
systemctl --user status tsundoku-suwayomi.service
journalctl --user -u tsundoku-suwayomi-import.service -n 20  # "nothing new", "import started"; "still downloading" only with CBZ off
docker logs --tail 50 tsundoku-suwayomi
```

Updating Suwayomi: `docker pull ghcr.io/suwayomi/suwayomi-server:stable`,
then `systemctl --user restart tsundoku-suwayomi`.

## Not done yet

- **Series Mihon downloaded but never added to its library** (34 on
  2026-10-03) are keyed by folder, so a Suwayomi copy of one is a second
  series. Once one is added to the library and a backup lists it, the next
  import folds the two (c90, [`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the
  backup knows it").
- **The second half of c94** isn't built yet: source search and ADD TO LIBRARY
  (Download States 1e), FOLLOW (1d), live updates, and importing the moment a
  chapter finishes. Until then, the timer imports within ten minutes, and a
  series tsundoku doesn't have is added from Suwayomi's web UI.
- **A series Suwayomi has never seen** (one only the phone had, from a source
  that's installed) draws no DOWNLOAD row: nothing can be queued for a manga
  Suwayomi has no record of. Search and ADD will cover it.
- **Reaching Suwayomi's web UI from the tablet** is no longer needed for
  downloading. It stays localhost-only.
