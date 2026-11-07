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
| H3     |      | Pages: HIGHLIGHT in the image reader's bottom row and page menu, a spread's choice, the strip's page.                                                           |
| H4     |      | Clips: MARK IN, MARK OUT and KEEP in the player, the clip lane, MP4 with a track burned in.                                                                     |

H1 is everything a highlight needs once it exists; until H2 to H4 land,
highlights exist only where a test (or a hand) puts them in the table.

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

| Event                                                                | Trigger                                                                          | What the pointer does                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| An entry is deleted                                                  | `highlights_entry_gone`                                                          | `entry_id` NULL, ORPHAN (entry), unless already ORPHAN (series). Copy and note stay.                                    |
| A series is deleted (its entries cascade first or after: either way) | `highlights_series_gone`                                                         | `series_id` and `entry_id` NULL, ORPHAN (series).                                                                       |
| An entry moves to another series (a fold)                            | `highlights_entry_moved`                                                         | Follows it: the new series' id, key and hidden.                                                                         |
| An entry is renumbered (the books' resequence, an anime's)           | `highlights_entry_numbered`                                                      | Its `number` and `season` follow, so a later re-add matches what it was last.                                           |
| A series' key changes (MOVE, MOVE BACK, a fold's re-key)             | `highlights_series_rekeyed`                                                      | Its highlights' `origin_key` follows.                                                                                   |
| A series arrives in the library with a key an orphan kept            | `highlights_series_back`, `highlights_series_added`, `highlights_series_rekeyed` | Re-resolves: the new id, `rejoin`, and each entry by number and season, now or as it arrives (`highlights_entry_back`). |
| A series' or its root's hidden or PUBLIC changes                     | `highlights_series_hidden`, `highlights_root_hidden`                             | `hidden` follows, by `visibility.ts`' one rule.                                                                         |

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
folder and only when the viewer may see the highlight; `?save=1` names the
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

## What it does not do yet

- **Make one** (H2 to H4), and everything that only matters once one is made:
  the marker in the readers, re-finding a quote (DETACHED), offline quotes
  waiting to be sent, incognito making none.
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
- **The TV's grid** (X6) and its tile sheet; pinch-zoom on a page.
- **Covers in the snapshot**: `cover` is kept for H2 to H4 to fill.

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
- `tests/backup-db.spec.ts`: the copies' mirror.
- `tests/search-commands.spec.ts`: `/highlights`.
