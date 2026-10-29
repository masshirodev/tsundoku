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
| Streams: resolving an episode's videos, through tsundoku | c155 | Done    |
| The player                                               | c156 | Done    |
| Downloading episodes into a Jellyfin-shaped folder       | c157 | Done    |
| FOLLOW, and the tablet keeping the next episode          | c158 | Not yet |
| Live checks, departures and docs                         | c159 | Not yet |

Episodes play in the player (c156) since 2026-10-29; until then
`/read/<entry>` answered 404 for one, which is why nothing of anime was
deployed before it.

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

## Streams (c155)

An episode streams **through tsundoku** (`src/lib/server/anime/streams.ts`,
pure parts in `src/lib/library/streams.ts`): the browser has no route to the
engine, mustn't hold its token, and never asks a site ([`PRIVACY.md`](PRIVACY.md)).

- **`GET /api/anime/episode/<entry>/videos`** asks the engine's `getVideoList`
  (two minutes: hosters have 30 s each, and a first call through a challenge
  takes 20–45 s) and answers the player's **servers**: a video's quality reads
  "Hoster - 1080p" where the source has hosters, so each hoster is a server,
  numbered in the source's own order of preference (SERVER 1 OF 3), its
  videos its qualities, best first. Each quality carries its audio and
  subtitle tracks. The opening and ending come from the source's timestamps,
  and only from them; the ending's start is kept on the entry (`ending_at`),
  where an episode counts as watched. An answer is kept ten minutes;
  `?fresh=1` asks again (TRY AGAIN, and a stream that stopped: its address
  may simply have gone stale). A hidden series' episode is a 404 with reveal
  off. The engine not answering is a 503 saying `down`, so the player can say
  so without naming it.
- **Every address is a token**, `/api/anime/media/<token>`: an address and
  the headers the source asked for (OkHttp's `namesAndValues$okhttp`, read
  as a map), kept in memory, so a restart forgets them and the player
  resolves again. Only addresses the episode's videos handed over, and those
  inside playlists fetched from them, ever get one.
- **Playlists are rewritten** as they pass: every segment, variant, key,
  alternate audio and init map becomes a token, resolved against the
  playlist's own address (after redirects). An address that can't be
  written goes with the tag that introduced it.
- **Two ways to fetch.** The engine's own `/video/` proxy (AnimePahe's streams
  only work through it: the clearance cookies are the engine's) through
  ENGINE_URL with its token, unbuffered; anything else from the site with the
  source's headers, **internet only, every redirect too** (`net-guard.ts`), so
  a playlist can't aim the server at the workstation. An address is the
  engine's only when the engine named it: a site's playlist naming
  `http://127.0.0.1/video/…` is fetched as a site address, and refused.
  Segments stream through with their Range and content type (KickAssAnime's
  are MPEG-TS dressed as `.jpg`).
- **Subtitles**, `/api/anime/subtitle/<token>`, are always WebVTT: SubRip's
  commas become dots, SubStation's Dialogue lines become plain cues (the
  player draws its own style). Languages are read as codes (English, eng →
  EN).
- **A stream's weight** (`probe`): a master playlist's best BANDWIDTH and its
  media playlist's length, for ALL N's ABOUT sizes; getVideoList gives no
  bitrate.

`tests/streams.spec.ts` and `tests/anime-streams-db.spec.ts` (a fake engine
proxy and a fake site: servers and tokens with nothing of the engine or the
site in them, hidden, the engine's token and Range through it, the site's
headers, an inside address refused, a site's loopback address never the
engine's, WebVTT, the probe).

## The player (c156)

`/read/<entry>` for an episode, as for a chapter (`src/routes/read/[entry]/VideoPlayer.svelte`;
its decisions pure in `src/lib/library/player.ts`): Index Player, Player
States and Player Waiting. **The picture is the interface**: nothing on
screen but the video, and the subtitles, until a tap.

- **Playing.** HLS through [hls.js](https://github.com/video-dev/hls.js)
  (1.7.3, pinned) wherever the browser has Media Source, the browser's own
  HLS elsewhere; a file a hoster links to (an MP4, a WebM) plays as it is.
  Each episode is a player of its own (the page keys it), so NEXT starts
  afresh.
- **The chrome**, on a tap, gone after 4 s of playing (2 s after the mouse
  stops on a desktop): the reader's 64px top bar (← the series, the series
  and episode, "ANIME · S2 · EP. 7 OF 12 · 1:42 OF 24:00"), a 56px scrubber
  with buffered and watched over 64px cells (← EP. 6, what's playing, EP. 8
  →), and the one addition, −10 / pause / +10 in the middle, pause two drawn
  bars. The scrubber ticks the opening and ending. A desktop adds play, VOL,
  ? KEYS and FULL SCREEN · F, and a time on hover.
- **Taps**: one shows or hides the controls; a double-tap on the left or
  right third seeks 10 s, and each further tap in the burst 10 more, said in
  the middle of that side. No swipes: volume and brightness are the
  device's.
- **Keys**: space, ← →, ↑ ↓ (volume), F, M, C (subtitles), S (skip), N (next),
  Esc (full screen, then the player), ? (the KEYS sheet).
- **The settings sheet**, the middle cell ("JA · EN SUBS · 1080P · 1×"): a
  520px side sheet with the picture playing beside it. QUALITY (this
  server's), SERVER (the hosters by name, the one playing and the ones that
  stopped), AUDIO where there's a choice, SUBTITLES (OFF, each language, S M
  L; "IN THE PICTURE" where there are no tracks), SPEED, DIM. Audio and
  subtitles carry to every episode of the series, speed to this one, quality
  to this device (`localStorage`, a per-viewer convenience).
