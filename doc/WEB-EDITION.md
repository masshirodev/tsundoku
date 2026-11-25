# The web edition

The web edition is tsundoku running in a browser tab, with nothing installed:
the same app, built a second way, whose server runs in the reader's own
browser instead of on a computer, at tsundoku.lt once it is deployed. This
document records how its screens get their data (decided on 2026-11-25 with a
working proof), how the build is made and tested, and what is still open. It
grows as the edition does.

The self-hosted app is unchanged by any of it: the web edition is a second
build of this repository (`yarn run build:web`), and nothing it adds reaches
`yarn run build`.

## The decision: the server runs in the tab

**SvelteKit's own server, with every route's `load` and form action as they
are, runs in a dedicated Worker of the page.** A service worker hands it the
page's requests; it answers them exactly as the Node server would. SQLite runs
in that worker too, in its WebAssembly build, on the browser's private file
storage (OPFS). The screens do not know which server answers them.

The other way was a data interface per screen: every `+page.server.ts` load
and action rewritten as calls with two implementations, the server's and the
browser's. It was set aside:

- **It is a rewrite, and a lasting double.** There are 29 page loaders and
  their actions plus about 70 `+server.ts` endpoints. The library's loader is
  753 lines with some 25 actions; the series page's is 1,448. Each would be
  split in two, and every change after it made twice, or the editions drift.
- **It would need everything the chosen way needs anyway.** The browser half
  of each interface still calls `src/lib/server/` (the queries, the rules,
  `db.ts`), so it still needs SQLite in the browser and the same stand-ins for
  Node. The interface adds the rewrite on top and removes nothing.
- **The chosen way was cheap to prove.** One session took the library screen
  from nothing to rendering, writing and persisting in Chromium and Firefox,
  below. A rough estimate for the interface on the same screen was a few days,
  and a week or more for the series page alone.

What it costs instead: the server's code has to load in a browser. That is
what the stand-ins below are for, and each Node-only capability (files,
processes, native image code) is a stand-in to write when a feature needs it.

## How a request travels

```
any tab (SvelteKit's client, unchanged)
  │  fetch /__data.json, ?/action, /api/..., <img src=/api/...>
  ▼
the app's service worker (src/service-worker.ts, built with __WEB_EDITION__)
  │  static files (/_app/, static/, boot.js, server/) → its cache, else the network
  │  a navigation → the app's shell (index.html)
  │  a kept chapter or episode → its cache, as in the self-hosted app
  │  everything else → the leading tab ($lib/web/relay)
  ▼
the leading tab (web/boot.js) → its server worker
  ▼
server worker (web/worker.js): SvelteKit's Server, the app's hooks and routes
  └─ SQLite (WebAssembly) on OPFS, through web/sqlite.js
```

The server cannot live in the service worker itself: SQLite's OPFS mode needs
a dedicated worker's synchronous file handles, which a service worker has not
got. So a tab owns the server worker, and the service worker reaches it
through that tab.

### One service worker

The web edition's service worker is the app's own, `src/service-worker.ts`,
built a second way. Where the self-hosted app's worker fetches from the
server, the web edition's asks the leading tab instead (`server()` in that
file), and every request the server answers is answered there, since nothing
on the network could. Everything else is the same worker: the app shell kept
for offline use, chapters and episodes kept on the device, the reader's
network-first rules. Two differences, both because the server is in the tab:

- **Install does not wait for the app's files.** The tab cannot start until
  the worker controls it, so keeping 13 MB first would hold every first
  visit. The tab asks for the copy once it runs (`tsundoku-precache`), and the
  worker keeps the client, the shell, `boot.js` and the server's files (listed
  by the build in `server/files.json`).
- **No copy of each screen.** The self-hosted worker keeps the last answer of
  each screen for when the server cannot be reached; the in-tab server always
  can, so it keeps none.

### One tab leads

`opfs-sahpool` lets one connection hold the database, so one tab runs the
server and the others use it. In `web/boot.js`:

1. Every tab asks for the `tsundoku-server` Web Lock, first without queueing
   (`ifAvailable`). The tab that gets it starts the server worker, tells the
   service worker it leads (`tsundoku-leader`), and holds the lock for as long
   as it is open. It starts the app once its server is ready, so a server
   that cannot start is shown.
