# Highlights

A highlight is a moment kept: a novel's passage, a manga's page, an anime's
clip. It is **a copy and a pointer**. The copy is the highlight's own and never
changes; the pointer goes back to the place while the place exists, and says
where it came from when it doesn't. Card c444 ("Highlights: a novel's passage,
a manga's page, an anime's clip, kept even after the entry is gone") is the
whole feature, from the brief [`briefs/HIGHLIGHTS.md`](briefs/HIGHLIGHTS.md)
and the handoff [`handoffs/highlights/`](handoffs/highlights/) (start with
`Main.dc.html`, whose numbered calls are cited below as _Main 02_ and so on).

It ships in slices:

| Slice  | Card | What it adds                                                                                                                                                    |
| ------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | c701 | The record and its life, the copies' folder and its backup, `/highlights`, the series screen's row, DELETE's and MOVE's lines, the exports. No way to make one. |
| H2     |      | Quotes: the text reader's long press, the bar, the marker in every theme, re-finding a quote in a changed chapter (DETACHED).                                   |
| **H3** | c703 | Pages: HIGHLIGHT in the image reader's bottom row and page menu, a spread's choice, the strip's page. Below, "Pages (H3)".                                      |
| H4     |      | Clips: MARK IN, MARK OUT and KEEP in the player, the clip lane, MP4 with a track burned in.                                                                     |

H1 is everything a highlight needs once it exists. H3 (wave 33) is the first
way to make one: a page, from the image reader. Until H2 and H4 land, a quote
or a clip exists only where a test (or a hand) puts it in the table.

## The record (Main 05)

`highlights`, rung 72 (`src/lib/server/db.ts`). One row per highlight:

- **kind**: `quote`, `page` or `clip`. A highlight's own kind, never a series'
  kind; what a series is called comes from the registry (`kindFacts`) asked
  with the snapshot's `series_kind` ([`KINDS.md`](KINDS.md)).
- **The pointer**: `series_id` and `entry_id`, and the keys that outlive an
  id: the series' `origin_key`, and the entry's `number` and `season`. No
  foreign key: nothing cascades into a highlight. An id is not an identity
  (wave 19), and SQLite hands a deleted row's id to the next insert, so a
  delete nulls the ids rather than leaving one that may point at a stranger.
