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
key a Mihon backup gives it, so a series a backup lists here and one
downloaded here are **one series**. A chapter is the source's chapter by its
URL. A novel from an LNReader
plugin is `lnreader:<plugin>:<path>`, each chapter by its path, and downloads
through the same screens and queue into its EPUB ([`NOVELS.md`](NOVELS.md),
"Downloading"), and FOLLOW asks its plugin. Series keyed any other way (Hentoid, an
EPUB, a `mihon-dir:` folder) have nothing to download — until a backup names
one, which adopts it and gives it the URL key (c89,
[`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the backup knows it").

**Which downloader takes a series is its key's family, never its kind**
(card c303; [`KINDS.md`](KINDS.md)). The prefix each family writes is one
fact, `KEY_PREFIX` in `src/lib/library/kinds.ts`, and `keyFamily(key)`
(`src/lib/library/downloads.ts`) answers `mihon`, `lnreader`, `aniyomi` or
**null**. `src/lib/server/downloads.ts` sends a Mihon key to the engine, an
LNReader key to the novel downloader and an Aniyomi key to the episode one
(`byDownloader`), and null is a case of its own: its row says nothing to
download, `enqueue` queues none of its chapters (the queue asks `sourceOfKey`
first) and FOLLOW refuses it. Hentoid's keys stay no family's; making them
one is a card of its own. The queue's lane (`QueueKind`) is the family's kind
(`SOURCE_KINDS`), `manga`, `novel` or `anime`.

Of the Mihon folders on disk, tsundoku reads its own downloads as a device,
`devices/tsundoku/Mihon/` ([`DOWNLOADER.md`](DOWNLOADER.md)). The library's own
`Mihon/` — the tablet's synced folder — is read for its `Mihon/autobackup`
backup, which brings a series, its chapters and its reading but attaches no
files; the phone's and Waydroid's `Mihon/` folders are not read at all (c191,
[`SYNC.md`](SYNC.md), "Other devices"). **Downloading is off unless
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

- **DOWNLOAD** sits under CONTINUE, shaped like the SOURCE row: what's missing,
  what's under way, then **NEXT 10** (accent) and **ALL N**. NEXT 10 queues
  at once: the next unread chapters with no file, in reading order. When
  nothing of the series is on disk yet, it reads **FIRST 10**. ALL N asks
  first: the span, the size at this series' own average chapter, the queue it
  joins, and that read chapters are left out. The confirmation is a URL
  (`?download=all`), so it opens without script too. Read chapters with no
  file are never in either. The action (`?/download`, `queueSeries`) answers
  `{ queued, missing, already }`: `already` counts the chapters it was asked
  for (every unread one for NEXT and ALL) that are queued, downloading or
  waiting to be imported, so a press that queues nothing because everything
  is under way can say so; the end page's DOWNLOAD FIRST 10 says `ALREADY
QUEUED` from it (c534). That cell posts `which=first`: the first ten unread
  chapters in reading order whatever their state (queue the file-less, retry
  the failed, count the rest as `already`), so a second press asks for the
  same ten, where NEXT 10 would move on to the next ten. The series screen's band reads `queued` and
  `missing` only.
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
  disabled button. The FILE line says it once: `BATO.TO · NO EXTENSION HERE`,
  named by the series' `source` tag — no extension installed here carries the
  source, so tsundoku cannot download it (c191, "Not done yet").
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

**A moved series' queue.** A move (`doc/MOVE.md`, c139) keeps a queued chapter
whose number the new source has, and deletes one whose number it doesn't (the
comparison counts it as `HAS NO PARTNER · LEAVES THE QUEUE`). A chapter kept
from the old source downloads from that source, not the series' new one: the
queue row's lane is `entries.origin_source` when it is set.

## Finding a series, and adding it

The library's search keeps its own results, and after them **SEARCH THE
SOURCES** carries the same query to `/downloads/search`. With no titles found,
that row is all there is. There is no second search field. To browse a
source rather than search it, BROWSE ([`BROWSE.md`](BROWSE.md)).

## Moving a series to another source

The series screen's SOURCE row offers **MOVE →** to `/series/[id]/move`, which
searches the sources, compares a candidate by number, and moves the series
itself — keeping its files, its reading and everything else the owner did with
it. [`MOVE.md`](MOVE.md) has the rules. What matters here: a move queues
nothing, FOLLOW keeps doing what it did from the new source, and a queued
chapter the new source doesn't number at all leaves the queue.

- **Which sources are asked:** the installed extensions the library already
  reads from (MangaDex's English source, not its forty other languages), and
  every source BROWSE lists (its languages rule, [`BROWSE.md`](BROWSE.md)).
  Until 2026-10-30 only the first: a new library reads from nothing, so a
  friend's search with a source just installed asked no one, "0 OF 0 SOURCES
  ANSWERED". A source with more than half of its series here hidden (Toonily,
  Toonily.me, Omega Scans) is asked only while reveal is on, and with reveal
  off it isn't counted either. Novel plugins are asked the same way
  ([`NOVELS.md`](NOVELS.md), "Browsing and adding"). `?source=<id>` asks just
  one, and lists all it found.
- **Results fill in source by source.** Each source is asked at once, as a
  promise of its own that the page streams in, and the list is in MOVE's
  order (c490; [`MOVE.md`](MOVE.md), "The candidates, and picking one"): the
  sources with results first, in the order they answered, each named with
  its language; the ones still asking as one line, `N STILL ASKING`, naming
  one passing its site's check (BROWSER CHECK · ASKED 18 S AGO;
  [`BROWSE.md`](BROWSE.md), "A site's check"), with two dashed rows until
  the first result; then `N FOUND NOTHING` and `N DID NOT ANSWER`, folded at
  the end. TRY AGAIN and TRY ALL AGAIN ask only the failed sources again
  (`/downloads/search/ask`). A source lists three results under ALL, then
  `+ N MORE FROM …`. Without script the server waits for every source and
  sends the answers whole (c146), and TRY AGAIN opens that source's tab.
- **What a result says:** **IN LIBRARY** (the same source and URL as a
  series here, which it opens), **SAME TITLE IN LIBRARY · FROM …** (the same
  title from another source, to head off a twin; with reveal off a
  mostly-hidden source isn't named), or the source's author and status. A
  hidden series is dropped from the results with reveal off, not dimmed.
  Covers come through tsundoku (`/api/downloads/engine-image/<token>`), as the
  library's 400px WebP, since the browser can't reach the engine.
- **The preview** (`/downloads/source/<manga>`) fetches the manga and its
  chapters from the source, streamed in, and shows them in the series screen's
  layout, with **+ ADD TO LIBRARY** beside reading. A result tsundoku already
  has opens its series instead. Opened from BROWSE, its back cell says BROWSE
  and returns there.
- **DOWNLOAD on the preview** (card c205): the library series' row, under the
  bar, counted from the source's list less what a browsing record has read
  (`143 unread chapters not downloaded`, `ADDS IT TO YOUR
LIBRARY FIRST · IT ASKS`), with FIRST 10 and ALL N. A download lives in the
  library, so each cell asks first, in the app's own ConfirmSheet, never the
  browser's `confirm()`: **DOWNLOADING ADDS IT TO YOUR LIBRARY**, what it
  will download, that UNDO takes it back, and **ADD AND DOWNLOAD** / CANCEL.
  Confirmed, the `addDownload` action adds it, queues FIRST 10 or ALL through
  `queueSeries` (the series screen's own DOWNLOAD logic, shared so the two
  can't count differently), and lands on the series with the ADDED band
  saying `12 CHAPTERS · 10 DOWNLOADING` (`?queued=`). The add stands if the
  queue doesn't answer; the band then says `NOT QUEUED · DOWNLOADING ISN’T
ANSWERING` and the DOWNLOAD row says why. The owner asked for it after a friend
  (a friend) didn't know ADD was the way to download, its button being small
  (2026-10-30). No ALL's QUALITY here for an anime: SETTINGS' default.
- **ADD TO LIBRARY** writes the series into tsundoku's library at once, every
  chapter NOT DOWNLOADED, through the Mihon importer's own plan (`planMihon`)
  and writer (`writeSeries`), keyed as the tablet's backup would key it. It
  lands on the new series with an **ADDED TO THE LIBRARY** band and FIRST 10.
  START is dimmed until chapter 1 has a file.
- **UNDO** takes it out again while nothing of it is downloaded or read, and
  goes back to the preview. After ADD AND DOWNLOAD, its queued chapters go
  with it (the queue's rows cascade). It isn't a delete: no tombstone, so it can be
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

## REFRESH

The cell before FOLLOW, on any series in the library whose source can be asked
— engine manga, anime, novel plugin (`src/lib/server/refresh.ts`; card c220).
A folder-scanned series has nothing to ask and doesn't offer it.

- **It looks, it doesn't fetch.** REFRESH asks the source once, makes entries of
  the chapters or episodes it lists that no entry is, and **queues nothing** —
  not even on a series that is followed. FOLLOW is the only thing that
  downloads, on its own turn. The band it answers with says what arrived
  ("3 NEW CHAPTERS", "NOTHING NEW") and leaves NEXT or ALL to keep them.
- **The chapters it found are no longer new**, so FOLLOW's next turn won't
  queue them either: on a followed series the band and NEXT/ALL are the way in.
- **It counts as the check.** The three checks record when they asked
  (`engine_series.resolved_at`, `anime_checks.checked_at`,
  `novel_checks.checked_at`), so FOLLOW doesn't ask that source again six hours
  from a look that just happened.
- The series' own rules hold: hidden means hidden (a hidden series' REFRESH is
  a 404 with reveal off), and a browsing record has no REFRESH, since it is not
  in the library.
- A refusal bands rather than errors: the source not answering is
  "… NOTHING CHANGED", as every refused action is.
- **A selection refreshes too** (card c221). SELECT on the library, a tag or a
  person page, then REFRESH in the bulk bar: every selected series that has a
  source is asked once, through the same `refreshSeries`, and nothing is
  downloaded. One run asks 24 (`REFRESH_BATCH`), and the band above the bar
  says how many were asked, how many found something, which failed by name,
  which were skipped for having no source, and how many are left — ASK N MORE
  sends the rest. A source that throws or misses 30 s (`REFRESH_TIMEOUT_MS`) is
  one failure among the rest. Hidden series are left out in SQL, and a
  folder-scanned one is skipped, never refused ([`LIBRARY.md`](LIBRARY.md),
  "REFRESH a selection").

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
written anywhere but tsundoku. What the tablet reads comes in through the
library's own backup (its `Mihon/autobackup`) and, as with every device,
**only moves forward**; a phone's or Waydroid's backup is not read.

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
  `$LIBRARY_ROOT/devices/suwayomi/Mihon/`, with its last backups. They are not
  read any more (c191, [`SYNC.md`](SYNC.md), "Other devices"): the series they
  made keep their rows and files, and nothing marks them as the folder changes.
  Its data (`/mnt/hdd2/tsundoku/suwayomi`: database, settings, extensions)
  stays where it was.
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

- **A folder whose chapters a backup shares none of** waits beside it. The
  same source and title are not enough on their own: folding them would list
  every chapter twice, so the pair stays two series until a backup names a
  chapter the folder has (c89,
  [`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the backup knows it"). The
  adoption itself is done, and described above.
- **Bato.to and Hitomi** aren't in any repository added here, and their 71
  series used to download on the tablet. The tablet's `Mihon/` downloads are
  not imported any more (c191, [`SYNC.md`](SYNC.md), "Other devices"), so
  those series get no new chapters here. Two ways out, both the owner's: a
  repository that lists an extension carrying the source (BROWSE,
  [`BROWSE.md`](BROWSE.md), "Extensions and repositories"), or MOVE to a
  source that has one (["Moving a series to another source"](#moving-a-series-to-another-source),
  [`MOVE.md`](MOVE.md)).
- **A failure's reason** is kept and not shown ("Where it departs").
- **Migrating a series to another source** is c139.
