# The library screen

The screen tsundoku opens on, built from the "Index" design system (see
[`design/README.md`](design/README.md)) against `Index Library.dc.html`, all nine
states on all four devices.

Routes: `/` (the library, with `?shelf=`, `?tag=`, `?sort=`), `/search?q=`, and
`/api/series/[id]` (what the long-press sheet reads).

## States, and what actually drives each

The mock draws each state from a `state` prop. The code has no such prop: every
state is the result of real data or real input.

| State            | What drives it                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home             | Default.                                                                                                                                                                                                                                                                    |
| Long-press sheet | Pressing and holding a tile for 450ms, or a right-click. A plain tap opens the series screen ([`SERIES.md`](SERIES.md)). Esc or the scrim closes it.                                                                                                                        |
| Search           | `/search`. Results follow the typing, 180ms behind it, by replacing the URL.                                                                                                                                                                                                |
| Multi-select     | SELECT in the header. Taps then toggle tiles, and the bulk bar applies FAV, + SHELF, TAG, GROUP or HIDE to exactly the selection. GROUP is enabled only when every selected tile is a single book ([`BOOKS.md`](BOOKS.md)).                                                 |
| Person / tag     | `/?tag=namespace:value`, from a tag on the series screen or a chip. The person header replaces CONTINUE ([`BOOKS.md`](BOOKS.md)). A tag with nothing visible is a 404.                                                                                                      |
| History          | **N OPEN · HISTORY →** on CONTINUE, and a HISTORY row in the desktop sidebar, open [`HISTORY.md`](HISTORY.md)'s screen.                                                                                                                                                     |
| Rescan           | **RESCAN** in the desktop sidebar, or typing `/scan`. Starts the same import as START SCAN; a press while one runs joins it. With nothing to import, the sidebar says where it looked, under the row ([`IMPORT-MIHON.md`](IMPORT-MIHON.md)).                                |
| Incognito        | Typing `/incognito`. A dashed INCOGNITO · NOTHING SAVED band with END, on every screen ([`PRIVACY.md`](PRIVACY.md)).                                                                                                                                                        |
| Words            | Typing `/words`. The words looked up while reading Japanese, waiting for review ([`JAPANESE.md`](JAPANESE.md)).                                                                                                                                                             |
| Duplicates band  | Pairs of books with alike covers to review, only those the viewer can see: **N POSSIBLE DUPLICATES · REVIEW →** ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)).                                                                                                               |
| Links band       | Series AniList found, not for certain, to review, only those the viewer can see: **N SERIES TO LINK · REVIEW →**, below duplicates. Offline, its REVIEW cell dims ([`LINKS.md`](LINKS.md)).                                                                                 |
| PEOPLE shelf     | `?shelf=people`. Exists while a favourite person has a visible book, and lists them as chips instead of a grid.                                                                                                                                                             |
| SERIES, ONE-OFF  | `?shelf=series`, `?shelf=oneoff`: the library split by what a thing is. A one-off is a single doujin book; everything else is a series ([`FILTERS.md`](FILTERS.md)).                                                                                                        |
| FILTER           | The FILTER cell at the end of the tabs (the top bar on the desktop) narrows whichever shelf is showing: rating, FAV, language, date added, downloaded, and hidden while reveal is on. Favourites, rated and downloaded were shelves until c68 ([`FILTERS.md`](FILTERS.md)). |
| Kind shelves     | `?shelf=k:manga`, `k:manhwa`, `k:novel`: MANGA, MANHWA and NOVELS, after ONE-OFF. Each lists one kind and shows only while the library has some. Doujins have no kind shelf; they're books, grouped and found by person and tag.                                            |
| Reveal on        | Typing exactly `/reveal` in search and pressing Enter. A **session** cookie, so closing the app also ends it. HIDE AGAIN, or `/hide`, ends it.                                                                                                                              |
| Empty            | No visible series and no scan job.                                                                                                                                                                                                                                          |
| Importing        | A `scan_jobs` row with no `finished_at`. Series the scanner found but hasn't indexed (`indexed_at IS NULL`) draw as dashed "indexing" tiles.                                                                                                                                |
| Import finished  | The latest finished job nobody has dismissed. TIDY NEW dismisses it and opens the NEW shelf, which keeps what it had.                                                                                                                                                       |
| Offline          | `navigator.onLine` is false. What counts as cached is read from the `tsundoku-entries` Cache Storage bucket.                                                                                                                                                                |

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
is a link to the library.

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

