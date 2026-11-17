# One chapter, several scanlators

Mihon keeps a chapter once per scanlator. When a source lists "Ch. 64" from
two groups, the backup carries both. Imported as they are, the series would
show Ch. 64 twice, and if you had read one copy the other would still count as
unread, so CONTINUE could land on it.

Measured on a real library: 185 chapter numbers across 25 series had two
copies. None of them had both copies on disk. They all came from the backup's
chapter list, and in 67 of them one copy was read and the other wasn't.

Book duplicates are a different thing: the same gallery twice, or the same
book from two sites ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)). A series of
doujin books is never collapsed here.

## What happens

Both copies stay in the database. Either one might be the copy that gets
downloaded later, and deleting one would lose its read state. Instead, one
copy **represents** the chapter, and the others are **shadowed**
(`entries.shadowed`, migration 10):

- the series screen lists one row per chapter;
- a series' chapter count, read count and "+N new" count only representatives;
- CONTINUE, ▶ and the reader's next and previous chapter only go to
  representatives;
- an old link to a shadowed copy (`/read/<id>`, or a cached screen) redirects
  to the chapter's representative.

### Which copy represents it

`representative()` in `src/lib/library/duplicates.ts` goes down this list and
stops at the first difference:

1. a copy you can open (it has a file on disk) beats one you can't;
2. then the series' preferred scanlator;
3. then a copy you've opened;
4. then the oldest (the lowest id).

The preferred scanlator is the one picked in the SCANLATOR row. With no pick
(AUTO), it's whoever has the most chapters of the series on disk, or failing
that the most chapters at all, with ties broken alphabetically so the choice
doesn't change between scans (`automaticScanlator`).

### Read state is the chapter's

Reading any copy counts as reading the chapter. When the copies are
reconciled, the representative takes the read time of any copy that was read,
the latest time any copy was opened, and the place you stopped in the most
recently opened copy (unless it has a place of its own). Marking a chapter
read or unread applies to all of its copies. Otherwise the next reconcile
would carry an old "read" back from a shadowed copy.

## When it runs

`reconcileDuplicates()` (`src/lib/server/duplicates.ts`) runs:

- at the end of every import, once all sources are written;
- when a download is attached, for the series it touched
  ([`DOWNLOADS.md`](DOWNLOADS.md), "Attaching");
- when the SCANLATOR row changes, for that series.

It only sets `shadowed` and carries state forward, so running it twice
changes nothing.

## Where scanlators come from

- **The backup:** a chapter's scanlator field.
- **A download:** `<Translator>` in the CBZ's `ComicInfo.xml`, which Mihon
  fills from the same field.

A rescan updates an existing entry's scanlator, so `yarn run import` fills in
scanlators for chapters imported before they were recorded.

## SCANLATOR on the series screen

This row appears only on a series with a duplicate chapter and more than one
scanlator. It shows AUTO, then every scanlator with its chapter count, most
chapters first, then "N DUPLICATES HIDDEN". Picking one only changes which
copy represents a chapter where neither copy is on disk; a copy you can open
always wins.
