# Import formats

The shapes of the files each importer reads, measured from real data copied
off an Android phone (Mihon, Hentoid, Moon+ Reader). A tablet library of about
166 GB in the same apps uses the same layouts. What each importer makes of
them is in [`IMPORT.md`](IMPORT.md) and the documents it lists.

The samples are copyrighted and partly explicit. **They stay outside the
repository and are never committed.** Test fixtures are synthesised from the
shapes below, with invented titles.

## Mihon

Root: `<shared storage>/Mihon/` — `downloads/` and `autobackup/`.

### Downloads

```
downloads/<Source> (<LANG>)/<Series title>/<Chapter>.cbz
```

- One CBZ per chapter. Seen: `Asura Scans (EN)`, `Weeb Central (EN)`.
- Chapter file names are not a reliable number: `Chapter 98 - The Long Road.cbz`
  on one source, `Unknown_Chapter 32_f662bf.cbz` on another (scanlator, number,
  hash suffix). Parse the number from `ComicInfo.xml`, not the name.
- Characters Android cannot store are replaced: `Title: Subtitle` becomes
  `Title_ Subtitle`. The display title comes from `ComicInfo.xml`.
- Image names inside the archive are not a contiguous sequence
  (`002__001.jpg`, `003__001.jpg`, `002__002.jpg`, …). Order by natural sort of
  the name, which is what Mihon itself does, and verify against a real chapter.
- **`ComicInfo.xml` is present** and carries `Title`, `Series`, `Number`,
  `Summary`, `Genre` (comma-separated), `Web` (chapter URL), plus Mihon
  extensions `ty:PublishingStatusTachiyomi` and `mh:SourceMihon`. Writer and
  Penciller are `_` when unknown — treat `_` as empty.
- `.nomedia` files are noise.

### Backup (`autobackup/*.tachibk`)

Gzip-compressed protobuf (~1.7 MB compressed, ~6.9 MB raw). Holds the library
(series with URL, title, author, artist, description, genres, cover URL),
**every chapter known to the source, with read state and last page**,
categories, and history. It is the only place read progress for downloaded
series lives, and the only record of series followed but not downloaded.

Decode with Mihon's published `Backup` proto schema. Categories are read as a
rating scale with "+" twins for adult series, so they become ratings, shelves
and hiding, not plain tags.
[`IMPORT-MIHON.md`](IMPORT-MIHON.md) has the mapping and every other rule.

## Hentoid

Root: `<shared storage>/H/.Hentoid/` (the user-chosen `H` folder).

```
.Hentoid/<site folder>/<artist> - <title> - [<site id>]/
    01.webp 02.webp …        (or 0001.jpg …)
    contentV2.json
```

- Site folders seen: `nhentai`, `nhentai1`, `nhentai2`, `nhentai3`,
  `Hentai2Read`. The numbered ones are Hentoid's own overflow split, not
  different sites — the site is `contentV2.json`'s `site` field.
- Folder names are truncated and sometimes have an empty artist
  (` - Title - [id]`). Never parse them; read the JSON.
- Loose images, not archives.

`contentV2.json`, per book:

| Field                                                       | Use                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `title`, `site`, `url`                                      | title; `source` tag; provenance                        |
| `attributes.{TAG,ARTIST,CIRCLE,…}`                          | namespaced tags (`artist:`, `circle:`, `language:`, …) |
| `attributes.LANGUAGE`                                       | includes the pseudo-language `translated`; keep as tag |
| **`favourite`**                                             | → favourite                                            |
| **`rating`** (0 = unrated)                                  | → rating, as is: 0 is unrated here too                 |
| `reads`, `lastReadDate`, `lastReadPageIndex`, `completed`   | → progress                                             |
| `imageFiles[]` (`order`, `name`, `isCover`, `chapterOrder`) | page order; `isCover` is the thumb, not a page         |
| `chapters[]`                                                | present on multi-chapter sources (Hentai2Read)         |
| `downloadDate`                                              | added-at                                               |

Other files in `.Hentoid/`: `queue.json`, `bookmarks.json` (search bookmarks,
not books), and logs. None are imported.

## EPUB

Seen under `Books/MoonReader/` and `Documents/Library/` — including
WebToEpub-style web-novel compilations (`<Title> c1-591.epub`). Standard
OPF + NCX, images under `OEBPS/Images`. Moon+ Reader keeps its positions in its
own database, which is not reachable from shared storage; text progress starts
fresh.
