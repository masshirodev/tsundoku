# Films and shows

tsundoku keeps films and TV shows beside its manga, novels and anime, as two
kinds of series: `movie`, a film, and `show`, a TV series whose catalogue is
TMDB (live action included; anime stays `anime`, on AniList). They come from
Aniyomi-family extension sources, are downloaded under the one library root,
are linked to TMDB when the install has a key, and play in tsundoku's own
video player. Their facts in the registry are in [`KINDS.md`](KINDS.md).

## How it is shaped, and why

- **Two kinds, in tsundoku.** Films and shows live here, not in another app:
  tsundoku downloads them and plays them in its own player, as it does an
  anime's episodes. A film is a series with one entry, no unit and no list; a
  show is an anime-shaped series of episodes.
- **The sources are Aniyomi-family extensions.** tsundoku already runs them
  for anime ([`ANIME.md`](ANIME.md),
  [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)), and Aniyomi's API is not
  limited to anime: the film and TV sources in the Aniyomi repositories give a
  film back as a series of one episode and a show as a list of episodes, so the
  source side is "install another extension" and needs no new engine.
  Stremio addons and debrid services are not used: the popular addons answer
  with torrent info-hashes, so a client needs a debrid subscription or a
  BitTorrent peer, which is a different product from a library that downloads
  and keeps files. CloudStream plugins are not used either: they are dex built
  against CloudStream's own app API, so hosting them would mean a second
  engine and a second extension format, for sources the Aniyomi family
  already has.
- **Seasons are what the source returned.** A flat list stays flat, and
  seasons added as separate series stay separate until the user merges them
  ([`WORKS.md`](WORKS.md)). TMDB is used to _find_ what is missing, never to
  renumber what the source said.
- **What comes next is the linked catalogue's question.** AniList for an
  anime, TMDB's seasons and next episode for a show, TMDB's collection for a
  film. **A film franchise is a Work**: the Work's order is the user's, and
  its next part is what the player offers at the end; the collection only
  offers, never chains by itself.
- **One library root, a folder per kind.** `Movies/`, `Shows/` and `Anime/`
  sit under the one root, named the way Jellyfin reads a library because it
  costs nothing. tsundoku does not depend on Jellyfin; it writes the NFOs
  because it reads them back.
- **TMDB is optional.** Each install brings its own key, and no key means
  fewer niceties, never an error (below, "Without a key").
- **Trackers are accounts, and each declares the kinds it takes.** AniList and
  MAL take comics and anime, never a film or a show (neither has live-action
  entries); Trakt takes films, shows and anime. TMDB is a catalogue, not a
  watch log.
- **The player does not change.** A film plays as an episode does.

## In the registry

| Kind    | Medium | Unit        | Catalogue    | Matches | Sources | Movable | Storage                       |
| ------- | ------ | ----------- | ------------ | ------- | ------- | ------- | ----------------------------- |
| `movie` | video  | none        | TMDB `movie` | movie   | aniyomi | yes     | `Movies/`, `Movies (hidden)/` |
| `show`  | video  | EP, WATCHED | TMDB `tv`    | show    | aniyomi | yes     | `Shows/`, `Shows (hidden)/`   |

- A film has **no unit**: `kindUnit` answers empty words (with `done`
  WATCHED), so `sheetMeta` and every count line draw no count for it.
- Each matches only its own kind: a film is never the twin of the book or the
  anime it adapts. That relation is OTHER FORMS, and a Work can hold them all
  (below, "Linking to other series").
- Both are movable between sources, and MOVE maps them as video, by episode
  and season (`MOVE_MAP`, [`MOVE.md`](MOVE.md)).
- Neither has a reading layout, and SETTINGS' direction defaults leave them
  out.
- The database's `series.kind` CHECK takes both (migration 79).

## Where they come from

An Aniyomi source serves anime until the user says otherwise. On a source's
settings page, KIND offers AUTO, ANIME, MOVIE and SHOW
([`BROWSE.md`](BROWSE.md), "The kind it serves"; `engine/source-kind.ts`),
and a series added from that source afterwards, by BROWSE's ADD, a search's
ADD, takes that kind at the one writer (`import/write.ts`). A series
already in the library keeps its kind. [`KINDS.md`](KINDS.md), "The kind a
source serves".

What the sources look like:

- **A film is one episode**, often named "Movie" or after the film, and the
  series is that one entry.
- **Episode lists are often flat.** A show's seasons arrive as one list with
  no season numbers (a whole show of four seasons as 25 episodes), or as one
  series per season, depending on the source.
