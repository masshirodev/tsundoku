# The EPUB importer

Moon+ Reader's books: every `.epub` under the library folder's `Library/`
(or `Books/`), at any depth. It runs as the fourth step of the same scan job
as Mihon and Hentoid (START SCAN, `/scan`, or `yarn run import`), into a
visible root called Library. The reader is [`TEXT-READER.md`](TEXT-READER.md).

## What becomes what

| EPUB                         | tsundoku                                                                   |
| ---------------------------- | -------------------------------------------------------------------------- |
| the file                     | a series, kind `novel`, found again by `epub:<path under the library>`     |
| `dc:title`                   | the title (the file name when the package has none)                        |
| each `dc:creator`            | an `author:` tag                                                           |
| each table of contents entry | an entry: `locator` (`doc.xhtml#anchor`), label, position in reading order |
| front and back matter        | `matter = 'front' \| 'back'`                                               |
| the entry's documents' size  | the entry's `bytes`, which weighs it in "% OF BOOK"                        |

Rating, FAV and shelves start empty. Moon+ keeps its positions in its own
database, which isn't reachable from shared storage, so progress starts fresh.

## Reading the table of contents

`src/lib/epub/epub.ts` is pure and runs in node and in the browser. It follows
the 23 books on the tablet (2026-09-23), not the specification's best case:

- **The NCX's `navMap` comes first,** and `nav.xhtml` is the fallback. Every
  book on the tablet has an NCX. Its `pageList` is ignored: Alya's "167", "168"
  are print page numbers, not chapters.
- **Reading order is the spine's,** not the contents'. The Apothecary Diaries
  lists its colour illustrations after the epilogue.
- **A child in its parent's file is a section, not an entry.** Practical
  Reverse Engineering's 45 points become 17 chapters. A child in a file of its
  own is an entry (Pick Me Up's chapters under "Volume 1").
- **Two points at one place are one entry,** the first ("Start" and "Cover" in
  TBATE 8).
- **An untitled point is named from its place:** LOTM's chapter 1427 has no
  label and becomes "Chapter 1427".
- **Entries in one file are split by anchor:** Kino no Tabi's nine stories
  share one document.
- **Matter is decided at the edges:** entries named like matter (Cover, Title
  Page, Contents, Copyright, Insert, Colour Illustrations, Afterword, About the
  Author, Newsletter, …) before the first chapter are front, and after the last
  are back. "Credits" in the middle of a book stays a chapter.

A file that won't open as an EPUB is still listed, as one entry "Book", so the
reader can say what's wrong with it. It counts as unreadable in the scan's
summary.

## Positions and duplicates

A novel's positions are its reading order, 1…n. Chapter numbers repeat in web
novels ("Chapter 2 (1)" and "(2)"), so novels are never collapsed as duplicate
chapters ([`DUPLICATES.md`](DUPLICATES.md)).

Front and back matter don't count toward a series' chapters or READ, aren't
where CONTINUE starts, and don't keep a finished book in CONTINUE.

## Rescanning

Idempotent. An entry is found again by its locator. A new edition of a file
moves its entries' places, labels and matter, and the owner's read state stays
on the entry.

A book the owner grouped as a volume of a novel ([`BOOKS.md`](BOOKS.md),
"Volumes of a novel") no longer has a series with its origin key. The writer
finds it by its entries' source URLs (`epub:<relPath>!<locator>`), as it finds
a grouped Hentoid book. Then, because the series holds other books too
(`src/lib/server/import/write.ts`):

- it leaves the series' path alone and names the file from the series' folder;
- it answers only for this book's own entries (those whose source URL starts
  with `epub:<relPath>!`), so the other volumes are never marked missing;
- a new chapter joins under the volume's title, and `placeVolume` puts the
  book's entries back in the book's order in the volume's run, with the other
  volumes in theirs, so positions stay 1…n.

After UNGROUP a volume has its origin key again and is found by it.

## Measured

On the tablet copy (2026-09-23): 23 EPUBs, which plan into 5,302 entries:

- all 23 have an NCX; 9 also have `nav.xhtml`;
- none is DRM'd;
- the largest book is Lord of the Mysteries at 1,429 chapters in 16.6 MB;
- the largest file is The Apothecary Diaries 5 at 29.3 MB.
