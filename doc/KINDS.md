# Kinds: one registry, before movies and TV

What a kind of series is (manga, manhwa, doujin, novel, anime, and next
movies and TV shows) and where the code learns what each kind can do. This is
a refactor plan with an audit behind it. The cards are on the Tsundoku board
under the **Kinds** label (the table at the end).

**Status: K1 done, 2026-11-03** (card c301: built in wave 14 on
`agent/k14-kinds` from `c14a5d4e`, landed in wave 16 on `agent/k16-kinds` from
`a698f974`, where a doujin's Sources became `mihon`): the registry, one list of
kinds, the database CHECK test and the ratchet that holds the count. **K4
done, 2026-11-03** (card c304, wave 17 on `agent/k17-kinds` from `fb2bd3a7`):
MOVE's two modules ask `movable`, `medium` and `unit.long` (ratchet 152 →
121), and in wave 18 (`agent/k18-series` from `e9aa7e3a`) the move route and
the MOVED band do too (ratchet 93 → 89). **K3 done, 2026-11-03** (card c303, the same branch): downloads,
BROWSE, the extensions' tabs, the source preview, covers and books ask
`KEY_PREFIX`/`keyFamily`, `SOURCE_KINDS`, `medium` and the new `grouping`
(ratchet 121 → 93). In wave 20 the ratchet learnt to see
`kind === SOURCE_KINDS.x` (card c420, which found six such lines) and GROUP's
answers ask `grouping` (card c375): 95 by the widened command → 87. K2 and K5
below are not built. The rule at the end ("No
new kind checks") applies from here on.

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
| `src/lib/library/downloads.ts`               |       9 | a key's kind from its prefix (`lnreader:`, `aniyomi:`)   |
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
   LNReader `lnreader:`, Aniyomi `aniyomi:`), which downloader, and where its
   files go.
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
	/** The extension families whose key a series of this kind can carry. */
	sources: readonly SourceFamily[];
	/** Where its files live: tsundoku's library root, or Jellyfin's folders. */
	storage: 'library' | 'jellyfin';
	/** The default the reader or player starts from. */
	layout?: 'paged' | 'vertical' | 'rtl' | 'ltr';
	/** Whether MOVE between sources is offered. */
	movable: boolean;
	/** What GROUP binds its series into (server/books.ts): books, volumes, or nothing. Since K3. */
	grouping: 'books' | 'volumes' | null;
};

export const KIND_FACTS = { /* … */ } as const satisfies Readonly<Record<Kind, KindFacts>>;
export const kindFacts = <K extends Kind>(kind: K) => KIND_FACTS[kind];
export const KINDS: readonly Kind[] = Object.keys(KIND_FACTS) as Kind[];

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

| Kind     | Medium | Unit | Catalogue       | Matches               | Sources  | Layout   | Movable | Grouping |
| -------- | ------ | ---- | --------------- | --------------------- | -------- | -------- | ------- | -------- |
| `manga`  | pages  | CH   | AniList `MANGA` | manga, manhwa, doujin | mihon    | rtl      | yes     | —        |
| `manhwa` | pages  | CH   | AniList `MANGA` | manga, manhwa, doujin | mihon    | vertical | yes     | —        |
| `doujin` | pages  | CH   | AniList `MANGA` | manga, manhwa, doujin | mihon    | rtl      | no      | books    |
| `novel`  | text   | VOL  | AniList `MANGA` | novel                 | lnreader | paged    | no      | volumes  |
| `anime`  | video  | EP   | AniList `ANIME` | anime                 | aniyomi  | rtl      | yes     | —        |

- **Medium** decides the reader or the player and how progress is said
  (`library/series.ts`, `library/anime.ts`).
