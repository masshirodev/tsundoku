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
controls hidden the reader keeps every arrow — ← → turn pages, ↑ ↓ scroll a
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
the controls hidden, and OK, ↓ reach the end page as before.
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
  slide lands.
- **Nothing redraws at the end.** The screens are keyed, so the neighbour's
  element becomes the page's own, with its image already decoded.
- **Split wide pages slide half to half,** since each half is a screen.
- **FIT HEIGHT** lets the browser pan the page sideways, so it doesn't follow
  the finger there; turns still slide. **Reduced motion** turns without any
  slide.

The track is in `ImageReader.svelte` (`turn`, `after`, `screens`); tested in
`tests/reader-flow.e2e.ts`. Its numbers (the 220ms slide and its curve, the 8px
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
sheet doesn't jump when MODE changes.

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

- **Zooming.** + and − (or =) step through 50, 75, 100, 125, 150, 175, 200,
  250 and 300%; Ctrl + the wheel and a two-finger pinch zoom freely in the
  same range; **0 is RESET**. The READING sheet's ZOOM row has the same:
  − · 125% · + · RESET.
- **Paged:** the page box is the fit times the zoom (`--zoom`, which
  `PageImage` multiplies its `vw` and `dvh` by), so a zoomed page scrolls both
  ways inside its screen and each page starts at the top (at its right in
  R→L). While zoomed a drag pans the page instead of turning it; the edges
  and the keys still turn.
- **Vertical:** the strip's width is SIDES' width times the zoom. Past 100%
  it scrolls sideways inside its lane; under it, it narrows as SIDES does.
  The page under the middle stays there (Strip's own width-change anchor),
  unless the zoom has a point of its own (below).
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

The rules are in `src/lib/reader/zoom.ts` (`tests/reader-zoom.spec.ts`); the
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
  and, only while the series is unrated, RATING and FAV. The rating prompt
  never interrupts twice. An ongoing series whose source has added nothing for
  eight weeks adds one line — `ASURA SCANS HAS ADDED NOTHING SINCE 6 SEP` —
  and a cell ANOTHER SOURCE → that opens MOVE ([`MOVE.md`](MOVE.md)). No band:
  a quiet source isn't a broken one.
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
  open a chapter on its first page, whatever its progress said.
- **CH. ← / →** in the controls go to a neighbour already on the strip by
  scrolling to it, and to anything else by starting the strip over there.
- **The scrubber** moves within the chapter being read.
- **SIDES** (0, 10, 20 or 30% a side) brings the strip in from both edges, for
  a strip that fit to a landscape tablet's width would be enormous. A tap on
  the margins still shows the controls.

Tested in `tests/reader-flow.e2e.ts`: across the band and back, that the page
being read stays put through a rotation both ways, and that
nothing moves when chapters arrive above or when the reader crosses a band.

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
  "its attacking my anxiety"). A key's move eases in and out instead, 320 ms
  for a screen and 160 ms for a nudge. Pressed again mid-glide (a double ↓),
  it adds the step to where it was going and glides on from where it is.
- **Ctrl + ↑ / ↓ nudge** 40 px, about what an arrow did before: to bring a
  panel the screen cut in two into view without the mouse (the owner,
  2026-10-30).
- **Anything else scrolling stops it** (the scrollbar, a drag), except the
  strip keeping its place: when a chapter or a reshaped page arrives above,
  the strip scrolls with it (`keepPlaceBy`) and says so, and an ease in flight
  moves with the content rather than losing the notch.
- **Reduced motion**: the wheel stays native and a key moves at once.

Tested in `tests/smooth-scroll.spec.ts` (the approach, notches at any scale,
place-keeping) and `tests/reader-flow.e2e.ts` (a notch eased through the
real strip to where it aimed, ↓ and ↑ by a screen).

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
  `?p=` in the URL, so a reload resumes;
- `finish` on reaching the last page or crossing out of the chapter;
- `close` on leaving (a beacon).

Durations are the gap since the last event, capped at two minutes, and time in
the background isn't reading (`ProgressClock`). The text reader's cap is five
minutes, and the player counts only what played
([`READING-LOG.md`](READING-LOG.md), "The caps").

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
