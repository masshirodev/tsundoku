# Works and merged seasons

Cards c215 ("Anime seasons group into one series, so a show is one tile") and
c216 ("A Work groups series, so finishing one leads into the next"). The brief
is [`briefs/done/WORKS.md`](briefs/done/WORKS.md); the design handoff
(2026-11-02, canvas `https://claude.ai/artifact/LMzdUzR8JemZer1tS3ECQq`) is
mirrored in [`design/handoff/`](design/handoff/) as `Works Calls.dc.html` (the
designer's decisions, the canvas's `Main.dc.html`), the `Seasons-*` and
`Work-*` boards, `wk.css`, and `Works canvas.json`.

**Status: designed, W1 to W3 built** (the table at the end). Read
`Works Calls.dc.html` whole before a slice: it answers the brief's seven
questions, and this file only records what the build decided on top of it.

## Two ways of grouping

- **A Work** (Part B, c216) is a level above series that merges nothing: a
  name, an order the owner sets, and up to one Work per series. Each series
  keeps its own source, FOLLOW, link, folder, rating and FAV. Its point is
  continuity: finishing one series offers the next.
- **Merged seasons** (Part A, c215) turn several anime series, one per season
  as KickAssAnime lists them, into one series whose episodes carry
  `entries.season`. Unlike a Work, this merges.

Works are built first (the owner, 2026-11-02): they are additive, and they
deliver the continuity sooner.

## The one rule

**Browsing shows the run; finding shows the series** (`Works Calls`, "The one
idea"). The grid, shelves, CONTINUE, NEW and collections show a Work as one
tile and one CONTINUE row; search, tag filters and a person's page show the
matching series as their own tiles, each with `PART 2 · <WORK>` in its foot.
Hidden stays SQL's job (`src/lib/server/library.ts`): a Work is hidden or
shown whole, and grouping refuses to mix hidden and visible series. A Work
whose parts diverged after grouping -- one hidden on its own -- refuses every
add, from every member, until W4's HIDE settles it. With reveal on, such a Work
is one tile wearing HIDDEN when any of its parts is hidden: the mark is the
Work's, never the face's, so it does not depend on which part the tile happens
to show.

## Decided on top of the handoff

### A Work's rating and FAV (the owner, 2026-11-02)

The handoff's answer to question 3 was "neither". The owner chose otherwise:

- **Rating.** A Work's rating is the **average of its parts' ratings**, among
  the parts that are rated (0 is unrated, `doc/RATINGS.md`). It is shown on
  the Work screen and the tile, rounded as `ratingText` rounds.
- It can be **set** only while the parts agree: every part unrated, or every
  part the same rating. Setting it then writes that rating to **every part**,
  through each series' own rating path, so a linked part sends it to its
  tracker as its own row would. While the parts differ, the Work's rating is
  shown and not settable, so one tap never overwrites ratings given apart.
- **FAV** follows the same rule: settable while every part agrees (all FAV or
  none), and setting it sets every part. Mixed parts show the Work as not FAV
  and the control says how many are. FAV never goes to a tracker either way;
  only ratings do. The FAV shelf still shows the Work tile when any part is a
  favourite (the handoff's rule, unchanged).

The handoff's tile foot (part segments instead of rating bars) stays: the
average is on the Work screen and in the tile's sheet, not in the foot.

### Per-season sources (Part A)

The handoff says each merged season "keeps its own source entry … and its
AniList / MAL link, which becomes that season's line (c240's lines,
unchanged)". The schema has one `series.origin_key` and one `series_links` row
per series, so that is not true today. c240 (tracking a season at a time)
adds the per-season **links**; Part A adds the per-season **source and
folder** beside them, and FOLLOW, refresh, downloads, MOVE and c239's AniSkip
lookup learn to resolve a season's own source and link. One table of season
facts, never two link tables.

## Where it departs from the handoff

- A Work has a derived rating and FAV (above), not "neither".
- Merged seasons' links are c240's per-season links, built by c240, not
  something that already exists.

## Schema

Rung 61 of `src/lib/server/db.ts` (c275, W1) adds three tables and changes no
existing one.

- `works (id, name, created_at, order_mode)`, where `order_mode` is `hand`,
  `added` or `title`.
- `work_series (work_id, series_id UNIQUE, position)`: positions start at 1 and
  a gap is harmless, because order is by position. `series_id` is UNIQUE, so a
  series belongs to at most one Work and adding one that is already elsewhere
  moves it; it cascades from `series`, so a deleted series can never leave a
  Work naming it. A Work is never left with fewer than two series: the rung's
  `series_deleted_ends_work` trigger ends a Work left with one after the cascade
  from a deleted series, wherever that delete came from, and the app's own
  removers (`endIfOne` in `src/lib/server/works.ts`) end it for the paths that
  never delete a series row. The UNDO facts carry its name, order and members.
- `work_dismissals (series_ids, dismissed_at)`: W7's dismissed offers, kept
  apart from the books' `suggestion_dismissals` because that table's reader
  parses every row's key as sorted ids, a shape a Work's key would not have. A
  Work's key is `work:<workId>:<seriesId>`.

## Rules

`src/lib/library/works.ts` holds them and `tests/works.spec.ts` tests them;
`src/lib/server/works.ts` reads the facts they need.

- **CONTINUE's part** is the part the owner opened most recently; when that one
  is finished, the next unfinished part after it in the owner's order. It is
  null only when every part is finished, so a finished later part never makes
  an unfinished earlier one unreachable.
- **A part's state** is not started, in progress, caught up (all of it read and
  the source still ongoing) or read through (all of it read).
