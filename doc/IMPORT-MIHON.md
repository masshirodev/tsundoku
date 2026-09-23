# The Mihon importer

Reads a copy of the device's `Mihon/` folder in place and writes the library
from it: every series in Mihon's library with its chapters, read state and
history, plus whatever was downloaded. Nothing on disk is moved or renamed.
The formats themselves are in [`IMPORT-FORMATS.md`](IMPORT-FORMATS.md).

## Where it reads from

`LIBRARY_ROOT` (default `/mnt/hdd2/tsundoku/library`) mirrors the tablet's
shared storage, so the device folders sit in it under the names they have on
the device, and a plain rsync refreshes them:

```
$LIBRARY_ROOT/
  Mihon/
    autobackup/app.mihon_<date>_<time>.tachibk   ← the newest one by name is read
    downloads/<Source> (<LANG>)/<Series>/<Chapter>.cbz
  H/.Hentoid/…                                   ← the Hentoid importer, next
```

## Running it

- **START SCAN** on the empty library, or **`/scan`** typed in search later,
  starts it on the server in the background. The library's IMPORTING band follows the
  job (`scan_jobs`), re-reading it every two seconds. The FINISHED band and the
  NEW shelf follow.
- **`yarn run import`** runs the same code without the app. Use it for the first
  large import, and `-- --root <folder>` to point it at another folder that
  holds a `Mihon/`, for example `/mnt/hdd2/tsundoku/samples`. It prints what it
  did.

Only one import runs at a time. A second start while one runs joins it. A job
left unfinished by a process that died is closed at the next start.

## What becomes what

| Mihon                                   | tsundoku                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| a manga in the library                  | a series in the `Mihon` root, `source = 'mihon'`, `origin_key = mihon:<source id>:<url>`          |
| a manga only browsed (`favorite=false`) | **not imported**, unless something of it was downloaded                                           |
| a download the backup doesn't know      | a series from its ComicInfo, `origin_key = mihon-dir:<source dir>/<series dir>`                   |
| chapter                                 | entry: `Ch. <number>` (or the chapter's name when it has none), its own title after "Chapter N -" |
| chapter with no file on disk            | entry with `available = 0`: listed as NOT DOWNLOADED, not readable                                |
| `read`, `lastPageRead`                  | `read_at`, `last_position`                                                                        |
| history (`lastRead`, `readDuration`)    | `last_opened_at`, and one `reading_events` row (`finish` or `page`) with that duration            |
| genres                                  | `genre:` tags, lowercased. Manga/Manhwa/Manhua/Webtoon set the kind and aren't tags               |
| author, artist                          | `author:` and `artist:` tags, one per person (split on `,` `/` `;` `&`)                           |
| source                                  | a `source:` tag                                                                                   |
| status                                  | `ongoing`, `completed` (also "publishing finished"), `cancelled`, `hiatus`, `licensed`            |
| reading mode                            | direction: L→R, R→L, or ↓ SCROLL for vertical/webtoon, kept only when it isn't the kind's default |
| categories                              | see below                                                                                         |

**Categories are the owner's rating scale** (settled 2026-09-23). Each has a
"+" twin for adult series:

| Category               | Rating | Shelf    | Hidden |
| ---------------------- | ------ | -------- | ------ |
| Amazing                | 5      |          |        |
| Good                   | 4      |          |        |
| Okay                   | 3      |          |        |
| Dropped, IDR, To Read  | 0      | its name |        |
| any other category     | 0      | its name |        |
| any of them with a "+" | same   | same     | yes    |

The category is also kept as a `mihon:` tag (`mihon:Good+`), so nothing Mihon
said is lost. With several categories, the highest rating wins and every shelf
applies.

**Kind** comes from the series' own genres (Manhwa, Manhua, Webtoon → manhwa;
Manga → manga), then from a webtoon reading mode, then from a short list of
webtoon-only sources (Asura, Toonily, Webtoons.com, Omega, Bato), and otherwise
manga. A source's majority was tried and dropped: mixed sources like Mangahere
tag only their Korean titles, so it outvoted every Japanese one.

