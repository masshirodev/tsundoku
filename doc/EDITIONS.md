# Editions: one book in several languages

The same doujin downloaded in two or three languages is **one book**, not
duplicates. The book gets one tile, one rating, one place, and a language
switch. Card c60. It was designed in `Editions.dc.html`, `Book Editions.dc.html`
and the updated `Pair Review.dc.html` in [`design/handoff/`](design/handoff/),
the handoff for [`briefs/done/BOOK-EDITIONS.md`](briefs/done/BOOK-EDITIONS.md). The owner
decided on 2026-09-24 that English opens first by default, with a choice in
SETTINGS, and that there is no side-by-side view.

## The model

Rung 24 (`src/lib/server/db.ts`).

- **The book** is a single-book doujin series. Its own entry is the **base**.
- **An edition** is another entry that has moved into that series, with:
  - `shadowed = 1`: out of every list, count and chapter list;
  - `edition_of` = the base entry;
  - `language`, its `language:` tag's value;
  - `edition_rows`: its pages lined up with the base's (`PageRow[]`, `a` a
    base page and `b` an edition page, both 1-based, or one side alone).
- The base entry also gets `language`.
- **`series.edition_lang`**: the book's own choice of opening language (its
  LANGUAGE row). NULL follows SETTINGS.
- **`series.edition_read`**: the language last read, for a book without an
  edition in the preferred language.
- **`settings`** (key, value): library-wide preferences
  (`src/lib/server/settings.ts`). `edition_language` defaults to `english`.

Folding (`foldEditions`, `src/lib/server/books.ts`) moves the edition's
entry and files in, takes the higher rating, FAV, tags, shelves and reading
events, and deletes the other series, as grouping does. Nothing on disk is
removed. A rescan keeps it folded (`tests/editions-import-db.spec.ts`).

The pure rules are in `src/lib/library/editions.ts`:

- `baseToEdition`, `editionToBase` and `between` map a page across editions:
  the matched page, or the nearest page that has a match, marked not exact;
- `openingEdition` picks the one to open in;
- `onlyIn` gives the pages only one edition has;
- `partOfBigger` spots a story inside a collection, which doesn't fold.

## Which edition opens

In order (`openingEdition`):

1. the book's own LANGUAGE choice;
2. the preferred language (SETTINGS · OPENS IN, English by default);
3. the language last read;
4. the base.

The tile's title and cover, the book screen's title, READ, the PAGES grid and
`/read/<base>` all follow this. A link to the base redirects to the opening
edition unless it carries `?ed=1`, which the reader's switch adds.

## One place for every language

Progress lives on the **base** only. `recordReading` maps an edition's page
onto the base's matched page and logs the event on the base entry. History,
counts and CONTINUE therefore see one book, and every language resumes at the
same place. An edition's own `page_count` is never overwritten.

## The screens

- **Library tile**: the opening edition's title and cover (`editionSource`
  in `covers.ts`, refreshed on a fold, a LANGUAGE change and a SETTINGS
  change). A corner badge gives the codes, the opening one first: `EN · JA`.
- **Book screen** (`SeriesPanel.svelte`):
  - meta `DOUJIN · 2 LANGUAGES`, the opening title, and the others' titles
    with their codes;
  - `▶ READ FROM P. 13` with `EN · 30 PAGES`;
  - LANGUAGE above DIRECTION. Choosing the default language clears the
    book's own choice. When the book has one, a note reads `THIS BOOK OPENS
IN … · OTHERS IN …`, with RESET;
  - EDITIONS: one row per edition. Each gives its site, pages, the size when
    the sizes differ, which pages are only in it (or EVERY PAGE MATCHED), and
    its path;
  - FOLDED: the fold's date, with UNFOLD and HIDE. It stands in place of the
    FILE row.
  - The PAGES grid shows the opening edition's pages, at the book's place,
    with `29 · EN ONLY` on a page only it has.
- **UNFOLD** (`UnfoldSheet.svelte`, `unfoldEditions`): each edition becomes
  a book of its own again, at the page the book is at. Rating, FAV and
  shelves go to every edition. The pairs are recorded as KEPT APART, so the
  review won't offer them again.
- **Reader**:
  - Language cells sit beside the rating (64px, 52px on a phone, where they
    take the room of the rating and FAV). The meta line reads
    `DOUJIN · EN · P. 13 OF 30`.
  - Switching opens the same page in the other edition. A band says
    `JA P. 13 · THE SAME PAGE AS EN P. 13` until the next page turn. When the
    page isn't in the other edition, the band is accent-coloured:
    `EN P. 29 ISN'T IN JA` / `OPENED JA P. 28, THE NEAREST MATCHED PAGE`.
  - The lookup panel has a cell `EN P. 13 →` for the same page in the other
    language.
- **SETTINGS** (`/settings`, [`SETTINGS.md`](SETTINGS.md)): OPENS IN.
- **Duplicates review** ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)):
  - FOLD INTO ONE BOOK is carried out.
  - A pair whose other side is folded already offers ADD AS A THIRD LANGUAGE.
  - A story found inside a bigger collection (PART OF A BIGGER BOOK) offers
    only KEEP APART and SKIP.
  - After a fold, the band has OPEN →.
- **Bulk bar**: selecting two or three single books, each in a language of
  its own, turns GROUP into **FOLD AS LANGUAGES** (`EN · JA`, accent). Their
  pages are hashed and lined up (`offerFold`), and the review opens on the
  pair. Pages that don't match are refused in a band: `THEIR PAGES DON'T
MATCH · NOT ONE BOOK`. Such an asked-for pair is stored with `bits = -1`, so
  it comes first and the next import's pass keeps it.

## OCR

A folded book that has a Japanese edition is read by OCR in that edition only
(`OCR_ENTRY`, `src/lib/server/japanese/ocr.ts`). The English base isn't queued.

## Where it departs from the handoff

- **Notes on pages only one edition has** say `P. 29 · ONLY IN EN`. The
  mock's "TRANSLATOR'S NOTE" and "CREDITS" would need knowing what a page is.
- **The tile's languages are a corner badge.** The app's tiles have no meta
  line, where the mock puts "EN · JA · P. 13".
- **The FOLDED row names no source** beyond FROM THE DUPLICATES REVIEW, and
  a date only when the fold went through the review.
- **No DELETE on a folded book**: unfold first. Deleting would take every
  language's files at once.
- **The page menu (long-press a page) isn't offered on another edition's
  pages**: a cover is chosen from the book's own entry.
- **Offline caching keeps the base entry**, not an edition read by switching.

## Tests

- `tests/editions-domain.spec.ts`: page mapping, the opening edition,
  only-in, part of a bigger book.
- `tests/editions-db.spec.ts`: a fold is one tile; it survives the
  duplicates pass; the opening language; refusals; reading an edition moves
  the base; tile title and codes; OCR on the Japanese edition only; unfold.
- `tests/editions-import-db.spec.ts`: a rescan keeps it folded.
- `tests/editions-flow.e2e.ts`: on the seed's folded Harbour Lights / 港の灯:
  the tile, the book screen and its LANGUAGE override, the reader's switch
  and band, SETTINGS, and UNFOLD.