- **The tile's face** is the cover of the part CONTINUE opens, or of the last
  part once the run is read. **Its foot** is one segment per part (done, now, to
  come) and `PART n OF m`, `UP NEXT · PART n` when that part has not been
  started, and nothing at all for a Work of one.
- **The rating rule:** the shown rating is the average of the rated parts,
  rounded. It is settable only while every part is unrated or every part shares
  one rating, and a set writes that rating to every part through each series'
  own rating path, so a linked part still sends its tracker. A read that can see
  only some of the parts (reveal off, a hidden part) is never settable, because
  it cannot know they agree. **FAV** follows the same agreement rule, and mixed
  parts say how many are.
- **The default name** is the words every title starts with (`sharedStart` in
  `src/lib/library/books.ts`), or empty when they share none. W2's bulk-bar
  WORK cell names a Work with no shared stem `Untitled work` and lands on the
  Work screen with its RENAME row open; W4's AS sheet replaces that cell.
- **Kinds and the verb:** `WORK · MANGA + ANIME`, each kind once in the parts'
  order, and CONTINUE says WATCH for an anime and READ for anything else.

## The library and the Work screen (W2, W3)

### Browsing and finding

`listTiles` is the browse list: one unit per Work whose any part is on the
shelf, and one per series in no Work, paged and sorted by that unit. The
Work's face is the picked part CONTINUE would open -- a part on the shelf
first, unfinished before finished, then the one opened most recently
(`unitQuery`'s `face`) -- so on MANGA a Work of a manga and its anime wears
the manga's cover and on ALL it wears the part CONTINUE opens. `listSeries` is
unchanged and is what finding reads; every card carries its Work as
`work: { id, name, part, of }` for the `PART 2 · <WORK>` foot.

- **Counts count tiles** everywhere the sidebar, a tab or `44 OF 188` shows a
  number: `countTiles` / `countListed` / `listShelves` count units, and a Work
  of three parts is one of each.
- **CONTINUE** groups by Work in `continueReading`: one row per Work, the
  part CONTINUE opens, or `UP NEXT` at the next part's first chapter. A Work
  is a candidate when any part has ever been opened -- a part read through and
  the next one never started is exactly the row the handoff draws -- and its
  `total` counts rows. The card query carries each series' last open; sorting
  and slicing happen before `entryLine`/`resumeEntry`, so the section hydrates
  only the rows it returns.
- **A Work sorts by its most recent part**, as aggregates over every part
  (`keys` in `unitQuery`): latest read, newest chapter, latest added. The
  order lives in SQL rather than a `sortKey` on the part facts (W1's
  suggestion), because the page sorts units before it knows which tiles they
  are; no `works.updated_at` and so no rung.
- **The reads are three, whatever the page's size**: the units, the cards of
  the parts drawn, and every part of every Work on the page in one grouped
  pass (`partsOfWorks`). `workParts` is never called once per tile.
- **A Work tile's foot** is `workFoot`: one segment per part (done grey, now
  ink, to come dark) and `PART 2 OF 3`, `UP NEXT · PART 2` when CONTINUE's
  part has not been started. The phone's foot says `2 OF 3` / `NEXT`, in CSS.
