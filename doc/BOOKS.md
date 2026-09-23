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

### Rules grouping enforces

`GroupingError` is thrown, and the route answers 400, when:

- a series given isn't a singleton (manga, novels and series of books can't be
  grouped, only books added to them);
- the books come from different library roots (a series can't span Mihon and
  Hentoid, because its folder has to live somewhere);
- a new series would hold fewer than two books, or has no name;
- a book is moved (MOVE TO… on its sheet) to a series in another root.

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
- Filters ALL / UNREAD / FAV / RATED 4+, sorts, and BY SERIES (one tile per
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
| Tests                                  | `tests/books-domain.spec.ts`, `tests/books-db.spec.ts`       |

## Known gaps

- **TAGS on a book's sheet is disabled.** The tag editor edits `series_tags`;
  scoping it to `entry_tags` is its own change.
- **Grouping moves no files.** The books stay in their Hentoid folders, and the
  series lives only in the database. Moving folders on disk would fight the
  Hentoid importer's rescans. FILE on a series of books says "N FOLDERS".
- **Covers are placeholders** until the importers (c6, c7) supply them, and
  `cover_phash` is a column waiting for them. Cover similarity would make a
  better suggestion signal than titles.
- **The READ button waits on the reader** (c13).
