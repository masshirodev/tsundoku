# Anime

Anime from Aniyomi's extensions, found, streamed, downloaded and watched
inside tsundoku, as manga runs on Mihon's and novels on LNReader's
([`DOWNLOADS.md`](DOWNLOADS.md), [`NOVELS.md`](NOVELS.md)). An anime is a
series of its own kind, its episodes are entries, and an episode plays in
tsundoku's own player, from a file on the workstation when there is one and
streamed through tsundoku otherwise. Films and live-action shows share the
player and the folders; they are described in
[`FILMS-SHOWS.md`](FILMS-SHOWS.md).

## Anime as a kind

A series of kind `anime` is **episodes** (migration 47). An episode is an
entry, so everything that counts chapters counts episodes (READ is WATCHED on
its screens), with what a chapter doesn't have:

| Column           | What                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| `duration_s`     | its length, seconds; NULL until a source or a file says                             |
| `season`         | the source's season; NULL for a flat list (most of Aniyomi's)                       |
| `episode_number` | its number as the source gives it, which starts again each season                   |
| `episode_note`   | `filler` or `recap`, where the source says so                                       |
| `thumb_url`      | its 16:9 picture at the source, where the extension gives one                       |
| `thumb_at`       | when its picture was made on the workstation; NULL while it has none (migration 56) |
| `ending_at`      | where its ending starts, seconds (see "Openings and endings")                       |
| `last_position`  | for an episode, **seconds** into it, not a page (and the reading log's `page` too)  |

`position` stays the order across the whole series, unique as a chapter's,
so nothing that reads positions (the duplicate collapse, the reader's next)
ever meets two "EP. 1"s; `episode_number` is what the screens show.

**Migration 47 edits the schema's text.** `anime` had to join `series.kind`'s
CHECK, which SQLite can't change in place, and the usual way round (a new
table, the rows copied, the old one dropped) would, with foreign keys on,
cascade the drop through every table that references a series: the whole
library. A CHECK that allows more changes nothing stored, which is the case
SQLite's documentation gives for editing the schema instead (`lang_altertable`,
"Making Other Kinds Of Table Schema Changes"): `writable_schema`, the schema
version moved on, an integrity check before the migration commits.
better-sqlite3 opens connections defensive, which forbids that, so unsafe mode
is on for those few statements only. The migration refuses to run on a
`series` table whose CHECK isn't the one it expects. It is written as code
(`MIGRATIONS` takes a function where SQL can't say it). Run on a copy of a
real library of 81,922 entries: integrity ok, no foreign-key violation, every
entry kept. `tests/migrate-anime-db.spec.ts`.

## The words (`src/lib/library/anime.ts`)

Pure, and what every screen reads (`tests/anime.spec.ts`):

- **Status**: WATCHED; "14:32 LEFT" for the one part-watched; its size when
  it's on the workstation; NOT DOWNLOADED otherwise, which is a fact, not a
  warning: those episodes stream.
- **Watched**: at the ending's start where any finder gave one (the source,
  AniSkip or a fingerprint; "Openings and endings"), otherwise in the last
  3 % (`isWatchedAt`; the player marks it).
- **Seasons** are groups, headed "SEASON 2 · EP. 1 – 12", "6 WATCHED"; a
  season watched through folds into one row, "↑ SEASON 1 · EP. 1 – 12",
  "12 WATCHED · SHOW", unless the episode being watched is in it. A list
  without seasons stays flat. The head says only how many are watched, never
  "12 OF 24 OUT": a source doesn't say how many episodes a season will have.
  A one-season series draws a head too where the source named the season in
  the entry ("SEASON 3 · EP. 1 – 10"), since otherwise nothing on a season-3
  entry's screen would say season 3.
- **CONTINUE**: "▶ CONTINUE · S2 · EP. 7 · 14:32 LEFT"; START "EP. 1 ·
  STREAMS" on a series not begun whose first episode has no file; WATCH
  AGAIN once everything is watched.
- **The library's CONTINUE**: "ANIME · S2 EP. 7 · 14:32 LEFT", and the bar is
  the episode's (39 % of EP. 7), not the series' share watched.
- **History**: episodes count as chapters, "ANIME · EP. 3 → 5 · 9:28", the time
  where an episode was left part-way. It names no season ("EP. 7 · 9:28", not
  "S2 EP. 7 · 9:28"): the reading log keeps an entry's label, and a season is
  the episode's own field.
- **Sizes** are ABOUT, from a stream's bitrate times the length
  (`aboutBytes`): Aniyomi's video list gives no bitrate, so it is read from
  the HLS master playlist's BANDWIDTH ("Streams").

## The screens

- **The library**: an ANIME cell on the KIND band while the shelf has anime
  beside another kind (or ANIME is chosen), as every kind (`kindCounts`,
  `server/library.ts`). A shelf of one kind draws ALL alone.
- **The series screen**: the meta line "ANIME · ANIMEPAHE · ONGOING", the
  count "24 EPISODES · 2 SEASONS · 18 WATCHED" under the titles, RATING, FAV,
  CONTINUE, DOWNLOAD, SHELVES, LINK, FILE. No DIRECTION row, and no OCR or
  words rows: a video has neither a reading direction nor pages. ▶ is never
  dimmed for a missing file: an episode streams.
