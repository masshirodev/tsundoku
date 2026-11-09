# Catalogue links

A series can be linked to its **MyAnimeList** and **AniList** entry. A link
gives a series a cover when it has nothing of its own to show, and later
it gives tracking (card c37, "Link series to MyAnimeList / AniList: covers,
then tracking", which absorbed c62, "Get missing covers to imported books by
scrapping").

- Brief: [`briefs/done/CATALOGUE-LINKS.md`](briefs/done/CATALOGUE-LINKS.md).
- Handoff: `doc/design/handoff/Catalogue Links.dc.html` (the overview),
  `Link Review.dc.html` and `Series Link.dc.html`.
- Code:
  - `src/lib/library/catalogue.ts`: the pure rules.
  - `src/lib/server/catalogue.ts`: AniList, the pass, the review.
  - `src/routes/links/`: the review screen.
  - `src/routes/api/links/`: its decisions.

This was the first of two deliveries: links and covers. Tracking, reading
and writing status, score and chapter on both catalogues, is the second, in
[`TRACKING.md`](TRACKING.md).

**The review is shared with Ranobe** since 2026-09-27 (card c66): a novel
the Ranobe pass couldn't link by its ids comes to the same `/links`, with
Ranobe's candidates, ahead of its AniList item if it has one. That half is
[`RANOBE.md`](RANOBE.md), "The review".

## What the owner decided (2026-09-24)

1. **Titles of series that aren't hidden may be sent to AniList** to search.
2. **Tracking reads and writes, on both AniList and MAL**, with AniList as the
   main list.
3. **The tablet's Mihon stays untracked.** The owner tracks on the phone only.
4. **A score fills an unrated series' rating, once** (Catalogue Links 1w): when
   the link is made, 9 out of 10 stays 9 (halved to 4 out of 5 until c67 made
   ratings out of 10). UNDO takes it back. Since c67 the rating _is_ the score
   sent back ([`RATINGS.md`](RATINGS.md)).

## Where a link comes from

| Via     | How                                                                                        | Sure?        |
| ------- | ------------------------------------------------------------------------------------------ | ------------ |
| `mihon` | A MAL tracker (Mihon tracker 1) in a backup, at import                                     | Yes, at once |
| `exact` | The background pass's AniList search found one entry whose title equals one of the series' | Yes, at once |

An anime's season past the first is the exception to the `exact` row: its
title is the season's own (below, "One season, one entry").
| `review` | The owner chose a candidate in the review | The owner's say |
| `pasted` | The owner pasted an AniList or MAL link | The owner's say |
| `list` | The owner's AniList list, once signed in ([`TRACKING.md`](TRACKING.md)) | Yes, at once |
| `relations` | A season offered by the linked entry's own prequels and sequels, ticked by the owner | The owner's say |

`relations` is a season's alone (`series_season_links.via`); `series_links`
has no such value.

`exact` is the **background pass's only** (the owner's rule, 2026-11-02): a
search the owner runs never links by itself, even when exactly one result has
the same title. It offers that result, marked **EXACT TITLE**, and waits for
the owner's LINK.

Measured on 2026-09-24, when a device's mirrored `Mihon/` was still read
(c191 stopped that; a backup placed in the library's `Mihon/autobackup` is
what a run reads now):

- The **phone's** backup (`LIBRARY_ROOT/devices/phone/Mihon/autobackup`)
  carries 110 MAL links, and every one matches a library series by its Mihon
  URL.
- The tablet's Mihon is a debug build, and its backups carry no trackers.
- The phone's backup has no AniList trackers. Mihon's AniList tracker isn't
  signed in there, although AniList is the owner's main list.

**Sure** means an exact title, after normalising case, accents, punctuation
and curly quotes (`normaliseTitle`). Any of the candidate's titles (English,
romaji, native, synonyms) can equal any of the series' own (title and
`alt_titles`).

- A novel never matches a comic, however equal the title.
- **An anime never matches a manga, a manhwa or a novel, nor any of those an
  anime** (c298). AniList has two catalogues, and a series is searched,
  resolved and matched in its own: `ANIME` for an anime, `MANGA` for
  everything else.
- Manga and manhwa count as one kind: AniList calls both MANGA, and Mihon's
  guess between them can be wrong.
- A title Mihon cut short with `...` never matches exactly. It's searched
  with the stub taken off and goes to the review.
- **Two entries of the same kind under one title** are no sure match, unless
  one names the year the series' own title does: "Ranma ½ (2024)" takes the
  2024 series, not the 1989 one, and a series with no year in its title takes
  neither.

#### One season, one entry

An anime's season is searched by its own title (`Show Season 2`), and is
judged by it too (wave 17, round 2):

