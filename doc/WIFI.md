# Reading on a phone over home Wi-Fi

A friend's install answers only its own computer. SETTINGS › 08 — DEVICES ›
WI-FI lets a phone or tablet on the same Wi-Fi in: switched on, the computer
shows a code, and the phone's camera opens it signed in (card c188). The
brief was `doc/briefs/done/WIFI.md`; the design is the handoff
`doc/design/handoff/Wifi*.dc.html` (its decisions in `Wifi Calls.dc.html`).
Tailscale stays the way to give a phone everything ([`RELEASE.md`](RELEASE.md),
the README's "Reading on your phone or tablet").

## What the phone gets, and doesn't

Plain http on a home address (`http://192.168.1.23:42143`), since a home
address has no certificate. Browsers keep some things for https and
localhost, so over Wi-Fi the phone can't install tsundoku as an app, keep
chapters offline, keep the screen awake or check a fingerprint (`/reveal`).
Reading, browsing, search, downloads and every setting work. The page says
so in the WI-FI row's strip, once on the phone's welcome screen, and at the
one control that would act: ↓ CACHE and REMOVE CACHE in a series' SELECT are
dimmed to 0.35 with the reason under them (`window.isSecureContext`). The
CACHED shelf only exists offline, which a phone over Wi-Fi never is.

## How it listens: two doors, one app

In local mode `scripts/serve.ts` doesn't start adapter-node's own server: it
runs the app's handler (`build/handler.js`) on listeners of its own
(`src/lib/server/lan-listen.ts`): 127.0.0.1 always, and each home-network
address while WI-FI is on. SETTINGS switches them through
`globalThis.__tsundokuLan` in the same process (`src/lib/server/wifi.ts`),
so ON never restarts the app.

- **Each request says which door** it came in by: `x-tsundoku-via: local|lan`,
  set by the listener whatever a client sent.
- **No single ORIGIN.** The computer uses localhost, the phone the Wi-Fi
  address, so the origin is each request's Host over plain http
  (adapter-node's `PROTOCOL_HEADER`, set by the listener too). The hook
  refuses a Host that isn't one of ours: over Wi-Fi only the addresses it
  listens on, locally only localhost (127.0.0.1 is still sent there). That
  is the DNS-rebinding guard ([`SIGN-IN.md`](SIGN-IN.md)).
- **Only private clients.** A Wi-Fi listener answers only RFC 1918 addresses,
  whatever a router forwards.
- **Shutting down.** adapter-node's entry closed its server on SIGTERM, and
  the app's workers, which catch SIGTERM to stop cleanly, rely on that to
  exit. serve.ts now does the same for its listeners; without it a Linux
  launcher's SIGTERM left the server running (caught before release, by a
  test server that outlived its run).
- **The switch is the data folder's** (`wifi.json`: on, the last address,
  whether it has ever started), so it survives restarts and serve.ts reads it
  before the database exists.

**Which addresses** (`src/lib/server/lan.ts`, tested in `tests/lan.spec.ts`):
private IPv4 on real adapters, Wi-Fi first, then Ethernet. Docker's,
VirtualBox's, VMware's, WSL's and Hyper-V's switches and VPNs are skipped: a
phone can't reach them. Only a public address (plugged straight into the
modem): ON can't be pressed, and the row says why. None: the panel says NO
ADDRESS and keeps looking. While on, it looks every 15 s and follows a new
address.

## Signing in over Wi-Fi

- **A code** (`src/lib/server/pairing.ts`): one at a time, in memory, 10
  minutes, one phone, once. Its link is `/pair/<code>` (96 random bits). It
  makes the phone a **paired device**: a random token in its cookie
  (`tsundoku_paired_<port>`, named for the origin: below), its SHA-256 in `paired_devices` (v54), the address it
  was paired at, and, once its browser checks in, its DEVICES row. SIGN OUT on
  that row deletes the pairing: at once, no confirm; a new code brings it back.
- **The typed address** opens the sign-in page. With a password set, the
  password signs in (OR SIGN IN WITH THE PASSWORD). With none, nothing does:
  over Wi-Fi a code is the only way in, and no password means this computer
  only. So WI-FI needs no password, and a stranger on the same Wi-Fi gets a
  sign-in page with nothing to type.
