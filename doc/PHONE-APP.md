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
- **No screenshots.** `FLAG_SECURE` keeps the library out of screenshots and
  out of the recents thumbnail, which [`PRIVACY.md`](PRIVACY.md) says a PWA
  can never promise. It also means the owner can't screenshot the app.
- **The screen stays awake**, over plain http too, where the page has no
  wake lock ([`WIFI.md`](WIFI.md)).
- **Pairing with six digits**, the TV's, over a friend's Wi-Fi or a tailnet.

Offline reading is out of scope (the owner, 2026-11-04): over a friend's
plain-http Wi-Fi the WebView keeps the browser's rules, so a service worker
still needs https.

## One project, two apps

`android/tv/` builds both, as two product flavors of one Gradle project:

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
| Screenshots    | allowed                           | blocked (`FLAG_SECURE`)             |
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
cd android/tv
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
- **9C's PAIR → stays dim until the sixth digit**, which presses it; the TV's
  is pressable with a short code and says SIX DIGITS. A tap on the cells is a
  tap on the field they draw.
- **9D says when the phone is on mobile data**: the bridge's `network()`
  answers `home`, `data` or `none` (`Network.kt`), and reason 3 names the two
  ways out.
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

- **SETTINGS' side of the design waits for wave 24**: FOR THE APP · SIX
  DIGITS and ONE DEVICE, ONCE in the panel, a friend's panel led by THIS
  COMPUTER'S ADDRESS with FOR THE APP and FOR A BROWSER side by side, and the
  tailnet row writing out the whole address. `tests/friend-wifi.e2e.ts`, which
  pins today's words, is that wave's.
- **`android/tv/` becomes `android/`** once that wave's TV slot, which owns
  `tests/tv-app-pair.e2e.ts`, `TV-APP.md` and `TV.md`, has landed.
- **c591**, the two places the web app clips at 130%.

## What is not verified

Nothing here was run on a phone: this machine has no emulator image, and no
phone was at hand. Built, unit-tested and browser-tested only, specifically:

- **The insets on a device**: the cutout padding, the keyboard's padding on
  Android 15 and on 14 and older (where `adjustResize` still resizes), and
  whether `mandatorySystemGestures` still reports the home strip with the bars
  hidden. `InsetsTest` pins the arithmetic, not what a phone hands it.
- **`FLAG_SECURE`, `textZoom` and the day and night themes** on a phone,
  including whether `prefers-color-scheme` follows a switch made while the app
  is open (the activity handles `uiMode` itself, so it is not recreated).
- **`Network.state` on a phone on mobile data**: the interface names are the
  common vendors', read from documentation, not from this owner's phone.
- **SERVERS (c261) in MORE on a phone**: drawn by the web app for a TV, it
  appears wherever the bridge does; on a phone's MORE sheet it is untested.
- **The 130% check** was a browser approximation (font sizes multiplied by
  1.3), not the WebView's own `textZoom`.

## Tests

- `android/tv/app/src/test/`: `FormTest` (each row of Form.kt's table),
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
- `tests/tv-app-pair.e2e.ts`, `tests/tv-pair.e2e.ts`,
  `tests/tv-pair-origins.e2e.ts` and `tests/tv-devices.e2e.ts` pass as they
  were (the last with the TV's new `Android TV · app` label): the TV is
  unchanged.
