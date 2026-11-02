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

| Part                                                     | Card | State |
| -------------------------------------------------------- | ---- | ----- |
| Anime as a kind, its series screen and the ANIME shelf   | c153 | Done  |
| Anime sources in BROWSE, the preview and ADD             | c154 | Done  |
| Streams: resolving an episode's videos, through tsundoku | c155 | Done  |
| The player                                               | c156 | Done  |
| Downloading episodes into a Jellyfin-shaped folder       | c157 | Done  |
| FOLLOW, and the tablet keeping the next episode          | c158 | Done  |
| Live checks, departures and docs                         | c159 | Done  |

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
| `thumb_url`      | its 16:9 picture at the source, where the extension gives one (c225)               |
| `thumb_at`       | when its picture was made on the workstation; NULL while it has none (rung 56)     |
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

**An episode plays straight from the preview**, without ADD, since
2026-10-29: the series becomes a browsing record, on no shelf until ADD
([`BROWSING.md`](BROWSING.md); card c161).

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
- **Covers**: the engine's `/image/` proxy as for manga. Since engine
  636a9d7 (2026-10-29) the engine wraps anime posters too, through the
  extension's own client: AnimePahe's poster host answers anything else with
  a Cloudflare 403, and its first posters after an engine restart wait out
  the solve (the cover route allows a minute). An address is the engine's
  only when it is the loopback one the engine handed out
  (`engineImageToken`): KickAssAnime's posters live at
  `https://kaa.lt/image/poster/…`, which once read as the engine's token
  "poster". A site's picture an older engine still hands back comes through
  the server (`/api/browse/novel-cover/<token>`, internet only), never to the
  browser.
- **The preview** says EPISODES ("4 EPISODES · EVERY ONE STREAMS · NOTHING
  DOWNLOADS UNTIL ASKED"), newest first, "S2 · Ep. 2 · Thaw".
- **ADD TO LIBRARY** (`engine/anime-source.ts`, `src/lib/import/anime-plan.ts`)
  writes an anime series through the one writer, which learned the episode
  columns: keyed `aniyomi:<source>:<url>`, its own prefix, so nothing that
  downloads chapters takes it for a manga; into the **Anime** root,
  `$LIBRARY_ROOT/Anime`; `series.source` the source's name, so the meta line
  reads "ANIME · ANIMEPAHE · ONGOING" as the handoff draws it; every episode
  NOT DOWNLOADED, known by its URL.
- **Seasons.** A season comes from the episode's own name where the engine
  flattens a source's seasons into one entry ("Season 2 - Episode 3"); where
  the source makes each season its own entry, as KickAssAnime and AnimePahe
  do, the entry's title or its slug says it ("… 3rd Season",
  `-season-3`), and that season is stamped on every episode that names none
  (`seasonOfTitle`, `anime-plan.ts`; rung 55, card c219). A source that says
  it neither way stays flat. Episodes are oldest first within a season,
  seasons in order; a number the source didn't give is read from the name,
  else placed by where the source listed it. The title is what's left after
  "Episode 3". The stamp is what the season heads, the fold, CONTINUE
  ("S3 · EP. 7"), the Jellyfin folder (`Season 03`) and the NFOs all read, so
  a season-3 entry is no longer indistinguishable from a season 1.
- **IN LIBRARY and SAME TITLE** match anime by their own key, and SAME TITLE
  only against other anime, never the manga it was adapted from; the queue tells
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

**NO SERVER is remembered.** A source that lists servers and sends no video,
or fails as a source, is recorded against that episode (`episode_failures`,
rung 57; never incognito). The series screen's NO VIDEO band and the player's
"not just this episode" line are counted from it, and `ANOTHER SOURCE →` opens
MOVE ([`MOVE.md`](MOVE.md)). The engine being down is not the source's
failure and isn't recorded.

