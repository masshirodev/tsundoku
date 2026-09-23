# The library screen

The screen tsundoku opens on, built from the "Index" design system (see
[`design/README.md`](design/README.md)) against `Index Library.dc.html`, all nine
states on all four devices.

Routes: `/` (the library, with `?shelf=`, `?tag=`, `?sort=`), `/search?q=`, and
`/api/series/[id]` (what the long-press sheet reads).

## States, and what actually drives each

The mock draws each state from a `state` prop. The code has no such prop: every
state is the result of real data or real input.

| State            | What drives it                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Home             | Default.                                                                                                                                       |
| Long-press sheet | Pressing and holding a tile for 450ms, or a right-click. **A plain tap opens it too** (see Departures). Esc or the scrim closes it.            |
| Search           | `/search`. Results follow the typing, 180ms behind it, by replacing the URL.                                                                   |
| Multi-select     | SELECT in the header. Taps then toggle tiles, and the bulk bar applies a rating, FAV, + SHELF or HIDE to exactly the selection.                |
| Reveal on        | Typing exactly `/reveal` in search and pressing Enter. A **session** cookie, so closing the app also ends it. HIDE AGAIN, or `/hide`, ends it. |
| Empty            | No visible series and no scan job.                                                                                                             |
| Importing        | A `scan_jobs` row with no `finished_at`. Series the scanner found but hasn't indexed (`indexed_at IS NULL`) draw as dashed "indexing" tiles.   |
| Import finished  | The latest finished job nobody has dismissed. TIDY NEW dismisses it and opens the NEW shelf.                                                   |
| Offline          | `navigator.onLine` is false. What counts as cached is read from the `tsundoku-entries` Cache Storage bucket.                                   |

## Hidden means hidden

Enforced in SQL (`src/lib/server/library.ts`), not in the page. While reveal is
off, a series hidden directly or through a hidden root is not listed, counted,
searched, suggested or served by `/api/series/[id]` (which answers 404, the same
as a series that doesn't exist). A hidden root isn't even named as a shelf. So
while reveal is off, a hidden title never reaches the browser at all.
`tests/library-db.spec.ts` and `tests/library-flow.e2e.ts` both assert it.

## Rating

An integer 0–5, with `NULL` for unrated, in the schema (`CHECK`), the domain
(`$lib/library/rating.ts`), the picker (`—` clears to unrated) and the tile (no
track at all for unrated, five empty bars for 0). Out-of-range input is refused,
never clamped: a clamped 7 would silently become a 5 nobody chose.

## New chapters

A tile's `+N` counts entries that **arrived after the series was last opened**.
It is not the unread count. Drawing has 18 unread and 3 new. A series never
opened has no "new", only unread.

## Where it departs from the handoff

- **A tap opens the sheet as well as a long-press.** The mock expects a tap to
  open the series screen, which doesn't exist yet. The UI kit does the same
  thing. Once the series screen exists, a tap goes there.
- **"N OPEN" counts every series in progress**, not the rows shown. The mock
  derives it from how many rows it drew (4 on tablet, 2 on phone). Here it's a
  fact about the library, and the phone shows two rows of it.
- **Every series opened and not finished counts as in progress.** The seed data
  has thirteen, so the label reads 13 OPEN where the mock drew 4.
- **The offline CACHED tab filters on the device.** Only the tablet knows what
  it has cached, so the server lists everything and the page narrows it. ALL
  stays the default offline, with uncached tiles dimmed. The mock inverted the
  first tab by position, which would have made CACHED the default and shown an
  empty grid.
- **During an import the grid defaults to the NEW shelf**, sorted newest first,
  and NEW is prepended to the usual shelves. The mock shows only ALL and NEW
  because its library was empty before the import.
- **+ SHELF in the bulk bar** opens a sheet of shelf chips, reusing the long-press
  sheet's SHELVES row. The mock draws the button but not what it opens.
- **+ ADD in the sheet** expands the non-member shelves as outlined chips, plus a
  field for a new shelf, in the same chip idiom. The mock stops at the button.
- **The login screen** isn't in the handoff. It's assembled from the empty state's
  parts: numbered label, hairline field, primary button.

## What it does not do yet

Specific and honest, so a deliberate gap isn't mistaken for an oversight:

- **No scanner or importers.** START SCAN answers "the scanner is not built yet".
  The library you see is `yarn run seed`, the handoff's sample titles, written
  into a development database. The importing and finished states are fully built
  and only need a scanner writing `scan_jobs` rows. Cards: "Mihon importer",
  "Hentoid importer into a hidden root".
- **No reader and no series screen.** The resume buttons, `▶ CH. N`, and SERIES in
  the sheet are disabled until those handoffs come back (`doc/briefs/READER.md`,
  `SERIES.md`).
- **No tag editor.** TAGS in the sheet and TAG in the bulk bar are disabled. The
  mock draws the buttons but no editor.
- **Nothing is ever cached**, because the reader is what will cache chapters.
  The offline state is complete but has nothing to report as available.
- **No list view.** Direction 1b offered GRID ▦ / LIST ☰, and Turn 3 dropped it.
  It isn't built.
- **IMPORT LOG and SETTINGS** in the desktop sidebar are shown, disabled, and go
  nowhere.
- **No real covers.** Every cover is the striped placeholder until the importers
  extract artwork.
- **Sorting** cycles recently read → A–Z → rating → recently added through the
  label on the right of `02 — SHELVES`. The mock shows the label but not what
  tapping it does.
