# Anime

Anime from Aniyomi's extensions, found, streamed, downloaded and watched
inside tsundoku, as manga runs on Mihon's and novels on LNReader's
([`DOWNLOADER.md`](DOWNLOADER.md), [`NOVELS.md`](NOVELS.md)). Card c128
("Anime from Aniyomi extensions: player and storage"), from the brief
[`briefs/PLAYER.md`](briefs/PLAYER.md) and its handoff in
[`design/handoff/`](design/handoff/) (Anime Calls, Anime States, Player
States, Player Waiting, and the parametric Index Player, Index Anime Series
and Index Anime Library). The owner approved its five defaults on 2026-10-28,
the second amended to Jellyfin's TV layout (card c128 has them in full).

| Part                                                     | Card | State   |
| -------------------------------------------------------- | ---- | ------- |
| Anime as a kind, its series screen and the ANIME shelf   | c153 | Done    |
| Anime sources in BROWSE, the preview and ADD             | c154 | Done    |
| Streams: resolving an episode's videos, through tsundoku | c155 | Not yet |
| The player                                               | c156 | Not yet |
| Downloading episodes into a Jellyfin-shaped folder       | c157 | Not yet |
| FOLLOW, and the tablet keeping the next episode          | c158 | Not yet |
| Live checks, departures and docs                         | c159 | Not yet |

**Not to be deployed before c156.** Until the player exists, `/read/<entry>`
answers 404 for an episode, and every ▶ on an anime series leads there.

## Anime as a kind

A series of kind `anime` is **episodes** (rung 47). An episode is an entry,
so everything that counts chapters counts episodes (READ is WATCHED on its
screens), with what a chapter doesn't have:

