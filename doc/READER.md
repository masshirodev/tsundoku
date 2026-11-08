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
reader: no sidebar, no banners, no incognito band, and no reveal frame. The
frame used to stay, so hidden pages would never pass for ordinary ones; the
owner took it out on 2026-09-24, since it crowds the page. The privacy shield
still blanks the reader when the app goes to the background.

## Touch

- **Two 16% edge strips turn the page; the middle shows or hides the controls**
  (Reader States 1f). Thirds would give two-thirds of the page to turning,
  which is where most speech bubbles are. A Japanese series adds a single rule
  on top: a tap on an OCR'd text block opens the lookup, winning over the
  strips where they overlap. The zones stay as they are
  ([`JAPANESE.md`](JAPANESE.md), "The tap rule").
- **R→L reads forward to the left:** the left strip turns forward, and a swipe
  to the right pulls the next page in. L→R mirrors both.
- **A swipe turns anywhere:** at least 40px, and mostly sideways.
- **Tap zones, shown as a chapter opens** (the owner, 2026-10-30, after
  Mihon). By finger, in a paged mode, the reader opens with its zones drawn
  over the page: the two edge strips at `EDGE`'s width (16%, tapAction's
  own) and the middle, each labelled on a solid chip: `← NEXT` and `→ BACK`
  in R→L, `← BACK` and `→ NEXT` in L→R, `CONTROLS · OR SWIPE TO TURN`. Short
  words with the arrow above, because a phone's strip is 62 px. About 2 s, or
  until the first tap, swipe or key, which still does what it does (the
  overlay takes no taps); the very first time on a device it waits for that
  tap (`tsundoku.hint.turn`). Only when the reader opens, not as it moves on
  to the next chapter. Never under a mouse, whose clicks don't go by zones,
  and never in the vertical strip, where every tap is the controls.
  **TAP ZONES: OFF | ON** in SETTINGS › 01 (`tsundoku.reader.zones`, on)
  turns it off. It replaced a one-time line, ← SWIPE OR TAP THE EDGES TO
  TURN: a friend had tapped the edges and taken the reader for a PC's.
- **Vertical scroll never turns on a tap.** Every tap is the controls, and
  scrolling is how you move.
- **With the controls up, a tap on the page only puts them away.**
- **A long press on a page opens the page menu**: set it as the book's or
  the series' cover ([`COVERS.md`](COVERS.md), "Chosen").
- **Never the browser's image menu.** A finger held on a page doesn't
  offer to save or share it, in any mode ([`TOUCH.md`](TOUCH.md)).
- **No hardware keys, by the owner's choice.** On desktop the arrows are
  spatial (in R→L, ← is forward), Space and PageDown go forward, Esc
  toggles the controls, and + − 0 zoom ("Zoom").

## On a TV and on a remote (c235)

A TV has a D-pad, OK, BACK and often MENU ([`TV.md`](TV.md)). With the
controls hidden the reader keeps every arrow — ← → turn pages (nudge a strip), ↑ ↓ scroll a
strip — so the focus layer is opted out and the remote's keys are the reader's
own:

- **OK** shows the controls (the remote has no tap for the middle);
- **OK held** (450 ms, the pointer's own hold) or **MENU** opens the page menu
  for the page in the middle of the screen — in a spread, the one a turn leaves
  behind, which is what the menu frames in ink there;
- **BACK** closes the page menu, then the controls, then leaves for the series.
  On a remote that is the app's own BACK (`window.tsundokuBack()`), so it
  leaves; a _keyboard's_ Escape is still the toggle it always was, and with
  nothing open it brings the controls up rather than leaving.

The page menu is a 420px panel from the right on a TV, and it is the one
dialog the pad drives while the controls are hidden (its rows are
`use:focusScope` with `force`). The reader's _**end page**_ lifts the opt-out,
so its cells — ← SERIES, the next part's block and its WORK cell on a series
in a Work, the rating, LIBRARY, ANOTHER SOURCE → on a stale series — are
stops.

**With the controls up, the controls are a focus row** (c241; TV-Reader 7D).
OK brings them up with the pad on the page scrubber; ↓ reaches the chapter
cells either side and READING; ← → on the scrubber still scrub, and the
arrows do not turn pages while the controls are up. READING opens as a 420px
panel, on the mode in use: ← → step along a row, ↑ ↓ between rows, OK takes a
value. BACK closes READING and puts the pad back on the cell that opened it,
then hides the controls, then leaves. Off a TV nothing changes: the arrows are
the reader's whatever the controls, as the desktop keys above say.

**Over a vertical strip the controls stay where they are** (c253). An arrow
that finds no cell past the row's end does nothing: the reader stands down and
takes the browser's own scroll away too, which had moved the strip 40px under
the controls. And the strip's own cells (its end page, the stops between
chapters) are arrow stops only while they're on screen
(`src/lib/reader/offscreen.ts`): the focus layer weighs every focusable in the
page, so ↓ from the bottom row found the end page's LIBRARY at the chapter's
foot and scrolled thousands of pixels to it. Read the strip to its end with
the controls hidden, and OK, ↓ reach the end page as before. With the controls hidden ← → nudge
the strip 100 px, as a keyboard's do (c527, "Scrolling on a PC"):
`tests/tv-strip-keys.e2e.ts`.
`tests/tv-reader.e2e.ts` reaches the strip from READING (its mode is session
state) and checks both.

