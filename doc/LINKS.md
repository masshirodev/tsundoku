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

| Via         | How                                                                                        | Sure?           |
| ----------- | ------------------------------------------------------------------------------------------ | --------------- |
| `mihon`     | A MAL tracker (Mihon tracker 1) in a backup, at import                                     | Yes, at once    |
| `exact`     | The background pass's AniList search found one entry whose title equals one of the series' | Yes, at once    |
| `review`    | The owner chose a candidate in the review                                                  | The owner's say |
| `pasted`    | The owner pasted an AniList or MAL link                                                    | The owner's say |
| `list`      | The owner's AniList list, once signed in ([`TRACKING.md`](TRACKING.md))                    | Yes, at once    |
| `relations` | A season offered by the linked entry's own prequels and sequels, ticked by the owner       | The owner's say |

`relations` is a season's alone (`series_season_links.via`); `series_links`
has no such value, so the mirror it keeps says `review`.

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
`coverOnly` tells such a link from the rest. Its LINK row says **THE
COMIC'S ENTRY · COVER AND DETAILS ONLY, NEVER TRACKED**. **Tracking must
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
- **A series already linked, or settled:** NONE OF THESE, or an UNLINK.

**Resolving** a MAL link from Mihon learns its AniList entry and cover. It
sends only ids, fifty to a request (`Media(idMal_in: …)`), and needs no
key.

### An import never undoes the owner

- An UNLINK is remembered (`link_decisions`, `unlinked`), and an import won't
  bring the tracker's link back.
- A link the owner chose (review, pasted) is never replaced by a tracker.
- A tracker that moved to another MAL entry moves a link it made itself.

## The pass

`refreshLinks` runs before the covers are made:

- in the background after every import (START SCAN, and the sync timer's);
- in `yarn run covers`, unless `--local`;
- by hand, with `yarn run links`.

It resolves waiting MAL links, then searches up to 60 series (all of them by
hand; `--limit` caps it, and `--again` first searches again every series a
pass searched and couldn't link, with titles cleaned as they are now). A SEARCH AGAIN goes first, then series with no
cover. Five titles go to a request, as aliased `Page` queries.

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

## Covers

A link's cover is a new source in the chain ([`COVERS.md`](COVERS.md)):

1. a page chosen by hand;
2. a folded book's edition, or a series of books' first book;
3. a cover the files carry;
4. Mihon's cover URL;
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
  Hidden series are never searched, so reveal doesn't change it.
- It's gone at zero.
- Offline, it keeps the last count, says **THE REVIEW NEEDS THE WORKSTATION**,
  and dims its REVIEW cell.

### The review, `/links` (Link Review 1b–1j)

One series at a time: the series above its candidates, or beside them on
desktop and in tablet landscape.

- **Nothing is preselected.** Tap a candidate, and LINK A makes it.
- Each candidate shows:
  - its ids and OPEN ↗;
  - its cover, titles, and a line saying why it might be the one (`whyLine`);
  - FORMAT, YEAR, CHAPTERS and STATUS, drawn strong where they agree with the
    series (`candidateRows`); FORMAT, SEASON, EPISODES and STATUS for an anime;
  - **EXACT TITLE**, beside its ids, when one of its titles equals one of the
    series'. That is a mark, not a choice: LINK is still the owner's press.
- **NONE OF THESE** is remembered. **SKIP** sends it to the back.
  **PASTE A LINK** reads the link as one candidate, sending only its id.
- **SEARCH AGAIN asks AniList at once** with the edited title, in the series'
  own catalogue and kind. **It never links: the results replace these and wait
  for LINK**, even when there is exactly one, or one with the same title. With
  AniList out of reach, the search waits for the next pass instead, and the
  band says so. FIND on a series never searched searches as the review opens.
- The band, the panel's count and the rows show one search: the band counts
  what AniList returned, the count what was kept for the review, and the rows
  are exactly the kept candidates (`4 OF 6 FOUND`). A series searched before
  the catalogue asked for its own kind keeps what that search stored — for an
  anime, the manga entries it found — until SEARCH AGAIN replaces them: they
  are still offered, a tap still links one (flagged **WRONG KIND**, never
  removed), and only the owner's press decides.
- Every decision is carried out at once. UNDO takes back LINK (and a rating it
  gave), NONE OF THESE and SEARCH AGAIN. A search's UNDO puts back the search
  and the candidates it replaced; it never made a link, so it takes none back.
  SKIP has no UNDO, as in the mock.
- `?series=N` is one series only: FIND or CHANGE on its screen. It has no
  SKIP, and deciding goes back to the series. For a hidden series it's
  PASTE A LINK only.

### The series screen (Series Link 1k–1t)

**LINK** and **COVER** rows under SHELVES, on every series but a doujin. An
anime's LINK row is a line a season (c240; above).

- **Linked:** the entry's title, its ids and where the link came from, then
  OPEN ↗, CHANGE and UNLINK.
- **An anime trades one link for one a season** (c240, the owner's decision
  A): AniList and MAL list each season as its own entry while a tsundoku
  series holds several, so an anime's LINK row is a line a season -- tag,
  title, `ANILIST AND MAL · TV · 24 EP. · 2018`, and EDIT or FIND. Three
  seasons or fewer have a line each; more fold round the one being watched,
  and SHOW opens both the LINK and the TRACKING row. A season in two parts
  says so on one line (`2 PARTS · EP. 1 – 12 · EP. 13 – 23`). A series with
  one season draws exactly what it always did. Ranobe stays one line under
  the seasons ([`RANOBE.md`](RANOBE.md)).
- **A season's link is its own row** (`series_season_links`, rung 62):
  `series_links` keeps meaning what it meant for a manga or a novel, and an
  anime's row there is a **mirror of its first season, written only while that
  season is linked** (season 1, or a flat list). With only a later season
  linked there is no row at all: the one reader that asks a series for a
  single MAL entry (AniSkip) numbers an episode within its entry and refuses a
  later season, so an empty row is its honest "not looked up". Tracking never
  reads it for an anime. A link an anime had before rung 62 is read as its
  first season's; nothing was migrated, since no anime was linked then.
- **A season's FIND** opens the review with `?series=N&season=S`: the search
  is that season's own title (`Sword Art Online Season 3`, the source's
  season number after the series' title), asked in the anime formats, and
  each candidate is set against that season's own episode count. LINK A TO
  SEASON 3 writes that season's row. After it, the page offers the rest of
  the show from the linked entry's AniList PREQUEL and SEQUEL relations, in
  order along the chain and ticked where the episode counts agree -- or
  where two entries add up to the season as `PART 1` and `PART 2`. A movie
  or a special standing on that chain is listed dimmed and never ticked; a
  side story or a spin-off is not collected at all, because the walk follows
  PREQUEL and SEQUEL edges only. A season already linked says `REPLACES …`
  and is not ticked either. LINK N SEASONS writes them all
  (`via 'relations'`), and NOT NOW leaves them.
- **Not linked:** what the last pass found, then FIND (accent) and PASTE A
  LINK.
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
  changes ask AniList for the series' own kind, and its CHANGE is the door.
  OPEN ↗ opens the entry's own catalogue: the link's stored format decides,
  and the series' kind is only the fallback when it isn't known yet, so a
  manga's entry on an anime series opens `/manga/<its id>`, never a different
  work on `/anime/<its id>` — on the series screen's LINK row and on each
  catalogue's row in the TRACKING sheet behind EDIT. The owner may have wanted
  the link, and UNDO still takes it back; nothing is unlinked silently. A
  novel across to its comic's entry is the deliberate cover-only link, and
  isn't this.
- On the phone, and in the 440px landscape panel, the cells drop below the
  row in equal columns. An anime's season lines keep their own EDIT or FIND
  at the line's end, as the design draws them.
- Offline, everything but OPEN ↗ dims.

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
- **Tablet landscape** takes the desktop layout (1j). The mock drew only
  tablet portrait, phone and desktop.

## Not yet

- **Tracking** (Series Link's TRACKING row and sheet, 1k–1q; the settings
  sign-ins, 1u–1v): signing in to AniList (a year-long token, no refresh) and
  MAL (plain PKCE, 31-day tokens that refresh), reading the owner's AniList
  list as a source of links, and sending progress forward from the reading
  log. The owner registers both apps first, with the redirect on
  `https://workstation.example.ts.net:8443`.
- **A score from a review or pasted link** fills nothing. The score comes from
  the owner's list, which needs the sign-in. Only Mihon's MAL score fills a
  rating today.
- **The settings' CATALOGUES section** comes with the sign-ins.
- **MAL's status, score and chapter** from Mihon's backup aren't kept yet,
  only the score, for the fill.
