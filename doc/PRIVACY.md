# Privacy: incognito, leaving the app, and the fingerprint gate

These three extend reveal ([`LIBRARY.md`](LIBRARY.md), "Hidden means hidden").
Design: `doc/design/handoff/Index Addendum.dc.html` and `Addendum States.dc.html`.
Brief: `doc/briefs/done/BOOKS-ADDENDUM.md`, section 1.

## Incognito

Reading that leaves no trace: no progress, no log row, no history, nothing in
CONTINUE. **The row is never written.** It isn't written and then hidden.

- **Turned on by typing `/incognito`** in any top search bar (c697;
  [`BROWSE.md`](BROWSE.md), "Commands in every top search bar"), like
  `/reveal`. It's a
  separate command, not part of reveal. If it came on with reveal, hidden
  books could never be read or be in progress, and the series-of-books screen
  depends on both. Hiding already keeps a hidden book's traces out of view:
  CONTINUE and history drop hidden series while reveal is off.
- **Where it's enforced:** `POST /api/reading` is the reader's one progress
  call. While the `tsundoku_incognito` cookie is set, it answers
  `{ saved: false }` and never reaches `recordReading()`. The guarantee lives
  on the server, where the reader can't forget it. The reader shows NOT SAVED
  from that answer.
- **A reader opened incognito sends nothing at all** (c680). The cookie alone
  is not enough: leaving the app ends incognito in a beacon while the reader
  keeps running until the return takes it away (step 2 and step 3, below), so
  a page still settling, a finish or the close on the way out would reach the
  server with no cookie and be written as ordinary reading. The image reader,
  the text reader and the player each check what they opened with
  (`data.incognito`) before every `POST /api/reading`; the server's answer is
  the second line, not the only one. `tests/privacy-flow.e2e.ts` reads one of
  each in incognito, leaves the app, and checks the log and `last_opened_at`
  are where they were.
- **What still saves:** rating and FAV. They're deliberate edits, not traces.
  MARK READ still saves too, for the same reason.
- **How it shows:** outside the reader, a panel band reads **INCOGNITO ·
  NOTHING SAVED** with END. Dashed is Index's "not stored yet"; magenta stays
  reveal's. In the reader ([`READER.md`](READER.md)), a 2px dashed rule runs along the top
  edge, with an INCOGNITO cell and NOT SAVED on the meta line.
- A **session cookie**, and it also ends when the app goes to the background
  (below). END ends it by hand.

## Leaving the app

`PrivacyShield` (`src/lib/components/chrome/PrivacyShield.svelte`) sits in the
root layout:

1. On `visibilitychange` to hidden, it covers the page at once with the
   graphite ground and the wordmark, so the recent-apps thumbnail shows
   nothing. It does this every time, since it costs nothing.
2. If reveal or incognito was on, it sends a beacon to `POST /leave`, which
   deletes both cookies.
3. On return, if either was on, it posts `/leave` again (the beacon may not
   have gone out), then lands on the library with fresh data and **no
   message**. Otherwise it simply uncovers the page where it was.

**Unloading isn't leaving.** A reload, a full navigation or a form POST without
JavaScript also fires `visibilitychange`. Treated as leaving, typing
`/incognito` in search would have ended `/reveal`. Unloading fires `pagehide`
first, so the shield ignores a hide that follows one.
`tests/privacy-flow.e2e.ts` checks both paths.

**Best effort, and nothing claims otherwise.** Android may take its thumbnail
before the event fires, and a PWA can't block screenshots. The design says
neither, and neither does the code.

**Known gap:** closing the app outright (swiping it away) is an unload, so
the shield doesn't end the modes. They're session cookies, so a real browser
restart ends them, but an Android PWA may keep its session across a swipe.
If that turns out to happen on the tablet, the fix is a server-side idle
expiry on both cookies.

## The fingerprint gate for `/reveal`

Once a device is enrolled, `/reveal` needs that device's fingerprint or screen
lock: a WebAuthn assertion from a **platform** authenticator, with user
verification **required**. The prompt is Android's own. tsundoku draws only
the COMMAND row behind it, which holds nothing hidden (the addendum's
fpPrompt, fpFail and fpCancel states).

- **`/lock`** enrols the device you're on. It's allowed while there is no gate
  yet, or while reveal is on, that is, only by someone already past the gate.
  More than one device can be enrolled.
- **`/reveal`** asks `/api/unlock/options`. With no device enrolled, it's the
  plain command it always was. With one, the device signs a fresh challenge,
  `/api/unlock/verify` checks it (origin, relying party, user verified,
  counter), and only then sets the reveal cookie. It is typed in any top search
  bar too (c697), but only `/search` draws the device prompt: behind a gate
  every other bar opens `/search` with the command and its intent in history
  state, and the prompt rises there (c711). That answer from
  `src/routes/api/command/+server.ts` turns nothing on: only the device's
  signature does, and a link cannot carry the intent (a `?go=1` in the URL is
  taken off and runs nothing, c710). A TV has no fingerprint and no screen
  lock, so it refuses `/reveal` from every bar, `/search` included, before
  anything else is asked (`NOT ON A TV · TURN REVEAL ON FROM THE COMPUTER`,
  [`TV.md`](TV.md)).
- **`/unlock`** removes the gate. That also takes the fingerprint: otherwise
  anyone holding the session could remove the gate and then reveal.
- **The server enforces it,** not the page. While the gate is on, a plain POST
  of `/reveal` (a browser without JavaScript, a crafted request) does nothing:
  `runCommand` refuses it.
- **Ceremonies** are single-use, expire in two minutes, and are tied to the
  browser by an httpOnly, `SameSite=Strict` cookie. Credentials are the
  `unlock_credentials` table (rung 8).
- **A refused fingerprint and a cancelled prompt look the same** from the
  browser: both are `NotAllowedError`. So both show the design's failure
  state, NOT UNLOCKED with TRY AGAIN and "FINGERPRINT NOT ACCEPTED · NOTHING
  SHOWN / SCREEN LOCK ALSO WORKS", rather than guessing which it was. That's a
  departure from fpCancel, which drew a cancel as the field emptied.

WebAuthn needs a secure context, which the tailnet now provides
([`SERVING.md`](SERVING.md)). The relying party is whatever host the app is
served on: the tailnet name in production, localhost in development and
tests. `tests/unlock-gate.e2e.ts` runs the whole flow with Chromium's virtual
authenticator, including a refused fingerprint. It runs as its own Playwright
project after all the others, because enrolling gates `/reveal` for the shared
database.

## What an import reports

An import takes everything in the file or folder whatever the reveal mode,
hidden series and a hidden root's (Hentoid) included: the owner's decision of
2026-11-07 (c633), because a friend can't be expected to know to turn hidden
mode on first. The screen that says what it brought keeps the rule even so:
with reveal off, what belongs to hidden series is a **count in a section
closed by default** (`3 IN HIDDEN SERIES`; the owner, 2026-11-08), never a
title or a Work's name, and those appear only with reveal on.
[`IMPORT.md`](IMPORT.md), "The log", has the rule and the doors it holds at.
