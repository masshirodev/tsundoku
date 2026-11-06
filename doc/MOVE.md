# MOVE: a series to another source

A series belongs to the source it came from, and everything the owner does with
it hangs off that series: where they are, what's read, the rating, FAV,
shelves, tags, FOLLOW, the downloaded files. Sources go bad — a site lists
episodes but sends no video, a scanlation group moves, a better copy appears —
and before c139 the only way out was to add the series a second time and leave
its progress behind.

MOVE moves the series itself. It is a page of its own,
`/series/[id]/move`, opened from the SOURCE row on the series screen or from
the player's NO SERVER. It asks every installed source that serves the series' medium as
they answer, lays the picked candidate beside the series by number before
anything changes, and moves on one tap. The series screen comes back as the
same series with a new source.

Which series MOVE is offered for, and how its map reads them, is the kind
registry's (`src/lib/library/kinds.ts`, [`KINDS.md`](KINDS.md); card c304):
`movable` says whether a kind moves (a manga, a manhwa, an anime), and the
kind's **medium** says how. A video kind's series maps by episode and season
(the map kind `anime`), every other by number (`manga`); the sources asked,
and the one a pasted link is matched to, are the installed ones serving that
medium (`sourceMedium`; PASTE A LINK's in `series/[id]/move/paste.server.ts`);
and the words a move says (`EPISODES`, `Ep.`, WATCHING, SEARCH's "every anime
source", the comparison's ANIME, the MOVED band's EPISODE or CHAPTER) are the
map kind's (`series/[id]/move-words.ts`). Nothing in MOVE names a kind: the
modules since K4 (wave 17), the route and the MOVED band since wave 18.

Design: `doc/design/handoff/Migrate Calls.dc.html` (the decisions) and the
boards beside it. Brief: [`briefs/MIGRATE.md`](briefs/MIGRATE.md). Card c139.

## What moves, decided

The owner settled these on 2026-11-01. They are the frame; the design works
around them, not the other way.

1. **Downloaded files stay**, as the chapters or episodes they are. Nothing in
   tsundoku deletes a file, and a move doesn't start.
2. **A chapter or episode the new source lacks, or numbers differently, stays**
   too, from the old source. The new source adds what's missing, and downloads
   only that.
3. **FOLLOW and queued downloads move** with the series. One queued chapter with
   no partner on the new source leaves the queue.

By the model, without a decision needed: the title, cover, rating, FAV,
shelves, tags, hidden, tracking links, notes and season stay with the series;
reading state moves by number; the old source is remembered.

## The by-number map

`src/lib/library/move.ts` is the whole comparison, pure and tested in
`tests/move-domain.spec.ts`. Matching is **exact number and nothing else**:

- a chapter 11 matches chapter 11, and runs are folded for display
  (`11 – 40 · BOTH · READ`);
- a chapter only the old source has is **kept**, with its file, and the row
  says `KEPT FROM ASURA SCANS`;
- a chapter only the new source has is **added**, unread and not downloaded;
- **a split** is its own row: old 10 against their 10.1 and 10.2 keeps 10 with
  its file and adds the two pieces. A **read mark on 10 also marks the new
  chapters from 10 up to 11**, so they arrive read rather than as two unread
  holes in the middle of what's read (the design's proposal, adopted).
- a **0** is a number like any other: with no 0 on the old side it is added,
  unread. Nothing shifts numbers on its own.
- an **unnumbered extra** (`Afterword`, a volume extra) can't match; from the
  old source it stays, and from the new one it is added by its name.
- a title that only differs by punctuation is not a number: a whole chapter
  against a fractional extra is not a split.

The chapter numbers are the ones tsundoku already read from the names:
`src/lib/import/chapter-number.ts`, a port of Mihon's own recognition. Every
source but Webtoons sends `-1` to the engine, so the number in the map is the
one tsundoku stored from the chapter's name. A misread shows here, before the
move, which is the place to see it.

### Anime: seasons, and a flat list

What follows holds for a series whose kind's medium is video (`movesVideo`,
`library/move.ts`), which today is an anime. An anime series knows its season. When both sides have seasons, season 3
matches season 3 episode by episode, and another season is **not taken**: a
season of a multi-season entry is a different series (`NOT TAKEN · ANOTHER
SEASON`). Episodes outside the series' own range are not taken either —
`FOLLOW` adds what comes after its last.