## Turning pages

Paged turns slide, as in Mihon; they don't pop (the owner asked on
2026-09-23).

- **The page follows a sideways drag,** with the screen it would turn to
  beside it: in R→L the next page lies to the left, and is pulled in by
  dragging right. Let go past the swipe threshold (`swipeAction`: 40px, mostly
  sideways) and it slides the rest of the way; short of it, it goes back.
  Where there's no page that way in this chapter (the end page or the chapter
  before), the drag gives a quarter as much and the turn happens as before.
- **Taps, keys and clicks slide too:** the neighbour is drawn beside the page,
  and both slide over in 220ms.
- **Quick taps all count.** A turn asked for mid-slide is taken the moment the
  slide lands, and one asked for while a short drag goes back into place is
  taken when it is back (c553; until then the settle-back dropped it, and the
  key did nothing).
- **A newer move wins** (c515). The scrubber, another chapter opening or
  WIDE PAGES changing, moving the reader mid-slide, stops the slide where it put
  the page, and the turn gives way; until c515 the turn chose its page when
  the slide ended, one past wherever the scrub had left it.
- **A drag waits for the turn under way** (c553). A scrub that cuts a slide
  short leaves the turn's last step to come 220 ms after the key, which puts
  the page back at rest; a drag begun inside that time had its offset zeroed
  under the finger, and the page snapped back and jumped forward again. A
  drag is not followed until the turn is done, as the text reader's isn't.
- **Nothing lands after the reader is left** (c565): a turn landing past an
  end, or one queued, would go on into the next chapter in place of BACK
  ([`NAVIGATION.md`](NAVIGATION.md), "A screen being left writes nothing").
- **One finger turns.** A press follows the pointer that began it; a second
  finger going down (a pinch beginning) ends it as a cancel would, so a drag
  goes back rather than jerking towards the new finger, and on the strip a
  pinch is never a long press (`src/lib/reader/pointer.ts`, shared with the
  text reader; c515).
- **Nothing redraws at the end.** The screens are keyed, so the neighbour's
  element becomes the page's own, with its image already decoded.
- **Split wide pages slide half to half,** since each half is a screen.
- **FIT HEIGHT** lets the browser pan the page sideways, so it doesn't follow
  the finger there; turns still slide. **Reduced motion** turns without any
  slide.

The track is in `ImageReader.svelte` (`turn`, `after`, `screens`); tested in
`tests/reader-flow.e2e.ts`, and c515's and c553's rules in `tests/reader-layout.e2e.ts`
on every device. Its numbers (the 220ms slide and its curve, the 8px
before a drag is followed, the quarter an edge gives, the 40px release) are in
`src/lib/reader/reader.ts`, shared with the text reader, whose paged turns
slide the same way since c441 ([`TEXT-READER.md`](TEXT-READER.md), "Turning").

## Preloading

A turned-to page is already there, not a box saying "P. 15" (the owner
asked on 2026-09-23).

- **Paged:** the next two screens and the one before are fetched and decoded
  as soon as a page shows (`pagesAhead`, `src/lib/reader/reader.ts`), next
  first. Page URLs carry their version, so the browser keeps them as
  immutable; the reader holds the decoded images (a dozen at most) so a turn
  draws at once. That also means the neighbour sliding in beside a swipe is
  usually already drawn.
- **Near a chapter's end** (its last two screens), the next chapter's first
  two pages are fetched too, so going on past the end page doesn't wait
  either. Not while offline.
- **Vertical** needs none of this: every page of the chapters on the strip is
  in the page and loads as it comes.

The device cache (`keepAhead`, doc/OFFLINE.md) is a different thing: it
keeps whole chapters for reading offline.

## Mouse

On a PC, in L→R and R→L, the buttons turn the page, not the side you click on
(`mouseAction`):

- **A click anywhere turns forward**, the middle of the page included;
- **a right click turns back**, and the browser's menu never opens over the
  page;
- **the middle button** shows the controls, as Esc does;
- **vertical scroll** keeps the touch rules: the wheel scrolls, and a click
  shows the controls.

- **the mouse at the top or bottom of the window** (within 56px) shows the
  controls, as a PC reader's bars do; they stay while the pointer is on them
  and go when it moves back onto the page. Controls brought up any other way
  stay until put away (`hoverAction`). The owner asked for this on 2026-09-24:
  with a click turning the page, clicking couldn't reach them. The text reader
  does the same.
