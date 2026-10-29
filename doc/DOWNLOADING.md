# Downloading on the workstation

Mihon on Android (tablet, phone, Waydroid) keeps pausing and halting its
downloads, however much leeway it's given. The workstation doesn't. So manga
is downloaded here, by **tsundoku itself**, running Mihon's own extensions on
its extension engine: [`DOWNLOADER.md`](DOWNLOADER.md) is how the queue, the
worker and the files work, [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md) the
engine, and [`BROWSE.md`](BROWSE.md) finding series and managing extensions.
This file is the screens that drive it, on every device.

From 2026-10-03 to 2026-10-28 the work was done by Suwayomi-Server, with these
same screens over its API (c75, c94). It was retired on 2026-10-28 (c129):
"Suwayomi, retired", below, is what that left.

## How a series and a chapter are matched

A series is a source's manga by its key, `mihon:<source id>:<url>`: the same
key the tablet's Mihon backup gives it, so a series downloaded here and the
tablet's copy are **one series**, its chapters from whichever device has
them. A chapter is the source's chapter by its URL. A novel from an LNReader
plugin is `lnreader:<plugin>:<path>`, each chapter by its path, and downloads
through the same screens and queue into its EPUB ([`NOVELS.md`](NOVELS.md),
"Downloading"), and FOLLOW asks its plugin. Series keyed any other way (Hentoid, an
EPUB of the tablet's, a `mihon-dir:` folder) have nothing to download.

Downloads are written as one more Mihon device, `devices/tsundoku/Mihon/`, and
imported like the phone's ([`DOWNLOADER.md`](DOWNLOADER.md)). **It's off unless
`ENGINE_URL` and `ENGINE_TOKEN` are set** ([`SECRETS.md`](SECRETS.md)):
without them no screen draws a DOWNLOAD row, a QUEUE cell, DOWNLOADS or
BROWSE. The e2e build depends on this: only `tests/downloads-flow.e2e.ts` and
the browse specs turn it on, each against a fake engine.

The rules are pure and tested (`src/lib/library/downloads.ts`,
`tests/downloads-domain.spec.ts`); the screens ask `src/lib/server/downloads.ts`,
which answers from the engine's backend (`engine/backend.ts`). The screens
come from the handoff in `doc/design/handoff/`: `Index Series
Download.dc.html`, `Index Downloads.dc.html` and the canvas `Download
States.dc.html` (brief: [`briefs/done/DOWNLOADS.md`](briefs/done/DOWNLOADS.md)).

## The series screen

- **DOWNLOAD** sits under CONTINUE, shaped like the LINK row: what's missing,
  what's under way, then **NEXT 10** (accent) and **ALL N**. NEXT 10 queues
  at once: the next unread chapters with no file, in reading order. When
  nothing of the series is on disk yet, it reads **FIRST 10**. ALL N asks
  first: the span, the size at this series' own average chapter, the queue it
  joins, and that read chapters are left out. The confirmation is a URL
  (`?download=all`), so it opens without script too. Read chapters with no
  file are never in either.
- **Since 2026-10-29, a series a source serves reads online instead**
  ([`BROWSING.md`](BROWSING.md), "Manga online"): its rows open, and
  downloading is the ↓ cell at the end of each row (RETRY on a failed one).
  What follows is how a row behaves where nothing reads online.
- **The row is the button.** A tap on a chapter with no file queues it, and a
  tap on a failed one retries it. A long press still marks through. Each row
  says where it is in its status column: QUEUED, DOWNLOADING · 31 / 54 with an
  ink bar (accent stays reading's), FAILED · 3 TRIES with a 3px ink rule on
  its left edge, IMPORTING (written, waiting on a scan: rare since c170,
  [`DOWNLOADER.md`](DOWNLOADER.md), "Attaching"), then the plain row.
- **SELECT** puts DOWNLOAD first in the bulk bar, counted: the selected
  chapters it would queue or retry. On a phone the five actions wrap into two
  rows.
- **FILE** counts the queue: `393 OF 612 DOWNLOADED · 4 QUEUED · 1 FAILED`.
- **No extension for its source** (Bato.to, Hitomi): no DOWNLOAD row and no
  disabled button. The FILE line says it once: `BATO.TO DOWNLOADS ON THE
TABLET`, named by the series' `source` tag.
- **The engine not answering, or the device offline:** the row stays where it
  was, with its cells at 0.35, and the second line says why: `○ NOT ANSWERING
· THE EXTENSION ENGINE ON THE WORKSTATION · SINCE 14:02` or `○ OFFLINE ·
DOWNLOADING NEEDS THE WORKSTATION`.

A chapter the source doesn't list (any more) fails at once as NOT AT THE
SOURCE rather than being retried ([`DOWNLOADER.md`](DOWNLOADER.md)).

## The queue

`/downloads`, reached from a **QUEUE** cell in the library's top bar (QUEUE
over its count, before SELECT, only while something is queued) and from
**DOWNLOADS** in the desktop sidebar's foot (always there, under HISTORY).

- A progress band names what's downloading now and links the last hour's
  arrivals to the NEW shelf: what's finished is the NEW shelf's business, not
  the queue's.
- **01 — FAILED** comes first, with RETRY ALL, and RETRY and ✕ on each. ✕
  takes it out of the queue, and the chapter stays NOT DOWNLOADED.
- **02 — QUEUE** lists series in the queue's order, each with its count and
  span. MORE ↓ opens one (`?open=<series>`, so without script too):
  ↑ TO THE TOP, CANCEL N, and its next four chapters. After twenty series,
  `+ N MORE SERIES`.
- **PAUSE / RESUME** in the top bar stops and starts the worker
  (`settings.downloads_paused_at`). RESUME is the accent cell while paused,
  and the band says since when.
- The library shows failures as a band, like POSSIBLE DUPLICATES:
  `05 DOWNLOADS FAILED`, the series, REVIEW →.

**Hidden means hidden.** With reveal off, a hidden series' chapters aren't
listed, named or counted: not in the queue, not in the QUEUE cell, not in the
failures band. A queue of hidden series alone reads as empty. Every action
re-reads the queue and acts only on what the viewer can see.

**Cost.** The queue is tsundoku's own table (`download_queue`, rung 40), read
on every page load for the QUEUE cell; nothing goes over the network for it.

## Finding a series, and adding it

The library's search keeps its own results, and after them **SEARCH THE
SOURCES** carries the same query to `/downloads/search`. With no titles found,
that row is all there is. There is no second search field. To browse a
source rather than search it, BROWSE ([`BROWSE.md`](BROWSE.md)).

- **Which sources are asked:** the installed extensions the library already
  reads from (MangaDex's English source, not its forty other languages). A
  source with more than half of its series here hidden (Toonily, Toonily.me,
  Omega Scans) is asked only while reveal is on, and with reveal off it isn't
  counted either. Novel plugins the library reads from are asked the same way
  ([`NOVELS.md`](NOVELS.md), "Browsing and adding"). `?source=<id>` asks just
  one, and lists all it found.
- **Results fill in source by source.** Each source is asked at once, as a
  promise of its own that the page streams in. A source still asking shows two
  dashed rows, or BROWSER CHECK · ASKED 18 S AGO while the engine passes its
  site's check ([`BROWSE.md`](BROWSE.md), "A site's check"). One that doesn't
  answer says so, with TRY AGAIN. A source lists three results under ALL, then
  `+ N MORE FROM …`. Without script the server waits for every source and
  sends the answers whole (c146).
- **What a result says:** **IN LIBRARY** (the same source and URL as a
  series here, which it opens), **SAME TITLE IN LIBRARY · FROM …** (the same
  title from another source, to head off a twin; with reveal off a
  mostly-hidden source isn't named), or the source's author and status. A
  hidden series is dropped from the results with reveal off, not dimmed.
  Covers come through tsundoku (`/api/downloads/engine-image/<token>`), as the
  library's 400px WebP, since the browser can't reach the engine.
- **The preview** (`/downloads/source/<manga>`) fetches the manga and its
  chapters from the source, streamed in, and shows them in the series screen's
  layout, with **+ ADD TO LIBRARY** in CONTINUE's place. Nothing downloads
  from it. A result tsundoku already has opens its series instead. Opened
  from BROWSE, its back cell says BROWSE and returns there.
- **ADD TO LIBRARY** writes the series into tsundoku's library at once, every
  chapter NOT DOWNLOADED, through the Mihon importer's own plan (`planMihon`)
  and writer (`writeSeries`), keyed as the tablet's backup would key it. It
  lands on the new series with an **ADDED TO THE LIBRARY** band and FIRST 10.
  START is dimmed until chapter 1 has a file.
- **UNDO** takes it out again while nothing of it is downloaded or read, and
  goes back to the preview. It isn't a delete: no tombstone, so it can be
  added again. (Until c129 the band never showed on the engine: the series
  page read the preview's id as a number, which the engine's `<source>~<url>`
  ids aren't.)

## FOLLOW

The last cell of the DOWNLOAD row, as FAV ends the RATING row. It turns accent
the same way: **FOLLOWING ✓**. It downloads chapters that appear from now on.
What's already missing stays ALL N's job.

- `series.followed_at` (rung 37) is when it was followed.
- **The app queues what's new.** Every ten minutes the app runs FOLLOW's step
  (`followNew`, started beside the worker in `engine/run.ts`): each followed
  series' source is asked every six hours, a few a run, and a chapter it lists
  that no entry is becomes one and is queued unless read, at most fifty a
  series a run (`followQueue`). Until c129 the Suwayomi import timer posted
  this step; the app is always running, so it runs it itself.
- Caught up and followed, FOLLOWING is the row's only cell, and the row says
  when the source was last asked: `CHECKED 2 H AGO`.
- **FOLLOWED** is a FILTER option (`?followed=1`, [`FILTERS.md`](FILTERS.md)),
  offered while something visible is followed. It isn't a badge: the cover's
  four corners are taken.

## Live

One watcher in the app (`src/lib/server/downloads-watch.ts`) reads the queue:
every three seconds while a screen is listening, every thirty when none is.
The series screen and the queue listen over server-sent events
(`/api/downloads/events`). Only the chapter being downloaded moves: its row's
bar and the queue's band. Anything else that changes (a chapter queued,
finished or failed) makes the screen read its data again, and a row turns
QUEUED → IMPORTING → plain without animation. What a viewer is sent is worked
out from what reveal lets them see. Without script, a screen is as of its
last load.

Importing is the worker's: it writes a chapter and asks for a scan soon after,
twenty seconds after the last one and never more than once a minute
([`DOWNLOADER.md`](DOWNLOADER.md)).

## Where it departs from the handoff

- **A failure says how often it was tried.** The mock reads `FAILED · NOT
FOUND`, `TIMED OUT`, `PAGES MISSING` with a time. Rows read `FAILED · 3
TRIES`, and the failures band names the series. (Suwayomi's queue gave no
  reason at all; the engine's queue keeps one in a word, `failure`, which the
  rows don't show yet.)
- **PAUSED SINCE** is tsundoku's own clock (`settings.downloads_paused_at`).
- **The card is c94**, not the c93 the handoff names.
- **ALL N counts what it can queue.** The mock draws `ALL 213` beside
  `213 unread chapters not downloaded`, including the four queued. Here the
  cell counts only what it would actually queue, so its number can be
  smaller than the line's.
- **Ten or fewer to queue** shows one cell (`NEXT 7`) rather than NEXT and an
  ALL of the same chapters.
- **A poll, not a subscription.** A three-second read of the queue table does
  what a push would, with no websocket client and no reconnect logic, and
  while nobody is watching it drops to every thirty seconds.
- **Search without script waits** (fixed 2026-10-28, card c146). This entry
  used to claim it already did; it didn't, until c146.
- **Mostly hidden is more than half.** The canvas names Toonily and Omega
  Scans. The same rule also leaves out Toonily.me (14 of 17 hidden), which the
  search mock still draws as a tab.
- **No alternative titles in the preview.** The mock draws one under the
  title; sources don't hand them over separately.
- **The preview's SOURCE row** shows the source's site and OPEN ↗, but not
  "UPDATED 3 DAYS AGO": a source doesn't say when it last changed.

## Read progress: tsundoku's

Downloading is downloading here, not reading: nothing about read state is
written anywhere but tsundoku. What other devices read comes in through their
backups and, as with every device, **only moves forward**.

## Disk

Downloads land on `/mnt/hdd2`, beside the rest of the library, under
`$LIBRARY_ROOT/devices/tsundoku/Mihon/`. Nothing is deleted by downloading.

## Suwayomi, retired

From 2026-10-03 (c75) Suwayomi-Server ran Mihon's extensions on the JVM in a
container (`ops/suwayomi/compose.yml`, the unit `tsundoku-suwayomi`), and a
timer (`tsundoku-suwayomi-import`) took its backup and asked the app to import
what it wrote into `devices/suwayomi/Mihon/`. On 2026-10-04 the screens above
began driving it (c94), and on 2026-10-28 tsundoku's own engine took over
(c125, c138). It was retired the same day (c129):

- **Stopped and disabled**: `tsundoku-suwayomi.service` and the
  `tsundoku-suwayomi-import` timer, and its `tailscale serve` on port 10000.
  Its container, units and timer script are gone from the repository, with
  the code that talked to it (`suwayomi*.ts`), its covers route, its GraphQL
  fake, `engine-seed` (which copied its extensions to the engine once) and
  `DOWNLOADS_BACKEND`.
- **Nothing is deleted.** Its downloads stay at
  `$LIBRARY_ROOT/devices/suwayomi/Mihon/`, with its last backups, and every
  scan reads that folder as one more device, as before. Its data
  (`/mnt/hdd2/tsundoku/suwayomi`: database, settings, extensions) stays where
  it was.
- **Its source settings didn't need moving.** Of 760 preferences on its
  installed sources, none differed from its default but MangaDex's blocked
  groups and uploaders, null against empty, which mean the same (measured
  2026-10-28 through its GraphQL API before it stopped).
- **Bringing it back**, should it be wanted: the last commit with it is the
  parent of the c129 commit; its compose file, units and `suwayomi*.ts` are
  there, and its data folder is untouched.

What it taught, kept for the engine: a source's id belongs to the extension,
not the app, so Mihon's keys hold across apps; a CBZ's zip index is written
last, so a chapter caught mid-write is refused as unreadable rather than
imported half-done (`src/lib/server/zip.ts`); and a fresh backup has to come
before an import, or a new series is keyed by its folder until one does
([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the backup knows it").

## Not done yet

- **Series Mihon downloaded but never added to its library** (34 on
  2026-10-03) are keyed by folder, so a downloaded copy of one is a second
  series. Once one is added to the library and a backup lists it, the next
  import folds the two (c90, [`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the
  backup knows it").
- **Bato.to and Hitomi** aren't in any repository added here, so their 71
  series keep downloading on the tablet.
- **A failure's reason** is kept and not shown ("Where it departs").
- **Migrating a series to another source** is c139.
