# tsundoku on a TV

Status (2026-11-01): **the focus layer (c234) and the ten-foot layout (c238)
are built; the remote's long-press options, BACK climbing and the player's bar
(c235) and the Android app (c236) are not.** The handoff is mirrored in
`doc/design/handoff/TV*` (see "The design", below). Parent card c231 ("Android
TV: tsundoku from the couch, with a remote") on the Tsundoku board; every card
for it carries the `TV` label. [`FOCUS.md`](FOCUS.md) is the D-pad layer;
"What is built" below is the layout it runs in.

## Why

The owner's call, 2026-11-01: working well on an Android TV is the biggest
thing that sets tsundoku apart from Mihon and similar apps, and probably what
most people want from it. Mihon and its forks are phone and tablet apps that
barely work with a D-pad. Komga and Kavita are web readers with no TV in mind.
Jellyfin does TV well, but only for video. One library for manga, novels and
anime, driven with a remote, is the gap.

## What a TV is, to the page

- **About 960×540 CSS px** (a 1080p panel at device pixel ratio 2). Some
  report 1280×720 (ratio 1.5).
- **`pointer: none`, `hover: none`.** No touch, no mouse.
- **Input is a remote:** the D-pad as arrow keys, OK as Enter, Back (history
  back in a WebView, or Escape), often Menu (`ContextMenu`) and the media keys
  (`MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaTrackNext`).
  Text comes from the on-screen keyboard or voice.
- **Seen from about 3 m**, and some TVs still crop the edges (overscan).

So today a TV gets the tablet layout (`src/lib/device.svelte.ts`: `DESKTOP`
needs `pointer: fine`), or at 1280 px the wide one, which is a reasonable
start but was drawn for fingers.

## What already works

- D-pad focus: the arrows move to the nearest focusable thing, a sheet is a
  scope, and one ink frame shows where you are ([`FOCUS.md`](FOCUS.md)).
- The player's keys: Space, ←/→ seek 10 s, ↑/↓ volume
  (`src/routes/read/[entry]/VideoPlayer.svelte`).
- The image reader turns pages on the arrows and PageUp/PageDown
  (`ImageReader.svelte`).
- Back walks history and the library restores its place
  ([`NAVIGATION.md`](NAVIGATION.md)).
- Serving to the home network and pairing ([`WIFI.md`](WIFI.md)), over plain
  http.

## The work

| Card | What                                                            | Waits on   |
| ---- | --------------------------------------------------------------- | ---------- |
| c232 | How the TV reaches the server, and signs in without a camera    | the owner  |
| c233 | The ten-foot design, from [`briefs/TV.md`](briefs/TV.md)        | the design |
| c234 | D-pad focus: moving by direction, and focus you can see         | nothing    |
| c235 | The remote's way into long-press sheets; the player on screen   | c233       |
| c236 | The Android TV app, a Kotlin WebView wrapper                    | c232       |
| c238 | The ten-foot layout: the query, library, series, reader, search | c234       |

### Why a wrapper app, not the browser

Android TV has no Chrome, so tsundoku can't be installed from a browser, and
a Trusted Web Activity needs Chrome too. TV browsers (TV Bro and the like)
work, but they draw their own cursor and chrome over the page. A WebView app
gets a launcher banner, passes the remote's keys through, and keeps the
screen awake natively, which over plain http the page can't ask for itself.

### Why our own focus layer

A D-pad moves by direction, not tab order. Chromium has spatial navigation,
but Android's WebView doesn't expose it, so arrow keys moving focus to the
nearest thing in that direction is tsundoku's own code. It's written for the
whole app, so keyboard users on a desktop get it too.

### Reaching the server

A friend's install answers `localhost` only ([`DISTRIBUTION.md`](DISTRIBUTION.md)).
WI-FI lets a TV in over plain http, which isn't a secure context: no offline,
no install, no wake lock, no fingerprint for `/reveal`. And pairing opens
through a phone's camera, which a TV hasn't got. c232 lays out the options;
the recommendation is WI-FI as it is plus a code you can type with a remote,
with the app keeping the screen awake.

## The design

The handoff for [`briefs/TV.md`](briefs/TV.md) came back on 2026-11-01:
`doc/design/handoff/TV Calls.dc.html` holds the decisions, the sizes, the
media query and the remote's keys; the `TV-Board-*` files lay out each
screen's states. Canvas: `https://claude.ai/artifact/91833e89-1e36-4d09-9f98-077c88bcf921`.

What it decided, in short:

- **The query:** `(pointer: none) and (min-width: 900px)`, last in
  `layout.css`, mirrored as `TV` in `device.svelte.ts`. `WIDE` gains
  `not (pointer: none)` so a 1280-wide TV isn't also wide.
- **Sizes**, in a 960×540 frame: a safe margin of 48 px at the sides and 28 px
  top and bottom, text 15 px minimum, 6 covers a row (144 px cells), a 56 px
  header, targets 56 px tall, CONTINUE 3 cards across, sheets as 420 px panels
  from the right.
- **One focus mark:** a 4 px frame in text ink, 3 px off the thing, outside a
  cover, button, chip or field and inside a ruled cell. It jumps and never
  animates or grows. Never the accent (which means "yours") and never magenta.
  Desktop keyboards get the same mark on `:focus-visible`.
- **A cover is its picture;** a focus line under the shelf tabs names the
  focused one in full, with HOLD OK · OPTIONS where it has options.
- **The library stays a grid, one shelf at a time**, not a row per shelf.
  Top bar, no sidebar, no SELECT.
- **The remote:** arrows move focus (except where they already mean
  something: the player with its bar hidden, the reader); OK presses; OK held
  500 ms or MENU opens the long-press options; BACK closes what's open, then
  climbs to the top of the screen, then leaves; ▶❚❚ on a tile resumes it;
  ⏪ ⏩ seek in the player and change chapter in the reader; MIC searches.
- **The player:** the picture until a key, then all six controls on one row
  with the scrubber above; settings as a panel; SKIP INTRO shown alone and
  focused while offered.
- **The reader:** a spread by default on a TV (it's off by default
  elsewhere), one page for a cover or a wide page, a 520 px strip for
  vertical.
- **Search** sits in the top half, above Android's keyboard.
- **Pairing:** the TV fills in its own network's `192.168.1.` and the port,
  so only the last number is typed, then a six-digit code from the computer.
- **Reveal** draws its frame 20 px in from the edge so overscan can't crop it.

### Claims to check before building

The handoff states these about the code or the app; they're not verified yet:

- "A TV that reports 1280×720 is pinned to 960 wide by the app's WebView
  scale": nothing does that yet. It's the TV app's job (c236).
- A six-digit code typed on the TV: `src/lib/server/pairing.ts` has a 96-bit
  code in a link and no limit on attempts. Six digits is a million guesses,
  so a typed code needs attempt limiting and expiry before it ships.

## What is built (c238)

- **The query.** `(pointer: none) and (min-width: 900px)`, last in
  `src/lib/styles/layout.css`; `TV` in `src/lib/device.svelte.ts`, and `WIDE`
  now excludes it so a 1280-wide TV is not also the wide layout. The TV block
  sets the safe margin (48 px sides, 28 px top and bottom), a 56 px header and
  tab row, six columns, CONTINUE three across, a 56 px target, 420 px panels,
  a 520 px strip, a 64 px focus line and the handoff's type scale (15 px
  floor, controls 17, rows 20, titles 28/36) through the `--type-*` tokens.
  `src/lib/styles/tv.css` holds what more than one screen reads, and the
  reveal frame's inset.
