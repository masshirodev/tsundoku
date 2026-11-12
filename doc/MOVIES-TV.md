# Movies and live-action TV, from Aniyomi extensions

Card c295 ("Spike: can Aniyomi extensions serve movies and live-action TV?").
The question tsundoku's side of it asks is narrow: **is there a source that
works?** tsundoku already runs Aniyomi extensions for anime
([`ANIME.md`](ANIME.md), [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)), and
Aniyomi's API is not limited to anime — a film is an anime with one episode,
and a series is one with seasons (`lib 16`). If the extension repositories
carry working film and TV sources, the source side is "install another
extension" and needs no new engine. This is what was measured on
**2026-11-02** against the development engine, and what would still be missing
if a source worked.

**Verdict: go-with-caveats.** The source side exists and plays: two of the
ten English sources loaded produced a stream that ffmpeg pulled with
audio (and, on one, five subtitle tracks), and both give a film back as a
single episode. The official repository also carries **Jellyfin**, which plays
the owner's own library and needs no scraper at all. What is missing is not a
source but tsundoku's model of one: a film is not a kind, a show's seasons are
flattened, and neither AniList nor MAL knows a live-action title, so metadata
and tracking have no source at all. The caveats are listed under "What
tsundoku would still lack", and the recommended follow-ups under "Follow-up
cards".

## Decided, 2026-11-12

The owner read the spike and the follow-ups, and the shape is settled: two
kinds in tsundoku, seasons as the source returned them, NEXT from whichever
catalogue is linked, one library root, and trackers as accounts. The cards
are on the Tsundoku board under **Movies & TV**; the table at the end of this
section is their order.

- **Two kinds, in tsundoku.** `movie` and `show` live here, play in tsundoku's
  player and download like an anime's episodes. A film is a series with one
  entry, no unit and no list; a show is an anime-shaped series.
- **Seasons follow the source** (the owner). A flat list stays flat, and four
  seasons added separately stay four series until the owner merges them into
  one through the per-season sources (`doc/WORKS.md`). TMDB is used to _find_
  what is missing, never to renumber what the source said.
- **NEXT is the catalogue's question.** AniList for anime (no key), TMDB
  `seasons` and `next_episode_to_air` for a show, TMDB `belongs_to_collection`
  for a film's sequels and prequels. **A film franchise is a Work**: the Work
  row is the NEXT, ORDER is the owner's, and the collection is only the
  offer — never an automatic chain.
- **One library root, kind subfolders.** `Movies/`, `Shows/` and `Anime/` sit
  under the one root, Jellyfin-shaped by naming alone. tsundoku does not
  depend on Jellyfin (the owner: "we dont depend on jellyfin at all"); the
  NFOs stay because tsundoku reads them back. No second root: the delete
  guard, backups, hidden folders and RESCAN all assume one.
- **Trackers are accounts**, and a service declares the kinds it takes:
  AniList and MAL for comics and anime, Trakt and Simkl for films and shows
  (and anime), TMDB a catalogue and rating store rather than a watch log.
  First-party adapters first; third-party plugins through the novels' plugin
  host only if they are ever wanted.
- **Credentials are the install's own, and nothing requires one.** Every
  friend's key is theirs, the app guides and HELP explains, and everything
  degrades to fewer niceties:

  | Without           | Works                                                                                                         | Off                                                                                                |
  | ----------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
  | A TMDB key        | browse, add, download, play, the local watch log, the source's title and cover, the source's own next episode | the TMDB link, overview, cast, runtime, year, the seasons list, and a film's collection (its NEXT) |
  | A tracker account | the local log, statistics, ratings                                                                            | MAL / Trakt / Simkl sends and pulls                                                                |
  | Anything at all   | anime keeps AniList: links, covers, NEXT SEASON and relations are public                                      | —                                                                                                  |

  A key added later backfills: the like of the link pass offers matches for
  what is already in the library, and never invents one.

- **The player does not change.** A film plays like an episode; the only video
  work is the aspect ratio (portrait video, c16 on the dramas-extensions
  board).

**The cards, in dependency order**

