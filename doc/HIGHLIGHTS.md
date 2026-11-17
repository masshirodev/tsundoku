# Highlights

A highlight is a moment kept: a novel's passage, a manga's page, an anime's
clip. It is **a copy and a pointer**. The copy is the highlight's own and never
changes; the pointer goes back to the place while the place exists, and says
where it came from when it doesn't. Card c444 ("Highlights: a novel's passage,
a manga's page, an anime's clip, kept even after the entry is gone") is the
whole feature, from the brief `briefs/HIGHLIGHTS.md`
and the handoff `handoffs/highlights/` (start with
`Main.dc.html`, whose numbered calls are cited below as _Main 02_ and so on).

It ships in slices:

| Slice  | Card | What it adds                                                                                                                                                    |
| ------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | c701 | The record and its life, the copies' folder and its backup, `/highlights`, the series screen's row, DELETE's and MOVE's lines, the exports. No way to make one. |
| **H2** | c702 | Quotes: the text reader's long press, the bar, the marker in every theme, re-finding a quote in a changed chapter (DETACHED). Below, "Quotes (H2)".             |
| **H3** | c703 | Pages: HIGHLIGHT in the image reader's bottom row and page menu, a spread's choice, the strip's page. Below, "Pages (H3)".                                      |
| H4     |      | Clips: MARK IN, MARK OUT and KEEP in the player, the clip lane, MP4 with a track burned in.                                                                     |

H1 is everything a highlight needs once it exists. H3 (wave 33) made the first
way to make one: a page, from the image reader. H2 (wave 40) makes a quote, from
the text reader. Until H4 lands, a clip exists only where a test (or a hand) puts
it in the table.

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
quote its chapter's text no longer holds; the reader finds that, below).

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

