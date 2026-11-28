# Highlights

A highlight is a moment kept: a novel's passage, a manga's page, an anime's
clip. It is **a copy and a pointer**. The copy is the highlight's own and never
changes; the pointer goes back to the place while the place exists, and says
where it came from when it doesn't.

A quote is made in the text reader ("Quotes"), a page in the image reader
("Pages"). The record, its life, the copies' folder and its backup,
`/highlights`, the series screen's row, DELETE's and MOVE's lines and the
exports serve all three kinds, and the player makes a clip ("Clips").

## The record

`highlights`, migration 72 (`src/lib/server/db.ts`). One row per highlight:

- **kind**: `quote`, `page` or `clip`. A highlight's own kind, never a series'
  kind; what a series is called comes from the registry (`kindFacts`) asked
  with the snapshot's `series_kind` ([`KINDS.md`](KINDS.md)).
- **The pointer**: `series_id` and `entry_id`, and the keys that outlive an
  id: the series' `origin_key`, and the entry's `number` and `season`. No
  foreign key: nothing cascades into a highlight. An id is not an identity,
  and SQLite hands a deleted row's id to the next insert, so a delete nulls the
  ids rather than leaving one that may point at a stranger.
- **The place**: a quote's `block`, `block_offset`, `end_block`, `end_offset`
  (the text reader's own position, `src/lib/reader/text.ts`); a page's `page`
  (0-based) and `page_end` (a spread kept as BOTH); a clip's `clip_in` and
  `clip_out`, seconds into the episode.
- **The snapshot**: `series_title`, `series_kind`, `cover`, `entry_label`
  (`Ch. 3`, `Ep. 7`), `entry_title`, `volume`; for a quote, `quote`, the 32
  characters either side (`quote_before`, `quote_after`, for re-finding it),
  its `paragraph` and the one before (`context`).
- **colour**: `yellow`, `orange` or `blue`, quotes only (a CHECK keeps a page
  and a clip without one). Three colours and no meanings.
- **note**: a few lines of plain text. The note and the colour are the only
  things that change after making one, besides deleting it.
- **made_at**, **hidden**, the copy (`copy_path`, `still_path`, relative to
  the copies' folder, `copy_bytes`, `copy_width`, `copy_height`, `quality`,
  `tracks` and `track`), **state**, `orphaned_at`, `rejoin`, `deleted_at`.

**state** is `ok`, `orphan_series` (the series is not in the library),
`orphan_entry` (the series is, the chapter or episode isn't) or `detached` (a
quote its chapter's text doesn't hold any more; the reader finds that, below).

## The pointer's life

Kept by **triggers in the migration**, not by a call in each code path. A
series or an entry is changed by a dozen paths, and a trigger is the one place
every path reaches, foreign-key cascades included: SQLite fires a child
table's DELETE triggers for an ON DELETE CASCADE, which
`tests/highlights-db.spec.ts` measures ("SQLite fires a child table's triggers
for a cascade").

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

Every path that deletes, and what it does to a pointer (`rg -n "DELETE FROM
(series|entries)" src`, plus the cascades):

| Path                                                    | Where                                                | Pointer                                                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DELETE on the series screen, the library's bulk DELETE  | `deleteSeries`, `delete.ts`                          | ORPHAN (series); DELETE THEM TOO removes them                                                                                                                                        |
| A book's DELETE                                         | `deleteBook`, `delete.ts`                            | ORPHAN (entry); the last book, ORPHAN (series)                                                                                                                                       |
| The duplicates review's KEEP                            | `dupes.ts` → `deleteSeries`/`deleteBook`             | as those                                                                                                                                                                             |
| GROUP, a books fold, a singleton folded in              | `books.ts` (UPDATE entries, DELETE series)           | follows its entry into the series it joins                                                                                                                                           |
| An import's fold (twins folded into one)                | `foldSeries`, `import/fold.ts`                       | re-pointed to the twin's matching entry, and the series, by the fold's own sweep of every table with an `entry_id` or `series_id` column; an entry only `from` had follows it across |
| An import that drops a root's empty series or a chapter | `import/index.ts`                                    | ORPHAN                                                                                                                                                                               |
| UNDO of an ADD                                          | `undoAdd`, `engine/backend.ts`                       | ORPHAN (series); a re-add re-resolves                                                                                                                                                |
| MOVE BACK's chapter only the source left had, no file   | `applyMoveBack`, `move.ts`                           | ORPHAN (entry), counted in `highlightsLost`                                                                                                                                          |
| A root deleted (cascades its series and entries)        | SQLite's cascade                                     | ORPHAN (series)                                                                                                                                                                      |
| A refresh that drops chapters                           | none: a refresh adds, it never deletes               | -                                                                                                                                                                                    |
| A Work's UNDO                                           | re-creates `work_series` rows, not series or entries | untouched                                                                                                                                                                            |

**A re-add re-resolves by its keys**, since an id is not an identity. The
paths that add a series, and the ones a spec covers: the importer's
`writeSeries` and browse's ADD (`keepOrPromote`, a browsing record made the
library's), both in `tests/highlights-db.spec.ts`. Not covered by a spec of
their own: browse's first ADD of a series never seen (`addToLibrary`,
`engine/backend.ts`), the novel and anime sources' ADD (`novels/source.ts`,
`anime-source.ts`), and the books' new series (`books.ts`): each is an INSERT
with `in_library = 1` and a key, which is the case `highlights_series_back`
fires on. A browsing record (`in_library = 0`) never re-resolves; its ADD does.
And a series deleted by `deleteSeries` is tombstoned
([`DELETING.md`](DELETING.md)), so nothing in the app adds it again until its
tombstone goes: its highlights stay ORPHAN.

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

