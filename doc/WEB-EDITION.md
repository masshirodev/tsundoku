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

## The fetcher

A page cannot read a response from another site unless that site allows it,
and no source does; nor can it set `Cookie`, `Referer` or `User-Agent`. A
browser extension with host permissions can do both, so the web edition's
network goes through one: **the fetcher**, a Manifest V3 extension, one build
for Chromium and Firefox. It fetches and nothing else: a URL, a method, headers
and a body in; the status, headers and bytes out. It knows nothing about any
source, so it rarely needs updating and holds nothing worth reviewing beyond
"it makes requests" (the design's reasons are in the private design
repository's `plans/WEB-EDITION.md`, "The fetcher extension").

| Where                           | What                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/fetcher/`              | Everything the extension decides: the protocol, the origin check, headers, cookies, rules, bytes, the suffix list. Pure, with no `chrome.*`. |
| `src/lib/web/fetcher-client.ts` | The page's side: the handshake, and `fetch()` through the extension.                                                                         |
| `fetcher/background.ts`         | The background (a service worker in Chromium, an event page in Firefox): hands the browser's APIs to `src/lib/fetcher/service.ts`.           |
| `fetcher/content.ts`            | The content script: hands the page's window to `src/lib/fetcher/relay.ts`.                                                                   |
| `fetcher/manifest.json`         | The manifest's template: the build fills in the content script's matches. `fetcher/webext.d.ts` types the few WebExtension calls made.       |
| `fetcher/build.ts`              | Bundles each script into one unminified classic file, in `build-fetcher/store/` or `build-fetcher/development/` (below).                     |

The logic lives in `src/lib/fetcher/` rather than beside the manifest because
the page and the extension share its protocol (one `FETCHER_PROTOCOL`, one set
of message types, imported by both, so they cannot drift), and because there
it is typechecked by `yarn run check` and measured by the unit suite's
coverage like the rest of `src/lib`. The glue in `fetcher/` is checked by
`tsc -p fetcher/tsconfig.json`, part of `yarn run check`, and exercised by the
browser test. The extension needs a build step anyway: a content script cannot
be a module, so whatever it shares must be bundled into it.

### Two builds: store and development

**The store build answers `https://tsundoku.lt` only.** The development build
also answers a development server on `http://127.0.0.1` or `http://localhost`
at any port, and must never be published: any page there (a dev server, a
local tool, something an npm package started) would get a fetcher that sends
the visitor's cookies for every site.

```sh
yarn run build:fetcher         # the store build:       build-fetcher/store/
yarn run build:fetcher --dev   # the development build: build-fetcher/development/
```

The decision lives in one place, `src/lib/fetcher/protocol.ts`: the two origin
lists, `isAllowedOrigin(origin, edition)`, `contentScriptMatches(edition)` and
`manifestFor(template, edition)`. The build passes its edition to the code as
the constant `__FETCHER_EDITION__` and writes the manifest through
`manifestFor()`, so the manifest's matches, the content script's check and the
background's check cannot disagree. `fetcher/manifest.json` carries no matches
of its own, so a hand-copied template cannot ship loopback either. The
development build is named "tsundoku fetcher (development)" in the browser's
list, so the two are never mistaken for each other.

Held by `tests/fetcher-protocol.spec.ts` (the store manifest and origin list
name no loopback host) and by the browser test, which runs the built store
bundles themselves on a loopback origin and finds them refusing it, and loads
the store build into Chromium, where a loopback page gets no fetcher.

### The message protocol

The page and the content script share the page's window and talk by
`window.postMessage` on it, to the page's own origin; each side reads only
messages whose `source` is that window, whose origin is its own, whose
`channel` is `tsundoku-fetcher`, and whose `from` is the other side.

| Message                                                                               | Direction      | What                                                                                        |
| ------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `ping` `{ nonce }`                                                                    | page → fetcher | Is a fetcher here, and what can it reach?                                                   |
| `hello` `{ to, protocol, version, transport, access }`                                | fetcher → page | The answer to one ping (`to` is its nonce), once the background has answered a fresh probe. |
| `request` `{ id, request: { url, method, headers, body } }`                           | page → fetcher | `headers` is a list of `[name, value]` pairs (order and repeats kept); `body` a Uint8Array. |
| `response` `{ id, response: { status, statusText, url, redirected, headers, body } }` | fetcher → page | `url` is the final one after redirects; `body` a Uint8Array whose buffer is transferred.    |
| `error` `{ id, message }`                                                             | fetcher → page | In words: `network error: …`, `only http and https are fetched, not file:`, …               |

Between the content script and the background, runtime messages: a `probe`
of bytes, echoed with the site access (below), and `fetch`
`{ transport, request }`, answered by `fetched` `{ ok, response | message }`.

### The handshake

The extension announces `FETCHER_PROTOCOL` (`src/lib/fetcher/protocol.ts`),
a whole number raised only when a message changes shape. `connectFetcher()`
pings and waits for the hello that answers its ping, and answers one of five:

- `ready`, with a `fetcher` whose `fetch(request)` resolves to the response
  or rejects with the fetcher's words, and whose `access` is `all`, or `some`
  when the visitor narrowed the extension to some sites (a fetch to another
  then fails as a network error);
- `no-access`: installed, but allowed to reach no site. The visitor grants it
  in the browser's extension settings; connect again afterwards (on focus,
  say), and no reload is needed;