## Matching downloads to the backup

- **Series:** the same source (the folder is `<source name> (<LANG>)`, or
  ComicInfo's `SourceMihon`) and the same title (ComicInfo's `Series`, or the
  folder name built the way Mihon builds it: FAT's illegal characters become
  `_`, cut at 240). The same title under two sources is two series.
- **Chapters,** in three passes, each taking only an unambiguous match:
  1. a URL in ComicInfo's `Web` ending with the backup's chapter URL (Weeb
     Central);
  2. the chapter number (Asura adds a slug hash to its URLs, so only this
     matches);
  3. the chapter's name.

  A file that matches nothing becomes an entry of its own.

- **Positions** are the chapter numbers. A chapter without one (63 of 42k in
  the real backup) slots in after the numbered chapter before it in the
  source's own order.

## Rescanning

Idempotent: a second run over the same folder changes nothing
(`tests/import-db.spec.ts` proves it). On a rescan:

- **new** series and chapters are added;
- **files that arrived** are attached (`available = 1`, file, size, pages), and
  files that went away mark their chapter not downloaded;
- **read state only moves forward.** A chapter read in tsundoku is never unread
  by an older backup, and a newer `lastRead` moves `last_opened_at`;
- **what the owner edits is left alone:** title, rating, favourite, hidden,
  shelves, tags, kind, direction. Only the path, and a status or description
  that is still empty, are refreshed;
- **history rows aren't duplicated**, since an event with the same entry, time
  and kind is written once.

The FINISHED band counts **visible series that arrived**, because it is shown
while reveal may be off. A rescan that brought no new series closes its own
band.

## Measured

The real backup (750 manga, 384 in the library, 42,618 chapters, 15,321
history rows) plus 26 downloaded chapters imports in about 2 seconds. Reading a
chapter costs two small reads (the zip's central directory, then
ComicInfo.xml), because Mihon stores pages uncompressed. So the 130 GB on the
tablet should be bound by the disk, not by the parsing.

## Code

| Part                               | File                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| protobuf, no dependency            | `src/lib/import/protobuf.ts`                                                                                                         |
| the backup's schema                | `src/lib/import/mihon-backup.ts`                                                                                                     |
| ComicInfo.xml                      | `src/lib/import/comicinfo.ts`                                                                                                        |
| every rule above, pure             | `src/lib/import/mihon-plan.ts`                                                                                                       |
| CBZ reading                        | `src/lib/server/zip.ts`                                                                                                              |
| walking the disk, writing, the job | `src/lib/server/import/mihon.ts`                                                                                                     |
| START SCAN / `/scan`               | `src/lib/server/import/index.ts`                                                                                                     |
| CLI                                | `scripts/import.ts`                                                                                                                  |
| tests                              | `tests/mihon-plan.spec.ts`, `tests/zip.spec.ts`, `tests/import-db.spec.ts`; fixtures synthesised by `tests/helpers/mihon-fixture.ts` |

The real samples in `/mnt/hdd2/tsundoku/samples` are copyrighted and partly
explicit, and are never committed. The fixtures copy their shape, not their
content.

## Known gaps

- **Covers** are still placeholders. Mihon keeps its covers in its app cache,
  not in shared storage. The first page of the first downloaded chapter is the
  obvious source, once pages can be served (the reader card).
- **CONTINUE counts every series with a chapter opened and one unread.** On the
  real library that's 153, Dropped included. Whether Dropped should leave
  CONTINUE is the owner's call.
- **ZIP64 archives** are reported as unreadable, not read. A chapter is nowhere
  near 4 GB.
- **Trackers** (MyAnimeList links in the backup) aren't imported. See
  "AniList / MAL tracking, if used".
