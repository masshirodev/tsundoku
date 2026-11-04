# The series screen

Everything about one series, and the list of what can be read in it. It's built
from `Index Series.dc.html` (the "Index" system, see
[`design/README.md`](design/README.md)) in all seven of its states, on phone,
tablet and desktop.

Route: `/series/[id]`, with `?from=` naming where it was opened from (a shelf
key, `continue`, a person's page, a source's page, or a Work as `work:<id>`) so
the back cell can say so, and `?edit=tags` to open straight into SHELVES & TAGS. That's what the library sheet's TAGS button uses.
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
  LINK and COVER sit under SHELVES, and SOURCE after them ([`MOVE.md`](MOVE.md)).

Like the library, the frame is CSS media queries, so the server's first paint
is already right for the device. `tests/series-layout.e2e.ts` pins the panel
width, row height (60 / 52px) and rail width (56 / 44px) per device. On a TV
the panel is 352px beside the list, rows are 56px and the rail stays 56px
([`TV.md`](TV.md)).

## What drives each state

| State                | What drives it                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Long manhwa, mid-way | Any series with chapters. The fold hides everything read before the last two chapters (`listRows`).                                                                                                                                                                                                                                                                                                                                                          |
| Doujin               | `kind = 'doujin'`. The contents are its pages, and the last page opened carries the accent ring.                                                                                                                                                                                                                                                                                                                                                             |
| Novel                | `kind = 'novel'`. The EPUB's table of contents with no number column, percentages, a typeset cover, and LAYOUT instead of DIRECTION.                                                                                                                                                                                                                                                                                                                         |
| 612 rows, 1 → 540    | The scrub rail (drag, or arrow keys and PageUp/PageDown when focused), and `#` for a typed number. Both open the fold if the target is inside it.                                                                                                                                                                                                                                                                                                            |
| Multi-select         | SELECT. Tap rows, or tap one, then RANGE and the other end. ALL UNREAD. Each bulk action shows how many rows it will change.                                                                                                                                                                                                                                                                                                                                 |
| Shelves & tags       | EDIT on either row. Shelves are toggles in the owner's order. Tags are typed as `namespace:value` with suggestions from existing tags.                                                                                                                                                                                                                                                                                                                       |
| Hidden, reveal on    | The magenta banner and frame from the layout, HIDDEN on the cover, and UNHIDE instead of HIDE. With reveal off the route answers 404, the same as a series that doesn't exist.                                                                                                                                                                                                                                                                               |
| Series of books      | A doujin series with two or more entries. BOOKS replaces the contents as a cover grid, `?book=` shows one book's pages, long-press opens its sheet, ORDER reorders. See [`BOOKS.md`](BOOKS.md).                                                                                                                                                                                                                                                              |
| Might be one series  | A single book whose title stem matches other singles. The suggestion band offers REVIEW → and NOT A SERIES ([`BOOKS.md`](BOOKS.md)).                                                                                                                                                                                                                                                                                                                         |
| Created / taken out  | `?created=N` after grouping, and a take-out, each show a band with UNDO.                                                                                                                                                                                                                                                                                                                                                                                     |
| Not downloaded       | An imported chapter whose file isn't on disk (`entries.available = 0`): NOT DOWNLOADED (phone: NO FILE), a dimmed title, and FILE reads "25 OF 166 DOWNLOADED". See [`IMPORT-MIHON.md`](IMPORT-MIHON.md).                                                                                                                                                                                                                                                    |
| Downloading          | A Mihon series from an installed source (`ENGINE_URL` set): the DOWNLOAD row under CONTINUE with NEXT 10 and ALL N, a tap on a row with no file queues it, and rows say QUEUED, DOWNLOADING, FAILED or IMPORTING. See [`DOWNLOADING.md`](DOWNLOADING.md), "From tsundoku".                                                                                                                                                                                   |
| From a source        | The SOURCE row under LINK and COVER, on every series whose chapters or episodes come from a Mihon or Aniyomi source: the source's name, what it last answered and how many chapters or episodes it lists, with MOVE →. In trouble the second line is in ink (NO VIDEO, NOTHING NEW, NOT ANSWERED). After a move it reads WAS … · UNTIL 1 DEC with MOVE BACK for 30 days, and a kept chapter's status says the source it came from. See [`MOVE.md`](MOVE.md). |
| No video             | After NO SERVER on three episodes within a day (or on every episode, where the series has fewer), a NO VIDEO band under CONTINUE: NO VIDEO FROM KICKASSANIME, ANOTHER SOURCE → and NOT NOW. See [`MOVE.md`](MOVE.md), "The screens".                                                                                                                                                                                                                         |
| Followed             | FOLLOWING ✓ in accent at the DOWNLOAD row's end; caught up, it is the row's only cell and says when its source was last asked.                                                                                                                                                                                                                                                                                                                               |
| Refreshed            | REFRESH, the cell before FOLLOW, on a series in the library whose source can be asked: it looks once, adds what the source lists that no entry is, and queues nothing. The band says "3 NEW CHAPTERS" or "NOTHING NEW". See [`DOWNLOADING.md`](DOWNLOADING.md), "REFRESH" (c220).                                                                                                                                                                            |
| Just added           | `?added=<manga>` after ADD TO LIBRARY: the ADDED TO THE LIBRARY band with UNDO, FIRST 10, and START dimmed until chapter 1 has a file. `&queued=<n>`/`down` after ADD AND DOWNLOAD (c205): the band says what it queued.                                                                                                                                                                                                                                     |

## The WORK row