- **A season past the first is sure only by its own titles**: the series'
  titles with the season after them (`seasonSearchTitle`, `Show Season 2`),
  and a title the owner typed. Never the series' plain title, which is season
  1's entry: AniList's answer for `Show Season 2` usually lists `Show` too,
  and taking it would send season 2's episode numbers to season 1's entry.
  Not cleaned either: `cleanTitle` takes `Season 2` off and gives the plain
  title back. Season 1 (and a flat list's season 0) is judged by the series'
  titles, as a comic is. An entry titled `Show 2nd Season` is not equal to
  `Show Season 2`, so it waits for the owner's LINK.
- **No two seasons or parts of a show are the same entry**, AniList id or
  MAL id. `linkSeason` refuses an entry another season or part holds
  (`seasonHolding`; a `series_links` row with no season row beside it counts
  as the first season's, which since rung 68 no anime has), whatever the door: the pass's sure match (it is then
  offered), the owner's list (`linkSeasonFromList` writes nothing), LINK N
  SEASONS from the relations, the queue's LINK and a pasted link (the API
  answers 409, and the page says `NOT OFFERED FOR THIS ONE · NOTHING
CHANGED`). A season's own entry linked again (a CHANGE to itself) is not
  refused.
- **A season's candidates leave out an entry another season holds**: at the
  save (`saveSeasonSearch`, so the four kept are the season's to choose from,
  and `found` counts them) and again at read time (`seasonCandidates`,
  `offeredSeason`), since season 1 may be linked after season 2 was
  searched. So season 2's item never offers season 1's entry, and LINK
  refuses it whatever the page posts. Two doors still show such an entry,
  each saying which season holds it (c418): the relations page, unticked and
  never kept as a candidate ("The series screen", below), and PASTE A LINK,
  which reads any entry and, for one another season holds, says
  `SEASON 2 HOLDS THIS ENTRY · LINK REFUSES IT` and keeps LINK dimmed.

### Cleaning a title before it's searched

Most searches that found nothing on the first pass (2026-09-24) were titles
with something added by the files or the source. `cleanTitle` takes off:

- brackets: `One Piece (Official Colored)`;
- volumes, books, parts and seasons: `The Apothecary Diaries: Volume 4`,
  `The Beginning After the End: Book 10: Retribution`;
- chapter ranges: `Lord of the Mysteries: 1-1429`, `Pick Me Up! c1-591`;
- a zero-padded number: `The Beginning After The End 08`;
- the kind: `SSS-Class Suicide Hunter Novel`;
- curly quotes, turned straight: AniList's search finds nothing for
  `Swordmaster’s Youngest Son`, and "The Swordmaster's Son" for the same with
  `'`.

A number that's the title's own (`Kaiju No. 8`, `Mob Psycho 100`, `86`)
stays. If the clean title finds nothing, the part before a subtitle is
searched once more (`Clevatess - The King of Devil Beasts, …` →
`Clevatess`). For a sure match, the cleaned title and what the brackets hold
(`Hero Killer (Beolkkul)` → `Beolkkul`) count as titles of the series too.
A title the owner types into SEARCH AGAIN is searched as typed.

### Manga, novel or anime

AniList holds a comic and its novel as two entries under the same title
(The Beginning After the End is both), and an anime as a third. The search
asks only for the series' own kind's catalogue and formats: `NOVEL` for a
novel, `MANGA` and `ONE_SHOT` for a comic, and `ANIME` with `TV`, `TV_SHORT`,
`MOVIE`, `OVA`, `ONA` and `SPECIAL` for an anime. So a novel never takes up
one of a comic's candidate slots, nor either one of an anime's, and the other
way round. A series whose kind is wrong here won't find its entry; PASTE A
LINK is the way round that, and only with a link of its own kind.

An anime's candidates show FORMAT, SEASON (its season and year), EPISODES and
STATUS, where a comic's show FORMAT, YEAR, CHAPTERS and STATUS. Its MAL id,
which AniSkip needs, is AniList's `idMal` on the anime entry.

Some entries AniList's search doesn't return at all. On 2026-09-24 that
included the manhwa of The Beginning After the End (only the anime came
back) and Leveling Up With the Gods. Those are PASTE A LINK too.

AniList also lacks many web novels: Lord of the Mysteries is only a manga
there, and The Beginning After the End's novel isn't there at all. MAL
lists more of them. Searching MAL needs a client id, which comes with the
tracking delivery.

### A novel linked to its comic's entry: cover and details only

The owner's call, 2026-09-24: a novel AniList doesn't have as a novel may
link to its comic's entry, for the cover and the details. When a novel's
search finds nothing in `NOVEL`, it's searched once more in the comic
formats. What that finds is offered, marked **A COMIC · COVER ONLY, NEVER
TRACKED**, and **never linked by itself**, even on an equal title: a comic
is another work under the same name. A pasted manga link on a novel is the
same, and so is the other way round (a comic linked to a novel's entry).

The link keeps the entry's format (`series_links.format`, rung 26), and
since rung 70 (c520) it also keeps the entry's `country` and start `year`,
which a comic's LISTS line names (`MANHWA · 2020`); `coverOnly` tells such a
link from the rest. Its line on LISTS says **THE
COMIC’S ENTRY · …** and **COVER AND DETAILS ONLY · NEVER TRACKED** (c424). **Tracking must
never send progress through one:** a novel's chapter 300 isn't the
manhwa's.

**Anything less is never linked silently.** The first four results wait in
the review. So does a search that found nothing, so the owner can search
again or paste a link.

### What's never searched

- **Hidden series.** Sending a hidden title to a third party is a trace, and
  reveal doesn't change that. With reveal on, a hidden series can still be
  linked by pasting a link, which sends only the id.
- **Doujins and anything from Hentoid.** A catalogue of manga and novels
  doesn't hold them.
- **A series already linked, or settled:** NONE OF THESE, or an UNLINK. An
  anime linked or settled a season at a time is decided by its seasons alone
  (c240): it is searched, queued for the review and offered to the list's
  auto-link while **any one** season has neither a link nor a decision.
  An anime with no season rows -- settled before rung 62, or never acted on
  -- is read by `series_links` and `link_decisions`, as a comic is. One
  _linked_ before rung 62 was too, so its one link settled the whole series
  and its season 2 never came to the pass or the review, until rung 68 moved
  that link onto its season (c383; "A link from before the seasons", below).
  One rule at every door: the pass (`searchable`), the review and its count
  (`linkQueue`, `linkQueueCount`), `links --again` (`requeueSearched`), the
  list's auto-link (`linkableByTitle`) and Ranobe's review line that says an
  item is in AniList's own review (`IN_LINK_REVIEW`). `NEEDS_LOOK` in
  `catalogue.ts` asks it of a series, `seasonOpen` of one season.

  **An anime's search is its season's, and stored once** (wave 17; c352,
  c355). AniList and MAL list each season as its own entry, so a search is
  one season's: its title, its hits, its candidates. They live in
  `season_link_searches` and `season_link_candidates` only. The series-level
  `link_searches`/`link_candidates` belong to a comic or a novel and are
  never written or read for an anime -- a series-level search would be one
  season's standing in for the others, which is how the queue once offered
  season 1's entry for season 2. (Rows an anime has there from before rung
  62 are left in place and read by nothing. That includes a SEARCH AGAIN
  the owner queued for an anime before this branch, while AniList was out
  of reach: its typed title is **discarded**, and the pass searches each
  open season by the season's own title instead. The owner types it again
  on the season it was meant for.)

  - **The pass** searches each open season whose own search hasn't run (or
    waits on a SEARCH AGAIN), by that season's title (`Fresh Show`, `Fresh
