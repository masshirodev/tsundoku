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

`android/` is a Gradle project in Kotlin DSL, the only Android in this
repository. Since c521 it builds two apps as product flavors, this one (`tv`)
and the phone and tablet one (`mobile`, [`PHONE-APP.md`](PHONE-APP.md)): every
line of pairing is shared, and what differs is `Form.kt`'s. The folder was
`android/tv/` until then.

|                            |                                                                           |
| -------------------------- | ------------------------------------------------------------------------- |
| Kotlin                     | 2.2.20                                                                    |
| AGP / Gradle               | 8.13.0 / 8.14.3 (the pair Kumiko's Capacitor app already builds with)     |
| `compileSdk` / `targetSdk` | 36                                                                        |
| `minSdk`                   | 23: old TV boxes, and nothing here forces higher                          |
| Package                    | `dev.masshiro.tsundoku.tv` (the phone app's: `dev.masshiro.tsundoku.app`) |

One activity (`MainActivity.kt`) and a WebView. The parts worth testing are
pure Kotlin and live beside it: `Keys.kt`, `Scale.kt`, `Address.kt`,
`Probe.kt`.

## Build it

```sh
cd android
./gradlew assembleTvDebug testTvDebugUnitTest   # the TV's APK and the JVM unit tests
./gradlew --stop                 # always: a daemon outlives the build otherwise
```

JDK 21 is what this machine has, and AGP 8.13 needs 17 or newer. The SDK is
`~/Android/Sdk` (`ANDROID_HOME` here); `local.properties` is gitignored.
Gradle's downloads go to `~/.gradle`; everything the build writes stays under
`android/` and is gitignored. No APK is committed.

The unit tests cover the pure pieces (`Tests`, below); there is no emulator
system image on this machine, so nothing instrumented runs.

## Install it

A debug APK, by `adb` over the network (Android TV's developer options enable
network debugging):

```sh
adb connect <tv-address>:5555
adb install -r app/build/outputs/apk/tv/debug/app-tv-debug.apk
```

or as a file: copy the APK to a USB stick, plug it into the TV, and open it in
the TV's own file manager (most TVs ask to allow installing from that app
once). Android TV also accepts `adb push` to `/sdcard/Download/` and a package
installer app.

The launcher shows **tsundoku** with the wordmark banner (320×180, drawn from
`android/banner/tv-banner.svg`); the icon is the app's own 積.

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

What the app **stores** is `Address.originOf`'s origin, and that is lower case
in its scheme and its host (c548), as `intentOrigin`, Chromium's URL and the
page's `location.origin` all are. Before c548 `originOf` kept the host as
typed, so `http://Zen.local:42143` in TYPE THE WHOLE ADDRESS was stored with
its capitals: `BridgeGuard` then refused the server's own pages (they load at
`http://zen.local:42143`), FORGET, RENAME, the probe and `named` did nothing
from them, and `Servers.find` missed it, so it never became the server in use.
A scheme typed in capitals (`HTTP://…`, or `Http://…` from a TV keyboard
that capitalises the first letter) is read as a scheme twice over, not given a
second `http://`: 9B's `origin()` tests it without case
(`/^https?:\/\//i`, the test `connect()` uses) before the probe and
`remember` see it, and `originOf` reads it without case after (before
round 2, `origin()`'s case-sensitive `startsWith('http')` turned
`HTTP://Zen.local:42143` into `http://HTTP://Zen.local:42143`, a host named
`HTTP`, and 9B said NOTHING ANSWERS). 9B's CHECKING line and 9D's title strip
the scheme from what they print with the same case-blind regex (c621), so a
capitalised scheme reads as its host on both, not as `HTTP://…`. Every place the APK compares an origin goes through
`originOf` or agrees with it: `BridgeGuard.allows` (the top-level URL through
`originOf`; its scheme test reads the scheme without case too, as `originOf`
does, so `HTTP://…` is the same page as `http://…` — c646),
`BridgeGuard.allowsMessage` (origin-shaped:
`ASSET_ORIGIN`, or `originOf` of a known origin), `Servers.find`, `others`, `add`, `forget`, `move` and every
update (each cleans its argument through `originOf`), `FailedLoad` (fed by
`MainActivity.originOf(Uri)`, which lower-cases too, though Chromium's URL
already is), `PairingBridge.remember`, `probe` and `forgetOne`, and the
cookie's (`Forget.pairedCookie` reads only the scheme, lower-cased, and the
port; `CookieManager` matches hosts without case). `BridgeGuard.refusesNavigation`
and `refusesEmbedding` (c549, round 2) read the asset host without case too.

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
| S2 SERVERS, S3 a server's options, S4 FORGET | the web app's MORE (`MoreSheet.svelte`), over the library, in the 420 px panel every TV sheet is | S1's cell, MORE › SERVERS             |
| S6 MORE with SERVERS                         | the same sheet, its last row                                                                     | MORE                                  |
| S5 RENAME                                    | the app's own page, `#rename=<origin>`                                                           | S3's RENAME, S8's RENAME              |
| S7 ADD A SERVER                              | the app's own page, `#add` (9B, step `ADD A SERVER · 1 OF 2`)                                    | S2's + ADD A SERVER                   |
| S8 added                                     | the app's own page, `#added=<origin>`, in place of the computer's 9E                             | 9E after an add                       |
| S9 9D with the others                        | the app's own page, `#lost=<origin>`                                                             | launch, a server that stops answering |
| S1 the bar's `ON LIVING ROOM` cell           | the library's top bar (`src/routes/+page.svelte`), after the wordmark, with two or more servers  | the library, ↑ from its start         |

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
  whose 9D offers the rest); forgetting the last returns to 9A. FORGET
  disarms the moment it is pressed, so a second press (a double tap, a second
  OK) before the next server's page commits does nothing; and an answer that
  is not a list (the bridge's refusal, `""`, c549) changes nothing and calls
  neither `open` nor `welcome`: only a real empty list is "the last one".
- **BACK** climbs: FORGET to the options (on FORGET), the options to the list
  (on that row), the list to MORE (on SERVERS), MORE closed. Opened from the
  bar's cell, the list has no MORE under it: BACK closes the panel and the
  mark is back on the cell (the design's "focus goes back to what opened
  it").

### The bar's server cell (S1, wave 24)

With two or more servers, the library's top bar says whose library this is:
`ON LIVING ROOM` after the wordmark (TV-Servers.dc.html, `bar`). `ON` is in
the second ink (`tv_servers_on`: `ON`, `EM` in Portuguese), the name is the
one the rows show (`shown`: the TV's RENAME, else the server's own, else its
host), upper case, clipped by an ellipsis at 180 px in a cell at most 200 px
wide, with a hairline either side.

- **When it is drawn.** `+page.svelte` reads `TsundokuTV.servers()` when the
  library mounts, again a tick later (the layout's own mount, which runs
  after the page's, has just told the app the server's name, so a server the
  TV had not named yet shows its name rather than its host), and again
  whenever MORE closes. No bridge, an APK with no `servers` (older than
  c261), an answer that is not JSON, not a list, or a list with anything in
  it that is not a server (`origin` and `shown` strings, `inUse` a boolean),
  one server, and two of which none is in use: no cell, and the bar is as it
  always was.
- **Which one is in use: the page's own server.** The bridge's `inUse` is
  the server with the newest OPENED, and the app writes OPENED only once a
  page has finished loading (`onPageFinished`, above), so the library that
  mounts straight after a switch (SERVERS' OK, 9D's others, S8's OPEN →)
  reads a list whose `inUse` is still the server just left. The page knows
  better: `inUseOf` (`src/routes/servers-in-use.ts`) takes the entry whose
  origin is `location.origin` (the form the app stores, since the layout
  names it by `location.origin`), and falls back to the bridge's flag only
  when no entry is this page's. The cell, SERVERS' ✓ and IN USE, its
  arrival, OK on the one in use and FORGET all read it.
- **↑ reaches it.** From the library's start, ↑ lands on the cell, "the first
  cell ↑ reaches from the library". The wordmark is a link in this bar (it
  is no control in the design's), and it stood over the shelf, so while the
  cell is drawn the wordmark carries `data-focus-skip`: it is not an arrow
  stop, and Tab still reaches it. With one server it is a stop as before.
- **OK** opens MORE straight on SERVERS (`MoreSheet`'s `initial`), probing
  every row, the mark on the first one not in use (S2's own arrival, the
  same as from MORE's row), and the cell drawn pressed while the panel is
  up. BACK closes the panel onto the cell.
- **The list is read, not watched.** The bridge has no event, so a RENAME or
  FORGET made in the app shows in the cell the next time the library loads
  (RENAME is the app's own screen, S5, so returning from it is such a load),
  or when MORE closes. FORGET from inside the panel that leaves one server
  takes the cell away as the panel closes, and the mark goes to MORE, the
  door that still leads to SERVERS.
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
- **Every stored line is read through `Address.originOf`** (`Servers.decode`),
  so an entry written before a normalisation comes back normalised: one with
  its scheme's own port (c261's round 2) or one typed with capitals (c548).
  Two lines that then name one origin are one server, folded on read: the
  one opened last wins (then the one added last), as the list is ordered,
  and a server's name or the TV's name that the winner lacks is taken from
  its twin, the way `move` carries the TV's name across only onto an entry
  with none. The next write saves the folded list.
- **`remember()` adds**, never replaces, and never makes a server the one in
  use: an add left at 9C does not take launch from the library the TV was in.
- **FORGET** removes the entry and expires the cookies the WebView's jar
  sends that origin (`Forget.expiring`: each name written back with
  `Max-Age=0` at `/`, `Secure` on https), then flushes the jar, so adding it
  back pairs with six digits. The jar hands back every server's cookies on
  that host, so FORGET expires this origin's paired name, the old shared
  `tsundoku_paired`, and every cookie that is not a pairing, and never another
  origin's `tsundoku_paired_*` (c530; `Forget.pairedCookie` names it as the
  server does, both read `android/app/src/test/resources/paired-cookies.tsv`). The computer still lists the TV in SETTINGS ›
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
  (`https://appassets.androidplatform.net/pair/index.html`, served by
  `WebViewAssetLoader` since c549; before that `file:///android_asset/…`) or a
  page of a server in the list
  (its exact origin: another port, or the http/https twin, is not it). An
  external link followed from a server's page can no longer forget the list
  or move an entry to itself. **The reads ask it too** (c549, the owner's
  (a), 2026-11-05: the list of servers is the owner's): `servers`,
  `remembered`, `tvAddress`, `prefix` and `network` answer any other page as
  a TV that knows nothing would (`[]`, `""`), never with an exception, and
  `forgetServer` refused answers `""` where it used to hand back the whole
  list: not `[]`, which MoreSheet would read as "the last one is gone" and
  send the TV to 9A with every server still stored. MoreSheet reads anything
  that is not a list as a refusal and changes nothing. The app's own page and a known server's read exactly as before.
  A frame inside a known server's page still reaches every call, read or write:
  a JavaScript interface cannot say which frame called (c549's part (b), "What
  it does not do yet"); the per-message rule that would close it is built and
  unit-tested (`BridgeGuard.allowsMessage`), and not wired.
  `form` and `defaultPort` stay open (the user agent already says which app
  this is, and the port is a constant), and so do `open` and `welcome`:
  FORGET of the server in use calls one of them from the page of the server
  it has just forgotten, and neither goes anywhere but a known server or 9A.
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

- **The wordmark is not an arrow stop while S1's cell is drawn** (above, "The
  bar's server cell"). In the design it is no control at all; in the app it
  is the link home, kept for Tab and the pointer.
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
- **The reads are guarded** (c549, the owner's (a), 2026-11-05; "The store"
  above): another page reads an empty list and empty strings.
- **A frame inside a known server's page still reaches the bridge** (c529,
  c549's part (b), not built in wave 26). A JavaScript interface does not
  say which frame called it, and the guard reads the top-level URL, which a
  frame cannot change. tsundoku draws no third-party frames. The way to
  close it is `WebViewCompat.addWebMessageListener` (androidx.webkit), which
  hands each message its `sourceOrigin` and `isMainFrame`. Wave 26 stopped
  short of the move; wave 29 settled the first two things it needs, and the
  third is the listener itself:
  1. **The app's own page has no rule.** The listener's origin rules take
     http/https hosts, a custom scheme or `*`; nothing in
     `WebViewCompat.addWebMessageListener`'s reference names `file://` or
     says what `sourceOrigin` a `file:///android_asset/` page reports. **Landed
     in wave 29 (c549, step 1):** the page is served by `WebViewAssetLoader`
     at `https://appassets.androidplatform.net/pair/index.html`, an https
     origin `BridgeGuard.ASSET_ORIGIN` names. `MainActivity`'s WebView client
     intercepts that whole host in `shouldInterceptRequest` and answers a path
     the loader does not hold with 404, so a real network answer at the host is
     never trusted; `BridgeGuard.ASSET`, `Back.kt` and the client's failed-load
     and visit checks recognise the page by that https URL and nothing else,
     and `allowFileAccess` is off now that nothing loads a `file://` page.
     Because the page is an ordinary https URL now, the client also refuses
     every navigation into that host (`shouldOverrideUrlLoading`, through
     `BridgeGuard.refusesNavigation`) and answers a sub-frame's request for it
     404 (`BridgeGuard.refusesEmbedding`): otherwise a server's page — or an
     external link followed from one — could set `location` to the asset URL
     with `#connect=`, and the pair page would probe and remember an
     attacker's server with no input from the owner. The app's own `loadUrl`
     never reaches `shouldOverrideUrlLoading`, and the page's own hash changes
     are same-document, so the screens' navigation is unchanged.
     `androidx.webkit:webkit:1.14.0` resolves offline from this machine's
     Gradle cache. `tests/tv-app-pair.e2e.ts` still opens the asset file in a
     browser and is not the loader: the WebView half is JVM-tested where it is
     pure and otherwise unchecked ("What is not verified").
  2. **The library's server cell reads the list synchronously.** It calls
     `servers()` and `JSON.parse`s the answer in its `onMount` and a tick
     later (`readTvServers`). **Landed in wave 29 (c645):** `readTvServers`
     awaits the bridge's answer, so a Promise is read when it lands;
     `refreshTvServers` drops an answer to an older question, and the three
     call sites (the mount, the tick and `closeMore()`'s hand-back) wait for
     it. MoreSheet's own `servers()`/`forgetServer()` reads are still
     synchronous: they wait for step 3, when the transport lands, and a
     refused read still has to read as not a list.
  3. **The rule is decided per message, not per registration.** Origin
     rules are fixed when the listener is added, and the list changes at
     runtime (pairing, FORGET, `move`), so the sound shape is one listener,
     the object named `TsundokuTV` injected where the rule allows, and each
     message refused unless `isMainFrame` is true and its `sourceOrigin` is
     the asset page or `servers.find` knows it: a pure function
     (origin, isMainFrame, known) → allow, next to `BridgeGuard.allows`.
     **That rule is built** (wave 27; round 2 corrected it to judge an origin,
     not a URL): `BridgeGuard.allowsMessage` refuses every sub-frame, trusts a
     main frame whose `sourceOrigin` is exactly `BridgeGuard.ASSET_ORIGIN`
     (`https://appassets.androidplatform.net`, where the asset page is served
     since wave 29) or a known server's origin through `Address.originOf`, and refuses
     everything else: the opaque `"null"`, `about:`, `data:`, `javascript:`,
     and any string that is not an origin (a path, query or fragment, the
     `file://` asset URL included). `MessageGuardTest` pins it over every
     origin-shaped combination, a third-party frame inside a known server's
     page included; nothing calls it yet. Every call
     becomes a message with an id and every
     reply a promise keyed by it, so two calls answered out of order land
     on their own callers, a reply after the page navigated is dropped by
     the page that no longer exists, and a call made before the object is
     there is answered as "no bridge" (the pages already treat a missing
     bridge as a browser). The page side is about 27 calls in
     `assets/pair/index.html`, `surface.ts`, `MoreSheet.svelte`,
     `+layout.svelte`, `pair/tv/+page.svelte`, and every e2e file that
     stands the bridge up, whose stubs must answer late and out of order.
     External links still open inside the WebView, where the guard refuses
     them every write and now every read; opening them outside it would be a
     behaviour change on a TV, not made.
- 9E itself (the computer's) still says nothing of other servers on a first
  pairing, as the design asks: with one server nothing changes.

## Pairing, 9A to 9E

On the computer: SETTINGS › 08 — DEVICES. A friend's install switches WI-FI ON
there first, and the pairing panel then shows THIS COMPUTER'S ADDRESS and,
side by side under it, **six digits in two threes under FOR THE APP · SIX
DIGITS** and the QR a phone's browser scans
(`src/routes/settings/+page.svelte`), each with its countdown. The owner's own
tailnet instance has no WI-FI row at all: there the same six digits are the
section's first row, THE APP, without the QR and with the whole address the app
types (c245, c521). A new code lives for 10 minutes, pairs one device once (a
TV, or since c521 a phone or tablet in the phone app, [`PHONE-APP.md`](PHONE-APP.md)),
and **five wrong tries burn it**; NEW CODE (NEW CODES on a friend's panel) makes
another.

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

The bridge (`PairingBridge.kt`) is what the web page cannot do: the TV's own
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

`versionCode` is the date version as YYYYMMDDNN, so every release is newer to
the installer than the one before, and the app updates itself from the release
host (c614; [`UPDATES.md`](UPDATES.md), "The Android apps"): SETTINGS shows it
as THIS APP, and the library offers it.

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
- **A server typed with capitals (c548).** `Address.originOf` lower-cases the
  scheme and the host and `ServersTest`/`BridgeGuardTest` pin it, but no TV
  has run it. The owner's check: on 9B, TYPE THE WHOLE ADDRESS as
  `http://<Host>:42143` with a capital in the host (the computer's name as
  `hostname` prints it, with its first letter upper case), pair, then on the
  library open MORE › SERVERS: the row is there and IN USE, RENAME saves, and
  after closing and relaunching the app it opens that library, not 9A. Then
  the same with the scheme typed in capitals, `HTTP://<Host>:42143` (and
  `Http://…` if the TV's keyboard capitalises the first letter by itself):
  9B checks and pairs it, not NOTHING ANSWERS (`tv-app-pair.e2e.ts` pins the
  probe's address in a browser; the TV's keyboard is not). A TV that stored
  such an entry before this APK reads it back lower case on the first
  launch.
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
     BACK must climb options → list → MORE. Close MORE: the bar must now
     read `ON <NAME>` after the wordmark, with the one in use. One ↑ from
     the first CONTINUE card must put the mark on it, then OK: SERVERS opens at once, the mark on the other
     server; BACK closes it with the mark on the cell again. Then OK on
     that other server, and look at the cell straight after its library
     opens: it must name the server just opened, not the one just left,
     and OK on it must open SERVERS with IN USE on that one and the mark
     on the other (the app marks a server opened only when its page has
     finished loading; the cell reads the page's own origin for this).
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
     mark, whatever came between, and the app's next `open` of that server
     ends it if that finish never came); this is the check that it holds on
     a TV.
  8. A server that comes back is counted once it opens. With two servers,
     A in use: stop B, open B from MORE › SERVERS (9D appears), start B
     again and press TRY AGAIN. B's library must open, MORE › SERVERS on
     B's page must mark B IN USE (not A), and quitting and launching the
     app again must open B. Round 1 of wave 22 left A in use here when
     WebView sent no finish for B's failed load.
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
- **The reads' guard (c549).** JVM-tested (`PairingBridgeTest`), on the same
  claim as the writes' (the top-level URL, read on the UI thread, within
  2 s). Check, with a debug build and `chrome://inspect`: on a server's
  library, `TsundokuTV.servers()` in the console must print the list (and
  MORE › SERVERS and the bar's server cell must be as before; on 9B the
  prefix must still be the TV's own `192.168.x.`); then
  `location.href = 'https://example.com'`, and on that page
  `TsundokuTV.servers()` must print `[]`, and `TsundokuTV.tvAddress()`,
  `TsundokuTV.remembered()` and `TsundokuTV.network()` an empty string,
  with no exception. A third-party frame inside a server's page is not
  closed yet ("What it does not do yet"): the per-message rule is JVM-tested
  (`MessageGuardTest`) but no listener calls it, so there is no frame check to
  make on a TV.
- **The app's page from `WebViewAssetLoader` (c549, step 1).** Built, and its
  pure parts JVM-tested (`BridgeGuardTest`, `BackTest`, `PairingBridgeTest`);
  that this WebView serves `https://appassets.androidplatform.net/pair/index.html`
  from `assets/pair/index.html` through `shouldInterceptRequest`, and that the
  page's scripts behave the same at an https origin, is the claim: it was
  never run on a television, and `tests/tv-app-pair.e2e.ts` opens the asset
  file in a browser, which is not this loader. Check, on a TV with a debug
  build: pair it from 9A (the page itself must draw, so the loader served it);
  then MORE › SERVERS › a server › FORGET (the sheet's own screen after 9A
  must draw); then from the library BACK out of the pair page (`/pair/tv`)
  must land on the screen before it, not on the app's own page; and with the
  computer switched off, open that server from SERVERS, so 9D draws — the
  failed load's page, not the WebView's grey one. If any of those is blank,
  the loader's path handler is what to look at first. **Then the navigation
  guard (c549, round 2):** from a server's library, open (or type into the
  console) a link to
  `https://appassets.androidplatform.net/pair/index.html#connect=http://example.com:42143`;
  nothing may happen — the page stays where it was, no 9B, no CHECKING, and
  MORE › SERVERS must gain no `example.com` entry. The same URL typed into a
  page's console as `location.href` must be refused the same way, and a
  server page that tries to embed the asset page in a frame must show a 404
  rather than the pair screen.
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

- `android/app/src/test/` — `AddressTest`, `AttemptsTest`, `BackTest`,
  `BridgeGuardTest`, `FailedLoadTest`, `ForgetTest`, `FormTest`,
  `InsetsTest`, `IntentAddressTest`, `KeysTest`, `MessageGuardTest`,
  `NetworkTest`, `PairingBridgeTest`, `ProbeTest`, `ScaleTest`, `ServersTest`,
  `ShortcutsTest` (139 tests in 17 classes per flavor at wave 29), run by `./gradlew testTvDebugUnitTest` (and once more for the phone app's flavor by `testMobileDebugUnitTest`).
  `BridgeGuardTest` (9) includes c549's round-2 case: a navigation to the
  asset host with `#connect=`, `#add` or `#rename=` is refused, a frame's
  request for it is refused, the host is read case-blind, and a known or an
  unknown server's page — and a URL that merely carries the host in a query —
  is not.
  `MessageGuardTest` (8) is c549's part (b), the per-message rule
  `BridgeGuard.allowsMessage`, every input an origin as the listener delivers
  one: a third-party frame inside a known server's page is refused, a known
  origin and `ASSET_ORIGIN` are trusted only as the main frame, a host or
  scheme typed in capitals is the same server by `Address.originOf`'s rule, a
  path or trailing slash in place of an origin is refused, the `file://` asset
  URL cannot pass (no page loads one since the move), and the opaque `null` is
  no page at all. Nothing calls the rule yet.
  `AddressTest` (8) includes c548's case: a host and a scheme typed in
  capitals come back lower case, the same origin `intentOrigin` gives, and
  `originOf` holds on its own output.
  `ServersTest` (23) is c261's store: the migration of a TV paired with one
  address (a list of one, opened, never asked to pair again), an add that
  never takes launch, the last used first and 9D's others, names, encode and
  decode as each other's inverse, an entry stored with its scheme's own port
  (`:443`, `:80`) read back without it, as WebView's URL has it, a mixed-case
  entry read back lower case and found by its page's origin, an add typed in
  capitals stored lower case, and two entries differing only in case folded
  to the one opened last with the names it lacked (c548), forget down to 9A, a server that moved, and
  the JSON the pages read. `ShortcutsTest` (4) is c287's plan (one per
  server, four at most, each link read back through `givenAddress`'s decoding
  and `Address.intentOrigin` to the same origin). `ForgetTest` (5) is FORGET's
  cookie lines, one paired name per origin read from the table the server's
  spec reads too, another origin's pairing kept (c530), and 9E's name from its
  attribute or, for an older server, its first line (c545). `FailedLoadTest`
  (14) is every order WebView may report a failed load in (c532), the app's
  next attempt ending a mark whose finish never came, and `onPageFinished`'s
  decision (`FailedLoad.finish`: a failed `/pair/tv` consumes its mark, a
  loaded one is read for 9E's name, an unknown server is never a visit).
  `BridgeGuardTest` (8) is c529's rule (the asset page by its https URL since
  c549, a known origin, one stored with its scheme's own port, one stored with
  capitals trusted on its lower-case pages (c548), a scheme typed in capitals
  trusted without widening anything (c646), and the refused: unknown origins,
  another port, the http/https twin, the asset page's old `file://` URL and
  other `file://` pages);
  `PairingBridgeTest` (8) calls each guarded method from an
  unknown page and finds nothing changed, from the asset page and a known
  server's and finds it acted; each guarded read (c549) from an unknown page
  reads `[]` or `""` and writes nothing, and from the asset page and a known
  server's reads the list, the server in use, the address, the prefix and
  the network; `forgetServer` refused answers `""`; `form` and `defaultPort`
  answer anyone; and FORGET's `open` and `welcome` still
  answering the page it has just made unknown, and `forget()` from a known
  server's page forgetting every server, its own included. `AttemptsTest` plays the activity's two launch doors in
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
  (c260). A whole address whose scheme is typed in capitals reads as its host
  on CHECKING and on 9D's title, never as `HTTP://…` (c621).
- `tests/tv-app-pair.e2e.ts`, c261's twelve (30 cases in all at wave 27): with a stand-in
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
  0.6 s; forgetting the one in use and the last; a refused FORGET changing
  nothing, and FORGET of the one in use pressed twice opening the next once
  and never 9A (c549, round 2); the layout telling the app,
  and only the app, the server's name; MORE's TO LINK row reached by keys (c475).
  S1 (wave 24, 20 cases): no cell without the bridge, with an APK older than
  c261, with five kinds of answer that are not a list of servers, with two
  servers of which none is in use, or with one server; two put the one in use after the wordmark, the TV's name first, the
  server's own without one, a long one clipped (the `bar` frame's 200 and
  180 px, the rules, `ON` in the second ink); ↑ from the library's start
  reaches it, OK opens SERVERS on the one not in use, MENU and BACK climb as
  from MORE, BACK closes onto the cell, and MORE still opens on its rows;
  OK on the one in use closes onto the cell; FORGET leaving one server takes
  the cell away and the mark to MORE; a rename shows when MORE closes and on a
  reload, not before; MORE opened again while SERVERS is still leaving gives
  focus back to MORE; and `EM` in Portuguese. Right after a switch (the
  page's own server the older, so the stand-in's `inUse` is wrong as the
  app's is), the cell and SERVERS name the server the page is on, the mark
  lands on the other, OK on this one closes, and FORGET of another or of
  this one acts on the right one; a server not named yet shows its name on
  the first library, without MORE. Eight more are c645, with a bridge whose
  `servers()` answers a Promise: a late answer draws the cell when it lands and
  not before, an answer to an older question that lands after a newer one is
  dropped, an answer that lands after the library is left changes nothing
  there, a bridge that throws or answers what is not JSON draws no cell, a
  refused read (`[]` or `""`) that lands late draws none either, and a bridge
  that never answers leaves the page as without one — cell-less, its grid
  drawn, MORE still opening.
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
- `tests/friend-wifi.e2e.ts` — the Wi-Fi panel's FOR THE APP digits, beside
  the browser's QR, under THIS COMPUTER'S ADDRESS (c521).

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