| #   | Card                                                                                             | Waits on                                     |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 1   | c986 "Kinds: a source's kind is not its family's, once an Aniyomi source serves films and shows" | —                                            |
| 2   | c988 "Catalogue: one contract, and 'no catalogue' is a normal state"                             | —                                            |
| 3   | c987 "Kinds: a film and a show, and a kind whose unit can be absent"                             | c986, K5 (c305)                              |
| 4   | c989 "TMDB as the film and show catalogue, with no key meaning fewer niceties"                   | c987, c988                                   |
| 5   | c990 "What surrounds this: seasons and collections, from whichever catalogue is linked"          | c989                                         |
| 6   | c991 "Movies/ and Shows/ on disk, Jellyfin-shaped because it costs nothing"                      | c987                                         |
| 7   | c992 "A film's screen has no list, and a show's seasons are the source's"                        | c987, c991                                   |
| 8   | c993 "Trackers: any service, any kind, and a local answer with none"                             | c987                                         |
| 9   | c994 "The setup brief, and HELP's keys-and-accounts topic"                                       | the brief now; the topic after c989 and c993 |
| 10  | c995 "Adding the rest of a show: tsundoku lists the seasons it found, the owner picks"           | c989, c990                                   |
| 11  | c979 "Kinds: a live-action drama is read as a show, not as anime"                                | c986, c987, c992                             |

**The two design briefs** are written: `doc/briefs/MOVIES-SHOWS.md` (the film's
screen, the collection, and adding a show's seasons — c992, c990, c995) and
`doc/briefs/SETUP.md` (keys and accounts — c994). Both need a handoff before
their cards are built, per the repository's rule.

**Answered (2026-11-12).** A TMDB key is set on the workstation: `TMDB_API_KEY`
and `TMDB_API_RC_TOKEN` are in the dev checkout's `.env` and in the shell's
env; the v4 read token is the one to prefer, the v3 key the fallback. The live
data folder gets them when this ships, and a friend's install gets its own.
**Trakt is the first tracker**, Simkl only after it if it still earns the
place.

## The handoff (2026-11-12)

Mirrored at [`handoffs/movies-shows/`](handoffs/movies-shows/): the canvas
(`canvas.json`, title `… [finished]`, `Status: finished`), `Main.dc.html` (the
designer's decisions and answers) and eleven boards, dark. The palette is all
tokens (7 of 7); the theme declares no length tokens, so the mock's literal px
are the decisions and are transcribed (`temp/design/film-desk.json`, from
`design-tools/extract-spec.mjs`; `reconcile-tokens.mjs` finds no ladder).

Both this handoff and the keys one were drawn from a design system copied on
2026-11-12 (artifact `1a1c2781-9bf8-44f2-b38d-23b795fcd8b9`, version
`1794004545-603b`), which is newer than the URL `doc/design/README.md` names.
Its palette is the repository's (`colors.css`), so the drawing and the app
agree on colour whatever the canonical copy is called; the handoffs carry
their own `ft.css` and inline values.

**What it decided, in the owner's terms**

- **A film keeps the 2:2.9 poster** in the identity, so it reads like every
  series and the tile, CONTINUE and the screen show the same picture. A wide
  device's list column becomes **the stage**: the backdrop at 16:9 with
  nothing laid over it, then `01 — THE COLLECTION`, then `02 — ABOUT` (ABOUT
  leaves the panel on landscape and desktop; on a phone it stays above
  DETAILS). The panel keeps identity, RATING and FAV, PLAY, the WORK row,
  DOWNLOAD, LINK, SHELVES, SOURCE, KIND, FILE.
- **One primary cell**: `▶ PLAY · 1 H 58` → `▶ CONTINUE · 42 MIN LEFT` (with a
  3px on-accent line at its foot) → `↺ WATCH AGAIN · WATCHED 3 NOV`. The count
  line reads `2024 · 1 H 58 · DRAMA`, or `MOVIE · NOT LINKED` with no key. The
  film's PLAY and the run's NEXT are the only accents; the collection offers,
  it does not lead.
- **DOWNLOAD loses NEXT 10, ALL, REFRESH and FOLLOW**: `NOT ON THIS COMPUTER ·
DOWNLOAD` → `QUEUED · 2 AHEAD` → `DOWNLOADING · 35%` → `ON THIS COMPUTER`,
  with `1 FILE · 1080P · 1.19 GB` under it and the queue's 3px track.
- **The collection takes the list's place on every device** (landscape: `01`
  under the backdrop; phone: after DETAILS). Rows are `PART 1 · THIS FILM`,
  `PART 2 · IN LIBRARY →`, `PART 3 · NOT IN THE LIBRARY · FIND`, in TMDB's
  order with this film inverted, so a prequel is the row above. More than six
  fold round this one. Its foot offers `2 OF 3 IN THE LIBRARY · NOT A WORK ·
GROUP →` only when two or more parts are here and none is in a Work. In a
  Work it collapses to one line that says only what the Work does not
  (`ALL 3 IN THE WORK`, or `PART 3 NOT IN THE LIBRARY · FIND`).
- **Adding a show's seasons is a sheet** (side sheet on landscape, full-height
  on a phone), in two sections: what the source lists and can be ticked, then
  what TMDB lists that the source does not. Each row shows the source's own
  title, its count and the TMDB season it matched; the head says
  `TMDB LISTS 4 SEASONS · YOUR SOURCE LISTS 1`; a flat entry that holds all
  four is one tick. A season already here says `IN LIBRARY →`, unchanged.
