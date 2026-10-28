# The extension engine

Which engine runs Mihon and Aniyomi extensions for tsundoku, and the contract
with it. Decided by the spike on 2026-10-28, card c113 ("Spike: run Mihon and
Aniyomi extensions headless (M-Extension-Server)"):
**M-Extension-Server, as a pinned fork** ([`ARCHITECTURE.md`](ARCHITECTURE.md),
"Downloading"). Below is the spike's report as it was written, with the lead's
notes on top. Its scratch folder, with the engine clone, the transcripts and
the scripts, is `/mnt/hdd2/scratch/extension-spike/` (not in the repo: the
transcripts name explicit series).

## Running it

Since 2026-10-28 (c131, "Fork M-Extension-Server as tsundoku's engine, with a
solver beside it"), the engine runs on the workstation, beside Suwayomi, which
keeps downloading until tsundoku's own downloader (c125) has parity. Nothing in
tsundoku calls it yet.

| Piece        | Where                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| The fork     | `~/projects/tsundoku-engine`, `masshirodev/tsundoku-engine` (private). Its `doc/FORK.md` lists every change from upstream and why |
| The image    | `tsundoku-engine:local`, built from the fork: `docker build -t tsundoku-engine:local ~/projects/tsundoku-engine`                  |
| The compose  | `ops/engine/compose.yml`: the engine on `127.0.0.1:4590`, FlareSolverr unpublished beside it                                      |
| Its unit     | `ops/systemd/tsundoku-engine.service`, a user unit, `RequiresMountsFor=/mnt/hdd2`                                                 |
| Its APKs     | `/mnt/hdd2/tsundoku/engine/apks`, under each APK's SHA-256 (its handle)                                                           |
| The settings | `ENGINE_URL` and `ENGINE_TOKEN` in tsundoku's `.env` ([`SECRETS.md`](SECRETS.md))                                                 |

What the fork adds to the contract below:

- **Every call but `/` needs `Authorization: Bearer $ENGINE_TOKEN`**, the
  `/image/` and `/video/` proxies included (ffmpeg takes it with `-headers`).
- **Handles survive a restart.** An APK is stored under its handle when it
  loads, and a handle the process forgot is reloaded from there, so the 409
  in the report below now means "never sent", not "the engine restarted".
- **Preferences don't.** Send the source's values with every call, with
  `preferenceApplyMode: replace-present`; the engine's own copy is only this
  process's ("Preferences", below).
- **No `/youtube/resolve`**: NewPipe (GPLv3) was removed.
- **QuickJS works**, including a reused instance, and **ProtoBuf sources load**.
- Pass FlareSolverr as `cf-proxy-url: http://flaresolverr:8191/v1`: that's
  its address from inside the engine's network, not from the host.

Installed:

```sh
docker build -t tsundoku-engine:local ~/projects/tsundoku-engine
ln -s ~/projects/tsundoku/ops/systemd/tsundoku-engine.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now tsundoku-engine.service
```

**Restart it with `systemctl --user restart tsundoku-engine`, never `docker
restart`.** The unit runs `compose up --abort-on-container-exit`, so a
container restarted by Docker counts as exited: compose takes both down, and
systemd brings them back 30 s later.

Checked on 2026-10-28, against the running service: 401 without the token;
MangaDex, Mangahere and Kumaraw (through FlareSolverr, 17.5 s on the first
call) answer POPULAR; after `systemctl --user restart`, all three answer with
only their handle; Mangahere's page list (the QuickJS path) gives 19 pages and
its first page comes back through `/image/` as a JPEG.

Updating the fork: rebuild the image, then restart the unit. Updating
FlareSolverr: change its tag in the compose file.

Spike run 2026-10-28 on the workstation, against kodjodevf/M-Extension-Server at 775a6fd (2026-10-28, v1.0.9). Nothing in ~/projects/tsundoku was changed. Suwayomi was only read (GraphQL queries, no mutations). Everything here was measured unless it says otherwise. Transcripts are in transcripts/ (one JSON per call in transcripts/calls/). Scripts are in run/. The engine clone, with two patches on branch spike-fixes, is in engine/.

## Lead's notes

Checked against the live system after the spike, 2026-10-28:

- **Suwayomi does see Keiyoushi updates.** Its `extensionRepos` setting is `https://github.com/keiyoushi/extensions/raw/repo/index.pb`, and it flags Asura Scans and Omega Scans with `hasUpdate: true`; the trailing versions below are updates not installed yet. `ops/suwayomi/compose.yml` named the stub URL, which Suwayomi wasn't using; it names `index.pb` now.
- **The Toonily URL change reaches tsundoku's own keys.** All 126 Toonily series in the library are keyed by the old scheme (`mihon:5190569675461947007:/webtoon/some-series/`). Downloaded by the new extension, they'd come back under new URLs: the downloader has to map a source's new URL onto the series' existing key, or every one of them is split in two.

## Verdict: go-with-fork

M-Extension-Server can be tsundoku's engine, run as a pinned fork in a sidecar container beside a FlareSolverr (or Byparr) container. It is essentially Suwayomi's AndroidCompat plus a current copy of the Mihon and Aniyomi source APIs, cut down to a stateless RPC. That is the part we would otherwise build ourselves, so start from it.

Why it can be the engine:

- It runs the library's sources. With a browser User-Agent and a solver, all nine pass popular, latest, details, chapters, pages and image bytes. Search passes for seven; Toonily and Toonily.me search crash. MANGA Plus (XOR-encrypted pages) and two anime sources pass too.
- Images come back as bytes through the source's own OkHttp client, with its interceptors. MANGA Plus proves it: plain HTTP returns ciphertext, and the engine's bytes equal the plain bytes XOR-decrypted with the page key.
- Source ids are Mihon's, identical to Suwayomi's for all nine. Chapter URLs match Suwayomi's for every comparable source except Toonily, once a suffix is stripped.
- It is current. It implements tachiyomix 1.6 (getMangaUpdate, memo), so Keiyoushi's KeiSource extensions load. It handles Aniyomi lib 14 and 16, and had commits today.
- It is cheap: 295 MB image, about 100 MiB idle, about 660-770 MiB under load, ready 2 s after start.

Why it needs a fork rather than the upstream image:

1. QuickJS results never parse. QuickJs.java does line.substring(7) on a "QUICJS_RESULT:" line, which is 14 characters long, so every extension that evaluates JavaScript fails. Mangahere's page list is one. One-line fix, verified.
2. No ProtoBuf in Injekt. Mihon's app module provides one, so MANGA Plus and any protobuf source dies in a static initialiser. Fixed with addSingletonFactory<ProtoBuf> { ProtoBuf }, verified. The explicit type parameter matters: without it the factory is keyed as ProtoBuf.Default and the lookup still fails (tested).
3. NewPipe (GPLv3) should come out if tsundoku is ever distributed with the engine bundled. It is self-contained.

Patch diffs (branch spike-fixes):

```
--- a/AndroidCompat/src/main/java/app/cash/quickjs/QuickJs.java
+++ b/AndroidCompat/src/main/java/app/cash/quickjs/QuickJs.java
@@ -81,7 +81,7 @@ public final class QuickJs implements Closeable {
             String resultLine = null;
             for (String line : lines) {
                 if (line.startsWith("QUICJS_RESULT:")) {
-                    resultLine = line.substring(7);
+                    resultLine = line.substring("QUICJS_RESULT:".length());
                     break;
                 }
             }
--- a/server/src/main/kotlin/eu/kanade/tachiyomi/AppModule.kt
+++ b/server/src/main/kotlin/eu/kanade/tachiyomi/AppModule.kt
@@ -13,6 +13,7 @@ import eu.kanade.tachiyomi.network.JavaScriptEngine
 import eu.kanade.tachiyomi.network.NetworkHelper
 import kotlinx.serialization.ExperimentalSerializationApi
 import kotlinx.serialization.json.Json
+import kotlinx.serialization.protobuf.ProtoBuf
 import uy.kohesive.injekt.api.InjektModule
 import uy.kohesive.injekt.api.InjektRegistrar
 import uy.kohesive.injekt.api.addSingleton
@@ -35,5 +36,8 @@ class AppModule(
                 coerceInputValues = true
             }
         }
+
+        // Mihon's app module provides this; MANGA Plus and other protobuf sources inject it.
+        addSingletonFactory<ProtoBuf> { ProtoBuf }
     }
 }
```

Costs the fork does not remove, which tsundoku's side must absorb:

- No state is kept. Extension handles, image and video proxy tokens and preferences live in memory or in the container; a restart forgets them all.
- Calls into one extension are serialised. A 30-second search timeout holds up every page-list call for that source.
- No browser. Cloudflare is solved only through a FlareSolverr/Byparr URL sent per request, and WebView extensions fail (AniZone).
- Bus factor of one: 5 stars, 5 forks, one active maintainer, shaped around Mangayomi (header names, the |mangayomi-memo| marker, an iOS runtime).
- A dex2jar mistranslation breaks Toonily and Toonily.me search. It is probably not fixable in the engine, but a fork could load Keiyoushi's prebuilt JARs instead.

## Resource costs

| What                         | Measured                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| First Docker build (cold)    | 279 s; patched rebuilds 214 s and 208 s (Gradle inside the build stage, no host daemon) |
| Image                        | 295 MB (distroless Java 21 plus a 243 MB shadow jar)                                    |
| Start to first answer        | 2 s                                                                                     |
| RAM idle                     | 103.5 MiB                                                                               |
| RAM, nine-source matrix      | peak 769 MiB (52% CPU)                                                                  |
| RAM, 200 pages at 8 parallel | peak 662 MiB; 94 MB in 15 s, 0 failures                                                 |
| First APK load               | 0.1-2 s (dex2jar, then cached per process)                                              |
| FlareSolverr v3.4.6          | 679 MB image, 104 MiB idle; first Kumaraw solve 16.7 s, AnimePahe 42 s                  |

The jar's biggest parts are ICU (40 MB), Noto Sans fonts (38 MB), Android resources (34 MB) and JOGL/JCEF classes. No Chromium binary ships: KCEF would download one at init, and init is never called.

## API reference (from the source)

Server: NanoHTTPD, one thread per request. Entry point: java -jar runner.jar <port> [appDir]; the Docker image uses 8080. Upstream docker-compose.yml publishes 8080:8080 on ALL interfaces; the spike used 127.0.0.1:4590:8080.

No endpoint is authenticated, and /stop stops the server. Bind it to loopback or a private Docker network only.

Routes:

- GET / returns "mextensionserver Server Running".
- GET /capabilities returns a JSON object of feature flags: mangayomiMihonBridge, sourceFactory, preferenceCallbacks, imageProxy, videoProxy, youtubeResolver, sourceUrls, extensionHandles, extensionInfo, webviewBridge.
- Any method on /stop stops the server 100 ms later.
- POST /dalvik is the RPC (below).
- GET /image/<token> returns page or cover bytes, fetched through the source's client.
  - HTTP/1.1, two attempts on 408/425/429/5xx/52x.
  - Sends Cache-Control: private, max-age=86400.
  - 404 "Image not found" for an unknown token; 500 with the message as text on failure.
  - The token is a SHA-256 of source id, page index, url and imageUrl, held in an in-memory LRU of 4096.
- GET /video/<token>[.ext] returns video, manifest, segment, audio or subtitle through the source's client.
  - Honours Range.
  - Rewrites manifests so every URI is another /video/ token, and sanitises MPEG-TS.
  - In-memory LRU of 32768.
- GET /youtube/resolve?url= does NewPipe Extractor stream resolution (GPLv3).

Proxy URLs are written as http://127.0.0.1:<engine's own port>/..., which is 8080 in Docker. A client on the host must swap the authority for the published port.

### POST /dalvik

Body fields (JSON):

- data: base64 APK, on the first call or after a 409.
- extensionId: the handle the engine returned, on later calls.
- method: one of the methods below.
- sourceId: the Mihon/Aniyomi source id as a string (also matches two hash forms Mangayomi uses).
- sourceBaseUrl, lang: fallbacks for picking a source in a multi-source extension.
- page, search, filterList.
- mangaData: {url, title, artist, author, description, genre, status, thumbnail_url, initialized}.
- chapterData: {url, name, date_upload, chapter_number, scanlator}.
- animeData, episodeData: the same shapes, for anime.
- preferences: the client's preference snapshot (below).

There is no install step and no repository concept.

- The client posts the APK bytes. The engine converts them with dex2jar, loads them in their own class loader, keeps one instance per APK for the process lifetime, and returns the APK's SHA-256 as X-Mangayomi-Extension-Id.
- Later calls may send only extensionId. After a restart that answers 409 {"error":"Extension handle ... is no longer loaded; resend the APK","code":409} (measured).
- Reading indexes, downloading APKs, versions, updates and signature checks are all the client's job.

Source selection: a single source wins. Otherwise the match is by sourceId, then sourceBaseUrl, then lang, else the first. MangaDex's factory exposes all its languages, so sourceId is required there.

Request headers it reads:

- User-Agent: copied into NetworkHelper.setUA, process-wide and sticky, unless it starts with "Dart/". A Python client's UA turned eight of nine sources into 403 until a browser UA was sent (transcripts/manga-matrix-run1-python-ua.json).
- Cookie: added to the source's cookie jar on its base domain.
- cf-proxy-url: a FlareSolverr/Byparr /v1 URL. CloudflareInterceptor uses it when a response is a challenge.
- source-base-url and x-mangayomi-webview-port: Mangayomi's.

Responses are JSON with the method's result. Errors are {"error":"<message>","code":n}.

- 409 for an unknown handle.
- The source's HttpException status is mirrored for 400/401/403/404.
- 500 for everything else, 429 included, so a rate limit can't be told apart by status.

Methods (manga; the anime ones are the same with Anime/Episode, plus getVideoList):

- extensionInfo returns {packageName, name, versionName, versionCode, lang, isNsfw, itemType, sources:[{id, name, lang, baseUrl}]}.
- sourcesManga / sourcesAnime return [{id, name, lang, baseUrl}], with factory sources rebuilt after preferences are applied.
- getPopularManga (page), getLatestManga (page), getSearchManga (page, search, filterList) return {mangas:[{url, title, artist, author, description, genre, status, thumbnail_url, initialized}], hasNextPage}. thumbnail_url is an /image/ proxy URL.
- getDetailsManga (mangaData.url) returns the manga via getMangaUpdate(fetchDetails=true). A 1.6 source may return a blank url or title (Mangahere does), so the host keeps its own.
- getChapterList (mangaData.url) returns [{url, name, date_upload, chapter_number, scanlator}], newest first.
- getPageList (chapterData.url) returns [{index, url, imageUrl, headers}]. imageUrl is an /image/ token, or a direct URL plus the headers to send.
- getMangaUrl and getChapterUrl return the web URL.
- filtersManga returns the filter list; headersManga returns the default headers as [name, value, ...]; supportLatestManga returns a boolean.
- filterSchemaManga / filterSchemaAnime (the fork's, c140, 2026-10-28) return the same filters typed: `[{type, name, state, values, children}]`, type one of select, sort, checkbox, tristate, text, group, header, separator. A select's state is its index and `values` its labels (each value's toString, as Mihon draws it); a sort's state is `{index, ascending}` or null; a tri-state's 0 ignore, 1 include, 2 exclude; a group has `children` and no state. filtersManga itself is Jackson's dump of the extension's classes: no type, and the extension's minified fields (`a`, `b`, ...) beside the base ones, so read the schema, never it.
- Filters go back into getSearchManga as `filterList: [{name, type, stateInt | stateString | stateSort | stateList}]`, matched against the source's own list **by name**; a name the source doesn't have is ignored (measured: Weeb Central has no "Cooking" tag, and asking for it changed nothing). select and tristate send stateInt, text stateString, sort stateSort `{index, ascending}`, a group stateList `[{name, type, stateBoolean | stateInt}]` (checkbox children stateBoolean, tristate and select children stateInt). Two quirks of upstream's reader: a **top-level** checkbox is read from `stateList[0].stateBoolean`, not a field of its own, and a text inside a group is read from the child's `name`. Measured live on 2026-10-28: Weeb Central's sort select and a status checkbox group, MangaDex's Theme tri-state, Asura's sort.
- preferencesManga and setPreferenceManga return the preference screen as maps.
- getEpisodeList (animeData.url) returns episodes, with seasons flattened.
- getVideoList (episodeData.url) returns [{url, quality, videoUrl, headers, subtitleTracks:[{url, lang}], audioTracks:[{url, lang}], timestamps, status, progress, ...}].
  - headers is OkHttp's internals: {"namesAndValues$okhttp":[name, value, ...]}.
  - Hosters are resolved in parallel with a 30 s budget each.

A page is proxied when the source overrides fetchImage, has client interceptors the default client lacks, has a URL that isn't plain http(s) or contains '#', or a Cloudflare clearance was solved for the host. Every page of every source tested came back proxied, because 1.6 sources build their own client. In practice tsundoku downloads through the engine.

Preferences:

- Sent with every request as [{key, <type>: {..., value | valueIndex | values}}]. The types are checkBoxPreference, switchPreferenceCompat, editTextPreference, listPreference and multiSelectListPreference.
- Written into the source's SharedPreferences only for keys not already present, unless a **mangayomi_bridge_context** entry says preferenceApplyMode: replace-present.
- setPreferenceManga changes the key named by that context's changedPreferenceKey and returns the screen.
- Storage is java.util.prefs inside the container and is lost when the container is recreated, so tsundoku owns the values and resends them.

Memo:

- 1.6 sources may attach a memo (JSON) to a manga or chapter. The engine appends it to the URL as <url>|mangayomi-memo|<base64url JSON> and splits it off when the URL comes back. It also caches memos in memory (LRU 8192).
- Asura, Toonily, Toonily.me and Omega Scans do this.
- The URL before the marker is the Mihon URL. The memo must be kept and sent back.

## Mihon manga: the nine sources

Repository: https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json is now a two-entry stub ("Outdated App", "Update to Mihon 0.20.1+"). The real index is v2: index.json / index.pb on the same branch (repo.json names index_v2).

- It lists 1,435 extensions, all extensionLib "1.6".
- APKs are GitHub release assets, with a prebuilt .jar beside each, plus sha256 and the signing-key fingerprint.
- The engine reads no index, so its format doesn't matter to it.
- Suwayomi reads index.pb (its extensionRepos setting). Its installed versions trail the index (Asura 1.6.69 vs 1.6.70, Omega Scans 1.6.51 vs 1.6.52, Toonily.me 1.6.4 vs 1.6.5): updates it has flagged but not yet installed. ops/suwayomi/compose.yml named the stub until 2026-10-28 and now names index.pb too.

Results (browser UA; cf-proxy-url for Kumaraw; patched image for Mangahere and MANGA Plus):

| Source (id)                                | Popular                  | Latest | Search | Details             | Chapters | Pages                   | Image bytes                  | Notes                                                                                                                |
| ------------------------------------------ | ------------------------ | ------ | ------ | ------------------- | -------- | ----------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Asura Scans (6247824327199706550)          | ✓ 20                     | ✓ 20   | ✓ 3    | ✓                   | ✓ 190    | ✓ 17                    | ✓ webp                       | URLs carry a memo                                                                                                    |
| Toonily (5190569675461947007)              | ✓ 25                     | ✓ 25   | ✗      | ✓                   | ✓ 114    | ✓ 16                    | ✓ jpeg                       | Search: ClassCastException "y0 cannot be cast to k" (dex2jar). New URL scheme; stuck guard on legacy URLs            |
| Toonily.me (1581110056159285576)           | ✓ 24                     | ✓ 24   | ✗      | ✓                   | ✓ 232    | ✓ 7                     | ✓ webp                       | Search: InstantiationError c2 (dex2jar)                                                                              |
| Mangahere (2)                              | ✓ 70                     | ✓ 70   | ✓ 12   | ✓ (blank url/title) | ✓ 220    | ✗ upstream, ✓ fork (23) | ✓ jpeg                       | Pages need QuickJS (patch 1). A one-word query gave 0, a two-word one 12                                             |
| MangaDex en (2499283573021220255)          | ✓ 20                     | ✓ 68   | ✓ 1    | ✓                   | ✓ 112    | ✓ 21                    | ✓ jpeg                       |                                                                                                                      |
| Weeb Central (2131019126180322627)         | ✓ 32                     | ✓ 32   | ✓ 1    | ✓                   | ✓ 232    | ✓ 31                    | ✓ jpeg (served as image/png) |                                                                                                                      |
| Omega Scans (1534451209269193504)          | ✓ 12                     | ✓ 12   | ✓ 1    | ✓                   | ✓ 126    | ✓ 11                    | ✓ jpeg                       | Logs "Failed to fetch filter data", harmless                                                                         |
| Kumaraw (6580524146378639197)              | ✓ 14                     | ✓ 32   | ✓ 2    | ✓                   | ✓ 33     | ✓ 50                    | ✓ jpeg                       | Every call 403 without a solver (Cloudflare cf-mitigated: challenge); all pass with cf-proxy-url; first solve 16.7 s |
| Webtoons.com en (2522335540328470744)      | ✓ 30                     | ✓ 162  | ✓ 13   | ✓                   | ✓ 9      | ✓ 84                    | ✓ png                        |                                                                                                                      |
| MANGA Plus en (1998944621602463790), extra | ✗ upstream, ✓ fork (100) | –      | ✓      | ✓                   | ✓ 6      | ✓ 53                    | ✓ jpeg                       | Upstream: no Injekt instance for ProtoBuf (patch 2)                                                                  |

Every source except Webtoons returns chapter_number = -1 for every chapter. 1.6 leaves numbering to the host (Mihon's chapter recognition; Suwayomi fills in 1.0, 2.0...).

### Toonily: legacy URLs and a stuck guard

Toonily 1.6.72 keys a series by post id: popular gives 5871|mangayomi-memo|{"path":"/serie/..."}, and chapters are chapter-1|mangayomi-memo|{...}. Suwayomi's library still has the old /webtoon/some-series/ and https://toonily.com/serie/some-series/chapter-1/?style=list.

On a fresh engine:

```
A chapters(old url, fresh)   200  114 chapters
B chapters(old url, again)   500  getMangaUpdate must not be called concurrently for same manga
C chapters(new url)          200  114
D chapters(new url, again)   200  114
```

KeiSource.getMangaUpdate marks manga.url as in flight and clears manga.url in finally. The extension rewrites the URL in place while resolving the legacy one, so the old key stays marked until the engine restarts. This is Keiyoushi's code, not the engine's, but any host keeping legacy URLs will hit it. Details for the old URL also return the new /serie/some-series/, so tsundoku must store the URL a source returns.

### Toonily and Toonily.me search: most likely dex2jar

In the dex2jar-converted Toonily.me, j1.c does `new c2`, where c2 is `public abstract class c2 extends Filter$Select`, which explains the InstantiationError. ART can't instantiate an abstract class either, so the original dex must name a concrete subclass. In Keiyoushi's prebuilt JAR of the same version, the "Sort By" filter is a concrete `final class ap extends ao`. Toonily's cast between two sibling Filter$CheckBox classes fits the same pattern.

This is not proven, but it points at dex2jar, which Suwayomi also uses. Loading Keiyoushi's JARs (jarUrl in the v2 index) would skip that step; neither this engine nor Yuzono's anime index (APKs only) offers it today.

## Image fetching: bytes through the source's client

getPageList registers each page and returns /image/<token>. Fetching that runs imageRequest and the client's interceptors and returns the bytes. I compared those bytes against plain fetches of URLs I got from each site independently (transcripts/image-compare*.json, run/imgcompare.py):

- MangaDex:
  - No headers: 403 (17 bytes).
  - Browser UA via uploads.mangadex.org: identical, 3/3. The at-home node 404s a plain request.
- Webtoons:
  - Without a Referer: 403, with or without a UA.
  - With Referer https://www.webtoons.com/: identical, 3/3.
- Weeb Central:
  - No UA: 403.
  - Browser UA: identical, 3/3. JPEG served as image/png.
- MANGA Plus:
  - Without Plus-Vw-Token: 400.
  - With the token: 200 image/jpeg whose bytes are not an image (XOR ciphertext).
  - After XOR with the page key: identical to the engine's bytes, 3/3 (787,681, 1,167,697 and 1,093,652 bytes).

So the proxy is required, not a convenience: sites need the source's headers, MANGA Plus needs its interceptor, and solved clearances live only in the engine's cookie jar.

Image fetches don't take the per-extension lock: 12 pages took 1.20 s sequentially and 0.34 s six at a time. Tokens die with the process; an old /image/ URL answers 404 after a restart.

## Source ids and URLs

Ids: for all nine, extensionInfo's id equals both the Keiyoushi v2 index and Suwayomi's sources query (transcripts/suwayomi-sources.json). MangaDex en is 2499283573021220255 everywhere, and its other languages match too; Mangahere is 2. mihon:<source id>:<url> keys carry over unchanged.

URLs (Suwayomi library series against the engine, memo stripped):

- Series and chapters match for Asura (/series/return-of-the-mount-hua-sect, .../chapter/1), Toonily.me, Mangahere (/manga/transcension_academy/c001/1.html), MangaDex (/chapter/7bf51a31-...), Weeb Central (/chapters/01J76XZ3GK25RS0N6N43JKHYKV), Omega Scans (/series/...#8, .../chapter-1#1124) and Kumaraw (.../chapter-2-1).
- Toonily differs on both, from the extension's new scheme. Series: /webtoon/some-series/ becomes 5871 or /serie/some-series/. Chapters: https://toonily.com/serie/.../chapter-1/?style=list becomes chapter-1. This will reach the tablet's Mihon backups too.
- Webtoons has no Suwayomi library series to compare.

## Cloudflare and WebView

- The bundled Chromium does nothing. KcefWebViewProvider is registered but KCEF.init is never called; the source says so, and the log reads "Desktop WebView (CEF) is unavailable; will use bridge or stub".
- The only solvers are a FlareSolverr/Byparr URL (cf-proxy-url) and Mangayomi's WebView bridge, which tsundoku doesn't have.
- Only Kumaraw of the nine sits behind a managed challenge. FlareSolverr v3.4.6 solved it: 16.7 s once, then 0.1-0.5 s a call. AnimePahe's first call took 42 s through the solver.
- WebView extensions fail. AniZone (lib 16) crashes its request thread with StackOverflowError after "Cef was not initialized", and the client sees the connection close.
- Suwayomi has FlareSolverr off (flareSolverrEnabled: false) and relies on its own KCEF. Without Suwayomi, tsundoku needs a solver container it doesn't run today.

## Aniyomi anime

Kohi-den is gone.

- Kohi-den/extensions-source was archived on 2026-05-12.
- kohiden.xyz now serves a parked-domain page: a valid Let's Encrypt chain to the new ISRG Root YE, an interstitial posting visitor geo data to router.parklogic.com, and HTTP/2 resets on raw paths. Nothing was downloaded from it.
- I used Yuzono's repo instead (https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json): 248 extensions, 200 on lib 14 and 48 on lib 16.

Results (query "frieren", with cf-proxy-url):

- AnimePahe 16.56:
  - Popular ✓ 12 (42 s via solver), search ✓ 3, details ✓, episodes ✓ 28, videos ✓ 6.
  - All six videos are HLS, all proxied.
  - The extension runs its own local HTTP server inside the engine (http://localhost:34033/m3u8?url=...), which the engine proxies.
- KickAssAnime 14.63:
  - Popular ✓ 24, search ✓ 3, details ✓, episodes ✓ 28, videos ✓ 3 (direct HLS plus headers).
  - Audio and subtitles are separate proxied .m3u8 and .vtt tracks.
  - Segments are MPEG-TS disguised as .jpg on rotating hosts; the first bytes are 0x47, the MPEG-TS sync byte.
- AniZone 16.15: ✗, needs a WebView.

Download proof (ffmpeg n9.0.1, using the returned headers and -extension_picky 0):

- AnimePahe via the engine's /video/ playlist: -t 20 took 1 s, producing H.264 1920x1080 plus AAC, 20.10 s, 2.7 MB.
- KickAssAnime direct: H.264 1920x1080, 20.06 s, 9.2 MB, video only. Muxed with its Japanese audio and English subtitle tracks (-map 0:v -map 1:a -map 2:s): H.264 + AAC + SubRip, 20.06 s.

Expiry:

- Neither URL carries a signed expiry.
- KickAssAnime's manifest and segments still answered 200 five minutes later.
- AnimePahe's upstream (vault-08.uwucdn.top/stream/.../uwu.m3u8) gives a Cloudflare 403 to a plain client even with the extension's headers. Access depends on clearance cookies held in the engine, so it is downloadable only through the engine's proxy, which forgets every token on restart.
- Resolve the video list right before each attempt and again after any failure. Cookie lifetime beyond a few minutes was not measured.

## KeiSource and how current the engine's API is

- Keiyoushi now requires KeiSource (keiyoushi.source.KeiSource, in their core module, compiled into each APK) for new sources; their AGENTS.md says the build fails otherwise. It extends HttpSource and finalises getMangaUpdate over an abstract suspend fetchMangaUpdate.
- The engine's Source has the tachiyomix 1.6 surface: suspend getPopularManga/getLatestUpdates/getSearchManga, getMangaUpdate(manga, chapters, fetchDetails, fetchChapters), SMangaUpdate, and memo on SManga and SChapter.
- KeiSource extensions load and run:
  - Mangahere and Webtoons are KeiSource directly, and Keyoapp-based ones come through lib-multisrc.
  - Toonily and Toonily.me ran through KeiSource.getMangaUpdate (its guard message shows in the transcripts).
  - KeiSource's Komikku-only related-manga members (supportsRelatedMangas, fetchRelatedMangaList) don't exist in the engine's HttpSource. On the JVM they are just extra methods, and nothing broke.
- Aniyomi: lib 16 hosters and seasons were aligned with Aniyomi today (456900e). Lib 14 falls back to getVideoList. Both work.
- Activity:
  - Created 2026-04-03, with history from 2020 inherited from Suwayomi.
  - 2026 commits per month: Apr 14, Jun 3, Jul 27, Aug 18, Sep 5, Oct 24.
  - Releases v1.0.7 (2026-08-25) to v1.0.9 (2026-10-05).
  - 5 stars, 5 forks, 1 open issue ("Error on launch, what prerequisites are needed?", 2026-05-10).
  - One active maintainer (kodjodevf), plus PRs from one contributor this month.

## Licences (not legal advice)

- The engine is MPL-2.0. Its AndroidCompat and Mihon/Aniyomi parts are Apache-2.0 in origin, with changes under MPL.
  - MPL is file-level copyleft: distributing the engine, modified or not, means making the source of its MPL files available (our patches included) and keeping notices.
  - tsundoku's own code, talking to the engine over HTTP, is a separate work and keeps its own licence. Bundled together it is at most an MPL "Larger Work", which MPL allows.
- NewPipe Extractor v0.26.3 is GPLv3, and the shadow jar includes it (480 org/schabi entries).
  - MPL-2.0 allows combining with GPL code, so a jar containing NewPipe is effectively distributed under GPLv3 as a whole.
  - HTTP use doesn't pull tsundoku under the GPL, but bundling the jar means shipping a GPLv3 binary plus its corresponding source.
- NewPipe comes out cleanly. Remove these and nothing else references it; only Mangayomi's YouTube-backed sources use it. Do this in the fork.
  - server/src/main/kotlin/mextensionserver/impl/YouTubeResolver.kt
  - controller/YouTubeHandler.kt
  - its test, server/src/test/.../YouTubeHandlerTest.kt
  - the newpipe-extractor line in server/build.gradle.kts and gradle/libs.versions.toml
  - the /youtube/resolve route in MExtensionServerController.kt
  - the youtubeResolver capability flag
- Other bundled parts need notices only: KCEF/JCEF (Apache-2.0/BSD; no Chromium ships), JOGL (BSD), ICU (Unicode licence), Noto Sans (OFL), OkHttp, Jackson, Kotlin (Apache-2.0).
- Extensions: Keiyoushi's extensions-source and the Aniyomi-family repos are Apache-2.0. tsundoku would fetch APKs at runtime, not redistribute them. The sites themselves are a separate question this spike doesn't answer.

## What tsundoku's own downloader must do with this engine

The engine answers "what are the pages, and give me their bytes". Everything else is tsundoku's:

1. Repositories and extensions:
   - Read Keiyoushi's v2 index.json (index.min.json is a stub) and Yuzono's, or another living Aniyomi repo's, index.min.json.
   - Download APKs and verify them against the index's sha256 and signing-key fingerprint.
   - Keep them on /mnt/hdd2, track versions and updates, and map source id to APK.
2. Handles: send the APK on first use and keep the returned handle. On 409, which follows every engine restart, resend.
3. Always send a browser User-Agent (or one starting "Dart/") on every call. Any other UA becomes the user agent of every source in the engine.
4. Run a solver (a FlareSolverr or Byparr container) and pass cf-proxy-url on every call. Allow 20-45 s for a first solve.
5. Preferences: store each source's values and send the snapshot with every call. The engine's copy is lost with the container.
6. Identity:
   - Key series and chapters by mihon:<source id>:<url before |mangayomi-memo|>, as today.
   - Store the memo beside the key and send the full URL back.
   - Store the URL a details call returns, which can differ (Toonily).
   - Keep your own title and URL when a 1.6 source returns blank ones.
7. Chapter numbers: recognise them from chapter names, since 1.6 sources return -1. Port Mihon's ChapterRecognition.
8. The queue:
   - One RPC at a time per source. The engine serialises anyway, so a long search delays downloads; keep searches from starving downloads.
   - Parallel image fetches per chapter (6-8 were fine).
   - Per-source rate limits on top of the extensions' own, and retries with backoff.
   - Every non-409 error is a 500, so tell "rate limited" and "gone" apart by the message, not the status.
9. Pages:
   - Call getPageList right before downloading a chapter.
   - Fetch every page through /image/<token>, with the authority rewritten to the published port.
   - Check each body is an image by sniffing magic bytes; content types lie (Weeb Central serves JPEG as image/png).
   - Refetch the page list after an engine restart, because the tokens 404.
10. CBZs:
    - Write pages in order, plus a ComicInfo.xml in the shape src/lib/server/zip.ts and the Mihon importer already read.
    - Write to a temp name and rename, so a half-written chapter never looks finished. The importer's end-of-central-directory check only protects against truncated files, not partial ones.
11. Anime:
    - Call getVideoList right before each attempt and pick a quality.
    - Unpack headers.namesAndValues$okhttp into pairs.
    - Hand ffmpeg the video URL with those headers and -extension_picky 0, plus the separate audio and subtitle tracks, mapped into one MKV. Rewrite proxied track URLs to the published port.
    - Fetch proxied streams only through the engine, and re-resolve on failure.
12. Following: checking followed series for new chapters is today Suwayomi's 12-hour update. The engine has no library, no schedule and no database.
13. Health:
    - No auth and an open /stop: bind it to loopback or a private Docker network.
    - Start it from systemd like tsundoku-suwayomi, with RequiresMountsFor=/mnt/hdd2 if its data lives there.
    - Have the watcher treat "not answering" as it does today.

## If we built our own engine instead

From Suwayomi's AndroidCompat and Aniyomi's extensions-lib (both Apache-2.0), we would have to write what M-Extension-Server already has:

- The Android shims extensions touch: Application, SharedPreferences, Looper, PreferenceScreen and its preference types, WebView stubs, Log, Base64.
- Current source APIs: Mihon tachiyomix 1.6 (getMangaUpdate, memo, suspend catalogue methods) AND Aniyomi lib 14-16 (hosters, seasons, resolveVideo, the extension-run HttpServer). AndroidCompat alone gives neither.
- An Injekt graph matching Mihon's and Aniyomi's app modules, ProtoBuf included. A missing entry is a silent runtime failure, as MANGA Plus showed.
- NetworkHelper: cookie jar, user-agent handling, rate-limit interceptors, and a Cloudflare path (a solver, or a real headless browser if WebView extensions matter).
- A working QuickJS.
- APK loading: dex2jar, or better, Keiyoushi's prebuilt JARs, which would avoid the Toonily search mistranslation.
- An image proxy through the source's client, and a video proxy that rewrites manifests and sanitises MPEG-TS.

That is months of work to reach where this engine is, with the same upkeep of tracking two upstream source APIs.

Recommendation:

- Fork M-Extension-Server.
- Keep tsundoku's side of the contract narrow (the methods above, /image, /video) so the engine stays replaceable.
- Send the QuickJS and ProtoBuf fixes upstream.
- Worthwhile local additions: loading Keiyoushi JARs without dex2jar, persisting handles and preferences to a volume, an auth token or a socket instead of the open port, and dropping NewPipe.

## Reproducing

```sh
cd /mnt/hdd2/scratch/extension-spike
docker build -t mextension-spike:fixed engine        # branch spike-fixes; about 3.5 min
docker compose -f run/compose.yml up -d              # engine on 127.0.0.1:4590, FlareSolverr on the internal network only
cd run && CF_PROXY=http://flaresolverr:8191/v1 python3 matrix.py   # or anime.py, imgcompare.py
docker compose -f compose.yml down
```

run/compose.yml names mextension-spike:fixed. For upstream behaviour, check out master and build it as mextension-spike:latest.

## What's left on disk

/mnt/hdd2/scratch/extension-spike/, 77 MB: engine/ (the clone, branch spike-fixes with the two patches), transcripts/ (call JSONs, matrices, image comparisons, indexes; contains titles and metadata of explicit series, no images), apks/ (the 13 extension APKs), logs/, run/. All page images, anime grabs and converted JARs were deleted. The spike's containers, network and images are removed; Docker's build cache from the builds remains.
