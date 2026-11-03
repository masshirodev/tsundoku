# Kinds: one registry, before movies and TV

What a kind of series is (manga, manhwa, doujin, novel, anime, and next
movies and TV shows) and where the code learns what each kind can do. This is
a refactor plan with an audit behind it. The cards are on the Tsundoku board
under the **Kinds** label (the table at the end).

**Status: K1 built, 2026-11-03** (card c301, branch `agent/k14-kinds` from
`c14a5d4e`): the registry, one list of kinds, the database CHECK test and the
ratchet that holds the count. K2–K5 below are not built. The rule at the end
("No new kind checks") applies from here on.

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

**At `e176cbe` the list of kinds was written in five places, and they didn't
agree:**

- `Kind` and `KINDS` in `src/lib/library/types.ts`
- `FILTER_KINDS` in `src/lib/library/filters.ts`
- `MoveKind = 'manga' | 'anime'` in `src/lib/library/move.ts`
- an inline `'manga' | 'anime' | 'novel'` in `src/lib/library/start.ts`
- the database's `CHECK (kind IN (…))` on `series`, which rung 47 had to
  rewrite by string replacement to add `anime` (and `engine_extensions.kind`'s
  `CHECK (kind IN ('manga', 'anime'))` at `db.ts:813`, the two APK extension
  families' kinds — not MOVE's: MOVE has no table of its own)

Two more lists were found while K1 measured this, and the audit above missed
both: `RANOBE_KINDS` in `src/lib/library/ranobe.ts:14` (`['novel', 'manga',
'manhwa']`, the kinds Ranobe tracks, not all kinds) and `KIND_LABEL` in
`src/lib/library/filters.ts:52`, which is labels rather than kinds and says
`DOUJINS` and `NOVELS` where `kindLabel` says `DOUJIN` and `NOVEL`.

**The audit is still not exhaustive, and the ratchet cannot make it so.**
Three more kind lists are array or SQL literals rather than comparisons, so
`tests/kinds.spec.ts` does not count them: `KIND_SHELVES`
(`src/lib/server/library.ts:942`) gives manga, manhwa, novel and anime a shelf
and deliberately gives a doujin none (its books group by other means);
`overrideCounts`'s `['manga', 'manhwa', 'doujin', 'novel'] as Kind[]`
(`src/lib/server/settings-page.ts:92`) is every kind but an anime, whose
reading direction has no per-series override; and `LINKABLE`
(`src/lib/server/catalogue.ts:547`) is every kind but a doujin, which is never
in the LINK queue. Each is deliberate at `c14a5d4e`. But a `movie`/`show`
that lands without a shelf, an override row or a place in the LINK queue is
exactly the bug this doc exists to prevent, so **a new kind must grep these
three by hand**; K5 should fold them into the registry, and this paragraph is
where the next worker will look if it does not.

