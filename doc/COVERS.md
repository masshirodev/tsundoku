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

## What it doesn't do yet

- **Books inside a series of books** show the series' cover, not their own.
  Each book's own thumbnail (Hentoid has one per book) needs a per-entry cover.
- **Set any page as the cover** is card c26.
- **Page thumbnails** in a doujin's page grid are still placeholders.
