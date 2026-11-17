# Kinds

A kind is what a series is: `manga`, `manhwa`, `doujin`, `novel`, `anime`,
`movie` (a film) or `show` (a TV series from TMDB's catalogue, live action
included). What each kind can do is stated once, in one registry,
`src/lib/library/kinds.ts`, and the rest of the code asks it:
`kindFacts(kind).medium`, `.unit`, `.catalogue`, `.matches` and the facts
below, never `kind === 'anime'`.

The reason is that a kind touches many places: the reader or the player, the
words for an entry, the catalogue a series is linked in, the downloader, the
covers, GROUP and MOVE all decide something by kind. When each of them names
kinds itself, a new kind has to be taught to every one of them, and a place
nobody remembers stays manga-shaped until it shows up as a bug (an anime
searched in AniList's `MANGA` catalogue and linked to the manga, an anime's
link review saying CHAPTERS, an anime allowed to match a manga). With one
registry, a new kind gets the right behaviour wherever the question is
already asked, and the compiler names every place that needs a new fact.

The machinery around the kinds is shared on purpose: sources go through one
extension engine, origin keys share one shape, and Works group series across
kinds ([`WORKS.md`](WORKS.md)). The image reader, the text reader and the
video player stay separate components; the registry picks which one opens.

## The kinds

| Kind     | Medium | Unit | Catalogue       | Matches               | Sources  | Layout   | Movable | Grouping | Storage           |
| -------- | ------ | ---- | --------------- | --------------------- | -------- | -------- | ------- | -------- | ----------------- |
| `manga`  | pages  | CH   | AniList `MANGA` | manga, manhwa, doujin | mihon    | rtl      | yes     | —        | —                 |
| `manhwa` | pages  | CH   | AniList `MANGA` | manga, manhwa, doujin | mihon    | vertical | yes     | —        | —                 |
| `doujin` | pages  | CH   | AniList `MANGA` | manga, manhwa, doujin | mihon    | rtl      | no      | books    | —                 |
| `novel`  | text   | VOL  | AniList `MANGA` | novel                 | lnreader | paged    | no      | volumes  | —                 |
| `anime`  | video  | EP   | AniList `ANIME` | anime                 | aniyomi  | rtl      | yes     | —        | `Anime/`, seasons |
| `movie`  | video  | —    | TMDB `movie`    | movie                 | aniyomi  | —        | yes     | —        | `Movies/`, film   |
| `show`   | video  | EP   | TMDB `tv`       | show                  | aniyomi  | —        | yes     | —        | `Shows/`, seasons |

Films and shows have their own document, [`FILMS-SHOWS.md`](FILMS-SHOWS.md):
how they are stored, imported, linked to TMDB and to each other, and played.

## The facts

`KindFacts` in `kinds.ts`, one entry per kind in `KIND_FACTS`:

- **`medium`**: `pages`, `text` or `video`. It decides the reader or the
  player and how progress is said (page, %, time), and READ against WATCHED.
  MOVE reads it for its map kind (`moveKindOf`), downloads and covers for
  which path to take, and SQL that filters to video asks `videoKindsSql`,
  which is built from it.
- **`unit`**: what one entry is called, `short` (`CH`, `VOL`, `EP`), `long`
  (`CHAPTER`, `VOLUME`, `EPISODE`) and `done` (`READ` or `WATCHED`).
  `unitLabel` and `sheetMeta` (`labels.ts`) read it, and MOVE reads `long` for
  its nouns (`25 EPISODES LISTED`, `moveSummary`, MOVE BACK's line, the MOVED
  band), through `moveKindOf`, so a novel's says CHAPTER. **A film has no
  unit**: it has one entry and no list. `kindUnit(kind)` answers empty words
  with `done` WATCHED for it, and a screen that concatenates a count asks
  `kindUnit` rather than deciding what absent means; `sheetMeta` then draws no
  count.
