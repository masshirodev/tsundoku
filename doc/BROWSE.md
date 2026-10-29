# Browsing sources

BROWSE is where a series is found without knowing its title: a source's
popular and latest lists, its own filters, and a search inside it. It's built
on tsundoku's own extension engine ([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md),
[`DOWNLOADER.md`](DOWNLOADER.md)), not Suwayomi, and it's the reason the owner
opened Suwayomi's web UI at all.

Designed in the handoff `Index-Browse.dc.html`, `Index-Extensions.dc.html`,
`R1`–`R8` and `Browse Calls.dc.html` ([`design/README.md`](design/README.md)),
from the brief [`briefs/BROWSE.md`](briefs/BROWSE.md). Card c126 ("Browse,
extensions and repos screens") on the Tsundoku board, split into six parts:

| Part                                                              | Card | State |
| ----------------------------------------------------------------- | ---- | ----- |
| The engine says what each filter is                               | c140 | Done  |
| A source's page: popular, latest, filters, search in it           | c141 | Done  |
| BROWSE itself: choosing a source, RECENT, where it's reached from | c142 | Done  |
| A site's browser check named at once; not answering               | c143 | Done  |
| Extensions and repositories                                       | c144 | Done  |
| A source's settings                                               | c145 | Done  |

## BROWSE

`/browse`. The bar is ← (the library), BROWSE, a hint that opens SEARCH THE
SOURCES ("/ search every source"), and EXTENSIONS over its count of updates
waiting (MANAGE when there are none), as QUEUE counts chapters. Then the
sources, one list with the kinds as sections: **01 — RECENT** (the last four
browsed, any kind, "MANGA · EN · BROWSED 2 H AGO"; nothing to pin or
manage), then **MANGA**, **ANIME** and **NOVELS**, a section only where it has
a source. Read from tsundoku's own tables, so it draws while the engine is
down.

**Which sources.** Those in the owner's languages (the `browse_languages`
setting, `en,ja` by default; its SETTINGS row comes with c144), an
extension's `all`/`multi` sources, and any other the library reads from (a
series from MangaDex's French source keeps that one listed). Listing every
language would be forty-odd rows of MangaDex. Where an extension has more
than one source listed, each says its language: "MangaDex · EN".

**A row** is the extension's icon, the source's name and a line: its language
and how many series the library has from it, as reveal lets you see them
("41 SERIES HERE"; inside reveal, "126 SERIES HERE, 112 HIDDEN"). A source the
engine refused is c94's failed row (a 3px ink rule on the left, the reason in
a word, "FAILED TO LOAD · PROTOBUF · TRY AGAIN IN EXTENSIONS") and leads to
EXTENSIONS rather than to a page that can't answer. A mostly-hidden source is
only listed inside reveal, with HIDDEN on its icon.

**Icons** come through `/api/browse/icon/<package>`: the server fetches the
repository's icon once, keeps it beside the APKs as an 80px WebP
(`<ENGINE_STORE>/icons`), and serves it from then on, so the viewer's browser
never asks the repository's host, and a repository that dies keeps its
icons. An extension whose every source is mostly hidden answers 404 outside
reveal.

**RECENT** is rung 42's `browse_recent`, a row a source, moved to now on each
visit to its page; a visit in incognito leaves nothing. Who may see a row is
decided when it's read, so a hidden source browsed inside reveal is only in
RECENT inside reveal.

**The ways in** (Browse Calls, "Browse is a place"): a BROWSE cell on the
library's tablet bar, before QUEUE; BROWSE in the desktop sidebar's foot,
under HISTORY, with the update count ("5 ↑"); and on the phone, whose bar has
no room, the empty search offers it first: BROWSE A SOURCE with the last
three, then ALL SOURCES · BROWSE with the number of sources.

## A source's page

