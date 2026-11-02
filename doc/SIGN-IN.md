# Signing in

tsundoku has one reader and no accounts, so signing in is one secret shared by
every browser. There are two kinds of install, and they sign in differently.

| Install                                         | Signs in with                  | Kept in                       |
| ----------------------------------------------- | ------------------------------ | ----------------------------- |
| The workstation (served from the checkout)      | `TSUNDOKU_TOKEN`               | Infisical, pulled into `.env` |
| A friend's (a release, started by its launcher) | a password they chose, or none | `TSUNDOKU_HOME/login.json`    |

Which one is `TSUNDOKU_LOGIN`: the launcher sets it to `password`
(`ops/release/launcher/plan.ts`) **unless the data folder's `.env` names a
`TSUNDOKU_TOKEN`**, and then the token signs in as on the workstation. That's
for the workstation running the same bundle as its friends (c228, decided with
the owner on 2026-11-01: "password when no token is set"); a friend's install
never has a token, so nothing changes for them.

## The workstation: a token

Unchanged since the start: `TSUNDOKU_TOKEN`, typed once per browser at
`/login`, and a session cookie derived from it (`src/lib/server/session.ts`),
so rotating the token signs everything out. Without one in production the app
answers 503. [`SECRETS.md`](SECRETS.md) says where it lives.

**A TV paired on the tailnet signs in with its own cookie** (c245). The six
digits on SETTINGS › 08 — DEVICES ([`WIFI.md`](WIFI.md), "A TV's code") are
typed into `/pair/tv`, which sets the same `tsundoku_paired` cookie a phone's
link does; `hooks.server.ts` then accepts it in token mode for a request whose
Host is the instance's public origin — the tailnet name `tailscale serve`
answers on, or the tailnet address in plain-http mode (`ORIGIN`, as
`scripts/serve.ts` sets it). On `localhost`, `127.0.0.1` or `[::1]` it is
ignored, and when no origin is known no paired cookie is accepted at all:
fail closed (`tailnetDoor` in `src/lib/server/pairing.ts`). The TV's DEVICES
row carries SIGN OUT, like a phone's. The token still opens every browser;
this only saves typing 24 characters with a remote.

## A friend's install: a password, or none (c189)

Releases up to 2026.10.30.2 made a token on first start and printed it in the
launcher's console window. A friend didn't see it there and was stuck at the
sign-in page; the owner, 2026-10-30: "make the user set a password (or none) on
first open", with an "are you sure?" for none.

**SET UP.** Until `login.json` exists, every page is `/setup` (the API answers
401). It offers a password, typed twice (at least 6 characters), or NO
PASSWORD, which first says what it means: anyone at this computer opens the
library, and nothing else can reach it. Choosing either signs this browser in
and opens the library. The page reuses the sign-in page's parts and wasn't
drawn in a handoff; the owner can ask for one.

**`login.json`** (`src/lib/server/login.ts`) holds the kind, an scrypt hash
(`scrypt$N$r$p$salt$key`, Node's defaults, about 50 ms), never the password,
and a random secret the session cookie is derived from. Setting, changing or
removing the password makes a new secret, so every other browser has to sign
in again. Written whole and renamed into place, mode 600. Read on every
request, kept while its mtime is the same, so a reset takes effect at once.

**No password is for this computer only.**

- SET UP answers only in local mode (`TSUNDOKU_SERVE=local`), where the app
  listens on 127.0.0.1 alone: off it, whoever reached SET UP first would
  claim the library.
- `serve.ts` refuses to start in `https` or `http` mode (Tailscale) unless a
  password is set, and says how to set one. The hook checks again: a `none`
  login counts as signed in only in local mode.
- SETTINGS offers REMOVE only in local mode.

Over Wi-Fi (c188, [`WIFI.md`](WIFI.md)) the rule holds without asking for a
password: a request that comes in by the Wi-Fi door is never signed in by
"none", only by a pairing code's cookie or the password. So WI-FI can be on
with no password, and a stranger on the same Wi-Fi meets a sign-in page with
nothing to type.

**Another site's name.** In local mode a request whose Host isn't
`localhost:<port>` (or 127.0.0.1 / [::1], which are sent to localhost) is
refused, 403 (`foreignHost` in `bind.ts`). A web page can point a name of its
own at 127.0.0.1 (DNS rebinding) and talk to the app as its own origin, which
the origin check can't see; with no password that check would be all there
is.

**Wrong passwords** wait 400 ms before the answer (`slowDown`), on top of
scrypt's own time: a phone on the same Wi-Fi (c188) could otherwise try
thousands a minute.

**SETTINGS > 08 — DEVICES > PASSWORD** (`src/routes/settings`): SET, CHANGE
(the current password, then the new one twice) and REMOVE (the current
password, then a confirmation). Changing it keeps this browser signed in.

**Forgot it.** Being at the PC is the proof the library is yours:
`tsundoku --reset-password`, or the Start-menu shortcut "Reset tsundoku
password" the installer adds, deletes `login.json`. The next page is SET UP
again; the library isn't touched. It works while tsundoku runs. The sign-in
page says so under the field.

**Updating from 2026.10.30.x.** The first open after the update is SET UP.
The old `TSUNDOKU_TOKEN` line in the data folder's `.env` is left there and
unused.

## Tests

`tests/login.spec.ts` (the hash, the file, the reset), `tests/bind.spec.ts`
(`foreignHost`), and `tests/friend-signin.e2e.ts`, which runs against a
friend's install of its own in the browser suite (`tests/friend-setup.ts`, the
`friend` project): SET UP, NO PASSWORD's question, a password set twice, a
second browser signing in, CHANGE and REMOVE in SETTINGS, the reset, and a
foreign Host refused. The release smoke test sets a password through SET UP
on every bundle ([`RELEASE.md`](RELEASE.md), "Smoke test").