**A moved season.** MOVE ([`MOVE.md`](MOVE.md)) takes a season-3 series to
another source by season and episode; a candidate that numbers every season as
one flat list takes an offset guessed from episode titles, editable on the
comparison. `PLAYS` is checked there for the one episode CONTINUE would play,
once a candidate is picked, and MOVE never waits on it.

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
  may simply have gone stale). **An empty answer never replaces a full one
  kept within those ten minutes**: a source asked again too soon answers with
  fewer videos or none (AnimePahe, live: 6, then 2, then 0, then 6 after 20 s),
  which isn't the episode losing its videos. An empty answer isn't kept. A hidden series' episode is a 404 with reveal
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
- **One audio track per language the source names** (`onePerLanguage`):
  KickAssAnime lists every language twice, two playlists apiece (16 tracks
  for 8 languages), which doubled the player's menu and the download. The
  first listed is kept; differently named ones ("Spanish", "Spanish (Latin
  America)") are different tracks. Subtitles aren't folded: they're small,
  and two ES ones are usually two dialects.
- **A stream's weight** (`probe`): a master playlist's best BANDWIDTH and its
  media playlist's length, for ALL N's ABOUT sizes; getVideoList gives no
  bitrate. tsundoku's own master (separate audio) is probed through the video
  it names, so KickAssAnime's episodes have a length and their download a
  share.

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
  with buffered (the range the playhead is in, drawn in text-2 so it shows
  over a picture) and watched over 64px cells (← EP. 6, what's playing, EP. 8
  →), and the one addition, −10 / pause / +10 in the middle, pause two drawn
  bars, which steps aside while BUFFERING or a server's notice holds the
  middle (they overlapped). The scrubber ticks the opening and ending. A desktop adds play, VOL,
  ? KEYS and FULL SCREEN · F, and a time on hover.
- **Taps**: on a touch screen one shows or hides the controls; a double-tap
  on the left or right third seeks 10 s, and each further tap in the burst 10
  more, said in the middle of that side. On a mouse a click on the picture
  plays or pauses it (c218), the click in the middle acting at once and one on
  a side third waiting out the double that seeks; a press that wanders more
  than 10px is a drag, and neither. No swipes: volume and brightness are the
  device's.
- **The controls come back on a move, not a jitter** (c217). A resting mouse
  sends a pixel or two of movement all the time, and the chrome flashed in on
  every one of them; it now takes 12px of travel — quickly from where the
  pointer was, or slowly from where the controls last left it. The middle
  cluster (`−10`, pause, `+10`) does not fade with the bars: it is solid from
  its first frame, where a half-faded black box over the picture read as a
  translucent patch.
- **Keys**: space, ← →, ↑ ↓ (volume), F, M, C (subtitles), S (skip), N (next),
  Esc (full screen, then the player), ? (the KEYS sheet).
- **The settings sheet**, the middle cell ("JA · EN SUBS · 1080P · 1×"): a
  520px side sheet with the picture playing beside it. QUALITY (this
  server's), SERVER (the hosters by name, the one playing and the ones that
  stopped), AUDIO where there's a choice, SUBTITLES (OFF, each language, S M
  L; "IN THE PICTURE" where there are no tracks), SPEED, DIM. Qualities are
  named by height (`2160P`, `qualityName`), never a source's
  "2160p (3840x2160) - 7.42 Mbps", and a server says "UP TO 2160P". Audio,
  subtitles and their size carry to every episode of the series **and, since
  2026-10-29, to every other anime**. Since c171 the workstation keeps them
  (`series_player`, rung 53; `server/anime/choices.ts`), so SETTINGS can set
  a default and list the series that differ ([`SETTINGS.md`](SETTINGS.md),
  "03 — Watching"). An episode starts on this series' choice, else SETTINGS'
  default, else the last choice on any anime, then the source's first audio
  track (its original, the owner's answer to c171's question 3) and
  subtitles in the device's language (`startTracks`), worked out again for
  each server until a choice is made. Incognito keeps no choice. Speed is
  this episode's; quality and DIM are this device's, mirrored on the
  workstation like every device setting. The sheet ends with ALL SETTINGS →.
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
  gone stale), then NO SERVER ANSWERED with TRY AGAIN. **With no server left
  to move to, a stall first drops one quality on the same server** (`stallStep`),
  at the same second, for this episode only, saying "1080P COULDN'T KEEP UP";
  BUFFERING names the drop and offers 720P NOW →. KickAssAnime has one server,
  and its 1080p runs at 20–34 Mbps through a heavy scene (Trigun Stargaze's
  first episode, 2:30–3:30, segments of 13–25 MB for 6 s against a label of
  4.58 Mbps): a link that couldn't carry it stalled there on every try. A
  fatal error still moves servers, never quality: that's a server broken,
  not a link too thin.
