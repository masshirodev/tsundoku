# Privacy: incognito, leaving the app, and the fingerprint gate

These three extend reveal ([`LIBRARY.md`](LIBRARY.md), "Hidden means hidden").
Design: `doc/design/handoff/Index Addendum.dc.html` and `Addendum States.dc.html`.
Brief: `doc/briefs/done/BOOKS-ADDENDUM.md`, section 1.

## Incognito

Reading that leaves no trace: no progress, no log row, no history, nothing in
CONTINUE. **The row is never written.** It isn't written and then hidden.

- **Turned on by typing `/incognito`** in search, like `/reveal`. It's a
  separate command, not part of reveal. If it came on with reveal, hidden
  books could never be read or be in progress, and the series-of-books screen
  depends on both. Hiding already keeps a hidden book's traces out of view:
  CONTINUE and history drop hidden series while reveal is off.
- **Where it's enforced:** `POST /api/reading` is the reader's one progress
  call. While the `tsundoku_incognito` cookie is set, it answers
  `{ saved: false }` and never reaches `recordReading()`. The guarantee lives
  on the server, where the reader can't forget it. The reader shows NOT SAVED
  from that answer.
- **What still saves:** rating and FAV. They're deliberate edits, not traces.
  MARK READ still saves too, for the same reason.
- **How it shows:** outside the reader, a panel band reads **INCOGNITO ·
  NOTHING SAVED** with END. Dashed is Index's "not stored yet"; magenta stays
  reveal's. In the reader (card c13), a 2px dashed rule runs along the top
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

## The fingerprint gate for `/reveal` (deferred)

Optionally, `/reveal` would ask for the device's fingerprint or screen lock
through WebAuthn before anything hidden appears. The design is drawn (`fpPrompt`,
`fpFail`, `fpCancel`): the prompt is Android's own, and the search screen
behind it shows nothing hidden. It isn't built, because **WebAuthn needs a
secure context and tsundoku is served over plain http on the tailnet**. It
waits on serving over HTTPS with `tailscale cert`, which service workers and
installing the PWA also need. The card for it is on the Tsundoku board.