- `missing`: no hello within the timeout (1.5 s by default): not installed, not
  allowed on this origin, or its background not answering;
- `too-old`: the extension speaks an older protocol than the page. Update the
  extension;
- `too-new`: the extension is newer than the page. Reload for the new app.

A fetcher on any other protocol is refused whole rather than half-used.
Protocol 2 added the nonce and `access`.

**Site access is asked afresh for every ping.** The content script probes the
background on each, and the background asks the browser:
`permissions.contains({ origins: ['<all_urls>'] })` for `all`, else whether
`permissions.getAll()` grants any origin besides the content script's own
matches (Chromium lists those as granted, but they are tsundoku's pages, not
sources) for `some`, else `none` (`siteAccessFrom`). A browser that cannot say
counts as `none`. The hello answers its own ping by nonce, so an answer probed
before a grant never reaches a client that asked after it.

Firefox makes Manifest V3 host permissions something a visitor can withhold:
Firefox 155 granted them when the add-on was installed (the browser test needs
no preference for it), and the visitor can withdraw them in `about:addons`,
which is `none`. Chromium grants them on install and lets a visitor narrow
them to some sites, which is `some`.

### Who it answers

`https://tsundoku.lt`, and in the development build a development server at
`http://127.0.0.1` or `http://localhost` on any port (above). Nothing else: a fetcher that answered any page
would let every site act inside the visitor's sessions elsewhere. Checked three
times:

1. **The manifest's content-script matches** carry no port (Firefox ignores a
   pattern with one; one without matches every port), top frame only.
2. **The content script** checks `location.origin` against the list before it
   listens at all (`startRelay`).
3. **The background** answers only its own content script (`sender.id`), in a
   tab, in the top frame, on an allowed origin: `sender.origin` in Chromium,
   the origin of `sender.url` in Firefox, which gives no `sender.origin`
   (`mayAnswer`).

`tests/fetcher-protocol.spec.ts` holds the manifest's matches to the list.

### What it sends

Each header the page asks for is sorted three ways (`src/lib/fetcher/plan.ts`):

| Header                                                                                                      | Goes                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Most (`Accept`, `Content-Type`, `X-Requested-With`, …)                                                      | Through `fetch()` itself.                                                                                                                                                                 |
| `User-Agent`, `Referer`, `Origin`, `Accept-Charset`, `Date`, `DNT`, `Via`                                   | Through the request's session rule: `fetch()` drops them without a word. An `Origin` the page did not ask for is removed, so the extension's own (`chrome-extension://…`) never goes out. |
| `Cookie`                                                                                                    | Replaced by the browser's own (below). The page's is never sent.                                                                                                                          |
| `Accept-Encoding`; `Host`, `Connection`, `Content-Length` and the other framing headers; `Sec-*`, `Proxy-*` | Never. The browser writes its own `Accept-Encoding` and decodes the body; the framing is the browser's; `Sec-*` are its account of the request.                                           |

