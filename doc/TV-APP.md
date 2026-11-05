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

The unit tests cover the pure pieces (`Tests`, below); there is no emulator
system image on this machine, so nothing instrumented runs.

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

- **An address given at launch** ([below](#handing-the-tv-an-address)) is
  checked first, whichever door it came through: a cold start, or a second
  `am start` on an app already open. It is not stored until it answers.
- **The last used server that answers** opens its library directly (c261:
  the TV keeps a list, [below](#servers), and launch opens the one whose
  library was open last; there is no default to mark). The answer is the web
  app manifest: `/manifest.webmanifest`'s name is tsundoku's, so a router, a
  NAS or another web server does not pass.
- **The last used server that does not answer** shows 9D for it, what it tried
  and the three likely reasons, keeps probing every 5 s, and offers the other
  servers beside the reasons (S9). It never silently opens another.
- **No server at all, remembered or given,** shows 9A, the app's first screen.

### Handing the TV an address

Typing a tailnet name on a remote is worse than the six digits that follow it,
so the app also takes the computer's address from outside (c260): the launch
extra below, or a link carrying the same address. Both reach the app whether it
is closed or already open (`singleTask` sends the second launch to
`onNewIntent`).

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
the link are there, the extra wins: it is what the command above sends.

On a friend's install the same command takes that computer's own address, which
is also what a failing LAN probe leaves to type: run the same command with the
address as its value — `--es url http://192.168.1.23:42143` (their `PORT` if
they changed it). The whole address is the one thing 9B's panel would otherwise
ask for on a remote.

Only `http` and `https` with a host are accepted — a tailnet name, a domain, or
an address, on a port from 1 to 65535 (a port of 0, or one above 65535, is
refused rather than rewritten to the default one). Only the origin is kept: a
path, a query and a fragment are dropped, and an address carrying a username or
password is refused. A bare `host:port` is not enough here, although it is on
9B: nothing was typed, and the command can always give the scheme.

- **Refused** lands on 9B with the existing band: the field empty, the mark on
  NEXT, and the band saying the address was refused and nothing was saved.
  Its hint, `http(s)://HOST · NO LOGIN · PORT 1–65535`, names every rule
  `Address.intentOrigin` refuses by and no other (c307): the scheme, a host, no
  userinfo (LOGIN is a username, a password or both, before an `@`), and a
  port in range when one is given. A string that is not an address at all
  fails the first two. The row does not wrap, and on a TV its monospace is
  0.6 em a glyph (Roboto Mono and Droid Sans Mono alike), so the hint is
  short enough to sit beside REFUSED · NOTHING WAS SAVED there; the longer
  `http:// OR https:// WITH A HOST, NO USERNAME, PORT 1–65535` fits a desktop's
  narrower font and cut the first line off on a TV.
- **Answered** and new is added to the TV's servers ([below](#servers); it
  does not replace the one in use) and opens the pairing at that address: the
  six digits on a tailnet instance (c245), or a friend's 9C. **Answered** and
  already in the list opens that server's library: its pairing is already in
  the WebView's cookie jar (c261).
- **Not answered** shows 9D for that address and keeps trying. A previously
  remembered address is left alone, but 9D does not give up the given one by
  itself, and the launcher's icon does not bring the library back (c307): the
  activity is `singleTask`, so tapping the icon while the app is open hands a
  plain MAIN intent to `onNewIntent`, which carries no address and changes
  nothing, and the TV stays on 9D retrying the mistyped address. **BACK** is
  the way back: the asset takes no BACK of its own, so `Back.kt` goes to the
  nearest earlier screen past the app's own pages, which is the library when
  the app was open on it, and otherwise leaves the app. The next launch, with
  no address given, probes the last used server and opens its library.

Only the attempt that is current has its answer acted on. A given address
supersedes a probe already in flight, and that probe's answer is dropped —
success included — so a launch cannot be overtaken by the address it replaced.
A refusal stops 9D's retry before showing the band, so the band is not replaced
five seconds later by the old address's failure, and a probe still in flight
when the refusal arrives cannot replace it either: only a _failure_ is dropped,
so a late success still remembers and opens the pairing (Decision 9 in the
handoff notes). A new attempt clears the band first, because it is a new
question — whether it is typed on 9B or handed in at launch. The band's flag is
cleared at all three doors into that screen (`probe`, `show`, `connect`), so a
visible band always means the refusal is still the attempt in hand; hiding the
screen alone does not hide the flag.

The activity keeps the same rule for the one probe it makes itself, the
remembered address's on a cold start (c306). That probe can take up to six
seconds (`Probe.kt`'s 3 s connect and 3 s read, longer when a `.ts.net` name
stalls with Tailscale down), and a second launch handed an address inside that
window reaches `onNewIntent` and loads 9B at once. `Attempts.kt` numbers the
two doors: the probe takes an attempt before it starts, `takeGiven` takes the
next, and the probe's answer is acted on only if its attempt is still the
latest. So the given address's 9B is not replaced by the library at the
remembered address, nor by 9D naming an address nobody handed in.

An address is compared by its **origin**, not its text. The field keeps what was
typed — a path, a query, userinfo, a differently cased host — while
`PairingBridge` answers with `Address.originOf`'s origin. Both sides of the
comparison go through `new URL(…).origin` (the page's `atOrigin`), so a typed
`https://zen.tailnet.ts.net:8443/library` and the bridge's
`https://zen.tailnet.ts.net:8443` are the same attempt and its success or
failure lands; comparing the raw strings dropped the answer and left 9B on
CHECKING with NEXT disabled.

The check is 9B's own: the web app manifest, through `PairingBridge`. A given
address goes through the same `#connect=` path in the asset page, remembers
only in its success branch, and never adds a second probe.

## Servers

The TV keeps a list of the servers it has paired with, and switches between
them as Jellyfin's TV app does (c261; the handoff is
`doc/handoffs/tv-servers/`, the brief `doc/briefs/TV-SERVERS.md`). The
designer's calls, as built:

- **One server: nothing changes.** Launch, pairing and 9D are as before. The
  one addition is a **SERVERS** row at the end of MORE (S6), drawn only where
  the app's bridge exists, so a phone, a computer and a browser never see it.
  It reads `1 · ADD ANOTHER`, or with two or more `3 · LIVING ROOM IN USE`.
- **Launch opens the last used.** A server becomes the one in use when its
  library has loaded (`MainActivity.onPageFinished`, any page of it that is
  not sign-in, set-up or pairing). If it does not answer, 9D for it with the
  others offered (S9); never another.
- **Names.** A server is named by itself: its hostname, upper case, as
  `/pair/tv` says it. The app reads it from 9E's `data-paired-name`
  attribute (c545), falling back to 9E's first line (`✓ PAIRED WITH ZEN · …`)
  for a server older than that (`Forget.pairedNameFrom`), and the library's layout
  also says it to the bridge on every load (`data.computer`, sent only to the
  app's user agent), so a TV paired before the list existed is named too.
  **RENAME** (S5) keeps the TV's own name for it, on the TV only; emptied, the
  server's name comes back; never named at all, the row shows its address.

### Where each state lives

| State                                        | Where                                                                                            | Door                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| S2 SERVERS, S3 a server's options, S4 FORGET | the web app's MORE (`MoreSheet.svelte`), over the library, in the 420 px panel every TV sheet is | MORE › SERVERS                        |
| S6 MORE with SERVERS                         | the same sheet, its last row                                                                     | MORE                                  |
| S5 RENAME                                    | the app's own page, `#rename=<origin>`                                                           | S3's RENAME, S8's RENAME              |
| S7 ADD A SERVER                              | the app's own page, `#add` (9B, step `ADD A SERVER · 1 OF 2`)                                    | S2's + ADD A SERVER                   |
| S8 added                                     | the app's own page, `#added=<origin>`, in place of the computer's 9E                             | 9E after an add                       |
| S9 9D with the others                        | the app's own page, `#lost=<origin>`                                                             | launch, a server that stops answering |
| S1 the bar's `ON LIVING ROOM` cell           | **not built**: the library's top bar is `src/routes/+page.svelte`'s                              | (handoff notes, wave 21, Gaps)        |

SERVERS, its options and FORGET are panels over the library in the design, so
they are the web app's, reading the bridge at runtime. RENAME and the add are
whole screens, before or beside pairing, so they are the app's own page, as
9A–9D are. The two halves talk only through `window.TsundokuTV`.

### On the remote

- **SERVERS** lists the one in use first (✓, IN USE in the accent), then the
  rest by when each was last opened, then `+ ADD A SERVER`. The mark lands on
  the first one not in use; with one server, on + ADD A SERVER. Each row is
  probed as the panel opens (CHECKING, then ● ANSWERS or ○ NO ANSWER), the
  answers landing as they come. OK opens that library at once (its pairing is
  its own cookie); on the one in use, OK closes the panel.
- **MENU, or OK held,** on a row opens its options: ADDRESS, ITS NAME (NOT
  SAID YET until the server has said it), OPENED (TODAY, YESTERDAY, N DAYS AGO,
  NEVER), NOW, then OPEN →, RENAME and FORGET.
- **FORGET** is its own panel. The mark lands on KEEP IT; FORGET is ↓ then
  OK; for the first 0.6 s FORGET is disabled and KEEP IT ignores OK, so the
  tail of an OK held to open the options presses nothing. Forgetting the one
  in use opens the next that answers (else the next by when it was opened,
  whose 9D offers the rest); forgetting the last returns to 9A.
- **BACK** climbs: FORGET to the options (on FORGET), the options to the list
  (on that row), the list to MORE (on SERVERS), MORE closed.
- **ADD A SERVER** is 9B with the new computer's address: the meta line names
  who is already here, and BACK returns to the library in use, nothing
  changed. An address already in the list is not paired again: the band says
  `ALREADY IN SERVERS AS STUDIO · OPENING` and its library opens. A new one
  that answers is added and its pairing opens; after its six digits the app
  shows S8 in place of the computer's 9E, with OPEN → focused and RENAME.
- **9D's CHANGE THE ADDRESS** on a server in the list opens 9B for that entry
  (`01 — LIVING ROOM'S NEW ADDRESS`): the new address that answers takes the
  entry's place, keeping the TV's name for it, then pairs. A server back after
  not answering opens its library, not its pairing again.

### The store

`Servers.kt` is the list: one line per origin in the `pairing` prefs
(`servers`), with the server's name, the TV's name, when its library last
opened and when it was added. Pure apart from its key-value, so
`ServersTest` pins it.

- **Migration.** A TV paired before c261 has `address` and no `servers`. The
  first read makes it a list of one, opened now, so the TV opens exactly as
  before and is never asked to pair again: its cookie is the WebView's,
  and nothing touches it. The jar keeps cookies per **host**, not per
  origin (port and scheme are not part of a cookie's scope), so since c530
  each server names its paired cookie for its own port and scheme
  (`tsundoku_paired_42143`, `tsundoku_paired_s443`; `pairedCookie` in
  `src/lib/server/pairing.ts`), and two servers on one computer keep their own
  pairing. A TV paired before c530 carries the one name every server used,
  `tsundoku_paired`; the first request to the server that set it signs in by
  it and moves it to that server's own name (`readPaired`), and a server it is
  not paired with leaves it alone. `address` is kept in step with the last
  used on every write, so an older APK installed over this one still opens
  the same library.
- **`remember()` adds**, never replaces, and never makes a server the one in
  use: an add left at 9C does not take launch from the library the TV was in.
- **FORGET** removes the entry and expires the cookies the WebView's jar
  sends that origin (`Forget.expiring`: each name written back with
  `Max-Age=0` at `/`, `Secure` on https), then flushes the jar, so adding it
  back pairs with six digits. The jar hands back every server's cookies on
  that host, so FORGET expires this origin's paired name, the old shared
  `tsundoku_paired`, and every cookie that is not a pairing, and never another
  origin's `tsundoku_paired_*` (c530; `Forget.pairedCookie` names it as the
  server does, both read `android/tv/app/src/test/resources/paired-cookies.tsv`). The computer still lists the TV in SETTINGS ›
  08 — DEVICES until it is signed out there: the TV may be off the network
  when it forgets.
- **The bridge** (`PairingBridge.kt`) grew `servers()` (JSON, the one in use
  first), `open`, `rename`, `named`, `forgetServer`, `move`, `addServer`,
  `renameServer` and `welcome`; probes run four at a time so a panel's rows
  answer as they land. Every page the WebView loads has the bridge, which is
  how MORE reaches it; the list lives in the app, never in a page.
- **Only the app's pages make the bridge write** (c529; `BridgeGuard.kt`).
  Before every call that writes (`remember`, `forget`, `forgetServer`, `move`,
  `rename`, `named`), probes (`probe`) or opens a screen that writes
  (`addServer`, `renameServer`), the bridge reads the WebView's top-level URL
  on the UI thread and does nothing unless it is the app's own asset page
  (`file:///android_asset/pair/index.html`) or a page of a server in the list
  (its exact origin: another port, or the http/https twin, is not it). An
  external link followed from a server's page can no longer forget the list
  or move an entry to itself. The reads (`tvAddress`, `prefix`, `defaultPort`,
  `remembered`, `servers`) and `open` and `welcome` are not guarded: FORGET of
  the server in use calls `open` or `welcome` from the page of the server it
  has just forgotten, and neither goes anywhere but a known server or 9A.
  `PairingBridge.kt`'s KDoc has every method in a table.

### Launcher shortcuts

One dynamic launcher shortcut per server, up to four, the last used first
(c287; `Shortcuts.kt`). Each fires c260's own link,
`tsundoku://connect?url=<the origin, encoded>`, so a shortcut opens exactly the
door the `am start` above does: the server's library if it answers, 9D for it
if not. They are rebuilt whenever the list changes (and at every launch, so a
TV paired before c287 gets its shortcut on the first launch after the update),
and labelled as the row is, cut to 25 characters.

Dynamic rather than a static `res/xml/shortcuts.xml`: a static shortcut is
fixed when the APK is built and cannot carry the address this TV paired with,
which is the only thing it is for. `ShortcutManagerCompat` is androidx.core,
already a dependency; nothing was added. Whether an Android TV home screen
shows app shortcuts at all is the launcher's choice; see "What is not
verified".

### Where it departs from the handoff

- **No `ON LIVING ROOM` cell in the library's top bar (S1).** The bar is
  `src/routes/+page.svelte`'s, which wave 21's tv-app slot does not own; the
  cell's exact markup is under Gaps in `doc/handoff-notes/tv-app.md`. MORE ›
  SERVERS is the door meanwhile, and S8's prose says "Switch from MORE ›
  SERVERS" rather than "from the name at the top of the library, or MORE ›
  SERVERS", which would name a door that is not there.
- **The rows are ruled and the actions are 17 px mono.** The mock's own reset
  (`.tv button { font: inherit; border: 0 }`) outranks its `.srv` and
  `.p-act` rules, so as drawn its rows have no rule under them and its
  actions inherit 16 px sans (the extracted spec shows it: no border on
  `.srv`, a letter-spacing of 0.32 px, 0.02 em of 16). The stylesheet's
  declared values, and the calls page's "ruled rows", are the decision.
- **MORE's own rows stay the house's** (`MoreSheet.svelte`, 64 px, 15 px mono),
  not S6's 56 px panel actions: SERVERS is one more row in the sheet every
  device shares, not a redraw of it.
- **The server's name is read, not handed over.** The design has `/pair/tv`
  hand it to the bridge; instead 9E carries it in `data-paired-name` (c545),
  which the app reads once 9E has loaded, and the library's layout says it on
  every load. The cost: S8 replaces the computer's 9E once 9E has drawn, so 9E
  shows for a moment first.
- **A server that moved takes the entry's place when it answers**, not once
  paired: the old address's cookie is no use to the new one either way, and
  the answer is the one thing the page sees before it leaves for `/pair/tv`.
- **Forgetting the one in use when no other answers** opens the next by when
  it was last opened, so its 9D offers the rest. The design names only the
  case where one answers.
- **9D's reasons are at least 60 high**, not exactly: at 500 px wide the second
  reason wraps on a TV's font, and all three still end above TRY AGAIN.

### What it does not do yet

- S1, above.
- **A server older than this release has no SERVERS row**: the row is the web
  app's, so a TV on a computer still running an earlier tsundoku reaches its
  other servers only through 9D (when that computer is off) or by a launcher
  shortcut (c287). The friend's install updates itself (`doc/UPDATES.md`).
- 9D probes the other servers once, when it opens; its own retry every 5 s is
  for the server in use only. A retry that fails again only counts (TRIED N
  TIMES): the rows, their answers and the remote's mark stay where they are
  (round 2 of wave 21; before it, every failed retry rebuilt 9D, put the mark
  back on TRY AGAIN and probed every other server again).
- **FORGET expires the old shared `tsundoku_paired` too** (c530), which on a
  TV paired before c530 may still be another server's on the same computer,
  until that server has been opened once since its update (which moves it to
  its own name). Forgetting must forget, so the old name goes; the cost is a
  second pairing for that other server in that one case. Two servers on one
  computer each paired since c530 keep their own pairing through FORGET on
  the other, as S8 says.
- **A frame inside a known server's page reaches the bridge** (c529). A
  JavaScript interface does not say which frame called it, and the guard
  reads the top-level URL, which a frame cannot change. tsundoku draws no
  third-party frames; the way to close this too is
  `WebViewCompat.addWebMessageListener` with origin rules (androidx.webkit,
  not a dependency yet). External links still open inside the WebView, where
  the guard refuses them every write; opening them outside it would be a
  behaviour change on a TV, not made.
- 9E itself (the computer's) still says nothing of other servers on a first
  pairing, as the design asks: with one server nothing changes.

## Pairing, 9A to 9E

On the computer: SETTINGS › 08 — DEVICES. A friend's install switches WI-FI ON
there first, and the pairing panel then shows the phone's QR **and, under a
FOR A TV · SIX DIGITS label, six digits in two threes**
(`src/routes/settings/+page.svelte`), with their own countdown. The owner's own
tailnet instance has no WI-FI row at all: there the same six digits are the
section's first row, in the WI-FI row's shape and without the phone's QR
(c245). A new code lives for 10 minutes, pairs one TV once, and **five wrong
tries burn it**; NEW CODE makes another.

On the TV:

1. **9A** — what the app does, and the three steps. The first names the
   computer's SETTINGS › 08 — DEVICES and WI-FI ON for a friend's install
   (whose digits only render with the switch on), and says a Tailscale install
   has no switch to press: both truths, so neither install is sent to a
   section with no digits. The step's copy is kept short enough that the
   steps grid ends above START (c263: a longer wording ran the grid to 413.75
   against START's 400 at 960x540; `tv-app-pair.e2e.ts` checks the two
   boxes). START →.
2. **9B** — the address, written for the TV: its own network's first three
   numbers and tsundoku's port (42143 unless the friend changed `PORT`), so
   only the last number is typed. The mark starts on NEXT, never on the field:
   a focused text field is what asks the WebView for the TV's number pad, and
   the pad covers both buttons (c247). The number keys type into the field
   wherever the mark is, so a remote that has them never needs the pad; a
   remote without them reaches TYPE THE WHOLE ADDRESS in one press down, and
   the field is one press up. TYPE THE WHOLE ADDRESS takes `host:port` or a
   full `http://…` for Tailscale or another port. NEXT probes it; an address
   handed in at launch is probed the same way and skips this screen (c260). A
   pasted address with a path or a query pairs at its origin: the origin is what
   is probed, remembered and opened, never the whole string (c260).
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
way to be signed in). Its 9B whole-address hint says where the digits are — the
computer's SETTINGS — and 9D's second reason names both a friend's WI-FI switch
and a tailnet install with no digits, so neither reads false. The computer lists
the TV as a DEVICES row because the app
appends `TsundokuTV/<version>` to the WebView's own user agent: `isTvApp`
(`src/lib/settings/catalog.ts`) reads it, and both the pairing and the settings
sync (`/api/devices/sync`) label the row "Android TV · Chrome". The sync route
also reads that header for the row's _kind_: a TV is kept as `tv` in
`devices.kind` (rung 59, card c244), not as an Android desktop.

On a tailnet instance the cookie it sets signs the WebView in as a browser
would: `hooks.server.ts` accepts it in token mode on the instance's public
host, so the TV opens the library instead of `/login` (c245;
[`SIGN-IN.md`](SIGN-IN.md)).

The bridge (`PairingBridge.kt`) is what a `file://` page cannot do: the TV's own
IPv4 (for the prefix and 9D's third reason), a probe of a candidate, and
`SharedPreferences` for the address that answered. It is registered for the
whole WebView, so the paired web app reaches it too (MORE › SERVERS, c261),
and every call that writes or probes asks first whether the page is the
app's own or a known server's (c529, "The store" above); the probe only
fetches `/manifest.webmanifest` at the address it is given.

## The remote's keys

The page's focus layer ([`FOCUS.md`](FOCUS.md)) reads DOM keys, so the app's
job is to deliver them.

| Key           | Where it goes                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-pad, OK     | The WebView itself: arrows and Enter, the page's own keys.                                                                                                                                                                                                                                                                                       |
| BACK          | The app. `window.tsundokuBack()` first (a sheet, a climb); `true` means the page took it. Then `Back.kt`: on the library the app leaves; elsewhere it goes back to the nearest earlier screen, past sign-in, pairing, set-up and the app's own first screens, and with none it leaves. `OnBackPressedDispatcher`, never the deprecated override. |
| MENU          | Taken before the WebView: a synthetic `ContextMenu` keydown + keyup at `document.activeElement ?? document.body`, bubbling.                                                                                                                                                                                                                      |
| ▶❚❚ ⏩ ⏪ ⏭ ⏮ | The same, as `MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaTrackNext`, `MediaTrackPrevious`, `MediaPlay`, `MediaPause`. The WebView would take them as media transport otherwise.                                                                                                                                                   |
| Number keys   | Type into the address on 9B wherever the mark is, and into the six digits' field on 9C. ← erases.                                                                                                                                                                                                                                                |
| MIC           | The TV's own voice search sits outside the app; nothing here forwards it.                                                                                                                                                                                                                                                                        |

`Keys.kt` is the whole mapping, and `KeysTest.kt` pins it. A remote without
number keys uses the TV's on-screen keyboard: 9B opens it when the mark moves
onto the field, never on arrival, and BACK closes it. The app itself never
calls `showSoftInput` (see "What is not verified").

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
- **The on-screen number keyboard** on a remote with no number keys. On the
  owner's Android 11 TV, focusing 9B's field opens it over the buttons (c247),
  and the page no longer focuses the field on arrival; that BACK closes the pad
  is the owner's observation on that TV, not something testable here, and no
  second TV has been tried. The app never calls `showSoftInput`.
- **A launch intent and a `tsundoku://` link on a device.** The parser and the
  page's `#connect=`/`#bad=` states are unit- and browser-tested, but nothing
  here has delivered an intent to a TV: no emulator image exists on this
  machine, and no TV was at hand.
- **`onShowCustomView` over a real `<video>`**, the screen-awake flag, the
  immersive system UI, and the leanback banner's cropping on the home row.
- **The keystore and a signed build**: no keystore exists yet.
- **Servers (c261) on a TV.** The store, the launch choice and the migration
  are JVM-tested; the screens are browser-tested with a stand-in bridge.
  Nothing has run on a TV. To check, with two tsundokus to hand (the owner's
  over Tailscale and any other):
  1. Install this APK over the one already paired. It must open the same
     library with no digits asked, and MORE's last row must read
     `SERVERS → 1 · ADD ANOTHER`.
  2. MORE › SERVERS: the mark is on + ADD A SERVER. OK, type the second
     computer's address, NEXT, then its six digits. The app's own "ZEN is one
     of this TV's servers" (S8) must replace the computer's 9E within a
     second, with OPEN ZEN → marked.
  3. RENAME there: Android's keyboard must rise under the field, its ✓ save
     the name and come back to S8, BACK (twice: the first closes the
     keyboard) cancel.
  4. In the library, MORE › SERVERS: two rows, the mark on the one not in
     use; the remote's MENU key, and OK held, must both open its options;
     BACK must climb options → list → MORE.
  5. FORGET on the one not in use: press OK straight after MENU opens the
     options and again at once: nothing must be forgotten. Then ↓ OK forgets
     it; add it back, and it must ask for six digits again (the cookie
     expiry is the claim here: whether `CookieManager.setCookie` replaces an
     `HttpOnly` cookie with an expired one is not testable without a
     WebView).
  6. Turn the server in use off and relaunch: 9D for it, the other offered
     at the right with ● ANSWERS; ↑ from TRY AGAIN reaches it. Leave the
     mark there for 15 s: it must stay on that row, and the row must keep
     ANSWERS, while TRIED N TIMES counts up. OK opens it.
  7. A server that is off, opened from SERVERS, must not become the one
     launch opens. Turn one computer off, open it from MORE › SERVERS (9D
     appears), then quit the app and launch it again: it must open the
     server that was in use before, not 9D for the one that is off.
     `FailedLoad` no longer depends on the order WebView reports a failed
     main-frame load in (c532: the failed load's own finish consumes the
     mark, whatever came between); this is the check that it holds on a TV.
- **Two servers on one computer (c530).** The server half is e2e-tested in a
  browser's jar (`tests/tv-pair-origins.e2e.ts`); the WebView's is the claim.
  Check, with two tsundokus on one computer (two ports):
  1. A TV paired before this release, with the app and the server updated:
     launch. It must open the library with no digits asked. In Chrome's
     remote inspector (`chrome://inspect`, a debug build), Application ›
     Cookies must then show `tsundoku_paired_<port>` and no
     `tsundoku_paired`.
  2. Pair the second server (MORE › SERVERS › + ADD A SERVER). Both must open
     their libraries from SERVERS with no digits asked, and the inspector
     must show both `tsundoku_paired_<port>` names.
  3. FORGET the second: the first must still open with no digits asked;
     adding the second back must ask for six.
- **The bridge's guard (c529).** JVM-tested (`BridgeGuardTest`,
  `PairingBridgeTest`); that `WebView.url` on the UI thread is the top-level
  page's, and comes back within the guard's 2 s, is the claim. Check, with a
  debug build and `chrome://inspect` on a server's library: in the console,
  `TsundokuTV.rename(location.origin, 'X')` must rename the row in MORE ›
  SERVERS; then `location.href = 'https://example.com'`, and on that page
  `TsundokuTV.forget()` must leave SERVERS as it was after BACK.
- **Launcher shortcuts (c287).** Built and planned in a JVM test, never seen
  on a launcher. Check: long-press tsundoku's icon on the TV's home screen
  (and on a phone, where Android's launcher does show app shortcuts). One
  shortcut per server must appear, named as its row is, each opening that
  server's library. If the TV's launcher shows none, that is the launcher:
  nothing in the app depends on it.
- **The name a server gives itself, read from 9E's DOM.** `MainActivity`
  reads `main.paired`'s `data-paired-name` from the computer's `/pair/tv`
  (c545), and `.lab`'s text for a server older than that. The script itself
  is run on the real 9E by `tests/tv-pair-origins.e2e.ts`; that
  `evaluateJavascript` hands it back on a TV is the claim. If neither is
  there, S8 simply does not appear (the computer's 9E stays) and the name
  arrives from the library instead.
- **Installation by USB** on a TV's own file manager.

## Tests

- `android/tv/app/src/test/` — `AddressTest`, `AttemptsTest`, `BackTest`,
  `BridgeGuardTest`, `FailedLoadTest`, `ForgetTest`, `IntentAddressTest`,
  `KeysTest`, `PairingBridgeTest`, `ProbeTest`, `ScaleTest`, `ServersTest`,
  `ShortcutsTest` (79 tests in 13 classes at wave 22), run by `./gradlew test`.
  `ServersTest` (18) is c261's store: the migration of a TV paired with one
  address (a list of one, opened, never asked to pair again), an add that
  never takes launch, the last used first and 9D's others, names, encode and
  decode as each other's inverse, forget down to 9A, a server that moved, and
  the JSON the pages read. `ShortcutsTest` (4) is c287's plan (one per
  server, four at most, each link read back through `givenAddress`'s decoding
  and `Address.intentOrigin` to the same origin). `ForgetTest` (5) is FORGET's
  cookie lines, one paired name per origin read from the table the server's
  spec reads too, another origin's pairing kept (c530), and 9E's name from its
  attribute or, for an older server, its first line (c545). `FailedLoadTest`
  (7) is every order WebView may report a failed load in (c532).
  `BridgeGuardTest` (4) is c529's rule (the asset page, a known origin, and
  the refused: unknown origins, another port, the http/https twin, other
  `file://` pages); `PairingBridgeTest` (4) calls each guarded method from an
  unknown page and finds nothing changed, from the asset page and a known
  server's and finds it acted, and FORGET's `open` and `welcome` still
  answering the page it has just made unknown. `AttemptsTest` plays the activity's two launch doors in
  order: a given address during the remembered probe keeps its 9B whether the
  probe answers or not (c306). That `MainActivity` calls `Attempts` at both
  doors is read, not run: a JVM test cannot drive the Activity.
  `IntentAddressTest` is the given address's parser: a tailnet name, a LAN
  address and a domain; its port kept and its path dropped; `null` for a wrong
  scheme, a missing host, userinfo, and a port of 0 or above 65535 (`null` is
  the refusal, not a rewrite to the default port) (c260).
- `tests/pairing-tv.spec.ts` — the six digits: once, 10 minutes, five wrong
  tries burn it, the state machine's every answer; the tailnet door, the rule
  that draws the DEVICES block only where that cookie opens (never with no
  `ORIGIN` or a loopback one, c264), and the friend branch's refusal of a
  paired cookie off Wi-Fi (c245). `tests/settings-devices.e2e.ts` is the
  same row on two token installs of its own, with and without a tailnet
  `ORIGIN`, and a code a TV spends while SETTINGS is open (c264, c265;
  `WIFI.md`).
- `tests/tv-app-pair.e2e.ts` — 15 cases, 9A and 9B from the shipped asset file:
  the mark on NEXT rather than the field (and on TYPE THE WHOLE ADDRESS one press
  down), the number keys typing into the field from there, and the whole-address
  field that stays visible; and 9A's step 01 and 9D's second reason keeping a
  friend's WI-FI remedy beside a Tailscale install's truth (c245). A `#connect=`
  given address shows neither 9A nor 9B and names what it is checking; a `#bad=`
  shows the band on 9B, above the label and inside the frame, with the screen
  still usable (c260), and its hint and first line whole, both in this browser
  and at a TV's 0.6 em monospace (c307). 9A's steps grid ends above START
  (c263). Cases stand up a stub bridge for the states only the app
  reaches: a refusal handed to a TV already on 9D stops its retry, so the band
  is still there past a 5 s tick and no probe for the old address is made; a
  typed probe still in flight when a given address arrives neither stores its
  answer nor leaves for its `/pair/tv`, while the refused door into 9B resets
  the NEXT button and checking line the held probe left behind; a probe still
  in flight when a refusal arrives fails without replacing the band; and a new
  attempt after a refusal clears the band and can still reach 9D. A given
  address that arrives after a refusal and does not answer reaches 9D, the band
  having been cleared with the attempt it described; one that does answer still
  remembers its origin and leaves for `/pair/tv`, so an address handed in twice
  is judged on its own answer. Two more pin the origin comparison: a typed whole
  address with a path pairs at its origin (remembered and opened without the
  path), and one with a query fails to 9D for the origin, not the raw string
  (c260).
- `tests/tv-app-pair.e2e.ts`, c261's twelve (27 cases in all): with a stand-in
  bridge holding a list, 9D offers the others (each probed, answers landing out
  of order on their own rows, ↑ from TRY AGAIN reaching them, OK opening one;
  the frame at 48/500 and 580/332, buttons at 416), and with one server is 9D
  as before; ADD A SERVER names who is here and BACK opens the library in use;
  an address already in the list opens it without pairing, a new one is added
  and paired; a given address in the list, and 9D's server back, open its
  library; CHANGE THE ADDRESS moves that entry; S8 and RENAME (from S8 and from
  the library, saved, cancelled and emptied); and a bridge with no list is the
  page as before c261.
- `tests/tv-servers.e2e.ts` — the web half in the `tv` project with a stand-in
  bridge: no SERVERS row without the bridge; S6 with one server; S2's order,
  mark, probes and frame (the extracted measurements); S3 and S4 with FORGET's
  0.6 s; forgetting the one in use and the last; the layout telling the app,
  and only the app, the server's name; MORE's TO LINK row reached by keys (c475).
- `tests/tv-pair.e2e.ts` — the computer's `/pair/tv` at 960×540 with no pointer:
  every band clearing the label and the six cells, a wrong code spending a
  try, the right one landing on 9E, and five wrong ones burning it.
- `tests/tv-pair-origins.e2e.ts` — two servers of its own, `ORIGIN` on
  `tsundoku.test:<port>` and a browser resolving that name to 127.0.0.1, so
  one jar holds both (the WebView's shape), each server's `Date.now` moved by
  a file the spec writes: an expired code made new on `/pair/tv` and paired,
  a used one kept for ✓ USED's 2 minutes then made new, a code that runs out
  while 9C is up, a burned one kept burned past its 10 minutes (c246); 9E's
  `data-paired-name` read by `PAIRED_JS` taken out of `MainActivity.kt`
  (c545); and two servers on one host each staying paired after the other
  pairs and after FORGET on the other, and a jar holding only the old name
  staying paired and moved (c530).
- `tests/pairing-origins.spec.ts` — `pairedCookie` over the shared table
  (localhost, IPv4, IPv6, a tailnet name; legal cookie names; on its own
  output), `readPaired`'s move from the old name and what it leaves alone,
  and the report scrub of every paired name (c530).
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

## The first TV's pairing bugs (2026-11-02)

Both were found on the owner's Android 11 set (c243) and are the app's side or
the computer's, decided without the device:

- **9B's number pad** (c247). START focused the last-number field, and the
  system number pad opened over the bottom half of the screen, covering TYPE
  THE WHOLE ADDRESS — the one button a Tailscale user needs — with nothing on
  screen saying BACK would close it. The mark now starts on NEXT; the pad
  opens only when the mark is moved onto the field, which is the request to
  type. The number keys stopped depending on that focus: they type into the
  field from any of the three stops, so a remote that has them never sees the
  pad, and a remote that does not (the owner's) reaches the whole-address
  escape with one press down. `tv-app-pair.e2e.ts` pins the mark and the keys.
- **9C's band** (c246, its second point). The band sits at 84 and is 56 high,
  so it ended at 140 — over the section label at 108 and the ✓ ANSWERED line
  beside it. With a band the label moves to 164 and the cells to 204, the
  rhythm 9D keeps below its own band, and the buttons still end inside the
  frame. `tv-pair.e2e.ts` checks every band state's box ends above the label
  and the cells.

What the card also asked for — an expired code replaced on arrival, so the TV
is not stuck — waited on the owner, who chose (b) on 2026-11-04: `/pair/tv`
makes a fresh code when the only one has merely expired, and a burned one
still needs the computer (`TvPairing.renewForTv`; [`WIFI.md`](WIFI.md), "A
TV's code"). `tests/tv-pair-origins.e2e.ts` opens `/pair/tv` with the
server's clock past the code's life.
