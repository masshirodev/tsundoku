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
| An episode's opening and ending: AniSkip, fingerprints   | c239 | Done  |
| Linking an anime to its own entry, never its manga's     | c298 | Done  |
| Why an episode has no skip marks: the log and the link   | c299 | Done  |

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
- **Watched** (Anime Calls, "Resume"): at the ending's start where any finder
  gave one (the source, AniSkip or a fingerprint; "Openings and endings"),
  otherwise in the last 3 % (`isWatchedAt`; the player, c156, marks it).
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
  subtitle tracks. The opening and ending come from the source's timestamps
  when it gives them; AniSkip or a fingerprint fills what it leaves empty
  ("Openings and endings"). The best ending's start is kept on the entry
  (`ending_at`), where an episode counts as watched. An answer is kept ten minutes;
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
  EN; the whole rule is "The settings sheet", below).
- **One audio track per language the source names** (`onePerLanguage`):
  KickAssAnime lists every language twice, two playlists apiece (16 tracks
  for 8 languages), which doubled the player's menu and the download. The
  first listed is kept; differently named ones ("Spanish", "Spanish (Latin
  America)") are different tracks, ES and ES-419. Subtitles aren't folded:
  they're small, and two Spanish ones are usually two dialects; two names that
  still come to one code are ES and ES-2 (`trackCodes`).
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

## Openings and endings (c239)

The player's SKIP INTRO, SKIP ENDING, the NEXT card and the watched mark need
times the source almost never sends. Three finders supply them, **best
first**:

1. **The source's own timestamps**, as `getVideoList` gives them (c155). They
   are kept as a `source` row as soon as the streams resolve.
2. **AniSkip**, the community database of openings and endings.
3. **A fingerprint of the episodes themselves**, the Jellyfin Intro Skipper
   method: two episodes of a season share their opening and their ending, so
   the audio both have is one of them, wherever each episode's cold open puts
   it (c384).

**Precedence is per part**, not per episode: a source that gave an opening
and no ending still takes AniSkip's or the fingerprint's ending. The best
ending is written to `entries.ending_at`, which stays the one place the
player, the series screen and the server's watched mark read, so all three
finders feed "watched at the ending's start" the same way. **SKIP ENDING**
also marks the episode watched the moment it is pressed, rather than waiting
for the seek's next timeupdate (the owner's call, 2026-11-01). Without an
ending, the last 3 % still counts (`isWatchedAt`).

**Storage.** Rung 59, `episode_marks`: one row per episode and finder
(`source`, `aniskip`, `fingerprint`), with the opening and ending it found and
when it was tried. **A negative answer is a row too**, so an episode is not
asked again. Rung 47's source endings are copied in as `source` rows, so a
library that had them keeps them.

### AniSkip