- **The place**: a quote's `block`, `block_offset`, `end_block`, `end_offset`
  (the text reader's own position, `src/lib/reader/text.ts`); a page's `page`
  (0-based) and `page_end` (a spread kept as BOTH); a clip's `clip_in` and
  `clip_out`, seconds into the episode.
- **The snapshot**: `series_title`, `series_kind`, `cover`, `entry_label`
  (`Ch. 3`, `Ep. 7`), `entry_title`, `volume`; for a quote, `quote`, the 32
  characters either side (`quote_before`, `quote_after`, for H2's re-finding),
  its `paragraph` and the one before (`context`).
- **colour**: `yellow`, `orange` or `blue`, quotes only (a CHECK keeps a page
  and a clip without one). Three colours and no meanings (Main Q1).
- **note**: a few lines of plain text. The note and the colour are the only
  things that change after making one, besides deleting it.
- **made_at**, **hidden**, the copy (`copy_path`, `still_path`, relative to
  the copies' folder, `copy_bytes`, `copy_width`, `copy_height`, `quality`,
  `tracks` and `track`), **state**, `orphaned_at`, `rejoin`, `deleted_at`.

**state** is `ok`, `orphan_series` (the series is no longer in the library),
`orphan_entry` (the series is, the chapter or episode isn't) or `detached` (a
quote its chapter's text no longer holds; H2 sets it).

## The pointer's life

Kept by **triggers on the rung**, not by a call in each door. A series or an
entry goes through a dozen doors, and a trigger is the one place every door
reaches, foreign-key cascades included: SQLite fires a child table's DELETE
triggers for an ON DELETE CASCADE, which `tests/highlights-db.spec.ts`
measures ("SQLite fires a child table's triggers for a cascade").

| Event                                                                     | Trigger                                                                          | What the pointer does                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| An entry is deleted                                                       | `highlights_entry_gone`                                                          | `entry_id` NULL, ORPHAN (entry), unless already ORPHAN (series). Copy and note stay.                                    |
| A series is deleted (its entries cascade first or after: either way)      | `highlights_series_gone`                                                         | `series_id` and `entry_id` NULL, ORPHAN (series).                                                                       |
| An entry moves to another series (a fold)                                 | `highlights_entry_moved`                                                         | Follows it: the new series' id, key and hidden.                                                                         |
| A highlight changes series (a fold's sweep of an orphan no entry carries) | `highlights_moved`                                                               | Takes the new series' key and hidden, so a loser's key never re-resolves it into a series it left.                      |
| An entry is renumbered (the books' resequence, an anime's)                | `highlights_entry_numbered`                                                      | Its `number` and `season` follow, so a later re-add matches what it was last.                                           |
| A series' key changes (MOVE, MOVE BACK, a fold's re-key)                  | `highlights_series_rekeyed`                                                      | Its highlights' `origin_key` follows.                                                                                   |
| A series arrives in the library with a key an orphan kept                 | `highlights_series_back`, `highlights_series_added`, `highlights_series_rekeyed` | Re-resolves: the new id, `rejoin`, and each entry by number and season, now or as it arrives (`highlights_entry_back`). |
| A series' or its root's hidden or PUBLIC changes                          | `highlights_series_hidden`, `highlights_root_hidden`                             | `hidden` follows, by `visibility.ts`' one rule.                                                                         |

Every door that deletes, and what it does to a pointer (`rg -n "DELETE FROM
(series|entries)" src`, plus the cascades):

| Door                                                    | Where                                                | Pointer                                                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DELETE on the series screen, the library's bulk DELETE  | `deleteSeries`, `delete.ts`                          | ORPHAN (series); DELETE THEM TOO removes them                                                                                                                                        |
| A book's DELETE                                         | `deleteBook`, `delete.ts`                            | ORPHAN (entry); the last book, ORPHAN (series)                                                                                                                                       |
| The duplicates review's KEEP                            | `dupes.ts` → `deleteSeries`/`deleteBook`             | as those                                                                                                                                                                             |
| GROUP, a books fold, a singleton folded in              | `books.ts` (UPDATE entries, DELETE series)           | follows its entry into the series it joins                                                                                                                                           |
| An import's fold (twins folded into one)                | `foldInto`, `import/fold.ts`                         | re-pointed to the twin's matching entry, and the series, by the fold's own sweep of every table with an `entry_id` or `series_id` column; an entry only `from` had follows it across |
| An import that drops a root's empty series or a chapter | `import/index.ts:137`, `:148`                        | ORPHAN                                                                                                                                                                               |
| UNDO of an ADD                                          | `undoAdd`, `engine/backend.ts:666`                   | ORPHAN (series); a re-add re-resolves                                                                                                                                                |
| MOVE BACK's chapter only the source left had, no file   | `applyMoveBack`, `move.ts`                           | ORPHAN (entry), counted in `highlightsLost`                                                                                                                                          |
| A root deleted (cascades its series and entries)        | SQLite's cascade                                     | ORPHAN (series)                                                                                                                                                                      |
| A refresh that drops chapters                           | none today: a refresh adds, it never deletes         | -                                                                                                                                                                                    |
| A Work's UNDO                                           | re-creates `work_series` rows, not series or entries | untouched                                                                                                                                                                            |

**A re-add re-resolves by its keys** (wave 19's lesson). The doors that add a
series, and the ones a spec covers: the importer's `writeSeries` and browse's
ADD (`keepOrPromote`, a browsing record made the library's), both in
`tests/highlights-db.spec.ts`. Not covered by a spec of their own: browse's
first ADD of a series never seen (`addToLibrary`, `engine/backend.ts`), the
novel and anime sources' ADD (`novels/source.ts`, `anime-source.ts`), and the
books' new series (`books.ts`): each is an INSERT with `in_library = 1` and a
key, which is the case `highlights_series_back` fires on. A browsing record
(`in_library = 0`) never re-resolves; its ADD does. And a series deleted by
`deleteSeries` is tombstoned ([`DELETING.md`](DELETING.md)), so nothing in the
app adds it again until its tombstone goes: its highlights stay ORPHAN.

The import's fold reaches highlights because their columns are named
`series_id` and `entry_id`, as every table its sweep re-points (`tablesWith`,
`import/fold.ts`): renaming either column would take highlights out of it.

`rejoin` is why only a re-added series takes back its lost entries: an entry
renumbered inside a series that never left (a book deleted, the rest
renumbered from 1) is never taken for a lost one.

### A move

MOVE and MOVE BACK keep every entry they match or keep as the same row
([`MOVE.md`](MOVE.md)), so a highlight on one needs nothing: its entry is
still there and its series' key follows by `highlights_series_rekeyed`, inside
the move's own transaction. What re-points by number is the case the
by-number map adds: an entry the move inserts (`plan.added`), which takes back
the ORPHAN (entry) highlights its series lost by that number and season
(`repointAdded`, `src/lib/server/highlights.ts`). MOVE deletes no entry, so
no highlight loses its way back in a MOVE; MOVE BACK deletes the chapters only
the source it leaves had and that have no file, and their highlights become
ORPHAN (entry), counted from the same plan (`ApplyResult.highlightsLost`).
The copy and the note never change.

MOVE's summary (Out X5) gets a **HIGHLIGHTS** row from that same plan
(`moveComparison().highlights`, `moveHighlights`): `6 FOLLOW`, and the ones on
a chapter the new source lacks named under it, `CH. 50 · P. 7 · NO CH. 50 ON
WEEB CENTRAL · KEPT FROM MANGADEX`. MOVE BACK has no summary screen; its MOVED
band says `2 HIGHLIGHTS LOST THEIR WAY BACK` when it took any (`?lost=`).

## Pages (H3)

Card c703, from [`handoffs/highlights/Manga.dc.html`](handoffs/highlights/Manga.dc.html)
(_Manga M1_ to _M7_) and Main 02, built by `~/.config/myconf/HANDOFF.md`. Its
store is `src/lib/server/highlights/pages.ts`; the reader's rules are in
`src/lib/library/highlights.ts` (`cellState`, `cellLabel`, `spreadChoices`,
`pageTicks`, `ruleSide`, `pageSheetHead`, `pageSheetLine`). The reader's side
is in [`READER.md`](READER.md), "Highlights".

- **HIGHLIGHT** is a cell in the image reader's bottom row, before FULL
  SCREEN (M1), **H** on a keyboard, and **HIGHLIGHT THIS PAGE**, the first row
  of the page menu (long press, OK held, MENU; M5). One press keeps the page;
  nothing asks.
- **A spread asks which** (M2): the two pages in reading order (R→L: the right
  one first, `P. 14 · RIGHT`), then **BOTH · AS ONE**. A wide page shown alone
  is one page and does not ask.
- **The strip's page** is the one under the middle of the screen, the one the
  strip already reads as the page being read (keepPlace's `at`), outlined in
  ink (3px, inset) while the controls are up; the cell names it, `HIGHLIGHT
P. 23` (M4).
- **A kept page says so off the art** (M3): the cell reads **✓ HIGHLIGHTED**,
  inverted; the scrubber has a 4 × 8 yellow tick at each kept page (both pages
  of a BOTH); a letterboxed page has a 4px yellow rule in its gutter, 6px off
  its outer edge (away from the spine: the right in R→L, the left in L→R, a
  spread's page on the side it is drawn). With the controls hidden and no
  gutter (full bleed, or zoomed past 100%) nothing shows. A tap on ✓
  HIGHLIGHTED opens the page's sheet; it never unmarks.
- **The page's sheet** (M6): the copy, NOTE (saved when the field is left or
  the sheet closes; a note the workstation refused says NOTE NOT SAVED and
  keeps the words), `MADE 4 NOV · A COPY ON THE WORKSTATION · 1 MB`, **SAVE
  IMAGE** (the copy, `?save=1`) and **DELETE**, at once, with the band's
  **HIGHLIGHT DELETED · UNDO** (the same `UNDO_MS` as `/highlights`).
- **The cell's states** (M7), ranked: **INCOGNITO** (dimmed to 0.4, disabled:
  incognito makes none, and `POST /api/highlights/pages` refuses one with 403
  whatever the page thinks); **KEEPING…**, dashed, while the workstation
  makes the copy; ✓ HIGHLIGHTED; **○ HIGHLIGHT**, at 0.4, offline, where a
  press says `○ OFFLINE · HIGHLIGHT NEEDS THE WORKSTATION` in the band and
  asks nothing; HIGHLIGHT. A browsing record (a series not in the library)
  has no cell, as it has no rating.

### The copy, and one per page

`highlights/pages/<id>.webp`, WebP (quality 90) at the page's own size, made
by `sharp` from the bytes `readPage` serves the reader: the downloaded file,
or, for a page read online, fetched once from the source through the engine's
proxy (`readOnlinePage`, which asks for the list afresh once before it gives
up). A BOTH is one image, the two pages side by side as the reader draws them
(R→L: the later page on the left), the shorter scaled to the taller's height.

- **No row without its copy.** The copy is written under a scratch name first;
  the row is inserted and the copy renamed to `<id>.webp` in one transaction,
  and a failure (the source sent nothing, 502; not an image, 422; no such
  page, 404) leaves neither. The reader says ✓ HIGHLIGHTED only once the
  answer arrives, so it never says so of a page whose copy does not exist.
- **The same page twice is one highlight** (`kind = 'page'`, the entry, `page`
  and `page_end`, not deleted). An ask while the same page's ask is still on
  its way waits for it (the in-flight map), and the insert checks again inside
  its transaction, so two asks that slip past each other (two devices, two
  processes) end as one row and one copy. A page deleted and kept again within
  its UNDO window is a new highlight. BOTH and one of its pages alone are two.
- **A page's kind is `page`**, never the series' kind; `series_kind` is the
  snapshot, as for every highlight.
- **Hidden** is copied from the series when the page is kept; a hidden series'
  page is not found without reveal, as its reader is not.
- **After**: the triggers do the rest, as for every highlight. A series
  deleted after a page is kept leaves it ORPHAN (series) with its copy, and
  DELETE's line counts it; MOVE's line counts it (`6 FOLLOW`, and
  `CH. 50 · P. 7` named when the move takes its chapter away).

## Hidden means hidden

`hidden` is **copied from the series when a highlight is made, and kept**
(Main 02): a hidden series' highlights stay hidden after the series is gone,
and `/reveal` shows them with the HIDDEN badge in magenta, the one place a
highlight uses it. While the series exists the flag follows it (HIDE, UNHIDE,
a hidden root, PUBLIC). Every list, count, disk line and export reads the
stored flag, in SQL (`shown()`, `src/lib/server/highlights.ts`). DELETE THEM
TOO removes only what the viewer can see.

## The copies

`highlightsArea()` (`src/lib/server/data-dirs.ts`): `TSUNDOKU_HOME/highlights`,
or `HIGHLIGHTS_DIR`, with `pages/`, `clips/` and `stills/` under it. Outside
the library folder, so a delete's trash never takes a copy and a scan never
reads one as a book. Its own function, as `importArea` is, so `dataPaths`'
shape does not change. A copy is served by `/api/highlights/<id>/copy` (the
page, the clip) and `/still` (a clip's first frame), only from inside the
folder and only when the viewer may see the highlight, as `private, no-cache`
(a copy never changes, but who may see it does, so a highlight hidden since
never shows from the browser's cache); `?save=1` names the
file (`kaze-no-tou-no-shoujo-ch42-p14.png`). They are backed up beside each
snapshot ([`BACKUPS.md`](BACKUPS.md), "Highlights' copies").

## /highlights (Page P1–P8)

Every highlight, newest first, by day (`TODAY`, `5 NOV`). The filters, the
search and the open item are in the URL (`kind`, `series`, `lost`, `q`,
`open`), so a reload, ← and a link land on the same view:

- **ALL, QUOTES, PAGES, CLIPS** with their counts, **SERIES · ALL ↓**, and
  **NO WAY BACK** with its count while there is an orphan.
- **Search** over quotes and notes, and series' names (P5): the match in full
  ink, weight 600, and `IN THE NOTE` when that is where it was.
- **The open item**: beside the list (560px) where the sidebar is, from
  1024px with a fine pointer; the whole screen below that (P4). A quote opens
  with its paragraph and the one before, dimmed, the marker drawn over the
  quote's words, ≡ when it has a note; the colours, NOTE, the line it was made
  on, and **CH. 3 →**, COPY, DELETE. A page opens large (a click opens the
  image alone), SAVE IMAGE. A clip plays in place, SAVE CLIP (the MKV).
- **Orphans and DETACHED** are said, not hidden: a dashed tag, and no →.
- **DELETE** is at once, with **HIGHLIGHT DELETED · UNDO** in the band; the
  row waits ten minutes (`UNDO_MS`) and then goes with its copy.
- **The disk line**: `ON THE WORKSTATION · PAGES 14 MB · CLIPS 412 MB · QUOTES
TAKE NONE`, of what shows, and **EXPORT →**.
- **`?series=`** (the series screen's row, or SERIES ↓) reads in reading
  order, by chapter or by season and episode (Series S3–S5), with **EXPORT**.
- **Empty** (P6): `00 — NO HIGHLIGHTS YET` and where they're made.

It is reached from the desktop sidebar's foot, **HIGHLIGHTS** after HISTORY
with its count, from **MORE** on the tablet, phone and TV (the same row), and
by **`/highlights`** in any bar that parses commands (`parseSearch`,
`src/lib/library/search.ts`): `/highlights lamp` lands with the word in its
search. The row is absent while there are none, and a hidden series' are not
counted without reveal (Main Q2).

## The series screen's row (Series S1, S2)

**HIGHLIGHTS · 14 · 3 NOTES →** after ABOUT, above the phone's (and the TV's)
DETAILS fold; after LISTS on the tablet and the desktop. Only when the series
has one. A book's quotes are counted bare (`14`), a manga's pages and an
anime's clips by their word (`6 PAGES · 1 NOTE`, `4 CLIPS`): `seriesLine`,
`src/lib/library/highlights.ts`. It opens `/highlights?series=<id>`.

## DELETE's line (Out X4)

The series screen's DELETE and a book's DELETE say **14 HIGHLIGHTS ARE KEPT**,
why, and **DELETE THEM TOO** as a switch under it, off each time the sheet
opens; on, the action reads **DELETE WITH 14 HIGHLIGHTS** and posts
`highlights=1` (`deleteSeries(ids, reveal, { highlights: true })`). The sheet
is `series/[id]/DeleteSheet.svelte`, a copy of the shared `ConfirmSheet` with
the row after its lines. The library's bulk DELETE takes the same option but
draws no line yet (see below).

## Getting them out (Out X1–X3)

- **EXPORT** on a series' list, and the page's **EXPORT →**: a sheet with the
  Markdown that leaves, COLOURS (LEAVE OUT, AS A TAG), **COPY ALL** (`COPIED ·
14` in the band) and the file (`/api/highlights/export`, `hoshizora-no-shisho.md`).
  Quotes as block quotes, notes as plain paragraphs under them, one heading per
  chapter in reading order; the page's export groups by series. Both are
  `toMarkdown`, one pure function.
- **SAVE IMAGE**: the page as kept. **SAVE CLIP**: the MKV as kept.

## The frame

`tests/highlights-frame.e2e.ts` pins P1's measurements (the bar, the 420px
search, the chips, the list, the 560px open item, its swatches, the 44px disk
line), generated by `design-tools/gen-conformance.mjs` from
`Page.dc.html` and then edited by hand: the generator writes `import … from
'@playwright/test'`, changed to `./fixtures` as every new e2e file takes it,
and a preamble that seeds a database of its own (the shared seed has no
highlights) and serves the build on its own port. Regenerating drops both.
It runs in the desktop project and skips itself in the others.

## Where it departs from the handoff

- **MOVE: a chapter kept from the old source follows, it doesn't lose its way
  back.** Out X5 counts CH. 50 as `1 LOSES ITS WAY BACK` and then says, under
  it, that a kept chapter "still points somewhere; it only loses its way back
  if the kept chapter is later deleted". The repo's MOVE keeps that chapter as
  the same row with its file, so its highlight still opens. The line says `6
FOLLOW` and names CH. 50 under it as `KEPT FROM MANGADEX`; only an entry the
  move deletes (MOVE BACK) counts as losing its way back.
- **A novel's orphan says VOLUME.** The registry calls a novel's entry a
  volume (`kindFacts('novel').unit`), so `FROM A VOLUME NO LONGER IN THE
SERIES`, where the handoff wrote CHAPTER.
- **The series row is in the markup twice** (after ABOUT, and in LISTS'
  group), one shown per layout, because the screen places rows with CSS
  `order` and the phone's fold and the tablet's order want different places.
- **DELETE's sheet** draws its row with the screen's mono labels in capitals,
  as every other confirmation here does, not the mock's sentence-case sans.
- **The marker's three colours** are the handoff's (Main 02, both themes),
  kept on the page until `src/lib/styles/` has them.
- **The TV's page** is the same page (X6 draws a ruled grid of copies); its
  own layout is not built.
- **H3's cell is the reader's own cell** (H3): the bottom row's 24px sides and
  14px type, a hairline on the right, as FULL SCREEN and SETTINGS ↑ beside it
  draw; Manga M1 draws the row's cells at 18px and 13px with a hairline on the
  left, a row the reader does not have. The frame file pins the sheet and the
  chooser, not the cell.
- **The page menu's row** (H3) is drawn as the menu's other rows are, a label
  cell (HIGHLIGHT), a line and the action (HIGHLIGHT THIS PAGE, or ✓
  HIGHLIGHTED and OPEN on a kept page), where M5 draws a bare 56px row: the
  reader's menu has rows of that shape. It is the reader's own copy of the
  shared `PageMenu` (`src/routes/read/[entry]/ReaderPageMenu.svelte`), since
  the shared one is the PAGES grid's too and its rows are covers'.
- **The sheet's size** says `1 MB` where M6 writes `1.4 MB`: it is `sizeWord`,
  the disk line's one rule.
- **The page's sheet on a TV** is READING's 420px panel from the right, which
  the pad reaches; M6 draws the phone's bottom sheet only.

## What it does not do yet

- **Make a quote or a clip** (H2, H4), and everything that only matters once
  one is made: the marker in the text reader, re-finding a quote (DETACHED),
  offline quotes waiting to be sent.
- **A page kept in another chapter of the strip** is known only by the
  workstation until the reader opens that chapter: the page menu on a page of
  the chapter above or below offers HIGHLIGHT THIS PAGE even when it is kept,
  and pressing it answers the one kept (`made: false`), never a second.
- **A pinch on a page's copy**, in the sheet or on `/highlights`.
- **A clip in place with the player's subtitle renderer.** The open clip is the
  stored copy in a `<video>` with its still; the player's picture and its
  subtitle renderer live in `VideoPlayer.svelte` (the reader's), and a copy of
  them belongs with the clips themselves, in H4. Then the two should become
  one shared piece.
- **MP4 with a track burned in.** It is made on the workstation by ffmpeg in
  the clip lane, which H4 brings (Main 05, "The clip's job"); SAVE CLIP saves
  the MKV.
- **A clip's in point from the URL.** EPISODE → opens the episode; the player
  reads no start time from its URL yet.
- **The library's bulk DELETE line** (`31 HIGHLIGHTS IN 4 SERIES ARE KEPT`):
  `deleteSeries` takes the option and `keptAcrossLine` says it, but the bulk
  bar is the library page's (doc/handoff-notes/highlights.md, Gaps).
- **The TV's grid** (X6) and its tile sheet.
- **Covers in the snapshot**: `cover` is kept for H2 to H4 to fill; H3 left it
  empty, since a page's copy is its own picture.

## Tests

- `tests/migrations-db.spec.ts`, rung 72: the table on a v71 library, nothing
  moved, no foreign key, the CHECKs.
- `tests/highlights-db.spec.ts`: the life through the app's doors (the
  cascade measured, delete.ts with and without DELETE THEM TOO, a book, a
  fold, a re-add by the importer and by browse's ADD, a tombstone, hidden
  before and after a delete, MOVE and MOVE BACK), the note, the colour,
  DELETE and UNDO.
- `tests/highlights-domain.spec.ts`: every line and order the screens derive.
- `tests/highlights-flow.e2e.ts`: MORE's row, the page, search, the open
  item, DELETE and UNDO, reveal, the series row, DELETE's line, the desktop's
  sidebar row and two panes, the row's absence at zero.
- `tests/highlights-frame.e2e.ts`: P1's frame.
- `tests/highlights-pages-db.spec.ts` (H3): keeping a page through the
  reader's own door, the copy's size and format, the same page twice and two
  asks at once, a fetch that fails, a late answer with a retry, another
  writer's row winning, BOTH in both directions, hidden, DELETE and MOVE
  after.
- `tests/highlights-manga-flow.e2e.ts` (H3): the cell and its states, the
  tick, the sheet with NOTE, DELETE and UNDO, H, a late answer, a failure and
  TRY AGAIN, offline, incognito, the page menu's row, the strip's page, a
  spread's choice and the gutter rule. Its own database and preview.
- `tests/highlights-manga-frame.e2e.ts` (H3): M6's sheet and M2's chooser,
  generated from `Manga.dc.html` and hand-edited (its preamble says how).
- `tests/tv-highlights-manga.e2e.ts` (H3): the TV's OK on the cell, the
  spread's choice by the pad, and MENU's row.
- `tests/backup-db.spec.ts`: the copies' mirror.
- `tests/search-commands.spec.ts`: `/highlights`.
