# Novels from LNReader plugins

Light and web novels, found, downloaded and read inside tsundoku on
[LNReader](https://github.com/LNReader/lnreader)'s plugins
([lnreader-plugins](https://github.com/LNReader/lnreader-plugins), MIT), as
manga runs on Mihon's extensions ([`DOWNLOADER.md`](DOWNLOADER.md)). Card c127
("Novels from LNReader plugins, inside tsundoku"), split in five:

| Part                                                 | Card | State                                |
| ---------------------------------------------------- | ---- | ------------------------------------ |
| A sandboxed host for the plugins                     | c147 | Done                                 |
| Repositories and plugins in EXTENSIONS               | c148 | Done                                 |
| Browsing, searching and adding a novel               | c149 | Done                                 |
| Downloading chapters into an EPUB the importer reads | c150 | Done                                 |
| FOLLOW, live checks, the rest of this file           | c151 | Done                                 |
| Past a site's bot check, through FlareSolverr        | c152 | Done (one of three sites; see below) |

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
  above. `require('fs')` is refused. A plugin's own code has **5 s** to load
  (`vm.runInContext`'s timeout); the libraries it names are read from disk
  before that starts, since a cold install's first read of cheerio outlasted
  it on Windows (2026.11.01's smoke test, the installed copy under
  Program Files).
- **A fetch that stays on the internet**: every request, and every hop of a
  redirect (followed by hand, since an automatic one would skip the check),
  is refused when its host resolves to a loopback, private, link-local or
  unique-local address. Tests open a loopback port through the parent's own
  message; nothing else can.
- **A site's browser check is the app's to solve** (c152). The host can't
  reach a solver, since a solver is one of the local addresses it refuses, so
  a 403 or 503 carrying Cloudflare's markers makes it ask the **parent** over
  IPC, naming only the URL. The app checks the address is on the internet and
  asks FlareSolverr (`novels/solver.ts`); what comes back is that host's
  clearance cookies and user agent, never the solver's address and never
  another host's cookie. The host keeps a **jar per host**, applies it to that
  host only, and retries **once**; a jar with any secure cookie in it goes over
  https only. A host whose retry is still a check is remembered for ten
  minutes, so its next chapter is one request, not a solve and a retry. A plain
  403 with no marker stays the site's own answer ("answered 403"), as does one
  whose check it couldn't pass.
- **Calls over IPC with a timeout**: two minutes for every call a plugin
  makes — a list, a search, a preview, a chapter — since its first request may
  meet a site's check the app solves (20–45 s) before the host retries with
  the clearance; the host's own default is a minute, which only `info` uses. A
  plugin stuck in a loop gets the host restarted, and its
  failure is the caller's error, not a crash. A host replaced while the one it
  replaces is still exiting answers its own calls: the dying process's exit
  can't fail its successor's. Each request the host makes has 30 s, redirects
  included, and the retry after a clearance a fresh 30 s: a redirect chain
  can't outlive the two minutes a novel call is allowed.

**What it doesn't stop.** Node 24 has no `--allow-net`, and the plugins need
the network. Code that escapes the vm context (a host object's constructor
reaches the host's `Function`; `tests/novel-host.spec.ts` does exactly that)
finds an empty environment and no file or process access, but could still open
a raw socket to a port on the workstation. Everything there that matters asks
for a token or a session, which the host doesn't have. Running the host in a
container with its own network would close that; it isn't done.

**And a solve is the app's, not the plugin's.** A plugin can ask for any host
on the internet, so it can make the app solve a check for any public site it
names; that is the feature. What it can't do is name a private or loopback
address (refused before the solver hears of it), read the solver's address
(the host's environment is empty and the answer carries only cookies), or
receive a cookie for a host other than the one it asked about.

`tests/novel-host.spec.ts`: a plugin answers each method through the host
(filters' starting values included), and a hostile one fails to require `fs`,
finds no environment, can't read a file or start a process even out of the vm
context, and can't fetch a loopback address directly or by redirect, after
which the host still answers. And a site that answers with a check: the app is
asked by URL only, the retry carries that host's cookies and user agent, the
jar is kept per host and to no other, a retry that is still a check is
reported and remembered so the next call is one request, a secure clearance is
not sent over http, and a plain 403 stays the site's own answer — Cloudflare's
headers or not.

**Measured live on 2026-10-28**, four of the owner's repository's plugins
through the host: NovelBin (10 popular, a novel's 148 chapters, a chapter's
8 KB of HTML) and Wuxiaworld (50, 357 chapters, 8 KB) all the way through.
Royal Road stops at its site's bot check ("Open a novel from Royal Road in
WebView"), and ScribbleHub's popular list comes back empty, most likely the
same. Getting past those needs a solver in the host's path, which the host's
own fetch can't reach (it refuses local addresses on purpose); c152 gives the
host a way to one, below.

## Past a site's bot check

Some novel sites answer a non-browser request with a Cloudflare check, and
three of the five best-known English plugins stop there. The engine already
passes one for a Mihon extension through FlareSolverr; since c152 a novel
plugin's does too, through the app, without giving the host a way to a local
address.

- **Detection first.** A response is a check only when it is a 403 or a 503
  _and_ carries a marker of one: `cf-mitigated: challenge`, `__cf_chl` or
  `/cdn-cgi/challenge-platform/` in its body. `cf-ray` and
  `server: cloudflare` are not markers — Cloudflare sends both on every
  response it proxies, so a members-only 403 and a maintenance 503 carry them
  too. Anything else is the site's own answer, so "Could not reach site (403:
  Forbidden)" still happens for a site that means it — and the three failures
  were not one shape, so a plain 403 is never sent to a solver.
- **The host asks the parent**, since a solver is a local address it refuses:
  `{ op: 'challenge', id, url }` over IPC, the URL and nothing else. The
  parent checks the address is on the internet (`checkPublic` in
  `net-guard.ts`) before the solver hears of it, asks FlareSolverr, and
  answers `{ op: 'challenge-result', id, ok, value }` with that host's
  clearance cookies and its user agent. Never the solver's address, never
  `.env`, never a cookie for another host, and none from a redirect's host. A
  refusal is an answer with nothing, not a crash.
- **The jar is per host.** The host keeps each host's clearance and sends it
  only to that host (`withJar`); a redirect to another host carries nothing of
  the first. A jar holding any secure cookie is sent over https only: a
  clearance in clear text is the one thing it must never be, so `http:` stays
  reachable but gets no clearance. It retries **once** per request: a response
  that is still a check is noted as
  `"<host> answered 403 (its check could not be passed)"`, which the source
  page bands. A plugin asking in a loop waits on the solve already underway
  instead of queueing another — the host dedupes by host, and so does the app
  (`novels/solver.ts`) — since a first solve takes 20–45 s.
- **A refusal is remembered for ten minutes, where it is seen.** The host
  remembers the one that matters for a site whose check it cannot pass even
  with a clearance (NovelFull and Scribble Hub, measured below): when the retry
  is still a check, that host is refused for ten minutes, so each later page or
  chapter makes **one** request — the one that is already a challenge — with no
  solve and no retry. That is what keeps a 148-chapter download from performing
  148 solves. The app keeps its own memo for the other failure: a solve the
  solver itself could not produce (a status of `error`, a page its browser was
  refused) is not asked again for ten minutes either. A solver the app couldn't
  reach, or one that answered with an HTTP error of its own, is **not**
  remembered: that says nothing about the host, and a solver started after the
  app would otherwise be ignored for ten minutes. TRY AGAIN on the source page
  does nothing for a refused host until the ten minutes pass; a restart of the
  app — which takes the host process with it — is the only way to force a
  solve sooner.
- **BROWSE names it.** The app writes the host into `site_checks` when a solve
  succeeds, and `checkingSince` answers for a novel by its plugin's site
  (`novel_plugins.site`), so the live band on the source page and in SEARCH
  THE SOURCES, and "FIRST VISIT WAITS FOR THE SITE'S CHECK" in BROWSE, are
  there for a novel as for an extension ([`BROWSE.md`](BROWSE.md), "A site's
  check"). The app's solver address is `NOVEL_SOLVER_URL`, deliberately not
  `ENGINE_SOLVER_URL` ([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md), "The
  solver, and a novel's check").

**Measured live on 2026-11-02**, the real dialogue against FlareSolverr 3.4.6
on `127.0.0.1:8193` and the real host:

- **Royal Road works.** The solver's cookies and user agent, applied to
  `www.royalroad.com`, gave the host 165 KB of the site's homepage where the
  host's own request had been challenged.
- **NovelFull and Scribble Hub still refuse Node.** The solver fetches both —
  Scribble Hub issues a `cf_clearance`, NovelFull only its own `nt_csrf` —
  but a plain Node request sending the same cookie and the same user agent
  still gets the challenge from both: their check is bound to the browser that
  solved it, not to the cookie. The host now says so distinctly ("answered 403
  (its check could not be passed)") rather than reporting a bare 403, and
  remembers that refusal for ten minutes (above), so a download pays the solve
  once and then makes one request per chapter. Fetching the page itself through
  the solver is the only way past those, and the card rules it out; it would be
  a later card's question.

**Measured live on 2026-11-03**, the same dialogue again, with **the real
plugin files** from the owner's repository (2.3.4 Royal Road, 3.0.0 Novel Bin,
0.5.1 Wuxia World, 2.3.3 NovelFull, 1.0.2 Scribble Hub) through the real host
and FlareSolverr 3.4.6 on `127.0.0.1:8193`, each plugin's own POPULAR, preview
and first chapter:

- **Royal Road works, its own plugin and all.** POPULAR took 19.7 s, 18.5 s of
  it the solve, and gave 20 novels; _Mother of Learning_ came back with 109
  chapters and its first chapter as 54,606 bytes of HTML. The solve is for the
  deep URL the plugin asks (`/fictions/search?...`), not only the home page.
  One earlier attempt timed out inside FlareSolverr (50 s) and returned
  nothing, so a first visit can fail and a retry succeed; the host reports that
  as a check it could not pass, not as a plain 403.
- **Wuxia World works, as it did** (50 popular, 357 chapters, 8,351 bytes),
  and never needed a solve.
- **NovelFull and Scribble Hub still refuse a Node request.** NovelFull's solve
  answered in 1.9 s with only the site's own `nt_csrf`; Scribble Hub's in 4.9 s
  with a `cf_clearance`. Neither cookie makes a Node fetch pass: both are still
  a challenge when retried, so the check is bound to the browser that solved
  it, not to the cookie. NovelFull's plugin reports it as its own "Could not
  reach site (403: Forbidden)"; Scribble Hub's list comes back empty and the
  host says "answered 403 (its check could not be passed)". Fetching the page
  through the solver is the only way past those, and the card rules it out.
- **Novel Bin is no longer a bot-check question.** Its API answers the site's
  own SPA shell — `200 text/html`, 24,153 bytes, for
  `api/cdn/lists/web_popular.json` — where the plugin expects JSON, so the
  plugin throws "Unexpected token '<'". That is the site and the plugin
  drifting apart, not a check: no solve is attempted and the host's own
  detection never fires. It worked on 2026-10-28, above.

So the card is met for **one of its three sites** (Royal Road), and two of the
five plugins measured today, Wuxia World being the one that never needed it.

`tests/novel-solver.spec.ts` is the app's half: a loopback or private address
refused before the solver hears of it, only the asked host's cookies and its
user agent in the answer, a secure cookie making the clearance https-only, one
solve per host at a time, the live line while it runs, `site_checks` on
success, a page the solver's own browser was refused treated as no clearance,
a solve the solver failed remembered and not asked again, and which address
the app uses. `tests/novel-host.spec.ts`'s check block is the host's half — a
clearance the site refused remembered so the next call is one request, a secure
clearance kept off http — and `tests/engine-browse-db.spec.ts` pins the join
BROWSE's live line needs: a novel's `checkingSince` answers while the app's own
solve runs, with the engine not answering at all, and is null once it settles.
`tests/novel-plugins-db.spec.ts` pins the wiring: the host the app builds solves
with `solveChallenge`.

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
- **SEARCH THE SOURCES** asks the plugins the library reads from or BROWSE lists, as it asks
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
  error ("www.scribblehub.com answered 403", or "… answered 403 (its check
  could not be passed)" when it was a bot check); an answer with anything in
  it is kept. The source page bands it with TRY AGAIN.

**Measured live on 2026-10-28**, the owner's repository through the real
host and this module (in-memory database, scratch store): Novel Bin (two
filters, 10 popular, 24 latest, 50 found, a filtered list, a 148-chapter
preview, added with 148 entries in 0.4 s) and Wuxia World (no filters, 50
popular, 357 chapters, added) all the way through. NovelFull, Royal Road and
Scribble Hub stopped at their bot checks then; Royal Road's is now passed by
the app's solve, and the other two still refuse a Node request even with a
real solver's clearance ("Past a site's bot check", 2026-11-02).

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
- **A batch attaches as the book is written** (c170,
  [`DOWNLOADER.md`](DOWNLOADER.md), "Attaching"). Until then, or when a scan
  has to step in, the chapters are IMPORTING (`novel_chapters`, rung 45), and
  the import is the app's own: twenty seconds after the last arrival, and at
  startup for anything a restart left.

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

**REFRESH** (card c220) is the look beside FOLLOW: `checkNovel` with
`queue: false` through `refreshSeries` (`src/lib/server/refresh.ts`), so a new
chapter becomes an entry and nothing downloads. A novel doesn't need to be
followed to be asked ([`DOWNLOADING.md`](DOWNLOADING.md), "REFRESH").

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

Two of the three checked sites still refuse a Node request even with a real
solver's clearance, because their check is bound to the browser that solved it
("Past a site's bot check"); fetching the page through the solver is the way
past those, and it isn't done. The book carries no cover of its own
(tsundoku's tiles have theirs). Without the engine set up there's no BROWSE, so
no novels either, though nothing in the novel worker needs it. A plugin's own
settings (`pluginSettings`, a few have them) aren't offered.
