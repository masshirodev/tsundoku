# The phone and tablet app

tsundoku is a web app; on a phone or tablet it can now be held by its own
small Android app, as the TV's is. This is what that app is, how it differs
from the TV's, how to build it, and what has not been tried on a real phone.

Card c521 ("Phone and tablet app: tsundoku in its own Android app, paired the
way the TV is"). The brief was [`briefs/PHONE-APP.md`](briefs/PHONE-APP.md);
the design is the handoff `doc/design/handoff/PhoneApp-*.dc.html`, its
decisions in `PhoneApp-Calls.dc.html`. The TV app it shares everything with is
[`TV-APP.md`](TV-APP.md).

## Why an app, and not the browser

The owner read tsundoku on the phone and tablet through Hermit, an app that
wraps a site, and it brought browser habits along: chiefly zooming the app
itself, a pinch or a double tap scaling the whole page off its grid. The PWA
([`INSTALL.md`](INSTALL.md)) is still there and still works over the tailnet;
the app is for reading without a browser in between. Being native also buys
what a page cannot do:

- **Zoom is off.** Pinch and double tap do nothing (`setSupportZoom(false)`);
  the app's own pages add `touch-action: manipulation`.
- **Screenshots are allowed.** The first build set `FLAG_SECURE`, which
  [`PRIVACY.md`](PRIVACY.md) says a PWA can never promise; the owner had it
  taken out the same day (2026-11-05): Android's "this app doesn't allow
  screenshots" on every try cost more than the recents thumbnail it hid.
- **The screen stays awake**, over plain http too, where the page has no
  wake lock ([`WIFI.md`](WIFI.md)).
- **Pairing with six digits**, the TV's, over a friend's Wi-Fi or a tailnet.

Offline reading is out of scope (the owner, 2026-11-04): over a friend's
plain-http Wi-Fi the WebView keeps the browser's rules, so a service worker
still needs https.

## One project, two apps

`android/` builds both, as two product flavors of one Gradle project:

| Flavor   | Application id              | APK                          |
| -------- | --------------------------- | ---------------------------- |
| `tv`     | `dev.masshiro.tsundoku.tv`  | `tsundoku-tv-<version>.apk`  |
| `mobile` | `dev.masshiro.tsundoku.app` | `tsundoku-app-<version>.apk` |

Every line of pairing is shared (`src/main`): the address, the probe, the
attempts, the server list (c261), the bridge, BACK, the pairing page. What
differs is decided in one place, `Form.kt`, from the flavor's
`BuildConfig.FORM`, one tested function per difference:

| Decision       | TV                                | Phone and tablet                    |
| -------------- | --------------------------------- | ----------------------------------- |
| The page width | pinned to 960 CSS px (`Scale.kt`) | the page's own `width=device-width` |
| Text size      | 100%, whatever the TV says        | Android's font size, capped at 130% |
| User agent     | `TsundokuTV/<version>`            | `TsundokuApp/<version>`             |
| Remote keys    | MENU and the media keys           | none: a finger and the keyboard     |
| The cutout     | none to pad                       | padded natively (`Insets.kt`)       |

The few things that are manifest or theme live in each flavor's folder:
`src/tv` has the leanback entry, the banner and the landscape lock;
`src/mobile` has `adjustResize` and a dark and a light theme.

The Kotlin package and the namespace stay `dev.masshiro.tsundoku.tv` for both:
renaming them would move every file for no behaviour, and the application id
is what Android installs by. The bridge keeps its name, `TsundokuTV`, for the
same reason, and a better one: it is the contract the web app reads
(MoreSheet's SERVERS, the layout's server name), so the phone gets c261's
server list with no second bridge to keep in step.

## Build it

```sh
cd android
./gradlew assembleMobileDebug assembleTvDebug testMobileDebugUnitTest testTvDebugUnitTest
./gradlew --stop                 # always: a daemon outlives the build otherwise
```

The JVM tests run once per flavor: `FormTest`, `InsetsTest` and `NetworkTest`
are this app's, beside the TV's. A release is `ops/release/android-apk.sh`
([`RELEASE.md`](RELEASE.md), "The Android apps"); one keystore signs both.

## Install it

The APK, by `adb` (`adb install -r tsundoku-app-<version>.apk`) or as a file
opened on the phone (Android asks once to allow installing from that app). It
installs beside the PWA and beside Hermit; neither is touched.

## The camera band and the keyboard

The app targets SDK 36, so on Android 15 and later it is drawn edge to edge
whatever it asks, and its system bars are hidden besides: fullscreen, as the
design draws it. Two things follow, and neither is the page's to fix:

- **The page would start under the camera.** The web app never read
  `env(safe-area-inset-top)`: an installed PWA had Chrome keep it out of the
  cutout. A WebView reports the insets only on newer versions anyway.
- **The keyboard would cover the button pinned to its top edge.** Edge to
  edge, `adjustResize` stops shrinking the window for the keyboard.

So the activity pads the WebView itself, by what `Insets.padding` returns from
`WindowInsetsCompat`: the cutout on whichever side it is (the top in
portrait, a side when the phone turns), the keyboard at the bottom while it is
open, and the home gesture's strip while it is closed (the design's 16 px
above the gesture bar). The padding takes **the page's own colour**, so the
band reads as the page's edge, dark or light:

