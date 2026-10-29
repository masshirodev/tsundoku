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
| Downloading chapters into an EPUB the importer reads | c150 | Not yet |
| FOLLOW, live checks, the rest of this file           | c151 | Not yet |
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
  works as for manga. Its DOWNLOAD row comes with c150.
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

## Storing a novel: one EPUB, written as a device

Decided 2026-10-28 for c150, over the card's first idea (each chapter a `text`
entry in a new schema rung):

- **A novel is one EPUB** in tsundoku's device folder,
  `$LIBRARY_ROOT/devices/tsundoku/Library/Novels/<Source>/<Title>.epub`. The
  EPUB importer reads it like any book ([`IMPORT-EPUB.md`](IMPORT-EPUB.md)),
  and the text reader reads it like any book
  ([`TEXT-READER.md`](TEXT-READER.md)): **the importer stays the one place a
  file becomes an entry**, as it is for downloaded manga
  ([`DOWNLOADER.md`](DOWNLOADER.md), "The one decision"). Text entries would
  have been a second writer and a second reader path.
- **Its table of contents is every chapter the source lists.** A chapter not
  downloaded yet is a stub document, marked as one, which the importer reads
  as an entry NOT DOWNLOADED: so the DOWNLOAD row, NEXT 10, ALL and FOLLOW work
  as they do for manga.
- **A chapter's locator comes from its path at the source**, not its place, so
  a chapter the source inserts later never moves anyone's progress: the
  importer finds an entry again by its locator, and keeps its read state.
- **The file is rewritten** as chapters arrive (a 591-chapter web novel is
  2–5 MB), written beside and renamed, as the CBZs are.

## Not done yet

Downloading, FOLLOW and bot checks: c150 to c152 above. A plugin's own
settings (`pluginSettings`, a few have them) aren't offered.