Show Season 2`), in one pass if the limit allows: a row of `searchable`
    is a season. A sure match is judged by the season's own title ("One
    season, one entry", above), links only that season, and only while it
    is still open at write time -- never over a season the owner linked or
    settled, even one linked while the search was out, and never with an
    entry another season holds. Linking or settling
    season 1 changes nothing about season 2's search: it is its own.
  - **The review queue holds an item a season** (c352): every open season
    with a searched row of its own, carrying that season's query, count,
    candidates and SKIP. The item's heading, its LINK button and the band
    after it name the season (`LINK · SEASON 2`, `LINK A TO SEASON 2`,
    `LINKED · SEASON 2 · …`), and LINK, NONE OF THESE, SKIP, SEARCH AGAIN
    and their UNDO post it. Season 0 (a flat list, the whole run) is named
    nowhere, as a queue item or as `/links?series=N`'s own season (c423):
    its LINK reads `LINK A`, the header `SERIES TO LINK`, the season bar
    only `12 EPISODES HERE`, and its bands no `SEASON 0 ·`. It still posts
    season 0, whose row is the whole show's. LINK accepts only a candidate of that season's own search
    (`offered`), never another season's and never the series', and never
    an entry another season or part of the show holds.
    **A season's LINK in the queue advances the queue**, to the next item,
    one season per item, by choice (c672, the owner, 2026-11-07): it never
    keeps the page to offer the rest of the show (a queue load has no
    `data.season`, so `staysForTheRest` is false there), for speed through
    the queue. A whole show is linked from its own `/links?series=N`, whose
    LINK offers the rest of the show and LINK N SEASONS (below).
  - **A door that names no season** (`/links?series=N` with no `&season=`,
    the API called without one) acts on the season that still wants a look
    (`seasonToLook` in `season-links.ts`, the TypeScript twin of
    `NEEDS_LOOK`): the open season if it has neither a link nor a decision,
    otherwise the first season in list order with neither.

  The season **being watched** (`openSeasonOf`) is a different question, and
  the one a rating, EDIT's sheet and the cover ask.

**Resolving** a MAL link from Mihon learns its AniList entry and cover. It
sends only ids, fifty to a request (`Media(idMal_in: …)`), and needs no
key.

### An import never undoes the owner

- An UNLINK is remembered (`link_decisions`, `unlinked`; an anime's in
  `season_link_decisions`, a season at a time), and an import won't bring
  the tracker's link back.
- A link the owner chose (review, pasted) is never replaced by a tracker.
- A tracker that moved to another MAL entry moves a link it made itself.

## The pass

`refreshLinks` runs before the covers are made:

- in the background after every import (START SCAN, and the sync timer's);
- in `yarn run covers`, unless `--local`;
- by hand, with `yarn run links`.

It resolves waiting MAL links, then searches up to 60 series (all of them by
hand; `--limit` caps it; an anime's open seasons are a row each, so a
three-season show is three of the 60; and `--again` first searches again every series a
pass searched and couldn't link, with titles cleaned as they are now). A SEARCH AGAIN goes first, then series with no
cover. Five titles go to a request, as aliased `Page` queries. Last, it
walks the relations of up to 10 anime into the relation cache (c358, "The
relation cache", below).

**After an import the relations step runs before the covers**, since it is
inside `refreshLinks` and `afterImport` awaits that before tracking, Ranobe
and the covers. Each anime's walk is up to `HOPS + 2` (14) requests, one a
round, at the 2.1 s spacing: about 30 s for one anime at most, and up to
about five minutes for all 10 of a pass in the worst case (a typical chain
of a few seasons is three or four rounds, under ten seconds each). The
covers of a large import can wait that long behind it; the step is skipped
once AniList is unreachable.

AniList asks for no more than 30 requests a minute (its degraded limit), so
calls go one at a time, 2.1 s apart, whoever asks, and a 429 waits as long
as it says. **Unreachable is not an error:** the pass stops, and the next one
carries on. `TSUNDOKU_ANILIST=off` makes every call unreachable. The e2e
server runs that way, so the suite never reaches AniList.

`TSUNDOKU_ANILIST_URL` is the other address AniList can be at, and it exists
for the e2e alone: `links-flow.e2e.ts` serves a stand-in catalogue and points
the preview there. **It receives a signed-in owner's bearer token**
(`post` sends `authorization: Bearer <token>` to it), so it is never pointed
anywhere but a local stand-in. An update's installer drops it, so a new
version does not inherit it; a shell or unit that exports it still points the
owner's token there, so it belongs only in a data folder `.env` beside a
local stand-in.

### The relation cache (c358)

An anime's AniList relation graph is cached per series, for the series
screen's seasons around it ([`SERIES.md`](SERIES.md), "The seasons around
it"): the seasons before the ones it holds and the one after, and the
extras met on the way, and every series' OTHER FORMS (c700, the same
section's neighbour). **The screen reads only the cache; nothing asks AniList
on a page load.** A comic's or a novel's row (c700) is one hop from its own
entry, asked in AniList's `MANGA` catalogue in the same pass, with a limit of
its own so a large library of comics cannot keep an anime from its turn; a
link to another kind's entry (a novel on its comic, for the cover) is not
asked. A season linked between an anime's first and last has its edges asked
too, so OTHER FORMS can read one hop from each.

**A middle season AniList answers nothing for** (deleted there, or linked to
an entry in another catalogue, since the ask is `Media(id, type: ANIME)`)
does not cost the series its graph (c700's round 2). AniList answers a
request holding one such id with HTTP 404 and **every** alias null, the good
ones too, in any order (measured 2026-11-08; the answer is quoted in
`tests/other-forms-db.spec.ts`), so a request of several that answers nothing
is asked again one entry at a time, `first` and `last` first. That costs the
series one request per entry, once, on the pass that meets it. The graph is
stored from what answered and names the rest in `unanswered`; a `first`, a
`last` or an entry the walk has to stand on still fail the walk and leave the
old graph, as they always have. **`unanswered` ends two ways:** a relink of
that season (the new id is not on the record, so the very next pass asks for
it) and the ordinary seven days (the refresh asks every entry again and
rewrites the record, so a season answering again is read then, and not
before). A link whose stored format is another kind's is never asked at all.
The comics' request of ten is re-asked one at a time the same way, so one dead
link doesn't cost the other nine theirs; the dead one stays due, as an anime's
dead `first` does.

**The table** is `series_relations` (rung 73), one row a series, gone with
the series (`ON DELETE CASCADE`):

| Column       | What it is                                                                               |
| ------------ | ---------------------------------------------------------------------------------------- |
| `series_id`  | The series. Primary key.                                                                 |
| `graph`      | JSON `RelGraph` (`src/lib/library/seasons-around.ts`); NULL until a walk first succeeds. |
| `fetched_at` | When `graph` was last written; NULL exactly when `graph` is (a CHECK).                   |
| `tried_at`   | When the pass last asked, which a failed ask moves without touching `graph`.             |

`RelGraph` is `{ nodes: { "<anilist id>": RelNode }, unanswered?: number[] }`
(`unanswered` above, absent when empty), and a `RelNode` is
what an edge's `node` answers: `id`, `type` (`ANIME`), `format`, `status`,
`episodes`, `year` (`startDate.year`), `title { english romaji native }`, and
`edges: [{ type, id }]`, AniList's `relationType` and the other entry's id,
**every edge it has, of every kind** (PREQUEL, SEQUEL, SIDE_STORY,
SPIN_OFF, ALTERNATIVE, ADAPTATION, …), for an entry the walk stood on, and
`null` for one it only met as a neighbour (whose facts came with the edge).
So a reader that wants other forms than the seasons (OTHER FORMS, c700)
finds every relation of every entry on the chain there, and the neighbours'
format and titles, without asking AniList again; it must treat `edges:
null` as "not asked", never "none".

**Which entries it starts from** is not stored: it is read from the series'
own season links (`series_season_links`, rung 62) each time.
Back from the earliest linked season's entry, forward from the latest's
(`walkFrom` in `src/lib/server/relations.ts`). A graph that cannot answer
for the links the series has now (the walk needs an entry whose edges it
doesn't hold) is not drawn.

**The walk** (`walkSeasons`, pure): PREQUEL back to the chain's start and
SEQUEL forward to the next season, through any format, a TV, TV_SHORT or ONA
entry being a season and a MOVIE, OVA or SPECIAL on the chain an extra; a
SIDE_STORY of any entry stood on, and the other branch where a chain forks,
are extras too. A visited set, an edge that goes back in time refused (a
PREQUEL that starts after, a SEQUEL that starts before: a loop's closing
edge), and at most 12 steps either way (`HOPS`). An entry's start is its
year, and an announced (NOT_YET_RELEASED) entry, dated or not, starts after
every one that has aired (`when`): AniList leaves a TBA sequel's start empty as a
rule, and that sequel is what usually closes the loop, naming season 1 its
SEQUEL while season 1 names it its PREQUEL. Without that, the walk back from
season 1, 2 or 3 took the PREQUEL into the announced season and drew it, and
the seasons after the held one, as earlier seasons. An entry that has aired
(FINISHED, RELEASING, CANCELLED, HIATUS) but that AniList leaves undated,
mostly specials, OVAs and ONAs, starts no earlier than the latest of its own
PREQUEL neighbours that have aired (`startsBy`; an undated one counted by its
own bound in turn): it can't start before a season it follows. So an undated
movie between two seasons ranks with the first and stays on the chain, and
an undated last season or OVA closing the loop (naming season 1 its SEQUEL)
ranks after season 1, and season 1's PREQUEL into it is cut. One with no aired
entry before it has no rank: its edges are taken as AniList gives them,
except that it still comes before an announced entry (a PREQUEL from it into
the TBA sequel closes the loop as from a dated season). c358's round 3 and
its review: round 2 had ranked every undated entry as announced and cut real
seasons off the chain; round 3 gave every undated aired entry no rank, and a
loop it closed was walked round. The cut is by date, not
by reachability: a chronological prequel made later (AniList listing a
later-made prequel season as the original's PREQUEL) is refused too, and is
drawn neither as a season nor as an extra. Manga (an ADAPTATION) and
spin-offs are never followed and never drawn.

**A pass** fills it: the background fill's every ten minutes ("How the cache
fills", below), and `refreshLinks`' last step after an import or by hand. Each
is `refreshRelations`, up to 10 anime a pass (`refreshLinks({ relations })`),
the ones never asked first, then the longest since asked. An anime is due when it has no graph,
its graph can't answer for its links, or the graph is 7 days old
(`RELATIONS_STALE_MS`). A walk asks several entries to a request (aliases,
`Media(id: $iN, type: ANIME)`), one request a step. **A failed walk keeps
the graph the series had**: an error, an entry AniList answers nothing for,
a walk past its rounds, or links that moved while AniList answered (the
graph is checked against the links again before it is stored) moves only
`tried_at`. `Unreachable` stops the pass, as it does for links. A graph
whose series has no linked season any more (UNLINK) is dropped by the next
pass.

**What makes it stale**, and what each does:

- a **relink** to another entry: the walk from the new entry needs what the
  graph lacks, so nothing is drawn until the next pass walks it;
- **UNLINK**: no season linked, nothing drawn at once; the next pass drops the row;
- **a season linked** since: drawn at once when the graph already holds the
  new entry's edges (a season on the chain the walk stood on), otherwise
  nothing until the next pass;
- **the series deleted**: the row goes with it; a fold (an import's
  `foldSeries`) moves it to the survivor only when the survivor has none
  (`UPDATE OR IGNORE`), and either way the read checks it against the
  survivor's links;
- **MOVE**: keeps the series, its links and the graph (doc/MOVE.md); FIND
  reads the series' source at load, so it searches the new one;
- **a refresh that fails**: the old graph stays and is drawn;
- **age**: 7 days, then the next pass walks it again.

"In the library" is another series' own season link for that entry, under
the reveal filter (`libraryWhere`), never a title.

#### How the cache fills (c839)

**On every install, by a timer inside the served app.** `init` in
`src/hooks.server.ts` starts `startRelationsFill` (`relations-fill.ts`), so the
workstation and a friend's install fill the same way: `ops/systemd/` is the
workstation's and nothing like it ships to a friend, Windows included. A link
is asked with no import and no `yarn run links`.

The timer runs only the relations step (`fillRelations` in `catalogue.ts`),
never `refreshLinks` whole, so it never searches a title. It asks by AniList id,
with no sign-in; a hidden series' id is asked as the import's pass always asked
it, since an entry's relations are no more private than its title (c240).

**The cadence.** The first pass comes 60 s after the app starts, then one every
10 minutes. AniList's limit is 30 requests a minute (the live answer's
`x-ratelimit-limit: 30`, read 2026-11-08), and the queue spaces them 2.1 s
apart, whoever asks, so no pass can pass 28.6 a minute however long it runs. The
interval decides how much of that a pass may take. An anime's walk is at most
`HOPS + 2` = 14 rounds, a request each, plus one request per linked season if
its first round is voided (`askAlone`); ten comics are one request, plus ten
alone if that one is voided. So the worst pass is 10 x (14 + S) + 11 requests
for S linked seasons a show: 201 at S = 5, 422 s of the queue, 20 a minute over
the ten minutes, two thirds of the limit, leaving the queue room for whatever
else asks. Shows with more linked seasons can take longer than the interval (351
requests, 737 s, at S = 20). That only skips ticks, and it never passes the
limit, since the 2.1 s spacing holds whatever a pass takes. A usual pass is far
less: a library of comics costs one request a pass, and a library of 474 linked
series takes about 48 passes, so about eight hours once. After that a pass asks
only for what is due: a new link, and a graph reaching seven days.

**When nothing is due, a pass asks nothing, and the timer is free of the
network and of the database's write lock.** That is the steady state
(`tests/relations-fill-db.spec.ts`).

**What each thing does to it.** A tick is skipped, never queued, if the last
pass is still running.

| What happens                                  | What the timer does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AniList unreachable or down**               | Down means the network failed, three 429s, any 5xx, a 403, or a body that isn't JSON (`Unreachable`, `AnilistDown`). The pass stops and nothing is stamped, so it costs no series its turn: when AniList answers, the next tick gets graphs. One line the first time, none after until a pass gets through, no faster retry. A 400, or a 200 with an `errors` array, is about the request, so it still counts against the series. A 403 was never seen; it is here because a token-less request for public ids has nothing to forbid. |
| **A 429**                                     | The pass waits as long as it says (`post`), up to three tries; then it counts as unreachable. A tick during the wait does nothing.                                                                                                                                                                                                                                                                                                                                                                                                    |
| **A series AniList can't answer**             | `tried_at` moves and it waits a day (`RELATIONS_RETRY_MS`) instead of being asked every ten minutes for good, and takes no turn from the rest. A link made since the failed ask ends the wait at once. A pass of `refreshLinks` ignores the wait, as it always asked.                                                                                                                                                                                                                                                                 |
| **`TSUNDOKU_ANILIST=off`** (every e2e server) | No timer at all: no request, no line, and no write.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`TSUNDOKU_ANILIST_URL`** (a stand-in)       | No timer unless `TSUNDOKU_RELATIONS_FILL_MS` asks for one; that value is honoured nowhere else, and an installer drops the stand-in's address, so a real install keeps ten minutes.                                                                                                                                                                                                                                                                                                                                                   |
| **A link pass, in any process**               | `refreshLinks` (an import, `yarn run links`, `yarn run covers`) writes `settings.link_pass_until` as it runs (15 minutes, renewed; it ends by itself if the pass dies) and clears it after. A tick finding it stands aside, and a fill already running gives way at its next series. The 2.1 s queue is per process, so this is what keeps two processes from spending the limit twice.                                                                                                                                               |
| **Two writers at once** (stamps)              | Both are one statement, and a stamp touches only `tried_at`: a failure beside a stored graph keeps the graph. If two passes in two processes ever ask the same series, the worst is the same request twice.                                                                                                                                                                                                                                                                                                                           |
| **A locked database**                         | `busy_timeout` is 5 s (`getDb`); past it the pass ends with one line, and the next tick carries on. An idle tick takes no write lock at all.                                                                                                                                                                                                                                                                                                                                                                                          |
| **A shutdown during a pass**                  | The timer stops, the pass ends at the next series, and every write it made is whole: each is one statement. Its wait for AniList no longer holds the process open (`releaseAnilistWaits`), so a 429's minute can't outrun `TimeoutStopSec`.                                                                                                                                                                                                                                                                                           |
| **A build, a prerender, analysis**            | `init` runs at startup (adapter-node's `handler.js`, `vite preview`) and on a dev server's first request. SvelteKit also runs it for a prerender (`postbuild/prerender.js`), and this app has none; `building` keeps the timer out of one if it ever does. The timer is `.unref()`ed either way.                                                                                                                                                                                                                                      |
| **A dev server's reload**                     | The previous timer is stopped first (`globalThis.__tsundokuRelationsFill`), so a reload never makes two.                                                                                                                                                                                                                                                                                                                                                                                                                              |

`TSUNDOKU_ANILIST_URL` still belongs only beside a local stand-in ("The pass",
above).

## Covers

A link's cover is a new source in the chain ([`COVERS.md`](COVERS.md)):

1. a page chosen by hand;
2. a folded book's edition, or a series of books' first book;
3. a cover the files carry;
4. the source site's cover URL;
5. **the link's** (`link:anilist:<id>`);
6. the first page.

A site that refused (`cover_failed_at`) stands aside for the link, and so
does the first page. That's the point of the order: a scanlator's credits
page shouldn't beat a real cover. The link's cover is fetched only in a
remote pass, never while a screen waits. LINK in the review starts one for
that series in the background.

## The screens

### The library band (Catalogue Links 1a)

**NN SERIES TO LINK · FOUND ON ANILIST, NOT FOR CERTAIN · REVIEW →**, below
POSSIBLE DUPLICATES, which are older and fewer.

- The count is the review's queue (`linkQueueCount`), only what can be seen.
  Hidden series are never searched, but a series hidden after its search
  stays in the queue, so with reveal on the count can be higher: reveal does
  change it (c430's second half was that).
- It's gone at zero.
- Offline, it keeps the last count, says **THE REVIEW NEEDS THE WORKSTATION**,
  and dims its REVIEW cell.

#### Putting the band away

A ✕ after REVIEW → (c430) puts the band away until the queue grows: a new
series to link brings it back, the same ones again do not
([`LIBRARY.md`](LIBRARY.md), "The links band", has the rule, its two counts
and what reveal does to them).

**Per device, not on the workstation.** What it was put away at is kept in
this device's `localStorage` (`tsundoku.library.links-put-away`), as the update
band's "seen" is. Chosen because the band is a reminder about this screen, not
a fact about the library: putting it away on the tablet says nothing about the
phone, and a per-device choice needs no server, no cookie and no rung. What it
costs: another device still shows the band until it is put away there too,
and a full reload draws it for a moment until the page has hydrated and read
the key (a client-side return to the library does not). Remembering it on the
workstation would mean a row, or a cookie read by `+page.server.ts`, and one
choice for every screen the owner has. The queue itself is never hidden: TO
LINK, in the sidebar's foot and in MORE (c475), counts it while anything
waits, put away or not.

### The review, `/links` (Link Review 1b–1j)

One item at a time -- a series, or one season of an anime (c352; "What's
never searched", above) -- the series above its candidates, or beside them
on desktop and in tablet landscape.

- **Nothing is preselected.** Tap a candidate, and LINK A makes it.
- Each candidate shows:
  - its ids and OPEN ↗;
  - its cover, titles, and a line saying why it might be the one (`whyLine`);
  - FORMAT, YEAR, CHAPTERS and STATUS, drawn strong where they agree with the
    series (`candidateRows`); FORMAT, SEASON, EPISODES and STATUS for an anime;
  - **EXACT TITLE**, beside its ids, when one of its titles equals one of the
    series'. That is a mark, not a choice: LINK is still the owner's press.
- **NONE OF THESE** is remembered. **SKIP** sends it to the back.
  **PASTE A LINK** reads the link as one candidate, sending only its id. An
  anime's paste is the item's season's: its rows are set against that
  season's title and episodes, and its LINK lands there.
- **SEARCH AGAIN asks AniList at once** with the edited title, in the series'
  own catalogue and kind. **It never links: the results replace these and wait
  for LINK**, even when there is exactly one, or one with the same title. With
  AniList out of reach, the search waits for the next pass instead, and the
  band says so. **The SEARCH AGAIN cell only opens the form**; pressed while
  it is open, it puts the caret back in the field. The search is the form's
  own SEARCH (or Enter), below the field, so a double tap, or the press that
  opens it on a slow render, never searches a title nobody typed (c329). FIND on a series never searched searches as the review opens.
- The band, the panel's count and the rows show one search: the band counts
  what AniList returned, the count what was kept for the review, and the rows
  are exactly the kept candidates (`4 OF 6 FOUND`). A comic or a novel
  searched before the catalogue asked for its own kind keeps what that search
  stored until SEARCH AGAIN replaces them: they are still offered, a tap
  still links one (flagged **WRONG KIND**, never removed), and only the
  owner's press decides. An anime's search from before rung 62 (the manga
  entries it found, kept at series level) is no season's, so it is not
  offered at all: the pass searches each season again, in the anime
  catalogue, by the season's own title (wave 17).
- Every decision is carried out at once. UNDO takes back LINK (and a rating it
  gave), NONE OF THESE and SEARCH AGAIN. A search's UNDO puts back the search
  and the candidates it replaced; it never made a link, so it takes none back.
  LINK N SEASONS' band has an UNDO too (c595), taking back every season that
  post wrote (below, "The series screen"). SKIP has no UNDO, as in the mock.
- `?series=N` is one series only: FIND or CHANGE on its screen. It has no
  SKIP, and deciding goes back to the series, but for a season's LINK on an
  anime with more seasons whose answer has the rest of the show to offer,
  which it offers first, and for LINK N SEASONS, which stays with its band
  and UNDO (c644; both in "The series screen", below). For a hidden series it's
  PASTE A LINK only.

### The series screen (LISTS, c424; it was Series Link 1k–1t)

**LISTS** and **COVER** rows under SHELVES, on every series but a doujin.
LISTS is LINK and TRACKING as one row, a line per list
([`SERIES.md`](SERIES.md), "LISTS", has every state and where it is drawn).
The link is AniList's line, a line a season on an anime (c240; above).

- **Linked:** AniList's line has the entry's title, its format and its MAL id
  (AniList's where there is no MAL entry), its list's word, and EDIT. EDIT's
  sheet opens on that entry: ENTRY has its ids, where the link came from,
  and OPEN ↗, CHANGE and UNLINK, which left the row.
- **An anime trades one link for one a season** (c240, the owner's decision
  A): AniList and MAL list each season as its own entry while a tsundoku
  series holds several, so an anime's LISTS row has a line a season -- tag,
  title, the season's word on its list, and EDIT or FIND; the season being
  watched adds `TV · 24 EP. · 2018 · MAL 36474` and what was sent. Three
  seasons or fewer have a line each; more fold round the one being watched,
  and SHOW opens the row. A season in two parts
  says so on one line (`2 PARTS · EP. 1 – 12 · EP. 13 – 23`). A season with
  no link says why, in the decision's own word: after an UNLINK
  `UNLINKED · NO PASS ASKS AGAIN`, after NONE OF THESE
  `NONE OF THESE · NO PASS ASKS AGAIN` (`SeasonRow.decision`, the latest of
  its parts'), else what its last search found. A series with one season
  (or a flat list) draws one ANILIST line, as a comic does, never an S tag
  or SEASON 0, and its UNLINK (in EDIT's ENTRY), which names no season,
  takes every part of that season and writes the season's own `unlinked`
  decision, never one for season 0. Ranobe stays one line under the seasons
  ([`RANOBE.md`](RANOBE.md)).
- **A season's link is its own row** (`series_season_links`, rung 62):
  `series_links` keeps meaning what it meant for a manga or a novel, and an
  anime has a row there only as **the link it had before rung 62, with no
  season row beside it** (`legacyLink`, the fallback; no door writes one for
  an anime that has a season row). From rung 62 to rung 73 an anime's first
  season was mirrored there; rung 74 (c467) took those rows, and the first
  LINK or UNLINK of a season ends a fallback too. Neither tracking, AniSkip (an episode is
  asked under its own season's entry, c349; the answers asked before that
  under another season's entry or part were forgotten by rung 67, c463, and
  are asked again on the next play; a season whose only row is an orphaned
  part 2 asks nothing at all, since nothing places its episodes, c592, c642)
  nor `tvshow.nfo` (the show's ids
  from its season rows, c381) reads it beside a season row. The importer's
  keep-test asks both tables (c382), OTHER NAMES on MOVE lists every season's
  entry (`linkedNames`), and the cover offered is the open season's, else the
  first season's (`linkCover`, which the review's cover line asks too). A
  link an anime had before rung 62 is its season's row since rung 68 (below).
- **A link from before the seasons** (c383, rung 68). Before rung 62 an
  anime's link was its one `series_links` row. Read as the whole series'
  link, it settled every season, so a two-season show linked then never
  offered its season 2. Rung 68 gives each such anime (a `series_links` row
  with an id and no `series_season_links` row) the row of the season the
  link stood for, **decided by the series' own episodes**: the **lowest
  numbered season** (1 and up, over the episodes not shadowed) when the
  source numbers any, so a special filed at season 0 does not take it;
  **season 0** for a flat list, or a series with no episodes yet, where one
  entry is the whole run. Part 1, with the link's ids, `via`, title, cover,
  dates, score and `filled_rating`; `episodes` and `year` were never kept and
  stay empty. A season decision at that place goes, as a LINK takes it, and
  what the owner's list said of the series (`tracker_state`, and a send still
  waiting) moves to that season, where an anime's is read. From there the
  season rule decides it: season 2 is searched by the next pass and comes to
  the review as its own item, and the series screen draws season 1 linked as
  before. The rung left the `series_links` row as it was; rung 74 (c467)
  removed it, its readers having moved to the season rows. An
  AniSkip answer of an episode outside that season (a special asked under
  the one link) is forgotten, since the link is no longer its entry. A
  series that already had a season row is not touched, and neither is a
  comic's or a novel's link.
- **A season's FIND** opens the review with `?series=N&season=S`: the search
  is that season's own title (`Sword Art Online Season 3`, the source's
  season number after the series' title), asked in the anime formats, and
  each candidate is set against that season's own episode count. With no
  `&season=` (or an empty one) the review opens on the season that still
  wants a look (above), then on the season being watched once every season
  is settled, never season 0 by default, which is a flat list's and real (`seasonNamed`, the same
  reader the series screen's forms use: there, no season named on UNLINK is
  every season). LINK A TO SEASON 3 writes that season's row. **A show with
  one season** (a flat list, or a single numbered season) has no rest to
  offer, so its LINK goes back to the series screen, as a comic's does, and
  the new link is on its ANILIST line (c423: Ranma ½ (2024)'s LINK stayed on an
  unchanged page and read as a refusal). Neither does a LINK whose answer
  has no relations to show (AniList out of reach, or no chain neighbour
  inside the show's seasons): it goes back to the series too, never to the
  untouched review (c423, round 2). Otherwise, after it, the page offers the rest of
  the show from the linked entry's AniList PREQUEL and SEQUEL relations, in
  order along the chain and ticked where the episode counts agree -- or
  where two entries add up to the season as `PART 1` and `PART 2`, part 1
  being the one that aired first (not the longer one: SAO's War of
  Underworld is 12 + 11). A pair is two entries at the same step of the
  chain: both the linked season's SEQUEL, or -- AniList's usual shape --
  part 2 the SEQUEL of part 1 (c464). A SEQUEL is part 1's other half, not
  the next season, when its own title names a part of 2 or more (`Part 2`,
  `2nd Part`, `Cour 2`, `2nd Cour`, `第2クール`; `partNumber`) **and** part 1
  holds fewer episodes than the season here, so a catalogue that numbers
  whole seasons as parts (JoJo's `Part 3`) still offers its next season as
  one. The season after such a pair is asked one ring further, for the part
  alone, and so is whatever a part standing in the first ring reached (from
  S2 P1, part 2 took no step, so season 3 is asked and season 4 offered, the
  same reach as from a whole season 2; links round 2). Linking one part of a
  season offers its other part on the same season, at the part the link does
  not hold, ticked where the two add up **and** the edge agrees with that
  part: a PREQUEL is the earlier half, so it is ticked at part 1 only when the
  link holds part 2, and a SEQUEL at part 2 only when the link holds part 1.
  When the edge disagrees (the `Part 2` entry linked on part 1's line, the
  usual slip from a search or a pasted link), ticking it would write the
  season's halves in reverse and send every episode to the wrong entry under
  the wrong number, so it is listed as `THE EARLIER HALF` or `THE LATER HALF`,
  never ticked, with the why
  `THE LINK HOLDS THE LATER HALF AT PART 1 · NEVER TICKED` (or
  `… THE EARLIER HALF AT PART 2 …`). The way out is UNDO and linking the
  earlier half instead, whose walk then offers the `Part 2` entry at part 2,
  ticked (links round 2). When both halves are already stored that way round
  (the `Part 2` entry at part 1 and the earlier one at part 2, written by the
  round-1 walker or by hand), the other part is its slot's own link, but the
  page does not draw it as settled: its why is
  `ALREADY ITS LINK · THE HALVES ARE REVERSED`, never the plain
  `ALREADY ITS LINK` a pair stored the right way round reads (c541). The way
  out is the same: UNLINK both halves and link the earlier one.
  A pair is **one season** everywhere the page counts: `N OF M TICKED`,
  `LINK N SEASONS` and the band count distinct seasons (c418, round 2). The walk asks two rings: the linked entry, then
  its chain neighbours in one request, whose own PREQUEL and SEQUEL place
  the second ring (and a part placed there is asked once more, above). AniList answers every edge an entry has, and a chain can
  branch (a movie and the next TV season both SEQUEL of one entry) or loop
  back, so each entry is placed once, where the walk first reaches it.
  **Outside the numbering**, dimmed, never ticked and never kept as a
  season's candidate (so LINK N SEASONS cannot reach one): a movie or a
  special standing on the chain, and a `SIDE STORY` or `SPIN-OFF, NOT A
