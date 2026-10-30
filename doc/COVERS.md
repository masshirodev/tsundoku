# Covers

Every series gets one cover thumbnail: 400px wide WebP, made once and kept on
the library disk (`COVER_DIR`, default `TSUNDOKU_HOME/covers`, on the workstation
`/mnt/hdd2/tsundoku/covers`,
`<series id>.webp`). The tiles, CONTINUE, the long-press sheet, the series
panel, search, history and person pages all show it. A series with none keeps
the striped placeholder, which also stays under every image, so a cover that
fails to load leaves the stripes.

## Where a cover comes from

`src/lib/server/covers.ts` takes the first source that has one:

0. **A page the owner chose** (see "Chosen", below), cut from its top as any
   page is: `chosen:<entry>:<page>`.
1. **A series of books wears its first book's cover** (card c57): the page
   chosen for that book, else Hentoid's thumbnail, else its first page, which
   is what the book's own tile shows in BOOKS: `book:<entry>:…`. It follows
   the order: reordering, taking a book out, moving one or grouping remake
   the cover (off the request), and a book taken out, a new series, gets its
   own at once. That includes the duplicates review's GROUP, FOLD and KEEP
   ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md), "Deciding"; card c63).
2. **A cover the files carry:** Hentoid's thumbnail, Mihon local's
   `cover.jpg`, an EPUB's cover image. Real covers.
3. **The source site's cover URL,** which Mihon's backup has for every series
   (`series.cover_url`, rung 14). It's fetched with a browser's user agent and
   the site's own origin as the referrer, three at a time, and only by the
   cover pass, never while a screen waits. The owner approved fetching them on
   2026-09-23. An address is fetched only when it's on the internet, every
   redirect included (`src/lib/server/net-guard.ts`): a novel's comes from its
   LNReader plugin ([`NOVELS.md`](NOVELS.md)), and none may aim the server at
   the workstation's own network. The engine's own covers, which are local by
   design, are the one exception.
4. **The linked AniList entry's cover** ([`LINKS.md`](LINKS.md)): a series
   linked to its catalogue entry (from Mihon's MAL tracker, an exact title,
   or the review) wears the entry's cover. It comes after the site's, and a
   site that refused stands aside for it. `link:anilist:<id>`, fetched only
   in a remote pass, as the site's is.
5. **The first page of the first downloaded entry,** cut from the top to the
   tile's 2:2.9 shape. This is last because a Mihon chapter's first page is so
   often a scanlator's credits or recruitment banner, and a webtoon page is a
   tall strip that would shrink to a sliver.

`series.cover_key` names what the thumbnail was made from (`file:`, `epub:`,
`url:`, `page:`). A changed source makes a new thumbnail, and an unchanged one
costs nothing. `cover_at` is when it was made, and the version in its URL
(`/api/series/<id>/cover?v=<cover_at>`, `private`, `immutable`). Hidden means
hidden: a hidden series' cover is a 404 while reveal is off.