- **ANOTHER SOURCE →** comes before TRY AGAIN on every NO SERVER (never on
  SOURCES NOT ANSWERING, where the engine is down and every source would
  fail). When the same series has failed the same way on more than one
  episode, one line above the cells says so — `EPISODES 1, 2, 7 AND 8 FAILED
THE SAME WAY SINCE 1 NOV` — and the cell opens MOVE ([`MOVE.md`](MOVE.md)).
- **A reload never reports 0.** Switching server or quality, or asking the list
  afresh, destroys hls.js, and the emptied video reads 0 until the new stream
  is in. Until the video is back within 10 s of where it was heading
  (`reloadingTo`), that second is what the scrubber shows, what `page` and
  `close` send, and where a second failure picks up. Before, a stream that
  stopped and never came back sent 0, which wiped the episode's place: it
  opened from 0:00 again and stalled at the same scene, which read as
  "can't get past 3 minutes". A seek by hand ends the wait.
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
  Matroska file. **Which tracks** is SETTINGS' DOWNLOADING (card c160, since
  c171): every track by default, or the original (the source's first audio)
  and the languages chosen under AUDIO KEPT; subtitles all, or AS AUDIO for
  those in a kept audio's language (`keptTracks`). New downloads only. The file is each track tagged with its language, written beside its
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
  and a source that answers with no videos is asked again after 10 s and 30 s
  (`REASK_MS`) before the queue counts a try;
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
  deleted from the folder is NOT DOWNLOADED again, and streams. A finished
  episode attaches the moment it's written ([`DOWNLOADER.md`](DOWNLOADER.md),
  "Attaching"); IMPORTING is only what's waiting on a scan.
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

## Episode pictures (c225)

Neither installed source gives an episode a picture: KickAssAnime's and
AnimePahe's extensions never set Aniyomi's `SEpisode.preview_url` (checked in
their dex, 2026-11-01). So an episode's picture is made on the workstation
(`src/lib/server/anime/pictures.ts`; pure parts in
`src/lib/library/episode-pictures.ts`), from the best place it can, in order:

1. **The source's own**, where an extension sets one. The engine passes
   `preview_url` through its `/image/` proxy as it does posters (tsundoku-engine
   6478d0b, `bridgeEpisode`), and the plan keeps it as `thumb_url`. A token goes
   stale when the engine restarts, so it's fetched soon after the list arrives
   and kept as a file; one that no longer answers falls through to a frame.