## New chapters

A tile's `+N` counts entries that **arrived after the series was last opened**:
listed by the source since then (`added_at`), or downloaded since then and
still unread (`arrived_at`). It is not the unread count. Drawing has 18 unread and 3 new. A
series never opened has no "new", only unread.

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
  NEWEST sorts it by arrival.

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

The grid arrives a page of 120 cards at a time (`GRID_PAGE`,
`src/lib/library/paging.ts`), because the real library's ALL shelf, with reveal
on, is 6,800 series. The whole shelf in one answer made the first load drag, and
a silent 5,000-card cap left the last 1,800 off the grid entirely. The cap is
gone.

- **The first page** comes with the screen, with the shelf's `total`
  (`countListed`).
- **The rest** comes from `GET /api/library?shelf&tag&sort&offset&limit`. It's
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
- **SELECT ALL** means the whole shelf. The ids of pages not yet loaded come
  from `/api/library?ids`, without their cards.
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

## Random

The sort label cycles RECENTLY READ → A–Z → RATING → RECENTLY ADDED →
**RANDOM**. RANDOM is a shuffle kept in the URL (`sort=random&seed=…`):

- the database orders by a hash of the series id and the seed
  (`randomOrder`, `src/lib/server/library.ts`), so one seed is one fixed order.
  Pages never repeat a card, a reload shows the same order, and going back
  finds it again;
- choosing RANDOM again (going round the cycle) picks a new seed, a new
  shuffle;
- another tab keeps the shuffle; leaving RANDOM drops the seed.

The seed only ever reaches SQL as an integer (`parseSeed`). Going back to a
screen as it was left is [`NAVIGATION.md`](NAVIGATION.md).

## The top bar stays

On a phone and the tablet, the bar with the name, `/ search` and SELECT
(and the selection bar that replaces it) is sticky: it stays at the top while
the grid scrolls under it (`TopBar`'s `sticky`, opaque, z-index 8: over the
tiles, under the bulk bar and sheets). On a desktop it scrolls away as
before, since the sidebar already stays. The owner asked for it on 2026-09-23;
the handoff draws a still screen and doesn't say.

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

- **Mihon and Hentoid import; EPUB doesn't yet.** START SCAN (and RESCAN or `/scan`
  later) imports `$LIBRARY_ROOT/Mihon/` and `$LIBRARY_ROOT/H/.Hentoid/`
  ([`IMPORT-MIHON.md`](IMPORT-MIHON.md), [`IMPORT-HENTOID.md`](IMPORT-HENTOID.md)).
  With neither folder present, it says where it looked. Development still runs
  on `yarn run seed`'s sample titles unless you import.
- **The resume buttons open the reader** ([`READER.md`](READER.md)): a
  CONTINUE row's ▶ and the sheet's `▶ CH. N` resume where the series was left
  (`resumeEntry`). SERIES and TAGS in the sheet open the series screen, TAGS
  straight into its SHELVES & TAGS sheet.
- **TAG in the bulk bar is disabled.** Tags are edited one series at a time, on
  the series screen. Neither handoff draws a bulk tag editor.
- **No list view.** Direction 1b offered GRID ▦ / LIST ☰, and Turn 3 dropped it.
  It isn't built.
- **IMPORT LOG** in the desktop sidebar is shown, disabled, and goes nowhere.
  SETTINGS opens [`SETTINGS.md`](SETTINGS.md)'s screen.
- **A folded book** (one book in several languages) is one tile with its
  languages in a corner badge, `EN · JA` ([`EDITIONS.md`](EDITIONS.md)).
- **Covers** come from the files or the source site ([`COVERS.md`](COVERS.md)). A
  series with none keeps the striped placeholder.
- **Sorting** cycles recently read → A–Z → rating → recently added through the
  label on the right of `02 — SHELVES`. The mock shows the label but not what
  tapping it does.
