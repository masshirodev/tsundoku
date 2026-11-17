# Deleting

A book, a series, or a selection of series can be deleted: most often a
duplicate, the same book downloaded twice. Every delete asks first.

## Where

| From                                | Deletes                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The series screen, the FILE row     | The series, every chapter or book in it.                                                                                                                                  |
| A book's sheet in a series of books | That book; the series keeps the rest (renumbered).                                                                                                                        |
| The reader's end page               | The series, through the series screen's own `?/delete`. A part of a Work goes as it does from the series screen: the Work keeps its other parts, and ends if one is left. |
| The library's bulk bar (SELECT)     | Every selected series.                                                                                                                                                    |
| The duplicates review, KEEP         | The other copy of a book ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)); the review is its confirmation, and UNDO works until the next decision.                            |

Each opens a confirmation (`ConfirmSheet`, `src/lib/components/chrome/`; on
the series screen its copy `series/[id]/DeleteSheet.svelte`, for the
highlights' row): the question, what it will do, CANCEL, and the action in
full ink, as TAKE OUT is. Nothing is deleted until it's pressed. After
deleting a series, the screen goes back where it was opened from, the way its
← does ([`NAVIGATION.md`](NAVIGATION.md)), so the shelf comes back as it was.

**The end page** (the paged one, the strip's and the novel's) offers DELETE on
a series in the library, with the same sheet, its highlights line included: a
series and its downloads are one thing here, so taking one out of the library
is deleting it, and the page offers no HIDE. It lands on the library, the way
that page's own LIBRARY cell does: back over the reader and the series when the
library is in the tab's history, or replacing the reader when it isn't, so ←
never reopens a page whose series is gone. A browsing record keeps + ADD TO
LIBRARY and draws no DELETE; a hidden series read under `/reveal` keeps UNHIDE
beside it. A press the action refuses closes the sheet and says COULD NOT SAVE
in the row. While the sheet is up the reader under it stands down, for a tap, a
key and the wheel: a wheel moves the sheet when the sheet has room to scroll
and otherwise nothing, because a sheet with nothing to scroll would chain it to
the strip below (`holdWheelForEndSheet`, `src/lib/reader/library-row.ts`).

A hidden series is only deleted with reveal on, as it's only seen then.

## What a delete does

`deleteSeries` and `deleteBook`, `src/lib/server/delete.ts`:

1. **The rows go:** the series or book, its chapters, and its reading log.
2. **Its files move to the trash** (`TRASH_DIR`, default
   `TSUNDOKU_HOME/trash`). Each delete gets a folder named by its time, and
   each file keeps the path it had in the library folder:
   `trash/<time>/Hentoid/nhentai/Book - [123]/`, the time written as
   `YYYY-MM-DDTHH-MM-SS-mmmZ`. It's a rename on the same disk, so it's
   instant, and nothing is erased. The space comes back when the trash is
   emptied. Only files inside `LIBRARY_ROOT` are ever moved; the seed's sample
   series have none.

   **A file another series still reads stays.** Two series can share a folder:
   a Mihon download imports keyed by its folder (`mihon-dir:`) until a backup
   knows the manga, and then again by its URL, both pointing at the same CBZs
   ([`IMPORT-MIHON.md`](IMPORT-MIHON.md)). Deleting either twin leaves the
   files, and the other keeps its chapters. The importer folds such twins into
   one ([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the backup knows it"), so
   a pair is rare, but a device that hasn't backed up yet can still make one.

3. **A tombstone keeps it gone** (`tombstones`, migration 18): the series'
   origin key and each chapter's or book's source URL. Mihon's backup still
   lists the series, and the phone may still have the book
   ([`SYNC.md`](SYNC.md)), so without it the next scan or sync would bring it
   back. The importer passes by anything buried (`writeSeries`), a deleted
   book inside a series too. A chapter whose file another series still reads
   isn't buried: it isn't gone.

4. **Highlights are kept** ([`HIGHLIGHTS.md`](HIGHLIGHTS.md)). A series or a
   book with highlights says so in its confirmation, **14 HIGHLIGHTS ARE
   KEPT**, with **DELETE THEM TOO** as a switch under it, off. Kept, they stay
   on the highlights page with their copies and notes, ORPHAN (from a series
   that has left the library, or a book that has left its series): migration
   72's triggers mark them whichever path deletes, a cascade included. With
   the switch on the action reads **DELETE WITH 14 HIGHLIGHTS**, and
   `deleteSeries`/`deleteBook` take `{ highlights: true }` and remove their
   rows in the same transaction as the series' or book's, and their copies'
   files only once that transaction has committed: a delete that rolls back
   keeps both the row and its copy. The library's bulk DELETE asks the same
   way: its sheet says how many highlights the selection holds and across how
   many series (`?/held`), with the same switch, off each time it opens; a
   read that fails or takes over three seconds leaves the line and the switch
   out, and the delete keeps them. The duplicates review's KEEP keeps them.

When the library folder is a Syncthing receive-only folder, a file moved out of
it shows up as a local change. Leave it: **Revert Local Changes** would fetch
it from the device again, if the device still has it.

## Undoing one

There's no UNDO in the app; that's what the confirmation is for. By hand:

```sh
# 1. put the files back where they were
mv "$TRASH_DIR/<time>/<path>" "$LIBRARY_ROOT/<path>"
# 2. let the importer see it again
sqlite3 "$DATABASE_PATH" "DELETE FROM tombstones WHERE title = '<title>'"
# 3. START SCAN (or wait for the sync timer)
```

The reading log that went with it doesn't come back; Mihon's backup restores
what it knows (read chapters, progress).

## Emptying the trash

Nothing empties it automatically. `rm -rf "$TRASH_DIR/<time>"` when sure.

## Tests

`tests/delete-db.spec.ts` (files to the trash, rescans don't bring it back, a
twin's shared files stay, a hidden series is left alone, a book out of a
series), `tests/delete-flow.e2e.ts` (the confirmation, CANCEL, the bulk bar)
and `tests/end-page-delete-flow.e2e.ts` (each end page, its own seeded
database).
