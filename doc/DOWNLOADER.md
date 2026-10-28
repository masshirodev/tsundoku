# tsundoku's own downloader

How tsundoku downloads manga itself, on the extension engine
([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)), instead of asking Suwayomi
([`DOWNLOADING.md`](DOWNLOADING.md)). Card c125 ("tsundoku's own downloader on
the extension engine, manga first"); started 2026-10-28. Anime (c128) and
novels (c127) come later and reuse the queue.

## The one decision: tsundoku is a device

Suwayomi is integrated as **one more device**: it writes Mihon's download
layout and a Mihon backup into `$LIBRARY_ROOT/devices/suwayomi/Mihon/`, and the
importer reads that like the tablet's copy ([`SYNC.md`](SYNC.md), "Other
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
- **Retiring Suwayomi (c129) is then swapping one device for another.** What
  Suwayomi downloaded stays a device's copy, read as before.

So tsundoku writes four things it has only ever read: a CBZ, its ComicInfo, a
`.tachibk`, and chapter numbers.

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

## Until parity

Suwayomi keeps downloading. The engine's backend is off unless
`DOWNLOADS_BACKEND=engine`, so both can run, and the switch is one line in
`.env`. Parity means: the DOWNLOAD row, NEXT/ALL, retry, the queue with
pause/resume and to-the-top, SEARCH THE SOURCES, the preview, ADD TO LIBRARY,
FOLLOW and its update check, and the live events, all from the engine.

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

## What it does not do yet

The engine client, extensions, the queue and worker, and the screens' backend
(c135 to c138): each moves to "Done so far" as it lands.
