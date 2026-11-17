# tsundoku on a TV

Every thing a finger or a keyboard letter reaches is reachable from a D-pad,
OK pressed or held, MENU, BACK and the media keys; a WebView that keeps BACK
to itself has `window.tsundokuBack()` to call; and on a TV that is the app's
own back key. The app is a Kotlin WebView under `android/`, with a launcher
banner, the remote's keys passed through, the screen kept awake, and a
six-digit code a remote can type ([`TV-APP.md`](TV-APP.md)).
[`FOCUS.md`](FOCUS.md) is the D-pad layer; "The layout" below is the layout it
runs in.

## Why

Working well on an Android TV is the biggest thing that sets tsundoku apart
from Mihon and similar apps, and probably what most people want from it.
Mihon and its forks are phone and tablet apps that barely work with a D-pad.
Komga and Kavita are web readers with no TV in mind. Jellyfin does TV well,
but only for video. One library for manga, novels and anime, driven with a
remote, is the gap.

## What a TV is, to the page

- **About 960×540 CSS px** (a 1080p panel at device pixel ratio 2). Some
  report 1280×720 (ratio 1.5).
- **`pointer: none`, `hover: none`.** No touch, no mouse.
- **Input is a remote:** the D-pad as arrow keys, OK as Enter, Back (history
  back in a WebView, or Escape), often Menu (`ContextMenu`) and the media keys
  (`MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaTrackNext`).
  Text comes from the on-screen keyboard or voice.
- **Seen from about 3 m**, and some TVs still crop the edges (overscan).

Without the TV query a TV would get the tablet layout
(`src/lib/device.svelte.ts`: `DESKTOP` needs `pointer: fine`), or at 1280 px
the wide one, both drawn for fingers.

## Why a wrapper app, not the browser

Android TV has no Chrome, so tsundoku can't be installed from a browser, and
a Trusted Web Activity needs Chrome too. TV browsers (TV Bro and the like)
work, but they draw their own cursor and chrome over the page. A WebView app
gets a launcher banner, passes the remote's keys through, and keeps the
screen awake natively, which over plain http the page can't ask for itself.

## Why our own focus layer

A D-pad moves by direction, not tab order. Chromium has spatial navigation,
but Android's WebView doesn't expose it, so arrow keys moving focus to the
nearest thing in that direction is tsundoku's own code. It's written for the
whole app, so keyboard users on a desktop get it too.

## Reaching the server

A friend's install answers `localhost` only ([`DISTRIBUTION.md`](DISTRIBUTION.md)).
WI-FI lets a TV in over plain http, which isn't a secure context: no offline,
no install, no wake lock, no fingerprint for `/reveal`. And pairing opens
through a phone's camera, which a TV hasn't got. So a TV comes in by **WI-FI
plus a code typed with a remote**: the app keeps the screen awake, the
computer shows six digits beside the phone's QR, and the TV types them
([`TV-APP.md`](TV-APP.md), [`WIFI.md`](WIFI.md)).

A token install is the other way in: served on the tailnet with
`TSUNDOKU_TOKEN`, over https through `tailscale serve`. There is no WI-FI row
on it, so the six digits are in SETTINGS › 08 — DEVICES itself, and the paired
cookie `/pair/tv` sets is accepted by the guard for a request that came in on
the instance's public host — the tailnet name — and ignored on a loopback one
([`SIGN-IN.md`](SIGN-IN.md), "A token install"). The TV app reaches
that host by TYPE THE WHOLE ADDRESS on the address screen,
`https://name.ts.net:8443`, or by being handed it at launch
(`adb shell am start … --es url …`, or a `tsundoku://connect?url=` link),
which skips the welcome screen and, for a server already in the list, the
address screen; a new address stops on the address screen until CONNECT is
pressed ([`TV-APP.md`](TV-APP.md), "Handing the TV an address").

## The design

- **The query:** `(pointer: none) and (min-width: 900px)`, last in
  `layout.css`, mirrored as `TV` in `device.svelte.ts`. `WIDE` has
  `not (pointer: none)` so a 1280-wide TV isn't also wide.
- **Sizes**, in a 960×540 frame: a safe margin of 48 px at the sides and 28 px
  top and bottom, text 15 px minimum, 6 covers a row (144 px cells), a 56 px
  header, targets 56 px tall, CONTINUE 3 cards across, sheets as 420 px panels
  from the right.