- **The list** (`src/routes/series/[id]/EpisodeList.svelte`): 72px rows, the
  number in a 64px column, a 96×54 picture (the episode's own, "Episode
  pictures", over the cover's stripes until it has one), the title over its
  length and FILLER or RECAP, a 2px bar on the one part-watched, the status,
  ↓ for an episode cached on the device. On a phone (below 600px) the
  picture goes, since at 360px the title would be all that's left. # finds
  an episode by its number in the season being watched first. **A tap plays
  any episode**, whatever its file: the reader's rule that a tap on a
  chapter with no file queues it would put streaming, the default, two taps
  away; downloading is the DOWNLOAD row's and SELECT's. A long press marks it
  and everything before it watched, as for chapters. Linked to AniList, it
  also draws the seasons before it, NEXT SEASON and the extras as dim heads,
  from the relation cache ([`SERIES.md`](SERIES.md), "The seasons around
  it").

`tests/browse-anime.e2e.ts`, on the browse server's seeded "Tsukiakari no
Ryokōsha" (`tests/browse-setup.ts`), pins the shelf, CONTINUE, the count, the
season fold and heads, each status, and the list's measurements.

## Finding and adding

**An episode plays straight from the preview**, without ADD: the series
becomes a browsing record, on no shelf until ADD
([`READING-ONLINE.md`](READING-ONLINE.md)).

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
- **Covers**: the engine's `/image/` proxy as for manga. The engine wraps
  anime posters too, through the extension's own client: AnimePahe's poster
  host answers anything else with a Cloudflare 403, and its first posters
  after an engine restart wait out the solve (the cover route allows a
  minute). An address is the engine's only when it is the loopback one the
  engine handed out (`engineImageToken`): KickAssAnime's posters live at
  `https://kaa.lt/image/poster/…`, which would otherwise read as the engine's
  token "poster". A site's picture an older engine still hands back comes
  through the server (`/api/browse/novel-cover/<token>`, internet only),
  never to the browser.
- **The preview** says EPISODES ("4 EPISODES · EVERY ONE STREAMS · NOTHING
  DOWNLOADS UNTIL ASKED"), newest first, "S2 · Ep. 2 · Thaw".
- **ADD TO LIBRARY** (`engine/anime-source.ts`, `src/lib/import/anime-plan.ts`)
  writes an anime series through the one writer, which knows the episode
  columns: keyed `aniyomi:<source>:<url>`, its own prefix, so nothing that
  downloads chapters takes it for a manga; into the **Anime** root,
  `$LIBRARY_ROOT/Anime`; `series.source` the source's name, so the meta line
  reads "ANIME · ANIMEPAHE · ONGOING"; every episode NOT DOWNLOADED, known by
  its URL.
- **Seasons.** A season comes from the episode's own name where the engine
  flattens a source's seasons into one entry ("Season 2 - Episode 3", or with
  no dash when the episode follows the season straight away, "Season 4 Ep 8",
  as Movies Mod's packs name them); where the source makes each season its
  own entry, as KickAssAnime and AnimePahe do, the entry's title or its slug
  says it ("… 3rd Season", `-season-3`), and that season is stamped on every
  episode that names none (`seasonOfTitle`, `anime-plan.ts`; migration 55).
  **A pack of seasons is no one season**: an entry titled "Lupin (Season
  1-4)" (or "Seasons 1 to 3", "S1-S4", a `-season-1-4` slug) stamps none,
  since read as its first it would put all four seasons' episodes in season 1
  and the list would come out interleaved by number. Its episodes' own names
  give their seasons, and a pack whose episodes name none stays flat. A
  source that says it neither way stays flat. Episodes are oldest first
  within a season, seasons in order; a number the source didn't give is read
  from the name, else placed by where the source listed it. The title is
  what's left after "Episode 3". The stamp is what the season heads, the
  fold, CONTINUE ("S3 · EP. 7"), the Jellyfin folder (`Season 03`) and the
  NFOs all read, so a season-3 entry is never mistaken for a season 1. A
  season whose only row is an orphaned part 2 ([`LINKS.md`](LINKS.md)) asks
  nothing either: nothing places its episodes.
- **IN LIBRARY and SAME TITLE** match anime by their own key, and SAME TITLE
  only against other anime, never the manga it was adapted from; the queue
  tells an anime's rows apart by it too (`QueueRow.kind`), so the engine's
  chapter worker never takes an episode.

`tests/anime-plan.spec.ts`, `tests/anime-source-db.spec.ts` (BROWSE's ANIME
rows and the anime calls, covers, the preview, ADD by season, IN LIBRARY,
search) and the browsing test in `tests/browse-anime.e2e.ts` (a source on the
fake engine, browsed, previewed, added).

## Streams

An episode streams **through tsundoku** (`src/lib/server/anime/streams.ts`,
pure parts in `src/lib/library/streams.ts`): the browser has no route to the
engine, mustn't hold its token, and never asks a site ([`PRIVACY.md`](PRIVACY.md)).

**Whether an episode streams, without asking**: `streamsOnline`
(`src/lib/server/pages/online.ts`) answers what `episodeStreams` checks before
it calls the source: no file, an Aniyomi key, the episode's own address at the
source, and an installed extension serving its source (its `origin_source`
when it was kept from a source the series left). The end page asks it for a
Work's next part, so `▶ WATCH ONLINE · EP. 1` and `STREAMS FROM <SOURCE>` say
what the player would do ([`WORKS.md`](WORKS.md)). It is not `readsOnline`,
which is the image reader's question for a chapter's pages.

**NO SERVER is remembered.** A source that lists servers and sends no video,
or fails as a source, is recorded against that episode (`episode_failures`,
migration 57; never incognito). The series screen's NO VIDEO band and the
player's "not just this episode" line are counted from it, and
`ANOTHER SOURCE →` opens MOVE ([`MOVE.md`](MOVE.md)). The engine being down is
not the source's failure and isn't recorded.

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
  (`ending_at`), where an episode counts as watched. An answer is kept ten
  minutes; `?fresh=1` asks again (TRY AGAIN, and a stream that stopped: its
  address may simply have gone stale). **An empty answer never replaces a
  full one kept within those ten minutes**: a source asked again too soon
  answers with fewer videos or none (AnimePahe, measured: 6, then 2, then 0,
  then 6 after 20 s), which isn't the episode losing its videos. An empty
  answer isn't kept. A hidden series' episode is a 404 with reveal off. The
  engine not answering is a 503 saying `down`, so the player can say so
  without naming it.
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
  EN; the whole rule is "The settings sheet's languages", below).
- **One audio track per language the source names** (`onePerLanguage`):
  KickAssAnime lists every language twice, two playlists apiece (16 tracks
  for 8 languages), which would double the player's menu and the download
  (700 MB for a 360P episode against 310 MB). The first listed is kept;
  differently named ones ("Spanish", "Spanish (Latin America)") are different
  tracks, ES and ES-419. Subtitles aren't folded: they're small, and two
  Spanish ones are usually two dialects; two names that still come to one
  code are ES and ES-2 (`trackCodes`).
- **A stream's weight** (`probe`): a master playlist's best BANDWIDTH and its
  media playlist's length, for ALL N's ABOUT sizes; getVideoList gives no
  bitrate. tsundoku's own master (separate audio) is probed through the video
  it names, so KickAssAnime's episodes have a length and their download a
  share.
- **Separate audio** (KickAssAnime's) is named as alternate audio in a master
  playlist tsundoku writes (`serveMaster`), so the player switches it as any
  HLS stream's.

`tests/streams.spec.ts` and `tests/anime-streams-db.spec.ts` (a fake engine
proxy and a fake site: servers and tokens with nothing of the engine or the
site in them, hidden, the engine's token and Range through it, the site's
headers, an inside address refused, a site's loopback address never the
engine's, WebVTT, the probe).

## Openings and endings

The player's SKIP INTRO, SKIP ENDING, the NEXT card and the watched mark need
times the source almost never sends. Three finders supply them, **best
first**:

1. **The source's own timestamps**, as `getVideoList` gives them. They are
   kept as a `source` row as soon as the streams resolve.
2. **AniSkip**, the community database of openings and endings.
3. **A fingerprint of the episodes themselves**, the Jellyfin Intro Skipper
   method: two episodes of a season share their opening and their ending, so
   the audio both have is one of them, wherever each episode's cold open puts
   it.

**Precedence is per part**, not per episode: a source that gave an opening
and no ending still takes AniSkip's or the fingerprint's ending. The best
ending is written to `entries.ending_at`, which stays the one place the
player, the series screen and the server's watched mark read, so all three
finders feed "watched at the ending's start" the same way. **SKIP ENDING**
also marks the episode watched the moment it is pressed, rather than waiting
for the seek's next timeupdate. Without an ending, the last 3 % still counts
(`isWatchedAt`).

**Marked watched sends.** An episode's watched mark (the ending's start,
SKIP ENDING, the last 3 % without an ending, or the end of the video) is a
chapter finished as far as tracking is concerned: the player sends `finish`,
and the server queues that **season's** highest watched episode, counted
within its part, for AniList and MAL, and the work's unit for Ranobe, the
reading catalogue at `ranobe.ink` that tsundoku keeps up to date
([`TRACKING.md`](TRACKING.md), "Sending"; [`RANOBE.md`](RANOBE.md), "Anime").
A recap and a half number are never sent. Incognito records nothing, so
nothing is sent.

**Storage.** Migration 60, `episode_marks`: one row per episode and finder
(`source`, `aniskip`, `fingerprint`), with the opening and ending it found and
when it was tried. **A negative answer is a row too**, so an episode is not
asked again. The source endings migration 47 stored on entries are copied in
as `source` rows, so a library that had them keeps them.

### AniSkip

`GET https://api.aniskip.com/v2/skip-times/<malId>/<episode>?types[]=op&types[]=ed&episodeLength=<seconds>`
answers `{found, results:[{interval:{startTime,endTime}, skipType:'op'|'ed'}]}`;
a 404 is "this episode has none". Only the MyAnimeList id, the episode number
and the length leave the app: no title, no account, no reading. `malId` is
the episode's own season's link (`series_season_links.mal_id`, `episodeEntry`
in `season-links.ts`; "Seasons", below; [`TRACKING.md`](TRACKING.md)); **no
anime link, no lookup**. AniSkip's ids are MyAnimeList **anime** ids, and MAL
numbers anime and manga apart, so a manga's id names an unrelated show:
asked under it, AniSkip would answer with that show's opening and ending,
and since AniSkip outranks a fingerprint, the episode would get a wrong SKIP
INTRO, a wrong SKIP ENDING and a wrong watched mark. So AniSkip is asked only
when the link's `format` is an anime's, by the kind registry
(`ownEntry` in `src/lib/server/anime/marks.ts`:
`sameKind(series.kind, candidateKind({ format }))`, the question LINKED TO
THE WRONG KIND asks the other way round). A format the link doesn't know
(`NULL` until the resolve pass reads a Mihon tracker's MAL id, or `''` when it
found nothing) is not an anime's: `wrongKind` lets an unknown format pass
because it only flags a contradiction, and this has to be sure. A link that
isn't asked under writes no negative row, so the next play after a relink
asks at once. `tvshow.nfo` follows the same rule ("Downloading"): a manga's
AniList and MAL ids are not handed to Jellyfin as the show's. **Migration 64**
deletes the answers stored without that check: every `aniskip` row of an
anime whose link is not an anime format (a manga's, an unknown one, or no
link at all), with `entries.ending_at` recomputed. `episodeLength` is
required by the API, so an episode whose length no source, file or playlist
has yet is probed once (the streams' `probe`) and the length is kept.

- **A hidden series is never looked up**, even while reveal is on: the one
  rule is in the SQL (`HIDDEN_SQL`). Incognito doesn't ask either.
- **Seasons.** AniSkip numbers episodes per MAL entry, and a MAL entry is one
  season. An anime is linked a season at a time (`series_season_links`), and
  an episode is asked about under **its own season's** entry
  (`episodeEntry`): season 2's EP. 3 under season 2's MAL id, season 1's
  EP. 3 under season 1's. The episode number is the source's own within the
  season (`episode_number`; a flat list's position when it has none), and
  within the part for a season the catalogues split in two: the season's
  EP. 13 is part 2's EP. 1 under part 2's id. A season with no link of its
  own is not looked up, whatever another season has. The first-season mirror
  in `series_links` (`syncSeriesLink`) is not read: only a series with no
  season rows at all is asked under its `series_links` link, for season 0 or
  1 alone, and after migration 68 no anime is such a series: a link made
  before season links existed (migration 62) is its season's row. **Migration
  67** deletes answers that were asked under the mirror, the lowest season
  linked, found or not: wrong for a season-1 episode of a show whose season 0
  is linked too, for a season-0 episode while only season 1 is, and for part
  2 of a split season (asked under part 1's id with the season's number).
  Each is asked again on its next play; a relink clears them too.
- **Remembered.** A found answer is never asked again; a 404 is remembered
  for `ANISKIP_RETRY_MS` (7 days), since a running show's new episode may
  arrive late. A server that didn't answer is not remembered: the next
  resolve tries again.
- **A link set, changed or removed clears the series' AniSkip answers**,
  negatives included: every function that writes a link (`link`,
  `linkFromTracker`, `linkFromList`, `unlink`, `undoLink`) deletes that
  series' `method = 'aniskip'` rows, so the next play asks with the new MAL
  id, and a 404 taken while the series was linked to the wrong entry doesn't
  keep AniSkip from being asked for a week. A series with no link is never
  asked at all, and writes no negative: `lookupAniSkip` returns before
  `saveAttempt` when `mal_id` is null. The episodes' watched-at ending
  follows the marks that remain: clearing AniSkip's rows recomputes each
  affected episode's `entries.ending_at` and writes `NULL` when no mark is
  left, so an old entry's ending is never left behind to mark an episode
  watched early (or never).
- **Cost:** one small HTTP request per episode, once, on the resolve that
  plays it. It is awaited so the buttons are there on the first play; every
  later resolve is a database read.

`tests/anime-aniskip-db.spec.ts` (the request, the marks, hidden, no link,
seasons, no length, the 7-day retry, a failing server not remembered, a link
to the manga made through LINK, and every AniList format plus an unknown one,
against a fake that answers any id with an opening),
`tests/anime-rungs-db.spec.ts` (migration 64),
`tests/aniskip-rung67-db.spec.ts` (migration 67),
`tests/anime-download-db.spec.ts` (the NFO's ids) and
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
- **How they are compared.** Both windows are resampled to 8 points a second
  and shifted against each other: an opening **across its whole window**,
  since each episode's cold open moves it, and an ending by up to 180 s,
  since episodes differ in length. A point matches when it is within
  **6 bits**. A run is made of **streaks of at least 4 matching points in a
  row** (half a second), joined across **gaps of up to 3.5 s**, which count
  in its length, and is kept only when **at least 70 % of its points** are in
  those streaks. The longest such run within **15–120 s** (an opening) or
  **15–180 s** (an ending) is the pair's span for both episodes. Openings and
  endings follow the same rule: the noise is the encode's, not the song's. A
  season needs **at least two episodes** with prints; one alone decides
  nothing and isn't remembered.
- **Why the rule is that.** Two encodes of the same song, a 360p stream's
  audio especially, differ at scattered points, so a run that ended at the
  first point past 6 bits returns a 90 s opening in pieces, and the longest
  piece wins: on one streamed season that found every opening as a third to
  a half of the song (31–48 s of about 90) and one episode's not at all. A
  short shift misses openings too: that season put its opening at 30.75 s in
  one episode and 83.1 s in another. Bridging gaps is Jellyfin's Intro
  Skipper's method (its `MaximumTimeSkip`, 3.5 s). Bridging alone chains
  chance, though: two unrelated stretches of the db spec's pink noise match
  at 8–11 % of points, nearly once every 3.5 s, and in streaks of up to 3 s;
  the chains that made were 12–20 s at a density of 0.30–0.43, while a shared
  opening comes out at 0.97–1.00 and one with a bad point every 3 s at 0.96.
  Hence the streaks and the 70 %. With this rule, the same season's openings
  of episodes 5 to 12 come out at **89.5 to 94.6 s** each, starting between
  11.6 s and 73.4 s as each cold open puts them, and every ending from
  **1294 to 1298 s** to the end of the episode. Shifting across the whole
  window costs about 80 ms a pair (10-minute windows, 190 ms), so the season
  job yields to the app's requests between pairs.
- **Which span an episode keeps.** Each pair gives both of its episodes a
  span. Of an episode's spans the one **most of the others overlap** wins,
  and the longest of those (`agreedSpan`), so one pair's chance run doesn't
  decide an episode the rest disagree on.
- **What is kept.** The run's own times in each episode, as a `fingerprint`
  row. An episode whose pair found nothing gets a negative row, tried again
  after 14 days.
- **Cost:** seconds of ffmpeg a region, one episode at a time, in the
  background. A season's downloaded episodes are read when one of them is
  played; a hidden series is left alone, and incognito starts nothing.

**Migration 63 forgets fingerprints found under the earlier, stricter
matcher.** An episode with a `fingerprint` row, found or negative, is not
read again (a negative only after 14 days), so a new matcher alone changes
nothing for an episode already marked. The migration deletes every
`fingerprint` row, negatives included, and recomputes `entries.ending_at`
from what remains (`NULL` where a fingerprint was the episode's only ending),
so the next play finds them under the rule above: a fragment is worse than no
mark, since SKIP INTRO lands in the middle of the song and no mark shows no
button at all. The migration's spec is `tests/anime-rungs-db.spec.ts`, which
also checks its frozen copy of `syncEndingAt` against the app's own rule on
every entry.

**ffmpeg's chromaprint muxer is the way** (`-f chromaprint -fp_format raw`),
and every release bundle's pinned ffmpeg has it: BtbN's n8.1.3 LGPL build is
`--enable-chromaprint`, prints `E chromaprint Chromaprint` from `-muxers`, and
makes 27 points of a six-second tone, exactly as `fpcalc` does
([`RELEASE.md`](RELEASE.md), "Pinned"). Arch's ffmpeg (n9.0.1) is built
without the muxer, so on such a build the extractor falls back to
**`fpcalc`**, chromaprint's own program from the `chromaprint` package, fed
the same audio through the same ffmpeg; the points are the same. Either way
`ffmpeg`/`ffprobe` are needed, and `fpcalc` only on a build without the
muxer; [`DISTRIBUTION.md`](DISTRIBUTION.md) lists them.

A missing `fpcalc` on a build without the muxer is said once in the log,
naming the chromaprint package and `FPCALC` ([`LOGS.md`](LOGS.md)).

`tests/fingerprint.spec.ts` (runs, bit errors, bounds, the two windows, a
90 s opening with a bad point every 3 s, openings 55 s apart, the gap's
bound, chance too sparse to chain, a lone chance point, an ending's bad
points, and the agreed span) and `tests/anime-fingerprint-db.spec.ts` (two
synthesised episodes sharing an opening and ending, the real ffmpeg and
chromaprint, source precedence, a hidden series, one episode, a negative
remembered, the background queue, and a 90 s opening behind 25 s and 80 s
cold opens with the second episode encoded at 12 kbps, of which a run that
ends at the first bad point finds nothing).

### Fingerprints of streams

The same method, and the same matcher and rule, for an episode with no file,
**only while it is being watched**: when the player resolves an episode, the
background job takes the playing episode, **the next two after it** and one
more after those, so both next episodes have a pair. It never runs for a
season outside the one being watched.

- **What is read.** The stream's **lowest quality**, preferring one at or
  below 480p, through the same loopback proxy downloads and pictures use
  (`loopback.ts`), so ffmpeg fetches nothing itself and the net guard still
  applies. A source that names nothing that low, or no height at all, gives
  its lowest instead: reading audio costs the same at any video height. A
  **separate audio rendition** is preferred where the source offers one
  (KickAssAnime's); it is the smallest thing carrying the opening and
  ending.
- **What KickAssAnime answers** (measured through the engine): one server,
  `VidStreaming`, with qualities `1080p (1920x1080) - 3.52 Mbps`,
  `720p (1280x720) - 1.31 Mbps` and `360p (640x360) - 506 kbps`, each naming
  a separate audio rendition per language. Its heights are read from those
  labels, so 360p is what is fingerprinted.
  `tests/anime-stream-fingerprint-db.spec.ts` pins that shape, and the two
  fallbacks (no height anyone, nothing ≤480p).
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
- **It says what it did**: one INFO line per season job (series, episode, how
  many in the season, how many to read) and per episode outcome (its file or
  stream, opening and ending found or not, and a negative kept), and a WARN
  for a step that failed — the resolve, the length probe, or the
  fingerprint — naming the episode and the server. The catches stay, so the
  player never waits; the log answers "why no skip on this episode"
  ([`LOGS.md`](LOGS.md)).

`tests/anime-stream-fingerprint-db.spec.ts` (the lowest 360p audio rather than
1080p, a separate audio track, a failing server passed over, no read during a
same-source download, the next-two window).

## The player

`/read/<entry>` for an episode, as for a chapter
(`src/routes/read/[entry]/VideoPlayer.svelte`; its decisions pure in
`src/lib/library/player.ts`). **The picture is the interface**: nothing on
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
  →), and in the middle −1m / −10 / pause / +10 / +1m, pause two drawn bars,
  which steps aside while BUFFERING or a server's notice holds the middle, so
  the two never overlap. A movie is not clicked through 10 s at a time: a
  minute moves either way, from these cells, from the bar's own pair on every
  device it draws them (a TV's and a desktop's, the phone's portrait row),
  and from a remote's ⏩ ⏪. The scrubber ticks the opening and ending. A
  desktop adds play, VOL, PIP where the browser has picture-in-picture,
  ? KEYS and FULL SCREEN · F, and a time on hover, with the frame there above
  it (the seek preview, below).
- **The picture never tints.** The tap zone over it is a `<button>`
  (`.tapzone`) that draws nothing, so it says `data-press="off"`: otherwise a
  mouse over the picture would lay motion.css's 9% hover gradient over the
  frame. The visible controls (the cluster, the scrubber, the bar's cells)
  keep their hover. `tests/browse-player-hover.e2e.ts` holds both.
- **Taps**: on a touch screen one shows or hides the controls; a double-tap
  on the left or right third seeks 10 s, and each further tap in the burst 10
  more, said in the middle of that side. **On a mouse a click on the picture
  plays or pauses it**, as every video player's does: on a desktop the
  picture is the biggest thing on screen, and the controls are reached by
  moving the pointer. The click in the middle acts at once, and one on a side
  third waits out the double that seeks; a press that wanders more than 10px
  is a drag, and neither. A touch screen keeps show-or-hide, since there is
  no pointer to move. No swipes: on a touch screen volume and brightness are
  the device's (a pointer has VOL, below).
- **The controls come back on a move, not a jitter.** A resting mouse sends
  a pixel or two of movement all the time, which would flash the chrome in on
  every one of them; it takes 12px of travel — quickly from where the
  pointer was, or slowly from where the controls last left it. The middle
  cluster (`−1m`, `−10`, pause, `+10`, `+1m`) does not fade with the bars: it
  is all there from its first frame, since a box fading over the picture
  reads as a patch coming and going. Its ground is translucent, 70% of the
  page's, so the frame shows through while the controls are up, and its
  glyphs keep AA over a white frame and a black one.
- **The cursor goes with the controls.** The readers' CURSOR row
  (`tsundoku.reader.cursor`) is on for the player by default, and the player
  has no timer of its own: the cursor disappears exactly when the controls go
  during playback (`HIDE_MOUSE_MS` after the last move) and comes back with
  them — a move, a key, a pause. A sheet keeps both up, and so does an open
  KEYS dialog (`?`), so the cursor never hides over it or its ✕.
- **Volume.** VOL is a cell with a slider above it: its label mutes, and
  hovering it (or clicking it) opens a slider above the cell, a column of the
  bar's surface with the scrubber's track upright, which a press or a drag
  sets; the wheel over the cell or the slider steps 5 %, ↑ ↓ 10 %. Every one
  of them goes through one function (`setVolume`), and the level is
  **remembered for this device** (`tsundoku:anime:volume`, a device setting
  like DIM and quality, mirrored on the workstation and listed in SETTINGS as
  VOLUME), read once as the player mounts and given to the picture before the
  stream starts, so the next episode and the next show start where it was
  left, from their first frame. **Mute is never kept**: a muted episode does
  not leave the next one silent. A level set above 0 while muted unmutes,
  since a slider moved under MUTED would otherwise change nothing anyone
  hears. The slider is a pointer's: on a phone the VOL cell stays hidden, and
  on a TV the remote's volume is the TV's.
- **The seek preview.** Over the scrubber, while the pointer is on it (and on
  a touch screen while the thumb is dragged), the tip with the time shows the
  frame at that time above it: 160 x 90, the hairline round it, the time in
  the label face under it, and kept inside the track at either end
  (`--tip-half`). Where it comes from:
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
    another entry's (an id SQLite reused), so nothing that changes a file has
    to remember it, and no migration is needed. The tile shown is the frame
    nearest the time, at most 5 s off. Until the sheet exists the tip shows
    the time alone.
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
    without stopping the next one's segment. **A playlist later than the
    stop's second**: the stop gives up at its second, and when the playlist
    comes it starts nothing, since a stop has happened since (a `stopped`
    counter that `stop()` bumps) or a later stop began; the pointer gone
    meanwhile, nothing is fetched off the bar. Before the playlist is in,
    `stop()` leaves hls.js alone: nothing loads then but the playlist, and
    hls.js's `stopLoad()` destroys that request in flight, after which
    MANIFEST_PARSED never comes and the preview would show the time alone for
    the rest of the episode. A playlist that fails past hls.js's own retry
    (a fatal error) gives that stop up, and the next stop opens a fresh
    player and asks again; its rejection is answered (the stop's race
    observes it), so it never reaches the page as an unhandled one, and the
    case asserts no `pageerror`. **The first stop on a fresh page** may wait
    on hls.js's chunk: it counts itself before that wait, and when the chunk
    comes it opens nothing if the pointer left, a later stop began, or the
    page is being left (`beforeNavigate` ends the stop as the way out starts;
    `onDestroy` too). The player stays mounted until the next page's data has
    loaded — SvelteKit swaps the page only after its load, so a chunk
    arriving in that window would open a preview behind the way out;
    `out:leave` is on the player's sheets, not on the player. hls.js is
    loaded only for a playlist: a plain file's preview is the browser's own
    picture and never waits on it. **A plain file as the lowest quality** (a
    hoster's MP4 or WebM): the hidden picture reads its header
    (`preload = 'metadata'`; `none` holds back even the seek's own read, so
    such a stream would never have a frame) and then the bytes at the time
    asked, a few Range requests a stop. A file has no `stopLoad()`, and after
    a seek the browser reads on past the frame, so when the pointer leaves
    the file is let go (`leave()`) and the next stop opens it again from its
    header: no Range off the bar. `tests/browse-player-preview.e2e.ts` counts
    both, against a fake hoster that caps each Range answer and can be slow.
    A server whose lowest quality is above 480p, or of unknown height, and a
    stop that takes over 1 s show the time alone. A frame is shown only near
    the time it was drawn for (half a percent of the episode, at least a
    second; `nearFrame`): moved on, the tip shows the new time alone until
    that time's frame comes, never the last stop's picture over it.
  - **A TV**: no pointer, so ← → (and ⏩ ⏪) with the bar up show, for as
    long as the move's flash is up (900 ms after the last press), the tip
    over the bar at the time they landed on, with a downloaded episode's
    sprite tile above it, kept inside the track at either end as the
    pointer's is (the same `tip` snippet, at `seekFlash.to`). A run of
    presses moves the tile with each. A stream's bar keeps the time alone
    and no tip: its hidden second picture fetches a segment a stop, which
    suits a pointer resting on the bar, not a remote's run of presses, and
    nothing was measured to say a TV should pay for it. A downloaded
    episode with no sprite yet has no tip either. `tests/tv-player.e2e.ts`,
    "the seek preview on a TV".
- **Keys**: space, ← →, ↑ ↓ (volume), F, M, C (subtitles), S (skip), N (next),
  Esc (full screen, then the player), ? (the KEYS sheet). A remote's media
  keys work on every device: ▶❚❚ plays or pauses, ⏩ ⏪ seek a minute, ⏭ the
  next episode and ⏮ the previous one — harmless where nothing sends them,
  and the only player keys a remote has ([`TV.md`](TV.md)). A press of ⏩ or
  ⏪ is a minute; a held one steps again every 500 ms, about two minutes a
  second, because a remote's repeats arrive as fresh keydowns with no repeat
  flag on them (the Android app's `Keys.dispatchScript`) and the player paces
  them itself. Releasing the key ends the pace, so the next press moves a
  minute however soon it comes. ← → stay 10 s on every device, and on a TV,
  SKIP INTRO, SKIP ENDING and the next-episode card's PLAY NOW → take focus
  when they are offered, so OK presses them.
- **The settings sheet**, the middle cell ("JA · EN SUBS · 1080P · 1×"): a
  520px side sheet with the picture playing beside it. QUALITY (this
  server's), SERVER (the hosters by name, the one playing and the ones that
  stopped), AUDIO where there's a choice, SUBTITLES (OFF, each language, S M
  L; "IN THE PICTURE" where there are no tracks), SPEED, DIM. Qualities are
  named by height (`2160P`, `qualityName`), never a source's
  "2160p (3840x2160) - 7.42 Mbps", and a server says "UP TO 2160P". Audio,
  subtitles and their size carry to every episode of the series and to every
  other anime. The workstation keeps them (`series_player`, migration 53;
  `server/anime/choices.ts`), so SETTINGS can set a default and list the
  series that differ ([`SETTINGS.md`](SETTINGS.md), "03 — Watching"). An
  episode starts on this series' choice, else SETTINGS' default, else the
  last choice on any anime, then the source's first audio track (its
  original) and subtitles in the device's language (`startTracks`), worked
  out again for each server until a choice is made. Incognito keeps no
  choice. Speed is this episode's; quality, DIM and volume are this device's,
  mirrored on the workstation like every device setting. The sheet ends with
  ALL SETTINGS →.
- **The settings sheet's languages.** A language is its short code
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
  alias's language when the name plausibly is it, its first word and the
  English name a prefix of each other or a short list of countries
  (Indonesia cuts to IND, which is ID; China is ZH, Vietnam VI); otherwise
  it is the first letter and the first two later ones no language holds
  (Chichewa cuts to Chinese's CHI and is CHC, Greenlandic GRN), so an
  unknown track never takes a known one's code. A label with no Latin
  letters left, blank or in another script ("Тагальский"), is UND, named
  Unknown when it is blank. So every code the sheet shows is one `langCode`
  gives back unchanged and one the workstation keeps as a choice (two or
  three capitals, then up to two parts: PT-BR, ES-419, UND-2). Two tracks of
  one list that still come to one code are told apart as ES and ES-2
  (`trackCodes`). The server sends each track's code and name (`langName`);
  a downloaded file's tracks have codes alone, and the player names them
  from the code. **AUDIO and SUBTITLES are a grid of equal cells** (at least
  60px wide, 44px high, the house tap size), as many to a line as fit -- six
  in the 520px sheet, four on a TV's 420px panel, three on a phone --
  wrapping onto further lines, which a D-pad crosses as any grid. **Past
  twelve languages** a row shows only OFF, the one on, the series' or
  SETTINGS' choice, the device's language and English (for audio the
  original too), in the source's order, then **MORE · N**, which opens every
  language as a list in the same sheet, one a line, named in full with its
  code at the right. Picking from it closes it and puts focus on the pick's
  cell, which the row now shows; BACK closes the list before the sheet.
  Twelve is two lines of the sheet's six: past it the row grows taller than
  the rest of the sheet together (on a TV, three lines already), and a
  VidStreaming episode can carry 11 audio languages and a few dozen
  subtitles, so its audio wraps and its subtitles collapse. A remembered
  choice is the track that carries its code, as it is: ES-2 is the second
  Spanish, on the next episode and as the row's cell that is on, never the
  first. Only a choice no track carries is read again, as the track it meant
  (`matchLang`), so a choice stored under another spelling still finds its
  track: `PT` finds PT-BR, `HUN` finds HU, `IND` finds ID, and ES-2 finds ES
  where only one Spanish is offered. Downloads keep and tag tracks by the
  language alone, since AUDIO KEPT names languages and Matroska's tag has no
  variant.
- **Subtitles** are drawn by tsundoku from the WebVTT: IBM Plex on a scrim
  box, rising above the controls while they show. The one place the browser
  may draw them instead is its own picture-in-picture (below), from a native
  `<track>` of the same WebVTT, which the page keeps showing but draws
  invisibly, so the page never shows a line twice.
- **Picture-in-picture.** A video's own picture-in-picture moves only the
  `<video>`, which would leave tsundoku's drawn subtitles on the page. So, by
  browser (`src/routes/read/[entry]/pip.ts`):
  - **Chrome and Edge on a desktop** (Document Picture-in-Picture, since
    116), **and Firefox 155** (which has it too, in a secure context, beside
    the video Picture-in-Picture API; Playwright's Firefox 155 runs this
    whole path in `tests/browse-player-pip-firefox.e2e.ts`): a **PIP** cell on
    the desktop's bar moves the picture layer -- the `<video>`, the drawn
    subtitles, the dim -- into a floating window of its own, with the page's
    stylesheets copied in (Svelte's scoped styles live there, and a node
    moved into another document no longer sees them), and the page says IN
    PICTURE-IN-PICTURE where the picture was. The subtitles keep tsundoku's
    face, scrim and S M L there; with no controls in the window they sit 7 %
    from its bottom, where the page puts them while the controls are hidden,
    and never rise. A subtitle change on the page (the sheet, C) shows in the
    window at once: it is the same element. The window answers on its own: a
    mouse's click on the picture plays or pauses it, as on the page, and the
    player's keys (Space, ← →, ↑ ↓, M, C, N) work with the window focused,
    except Escape, which brings the picture back rather than leaving the page
    behind it. It needs listeners of its own, added when it opens and removed
    when the picture comes back: the picture's pointer handlers are Svelte's
    delegated ones, heard on the page's root, and the keys are the page's
    window, so neither hears the floating window's document. There are no
    controls in it. Every way out puts the picture back in the page, the same
    `<video>` still playing: PIP · ON, the window's own close (its
    `pagehide`), and NEXT or leaving the page, which close the window too
    rather than leave it empty (a new window needs a press, so NEXT does not
    carry it over to the next episode). The browser's own PiP button keeps
    doing what it does, as below.
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
    once. What is tested is the page's side, in Chromium and Firefox: the
    track showing with its cue active, no native cue box on the page, and
    the plain drawing between enter and leave. Whether a browser's own PiP
    window draws the track is under "Limits".
  - **A system caption style** (Windows, macOS or Android's accessibility
    captions): Chromium writes it as inline style on the native cue box, and
    inline style beats a normal author rule, so the three declarations of
    `video.cueless::cue` are `!important`, which beats inline normal style.
  - **A phone**: the PIP cell is a desktop's; on a phone, the system's own
    PiP is the video's own path above.
  - **A TV** has no PIP cell.
- **SKIP INTRO / SKIP ENDING** wherever an opening or an ending is known --
  the source's, AniSkip's or a fingerprint's ("Openings and endings") --
  alone for 8 s, then with the controls. SKIP ENDING marks the episode
  watched as it is pressed.
- **On a TV** ([`TV.md`](TV.md)) the controls are a D-pad row: the picture
  until a key, then, when no offer is up, focus on ▶❚❚ and all eight cells on
  one line — ▶❚❚, −1m, −10, +10, +1m, ← EP. n, the cell naming the stream
  (which opens the settings), EP. n+1 → — under a 60px scrubber, inside the
  28px safe margin. The two minute cells are stops in that order, so the pad
  reaches them the same way it reaches the rest. With no offer up, OK on the
  picture brings the bar and that focus; BACK hides it, then leaves for the
  series. SKIP INTRO (or SKIP ENDING), where offered, shows alone and takes
  focus itself, as the next-episode card's PLAY NOW → does: OK presses the
  focused button, ↑ is a no-op while the bar is down, and ↓ brings the bar
  with focus on the seek bar. The settings sheet is the 420px panel from the
  right that every sheet is there, with the picture playing at the left, and
  it keeps its focus when a server fails over and the rows redraw under it.
  Nothing changes off a TV: the cluster in the middle is the thumb's, and the
  player's own arrows stay the reader's when the bar is hidden.
- **Resume**: RESUMED AT 9:28, with FROM 0:00, for 5 s; an episode past its
  ending's start (or its last 3 %) opens from 0:00.
- **Servers fail all the time.** A stall of 15 s, or a server that stops,
  moves to the next at the same second by itself; BUFFERING says what it
  waits on and offers SERVER 2 NOW →, and a switch says which stopped where.
  After the last, the list is asked for afresh once (a stream that stopped
  may have gone stale), then NO SERVER ANSWERED with TRY AGAIN. **With no
  server left to move to, a stall first drops one quality on the same
  server** (`stallStep`), at the same second, for this episode only, saying
  "1080P COULDN'T KEEP UP"; BUFFERING names the drop and offers 720P NOW →.
  KickAssAnime has one server, and its 1080p runs at 20–34 Mbps through a
  heavy scene (measured on one episode: segments of 13–25 MB for 6 s against
  a label of 4.58 Mbps): a link that can't carry it stalls there on every
  try. A fatal error still moves servers, never quality: that's a server
  broken, not a link too thin.
- **What counts as a stall** (`stallClock` in `src/lib/library/player.ts`).
  The 15 s clock runs only while the player is trying to play from a settled
  position. A seek isn't a stall, however it is made (a held ← or →, the
  media keys, the ±10 cells, the scrubber, a double-tap run, SKIP): the
  element's own `seeking` restarts the clock, so a key held for a minute
  still leaves a full 15 s after it is let go, and the BUFFERING panel (from
  2 s) can't paint while it is held. The seek's landing asks the element what
  it has (`readyState`): something to play stops the clock; nothing starts it
  afresh from the landing, because `waiting` may already have fired and won't
  again. A seek that never lands (a dead server fires no `seeked`) has been
  running from the last input, and steps a full 15 s after it. A paused
  player runs no clock; PLAY with nothing to play fires `waiting`, which
  starts one. `seconds` are whole: 15 is a full 15 s.
- **ANOTHER SOURCE →** comes before TRY AGAIN on every NO SERVER (never on
  SOURCES NOT ANSWERING, where the engine is down and every source would
  fail). When the same series has failed the same way on more than one
  episode, one line above the cells says so — `EPISODES 1, 2, 7 AND 8 FAILED
THE SAME WAY SINCE 1 NOV` — and the cell opens MOVE ([`MOVE.md`](MOVE.md)).
- **A reload never reports 0.** Switching server or quality, or asking the
  list afresh, destroys hls.js, and the emptied video reads 0 until the new
  stream is in. Until the video is back within 10 s of where it was heading
  (`reloadingTo`), that second is what the scrubber shows, what `page` and
  `close` send, and where a second failure picks up. Otherwise a stream that
  stopped and never came back would send 0 and wipe the episode's place: it
  would open from 0:00 again and stall at the same scene, which reads as
  "can't get past 3 minutes". A seek by hand ends the wait.
- **Waiting**: FINDING THE VIDEO with the ink line and a count of seconds; a
  site's check named at once (`/api/browse/check/<source>`) with its known
  20–45 s range drawn as a scale, never a fill. The source service not
  answering is SOURCES NOT ANSWERING, without naming the engine.
- **The next episode** offers itself from the ending's start (or 30 s before
  the end): a card, STAY or PLAY NOW →. At the end, the NEXT page counts 5 s
  and plays it; STAY stops it. **The last episode ends on END · LAST
  AVAILABLE**, not the reader's end-of-series page with RATING: the series
  screen has the rating, and the player has no rating anywhere else. In a
  Work the next part's card takes the next-episode card's place: from the
  same moment, NEXT IN THE WORK with the next part, ▶ and WORK, never a
  countdown and never an autoplay into another series; the END · LAST
  AVAILABLE page gains the same card, still with no rating
  ([`WORKS.md`](WORKS.md), "The end of a series").
- **Portrait** (any device held upright, a phone or a tablet) puts the
  picture on top, the controls always shown beneath it, and UP NEXT below;
  FULL goes full screen and turns it where the browser allows. A browser
  turns it with `screen.orientation.lock('landscape')`; a WebView refuses
  that (`NotSupportedError`), so tsundoku's Android app turns the window
  itself (`Form.turnsForVideo`, `MainActivity.turnForVideo`) and puts it back
  when the picture goes ([`ANDROID.md`](ANDROID.md)). **The scrubber under
  the picture seeks**: a tap goes there, a drag follows the finger with the
  time under it shown over the picture, and the whole 44px row is the
  target, not the 4px line. It is a slider like the bar's (`role="slider"`,
  its aria values, ← → when focused), it takes the pointer itself
  (`touch-action: none`), and it sits fixed under the picture with UP NEXT
  scrolling below it, so a drag never scrolls the page and its tip is never
  clipped. Both tracks measure the one the pointer is on (the hidden one is 0
  wide), and the scrubber goes by the video's own length from its
  `durationchange`, not the episode's stored length, so a seek before ▶ lands
  against the file's real end.
- **Watching is reading.** The player sends the reader's events
  (`/api/reading`): `page` is seconds into the episode, and `length` its
  length as the player measured it, which is how an episode learns its length
  (`duration_s`). Each event also carries `durationMs`, what actually played
  (paused, buffering, a seek and a hidden page don't count;
  [`READING-LOG.md`](READING-LOG.md), "The caps"); migration 65 estimated it
  for episodes watched before the field existed. Finished at the ending's
  start or the last 3 %. Incognito sends nothing. A hidden series plays
  inside the 4px reveal frame.

`tests/player.spec.ts`, `tests/anime-reading-db.spec.ts`, the separate-audio
and file tests in `tests/anime-streams-db.spec.ts`, and the player tests in
`tests/browse-anime.e2e.ts` (the fake engine's broken server passed over,
subtitles, SKIP INTRO, the frame's literals, the sheet, the NEXT page and
STAY, WATCHED on the series; portrait), with the portrait scrubber's tap,
drag, hit area and tip at a 390×844 touch phone in
`tests/browse-player-portrait.e2e.ts`, and the sheet's languages (11 audio
and 30 subtitles, MORE, a pick remembered on the next episode) in
`tests/browse-player-languages.e2e.ts`, at the TV's 420px panel by D-pad in
`tests/tv-player.e2e.ts`, and their codes in `tests/streams.spec.ts`. The clip
is `tests/fixtures/video/clip.webm`, VP9 and Opus: Playwright's Chromium has
no H.264.

## Downloading

Streaming is the default; DOWNLOAD and SELECT keep episodes, for keeping a
series and for watching away from home (`src/lib/server/anime/download.ts`,
pure parts in `src/lib/library/anime-files.ts`).

- **Jellyfin's TV layout**, so a Jellyfin library can be pointed at the
  folder for watching on the TV:

  ```
  $LIBRARY_ROOT/Anime/<Series>/tvshow.nfo, poster.jpg
  $LIBRARY_ROOT/Anime/<Series>/Season 01/<Series> S01E07 <Title>.mkv, and its .nfo
  ```

  A show's and a film's go under `Shows/` and `Movies/` the same way
  ([`FILMS-SHOWS.md`](FILMS-SHOWS.md); [`DOWNLOADS.md`](DOWNLOADS.md), "Where
  files go").

  `Season NN` zero-padded; a source without seasons is season 1 with its own
  (absolute) numbers. The year Jellyfin likes after the name
  (`<Series> (<year>)`) is left out: Aniyomi gives none, and a guess would be
  worse. A **hidden series goes under `Anime (hidden)/`**, never under the
  folder a Jellyfin library reads (Jellyfin has no reveal). The folder is
  fixed at the first download (`anime_series`, migration 48): files aren't
  renamed when a title is edited here, and a series hidden later keeps its
  folder.

  **A season may have a folder of its own** ([`WORKS.md`](WORKS.md),
  "Per-season sources"): `series_season_facts.folder`, fixed the same way,
  `episodePlace` in `anime/download.ts`. A season with a row whose folder is
  set keeps it. **A season with files stays where they are**, in the series'
  folder or in the folder of a season it shared a source with, whatever its
  row now names: a MOVE re-keys a season and moves no file
  ([`MOVE.md`](MOVE.md), "A season with a source of its own"). One with no
  files, a source of its own and no folder yet gets one at its first
  download, named by what the source calls it, walked past any name a series
  or another season holds (`freeFolder`). Two seasons sharing one source
  share the folder one row holds. Everything else, **a season with no row
  included**, is the series' folder, as above. A season's own folder has its
  own `tvshow.nfo` naming **that season's key** and that season's link, which
  is what the importer folds it back onto the series by; its files are named
  from the series' folder (`../Other/Season 02/…`), so each folder answers
  only for its own on a rescan. **The order the folders are found in changes
  nothing.** A series with no folder yet is named from the first one to
  arrive, even a season's; when its own arrives, every file it knows is named
  again from there, in the same transaction, which is not an arrival
  (`nameFilesFrom`, `import/write.ts`).

- **One MKV an episode**: ffmpeg copies the video, each separate audio track
  and each subtitle track (as SubRip, which every player reads) into one
  Matroska file. **Which tracks** is SETTINGS' DOWNLOADING: every track by
  default, or the original (the source's first audio) and the languages
  chosen under AUDIO KEPT; subtitles all, or AS AUDIO for those in a kept
  audio's language (`keptTracks`), by language alone: an ES-419 track is kept
  by ES and tagged `spa`. New downloads only. Each track is tagged with its
  language's ISO 639-2 code, from the player's one table (`iso3`: `hun`,
  `nob`; `und` only for a language it lacks). The file is written beside its
  place and renamed. The NFOs are Jellyfin's (`tvshow`, `episodedetails`) and
  carry tsundoku's keys as `<uniqueid type="tsundoku">`, with AniList and MAL
  ids where the series is linked to an anime's entry (a manga's ids would
  have Jellyfin's plugins fetch another work). They are the show's ids
  (`showEntry` in `season-links.ts`): season 1's link, else the earliest
  season linked, part 1 first, read from the season rows, so a show with only
  season 2 linked names season 2's entry rather than none. A season linked to
  a manga is passed over for the next one that is an anime's. `series_links`
  answers only for a show with no season rows, which after migration 68 no
  linked anime is. An `.nfo` already written is rewritten at the series' next
  download. `poster.jpg` is the library's own cover.
- **ffmpeg fetches nothing itself.** Its inputs are a loopback proxy inside
  the app that serves only the tokens `streams.ts` handed out, and only with a
  per-process secret header, so every request a download makes passes the
  same guard the player's do: internet only, the engine only where the engine
  named it. A playlist can't aim ffmpeg at the workstation.
- **Its own lane** of the one queue (`QueueRow.kind`, `'anime'`): one episode
  at a time beside the chapters' and novels' workers, so a 400 MB episode
  never holds up a 3 MB chapter. Streams are resolved right before (they go
  stale), and a source that answers with no videos is asked again after 10 s
  and 30 s (`REASK_MS`) before the queue counts a try; each server's stream
  at the chosen height is tried in the source's order, and ffmpeg's progress
  is the queue's share (DOWNLOADING · 38%). The DOWNLOADS screen draws
  EPISODES and CHAPTERS apart, each lane its own band. The episode lane's
  band says a percentage, not bytes and a speed: ffmpeg reports time, not
  bytes, and the size is an estimate.
- **Quality**: SETTINGS · EPISODES (1080P by default, 720P, 360P); ALL's
  confirmation asks again for its episodes, with each height's ABOUT size
  from the source's bitrate (`/api/anime/series/<id>/sizes`: one episode's
  playlists, BANDWIDTH times the length) and the room left on the disk. A
  height is kept per episode (`anime_episodes.quality`).
- **The importer** (`src/lib/server/import/anime.ts`, the scan's last step)
  reads every series folder with a tvshow.nfo tsundoku wrote and every
  episode with its .nfo, onto the `aniyomi:` series and episodes they name,
  through the one writer. A folder someone else put there is left alone. An
  episode file deleted from the folder is NOT DOWNLOADED again, and streams.
  A finished episode attaches the moment it's written
  ([`DOWNLOADS.md`](DOWNLOADS.md), "Attaching"); IMPORTING is only what's
  waiting on a scan.
- **A downloaded copy always wins**: the player plays the file
  (`/api/anime/file/<entry>`, Range and all) and its subtitles out of it
  (`…/subtitle/<n>`, through ffmpeg), without asking the source at all, so it
  plays while the engine is down. If the file fails, TRY AGAIN streams.

`tests/anime-files.spec.ts`, `tests/anime-download-db.spec.ts` (the real
ffmpeg: a broken server passed over, VP9 and Opus and SubRip in one MKV with
its languages, the NFOs, the import, the file played first, the hidden
folder, a deleted file streaming again) and the download test in
`tests/browse-anime.e2e.ts` (FIRST 4 on the series screen, the episode lane,
the import, played from the file).

## Episode pictures

Neither KickAssAnime's nor AnimePahe's extension gives an episode a picture:
they never set Aniyomi's `SEpisode.preview_url` (checked in their dex). So an
episode's picture is made on the workstation
(`src/lib/server/anime/pictures.ts`; pure parts in
`src/lib/library/episode-pictures.ts`), from the best place it can, in order:

1. **The source's own**, where an extension sets one. The engine passes
   `preview_url` through its `/image/` proxy as it does posters
   (`bridgeEpisode`), and the plan keeps it as `thumb_url`. A token goes
   stale when the engine restarts, so it's fetched soon after the list
   arrives and kept as a file; one that no longer answers falls through to a
   frame.
2. **A frame of the downloaded file.**
3. **A frame of the stream**: the first server, its lowest quality (360P is a
   segment of a megabyte or two), the video alone for a separate-audio source
   (`videoOnly`). ffmpeg reads it through the loopback proxy that downloads
   use (`loopback.ts`), so it fetches nothing itself, with
   `-extension_picky 0` as a download's: the proxy's segments have no
   extension, and ffmpeg's HLS reader refuses those otherwise. On
   KickAssAnime an episode's picture comes out in about 10 s (9.8 s measured).
   The option is ffmpeg 7.1's, and an older ffmpeg (Ubuntu 24.04's 6.1, which
   CI runs) refuses the whole command when given it, while it never checks an
   HTTP segment's extension to begin with. So `hls-reader.ts` asks each
   binary's HLS reader once and passes the option only where it exists, for a
   picture, a fingerprint and a download alike.

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

**The nightly sweep.** Nothing that removes a series or an entry deletes its
episodes' files in `$COVER_DIR/episodes/`: the picture and the seek-preview
sprite with its sidecar (`<entry>.sprite.jpg`, `<entry>.sprite.json`, "The
player"). So the backup timer (`scripts/backup.ts`,
[`BACKUPS.md`](BACKUPS.md)) sweeps them after its snapshot
(`src/lib/server/anime/episode-files.ts`). It deletes every `<entry>.*` whose
id is not an episode's, meaning no entry has the id, or the entry with it
belongs to a series that is not video (`kindFacts(kind).medium`). It opens
the database read-only. Files under an id SQLite gave to a new episode stay:
the sprite is judged by its sidecar on every read (`currentSprite`), and the
picture by the new entry's own `thumb_at`. A file younger than an hour is
left for the next night, since its entry may have been written after the
sweep's query. A failed sweep is logged and does not fail the backup.
`tests/anime-episode-files-db.spec.ts` covers a removed episode, a removed
series, a reused id (a new episode's and a chapter's), a young file, a name
with no id, and no folder.

`tests/anime-pictures-db.spec.ts` (a fake engine's picture, the fixture clip
as a file, as a stream through the loopback proxy and cut into HLS, a stale
picture falling through, a site on the workstation's network refused, the
queue, the route and reveal), `tests/episode-pictures.spec.ts`, and the
plan's in `tests/anime-plan.spec.ts`.

## FOLLOW and REFRESH

As for a manga and a novel (`src/lib/server/anime/follow.ts`): FOLLOW on an
anime's DOWNLOAD row asks its source at once, then every six hours with
FOLLOW's ten-minute step (whatever the engine's other halves did); when it
was last asked is `anime_checks` (migration 49), the row's CHECKED … AGO. An
episode the source lists that no entry is becomes one with ADD's own plan
through the one writer, and is queued in the episode lane unless watched,
fifty a run at most, oldest first. Places follow the source's order, so an
episode it inserted moves the ones after it. A source that fails isn't
recorded as asked.

**FOLLOW and REFRESH ask the last season's source** (`followOrigin` in
`season-facts.ts`): of a series with season rows, the highest season it knows
of, by its rows and its entries, the one that can still air. A last season
with no row, or a series with no rows at all, asks `series.origin_key`. A key
that is that season's alone stamps every episode it lists with that season,
whatever the source calls it, since it numbers from its own first episode; a
key two seasons share (or the series' own) keeps the source's stamps.
Episodes are put back in reading order across sources (`resequenceAnime`).

**REFRESH** is the look beside FOLLOW, on any anime in the library with an
installed source: `refreshSeries` (`src/lib/server/refresh.ts`) asks the
source once through `checkAnime` with `queue: false`, so new episodes become
entries and nothing downloads. The band says what arrived
([`DOWNLOADS.md`](DOWNLOADS.md), "REFRESH").

## Offline

**While an episode plays, the device keeps the next one** if it's downloaded
on the workstation, from a 3 GB bucket of its own beside the 2 GB of chapters
(`tsundoku-episodes`; `keepEpisodes`, `cacheEpisode` in `src/lib/cache/`), and
lets this series' watched ones go. ↓ CACHE in SELECT keeps more by hand.
What's kept is the file (streamed into the cache, never into memory), its
subtitles, the answer naming it, and the player's page; the marker is written
last, so a half-kept episode never counts. The service worker answers the
player's Range requests by slicing the kept file ([`OFFLINE.md`](OFFLINE.md)).
Nothing of a hidden series, nothing while reveal is on, nothing incognito.

Offline, a kept episode plays under ○ OFFLINE · CACHED STILL PLAYS; one that
isn't says NOT ON THIS DEVICE · ○ NOT CACHED; the next cell reads EP. 8 · NOT
CACHED and is dimmed; the NEXT page never counts into an episode that can't
play. On the series screen, the rows the device doesn't keep read NOT CACHED
and dim.

`tests/episode-cache.spec.ts` (what's kept, its own budget and markers, the
Range slices) and the FOLLOW test in `tests/anime-source-db.spec.ts`.

## Measured against live sources

On a scratch library (an in-memory database, its own APK store) against the
real engine and Yuzono's repository
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

That run did not cover **a server failing over** (both sources' servers all
answered; the order is in `tests/anime-download-db.spec.ts` and the player's
`nextServer`), the **poster** (a bare script doesn't run the cover refresh),
or the player itself in a browser against a live source (the e2e runs it on
the fixture clip).

## Limits

- **AnimePahe's videos only download through the engine** (its clearance
  cookies), and the engine forgets every token on restart: a download that
  spans a restart fails and is tried again.
- **No lengths or FILLER/RECAP from an Aniyomi source**: the engine's episode
  list carries neither (url, name, date, number, scanlator and its picture;
  `AnimeEpisode` in `src/lib/import/anime-plan.ts`). A length comes from the
  stream or the file; a picture, where the source gives none, from a frame
  ("Episode pictures").
- **Whether a browser's own picture-in-picture window draws the subtitle
  track is not checked**: Playwright opens one but cannot look into it.
  Firefox's PiP has a setting for showing tracks
  (`media.videocontrols.picture-in-picture.display-text-tracks.enabled`, on
  by default) but has not been watched doing it; Chrome's own video PiP is
  not known to draw text tracks at all; Safari has not been run. Android
  Chrome's picture-in-picture is the system's, and whether it draws a native
  track has not been tried on a phone.
- **A system caption style is not checked**: no OS caption style could be set
  in testing (`--force-caption-style` is ignored by the Chromium build used).
  To check: on an Android TV, turn on Accessibility > Captions with a yellow
  text style, open an episode with subtitles, and confirm only one line
  shows.
- **The size of a real episode's seek-preview sprite has not been measured.**
