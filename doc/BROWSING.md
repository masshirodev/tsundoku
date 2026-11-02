# Browsing records: reading and watching before adding

Card c161 ("Read or watch from a source without adding to the library"),
from the owner's report on 2026-10-29: "I can't watch or read anything without
adding it to my library." Its brief is [`briefs/READING-ONLINE.md`](briefs/READING-ONLINE.md),
whose design was still being drawn when the anime part shipped.

| Part                                                      | Card | State           |
| --------------------------------------------------------- | ---- | --------------- |
| The browsing record, anime played from the preview        | c161 | Done 2026-10-29 |
| Anime records finished: CONTINUE, RECORD, FORGET, pruning | c165 | Done 2026-10-29 |
| Manga read online                                         | c166 | Done 2026-10-29 |
| Novels read online                                        | c167 | Done 2026-10-29 |
| Phone, landscape and design conformance                   | c168 | Done 2026-10-29 |

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

## Manga online (c166)

A chapter with no file, of a series a source serves (an installed
extension's `mihon:` key), **reads from its source**, in the library or in a
browsing record:

- **No new reader.** `manifest()` and `readPage()` (`src/lib/server/pages`)
  answer for such a chapter by going to its source
  (`src/lib/server/pages/online.ts`): `getPageList` through the engine, the
  same call a download makes (`chapterAtSource`, `engine/worker.ts`), kept in
  memory ten minutes, and each page fetched through the engine's `/image/`
  proxy on its way to the reader. So the paged reader, the strip, the
  preloading, neighbouring chapters and the page menu work unchanged.
- **Nothing is kept** (question 4). Nothing is written to disk; the page
  route answers an online page `private, no-store` (its version starts
  `online-`), so neither the browser nor the service worker keeps it; the
  device cache keys on a file, which an online chapter hasn't got.
- **Waiting is the player's** (`OnlineWait.svelte`). The reader's page comes
  at once and the chapter streams in (`waiting`, in the read route's loader):
  ASKING THE SOURCE with its seconds; THE SOURCE IS CHECKING THE WORKSTATION
  on the 20–45 s scale, STILL ASKING past 45 s with TRY AGAIN; THE SOURCE
  ASKED TO SLOW DOWN, opening by itself after a 30 s countdown with no TRY
  AGAIN; SOURCES NOT ANSWERING and THE SOURCE DID NOT ANSWER, with TRY AGAIN;
  offline, ○ ONLINE ONLY.
- **The reader says ONLINE** in its meta line (`CH. 4 OF 166 · ONLINE · P. 12
OF 41`), a page not here yet is a dashed cell (`P. 15 · ON ITS WAY`), and
  one that failed says THE SOURCE DID NOT SEND IT with RETRY. The boundary
  into an online chapter says `ONLINE · FROM THE SOURCE` and opens, rather
  than `○ NOT DOWNLOADED`; offline it's `○ ONLINE ONLY`.
- **A record in the reader** has + ADD where the rating and FAV are, and its
  meta line ends `· NOT IN LIBRARY`.
- **The series screen** (Online Board 2; the owner's answer to question 1):
  a tap on a chapter with no file reads it, its status ONLINE and its title in
  full ink. **Downloading moves to a ↓ cell** at the end of the row (72px,
  56px on the phone): ↓ queues, a failed row's cell reads RETRY, a row with
  a file has an empty cell. START opens the first chapter online instead of
  waiting for a file. Offline, online rows dim to 0.35 and read ○ ONLINE
  ONLY. A series no source serves is as before.
- **The preview of a manga** has the two-cell bar: ▶ READ CH. 1 · ONLINE, or
  ▶ CONTINUE · CH. 4 · P. 12 for a record, and + ADD; every chapter row opens.

`tests/engine-worker-db.spec.ts` ("a chapter read online": the manifest and
a page through the engine, nothing written) and `tests/browse-online.e2e.ts`
(preview → reader with a `no-store` page → record → ADD → series rows read
online with ↓ apart → the source down and back).

## Novels online (c167)

A chapter with no file, of a novel whose LNReader plugin is installed, reads
from the plugin, the same way, with the same rule that nothing is kept:

- **A book of one chapter, made in memory** (`src/lib/server/novels/online.ts`).
  The plugin's `parseChapter` goes through the downloader's own cleaner and
  pictures (`fetchChapter`), and the chapter is made an EPUB with the
  series' manifest, its document where a download would put it
  (`chapterHref`). Kept ten minutes, twenty books at most, never written.
- **The text reader opens it like any volume.** The read route gives each
  chapter with no file the file `online:<entry>` and its document's locator,
  and the EPUB routes (`readEpubFile`, `epubMember`, the listing in
  `src/lib/server/epub.ts`) answer an `online:` file from that book, version
  `online`, `private, no-store`. So reading carries on from a downloaded
  chapter into an online one, and the contents sheet opens it.
- **A chapter the plugin doesn't send** is the text reader's failure page:
  DID NOT OPEN · THE SOURCE DID NOT SEND THE CHAPTER, with RETRY.
- **The series screen and the preview** read a novel's chapters as a manga's:
  rows open, ↓ downloads, START reads online; ▶ READ CH. 1 · ONLINE beside +
  ADD, into a browsing record (`addNovel(…, browsing)`).

`tests/novel-download-db.spec.ts` ("a chapter read online": the book, its
document, a member, nothing written, another series' or a failing chapter)
and `tests/browse-novels.e2e.ts` (the preview's bar, ↓, reading on into
chapter 3 online, opening it directly, `no-store`).

## The other devices, and the design's measurements (c168)

The phone and the landscape panel came with the screens themselves: the
bar keeps both cells with + ADD short, ▶ CONTINUE's line shortens, RECORD's
second line drops its date, the ↓ cell is 56px on the phone, and + ADD leads
HISTORY's long press there. What c168 adds is the proof, by machine, as
`~/.config/myconf/HANDOFF.md` asks:

- **The palette is the tokens.** Every colour the handoff uses is one
  (`reconcile-tokens`: seven of seven, `text-2`, `line-1`, `text-1`,
  `accent`, `text-prose` and the page), and the screens use the tokens,
  never the hexes.
- **The spacing is literal.** The theme has no length ladder, so the mock's
  hand-set values (24, 16, 14, 13, 12px and the rest) are the decision and are
  asserted as they are.
- **`tests/browse-preview-frame.e2e.ts` is generated** (`gen-conformance`)
  from `Online-Preview.dc.html`'s fresh state: the bar, the identity, the
  CTA, the SOURCE row and the list head, every measured property. It found
  one difference, now fixed: the list head's two halves are spaced apart
  (`space-between`), as drawn. Regenerating overwrites it.
- **`tests/browse-online-devices.e2e.ts`** is the hand-written sibling: the
  phone's 56px cells and 52px rows with + ADD short, the landscape panel's
  440px, the RECORD row's 68px and FORGET, the series rows' 72px ↓.

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
- **No byte line on a page still arriving**: the engine's image proxy says
  nothing of progress, so the dashed cell waits without one.
- **A rate limit is the whole chapter's, not a page's**: the design counts
  down on the cells that wait; tsundoku learns of a limit when it asks for
  the page list, so the countdown is the waiting page's. A page refused
  later fails with RETRY.
- **The scrubber doesn't fill with the pages that arrived** (line-2): the
  reader doesn't hear back from each image yet.
- **A page's size isn't known before it arrives**: the source gives none.
  Each page's box takes the size its image arrived at, and a page still on
  its way the last size any page arrived at; before the first, a manga
  page's shape. Until 2026-10-29 the box stayed a manga page's shape for
  good, so a manhwa's tall slice was drawn as a narrow column with black
  either side, at any zoom. A page that arrives a different size above the
  one being read doesn't move it: the strip holds its place
  ([`READER.md`](READER.md), "Vertical"). Spreads and wide pages still go by
  the manifest, so a paged screen never regroups as images arrive.
- **The end page of a record's last chapter still asks for a rating**, not
  - ADD (the top bar has + ADD).

## Not done yet

- **Phone and landscape** for the online screens, and the design's
  conformance tests (card c168).

`tests/browsing-db.spec.ts`: written on the first open, the same series the
second time; on no shelf, count or search, and not IN LIBRARY at its source;
nothing queued or followed; in HISTORY as NOT IN LIBRARY; ADD keeps the
series and its place, and opening again plays the library's.

## A library with no Mihon folder

ADD, and opening a chapter online (which records the series as browsing), put
the series in the library's Mihon root. A library that never had a `Mihon/`
folder, as a friend's new install never does, had no such root, and both
refused: ADD said "there is no Mihon library to add it to", and READ ONLINE did
nothing at all (2026-10-30). Now the first one makes the root a scan of
`Mihon/` would (`<library>/Mihon`, `ensureNamedRoot`). The Mihon name itself is
legacy, and c191 kept it: the folder is also where a backup goes
([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Where it reads from").