- **`catalogue`**: where the metadata and the link come from, `{ provider:
'anilist', type: 'MANGA' | 'ANIME' }` or `{ provider: 'tmdb', type: 'movie'
| 'tv' }`. `library/catalogues.ts` answers which provider a kind is and its
  URL; `server/catalogues.ts` whether this install can ask it (TMDB needs a
  key). `anilistType(kind)` throws for a kind AniList does not hold, for code
  that is AniList's by construction; `anilistTypeOf(kind)` answers null
  instead, for an entry point that is not sure. AniList's formats (`MANGA` and
  `ONE_SHOT`, `NOVEL`, an anime's six) stay in `formatsOf`
  (`server/catalogue.ts`): they are AniList's format list, not a kind.
  [`LINKS.md`](LINKS.md), "Which catalogue, and whether it can answer".
- **`matches`**: the kinds a series may be linked or matched against, which
  is what `sameKind` (`library/catalogue.ts`) allows and `wrongKind` refuses.
  Manga, manhwa and a doujin are one comic family to AniList, and Mihon's
  guess between them can be wrong. A novel is another work from its comic, an
  anime another again, and a film or a show matches only its own kind (a film
  is not the twin of the book it adapts; that relation is OTHER FORMS).
  `coverOnly` is not `matches` and keeps its own rule: a novel may take its
  comic's entry as a cover, and is never tracked through it.
- **`sources`**: the extension families whose key a series of this kind can
  carry, read from what the writers store, as `parseKey`, `parseNovelKey` and
  `parseAnimeKey` (`library/downloads.ts`) read it: `mihon:<source>:<url>`,
  `lnreader:<plugin>:<path>`, `aniyomi:<source>:<url>`. LNReader's source id
  `ln:<plugin>` is an id, not a key. Keys no family parses are in no kind's
  list (see "Keys that are no family's").
- **`layout`**: the default the reader starts from. `defaultDirection`
  (`library/series.ts`) reads it through `kindLayout`, and SETTINGS can change
  the default per kind. An anime's is `rtl` because `directionOptions` treats
  every non-novel the same way; the player ignores direction, but a Work's
  face and the reader's mode do not. A film and a show have none
  (`defaultDirection` falls back to `rtl`), and SETTINGS' N SERIES DIFFER
  (`overrideCounts`) leaves every video kind out, since there is no direction
  to override.
- **`movable`**: whether MOVE between sources is offered. `movableKind`
  (`server/move.ts`) is `isMovable`, which reads it. `MOVE_MAP` gives each
  movable kind the shape of its by-number map: a manhwa is a comic, so it is
  planned exactly as a manga is, by chapter number, and an anime, a film and a
  show map as `anime`, by episode and season. `moveKindOf(kind)` reads the same
  answer off the medium and answers every kind, not only the movable ones,
  because MOVE BACK and its candidate (`applyMoveBack`, `formerCandidate`) read
  it without asking `movable`; there a novel or a doujin reads as `manga`.
  Inside MOVE every per-medium rule (episodes and seasons, the offset,
  positions resequenced, `Ep.` against `Ch.`, WATCHING against READING) asks
  `movesVideo(kind)` (`library/move.ts`), and which sources MOVE asks are those
  whose `sourceMedium` (`engine/backend.ts`) is the map kind's. `satisfies`
  on `MOVE_MAP` makes a new movable kind say how it maps instead of falling
  through to chapters. [`MOVE.md`](MOVE.md).
- **`grouping`**: what GROUP binds this kind's series into
  (`src/lib/server/books.ts`). `books` for a doujin: single books into a
  series of books (`groupIntoSeries`), which is also what folds editions
  (`foldEditions`) and gives a series of books its first book's cover
  (`firstBookSource`, `covers.ts`). `volumes` for a novel: one EPUB volume per
  series into one novel (`groupVolumes`, and `takeOutVolumes` back). Null for
  the rest. `kindsGrouped(g)` gives the BOOKS screen's SQL its list, and
  `groupAnswers` (`library/books.ts`) offers only the answers a selection's
  kinds allow. A Work groups across kinds and is not this fact
  ([`WORKS.md`](WORKS.md)); merging seasons into one show is open to any video
  kind (`isSeasonSet`, `mergeSeasons`). [`BOOKS.md`](BOOKS.md).
