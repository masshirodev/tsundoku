# The web edition

The web edition is tsundoku running in a browser tab, with nothing installed:
the same app, built a second way, whose server runs in the reader's own
browser instead of on a computer. It is not built yet. This document records
how its screens get their data, decided on 2026-11-25 with a working proof,
and what the proof found. It grows as the edition does.

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
page (SvelteKit's client, unchanged)
  │  fetch /__data.json, ?/action, /api/..., <img src=/api/...>
  ▼
service worker (web/sw.js)
  │  static files (/_app/, static/) → the network, as usual
  │  a navigation → the app's shell (index.html)
  │  everything else → handed to the page that made it
  ▼
page (web/boot.js) → its server worker
  ▼
server worker (web/worker.js): SvelteKit's Server, the app's hooks and routes
  └─ SQLite (WebAssembly) on OPFS, through web/sqlite.js
```

The server cannot live in the service worker itself: SQLite's OPFS mode needs
a dedicated worker's synchronous file handles, which a service worker has not
got. So the page owns the server worker, and the service worker reaches it
through the page.

## The build

`yarn run build:web` sets `TSUNDOKU_WEB=1`, and `vite.config.ts` then picks the
web edition's adapter (`web/adapter.js`). An adapter is SvelteKit's public way
to package an app for a runtime; this one uses only the builder's public calls
(`writeClient`, `writeServer`, `generateManifest`, `generateFallback`):

| Output (`build-web/`)             | What                                                           |
| --------------------------------- | -------------------------------------------------------------- |
| `index.html`                      | SvelteKit's SPA shell, its start held until `boot.js` calls it |
| `_app/`                           | the client, exactly as the self-hosted build has it            |
| `sw.js`, `boot.js`                | the relay                                                      |
| `server/worker.js` and its chunks | SvelteKit's `Server` and all server code, bundled for a Worker |

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
- **The app's own service worker is not registered** (see "Open").

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
- The server is 6.9 MB of JavaScript, 2.0 MB gzipped (unminified), beside the
  11 MB client the self-hosted build already serves.

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
   address, its result lost. Ten POST forms in seven files post without
   `use:enhance` today; giving them `use:enhance` removes the case.
4. **The relay's own files are static.** `/boot.js` handed to the page it is
   meant to start would wait for ever.

Open, each for the card that needs it:

- **One tab.** `opfs-sahpool` lets one connection hold the database. A second
  tab must not open its own server: one tab leads (Web Locks) and the others'
  service-worker requests go to it.
- **The app's own service worker** (`src/service-worker.ts`, offline chapters)
  would replace the relay on the same scope; the web build does not register
  it yet. The two become one service worker.
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

## Testing

- `tests/web-edition.spec.ts`, in the unit suite: the SQLite stand-in against
  better-sqlite3, the path module against Node's, the stand-in plugin, the
  shell's held start.
- The web build in a browser is not yet in a suite; the build card brings a
  browser test of it (doc/TESTING.md).