SEQUEL` of any entry the walk asked about (c351, the design's `SPECIAL
Sword Art Online: Extra Edition` and `SPIN-OFF Gun Gale Online`), whatever
  its format or count: a TV spin-off of 24 episodes is still no season. A
  side entry's own relations are not followed (Gun Gale Online's sequel is
  its own), an entry on the chain is never listed beside it too, and the
  other kinds (ADAPTATION, CHARACTER, SUMMARY, ALTERNATIVE and the rest) are
  not listed. They come last, under the seasons. A season already linked
  says `REPLACES …` and is not ticked either; its own entry offered back to
  it says `ALREADY ITS LINK` (or, for a pair stored reversed, `ALREADY ITS
LINK · THE HALVES ARE REVERSED`, above). **An entry another season or part already
  holds** is listed unticked, saying which (`SEASON 3 HOLDS THIS ENTRY ·
NEVER TICKED`; c418), since `linkSeason` would refuse it, and a split
  season with a held part is unticked whole. LINK N SEASONS writes the
  ticked ones (`via 'relations'`, each at its own part, `linkPicks`) and
  **the page stays, with its band and UNDO** (c644, the owner's decision of
  2026-11-07: c423's "deciding goes back to the series" gives way for this
  one action, because a multi-season write is the one that needs taking back,
  and on the series screen a wrong pick could only be UNLINKed one season at a
  time). The band is the workstation's answer, not the ticks: `LINKED 2