- **The suggestion band** is MIGHT CONTINUE's, under CONTINUE and only on the
  show's screen: `SEASON 4 IS OUT · NOT IN YOUR LIBRARY · FIND · NOT THIS`,
  with `NOT THIS · WON'T ASK AGAIN` and UNDO. A `SEASONS · 3 OF 4 IN THE
LIBRARY · FIND THE REST →` row sits under LINK; no key, no row.
- **The kind switch** takes DIRECTION's slot (after LANGUAGE) on landscape,
  and lives inside DETAILS on a phone and a TV. It is a CHANGE row, not a
  segmented control, because it moves a file: the sheet shows both paths, says
  what else changes (the film becomes episode 1, the collection goes, TMDB is
  asked again) and what stays (progress, rating, shelves, the Work), and
  refuses in place (`MOVIE · A MOVIE IS ONE ENTRY, THIS HAS 8`). Done:
  `NOW A SHOW · 1 FILE MOVED TO SHOWS/` with UNDO.
- **The kind band and the film tile are confirmed, not redrawn.** The board's
  words stand: `NOT WATCHED` / `WATCHED` alone, no year — a year would be the
  only meta line in the grid that is not progress. `doc/handoffs/kinds-band/`
  is the reference.
- **Hidden and TV are the existing rules**: the reveal band and HIDDEN on the
  poster, 404 with reveal off, the collection naming no hidden part; on a TV
  PLAY is the one focus stop, the panel is 352px, and the stage's collection
  is facts only.

**Open: the no-key film screen.** This handoff draws it as `00 — FROM THE
SOURCE ONLY`, one sentence, plus a closed block naming what a key would add
(`YEAR · RUNTIME · ABOUT · CAST · THE FILMS AROUND THIS ONE`, with
`SET UP →`). The sibling handoff
[`handoffs/keys-accounts/`](handoffs/keys-accounts/) says the opposite: with
no key **nothing** is drawn — the title, the source's cover and `FILM · MOVIES
MOD · 1 FILE`, no ABOUT, no year, no runtime, no collection, nothing dimmed or
marked unknown, and the only explanation is LISTS' TMDB line. It calls this
out itself ("MOVIES-SHOWS should take its no-key states from Board 6, or say
where it differs"). **Not settled**; the owner's call, and c992's states wait
on it.

**Where it expected the code to be, and is not**: `doc/TRACKING.md` said
CATALOGUES is SETTINGS' `02`; it is `06` and has been since SETTINGS became
one page (`doc/SETTINGS.md`). Fixed in TRACKING.md with this handoff.

## Where the sources are

The living Aniyomi-family repository is **`mojuru/anime-repo`** (formerly
`yuzono/anime-repo`, and the one `doc/EXTENSION-ENGINE.md` used):
`https://raw.githubusercontent.com/mojuru/anime-repo/repo/index.min.json`,
**247 extensions** on 2026-11-02, pushed that day at 18:41 UTC, its sources in
`yuzono/anime-extensions`. The others are not living:

- `aniyomiorg/aniyomi-extensions`' index has **three** entries — Google Drive,
  GoogleDriveIndex and **Jellyfin** (three configurable sources, 14.17); the
  project's own scraper extensions live elsewhere now.
- `Secozzi/aniyomi-extensions`' index is a one-entry stub: "Outdated App,
  switch to Animiru 0.20+".
- `Kohi-den/extensions-source` is gone (404), as
  [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md) recorded.

In that index, by the versions' own lib generation (`14.x` is lib 14,
`16.x` is lib 16, as the engine counted them): 54 English, 58 Spanish, 31
"all", 21 Portuguese, 14 Arabic, 13 French, 11 German, 9 Indonesian, 7
Italian, and a handful each in Russian, Turkish, Chinese, Polish, Serbian,
Ukrainian, Bulgarian, Hindi, Korean and Traditional Chinese.

### The film, TV and drama sources

The name filter (`movie`, `tv`, `drama`, `cine`, `film`, …) is a starting
point, not the answer: **MKissa is named like KissKH and is an anime source**
(its popular page is _Cyberpunk: Edgerunners 2_, _BLEACH_). Each row below was
loaded into the engine unless it says otherwise; "indexes" is what its own
first page showed.

| Repo              | Source           | Lib | Lang | Site               | Indexes                                                    | Today                           |
| ----------------- | ---------------- | --- | ---- | ------------------ | ---------------------------------------------------------- | ------------------------------- |
| mojuru/anime-repo | KissKH 16.10     | 16  | en   | kisskh.ovh         | Asian TV drama and films, by season and episode            | **Works**: HLS, 5 subtitle sets |
| mojuru/anime-repo | Movies Mod 16.4  | 16  | en   | moviesmod.zone     | Films and TV seasons as download entries, Hindi + English  | **Works**: direct MKV           |
| aniyomiorg/…      | Jellyfin 14.17   | 14  | all  | your own server    | Whatever the owner's Jellyfin holds, by library and season | Installs; needs a server        |
| mojuru/anime-repo | AsiaFlix 14.33   | 14  | en   | asiaflix.net       | Asian TV drama (20 titles)                                 | Browses; **0 videos**           |
| mojuru/anime-repo | PinoyMoviePedia  | 14  | en   | pinoymoviepedia.ru | Filipino films (30 titles)                                 | Browses; **0 videos**           |
| mojuru/anime-repo | UHD Movies 14.19 | 14  | en   | uhdmovies.vip      | Film downloads                                             | **Refused**: TLS chain          |
| mojuru/anime-repo | MKissa 16.74     | 16  | en   | mkissa.to          | Anime, despite the name (26 popular)                       | Video list times out            |
| mojuru/anime-repo | KimoiTV 14.1     | 14  | en   | kimoitv.com        | —                                                          | Popular is empty                |
| mojuru/anime-repo | BLZone 14.10     | 14  | en   | blzone.net         | BL (live-action) drama, 20 titles                          | Not played                      |
| mojuru/anime-repo | My Running Man   | 14  | en   | myrunningman.com   | One Korean variety show, 15 episodes                       | Not played                      |
| mojuru/anime-repo | WcoTv 14.10      | 14  | en   | wco.tv             | Western animation for children                             | Not played, and not live action |
| mojuru/anime-repo | Asia2TV 14.39    | 14  | ar   | —                  | Arabic-subbed Asian drama                                  | Not loaded                      |
| mojuru/anime-repo | Tuktuk Cinema    | 14  | ar   | —                  | Arabic films                                               | Not loaded                      |
| mojuru/anime-repo | FilmiFen 16.2    | 16  | bg   | —                  | Bulgarian films                                            | Not loaded                      |
| mojuru/anime-repo | FilmPalast       | 14  | de   | —                  | German films                                               | Not loaded                      |
| mojuru/anime-repo | Moflix-Stream    | 14  | de   | —                  | German films and series                                    | Not loaded                      |
| mojuru/anime-repo | Movie4k 14.20    | 14  | de   | —                  | German films                                               | Not loaded                      |
| mojuru/anime-repo | AsiaLiveAction   | 14  | es   | —                  | Asian live-action drama                                    | Not loaded                      |
| mojuru/anime-repo | Cine24h          | 14  | es   | —                  | Spanish-language films                                     | Not loaded                      |
| mojuru/anime-repo | CineCalidad      | 14  | es   | —                  | Spanish-language films                                     | Not loaded                      |
| mojuru/anime-repo | Cineplus123      | 14  | es   | —                  | Spanish-language films                                     | Not loaded                      |
| mojuru/anime-repo | Doramasflix      | 14  | es   | —                  | Latin-American and Asian drama                             | Not loaded                      |
| mojuru/anime-repo | FlixLatam        | 14  | es   | —                  | Latin-American films                                       | Not loaded                      |
| mojuru/anime-repo | HomeCine         | 14  | es   | —                  | Films, Spanish-language                                    | Not loaded                      |
| mojuru/anime-repo | LaMovie          | 14  | es   | —                  | Films                                                      | Not loaded                      |
| mojuru/anime-repo | MetroSeries      | 14  | es   | —                  | TV series                                                  | Not loaded                      |
| mojuru/anime-repo | MhdFlix          | 14  | es   | —                  | Films and series                                           | Not loaded                      |
| mojuru/anime-repo | Pandrama         | 14  | es   | —                  | Asian drama                                                | Not loaded                      |
| mojuru/anime-repo | SeriesKao        | 14  | es   | —                  | TV series                                                  | Not loaded                      |
| mojuru/anime-repo | VerSeriesOnline  | 14  | es   | —                  | TV series                                                  | Not loaded                      |
| mojuru/anime-repo | MyKdrama         | 14  | fr   | —                  | Korean drama                                               | Not loaded                      |
| mojuru/anime-repo | Wiflix 14.31     | 14  | fr   | —                  | Films and series, French                                   | Not loaded                      |
| mojuru/anime-repo | YoMovies 14.35   | 14  | hi   | —                  | Films, Hindi                                               | Not loaded                      |
| mojuru/anime-repo | HDFilmCehennemi  | 14  | tr   | —                  | Turkish-dubbed films                                       | Not loaded                      |
| mojuru/anime-repo | Xiaoxintv 14.1   | 14  | zh   | —                  | Chinese films and series                                   | Not loaded                      |

