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
eight English film/TV sources tried produced a stream that ffmpeg pulled with
audio (and, on one, five subtitle tracks), and both give a film back as a
single episode. The official repository also carries **Jellyfin**, which plays
the owner's own library and needs no scraper at all. What is missing is not a
source but tsundoku's model of one: a film is not a kind, a show's seasons are
flattened, and neither AniList nor MAL knows a live-action title, so metadata
and tracking have no source at all. The caveats are listed under "What
tsundoku would still lack", and the recommended follow-ups under "Follow-up
cards".

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
| mojuru/anime-repo | KissKH 16.10     | 16  | en   | kisskh.ovh         | Asian TV drama and films, by season and episode            | **Works**: HLS, 5 subtitle sets |     | mojuru/anime-repo | Movies Mod 16.4 | 16  | en  | moviesmod.zone | Films and TV seasons as download entries, Hindi + English | **Works**: direct MKV |
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
  waiting for the hoster ("Timed out waiting for MKissa to load the episode",
  the engine's 30 s hoster budget). The card's enquiry should not count it.
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
film and TV sources that Aniyomi's do not; the eight tried here say the Aniyomi
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
   Two of eight English sources tried play: KissKH (HLS, five subtitle sets,
   Asian drama and films) and Movies Mod (direct MKV files, dual audio,
   films and whole seasons). Both return a film as one episode, which the
   current anime model draws correctly enough to watch but not to call a film.
   The other six either browse and serve no stream (AsiaFlix,
   PinoyMoviePedia), cannot be reached (UHD Movies' certificate), or are not
   film sources at all (MKissa). A user could install one and watch today;
   tsundoku would call it an anime.
3. **The blockers are tsundoku's, and they are the same four whatever the
   source:** a film is not a kind, a show's seasons are flattened, neither
   AniList nor MAL has live-action metadata, and neither can record a film
   watch. None of that is engine work, and none of it is small.

So: worth doing, but as a **Kinds** card (a film, a show) and a **metadata**
card (TMDB), not as a source card. The source side is ready enough to build
against, and Jellyfin makes it provable without depending on a scraper at all.

## Follow-up cards this would take

Proposed, not created (the owner decides):

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