MOVE's summary gets a **HIGHLIGHTS** row from that same plan
(`moveComparison().highlights`, `moveHighlights`): `6 FOLLOW`, and the ones on
a chapter the new source lacks named under it, `CH. 50 · P. 7 · NO CH. 50 ON
WEEB CENTRAL · KEPT FROM MANGADEX`. A chapter kept from the old source follows
rather than losing its way back, because MOVE keeps that chapter as the same
row with its file, so its highlight still opens; only an entry a move deletes
(MOVE BACK) counts as losing its way back. MOVE BACK has no summary screen; its
MOVED band says `2 HIGHLIGHTS LOST THEIR WAY BACK` when it took any (`?lost=`).

## Pages

The store is `src/lib/server/highlights/pages.ts`; the reader's rules are in
`src/lib/library/highlights.ts` (`cellState`, `cellLabel`, `spreadChoices`,
`pageTicks`, `ruleSide`, `pageSheetHead`, `pageSheetLine`). The reader's side
is in [`READER.md`](READER.md), "Highlights".

- **HIGHLIGHT** is a cell in the image reader's bottom row, before FULL
  SCREEN, **H** on a keyboard, and **HIGHLIGHT THIS PAGE**, the first row of
  the page menu (long press, OK held, MENU). One press keeps the page; nothing
  asks. The cell is the bottom row's own (24px sides, 14px type, a hairline on
  the right, as FULL SCREEN and SETTINGS ↑ beside it draw). The page menu's row
  is drawn as the menu's other rows are: a label cell (HIGHLIGHT), a line and
  the action (HIGHLIGHT THIS PAGE, or ✓ HIGHLIGHTED and OPEN on a kept page).
  The menu is the reader's own copy of the shared `PageMenu`
  (`src/routes/read/[entry]/ReaderPageMenu.svelte`), since the shared one is
  the PAGES grid's too and its rows are covers'.
- **A spread asks which**: the two pages in reading order (R→L: the right one
  first, `P. 14 · RIGHT`), then **BOTH · AS ONE**. A wide page shown alone is
  one page and does not ask.
- **The strip's page** is the one under the middle of the screen, the one the
  strip already reads as the page being read (keepPlace's `at`), outlined in
  ink (3px, inset) while the controls are up; the cell names it, `HIGHLIGHT
P. 23`.
- **A kept page says so off the art**: the cell reads **✓ HIGHLIGHTED**,
  inverted; the scrubber has a 4 × 8 yellow tick at each kept page (both pages
  of a BOTH); a letterboxed page has a 4px yellow rule in its gutter, 6px off
  its outer edge (away from the spine: the right in R→L, the left in L→R, a
  spread's page on the side it is drawn). With the controls hidden and no
  gutter (full bleed, or zoomed past 100%) nothing shows. A tap on ✓
  HIGHLIGHTED opens the page's sheet; it never unmarks.
- **The page's sheet**: the copy, NOTE (saved when the field is left or the
  sheet closes; a note the workstation refused says NOTE NOT SAVED and keeps
  the words), `MADE 4 NOV · A COPY ON THE WORKSTATION · 1 MB` (the size is
  `sizeWord`, the disk line's one rule), **SAVE IMAGE** (the copy, `?save=1`)
  and **DELETE**, at once, with the band's **HIGHLIGHT DELETED · UNDO** (the
  same `UNDO_MS` as `/highlights`). On a TV the sheet is READING's 420px panel
  from the right, which the pad reaches, rather than the phone's bottom sheet.
- **The cell's states**, ranked: **INCOGNITO** (dimmed to 0.4, disabled:
  incognito makes none, and `POST /api/highlights/pages` refuses one with 403
  whatever the page thinks); **KEEPING…**, dashed, while the workstation makes
  the copy; ✓ HIGHLIGHTED; **○ HIGHLIGHT**, at 0.4, offline, where a press
  keeps the page on the device for the next connection (below); the cell then
  reads **KEEPING…**, dashed, and pressing it brings the band back; HIGHLIGHT.
  A browsing record (a series not in the library) has no cell, as it has no
  rating.

