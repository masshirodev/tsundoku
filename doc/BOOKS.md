# Books, people and grouping

A Hentoid library is mostly **singletons**: one doujin per series, one book per
folder. Mihon and Hentoid both leave them that way. Tsundoku lets the owner
gather related singletons into a **series of books** by hand. It suggests
candidates without ever grouping on its own. It also gives every artist,
circle, author and tag a page of its own.

Design: `doc/design/handoff/Index Books.dc.html` and `Books States.dc.html`.
Briefs: `doc/briefs/done/`. Cards: c15 ("Hentoid singleton into a series") and
its siblings on the Tsundoku board.

## The model

| Thing           | What it is                                                            |
| --------------- | --------------------------------------------------------------------- |
| Singleton       | A `doujin` series with exactly one entry.                             |
| Series of books | A `doujin` series with two or more entries. Each entry is a **book**. |
| Book number     | An entry's place in `entries.position`, the owner's reading order.    |

These are shapes of the existing tables, not new ones. No flag says "series of
books": `isBookSeries()` in `src/lib/library/series.ts` asks the question,
`isSingleton()` in `src/lib/server/books.ts` asks its mirror, and the two
must agree.

### Every book keeps its own

The owner decided on 2026-09-22 that each book keeps its own rating, FAV and
tags, rather than inheriting them from the series. The storage follows from
that:

- **A singleton** keeps its rating, FAV and tags on the **series** row
  (`series.rating`, `series.favourite`, `series_tags`), which is where the
  library grid and sheet already read them.
- **A book in a series** keeps them on the **entry** (`entries.rating`,
  `entries.favourite`, `entry_tags`, rung 5).
- **Grouping** (`groupIntoSeries`) moves a singleton's values from its series
  row onto its entry, and re-homes its `reading_events` onto the target series,
  so nothing read is lost. The emptied series rows are deleted.
- **Taking out** (`takeOut`) is the inverse. It makes a new singleton series
  for the book and moves the entry's values and reading events back onto it.
  UNDO puts the book back into the series in the same place.
- **MOVE TO…** on a book's sheet moves it into another series of books in the
  same root, keeping its values. A series left empty is deleted.
- **UNGROUP** takes out every book.

A series of books has a rating and FAV of its own too: they belong to the
series, not to any book.

**TAGS on a book's sheet** edits that book's own tags (`entry_tags`), in the
shelves-and-tags sheet with the shelves left out: they belong to the series
(`EditSheet`'s book mode, `addBookTag` / `removeBookTag`). A series of books
carries every tag its books carry, which is what the library's tag filters
and person pages find it by, so a tag added to a book is added to the series
too, and one taken off the last book that has it leaves the series.
Suggestions mark ✓ ON THIS by the book's tags, not the series'.

### Rules grouping enforces

`GroupingError` is thrown, and the route answers 400, when:

- a series given isn't a singleton (manga and series of books can't be grouped,
  only books added to them). Novels group by their own rules (below);
- the books are hidden and visible at once: a series can't straddle a hidden
  source and a visible one, or a hidden book would show in a visible series.
  Books from **different sources that are alike** do group: the same work is
  often in both Mihon's local source and Hentoid (the owner's _Akiko-san to
  Issho_), both hidden. The series lives in the first book's source, its path
  widens to hold every book's folder, and a rescan finds each book in it
  whichever source it came from. Until 2026-09-23 any two sources were
  refused, and the refusal never reached the screen;
- a new series would hold fewer than two books, or has no name;
- a book is moved (MOVE TO… on its sheet) to a series that's hidden when it
  isn't, or the other way round.

A refusal is always shown: in the group sheet, which stays open, and on the
series screen as a band ("… · NOTHING CHANGED").

## Volumes of a novel

Every EPUB imports as a series of its own ([`IMPORT-EPUB.md`](IMPORT-EPUB.md)),
so a work in several books arrives as several series: six Beginning After The
End books are six tiles. GROUP gathers them into one. Select the novels on the
library grid (the NOVELS shelf helps), or on their author's page, and tap
GROUP. The same group sheet reads VOLUMES instead of BOOKS: name the series,
order the volumes by date added, by title or by hand, then CREATE SERIES, or
ADD TO EXISTING to put them after another novel.

GROUP is offered when every selected item can be grouped **and all are one
kind**: doujin singletons together, or novels together, never mixed.

The model is the same tables again:

| Thing             | What it is                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Volume            | Every entry of one EPUB file, in a `novel` series.                                             |
| Series of volumes | A `novel` whose entries come from two or more files (`isVolumeSeries()`).                      |
| `entries.volume`  | The title of the book an entry came from, set by grouping (rung 16). `''` in a one-book novel. |
| An entry's `file` | Relative to the series' path, as always. Grouping takes the folder the volumes share.          |

What grouping does (`groupVolumes` in `src/lib/server/books.ts`):

- every entry moves to the series, keeping its read state, position in the
  book and log rows. Positions run 1…n across the volumes, in the order chosen;
- each file is re-expressed from the shared folder
  (`Light novels/Frieren Vol 1.epub`);
- the series takes the highest rating of its volumes, FAV if any had it, all
  their tags and shelves, and the first volume's cover (made off the request);
- the emptied series are deleted.

A novel doesn't keep a rating per volume the way a book in a series does: a
volume isn't a thing the library shows on its own.

