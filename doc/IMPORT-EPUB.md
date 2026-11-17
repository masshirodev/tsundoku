# The EPUB importer

Moon+ Reader's books: every `.epub` under the library folder's `Library/`
(or `Books/`), at any depth, and under another device's synced copy in
`devices/<name>/Library/`. It runs after Mihon and Hentoid in the same scan
job (START SCAN, `/scan`, or `yarn run import`; [`IMPORT.md`](IMPORT.md)),
into a visible root called Library. The reader is [`TEXT-READER.md`](TEXT-READER.md).

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
a real collection of 23 books, not the specification's best case:

- **The NCX's `navMap` comes first,** and `nav.xhtml` is the fallback. Every
  book in that collection has an NCX. Its `pageList` is ignored: a light
  novel's "167", "168" there are print page numbers, not chapters.
- **Reading order is the spine's,** not the contents'. One volume's contents
  list its colour illustrations after the epilogue.
- **A child in its parent's file is a section, not an entry.** A technical
  book's 45 points become 17 chapters. A child in a file of its own is an
  entry (a web-novel compilation's chapters under "Volume 1").
- **Two points at one place are one entry,** the first ("Start" and "Cover" in
  one light novel).
- **An untitled point is named from its place:** a web novel's chapter 1427
  has no label and becomes "Chapter 1427".
- **Entries in one file are split by anchor:** a short-story collection's nine
  stories share one document.
- **Matter is decided at the edges:** entries named like matter (Cover, Title
  Page, Contents, Copyright, Insert, Colour Illustrations, Afterword, About the
  Author, Newsletter, …) before the first chapter are front, and after the last
  are back. "Credits" in the middle of a book stays a chapter.

A file that won't open as an EPUB is still listed, as one entry "Book", so the
reader can say what's wrong with it. It counts as unreadable in the scan's
summary.

## tsundoku's own novels

A book with `META-INF/tsundoku-novel.json` is one tsundoku's device wrote for
a novel from an LNReader plugin ([`NOVELS.md`](NOVELS.md), "The book"),
read by `novel-book.ts`. It
isn't a series of its own: the manifest names the series
(`lnreader:<plugin>:<path>`) and every chapter by its path at the source, so
the plan is that series, each chapter in the book available at its document,
and the rest NOT DOWNLOADED (`planNovelBook`, `src/lib/import/novel-plan.ts`).
A manifest that doesn't parse leaves the file an ordinary EPUB. Wherever the
file is (a synced copy on a device too), it folds onto the same series, as
two devices' copies of a manga do.

## Positions and duplicates

A novel's positions are its reading order, 1…n. Chapter numbers repeat in web
novels ("Chapter 2 (1)" and "(2)"), so novels are never collapsed as duplicate
chapters ([`DUPLICATE-CHAPTERS.md`](DUPLICATE-CHAPTERS.md)).

Front and back matter don't count toward a series' chapters or READ, aren't
where CONTINUE starts, and don't keep a finished book in CONTINUE.

## Rescanning

Idempotent. An entry is found again by its locator. A new edition of a file
moves its entries' places, labels and matter, and read state stays on the
entry.

A book grouped as a volume of a novel ([`BOOKS.md`](BOOKS.md), "Volumes of a
novel") has lost the series that carried its origin key. The writer
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

On the real collection of 23 EPUBs, which plan into 5,302 entries:

- all 23 have an NCX; 9 also have `nav.xhtml`;
- none is DRM'd;
- the largest book by chapters has 1,429 of them in 16.6 MB;
- the largest file is 29.3 MB.