`/browse/<source id>`. The bar is ← (BROWSE), the source's name and kind, a
field that searches this source with its filters, and SETTINGS. Under it,
POPULAR, LATEST (only where the source has it: `supportLatestManga`) and,
once filters are applied or a search is typed, FILTERED (SEARCH for a
search), with FILTER pinned at the right end, counting the choices that
differ from the source's own. Then the library's grid: six columns on the
tablet, three on the phone.

**The URL is the page.** `tab` (popular, latest, filtered), `pages` (how many
are loaded), `q` (a search in this source, answered as a filtered list), the
panel's choices as `f*` keys, and `panel=1` / `find=1` for the two things
script would otherwise toggle. So back, a reload and a shared link all land
where they were.

**It scrolls on.** As MORE ↓ comes within a screen of view, the next page is
asked for and added, and the URL's `pages` moves with it (a replaced history
entry, so back leaves the list rather than stepping through its pages).
MORE ↓ is a link to `?pages=N+1`, which renders pages 1 to N+1: the way on
without script, and what back returns to. The label counts what's loaded
("48 SO FAR"), never a total the source doesn't give, and says "MORE AS YOU
SCROLL" only once script runs. Twenty pages at most. **One page at a time**:
while one is asked for, MORE ↓ is dimmed and a click on it does nothing, since
every extra click only queued more calls at the source (reported 2026-10-29).

**A preview loads on tap, not hover.** A preview asks the source for details
and episodes, one call at a time per extension, and the app preloads links
on hover: twenty tiles passed over queued forty calls ahead of the one
opened, which then sat on ASKING THE SOURCE… for 43 s, and stalled MORE
behind them. Tiles and search results set `data-sveltekit-preload-data="tap"`.