SEASONS · …` when all were written, and, when it refused any (another tab
  linked meanwhile), `LINKED 1 OF 2 SEASONS · …` and `SEASON 2 NOT LINKED ·
SEASON 3 HOLDS ITS ENTRY`, or `NOTHING LINKED · …` when none was. ← SERIES
  goes back when the owner is done. Under that band
  the season the page is on is drawn as it now stands (c465): linked, its
  LINKED row naming the entry with UNLINK beside it, the pasted entry and the
  forms put away -- never the untouched review it opened on. The workstation
  answers it with the counts (`seasonReview`, the same reader the page's load
  draws it with). The band's numbers
  are seasons, from the workstation's `linked` and `of` (`seasonsLinked`): a
  pair linked whole is one, and a pair with a part refused is that season
  not linked, the refusal naming its part. **A split season is linked whole
  or not at all** (c466, the owner's decision (b)): `linkPicks` writes a
  season's picks in one transaction, and when either part is held (or no
  longer offered) neither is written, so a season never tracks half its
  episodes and the band never reads `LINKED 0 OF 1 SEASON` over a part
  that was written. The season's one refusal names the part and what holds
  it, said once: `SEASON 2 NOT LINKED · SEASON 4 HOLDS PART 2’S ENTRY`
  (`… PART 2 IS NO LONGER OFFERED`, `… BOTH PARTS PICKED ONE ENTRY`). The
  other seasons in the same LINK are still linked; once the holder lets go,
  the relations tick the pair again and it links. This is LINK N SEASONS'
  rule, the one door that writes two parts at once: every other door
  (LINK on the review, a pasted link, the owner's list, the pass's sure
  match, `+ A SECOND PART`) writes one part through `linkSeason`, whose own
  refusal writes nothing. **Its band has an UNDO** (c595): it takes back
  every season that post wrote, and only those, each part as it stood before
  (the link and the decision the post replaced). The band carries those
  facts, never a fresh read, and the UNDO is one transaction -- a band that
  said UNDO and took back half a post would be a lie. It refuses whole, with
  nothing changed, if any part it wrote or read was linked, unlinked or
  decided again since (`LINKED OR DECIDED AGAIN SINCE`), and says
  `ALREADY UNDONE` to a second press. **A press that fails or is refused keeps
  the band and its UNDO** (c644), with the reason said in its own band above
  it (`… · NOTHING UNDONE`, or `THE WORKSTATION DID NOT ANSWER · NOTHING
