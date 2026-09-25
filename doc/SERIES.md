# The series screen

Everything about one series, and the list of what can be read in it. It's built
from `Index Series.dc.html` (the "Index" system, see
[`design/README.md`](design/README.md)) in all seven of its states, on phone,
tablet and desktop.

Route: `/series/[id]`, with `?from=` naming where it was opened from (a shelf
key, or `continue`) so the back cell can say so, and `?edit=tags` to open
straight into SHELVES & TAGS. That's what the library sheet's TAGS button uses.
`/api/series/[id]/tags?q=` answers the tag field's suggestions.

A tap on a library tile opens this screen. A long-press still opens the
library's sheet.

## The frame

- **Portrait:** metadata is a header that scrolls away with the list. Once
  CONTINUE has scrolled out of view, the top bar carries the title and a
  `▶ CH. N` cell (an `IntersectionObserver` on the CONTINUE bar).
- **Landscape and desktop** (≥1024px): metadata is a 440px panel that scrolls on
  its own, and the list keeps the full height with its own scroll.
- The order inside the metadata is the handoff's: identity, then rating and FAV,
  then CONTINUE, all within thumb reach. After that come direction, shelves,
  tags, about, and the FILE row with HIDE, as far from CONTINUE as it can be.

Like the library, the frame is CSS media queries, so the server's first paint
is already right for the device. `tests/series-layout.e2e.ts` pins the panel
width, row height (60 / 52px) and rail width (56 / 44px) per device.

## What drives each state

| State                | What drives it                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long manhwa, mid-way | Any series with chapters. The fold hides everything read before the last two chapters (`listRows`).                                                                                                       |
| Doujin               | `kind = 'doujin'`. The contents are its pages, and the last page opened carries the accent ring.                                                                                                          |
| Novel                | `kind = 'novel'`. The EPUB's table of contents with no number column, percentages, a typeset cover, and LAYOUT instead of DIRECTION.                                                                      |
| 612 rows, 1 → 540    | The scrub rail (drag, or arrow keys and PageUp/PageDown when focused), and `#` for a typed number. Both open the fold if the target is inside it.                                                         |
| Multi-select         | SELECT. Tap rows, or tap one, then RANGE and the other end. ALL UNREAD. Each bulk action shows how many rows it will change.                                                                              |
| Shelves & tags       | EDIT on either row. Shelves are toggles in the owner's order. Tags are typed as `namespace:value` with suggestions from existing tags.                                                                    |
| Hidden, reveal on    | The magenta banner and frame from the layout, HIDDEN on the cover, and UNHIDE instead of HIDE. With reveal off the route answers 404, the same as a series that doesn't exist.                            |
| Series of books      | A doujin series with two or more entries. BOOKS replaces the contents as a cover grid, `?book=` shows one book's pages, long-press opens its sheet, ORDER reorders. See [`BOOKS.md`](BOOKS.md).           |
| Might be one series  | A single book whose title stem matches other singles. The suggestion band offers REVIEW → and NOT A SERIES ([`BOOKS.md`](BOOKS.md)).                                                                      |
| Created / taken out  | `?created=N` after grouping, and a take-out, each show a band with UNDO.                                                                                                                                  |
| Not downloaded       | An imported chapter whose file isn't on disk (`entries.available = 0`): NOT DOWNLOADED (phone: NO FILE), a dimmed title, and FILE reads "25 OF 166 DOWNLOADED". See [`IMPORT-MIHON.md`](IMPORT-MIHON.md). |

## Rules worth knowing

- **A long press on a PAGES cell** opens the page menu: set it as the book's
  or series' cover, or read from it; the chosen page wears a COVER corner
  ([`COVERS.md`](COVERS.md), "Chosen").
- **SAME BOOK AS …** is a band under CONTINUE on a book with a likely twin,
  with KEEP BOTH and REVIEW → ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)).
- **TRACKING** sits under LINK on a linked series: what the AniList and
  MAL lists say of it, what was sent, and EDIT for status and score
  ([`TRACKING.md`](TRACKING.md)).
- **LINK and COVER** sit under SHELVES on every series but a doujin: its
  MyAnimeList / AniList entry with OPEN ↗, CHANGE and UNLINK, or FIND and
  PASTE A LINK; and where its cover comes from ([`LINKS.md`](LINKS.md)).
- **OCR and WORDS** sit under DIRECTION on every series that isn't a novel:
  how far OCR has read it on the workstation, with **OCR** to switch it on
  for one not seen as Japanese, and the words looked up in it waiting for
  review. [`JAPANESE.md`](JAPANESE.md) has the states.