Card c703, from `handoffs/highlights/Manga.dc.html`
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
  press keeps the page on the device for the next connection (c842, below); the
  cell then reads **KEEPING…**, dashed, and pressing it brings the band back;
  HIGHLIGHT. A browsing record (a series not in the library)
  has no cell, as it has no rating.

  **A page kept offline** (c842; the queue is doc/OFFLINE.md, "Writes that
  wait") waits on the device in IndexedDB, as its entry, page and `pageEnd`; the
  workstation makes the copy when it arrives. The band says `WAITING TO BE SENT
· P. 5 · AT THE NEXT CONNECTION` with **DON'T SEND**, which takes it back
  before anything is asked. A press waits like this when the device says it's
  offline, and when the device says it's online but the POST comes back with
  no answer (the workstation asleep, the tunnel down). It goes with no further
  press, from any screen: when the app is next opened, when the connection
  comes back, every 15 seconds while anything waits, and on return to the app
  (doc/OFFLINE.md, "Writes that wait"), and appears in `/highlights` the next
  time that screen loads. Two presses are one, and a resend (a tab that died
  between the POST and the removal, the same page kept on a second device) is
  the same one highlight, by the one-per-page rule below. A page refused on
  arrival (its entry gone, its series hidden since, a source that didn't send
  it on three tries) comes back as `P. 5 NOT KEPT · ITS SERIES OR CHAPTER IS
GONE` at the next image reader opened, with DISMISS; several are `2 PAGES NOT
KEPT`, and no refusal ever names the series, because a 404 can't say which of
  gone or hidden it was. Pressed again, a refused page is a fresh item. Nothing
  waits from a hidden series or with reveal on: those presses keep
  `○ OFFLINE · HIGHLIGHT NEEDS THE WORKSTATION`. Incognito keeps nothing,
  online or off.

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
  too, both before the copy is made and inside the insert's transaction
  (c703, round 3). BOTH and one of its pages alone are two.
- **A BOTH is two pages side by side.** `keepPage` stores the spread as
  its lower then its higher index whichever way it was asked, so 5 with 4 and
  4 with 5 are one highlight, and refuses (404) any second page but the next
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

## Quotes (H2)

Card c702, from `handoffs/highlights/Novel.dc.html`
(_Novel N1_ to _N8_, _J1_ to _J3_, _D1_ and _D2_) and Main 02, built by
`~/.config/myconf/HANDOFF.md`. Its store is `src/lib/server/highlights/quotes.ts`,
its door `src/routes/api/highlights/quotes/`, and the rules that read a chapter
are in `src/lib/library/highlights.ts`; the reader's side is in
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

### One per place: which columns, and why

A repeat is recognised by `kind`, `entry_id`, `block`, `block_offset`,
`end_block`, `end_offset`, **not the words**: the same words twice in a chapter
are two highlights, and the numbers are the place. The same place again answers
the row already there (`made: false`) and writes nothing, whether a second press
or a resend (c842's queue resends when a tab dies between its POST and its
removal, and a second device gets the same), **except a note the row doesn't have**.
No rung: those columns are rung 72's.

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
door already holds is still patched to the chosen colour.

### A selection overlapping a highlight joins it

Every door (the bar's HIGHLIGHT and NOTE, H and N, the lookup panel's foot)
goes through one function, so the rule is one rule. The reader sends the span
that covers the selection and everything it touches, and the workstation folds
every live quote wholly inside what it was asked for into the oldest of them,
which keeps its colour and `made_at`, and **the oldest note there is**, so an older
highlight with no note doesn't cost a newer one its words (`keepQuote`, and
`keepSpan` for what's drawn before the answer); the others are removed
(a quote has no file to unlink). A row only partly inside the asked span is left
alone: no reader that knew of it asks for that, and the words of a union can't
be made on the workstation, which has no chapter text. A DETACHED row never
folds: its numbers are where the words used to be.

**A body lying wholly inside a live quote is that quote.** The join can reach
the workstation before a waiting quote's own POST does, and then the body it
sent names words already in a row: it answers that row (`made: false`) with its
span unchanged and its note merged, as the fold merges one, rather than making a
second row over it. A DETACHED row is not answered this way, since its numbers
are where the words used to be. The merge has one narrow side: a note edited or
cleared on the join before the late body arrives comes back merged, and the open
reader is not told, because the queue's answer draws nothing.

**A list taken early is asked again.** A chapter is drawn from its list of
quotes and from what waits on the device, read as it opens. The first chapter's
list comes with the page, and in SCROLL the next chapter's is fetched while the
reader is still above it. A quote this browser sends between that list and the
device's read is in neither: the list predates its row, and the device no
longer holds it. So when the list was taken early and the reader is online, it
is asked again once the device has been read, and any row not drawn yet is
drawn. A waiting quote over exactly that row's words gives way to it: the door
answers that quote's POST with the same row (c702, R13 and R20).

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
`UNDO_MS` as `/highlights`. As for a page (H3), **the same place kept again
within its UNDO window is the same highlight brought back**, its note with it, on
the words and in the colour just asked; after the window it is a new one. UNDO
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

### A quote waits on the device (c842's queue)

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
item's key and `at`. When the queue's POST
then finds that item gone, `landed` consumes the record and sends no DELETE: the
workstation folded what that POST made into the join's row and kept its id, so a
DELETE would take the joined highlight and its note away. A genuine DELETE or
DON'T SEND keeps `takeBackHighlight` and still sets aside what its POST made. The
record is the tab's own, and it only matters to the page that was running
`landed`: a reload ends that page, so no DELETE is sent at all and the row is
left for the join to fold; only a second tab holding the queue still sends it.

**A join that waits carries what it took in.** Once a join waiting on the
device is written, the quotes it covered leave the device, so if the join is
later refused the covered quote would exist nowhere. The join's queue item therefore carries each covered quote — key, body,
entry, label, and what the reader changed of it while it waited — and
`sendAll` puts every one back, with its note, **before** it records the join
refused. A refusal of the join is reachable without a reader bug: the
workstation caps a quote at 20,000 characters and its paragraph and context at
40,000 (`quotes.ts`), and a join covers the union of every span it took in.
Sent, the join absorbs them; DON'T SEND and DELETE take them with it. A join
deleted while its POST is out takes them back too (`takeBackHighlight`, not a
supersede), so a POST of theirs already out has what it made set aside: the
reader deleted the highlight that held them.

**UNDO is DELETE's inverse.** `takeBackHighlight` hands the removed item back,
`covers` and `revised` with it, so an UNDOne join is queued as it was and a later
refusal still restores the quote and its note. The same holds for a join deleted
while its POST is out and then found unreachable: what it covered is still in
the reader's map, and the UNDO carries it from there. That includes a DELETE
that lands while the device is still writing the join down: its entry is left
for the same door to read, so the UNDO has the covers there too.

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
  row waits ten minutes (`UNDO_MS`) and then goes with its copy, at the
  next listing of `/highlights` or the next page kept from the reader,
  whichever comes first (`purgeDeleted`, which picks and deletes in one
  immediate transaction, so a keep reviving a row in another process cannot
  land between the two).
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
  kept on the page until `src/lib/styles/` has them. The text reader's copy
  of them is on `.text-reader` (`TextReader.svelte`), per theme.
- **A vertical marker sits on the column's left** two-thirds, as J1's caption
  says and `.vt .mk`'s own `inset -0.66em` (which draws on the right) does not.
- **A mouse's drag on the words selects; off the words it still turns** (D1: "A
  drag selects"; the reader's drag-to-turn from c441 is touch and the margins).
- **The 1 px padding either side of a marker** has a matching negative margin:
  `.mk`'s drawn the same, without moving a word when one is made.
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

## The way back to a clip

EPISODE · 12:04 → opens the episode at the clip's in point, by `?t=<seconds>` on
the player's URL (c734; `wayBackHref` writes it, `startSecond` reads it, both in
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

## What it does not do yet

- **Make a clip** (H4).
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
- **A pinch on a page's copy**, in the sheet or on `/highlights`.
- **A clip in place with the player's subtitle renderer.** The open clip is the
  stored copy in a `<video>` with its still; the player's picture and its
  subtitle renderer live in `VideoPlayer.svelte` (the reader's), and a copy of
  them belongs with the clips themselves, in H4. Then the two should become
  one shared piece.
- **MP4 with a track burned in.** It is made on the workstation by ffmpeg in
  the clip lane, which H4 brings (Main 05, "The clip's job"); SAVE CLIP saves
  the MKV.
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
- `tests/highlights-quote-db.spec.ts` (H2): keeping a quote, the repeat, folding,
  the UNDO window, re-anchoring and its events, what a body must be.
- `tests/highlights-domain.spec.ts` also holds H2's rules: the words of a
  chapter, the 32 each side, `reanchor` against a naive search over every pair in
  a finite domain, spans, joins, the word, the page's end, the bar's place.
- `tests/highlights-novel-flow.e2e.ts` (H2): the long press, handles, tap and
  swipe, a mouse's drag and H, HOLD TO TURN, the marker in both themes, the sheet,
  DELETE and UNDO, NOTE with a late answer, joining at every door, DETACHED,
  incognito, a crossing's kept copy, offline and its three ends, Japanese.
- `tests/highlights-novel-frame.e2e.ts` (H2): N1's and N5's phone, D2's panel.
- `tests/tv-highlights-novel.e2e.ts` (H2): a TV shows and makes none.
- `tests/backup-db.spec.ts`: the copies' mirror.
- `tests/search-commands.spec.ts`: `/highlights`.
