# Architecture

## Shape

```
tablet / phone (PWA) ──tailnet──> tsundoku  (workstation: SvelteKit + SQLite)
                                     │  files on /mnt/hdd2/tsundoku/library
                                     ├── scan / import workers
                                     ├── mokuro OCR worker (RTX 3050)
                                     └──> Kumiko API: flashcards, hours, metrics
```

**It runs on the workstation, not the VPS, and is not a Kumiko module.** The
library is ~166 GB (measured 2026-09-23) of images. Serving it from the VPS means uploading it there
and streaming every page back through a CPU-throttled box; serving it from here
means it never leaves the house. Kumiko is reached over its API the way yomu
already does, so tsundoku stays a separate process with its own database.

**Exposure follows kirisute exactly**, and for the same reasons (see
`~/projects/kirisute/README.md`, "Exposure"): bind to the tailnet address only,
refuse wildcards unless named, derive `ORIGIN` from the bound address, and
authenticate with a cookie — an `<img>` cannot send a bearer header any more than
a `<video>` can.

**The reader is a PWA**, installed to the home screen so it runs fullscreen
without browser chrome. A service worker caches the next chapters of whatever is
open, so a reading session survives the Wi-Fi dropping.

## Data model

Two reader engines over one library.

- **Series** — the unit a person thinks in. Title, alternative titles, cover,
  description, reading direction default, `kind` (`manga`, `manhwa`, `doujin`,
  `novel`), and the owner's fields below.
- **Entry** — a readable unit inside a series: a chapter, a volume, a one-shot.
  Carries its number, title, file location, page count, and `format`
  (`images` or `text`). A doujin is a series with exactly one entry.
- **Page** — only for `images`: order, path inside the archive or folder,
  dimensions (for layout before the image loads), optional mokuro OCR blocks.
- **Progress** — per entry: last page or text position, finished flag, dates.

The owner's organisation, which is the reason this app exists:

- **Rating: 0–10**, integer, on the series. **0 is unrated** and 1–10 is the
  judgement, five steps with halves; there is no separate "rated nothing".
  0 as unrated was decided by the owner on 2026-09-22, the same convention
  Hentoid uses; out of 10 came with c67 (2026-09-25), and rung 29 doubled the
  old 0–5 ([`RATINGS.md`](RATINGS.md)). (An earlier draft kept `NULL` for
  unrated apart from a deliberate 0; migration rung 2 retired it.)
- **Favourite**: a boolean on the series. Deliberately separate from rating —
  a favourite is "keep this at hand", not "this is a 5".
- **Collections**: owner-made, ordered, a series can sit in many. These replace
  Mihon categories.
- **Tags**: free-form, with a `namespace` (`genre`, `artist`, `circle`,
  `source`, `language`, or none). Every imported category or attribute is kept
  as a tag. The one exception, settled with the owner: Mihon categories that
  are really a rating scale also set the rating, a shelf, and hiding
  ([`IMPORT-MIHON.md`](IMPORT-MIHON.md)).
- **Hidden**: a library root or a series can be hidden. Hidden items are not
  listed, counted, searched or suggested until a reveal toggle is on. The Hentoid
  import lands in a hidden root by default.

## Kumiko and yomu

- **Lookup** reuses yomu's in-browser tokenizer and dictionary, extracted into a
  shared package rather than copied. On a page, the tappable unit is a mokuro
  text block; in a novel, it is the word under the tap.
- **Mining follows yomu's rule**: lookups produce _candidates_, and candidates
  become Kumiko Flashcards only by batch approval at the end of a session.
  Auto-mining floods the deck.
- **Reading time** is reported to Kumiko hours/metrics per session.

shiori is a Python TUI and is not embedded. What carries over is its knowledge:
furigana generation and CJK line breaking. The browser sets vertical text
natively (`writing-mode: vertical-rl`, `<ruby>`), which is the part shiori had
to fight for.

## Downloading

**tsundoku runs other people's extensions and never writes its own.** Per-site
scrapers are the treadmill that makes Mihon what it is, and that treadmill
stays theirs: Mihon's (Keiyoushi), Aniyomi's and LNReader's extension
communities keep up with the sites, and tsundoku keeps up with three plugin
APIs. A site with no extension in any repo the user has added is not
downloaded here; it isn't an invitation to write a scraper.

Decided with the owner on 2026-10-28, replacing the rule that tsundoku has no
downloader at all ("Web novels", below). The reason was the app count: manga
were downloaded here through Suwayomi, but finding a series still meant
opening Suwayomi, novels meant LNReader, doujinshi Hentoid or Mihon, and anime
Aniyomi. The goal is one app to find, download and read everything in, which
can be handed to other people without asking them to run Suwayomi too.

| Kind                     | Extensions        | Where they run                                                  |
| ------------------------ | ----------------- | --------------------------------------------------------------- |
| Manga, manhwa, doujinshi | Mihon (Keiyoushi) | a headless JVM engine beside tsundoku                           |
| Anime                    | Aniyomi           | the same engine                                                 |
| Light and web novels     | LNReader plugins  | inside tsundoku, in a sandboxed host ([`NOVELS.md`](NOVELS.md)) |