- **Unit**: `labels.ts`'s `unitLabel` reads `unit.short` for CH/VOL/EP and
  `sheetMeta` reads `unit.done` for READ/WATCHED. `unit.long` is the singular
  spelling (`CHAPTER`, `VOLUME`, `EPISODE`). MOVE reads it since K4 for its
  map kind's noun (`moveState`'s `25 EPISODES LISTED`, `moveSummary`,
  `movedDetail`, MOVE BACK's line, and since wave 18 the series screen's
  MOVED band, through `moveKindOf` so a novel's says CHAPTER as it always
  did); K2/K3 will use it where the rest of the code spells a unit out.
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
- **Sources** is the family of every `origin_key` a writer stores for the
  kind, as `parseKey`/`parseNovelKey`/`parseAnimeKey` read it:
  `mihon:<source>:<url>`, `lnreader:<plugin>:<path>`, `aniyomi:<source>:<url>`
  (`library/downloads.ts:49-83`; LNReader's _source id_ is `ln:<plugin>`, not
  a key). A doujin comes from a **Mihon gallery source**, whose series is a
  doujin and keeps its `mihon:` key (`src/lib/import/mihon-plan.ts:106,128,388`;
  `doc/IMPORT-MIHON.md`, "Gallery sources"), or from **Hentoid's folder**
  (`hentoid:<site>:<url>` or `hentoid-dir:<folder>`), which is no family yet;
  so its Sources are `mihon`. Keys that are no family are left out of every
  kind's list: Hentoid's, a downloaded folder's `mihon-dir:`, an EPUB's
  `epub:`, and a grouped series of books, which has no key. Making Hentoid a
  family is a later card's call; **K3 (wave 17) decided: not yet.** The
  prefix-to-family map is one fact since K3, `KEY_PREFIX`, and `keyFamily`
  (`library/downloads.ts`) reads a key with it, answering `null` for every key
  no family parses; the download doors treat null as its own case
  (doc/DOWNLOADING.md, "Which downloader"). `tests/kinds.spec.ts` plans one
  series per importer and checks each key's family is in its kind's Sources,
  and asks `keyFamily`/`keyKind` for every prefix a writer stores against the
  old parsers.
  `SOURCE_KINDS` is the same fact the other way round, and is what
  `FirstReadSource.kind` is now.
- **Storage** is `library` for all five; `jellyfin` is the movies card's.
  K3 read it and changed nothing by it: every current kind's files go under
  the library root, so no writer asks yet.
- **Grouping** (since K3) is what GROUP binds a kind's series into
  (`src/lib/server/books.ts`): `books` for a doujin (single books into a
  series of books, which also fold editions and give the series its first
  book's cover in `covers.ts`), `volumes` for a novel (EPUB volumes into one
  novel), and nothing for the rest (Works groups across kinds). It was
  `kind === 'doujin'` and `kind === 'novel'` in `books.ts` (9) and `covers.ts`
  (2) at `fb2bd3a7`; `kindsGrouped(g)` gives the BOOKS screen's SQL its list.
- **Layout** is `defaultDirection`'s default (`library/series.ts:89-93`), which
  still decides it — K2 makes it read the registry. An anime's row is `rtl`
  because `directionOptions` treats every non-novel the same way; the player
  ignores direction, but a Work's face and the reader's mode do not.
- **Movable** decides whether MOVE is offered: a manga, a manhwa or an anime.
  It was `movableKind`'s list of names at `c14a5d4e`
  (`src/lib/server/move.ts:56-57`); since K4 `movableKind` is `isMovable`,
  which reads this fact. `MOVE_MAP` keeps MOVE's own kind at `manga` and
  `anime`, because a manhwa is planned as a manga, and `moveKindOf(kind)` reads
  the map kind from the medium (video maps as `anime`, anything else as
  `manga`), which equals `MOVE_MAP` on every movable kind. Inside MOVE every
  per-medium rule (episodes and seasons, the offset, positions resequenced,
  `Ep.` against `Ch.`, WATCHING against READING) asks `movesVideo(kind)`
  (`library/move.ts`), the map kind's medium, and which sources MOVE asks is
  the sources whose `sourceMedium` (`engine/backend.ts`) is the map kind's.

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

- **A manhwa moves, but not as its own map.** `movableKind` offered MOVE to a
  manhwa (`src/lib/server/move.ts:56-57` at `c14a5d4e`) and the plan is built
  as a `manga` (`:268` then, `moveKindOf` since K4). So `MOVABLE_KINDS` is
  three and `MoveKind` is two; the card's own premise ("`MoveKind` is the
  truth" for `movable`) was measured false.
