# Browsing records: reading and watching before adding

Card c161 ("Read or watch from a source without adding to the library"),
from the owner's report on 2026-10-29: "I can't watch or read anything without
adding it to my library." Its brief is [`briefs/READING-ONLINE.md`](briefs/READING-ONLINE.md),
whose design was still being drawn when the anime part shipped.

| Part                                                    | State                     |
| ------------------------------------------------------- | ------------------------- |
| The browsing record, and anime played from the preview  | Done (2026-10-29)         |
| Manga and novel chapters read online, and from previews | Waiting for the design    |
| Pruning records nobody comes back to                    | Waiting on the owner (Q2) |

## Decided by the owner (2026-10-29)

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

## Anime from the preview

An anime's preview lists its episodes as buttons (one form, a button per
row, so it works without script). `?/open` asks `openFromSource`
(`src/lib/server/downloads.ts`), which writes the browsing record on the
first open (`browseAnime`, `engine/anime-source.ts`) and redirects to the
player at that episode. The library's series, when it has one, opens instead.

**ADD** on a browsing record (`addAnime`) sets `in_library = 1`, its
`added_at` and `arrived_at` to now, and keeps every episode, read mark and
position.

The preview's rows don't show what was watched yet, and there's no PLAY
FROM / CONTINUE cell beside + ADD: that is the design's
(`briefs/READING-ONLINE.md`, "What to design", 1).

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
