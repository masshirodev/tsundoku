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

## Web novels

Per-site scrapers are the extension treadmill that makes Mihon what it is, and
this project will not grow one. The general path is: paste a URL, extract the
readable text, store it as a `text` entry. A site gets a dedicated adapter only
when it is actually read and the general path fails on it. EPUBs (including the
WebToEpub-style ones already on the phone) import directly.

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
