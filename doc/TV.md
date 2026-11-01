# tsundoku on a TV

Status (2026-11-01): **planned, nothing built.** Parent card c231 ("Android
TV: tsundoku from the couch, with a remote") on the Tsundoku board; every
card for it carries the `TV` label.

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
