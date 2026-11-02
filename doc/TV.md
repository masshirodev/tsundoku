# tsundoku on a TV

Status (2026-11-01): **designed; the focus layer is built (c234), the rest is
not.** The handoff is mirrored in `doc/design/handoff/TV*` (see "The design",
below). Parent card c231 ("Android TV: tsundoku from the couch, with a
remote") on the Tsundoku board; every card for it carries the `TV` label.
[`FOCUS.md`](FOCUS.md) is the layer that ships: arrows moving focus by
direction, a sheet as a scope, and the one focus mark. The TV media query, the
TV sizes and the remote's own screens are still to come (c235, c238).

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

| Card | What                                                          | Waits on   |
| ---- | ------------------------------------------------------------- | ---------- |
| c232 | How the TV reaches the server, and signs in without a camera  | the owner  |
| c233 | The ten-foot design, from [`briefs/TV.md`](briefs/TV.md)      | the design |
| c234 | D-pad focus: moving by direction, and focus you can see       | nothing    |
| c235 | The remote's way into long-press sheets; the player on screen | c233       |
| c236 | The Android TV app, a Kotlin WebView wrapper                  | c232       |

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

### Still open

- **Turning reveal on from a TV**: no fingerprint, no screen lock. The
  owner's call (not at all, a code confirmed on the phone, or only from the
  computer).
- **How the TV reaches the server** (c232): the pairing drawn is option A,
  but the card still waits on the owner.
- **HISTORY** may want a TV layout of its own later; drawn as is.
- **Japanese lookup on a subtitle line** with a remote: not designed.