- **One focus mark:** a 4 px frame in text ink, 3 px off the thing, outside a
  cover, button, chip or field and inside a ruled cell. It jumps and never
  animates or grows. Never the accent (which means "yours") and never magenta.
  Desktop keyboards get the same mark on `:focus-visible`.
- **A cover is its picture;** a focus line under the pinned KIND band names the
  focused one in full, with HOLD OK · OPTIONS where it has options.
- **The library stays a grid, one shelf at a time**, not a row per shelf.
  Top bar, no sidebar, no SELECT.
- **The remote:** arrows move focus (except where they already mean
  something: the player with its bar hidden, the readers with their chrome
  hidden); OK presses; OK held or MENU opens the long-press options; BACK
  closes what's open, then climbs to the top of the screen, then leaves; ▶❚❚
  on a tile resumes it; ⏪ ⏩ seek in the player and change chapter in the
  reader; MIC searches.
- **The player:** the picture until a key, then all six controls on one row
  with the scrubber above; settings as a panel; SKIP INTRO shown alone and
  focused while offered, and the next-episode card's PLAY NOW focused the
  same way.
- **The reader:** a spread by default on a TV (it's off by default
  elsewhere), one page for a cover or a wide page, a 520 px strip for
  vertical.
- **Search** sits in the top half, above Android's keyboard.
- **Pairing:** the TV fills in its own network's `192.168.1.` and the port,
  so only the last number is typed, then a six-digit code from the computer.
- **Reveal** draws its frame 20 px in from the edge so overscan can't crop it.
  Turning reveal on cannot be done from a TV (no fingerprint, no screen lock):
  `/reveal` says so and the computer turns it on.

## The layout

- **The query.** `(pointer: none) and (min-width: 900px)`, last in
  `src/lib/styles/layout.css`; `TV` in `src/lib/device.svelte.ts`, and `WIDE`
  excludes it so a 1280-wide TV is not also the wide layout. The TV block sets
  the safe margin (48 px sides, 28 px top and bottom), a 56 px header and tab
  row, six columns, CONTINUE three across, a 56 px target, 420 px panels, a
  520 px strip, a 64 px focus line and the TV type scale (15 px floor,
  controls 17, rows 20, titles 28/36) through the `--type-*` tokens.
  `src/lib/styles/tv.css` holds what more than one screen reads, and the
  reveal frame's inset.
- **Focus.** The layer is [`FOCUS.md`](FOCUS.md)'s; the TV adds the focus line
  and the rating row. A tile carries `data-focus-line`, its name, its meta and
  its rating; `src/lib/components/content/FocusLine.svelte` follows focus and
  draws the 64 px bar under the pinned KIND band (name, kind and counts,
  rating bars, `OK OPEN`, `HOLD OK OPTIONS`). It exists only on a TV.
- **The library.** Top bar under the safe top, no sidebar, no SELECT. CONTINUE
  is three 288×120 cards, each one button (the ▶ cell becomes the overlay, the
  mark is drawn inside the card). A card is a grid: the cover is one column
  and the progress bar spans under the title (72 px cover, 8/14 padding). The
  KIND band pins in the tabs' place; a focus line under it pins with it. The
  grid is six 144 px cells inside the safe margin; a tile is its cover, its
  badges and nothing else -- a coverless book sets its title on the stripes.
  The sort menu stays in the section label. The tab row and the grid stop at
  the safe margin; only the top bar's background and rule run to the screen
  edge, because the margin is on the bar, not on the page. The status bars are
  56 px with `--type-control` (17) cells; the wordmark keeps its 18 px because
  it is typeset to the system's own size. The right-hand `FILTER` cell opens
  the filter panel, at the tablet's width, not a 420 px panel.
- **A tile keeps the mark through a library filter's outline**, and gets it
  back when the grid is drawn again, or the KIND band's chosen cell when the
  filter took the tile away ([`LIBRARY.md`](LIBRARY.md), "The KIND band").
  **The pad alone does not reach the state the guard is for**: every
  navigation a pad press starts keeps the mark on its own cell (the KIND cells
  and the shelf tabs carry `data-sveltekit-keepfocus`; SORT's cell is kept
  drawn), and a BACK into the library starts with the mark on `<body>` —
  measured, BACK from a series: body while LOADING and a tile once the grid
  settled; BACK from `?kind=manga` to ALL: the KIND cell throughout. A
  pointer's tap on a band cell (or a script's click) is what leaves a tile
  holding the mark while the navigation it starts outlines the grid, so the
  case is reachable by a finger, not by a remote.
