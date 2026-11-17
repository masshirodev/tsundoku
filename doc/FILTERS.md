# Filters

The library's FILTER panel narrows whatever shelf is showing: by rating,
favourite, form, language, date added, download, follow, reading and (in
reveal) hidden. This doc covers the panel, the rules behind each row, and
making a new shelf.

## Shelves are where, filters are which

A shelf picks a part of the library: ALL, NEW, a collection. A filter
narrows **whichever shelf is showing**, and filters combine with each other
and with the shelf: unrated manhwa, not-favourited novels rated 3+, Japanese
one-offs. The kind is a filter too, chosen on the library's KIND band rather
than in the panel ([`LIBRARY.md`](LIBRARY.md), "The KIND band").

Some `?shelf=` keys name what is now a filter, and redirect (308) to ALL with
that filter, keeping every other parameter (`legacyShelf`,
`src/lib/library/filters.ts`):

| `?shelf=`                                | Lands on                                |
| ---------------------------------------- | --------------------------------------- |
| `favourites`                             | FAV → FAV (`?fav=1`)                    |
| `rated4` (and 3.5+)                      | RATING → AT LEAST (`?min=8`)            |
| `downloaded`                             | DOWNLOADED → YES (`?dl=1`)              |
| `series`, `oneoff`                       | FORM → SERIES, ONE-OFF (`?form=series`) |
| `k:<kind>` (any kind the registry names) | the KIND band's cell (`?kind=manga`)    |

FORM splits the library by shape, which a kind band cannot say:

- **ONE-OFF**: single books. A series of a kind GROUP binds into a series of
  books, holding one book or none. An extra does not make a series. One rule
  says what a book is, and every reader counts with it:
  - **the kinds** are the registry's `grouping === 'books'`
    (`kindsGrouped('books')`, `src/lib/library/kinds.ts`; today the doujin
    alone), never a kind's name;
  - **a book** is an entry that is neither shadowed (an edition folded into
    its base, or a duplicate the review set aside) nor front or back matter
    (`matter != ''`, an extra): `isBookSql` in `src/lib/server/books.ts`.
    The library card's `entryCount` counts exactly these rows.

  The readers, all on `isBookSql`, `entryCount` or the same two conditions:
  - the server's `ONE_OFF_SQL` (`src/lib/server/books.ts`, which
    `src/lib/server/library.ts` imports: FORM's count, its grid, and the
    `oneoff` and `series` shelf keys);
  - the device's `isOneOff` (`src/lib/library/filters.ts`, over the card's
    `entryCount`, when CACHED filters the offline library; a person's page
    draws no FORM row);
  - the binder's `isSingleton` (`src/lib/server/books.ts`, and its
    `bookCount`);
  - `seriesOfBooks` (`books.ts`): where MOVE TO… and ADD TO EXISTING send a
    book, a series of two books or more, and its `N BOOKS`;
  - the series screen's `isBookSeries` (`src/lib/library/series.ts`): whether
    a doujin's contents are a cover grid of books;
  - a person's page (`src/lib/server/people.ts`): its `entries` and pages are
    books, and its `groupable` is a book with nothing beside it (below), the
    one `groupIntoSeries` binds;
  - `singletonCandidates` (`books.ts`): the books a suggestion may name, one
    book with nothing else in the series (below).

  ```sh
  rg -n "isBookSql\(|ONE_OFF_SQL|isOneOff\(|isSingleton\(|isBookSeries\(|entryCount !== 1|e\.edition_of IS NULL|entryIdsOf|foldEditions" src
  ```

  (`history.ts`'s `edition_of IS NULL` in that list picks an entry by
  position, not a count of books; the counts in `people.ts` and `?/fold` are
  written out rather than through `isBookSql`, which is a string for an
  `entries` alias.) So a doujin holding one book and an extra is a ONE-OFF on
  FORM, the device and the binder, its count and its filtered grid agree,
  MOVE TO and ADD TO EXISTING do not offer it as a series, the series screen
  draws it as one book, a person's page counts it as one, and no suggestion
  names it (`tests/library-db.spec.ts`, "ONE-OFF counts one book the same way
  everywhere").

  **GROUP refuses to bind such a book** (`"…" holds an extra or a duplicate
beside its book, which grouping can't carry`): it would move the book
  alone, and the emptied singleton's delete would take the extra with it. So
  every place that offers a book to GROUP asks what GROUP binds: one book
  **and** nothing beside it, which is `entryIdsOf(…).length === 1`. Those are
  the series screen's suggestion (`singletonCandidates`) and a person's
  page's `groupable`. GROUP does not bind a book's extras along with it.

  **FOLD AS LANGUAGES is a different rule**: the bulk bar offers it over
  cards with `entryCount === 1` (`src/routes/+page.svelte`, `foldCodes`), but
  it ends in the duplicates review's `foldEditions`, which folds one
  `edition_of IS NULL` entry (`entryIdsOf`, `src/lib/server/books.ts`) and
  leaves a folded edition beside the book out of the count. So `?/fold`
  (`src/routes/+page.server.ts`) accepts only a book that `isBookSql` counts
  once **and** `edition_of IS NULL` counts once: a folded edition beside the
  book still passes, an extra or a set-aside duplicate is refused with `A BOOK
WITH AN EXTRA OR A DUPLICATE BESIDE IT CAN'T FOLD` rather than sent to a
  review that would swallow it (`applyPending` in `src/lib/server/dupes.ts`
  drops a refused decision and answers it with the pair and its reason; the
  pair comes back to the review undecided).

- **SERIES**: everything else. A Mihon series with one chapter so far is
  still a series, which is why ONE-OFF means a single book and not "anything
  with one entry": read that way, every Mihon series with one chapter so far
  would be a one-off. The exception is a gallery source, whose galleries are
  books ([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Gallery sources").

## The FILTER panel

`src/lib/components/controls/FilterPanel.svelte`. A **FILTER** cell, with how
many are on as a green badge, opens a panel with one row per filter:

| Row        | Choices                                                                               | In the URL                           |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| RATING     | ANY · UNRATED · AT LEAST, then the blocks                                             | `?min=1..10`, `?rated=0`             |
| FAV        | ANY · FAV · NOT FAV                                                                   | `?fav=1`, `?fav=0`                   |
| FORM       | ANY · SERIES · ONE-OFF, on the library                                                | `?form=series`, `?form=oneoff`       |
| KIND       | ANY, then each kind on the shelf, on a person's page only (the library's is its band) | `?kind=manga`                        |
| LANGUAGE   | ANY, then each language on the shelf (EN, JA)                                         | `?lang=ja`                           |
| DATE ADDED | ANY · SINCE and a date                                                                | `?added=2026-08-01`                  |
| DOWNLOADED | ANY · YES · NO                                                                        | `?dl=1`, `?dl=0`                     |
| FOLLOWED   | ANY · ONLY, while something visible is followed ([`DOWNLOADS.md`](DOWNLOADS.md))      | `?followed=1`                        |
| READING    | ANY · UNREAD · READ                                                                   | `?progress=unread`, `?progress=read` |
| ● HIDDEN   | ANY · ONLY                                                                            | `?hidden=1`                          |

- **RATING is one line.** Dragging the blocks (the ratings slider in mode
  `min`) picks AT LEAST by itself; AT LEAST alone starts at 4+; UNRATED and a
  threshold replace each other. Written in five steps: RATED 3.5+ is `?min=7`.
- **A choice applies at once**, and the panel stays open until DONE, a tap
  outside it, or FILTER again. ✕ CLEAR ALL drops every filter and keeps the
  shelf, the sort and the shuffle, and on the library the kind, which is the
  band's.
- **Made while the KIND band is pinned, a choice lands at the grid's start**,
  as a kind chosen there does: the band under the top bar, unpinned, the new
  results' first row under it. The choices keep the scroll (`noscroll`), so
  without this, mid-grid, the new results would open partway down their
  list. FilterPanel's `onchoose` says a choice is being made (a row's cell,
  CLEAR ALL, the date, a main-button press on the rating blocks, Enter on
  one, or ← → on a TV, where they move); the library notes the page it was
  made on and lands once the next screen has drawn, only when that page is
  the one left, by a link or a goto, and the filters really changed. So a
  choice already on, a choice made at the top with the band where it lies,
  and BACK move nothing. The desktop's FILTER, in the pinned top bar, lands
  the same way when the band is pinned under it. The rating blocks' own
  links scroll to the top first, and land from there. The note lives only as
  long as the press or key that made it: any later press or key drops it
  before its own handlers run, and a kind cell replaces it, so a press on
  the blocks that chooses nothing (a right-click, ← off a TV, a cancelled
  drag) cannot land a later kind chosen at the top. A person's page and
  BROWSE's filter pass no `onchoose`. `tests/library-top-scroll.e2e.ts`, on
  all four devices.
- **Where it sits:** pinned at the right end of the KIND band on the phone,
  tablet and TV, the band's cells scrolling under it, in the band's 13px
  with 14px a side; in the top bar beside SELECT on the desktop, where the
  panel is 640 wide from the bar's right edge. Full width under the band
  otherwise, and on the phone each label sits above its choices so RATING
  keeps a whole line for the blocks.
- **The scrim** leaves the sidebar and the top bar lit on the desktop; on the
  phone and tablet it dims everything but the tab bar.
- **The active tab scrolls into view** on a row of tabs that scrolls.
- **At a glance:** the active tab counts what's showing, `44 OF 188`, and the
  section label names the shelf, the kind first, then the filters:
  `02 — ALL · MANHWA · RATED 4+ · NOT FAV`. FILTER's badge counts what the
  panel holds, so on the library not the kind (`activeCount(f, false)`). The
  desktop's count moves into the section label, since its sidebar keeps
  plain totals.
- **Counts:** only the shelf being shown is counted, once with its filters
  (the grid's total) and once without (`shelfTotal`, only while a filter is
  on). The choices carry no numbers.
- **Filters that leave nothing** say so about the shelf, not the library:
  "Nothing on All matches these filters. The shelf holds 23." and
  ✕ CLEAR · SHOW 23. A kind alone that leaves nothing is the band's to say:
  "No anime on Dropped." and ✕ ALL KINDS · SHOW 31.

## Rules worth knowing

- **Links, no script needed.** Each choice is a link to the current URL with
  that filter changed (`withFilters`); the panel is a `<details>`; DATE ADDED
  is a GET form whose SET button only shows without script. Other shelves'
  tabs carry the filters along (`shelfHref`).
- **A tap before the page hydrates keeps the panel open.** The `<details>`
  is the truth and the component only follows it: it reads `open` from the
  element on mount, keeps it by `toggle`, and closes through the element
  (DONE, the scrim). It does not use `bind:open`, which writes its own
  `false` onto the element at hydration and shuts a panel the finger has
  just opened, so on a slow tablet a fast first tap would come to nothing.
  `tests/library-top-bar.e2e.ts` taps FILTER with the app's scripts held
  back and checks it is still open once they run.
- **In the desktop's top bar FILTER draws the rule on its right**, against
  SELECT, and not its own left one: the cell before it draws that
  ([`LIBRARY.md`](LIBRARY.md), "The top bar"). On the KIND band and a
  person's page FILTER draws its left rule, the divider from the cells
  before it. Its cell is marked inside on a TV, as the cells beside it are.
- **Hidden means hidden** ([`PRIVACY.md`](PRIVACY.md)). The HIDDEN row exists
  only while reveal is on: `parseFilters` drops `?hidden=1` otherwise, and the
  SQL checks again. It's the panel's one magenta row, and ending reveal drops
  it with everything hidden.
- **KIND is one kind inside any shelf**: the manga in TO READ. On the
  library it is the KIND band, which writes `?kind=`; the panel's KIND row
  is a person's page's alone, offered only where the page holds two kinds or
  more. A kind the shelf doesn't hold stays in the URL: the band keeps it at
  0, so it is still chosen on the next shelf. On CACHED and a person's page
  it filters on the device.
- **LANGUAGE offers only what the shelf holds**, as it stands without filters
  but with the KIND band's kind, visible only (`languagesOn`). Taking the
  shelf without its filters means choosing one language doesn't make the
  others vanish from the row. With nothing to offer there's no row at all;
  a library whose languages are all on hidden books has no row with reveal
  off. `translated`, `rewrite`, `speechless` and `text cleaned` describe a
  book, not a language, and are never offered. A folded book matches each of
  its languages ([`EDITIONS.md`](EDITIONS.md)). Switching to a shelf without
  the chosen language drops it (a 307) rather than showing an empty grid.
- **DATE ADDED** compares with the start of that day on the server.
- **READING** is where the reading stands, useful mainly to sort through
  hidden series, which never show in CONTINUE's short list. UNREAD is never
  opened (not a page) and nothing read. READ is begun and every chapter
  read; a finished series that gains a chapter isn't READ until that one is.
  It combines with HIDDEN like any other filter: `?hidden=1&progress=unread`
  is the hidden series you've never opened. The rule is written twice and
  tested to agree: `PROGRESS_SQL` in `src/lib/server/library.ts` and
  `progressOf` in `src/lib/library/filters.ts`, which CACHED uses on the
  device.
- **Begun and not finished is an order, not a filter.** The series with a
  page or two opened are kept in view and placed at the top or the bottom by
  the PROGRESS sort ([`LIBRARY.md`](LIBRARY.md), "Sort and direction"), so
  READING has no IN PROGRESS choice. `?progress=reading` is simply no
  filter.
- **UNRATED wins** over a threshold if a hand-made URL has both.
- **CACHED, offline,** filters on the device, with the same rules
  (`matches`): every filter is answerable there.
- **A person's page** has the same panel, filtering on the device (it holds
  every item already) and keeping nothing in its URL, as its own tabs never
  are. Its tabs are ALL, UNREAD and BY SERIES; favourites and ratings are
  filters there too. Its items carry their languages and whether they're on
  disk for it. It has no READING row (`reading={false}`): its UNREAD tab
  already does that.

## A new shelf

- **Phone and tablet:** `+ NEW` is the last tab. It opens a sheet with one
  field; CREATE posts `?/newShelf` and lands on the new shelf.
- **Desktop:** `+ NEW SHELF` ends the collections in the sidebar and turns
  into a field in place: ↵ creates, Esc cancels.
- Both are driven by `?new=shelf` in the URL, so both work without script.
- A name already taken lands on that shelf rather than making a twin
  (`createCollection`).
- A new shelf is empty: no FILTER cell, a SELECT button, and one line on how
  to fill it: "Long-press a cover and tick it under SHELVES, or SELECT several
  and + SHELF."

## Speed

Every card says whether it has a chapter on disk (`downloaded`, for
filtering CACHED on the device). Migration 30 widened the covering index
`entries_card` with `available`: without it the whole revealed library's
card stats took 34 ms instead of 16; with it, 23.

## Limits

- A shelf cannot be renamed, reordered or deleted.
- A combination of filters cannot be saved as a shelf of its own.
- A person's page doesn't remember its filters across visits.
- Search doesn't take the library's filters; only the kind is carried, to
  pick which sources SEARCH THE SOURCES asks.