All of them are unofficial streaming or download sites. Nothing here is
licensed, and tsundoku ships no repository ([`BROWSE.md`](BROWSE.md)): a
source is the owner's own addition, as it already is for manga and anime.

"Updated recently" is the repository's answer, not a source's: all 247 APKs
were rebuilt in the push of 2026-11-02 18:41 UTC, and the sources' own history
in `yuzono/anime-extensions` was restructured on 2026-07-11, so no per-source
date survives it. What can be said per source is its version, above.

## What was run

The **development** engine (`ops/engine/compose.yml`, `127.0.0.1:4591`, APKs
in `/mnt/hdd2/tsundoku/engine-dev-wave11`) with its own FlareSolverr, never the
owner's live engine on 4590
([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md), "Running it"). Each APK was
posted to `/dalvik` with `extensionInfo`, which is also the install: the engine
dex2jars it, keeps it under its SHA-256, and answers with a handle. Then the
calls `doc/EXTENSION-ENGINE.md` lists for anime, in order: `getPopularAnime`,
`getLatestAnime`, `getSearchAnime`, `getDetailsAnime`, `getEpisodeList`,
`getVideoList`, and the video's own bytes.

### KissKH 16.10 — the TV/drama source

| Step                         | Result                                                         |
| ---------------------------- | -------------------------------------------------------------- |
| Install (`extensionInfo`)    | one source, en, `https://kisskh.ovh`                           |
| `supportLatestAnime`         | true                                                           |
| POPULAR                      | 40 titles in 1,329 ms                                          |
| LATEST                       | 40 titles in 345 ms                                            |
| SEARCH "alchemy"             | 4 in 535 ms                                                    |
| Details (_Alchemy of Souls_) | 337 ms                                                         |
| Episode list                 | 22 in 339 ms, flat (`S-E20`, no season)                        |
| Video list (episode 20)      | 1 in 5,171 ms: `KissKH - FirstParty - Video`, a direct `.m3u8` |
| Subtitle tracks              | 5: English, Indonesia, Malay, Arabic, Khmer — ~69 KB SRT each  |
| Audio tracks                 | none exposed (the HLS carries one)                             |
| A film (_Parasite_)          | **1 episode, named "Movie"**; 1 video, a 157,114-byte playlist |

