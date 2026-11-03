# Works and merged seasons

Cards c215 ("Anime seasons group into one series, so a show is one tile") and
c216 ("A Work groups series, so finishing one leads into the next"). The brief
is [`briefs/done/WORKS.md`](briefs/done/WORKS.md); the design handoff
(2026-11-02, canvas `https://claude.ai/artifact/LMzdUzR8JemZer1tS3ECQq`) is
mirrored in [`design/handoff/`](design/handoff/) as `Works Calls.dc.html` (the
designer's decisions, the canvas's `Main.dc.html`), the `Seasons-*` and
`Work-*` boards, `wk.css`, and `Works canvas.json`.

**Status: designed, W1 to W6 built** (the table at the end). Read
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
whose parts diverged after grouping -- one hidden on its own, which since wave
16 only an import's fold can still do -- refuses every add, from every member,
until HIDE settles it (W4: `HIDE ALL n`, or `TAKE OUT` then hide). With reveal on, such a Work
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
  a gap is harmless, because order is by position. A take-out leaves one, and
  UNDO puts the series back at its own position, so a part's number is never
  the column: `PART n OF m` is its place among the members (`partPlace`, and
  the same count in SQL for the finding lists' `workFeetFor` and the library
  card's `work_part`). `series_id` is UNIQUE, so a
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
  `src/lib/library/books.ts`), or empty when they share none, which
  `defaultWorkName` (`src/lib/library/works.ts`) checks before keeping it. The
  AS sheet's NAME is that default, or empty with `THE TITLES SHARE NO WORDS`,
  and its CREATE cell waits for a name (W4).
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
  opens the series with `?from=work:<id>` (which W5's ← reads); ▶ continues the part
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

### Making one (W4)

GROUP opens the AS sheet (Work-Group B5; doc/BOOKS.md, "The AS row"). The bulk
bar offers GROUP for any selection, and the sheet's first row says what the
selection can become: `ONE SERIES · BOOKS`, `ONE SERIES · VOLUMES`
(doc/BOOKS.md's), and `A WORK · SERIES`, which is always one of the answers. A Work
takes any series; the other two take only the selection they fit.

For a Work the sheet reads `NEW WORK` or `ADD TO A WORK · N`, a NAME (the words
every title starts with, or empty with `THE TITLES SHARE NO WORDS`), ORDER
(`BY HAND` first, the selection's own order, then BY DATE ADDED and BY TITLE),
numbered rows with ↑ ↓, and the line that matters: `EACH KEEPS ITS OWN RATING,
FAV, FOLLOW, LINK AND FOLDER`. A series already in another Work says `IN
<WORK> · MOVES HERE`: a series belongs to one Work at most, and moving it in
ends the Work it left when one was left behind, with the same facts UNDO reads.
The create's band names the Work and offers UNDO, on the page the sheet was
opened from, so making one never replaces the library with the Work's screen.

`?/work` is the sheet's own door. It refuses a selection that touches **two or
more** Works, which is what a whole-shelf SELECT ALL would be, so one Work can
never swallow another by accident; any caller that does not identify as the
sheet still gets W2's refusal (_A WORK KEEPS ITS PARTS · MOVE ONE FROM ITS OWN
SCREEN_) whenever the selection holds a Work's part at all.

**From a person's page** it is the same bulk bar over the person's items, and
that is the common way an author's Work is made. The page then says the run
exists, once per Work, without pulling the Work's other series in: `WORK ·
<NAME> · 3 OF 3 HERE · UP NEXT: <part> · OPEN →` (Work-States 7), from
`worksOnTagPage` -- one query for the page's Works and one grouped pass over
their parts, never one read per row.

### HIDE on a part (W4)

A Work is hidden or shown whole (Work-States 4). HIDE on a series in a Work
therefore asks: `HIDE ALL n` hides the Work, every part, with a band and UNDO;
`TAKE OUT` takes this series out first and hides it on its own, and the rest
stay a Work. The bulk bar asks the same way when its selection holds part of a
Work: HIDE ALL covers every Work touched, TAKE OUT hides exactly what was
selected. A series in no Work keeps the plain HIDE, and the bulk bar's UNHIDE
is the same rule backwards (`?/showAll`): one hidden part of a hidden Work
selected anywhere -- a person's page draws the parts as their own tiles -- shows
the Work whole, with its own band and UNDO. Each answer's UNDO both shows the
series again and puts back any take-out, including a Work that ended because it
was left with one.

**The rule sits at the write, not at the screen.** Every door that hides or
shows series by id goes through `setHiddenWhole` (`src/lib/server/works.ts`),
which takes each part's Work with it, every part, in either direction: the
library's plain `?/hide` (the long-press series sheet's, on the library and on
the search page, where any hit opens it -- a Work's part included), `?/bulk`'s
HIDE and UNHIDE, `?/hideAll`, `?/showAll`, both UNDOs, and TAKE OUT's own hide
on both screens. A series in no Work is written exactly as before. The series
sheet does not ask a new question: on a part its cell says `HIDE ALL n` (or
`UNHIDE ALL n`), the HIDE sheet's words, and the library's band says the Work
went whole. The series screen's plain `?/hide` refuses a part outright
(`A WORK IS HIDDEN WHOLE · HIDE ALL OR TAKE OUT`), because that screen always
asks. So no door the app offers leaves a Work half-hidden, in either direction.
The one write that still can is an import's fold (`foldSeries`,
`src/lib/server/import/fold.ts`: a Mihon backup that names a series the library
already holds under another key folds one into the other, `hidden = MAX(...)`);
its account is in `doc/handoff-notes/works-screen.md`, "Wave 16".

**The bands say how many Works** (`wholeBand`, `src/lib/library/works.ts`):
`HIDDEN · THE WORK, WHOLE` for one, `HIDDEN · 2 WORKS, WHOLE` for a selection
that touched two, with the Works' own series counted in the detail and the
selected series in no Work named apart (`4 SERIES · 6 MORE ON THEIR OWN ·
SHOWN AGAIN BY UNDO`). UNHIDE's band is the same with `SHOWN`.

With reveal off, the series screen no longer exists after either answer, so the
library carries the band: `HIDE ALL n` says the Work was hidden whole, and
`TAKE OUT` says `HIDDEN · TAKEN OUT` -- one series hidden, on its own again,
naming the Work it left if that Work ended.

### The end of a series (W6)

The one place continuity is won (`Works Calls`, "The end of a series"). The
rule is `nextPart(parts, seriesId)` in `src/lib/library/works.ts`: **the part
after this one in the owner's order**, never the next unfinished one, so
finishing part 2 of 3 leads to part 3 even when part 3 was started out of
order. `partPlace` gives `PART 2 OF 3`; `workEndMode` says what the end offers
-- `next` (the block), `meanwhile` (caught up on an ongoing source: a row, not
a block), `read` (every part finished: the run is read) or null; `workHeld`
builds the run's `2 SERIES · 227 CHAPTERS · MONSTER 10, PLUTO UNRATED` line.
W5's series screen reads the same rule.

- **The end page** (`src/routes/read/[entry]/EndPage.svelte`, the
  `variant: 'series'` page) draws **NEXT IN `<WORK>` · PART n OF m** between
  the title and the rating: the next part's cover, its title, its own
  `KIND · N CHAPTERS · ALL DOWNLOADED · SCROLLS` (an anime next part says
  EPISODES), the accent `▶ START · CH. 1` and `WORK →`. The kicker names the
  series that ended (`END · THE BREAKER`) instead of `END · LAST AVAILABLE`,
  because something follows; the foot gains `<WORK> · WORK` beside LIBRARY.
- **The rating stays below, compact, only while this series is unrated**, and
  still never asks twice: the block sits above it, and a rated series has no
  row. The note says the next part opens on a tap, never a swipe.
- **A tap, never a swipe.** A chapter boundary swipes on because the next
  chapter is the same thing; the next series may read the other way (a manga
  after a manhwa) and this is the one moment the rating is asked. A swipe or a
  key at the end page stays where it is; only the block's own cells cross.
- **Caught up is not read through.** An ongoing part with everything read
  keeps `END · LAST AVAILABLE` and offers the next part as a MEANWHILE row
  with START →, because the owner may rather wait for chapters. The row carries
  the block's states too: a next part with no file says `○ NOT DOWNLOADED` and
  dims its cell, and offline and not cached it says `○ OFFLINE · NOT CACHED`,
  rather than a START → that lands on the reader's IS NOT DOWNLOADED page.
- **Not downloaded vs offline.** A next part whose first chapter has no file
  but a source an installed extension serves says `○ NOT DOWNLOADED · READS
ONLINE FROM <SOURCE>` with `▶ READ ONLINE · CH. 1` (c161) and DOWNLOAD FIRST
  10, which posts the next series' own `?/download`. Offline and not cached on
  the device it says `○ OFFLINE · NOT CACHED` with START dimmed; a cached one
  opens as usual.
- **The last part** says `THE WORK IS READ · n OF m`, the Work's name, what it
  held, and WORK → in place of START -- never an empty block. An earlier part of
  a run that is read through is the series' own end page, with the foot still
  offering the Work: `THE WORK IS READ · 1 OF 2` reads as its own contradiction,
  and the board draws the state at the last part.
- **Incognito still offers it**, and writes nothing either way.
- **A novel's last volume** is the same page, so it gets the same block, in
  either layout: PAGED turns past the last page to it, and SCROLL reaches it at
  the bottom of its last volume -- and at the bottom of a last volume too short
  to scroll, by the wheel or key that would have scrolled it. A volume that
  isn't the last ends as it did (`TextScreen`'s own copy, naming the chapter
  that isn't downloaded). The text reader's true end now renders `EndPage`, so
  a novel asks for its rating once, not twice.
- **The player** (`VideoPlayer.svelte`): on the last episode the card the
  player already draws at the ending turns into the Work's next part --
  `NEXT IN THE WORK · READ|WATCH`, `PART n OF m`, the next part's title and
  meta, `▶ READ · CH. 1` and WORK. No countdown and never an autoplay into
  another series; the end-of-episode page keeps `END · LAST AVAILABLE` and
  gains the same card. A Work of an anime and its manga says READ.

### The series screen's WORK row (W5)

One row for a series in a Work, between CONTINUE and DOWNLOAD, because it
answers the same question, what after this (Work-Row B3; doc/SERIES.md, "The
WORK row"). It shows the Work's name over `PART 2 OF 3 · NEXT · <next part>`,
or `PART 2 OF 3 · YOU'RE IN <part>` once the run has moved into another part it
has already begun; the two 52px ← → cells (44px on a phone) open the
neighbouring parts, dimmed at the ends; a tap on the name opens `/work/N`; a
long press, MENU or a held OK opens the row's sheet -- OPEN, MOVE ↑ ↓, TAKE OUT
with a band and UNDO.

`workRowLine` (`src/lib/library/works.ts`) decides that line and the accent:
when this part is done (read through, or caught up) and the next part has **not
been started**, the row becomes the accent row `NEXT · <next part> · IN <WORK> ·
PART 3 · 98 CH. · ▶ CH. 1`, one tap into the next series' first chapter, and
CONTINUE above it goes quiet as `↺ READ AGAIN`. A next part the owner is
already in is not offered as an accent -- the plain row says `YOU'RE IN` it --
so there is exactly one accent on the screen and it is the run's.
`seriesWorkRow` (`src/lib/server/works.ts`) reads the row, its neighbours and
the next part once; `workEndMode` is still what the end page and the player
read.

`?from=work:<id>` on the series screen (set by the Work's run rows) makes ←
name the Work: `backTo` validates the id, checks the series really is that
Work's part, and falls back to `← LIBRARY` otherwise (doc/NAVIGATION.md).

### The frames

`tests/works-library-frame.e2e.ts` and `tests/work-screen-frame.e2e.ts` are
`gen-conformance` output pinned from `Work-Library.dc.html` and
`Work-Screen.dc.html`; `tests/work-end-frame.e2e.ts` is pinned from
`Work-End.dc.html` (its four states are hand-written cases in the same file).
The seeded library has no Work, so each file seeds a
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

`work-end-frame.e2e.ts` also seeds an anime series of its own, whose episodes
are the fixture clip as downloaded files, so the player's last episode is real
without the browse world's fake engine or its shared database. Its six Works
are made through the app and renamed in SQL, and its "reads online" state is
one `engine_sources` row for a source nothing calls.

`tests/work-group-frame.e2e.ts` (W4) is pinned from `Work-Group.dc.html`: the
AS row, the INTO row, NAME, ORDER, the numbered rows with the line that matters,
and the create foot. It selects three doujin singles, since that is the only
selection whose AS row has the board's two answers, and fills a name. The
board's own cell tracks are its 556px side sheet's, so the frame asserts the
cells equal rather than 254px wide.

`tests/work-row-frame.e2e.ts` (W5) is pinned from `Work-Row.dc.html`, and
measures the board's three states on the screen that draws each: a part mid-run
(the plain row, both cells live), a part read through with the next one
unstarted (the accent row and a quiet CONTINUE), and a first part (← dimmed).
It makes two Works in SQL -- one caught mid-run, one with its second part read
through -- and its hand-written cases walk the row's links, ← from the Work, a
stale `from=work:` id, MOVE and TAKE OUT with its band and UNDO.

### The flow

`tests/works-flow.e2e.ts` is W2's, W3's and W4's end to end: the tile, the
CONTINUE row, the Work's screen, ORDER, TAKE OUT and its bands, ADD A SERIES,
the derived RATING and FAV, the hidden 404, paging and SELECT ALL, then GROUP
AS A WORK from the library and from a person's page, ADD TO A WORK, `IN <WORK> ·
MOVES HERE`, both HIDE answers (on a part and in the bulk bar), and the refusal
that keeps SELECT ALL from collapsing two Works. Every case groups
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

W7 is not built: MIGHT CONTINUE's offers, the phone flow and one flow end to
end. The Work screen
does not draw the handoff's `↓ 10` download cell: a tap on a row opens the
series, where DOWNLOAD's NEXT 10 lives, and this slice adds no download action
of its own. W6's block offers DOWNLOAD FIRST 10 for the next part, which is
the series screen's own `?/download`.

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
| W4    | c278 | GROUP AS A WORK, a person's page, HIDE on a part (built)               |
| W5    | c279 | The series screen's WORK row and back cell (built)                     |
| W6    | c280 | The end of a series: the end page and the player (built)               |
| W7    | c281 | MIGHT CONTINUE offers, the phone, and one flow end to end              |
| S1    | c282 | Merged seasons: per-season source and folder (after c240)              |
| S2    | c283 | GROUP AS SEASONS: the merge, UNDO, UNGROUP                             |
| S3    | c284 | The merged show's series screen                                        |
| S4    | c285 | MIGHT BE SEASON N                                                      |