A fetch that fails (a 403, a timeout, a site that's gone) is remembered in
`cover_failed_at` and not tried again for a week. The first page stands in
meanwhile, if there is one.

## When covers are made

- **After every START SCAN,** in the background: the library is usable at
  once, and covers appear as they're made.
- **`yarn run covers`** by hand, or `yarn run covers --local` to use files only
  and send nothing to any site. `yarn run import` leaves covers to this, and
  says so.
- **Never in the specs.** `runImport` only makes covers when asked
  (`{ covers: true }`), so tests don't write to the library disk or reach the
  internet.

On the real library (2026-09-23), the files alone gave 6,511 covers in about
4 minutes, 229 MB in all (about 35 KB each).

## sharp and the system libvips

Thumbnails are made with `sharp`. The workstation has Arch's libvips, and when
`sharp` finds a system libvips it builds against it rather than using its own
prebuilt binary. That's why `node-addon-api` and `node-gyp` are dev
dependencies: `yarn install` compiles it in about 20 seconds. After a pacman
update to libvips, run `yarn install --force` if thumbnails stop working.
libvips' warning about the optional openslide module is silenced
(`VIPS_WARNING=0`).

## Books

A book inside a series of books has a cover of its own
(`readBookCover`, `GET /api/entries/<id>/cover?v=<version>`). It's made from
the first of these that works:

1. the page the owner chose as its cover (`entries.cover_page`);
2. the cover file its folder carries (Hentoid's thumbnail, `cover_file`);
3. its first page, cropped from the top like a series' page cover.

It's made the first time a tile asks, not at a scan, and kept in
`$COVER_DIR/books/<entry>-<hash>.webp`. The hash is of what it was made from, so
another cover page, file or folder makes a new one, and the old one is deleted.
The URL's `v` is `first`, or `p<n>` once a page is chosen, so a choice changes
the URL and the old copy isn't served from the browser's cache. A book not on
disk has none. A hidden series' books are a 404 while reveal is off.

It's drawn on the series screen's BOOKS grid and on person pages. The
suggestion band (MIGHT BE ONE SERIES), the group sheet's rows and a person
page's strip of series use the series' own cover.

## Page thumbnails

A book's page grid (a single doujin's screen, or `?book=` in a series of
books) shows each page as a thumbnail (`readPageThumb`,
`GET /api/entries/<id>/pages/<n>/thumb`):

- 320px wide, WebP, the page's own shape, shown cut from the top to the cell;
- made the first time it's asked for and kept as
  `$COVER_DIR/pages/<entry>/<page>-<version>.webp`, the version being the
  chapter's manifest version, so a changed file makes new ones;
- asked for lazily: only the cells near the screen ask, over the striped
  placeholder while they load. The URL's `v` follows the book's size and page
  count, so it's kept as immutable and changes with the file;
- a hidden book's pages are a 404 while reveal is off, as the pages are.

A page is about 1MB, so the full pages would have been 30MB for a 30-page
grid; the thumbnails are a few KB each.

## What it doesn't do yet

- **Uploading an image, or cropping.** A cover the files lack comes from a
  catalogue link now ([`LINKS.md`](LINKS.md)).

## Chosen

A long press on a page picks it as a cover (Page Menu, card c26; the
handoff's `Page Menu.dc.html`). The first page is often wrong: an
advertisement, a scanlator's credits, a table of contents.

**Where:** in the image reader, a long press (450ms without moving, a
finger, or the left button held on desktop) on the page itself: the page
under the finger, in the strip too, and the pressed half of a spread. The
release that follows turns nothing, and the right button still turns back.
On the series screen, a long press on a cell of the PAGES grid, which also
marks the chosen page with a COVER corner.

**The menu** (`PageMenu.svelte`): the pressed page keeps its light, ringed in
the accent with its number in the corner, the rest under a scrim that takes
every tap; ✕, the scrim or Esc close it. A preview shows the page as a tile
would crop it (in the reader). One row per thing the page can become, each
saying where that cover comes from now (`menuRows`,
`src/lib/library/cover-menu.ts`):

| Reading                   | Rows                                                            |
| ------------------------- | --------------------------------------------------------------- |
| A single doujin           | **COVER**: the book and its series are one tile.                |
| A book in a series        | **BOOK** (its tile in BOOKS) and **SERIES** (the series' tile). |
| A manga or manhwa chapter | **SERIES**: a chapter has no tile.                              |

A row whose cover is already this page says **✓ THIS PAGE**, names what
automatic would give, and offers **BACK TO AUTOMATIC**. Offline the menu
still opens, its rows dimmed, with **○ OFFLINE · COVERS NEED THE
WORKSTATION**: nothing is queued.

**What it stores:** `POST /api/covers` sets a book's `entries.cover_page` and
a series' `cover_entry` and `cover_page` (rung 23), answers with what was
there, and remakes the series' thumbnail before answering. A single sets
both. **UNDO** is the same call with the answer: the reader's band (**BOOK
COVER · P. 14 / SUMMER AFTERNOON · WAS P. 1, AUTOMATIC**) stays 6 seconds,
until the next turn or scroll, or until the controls open. A save that
fails goes to the app's own RETRY / PUT BACK band.

### Where it departs from the handoff

- **The grid's band is the screen's Band**, under the PAGES head, not pinned
  to the foot as the reader's is: the series screen scrolls, and its bands
  sit at the top of what they're about.
- **A chosen series cover names its chapter** when it's another one's page
  ("NOW CH. 3 · P. 14 · CHOSEN"); the mock only drew a chosen page of the
  same book.
- **The meta line of a manga** carries the chapter and its place ("MANHWA ·
  CH. 88 · 88 OF 120"); the mock's "CH. 88 OF 120" assumes the chapter's
  number is its place.

### Not yet

- **No page menu in the text reader**: a novel's cover is its EPUB's.

## On older browsers

`Cover` sets its width outright (`width: 100%`) instead of leaving it to the
flex column it sits in, and falls back to a padding of the ratio's height where
`aspect-ratio` isn't supported. On 2026-10-15 the Xiaomi Pad 5's browser gave
a cover stretched by its parent no height from the ratio: every tile in the
library lost its cover and its badges sat on the title, while desktop
Chromium, and the Pixel and tablet emulations, drew them all. A cover that
shows on the desktop and is missing on one device is a layout question before
it's an image one: look at the tile's height first.
