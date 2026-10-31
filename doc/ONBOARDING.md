# GET STARTED: a new library's four steps

What a friend's empty install shows instead of "Nothing imported yet" (card
c208). The brief was [`briefs/GETTING-STARTED.md`](briefs/GETTING-STARTED.md);
the design is the Getting Started handoff, `doc/design/handoff/Start-*.dc.html`
(its decisions in `Start Calls.dc.html`). Its other half, the update modal,
is [`UPDATES.md`](UPDATES.md), "Told on entry"; HELP is [`HELP.md`](HELP.md).

## The steps

| #   | Step                             | Ticks itself when                                    | Its link (and trip)                     |
| --- | -------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| 01  | Add a repository                 | a repository of any kind is kept                     | ASK: EXTENSIONS › REPOSITORIES, `?add=` |
| 02  | Install an extension             | an extension or a novel plugin is installed          | AVAILABLE EXTENSIONS →                  |
| 03  | Bring a library you already have | a series the viewer may see is in the library        | START SCAN, here                        |
| 04  | Read on your phone               | a phone pairs, or any phone or tablet has checked in | SETTINGS › 08 — DEVICES →               |

- **What's there decides, not a press** (`src/lib/server/start.ts`, a few
  COUNT(\*)s the layout asks on every page). The rules are pure,
  `src/lib/library/start.ts`.
- **02 waits on 01**: `After 01 · no repository, so nothing to install`.
- **SKIP on any step, UNDO brings it back.** Skipping 01 takes 02 with it
  (`Skipped with 01`, no UNDO of its own: 01's brings both). Skips are kept on
  the computer (the `start_skipped` setting), so the PC and a paired phone
  show the same list. Done wins over a skip kept from before.
- **Finished** is every step done or skipped: the list stops appearing by
  itself and the sidebar's row goes.
- **01 names no repository.** It says where one comes from (ask the friend
  who gave you tsundoku, or search), what each kind holds and its file name,
  and offers three search phrases to COPY (no clipboard over plain-http
  Wi-Fi: the words are there to type). The owner, 2026-10-30: "we don't point
  the user at it, but we give them all the tools they need to find it".

## Where it shows

- **The empty library** is the list (`00 — GET STARTED`, `Nothing here
yet.`) until it's finished; then the first day (board 3): `Everything is
one search away.`, the sources' search, the sources with BROWSE →, and the
  library folder with START SCAN. With no sources at all, just the folder.
- **`/start`**, a page of its own: the same list, on any install, finished or
  not, so the owner's workstation shows what friends get. HELP's first topic
  opens it.
- **The sidebar's foot** starts with `GET STARTED 2 / 4` (accent count) until
  it's finished; on the tablet and phone, MORE's first row. The count is done
  and skipped together: how far through the list, as its own head says done
  and skipped apart.

## The way back

The owner's worry was how a friend gets back to the list after a step sent
them off. A step's link starts a **trip** (`src/lib/start-trail.svelte.ts`):
the screen it opens wears one band under its top bar
(`src/lib/components/start/StartTrail.svelte`): `← GET STARTED · 01 OF 04 ·
ADD A REPOSITORY · TICKS ITSELF WHEN ONE IS ADDED`, with ✕. When the step
ticks, `✓ 01 DONE · A REPOSITORY ADDED`, what's still open, and BACK TO GET
STARTED → in accent. While the step is still to do the band asks for the
list every 5 s (`invalidate('tsundoku:start')`), so a phone pairing ticks it
without a reload.

- It lasts across the screen's tabs and its own redirects; it ends with ✕,
  with the way back, or when the screen is left any other way. Opening
  EXTENSIONS on one's own never starts one.
- **Kept in the tab's sessionStorage, not the URL**: EXTENSIONS redirects to
  `?tab=repos` after adding a repository, which would drop a parameter, and
  the band with it, at the moment the step ticks.

## Where it departs from the handoff

- **04 ticks on any phone or tablet that has checked in**, not "a second
  device signed in over Tailscale": which door a device came in by isn't
  recorded. A paired phone, or a phone or tablet in DEVICES, ticks it.
- **No "Wi-Fi needs a password first" state.** The handoff drew one for an
  install with no password, but Wi-Fi pairing needs none: with no password,
  only a code signs in ([`WIFI.md`](WIFI.md)). Tailscale does need one, and
  its way says so.
- **The done row's meta** counts (`Done · 2 repositories`), without the
  repository's kind: a Mihon or Aniyomi repository's kind isn't kept.
- **02's open body leaves out** `LANGUAGES COME FROM SETTINGS · EN`.
- **`/start` on the desktop** has the empty library's heading
  (`Four things to set up.`); the handoff drew only the phone's page.

## What it doesn't do yet

- The Aniyomi and LNReader backup rows are drawn dimmed, NOT YET: card c190.
- **It teaches setting up, not reading.** A second part, FIRST READ (05 find
  something, 06 add it to the library, 07 download chapters), is decided and
  waiting on its design: [`briefs/FIRST-READ.md`](briefs/FIRST-READ.md).

## Tests

`tests/start-domain.spec.ts` (what ticks a step, SKIP and UNDO, 01 taking
02, finished, the words), and `tests/start-flow.e2e.ts` on its own preview
with an emptied database: the list on the empty library, ASK handing the
address to EXTENSIONS with the band, a tab keeping it and ✕ ending it, a
pairing ticking it by itself with BACK TO GET STARTED, leaving the screen
ending the trip, SKIP and UNDO, the sidebar's and MORE's rows, and the first
day once everything is skipped; `tests/start-frame.e2e.ts`, generated from
`Start-Checklist.dc.html`, pins the checklist's measurements on `/start`.
