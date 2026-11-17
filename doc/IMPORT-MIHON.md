# The Mihon importer

Reads a Mihon backup in place and writes the library from it: every series in
Mihon's library with its chapters, read state and history, plus whatever
tsundoku's own downloader wrote into its folder. Nothing on disk is moved or
renamed. The formats themselves are in [`IMPORT-FORMATS.md`](IMPORT-FORMATS.md);
the other importers are listed in [`IMPORT.md`](IMPORT.md).

## Where it reads from

`LIBRARY_ROOT` (default `TSUNDOKU_HOME/library`) holds the library's folders:

```
$LIBRARY_ROOT/
  Mihon/
    autobackup/app.mihon_<date>_<time>.tachibk   ← the newest one by name is read
  H/.Hentoid/…                                   ← the Hentoid importer
  devices/tsundoku/Mihon/                        ← tsundoku's own downloads
    downloads/<Source> (<LANG>)/<Series>/<Chapter>.cbz
    autobackup/tsundoku_<date>_<time>.tachibk
```

**The library's `Mihon/` is a place to drop a backup**, from someone moving
here from Mihon or from your own phone, and a backup is the one thing read
from it. It is also the root tsundoku's ADD and online reading put a series
in, which is why the name stays (`<library>/Mihon`,
[`READING-ONLINE.md`](READING-ONLINE.md), "Where a record's series lives").
Nothing else in it is scanned.

**A `Mihon/` with no backup in it is no source.** A backup is a file in
`Mihon/autobackup/` named `.tachibk` or `.proto.gz`, the names the importer
reads. Without one, START SCAN, RESCAN and `/scan` refuse with where they
looked, `NOTHING TO IMPORT · NO BACKUP IN <library>/Mihon/autobackup AND NO
H/.Hentoid/ FOLDER IN <library>`, instead of opening a job that finds nothing
and leaves no band. With no `Mihon/` folder at all the sentence is
`NOTHING TO IMPORT · NO Mihon/ FOLDER OR H/.Hentoid/ FOLDER IN <library>`. The
check is made when the list of sources is built, before any job opens
(`src/lib/server/import/index.ts`, `sourcesAt`), so it and the sentence give
the same answer. It does not touch `devices/tsundoku/Mihon/`, whose downloads
are read with or without a backup. A folder that does hold other sources
(Hentoid, EPUBs, video) scans without the Mihon step.

**`devices/tsundoku/Mihon/` is the one Mihon folder read as a device**: what
tsundoku's own downloader wrote, read back by the rules a device's copy
follows ([`DOWNLOADS.md`](DOWNLOADS.md), "tsundoku is a device"). No other
device's `Mihon/` folder is read, whether it is the library's own or one under
`devices/<name>/`; their `Hentoid/` and `Library/` copies are
([`SYNC.md`](SYNC.md), "Other devices").

A series whose files sit in a `Mihon/` folder no source reads keeps
everything it has: its row, its files, its `available` flags, its reading,
its shelves and its links. Nothing marks a file that leaves that folder not
downloaded, and no new chapter appears from it. A download into that folder is
still legible (the files are where the entries say), and `mihon-dir:` series
from it are adopted the same way if a backup later names them. Deleting one of
those series trashes its files, as any delete does
([`DELETING.md`](DELETING.md)).

The keys are `mihon:<source>:<url>`, `mihon-dir:<source dir>/<series dir>`
and `aniyomi:`. Renaming them would be a migration over every series and link
for no visible change.

## Running it

- **IMPORT A BACKUP** (`/import`; [`IMPORT-BACKUP.md`](IMPORT-BACKUP.md))
  takes a backup from the browser, on the computer or a phone, with no folder
  to find: it is uploaded into the data folder's import area, previewed, and
  on IMPORT run as a job of its own through this importer's plan
  (`planMihon`) and the same writer, into the same `Mihon` root. A second
  backup merges by the rescan rule below.
- **START SCAN** on the empty library, then **RESCAN** in the desktop sidebar
  or **`/scan`** typed in search (the way on a tablet or phone), starts it on
  the server in the background. The library's IMPORTING band follows the job
  (`scan_jobs`), re-reading it every two seconds. The FINISHED band and the
  NEW shelf follow.
