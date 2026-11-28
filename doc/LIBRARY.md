# The library screen

The screen tsundoku opens on, built from the "Index" design system (see
[`design/README.md`](design/README.md)) in all its states on all four devices,
and in the ten-foot layout on a TV ([`TV.md`](TV.md)).

Routes: `/` (the library, with `?shelf=`, `?tag=`, `?sort=`, `?dir=`), `/search?q=`, and
`/api/series/[id]` (what the long-press sheet reads).

## States, and what drives each

There is no state prop: every state is the result of real data or real input.

| State            | What drives it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home             | Default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Long-press sheet | Pressing and holding a series tile for 450ms, or a right-click. A plain tap opens the series screen ([`SERIES.md`](SERIES.md)). Esc or the scrim closes it. A Work's tile has no long press and no sheet: a tap opens `/work/N` ([`WORKS.md`](WORKS.md), "`/work/N`"), and while selecting it toggles its parts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Search           | `/search`. Results follow the typing, 180ms behind it, by replacing the URL; a command typed over results clears them the same way, and any navigation away cancels a replace still pending, so a page command's row tapped within the 180ms opens its page however slowly it loads (`tests/search-command-row.e2e.ts`). A series is found by its title, then by another name it goes by (each member of `alt_titles` alone, such as a rename's old name), then by a tag; its reason reads TITLE, `ALSO <that name>` or `TAG …`. The name after ALSO is shown as stored, not upper-cased (`.why` sets no `text-transform`): it is a proper name, the line already shows a tag's value as stored, and the stored case is what tells it apart from the current title above it. While selecting, a tap on a hit ticks it instead of opening its sheet ([below](#select-across-the-search)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Multi-select     | SELECT in the header. Taps then toggle tiles (a Work tile selects its parts, [`WORKS.md`](WORKS.md)), and the bulk bar applies FAV, + SHELF, GROUP, REFRESH, HIDE or DELETE to the selection; TAG is drawn but disabled (see "Limits"). GROUP opens the AS sheet for any selection ([`BOOKS.md`](BOOKS.md), [`WORKS.md`](WORKS.md)), except that two or three single books each in a language of its own, with nothing beside any of them, get FOLD AS LANGUAGES in its place ([`EDITIONS.md`](EDITIONS.md)). A book with an extra or a set-aside duplicate beside it (the card's `alone`) is not offered FOLD, because `?/fold` could only refuse it. HIDE and UNHIDE apply to the selection, except that a Work's part takes its Work whole: HIDE asks first, and HIDE ALL n hides the Work whole while TAKE OUT takes the part out of its Work and hides only it; UNHIDE shows the whole Work ([`WORKS.md`](WORKS.md), "The one rule"). UNHIDE takes HIDE's cell only when every selected tile is hidden, which needs reveal on. DELETE's sheet counts the highlights the selection holds before it opens: `31 HIGHLIGHTS IN 4 SERIES ARE KEPT` (`2 HIGHLIGHTS ARE KEPT` for one series), with DELETE THEM TOO as a switch under it, off, off again every time the sheet opens. The row is absent at zero, and hidden highlights count only with reveal on. A read that fails or takes past 3 s opens the sheet with no row, and the delete keeps them. REFRESH asks every selected series' source once ([below](#refresh-a-selection)). The selection outlives a shelf, a filter and a trip to the search, where its hits tick ([below](#select-across-the-search)). |
| Person / tag     | `/?tag=namespace:value`, from a tag on the series screen or a chip. The person header replaces CONTINUE ([`BOOKS.md`](BOOKS.md)). A tag with nothing visible is a 404.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| History          | **N OPEN · HISTORY →** on CONTINUE, and a HISTORY row in the desktop sidebar, open [`HISTORY.md`](HISTORY.md)'s screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Rescan           | **RESCAN** in the desktop sidebar asks first (see "RESCAN asks first"), as MORE's RESCAN on a phone, tablet or TV does, or typing `/scan`. Starts the same import as START SCAN; a press while one runs joins it, without asking. With nothing to import, the sidebar says where it looked, under the row on the desktop, and in a band at the top of the screen where there is no sidebar ([`IMPORT-MIHON.md`](IMPORT-MIHON.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Incognito        | Typing `/incognito`. A dashed INCOGNITO · NOTHING SAVED band with END, on every screen ([`PRIVACY.md`](PRIVACY.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Words            | Typing `/words`. The words looked up while reading Japanese, waiting for review ([`JAPANESE.md`](JAPANESE.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Duplicates band  | Pairs of books with alike covers to review, only those the viewer can see: **N POSSIBLE DUPLICATES · REVIEW →** ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Queue cell       | QUEUE over its count, a cell before SELECT, while chapters are queued; DOWNLOADS in the desktop sidebar's foot. Dimmed at its last count offline or when the engine isn't answering ([`DOWNLOADS.md`](DOWNLOADS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Failures band    | Downloads that failed, drawn as the duplicates band is: **N DOWNLOADS FAILED**, the series, **REVIEW →** to the queue. Hidden series are never counted with reveal off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Links band       | Series AniList found, not for certain, to review, only those the viewer can see: **N SERIES TO LINK · REVIEW → · ✕**, below duplicates. Offline, its REVIEW cell dims ([`LINKS.md`](LINKS.md)). ✕ puts it away on this device until the queue really grows; reveal off and on is not growth (see "The links band").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| PEOPLE shelf     | `?shelf=people`. Exists while a favourite person has a visible book, and lists them as chips instead of a grid.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| FORM             | `?form=series`, `?form=oneoff`: FILTER's FORM row, SERIES · ONE-OFF, what a thing is shaped as. A one-off is a single doujin book; everything else is a series. `?shelf=series` and `?shelf=oneoff` answer 308 with the filter in their place ([`FILTERS.md`](FILTERS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| FILTER           | The FILTER cell at the end of the KIND band on the phone, tablet and TV (the top bar on the desktop) narrows whichever shelf is showing: rating, FAV, FORM, language, date added, downloaded, and hidden while reveal is on. Favourites, rated and downloaded are filters, not shelves, and the kind is the KIND band's, not a FILTER row ([`FILTERS.md`](FILTERS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| KIND band        | `?kind=manga` and the rest of the registry's kinds: one row under the shelf tabs, over the grid, **KIND · ALL n · MANGA n · …**, narrowing whichever shelf shows (see "The KIND band"). The old kind shelves, `?shelf=k:<kind>`, answer 308 to `?kind=<kind>` ([`KINDS.md`](KINDS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Reveal on        | Typing exactly `/reveal` in a search field and pressing Enter; behind the fingerprint gate, only once the device's prompt is passed. The server sets the reveal cookie to a value only it can make: signed, bound to this browser's session, and good for 12 hours from when reveal was turned on ([`PRIVACY.md`](PRIVACY.md), "Only the server can make the reveal cookie"). It is also a session cookie, so closing the app ends it, and so does signing in again. HIDE AGAIN, or `/hide`, ends it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Empty            | No visible series and no scan job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Importing        | A `scan_jobs` row with no `finished_at`. Series the scanner found but hasn't indexed (`indexed_at IS NULL`) draw as dashed "indexing" tiles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Import finished  | The latest job, finished and not yet dismissed; never an older one behind it, so a rescan that brought nothing leaves no band, not the one before's. TIDY NEW dismisses it and opens the NEW shelf, which keeps what it had. Its ✕ dismisses it and stays on the library, and at a bare `/` that ends the just-imported default: the grid goes from NEW to ALL ([`BANDS.md`](BANDS.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Offline          | `navigator.onLine` is false. What counts as cached is read from the `tsundoku-entries` Cache Storage bucket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

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

An integer 0–10 where **0 is unrated**, set with the blocky slider: five
blocks with halves, drag and let go, 0 on the left clears. While a series is
unrated no block is filled and the label reads UNRATED. On a tile, unrated
draws no track at all, and a rated series draws its filled bars (a half is the
left half of one) plus the rest of the track. There is no separate cell for a
deliberate 0: it is unrated. The whole account, from the scale to the
catalogues, is [`RATINGS.md`](RATINGS.md).

## On the tile

FAV and the rating are edited on the cover itself, without the long-press
sheet, which edits them too:

- **FAV:** the cover's top-right corner is a 44px toggle. One tap favourites or
  unfavourites, with no dialog. A favourite shows the usual FAV badge there; a
  series that isn't one shows a faint ☆ in the same place, so there is
  something to aim at.
- **Rating:** a tap on the rating bars lays a compact slider over the foot of
  the tile. Letting go saves and closes; a tap anywhere else, or Esc, closes
  without choosing.

Neither opens the series. Both show the change at once and save behind it;
they use the same `favourite` and `rate` actions as the sheet. A write that
fails keeps the tapped value, drawn dashed, with the app's failure band
offering PUT BACK and RETRY (below, and [`WAITING.md`](WAITING.md), "Writes
that fail"). They're gone while selecting (every tap is a pick then) and while
offline (writes need the server). `CoverTile` takes them as `onfavourite` and
`onrate`; without those it draws the plain badge and bars, and a value a failed
tap left behind wears the same dashed mark there: the FAV corner (with the
ghost ☆ for a failed UNFAV, which has no badge to carry it) and the bars. The
mark is drawing only, so in SELECT a tap on it is still a pick.

**A failed write draws its value dashed.** The control wears the series
screen's own `.unsaved` mark (`1.5px dashed var(--accent)`, no new colour)
while the page holds a tap for it that is not stored: a value in
`favNow`/`ratingNow` that differs from the card's stored one (`favUnsaved`,
`ratingUnsaved`, from the page's `unsaved()`). A fresh tap still in flight is
not marked until its turn says which it is; a RETRY in flight (the band's or
the next navigation's) keeps the mark, because the value it sends is still
not stored, and a redraw during it (another tile's save landing, a scan's
re-read) does not drop it.

The mark is the page's answer, not the band's: the store (`saves`,
`src/lib/saves.svelte.ts`) keeps a list of failures, one per save, and each has
its own band with its own PUT BACK and RETRY ([`WAITING.md`](WAITING.md),
"Writes that fail"). Those bands outlive the page, and so does the failure's
key; the tap that the tile draws does not.

A tile drawn again after leaving the library and coming back holds the stored
value, not the old tap (`favNow` dies with the page and `saves` does not), so it
is not marked: the value it draws is what the server has, and its band still
offers the way back. The props default to false, so a user of the tile that
passes neither draws a stored value.

**Two quick taps take turns.** The tile's saves are on the series screen's own
queue (`seriesSaves`, `src/lib/serial-saves.ts`) under the same `fav:<id>` and
`rating:<id>` keys, so a tile tap and a series-screen tap on one series wait
for each other too ([`SERIES.md`](SERIES.md), "FAV and the rating"). One save
in flight per field, the last tap winning: a superseded save is not sent, only
the newest retries the page and shows a failure band, and PUT BACK names the
value the reload found stored. `tests/library-flow.e2e.ts` holds the first FAV
and rating POSTs, taps twice, and wants the second tap after a reload; a newer
tap that fails during the earlier tap's reload keeps its band with
`PUT BACK · FAV`; and a tile tap followed by the series opened before it
settles shows the screen's tap waiting on the same key.

## Works

A **Work** is a level above series that merges nothing: a name, an order set by
hand, and up to one Work per series ([`WORKS.md`](WORKS.md)). The library
follows one rule: **browsing shows the run, finding shows the series**.

- **ALL, a shelf, NEW, a collection, FAV** draw a Work once: one tile, with
  the cover of its part that is on that shelf (CONTINUE's part on ALL), the
  `WORK · N` badge, its name, and a foot of one segment per part with
  `PART 2 OF 3` or `UP NEXT · PART 2` where a series draws rating bars. `+N`
  sums the parts' new chapters and `↓` the parts' cached chapters; FAV shows
  when any part is. A Work is on a shelf, or under a kind of the KIND band,
  when any of its series is, and its cover is the part that is there: a Work
  of a manga and its anime is one tile under MANGA and under ANIME, and the
  band counts it once in each, and once in ALL (`kindCounts`).
- **Search, a tag filter and a person's page** find series, so a Work opens:
  each matching series is its own tile with `PART 2 · <WORK>` in its foot. A
  search that matches the Work's own name shows the Work first, then its
  parts. A person's page foot says the same, and above its grid one row per
  Work with a series there (`worksOnTagPage`; [`WORKS.md`](WORKS.md)). The
  part number is the part's place in its Work, counted, never the raw
  position a take-out leaves sparse.
- **CONTINUE** is one row per Work, never one per part:
  `WORK · PART 2 · <part> · CH. 15`, and between parts `UP NEXT` in inverse
  pointing at the next part's first chapter, with ▶ in accent. A Work whose
  part 1 is read through stays in CONTINUE for part 2. Its `total` counts
  rows, so the section's `N OPEN` counts Works. The open-series cards are
  read once (the card query carries no LIMIT and `withEditions` runs over
  every open series), and the rows are then sorted and sliced to `limit`
  before `entryLine` and `resumeEntry` run, the two prepared reads per row,
  so the series arm hydrates every open series but reads entry lines only for
  the four rows it shows (8 ms at 816 open series). The Work arm is decided
  before it is read: one grouped query gives each Work with an opened visible
  part its sort key (its most recent part's last open) and whether any
  visible part is unfinished (no counted chapter, or one unread:
  `isFinished`'s own facts), which is exactly when `continuePart` has a part
  to open. Works are sorted and sliced with the series on those keys, `total`
  counts every row, and only the Works the section shows have their parts
  read (`partsOfWorks`, `workRecords` and the cards of the parts they open,
  one grouped pass each). Measured at 1,000 Works of two open parts each
  under a load average of about 50: 167 ms, against 632 ms when every Work's
  parts were read; the rest is the open-series card query, which carries a
  Work's parts too and drops them. `tests/works-library-db.spec.ts` pins the
  rows, order and count.
- **Sorts** place a Work by its most recent part: its latest read, its
  newest chapter, its latest added; TITLE by the Work's name. The unit
  query aggregates over every part, so a Work sits where the part you would
  open sits.
- **Counts count tiles**: `countTiles`, `countListed`, `listShelves` and the
  `44 OF 188` line all count a Work as one. A Work of three parts is one of
  each.
- **Hidden**: a Work is hidden or shown whole (`workPage`). With reveal off it
  is absent from lists, counts and search; with reveal on it is one tile
  carrying HIDDEN in `--reveal`. A Work whose parts diverged after grouping
  reads as the parts the viewer may see; HIDE on a Work's part settles it.
- **SELECT** on a Work tile selects its parts, because every bulk action acts
  on series.

The three reads behind a page are independent of the tiles' number: the
units, the cards of the parts drawn, and every part of every Work on the
page (`listTiles`, `cardsOf`, `partsOfWorks` in `src/lib/server/library.ts`).

## The CONTINUE row

One row per series or Work in progress (`ContinueRow.svelte`). **Every series
opened and not finished counts as in progress**, and **N OPEN counts all of
them**, not the rows shown: it is a fact about the library, and the phone
shows two rows of it. A series of books reads "DOUJIN · Book 3 of 4", counted
in the series' own order, and a single book reads just "DOUJIN", not "Book 1
of 1".

**▶ is drawn, not typed**: a text `▶` is placed by the font's metrics and sits
2 px right of its cell, so the cell draws a 14 px SVG triangle whose centroid,
not its box, is the middle of the cell. An unavailable row keeps its `—` in the
same cell. `tests/continue-row.e2e.ts` measures the ink's centroid from the
cell's own pixels on the row's states.

**The band opens the entry, ▶ goes straight to the reader** ([`READER.md`](READER.md)),
resuming where the series was left (`resumeEntry`). The row is a real `<a>`
around the cover, the text and the progress, with ▶ its sibling, so there is
no button inside a link and the row's padding and the gap before ▶ are the
link too. A series' row goes to `/series/<id>?from=continue` (its ← reads
_Continue · Library_), a Work's row to `/work/<id>`, as its tile does. The
band stops being a link where it has nowhere honest to go, and then it is a
row that takes no tap:

| State                                                         | The band                                                                                      | ▶       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------- |
| Online                                                        | link                                                                                          | resumes |
| Selecting (tablet, desktop; a phone hides the row)            | no link: every tap is a pick, and a row is not one, so a stray tap must not end the selection | resumes |
| Offline, nothing of it on this device (`unavailable`, dimmed) | no link                                                                                       | `—`     |
| Offline, chapters on this device, its screen kept             | link                                                                                          | resumes |
| Offline, chapters on this device, its screen never kept       | no link                                                                                       | resumes |

Why the last row: offline, the worker answers a series it never kept with the
library's copy, under the series' URL, so the tap would land on the library
looking like nothing happened (measured: `/series/1` showing the library).
Only a screen's whole document can be kept, because SvelteKit sends
`__data.json` as `no-store` and the worker never stores that
(`src/service-worker.ts`, `storable`; [`OFFLINE.md`](OFFLINE.md)), so a series
opened from inside the app is not kept and a row is usually in this state.

On a TV the card has **two stops**: ▶ is a 48 px ruled cell at the card's end,
the first stop and what BACK climbs to, and the band is the rest. A trip to the
series comes back to the stop it left. On a TV, whose cards sit three across, ↓
from the first ▶ goes to the first shelf tab (`data-focus-down`); everywhere
else the rows stack and ↓ is the row under it. ▶❚❚ on either stop resumes.

**A held press opens the entry's options, as a grid tile's does**: a held OK or
MENU on a TV, a long press, or a right click, anywhere on the row, the band and
▶ alike. It is the sheet the grid opens (`sheetId`, `SeriesSheet`), through the
action every long-press row uses (`use:longpress`), and the press that fires it
neither follows the band nor resumes. The row carries a tile's touch rules too
(`user-select`, `-webkit-touch-callout`: iOS sends no `contextmenu` for the
action to cancel, [`TOUCH.md`](TOUCH.md)), on the row itself, because the hold
is the row's. Where the grid's tile has no options, nor does the row, and a
held OK there is a plain press:

| Row               | A held press                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------- |
| A series          | the sheet                                                                                     |
| A series, offline | what a tile's does offline: the sheet asks the server, so nothing opens                       |
| A Work's          | nothing: a Work's tile has no sheet, so a held OK on ▶ resumes and on the band opens the Work |
| Selecting         | nothing: a hold on a tile is a pick and a row is not one, so a held OK on ▶ resumes           |

## New chapters

A tile's `+N` counts entries that **arrived after the series was last opened**:
listed by the source since then (`added_at`), or downloaded since then and
still unread (`arrived_at`). It is not the unread count: a series can have 18
unread and 3 new. On its own tile, a series never opened has no "new", only
unread; a never-opened part of a Work is read against the Work's last open
instead ([`WORKS.md`](WORKS.md), THE RUN).

## The NEW shelf

What arrived, until it's opened or two weeks pass:

- **Arrived** is tsundoku's own clock, `series.arrived_at` and
  `entries.arrived_at` (migration 34): the import that created the series, or
  the latest import that brought a file for one of its chapters still unread.
  The source's dates can't say it. Mihon dates a chapter by when its source
  listed it (`added_at`), so chapters Suwayomi downloads today can be dated
  years back.
- **It leaves** once any of its chapters is opened after it arrived (here or,
  through a backup, on a device), or `NEW_DAYS` (14) after it arrived. A new
  chapter brings it back.
- **It isn't tied to an import.** A shelf that followed "the series the last
  import created" would lose things two ways: each import that created a
  series would replace the last one's, and a series that only got new chapters
  would never show. So the band is just the band: TIDY NEW closes it and opens
  NEW, which keeps what it had.
- **The shelf is listed** while an import runs or while anything is on it.
  During an import the grid defaults to NEW, prepended to the usual shelves.
  It opens sorted NEWEST, which on NEW means newest arrival first; RECENT
  would sort by an open that, on NEW, hasn't happened since. A sort picked by
  hand still wins. Tested in `tests/library-sort-db.spec.ts`.

The rule is `NEW_SQL` in `src/lib/server/library.ts`; the writer stamps
arrivals in `src/lib/server/import/write.ts`. Tested in
`tests/library-db.spec.ts` ("the NEW shelf"), `tests/arrivals-db.spec.ts` and
`tests/migrations-db.spec.ts` (migration 34).

**Chapters already in a library when migration 34 ran have no arrival**, and no
migration can know one. Dating each series by the import that made it would
put nearly a whole library on NEW, since a first import makes most of it at
once, so migration 35 leaves those arrivals empty. A library can instead be
dated once by hand from each chapter file's modified time (when the device
downloaded it, which Syncthing keeps), each series taking its newest: on a
library of 17,403 chapters that left 134 series on NEW (22 visible without
reveal).

**An arrival already read isn't new** (migration 36). Suwayomi downloads again
chapters the tablet already had and that were read there. Dated by their
files, 1,025 read chapters put their series back on NEW and on the `+N` badge.
So a series arrives only with a chapter that is still unread, migration 36
dates existing series by their newest unread arrival, and `+N` counts a
downloaded chapter only while it's unread.

## A selection outlives the shelf

SELECT stays on, and keeps what it holds, while moving about the library page:
a shelf tab, a KIND cell, a FILTER choice, a tag or person page, the sort, and
BACK between those (all one page, `src/routes/+page.svelte`, so nothing ends
SELECT on the way). A series ticked on one shelf stays ticked on the next,
though it is not drawn there.

- **The bulk actions act on the whole selection, drawn or not.** The page
  notes each selected series' facts while it is drawn and keeps them while it
  is selected (`facts`, the `Picked` record in `src/lib/library/selection.ts`):
  title, cover, kind and size, GROUP's row line, its Work, hidden, its
  language. Without them a series ticked on one shelf and then out of sight
  would drop from GROUP's rows (GROUP posts its rows, so it would be left out
  of the group) and from DELETE's titles, FOLD could not be offered, and HIDE
  could not see its Work. They are refreshed each time the series is drawn
  again, and forgotten when it is unticked. A fact gone stale since it was
  noted only words a sheet; the server judges every write. HIDE reads a
  series' Work from the page's `workFeet` first and from the note second, and
  the note comes from the tile or card itself, so a Work tile past the first
  page asks with the same HIDE sheet as one on it, rather than posting at
  once.
- **SHOW** sits beside `N SELECTED` in the selecting bar. It opens a sheet
  that lists the selection in the order it was ticked (GROUP's BY HAND order),
  each row with GROUP's tick box: a tap takes the series out of the selection
  and a second puts it back (at the end, since the selection's order is the
  order of ticks). The rows stay until the sheet closes, so a slip is undone
  where it was made. Series SELECT ALL took by id from pages never loaded
  have their facts read by id: `POST /api/library` with `{ ids }` answers the
  grid's own card shape for the cards holding those ids, read through the
  grid's query over the whole library, so hidden means hidden as on the
  screen, and `missing`: the wanted ids the library does not show now (deleted
  since, or hidden under the request's reveal), from a by-id check of just
  those ids. The read is made once SELECT ALL has the ids, and again for
  anything still missing when SHOW opens or GROUP, HIDE or DELETE is pressed.
  Those three wait for all of SELECT ALL's reads, the id GET included
  (`selectingAll`, the GET and the by-id read behind it as one promise; a
  second press joins the first), and for every by-id read in flight, so GROUP
  tapped while they are out opens on every selected series (its sheet takes
  its rows once, on open): SHOW lists every series and GROUP counts them all.
  SHOW opens at once and its list grows as the ids land. A tap made while the
  reads are out belongs to its selection: ✕ drops it, + SHELF's picker drops
  it, and of two taps only the last opens; and it opens only on a selection
  that still holds something, never as `DELETE 0 SERIES?` or a GROUP of none.
  A series unticked while the ids are out stays unticked. If the
  id GET fails, the wait ends and the sheet opens on what is selected, which
  is the loaded pages, and the bar counts the same. While it is out the sheet
  says `N MORE FROM SELECT ALL · LOADING`; an id the server names missing is
  taken out of the selection and said so
  (`N GONE OR HIDDEN SINCE SELECT ALL · TAKEN OUT`, counting only ids still
  out: one ticked again by hand is listed instead), so no bulk action posts a
  series the viewer cannot see. An id that got neither a card nor a `missing`
  entry (past the read's caps) is not gone: like a read that could not be
  made (offline) it stays selected and unlisted
  (`N MORE FROM SELECT ALL · NOT LOADED, SO NOT LISTED`), and the next SHOW
  asks again. An answer that lands after ✕ is dropped, the id GET's too
  (`UnseenFacts` in `src/lib/library/selection.ts`, `selectionRun` in
  `+page.svelte`). One POST carries at most 10,000 ids, the grid's own cap, so
  the client sends them in chunks of that; the cards come from the first
  10,000 tiles.
- **What ends SELECT** (and drops it): the bar's ✕, on the library or the
  search; GROUP's, HIDE's and DELETE's own success (`ondone`); a reload; and
  leaving the library and the search for any other screen (a series screen, a
  Work, settings, a sidebar link other than a shelf) and coming back. ESC does
  not end SELECT on the library (a Sheet's ESC closes the sheet; see
  "Limits"). A second tab has a selection of its own. A TV has no SELECT.

### SELECT across the search

The search is part of SELECT: a trip to `/search` in a selecting mode, not a
field inside the selecting bar.

- **Two ways in.** The selecting bar's `/` cell, between SHOW and SELECT ALL:
  `/ SEARCH TO TICK` in the bar's empty middle on a tablet and a desktop, `/`
  alone on a phone, where SELECT ALL reads ALL (its accessible name stays
  SELECT ALL). The `/` key does the same while selecting, unless a field has
  the focus, a sheet is open or a modifier is held. And **SELECT** on the
  search's own bar, after CLEAR, shown only once a search has hits (a title
  or a Work; a tag or shelf chip is not a hit): it starts SELECT there with
  nothing ticked.
- **The search, selecting.** The selection block, `✕ · N SELECTED · SHOW`
  (the selecting bar without SELECT ALL, inverse), sits beside the field
  right of CLEAR on a tablet and a desktop, and is a 48 px strip under the
  field on a phone. A hit has GROUP's tick box in a 64 px cell at its head, its
  row tinted `--accent-select` when ticked, and a tap anywhere on it ticks it;
  nothing opens the series sheet. A ticked hit stays where it is. **A Work's
  row** (one found by its own name) ticks every part, as a Work tile does: ✓
  only when every part is, `1 OF 2 TICKED` otherwise (its parts' own rows show
  their ticks), and a tap ticks the rest; a tap on a wholly ticked Work unticks
  every part. The TITLES label reads `N · A TAP TICKS`. **Chips** end in `→`,
  the TAGS & SHELVES label says `OPEN IN THE LIBRARY, STILL SELECTING`
  (`OPEN, STILL SELECTING` on a phone), and a chip opens the library at that
  tag or shelf with SELECT on, where SELECT ALL takes them. SEARCH THE SOURCES
  and the empty search's BROWSE A SOURCE are left out: nothing outside the
  library can be ticked. Commands still work.
- **What keeps it**: ← on the search (back to the library still selecting,
  its shelf, loaded pages and scroll kept, as history's own back when the
  library is the entry behind, else a plain way to `/`), Android's back and
  the browser's back and forward between the two, CLEAR (empties the field,
  keeps the focus and the ticks), SHOW (the same sheet over the search;
  unticking there unticks the hit underneath), a chip, a sidebar shelf, and
  `/` again (a new search, the selection with it). Enter on a query while
  selecting re-reads the results without the form's page load, which would
  end SELECT as a reload does.
- **Where it lives.** The ids, in the order they were ticked, and their
  `Picked` facts go with the navigation, in this tab's memory alone
  (`carrySelection`/`takeCarried` in `src/lib/library/selection.ts`): written
  by the screen being left when the next one is the library or the search,
  taken once by the one arriving, and dropped if the arrival is not where it
  was carried to (a cancelled or redirected navigation). Not the URL (a link
  or a new tab must not arrive selecting) and not history state (a browser
  keeps that across a reload, and a reload ends SELECT). So: a reload or a
  new tab starts with none; a tap, ←, Android's back and the browser's
  forward carry it. A hit carries its own facts (title, cover, kind, GROUP's
  row line, its Work), built from the search's answer, which is the library's
  card shape (`pickedOfCard`, `pickedOfPart`, the same builders the library
  uses), so GROUP, HIDE, DELETE and SHOW list a series ticked only in a search.
- **The commands while selecting.** `/lock` and `/unlock` answer on their
  COMMAND row on the search, the selection kept. `/reveal` goes to the
  library revealed and **ends SELECT**: without a lock it is the form's post,
  a page load; through the lock the screen's own `goto` ends it on purpose,
  so the same command does the same thing either way. A page command
  (`/help`) is another screen.

### Acting on a selection from the search

The search draws the library's bar at its foot: the same seven cells, the same
sheets, one component (`src/routes/search/SelectionBar.svelte`), the bar's own
shape unchanged, with the inverse block `✕ · N SELECTED · SHOW` staying the
entry. Every form the bar and its sheets post is the library's action by its
absolute path (`/?/bulk`, `/?/fold`, `/?/refresh`, `/?/showAll`, `/?/hideAll`,
`/?/hideParts`, `/?/delete`, `/?/held`, `/?/shelf`, `/?/group`, `/?/work`,
`/?/addToWork`); a relative `?/bulk` on `/search` would post to `/search`, which
has no such action. GROUP's lists (`existing`, `existingWorks`) come from
`GET /search/selection`, read while selecting, so an ordinary search pays nothing.

SvelteKit applies an answer only to the page it belongs to (`GroupSheet`'s own
`ondone`), so the search reads each answer itself:

| Action                        | On the library                                                | On the search                                                                                   |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| FAV, RATE                     | `form`, re-read; SELECT stays                                 | re-read; SELECT stays                                                                           |
| + SHELF                       | re-read; SELECT stays                                         | re-read; SELECT stays                                                                           |
| GROUP, into a Work            | the band's UNDO; SELECT ends                                  | the library's band with UNDO (`?/undoWork`), from the sheet's answer; hits re-read; SELECT ends |
| GROUP, into a series          | `?/group` redirects to the new series                         | the same redirect, to the new series; leaving ends SELECT                                       |
| HIDE/UNHIDE (no Work)         | `form`, re-read; **SELECT ends**                              | re-read; **SELECT ends**, as on the library                                                     |
| HIDE on a Work's part         | the HIDE sheet; the band with UNDO; SELECT ends               | the same sheet; `/search`'s own band with UNDO; SELECT ends                                     |
| A plain HIDE that took a Work | `?/bulk` answers `hideFacts`; the band with UNDO; SELECT ends | the same answer read here: `/search`'s own band with UNDO; no sheet; SELECT ends                |
| UNHIDE a Work's part          | `?/showAll`, band; SELECT stays                               | band; SELECT ends                                                                               |
| FOLD                          | `?/fold` redirects to the review                              | the same redirect                                                                               |
| REFRESH                       | the band over the bar; SELECT stays                           | the same band; SELECT stays                                                                     |
| DELETE                        | the sheet; SELECT ends                                        | the same sheet; SELECT ends                                                                     |
| DELETE, no success            | `NOT DELETED · …` over the bar; page re-read; ticks stay      | the same                                                                                        |
| A refusal                     | `foldMessage` over the bar                                    | `foldMessage` over the bar; **the selection is kept**                                           |
| A stale GROUP (Work gone)     | the sheet closes, the page re-reads its lists                 | the sheet hands it to the bar's line; **the ticks stay**; the lists re-read (`onstale`)         |

A refusal over the bar on the search lasts until the selection or the query
changes, the next bulk action, or the end of SELECT.

On the search one band at a time answers the library's actions (`hid`, drawn
as `hidBand`): HIDE ALL n from a hit's sheet, a HIDE or UNHIDE that took a
Work, and GROUP into a Work. GROUP's sheet hands its answer to the bar
(`ondone`, then `ongrouped`), since SvelteKit gives the library's `?/work` and
`?/addToWork` answers only to the library's `form`; the band says what the
library's says, in the same words (`workBand` in
`src/routes/search/bar-answers.ts`, which both pages call), and its UNDO posts
`/?/undoWork`. A success takes the band down and re-reads the hits; a refusal
stays on the band and says why. As `form` does on the library, the next answer
replaces it, so a HIDE of the Work's series takes its name down with it. It
belongs to the query it was pressed on, drawn only while that query is the
page's, and goes with ✕ and with leaving. A Work made with reveal on is not
named again once the page has read reveal off. DELETE's sheet carries its own
answer.

A plain HIDE or UNHIDE (the bar's own cells, `plainHideOrUnhide`) ends SELECT
on both pages once it succeeds, and the band a HIDE that took a Work answers
stays up after it; a refusal keeps the selection. UNHIDE of a Work's part
(`?/showAll`) ends it on the search and leaves it on the library, where only
the plain cells end it.

← after an action carries the ids back and posts nothing; a selection carried
back acts on those same ids (`tests/search-bulk-flow.e2e.ts`).

### + SHELF and + ADD

**+ SHELF** in the bulk bar opens a sheet of shelf chips, reusing the
long-press sheet's SHELVES row. **+ ADD** in that row expands the shelves the
series is not on as outlined chips, plus a field for a new shelf, in the same
chip idiom.

## REFRESH a selection

The bulk bar's REFRESH cell is the series screen's REFRESH over many series at
once: it asks each selected series' source what it lists now, through the same
`refreshSeries` (`src/lib/server/refresh.ts`), and **downloads nothing**:
FOLLOW stays the only thing that queues ([`DOWNLOADS.md`](DOWNLOADS.md),
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
  then "…"; a source that is down fails the whole run), then how many were
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
each series' last-opened time. As correlated subqueries, one set per series,
SQLite re-runs the "new since last opened" MAX for every entry row, so a
1,429-chapter web novel alone costs about two million reads, and a real
library's ALL shelf took 1.9 s.

`cardQuery` (`src/lib/server/library.ts`) works in one pass:

1. it picks the series first;
2. it groups their entries once for the counts and the last-opened time;
3. it counts what's new against that.

The steps are `MATERIALIZED`, so SQLite can't flatten them back into the slow
shape. The counts are read from a covering index, `entries_card` (migration 12).

Measured on a real library (6,872 series, 257 visible), same rows with
correlated subqueries and with `cardQuery`:

| Query     | Subqueries | `cardQuery` |
| --------- | ---------- | ----------- |
| ALL shelf | 1,920 ms   | 18 ms       |
| CONTINUE  | 222 ms     | 22 ms       |
| Search    | 272 ms     | 57 ms       |
| NEW shelf | 379 ms     | 6 ms        |

## Pages

The grid arrives a page of 120 tiles at a time (`GRID_PAGE`,
`src/lib/library/paging.ts`), because a large library's ALL shelf, with reveal
on, can be 6,800 series: the whole shelf in one answer makes the first load
drag. There is no cap that leaves tiles off the grid.

A page is a page of **tiles**, not of series: a Work is one tile, and the
offset counts tiles, so page two carries on where page one stopped even when a
Work's parts sit across the boundary ([`WORKS.md`](WORKS.md)).

- **The first page** comes with the screen, with the shelf's `total`
  (`countListed`).
- **The rest** comes from `GET /api/library?shelf&tag&sort&offset&limit`. It
  answers the same units the first page does (`listTiles`, one row per Work,
  one per series in no Work) and takes the same `offset` in tiles. It's
  asked for when the end of the grid comes within one and a half screens, or
  3,600 px on a TV (an `IntersectionObserver` on the row below the grid, and
  see "never stalls" below). After each page the reader checks again, since on
  a tall screen a page may not push the end out of reach.
- **The row below the grid** reads `240 OF 6,812`, then LOADING while a page
  is on its way. A page that fails says `THE REST DID NOT LOAD` with RETRY.
  Offline, it says `THE REST NEEDS THE WORKSTATION`.
- **A re-read of the same shelf** (a rating saved, a scan in progress) re-reads
  every loaded page after the first as well, in one request, so a tile deep in
  the grid shows the server's value. A new shelf, tag or sort starts again from
  its first page. A request answered after the list changed is dropped. A
  re-read that answers nothing keeps the pages already drawn: a blip must not
  fold a deep grid back to its first page.
- **One re-read per reload.** A write's reload is the load's first page and
  then the loaded pages, and the first page's refresh is what queues the
  second: the reload waits for that one rather than asking again. Only a first
  page that came back identical leaves nothing queued, and then the reload
  asks for the pages itself. Two of them in a row would refetch every loaded
  page twice. A HIDE and an UNDO are one re-read too: the HIDE sheet's
  success hands the reload to the screen that opened it (`ondone`), which runs
  the same `reloadList` a tile save does, and the UNDO's action asks its
  `update` not to re-read on success for the same reason. An UNDO the server
  answers with a redirect is the exception: `applyAction` sends it through
  `goto` with `invalidateAll`, so that is the one re-read and its effect queues
  the one refill; the handler must not add a second.
- **A card is drawn once.** A load's first page can change under the pages
  already drawn (a Work made over two series it listed, a part hidden), and
  the two lists can then hold the same id (a Work's card carries its first
  part's). The grid keys its blocks by `id`, and the same id twice stops the
  render, so the first page's copy wins and a page's duplicate is dropped.
- **A re-read drops any page that was still on its way, and lets go of the
  loading flag with it.** A page requested before the re-read has a stale
  position, so its answer is dropped; the flag said a page was out, and the
  re-read clears it in the same breath, or every page after it would be
  refused and the row below the grid would read LOADING for good.
- **SELECT ALL** means the whole shelf, tiles and all. The ids of pages not yet
  loaded come from `/api/library?ids`, without their cards, and a Work's every
  part is among them even when a kind, collection, NEW or FAV shelf picked only
  one: a bulk HIDE must hide the run whole (`tileIds`, [`WORKS.md`](WORKS.md)).
  The trip to the search carries what the bar reads at the tap: leaving while
  the id GET is out takes the loaded pages, and its answer lands on a page
  that has gone, so SELECT ALL is pressed again on the way back to take the
  rest.
- **Back** (the gesture, or the browser's) comes back to the pages and the place
  it left. A SvelteKit snapshot keeps the loaded cards (up to 4,000) and the
  scroll, and sets the scroll again once they're back, since SvelteKit scrolls
  before it restores. It then re-reads them, in case a rating changed on the
  series screen.
- **The shelf can move under the pages** (a series hidden, volumes grouped,
  a scan's arrivals). Pages are by position, so a page can repeat a card
  already shown, which is dropped (a repeated key would stop the grid
  drawing). A page shorter than asked for is the end, whatever `total` said.
- **The grid never stalls with its end on screen.** An `IntersectionObserver`
  speaks only on a change, comparing each sample with its last, so one
  transition is not enough: a page that lands and a reader at the new bottom
  before any frame leaves it nothing to report, and with no failure and no end
  nothing asks (seen on a TV at 240 tiles; going to the top and back gave it
  its change). So three things ask. **Every settle** (a page in, a re-read of
  the loaded pages, a snapshot's re-read, a new list, a page dropped because
  the list changed under it) measures, and otherwise re-arms the observer,
  because `unobserve` then `observe` always delivers a first callback with the
  true state. **`scroll`**, passive and at most once a frame, runs the same
  measure, for whatever the frames did. The observer stays for the plain case
  and goes on reporting a real change at any time. The other two stop at the
  flags: no check asks or looks again while a page is out, after a failure
  (RETRY or coming back to the row), or **while a re-read is queued or out**,
  whose own settle looks instead, so a HIDE or an UNDO past the first page
  still reads each loaded page once. A re-read's bump lets go of the loading
  flag with it, the snapshot's as well as the refill's.
- **A page that never answers ends in RETRY** after 30 s (`PAGE_WAIT_MS`),
  rather than leaving the loading flag on and every later ask refused.
  Measured against a copy of a library grown to 6,831 series and 614,849
  entries, at a load average of 30: a page of 120 answered in 0.26 to 0.74 s
  (44 KB), a re-read of 2,400 tiles in 0.75 s (813 KB), of 6,000 in 1.06 s
  (1.66 MB). The slowest honest wait is that last one over a 1 Mbit/s link,
  about 14 s, and `GRID_MAX`'s 10,000 tiles about 22 s, so 30 s is past
  anything that is still coming. It is a timer and an `AbortController`, not
  `AbortSignal.timeout`, because the TV app's `minSdk` is 23 and an old WebView
  may not have the latter (Chrome 103), where a throw would read as every page
  failing.
- **A page of nothing but repeats moves on.** The offset is the tiles drawn
  plus the positions that drew nothing (`skipped`), so the page the shelf
  repeated (three series read elsewhere on RECENT put the next page's in front)
  is passed, not asked for for ever. A re-read or a new list starts it again.
- **A TV asks 3,600 px ahead, every other device one and a half screens.** At
  960x540 a row is 199 px and a held ↓ moves one row per key repeat (measured);
  Android's repeat is 50 ms (`ViewConfiguration`, not measured on the device),
  so 3,980 px a second. One and a half screens is 810 px, four rows, 0.2 s:
  less than a page's answer. 3,600 px is 0.9 s, past the answer's 0.74 s, and
  about one page of 120 tiles (20 rows, 3,982 px). Drawing 120 tiles on the
  TV itself has not been measured; if the page is not in time the row reads
  LOADING and the next page is asked for the moment it lands.
- **The place to come back to is noted when a navigation begins**
  (`beforeNavigate`). By the time SvelteKit takes the snapshot, the waiting
  outline may already cover the library, with its scroll at 0. Coming back,
  the scroll is set each frame until it lands, for up to two seconds, or
  until the reader touches or scrolls. That holds with only the first page
  loaded too: there are no pages to put back, but the place is set all the
  same, since SvelteKit's own was read after the next screen's data came in,
  and a shelf picked from the tabs under a slow load would come back at the
  top.
- **CACHED** isn't paged, and filters on the device. Only the device knows
  which series it holds, so the server sends the whole shelf for it to narrow
  down. ALL stays the default offline, with uncached tiles dimmed; CACHED is
  not the default, which would show an empty grid.
- **Sorts page cleanly** because every order ends in the series id, so no card
  appears on two pages or on none.
- **Hidden means hidden** here as on the screen: the endpoint reads the reveal
  cookie as the screen does.

The end-to-end tests shrink the page with a `tsundoku_grid_page` cookie
(`pageSizeOf`), so the seed's twenty-odd series make several pages. Nothing
else sets it.

## Sort and direction

Sorting is a menu on the right of `02 — SHELVES`, with a direction toggle
beside it, so any sort is one choice away and every order runs both ways.

- **SORT is the house's own menu** (`ChoiceMenu`,
  `src/lib/components/controls/`), blocky like the filters. A cell in the
  label's own type names the sort, with ▾; it opens a column of FILTER's
  blocky cells (52px, 14px mono, the full-ink rule on top, the one in use
  inverted): RECENTLY READ, RECENTLY ADDED, PROGRESS, TITLE, RATING, RANDOM
  (`SORTS`, `src/lib/library/labels.ts`). Choosing one goes to its URL. The
  list hangs from the whole SORT block, ↓ / ↑ included, right edges together.
  Escape, a tap anywhere outside (which opens nothing under it) or the cell
  again close it without choosing. On a TV or a keyboard the open list is a
  focus scope ([`FOCUS.md`](FOCUS.md)): OK opens it on the sort in use, the
  arrows walk the choices and stay inside, OK picks, BACK closes, and the mark
  goes back to the cell. The remote reaches the cell from the shelf tabs with
  ↑. It is not a native `<select>`, whose open list is the system's own and
  whose ←/→ change the sort in place on a TV.
- **While a sort loads, the cells stay.** A sort that takes past 1 s puts the
  grid in outline, and the label says LOADING beside SORT and ↓ / ↑, which
  stay drawn, dimmed to 0.5 and `aria-busy`: the cell holding the mark never
  leaves the page, so OK, ↓ or Enter pressed while it loads still lands, and a
  second pick simply takes over the first. Were LOADING to take their place,
  the focused cell would leave the page and the mark would sit on the body for
  as long as the outline lasted. The cell keeps naming the sort it is leaving
  until the new one has loaded. `tests/library-top-sort.e2e.ts` and
  `tests/tv-library-top.e2e.ts` hold a sort's data 2.5 s to put the outline up
  on purpose, and read where focus is at every frame of it.
- **PROGRESS** (`sort=progress`) is three tiers, as `progressOf` decides
  them: begun and not finished (one page opened is begun), by last read;
  then never opened, newest added first; then the rest, the finished, by
  last read. It's "last read > newest > all", so the series opened a page or
  two don't sink among the finished. ↓ has the begun on top; ↑ sends them to
  the bottom (never opened, then finished, then begun). Unlike the other
  sorts, ↑ doesn't reverse inside a tier: the most recent stays first.
  `progressTier`, `src/lib/server/library.ts`.
- **The toggle beside it turns the order round** (`?dir=asc|desc`). It reads
  A–Z / Z–A beside TITLE and ↓ / ↑ beside the rest, ↓ being high to low:
  most recent, newest, best first. Each sort has its own direction (TITLE
  ascending, the rest descending), and `?dir=` is in the URL only while it's
  turned from that, so links without it mean the default order. Choosing
  another sort drops it. RANDOM has no direction and no toggle.
- **RECENTLY READ counts a series never opened as read when it was added.**
  The key is `COALESCE(last read, added_at)`, PROGRESS's own, so a series a
  scan or ADD just brought sits at the top of the default sort, above
  everything read before it came and below anything read since. **The sort
  only, never the data**: no reading is written, so CONTINUE, HISTORY, the
  reading time, the reading log and tracking never see a read that didn't
  happen. Turned round it's the exact mirror, the longest untouched first,
  adding being the touch: a new add sits near the end, and a series added
  long ago and never opened sits among the oldest reads, not in a block of
  its own at the end. What `added_at` holds decides where a big import lands
  (the scan case asserted in `tests/library-sort-db.spec.ts`): a scan stamps
  a series it finds with no backup behind it (a Mihon download folder alone,
  an anime folder, a novel's backup) with the scan's time, so a first scan of
  a big folder puts all of it on top, the last found first, until something
  is read; an EPUB keeps its file's modified time; a Mihon backup's series
  keep the backup's `dateAdded` (or their first chapter's fetch, or the
  scan's time when the backup has neither) and land where they were added in
  Mihon; ADD from BROWSE stamps the moment of the add. A Work's key is the
  most recent of its parts' keys, so a part just added lifts its Work too.
  RATING's ties stay A–Z either way. Every order still ends in the id, so
  pages stay clean in both directions (`ORDER`, `src/lib/server/library.ts`).
- **On NEW**, RECENTLY ADDED is newest arrival, and turned round, oldest.
- **A Work** sorts by its most recent part under every order (see "Works"):
  RECENTLY READ by the part read last (or, never opened, added), RECENTLY
  ADDED by the part added last, TITLE by the Work's name, RATING by the rated
  parts' average, PROGRESS over the parts' totals.

## Random

The sort's last choice is **RANDOM**, a shuffle kept in the URL
(`sort=random&seed=…`):

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

**One hairline between every pair of cells.** The right-hand group draws the
first rule, on its left (`TopBar`); every cell before SELECT draws the one
after it, on its right: BROWSE, QUEUE and the desktop's FILTER
(`.filter-desk`, whose summary drops its own left rule there). MORE draws its
own, on its left, so the rule goes with it where MORE is hidden (the desktop).
A cell that drew a left rule as well would double the group's into 2px and
leave nothing against SELECT. `tests/library-top-bar.e2e.ts` walks every cell
drawn on each device and wants exactly 1px at each boundary, FILTER open and
closed.

The app's name (the wordmark, in the library header and the desktop sidebar)
is a link to the library. Inside the TV app with two or more servers, the
cell after it says whose library this is, `ON LIVING ROOM`, and OK on it
opens SERVERS ([`ANDROID.md`](ANDROID.md), "Servers"); the wordmark is then
not an arrow stop, so ↑ from the library lands on that cell. The cell is at
most 200 px with 22 px of padding, so a name has 124 px, eleven characters in
the TV's type: `ARCHLINUX` reads whole, and a longer name ends in an ellipsis
at the cell's padding (pinned in `tests/tv-library-top.e2e.ts`).

### It stays

The bar with the name, `/ search` and SELECT (and the selection bar that
replaces it) is sticky on every device: it stays at the top while the grid
scrolls under it, opaque, at z-index 8 (over the tiles, under the bulk bar and
sheets). `TopBar`'s `sticky` pins it on a phone and a tablet. `TopBar` itself
lets a desktop's bar go, since its sidebar stays; the library pins its own
there (`.library > header.bar.sticky`, a desktop-only rule in `+page.svelte`),
so the other screens that use `TopBar` keep a bar that scrolls away on the
desktop. The window is what scrolls on every device (the sidebar is pinned
beside it, not a scrolling container around it), so nothing above the bar
defeats `position: sticky`. On a TV the bar is pinned too, and the KIND band
pins under it once the grid has scrolled up to it: the TV's search is the bar
at the top.

### BACK TO TOP

A screen down the grid (`scrollY` past one `innerHeight`), a **BACK TO TOP ↑**
cell appears in the bottom-right corner: 52px, ruled on its two inner sides,
opaque, over the tiles at the bar's z-index, never a floating circle. A tap
scrolls to the top, smoothly, or at once under reduced motion; focus moves up
to the bar first, since the cell goes as the page passes a screen. It hides
again within a screen of the top, while selecting, where the bulk bar has that
corner, and while FILTER's panel or SORT's list is open, whose scrim it would
otherwise be drawn lit above (both live in a pinned bar's stacking context;
the page reads their `<details open>` and `aria-expanded`). **Each FILTER
counts only where it is drawn**: the top bar's inside the desktop's media
query (`min-width: 1024px` and a fine pointer), the KIND band's inside its
opposite (`max-width: 1023px`, or a coarse pointer, or none), a person's
page's everywhere. A `<details>` that CSS has hidden stays open, so a FILTER
left open at 1200px with the window narrowed to 900px would otherwise hide the
cell for good; `tests/library-top-scroll.e2e.ts` opens each, resizes past it,
and sees the cell. The page keeps 53px under its last row (plus the phone's
safe area) so the cell never sits on the last tiles. A TV, which draws no
cell, keeps its own safe margin there instead (`--safe-y`, 28px at 960x540;
the TV block's rule, restated beside the 53px one because that one outranks
it).

**Not on a TV** (`tests/tv-library-top.e2e.ts`): one BACK from the bottom of
the grid (`scrollY` 729 at 960x540) lands on the first CONTINUE card at
`scrollY` 0, because the climb goes to the screen's start when what it climbs
to is already in sight ([`TV.md`](TV.md)). What it climbs to is the pinned
KIND band's chosen cell (`data-back-climb=".kinds .kc.on"` on the grid);
pointing at a shelf tab, which does not pin, would cost a BACK to land on it
far up the page. A corner cell would only be one more stop for the pad.

**The first row's mark on a TV.** The focus layer brings a focused tile clear
of the pinned bars by its button's edge, and the cover's ring is drawn 7px
outside the cover, which is that edge: coming back up the grid, the focus
line would cover the ring by 6.9px. On a TV the tile's button reaches 7px up
into the tile's own 10px padding, so the ring comes clear with it; nothing
drawn moves.

### MORE

On the tablet, the phone and the TV, a MORE cell after SELECT opens the
sidebar's foot as a sheet (`MoreSheet.svelte`): GET STARTED while it is
unfinished, TO LINK while anything waits, HISTORY, HIGHLIGHTS with its count
while there are any ([`HIGHLIGHTS.md`](HIGHLIGHTS.md)), DOWNLOADS with its
queue, RESCAN (see "RESCAN asks first"), IMPORT LOG with when the last import
came in, HELP, SETTINGS with this device's changed count, and in the TV app
only, SERVERS ([`ANDROID.md`](ANDROID.md), "Servers"). The desktop has the
sidebar itself, so no MORE there.

The sidebar's foot and MORE share one order, in three groups, each parted
from the next by an ink rule: where to go (GET STARTED to DOWNLOADS, with
BROWSE after HIGHLIGHTS in the sidebar), the library's upkeep (RESCAN, IMPORT
LOG), and the app itself (HELP, then SETTINGS last). To make room, a phone under 420px shows the
search hint as `/` alone.

On the desktop, **IMPORT LOG** in the sidebar opens the log of every import
and scan ([`IMPORT-BACKUP.md`](IMPORT-BACKUP.md)), counting a running one in
accent, and **SETTINGS** opens [`SETTINGS.md`](SETTINGS.md)'s screen.

## The links band

**N SERIES TO LINK** has a ✕ after REVIEW →: a plain cell, ruled on its left,
not a second accent action. Put away, it stays away until the count **grows**
past the count it was put away at: a new series to link brings it back, the
same ones again do not. When the queue shrinks meanwhile (series reviewed,
linked, or settled), the count it waits on follows it down, so the next new one
is news again: put away at 46, reviewed down to 36, back at 37.

**Reveal is not news.** With reveal on the band counts hidden series too, so
the count it shows moves when reveal does: off drops it by the hidden ones, on
raises it back. Keeping only the shown number, and following the queue down,
would let reveal off lower it and reveal on count as growth, bringing the band
back with nothing new. So two counts are kept: `pub`, the queue without hidden
series, which is the same with reveal on or off (the page's `toLinkPublic`;
with reveal off it is simply `toLink`, so nothing hidden is ever counted
then), and `all`, the queue with them, known only if it was put away with
reveal on and lowered only with reveal on. The band comes back when `pub`
grows, or, with reveal on, when `all` does. A stored bare number reads as
`pub`. Put away with reveal off, a new **hidden** series to link does not
bring it back with reveal on: `all` was never known; the TO LINK row counts
it.

The ✕'s name is "Put away the series to link until the count grows". Not
"until there are more": a name that holds the word MORE is a second answer to
the bar's MORE, for a screen reader's or voice control's "MORE" as much as
for a test's `getByRole('button', { name: 'MORE' })`.

**Per device, not on the server**: kept in this device's `localStorage`
(`tsundoku.library.links-put-away`, `{ pub, all }`). Why, and what it costs,
is [`LINKS.md`](LINKS.md)'s, "Putting the band away".

**Where the review is reached once it is away**: **TO LINK** with its count,
in the desktop sidebar's foot (after GET STARTED, before HISTORY) and in MORE
(the same place) on the tablet, the phone and the TV, for as long as anything
waits; a series' FIND (`/links?series=`); SETTINGS' Ranobe line while it has
choices waiting; and the band again when one more arrives. The row's count is
the band's own sum (`linkQueueCount(reveal) + ranobeQueueCount()`, also in the
root layout's load, about a millisecond on the seed), so the two never
disagree and a hidden series is not counted with reveal off.

It says **TO LINK**, the review's own short heading, not SERIES TO LINK:
`links-flow.e2e.ts` finds the band as the first thing on the page reading
SERIES TO LINK, and the sidebar comes before the band even where it is
hidden. `tests/links-door.e2e.ts` puts the band away and reaches the review
from the sidebar (desktop) and MORE (phone), on its own seeded database, then
empties the queue through the review's own NONE OF THESE and SEARCH AGAIN and
finds no row; `tests/tv-servers.e2e.ts` walks to MORE's row with the remote's
keys. On a TV the sidebar is not drawn (it is the desktop's, a fine pointer at
1024 px or more), so MORE's row is the TV's way to the review.
`tests/library-top-scroll.e2e.ts` puts it away, reloads, adds a series to
link and sees it back, on its own seeded database.

## The KIND band

The sidebar and the shelf tabs hold shelves; the kind is chosen in a band on
the library itself.

- **The sidebar and the tabs hold shelves only**: NEW (while anything is),
  ALL, the collections in their order, + NEW SHELF, PEOPLE, then a hidden root
  while reveal is on (`listShelves`). There are no SERIES, ONE-OFF, MANGA,
  MANHWA, NOVELS or ANIME shelves. IDR, TO READ, DROPPED and any collection
  stay shelves, whatever they hold: they are made by hand.
- **One row under the shelf tabs, directly over the grid**: `KIND`, then
  **ALL n**, then each kind on this shelf in the registry's order (`KINDS`):
  MANGA, MANHWA, DOUJINS, NOVELS, ANIME, MOVIES, SHOWS, and a new kind by
  being in `KIND_FACTS` (its word is the `nav_shelf_*` plural, in `KIND_WORD`,
  which the compiler makes a new kind fill). It narrows whichever shelf shows:
  TO READ, ANIME is two taps. The chosen cell is inverted, so a shelf and a
  kind show as two inverted cells, one above the other. 40px, cells `0 10px`
  on a phone and `0 14px` above 600px, 13px mono, the count at 0.6; the `KIND`
  label in 12px `text-2`, which the phone drops for room. On the desktop it
  sits under `02 — <SHELF>`, ruled above too, and has no FILTER: that stays in
  the top bar. `tests/library-kinds-frame.e2e.ts` pins these measurements.
- **Each cell counts this shelf with every other filter applied**, in one
  grouped read (`kindCounts`, `src/lib/server/library.ts`): a Work counts once
  under each kind it has a part of, and once in ALL, so ALL is what the grid
  shows and not the sum. The active tab says `23 OF 64` while a kind narrows
  it, and the section label names it first: `02 — TO READ · ANIME · RATED 4+`.
- **It writes `?kind=`**, the same parameter FILTER's KIND row writes on a
  person's page, which has no band. On the library FILTER has no KIND row,
  its badge does not count a kind, and its CLEAR ALL does not clear one: the
  band holds it. **The kind is remembered across shelves** because
  `shelfHref` carries every filter parameter; ALL clears it; it is in the URL,
  never a setting, so the wordmark and a fresh launch start at ALL. **One kind
  at a time**: a tap chooses, as a tab does.
- **A kind not on this shelf is not drawn**, except the one chosen: moved to a
  shelf with none of it, it stays, drawn at 0, dimmed (0.4) and still
  inverted, and the grid says `No anime on Dropped.` / `The shelf holds 31.`
  with **✕ ALL KINDS · SHOW 31**. Unlike a language, a kind the shelf doesn't
  hold is not dropped from the URL. With other filters on as well, the grid's
  line is FILTER's own, "Nothing on X matches these filters". With one kind
  or none to tell apart the band is ALL n alone (and FILTER), the same height,
  so the grid doesn't jump between shelves. LANGUAGE offers what the shelf
  holds of the chosen kind: MANHWA offers none, so choosing it drops JA.
- **SERIES and ONE-OFF are FILTER's FORM row**: ANY · SERIES · ONE-OFF
  (`?form=`), about shape, not kind (see [`FILTERS.md`](FILTERS.md)).
- **Old links answer 308** with the filter in the shelf's place, beside
  FAVOURITES and the rest (`legacyShelf`): `?shelf=k:anime` is
  `?shelf=all&kind=anime`, `?shelf=series` is `?shelf=all&form=series`, any
  other parameter kept. A kind is any the registry names, so `k:doujin` lands
  on doujins. `listSeries` still reads an old key as its filter, for a page
  asked for by a tab loaded before the shelves changed.
- **On the phone it scrolls sideways**, never wraps or collapses; FILTER is
  pinned at its right end, the cells scrolling under it, and a cell cut off at
  the edge is the cue. The chosen cell is kept in view, as the tabs keep
  theirs. It takes 40px above the grid.
- **It pins; the tabs don't.** As the grid scrolls the band stops under the
  top bar (`top: var(--header-h)`, z 7, the bar is 8) and gains a first cell,
  the shelf's name with ▴ (`TO READ ▴`), a button that scrolls back to the
  tabs and puts the mark on the shelf showing (on the desktop, back to the
  band's own place); it scrolls, it goes nowhere, so it is not a link. Pinned
  is measured, not guessed: a marker just above the band, and the band held
  apart from it. So the pinned chrome is 60 + 40px on a phone.
- **An open SORT list is drawn over it.** The list is 7 and the band 7 (9 on a
  TV) in one stacking context, and the band comes later in the page, so it
  would win the tie and cut a strip out of the list. While the list is open
  the band steps down to 6, still over the grid (whose highest layer is 3) and
  under the list; the list stays under the top bar (8), so scrolled up under
  it the list goes under the bar, and a sheet from the bar (20) is over both.
  Closed, the band is at 7 again. FILTER's panel needs nothing: it hangs
  inside the band's own layer on a phone, tablet and TV, and inside the top
  bar's on the desktop. `tests/library-top-scroll.e2e.ts` asks
  `elementFromPoint` at the centre of every choice and every FILTER cell, at
  the top and pinned, on all four devices; `tests/tv-library-top.e2e.ts` at
  each choice the remote walks.
- **FILTER's cell keeps its own vertical rhythm and focus mark**: it is a
  `<details>` summary, 39px under the band's hairline, marked inside on a TV,
  not a `<button>`.
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
- **A FILTER choice made while it is pinned opens at its start too**: the same
  landing, from FILTER at the band's end or the desktop's in the top bar, once
  the filters have really changed ([`FILTERS.md`](FILTERS.md), "The FILTER
  panel"). `landedAtBand` in `tests/library-top-scroll.e2e.ts`, which both
  cases use, wants the band's top on the held bar's bottom (±1px) and the band
  unpinned, as well as the first tile under the band.
- **A shelf opens at its top**, unlike a kind. Every shelf link (`ShelfTabs`:
  the tabs, the desktop's sidebar, the waiting outline's tabs) lets SvelteKit
  scroll as for any link, which jumps (reduced motion or not), and the shelf
  already showing goes to its top too; keeping the scroll would open a shelf
  picked mid-grid partway down another shelf's list. Focus stays on the tab
  picked (`data-sveltekit-keepfocus`), so a TV's mark stays on the tab row;
  BACK puts the last shelf back where it was left (the library's snapshot, see
  [`NAVIGATION.md`](NAVIGATION.md)). On a phone or tablet the tabs don't pin,
  so mid-grid they are reached by the pinned band's `TO READ ▴`, a button
  that scrolls to them, not a shelf link. + NEW keeps the scroll: it opens a
  field where it is. `tests/library-top-scroll.e2e.ts` (all four devices)
  and `tests/tv-library-top.e2e.ts`.
- **A TV's ← from the first collection's tab reaches ALL.** ALL is 49-144 and
  the first collection starts at 144, and the focus layer's half-pixel slack
  (`isInDirection`, `src/lib/focus/geometry.ts`) reads a touching edge as
  "left of it". `tests/tv-library-top.e2e.ts` walks ↓ ↓ to the tabs, back to
  ALL, → to the first collection, OK, then ← and wants ALL.
- **On a TV** it is a 56px focus row of its own under the tabs, inside the
  safe margin. **← → move focus only**: each cell is a link, so the grid
  doesn't change until **OK**, which chooses (and keeps focus on the cell).
  The focus line under it says what OK will do: `ANIME · 23 ON TO READ` and
  `OK SHOWS THEM · THE GRID WAITS`. Its key hints read OK OPEN, as on a tile:
  `FocusLine` draws its hints for every stop, and is not the library's. ↓
  goes into the grid; the band then pins at the top in the tabs' place,
  `TO READ ▴` first, so the pinned rows are 56 + 64px; OK on that cell brings
  the tabs back with the mark on the shelf. BACK from the grid climbs to the
  band's chosen cell, which is in view, so it goes on to the screen's start.
  ↑ from the grid's first row goes where the focus layer's geometry sends it
  (the top bar, under the pinned band), not to the band; the pinned band is
  reached by BACK's climb or the keys along it, and the layer is not the
  library's. `tests/tv-library-kinds.e2e.ts`.
- **What stacks above the grid**, in order: the status bands (SCANNING,
  failed downloads, duplicates, SERIES TO LINK), CONTINUE, the section label,
  the tabs, then the band, and nothing between the band and the grid. The
  waiting outline draws the band's row too (`WaitingScreen`), and a band tap
  outlines the grid from 1 s as a tab does.
- **A tile that holds the mark when the outline draws is unmounted, and given
  back.** The grid and `GridOutline` are one `{#if outlined}` branch, so a
  navigation the screen starts under a focused tile (a filter chosen while the
  mark is in the grid) takes the tile off the page and the mark falls to
  `<body>`. So the page notes the tile's focus id before the outline is drawn
  (`$effect.pre`) and, once the grid is drawn, gives the mark back to that
  tile, or to the KIND band's chosen cell when the filter took the tile away,
  but only while `<body>` still holds it: a press made during the outline (a
  second filter, BACK) keeps its own mark. A mark on a band cell or on SORT is
  never noted; those keep their own focus (`data-sveltekit-keepfocus`). Two
  cases in `tests/tv-library-top.e2e.ts`: ALL from DOUJINS keeps the tile and
  gives it the mark back, and NOVELS from MANGA takes it away and the mark
  lands on `kind-novel`. **Only a pointer or a script reaches the state**:
  every pad press that starts a library navigation keeps the mark on its own
  cell, and a BACK into the library starts with the mark on `<body>`
  (measured on the `tv` project; [`TV.md`](TV.md)).

## RESCAN asks first

**RESCAN** in the desktop sidebar opens the house's ConfirmSheet,
`RESCAN THE LIBRARY FOLDER?`, saying what will happen: it reads the library
folder on the server again, new series appear on NEW as they are found,
nothing is removed, and roughly how long the last scan took when one has
finished (`lastScanTook`: the newest finished job that isn't a backup's
import). **CANCEL** and **RESCAN**, CANCEL where the sheet opens, so OK or
Enter at once is the safe answer; Esc and the scrim cancel too. The sheet
posts the same `?/scan` the sidebar's form does, and its answer is taken the
same way: a refusal is the note under the row (`rescanNote`), then the
library; a scan that waits behind a backup's import shows SCAN_WAITS there
from the server's own queue (`scanWaits` on the layout's data, set only while
a scan someone asked for is queued), until the scan starts. **A scan already
running is joined at once**, without the question: there is nothing new to
agree to. **Without script** the sidebar's form is a plain form, and posts.
`tests/rescan-confirm.e2e.ts` (its own seeded database, since one case stages
a running scan) and `tests/library-layout.e2e.ts`.

**Every place that starts a scan**, listed with
`rg -n 'action="/?\?/scan"|startScan\(|runQueued\(' src`:

- **Asks:** the sidebar's RESCAN (`+layout.svelte`), and MORE's RESCAN,
  which presses that same form: the only places one stray tap reaches.
- **Doesn't ask, because scanning is what the screen is for:** START SCAN on
  the empty library (`StartFirstDay`) and GET STARTED's scan step
  (`StartList`).
- **Doesn't ask, and why:** typing `/scan` in a search field (on `/search`, or
  any top search bar through `POST /api/command`; a typed command is its own
  question), `POST /api/scan` (the sync timer's and a script's endpoint, no
  screen), and the scans that follow on their own (`engine/run.ts` after a
  download, a backup's import through `runQueued`).

**MORE's RESCAN** is the sidebar's, not a second one. The row sits between
HELP and IMPORT LOG, as the sidebar keeps it beside IMPORT LOG, on the phone,
the tablet and the TV. It closes MORE, then presses the sidebar's own form
(`form[data-rescan]`, `requestSubmit`), which is in the layout on every device
and drawn only on the desktop. So the question, CANCEL focused, the scan
joined without asking while one runs, and the action's answer are the
sidebar's, from MORE too. MORE closes first because two sheets open at once
would both close on one Escape (and on a TV's BACK, which sends it), and so
that focus is back on the bar's MORE cell when the question opens: CANCEL
returns it there, which is how a TV reaches the sheet with focus on CANCEL and
leaves it.

The answer has no row to sit under where there is no sidebar, so it is a band
at the top of the screen (`.rescan-band`, the layout's, hidden where the
sidebar shows): a refusal, whole and wrapped, put away with ✕ (it would
otherwise stay until the next press, as the sidebar's note does), and
SCAN_WAITS while the server's queue holds a scan, with no ✕, gone when the
scan starts. On a TV the ✕ is a stop ↑ from the bar reaches, and putting the
band away with a key's press (a remote's OK, a keyboard's Enter) hands the
mark back to where it came from, not to the page's body, while a tap does not:
a tap focuses the ✕ on Chrome for Android and the phone app's WebView too, and
a hand-back would bring a text field's soft keyboard back with it. The band
follows `scanWaits` like the sidebar's note, so a scan queued from anywhere
(`/scan`, GET STARTED) shows it on a phone too. MORE needs script, so it has
no no-script path; the sidebar's form keeps its own.
`tests/rescan-confirm.e2e.ts` (the phone and both tablets: CANCEL starts
nothing twice, a confirmed RESCAN posts once and draws the band, a running
scan is joined at once), `tests/tv-servers.e2e.ts` (the remote reaches the
row, the question opens on CANCEL, OK there posts nothing and focus is back on
MORE; and, confirmed on the empty library, the band shows, ↑ reaches its ✕,
and OK puts it away with the mark back on MORE), and
`tests/settings-flow.e2e.ts` (MORE's rows).

## What a scan reads

START SCAN (and RESCAN or `/scan` later) reads a Mihon backup from
`$LIBRARY_ROOT/Mihon/autobackup/`, tsundoku's own downloads under
`$LIBRARY_ROOT/devices/tsundoku/Mihon/`, `$LIBRARY_ROOT/H/.Hentoid/`, and the
EPUBs under `$LIBRARY_ROOT/Library/` ([`IMPORT-MIHON.md`](IMPORT-MIHON.md),
[`IMPORT-HENTOID.md`](IMPORT-HENTOID.md), [`IMPORT-EPUB.md`](IMPORT-EPUB.md)).
A backup can also be uploaded from the browser on IMPORT A BACKUP
([`IMPORT-BACKUP.md`](IMPORT-BACKUP.md)). A `Mihon/` with no backup in it is
no source. With none of them present, it says where it looked. Development
runs on `yarn run seed`'s sample titles unless you import.

## The rest of the screen

- **The long-press sheet's** `▶ CH. N` resumes where the series was left
  (`resumeEntry`, [`READER.md`](READER.md)). SERIES and TAGS in the sheet open
  the series screen, TAGS straight into its SHELVES & TAGS sheet.
- **A folded book** (one book in several languages) is one tile with its
  languages in a corner badge, `EN · JA` ([`EDITIONS.md`](EDITIONS.md)).
- **Covers** come from the files or the source site ([`COVERS.md`](COVERS.md)).
  A series with none keeps the striped placeholder.
- **The login screen** is assembled from the empty state's parts: numbered
  label, hairline field, primary button.

## Limits

- **TAG in the bulk bar is disabled.** Tags are edited one series at a time, on
  the series screen; there is no bulk tag editor.
- **No list view.** The grid is the only layout.
- **One kind at a time.** `?kind=` reads a single kind, so MANGA and MANHWA
  together (the comic family) is not a choice.
- **ESC does not end SELECT on the library.** In a source's catalog Escape
  ends SELECT once no sheet or FILTER panel is open to close first
  ([`BROWSE.md`](BROWSE.md), "SELECT in a catalog"); the library should
  follow it, and does not yet.
