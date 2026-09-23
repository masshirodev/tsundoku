# The image reader

Where manga, manhwa and doujinshi are read: `/read/<entry>`, with `?p=<page>`
(1-based, or `last`). Built from `Index Reader.dc.html` and `Reader States.dc.html`
(the "Index" system, see [`design/README.md`](design/README.md)), plus the
addendum's incognito states. Brief: [`briefs/done/READER.md`](briefs/done/READER.md).

**The page is the interface.** Nothing is on screen but the art until a tap in
the middle asks for the controls, and the next tap puts them away.

## Getting there

Every ▶ in the app opens it:

- CONTINUE on the series screen, or the ▶ in its top bar once CONTINUE has
  scrolled away;
- a chapter row;
- a page in a doujin's or book's page grid (at that page);
- the ▶ on a book's sheet, a library CONTINUE row, and the long-press sheet.

With no `?p`, it resumes where the entry was left, or starts it. A read entry
starts again from page 1. `resumeEntry()` (`src/lib/server/library.ts`) picks
the entry the library's ▶ opens, by the same rule as the series screen's
CONTINUE.

← goes back to the series. The root layout draws nothing else around the
reader: no sidebar, no banners, no incognito band. The reveal frame stays,
because hidden pages must never pass for ordinary ones.

## Touch

- **Two 16% edge strips turn the page; the middle shows or hides the controls**
  (Reader States 1f). Thirds would give two-thirds of the page to turning,
  which is where most speech bubbles are. Phase 2 adds a single rule on top: a
  tap on an OCR'd bubble opens the lookup. The zones stay as they are.
- **R→L reads forward to the left:** the left strip turns forward, and a swipe
  to the right pulls the next page in. L→R mirrors both.
- **A swipe turns anywhere:** at least 40px, and mostly sideways.
- **Vertical scroll never turns on a tap.** Every tap is the controls, and
  scrolling is how you move.
- **With the controls up, a tap on the page only puts them away.**
- **No hardware keys, by the owner's choice.** On desktop the arrows are
  spatial (in R→L, ← is forward), Space and PageDown go forward, and Esc
  toggles the controls.

`tapAction`, `swipeAction` and the rest of the reader's rules are in
`src/lib/reader/reader.ts`. `tests/reader-domain.spec.ts` covers them.

## Modes

| Mode        | Default for   | What it does                                                                                           |
| ----------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| R→L (paged) | manga, doujin | One page (or spread) per screen. The chapter boundary is a page of its own.                            |
| L→R (paged) | —             | The mirror.                                                                                            |
| Vertical    | manhwa        | Pages stitched full-width with no gap, each sized from the manifest before it loads, so nothing jumps. |

The mode starts from the series' direction (or its kind's default). The
READING sheet changes it **for the session**, and REMEMBER makes it the
series' own, using the series screen's `direction` action. FIT (width, height
or screen), SPREADS and DIM belong to the **device**, kept in this browser's
`localStorage` under `tsundoku.reader.*`: they're about the screen, not the
book.

### Spreads

Spreads are landscape only and off by default. The first page, a cover,
stands alone, then pages pair up. A wide page (wider than it is tall) is
already a spread, so it stands alone and restarts the pairing. SHIFT PAIRING
moves the pairing by one for a chapter whose spreads split wrong. In R→L the
first page of a pair sits on the right, and the two meet at the gutter.

## Boundaries

- **Paged:** after the last page comes a page of its own. It names the chapter
  that ended and the one that starts, with "← TAP OR SWIPE TO CONTINUE" (the
  arrow follows the direction), and going forward opens the next chapter.
  Going back from a chapter's first page opens the previous chapter at its
  last page.
- **Vertical:** the strip carries on. A 320px band, ruled above and below,
  names the two chapters, and the next chapter's pages follow. Once its first
  page crosses the middle of the screen, the reader moves to it
  (`replaceState`), keeping that page where it was on screen, so nothing jumps.
- **The end of what's available:** "END · LAST AVAILABLE", the series' title,
  and, only while the series is unrated, RATING and FAV. The rating prompt
  never interrupts twice.