`GET https://api.aniskip.com/v2/skip-times/<malId>/<episode>?types[]=op&types[]=ed&episodeLength=<seconds>`
answers `{found, results:[{interval:{startTime,endTime}, skipType:'op'|'ed'}]}`;
a 404 is "this episode has none". Only the MyAnimeList id, the episode number
and the length leave the app: no title, no account, no reading. `malId` is
the episode's own season's link (`series_season_links.mal_id`, `episodeEntry`
in `season-links.ts`; "Seasons", below; doc/TRACKING.md); **no anime link,
no lookup** (c395). AniSkip's ids are MyAnimeList **anime** ids, and MAL
numbers anime and manga apart, so a manga's id names an unrelated show:
asked under it, AniSkip would answer with that show's opening and ending,
and since AniSkip outranks a fingerprint, the episode would get a wrong SKIP
INTRO, a wrong SKIP ENDING and a wrong watched mark. So AniSkip is asked only
when the link's `format` is an anime's, by the kind registry
(`ownEntry` in `src/lib/server/anime/marks.ts`:
`sameKind(series.kind, candidateKind({ format }))`, the question c298's
LINKED TO THE WRONG KIND asks the other way round). A format the link
doesn't know (`NULL` until the resolve pass reads a Mihon tracker's MAL id,
or `''` when it found nothing) is not an anime's: `wrongKind` lets an
unknown format pass because it only flags a contradiction, and this has to
be sure. A link that isn't asked under writes no negative row, so the next
play after a relink asks at once. Ranma ½ (2024) was the case: linked to the
manga (MAL 23, a link from before c298), it had AniSkip asked about anime 23,
which answered nothing, by luck. `tvshow.nfo` follows the same rule
(Downloading): a manga's AniList and MAL ids are not handed to Jellyfin as
the show's. **Rung 64** forgot what the old rule stored: every `aniskip` row
of an anime whose link is not an anime format (a manga's, an unknown one, or
no link at all), with `entries.ending_at` recomputed; on the live library on
2026-11-03 that was no row, since the owner had already unlinked Ranma ½.
`episodeLength` is required by the API, so an episode whose length
no source, file or playlist has yet is probed once (c155's `probe`) and the
length is kept.

- **A hidden series is never looked up**, even while reveal is on: the one
  rule is in the SQL (`HIDDEN_SQL`). Incognito doesn't ask either.
- **Seasons.** AniSkip numbers episodes per MAL entry, and a MAL entry is one
  season. c240 links an anime a season at a time (`series_season_links`), and
  an episode is asked about under **its own season's** entry (c349,
  `episodeEntry`): season 2's EP. 3 under season 2's MAL id, season 1's EP. 3
  under season 1's. The episode number is the source's own within the season
  (`episode_number`; a flat list's position when it has none), and within
  the part for a season the catalogues split in two: the season's EP. 13 is
  part 2's EP. 1 under part 2's id. A season with no link of its own is not
  looked up, whatever another season has. The first-season mirror in
  `series_links` (`syncSeriesLink`) is not read: only a series with no season
  rows at all, linked before rung 62, is asked under its `series_links` link,
  for season 0 or 1 alone, since that one link is its first season's.
  Answers stored before c349 were asked under the mirror, which is the
  lowest season linked: right for a flat list, a pre-rung-62 link and a
  season 1 linked alone, but wrong for a season-1 episode of a show whose
  season 0 is linked too, and for part 2 of a split season 1 (asked under
  part 1's id with the season's number). A found answer is never asked
  again, so those stay until a rung forgets them (doc/handoff-notes/links.md,
  "Gaps"); a relink clears them now, as it always did.
- **Remembered.** A found answer is never asked again; a 404 is remembered
  for `ANISKIP_RETRY_MS` (7 days), since a running show's new episode may
  arrive late. A server that didn't answer is not remembered: the next
  resolve tries again.
- **A link set, changed or removed clears the series' AniSkip answers**,
  negatives included (c299): every door that writes a link
  (`link`, `linkFromTracker`, `linkFromList`, `unlink`, `undoLink`) deletes
  that series' `method = 'aniskip'` rows, so the next play asks with the new
  MAL id. Before, a 404 taken while the series was linked to the wrong entry
  kept AniSkip from being asked for a week. A series with no link is never
  asked at all, and writes no negative: `lookupAniSkip` returns before
  `saveAttempt` when `mal_id` is null (the live row that looked like one was
  written while the background pass's manga link was in place). The episodes'
  watched-at ending follows the marks that remain: clearing AniSkip's rows
  recomputes each affected episode's `entries.ending_at` and writes `NULL`
  when no mark is left, so an old entry's ending is never left behind to mark
  an episode watched early (or never).
- **Cost:** one small HTTP request per episode, once, on the resolve that
  plays it. It is awaited so the buttons are there on the first play; every
  later resolve is a database read.

`tests/anime-aniskip-db.spec.ts` (the request, the marks, hidden, no link,
seasons, no length, the 7-day retry, a failing server not remembered, and
since c395 a link to the manga made through LINK, and every AniList format
plus an unknown one, against a fake that answers any id with an opening),
`tests/anime-rungs-db.spec.ts` (rung 64), `tests/anime-download-db.spec.ts`
(the NFO's ids) and
`tests/anime-streams-db.spec.ts` (the player's resolve asks it once, and the
episode's `ending_at` follows).

### Fingerprints of downloaded episodes

`src/lib/library/fingerprint.ts` is the pure matcher; the server side is
`src/lib/server/anime/fingerprint.ts` and the season job in
`skip-marks.ts`.

- **What is read.** ffmpeg reads the first **25 % of the episode, capped at
  10 minutes**, and its **last 4 minutes**, and chromaprint turns each into
  32-bit points (about eight a second). Only a normal download's own file is
  read here: the source isn't asked.
- **How they are compared** (the rule since c384, 2026-11-03). Both windows
  are resampled to 8 points a second and shifted against each other: an
  opening **across its whole window**, since each episode's cold open moves
  it, and an ending by up to 180 s, since episodes differ in length. A point
  matches when it is within **6 bits**. A run is made of **streaks of at
  least 4 matching points in a row** (half a second), joined across **gaps of
  up to 3.5 s**, which count in its length, and is kept only when **at least
  70 % of its points** are in those streaks. The longest such run within
  **15–120 s** (an opening) or **15–180 s** (an ending) is the pair's span
  for both episodes. Openings and endings follow the same rule: the noise is
  the encode's, not the song's. A season needs **at least two episodes**
  with prints; one alone decides nothing and isn't remembered.
- **Why the rule is that** (c384). Ranma ½ (2024), streamed, had every
  opening found as a third to a half of the song (31–48 s of about 90) and
  episode 11's not at all. A run used to end at the first point past 6 bits,
  and two encodes of the same song, a 360p stream's audio especially, differ
  there at scattered points, so a 90 s opening came back in pieces and the
  longest piece won; and the opening could only shift 30 s, while that series
  put it at 30.75 s in one episode and 83.1 s in another. Bridging gaps is
  Jellyfin's Intro Skipper's method (its `MaximumTimeSkip`, 3.5 s). Bridging
  alone chains chance, though: two unrelated stretches of the db spec's pink
  noise match at 8–11 % of points, nearly once every 3.5 s, and in streaks of
  up to 3 s; the chains that made were 12–20 s at a density of 0.30–0.43,
  while a shared opening comes out at 0.97–1.00 and one with a bad point
  every 3 s at 0.96. Hence the streaks and the 70 %. Shifting across the
  whole window costs about 80 ms a pair (10-minute windows, 190 ms), so the
  season job yields to the app's requests between pairs.
- **Which span an episode keeps.** Each pair gives both of its episodes a
  span. Of an episode's spans the one **most of the others overlap** wins,
  and the longest of those (`agreedSpan`): one pair's chance run no longer
  decides an episode the rest disagree on. Until c384 the longest won.
- **What is kept.** The run's own times in each episode, as a `fingerprint`
  row. An episode whose pair found nothing gets a negative row, tried again
  after 14 days.
- **Cost:** seconds of ffmpeg a region, one episode at a time, in the
  background. A season's downloaded episodes are read when one of them is
  played; a hidden series is left alone, and incognito starts nothing.

**ffmpeg's chromaprint muxer is the way** (`-f chromaprint -fp_format raw`),
and every release bundle's pinned ffmpeg has it: BtbN's n8.1.3 LGPL build is
`--enable-chromaprint`, prints `E chromaprint Chromaprint` from `-muxers`, and
makes 27 points of a six-second tone, exactly as `fpcalc` does
([`RELEASE.md`](RELEASE.md), "Pinned"). This workstation's ffmpeg (Arch's
n9.0.1) is built without the muxer, so the extractor falls back to
**`fpcalc`**, chromaprint's own program from the `chromaprint` package, fed
the same audio through the same ffmpeg; the points are the same. Either way
`ffmpeg`/`ffprobe` are needed, and `fpcalc` only on a build without the
muxer; [`DISTRIBUTION.md`](DISTRIBUTION.md) lists them.

A missing `fpcalc` on a build without the muxer is said once in the log,
naming the chromaprint package and `FPCALC` ([`LOGS.md`](LOGS.md)).

`tests/fingerprint.spec.ts` (runs, bit errors, bounds, the two windows;
since c384 a 90 s opening with a bad point every 3 s, openings 55 s apart,
the gap's bound, chance too sparse to chain, a lone chance point, an
ending's bad points, and the agreed span) and
`tests/anime-fingerprint-db.spec.ts` (two synthesised episodes sharing an
opening and ending, the real ffmpeg and chromaprint, source precedence, a
hidden series, one episode, a negative remembered, the background queue,
and since c384 a 90 s opening behind 25 s and 80 s cold opens with the
second episode encoded at 12 kbps, which the strict rule found nothing of).

**Marks found before c384 were fragments, and rung 63 forgot them once**
(wave 18). An episode with a `fingerprint` row, found or negative, is not
read again (a negative only after 14 days), so the new matcher alone changed
nothing for an episode already marked: the owner's Ranma ½ (2024) kept
skipping into the middle of the song after wave 17. The rung deletes every
`fingerprint` row, negatives included, and recomputes `entries.ending_at`
from what remains, so the next play finds them under the rule above: a
fragment is worse than no mark, since SKIP INTRO lands in the middle of the
song and no mark shows no button at all. On the live library (a copy taken
2026-11-03, at v62) those were Ranma ½ (2024)'s eight rows, the library's
only ones, and all eight episodes' `ending_at` went to `NULL` with them (a
fingerprint was each one's only ending). On that copy, with the workstation's
engine, the season job then found, from the streams, every opening of
episodes 5 to 12 at **89.5 to 94.6 s** (31 to 48 s before, and episode 11's
for the first time; it starts between 11.6 s and 73.4 s, as each cold open
puts it) and every ending from **1294 to 1298 s** to the end of the episode
(before, six of the eight started near 1385 s, a fragment)
(`doc/handoff-notes/anime.md`, wave 18). The rung's spec is
`tests/anime-rungs-db.spec.ts`, which also checks its frozen copy of
`syncEndingAt` against the app's own rule on every entry.

### Fingerprints of streams

The same method, and the same matcher and rule (c384, above), for an
episode with no file, **only while it is being watched**: when the player resolves an episode, the background job takes the
playing episode, **the next two after it** and one more after those, so both
next episodes have a pair. It never runs for a season outside the one being
watched.

- **What is read.** The stream's **lowest quality**, preferring one at or
  below 480p, through the same loopback proxy downloads and pictures use
  (`loopback.ts`), so ffmpeg fetches nothing itself and the net guard still
  applies. A source that names nothing that low, or no height at all, gives
  its lowest instead: reading audio costs the same at any video height
  (c299). A **separate audio rendition** is preferred where the source offers
  one (KickAssAnime's); it is the smallest thing carrying the opening and
  ending.
- **What KickAssAnime answers** (measured live, 2026-11-02, through the
  engine): one server, `VidStreaming`, with qualities `1080p (1920x1080) -
3.52 Mbps`, `720p (1280x720) - 1.31 Mbps` and `360p (640x360) - 506 kbps`,
  each naming a separate audio rendition per language. Its heights are read
  from those labels, so 360p is what is fingerprinted. `tests/anime-stream-fingerprint-db.spec.ts`
  pins that shape, and the two fallbacks (no height anyone, nothing ≤480p).
- **Only the minutes it needs.** `-ss` before the input seeks, then `-t`
  bounds the read; ffmpeg fetches the segments it lands in, not the episode.
- **One at a time, and never beside a download.** The job reads one episode
  at a time. If a download of the **same source** is running, it stops and
  leaves no negative row, so a later play can try again. A server that fails
  says so in the log, naming the step and the server, and the next one **in
  the ranked order** is tried; the source's own server order only breaks a
  tie between servers of the same rank.
- **A server that fails isn't remembered.** Only a successful read that found
  no shared run is a negative, for the same 14 days.
- **It says what it did** (c299): one INFO line per season job (series,
  episode, how many in the season, how many to read) and per episode outcome
  (its file or stream, opening and ending found or not, and a negative kept),
  and a WARN for a step that failed — the resolve, the length probe, or the
  fingerprint — naming the episode and the server. The catches stay, so the
  player never waits; the log answers "why no skip on this episode"
  ([`LOGS.md`](LOGS.md)).

`tests/anime-stream-fingerprint-db.spec.ts` (the lowest 360p audio rather than
1080p, a separate audio track, a failing server passed over, no read during a
same-source download, the next-two window).

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
  PIP where the browser has picture-in-picture, ? KEYS and FULL SCREEN · F,
  and a time on hover, with the frame there above it (the seek preview,
  below).
- **Taps**: on a touch screen one shows or hides the controls; a double-tap
  on the left or right third seeks 10 s, and each further tap in the burst 10
  more, said in the middle of that side. On a mouse a click on the picture
  plays or pauses it (c218), the click in the middle acting at once and one on
  a side third waiting out the double that seeks; a press that wanders more
  than 10px is a drag, and neither. No swipes: on a touch screen volume and
  brightness are the device's (a pointer has VOL, below).
- **The controls come back on a move, not a jitter** (c217). A resting mouse
  sends a pixel or two of movement all the time, and the chrome flashed in on
  every one of them; it now takes 12px of travel — quickly from where the
  pointer was, or slowly from where the controls last left it. The middle
  cluster (`−10`, pause, `+10`) does not fade with the bars: it is solid from
  its first frame, where a half-faded black box over the picture read as a
  translucent patch.
- **Volume** (c385). VOL's label mutes, as before; hovering it (or clicking
  it) opens a slider above the cell, a column of the bar's surface with the
  scrubber's track upright, which a press or a drag sets; the wheel over the
  cell or the slider steps 5 %, ↑ ↓ 10 %. Every one of them goes through one
  door (`setVolume`), and the level is **remembered for this device**
  (`tsundoku:anime:volume`, a device setting like DIM and quality, mirrored
  on the workstation and listed in SETTINGS as VOLUME), read once as the
  player mounts and given to the picture before the stream starts, so the
  next episode and the next show start where it was left, from their first
  frame. **Mute is never kept**: a muted episode does not leave the next one
  silent. A level set above 0 while muted unmutes, since a slider moved under
  MUTED would otherwise change nothing anyone hears. The slider is a
  pointer's: on a phone the VOL cell stays hidden, and on a TV the remote's
  volume is the TV's, as before.
- **The seek preview** (c385). Over the scrubber, while the pointer is on it
  (and on a touch screen while the thumb is dragged), the tip with the time
  shows the frame at that time above it: 160 x 90, the hairline round it,
  the time in the label face under it, and kept inside the track at either
  end (`--tip-half`). Where it comes from:
  - **A downloaded episode**: a sprite sheet the workstation cuts from the
    file with ffmpeg, one frame every 10 s at 160 x 90, ten to a row, from the
    key frames only (seconds, not a full decode), once, in the background
    after the episode's first play (the videos route asks, never a page load,
    and incognito never does; a hidden series' episode gets one too, the file
    being local). It sits beside the episode's picture
    (`covers/episodes/<id>.sprite.jpg`, served by
    `/api/anime/sprite/<id>?v=<made at>`), with a sidecar naming the file it
    was cut from: its path, size and modification time. **A sprite is only
    the file's it was made from**: every reader asks `currentSprite`
    (`src/lib/server/anime/sprites.ts`), which deletes a sheet whose file
    changed (a re-download, MOVE), went (a deleted download, a scan) or is
    another entry's (an id SQLite reused), so no door has to remember it, and
    no rung was needed. The tile shown is the frame nearest the time, at most
    5 s off. Until the sheet exists the tip shows the time alone.
  - **A stream**: no sprite, which would mean reading the whole episode.
    The player keeps a second, hidden picture on the server's **lowest**
    quality, through the same loopback addresses, seeks it to the time under
    the pointer after it rests there 150 ms, and draws the frame to a canvas
    (`src/routes/read/[entry]/seek-preview.ts`). **It fetches only while the
    pointer is on the bar**: nothing until the first stop
    (`autoStartLoad: false`), then the one segment the time falls in (a
    buffer goal of 1 s, no back buffer), and `stopLoad()` once the frame is
    drawn and when the pointer leaves. Only the latest stop stops the load:
    a stop still waiting on a slow engine when the next begins gives up
    without stopping the next one's segment. A server whose lowest quality is
    above 480p, or of unknown height, and a stop that takes over 1 s show the
    time alone. A frame is shown only near the time it was drawn for (half a
    percent of the episode, at least a second; `nearFrame`): moved on, the
    tip shows the new time alone until that time's frame comes, never the
    last stop's picture over it.
  - **A TV** has no preview: the remote's ← → seek with the bar up shows the
    time on the bar, as before. The card left it optional; it is not built.
- **Keys**: space, ← →, ↑ ↓ (volume), F, M, C (subtitles), S (skip), N (next),
  Esc (full screen, then the player), ? (the KEYS sheet). A remote's media
  keys work on every device (c235): ▶❚❚ plays or pauses, ⏩ ⏪ seek 10 s,
  ⏭ the next episode and ⏮ the previous one — harmless where nothing sends
  them, and the only player keys a remote has ([`TV.md`](TV.md)).
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
  this episode's; quality, DIM and volume are this device's, mirrored on the
  workstation like every device setting. The sheet ends with ALL SETTINGS →.
- **The settings sheet's languages** (c386). A language is its short code
  everywhere in a row -- `JA`, `EN`, `PT-BR`, `ES-419`, `ZH-HANT`, `NB` -- and
  its name in full is the cell's `title` and accessible name ("Portuguese
  (Brazil)", "Norwegian Bokmål"). `langCode` (`src/lib/library/streams.ts`)
  reads whatever the source wrote ("Hungarian", "hun", "hu", "Magyar",
  "Chinese (Traditional)", "zh-TW", "Norwegian (nob)") against one table of
  about 75 languages, their ISO 639-2 letters and their own names; the
  variants a viewer actually picks between are kept (Brazilian Portuguese,
  Latin American Spanish, Traditional and Simplified Chinese, Canadian
  French), every other region is the language (`en-US` is EN). A name nobody
  knows is cut to a code of its own, with the name itself as the title, so
  no cell ever holds a whole word: its first word when that is two or three
  letters, else its first three letters (Klingon is KLI), in ASCII with the
  accents dropped. A cut that is itself an alias in the table is that
  alias's language (Indonesia cuts to IND, which is ID; China is ZH,
  Vietnam VI), and a label with no Latin letters left, blank or in another
  script ("Тагальский"), is UND, named Unknown when it is blank. So every
  code the sheet shows is one `langCode` gives back unchanged and one the
  workstation keeps as a choice (two or three capitals, then up to two
  parts: PT-BR, ES-419, UND-2). Two tracks of one list that still come to
  one code are told apart as ES and ES-2 (`trackCodes`). The server sends
  each track's code and name (`langName`); a downloaded file's tracks have
  codes alone, and the player names them from the code. **AUDIO and
  SUBTITLES are a grid of equal cells** (at least 60px wide, 44px high, the
  house tap size), as many to a line as fit -- six in the 520px sheet, four
  on a TV's 420px panel, three on a phone -- wrapping onto further lines,
  which a D-pad crosses as any grid. **Past twelve languages** a row shows
  only OFF, the one on, the series' or SETTINGS' choice, the device's
  language and English (for audio the original too), in the source's order,
  then **MORE · N**, which opens every language as a list in the same sheet,
  one a line, named in full with its code at the right. Picking from it
  closes it and puts focus on the pick's cell, which the row now shows;
  BACK closes the list before the sheet. Twelve is two lines of the sheet's
  six: past it the row grows taller than the rest of the sheet together (on
  a TV, three lines already), and the owner's VidStreaming episode had 11
  audio languages and a few dozen subtitles, so its audio wraps and its
  subtitles collapse. Until 2026-11-03 both rows were one segmented line,
  and a few dozen labels printed over each other; a name the short table
  did not know ("HUNGARIAN") showed whole, and the workstation refused to
  keep it as a choice (only two or three capitals passed), so it was never
  remembered. A remembered choice is the track that carries its code, as it
  is: ES-2 is the second Spanish, on the next episode and as the row's cell
  that is on, never the first (until round 2 of the fix the choice was read
  through `langCode` first, and ES-2 came back as ES). Only a choice no
  track carries is read again, as the track it meant (`matchLang`): one
  kept before 2026-11-03 named `PT` for what is PT-BR now and `HUN` for HU,
  so `PT` finds PT-BR, `HUN` finds HU, `IND` finds ID, and ES-2 finds ES
  where only one Spanish is offered. Downloads keep and tag
  tracks by the language alone, as before, since AUDIO KEPT names
  languages and Matroska's tag has no variant.
- **Subtitles** are drawn by tsundoku from the WebVTT: IBM Plex on a scrim
  box, rising above the controls while they show. The one place the browser
  may draw them instead is its own picture-in-picture (below), from a native
  `<track>` of the same WebVTT, which the page keeps showing but draws
  invisibly, so the page never shows a line twice.
- **Picture-in-picture** (c388). A video's own picture-in-picture moves only
  the `<video>`, so tsundoku's drawn subtitles stayed on the page. Now, by
  browser (`src/routes/read/[entry]/pip.ts`):
  - **Chrome and Edge on a desktop** (Document Picture-in-Picture, since
    116), **and Firefox 155** (which has it too, in a secure context, beside
    the video Picture-in-Picture API; Playwright's Firefox 155 runs this
    whole path in `tests/browse-player-pip-firefox.e2e.ts`): a **PIP** cell on the desktop's bar moves the picture layer -- the
    `<video>`, the drawn subtitles, the dim -- into a floating window of its
    own, with the page's stylesheets copied in (Svelte's scoped styles live
    there, and a node moved into another document no longer sees them), and
    the page says IN PICTURE-IN-PICTURE where the picture was. The subtitles
    keep tsundoku's face, scrim and S M L there; with no controls in the
    window they sit 7 % from its bottom, where the page puts them while the
    controls are hidden, and never rise. A subtitle change on the page (the
    sheet, C) shows in the window at once: it is the same element. The
    window answers on its own: a mouse's click on the picture plays or pauses
    it, as on the page, and the player's keys (Space, ← →, ↑ ↓, M, C, N) work
    with the window focused, except Escape, which brings the picture back
    rather than leaving the page behind it. It needs listeners of its own,
    added when it opens and removed when the picture comes back: the
    picture's pointer handlers are Svelte's delegated ones, heard on the
    page's root, and the keys are the page's window, so neither hears the
    floating window's document. There are no controls in it. Every way
    out puts the picture back in the page, the same `<video>` still playing:
    PIP · ON, the window's own close (its `pagehide`), and NEXT or leaving the
    page, which close the window too rather than leave it empty (a new
    window needs a press, so NEXT does not carry it over to the next
    episode). The browser's own PiP button keeps doing what it does, as
    below.
  - **A video's own picture-in-picture** (the browser's own PiP button or
    toggle anywhere, and the PIP cell where Document PiP is missing, as in
    Safari): the `<video>` alone goes. The subtitles chosen are on it as a
    native `<track kind="subtitles">` of the same WebVTT, `showing` all the
    time, so a PiP window has cues to read whether or not the browser tells
    the page it opened; the page draws those cues invisibly
    (`video.cueless::cue`, transparent), so tsundoku's line is the only one
    on the page, and plainly while the browser says its PiP has the picture
    (`enterpictureinpicture` to `leavepictureinpicture`). Subtitles off is
    no track at all; a language changed in PiP is the new track, shown at
    once. **Whether any browser's own PiP window draws that track is not
    checked**: Playwright opens one but cannot look into it. Firefox's PiP
    has a subtitles setting for showing tracks (its
    `media.videocontrols.picture-in-picture.display-text-tracks.enabled`
    pref, on by default), but nobody has watched it here; Chrome's own
    video PiP is not known to draw text tracks at all; Safari was not run.
    The owner's checks are in `doc/handoff-notes/anime.md`, wave 18,
    _Gaps_. What is tested is the page's side, in Chromium and Firefox: the
    track showing with its cue active, no native cue box on the page, and
    the plain drawing between enter and leave.
  - **A phone: not yet checked.** Android Chrome's picture-in-picture is the
    system's, and whether it draws a native track is not known; no slot has
    an Android phone, so nothing is claimed here (the check for the owner is
    in `doc/handoff-notes/anime.md`, wave 18, _Gaps_). The PIP cell is a
    desktop's; on a phone, the system's own PiP is the video's own path
    above.
  - **A TV** has no PIP cell.
