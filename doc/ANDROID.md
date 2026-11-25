# The Android app

tsundoku is a web app; on an Android TV, phone or tablet it is held by a small
Android app of its own: one activity and a WebView, plus the pairing a remote
or a thumb can type, a list of the servers the device knows, and its own
updates. One Gradle project in `android/` builds it twice, as the TV's app and
as the phone and tablet one. This document is that app: what it is, how it is
built, signed and installed, how it finds and talks to a server, and what
differs between a TV and a phone.

The web side of a TV, the ten-foot layout the library draws and the focus
layer the remote moves, is [`TV.md`](TV.md) and [`FOCUS.md`](FOCUS.md). This
app is the container around it.

## Why an app, and not the browser

Android TV has no Chrome, so tsundoku cannot be installed from a browser
there, and a Trusted Web Activity needs Chrome too. A WebView app gets a
launcher banner, passes the remote's keys through, keeps the screen awake
(which over plain http a page cannot ask for), and can show a code the page
sets as a cookie.

On a phone or tablet the PWA ([`INSTALL.md`](INSTALL.md)) still works over a
tailnet; the app is for reading without a browser in between, and without the
browser's habits, chiefly a pinch or a double tap scaling the whole page off
its grid. Being native also buys what a page cannot do:

- **Zoom is off.** Pinch and double tap do nothing. The WebView is told so
  (`setSupportZoom(false)`), and the page says it too: in the app (the
  `TsundokuApp/` or `TsundokuTV/` token in its user agent) `src/app.html`
  pins the viewport to `minimum-scale=1, maximum-scale=1, user-scalable=no`
  before anything draws. The setting alone is not enough on every WebView
  build: the 2026.11.15 app could not be pinched on a Galaxy Z Fold6 but
  pinched every screen on a Xiaomi Pad 5 running LineageOS, whose WebView is
  LineageOS's own. A viewport whose scale is pinned holds on any Chromium.
  The pairing page the APK ships (`android/app/src/main/assets/pair`) pins
  its own in the file, with no user-agent check: it only ever opens in the
  app. The readers' zoom is untouched: it is the page's own (`--zoom`, drawn by
  the reader, doc/READER.md "Zoom"), not the WebView's. A browser keeps its
  pinch. `tests/phone-app-zoom.e2e.ts` pinches all three: the app, the
  pairing page, and a browser.