When the candidate numbers every season as **one flat list**, the comparison
asks for an **offset**: `YOUR EP. 1 IS THEIR EP. [N]`. It is guessed from
episode titles (`22 OF 24 TITLES AGREE`) and is editable in the URL
(`?offset=`), and the map redraws as it changes. The offset is stored with the
way back (`series.former_offset`) so MOVE BACK maps the same way.

Series that never had seasons, on both sides, match by number alone.

## The move

One transaction (`applyMove` in `src/lib/server/move.ts`):

1. **Re-key the series** to `mihon:<source>:<url>` (or `aniyomi:`), keep the
   old key with when it was left (`former_key`, `former_at`,
   `former_source`, `former_offset`), and add it to every key the series has
   left (`series_former_keys`, rung 58). The series' `source` and `source_url`
   are the new source's.
2. **Matched entries** keep their row — so their reading, file, rating and log
   stay attached — and take the new source's chapter URL. The address they had
   is kept as `former_url` and joins every address the entry has left
   (`entry_former_urls`), for the backup's plan to find them by.
3. **Kept entries** keep their old URL and `engine_chapters` row, and record
   `origin_source` (the source's id) so the list can say its name and a
   re-download asks there. A matched entry's `origin_source` is cleared: it is
   the current source's.
4. **Added entries** are written unread, not downloaded and not queued, from
   the candidate's own chapter list. A split's pieces are written read when the
   old chapter was.
5. **The queue**: a matched chapter's queue row stays (and downloads from the
   new source); a queued chapter with no partner is deleted from the queue. The
   comparison counts it (`1 HAS NO PARTNER · LEAVES THE QUEUE`).
6. **FOLLOW** is the series' own `followed_at`, untouched: FOLLOW's step now
   asks the new source.
7. **`engine_series`** points at the new source, and `anime_checks` and the
   episode failures are cleared (the new source's first check is its own).

Nothing downloads because of a move, no file is moved or deleted, and a
series' title, cover, rating, FAV, shelves, tags, link, notes and history are
not touched. `forgetSourceUse()` tells the source counts to look again.

### Re-downloading a kept chapter

The downloader asks the source the chapter came from: `entries.origin_source`
when it is set, the series' source otherwise. `engine_chapters` gives that
source the chapter's own URL, and the queue reports the chapter's source as its
lane (`engine/queue.ts`). An episode plays the same way (`anime/streams.ts`).
If the old extension has since been uninstalled the chapter fails as any
chapter with no installed extension does; its file still reads.

### The tablet's backup

A backup still names the source it was downloaded from. After a move that key is
in **every key the series has left**, `series_former_keys` (rung 58), and
`writeSeries` (`import/write.ts`) looks a series up by it as well as by
`origin_key`, so the backup resolves to **this** series and never makes a twin —
whichever move it names, not only the last. `series.former_key` keeps the most
recent one, which is what MOVE BACK offers; the table is the record. If two
series somehow both list a key, the most recent `left_at` wins: a key has one
series that left it last.

The chapters it plans still name the old source's URLs. Each matched entry keeps
the address it had in `entry_former_urls` as well as `former_url`, so after
A → B → C an entry still answers to A's address and the writer updates it rather
than adding a second copy. A key or URL the series or entry now has is never
also a former one: a move to it takes it out of the record. The series keeps the
key it moved to. This is the writer's existing former-key mechanism
(`adoptFormer`) extended, not a second one.

## The way back

Right after a move the series screen shows **MOVED TO WEEB CENTRAL** with
**UNDO**, as NOT A SERIES does; the band goes when the screen is left. For **30
days** the SOURCE row reads **WAS ASURA SCANS · UNTIL 1 DEC** and offers **MOVE
BACK**, which goes straight back with no search or comparison.

Back means: the old source is where chapters come from again, FOLLOW and the
queue go with it, and reading carries back **by number**, including what was
read in between (entries keep their rows). A chapter the new source added
**stays if it has a file** (nothing deletes a file) and **goes if it has none**.
A chapter of the old source that was deleted while away comes back from the old
source's list, unread and not downloaded. The key just left becomes the
remembered one, so the way back can itself be undone the same way, and the key
it returned to leaves `series_former_keys`: a key the series is at is not a
former one. Every other key it has left stays in the record, so a backup naming
any of them still resolves.

After 30 days the SOURCE row stops offering MOVE BACK. The old key stays on the
series (invisible otherwise), so the tablet's backup still resolves. Moving
back is then an ordinary MOVE, and the old source is listed first because the
search asks it too.

## The screens

- **SOURCE row** on the series screen, under LINK and COVER: the source's name,
  then `LAST ASKED 2 H AGO · 25 EPISODES LISTED`, then `MOVE →`. In trouble the
  second line is in ink: `NO VIDEO FOR 6 EPISODES SINCE 1 NOV`,
  `NOTHING NEW SINCE 6 SEP`, `NOT ANSWERED SINCE 28 OCT`. A local import has no
  row; a series whose extension isn't installed still has one (moving it to an
  installed source is its way out).