- **Focus.** The layer is c234's; this card gives it the focus line and the
  rating row. A tile carries `data-focus-line`, its name, its meta and its
  rating; `src/lib/components/content/FocusLine.svelte` follows focus and
  draws the 64 px bar under the pinned tabs (name, kind and counts, rating
  bars, `OK OPEN`, `HOLD OK OPTIONS`). It exists only on a TV.
- **The library.** Top bar under the safe top, no sidebar, no SELECT. CONTINUE
  is three 288×120 cards, each one button (the ▶ cell becomes the overlay, the
  mark is drawn inside the card). The shelf tabs pin; a focus line under them
  pins with them. The grid is six 144 px cells inside the safe margin; a tile
  is its cover, its badges and nothing else -- a coverless book sets its title
  on the stripes. The sort menu stays in the section label.
- **The series screen.** The metadata is a 352 px column at the left, with
  ▶ CONTINUE 64 px tall and focused on arrival; the chapter or episode list
  sits 32 px beside it with 56 px rows and its scrub rail. RATING keeps ← →:
  `data-focus-adjust` tells the focus layer (`src/lib/focus/dom.ts`) that a
  left or right moves its value by half a bar and ↑ ↓ leave. FAV and the rest
  of the actions are still the panel's ruled rows (see Departures).
- **Panels.** Every `Sheet` is a 420 px panel from the right, full height,
  with the strong rule on its left edge; the screen it opened over stays in
  view at the left. The scrim is still the whole screen.
- **The reader.** Spreads are the default on a TV only (a stored choice still
  wins), the cover stands alone as everywhere, and the vertical strip is 520 px
  at any zoom, centred. The reader's chrome and its panels are unchanged in
  size; the READING panel is a 420 px panel now because it is a `Sheet`.