- the activity reads it when any page finishes loading (`SURFACE_JS`), the
  computed background drawn through a 1x1 canvas, since the light theme's
  paper computes as `oklch()`;
- the web app's layout says it again on every theme change
  (`src/lib/app/surface.ts`, watching `data-theme`), and the app's own pairing
  page on a light or dark switch;
- `PairingBridge.surface` takes only a solid `rgb()` or hex
  (`Insets.parseColor`); anything else leaves the band as it was.

Before any page has drawn, the band is the theme's: graphite, or the paper
`#f5f4ef` the web app's `theme-color` says when the phone is set to light.

### Drawn under the camera: the reader

A page can ask to run under the camera: the bridge's `edge(true)` drops the
cutout and gesture padding until the page says `edge(false)`, and every new
document starts padded again. Whether padded or not, the page is told the
band's and the gesture strip's sizes as `--app-inset-top`, `-right`,
`-bottom` and `-left` (CSS px, `Insets.css`), since a WebView reports
`env(safe-area-inset-*)` only on newer versions. `SHORT_EDGES` lets the app
into the cutout on Android 14 and older too, where a fullscreen window is
otherwise kept out of it.

The reader's manga and manhwa pages use it (the owner, 2026-11-05):

- **The pages run under the camera**, edge to edge, while the bars are down.
- **The top bar stays where it is**, below the band, its background extended
  up through the band (`padding-top: var(--app-inset-top)`), so the page
  never shows above it while the bars are up.
- **The bottom bar hugs the display's edge**, with no inset.

The image reader asks with `drawUnderCamera()` (`src/lib/app/surface.ts`) on
mount and gives the band back on leaving; `Chrome.svelte`'s top bar is
`64px + var(--app-inset-top)` tall with the band as its top padding. In a
browser the variable is unset and both bars are as they were.

## Text size

The WebView's `textZoom` follows Android's font size, up to 130%
(`Form.textZoom`). A bigger font is the reader's own choice; the cap is
because the web app's 60 px bars and clamped tile titles are fixed and clip
past it. A smaller font is honoured as it is.

The pairing screens are drawn to grow: every height is a min-height. The web
app's own screens were checked at 130% in a browser approximation on
2026-11-05, and two places clip: the library's tile titles and the series'
SHELVES label (card c591, "Phone app at 130% text: the library's tile titles
cut their second line, and the series' SHELVES label runs into its chips").

## Pairing

The TV's flow, 9A to 9E, with nothing new to learn
([`TV-APP.md`](TV-APP.md), "Pairing, 9A to 9E"): the same pages, the same six
digits from SETTINGS › 08 — DEVICES, the same `/pair/tv` and the same cookie.
The pages say the phone or the tablet where they said the TV, and reflow:

- **Under 600 px, the phone's column**: content from the top, the one action
  that moves you on pinned at the bottom, which is the keyboard's top edge
  when it is open. TSUNDOKU alone in the header, and a short step
  (`PAIR · 1 OF 2`).
- **From 600 px, the TV's arrangement in flow**, at the tablet's 24 px margin:
  the three steps across, buttons side by side under what they act on, 36 px
  under the header in landscape and 48 in portrait.

Which app is asking is told, not measured: a TV is pinned at 960 CSS px and a
tablet is wider, so the width alone can't say.

- **The app's own pages** (9A, 9B, 9D, and c261's S5, S7, S8, S9) ask the
  bridge's `form()` before they paint and set `data-form` and `data-device` on
  `<html>`. Every phone and tablet rule is under `html[data-form='mobile']`,
  so the TV's 960x540 frame is exactly what it was.