- **NO VIDEO band** under CONTINUE, in the MIGHT BE ONE SERIES idiom, after NO
  SERVER on three episodes of one series within a day (or on every episode,
  where the series has fewer): `NO VIDEO FROM KICKASSANIME`, ANOTHER SOURCE →
  and NOT NOW (which hides it until a new failure).
- **The player's NO SERVER**: ANOTHER SOURCE → before TRY AGAIN, and one line
  when it isn't just this episode: `EPISODES 1, 2, 7 AND 8 FAILED THE SAME WAY
SINCE 1 NOV`. Not on SOURCES NOT ANSWERING: there the engine is down.
- **The manga END page**: an ongoing series whose source has added nothing for
  eight weeks adds `ASURA SCANS HAS ADDED NOTHING SINCE 6 SEP` and a cell
  ANOTHER SOURCE →. No band: a quiet source isn't a broken one.
- **The move page**: candidates on the left (440px, as the series panel), the
  comparison beside them. Below 1024px it is one pane: picking a candidate swaps
  the list for the comparison, and the MOVE bar is pinned to the bottom. `02 —
WHAT THE MOVE DOES` is a closed block whose cells say MOVES, KEPT, UNCHANGED;
  `03 — BY NUMBER` folds matching runs and draws every odd row. On a phone the
  map shows only the odd rows and the reading row until SHOW ALL.

### The candidates, and picking one

Cards c490 and c491 (2026-11-04: the owner's screen had 13 of 20 sources
answered and 39 found, under a wall of DID NOT ANSWER and NOTHING FOUND, and a
pick that looked dead for half a minute).

**The order** is `src/lib/library/source-answers.ts` (`arrangeAnswers`), which
DOWNLOADS' search shares ([`DOWNLOADING.md`](DOWNLOADING.md)):

1. **Sources with matches first**, their hits under them, **in the order they
   answered**. A source that answers late joins below the hits already drawn,
   so the row under the pointer never moves. A source whose only hit is THIS
   SERIES NOW still counts as a match.
2. The chosen candidate's source, if it answered with nothing or failed this
   time (a reload): open, never folded away.
3. **`7 STILL ASKING`**, one quiet line for the sources not answered yet, naming
   one that is passing its site's check (`BROWSER CHECK · ASKED 12 S AGO`). Two
   dashed rows under it until the first match arrives.
4. **`9 FOUND NOTHING`**, then **`5 DID NOT ANSWER`**, each a closed fold (a
   `<details>`, so one stop on a remote) at the end. The failed fold keeps each
   source's TRY AGAIN and has **TRY ALL AGAIN**. Each fold stays as the owner
   left it while its sources are asked again.

Every source is named with its language (`MANGADEX · EN`, `MANGADEX · PT-BR`):
one extension installs a source per language under one name, and which one a
series moves to is a real choice. The language is the engine's
`engine_sources.lang` (a novel plugin's `novel_plugins.lang`), read by
`withLanguages` in `server/move.ts`; a source neither knows is named alone.

**TRY AGAIN and TRY ALL AGAIN ask only the sources that failed**, one call each
to `series/[id]/move/ask` (which answers only for a source MOVE asks for this
series), and each answer joins the list as it would have. Without script they
are links to the page, which asks every source again.

**Beside the comparison only the list scrolls** (1024px and up): the page
under the top bar is the viewport's height (`.frame`), so the search, OTHER
NAMES and `13 OF 20` stay put, the list scrolls under them, and the comparison
and its MOVE bar stay on screen. The app's frame is only `min-height: 100dvh`,
which is what let the page grow with the list and scroll the comparison away.
One pane (below 1024px, a TV included) keeps the page's own scroll and its
pinned MOVE bar.

**Picking a candidate asks no source again.** The search depends on `q`, the
comparison on `to`: the load reads `to` and `offset` untracked (SvelteKit's
`untrack`), so a pick, SET on the offset, or CANCEL is a navigation that does
not run the load, and the page asks `series/[id]/move/compare` for that one
candidate. CANCEL after a pasted link is the exception: it drops `paste`, which
the load reads tracked, so that one does run the load. So:

- **The wait shows at once.** The tapped row is marked before the navigation
  lands, and the right side says it is asking that source in the player's
  words (`02 — ASKING THE SOURCE · MANGADEX`, `4 S · USUALLY A FEW SECONDS`;
  `THE SOURCE IS CHECKING THE WORKSTATION` while its site's check is passed),
  with MOVE off.
- **A later pick wins.** Each ask has a number; an answer for an earlier pick
  that arrives late is dropped. The right side draws an answer only when it
  is the pick's own, so an earlier comparison is never beside a new
  selection, not even for a frame.
- **A dropped ask is dropped all the way down** (c539). A later pick aborts
  the earlier `compare` fetch (an `AbortController` per ask), and the
  endpoint takes the request's `signal`. The engine answers one call per
  extension at a time (`inLane`, `engine/client.ts`), and neither it nor
  `moveComparison` takes a signal, so a call that has started runs to its end
  and its answer is dropped. What is spared is the wait: compares take turns
  per source at the endpoint (`inTurn`, `access.server.ts`), and an ask
  dropped while it waits never reaches the engine. Three quick picks on one
  slow source cost the call already running and the last pick's, not one
  each. SvelteKit's node adapter aborts `request.signal` when the socket
  closes before the request has ended (`@sveltejs/kit/node`, `getRequest`),
  which is a GET whose page went away.
- **Picks take turns, and a newer pick drops a waiting one** (c567, wave
  25). The socket is a late witness: wave 24 measured the server hearing of
  B's abort 4-279 ms after the page gave B up, so a turn could come to B in
  that gap and B asked the engine anyway (`browse-move-pick`'s "three quick
  picks…", 1 run in 10 alone). So `inTurn` also numbers every ask per source
  and series, and an ask that **waited** for its turn and finds, when the
  turn comes, a newer ask of the **same series from the same source** queued
  behind it answers `DROPPED` without asking, whatever its socket says.
  Exactly:
  - _Newer_ means queued later for the same source and series. A pick of the
    same series from another source is in another lane and never behind it;
    a pick of another series is another page's. Neither drops anything.
  - Only an ask that waited can be overtaken. With nobody in front its turn
    came as it arrived, and a pick queued a moment later is behind it.
  - An ask with no signal (the page's own load, `?to=` without script or
    on a reload) is never dropped, since nothing could read that it was;
    it is still newer than the asks before it, and drops them.
  - The same pick twice asks for the newer only. A newer pick that is itself
    aborted before its turn still drops the older: the page that made both
    has moved on, and its next pick asks afresh.
  - TRY AGAIN after a `DROPPED` is a new ask, the newest, and asks.
  - The cost: one series' move page open on two devices, both picking from
    the same source at once, drops the first device's waiting compare, and
    that page reads `Asked for another candidate` with TRY AGAIN. The server
    cannot tell two pages of one series apart, and the case is rare enough
    to take over a compare that asks the engine for a page that has left.
- **A tap asks once.** The tapped row is kept with the offset it will land
  with (a candidate's link carries none), so a tap made while the URL had an
  `offset` no longer asked twice, with the old one and then with none. The
  tap is forgotten as soon as either half of the URL's pick moves, its `to`
  or its `offset`. A tap on the candidate already picked lands on the same
  `to`, so a tap cleared on `to` alone stayed, kept its offset (none), and
  ignored a later SET, whose `?offset=` then asked nothing while MOVE posted
  the old comparison's offset (round 2 of wave 22's review).
- **The load's streamed comparison cannot hang.** An unexpected throw in
  `moveComparison` rejected the streamed promise, nothing caught it, and
  `ASKING THE SOURCE` stayed for good; it now becomes the failed state, `The
