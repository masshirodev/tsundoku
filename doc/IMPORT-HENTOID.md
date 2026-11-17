# The Hentoid importer

Reads a copy of the device's `H/.Hentoid/` folder in place and writes every
book into a **hidden root**: nothing from it shows until `/reveal`. The format
is in [`IMPORT-FORMATS.md`](IMPORT-FORMATS.md). The runner, START SCAN,
`/scan` and `yarn run import` are shared with the Mihon importer
([`IMPORT-MIHON.md`](IMPORT-MIHON.md)): one scan job runs every importer, one
step each ([`IMPORT.md`](IMPORT.md)). The folder is found at `H/.Hentoid/`,
`.Hentoid/` or `Hentoid/` in the library folder, and in another device's
synced copy under `devices/<name>/Hentoid/`.

```
$LIBRARY_ROOT/H/.Hentoid/<site folder>/<book folder>/
    0001.jpg 0002.jpg …   thumb.jpg   contentV2.json
```

## What becomes what

| Hentoid                                                   | tsundoku                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| a book                                                    | a doujin **single book**: one series, one entry labelled `Book`                               |
| a book with 2+ `chapters` (Hentai2Read)                   | a **series of books**, one book per chapter (`Ch. 1`, `Ch. 1.5`, …)                           |
| `rating` (0 = unrated), `favourite`                       | the series' rating (Hentoid's stars ×2, out of 10) and FAV                                    |
| `completed`, `reads`, `lastReadPageIndex`, `lastReadDate` | read state, the page, and one reading-log row                                                 |
| `attributes`                                              | tags: `artist:`, `circle:`, `tag:`, `language:`, `category:`, `character:`, `parody:` (SERIE) |
| `site`                                                    | a `source:` tag (`nhentai`, `hentai2read`)                                                    |
| `imageFiles` (by `order`, cover excluded)                 | the entry's pages, stored in `entry_pages`                                                    |
| the `isCover` image (`thumb.jpg`)                         | `entries.cover_file`, and its `pHash` as `cover_phash`                                        |
| `groups`                                                  | shelves by name (unseen in the samples, so read loosely)                                      |
| `downloadDate`                                            | added-at                                                                                      |
| `url` + `site`                                            | `origin_key = hentoid:<site>:<url>`                                                           |

The numbered site folders (`nhentai`, `nhentai2`, …) are Hentoid's own
overflow split, so the folder name is never read. A folder **without
contentV2.json** is still a book: its pages in natural order, its title from
the folder name (`artist - Title - [id]` becomes `Title`), and no progress.

### Where the files are

Every Hentoid series has the **root** as its path, and each entry names its own
book folder (`nhentai2/ - Title - [1002]`), with its pages relative to that.
This is what lets books be grouped, taken out and moved between series (see
[`BOOKS.md`](BOOKS.md)) without a path ever pointing at the wrong folder.
Grouping and take-out copy the series path over for the same reason.

### Multi-chapter books

Hentai2Read books list their chapters, and tag each page with a
`chapterOrder`. Each chapter becomes a book, with the pages carrying its order.
Pages no chapter claims go with the first, so none is lost. Hentoid keeps one
page index for the whole book, so it's spread over the chapters: chapters
wholly before it are read, the one it falls in holds the page, and later ones
are untouched. The rating and FAV go on the series. The tags go on the series
**and on every book**, because person pages find books in a series of books
by their own tags.

## Rescanning

The same writer as Mihon, so the same rules apply: new books are added, and
read state only moves forward. What is edited here (title, rating, FAV,
hidden, shelves, tags) is never overwritten. Two things are Hentoid's own:

- **A grouped book is found where it now lives.** Grouping deletes a book's
  own singleton series, and with it the origin key. So before creating a
  series, the writer looks for the book's entries anywhere in the root by their
  source URL, and updates them in place. Without that, every rescan would
  bring back every grouped book as a duplicate.
- **A deleted book folder** leaves its entry, marked not downloaded.
- **A folder with no pages isn't a book.** A download that failed
  leaves its `contentV2.json` (status `ERROR`) and the thumbnail. Hentoid's
  " (1)" copy of a folder can hold only the thumbnail. `thumb.*` is Hentoid's
  cover and never a page, JSON or not, so neither makes a series. What an
  earlier import made of such a folder is removed after the import, while
  untouched: an entry never opened, unrated and not a favourite, and a series
  left with no entries, unrated, not a favourite, on no shelf, not linked (a
  series link, or a season's link or decision) and in no Work
  (`prunePageless`). That's no delete and buries nothing, so a download
  finished later imports as it would have. On a real library that was 8 empty
  series and 6 one-page "books" of a thumbnail, from 37
  failed downloads and 53 " (1)" folders.

## Hidden means hidden

The root is hidden, so every book in it is too, unless reveal is on. The
IMPORTING band's "N SERIES SO FAR" never counts a hidden arrival, from a hidden
root or a `+` Mihon category, because the band shows while reveal is off.

## Measured

The eight sample books import in a fraction of a second (the full run with
Mihon's 384 series takes about 4s). The multi-chapter sample (46 pages over
four chapters) splits 17 + 18 + 6 + 5.

## Code

| Part                                | File                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| contentV2.json and every rule, pure | `src/lib/import/hentoid-plan.ts`                                                                        |
| the plan types every importer uses  | `src/lib/import/plan.ts`                                                                                |
| walking the folder                  | `src/lib/server/import/hentoid.ts`                                                                      |
| the one writer                      | `src/lib/server/import/write.ts`                                                                        |
| the job, every source               | `src/lib/server/import/index.ts`                                                                        |
| tests                               | `tests/hentoid-plan.spec.ts`, `tests/import-db.spec.ts`, fixtures in `tests/helpers/hentoid-fixture.ts` |

## Duplicates

The same book from two sites (nhentai and Hentai2Read, say) imports as two
books. `cover_phash` is what finds them: duplicate-book detection compares the
covers and offers each pair to settle by hand
([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)).

## Limits

- **Hentoid's archive books** (`.zip` or `.cbz` in an external library) aren't
  read. Only folders of images are, which is all the samples hold.
- **`groups`** has never been seen filled in, so it is read loosely. A library
  that uses them should be checked against a real contentV2.json.