2. A tab that does not get it starts the app at once (its requests wait in
   the service worker until a leader is ready) and queues for the lock.
3. When the leader closes, the browser gives the lock to the first tab in
   line, which starts its own server on the same database and says so. The
   SQLite stand-in tries opening the pool again for up to 10 s, because the
   closed tab's worker can still hold its files for a moment.
4. The service worker sends every request to the leader it was last told of.
   It can be stopped and started again at any time, which forgets the leader:
   it then asks every window (`tsundoku-who-leads`) and the leader answers.
   A request with no leader waits up to a minute (a first visit climbs every
   migration), then is answered 503.
5. A request sent to a leader that closes before answering is answered 503
   when the next leader says it is ready: it is lost with that server, and is
   never sent twice, since it may have been a write.

### Forms

A form posted without `use:enhance` is a navigation, whose answer the browser
shows as the page. The web edition shows only its shell, so the service
worker can pass on only a redirect and sends anything else back to the
page's address, its result lost. **Every form in the app posts with
`use:enhance`** (since c1116), so this is the no-script case only. Two forms
had script of their own on submit, and `enhance` ignores a form's own
`preventDefault`: SEARCH's bar decides in its `SubmitFunction` what it answers
itself and cancels the post, and the TV's pairing digits empty themselves
after a post, as the page load used to do. A new plain POST form is a bug in
the web edition.

## The library database

**Where it lives.** One SQLite file, `/tsundoku.sqlite`, in the browser's
private file storage for this site (OPFS), inside SQLite's `opfs-sahpool`
pool under the folder `/tsundoku`. The pool names its files itself, so the
database is not a file a visitor can find in OPFS by that name, only through
SQLite. It is the self-hosted schema exactly: `db.ts` opens it and climbs
every migration on the first visit, with the same version checks, and the
hidden-series filters (`visibility.ts`) run unchanged. The browser test opens
every test as a first visit, so it climbs them all every run.

**No copy before a migration.** The self-hosted app copies the database before
its schema moves (doc/BACKUPS.md, "Before a migration"). The web edition does
not, decided on 2026-11-25:

- Each migration already runs in its own transaction, so one that fails
  leaves the database at the last good version; a copy only helps against a
  migration that succeeds and damages data.
- Against that, a copy in the same storage is lost with it: clearing the
  site's data, or the browser clearing it, takes both. The web edition's net
  is the account's encrypted save (planned before launch), not a second file
  in the same place.
- OPFS could hold one (a `VACUUM INTO` a second pool file works), so this is a
  choice, not a limit. Until there are accounts, a bad migration in a
  tester's browser has no undo; the web edition is not public before then.

The copy is attempted and fails in the stand-in for `node:fs`, which
`db.ts` already catches: it logs "no snapshot before migrating" in the
server worker's console and carries on, which is what the decision says.

**Resetting it.** Clearing this site's data in the browser (the site
settings, or Firefox's "Clear cookies and site data") removes the database,
the service worker and the offline copy; the next visit is a first visit.
There is no reset inside the app yet: SETTINGS has none in the self-hosted
app either.