workstation did not answer`, with TRY AGAIN.
- **A failed comparison says so**, `That source wouldn't say.` with its reason
  and TRY AGAIN, and the MOVE button off. A MOVE confirmed against the wrong
  candidate is the worst outcome here, so the form's `to` is the comparison's
  own candidate, never the URL's, and the action asks the candidate again
  anyway.
- **`to` stays in the URL**: BACK goes to the previous pick, and a reload or a
  page without script runs the load once with `to`, which answers the
  comparison itself (streamed with script, waited for without).
- **PLAYS follows the comparison on screen**, not the load's.

A link that picks keeps every other parameter as it is (a URL with no `q`
keeps none), because changing one the load tracks would run it again.

**A candidate that is already another series** says `THAT IS ALREADY <TITLE> IN
THE LIBRARY` and, under it, `TWO SERIES FROM ONE ENTRY · JOIN THEM IN MIGHT BE
ONE SERIES`. That second line names the books' offer, so since c587 it is a
message and the offer's name comes from `messages/` too (`offer_move_join`,
`offer_might_be_one_series`): a Portuguese screen points at the name the
series screen draws.

**The `file:///` in the owner's console** (seen with c491) was looked for and
not found: every cover MOVE draws is made on the server as one of tsundoku's
own routes (`imageRoute`, which only takes the engine's `/image/` addresses,
or `coverRoute`, which only takes `http(s)`), and nothing under `src/` writes a
`file:` URL. The candidates' and the comparison's covers can't carry one,
and the series' own `cover` is a timestamp (`cover_at`), not an address (it
is no longer sent to this page, which never drew it). So the door is not on
this page as far as the code shows; it is under the notes' Gaps
(`doc/handoff-notes/series.md`, wave 21) with the check that would find it.