**Extensions aren't self-contained, and they don't download.** A Mihon or
Aniyomi extension is an Android APK built against `extensions-lib`, which is
only stubs: at runtime it calls into its host for the HTTP client (OkHttp,
carrying the extension's own interceptors: rate limits, headers, image
descrambling), Cloudflare challenges (a WebView), preferences, and the bits of
Android it touches. It answers "what's popular, what are this series'
chapters, what are this chapter's pages (or this episode's streams)". The
queue, retries, fetching each image and writing the CBZ are the host's job.
So:

- **The engine** is the host side: a JVM process with an Android shim and a
  headless Chromium. Node can't load an APK, so there is always a JVM; what
  there needn't be is a second app with its own library, login and backups,
  which is what Suwayomi is. **It's a pinned fork of M-Extension-Server**
  (Mangayomi's engine: Suwayomi's `AndroidCompat` plus current Mihon and
  Aniyomi source APIs behind a small RPC), chosen by the spike on 2026-10-28
  (c113, "Spike: run Mihon and Aniyomi extensions headless
  (M-Extension-Server)"). It ran all nine of the library's sources and two
  anime sources; the fork carries two fixes it needed and drops its GPLv3
  YouTube part (c131, "Fork M-Extension-Server as tsundoku's engine, with a
  solver beside it"). Its bundled Chromium never starts, so **Cloudflare is a
  FlareSolverr container beside it**, and an extension that needs a real
  WebView doesn't run. The engine keeps nothing: repos, APKs, preferences and
  state are tsundoku's. The contract, and everything the spike measured, is
  [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md).
- **Images and streams are fetched through the source's client**, never by
  tsundoku fetching the URL itself, or the interceptors are skipped and a
  page comes back blocked or scrambled.
- **tsundoku is the downloader**: the queue, retries, CBZ and ComicInfo,
  ffmpeg for HLS, the update check FOLLOW needs, installing and updating
  extensions.
- **Keys don't move.** A series stays `mihon:<source id>:<url>`: the source id
  belongs to the extension, not to the app that ran it, so what the tablets
  and Suwayomi downloaded is the same series as what tsundoku downloads
  (checked for all nine sources). The URL can still move under an extension
  update: Toonily's did, and its 126 series here are keyed by the old scheme,
  so a source's new URL for a known series becomes an alias of its key,
  never a second series.
- **tsundoku ships no repo URLs**, as Mihon and Aniyomi ship none. The user
  adds repos.
- **The cost we own** is the hosts' API: Keiyoushi is moving to a new base
  class (`KeiSource`), and every host has to follow such changes. One
  interface now and then, not hundreds of sites, but not nothing.

Since 2026-10-28 tsundoku downloads on the engine itself
([`DOWNLOADER.md`](DOWNLOADER.md)), and BROWSE finds series on it
([`BROWSE.md`](BROWSE.md)); Suwayomi was retired the same day (c129,
[`DOWNLOADING.md`](DOWNLOADING.md), "Suwayomi, retired"). The plan is on the board under the
**Extensions** label: c124 (gallery sources as one-off books), c113 (the
spike, done), c131 (the engine fork), c125 (tsundoku's own downloader, manga
first), c130 (cover hashes, so Mihon's books are checked for duplicates), c126 (browse,
extensions and repos screens, from a design brief), c127 (novels from
LNReader plugins), c128 (anime, in a video player of tsundoku's own, the owner's call on 2026-10-28, not handed to Jellyfin) and
c129 (retiring Suwayomi).

## Web novels

Superseded on 2026-10-28 by "Downloading", above: novels come from LNReader's
plugins. What still holds: EPUBs (including the WebToEpub-style ones already
on the phone) import directly, and a pasted URL whose readable text becomes a
`text` entry remains the path for a page no plugin covers.

The rule this section used to state, kept for the record: "Per-site scrapers
are the extension treadmill that makes Mihon what it is, and this project
will not grow one." Manga followed it through Suwayomi-Server, which runs
Mihon's extensions on the workstation and writes Mihon's layout, imported as
one more device ([`DOWNLOADING.md`](DOWNLOADING.md)).

## Phases

1. **Library and image reader.** Scan, the Mihon and Hentoid importers, the
   library screen, the series screen, the paged (RTL/LTR) and vertical-scroll
   reader, progress, rating, favourites, collections, tags, hidden roots.
   This alone replaces the tablet.
2. **Japanese layer.** mokuro worker, the shared lookup package, mining into
   Kumiko Flashcards, reading time into Kumiko.
3. **Text reader.** EPUB and web-novel import, horizontal and vertical setting,
   furigana. EPUB import and the reader landed on 2026-09-23
   ([`TEXT-READER.md`](TEXT-READER.md), [`IMPORT-EPUB.md`](IMPORT-EPUB.md));
   furigana generation and pasted web novels are still to come.
4. **Extras.** Offline caching beyond the next chapters, stats, and possibly a
   Komga-compatible API so stock Mihon can read the library as a fallback.
5. **One downloader.** Finding and downloading manga, novels and anime from
   inside tsundoku on Mihon, Aniyomi and LNReader extensions, then retiring
   Suwayomi ("Downloading", above). Started 2026-10-28 with the engine spike;
   manga downloading and BROWSE on the engine, and Suwayomi retired, the same
   day. Novels (c127) and anime (c128) are next.