- One job runs every importer that finds its folder, the library's first: the
  Mihon backup, then Hentoid, then EPUBs, then the video folders, and last
  each device's folders under `devices/`, of which only tsundoku's `Mihon/`
  holds downloads (Hentoid and EPUBs on the others are read,
  [`IMPORT-HENTOID.md`](IMPORT-HENTOID.md)).
- **`yarn run import`** runs the same code without the app. Use it for a first
  large import, and `-- --root <folder>` to point it at another folder that
  holds a `Mihon/` (a copy of a device's folders, say). It prints what it did.

Only one import runs at a time. A second start while a scan runs joins it;
while a backup's import ([`IMPORT-BACKUP.md`](IMPORT-BACKUP.md)) runs, it
waits its turn and then scans in a job of its own, and START SCAN and RESCAN
say so. A job left unfinished by a process that died (a crash, or a restart
for an update) is closed when the app next starts (`init` in
`src/hooks.server.ts`), and by the next import too. Until it is, the library
believes it is still importing: the IMPORTING band never ends and the grid
stays on NEWEST FIRST with no SORT. One that brought no new series leaves no
band. So a `yarn run import` against the live database must not run across a
restart of the served app: the start closes its job too, and its band ends
early.

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
| author, artist                          | `author:` and `artist:` tags, one per person (split on `,` `/` `;` `&`; "Tanaka, Jr." is one: see below)           |
| source                                  | a `source:` tag                                                                                                    |
| status                                  | `ongoing`, `completed` (also "publishing finished"), `cancelled`, `hiatus`, `licensed`                             |
| reading mode                            | direction: L→R, R→L, or ↓ SCROLL for vertical/webtoon, kept only when it isn't the kind's default                  |
| categories                              | see below                                                                                                          |
| a local manga (source `0`)              | **not imported** (below)                                                                                           |

**One split for people, everywhere.** `people()`
(`src/lib/import/mihon-plan.ts`) is the only author and artist split: Mihon's
plan, LNReader's (`novel-plan.ts`), Aniyomi's (`anime-plan.ts`) and browse's
preview (`splitPeople`, `src/lib/library/tag-search.ts`, which adds only "a
name met twice is kept once") all call it, so a name the preview links is a
tag the added series carries. It splits on `,`, `/`, `;` and an `&` between
spaces, drops `_`
and "unknown", and keeps a part that is only a generational suffix (`Jr.`,
`Sr.`, `II`, `III`, `IV`, any case, the dot optional) with the name before it,
written back as `Tanaka, Jr.`. A suffix with no name before it (`Jr., Sato`)
is a name of its own, and a name written surname-first (`Oda, Eiichiro`) is
split in two.

**Tags already stored are not rewritten**: the importer writes a series' tags
only when it adds the series (`src/lib/server/import/write.ts`), so a change
to the split never reaches a series already in the library. No migration does
it either: a tag row keeps no order, so a migration could not tell which name
a stored `Jr.` followed. Such a tag is fixed by hand on the series screen.

**Categories are read as a rating scale.** Each has a "+" twin for adult
series:

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

**A source with ADDED HIDDEN on** (its settings page in BROWSE) hides a new
series from it whatever its category says, so a backup can only add hiding: a
"+" series is hidden either way, and a series already in the library is left
as it is ([`BROWSE.md`](BROWSE.md), "A source's own switches").

**Kind** is doujin for a gallery source (below). Otherwise it comes from the
series' own genres (Manhwa, Manhua, Webtoon → manhwa; Manga → manga), then
from a webtoon reading mode, then from a short list of webtoon-only sources
(Asura Scans, Toonily, Webtoons.com, Omega Scans, Bato.to), and otherwise
manga. A source's majority is not used: mixed sources such as Mangahere tag
only their Korean titles, so it would outvote every Japanese one.

**Kind is written once**, when a series is created ("Rescanning", below), so
a series already in the library keeps the kind it has until it is changed by
hand.

### Gallery sources

Some sources have no series: every "manga" there is one gallery, a doujin or
a photo set, with a single chapter called `Chapter` or `Gallery`, often with
no number. Mihon shows each as a series of one chapter. Here they are
**books**, the same as Hentoid's:

- **kind `doujin`**, whatever the genres say, so a gallery is on the ONE-OFF
  shelf ([`FILTERS.md`](FILTERS.md)) and can be grouped into a series of books
  ([`BOOKS.md`](BOOKS.md));
- its one chapter is the entry **`Book`**, at position 1, titled after the
  gallery;
- its genres are **`tag:` tags**, Hentoid's namespace, not `genre:`. Both apps
  lowercase them and keep Hitomi's ♀/♂, so `tag:big breasts ♀` is one tag
  whichever app downloaded the book. Author and artist stay people (on the
  photo sites, the studio and the model).

The key stays `mihon:<source id>:<url>`, and read state and hiding still
follow the categories.

**The list is `GALLERY_SOURCES` in `src/lib/import/mihon-plan.ts`, and only
sources whose shape was checked are in it:**

| Checked in                                       | Sources                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| a real backup                                    | NHentai, nHentai.com (unoriginal), Hitomi, Everia.club, AHottie, Elite Babes, Playmate Hunter        |
| Keiyoushi's `GalleryAdults` base (one "Chapter") | IMHentai, AsmHentai, HentaiFox, HentaiEra, HentaiRox, HentaiZap, HentaiEnvy, NHentai.to, NHentai.xxx |
| Keiyoushi's code (one "Gallery")                 | EveriaClub (unoriginal)                                                                              |

"Hentai" in an extension's name says nothing: HentaiRead, HentaiHere and
the Madara-themed sites are ordinary chaptered series, and **Luscious isn't a
gallery source** (an album in a backup had 1,445 chapters, one per post).
To add one, check that its manga have exactly one chapter (a backup, or the
extension's `getChapterList` in
[keiyoushi/extensions-source](https://github.com/keiyoushi/extensions-source)),
add its name in lowercase, and add it to the table above.

### Local source

Mihon's `local/` folder holds books put on the device by hand. **It is not
imported**: the folder is not read, and a backup's local manga (source `0`)
are skipped rather than made into not-downloaded series, since their files
stay on the device. The backup preview lists them under 04 — LEFT OUT.

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
  a real backup) slots in after the numbered chapter before it in the
  source's own order.

### Mihon's layout

Mihon's own layout, which tsundoku's downloader copies, has quirks the
importer handles:

- **every `downloads*` folder:** Android leaves `downloads (1)` to `(7)` beside
  the real one;
- **the newest backup by the date in its name,** since a debug build writes
  `app.mihon.debug_<date>.tachibk`;
- **the Hentoid root at `H/.Hentoid`, `.Hentoid` or `Hentoid`.**

Folder names with `#` are harmless: pages are addressed by entry id and
number, never by path.

## Before the backup knows it

A download the backup doesn't list is keyed by its folder
(`mihon-dir:<source dir>/<series dir>`). That happens whenever a chapter is
downloaded before the next backup: Mihon backs up daily, and tsundoku's own
device writes one with its downloads ([`DOWNLOADS.md`](DOWNLOADS.md)).

**A backup that names the manga settles the two.** A series downloaded
before the next backup has two keys by then: the folder's (`mihon-dir:…`) and
the backup's (`mihon:<source>:<url>`). The backup can be the library's own
(dropped into `Mihon/autobackup`) or tsundoku's, which writes one with its
downloads; those are the only two read ([`SYNC.md`](SYNC.md), "Other
devices"). The writer settles the two before anything else, whichever of them
the plan it is writing is (`src/lib/server/import/fold.ts`):
**`adoptFormer`** when this device has both (the plan carries the folder key
the series had), **`adoptFolder`** when a backup's plan meets a folder's
series, and **`adoptNamed`** when a folder's plan meets the series a backup
names, including a pair that already exists.

- **The folder's series is found by its source and title,** the same rule
  "Matching downloads" uses, in the same root (every device's Mihon is one
  root). **Only the folder's series exists:** if the plan has chapters, one of
  them must be the folder's (below); it then takes the URL key, so the
  backup's plan and the folder's write into one row, and nothing set by hand
  is touched.
- **Both exist** (a backup that claims the folder, this one's or another
  device's): the folder's series is **folded** into the URL's
  (`foldSeries`), and its row goes, unless the URL series is a browsing
  record, which is not the library's (below). A chapter both have (the same
  file, else the same URL, else the same label) is one: read state moves
  forward as on a rescan, the newer place wins, a rating or FAV fills in where
  the URL's has none, and it takes the file if it had none. A chapter only the
  folder's series has moves across. The reading log, shelves, tags, links and
  lookups follow, the URL series' own winning where both have one; caches of a
  file's pages follow only with that file. No file moves.

  **A hidden series stays hidden:** when either row was hidden (by its own
  flag, or by a hidden root), the survivor is hidden through the Works rule's
  own write (`setHiddenWhole`), so a Work it is a part of, or the folder's
  Work it joins in the folder's place, is hidden whole, never left with one
  part hidden ([`WORKS.md`](WORKS.md), "The one rule"). A fold never shows
  anything.

  **Works:** a survivor already in a Work keeps that Work; the folder's
  membership is dropped with its row, and a Work left with one series ends.
  That loss is a grouping made by hand that the import cannot put back, so it
  is named: each source's summary lists it (`dropped`), as `DROPPED FROM
<WORK> · <survivor's title>`, with `· THE WORK ENDED` when the Work was left
  with one series, and the server's log carries the same line (`[import] …`,
  from a scan and from what a download attaches). A scan's or an import's job
  keeps the list (`scan_jobs.dropped`, migration 71), and the IMPORT LOG draws
  it under the entry's WORKS ([`IMPORT-BACKUP.md`](IMPORT-BACKUP.md), "The
  log"); `yarn run import` prints it under each source. What a download
  attaches has no job, so only the server's log has its line. A survivor in no
  Work takes the folder's membership in its place, and two parts of one Work
  stay in it: neither is a loss.

  **Title, kind and direction** are the one setting a fold cannot keep from
  both rows. A folder's series that was renamed (its title not the name its
  folder builds) passes that name to the survivor, with the kind and
  direction set beside it (a novel's page direction, `text_direction`, too),
  since the backup's row would otherwise put the import's name over the one
  chosen by hand. A folder's series still named as its folder carries no edit,
  and the survivor keeps its own, except that a page direction fills in where
  the survivor has none, as a rating does: R→L set on either row survives the
  fold. The renamed folder passes its page direction only if it chose one:
  NULL is 'never chosen' and leaves a survivor's R→L alone, and a chosen L→R,
  stored `'ltr'`, wins over it.

**A folder whose chapters the backup does not share waits beside it.** The
source and title are not enough on their own: adopting would take the folder's
series to the URL key with its chapters still addressed by the folder, and the
writer would add the backup's chapters beside them, every chapter twice. So a
plan that has chapters and matches none of the folder's (a series renumbered on
one side, or one whose Mihon has chapter metadata off, `Chapter 1` against
`Ch. 1`) is left as two series, the folder's and the backup's, and the folder's
waits until a backup names chapters it shares. A backup entry with no chapters
has nothing to prove and is still adopted by name. The pair is stable: a rescan
creates neither series again. Deleting one of a pair that stands apart never
trashes the other's files ([`DELETING.md`](DELETING.md)).

The same caution applies to a browsing record
([`READING-ONLINE.md`](READING-ONLINE.md)): a record is never the survivor, in
any of the three functions, because a record is off every shelf, count and
search and is forgotten 30 days after it was last opened. A folder whose only
match is a record therefore also waits, until ADD promotes the record; the
next scan then folds them. When this device's own backup names the manga and a
record already holds the URL key (`adoptFormer`), the record's data moves into
the folder's series instead, which keeps the library's row and id; the
record's row goes.

**Chapters are re-keyed by the same rule the matching above uses:** a URL in
ComicInfo's `Web` ending with the backup's chapter URL (Weeb Central), then
the chapter's number, which both sides build into the label (`Ch. 98`; Asura
adds a slug hash to its URLs, so only the number matches). A file that matches
neither is **kept** as an entry of its own, with its ComicInfo URL and its
file: adopting never drops one. The address a chapter leaves joins every one
it has left (`entry_former_urls`, migration 58), and the folder key joins the
series' former keys (`series_former_keys`; [`MOVE.md`](MOVE.md), "The move"),
so the device whose backup still doesn't name the manga, or whose download
still stands on its own, finds the same series on every scan instead of making
the folder's series again. A folder's plan also matches its chapters by their
file or their number, which is how a download that arrives after the two are
one attaches to the entry the backup already lists.

A device whose own backup doesn't know the manga yet plans the folder key
again, and finds the URL series by the key it left, until that device backs
up.

### A backup that names no source

The backup's own source list is where a URL series gets its `source:` tag,
and where a backup's plan learns the folder a download of it would sit in. A
backup with no entry for a source leaves both out: its series carries only the
source's number, in its key (`mihon:<number>:<url>`). `adoptNamed` asks for
the tag and `adoptFolder` for the folder, so neither alone could confirm such
a pair. An untagged URL series is therefore confirmed by a second signal
(`unnamedSourceIs`, `fold.ts`), in both functions:

- **the engine's own name for the number**, when tsundoku has that source
  installed (`engine_sources`): the folder is this source's when its source
  folder is that name, the rule "Matching downloads" uses. A name the engine
  gives that the folder is not is a no;
- otherwise **a chapter's own address under the exact title**: at least one
  chapter whose ComicInfo `Web` ends with the backup's chapter path (or the
  reverse). That is a source's own address for that chapter; tsundoku's own
  downloads always write it.