- **The computer's `/pair/tv`** (9C, 9E) reads the user agent
  (`appDevice`, `src/lib/settings/catalog.ts`): `TsundokuApp` is a phone or a
  tablet, as `pairedLabel` tells them apart, and anything else is the TV it
  was drawn for. `.mobile` carries the same two layouts.

The words come from the screen's short side, so a phone turned on its side is
still "this phone", laid out at the tablet's width.

What the phone does that the TV doesn't:

- **9B takes focus on arrival**, so the number keyboard opens at once. The TV
  never does (c247: its pad covers the buttons); a phone's keyboard pushes the
  page up instead. On a phone `http://` is dropped from the written prefix, so
  the field fits 360 at 130%.
- **The keyboard comes up by itself.** Android's WebView raises no keyboard
  for focus a script gives on arrival, so a page that focuses a field asks the
  bridge's `keyboard()` (`Form.raisesKeyboard`, never on a TV: c247). On 9C
  the app does it itself once `/pair/tv` has hydrated (`CODE_FOCUS_JS`), so
  the digits can be typed on any server, one older than this release
  included: its 9C was drawn for a TV alone, a 960 px frame squeezed into a
  phone, with a 1 px field no tap reached (found on the owner's phone,
  2026-11-05).
- **9C's PAIR → stays dim until the sixth digit**, which presses it; the TV's
  is pressable with a short code and says SIX DIGITS. On a phone the field
  lies over the six cells, so a tap on any of them is a tap on it.
- **9D says when the phone is on mobile data**: the bridge's `network()`
  answers `home`, `data` or `none` (`Network.kt`), and reason 3 names the two
  ways out. It answers only the app's own page and a known server's, as the
  list and the address do (c549; [`TV-APP.md`](TV-APP.md), "The store"):
  any other page reads an empty string.
- **A tablet's hardware keyboard** types digits wherever focus is, as a
  remote's number keys do, and Enter with nothing focused presses the
  screen's first button.
- **Light or dark** follows the phone's own setting before pairing (the
  flavor's day and night themes are what the WebView's
  `prefers-color-scheme` reads); once paired, the web app's theme rules.

### The home address on a phone

A phone has a cellular interface, and its IPv4 is often a carrier's 10.x:
private, so the TV's old rule would have offered it as 9B's prefix and sent
the phone looking for the computer on the carrier's network. `Network.homeV4`
skips cellular and tunnel interfaces by name (rmnet, ccmni, tun, wg, and the
rest) before the private-address test, Wi-Fi first. The TV's behaviour is
unchanged: it has nothing but `wlan` and `eth`.

## On the computer: SETTINGS › 08 — DEVICES

The six digits pair a TV, a phone or a tablet, so they are the app's:
**FOR THE APP · SIX DIGITS**, **ONE DEVICE, ONCE**
(PhoneApp-Computer.dc.html).

- **A friend's panel** (WI-FI on) opens on **THIS COMPUTER'S ADDRESS**,
  written as the app types it (the app takes its last number, a browser all
  of it). Under it, side by side: **FOR THE APP**, the digits first and larger
  (48 px), and **FOR A BROWSER · THE PHONE'S CAMERA**, the QR (182 px) for a
  phone without the app, saying that typing the address in a browser opens
  the sign-in page instead. **NEW CODES** makes both. On a phone's SETTINGS
  the two stack. The states the panel had (starting, Windows asking, no
  address, the address changed, used, expired, burned) are kept, in the new
  places.
- **The owner's tailnet row** is **THE APP**: the same block without the QR,
  and it writes out **THE WHOLE ADDRESS** the app types, the request's own
  origin, since a tailnet install has no last-number shortcut.

## In DEVICES

The app is a flag beside the device's kind, never a kind of its own: a phone
in the app is still a phone, as its screen says. `deviceLabel` writes the app
and its version where a browser's name would be
(`Android phone · app 2026.11.05`), and the row's label cell reads it back as
`PHONE · APP`, `TABLET · APP` or `TV · APP` (`deviceWord`, `isAppLabel`). No
migration: the label is the server's own words. A TV row written before c521
still says `Android TV · Chrome` and `TV` until the TV next checks in.

## Where it departs from the handoff

- **The camera band and the gesture strip are the app's padding**, not drawn
  inside the page as the mocks draw them (24 and 16): the app knows the real
  cutout, the page doesn't.
- **Boxes are border-box**, as the TV's pairing page always was, so a 44 px
  number cell is 44 with its rule; the mock's content-box draws 45.
- **No Plex**: the app's own pages ship no font, as the TV's never did, and
  use the phone's system faces. `/pair/tv` is the web app's and has Plex.
