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
5. A request sent to a leader that closes before answering is answered when
   the next leader says it is ready, or sooner when another request finds the
   leader's window gone first: it is lost with that server, and is never sent
   twice, since it may have been a write. A form action is answered as a
   refusal the screen shows ("Taking over", below); anything else, 503.

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

### Cookies

The server code keeps a few things in cookies (the theme, reveal, incognito,
the sign-in ceremony, a TV's pairing) and reads them from a request's
`Cookie` header. A browser forbids script both ways: a `Request` made in
script drops a `Cookie` header, and a `Response` made in script drops
`Set-Cookie`, silently. Every request and response of the in-tab server is
made in script, so until 2026-11-26 the server never saw a cookie and none it
set was kept (c1131: the theme could not be switched).

**The browser's own jar stays the jar** (`web/cookies.js`):

- The leading tab reads `document.cookie` as it hands each request to its
  server worker, which gives SvelteKit a request whose headers carry it (a
  standalone `Headers` has no such guard, so the request's are replaced).
- In the server worker, `Headers` and `Response` are taught to remember every
  `Set-Cookie` written to them, kept by the browser or not; the worker sends
  them to the tab with the answer, and the tab writes each into
  `document.cookie` before passing the answer on, so the next request carries
  it.
- `HttpOnly` is dropped on the way in: script cannot set it, and with no
  network server there is nothing for it to keep the cookie from. Everything
  else (path, max-age, SameSite, Secure) stays.

Every server route is unchanged, the cookies are shared by every tab of the
site, and clearing the site's data clears them with the library.

**The theme on the page** follows `data.theme` in the layout, not only the
page the server rendered: `/light` and `/dark` post with `use:enhance` (c1116),
which keeps the page, and the web edition renders no page on a server. In
the self-hosted app this also fixed `/light` showing only after a reload.

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

| Output (`build-web/`)             | What                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `index.html`                      | SvelteKit's SPA shell, its start held until `boot.js` calls it, and the starting screen |
| `_app/`                           | the client, exactly as the self-hosted build has it                                     |
| `service-worker.js`               | the app's own service worker, built with `__WEB_EDITION__`                              |
| `boot.js`                         | starts a tab: the service worker, the lead, the server                                  |
| `server/worker.js` and its chunks | SvelteKit's `Server` and all server code, bundled and minified                          |
| `server/files.json`               | the shell, `boot.js` and the server's files, for the offline copy                       |

`yarn run serve:web` serves it locally at `http://localhost:42160/` (port 42160
is the web edition's on the workstation).

The web build differs from the self-hosted one in `vite.config.ts` only, never
by `if (web)` in a screen:

- **`__WEB_EDITION__`**, a build-time constant. It is the literal `false` in
  the self-hosted build and in the specs (`vitest.config.ts`), so no
  environment variable on a server can switch the web edition's rules on.
- **No sign-in.** `src/lib/server/auth.ts` lets every request in when
  `__WEB_EDITION__`: the tab is its own only client. It ignores
  `TSUNDOKU_TOKEN` and `TSUNDOKU_LOGIN` too, because the build renders its
  fallback page with the build machine's environment, `.env` included: a
  developer's token made that render a redirect to `/login` and failed the
  build. The browsers workflow's `web` job builds with both set to hold it.
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
- **`node:crypto` → `web/crypto.js`** (the "Crypto" the code reads). The
  server code hashes inline and synchronously (an extension's handle, a
  file's fingerprint, a cache key), and a browser's WebCrypto is
  asynchronous, so `createHash` and `createHmac` are @noble/hashes' (audited,
  MIT, synchronous; SHA-1, the SHA-2 family, MD5), and `randomBytes`,
  `randomInt` and `randomUUID` the browser's own randomness;
  `timingSafeEqual` compares in constant time. `tests/web/crypto.spec.ts`
  holds every hash to Node's own output. Signatures are not here: the one
  check that verifies one (an extension's APK) uses WebCrypto in both
  editions ("Installing an extension").
- **`undici` → `web/undici.js`.** The browser has `fetch`. tsundoku takes only
  undici's `Agent`, which `net-guard.ts` gives fetch so a server cannot be
  steered at private addresses; in a tab the "server" is the reader's own
  browser, whose own rules govern that, and its fetch ignores the agent.
- **`node:net` → `web/net.js`**, the pure calls only (`isIP`, `isIPv4`,
  `isIPv6`), held to Node's own answers in `tests/web-edition.spec.ts`; every
  other name stays a stub. `net-guard.ts`'s `checkPublic` asks `isIP`, then
  resolves a name with `node:dns`, which a tab does not have: in the web
  edition it still refuses an address written as a private one and a
  `localhost` name, and leaves every other name to the browser. Installing
  from a real repository failed on this until 2026-11-26. What the fetcher may
  reach on the reader's own network is c1140.
- **`sharp` → `web/sharp.js`.** Native code cannot load in a tab. The one
  chain the thumbnails use (`rotate().resize().webp().toBuffer()`: a browse
  cover, a page thumbnail, an episode still) is drawn with `createImageBitmap`
  and `OffscreenCanvas` in the server worker; its cut and size are a pure
  `plan()`, held to real sharp's output in `tests/web-edition.spec.ts`. Any
  other call (stats, raw pixels for duplicates, metadata) says it is not in
  the web edition yet; the settings calls are accepted.
- **`process`, `Buffer` and timers → `web/process.js`**, set before any server
  code loads. The environment names the database (`/tsundoku.sqlite`, in
  OPFS). Timers get Node's `unref()`, which the background jobs call.
- **`node:buffer` → `web/buffer.js`**: the `buffer` package (v6, for the
  BigInt reads an APK's signing block needs), taught `base64url`, which it
  lacks and the server code uses for ids, tokens and MACs (a source's browse
  page failed with "Unknown encoding: base64url"). Checked against Node's own
  in `tests/web-edition.spec.ts`.
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

## Files

The server code writes files as it does on a computer (an installed
extension's APK, a backup), mostly with the `*Sync` calls, so the web
edition's `node:fs` has to be synchronous. It is (`web/fs-store.js`): files
and directories are rows of a second SQLite database, `/tsundoku-files.sqlite`,
on the same `opfs-sahpool` VFS as the library, which is synchronous in the
server worker. The pool keeps ten files ready (each database is two: itself
and its journal).

- **The calls the server code makes**: `existsSync`, `mkdirSync`,
  `writeFileSync`, `appendFileSync`, `readFileSync`, `renameSync`, `rmSync`,
  `rmdirSync`, `unlinkSync`, `readdirSync` (with file types), `statSync`,
  `lstatSync`, `copyFileSync`, `cpSync`, `statfsSync`, and the same as
  promises from `node:fs/promises` (`stat`, `readFile`, `readdir`, `mkdir`,
  `writeFile`, `rm`, `rename`, `unlink`, `cp`, `access`, …).
- **Node's semantics, held call by call**: `tests/web/fs.spec.ts` runs each
  story (the APK's write-then-rename, a folder renamed onto an empty one, `rm`
  of a folder without `recursive`, …) on a real folder and on the stand-in,
  and expects the same answers and the same error codes (`ENOENT`, `EEXIST`,
  `ENOTDIR`, `EISDIR`, `ENOTEMPTY`, `ERR_FS_EISDIR`).
- **Everything else still throws**, naming the call: the stand-in plugin
  (`web/node-stubs.js`) takes every name `web/fs.js` and `web/fs-promises.js`
  export as the real call and stubs the rest of the module.
- **Room on the disk** is the browser's to refuse, at the write: a site's
  quota is known only asynchronously, so `statfsSync` answers plenty.
- Clearing the site's data clears the files with the library.

## Other sites

Server code fetches other sites as it does on a computer: a repository's
index, an extension, a catalogue's API. In a browser that fetch is held to
the cross-site rules, which most sites refuse, and carries none of the site's
cookies. So the server worker's `fetch` (`web/site-fetch.js`) sends:

- **this origin** (the app's own files) to the browser's fetch;
- **the engine's origin** to the engine (below);
- **any other site** to the leading tab, which sends it through the fetcher
  extension with the browser's cookies, in the engine's text frame;
- and, when the tab has **no fetcher**, to the browser's own fetch after all:
  a site that allows cross-site reads (a repository's index on GitHub's raw
  files does) still answers, and one that does not fails as a network error,
  as a computer with no network would.

The tab keeps one connection to the fetcher for the engine and these
requests together (`fetcherConnection`); a missing fetcher is remembered
until the tab is focused again, so a screen of site requests does not wait
for the fetcher's hello once per request.

## Installing an extension

The same screens and the same server code as the self-hosted app (BROWSE →
EXTENSIONS, `src/lib/server/engine/extensions.ts`, doc/BROWSE.md), with
nothing of the machine's left in the path:

1. The repository's `repo.json` and index, and then the APK, are fetched by
   the server through the fetcher ("Other sites"). **No repository ships with
   the web edition** and none is suggested: the visitor adds their own.
2. The APK's signature is checked exactly as the self-hosted app checks it,
   both halves (APK Signature Scheme v2 over the APK's bytes, and the signer's
   certificate against the repository's key), with WebCrypto, which Node and
   browsers share (`apk-signature.ts`). A DSA signature, which WebCrypto lacks
   and no repository checked uses, is refused in the browser.
3. The APK is kept in the files database ("Files"), written beside and renamed
   as on a computer.
4. The engine in the tab loads it: dex2jar converts it inside CheerpJ, once,
   and keeps the converted jar under `/files/engine` (tsundoku-engine, "The
   browser target").

The extension's prebuilt `.jar` that some indexes list beside the APK would
skip the conversion (15-27 s per extension in Chromium, once), but the APK is
what is signed, and the jar is not: it is not used.

`web/tests/install.e2e.ts` runs the whole of it in Chromium with the real
engine and the development fetcher, against a local repository listing a
real extension signed by Keiyoushi's key: add the repository, install,
reload, still installed.

## The engine

The extension engine (tsundoku-engine, doc/EXTENSION-ENGINE.md) runs in the
leading tab, in CheerpJ, a JVM compiled to WebAssembly, in a **dedicated
worker** of its own, so its start-up and its calls never hold the page's main
thread. Measured on 2026-11-25 with the spike's jars: CheerpJ 5.0 starts in a
worker in Chromium and Firefox (the runtime in about 1 s, the library in about
6 s), and a call from JavaScript into Java works there as in a page.

```
server worker: the engine client, unchanged
  │  fetch(ENGINE_URL + "/dalvik") — ENGINE_URL is http://engine.tsundoku.invalid
  ▼
web/engine-port.js: that origin's fetch goes over a MessagePort
  ▼
engine worker (web/engine-worker.js): BrowserEngine.handle(head, body)
  │  tsundoku-engine's own routing, no socket
  ▼  a source's request: BrowserTransport.fetchNative(head, body)
the leading tab (web/engine-start.js) → the fetcher extension → the site
```

- **One call into Java at a time.** CheerpJ refuses a call from JavaScript
  into Java while another is running ("Java code still running, check for a
  missing 'await'"), and a browse grid asks for its 32 covers at once. So
  `web/engine-queue.js` runs the calls one by one, a page's call (a list, a
  series, a chapter) before any waiting cover or video slice, and answers a
  call that throws with `ERR`, never stalling the rest. The cost is that the
  engine works one request at a time; doing several at once needs the engine
  to run them on Java threads of its own (c1139).
- **No second client.** The server code's engine client
  (`src/lib/server/engine/client.ts`) talks to `ENGINE_URL` as it always does.
  In the web edition that names an origin that exists nowhere, and the server
  worker's `fetch` sends that origin over a port to the engine's worker
  (`web/engine-port.js`); every other fetch is the browser's own.
- **One frame, both ways** (`web/engine-frame.js`): a request is
  `METHOD\nURL\nName: value…` plus a base64 body; an answer is
  `STATUS\nName: value…\n\nBASE64`, or `ERR <message>`. Text, because a
  string is what crosses CheerpJ's boundary cheaply and exactly. The app's
  calls into the engine and the engine's calls out to a site use the same
  frame, so tsundoku-engine's browser side is one encoder and one decoder.
- **The engine's state.** `off` (no engine jar in this build, or no fetcher),
  `starting`, `ready`, or `failed`. Off and failed fail a call at once, as an
  engine that is down does for the self-hosted app, so its screens say what
  they already say; starting holds a call (up to two minutes) until the engine
  is ready, so a source's page fills in rather than failing in the first
  seconds. `<html data-web-engine>` carries the state.
- **When it starts.** The leading tab starts it once its server is up and a
  fetcher answers (the owner's choice, 2026-11-25: without a fetcher it could
  reach no site). A tab without one tries again when it is focused, so a fetcher
  installed meanwhile is noticed with no reload. A tab taking over the server
  starts its own engine.
- **Its jar.** `build:web` copies tsundoku-engine's slim browser jar from
  `TSUNDOKU_ENGINE_JAR` to `build-web/engine/engine-browser.jar`; without it
  the build has no engine, says so, and the library works without sources.
  CheerpJ reads a jar by byte ranges, which the browser's HTTP cache does not
  keep, so the service worker keeps the jar whole (with the shell's copy, so a
  new build brings a new jar) and cuts each range from it. A missing jar is
  never kept: a static host may answer it with the app's page.
- **CheerpJ** is loaded from its CDN (`cjrtnc.leaningtech.com/5.0`), as its
  free licence for a one-person company requires, together with a visible
  "Built with CheerpJ" credit.
- **What the app adds to the contract** (tsundoku-engine's `doc/FORK.md`,
  "The browser target"):
  - **An extension's JavaScript runs in the browser.** Some extensions run a
    site's scripts through QuickJS, which is far too slow in CheerpJ (about
    20 s to create; one page script did not finish in ten minutes). The
    engine's browser target sends each script to
    `BrowserScripts.evaluateNative` instead, and the engine's worker runs it
    in a worker made from a `data:` URL (`web/script-sandbox.js`): an opaque
    origin, with none of the app's storage, cookies or fetcher, since the
    script is the site's code. One at a time, 30 s each, a script past the
    limit losing its worker. That page list then takes 2.5 s (3.3 s on the
    desktop engine).
  - **A fetch's final URL**: the relay adds `X-Tsundoku-Final-Url` when a
    redirect moved a fetch, and the engine shows OkHttp the redirect it would
    have followed itself.
  - **No FlareSolverr**: `cf-proxy-url` is dropped on the way to the engine
    (`engineHeaders` in `web/engine-port.js`): a site's check is the visitor's
    to pass in a tab of their own.
  - **Bounded video**: the engine answers a call whole, in memory, so a
    `/video/` call always asks for at most 8 MB; a player asks again for the
    rest.
- **Its storage.** CheerpJ's `/files/` is persistent (IndexedDB): the engine's
  data folder is `/files/engine`, so an extension converted once stays
  converted.

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

- **File streams.** `createReadStream` and `open` still throw: they serve
  downloaded files, which arrive with downloading in the browser.
- **Images.** `sharp`'s work (thumbnails, duplicate hashes) moves to
  `createImageBitmap` and `OffscreenCanvas` in a worker.
- **Processes.** `child_process` (ffmpeg, OCR, starting the engine) has no
  browser equivalent; the engine runs in the tab, and the rest are later
  decisions.
- **Background jobs** started by `init` in `hooks.server.ts` (the relations and
  TMDB fills) run in the tab and need the network above.
- **No server-rendered HTML.** Every page is the shell, then its data. Layout
  is CSS media queries, so the first paint is still right for the device.

## Measuring

Where the web edition's time goes is measured, not guessed (c1134). An opt-in
log, `web/timing.js`, is off unless the browser's `localStorage` has
`tsundoku-timing` set to `"1"`; it then keeps, in the leading tab, as
`window.__tsundokuTimings`:

| kind      | what                                              | from                  |
| --------- | ------------------------------------------------- | --------------------- |
| `request` | an app request, service worker to server and back | `web/boot.js`         |
| `call`    | a call into the engine: time queued, time in Java | `web/engine-queue.js` |
| `site`    | one of the engine's fetches through the fetcher   | `web/engine-start.js` |

Paths only, never a query (a search or a token can be private), and nothing
leaves the browser. To take one by hand, in the console:

```js
localStorage.setItem('tsundoku-timing', '1');
location.reload();
// … browse, open, read …
copy(JSON.stringify(__tsundokuTimings));
```

**What it found on 2026-11-26** (Chromium and Firefox, a warm visit, Weeb
Central; the whole write-up is on c1134):

- Java in CheerpJ is the floor: about 5 s for every page of a site an
  extension parses (a POPULAR page, a series and its chapter list), the same
  in both browsers. Covers are cheap (about 100–200 ms each through the
  engine). The engine starts again on every visit, about 8 s after the app.
- READ from a source took minutes on a long series (3.5 min for 1,199
  chapters): `rememberAtSource` wrote each chapter in its own commit, and in
  the tab every commit is a write to OPFS (about 30 ms each). One transaction
  made it 0.17 s, and READ to the first page 7.8 s. Other loops that write
  outside a transaction cost the same way; see c1134.

## Starting, and when it cannot

What a tab shows from the first byte until the app opens, and in place of the
app when it cannot start (handoff `web-edition-start`, its Start-, Fail- and
Takeover boards; built in card c1128). The pieces:

- **`web/start.js`**: the screen's markup and CSS, the two scripts the shell
  runs before its first paint, and the rules (where a start is, what a
  failure was). The adapter puts the screen into `index.html`
  (`paintTheStart`, after `holdTheStart`); `boot.js` imports the rest, and
  the build bundles it into `boot.js`.
- **`web/boot.js`** moves the screen on as each step really finishes, draws a
  failure in its place, and takes it away once the app has drawn.
- **`web/worker.js`** says when the server's code has loaded and when the
  library is open, and what it lacks if it cannot open it.

The screen is plain HTML and CSS: none of the app's code has loaded when it
is painted. It reads the app's own tokens, which are there before the first
paint because the shell links the app's stylesheets, and it draws the
library's own frame, so the app opens over it with nothing moving: the
desktop's sidebar and its wordmark at 17px, or the top bar's left cell with
the wordmark (no 積ん読 on a phone, as the library), the header's height
(`--header-h`), the section label, and the header's rule exactly as
`NavLine` draws it. No spinner.

### The starting screen

**The theme is set before anything is drawn.** The shell's first script
(`themeBeforePaint`) reads the app's own record of it, `tsundoku.theme` in
localStorage, else the `tsundoku_theme` cookie, and sets `data-theme` on
`<html>`.

**The rule fills one step at a time**, a quarter for each, as each really
finishes. It is never animated or guessed:

| Step                   | Finished when                                                         | Told by                                    |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| 01 GETTING READY       | the service worker is active (before the first visit's reload)        | `boot.js`                                  |
| 02 STARTING            | the server worker's code has loaded (its module runs at all)          | the server worker, `tsundoku-step` server  |
| 03 OPENING THE LIBRARY | SQLite has loaded and its OPFS pool is open                           | the server worker, `tsundoku-step` library |
| 04 SETTING IT UP       | the server has started, which on a first visit climbs every migration | the server worker, `tsundoku-ready`        |

A tab that does not lead (another tab's server answers it) has nothing more
of its own to start once step 1 is done, and fills the rule at once.

**A later visit** shows only the bar and `00 — STARTING · OPENING THE
LIBRARY`, whatever the step; it is over in a second or two.

**A first visit** is one where the library has never opened in this browser:
`tsundoku.web.opened` in localStorage, set when the app opens, is missing.
It lives beside the library's storage, so clearing the site's data clears
both and the next visit is a first visit again. A first visit:

- says `00 — FIRST VISIT` from the first paint, with the step under way on
  the right (`GETTING READY`);
- after 1.5 s adds "A library that lives in this browser.", the line under
  it, and the four steps, each marked DONE, NOW or not yet, and the right
  side becomes `2 OF 4 · STARTING`. A start that ends sooner never shows them;
- **carries the same picture over its reload.** The step reached and when the
  start began are kept in sessionStorage (`tsundoku.web.start`); the shell's
  second script (`startView` and `drawStart`, inlined after the screen's
  markup) draws from them before the page after the reload is painted, so the
  rule, the label and the steps are where they were, and the 1.5 s counts
  from the first page. The reload is not a step. There is not always one:
  the service worker claims the tab when it activates, and when that happens
  before `boot.js` looks, the tab is already controlled.

The session record is dropped when the app opens or a start fails, so a later
reload starts afresh.

**The app opens in place.** The screen is a fixed layer over the page, and
the app mounts under it as before (its client's start is held until
`boot.js` calls it). Once the app has drawn its first screen, `boot.js`
removes the layer in the next frame, so the first frame without it is the
app's. The test checks that the wordmark is where the screen had it, on a
desktop and on a phone. An error before the app draws anything is a failure
to start, shown like any other.

`data-web-boot` on `<html>` keeps its values (`registering`, `reloading`,
`starting the server`, `ready`, `failed`), which the browser tests wait on.
The screen itself, `#web-start`, carries `data-step` (steps done),
`data-first`, `data-revealed` and, once a start fails, `data-failed` (the
kind).

### Could not start

One screen per reason, drawn in place of the starting line under the same
bar, with no rule (nothing is under way): what happened, what to do, one
primary action, one way to read more (the sections below), and the reason in
mono at the foot. `classify` in `web/start.js` tells them apart from what
actually failed:

| Reason             | Told by                                                                                                                                                                          | Foot                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A private window   | Firefox with no `navigator.serviceWorker`                                                                                                                                        | `FIREFOX · PRIVATE WINDOW · NO SERVICE WORKERS` |
| Storage turned off | a `SecurityError` or `NotAllowedError` from OPFS (`navigator.storage.getDirectory()`, tried first), from registering the service worker, or from the server worker's SQLite pool | `SITE DATA BLOCKED`                             |
| A browser too old  | a part missing, found before starting (service workers outside Firefox, module workers, Web Locks, OPFS) or by the server worker (synchronous file access)                       | `MISSING · ` and each part                      |
| Something else     | anything else                                                                                                                                                                    | `NOTHING IN THE LIBRARY WAS CHANGED`            |

The server worker posts the error's name and what it lacks beside its text,
so a refusal inside it is told apart as well as one in the page. The last
screen carries the error's text, selectable, under WHAT IT SAID with COPY:
where the start was (`At: starting the server`), the error as the browser
printed it, and the browser, its system and the build (`Firefox 133 · Linux ·
tsundoku 2026.11.25`). TRY AGAIN reloads the page.

The sections below are where each screen's second button leads, so they are
written for the person reading that screen.

#### A private window

Firefox turns off service workers in a private window, and tsundoku cannot
run without one: the app's server runs in the tab, and the service worker is
how the page reaches it. A private window would also throw the library away
when it closes. Open the same address in a normal window; COPY THE ADDRESS
puts it on the clipboard.

#### Storage turned off

tsundoku keeps the library in this browser's storage for the site, and the
browser refused it: site data is blocked, for this site or for every site.
The setting is in the browser's site settings for this address (the icon at
the left of the address bar), or in its settings for cookies and site data:
in Firefox, Settings › Privacy & Security › Cookies and Site Data › Manage
Exceptions. Allow the site to keep data, then TRY AGAIN.

#### A browser too old

tsundoku runs inside the browser and needs these parts of it: service
workers, module workers (`new Worker(url, { type: 'module' })`), Web Locks,
the origin private file system (OPFS) and its synchronous file access from a
worker. The screen names the ones missing. Any current Chrome, Edge or
Firefox has them all.

#### Something else

Anything that is none of the above. Trying again usually works. If it keeps
happening, COPY the text under WHAT IT SAID and send it with a report: it
says where the start stopped, what the browser said, and which browser and
build it was.

### A private window in Chrome: not built, waiting on the owner

Chrome's incognito runs the web edition, and throws the library away when the
window closes. The card asked for a standing band saying so, told apart by the
storage quota, the one known signal (Chrome offers no incognito flag): an
incognito window's storage was kept in memory with a quota of a few hundred
MB at most, a normal window's a share of the disk. **The signal is gone, so
the band is not built:** a band current Chrome never shows would be dead code
that looks like a feature. What to do instead (no band, or a line said to
every Chrome visitor somewhere) is the owner's decision, on the card.

Measured on the workstation on 2026-11-25 with Playwright, on a page served
over `http://localhost`, `navigator.storage.estimate()`:

| Browser                                       | Window                                                  | Quota reported          |
| --------------------------------------------- | ------------------------------------------------------- | ----------------------- |
| Chrome 153.0.8010.36 (`google-chrome-stable`) | Playwright's `newContext()` (an off-the-record profile) | 10,737,418,240 (10 GiB) |
| Chrome 153.0.8010.36                          | a persistent profile (`launchPersistentContext`)        | 10 GiB                  |
| Chrome 153.0.8010.36                          | started by hand with `--incognito`, read over CDP       | 10 GiB                  |
| Chromium (Playwright's), headless and headed  | the same three                                          | 10 GiB                  |
| Firefox (Playwright's)                        | `newContext()` / a persistent profile                   | 3,365 MB / 10 GiB       |

`webkitTemporaryStorage.queryUsageAndQuota` answers the same, and writing
1 MB to OPFS raised the quota by the same 1 MB in both windows: Chrome 153
reports the usage plus a fixed 10 GiB to every site, normal or incognito,
precisely so that incognito cannot be told apart this way. Edge is not
installed on the workstation and was not measured. Firefox needs no band: its
private windows cannot start at all ("A private window", above).

### Taking over

When the leading tab closes with a write in hand, the write is lost with its
server ("One tab leads", above). The relay answers a lost form action
(`use:enhance`'s POST, marked `x-sveltekit-action`) as SvelteKit's own
refusal, an ActionResult of type `failure`, status 503, whose data is
`{ lost: 'takeover', action }` (`src/lib/web/takeover.ts`). `use:enhance`
then keeps the screen and puts the answer in `page.form`, as for any refused
action.

The layout draws it, since it can come from any screen: the system's band
(`Band`), `NOTHING CHANGED · NEW SHELF` (the action's name in words) over
`THE TAB RUNNING TSUNDOKU CLOSED AS IT WAS SENT · THIS TAB RUNS IT NOW`,
with TRY AGAIN and ✕. It lives in the form answer, like the screens' own
refusals: ✕ remembers that answer, and the next answer is a new band. TRY
AGAIN submits the same form again, with the same button, from the tab that
took over; the layout keeps the last form sent for each action's name, and
offers TRY AGAIN only while that form is still on the screen.

Anything else that was lost (a screen's data, an endpoint) is still answered
503 with "the tab that ran the server closed; try again".

### Where it departs from the handoff

| Where                              | Departs because                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Padding on a desktop               | The handoff's desktop board pads the label and the content 32px; the screen uses `--pad` (24px), which is what the library under it uses, so the app opens without the label moving.                    |
| The top bar's left cell on a phone | The handoff pads it 24px and shows 積ん読; the library pads it `--pad` (16px) and hides 積ん読 on a phone, and the screen does what the library does, so the wordmark does not move when the app opens. |
| Where the band sits                | The handoff draws the takeover band under the screen's bar. A takeover can come from any screen, so the layout draws it, and the layout's bands sit above the screen's bar (where incognito's is).      |
| The action's name                  | "NEW SHELF" is the form action's own name in words (`newShelf`), not a label written for it, and stays English in the Portuguese app.                                                                   |
| The site's name                    | The handoff writes tsundoku.lt; the screens say the address they are on (`location.host`).                                                                                                              |
| COPY and COPY THE ADDRESS          | Say COPIED for 2 s after copying; the handoff draws no answer.                                                                                                                                          |
| "Read more" buttons                | The handoff gives them no destination; they open the sections of this document above, in the public repository.                                                                                         |
| The unknown failure's error line   | The handoff's `Error: [TEXT]`; the error is printed as the browser prints it, its name first (`TypeError: …`), so a server worker's `Error: …` is not doubled.                                          |
| A failure's title on a desktop     | Not drawn; the tablet's 28px.                                                                                                                                                                           |
| Wide layouts                       | The handoff's landscape board (text beside the steps, 48px apart, steps 460px) applies from 1024px wide; its desktop board (56px, 440px) where the app has its desktop layout (a fine pointer as well). |

### What it does not do yet

- **The screens are in English only.** They are drawn before any of the app
  has loaded, including its language; the app's own takeover band is
  translated.
- **A first visit's first paint can change font.** Plex Mono is not cached
  before the first visit, so the screen's text may be drawn in the fallback
  face for a moment (the positions hold; the widths change). Preloading the
  mono face from the shell would avoid it.
- **A lost read is an error page.** Only form actions get the refusal band.
- **A screen that handles its form's result itself** without calling
  `update()` never puts the lost answer in `page.form`, so it shows no band.
- **TRY AGAIN needs the form still on screen.** A write sent from a sheet that
  has since closed gets the band with ✕ only.
- **No private-window band in Chrome** (above): waiting on the owner.
- **The TV's bar** has a safe top margin the starting screen does not draw.
- `web/boot.js` is not type-checked (no spec imports it, since importing it
  starts a tab); `web/start.js` is, through its spec.
- **Seen while testing, not this screen's:** the library's GET STARTED poll
  (`invalidate` every 5 s) can land while a form's redirect is still loading
  on a busy machine and take the page back to the address it was on. The
  write is done; only the address is wrong.

## Testing

- `tests/web-edition.spec.ts`, in the unit suite: the SQLite stand-in against
  better-sqlite3 (and opening the pool again after a takeover), the path
  module against Node's, the stand-in plugin, the shell's held start.
- `tests/web/relay.spec.ts`, in the unit suite: the relay's half in the
  service worker, with fake windows: a request reaching the leader, waiting
  for one, finding one after the worker forgot, and a takeover's lost requests.
- `tests/web/start.spec.ts`, in the unit suite: the starting screen's
  rules (`web/start.js`): where a start is and what it carries over a
  reload, what the screen says at each step (drawn on stand-in elements,
  from the function's own text as the shell inlines it), what each failure
  was, the could-not-start screens' words, the shell's painting. `tests/web/takeover.spec.ts`: a lost write's answer, and
  the band's words for it.
- **`yarn run test:web`**: the web build in Chromium and Firefox
  (`playwright.web.config.ts`, specs in `web/tests/`). It builds `build-web/`
  (under the same build lock as the main suite's build), serves it on 4185,
  and opens it as a first visit in each test: the empty library from the
  in-tab server, a write through a real form kept across a reload, a second
  tab using the first one's server and taking over when it closes, and static
  files passing the server by. `web/tests/start.e2e.ts` opens the web edition
  as "Starting, and when it cannot" describes: the steps' marks and the rule,
  FIRST VISIT and its reload, a later visit, the app opening without its
  wordmark moving (desktop and phone), the screen's measurements, each
  failure it can force (no service workers, no Web Locks, storage refused by
  the page or by the server worker's pool, a missing part found by the
  server worker, anything else), and a write lost
  in a takeover. doc/TESTING.md, "The web edition".