- **The next chapter isn't downloaded** (imported from a backup, read online):
  the boundary says so, "○ NOT DOWNLOADED", and doesn't pretend it opens.
- **Offline:** "○ OFFLINE · CACHED STILL OPENS" and "○ NOT CACHED" on the next
  chapter.

## Loading, failure, missing

A page shows "P. 15" and a sliding bar in its own box, sized from the
manifest, until it loads. If it fails: "P. 15 DID NOT LOAD / WORKSTATION DID
NOT ANSWER" and RETRY, which asks again with a new URL. An entry with no file
at all is one screen: "CH. 29 IS NOT DOWNLOADED", and ← SERIES.

## Pages

`src/lib/server/pages/` decides where an entry's pages come from:

- `entry_pages` rows (a Hentoid folder, in its stored order);
- a CBZ's images, naturally sorted as Mihon does;
- a plain folder;
- a `sample:` series from the seed, whose pages are generated PNGs with the
  page number drawn on (every seventh one wide), so the reader is developed and
  tested against something that turns.

`GET /api/entries/<id>/pages` is the **manifest**: every page's width and
height, read from the first 64 KiB of each image (JPEG, PNG, WebP, GIF), and a
version that changes when the files do.
`GET /api/entries/<id>/pages/<n>?v=<version>` is one page, `private` and
`immutable`, so a turn back is instant. Hidden means hidden: a hidden entry is
a 404 while reveal is off.

The next screen's pages are preloaded, so turning is instant. There is no
page-turn animation.

## Progress

Everything goes through `POST /api/reading` ([`READING-LOG.md`](READING-LOG.md)):

- `open` when an entry opens;
- `page` once the reader has settled on a page (800ms), which also keeps
  `?p=` in the URL, so a reload resumes;
- `finish` on reaching the last page or crossing out of the chapter;
- `close` on leaving (a beacon).

Durations are the gap since the last event, capped at two minutes, and time in
the background isn't reading (`ProgressClock`).

**Incognito** is decided by the server: while it's on, `/api/reading` answers
`{saved: false}` and writes nothing ([`PRIVACY.md`](PRIVACY.md)). The reader
shows it the addendum's way:

- a 2px dashed rule along the top edge;
- a dashed INCOGNITO cell in the controls;
- NOT SAVED on the meta line;
- the dashed note on the boundary page.

Rating and FAV still save, through the series screen's actions (a book in a
series of books rates itself).

**The screen stays awake** while the reader is open (`navigator.wakeLock`),
re-acquired when the app comes back to the foreground. A browser that refuses
(no secure context, battery saver) just lets it sleep.

## Departures from the handoff

- **The reader is always dark,** whatever the library's theme. Its ground is
  true black so letterboxing vanishes on OLED, and light chrome over black
  pages would glare. The reader root pins the dark tokens.
- **Six rating cells, 0–5,** as everywhere else (design README, departure 6).
  The handoff drew seven, with "—".
- **No "↓ CACHED" on the next chapter:** nothing is cached on the device yet
  (service workers need HTTPS, card "Serve over HTTPS with tailscale cert, then
  the fingerprint gate for /reveal"). The boundary says "24 PAGES", not a claim
  it can't make. The offline sentence drops "Chapters 1–41 are cached" for the
  same reason.
- **Not downloaded** is a boundary and a screen the handoff didn't draw. It
  came in with the Mihon import.
- **FIT is dimmed in vertical,** with "VERTICAL FITS WIDTH", and SPREADS with
  "LANDSCAPE ONLY" or "PAGED ONLY", following the addendum's rule for rows that
  don't apply.
- **Vertical controls** use the L→R arrangement: the scrubber fills from the
  left, and the previous chapter is on the left.
- **The next chapter is named in full** ("Chapter 42") on the boundary pages,
  as drawn, from the entry's own title when it has one.

## Not yet

- **The lookup panel** is phase 2 (card "Japanese layer").
- **SET AS COVER** (card "Set any page as the cover"), and the addendum's
  CROP BORDERS, SIDE PADDING and WIDE PAGES rows (their own cards).
- **Offline caching** of the next chapters waits on HTTPS.
- **Page thumbnails** in the page grid are still placeholders.
- **Novels** use a text reader of their own (card "Text reader").