CHANGED`), so it can be pressed again; so does another decision failing
  while the band is up. Only a band with nothing to take back (SKIP's) gives
  way to a failure. A reload drops the band, as single
  LINK's: it is the page's own state. After the UNDO the season the page is
  on is drawn again from the workstation (`/links/season`, the page's own
  reader without its AniList walk; c644), since a pair's other part may have
  been among the picks. The offer does not come back with it: LINK again on
  the season, or a reload, asks AniList for it. Both the LINK and its UNDO
  refresh the layout's TO LINK count (`invalidate('tsundoku:scan')`), which
  ← SERIES, a plain link, would otherwise carry back stale. **NOT NOW has two cases on one
  series.** After a LINK made on the page, it goes back to the series, the
  season just linked showing on its line on LISTS (c423, round 2). An offer that
  came with the page's load (CHANGE in EDIT's sheet on a linked season, while another season
  has no link) follows no decision made there: NOT NOW closes it and the page
  stays on the season, with SEARCH AGAIN, PASTE A LINK, UNLINK and its LINK,
  so a season linked to the wrong entry can still be changed or unlinked
  from EDIT (round 3). A pasted link neither asks nor clears a season's
  candidates, so it keeps what its last search found; one never searched has
  none, and its UNLINK stands among the actions then. In the queue NOT NOW closes
  the offer, and the band's UNDO stays.
- **A season's second part by hand** (c350; Track Calls' BY HAND: `+ A
SECOND PART` under a linked entry, the same search, then `FROM EP. 13`).
  For a season a catalogue splits at an episode its relations do not show.
  **Where it lives:** the season's own link page (`/links?series=N&season=S`,
  which EDIT on the season's line on LISTS opens), as a `PART 2` row under
  its LINKED row: `AFTER PART 1’S 12 EPISODES · + A SECOND PART`. It is
  drawn only while part 1 is linked, its entry lists a count, that count
  leaves episodes over (12 of 23 here), and part 2 has no link
  (`secondPart`, `src/lib/server/season-links.ts`). It opens the same page on
  part 2 (`&part=2`, a full load): `LINK · SEASON 2 · PART 2`, a `PART 1` row
  naming part 1's entry and its episodes, and a `FROM EP.` field filled from
  part 1's count + 1. The search is the season's own (its title), kept as
  part 2's (`season_link_searches` and `season_link_candidates` at part 2;
  run as the page opens when part 2 was never searched, as a season's FIND
  is), and its candidates leave out part 1's own entry (held) and are set
  against the episodes part 1 leaves (`11 · THIS HAS 11`). PASTE A LINK
  reads an entry for part 2 the same way. LINK A TO SEASON 2 PART 2 writes
  part 2's row through `linkSeason`, so an entry another season or part
  holds is refused and nothing is written, and goes back to the series,
  whose line then names both parts. NOT NOW stands where NONE OF THESE
  would (a second part settles nothing of the season), and the page's
  UNLINK, once part 2 is linked, takes part 2's row alone and writes no
  decision (part 1 is still linked, so the season is). That UNLINK sits in
  the tool row beside the candidates (SEARCH AGAIN, PASTE A LINK, UNLINK),
  where every linked season's is, since part 2's own entry is always one of
  its candidates; but once part 2 is linked `+ A SECOND PART` steps aside,
  so the page is reached only at its `&part=2` address (no door on the
  season's page leads back to it yet). A season whose only row is part 2
  (part 1 unlinked) has no second part to add: the page stands on part 2 and
  posts `part: 2`, and its search, its candidates and its paste are part 2's
  own (c592, `reviewItem`'s `part`), never part 1's. An orphaned part 2 has
  no span and sends nothing until part 1 is linked again: part 1's count is
  what places it, and nothing records that count once its row is gone. Its
  own count cannot place it either -- a list shorter than the season (part 2
  still airing, which is when part 2 gets linked alone) would start it inside
  part 1. UNDO of part 1 is refused while part 2 is
  linked (`PART 2 IS LINKED · UNLINK IT BEFORE UNDOING PART 1`), so a CHANGE
  of part 1 followed by its UNDO no longer makes such a season; a library
  that already holds one is read this way.
  The series screen's season line reads the season's own search, part 1's
  (`season_link_searches` at part 1), so part 2's never counts as the
  season's candidates or queue. A season never takes
  a third part: the API answers 400 for any part past 2
  (`CHECK (part IN (1, 2))`). **`FROM EP. n` is bound to part 1's count.**
  `series_season_links` keeps no start for a part: part 2 begins after part
  1's `episodes` (`partsOf`) -- and with part 1's row gone it has no start at
  all, so it sends nothing until part 1 is linked again -- and the send
  counts within it from there
  (`targets()`, `reachedFor`), so part 1's last episode completes part 1 and
  the season's EP. 13 is sent as part 2's EP. 1. A different `n` would have
  nowhere to live, so the field says
  `PART 2 STARTS WHERE PART 1’S 12 EPISODES END · FROM EP. 13`, LINK is
  dimmed, and the workstation refuses one posted anyway (409,
  `secondPartRefusal`). A free start needs a column; see "Not yet".
- **Not linked:** what the last search found, in its own words (`4 FOUND ON
ANILIST · NOT FOR CERTAIN`, `NOTHING FOUND ON ANILIST`), never which pass
  ran it: `link_searches.searched_at` can't say who searched, so the row
  doesn't claim the cover pass did, as the review's band doesn't (c337). A
  queued search does wait for the next pass, and says so. Then FIND (the
  accent, plain once NONE OF THESE or UNLINK settled it) and PASTE A LINK; a
  season's line keeps FIND alone, and PASTE A LINK is on the review it opens.
- **COVER** says where the cover comes from and why the sources before it
  gave nothing (`coverLines`). An Aniyomi series' picture is **the source's
  own**, never "Mihon's cover URL": it comes from the engine, which is what
  the review's row names.
- The review's series panel says **EPISODES** for an anime, not CHAPTERS, and
  names one source when the origin and the site are the same ("KICKASSANIME",
  not "KICKASSANIME · KICKASSANIME").
- **A link to the other kind is flagged, never removed**: a link row
  (`series_links`, or `series_season_links` on a season) whose format
  contradicts the series' kind (MANGA/NOVEL/ONE_SHOT on an anime, TV/MOVIE/OVA
  on a manga) says **LINKED TO THE WRONG KIND**. The LINK
  page's `?series=N` row offers **RELINK**; the series screen's own line says
  `LINKED TO THE WRONG KIND · NOTHING SENT` and `CHANGE SEARCHES ANILIST’S