### Hidden series

With reveal off the move page answers 404, as the series does. Inside reveal it
keeps the magenta banner and frame. **A hidden series is never searched by
itself**: the page opens with the field filled and nothing asked
(`HIDDEN SERIES ARE NEVER SEARCHED BY THEMSELVES`), and SEARCH or PASTE A LINK
asks once. The move leaves no trace outside the series: no notice, no band
anywhere but its own screen, no line in DOWNLOADS beyond the queue rows a
hidden series already gets.

### On a remote

A TV ([`TV.md`](TV.md), c235) reaches all of it with a D-pad: the SOURCE row's
MOVE → and MOVE BACK are stops of the ruled block, the NO VIDEO band's ANOTHER
SOURCE → and NOT NOW are stops under CONTINUE, and on the move page the
candidates, the comparison and the MOVE bar are stops with the mark drawn
inside their cells. BACK climbs the comparison to its top bar, then leaves the
page. The player's NO SERVER and the manga END page reach their ANOTHER SOURCE →
the same way. The list's two folds are one stop each while closed, FOUND
NOTHING and DID NOT ANSWER (a closed `<details>` offers its summary alone,
`src/lib/focus/dom.ts`); OK opens one in place, and ↓ walks into it: TRY ALL
AGAIN, then each source's TRY AGAIN, whose OK asks that source again without
leaving the page (`tests/tv-move.e2e.ts`, c538). MOVE has no TV layout of its own — it draws the one-pane shape
below 1024px, which a 960-wide TV gets, and the handoff set has no board for it.