2. **A frame of the downloaded file.**
3. **A frame of the stream**: the first server, its lowest quality (360P is a
   segment of a megabyte or two), the video alone for a separate-audio source
   (`videoOnly`). ffmpeg reads it through the loopback proxy that downloads use
   (`loopback.ts`), so it fetches nothing itself, with `-extension_picky 0`
   as a download's: the proxy's segments have no extension, and ffmpeg's HLS
   reader refuses those otherwise (found live on KickAssAnime, 2026-11-01:
   Trigun Stargaze's episode 2 came out a picture in 9.8 s once it was set).

A frame is taken a quarter in, past the opening; one that comes out dark or
flat (a fade, a title card: `isBlankFrame`) is taken again at 40 %, then 60 %.
Without a length, at 150, 300 and 480 s. The picture is cut to 16:9, 320×180
WebP (the list draws it at 96×54, the player's NEXT card at 128×72), kept as
`$COVER_DIR/episodes/<entry>.webp` and stamped `thumb_at`. It's served at
`/api/anime/thumb/<entry>?v=<thumb_at>`, kept as immutable; a hidden series'
episode is a 404 with reveal off. The stamp, not the file, says there is one,
so a file left by a deleted entry is never shown for a new one with its id.

**When**: one at a time, in the background, 1.5 s apart, for episodes without
one: on opening an anime's series screen (they show on the next visit), when
the player resolves an episode (not incognito), and when a download lands.
One that couldn't be made isn't tried again for six hours. The episode list
draws it over the striped placeholder, and so do the player's NEXT card and
UP NEXT rows.

`tests/anime-pictures-db.spec.ts` (a fake engine's picture, the fixture clip
as a file, as a stream through the loopback proxy and cut into HLS, a stale picture falling
through, a site on the workstation's network refused, the queue, the route
and reveal), `tests/episode-pictures.spec.ts`, and the plan's in
`tests/anime-plan.spec.ts`.

## FOLLOW (c158)

As for a manga and a novel (`src/lib/server/anime/follow.ts`): FOLLOW on an
anime's DOWNLOAD row asks its source at once, then every six hours with
FOLLOW's ten-minute step (whatever the engine's other halves did); when it
was last asked is `anime_checks` (rung 49), the row's CHECKED … AGO. An
episode the source lists that no entry is becomes one with ADD's own plan
through the one writer, and is queued in the episode lane unless watched,
fifty a run at most, oldest first. Places follow the source's order, so an
episode it inserted moves the ones after it. A source that fails isn't
recorded as asked.

**REFRESH** (card c220) is the look beside FOLLOW, on any anime in the library
with an installed source: `refreshSeries` (`src/lib/server/refresh.ts`) asks
the source once through `checkAnime` with `queue: false`, so new episodes
become entries and nothing downloads. The band says what arrived
([`DOWNLOADING.md`](DOWNLOADING.md), "REFRESH").

## Offline (c158)

Anime Calls 01, default 5: **while an episode plays, the device keeps the
next one** if it's downloaded on the workstation, from a 3 GB bucket of its
own beside the 2 GB of chapters (`tsundoku-episodes`; `keepEpisodes`,
`cacheEpisode` in `src/lib/cache/`), and lets this series' watched ones go.
↓ CACHE in SELECT keeps more by hand. What's kept is the file (streamed into
the cache, never into memory), its subtitles, the answer naming it, and the
player's page; the marker is written last, so a half-kept episode never
counts. The service worker answers the player's Range requests by slicing the
kept file ([`OFFLINE.md`](OFFLINE.md)). Nothing of a hidden series, nothing
while reveal is on, nothing incognito.

Offline (Player Waiting 3d): a kept episode plays under ○ OFFLINE · CACHED
STILL PLAYS; one that isn't says NOT ON THIS DEVICE · ○ NOT CACHED; the next
cell reads EP. 8 · NOT CACHED and is dimmed; the NEXT page never counts into
an episode that can't play. On the series screen, the rows the device doesn't
keep read NOT CACHED and dim.

`tests/episode-cache.spec.ts` (what's kept, its own budget and markers, the
Range slices) and the FOLLOW test in `tests/anime-source-db.spec.ts`.

## Live checks (c159)

On 2026-10-29, on a scratch library (`/mnt/hdd2/tmp`, an in-memory
database, its own APK store) against the real engine and Yuzono's repository
(`https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json`),
"frieren" searched, its first hit added, episode 1 streamed and downloaded at
360P, then the newest two episodes taken out and FOLLOW asked:

| Step                 | AnimePahe 16.56 (lib 16)                                     | KickAssAnime 14.63 (lib 14)                                                           |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Install              | 0.3 s, `isAnimeSource`                                       | 0.9 s, `isAnimeSource`                                                                |
| POPULAR / search     | 12 hits, 0.9 s / 3 hits, 0.4 s                               | 24 hits, 1.2 s / 3 hits, 0.6 s                                                        |
| Preview, ADD         | 28 episodes, COMPLETED; ADD 0.3 s                            | 28 episodes, COMPLETED; ADD 2.4 s, titled episodes                                    |
| Servers              | SEV (Sub), SEV (English); 1080/720/360 each, all 200, 1561 s | VidStreaming; 1080/720/360, 8 audio languages, 9 subtitles, all 200, 1560 s           |
| Download, 360P       | one MKV, H.264 + AAC, 26:01, 45 MB                           | one MKV, H.264, 8 AAC tracks tagged jpn hin tam eng ger spa fre por, 9 SubRip, 310 MB |
| Import, then playing | Ep. 1 available, plays from DOWNLOADED                       | the same                                                                              |
| FOLLOW               | 2 queued, 28 of 28 back                                      | 2 queued, 28 of 28 back                                                               |

What the first run found, all fixed and tested before this table was
measured:

- **AnimePahe answered no videos when asked again soon** (6, 2, 0, then 6
  after a 20 s pause), so a download right after playing failed in 0.3 s with
  "No server answered". The kept answer stands against an empty one, and the
  download asks again before counting a try (Streams, Downloading).
- **KickAssAnime named every language twice**: 16 audio tracks, 700 MB for a
  360P episode, JA twice in the menu. One per language now: 310 MB.
- **Hindi and Tamil were `und`** in the file; Korean, Hindi, Tamil, Telugu,
  Thai, Vietnamese, Turkish and Polish are codes now, both ways.
- **KickAssAnime's episodes had no length**, so their download showed no
  share: the probe didn't follow tsundoku's own master playlist.

Not checked live: **a server failing over** (both sources' servers all
answered; the order is in `tests/anime-download-db.spec.ts` and the player's
`nextServer`), the **poster** (a bare script doesn't run the cover refresh),
and the player itself in a browser against a live source (the e2e runs it on
the fixture clip). The scratch library was deleted afterwards.

## Where it departs from the handoff

- **A click on the picture plays or pauses on a mouse** (c218), where Anime
  Calls draws one tap as show-or-hide the controls. On a desktop that tap is
  the biggest thing on screen, and every video player's is a play/pause; the
  controls are reached by moving the pointer instead. A touch screen keeps the
  handoff's tap, since there is no pointer to move.
- **A tap on an episode plays it**, whatever its file. The handoff draws no
  row action; the reader's "the row is the button" (a tap queues a chapter
  with no file) would make streaming, the default, two taps away.
- **On a phone the picture goes** (below 600px): the handoff draws the tablet
  only, and at 360px the title is what's left otherwise.
- **The season head says only how many are watched**, not "12 OF 24 OUT":
  a source doesn't say how many episodes a season will have.
- **A one-season series may draw a season head**, where the source named the
  season in the entry ("SEASON 3 · EP. 1 – 10"). The handoff draws heads only
  where a list holds several seasons, but on a season-3 entry the alternative
  is a screen with nothing on it saying season 3 (c219).
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
- **History names no season** ("EP. 7 · 9:28", not "S2 EP. 7 · 9:28"): the
  reading log keeps an entry's label, and a season is the episode's own field.

## What it does not do yet

**Every audio language is downloaded**: KickAssAnime's eight make a 360P
episode 310 MB where the video alone is about 95 MB. Keeping only some
(the original and the one the device asks for, say) is the owner's call, on
the board. **AnimePahe's videos only download through the engine** (its
clearance cookies), which forgets every token on restart: a download that
spans a restart fails and is tried again. **No lengths or FILLER/RECAP from
the source yet**: the engine's episode list carries neither (`JEpisode` is
url, name, date, number, scanlator, and its picture since c225). A length
comes from the stream (c155) or the file (c157); a picture, where the source
gives none, from a frame ("Episode pictures"). **No LINK for anime**: the
catalogue search (AniList, MAL) asks for manga and novels only.
