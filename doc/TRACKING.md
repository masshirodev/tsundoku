# Tracking

tsundoku reads the owner's **AniList** and **MyAnimeList** lists, and moves
them forward from what's read here. It's the second half of card c37 ("Link
series to MyAnimeList / AniList: covers, then tracking"). The first half,
links and covers, is [`LINKS.md`](LINKS.md). A series is tracked through its
link.

- Handoff: `doc/design/handoff/Series Link.dc.html` (the TRACKING row and
  sheet, 1k–1t) and `Catalogue Links.dc.html` (SETTINGS' sign-ins, 1u, 1v).
- Code:
  - `src/lib/library/tracking.ts`: the pure rules.
  - `src/lib/server/tracking.ts`: sign-ins, lists, sends.
  - `src/routes/settings/catalogues/[service]/`: the OAuth way out and back.
  - The series screen's `?/tracking` and `?/retryTracking` actions.
- Rung 27: `tracker_accounts`, `tracker_state`, `tracker_sends`.

## What the owner decided (2026-09-24)

- **Read and write, on both.** AniList is the main list: where the two
  disagree, AniList's word is shown, and MAL's only where AniList has
  nothing.
- **A score fills an unrated series' rating once**, when a link is made from
  the list (Catalogue Links 1w).
- **The rating is the score** (c67, 2026-09-25). Both are out of 10, so
  setting a rating on a linked series sends it as the score, and there is no
  second number ([`RATINGS.md`](RATINGS.md)). Until c67 a rating was never
  sent, and the sheet set a score of its own.

## Signing in

On SETTINGS, **02 — CATALOGUES**. Each catalogue's app is registered by the
owner. Its keys (`ANILIST_CLIENT_ID`/`_SECRET`, `MAL_CLIENT_ID`/`_SECRET`)
are in Infisical and pulled into `.env` ([`SECRETS.md`](SECRETS.md)). Each
app's redirect is registered as exactly
`https://workstation.example.ts.net:8443/settings/catalogues/<anilist|mal>`.

| Catalogue | Grant                                              | Token                                            |
| --------- | -------------------------------------------------- | ------------------------------------------------ |
| AniList   | Authorization code                                 | A year, no refresh. SETTINGS warns a month ahead |
| MAL       | Authorization code, **plain** PKCE (all MAL takes) | 31 days, refreshed with a day left               |

**SIGN IN →** is a full navigation to `/settings/catalogues/<service>`,
which sends the owner to the catalogue. A `state`, and MAL's verifier, wait
in a 10-minute cookie (`tsundoku_oauth`, path `/settings/catalogues`,
`SameSite=Lax` so it rides the way back). The catalogue sends the owner back
to the same address with a code. It's checked against the state, traded for
a token, and the account saved, and the owner lands on SETTINGS with a band
saying how it went. The list is then read in the background.

The session cookie is `Lax` too, so the way back, a top-level GET from the
catalogue, is still signed in.

**Tokens live in the database** (`tracker_accounts`), which stays on the
workstation, as do its backups ([`BACKUPS.md`](BACKUPS.md)). **SIGN OUT**
forgets the token and what waited to be sent. What the list said stays, as
of then.

## Reading the lists

- **When:** straight after a sign-in, and in the pass after every import,
  once links and searches are done (`readLists`).
- **AniList:** `MediaListCollection(type: MANGA)` with each entry's status,
  progress and score as `POINT_10`.
- **MAL:** `/users/@me/mangalist`, paged.

For each linked series, `tracker_state` keeps the list's status (in
tsundoku's words: reading, planning, on hold, completed, dropped), chapter
and score out of 10. A series no longer on a list loses its state. A series
sent to after the read began keeps what the send made of it.

**The AniList list also links.** An entry whose title is sure for exactly
**one** unlinked series in view links it, `via 'list'`. Sure means the same
title rules as the search ([`LINKS.md`](LINKS.md)), and of the series' own
kind, so never a novel to a comic. Its score fills an unrated series' rating.

## Sending

- **What:** the highest chapter read here (`chapterReached`: the entries
  read, rounded down, so an extra's 12.5 counts as 12).
- **When:** a chapter finished in the reader (`/api/reading`, `finish`), a
  MARK READ, or a mark-read-through on the series screen (`afterReading`),
  queued and sent off the request.
- **Only forward** (`progressToSend`): nothing is sent unless it's further
  than the list has and than what already waits. Mihon on the phone can be
  ahead, and a lower chapter is never sent back over it.
- **Status:** a series on nobody's list, or only planned, starts READING.
  Any other status is the owner's and stays.
- **Never:** for a hidden series; while incognito (the reading is never
  recorded, so nothing follows); through a cover-only link (a novel to its
  comic's entry, [`LINKS.md`](LINKS.md)); or for a novel (see "Not yet").

`tracker_sends` holds one row per series and catalogue: the furthest wanted.
It's gone once sent, and `tracker_state` takes the new chapter and
`sent_at`. A send that fails stays with why: **DID NOT ANSWER** (no
answer), **SIGN-IN EXPIRED** (a 401), **REFUSED IT** (anything else). It's
sent again with the next chapter read, or now with **TRY AGAIN** on the
TRACKING row or SETTINGS.

**The sheet** (TRACKING · EDIT, 1m) sets status for both catalogues at once.
A tap sends it; DONE only closes. It has no SCORE row since c67: the score is
the rating, sent when the rating is set. AniList gets it as `scoreRaw` (its 100) whatever format the owner shows, and unrated clears it (0 on both).

## The screens

- **SETTINGS** (1u, 1v): per catalogue, who's signed in and one line:
  - `MAIN LIST · READ AND WRITTEN · LIST READ 14:20`;
  - or `N SERIES NOT SENT · … · 09:14`, with TRY AGAIN;
  - or AniList's sign-in running out within a month;
  - or, not signed in, `N LINKED · SHOWN, BUT NOTHING SENT`.

  A catalogue whose keys aren't in `.env` says **THE APP ISN'T REGISTERED**
  and offers no SIGN IN. Offline, the section says so and its cells dim.

- **The TRACKING row** (1k–1s), under LINK, on a linked series: a line per
  catalogue (`trackLine`), and what was done about it: SENT 12 MIN AGO, NOT
  SENT with why, NOT SIGNED IN, NOT ON YOUR LIST, SHOWN · ANILIST HAS
  NOTHING, or AS OF 14:20 offline. Its cells are TRY AGAIN, SIGN IN → and
  EDIT. A hidden series says **NOTHING SENT · HIDDEN SERIES STAY OFF BOTH
  LISTS**, and a cover-only link says **NEVER TRACKED**.

## Where it departs from the handoff

- **"ANILIST · NOT ON YOUR LIST"** (1p) says **ADDED ON THE NEXT CHAPTER
  READ**, and that's what happens. Nothing is added to a list for reading
  done before the sign-in, since the mock's rule was "the next chapter".
- **Tokens are in the database**, not in Infisical: they're the owner's
  session, made and refreshed by the app, not configuration.
- **A catalogue whose app isn't registered** says so on SETTINGS. The mock
  assumed both were.

## Not yet

- **Novels.** A novel's progress isn't sent. An EPUB's entries are its
  chapters or its volumes, depending on the file, so what counts as a
  chapter on the list needs its own rule. Nor are they on AniList or MAL,
  mostly. They'll be tracked through **Ranobe** (`~/projects/ranobe`, the
  owner's own database) when it's ready, with MangaUpdates as the fallback:
  card c66 ("Track novels through Ranobe, once it's ready"), deferred on
  2026-09-25.
- **MAL search**, for novels AniList lacks ([`LINKS.md`](LINKS.md)), now
  that the client id is here.
- **Reading MAL's list to link.** Only AniList's list links; MAL's only
  gives state.
- **Rereads.** AniList's REPEATING reads as READING, and sending never
  lowers the chapter, so a reread from chapter 1 sends nothing until it
  passes the old chapter.