## Schema (rungs 57 and 58)

Rung 57: `series.former_key`, `former_at`, `former_source`, `former_offset`,
`move_dismissed_at`; `entries.origin_source`, `former_url`; and
`episode_failures(entry_id, series_id, first_at, last_at, tries)` with an index
on `(series_id, last_at)`.

Rung 58: `series_former_keys(series_id, origin_key, source, left_at)`, keyed by
`(series_id, origin_key)` with an index on `origin_key`, and
`entry_former_urls(entry_id, former_url, left_at)` the same way — every key a
series has left and every address an entry has left, which is what the tablet's
backup resolves through. Both cascade with their series or entry, so a series
that goes takes its record with it. The rung copies rung 57's values in: each
non-null `former_key` (with `former_at`, `former_source`) and each non-empty
`former_url`. A key or URL that is also the current one is left out. The rungs
are append-only, like every one before them (`src/lib/server/db.ts`):
`tests/move-rung57-db.spec.ts` climbs a file to 56, fills it, and checks 57;
`tests/move-rung58-db.spec.ts` climbs to 57 with a former key and URL, and
checks the copy, the current-one rule, and the cascade.

## Where it departs from the handoff

1. **A candidate row has no chapter count.** The design draws `123 CHAPTERS ·
LATEST CH. 121 · 2 D AGO`, which costs a details call per candidate. The
   brief says to reuse the existing source search, whose result says the
   author and status and nothing about chapters; the counts appear as soon as a
   candidate is picked. The design's own Q2 asks this and answers "counts on
   the list", so this is a deliberate cheaper choice.
2. **Moving onto a hit that is already another series is refused.** The design
   allows it (leaving two series from one entry, for MIGHT BE ONE SERIES to
   join). The library keys a series by its source entry with a unique index, and
   every import and download path relies on that; two series with one key would
   make imports find one at random. The candidate is shown as already in the
   library and MOVE is not offered. Joining stays grouping's job, as the design
   itself says.
3. **The SOURCE row sits directly under LINK and COVER**, before TAGS and
   ABOUT, rather than immediately above FILE: the shipped panel has rows the
   mock doesn't draw (TAGS, ABOUT, EDITIONS), and the design's "under LINK and
   COVER" is the closer of its two descriptions.
