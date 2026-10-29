# Novels from LNReader plugins

Light and web novels, found, downloaded and read inside tsundoku on
[LNReader](https://github.com/LNReader/lnreader)'s plugins
([lnreader-plugins](https://github.com/LNReader/lnreader-plugins), MIT), as
manga runs on Mihon's extensions ([`DOWNLOADER.md`](DOWNLOADER.md)). Card c127
("Novels from LNReader plugins, inside tsundoku"), split in five:

| Part                                                 | Card | State   |
| ---------------------------------------------------- | ---- | ------- |
| A sandboxed host for the plugins                     | c147 | Done    |
| Repositories and plugins in EXTENSIONS               | c148 | Done    |
| Browsing, searching and adding a novel               | c149 | Done    |
| Downloading chapters into an EPUB the importer reads | c150 | Done    |
| FOLLOW, live checks, the rest of this file           | c151 | Done    |
| Past a site's bot check, through FlareSolverr        | c152 | Not yet |

The owner's repository (2026-10-28):
`https://raw.githubusercontent.com/LNReader/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json`,
328 plugins that day, 187 English. It's added on the repositories screen like
any other; tsundoku ships none ([`BROWSE.md`](BROWSE.md)).

## What a plugin is

A CommonJS file whose `exports.default` is an object (or a class) with:

| Method                                               | Gives                                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `popularNovels(page, { showLatestNovels, filters })` | `[{ name, path, cover }]`: POPULAR, or LATEST with `showLatestNovels`                                            |
| `searchNovels(term, page)`                           | the same, for a search                                                                                           |
| `parseNovel(path)`                                   | `{ name, path, cover, author, status, genres, summary, chapters: [{ name, path, releaseTime, chapterNumber }] }` |
| `parsePage(path, page)`                              | more chapters, for a plugin that pages them (`totalPages` in parseNovel)                                         |
| `parseChapter(path)`                                 | the chapter, as HTML                                                                                             |

and `id`, `name`, `site`, `version`, `filters` (five types: `Text`, `Picker`,
`Checkbox`, `Switch`, `XCheckbox`). What plugins require, counted over 167 of
the 328 on 2026-10-28: `@libs/fetch` (all of them), `cheerio` (133),
`@libs/novelStatus` (120), `@libs/defaultCover` (103), `@libs/filterInputs`
(94), `dayjs` (20), `@libs/storage` (17), `htmlparser2` (7),
`@libs/isAbsoluteUrl` (3), `@libs/aes` (2). The libraries are pinned to the
ranges lnreader-plugins builds against (`cheerio` ^1, `dayjs` ^1.11,
`htmlparser2` ^9, `@noble/ciphers` ^2, `protobufjs` ^7).

## The plugin host

Plugin code is downloaded from the internet and runs on the workstation, so it
never runs in the app (`src/lib/server/novels/`):

- **A child process of its own** (`plugin-host.cjs`, started by `host.ts` on
  the first call and again after it dies), **under Node's permission model**:
  it may read only itself, the project's `node_modules` and the plugin store,
  and may not write, spawn processes, start workers or load addons. Its
  **environment is empty**, so nothing in `.env` is there to read.
- **A vm context per plugin**, whose `require` gives only LNReader's shims
  (`@libs/*`, written from their documented behaviour) and the libraries
  above. `require('fs')` is refused.
- **A fetch that stays on the internet**: every request, and every hop of a
  redirect (followed by hand, since an automatic one would skip the check),
  is refused when its host resolves to a loopback, private, link-local or
  unique-local address. Tests open a loopback port through the parent's own
  message; nothing else can.
- **Calls over IPC with a timeout** (a minute); a plugin stuck in a loop gets
  the host restarted, and its failure is the caller's error, not a crash.

**What it doesn't stop.** Node 24 has no `--allow-net`, and the plugins need
the network. Code that escapes the vm context (a host object's constructor
reaches the host's `Function`; `tests/novel-host.spec.ts` does exactly that)
finds an empty environment and no file or process access, but could still open
a raw socket to a port on the workstation. Everything there that matters asks
for a token or a session, which the host doesn't have. Running the host in a
container with its own network would close that; it isn't done.

`tests/novel-host.spec.ts`: a plugin answers each method through the host
(filters' starting values included), and a hostile one fails to require `fs`,
finds no environment, can't read a file or start a process even out of the vm
context, and can't fetch a loopback address directly or by redirect, after
which the host still answers.

**Measured live on 2026-10-28**, four of the owner's repository's plugins
through the host: NovelBin (10 popular, a novel's 148 chapters, a chapter's
8 KB of HTML) and Wuxiaworld (50, 357 chapters, 8 KB) all the way through.
Royal Road stops at its site's bot check ("Open a novel from Royal Road in
WebView"), and ScribbleHub's popular list comes back empty, most likely the
same. Getting past those needs the engine's FlareSolverr in the host's path,
which the host's own fetch can't reach (it refuses local addresses on
purpose): a planned way through, c152 ("Novel plugins past a site's bot
check, through the engine's FlareSolverr").

## Repositories and plugins

On EXTENSIONS ([`BROWSE.md`](BROWSE.md), "Extensions and repositories"), beside
Mihon's, in their own tables (rung 44: `novel_repos`, `novel_listings`,
`novel_plugins`; `src/lib/server/novels/plugins.ts`,
`src/lib/library/lnreader-index.ts`):

- **REPOSITORIES** takes an LNReader address (one ending `plugins.min.json`)
  as it takes a Mihon one: asked first ("FOUND · LNReader · 328 NOVEL
  PLUGINS"), then added, listed with its count, checked by CHECK NOW, kept
  ruled when it stops answering, removed through the sheet when plugins came
  from it. Its name is the GitHub owner it's served from, or its host: an
  LNReader index names nothing.
- **AVAILABLE** has a NOVELS tab: every repository's plugins, in the owner's
  languages unless ALL (LNReader names languages in their own words; the index
  reader maps all seventeen in the owner's repository to codes), searched by
  name.
- **INSTALLED** lists plugins in the same three sections as extensions: NEEDS
  A HAND (failed to load in the host, with TRY AGAIN; or OBSOLETE), UPDATES,
  INSTALLED; UPDATE, UPDATE ALL and BACK TO for a week; REMOVE through the
  sheet. A plugin is `ln:<id>` in the page's forms and its icon's route.
- **Trust.** LNReader signs nothing. A repository is trusted by its address
  over https, and a plugin's file is pinned by its SHA-256 when it's installed:
  what runs is what was fetched then, never a file changed under it. A plugin
  must load in the host to count as installed; one that won't is kept and
  says so, as an extension that fails to load is.
- **No adult flag.** LNReader's index marks nothing adult, so AVAILABLE can't
  hold any back while reveal is off. Its plugins are novel sites; covers in
  BROWSE follow the same hidden rules as manga's ("Browsing and adding").

`tests/novel-plugins-db.spec.ts` (an index read, languages, versions, a
repository added and kept when it stops answering, a plugin installed,
updated, taken back, failing to load, removed) and the novels test in
`tests/browse-extensions.e2e.ts` (an LNReader repository asked and added, a
plugin installed and loaded in the real host, removed).

## Browsing and adding

A plugin is a source like any other in BROWSE ([`BROWSE.md`](BROWSE.md)),
under **NOVELS**, as `ln:<plugin>`; a novel in it is `ln:<plugin>~<its path,
base64url>`, as a Mihon source's manga is `<source>~<url>`
(`src/lib/server/novels/source.ts`; card c149).

- **Its page** has POPULAR (`popularNovels`), LATEST (the same with
  `showLatestNovels`: every plugin is asked, one without a latest list answers
  its popular one), and the filter panel. LNReader has no last page: a page
  with anything on it means there may be more, so the list ends at the first
  empty one. No SETTINGS cell, since a plugin keeps none here.
- **Its filters** are drawn by the same panel as an extension's
  (`src/lib/library/lnreader-filters.ts`): Picker a select, Switch a checkbox,
  Checkbox a group of checkboxes, XCheckbox a group of tri-states, Text a
  text field. The way back goes by position, so option values survive the
  URL. A search inside the source is `searchNovels`, which takes no filters:
  the box says "/ search Royal Road", not "with its filters".
- **SEARCH THE SOURCES** asks the plugins the library reads from, as it asks
  extensions ([`DOWNLOADING.md`](DOWNLOADING.md)). IN LIBRARY and SAME TITLE
  match by `lnreader:<plugin>:<path>` and by title, across manga and novels;
  hidden series and mostly-hidden plugins follow the same rules as manga's.
- **Covers** are fetched by the server and sent as the library's 400px WebP
  (`/api/browse/novel-cover/<token>`): the browser never asks a novel site. A
  token stands for an address a plugin gave, kept in memory (one from before a
  restart is no cover), and the fetch stays on the internet, every redirect
  included (`src/lib/server/net-guard.ts`). LNReader's own "no cover" picture
  shows as tsundoku's blank. The library's cover pass applies the same rule to
  every site cover ([`COVERS.md`](COVERS.md)).
- **The preview** (`/downloads/source/<id>`) is `parseNovel`, plus every page
  of chapters for a plugin that pages them (`parsePage`, up to 200), a chapter
  listed twice kept once. Numbers are the plugin's, or read from the names as
  Mihon's are (`chapter-number.ts`; an unnumbered side story after Ch. 3 is
  3.5). Kept ten minutes, so ADD doesn't ask a hundred pages again.
- **ADD TO LIBRARY** writes a novel series through the importers' one writer
  (`src/lib/import/novel-plan.ts`): keyed `lnreader:<plugin>:<path>`, source
  `lnreader`, its genres, author and source as tags, every chapter an entry
  NOT DOWNLOADED known by its path at the source. It goes into the `Library`
  root, the one the EPUB importer shares across devices, so the EPUB c150
  writes under `devices/tsundoku/Library/` lands in the same series. UNDO
  works as for manga. Its DOWNLOAD row is the next section's.
- **When a call comes back empty**, the host says why: LNReader's `fetchText`
  answers `''` on any failure, as LNReader's runtime does, so a plugin whose
  site refused it would list nothing. The host notes the first request it
  refused or that failed during each call, and an empty answer becomes that
  error ("www.scribblehub.com answered 403"); an answer with anything in it is
  kept. The source page bands it with TRY AGAIN.

**Measured live on 2026-10-28**, the owner's repository through the real
host and this module (in-memory database, scratch store): Novel Bin (two
filters, 10 popular, 24 latest, 50 found, a filtered list, a 148-chapter
preview, added with 148 entries in 0.4 s) and Wuxia World (no filters, 50
popular, 357 chapters, added) all the way through. NovelFull, Royal Road and
Scribble Hub stop at their bot checks: c152.

`tests/lnreader-filters.spec.ts` (the five types both ways and through the
URL), `tests/novel-source-db.spec.ts` (BROWSE's NOVELS rows, pages until an
empty one, covers and the blank, LATEST, filters and search as LNReader takes
them, a paged preview, ADD and its entries and tags, IN LIBRARY and hidden,
SEARCH THE SOURCES), `tests/net-guard.spec.ts`, `tests/novel-host.spec.ts`
(an empty answer explained), and the novels test in
`tests/browse-extensions.e2e.ts` (the plugin under NOVELS, its page without
SETTINGS, and its loopback site refused on the page).

## Downloading

A novel downloads as manga does, through the same screens and the same queue
(card c150, 2026-10-29), into **one EPUB per novel in tsundoku's device
folder**, which the EPUB importer reads as it reads any book
([`IMPORT-EPUB.md`](IMPORT-EPUB.md)) and the text reader reads as any book
([`TEXT-READER.md`](TEXT-READER.md)). **The importer stays the one place a
file becomes an entry**, as it is for downloaded manga
([`DOWNLOADER.md`](DOWNLOADER.md), "The one decision"); text entries in a new
rung, the card's first idea, would have been a second writer and a second
reader path.

- **The series screen** draws a novel's DOWNLOAD row and chapter states as a
  manga's ([`DOWNLOADING.md`](DOWNLOADING.md)): FIRST/NEXT 10, ALL, a tap on
  a row, QUEUED, DOWNLOADING, IMPORTING, FAILED · N TRIES, and the FILE line's
  counts, and FOLLOW ("FOLLOW", below). A novel whose plugin was removed
  draws no row.
- **The queue is the one queue** (`download_queue`), so PAUSE, the queue
  screen, RETRY, ✕ and ↑ TO THE TOP are the same. Two workers take from it:
  the engine's takes a Mihon source's chapters and the novel worker
  (`src/lib/server/novels/downloader.ts`) a plugin's, each leaving the other's
  alone, so an engine that stopped answering doesn't hold novels up. The
  worker starts beside the engine's (`engine/run.ts`): everything that queues a
  novel is behind the engine being set up anyway.
- **A chapter** is the plugin's `parseChapter(path)`, through the host. Its
  HTML is rebuilt from an allowlist into XHTML
  (`src/lib/server/novels/chapter-html.ts`): the reader's own list on the way
  in, so nothing of the site's page (a script, a style, an ad's frame, a link)
  is kept, and the file is well formed for any reader. Its pictures are
  fetched by the server, internet only, every redirect too
  (`net-guard.ts`), up to 40 of 10 MB each, and kept in the book; one that
  doesn't come, or isn't JPEG, PNG, GIF or WebP, is left out, never left
  pointing at the site. A chapter with no words in it (a site's empty shell)
  is a failed try, as is a plugin's error.
- **Batches.** A plugin's chapters come one at a time with a second between
  them; up to ten of one series are fetched, then the book is written once,
  and they leave the queue. Two plugins download at once. Each chapter counts
  its own try (three, with the queue's backoff); if the book can't be written,
  the whole batch does. PAUSE stops a batch between chapters, and what came is
  still written.

### The book

`$LIBRARY_ROOT/devices/tsundoku/Library/Novels/<Source>/<Title>.epub`, its
place fixed at the first download (`novel_series`, rung 45) as a manga's folder
is (`engine_series.title`): the book is rewritten in place, and a rename in
tsundoku moves nothing. A second novel of the same title gets `<Title> (2)`.

- **It holds the chapters downloaded so far**, in reading order, an EPUB 3 with
  a navigation document and an NCX (`src/lib/import/novel-book.ts`). A
  chapter's document is named from its path at the source
  (`OEBPS/Text/c-<hash>.xhtml`), so a chapter the source inserts later moves
  no other, and its locator never changes.
- **And a manifest of every chapter the series has**,
  `META-INF/tsundoku-novel.json`: the plugin and the novel's path (so the
  series' key), and each chapter's path, place, label and title as tsundoku
  has them, with its document or null. That is what makes the file this
  series' own: the importer folds it onto the `lnreader:<plugin>:<path>`
  series ADD made, each entry found by its path, as Mihon's backup folds a
  download folder. A chapter the manifest names and the book doesn't hold
  stays NOT DOWNLOADED. Should the database ever lose the series, the book
  alone brings it back, every chapter included.
- **Not stub documents.** The plan was a stub per chapter not downloaded, in
  the book's contents. It doesn't hold: an entry's text runs up to the next
  entry of its file (`entryDocs`), so a stub between two downloaded chapters
  would have read as the end of the first, and an EPUB's contents may only
  point into its reading order. The manifest says the same without either.
- **Rewritten whole**, from what it held plus the new chapters, written beside
  its place and renamed, so the reader never meets half a book. Its version
  (size and time) changes with each, so a tablet that kept the book fetches it
  again ([`TEXT-READER.md`](TEXT-READER.md)). A 591-chapter web novel is 2–5
  MB; the batches keep a long ALL to one write per ten chapters.
- **Between the write and the import** the chapters are IMPORTING
  (`novel_chapters`, rung 45). The import is the app's own, twenty seconds
  after the last arrival, as for manga, and at startup for anything a restart
  left.

### Reading it

**Since 2026-10-29 a chapter with no file reads online** when the novel's
plugin is installed ([`BROWSING.md`](BROWSING.md), "Novels online"): what
follows is how reading behaves where it can't (no plugin, or a book read
offline).

The text reader reads the book as any other. A novel downloaded so far has
chapters with no file, so **reading stops at the first one**: the next chapter
isn't offered at the end of a page, and turning past the last page shows END ·
LAST AVAILABLE with "CH. 3 IS NOT DOWNLOADED"; the contents list doesn't jump
to one, and opening one directly says the same instead of looking for a file.

`tests/novel-book.spec.ts` (the book, the manifest, the importer's plan, the
chapter allowlist and its pictures), `tests/novel-download-db.spec.ts` (the
queue shared and kept apart, a batch into the book, IMPORTING, the import onto
the series without a second one, a rewrite keeping what it held, a rename,
failures, PAUSE, recovery) and `tests/browse-novels.e2e.ts` (a plugin through
the real host, `tests/fixtures/lnreader/shelf.js`: added from BROWSE, two of
three chapters downloaded and imported, read up to the third).

## FOLLOW

As for a manga ([`DOWNLOADING.md`](DOWNLOADING.md)): FOLLOW on a novel's
DOWNLOAD row, FOLLOWING ✓ to stop (`src/lib/server/novels/follow.ts`; card
c151).

- **Its plugin is asked** at once when it's turned on, then every six hours by
  FOLLOW's ten-minute step, beside the engine's followed manga and whatever
  the engine is doing (`followNew` in `server/downloads.ts`). The ask is
  `parseNovel` with every page of a paged plugin's, never the preview's kept
  answer: what's new is the question. When it was last asked is
  `novel_checks` (rung 46), the row's CHECKED … AGO. A plugin that fails isn't
  recorded as asked, so the next step asks again.
- **A chapter it lists that no entry is becomes one**, with ADD's own plan
  (`planNovel`) through the one writer, so it's numbered as ADD would have
  numbered it; nothing the owner set on the series moves, a deleted chapter
  stays deleted (its tombstone), and the series' cover is left alone.
- **It's queued** unless read, fifty a series a run at most, oldest first, so
  the next ones to read come first (`followQueue`, as for manga).
- **Places.** A chapter's place is its number, or for an unnumbered one its
  place after the last numbered (an interlude after Ch. 7 is 7.5; a second
  one inserted before it makes them 7.001 and 7.002). So a chapter the
  source inserts can move another, and FOLLOW moves it. The book names every
  chapter's place, and a rescan applies the book's, so when one moved, the
  book's manifest is written again with the new places
  ([`IMPORT-EPUB.md`](IMPORT-EPUB.md), "tsundoku's own novels").

**Measured live on 2026-10-29**, through the real host, in a scratch library:
Wuxia World's _I Shall Seal the Heavens_ (1,619 chapters) and Novel Bin's
_The Natives of This World Are Fierce_ (375), each with its newest two
chapters taken out of the library so the plugin listed two new ones: FOLLOW
found them again in 0.75 s and 0.25 s, queued both, and the worker downloaded
them. Wuxia World marks some chapters 🔒, which the site keeps for paying
readers: what a plugin answers for one may be the site's teaser, and nothing
in tsundoku can tell.

`tests/novel-download-db.spec.ts` ("following a novel": asked at once and every
six hours, new chapters made entries and queued oldest first and never twice,
a moved interlude written into the book and kept by a rescan, a failing plugin
asked again, an unfollowed novel left alone) and the FOLLOW cell in
`tests/browse-novels.e2e.ts`.

## Not done yet

Bot checks: c152 above. The book carries no cover of its
own (tsundoku's tiles have theirs). Without the engine set up there's no
BROWSE, so no novels either, though nothing in the novel worker needs it. A plugin's own
settings (`pluginSettings`, a few have them) aren't offered.