| Column           | What                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| `duration_s`     | its length, seconds; NULL until a source or a file says                            |
| `season`         | the source's season; NULL for a flat list (most of Aniyomi's)                      |
| `episode_number` | its number as the source gives it, which starts again each season                  |
| `episode_note`   | `filler` or `recap`, where the source says so                                      |
| `thumb_url`      | its 16:9 picture at the source                                                     |
| `ending_at`      | where its ending starts, seconds, from the source's timestamps                     |
| `last_position`  | for an episode, **seconds** into it, not a page (and the reading log's `page` too) |

`position` stays the order across the whole series, unique as a chapter's,
so nothing that reads positions (the duplicate collapse, the reader's next)
ever meets two "EP. 1"s; `episode_number` is what the screens show.

**Rung 47 edits the schema's text.** `anime` had to join `series.kind`'s
CHECK, which SQLite can't change in place, and the usual way round (a new
table, the rows copied, the old one dropped) would, with foreign keys on,
cascade the drop through every table that references a series: the whole
library. A CHECK that allows more changes nothing stored, which is the case
SQLite's documentation gives for editing the schema instead (`lang_altertable`,
"Making Other Kinds Of Table Schema Changes"): `writable_schema`, the schema
version moved on, an integrity check before the rung commits. better-sqlite3
opens connections defensive, which forbids that, so unsafe mode is on for
those few statements only. The rung refuses to run on a `series` table whose
CHECK isn't the one it expects. It's the first rung written as code
(`MIGRATIONS` takes a function where SQL can't say it). Measured on a copy of
the live database before it shipped: integrity ok, no foreign-key violation,
81,922 entries kept. `tests/migrate-anime-db.spec.ts`.

## The words (`src/lib/library/anime.ts`)

Pure, and what every screen reads (`tests/anime.spec.ts`):

- **Status** (Anime States 1a): WATCHED; "14:32 LEFT" for the one
  part-watched; its size when it's on the workstation; NOT DOWNLOADED
  otherwise, which is a fact, not a warning: those episodes stream.
- **Watched** (Anime Calls, "Resume"): at the ending's start where the source
  gave timestamps, otherwise in the last 3 % (`isWatchedAt`; the player, c156,
  marks it).
- **Seasons** are groups, headed "SEASON 2 · EP. 1 – 12", "6 WATCHED"; a
  season watched through folds into one row, "↑ SEASON 1 · EP. 1 – 12",
  "12 WATCHED · SHOW", unless the episode being watched is in it. A list
  without seasons stays flat.
- **CONTINUE**: "▶ CONTINUE · S2 · EP. 7 · 14:32 LEFT"; START "EP. 1 ·
  STREAMS" on a series not begun whose first episode has no file; WATCH
  AGAIN once everything is watched.
- **The library's CONTINUE**: "ANIME · S2 EP. 7 · 14:32 LEFT", and the bar is
  the episode's (39 % of EP. 7), not the series' share watched.
- **History**: episodes count as chapters, "ANIME · EP. 3 → 5 · 9:28", the time
  where an episode was left part-way.
- **Sizes** are ABOUT, from a stream's bitrate times the length
  (`aboutBytes`): Aniyomi's video list gives no bitrate, so c155 reads it from
  the HLS master playlist's BANDWIDTH.

## The screens

- **The library**: an ANIME shelf after NOVELS, while the library has some,
  as every kind shelf (`KIND_SHELVES`, `server/library.ts`).
- **The series screen** is c94's (Index Anime Series): the meta line "ANIME ·
  ANIMEPAHE · ONGOING", the count "24 EPISODES · 2 SEASONS · 18 WATCHED" under
  the titles, RATING, FAV, CONTINUE, DOWNLOAD, SHELVES, LINK, FILE. No
  DIRECTION row, and no OCR or words rows: a video has neither a reading
  direction nor pages. ▶ is never dimmed for a missing file: an episode
  streams.
- **The list** (`src/routes/series/[id]/EpisodeList.svelte`): 72px rows, the
  number in a 64px column, a 96×54 picture (the cover's stripes until c154
  brings sources'), the title over its length and FILLER or RECAP, a 2px bar
  on the one part-watched, the status, ↓ for an episode cached on the device.
  # finds an episode by its number in the season being watched first. A tap
  plays any episode; downloading is the DOWNLOAD row's and SELECT's. A long
  press marks it and everything before it watched, as for chapters.

`tests/browse-anime.e2e.ts`, on the browse server's seeded "Tsukiakari no
Ryokōsha" (`tests/browse-setup.ts`, the handoff's own sample), pins the
shelf, CONTINUE, the count, the season fold and heads, each status, and the
handoff's measurements.

## Finding and adding (c154)

An Aniyomi source is a source like any other in BROWSE and SEARCH THE SOURCES
([`BROWSE.md`](BROWSE.md)): under ANIME, with POPULAR, LATEST, its filters,
its SETTINGS, search inside it.

- **The same questions, under their anime names.** The engine's anime calls
  are the manga ones with Anime and Episode in them
  ([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)), so `callSource`
  (`engine/backend.ts`) names them for an anime source (getPopularAnime,
  getSearchAnime, filterSchemaAnime, preferencesAnime…), sends `animeData`
  for `mangaData`, and reads a page's `animes` as `mangas`. Everything that
  browses, searches and sets a source's settings works unchanged.
- **Covers**: the engine's `/image/` proxy as for manga; a site's picture,
  which an Aniyomi source often gives instead, comes through the server
  (`/api/browse/novel-cover/<token>`, internet only), never to the browser.
- **The preview** says EPISODES ("4 EPISODES · EVERY ONE STREAMS · NOTHING
  DOWNLOADS UNTIL ASKED"), newest first, "S2 · Ep. 2 · Thaw".
- **ADD TO LIBRARY** (`engine/anime-source.ts`, `src/lib/import/anime-plan.ts`)
  writes an anime series through the one writer, which learned the episode
  columns: keyed `aniyomi:<source>:<url>`, its own prefix, so nothing that
  downloads chapters takes it for a manga; into the **Anime** root,
  `$LIBRARY_ROOT/Anime`; `series.source` the source's name, so the meta line
  reads "ANIME · ANIMEPAHE · ONGOING" as the handoff draws it; every episode
  NOT DOWNLOADED, known by its URL.
- **Seasons.** The engine flattens a source's seasons and names each episode
  after its season ("Season 2 - Episode 3"); that prefix is the season, and a
  list without one stays flat. Episodes are oldest first within a season,
  seasons in order; a number the source didn't give is read from the name,
  else placed by where the source listed it. The title is what's left after
  "Episode 3".
- **IN LIBRARY and SAME TITLE** match anime by their own key; the queue tells
  an anime's rows apart by it too (`QueueRow.kind`), so the engine's chapter
  worker never takes an episode.

`tests/anime-plan.spec.ts`, `tests/anime-source-db.spec.ts` (BROWSE's ANIME
rows and the anime calls, covers, the preview, ADD by season, IN LIBRARY,
search) and the c154 test in `tests/browse-anime.e2e.ts` (a source on the fake
engine, browsed, previewed, added).

## Where it departs from the handoff

- **A tap on an episode plays it**, whatever its file. The handoff draws no
  row action; the reader's "the row is the button" (a tap queues a chapter
  with no file) would make streaming, the default, two taps away.
- **On a phone the picture goes** (below 600px): the handoff draws the tablet
  only, and at 360px the title is what's left otherwise.
- **The season head says only how many are watched**, not "12 OF 24 OUT":
  a source doesn't say how many episodes a season will have.
- **History names no season** ("EP. 7 · 9:28", not "S2 EP. 7 · 9:28"): the
  reading log keeps an entry's label, and a season is the episode's own field.

## What it does not do yet

Streams, the player, downloading and FOLLOW: the cards above. **No episode
pictures, lengths or FILLER/RECAP yet**: the engine's episode list carries
none of them (`JEpisode` is url, name, date, number, scanlator). A length
comes from the stream (c155) or the file (c157). **No LINK for anime**: the
catalogue search (AniList, MAL) asks for manga and novels only.