- **Subtitles** are drawn by tsundoku from the WebVTT: IBM Plex on a scrim
  box, rising above the controls while they show.
- **SKIP INTRO / SKIP ENDING** only where the source gave timestamps: alone
  for 8 s, then with the controls.
- **Resume**: RESUMED AT 9:28, with FROM 0:00, for 5 s; an episode past its
  ending's start (or its last 3 %) opens from 0:00.
- **Servers fail all the time.** A stall of 15 s, or a server that stops, moves
  to the next at the same second by itself; BUFFERING says what it waits on
  and offers SERVER 2 NOW →, and a switch says which stopped where. After the
  last, the list is asked for afresh once (a stream that stopped may have
  gone stale), then NO SERVER ANSWERED with TRY AGAIN.
- **Waiting**: FINDING THE VIDEO with the ink line and a count of seconds; a
  site's check named at once (`/api/browse/check/<source>`) with its known
  20–45 s range drawn as a scale, never a fill. The source service not
  answering is SOURCES NOT ANSWERING, without naming the engine.
- **The next episode** offers itself from the ending's start (or 30 s before
  the end): a card, STAY or PLAY NOW →. At the end, the NEXT page counts 5 s
  and plays it; STAY stops it. The last episode ends on END · LAST AVAILABLE.
- **Portrait** (a phone or tablet held upright) puts the picture on top, the
  controls always shown beneath it, and UP NEXT below; FULL goes full screen
  and turns it where the browser allows.
- **Watching is reading.** The player sends the reader's events
  (`/api/reading`): `page` is seconds into the episode, and `length` its
  length as the player measured it, which is how an episode learns its length
  (`duration_s`). Finished at the ending's start or the last 3 %. Incognito
  sends nothing. A hidden series plays inside the 4px reveal frame.
- **Separate audio** (KickAssAnime's) is named as alternate audio in a master
  playlist tsundoku writes (`serveMaster`), so the player switches it as any
  HLS stream's.

`tests/player.spec.ts`, `tests/anime-reading-db.spec.ts`, the separate-audio
and file tests in `tests/anime-streams-db.spec.ts`, and the player tests in
`tests/browse-anime.e2e.ts` (the fake engine's broken server passed over,
subtitles, SKIP INTRO, the frame's literals, the sheet, the NEXT page and
STAY, WATCHED on the series; portrait). The clip is
`tests/fixtures/video/clip.webm`, VP9 and Opus: Playwright's Chromium has no
H.264.

## Downloading (c157)

Streaming is the default; DOWNLOAD and SELECT keep episodes, for keeping a
series and for watching away from home (`src/lib/server/anime/download.ts`,
pure parts in `src/lib/library/anime-files.ts`).

- **Jellyfin's TV layout**, as the owner amended default 2, so a Jellyfin
  library can be pointed at the folder for watching on the TV:

  ```
  $LIBRARY_ROOT/Anime/<Series>/tvshow.nfo, poster.jpg
  $LIBRARY_ROOT/Anime/<Series>/Season 01/<Series> S01E07 <Title>.mkv, and its .nfo
  ```

  `Season NN` zero-padded; a source without seasons is season 1 with its own
  (absolute) numbers. The year Jellyfin likes after the name is left out:
  Aniyomi gives none, and a guess would be worse. A **hidden series goes under
  `Anime (hidden)/`**, never under the folder a Jellyfin library reads
  (Jellyfin has no reveal). The folder is fixed at the first download
  (`anime_series`, rung 48): files aren't renamed when a title is edited
  here, and a series hidden later keeps its folder.

- **One MKV an episode**: ffmpeg copies the video, each separate audio track
  and each subtitle track (as SubRip, which every player reads) into one
  Matroska file, each track tagged with its language, written beside its
  place and renamed. The NFOs are Jellyfin's (`tvshow`, `episodedetails`) and
  carry tsundoku's keys as `<uniqueid type="tsundoku">`, with AniList and MAL
  ids where the series is linked; `poster.jpg` is the library's own cover.
- **ffmpeg fetches nothing itself.** Its inputs are a loopback proxy inside
  the app that serves only the tokens `streams.ts` handed out, and only with a
  per-process secret header, so every request a download makes passes the
  same guard the player's do: internet only, the engine only where the engine
  named it. A playlist can't aim ffmpeg at the workstation.
- **Its own lane** of the one queue (`QueueRow.kind`, `'anime'`): one episode at
  a time beside the chapters' and novels' workers, so a 400 MB episode never
  holds up a 3 MB chapter. Streams are resolved right before (they go stale),
  each server's stream at the chosen height tried in the source's order, and
  ffmpeg's progress is the queue's share (DOWNLOADING · 38%). The DOWNLOADS
  screen draws EPISODES and CHAPTERS apart, each lane its own band.
- **Quality**: SETTINGS · EPISODES (1080P by default, 720P, 360P); ALL's
  confirmation asks again for its episodes, with each height's ABOUT size
  from the source's bitrate (`/api/anime/series/<id>/sizes`: one episode's
  playlists, BANDWIDTH times the length) and the room left on the disk. A
  height is kept per episode (`anime_episodes.quality`).