- **No rubber band at the ends.** A drag past a scroller's end does nothing,
  as in an app, instead of stretching the content and springing back as a
  web page does. Two halves: the WebView's own stretch, off natively
  (`overScrollMode = OVER_SCROLL_NEVER` in `MainActivity.configure`, both
  flavors), and the page's scrollers, which in the app say
  `overscroll-behavior: none` (`src/app.html` marks the root `data-app`, and
  `src/lib/styles/base.css` sets it there and on every element, over the
  sheets' own `contain`; the pairing page sets it in its file). A browser
  keeps its stretch and pull-to-refresh. `tests/phone-app-zoom.e2e.ts` checks
  the page half; the native half has no JVM test (the unit tests have no
  Android runtime), so it is checked on a device.
- **Screenshots are allowed.** The app does not set `FLAG_SECURE`, which
  [`PRIVACY.md`](PRIVACY.md) says a PWA can never promise anyway: Android's
  "this app doesn't allow screenshots" on every try costs more than the
  recents thumbnail it would hide.
- **The screen stays awake**, over plain http too, where the page has no wake
  lock ([`WIFI.md`](WIFI.md)).
- **Pairing with six digits**, over a friend's Wi-Fi or a tailnet, on every
  device the same way.

## One project, two flavours

`android/` is a Gradle project in Kotlin DSL, the only Android code in this
repository.

|                            |                                                     |
| -------------------------- | --------------------------------------------------- |
| Kotlin                     | 2.2.20                                              |
| AGP / Gradle               | 8.13.0 / 8.14.3                                     |
| JDK                        | 17 or newer (AGP 8.13's floor); bytecode targets 17 |
| `compileSdk` / `targetSdk` | 36                                                  |
| `minSdk`                   | 23: old TV boxes, and nothing here needs more       |

It builds two apps as product flavours of one dimension, `form`:

| Flavour  | Application id              | Release APK                  | `BuildConfig.FORM` |
| -------- | --------------------------- | ---------------------------- | ------------------ |
| `tv`     | `dev.masshiro.tsundoku.tv`  | `tsundoku-tv-<version>.apk`  | `"tv"`             |
| `mobile` | `dev.masshiro.tsundoku.app` | `tsundoku-app-<version>.apk` | `"mobile"`         |

Every line of pairing is shared, in `src/main`: the address parser, the probe,
the launch attempts, the server list, the bridge, BACK, and the pairing page
(`assets/pair/index.html`). What differs is decided in one place, `Form.kt`,
from the flavour's `BuildConfig.FORM`, one tested function per difference
(`FormTest`); an unknown value is the TV:

| Decision                | TV                                       | Phone and tablet                    |
| ----------------------- | ---------------------------------------- | ----------------------------------- |
| The page width          | pinned to 960 CSS px (`Scale.kt`)        | the page's own `width=device-width` |
| Text size               | 100%, whatever the TV says               | Android's font size, capped at 130% |
| User agent              | `TsundokuTV/<version>`                   | `TsundokuApp/<version>`             |
| Remote keys             | MENU and the media keys (`Keys.kt`)      | none: a finger and the keyboard     |
| The cutout and keyboard | nothing to pad                           | padded natively (`Insets.kt`)       |
| Raising the keyboard    | never for a page (it covers the buttons) | when a page focuses a field         |

The few things that are manifest or theme live in each flavour's folder, merged
over `src/main`'s manifest: `src/tv` has the `LEANBACK_LAUNCHER` entry,
`android.software.leanback` (`required=false`), the banner and the landscape
lock; `src/mobile` has `adjustResize` and a dark and a light theme
(`values/` and `values-notnight/`).

The Kotlin package and the namespace are `dev.masshiro.tsundoku.tv` for both:
renaming them would move every file for no behaviour, and the application id
is what Android installs by. The bridge keeps the name `TsundokuTV` on both for
the same reason and a better one: it is the contract the web app reads
(`MoreSheet.svelte`'s SERVERS, the layout's server name), so the phone gets the
server list with no second bridge to keep in step.

One activity (`MainActivity.kt`) and a WebView. The parts worth testing are
pure Kotlin beside it: `Address`, `Attempts`, `Back`, `BridgeGuard`,
`FailedLoad`, `Forget`, `Form`, `Given`, `Insets`, `Keys`, `LeaveWindow`,
`Network`, `Probe`, `Scale`, `Servers`, `Shortcuts`, and the updater's
`ReleaseCheck`, `Versions`, `B64` and `Updater`.

The main manifest asks for `INTERNET` and `REQUEST_INSTALL_PACKAGES` (the app
installs its own updates), declares `android.hardware.touchscreen` not
required (a TV has none), sets `allowBackup="false"`, and makes the activity
`singleTask`, exported, with a plain `LAUNCHER` entry (the phone's, and on a TV
a second one beside leanback's, so a TV build still installs on a phone for a
look) and the `tsundoku://connect` link ([below](#handing-the-app-an-address)).
Its `configChanges` include `orientation`, `screenSize` and `uiMode`, so a turn
or a light/dark switch does not recreate the activity.

## Building

```sh
cd android
./gradlew assembleTvDebug assembleMobileDebug testTvDebugUnitTest testMobileDebugUnitTest
./gradlew --stop                 # always: a daemon outlives the build otherwise
```

The SDK is found by `ANDROID_HOME` or a `local.properties`, which is
gitignored. Gradle's downloads go to `~/.gradle`; everything the build writes
stays under `android/` and is gitignored. No APK is committed.

The JVM unit tests run once per flavour ([Tests](#tests)); nothing
instrumented runs, since there is no emulator image in the build.

## Signing and releasing

A release is `ops/release/android-apk.sh`:

```sh
ops/release/android-apk.sh 2026.11.02                # both apps
ops/release/android-apk.sh 2026.11.02 --app tv       # or phone
ops/release/android-apk.sh 2026.11.02 --ref HEAD --out DIR   # a trial from any commit
```

`ops/release/tv-apk.sh <version>` is the same script with `--app tv`. It builds
the tag `release/<version>` in a clean detached worktree, never the working
tree, and refuses a version with no tag; `--ref` builds a trial from any
commit and needs its own `--out`, so a trial cannot land in a release's folder
under the names the publisher ships. The APKs go to
`$RELEASE_DIR/out/<version>/` (`RELEASE_DIR` defaults to
`/mnt/hdd2/tsundoku/release`), each one's line appended to that folder's
`SHA256SUMS` beside the bundles'. It does not run `yarn run release` and does
not change what that script does ([`RELEASE.md`](RELEASE.md), "The Android
apps"). Gradle is stopped and the worktree removed when it ends, whether it
succeeded or not.

The release keystore is a secret that must outlive any one machine, so the
repository never holds it. Four environment variables are the contract, and
one key signs both apps (the names keep the `TSUNDOKU_TV_` prefix):

```sh
TSUNDOKU_TV_KEYSTORE=/path/to/tsundoku-tv.jks
TSUNDOKU_TV_KEYSTORE_PASSWORD=…
TSUNDOKU_TV_KEY_ALIAS=tsundoku
TSUNDOKU_TV_KEY_PASSWORD=…
```

Creating it, once, and keeping it backed up elsewhere (losing it means no update
can install over the old app):

```sh
keytool -genkeypair -v \
  -keystore ~/.config/tsundoku/tsundoku-tv.jks \
  -alias tsundoku -keyalg RSA -keysize 4096 -validity 10000
# store it in a password manager, never in the repository
```

Without all four (and the file present) there is no release signing config,
and the script builds **debug-signed APKs named `-debug`**
(`tsundoku-tv-<version>-debug.apk`). An APK installs over the same app only if
it is signed with the same key, so a debug build and a release build cannot
update each other. In `build.gradle.kts` the alias and key password are read
into `tvKeyAlias` and `tvKeyPassword`, not `keyAlias` and `keyPassword`:
inside `create("release") {}` those names are the `SigningConfig`'s own (empty)
properties and would shadow them.

The version, passed as `-PversionName` (or `TSUNDOKU_TV_VERSION`, else
`1.0.0`), is the release's date version. It becomes the user agent's
`TsundokuTV/<version>` or `TsundokuApp/<version>`, and `versionCode` is that
date as `YYYYMMDDNN` (the `.N` suffix capped at 99; a name that is not a date
version is 1), so every release is newer to the installer than the one before.
`Versions.code` in the app is the same rule, and `VersionsTest` holds the two
together.

## Updates

The app updates itself from the release host (`BuildConfig.UPDATES_URL`, the
same host every installed computer checks; `TSUNDOKU_UPDATES_URL` at build
time points it at a test host), checking `latest.json`'s ed25519 signature
against tsundoku's release key, as a friend's computer does. Android 6 has no
ed25519 of its own, hence `net.i2p.crypto:eddsa`. SETTINGS shows it as THIS
APP, and the library offers it. [`UPDATES.md`](UPDATES.md), "The Android
apps", is the whole of it.

## Installing

A debug APK by `adb` over the network (Android TV's developer options enable
network debugging):

```sh
adb connect <tv-address>:5555
adb install -r app/build/outputs/apk/tv/debug/app-tv-debug.apk
```

or as a file: copy the APK to a USB stick, plug it into the TV, and open it in
the TV's own file manager (most TVs ask once to allow installing from that
app). Android TV also accepts `adb push` to `/sdcard/Download/` and a package
installer app. On a phone, `adb install -r tsundoku-app-<version>.apk`, or open
the file on the phone (Android asks once to allow installing from that app).
The phone app installs beside the PWA and any other browser wrapper and touches
neither.

The TV's launcher shows **tsundoku** with the wordmark banner (320×180, drawn
from `android/banner/tv-banner.svg`); the icon is the app's own 積 on graphite.

## The screens

The pairing and server screens are split between the app's own page
(`assets/pair/index.html`) and the computer's routes. These are the screens, and
what each is called in this doc:

| Screen name                                             | What it shows                                                 | Whose                                   |
| ------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------- |
| The first screen                                        | Welcome: what the app does and the three steps, START →       | the app's page (`#welcome`)             |
| The address screen                                      | The computer's address                                        | the app's page (`#address`)             |
| The code screen                                         | The six digits                                                | the computer's `/pair/tv`               |
| The not-answering screen                                | Nothing answers: what was tried, the likely reasons, retrying | the app's page (`#lost`)                |
| The paired page                                         | Paired, OPEN THE LIBRARY →                                    | the computer's `/pair/tv`               |
| The bar's server cell                                   | The library bar's `ON LIVING ROOM` cell                       | the web app (`src/routes/+page.svelte`) |
| SERVERS                                                 | The list of servers                                           | the web app (`MoreSheet.svelte`)        |
| A server's options                                      | What can be done with one server                              | the web app (`MoreSheet.svelte`)        |
| FORGET                                                  | Forgetting a server                                           | the web app (`MoreSheet.svelte`)        |
| RENAME                                                  | Renaming a server                                             | the app's page, `#rename=<origin>`      |
| MORE's SERVERS row                                      | MORE with its SERVERS row                                     | the web app (`MoreSheet.svelte`)        |
| ADD A SERVER                                            | The address screen, step `ADD A SERVER · 1 OF 2`              | the app's page, `#add`                  |
| The added screen                                        | A server added, in place of the computer's paired page        | the app's page, `#added=<origin>`       |
| The not-answering screen with the other servers offered | Nothing answers, with the other servers offered               | the app's page, `#lost=<origin>`        |

SERVERS, its options and FORGET are panels over the library, so they are the
web app's, reading the bridge at runtime, in the 420 px panel every TV sheet
is. RENAME and the add are whole screens, before or beside pairing, so they are
the app's own page, as the first screen, the address screen and the
not-answering screen are. The two halves talk only through
`window.TsundokuTV`.

The app's own page is served by `WebViewAssetLoader` at
`https://appassets.androidplatform.net/pair/index.html` on both flavours, never
as a `file://` page ([below](#the-apps-own-page)). It moves between screens by
its URL fragment, the entry points below: `#connect=`, `#ask=`, `#bad=`,
`#long=`, `#lost=`, `#add`, `#added=`, `#rename=`.

## On launch

- **An address given at launch** ([below](#handing-the-app-an-address)) is
  dealt with first, whether it came with a cold start or with a second
  `am start` on an app already open. One in the list is checked and opened;
  one that is not waits on the address screen for CONNECT
  ([below](#an-address-from-outside-is-asked-about)) and is never stored before
  that.
- **The last used server that answers** opens its library directly. The device
  keeps a list ([Servers](#servers)) and launch opens the one whose library was
  open last; there is no default to mark. The answer is the web app manifest:
  `/manifest.webmanifest`'s name must be tsundoku's, so a router, a NAS or
  another web server does not pass.
- **The last used server that does not answer** shows the not-answering screen
  for it, what it tried and the three likely reasons, keeps probing every 5 s,
  and offers the other servers beside the reasons (not answering, with other
  servers). It never silently opens another.
- **No server at all, remembered or given,** shows the first screen.

### Handing the app an address

Typing a tailnet name on a remote is worse than the six digits that follow it,
so the app also takes the computer's address from outside: a launch extra, or a
link carrying the same address. Both reach the app whether it is closed or
already open (`singleTask` sends the second launch to `onNewIntent`).

```sh
adb connect <tv-address>:5555          # once, if it is not connected
adb shell am start -n dev.masshiro.tsundoku.tv/.MainActivity \
  --es url https://zen.tailnet.ts.net:8443
```

A launcher, or another app that only has a URL, can use the link instead:

```sh
adb shell am start -a android.intent.action.VIEW \
  -d 'tsundoku://connect?url=https%3A%2F%2Fzen.tailnet.ts.net%3A8443'
```

`url` is the whole address, percent-encoded in the link. If both the extra and
the link are there, the extra wins: it is what the command above sends. Either
way, an address the device does not already have shows the question
[below](#an-address-from-outside-is-asked-about), and somebody at the device
presses CONNECT.

On a friend's install the same command takes that computer's own address, which
is also what a failing LAN probe leaves to type: `--es url
http://192.168.1.23:42143` (their `PORT` if they changed it). The whole address
is the one thing the address screen would otherwise ask for on a remote.

Only `http` and `https` with a host are accepted (`Address.intentOrigin`): a
tailnet name, a domain or an address, on a port from 1 to 65535 (a port of 0, or
one above 65535, is refused rather than rewritten to the default one). Only the
origin is kept: a path, a query and a fragment are dropped, and an address
carrying a username or password is refused. A bare `host:port` is not enough
here, although it is on the address screen: nothing was typed, and the command
can always give the scheme. `Given.kt` decides what the page does with what
arrived:

| What arrives                                        | Entry point | What the page does                                              |
| --------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| An address not in the list, by the link or by extra | `#ask=`     | The address screen with the field filled; nothing until CONNECT |
| An address already in the list                      | `#connect=` | Checks it, opens its library; stores nothing                    |
| One `Address.intentOrigin` refuses                  | `#bad=`     | The address screen's refused band                               |
| Not in the list and over 80 characters              | `#long=`    | The same band, saying it is the length                          |
| No address (the plain launcher entry)               | none        | Launch as usual                                                 |

- **Refused** lands on the address screen with its band: the field empty, the
  mark on NEXT, and the band saying
  `THAT ADDRESS WAS REFUSED · NOTHING WAS SAVED`. Its hint,
  `http(s)://HOST · NO LOGIN · PORT 1–65535`, names every rule
  `Address.intentOrigin` refuses by and no other: the scheme, a host, no
  userinfo (LOGIN is a username, a password or both, before an `@`), and a port
  in range when one is given. A string that is not an address at all fails the
  first two. The row does not wrap, and on a TV its monospace is 0.6 em a glyph
  (Roboto Mono and Droid Sans Mono alike), so the hint is short enough to sit
  beside the band's first line there; a longer wording,
  `http:// OR https:// WITH A HOST, NO USERNAME, PORT 1–65535`, fits a desktop's
  narrower font and cuts the first line off on a TV. A new address over 80
  characters breaks none of those rules, so its band says what it did break
  instead: `OVER 80 CHARACTERS IS TOO LONG TO READ`.
- **New** is asked about first. Once CONNECT is pressed and it answers, it is
  added to the device's servers (it does not replace the one in use) and opens
  the pairing at that address: the six digits on a tailnet instance or on a
  friend's.
- **Answered** and already in the list opens that server's library: its pairing
  is already in the WebView's cookie jar.
- **Not answered** shows the not-answering screen for that address and keeps
  trying. A previously remembered address is left alone, but the not-answering
  screen does not give up the given one by itself, and the launcher's icon does
  not bring the library back: the activity is `singleTask`, so tapping the icon
  while the app is open hands a plain MAIN intent to `onNewIntent`, which
  carries no address and changes nothing, and the device stays on the
  not-answering screen retrying the mistyped address. **BACK** is the way back:
  the page takes no BACK of its own there, so `Back.kt` goes to the nearest
  earlier screen past the app's own pages, which is the library when the app was
  open on it, and otherwise asks for the second press that leaves the app
  ([BACK](#back)). The next launch, with no address given, probes the last used
  server and opens its library.

The check is the address screen's own: the web app manifest, through
`PairingBridge`. Both `#connect=` and CONNECT on `#ask=` reach the one success
branch that stores, and neither adds a second probe.

#### Only the current attempt is answered

A given address supersedes a probe already in flight, and that probe's answer is
dropped, success included, so a launch cannot be overtaken by the address it
replaced. A question supersedes an attempt the same way. A refusal stops the
not-answering screen's retry before showing the band, so the band is not
replaced five seconds later by the old address's failure, and a probe still in
flight when the refusal arrives cannot replace it either: only a _failure_ is
dropped, so a late success still remembers and opens the pairing. A new attempt
clears the band first, because it is a new question, whether typed on the
address screen or handed in at launch. The band's flag is cleared at all three
ways into that screen (`probe`, `show`, `connect`), so a visible band always
means the refusal is still the attempt in hand; hiding the screen alone does not
hide the flag.

The activity keeps the same rule for the one probe it makes itself, the
remembered address's on a cold start. That probe can take up to six seconds
(`Probe.kt`'s 3 s connect and 3 s read, longer when a `.ts.net` name stalls with
Tailscale down), and a second launch handed an address inside that window
reaches `onNewIntent` and loads the address screen at once. `Attempts.kt`
numbers the two paths: the probe takes an attempt before it starts, `takeGiven`
takes the next, and the probe's answer is acted on only if its attempt is still
the latest. So the address screen for the given address is replaced neither by
the library at the remembered address nor by the not-answering screen naming an
address nobody handed in.

### An address from outside is asked about

An address that arrives by a `tsundoku://connect` link or the `url` extra and
is not in the list is shown and asked about before it is remembered; one typed
in the app is not; the link stays `BROWSABLE`. An origin in the list passes the
bridge's guard ([below](#the-bridge-and-its-guard)) for every read and write,
so storing one is a grant of trust, and a tapped link must not be able to make
it.

**Why the list decides and the intent does not.** Nothing about an intent says
who sent it. The activity is exported, so any app can name it and any browser
can fire the link, and Android reports no sender for a plain `startActivity`.
A shortcut's `setPackage` is one any caller can set too, so it proves nothing.
And the `url` extra cannot be exempt as "the documented command": a browser's
`intent://connect#Intent;scheme=tsundoku;S.url=https://evil;end` delivers
exactly that extra to the same filter. What does differ is whether anything
would be stored: an address in the list stores nothing when it opens, and
every live shortcut's address is in the list, because a shortcut is only made
from it. The cost is that the documented `am start` for a new computer needs
one press of CONNECT at the TV. The six digits that follow already need
somebody there.

**The question** is the address screen and its band, with no new layout. The
band says
`THIS ADDRESS CAME FROM A LINK · NOTHING IS SAVED UNTIL YOU PRESS CONNECT`, the
field holds the address, the hint writes it out again whole on two lines (the
address alone on the first, `BACK LEAVES WITHOUT SAVING IT` on the second, the
same 19 px gap above the buttons at the 960 frame as under the address screen's
ordinary hint), because a field clips a long host and the end of a host is what
says whose it is. NEXT reads `CONNECT →`. 80 characters is the address screen's
own limit for a whole address, and over it a new address is refused rather than
shown cut, with the length's band.

- **CONNECT is the typed path.** It probes the field, and an answer is stored
  once in the same success branch a typed address uses. What is in the field
  is what gets connected to: it can be corrected first.
- **The mark starts on the second button, not on CONNECT.** A link is opened by
  a press, so the next stray OK must not be the answer. That button is the way
  out: the address screen as START leaves it, the field empty.
- **BACK** returns to the library of the server in use, and with no server it is
  the app's to take: the first press only toasts and this page stays, so the
  question goes back to what it was before CONNECT, with CHECKING gone, CONNECT
  live and the mark on it. Neither saves anything, a CONNECT already pressed
  included: opening the library is a `loadUrl`, so this document runs on until
  that navigation commits, and an answer landing in that time is dropped. It
  neither stores the address nor puts the not-answering screen over the
  library's load.
- **A question does not outlive its entry point.** `settle()` takes `#ask=` off the
  history entry the moment it is read, as it does `#connect=`, so a history step
  into that entry shows the first screen rather than the question again. Were it
  replayed anyway, the worst it does is show the question: nothing is stored
  without the press.
- **It supersedes what was in hand.** A typed probe still out, or a CONNECT
  already pressed for an address that has since left the screen, has its late
  answer dropped. So does leaving the question while CHECKING, by the way out
  or by BACK. The same link twice asks twice; a link with another address
  replaces the question.
- **`#connect=` cannot store either.** Should it ever carry an address not in
  the list, the page asks instead, so that holds on the page by itself and does
  not rest on the activity and the page agreeing about the list.
- **Nor can `#lost=`.** `MainActivity.onReceivedError` writes it for any
  main-frame load that failed, without asking the list, so a page the WebView
  shows can name an origin by opening a closed port of its own, and an external
  link (`target=_blank` opens in the same WebView) whose host is down does the
  same by accident. The not-answering screen's retry stores what answers, so
  only a server in the list reaches the not-answering screen; any other origin
  gets this question, with no probe and no `remember` until CONNECT, and its
  band still says the address came from a link, because the address screen has
  no other wording to give it. A server remembered just before its `/pair/tv`
  failed is already in the list (`remember` is synchronous and runs before the
  navigation), so that path still reaches the not-answering screen.
- **The 80 characters hold in the page, for every way to the question.**
  `#lost=` comes from `onReceivedError` and never meets `Given.door`, and a
  question fills the field past its `maxLength`, so `ask()` itself refuses an
  address over `MAX_ASKED` (the same value as `Given.MAX_ASKED`; `GivenTest`
  holds the two together) with the length's own band. `#ask=`, `#lost=` and a
  `#connect=` for an address not in the list all come through `ask()`. A server
  in the list does not: nothing is asked about it, so one over 80 characters
  still reaches the not-answering screen and opens. A refusal does not take back
  a CONNECT already pressed: as with any refusal, only a late failure is
  dropped, and a late answer still pairs the address CONNECT was pressed for.

The list records nothing about how an entry got there, so an origin stored by a
link before this rule existed cannot be told apart. MORE › SERVERS › FORGET is
the remedy for one nobody recognises.

### Origins

An address is compared by its **origin**, not its text. The address screen's
field keeps what was typed (a path, a query, userinfo, a differently cased host)
while `PairingBridge` answers with `Address.originOf`'s origin. Both sides of
the comparison go through `new URL(…).origin` (the page's `atOrigin`), so a
typed `https://zen.tailnet.ts.net:8443/library` and the bridge's
`https://zen.tailnet.ts.net:8443` are the same attempt and its success or
failure lands; comparing the raw strings would drop the answer and leave the
address screen on CHECKING with NEXT disabled.

What the app **stores** is `Address.originOf`'s origin, lower case in its scheme
and its host, as `intentOrigin`, Chromium's URL and the page's `location.origin`
all are. A host stored as typed (`http://Zen.local:42143`) would break
everything that compares: `BridgeGuard` would refuse the server's own pages
(they load at `http://zen.local:42143`), FORGET, RENAME, the probe and `named`
would do nothing from them, and `Servers.find` would miss it, so it would never
become the server in use. A scheme typed in capitals (`HTTP://…`, or `Http://…`
from a TV keyboard that capitalises the first letter) is read as a scheme twice
over, not given a second `http://`: the address screen's `origin()` tests it
without case (`/^https?:\/\//i`, the test `connect()` uses) before the probe and
`remember` see it, and `originOf` reads it without case after. A case-sensitive
test would turn `HTTP://Zen.local:42143` into `http://HTTP://Zen.local:42143`, a
host named `HTTP`, and the address screen would say NOTHING ANSWERS. The address
screen's CHECKING line and the not-answering screen's title strip the scheme
from what they print with the same case-blind regex, so a capitalised scheme
reads as its host on both.

Every place the APK compares an origin goes through `originOf` or agrees with
it: `BridgeGuard.allows` (the top-level URL through `originOf`; its scheme test
reads the scheme without case too, so `HTTP://…` is the same page as
`http://…`), `BridgeGuard.allowsMessage` (`ASSET_ORIGIN`, or `originOf` of a
known origin), `Servers.find`, `others`, `add`, `forget`, `move` and every
update (each cleans its argument through `originOf`), `FailedLoad` (fed by
`MainActivity.originOf(Uri)`, which lower-cases too, though Chromium's URL
already is), `PairingBridge.remember`, `probe` and `forgetOne`, and the
cookie's (`Forget.pairedCookie` reads only the scheme, lower-cased, and the
port; `CookieManager` matches hosts without case).
`BridgeGuard.refusesNavigation` and `refusesAssetRequest` read the asset host
without case too, and `carriesAssetToken` reads the launch's query token.

## Pairing

### On the computer: SETTINGS › 08 — DEVICES

The six digits pair a TV, a phone or a tablet, so they are the app's: **FOR THE
APP · SIX DIGITS**, **ONE DEVICE, ONCE**. A new code lives for 10 minutes,
pairs one device once, and **five wrong tries burn it**; NEW CODE (NEW CODES on
a friend's panel) makes another.

- **A friend's panel** (the WI-FI switch on; the digits only render with it on)
  opens on **THIS COMPUTER'S ADDRESS**, written as the app types it (the app
  takes its last number, a browser all of it). Under it, side by side: **FOR
  THE APP**, the digits first and larger (48 px, in two threes), and **FOR A
  BROWSER · THE PHONE'S CAMERA**, the QR (182 px) for a phone without the app,
  saying that typing the address in a browser opens the sign-in page instead.
  Each has its countdown, and NEW CODES makes both. On a phone's SETTINGS the
  two stack. The panel's other states (starting, Windows asking, no address,
  the address changed, used, expired, burned) are drawn in the same places
  (`src/routes/settings/+page.svelte`; [`WIFI.md`](WIFI.md)).
- **A tailnet instance** has no WI-FI row at all: the same six digits are the
  section's first row, **THE APP**, without the QR, and it writes out **THE
  WHOLE ADDRESS** the app types, the request's own origin, since a tailnet
  install has no last-number shortcut.

### The pairing screens

1. **The first screen**: what the app does, and the three steps. The first names
   the computer's SETTINGS › 08 — DEVICES and WI-FI ON for a friend's install,
   and says a Tailscale install has no switch to press: both truths, so neither
   install is sent to a section with no digits. The step's copy is kept short
   enough that the steps grid ends above START at 960×540 (a longer wording ran
   it to 413.75 against START's 400; `tv-app-pair.e2e.ts` checks the two boxes).
   START →.
2. **The address screen**: the address, written for the device: its own
   network's first three numbers and tsundoku's port (42143 unless the friend
   changed `PORT`), so only the last number is typed. On a TV the mark starts on
   NEXT, never on the field: a focused text field is what asks the WebView for
   the TV's number pad, and the pad opens over the bottom half of the screen,
   covering TYPE THE WHOLE ADDRESS (the one button a Tailscale user needs) with
   nothing on screen saying BACK would close it. The pad opens only when the
   mark is moved onto the field, which is the request to type. The number keys
   type into the field wherever the mark is, so a remote that has them never
   needs the pad; a remote without them reaches TYPE THE WHOLE ADDRESS in one
   press down, and the field is one press up. TYPE THE WHOLE ADDRESS takes
   `host:port` or a full `http://…` for Tailscale or another port; its hint says
   where the digits are, the computer's SETTINGS. NEXT probes it. An address
   handed in at launch that is in the list is probed the same way and skips this
   screen; one that is not stops here, filled in, until CONNECT is pressed. A
   pasted address with a path or a query pairs at its origin: the origin is what
   is probed, remembered and opened, never the whole string.
3. **The code screen**: the computer's own `/pair/tv`: six cells in two threes,
   the number keys type and ← erases, and PAIR → presses itself when the sixth
   arrives. A wrong code says how many tries are left. With a band, the band
   sits at 84 and is 56 high, so the section label moves from 108 to 164 and the
   cells to 204, the rhythm the not-answering screen keeps below its own band,
   and the buttons still end inside the frame (`tv-pair.e2e.ts` checks every
   band state's box ends above the label and the cells). An expired code is
   replaced on arrival: `/pair/tv` makes a fresh code when the only one has
   merely expired, and a burned one still needs the computer
   (`TvPairing.renewForTv`; [`WIFI.md`](WIFI.md), "A TV's code, typed with a
   remote").
4. **The not-answering screen**: nothing answered: what it tried, when, and that
   it keeps trying; then the likely reasons, the third worked out from the
   device's own address (on a phone, whether it is on mobile data). The second
   reason names both a friend's WI-FI switch and a tailnet install with no
   digits, so neither reads false. TRY AGAIN, or CHANGE THE ADDRESS. The reasons
   are at least 60 px high, not exactly: at 500 px wide the second wraps on a
   TV's font, and all three still end above TRY AGAIN.
5. **The paired page**: paired. OPEN THE LIBRARY → is the computer's `/`. On a
   first pairing it says nothing of other servers: with one server nothing
   changes.

The code screen and the paired page are the computer's route, so the code is
posted same-origin and the paired cookie is set exactly as `/pair/<code>` sets
it for a phone's browser (no CORS, no second way to be signed in). On a tailnet
instance the cookie signs the WebView in as a browser would: `hooks.server.ts`
accepts it in token mode on the instance's public host, so the device opens the
library instead of `/login` ([`SIGN-IN.md`](SIGN-IN.md)).

The computer lists the device as a DEVICES row because the app appends
`TsundokuTV/<version>` or `TsundokuApp/<version>` to the WebView's own user
agent ([In DEVICES](#in-devices)).

The bridge (`PairingBridge.kt`) is what the web page cannot do: the device's own
IPv4 (for the address screen's prefix and the not-answering screen's third
reason), a probe of a candidate, and `SharedPreferences` for the servers that
answered. It is registered for the whole WebView, so the paired web app reaches
it too (MORE › SERVERS), and every call that writes, probes or reads the list
asks first whether the page is the app's own or a known server's
([below](#the-bridge-and-its-guard)); the probe only fetches
`/manifest.webmanifest` at the address it is given.

### On a phone or tablet

The same pages, the same six digits, the same `/pair/tv` and the same cookie.
The pages say the phone or the tablet where they say the TV, and reflow:

- **Under 600 px, the phone's column**: content from the top, the one action
  that moves you on pinned at the bottom, which is the keyboard's top edge when
  it is open. TSUNDOKU alone in the header, and a short step (`PAIR · 1 OF 2`).
- **From 600 px, the TV's arrangement in flow**, at the tablet's 24 px margin:
  the three steps across, buttons side by side under what they act on, 36 px
  under the header in landscape and 48 in portrait.

Which app is asking is told, not measured: a TV is pinned at 960 CSS px and a
tablet is wider, so the width alone cannot say.

- **The app's own pages** (the first screen, the address screen, the
  not-answering screen with or without the other servers, RENAME, ADD A SERVER
  and the added screen) ask the bridge's `form()` before they paint and set
  `data-form` and `data-device` on `<html>`. Every phone and tablet rule is
  under `html[data-form='mobile']`, so the TV's 960×540 frame is untouched.
- **The computer's `/pair/tv`** (the code screen, the paired page) reads the
  user agent (`appDevice`, `src/lib/settings/catalog.ts`): `TsundokuApp` is a
  phone or a tablet, as `pairedLabel` tells them apart, and anything else is the
  TV it was drawn for. `.mobile` carries the same two layouts.

The words come from the screen's short side, so a phone turned on its side is
still "this phone", laid out at the tablet's width.

What the phone does that the TV does not:

- **The address screen takes focus on arrival**, so the number keyboard opens at
  once; a phone's keyboard pushes the page up rather than covering the buttons.
  On a phone `http://` is dropped from the written prefix, so the field fits 360
  px at 130% text.
- **The keyboard comes up by itself.** Android's WebView raises no keyboard for
  focus a script gives on arrival, so a page that focuses a field asks the
  bridge's `keyboard()`, which focuses the WebView and calls `showSoftInput`
  (`Form.raisesKeyboard`; never on a TV). On the code screen the app does it
  itself once `/pair/tv` has hydrated (`CODE_FOCUS_JS`, which waits for
  SvelteKit's announcer), so the digits can be typed on any server, including
  one whose code screen was drawn for a TV alone: a 960 px frame squeezed into a
  phone, with a 1 px field no tap reaches.
- **The code screen's PAIR → stays dim until the sixth digit**, which presses
  it; the TV's is pressable with a short code and says SIX DIGITS. On a phone
  the field lies over the six cells, so a tap on any of them is a tap on it. NOT
  THAT CODE adds `· FIVE WRONG TRIES BURN IT` on a phone or tablet only.
- **The not-answering screen says when the phone is on mobile data**: the
  bridge's `network()` answers `home`, `data` or `none` (`Network.kt`), and
  reason 3 names the two ways out. It answers only the app's own page and a
  known server's, as the list and the address do: any other page reads an empty
  string.
- **A tablet's hardware keyboard** types digits wherever focus is, as a
  remote's number keys do, and Enter with nothing focused presses the screen's
  first button.
- **Light or dark** follows the phone's own setting before pairing (the
  flavour's day and night themes are what the WebView's `prefers-color-scheme`
  reads); once paired, the web app's theme rules.

The app's own pages ship no font, on either flavour, and use the device's system
faces; `/pair/tv` is the web app's and has Plex. Boxes are border-box, so a 44
px number cell is 44 with its rule. The code screen's cells are 47 px wide at
360: six equal cells in what is left of 360 after the 16 px margins, the six 6
px gaps and the 10 px between the threes (328 − 46 = 282, over six); they are
never under 44. The server screens (RENAME, ADD A SERVER, ADDED, and the
not-answering screen's other servers) take the column's rules as they are, the
other servers stacked under the reasons.

### The home address on a phone

A phone has a cellular interface, and its IPv4 is often a carrier's 10.x:
private, so a plain private-address test would offer it as the address screen's
prefix and send the phone looking for the computer on the carrier's network.
`Network.homeV4` skips cellular and tunnel interfaces by name (`rmnet`, `ccmni`,
`pdp`, `clat`, `wwan`, `tun`, `wg` and the rest) before the private-address
test, Wi-Fi first. A TV has nothing but `wlan` and `eth`, so it is unaffected.

### In DEVICES

`isTvApp` (`src/lib/settings/catalog.ts`) reads `TsundokuTV/` in the user
agent, and both the pairing and the settings sync (`/api/devices/sync`) use it
for the row: a TV is kept as `tv` in `devices.kind` (migration 59), not as an
Android desktop. The app is a flag beside the device's kind, never a kind of
its own: a phone in the app is still a phone, as its screen says. `deviceLabel`
writes the app and its version where a browser's name would be
(`Android phone · app 2026.11.05`, `Android TV · app …`), and the row's label
cell reads it back as `PHONE · APP`, `TABLET · APP` or `TV · APP`
(`deviceWord`, `isAppLabel`). No migration is needed: the label is the server's
own words. A TV row written by an older APK says `Android TV · Chrome` and `TV`
until the TV next checks in.

## Servers

The device keeps a list of the servers it has paired with, and switches
between them as Jellyfin's TV app does.

- **One server: nothing changes.** Launch, pairing and the not-answering screen
  are as with no list. The one addition is a **SERVERS** row at the end of MORE,
  drawn only where the app's bridge exists, so a computer and a browser never
  see it. It reads `1 · ADD ANOTHER`, or with two or more
  `3 · LIVING ROOM IN USE`. MORE's own rows stay the house's (64 px, 15 px
  mono), not a 56 px panel action: SERVERS is one more row in the sheet every
  device shares.
- **Launch opens the last used.** A server becomes the one in use when its
  library has loaded (`MainActivity.onPageFinished`, any page of it that is not
  sign-in, set-up or pairing). If it does not answer, the not-answering screen
  for it with the others offered; never another.
- **Names.** A server is named by itself: its hostname, upper case, as
  `/pair/tv` says it. The app reads it from the paired page's `data-paired-name`
  attribute once it has loaded, falling back to its first line
  (`✓ PAIRED WITH ZEN · …`) for a server older than that attribute
  (`Forget.pairedNameFrom`), and the library's layout also says it to the bridge
  on every load (`data.computer`, sent only to the app's user agent), so a
  device paired before the list existed is named too. The cost of reading it
  from the paired page: the added screen replaces it once it has drawn, so the
  paired page shows for a moment first. **RENAME** keeps the device's own name
  for it, on the device only; emptied, the server's name comes back; never named
  at all, the row shows its address.

### On the remote

- **SERVERS** lists the one in use first (✓, IN USE in the accent), then the
  rest by when each was last opened, then `+ ADD A SERVER`. The mark lands on
  the first one not in use; with one server, on + ADD A SERVER. Each row is
  probed as the panel opens (CHECKING, then ● ANSWERS or ○ NO ANSWER), the
  answers landing as they come. OK opens that library at once (its pairing is
  its own cookie); on the one in use, OK closes the panel. The rows are ruled
  and the actions are 17 px mono.
- **MENU, or OK held,** on a row opens its options: ADDRESS, ITS NAME (NOT SAID
  YET until the server has said it), OPENED (TODAY, YESTERDAY, N DAYS AGO,
  NEVER), NOW, then OPEN →, RENAME and FORGET.
- **FORGET** is its own panel. The mark lands on KEEP IT; FORGET is ↓ then OK;
  for the first 0.6 s FORGET is disabled and KEEP IT ignores OK, so the tail of
  an OK held to open the options presses nothing. Forgetting the one in use
  opens the next that answers, else the next by when it was opened, whose
  not-answering screen offers the rest; forgetting the last returns to the first
  screen. FORGET disarms the moment it is pressed, so a second press (a double
  tap, a second OK) before the next server's page commits does nothing; and an
  answer that is not a list (the bridge's refusal, `""`) changes nothing and
  calls neither `open` nor `welcome`: only a real empty list is "the last one".
- **BACK** climbs: FORGET to the options (on FORGET), the options to the list
  (on that row), the list to MORE (on SERVERS), MORE closed. Opened from the
  bar's cell, the list has no MORE under it: BACK closes the panel and the mark
  is back on the cell, as focus goes back to what opened it.

### The bar's server cell

With two or more servers, the library's top bar says whose library this is:
`ON LIVING ROOM` after the wordmark. `ON` is in the second ink
(`tv_servers_on`: `ON`, `EM` in Portuguese), the name is the one the rows show
(`shown`: the device's RENAME, else the server's own, else its host), upper
case, clipped by an ellipsis at 180 px in a cell at most 200 px wide, with a
hairline either side.

- **When it is drawn.** `+page.svelte` reads `TsundokuTV.servers()` when the
  library mounts, again a tick later (the layout's own mount, which runs after
  the page's, has just told the app the server's name, so a server not named
  yet shows its name rather than its host), and again whenever MORE closes. No
  bridge, an APK with no `servers`, an answer that is not JSON, not a list, or a
  list with anything in it that is not a server (`origin` and `shown` strings,
  `inUse` a boolean), one server, or two of which none is in use: no cell, and
  the bar is as without it.
- **Which one is in use: the page's own server.** The bridge's `inUse` is the
  server with the newest OPENED, and the app writes OPENED only once a page has
  finished loading, so the library that mounts straight after a switch (SERVERS'
  OK, the not-answering screen's others, the added screen's OPEN →) reads a list
  whose `inUse` is still the server just left. The page knows better: `inUseOf`
  (`src/routes/servers-in-use.ts`) takes the entry whose origin is
  `location.origin` (the form the app stores, since the layout names it by
  `location.origin`), and falls back to the bridge's flag only when no entry is
  this page's. The cell, SERVERS' ✓ and IN USE, its arrival, OK on the one in
  use and FORGET all read it.
- **↑ reaches it.** From the library's start, ↑ lands on the cell. The wordmark
  is a link in this bar and stands over the shelf, so while the cell is drawn
  the wordmark carries `data-focus-skip`: it is not an arrow stop, and Tab and
  the pointer still reach it as the link home. With one server it is a stop as
  usual.
- **OK** opens MORE straight on SERVERS (`MoreSheet`'s `initial`), probing
  every row, the mark on the first one not in use, and the cell drawn pressed
  while the panel is up. BACK closes the panel onto the cell.
- **The list is read, not watched.** The bridge has no event, so a RENAME or
  FORGET made in the app shows in the cell the next time the library loads
  (RENAME is the app's own screen, so returning from it is such a load), or
  when MORE closes. FORGET from inside the panel that leaves one server takes
  the cell away as the panel closes, and the mark goes to MORE, the way that
  still leads to SERVERS.
- **The read awaits.** `readTvServers` awaits the bridge's answer, so a Promise
  is read when it lands; `refreshTvServers` drops an answer to an older
  question, and the three call sites (the mount, the tick and `closeMore()`'s
  hand-back) wait for it.

### Adding and moving

- **ADD A SERVER** is the address screen for the new computer's address: the
  meta line names who is already here, and BACK returns to the library in use,
  nothing changed. An address already in the list is not paired again: the band
  says `ALREADY IN SERVERS AS STUDIO · OPENING` and its library opens. A new one
  that answers is added and its pairing opens; after its six digits the app
  shows the added screen in place of the computer's paired page, with OPEN →
  focused and RENAME.
- **The not-answering screen's CHANGE THE ADDRESS** on a server in the list
  opens the address screen for that entry
  (`01 — LIVING ROOM'S NEW ADDRESS`): the new address that answers takes the
  entry's place, keeping the device's name for it, then pairs. It takes the
  place when it answers, not once paired: the old address's cookie is no use to
  the new one either way, and the answer is the one thing the page sees before
  it leaves for `/pair/tv`. A server back after not answering opens its
  library, not its pairing again.

### The store

`Servers.kt` is the list: one line per origin in the `pairing` prefs
(`servers`), with the server's name, the device's name, when its library last
opened and when it was added. Pure apart from its key-value store, so
`ServersTest` pins it.

- **Migration from one address.** A device with an `address` and no `servers`
  (an APK from before the list) is read as a list of one, opened now, so it
  opens exactly as before and is never asked to pair again: its cookie is the
  WebView's, and nothing touches it. `address` is kept in step with the last
  used on every write, so an older APK installed over this one still opens the
  same library.
- **One cookie name per server.** The jar keeps cookies per **host**, not per
  origin (port and scheme are not part of a cookie's scope), so each server
  names its paired cookie for its own port and scheme (`tsundoku_paired_42143`,
  `tsundoku_paired_s443`; `pairedCookie` in `src/lib/server/pairing.ts`), and
  two servers on one computer keep their own pairing. A jar holding the older
  shared name, `tsundoku_paired`, signs in by it on the first request to the
  server that set it, which moves it to that server's own name (`readPaired`);
  a server it is not paired with leaves it alone.
- **Every stored line is read through `Address.originOf`** (`Servers.decode`),
  so an entry written before a normalisation comes back normalised: one with
  its scheme's own port (`:443`, `:80`) or one typed with capitals. Two lines
  that then name one origin are one server, folded on read: the one opened last
  wins (then the one added last), as the list is ordered, and a server's name
  or the device's name that the winner lacks is taken from its twin, the way
  `move` carries the device's name across only onto an entry with none. The
  next write saves the folded list.
- **`remember()` adds**, never replaces, and never makes a server the one in
  use: an add left at the code screen does not take launch from the library the
  device was in.
- **FORGET** removes the entry and expires the cookies the WebView's jar sends
  that origin (`Forget.expiring`: each name written back with `Max-Age=0` at
  `/`, `Secure` on https), then flushes the jar, so adding it back pairs with
  six digits. The jar hands back every server's cookies on that host, so FORGET
  expires this origin's paired name, the old shared `tsundoku_paired`, and
  every cookie that is not a pairing, and never another origin's
  `tsundoku_paired_*` (`Forget.pairedCookie` names it as the server does; both
  read `android/app/src/test/resources/paired-cookies.tsv`). The computer still
  lists the device in SETTINGS › 08 — DEVICES until it is signed out there: the
  device may be off the network when it forgets.
- **Opening a server that fails** must not make it the one launch opens.
  `FailedLoad` marks a failed main-frame load, and that load's own finish
  consumes the mark, whatever came between, so it does not depend on the order
  WebView reports a failure in; the app's next `open` of that server ends a mark
  whose finish never came, so a server that comes back and opens is counted.
  `FailedLoad.finish` is `onPageFinished`'s decision: a failed `/pair/tv`
  consumes its mark, a loaded one is read for the paired page's name, and an
  unknown server is never a visit.

### The bridge and its guard

`PairingBridge.kt` is the object the WebView exposes as `window.TsundokuTV`.
Its KDoc has every method in a table. Beside pairing's calls it has
`servers()` (JSON, the one in use first), `open`, `rename`, `named`,
`forgetServer`, `move`, `addServer`, `renameServer` and `welcome`; `form`,
which says the flavour, and the phone's `keyboard`, `network`, `surface` and
`edge`; and the updater's `appUpdate`, `appCheck`, `appDownload` and
`appInstall` ([`UPDATES.md`](UPDATES.md)). Probes run four at a
time so a panel's rows answer as they land. Every page the WebView loads has
the bridge, which is how MORE reaches it; the list lives in the app, never in a
page.

**Only the app's pages and known servers' make the bridge act**
(`BridgeGuard.kt`). Before every call that writes (`remember`, `forget`,
`forgetServer`, `move`, `rename`, `named`), probes (`probe`) or opens a screen
that writes (`addServer`, `renameServer`), the bridge reads the WebView's
top-level URL on the UI thread (waiting at most 2 s) and does nothing unless it
is the app's own page (`https://appassets.androidplatform.net/pair/index.html`)
or a page of a server in the list, by its exact origin: another port, or the
http/https twin, is not it. An external link followed from a server's page
cannot forget the list or move an entry to itself.

**The reads ask it too**, because the list of servers is private to the device's
user: `servers`, `remembered`, `tvAddress`, `prefix` and `network` answer any
other page as a device that knows nothing would (`[]`, `""`), never with an
exception. `forgetServer` refused answers `""`, not `[]`, which MoreSheet would
read as "the last one is gone" and send the device to the first screen with
every server still stored; MoreSheet reads anything that is not a list as a
refusal and changes nothing. `form` and `defaultPort` stay open (the user agent
already says which app this is, and the port is a constant), and so do `open`
and `welcome`: FORGET of the server in use calls one of them from the page of
the server it has just forgotten, and neither goes anywhere but a known server
or the first screen.

A frame inside a known server's page still reaches every call, read or write:
a JavaScript interface cannot say which frame called, and the guard reads the
top-level URL, which a frame cannot change. tsundoku draws no third-party
frames. [Limits](#limits) has what closing it takes.

### The app's own page

The pairing page is served by `WebViewAssetLoader` at
`https://appassets.androidplatform.net/pair/index.html`, an https origin
(`BridgeGuard.ASSET_ORIGIN`) that a web message listener's origin rule can
name, where a `file:///android_asset/` page has no documented `sourceOrigin`.
`allowFileAccess` is off, since nothing loads a `file://` page.
`BridgeGuard.ASSET`, `Back.kt` and the client's failed-load and visit checks
recognise the page by that https URL and nothing else.

Because the page is an ordinary https URL, a server's page could try to load it
with a fragment that acts (`#connect=…`). The client closes every way in:

- **Interception.** `MainActivity`'s WebView client intercepts that whole host
  in `shouldInterceptRequest` (API 21 and up) and answers a path the loader does
  not hold with 404, so a real network answer at the host is never trusted. It
  serves the host only to the **main frame's GET of the URL the app itself
  loaded**: that URL carries a random `?t=…` token made once per activity
  (`MainActivity.loadAsset`; `BridgeGuard.refusesAssetRequest` and
  `carriesAssetToken`), and a page can write the asset URL but cannot know the
  token. A POST (which `shouldOverrideUrlLoading` never sees: "This method is
  not called for POST requests"), a 302 on a WebView whose APK does not report
  redirects (androidx's `SHOULD_OVERRIDE_WITH_REDIRECTS` is a WebView-APK
  feature, not an API level), a meta refresh, a form submit that keeps its
  action's fragment (`ASSET#connect=…`), or a link on an Android 6 box all
  arrive without the token and are a 404, with no script run. A sub-frame's
  request for the host is a 404 too. A reload reloads the document's own URL,
  token included, so the first screen still reloads.
- **Navigation.** The client also refuses the navigations into that host it is
  shown, in **both** `shouldOverrideUrlLoading` overloads: the
  `WebResourceRequest` one, added in API 24, and the deprecated `String` one,
  which is the only one API 23 calls (`minSdk = 23`).
  `BridgeGuard.refusesNavigation` is the rule both ask. The app's own `loadUrl`
  never reaches `shouldOverrideUrlLoading`, and the page's own hash changes are
  same-document, so the screens' navigation is unaffected.
- **A URL `java.net.URI` cannot parse.** `java.net.URI` throws on a `|` or `{`
  in the query or a `|` in the fragment, and a URL with no host would pass every
  guard and be sent to the network. `BridgeGuard.hostOf` reads the authority as
  a browser does and never throws, so
  `ASSET?x=|` is the asset host and refused. That a WebView hands such a URL to
  `shouldInterceptRequest` and `shouldOverrideUrlLoading` with the `|`
  unescaped is read from the URL standard (its query and fragment
  percent-encode sets do not hold `|`) and from Node's `URL`, which keeps it.
- **A history step** is the one way in that carries the token: any page the
  WebView shows can call `history.go(-n)` into an entry the app itself loaded,
  and no navigation callback is documented to see it, so the entry is served
  with its own token and whatever fragment it still has. `routeHash` runs on
  every load, so an old `#connect=X` would probe X again and, if X answered and
  was not in the list, store it and pair; an old `#lost=X` would reopen the
  not-answering screen, whose retry would do the same once X answered. So the
  page takes those entry points once: the moment `routeHash` acts on `#connect=`,
  `#lost=`, `#ask=` or `#long=`, it drops the fragment from its own entry with
  `history.replaceState`, keeping the path and the `?t=` query (the token,
  without which the page is a 404). The entry loaded again is the first screen,
  as any load with no fragment is. `#ask=` and `#long=` are dropped too so that
  a second launch can draw their band again. `#added=`, `#rename=`, `#bad=` and
  `#add` are left as they are: each draws a screen and writes nothing until
  somebody acts. `Back.kt`'s `goBackOrForward` never lands on an asset entry
  (`Back.passedOver`), so BACK is unaffected; and a second launch with the same
  address (a hash change on the same document) changes the fragment from none to
  `#connect=X` and is taken again, where setting the same fragment would fire no
  `hashchange`.

### Launcher shortcuts

One dynamic launcher shortcut per server, up to four (or the launcher's own
maximum, if lower), the last used first (`Shortcuts.kt`). Each fires the link,
`tsundoku://connect?url=<the origin, encoded>`, so a shortcut takes the path the
`am start` above takes: its address is in the list, so the server's library if
it answers, the not-answering screen for it if not, and no question. A shortcut
left pinned on a launcher after its server was forgotten is not in the list, so
it asks, as any other address from outside does. They are rebuilt whenever the
list changes and at every launch, and labelled as the row is, cut to 25
characters.

Dynamic rather than a static `res/xml/shortcuts.xml`: a static shortcut is fixed
when the APK is built and cannot carry the address the device paired with,
which is the only thing it is for. `ShortcutManagerCompat` is androidx.core,
already a dependency. Whether an Android TV home screen shows app shortcuts at
all is the launcher's choice.

## The remote's keys

The page's focus layer ([`FOCUS.md`](FOCUS.md), [`TV.md`](TV.md)) reads DOM
keys, so the app's job is to deliver them. `Keys.kt` is the whole mapping, and
`KeysTest` pins it; only the TV flavour takes MENU and the media keys
(`Form.takesRemoteKeys`).

| Key           | Where it goes                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-pad, OK     | The WebView itself: arrows and Enter, the page's own keys.                                                                                                                                     |
| BACK          | The app ([BACK](#back)).                                                                                                                                                                       |
| MENU          | Taken before the WebView: a synthetic `ContextMenu` keydown and keyup at `document.activeElement ?? document.body`, bubbling.                                                                  |
| ▶❚❚ ⏩ ⏪ ⏭ ⏮ | The same, as `MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaTrackNext`, `MediaTrackPrevious`, `MediaPlay`, `MediaPause`. The WebView would take them as media transport otherwise. |
| Number keys   | Type into the address on the address screen wherever the mark is, and into the six digits' field on the code screen. ← erases.                                                                 |
| MIC           | The TV's own voice search sits outside the app; nothing here forwards it.                                                                                                                      |

A remote without number keys uses the TV's on-screen keyboard: the address
screen opens it when the mark moves onto the field, never on arrival, and BACK
closes it. On a TV the app never calls `showSoftInput`.

## BACK

BACK goes through `OnBackPressedDispatcher`, never the deprecated override (not
an option at `targetSdk` 36). `window.tsundokuBack()` is asked (a sheet, a
climb); `true` means the page took it. Then `Back.kt`: the library is home, and
elsewhere `Back.steps` goes back to
the nearest earlier screen worth returning to, past sign-in, pairing, set-up
and the app's own first screens. A plain `canGoBack()`/`goBack()` would never
leave: the history can hold the sign-in page, and going back to it sends a
signed-in visitor to the library again, so BACK on the library would go round
in a circle; and the library's shelf tabs each leave a history entry, so BACK
would walk back through every shelf opened.

### The second press before leaving

On the library, or with no earlier screen (including a step
`canGoBackOrForward` refuses), BACK takes two presses to leave, on the TV and on
a phone or tablet alike. Both ways out go through `LeaveWindow`, which has one
rule: the press that would leave says so (the toast `PRESS BACK AGAIN TO LEAVE`,
or `APERTE VOLTAR DE NOVO PARA SAIR` when the device's language is Brazilian
Portuguese), and a second BACK within **2 s**, Android's short toast, leaves.

- **A press delivered twice is one press.** A second BACK within **400 ms** of
  the first is not a press at all, and neither is one whose key repeated while
  held. An IR remote repeats its frame about every 108 ms, so a doubled delivery
  sits under about 220 ms, and a person who has just read the toast is far
  slower than 400. A deliberate quick double tap just costs a third press; that
  is the cheaper mistake. `LeaveWindowTest` pins both numbers.
- **The window is ended by** another key (`dispatchKeyEvent`, which sees every
  key before the WebView), a page change (`doUpdateVisitedHistory`, which
  SvelteKit's client navigation reaches and `onPageFinished` never sees; a page
  writing back its own URL is not a change), the page taking BACK (a sheet
  closed), and a BACK that took a history step. Whichever ends it takes the
  toast down too.
- **A held BACK must not leave.** Android delivers one back event for a held
  key, on key up, so the only place to see the repeat is `dispatchKeyEvent`'s
  `repeatCount`. On Android 16, at `targetSdk` 36, that path closes by default,
  which is why the manifest sets `android:enableOnBackInvokedCallback="false"`:
  BACK keeps arriving as a key there too, and the app has no predictive-back
  animation to lose, its callback being always registered. A phone's gesture
  has no key at all, so it is never held.
- **The answer is asynchronous.** `evaluateJavascript` runs after the press;
  the time is taken at the press, an end that came in after it still counts
  against it, and an answer that lands once the activity is finishing or
  destroyed does nothing. A press the page took never opens the window.
- **`Log.i` under the tag `TsundokuBack`** writes one line for every BACK that
  reaches the way out, saying what it decided and why:
  `leave: TOAST steps=1 canGoBack=false current=<host>/help shown=<host>/help index=2 size=3 held=false`.
  `current` is the history's idea of the page and `shown` the WebView's.
  Neither carries a query, a fragment, userinfo or a `/pair/<code>` path
  (`Back.forLog`): a pair token and a `#connect=` must not reach the log.

The second press exists because BACK from MORE › HELP's list has been seen to
leave the app on a TV, although by `Back.steps` `/help` is one step from the
library. The cause is not known; the toast and the log are the guard and the
way to find it ([Device checks](#device-checks)).

## The WebView's settings

- **`FLAG_KEEP_SCREEN_ON`** while the activity is resumed, cleared on pause.
  Over plain http the page has no wake lock ([`WIFI.md`](WIFI.md)).
- **Cookies persist**: `CookieManager.flush()` on pause, so the paired cookie
  survives the app being killed.
- **The scale (TV)**: the TV layout is drawn on a 960 CSS-px frame, so
  `useWideViewPort=false` and `WebView.setInitialScale` pin the page to 960
  whatever the panel reports. The percent is in **physical pixels**, not dp
  (Chromium hands Blink `percent / dipScale / 100`,
  `android_webview/browser/aw_settings.cc`), so it is the panel's pixel width
  over 960: 133% on 1280×720, 200% on 1920×1080, 400% on 4K, at any density.
  `Scale.kt` is the pure part; `ScaleTest` pins it. A phone keeps the page's own
  `width=device-width`.
- **Text size (phone)**: `textZoom` follows Android's font size, up to 130%
  (`Form.textZoom`). A bigger font is the reader's own choice; the cap is there
  because the web app's 60 px bars and clamped tile titles are fixed and clip
  past it. A smaller font is honoured as it is; an unknown scale is 100. The
  app's pairing screens are drawn to grow (every height is a min-height), and
  the web app's own screens at 130% are checked by `tests/text-zoom.e2e.ts`
  ([`SERIES.md`](SERIES.md), "At a larger text size"). On a TV it is 100%,
  whatever the TV says.
- **Video**: `mediaPlaybackRequiresUserGesture = false` starts playback
  without an OK press, and a page's ask for a fullscreen element is handed
  straight back rather than the WebView swapping itself for a black picture
  ("A fullscreen picture", below).
- **Cleartext**: `network_security_config.xml` allows plain http (a home
  address has no certificate) and still checks the system's anchors for an
  https tailnet name.
- **Fullscreen and immersive**: the system UI is hidden, and the theme has no
  action bar, so the page is the screen.
- **Zoom off** on both flavours: `setSupportZoom(false)`, and the page's
  viewport pinned to scale 1 ("Zoom is off", above).

## On a phone: the camera band and the keyboard

The app targets SDK 36, so on Android 15 and later it is drawn edge to edge
whatever it asks, and its system bars are hidden besides. Two things follow,
and neither is the page's to fix:

- **The page would start under the camera.** The web app does not read
  `env(safe-area-inset-top)` for its own layout: an installed PWA has Chrome
  keep it out of the cutout. A WebView reports the insets only on newer versions
  anyway.
- **The keyboard would cover the button pinned to its top edge.** Edge to edge,
  `adjustResize` stops shrinking the window for the keyboard (it still does on
  Android 14 and older).

So the activity pads the WebView itself, by what `Insets.padding` returns from
`WindowInsetsCompat`: the cutout on whichever side it is (the top in portrait,
a side when the phone turns), the keyboard at the bottom while it is open, and
the home gesture's strip while it is closed (`mandatorySystemGestures`, 16 px
above the gesture bar in the layout). This padding is the app's, not drawn
inside the page: the app knows the real cutout, the page does not. The padding
takes **the page's own colour**, so the band reads as the page's edge, dark or
light:

- the activity reads it when any page finishes loading (`SURFACE_JS`), the
  computed background drawn through a 1×1 canvas, since the light theme's paper
  computes as `oklch()`;
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
band's and the gesture strip's sizes as `--app-inset-top`, `-right`, `-bottom`
and `-left` (CSS px, `Insets.css`), since a WebView reports
`env(safe-area-inset-*)` only on newer versions. `SHORT_EDGES` lets the app into
the cutout on Android 14 and older too, where a fullscreen window is otherwise
kept out of it.

The reader's manga and manhwa pages use it:

- **The pages run under the camera**, edge to edge, while the bars are down.
- **The top bar stays where it is**, below the band, its background extended up
  through the band (`padding-top: var(--app-inset-top)`), so the page never
  shows above it while the bars are up.
- **The bottom bar hugs the display's edge**, with no inset.

The image reader asks with `drawUnderCamera()` (`src/lib/app/surface.ts`) on
mount and gives the band back on leaving;
`src/routes/read/[entry]/Chrome.svelte`'s top bar is
`64px + var(--app-inset-top)` tall with the band as its top padding. In a
browser the variable is unset and both bars are 64 px and flush.

### A fullscreen picture

The page never asks this app for a fullscreen element. The readers' FULL
SCREEN is offered only where a browser's frame is around the page
(`fullscreenOffered`, `src/lib/reader/fullscreen.svelte.ts`): this app's
system UI is hidden and the page fills the window, so there is no frame to
take away, and the cell is not drawn here.

The player's FULL is drawn here, because in portrait it has something to take
away besides a frame: the controls and UP NEXT under the picture. In the app it
is the page's own (`appFull` in `VideoPlayer.svelte`): the player lays itself
out as it does turned, the picture filling the window, and BACK takes it down
before it leaves the player ([`ANIME.md`](ANIME.md), "Portrait"). From
2026.11.22 to 2026.11.23 FULL was not drawn in the app at all, which left no
way to watch upright with the picture alone.

Anything that asks anyway is handed straight back
(`MainActivity.chrome`: `callback.onCustomViewHidden()`), rather than the
WebView hiding itself and showing the element as a bare picture: with nothing
to resize, that picture is a black screen. Until 2026.11.21 the app took the
ask and turned the phone to landscape for it, which laid every portrait drama
on its side; it then followed the phone's sensor instead, and FULL showed
nothing but a black flash. Either way the window is the screen already, so
there is nothing a fullscreen element can add.

In a browser the element keeps the phone's own orientation: FULL never turns it
(`screen.orientation.lock` is not called, and a WebView would refuse it anyway
with `NotSupportedError`). Turned, a film is landscape
([`ANIME.md`](ANIME.md), "Portrait").

## Limits

- **A frame inside a known server's page reaches the bridge.** The guard reads
  the top-level URL, and a JavaScript interface does not say which frame
  called. tsundoku draws no third-party frames. Closing it means moving the
  bridge to `WebViewCompat.addWebMessageListener` (androidx.webkit), which
  hands each message its `sourceOrigin` and `isMainFrame`. Two of the three
  pieces are in place: the app's page has an https origin a rule can name
  ([above](#the-apps-own-page)), and the per-message rule is built and
  unit-tested but called by nothing: `BridgeGuard.allowsMessage(origin,
isMainFrame, known)` refuses every sub-frame, trusts a main frame whose
  `sourceOrigin` is exactly `ASSET_ORIGIN` or a known server's origin through
  `Address.originOf`, and refuses everything else (the opaque `"null"`,
  `about:`, `data:`, `javascript:`, and any string that is not an origin, the
  `file://` asset URL included). The rule must be per message, not per
  registration, because origin rules are fixed when the listener is added and
  the list changes at runtime (pairing, FORGET, `move`): one listener, the
  object named `TsundokuTV` injected where the rule allows, each message
  checked. What is left is the transport: every call becomes a message with an
  id and every reply a promise keyed by it, so two calls answered out of order
  land on their own callers, a reply after the page navigated is dropped, and a
  call made before the object is there is answered as "no bridge" (the pages
  already treat a missing bridge as a browser). The page side is about 27 calls
  in `assets/pair/index.html`, `surface.ts`, `MoreSheet.svelte`,
  `+layout.svelte` and `pair/tv/+page.svelte`, plus every e2e file that stands
  the bridge up, whose stubs must answer late and out of order. The bar's
  server cell already awaits its read; MoreSheet's `servers()` and
  `forgetServer()` reads are still synchronous. External links open inside the
  WebView, where the guard refuses them every write and every read; opening
  them outside it would change behaviour on a TV.
- **The not-answering screen probes the other servers once**, when it opens; its
  own retry every 5 s is for the server in use only. A retry that fails again
  only counts (TRIED N TIMES): the rows, their answers and the remote's mark
  stay where they are.
- **FORGET expires the old shared `tsundoku_paired` too.** On a device whose
  jar still holds that name for another server on the same computer (one not
  opened since the per-server names), forgetting one server costs the other a
  second pairing. Forgetting must forget, so the old name goes. Two servers on
  one computer each holding their own name keep their pairing through FORGET on
  the other.
- **Screens from an older server.** SERVERS, the bar's cell and the code
  screen's phone layout are the web app's, so a computer running an older
  tsundoku shows its own versions: no SERVERS row (its other servers are reached
  through the not-answering screen when it is off, or by a launcher shortcut),
  and a code screen drawn for a TV alone, on which the app still raises the
  keyboard. A friend's install updates itself ([`UPDATES.md`](UPDATES.md)).
- **An origin stored from a link before links were asked about** cannot be told
  from one typed; FORGET removes it.
- **Esc on a tablet's keyboard** does not go back: a page cannot press
  Android's BACK, and nothing asks the bridge to.
- **No offline reading in the app.** Over a friend's plain-http Wi-Fi the
  WebView keeps the browser's rules, so a service worker still needs https.
- **No instrumented tests.** The WebView half is JVM-tested where it is pure
  and browser-tested with a stand-in bridge; the rest is checked on a device
  ([below](#device-checks)).

## Device checks

The build has no emulator image, so what only a WebView or a device can show
is checked by hand. Each item says what is pinned elsewhere and what to look
for. Most need a debug build and `chrome://inspect` attached to the app; the
BACK checks need real D-pad presses, never console clicks (Chromium can mark an
entry a page added without a user gesture as skippable, so only real presses
count).

What has been seen on a device: on an Android 11 TV, focusing the address
screen's field opens the number pad over the buttons and BACK closes it; on a
phone, the app installs and pairs, the page sits below the camera band, and zoom
is off. Everything else below is built and tested off the device only.

### BACK

1. MORE › HELP › a real topic, each opened with OK. BACK: the topic closes and
   the HELP list shows. BACK: the library, with **no** toast and no log line.
   Note `history.length` and `location.href` in the console at each stop. Run
   `adb logcat -s TsundokuBack` in a terminal.
2. BACK on the library: the toast, and the app stays. The log reads
   `leave: TOAST steps=null canGoBack=false current=<host>/ shown=<host>/ index=N size=M held=false`.
3. BACK again inside 2 s: out. `leave: LEAVE`.
4. Open the app, BACK, wait more than 2 s, BACK: a second toast and no exit.
5. BACK, then any other key (an arrow, OK) inside 2 s, then BACK: the toast goes
   at the other key, and the BACK is a new toast, not an exit. BACK, then open
   something with OK and come back to the library: the same.
6. Three presses of BACK, all within 400 ms of the first: one toast and no exit.
   A press from 401 ms to 2 s after the first leaves. Hold BACK down for two
   seconds, then again: no exit.
7. The device's language set to Portuguese (Brasil):
   `APERTE VOLTAR DE NOVO PARA SAIR`. On a phone: the same toast and the same
   two presses from its library, with the gesture and with a tablet keyboard's
   BACK.
8. With no server: open a link, press CONNECT on an address that answers
   slowly, BACK once: the toast, CHECKING gone, the mark back on CONNECT, and
   CONNECT works again.

If step 1 goes wrong, the log says which suspect it is.
**`canGoBackOrForward` refusing a skippable entry:** the toast comes up on HELP
or the topic, and the log says `steps=1 canGoBack=false current=<host>/help`.
**A stale `copyBackForwardList().currentItem`:** the toast on a screen that is
not the library, and the log says `steps=null` and `current=<host>/` while
`shown=<host>/help`. **One remote press delivered as two:** HELP's BACK lands on
the library and the toast shows with no further press, or two log lines in the
same instant with `NOTHING` on the second. A held BACK on Android 16 is
untried.

### The TV's WebView

- **HLS on a low-end device.** The player is hls.js; whether a cheap TV's
  WebView decodes what a browser does is untried.
- **The 960-px pin on real panels.** The arithmetic is unit-tested and the unit
  read from Chromium's source; whether a particular TV's WebView honours
  `setInitialScale` with the page's `width=device-width` viewport meta present
  is not. Check `document.documentElement.clientWidth` reads 960.
- **The on-screen number keyboard** on a second TV model, beyond the Android 11
  set it was seen on.
- **`onShowCustomView` over a real `<video>`**, the screen-awake flag, the
  immersive system UI, and the leanback banner's cropping on the home row.
- **Installation by USB** from a TV's own file manager, and **a signed build**
  from a real keystore.

### Addresses and links

- **A server typed with capitals.** On the address screen, TYPE THE WHOLE
  ADDRESS as `http://<Host>:42143` with a capital in the host, pair, then MORE ›
  SERVERS: the row is there and IN USE, RENAME saves, and after closing and
  relaunching the app it opens that library, not the first screen. Then the same
  with the scheme in capitals, `HTTP://<Host>:42143` (and `Http://…` if the
  keyboard capitalises the first letter by itself): the address screen checks
  and pairs it, not NOTHING ANSWERS (`tv-app-pair.e2e.ts` pins the probe's
  address in a browser; a TV keyboard is not). An entry stored with capitals by
  an older APK reads back lower case on the first launch.
- **A link from outside the app**, with a computer running tsundoku that the
  device does not have in MORE › SERVERS:
  1. From a browser on the device, open a page with a link to
     `tsundoku://connect?url=<that computer's origin, percent-encoded>` and
     press it. The app comes forward on the address screen, the field holding the address, the
     band reading `THIS ADDRESS CAME FROM A LINK · NOTHING IS SAVED UNTIL YOU
PRESS CONNECT`, the button reading `CONNECT →`, and the mark on
     `USE THE LAST NUMBER`.
  2. Without answering, press BACK, then open MORE › SERVERS: no new entry.
  3. Press the link again, go up one to `CONNECT →` and press OK. The
     computer's pairing screen opens, and once paired the entry is in MORE ›
     SERVERS.
  4. Forget that entry, and press the link again with the app already open on a
     library: the same question comes up over it, not a pairing.
  5. Press the same link for a computer the device **does** have: its library
     opens with no question.
  6. Long-press tsundoku's icon (on a phone, where a launcher shows app
     shortcuts) and open a server's shortcut: its library, with no question.
  7. Where the browser takes `intent:` links (Chrome on a phone), open
     `intent://connect#Intent;scheme=tsundoku;package=<the app's package>;S.url=https%3A%2F%2Fexample.com;end`.
     It asks about `https://example.com`: the extra is asked about too.
  8. `#lost=`, which only a WebView can reach. On a library, with the inspector
     attached, run `location = 'http://<that computer's LAN address>:9'`, a port
     nothing listens on. The app's page comes up with the question naming that
     origin; for more than five seconds the console shows no probe; MORE ›
     SERVERS gains nothing; BACK returns to the library. Then do the same and
     press CONNECT: only now is it probed. Finally stop tsundoku on a computer
     that is in the list and reload its library: the not-answering screen for
     it, retrying, and once tsundoku is back its library opens with no second
     entry.
  9. The 80-character refusal. A link to an `https://` origin of 81 characters
     the device does not have (a long made-up host): the address screen, the
     field empty, the band reading
     `THAT ADDRESS WAS REFUSED · NOTHING WAS SAVED` with
     `OVER 80 CHARACTERS IS TOO LONG TO READ` beside it, both whole in the TV's
     own font. The same through step 8's `location =` for an 81-character host
     (`#lost=`): the same band, and for more than five seconds no probe. Then an
     address of exactly 80 characters: the question, its whole address above the
     buttons and none of it under them, in two lines of hint, with the same gap
     above CONNECT → and USE THE LAST NUMBER as under the address screen's
     ordinary hint.
- **A launch intent on a TV**: the documented `am start … --es url` for an
  address in the list opens it, and one not in the list asks.

### Servers

With two tsundokus to hand (one over Tailscale and any other):

1. Install the APK over an older one already paired with one address. It opens
   the same library with no digits asked, and MORE's last row reads
   `SERVERS → 1 · ADD ANOTHER`.
2. MORE › SERVERS: the mark is on + ADD A SERVER. OK, type the second computer's
   address, NEXT, then its six digits. The added screen ("ZEN is one of this
   TV's servers") replaces the computer's paired page within a second, with OPEN
   ZEN → marked.
3. RENAME there: Android's keyboard rises under the field, its ✓ saves the name
   and comes back to the added screen, and BACK (twice: the first closes the
   keyboard) cancels.
4. In the library, MORE › SERVERS: two rows, the mark on the one not in use; the
   remote's MENU key and OK held both open its options; BACK climbs options →
   list → MORE. Close MORE: the bar reads `ON <NAME>` after the wordmark, with
   the one in use. One ↑ from the first CONTINUE card puts the mark on it; OK
   opens SERVERS at once, the mark on the other server; BACK closes it with the
   mark on the cell. Then OK on that other server, and look at the cell
   straight after its library opens: it names the server just opened, not the
   one just left, and OK on it opens SERVERS with IN USE on that one.
5. FORGET on the one not in use: press OK straight after MENU opens the options
   and again at once: nothing is forgotten. Then ↓ OK forgets it; add it back,
   and it asks for six digits again. Whether `CookieManager.setCookie` replaces
   an `HttpOnly` cookie with an expired one cannot be tested without a WebView.
6. Turn the server in use off and relaunch: the not-answering screen for it, the
   other offered at the right with ● ANSWERS; ↑ from TRY AGAIN reaches it. Leave
   the mark there for 15 s: it stays on that row, and the row keeps ANSWERS,
   while TRIED N TIMES counts up. OK opens it.
7. Turn one computer off, open it from MORE › SERVERS (the not-answering screen
   appears), then quit the app and launch it again: it opens the server that was
   in use before, not the not-answering screen for the one that is off.
8. With A in use: stop B, open B from MORE › SERVERS (the not-answering screen
   appears), start B and press TRY AGAIN. B's library opens, MORE › SERVERS on
   B's page marks B IN USE, and quitting and launching again opens B, even when
   WebView sent no finish for B's failed load.
9. On a phone, the SERVERS row in MORE's sheet, drawn for a TV.

**Two servers on one computer** (two ports). The server half is e2e-tested in a
browser's jar (`tests/tv-pair-origins.e2e.ts`); the WebView's jar is the claim.

1. A device holding the old shared cookie name, with the app and the server
   updated: launch. It opens the library with no digits asked, and the
   inspector's Application › Cookies shows `tsundoku_paired_<port>` and no
   `tsundoku_paired`.
2. Pair the second server. Both open their libraries from SERVERS with no
   digits asked, and the inspector shows both `tsundoku_paired_<port>` names.
3. FORGET the second: the first still opens with no digits asked; adding the
   second back asks for six.

**Launcher shortcuts.** Long-press tsundoku's icon on the TV's home screen (and
on a phone): one shortcut per server, named as its row is, each opening that
server's library. A launcher that shows none is the launcher's choice.

**The server's name from the paired page.** `MainActivity` reads `main.paired`'s
`data-paired-name` from the computer's `/pair/tv`, and `.lab`'s text for an
older server; `tests/tv-pair-origins.e2e.ts` runs the script on the real paired
page, and that `evaluateJavascript` hands it back on a device is the claim. If
neither is there, the added screen does not appear (the computer's paired page
stays) and the name arrives from the library instead.

### The guard and the app's page

- **The writes' guard.** On a server's library, in the console,
  `TsundokuTV.rename(location.origin, 'X')` renames the row in MORE › SERVERS;
  then `location.href = 'https://example.com'`, and on that page
  `TsundokuTV.forget()` leaves SERVERS as it was after BACK. The claim is that
  `WebView.url` on the UI thread is the top-level page's and comes back within
  the guard's 2 s.
- **The reads' guard.** On a server's library, `TsundokuTV.servers()` prints the
  list (and MORE › SERVERS and the bar's cell are as usual; on the address
  screen the prefix is still the device's own `192.168.x.`); on
  `https://example.com`, `TsundokuTV.servers()` prints `[]`, and `tvAddress()`,
  `remembered()` and `network()` an empty string, with no exception.
- **The loader.** Pair from the first screen (the page itself must draw, so the
  loader served it); MORE › SERVERS › a server › FORGET (the page after must
  draw); from the library, BACK out of `/pair/tv` lands on the screen before it,
  not on the app's page; and with the computer off, open that server from
  SERVERS, so the not-answering screen draws, not the WebView's grey error page.
  If any is blank, the loader's path handler is the first place to look.
- **The navigation guard.** From a server's library, open (or set as
  `location.href`)
  `https://appassets.androidplatform.net/pair/index.html#connect=http://example.com:42143`:
  nothing happens, no address screen, no CHECKING, and MORE › SERVERS gains no
  `example.com`. A server page that embeds the asset page in a frame shows a 404. **Run this on an Android 6 (API 23) box or emulator** too, since API 23
  calls only the deprecated `shouldOverrideUrlLoading(WebView, String)`. Then an
  HTTP 302 from a server page whose `Location` is that asset URL: the page does
  not change, and SERVERS gains nothing; where the WebView APK does not report
  redirects, the token is what refuses it.
- **The POST.** From a server page's console, submit a form with
  `method="post"` whose action is that same asset URL: a 404, no pair screen,
  no `example.com` entry.
- **A URL `java.net.URI` cannot parse.**
  `location.href = 'https://appassets.androidplatform.net/pair/index.html?x=|#connect=http://example.com:42143'`
  leaves the page where it was, and a form `post` to the same URL shows a 404;
  SERVERS gains nothing, and the inspector's Network panel shows no request for
  `appassets.androidplatform.net` leaving the device.
- **A history step into an old pair-page entry.** Hand the device an address of
  a computer that answers and is not in SERVERS, press CONNECT, let it pair,
  then FORGET it. From any server page's console, step back through the history
  to the pair page's entry: it shows the first screen, its URL ends in `?t=…`
  with no `#connect=`, and SERVERS does not have the forgotten server back. Then
  hand the device the address of a server it does have, twice in a row while it
  shows CHECKING: the second is checked again (a second probe in the console),
  not dropped.

### The phone

- **The insets**: the cutout padding, the keyboard's padding on Android 15 and
  on 14 and older (where `adjustResize` still resizes), and whether
  `mandatorySystemGestures` still reports the home strip with the bars hidden.
  `InsetsTest` pins the arithmetic, not what a phone hands it.
- **`textZoom` and the day and night themes**, including whether
  `prefers-color-scheme` follows a switch made while the app is open (the
  activity handles `uiMode` itself, so it is not recreated). The 130% check in
  `text-zoom.e2e.ts` multiplies font sizes by 1.3 in a browser; it is not the
  WebView's own `textZoom`.
- **`Network.state` on mobile data**: the interface names are the common
  vendors', read from documentation.
- **The reader under the camera**: `edge()`, `SHORT_EDGES` and the
  `--app-inset-*` variables are unit- and browser-tested; a page drawn into a
  real cutout is not.
- **A fullscreen ask in the app**: the page never makes one
  (`fullscreenOffered`), and `tests/browse-player-portrait.e2e.ts` pins that
  FULL is not drawn for the app's user agent; a WebView handing a real ask back
  is built, not seen on a device.
- **The friend's SETTINGS panel by eye**: its arrangement is asserted
  (`friend-wifi.e2e.ts`: the address above, the digits and the QR side by side,
  the QR's 182 px), not looked at on a screen.

## Tests

The JVM unit tests in `android/app/src/test/` run once per flavour
(`./gradlew testTvDebugUnitTest testMobileDebugUnitTest`):

- `AddressTest`: a host and a scheme typed in capitals come back lower case,
  the same origin `intentOrigin` gives, and `originOf` holds on its own output.
- `IntentAddressTest`: the given address's parser: a tailnet name, a LAN
  address and a domain; its port kept and its path dropped; `null` for a wrong
  scheme, a missing host, userinfo, and a port of 0 or above 65535 (`null` is
  the refusal, not a rewrite to the default port).
- `AttemptsTest`: the activity's two launch paths in order: a given address
  during the remembered probe keeps its address screen whether the probe answers
  or not. That `MainActivity` calls `Attempts` on both is read, not run: a JVM
  test cannot drive the Activity.
- `GivenTest`: the link-or-extra rule: an address not in the list asks; a
  shortcut's address does not, and one left behind by a forgotten server does;
  the intent's shape decides nothing; the plain launcher entry carries no
  address and someone else's link is not read; everything the parser refuses is
  refused even by a list that claims to know it; the list is asked about the
  origin, not the raw string; 80 characters is asked and 81 takes `#long=`.
  Three cases read the source: `MainActivity` asks this rule and writes no entry
  point of its own, the page takes every entry point the rule can name, and the page holds
  the same limit as the rule.
- `ServersTest`: the store: the migration of a device paired with one address (a
  list of one, opened, never asked to pair again), an add that never takes
  launch, the last used first and the not-answering screen's others, names,
  encode and decode as each other's inverse, an entry stored with its scheme's
  own port read back without it, as WebView's URL has it, a mixed-case entry
  read back lower case and found by its page's origin, an add typed in capitals
  stored lower case, two entries differing only in case folded to the one opened
  last with the names it lacked, forget down to the first screen, a server that
  moved, and the JSON the pages read.
- `ShortcutsTest`: one per server, four at most, each link read back through
  `givenAddress`'s decoding and `Address.intentOrigin` to the same origin.
- `ForgetTest`: FORGET's cookie lines, one paired name per origin read from the
  table the server's spec reads too, another origin's pairing kept, and the
  paired page's name from its attribute or, for an older server, its first line.
- `FailedLoadTest`: every order WebView may report a failed load in, the app's
  next attempt ending a mark whose finish never came, and
  `FailedLoad.finish`'s decision.
- `BridgeGuardTest`: the guard: the asset page by its https URL, a known
  origin, one stored with its scheme's own port, one stored with capitals
  trusted on its lower-case pages, a scheme typed in capitals trusted without
  widening anything; refused: unknown origins, another port, the http/https
  twin, the asset page's `file://` URL and other `file://` pages. The asset
  host: a navigation to it with `#connect=`, `#add` or `#rename=` is refused, a
  frame's request for it is refused, the host is read case-blind, and a known
  or unknown server's page, or a URL that merely carries the host in a query,
  is not. Served only to a main-frame GET: a form `POST` to `ASSET#connect=…`, a
  lower-case `post` and a null method are refused, a main-frame `GET` served, a
  frame's `GET` refused, and no other host refused whatever its method. The
  token: a main-frame `GET` of the app's own `?t=…` URL (with any fragment) is
  served, and a tokenless `ASSET`, one with a wrong or extra query, a blank
  token and a token in the fragment are refused; `carriesAssetToken` on its
  own. The host when `java.net.URI` cannot parse the URL: `?x=|`, `?x={` and
  `#connect=|` refused at the navigation and the interception; every other
  spelling of the host a browser reads as it (capitals, userinfo before an
  `@`, a port, one trailing dot, `%2e`, a backslash, `https:` with one slash or
  none, a tab inside the name) refused too; and the host as userinfo, a longer
  or look-alike name, two trailing dots, the host in a path, query or fragment,
  and a `file:` path not. `hostOf` on its own.
- `MessageGuardTest`: `BridgeGuard.allowsMessage` over every origin-shaped
  input, as a listener would deliver one: a third-party frame inside a known
  server's page refused, a known origin and `ASSET_ORIGIN` trusted only as the
  main frame, a host or scheme in capitals the same server, a path or trailing
  slash in place of an origin refused, the `file://` asset URL refused, and the
  opaque `null` no page at all.
- `PairingBridgeTest`: each guarded method called from an unknown page changes
  nothing, and from the asset page and a known server's acts; each guarded read
  from an unknown page reads `[]` or `""` and writes nothing, and from the asset
  page and a known server's reads the list, the server in use, the address, the
  prefix and the network; `forgetServer` refused answers `""`; `form` and
  `defaultPort` answer anyone; FORGET's `open` and `welcome` still answer the
  page it has just made unknown; and `forget()` from a known server's page
  forgets every server, its own included.
- `LeaveWindowTest`: two presses, the 2 s edge on each side, a doubled press at
  0 to 400 ms, a held one, a key or page change ending it, a same-URL
  `replaceState` not ending it, and an end or a press that arrives out of
  order. The paths into it are read, not run: it pins the source (the one
  `finish()`, `doUpdateVisitedHistory`, `repeatCount`, the manifest's flag).
  `BackTest` holds `Back.steps`, `Back.forLog` and the log line.
- `KeysTest`, `ScaleTest`, `ProbeTest`: the key mapping, the scale percent, the
  probe's manifest check.
- `FormTest` (each row of `Form.kt`'s table), `InsetsTest` (the padding in
  every combination, and which colours the band takes), `NetworkTest` (a
  carrier's 10.x never the home address).
- `VersionsTest`, `ReleaseCheckTest`, `UpdaterPlanTest`, `B64Test`: the
  updater's ([`UPDATES.md`](UPDATES.md)).

The browser specs, from the repository root (Playwright; [`TESTING.md`](TESTING.md)
has the projects):

- `tests/tv-app-pair.e2e.ts`: the app's own page from the shipped asset file
  with a stand-in bridge: no real intent and no WebView. The first screen and
  the address screen: the mark on NEXT rather than the field (and on TYPE THE
  WHOLE ADDRESS one press down), the number keys typing into the field from
  there, the whole-address field staying visible, the first screen's step 01 and
  the not-answering screen's second reason keeping a friend's WI-FI remedy
  beside a Tailscale install's truth, and the first screen's steps grid ending
  above START. A `#connect=` address in the list shows neither the first screen
  nor the address screen and names what it is checking; a `#bad=` shows the band
  on the address screen, above the label and inside the frame, with the screen
  still usable, its hint and first line whole at a TV's 0.6 em monospace. The
  attempt rules: a refusal handed to a device on the not-answering screen stops
  its retry, so the band is still there past a 5 s tick and no probe for the old
  address is made; a typed probe in flight when a link's question arrives
  neither stores its answer nor leaves for `/pair/tv`, while the refused path
  into the address screen resets NEXT and the checking line; a probe in flight
  when a refusal arrives fails without replacing the band; a new attempt after a
  refusal clears the band and can still reach the not-answering screen; and a
  link after a refusal, once CONNECT is pressed and it answers, still remembers
  and pairs. Origins: a typed whole address with a path pairs at its origin, one
  with a query fails to the not-answering screen for the origin, and a scheme in
  capitals reads as its host on CHECKING and the not-answering screen. The
  question: `#ask=` calls neither `probe` nor `remember` until CONNECT, then
  each once; the mark starts off CONNECT; `#connect=` for an address not in the
  list asks; a non-http `#ask=` is refused; the entry loses its fragment
  (keeping the token) and a history step shows the first screen; the same link
  twice asks twice and another replaces it; a second link or the way out while
  CHECKING drops the late answer; CONNECT is not swallowed after a late answer
  and asks once if pressed twice; a failure reaches the not-answering screen and
  stores nothing until it answers; BACK saves nothing, and BACK while CHECKING
  drops a late answer or failure, with a server in use and with none (where the
  first BACK only toasts and CONNECT works again); a `#lost=` for an origin not
  in the list asks and probes nothing until CONNECT, while one in the list
  reaches the not-answering screen and its retry opens it; over 80 characters is
  refused through `#ask=`, `#connect=`, `#lost=` and `#long=` with the length's
  band, 80 exactly asks, and the band and an 80-character address fit a TV and a
  phone's column. The servers: the not-answering screen offers the others (each
  probed, answers landing out of order on their own rows, ↑ from TRY AGAIN
  reaching them, OK opening one; the frame at 48/500 and 580/332, buttons at
  416), and with one server is the plain not-answering screen; ADD A SERVER
  names who is here and BACK opens the library in use; an address already in the
  list opens without pairing, a new one is added and paired; a given address in
  the list, and the not-answering screen's server back, open its library; CHANGE
  THE ADDRESS moves the entry; the added screen and RENAME (from the added
  screen and from the library, saved, cancelled and emptied); and a bridge with
  no list is the page without servers.
- `tests/tv-servers.e2e.ts`: the web half in the `tv` project with a stand-in
  bridge: no SERVERS row without the bridge; MORE's SERVERS row with one server;
  SERVERS' order, mark, probes and frame; a server's options and FORGET with its
  0.6 s; forgetting the one in use and the last; a refused FORGET changing
  nothing, and FORGET of the one in use pressed twice opening the next once and
  never the first screen; the layout telling the app, and only the app, the
  server's name; MORE's TO LINK row reached by keys. The bar's cell: none
  without the bridge, with an APK without `servers`, with five kinds of answer
  that are not a list of servers, with two of which none is in use, or with one;
  two put the one in use after the wordmark, the device's name first, the
  server's own without one, a long one clipped (200 and 180 px, the rules, `ON`
  in the second ink); ↑ reaches it, OK opens SERVERS on the one not in use, MENU
  and BACK climb as from MORE, BACK closes onto the cell; OK on the one in use
  closes onto the cell; FORGET leaving one server takes the cell away and the
  mark to MORE; a rename shows when MORE closes and on a reload, not before;
  MORE opened again while SERVERS is still leaving gives focus back to MORE;
  `EM` in Portuguese; right after a switch, the cell and SERVERS name the page's
  own server and FORGET acts on the right one; a server not named yet shows its
  name on the first library. With a bridge whose `servers()` answers a Promise:
  a late answer draws the cell when it lands, an older answer landing after a
  newer one is dropped, one landing after the library is left changes nothing, a
  bridge that throws or answers non-JSON draws no cell, a late refused read
  draws none, and a bridge that never answers leaves the page cell-less with its
  grid drawn and MORE opening.
- `tests/tv-pair.e2e.ts`: the computer's `/pair/tv` at 960×540 with no pointer:
  every band clearing the label and the six cells, a wrong code spending a try,
  the right one landing on the paired page, five wrong ones burning it.
- `tests/tv-pair-origins.e2e.ts`: two servers of its own, `ORIGIN` on
  `tsundoku.test:<port>` and a browser resolving that name to 127.0.0.1, so one
  jar holds both (the WebView's shape), each server's `Date.now` moved by a file
  the spec writes: an expired code made new on `/pair/tv` and paired, a used one
  kept for ✓ USED's 2 minutes then made new, a code that runs out while the code
  screen is up, a burned one kept burned past its 10 minutes; the paired page's
  `data-paired-name` read by `PAIRED_JS` taken out of `MainActivity.kt`; and two
  servers on one host each staying paired after the other pairs and after FORGET
  on the other, and a jar holding only the old name staying paired and moved.
- `tests/pairing-tv.spec.ts`: the six digits: once, 10 minutes, five wrong
  tries burn it, every answer of the state machine; the tailnet path, the rule
  that draws the DEVICES block only where that cookie opens (never with no
  `ORIGIN` or a loopback one), and the friend branch's refusal of a paired
  cookie off Wi-Fi.
- `tests/pairing-origins.spec.ts`: `pairedCookie` over the shared table
  (localhost, IPv4, IPv6, a tailnet name; legal cookie names; on its own
  output), `readPaired`'s move from the old name and what it leaves alone, and
  the report scrub of every paired name.
- `tests/settings-devices.e2e.ts`: the DEVICES block on two token installs of
  its own, with and without a tailnet `ORIGIN`, and a code a device spends while
  SETTINGS is open. `tests/friend-wifi.e2e.ts`: the Wi-Fi panel's FOR THE APP
  digits beside the browser's QR, under THIS COMPUTER'S ADDRESS, and its
  measurements. `tests/friend-tailnet.e2e.ts` and `tests/tv-devices.e2e.ts`
  (the TV's `Android TV · app` label) follow SETTINGS' words.
- `tests/app-ua.spec.ts`: the user agent, `appDevice`, and the DEVICES label
  and cell.
- `tests/fullscreen.spec.ts`: when the readers and the player offer FULL, and
  when they must not (an installed app, the Android app).
- `tests/phone-app-pair.e2e.ts`: the app's own pages with a stand-in bridge
  saying `mobile`, at 360×780, 1280×800, 800×1280 and 780×360, with the layout's
  measurements, the pinned buttons riding a shorter viewport (the keyboard),
  mobile data, the colour told to the app, and the TV's words unchanged when no
  form is said.
- `tests/phone-pair-route.e2e.ts`: `/pair/tv` as the phone app, the code screen
  on a phone and a tablet and the paired page reached with a seeded paired row,
  never spending the six digits the TV's specs pair with.
- `tests/phone-app-reader.e2e.ts`: the reader asks for the band and gives it
  back, its top bar reaches up through a 32 px band with its contents below it,
  and the bottom bar hugs the edge; in a browser the top bar is 64.
- The three phone specs run once, in the `phone` project (`PHONE_ONLY`,
  `playwright.config.ts`); each sets its own viewport. `tests/text-zoom.e2e.ts`
  is the 130% check, in the same project.
- `tests/release-apk.spec.ts` runs the release script ([`RELEASE.md`](RELEASE.md)).
