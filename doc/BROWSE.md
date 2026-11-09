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
down. The sections are the source families (Mihon's, Aniyomi's, LNReader's),
each the kind its family names a row by (`SOURCE_KINDS` in
`src/lib/library/kinds.ts`; card c303), not a list of kind names.

**Which sources.** Those in the owner's languages (the `browse_languages`
setting, `en,ja` by default; its SETTINGS row comes with c144), an
extension's `all`/`multi` sources, and any other the library reads from (a
series from MangaDex's French source keeps that one listed). Listing every
language would be forty-odd rows of MangaDex. **An extension with no source
in those languages shows all of them**: it was installed on purpose, and a
pt-BR site installed and then missing from BROWSE read as broken (the owner,
2026-10-30: "if the user installed a source it should show regardless"). Where an extension has more
than one source listed, each says its language: "MangaDex · EN".

**A row** is the extension's icon, the source's name and a line: its language
and how many series the library has from it, as reveal lets you see them
("41 SERIES HERE"; inside reveal, "126 SERIES HERE, 112 HIDDEN"). A source the
engine refused is c94's failed row (a 3px ink rule on the left, the reason in
a word, "FAILED TO LOAD · PROTOBUF · TRY AGAIN IN EXTENSIONS") and leads to
EXTENSIONS rather than to a page that can't answer. A mostly-hidden source,
and one whose own HIDDEN SOURCE switch is on ("A source's own switches",
below), is only listed inside reveal, with HIDDEN on its icon.

**Icons** come through `/api/browse/icon/<package>`: the server fetches the
repository's icon once, keeps it beside the APKs as an 80px WebP
(`<ENGINE_STORE>/icons`), and serves it from then on, so the viewer's browser
never asks the repository's host, and a repository that dies keeps its
icons. An extension whose every source is mostly hidden (or switched to
HIDDEN SOURCE) answers 404 outside reveal.

**RECENT** is rung 42's `browse_recent`, a row a source, moved to now on each
visit to its page; a visit in incognito leaves nothing. Who may see a row is
decided when it's read, so a hidden source browsed inside reveal is only in
RECENT inside reveal.