On the series screen, CONTENTS heads each volume ("VOL. 2 · FRIEREN: VOLUME
2 · 12 · 3 READ"), each with its own front and back matter. Only the volume
being read folds its read chapters. The text reader downloads each volume's
EPUB on its own, when reading reaches it ([`TEXT-READER.md`](TEXT-READER.md)).

**UNGROUP** (`takeOutVolumes`) gives every volume a series of its own again:

- its book's title;
- its folder and file name;
- the series' rating, FAV, tags and shelves;
- the date its entries arrived;
- its original origin key, so the next scan finds it by its file as before.

Progress was on the entries all along. If one volume is left, it's a plain
book again. The created band's UNDO does the same; after ADD TO EXISTING, it
takes out only the volumes just added.

**Rescans** keep a grouped volume where it is ([`IMPORT-EPUB.md`](IMPORT-EPUB.md),
"Rescanning").

## Order

A new series starts **by date added**, because that is how Hentoid numbers
things. The group sheet also offers BY TITLE and BY HAND (↑↓ per row). On the
series screen, **ORDER** switches the books grid into reorder mode:

- drag a cover (pointer), or focus one and use the arrow keys;
- BY DATE and BY TITLE re-sort in one tap;
- DONE saves (`reorderBooks`) and ✕ discards.

Only the order changes. CONTINUE and the book numbers follow it.

## Suggestions

`suggestionSets()` in `src/lib/library/books.ts` proposes singletons that are
probably one series. It never groups anything. Two singletons match when they
share a **stem**: the first two words of their titles (`stemKey()`). Two
guards keep it from matching everything:

- the title needs at least three words, so a two-word title isn't all stem;
- the two words need at least six letters between them, so "Ai no" or "The
  Greatest" pairs don't count, but "Kaori Mama" does.

`tests/books-domain.spec.ts` holds the examples.

- Only visible singletons are candidates while reveal is off.
- The series screen shows **MIGHT BE ONE SERIES** on a singleton that has
  candidates. REVIEW → opens the group sheet with a tick per book. NOT A SERIES
  dismisses.
- A dismissal is stored in `suggestion_dismissals` as the sorted,
  comma-joined series ids (`setKey`). A suggestion whose books are all inside a
  dismissed set stays dismissed, so dismissing "A, B, C" also silences "A, B".
  One with a new book in it comes back.
- Unticking books in REVIEW and creating the series records the whole
  suggested set as dismissed, so the leftovers aren't suggested again straight
  away.

## Person and tag pages

`/?tag=namespace:value` is the library with a richer header
(`src/routes/PersonView.svelte`, data from `tagPage()` in
`src/lib/server/people.ts`):

- **People** (`artist`, `circle`, `author`) get FAV, which adds them to the
  **PEOPLE** shelf. A circle also gets its ARTISTS row, counted over the
  books this page shows.
- A **SERIES** strip lists the series of books with a matching book.
- The grid holds **books in series** (matched by their own `entry_tags`) and
  **everything else as its series** (matched by `series_tags`). Tapping a book
  opens its series with `?book=` so the book's pages are showing, and ← comes
  back here.
- Filters ALL / UNREAD / FAV / RATED 4+ (an AT LEAST row moves the threshold,
  [`RATINGS.md`](RATINGS.md)), sorts, and BY SERIES (one tile per
  series of books).
- SELECT and the library's bulk bar work here. **GROUP** in the bulk bar is
  offered only when every selected item is a singleton. Books already in a
  series can't be selected.

Hidden means hidden here too. Every query takes `reveal`, and a tag with
nothing visible is a **404**, the same answer as a tag that doesn't exist. A
circle made only of hidden books has no page while reveal is off. The PEOPLE
shelf leaves out a favourite person with no visible books for the same reason.

## Where it lives

| Concern                                | Code                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| Pure rules (stems, order, labels)      | `src/lib/library/books.ts`, `series.ts`                      |
| Grouping, take-out, order, suggestions | `src/lib/server/books.ts`                                    |
| Person and tag pages, PEOPLE           | `src/lib/server/people.ts`                                   |
| Series screen: books grid, book sheet  | `src/routes/series/[id]/BookGrid.svelte`, `BookSheet.svelte` |
| Group sheet (library and suggestion)   | `src/routes/GroupSheet.svelte`                               |
| Person page                            | `src/routes/PersonView.svelte`                               |
| Volumes of a novel                     | `src/lib/server/books.ts` (`groupVolumes`, `takeOutVolumes`) |
| Tests                                  | `tests/books-domain.spec.ts`, `tests/books-db.spec.ts`       |
| Tests, volumes                         | `tests/epub-import-db.spec.ts`, `tests/volumes-flow.e2e.ts`  |

## Known gaps

- **Grouping moves no files.** The books stay in their Hentoid folders, and the
  series lives only in the database. Moving folders on disk would fight the
  Hentoid importer's rescans. FILE on a series of books says "N FOLDERS".
  Each book names its own folder relative to the series path, which grouping
  and take-out copy over ([`IMPORT-HENTOID.md`](IMPORT-HENTOID.md)), and a
  rescan finds a grouped book where it now lives.
- **`cover_phash` finds duplicates, not series yet.** The duplicates review
  uses it ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)); cover similarity would
  make a better suggestion signal than titles too.
- **The READ button waits on the reader** (c13).