- **9C's cells are 47 px wide at 360**, not the 46 the calls mention: six
  equal cells in what is left of 360 after the 16 px margins, the six 6 px
  gaps and the 10 px between the threes (328 − 46 = 282, over six). They are
  never under 44.
- **NOT THAT CODE adds "· FIVE WRONG TRIES BURN IT" only on a phone or
  tablet**, as drawn; the TV's band is unchanged.
- **c261's own screens** (RENAME, ADD A SERVER, ADDED, and 9D's other
  servers) were not drawn for a phone; they take the column's rules as they
  are, the other servers stacked under the reasons.
- **Esc on a tablet's keyboard** does not go back: a page cannot press
  Android's BACK, and nothing here asks the bridge to.

## What is not done yet

- **c591**, the two places the web app clips at 130%.
- **9C's phone layout reaches a server with its release.** Until a friend's
  install, or the owner's, runs a bundle with c521, its 9C is the TV's; the
  app raises the keyboard there anyway (above).

## What is not verified

Nothing here was run on a phone: this machine has no emulator image, and no
phone was at hand. Built, unit-tested and browser-tested only, specifically:

- **The insets on a device**: the cutout padding, the keyboard's padding on
  Android 15 and on 14 and older (where `adjustResize` still resizes), and
  whether `mandatorySystemGestures` still reports the home strip with the bars
  hidden. `InsetsTest` pins the arithmetic, not what a phone hands it.
- **`textZoom` and the day and night themes** on a phone,
  including whether `prefers-color-scheme` follows a switch made while the app
  is open (the activity handles `uiMode` itself, so it is not recreated).
- **`Network.state` on a phone on mobile data**: the interface names are the
  common vendors', read from documentation, not from this owner's phone.
- **SERVERS (c261) in MORE on a phone**: drawn by the web app for a TV, it
  appears wherever the bridge does; on a phone's MORE sheet it is untested.
- **The 130% check** was a browser approximation (font sizes multiplied by
  1.3), not the WebView's own `textZoom`.
- **The reader under the camera on a phone**: `edge()`, `SHORT_EDGES` and the
  `--app-inset-*` variables are unit- and browser-tested; nothing here has
  seen a page drawn into a real cutout.
- **The friend's panel by eye**: its arrangement is asserted
  (`friend-wifi.e2e.ts`: the address above, the digits and the QR side by
  side, the QR's 182 px), but nobody has looked at it on a screen yet.

What the owner's phone has confirmed (2026-11-05, the first build): the app
installs and pairs, the page sits below the camera band, and zoom is off.

## Tests

- `android/app/src/test/`: `FormTest` (each row of Form.kt's table),
  `InsetsTest` (the padding in every combination, and which colours the band
  takes), `NetworkTest` (a carrier's 10.x never the home address), run for
  both flavors by `./gradlew testMobileDebugUnitTest testTvDebugUnitTest`.
- `tests/app-ua.spec.ts`: the user agent, `appDevice`, and the DEVICES label
  and cell.
- `tests/phone-app-pair.e2e.ts`: the app's own pages with a stand-in bridge
  saying `mobile`, at 360x780, 1280x800, 800x1280 and 780x360, with the
  handoff's measurements, the pinned buttons riding a shorter viewport (the
  keyboard), mobile data, the colour told to the app, and the TV's words
  unchanged when no form is said.
- `tests/phone-pair-route.e2e.ts`: `/pair/tv` as the phone app, 9C on a phone
  and a tablet and 9E reached with a seeded paired row, never spending the six
  digits the TV's specs pair with.
- `tests/phone-app-reader.e2e.ts`: the reader asks for the band and gives it
  back, its top bar reaches up through a 32 px band with its contents below
  it, and the bottom bar hugs the edge; in a browser the top bar is 64.
- The three run once, in the `phone` project (`PHONE_ONLY`,
  `playwright.config.ts`): each sets its own viewport.
- `tests/friend-wifi.e2e.ts`, `tests/settings-devices.e2e.ts`,
  `tests/tv-pair.e2e.ts`, `tests/tv-pair-origins.e2e.ts` and
  `tests/friend-tailnet.e2e.ts` follow SETTINGS' new words, and
  `friend-wifi` measures the friend's new arrangement.
- `tests/tv-app-pair.e2e.ts`, `tests/tv-pair.e2e.ts`,
  `tests/tv-pair-origins.e2e.ts` and `tests/tv-devices.e2e.ts` pass as they
  were (the last with the TV's new `Android TV · app` label): the TV is
  unchanged.