The fragment is dropped (it never reaches a network). Only `http` and `https`
are fetched, with the methods a rule can be scoped to (`GET`, `HEAD`, `POST`,
`PUT`, `PATCH`, `DELETE`, `OPTIONS`), and a `GET` or `HEAD` carries no body.
`fetch()` is called with `credentials: 'include'` (cookies the site sets in
reply are kept by the browser), `referrerPolicy: 'no-referrer'` (a Referer is
the page's or none), `cache: 'no-store'` (the engine keeps its own cache) and
`redirect: 'follow'`. In the answer, a body the browser decoded loses its
`Content-Encoding` and `Content-Length`, which described the encoded bytes.

### Cookies

**The browser's cookies are the only cookies.** A request made by an extension
belongs to no site, so the browser leaves out the cookies a site keeps in its
own partition (CHIPS), and Cloudflare's `cf_clearance` is one of them. So the
fetcher builds the Cookie header itself through the `cookies` permission: the
unpartitioned cookies for the URL, plus those in the site's own partition,
`cookies.getAll({ url, partitionKey: { topLevelSite } })`. A cookie both reads
return is sent once; longer paths come first, as a browser orders them.
Nothing is copied between jars. A browser that refuses `partitionKey` gives
the unpartitioned cookies alone.

The partition is named by the **Public Suffix List**: scheme plus registrable
domain (`https://a.b.example.co.uk` is in `https://example.co.uk`'s), with the
list's private section counted, as both browsers count it
(`someone.github.io` is a site of its own). The last two labels would name
`co.uk`, and find nothing.

Over plain http to a loopback host (`localhost`, `127.x`, `[::1]`), the URL's
https form is asked too. Both browsers count loopback as a secure context and
send it Secure cookies, and a partitioned cookie is always Secure, but
Firefox's `cookies.getAll({ url })` matches the scheme strictly and leaves
them out. Found by the browser test: Firefox stored the test's partitioned
cookie, sent it itself to a tab on `http://localhost`, and returned it to the
extension only for the https form. It touches only development; sources are
https.

### The suffix list: vendored, not a dependency

The list is `src/lib/fetcher/public_suffix_list.dat`, a copy of
`https://publicsuffix.org/list/public_suffix_list.dat`, read by a matcher of
under a hundred lines in `src/lib/fetcher/psl.ts` that follows the list's own
format (exact rules, `*.` wildcards, `!` exceptions, the default `*`, IDN rules
in punycode). It is bundled into `background.js` unmodified, its MPL-2.0
notice included, and parsed on the first request after the background starts.
It is 345 KB of the extension's 379 KB.

Why not `tldts` or `psl` from npm: either would be a dependency inside an
extension that can read every site's cookies, more code for a store reviewer
and a supply chain to watch, for an algorithm the list's format specifies in a
page. The list itself cannot be fetched at build time, which has no network.
So the data is vendored and the code is ours, and both are tested
(`tests/fetcher-psl.spec.ts`, which reads the vendored copy).

**Refreshing it**: `yarn run fetcher:psl` downloads the list, refuses a
download without both sections or with fewer than 5,000 rules, writes the file
and prints its `VERSION`; commit the result. Do it before each release of the
fetcher. A stale list only matters for a suffix added since: a site under it
would be named one label too wide, its partitioned cookies not found, and a
Cloudflare source would answer 403 until the list is refreshed.

### The User-Agent

A Cloudflare clearance is valid only with the User-Agent that earned it, which
is the browser's. So **a host holding a `cf_clearance` cookie** (in either jar)
gets the browser's own User-Agent whatever the page asked; any other host gets
the one the page (the engine) asked for, or the browser's when it asked for
none (`chooseUserAgent`).

### Session rules

Every request gets its own `declarativeNetRequest` session rule
(`buildRule`), carrying its User-Agent, Referer, Origin and Cookie:

- **Scoped to the one request**: this exact URL (`urlFilter: |url|`, case
  sensitive), this method, resource types `xmlhttprequest` and `other`, and
  `tabIds: [-1]`, the requests that belong to no tab, so nothing a tab loads is
  ever touched. A URL with `*` or `^` in it, which a urlFilter reads as
  wildcards, is matched by an escaped, anchored `regexFilter` instead.
- **Removed when the answer is in**, or on failure. A rule that could not be
  removed keeps its id for good.
- **Unique ids under concurrency**: each request takes the smallest id not in
  use and gives it back after (`RuleIds`). Session rules outlive the background
  (a stopped service worker or event page leaves its rules), while requests do
  not, so every rule present when the background starts is a leftover and is
  removed before the first is added.
- **One request at a time per method and URL**: two in flight to the same URL
  would each match the other's rule, and which rule's headers win is not
  defined. So those queue (`KeyedQueue`), and each reads the cookies in turn,
  after the one before it was answered. Requests to anything else run at once.

### Bytes

| Leg                         | Chromium 153                                       | Firefox 155                              |
| --------------------------- | -------------------------------------------------- | ---------------------------------------- |
| page ↔ content script       | structured clone; the answer's buffer transferred  | the same                                 |
| content script ↔ background | JSON: a Uint8Array arrives as an object, so base64 | structured clone: a Uint8Array as itself |

Which form a browser takes is not assumed from its name: the content script
sends the background a probe of all 256 byte values on start and keeps
`binary` if they come back intact, `base64` otherwise (`src/lib/fetcher/bytes.ts`).
The browser test asserts what each browser did, so a Chromium that starts
cloning shows up there. Base64 costs a third more bytes and a pass each way;
Chromium caps one runtime message at 64 MiB, far above a page image.

### Loading it by hand

For a development server, build the development edition first:
`yarn run build:fetcher --dev` writes `build-fetcher/development/`. (The store
build in `build-fetcher/store/` answers `https://tsundoku.lt` only.)

- **Chrome, Edge**: `chrome://extensions`, turn on Developer mode, **Load
  unpacked**, pick `build-fetcher/development/`. After a rebuild, press its
  reload button.
- **Firefox**: `about:debugging#/runtime/this-firefox`, **Load Temporary
  Add-on…**, pick `build-fetcher/development/manifest.json`. If the page says
  `no-access`, the fetcher's **Permissions** tab in `about:addons` allows it
  to access data for all websites. A temporary add-on lasts until Firefox
  closes. `npx web-ext run --source-dir build-fetcher/development` does the
  same in a fresh profile.

Then open tsundoku on `http://localhost:<port>` or `http://127.0.0.1:<port>`;
`connectFetcher()` answers `ready`.

### How it is tested

- **Unit specs**, no browser: `tests/fetcher-protocol.spec.ts` (origins, the
  sender check, the manifest), `fetcher-psl` (the format and the vendored
  list), `fetcher-cookies`, `fetcher-plan` (headers, User-Agent, the rule),
  `fetcher-schedule` (ids, the queue), `fetcher-bytes`, `fetcher-service` (the
  background on a fake browser: rules added and removed, concurrency,
  failures) and `fetcher-client` (the real client, relay and background on a
  fake window, crossing as each browser does). They cover `src/lib/fetcher/`
  and the client whole.
- **The browser test**, `yarn run test:fetcher`: the development build in
  Playwright's Chromium and in the system Firefox, fetching from a local
  server that records what it received, partitioned cookie included, and the
  store build refusing loopback pages (doc/TESTING.md, "The fetcher
  extension").

### Open

- **Redirects.** The rule matches the URL asked for, not where a redirect
  leads, so a later hop goes with the browser's own User-Agent, no Referer and
  only the cookies the browser attaches itself (no partitioned ones). The
  answer says `redirected` and its final `url`. If a source needs its headers
  on every hop, the fetcher must follow redirects itself.
- **Set-Cookie** never reaches the page (`fetch()` hides it). The browser
  keeps the cookie, so the next request carries it.
- **No abort or timeout message.** A request the page stops waiting for still
  runs to its end.
- **No word when access changes.** A grant or a withdrawal is seen at the
  page's next `connectFetcher()`; the fetcher does not tell a page that is
  already connected. The page reconnects when it regains focus.
- **`none` was not shown in a real browser.** Withdrawing a permission needs
  the browser's own settings, which the test does not drive; the specs cover
  it on a fake browser.
- **Store review**, as the design warns: `<all_urls>` and `cookies` are what
  a reviewer looks at hardest.

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
