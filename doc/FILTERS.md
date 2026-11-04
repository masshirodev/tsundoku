# Filters

Card c68 ("More library filters: unfavourited, unrated, hidden, languages; add
a shelf from the sidebar"). The handoff is `doc/handoffs/done/Filters.zip`,
mirrored as
[`design/handoff/Library Filters.dc.html`](design/handoff/Library%20Filters.dc.html),
of which **turn 3** is what's built (turns 1 and 2, an ONLY row and a panel
beside an AT LEAST band, were superseded by it). The brief is
[`briefs/done/LIBRARY-FILTERS.md`](briefs/done/LIBRARY-FILTERS.md).

## Shelves are where, filters are which

A shelf picks a part of the library: ALL, SERIES, ONE-OFF, a kind, a
collection. A filter narrows **whichever shelf is showing**, and filters
combine with each other and with the shelf: unrated manhwa, not-favourited
novels rated 3+, Japanese one-offs.

So turn 3 took three shelves off the tabs and made them filters:

| Was the shelf       | Is now                       |
| ------------------- | ---------------------------- |
| FAVOURITES          | FAV → FAV (`?fav=1`)         |
| RATED 4+ (and 3.5+) | RATING → AT LEAST (`?min=8`) |
| DOWNLOADED          | DOWNLOADED → YES (`?dl=1`)   |

An old link lands on the same books: `?shelf=favourites`, `rated4` and
`downloaded` redirect (308) to ALL with the filter that replaced them
(`legacyShelf`, `src/lib/library/filters.ts`).

Two shelves joined, splitting the library by what a thing is:

- **ONE-OFF**: single books, a doujin series that holds one book (exactly
  `isSingleton` in `src/lib/server/books.ts`).
