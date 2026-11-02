# The Mihon importer

Reads a Mihon backup in place and writes the library from it: every series in
Mihon's library with its chapters, read state and history, plus whatever was
downloaded into tsundoku's own folder. Nothing on disk is moved or renamed.
The formats themselves are in [`IMPORT-FORMATS.md`](IMPORT-FORMATS.md).

## Where it reads from

`LIBRARY_ROOT` (default `TSUNDOKU_HOME/library`; on the workstation
`/mnt/hdd2/tsundoku/tablet`, from `.env`) holds the library's folders:

```
$LIBRARY_ROOT/
  Mihon/
    autobackup/app.mihon_<date>_<time>.tachibk   ← the newest one by name is read
  H/.Hentoid/…                                   ← the Hentoid importer, next
  devices/tsundoku/Mihon/                        ← tsundoku's own downloads
    downloads/<Source> (<LANG>)/<Series>/<Chapter>.cbz
    autobackup/tsundoku_<date>_<time>.tachibk
```

**The library's `Mihon/` is a place to drop a backup** — a friend moving here
from Mihon, or the owner's own — and a backup is the one thing read from it. It
is also the root tsundoku's ADD and online reading put a series in, which is
why the name stays (`<library>/Mihon`, [`BROWSING.md`](BROWSING.md), "A library
with no Mihon folder"). Nothing else in it is scanned.

**`devices/tsundoku/Mihon/` is the one Mihon folder read as a device**: what
tsundoku's own downloader wrote, read back by the same rules a device's copy
was ([`DOWNLOADER.md`](DOWNLOADER.md), "The one decision: tsundoku is a
device").

Until c191 (2026-10-30) a `Mihon/` folder anywhere was also read as a device:
the tablet's or the phone's downloads mirrored under `devices/<name>/Mihon/`.
The owner had those stripped — "we can strip Mihon off this app" — so **no
other device's `Mihon/` folder is read any more**. Their `Hentoid/` and
`Library/` copies still are ([`SYNC.md`](SYNC.md), "Other devices").

The keys stay as they were: `mihon:<source>:<url>`, `mihon-dir:<source
dir>/<series dir>` and `aniyomi:`. Renaming them would be a migration over
every series and link for no visible change.

## What a mirror left behind

A series imported from a device's `Mihon/` keeps everything it had: its row,
its files, its `available` flags, its reading, its shelves and its links. The
removed source simply stops reading: nothing marks a file that left the mirror
not downloaded any more, and no new chapter appears from it. A download into
that folder is still legible (the files are where the entries say), and
`mihon-dir:` series from it are adopted the same way if a backup later names
them. Deleting one of those series still trashes its files, as any delete does
([`DELETING.md`](DELETING.md)).

## Running it

- **START SCAN** on the empty library, then **RESCAN** in the desktop sidebar or
  **`/scan`** typed in search (the way on a tablet or phone), starts it on the server in the background. The library's IMPORTING band follows the
  job (`scan_jobs`), re-reading it every two seconds. The FINISHED band and the
  NEW shelf follow.
- One job runs every importer that finds its folder, the library's first: the
  Mihon backup, then Hentoid, then EPUBs, then anime, and last each device's
  folders under `devices/` — of which only tsundoku's `Mihon/` holds
  downloads (Hentoid and EPUBs on the others are read,
  [`IMPORT-HENTOID.md`](IMPORT-HENTOID.md)).
- **`yarn run import`** runs the same code without the app. Use it for the first
  large import, and `-- --root <folder>` to point it at another folder that
  holds a `Mihon/`, for example `/mnt/hdd2/tsundoku/samples`. It prints what it
  did.

Only one import runs at a time. A second start while one runs joins it. A job
left unfinished by a process that died (a crash, or a restart for an update)
is closed when the app next starts (`init` in `src/hooks.server.ts`), and by
the next import too. Until it is, the library believes it is still importing:
the IMPORTING band never ends and the grid stays on NEWEST FIRST with no SORT
(scan 750, 2026-11-01). One that brought no new series leaves no band. So a
`yarn run import` against the live database must not run across a restart of
the served app: the start closes its job too, and its band ends early.

## What becomes what

| Mihon                                   | tsundoku                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| a manga in the library                  | a series in the `Mihon` root, `source = 'mihon'`, `origin_key = mihon:<source id>:<url>`                           |
| a manga only browsed (`favorite=false`) | **not imported**, unless something of it was downloaded                                                            |
| a download the backup doesn't know      | a series from its ComicInfo, `origin_key = mihon-dir:<source dir>/<series dir>`                                    |
| chapter                                 | entry: `Ch. <number>` (or the chapter's name when it has none), its own title after "Chapter N -"                  |
| chapter with no file on disk            | entry with `available = 0`: listed as NOT DOWNLOADED, not readable                                                 |
| `read`, `lastPageRead`                  | `read_at`, `last_position`                                                                                         |
| history (`lastRead`, `readDuration`)    | `last_opened_at`, and one `reading_events` row (`finish` or `page`) with that duration                             |
| genres                                  | `genre:` tags, lowercased (`tag:` from a gallery source). Manga/Manhwa/Manhua/Webtoon set the kind and aren't tags |
| author, artist                          | `author:` and `artist:` tags, one per person (split on `,` `/` `;` `&`)                                            |
| source                                  | a `source:` tag                                                                                                    |
| status                                  | `ongoing`, `completed` (also "publishing finished"), `cancelled`, `hiatus`, `licensed`                             |
| reading mode                            | direction: L→R, R→L, or ↓ SCROLL for vertical/webtoon, kept only when it isn't the kind's default                  |
| categories                              | see below                                                                                                          |

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

**Kind** is doujin for a gallery source (below). Otherwise it comes from the
series' own genres (Manhwa, Manhua, Webtoon → manhwa; Manga → manga), then
from a webtoon reading mode, then from a short list of webtoon-only sources
(Asura, Toonily, Webtoons.com, Omega, Bato), and otherwise manga. A source's
majority was tried and dropped: mixed sources like Mangahere tag only their
Korean titles, so it outvoted every Japanese one.

### Gallery sources

Some sources have no series: every "manga" there is one gallery, a doujin or
a photo set, with a single chapter called `Chapter` or `Gallery`, often with
no number. Mihon shows each as a series of one chapter. Here they are
**books**, the same as Hentoid's and the local folder's (c124, "Doujin galleries
from Mihon sources import as one-off books, not one-chapter series", the
owner's call on 2026-10-28):

- **kind `doujin`**, whatever the genres say, so a gallery is on the ONE-OFF
  shelf ([`FILTERS.md`](FILTERS.md)) and can be grouped into a series of books
  ([`BOOKS.md`](BOOKS.md));
- its one chapter is the entry **`Book`**, at position 1, titled after the
  gallery;
- its genres are **`tag:` tags**, Hentoid's namespace, not `genre:`. Both apps
  lowercase them and keep Hitomi's ♀/♂, so `tag:big breasts ♀` is one tag
  whichever app downloaded the book. Author and artist stay people (on the
  photo sites, the studio and the model).

The key doesn't change (`mihon:<source id>:<url>`), and neither do read state
or hiding, which still follow the categories.

**The list is `GALLERY_SOURCES` in `src/lib/import/mihon-plan.ts`, and only
sources whose shape was checked are in it:**

| Checked in                                       | Sources                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| the tablet's backup (2026-10-03)                 | NHentai, nHentai.com (unoriginal), Hitomi, Everia.club, AHottie, Elite Babes, Playmate Hunter        |
| Keiyoushi's `GalleryAdults` base (one "Chapter") | IMHentai, AsmHentai, HentaiFox, HentaiEra, HentaiRox, HentaiZap, HentaiEnvy, NHentai.to, NHentai.xxx |
| Keiyoushi's code (one "Gallery")                 | EveriaClub (unoriginal)                                                                              |

"Hentai" in an extension's name says nothing: HentaiRead, HentaiHere and
the Madara-themed sites are ordinary chaptered series, and **Luscious isn't a
gallery source** (an album in the backup had 1,445 chapters, one per post).
To add one, check that its manga have exactly one chapter (a backup, or the
extension's `getChapterList` in
[keiyoushi/extensions-source](https://github.com/keiyoushi/extensions-source)),
add its name in lowercase, and add it to the table above.

**Only new galleries.** Kind is written once, when a series is created
("Rescanning", below), so a gallery imported before c124 keeps its kind until
the owner changes it. On 2026-10-28 that was one series, from Hitomi.

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

Mihon's `local/` folder held books put on the tablet by hand. **It is not
imported any more** (c191): the folder is not read, no hidden "Mihon local"
root is made, and a backup's local manga (source `0`) are skipped rather than
made into not-downloaded series either. A library that imported them before
keeps those rows where they are, under the "Mihon local" root; nothing updates
them.

## The tablet's layout

Mihon's own layout, which tsundoku's downloader copies and the importer still
handles for its own folder:

- **every `downloads*` folder:** Android left `downloads (1)` to `(7)` beside
  the real one;
- **the newest backup by the date in its name,** since a debug build writes
  `app.mihon.debug_<date>.tachibk`;
- **the Hentoid root at `H/.Hentoid`, `.Hentoid` or `Hentoid`.**

The first import of the real library (2026-09-23) read 166 GB in about 35
seconds. It was before c191, so it read a mirrored `Mihon/` and its local
folder too; neither is scanned now:

| Source      | Series | Entries | Files attached | Skipped                              |
| ----------- | ------ | ------- | -------------- | ------------------------------------ |
| Mihon       | 373    | 43,887  | 1,076          | 76 browsed only                      |
| Mihon local | 2,135  | 2,135   | 2,135          | 1 folder of no images (not read now) |
| Hentoid     | 4,341  | 4,868   | 4,868          | 3 galleries on disk twice, merged    |

Folder names with `#` (52 of them) are harmless: pages are addressed by entry
id and number, never by path.

## Before the backup knows it

A download the backup doesn't list is keyed by its folder
(`mihon-dir:<source dir>/<series dir>`). That happens whenever a chapter is
downloaded before the next backup: Mihon backs up daily; tsundoku's own device writes one with its downloads ([`DOWNLOADER.md`](DOWNLOADER.md)).

**Another device's backup counts too** (c89). A series downloaded on the
tablet, without being added to Mihon's library there, and in the phone's
library has two keys by then: the tablet's folder (`mihon-dir:…`) and the
phone's backup (`mihon:<source>:<url>`), because each device's copy is read on
its own ([`SYNC.md`](SYNC.md), "Other devices"). The writer settles the two
before anything else, whichever of them the plan it is writing is
(`src/lib/server/import/fold.ts`): **`adoptFormer`** when this device has both
(the plan carries the folder key it used to have), **`adoptFolder`** when a
backup's plan meets a folder's series, and **`adoptNamed`** when a folder's
plan meets the series a backup names, including a pair that already exists.

- **The folder's series is found by its source and title,** the same rule
  "Matching downloads" uses, in the same root (every device's Mihon is one
  root). **Only the folder's series exists:** if the plan has chapters, one of
  them must be the folder's (below); it then takes the URL key, so both
  devices' plans write into one row, and nothing the owner did is touched.
- **Both exist** (a backup that claims the folder, this one's or another
  device's): the folder's series is **folded** into the URL's
  (`foldSeries`), and its row goes — unless the URL series is a browsing
  record, which is not the library's (below). A chapter both have (the same
  file, else
  the same URL, else the same label) is one: read state moves forward as on a
  rescan, the newer place wins, a rating or FAV fills in where the URL's has
  none, and it takes the file if it had none. A chapter only the folder's
  series has moves across. The reading log, shelves, tags, links and lookups
  follow, the URL series' own winning where both have one; caches of a file's
  pages follow only with that file. A hidden series stays hidden. No file
  moves.

**A folder whose chapters the backup does not share waits beside it.** The
source and title are not enough on their own: adopting would take the folder's
series to the URL key with its chapters still addressed by the folder, and the
writer would add the backup's chapters beside them, every chapter twice. So a
plan that has chapters and matches none of the folder's (a series renumbered on
one side, or one whose Mihon has chapter metadata off, `Chapter 1` against
`Ch. 1`) is left as two series, the folder's and the backup's, and the folder's
waits until a backup names chapters it shares. A backup entry with no chapters
has nothing to prove and is still adopted by name. The pair is stable: a rescan
creates neither series again. The same caution applies to a browsing record
([`BROWSING.md`](BROWSING.md)): a record is never the survivor, at any of the
three doors, because a record is off every shelf, count and search and is
forgotten 30 days after it was last opened. A folder whose only match is a
record therefore also waits, until ADD promotes the record; the next scan then
folds them. When this device's own backup names the manga and a record already
holds the URL key (`adoptFormer`), the record's data moves into the folder's
series instead, which keeps the library's row and id; the record's row goes.

**Chapters are re-keyed by the same rule the matching above uses:** a URL in
ComicInfo's `Web` ending with the backup's chapter URL (Weeb Central), then
the chapter's number, which both sides build into the label (`Ch. 98`; Asura
adds a slug hash to its URLs, so only the number matches). A file that matches
neither is **kept** as an entry of its own, with its ComicInfo URL and its
file: adopting never drops one. The address a chapter leaves joins every one
it has left (`entry_former_urls`, rung 58), and the folder key joins the
series' former keys (`series_former_keys`; doc/MOVE.md, "The move"), so the
device whose backup still doesn't name the manga — or whose download still
stands on its own — finds the same series on every scan instead of making the
folder's series again. A folder's plan also matches its chapters by their file
or their number, which is how a download that arrives after the two are one
attaches to the entry the backup already lists.

Before 2026-10-04 none of this happened: the folder's series lingered beside
the URL's, both reading the same files. 22 pairs in the live library were
folded by the first scan with that rule, on the device whose own backup knew
the manga. The folder-keyed series whose backup another device had (34 on
2026-10-03, The Flowers of Evil among them) were left to c89: the same scan
settles the ones whose chapters it can match, and leaves the rest beside each
other, in the two cases above. Deleting one of a pair trashed the other's files
too; that is fixed in the delete as well ([`DELETING.md`](DELETING.md)).

A device whose own backup still doesn't know the manga plans the folder key
again, and finds the URL series by the key it left, until that device backs up.

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
| a folder's series once a backup knows  | `src/lib/server/import/fold.ts`, tested in `tests/fold-db.spec.ts` and `tests/devices-import-db.spec.ts`                             |
| the job, START SCAN / RESCAN / `/scan` | `src/lib/server/import/index.ts`                                                                                                     |
| CLI                                    | `scripts/import.ts`                                                                                                                  |
| tests                                  | `tests/mihon-plan.spec.ts`, `tests/zip.spec.ts`, `tests/import-db.spec.ts`; fixtures synthesised by `tests/helpers/mihon-fixture.ts` |

The real samples in `/mnt/hdd2/tsundoku/samples` are copyrighted and partly
explicit, and are never committed. The fixtures copy their shape, not their
content.

## Known gaps

- **Mihon's books are never checked for duplicates.** Duplicate-book
  detection needs a cover hash, and only Hentoid's import has one
  ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)): the local folder's books and,
  since c124, galleries from Mihon sources have none. Card c130 ("Hash the
  covers of books that arrive without one, so Mihon's books are checked for
  duplicates").
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