4. **The source list is the existing search's**: installed sources the library
   reads from, plus those BROWSE lists, never every importable source. The
   design draws them as they answer; here the matches are in the order they
   answered and everything else is folded at the end ("The candidates, and
   picking one", c490).
5. **The badge on a kept chapter is the source's name even for a move within
   one site.** The design's example crosses sources; a second entry on the same
   site is allowed, and the chapter is still one the new entry lacks.
6. **`PLAYS` is checked once the candidate is picked, and only with script.**
   The design asks for it on the comparison and says MOVE must not wait on it;
   that is what happens. Without script the row is absent rather than stuck at
   CHECKING.
7. **A novel and a doujin are not offered a SOURCE row.** A novel's chapters
   are one EPUB from one plugin, so moving it between plugins is not this
   shape; a doujin from a gallery source is one book. Both keep their source
   line as it was. This is the code's model winning over the brief's "every
   series from a source"; the report records it.

## What it does not do yet

- **Many series at once.** The design says it bends well: the search is per
  title and the comparison per series. This is one series, as c139 says.
- **Merging two library series.** That is MIGHT BE ONE SERIES and grouping.
- **A novel between plugins**, and a gallery book between gallery sources, for
  the model reason above.
- **A per-candidate chapter count on the list** (departure 1).
- **An undo stack beyond one step.** MOVE BACK remembers the source just left,
  so a move can be undone; a third step is another MOVE. Every key is kept for
  the backup's lookup (`series_former_keys`), but MOVE BACK offers only the last
  one.
- **PLAYS without script**, and **PLAYS for anything but the CONTINUE episode**.

## Tests

- `tests/move-domain.spec.ts` — the map: exact numbers, folds, kept and added,
  splits and the read-mark rule, 0, unnumbered extras, seasons, the flat offset
  and its guess, the counts, the band's line.
- `tests/move-db.spec.ts` — one transaction: re-key, matched/kept/added,
  reading and the log, the queue's two sides, FOLLOW, the old key, 30 days,
  MOVE BACK, the tablet backup, a hidden series, NO SERVER failures, and
  `inTurn`'s queue (c567): a newer pick dropping a waiting one with no abort,
  another series' and another source's picks dropping nothing, the same pick
  twice, a newer pick itself aborted, an ask with no signal, TRY AGAIN after a
  `DROPPED`, and a slow source's late answer.
- `tests/move-rung57-db.spec.ts` — the rung on a file.
- `tests/move-rung58-db.spec.ts` — rung 58 on a file: the copy, the
  current-one rule, the cascade.
- `tests/move-former-keys-db.spec.ts` — A → B → C answers a backup naming A
  (no twin, no second chapter), MOVE BACK takes the key returned to out of the
  record, and a deleted series takes its rows with it.
- `tests/tv-move.e2e.ts` — a D-pad from the SOURCE row to the candidates
  and the comparison, BACK climbing it, and (c538, in a world of its own with
  a source that finds nothing and one that fails) each closed fold one stop
  and TRY AGAIN in the opened one a stop that asks again.
- `tests/browse-move.e2e.ts` — the flow end to end, against the fake engine:
  the SOURCE row, the candidates, the comparison, MOVE, the moved band, the
  kept chapter's badge, and MOVE BACK.
- `tests/browse-move-pick.e2e.ts` — the list and the pick (c490, c491), in a
  world of its own with seven sources: the order and both folds, the language,
  TRY ALL AGAIN asking only the failed (engine calls counted), a late answer
  leaving the hovered hit where it was, only the list scrolling at 1280 × 800,
  a pick with no search and no `__data.json`, a later pick over an earlier
  one's late answer, BACK and a reload, a failed comparison with MOVE off,
  three quick picks on one slow source (one details call each at most, the
  dropped one that was waiting none), the same three at wave 23's timing (A
  let go as soon as C is sent, before B's abort can have reached the server:
  c567), a waiting pick whose abort never reaches the server (B asked from
  the test's own request context) dropped by the page's newer pick behind it
  (red on an `inTurn` without the rule, every copy: c567), a tap under an `offset` asking once, a
  second tap on the picked candidate leaving a later `offset` in charge, a
  streamed comparison that throws becoming TRY AGAIN (c539), and a pick
  without script. A late answer on the _first paint_ is not watched
  there: `vite preview` gzips every response whole, so a streamed page arrives
  at once in the e2e (the served app, `scripts/serve.ts`, does not).
- `tests/source-answers.spec.ts` — the order itself, every arrival order of
  the same answers, the kept source, the counts, the language label and
  `withLanguages`.
