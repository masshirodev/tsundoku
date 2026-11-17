# Architecture

tsundoku is a self-hosted library for manga, novels, books, anime, films and
shows. One computer in a household runs it and keeps the files; every other
device (a phone, a tablet, a TV, another computer) reads from it in a browser
or in tsundoku's Android app, over the home network or a private network such
as a tailnet. This document is the map: each part, what it does, and the
document that describes it.

## Shape

```
phone / tablet / TV / browser
  │   PWA, or the Android app's WebView
  │   (localhost, home Wi-Fi, or a private network)
  ▼
tsundoku server ─── SvelteKit + SQLite, one process
  ├── the library on disk (TSUNDOKU_HOME/library)
  ├── importers and scans
  ├── download workers ──> extension engine (engine.jar, JVM)
  │                          └── FlareSolverr, for Cloudflare
  ├── LNReader plugin host (a sandboxed child process)
  ├── catalogues: AniList, MyAnimeList, TMDB; Ranobe
  └── Kumiko (optional): approved words become flashcards
```

On a released install, a launcher starts the app, the engine and FlareSolverr
together and stops all three together; on Windows and Linux a tray icon holds
the launcher with no window ([`TRAY.md`](TRAY.md)).

**It is a separate process with its own database**, run on the computer that
holds the files. A library is mostly images and video, often hundreds of
gigabytes: serving it from where it is stored means it never has to be
uploaded anywhere, and every page is read from a local disk.

## The server

A SvelteKit app on the Node adapter (`src/`), with one SQLite database through
`better-sqlite3` (`src/lib/server/db.ts`). Server code lives in
`src/lib/server/`, pure rules shared with the browser in `src/lib/library/`
and its siblings, and screens in `src/routes/`.

- **Schema migrations** are an ordered list in `db.ts`, climbed on first use,
  with a snapshot of the database taken before each one
  ([`BACKUPS.md`](BACKUPS.md)). Only the served app migrates the live
  database; scripts and timers run with `TSUNDOKU_MIGRATE=off` and refuse a
  database at another version ([`SERVING.md`](SERVING.md), "Who migrates").
- **Hidden means hidden**: hidden roots and series are filtered in SQL
  (`src/lib/server/visibility.ts`, `src/lib/server/library.ts`), never in the
  page, until reveal is on ([`PRIVACY.md`](PRIVACY.md)).
- **Signing in** is one shared secret, a token or a password, and a session
  cookie, because an `<img>` or a `<video>` cannot send a bearer header
  ([`SIGN-IN.md`](SIGN-IN.md)).
- **Words on screen** come from Paraglide message files (`messages/`,
  [`I18N.md`](I18N.md)).

## The library on disk

Everything tsundoku keeps that is not code derives from one folder,
`TSUNDOKU_HOME` (`src/lib/server/data-dirs.ts`): the library, covers, trash,
the engine's store, OCR scratch, language packs and, by default, database
snapshots. Each folder's own variable (`LIBRARY_ROOT`, `COVER_DIR`, ...) wins
over the derived default. Unset, `TSUNDOKU_HOME` is the platform's app-data
folder ([`DISTRIBUTION.md`](DISTRIBUTION.md), "One data directory").

Under the library root:

```
Mihon/autobackup/                  a Mihon backup, read for series and reading
devices/tsundoku/Mihon/            manga tsundoku downloaded, as CBZ + ComicInfo
devices/tsundoku/Library/Novels/   novels tsundoku downloaded, as EPUB
devices/<device>/...               copies synced from other devices
H/.Hentoid/  (or Hentoid/)         Hentoid books
Library/     (or Books/)           EPUBs
Anime/  Shows/  Movies/            video, Jellyfin-shaped, with NFOs
Anime (hidden)/  Shows (hidden)/  Movies (hidden)/
```

Every entry names its file relative to its series' path, and every path the
server stores is written with `/`, Windows included
([`DISTRIBUTION.md`](DISTRIBUTION.md), "Windows paths"). Deleting moves files
to the trash ([`DELETING.md`](DELETING.md)).

### The data model

- **Series**: the unit a person thinks in. Title, alternative titles, cover,
  description, reading direction, and a `kind`.
- **Entry**: a readable or watchable unit of a series: a chapter, a volume, a
  book, an episode, a film. A doujin is a series with one entry until books
  are grouped into it ([`BOOKS.md`](BOOKS.md)).
- **Progress and the reading log**: per entry, the last page, text position
  or playback time, and an append-only log of every open, turn, finish and
  close ([`READING-LOG.md`](READING-LOG.md), [`HISTORY.md`](HISTORY.md)).
- **Rating**: an integer 0 to 10 on the series, where **0 means unrated** and
  1 to 10 is five steps with halves; never `NULL`
  ([`RATINGS.md`](RATINGS.md)). The same convention Hentoid uses.
- **FAV**: a boolean on the series, separate from the rating on purpose: a
  favourite is "keep this at hand", not "this is a 10".
- **Shelves**: made by hand, ordered, and a series can sit on many. Mihon's
  categories become shelves ([`IMPORT-MIHON.md`](IMPORT-MIHON.md)).