- **The importer** (`src/lib/server/import/anime.ts`, the scan's last step)
  reads every series folder with a tvshow.nfo tsundoku wrote and every episode
  with its .nfo, onto the `aniyomi:` series and episodes they name, through the
  one writer. A folder someone else put there is left alone. An episode file
  deleted from the folder is NOT DOWNLOADED again, and streams. Between the
  write and the import an episode is IMPORTING.
- **A downloaded copy always wins** (default 1): the player plays the file
  (`/api/anime/file/<entry>`, Range and all) and its subtitles out of it
  (`…/subtitle/<n>`, through ffmpeg), without asking the source at all, so it
  plays while the engine is down. If the file fails, TRY AGAIN streams.

`tests/anime-files.spec.ts`, `tests/anime-download-db.spec.ts` (the real
ffmpeg: a broken server passed over, VP9 and Opus and SubRip in one MKV with
its languages, the NFOs, the import, the file played first, the hidden
folder, a deleted file streaming again) and the c157 test in
`tests/browse-anime.e2e.ts` (FIRST 4 on the series screen, the episode lane,
the import, played from the file).

## Where it departs from the handoff

- **A tap on an episode plays it**, whatever its file. The handoff draws no
  row action; the reader's "the row is the button" (a tap queues a chapter
  with no file) would make streaming, the default, two taps away.
- **On a phone the picture goes** (below 600px): the handoff draws the tablet
  only, and at 360px the title is what's left otherwise.
- **The season head says only how many are watched**, not "12 OF 24 OUT":
  a source doesn't say how many episodes a season will have.
- **The player's portrait layout is any portrait**, a tablet's too, as Anime
  Calls says ("Portrait, on the phone or the tablet"); the handoff draws the
  phone's.
- **VOL is a cell, not a slider**: a tap mutes, ↑ ↓ set it. The handoff draws
  only its label.
- **The last episode's end is END · LAST AVAILABLE**, not the reader's
  end-of-series page with RATING: the series screen has the rating, and the
  player has no rating anywhere else.
- **No year in the folder name**: Jellyfin's `<Series> (<year>)` wants a year
  Aniyomi never gives.
- **The episode lane's band says a percentage**, not "156 / 410 MB · 6.1 MB/S":
  ffmpeg reports time, not bytes, and the size is an estimate.
- **No offline states yet**: an episode cached on the tablet, and the
  offline band, are c158's.
- **History names no season** ("EP. 7 · 9:28", not "S2 EP. 7 · 9:28"): the
  reading log keeps an entry's label, and a season is the episode's own field.

## What it does not do yet

Streams, the player, downloading and FOLLOW: the cards above. **No episode
pictures, lengths or FILLER/RECAP yet**: the engine's episode list carries
none of them (`JEpisode` is url, name, date, number, scanlator). A length
comes from the stream (c155) or the file (c157). **No LINK for anime**: the
catalogue search (AniList, MAL) asks for manga and novels only.
