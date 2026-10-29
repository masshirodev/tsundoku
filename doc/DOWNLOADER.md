# tsundoku's own downloader

How tsundoku downloads manga itself, on the extension engine
([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)); Suwayomi did it until c129
([`DOWNLOADING.md`](DOWNLOADING.md), "Suwayomi, retired"). Card c125 ("tsundoku's own downloader on
the extension engine, manga first"); started 2026-10-28. Anime (c128) and
novels reuse the queue: a plugin's chapters wait in `download_queue` beside
a manga's, and the novel worker takes those while this one takes the rest
([`NOVELS.md`](NOVELS.md), "Downloading"; c150).

## The one decision: tsundoku is a device

Suwayomi was integrated as **one more device**: it wrote Mihon's download
layout and a Mihon backup into `$LIBRARY_ROOT/devices/suwayomi/Mihon/`, and the
importer read that like the tablet's copy (it still does: the folder stays) ([`SYNC.md`](SYNC.md), "Other
devices"). The downloader does exactly the same, as
**`$LIBRARY_ROOT/devices/tsundoku/Mihon/`**:

```
$LIBRARY_ROOT/devices/tsundoku/Mihon/
  downloads/<Source> (<LANG>)/<Series>/<Scanlator>_<Chapter>.cbz   ComicInfo.xml inside
  autobackup/tsundoku_<date>_<time>.tachibk                         what it has, keyed as Mihon keys it
```

Why, over writing entries straight into the database:

- **The importer is the one place a file becomes an entry**, with every rule
  that took a month to get right: keys, two devices' copies of one series,
  tombstones, page counts, covers, the NEW shelf, arrivals, duplicates. A
  second writer would have to repeat all of it, and drift.
- **A device folder with no backup is read as new series** keyed by folder
  (`mihon-dir:`, [`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the backup knows
  it"). Files written anywhere under `devices/` without a backup would become
  twins at the next scan; files written outside it would be a second kind of
  library folder. Writing the backup is what makes the files fold into the
  series they belong to.
- **Retiring Suwayomi (c129) was then swapping one device for another.** What
  Suwayomi downloaded stays a device's copy, read as before (done 2026-10-28).

So tsundoku writes four things it has only ever read: a CBZ, its ComicInfo, a
`.tachibk`, and chapter numbers.

## Attaching

Card c170, 2026-10-29. The owner: "now that we download everything through
tsundoku, why does it download -> import?" Until then each worker wrote its
file and asked for a scan, twenty seconds after the last arrival and at most
once a minute; a scan took 2–6½ minutes, so a finished chapter sat on
IMPORTING for that long before it opened.

Now **each worker attaches what it just wrote** (`attachWritten`,
`server/import/index.ts`). The importer is still the one place a file becomes
an entry: the file goes to the source whose folder holds it, and that
source's `planOne` plans its series exactly as the scan's `plan` does
(`planMihonSeries`, the same backup, only the series that folder is;
`planAnimeSeries`, the series folder whole; `planEpubFile`, the book). The
plan is written by `writeSeries` with the scan's own root, `markMissing` and
`deviceRoot`, and duplicates are reconciled for those series. A chapter
attaches after the batch's backup is written, so the backup it plans from
already names it.

**The scan stays the cross-check**, and the way in for everything that
arrives otherwise (the tablet, dropped-in files, Syncthing). The workers'
specs attach, then scan, and require every row of the series to be as the
attach left it (`engine-worker-db`, `anime-download-db`,
`novel-download-db`). A scan still follows a download when:

- **a file attached nothing** (no source holds it, or the plan was empty):
  `attachWritten` gives it back;
- **a scan is already running**: it planned before the file existed, and
  writing that plan marks the new file gone, so a scan of its own follows
  (seen live on 2026-10-28, before c170);
- **attaching threw**: logged, and the scan takes over.

## The parts

| Part                 | What                                                                                                                                 | Where                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Chapter numbers      | Mihon's chapter recognition, ported: every source but Webtoons returns `chapter_number = -1`                                         | `src/lib/import/chapter-number.ts`      |
| The backup           | A `.tachibk` writer, the decoder's mirror: the manga tsundoku downloads for, their chapters, and source names                        | `src/lib/import/mihon-backup.ts`        |
| The CBZ              | A zip writer (stored, not deflated: pages are already compressed) and ComicInfo, in the shapes the importer reads                    | `src/lib/server/zip.ts`, `comicinfo.ts` |
| The engine client    | Token, browser User-Agent, `cf-proxy-url`, handles (resend on 409), one call at a time per source, errors told apart by message      | `src/lib/server/engine/client.ts`       |
| Extensions           | Repositories (Keiyoushi's v2 `index.json`), APKs checked against the index's sha256 and kept on `/mnt/hdd2`, source preferences      | `src/lib/server/engine/extensions.ts`   |
| The queue and worker | Queued chapters in the database; per source one call at a time, pages 6 at a time, backoff, a CBZ written to a temp name and renamed | `src/lib/server/engine/downloader.ts`   |
| The screens' backend | DOWNLOAD, the queue, search, preview, ADD, FOLLOW: the same screens, asking the engine instead of Suwayomi                           | `src/lib/server/downloads/`             |

## Keys

A series stays `mihon:<source id>:<url>`, a chapter its URL, as Mihon and
Suwayomi key them (the spike checked all nine sources). Two things change
under it:

- **Memos.** 1.6 sources hang a memo off a URL as `<url>|mangayomi-memo|<json>`.
  The key is the part before the marker; the memo is kept beside it and sent
  back on every call.
- **A source's URLs can move.** Toonily's extension switched every URL to a new
  scheme, and its 126 series here are keyed by the old one. A details call on
  an old URL returns the new one: the new URL becomes an alias of the series'
  key, never a second series.

## The switch

**The screens have asked the engine since 2026-10-28**, after the parity
check below on the live library. Until then `DOWNLOADS_BACKEND` in `.env`
chose between Suwayomi and the engine, and both ran side by side. On the
switch Suwayomi's downloader was stopped, with 322 failed chapters in its own
queue, and the same day Suwayomi was retired (c129): the choice, the variable
and its code are gone, and `server/downloads.ts` is a plain face over the
engine. FOLLOW's step, which Suwayomi's timer used to post, runs in the app
every ten minutes (`engine/run.ts`).

Parity, checked live on 2026-10-28 with the backend on:

- the series screen draws its DOWNLOAD row from the engine (NEXT 10, ALL 38);
  NEXT 10 queued ten chapters, the app's worker downloaded them and the scans
  imported all ten onto their entries;
- FOLLOW, on its own: the ten-minute timer's step found 16 chapters Asura
  lists past the 96 the library had, made them entries of the followed
  series, queued, downloaded and imported them, one series;
- the queue screen, SEARCH THE SOURCES (six sources: IN LIBRARY, SAME TITLE
  IN LIBRARY and new results), a new result's preview and its cover through
  `/api/downloads/engine-image`, ADD TO LIBRARY (48 chapters, each already
  known at the source) and UNDO (the library as it was), and the live events
  stream.

Two things it turned up, fixed the same day: a cover still being fetched
when UNDO removed its series was written under an id the next series gets
(the cover writer now checks the series still exists), and chapters written
during a scan joined that scan and weren't imported (the worker's import now
waits a running scan out, and imports at startup what a restart left).

## Done so far

- **The writers** (c134, 2026-10-28): `chapterNumbers` and `chapterNumberOf`
  in `src/lib/import/chapter-number.ts`, Mihon's recognizer ported rule for
  rule and checked against Mihon's own 90 test cases
  (`tests/chapter-number.spec.ts`); `encodeBackup` beside `decodeBackup`, the
  protobuf encoder moved from the test helpers into `protobuf.ts` and built
  from chunks (30,000 chapters encode; the helper's spread overflowed);
  `comicInfoXml` beside `parseComicInfo`; and CRC-32s and a real date in
  `zip-write.ts`, which had left every CRC at 0 (Python's `zipfile` refused
  the first member). Each round-trips through the importer's own reader
  (`tests/device-writers.spec.ts`).

- **The engine client** (c135, 2026-10-28): `src/lib/server/engine/client.ts`
  over the pure `protocol.ts`. Every call carries the token, a browser
  User-Agent, the solver and tsundoku's preferences in replace-present mode;
  calls into one extension run one at a time, extensions side by side; a 409
  sends the APK once (checked against its handle); failures are read from the
  body's `code`, so a 429 is `rate-limited` though the engine answers 500;
  `fetchProxied` takes pages and streams through `/image/` and `/video/`, and
  `imageType` tells a picture from an error page by its bytes. Tested against
  a fake engine (`tests/engine-client.spec.ts`), and live: Asura Scans'
  popular list, a memo split off its URL, 346 chapters all numbered by
  `chapterNumbers` (the source gave -1 for each), and a page as WebP.

- **Extensions and repositories** (c136, 2026-10-28; rung 39):
  `src/lib/server/engine/extensions.ts` over the pure `repo-index.ts`, and
  `apk-signature.ts`. A repository needs a `repo.json` with a signing key;
  its index is the v2 `index.json` (Keiyoushi, Yuzono), or `index.min.json`
  for older ones. **An APK is installed only when its v2 signature verifies
  and its signer is the repository's key**: Keiyoushi's index publishes no
  per-APK hash, and either check alone passes a forgery (a genuine signing
  block on other code, or code signed by anyone). APKs are kept under their
  handle in `/mnt/hdd2/tsundoku/engine/store` (`ENGINE_STORE`). An update
  keeps the previous version a week for BACK TO; removing keeps the sources'
  preferences. A one-off script (`engine-seed`, removed with Suwayomi in c129)
  carried Suwayomi's repository and its 14 extensions over on 2026-10-28: all loaded, 80 sources, every source the
  library reads from but XBatCat and Hitomi (not in Keiyoushi).

- **The queue and the worker** (c137, 2026-10-28; rung 40):
  `src/lib/server/engine/queue.ts`, `worker.ts`, the pure `device.ts`, started
  from the root layout by `run.ts` whenever the engine is set up. The
  queue is keyed by entries. The worker resolves a series at its source (a
  details call first, so Toonily answers an old URL with its new one, kept in
  `engine_series`), matches the source's chapters onto the entries
  (`matchSourceChapters`: URL, then recognized number with scanlator, then
  number), fetches pages through the engine six at a time, judges each by its
  bytes, and writes the CBZ beside its place and renames it. One chapter per
  source at a time, three sources at once; a failure backs off (15 s doubling,
  60 s for a rate limit, capped at 30 min), three tries, then FAILED. **The
  device's backup carries the library's own keys and URLs**, never the
  source's new ones, and a series' folder title is fixed at its first
  download (`engine_series.title`), since the importer pairs a folder with its
  series by it. Tested end to end on a Toonily-shaped series
  (`tests/engine-worker-db.spec.ts`), and live on 2026-10-28: Weeb Central's
  chapter 165 of a series the tablet had, 16 pages in 5 s, imported onto its
  own entry by the app's scan, no twin.

- **The screens' backend** (c138, 2026-10-28; rung 41): `server/downloads.ts`
  picked (until c129 left only the engine); `engine/backend.ts` answers every call the screens make of Suwayomi
  in Suwayomi's own types, from tsundoku's queue, so no component changed but
  the preview's cover. On the engine a chapter is its entry, a source's manga
  an opaque id of source and URL, and IMPORTING is a chapter written
  (`engine_chapters.downloaded_at`) and not yet imported. FOLLOW asks each
  followed series' source every six hours (`followNew`), makes what it lists
  that no entry is into entries by the Mihon importer's own plan and writer,
  and queues it unless read. `tests/engine-backend-db.spec.ts`, and the live
  check above.

- **Suwayomi retired** (c129, 2026-10-28): its units stopped and disabled, its
  code, container, timer and GraphQL fake removed, its folder kept as a
  device. FOLLOW's step moved into the app (`followStep` in `engine/run.ts`,
  every ten minutes). The screens' shared types live in
  `server/download-types.ts`, the library queries in `library-sources.ts`, the
  live watcher in `downloads-watch.ts`. `tests/downloads-flow.e2e.ts` drives a
  fake engine now. [`DOWNLOADING.md`](DOWNLOADING.md), "Suwayomi, retired".

## What it does not do yet

- **Browsing** (a source's popular and latest lists, filters), extension and
  repository screens, and a source's settings: c126, from its handoff.
- **Migrating a series to another source**: c139.
- **A full scan follows a download**, 230 s on the whole library: the
  importer has no way yet to read one device alone. Fine while chapters
  arrive in batches; worth a narrower scan later.
- **File names** use the entry's scanlator as Mihon does, so a chapter with
  scanlator "Unknown" is `Unknown_Ch. 165 - ….cbz`.