**A title and chapter numbers alone stay apart**, as a folder whose chapters
the backup does not share does: `Ch. 1` is in every source's copy of a manga,
so on a source nobody has named it is no evidence. Such a pair waits beside
each other until a backup names the source, or the engine installs it. A URL
series tagged with another source is never the folder's. No column is needed:
the number is in the key already, and the second signal reads what the library
holds. ComicInfo's `SourceMihon` is not the signal, because it is the folder's
side's name (it is where a folder's plan already takes its source from), and
the URL series keeps no copy of it to compare. `tests/devices-import-db.spec.ts`,
"a backup that names no source", builds the untagged backup first and pins all
three: by address, by the engine's name, and numbers alone staying apart, in
both orders.

## Rescanning

Idempotent: a second run over the same folder changes nothing
(`tests/import-db.spec.ts` proves it). On a rescan:

- **new** series and chapters are added;
- **files that arrived** are attached (`available = 1`, file, size, pages), and
  files that went away mark their chapter not downloaded;
- **read state only moves forward.** A chapter read in tsundoku is never unread
  by an older backup, and a newer `lastRead` moves `last_opened_at`;
- **what is edited here is left alone:** title, rating, favourite, hidden,
  shelves, tags, kind, direction. Only the path, and a status or description
  that is still empty, are refreshed;