- **Marked unread stays unread.** The import moves read state only forward,
  from Mihon's and Hentoid's own records, and Mihon keeps a chapter's old
  "read" for good. So MARK UNREAD is remembered (`entries.unread_at`, rung
  28), and an import brings a read back only when it's newer than the unmark:
  a chapter read again on the phone since still counts. MARK READ, or
  finishing the chapter here, forgets the unmark. (Until 2026-09-25 an
  unmarked chapter came back read on the next import. The rung repaired what
  it had undone, from the reading log.)
- **Rating** is out of 10, set with the blocky slider, and 0 is unrated. It
  fills up to the rating, FAV sits at its end, and on a linked series it is
  also the score AniList and MAL get ([`RATINGS.md`](RATINGS.md)).
- **Direction** is stored per series (`series.direction`), and `NULL` means the
  kind's default: manhwa scrolls, manga and doujin read R→L, novels page. The
  reader's REMEMBER will write the same field.
- **One row per chapter,** even when Mihon had it from two scanlators. The
  SCANLATOR row, shown only on a series with duplicates, picks whose copy
  represents a chapter ([`DUPLICATES.md`](DUPLICATES.md)).
- **A long press on a chapter row reads it and everything before it,** in
  reading order, whatever order the list is sorted in. A band says "MARKED
  READ THROUGH CH. 41 · 38 CHAPTERS" and offers UNDO, which unmarks exactly
  the chapters that changed and leaves the ones already read alone. It's the
  common case after an import, in one gesture where RANGE takes three taps.
  It's logged as marks (`mark_read`), not reading. It works on not-downloaded
  rows too, which a tap doesn't open, and is off while selecting.
- **The fold** only forms when it would hide at least three rows, because a
  fold of one saves nothing. It sits at the bottom when the list is flipped to
  newest-first. The flip is remembered per series on the device (localStorage).
- **Mark read / unread** changes exactly the selected entries that weren't
  already in that state, and never an entry of another series, whatever the
  form says (`markEntries`).
- **A tapped tag suggestion wins over the half-typed text.** The suggestion is
  submitted as `pick` beside the field's `tag`. Reading `tag` first once stored
  `genre:ise` instead of `genre:isekai`, a second spelling, which is exactly what
  suggestions exist to prevent. `tests/series-flow.e2e.ts` holds that down.
- **Suggestion counts only include visible series**, so the tag field can't be
  used to learn how many hidden series carry a tag.

## Where it departs from the handoff

- **Rating on this screen has a way back to unrated** (0), which the handoff
  lacked. The owner decided on 2026-09-22 that 0 is unrated.
- **On a phone, `#` and SELECT stay in the list header**, and only the sort cell
  is dropped. The handoff hid all three there and said they "move into the list
  once the header has scrolled away", without drawing where. The count
  shortens to the total so it isn't cut mid-word.
- **The fold row's SHOW** expands in place and stays expanded for the visit.
- **Novels' untitled entries show their label** ("Vol. 13"), not "Chapter 13".
  The sample library's novels are volumes.
- **Long press on a chapter row** (mark read through it) isn't in the
  handoff. It's Mihon's "mark previous as read", and it reuses the books
  handoff's confirmation band for UNDO.
- **SCANLATOR** is a row the handoff doesn't have. It's in the shelves-row
  idiom (outlined chips, the chosen one inverted), placed after DIRECTION, and
  only drawn when there are duplicates to hide.
- **The FILE row counts files, not entries.** A novel's chapters share one EPUB,
  so it reads "1 EPUB" (a novel grouped from six books reads "6 EPUB", with
  UNGROUP beside it and a heading per volume in CONTENTS, [`BOOKS.md`](BOOKS.md)).
  A Hentoid book is a folder of loose images, so it reads
  "1 FOLDER", not the handoff's "1 CBZ", which doesn't match what Hentoid stores
  (`IMPORT-FORMATS.md`).
- **`#`** is an inline field in the list header. The handoff names it but
  doesn't draw it.

## What it does not do yet

- **The cover resumes.** A tap on it goes where ▶ CONTINUE goes, once that is
  known (not while the series is still drawn in outline). The owner asked for
  it on 2026-09-23: the biggest thing on the screen is the way in.
- **A chapter that isn't downloaded doesn't open.** Everything else does:
  CONTINUE, `▶ CH. N`, a chapter row, a doujin page and a book's ▶ open the
  image reader ([`READER.md`](READER.md)), and a novel's the text reader
  ([`TEXT-READER.md`](TEXT-READER.md)).
- **Alternative titles, source, status, description, per-entry titles and page
  counts** come from the sample seed. The importers will fill them from
  `ComicInfo.xml`, `contentV2.json` and the EPUB's metadata.
