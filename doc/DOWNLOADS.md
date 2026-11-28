# Downloads

tsundoku downloads manga, novels and video itself, on the computer that serves
it, rather than leaving it to Mihon on Android, which keeps pausing and halting
its downloads however much leeway it is given. Manga comes through Mihon's own
extensions, run on the extension engine
([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)); novels through LNReader
plugins ([`NOVELS.md`](NOVELS.md), "Downloading"); anime through Aniyomi
extensions ([`ANIME.md`](ANIME.md), "Downloading"). All three share one queue
and the same screens. This file is how the queue, the workers and the files
work, and the screens that drive them on every device. Finding series and
managing extensions is [`BROWSE.md`](BROWSE.md).

## Turning it on

**Downloading is off unless `ENGINE_URL` and `ENGINE_TOKEN` are set**
([`SECRETS.md`](SECRETS.md)): without them no screen draws a DOWNLOAD row, a
QUEUE cell, DOWNLOADS or BROWSE, and no worker starts. The e2e build depends on
this: only `tests/downloads-flow.e2e.ts` and the browse specs turn it on, each
against a fake engine.

With the engine set up, the root layout starts the workers and FOLLOW's step
once (`ensureEngineWorker`, `src/lib/server/engine/run.ts`): the manga worker,
the novel worker (which needs no engine, but everything that queues a novel is
behind it) and the episode worker.

## Which downloader takes a series

A series is a source's manga by its key, `mihon:<source id>:<url>`: the same
key a Mihon backup gives it, so a series a backup lists here and one downloaded
here are **one series**. A chapter is the source's chapter by its URL. A source's
id belongs to the extension, not the app, so Mihon's keys hold across apps. A
novel from an LNReader plugin is `lnreader:<plugin>:<path>`, each chapter by its
path, and an anime from an Aniyomi extension has an Aniyomi key; both download
through the same screens and queue. Series keyed any other way (Hentoid, an
EPUB, a `mihon-dir:` folder) have nothing to download, until a backup names one,
which adopts it and gives it the URL key ([`IMPORT-MIHON.md`](IMPORT-MIHON.md),
"Before the backup knows it").

**Which downloader takes a series is its key's family, never its kind**
([`KINDS.md`](KINDS.md)). The prefix each family writes is one fact,
`KEY_PREFIX` in `src/lib/library/kinds.ts`, and `keyFamily(key)`
(`src/lib/library/downloads.ts`) answers `mihon`, `lnreader`, `aniyomi` or
**null**. `src/lib/server/downloads.ts` sends a Mihon key to the engine, an
LNReader key to the novel downloader and an Aniyomi key to the episode one
(`byDownloader`), and null is a case of its own: its row says nothing to
download, `enqueue` queues none of its chapters (the queue asks `sourceOfKey`
first) and FOLLOW refuses it. The queue's lane (`QueueKind`) is the family's
kind (`SOURCE_KINDS`): `manga`, `novel` or `anime`.

The rules are pure and tested (`src/lib/library/downloads.ts`,
`tests/downloads-domain.spec.ts`); the screens ask `src/lib/server/downloads.ts`,
which answers from the engine's backend (`engine/backend.ts`).

## tsundoku is a device

tsundoku's manga downloads are **one more device**: it writes Mihon's download
layout and a Mihon backup, and the importer reads them as it reads a tablet's
copy:

```
$LIBRARY_ROOT/devices/tsundoku/Mihon/
  downloads/<Source> (<LANG>)/<Series>/<Scanlator>_<Chapter>.cbz   ComicInfo.xml inside
  autobackup/tsundoku_<date>_<time>.tachibk                         what it has, keyed as Mihon keys it
```

Why, over writing entries straight into the database:

- **The importer is the one place a file becomes an entry**, with every rule
  it holds: keys, two devices' copies of one series, tombstones, page counts,
  covers, the NEW shelf, arrivals, duplicates. A second writer would have to
  repeat all of it, and drift.