**RECENT folds** (card c726, wave 33; a friend's ask). Its label is a toggle:
`01 — RECENT · LAST BROWSED  HIDE ↑`, and folded `01 — RECENT · 4 RECENT
SHOW ↓`, so a folded RECENT still says how many. Open by default, remembered
for the device in one localStorage key, `tsundoku:browse-recent` (`folded`,
or nothing; `src/lib/library/browse-recent.ts`). The series screen's DETAILS
fold is the idiom, but DETAILS is closed by default, so its server draws the
default and only an opened device changes once the page runs. RECENT is open
by default, and a device that folded it must not see it open and then shut
on every load. So BROWSE's `<head>` carries a few bytes of script
(`PREPAINT`) that the browser runs before it parses the body on a document
load (a reload, a bookmark, a new tab): it marks `<html>` with
`data-recent-folded` when the key says folded, and the stylesheet folds the
rows and swaps the label's words from that mark, so the server's open markup
is painted folded from the first frame. An arrival inside the app runs no
head script (an inserted script is inert) and needs none: the page reads the
key as it mounts, before the frame is painted, and puts the mark in step
(another tab may have changed the key since this document's head ran); the
toggle keeps the mark in step too. Without script nothing folds and the
toggle's words are not drawn (a `<noscript>` rule). The label is a button,
one stop on a TV, and OK toggles it; folded, its rows are not stops. **Its
accessible name is `01 — RECENT · LAST BROWSED`, whatever its state**
(`aria-expanded` says which): `HIDE ↑` and `SHOW ↓` are only its drawn
words, since HIDE and SHOW are words other buttons in the browse world are
found by (reveal's HIDE AGAIN among them), and a locator matches a name by
substring. MANGA, ANIME and NOVELS do not fold: RECENT was the ask, and
theirs would cost a key each and a rule for a section that is most of the
screen. Tested in `tests/browse-recent.e2e.ts` (fold, reload, unfold, the
first paint with the app's script blocked, arrivals inside the app, another
tab's change), `tests/tv-browse-recent.e2e.ts` and
`tests/browse-recent-domain.spec.ts`.

**The ways in** (Browse Calls, "Browse is a place"): a BROWSE cell on the
library's tablet bar, before QUEUE; BROWSE in the desktop sidebar's foot,
under HISTORY, with the update count ("5 ↑"); and on the phone, whose bar has
no room, the empty search offers it first: BROWSE A SOURCE with the last
three, then ALL SOURCES · BROWSE with the number of sources.

ADDED TO THE LIBRARY, AND HIDDEN and CONCEAL's band carry a ✕ that clears them
from the URL; a source not answering does not (c493, [`BANDS.md`](BANDS.md)).

### Commands in every top search bar

Every bar that draws a leading `/` as its prompt runs the library's commands,
not only `/search` (card c697): SEARCH THE SOURCES (`/downloads/search`), a
source's own search, and EXTENSIONS' AVAILABLE search. `parseBar`
(`src/lib/library/search.ts`) is the one parser: a command or a page
(`/settings`, `/help`, `/highlights`, and their words) is that, a `/`-led string that names
neither is `unknown` and is said plainly, and everything else is the bar's own
filter. `runSearchCommand` (`src/lib/library/commands.ts`) posts a command to
`/api/command`, which calls the same `runCommand` the library's `?/command`
does. A refusal is shown by the bar and its list does not change. A TV has no
fingerprint and no screen lock, so it refuses `/reveal` from every bar in
`/search`'s own words ("NOT ON A TV · TURN REVEAL ON FROM THE COMPUTER"),
before anything is asked of the server, and no bar turns reveal on there
(`doc/TV.md`). A command that runs leaves the screen where it was and re-reads
its loads (the reveal or incognito band appears); `/settings`, `/help` and
`/highlights` open their page (`/highlights lamp` with the word in its search,
c701), and `/lock`, `/unlock` and, behind the fingerprint gate, `/reveal`
(c711) open `/search?q=…`, since the device prompt is that screen's. A gated
`/reveal` then ends where `/search`'s own does, on the library, because the
ceremony's last step is that navigation: unlike the plain `/reveal`, it does
not return to the bar's screen. The `go` intent travels in history state, not
the URL, and `/search` submits on arrival only for those three, and only when
the state carries it: a typed or shared `?go=1` link is taken off the URL and
runs nothing (round 2, c710), `/search?q=%2Freveal&go=1` included. The state is
emptied before the command is submitted, so the entry cannot run it twice: a
back or forward onto it, or a reload, asks nothing; only a new key press does.
A press counts once. `runSearchCommand` runs one command at a time across the
bars, so a second Enter while one is running sends nothing and pushes no second
entry holding the intent (an unknown command and a TV's refusal still say so,
since neither asks anything). On `/search`, a press while the device prompt is
waiting starts no second ceremony, and an options request that never answers
ends the wait as NOT UNLOCKED (NOT ENROLLED for `/lock`), so the next press can
try again.

## A source's page

`/browse/<source id>`. The bar is ← (BROWSE, or the preview or series a tag
was tapped on: "Arriving from a tag"), the source's name and kind, a field
that searches this source with its filters, and SETTINGS. Under it,
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
FROM WEEB CENTRAL). A twin is known by every name a series goes by
(c555): its title and the members of its `alt_titles`, where a rename keeps
the old name, so a source still calling a renamed series by its old name
still reads SAME TITLE. Where one series is titled so and another only
was, the titled one's source is named. Anything else opens c94's
preview (`/downloads/source/<manga>?from=<this page>`), whose back cell then
says BROWSE and returns here.

### Arriving from a tag

An author, an artist or a genre on a source's preview, and a tag on a library
series (through its sheet, [`SERIES.md`](SERIES.md), the TAGS row), open the
source's page finding it (card c313). `src/lib/library/tag-search.ts` builds
the address from the source's own filters, and is pure and tested over the
five real schemas (`tests/tag-search.spec.ts`):

- **A genre or a tag the filters name** -- a tri-state or a checkbox whose
  name is the value's, case and spacing aside ("slice of life" is "Slice of
  Life"), inside a group or not -- is `tab=filtered` with that one included
  (`f<i>.<j>=1`) or ticked. The rest of the form is written out at the
  source's own defaults, because on FILTERED the URL is the whole form: a
  checkbox the source has on would otherwise turn off. A tri-state wins over
  a checkbox of the same name, and the first in the schema's order over a
  second group naming it too. A select, a text or a sort never names a genre.
- **A person** (author, artist, circle) **fills the source's own text filter
  named for them** (card c456), on `tab=filtered` with the rest at the
  source's defaults: the first top-level text field whose name, a trailing
  bracketed note aside, folds to the namespace (mangahere's Author and Artist,
  Weeb Central's "Author (Case-sensitive)"; `matchPersonFilter`). Most
  sources' plain search reads titles only, so `q=` found nothing by an
  author. A source with no such field (three of the five real schemas, and
  every artist on Weeb Central) is still a search for the name.
- **Everything else is a search**, `q=<value>`: a value no filter names, and
  a source with no schema.
- **A genre is drawn as the source spells it** (c451): `Action` and `action`
  from one source are two values, each its own link, searched as it is
  written; the preview no longer lowercases the label, which drew them as
  `action · action`. The list keeps each distinct string once (`distinct`),
  so a genre named twice in the same spelling is one link. The series
  screen's TAGS row draws its values as stored too.
- **One link a person** on the preview (`previewPeople`, `splitPeople`): a
  source's author and artist strings are split as the importer splits them
  into tags (`people`, `src/lib/import/mihon-plan.ts`: commas, `/`, `;` and
  `&`), so each link is a tag its series carries once added. Each name is
  its own link, searched on its own. A part that is only a generational
  suffix ("Jr.", "Sr.", "II", "III", "IV") stays with the name before it, so
  "Tanaka, Jr." is one person, and since c508 the importers make it one tag
  too (`people` holds the rule; doc/IMPORT-MIHON.md, "One split for
  people"). A name written surname-first ("Oda, Eiichiro") cannot be told
  from two people, and is two links. A name on both lines is drawn once, as
  an author. A library series' person tags were split by the importer when
  they were written; one imported before c508 may still carry `author:Jr.`
  beside `author:Tanaka`, since stored tags are not rewritten.
- **"No schema" is never a kind.** An Aniyomi source answers
  `filterSchemaAnime` and an LNReader plugin its filters, so every family is
  asked the same question; an empty schema, or a call that failed, is a
  search.

**The schema never holds a screen, and a link never guesses before it.** It
is a source call (`SLOW_MS`), and calls into one extension run one at a time
(`inLane`, `engine/client.ts`), so neither screen asks for it to paint: the
preview's links and the series sheet's IN <SOURCE> row name the tag, not the
answer, and point at a small server route, `GET /downloads/source/<id>/tag-search`
or `GET /series/<id>/tag-search`, with `?ns=&value=&from=`. That route checks
access as its screen does (the preview: the engine configured and a source
BROWSE lists with this reveal; the series: `tagSourceOf`, which reads the one
series row with the hidden rule), waits for `filterSchema`, and answers 303 to
the address above. A failure, or no answer within `TAG_SCHEMA_WAIT_MS` (20 s,
under the source's own 60), is a search for the value. So the href is the same
from the first paint, with or without script, and a tap made before the filters
have come still lands on the filter (review round 2: until then, a link built
on the page was a search for its value, and a quick tap or ↓ OK on a TV landed
there). A link to the route is a full navigation (`data-sveltekit-reload`); the
series sheet stays open while it waits. **The wait says so** (c452): up to
`TAG_SCHEMA_WAIT_MS` on a cold source, with no loading bar on a TV's WebView,
so the link tapped on the preview is `aria-busy` and underlined, with
`FINDING <SOURCE>'S FILTERS… · A FIRST CALL TAKES UP TO 20 S` under the TAGS
row, and the sheet's IN <SOURCE> row is `aria-busy` with `FINDING <SOURCE>'S
FILTERS…` as its second line. `pageshow` clears both, for BACK from the
bfcache. A BACK that is not from the bfcache draws the page again, so BACK
alone passed with the clear removed; `tests/browse-tags.e2e.ts` pins each
clear with a `pageshow` sent with `persisted: true` to the page that set the
mark, its navigation held (c538). `filterSchema` keeps the answer per
source (`keep`), so after the first tap the wait is nothing, and the source's
page answers from the same cache.

**Back returns to where the tag was.** The link carries `from=` with the
preview's or the series' own address, query included, and the source page's
← goes there (`backOrigin`: only `/downloads/source/<id>` and `/series/<id>`,
never another host or screen, as `sourceOrigin` refuses an open redirect).
That ← and the preview's own are plain links, never back links (c864): a
source's list and its tag search share the path `/browse/<id>`, so a back
link's path-only match would step onto the tag search the reader came
through, and the two ←s would alternate between it and the preview for good.
Wave 40's round 2 measured exactly that on `e12a4bfb`, where the preview's ←
was a back link; its proposed `use:backLink` here too cannot work, because a
tag page is a native navigation (its `tag-search` route is a server route) and
the app's history map begins again there. The preview's ←
names the list it was opened from, and the catalog puts the tile's focus back
itself when that ← brings it back, and only then: `restoreFocus` reads the
`data-focus-id` `saveFocus` noted for that URL, as on a popstate, while a list
left by touch or mouse saved none. A forward visit starts at the top with no
tile held, and a reload puts no tile back either (its scroll is the browser's
own, SvelteKit restoring it); neither is a way back (c864's round 2). **Every way to another list of the same source keeps it**
(card c453): POPULAR and LATEST,
the search field (a hidden `from`), FILTER's APPLY (a hidden `from`) and
RESET, paging and the panel's toggle (`link()` keeps every parameter), and
SETTINGS, whose ← and rows carry it back (`keepOrigin`, tag-search.ts). Only
the value `backOrigin` accepted is carried, never the raw parameter. Until
wave 20 the tabs and the search started from the source's base address and
dropped it, so after one change of list ← said BROWSE again
(`tests/browse-tags.e2e.ts` walks every one of those doors; LATEST is tapped
in `tests/browse-flow.e2e.ts`, whose source has a latest list).

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
Toonily, Toonily.me and Omega Scans today), or whose own HIDDEN SOURCE switch
is on (card c435), answers 404 with reveal off, and so does a preview of one
of its series, its settings, and a tag's search on it. Both are one field,
`BrowseSource.mostlyHidden` (with `hiddenSource` saying which), so every door
that asks it (BROWSE, RECENT, EXTENSIONS, the icons, `/search`'s list, the
check's poll) closes for both. EXTENSIONS asks it for LNReader's plugins
too, whose own lists (`pluginView`, `pluginsAvailable`) list every plugin:
the route filters them through `pluginsHidden`, `pluginsShown` and
`novelsAvailable` (`src/lib/server/engine/manage.ts`), so a hidden plugin is
not on INSTALLED, not in its count, not in UPDATE ALL and not on AVAILABLE's
NOVELS tab outside reveal (card c435, round 2). A result that is a hidden series isn't
sent. Counts are what reveal lets the viewer see: a shown plugin's "N SERIES
HERE" on INSTALLED counts only its visible series outside reveal, and inside
reveal says how many are hidden ("2 SERIES HERE, 1 HIDDEN"), as a Mihon
package's does (`pluginView(reveal)`, c506; until wave 24 it counted the
hidden ones too). These read the app's database: `novelsAvailable` takes no
`db`, since `pluginsHidden` would have read the switches from another one. A twin of a series from such
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

**A novel is named too** (c152). An LNReader plugin's check is solved by the
app itself, since the plugin host refuses local addresses and a solver is one
([`NOVELS.md`](NOVELS.md), "Past a site's bot check"): the novel's site is its
plugin's (`novel_plugins.site`), the app knows while its own solve runs, and
`solvingSince` joins what `/challenges` says, so every line below is there for
a novel exactly as for an extension. The route is asked wherever BROWSE is:
SEARCH THE SOURCES gates its poller on the downloads backend being the engine
at all (without the engine there is no BROWSE, so no novels either), not on
which of the two is answering a check.

- **On a source's page**, while its first answer is coming, the page asks every
  second (`SiteCheck`, `src/lib/site-check.svelte.ts`). If the engine is
  passing the site's check, the band says so at once (Browse Calls, "A site's
  check is named at once", rather than Loading States' ten seconds): "ASURA
  SCANS · PASSING THE SITE'S BROWSER CHECK", how long it has asked, and that a
  first visit takes 20–45 s; the label says WAITING FOR THE SITE over the grid
  outline. Otherwise the house band comes at 10 s ("STILL ASKING …"). At 60 s
  an extension's call gives up: DID NOT ANSWER, with TRY AGAIN (a novel's waits
  two minutes, since its first call may pass a check the app solves).
- **In SEARCH THE SOURCES**, a source still asking says "BROWSER CHECK · ASKED
  18 S AGO" in its header instead of ASKING.
- **In BROWSE**, a source whose site has needed a check says "FIRST VISIT WAITS
  FOR THE SITE'S CHECK" on its line. The hosts are kept in rung 43's
  `site_checks` (its own table: a source's rows are rewritten on every
  install), read from the engine whenever a page asks and when BROWSE opens,
  and written directly when the app solves a novel's check.

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

### Selecting many at once

**SELECT** (card c696, the owner's ask of 2026-11-07; designed
`doc/handoffs/extensions-select/`) is **INSTALLED's**, a cell between the title
and CHECK NOW; a TV draws none, as the library draws none. It is URL state
(`?select=1`), and so is the selection (`pkg=…` once per ticked package), so a
no-script press lands with its rows still ticked. AVAILABLE and REPOSITORIES
dim and stop while it runs: leaving the tab would drop the selection without a
word. ✕, Escape, BACK and a tab's own TICK / UNTICK all work without script.
It ends on ✕, Escape (a focused tick included: an `input` keeps Escape from the
focus layer, so the form ends SELECT itself), BACK (`registerBack`), a reload,
or an UPDATE or REMOVE that succeeded; **a switch press does not end it**, so
the cells read back what the press set.

**A row is a package, a switch is a source id** (the owner's decision,
2026-11-08): a press changes **every source of each ticked extension**,
including a language BROWSE does not list, because that is what SETTINGS would
do one source at a time. The ids come from the engine's own rows
(`browseSources(true)`), never from the rows drawn, and an LNReader plugin is
its one id `ln:<id>` (`pluginOf`, `select.server.ts`).

**The bar** (six cells) sets HIDDEN (HIDE outside reveal), ADDED HIDDEN, OFF
HISTORY and NEVER TRACKED, and carries UPDATE n and REMOVE n…; a section's
label offers TICK n / UNTICK n where UPDATE ALL sat. A switch is counted in
extensions: ON when every source of every ticked package has it, OFF when none,
MIXED otherwise (a PART extension is one whose sources disagree), and **every
cell's second line says what the next press does** (`MIXED · 3 OF 12 · 1 PART ·
TAP: ALL ON`, `12 OF 12 · TAP: ALL OFF`). A package whose sources are not
known (an extension the engine never listed a source for) cannot change, and
with none left the cells are disabled. Outside reveal HIDDEN is an **action**,
not a switch: a count would hint at what is hidden, and hidden means hidden.

**Bulk HIDE sets the switch, and nothing else** (decided alone, round 2 of wave
42; the brief asked for the decision). At the single door, HIDDEN SOURCE hides
the source while **CONCEAL ITS SERIES** hides the series already in the library
from it, once and now (`Conceal its series`, below). A bulk HIDE does the first
only: every source of every ticked extension leaves the list, its search and its
pages' names, while the library's series from those sources **stay shown**, with
their own hidden state untouched. The band says exactly that ("THEY LEFT THE
LIST AND THE SELECTION · REVEAL SHOWS THEM"). Reasons: it is the same press
HIDDEN SOURCE is on the settings page, not CONCEAL; it never hides a reader's
series without CONCEAL's own question; and its UNDO brings the sources back,
which a series write would not. **CONCEAL ITS SERIES stays on each source's
settings page**, one source at a time; offering it for a selection would be a
new cell and sheet (a design question), not part of this press.

**One band, one UNDO** (Results board). The press carries each source's value
before it (`from=id|1,id|0`), so UNDO puts a mixed selection back mixed and a
source already on stays on; it refuses whole when a source was changed since on
its own settings page ("UNDO REFUSED · <NAME> WAS CHANGED SINCE · NOTHING
CHANGED"), because an UNDO that took back half a press would be a lie. A press
and its facts are one transaction (`setSourceFlags`), so a failure part-way
leaves nothing changed. A row that could not change keeps its ink rule and
leads with `NOT CHANGED · …` until the next press or ✕; a package removed on
another device since it was ticked leaves the list and the selection and is
counted in the band, not called a success.

**UPDATE and REMOVE in bulk** are the list's own actions narrowed to the
selection. UPDATE installs what each repository lists now, keeps the old APK
for a week and forgets each source's kept answers, and its UNDO is BACK TO for
every row it updated; SELECT ends. REMOVE asks first through REMOVE's
ConfirmSheet with its lines summed, and has **no UNDO** (the sheet asked; an
install fetches what the repository lists then, which may not be the removed
version). **An OBSOLETE row stays installed**: no repository lists it any more,
so once removed it could not be installed again, and its settings could not be
reached. The sheet counts what may go, and says which stay and why. Tested in
`tests/extensions-select-db.spec.ts` and `tests/browse-extensions-select.e2e.ts`;
the frame is `tests/browse-extensions-select-frame.e2e.ts` (the tablet's
selecting state).

**AVAILABLE** is every repository's listings, one tab per source family (MANGA
for Mihon's APKs, ANIME for Aniyomi's, NOVELS for LNReader's plugins; the URL
says `kind=anime` or `kind=novels`) with its count,
a search, and FILTER. The search ignores case and spacing and matches the
extension's name or any of its sources' (`weebcentral` finds Weeb Central). A
multi-language extension counts only its sources in the languages asked. INSTALL
is accent; an installed one says INSTALLED ✓. 150 rows at a time, MORE ↓ for the
next.

**Filters** (`src/lib/library/ext-filters.ts`; the owner, 2026-10-31): FILTER
opens the library's filter panel (Library Filters 3, `ExtFilter.svelte`), every
choice a link in the URL, so it works without script; choosing keeps it open,
DONE closes it, ✕ CLEAR ALL clears it. A tap before the page hydrates keeps
it open, as the library's does (doc/FILTERS.md, c105): the `<details>` is the
truth, read on mount, followed by `toggle` and closed through the element. It
used `bind:open` until wave 24 (c473), whose hydration wrote `false` back and
shut the panel under the finger; `tests/browse-extensions.e2e.ts` taps FILTER
with the app's scripts held back.

- **LANGUAGE** (`?lang=en,fr`): several at once, starting from SETTINGS'
  languages (MINE goes back to them) and only for the visit; SETTINGS stays
  the place to change the default. None ticked is every language. ALL, the
  one-button widening, is gone; "+ 25 IN OTHER LANGUAGES · SHOW" under the list
  still says what a search finds elsewhere, and shows it.
- **INSTALLED** (ANY, INSTALLED, NOT INSTALLED), **REPOSITORY** (when there are
  two or more), **18+** (ANY, ONLY, NONE; not for novels, which LNReader never
  marks), **IN LIBRARY** (sources with series here, as the viewer may see them).

**18+ is listed for everyone, marked.** Until 2026-10-31 an extension its
repository flags as adult was left out with reveal off (the owner's call,
2026-10-28: Keiyoushi's 1,435 read 562). But Keiyoushi flags mainstream sites
that carry some adult titles: Weeb Central was unfindable for a friend, and for
the owner outside reveal. Now it's listed with its 18+ mark, its icon is
served, and the 18+ row filters it, for anyone. What stays inside reveal is an
extension whose every source here is mostly hidden: hidden means hidden.
BROWSE's own lists and search never filtered on the flag, so an installed 18+
extension's sources were always there, on GET STARTED's first day too.

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
novels (c148). The names Mihon, Aniyomi and LNReader appear there and
nowhere else.

**Icons** of available extensions come through the same route as installed
ones, under the same rules: with reveal off one whose every
source is mostly hidden, answers 404.

## A source's settings

`/browse/<source>/settings`, from the SETTINGS cell on a source's page (and,
with c144, an installed extension's row). **Its ← goes back where it was
opened from** (card c727, wave 33): from EXTENSIONS' cell it says Back to
EXTENSIONS and returns to the list on its tab (the cell sends
`from=/browse/extensions?…`, `extensionsFrom`, without a sheet's parameters);
from the source's page it says Back to <source> and returns there, as
before. It is a back link (`backLink`, src/lib/back.ts), so a list a few
history entries back comes back as it was left, scroll included; a reload,
a new tab or a bookmark opens the address. Only `settingsOrigin` accepts
EXTENSIONS' path (exactly `/browse/extensions`), never `backOrigin`
(doc/NAVIGATION.md, "From a source"). EXTENSIONS draws one row per package
(`{#each s.rows as r (r.pkg)}`), and the cell opens the first source BROWSE
lists of it (`r.shown[0]`): a package with several languages still has one
cell, since the list has no row per language to put a second on (c695,
wave 33). `tests/browse-settings-back.e2e.ts` walks both origins, the
reload, the new tab, the bookmark and forged origins, on a desktop and a
phone. Many sources have settings: a
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

Since card c435 the extension's own settings are `02 — <SOURCE> · <LANG>`,
under tsundoku's own switches, and every family has the page: an LNReader
plugin, which keeps no preferences here, has only the switches, and its
source page draws the SETTINGS cell like any other (until then it had no
cell and its page answered 404).

### A source's own switches

Four rows above the extension's own (`01 — IN TSUNDOKU`), drawn as the
page's switch rows are, each its own form posting `?/flag`, and under them
one action, CONCEAL ("Conceal its series", below). They are
tsundoku's, not the extension's: nothing is sent to the source. Card c435,
the owner's request of 2026-11-03; NEVER TRACKED is c522, the owner's pick
from c504 (2026-11-04).

| Switch            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hidden source** | The source is listed, opened, searched and named only inside reveal, as a mostly-hidden one is: BROWSE and RECENT, EXTENSIONS (an extension whose every source is hidden, and an LNReader plugin: INSTALLED, its count, UPDATE ALL and AVAILABLE's NOVELS, filtered by the route through `pluginsShown` and `novelsAvailable`), its icon, its page, its settings and its previews, SEARCH THE SOURCES (`searchSources`, `novelSearchSources`), and SAME TITLE's "FROM <SOURCE>" (`nameable`). Its series keep their own hidden state.                                                                                                                                                         |
| **Added hidden**  | A series added to the library from it starts hidden. Every ADD door of a source: `addToLibrary` (Mihon's), `addAnime`, `addNovel` and `keepOrPromote` (a browsing record promoted by ADD), and every import (a backup, a scan, IMPORT A BACKUP; below). With reveal off, ADD then lands on the source's page with "ADDED TO THE LIBRARY, AND HIDDEN", since the hidden series isn't found, or on BROWSE, naming no source, when the ADD left the source mostly hidden (the first ADD from a source with nothing else here does); that band says what ADD AND DOWNLOAD queued and offers UNDO ("ADD outside reveal", below). A browsing record is not an add.                                  |
| **Off history**   | Its reads and watches never show in HISTORY, inside reveal or not, and its time is not in HISTORY's total ([`HISTORY.md`](HISTORY.md)). They are still logged: progress, CONTINUE, the series' own time and tracking are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Never tracked** | Nothing from it is sent to AniList, MAL or Ranobe: progress, STATUS and SCORE, a rating, an anime's seasons, Ranobe's reads and its edition suggestion, and SUGGEST TO RANOBE all refuse, and a send already queued is dropped (AniList, MAL) or held until the switch is off (Ranobe) (`tracking.ts`'s `targets`, `ranobe.ts`'s sends). Its reads still count here: progress, CONTINUE, HISTORY and the series' own time are unchanged. The series screen's LISTS row says why instead of offering a send ([`TRACKING.md`](TRACKING.md), "Sending"). A search for a link is not a send: FIND stays, and a link is how a cover and its details arrive. Card c522, the owner's pick from c504. |

**Kept** in the `settings` key/value table, one row per switch that is on
(`source.hidden:<id>`, `source.added-hidden:<id>`, `source.off-history:<id>`,
`source.never-tracked:<id>`, value `1`; off deletes the row), keyed by BROWSE's source id (an engine
source's number, `ln:<plugin>`). No rung: a row per switch is a primary-key
lookup for SQL (`sourceFlagSql`, `src/lib/server/engine/source-flags.ts`),
which is how HISTORY filters in SQL. A series' source in SQL is
`sourceIdSql(origin_key)`, held to `sourceOfKey` over every key a writer
stores (`tests/source-flags-db.spec.ts`).

**REMOVE keeps them** (card c569, the owner's (b), 2026-11-05): removing an
extension or a novel plugin deletes only its row (`removeExtension`,
`removePlugin`), and its switches stay in `settings`, so a source installed
again comes back with HIDDEN SOURCE, ADDED HIDDEN, OFF HISTORY and NEVER TRACKED
as the owner left them: they were set on purpose, and REMOVE's sheet already says ITS
SETTINGS ARE KEPT. To start a source afresh, turn its switches off before
REMOVE; once it is removed its settings page is gone with it, so they can be
reached again only by installing it. `tests/browse-extensions.e2e.ts` holds
it (REMOVE, INSTALL again, the switches still on).

**ADDED HIDDEN at the importer** (card c503, the owner's (a), wave 23): a
series an import creates in the library from a source with the switch on
arrives hidden too, so **a backup can only add hiding**. A series the backup
hides stays hidden, one it shows arrives hidden, and a series already in the
library that the import only updates is not newly hidden: the switch is
about what arrives, not a rule over what is there, so a series shown again
inside reveal stays shown at the next scan. The writer applies it in the
same transaction that creates the series (`writeSeries`'s `addedHidden`,
`src/lib/server/import/write.ts`), and both of the importer's callers pass
it: a scan or IMPORT A BACKUP (`run`) and what tsundoku's downloaders attach
(`attachWritten`). Of what an import plans, keys that name a source are
switched by their source: a Mihon backup's series (`mihon:<n>:<url>`), and
tsundoku's own anime and novel downloads read back (`aniyomi:`, `lnreader:`).
**A Mihon download folder's own series** (`mihon-dir:<source folder>/<title>`)
names no source in its key (`sourceIdSql` answers NULL), so since card c571
(wave 26) the writer reads its source from the folder instead
(`folderSourceId`, `src/lib/server/import/fold.ts`): Mihon names the folder
`<name> (<LANG>)`, so the folder is the installed source with exactly that
name and language, or, failing any, the one installed source with exactly
that bare name. A folder series created from a switched source arrives
hidden, so **the order of arrival no longer matters**: created before any
backup names it, it arrives hidden, and stays hidden when a backup later
names it and `adoptFolder` re-keys it to `mihon:<n>:<url>` (a fold never
shows anything); arriving first through a backup that names it, it arrives
hidden as before. **Only one installed source may answer**: two installed
sources with one name and one language (two extensions calling themselves
the same) cannot be told apart from the folder, so neither's switch is
applied and the folder's series arrives visible, as it does from a source
that is not installed (no `engine_sources` row: its switch, which REMOVE
keeps, is not read for a folder) or whose switch is off. Two sources of one
name in different languages are told apart by the folder's language. As
everywhere, only a series the import **creates** is hidden: a folder series
already in the library, adopted or rescanned, is left as it is. Hentoid's
books, an EPUB and a gallery name no source, so the switch never reaches
them. In every case the owner can hide a series inside reveal. What an attach creates also makes
BROWSE ask its per-source counts again (`forgetSourceUse`, as a run does), so
`mostlyHidden` does not wait out the cache's minute. `tests/import-db.spec.ts`
holds every combination, the attach included, and c571's folder in both
orders, the shared name and the language; `tests/devices-import-db.spec.ts`
the folder adopted by the library's own backup.

**ADD outside reveal** (card c505, wave 24). The source's page draws the
band the series page would have, or BROWSE does when the source's page is
not found (below): "ADDED TO THE LIBRARY, AND HIDDEN", then
"<SOURCE> ADDS ITS SERIES HIDDEN · 12 CHAPTERS · 10 DOWNLOADING · REVEAL
SHOWS IT" (ADD AND DOWNLOAD's `queued`, in `addedDetail`'s words), and UNDO.
The band is its URL (`?added=hidden&series=<id>&preview=<preview id>&queued=`),
so a reload says the same. The id alone is never trusted, since a series'
id is given again once the series is gone: the band and its UNDO name the
series only while its id **and** the key of the preview it came from both
still match, it is in the library and the preview is this source's
(`addedHere`, `src/lib/server/engine/source-flags.ts`). UNDO is the series
page's (`undoAdd`): out of the library while nothing of it is downloaded or
read, then the preview again. Once something is, the band draws no UNDO and
says "NO UNDO: SOMETHING OF IT IS DOWNLOADED OR READ NOW", and an UNDO
tapped after that happened is refused with the same words. UNDO twice, or
the band's URL after UNDO, finds no series, says nothing and undoes nothing.

**Shelves in the ADD band** (card c724, wave 33; a friend's ask). Under this
band, a second line in its panel: `PUT ON A SHELF:` and the owner's shelves
(the library's collections) as chips, one tap each, several allowed, a
second tap takes one off; the line says `ON LATER, TONIGHT` once it is on
any. Then `+ NEW SHELF`, which opens `NewShelfSheet` as it is (the URL's
`new=shelf`), at the strip's right end under UNDO, so a remote's ↓ from UNDO
lands in the strip and ← walks the chips. The band still says ADDED TO THE
LIBRARY, AND HIDDEN, with the chips under it. The last shelf a chip put the
series on is offered first next time, per device (`tsundoku:add-shelf`, its
id; read once as the band mounts, so the order can change once just after
the first paint). Past six shelves the band draws the first six, always
including any the series is on, and `N OTHER SHELVES` opens the SHELVES
sheet (`ShelfPicker`, as it is, posting to the library's `?/shelf`). The
rules are `src/lib/library/add-shelf.ts`.

A chip posts to the page's own `?/shelve` (the source page's and BROWSE's,
`shelveAdded` in `added.server.ts`), which writes through the SHELVES
sheet's own `setInCollection`, and only for the band's own series
(`bandSeries`: its id and its preview's key, as UNDO asks), so a chip tapped
after UNDO, or on a stale band, shelves nothing and says `NOT SHELVED: THE
SERIES IS NOT IN THE LIBRARY NOW`. `NewShelfSheet` posts only `name` to
`?/newShelf`, and a relative `?/newShelf` drops the page's query, so
`newShelfAdded` reads the band from the post's `Referer` (sent in full to
the same origin by the browsers' default policy) and acts only when that is
this page on this origin with a band whose facts hold; it lands back on the
band, the sheet closed. No storage of its own: a shelf is a
`collection_series` row, which cascades with the series, so **UNDO takes
both back** (the series row goes, and its shelf rows with it); the shelves
themselves stay. Without script a chip's post carries the band in its URL,
as UNDO's does. Tested in `tests/add-shelf-domain.spec.ts`,
`tests/add-shelf-db.spec.ts` and `tests/browse-add-shelf.e2e.ts`.

**The series screen's band is not this one.** An ADD that is not hidden (the
common case) lands on the new series with its own ADDED TO THE LIBRARY band
(`src/routes/series/[id]/+page.svelte`), which is another slot's file in wave
33; giving it the same chips is a patch for its owner
(`doc/handoff-notes/browse.md`, wave 33, Gaps). The series screen already
has the write: its `?/shelf` action.

**Where the band lands** (c505, round 2). The ADD can itself make the source
mostly hidden: more than half its series hidden (`mostlyHidden`), and the
counts are asked again at once (`forgetSourceUse`), so on a source with
ADDED HIDDEN on and nothing else here the first ADD leaves it 1 of 1
hidden, and its page is not found outside reveal. That is the usual case
for a source someone switched ADDED HIDDEN on for, not an edge. So ADD asks
after it has run (`addedLanding`, `src/routes/browse/added.server.ts`):
while the source is still found, the band is on its page, its place kept;
once it is not, the band is on BROWSE (`/browse?added=hidden&…`, the same
parameters), as CONCEAL's is (c523), and names no source outside reveal,
since hidden means not named: "ITS SOURCE ADDS ITS SERIES HIDDEN · … · THE
SOURCE IS HIDDEN WITH IT · REVEAL SHOWS BOTH". Inside reveal the source is
here, so the band names it and has no tail (c605). BROWSE has its own UNDO (`?/undoAdd`),
and both UNDOs ask only the band's facts (the series' id and key, and the
preview), never whether the source is found, so a band drawn on the
source's page is undone there even after the source became mostly hidden
(a second ADD, another tab). UNDO lands on the preview while its source is
found, and on BROWSE while it is not (other series of it are still hidden,
so the preview would not be found either).

**A refusal's words are the last answer, not a fact about now** (c664). A
no-script refused UNDO on a source's page which can no longer draw its band
lands on BROWSE with the refusal's **code** in the URL
(`/browse?added=hidden&…&refused=409`, `refusedLanding`,
`src/routes/browse/added.server.ts`), and BROWSE's load turns it back into
words (`refusedWords`). A later load does not trust the code alone:
`standingRefusal` asks the cause again. A 409 is "something of it is
downloaded or read now", which is the band's own `touched` (the same query
`undoAdd` refuses on), so a reload after the chapter is marked unread draws
UNDO again, and the server accepts it. So the band never offers an UNDO the
server would refuse, nor hides one it would accept, and the refusal now shows
its words without script as well. There is no 503 (c690): `undoAdd` is a local
`DELETE` and never asks the engine, so an engine that is down refuses no UNDO,
and a typed `refused=503` says nothing and hides nothing.

**The band's action keeps `from=`** (c664). Without script UNDO's answer is
a load of the form's action URL, so that URL carries the band's own
parameters and, on a source's page, the tag origin the page was opened with
(`from`, the value `backOrigin` accepted, passed through `data.back`).
Without it the answer page's ← went to the default back cell instead of the
tag's screen.

**An accepted UNDO keeps the way back too** (c690). It lands on the preview
with `from=/browse/<source>?from=<the tag's origin>`, the origin read again
through `backOrigin`, never the raw parameter. A preview's ← takes only a
source's page or the search (`sourceOrigin`), so the tag's origin cannot be
its `from` directly: ← goes where it did before the ADD, to the source's page,
whose own ← is the tag's screen. With no origin, a refused one, or a landing on
BROWSE, there is no `from`.

**ADD AND DOWNLOAD queues only what its own ADD hid** (c505). Outside reveal
a hidden series is not the viewer's, but the one ADDED HIDDEN has just hidden
is: it is queued, and queueing it shows nothing. Every ADD door also answers
with a series already here (`keepOrPromote`), and one hidden before, for its
own reasons, is not queued outside reveal and gets no band (the page is the
source's again), as before c435. Which is which is read before and after
the ADD, under the key the preview knows the series by
(`addWatchingHidden`): hidden after, not before, and the series the ADD
answered with. The doors that hide on ADD (`hideIfAddedHidden`):
`addToLibrary` (Mihon's, `engine/backend.ts`), `addNovel`
(`novels/source.ts`), `addAnime` (`engine/anime-source.ts`) and
`keepOrPromote` (`browsing.ts`), all reached by the preview's two actions
through `downloads.ts`'s `addToLibrary`, which is why the question is the
preview's, and the importer's `writeSeries`, which queues nothing.

**What ADDED HIDDEN does not reach:** a follow's or a refresh's new chapters
are not an add, and a download of a series already in the library neither.
Grouping books (`src/lib/server/books.ts`) makes a series from the owner's
own books, with no source.

With reveal off, turning HIDDEN SOURCE on lands on BROWSE, since the page it
was set on is no longer found. Turning it off again is done inside reveal.

### Conceal its series

**CONCEAL** (card c523, the owner's pick from c504, 2026-11-04; wave 24) is
the other half of HIDDEN SOURCE. HIDDEN SOURCE hides the source and leaves
its series' own state alone; CONCEAL hides the series, once, now, and leaves
the source's switches alone. It is an action, not a switch: it stores nothing
in `settings`, so a series added from the source afterwards is not hidden by
it (ADDED HIDDEN is that switch), and it is a row of its own under the three
switches with a cell on the right, `CONCEAL <n>`. Its words avoid HIDE and
HIDDEN, because the page's HIDDEN SOURCE row and reveal's HIDE AGAIN are
found by those words and a locator matches by substring.

- **What it hides:** every series in the library from the source that the
  library shows (`concealable`, `src/lib/server/engine/source-flags.ts`),
  through `setHiddenWhole` (`src/lib/server/works.ts`), so a Work is never
  left half hidden (c389): a Work with a part from the source is hidden
  whole, its parts from other sources too. So the count can be more than the
  source's own series, and the row says so: "Hides the 12 series here from
  it, once, now, and 2 more from other sources: the parts of their Work,
  since a Work is hidden whole." A series hidden already, for its own reasons
  or by its root, is not counted and not touched.
- **Asking:** more than one asks first in a `ConfirmSheet` ("CONCEAL 14
  SERIES?", what goes with them, and that nothing is kept); without script
  the sheet is a URL, `?ask=conceal`. One series is the cell's own press.
- **Nothing shown:** the cell is drawn disabled, `CONCEAL`, and a post anyway
  is refused with "NOTHING FROM IT IS SHOWN" in the page's refusal band. More
  than 600 to hide is refused too, since the band carries every id in its
  URL (Node's 16 KB for a request's head).
- **The band:** "14 SERIES HIDDEN NOW · 12 FROM <SOURCE> · 2 MORE: PARTS OF
  THEIR WORK, HIDDEN WHOLE · REVEAL SHOWS THEM", with UNDO. Inside reveal it
  is on the settings page. Outside reveal a source whose every series is
  hidden is mostly hidden, so its pages are not found: CONCEAL lands on
  BROWSE, whose band names no source ("12 FROM ITS SOURCE · … · THE SOURCE
  IS HIDDEN WITH THEM · REVEAL SHOWS BOTH"), and UNDO there brings both back.
  The band is its URL (`?concealed=<id>.<mark>,…&of=<source>`), so a reload
  says the same; it counts only what is still hidden of what it hid, and is
  not drawn once nothing is.
- **UNDO shows only what this press hid** (`undoConceal`,
  `src/routes/browse/conceal.server.ts`, over `undoHideWhole`). The band
  carries the ids the press changed, never "the series from this source", so
  a series added between the press and UNDO is not shown; a series hidden
  before the press for its own reasons was never among them and stays
  hidden. Each id carries a mark (six hex characters of its root, key and
  path, `seriesMarks`), because an id is given again once its series is
  gone: an id whose mark no longer matches is left hidden, and so is a series
  renamed or moved meanwhile (when in doubt, hidden). A Work comes back only
  while every hidden part of it is one the press hid, as the library's UNDO
  does (c390): a Work the library hid again with the same parts is the same
  hidden state, and UNDO shows it. So an UNDO also shows a Work hidden again,
  part for part, after the press: nothing records when a series was hidden,
  and the owner declined the `hidden_at` rung that would tell the two apart
  (c608, 2026-11-07). UNDO twice, or the band's URL after UNDO, shows nothing
  more.

## Where it lives in the code

| What                                                      | Where                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The filter logic                                          | `src/lib/library/browse-filters.ts`                                                                                                                                                                                                       |
| A tag's address on a source's page, and ← back            | `src/lib/library/tag-search.ts`; the preview's links in `src/routes/downloads/source/[id]/`, the series' sheet in `src/routes/series/[id]/` (`TagSheet.svelte`, `tag-source.server.ts`, `tag-search/`); the preview's `tag-search/` route |
| Which sources, their shelves, what's kept                 | `src/lib/server/engine/browse.ts`                                                                                                                                                                                                         |
| A result matched against the library (shared with search) | `asHits` in `src/lib/server/engine/backend.ts`                                                                                                                                                                                            |
| BROWSE                                                    | `src/routes/browse/` (`+page.server.ts`, `+page.svelte`, `SourceRow.svelte`, shared with the empty search)                                                                                                                                |
| An extension's icon                                       | `src/routes/api/browse/icon/[pkg]/+server.ts`                                                                                                                                                                                             |
| A source's page                                           | `src/routes/browse/[source]/` (`+page.server.ts`, `+page.svelte`, `FilterForm.svelte`, `ResultTile.svelte`)                                                                                                                               |
| A source's settings                                       | `src/routes/browse/[source]/settings/`, `src/lib/library/source-settings.ts`; tsundoku's own switches in `src/lib/server/engine/source-flags.ts`; CONCEAL in `src/routes/browse/conceal.server.ts` and `ConcealBand.svelte`               |
| Extensions and repositories                               | `src/routes/browse/extensions/` (`ExtRow.svelte`), `src/lib/server/engine/manage.ts`                                                                                                                                                      |
| BROWSE's languages                                        | `src/routes/settings/` (03 — BROWSE)                                                                                                                                                                                                      |
| A site's check                                            | `checkingSince` / `noteSolvedChecks` in `engine/browse.ts`, `novels/solver.ts` (the app's own solve, c152), `src/routes/api/browse/check/[source]/`, `src/lib/site-check.svelte.ts`; the fork's `ChallengeLog`                            |
| The engine's schema                                       | the fork, `server/src/main/kotlin/mextensionserver/impl/FilterSchema.kt`                                                                                                                                                                  |

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
  LANGUAGE, 18+ listed and filtered, INSTALLED, REPOSITORY and IN LIBRARY, a
  search ignoring case and spacing, REMOVE's counts and what it takes out of
  the queue, TRY AGAIN. `tests/ext-filters.spec.ts`: the filters' URL,
  LANGUAGE's toggles, the search's folding.
- `tests/browse-extensions.e2e.ts`: a repository asked, refused and added; an
  install, CHECK NOW, UPDATE, BACK TO and REMOVE through the sheet, against
  real signed APKs over https; an untrusted install refused with both keys;
  the languages row; an 18+ extension listed and marked, a search ignoring
  case and spacing, FILTER's 18+ ONLY, CLEAR ALL and DONE; an LNReader
  plugin installed, browsed, its HIDDEN SOURCE set (gone from INSTALLED and
  AVAILABLE's NOVELS outside reveal, there inside it) and removed.
- `tests/browse-extensions-select.e2e.ts`: SELECT on EXTENSIONS (c696):
  `?select=1`, a tick, the count, SELECT ALL, a section's TICK/UNTICK, ✕,
  Escape and Back ending it; a mixed cell and one press setting every source of
  each ticked package (a plugin's own id included); the band and its UNDO
  putting a mixed selection back mixed; a ticked row removed elsewhere counted
  as not changed; HIDE leaving the list and UNDO bringing the row back; UPDATE
  narrowed to the selection with BACK TO as its UNDO; and REMOVE's sheet, an
  OBSOLETE row staying installed, and no UNDO. `tests/extensions-select-db.spec.ts`
  holds the transaction, the facts, the language BROWSE does not list, a
  plugin's one id, the refusal whole, and REMOVE's obsolete rule. The frame is
  `tests/browse-extensions-select-frame.e2e.ts`, the tablet's selecting state.
- `tests/source-settings.spec.ts`: each of the five types read from the
  engine's shapes, a value no longer offered not shown as chosen, a form's
  answer stored or refused.
- `tests/tag-search.spec.ts`: a genre in a tri-state group, one matching a
  checkbox, one with no match, an author, case and spacing, no schema, a
  default-on checkbox kept, and every option of every real fixture finding
  itself; each person's namespace against every real fixture's text fields,
  written out, and the comma split (c456); `backOrigin`'s refusals and
  `keepOrigin` (c453). `tests/browse-tags.e2e.ts` and
  `tests/tv-tags.e2e.ts`, on a world of their own (`tests/helpers/tag-world.ts`:
  a fake engine whose manga has an author and genres): a genre lands on
  FILTERED with its chip included and what the source was asked, a search for
  the rest, ← back to the preview (clicked, and its landing read), the series'
  sheet and each door with no
  sheet, the engine down or slow, and the remote's walk to a tag.
- `tests/tv-browse-focus.e2e.ts` (the `tv` project, on a fake engine of its
  own): the focus mark on a catalog tile (c864), on the cover as on a library
  tile, in POPULAR, LATEST, a search, back from a preview by both ways back
  (the remote's BACK, and the preview's own plain ←, after which the catalog
  restores the tile from `data-focus-id`), a forward arrival and a reload
  (neither puts a tile back; the forward visit starts at the top), a tag round trip and
  two of them
  (every ← lands on the screen it names, never on the tag search it shares a
  path with), a tag search opened by address with `from=` and none behind it
  (and after a reload), and under FILTER's scrim.
- `tests/source-flags-db.spec.ts`: a source's own switches (card c435): the
  rows they are kept in, `sourceIdSql` against `sourceOfKey` on every key,
  HIDDEN SOURCE at BROWSE, RECENT, EXTENSIONS (a package, and a plugin's
  INSTALLED rows, UPDATE ALL's set and AVAILABLE's NOVELS), both searches and SAME TITLE,
  and OFF HISTORY's rows, total and the log it leaves alone. ADDED HIDDEN per
  family in `tests/engine-backend-db.spec.ts`, `tests/anime-source-db.spec.ts`
  and `tests/novel-source-db.spec.ts` (a browsing record, then ADD; ADD
  alone; the switch off). `tests/browse-source-flags.e2e.ts`, on its own tag
  world: the page's rows, and each switch followed to the screens it
  changes.
- `tests/browse-flow.e2e.ts` and the generated `tests/browse-frame.e2e.ts`
  (a source's page) and `tests/browse-list-frame.e2e.ts` (BROWSE),
  in the `browse` project against a fake engine (`tests/browse-setup.ts`,
  [`TESTING.md`](TESTING.md)).

## Where it departs from the handoff

- **AVAILABLE's LANGUAGE cells and ADULT row became FILTER** (2026-10-31):
  the handoff drew the languages as cells in the search bar with ALL, and
  ADULT inside reveal only. The owner asked for a choice of several languages
  and more filters; they went into the library's own filter panel rather than
  a new dropdown, so no new design was needed.
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
- **A novel source's SETTINGS holds only tsundoku's switches** (card c435;
  until wave 20 it had no SETTINGS cell), and its search box doesn't offer
  "with its filters": LNReader's search takes none ([`NOVELS.md`](NOVELS.md)).
  Its section is NOVELS, numbered after the others like any section.
- **A multi-select without script has a SAVE.** The mock draws ✓ cells only;
  without script nothing would send a tick.
- **The end of a list says "48 IN ALL"** and drops the MORE row, which the mock
  doesn't draw.
- **SELECT's cells always say what the next press does** (c696; the handoff's
  own slip, and the card names it): every second line ends `TAP: ALL ON`,
  `TAP: ALL OFF`, `TAP: SHOW ALL` (HIDDEN inside reveal), or `SOURCES NOT
KNOWN`; the drawing leaves the line off some states.
- **A FAILED extension whose listing names sources can still be switched.** The
  board says a failed row's sources are not known; in the engine they are the
  repository listing's (`setSources` runs even when the load failed), so the
  press follows them and only an extension with no source row at all reads
  `ITS SOURCES AREN'T KNOWN`.
- **The frame pins the labels it can draw.** The browse world's seeded packages
  have no repository listing, so they are all NEEDS A HAND: the frame asserts
  the tab row, one section label and its right-hand cell, and the bulk bar and
  its four switch cells. The other two labels are the same `.label` markup and
  styles, which the map does not repeat.

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
  band, if it hasn't begun by the time the page asks. A novel is the exception
  (c152): the app knows its own solve the moment it starts, so the check band
  is there during the first one, not only after it.
- Anime sources' filters are asked under their anime name
  (`filterSchemaAnime`, through `callSource` since c154;
  [`ANIME.md`](ANIME.md)), and novel sources are LNReader plugins with their
  own filters ([`NOVELS.md`](NOVELS.md)), so a tag finds its genre on either
  as on a manga source ("Arriving from a tag").
- **A text filter inside a group can't be set.** The engine reads a group's
  text child from the child's name, which is also how it finds the child.
  None of the nine sources has one; it's dropped from the schema.
- **Two filters with the same name** can only be told apart by their order;
  the engine matches by name, so the second can't be set.
- Long select rows wrap without a rule between their lines.
- The ✓ in a checkbox falls back from Plex Mono, as the design README's known
  gap says of `▶ ✕ ● ○`.