**What K1 did with them.** `Kind`, `KINDS`, `FILTER_KINDS`, `MoveKind` and
`start.ts`'s inline union are now one list, derived from `KIND_FACTS` (below).
The database's CHECK is unchanged and now has a spec asserting it equals
`KINDS`. `RANOBE_KINDS` and `KIND_LABEL` are neither derived nor changed:
`ranobe.ts` was not K1's to edit, and `filters.ts`'s kind list was the only
thing K1 touched there. Both are K2's or K5's (see "The disagreements I
kept").

## The registry

`src/lib/library/kinds.ts`, pure, one entry per kind. **K1 shipped it**, and
this is the shape as built:

```ts
export type Kind = 'manga' | 'manhwa' | 'doujin' | 'novel' | 'anime';
export type Medium = 'pages' | 'text' | 'video';
export type SourceFamily = 'mihon' | 'lnreader' | 'aniyomi';

export type KindFacts = {
	kind: Kind;
	medium: Medium;
	/** What one entry is called: CH, VOL, EP; and READ or WATCHED. */
	unit: { short: string; long: string; done: string };
	/** Where its metadata and its link come from. */
	catalogue:
		| { provider: 'anilist'; type: 'MANGA' | 'ANIME' }
		| { provider: 'tmdb'; type: 'movie' | 'tv' };
	/** Kinds it may be linked or matched against (an anime never to a manga). */
	matches: readonly Kind[];
	/** The extension families that may feed it. */
	sources: readonly SourceFamily[];
	/** Where its files live: tsundoku's library root, or Jellyfin's folders. */
	storage: 'library' | 'jellyfin';
	/** The default the reader or player starts from. */
	layout?: 'paged' | 'vertical' | 'rtl' | 'ltr';
	/** Whether MOVE between sources is offered. */
	movable: boolean;
};

export const KIND_FACTS = { /* … */ } as const satisfies Readonly<Record<Kind, KindFacts>>;
export const kindFacts = <K extends Kind>(kind: K) => KIND_FACTS[kind];
export const KINDS = Object.keys(KIND_FACTS) as Kind[];

/** MOVE is offered for these, and each says how its map reads it. */
export type MovableKind = …;
export const MOVABLE_KINDS = KINDS.filter((k): k is MovableKind => KIND_FACTS[k].movable);
export const MOVE_MAP = { manga: 'manga', manhwa: 'manga', anime: 'anime' } as const;
export type MoveKind = (typeof MOVE_MAP)[MovableKind]; // 'manga' | 'anime'

/** The kind each source family names a row by. */
export const SOURCE_KINDS = { mihon: 'manga', lnreader: 'novel', aniyomi: 'anime' } as const;
export type SourceKind = (typeof SOURCE_KINDS)[SourceFamily];

/** The AniList type a kind is asked for; throws for a kind AniList does not hold. */
export function anilistType(kind: Kind): 'MANGA' | 'ANIME';
```

`as const` is what keeps each entry's literals, so `MovableKind`, `MoveKind`
and `SourceKind` are derived at the type level instead of restated. `Kind` is
defined here and **re-exported** from `types.ts` (`export type { Kind }`, and
`KINDS` too): `KIND_FACTS` is keyed by `Kind`, so defining it in `types.ts` and
importing it here would be a type cycle. Every `import type { Kind }` in the
tree still works.

What each fact says today, and the lines it was read from:

| Kind     | Medium | Unit | Catalogue       | Matches               | Sources  | Layout   | Movable |
| -------- | ------ | ---- | --------------- | --------------------- | -------- | -------- | ------- |
| `manga`  | pages  | CH   | AniList `MANGA` | manga, manhwa, doujin | mihon    | rtl      | yes     |
| `manhwa` | pages  | CH   | AniList `MANGA` | manga, manhwa, doujin | mihon    | vertical | yes     |
| `doujin` | pages  | CH   | AniList `MANGA` | manga, manhwa, doujin | —        | rtl      | no      |
| `novel`  | text   | VOL  | AniList `MANGA` | novel                 | lnreader | paged    | no      |
| `anime`  | video  | EP   | AniList `ANIME` | anime                 | aniyomi  | rtl      | yes     |

- **Medium** decides the reader or the player and how progress is said
  (`library/series.ts`, `library/anime.ts`).
- **Unit**: `labels.ts`'s `unitLabel` reads `unit.short` for CH/VOL/EP and
  `sheetMeta` reads `unit.done` for READ/WATCHED. `unit.long` is the singular
  spelling (`CHAPTER`, `VOLUME`, `EPISODE`) that K2/K3 will use where the code
  spells a unit out; nothing reads it yet.
- **Catalogue** is the AniList type: `server/catalogue.ts` asks
  `anilistType(kind)` in the lookup by id and in the search, and
  `library/catalogue.ts` builds the entry's URL and reads a pasted link on the
  same word. The formats (`MANGA`/`ONE_SHOT`, `NOVEL`, an anime's six) stay in
  `formatsOf`: they are one country's format list, not a kind.
- **Matches** is what `sameKind` allows, which is what `wrongKind` is the
  complement of. Manga, manhwa and a doujin are one comic family to AniList; a
  novel is another work from its comic; an anime is another work again.
  `coverOnly` is **not** `matches` and keeps its own rule: a novel may be
  linked to its comic's entry as a cover, and never tracked through it.
- **Sources** is read from `origin_key`: `mihon:<source>:<url>`,
  `lnreader:<plugin>:<path>` (`ln:`), `aniyomi:<source>:<url>`
  (`library/downloads.ts:47-86`). A doujin is Hentoid's, so it has none.
  `SOURCE_KINDS` is the same fact the other way round, and is what
  `FirstReadSource.kind` is now.
- **Storage** is `library` for all five; `jellyfin` is the movies card's.
- **Layout** is `defaultDirection`'s default (`library/series.ts:89-93`), which
  still decides it — K2 makes it read the registry. An anime's row is `rtl`
  because `directionOptions` treats every non-novel the same way; the player
  ignores direction, but a Work's face and the reader's mode do not.
- **Movable** is `movableKind` (`src/lib/server/move.ts:56-57`): a manga, a
  manhwa or an anime. `MOVE_MAP` keeps MOVE's own kind at `manga` and `anime`,
  because a manhwa is planned as a manga (`src/lib/server/move.ts:268`).

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
  doujin's single book, manhwa's strip) may name the kind from inside the
  module that owns that peculiarity, with a comment saying why — but it sits
  inside the ratchet's baseline of 152 like any other check. The allow-list is
  `src/lib/library/kinds.ts` alone, so "what the allow-list alone leaves" is
  zero: K2–K5 lower the number by moving each such question into a fact.

### The disagreements I kept (K1 changes no behaviour)

Each is real in the code at `c14a5d4e`; the registry records what ships, and
none of these was "fixed" here.

- **A manhwa moves, but not as its own map.** `movableKind` offers MOVE to a
  manhwa (`src/lib/server/move.ts:56-57`) and the plan is built as a `manga`
  (`:268`). So `MOVABLE_KINDS` is three and `MoveKind` is two; the card's own
  premise ("`MoveKind` is the truth" for `movable`) was measured false.
- **A novel's unit is a volume in `labels.ts` and a chapter in the review.**
  `unitLabel(novel)` is `VOL` and `sheetMeta` says `12 VOL`, while
  `catalogue.ts`'s `whyLine` and `candidateRows` still say `CHAPTERS CLOSE` /
  `CHAPTERS` for a novel. `unit.long` is `VOLUME`; nothing reads it yet, so
  the review's words are unchanged until K2/K3.
- **The FILTER panel's words for two kinds are plurals.** `KIND_LABEL`
  (`filters.ts:52`) says `DOUJINS` and `NOVELS`, `kindLabel` says `DOUJIN` and
  `NOVEL`. It is a list of labels, not of kinds; K1 left it as it was.
- **`RANOBE_KINDS` is a list of its own.** `['novel', 'manga', 'manhwa']` in
  `ranobe.ts:14`, and `byWork(kind)` is its own `kind !== 'novel'`. Not
  derived, not edited: `ranobe.ts` is not K1's.
- **The engine's extension kinds are the APK families'.** `engine_extensions`
  has `CHECK (kind IN ('manga', 'anime'))` (`db.ts:813`) — the two families an
  APK extension can be, not the movable kinds (three) and not MOVE's map
  (also two, for another reason). The DB spec asserts it against
  `SOURCE_KINDS.mihon` and `SOURCE_KINDS.aniyomi`, and the card's "move table"
  does not exist: MOVE has no table.
- **Three kind lists are not comparisons.** `KIND_SHELVES`, `overrideCounts`'
  four-kind list and `LINKABLE` (the audit names the files) each decide by kind
  in an array or SQL literal, so the ratchet cannot count them; K1 left them
  as they were. A new kind must grep them by hand until K5 folds them in.
- **`layout` is stated twice.** `defaultDirection` still decides it; the fact
  records the same default so a reader can ask. K2 removes the duplication.
- **`medium`, `sources`, `storage` and `unit.long` have no reader in K1.**
  They are the facts K2-K5 read; K1 proves the shape with `unit.short`,
  `unit.done`, `catalogue.type` and `matches`.

## No new kind checks

`tests/kinds.spec.ts` scans `src/` and holds a **baseline count that may only
go down**. What it counts: one line in any `src/**/*.ts` or `src/**/*.svelte`
where a `kind` -- a series', a source's, a candidate's -- is compared against
one of `KINDS`' own names, either way round:

```
s.kind === 'anime'      kind !== 'novel'      'manga' === row.kind
```

It is a textual scan, and the same one this command prints, so a mention in a
comment counts and a line holding two comparisons counts once:

```sh
rg -n --glob 'src/**/*.{ts,svelte}' --glob '!src/lib/library/kinds.ts' \
  -e "kind\s*[!=]==?\s*['\"](manga|manhwa|doujin|novel|anime)['\"]" \
  -e "['\"](manga|manhwa|doujin|novel|anime)['\"]\s*[!=]==?\s*[A-Za-z_$][\w$.]*kind\b" \
  src | wc -l
```

At `c14a5d4e`, before K1, that prints **158**. After K1 it prints **152**: the
six lines it removed are `mediaTypeOf`'s type choice, `unitLabel`'s and
`sheetMeta`'s, and the AniList and MAL URL paths and the paste path. The
spec's `BASELINE` is 152, and it skips the same one file this command does.
The number is smaller than the audit's rough ~340 because this counts only a
`kind` compared against a kind name: not the `isAnime…`-style helpers, not a
download's or a device's `kind`, and not a comparison between two variables.

**Allow-listed: `src/lib/library/kinds.ts` alone**, because that is where a
kind may be named -- `matches`, `MOVE_MAP` and `SOURCE_KINDS` are the rules.
The modules that own a kind's own peculiarity are **counted, not excused**:
`library/series.ts` (a doujin's books, manhwa's strip, a novel's volumes),
`library/labels.ts` (a doujin's single book line, an anime's episode line),
`library/catalogue.ts` (the cover-only crossing, an entry's path, the review's
words), `server/catalogue.ts` (the per-kind format lists),
`read/[entry]/ImageReader.svelte` (manhwa's vertical strip), `move.ts` and
`server/move.ts` (anime's seasons). They are what K2-K5 lower, by asking the
registry instead.

How to lower it: delete or replace a check, then lower `BASELINE` by exactly
the count. **Never raise it without a card** saying which check and why. The
spec's failure message prints every counted line with its file and number, so
a merge that changes the count is a one-line conversation rather than a
mystery. When K5 lands, the baseline is what the allow-list alone leaves.

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

| Slice | Card | What                                                                                                                                                                                     |
| ----- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1    | c301 | **done, 2026-11-03** — the registry, one list of kinds, the DB CHECK test, the no-new-checks ratchet (152); labels' CH/VOL/EP and READ/WATCHED and both catalogues' AniList type read it |
| K2    | c302 | the series screen, library cards, labels, readers and the player ask the registry                                                                                                        |
| K3    | c303 | downloads, sources, browse, extensions and covers ask the registry                                                                                                                       |
| K4    | c304 | MOVE asks the registry (`movable`), both halves                                                                                                                                          |
| K5    | c305 | the rest (settings, filters, home, layout, history, people) and the ratchet down to the allow-list                                                                                       |

K1 shipped `src/lib/library/kinds.ts`; `Kind`, `KINDS`, `FILTER_KINDS`,
`FilterKind`, `MoveKind` and `start.ts`'s source-kind union derived from it;
`tests/kinds.spec.ts` (the registry's invariants, the behaviour each first
user reads, and the ratchet) and `tests/kinds-db.spec.ts` (a fresh database at
the top rung, its `series.kind` CHECK parsed from `sqlite_master`); and no
rung: the CHECK rung 47 widened is the one the spec reads.