- **SERIES**: everything else. A Mihon series with one chapter so far is
  still a series, except from a gallery source, whose galleries are books
  ([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Gallery sources").

## The FILTER panel

`src/lib/components/controls/FilterPanel.svelte`. A **FILTER** cell, with how
many are on as a green badge, opens a panel with one row per filter:

| Row        | Choices                                                                              | In the URL                           |
| ---------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| RATING     | ANY · UNRATED · AT LEAST, then the blocks                                            | `?min=1..10`, `?rated=0`             |
| FAV        | ANY · FAV · NOT FAV                                                                  | `?fav=1`, `?fav=0`                   |
| KIND       | ANY, then each kind on the shelf (MANGA, MANHWA, DOUJINS, NOVELS, ANIME)             | `?kind=manga`                        |
| LANGUAGE   | ANY, then each language on the shelf (EN, JA)                                        | `?lang=ja`                           |
| DATE ADDED | ANY · SINCE and a date                                                               | `?added=2026-08-01`                  |
| DOWNLOADED | ANY · YES · NO                                                                       | `?dl=1`, `?dl=0`                     |
| FOLLOWED   | ANY · ONLY, while something visible is followed ([`DOWNLOADING.md`](DOWNLOADING.md)) | `?followed=1`                        |
| READING    | ANY · UNREAD · READ                                                                  | `?progress=unread`, `?progress=read` |
| ● HIDDEN   | ANY · ONLY                                                                           | `?hidden=1`                          |

- **RATING is one line.** Dragging the blocks (the ratings slider in mode
  `min`) picks AT LEAST by itself; AT LEAST alone starts at 4+; UNRATED and a
  threshold replace each other. Written in five steps: RATED 3.5+ is `?min=7`.
- **A choice applies at once**, and the panel stays open until DONE, a tap
  outside it, or FILTER again. ✕ CLEAR ALL drops every filter and keeps the
  shelf, the sort and the shuffle.
- **Where it sits:** pinned at the right end of the tabs on the phone and
  tablet, the tabs scrolling under it; in the top bar beside SELECT on the
  desktop, where the panel is 640 wide from the bar's right edge. Full width
  under the tabs otherwise, and on the phone each label sits above its
  choices so RATING keeps a whole line for the blocks.
- **At a glance:** the active tab counts what's showing, `44 OF 188`, and the
  section label names the shelf and its filters:
  `02 — MANHWA · RATED 4+ · NOT FAV`. The desktop's count moves into the
  section label, since its sidebar keeps plain totals.
- **Counts:** only the shelf being shown is counted, once with its filters
  (the grid's total) and once without (`shelfTotal`, only while a filter is
  on). The choices carry no numbers.
- **Filters that leave nothing** say so about the shelf, not the library:
  "Nothing on Novels matches these filters. The shelf holds 4." and
  ✕ CLEAR · SHOW 4.

## Rules worth knowing

- **Links, no script needed.** Each choice is a link to the current URL with
  that filter changed (`withFilters`); the panel is a `<details>`; DATE ADDED
  is a GET form whose SET button only shows without script. Other shelves'
  tabs carry the filters along (`shelfHref`).
- **A tap before the page hydrates keeps the panel open** (c105). The
  `<details>` is the truth and the component only follows it: it reads
  `open` from the element on mount, keeps it by `toggle`, and closes through
  the element (DONE, the scrim). It used `bind:open` until 2026-11-03, which
  wrote its own `false` onto the element at hydration and shut a panel the
  finger had just opened, so on a slow tablet a fast first tap came to
  nothing. `tests/library-top-bar.e2e.ts` taps FILTER with the app's scripts
  held back and checks it is still open once they run.
- **In the desktop's top bar FILTER draws the rule on its right**, against
  SELECT, and not its own left one: the cell before it draws that (c431;
  [`LIBRARY.md`](LIBRARY.md), "The top bar"). On the tabs and a person's
  page FILTER still draws its left rule, the divider from the tabs.
- **Hidden means hidden** ([`PRIVACY.md`](PRIVACY.md)). The HIDDEN row exists
  only while reveal is on: `parseFilters` drops `?hidden=1` otherwise, and the
  SQL checks again. It's the panel's one magenta row, and ending reveal drops
  it with everything hidden.
- **KIND is one kind inside any shelf** (asked for on 2026-10-29: the
  manga in TO READ). The kind shelves stay where they were; KIND is for the
  shelves that mix kinds, so it's offered only where the shelf holds two or
  more (never on a kind shelf), and a kind the shelf doesn't hold drops from
  the URL as a language does. On CACHED and a person's page it filters on
  the device.
- **LANGUAGE offers only what the shelf holds**, as it stands without filters,
  visible only (`languagesOn`). With nothing to offer there's no row at all.
  The real library's languages are almost all on Hentoid books, behind
  reveal: with reveal off today the row doesn't exist. `translated`,
  `rewrite`, `speechless` and `text cleaned` describe a book, not a language,
  and are never offered. A folded book matches each of its languages
  ([`EDITIONS.md`](EDITIONS.md)). Switching to a shelf without the chosen
  language drops it (a 307) rather than showing an empty grid.
- **DATE ADDED** compares with the start of that day on the workstation.
- **READING** is where the reading stands, asked for on 2026-10-14 mainly to
  sort through hidden series, which never show in CONTINUE's short list.
  UNREAD is never opened (not a page) and nothing read. READ is begun and
  every chapter read; a finished series that gains a chapter isn't READ
  until that one is. It combines with HIDDEN like any other filter:
  `?hidden=1&progress=unread` is the hidden series you've never opened. The
  rule is written twice and tested to agree: `PROGRESS_SQL` in
  `src/lib/server/library.ts` and `progressOf` in
  `src/lib/library/filters.ts`, which CACHED uses on the device. Not drawn
  by a handoff: it's one more row of the panel's existing shape.
- **Begun and not finished is an order, not a filter.** READING had an IN
  PROGRESS choice for a day; the owner wanted the series with a page or two
  opened kept in view and placeable at the top or the bottom, which is the
  PROGRESS sort ([`LIBRARY.md`](LIBRARY.md), "Sort and direction"). An old
  `?progress=reading` is simply no filter.
- **UNRATED wins** over a threshold if a hand-made URL has both.
- **CACHED, offline,** filters on the device, with the same rules
  (`matches`): every filter is answerable there.
- **A person's page** has the same panel, filtering on the device (it holds
  every item already). Its tabs lost FAV and RATED 4+ as the library's shelves
  did, leaving ALL, UNREAD and BY SERIES. Its items carry their languages and
  whether they're on disk for it. It has no READING row (`reading={false}`):
  its UNREAD tab already does that.

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

Every card now says whether it has a chapter on disk (`downloaded`, for
filtering CACHED on the device). Rung 30 widened the covering index
`entries_card` with `available`: without it the whole revealed library's card
stats took 34 ms instead of 16; with it, 23.

## Where it departs from the handoff

1. **ONE-OFF is a single book, not "anything with one entry".** The mock
   defines SERIES as every group of more than one book. Taken literally, eight
   visible Mihon series that happen to have one chapter so far would have been
   one-offs. A Mihon series is a series (a gallery source's galleries
   excepted: they're books, c124).
2. **Turn 3 only.** Turns 1 (an ONLY row under the tabs) and 2 (a panel beside
   the AT LEAST band) are superseded; c67's AT LEAST band is gone.
3. **LANGUAGE on the library is the shelf's languages without filters**, so
   choosing one doesn't make the others vanish from the row.
4. **The scrim leaves the sidebar and the top bar lit on the desktop**, as 3j
   draws them; on the phone and tablet it dims everything but the tab bar.
5. **The active tab scrolls into view** on a row that scrolls, as the mocks
   draw it starting at the active shelf.
6. **The person page filters on the device** and keeps nothing in its URL.
   The library's filters are links; a person's page holds every item already,
   and its own tabs never were in the URL either.

## What it does not do yet

- Renaming, reordering or deleting a shelf.
- Saving a combination of filters as a shelf of its own.
- A person's page doesn't remember its filters across visits.
- Search doesn't take filters.
