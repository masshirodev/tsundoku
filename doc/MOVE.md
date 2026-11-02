# MOVE: a series to another source

A series belongs to the source it came from, and everything the owner does with
it hangs off that series: where they are, what's read, the rating, FAV,
shelves, tags, FOLLOW, the downloaded files. Sources go bad — a site lists
episodes but sends no video, a scanlation group moves, a better copy appears —
and before c139 the only way out was to add the series a second time and leave
its progress behind.

MOVE moves the series itself. It is a page of its own,
`/series/[id]/move`, opened from the SOURCE row on the series screen or from
the player's NO SERVER. It asks every installed source of the series' kind as
they answer, lays the picked candidate beside the series by number before
anything changes, and moves on one tap. The series screen comes back as the
same series with a new source.

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

An anime series knows its season. When both sides have seasons, season 3
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

1. **Re-key the series** to `mihon:<source>:<url>` (or `aniyomi:`), and keep
   the old key with when it was left (`former_key`, `former_at`,
   `former_source`, `former_offset`). The series' `source` and `source_url` are
   the new source's.
2. **Matched entries** keep their row — so their reading, file, rating and log
   stay attached — and take the new source's chapter URL. The address they had
   is kept as `former_url`, for the backup's plan to find them by.
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

A backup still names the source it was downloaded from. After a move that key
is `series.former_key`, and `writeSeries` (`import/write.ts`) looks a series up
by it as well as by `origin_key`, so the backup resolves to **this** series and
never makes a twin. The chapters it plans still name the old source's URLs,
which matched entries keep as `former_url`, so the writer finds them instead of
adding a second copy. The series keeps the key it moved to. This is the
writer's existing former-key mechanism (`adoptFormer`) extended, not a second
one.

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
remembered one, so the way back can itself be undone the same way.

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

### Hidden series

With reveal off the move page answers 404, as the series does. Inside reveal it
keeps the magenta banner and frame. **A hidden series is never searched by
itself**: the page opens with the field filled and nothing asked
(`HIDDEN SERIES ARE NEVER SEARCHED BY THEMSELVES`), and SEARCH or PASTE A LINK
asks once. The move leaves no trace outside the series: no notice, no band
anywhere but its own screen, no line in DOWNLOADS beyond the queue rows a
hidden series already gets.

## Schema (rung 57)

`series.former_key`, `former_at`, `former_source`, `former_offset`,
`move_dismissed_at`; `entries.origin_source`, `former_url`; and
`episode_failures(entry_id, series_id, first_at, last_at, tries)` with an index
on `(series_id, last_at)`. The rung is append-only, like every one before it
(`src/lib/server/db.ts`). `tests/move-rung57-db.spec.ts` climbs a file to 56,
fills it, and checks 57.

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
   reads from, plus those BROWSE lists, never every importable source. Sources
   are drawn in a fixed order, not the order they answered; their answers still
   stream in one by one.
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
- **A per-candidate chapter count on the list** (departure 1), and **the order
  sources answered in** (departure 4).
- **An undo stack beyond one step.** MOVE BACK remembers the source just left,
  so a move can be undone; a third step is another MOVE.
- **PLAYS without script**, and **PLAYS for anything but the CONTINUE episode**.

## Tests

- `tests/move-domain.spec.ts` — the map: exact numbers, folds, kept and added,
  splits and the read-mark rule, 0, unnumbered extras, seasons, the flat offset
  and its guess, the counts, the band's line.
- `tests/move-db.spec.ts` — one transaction: re-key, matched/kept/added,
  reading and the log, the queue's two sides, FOLLOW, the old key, 30 days,
  MOVE BACK, the tablet backup, a hidden series, NO SERVER failures.
- `tests/move-rung57-db.spec.ts` — the rung on a file.
- `tests/browse-move.e2e.ts` — the flow end to end, against the fake engine:
  the SOURCE row, the candidates, the comparison, MOVE, the moved band, the
  kept chapter's badge, and MOVE BACK.
