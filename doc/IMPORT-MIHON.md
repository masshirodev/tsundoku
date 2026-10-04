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

- **START SCAN** on the empty library, then **RESCAN** in the desktop sidebar or
  **`/scan`** typed in search (the way on a tablet or phone), starts it on the server in the background. The library's IMPORTING band follows the
  job (`scan_jobs`), re-reading it every two seconds. The FINISHED band and the
  NEW shelf follow.
- One job runs every importer that finds its folder: Mihon, then Hentoid
  ([`IMPORT-HENTOID.md`](IMPORT-HENTOID.md)).
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
| Amazing                | 10     |          |        |
| Good                   | 8      |          |        |
| Okay                   | 6      |          |        |
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

## Local source

Mihon's `local/` folder holds books put on the device by hand. On this tablet
that's 2136 Hentoid exports (47 GB), each a `chapter_1` folder and a
`cover.jpg`, named `artist - Title - [id]`. The `[id]` is the gallery's real id,
the same one in Hentoid's own `contentV2.json`, not something Mihon invents: a
local manga's URL is just its folder name.

- They import into their own **hidden root, "Mihon local"**
  (`src/lib/import/mihon-local-plan.ts`), as single doujin books. The title
  and an `artist:` tag come from the folder name, `cover.jpg` is the cover,
  and the book is tagged `source:mihon local`.
- The backup's local manga (source `0`, 328 on this tablet, none in the library)
  add their read state where the folder name matches. They are **never** also
  made into not-downloaded series in the visible Mihon root.
- 240 of them are also in Hentoid under the same id. Both copies are kept for
  "Duplicate book detection" to settle.

## The tablet's layout

The copy in `/mnt/hdd2/tsundoku/tablet` differs from the phone samples, and the
importer handles both:

- **every `downloads*` folder:** Android left `downloads (1)` to `(7)` beside
  the real one;
- **the newest backup by the date in its name,** since a debug build writes
  `app.mihon.debug_<date>.tachibk`;
- **the Hentoid root at `H/.Hentoid`, `.Hentoid` or `Hentoid`.**

The first import of the real library (2026-09-23) read 166 GB in about 35
seconds:

| Source      | Series | Entries | Files attached | Skipped                           |
| ----------- | ------ | ------- | -------------- | --------------------------------- |
| Mihon       | 373    | 43,887  | 1,076          | 76 browsed only                   |
| Mihon local | 2,135  | 2,135   | 2,135          | 1 folder of no images             |
| Hentoid     | 4,341  | 4,868   | 4,868          | 3 galleries on disk twice, merged |

Folder names with `#` (52 of them) are harmless: pages are addressed by entry
id and number, never by path.

## Before the backup knows it

A download the backup doesn't list is keyed by its folder
(`mihon-dir:<source dir>/<series dir>`). That happens whenever a chapter is
downloaded before the next backup: Mihon backs up daily, Suwayomi when the
timer asks ([`DOWNLOADING.md`](DOWNLOADING.md)). Once a newer backup lists the
manga, the same folder matches it, and the plan carries the folder key it had
(`formerKey`). The writer settles the two before anything else
(`adoptFormer`, `src/lib/server/import/fold.ts`):

- **Only the folder's series exists:** it takes the URL key, and each chapter
  found by its file takes the backup's URL (ComicInfo's full `Web` URL against
  the backup's path). It's the same row, so nothing the owner did is touched.
- **Both exist** (the URL's series came from another device's backup, or from
  an import before this rule): the folder's series is **folded** into the
  URL's (`foldSeries`) and its row goes. A chapter both have (the same file,
  else the same URL, else the same label) is one: read state moves forward as
  on a rescan, the newer place wins, a rating or FAV fills in where the URL's
  has none, and it takes the file if it had none. A chapter only the folder's
  series has moves across. The reading log, shelves, tags, links and lookups
  follow, the URL series' own winning where both have one; caches of a file's
  pages follow only with that file. A hidden series stays hidden. No file
  moves.

Before 2026-10-04 neither happened: nothing plans the folder key again once a
backup claims the folder, so the folder's series lingered beside the URL's,
both reading the same files (22 pairs in the live library, folded by the
first scan with this rule). Deleting one of a pair trashed the other's files
too; that is fixed in the delete as well ([`DELETING.md`](DELETING.md)).

A device whose own backup still doesn't know the manga plans the folder key
again, and makes the folder's series again, until that device backs up.

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
- **each chapter's scanlator is recorded,** from the backup or the CBZ's
  `<Translator>`, and after every source is written, a chapter from two
  scanlators is collapsed to one ([`DUPLICATES.md`](DUPLICATES.md)).

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

| Part                                   | File                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| protobuf, no dependency                | `src/lib/import/protobuf.ts`                                                                                                         |
| the backup's schema                    | `src/lib/import/mihon-backup.ts`                                                                                                     |
| ComicInfo.xml                          | `src/lib/import/comicinfo.ts`                                                                                                        |
| every rule above, pure                 | `src/lib/import/mihon-plan.ts`                                                                                                       |
| CBZ reading                            | `src/lib/server/zip.ts`                                                                                                              |
| walking the disk                       | `src/lib/server/import/mihon.ts`                                                                                                     |
| the one writer, shared with Hentoid    | `src/lib/server/import/write.ts`                                                                                                     |
| a folder's series once a backup knows  | `src/lib/server/import/fold.ts`, tested in `tests/fold-db.spec.ts`                                                                   |
| the job, START SCAN / RESCAN / `/scan` | `src/lib/server/import/index.ts`                                                                                                     |
| CLI                                    | `scripts/import.ts`                                                                                                                  |
| tests                                  | `tests/mihon-plan.spec.ts`, `tests/zip.spec.ts`, `tests/import-db.spec.ts`; fixtures synthesised by `tests/helpers/mihon-fixture.ts` |

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
- **Trackers** are read for one thing: a MyAnimeList tracker (tracker 1)
  links its series to the MAL entry, with its score for an unrated series'
  rating ([`LINKS.md`](LINKS.md)). Status and chapter aren't kept yet, and
  other trackers are skipped. The phone's backup links 110 series to MAL,
  all of which match a series here by URL. The tablet's Mihon is a debug
  build whose backups carry none (measured 2026-09-24).