- **Tags**: free-form, with a namespace (`genre`, `artist`, `circle`,
  `source`, `language`, or none). Every imported category or attribute is
  kept as a tag, and an artist, circle, author or tag has a page of its own
  ([`BOOKS.md`](BOOKS.md)).
- **Hidden**: a library root or a series can be hidden. A Hentoid import lands
  in a hidden root by default.
- **Works and editions**: a Work groups series across kinds so finishing one
  leads into the next ([`WORKS.md`](WORKS.md)); editions fold one book's
  languages together ([`EDITIONS.md`](EDITIONS.md)).

## Kinds

A series is one of seven kinds: `manga`, `manhwa`, `doujin`, `novel`,
`anime`, `movie` and `show`. What each kind is (its medium, the word for an
entry, its catalogue, which kinds it may match, its sources, its default
layout, whether it can move, how it groups, and where its downloads go) is
stated once, in `src/lib/library/kinds.ts`. The rest of the code asks
`kindFacts(kind)`, never `kind === 'anime'`, so a new kind gets the right
behaviour wherever the question is already asked
([`KINDS.md`](KINDS.md)). Films and shows are described in
[`FILMS-SHOWS.md`](FILMS-SHOWS.md), anime in [`ANIME.md`](ANIME.md), novels in
[`NOVELS.md`](NOVELS.md).

The medium picks the screen that opens an entry: the image reader
([`READER.md`](READER.md)), the text reader
([`TEXT-READER.md`](TEXT-READER.md)) or the video player
([`ANIME.md`](ANIME.md)). They share `/read/<entry>`, so every ▶ opens an
entry without knowing which it is.

## Finding and downloading

**tsundoku runs other people's extensions and never writes its own.** Per-site
scrapers are a treadmill that the extension communities already keep up with:
Mihon's (Keiyoushi) for manga, Aniyomi's for anime and video, LNReader's for
novels. tsundoku keeps up with three plugin APIs instead of hundreds of sites.
A site with no extension in any repository the user has added is not
downloaded. tsundoku ships no repository URLs, as Mihon and Aniyomi ship none:
the user adds them.

| Kind                     | Extensions       | Where they run                       |
| ------------------------ | ---------------- | ------------------------------------ |
| Manga, manhwa, doujinshi | Mihon            | the extension engine                 |
| Anime, films, shows      | Aniyomi          | the extension engine                 |
| Light and web novels     | LNReader plugins | tsundoku's own sandboxed plugin host |

**The extension engine** ([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)) is
the host side of Mihon and Aniyomi extensions. An extension is an Android APK
built against stubs: at runtime it calls into its host for the HTTP client
(OkHttp, carrying the extension's own interceptors for rate limits, headers
and image descrambling), Cloudflare challenges, preferences and the parts of
Android it touches. Node cannot load an APK, so the engine is a JVM process,
`engine.jar`: tsundoku-engine, a pinned fork of M-Extension-Server (MPL-2.0)
that tsundoku talks to over HTTP. Cloudflare challenges go to a FlareSolverr
process beside it; extensions that need a WebView run in a headless Chromium
the engine downloads on first use, only where SETTINGS' WEBVIEW switch is on.
The engine keeps nothing: repositories, APKs, preferences and state are
tsundoku's.

**The LNReader plugin host** (`src/lib/server/novels/`) runs novel plugins,
code downloaded from the internet, never in the app: in a child process under
Node's permission model, with an empty environment and a vm context per plugin
whose `require` gives only shims of the `@libs/*` modules the plugins are
written against ([`NOVELS.md`](NOVELS.md), "The plugin host").

**tsundoku is the downloader** ([`DOWNLOADS.md`](DOWNLOADS.md)): one queue
for manga, novels and episodes, retries, CBZ and ComicInfo, EPUBs, ffmpeg for
HLS, and FOLLOW's check for new chapters. Two rules hold throughout:

- **Images and streams are fetched through the source's client**, never by
  tsundoku fetching the URL itself, or the interceptors are skipped and a page
  comes back blocked or scrambled.
- **Keys don't move.** A series is keyed `mihon:<source id>:<url>` (and
  `aniyomi:`, `lnreader:` alike). The source id belongs to the extension, not
  the app that ran it, so a series a Mihon backup names and the same series
  downloaded here are one series. When an extension update changes a series'
  URL, the new URL becomes an alias of the key, never a second series.

Downloading is off unless `ENGINE_URL` and `ENGINE_TOKEN` are set; a release's
launcher sets them. Finding series and managing extensions and repositories
is BROWSE ([`BROWSE.md`](BROWSE.md)); reading or watching a series before
adding it is [`READING-ONLINE.md`](READING-ONLINE.md); moving a series to
another source is MOVE ([`MOVE.md`](MOVE.md)).

## Importing