**A tile** is the library's (cover, title, a meta line). IN LIBRARY is the
accent badge in the cover's top-right corner, and a tap opens the series;
HIDDEN, top-left, only ever inside reveal. A twin from another source is the
meta line in ink, `SAME TITLE · FROM ASURA SCANS`, and only of the same kind of
source (`libraryIndex`'s `sameTitle`): a manga matches manga, a novel novels,
an anime anime, since an adaptation under the same name isn't a copy from
elsewhere (reported 2026-10-29: "Oshi no Ko" on KickAssAnime read SAME TITLE ·
FROM WEEB CENTRAL). Anything else opens c94's
preview (`/downloads/source/<manga>?from=<this page>`), whose back cell then
says BROWSE and returns here.

### Filters

The engine describes a source's filters as a typed list (`filterSchemaManga`,
the fork's, c140; [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md), "API
reference"). `src/lib/library/browse-filters.ts` is the whole of the logic,
pure and tested over five real sources' schemas
(`tests/fixtures/filters/`): it cleans the schema (anything malformed is
dropped rather than drawn wrong), reads the panel's choices from the URL,
writes them back, counts what differs, and turns them into the `filterList`
getSearchManga reads.

| Type      | Drawn as                                                    | In the URL                    |
| --------- | ----------------------------------------------------------- | ----------------------------- |
| select    | cells, the chosen one inverted                              | `f<i>=<index>`                |
| sort      | cells plus ↓ ↑                                              | `f<i>=<index>`, `f<i>.o=a\|d` |
| checkbox  | a ✓ box in a cell                                           | `f<i>=1` when on              |
| tri-state | a chip: `+` in accent includes, `−` struck through excludes | `f<i>.<j>=0\|1\|2`            |
| text      | a field                                                     | `f<i>=<text>`                 |
| group     | the row's label; its children as above                      | the children's keys           |
| header    | a sub-label                                                 | none                          |
| separator | a rule                                                      | none                          |

**Filters wait for APPLY** (unlike the library's, which apply as they're
touched: here every change would ask the site again). The panel is a GET
form; its count of choices updates as they change; APPLY lands on FILTERED.
RESET is a link to the source's own choices, CANCEL closes the panel.

On the FILTERED tab the URL is the whole form, so a checkbox it doesn't name
is off (an unticked box sends nothing), and anything else it doesn't name
keeps the source's default. Selects, sorts and checkboxes are radio and
check inputs drawn as cells through `:has(:checked)`, so they work without
script; a tri-state is three radio cells (· + −) without script and one chip
that cycles with it. With more than thirty tags, a TAGS row finds among them
(script only).

### Waiting, and without script

Everything the source has to answer comes as one streamed promise (a
`Settled`, which never rejects, `src/lib/library/settled.ts`), so the bar and
tabs draw at once and a slow site fills in after, over the Loading States
grid outline.

**Streamed data needs script,** in SvelteKit's own words ("Streaming data will
only work when JavaScript is enabled"), and Svelte's server render draws an
`{#await}`'s pending branch even for a promise already settled. So the app
sets a `tsundoku_js` cookie once its script runs (`routes/+layout.svelte`;
`SCRIPT_COOKIE` in `server/prefs.ts`), and a request without it gets its
answer awaited on the server and handed over as a value: the page arrives
complete, only later. A first visit with script waits once, the same way.

### What it costs the site

`src/lib/server/engine/browse.ts` asks a source one page at a time and keeps
each answer fifteen minutes (three hundred at most), keyed by the source, its
settings (a setting can change what a source lists) and the question. So
MORE asks only for the new page, and back or a reload asks for nothing. A
failure isn't kept.

Covers come through `/api/downloads/engine-image`, which now sends the
library's 400px WebP thumbnail rather than the source's bytes: MangaDex's
default sends its original scans, up to 2.8 MB a cover (measured
2026-10-28), and a page of the grid asks for twenty.

### Hidden means hidden

A source whose series here are mostly hidden ([`PRIVACY.md`](PRIVACY.md);
Toonily, Toonily.me and Omega Scans today) answers 404 with reveal off, and so
does a preview of one of its series. A result that is a hidden series isn't
sent. Counts are what reveal lets the viewer see. A twin of a series from such
a source is still SAME TITLE IN LIBRARY (the series is visible), but the
source isn't named: "FROM TOONILY" said what reveal hides. That was true of
SEARCH THE SOURCES too, before this, and is fixed for both
(`libraryIndex().nameable`).

## A site's check

Some sites sit behind a Cloudflare check, and the engine passes it through
FlareSolverr: the first call takes 20–45 s, and is quick after. Nothing used to
say why it was slow. The fork now records which hosts' checks are being
solved and when each last was (`GET /challenges`,
[`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)), and tsundoku asks
(`checkingSince`, through `/api/browse/check/<source>`), matching a host to a
source's site by domain, subdomains included.

- **On a source's page**, while its first answer is coming, the page asks every
  second (`SiteCheck`, `src/lib/site-check.svelte.ts`). If the engine is
  passing the site's check, the band says so at once (Browse Calls, "A site's
  check is named at once", rather than Loading States' ten seconds): "ASURA
  SCANS · PASSING THE SITE'S BROWSER CHECK", how long it has asked, and that a
  first visit takes 20–45 s; the label says WAITING FOR THE SITE over the grid
  outline. Otherwise the house band comes at 10 s ("STILL ASKING …"). At 60 s
  the call gives up: DID NOT ANSWER, with TRY AGAIN.
- **In SEARCH THE SOURCES**, a source still asking says "BROWSER CHECK · ASKED
  18 S AGO" in its header instead of ASKING.
- **In BROWSE**, a source whose site has needed a check says "FIRST VISIT WAITS
  FOR THE SITE'S CHECK" on its line. The hosts are kept in rung 43's
  `site_checks` (its own table: a source's rows are rewritten on every
  install), read from the engine whenever a page asks and when BROWSE opens.

## Extensions and repositories

`/browse/extensions`, BROWSE's back room, from the EXTENSIONS cell on its bar
and from any failed source's row. Three tabs in the URL (`tab`), every
action a form post, so all of it works without script. The domain is
`src/lib/server/engine/manage.ts` over c134's `extensions.ts`.

**INSTALLED** sorts what needs attention first. **01 — NEEDS A HAND**: an
extension the engine refused (FAILED TO LOAD and the reason in a word, TRY
AGAIN offering the kept APK again) or one no repository lists any more
(OBSOLETE: it still loads and won't update). **02 — UPDATES**, with UPDATE ALL
over the count and NOTHING UPDATES BY ITSELF beside it. **03 — INSTALLED**.
A state is c94's failed row, a 3px ink rule and the word; no colour is
proposed. A row's line counts its sources as BROWSE shows them ("2 OF 61
SOURCES SHOWN" for MangaDex: the owner's languages) and its series here as
reveal allows; KIND · LANGUAGE names only those languages.

**Updates ask, and can be taken back.** UPDATE (and UPDATE ALL, which reaches
only what's shown, so reveal decides) installs the version the repository
lists now, and the previous one is kept a week: the row offers BACK TO 1.6.2
until then. A source's kept answers are forgotten on either, since what it
lists may have changed.

**Removing says what stays** (a ConfirmSheet, `?remove=<package>` so it opens
without script): the series that come from it stay, files and all; its
queued chapters leave the queue and its followed series stop being checked;
its settings are kept for a reinstall. Counts are what reveal lets you see.

**AVAILABLE** is every repository's listings, one tab per kind with its count,
a search, and the LANGUAGE cells: the owner's (SETTINGS, below) are on, and ALL
widens this visit (`?all=1`); "+ 25 IN OTHER LANGUAGES · SHOW" says what that
would add. A multi-language extension counts only its sources in those
languages. INSTALL is accent; an installed one says INSTALLED ✓. 150 rows at a
time, MORE ↓ for the next. **With reveal off an adult extension isn't listed or
counted** (the owner's call, 2026-10-28: Keiyoushi's 1,435 read 562), and nor
is one whose every source here is mostly hidden. Inside reveal the ADULT row
(ANY, ONLY, NONE) and the 18+ marks appear.

**An untrusted extension is never installed.** An APK not signed by the key
its repository lists is refused before anything is kept, and the page shows
the key it was signed with beside the repository's. There's no install
anyway: a tap that runs code signed by an unknown key is what the check is
there to stop.

**REPOSITORIES** adds one by its address. Pasted, it's asked before anything
is added (`?add=<address>`): FOUND · Keiyoushi · 1,435 MANGA EXTENSIONS, and
ADD; or NOT A REPOSITORY with the reason. The list shows each with its kind,
what it holds, and REMOVE (which asks, through the sheet, when extensions
installed from it would stay installed without updates). One that stopped
answering keeps its row ruled, STOPPED ANSWERING since a date, with what's
installed from it. CHECK NOW, in the bar, reads every repository again.

**The languages** are a SETTINGS row, 03 — BROWSE · LANGUAGES: a cell per
language the repositories list (most extensions first, twelve at most, the
defaults EN and JA always there), toggled one at a time; one always stays.

**The first run.** With no sources BROWSE is 00 — NO SOURCES YET with the
address field, which asks REPOSITORIES what's there, and what each kind of
repository holds: a Mihon one manga, an Aniyomi one anime, an LNReader one
novels (not yet, c127). The names Mihon, Aniyomi and LNReader appear there and
nowhere else.

**Icons** of available extensions come through the same route as installed
ones, under the same rules: with reveal off an adult one, or one whose every
source is mostly hidden, answers 404.

## A source's settings

`/browse/<source>/settings`, from the SETTINGS cell on a source's page (and,
with c144, an installed extension's row). Many sources have settings: a
mirror, a language, image quality, a login. The engine describes them
(`preferencesManga`); **tsundoku keeps the values** (`engine_preferences`,
c134) and sends them with every call, since the engine keeps none across a
restart (doc/EXTENSION-ENGINE.md, "Preferences"). Each visit asks for the
description again, so a setting a source grows shows up, merged with the
values already kept (`keepPreferences`), and drawn in the source's own order.

| Type                | Drawn as                                                 |
| ------------------- | -------------------------------------------------------- |
| switch              | the system's square Switch, on the row's right           |
| check box           | a ✓ box on the row's right                               |
| list, four or fewer | cells, the chosen one inverted                           |
| list, longer        | its value and CHANGE ▾ (`?change=<key>` opens its cells) |
| multi-select        | ✓ cells                                                  |
| text                | a field with SAVE                                        |

Each row is its own form posting `?/set`, so every change works without
script; with script a multi-select saves as it's ticked, without it shows
SAVE. `src/lib/library/source-settings.ts` reads a stored preference into one
of those shapes (a list's `%s` summary says its current entry) and a form's
answer back into the value `setPreference` stores, refusing anything that
isn't one of the setting's values. A source's kept answers are keyed by its
settings, so its page asks again on return. With the engine down, the kept
values show and still save, under the NOT ANSWERING band.

## Where it lives in the code

| What                                                      | Where                                                                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The filter logic                                          | `src/lib/library/browse-filters.ts`                                                                                                                            |
| Which sources, their shelves, what's kept                 | `src/lib/server/engine/browse.ts`                                                                                                                              |
| A result matched against the library (shared with search) | `asHits` in `src/lib/server/engine/backend.ts`                                                                                                                 |
| BROWSE                                                    | `src/routes/browse/` (`+page.server.ts`, `+page.svelte`, `SourceRow.svelte`, shared with the empty search)                                                     |
| An extension's icon                                       | `src/routes/api/browse/icon/[pkg]/+server.ts`                                                                                                                  |
| A source's page                                           | `src/routes/browse/[source]/` (`+page.server.ts`, `+page.svelte`, `FilterForm.svelte`, `ResultTile.svelte`)                                                    |
| A source's settings                                       | `src/routes/browse/[source]/settings/`, `src/lib/library/source-settings.ts`                                                                                   |
| Extensions and repositories                               | `src/routes/browse/extensions/` (`ExtRow.svelte`), `src/lib/server/engine/manage.ts`                                                                           |
| BROWSE's languages                                        | `src/routes/settings/` (03 — BROWSE)                                                                                                                           |
| A site's check                                            | `checkingSince` / `noteSolvedChecks` in `engine/browse.ts`, `src/routes/api/browse/check/[source]/`, `src/lib/site-check.svelte.ts`; the fork's `ChallengeLog` |
| The engine's schema                                       | the fork, `server/src/main/kotlin/mextensionserver/impl/FilterSchema.kt`                                                                                       |

## Tests

- `tests/browse-filters.spec.ts`: the round trip (schema to URL and back,
  unchanged) over every real fixture, at defaults and with every choice
  moved; one choice moved is one key and one count; out-of-range values
  refused; the engine's format, top-level checkbox included.
- `tests/engine-browse-db.spec.ts`: which sources are named, pages one to N,
  a repeated series shown once, MORE asking only for the new page, a setting
  change asking again, filters sent as a search, a twin from a mostly-hidden
  source not named; BROWSE's list (the owner's languages, a language named
  only where an extension lists several, RECENT's four and its hidden rule,
  updates counted only for what may be seen).
- `tests/engine-manage-db.spec.ts`: INSTALLED's three sections and BACK TO's
  week, a mostly-hidden extension only in reveal, AVAILABLE's languages and
  ALL, adult left out and uncounted, search, REMOVE's counts and what it
  takes out of the queue, TRY AGAIN.
- `tests/browse-extensions.e2e.ts`: a repository asked, refused and added; an
  install, CHECK NOW, UPDATE, BACK TO and REMOVE through the sheet, against
  real signed APKs over https; an untrusted install refused with both keys;
  the languages row.
- `tests/source-settings.spec.ts`: each of the five types read from the
  engine's shapes, a value no longer offered not shown as chosen, a form's
  answer stored or refused.
- `tests/browse-flow.e2e.ts` and the generated `tests/browse-frame.e2e.ts`
  (a source's page) and `tests/browse-list-frame.e2e.ts` (BROWSE),
  in the `browse` project against a fake engine (`tests/browse-setup.ts`,
  [`TESTING.md`](TESTING.md)).

## Where it departs from the handoff

- **IN LIBRARY and HIDDEN are the library's Badge, at 12px.** The mock draws
  them at 11px. They're the same badge as FAV's, in FAV's corner, and one
  badge size across the app is the system's.
- **A top-level checkbox has no row label.** The mock invents one ("CHAPTERS"
  for "Has available chapters"); a source gives a checkbox only its own name,
  so the label column stays empty and the box carries the name.
- **A group of selects is a row per select** (MangaDex's "Tags mode": included
  and excluded). The mock draws one row, TAGS MUST, which no source has.
- **Sort order is two cells, ↓ and ↑.** The mock draws one ↓ cell; flipping it
  takes script, and the panel works without.
- **The tags' find row needs script**, and appears only past thirty tags.
- **A short last row ends in page, not grey.** The grid's rules are drawn by
  each tile into the gap rather than by the grid's background, so empty cells
  show nothing. The library counts filler cells in script; this page draws
  without it.
- **The FILTERED tab carries no number.** The calls mention "FILTERED 4"; the
  count is on FILTER, as the filters state draws it.
- **The empty search offers BROWSE on every device**, not only the phone the
  mock draws it for: the tablet's bar has BROWSE too, but the offer costs
  nothing there and keeps the empty search from being empty.
- **RECENT's times are the app's** ("BROWSED 2 H AGO", `ago()` as TRACKING
  uses it); the calls say the mock's ("YESTERDAY", "LAST WEEK") are examples.
- **EXTENSIONS says MANAGE when nothing waits**, rather than "0 UPDATES".
- **REMOVE's sheet is the app's ConfirmSheet**, one fact a line ("41 SERIES
  HERE COME FROM IT · They stay in the library…"), not the mock's two
  columns: every irreversible action asks the same way.
- **UNTRUSTED has no REVIEW… step and no install anyway.** The refusal shows
  both keys at once; see "An untrusted extension is never installed".
- **No progress bar, no periodic check** (What it does not do yet).
- **A novel source has no SETTINGS** cell, and its search box doesn't offer
  "with its filters": LNReader's search takes none ([`NOVELS.md`](NOVELS.md)).
  Its section is NOVELS, numbered after the others like any section.
- **A multi-select without script has a SAVE.** The mock draws ✓ cells only;
  without script nothing would send a tick.
- **The end of a list says "48 IN ALL"** and drops the MORE row, which the mock
  doesn't draw.

## What it does not do yet

- **NEEDS A BROWSER** isn't drawn: nothing records that an extension failed
  for want of a WebView, which the engine reports only as an error at first
  use. Such a source fails as any other does, on its page.
- **Repositories are checked when asked** (CHECK NOW), not every few hours.
  Nothing updates by itself either way, so a periodic check would only move
  the count on EXTENSIONS sooner.
- **INSTALLING has no progress bar.** An APK is a few hundred KB from the
  repository; the button says INSTALLING… while it's fetched, checked and
  loaded.
- **A check is known once it's been passed** (since the engine started, then
  kept): a site's very first check still shows the 10 s band, not the check
  band, if it hasn't begun by the time the page asks.
- Anime sources: only manga extensions are installed, and
  `filterSchemaAnime` is in the fork but not called. Novel sources are LNReader
  plugins ([`NOVELS.md`](NOVELS.md)).
- **A text filter inside a group can't be set.** The engine reads a group's
  text child from the child's name, which is also how it finds the child.
  None of the nine sources has one; it's dropped from the schema.
- **Two filters with the same name** can only be told apart by their order;
  the engine matches by name, so the second can't be set.
- Long select rows wrap without a rule between their lines.
- The ✓ in a checkbox falls back from Plex Mono, as the design README's known
  gap says of `▶ ✕ ● ○`.