- **SKIP INTRO / SKIP ENDING** wherever an opening or an ending is known --
  the source's, AniSkip's or a fingerprint's ("Openings and endings") --
  alone for 8 s, then with the controls. SKIP ENDING marks the episode
  watched as it is pressed.
- **On a TV** (c235; [`TV.md`](TV.md)) the controls are a D-pad row: the
  picture until a key, then focus on ▶❚❚ and all six cells on one line —
  ▶❚❚, −10, +10, ← EP. n, the cell naming the stream (which opens the
  settings), EP. n+1 → — under a 60px scrubber, inside the 28px safe margin.
  OK on the picture brings the bar and that focus; BACK hides it, then leaves
  for the series. SKIP INTRO, where offered, shows alone and OK takes it. The
  settings sheet is the 420px panel from the right that every sheet is there,
  with the picture playing at the left, and it keeps its focus when a server
  fails over and the rows redraw under it. Nothing changes off a TV: the
  cluster in the middle is the thumb's, and the player's own arrows stay the
  reader's when the bar is hidden.
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
  and turns it where the browser allows. **The scrubber under the picture
  seeks** (c387): a tap goes there, a drag follows the finger with the time
  under it shown over the picture, and the whole 44px row is the target, not
  the 4px line. It is a slider like the bar's (`role="slider"`, its aria
  values, ← → when focused), it takes the pointer itself (`touch-action:
none`), and it sits fixed under the picture with UP NEXT scrolling below it,
  so a drag never scrolls the page and its tip is never clipped. Until 2026-11-03
  it was drawn with no handlers at all, a picture of a scrubber. Both tracks
  measure the one the pointer is on (the hidden one is 0 wide), and the
  scrubber goes by the video's own length from its `durationchange`: before,
  it went by the episode's stored length until playback's first tick, so a
  seek before ▶ could land far off the file's real end.
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
STAY, WATCHED on the series; portrait), with the portrait scrubber's tap,
drag, hit area and tip at a 390×844 touch phone in
`tests/browse-player-portrait.e2e.ts`, and the sheet's languages (11 audio
and 30 subtitles, MORE, a pick remembered on the next episode) in
`tests/browse-player-languages.e2e.ts`, at the TV's 420px panel by D-pad in
`tests/tv-player.e2e.ts`, and their codes in `tests/streams.spec.ts`. The clip is
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
  those in a kept audio's language (`keptTracks`), by language alone: an
  ES-419 track is kept by ES and tagged `spa`. New downloads only. The file is each track tagged with its language, written beside its
  place and renamed. The NFOs are Jellyfin's (`tvshow`, `episodedetails`) and
  carry tsundoku's keys as `<uniqueid type="tsundoku">`, with AniList and MAL
  ids where the series is linked to an anime's entry (a manga's ids would
  have Jellyfin's plugins fetch another work, c395). They are the show's ids
  (`showEntry` in `season-links.ts`, c381): season 1's link, else the
  earliest season linked, part 1 first, read from the season rows, so a show
  with only season 2 linked names season 2's entry rather than none. A
  season linked to a manga is passed over for the next one that is an
  anime's. `series_links` answers only for a show linked before rung 62. An
  `.nfo` already written is rewritten at the series' next download.
  `poster.jpg` is the library's own cover.
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
- **VOL is a cell with a slider above it** (c385): its label mutes, as the
  handoff's cell did, and the slider rises from it on hover. The handoff
  draws only the label; the slider is drawn from the player's own cells
  and track, with no design round (the card's call: one control in place).
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
gives none, from a frame ("Episode pictures"). **AniSkip knows one
season of a show**: an anime links each season to its own AniList/MAL entry
(c240, doc/TRACKING.md), but AniSkip is asked about season 1's (or a flat
list's) only ("AniSkip", Seasons).