- **Titles carry release words**: `Lupin [Hindi-English] 1080p WEB-DL x264`,
  `The Long Ferry (2024) 2160p DUAL`, `Alchemy of Souls S2 720p ESub`. The
  TMDB query and a film's folder name take them off (`tmdbQuery`).
- **Two stream shapes**: download sites hand back files (MKV, often dual
  audio, subtitles embedded) that honour `Range`, and drama sites hand back
  HLS with separate subtitle tracks and a `Referer` the request must carry.
  Both go through the anime path as they are ([`ANIME.md`](ANIME.md),
  "Streams").
- **Jellyfin** is also an extension in the official Aniyomi repository: a
  source configured with a Jellyfin server's address and a login, which
  serves what that server already holds, with no scraper. From inside the
  engine's container the server is reached by the host's LAN address, not
  `127.0.0.1`.

All the other film and TV sources are unofficial streaming or download sites.
tsundoku ships no repository: a source is the user's own addition, as it is
for manga and anime.

## On disk

Downloads go under the one library root, in the kind's folder
([`DOWNLOADS.md`](DOWNLOADS.md), "Where files go"; `storage` in the
registry):

```
$LIBRARY_ROOT/Shows/<Series>/tvshow.nfo, poster.jpg
$LIBRARY_ROOT/Shows/<Series>/Season 01/<Series> S01E07 <Title>.mkv, and its .nfo
$LIBRARY_ROOT/Movies/<Title (Year)>/<Title (Year)>.mkv, <Title (Year)>.nfo, poster.jpg
$LIBRARY_ROOT/Shows (hidden)/…   Movies (hidden)/…                  the reveal rule
```

- **A film's folder** is TMDB's title and year when the film is linked, else
  the source's title with its release words taken off and the year it names.
  Its NFO is Jellyfin's `<movie>` (`movieNfo`, `library/anime-files.ts`) and
  carries the series' key, the entry's address at the source and its
  position, so a rescan folds the file back onto both.
- **A show** is laid out as an anime is, its folder the series' own title.
  One source season is one series and its own folder; a merged show's seasons
  keep theirs (`series_season_facts.folder`).
- **The NFOs say the kind** (`<tsundokukind>`), so a rescan or a new install
  over the folder brings a film back as a film and a show as a show; a show
  NFO without it reads as an anime. A linked film or show carries
  `<uniqueid type="tmdb">`, and a TMDB link, UNLINK or UNDO rewrites its NFOs
  in place (`rewriteVideoNfos`), as a download does.
- **A hidden series** goes to the kind's hidden folder, which no Jellyfin
  library would read, since Jellyfin has no reveal.
- **One root on purpose**: the delete guard (`isUnder(library)` in
  `delete.ts`), backups, the hidden folders and RESCAN all assume it. A second
  root would quietly skip deletes and leak hidden series.

## Importing

The importer has one source per video kind, `Anime`, `Shows` and `Movies`,
each rooted at its folder (`VIDEO_STORAGE`, `server/import/index.ts`). A film
folder is read through its `<movie>` NFO (`readMovieNfo`): the file whose NFO
carries the folder's key becomes the film's one entry, with its measured
duration, and the NFO's genres and source become tags. A show folder is read
as an anime's is, through `tvshow.nfo` and the episodes' NFOs. A file just
downloaded attaches under the root that holds it, and BROWSE's ADD roots a
series by the kind it will have. A series already in the database keeps the
kind it has.

## Linking to TMDB

A film's or a show's link is TMDB's, never AniList's: `linkState` answers
null for a kind AniList does not hold, AniList's link pass and search skip
them, and `parsePasted` refuses an AniList link for one. The whole of it is
in [`LINKS.md`](LINKS.md), "TMDB links"; in short:

- **Three tables of their own** (migration 80, `server/tmdb-links.ts`):
  `series_tmdb_links` (the link, and what the screen draws without asking
  again: overview, poster, backdrop, a film's runtime and collection, a show's
  season count), `tmdb_link_searches` and `tmdb_link_candidates`.
- **Sure** (`tmdbSure`): one result whose title or original title equals one
  of the series', and, when the source named a year, of that year one either
  way. Anything less goes to the review on `/links`, whose third service is
  `tmdb`. A search the user runs never links by itself.
- **A show links as the whole show.** TMDB's seasons are inside its one
  entry, and every season series of a show links that one entry; the source's
  seasons stay the source's.
