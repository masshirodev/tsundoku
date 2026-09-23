# The library screen

The screen tsundoku opens on, built from the "Index" design system (see
[`design/README.md`](design/README.md)) against `Index Library.dc.html`, all nine
states on all four devices.

Routes: `/` (the library, with `?shelf=`, `?tag=`, `?sort=`), `/search?q=`, and
`/api/series/[id]` (what the long-press sheet reads).

## States, and what actually drives each

The mock draws each state from a `state` prop. The code has no such prop: every
state is the result of real data or real input.

| State            | What drives it                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home             | Default.                                                                                                                                                                                                                    |
| Long-press sheet | Pressing and holding a tile for 450ms, or a right-click. A plain tap opens the series screen ([`SERIES.md`](SERIES.md)). Esc or the scrim closes it.                                                                        |
| Search           | `/search`. Results follow the typing, 180ms behind it, by replacing the URL.                                                                                                                                                |
| Multi-select     | SELECT in the header. Taps then toggle tiles, and the bulk bar applies FAV, + SHELF, TAG, GROUP or HIDE to exactly the selection. GROUP is enabled only when every selected tile is a single book ([`BOOKS.md`](BOOKS.md)). |
| Person / tag     | `/?tag=namespace:value`, from a tag on the series screen or a chip. The person header replaces CONTINUE ([`BOOKS.md`](BOOKS.md)). A tag with nothing visible is a 404.                                                      |
| History          | **N OPEN · HISTORY →** on CONTINUE, and a HISTORY row in the desktop sidebar, open [`HISTORY.md`](HISTORY.md)'s screen.                                                                                                     |
| Incognito        | Typing `/incognito`. A dashed INCOGNITO · NOTHING SAVED band with END, on every screen ([`PRIVACY.md`](PRIVACY.md)).                                                                                                        |
| PEOPLE shelf     | `?shelf=people`. Exists while a favourite person has a visible book, and lists them as chips instead of a grid.                                                                                                             |
| Reveal on        | Typing exactly `/reveal` in search and pressing Enter. A **session** cookie, so closing the app also ends it. HIDE AGAIN, or `/hide`, ends it.                                                                              |
| Empty            | No visible series and no scan job.                                                                                                                                                                                          |
| Importing        | A `scan_jobs` row with no `finished_at`. Series the scanner found but hasn't indexed (`indexed_at IS NULL`) draw as dashed "indexing" tiles.                                                                                |
| Import finished  | The latest finished job nobody has dismissed. TIDY NEW dismisses it and opens the NEW shelf.                                                                                                                                |
| Offline          | `navigator.onLine` is false. What counts as cached is read from the `tsundoku-entries` Cache Storage bucket.                                                                                                                |

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

## Rating

An integer 0–5 where **0 is unrated** (the owner's scale, 2026-09-22). The
picker is six cells, 0–5: choosing 0 clears a rating, and while a series is
unrated no cell is filled and the row's label reads UNRATED. That's the series
handoff's convention, and the library uses it too. On a tile, unrated draws no
track at all, and a rated series draws its filled bars plus the rest of the
track. Out-of-range input is refused, never clamped: a clamped 7 would silently
become a 5 nobody chose.

The library handoff drew a seventh `—` cell to keep a deliberate 0 apart from
unrated. That distinction is gone, and so is the cell.

## On the tile

FAV and the rating are edited on the cover itself, without the long-press
sheet (the owner's ask, 2026-09-23):

- **FAV:** the cover's top-right corner is a 44px toggle. One tap favourites or
  unfavourites, with no dialog. A favourite shows the usual FAV badge there; a
  series that isn't one shows a faint ☆ in the same place, so there is
  something to aim at.
- **Rating:** a tap on the rating bars lays the six cells, 0–5, over the foot
  of the tile. A cell saves and closes; a tap anywhere else, or Esc, closes
  without choosing. Tiles narrower than 180px (the phone, and the 9-column
  landscape grid) lay them out 3 × 2 so a finger can tell them apart.

Neither opens the series. Both show the change at once and put the old value
back if the write fails; they use the same `favourite` and `rate` actions as
the sheet. They're gone while selecting (every tap is a pick then) and while
offline (writes need the workstation). `CoverTile` takes them as `onfavourite`
and `onrate`; without those it draws the plain badge and bars.

## New chapters

A tile's `+N` counts entries that **arrived after the series was last opened**.
It is not the unread count. Drawing has 18 unread and 3 new. A series never
opened has no "new", only unread.

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

- **Mihon and Hentoid import; EPUB doesn't yet.** START SCAN (and `/scan`
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
- **IMPORT LOG and SETTINGS** in the desktop sidebar are shown, disabled, and go
  nowhere.
- **Covers** come from the files or the source site ([`COVERS.md`](COVERS.md)). A
  series with none keeps the striped placeholder.
- **Sorting** cycles recently read → A–Z → rating → recently added through the
  label on the right of `02 — SHELVES`. The mock shows the label but not what
  tapping it does.
