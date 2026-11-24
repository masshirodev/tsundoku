# Tracking

tsundoku reads the reader's **AniList** and **MyAnimeList** lists, and moves
them forward from what's read here. Links and covers, the other half, are
[`LINKS.md`](LINKS.md). A series is tracked through its link. On the series
screen, the link and its tracking are one LISTS row
([`SERIES.md`](SERIES.md), "LISTS").

- Code:
  - `src/lib/library/tracking.ts`: the pure rules.
  - `src/lib/server/tracking.ts`: sign-ins, lists, sends.
  - `src/routes/settings/catalogues/[service]/`: the OAuth way out and back.
  - The series screen's `?/tracking` and `?/retryTracking` actions;
    `src/routes/series/[id]/lists.ts` (what each LISTS line says) and
    `TrackingSheet.svelte` (EDIT's sheet).
- Migration 27: `tracker_accounts`, `tracker_state`, `tracker_sends`.
- Migration 62: `series_season_links`, `season_link_searches`,
  `season_link_candidates`, `season_link_decisions`, `season_tracker_state`,
  `season_tracker_sends` -- an anime, tracked a season at a time.

## Ground rules

- **Read and write, on both.** AniList is the main list: where the two
  disagree, AniList's word is shown, and MAL's only where AniList has
  nothing, or is signed out while MAL is signed in.
- **A score fills an unrated series' rating once**, when a link is made from
  the list.
- **The rating is the score.** Both are out of 10, so setting a rating on a
  linked series sends it as the score, and there is no second number
  ([`RATINGS.md`](RATINGS.md)).

## Signing in

On SETTINGS, **06 — CATALOGUES**. Each catalogue's app is registered by
whoever runs the install. Its keys (`ANILIST_CLIENT_ID`/`_SECRET`,
`MAL_CLIENT_ID`/`_SECRET`) are in `.env` ([`SECRETS.md`](SECRETS.md)). Each
app's redirect is registered as exactly
`<ORIGIN>/settings/catalogues/<anilist|mal>`, for example
`https://<machine>.<tailnet>.ts.net:8443/settings/catalogues/anilist`.

| Catalogue | Grant                                              | Token                                            |
| --------- | -------------------------------------------------- | ------------------------------------------------ |
| AniList   | Authorization code                                 | A year, no refresh. SETTINGS warns a month ahead |
| MAL       | Authorization code, **plain** PKCE (all MAL takes) | 31 days, refreshed with a day left               |

**SIGN IN →** is a full navigation to `/settings/catalogues/<service>`,
which sends the reader to the catalogue. A `state`, and MAL's verifier, wait
in a 10-minute cookie (`tsundoku_oauth`, path `/settings/catalogues`,
`SameSite=Lax` so it rides the way back). The catalogue sends them back
to the same address with a code. It's checked against the state, traded for
a token, and the account saved, and they land on SETTINGS with a band
saying how it went. The list is then read in the background.

The session cookie is `Lax` too, so the way back, a top-level GET from the
catalogue, is still signed in.

**Tokens live in the database** (`tracker_accounts`), which stays on the
computer that serves tsundoku, as do its backups ([`BACKUPS.md`](BACKUPS.md)). **SIGN OUT**
forgets the token and what waited to be sent -- a series' sends and an
anime's season sends alike. What the list said stays, as of then.

## Reading the lists

- **When:** straight after a sign-in, and in the pass after every import,
  once links and searches are done (`readLists`).
- **AniList:** `MediaListCollection` for **both** lists, `MANGA` and
  `ANIME`, with each entry's status, progress and score as
  `POINT_10`.
- **MAL:** `/users/@me/mangalist` and `/users/@me/animelist`, paged. MAL
  keeps anime progress as `num_episodes_watched` where a manga's is
  `num_chapters_read`, and its ids are two sequences: the state is filed
  under `anime:<id>` or `comic:<id>` (`stateKey`, `family()`'s two words),
  never one map keyed by id
  alone (23 can be both a manga and an anime). The word is the linked entry's, from its
  format, not the series' kind: a manga linked to a MAL anime entry reads the
  anime list's row, not another work's on the manga list. With no
  format yet, the series' own kind decides.

For each linked series, `tracker_state` keeps the list's status (in
tsundoku's words: reading, planning, on hold, completed, dropped), chapter
and score out of 10; an anime's episodes are on its season rows, below. A
series no longer on a list loses its state. A series sent to after the read
began keeps what the send made of it.

**An anime is one row a season**: `season_tracker_state`, keyed by
the series, the season and the part, keeps each season's own entry's status,
episode and score. Reading the list fills them from the season links'
ids, exactly as `series_links` is filled for a comic. An anime's own
`series_links` row, where it has season links, is only a mirror of its
first season (`syncSeriesLink`) and is not read as the series' entry: that
season's row already says what the list has. AniSkip and Jellyfin's
`tvshow.nfo` read the season rows too (doc/ANIME.md). Migration 68 moves an
anime's older series-level link and `tracker_state` row onto the season the
link stood for (`season_tracker_state`, and a waiting `tracker_sends` row to
`season_tracker_sends`; doc/LINKS.md, "A link from before the seasons"). A
season row written since wins over the moved one.

**The AniList list also links.** An entry whose title is sure for exactly
**one** unlinked series in view links it, `via 'list'`. Sure means the same
title rules as the search ([`LINKS.md`](LINKS.md)), and of the series' own
kind, so never a novel to a comic. Its score fills an unrated series' rating.
An anime's entry links one **season**: the one whose own title it
names (`Sword Art Online Season 3`), else the one being watched, and the row
lands in `series_season_links` with the list's score on it. The series is
offered while any season is still open, but a season already linked or
settled is never replaced from the list (`linkSeasonFromList` writes nothing):
an entry found by the series' own title names its first season, and one that
only shares that title, a movie say, is not the reader's link. Nor is an entry
another season or part of the show already holds (`linkSeason` refuses it on
every path; [`LINKS.md`](LINKS.md), "One season, one entry").

## Sending

- **What, on a comic:** the highest chapter read here (`chapterReached`: the
  entries read, rounded down, so an extra's 12.5 counts as 12).
- **What, on an anime:** the season's highest watched episode, counted within
  the season (`watchedReached`) -- or within its part, where a catalogue
  split one season in two. EP. 15 of a season whose part 1 is 12 episodes is
  part 2's EP. 3, and part 1 completes itself at 12. A recap and a half
  number (S3's 14.5) are never sent, and an episode past the last part's
  count waits: `EP. 13 WAITS · ANILIST LISTS 12`. A part 2 with no part 1
  beside it (a library may hold one) sends nothing until part 1 is
  linked again: part 1's count is what places it, and that count is recorded
  nowhere once its row is gone. Its own count cannot place it either, since
  the list may hold only part of a season still airing.
- **Where:** AniList's `ANIME` entry (`SaveMediaListEntry`), and MAL's
  `/anime/<id>/my_list_status` with `num_watched_episodes` -- never the
  manga's endpoint or `num_chapters_read`. An anime's target is one
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
  over ON HOLD or DROPPED: those are the reader's and stay, and only the
  episode goes (`progressToSend`). Any other status is the reader's and stays.
- **The rating** goes to the season being watched only: a
  series has one rating and four entries, and sending it to all of them
  would overwrite the scores earlier seasons already have. The sheet shows
  each other season's own score as it read it.
- **Never:** for a hidden series; for a series whose source is **NEVER
  TRACKED** (a switch on that source's settings page,
  [`BROWSE.md`](BROWSE.md), "A source's own switches"); while incognito (the
  reading is never recorded, so nothing follows); through a cover-only link (a
  novel to its comic's entry, [`LINKS.md`](LINKS.md)); through a link whose
  entry is the other kind; for a season with no link; or for a novel (see "Limits").

  NEVER TRACKED is asked at the one gate every send is queued through —
  `targets()` in `src/lib/server/tracking.ts` — and again where the queue is
  drained: `sendPending` asks it per series and prunes what waits for a target
  that is gone, so a row queued before the switch went on is **dropped** at the
  next drain, not sent and not kept; turning the switch off again sends nothing
  retroactively, and the next chapter read queues from what the list says then.
  Ranobe asks the same switch in `worksOf`, in `refreshUnits` (a unit another
  series shares counts no read from it), in `resolveEditions` (no edition is
  suggested for its novels) and in `flush`'s drain: its unsent reads and a
  work's rating or FAV are **kept**, as a hidden series' are, and go once the
  switch is off: never-tracked is an extra clause at each of those places, not
  hidden's `ELIGIBLE_SQL`. The series
  screen's LISTS row says `NOTHING SENT · ITS SOURCE IS NEVER TRACKED` on every
  line and offers no EDIT or TRY AGAIN.

`tracker_sends` holds one row per series and catalogue: the furthest wanted.
It's gone once sent, and `tracker_state` takes the new chapter and
`sent_at`. An anime's waits in `season_tracker_sends`, one row a season and
part, so a failure on one season never holds another's send up. A send that fails stays with why: **DID NOT ANSWER** (no
answer), **SIGN-IN EXPIRED** (a 401), **REFUSED IT** (anything else). It's
sent again with the next chapter read, or now with **TRY AGAIN** on its line
on LISTS or on SETTINGS. A line's TRY AGAIN is that line's: a season's names
its season, and `sendPending({ season })` sends that season's alone; a
comic's sends both its catalogues, MAL riding on AniList's line.
SETTINGS' TRY AGAIN retries every send of one catalogue.

**The sheet** (EDIT on a LISTS line) opens on that
line's entry: ENTRY (the ids, where the link came from, OPEN ↗, CHANGE,
UNLINK), then STATUS, which it sets for both catalogues at once.
A tap sends it; DONE only closes. It has no SCORE row: the score is
the rating, sent when the rating is set. AniList gets it as `scoreRaw` (its 100) whatever score format the account shows, and unrated clears it (0 on both).

## The screens

- **SETTINGS**: per catalogue, who's signed in and one line:
  - `MAIN LIST · READ AND WRITTEN · LIST READ 14:20`;
  - or `N SERIES NOT SENT · … · 09:14`, with TRY AGAIN -- N counts a
    series' failed sends and an anime's failed season sends together, as TRY
    AGAIN retries both;
  - or AniList's sign-in running out within a month;
  - or, not signed in, `N LINKED · SHOWN, BUT NOTHING SENT`.

  The catalogues' line above them, `N LINKED · M TO REVIEW`, counts a linked
  anime once, by any of its season links, whether or not its first season's
  mirror is there (`linkCount`), and M counts an anime's open seasons one
  review item each ([`LINKS.md`](LINKS.md)).

  A catalogue whose keys aren't in `.env` says **THE APP ISN'T REGISTERED**
  and offers no SIGN IN. Offline, the section says so and its cells dim.

- **LISTS** ([`SERIES.md`](SERIES.md), "LISTS", has every state): tracking is
  not a row of its own. Each list's word is on its line,
  beside the entry: AniList's, with MAL folded into it (`ANILIST AND MAL ·
SENT 12 MIN AGO`) and given a quiet line of its own only where it differs
  (signed in or out where AniList isn't, a failed send, another word or
  chapter: `MAL AT CH. 198` / `NOT SIGNED IN · NOTHING SENT`; when AniList
  is the one signed out, MAL's word leads and AniList's is the quiet line,
  `mainList` in `src/lib/library/tracking.ts`; a season's other part, on the
  right, asks the same rule), and Ranobe's
  ([`RANOBE.md`](RANOBE.md)). What was done about it is on the right: SENT
  12 MIN AGO, SENDING, NOT SENT with why in ink, NOT SIGNED IN, NOT ON YOUR
  LIST with when it will be (ADDED ON THE NEXT CHAPTER READ, or EPISODE
  WATCHED), SHOWN · ANILIST HAS NOTHING, or AS OF 14:20 offline. A line's
  cells are TRY AGAIN, SIGN IN → and EDIT; a hidden series says **NOTHING
  SENT · HIDDEN SERIES STAY OFF EVERY LIST** (with seasons, once, on the
  strip), a cover-only link **COVER AND DETAILS ONLY · NEVER TRACKED**, and a
  novel's AniList line **COVER AND DETAILS · TRACKED ON RANOBE**
  (`Tracking.catalogueTracks`, the same rule `targets` sends by).
- **An anime has a line a season**: `WATCHING · EP. 8 OF 24 · 7` /
  `ANILIST AND MAL · SENT 12 MIN AGO` on the season being watched; every
  other season carries its word alone (`COMPLETED · 25 OF 25 · 8`). `PART 2
· ` leads the part being watched, the other part's word on the right
  (`PART 1 COMPLETED`) and the send under it. Three seasons or fewer have a
  line each; more fold round the one being watched (`S1 – S2 · ↑ COMPLETED ·
SHOW`), and SHOW opens the row. A season with no link says why in the
  search's or the decision's own words, with FIND. TRY AGAIN is per season,
  and a failed send is its own season's, in ink. A flat list or a show of one
  season is one ANILIST line, and names no season anywhere.
- **EDIT is one season at a time**: a tab per season across the
  top, opening on the line EDIT was pressed on; a tab reads `S3 EP. 8 / 24`,
  `S1 COMPLETED` or `S4 NOT LINKED`, and a not-linked tab's ENTRY offers
  FIND. STATUS goes to that season's entry on both catalogues; a season's
  first episode watched sends WATCHING and its last COMPLETED, and ON HOLD
  and DROPPED are the reader's: never overwritten, the last episode included.
  PROGRESS shows that season's part, and the other part under it. With
  nothing signed in, STATUS says NOTHING SIGNED IN and offers nothing to
  send. Ranobe is one line under the seasons (`WATCHING · EP. 57 OF 96`),
  counted straight through ([`RANOBE.md`](RANOBE.md), "Anime"), and its EDIT
  is the same sheet with nothing to set.

## Films, shows, and a tracker for any kind

The accounts and the queue are per service (`tracker_accounts`,
`tracker_state`, `tracker_sends`), and each tracker declares what it takes.

### The trackers

`TRACKERS` in `src/lib/library/tracking.ts` is the contract: each service
declares the kinds it `takes`, how it `connect`s, and whether tsundoku speaks
to it yet (`built`). `trackersFor(kind)` is the one question. Each row in
SETTINGS' 06 — CATALOGUES says once, under its state, what its tracker takes
(`takesWords`): AniList `COMICS AND ANIME`, MAL `COMICS AND ANIME · NEVER FILMS
OR SHOWS` (`tests/tracking-flow.e2e.ts`).

| Service | Kinds it takes      | What it is here                                                                     |
| ------- | ------------------- | ----------------------------------------------------------------------------------- |
| AniList | manga, anime        | the main list                                                                       |
| MAL     | manga, anime        | the second; it has no live-action entry, so never offered for a film or show        |
| Trakt   | films, shows, anime | declared, not built: no sign-in and no sends                                        |
| TMDB    | —                   | a catalogue and a rating store, not a watch log (`doc/LINKS.md`, "Which catalogue") |

- **Every sign-in is an app of the install's own, then SIGN IN →.** Writing to
  a list needs a registered app (Trakt works the same way). The app's id and
  secret come from `.env` ([`SECRETS.md`](SECRETS.md)); an install without
  them reads `THE APP ISN'T REGISTERED · SEE DOC/SECRETS.MD` on SETTINGS.
- **Nothing a film does may be sent to MAL.** The capability list is the gate;
  there is no runtime guess.
- **No account is required.** With none, the local log is the record. A
  film's or a show's LISTS row has a LIST line, muted, `Kept in HISTORY`,
  `NO TRACKER SIGNED IN · WATCHED 12 NOV` (or `EP. 6 OF 16`), with SET UP → in
  ink to SETTINGS' CATALOGUES, beside TMDB's line, which without a key reads
  `Not looked up` · `NO TMDB KEY · TITLE AND COVER FROM <SOURCE>` with its own
  SET UP → ([`FILMS-SHOWS.md`](FILMS-SHOWS.md)). Muted and in ink: the next thing
  to do, not a fault.
- **One account and one key per service.** Swapping is SIGN OUT, then SIGN IN
  →; there is no second account, which would suggest a shared install.
- **Never shown**: a key after SAVE (its last four characters at most), a
  token, or an email (only the account's name).

## Details

- **The rating reaches only the season being watched**: sending one rating to
  four entries would overwrite the earlier seasons' scores. The sheet draws
  each other season's score read-only, from the list.
- **PLANNING moves to WATCHING with the first episode watched**, as a planned
  comic starts READING. ON HOLD and DROPPED are never overwritten, even at
  the last episode (only the episode goes); PLANNING is.
- **A fold is drawn only when it would hold more than one season**: a fold of
  one is just that season's line.
- **"ANILIST · NOT ON YOUR LIST"** says **ADDED ON THE NEXT CHAPTER READ**,
  and that's what happens. Nothing is added to a list for reading done before
  the sign-in.
- **Tokens are in the database**, not in `.env`: they're a session, made and
  refreshed by the app, not configuration.
- **A catalogue whose app isn't registered** says so on SETTINGS.

## Limits

- **Rereads of a season**, and a season's own date or notes: only status,
  progress and score are written.
- **Novels on AniList and MAL.** A novel's progress isn't sent to either.
  Novels go to **Ranobe** instead ([`RANOBE.md`](RANOBE.md)), where the
  edition's table of contents says what counts as a chapter. Comics go to
  both: AniList as here, and Ranobe as the work's own chapters
  ([`RANOBE.md`](RANOBE.md), "Comics").
- **No MAL search**, for novels AniList lacks ([`LINKS.md`](LINKS.md)).
- **Reading MAL's list to link.** Only AniList's list links; MAL's only
  gives state.
- **Trakt is declared, not built**: no app fields, sign-in or sends. Films
  and shows are tracked nowhere but the local log.
- **No field for an install's own AniList or MAL app on SETTINGS**: the app's
  id and secret come from `.env` only.
- **Rereads.** AniList's REPEATING reads as READING, and sending never
  lowers the chapter, so a reread from chapter 1 sends nothing until it
  passes the old chapter.
