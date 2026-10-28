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
  preferences. `yarn run engine-seed` carried Suwayomi's repository and its 14
  extensions over on 2026-10-28: all loaded, 80 sources, every source the
  library reads from but XBatCat and Hitomi (not in Keiyoushi).

- **The queue and the worker** (c137, 2026-10-28; rung 40):
  `src/lib/server/engine/queue.ts`, `worker.ts`, the pure `device.ts`, started
  from the root layout by `run.ts` only with `DOWNLOADS_BACKEND=engine`. The
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

## What it does not do yet

- **The screens still ask Suwayomi** (c138): nothing queues into the engine's
  queue but a script, and FOLLOW's update check, search, browse and the
  preview are Suwayomi's until then.
- **New chapters a source lists that no entry is** come back from
  `resolveSeries` but aren't made into entries yet: that's FOLLOW's job, in c138.
- **A full scan follows a download**, 230 s on the whole library: the
  importer has no way yet to read one device alone. Fine while chapters
  arrive in batches; worth a narrower scan later.
- **File names** use the entry's scanlator as Mihon does, so a chapter with
  scanlator "Unknown" is `Unknown_Ch. 165 - ….cbz`.
