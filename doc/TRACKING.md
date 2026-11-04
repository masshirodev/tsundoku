# Tracking

tsundoku reads the owner's **AniList** and **MyAnimeList** lists, and moves
them forward from what's read here. It's the second half of card c37 ("Link
series to MyAnimeList / AniList: covers, then tracking"). The first half,
links and covers, is [`LINKS.md`](LINKS.md). A series is tracked through its
link.

- Handoff: `doc/design/handoff/Series Link.dc.html` (the TRACKING row and
  sheet, 1k–1t) and `Catalogue Links.dc.html` (SETTINGS' sign-ins, 1u, 1v).
  Since c424 the series screen's half is `doc/handoffs/series-lists/`: LINK
  and TRACKING are one LISTS row, and the sheet gained ENTRY
  ([`SERIES.md`](SERIES.md), "LISTS").
- Code:
  - `src/lib/library/tracking.ts`: the pure rules.
  - `src/lib/server/tracking.ts`: sign-ins, lists, sends.
  - `src/routes/settings/catalogues/[service]/`: the OAuth way out and back.
  - The series screen's `?/tracking` and `?/retryTracking` actions;
    `src/routes/series/[id]/lists.ts` (what each LISTS line says) and
    `TrackingSheet.svelte` (EDIT's sheet).
- Rung 27: `tracker_accounts`, `tracker_state`, `tracker_sends`.
- Rung 62 (c240): `series_season_links`, `season_link_searches`,
  `season_link_candidates`, `season_link_decisions`, `season_tracker_state`,
  `season_tracker_sends` -- an anime, tracked a season at a time.

## What the owner decided (2026-09-24)

- **Read and write, on both.** AniList is the main list: where the two
  disagree, AniList's word is shown, and MAL's only where AniList has
  nothing, or is signed out while MAL is signed in (c424, round 2).
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
forgets the token and what waited to be sent -- a series' sends and an
anime's season sends alike (wave 17). What the list said stays, as of then.

## Reading the lists

- **When:** straight after a sign-in, and in the pass after every import,
  once links and searches are done (`readLists`).
- **AniList:** `MediaListCollection` for **both** lists, `MANGA` and
  `ANIME` (c298), with each entry's status, progress and score as
  `POINT_10`.
- **MAL:** `/users/@me/mangalist` and `/users/@me/animelist`, paged. MAL
  keeps anime progress as `num_episodes_watched` where a manga's is
  `num_chapters_read`, and its ids are two sequences: the state is filed
  under `anime:<id>` or `comic:<id>` (`stateKey`, `family()`'s two words),
  never one map keyed by id
  alone (wave 10's 23-is-both bug).

For each linked series, `tracker_state` keeps the list's status (in
tsundoku's words: reading, planning, on hold, completed, dropped), chapter
and score out of 10. A series no longer on a list loses its state. A series
sent to after the read began keeps what the send made of it.

**An anime is one row a season** (c240): `season_tracker_state`, keyed by
the series, the season and the part, keeps each season's own entry's status,
episode and score. Reading the list fills them from the season links'
ids, exactly as `series_links` is filled for a comic. An anime's own
`series_links` row, where it has season links, is only a mirror of its
first season (`syncSeriesLink`) and is not read as the series' entry: that
season's row already says what the list has (wave 17). Neither AniSkip nor
Jellyfin's `tvshow.nfo` reads it any more: each reads the season rows
(c349, c381; doc/ANIME.md). An anime linked before rung 62 kept its
one `series_links` link and its series-level `tracker_state` row, which no
anime screen read, until rung 68 (c383) moved both onto the season the link
stood for (`season_tracker_state`, and a waiting `tracker_sends` row to
`season_tracker_sends`; doc/LINKS.md, "A link from before the seasons"). A
season row written since wins over the moved one.

**The AniList list also links.** An entry whose title is sure for exactly
**one** unlinked series in view links it, `via 'list'`. Sure means the same
title rules as the search ([`LINKS.md`](LINKS.md)), and of the series' own
kind, so never a novel to a comic. Its score fills an unrated series' rating.
An anime's entry links one **season** (c240): the one whose own title it
names (`Sword Art Online Season 3`), else the one being watched, and the row
lands in `series_season_links` with the list's score on it. The series is
offered while any season is still open, but a season already linked or
settled is never replaced from the list (`linkSeasonFromList` writes nothing):
an entry found by the series' own title names its first season, and one that
only shares that title, a movie say, is not the owner's link. Nor is an entry
another season or part of the show already holds (`linkSeason` refuses it at
every door, wave 17 round 2; [`LINKS.md`](LINKS.md), "One season, one entry").

## Sending

- **What, on a comic:** the highest chapter read here (`chapterReached`: the
  entries read, rounded down, so an extra's 12.5 counts as 12).
- **What, on an anime:** the season's highest watched episode, counted within
  the season (`watchedReached`) -- or within its part, where a catalogue
  split one season in two. EP. 15 of a season whose part 1 is 12 episodes is
  part 2's EP. 3, and part 1 completes itself at 12. A recap and a half
  number (S3's 14.5) are never sent, and an episode past the last part's
  count waits: `EP. 13 WAITS · ANILIST LISTS 12`.
- **Where:** AniList's `ANIME` entry (`SaveMediaListEntry`), and MAL's
  `/anime/<id>/my_list_status` with `num_watched_episodes` -- never the
  manga's endpoint or `num_chapters_read` (c240). An anime's target is one
  season's link; a manga's is the series' own.
- **When:** a chapter finished in the reader (`/api/reading`, `finish`), a
  MARK READ, a mark-read-through on the series screen, or an episode's
  watched mark in the player (the ending's start, or SKIP ENDING, which
  sends `finish` too) -- queued by `afterReading` and sent off the request.
- **Only forward** (`progressToSend`): nothing is sent unless it's further
  than the list has and than what already waits. Mihon on the phone can be
  ahead, and a lower chapter is never sent back over it. A season is its own
  row, so one season's send never lowers or raises another's.
- **Status:** a series (or season) on nobody's list, or only planned, starts
  READING (WATCHING on an anime's row). On an anime, the part's last counted
  episode watched sends COMPLETED with it -- over READING or PLANNING, never
  over ON HOLD or DROPPED: those are the owner's and stay, and only the
  episode goes (`progressToSend`). Any other status is the owner's and stays.
- **The rating** (c67) goes to the season being watched only (c240): a
  series has one rating and four entries, and sending it to all of them
  would overwrite the scores earlier seasons already have. The sheet shows
  each other season's own score as it read it.
- **Never:** for a hidden series; while incognito (the reading is never
  recorded, so nothing follows); through a cover-only link (a novel to its
  comic's entry, [`LINKS.md`](LINKS.md)); through a link whose entry is the
  other kind; for a season with no link; or for a novel (see "Not yet").

`tracker_sends` holds one row per series and catalogue: the furthest wanted.
It's gone once sent, and `tracker_state` takes the new chapter and
`sent_at`. An anime's waits in `season_tracker_sends`, one row a season and
part, so a failure on one season never holds another's send up. A send that fails stays with why: **DID NOT ANSWER** (no
answer), **SIGN-IN EXPIRED** (a 401), **REFUSED IT** (anything else). It's
sent again with the next chapter read, or now with **TRY AGAIN** on its line
on LISTS or on SETTINGS. A line's TRY AGAIN is that line's: a season's names
its season, and `sendPending({ season })` sends that season's alone; a
comic's sends both its catalogues, MAL riding on AniList's line (c424).
SETTINGS' TRY AGAIN still retries every send of one catalogue.

**The sheet** (EDIT on a LISTS line; 1m, redrawn by c424's 1E) opens on that
line's entry: ENTRY (the ids, where the link came from, OPEN ↗, CHANGE,
UNLINK), then STATUS, which it sets for both catalogues at once.
A tap sends it; DONE only closes. It has no SCORE row since c67: the score is
the rating, sent when the rating is set. AniList gets it as `scoreRaw` (its 100) whatever format the owner shows, and unrated clears it (0 on both).

## The screens

- **SETTINGS** (1u, 1v): per catalogue, who's signed in and one line:
  - `MAIN LIST · READ AND WRITTEN · LIST READ 14:20`;
  - or `N SERIES NOT SENT · … · 09:14`, with TRY AGAIN -- N counts a
    series' failed sends and an anime's failed season sends together, as TRY
    AGAIN retries both (wave 17);
  - or AniList's sign-in running out within a month;
  - or, not signed in, `N LINKED · SHOWN, BUT NOTHING SENT`.

  The catalogues' line above them, `N LINKED · M TO REVIEW`, counts a linked
  anime once, by any of its season links, whether or not its first season's
  mirror is there (`linkCount`), and M counts an anime's open seasons one
  review item each ([`LINKS.md`](LINKS.md)) (wave 17).

  A catalogue whose keys aren't in `.env` says **THE APP ISN'T REGISTERED**
  and offers no SIGN IN. Offline, the section says so and its cells dim.

- **LISTS** (c424; [`SERIES.md`](SERIES.md), "LISTS", has every state):
  TRACKING is no longer a row of its own. Each list's word is on its line,
  beside the entry: AniList's, with MAL folded into it (`ANILIST AND MAL ·
SENT 12 MIN AGO`) and given a quiet line of its own only where it differs
  (signed in or out where AniList isn't, a failed send, another word or
  chapter: `MAL AT CH. 198` / `NOT SIGNED IN · NOTHING SENT`; when AniList
  is the one signed out, MAL's word leads and AniList's is the quiet line,
  `mainList` in `lists.ts`), and Ranobe's
  ([`RANOBE.md`](RANOBE.md)). What was done about it is on the right: SENT
  12 MIN AGO, SENDING, NOT SENT with why in ink, NOT SIGNED IN, NOT ON YOUR
  LIST with when it will be (ADDED ON THE NEXT CHAPTER READ, or EPISODE
  WATCHED), SHOWN · ANILIST HAS NOTHING, or AS OF 14:20 offline. A line's
  cells are TRY AGAIN, SIGN IN → and EDIT; a hidden series says **NOTHING
  SENT · HIDDEN SERIES STAY OFF EVERY LIST** (with seasons, once, on the
  strip), a cover-only link **COVER AND DETAILS ONLY · NEVER TRACKED**, and a
  novel's AniList line **COVER AND DETAILS · TRACKED ON RANOBE**
  (`Tracking.catalogueTracks`, the same rule `targets` sends by).
- **An anime has a line a season** (c240): `WATCHING · EP. 8 OF 24 · 7` /
  `ANILIST AND MAL · SENT 12 MIN AGO` on the season being watched; every
  other season carries its word alone (`COMPLETED · 25 OF 25 · 8`). `PART 2
· ` leads the part being watched, the other part's word on the right
  (`PART 1 COMPLETED`) and the send under it. Three seasons or fewer have a
  line each; more fold round the one being watched (`S1 – S2 · ↑ COMPLETED ·
SHOW`), and SHOW opens the row. A season with no link says why in the
  search's or the decision's own words, with FIND. TRY AGAIN is per season,
  and a failed send is its own season's, in ink. A flat list or a show of one
  season is one ANILIST line, and names no season anywhere (c423).
- **EDIT is one season at a time** (c240): a tab per season across the
  top, opening on the line EDIT was pressed on; a tab reads `S3 EP. 8 / 24`,
  `S1 COMPLETED` or `S4 NOT LINKED`, and a not-linked tab's ENTRY offers
  FIND. STATUS goes to that season's entry on both catalogues; a season's
  first episode watched sends WATCHING and its last COMPLETED, and ON HOLD
  and DROPPED are the owner's: never overwritten, the last episode included.
  PROGRESS shows that season's part, and the other part under it. With
  nothing signed in, STATUS says NOTHING SIGNED IN and offers nothing to
  send. Ranobe is one line under the seasons (`WATCHING · EP. 57 OF 96`),
  counted straight through ([`RANOBE.md`](RANOBE.md), "Anime"), and its EDIT
  is the same sheet with nothing to set.

## Where it departs from the handoff

- **The rating reaches only the season being watched**, which is what
  "Which season does the sheet edit?" recommends; sending one rating to four
  entries would overwrite the owner's earlier scores. The sheet draws each
  other season's score read-only, from the list.
- **PLANNING moves to WATCHING with the first episode watched.** Track
  Calls (question 2) lists PLANNING with ON HOLD and DROPPED as statuses
  that are "never overwritten", but its own sentence before that sends
  WATCHING on the first episode, and a planned comic has always started
  READING here. So ON HOLD and DROPPED are the owner's, even at the last
  episode (only the episode goes); PLANNING is not.
- **A fold is drawn only when it would hold more than one season**: the
  design says so, and a fold of one is just that season's line.
- **"ANILIST · NOT ON YOUR LIST"** (1p) says **ADDED ON THE NEXT CHAPTER
  READ**, and that's what happens. Nothing is added to a list for reading
  done before the sign-in, since the mock's rule was "the next chapter".
- **Tokens are in the database**, not in Infisical: they're the owner's
  session, made and refreshed by the app, not configuration.
- **A catalogue whose app isn't registered** says so on SETTINGS. The mock
  assumed both were.

## Not yet

- **Rereads of a season**, and a season's own date or notes: only status,
  progress and score are written.
- **Novels on AniList and MAL.** A novel's progress isn't sent to either.
  Novels go to **Ranobe** instead, the owner's own catalogue: card c66
  ("Track novels through Ranobe, once it's ready"), [`RANOBE.md`](RANOBE.md).
  There the edition's table of contents says what counts as a chapter.
  Comics go to both since 2026-10-14: AniList as here, and Ranobe as the
  work's own chapters (card c98, [`RANOBE.md`](RANOBE.md), "Comics").
- **MAL search**, for novels AniList lacks ([`LINKS.md`](LINKS.md)), now
  that the client id is here.
- **Reading MAL's list to link.** Only AniList's list links; MAL's only
  gives state.
- **Rereads.** AniList's REPEATING reads as READING, and sending never
  lowers the chapter, so a reread from chapter 1 sends nothing until it
  passes the old chapter.