- **SET UP** answers only on the computer, and Wi-Fi can't be on before it.
- **Off** stops the listening; paired phones stay paired, and are back when
  it's on again at the same address.
- **One paired cookie per origin** (c530). A browser's jar scopes a cookie
  by host, not port or scheme, so the cookie is named for the origin it
  pairs: `tsundoku_paired_<port>`, with an `s` before the port for https
  (`pairedCookie` in `src/lib/server/pairing.ts`). Two tsundoku on one
  computer then keep their own pairing on a device that has both. Every
  reader goes through `readPaired` (the hook's two doors and `/pair/tv`) or
  `pairedToken` (`/api/devices/sync`), and both writers (`/pair/<code>` and
  `/pair/tv`) set the per-origin name. A device paired before c530 carries
  the one name every server used, `tsundoku_paired`: the server that set it
  signs it in by it and moves it to its own name on that first request
  (expiring the old one with the options it was set with), and any other
  server leaves it alone. `report-scrub.ts` scrubs every paired name.
- **A new address** (the router's choice): the phone's cookie belongs to the
  old one, so it has to scan again. The panel's band says old → new while a
  phone is still paired at the old one, and those rows say PAIRED AT … · SCAN
  AGAIN.

## A firewall on the computer

A friend on Arch (c721, 2026-11-07) switched WI-FI on and the phone found
nothing: on Linux a firewall asks nothing, and a dropped request looks the
same as no computer at all. Windows asks once, with a dialog (STARTING… is
held 4 s for it, below). So under the pairing panel, after NOTHING ANSWERS
ON THE PHONE OR TV? IT HAS TO BE ON THIS SAME WI-FI, a firewall line
(`src/lib/server/firewall.ts`, drawn by `firewallHelp` in
`src/routes/settings/+page.svelte`; its words in `messages/`, English and
Portuguese):

| Platform (the server's)    | The line                                                                               | Under it                                                       |
| -------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Linux, ufw found on        | `UFW IS ON · PORT 42143 MAY BE BLOCKED`                                                | its line to copy, shown at once                                |
| Linux, firewalld found on  | `FIREWALLD IS ON · PORT 42143 MAY BE BLOCKED`                                          | its line to copy, shown at once                                |
| Linux, neither, or unknown | `IF YOUR COMPUTER RUNS A FIREWALL, LET PORT 42143 IN FROM YOUR HOME NETWORK`           | THE LINES TO COPY ↓: ufw's and firewalld's                     |
| Windows                    | `WINDOWS WILL ASK TO LET TSUNDOKU THROUGH ITS FIREWALL · ALLOW IT ON PRIVATE NETWORKS` | PHONE CAN'T CONNECT? ↓: Allow an app through firewall, Private |
| anything else (macOS)      | the general line                                                                       | nothing                                                        |

- **The platform is the server's** (`process.platform`), never the
  browser's user agent. The panel answers only on the computer itself, so
  the two are the same machine; the server is the one that knows.
- **The probe is unprivileged and never sudo**, measured on the
  workstation: `ufw status` refuses without root ("ERROR: You need to be
  root to run this script"), so ufw is on when its unit is active
  (`systemctl is-active ufw`) **and** `/etc/ufw/ufw.conf` says
  `ENABLED=yes`, which is what its boot reads. Both, because Arch ships
  `ENABLED=yes` with the unit not enabled (the workstation: `ENABLED=yes`,
  `inactive`), and Ubuntu keeps the unit active after `ufw disable`.
  firewalld's `firewall-cmd --state` answers without root (`running`, or
  `not running`). An nftables or iptables ruleset can't be read without root
  (`nft list ruleset`: "Operation not permitted"), so it is never named.
  Each command has 2 s; a missing binary, a refusal, an answer it doesn't
  know and a timeout are all unknown, which shows the general line. The
  answer is kept 30 s, since the panel asks every 5 s.
- **The lines carry the running app's port** (the listeners' own, the
  configured app port) **and the computer's own home network**: its address
  with its own adapter's netmask (`homeSubnet` in `src/lib/server/lan.ts`),
  so a /24 home network is `192.168.1.0/24` and a /16 one `10.0.0.0/16`; an
  address no adapter carries any more falls back to its private block
  (`192.168.0.0/16`). ufw: `sudo ufw allow from <network> to any port <port>
proto tcp`. firewalld: a rich rule in the default zone, limited to the
  same network, then `--reload`. tsundoku never runs either: the friend
  does, in a terminal, with their own password.
- **NO PHONE HAS REACHED THIS COMPUTER YET · A FIREWALL?** When a live code
  has been up 30 s and nothing yet shows that a phone can reach this
  computer, the line appears over the firewall's, with its help opened
  under it. Two things show it: a **reach**, and a **paired phone**.
  **Reached** is any request at all a Wi-Fi listener takes from a
  home-network client (`reachedAt` in `src/lib/server/lan-listen.ts`): the
  sign-in page a typed address opens, the pair link, a paired phone's page.
  Any of them proves the firewall lets a phone in. A phone paired with this
  computer (a DEVICES row, `pairedDevices()`) proves it too, so an owner
  whose phones are paired, with none open now, is never asked on a SETTINGS
  visit (round 2 of c721: the line used to fire there, on the kept code,
  every visit). The rule:
  - **The code doesn't restart the wait.** A reach before NEW CODES, or
    before the code SETTINGS renewed, proved the same firewall; NEW CODES
    alone asks nothing again.
  - **New listeners do.** OFF and ON, a moved address (the listeners
    follow it) and a restart forget the reach, since a new listener can
    meet a new rule (a new network, Windows' Public profile); then, on a
    computer no phone is paired with, the code still up asks at once.
  - It clears on the next poll after a phone reaches the computer, or once
    a phone is paired. It is in every answer the panel gets (the load, the
    5 s poll, ON, OFF, NEW CODES: `wifiAnswer` in `src/lib/server/wifi.ts`),
    so a press never drops it; a phone over Wi-Fi is given none of it.
  - A request from the computer itself to its own home address counts as a
    reach today, though local traffic bypasses a firewall: under "What it
    doesn't do yet".
- **The e2e's seams**, read only when set and set by no launcher:
  `TSUNDOKU_FIREWALL_PLATFORM` (`linux`, `win32`, `darwin`),
  `TSUNDOKU_FIREWALL_PROBE` (`ufw`, `firewalld`, `none`) and
  `TSUNDOKU_FIREWALL_QUIET_MS`.

HELP's 04 says the same ([`HELP.md`](HELP.md)).

## A TV's code, typed with a remote

A television has no camera, so beside the phone's link there is a second code
(c236; [`TV-APP.md`](TV-APP.md)): `TvPairing` in `src/lib/server/pairing.ts`,
one at a time.

- **Six digits**, made with `crypto.randomInt`, shown on the computer in two
  threes under FOR THE APP · SIX DIGITS (FOR A TV before c521: the phone app
  pairs with them too, [`PHONE-APP.md`](PHONE-APP.md)), with their own
  countdown. Opening
  SETTINGS makes one when there is none; NEW CODE replaces it and the phone's
  together.
- **Where they show** (c245): in the WI-FI panel's pairing block on a friend's
  install, and on the owner's own tailnet instance — which has no WI-FI panel
  at all — in SETTINGS › 08 — DEVICES itself, a row of the WI-FI row's shape
  with the same block, minus the phone's QR. The row ticks its countdown by
  itself, but the countdown is not the code: a TV that pairs with it, or burns
  it, changes nothing on the computer's page. So the row asks
  `GET /settings/tv` what the code is now, every 5 s while it shows anything
  but a burned code and the page is in view, and once whenever the window
  regains focus or the page becomes visible again (c265; expired since c246,
  used and none since its round 2). That answer is read only
  (`tvCodeNow`): the row draws the code as it is. A used code turns ✓ USED,
  and only then does the page's data reload, which is how the new TV's row
  appears. A burned code shows BURNED and NO TRIES LEFT · MAKE A NEW CODE, and
  the 5 s poll stops (focus still asks). An expired one shows EXPIRED, a used
  one ✓ USED, and the poll goes on: a TV opening `/pair/tv` makes a new code in
  place of an expired one, or of one used over 2 minutes ago (below), and says
  THE NEW ONE IS ON THE COMPUTER, which the row then draws by itself, with no
  focus change (c246; a second TV paired with SETTINGS left on ✓ USED was its
  round 2). With no code at all (the server's memory after a restart, until a
  visit or a TV makes one) the row is still drawn wherever its block is
  (`tvHere`, the load's own `tvBlockHere`): a dim — over NO CODE YET · MAKE A
  NEW CODE (its own line since c580; until then it said EXPIRED · MAKE A NEW
  CODE, about a code that never existed), and NEW CODE, and it is asked about too, since a TV makes a code
  where there is none. Neither burned nor expired is replaced by the
  refresh: the load replaces a spent code (`tvPanel`), so a refresh that made
  one, or reloaded the page's data to get one, would undo the burn within a
  tick, and with SETTINGS in front five wrong tries would lock no one out.
  A new code comes from NEW CODE or from opening SETTINGS again (a real
  visit, never a reload of the page's data: "Which doors make a code", c531),
  and from the TV itself when there is none, or the code has merely run out
  or was used over 2 minutes ago (`/pair/tv`, "Never a dead end" below); a
  burned code only from the computer. Focus alone was not enough: the owner usually keeps SETTINGS in front
  while typing on the TV. An answer is about the code the row showed when it
  asked: one that lands after NEW CODE (or any reload of the page's data) is
  the old code's, burned or used, and is dropped rather than drawn over the
  new live digits (c461). The WI-FI panel's poll drops a late answer the same
  way, after NEW CODE, ON or OFF. NEW CODE is a SETTINGS action, so the code never comes from
  `/api/pair/tv` on a tailnet host. A device signed in by a paired cookie is
  never shown the code. **That row is the token install's alone, on its
  tailnet origin** (`tvBlockFor` in `src/lib/server/pairing.ts`, asked through
  `tvBlockHere` in `src/lib/server/wifi.ts` by the load, NEW CODE's
  `?/tvCode` and `GET /settings/tv` alike). With no `ORIGIN`, or a loopback
  one (`yarn run dev`, `vite preview`, `scripts/serve.ts` in `local` mode),
  the hook refuses every TV's paired cookie, so the row is not drawn and no
  code is made there (c264): a TV paired there would land on `/login`. A
  friend's install served over
  the tailnet has no panel, but its guard still reads a paired cookie only over
  Wi-Fi, so the digits stay wherever its panel would draw them with WI-FI ON.
  Putting them on DEVICES there would pair a TV and land it on `/login`, the
  defect c245 removes; its TV signs in with the friend's password instead.
- **The same limits**: 10 minutes, one TV, once. Six digits is a million
  guesses, so **five wrong tries burn it** and a new code is made on the
  computer; `/pair/tv` answers `ok`, `wrong` (with the tries left), `expired`,
  `used` or `burned`. Codes are compared by SHA-256 digest in constant time,
  so a wrong guess costs the same whatever it shares with the right one.
- **`/pair/tv`** is the TV's side of the pairing (TV-Pair.dc.html, 9C and 9E)
  and is public like `/pair/<code>`: the TV posts the digits same-origin and
  the paired cookie is set exactly as the phone's is
  (`PAIRED_COOKIE_OPTIONS`). It never shows a code: the digits live on the
  computer's screen.
- **The computer's own view** is `GET`/`POST /api/pair/tv`, whose host rule is
  `onComputer(url)`: `localhost`, `127.0.0.1` or `[::1]` only. That holds in
  `local` mode and under `vite dev`/`preview`, where the request URL is built
  from the Host header — a friend's panel reads the code through `wifiView`,
  and a test reads it here. On a served instance the URL is built from `ORIGIN`
  instead (`node_modules/@sveltejs/adapter-node/files/handler.js`), which is
  the tailnet name or address, so the rule refuses every request there, even
  one made at `127.0.0.1` on the computer itself. That is why the tailnet's
  SETTINGS reads the code from the page's own data (`tvPanel`) and never from
  here; the rule stays shut.
- **The app's own screens** before that — 9A, 9B and 9D — are in the APK,
  which finds the computer by probing its web app manifest and remembers the
  address that answered.
- **Never a dead end** (c246; the owner's (b), 2026-11-04). A TV that is not
  paired and opens `/pair/tv` with nothing it can type gets a code made for it
  (`TvPairing.renewForTv`): when there is none yet, when the only one has
  merely expired (the first real TV found one 25 minutes old), and when it was
  used more than the 2 minutes the computer keeps ✓ USED up (by another
  device, or by this TV before it was signed out). A **burned** code is kept,
  even once its 10 minutes have run out: five wrong tries need the computer,
  and the page says NO TRIES LEFT · MAKE A NEW CODE ON THE COMPUTER.
  **Burned is burned on both screens** (c581): `TvPairing.state` answers
  `burned` before it asks the clock, and every door reads it (the DEVICES
  row's refresh, `tvCodeNow`; the WI-FI panel, `wifiView`; `/pair/tv`'s page
  and its PAIR, `redeem`; `/api/pair/tv`). Until c581 the clock was asked
  first, so a burned code past its 10 minutes was EXPIRED on the computer,
  whose row's 5 s poll then started again, and NO TRIES LEFT on the TV, by a
  rule `/pair/tv` kept alone; digits typed then got THAT CODE EXPIRED. A code made this way **keeps the old one's wrong
  tries**: only the owner's doors (NEW CODE, ON, opening SETTINGS) give five
  again, so opening `/pair/tv` every 10 minutes buys no more guesses than
  before. **Both of `renewForTv`'s calls are the owner's** (c577, the owner's
  (a), 2026-11-05): a renewed code keeps the old one's wrong tries, and a used
  code is replaced only once ✓ USED's 2 minutes (`TV_USED_SHOWN_MS`) are over,
  never at once. Wave 22's worker made both alone and c246 (wave 23) kept
  them; the owner ratified them over a renewed code starting at five tries
  and a used code replaced at once, so a guesser still gets five tries per
  code the owner makes, as before c246. Digits typed after their code ran out get THAT CODE EXPIRED · THE
  NEW ONE IS ON THE COMPUTER: the page has just made it. The computer's
  WI-FI panel shows it on its next 5 s poll, and so does the DEVICES row,
  which keeps asking while the code it shows is expired or used, or there is
  none (c246, wave 23 and its round 2;
  `tests/tv-pair-origins.e2e.ts` holds it, with the row's page never
  refocused).
- **The TV in DEVICES** is named by its user agent: the app appends
  `TsundokuTV/<version>`, and `pairedLabel` reads that as "Android TV ·
  Chrome"; `/api/devices/sync` also keeps its kind as `tv` (rung 59, c244).
  In token mode its row says OVER TAILSCALE rather than OVER WI-FI (c245), and
  its cookie signs in only on the instance's public host
  ([`SIGN-IN.md`](SIGN-IN.md), "The workstation: a token").

## The screens

- **SETTINGS › 08 — DEVICES** (`src/routes/settings/+page.svelte`): WI-FI
  between THEME and the devices; OFF | ON, the meta line, the strip; on, the
  pairing panel, arranged around one address since c521
  (PhoneApp-Computer.dc.html): THIS COMPUTER'S ADDRESS across the top, written
  as the app types it (the app takes its last number, a browser all of it),
  then the two ways in side by side. FOR THE APP · SIX DIGITS first and larger:
  two threes, what they are for, their countdown, ONE DEVICE, ONCE. FOR A
  BROWSER · THE PHONE'S CAMERA beside it: the code on a 182 px inverse cell
  (`QrCode.svelte`, encoded in the browser with `uqr`), for a phone without the
  app, and what typing the address in its browser does instead. Under both,
  GOOD FOR N MIN (whole minutes) · EACH SIGNS IN ONE DEVICE, ONCE, and NEW
  CODES, which makes both. It polls `/api/wifi` every 5 s, so the code turns ✓ USED by
  itself and the new phone's row appears, and a TV code five wrong tries
  burned turns BURNED with NO TRIES LEFT · MAKE A NEW CODE (an expired one
  EXPIRED · MAKE A NEW CODE), NEW CODE lit. With no TV code at all the
  panel draws no TV block (`wifiView`'s `tv` is null for `none`), so its
  EXPIRED line is only ever an expired code's; DEVICES' row is the one drawn
  with no code, and says NO CODE YET (c580). That poll reads both codes as they
  are and never makes one (c460). On a phone the row is shown with no
  control (3E). Paired devices' rows carry OVER WI-FI and SIGN OUT. Search
  words: wifi, wi-fi, phone, pair. **On an install with no WI-FI panel** — the
  owner's tailnet one — the same TV block is the section's first row instead:
  label TV, the digits, the countdown and NEW CODE (`tvPanel` in
  `src/lib/server/wifi.ts`; c245), refreshed read-only from `GET /settings/tv`
  (`tvCodeNow`; c265) so it turns ✓ USED, BURNED or EXPIRED by itself, and
  from EXPIRED to the code a TV made in its place (c246), and a paired TV's
  row says OVER TAILSCALE.
- **Which doors make a code** (c460). Only the owner's, on the computer:
  opening SETTINGS there (`wifiView({ renew: true })` and
  `tvPanel({ renew: true })`, which replace a spent code and keep a live or
  just-used one; a real visit only, c531, below),
  NEW CODE and ON (`fresh`: both codes, whatever they are), and the computer's
  own `POST /api/pair/tv`. Every other door reads: the panel's poll
  (`GET /api/wifi`), OFF, the DEVICES row's refresh (`tvCodeNow`), the door
  check every TV door asks (`tvBlockHere`, which asks the listeners,
  `wifiStatus()`, rather than building the view), and SETTINGS opened on a
  phone over Wi-Fi, which is shown no code and so makes none. `/pair/tv`
  makes one when there is none, or the only one has merely expired or was
  used over 2 minutes ago, never over a burned one, and with the old one's
  wrong tries (c246, above). Until c460 the poll and the door
  check replaced a spent code too, so with the panel open five wrong guesses
  bought five more every 5 s.

- **A real visit, not a reload** (c531, the owner's call of 2026-11-04).
  SETTINGS' load runs for a visit and for every reload of the page's data
  alike, and until c531 every run renewed, so a code burned while the owner
  changed an unrelated setting silently came back live. Now only a visit
  renews. A visit as a document (opened, typed, the browser's reload or
  back to a page it dropped) is a GET that is not a data request
  (`settingsVisit` in `src/lib/server/wifi.ts`), and the load renews then. A
  visit by a client-side navigation from another screen (a link, MORE ›
  SETTINGS, the back button) is a data request, which the server can't tell
  from a reload, so the page says so itself: `afterNavigate` sends
  `?/renew`, which renews exactly as the document visit does (never over
  Wi-Fi, the TV's code only where its row is), then reloads the page's data
  to draw it. The page sends it where the WI-FI panel or the TV's row is
  drawn, asked of the server (`data.wifi`, `data.tvHere`), never of the code
  the load returned: after a restart there is no code, `data.tv` is null on
  exactly the visit that must make one, and guarding on it left the owner's
  tailnet install with no code and no row after every restart (wave 23's
  round 2). Not from a phone over Wi-Fi (`data.viaLan`), where `?/renew`
  renews nothing and the reload after it would be wasted. A change of the page's own URL (`?section=`) is not a visit.
  Every reload reads the codes as they are: the WI-FI poll's when a phone
  pairs, the row's refresh when a TV pairs, the check-in on arriving
  (`syncDevice`), every setting (`act()`, NEW CODE's included, whose own
  `fresh` makes its code), the page's `use:enhance` forms (RETRY, SIGN OUT,
  BROWSE's languages, the password, a device's SIGN OUT) and the layout's
  RESCAN and theme change. Why a marker and not a `depends()` key: a key only
  spares a load from `invalidate(key)`, and `invalidateAll()` reruns every
  load whatever it depends on, which the layout and `use:enhance` call
  outside this page's reach (the wave 23 notes, `doc/handoff-notes/tv.md`).

- **`/pair/tv`** (9C, 9E; `src/routes/pair/tv/`): the TV's six digits in two
  threes on the TV layout, PAIR → pressing itself on the sixth, a band for a
  wrong code (with the tries left), a burned, used or expired one; then 9E,
  "The library is on this TV", and OPEN THE LIBRARY →. A band is drawn at 84
  and the label and cells move down under it rather than being covered (c246).
  Public, because the TV is not signed in yet.
- **`/welcome`** (3A): the phone, just paired: what works, what doesn't, how
  to come back (Add to Home screen), OPEN THE LIBRARY →.
- **`/login`** over Wi-Fi: the used or expired code's band (3B, 3C), and the
  field relabelled, or replaced by ONLY A CODE SIGNS IN HERE.

## Where it departs from the handoff

- **"Your token signs in"** (the panel, the phone's sign-in page): the handoff
  was drawn before friends had passwords (c189). It's the password, OR SIGN IN
  WITH THE PASSWORD; with none set, ONLY A CODE SIGNS IN.
- **The code's modules.** The handoff draws 25 at 9 px, "a picture of a code,
  not a code". A real one for the pairing link is 29 to 33 modules, drawn to
  fill the same 225 px inside the same 273 px inverse cell.
- **The help line under the panel** was NOTHING ANSWERS ON THE PHONE OR
  TV? IT HAS TO BE ON THIS SAME WI-FI, AND WINDOWS HAS TO HAVE BEEN TOLD
  ALLOW ACCESS, which said nothing to a friend on Linux (c721). Its Wi-Fi
  half stays; the firewall's own line, per platform, follows it ("A
  firewall on the computer").
- **STARTING… is held 4 s the first time on Windows.** Listening takes
  milliseconds, so the state that names the firewall dialog would only flash;
  held, it's up while the dialog appears.
- **The ✓ USED code stays up** on the open panel until NEW CODE, and a page
  opened within 2 minutes of the use keeps it too; "opening the page always
  makes a fresh code" otherwise holds (a live code is kept, counting down). A
  fresh code on every load replaced the code the phone had just used, as the
  panel reloaded to list it. An expired or burned code also stays, drawn as
  such, until NEW CODE or the page is opened again (c460).

## What it doesn't do yet

- A `.local` name (mDNS) that survives a new address: the handoff left it out,
  since Android resolves them unreliably.
- The phone browser's own "can't be reached" page at an old address: plain
  http has no service worker to draw anything else.
- An nftables or iptables firewall named: its ruleset can't be read
  without root, so the general line stands for it (c721).
- Proven with a real phone: the release smoke test's phone is the workstation,
  across the real network to Zen (`ops/release/smoke/windows-wifi.ps1`), with
  the firewall rule a friend's Allow click makes added by the test, since the
  dialog only appears to someone at the desktop.
- The launcher's console doesn't print the Wi-Fi address.
- A request from the computer's own address to its home address isn't told
  apart from a phone's, so the owner trying the QR's link in a second tab on
  the computer clears NO PHONE HAS REACHED, though local traffic bypasses a
  firewall (review of c721, round 2, low). Not done: the e2e's "phone" is
  this machine on its own home address too, so the tests would first need a
  seam that marks their requests as from elsewhere.

## Tests

`tests/lan.spec.ts` (addresses, the code's life, labels),
`tests/wifi-db.spec.ts` (c531: `settingsVisit` over every request the load
runs for, the load itself burned through reloads and renewed by a document
visit, `tvPanel` with and without `renew` in every state, and `?/renew`
renewing at the computer and not over Wi-Fi; c460: which doors may make a code; the door check,
the poll and OFF leave a burned, expired or used code as it is, in every
state a TV code can be in, and only the load's renew, NEW CODE and ON make
one; c581: a burned code read `burned` either side of its 10 minutes and long
after, by `tvCodeNow`, `tvPanel`, `wifiView`, `/api/pair/tv`, `/pair/tv`'s
load and its PAIR with the right digits, and an unburned one still expiring),
and `tests/friend-wifi.e2e.ts` on the friend project's install, served by
serve.ts so the listeners are the real ones on this machine's home address:
off, ON with a code and the address, a TV code burned by five wrong tries
over the Wi-Fi drawn BURNED by the panel's poll with the same burned code on
the server two polls later, and live again only from NEW CODE (c460), a phone
context scanning it to the
welcome screen and the library, the panel turning ✓ USED by itself and the
phone's row with SIGN OUT, the same code refused as used, the typed address
with no password, the phone's own SETTINGS, a paired phone reopening
SETTINGS over Wi-Fi after five wrong tries burned the TV's code and the
server still holding that same burned code (c460: the phone's load does not
renew; a case of its own with no computer page open, because the panel's
reload when a phone pairs renewed until c531), a foreign Host refused over
Wi-Fi, SIGN OUT, and OFF closing the door while localhost goes on. The
handoff's measurements are pinned there. The TV's code has its own:
`tests/pairing-tv.spec.ts` (once, 10 minutes, five tries, every answer,
`renewForTv` over every state and the tries it carries,
`tailnetDoor`: the public host opens, loopback and no origin never do,
`tvBlockFor`: the DEVICES row is the token install's only and never without a
door, `tvDoor` reading `ORIGIN` as the hook does, and `friendPaired`: a
friend's cookie signs in only over Wi-Fi),
`tests/settings-devices.e2e.ts` (two token installs of its own, one with a
tailnet `ORIGIN` and one with none: no row, no code and a refused `?/tvCode`
without the door; a code a TV uses turning ✓ USED on focus and on the row's
5 s tick with no NEW CODE press; a burned one drawn BURNED on the page's
return and on the tick alone, the server's code still the same burned one
after 15 s and a focus, and a live one back only from NEW CODE; the poll
asking six times in 30 s, not reset by the countdown; and a refresh answered
after NEW CODE, for the old burned code, leaving the new one live, with only
that first ask held, c461) and
`tests/tv-pair.e2e.ts` (the computer's `/pair/tv` on the `tv` project: a wrong
code, the tries left, the right one landing on 9E, five wrong ones burning
it; with no WI-FI panel, the six digits in DEVICES and NEW CODE; a request
carrying only the paired cookie reaching `/` and `/settings` on the tailnet
host and landing on `/login` at localhost),
`tests/tv-pair-origins.e2e.ts` (servers of its own with their clocks moved:
an expired code made new by `/pair/tv` and paired, a used one kept for ✓
USED's 2 minutes, a burned one kept past its 10 minutes, c246; the DEVICES
row still BURNED past those 10 minutes, on a focus and with no 5 s poll, as
`/pair/tv` says, c581; two servers
on one host each keeping its own pairing, and the old name moved, c530;
and the computer's DEVICES row, open in a browser of its own and never
refocused, turning EXPIRED and then drawing the code the TV made, then ✓
USED, c246; with no code at all, after a start, the library's MORE ›
SETTINGS making one, and the row with `?/renew` refused drawing NO CODE YET
and NEW CODE, c531's round 2 and c580, each case on a server of its own
started for it, so neither depends on its place in the file, c582),
`tests/pairing-origins.spec.ts` (the per-origin names, the move from the old
one, the scrub); `tests/firewall-domain.spec.ts` (c721: the probe's reading
of each answer, a missing binary and a timeout as unknown, the commands, a
/24, /16 and /20 network and the fallback, when NO PHONE HAS REACHED shows
and that a reach before the code or a paired phone keeps it quiet, and the
panel's answer over both doors) and `tests/friend-firewall.e2e.ts`
(an install per case with the platform and the probe faked: the general
line and its commands, ufw and firewalld named, Windows and its fix, the
Portuguese, and NO PHONE HAS REACHED appearing, clearing when a phone's
request arrives; and, on an install of its own, staying away after a scan
and NEW CODES past the wait and a reload, then asking again after OFF and
ON);
`tests/friend-pair-firefox.e2e.ts` (c723: a pair link opened in Firefox
with three sets of HTTPS prefs and in Chromium as a Pixel 7, through a
logging relay, lands on the welcome screen in one navigation, signed in;
and c722's tick on GET STARTED); `friend-wifi.e2e.ts` also pins
the panel's FOR THE APP digits and its arrangement around the address.