- **history rows aren't duplicated**, since an event with the same entry, time
  and kind is written once;
- **each chapter's scanlator is recorded,** from the backup or the CBZ's
  `<Translator>`, and after every source is written, a chapter from two
  scanlators is collapsed to one ([`DUPLICATE-CHAPTERS.md`](DUPLICATE-CHAPTERS.md)).

The FINISHED band counts **visible series that arrived**, because it is shown
while reveal may be off. A rescan that brought no new series closes its own
band.

## Measured

A real backup (750 manga, 384 in the library, 42,618 chapters, 15,321
history rows) plus 26 downloaded chapters imports in about 2 seconds. Reading a
chapter costs two small reads (the zip's central directory, then
ComicInfo.xml), because Mihon stores pages uncompressed, so a large library on
disk is bound by the disk, not by the parsing. A first import of a real
library of 166 GB took about 35 seconds:

| Source  | Series | Entries | Files attached | Skipped                           |
| ------- | ------ | ------- | -------------- | --------------------------------- |
| Mihon   | 373    | 43,887  | 1,076          | 76 browsed only                   |
| Hentoid | 4,341  | 4,868   | 4,868          | 3 galleries on disk twice, merged |

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

Real backups and downloads are copyrighted and partly explicit, and are never
committed. The fixtures copy their shape, not their content.

## Limits

- **Mihon's books are never checked for duplicates.** Duplicate-book
  detection needs a cover hash, and only Hentoid's import has one
  ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)): galleries from Mihon sources
  have none.
- **CONTINUE counts every series with a chapter opened and one unread**,
  whatever shelf it is on, Dropped included.
- **ZIP64 archives** are reported as unreadable, not read. A chapter is nowhere
  near 4 GB.
- **Trackers** are read for one thing: a MyAnimeList tracker (tracker 1)
  links its series to the MAL entry, with its score for an unrated series'
  rating ([`LINKS.md`](LINKS.md)). A tracker's status and chapter aren't kept,
  and other trackers are skipped. Measured on a real phone's backup, 110
  series linked to MAL, all of which matched a series by URL; a debug build of
  Mihon wrote backups with no trackers at all.