A series in a Work gets **one row between CONTINUE and DOWNLOAD**, because it
answers the same question: what after this ([`WORKS.md`](WORKS.md), W5;
`Work-Row.dc.html`, B3). It shows the Work's name over `PART 2 OF 3 · NEXT ·
ETERNAL FORCE`, and two 52px ← → cells (44px on a phone) that open the
neighbouring parts, dimmed at the ends. A tap on the name opens `/work/N`; a
long press, MENU or a held OK opens the row's sheet -- OPEN, MOVE ↑ ↓, and TAKE
OUT with a band and UNDO. A series in no Work has no row.

- **Where the run is.** The line says `NEXT · <part>` while the run is here, and
  `YOU'RE IN <part>` once the owner is already in another part it has begun (the
  row's third board slice). Both are `workRowLine`'s.
- **The accent.** When this part is done -- read through, or caught up on a
  source still going -- and the next part has **not been started**, the row
  becomes the accent row `NEXT · <next part> · IN <WORK> · PART 3 · 98 CH. · ▶
CH. 1`, one tap into the next series' first chapter, and CONTINUE above it
  goes quiet as `↺ READ AGAIN`. There is **one accent on the screen, and it is
  the run's**: the panel and the header's ▶ cell read the same part state, so a
  read-through part never shows two accent bars. A next part the owner has
  already begun is not offered as an accent -- the plain row says `YOU'RE IN`
  it.
- **The back cell** names the Work when the series was opened from its run
  (`?from=work:<id>`): `← THE BREAKER`, and `← LIBRARY` otherwise. The id is
  validated and the series' own membership checked, so a stale id is not a
  claim the cell repeats ([`NAVIGATION.md`](NAVIGATION.md), "From a Work").

Tested in `tests/work-row-frame.e2e.ts` (the three states' measurements, the
links, MOVE and TAKE OUT) and in [`WORKS.md`](WORKS.md)'s flow.

## Rules worth knowing

- **The time read** is a line under the title and its alternatives (card
  c443): `READ 12 H 40`, or `WATCHED` for video (the registry's `unit.done`),
  `40 MIN` under an hour and `< 1 MIN` for a glance. It sits beside the read
  progress (an anime's `seriesCountLine` is just above it), comes from the
  reading log's one summary ([`READING-LOG.md`](READING-LOG.md), "Who reads
  it"), and is absent where the log holds no time. A series' own total needs
  no `SINCE`: it is that series' reading as logged. It is not drawn in the
  outline, and is at the top of the panel, so a fold (c425) keeps it in view.

- **A long press on a PAGES cell** opens the page menu: set it as the book's
  or series' cover, or read from it; the chosen page wears a COVER corner
  ([`COVERS.md`](COVERS.md), "Chosen").
- **SAME BOOK AS …** is a band under CONTINUE on a book with a likely twin,
  with KEEP BOTH and REVIEW → ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)).
- **TRACKING** sits under LINK on a linked series: what the AniList and
  MAL lists say of it, what was sent, and EDIT for status and score
  ([`TRACKING.md`](TRACKING.md)). An anime has a line a season there, folded
  round the one being watched, and its EDIT sheet is one season at a time.
- **LINK and COVER** sit under SHELVES on every series but a doujin: its
  MyAnimeList / AniList entry with OPEN ↗, CHANGE and UNLINK, or FIND and
  PASTE A LINK; and where its cover comes from ([`LINKS.md`](LINKS.md)). An
  anime's LINK row is a line a season, each with its own FIND or EDIT, and
  Ranobe's one line under them ([`LINKS.md`](LINKS.md), "The series
  screen"). A one-season anime has no seasons' column, so its LINK and
  TRACKING rows each hold AniList's block and Ranobe's line in a column of
  their own, the line under the block at every width (c422: as a sibling in
  the row it took half the width, and LINK's words went one a line).
- **TAGS** groups a series' tags by namespace (genre, circle, artist, …; a
  bare tag under `tag`), four lines at most. **Every value is a link** (card
  c313): to the library's person page for a person and its tag page for the
  rest (`/?tag=<namespace>:<value>`, or the bare value for a tag with none).
  On a series whose origin key names a source BROWSE can open (installed,
  listed with this reveal, loaded, and the engine there:
  `tag-source.server.ts`), a tap opens a sheet of two rows instead, the
  owner's choice (2026-11-02): **IN THE LIBRARY**, the same page, and **IN
  <SOURCE>**, that source's page finding it -- its genre's filter included,
  or a search for the value ([`BROWSE.md`](BROWSE.md), "Arriving from a
  tag"), whose ← comes back to the series. A series with no origin, a source
  not installed or failed, and a Hentoid, folder, EPUB or import key have no
  sheet: the tap goes straight to the library, as before. The key decides,
  never the kind: a doujin from a Mihon source's gallery asks too. The
  screen asks the source nothing: IN <SOURCE> is a link to
  `/series/<id>/tag-search?ns=&value=&from=`, a server route that waits
  for the source's filters (or `TAG_SCHEMA_WAIT_MS`) and then answers 303,
  so the row is never a guess made before they came, and the sheet stays
  open while it waits. A hidden series, with reveal off, has no sheet and
  its route is not found. Without script the tag's link is the library's.
  A value appears as often as it is stored: a bare `x` and a `tag:x` are
  two values in the `tag` group, each its own link. On a TV the pad reaches the
  values (↓ to the row meets its EDIT, ← into them), OK opens the sheet on
  its first row, and BACK closes it onto the tag.
- **SOURCE sits after LINK and COVER**, before TAGS and ABOUT, on every series
  whose chapters or episodes come from a Mihon or Aniyomi source: MOVE → to
  another source, and for 30 days after a move WAS … · UNTIL … with MOVE BACK
  ([`MOVE.md`](MOVE.md)). A local import has no such row. A chapter kept from
  the source the series left says its source in the status column, and FILE
  counts it (`25 OF 125 DOWNLOADED · 2 FROM ASURA SCANS`).
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