- **The series screen.** The metadata is a 352 px column at the left, with
  ▶ CONTINUE 64 px tall and focused on arrival; the chapter or episode list
  sits 32 px beside it with 56 px rows and its scrub rail (56 px of a 480 px
  column). RATING keeps ← →: `data-focus-adjust` tells the focus layer
  (`src/lib/focus/dom.ts`) that a left or right moves its value by half a bar
  and ↑ ↓ leave. The actions are `SeriesPanel`'s ruled rows in its own order
  (identity, the blocky rating slider with FAV, CONTINUE, then the DOWNLOAD,
  direction, SHELVES, TAGS, LINK, ABOUT and FILE rows), with the rows a visit
  rarely touches folded behind DETAILS, as on a phone
  ([`SERIES.md`](SERIES.md), "DETAILS"). The rows take the narrow column's
  layout on a TV, cells dropped under their row in equal columns, as on the
  phone and in the 440 px desktop column, and pad 16 px, not the screen's 48:
  at 960 wide the TV meets neither narrow width, and the tablet's full-width
  rows would run out of the column and over ▶ CONTINUE
  (`tests/tv-series.e2e.ts`, "fits its 352px column"). LISTS: ↑ ↓ move a line
  at a time, ← → between a line's cells; a line drops its meta on the TV (one
  OK away, in EDIT), and two cells drop under the line in equal columns.
- **Panels.** Every `Sheet` is a 420 px panel from the right, full height,
  with the strong rule on its left edge; the screen it opened over stays in
  view at the left. The scrim still dims the whole screen, as the sheet
  always does; the reader's own panel keeps its lighter scrim.
- **The reader's chrome and its panels.** Spreads are the default on a TV
  only (a stored choice still wins), the cover stands alone as everywhere,
  and the vertical strip is 520 px at any zoom, centred. Chrome and sheets
  are the sizes they are elsewhere; READING is a 420 px panel from the right,
  like every sheet on a TV.
- **Search.** The field is the top bar under the safe top; results are three
  cards across inside the safe margin, a 114 px row, in the top half so
  Android's keyboard can take the bottom. `/reveal` on a TV says "NOT ON A TV ·
  TURN REVEAL ON FROM THE COMPUTER" instead of asking for a ceremony.
- **Reveal.** The frame is drawn 6 px wide, 20 px in from the sides and 14 from
  the top and bottom, so overscan cannot crop it; the banner is inside the safe
  top. Turning reveal on is the computer's job.
- **Its own kind in DEVICES**: the app's user agent makes the TV a `tv` in the
  server's `devices` table (migration 59), so SETTINGS names it "Android TV ·
  Chrome" and `/start` counts it as another device.
- Back walks history and the library restores its place
  ([`NAVIGATION.md`](NAVIGATION.md)).

## The remote

`src/lib/focus/keys.ts` holds the decisions (`isBackKey`, `isOptionsKey`,
`OkPress`) and `layer.ts` wires them; [`FOCUS.md`](FOCUS.md) has the layer's
half.

