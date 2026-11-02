# tsundoku on a TV

Status (2026-11-02): **the focus layer (c234), the ten-foot layout (c238),
the remote's keys (c235) and the Android app (c236) are built.** Every thing a
finger or a keyboard letter reaches is reachable from a D-pad, OK pressed or
held, MENU, BACK and the media keys; a WebView that keeps BACK to itself has
`window.tsundokuBack()` to call; and on a TV that is the app's own back key.
The app is a Kotlin WebView under `android/tv/`, with a launcher banner, the
remote's keys passed through, the screen kept awake, and a six-digit code a
remote can type ([`TV-APP.md`](TV-APP.md)). The handoff is mirrored in
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
- **OK held and MENU open the focused thing's options**, through the same
  `contextmenu` a finger's long press has always sent: a cover tile's sheet in
  the library and the books grid, the page menu, a chapter or episode row, a
  history row (c235).
- **BACK closes what is open, then climbs, then leaves**: a sheet or panel
  first; then the shelf's tab and the first CONTINUE card on the library, the
  panel's ▶ CONTINUE on a series, the bar on a player; then
  `window.tsundokuBack()` says nothing took it and the app leaves. The climb
  only goes somewhere out of sight (the owner's call, 2026-11-02): with the
  top of the screen in full view, BACK leaves at once.
- **The player is the picture until a key**, then six cells on one row with
  focus on ▶❚❚: ▶❚❚, −10, +10, ← EP. n, the cell naming the stream (the
  settings panel), EP. n+1 →. SKIP INTRO takes OK while it is offered alone.
  ▶❚❚ ⏩ ⏪ ⏭ ⏮ (`MediaPlayPause`, `MediaFastForward`, `MediaRewind`,
  `MediaTrackNext`, `MediaTrackPrevious`) work on every device, and on the
  library ▶❚❚ resumes the focused CONTINUE card there and then, without the
  series screen (c235).
- The player's letter keys stay for keyboards: Space, ←/→ seek 10 s, ↑/↓
  volume, F, M, C, S, N, ?
  (`src/routes/read/[entry]/VideoPlayer.svelte`).
- The image reader turns pages on the arrows and PageUp/PageDown; OK shows its
  chrome, OK held or MENU opens the page menu, BACK closes the menu, then the
  chrome, then leaves (`ImageReader.svelte`).
- Back walks history and the library restores its place
  ([`NAVIGATION.md`](NAVIGATION.md)).
- Serving to the home network and pairing ([`WIFI.md`](WIFI.md)), over plain
  http, and a six-digit code a remote can type, beside the phone's QR (c236).

## The work

| Card | What                                                            | Waits on   |
| ---- | --------------------------------------------------------------- | ---------- |
| c232 | How the TV reaches the server, and signs in without a camera    | the owner  |
| c233 | The ten-foot design, from [`briefs/TV.md`](briefs/TV.md)        | the design |
| c234 | D-pad focus: moving by direction, and focus you can see         | nothing    |
| c235 | The remote's way into long-press sheets; the player on screen   | c233       |
| c236 | The Android TV app, a Kotlin WebView wrapper                    | c232       |
| c238 | The ten-foot layout: the query, library, series, reader, search | c234       |

The owner settled c232 on 2026-11-01: **option A, Wi-Fi plus a typed code**, and
c236 built it (below).

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
through a phone's camera, which a TV hasn't got. c232 settled it on **WI-FI as
it is plus a code typed with a remote**: the app keeps the screen awake, the
computer shows six digits beside the phone's QR, and the TV types them
([`TV-APP.md`](TV-APP.md), [`WIFI.md`](WIFI.md)).

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

### Claims, now checked

The handoff stated these about the code or the app; both are built (c236).

- **"A TV that reports 1280×720 is pinned to 960 wide by the app's WebView
  scale":** the app does that. `useWideViewPort=false` and
  `WebView.setInitialScale` take the display width in physical pixels (the
  unit `setInitialScale` counts in) and scale it to 960
  (`android/tv/.../Scale.kt`, unit-tested): 133% on 1280×720, 200% on
  1920×1080, at any density. Whether a particular panel honours it is
  unverified ([`TV-APP.md`](TV-APP.md), "What is not verified").
- **A six-digit code typed on the TV:** `src/lib/server/pairing.ts` now has a
  second code beside the phone's link: six digits from `crypto.randomInt`,
  10 minutes, one TV, once, compared by digest, and **five wrong tries burn
  it** (`TvPairing`). The computer's side is the panel's FOR A TV digits; the
  TV's is `/pair/tv` (9C and 9E).

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
  `TV-Series.dc.html`. Their one hand-edit (c235) is the import: `./fixtures`,
  whose `page.goto` waits for hydration. With `@playwright/test`'s own `test`
  they clicked server-rendered tiles before SvelteKit had answered, and one of
  them failed about every third run of the `tv` project once it grew to nine
  files. Regenerating reverts it; the generator should emit that import.
- **Tests (c235).** `tests/focus-keys.spec.ts` is the pure half (which key is
  BACK, and OK's press-versus-hold); `tests/tv-keys.e2e.ts` holds OK on a
  cover, a chapter row and a history row, MENU, BACK's climb,
  `window.tsundokuBack()`, and ▶❚❚ on a CONTINUE card; `tests/tv-player.e2e.ts`
  walks the player's bar, its 420px panel, SKIP INTRO, the media keys and the
  next episode; `tests/tv-move.e2e.ts` walks MOVE's candidates and its
  comparison, and `tv-reader` gained the end page. `tv-player` and `tv-move`
  run against the browse world's server (the fake engine is where a video and
  a candidate are) and read in incognito, so the flow files beside them keep
  the database they assert on.

### Departures from the handoff (c238)

- **The series' actions are not the mock's 3×2 grid.** `SeriesPanel`'s order is
  identity, the blocky rating slider with FAV, CONTINUE, then the DOWNLOAD,
  direction, SHELVES, TAGS, LINK, ABOUT and FILE rows. The handoff draws
  RATING / FAV / SHELVES / DOWNLOAD / FOLLOW as one closed 3-column block
  under CONTINUE. Rebuilding that block is a restructuring of a file card c139
  is editing; the rows are already a ruled block and every action is there, so
  the screen keeps them. (The rating row is `data-focus-adjust`, so ← → work.)
  The rows take the narrow column's layout on a TV, cells dropped under their
  row in equal columns, as on the phone and in the 440 px desktop column, and
  pad 16 px, not the screen's 48. The TV is 960 wide, so until 2026-11-02 it
  met neither narrow width and got the tablet's full-width rows: cells ran out
  of the column and over ▶ CONTINUE, and labels were cut
  (`tests/tv-series.e2e.ts`, "fits its 352px column"). c139 has since merged,
  so the mock's block is no longer blocked on it: card c248 ("TV: the series'
  actions as the design's 3×2 block, the other rows under MORE").
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

## What is built (c236)

The Android app that holds the page, and the pairing a remote can type.
[`TV-APP.md`](TV-APP.md) is the app's own document; this is what it adds to
the TV.

- **The app** (`android/tv/`, Kotlin): a leanback launcher entry and a 320×180
  wordmark banner drawn from `banner/tv-banner.svg`, a WebView that is the
  whole screen, `FLAG_KEEP_SCREEN_ON` while it is in front, cookies flushed on
  pause so a paired TV stays paired, fullscreen video through
  `onShowCustomView`, autoplay without a gesture, cleartext http through a
  network security config, and a user agent that ends `TsundokuTV/<version>`.
  `minSdk` 23, `targetSdk`/`compileSdk` 36.
- **BACK is the app's**, through `OnBackPressedDispatcher`:
  `window.tsundokuBack()` (c235's contract) first, then `canGoBack()`/
  `goBack()` for the app's own pages and history, then leaving.
- **MENU and the media keys** are taken before the WebView and delivered as
  the DOM keys the focus layer and the player read (`ContextMenu`,
  `MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaTrackNext`,
  `MediaTrackPrevious`, `MediaPlay`, `MediaPause`), dispatched at the focused
  thing, bubbling. The D-pad and OK are the WebView's own and are not touched.
- **The scale**: the page is pinned to the handoff's 960 CSS px
  (`Scale.kt`), so the TV query runs on a 720p panel as on a 1080p one.
- **Pairing, 9A–9E.** 9A (welcome), 9B (the address), 9D (nothing answers) are
  the app's own pages in its assets, styled to the handoff with the token
  values copied in; the bridge gives them the TV's own IPv4, a probe of a
  candidate (the web app manifest, which only tsundoku answers) and the
  address that answered. 9B writes the TV's network prefix and tsundoku's
  port, so only the last number is typed; TYPE THE WHOLE ADDRESS is for
  Tailscale or another port. 9C (six digits) and 9E (paired) are the
  computer's `/pair/tv`, so the code is posted same-origin and the paired
  cookie is set as `/pair/<code>` sets it.
- **The six digits** (`src/lib/server/pairing.ts`, `TvPairing`): one code
  beside the phone's, made with `crypto.randomInt`, 10 minutes, one TV, once,
  five wrong tries burn it, compared by digest. The Wi-Fi panel shows them in
  two threes under FOR A TV · SIX DIGITS, with their own countdown; NEW CODE
  and opening SETTINGS replace them. `/pair/tv` answers ok, wrong (with tries
  left), expired, used and burned, and a TV that opens the page before anyone
  opened SETTINGS gets a code made for it.
- **Reaching the server**: on launch, a remembered address that answers opens
  the library; one that stops answering shows 9D and keeps probing; a first
  run shows 9A. The address is remembered in `SharedPreferences` once it
  answers.
- **Release**: `ops/release/tv-apk.sh <version>` builds the APK beside the
  bundles (release-signed from `TSUNDOKU_TV_*` when the keystore is there, a
  `-debug` APK otherwise) and adds it to the release folder's `SHA256SUMS`
  ([`RELEASE.md`](RELEASE.md)). `yarn run release` is unchanged.

### Departures from the handoff (c236)

- **The app's own pages use the TV's system font, not Plex.** A WebView on a
  TV has Roboto, the APK ships no typeface, and 9A–9D are three short screens;
  the wordmark is the one place it shows. `/pair/tv` is part of the web app and
  does use Plex.
- **9D's band is one line at 14px for its meta.** The design's band holds the
  address and "TRIED N · LAST N S AGO · STILL TRYING EVERY 5 S" at 15px, which
  is 20px wider than 960 gives; the meta drops to the badge's 14 rather than
  truncating the address.
- **The address field is one visible cell, not a box per digit.** The design
  draws the last number inside a 110px field; the six digits on 9C are the
  design's six cells, because six numbers are six circles and one is one.
- **9C shows a band for a wrong try, a burned code and an expired one.** The
  mock has no such state (a TV in the mock always types right); the card asks
  for the tries left, so the band keeps the panel's idiom.

## What is built (c235)

The remote's keys, and the player on screen. `src/lib/focus/keys.ts` holds the
decisions (`isBackKey`, `isOptionsKey`, `OkPress`) and `layer.ts` wires them;
[`FOCUS.md`](FOCUS.md) has the layer's half.

- **OK held** is Enter down past 450 ms, the pointer's own hold
  (`src/lib/actions/longpress.ts`). It sends `contextmenu` to the focused
  thing, so every long-press sheet opens through the path it already had:
  `CoverTile` and `BookTile` (the tile's sheet), `use:longpress` (a chapter,
  episode or page row, a history row), `PageMenu`. A short press is the click a
  keyboard's Enter makes, on the release; a held release presses nothing; and
  `e.repeat` neither opens twice nor clicks. A thing with no options is simply
  pressed on the hold, so no press is dead.
  - A pointer's long press and a key's no longer share one flag: the click a
    finger's release makes is swallowed, and the _next_ key's click is not
    (it used to be, so the tile after a long-press sheet was one press behind).
  - `longpress.ts` is that shared hold; the tiles keep their own copies of it
    (they carry the tile's press-and-scroll cancel too).
- **MENU** (`ContextMenu`) sends the same event at once.
- **BACK** is Escape, `BrowserBack` and `GoBack`. It closes the open sheet or
  panel first (a scope closes itself; the player, the reader, the page menu and
  a history row's REMOVE register a step instead), then climbs — a grid's
  tiles to the active shelf tab, anything else to `[data-focus-start]` (the
  first CONTINUE card, the series' ▶ CONTINUE; the climb is the TV's only, a
  keyboard's Escape is not taken for it) — and at the top of the screen
  says nothing took it. **A climb only lands out of sight** (`inFullView` in
  `src/lib/focus/layer.ts`; the owner's call after the first real TV,
  2026-11-02, where BACK on a series cost a press to reach ▶ CONTINUE that was
  already on screen). The pinned shelf tab is always in sight, so on a
  scrolled library BACK goes straight to the first CONTINUE card and the page's
  top; with the top in full view it leaves.
- **Focus stays in sight under pinned bars.** `reveal` scrolls the focused
  thing on screen, then out from under whatever sticky or fixed bars cover it
  (found with `elementFromPoint` at its edges, stacked bars included: the
  library's focus line is pinned under its shelf tabs). Before 2026-11-02, ↑
  through the grid left each row under the tabs. `tests/tv-keys.e2e.ts` pins
  it.
- **OK held** is any keydown while OK is already down, whatever its `repeat`
  says: Android TV's WebView sends a held centre as a stream of keydowns, and
  restarting the hold on each meant it never fired (`OkPress.down`,
  `tests/focus-keys.spec.ts`). `BrowserBack`/`GoBack` then take the history step
  themselves; Escape is left to the browser, since it is also the way out of a
  filter panel, a lightbox and a typed field.
- **`window.tsundokuBack(): boolean`** is the same logic, installed by the
  focus layer. **This is c236's contract**: a WebView does not hand BACK to the
  page, so the app calls this from its own `onBackPressed`, and leaves or goes
  back natively only when it returns `false`. It is truthy whenever the page
  did something — closed a sheet, climbed a screen — and `false` only when
  there was nothing left to take. `tests/tv-keys.e2e.ts` and
  `tests/tv-move.e2e.ts` pin both halves.
- **The player** (TV-Board-Player): the picture until a key; then OK, ↑ or ↓
  brings the bar with focus on ▶❚❚, the six cells in the design's order
  (▶❚❚ · −10 · +10 · ← EP. n · the stream's own cell, which opens the settings
  · EP. n+1 →), 76px for the three on the left, on one row under a 60px
  scrubber, both bars' contents inside the safe margin. The bars themselves
  reach the screen's edges, the margin being their padding (28px top or
  bottom, 48px sides; the cells one framed row 48px in). Built first with the
  bars set 28px in, the picture showed above the top bar and under the cells
  on the first real TV (2026-11-02). The middle cluster is not
  drawn (it is the thumb's), and nothing changes off a TV. SKIP INTRO shows
  alone while offered and OK takes it. BACK hides the bar at once, then leaves
  for the series. The settings cell opens the 420px panel every sheet is, the
  picture playing at the left, focus on its first row; ←/→ move along a row,
  OK takes the value, BACK closes and gives focus back to the cell. A server
  that fails over redraws the panel's rows under the focus, so the panel takes
  it back rather than dropping the mark.
- **A remote's media keys**, on every device: ▶❚❚ plays or pauses, ⏩ ⏪ seek
  10 s with the flash, ⏭ ⏮ the next and the previous episode. On the library,
  ▶❚❚ on a focused CONTINUE card resumes it rather than opening its series.
- **The reader**: OK shows its chrome (Enter did nothing there before), OK held
  or MENU opens the page menu for the page in the middle of the screen (in a
  spread, the one a turn leaves behind), BACK closes the menu, then the chrome,
  then leaves. A keyboard's Escape is still the chrome's own toggle, as it was
  ([`READER.md`](READER.md)); a remote's BACK is the app's, and leaves. The page
  menu is a 420px panel from the right on a TV, and the page it means is framed
  in ink rather than the accent. The end page is the reader's one focusable
  screen: its cells are stops, so ANOTHER SOURCE → on a stale series is
  reachable.
- **MOVE** ([`MOVE.md`](MOVE.md)): the SOURCE row's MOVE → and MOVE BACK, the
  NO VIDEO band, the candidates and the comparison and the MOVE bar are all
  stops, and BACK climbs the comparison to its top bar before it leaves. The
  player's NO SERVER interstitial and the END page's ANOTHER SOURCE → are
  reachable because the pad is live whenever the picture is not.
  Its panels draw the mark inside their ruled cells.

### Departures from the handoff (c235)

- **The hold is 450 ms, not 500.** The card settles it on the pointer's own
  long press so a tile's sheet opens at the same speed from a finger and a
  remote; the design's "held 500 ms" is the same gesture drawn by eye.
- **Escape does not itself leave a screen.** At the top of a screen `back()`
  returns false, and only `BrowserBack`/`GoBack` then take a history step. On
  a TV BACK is the app's key (c236 calls `window.tsundokuBack()`), and in a
  browser Escape is also the way out of a filter panel, a lightbox and a typed
  field: taking it unconditionally would leave the page from under them.
- **The player's top bar keeps its + ADD and its ←**, which the mock draws as
  ← and the names: a browsing record has no other way to be added, and the
  card says not to change what other devices have.
- **The bar keeps the settings sheet's DIM and ALL SETTINGS →** rows. The
  mock's panel is QUALITY, SERVER, AUDIO, SUBTITLES, SPEED; the shipped sheet
  has two more rows, and a TV should not lose them.
- **`MediaTrackPrevious` works too.** The card names ▶❚❚, ⏩ ⏪ and ⏭; a remote
  with ⏮ means the previous episode, and the player has had a previous-episode
  cell all along.
- **The page menu is a 420px panel with an ink frame around the page it
  means.** The mock's own (7F) draws exactly that; the shipped menu was still
  a bottom sheet with an accent ring.

## What it does not do yet

- **The reader's chrome is not a focus row.** OK brings the chrome up, and the
  arrows still turn pages — the design's own exception — but its cells
  (the page scrubber, the chapter cells either side, READING) are not stops,
  so READING — mode, spreads, fit, dim — cannot be opened from a remote. Only
  the page menu and the end page are pad-driven inside the reader.
- **HISTORY, SETTINGS, BROWSE, DOWNLOADS, the person page, HELP and the rest**
  get the query's type scale and 420 px panels, but no layout of their own.
  HISTORY is the one the handoff names as likely to want one; it takes the pad
  (its rows are links and its REMOVE is a held OK) but has no TV frame.
- **MOVE has no TV layout.** Its screens take the pad and the mark, and the
  comparison and the MOVE bar are the one-pane shape below 1024 px, which a
  960-wide TV gets. The design set has no board for it: c139 predates the TV.
- **The library's rating and FAV are still not arrow stops** (c234's decision,
  unchanged): a cover is its cover, and its options are a held OK.
- **The app has never run on a television.** No emulator system image is
  installed on this machine and no device was at hand, so the APK is built and
  its pure parts are unit-tested, and that is all. HLS in a TV's WebView on a
  low-end box, the 960px pin on a real panel, a remote with no number keys, and
  a signed build are the unverified ones ([`TV-APP.md`](TV-APP.md)).

### Still open

- **Turning reveal on from a TV**: settled on 2026-11-01 -- it cannot be done
  from a TV (no fingerprint, no screen lock); `/reveal` says so and the
  computer turns it on.
- **How the TV reaches the server** (c232): settled on 2026-11-01 — WI-FI and a
  code typed with a remote — and built in c236. A `.local` name that survives
  a new router address is still not there ([`WIFI.md`](WIFI.md)).
- **HISTORY** may want a TV layout of its own later; drawn as is.
- **Japanese lookup on a subtitle line** with a remote: not designed.
