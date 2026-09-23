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

| State                | What drives it                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long manhwa, mid-way | Any series with chapters. The fold hides everything read before the last two chapters (`listRows`).                                                                                             |
| Doujin               | `kind = 'doujin'`. The contents are its pages, and the last page opened carries the accent ring.                                                                                                |
| Novel                | `kind = 'novel'`. The EPUB's table of contents with no number column, percentages, a typeset cover, and LAYOUT instead of DIRECTION.                                                            |
| 612 rows, 1 → 540    | The scrub rail (drag, or arrow keys and PageUp/PageDown when focused), and `#` for a typed number. Both open the fold if the target is inside it.                                               |
| Multi-select         | SELECT. Tap rows, or tap one, then RANGE and the other end. ALL UNREAD. Each bulk action shows how many rows it will change.                                                                    |
| Shelves & tags       | EDIT on either row. Shelves are toggles in the owner's order. Tags are typed as `namespace:value` with suggestions from existing tags.                                                          |
| Hidden, reveal on    | The magenta banner and frame from the layout, HIDDEN on the cover, and UNHIDE instead of HIDE. With reveal off the route answers 404, the same as a series that doesn't exist.                  |
| Series of books      | A doujin series with two or more entries. BOOKS replaces the contents as a cover grid, `?book=` shows one book's pages, long-press opens its sheet, ORDER reorders. See [`BOOKS.md`](BOOKS.md). |
| Might be one series  | A single book whose title stem matches other singles. The suggestion band offers REVIEW → and NOT A SERIES ([`BOOKS.md`](BOOKS.md)).                                                            |
| Created / taken out  | `?created=N` after grouping, and a take-out, each show a band with UNDO.                                                                                                                        |

## Rules worth knowing

- **Rating** is six cells, 0–5, and 0 is unrated. On this screen the cells
  **fill up to** the rating (the handoff's convention). The library's pickers
  highlight the one chosen cell. Both clear with 0.
- **Direction** is stored per series (`series.direction`), and `NULL` means the
  kind's default: manhwa scrolls, manga and doujin read R→L, novels page. The
  reader's REMEMBER will write the same field.
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
- **The FILE row counts files, not entries.** A novel's chapters share one EPUB,
  so it reads "1 EPUB". A Hentoid book is a folder of loose images, so it reads
  "1 FOLDER", not the handoff's "1 CBZ", which doesn't match what Hentoid stores
  (`IMPORT-FORMATS.md`).
- **`#`** is an inline field in the list header. The handoff names it but
  doesn't draw it.

## What it does not do yet

- **Nothing opens the reader.** CONTINUE, `▶ CH. N`, the rows and the doujin
  pages are shown but inert until "Image reader from the Index handoff" lands.
  Novels additionally wait on the text reader ("Enable novel entries on the
  series screen once the text reader exists").
- **↓ CACHE and REMOVE CACHE** are disabled, and the per-row `↓` column is
  always empty: caching chapters on the device arrives with the reader.
- **Covers and page thumbnails** are the striped placeholder until the
  importers extract artwork.
- **Alternative titles, source, status, description, per-entry titles and page
  counts** come from the sample seed. The importers will fill them from
  `ComicInfo.xml`, `contentV2.json` and the EPUB's metadata.
