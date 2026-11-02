# Kinds: one registry, before movies and TV

What a kind of series is (manga, manhwa, doujin, novel, anime, and next
movies and TV shows) and where the code learns what each kind can do. This is
a refactor plan with an audit behind it. The cards are on the Tsundoku board
under the **Kinds** label (the table at the end).

**Status: planned, 2026-11-02.** Nothing below is built yet. The rule at the
end ("No new kind checks") applies from the first slice on.

## Why

tsundoku started as a manga library. Novels came next, then anime (rung 47,
c153), and movies and TV shows are being considered (c295). Each kind was
added by teaching the places that broke about it, one `kind === 'anime'` at a
time. Nothing says, in one place, what a kind is or what it can do. So any
place nobody remembered stays manga-shaped, and that only shows up as a bug.
2026-11-02 alone turned up three:

- **The AniList catalogue only asks for `MANGA`** (`src/lib/server/catalogue.ts`,
  `type: MANGA` in the search and the lookup by id; `tracking.ts` reads the
  manga list only). No anime can be linked to its own entry, Ranma ½ (2024)
  got linked to the manga, and AniSkip got a manga's MAL id (c298).
- **The link review describes an anime as a manga.** It shows CHAPTERS where
  it should show EPISODES, and says the cover came from Mihon for an Aniyomi
  series (c298).
- **Linking's kind rule knows only novel against comic** (`doc/LINKS.md`, "A
  novel never matches a comic"). Anime against manga was never written down,
  so it was never enforced.

The owner asked (2026-11-02) whether tsundoku is becoming "tape on top of
tape". The answer here: **the machinery is shared and sound, but what each
kind can do is scattered.** Sources go through one engine, origin keys look
alike, the player and the readers are separate for good reasons, and Works
groups across kinds. What's missing is one table of facts per kind. That calls
for a registry and a staged migration, not a rewrite.

## The audit (main at `e176cbe`, 2026-11-02)

A rough count first. A grep for comparisons against kind names, plus
`isAnime…`/`isNovel…` helpers, outside the specs, finds **about 340 matches
in about 85 files**. Some of those are other discriminants that happen to be
called `kind` (a download's state, a device, a reading event), so the true
count of kind checks is lower, around 300. The places with the most:

| File                                         | Matches | What it decides by kind                                  |
| -------------------------------------------- | ------: | -------------------------------------------------------- |
| `src/lib/server/move.ts`                     |      28 | how a series moves between sources (manga or anime only) |
| `src/lib/library/move.ts`                    |      23 | the same, its pure half                                  |
| `src/lib/server/downloads.ts`                |      16 | which downloader takes a series (novel, anime, comic)    |
| `src/lib/library/series.ts`                  |      12 | reading direction, progress text, entry labels, volumes  |
| `src/routes/series/[id]/SeriesPanel.svelte`  |      11 | which rows the series screen shows                       |
| `src/routes/series/[id]/+page.server.ts`     |      10 | what the series screen loads                             |
| `src/lib/server/books.ts`                    |       9 | novels' EPUB handling                                    |
| `src/lib/library/downloads.ts`               |       9 | a key's kind from its prefix (`ln:`, `aniyomi:`)         |
| `src/routes/browse/extensions/…`             |      18 | which extensions list under which kind                   |
| `src/lib/server/engine/browse.ts`            |       8 | anime or comic browse through the engine                 |
| `src/routes/read/[entry]/ImageReader.svelte` |       7 | manhwa's vertical strip, doujin's single book            |
| `src/lib/library/catalogue.ts`               |       7 | which candidates may link (novel against comic only)     |

The same checks fall under a small number of questions, and those questions
are what the registry should answer:

1. **Medium.** Is it pages, text or video? This decides the reader or the
   player, how progress is shown (page, %, time), and READ against WATCHED.
2. **Unit.** Chapter, volume or episode: `CH`/`VOL`/`EP` in `labels.ts`,
   CHAPTERS against EPISODES on the series and link screens.
3. **Catalogue and tracking.** AniList `MANGA` or `ANIME` (and TMDB for
   movies and TV), which MAL endpoint, which tracker list.
4. **Sources and downloads.** Which extension family feeds it (Mihon `mihon:`,
   LNReader `ln:`, Aniyomi `aniyomi:`), which downloader, and where its files
   go.
5. **Covers.** Is the cover from the archive's first page, the EPUB, the
   engine, or a doujin's own book?
6. **Layout defaults.** Reading direction, vertical strip, paged.
7. **Grouping.** Volumes (novels), a single-book doujin, seasons (anime,
   Works and Seasons in `doc/WORKS.md`).
8. **Move.** Which kinds can move between sources (`MoveKind = 'manga' | 'anime'`).

**The list of kinds itself is written in five places, and they don't agree:**

- `Kind` and `KINDS` in `src/lib/library/types.ts`
- `FILTER_KINDS` in `src/lib/library/filters.ts`
- `MoveKind = 'manga' | 'anime'` in `src/lib/library/move.ts`
- an inline `'manga' | 'anime' | 'novel'` in `src/lib/library/start.ts`
- the database's `CHECK (kind IN (…))` on `series` (and `'manga', 'anime'` on
  the move table), which rung 47 had to rewrite by string replacement to add
  `anime`

