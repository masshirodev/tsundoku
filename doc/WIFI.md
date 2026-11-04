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
  (`tsundoku_paired`), its SHA-256 in `paired_devices` (v54), the address it
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
- **A new address** (the router's choice): the phone's cookie belongs to the
  old one, so it has to scan again. The panel's band says old → new while a
  phone is still paired at the old one, and those rows say PAIRED AT … · SCAN
  AGAIN.

## A TV's code, typed with a remote

A television has no camera, so beside the phone's link there is a second code
(c236; [`TV-APP.md`](TV-APP.md)): `TvPairing` in `src/lib/server/pairing.ts`,
one at a time.

- **Six digits**, made with `crypto.randomInt`, shown on the computer in two
  threes under FOR A TV · SIX DIGITS, with their own countdown. Opening
  SETTINGS makes one when there is none; NEW CODE replaces it and the phone's
  together.
- **Where they show** (c245): in the WI-FI panel's pairing block on a friend's
  install, and on the owner's own tailnet instance — which has no WI-FI panel
  at all — in SETTINGS › 08 — DEVICES itself, a row of the WI-FI row's shape
  with the same block, minus the phone's QR. The row ticks its countdown by
  itself, but the countdown is not the code: a TV that pairs with it, or burns
  it, changes nothing on the computer's page. So the row asks
  `GET /settings/tv` what the code is now, every 5 s while it shows a live
  code and the page is in view, and once whenever the window regains focus or
  the page becomes visible again (c265). That answer is read only
  (`tvCodeNow`): the row draws the code as it is. A used code turns ✓ USED,
  and only then does the page's data reload, which is how the new TV's row
  appears. A burned code shows BURNED and NO TRIES LEFT · MAKE A NEW CODE, an
  expired one EXPIRED, and the 5 s poll stops (focus still asks). Neither is replaced by the
  refresh: the load replaces a spent code (`tvPanel`), so a refresh that made
  one, or reloaded the page's data to get one, would undo the burn within a
  tick, and with SETTINGS in front five wrong tries would lock no one out.
  A new code comes from NEW CODE or from opening SETTINGS again (or any
  change made on the page, which reloads its data the way opening it does);
  that is `/pair/tv`'s rule too, whose `ensureCode` never replaces a spent
  code. Focus alone was not enough: the owner usually keeps SETTINGS in front
  while typing on the TV. NEW CODE is a SETTINGS action, so the code never comes from
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
  address that answered. A TV that opens `/pair/tv` before anyone opened
  SETTINGS gets a code made for it, so it is never a dead end.
- **The TV in DEVICES** is named by its user agent: the app appends
  `TsundokuTV/<version>`, and `pairedLabel` reads that as "Android TV ·
  Chrome"; `/api/devices/sync` also keeps its kind as `tv` (rung 59, c244).
  In token mode its row says OVER TAILSCALE rather than OVER WI-FI (c245), and
  its cookie signs in only on the instance's public host
  ([`SIGN-IN.md`](SIGN-IN.md), "The workstation: a token").

## The screens

- **SETTINGS › 08 — DEVICES** (`src/routes/settings/+page.svelte`): WI-FI
  between THEME and the devices; OFF | ON, the meta line, the strip; on, the
  pairing panel: the code on an inverse cell (`QrCode.svelte`, encoded in the
  browser with `uqr`), what to do, GOOD FOR N MIN (whole minutes), the address
  in text and what typing it does, NEW CODE. Under the phone's address, the
  TV's six digits in two threes (FOR A TV · SIX DIGITS) with their own
  countdown. It polls `/api/wifi` every 5 s, so the code turns ✓ USED by
  itself and the new phone's row appears. On a phone the row is shown with no
  control (3E). Paired devices' rows carry OVER WI-FI and SIGN OUT. Search
  words: wifi, wi-fi, phone, pair. **On an install with no WI-FI panel** — the
  owner's tailnet one — the same TV block is the section's first row instead:
  label TV, the digits, the countdown and NEW CODE (`tvPanel` in
  `src/lib/server/wifi.ts`; c245), refreshed read-only from `GET /settings/tv`
  (`tvCodeNow`; c265) so it turns ✓ USED, BURNED or EXPIRED by itself, and a
  paired TV's row says OVER TAILSCALE. **The WI-FI panel's poll still
  replaces a burned TV code** (`wifiView`): on a friend's install, five wrong
  tries buy five more within 5 s while the panel is open. That predates c265
  and is a follow-up (doc/handoff-notes/tv-app.md, Gaps).

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
- **STARTING… is held 4 s the first time on Windows.** Listening takes
  milliseconds, so the state that names the firewall dialog would only flash;
  held, it's up while the dialog appears.
- **The ✓ USED code stays up** until NEW CODE, or for 2 minutes after it was
  used; "opening the page always makes a fresh code" otherwise holds (a live
  code is kept, counting down). A fresh code on every load replaced the code
  the phone had just used, as the panel reloaded to list it.

## What it doesn't do yet

- A `.local` name (mDNS) that survives a new address: the handoff left it out,
  since Android resolves them unreliably.
- The phone browser's own "can't be reached" page at an old address: plain
  http has no service worker to draw anything else.
- Proven with a real phone: the release smoke test's phone is the workstation,
  across the real network to Zen (`ops/release/smoke/windows-wifi.ps1`), with
  the firewall rule a friend's Allow click makes added by the test, since the
  dialog only appears to someone at the desktop.
- The launcher's console doesn't print the Wi-Fi address.

## Tests

`tests/lan.spec.ts` (addresses, the code's life, labels), and
`tests/friend-wifi.e2e.ts` on the friend project's install, served by
serve.ts so the listeners are the real ones on this machine's home address:
off, ON with a code and the address, a phone context scanning it to the
welcome screen and the library, the panel turning ✓ USED by itself and the
phone's row with SIGN OUT, the same code refused as used, the typed address
with no password, the phone's own SETTINGS, a foreign Host refused over
Wi-Fi, SIGN OUT, and OFF closing the door while localhost goes on. The
handoff's measurements are pinned there. The TV's code has its own:
`tests/pairing-tv.spec.ts` (once, 10 minutes, five tries, every answer,
`tailnetDoor`: the public host opens, loopback and no origin never do,
`tvBlockFor`: the DEVICES row is the token install's only and never without a
door, `tvDoor` reading `ORIGIN` as the hook does, and `friendPaired`: a
friend's cookie signs in only over Wi-Fi),
`tests/settings-devices.e2e.ts` (two token installs of its own, one with a
tailnet `ORIGIN` and one with none: no row, no code and a refused `?/tvCode`
without the door; a code a TV uses turning ✓ USED on focus and on the row's
5 s tick with no NEW CODE press; a burned one drawn BURNED on the page's
return and on the tick alone, the server's code still the same burned one
after 15 s and a focus, and a live one back only from NEW CODE; and the poll
asking six times in 30 s, not reset by the countdown) and
`tests/tv-pair.e2e.ts` (the computer's `/pair/tv` on the `tv` project: a wrong
code, the tries left, the right one landing on 9E, five wrong ones burning
it; with no WI-FI panel, the six digits in DEVICES and NEW CODE; a request
carrying only `tsundoku_paired` reaching `/` and `/settings` on the tailnet
host and landing on `/login` at localhost); `friend-wifi.e2e.ts` also pins
the panel's FOR A TV digits.