The episode's stream is HLS on `hls*.cdnvideo11.shop` and needs the
extension's own `Referer: https://kisskh.ovh/` and `Origin`, which the video
list hands back as `headers`. Subtitles are proxied `/video/<token>.srt`
tokens; each one answered `200 text/plain` with real SubRip.

**The pull.** `ffmpeg n9.0.1`, 20 s, the English track muxed in: H.264
1280×560 + AAC 2 ch + SubRip, 20.04 s of video, 2.9 MB, in 1.1 s. The
container's duration reads 5,216 s because the whole SRT is mapped — the 20 s
slice's own streams end at 20.04 s and 19.99 s.

### Movies Mod 16.4 — the film source

| Step                         | Result                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Install                      | one source, en, `https://moviesmod.zone`                                             |
| POPULAR                      | 21 entries in ~1 s (films and whole TV seasons)                                      |
| SEARCH "avatar"              | 7 in 277 ms                                                                          |
| Details                      | 170 ms                                                                               |
| Episode list (_Lupin S1–4_)  | 25 in 1,364 ms, flat (`S-E8`, seasons flattened)                                     |
| Video list                   | 16 in 11,261 ms: `Cloud Download`, `Instant Download`, `Direct Server 1`, 480p–1080p |
| Subtitle tracks              | none as tracks; the files carry "ESubs", embedded                                    |
| A film (_Avatar Aang… 2026_) | **1 episode**, named after the film; a 1.19 GB 1080p MKV                             |

