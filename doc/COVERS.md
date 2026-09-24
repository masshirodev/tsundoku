# Covers

Every series gets one cover thumbnail: 400px wide WebP, made once and kept on
the library disk (`COVER_DIR`, default `/mnt/hdd2/tsundoku/covers`,
`<series id>.webp`). The tiles, CONTINUE, the long-press sheet, the series
panel, search, history and person pages all show it. A series with none keeps
the striped placeholder, which also stays under every image, so a cover that
fails to load leaves the stripes.

## Where a cover comes from

`src/lib/server/covers.ts` takes the first source that has one:

1. **A cover the files carry:** Hentoid's thumbnail, Mihon local's
   `cover.jpg`, an EPUB's cover image. Real covers.
2. **The source site's cover URL,** which Mihon's backup has for every series
   (`series.cover_url`, rung 14). It's fetched with a browser's user agent and
   the site's own origin as the referrer, three at a time, and only by the
   cover pass, never while a screen waits. The owner approved fetching them on
   2026-09-23.
3. **The first page of the first downloaded entry,** cut from the top to the
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

- **Set any page as the cover** is card c26.