- **Its own timer** (`tmdb-fill.ts`): twenty films or shows every ten minutes,
  so a film added by BROWSE is looked up without an import.

## What surrounds it

What comes before and after a film or a show is read from TMDB by id, cached
per TMDB entry (`tmdb_surroundings`, migration 81), and drawn by
`library/surroundings.ts` ([`LINKS.md`](LINKS.md), "What surrounds it"):

- **A show**: its seasons (season 0, the specials, is never one), whether it
  is in production, and the next episode. Which season a series is comes from
  its title (`titleSeason`), and the show's other seasons are the other
  library series linked to the same TMDB entry. The series screen draws the
  other seasons as heads in the episode list (`SEASON 4 · 8 EP · TMDB · FROM
3 NOV`), a SEASONS row under LISTS (`3 of 4 in the library`, FIND THE REST →,
  which opens the source search for the show's name), and SEASON 4 IS OUT
  under CONTINUE for the first aired season past every one here. NOT THIS is
  kept (`tmdb_offers_declined`) and never asked again.
- **A film**: its collection's parts in release order, this one inverted,
  each IN LIBRARY → or FIND; past six parts the rest fold round this one. The
  foot offers GROUP → only when two or more parts are here and none is in a
  Work. In a Work the block is one line saying what the Work lacks
  (`ALL 3 IN THE WORK`, or `PART 3 NOT IN THE LIBRARY · FIND`), since the
  Work's row is the NEXT.
- **Hidden** series are read as the viewer may see them: with reveal off, a
  hidden part is not in the library and the block never names it.

## Linking to other series

- **Seasons into one show.** GROUP's ONE SHOW merges two or more video series,
  one per season, into one series whose episodes carry their season
  (`isSeasonSet`, `mergeSeasons`; [`WORKS.md`](WORKS.md), "Grouping seasons
  into one show").
- **A Work** groups series across kinds without merging them: a film
  franchise, or a film with the anime and the manga it belongs to. Finishing
  one part offers the next, the player's end included (`workEndOf`). From a
  film's collection, GROUP → opens the GROUP sheet with the parts here in
  TMDB's order.
- **No catalogue crossing.** A film or a show is never matched to an anime, a
  manga or a novel, nor any of those to it: each catalogue holds its own kinds
  (`catalogueHolds`).

## Switching a film and a show

A series can be switched between `movie` and `show` on its screen
(`server/kind-switch.ts`, the KIND row's CHANGE and `KindSheet.svelte`).
Only those two: an anime to a show would cross catalogues, and its AniList
link would have to go. The switch **moves the files**, because the folder
must match the kind afterwards: `Movies/<Title (Year)>/<Title (Year)>.mkv`
becomes `Shows/<Title>/Season 01/<Title> S01E01 ….mkv`, each with its NFO,
and back.

- `planKindSwitch` says every path before anything moves, what changes and
  what stays, and refuses in place when it cannot (`MOVIE · A MOVIE IS ONE
ENTRY, THIS HAS 8`). A file still downloading or queued lets the pick be
  made and refuses the move.
- `switchKind` moves the files, the NFOs and the poster first, and moves them
  back should one refuse; then the kind, the root, the folder and the
  entries' files in one transaction; then writes the new kind's NFOs.
- The TMDB link, search and declined offers go, since TMDB is asked again as
  the other kind (a film's entry is not a show's). Progress, rating, shelves,
  the Work and the series' id stay.
- UNDO is remembered per series by the server process; a restart forgets it,
  and switching back still works.

## The screens

**A film** has its own screen, since it has no list
(`src/lib/library/film.ts`, `FilmStage.svelte`; [`SERIES.md`](SERIES.md)):

- One primary cell: `▶ PLAY · 1 H 58`, `▶ CONTINUE · 42 MIN LEFT` with a 3px
  line at its foot for how far in, or `↺ WATCH AGAIN · WATCHED 3 NOV`, quiet.
  The length is the file's once measured, else TMDB's runtime, else none.
- The count line: `2024 · 1 H 58 · DRAMA`, with `· WATCHED` once it is. With
  no TMDB link it closes up to `FILM · <SOURCE> · 1 FILE`: no year, runtime,
  ABOUT or collection, and nothing drawn dimmed or marked unknown. LISTS'
  TMDB line is the one place that says why, so a working screen never looks
  deficient.
- DOWNLOAD is one file's: not here, queued, downloading, failed, here, each
  with one cell (DOWNLOAD, CANCEL, TRY AGAIN). PLAY streams in every state but
  here. Never on a film: an episode list, NEXT 10, ALL, REFRESH, FOLLOW, or an
  episode count.
- KIND takes DIRECTION's place (a video has no direction) and lives inside
  DETAILS on a phone.
- On a wide screen the list's column is **the stage**: the TMDB backdrop at
  16:9, `01 — THE COLLECTION`, and `02 — ABOUT`. With no link the stage is
  empty. On a TV the stage is facts only: its rows hold no focusable cell, and
  ABOUT is not drawn.

**A show** is an anime's screen, with what surrounds it from TMDB drawn in
the three places above.

**LISTS** on both draws one TMDB line (`tmdbLine`, `series/[id]/lists.ts`):
with no key, `TMDB · Not looked up` with `SET UP →` to SETTINGS' CATALOGUES;
linked, the entry with `FILM · 2019 · 1 H 52` or `SHOW · 2024 · 3 SEASONS ON
TMDB` and CHANGE; not linked, FIND and PASTE A LINK. Beside it, the LIST line
says `Kept in HISTORY` while no tracker that takes the kind is signed in.

## Playing

A film or a show opens in the same video player as an anime's episode
(`VideoPlayer.svelte`; [`ANIME.md`](ANIME.md), "The player"): the reader's
route takes the video branch for any kind whose medium is video, and the
player's stream, file, picture and choice queries ask `videoKindsSql`. A
film's one entry is its whole progress: CONTINUE resumes it, and WATCHED is
that entry read. At the end the player offers the Work's next part when the
series is in one.

Two things are an anime's alone: AniSkip, which is looked up by a MAL id that
only an anime's link carries, and the intro fingerprints read across episodes
(`videoKindsSql(…, { episodic: true })`), which a show has and a film, with
nothing to compare against, does not.

## Without a key

The TMDB key is the install's own: `TMDB_API_RC_TOKEN` (the v4 read token,
sent as a bearer) or `TMDB_API_KEY` (v3, in the URL) in the data folder's
`.env`, else a key typed into SETTINGS › CATALOGUES, which is checked with
TMDB before it is kept and shown only by its last four characters. The
environment's key wins. It is read at every call, so a key added takes effect
without a restart ([`LINKS.md`](LINKS.md), "Which catalogue, and whether it
can answer"; [`SECRETS.md`](SECRETS.md)).

| Without           | Works                                                                                                         | Off                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A TMDB key        | browse, add, download, play, the local watch log, the source's title and cover, the source's own next episode | the TMDB link, overview, runtime, year, backdrop, the seasons around a show, and a film's collection |
| A tracker account | the local log, statistics, ratings                                                                            | sending to and reading from a tracker                                                                |

With no key the link pass searches nothing and marks nothing, so the first
pass after a key is added finds the library unsearched: that pass is the
backfill. It links only sure matches and offers the rest, as any pass does.

## Tracking

`TRACKERS` in `src/lib/library/tracking.ts` declares, for each service, the
kinds it `takes` and how it connects (an app of the install's own, then a
sign-in); `trackersFor(kind)` is the one question, and the screens draw a
line only for a service that takes the series' kind. MAL is never offered for
a film or a show, not even dimmed. With no tracker, the local history is the
record, and LISTS' LIST line says the watch in its words (`WATCHED 3 NOV`,
`EP. 6 OF 16`, `NOT WATCHED`) ([`TRACKING.md`](TRACKING.md)).

## Limits

- **Trakt is declared, not built** (`built: false`): no app fields, sign-in or
  sends yet, so a film or a show is tracked only in the local history. Simkl
  is not declared.
- **No sheet for adding the rest of a show.** FIND THE REST → and FIND open
  the source search for the show's name; nothing lists the seasons the
  source has against TMDB's to tick.
- **An anime cannot become a show.** The kind switch is between a film and a
  show only, so a live-action drama an Aniyomi source serves as AUTO arrives
  as an anime and stays one; setting the source's KIND to SHOW before adding
  is the way round it.
- **HELP has no keys-and-accounts topic.** `SET UP →` leads to SETTINGS'
  CATALOGUES.
- **The film's screen shows the source's genres**, not TMDB's, and no
  `DIRECTED BY`: credits are a request per film that nothing else needs.
- **QUEUED does not say the file's place in the queue**, and a failure says
  only that the last try failed: the page does not carry the queue's
  position or error.
- **The backdrop** is kept only for links made after migration 82; an older
  link draws the stage without one until it is linked again.