ANIME`, and its CHANGE, the line's accent, is the door.
  OPEN ↗ opens the entry's own catalogue: the link's stored format decides,
  and the series' kind is only the fallback when it isn't known yet, so a
  manga's entry on an anime series opens `/manga/<its id>`, never a different
  work on `/anime/<its id>` — in EDIT's ENTRY, on each list's PROGRESS row in
  the sheet, and on the line itself offline. The owner may have wanted
  the link, and UNDO still takes it back; nothing is unlinked silently. A
  novel across to its comic's entry is the deliberate cover-only link, and
  isn't this.
- On the phone, the 440px panel and the TV, a line's two or more cells drop
  below it in equal columns; one stays at its end, and the tablet in portrait
  keeps them inline.
- Offline, EDIT turns into OPEN ↗, every other cell dims, and the strip above
  the lines says why.

## Where it departs from the handoff

- **The cover order.** Series Link 1s says "a hand-set or downloaded cover
  comes before the link". Here the link comes before the first page, as the
  brief had it (see "Covers" above). A page cover only shows when the link
  has none, or its cover didn't load.
- **LINK's band says "ITS COVER COMES FROM THE LINK"**, not "IN THE NEXT
  COVER PASS". LINK fetches it straight away, in the background, since the
  pass may be hours off.
- **The candidate letter for a pasted link** is the one after the search's
  candidates. The mock drew E with none.
- **SEARCH AGAIN searches now**, not in the next cover pass. That was the
  owner's call on 2026-09-24: the pass only runs after an import, which can
  be hours off, and one request is a second's wait. It still falls back to
  the pass when AniList can't be reached. Since 2026-11-02 it **never links**:
  what it finds waits for LINK, as the owner asked after Ranma ½ (2024)
  silently became its manga.
- **SKIP is offered when nothing was found too** (1c drew only SEARCH AGAIN
  and PASTE A LINK), the owner's addition, so such a series doesn't block the
  queue.
- **The paste field stays usable while AniList is unreachable**, so a blip can
  be retried. The mock (1g) dims PASTE A LINK and SEARCH AGAIN, and so do the
  action cells here.
- **A MAL link AniList doesn't know can't be pasted.** It says so. Showing it
  would need MAL's own API, which needs a client id (the tracking delivery).
- **"2,318 LINKED"** in the mock's settings is invented. There were 110 links
  on 2026-09-24.
- **`FROM EP. n` cannot be changed** (c350). Track Calls fills it from part
  1's count, which implies another value could be typed; the schema keeps no
  start for a part, so only part 1's count + 1 is taken, and another `n` is
  refused with where part 2 does start. "The season's link page" is the
  review page on that season (`/links?series=N&season=S`), where the row
  sits under LINKED; part 2's search is that page opened on part 2.
- **Tablet landscape** takes the desktop layout (1j). The mock drew only
  tablet portrait, phone and desktop.

## Not yet

- **Tracking** shipped ([`TRACKING.md`](TRACKING.md)); on the series screen
  its lines are LISTS' since c424. What this list still says of it (the
  owner's app registrations, the redirect on
  `https://workstation.example.ts.net:8443`) is TRACKING.md's to keep.
- **A second part that starts anywhere but after part 1's count** (c350).
  It needs a start column on `series_season_links` (a rung, and `partsOf`
  and `targets()` reading it); until then `FROM EP. n` is part 1's count +
  1 and nothing else.
- **A score from a review or pasted link** fills nothing. The score comes from
  the owner's list, which needs the sign-in. Only Mihon's MAL score fills a
  rating today.
- **The settings' CATALOGUES section** comes with the sign-ins.
- **MAL's status, score and chapter** from Mihon's backup aren't kept yet,
  only the score, for the fill.