- **Search.** The field is the top bar under the safe top; results are three
  cards across inside the safe margin, a 114 px row, in the top half so
  Android's keyboard can take the bottom. `/reveal` on a TV says "NOT ON A TV ·
  TURN REVEAL ON FROM THE COMPUTER" instead of asking for a ceremony.
- **Reveal.** The frame is drawn 6 px wide, 20 px in from the sides and 14 from
  the top and bottom, so overscan cannot crop it; the banner is inside the safe
  top. Turning reveal on is the computer's job.
- **Tests.** A `tv` Playwright project at 960×540 with no pointer and no hover
  (Chromium's `--blink-settings=availablePointerTypes=none,availableHoverTypes=none`;
  `tests/tv-layout.e2e.ts` proves the query and the variables, so the launch
  configuration cannot rot silently). `library-layout`, `series-layout` and
  `reader-layout`'s device tables gained a `tv` row; `tests/tv-screens`,
  `tv-reader` and `tv-series` cover the focus line, the panel, search, reveal,
  spreads and the rating keys. `tests/tv-library-frame.e2e.ts` and
  `tests/tv-series-frame.e2e.ts` are generated by
  `design-tools/gen-conformance.mjs` from `TV-Library.dc.html` and
  `TV-Series.dc.html`.

### Departures from the handoff (c238)

- **The series' actions are not the mock's 3×2 grid.** `SeriesPanel`'s order is
  identity, the blocky rating slider with FAV, CONTINUE, then the DOWNLOAD,
  direction, SHELVES, TAGS, LINK, ABOUT and FILE rows. The handoff draws
  RATING / FAV / SHELVES / DOWNLOAD / FOLLOW as one closed 3-column block
  under CONTINUE. Rebuilding that block is a restructuring of a file card c139
  is editing; the rows are already a ruled block and every action is there, so
  the screen keeps them. (The rating row is `data-focus-adjust`, so ← → work.)
- **The list keeps its scrub rail.** The handoff's list has no rail; the real
  one has had a rail since the series handoff, and it is 56 px of a 480 px
  column here. It stays.
- **The CONTINUE card is a grid, not the mock's flex row.** The cover is one
  column and the progress bar spans under the title, which the mock's flat
  button could only draw because its bar was inside the text column. The
  measurements (288×120, 72 px cover, 8/14 padding) are the handoff's.
- **The tab row and the grid are inset from the screen edge.** The handoff's
  safe margin is real (48 px each side), but backgrounds and hairlines there run
  to the screen edge only on the top bar; the tab row and the grid stop at the
  safe margin. The bar's rule is full width because the margin is on the bar,
  not on the page.
- **The status bars are 56 px but the type is the TV's.** `--header-h` is 56
  and the cells are `--type-control` (17); the wordmark keeps its 18 px because
  it is typeset to the system's own size.
- **A visible sheet dims the whole screen.** The design's boards keep the
  screen visible at the left; the scrim covers it, as the sheet always has.
  The reader's own panel keeps its lighter scrim where it already did.
- **The right-hand `FILTER` cell still opens the existing filter panel,** not a
  420 px panel; the panel is only a `Sheet` where it already was one. Its
  width at TV size is the tablet's, unchanged.

## What it does not do yet

- **The D-pad's advertised verbs.** `HOLD OK · OPTIONS` is drawn on the focus
  line, but a held OK and MENU do nothing yet: that is c235, with BACK
  climbing to the shelf's tab and then CONTINUE. On a TV today the tile's
  options are the long-press sheet once c235 lands; the rating and FAV are on
  the tile's panel, not the tile.
- **The player.** Its six-cell bar, the settings panel, SKIP INTRO and the
  picture-until-a-key behaviour are c235. The reader's chrome is the tablet's,
  at 64/56/64; only its panels follow the 420 px rule.
- **Pairing.** Nothing is drawn for 9A–9E or the six-digit code: c236, with the
  TV app.
- **HISTORY, SETTINGS, BROWSE, DOWNLOADS, the person page, HELP and the rest**
  get the query's type scale and 420 px panels, but no layout of their own.
  HISTORY is the one the handoff names as likely to want one.

### Still open

- **Turning reveal on from a TV**: settled on 2026-11-01 -- it cannot be done
  from a TV (no fingerprint, no screen lock); `/reveal` says so and the
  computer turns it on.
- **How the TV reaches the server** (c232): the pairing drawn is option A,
  but the card still waits on the owner.
- **HISTORY** may want a TV layout of its own later; drawn as is.
- **Japanese lookup on a subtitle line** with a remote: not designed.