- **A novel's unit is a volume in `labels.ts` and a chapter in the review.**
  `unitLabel(novel)` is `VOL` and `sheetMeta` says `12 VOL`, while
  `catalogue.ts`'s `whyLine` and `candidateRows` still say `CHAPTERS CLOSE` /
  `CHAPTERS` for a novel. `unit.long` is `VOLUME`; the review does not read
  it (MOVE, which does, never moves a novel), so the review's words are
  unchanged until K2/K3.
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
- **A doujin carries a family's key and does not move.** A gallery doujin's
  key is `mihon:` (its Sources are `mihon`), yet `movableKind`
  (`src/lib/server/move.ts:56-57` at `c14a5d4e`) left every doujin out, and a
  novel too, although LNReader feeds it. `movable` recorded what `movableKind`
  did, not what the key would allow, and since K4 `movableKind` reads
  `movable`. **Decided in K4 (wave 17): it stays so.** A gallery doujin with a
  `mihon:` key is not offered MOVE; `tests/kinds-db.spec.ts` ("refuses a
  gallery doujin with a mihon: key at every MOVE door") plans one through
  `planMihon`, writes it, and asks `moveState`, `moveEligible`,
  `moveComparison` and `applyMove`. Making it move is a card of its own, with
  a doc/MOVE.md change (departure 7 there).
- **A doujin's catalogue is read by the import's door, not the owner's.**
  `catalogue` says AniList `MANGA` for a doujin (`anilistType`, as
  `mediaTypeOf` did before K1), and a live path asks it: `planMihon` keeps
  Mihon's MAL tracker for a gallery source's doujin (`malLink`,
  `src/lib/import/mihon-plan.ts:414`), the import writes it as a link with
  no kind check (`src/lib/server/import/write.ts:448`, `linkFromTracker`),
  and `resolveLinks` (`src/lib/server/catalogue.ts:487-545`) reads that MAL
  id in the series' own kind's catalogue through `byIds` (`:183-193`), so the
  request says `type: MANGA`. The resolved entry then gives the series its
  cover (`linkCover`, `:970`). Only the owner-facing doors leave a doujin
  out: `LINKABLE` (`:547`) keeps it out of the LINK queue and the pass, and
  `linkState` (`:944`) gives its series screen no LINK row.
  `tests/kinds-db.spec.ts` ("a doujin's catalogue") goes through that import
  door. Separately, `candidateKind` never names a candidate `doujin`, so the
  `doujin` in a comic's `matches` is reached only by a series' own kind, which
  is the shipped `sameKind` (a doujin was in the comic family before K1 too).
- **`layout` is stated twice.** `defaultDirection` still decides it; the fact
  records the same default so a reader can ask. K2 removes the duplication.
- **`medium`, `sources`, `storage` and `unit.long` had no reader in K1.**
  They are the facts K2-K5 read; K1 proved the shape with `unit.short`,
  `unit.done`, `catalogue.type` and `matches`. K4 reads `movable`, `medium`
  (through `moveKindOf`, `movesVideo` and `sourceMedium`) and `unit.long`.

## No new kind checks

`tests/kinds.spec.ts` scans `src/` and holds a **baseline count that may only
go down**. What it counts: one line in any `src/**/*.ts` or `src/**/*.svelte`
where a `kind` -- a series', a source's, a candidate's -- is compared against
one of `KINDS`' own names, either way round:

```
s.kind === 'anime'      kind !== 'novel'      'manga' === row.kind
```

Since wave 20 (card c420) it also counts the same comparison spelled through
a family's kind, either way round, dotted or bracketed:

```
s.kind === SOURCE_KINDS.lnreader      SOURCE_KINDS[f] === r.kind
```

K3 had replaced six quoted names with that spelling, which the old pattern no
longer saw. A source's family is now asked as a family: `BrowseSource.family`
(`engine/browse.ts`, LNReader's in `novels/source.ts`) and `familyOfKind`
(`engine/repo-index.ts`), the one decoder from a stored kind
(`engine_extensions.kind`, an APK listing's) back to its family. A question
asked through it (`familyOfKind(l.kind) === 'mihon'`) names a family, and is
not counted.

It is a textual scan, and the same one this command prints, so a mention in a
comment counts and a line holding two comparisons counts once:

```sh
rg -n --glob '*.ts' --glob '*.svelte' --glob '!src/lib/library/kinds.ts' \
  -e "\bkind\s*[!=]==?\s*(['\"](manga|manhwa|doujin|novel|anime)['\"]|SOURCE_KINDS\b)" \
  -e "(['\"](manga|manhwa|doujin|novel|anime)['\"]|SOURCE_KINDS(\.\w+|\[[^\]]*\]))\s*[!=]==?\s*[A-Za-z_\$][\w\$.]*kind\b" \
  src | wc -l
```

Until wave 20 the command had only the quoted names (the first half of each
pattern); the counts below up to 89 are by that command.

At `c14a5d4e`, before K1, that prints **158**. After K1 it prints **152**: the
six lines it removed are `mediaTypeOf`'s type choice, `unitLabel`'s and
`sheetMeta`'s, and the AniList and MAL URL paths and the paste path. The
spec's `BASELINE` was 152, and it skips the same one file this command does.
After K4 (wave 17) it prints **121**: the 31 lines it removed are every
comparison left in `src/lib/server/move.ts` (27) and `src/lib/library/move.ts`
(4). After K3 (the same wave) it prints **93**: 28 more, from
`server/books.ts` (9), `server/covers.ts` (4), the extensions page (4 + 2),
`engine/browse.ts` (3), the source preview (3), `engine/backend.ts` (1) and
BROWSE's source page and its settings (1 + 1). After K4's last part (wave 18) it prints **89**: the move route's three (`src/routes/series/[id]/move/`:
SEARCH's source word, the comparison's kind and PASTE A LINK's source) and
the series screen's MOVED band, now `moveKindOf`, `movesVideo`,
`sourceMedium` and `kindFacts(moveKindOf(kind)).unit.long`
(`series/[id]/move-words.ts`, `move/paste.server.ts`). In wave 20 (cards
c420 and c375, `agent/k20-browse` from `d5c4bf6f`) the widened command
prints **95** at `d5c4bf6f` (89 and the six `SOURCE_KINDS` lines: BROWSE's
source page and its settings, the extensions page's two APK counts,
`engine/browse.ts`'s family lists and `engine/backend.ts`'s `sourceFamily`),
and **87** after them: those six ask the family, and GROUP's two answers in
`library/books.ts` (`groupAnswers`) ask `grouping`. `BASELINE` follows
the latest slice; the handoff notes (`doc/handoff-notes/kinds.md`) record each one's number.
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
`read/[entry]/ImageReader.svelte` (manhwa's vertical strip). They are what
K2-K5 lower, by asking the registry instead. `move.ts` and `server/move.ts`
(anime's seasons) were on this list and count none since K4: their seasons are
a question about video, asked as `movesVideo`.

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

| Slice | Card | What                                                                                                                                                                                                                                                                                                |
| ----- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1    | c301 | **done, 2026-11-03** — the registry, one list of kinds, the DB CHECK test, the no-new-checks ratchet (152); labels' CH/VOL/EP and READ/WATCHED and both catalogues' AniList type read it                                                                                                            |
| K2    | c302 | the series screen, library cards, labels, readers and the player ask the registry (the move route and the MOVED band are K4's, done in wave 18)                                                                                                                                                     |
| K3    | c303 | **done, 2026-11-03** — downloads pick a downloader by the key's family (`KEY_PREFIX`, `keyFamily`; no family is its own case), BROWSE and the extensions' tabs by source family (`SOURCE_KINDS`), the preview by `medium`, covers by `medium` and `grouping`, books by `grouping`; ratchet 121 → 93 |
| K4    | c304 | **done, 2026-11-03** — MOVE asks the registry, both modules: `movable` (`isMovable`), the map kind by `medium` (`moveKindOf`, `movesVideo`), the sources by `sourceMedium`, nouns by `unit.long`; ratchet 152 → 121; the move route's three checks and the MOVED band in wave 18, 93 → 89           |
| K5    | c305 | the rest (settings, filters, home, layout, history, people) and the ratchet down to the allow-list                                                                                                                                                                                                  |

K1 shipped `src/lib/library/kinds.ts`; `Kind`, `KINDS`, `FILTER_KINDS`,
`FilterKind`, `MoveKind` and `start.ts`'s source-kind union derived from it;
`tests/kinds.spec.ts` (the registry's invariants, the behaviour each first
user reads, each importer's key against `sources`, `layout` against
`defaultDirection`, and the ratchet) and `tests/kinds-db.spec.ts` (a fresh
database at the top rung, its `series.kind` CHECK parsed from `sqlite_master`,
and `movable` against the server's `movableKind`); and no rung: the CHECK
rung 47 widened is the one the spec reads.
