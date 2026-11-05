# The library screen

The screen tsundoku opens on, built from the "Index" design system (see
[`design/README.md`](design/README.md)) against `Index Library.dc.html`, all nine
states on all four devices, and the ten-foot layout on a TV ([`TV.md`](TV.md)).

Routes: `/` (the library, with `?shelf=`, `?tag=`, `?sort=`, `?dir=`), `/search?q=`, and
`/api/series/[id]` (what the long-press sheet reads).

## States, and what actually drives each

The mock draws each state from a `state` prop. The code has no such prop: every
state is the result of real data or real input.

| State            | What drives it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home             | Default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Long-press sheet | Pressing and holding a series tile for 450ms, or a right-click. A plain tap opens the series screen ([`SERIES.md`](SERIES.md)). Esc or the scrim closes it. A Work's tile has no long press and no sheet: a tap opens `/work/N` ([`WORKS.md`](WORKS.md), "`/work/N`"), and while selecting it toggles its parts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Search           | `/search`. Results follow the typing, 180ms behind it, by replacing the URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Multi-select     | SELECT in the header. Taps then toggle tiles (a Work tile selects its parts, [`WORKS.md`](WORKS.md)), and the bulk bar applies FAV, + SHELF, GROUP, REFRESH, HIDE or DELETE to the selection; TAG is drawn but disabled, since no tag editor is designed yet. GROUP opens the AS sheet for any selection ([`BOOKS.md`](BOOKS.md), [`WORKS.md`](WORKS.md)), except that two or three single books each in a language of its own get FOLD AS LANGUAGES in its place ([`EDITIONS.md`](EDITIONS.md)). HIDE and UNHIDE apply to the selection, except that a Work's part takes its Work whole: HIDE asks first, and HIDE ALL n hides the Work whole while TAKE OUT takes the part out of its Work and hides only it; UNHIDE shows the whole Work ([`WORKS.md`](WORKS.md), "The one rule"). UNHIDE takes HIDE's cell only when every selected tile is hidden, which needs reveal on. REFRESH asks every selected series' source once ([below](#refresh-a-selection)). |
| Person / tag     | `/?tag=namespace:value`, from a tag on the series screen or a chip. The person header replaces CONTINUE ([`BOOKS.md`](BOOKS.md)). A tag with nothing visible is a 404.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| History          | **N OPEN · HISTORY →** on CONTINUE, and a HISTORY row in the desktop sidebar, open [`HISTORY.md`](HISTORY.md)'s screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Rescan           | **RESCAN** in the desktop sidebar asks first (c525; see "RESCAN asks first"), or typing `/scan`. Starts the same import as START SCAN; a press while one runs joins it, without asking. With nothing to import, the sidebar says where it looked, under the row ([`IMPORT-MIHON.md`](IMPORT-MIHON.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Incognito        | Typing `/incognito`. A dashed INCOGNITO · NOTHING SAVED band with END, on every screen ([`PRIVACY.md`](PRIVACY.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Words            | Typing `/words`. The words looked up while reading Japanese, waiting for review ([`JAPANESE.md`](JAPANESE.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Duplicates band  | Pairs of books with alike covers to review, only those the viewer can see: **N POSSIBLE DUPLICATES · REVIEW →** ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Queue cell       | QUEUE over its count, a cell before SELECT, while chapters are queued; DOWNLOADS in the desktop sidebar's foot. Dimmed at its last count offline or when the engine isn't answering ([`DOWNLOADING.md`](DOWNLOADING.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Failures band    | Downloads that failed, as the duplicates band is drawn: **N DOWNLOADS FAILED**, the series, **REVIEW →** to the queue. Hidden series are never counted with reveal off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Links band       | Series AniList found, not for certain, to review, only those the viewer can see: **N SERIES TO LINK · REVIEW → · ✕**, below duplicates. Offline, its REVIEW cell dims ([`LINKS.md`](LINKS.md)). ✕ puts it away on this device until the queue really grows; reveal off and on is not growth (see "The links band").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| PEOPLE shelf     | `?shelf=people`. Exists while a favourite person has a visible book, and lists them as chips instead of a grid.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| FORM             | `?form=series`, `?form=oneoff`: FILTER's FORM row, SERIES · ONE-OFF, what a thing is shaped as. A one-off is a single doujin book; everything else is a series. They were shelves until c436, and `?shelf=series` and `?shelf=oneoff` answer 308 with the filter in their place ([`FILTERS.md`](FILTERS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FILTER           | The FILTER cell at the end of the KIND band on the phone, tablet and TV (the top bar on the desktop) narrows whichever shelf is showing: rating, FAV, FORM, language, date added, downloaded, and hidden while reveal is on. Favourites, rated and downloaded were shelves until c68; its KIND row went with c436, the band being that choice ([`FILTERS.md`](FILTERS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| KIND band        | `?kind=manga` and the rest of the registry's kinds: one row under the shelf tabs, over the grid, **KIND · ALL n · MANGA n · …**, narrowing whichever shelf shows (see "The KIND band"). The kind shelves, `?shelf=k:<kind>`, were in the sidebar until c436, and answer 308 to `?kind=<kind>` ([`KINDS.md`](KINDS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Reveal on        | Typing exactly `/reveal` in search and pressing Enter. A **session** cookie, so closing the app also ends it. HIDE AGAIN, or `/hide`, ends it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Empty            | No visible series and no scan job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Importing        | A `scan_jobs` row with no `finished_at`. Series the scanner found but hasn't indexed (`indexed_at IS NULL`) draw as dashed "indexing" tiles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Import finished  | The latest job, finished and not yet dismissed; never an older one behind it, so a rescan that brought nothing leaves no band, not the one before's. TIDY NEW dismisses it and opens the NEW shelf, which keeps what it had.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Offline          | `navigator.onLine` is false. What counts as cached is read from the `tsundoku-entries` Cache Storage bucket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Hidden means hidden

Enforced in SQL (`src/lib/server/library.ts`), not in the page. While reveal is
off, a series hidden directly or through a hidden root is not listed, counted,
searched, suggested or served by `/api/series/[id]` (which answers 404, the same
as a series that doesn't exist). A hidden root isn't even named as a shelf. So
while reveal is off, a hidden title never reaches the browser at all.
`tests/library-db.spec.ts` and `tests/library-flow.e2e.ts` both assert it.

**One book out of a hidden root.** A root hides everything in it (the Hentoid
import, Mihon's local folder). UNHIDE on a series in one, on its screen, its
sheet, or in the bulk bar when every selected tile is hidden, makes that series
**public**: shown while reveal is off, while the rest of the root stays hidden.
HIDE takes it back. Grouping keeps a series of books public only if every book
was. The rule is written once, in `src/lib/server/visibility.ts`, and every
query uses it.

The app's name (the wordmark, in the library header and the desktop sidebar)
is a link to the library. Inside the TV app with two or more servers, the
cell after it says whose library this is, `ON LIVING ROOM`, and OK on it
opens SERVERS (S1, c261; [`TV-APP.md`](TV-APP.md), "The bar's server cell");
the wordmark is then not an arrow stop, so ↑ from the library lands on that
cell.

## Rating

An integer 0–10 where **0 is unrated**, set with the blocky slider: five
blocks with halves, drag and let go, 0 on the left clears. While a series is
unrated no block is filled and the label reads UNRATED. On a tile, unrated
draws no track at all, and a rated series draws its filled bars (a half is the
left half of one) plus the rest of the track. The whole account, from the
scale to the catalogues, is [`RATINGS.md`](RATINGS.md).

The library handoff drew a seventh `—` cell to keep a deliberate 0 apart from
unrated. That distinction is gone, and so is the cell.

## On the tile

FAV and the rating are edited on the cover itself, without the long-press
sheet (the owner's ask, 2026-09-23):

- **FAV:** the cover's top-right corner is a 44px toggle. One tap favourites or
  unfavourites, with no dialog. A favourite shows the usual FAV badge there; a
  series that isn't one shows a faint ☆ in the same place, so there is
  something to aim at.
- **Rating:** a tap on the rating bars lays a compact slider over the foot of
  the tile. Letting go saves and closes; a tap anywhere else, or Esc, closes
  without choosing.

Neither opens the series. Both show the change at once and put the old value
back if the write fails; they use the same `favourite` and `rate` actions as
the sheet. They're gone while selecting (every tap is a pick then) and while
offline (writes need the workstation). `CoverTile` takes them as `onfavourite`
and `onrate`; without those it draws the plain badge and bars.

## Works

A **Work** is a level above series that merges nothing: a name, an order the
owner sets, and up to one Work per series ([`WORKS.md`](WORKS.md)). The
library follows one rule: **browsing shows the run, finding shows the
series**.

- **ALL, a shelf, NEW, a collection, FAV** draw a Work once: one tile, with
  the cover of its part that is on that shelf (CONTINUE's part on ALL), the
  `WORK · N` badge, its name, and a foot of one segment per part with
  `PART 2 OF 3` or `UP NEXT · PART 2` where a series draws rating bars. `+N`
  sums the parts' new chapters and `↓` the parts' cached chapters; FAV shows
  when any part is. A Work is on a shelf, or under a kind of the KIND band,
  when any of its series is, and its cover is the part that is there -- a
  Work of a manga and its anime is one tile under MANGA and under ANIME, and
  the band counts it once in each, and once in ALL (`kindCounts`).
- **Search, a tag filter and a person's page** find series, so a Work opens:
  each matching series is its own tile with `PART 2 · <WORK>` in its foot. A
  search that matches the Work's own name shows the Work first, then its
  parts. A person's page foot says the same, and above its grid one row per
  Work with a series there (W4, `worksOnTagPage`; doc/WORKS.md). The part
  number is the part's place in its Work, counted, never the raw position a
  take-out leaves sparse.
- **CONTINUE** is one row per Work, never one per part: `WORK · PART 2 ·
<part> · CH. 15`, and between parts `UP NEXT` in inverse pointing at the
  next part's first chapter, with ▶ in accent. A Work whose part 1 is read
  through stays in CONTINUE for part 2. Its `total` counts rows, so the
  section's `N OPEN` counts Works. The open-series cards are read once -- the
  card query carries no LIMIT and `withEditions` runs over every open series
  -- and the rows are then sorted and sliced to `limit` before `entryLine` and
  `resumeEntry` run, the two prepared reads per row, so the series arm hydrates
  every open series but reads entry lines only for the four rows it shows (8 ms
  at 816 open series). The Work arm is decided before it is read (c332): one
  grouped query gives each Work with an opened visible part its sort key (its
  most recent part's last open) and whether any visible part is unfinished
  (no counted chapter, or one unread: `isFinished`'s own facts), which is
  exactly when `continuePart` has a part to open. Works are sorted and sliced
  with the series on those keys, `total` counts every row, and only the Works
  the section shows have their parts read (`partsOfWorks`, `workRecords` and
  the cards of the parts they open, one grouped pass each). Measured at 1,000
  Works of two open parts each under a load average of about 50: 632 ms
  before, 167 ms after, the rest being the open-series card query, which
  carries a Work's parts too and drops them. `tests/works-library-db.spec.ts`
  pins the rows, order and count.
- **Sorts** place a Work by its most recent part: its latest read, its
  newest chapter, its latest added; TITLE by the Work's name. The unit
  query aggregates over every part, so a Work sits where the part you would
  open sits.
- **Counts count tiles**: `countTiles`, `countListed`, `listShelves` and the
  `44 OF 188` line all count a Work as one. A Work of three parts is one of
  each.
- **Hidden**: a Work is hidden or shown whole (W1's `workPage`). With reveal
  off it is absent from lists, counts and search; with reveal on it is one
  tile carrying HIDDEN in `--reveal`. A Work whose parts diverged after
  grouping reads as the parts the viewer may see; W4's HIDE settles it.
- **SELECT** on a Work tile selects its parts, because every bulk action acts
  on series.

The three reads behind a page are independent of the tiles' number: the
units, the cards of the parts drawn, and every part of every Work on the
page (`listTiles`, `cardsOf`, `partsOfWorks` in `src/lib/server/library.ts`).

## New chapters

A tile's `+N` counts entries that **arrived after the series was last opened**:
listed by the source since then (`added_at`), or downloaded since then and
still unread (`arrived_at`). It is not the unread count. Drawing has 18 unread and 3 new. On
its own tile, a series never opened has no "new", only unread; a never-opened
part of a Work is read against the Work's last open instead
([`WORKS.md`](WORKS.md), THE RUN).

## The NEW shelf

What arrived, until it's opened or two weeks pass (the owner, 2026-10-04):

- **Arrived** is tsundoku's own clock, `series.arrived_at` and
  `entries.arrived_at` (rung 34): the import that created the series, or the
  latest import that brought a file for one of its chapters still unread. The source's dates
  can't say it. Mihon dates a chapter by when its source listed it
  (`added_at`), so the Suwayomi chapters downloaded on 2026-10-04 were dated
  as far back as 2023.
- **It leaves** once any of its chapters is opened after it arrived (here or,
  through a backup, on a device), or `NEW_DAYS` (14) after it arrived. A new
  chapter brings it back.
- **It isn't tied to an import.** NEW used to be "the series the import the
  band is about created", which lost things two ways. Each import that
  created a series replaced the last one's, and TIDY NEW dismissed the band,
  then opened a NEW shelf that had nothing left to follow. A series that
  only got new chapters never showed at all. Now the band is just the band:
  TIDY NEW closes it and opens NEW, which keeps what it had.
- **The shelf is listed** while an import runs or while anything is on it.
  It opens sorted NEWEST, which on NEW means newest arrival first; RECENT
  would sort by an open that, on NEW, hasn't happened since. A sort picked
  by hand still wins. Tested in `tests/library-sort-db.spec.ts`.

The rule is `NEW_SQL` in `src/lib/server/library.ts`; the writer stamps
arrivals in `src/lib/server/import/write.ts`. Tested in
`tests/library-db.spec.ts` ("the NEW shelf"), `tests/arrivals-db.spec.ts` and
`tests/migrations-db.spec.ts` (rung 34).

Chapters already in the library on 2026-10-04 had no arrival, and rung 34
can't know one. It first dated each series by the import that made it, which
put about 6,800 series on NEW: the first import (2026-09-23) made nearly the
whole library inside the fortnight. Rung 35 took that back. Instead, a
one-off pass gave the 17,403 chapters then on disk their file's mtime (when
the device downloaded it, which Syncthing keeps) and each series its newest.
That left 134 series on NEW (22 visible without reveal), led by that
morning's Suwayomi downloads.

**An arrival already read isn't new** (rung 36). Suwayomi downloads again
chapters the tablet had and the owner read. Dated by their files, 1,025 read
chapters had put their series back on NEW and on the `+N` badge. So a
series arrives only with a chapter that is still unread, rung 36 redated the
existing ones by their newest unread arrival, and `+N` counts a downloaded
chapter only while it's unread.

## REFRESH a selection

The bulk bar's REFRESH cell (card c221) is the series screen's REFRESH over
many series at once: it asks each selected series' source what it lists now,
through the same `refreshSeries` (`src/lib/server/refresh.ts`), and **downloads
nothing** — FOLLOW stays the only thing that queues ([`DOWNLOADING.md`](DOWNLOADING.md),
"REFRESH"). It works on the library and on a tag or person page, which share
the bar.

- **A few dozen a run.** One run asks `REFRESH_BATCH` (24) series, in the order
  the selection was made. A larger selection is not refused: the band above the
  bar says how many were **not asked** and offers **ASK N MORE**, which sends
  the rest as another run. That keeps one request minutes-short even when a
  source is slow.
- **The band is the library's**, pinned over the bar that asked. Its title says
  how many were asked and how many found something ("12 ASKED · 3 FOUND
  SOMETHING"); its detail names the sources that **failed** (the first three,
  then "…" — a source that is down fails the whole run), then how many were
  skipped, then how many are left. Failures are named, not explained: open the
  series and REFRESH it alone for the message.
- **A source that doesn't answer doesn't stop the run.** Each series is asked on
  its own, and one that throws or misses `REFRESH_TIMEOUT_MS` (30 s) is that
  run's failure; the rest still run. A call abandoned at its deadline may still
  write what it found afterwards, which is the same entries a second REFRESH
  would make.
- **No source, no ask.** A Henga book, a Mihon import found on disk, an EPUB: it
  is skipped and counted as skipped, not refused.
- **Hidden means hidden here too.** The selection is filtered in SQL
  (`libraryWhere`), so with reveal off a hidden series is never asked, even if
  a form sent its id.
- The words are messages (`library_refresh*`, [`I18N.md`](I18N.md)); the band
  appears only while the selection is still open, and the next run replaces it.

`tests/refresh-batch-db.spec.ts` covers the batch itself (skip, failure,
deadline, bound, hidden), and `tests/downloads-flow.e2e.ts` drives the cell
against a fake engine.

## Speed

Every card needs its entry, read and new counts, and the default sort needs
each series' last-opened time. These used to be correlated subqueries, one set
per series. SQLite re-ran the "new since last opened" MAX for every entry row,
so a 1,429-chapter web novel alone cost about two million reads. The real
library's ALL shelf took 1.9 s on the workstation.

`cardQuery` (`src/lib/server/library.ts`) now works in one pass:

1. it picks the series first;
2. it groups their entries once for the counts and the last-opened time;
3. it counts what's new against that.

The steps are `MATERIALIZED`, so SQLite can't flatten them back into the slow
shape. The counts are read from a covering index, `entries_card` (rung 12).

Measured on the real library (6,872 series, 257 visible; 2026-09-23), same
rows before and after:

| Query     | Before   | After |
| --------- | -------- | ----- |
| ALL shelf | 1,920 ms | 18 ms |
| CONTINUE  | 222 ms   | 22 ms |
| Search    | 272 ms   | 57 ms |
| NEW shelf | 379 ms   | 6 ms  |

## Pages

The grid arrives a page of 120 tiles at a time (`GRID_PAGE`,
`src/lib/library/paging.ts`), because the real library's ALL shelf, with reveal
on, is 6,800 series. The whole shelf in one answer made the first load drag, and
a silent 5,000-card cap left the last 1,800 off the grid entirely. The cap is
gone.

A page is a page of **tiles**, not of series: a Work is one tile, and the
offset counts tiles, so page two carries on where page one stopped even when a
Work's parts sit across the boundary (`doc/WORKS.md`).

- **The first page** comes with the screen, with the shelf's `total`
  (`countListed`).
- **The rest** comes from `GET /api/library?shelf&tag&sort&offset&limit`. It
  answers the same units the first page does -- `listTiles`, one row per Work,
  one per series in no Work -- and takes the same `offset` in tiles. It's
  asked for when the end of the grid comes within one and a half screens
  (an `IntersectionObserver` on the row below the grid). After each page the
  reader checks again, since on a tall screen a page may not push the end out
  of reach.
- **The row below the grid** reads `240 OF 6,812`, then LOADING while a page
  is on its way. A page that fails says `THE REST DID NOT LOAD` with RETRY.
  Offline, it says `THE REST NEEDS THE WORKSTATION`.
- **A re-read of the same shelf** (a rating saved, a scan in progress) re-reads
  every loaded page after the first as well, in one request, so a tile deep in
  the grid shows the server's value. A new shelf, tag or sort starts again from
  its first page. A request answered after the list changed is dropped.
- **SELECT ALL** means the whole shelf, tiles and all. The ids of pages not yet
  loaded come from `/api/library?ids`, without their cards, and a Work's every
  part is among them even when a kind, collection, NEW or FAV shelf picked only
  one -- a bulk HIDE must hide the run whole (`tileIds`, `doc/WORKS.md`).
- **Back** (the gesture, or the browser's) comes back to the pages and the place
  it left. A SvelteKit snapshot keeps the loaded cards (up to 4,000) and the
  scroll, and sets the scroll again once they're back, since SvelteKit scrolls
  before it restores. It then re-reads them, in case a rating changed on the
  series screen.
- **The shelf can move under the pages** (a series hidden, volumes grouped,
  a scan's arrivals). Pages are by position, so a page can repeat a card
  already shown, which is dropped (a repeated key would stop the grid
  drawing). A page shorter than asked for is the end, whatever `total` said.
- **The grid never stalls with its end on screen.** The observer only speaks
  when the end comes near, so whenever the list settles (a page in, a refresh,
  a page dropped because the list changed under it) the grid checks again.
- **The place to come back to is noted when a navigation begins**
  (`beforeNavigate`). By the time SvelteKit takes the snapshot, the waiting
  outline may already cover the library, with its scroll at 0. Coming back,
  the scroll is set each frame until it lands, for up to two seconds, or
  until the reader touches or scrolls.
- **CACHED** isn't paged. Only the tablet knows which series it holds, so the
  server sends the whole shelf for it to narrow down.
- **Sorts page cleanly** because every order ends in the series id, so no card
  appears on two pages or on none.
- **Hidden means hidden** here as on the screen: the endpoint reads the reveal
  cookie as the screen does.

The end-to-end tests shrink the page with a `tsundoku_grid_page` cookie
(`pageSizeOf`), so the seed's twenty-odd series make several pages. Nothing
else sets it.

## Sort and direction

Asked for on 2026-10-14: the sort was a label that cycled, so reaching one
meant tapping through the others, and nothing ran the other way round.

- **SORT is the house's own menu** (`ChoiceMenu`,
  `src/lib/components/controls/`; c432, asked for on 2026-11-03: "the
  recently added select should be stylized blocky like the filters are").
  A cell in the label's own type names the sort, with ▾; it opens a column
  of FILTER's blocky cells (52px, 14px mono, the full-ink rule on top, the
  one in use inverted): RECENTLY READ, RECENTLY ADDED, PROGRESS, TITLE,
  RATING, RANDOM (`SORTS`, `src/lib/library/labels.ts`). Choosing one goes
  to its URL. The list hangs from the whole SORT block, ↓ / ↑ included,
  right edges together. Escape, a tap anywhere outside (which opens nothing
  under it) or the cell again close it without choosing. On a TV or a
  keyboard the open list is a focus scope ([`FOCUS.md`](FOCUS.md)): OK opens
  it on the sort in use, the arrows walk the choices and stay inside, OK
  picks, BACK closes, and the mark goes back to the cell. The remote reaches
  the cell from the shelf tabs with ↑. Until c432 it was a native `<select>`,
  whose open list was the system's own and whose ←/→ changed the sort in
  place on a TV. A sort that takes past 1 s puts the grid in outline, and
  the label says LOADING where SORT and ↓ / ↑ were, taking the focused cell
  with it: the page notes which of the two had the mark and gives it back
  when SORT is drawn again, unless the mark has gone somewhere else in
  between (wave 24; before it the mark was left on nothing, red 4 in 10 in
  loaded runs). `tests/library-top-sort.e2e.ts` and
  `tests/tv-library-top.e2e.ts`, which holds a sort's data 2.5 s to put the
  outline up on purpose.
- **PROGRESS** (`sort=progress`) is three tiers, as `progressOf` decides
  them: begun and not finished (one page opened is begun), by last read;
  then never opened, newest added first; then the rest, the finished, by
  last read. It's "last read > newest > all", asked for on 2026-10-14 so the
  series opened a page or two don't sink among the finished. ↓ has the begun
  on top; ↑ sends them to the bottom (never opened, then finished, then
  begun). Unlike the other sorts, ↑ doesn't reverse inside a tier: the most
  recent stays first. `progressTier`, `src/lib/server/library.ts`.
- **The toggle beside it turns the order round** (`?dir=asc|desc`). It reads
  A–Z / Z–A beside TITLE and ↓ / ↑ beside the rest, ↓ being high to low:
  most recent, newest, best first. Each sort has its own direction (TITLE
  ascending, the rest descending), and `?dir=` is in the URL only while it's
  turned from that, so old links mean what they did. Choosing another sort
  drops it. RANDOM has no direction and no toggle.
- **RECENTLY READ counts a series never opened as read when it was added**
  (c524, asked for on 2026-11-04: "when a new entry gets added to the
  library it gets last_read = now()?"). The key is
  `COALESCE(last read, added_at)`, PROGRESS's own, so a series a scan or ADD
  just brought sits at the top of the default sort, above everything read
  before it came and below anything read since. **The sort only, never the
  data**: no reading is written, so CONTINUE, HISTORY, the reading time, the
  reading log and tracking never see a read that didn't happen. Turned round
  it's the exact mirror, the longest untouched first, adding being the
  touch: a new add sits near the end, and a series added long ago and never
  opened sits among the oldest reads, no longer in a block of its own at the
  end (until c524 the never-read were kept last both ways). What `added_at`
  holds decides where a big import lands (the scan case asserted in
  `tests/library-sort-db.spec.ts`): a scan stamps a series it finds with no
  backup behind it (a Mihon download folder alone, an anime folder, a
  novel's backup) with the scan's time, so a first scan of a big folder puts
  all of it on top, the last found first, until something is read; an
  EPUB keeps its file's modified time; a Mihon backup's series keep the
  backup's `dateAdded` (or their first chapter's fetch, or the scan's time
  when the backup has neither) and land where they were added in Mihon; ADD
  from BROWSE stamps the moment of the add. A
  Work's key is the most recent of its parts' keys, so a part just added
  lifts its Work too. RATING's ties stay A–Z either way. Every order still ends in the id, so
  pages stay clean in both directions (`ORDER`, `src/lib/server/library.ts`).
- **On NEW**, RECENTLY ADDED is newest arrival, and turned round, oldest.
- **A Work** sorts by its most recent part under every order (see "Works"):
  RECENTLY READ by the part read last (or, never opened, added), RECENTLY
  ADDED by the part added last,
  TITLE by the Work's name, RATING by the rated parts' average, PROGRESS over
  the parts' totals.

## Random

The sort is a menu (see "Sort and direction"), and its last choice is
**RANDOM**, a shuffle kept in the URL (`sort=random&seed=…`):

- the database orders by a hash of the series id and the seed
  (`randomOrder`, `src/lib/server/library.ts`), so one seed is one fixed order.
  Pages never repeat a card, a reload shows the same order, and going back
  finds it again;
- choosing RANDOM again (from another sort) picks a new seed, a new
  shuffle;
- another tab keeps the shuffle; leaving RANDOM drops the seed.

The seed only ever reaches SQL as an integer (`parseSeed`). Going back to a
screen as it was left is [`NAVIGATION.md`](NAVIGATION.md).

## The top bar

**One hairline between every pair of cells** (c431, asked for on 2026-11-03:
FILTER and SELECT sat side by side with nothing between them on the
desktop). The right-hand group draws the first rule, on its left (`TopBar`);
every cell before SELECT draws the one after it, on its right: BROWSE,
QUEUE and the desktop's FILTER (`.filter-desk`, whose summary drops its own
left rule there). MORE draws its own, on its left, so the rule goes with it
where MORE is hidden (the desktop). Until then QUEUE and FILTER drew a left
rule, which doubled the group's into 2px and left nothing against SELECT.
`tests/library-top-bar.e2e.ts` walks every cell drawn on each device and
wants exactly 1px at each boundary, FILTER open and closed.

### It stays

The bar with the name, `/ search` and SELECT (and the selection bar that
replaces it) is sticky on every device: it stays at the top while the grid
scrolls under it, opaque, at z-index 8 (over the tiles, under the bulk bar and
sheets). The owner asked for it on a phone and the tablet on 2026-09-23
(`TopBar`'s `sticky`), and on the desktop too on 2026-11-03 (c433: "the
searchbar navbar should be sticky"). `TopBar` itself still lets a desktop's
bar go, since its sidebar stays; the library pins its own there
(`.library > header.bar.sticky`, a desktop-only rule in `+page.svelte`), so
the other screens that use `TopBar` are as they were. The window is what
scrolls on every device (the sidebar is pinned beside it, not a scrolling
container around it), so nothing above the bar defeats `position: sticky`.
On a TV the bar is pinned too, and the KIND band pins over it once the grid
has scrolled up to it (c436; the shelf tabs did from c238 until then): the
TV's search is the bar at the top.

### BACK TO TOP

A screen down the grid (`scrollY` past one `innerHeight`), a **BACK TO TOP ↑**
cell appears in the bottom-right corner (c433): 52px, ruled on its two inner
sides, opaque, over the tiles at the bar's z-index, never a floating circle.
A tap scrolls to the top, smoothly, or at once under reduced motion; focus
moves up to the bar first, since the cell goes as the page passes a screen.
It hides again within a screen of the top, while selecting, where the
bulk bar has that corner, and while FILTER's panel or SORT's list is open,
whose scrim it would otherwise be drawn lit above (both live in a pinned
bar's stacking context; the page reads their `<details open>` and
`aria-expanded`). **Each FILTER counts only where it is drawn** (c474): the
top bar's inside the desktop's media query (`min-width: 1024px` and a fine
pointer), the KIND band's inside its opposite (`max-width: 1023px`, or a
coarse pointer, or none), a person's page's everywhere. A `<details>` that
CSS has hidden stays open, so until then a FILTER left open at 1200px and
the window narrowed to 900px hid the cell for good;
`tests/library-top-scroll.e2e.ts` opens each, resizes past it, and sees the
cell. The page keeps 53px under its last row (plus the
phone's safe area) so the cell never sits on the last tiles. A TV, which
draws no cell, keeps its own safe margin there instead (`--safe-y`, 28px at
960x540; the TV block's c238 rule, restated beside the 53px one because that
one outranks it).

**Not on a TV**, measured on 2026-11-03 (`tests/tv-library-top.e2e.ts`): one
BACK from the bottom of the grid (`scrollY` 729 at 960x540) lands on the first
CONTINUE card at `scrollY` 0, because the climb goes to the screen's start
when what it climbs to is already in sight ([`TV.md`](TV.md)). That is the
pinned KIND band's chosen cell since c436 (`data-back-climb=".kinds .kc.on"`
on the grid); it was the pinned shelf tab before, and pointing at the tab,
no longer pinned, would cost a BACK to land on it far up the page. A corner
cell would only be one more stop for the pad.

**The first row's mark on a TV.** The focus layer brings a focused tile clear
of the pinned bars by its button's edge, and the cover's ring is drawn 7px
outside the cover, which is that edge: coming back up the grid, the focus
line covered the ring by 6.9px. On a TV the tile's button reaches 7px up into
the tile's own 10px padding, so the ring comes clear with it; nothing drawn
moves.

## The links band

**N SERIES TO LINK** has a ✕ after REVIEW → (c430, asked for on 2026-11-03:
"we need a dismiss button for the 'x series to link' band too"). A plain cell,
ruled on its left, not a second accent action. Put away, it stays away until
the count **grows** past the count it was put away at: a new series to link
brings it back, the same ones again do not. When the queue shrinks meanwhile
(series reviewed, linked, or settled), the count it waits on follows it down,
so the next new one is news again: put away at 46, reviewed down to 36, back
at 37.

**Reveal is not news** (c430's second half). With reveal on the band counts
hidden series too, so the count it shows moves when reveal does: off drops
it by the hidden ones, on raises it back. Until then one number was kept, the
shown one, and it followed the queue down, so reveal off lowered it and
reveal on was "growth" and brought the band back with nothing new. Two counts
are kept now: `pub`, the queue without hidden series, which is the same with
reveal on or off (the page's `toLinkPublic`; with reveal off it is simply
`toLink`, so nothing hidden is ever counted then), and `all`, the queue with
them, known only if it was put away with reveal on and lowered only with
reveal on. The band comes back when `pub` grows, or, with reveal on, when
`all` does. A wave 19 value (a bare number) reads as `pub`. Put away with
reveal off, a new **hidden** series to link does not bring it back with
reveal on: `all` was never known; the TO LINK row counts it.

The ✕'s name is "Put away the series to link until the count grows". Not
"until there are more": a name that holds the word MORE is a second answer to
the bar's MORE, for a screen reader's or voice control's "MORE" as much as
for a test's `getByRole('button', { name: 'MORE' })`.

**Per device, not on the workstation**: kept in this device's `localStorage`
(`tsundoku.library.links-put-away`, `{ pub, all }`). Why, and what it costs,
is [`LINKS.md`](LINKS.md)'s, "Putting the band away".

**Where the review is reached once it is away**: **TO LINK** with its count,
in the desktop sidebar's foot (after GET STARTED, before HISTORY) and in MORE
(the same place) on the tablet, the phone and the TV, for as long as anything
waits (c475); a series' FIND (`/links?series=`); SETTINGS' Ranobe line while
it has choices waiting; and the band again when one more arrives. The row's
count is the band's own sum (`linkQueueCount(reveal) + ranobeQueueCount()`,
now also in the root layout's load, about a millisecond on the seed), so the
two never disagree and a hidden series is not counted with reveal off.

It says **TO LINK**, the review's own short heading, not SERIES TO LINK as
c475's card wrote it: `links-flow.e2e.ts` finds the band as the first thing on
the page reading SERIES TO LINK, and the sidebar comes before the band even
where it is hidden. `tests/links-door.e2e.ts` puts the band away and reaches
the review from the sidebar (desktop) and MORE (phone), on its own seeded
database, then empties the queue through the review's own NONE OF THESE and
SEARCH AGAIN and finds no row; `tests/tv-servers.e2e.ts` walks to MORE's row
with the remote's keys. On a TV the sidebar is not drawn (it is the desktop's,
a fine pointer at 1024 px or more), so MORE's row is the TV's door.
`tests/library-top-scroll.e2e.ts` puts it away, reloads, adds a series to
link and sees it back, on its own seeded database.

## The KIND band

Asked for on 2026-11-03 (c436): "the shelves menu could be split too, like,
it has kinds and shelves below, that sidebar could have shelves only and then
a band to select kinds on the library itself?" Designed in
`doc/handoffs/kinds-band/` (brief: `doc/briefs/LIBRARY-KINDS.md`), built
2026-11-04, with the design tools (extract, reconcile, pin).

- **The sidebar and the tabs hold shelves only**: NEW (while anything is),
  ALL, the owner's collections in their order, + NEW SHELF, PEOPLE, then a
  hidden root while reveal is on. SERIES, ONE-OFF, MANGA, MANHWA, NOVELS and
  ANIME are gone from both (`listShelves`). IDR, TO READ, DROPPED and any
  collection stay shelves, whatever they hold: they are the owner's.
- **One row under the shelf tabs, directly over the grid**: `KIND`, then
  **ALL n**, then each kind on this shelf in the registry's order (`KINDS`):
  MANGA, MANHWA, DOUJINS, NOVELS, ANIME, and a new kind by being in
  `KIND_FACTS` (its word is the `nav_shelf_*` plural, in `KIND_WORD`, which the
  compiler makes a new kind fill). It narrows whichever shelf shows: TO READ,
  ANIME is two taps. The chosen cell is inverted, so a shelf and a kind show
  as two inverted cells, one above the other. 40px, cells `0 10px` on a phone
  and `0 14px` above 600px, 13px mono, the count at 0.6; the `KIND` label in
  12px `text-2`, which the phone drops for room. On the desktop it sits under
  `02 — <SHELF>`, ruled above too, and has no FILTER: that stays in the top
  bar. `tests/library-kinds-frame.e2e.ts` pins Board 3A's measurements
  (generated by `gen-conformance` from `Tablet.dc.html`).
- **Each cell counts this shelf with every other filter applied**, in one
  grouped read (`kindCounts`, `src/lib/server/library.ts`): a Work counts once
  under each kind it has a part of, and once in ALL, so ALL is what the grid
  shows and not the sum. The active tab says `23 OF 64` while a kind narrows
  it, and the section label names it first: `02 — TO READ · ANIME · RATED 4+`.
- **It writes `?kind=`**, the parameter FILTER's KIND row wrote, so old links
  still land; FILTER's KIND row is gone from the library (a person's page,
  which has no band, keeps it), and FILTER's badge no longer counts a kind,
  nor does its CLEAR ALL clear one: the band holds it. **The kind is
  remembered across shelves** because `shelfHref` carries every filter
  parameter; ALL clears it; it is in the URL, never a setting, so the
  wordmark and a fresh launch start at ALL. **One kind at a time**: a tap
  chooses, as a tab does.
- **A kind not on this shelf is gone**, except the one chosen: moved to a
  shelf with none of it, it stays, drawn at 0, dimmed (0.4) and still
  inverted, and the grid says `No anime on Dropped.` / `The shelf holds 31.`
  with **✕ ALL KINDS · SHOW 31**. Unlike a language, a kind the shelf doesn't
  hold is no longer dropped from the URL. With other filters on as well, the
  grid's line is FILTER's own, "Nothing on X matches these filters". With one
  kind or none to tell apart the band is ALL n alone (and FILTER), the same
  height, so the grid doesn't jump between shelves. LANGUAGE offers what the
  shelf holds of the chosen kind, as it did of a kind shelf: MANHWA offers
  none, so choosing it drops JA.
- **SERIES and ONE-OFF are FILTER's FORM row**: ANY · SERIES · ONE-OFF
  (`?form=`), about shape, not kind (see [`FILTERS.md`](FILTERS.md)).
- **Old links answer 308** with the filter in the shelf's place, beside
  FAVOURITES and the rest (`legacyShelf`): `?shelf=k:anime` is
  `?shelf=all&kind=anime`, `?shelf=series` is `?shelf=all&form=series`, any
  other parameter kept. A kind is any the registry names, so `k:doujin`,
  never a shelf (it fell back to ALL), now lands on doujins. `listSeries`
  still reads an old key as its filter, for a page asked for by a tab loaded
  before the change.
- **On the phone it scrolls sideways**, never wraps or collapses; FILTER is
  pinned at its right end, the cells scrolling under it, and a cell cut off at
  the edge is the cue. The chosen cell is kept in view, as the tabs keep
  theirs. The grid moves down 40px against the old phone.
- **It pins; the tabs don't.** As the grid scrolls the band stops under the
  top bar (`top: var(--header-h)`, z 7, the bar is 8) and gains a first cell,
  the shelf's name with ▴ (`TO READ ▴`), which scrolls back to the tabs and
  puts the mark on the shelf showing (on the desktop, back to the band's own
  place). Pinned is measured, not guessed: a marker just above the band, and
  the band held apart from it. So the pinned chrome is 60 + 40px on a phone.
- **An open SORT list is drawn over it** (c590, the owner's screenshot of
  2026-11-05: the band cut a strip out of the list under RECENTLY READ). The
  list is 7 and the band 7 (9 on a TV) in one stacking context, and the band
  comes later in the page, so it won the tie. While the list is open the
  band steps down to 6, still over the grid (whose highest layer is 3) and
  under the list; the list stays under the top bar (8), so scrolled up under
  it the list goes under the bar, and a sheet from the bar (20) is over both.
  Closed, the band is at 7 again. FILTER's panel needed nothing: it hangs
  inside the band's own layer on a phone, tablet and TV, and inside the top
  bar's on the desktop. `tests/library-top-scroll.e2e.ts` asks
  `elementFromPoint` at the centre of every choice and every FILTER cell, at
  the top and pinned, on all four devices; `tests/tv-library-top.e2e.ts` at
  each choice the remote walks.
- **A kind chosen while it is pinned opens at its start.** The cells keep the
  scroll (`data-sveltekit-noscroll`), so choosing from the band at its own
  place never jumps the page. Pinned, that would open the new kind partway
  down its list (or clamped at the bottom of a short one), so once the
  navigation has drawn the grid the page goes, instantly, to the band's own
  place: the band under the top bar, the grid's first row directly under it,
  the tabs just above the window. The measure is the one `TO READ ▴` uses on
  the desktop (`placeUnderBar`), taken again each frame until a slow load's
  outline has gone (`settleScroll`, two seconds at most, given up at the
  reader's own touch, wheel or key). Focus stays on the chosen cell
  (`data-sveltekit-keepfocus`), and ↓ from any cell goes to the first tile
  (`data-focus-down` on the strip), not the one under the cell. **Without
  script** the cells are plain links and a full load starts at the top, which
  shows the tabs, the band and the first row.
- **On a TV** it is a 56px focus row of its own under the tabs, inside the
  safe margin. **← → move focus only**: each cell is a link, so the grid
  doesn't change until **OK**, which chooses (and keeps focus on the cell).
  The focus line under it says what OK will do: `ANIME · 23 ON TO READ` and
  `OK SHOWS THEM · THE GRID WAITS` (its key hints still read OK OPEN). ↓ goes
  into the grid; the band then pins at the top in the tabs' place (until
  c436 the tabs pinned), `TO READ ▴` first, so the pinned rows are still 56 +
  64px; OK on that cell brings the tabs back with the mark on the shelf.
  BACK from the grid climbs to the band's chosen cell, which is in view, so it
  goes on to the screen's start, as it did with the pinned tab.
  `tests/tv-library-kinds.e2e.ts`.
- **What stacks above the grid** is unchanged in order: the status bands
  (SCANNING, failed downloads, duplicates, SERIES TO LINK), CONTINUE, the
  section label, the tabs, then the band, and nothing between the band and
  the grid. The waiting outline draws the band's row too (`WaitingScreen`),
  and a band tap outlines the grid from 1 s as a tab does.

### Where it departs from the handoff

- **FILTER's cell keeps its own vertical rhythm and focus mark** (a
  `<details>` summary, 39px under the band's hairline, marked inside on a TV),
  rather than the mock's `<button>`.
- **The pinned shelf cell is a button**, not the mock's link: it scrolls, it
  goes nowhere.
- **The TV's ↑ from the grid's first row** goes where the focus layer's
  geometry sends it (the top bar, under the pinned band), not to the band;
  the pinned band is reached by BACK's climb or the keys along it. This was
  so with the pinned tabs too (wave 19's suggestion), and the layer is not the
  library's.
- **The focus line's key hints** read OK OPEN on a band cell, as on a tile:
  `FocusLine` draws its hints for every stop, and is not the library's.

### What it does not do yet

- **Several kinds at once** (MANGA and MANHWA, the comic family): one at a
  time, as the design answers; `?kind=` reads a single kind.
- **MOVIES and SHOWS**: not kinds yet; each gets a cell by joining the
  registry.

## RESCAN asks first

Asked for on 2026-11-04 (c525): "rescan needs a confirmation modal, blocky
like the app". **RESCAN** in the desktop sidebar opens the house's
ConfirmSheet, `RESCAN THE LIBRARY FOLDER?`, saying what will happen: it reads
the library folder on the workstation again, new series appear on NEW as they
are found, nothing is removed, and roughly how long the last scan took when
one has finished (`lastScanTook`: the newest finished job that isn't a
backup's import). **CANCEL** and **RESCAN**, CANCEL where the sheet opens, so
OK or Enter at once is the safe answer; Esc and the scrim cancel too. The
sheet posts the same `?/scan` the sidebar's form did, and its answer is taken
as before: the note under the row (`rescanNote`, the same lifetime, SCAN_WAITS
included), then the library. **A scan already running is joined at once**,
without the question: there is nothing new to agree to. **Without script** the
sidebar's form is the plain form it was, and posts. `tests/rescan-confirm.e2e.ts`
(its own seeded database, since one case stages a running scan) and
`tests/library-layout.e2e.ts`.

**Every door that starts a scan**, listed with
`rg -n 'action="/?\?/scan"|startScan\(|runQueued\(' src` (11 lines: 9 sites
past the two definitions, the scan action itself one of them, the sheet's
own form another):

- **Asks:** the sidebar's RESCAN (`+layout.svelte`), the only door one stray
  tap reaches.
- **Doesn't ask, as the card says:** START SCAN on the empty library
  (`StartFirstDay`) and GET STARTED's scan step (`StartList`): there, scanning
  is what the screen is for.
- **Doesn't ask, and why:** typing `/scan` in search (a typed command is its
  own question), `POST /api/scan` (the sync timer's, a script's door, no
  screen), and the scans that follow on their own (`engine/run.ts` after a
  download, a backup's import through `runQueued`).

**There is no RESCAN on a phone or tablet.** MORE never had one (c525's card
and the help text both said it did): the sidebar is the desktop's, so the
other devices reach a scan by `/scan`. The help's backups topic now says so.
Not built here, because a door that never existed is a feature of its own.
The TV likewise: its "focus on CANCEL" has no door to open the sheet from.

## Where it departs from the handoff

- **"N OPEN" counts every series in progress**, not the rows shown. The mock
  derives it from how many rows it drew (4 on tablet, 2 on phone). Here it's a
  fact about the library, and the phone shows two rows of it.
- **Every series opened and not finished counts as in progress.** The seed data
  has thirteen, so the label reads 13 OPEN where the mock drew 4.
- **The offline CACHED tab filters on the device.** Only the tablet knows what
  it has cached, so the server lists everything and the page narrows it. ALL
  stays the default offline, with uncached tiles dimmed. The mock inverted the
  first tab by position, which would have made CACHED the default and shown an
  empty grid.
- **During an import the grid defaults to the NEW shelf**, sorted newest first,
  and NEW is prepended to the usual shelves. The mock shows only ALL and NEW
  because its library was empty before the import.
- **CONTINUE names a book by its number.** A series of books reads
  "DOUJIN · Book 3 of 4", counted in the owner's order, and a single book reads
  just "DOUJIN" instead of the meaningless "Book of 1".
- **+ SHELF in the bulk bar** opens a sheet of shelf chips, reusing the long-press
  sheet's SHELVES row. The mock draws the button but not what it opens.
- **+ ADD in the sheet** expands the non-member shelves as outlined chips, plus a
  field for a new shelf, in the same chip idiom. The mock stops at the button.
- **FAV and the rating are editable on the tile** (see "On the tile" above).
  The handoff only reads them there, and edits them in the long-press sheet,
  which still does.
- **The login screen** isn't in the handoff. It's assembled from the empty state's
  parts: numbered label, hairline field, primary button.

## What it does not do yet

Specific and honest, so a deliberate gap isn't mistaken for an oversight:

- **Mihon, Hentoid and EPUB import.** START SCAN (and RESCAN or `/scan`
  later) reads a Mihon backup from `$LIBRARY_ROOT/Mihon/autobackup/`, tsundoku's
  own downloads under `$LIBRARY_ROOT/devices/tsundoku/Mihon/`,
  `$LIBRARY_ROOT/H/.Hentoid/`, and the EPUBs under `$LIBRARY_ROOT/Library/`
  ([`IMPORT-MIHON.md`](IMPORT-MIHON.md),
  [`IMPORT-HENTOID.md`](IMPORT-HENTOID.md),
  [`IMPORT-EPUB.md`](IMPORT-EPUB.md)). A backup can also be uploaded from the
  browser on IMPORT A BACKUP ([`IMPORT.md`](IMPORT.md)). A `Mihon/` with no
  backup in it is no source (c268). With none of them present, it says where it
  looked. Development still runs on `yarn run seed`'s sample titles unless
  you import.
- **The resume buttons open the reader** ([`READER.md`](READER.md)): a
  CONTINUE row's ▶ and the sheet's `▶ CH. N` resume where the series was left
  (`resumeEntry`). SERIES and TAGS in the sheet open the series screen, TAGS
  straight into its SHELVES & TAGS sheet.
- **TAG in the bulk bar is disabled.** Tags are edited one series at a time, on
  the series screen. Neither handoff draws a bulk tag editor.
- **No list view.** Direction 1b offered GRID ▦ / LIST ☰, and Turn 3 dropped it.
  It isn't built.
- **IMPORT LOG** in the desktop sidebar opens the log of every import and scan
  ([`IMPORT.md`](IMPORT.md)), counting a running one in accent.
  SETTINGS opens [`SETTINGS.md`](SETTINGS.md)'s screen.
- **MORE** (card c171, Reach): on the tablet and phone, a cell after SELECT
  opens the sidebar's foot as a sheet: GET STARTED while it is unfinished,
  TO LINK while anything waits (c475), HISTORY, DOWNLOADS with its queue,
  SETTINGS with this device's changed count, HELP, IMPORT LOG with when the
  last import came in, and in the TV
  app only, SERVERS (no RESCAN: see "RESCAN asks first") (c261; [`TV-APP.md`](TV-APP.md), "Servers"). The desktop
  has the sidebar itself, so no MORE there (`MoreSheet.svelte`). To make room,
  a phone under 420px shows the search hint as / alone, as Reach draws it.
- **A folded book** (one book in several languages) is one tile with its
  languages in a corner badge, `EN · JA` ([`EDITIONS.md`](EDITIONS.md)).
- **Covers** come from the files or the source site ([`COVERS.md`](COVERS.md)). A
  series with none keeps the striped placeholder.
- **Sorting** is a menu on the right of `02 — SHELVES`, with a direction
  toggle beside it (see "Sort and direction"). The mock shows a label but not
  what tapping it does; it cycled through the sorts until 2026-10-14.