- **SELECT on a Work tile selects its parts**: the bulk bar's actions all act
  on series, and a Work is one tile over them.

### `/work/N`

`src/routes/work/[id]/` is the series screen's frame -- the 440px panel (352
on a TV, the header in portrait) with THE RUN beside it. `workPage` returning
null is the 404, for a missing id and for a hidden Work with reveal off.

- **The panel**: the parts' covers fanned, `WORK · <KINDS>`, the name, `N
SERIES · N CHAPTERS · N READ` (or `ALL READ`), `PART n OF m, MADE <date>`,
  RATING and FAV, CONTINUE across the Work, ORDER, SHELVES (the union of the
  parts'), and FILE with RENAME and UNGROUP.
- **RATING and FAV are derived** (below), not the handoff's "neither".
- **THE RUN** is a 128px row per part in the owner's order: the number cell
  inverted on the part CONTINUE opens (`NOW`), a 68px cover, the title, `KIND
· SOURCE · STATUS · N CH. · ALL DOWNLOADED` (or `0 OF N DOWNLOADED · READS
ONLINE`), a progress bar, and the status column: `READ ✓ · FINISHED 12
MAR`, `CH. 15 OF 205 · OPENED 2 H AGO` (`EP.` on an anime part), or `NOT STARTED
· +4 NEW`. A never-opened part has no last open of its own, so its NEW is
  counted from the Work's last open: chapters that arrived since the owner
  last read any part of the run. A series tile keeps the library's rule that a
  never-opened series has only unread (`doc/LIBRARY.md`, "New chapters"). A tap
  opens the series with `?from=work:<id>` (W5 reads it); ▶ continues the part
  CONTINUE opens. On a phone the rows are 104px and the status column folds
  into the meta line.
- **ORDER** is the books grid's idiom: drag a row or focus it and use the
  arrow keys, BY DATE ADDED / BY TITLE, DONE saves, ✕ discards.
- **SELECT → TAKE OUT** with a band and UNDO. Taking out the second-to-last
  ends the Work: the screen is gone, so the library shows `<NAME> IS NO