**Keeping it.** A browser may clear a site's storage under disk pressure
unless the site asked it not to (`navigator.storage.persist()`): Chrome and
Edge decide silently, Firefox asks the visitor. `$lib/web/keep.ts` reads the
answer, asks, and remembers that it asked, since a browser that said no and
one never asked both answer "not persisted". SETTINGS' 05 — LIBRARY has two
rows in the web edition only, KEPT (where the library is, and the browser's
answer, with ASK or ASK AGAIN) and CLEARED BY; when the browser was asked and
said no, a standing band over SETTINGS says the library can be cleared and
that the browser holds the only copy (handoff `web-edition-start`,
`Keep-Refused`; the `Band` component's `wrap`, so the detail is read whole).
The first ask comes after the first series is added (the owner's choice,
2026-11-25), from the ADD card (c1123).

Departure from the handoff: it offers Chrome on a desktop a second place,
**a folder** the visitor picks, "which moves the library there". The
database cannot move there: `opfs-sahpool` needs OPFS's synchronous file
handles, which a picked folder does not have. The folder is for downloaded
content, and arrives with downloading in the browser (after the thin path).

## The build

`yarn run build:web` sets `TSUNDOKU_WEB=1`, and `vite.config.ts` then picks the
web edition's adapter (`web/adapter.js`). An adapter is SvelteKit's public way
to package an app for a runtime; this one uses only the builder's public calls
(`writeClient`, `writeServer`, `generateManifest`, `generateFallback`):

| Output (`build-web/`)             | What                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| `index.html`                      | SvelteKit's SPA shell, its start held until `boot.js` calls it    |
| `_app/`                           | the client, exactly as the self-hosted build has it               |
| `service-worker.js`               | the app's own service worker, built with `__WEB_EDITION__`        |
| `boot.js`                         | starts a tab: the service worker, the lead, the server            |
| `server/worker.js` and its chunks | SvelteKit's `Server` and all server code, bundled and minified    |
| `server/files.json`               | the shell, `boot.js` and the server's files, for the offline copy |

`yarn run serve:web` serves it locally at `http://localhost:42160/` (port 42160
is the web edition's on the workstation).

The web build differs from the self-hosted one in `vite.config.ts` only, never
by `if (web)` in a screen:

- **`__WEB_EDITION__`**, a build-time constant. It is the literal `false` in
  the self-hosted build and in the specs (`vitest.config.ts`), so no
  environment variable on a server can switch the web edition's rules on.
- **No sign-in.** `src/lib/server/auth.ts` lets every request in when
  `__WEB_EDITION__`: the tab is its own only client.
- **No cross-site form check.** SvelteKit refuses a form post whose Origin is
  not its own. The web edition's server has no network address, only this
  origin's own pages reach it, and a `Request` made in a browser cannot carry
  an Origin header at all, so the web build trusts every origin
  (`csrf.trustedOrigins`). The self-hosted build keeps the check.
- **The service worker is registered by `web/boot.js`**, not by SvelteKit:
  the tab must wait for it to take charge before the app starts.

## The stand-ins

Everything in `web/` is plain JavaScript run by the build, outside the app's
TypeScript. Each part is checked against the real thing in
`tests/web-edition.spec.ts`.

- **`better-sqlite3` → `web/sqlite.js`.** The part of its API tsundoku uses
  (`prepare` with `get`, `all`, `run`, `pluck`, `raw`; `exec`; `pragma`;
  `transaction`, nested as savepoints; `close`), over SQLite's official
  WebAssembly build (`@sqlite.org/sqlite-wasm`). Synchronous, like
  better-sqlite3, because the `opfs-sahpool` VFS is, so `db.ts` and every
  query run unchanged, migrations included. Statements are cached per SQL
  text: tsundoku prepares freely, and a WebAssembly statement is never
  collected. The spec runs the same statements on both and compares every
  answer.
- **Node's built-ins → `web/node-stubs.js`**, a build plugin. Every built-in
  becomes a module with the same export names, read from Node at build time,
  each throwing "not in the web edition" when called. Importing never fails,
  so all the server code loads; only a path that really needs the machine
  fails, naming the call. Replaced rather than stubbed: `path`
  (`web/node-path.js`, posix, checked against Node's), `buffer` (the npm
  package), `async_hooks` (below), and a few calls made while modules load
  (`util.promisify`, `util.debuglog`, `os.platform`, ...).
- **`undici` → `web/undici.js`.** The browser has `fetch`. tsundoku takes only
  undici's `Agent`, which `net-guard.ts` gives fetch so a server cannot be
  steered at private addresses; in a tab the "server" is the reader's own
  browser, whose own rules govern that, and its fetch ignores the agent.
- **`sharp` → `web/sharp.js`.** Native code cannot load in a tab. Its settings
  calls are accepted; an image call says it is not in the web edition yet.
- **`process`, `Buffer` and timers → `web/process.js`**, set before any server
  code loads. The environment names the database (`/tsundoku.sqlite`, in
  OPFS). Timers get Node's `unref()`, which the background jobs call.
- **`AsyncLocalStorage` → `web/async-hooks.js`.** Paraglide keeps each
  request's language in one. The browser has none, so this one holds one
  store at a time. Requests that interleave would see each other's store; in
  the web edition every request is the same reader's, in the same language, so
  the answer is the same. Anything that needs a real per-request store must not
  rely on it.

## The proof

Run on the workstation on 2026-11-25, in Chromium (Playwright's) and Firefox:

- The library screen rendered from tsundoku's own loaders: the empty library,
  GET STARTED 0 OF 7, the shelf counts, all read from a fresh database in OPFS
  that had climbed every migration in the browser.
- A form action wrote: `?/newShelf` through the relay, answered with the same
  `303` redirect as the Node server, in 34 ms (Chromium) and 49 ms (Firefox).
- **The real "+ NEW SHELF" form**, a plain POST with no `use:enhance`, created
  a shelf and landed on it.
- The shelf was still there after a reload, and after closing the browser and
  opening it again.
- The tab was ready (server worker started, database open) 1.2 s after opening
  on a later visit in Chromium, 2.1 s in Firefox; a first visit, with its one
  reload and every migration, about 4.4 s.
- The server was 6.9 MB of JavaScript, 2.0 MB gzipped, unminified. Minified
  since c1116: 5.3 MB, 1.47 MB gzipped, beside the 11 MB client the
  self-hosted build already serves.

## What the proof found, and what is still open

Found and handled in the proof:

1. **A first visit is not controlled by the service worker** until it loads
   again, so `boot.js` reloads once.
2. **SvelteKit's client must wait for the server.** Its shell starts the client
   from an inline script; the adapter turns that script into a function
   `boot.js` calls once the server worker is ready, keeping the script element
   it looks itself up by. The adapter refuses to build if the shell ever stops
   matching, rather than ship a page that never starts.
3. **A plain form post is a navigation.** The service worker answers
   navigations with the shell, so a POST navigation goes to the server through
   the page that sent it (still open while it is pending). Its answer must be
   a redirect; an action that answers with a page is sent back to the page's
   address, its result lost. Ten POST forms in seven files posted without
   `use:enhance`; since c1116 all of them use it ("Forms", above).
4. **The relay's own files are static.** `/boot.js` handed to the page it is
   meant to start would wait for ever.

Open, each for the card that needs it:

- **Files.** `node:fs` is a stub: covers, downloads and imports need an
  OPFS-backed stand-in (or the folder the reader picks in Chromium).
- **Images.** `sharp`'s work (thumbnails, duplicate hashes) moves to
  `createImageBitmap` and `OffscreenCanvas` in a worker.
- **Network.** Server code that fetches a site (catalogues, sources) meets
  the browser's same-origin rules; those requests go through the fetcher
  extension, by the engine's transport or a `fetch` stand-in.
- **Processes.** `child_process` (ffmpeg, OCR, starting the engine) has no
  browser equivalent; the engine runs in the tab, and the rest are later
  decisions.
- **Background jobs** started by `init` in `hooks.server.ts` (the relations and
  TMDB fills) run in the tab and need the network above.
- **No server-rendered HTML.** Every page is the shell, then its data. Layout
  is CSS media queries, so the first paint is still right for the device.

- **What a tab shows while it starts, or when it cannot** (a Firefox private
  window has no service workers), is a blank page today: the design brief
  `WEB-EDITION-START.md` (card c1127) covers it.

## Testing

- `tests/web-edition.spec.ts`, in the unit suite: the SQLite stand-in against
  better-sqlite3 (and opening the pool again after a takeover), the path
  module against Node's, the stand-in plugin, the shell's held start.
- `tests/web/relay.spec.ts`, in the unit suite: the relay's half in the
  service worker, with fake windows: a request reaching the leader, waiting
  for one, finding one after the worker forgot, and a takeover's lost requests.
- **`yarn run test:web`**: the web build in Chromium and Firefox
  (`playwright.web.config.ts`, specs in `web/tests/`). It builds `build-web/`
  (under the same build lock as the main suite's build), serves it on 4185,
  and opens it as a first visit in each test: the empty library from the
  in-tab server, a write through a real form kept across a reload, a second
  tab using the first one's server and taking over when it closes, and static
  files passing the server by. doc/TESTING.md, "The web edition".