**A page kept offline** (the queue is [`OFFLINE.md`](OFFLINE.md), "Writes that
wait") waits on the device in IndexedDB, as its entry, page and `pageEnd`; the
workstation makes the copy when it arrives. The band says `WAITING TO BE SENT ·
P. 5 · AT THE NEXT CONNECTION` with **DON'T SEND**, which takes it back before
anything is asked. A press waits like this when the device says it's offline,
and when the device says it's online but the POST comes back with no answer
(the workstation asleep, the tunnel down). It goes with no further press, from
any screen: when the app is next opened, when the connection comes back, every
15 seconds while anything waits, and on return to the app, and appears in
`/highlights` the next time that screen loads. Two presses are one, and a
resend (a tab that died between the POST and the removal, the same page kept on
a second device) is the same one highlight, by the one-per-page rule below. A
page refused on arrival (its entry gone, its series hidden since, a source that
didn't send it on three tries) comes back as `P. 5 NOT KEPT · ITS SERIES OR
CHAPTER IS GONE` at the next image reader opened, with DISMISS; several are `2
PAGES NOT KEPT`, and no refusal ever names the series, because a 404 can't say
which of gone or hidden it was. Pressed again, a refused page is a fresh item.
Nothing waits from a hidden series or with reveal on: those presses keep `○
OFFLINE · HIGHLIGHT NEEDS THE WORKSTATION`. Incognito keeps nothing, online or
off.

### The copy, and one per page

`highlights/pages/<id>.webp`, WebP (quality 90) at the page's own size, made
by `sharp` from the bytes `readPage` serves the reader: the downloaded file,
or, for a page read online, fetched once from the source through the engine's
proxy (`readOnlinePage`, which asks for the list afresh once before it gives
up). A BOTH is one image, the two pages side by side as the reader draws them
(R→L: the later page on the left), the shorter scaled to the taller's height.
**WebP refuses a side over 16383 px**, so a page taller than that (a long
manhwa or webtoon strip page, an unsplit chapter) or a BOTH wider than that is
scaled to fit inside 16383 × 16383, keeping its aspect; `copy_width` and
`copy_height` are the copy's real size. Below the limit the copy is at the
page's own size.

- **No row without its copy.** The copy is written under a scratch name first;
  the row is inserted and the copy renamed to `<id>.webp` in one transaction,
  and a failure (the source sent nothing, 502; not an image, 422; no such
  page, 404) leaves neither. The reader says ✓ HIGHLIGHTED only once the
  answer arrives, so it never says so of a page whose copy does not exist.
- **The same page twice is one highlight** (`kind = 'page'`, the entry, `page`
  and `page_end`, not deleted). An ask while the same page's ask is still on
  its way waits for it (the in-flight map), and the insert checks again inside
  its transaction, so two asks that slip past each other (two devices, two
  processes) end as one row and one copy. **A page deleted and kept again
  within its UNDO window is the same highlight brought back** (its `deleted_at`
  cleared, in the same immediate transaction as the check, and `made` false
  in the answer, its note and `made_at` with it), never a second row and copy;
  the UNDO the delete offered then finds nothing set aside and answers 404,
  which the reader takes as "kept either way" and `/highlights` as its band's
  message. **After the window it is a new highlight**: no note, `made_at` the
  keep's own time, whether or not `/highlights` has been opened since. The
  window is `UNDO_MS` from the last DELETE, its edge inclusive (a row deleted
  exactly `UNDO_MS` ago still comes back). A keep first purges every row past
  its window, with its copy, and the revive's select is bounded by the window
  too, both before the copy is made and inside the insert's transaction. BOTH
  and one of its pages alone are two.
- **A BOTH is two pages side by side.** `keepPage` stores the spread as its
  lower then its higher index whichever way it was asked, so 5 with 4 and 4
  with 5 are one highlight, and refuses (404) any second page but the next
  one. The reader always sends them in that order; only a hand-made request
  could ask otherwise.
- **A page's kind is `page`**, never the series' kind; `series_kind` is the
  snapshot, as for every highlight.
- **Hidden** is copied from the series when the page is kept; a hidden series'
  page is not found without reveal, as its reader is not.
- **After**: the triggers do the rest, as for every highlight. A series
  deleted after a page is kept leaves it ORPHAN (series) with its copy, and
  DELETE's line counts it; MOVE's line counts it (`6 FOLLOW`, and
  `CH. 50 · P. 7` named when the move takes its chapter away).

## Quotes

The store is `src/lib/server/highlights/quotes.ts`, its endpoint
`src/routes/api/highlights/quotes/`, and the rules that read a chapter are in
`src/lib/library/highlights.ts`; the reader's side is in
[`TEXT-READER.md`](TEXT-READER.md), "Highlights".

### The copy

The quote, its paragraph (the blocks it lies in), the block before, and 32
characters either side for re-finding it. All of it from the same **words of
the chapter**: a block's text with furigana out (`rt`, `rp`) and a wide block's
head out, every run of white space as one space, the blocks joined by a newline
(`flatten`). A block with no words (an illustration, a rule) is not in it, so
one added or taken away never moves a quote. The sides never split a character
in two, which SQLite's UTF-8 could not keep.

The place is the reader's own position (`block`, `block_offset`, `end_block`,
`end_offset`), a count of every character of the block's text, furigana included;
the words are what's compared. `src/lib/reader/text-marks.ts` turns one into the
other. Nothing about a kept quote is a file: no copy, no bytes on the disk line.

### The marker

The three colours are defined where they are drawn, per theme: on the
`/highlights` page, and on `.text-reader` (`TextReader.svelte`) for the reader,
not in `src/lib/styles/`. A vertical marker sits on the column's left
two-thirds. The 1 px padding either side of a marker has a matching negative
margin, so a marker is drawn without moving a word when one is made.

A mouse's drag on the words selects; off the words it still turns the page, as
the reader's drag-to-turn does for touch and the margins.

### One per place: which columns, and why

A repeat is recognised by `kind`, `entry_id`, `block`, `block_offset`,
`end_block`, `end_offset`, **not the words**: the same words twice in a chapter
are two highlights, and the numbers are the place. The same place again answers
the row already there (`made: false`) and writes nothing, whether a second press
or a resend (the offline queue resends when a tab dies between its POST and its
removal, and a second device sends the same), **except a note the row doesn't
have**. No migration of its own: those columns are migration 72's.

### A note in the body is never dropped

A press can arrive for a row it didn't know of: a note written offline on words
already highlighted, or on a chapter whose markers hadn't loaded. On all three
paths that don't insert (the same place, a fold, a revive) `mergeNotes` decides:

- the body has none, or the row already holds exactly that note: no change, so a
  true resend still writes nothing;
- the row has none: the body's;
- the body only continues the row's (typing went on): the body's;
- **two different notes: both, the row's first, a blank line between**, cut at
  the note's 4,000 characters. Appending is the one choice that loses nobody's
  words; the reader can delete the half they didn't want.

The colour is not merged. A body's colour is often only the reader's current
pen, so on a row already there it is applied only if the reader chose it while
the press waited (the item's `revised`), by the queue's PATCH after the answer.
A press of exactly a waiting quote's span is that item again, not a new one:
what the reader changed while it waited rides the re-queued item, so a row the
workstation already holds is still patched to the chosen colour.

### A selection overlapping a highlight joins it

Every way to make one (the bar's HIGHLIGHT and NOTE, H and N, the lookup
panel's foot) goes through one function, so the rule is one rule. The reader
sends the span that covers the selection and everything it touches, and the
workstation folds every live quote wholly inside what it was asked for into the
oldest of them, which keeps its colour and `made_at`, and **the oldest note
there is**, so an older highlight with no note doesn't cost a newer one its
words (`keepQuote`, and `keepSpan` for what's drawn before the answer); the
others are removed (a quote has no file to unlink). A row only partly inside
the asked span is left alone: no reader that knew of it asks for that, and the
words of a union can't be made on the workstation, which has no chapter text. A
DETACHED row never folds: its numbers are where the words were before the text
changed.

**A body lying wholly inside a live quote is that quote.** The join can reach
the workstation before a waiting quote's own POST does, and then the body it
sent names words already in a row: it answers that row (`made: false`) with its
span unchanged and its note merged, as the fold merges one, rather than making a
second row over it. A DETACHED row is not answered this way, for the same
reason. The merge has one narrow side: a note edited or cleared on the join
before the late body arrives comes back merged, and the open reader is not
told, because the queue's answer draws nothing.

**A list taken early is asked again.** A chapter is drawn from its list of
quotes and from what waits on the device, read as it opens. The first chapter's
list comes with the page, and in SCROLL the next chapter's is fetched while the
reader is still above it. A quote this browser sends between that list and the
device's read is in neither: the list predates its row, and the device doesn't
hold it any more. So when the list was taken early and the reader is online, it
is asked again once the device has been read, and any row not drawn yet is
drawn. A waiting quote over exactly that row's words gives way to it: the
workstation answers that quote's POST with the same row.

### DETACHED, and back

The words are only ever read on the device (the chapter is an EPUB parsed in
the browser), so the reader finds this and tells the workstation
(`PUT /api/highlights/quotes`). Each opened chapter's quotes are re-found (the
first with the page, a chapter opened since by `GET ?entry=`):

- **Still at its place** (the quote and both sides, character for character):
  nothing is written. Asked first, because the same words with the same sides
  twice are only a problem once the place is lost.
- **Moved**: the whole of it (32 either side, the quote) is searched for. One
  match re-anchors it and the new numbers are written. Never fuzzy.
- **None, or two**: DETACHED. Its words, note and colour stay; it is drawn nowhere
  in the chapter; on `/highlights` it says `DETACHED · THE CHAPTER CHANGED`, and
  its → opens the chapter at the paragraph where it was.
- **DETACHED, and found again** by the same search (the words came back): `ok`
  and its new place. That is every event the reader can tell apart, so each of
  them is the same check: the chapter's text changed, a re-import, a re-download,
  the same words twice in the chapter, a two-block quote whose second block went.
- **A note or colour on a DETACHED highlight** is an ordinary note or colour.
- **UNDO of a DELETE after the text changed** brings the row back as it was;
  nothing is told about it while it is set aside (`setAnchors` skips a deleted
  row), and the next open checks it like any other.
- **An orphan is left alone**: it has no entry to be re-found in.
- **Incognito moves nothing**: the reader finds and draws, and sends no PUT;
  `PUT` refuses it too. A quote re-found while offline isn't written; the next
  open finds the same thing again.

A chapter opened on two devices with two versions of a book could turn one
quote back and forth: the reader believes the text it has. The result is a
drawn or undrawn marker, never lost words.

### UNDO, and a quote kept twice

DELETE is at once, with `HIGHLIGHT DELETED · UNDO` for 6 s, against the same
`UNDO_MS` as `/highlights`. As for a page, **the same place kept again within
its UNDO window is the same highlight brought back**, its note with it, on the
words and in the colour just asked; after the window it is a new one. UNDO
after that finds nothing set aside and answers 404.

**A write that didn't happen says so.** The marker goes at the press, as DELETE
is at once; if the workstation doesn't take it (no answer or any non-2xx) the
marker comes back and the band says `NOT DELETED · THE WORKSTATION DID NOT ANSWER`
with no UNDO. A colour goes back to the last one the workstation agreed to, with
`COLOUR NOT CHANGED · …`. A failed UNDO says `NOT BROUGHT BACK · …`.

**A band outlives a chapter's turn, so what it does was decided at the press.**
UNDO names the entry it was pressed on: a waiting quote goes back in the queue
under its own chapter, and neither UNDO nor a POST answered late draws on a
chapter it isn't of. The reader's list of quotes is emptied as a chapter opens,
so nothing joins against the last chapter's numbers while this one's are on
their way, and a press made in that window survives their arrival.

### A quote waits on the device

Offline, or with no answer from the workstation, a quote is drawn at once and
goes in the same IndexedDB queue as a page, key `quote:<entry>:<span>`, its
body the words. `WAITING TO BE SENT` is in its sheet, and the note and colour
change the waiting item (`reviseHighlight`). Three ends:

- **Sent**: the marker stays, with the workstation's id; an open sheet follows it.
- **Refused on arrival** (its entry gone, hidden since): the marker goes, and
  the band says `¶ 4 NOT KEPT · ITS SERIES OR CHAPTER IS GONE`, `2 HIGHLIGHTS
NOT KEPT` when several, with DISMISS. The row keeps no words (`sendAll` drops
  the body), and no title, ever.
- **Deleted before it was sent** (`DELETE`, `takeBackHighlight`): nothing is
  asked; UNDO puts it back in the queue. **Deleted while its POST is out** is the
  same promise kept the hard way: a POST that fails isn't queued, and one that
  succeeded has its row set aside (the reader's own POST by DELETE; the queue's,
  only when that POST `made` the row, so a press answered by an existing row
  leaves that row alone).

**A waiting quote joined by a selection is superseded, not deleted, and only
once the join is kept.** The join's own press is what is sent (`keepSpan`), but
the waiting item stays on the device until that press is kept somewhere: written
to the device (`queueCovering` writes the press, then supersedes what it covers)
or answered by the workstation (`sendQuote`). A press kept nowhere (a device
that refuses the write, a refused POST, a reader in reveal) leaves the quote
waiting as it was, note and all, and draws it again. The exact re-press of a
waiting quote is one write over the item, so the item is never absent. Only then
is the waiting item taken back with `supersedeHighlight`, which records the
item's key and `at`. When the queue's POST then finds that item gone, `landed`
consumes the record and sends no DELETE: the workstation folded what that POST
made into the join's row and kept its id, so a DELETE would take the joined
highlight and its note away. A genuine DELETE or DON'T SEND keeps
`takeBackHighlight` and still sets aside what its POST made. The record is the
tab's own, and it only matters to the page that was running `landed`: a reload
ends that page, so no DELETE is sent at all and the row is left for the join to
fold; only a second tab holding the queue still sends it.

**A join that waits carries what it took in.** Once a join waiting on the
device is written, the quotes it covered leave the device, so if the join is
later refused the covered quote would exist nowhere. The join's queue item
therefore carries each covered quote (key, body, entry, label, and what the
reader changed of it while it waited) and `sendAll` puts every one back, with
its note, **before** it records the join refused. A refusal of the join is
reachable without a reader bug: the workstation caps a quote at 20,000
characters and its paragraph and context at 40,000 (`quotes.ts`), and a join
covers the union of every span it took in. Sent, the join absorbs them; DON'T
SEND and DELETE take them with it. A join deleted while its POST is out takes
them back too (`takeBackHighlight`, not a supersede), so a POST of theirs
already out has what it made set aside: the reader deleted the highlight that
held them.

**UNDO is DELETE's inverse.** `takeBackHighlight` hands the removed item back,
`covers` and `revised` with it, so an UNDOne join is queued as it was and a later
refusal still restores the quote and its note. The same holds for a join deleted
while its POST is out and then found unreachable: what it covered is still in
the reader's map, and the UNDO carries it from there. That includes a DELETE
that lands while the device is still writing the join down: its entry is left
for the same code to read, so the UNDO has the covers there too.

What's typed or chosen while its POST is out is not lost either: the queue reads
the row again just before the POST and just after, and sends the difference to
the row the answer named (`landed`). If that can't be sent the item goes on
waiting, and the next pass carries it. A note written in the moment the item
left the queue finds the row by its own id; if nothing took it, the sheet says
`NOTE NOT SAVED` rather than claiming it.

**Every way of closing the sheet sends the draft**: ✕ and the scrim wait for it,
and Escape, BACK, DELETE and a chapter's opening reach the same save (the sheet's
teardown, which holds the quote rather than asking which is open).

**Hidden means hidden on the device too.** A press in a hidden series or with
reveal on is not queued (the words would stay behind): the band says
`○ OFFLINE · HIGHLIGHT NEEDS THE WORKSTATION` and no marker stays. Incognito
keeps nothing, online or off, and a highlight made before still draws and opens.

## Hidden means hidden

`hidden` is **copied from the series when a highlight is made, and kept**: a
hidden series' highlights stay hidden after the series is gone, and `/reveal`
shows them with the HIDDEN badge in magenta, the one place a highlight uses it.
While the series exists the flag follows it (HIDE, UNHIDE, a hidden root,
PUBLIC). Every list, count, disk line and export reads the stored flag, in SQL
(`shown()`, `src/lib/server/highlights.ts`). DELETE THEM TOO removes only what
the viewer can see.

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

## /highlights

Every highlight, newest first, by day (`TODAY`, `5 NOV`). The filters, the
search and the open item are in the URL (`kind`, `series`, `lost`, `q`,
`open`), so a reload, ← and a link land on the same view:

- **ALL, QUOTES, PAGES, CLIPS** with their counts, **SERIES · ALL ↓**, and
  **NO WAY BACK** with its count while there is an orphan.
- **Search** over quotes and notes, and series' names: the match in full ink,
  weight 600, and `IN THE NOTE` when that is where it was.
- **The open item**: beside the list (560px) where the sidebar is, from
  1024px with a fine pointer; the whole screen below that. A quote opens
  with its paragraph and the one before, dimmed, the marker drawn over the
  quote's words, ≡ when it has a note; the colours, NOTE, the line it was made
  on, and **CH. 3 →**, COPY, DELETE. A page opens large (a click opens the
  image alone), SAVE IMAGE. A clip plays in place, SAVE CLIP (the MKV).
- **Orphans and DETACHED** are said, not hidden: a dashed tag, and no →. An
  orphan names its entry by the registry's unit, so a novel's says `FROM A
VOLUME NO LONGER IN THE SERIES` (`kindFacts('novel').unit`).
- **DELETE** is at once, with **HIGHLIGHT DELETED · UNDO** in the band; the
  row waits ten minutes (`UNDO_MS`) and then goes with its copy, at the
  next listing of `/highlights` or the next page kept from the reader,
  whichever comes first (`purgeDeleted`, which picks and deletes in one
  immediate transaction, so a keep reviving a row in another process cannot
  land between the two).
- **The disk line**: `ON THE WORKSTATION · PAGES 14 MB · CLIPS 412 MB · QUOTES
TAKE NONE`, of what shows, and **EXPORT →**.
- **`?series=`** (the series screen's row, or SERIES ↓) reads in reading
  order, by chapter or by season and episode, with **EXPORT**.
- **Empty**: `00 — NO HIGHLIGHTS YET` and where they're made.

It is reached from the desktop sidebar's foot, **HIGHLIGHTS** after HISTORY
with its count, from **MORE** on the tablet, phone and TV (the same row), and
by **`/highlights`** in any bar that parses commands (`parseSearch`,
`src/lib/library/search.ts`): `/highlights lamp` lands with the word in its
search. The row is absent while there are none, and a hidden series' are not
counted without reveal. On a TV it is the same page as elsewhere.

## The series screen's row

**HIGHLIGHTS · 14 · 3 NOTES →** after ABOUT, above the phone's (and the TV's)
DETAILS fold; after LISTS on the tablet and the desktop. Only when the series
has one. A book's quotes are counted bare (`14`), a manga's pages and an
anime's clips by their word (`6 PAGES · 1 NOTE`, `4 CLIPS`): `seriesLine`,
`src/lib/library/highlights.ts`. It opens `/highlights?series=<id>`. The row
is in the markup twice (after ABOUT, and in LISTS' group), one shown per
layout, because the screen places rows with CSS `order` and the phone's fold
and the tablet's order want different places.

## DELETE's line

The series screen's DELETE and a book's DELETE say **14 HIGHLIGHTS ARE KEPT**,
why, and **DELETE THEM TOO** as a switch under it, off each time the sheet
opens; on, the action reads **DELETE WITH 14 HIGHLIGHTS** and posts
`highlights=1` (`deleteSeries(ids, reveal, { highlights: true })`). The sheet
is `series/[id]/DeleteSheet.svelte`, a copy of the shared `ConfirmSheet` with
the row after its lines, drawn with the screen's mono labels in capitals as
every other confirmation is. The library's bulk DELETE
(`src/routes/search/SelectionBar.svelte`) draws the same row for its
selection, `31 HIGHLIGHTS IN 4 SERIES ARE KEPT` (`keptAcrossLine`), with the
same switch.

## Getting them out

- **EXPORT** on a series' list, and the page's **EXPORT →**: a sheet with the
  Markdown that leaves, COLOURS (LEAVE OUT, AS A TAG), **COPY ALL** (`COPIED ·
14` in the band) and the file (`/api/highlights/export`, `hoshizora-no-shisho.md`).
  Quotes as block quotes, notes as plain paragraphs under them, one heading per
  chapter in reading order; the page's export groups by series. Both are
  `toMarkdown`, one pure function.
- **SAVE IMAGE**: the page as kept. **SAVE CLIP**: the MKV as kept.

## The way back to a clip

EPISODE · 12:04 → opens the episode at the clip's in point, by `?t=<seconds>` on
the player's URL (`wayBackHref` writes it, `startSecond` reads it, both in
`src/lib/library/highlights.ts`). The rules, for anything else that links there:

- **It wins over the saved place once.** The URL loses it as the player spends
  it, so a reload opens at the place the episode has reached, and NEXT and
  PREVIOUS never carry it. A failover or TRY AGAIN keeps the second it was
  heading for. A `?t=` beside a saved place draws no RESUMED band: the band says
  the saved place won.
- **Only plain seconds count** (`734`, `734.5`). Anything else, and a second at
  or past a known length, is no place: the saved place and its band stand. A
  length the catalogue didn't give is checked against the file's when it comes.
  A second the file itself refuses makes this the plain open it would have been,
  from the saved place, showing and recording its place as any other does.
- **It is not progress until the picture plays from it.** Nothing is saved while
  the picture sits where the link put it, by a seek's own `timeupdate` or by
  leaving; a refused autoplay leaves the saved place where it was. A full second
  played from there makes it the viewer's. An in point past the ending does not
  mark the episode watched on arrival.

## Clips

MARK IN, MARK OUT and KEEP in the player's bar (I, O, ENTER), on a desktop,
a tablet and a phone; a TV makes none ("Limits"). On a phone held upright they
are a row of their own, three cells under the scrubber and above what scrolls
(A10), and ✕ is the IN cell pressed again. The range follows the playhead with its
length, stops at 3:00 (`3:00 · AT MOST · OUT m:ss`), and an out before the in
swaps them (`clipRange`). A range past 3:00 asked of the server is cut at 3:00,
and an out before the in is put in order (`clipAsk`). Kept ranges are boxes above
the track; a click on one seeks to its start. Offline and incognito dim MARK IN
with their words, and the server refuses a KEEP from incognito. BACK and ESC drop
the range before they do anything else.

**The job** (`src/lib/server/highlights/clips.ts`) is in memory, one at a time, in
a lane of its own, never behind an episode download. A row is written only when
the clip exists; a job is forgotten by a restart, and its partial files are
`.part`, swept at the lane's first use (with any file no row points at), so a
restart mid-cut leaves neither a row nor a file. Being in memory, a clip being
made is lost to a restart without a word: the owner marks it again.

- **A downloaded episode** is cut from its file in one step, every subtitle track
  copied with it.
- **A streamed episode** is fetched first (`FETCHING 1:32 FROM THE STREAM · 1 OF 2`),
  then cut (`CUTTING · 2 OF 2`). The playlist is read through the loopback proxy
  and trimmed to the segments covering the range, so ffmpeg asks for those and
  nothing else: handed the whole list it opens the first segment to probe the
  stream, whatever `-ss` says. The trimmed list is served over http for the one
  fetch, because ffmpeg's HLS reader carries the proxy's secret to a segment only
  from a playlist it opened over http, and for that reason a key's or an init
  segment's `URI=` is made absolute too (the list is served from another port,
  where a root-relative one answers 404). `#EXT-X-MEDIA-SEQUENCE` is rewritten as
  the first kept segment's own number, because an AES-128 key with no IV decrypts
  by it. Subtitles are fetched, cut and shifted to zero here (`cutCues`), each as
  its own track, with the one showing at KEEP as the clip's default.
- **Audio: a clip keeps every track, as it does subtitles, with the one heard at
  KEEP as its default** (with none matched, the track the master calls DEFAULT,
  else the first). A downloaded file's come with the file. A streamed episode's
  separate tracks (a master's `#EXT-X-MEDIA:TYPE=AUDIO` for the chosen variant's
  group, including the masters `serveMaster` makes, else the quality's own `audio`
  list when a master names none) are each fetched as an input of their own, trimmed
  to the same range. Each input keeps its own start, because a video's and an
  audio's segments begin at different seconds, and each is sought by it at the cut,
  which is what keeps them in step. **A track the stream names and does not deliver
  fails the attempt**, and so does one that ends more than a second before the
  picture: a clip that says made and is silent is worse than one that says why it
  wasn't. Separate tracks replace what the video carries, as in a download; a
  rendition with no URI is inside the video and is kept beside them.
- **A variant that isn't a playlist** (`serveMaster` wraps a hoster's plain file the
  same way, so the master names something that is really an episode) is noticed from
  its first bytes and never read whole, then cut as a file by range, with its audio
  beside it.
- **Exact to the frame** means the video is encoded: a stream copy can only start
  on a keyframe. (The handoff's Main 05 says the clip copies the video; the two
  cannot both hold, and exact won. It costs a few seconds per clip.) The release bundles an **LGPL ffmpeg with no libx264**
  (`ops/release/versions.json`), so the encoder is chosen at run time: libx264 if
  this ffmpeg has it, else libopenh264 (the bundle's), else libvpx-vp9.
- **A stream that stops answering** is noticed even though ffmpeg's HLS reader
  skips a segment it can't get and exits 0: its warning is read, and a file
  shorter than its segments add up to is a hole. A range ending past the last
  segment is the clip that exists, and `clip_out` says where it ended; a range
  wholly past the stream makes nothing.
- **Why it wasn't made**: THE STREAM STOPPED ANSWERING AT m:ss, THE WORKSTATION
  ISN'T ANSWERING (the engine down, or a KEEP nobody answered), NO ROOM ON THE
  DISK, and two the handoff doesn't name: THE FILE COULDN'T BE READ (a local file
  that won't read is not a stream), THE EPISODE IS GONE (deleted mid-cut).
  TRY AGAIN keeps the range and asks the stream afresh. Any new ask of a
  range, TRY AGAIN or a plain KEEP, **replaces** that range's failed job on
  the workstation (a failure of another range stays), so a poll, a reload or
  a second device can't read the old failure as the newest word on that range;
  the player also won't take back an id it has let go of, for a poll already in
  flight.
- **A KEEP that got no answer, or a refusal**, is drawn over whatever job the band
  holds. No answer (or a 5xx) is THE WORKSTATION ISN'T ANSWERING with a TRY AGAIN
  that asks afresh; a 400 is THAT RANGE CAN'T BE KEPT, a 403 INCOGNITO KEEPS NO
  CLIPS and a 404 THE EPISODE IS GONE, with ✕ and no TRY AGAIN, since the same ask
  gets the same no. The band stays until the next KEEP or ✕; a poll answering for
  another job says nothing about that KEEP.
- **ENTER is KEEP only when no other control has focus** (nothing focused, the
  track, or KEEP itself). A focused ✕, TRY AGAIN or transport cell keeps its own
  Enter. A kept box is no stop for a TV's pad (`data-focus-skip`), so ↑ from
  the cells lands on the track there.
- **The 3:00 is measured from the IN**, on whichever side the out went, so a range
  always contains the point the viewer marked (`clipRange`).
- **A second KEEP** of the range already being cut is that job; of another range
  it waits its turn; of a range already kept it answers the clip that exists.
- **Leaving or NEXT** does not stop a job; `/highlights` says KEEPING until it is
  made. A series hidden while its clip is cut is hidden in the row (read at the
  end) and off the poll with reveal off.

## Limits

- **A TV makes no clip.** Its bar is eight cells (▶❚❚, −1m, −10, +10, +1m,
  ← EP., the stream, EP. →), and MARK IN and MARK OUT beside them do not fit
  its 960 px inside the 28 px safe margin. Measured in the `tv` project, the
  row is 864 px; with no range, ten cells want 938 px with the stream reading
  `JA · EN SUBS · 1080P · 1.25×` (187 px) and 988 px with `JA · SUBS IN THE
PICTURE · 1080P · 1.25×` (237 px), so the stream cell is cut to 110 px.
  With a range (`IN · 1:23:45` 131 px, `OUT · 1:26:45` 140 px, `KEEP 3:00`
  107 px, ← EP. giving way) they want 1035 and 1085 px. The handoff's A9 drew
  MARK IN and MARK OUT over the six-cell bar the minute cells have since
  grown to eight. So a TV shows the kept ranges on its scrubber and the clips
  on `/highlights`, has no MARK cells, and I, O and ENTER are not its keys
  (its KEYS list leaves them out). Its layout is the owner's to choose.
- **No MP4 with a track burned in.** SAVE CLIP saves the MKV. The clip lane
  ("Clips") is where an export would be made, and it is not built.
- **No NOTE on CLIP KEPT's band** (Anime A7). OPEN → goes to the clip on
  `/highlights`, where its note is; the small sheet over a paused picture is
  not built.
- **The open clip is not the player.** It is the stored copy in a `<video>`
  with its still, playing its MKV's default track only if the browser renders
  it; the player's picture and its subtitle renderer live in
  `VideoPlayer.svelte` (the reader's), and should become one shared piece.
- **A chapter's highlights while offline** come from the page's load or a fetch;
  a chapter opened offline that the page did not bring shows only what waits on
  the device.
- **Two devices overlapping the same words** while neither knows of the other:
  partly-overlapping rows stand as two, drawn over each other, until one is
  deleted; a selection made knowing both joins them.
- **A page kept in another chapter of the strip** is known only by the
  workstation until the reader opens that chapter: the page menu on a page of
  the chapter above or below offers HIGHLIGHT THIS PAGE even when it is kept,
  and pressing it answers the one kept (`made: false`), never a second.
- **No pinch on a page's copy**, in the sheet or on `/highlights`.
- **The TV has no layout of its own** for `/highlights`: no grid of copies, no
  tile sheet.
- **`cover` in the snapshot is never filled**: neither a page nor a quote
  writes it (a page's copy is its own picture).

## Tests

- `tests/migrations-db.spec.ts`, migration 72: the table on a v71 library,
  nothing moved, no foreign key, the CHECKs.
- `tests/highlights-db.spec.ts`: the life through the app's paths (the
  cascade measured, delete.ts with and without DELETE THEM TOO, a book, a
  fold, a re-add by the importer and by browse's ADD, a tombstone, hidden
  before and after a delete, MOVE and MOVE BACK), the note, the colour,
  DELETE and UNDO.
- `tests/highlights-domain.spec.ts`: every line and order the screens derive,
  and the quotes' rules: the words of a chapter, the 32 each side, `reanchor`
  against a naive search over every pair in a finite domain, spans, joins, the
  word, the page's end, the bar's place.
- `tests/highlights-flow.e2e.ts`: MORE's row, the page, search, the open
  item, DELETE and UNDO, reveal, the series row, DELETE's line, the desktop's
  sidebar row and two panes, the row's absence at zero.
- `tests/highlights-frame.e2e.ts`: the desktop page's frame ("The frame").
- `tests/highlights-pages-db.spec.ts`: keeping a page through the reader's
  own endpoint, the copy's size and format, the same page twice and two asks
  at once, a fetch that fails, a late answer with a retry, another writer's
  row winning, BOTH in both directions, hidden, DELETE and MOVE after.
- `tests/highlights-manga-flow.e2e.ts`: the cell and its states, the tick,
  the sheet with NOTE, DELETE and UNDO, H, a late answer, a failure and TRY
  AGAIN, offline, incognito, the page menu's row, the strip's page, a
  spread's choice and the gutter rule. Its own database and preview.
- `tests/highlights-manga-frame.e2e.ts`: the page's sheet and the spread's
  chooser, generated and hand-edited (its preamble says how).
- `tests/tv-highlights-manga.e2e.ts`: the TV's OK on the cell, the spread's
  choice by the pad, and MENU's row.
- `tests/highlights-quote-db.spec.ts`: keeping a quote, the repeat, folding,
  the UNDO window, re-anchoring and its events, what a body must be.
- `tests/highlights-novel-flow.e2e.ts`: the long press, handles, tap and
  swipe, a mouse's drag and H, HOLD TO TURN, the marker in both themes, the
  sheet, DELETE and UNDO, NOTE with a late answer, joining at every entry
  point, DETACHED, incognito, a crossing's kept copy, offline and its three
  ends, Japanese.
- `tests/highlights-novel-frame.e2e.ts`: the phone's selection and sheet, and
  the desktop's panel.
- `tests/tv-highlights-novel.e2e.ts`: a TV shows and makes none.
- `tests/highlights-queue.spec.ts` and `tests/highlights-queue-flow.e2e.ts`:
  the offline queue's rules, and a page kept offline end to end.
- `tests/highlights-preview.spec.ts`: the e2e files' preview refuses a port
  someone else serves.
- `tests/backup-db.spec.ts`: the copies' mirror.
- `tests/search-commands.spec.ts`: `/highlights`.

### The frame

`tests/highlights-frame.e2e.ts` pins the desktop page's measurements (the bar,
the 420px search, the chips, the list, the 560px open item, its swatches, the
44px disk line). Its assertions are generated from the design's mock and
checked in deliberately, then edited by hand: the generator writes `import …
from '@playwright/test'`, changed to `./fixtures` as every e2e file takes it,
and a preamble seeds a database of its own (the shared seed has no
highlights) and serves the build on its own port. Regenerating drops both. It
runs in the desktop project and skips itself in the others. The frame files
pin the sheets and the chooser, not the reader's cell.
