# Works and merged seasons

Cards c215 ("Anime seasons group into one series, so a show is one tile") and
c216 ("A Work groups series, so finishing one leads into the next"). The brief
is [`briefs/done/WORKS.md`](briefs/done/WORKS.md); the design handoff
(2026-11-02, canvas `https://claude.ai/artifact/LMzdUzR8JemZer1tS3ECQq`) is
mirrored in [`design/handoff/`](design/handoff/) as `Works Calls.dc.html` (the
designer's decisions, the canvas's `Main.dc.html`), the `Seasons-*` and
`Work-*` boards, `wk.css`, and `Works canvas.json`.

**Status: designed, being built in slices** (the table at the end). Read
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
shown whole, and grouping refuses to mix hidden and visible series.

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
  Work naming it. A Work is never left with fewer than two series: every write
  that removes a part counts after the write and deletes the Work
  (`endIfOne` in `src/lib/server/works.ts`), and the UNDO facts carry its name,
  order and members.
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
  own rating path, so a linked part still sends its tracker. **FAV** follows the
  same agreement rule, and mixed parts say how many are.
- **The default name** is the words every title starts with (`sharedStart` in
  `src/lib/library/books.ts`), or empty when they share none.
- **Kinds and the verb:** `WORK · MANGA + ANIME`, each kind once in the parts'
  order, and CONTINUE says WATCH for an anime and READ for anything else.

## What it does not do yet

Everything in the slices below that is not marked done. Also, by the brief:
no detection of franchises, seasons or authors beyond the title-stem offers;
two sources of one work stay the duplicates review's; the next part is not
kept cached on the tablet.

W1 has no screens and no routes: the library's Work tile, the CONTINUE row,
`/work/N`, the series screen's WORK row and the end page are W2 to W6.

## The slices

Each is one card on the Tsundoku board (label **Works**, a subtask of c216 or
c215), with its dependencies on the board, so Kantoku plans a slice only once
what it builds on has landed. W2, W3, W4 and W6 need only W1; W5 needs W3; W7
needs W2 to W6. S1 waits for W7 and for c240 (whose per-season links it builds
beside). A slice's card names its boards, files, specs and docs.

| Slice | Card | What                                                           |
| ----- | ---- | -------------------------------------------------------------- |
| W1    | c275 | Works: schema, pure rules, server actions (no screens)         |
| W2    | c276 | The library: one Work tile, one CONTINUE row, the finding rule |
| W3    | c277 | `/work/N`: the Work's own screen                               |
| W4    | c278 | GROUP AS A WORK, a person's page, HIDE on a part               |
| W5    | c279 | The series screen's WORK row and back cell                     |
| W6    | c280 | The end of a series: the end page and the player               |
| W7    | c281 | MIGHT CONTINUE offers, the phone, and one flow end to end      |
| S1    | c282 | Merged seasons: per-season source and folder (after c240)      |
| S2    | c283 | GROUP AS SEASONS: the merge, UNDO, UNGROUP                     |
| S3    | c284 | The merged show's series screen                                |
| S4    | c285 | MIGHT BE SEASON N                                              |
