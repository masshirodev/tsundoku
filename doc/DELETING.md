# Deleting

A book, a series, or a selection of series can be deleted: most often a
duplicate, the same book downloaded twice. Every delete asks first.

## Where

| From                                | Deletes                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The series screen, the FILE row     | The series, every chapter or book in it.                                                                                                       |
| A book's sheet in a series of books | That book; the series keeps the rest (renumbered).                                                                                             |
| The library's bulk bar (SELECT)     | Every selected series.                                                                                                                         |
| The duplicates review, KEEP         | The other copy of a book ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)); the review is its confirmation, and UNDO works until the next decision. |

Each opens a confirmation (`ConfirmSheet`, `src/lib/components/chrome/`; on
the series screen its copy `series/[id]/DeleteSheet.svelte`, for the
highlights' row): the question, what it will do, CANCEL, and the action in
full ink, as TAKE OUT is.
Nothing is deleted until it's pressed. After deleting a series, the screen
goes back where it was opened from, the way its ← does
([`NAVIGATION.md`](NAVIGATION.md)), so the shelf comes back as it was.

A hidden series is only deleted with reveal on, as it's only seen then.

## What a delete does

`deleteSeries` and `deleteBook`, `src/lib/server/delete.ts`:

1. **The rows go:** the series or book, its chapters, and its reading log.
2. **Its files move to the trash** (`TRASH_DIR`, default
   `TSUNDOKU_HOME/trash`, `/mnt/hdd2/tsundoku/trash` on the workstation). Each delete gets a folder named by its time,
   and each file keeps the path it had in the library folder:
   `trash/2026-09-23T22-40-00-000Z/Hentoid/nhentai/Book - [123]/`. It's a
   rename on the same disk, so it's instant, and nothing is erased. The space
   comes back when the trash is emptied. Only files inside `LIBRARY_ROOT` are
   ever moved; the seed's sample series have none.

   **A file another series still reads stays.** Two series can share a folder:
   a Mihon download imports keyed by its folder (`mihon-dir:`) until a backup
   knows the manga, and then again by its URL, both pointing at the same CBZs
   ([`IMPORT-MIHON.md`](IMPORT-MIHON.md)). Deleting either twin leaves the
   files, and the other keeps its chapters. Before 2026-10-04 it didn't: deleting
   the folder twin of 死体担ぎのネム trashed the 30 CBZs its URL twin read too.
   Since then the importer folds such twins into one
   ([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the backup knows it"), so a
   pair is rare, but a device that hasn't backed up yet can still make one.

3. **A tombstone keeps it gone** (`tombstones`, rung 18): the series' origin
   key and each chapter's or book's source URL. Mihon's backup still lists the
   series, and the phone may still have the book (doc/SYNC.md), so without it
   the next scan or sync would bring it back. The importer passes by anything
   buried (`writeSeries`), a deleted book inside a series too.
   A chapter whose file another series still reads isn't buried: it isn't
   gone.

On the workstation's Syncthing, a file moved out of a receive-only folder
shows up as a local change. Leave it: **Revert Local Changes** would fetch it
from the device again, if the device still has it.

4. **Highlights are kept** ([`HIGHLIGHTS.md`](HIGHLIGHTS.md); c701). A
   series or a book with highlights says so in its confirmation, **14
   HIGHLIGHTS ARE KEPT**, with **DELETE THEM TOO** as a switch under it, off.
   Kept, they stay on the highlights page with their copies and notes, ORPHAN
   (from a series no longer in the library, or a book no longer in the
   series): rung 72's triggers mark them whichever door deletes, a cascade
   included. With the switch on the action reads **DELETE WITH 14
   HIGHLIGHTS**, and `deleteSeries`/`deleteBook` take `{ highlights: true }`
   and remove their rows in the same transaction as the series' or book's,
   and their copies' files only once that transaction has committed: a
   delete that rolls back keeps both the row and its copy. The
   library's bulk DELETE keeps them and says nothing yet (HIGHLIGHTS.md, "What
   it does not do yet"); the duplicates review's KEEP keeps them too.

## Undoing one

There's no UNDO in the app; that's what the confirmation is for. By hand:

```sh
# 1. put the files back where they were
mv /mnt/hdd2/tsundoku/trash/<time>/<path> /mnt/hdd2/tsundoku/tablet/<path>
# 2. let the importer see it again
sqlite3 data/library.sqlite "DELETE FROM tombstones WHERE title = '<title>'"
# 3. START SCAN (or wait for the sync timer)
```

The reading log that went with it doesn't come back; Mihon's backup restores
what it knows (read chapters, progress).

## Emptying the trash

Nothing empties it automatically. `rm -rf /mnt/hdd2/tsundoku/trash/<time>`
when sure.

Tested in `tests/delete-db.spec.ts` (files to the trash, rescans don't bring
it back, a twin's shared files stay, a hidden series is left alone, a book out
of a series) and
`tests/delete-flow.e2e.ts` (the confirmation, CANCEL, the bulk bar).