LONGER A WORK · ONE SERIES WAS LEFT` with UNDO, which restores the same id,
  name and order. UNGROUP goes the same way (`UNGROUPED · <NAME>`). Both
  replace the gone screen in history (`replacing`), so the system's back
  returns to the library and not to a 404.
- **+ ADD A SERIES** opens a library picker; a series already in another Work
  says `IN <WORK> · MOVES HERE` and moves, ending that Work if one is left.
  The picker reads its own page when it opens (`GET /work/N/addable?q=&offset=`,
  `GRID_PAGE` rows at a time, filtered by `s.title LIKE` in SQL), so the
  screen's load never carries the whole library.
- **A Work whose run is read** puts `THE RUN IS READ · FINISHED <date>` and
  READ AGAIN in place of CONTINUE, and + ADD A SERIES stays.

### The rating and FAV row

The shown rating is the average of the rated parts (`workRating`), and it is
settable only while every part agrees -- every part unrated, or every part one
rating. A set writes that rating to every part through `library.setRating`, so
a linked part still sends its tracker. FAV follows the same rule and never
goes to a tracker; mixed parts show `PARTS DIFFER` and say how many are. A
page that can see only some parts (reveal off, a hidden part) shows and does
not offer: `workPage.total` is what tells it so.

### Making one

W2 needed a door, since W4's AS sheet is not planned: the bulk bar's grouping
cell shows **WORK** when the selection is not one book series' to group, and
`?/work` creates a Work from the selection in its order. A selection that holds
any series already in a Work is refused (_A WORK KEEPS ITS PARTS · MOVE ONE
FROM ITS OWN SCREEN_), because moving a series between Works is W4's sheet and
a whole-shelf SELECT ALL must not collapse every Work on it into one. One cell,
no sheet; W4 replaces it with AS → A WORK · SERIES, NAME and ORDER. The create
leaves no UNDO band: taking the Work apart again is UNGROUP, and UNDO is W4's.

### The frames

`tests/works-library-frame.e2e.ts` and `tests/work-screen-frame.e2e.ts` are
`gen-conformance` output pinned from `Work-Library.dc.html` and
`Work-Screen.dc.html`. The seeded library has no Work, so each file seeds a
database of its own and serves the same build on its own port, and makes one
Work there through the app, in two series near the top of CONTINUE.
`PLAYWRIGHT_WORKS_PORT` pins that port when the gate assigns one; with the
variable unset each file takes a free port from the OS (`node:net`'s
`listen(0)`), so the repo's own `npx playwright test` runs them and two
concurrent runs do not collide. It
writes nothing to the shared library, so it runs in parallel with the flow
specs. The generated tests compare the first match where a region repeats per
row. That preamble and a couple of width/shadow assertions the generator
cannot see are hand-written, and **regenerating the files drops them** --
`temp/design/assemble.py` is the script that puts them back. They run in the
`works-frame` project (1280x800, one worker).

### The flow

`tests/works-flow.e2e.ts` is W2's and W3's end to end: the tile, the CONTINUE
row, the Work's screen, ORDER, TAKE OUT and its bands, ADD A SERIES, the
derived RATING and FAV, the hidden 404, paging and SELECT ALL. Every case groups
series into a Work, and a Work takes its parts' own tiles off the grid while it
exists -- so a spec that finds one of those series by its grid tile, running
beside this file on the shared database, would time out (the reader's
`seriesId()` is the arrangement that does). It therefore runs on the frames'
arrangement: its own seeded database, its own preview port taken from the OS,
and the `works-flow` project, one worker. Nothing it writes can be seen by
another spec, and a case that fails halfway leaves the suite's database as it
was. The one destructive step that is not a browser case -- SELECT ALL over a
kind shelf takes a Work's off-shelf part, and a bulk HIDE hides the run whole --
is in `tests/works-library-db.spec.ts`, which reseeds before every case.

## What it does not do yet

Everything in the slices below that is not marked done. Also, by the brief:
no detection of franchises, seasons or authors beyond the title-stem offers;
two sources of one work stay the duplicates review's; the next part is not
kept cached on the tablet.

W4 to W7 are not built: GROUP AS A WORK's AS sheet (the WORK cell above is a
stand-in), a person's page Work row, HIDE on a part, the series screen's WORK
row and back cell, the end page and the player, MIGHT CONTINUE and the phone
flow. The Work screen does not draw the handoff's `↓ 10` download cell: a tap
on a row opens the series, where DOWNLOAD's NEXT 10 lives, and this slice adds
no download action of its own.

## The slices

Each is one card on the Tsundoku board (label **Works**, a subtask of c216 or
c215), with its dependencies on the board, so Kantoku plans a slice only once
what it builds on has landed. W2, W3, W4 and W6 need only W1; W5 needs W3; W7
needs W2 to W6. S1 waits for W7 and for c240 (whose per-season links it builds
beside). A slice's card names its boards, files, specs and docs.

| Slice | Card | What                                                                   |
| ----- | ---- | ---------------------------------------------------------------------- |
| W1    | c275 | Works: schema, pure rules, server actions (no screens)                 |
| W2    | c276 | The library: one Work tile, one CONTINUE row, the finding rule (built) |
| W3    | c277 | `/work/N`: the Work's own screen (built)                               |
| W4    | c278 | GROUP AS A WORK, a person's page, HIDE on a part                       |
| W5    | c279 | The series screen's WORK row and back cell                             |
| W6    | c280 | The end of a series: the end page and the player                       |
| W7    | c281 | MIGHT CONTINUE offers, the phone, and one flow end to end              |
| S1    | c282 | Merged seasons: per-season source and folder (after c240)              |
| S2    | c283 | GROUP AS SEASONS: the merge, UNDO, UNGROUP                             |
| S3    | c284 | The merged show's series screen                                        |
| S4    | c285 | MIGHT BE SEASON N                                                      |