- **CURSOR** in READING (c678; the owner, 2026-11-06), **off** by default: it
  hides the cursor after three seconds without the mouse moving; a move or a
  press brings it back at once. **A key and the wheel do not**, so reading on
  by arrows stays clean, and it never hides while the bars, the sheet, the page
  menu, the lookup or the end page is open — the owner is about to click
  something. Only where there is a mouse (`pointer: fine`): a phone, a tablet
  and a TV draw none, so the row is left out there. It is one device setting
  (`tsundoku.reader.cursor`) shared with the text reader and the player, and
  turning it on only toggles a class, so nothing reflows. The player's default
  is on, and it has no timer of its own: its cursor goes with its controls
  ([`ANIME.md`](ANIME.md), "The player").

**The page never tints under a mouse** (c485). The image reader catches taps
on its stage and the text reader on its page, both plain elements, so
motion.css's hover rule never matches them; the player's tap zone is a button
and says `data-press="off"` instead (doc/ANIME.md). `tests/reader-hover.e2e.ts`
hovers the middle and both edges of each reader's page on a desktop, finds
nothing pressable and no tint there, and checks a control of the same reader
still tints.

The pointer's type decides, so a finger on the tablet keeps the strips above.
With the controls up, a click only puts them away, as a tap does. The owner
asked for this on 2026-09-23.

`tapAction`, `mouseAction`, `swipeAction` and the rest of the reader's rules are in
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
or screen), SPREADS, CROP BORDERS, WIDE PAGES, SIDES and DIM belong to the
**device**, kept in this browser's `localStorage` under `tsundoku.reader.*`:
they're about the screen, not the book. Since c171 they're read and written
through `settings/local.ts`, which stamps each change and keeps the
workstation's copy of the device in step ([`SETTINGS.md`](SETTINGS.md),
"Devices"), and a kind's default mode is SETTINGS' MODE row. The sheet ends
with ALL SETTINGS →, the page at its section. A row that doesn't apply to the mode
is dimmed with the reason (PAGED ONLY, VERTICAL ONLY), never removed, so the
sheet doesn't jump when MODE changes. A long sheet scrolls under a head that
stays at its top, so ✕ is always reachable (c679); the sheet's
`scroll-padding-top` keeps a focused row from stopping beneath it.

### Spreads

Spreads are landscape only and off by default -- **on except a TV**, where a
16:9 surface seen from the couch opens two pages (c238; a stored choice still
wins). The first page, a cover, stands alone, then pages pair up. A wide page
(wider than it is tall) is already a spread, so it stands alone and restarts
the pairing. SHIFT PAIRING moves the pairing by one for a chapter whose spreads
split wrong. In R→L the first page of a pair sits on the right, and the two
meet at the gutter. On a TV, and only there, the vertical strip is 520px wide
([`TV.md`](TV.md)).

### Crop borders

CROP BORDERS (paged) shows each page without its plain white or black
margin, so the art uses the screen.

- **Measured on the workstation, once a page** (`cropsFor`,
  `src/lib/server/pages/crops.ts`). The first time a chapter is asked for
  (`GET /api/entries/<id>/crops`), each page is shrunk to 300px wide and
  trimmed of its corner's colour with some tolerance for scans (sharp's
  `trim`, threshold 24). The result goes into `page_crops` (rung 17) as
  fractions of the page, so the tablet never decodes a page to measure it,
  and no page is measured twice. A rescan that gives the chapter another file
  drops its rows.
- **Left alone** (`insetOf`, `src/lib/reader/crop.ts`): a margin under 1% (the
  page would only twitch), and any trim that would keep under 60% of the
  width or height. A lone figure on white is art, not border.
- **Drawn with `object-view-box`**: the file is never changed, and the page's
  box takes the cropped shape from the numbers, so nothing jumps when the
  image arrives.
- Offline, a chapter whose crops weren't fetched shows uncropped.

### Wide pages

WIDE PAGES decides what happens to a page wider than it is tall on a screen
showing one page: paged, and not in spreads (spreads show a wide page whole
anyway, so the row is dimmed there).

- **WHOLE:** as before, the page fit to the screen.
- **SPLIT:** its two halves, one screen each, in reading order. In R→L the
  right half comes first. Forward and back step through the halves before
  leaving the page, and going back into a split page lands on its second
  half. Each half is the one image at twice the box's width, so nothing
  more is downloaded.
- **ROTATE:** turned a quarter clockwise, to fill a portrait screen. Turn the
  tablet to read it.

The rules are `wideTreatment` and `firstHalf` in `src/lib/reader/reader.ts`.

## Zoom

Asked for on 2026-10-29 (card c169): pages bigger than the fit, and a size
that stays.