## The registry

`src/lib/library/kinds.ts`, pure, one entry per kind:

```ts
export type Medium = 'pages' | 'text' | 'video';

export type KindFacts = {
	kind: Kind;
	medium: Medium;
	/** What one entry is called: CH, VOL, EP; and READ or WATCHED. */
	unit: { short: string; long: string; done: string };
	/** Where its metadata and its link come from. */
	catalogue:
		{ provider: 'anilist'; type: 'MANGA' | 'ANIME' } | { provider: 'tmdb'; type: 'movie' | 'tv' };
	/** Kinds it may be linked or matched against (an anime never to a manga). */
	matches: readonly Kind[];
	/** The extension families that may feed it. */
	sources: readonly ('mihon' | 'lnreader' | 'aniyomi')[];
	/** Where its files live: tsundoku's library root, or Jellyfin's folders. */
	storage: 'library' | 'jellyfin';
	/** Defaults the reader or player starts from. */
	layout?: 'paged' | 'vertical' | 'rtl' | 'ltr';
	/** Whether MOVE between sources is offered. */
	movable: boolean;
};

export const KIND_FACTS: Readonly<Record<Kind, KindFacts>> = {/* … */};
export const kindFacts = (k: Kind) => KIND_FACTS[k];
export const KINDS = Object.keys(KIND_FACTS) as Kind[];
```

The rules that go with it:

- **Ask the question, not the name.** Write `kindFacts(s.kind).medium === 'video'`
  or `kindFacts(s.kind).unit.short`, never `s.kind === 'anime'`. A new kind
  then gets the right behaviour wherever the question already exists, and
  the compiler names every place where a new fact needs a value.
- **One list of kinds.** `KINDS`, `FILTER_KINDS`, `MoveKind` and the inline
  unions are all derived from `KIND_FACTS`. The database's CHECK stays (it's
  the last line of defence) but has a test asserting it equals `KINDS`, so a
  kind added to the registry without a rung fails the specs, not production.
- **Real differences stay real.** The image reader, the text reader and the
  player stay separate components. The registry picks which one opens; it
  doesn't merge them. A check that is about one kind's own peculiarity (a
  doujin's single book, manhwa's strip) may name the kind, from inside the
  registry or the module that owns that peculiarity, with a comment saying why.

## No new kind checks

From slice K1 on, a spec scans `src/` for comparisons against kind names
outside `kinds.ts` and the allow-listed owners. It holds a **baseline count
that may only go down**: a slice that removes checks lowers it, and a change
that adds one fails. Once K5 lands the baseline is the allow-list alone.
`AGENTS.md` gets one line pointing here.

## Movies and TV shows, once the registry exists

The owner's decisions, 2026-11-02:

- Movies and TV shows live **in tsundoku**, not in another app.
- Their files go into **Jellyfin's folders**. tsundoku downloads them **and
  plays them too**, with its own player; Jellyfin serves them as well.
- **Aniyomi-family extensions first** (whatever c295's spike finds works).
  Stremio and debrid are not in scope.
- Metadata from **TMDB**, tracking through **Trakt or Simkl** (c295 compares).

In the registry, that is two entries:

| Kind    | Medium | Unit | Catalogue  | Sources | Storage  | Movable |
| ------- | ------ | ---- | ---------- | ------- | -------- | ------- |
| `movie` | video  | —    | TMDB movie | aniyomi | jellyfin | yes     |
| `show`  | video  | EP   | TMDB tv    | aniyomi | jellyfin | yes     |

A movie is a series with one entry. Screens ask the registry for its unit (none),
so it shows no episode list and no NEXT. A show's seasons ride on Works and
Seasons (`doc/WORKS.md`) the way anime's do. The rung that adds both to the
CHECK is the first movies card's, and it comes after c295 says the sources hold.

## The slices

Each is one card under the **Kinds** label. Every slice is green on its own and
changes no behaviour except where its card says so. K1 waits for c298 (which
fixes the catalogue first, the bug the owner is waiting on), and K2–K4 wait
for K1.

| Slice | Card | What                                                                                                      |
| ----- | ---- | --------------------------------------------------------------------------------------------------------- |
| K1    | c301 | the registry, one list of kinds, the DB CHECK test, the no-new-checks ratchet; catalogue and labels first |
| K2    | c302 | the series screen, library cards, labels, readers and the player ask the registry                         |
| K3    | c303 | downloads, sources, browse, extensions and covers ask the registry                                        |
| K4    | c304 | MOVE asks the registry (`movable`), both halves                                                           |
| K5    | c305 | the rest (settings, filters, home, layout, history, people) and the ratchet down to the allow-list        |
