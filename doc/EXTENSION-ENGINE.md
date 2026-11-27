# The extension engine

tsundoku runs Mihon (manga) and Aniyomi (anime and video) extensions through an
engine it talks to over HTTP: **tsundoku-engine, a pinned fork of
[kodjodevf/M-Extension-Server](https://github.com/kodjodevf/M-Extension-Server)**
(MPL-2.0), kept in its own repository beside this one and shipped in a release
as `engine/engine.jar` ([`ARCHITECTURE.md`](ARCHITECTURE.md), "Finding and downloading").
The engine answers "what are the pages, and give me their bytes"; everything
else (repositories, the queue, the library) is tsundoku's
([`DOWNLOADS.md`](DOWNLOADS.md)).

This document is the contract with the engine, why it is this engine, and what
is known of how the sources behave through it. The fork's own `doc/FORK.md`
lists every change from upstream and why, and how to follow upstream.

## Running it

| Piece        | Where                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The fork     | The `tsundoku-engine` repository. Its `doc/FORK.md` lists every change from upstream and why                                                                                                                                                                  |
| A release    | The bundle's own `engine/engine.jar`, run by the launcher with the bundle's JRE on `127.0.0.1:4590` (`ENGINE_PORT`). Under the data folder: its app directory `engine/app`, its APKs `engine/apks` (under each APK's SHA-256, its handle), and `engine/prefs` |
| Development  | `ops/engine/compose.yml`: an image built from the fork, on `127.0.0.1:4591`, its APKs under `ENGINE_DATA`, started by hand. 4591, so it can run beside a release's engine                                                                                     |
| The settings | `ENGINE_URL` and `ENGINE_TOKEN` in tsundoku's `.env` ([`SECRETS.md`](SECRETS.md))                                                                                                                                                                             |
| The solver   | FlareSolverr beside the engine: the engine asks it through `cf-proxy-url`, the app through `NOVEL_SOLVER_URL` ("The solver", below). In a release it is an optional archive the launcher runs on `127.0.0.1:8191` once it has been unzipped                   |

**In a release, the engine is the bundle's.** The launcher
(`ops/release/launcher/plan.ts`) starts `engine/engine.jar` with the bundle's
JRE, bound to `127.0.0.1` (`ENGINE_HOST`), and stops it with the app; where the
launcher runs under `ops/systemd/tsundoku.service`, `systemctl --user restart
tsundoku` restarts both. A fix to the engine reaches an install only in a
release, whose `release.json` names the engine's commit
([`RELEASE.md`](RELEASE.md)).

**For development**, build the image from the fork's checkout and start the
compose file:

```sh
docker build -t tsundoku-engine:local ../tsundoku-engine
ENGINE_TOKEN=<the dev .env's> docker compose -f ops/engine/compose.yml up -d
```

Updating the fork in development: rebuild the image, then `up -d` again.
Updating FlareSolverr: change its tag in the compose file.

### What the fork adds to the contract

- **Every call but `/` needs `Authorization: Bearer $ENGINE_TOKEN`**, the
  `/image/` and `/video/` proxies included (ffmpeg takes it with `-headers`).
  Upstream authenticates nothing, and its proxies fetch through every source's
  client and cookies.
- **It listens where it is told** (`ENGINE_HOST`). Upstream binds every
  interface; on a desktop that puts the engine on the LAN and raises a firewall
  prompt.
- **Handles survive a restart.** An APK is stored under its handle when it
  loads (`ENGINE_APK_DIR`), and a handle the process forgot is reloaded from
  there, so a 409 means "never sent", not "the engine restarted".
- **Preferences are the client's.** Send the source's values with every call,
  with `preferenceApplyMode: replace-present`; the engine's own copy is never
  relied on ("Preferences", below).
- **No `/youtube/resolve`**: NewPipe (GPLv3) is removed, and `/capabilities`
  reports `"youtubeResolver": false`.
- **QuickJS works**, including a reused instance, and **ProtoBuf sources
  load** ("Why a fork", below).
- **Typed filters** (`filterSchemaManga`, `filterSchemaAnime`), **the hosts
  being solved** (`GET /challenges`), **anime posters and episode pictures
  through the `/image/` proxy**, and **WebView extensions in a headless
  Chromium** (`ENGINE_WEBVIEW`): all in "API reference" and "WebView
  extensions", below.
- **Request threads have 64 MB stacks.** Extensions run on the request thread,
  and the JVM's regex recurses once per repetition where Android's (ICU) does
  not, so a pattern over a whole page overflowed the default 1 MB stack. The
  stack is reserved, not committed.
- Pass FlareSolverr as `cf-proxy-url: http://flaresolverr:8191/v1` to the
  development engine: that is its address from inside the compose network, not
  from the host.

Every addition is behind an environment variable, off when unset, so an engine
started without them behaves as upstream does.

## The solver

FlareSolverr is a `/v1` solver (Byparr's protocol is the same): a `POST` with
`{ cmd: 'request.get', url, maxTimeout }` answers the page it fetched and the
cookies and user agent that got past the site's check. The engine uses it for
an extension, through `cf-proxy-url`. **tsundoku itself uses it for an LNReader
plugin**, whose host process refuses local addresses on purpose, a solver being
one ([`NOVELS.md`](NOVELS.md), "Past a site's bot check"). It also fetches a
page itself (`request.get`, or `request.post` with a url-encoded form) for a
host whose check is bound to the solving browser ([`NOVELS.md`](NOVELS.md), "A
check bound to the browser").

The two addresses are deliberately different:

- **`ENGINE_SOLVER_URL`** is what tsundoku sends the engine as `cf-proxy-url`.
  Its default, `http://flaresolverr:8191/v1`, is a name only the engine's
  compose network resolves; the app can't use it.
- **`NOVEL_SOLVER_URL`** is where the app asks the solver itself. Unset, it
  falls back to `ENGINE_SOLVER_URL` when that is a loopback address the app can
  reach (a release, where the launcher sets `http://127.0.0.1:8191/v1`), and
  otherwise to `http://127.0.0.1:8193/v1`.

Development publishes the solver on **`127.0.0.1:8193`**, never `8191`, which
belongs to a release's own solver (`ops/engine/compose.yml`); a development
`.env` sets `NOVEL_SOLVER_URL=http://127.0.0.1:8193/v1`. The engine keeps
reaching the same container as `http://flaresolverr:8191/v1` inside its
network, so publishing changes nothing for it.

A first solve takes 20–45 s. The app checks the URL is on the internet
(`net-guard.ts`) before the solver hears of it, asks once per host at a time,
and keeps only that host's clearance cookies and its user agent; a cookie for
another host, or one from a redirect's host, is dropped. Its cookies carry
`secure`, so a clearance with any secure cookie is https-only and the host never
sends it over `http:`. `site_checks` gets the host on success, so BROWSE knows a
first visit waits ([`BROWSE.md`](BROWSE.md), "A site's check").

### The solver's browser

**On Linux, a release's FlareSolverr drives the system's Chromium or Chrome,
not its own.** The Chromium FlareSolverr's Linux build carries is a `.0`
snapshot (142.0.7444.0 in 3.4.6, 153.0.8010.0 in 3.5.2) that reaches
Cloudflare's "Just a moment..." page and never clears it. Measured on the
workstation on 2026-11-23, solving `https://kumaraw.com/`, each row its own
`HOME` so no two share undetected-chromedriver's driver cache:

| FlareSolverr, browser                                        | Result                                            |
| ------------------------------------------------------------ | ------------------------------------------------- |
| 3.4.6 bundle, its own Chromium 142.0.7444.0 (the release)    | timeout at 60 s, every time                       |
| 3.4.6 bundle, its own Chromium, the bundle's libraries off   | timeout at 60 s, twice: the browser, not the libs |
| 3.5.2 bundle, its own Chromium 153.0.8010.0                  | timeout at 60 s, three times out of three         |
| 3.4.6 bundle, Arch's Chromium 153.0.8010.36                  | solved, 22–27 s, `cf_clearance` set               |
| 3.4.6 bundle, Google Chrome 153.0.8010.36                    | solved, 19–26 s                                   |
| 3.4.6 bundle, the launcher's wrapper over Arch's Chromium    | solved, 27–29 s, three out of three               |
| `ghcr.io/flaresolverr/flaresolverr:v3.4.6` (Debian Chromium) | solved, 15–17 s, every time                       |

FlareSolverr has no setting for its browser: it runs
`_internal/chrome/chrome` whenever that file is there, and searches `PATH`
only when it isn't. Setting the file aside alone is not enough, because its
PyInstaller build puts `_internal` first on `LD_LIBRARY_PATH` for every
program it starts, and a system Chromium loading those libraries dies
(Arch's: `libharfbuzz-subset.so.0: undefined symbol: hb_calloc`). So the
launcher (`solverBrowser`, `ops/release/launcher/plan.ts`) renames the
bundled one to `chrome.bundled-off` and writes a wrapper in its place that
puts the library path back and runs the first of `chromium`,
`chromium-browser`, `google-chrome-stable` and `google-chrome` on `PATH`.
It rewrites the wrapper at every start, and puts the bundled Chromium back
when the system has none, which leaves challenged sources failing as
before; the friends' README asks Linux users to install one.

FlareSolverr downloads a ChromeDriver for the browser's major version when it
starts, so a system browser updated while tsundoku runs is only picked up at
the next start. Windows keeps its bundled Chrome: whether that one clears the
check is not measured yet.

## Why a fork of M-Extension-Server

M-Extension-Server is essentially Suwayomi's AndroidCompat plus a current copy
of the Mihon and Aniyomi source APIs, cut down to a stateless RPC. That is the
part tsundoku would otherwise have to build, so it starts from it:

- **It runs the library's sources.** With a browser User-Agent and a solver,
  all nine manga sources measured pass popular, latest, details, chapters,
  pages and image bytes; search passes for seven (Toonily and Toonily.me
  search crash, "Toonily and Toonily.me search", below). MANGA Plus
  (XOR-encrypted pages) and two anime sources pass too.
- **Images come back as bytes through the source's own OkHttp client**, with
  its interceptors. MANGA Plus proves it: plain HTTP returns ciphertext, and
  the engine's bytes equal the plain bytes XOR-decrypted with the page key.
- **Source ids are Mihon's**, identical to Suwayomi's for all nine. Chapter
  URLs match Suwayomi's for every comparable source except Toonily, once the
  memo is stripped.
- **It is current.** It implements tachiyomix 1.6 (`getMangaUpdate`, memo), so
  Keiyoushi's KeiSource extensions load, and it handles Aniyomi lib 14 and 16.
- **It is cheap**: a 295 MB image, about 100 MiB idle, about 660–770 MiB under
  load, ready 2 s after start ("Resource costs").

Upstream needed fixing before it could serve:

1. **QuickJS results never parsed.** `QuickJs.java` did `line.substring(7)` on
   a `QUICJS_RESULT:` line, a 14-character marker, so every extension that
   evaluates JavaScript failed (Mangahere's page list is one). The fork reads
   after the whole marker, and takes the last marker rather than the first,
   since the runner's stdout accumulates and a reused instance otherwise
   answers every call with its first result.
2. **No ProtoBuf in Injekt.** Mihon's app module provides one, so MANGA Plus
   and any protobuf source died in a static initialiser. The fork adds
   `addSingletonFactory<ProtoBuf> { ProtoBuf }` to `AppModule.kt`. The explicit
   type parameter matters: without it the factory is keyed as
   `ProtoBuf.Default` and the lookup still fails.
3. **NewPipe (GPLv3) had to come out** for tsundoku to ship the engine in its
   bundle ("Licences").

Building an engine instead, from Suwayomi's AndroidCompat and Aniyomi's
extensions-lib (both Apache-2.0), would mean writing what M-Extension-Server
already has:

- The Android shims extensions touch: Application, SharedPreferences, Looper,
  PreferenceScreen and its preference types, WebView stubs, Log, Base64.
- Current source APIs: Mihon tachiyomix 1.6 (`getMangaUpdate`, memo, suspend
  catalogue methods) and Aniyomi lib 14–16 (hosters, seasons, `resolveVideo`,
  the extension-run HttpServer). AndroidCompat alone gives neither.
- An Injekt graph matching Mihon's and Aniyomi's app modules, ProtoBuf
  included. A missing entry is a silent runtime failure, as MANGA Plus showed.
- NetworkHelper: cookie jar, user-agent handling, rate-limit interceptors, and
  a Cloudflare path (a solver, or a real headless browser for WebView
  extensions).
- A working QuickJS.
- APK loading: dex2jar, or better, Keiyoushi's prebuilt JARs, which would avoid
  the Toonily search mistranslation.
- An image proxy through the source's client, and a video proxy that rewrites
  manifests and sanitises MPEG-TS.

That is months of work to reach where this engine is, with the same upkeep of
tracking two upstream source APIs. tsundoku keeps its side of the contract
narrow (the methods below, `/image/`, `/video/`) so the engine stays
replaceable, and the QuickJS and ProtoBuf fixes are ones to send upstream.

## Resource costs

| What                         | Measured                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------- |
| First Docker build (cold)    | 279 s; rebuilds 214 s and 208 s (Gradle inside the build stage, no host daemon) |
| Image                        | 295 MB (distroless Java 21 plus a 243 MB shadow jar)                            |
| Start to first answer        | 2 s                                                                             |
| RAM idle                     | 103.5 MiB                                                                       |
| RAM, nine-source matrix      | peak 769 MiB (52% CPU)                                                          |
| RAM, 200 pages at 8 parallel | peak 662 MiB; 94 MB in 15 s, 0 failures                                         |
| First APK load               | 0.1–2 s (dex2jar, then cached per process)                                      |
| FlareSolverr v3.4.6          | 679 MB image, 104 MiB idle; first Kumaraw solve 16.7 s, AnimePahe 42 s          |

The jar's biggest parts are ICU (40 MB), Noto Sans fonts (38 MB), Android
resources (34 MB) and JOGL/JCEF classes. No Chromium binary ships with it: the
headless WebView downloads one on first use, only where it is turned on
("WebView extensions").

## API reference

Server: NanoHTTPD, one thread per request. Entry point:
`java -jar engine.jar <port> [appDir]`, every engine file under `appDir`; the
Docker image listens on 8080. Upstream's `docker-compose.yml` publishes
`8080:8080` on all interfaces; tsundoku's publishes on loopback only.

Upstream authenticates no endpoint, and `/stop` stops the server. The fork's
token closes both; bind it to loopback or a private Docker network all the
same.

Routes:

- `GET /` returns "mextensionserver Server Running", without the token.
- `GET /capabilities` returns a JSON object of feature flags:
  `mangayomiMihonBridge`, `sourceFactory`, `preferenceCallbacks`,
  `imageProxy`, `videoProxy`, `youtubeResolver` (false in the fork),
  `sourceUrls`, `extensionHandles`, `extensionInfo`, `webviewBridge`, and the
  fork's `webview`: whether this engine runs WebView extensions at all
  (`ENGINE_WEBVIEW`).
- Any method on `/stop` stops the server 100 ms later.
- `POST /dalvik` is the RPC (below).
- `GET /image/<token>` returns page or cover bytes, fetched through the
  source's client.
  - HTTP/1.1, two attempts on 408/425/429/5xx/52x.
  - Sends `Cache-Control: private, max-age=86400`.
  - 404 "Image not found" for an unknown token; 500 with the message as text
    on failure.
  - The token is a SHA-256 of source id, page index, url and imageUrl, held in
    an in-memory LRU of 4096.
- `GET /video/<token>[.ext]` returns video, manifest, segment, audio or
  subtitle through the source's client.
  - Honours Range.
  - Rewrites manifests so every URI is another `/video/` token, and sanitises
    MPEG-TS.
  - In-memory LRU of 32768.
- `GET /webview` (the fork's): the headless Chromium WebView extensions run in
  ("WebView extensions").
- `GET /challenges` (the fork's): `{"solving": {host: since}, "solved": {host:
at}}`, epoch ms. A host is under `solving` while CloudflareInterceptor's
  solve through FlareSolverr runs, and in `solved` once one succeeded. In
  memory; a restart forgets.

Proxy URLs are written as `http://127.0.0.1:<engine's own port>/...`, which is
8080 in Docker. A client on the host must swap the authority for the published
port.

### POST /dalvik

Body fields (JSON):

- `data`: base64 APK, on the first call or after a 409.
- `extensionId`: the handle the engine returned, on later calls.
- `method`: one of the methods below.
- `sourceId`: the Mihon/Aniyomi source id as a string (also matches two hash
  forms Mangayomi uses).
- `sourceBaseUrl`, `lang`: fallbacks for picking a source in a multi-source
  extension.
- `page`, `search`, `filterList`.
- `mangaData`: `{url, title, artist, author, description, genre, status,
thumbnail_url, initialized}`.
- `chapterData`: `{url, name, date_upload, chapter_number, scanlator}`.
- `animeData`, `episodeData`: the same shapes, for anime.
- `preferences`: the client's preference snapshot (below).

There is no install step and no repository concept.

- The client posts the APK bytes. The engine converts them with dex2jar, loads
  them in their own class loader, keeps one instance per APK for the process
  lifetime, and returns the APK's SHA-256 as `X-Mangayomi-Extension-Id`.
- Later calls may send only `extensionId`. A handle the engine has neither
  loaded nor stored answers 409 `{"error":"Extension handle ... is no longer
loaded; resend the APK","code":409}`.
- Reading indexes, downloading APKs, versions, updates and signature checks are
  all the client's job.

Source selection: a single source wins. Otherwise the match is by `sourceId`,
then `sourceBaseUrl`, then `lang`, else the first. MangaDex's factory exposes
all its languages, so `sourceId` is required there.

Request headers it reads:

- `User-Agent`: copied into `NetworkHelper.setUA`, process-wide and sticky,
  unless it starts with "Dart/". A Python client's UA turned eight of nine
  sources into 403 until a browser UA was sent.
- `Cookie`: added to the source's cookie jar on its base domain.
- `cf-proxy-url`: a FlareSolverr/Byparr `/v1` URL. CloudflareInterceptor uses
  it when a response is a challenge.
- `source-base-url` and `x-mangayomi-webview-port`: Mangayomi's.

Responses are JSON with the method's result. Errors are
`{"error":"<message>","code":n}`.

- 409 for an unknown handle.
- The source's HttpException status is mirrored for 400/401/403/404.
- 500 for everything else, 429 included, so a rate limit can't be told apart
  by status.
- So tsundoku reads the body (`failureOf`, `protocol.ts`): its `code` when the
  site's status came through, and its words when an extension threw the limit
  as text ("You have been rate limited", AnimePahe). Either is `rate-limited`,
  and BROWSE says the source ASKED TO SLOW DOWN, with no TRY AGAIN to hammer it
  with.
- **No answer in time is a slow source, not a stopped engine**
  (`unreachable`, `client.ts`): only a refused or reset connection is `down`.
  A Cloudflare solve outlasting the timeout would otherwise read as "NOT
  ANSWERING · THE EXTENSION ENGINE".

Methods (manga; the anime ones are the same with Anime/Episode, plus
`getVideoList`):

- `extensionInfo` returns `{packageName, name, versionName, versionCode, lang,
isNsfw, itemType, sources:[{id, name, lang, baseUrl}]}`, and the fork's
  `usesWebView`: the extension's code names `android.webkit.WebView`.
- `sourcesManga` / `sourcesAnime` return `[{id, name, lang, baseUrl}]`, with
  factory sources rebuilt after preferences are applied.
- `getPopularManga` (page), `getLatestManga` (page), `getSearchManga` (page,
  search, filterList) return `{mangas:[{url, title, artist, author,
description, genre, status, thumbnail_url, initialized}], hasNextPage}`.
  `thumbnail_url` is an `/image/` proxy URL, for anime too in the fork.
- `getDetailsManga` (`mangaData.url`) returns the manga via
  `getMangaUpdate(fetchDetails=true)`. A 1.6 source may return a blank url or
  title (Mangahere does), so the host keeps its own.
- `getChapterList` (`mangaData.url`) returns `[{url, name, date_upload,
chapter_number, scanlator}]`, newest first. The anime call's episodes carry
  the fork's `preview_url` too: the episode's picture as an `/image/` proxy
  URL, or null where the extension sets none.
- `getPageList` (`chapterData.url`) returns `[{index, url, imageUrl,
headers}]`. `imageUrl` is an `/image/` token, or a direct URL plus the
  headers to send.
- `getMangaUrl` and `getChapterUrl` return the web URL.
- `filtersManga` returns the filter list; `headersManga` returns the default
  headers as `[name, value, ...]`; `supportLatestManga` returns a boolean.
- `filterSchemaManga` / `filterSchemaAnime` (the fork's) return the same
  filters typed: `[{type, name, state, values, children}]`, type one of
  select, sort, checkbox, tristate, text, group, header, separator. A select's
  state is its index and `values` its labels (each value's toString, as Mihon
  draws it); a sort's state is `{index, ascending}` or null; a tri-state's 0
  ignore, 1 include, 2 exclude; a group has `children` and no state.
  `filtersManga` itself is Jackson's dump of the extension's classes: no type,
  and the extension's minified fields (`a`, `b`, ...) beside the base ones, so
  read the schema, never it.
- Filters go back into `getSearchManga` as `filterList: [{name, type, stateInt
| stateString | stateSort | stateList}]`, matched against the source's own
  list **by name**; a name the source doesn't have is ignored (Weeb Central
  has no "Cooking" tag, and asking for it changes nothing). select and
  tristate send `stateInt`, text `stateString`, sort `stateSort {index,
ascending}`, a group `stateList [{name, type, stateBoolean | stateInt}]`
  (checkbox children `stateBoolean`, tristate and select children
  `stateInt`). Two quirks of upstream's reader: a **top-level** checkbox is
  read from `stateList[0].stateBoolean`, not a field of its own, and a text
  inside a group is read from the child's `name`. Measured live on Weeb
  Central's sort select and a status checkbox group, MangaDex's Theme
  tri-state, and Asura's sort.
- `preferencesManga` and `setPreferenceManga` return the preference screen as
  maps.
- `getEpisodeList` (`animeData.url`) returns episodes, with seasons flattened.
- `getVideoList` (`episodeData.url`) returns `[{url, quality, videoUrl,
headers, subtitleTracks:[{url, lang}], audioTracks:[{url, lang}],
timestamps, status, progress, ...}]`.
  - `headers` is OkHttp's internals: `{"namesAndValues$okhttp":[name, value,
...]}`.
  - Hosters are resolved in parallel with a 30 s budget each.

A page is proxied when the source overrides `fetchImage`, has client
interceptors the default client lacks, has a URL that isn't plain http(s) or
contains `#`, or a Cloudflare clearance was solved for the host. Every page of
every source tested comes back proxied, because 1.6 sources build their own
client. In practice tsundoku downloads through the engine.

Preferences:

- Sent with every request as `[{key, <type>: {..., value | valueIndex |
values}}]`. The types are `checkBoxPreference`, `switchPreferenceCompat`,
  `editTextPreference`, `listPreference` and `multiSelectListPreference`.
- Written into the source's SharedPreferences only for keys not already
  present, unless a **`mangayomi_bridge_context`** entry says
  `preferenceApplyMode: replace-present`.
- `setPreferenceManga` changes the key named by that context's
  `changedPreferenceKey` and returns the screen.
- Storage is `java.util.prefs`, which a copy kept across restarts would let
  outlive the client's change, so tsundoku owns the values and resends them in
  replace mode with every call.

Memo:

- 1.6 sources may attach a memo (JSON) to a manga or chapter. The engine
  appends it to the URL as `<url>|mangayomi-memo|<base64url JSON>` and splits
  it off when the URL comes back. It also caches memos in memory (LRU 8192).
- Asura, Toonily, Toonily.me and Omega Scans do this.
- The URL before the marker is the Mihon URL. The memo must be kept and sent
  back.

## What the client does

Everything but the pages and their bytes is the client's. What tsundoku does
on its side, and why ([`DOWNLOADS.md`](DOWNLOADS.md) has the queue and the
screens):

1. **Repositories and extensions.** Read Keiyoushi's v2 `index.json`
   (`index.min.json` is a stub there) and an Aniyomi repository's index
   (`repo-index.ts`); download APKs and check each against the repository's
   signing key, Android's APK Signature Scheme v2 and the certificate's
   fingerprint both (`apk-signature.ts`); track versions and updates, and map
   source id to APK.
2. **Handles.** Send the APK on first use and keep the returned handle; on 409,
   resend.
3. **A browser User-Agent on every call** (or one starting "Dart/"). Any other
   UA becomes the user agent of every source in the engine.
4. **A solver**, passed as `cf-proxy-url` on every call. Allow 20–45 s for a
   first solve.
5. **Preferences**: store each source's values and send the snapshot with
   every call.
6. **Identity.** Key series and chapters by `mihon:<source id>:<url before
|mangayomi-memo|>`; store the memo beside the key and send the full URL
   back; store the URL a details call returns, which can differ (Toonily); keep
   its own title and URL when a 1.6 source returns blank ones.
7. **Chapter numbers** are recognised from chapter names
   (`src/lib/import/chapter-number.ts`), since 1.6 sources return -1.
8. **The queue.** One RPC at a time per source: the engine serialises calls
   into one extension anyway, so a long search delays downloads, and searches
   must not starve them. Parallel image fetches per chapter (6–8 are fine).
   Per-source rate limits on top of the extensions' own, and retries with
   backoff. Every non-409 error but 400/401/403/404 is a 500, so "rate
   limited" and "gone" are told apart by the body, not the status.
9. **Pages.** Call `getPageList` right before downloading a chapter; fetch
   every page through `/image/<token>`; check each body is an image by its
   magic bytes, since content types lie (Weeb Central serves JPEG as
   `image/png`); refetch the page list after an engine restart, because the
   tokens 404.
10. **CBZs.** Write pages in order, plus a `ComicInfo.xml` in the shape
    `src/lib/server/zip.ts` and the Mihon importer read, to a `.partial` name
    then renamed, so a half-written chapter never looks finished. The
    importer's end-of-central-directory check only protects against truncated
    files, not partial ones.
11. **Anime.** Call `getVideoList` right before each attempt and pick a
    quality; unpack `headers.namesAndValues$okhttp` into pairs; hand ffmpeg
    the video URL with those headers and `-extension_picky 0`, plus the
    separate audio and subtitle tracks, mapped into one MKV; fetch proxied
    streams only through the engine, and re-resolve on failure.
12. **Following.** The engine has no library, no schedule and no database;
    checking followed series for new chapters is tsundoku's.

### Repositories on your own network

A repository's index, an APK, and an LNReader plugin's file are fetched
through the address guard (`trustingFetch`, `src/lib/server/net-guard.ts`),
as pages, covers and streams are: every hop, redirects included, must be on
the internet, checked both when the address is read and when the socket
connects, and the body is read to a limit (`readCapped`). An index can name
any address, so without the guard a repository could aim tsundoku at the
workstation's own ports or the tailnet.

**One exception: the repository the reader typed.** A repository can be the
reader's own server on the home network (an extension repository on
loopback may even be plain `http`, `repoBase`). So a hop on **the origin of
the address typed in BROWSE › EXTENSIONS** (scheme, host and port, compared
exactly) may be local. That lets the index and whatever it serves from that
same host load. Anything the index names on another host, another port, or
the same machine spelled another way (`[::ffff:127.0.0.1]` for `127.0.0.1`),
and any redirect away from the typed origin, is checked as any other address
and refused when it is local. Repositories are only ever added from that
form, so the trusted origin is always one the reader chose.

**In the web edition** the same fetches go through the fetcher extension in
the reader's browser, which refuses the reader's own network by the same
definition (`src/lib/server/public-ip.ts`), redirects and DNS rebinding
included. Its one way back is hosts the reader allows in the fetcher's own
options, so a repository on the reader's NAS is allowed there, by its host
([`WEB-EDITION.md`](WEB-EDITION.md), "The reader's own network").

Tests: `tests/net-guard.spec.ts` ("a repository on the reader's own
network"), and, through the real fetch, `tests/engine-extensions-db.spec.ts`
(a loopback repository installs the APK it serves itself, and its index's
mapped-IPv6 APK is refused) and `tests/novel-plugins-db.spec.ts` (the same
for a plugin's file, and a local plugin from a repository on the internet).

## The sources, through the engine

### Mihon manga

Keiyoushi's `https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json`
is a two-entry stub ("Outdated App", "Update to Mihon 0.20.1+"). The real
index is v2: `index.json` / `index.pb` on the same branch (`repo.json` names
`index_v2`).

- It lists about 1,400 extensions, all extensionLib "1.6".
- APKs are GitHub release assets, with a prebuilt `.jar` beside each, plus
  sha256 and the signing-key fingerprint.
- The engine reads no index, so its format doesn't matter to it.

Measured with a browser UA, `cf-proxy-url` for Kumaraw, on the fork:

| Source (id)                           | Popular | Latest | Search | Details             | Chapters | Pages | Image bytes                  | Notes                                                                                                                |
| ------------------------------------- | ------- | ------ | ------ | ------------------- | -------- | ----- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Asura Scans (6247824327199706550)     | ✓ 20    | ✓ 20   | ✓ 3    | ✓                   | ✓ 190    | ✓ 17  | ✓ webp                       | URLs carry a memo                                                                                                    |
| Toonily (5190569675461947007)         | ✓ 25    | ✓ 25   | ✗      | ✓                   | ✓ 114    | ✓ 16  | ✓ jpeg                       | Search: ClassCastException "y0 cannot be cast to k" (dex2jar). New URL scheme; stuck guard on legacy URLs            |
| Toonily.me (1581110056159285576)      | ✓ 24    | ✓ 24   | ✗      | ✓                   | ✓ 232    | ✓ 7   | ✓ webp                       | Search: InstantiationError c2 (dex2jar)                                                                              |
| Mangahere (2)                         | ✓ 70    | ✓ 70   | ✓ 12   | ✓ (blank url/title) | ✓ 220    | ✓ 23  | ✓ jpeg                       | Pages need QuickJS (upstream fails them). A one-word query gave 0, a two-word one 12                                 |
| MangaDex en (2499283573021220255)     | ✓ 20    | ✓ 68   | ✓ 1    | ✓                   | ✓ 112    | ✓ 21  | ✓ jpeg                       |                                                                                                                      |
| Weeb Central (2131019126180322627)    | ✓ 32    | ✓ 32   | ✓ 1    | ✓                   | ✓ 232    | ✓ 31  | ✓ jpeg (served as image/png) |                                                                                                                      |
| Omega Scans (1534451209269193504)     | ✓ 12    | ✓ 12   | ✓ 1    | ✓                   | ✓ 126    | ✓ 11  | ✓ jpeg                       | Logs "Failed to fetch filter data", harmless                                                                         |
| Kumaraw (6580524146378639197)         | ✓ 14    | ✓ 32   | ✓ 2    | ✓                   | ✓ 33     | ✓ 50  | ✓ jpeg                       | Every call 403 without a solver (Cloudflare cf-mitigated: challenge); all pass with cf-proxy-url; first solve 16.7 s |
| Webtoons.com en (2522335540328470744) | ✓ 30    | ✓ 162  | ✓ 13   | ✓                   | ✓ 9      | ✓ 84  | ✓ png                        |                                                                                                                      |
| MANGA Plus en (1998944621602463790)   | ✓ 100   | –      | ✓      | ✓                   | ✓ 6      | ✓ 53  | ✓ jpeg                       | Needs ProtoBuf in Injekt (upstream fails it)                                                                         |

Every source except Webtoons returns `chapter_number = -1` for every chapter.
1.6 leaves numbering to the host (Mihon's chapter recognition; Suwayomi fills
in 1.0, 2.0...).

With the token and a restart between: MangaDex, Mangahere and Kumaraw answer
POPULAR (Kumaraw through FlareSolverr, 17.5 s on the first call), all three
answer with only their handle after the restart, and Mangahere's page list
(the QuickJS path) gives 19 pages whose first comes back through `/image/` as
a JPEG.

### Toonily: legacy URLs and a stuck guard

Toonily 1.6.72 keys a series by post id: popular gives
`5871|mangayomi-memo|{"path":"/serie/..."}`, and chapters are
`chapter-1|mangayomi-memo|{...}`. Series added before the change are keyed by
the old `/webtoon/<slug>/`, with chapters at
`https://toonily.com/serie/<slug>/chapter-1/?style=list`.

On a fresh engine:

```
A chapters(old url, fresh)   200  114 chapters
B chapters(old url, again)   500  getMangaUpdate must not be called concurrently for same manga
C chapters(new url)          200  114
D chapters(new url, again)   200  114
```

`KeiSource.getMangaUpdate` marks `manga.url` as in flight and clears
`manga.url` in `finally`. The extension rewrites the URL in place while
resolving the legacy one, so the old key stays marked until the engine
restarts. This is Keiyoushi's code, not the engine's, but any host keeping
legacy URLs hits it. Details for the old URL also return the new
`/serie/<slug>/`, so tsundoku stores the URL a source returns: `engine_series`
and `engine_chapters` hold what the extension calls a series and a chapter
now, while the series' key and the entries' URLs never move, and a source's
chapters are matched to entries by URL, then by recognised chapter number
(`matchSourceChapters`, `src/lib/server/engine/device.ts`). The same change
reaches Mihon backups made on a device.

### Toonily and Toonily.me search: most likely dex2jar

In the dex2jar-converted Toonily.me, `j1.c` does `new c2`, where `c2` is
`public abstract class c2 extends Filter$Select`, which explains the
InstantiationError. ART can't instantiate an abstract class either, so the
original dex must name a concrete subclass. In Keiyoushi's prebuilt JAR of the
same version, the "Sort By" filter is a concrete `final class ap extends ao`.
Toonily's cast between two sibling `Filter$CheckBox` classes fits the same
pattern.

This is not proven, but it points at dex2jar, which Suwayomi also uses.
Loading Keiyoushi's JARs (`jarUrl` in the v2 index) would skip that step; the
engine does not offer it, and Yuzono's anime index publishes APKs only.

### Image fetching: bytes through the source's client

`getPageList` registers each page and returns `/image/<token>`. Fetching that
runs `imageRequest` and the client's interceptors and returns the bytes.
Compared against plain fetches of URLs taken from each site independently:

- MangaDex:
  - No headers: 403 (17 bytes).
  - Browser UA via uploads.mangadex.org: identical, 3/3. The at-home node 404s
    a plain request.
- Webtoons:
  - Without a Referer: 403, with or without a UA.
  - With Referer `https://www.webtoons.com/`: identical, 3/3.
- Weeb Central:
  - No UA: 403.
  - Browser UA: identical, 3/3. JPEG served as `image/png`.
- MANGA Plus:
  - Without `Plus-Vw-Token`: 400.
  - With the token: 200 `image/jpeg` whose bytes are not an image (XOR
    ciphertext).
  - After XOR with the page key: identical to the engine's bytes, 3/3
    (787,681, 1,167,697 and 1,093,652 bytes).

So the proxy is required, not a convenience: sites need the source's headers,
MANGA Plus needs its interceptor, and solved clearances live only in the
engine's cookie jar.

Image fetches don't take the per-extension lock: 12 pages took 1.20 s
sequentially and 0.34 s six at a time. Tokens die with the process; an old
`/image/` URL answers 404 after a restart.

### Source ids and URLs

Ids: for all nine, `extensionInfo`'s id equals both the Keiyoushi v2 index's and
Suwayomi's. MangaDex en is 2499283573021220255 everywhere, and its other
languages match too; Mangahere is 2. `mihon:<source id>:<url>` keys carry over
unchanged.

URLs (Suwayomi library series against the engine, memo stripped):

- Series and chapters match for Asura (`/series/<slug>`, `.../chapter/1`),
  Toonily.me, Mangahere (`/manga/<slug>/c001/1.html`), MangaDex
  (`/chapter/<uuid>`), Weeb Central (`/chapters/<ULID>`), Omega Scans
  (`/series/...#8`, `.../chapter-1#1124`) and Kumaraw (`.../chapter-2-1`).
- Toonily differs on both, from the extension's new scheme ("Toonily: legacy
  URLs and a stuck guard").

### Aniyomi anime

Kohi-den's extensions repository is archived and its domain parked, so the
anime extensions come from Yuzono's repository
(`https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json`:
about 250 extensions, on lib 14 and lib 16).

Measured (query "frieren", with `cf-proxy-url`):

- AnimePahe 16.56:
  - Popular ✓ 12 (42 s via solver), search ✓ 3, details ✓, episodes ✓ 28,
    videos ✓ 6.
  - All six videos are HLS, all proxied.
  - The extension runs its own local HTTP server inside the engine
    (`http://localhost:34033/m3u8?url=...`), which the engine proxies.
- KickAssAnime 14.63:
  - Popular ✓ 24, search ✓ 3, details ✓, episodes ✓ 28, videos ✓ 3 (direct
    HLS plus headers).
  - Audio and subtitles are separate proxied `.m3u8` and `.vtt` tracks.
  - Segments are MPEG-TS disguised as `.jpg` on rotating hosts; the first
    bytes are 0x47, the MPEG-TS sync byte.
- AniZone 16.16: lists, gives episodes and 2 videos. AniZone has no WebView
  code; 16.15 and 16.16 died with `StackOverflowError` in the JVM's recursive
  regex on the request thread's 1 MB stack, which the fork's 64 MB request
  threads fix.

Download (ffmpeg n9.0.1, with the returned headers and `-extension_picky 0`):

- AnimePahe via the engine's `/video/` playlist: `-t 20` took 1 s, producing
  H.264 1920x1080 plus AAC, 20.10 s, 2.7 MB.
- KickAssAnime direct: H.264 1920x1080, 20.06 s, 9.2 MB, video only. Muxed
  with its Japanese audio and English subtitle tracks (`-map 0:v -map 1:a -map
2:s`): H.264 + AAC + SubRip, 20.06 s.

Expiry:

- Neither URL carries a signed expiry.
- KickAssAnime's manifest and segments still answered 200 five minutes later.
- AnimePahe's upstream (`vault-08.uwucdn.top/stream/.../uwu.m3u8`) gives a
  Cloudflare 403 to a plain client even with the extension's headers. Access
  depends on clearance cookies held in the engine, so it is downloadable only
  through the engine's proxy, which forgets every token on restart.
- Resolve the video list right before each attempt and again after any
  failure. Cookie lifetime beyond a few minutes is not measured.

**Films and live-action TV.** The same repositories carry film and TV sources,
and the same calls serve them: a film comes back as one episode and a show as
one entry with every season flattened. Of the ten English sources loaded, two
played; what tsundoku adds for them is its own model of a film and a show, not
a source or an engine change ([`FILMS-SHOWS.md`](FILMS-SHOWS.md)).

### KeiSource and how current the engine's API is

- Keiyoushi requires KeiSource (`keiyoushi.source.KeiSource`, in their core
  module, compiled into each APK) for new sources. It extends HttpSource and
  finalises `getMangaUpdate` over an abstract suspend `fetchMangaUpdate`.
- The engine's Source has the tachiyomix 1.6 surface: suspend
  `getPopularManga`/`getLatestUpdates`/`getSearchManga`,
  `getMangaUpdate(manga, chapters, fetchDetails, fetchChapters)`,
  `SMangaUpdate`, and memo on `SManga` and `SChapter`.
- KeiSource extensions load and run:
  - Mangahere and Webtoons are KeiSource directly, and Keyoapp-based ones come
    through lib-multisrc.
  - Toonily and Toonily.me run through `KeiSource.getMangaUpdate` (its guard
    message is the one above).
  - KeiSource's Komikku-only related-manga members (`supportsRelatedMangas`,
    `fetchRelatedMangaList`) don't exist in the engine's HttpSource. On the JVM
    they are just extra methods, and nothing breaks.
- Aniyomi: lib 16 hosters and seasons are aligned with Aniyomi. Lib 14 falls
  back to `getVideoList`. Both work.

## Cloudflare and WebView extensions

- Only Kumaraw of the nine manga sources sits behind a managed challenge.
  FlareSolverr v3.4.6 solves it: 16.7 s once, then 0.1–0.5 s a call.
  AnimePahe's first call takes 42 s through the solver.
- Upstream's bundled Chromium does nothing: `KcefWebViewProvider` is
  registered but `KCEF.init` is never called ("Desktop WebView (CEF) is
  unavailable; will use bridge or stub"), so upstream's only solvers are a
  FlareSolverr/Byparr URL and Mangayomi's WebView bridge, which tsundoku
  doesn't have, and WebView extensions fail.

**The fork's headless WebView.** Started with `ENGINE_WEBVIEW=on`, the engine
gives every extension that uses `android.webkit.WebView`, manga or anime, for
any site, a real browser nobody sees: pages load and run their scripts,
`evaluateJavascript`, JavaScript interfaces and `shouldInterceptRequest`
behave as on Android, and the page's cookies are the extension's HTTP
client's. Nothing in the engine knows an extension or a site. The design, why
each part is so, and what was measured is the fork's `doc/FORK.md`, "Headless
WebView"; what tsundoku needs to know:

- **Off unless the launcher sets `ENGINE_WEBVIEW=on`.** tsundoku's launcher sets
  it only where SETTINGS' WEBVIEW switch is on, and that is off on every
  install until someone turns it on (below).
- **Chromium (JetBrains Runtime JCEF, Chromium 111) is downloaded** the first
  time an extension that uses a WebView is loaded, into `<engine app
dir>/webview/chromium` (`ENGINE_WEBVIEW_DIR`): 169–186 MB per platform, 359
  MB on disk. Never for an install whose extensions don't need it. The bundle
  doesn't grow.
- **Nothing appears on screen**: pages render windowless; on Linux Chromium
  gets a private Xvfb (it needs an X display even windowless), so **a Linux
  install needs Xvfb** (`xvfb`), or a desktop `DISPLAY`; without either the
  WebView fails with that instruction. Headless servers also need Chromium's
  libraries (the list is in FORK.md).
- **Failures are answers, not crashes**: Chromium is proven in a child JVM
  before the engine starts it, an extension that can't get a page hears a
  load error, and a call that comes back empty after the extension's WebView
  failed answers with an error saying what happened, not `[]`, which would read
  as "no videos". `GET /webview` and the `webview` object on a WebView
  extension's errors say why, so tsundoku can say "needs a WebView:
  downloading Chromium, 40 %" or "needs Xvfb" instead of "timed out".
- **`GET /webview`** answers `{"enabled", "state", "phase", "percent", "error",
"openPages", "waitingPages", "maxPages", "chromium", "dir"}`; `state` is
  `off` (`ENGINE_WEBVIEW` unset), `idle` (never needed yet), `starting`
  (`phase` locating, downloading with `percent`, extracting, installing,
  initializing, starting), `ready`, or `failed` with `error` saying why in
  words a person can act on ("needs an X display ... install Xvfb", "a library
  Chromium needs is missing: libXtst.so.6 ..."). It never starts anything. An
  error from an extension that uses a WebView carries this same object under
  `webview`, since the extension's own message is only its timeout.
- **At most 2 pages at once** (`ENGINE_WEBVIEW_PAGES`), each closed when the
  extension is done and after 120 s at most; idle, no Chromium process runs
  but the Xvfb, while the runtime stays in the engine (about 260 MB RSS, 200 of
  it file-backed) until it restarts.
- **Measured**: MKissa 16.75 resolves an episode's 8 videos in 8–17 s through
  it, and an extension that runs its site's own player in the page and catches
  the playlist request resolves HLS episodes in 3–11 s, on Linux with `DISPLAY`
  unset.
- **A process-group stop takes it all**: Xvfb and Chromium's processes
  (`jcef_helper`) are the engine JVM's children in its group and session.
  Measured with the bundle's JRE and MKissa, a renderer open: a SIGTERM to the
  group ends Xvfb and the renderer at once, but the JVM itself lives on until
  the extension's call in flight times out (27 s). The launcher's restart for
  the switch waits 10 s, then kills the group (below).
- **Cloudflare is still FlareSolverr's** (see "Limits").

### tsundoku's side

- **The switch.** The WebView is a per-install switch, **off by default**,
  because Chromium 111 runs streaming sites' scripts unsandboxed; it is set in
  SETTINGS › 07 — BROWSE › WEBVIEW ([`SETTINGS.md`](SETTINGS.md)). It is a file
  in the data folder, `engine/webview.json` (`{"on":true}`), as WI-FI keeps
  `wifi.json`, because the launcher has to read it before the engine starts
  and has no database (`src/lib/server/engine/webview-switch.ts`).
- **The launcher** (`ops/release/launcher/launch.ts`, `plan.ts`) reads the
  switch at every engine start and starts the engine with `ENGINE_WEBVIEW=on`
  or `off`, always said, so a stray `ENGINE_WEBVIEW=on` in the data folder's
  `.env` (which reaches the engine through the launcher's environment) can't
  turn on what the switch has off (`engineWebViewEnv`). It names Chromium's
  folder to both sides (`ENGINE_WEBVIEW_DIR`,
  `<data>/engine/app/webview/chromium`, the engine's own default) and tells
  the app where the switch is (`ENGINE_WEBVIEW_SWITCH`). It polls the file
  every 2 s; when it changes, the engine's process group is stopped and the
  engine started again with the new value, and killed outright if it hasn't
  gone 10 s later (its JVM waits out a WebView call in flight). Measured
  through a stand-in bundle: on took 4 s to show on `/capabilities`, off 3 s,
  and Xvfb went with the old engine.
- **Where nothing reads the switch** (development's compose engine, a test's
  fake), neither variable reaches the app: the engine's own `ENGINE_WEBVIEW`
  counts, and SETTINGS shows the state without a control.
- **Capability.** `support()` (`src/lib/server/engine/webview.ts`) reads
  `/capabilities`, cached 5 s: `webview: true` is `on`, `false` is `off`, no
  key at all is an older engine (`unsupported`), and no answer falls back to
  the switch (`webviewSupport`, `src/lib/webview.ts`). It is asked only when a
  screen shows an extension that uses a WebView.
- **Which extensions.** `engine_extensions.webview` (migration 78): the
  engine's `extensionInfo.usesWebView` at install and at TRY AGAIN, else the
  APK's own dex read the way the engine reads it (`apk-webview.ts`).
  Extensions installed before that migration are read from their stored APK
  on the first BROWSE or EXTENSIONS visit of a process (`fillWebViewFlags`);
  BACK TO forgets the flag, since the version gone back to may differ.
- **Failed calls.** An error that carries the `webview` object in a
  `starting`, `failed` or `off` state is `EngineFailure` `webview`
  (`failureFrom`, `client.ts`), and its message is the WebView's words instead
  of the extension's timeout: the first-use line while it comes, the engine's
  own error when it failed, "NEEDS A WEBVIEW, WHICH THIS INSTALL HAS TURNED
  OFF" when off. In a `ready` or `idle` state the extension's own words stand:
  its browser was there. A chapter that fails so waits 60 s before its next
  try, doubling with each try up to 30 minutes, as a rate limit does
  (`backoffMs`, `queue.ts`), and an episode isn't recorded as having no video.
- **What the screens say** is [`BROWSE.md`](BROWSE.md), "Extensions that need
  a WebView", and [`SETTINGS.md`](SETTINGS.md), "07 — BROWSE". The words are
  `src/lib/webview.ts`'s, one set for every screen.

## Limits

- **No state but handles.** Image and video proxy tokens, `/challenges` and
  memo caches live in memory; a restart forgets them all, and an old
  `/image/` URL answers 404.
- **Calls into one extension are serialised.** A 30-second search timeout holds
  up every page-list call for that source.
- **Toonily and Toonily.me search fail** (dex2jar, above). Loading Keiyoushi's
  prebuilt JARs most likely fixes them; the engine converts APKs only, and the
  Aniyomi repositories publish APKs only, so dex2jar stays either way.
- **Cloudflare is solved through FlareSolverr only.** The headless WebView
  could solve a challenge itself, as Mihon's interceptor does in its WebView
  (open the URL, wait for `cf_clearance`, take the cookies and the user agent,
  retry); what that would take is in FORK.md, "Not done yet". Chromium 111 may
  well be refused by today's checks, which only trying shows.
- **The headless WebView is proven on Linux only.** Windows, macOS and WSL are
  untried, and in a headless Ubuntu container Chromium loads but MKissa's page
  doesn't finish (FORK.md, "Proven, and not").
- **Chromium 111 runs unsandboxed.** `--js-flags=--jitless` would shrink what
  an exploit can do but turns WebAssembly off, which players and decryptors
  use, so it is not set; a newer Chromium needs a newer KCEF/JCEF pair.
- **Upstream has one active maintainer** and is shaped around Mangayomi
  (header names, the `|mangayomi-memo|` marker, an iOS runtime), so a rename
  there is a break here. The QuickJS and ProtoBuf fixes are not yet upstream.

## Licences (not legal advice)

- The engine is MPL-2.0. Its AndroidCompat and Mihon/Aniyomi parts are
  Apache-2.0 in origin, with changes under MPL.
  - MPL is file-level copyleft: distributing the engine, modified or not,
    means making the source of its MPL files available (the fork's changes
    included) and keeping notices.
  - tsundoku's own code, talking to the engine over HTTP, is a separate work
    and keeps its own licence. Bundled together it is at most an MPL "Larger
    Work", which MPL allows.
- Upstream's shadow jar includes NewPipe Extractor v0.26.3 (GPLv3, 480
  `org/schabi` entries). MPL-2.0 allows combining with GPL code, so a jar
  containing NewPipe is effectively distributed under GPLv3 as a whole, and
  bundling it would mean shipping a GPLv3 binary plus its corresponding
  source. Only Mangayomi's YouTube-backed sources use it, so the fork removes
  it: `YouTubeResolver.kt`, `YouTubeHandler.kt` and its test, the
  `newpipe-extractor` dependency, the `/youtube/resolve` route, and the
  `youtubeResolver` flag (false).
- Other bundled parts need notices only: KCEF/JCEF (Apache-2.0/BSD; no
  Chromium ships, the headless WebView downloads one), JOGL (BSD), ICU
  (Unicode licence), Noto Sans (OFL), OkHttp, Jackson, Kotlin (Apache-2.0).
- Extensions: Keiyoushi's extensions-source and the Aniyomi-family
  repositories are Apache-2.0. tsundoku fetches APKs at runtime and does not
  redistribute them. The sites themselves are a separate question this
  document doesn't answer.