- **Zooming.** + and − (or =) step through 20, 25, 33, 50, 75, 100, 125,
  150, 175, 200, 250, 300, 400 and 500%, and stop at either end; Ctrl + the
  wheel and a two-finger pinch zoom freely in the same range; **0 is RESET**.
  The READING sheet's ZOOM row has the same: − · 125% · + · RESET, and so has
  SETTINGS' ZOOM and the TV's READING panel, which step through the one list
  (`ZOOM_STEPS`). The range was 50% to 300% until card c719 (2026-11-07: a
  friend made the strip as small as it went and wanted it smaller); every
  value kept under the old range is inside the new one, so nothing migrated.
- **Paged:** the page box is the fit times the zoom (`--zoom`, which
  `PageImage` multiplies its `vw` and `dvh` by), so a zoomed page scrolls both
  ways inside its screen and each page starts at the top (at its right in
  R→L). While zoomed a drag pans the page instead of turning it; the edges
  and the keys still turn.
- **Paged, zoomed out** (c719): the page box shrinks inside its screen,
  centred both ways on the reader's black, in every fit and in a spread (the
  pair is centred). Fit width starts a page at the top, so below 100% it
  takes `align-items: safe center` (`.screen.shrunk`): centred while it is
  shorter than the screen, at the top once it is taller.