- **`storage`**: where a video kind's downloads go under the one library
  root: its folder, the folder a hidden series goes to instead, and the layout
  inside, `seasons` (`<Series>/Season 01/… S01E07 ….mkv`, `tvshow.nfo`) or
  `film` (`<Title (Year)>/<Title (Year)>.mkv`, its `<movie>` NFO beside it). A
  hidden folder is never one a Jellyfin library would read, since Jellyfin has
  no reveal. Absent for a kind tsundoku never downloads as video;
  `storageOf(kind)` throws for one, and `VIDEO_STORAGE` lists every video
  kind's folders once for the importer's scan. One root on purpose: the delete
  guard, backups, the hidden folders and RESCAN all assume it.
  [`DOWNLOADS.md`](DOWNLOADS.md), "Where files go".

`as const` keeps each entry's literals, so `MovableKind`, `MoveKind` and
`SourceKind` are derived at the type level rather than restated. `Kind` is
defined in `kinds.ts`, not `types.ts`, because `KIND_FACTS` is keyed by it and
the other way round would be a type cycle; `types.ts` re-exports `Kind` and
`KINDS`, so every `import type { Kind }` works. The module is pure: nothing in
it imports `$lib/server` or touches the database.

## What the registry exports

| Export                                                          | What it answers                                                                                                                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kindFacts(kind)`                                               | one kind's facts                                                                                                                                                                              |
| `KINDS`                                                         | every kind, in the registry's order, which is `FILTER_KINDS`' and the order the FILTER panel and the library's KIND band list kinds in                                                        |
| `kindUnit(kind)`                                                | the unit's words, empty for a film                                                                                                                                                            |
| `kindLayout(kind)`                                              | the default layout, undefined for a film and a show                                                                                                                                           |
| `MOVABLE_KINDS`, `MovableKind`, `isMovable`                     | the kinds MOVE is offered for                                                                                                                                                                 |
| `MOVE_MAP`, `MoveKind`, `moveKindOf`                            | MOVE's map shape, `manga` or `anime`                                                                                                                                                          |
| `SOURCE_KINDS`, `SourceKind`                                    | each source family's default kind: Mihon `manga`, LNReader `novel`, Aniyomi `anime`                                                                                                           |
| `SOURCE_KIND_CHOICES`, `sourceKindChoices`, `defaultSourceKind` | the kinds a source of each family may serve, the default first                                                                                                                                |
| `SOURCE_FAMILIES`, `KEY_PREFIX`                                 | the families, and the prefix each family's `origin_key` starts with                                                                                                                           |
| `sourceFamilyOf(word)`                                          | the family a stored word names (the inverse of `SOURCE_KINDS`), null for a word no family stores                                                                                              |
| `kindsGrouped(g)`                                               | the kinds GROUP binds into books or volumes                                                                                                                                                   |
| `anilistType`, `anilistTypeOf`                                  | AniList's type for a kind, loud or nullable                                                                                                                                                   |
| `storageOf`, `VIDEO_STORAGE`                                    | a video kind's folders                                                                                                                                                                        |
| `videoKindsSql(alias, { episodic })`                            | `s.kind IN ('anime', 'movie', 'show')`, built from `medium`; with `episodic`, only the kinds with a unit (what an intro fingerprint is read across, which a film has nothing to compare with) |

`KINDS` is readonly because `FILTER_KINDS` is the same object and its order
matters: one in-place sort in a screen would reorder the registry.

## The rules

- **Ask the question, not the name.** Write `kindFacts(s.kind).medium ===
'video'` or `kindUnit(s.kind).short`, never `s.kind === 'anime'`.
- **One list of kinds.** `Kind`, `KINDS`, `FILTER_KINDS`, `FilterKind`,
  `MoveKind` and FIRST READ's source kind (`start.ts`) are all derived from
  `KIND_FACTS`. Lists keyed by `Kind` (the FILTER panel's `KIND_LABEL`, the
  KIND band's `KIND_WORD` in `src/routes/+page.svelte`) make a new kind's
  missing word a compile error. `LINKABLE_KINDS` (`server/catalogue.ts`) is
  `KINDS` filtered by `grouping` and `catalogue`.
- **The database checks the list too.** `series.kind` has a `CHECK (kind IN
(…))`, the last line of defence, and `tests/kinds-db.spec.ts` parses it from
  a fresh database's `sqlite_master` and asserts it equals `KINDS`. A kind
  added to the registry without a migration fails the specs, not production.
  Migration 79 widened it for `movie` and `show`.
- **Real differences stay real.** A check that is about one kind's own
  peculiarity (a doujin's single book, a manhwa's strip) is asked as a fact
  where one exists (`grouping`, `layout`), and otherwise sits in a file on the
  ratchet's allow-list with its reason (below).

## Peculiarities kept on purpose

- **A manhwa moves, but not as its own map.** It is movable, and its plan is a
  manga's. So `MOVABLE_KINDS` has five kinds and `MoveKind` two.
- **A doujin carries a family's key and does not move.** A gallery doujin's
  key is `mihon:`, so its Sources are `mihon`, yet `movable` is false; a novel
  is not movable either, although LNReader feeds it. `tests/kinds-db.spec.ts`
  ("refuses a gallery doujin with a mihon: key at every MOVE door") plans one
  through `planMihon`, writes it, and asks `moveState`, `moveEligible`,
  `moveComparison` and `applyMove`. Making it move would need a change to
  [`MOVE.md`](MOVE.md) too.
- **A doujin's catalogue is read at import, not in the LINK queue.**
  `catalogue` says AniList `MANGA` for a doujin, and a live path asks it:
  `planMihon` keeps Mihon's MAL tracker for a gallery source's doujin
  (`malLink`, `src/lib/import/mihon-plan.ts`), the import writes it as a link
  (`linkFromTracker`, `src/lib/server/import/write.ts`), and `resolveLinks`
  (`src/lib/server/catalogue.ts`) reads that MAL id in the series' own kind's
  catalogue through `byIds`, so the request says `type: MANGA`; the resolved
  entry then gives the series its cover (`linkCover`). The doors the user
  works with leave a doujin out: `LINKABLE_KINDS` keeps it out of the LINK
  queue and the pass, and `linkState` gives its series screen no LISTS row.
  `tests/kinds-db.spec.ts` ("a doujin's catalogue") goes through the import
  path. `candidateKind` never names a candidate `doujin`, so the `doujin` in a
  comic's `matches` is reached only by a series' own kind.
- **The FILTER panel's words for some kinds are plurals.** `KIND_LABEL`
  (`filters.ts`) says `DOUJINS`, `NOVELS`, `MOVIES` and `SHOWS` where
  `kindLabel` says `DOUJIN`, `NOVEL`, `MOVIE` and `SHOW`. It is a list of the
  panel's labels, not of kinds.
- **`RANOBE_KINDS` is Ranobe's own list.** `['novel', 'manga', 'manhwa',
'anime']` in `library/ranobe.ts`, the kinds Ranobe tracks, with `byWork(kind)`
  its work-versus-edition rule ([`RANOBE.md`](RANOBE.md)).
- **The engine's extension kinds are the APK families'.** `engine_extensions`
  has `CHECK (kind IN ('manga', 'anime'))`, the two families an APK extension
  can be: not the movable kinds and not MOVE's map, which happens to have two
  values for another reason. `tests/kinds-db.spec.ts` asserts it against
  `SOURCE_KINDS.mihon` and `SOURCE_KINDS.aniyomi`. MOVE has no table of its
  own.

## Keys that are no family's

`KEY_PREFIX` is the one statement of the prefix each family's `origin_key`
starts with. `keyOf`, `novelKeyOf` and `animeKeyOf` build keys from it and
`parseKey`, `parseNovelKey` and `parseAnimeKey` read them with it
(`library/downloads.ts`). Who writes each: Mihon's backup and BROWSE's ADD
through `planMihon` (`src/lib/import/mihon-plan.ts`), LNReader's through
`novelKeyOf` (`src/lib/import/novel-plan.ts`), Aniyomi's through `animeKeyOf`
(`src/lib/import/anime-plan.ts`, `engine/anime-source.ts`) and a folder's
`tvshow.nfo` or film NFO (`library/anime-files.ts`), and MOVE's re-key
through `keyOf`/`animeKeyOf` (`server/move.ts`, `candidateOf`).
`tests/kinds.spec.ts` plans one series per importer and checks each key's
family is in its kind's Sources.

**No family is a real answer.** A key with any other prefix belongs to no
family: Hentoid's `hentoid:<site>:<url>` and `hentoid-dir:<folder>`
(`src/lib/import/hentoid-plan.ts`), a downloaded folder the backup does not
know, `mihon-dir:` (`mihon-plan.ts`), an EPUB's `epub:<path>`
(`epub-plan.ts`, and `server/books.ts` when a volume is taken out), and a
grouped series of books, which has no key at all. `keyFamily` answers `null`
for them, and every caller decides what null means: no downloader, no
FOLLOW, no MOVE ([`DOWNLOADS.md`](DOWNLOADS.md), "Which downloader takes a series"). Hentoid
is not a family, because making it one would give its series a downloader to
ask, which is a change of behaviour of its own.

## The kind a source serves

`SOURCE_KINDS` gives each family one kind, and that is the family's default:
a Mihon row is a manga, an LNReader row a novel, an Aniyomi row an anime. But
a family is not a kind. A Mihon source can serve manhwa (a webtoon-only
source, a source whose series all say so), a gallery source's series are
doujin, and an Aniyomi source can serve anime, films or shows. So the kind is
a fact of the **source**:

- `SOURCE_KIND_CHOICES` lists what each family may serve, its default first:
  Mihon `manga`, `manhwa`, `doujin`; LNReader `novel`; Aniyomi `anime`,
  `movie`, `show`. `sourceKindChoices` and `defaultSourceKind` read it, and
  `tests/kinds.spec.ts` holds it to `SOURCE_KINDS` and to each kind's
  `sources`.
- `engine/source-kind.ts` keeps the user's choice in `settings` as
  `source.kind:<id>`, with **no row meaning AUTO**: the plan's own inference
  (a gallery's doujin, a "Manhwa" genre, a webtoon-only source). An explicit
  row wins over every inference, `manga` on a gallery source included, which
  is why the default is not "no row". A stored word the family cannot serve
  reads as AUTO, and writing one is refused.
- `import/write.ts` asks it once, at the insert (`sourceKindOfKey`): a new
  series takes its source's kind, and a series already in the library keeps
  its own. That one writer is every way in: a backup, ADD, an anime's ADD, a
  novel's, a sync, FOLLOW.
- A source's settings page draws AUTO and the family's kinds only where there
  is a choice ([`BROWSE.md`](BROWSE.md), "The kind it serves"), and SEARCH THE
  SOURCES and BROWSE read the same answer (`kindOfSource`).
- A series' own kind can be switched on its screen between `movie` and `show`
  only, the two kinds TMDB holds, and the switch moves the files
  ([`FILMS-SHOWS.md`](FILMS-SHOWS.md), "Switching a film and a show").
- `sourceFamilyOf` is the inverse of `SOURCE_KINDS`: it decodes the word an
  APK family stores (`engine_extensions.kind`, an APK listing's) back to its
  family, not what a source serves. `engine/repo-index.ts` re-exports it as
  `familyOfKind`. A source that serves `manhwa` is still a Mihon source.

Some readers still ask `SOURCE_KINDS[family]` for a row's kind or medium:
BROWSE's preview chips and press (`browse-select.ts`, `browse-press.ts`),
`keyKind` (`library/downloads.ts`), the extensions page, and `sourceMedium`
(`engine/backend.ts`). They are right because every kind one family serves
shares a medium (every Mihon kind is pages, every Aniyomi kind video), so a
manhwa downloads as a manga does and a film as an anime does. A family whose
kinds differed in medium would have to ask the source instead.

## No new kind checks

`tests/kinds.spec.ts` scans `src/` for a `kind` (a series', a source's, a
candidate's) compared against one of `KINDS`' names, either way round:

```
s.kind === 'anime'      kind !== 'novel'      'manga' === row.kind
```

the same comparison spelled through a family's kind, dotted or bracketed:

```
s.kind === SOURCE_KINDS.lnreader      SOURCE_KINDS[f] === r.kind
```

and SQL, since the registry is not a column and SQL that filters by kind has
to spell the kinds:

```
s.kind = 'anime'      kind != 'novel'      kind IN ('movie', …)
```

`videoKindsSql` (`kinds.ts`) is the one place a video filter is spelled; any
other spelling is counted. A family asked as a family is not counted
(`BrowseSource.family`, `familyOfKind(l.kind) === 'mihon'`), nor a
download's or a device's own `kind`, nor a helper such as `movableKind`, nor a
comparison between two variables.

The scan is textual, so a mention in a comment counts and a line holding two
comparisons counts once. This command prints the same lines:

```sh
rg -n --glob '*.ts' --glob '*.svelte' --glob '!src/lib/library/kinds.ts' \
  -e "\bkind\s*[!=]==?\s*(['\"](manga|manhwa|doujin|novel|anime|movie|show)['\"]|SOURCE_KINDS\b)" \
  -e "(['\"](manga|manhwa|doujin|novel|anime|movie|show)['\"]|SOURCE_KINDS(\.\w+|\[[^\]]*\]))\s*[!=]==?\s*[A-Za-z_\$][\w\$.]*kind\b" \
  -e "\bkind\s*(=|!=|<>)\s*'(manga|manhwa|doujin|novel|anime|movie|show)'" \
  -e "\bkind\s+(NOT\s+)?IN\s*\(\s*'(manga|manhwa|doujin|novel|anime|movie|show)'" \
  src