- **A download with no backup entry is read as a new series** keyed by its
  folder (`mihon-dir:`, [`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the
  backup knows it"), which only a later backup adopts. Writing the backup with
  the files is what makes them the right series' from the first scan. That rule
  is about `devices/tsundoku/Mihon/`, the one device folder read this way: a
  `Mihon/` folder under any other device is not read at all
  ([`SYNC.md`](SYNC.md), "Other devices"), so a file dropped there becomes
  nothing.

So tsundoku writes four things the importer reads: a CBZ, its ComicInfo, a
`.tachibk`, and chapter numbers.

Of the other Mihon folders on disk, the library's own `Mihon/` (the tablet's
synced folder) is read for its `Mihon/autobackup` backup, which brings a series,
its chapters and its reading but attaches no files. Any other device's `Mihon/`
folder is not read.

## Attaching

**Each worker attaches what it just wrote** (`attachWritten`,
`src/lib/server/import/index.ts`), so a finished chapter opens as soon as its
file lands. The importer is still the one place a file becomes an entry: the
file goes to the source whose folder holds it (the innermost root, since a
device's folder sits inside the library's), and that source's `planOne` plans
its series exactly as the scan's `plan` does (`planMihonSeries`, the same
backup, only the series that folder is; `planAnimeSeries`, the series folder
whole; `planEpubFile`, the book). The plan is written by `writeSeries` with the
scan's own root, `markMissing` and `deviceRoot`, and duplicates are reconciled
for those series. A chapter attaches after the batch's backup is written, so
the backup it plans from already names it.

**The scan stays the cross-check**, and the way in for everything that arrives
otherwise (files dropped into a folder the importer reads, and the tablet's
`Hentoid/` and `Library/` copies over Syncthing). The workers' specs attach,
then scan, and require every row of the series to be as the attach left it
(`engine-worker-db`, `anime-download-db`, `novel-download-db`). A scan still
follows a download when:

- **a file attached nothing** (no source holds it, or the plan was empty):
  `attachWritten` gives it back;
- **a scan is already running**: it planned before the file existed, and
  writing that plan would mark the new file gone, so the running scan is waited
  out and a scan of its own follows;
- **attaching threw**: logged, and the scan takes over.

That scan comes twenty seconds after the last file landed and never more than
once a minute, so a series downloading chapter after chapter is scanned in
batches. At startup, chapters written but not yet imported (a restart dropped
their import) are scanned the same way.

## The parts

| Part                 | What                                                                                                                                           | Where                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Chapter numbers      | Mihon's chapter recognition, ported: every source but Webtoons returns `chapter_number = -1`                                                   | `src/lib/import/chapter-number.ts`                                         |
| The backup           | A `.tachibk` writer, the decoder's mirror: the manga tsundoku downloads for, their chapters, and source names                                  | `src/lib/import/mihon-backup.ts`, `protobuf.ts`                            |
| The CBZ              | A zip writer (stored, not deflated: pages are already compressed) and ComicInfo, in the shapes the importer reads                              | `src/lib/server/zip-write.ts`, `src/lib/import/comicinfo.ts`               |
| The engine client    | Token, browser User-Agent, `cf-proxy-url`, handles (resend on 409), one call at a time per extension, failures told apart by the body's `code` | `src/lib/server/engine/client.ts`, `protocol.ts`                           |
| Extensions           | Repositories (Keiyoushi's v2 `index.json`), APKs installed only when signed by the repository's key, source preferences                        | `src/lib/server/engine/extensions.ts`, `repo-index.ts`, `apk-signature.ts` |
| The queue and worker | Queued chapters in the database; per source one chapter at a time, pages six at a time, backoff, a CBZ written to a temp name and renamed      | `src/lib/server/engine/queue.ts`, `worker.ts`, `device.ts`                 |
| The screens' backend | DOWNLOAD, the queue, search, preview, ADD, FOLLOW                                                                                              | `src/lib/server/downloads.ts`, `src/lib/server/engine/backend.ts`          |

### The writers

`chapterNumbers` and `chapterNumberOf` port Mihon's recognizer rule for rule,
checked against Mihon's own 90 test cases (`tests/chapter-number.spec.ts`).
`encodeBackup` sits beside `decodeBackup`; the protobuf encoder in
`protobuf.ts` builds its output from chunks, so 30,000 chapters encode (a
spread of one array overflows). `comicInfoXml` sits beside `parseComicInfo`.
`zip-write.ts` writes real CRC-32s and a real date: a CRC of 0 makes Python's
`zipfile` refuse the first member. Each round-trips through the importer's own
reader (`tests/device-writers.spec.ts`). A CBZ's zip index is written last, so
a chapter caught mid-write is refused as unreadable rather than imported
half-done (`src/lib/server/zip.ts`).

### The engine client

`src/lib/server/engine/client.ts`, over the pure `protocol.ts`. Every call
carries the token, a browser User-Agent, the solver and tsundoku's preferences
in replace-present mode. Calls into one extension run one at a time, extensions
side by side. A 409 sends the APK once (checked against its handle). Failures
are read from the body's `code`, so a 429 is `rate-limited` though the engine
answers 500. `fetchProxied` takes pages and streams through `/image/` and
`/video/`, and fetches a page whose address is a site's (not one of the
engine's loopback proxy addresses, not on `ENGINE_URL`) as any address a source
names: without the token, on the internet only (`net-guard.ts`), and up to
64 MB (`MAX_PAGE_BYTES`). `imageType` tells a picture from an error page by its
bytes. Tested against a fake engine (`tests/engine-client.spec.ts`).

### Extensions and repositories

`src/lib/server/engine/extensions.ts`, over the pure `repo-index.ts` and
`apk-signature.ts` (migration 39). A repository needs a `repo.json` with a
signing key; its index is the v2 `index.json` (Keiyoushi, Yuzono), or
`index.min.json` for older ones. **An APK is installed only when its v2
signature verifies and its signer is the repository's key**: Keiyoushi's index
publishes no per-APK hash, and either check alone passes a forgery (a genuine
signing block on other code, or code signed by anyone). APKs are kept under
their handle in `ENGINE_STORE` (default `TSUNDOKU_HOME/engine/store`). An
update keeps the previous version a week for BACK TO; removing an extension
keeps its sources' preferences.

### The queue and the worker

`src/lib/server/engine/queue.ts`, `worker.ts` and the pure `device.ts`
(migration 40). The queue (`download_queue`) is keyed by entries. The worker
resolves a series at its source (a details call first, so a source whose URLs
moved answers an old URL with its new one, kept in `engine_series`), matches
the source's chapters onto the entries (`matchSourceChapters`: URL, then
recognized number with scanlator, then number), fetches pages through the
engine six at a time, judges each by its bytes, and writes the CBZ beside its
place and renames it. One chapter per source at a time, three sources at once.
A failure backs off: 15 s doubling, 60 s doubling for a rate limit or a site's
browser check, capped at 30 minutes; after three tries the chapter is FAILED
and waits for RETRY. A chapter the source doesn't list fails at once, with
no retries.

**The device's backup carries the library's own keys and URLs**, never the
source's new ones, and a series' folder title is fixed at its first download
(`engine_series.title`), since the importer pairs a folder with its series by
it. Tested end to end on a series whose source moved its URLs
(`tests/engine-worker-db.spec.ts`).

### The screens' backend

`engine/backend.ts` answers every call the screens make, from tsundoku's
queue. On the engine a chapter is its entry, a source's manga an opaque id of
source and URL (`<source>~<url>`), and IMPORTING is a chapter written
(`engine_chapters.downloaded_at`) and not yet imported. The screens' shared
types live in `server/download-types.ts`, the library queries in
`library-sources.ts`, the live watcher in `downloads-watch.ts`.
`tests/engine-backend-db.spec.ts` covers it, and `tests/downloads-flow.e2e.ts`
drives the screens against a fake engine. A cover still being fetched when
UNDO removes its series is not written: the cover writer checks the series
still exists, since its id goes to the next series.

## Keys

A series stays `mihon:<source id>:<url>`, a chapter its URL, as Mihon keys
them. Two things sit under that:

- **Memos.** Some sources hang a memo off a URL as
  `<url>|mangayomi-memo|<json>`. The key is the part before the marker; the
  memo is kept beside it and sent back on every call.
- **A source's URLs can move.** An extension can switch every URL to a new
  scheme while the library's series are keyed by the old one. A details call
  on an old URL returns the new one: the new URL becomes an alias of the
  series' key, never a second series.

## The series screen

- **DOWNLOAD** sits under CONTINUE, shaped like the SOURCE row: what's missing,
  what's under way, then **NEXT 10** (accent) and **ALL N**. NEXT 10 queues at
  once: the next unread chapters with no file, in reading order. When nothing
  of the series is on disk yet, it reads **FIRST 10**. ALL N asks first: the
  span, the size at this series' own average chapter, the queue it joins, and
  that read chapters are left out. The confirmation is a URL
  (`?download=all`), so it opens without script too. Read chapters with no
  file are never in either.
- **ALL N counts what it can queue**, so its number can be smaller than the
  line's count of unread chapters not downloaded, which includes those already
  queued. **Ten or fewer to queue** shows one cell (`NEXT 7`) rather than NEXT
  and an ALL of the same chapters.
- The action (`?/download`, `queueSeries`) answers `{ queued, missing,
already }`: `already` counts the chapters it was asked for (every unread one
  for NEXT and ALL) that are queued, downloading or waiting to be imported, so
  a press that queues nothing because everything is under way can say so; the
  end page's DOWNLOAD FIRST 10 says `ALREADY QUEUED` from it. That cell posts
  `which=first`: the first ten unread chapters in reading order whatever their
  state (queue the file-less, retry the failed, count the rest as `already`),
  so a second press asks for the same ten, where NEXT 10 would move on to the
  next ten. The series screen's band reads `queued` and `missing` only.
- **A series a source serves reads online instead**
  ([`READING-ONLINE.md`](READING-ONLINE.md), "Manga online"): its rows open,
  and downloading is the ↓ cell at the end of each row (RETRY on a failed one).
  What follows is how a row behaves where nothing reads online.
- **The row is the button.** A tap on a chapter with no file queues it, and a
  tap on a failed one retries it. A long press still marks through. Each row
  says where it is in its status column: QUEUED, DOWNLOADING · 31 / 54 with an
  ink bar (accent stays reading's), FAILED · 3 TRIES with a 3px ink rule on its
  left edge, IMPORTING (written, not yet attached; rare, see "Attaching"), then
  the plain row.
- **A failure says how often it was tried**, not why: `FAILED · 3 TRIES`. The
  queue keeps the reason in a word (`download_queue.failure`), and no screen
  shows it.
- **SELECT** puts DOWNLOAD first in the bulk bar, counted: the selected
  chapters it would queue or retry. On a phone the five actions wrap into two
  rows.
- **FILE** counts the queue: `393 OF 612 DOWNLOADED · 4 QUEUED · 1 FAILED`.
- **No extension for its source**: no DOWNLOAD row and no disabled button. The
  FILE line says it once, `BATO.TO · NO EXTENSION HERE`, named by the series'
  `source` tag: no extension installed here carries the source, so tsundoku
  cannot download it. A repository that lists an extension carrying the source
  (BROWSE, [`BROWSE.md`](BROWSE.md), "Extensions and repositories"), or MOVE to
  a source that has one, is the way out.
- **The engine not answering, or the device offline:** the row stays where it
  was, with its cells at 0.35, and the second line says why: `○ NOT ANSWERING
· THE EXTENSION ENGINE ON THE WORKSTATION · SINCE 14:02` or `○ OFFLINE ·
DOWNLOADING NEEDS THE WORKSTATION`.

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
  span. MORE ↓ opens one (`?open=<series>`, so without script too): ↑ TO THE
  TOP, CANCEL N, and its next four chapters. After twenty series,
  `+ N MORE SERIES`.
- **PAUSE / RESUME** in the top bar stops and starts the worker
  (`settings.downloads_paused_at`). RESUME is the accent cell while paused, and
  the band says since when, by tsundoku's own clock.
- The library shows failures as a band, like POSSIBLE DUPLICATES:
  `05 DOWNLOADS FAILED`, the series, REVIEW →.

**Hidden means hidden.** With reveal off, a hidden series' chapters aren't
listed, named or counted: not in the queue, not in the QUEUE cell, not in the
failures band. A queue of hidden series alone reads as empty. Every action
re-reads the queue and acts only on what the viewer can see.

**Cost.** The queue is tsundoku's own table (`download_queue`), read on every
page load for the QUEUE cell; nothing goes over the network for it.

**A moved series' queue.** A move ([`MOVE.md`](MOVE.md)) keeps a queued
chapter whose number the new source has, and deletes one whose number it
doesn't (the comparison counts it as `HAS NO PARTNER · LEAVES THE QUEUE`). A
chapter kept from the old source downloads from that source, not the series'
new one: the queue row's lane is `entries.origin_source` when it is set.

## Finding a series, and adding it

The library's search keeps its own results, and after them **SEARCH THE
SOURCES** carries the same query to `/downloads/search`. With no titles found,
that row is all there is. There is no second search field. To browse a source
rather than search it, BROWSE ([`BROWSE.md`](BROWSE.md)).

- **Which sources are asked:** the installed extensions the library already
  reads from (MangaDex's English source, not its forty other languages), and
  every source BROWSE lists (its languages rule, [`BROWSE.md`](BROWSE.md)), so
  a new library that reads from nothing still asks a source just installed. A
  source with more than half of its series here hidden is asked only while
  reveal is on, and with reveal off it isn't counted either: its results would
  put adult covers on a screen that promised none. Novel plugins are asked the
  same way ([`NOVELS.md`](NOVELS.md), "Browsing and adding"). `?source=<id>`
  asks just one, and lists all it found.
- **Which of them a search asks first** (c1142, 2026-11-27; handoff
  `pinned-sources` in tsundoku-design). Asking every source of the kind was
  dozens of sites per search, and in the web edition seconds of Java each, one
  call at a time. So a search asks the **pinned** sources of its kind (PIN on
  BROWSE's rows and a source's page, below and [`BROWSE.md`](BROWSE.md)), and
  the rest only when asked to. `planAsks` (`src/lib/library/search-asks.ts`)
  decides, and `tests/search-asks.spec.ts` holds its cases:
  - **Pinned of the kind:** those, in their usual order. ASKS at the KIND
    band's end says `PINNED n · ALL SOURCES N`.
  - **None of the kind pinned:** its last browsed, up to four (BROWSE's
    RECENT, `browse_recent`), and with none browsed either, every one of its
    kind. The pair's first cell then says `LAST BROWSED n`, or `PINNED 0` with
    ALL SOURCES lit.
  - **A band says why** under the KIND band, with one press to pin:
    - _NOTHING PINNED · ASKED THE 4 LAST BROWSED_, offering PIN THE N YOU READ
      FROM (the sources the library holds series from, never pinned on their
      own: the owner's call), else the ones that found it.
    - _NO ANIME SOURCE PINNED · ASKED …_ when other kinds have pins.
    - _NOTHING PINNED OR BROWSED YET · ASKED ALL N_, offering PIN THE N THAT
      FOUND IT once their answers land. The web edition adds SLOW IN THE WEB
      EDITION.

    One source is named instead (PIN ANIMEPAHE). The press posts `?/pin` and
    the search asks those from then on.

  - **ASK THEM** (`?all=1`): one ruled row under 01's results, _38 MORE MANGA
    SOURCES NOT ASKED · WHAT IS HERE STAYS_, and ALL SOURCES in the pair, the
    same link. Asked, 01's results stay as they were (their answers are kept,
    c1141, so nothing is asked again), and **02 — THE OTHER 38** fills under
    them. It holds for that search's address, so back and reload keep it, and
    the next search starts at pinned. `?source=` still asks just the one named.
  - The library's own SEARCH THE SOURCES row says what it will ask: _4 PINNED
    MANGA SOURCES_, _THE 4 LAST BROWSED_, or the count of all.

  A pin is kept as a source's switches are, `source.pinned:<id>` = `1` in
  `settings` (`pinnedSources`, `setPinned` in
  `src/lib/server/engine/source-flags.ts`), so every device that reads the
  library agrees. It is not one of `SOURCE_FLAGS`, since EXTENSIONS' SELECT
  offers those in bulk and the design draws no PIN there. There is no limit:
  BROWSE's 01 — PINNED always counts them, and past 12 adds A SEARCH ASKS
  THEM ALL. `tests/browse-pinned.e2e.ts` holds the screens.

- **A KIND band over the sources' tabs**, in their idiom: `ALL`, the default
  and every source as above, then one tab per kind an installed source serves,
  in the registry's order (`MANGA`, `NOVELS`, `ANIME`; English, as
  `/downloads` is). A source's kind is its family's (`kindOfSource`,
  `src/routes/downloads/search/kinds.server.ts`: `sourceFamily`, then
  `SOURCE_KINDS[family]`), so a Mihon source of manhwa is a manga source and
  MANHWA is never a tab. `?kind=<kind>` asks only that kind's sources, in the
  load and in `/downloads/search/ask` both (a re-ask under a kind 404s for
  another kind's source), so an anime search does not wait on twenty manga
  extensions; the sources' tabs under it are that kind's ALL and its sources,
  and a source's tab keeps the kind. `?source=` still names one source under a
  kind, whatever its kind. A word no installed source serves (`?kind=doujin`, a
  typo) is ALL. Each kind tab counts the hits its sources found so far; a kind
  this search did not ask, and ALL under a kind, show `—`. With sources of one
  kind only the band is not drawn, since ALL already is that kind. The library
  hands its kind on: filtered to one, its search cell opens
  `/search?kind=<kind>`, which keeps it as the typing replaces the address,
  counts that kind's sources on SEARCH THE SOURCES →, and opens it with the
  kind. A TV draws the band as one more row of links above the sources'.
- **One search, asked once** (c1141, 2026-11-26). Each kind tab is its own
  load, and each used to ask its sources again, though ALL had just had their
  answers; in the web edition that is seconds of Java a source, one call at a
  time. Now a source's answer to a query is kept for ten minutes
  (`keptSearch`, `src/lib/server/search-kept.ts`, used by
  `engine.searchSource` and `novelSearch`), the promise itself, so a kind
  picked while ALL is still asking waits on ALL's call. What is kept is the
  source's own answer, not the hits: IN LIBRARY and SAME TITLE are worked out
  again on every load. A failure is not kept, so the next load asks again;
  TRY AGAIN (`/downloads/search/ask`) asks afresh and keeps that answer. A
  reload within the ten minutes is answered from what is kept. Nothing is
  written to the library, and a restart forgets it all.
  `tests/browse-search-kinds.e2e.ts` counts the engine's calls: ALL, ANIME, a
  reload and ALL again ask each source once in all.
- **Results fill in source by source.** Each source is asked at once, as a
  promise of its own that the page streams in, and the list is in MOVE's order
  ([`MOVE.md`](MOVE.md), "The candidates, and picking one"): the sources with
  results first, in the order they answered, each named with its language; the
  ones still asking as one line, `N STILL ASKING`, naming one passing its
  site's check (BROWSER CHECK · ASKED 18 S AGO; [`BROWSE.md`](BROWSE.md), "A
  site's check"), with two dashed rows until the first result; then
  `N FOUND NOTHING` and `N DID NOT ANSWER`, folded at the end. TRY AGAIN and
  TRY ALL AGAIN ask only the failed sources again (`/downloads/search/ask`). A
  source lists three results under ALL, then `+ N MORE FROM …`. Without script
  a streamed promise never resolves, so the server waits for every source and
  sends the answers whole, and TRY AGAIN opens that source's tab.
- **What a result says:** **IN LIBRARY** (the same source and URL as a series
  here, which it opens), **SAME TITLE IN LIBRARY · FROM …** (the same title
  from another source, to head off a twin; with reveal off a mostly-hidden
  source isn't named), or the source's author and status. A hidden series is
  dropped from the results with reveal off, not dimmed. Covers come through
  tsundoku (`/api/downloads/engine-image/<token>`), as the library's 400px
  WebP, since the browser can't reach the engine.
- **The preview** (`/downloads/source/<manga>`) fetches the manga and its
  chapters from the source, streamed in, and shows them in the series screen's
  layout, with **+ ADD TO LIBRARY** beside reading. A result tsundoku already
  has opens its series instead. Opened from BROWSE, its back cell says BROWSE
  and returns there. It shows no alternative titles, since sources don't hand
  them over separately, and its SOURCE row shows the source's site and OPEN ↗
  but no "updated" time, since a source doesn't say when it last changed.
- **DOWNLOAD on the preview**: the library series' row, under the bar, counted
  from the source's list less what a browsing record has read
  (`143 unread chapters not downloaded`, `ADDS IT TO YOUR LIBRARY FIRST · IT
ASKS`), with FIRST 10 and ALL N. A download lives in the library, so each
  cell asks first, in the app's own ConfirmSheet, never the browser's
  `confirm()`: **DOWNLOADING ADDS IT TO YOUR LIBRARY**, what it will download,
  that UNDO takes it back, and **ADD AND DOWNLOAD** / CANCEL. Confirmed, the
  `addDownload` action adds it, queues FIRST 10 or ALL through `queueSeries`
  (the series screen's own DOWNLOAD logic, shared so the two can't count
  differently), and lands on the series with the ADDED band saying
  `12 CHAPTERS · 10 DOWNLOADING` (`?queued=`). The add stands if the queue
  doesn't answer; the band then says `NOT QUEUED · DOWNLOADING ISN’T
ANSWERING` and the DOWNLOAD row says why. The row is there because ADD alone
  is too small a button to find downloading by. An anime's preview has no
  QUALITY choice here: it downloads at SETTINGS' default.
- **ADD TO LIBRARY** writes the series into tsundoku's library at once, every
  chapter NOT DOWNLOADED, through the Mihon importer's own plan (`planMihon`)
  and writer (`writeSeries`), keyed as the tablet's backup would key it. It
  lands on the new series with an **ADDED TO THE LIBRARY** band, whose second
  line puts it on a shelf ([`SERIES.md`](SERIES.md), "Shelves in the ADDED
  band"), and FIRST 10. START is dimmed until chapter 1 has a
  file. From a source that adds its series hidden, outside reveal, it lands on
  the source's page (or BROWSE) with ADDED TO THE LIBRARY, AND HIDDEN, whose
  second line puts it on a shelf too ([`BROWSE.md`](BROWSE.md), "Shelves in
  the ADD band").
- **Many at once** ([`BROWSE.md`](BROWSE.md), "The press"): SELECT in a
  source's catalog adds the ticked series one at a time per source, each
  through this same ADD (`addToLibrary`, ADDED HIDDEN watched the same way)
  and, for ADD + FIRST 10 EACH or ADD + ALL, this same `queueSeries` with
  `next` or `all`, so a press can't count or queue differently from one
  preview's ADD AND DOWNLOAD.
- **UNDO** takes it out again while nothing of it is downloaded or read, and
  goes back to the preview. After ADD AND DOWNLOAD, its queued chapters go with
  it (the queue's rows cascade). It isn't a delete: no tombstone, so it can be
  added again.

## Moving a series to another source

The series screen's SOURCE row offers **MOVE →** to `/series/[id]/move`, which
searches the sources, compares a candidate by number, and moves the series
itself, keeping its files, its reading and everything else done with it.
[`MOVE.md`](MOVE.md) has the rules. What matters here: a move queues nothing,
FOLLOW keeps doing what it did from the new source, and a queued chapter the
new source doesn't number at all leaves the queue.

## A group of one-offs

A series of books grouped from a source holds several sources' manga, and a
book's key is on the book ([`BOOKS.md`](BOOKS.md), "Where a book's origin
lives"). The DOWNLOAD row and the queue answer per book: `seriesDownloads`
reads each book's source, its `resolved_at` and its listing; a book queues under
its own key and in its own source's lane; the worker asks that book's source
(`resolveBook`) and writes into a folder named from what the source called it
(`entry_origins.engine_title`), so the importer pairs the file with its book by
its key. Six unasked books are asked in the background per look at a group; the
worker asks for itself when it needs to. FOLLOW isn't offered on a group, and
REFRESH asks each book's source and adds nothing. A queued book stays queued
through GROUP, UNGROUP, MOVE TO… and FOLD: its row moves with its entry
([`BOOKS.md`](BOOKS.md), "A queued book goes with its entry").

## FOLLOW

The last cell of the DOWNLOAD row, as FAV ends the RATING row. It turns accent
the same way: **FOLLOWING ✓**. It downloads chapters that appear from now on.
What's already missing stays ALL N's job.

- `series.followed_at` (migration 37) is when it was followed. Following asks
  the source at once, so the next check has a baseline.
- **The app queues what's new.** Every ten minutes the app runs FOLLOW's step
  (`followNew`, started beside the worker in `engine/run.ts`): each followed
  series' source is asked every six hours, a few a run, and a chapter it lists
  that no entry is becomes one and is queued unless read, at most fifty a
  series a run (`followQueue`). The same step forgets browsing records not
  opened for 30 days.
- Caught up and followed, FOLLOWING is the row's only cell, and the row says
  when the source was last asked: `CHECKED 2 H AGO`.
- **FOLLOWED** is a FILTER option (`?followed=1`, [`FILTERS.md`](FILTERS.md)),
  offered while something visible is followed. It isn't a badge: the cover's
  four corners are taken.

**Per season:** FOLLOW asks the last season's source, and each season keeps its
own download folder when it has one ([`ANIME.md`](ANIME.md), "FOLLOW and REFRESH"
and "Downloading"); a season with files stays where they are, so a MOVE never
splits one across two folders. A season's source and folder live in
`series_season_facts`, written when seasons are merged into one series, when
one is moved, and by `src/lib/server/season-facts.ts`; a season with no row
there is the series' own source and folder.

## REFRESH

The cell before FOLLOW, on any series in the library whose source can be asked
(engine manga, anime, novel plugin; `src/lib/server/refresh.ts`). A
folder-scanned series has nothing to ask and doesn't offer it.

- **It looks, it doesn't fetch.** REFRESH asks the source once, makes entries of
  the chapters or episodes it lists that no entry is, and **queues nothing**,
  not even on a series that is followed. FOLLOW is the only thing that
  downloads, on its own turn. The band it answers with says what arrived
  ("3 NEW CHAPTERS", "NOTHING NEW") and leaves NEXT or ALL to keep them.
- **The chapters it found are not new to FOLLOW**, so FOLLOW's next turn won't
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
- **A selection refreshes too.** SELECT on the library, a tag or a person page,
  then REFRESH in the bulk bar: every selected series that has a source is
  asked once, through the same `refreshSeries`, four at a time, and nothing is
  downloaded. One run asks 24 (`REFRESH_BATCH`), and the band above the bar
  says how many were asked, how many found something, which failed by name,
  which were skipped for having no source, and how many are left; ASK N MORE
  sends the rest. A source that throws or misses 30 s (`REFRESH_TIMEOUT_MS`) is
  one failure among the rest. Hidden series are left out in SQL, and a
  folder-scanned one is skipped, never refused ([`LIBRARY.md`](LIBRARY.md),
  "REFRESH a selection").

## Live

One watcher in the app (`src/lib/server/downloads-watch.ts`) reads the queue:
every three seconds while a screen is listening, every thirty when none is. A
poll of the queue table does what a push would, with no websocket client and no
reconnect logic. The series screen and the queue listen over server-sent events
(`/api/downloads/events`). Only the chapter being downloaded moves: its row's
bar and the queue's band. Anything else that changes (a chapter queued,
finished or failed) makes the screen read its data again, and a row turns
QUEUED → IMPORTING → plain without animation. What a viewer is sent is worked
out from what reveal lets them see. Without script, a screen is as of its last
load.

## Read progress is tsundoku's

Downloading is downloading here, not reading: nothing about read state is
written anywhere but tsundoku. What the tablet reads comes in through the
library's own backup (its `Mihon/autobackup`) and, as with every device,
**only moves forward**; another device's backup is not read.

## Where files go

Everything lands under the **one library root**, `$LIBRARY_ROOT`. Nothing is
deleted by downloading. Manga goes to `devices/tsundoku/Mihon/` (above). Video
goes to a folder per kind (`storage` in `src/lib/library/kinds.ts`, the
registry's), Jellyfin-shaped because it costs nothing, not because anything
depends on Jellyfin:

```
$LIBRARY_ROOT/Anime/<Series>/tvshow.nfo, poster.jpg
$LIBRARY_ROOT/Anime/<Series>/Season 01/<Series> S01E07 <Title>.mkv, and its .nfo
$LIBRARY_ROOT/Shows/<Series>/…                              the same, for a show
$LIBRARY_ROOT/Movies/<Title (Year)>/<Title (Year)>.mkv, <Title (Year)>.nfo, poster.jpg
$LIBRARY_ROOT/Anime (hidden)/…  Shows (hidden)/…  Movies (hidden)/…   the reveal rule
```

- **A film's folder** is TMDB's title and year when the film is linked, else the
  source's title with its release words taken off (`tmdbQuery`) and the year it
  names: `Lupin [Hindi-English] 1080p` becomes `Movies/Lupin/`. Its NFO is
  Jellyfin's `<movie>`, and carries what a show's two files carry between them:
  the series' key, the entry's address at the source and its position
  (`movieNfo`), so a rescan folds the file back onto both.
- **A show** is laid out as an anime is, its folder the series' own title; one
  source season is one series, so it is its own folder, and a merged show's
  seasons keep theirs (`series_season_facts.folder`).
- **The NFOs say the kind** (`<tsundokukind>`), so a rescan or a new install
  over the folder brings a film back as a film; a file without it is an
  anime's. A series already in the database keeps the kind it has. A linked
  film or show carries `<uniqueid type="tmdb">`, and a TMDB link, an UNLINK or
  an UNDO writes its NFOs again in place (`rewriteVideoNfos`); a download does
  too.
- **The importer has a source per video kind** (`Anime`, `Shows`, `Movies`),
  each rooted at its folder, so a file just written attaches under the root
  that holds it, and BROWSE's ADD roots a series by the kind it will have. An
  existing install's `Anime` root keeps its name and its identity.
- **The kind switch moves the files** (`src/lib/server/kind-switch.ts`): a film
  to a show and back, the two kinds TMDB holds (anime to a show crosses
  catalogues). `planKindSwitch` says every path before anything moves, and
  refuses in place (`MOVIE · A MOVIE IS ONE ENTRY, THIS HAS 8`). `switchKind`
  moves the files, the NFOs and the poster first, and moves them back should
  one refuse; then the kind, the root, the folder and the entries' files in one
  transaction; then writes the new kind's NFOs. The TMDB link, search and
  declined offers go, since TMDB is asked again as the other kind; progress,
  rating, shelves and the Work stay. UNDO is remembered per series by the
  workstation, and a restart forgets it (switching back still works).
- **One root on purpose:** `delete.ts`'s `isUnder(library)` guard, backups, the
  hidden folders and RESCAN all assume it. A second root would quietly skip
  deletes and leak hidden series.

## Limits

- **A folder whose chapters a backup shares none of** waits beside the
  backup's series. The same source and title are not enough on their own:
  folding them would list every chapter twice, so the pair stays two series
  until a backup names a chapter the folder has
  ([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the backup knows it").
- **A source no installed extension carries** can't be downloaded from, and a
  series from it gets no new chapters until a repository adds an extension for
  it or the series is moved to another source.
- **Hentoid's keys belong to no family**, so a Hentoid series has nothing to
  download.
- **A failure's reason** is kept (`download_queue.failure`) and not shown.
- **A browse press has no section of its own in the queue**: its chapters are
  listed as any others.
- **File names** use the entry's scanlator as Mihon does, so a chapter with
  scanlator "Unknown" is `Unknown_Ch. 165 - ….cbz`.