Its links are files, not streams — 178 MB to 2.06 GB on `r2.dev`,
`workers.dev` and Google's `video-downloads` — and they honour `Range`, so
ffmpeg can take a slice without the whole film. **The pull:** HEVC 1920×804 +
AAC 6 ch (the file's first of its dual Hindi/English tracks), 20.23 s, 3.9 MB,
in 2.4 s.

This one has a quirk worth knowing: its episode URLs carry their own JSON
(`{"urls":[{"quality":…,"url":…}]}`), which is the extension's own shape and
not the engine's.

### Jellyfin — the source that is not a scraper

The official repository's **Jellyfin 14.17** is the only film/TV source here
that is not an unofficial site: three sources, each configured with the owner's
own server address, a username and a password (up to ten sources with the
extension's `extraSourcesCount`). It installs and answers `preferencesAnime`
with that screen. It was **not played**: it needs the owner's address and
credentials, and the development engine is a container, so `127.0.0.1` is the
container itself rather than the workstation's Jellyfin — it would need the
host's LAN address as well as a key. For a library the owner already runs, it
is the shortest path to films and TV that is not a piracy site; the trade is
that it only holds what is already on the server.

### What failed, and why

- **UHD Movies 14.19**: every call dies in the engine with
  `PKIX path building failed … unable to find valid certification path`. The
  site's chain does not validate against the engine's JRE trust store. Nothing
  tsundoku does makes that work; the engine would have to be told to trust it,
  which is the site's problem, not the app's.
- **AsiaFlix 14.33 and PinoyMoviePedia 14.10**: they browse perfectly — 20 and
  30 titles, details, 16 episodes and a film as one episode — and then
  `getVideoList` answers **0**. There is nothing to play.
- **MKissa 16.74**: not a film source at all, and its `getVideoList` timed out
  after 30 s with the source's own "Timed out waiting for MKissa to load the
  episode". The card's enquiry should not count it.
- **KimoiTV 14.1**: POPULAR comes back empty.

None of this needed FlareSolverr: no film or TV source showed a Cloudflare
challenge, and none refused the owner's region (Brazil). The engine's own
solver is unchanged, and the app's novel solver
([`NOVELS.md`](NOVELS.md)) was not involved.

### The URLs, minutes later

Resolved at 22:50 (the drama) and 22:52 (the film) local on 2026-11-02,
checked again at 22:54 and 23:00: the KissKH playlist and its segments, the
Movies Mod MKV (`Range` honoured: `206`) and the engine's subtitle token all
answered both times — `200`, the SRT at all 69,299 bytes. Neither carries a
signed expiry. As with anime, a token dies with the engine process, and the
video list is resolved right before each attempt.

## What tsundoku would still lack

None of this is built, and none of it is the engine's:

- **A film as a kind.** Today `series.kind` is manga, anime or novel — and
  [`KINDS.md`](KINDS.md) has the registry planned precisely _before_ movies and
  TV shows, so this is the card that registry waits for. A film is an anime
  whose source lists one episode named "Movie", which is how both working
  sources return one. It would draw as "1 EPISODE", offer NEXT at the end of
  itself, fold into a season head of one, and CONTINUE would treat it as a
  series of one. A film wants its own kind: one entry, no FOLLOW, no NEXT, its
  own shelf.
- **Seasons, and where they come from.** Both sources flatten: _Lupin (Season
  1–4)_ arrives as 25 episodes with no `season_number`, and so does a drama
  that is one season. [`ANIME.md`](ANIME.md) already reads a season from an
  episode's name, else from the entry's title (`seasonOfTitle`, c219) — a
  title that says "Season 1-4" is not one season, and a drama's flat list is
  one. So a show's seasons would have to be _known_ rather than parsed: from
  the source where it says, and from TMDB where it does not. `doc/WORKS.md`'s
  merged seasons (c215) assume one series per season, which is KickAssAnime's
  shape, not KissKH's.
- **Metadata.** AniList and MAL do not carry live-action titles, so the
  catalogue's one source (`src/lib/server/catalogue.ts`, `doc/LINKS.md`) has
  nothing to ask. TMDB is the only general answer (its API is free for a
  personal key, and it has films, series, seasons, episodes, posters and cast).
  That is a second catalogue, its own matching rules and its own NFO/folder
  naming (`Season 01`, `S01E01`), which the anime side already knows how to
  write.
- **Tracking.** AniList and MAL cannot record a live-action watch. Trakt and
  Simkl both can; Simkl also covers anime and films, and Trakt is the one
  Jellyfin and Kodi users already have. Either is a new signed-in integration
  beside the two the app has ([`TRACKING.md`](TRACKING.md)).
- **The kind's other doors.** Search, IN LIBRARY / SAME TITLE (a film and the
  book it adapts are not twins), the queue, the library's shelves and counts,
  Jellyfin export and RELEASE's bundle all switch on `kind` somewhere. A film
  or TV kind is not one field; it is the fourth case at every one of them
  (wave 5's rule: a value added must be checked against every place that
  switches on it).

## For comparison only

**Stremio addons.** Stremio's source protocol is an HTTP JSON one — an addon
serves `/manifest.json`, `/catalog/…`, `/meta/…` and `/stream/…`, and a client
resolves a stream from an id — which is simpler to speak than an Aniyomi APK
and needs no engine at all. What it does not solve is the stream: the popular
addons (Torrentio, ThePirateBay+, EZTV) return **torrent info-hashes**, so the
client needs a debrid account or a torrent client, and tsundoku — a reading
library on a tailnet — would be running a BitTorrent peer to watch a film.
The addons that return a plain HTTP stream exist (debrid-backed ones), and they
inherit the debrid subscription. For a library that already downloads and keeps
files, that is a different product: a torrent client, a debrid key and a
streaming UI, not "another extension".

**CloudStream plugins.** CloudStream's plugins are Android **dex** built against
CloudStream's own app API (its `MainAPI`, `ExtractorApi`, `LoadResponse` and
its `RequiresLiveData` / `SubtitleFile` shapes), so hosting them headless means
reimplementing that API on the JVM and giving it CloudStream's resolution
model — a second engine with a second extension format, beside the one tsundoku
already runs. It would be worth it only if CloudStream's repositories carried
film and TV sources that Aniyomi's do not; the ten tried here say the Aniyomi
family already has them, so a second extension format buys a second maintenance
burden and no new source.

## Recommendation

**Go-with-caveats**, and in this order:

1. **If the point is the owner's own library, the source already exists.**
   Jellyfin 14.17, from the official Aniyomi repository, installs today and
   takes a server address and a login. Films and TV already on the server play
   through the engine, with no scraper and no licensing question. What it
   cannot do is find something the server does not have.
2. **If the point is finding films and shows, the source side works, thinly.**
   Two of the ten English sources loaded play: KissKH (HLS, five subtitle sets,
   Asian drama and films) and Movies Mod (direct MKV files, dual audio,
   films and whole seasons). Both return a film as one episode, which the
   current anime model draws correctly enough to watch but not to call a film.
   The others are a mixed bag: two browse and serve no stream (AsiaFlix,
   PinoyMoviePedia), one cannot be reached (UHD Movies' certificate), one's
   popular is empty (KimoiTV), two were surveyed and not played (BLZone, My
   Running Man), and two are not film sources at all (MKissa is anime, WcoTv
   is children's animation). A user could install one and watch today;
   tsundoku would call it an anime.
3. **The blockers are tsundoku's, and they are the same four whatever the
   source:** a film is not a kind, a show's seasons are flattened, neither
   AniList nor MAL has live-action metadata, and neither can record a film
   watch. None of that is engine work, and none of it is small.

So: worth doing, but as a **Kinds** card (a film, a show) and a **metadata**
card (TMDB), not as a source card. The source side is ready enough to build
against, and Jellyfin makes it provable without depending on a scraper at all.

## Follow-up cards this would take

Created on 2026-11-12 as the cards in "Decided" above; the list is kept for
the reasoning behind them. What changed from this proposal: the film kind is
`movie` and the show kind is `show`; `storage` is deleted rather than set to
`jellyfin`; seasons are not stamped from TMDB; and a film franchise is a
Work, not a chain of its own.

1. **A film is a kind** (`kind = 'film'`): one entry, no FOLLOW, no NEXT, its
   own shelf and count, and every door that switches on `kind` taught the
   fourth case. Depends on nothing.
2. **A TV kind, and seasons it does not have to parse**: `kind = 'tv'`, and a
   season known from the source or from metadata rather than from a title;
   c215's merged seasons take it as a second shape.
3. **TMDB as a second catalogue**: search, details, seasons and episodes,
   posters, and the matching rules against a source's titles (which carry
   "[Hindi-English] 1080p" tails that no metadata service will match).
4. **Trakt or Simkl as a third tracker**: a live-action watch recorded, with
   the film/TV kinds above.
5. **A film/TV source's own quirks**: the download-site shape (files with
   `Range`, dual audio, embedded subtitles, episode URLs that are JSON) and the
   drama shape (HLS with five subtitle sets and a `Referer` that must be sent).
   Both are what `doc/EXTENSION-ENGINE.md`'s anime path already does, with the
   film's one episode and the show's seasons on top.
6. **Jellyfin as a source the owner can trust**: its preferences (address,
   login, up to ten libraries), its LAN address from inside the engine's
   container, and what it does with a film the server holds — the one path here
   that needs no unofficial site.

## How this was measured

```sh
# the development engine and its own solver (never the live one on 4590)
ENGINE_DATA=/mnt/hdd2/tsundoku/engine-dev-wave11 ENGINE_TOKEN=… \
  docker compose -f ops/engine/compose.yml up -d

# an APK: index entry → apk URL, then /dalvik with extensionInfo, then the calls
curl -sS https://raw.githubusercontent.com/mojuru/anime-repo/repo/index.min.json

# a 20 s pull, the first video with its audio (and a subtitle, where there is one)
ffmpeg -t 20 -headers $'User-Agent: …\r\nReferer: https://kisskh.ovh/\r\n' \
  -i <the video's URL> -i <the .srt> -map 0:v:0 -map 0:a:0 -map 1:s:0 \
  -c:v copy -c:a copy -c:s srt /mnt/hdd2/tsundoku/spike/kisskh-drama.mkv
```

The scratch files are in `/mnt/hdd2/tsundoku/spike/` (two 3–4 MB pulls and one
SRT); the engine's dev APK store is `/mnt/hdd2/tsundoku/engine-dev-wave11`, and
both containers were stopped afterwards. Nothing in `~/projects/tsundoku-engine`
changed: every source loaded and ran, so no Injekt entry was missing.