```

The spec holds an **allow-list by file**, each with the reason that file may
name a kind. What it leaves is another service's vocabulary, Ranobe's own
kinds, SQL that cannot ask the registry, fixtures, or a tracker's rule:

- **`src/lib/server/db.ts`**: the migrations are history; each says what the
  schema was when it ran, and a migration is never edited.
- **`server/anime/marks.ts`**: SQL; AniSkip is looked up by a MAL id, which
  only an anime's link carries.
- **`server/anime/choices.ts`**: SQL; the old browser-kept player choices it
  adopts were only ever written for an anime.
- **`server/dupes.ts`** and **`server/duplicates.ts`**: SQL; likely twin books
  are found among doujin books, and a series of doujin books or a novel is
  never collapsed as duplicate chapters
  ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md),
  [`DUPLICATE-CHAPTERS.md`](DUPLICATE-CHAPTERS.md)).
- **`server/epub.ts`** and **`server/novels/online.ts`**: SQL; an EPUB and a
  chapter read online are a novel's.
- **`server/people.ts`**: SQL; a person's page lists a doujin of one book as a
  book.
- **`server/settings-page.ts`**: SQL; N SERIES DIFFER is about reading
  direction, which only the kinds read in pages or text have.
- **`library/catalogue.ts`** and **`server/catalogue.ts`**: AniList's own
  words (a format and a country become a kind, the cover-only crossing), and
  its transport (the MAL id family, the GraphQL type, the format list each
  kind is asked with).
- **`server/fixtures.ts`**: one series of each kind, shaped like an import's.
- **`server/japanese/ocr.ts`**: SQL; OCR is for pages, and the one text kind
  is named.
- **`server/ranobe.ts`** and **`library/ranobe.ts`**: which kinds Ranobe
  tracks and its work-versus-edition rule.
- **`server/tracking.ts`**: MAL and AniList track a comic and an anime, never
  a doujin or a novel.

Everything else asks the registry. The spec's failure message is the diff:
every counted line outside the allow-list, with its file and number, so a
change that adds one names it. A new check inside an allowed file still needs
a sentence in that file's reason, and a new kind must be answered everywhere
the compiler asks.

## Limits

- **A novel's unit in the link review is a chapter.** `unitLabel(novel)` is
  `VOL` and `sheetMeta` says `12 VOL`, but the AniList review's `whyLine` says
  `CHAPTERS CLOSE` and `candidateRows` draws a CHAPTERS row for a novel
  (`library/catalogue.ts`); neither reads `unit`.
- **A row's kind is read off its family** in the places listed at the end of
  "The kind a source serves", which holds only while a family's kinds share a
  medium.