- **Vertical:** the strip's width is SIDES' width times the zoom. Past 100%
  it scrolls sideways inside its lane; under it, it narrows as SIDES does,
  centred in the lane (at 20% a phone's strip is 82px of 412). The page under
  the middle stays there (Strip's own width-change anchor), unless the zoom
  has a point of its own (below). A chapter's band is words, not art, so it
  never narrows below `min(100vw, 360px)`: wider than a zoomed-out strip, it
  is centred over it. A tap anywhere in the lane, the black beside the strip
  included, is the strip's (the controls, or a double tap's zoom).
- **The scrubber on the strip** puts the page it names under the middle of the
  screen, which is where the strip reads the page being read: a page as tall
  as the screen at the top as before, a shorter one centred (c719). With its
  top at the top, a page a fifth of the screen tall left the middle on a later
  page, or past the chapter's end in the next chapter.
- **Double tap** (card c185, the owner's rule): a double tap in the middle of
  the page zooms **to 100% from under it, to 200% from 100%, and back to 100%
  from over it**. Two taps make one within 250 ms and 32 px (`DoubleTap`).
  So a single tap in the middle now waits 250 ms before it shows or hides the
  controls, which then fade in ([`design/README.md`](design/README.md),
  departure 18). A tap elsewhere in that time lets the waiting one happen
  first, so a tap at an edge right after one in the middle doesn't turn the
  page under controls about to appear. By finger only in paged mode: there a
  mouse click turns the page, as it always has.
- **Zooms keep their point.** A double tap's point, a pinch's middle and the
  pointer under Ctrl + wheel stay where they are on the page; until c185 every
  zoom grew the page from its top left, so what was under the fingers slid
  away. Paged: the page's box is measured either side of the zoom and the
  screen scrolled back (`fractionOn`, `keepUnder`). A pinch holds the spot
  where the fingers began, not where they are each step: a page still
  narrower than the screen is centred and can't scroll, so measuring afresh
  drifted. The strip does it in its own place-keeping (`Strip`'s `anchorAt`),
  which otherwise keeps the middle of the screen when its width changes.
- **KEEP FOR ALL PAGED / ALL VERTICAL** makes the zoom where every series in
  that mode starts. It's kept **per mode and per screen class on this
  device** (`tsundoku.reader.zoom.<paged|vertical>.<phone|wide>`, phone below
  600px), so manga and manhwa keep different values, and a phone, a tablet
  and a desktop never overwrite each other's; a desktop window narrowed to
  phone width uses the phone's. RESET goes to the kept zoom first, then to
  100%.

The rules are in `src/lib/reader/zoom.ts` (`tests/reader-zoom.spec.ts`, which
walks the whole step list both ways and the clamp at both ends);
`tests/reader-zoom-range.e2e.ts` walks the ZOOM row to 20% and to 500% in
paged and in the strip, keeps 20% across a reload, and measures the geometry
below 50% on every device (paged, fit width, a spread, the strip's band, the
scrubber, a finger's taps); the
zoom tests in `tests/reader-flow.e2e.ts` check the page grows and scrolls,
KEEP across a reload, RESET's two steps, the strip, and (c185) the double
tap's three cases with its point held and no controls on the way, the single
tap's controls arriving late and faded, the strip's double tap, and a pinch
holding its point. That last one dispatches its touches to the page itself:
devtools' synthetic touches went through Chrome's own gesture handling on a
scrollable screen, which took some of them at random.

## Boundaries

- **Paged:** after the last page comes a page of its own. It names the chapter
  that ended and the one that starts, with "← TAP OR SWIPE TO CONTINUE" (the
  arrow follows the direction), and going forward opens the next chapter at
  page 1. Going back from a chapter's first page opens the previous chapter at
  its last page. The top bar's chapter (or book) buttons open it at page 1 too.
  Moving from one entry to another inside the reader never resumes where that
  one was left: resuming is for opening an entry from outside it (the owner
  asked on 2026-10-15, after a book in a series of books opened mid-way).
- **Vertical:** the strip carries on, both ways, as in Mihon's webtoon
  reader. See "Vertical", below.
- **The end of what's available:** "END · LAST AVAILABLE", the series' title,
  RATING with FAV, and a row under them that hides the series (HIDE) or adds a
  browsing record to the library (+ ADD) — the same doors the series screen's
  HIDE and BROWSE's ADD use, and the page stays while they answer (c655). HIDE
  is the privacy door, not a removal: the series leaves every shelf but stays
  in the library (`in_library` stays 1) and `/reveal` brings it back
  ([`LIBRARY.md`](LIBRARY.md), "Hidden means hidden"). A hidden series is read
  only under `/reveal`, so its end page offers **UNHIDE** instead of hiding it
  again (c673, `?/hide on=0`, `UNHIDDEN ✓` once it answered). A press the
  action refuses says why in the row — the action's own message, or COULD NOT
  SAVE — rather than resetting silently. A series in a Work draws
  neither cell — its Work is hidden or taken out whole from the series screen.
  The block stays once the rating is set, showing what was chosen, so rating on
  this page never empties it; the note, `SHOWN WHILE UNRATED`, goes with the
  first rating. An ongoing series whose source has added nothing for eight
  weeks adds one line — `ASURA SCANS HAS ADDED NOTHING SINCE 6 SEP` — and a
  cell ANOTHER SOURCE → that opens MOVE ([`MOVE.md`](MOVE.md)). No band: a
  quiet source isn't a broken one.
- **The end of a series in a Work** offers the next part
  ([`WORKS.md`](WORKS.md), W6): a NEXT IN THE WORK block with the next part's
  cover, title, its own kind's line, `▶ START · CH. 1` and WORK →, between the
  title and the rating. **It is a tap, never a swipe**: a chapter boundary
  swipes on because the next chapter is the same thing, while the next series
  may read the other way and this is the one moment the rating is asked. A
  swipe or a key at the end page stays where it is; only the block's own cells
  cross. Caught up on an ongoing part keeps END · LAST AVAILABLE and offers a
  MEANWHILE row instead; a next part with no file reads online from its source
  (or says `○ OFFLINE · NOT CACHED` with START dimmed); and a run that is read
  says `THE WORK IS READ · n OF m` with WORK → in place of START at its last
  part. The kicker names the series when the Work carries on, and the foot
  gains `<WORK> · WORK`. A novel reaches the same page in either layout: in
  SCROLL its last volume's own end is the end page, so the block and the rating
  are there too. **On a TV the text reader's end page takes the pad**, as the
  image reader's does: the block, its WORK → and the rating are stops.
  **On a phone** (under 600px; c535) the block's row of cells is one line
  each, and beside the 64px cover the column is about 270px, while START,
  DOWNLOAD FIRST 10 EPISODES (or NOT QUEUED · TRY THE SERIES, or ALREADY
  QUEUED) and WORK → are
  over twice that. So on a phone the row leaves the column (`.col` is
  `display: contents`) and spans the block under the cover, as Work-Phone
  draws the phone's START under it, and wraps: START on a line of its own,
  its note beside it or under it, and the other cells sharing the next line,
  each a 64px stop. The MEANWHILE row's cell wraps to two lines there rather
  than squeezing the row's words, and its MEANWHILE label is 84px, whole
  (72px cut it). `tests/work-end-frame.e2e.ts`, "on a phone", measures every
  cell inside the block at the phone project's Pixel 7 (412 wide), refused
  cells included.
- **The next chapter isn't downloaded** (imported from a backup, read online):
  the boundary says so, "○ NOT DOWNLOADED", and doesn't pretend it opens.
- **Offline:** "○ OFFLINE · CACHED STILL OPENS" and "○ NOT CACHED" on the next
  chapter.

## Vertical

The strip holds a **window of chapters**: the one being read, the one
before it and the one after (`stripWindow`, `src/lib/reader/reader.ts`).
Between each two is a 320px band, ruled above and below, naming the chapter
that ended and the one that starts, with ↕ KEEP SCROLLING (↓ LOADING while
its pages are on their way).

**Pages are asked for as they near the screen** (`loading="lazy"` on the
strip's images; every page's box is sized from the manifest already, so the
browser knows where each is). The strip used to ask for all three chapters'
pages at once, well over a hundred images: on a slow or relayed link (Firefox
on another PC, 2026-09-24) they starved the ones being read, which sat on
their loading box while pages far below downloaded, and the service worker's
fetches timed out. Measured on a link throttled to 4 Mbit/s and 300ms: before,
one page shown after 40 seconds; after, each page shown within half a second
of scrolling to it.

- **Across a band, either way.** Once a page of another chapter crosses the
  middle of the screen, the reader moves to that chapter: the URL, the
  controls, the progress events and the rating follow (a navigation with
  `replaceState` and `noScroll`). The strip stays as it is, so nothing on
  screen moves. Going on past a band marks the chapter left as read. Going
  back up past one goes back into the chapter before, still loaded, as Mihon
  does. The old strip unloaded the chapter behind and locked the reader into
  the next one.
- **The window moves with the reader.** Arriving in a chapter loads its
  neighbours (their manifests, then pages as they scroll in) and lets go of
  anything further away.
- **Nothing jumps.** A chapter arriving or leaving above the page being read
  would shove it. `keepPlace` notes the page under the middle of the screen
  first and puts it back after. It does this by hand: the browser's scroll
  anchoring is off on the strip (`overflow-anchor: none`), since it does
  nothing at the very top of a page and would otherwise do it twice.
  **The page under the middle is the strip's, whatever covers it** (c568):
  READING's sheet, the controls, the lookup or a banner over the middle are
  looked through (`stripSlotAt` in `src/lib/reader/strip-slot.ts`, every
  element under the point, the first page slot or band inside the strip).
  Wave 24 traced the strip losing a whole chapter that way: VERTICAL picked
  in READING opens the strip at the reader's page, the chapter above arrived
  while the sheet still covered the middle, the top element there was the
  sheet, and nothing was kept, so the strip showed the chapter above under a
  URL naming the one below. The rotation's and a reshaped page's look-ups use
  the same rule; nothing under the point (a gap) keeps nothing, as before.
- **Nor on turning the device.** Portrait to landscape, or back, changes the
  strip's width, and every page's height scales with it while the scroll
  offset doesn't: in a manhwa that landed several pages away (2026-09-25).
  The strip notes on every scroll which page is under the middle of the
  screen and how far down it, and when its width changes (a `ResizeObserver`,
  so SIDES and a resized window too) it puts that point back under the
  middle. It notes the place ahead of time because by the time a rotation is
  seen the layout has already moved; and pages crossing the middle while it
  settles aren't read, or the reader would follow the jump into another page
  or chapter.
- **Nor when a page arrives another size.** A page read online has no size
  until its image arrives ([`BROWSING.md`](BROWSING.md), "Manga online"), so
  its box is a guess that can grow or shrink above the page being read. When
  one arrives, the strip notes the page under the middle, lets the box (and
  any still guessing) take the new shape, and puts that page back, as
  `keepPlace` does for a chapter. Not the `ResizeObserver` above: it can't
  tell a page's new shape from a chapter arriving, which `keepPlace` has
  already put right, and the two corrections fought (2026-10-29). The rule
  for the guess is `shapeOf` in `src/lib/reader/reader.ts`;
  `tests/browse-online.e2e.ts` ("tall pages") reads a 600 × 3000 page, paged
  and on the strip.
- **Opening** puts the page the reader resumes at at the top of the screen.
  That happens after SvelteKit's own scroll on arrival (`afterNavigate`),
  which used to put it back at the top of the document. So the strip used to
  open a chapter on its first page, whatever its progress said. **Only for
  the entry that navigation arrived at** (c568): a mode switch opens the strip
  with no navigation, so its place was left set, and the next crossing's
  arrival replayed it, scrolling the strip back a whole chapter (13,124 px in
  wave 23's gate).
- **CH. ← / →** in the controls go to a neighbour already on the strip by
  scrolling to it, and to anything else by starting the strip over there.
- **The scrubber** moves within the chapter being read.
- **SIDES** (0, 10, 20 or 30% a side) brings the strip in from both edges, for
  a strip that fit to a landscape tablet's width would be enormous. A tap on
  the margins still shows the controls.

Tested in `tests/reader-flow.e2e.ts`: across the band and back, that the page
being read stays put through a rotation both ways, and that
nothing moves when chapters arrive above or when the reader crosses a band;
and in `tests/reader-strip-keys.e2e.ts` ("a chapter arriving above while
READING is open keeps the page being read", c568), which holds the chapter
above until the sheet is open.

## Two choices for the strip (a friend's, 2026-10-30)

Device settings in SETTINGS › 01 — READING · IMAGES, vertical only:

- **CHAPTERS: RUN ON | STOP AT THE END** (c206). Run on is the strip as it has
  always been, the next and previous chapters loaded beyond a band. Stopped,
  the strip holds the chapter being read alone: after its last page a band
  ends it with NEXT CHAPTER →, and at its top ← PREVIOUS CHAPTER, each a
  button that opens that chapter. For a reader who wants to decide when a
  chapter ends.
- **TO THE TOP: OFF | ON** (c207, off unless asked for). On, once past the
  chapter's first page a square ↑ sits bottom right and glides back to the
  chapter's first page. Above the 56 px edge where a pointer brings the
  controls up, so reaching it with the mouse doesn't summon them over it (it
  did, and vanished from under the pointer); away while the controls are up.

## Scrolling on a PC

The vertical strip on a computer (card c192; the owner, 2026-10-30, in
Firefox: "can we make it smooth, like Mihon, without losing responsiveness",
and "when I click down or up it pans to the next sections").

- **A mouse wheel's notch eases** the strip instead of jumping it
  (`src/lib/reader/smooth-scroll.ts`). An exponential approach, not a timed
  tween: each frame covers the same share of what's left, so the first frame
  already moves most of the way (the response is immediate) and the rest
  settles in ~120 ms; a second notch extends the target instead of queueing,
  so it never trails the hand. Measured headless in Chromium before: 20
  notches were 20 one-frame jumps of 100 px; after, 136 frames of shrinking
  steps.
- **Only a mouse wheel's notches.** Firefox reports them in lines; Chromium
  in CSS pixels, a notch being 100 or 120 device pixels divided by the
  screen's scale (66.67 at 150%). A trackpad's or touchscreen's stream, which
  the browser already scrolls smoothly with momentum, stays native, as do
  Shift + wheel (sideways, when zoomed past the screen) and Ctrl + wheel
  (zoom). A notch goes as far as its event says, as the browser's own scroll
  would.
- **↑ / ↓, PageUp / PageDown, Space / Shift + Space move a screen**, less 15%
  so the last lines read stay in sight, eased the same way. At any zoom: the
  strip scrolls the window, so a screen is the window's height.
- **Keys glide, the wheel doesn't.** The wheel's approach starts at full speed
  so a notch feels instant; over a whole screen that was a lurch (the owner:
  "its attacking my anxiety"). A key's move eases in and out instead, 220 ms
  for a screen and 160 ms for a nudge (the owner, 2026-11-06, seeing the glide
  on a PC whose animations had been off: "i think 320ms is too much now").
  Pressed again mid-glide (a double ↓), it adds the step to where it was going
  and glides on from where it is. A glide never starts backwards (c568): a
  frame is stamped when it began, which under load is before the key, and the
  ease once ran the wrong way first (-33 px on a nudge, wave 24).
- **A held key scrolls steadily and stops when it comes up** (c668). Left
  alone, every repeat added a step to where the strip was going, so the aim
  ran far ahead and the strip kept travelling after the key was released
  (measured on the base: 30 repeats at ~30/s ran another 23,210 px after the
  keyup). Repeats now add no step: from the first one the strip scrolls at the
  speed one press covers in its glide — a screen per 220 ms, a nudge per 160
  ms — and the release eases out over 160 ms, about a third of the nudge
  further (33 px on a 100 px nudge, 185 px on a screen). A tap still glides
  one step and two separate presses still add two. Every door that can take
  the keyup away ends it the same way: the window losing focus, the page being
  hidden, the READING sheet, the lookup panel or page menu opening (its lock),
  and a jump to another chapter, which stops it at once so the repeats are not
  the new chapter's. **A strip crossing is not a jump**: scrolling on across a
  band keeps the strip and the pages around it, so the glide, the wheel's ease
  and a held arrow all read on through it (c668). A second scroll key during a
  hold takes over from where the strip is: the hold ends and the new key glides
  its own step.
- **The speed and direction are the press's own** (c668). A repeat re-reads
  its own modifiers, so releasing Ctrl mid-hold would jump a nudge to a
  screen's speed and Shift mid-Space would turn it round; the first press's
  step is what the hold keeps until the key comes up.
- **Ctrl + ↑ / ↓ nudge** 100 px: to bring a panel the screen cut in two into
  view without the mouse (the owner, 2026-10-30; "we can up the amoun a
  ctrl+arrow or side arrow moves too", 2026-11-06).
- **← / → nudge too**, the same 100 px (c527; the owner, 2026-11-04: "left
  and right arrows on manhwas to have the same effect as ctrl+up and
  ctrl+down"): **← is Ctrl + ↑ and → is Ctrl + ↓**, reading on to the right
  as a paged L→R reader's → does, so a panel reads with one hand and no
  modifier. They follow the mode, not the kind: a manhwa set to paged still
  turns pages on ← →, and a manga on the strip nudges. Ctrl + ← / → do
  nothing new. **Zoomed wider than the screen** (the lane scrolls sideways,
  "Zoom" above) ← → pan the strip 100 px sideways instead: they are the one
  way a keyboard has to reach its sides, which the browser's own arrows did
  only after a click had put the keyboard in the lane. On a TV they nudge
  with the controls hidden (a remote has no Ctrl, so this is its only
  nudge); with the controls up they stay the focus layer's (c253, below).
- **Anything else scrolling stops it** (the scrollbar, a drag), except the
  strip keeping its place: when a chapter or a reshaped page arrives above,
  the strip scrolls with it (`keepPlaceBy`) and says so, and an ease in flight
  moves with the content rather than losing the notch.
- **Reduced motion**: the wheel stays native and a key moves at once.

Tested in `tests/smooth-scroll.spec.ts` (the approach, notches at any scale,
place-keeping, and c668's steady hold, its stop and its first frame not
running backwards), `tests/reader-flow.e2e.ts` (a notch eased through the real
strip to where it aimed, ↓ and ↑ by a screen) and
`tests/reader-strip-keys.e2e.ts` (c527 on all four devices: → and ← against
Ctrl + ↓ and Ctrl + ↑, Ctrl + → / ← doing nothing, the zoomed pan, a paged
reader still turning; and c668's held ↓, which stops on the keyup, on a second
key, on blur, on the page being hidden, on the page menu, on the READING
sheet and on a jump to another chapter, and which reads on across a band —
those cases measured on a page slot, since a crossing reshapes the strip).

## Full screen

FULL SCREEN, a cell in the controls' bottom row of both readers
(`src/lib/reader/fullscreen.svelte.ts`), takes the browser's bars away and
EXIT FULL gives them back. A phone over home Wi-Fi gets plain http, where a
browser won't install tsundoku as an app ([`WIFI.md`](WIFI.md)): this is how it
loses the frame (the owner, 2026-10-30). Offered only where the browser can
(`document.fullscreenEnabled`: Android's browsers, desktops; not an iPhone's
Safari, which allows it for video only) and not in an installed app, which is
full screen already. Decided after hydration: the server can't know.

**The reading settings' cell says what it does.** It showed the summary
(R→L · FIT SCREEN) and read as a status line; it now ends in SETTINGS ↑, which
stays when a phone's width cuts the summary short.

**A phone's bottom row scrolls** (c616). At 360 px its cells are wider than
the screen, and the row used to clip the last ones: on the text reader FULL
SCREEN was off the right edge at 100% text, and on the image reader `CH. 28 →`
at 130%. The cells keep their size and order and the bar keeps its 64 px (a
second row would take the reading area's); SETTINGS ↑ keeps its whole width,
with the summary ellipsized beside it, and a sideways drag on the row reaches
the rest.

## Loading, failure, missing

**A page that didn't load says so from its top**, and keeps the message in
sight while it scrolls past (sticky at about the screen's middle). Centred in
the page's box, a manhwa slice's message was a scroll through black away (the
owner, 2026-10-30); a page that fits the screen looks as before.

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
  `?p=` in the URL, so a reload resumes; never once the reader is being left
  (c565, [`NAVIGATION.md`](NAVIGATION.md), "A screen being left writes
  nothing"), when `close` carries the page;
- `finish` on reaching the last page or crossing out of the chapter;
- `close` on leaving (a beacon).

**A history entry into the reader opens the page it was left on**, incognito
included: the reader keeps `?p=` in the entry as well as in the address bar
(`keepHistoryUrl`, `src/lib/reader/history.ts`, c623;
[`NAVIGATION.md`](NAVIGATION.md), "A screen being left writes nothing"). Before
c623 a popstate into the entry opened the page the last real navigation named;
incognito, with nothing saved, that is page 1.

Durations are the gap since the last event, capped at two minutes, and time in
the background isn't reading (`ProgressClock`). The text reader's cap is five
minutes, and the player counts only what played
([`READING-LOG.md`](READING-LOG.md), "The caps").

**Incognito** is decided by the server: while it's on, `/api/reading` answers
`{saved: false}` and writes nothing ([`PRIVACY.md`](PRIVACY.md)). A reader
opened incognito also sends nothing itself (c680): leaving the app ends the
cookie while that page may still have a settle, a finish or its close to send.
The reader shows it the addendum's way:

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
- **The blocky slider, 0–10,** as everywhere else
  ([`RATINGS.md`](RATINGS.md)). The handoff drew seven cells, with "—".
- **"↓ CACHED" only when it's true:** the boundary pages say it when the next
  chapter is on the tablet ([`OFFLINE.md`](OFFLINE.md)), and offline a cached
  next chapter continues as usual. The offline sentence drops "Chapters 1–41
  are cached": it names what can't open, not a count.
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
- **SET AS COVER** (card "Set any page as the cover"), waiting on its design.
- **Novels** use a text reader of their own on the same route:
  [`TEXT-READER.md`](TEXT-READER.md).