What other apps already hold comes in through importers, which all write
through one writer (`src/lib/server/import/write.ts`), so an import and a scan
make the same series. [`IMPORT.md`](IMPORT.md) indexes them: Mihon backups,
Hentoid, EPUB, tsundoku's own video folders, and a backup uploaded in the
browser. The formats each reads are in [`IMPORT-FORMATS.md`](IMPORT-FORMATS.md).
Duplicates found across sources are handled in
[`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md) and
[`DUPLICATE-CHAPTERS.md`](DUPLICATE-CHAPTERS.md).

Files downloaded on other devices can reach the library through Syncthing; a
timer asks the running app to scan once a sync has settled, so there is only
ever one importer, the app ([`SYNC.md`](SYNC.md)).

## Catalogues and trackers

- **Links**: a series is linked to its entry in AniList (manga, novels,
  anime) or TMDB (films and shows) for metadata and covers
  ([`LINKS.md`](LINKS.md), [`COVERS.md`](COVERS.md)).
- **Tracking**: reading is sent to AniList and MyAnimeList lists when the
  person signs in with their own client ids ([`TRACKING.md`](TRACKING.md)).
- **Ranobe**, a separate reading catalogue, is kept in step with what is read
  and watched here when it is set up ([`RANOBE.md`](RANOBE.md)).

Each is off while its settings are unset, and nothing fails when it is.

## Reading Japanese

Raw manga pages are read into text by mokuro, an OCR program run by a timer
(`scripts/ocr.ts`). Lookup splits text into words on the device and finds
them in a dictionary; it lives in **kotoba**, a separate library tsundoku
depends on by path, and is one language pack of a language-agnostic lookup
([`JAPANESE.md`](JAPANESE.md), [`LANGUAGES.md`](LANGUAGES.md)). Looked-up words
become candidates, and only candidates approved at the end of a session
become flashcards in **Kumiko**, a separate self-hosted app reached over its
API (`KUMIKO_URL`, `KUMIKO_TOKEN`, `KUMIKO_DECK`). Mining every lookup
automatically would flood the deck. Both OCR and Kumiko are optional.

## The devices

- **The PWA**: installed to the home screen it runs fullscreen. A service
  worker keeps the next chapters of what is open, so reading survives the
  network dropping ([`INSTALL.md`](INSTALL.md), [`OFFLINE.md`](OFFLINE.md)).
  Installing, offline chapters, the wake lock and the fingerprint gate need a
  secure context: localhost or HTTPS.
- **The Android app** (`android/`): one Gradle project built twice, as a TV
  app and as a phone and tablet app. Each is one activity holding a WebView,
  paired with a six-digit code instead of a typed password, with zoom off and
  its own updates ([`ANDROID.md`](ANDROID.md)).
- **The layout** is chosen by CSS media queries, not script, so the first
  paint is right: phone, tablet, desktop (a fine pointer), and the ten-foot TV
  layout (no pointer) driven by a D-pad through a focus layer
  ([`TV.md`](TV.md), [`FOCUS.md`](FOCUS.md), [`TOUCH.md`](TOUCH.md)).
- **The look** is the Index design system ([`design/README.md`](design/README.md)),
  and motion follows [`MOTION.md`](MOTION.md).

## Serving

`yarn run serve` (`scripts/serve.ts`) runs the build in one of three modes
([`SERVING.md`](SERVING.md)):

- **`local`**, a release's default: `127.0.0.1` only, origin
  `http://localhost:42143`, which browsers count as a secure context.
- **`https`**: the app on `127.0.0.1`, published on a private network through
  `tailscale serve` on HTTPS, never to the internet.
- **`http`**: a plain bind to a named address; a wildcard bind is refused
  unless asked for by name.

In every mode `ORIGIN` is derived from the bound address, so every POST passes
SvelteKit's origin check. A phone on the same home Wi-Fi can be let in by
SETTINGS' WI-FI row, over plain http with what that costs
([`WIFI.md`](WIFI.md)).

## Releases

A release is a native bundle per platform (`win-x64`, `linux-x64`, and a
Windows installer around it) carrying everything the app needs: Node, the
built app, a JRE, `engine.jar` and ffmpeg, with FlareSolverr as an optional
archive beside it that the launcher starts once it is unpacked. Nobody installs
Docker or runs those by hand ([`DISTRIBUTION.md`](DISTRIBUTION.md)). A served
install runs a released bundle, not a checkout, so a change reaches it only
in a release. How one is built, smoke-tested and published, and the two
Android APKs beside it, is [`RELEASE.md`](RELEASE.md); how an install learns
of a newer one and updates is [`UPDATES.md`](UPDATES.md). Versions are dates,
`YYYY.MM.DD[.N]`, tagged `release/<version>`. The project's website is
[`WEBSITE.md`](WEBSITE.md).

tsundoku is PolyForm Noncommercial 1.0.0; the engine keeps upstream's MPL-2.0
([`DISTRIBUTION.md`](DISTRIBUTION.md), "Licences").

## Limits

- There is no Komga-compatible API: other reader apps cannot read the
  library.
- A web page no LNReader plugin covers cannot be added by pasting its address.
- There is no macOS bundle and no Docker image of tsundoku itself
  ([`DISTRIBUTION.md`](DISTRIBUTION.md), "Limits").
