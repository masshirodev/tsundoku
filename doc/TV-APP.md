# The Android TV app

tsundoku is a web app; on a TV it is held by a small Android app. This is what
that app is, how to build it, what it does with the remote, and what has not
been tried on a real television.

Card c236, under c231 ("Android TV: tsundoku from the couch, with a remote").
The web side is [`TV.md`](TV.md) (the layout, the focus layer, the remote's
keys); this app is only the container, plus the pairing a TV can type with a
remote.

## Why an app, and not the browser

Android TV has no Chrome, so tsundoku cannot be installed from a browser, and a
Trusted Web Activity needs Chrome too. A WebView app gets a launcher banner,
passes the remote's keys through, keeps the screen awake (which over plain
http the page cannot ask for), and can show a code the page sets as a cookie.

## What it is

`android/tv/` is a Gradle project in Kotlin DSL, the only Android in this
repository:

|                            |                                                                       |
| -------------------------- | --------------------------------------------------------------------- |
| Kotlin                     | 2.2.20                                                                |
| AGP / Gradle               | 8.13.0 / 8.14.3 (the pair Kumiko's Capacitor app already builds with) |
| `compileSdk` / `targetSdk` | 36                                                                    |
| `minSdk`                   | 23: old TV boxes, and nothing here forces higher                      |
| Package                    | `dev.masshiro.tsundoku.tv`                                            |

One activity (`MainActivity.kt`) and a WebView. The parts worth testing are
pure Kotlin and live beside it: `Keys.kt`, `Scale.kt`, `Address.kt`,
`Probe.kt`.

## Build it

```sh
cd android/tv
./gradlew assembleDebug test     # an APK and the JVM unit tests
./gradlew --stop                 # always: a daemon outlives the build otherwise
```

JDK 21 is what this machine has, and AGP 8.13 needs 17 or newer. The SDK is
`~/Android/Sdk` (`ANDROID_HOME` here); `local.properties` is gitignored.
Gradle's downloads go to `~/.gradle`; everything the build writes stays under
`android/tv/` and is gitignored. No APK is committed.

The unit tests cover the four pure pieces; there is no emulator system image on
this machine, so nothing instrumented runs.

## Install it

A debug APK, by `adb` over the network (Android TV's developer options enable
network debugging):

```sh
adb connect <tv-address>:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

or as a file: copy the APK to a USB stick, plug it into the TV, and open it in
the TV's own file manager (most TVs ask to allow installing from that app
once). Android TV also accepts `adb push` to `/sdcard/Download/` and a package
installer app.

The launcher shows **tsundoku** with the wordmark banner (320×180, drawn from
`android/tv/banner/tv-banner.svg`); the icon is the app's own 積.

## On launch

- **A remembered address that answers** opens the library directly. The answer
  is the web app manifest: `/manifest.webmanifest`'s name is tsundoku's, so a
  router, a NAS or another web server does not pass.
- **A remembered address that does not answer** shows 9D, what it tried and
  the three likely reasons, and keeps probing every 5 s.
- **No address at all** shows 9A, the app's first screen.

## Pairing, 9A to 9E

On the computer: SETTINGS › 08 — DEVICES › WI-FI ON. The pairing panel shows
the phone's QR **and, under a FOR A TV · SIX DIGITS label, six digits in two
threes** (`src/routes/settings/+page.svelte`), with their own countdown. A new
code lives for 10 minutes, pairs one TV once, and **five wrong tries burn it**;
NEW CODE makes another.

On the TV:

1. **9A** — what the app does, and the three steps. START →.
2. **9B** — the address, written for the TV: its own network's first three
   numbers and tsundoku's port (42143 unless the friend changed `PORT`), so
   only the last number is typed. TYPE THE WHOLE ADDRESS takes `host:port` or
   a full `http://…` for Tailscale or another port. NEXT probes it.
3. **9C** — the computer's own `/pair/tv`: six cells in two threes, the
   number keys type and ← erases, and PAIR → presses itself when the sixth
   arrives. A wrong code says how many tries are left.
4. **9D** — nothing answered: what it tried, when, and that it keeps trying;
   then the likely reasons, the third worked out from the TV's own address.
   TRY AGAIN, or CHANGE THE ADDRESS.
5. **9E** — paired. OPEN THE LIBRARY → is the computer's `/` on the TV.

9A, 9B and 9D are the app's own pages, in `app/src/main/assets/pair/`; 9C and
9E are the computer's route, so the code is posted same-origin and the paired
cookie is set exactly as `/pair/<code>` sets it for a phone (no CORS, no second
way to be signed in). The computer lists the TV as a DEVICES row because the
app appends `TsundokuTV/<version>` to the WebView's own user agent: `isTvApp`
(`src/lib/settings/catalog.ts`) reads it, and both the pairing and the
settings sync (`/api/devices/sync`) label the row "Android TV · Chrome". Its
_kind_ is still `desktop`: `devices.kind` has a CHECK that allows only phone,
tablet and desktop, and a TV kind is a schema rung of its own (c244).

The bridge (`PairingBridge.kt`) is what a `file://` page cannot do: the TV's own
IPv4 (for the prefix and 9D's third reason), a probe of a candidate, and
`SharedPreferences` for the address that answered. It is registered for the
whole WebView, so the paired web app could reach it too; the only caller in
this repository is the app's own pages, and the probe only fetches a URL it is
given (`/manifest.webmanifest`).

## The remote's keys

The page's focus layer ([`FOCUS.md`](FOCUS.md)) reads DOM keys, so the app's
job is to deliver them.

| Key           | Where it goes                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-pad, OK     | The WebView itself: arrows and Enter, the page's own keys.                                                                                                                                                                                                                                                                                       |
| BACK          | The app. `window.tsundokuBack()` first (a sheet, a climb); `true` means the page took it. Then `Back.kt`: on the library the app leaves; elsewhere it goes back to the nearest earlier screen, past sign-in, pairing, set-up and the app's own first screens, and with none it leaves. `OnBackPressedDispatcher`, never the deprecated override. |
| MENU          | Taken before the WebView: a synthetic `ContextMenu` keydown + keyup at `document.activeElement ?? document.body`, bubbling.                                                                                                                                                                                                                      |
| ▶❚❚ ⏩ ⏪ ⏭ ⏮ | The same, as `MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaTrackNext`, `MediaTrackPrevious`, `MediaPlay`, `MediaPause`. The WebView would take them as media transport otherwise.                                                                                                                                                   |
| Number keys   | Type into the focused field: the address's last number on 9B, the six digits on 9C. ← erases.                                                                                                                                                                                                                                                    |
| MIC           | The TV's own voice search sits outside the app; nothing here forwards it.                                                                                                                                                                                                                                                                        |

`Keys.kt` is the whole mapping, and `KeysTest.kt` pins it. A remote without
number keys has to use the TV's on-screen keyboard; the app does not force it
open (see Gaps).

## The rest of the settings

- **`FLAG_KEEP_SCREEN_ON`** while the activity is resumed, cleared on pause.
  Over plain http the page has no wake lock ([`WIFI.md`](WIFI.md)).
- **Cookies persist**: `CookieManager.flush()` on pause, so the paired cookie
  survives the app being killed.
- **The scale**: the handoff is a 960 CSS-px frame, so `useWideViewPort=false`
  and `WebView.setInitialScale` pin the page to 960 whatever the panel reports.
  The percent is in **physical pixels**, not dp (Chromium hands Blink
  `percent / dipScale / 100`, `android_webview/browser/aw_settings.cc`), so it
  is the panel's pixel width over 960: 133% on 1280×720, 200% on 1920×1080,
  400% on 4K, at any density. `Scale.kt` is the pure part; `ScaleTest.kt` pins
  it.
- **Video**: `onShowCustomView`/`onHideCustomView` put the fullscreen picture
  over the app, hiding the WebView, and BACK takes the picture down before it
  asks the page; `mediaPlaybackRequiresUserGesture = false`
  starts playback without an OK press.
- **Cleartext**: `network_security_config.xml` allows plain http (a home
  address has no certificate) and still checks the system's anchors for a
  friend's https tailnet name.
- **Leanback**: `LEANBACK_LAUNCHER` beside a plain `LAUNCHER` entry so it also
  installs on a phone for a look; `android.software.leanback` and
  `android.hardware.touchscreen` are `required=false`.
- **Fullscreen and immersive**: the system UI is hidden, and the theme has no
  action bar, so the page is the screen.

## Signing and the release

Without a keystore the script builds a **debug-signed APK named `-debug`**.
The real keystore is a secret that must outlive this machine, so it is the
owner's to create, and this repository never holds it. The four names are the
contract:

```sh
TSUNDOKU_TV_KEYSTORE=/path/to/tsundoku-tv.jks
TSUNDOKU_TV_KEYSTORE_PASSWORD=…
TSUNDOKU_TV_KEY_ALIAS=tsundoku
TSUNDOKU_TV_KEY_PASSWORD=…
```

Creating it (once, and kept backed up somewhere else — losing it means no
update can install over the old app):

```sh
keytool -genkeypair -v \
  -keystore ~/.config/tsundoku/tsundoku-tv.jks \
  -alias tsundoku -keyalg RSA -keysize 4096 -validity 10000
# store it in the password manager, never in the repository
```

Then:

```sh
ops/release/tv-apk.sh 2026.11.02
# /mnt/hdd2/tsundoku/release/out/2026.11.02/tsundoku-tv-2026.11.02.apk
```

The version also becomes `TsundokuTV/<version>`, the app's user agent. With no
keystore the file is `tsundoku-tv-<version>-debug.apk`; it installs over the
same app only if it is signed with the same key, so a debug build and a release
build from the keystore cannot update each other. The script appends the APK's
line to the release folder's `SHA256SUMS`, beside the bundles'; it does not
run `yarn run release` and does not change what that script does. See
[`RELEASE.md`](RELEASE.md).

`versionCode` is 1 and does not move: an install over an older build needs a
higher one, which is the release script's job when APKs start shipping to more
than one TV.

## What is not verified

Nothing here was run on a television: this machine has no emulator image, and
no device was at hand. Built, unit-tested and installed nowhere, specifically:

- **HLS in a TV's WebView on a low-end device.** The player is hls.js; whether
  a cheap TV's WebView decodes what a browser does is untested.
- **The 960-px pin on real panels.** The arithmetic is unit-tested, and the
  unit is read from Chromium's source; whether a particular TV's WebView
  honours `setInitialScale` with the page's `width=device-width` viewport meta
  present is not. Check `document.documentElement.clientWidth` reads 960.
- **The on-screen number keyboard** on a remote with no number keys: focusing
  the field does not open it, and the app does not call `showSoftInput`.
- **`onShowCustomView` over a real `<video>`**, the screen-awake flag, the
  immersive system UI, and the leanback banner's cropping on the home row.
- **The keystore and a signed build**: no keystore exists yet.
- **Installation by USB** on a TV's own file manager.

## Tests

- `android/tv/app/src/test/` — `AddressTest`, `BackTest`, `KeysTest`, `ProbeTest`,
  `ScaleTest` (18 tests), run by `./gradlew test`.
- `tests/pairing-tv.spec.ts` — the six digits: once, 10 minutes, five wrong
  tries burn it, the state machine's every answer.
- `tests/tv-pair.e2e.ts` — the computer's `/pair/tv` at 960×540 with no pointer:
  a wrong code spends a try, the right one lands on 9E, and five wrong ones
  burn it.
- `tests/friend-wifi.e2e.ts` — the Wi-Fi panel's FOR A TV digits, beside the
  phone's QR.

## BACK never left the app (2026-11-02)

The first fallback was `canGoBack()`/`goBack()`. On the owner's TV the
history still held the sign-in page, and going back to it sends a signed-in
visitor to the library again, so BACK on the library went round in a circle
and the app never closed. The library's shelf tabs each leave a history entry
too, so even without that BACK walked back through every shelf opened. Now
the library is home and BACK leaves from it; elsewhere `Back.steps` picks the
nearest earlier screen worth returning to (`BackTest`).
