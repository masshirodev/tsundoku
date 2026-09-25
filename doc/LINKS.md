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

This is the first of two deliveries. It covers links and covers. Tracking
(reading and writing status, score and chapter on both catalogues) is the
second, and isn't built yet (see "Not yet").

## What the owner decided (2026-09-24)

1. **Titles of series that aren't hidden may be sent to AniList** to search.
2. **Tracking reads and writes, on both AniList and MAL**, with AniList as the
   main list.
3. **The tablet's Mihon stays untracked.** The owner tracks on the phone only.
4. **A score fills an unrated series' rating, once** (Catalogue Links 1w): when
   the link is made, 9 out of 10 becomes 4 out of 5 (halved, rounded down).
   UNDO takes it back. A rating set here is never sent back as a score.

## Where a link comes from

| Via      | How                                                                             | Sure?           |
| -------- | ------------------------------------------------------------------------------- | --------------- |
| `mihon`  | A MAL tracker (Mihon tracker 1) in any device's backup, at import               | Yes, at once    |
| `exact`  | The pass's AniList search found one entry whose title equals one of the series' | Yes, at once    |
| `review` | The owner chose a candidate in the review                                       | The owner's say |
| `pasted` | The owner pasted an AniList or MAL link                                         | The owner's say |
| `list`   | The owner's AniList list, once signed in (not yet: see "Not yet")               | —               |

Measured on 2026-09-24:

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
- Manga and manhwa count as one kind: AniList calls both MANGA, and Mihon's
  guess between them can be wrong.
- A title Mihon cut short with `...` never matches exactly. It's searched
  with the stub taken off (`searchTitle`) and goes to the review.

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
hand; `--limit` caps it). A SEARCH AGAIN goes first, then series with no
cover. Five titles go to a request, as aliased `Page` queries.

AniList asks for no more than 30 requests a minute (its degraded limit), so
calls go one at a time, 2.1 s apart, whoever asks, and a 429 waits as long
as it says. **Unreachable is not an error:** the pass stops, and the next one
carries on. `TSUNDOKU_ANILIST=off` makes every call unreachable. The e2e
server runs that way, so the suite never reaches AniList.

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
    series (`candidateRows`).
- **NONE OF THESE** is remembered. **SKIP** sends it to the back. **SEARCH
  AGAIN** queues an edited title for the next pass. **PASTE A LINK** reads
  the link as one candidate, sending only its id.
- Every decision is carried out at once. UNDO takes back LINK (and a rating it
  gave), NONE OF THESE and SEARCH AGAIN. SKIP has no UNDO, as in the mock.
- `?series=N` is one series only: FIND or CHANGE on its screen. It has no
  SKIP, and deciding goes back to the series. For a hidden series it's
  PASTE A LINK only.

### The series screen (Series Link 1k–1t)

**LINK** and **COVER** rows under SHELVES, on every series but a doujin.

- **Linked:** the entry's title, its ids and where the link came from, then
  OPEN ↗, CHANGE and UNLINK.
- **Not linked:** what the last pass found, then FIND (accent) and PASTE A
  LINK.
- **COVER** says where the cover comes from and why the sources before it
  gave nothing (`coverLines`).
- On the phone, and in the 440px landscape panel, the cells drop below the
  row in equal columns.
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