- **OK held** is Enter down past 450 ms, the pointer's own hold
  (`src/lib/actions/longpress.ts`), so a tile's sheet opens at the same speed
  from a finger and a remote. It sends `contextmenu` to the focused thing, so
  every long-press sheet opens through the path it already has: `CoverTile`
  and `BookTile` (the tile's sheet), `use:longpress` (a chapter, episode or
  page row, a history row), `PageMenu`. A short press is the click a
  keyboard's Enter makes, on the release; a held release presses nothing; and
  `e.repeat` neither opens twice nor clicks. A thing with no options is simply
  pressed on the hold, so no press is dead.
  - A pointer's long press and a key's do not share one flag: the click a
    finger's release makes is swallowed, and the _next_ key's click is not
    (sharing it left the tile after a long-press sheet one press behind).
  - `longpress.ts` is that shared hold; the tiles keep their own copies of it
    (they carry the tile's press-and-scroll cancel too).
  - **OK held** is any keydown while OK is already down, whatever its `repeat`
    says: Android TV's WebView sends a held centre as a stream of keydowns,
    and restarting the hold on each meant it never fired (`OkPress.down`,
    `tests/focus-keys.spec.ts`).
- **MENU** (`ContextMenu`) sends the same event at once.
- **BACK** is Escape, `BrowserBack` and `GoBack`. It closes the open sheet or
  panel first (a scope closes itself; the player, the reader, the page menu and
  a history row's REMOVE register a step instead), then climbs — a grid's
  tiles to the KIND band's chosen cell, anything else to `[data-focus-start]`
  (the first CONTINUE card, the series' ▶ CONTINUE, the bar on a player; the
  climb is the TV's only, a keyboard's Escape is not taken for it) — and at
  the top of the screen says nothing took it. **A climb only lands out of
  sight** (`inFullView` in `src/lib/focus/layer.ts`): with the target already
  on screen, a climb would cost a press for nothing, so with the top of the
  screen in full view BACK leaves at once. The pinned KIND band's chosen cell
  is always in sight, so on a scrolled library BACK goes straight to the
  first CONTINUE card and the page's top; with the top in full view it
  leaves. `BrowserBack`/`GoBack` then take the history step themselves.
  **Escape does not itself leave a screen**: at the top `back()` returns
  false, and Escape is left to the browser, since it is also the way out of a
  filter panel, a lightbox and a typed field, and taking it unconditionally
  would leave the page from under them.
- **`window.tsundokuBack(): boolean`** is the same logic, installed by the
  focus layer. **This is the app's contract**: a WebView does not hand BACK to
  the page, so the app calls this from its own `onBackPressed`, and leaves or
  goes back natively only when it returns `false`. It is truthy whenever the
  page did something — closed a sheet, climbed a screen — and `false` only
  when there was nothing left to take. `tests/tv-keys.e2e.ts` and
  `tests/tv-move.e2e.ts` pin both halves.
- **Focus stays in sight under pinned bars.** `reveal` scrolls the focused
  thing on screen, then out from under whatever sticky or fixed bars cover it
  (found with `elementFromPoint` at its edges, stacked bars included: the
  library's focus line is pinned under its KIND band), so ↑ through the grid
  never leaves a row under them. `tests/tv-keys.e2e.ts` pins it.
- **A remote's media keys**, on every device: ▶❚❚ plays or pauses, ⏩ ⏪ seek
  10 s with the flash, ⏭ ⏮ the next and the previous episode
  (`MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaTrackNext`,
  `MediaTrackPrevious`; a remote with ⏮ means the previous episode, and the
  player has a previous-episode cell). On the library, ▶❚❚ on a focused
  CONTINUE card resumes it there and then, without the series screen.
- **The library's rating and FAV are not arrow stops**: a cover is its cover,
  and its options are a held OK.

## The player

The picture until a key; then, when no offer is up, OK, ↑ or ↓ brings the bar
with focus on ▶❚❚, the six cells on one row: ▶❚❚ · −10 · +10 · ← EP. n · the
stream's own cell, which opens the settings · EP. n+1 →, 76 px for the three
on the left, under a 60 px scrubber, both bars' contents inside the safe
margin. The bars themselves reach the screen's edges, the margin being their
padding (28 px top or bottom, 48 px sides; the cells one framed row 48 px
in): set 28 px in, the picture would show above the top bar and under the
cells. The middle cluster is not drawn (it is the thumb's), and nothing
changes off a TV. The top bar keeps its + ADD and its ←: a browsing record has
no other way to be added. BACK hides the bar at once, then leaves for the
series. The player's letter keys stay for keyboards: Space, ←/→ seek 10 s,
↑/↓ volume, F, M, C, S, N, ? (`src/routes/read/[entry]/VideoPlayer.svelte`).

- **The settings cell** opens the 420 px panel every sheet is, the picture
  playing at the left, focus on its first row; ←/→ move along a row, OK takes
  the value, BACK closes and gives focus back to the cell. Its rows are the
  sheet's: QUALITY, SERVER, AUDIO, SUBTITLES, SPEED, DIM and ALL SETTINGS →.
  With a language row's MORE list open, BACK closes the list first and gives
  MORE the focus back. The DIM row is a native range, so it keeps ← → for its
  value and lets ↑ ↓ leave the row (pinned by `tests/tv-player.e2e.ts`). A
  server that fails over redraws the panel's rows under the focus, so the
  panel takes it back rather than dropping the mark.
- **The seek bar keeps ← →.** The track carries `data-focus-adjust`, so ← →
  seek 10 s with the flash and ↑ ↓ leave it, as the series' rating row does.
  Its element's box also reaches 20 px left of the line (a transparent
  border; the fill is clipped to the padding box, and the pointer maps from
  the padding box), so ▶❚❚ overlaps it. Without that the line starts at 126
  while the cell ends at 125, and an overlapping candidate beats a nearer one
  out of line ([`FOCUS.md`](FOCUS.md)): ↑ from ▶❚❚ would take the top bar's ←
  372 px away, and ← from the bar would take ▶❚❚. Every cell in the row lands
  on the bar. `tests/focus-geometry.spec.ts` pins why the 1 px matters.
- **The seek preview** ([`ANIME.md`](ANIME.md), "The player"): while a ← →
  (or ⏩ ⏪) move's flash is up, a downloaded episode with a sprite shows the
  tile for the time it landed on above the bar, with the time under it, kept
  inside the track at either end. It is drawn, not a stop: the tip takes no
  focus and no pointer, so the pad stays on the bar and no walk changes. A
  stream shows the time alone.
- **With the bar hidden, ← → seek and bring the bar with focus on the seek
  bar**, so the next ← → keeps seeking there; when no offer is up, OK, ↑ and ↓
  bring it on ▶❚❚. When an offer has the pad, OK presses the focused button,
  ↑ is a no-op while the bar is down, and ↓ brings the bar with focus on the
  seek bar.
- **The offers take focus the moment they appear** (a TV only, never a
  pointer): SKIP INTRO and SKIP ENDING, the next-episode card's PLAY NOW →,
  and, on a Work's last episode, the Work card's ▶ READ (or WATCH). So OK does
  what they say in one press. On the next-episode card ← reaches STAY, ↓ goes
  into the bar, and ↑ returns to PLAY NOW; the bar names it with
  `data-focus-up`, because the card's two buttons are equally near above it
  and the geometry would pick STAY. On the Work card ← → walk its own row (▶,
  WORK, ✕) and seek nothing, and ↓ and ↑ behave as on the other offers (the
  keys' offer check names `.endcard, .skip` and `.upn`). The Enter shortcut
  for SKIP works only where the button is not focused, so the two cannot both
  fire. When an offer goes (used, or the mark passed) focus lands on the seek
  bar if the bar is shown, else back on the picture. PLAY NOW would win if an
  ending's skip and the card were ever both up, because they do the same
  thing; `inEnding` stands down when there is a next, so they cannot be.
- **The offer takes the pad when it starts, not when the bar draws it.**
  SKIP inside its 8 s alone window is offered with the bar down and has the
  pad. Once that window closes, SKIP is drawn only with the bar and no longer
  has the pad, so with the bar down no offer is up: OK, ↑ and ↓ bring the bar
  on ▶❚❚ while the opening still runs, and the SKIP the bar draws again is a
  reveal, not a new offer, so it does not take the mark. ↑ from the bar
  reaches it: ↓ or ↑ out of the bar is the bar's, and the bar's own ↑ names
  PLAY NOW or SKIP.
- **The chrome's own 4 s hands the pad back to the offer.** While an offer is
  up, `.top` and `.bottom` are `data-focus-skip`, so a cell focused there
  stops being a stop the moment the bar hides. A TV-only effect puts focus
  back on the offer instead of leaving OK on the dead track and ↑/↓ on STAY.
  PLAY NOW, the Work card's ▶ and SKIP also carry `data-focus-start` while
  offered, so the layer's "nothing focused" fallback and BACK's climb start on
  the offer rather than on STAY. ↑ on the card itself has nothing above it
  and stays there; it does not open the bar underneath the button.
- **OK on the focused seek bar toggles the picture.** The layer turns OK into a
  click on the focused thing, and a pointer's click on the bar is a seek, so
  only a click with no pointer detail — one an element made — toggles.
  Scrubbing with a finger or a mouse is untouched.
- **The root lifts `data-focus-off` while an offer is up**, even with the bar
  hidden, so the pad reaches it; a hidden bar is not an arrow stop
  (`data-focus-skip`), so a key reaches the card rather than an invisible
  cell.

## The readers

- **The image reader** turns pages on the arrows and PageUp/PageDown, and
  keeps every arrow while its chrome is hidden. OK shows its chrome. With the
  chrome hidden, OK held or MENU opens the page menu for the page in the
  middle of the screen (in a spread, the one a turn leaves behind); with the
  chrome up the pad takes OK and MENU for the focused cell, so the menu is
  reachable again once BACK hides the chrome. BACK closes the menu, then the
  chrome, then leaves. A keyboard's Escape is still the chrome's own toggle
  ([`READER.md`](READER.md)); a remote's BACK is the app's, and leaves. The
  page menu is a 420 px panel from the right on a TV, and the page it means is
  framed in ink rather than the accent. The end page is the reader's other
  focusable screen: its cells are stops, so ANOTHER SOURCE → on a stale series
  is reachable.
- **The chrome is a focus row when it is up, on a TV.** The opt-out is
  `!atEnd && !(TV && chrome)`: with the chrome up the pad walks its cells. Off
  a TV nothing changes: the reader owns every arrow, chrome or not, and a
  desktop keyboard still turns pages with the chrome up. On a vertical strip
  with the chrome hidden, ← → nudge it 100 px (`NUDGE`), as a keyboard's do
  ([`READER.md`](READER.md), "Scrolling on a PC"): a remote has no Ctrl for
  Ctrl + ↓ / ↑, so this is its one nudge.
- **OK brings it up with focus on the page scrubber**: the reader focuses the
  scrubber once the chrome is laid out. ↓ then reaches the cells; the widest
  of them, READING, is the one that lands under the scrubber's middle.
- **The scrubber keeps ← →.** It is `data-focus-adjust`, so a left or right
  scrubs the chapter (one page, the step the track's own keys take) and ↑ ↓
  still leave for another cell.
- **The chrome's cells say the mark goes inside** (`data-focus-mark="in"`), so
  the frame never crosses the hairlines: the back cell, the languages and
  FAV/+ ADD, the chapter cells either side, READING, SHIFT PAIRING and FULL
  SCREEN.
- **READING is a focus scope and a 420 px panel from the right.** It opens on
  the mode in use; ← → step along a row's values, ↑ ↓ move between rows, OK
  takes a value. It is the tablet's sheet with segmented controls, which
  costs the same number of presses as one adjusting row per setting and
  keeps CROP BORDERS, WIDE PAGES, SIDES, ZOOM, BLOCKS and the rating. The dim
  slider is `data-focus-adjust` too, so it keeps ← → and ↑ ↓ leave it. On a
  tablet the sheet is inside the opted-out reader, so the scope does nothing
  there, **except at the end page**, where both readers lift the opt-out on
  every device ("Limits").
- **BACK closes READING and puts the pad back on the cell that opened it**,
  then hides the chrome, then leaves. That is the reader's step; the focus
  return is the scope's.
- **The text reader is the same** (`TextChrome`, `TextSheet`): OK brings its
  chrome up with focus on the scrubber, ↓ reaches CONTENTS and READING, and
  LAYOUT changes by keys alone, as DIRECTION does (↓ from LAYOUT, ← → along
  it; in R→L the remote's ← then reads on). Its footer gives way to the sheet
  (`bottom={!sheet}`), so the cell that opened READING is gone when it closes:
  the reader puts the pad back on the scrubber instead (`TextReader.svelte`).
  CONTENTS is a focus scope too: it opens on the row being read, and BACK puts
  the pad back on the CONTENTS cell, which stays. The text reader's end lifts
  the opt-out as the image reader's end page does: the last volume's end is
  the end page, with its cells, and a volume whose next chapter isn't
  downloaded ends on END · LAST AVAILABLE, whose rating, FAV, ← SERIES and
  LIBRARY the pad reaches, marked inside.

## MOVE

[`MOVE.md`](MOVE.md): the SOURCE row's MOVE → and MOVE BACK, the NO VIDEO
band, the candidates and the comparison and the MOVE bar are all stops, and
BACK climbs the comparison to its top bar before it leaves. The player's NO
SERVER interstitial and the END page's ANOTHER SOURCE → are reachable because
the pad is live whenever the picture is not. Its panels draw the mark inside
their ruled cells.

## The app

[`TV-APP.md`](TV-APP.md) is the app's own document; this is what it adds to
the TV.

- **The app** (`android/`, Kotlin): a leanback launcher entry and a 320×180
  wordmark banner drawn from `banner/tv-banner.svg`, a WebView that is the
  whole screen, `FLAG_KEEP_SCREEN_ON` while it is in front, cookies flushed on
  pause so a paired TV stays paired, fullscreen video through
  `onShowCustomView`, autoplay without a gesture, cleartext http through a
  network security config, and a user agent that ends `TsundokuTV/<version>`.
  `minSdk` 23, `targetSdk`/`compileSdk` 36.
- **BACK is the app's**, through `OnBackPressedDispatcher`:
  `window.tsundokuBack()` first, then `canGoBack()`/`goBack()` for the app's
  own pages and history, then leaving.
- **MENU and the media keys** are taken before the WebView and delivered as
  the DOM keys the focus layer and the player read (`ContextMenu`,
  `MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaTrackNext`,
  `MediaTrackPrevious`, `MediaPlay`, `MediaPause`), dispatched at the focused
  thing, bubbling. The D-pad and OK are the WebView's own and are not touched.
- **The scale.** A TV that reports 1280×720 is pinned to 960 CSS px wide, so
  the TV query runs on a 720p panel as on a 1080p one. `useWideViewPort=false`
  and `WebView.setInitialScale` take the display width in physical pixels (the
  unit `setInitialScale` counts in) and scale it to 960
  (`android/.../Scale.kt`, unit-tested): 133% on 1280×720, 200% on
  1920×1080, at any density.
- **The app's own pages use the TV's system font, not Plex.** A WebView on a
  TV has Roboto, the APK ships no typeface, and the welcome, address and
  nothing-answers screens are three short screens; the wordmark is the one
  place it shows. `/pair/tv` is part of the web app and does use Plex.
- **Release**: `ops/release/tv-apk.sh <version>` builds the APK from the tag,
  beside the bundles (release-signed from `TSUNDOKU_TV_*` when the keystore is
  there, a `-debug` APK otherwise) and adds it to the release folder's
  `SHA256SUMS` ([`RELEASE.md`](RELEASE.md)). `yarn run release` does not build
  it.

## Pairing

- **The screens.** The welcome, the address and the nothing-answers screens
  are the app's own pages in its assets, styled with the token values copied
  in; the bridge gives them the TV's own IPv4, a probe of a candidate (the web
  app manifest, which only tsundoku answers) and the address that answered.
  The address screen writes the TV's network prefix and tsundoku's port, so
  only the last number is typed, in one visible field; TYPE THE WHOLE ADDRESS
  is for Tailscale or another port. The nothing-answers screen's band keeps
  its meta ("TRIED N · LAST N S AGO · STILL TRYING EVERY 5 S") on one line at
  14 px, because at 15 px it is 20 px wider than 960 gives, rather than
  truncating the address. The six-digit and paired screens are the computer's
  `/pair/tv`, so the code is posted same-origin and the paired cookie is set
  as `/pair/<code>` sets it; its six digits are six cells, and it draws a band
  for a wrong try (with the tries left), a burned code and an expired one.
- **The six digits** (`src/lib/server/pairing.ts`, `TvPairing`): a second
  code beside the phone's link, made with `crypto.randomInt`, 10 minutes, one
  TV, once, compared by digest, and **five wrong tries burn it**. The WI-FI
  panel shows them in two threes under FOR THE APP · SIX DIGITS (the phone
  app shares them), with their own countdown; NEW CODE and opening SETTINGS
  replace them. `/pair/tv` answers ok, wrong (with tries left), expired, used
  and burned, and a TV that opens the page before anyone opened SETTINGS gets
  a code made for it ([`WIFI.md`](WIFI.md), "A TV's code, typed with a
  remote"). On a token install served on the tailnet the same six digits sit
  in SETTINGS › 08 — DEVICES, and the cookie they set signs the TV in on the
  instance's public host, never at localhost.
- **Reaching the server**: on launch, an address handed to the app from
  outside (an `am start` extra or a `tsundoku://connect?url=` link) is shown
  on the address screen, neither probed nor stored until CONNECT is pressed,
  and then opens the pairing at that address (one already among the TV's
  servers is probed and opens its library, with no question); the last used
  server that answers opens its library; one that stops answering shows the
  nothing-answers screen for it, with the TV's other servers offered beside
  it, and keeps probing; a first run with neither shows the welcome screen.
  An address is added to the TV's list of servers in `SharedPreferences` once
  it answers, never before, and never in place of another.
- **Servers**: the TV keeps every server it has paired with, each with its
  own cookie, and switches from MORE › SERVERS; adding one is the address
  screen as ADD A SERVER, and a launcher shortcut per server opens it.
  [`TV-APP.md`](TV-APP.md), "Servers", has the screens, the store and what is
  not verified.

## Tests

- A `tv` Playwright project at 960×540 with no pointer and no hover
  (Chromium's `--blink-settings=availablePointerTypes=none,availableHoverTypes=none`;
  `tests/tv-layout.e2e.ts` proves the query and the variables, so the launch
  configuration cannot rot silently). `library-layout`, `series-layout` and
  `reader-layout`'s device tables have a `tv` row; `tests/tv-screens`,
  `tv-reader` and `tv-series` cover the focus line, the panel, search, reveal,
  spreads and the rating keys.
- `tests/tv-library-frame.e2e.ts` and `tests/tv-series-frame.e2e.ts` are
  generated frame specs ([`TESTING.md`](TESTING.md), "Regenerating the frame
  spec"). Their one hand-edit is the import: `./fixtures`, whose `page.goto`
  waits for hydration. With `@playwright/test`'s own `test` they clicked
  server-rendered tiles before SvelteKit had answered, and one of them failed
  about every third run of the `tv` project. Regenerating reverts it; the
  generator should emit that import.
- `tests/focus-keys.spec.ts` is the pure half of the remote (which key is
  BACK, and OK's press-versus-hold); `tests/tv-keys.e2e.ts` holds OK on a
  cover, a chapter row and a history row, MENU, BACK's climb,
  `window.tsundokuBack()`, and ▶❚❚ on a CONTINUE card; `tests/tv-move.e2e.ts`
  walks MOVE's candidates and its comparison, and `tv-reader` covers the end
  page.
- `tests/tv-player.e2e.ts` walks the player's bar, its 420 px panel, SKIP
  INTRO, the media keys and the next episode: the bar's ← → and ↑ from its
  cells, a hidden bar's seek, PLAY NOW and STAY, SKIP's focus and its going,
  the chrome's auto-hide handing the pad back to the card, a revealed bar
  keeping ▶❚❚ while SKIP is offered, and the Work card's ↓, ↑ and ← →, on a
  database and preview of its own with a Work made in SQL. `tv-player` and
  `tv-move` run against the browse world's server (the fake engine is where a
  video and a candidate are) and read in incognito, so the flow files beside
  them keep the database they assert on.
- `tests/tv-reader.e2e.ts` opens READING, walks to L→R with the arrows and OK,
  closes it with BACK, hides the chrome, and puts the mode back;
  `tests/tv-text-reader.e2e.ts` does the same with a novel's LAYOUT and its
  DIRECTION. Both read in incognito and change nothing stored: the mode, the
  layout and the direction are this session's until REMEMBER, which neither
  spec presses, so there is nothing to put back.

## Limits

- **HISTORY, SETTINGS, BROWSE, DOWNLOADS, the person page, HELP and the rest**
  get the query's type scale and 420 px panels, but no layout of their own.
  HISTORY takes the pad (its rows are links and its REMOVE is a held OK) but
  has no TV frame.
- **READING at the end page is a scope on every device.** Both readers lift
  their opt-out at the end on a tablet as well as a TV, so the sheet's
  non-forced scope applies there off a TV too. It is harmless (a tap still
  lands; the scope only adds focus and a trapped Tab); a TV-only scope would
  need an option in `src/lib/focus/`.
- **MOVE has no TV layout.** Its screens take the pad and the mark, and the
  comparison and the MOVE bar are the one-pane shape below 1024 px, which a
  960-wide TV gets.
- **Japanese lookup on a subtitle line** has no way in from a remote.
- **Real hardware.** What has and has not been checked on a television (HLS
  in a low-end box's WebView, the 960 px pin on other panels, a remote with
  no number keys, a signed build) is in [`TV-APP.md`](TV-APP.md).
- **A `.local` name** that survives a new router address does not exist
  ([`WIFI.md`](WIFI.md), "Limits").
