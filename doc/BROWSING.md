# Browsing records: reading and watching before adding

Card c161 ("Read or watch from a source without adding to the library"),
from the owner's report on 2026-10-29: "I can't watch or read anything without
adding it to my library." Its brief is [`briefs/READING-ONLINE.md`](briefs/READING-ONLINE.md),
whose design was still being drawn when the anime part shipped.

| Part                                                      | Card | State           |
| --------------------------------------------------------- | ---- | --------------- |
| The browsing record, anime played from the preview        | c161 | Done 2026-10-29 |
| Anime records finished: CONTINUE, RECORD, FORGET, pruning | c165 | Done 2026-10-29 |
| Manga read online                                         | c166 | Not yet         |
| Novels read online                                        | c167 | Not yet         |
| Phone, landscape and design conformance                   | c168 | Not yet         |

The handoff is in `doc/design/handoff/` (`Online Calls.dc.html` and the
`Online Board *` and `Online-*` files; [`design/README.md`](design/README.md)).

## Decided by the owner (2026-10-29)

The four questions of the brief, answered with the defaults the design is
drawn on:

1. A tap on a NOT DOWNLOADED chapter reads it online; downloading moves to a
   ↓ cell on the row (c166).
2. A record is kept **30 days after its last open** (`KEEP_DAYS`,
   `src/lib/library/keep.ts`); FORGET drops one now.
3. Reading a record counts only in HISTORY until ADD. tsundoku has no streak
   or reading totals to keep it out of: the reading log is read by HISTORY
   alone, and CONTINUE and every count are the library's, so once a record is
   added its reading simply counts from its first day.
4. The tablet keeps only downloaded chapters, never pages read online.

And from the brief:

- **A browsing record, as Mihon does it.** Opening something from a source's
  preview without ADD makes the series a _browsing record_: a series like any
  other, so the readers, the player, progress and HISTORY work on it
  unchanged, but on no shelf and in no count. **+ ADD TO LIBRARY** makes it the
  library's, the same series, its progress kept.
- **Online reading everywhere**, anime first (it already streams), then manga,
  then novels.

## What a browsing record is

`series.in_library = 0` (rung 50), and `browsed_at`, when it was last opened
from its source. Written by the one writer on the first open
(`writeSeries(…, { browsing: true })`); a series that already exists keeps
what it is, so opening never takes anything out of the library.

**The library never sees one.** The rule is spelled once, in
`src/lib/server/visibility.ts` (`IN_LIBRARY_SQL`, `libraryWhere`), beside
the hidden rule, and every read that lists the library uses it:

- the grid, the shelves and their counts, CONTINUE, search and FOLLOWED
  (`library.ts`'s own rule);
- books and their suggestions, a person's page;
- the LINK queue (`LINKABLE`) and Ranobe (`ELIGIBLE_SQL`);
- BROWSE's IN LIBRARY marks and a source's counts (`libraryIndex`,
  `sourceUse`, `seriesForKey`), the NEW counts, and the extension and plugin
  removal sheets.

**What does see one:** HISTORY (its rows say `NOT IN LIBRARY` after the
kind), the readers and the player, covers, and anything asked by id.

**It downloads and follows nothing:** `enqueue` queues none of it and
`setFollowed` refuses, until ADD.

**Its series screen is its source's preview.** `/series/<id>` of a browsing
record redirects to `/downloads/source/<id>`, where + ADD is. So the player's
← SERIES and a HISTORY row both land there.

## Forgetting and pruning (c165)

`src/lib/server/browsing.ts`. **FORGET** (the RECORD row's cell) and the prune
do the same thing: the record's place and marks go (`read_at`,
`last_position`, `last_opened_at` cleared) and `pruned_at` is set (rung 51).
**The row stays**: deleting a series cascades its reading log, and the
design keeps a forgotten record's HISTORY rows, dimmed. Opening it again
clears `pruned_at` and starts another 30 days (`touchRecord`); ADD clears
it too.

The prune runs on FOLLOW's ten-minute step (`engine/run.ts`): every record
whose `browsed_at` is more than `KEEP_DAYS` old. HISTORY tells the two apart
by the gap between the last open and the forgetting: `NOT KEPT · FORGOTTEN`
or `NOT KEPT · NOT OPENED IN 30 DAYS`.

## Anime from the preview

An anime's preview lists its episodes as buttons (one form, a button per
row, so it works without script). `?/open` asks `openFromSource`
(`src/lib/server/downloads.ts`), which writes the browsing record on the
first open (`browseAnime`, `engine/anime-source.ts`) and redirects to the
player at that episode. The library's series, when it has one, opens instead.

**ADD** on a browsing record (`addAnime`) sets `in_library = 1`, its
`added_at` and `arrived_at` to now, and keeps every episode, read mark and
position.

**The preview of an anime** (Online Calls 1B, 1D; `src/lib/library/browsing.ts`
for its words):

- **The bar is two cells**: ▶ in accent takes the width and continues a
  record where it stopped (`▶ EP. 3 · 14:32 LEFT`), or starts the first
  episode; **+ ADD TO LIBRARY** beside it, outlined (+ ADD on the phone and
  in the landscape panel).
- **A RECORD row** under it: `Not in library · 2 of 12 watched`, `LAST
OPENED YESTERDAY 23:10 · KEPT UNTIL 27 NOV` (the phone's `KEPT 30 DAYS
AFTER THE LAST OPEN`), and FORGET. The meta line ends `· NOT IN LIBRARY`.
- **Rows** say WATCHED (muted), or are the one in progress: a panel, its
  time left in accent, and its share along the bottom. The list head counts
  `12 · 2 WATCHED`.

**The player**, for a record, has + ADD in its top bar (both layouts), which
adds without leaving the episode and then reads IN LIBRARY ✓; its meta line
ends `· NOT IN LIBRARY`.

**HISTORY** (Online Board 4): a record's cover is dashed; on the tablet + ADD
is a cell on its row, on the phone it leads the long press. Adding from there
says `ADDED · PROGRESS KEPT` with OPEN →. A forgotten record's row dims to
0.4 with the empty cover, says NOT KEPT and why, and FIND → searches the
sources for its title.

## Where it departs from the handoff

- **No `24 MIN` on an unwatched episode's row**: the engine's episode list
  carries no lengths (doc/ANIME.md); a length shows once an episode has
  played (`14:32 LEFT`, or `AT 1:30` before the player has measured it).
- **A fresh anime's bar is `▶ EP. 1`**, its list head `· EVERY ONE STREAMS`:
  the design draws a fresh preview only for a manga (`▶ READ CH. 1`,
  `· ALL ONLINE`).
- **The player has no rating or FAV to trade** (that's the image reader's
  top bar); + ADD sits before FULL SCREEN instead.
- **FIND → is SEARCH THE SOURCES** for the title (`/downloads/search`), the
  one place that asks every source at once.

## Not done yet

- **Manga and novels** open nothing from a preview until chapters read online
  (`openFromSource` answers null for them).
- **Pruning.** Records stay until the owner says how long (the brief's
  question 2); nothing deletes them.
- Whether a browsing record counts anywhere but HISTORY (question 3): today
  it doesn't.

`tests/browsing-db.spec.ts`: written on the first open, the same series the
second time; on no shelf, count or search, and not IN LIBRARY at its source;
nothing queued or followed; in HISTORY as NOT IN LIBRARY; ADD keeps the
series and its place, and opening again plays the library's.
