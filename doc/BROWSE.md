# Browsing sources

BROWSE is where a series is found without knowing its title: a source's
popular and latest lists, its own filters, and a search inside it. It is built
on tsundoku's own extension engine ([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md),
[`DOWNLOADS.md`](DOWNLOADS.md)), not Suwayomi. Behind it sit the extensions and
repositories that supply the sources, and each source's settings.

## BROWSE

`/browse`. The bar is ← (the library), BROWSE, a hint that opens SEARCH THE
SOURCES ("/ search every source"), and EXTENSIONS over its count of updates
waiting (MANAGE when there are none, rather than "0 UPDATES"), as QUEUE counts
chapters. Then the sources, one list with the kinds as sections: **01 —
RECENT** (the last four browsed, any kind, "MANGA · EN · BROWSED 2 H AGO";
nothing to pin or manage), then **MANGA**, **ANIME** and **NOVELS**, a section
only where it has a source. Read from tsundoku's own tables, so it draws while
the engine is down. The sections are the source families (Mihon's, Aniyomi's,
LNReader's), each the kind its family names a row by (`SOURCE_KINDS` in
`src/lib/library/kinds.ts`), not a list of kind names. NOVELS is numbered after
the others like any section.

**The KIND band.** Under the bar, the library's band over the sources: **KIND
· ALL n · MANGA n · ANIME n · …**, `?kind=<kind>` in the URL, sticky under the
bar as the library's is. A cell counts sources, as reveal lets them be seen. A
source's kind is its own, the one SEARCH THE SOURCES asks (`kindOfSource`: the
kind set on its settings page, else its family's), so a Mihon source marked
MANHWA is under MANHWA and an Aniyomi one marked SHOWS under SHOWS, while the
sections stay the families. A kind narrows RECENT and every section to the
sources serving it; ALL is the whole list. A word that names no kind a source
here serves is ALL (`kindAsked`, shared with SEARCH THE SOURCES' band), never a
band with nothing under it. With one kind or none to tell apart the band isn't
drawn. The phone drops the KIND label for room, as the library does. It is
neither pinned with a shelf's name nor carries FILTER: BROWSE has neither.
`tests/browse-anime.e2e.ts` holds it.

**Which sources.** Those in the chosen languages (the `browse_languages`
setting, `en,ja` by default; SETTINGS › 07 — BROWSE › LANGUAGES), an
extension's `all`/`multi` sources, and any other the library reads from (a
series from MangaDex's French source keeps that one listed). Listing every
language would be forty-odd rows of MangaDex. **An extension with no source
in those languages shows all of them**: it was installed on purpose, and an
installed source missing from BROWSE reads as broken. Where an extension has
more than one source listed, each says its language: "MangaDex · EN".

**A row** is the extension's icon, the source's name and a line: its language
and how many series the library has from it, as reveal lets you see them
("41 SERIES HERE"; inside reveal, "126 SERIES HERE, 112 HIDDEN"). A source the
engine refused is drawn as a failed row (a 3px ink rule on the left, the reason
in a word, "FAILED TO LOAD · PROTOBUF · TRY AGAIN IN EXTENSIONS") and leads to
EXTENSIONS rather than to a page that can't answer. A mostly-hidden source,
and one whose own HIDDEN SOURCE switch is on ("A source's own switches",
below), is only listed inside reveal, with HIDDEN on its icon.

**Icons** come through `/api/browse/icon/<package>`: the server fetches the
repository's icon once, keeps it beside the APKs as an 80px WebP
(`<ENGINE_STORE>/icons`), and serves it from then on, so the viewer's browser
never asks the repository's host, and a repository that dies keeps its
icons. An extension whose every source is mostly hidden (or switched to
HIDDEN SOURCE) answers 404 outside reveal.

**RECENT** is migration 42's `browse_recent` table, a row a source, moved to
now on each visit to its page; a visit in incognito leaves nothing. Who may see
a row is decided when it's read, so a hidden source browsed inside reveal is
only in RECENT inside reveal. Its times are the app's own (`ago()`, as
TRACKING uses it: "BROWSED 2 H AGO").

**RECENT folds.** Its label is a toggle: `01 — RECENT · LAST BROWSED  HIDE ↑`,
and folded `01 — RECENT · 4 RECENT SHOW ↓`, so a folded RECENT still says how
many. Open by default, remembered for the device in one localStorage key,
`tsundoku:browse-recent` (`folded`, or nothing;
`src/lib/library/browse-recent.ts`). The series screen's DETAILS fold is the
idiom, but DETAILS is closed by default, so its server draws the default and
only an opened device changes once the page runs. RECENT is open by default,
and a device that folded it must not see it open and then shut on every load.
So BROWSE's `<head>` carries a few bytes of script (`PREPAINT`) that the
browser runs before it parses the body on a document load (a reload, a
bookmark, a new tab): it marks `<html>` with `data-recent-folded` when the key
says folded, and the stylesheet folds the rows and swaps the label's words from
that mark, so the server's open markup is painted folded from the first frame.
An arrival inside the app runs no head script (an inserted script is inert)
and needs none: the page reads the key as it mounts, before the frame is
painted, and puts the mark in step (another tab may have changed the key since
this document's head ran); the toggle keeps the mark in step too. Without
script nothing folds and the toggle's words are not drawn (a `<noscript>`
rule). The label is a button, one stop on a TV, and OK toggles it; folded, its
rows are not stops. **Its accessible name is `01 — RECENT · LAST BROWSED`,
whatever its state** (`aria-expanded` says which): `HIDE ↑` and `SHOW ↓` are
only its drawn words, since HIDE and SHOW are words other buttons in the browse
world are found by (reveal's HIDE AGAIN among them), and a locator matches a
name by substring. MANGA, ANIME and NOVELS do not fold: theirs would cost a key
each and a rule for a section that is most of the screen. Tested in
`tests/browse-recent.e2e.ts` (fold, reload, unfold, the first paint with the
app's script blocked, arrivals inside the app, another tab's change),
`tests/tv-browse-recent.e2e.ts` and `tests/browse-recent-domain.spec.ts`.

**The ways in.** A BROWSE cell on the library's tablet bar, before QUEUE;
BROWSE in the desktop sidebar's foot, under HISTORY, with the update count
("5 ↑"); and the empty search, which offers it first: BROWSE A SOURCE with the
last three, then ALL SOURCES · BROWSE with the number of sources. The phone's
bar has no room for a BROWSE cell, so the empty search is its way in; the
offer is on every device, since it costs nothing elsewhere and keeps the empty
search from being empty.

ADDED TO THE LIBRARY, AND HIDDEN and CONCEAL's band carry a ✕ that clears them
from the URL; a source not answering does not ([`BANDS.md`](BANDS.md)).

### Commands in every top search bar

Every bar that draws a leading `/` as its prompt runs the library's commands,
not only `/search`: SEARCH THE SOURCES (`/downloads/search`), a source's own
search, and EXTENSIONS' AVAILABLE search. `parseBar`
(`src/lib/library/search.ts`) is the one parser: a command or a page
(`/settings`, `/help`, `/highlights`, and their words) is that, a `/`-led
string that names neither is `unknown` and is said plainly, and everything else
is the bar's own filter. `runSearchCommand` (`src/lib/library/commands.ts`)
posts a command to `/api/command`, which calls the same `runCommand` the
library's `?/command` does. A refusal is shown by the bar and its list does not
change. A TV has no fingerprint and no screen lock, so it refuses `/reveal`
from every bar in `/search`'s own words ("NOT ON A TV · TURN REVEAL ON FROM THE
COMPUTER"), before anything is asked of the server, and no bar turns reveal on
there (`doc/TV.md`). A command that runs leaves the screen where it was and
re-reads its loads (the reveal or incognito band appears); `/settings`, `/help`
and `/highlights` open their page (`/highlights lamp` with the word in its
search), and `/lock`, `/unlock` and, behind the fingerprint gate, `/reveal`
open `/search?q=…`, since the device prompt is that screen's. A gated
`/reveal` then ends where `/search`'s own does, on the library, because the
ceremony's last step is that navigation: unlike the plain `/reveal`, it does
not return to the bar's screen. The `go` intent travels in history state, not
the URL, and `/search` submits on arrival only for those three, and only when
the state carries it: a typed or shared `?go=1` link is taken off the URL and
runs nothing, `/search?q=%2Freveal&go=1` included. The state is emptied before
the command is submitted, so the entry cannot run it twice: a back or forward
onto it, or a reload, asks nothing; only a new key press does. A press counts
once. `runSearchCommand` runs one command at a time across the bars, so a
second Enter while one is running sends nothing and pushes no second entry
holding the intent (an unknown command and a TV's refusal still say so, since
neither asks anything). On `/search`, a press while the device prompt is
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
differ from the source's own; the FILTERED tab itself carries no number. Then
the library's grid, at the library's `--grid-cols` for the width: six columns
on the tablet, three on the phone. The grid's rules are drawn by each tile
into the gap rather than by the grid's background, so a short last row ends in
page, not grey, with no filler cells (the library counts filler cells in
script; this page draws without it).

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
SCROLL" only once script runs. At the end of a list the MORE row goes and the
label says "48 IN ALL". Twenty pages at most. **One page at a time**: while
one is asked for, MORE ↓ is dimmed and a click on it does nothing, since
every extra click would only queue more calls at the source. **The next page
adds, it does not redraw** (measured): `pages` is not part of the list's key,
so the answer already drawn stays while the next one is asked for, the tiles
are keyed by their result (`{#each … (h.mangaId)}`), and the source is asked
only for the page that is new (0 calls for pages 1 to N, measured at the
20-page cap). The covers are the browser's own cache, not a second request:
`/api/downloads/engine-image/<token>` sends `private, max-age=86400` and the
token is the engine's, the same one on every draw, so a list drawn again asks
for none of the covers it already showed (measured: 0 of 259). What looks like
"downloading every cover again" is the list being drawn again.

**A way back comes back to the place.** From a preview, by the browser's back,
Android's edge swipe, a TV's BACK or the preview's ←, the list is the one that
was left — `?pages=N`, its tiles in order, and the scroll — with no page asked
of the source again inside the fifteen minutes its answers are kept. Two
records, one per way back:

- a **popstate** restores the history entry's own SvelteKit snapshot: the
  list's key, how many tiles it had drawn (and whether its MORE ↓ row did) and
  the scroll (`snapshot` in `src/routes/browse/[source]/+page.svelte`, the
  library's arrangement);
- the **preview's plain ←** is a forward visit, so it has no entry to
  restore. The one departure toward a preview writes a record
  (`tsundoku.browse-left`): the same things and the address it was left at,
  and only a link arrival from the preview reads it, once (it is taken, so a
  stale one is never applied twice; an arrival at another address, which the
  tags share the path with, leaves it for the preview's own ←). A preview
  reached any other way leaves none, and ← then opens the top.

**What a way back draws is this visit's own answer, never the kept list.** The
answer drawn when the list was left is the list as it was then, and a result
of it may have become a hidden library series since — an ADD on a source that
adds hidden, a HIDE on its own screen, a HIDE on another screen entirely — and
drawing it again, title and cover, until this visit's answer arrives would
break "hidden means hidden" (a result that is a hidden series isn't sent). So a
restore draws **an outline the kept list's size** (`KeptOutline`: as many
empty cells as it had tiles, and its MORE row, no title and no cover), sets the
scroll on it, and this visit's own answer — which the server filtered for this
visit — draws in its place. The page is therefore as tall as the place before
the answer streams in, so the scroll is where it was when the answer lands, and
the next frames of the settle keep it there (two seconds, given up the moment
the reader scrolls or presses). The covers come from the browser's own cache
either way, so nothing is fetched again. A kept answer is also never stale in
any other way — a series added since the capture is not drawn with the old
marks — because none of it is drawn.

A **reload** uses the URL's pages and the browser's own scroll, because a
snapshot is restored only for a popstate, not while a document boots; a
**forward visit** opens at the top. The key carries reveal and incognito, and a
list drawn under either writes no record at all, so nothing of a revealed list
outlives reveal's end (`doc/PRIVACY.md`).

**A preview loads on tap, not hover.** A preview asks the source for details
and episodes, one call at a time per extension, and the app preloads links
on hover: twenty tiles passed over queued forty calls ahead of the one
opened, which then sat on ASKING THE SOURCE… for 43 s, and stalled MORE
behind them. Tiles and search results set `data-sveltekit-preload-data="tap"`.

**A tile** is the library's (cover, title, a meta line). IN LIBRARY is the
accent badge in the cover's top-right corner, and a tap opens the series;
HIDDEN, top-left, only ever inside reveal. Both are the library's Badge at
12px, the same badge as FAV's in FAV's corner, since one badge size runs across
the app. A twin from another source is the meta line in ink, `SAME TITLE · FROM
ASURA SCANS`, and only of the same kind of source (`libraryIndex`'s
`sameTitle`): a manga matches manga, a novel novels, an anime anime, since an
adaptation under the same name isn't a copy from elsewhere (an anime on an
anime source would otherwise read SAME TITLE · FROM a manga source). A twin is
known by every name a series goes by: its title and the members of its
`alt_titles`, where a rename keeps the old name, so a source still calling a
renamed series by its old name still reads SAME TITLE. Where one series is
titled so and another only was, the titled one's source is named. Anything
else opens the source's preview (`/downloads/source/<manga>?from=<this
page>`), whose back cell then says BROWSE and returns here.

### The add replaces the preview

**+ ADD TO LIBRARY and ADD AND DOWNLOAD end the preview, so they take its
history entry.** Both follow their redirect with `replaceState`
(`settleReplacing`, `src/lib/back.ts`), as an action that ends a screen does:
one swipe back from the new series lands on the catalog it was found in, at
the place kept above, not on the preview a second time. Pushed, it would cost
two swipes, and the second would open a preview of a series that is now in the
library (which redirects to its series). The band's **UNDO** ends the series
in turn, so it replaces the series' entry as well and lands on the preview
with the origin put back (`?from=`): one swipe back from the preview is the
catalog, and the preview's ← says BROWSE ([`SERIES.md`](SERIES.md), "The ADDED
band's place in history"). **Without script** a native POST's 303 is a full
navigation, which no page can replace: ADD and UNDO cost two swipes there.

**The hidden band's UNDO is the same one.** When the ADD hid the series the
band is the source's page's, or BROWSE's once the source is mostly hidden, and
there is no series screen to come back to: its UNDO replaces that landing's
entry too, and hands the preview the catalog the ADD recorded (a `catalog` band
parameter, written by `addedLanding`), so the preview's ← says BROWSE and one
swipe back is the list at the place it was left. Only an ADD the catalog itself
carried records one, so a shared link's preview gets no `from=` from it and ←
still says SOURCES, where the entry was never found
(`src/routes/browse/added.server.ts`, `afterUndo`; `doc/SERIES.md`, "The ADDED
band's place in history").

The preview of a series already in the library redirects to the series (the
load in `src/routes/downloads/source/[id]/+page.server.ts`), so a shared
preview link opens the series.

### Arriving from a tag

An author, an artist or a genre on a source's preview, and a tag on a library
series (through its sheet, [`SERIES.md`](SERIES.md), the TAGS row), open the
source's page finding it. `src/lib/library/tag-search.ts` builds the address
from the source's own filters, and is pure and tested over the five real
schemas (`tests/tag-search.spec.ts`):

- **A genre or a tag the filters name** -- a tri-state or a checkbox whose
  name is the value's, case and spacing aside ("slice of life" is "Slice of
  Life"), inside a group or not -- is `tab=filtered` with that one included
  (`f<i>.<j>=1`) or ticked. The rest of the form is written out at the
  source's own defaults, because on FILTERED the URL is the whole form: a
  checkbox the source has on would otherwise turn off. A tri-state wins over
  a checkbox of the same name, and the first in the schema's order over a
  second group naming it too. A select, a text or a sort never names a genre.
- **A person** (author, artist, circle) **fills the source's own text filter
  named for them**, on `tab=filtered` with the rest at the source's defaults:
  the first top-level text field whose name, a trailing bracketed note aside,
  folds to the namespace (mangahere's Author and Artist, Weeb Central's
  "Author (Case-sensitive)"; `matchPersonFilter`). Most sources' plain search
  reads titles only, so `q=` finds nothing by an author. A source with no such
  field (three of the five real schemas, and every artist on Weeb Central) is
  still a search for the name.
- **Everything else is a search**, `q=<value>`: a value no filter names, and
  a source with no schema.
- **A genre is drawn as the source spells it**: `Action` and `action` from one
  source are two values, each its own link, searched as it is written; the
  preview does not lowercase the label, which would draw them as `action ·
action`. The list keeps each distinct string once (`distinct`), so a genre
  named twice in the same spelling is one link. The series screen's TAGS row
  draws its values as stored too.
- **One link a person** on the preview (`previewPeople`, `splitPeople`): a
  source's author and artist strings are split as the importer splits them
  into tags (`people`, `src/lib/import/mihon-plan.ts`: commas, `/`, `;` and
  `&`), so each link is a tag its series carries once added. Each name is
  its own link, searched on its own. A part that is only a generational
  suffix ("Jr.", "Sr.", "II", "III", "IV") stays with the name before it, so
  "Tanaka, Jr." is one person, and the importers make it one tag too
  (`people` holds the rule). A name written surname-first ("Oda, Eiichiro")
  cannot be told from two people, and is two links. A name on both lines is
  drawn once, as an author. A library series' person tags were split by the
  importer when they were written, and stored tags are not rewritten, so a
  series whose tags an older importer wrote may still carry `author:Jr.`
  beside `author:Tanaka`.
- **"No schema" is never a kind.** An Aniyomi source answers
  `filterSchemaAnime` (asked under its anime name through `callSource`;
  [`ANIME.md`](ANIME.md)) and an LNReader plugin its own filters
  ([`NOVELS.md`](NOVELS.md)), so every family is asked the same question and a
  tag finds its genre on any of them as on a manga source; an empty schema, or
  a call that failed, is a search.

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
have come (a quick tap, or ↓ OK on a TV) still lands on the filter. A link to
the route is a full navigation (`data-sveltekit-reload`); the series sheet
stays open while it waits. **The wait says so**: up to `TAG_SCHEMA_WAIT_MS` on
a cold source, with no loading bar on a TV's WebView, so the link tapped on the
preview is `aria-busy` and underlined, with `FINDING <SOURCE>'S FILTERS… · A
FIRST CALL TAKES UP TO 20 S` under the TAGS row, and the sheet's IN <SOURCE>
row is `aria-busy` with `FINDING <SOURCE>'S FILTERS…` as its second line.
`pageshow` clears both, for BACK from the bfcache. A BACK that is not from the
bfcache draws the page again, so a test of BACK alone would pass with the clear
removed; `tests/browse-tags.e2e.ts` pins each clear with a `pageshow` sent with
`persisted: true` to the page that set the mark, its navigation held.
`filterSchema` keeps the answer per source (`keep`), so after the first tap the
wait is nothing, and the source's page answers from the same cache.

**Back returns to where the tag was.** The link carries `from=` with the
preview's or the series' own address, query included, and the source page's
← goes there (`backOrigin`: only `/downloads/source/<id>` and `/series/<id>`,
never another host or screen, as `sourceOrigin` refuses an open redirect).
That ← and the preview's own are plain links, never back links: a source's
list and its tag search share the path `/browse/<id>`, so a back link's
path-only match would step onto the tag search the reader came through, and
the two ←s would alternate between it and the preview for good. A
`use:backLink` here cannot work either, because a tag page is a native
navigation (its `tag-search` route is a server route) and the app's history map
begins again there. The preview's ← names the list it was opened from, and the
catalog puts the tile's focus back itself when that ← brings it back, and only
then: `restoreFocus` reads the `data-focus-id` `saveFocus` noted for that URL,
as on a popstate, while a list left by touch or mouse saved none. It puts the
**place** back with the focus too (above): the departure toward a preview left
the list's key, how many tiles it had drawn and its scroll in
`tsundoku.browse-left`, and that ← is the one arrival that reads it — drawing
an outline of that size, never the kept tiles, until this visit's own answer is
there. A forward visit starts at the top with no tile held, and a reload puts
no tile back either (its scroll is the browser's own, SvelteKit restoring it);
neither is a way back.

**Every way to another list of the same source keeps the origin**: POPULAR and
LATEST, the search field (a hidden `from`), FILTER's APPLY (a hidden `from`)
and RESET, paging and the panel's toggle (`link()` keeps every parameter), and
SETTINGS, whose ← and rows carry it back (`keepOrigin`, tag-search.ts). Only
the value `backOrigin` accepted is carried, never the raw parameter.
`tests/browse-tags.e2e.ts` walks every one of those ways; LATEST is tapped in
`tests/browse-flow.e2e.ts`, whose source has a latest list.

### Filters

The engine describes a source's filters as a typed list (`filterSchemaManga`,
the engine fork's; [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md), "API
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

A sort's order is two cells, ↓ and ↑, rather than one cell that flips, since
flipping takes script and the panel works without. A top-level checkbox has no
row label: a source gives a checkbox only its own name, so the label column
stays empty and the box carries the name. A group of selects (MangaDex's "Tags
mode": included and excluded) is a row per select.

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

A novel source's search box doesn't offer "with its filters": LNReader's search
takes none ([`NOVELS.md`](NOVELS.md)).

### Waiting, and without script

Everything the source has to answer comes as one streamed promise (a
`Settled`, which never rejects, `src/lib/library/settled.ts`), so the bar and
tabs draw at once and a slow site fills in after, over the grid's loading
outline.

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

Covers come through `/api/downloads/engine-image`, which sends the library's
400px WebP thumbnail rather than the source's bytes: MangaDex's default sends
its original scans, up to 2.8 MB a cover (measured), and a page of the grid
asks for twenty.

### Hidden means hidden

A source whose series here are mostly hidden ([`PRIVACY.md`](PRIVACY.md)), or
whose own HIDDEN SOURCE switch is on, answers 404 with reveal off, and so does
a preview of one of its series, its settings, and a tag's search on it. Both
are one field, `BrowseSource.mostlyHidden` (with `hiddenSource` saying which),
so every place that asks it (BROWSE, RECENT, EXTENSIONS, the icons,
`/search`'s list, the check's poll) closes for both. EXTENSIONS asks it for
LNReader's plugins too, whose own lists (`pluginView`, `pluginsAvailable`)
list every plugin: the route filters them through `pluginsHidden`,
`pluginsShown` and `novelsAvailable` (`src/lib/server/engine/manage.ts`), so a
hidden plugin is not on INSTALLED, not in its count, not in UPDATE ALL and not
on AVAILABLE's NOVELS tab outside reveal. A result that is a hidden series
isn't sent. Counts are what reveal lets the viewer see: a shown plugin's "N
SERIES HERE" on INSTALLED counts only its visible series outside reveal, and
inside reveal says how many are hidden ("2 SERIES HERE, 1 HIDDEN"), as a Mihon
package's does (`pluginView(reveal)`). These read the app's database:
`novelsAvailable` takes no `db`, since `pluginsHidden` would then read the
switches from another one. A twin of a series from such a source is still
SAME TITLE IN LIBRARY (the series is visible), but the source isn't named:
"FROM <SOURCE>" would say what reveal hides. SEARCH THE SOURCES follows the
same rule (`libraryIndex().nameable`).

### SELECT in a catalog

**SELECT** on a source's page ticks as many results as wanted while browsing,
then adds them to the library, and downloads them, in one press.

**Starting and ending.** SELECT is a cell in the source page's bar, before
SETTINGS (after `/` on a phone, where SETTINGS then says SET.). It needs
script, so it is drawn once the page runs, and a TV draws none (the
`(pointer: none)` query). Selecting turns the bar inverse: `✕ · N SELECTED ·
SHOW · / SEARCH <SOURCE> TO TICK` (`/` alone on a phone), with `· 2 SOURCES`
beside the count on a tablet and a desktop once two sources are ticked.
SETTINGS is left out while selecting (its switches, HIDDEN SOURCE and ADDED
HIDDEN, change what a press would do), and the source's name moves to the head
of the tab row (`IN MANGADEX · MANGA · EN`; the name alone on a phone). There
is **no SELECT ALL**: a catalog has no end ("never a total the source doesn't
give"), and every tick is a request at the press. SELECT ends on ✕, on Escape
once no sheet and no FILTER panel is open (those close first), on a press, on
a reload, on reveal turning on or off, and on leaving the browse world (the
library, a series, settings, a source's SETTINGS, the queue). Escape is the
one difference from the library's SELECT, which stays on through Escape.

**A tap ticks, and opens nothing.** A tile becomes a button
(`aria-pressed`): an empty box top-left (GROUP's check, where HIDDEN would
be), filled accent once ticked, and the cover's 3px select ring. So selecting
asks the site nothing until the press. **A long press** (or a right-click)
opens the preview in this tab, and its ← comes back still selecting.

**What can be ticked** is only what the press could add (`tickable`,
`src/lib/library/browse-select.ts`): **IN LIBRARY** (and, inside reveal, IN
LIBRARY + HIDDEN) is dimmed to 0.4 with no box, its badge kept, and takes no
tap; **ADDING**, a series being added right now, is the same with the ink
ADDING badge in IN LIBRARY's corner. **SAME TITLE · FROM …** is tickable (it is
another source's copy, which may be wanted), and the bulk bar counts it.
A result is ADDING while this tab's press still has it to add, or while any
add of it is running on the server: `addToLibrary` (`server/downloads.ts`)
marks its result for as long as the add runs (`whileAdding`,
`server/engine/adding.ts`), so a preview's ADD in another tab shows too, and
`shelf` says so on each answer (`SearchHit.adding`). Outside SELECT the page
draws no ADDING and is otherwise the same.

**The lists stay live.** POPULAR, LATEST, FILTERED, FILTER (the panel and
APPLY), the source's own search and MORE all keep working while selecting, and
the ticks stay through them; a ticked series the list on screen doesn't draw is
still held, and SHOW lists it. **A tag's arrival** keeps it too: a tag on the
preview is a document load (`data-sveltekit-reload`, since `tag-search` is a
server route), which would end a selection held in the tab's memory, so while
selecting the preview asks `tag-search` for the address
(`accept: application/json`, answered `{ to }`) and goes there inside the app.
**Other sources and BROWSE** keep it as well: BROWSE draws the selecting bar
(with no search hint, since BROWSE has no one source to search), and each
source row says how many of its series are ticked (`MANGA · EN · 9 TICKED`, in
ink). The selecting bar has no ←: BROWSE is reached by the browser's or the
phone's back, and a source opens still selecting.

**Where a selection lives.** In this tab's memory and nowhere else: never the
URL (a link or a new tab must not arrive selecting) and never history state (a
reload ends it). That is the library's idiom (`carrySelection` /
`takeCarried`, `src/lib/library/selection.ts`), held here once, in one module
(`browseSelection`, `src/lib/library/browse-selection.svelte.ts`), rather than
handed from screen to screen: the selection lasts across three screens (BROWSE,
every source's page and a preview) and a run outlives each of them. Each screen
of the browse world ends it from its `beforeNavigate` when the navigation
leaves the world (`follow`, `BROWSE_WORLD`), and a reload needs nothing, since
the module's memory does not survive one. Only the browser writes it; on the
server the module is shared by every request, so every write refuses to run
there. Each tick keeps its facts when it is ticked (`Tick`: title, cover, the
source and its ADDED HIDDEN switch, SAME TITLE, and where it was ticked), as
the library's `Picked` does, so SHOW and the bulk bar never read them off the
tiles on screen.

**SHOW** (`TickSheet.svelte`) lists the whole selection grouped by source,
each group in the order it was ticked, with what the list on screen doesn't
draw counted in the group's head (`4 NOT IN THE LIST YOU ARE ON`). A row's box
unticks it and a second tap puts it back; rows stay until the sheet closes.
A row says where it was ticked: `TICKED IN POPULAR`, `TICKED IN LATEST`,
`TICKED IN SEARCH "solo"`, `TICKED IN GENRE: ACTION` (a filtered list whose one
change from the source's own choices is an included tri-state or a ticked
checkbox: a tag's arrival, `oneTag`), else `TICKED IN FILTERED`.

**The bulk bar** (`PressBar.svelte`) is a line, then three cells: **ADD TO
LIBRARY** (`9 SERIES · NOTHING DOWNLOADS`), **ADD + FIRST 10 EACH** (accent,
the common case; `UP TO 90 CHAPTERS`, chapters and episodes counted apart) and
**ADD + ALL**, which asks first. These are the preview's ADD and its two
DOWNLOAD cells, for many; FIRST 10, not NEXT 10, since nothing of a catalog's
series is on disk yet ([`DOWNLOADS.md`](DOWNLOADS.md)). The line counts what
the press will do (`pressLine`): `14 TO ADD`, the kinds when there are two or
more, each source's count with two sources, `1 HAS A TWIN IN LIBRARY`, `WEEB
CENTRAL ADDS ITS 3 HIDDEN` for a source whose ADDED HIDDEN switch is on, and
the ticks the list on screen does not draw (`4 OF THEM TICKED IN LATEST`); at
its right end the one source's name, or `2 SOURCES`. A phone's line says less
(`9 TO ADD · 1 TWIN IN LIBRARY`, `1 SOURCE`) and its cells are `ADD`, `ADD +
10`, `ADD + ALL`. With nothing ticked the cells are dimmed and the line says `A
TAP ON A TILE TICKS IT`. Nothing else belongs in it: FAV, RATE, GROUP, HIDE,
DELETE, REFRESH and FOLLOW act on series already in the library, whose own
SELECT does them once they are added.

**ADD + ALL asks with a plain sheet**: `ADD 9 SERIES AND DOWNLOAD EVERY
CHAPTER?`, what ALL queues (every chapter or episode, never one already read,
nothing twice), and that the count is known only as each series is asked;
CANCEL and `ADD 9 + ALL`. It gives no totals and no size: counting would ask
every series' details before the press, which is the press's own work, so it
would be done twice. ADD and ADD + FIRST 10 EACH ask nothing first.

### The press

**One press, one run, a lane per source** (`runLanes`,
`src/lib/library/browse-press.ts`): every source's series are asked at once
across sources, one at a time within a source, in the order they were ticked,
so a slow site doesn't hold a quick one up and no site is asked twice at once
by a press. Each series is one request to `POST /api/browse/press`
(`pressOne`, `src/lib/server/browse-press.ts`), which:

- checks again **now**: a series IN LIBRARY since it was ticked (another tab, a
  preview) is skipped, and so is one another request is adding; both are said
  in the result (`2 SKIPPED · 1 WAS IN THE LIBRARY BY THEN · 1 WAS ALREADY
BEING ADDED`). A stale tick that became a hidden series (added hidden from
  another tab while reveal is off) is skipped and said as `WAS IN THE LIBRARY
BY THEN` like any other: that title was ticked by the viewer, so the line
  hides nothing they did not already know, and saying nothing would make the
  press's count not add up;
- adds it through the same add as a preview's ADD, `addToLibrary` (the
  families' `addNovel` / `addAnime` / the engine's, `keepOrPromote` within),
  watching whether this add hid it (`addWatchingHidden`);
- for FIRST 10 or ALL, queues it through the queue's own `queueSeries` with
  `next` (what the preview's ADD AND DOWNLOAD's FIRST 10 asks) or `all`. An add
  that stands while the queue doesn't answer is still an add, said as `SOME NOT
QUEUED · DOWNLOADING ISN’T ANSWERING`.

A failed series is asked **once more at the end of its lane**, then left NOT
ADDED with its reason in a word (`REFUSED`, `DID NOT ANSWER`, `IS NOT AT ITS
SOURCE`, `WAS DELETED HERE ONCE`, `IS ANOTHER SERIES HERE`, `FAILED`). A series
deleted here once, one whose chapters are another series', or one its source
does not have would answer the same again, so it is not asked twice. **One
press at a time**: while a run is adding, ticking goes on but the bulk bar's
cells wait (`ONE PRESS AT A TIME · THE BAND SAYS WHEN IT ENDS`), since the band
holds one run and a second would replace its band and take its UNDO away.

**One band** (`PressBand.svelte`), under the bar of every browse screen while
this tab has a run: `ADDING 14 SERIES`, an ink progress line, and the lanes
(`MANGADEX 6 OF 9 · ASURA SCANS 2 OF 5`). Then **one result**: `ADDED 14 SERIES
· 140 CHAPTERS QUEUED`, or `ADDED 11 OF 14 · 110 CHAPTERS QUEUED` with `3 NOT
ADDED · ASURA SCANS REFUSED 2 · KAGURABACHI DID NOT ANSWER` and **RETRY 3**,
which asks the failed ones again in their lanes, in the same band. All added,
its line names each source's count and the shelves chosen (`MANGADEX 9 · ASURA
SCANS 5 · ON LATER`). When it ends, the screen's loads are read again, so the
tiles say IN LIBRARY. ✕ closes it.

**PUT ON A SHELF** is the ADD band's chips ("Shelves in the ADD band", below),
applied to the whole press, and live from the run's start: a chip chosen while
it runs reaches every series added after it, as well as those already added
(`POST /api/browse/press/shelve`, `shelvePress`, the SHELVES sheet's own
write). The last chip chosen on this device is first, as on the ADD band.

**One UNDO for the press** (`POST /api/browse/press/undo`, `undoPress`) takes
out every series of it with nothing downloaded or read, and its queued
chapters with it (the queue's rows go with their series), through `undoAdd`.
A series is trusted only while its id and its key are still the ones the press
added (`addedHere`), since an id is reused once its series is gone. Before it
is pressed the band says what it would leave (`UNDO 12`, `2 HAVE A CHAPTER
DOWNLOADED NOW · UNDO LEAVES THOSE 2`; asked when the run ends and every ten
seconds while the band is up, `touchedOf`), and after it what it took and what
stayed (`UNDONE · 12 TAKEN OUT, WITH THEIR 120 QUEUED CHAPTERS`, `2 STAY:
SOMETHING OF THEM IS DOWNLOADED OR READ · THE LIBRARY'S DELETE TAKES THEM
OUT`).

**A tab closed mid-run.** The run belongs to the page, but every series is one
request and one add, so each is either added whole, with its queue, or not
asked at all. The one being asked when the tab closes finishes on the server.
What is lost is the band, its UNDO and its shelves for the series added so far:
they stay in the library, and the library's own SELECT and DELETE take them
out.

### SELECT, hidden, reveal and incognito

- **Reveal off.** A hidden source's page is not found, so nothing of it can be
  ticked; a hidden series in the library is never sent, so no tile is drawn
  for it. No count anywhere says something hidden is held. The server refuses
  a press from a source outside reveal (`IS NOT AT ITS SOURCE`), with one
  exception: a source whose ADDED HIDDEN switch is on (and HIDDEN SOURCE off)
  becomes mostly hidden _by the press itself_ after its first adds, and the
  rest of its lane is still the viewer's own to add (`mayAddFrom`).
- **Inside reveal.** Every source can be ticked, HIDDEN badges as elsewhere,
  and IN LIBRARY + HIDDEN is not tickable. **Reveal turning on or off ends
  SELECT**: a selection never outlives the reveal it was made in. A run started
  inside reveal goes on after it; outside reveal its band counts only what can
  be seen, a run of hidden sources alone draws no band at all, and UNDO there
  takes only what can be seen. The rest waits for reveal.
- **ADDED HIDDEN.** Each series from such a source arrives hidden, as a single
  ADD does, and FIRST 10 queues it. The bar's line says `WEEB CENTRAL ADDS ITS
3 HIDDEN`; the result says `ADDED 14 SERIES · 3 OF THEM HIDDEN`, then `WEEB
CENTRAL ADDS ITS SERIES HIDDEN · 140 CHAPTERS QUEUED · REVEAL SHOWS THEM`,
  or, once the press left the source mostly hidden, `3 OF THEM HIDDEN BY THEIR
SOURCE · THE SOURCE IS HIDDEN WITH THEM · REVEAL SHOWS BOTH`. Inside reveal
  the source is named and the tail goes. UNDO takes them out.
- **Incognito.** Adding and downloading are deliberate edits, like FAV and
  MARK READ, so they go ahead, and a shelf chip and UNDO save.

## A site's check

Some sites sit behind a Cloudflare check, and the engine passes it through
FlareSolverr: the first call takes 20–45 s, and is quick after. The engine
fork records which hosts' checks are being solved and when each last was
(`GET /challenges`, [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)), and
tsundoku asks (`checkingSince`, through `/api/browse/check/<source>`),
matching a host to a source's site by domain, subdomains included.

**A novel is named too.** An LNReader plugin's check is solved by the app
itself, since the plugin host refuses local addresses and a solver is one
([`NOVELS.md`](NOVELS.md), "Past a site's bot check"): the novel's site is its
plugin's (`novel_plugins.site`), the app knows while its own solve runs, and
`solvingSince` joins what `/challenges` says, so every line below is there for
a novel exactly as for an extension. The route is asked wherever BROWSE is:
SEARCH THE SOURCES gates its poller on the downloads backend being the engine
at all (without the engine there is no BROWSE, so no novels either), not on
which of the two is answering a check.

- **On a source's page**, while its first answer is coming, the page asks every
  second (`SiteCheck`, `src/lib/site-check.svelte.ts`). If the engine is
  passing the site's check, the band says so at once, rather than after the
  ten seconds the house band waits: "ASURA SCANS · PASSING THE SITE'S BROWSER
  CHECK", how long it has asked, and that a first visit takes 20–45 s; the
  label says WAITING FOR THE SITE over the grid outline. Otherwise the house
  band comes at 10 s ("STILL ASKING …"). At 60 s an extension's call gives up:
  DID NOT ANSWER, with TRY AGAIN (a novel's waits two minutes, since its first
  call may pass a check the app solves).
- **In SEARCH THE SOURCES**, a source still asking says "BROWSER CHECK · ASKED
  18 S AGO" in its header instead of ASKING.
- **In BROWSE**, a source whose site has needed a check says "FIRST VISIT WAITS
  FOR THE SITE'S CHECK" on its line. The hosts are kept in migration 43's
  `site_checks` table (its own table: a source's rows are rewritten on every
  install), read from the engine whenever a page asks and when BROWSE opens,
  and written directly when the app solves a novel's check.

## Extensions and repositories

`/browse/extensions`, BROWSE's back room, from the EXTENSIONS cell on its bar
and from any failed source's row. Three tabs in the URL (`tab`), every
action a form post, so all of it works without script. The domain is
`src/lib/server/engine/manage.ts` over `extensions.ts`.

**INSTALLED** sorts what needs attention first. **01 — NEEDS A HAND**: an
extension the engine refused (FAILED TO LOAD and the reason in a word, TRY
AGAIN offering the kept APK again) or one no repository lists any more
(OBSOLETE: it still loads and won't update). **02 — UPDATES**, with UPDATE ALL
over the count and NOTHING UPDATES BY ITSELF beside it. **03 — INSTALLED**.
A state is the failed row, a 3px ink rule and the word; no colour is
proposed. A row's line counts its sources as BROWSE shows them ("2 OF 61
SOURCES SHOWN" for MangaDex: the chosen languages) and its series here as
reveal allows; KIND · LANGUAGE names only those languages.

**Updates ask, and can be taken back.** UPDATE (and UPDATE ALL, which reaches
only what's shown, so reveal decides) installs the version the repository
lists now, and the previous one is kept a week: the row offers BACK TO 1.6.2
until then. A source's kept answers are forgotten on either, since what it
lists may have changed.

**Removing says what stays** (the app's ConfirmSheet, one fact a line: "41
SERIES HERE COME FROM IT · They stay in the library…", as every irreversible
action asks; `?remove=<package>` so it opens without script): the series that
come from it stay, files and all; its queued chapters leave the queue and its
followed series stop being checked; its settings are kept for a reinstall.
Counts are what reveal lets you see.

### AVAILABLE

**AVAILABLE** is every repository's listings, one tab per source family (MANGA
for Mihon's APKs, ANIME for Aniyomi's, NOVELS for LNReader's plugins; the URL
says `kind=anime` or `kind=novels`) with its count, a search, and FILTER. The
search ignores case and spacing and matches the extension's name or any of its
sources' (`weebcentral` finds Weeb Central). A multi-language extension counts
only its sources in the languages asked. INSTALL is accent; an installed one
says INSTALLED ✓. 150 rows at a time, MORE ↓ for the next.

**Filters** (`src/lib/library/ext-filters.ts`): FILTER opens the library's
filter panel (`ExtFilter.svelte`) rather than a dropdown of its own, every
choice a link in the URL, so it works without script; choosing keeps it open,
DONE closes it, ✕ CLEAR ALL clears it. A tap before the page hydrates keeps
it open, as the library's does (doc/FILTERS.md): the `<details>` is the truth,
read on mount, followed by `toggle` and closed through the element. It does
not use `bind:open`, whose hydration writes `false` back and shuts the panel
under the finger; `tests/browse-extensions.e2e.ts` taps FILTER with the app's
scripts held back.

- **LANGUAGE** (`?lang=en,fr`): several at once, starting from SETTINGS'
  languages (MINE goes back to them) and only for the visit; SETTINGS stays
  the place to change the default. None ticked is every language. "+ 25 IN
  OTHER LANGUAGES · SHOW" under the list says what a search finds elsewhere,
  and shows it.
- **INSTALLED** (ANY, INSTALLED, NOT INSTALLED), **REPOSITORY** (when there are
  two or more), **18+** (ANY, ONLY, NONE; not for novels, which LNReader never
  marks), **IN LIBRARY** (sources with series here, as the viewer may see them).

**18+ is listed for everyone, marked.** An extension its repository flags as
adult is listed with its 18+ mark, its icon is served, and the 18+ row filters
it, for anyone. Keiyoushi flags mainstream sites that carry some adult titles,
so leaving flagged extensions out with reveal off would make sites like Weeb
Central unfindable (Keiyoushi's 1,435 read 562 that way). What stays inside
reveal is an extension whose every source here is mostly hidden: hidden means
hidden. BROWSE's own lists and search do not filter on the flag, so an
installed 18+ extension's sources are always there, on GET STARTED's first day
too.

**An untrusted extension is never installed.** An APK not signed by the key
its repository lists is refused before anything is kept, and the page shows
the key it was signed with beside the repository's, both at once. There's no
review step and no install anyway: a tap that runs code signed by an unknown
key is what the check is there to stop.

**An APK the repository has replaced is asked for again from its index.** The
listings are read when a repository is added and when REFRESH asks, so they can
be days old, and a repository deletes an APK when it publishes the next
version: MoviesMod's INSTALL, for one, answered
`…/aniyomi-en.moviesmod-v16.4.apk ANSWERED 404` once the repository had moved
to 16.5. So an APK that answers 404 or 410 has its repository's index read
again, once, and the APK it lists now is installed (`install` in
`src/lib/server/engine/extensions.ts`). When the fresh index names the same
file, the band still says which URL answered what; when it no longer lists the
package, it says that. Every refused install, update or repository is also
written to tsundoku.log at WARN, so a REPORT carries the cause after the band
is gone ([`LOGS.md`](LOGS.md)).

**Icons** of available extensions come through the same route as installed
ones, under the same rules: with reveal off one whose every source is mostly
hidden answers 404.

### REPOSITORIES

**REPOSITORIES** adds one by its address, over https; plain http only from
this computer itself (`127.x.x.x`, `localhost`, `[::1]`; `isLoopbackHost`), for
a repository served to the same install. Nothing crosses a network there, and
the transport is not what an install trusts: an APK is kept only when it's
signed by the key the repository lists. A home network's address over http is
still refused. Pasted, it's asked before anything is added (`?add=<address>`):
FOUND · Keiyoushi · 1,435 MANGA EXTENSIONS, and ADD; or NOT A REPOSITORY with
the reason. The list shows each with its kind, what it holds, and REMOVE (which
asks, through the sheet, when extensions installed from it would stay
installed without updates). One that stopped answering keeps its row ruled,
STOPPED ANSWERING since a date, with what's installed from it. CHECK NOW, in
the bar, reads every repository again.

**The languages** are a SETTINGS row, 07 — BROWSE · LANGUAGES: a cell per
language the repositories list (most extensions first, twelve at most, the
defaults EN and JA always there), toggled one at a time; one always stays.

**The first run.** With no sources BROWSE is 00 — NO SOURCES YET with the
address field, which asks REPOSITORIES what's there, and what each kind of
repository holds: a Mihon one manga, an Aniyomi one anime, an LNReader one
novels. The names Mihon, Aniyomi and LNReader appear there and nowhere else.

### Extensions that need a WebView

Some extensions, manga or anime, run their site in an Android WebView. The
engine gives them a headless Chromium when this install turns its WebView on
([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md), "Cloudflare and WebView";
SETTINGS › 07 — BROWSE › WEBVIEW, [`SETTINGS.md`](SETTINGS.md)). It is off on
every install until turned on, since it runs those sites' scripts in Chromium
111 without a sandbox. The words are `src/lib/webview.ts`'s.

- **The mark.** An installed extension whose code uses a WebView
  (`engine_extensions.webview`, migration 78), and each of its sources on
  BROWSE's list and in RECENT, carry **NEEDS A WEBVIEW** in their line, a
  quiet fact in the line's text-2 like the language beside it, no new colour.
  Where this install can't give it one it is said in words, not as an error:
  **NEEDS A WEBVIEW, WHICH THIS INSTALL HAS TURNED OFF**, or **NEEDS A
  WEBVIEW, WHICH THIS ENGINE CAN'T RUN** on an engine older than the support
  (its `/capabilities` has no `webview`). An OBSOLETE row keeps the mark after
  its repository words. AVAILABLE has no mark: whether an APK uses a WebView
  is known only once it's downloaded.
- **The first download.** The engine fetches Chromium (about 180 MB) the
  first time a WebView extension is loaded. While it comes, EXTENSIONS (where
  one was installed) and a WebView source's page (while it waits) show a
  non-blocking band, **GETTING THE BROWSER THIS SOURCE NEEDS · 40 % OF ABOUT
  180 MB**, asked of `/api/browse/webview` every 2 s
  (`src/lib/webview-watch.svelte.ts`). Nothing is said when it's ready or
  idle. When it failed, the band is **THE BROWSER … DIDN'T START** with the
  engine's error verbatim (it is written for people: "needs an X display ...
  install Xvfb"), and EXTENSIONS' band links to SETTINGS.
- **A failed call.** A WebView extension's error carries the WebView's
  status; while the browser is starting, failed, or off, the source's page
  draws that instead of DID NOT ANSWER and the extension's "timed out"
  (`webviewError` through the page's settled answer, `parseWebViewError`).
  Starting: the first-use line, and no TRY AGAIN, since asking now would
  only wait again; once the watch sees it ready, **THE BROWSER THIS SOURCE
  NEEDS IS READY** with TRY AGAIN. Failed: the engine's words, with TRY
  AGAIN. Off: the mark's words, and SETTINGS › BROWSE › WEBVIEW. The same
  words reach every other place a call's message shows (the queue, the
  player).

### Selecting many at once

**SELECT** is **INSTALLED's**, a cell between the title and CHECK NOW; a TV
draws none, as the library draws none. It is URL state (`?select=1`), and so
is the selection (`pkg=…` once per ticked package), so a reload keeps both and
a no-script press lands with its rows still ticked. A press's ticks travel in
the form's body (the rows' own checkboxes); with script an empty selection
disables the bar's cells, while the server draws them pressable, so a tick can
be pressed before the page hydrates or with no script at all. An empty press
is then refused by the band (`NOTHING TICKED`), and a refused press answers
with the ticks it read, so they come back with its page. AVAILABLE and
REPOSITORIES dim and stop while it runs: leaving the tab would drop the
selection without a word. ✕, BACK and a tab's own TICK / UNTICK work without
script; Escape is the focus layer's, so it needs script. It ends on ✕, Escape
(a focused tick included: an `input` keeps Escape from the focus layer, so the
form ends SELECT itself), BACK (`registerBack`), or an UPDATE or REMOVE that
succeeded; **a switch press does not end it**, so the cells read back what the
press set. Those two bulk forms are `use:enhance`, so their redirect is a
client `goto` on the same component: the tick set is cleared whenever
`?select` leaves the URL, and the **next SELECT starts with nothing ticked**
whichever way the last one ended (✕ clears it itself). REMOVE's question is a
GET of the same form, so without script it carries the ticked rows' packages to
`?removeSel=1`; a selection too big for a request head is refused on the spot
instead.

**A row is a package, a switch is a source id**: a press changes **every
source of each ticked extension**, including a language BROWSE does not list,
because that is what SETTINGS would do one source at a time. The ids come from
the engine's own rows (`browseSources(true)`), never from the rows drawn, and
an LNReader plugin is its one id `ln:<id>` (`pluginOf`, `select.server.ts`).

**The bar** (six cells) sets HIDDEN (HIDE outside reveal), ADDED HIDDEN, OFF
HISTORY and NEVER TRACKED, and carries UPDATE n and REMOVE n…; a section's
label offers TICK n / UNTICK n where UPDATE ALL sat. A switch is counted in
extensions: ON when every source of every ticked package has it, OFF when none,
MIXED otherwise (a PART extension is one whose sources disagree), and **every
cell's second line says what the next press does** (`MIXED · 3 OF 12 · 1 PART ·
TAP: ALL ON`, `12 OF 12 · TAP: ALL OFF`, `TAP: SHOW ALL` for HIDDEN inside
reveal, or `SOURCES NOT KNOWN`). A press that could change no row draws `NOT
CHANGED` in the band, with no switch meaning to contradict it, and its facts
are counted in sources (`1 SOURCE`, `2 SOURCES`). A package whose sources are
not known (an extension the engine never listed a source for) cannot change,
and with none left the cells are disabled. A FAILED extension whose listing
names sources can still be switched: its sources are the repository listing's
(`setSources` runs even when the load failed), so the press follows them, and
only an extension with no source row at all reads `ITS SOURCES AREN'T KNOWN`.
Outside reveal HIDDEN is an **action**, not a switch: a count would hint at
what is hidden, and hidden means hidden.

**Bulk HIDE sets the switch, and nothing else.** On a single source's settings
page, HIDDEN SOURCE hides the source while **CONCEAL ITS SERIES** hides the
series already in the library from it, once and now (`Conceal its series`,
below). A bulk HIDE does the first only: every source of every ticked
extension leaves the list, its search and its pages' names, while the
library's series from those sources **stay shown**, with their own hidden
state untouched. The band says exactly that ("THEY LEFT THE LIST AND THE
SELECTION · REVEAL SHOWS THEM"). Reasons: it is the same press HIDDEN SOURCE is
on the settings page, not CONCEAL; it never hides a reader's series without
CONCEAL's own question; and its UNDO brings the sources back, which a series
write would not. **CONCEAL ITS SERIES stays on each source's settings page**,
one source at a time; offering it for a selection would take a new cell and
sheet, which this press does not have.

**One band, one UNDO.** The press carries each source's value before it
(`from=id|1,id|0`), so UNDO puts a mixed selection back mixed and a source
already on stays on; it refuses whole when a source was changed since on its
own settings page ("UNDO REFUSED · <NAME> WAS CHANGED SINCE · NOTHING
CHANGED"), because an UNDO that took back half a press would be a lie. A press
and its facts are one transaction (`setSourceFlags`), so a failure part-way
leaves nothing changed. A row that could not change keeps its ink rule and
leads with `NOT CHANGED · …` until the next press or ✕; a package removed on
another device since it was ticked leaves the list and the selection and is
counted in the band, not called a success.

**Every press's redirect is budgeted before it is written.** The guard is on the
whole `Location` — `/browse/extensions`, `select=1`, one `pkg` per ticked
package and the band's facts — not on the band alone, because Node answers a
request head past 16 KB with 431 after the write would have landed and the user
would get no band and no UNDO. `LOCATION_BUDGET` is 12 KB, leaving room for the
request line and the browser's headers; `?/flags`, `?/updateSome` and
`?/removeSome` all refuse with `TOO MANY SOURCES TO CHANGE AT ONCE` and change
nothing. **The press's own request is not that URL**: its ticks travel in the
form's body, so the POST's address is the action's name and `select=1` whatever
is ticked. (A formaction carrying them was measured at ~18 KB for 320
real-length rows, and Node answered 431 before any guard ran; `use:enhance`
then drew the error page.) REMOVE's question is a GET of the same form, so
without script it does carry the ticks; a selection whose question URL would
pass the request head is refused on the spot, with the same band, before the
browser asks for it. A switch press outside reveal leaves sources that are
already hidden out of its facts (they were not changed, and UNDO must not touch
them), so their ids do not reach the client.

**UPDATE and REMOVE in bulk** are the list's own actions narrowed to the
selection. UPDATE installs what each repository lists now, keeps the old APK
for a week and forgets each source's kept answers, and its UNDO is BACK TO for
every row it updated; SELECT ends. The band carries each updated row's new
version, so UNDO refuses whole (409, nothing changed) when a row's version is
not the one the press installed — one that took its own BACK TO since, or
another update — instead of swapping it forward again and calling it restored.
REMOVE asks first through REMOVE's ConfirmSheet with its lines summed, and has
**no UNDO** (the sheet asked; an install fetches what the repository lists
then, which may not be the removed version). **An OBSOLETE row stays
installed**: no repository lists it any more, so once removed it could not be
installed again, and its settings could not be reached. The sheet counts what
may go, and says which stay and why. Tested in
`tests/extensions-select-db.spec.ts` and
`tests/browse-extensions-select.e2e.ts`; the frame is
`tests/browse-extensions-select-frame.e2e.ts` (the tablet's selecting state).

## A source's settings

`/browse/<source>/settings`, from the SETTINGS cell on a source's page and on
an installed extension's row in EXTENSIONS. **Its ← goes back where it was
opened from**: from EXTENSIONS' cell it says Back to EXTENSIONS and returns to
the list on its tab (the cell sends `from=/browse/extensions?…`,
`extensionsFrom`, without a sheet's parameters); from the source's page it
says Back to <source> and returns there. It is a back link (`backLink`,
src/lib/back.ts), so a list a few history entries back comes back as it was
left, scroll included; a reload, a new tab or a bookmark opens the address.
Only `settingsOrigin` accepts EXTENSIONS' path (exactly `/browse/extensions`),
never `backOrigin` (doc/NAVIGATION.md, "From a source"). EXTENSIONS draws one
row per package (`{#each s.rows as r (r.pkg)}`), and the cell opens the first
source BROWSE lists of it (`r.shown[0]`): a package with several languages
still has one cell, since the list has no row per language to put a second on.
`tests/browse-settings-back.e2e.ts` walks both origins, the reload, the new
tab, the bookmark and forged origins, on a desktop and a phone.

Many sources have settings: a mirror, a language, image quality, a login. The
engine describes them (`preferencesManga`); **tsundoku keeps the values**
(`engine_preferences`) and sends them with every call, since the engine keeps
none across a restart (doc/EXTENSION-ENGINE.md). Each visit asks for the
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
SAVE (nothing else would send a tick). `src/lib/library/source-settings.ts`
reads a stored preference into one of those shapes (a list's `%s` summary says
its current entry) and a form's answer back into the value `setPreference`
stores, refusing anything that isn't one of the setting's values. A source's
kept answers are keyed by its settings, so its page asks again on return. With
the engine down, the kept values show and still save, under the NOT ANSWERING
band.

The extension's own settings are `02 — <SOURCE> · <LANG>`, under tsundoku's
own switches, and every family has the page: an LNReader plugin, which keeps
no preferences here, has only the switches, and its source page draws the
SETTINGS cell like any other.

### A source's own switches

Four switch rows above the extension's own (`01 — IN TSUNDOKU`), drawn as the
page's switch rows are, each its own form posting `?/flag`, and under them
one action, CONCEAL ("Conceal its series", below). A source whose family has
more than one kind to choose has a fifth row, KIND, under the switches ("The
kind it serves", below). They are tsundoku's, not the extension's: nothing is
sent to the source.

| Switch            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hidden source** | The source is listed, opened, searched and named only inside reveal, as a mostly-hidden one is: BROWSE and RECENT, EXTENSIONS (an extension whose every source is hidden, and an LNReader plugin: INSTALLED, its count, UPDATE ALL and AVAILABLE's NOVELS, filtered by the route through `pluginsShown` and `novelsAvailable`), its icon, its page, its settings and its previews, SEARCH THE SOURCES (`searchSources`, `novelSearchSources`), and SAME TITLE's "FROM <SOURCE>" (`nameable`). Its series keep their own hidden state.                                                                                                                                                                                              |
| **Added hidden**  | A series added to the library from it starts hidden. Every way a source adds: `addToLibrary` (Mihon's), `addAnime`, `addNovel` and `keepOrPromote` (a browsing record promoted by ADD), and every import (a backup, a scan, IMPORT A BACKUP; below). With reveal off, ADD then lands on the source's page with "ADDED TO THE LIBRARY, AND HIDDEN", since the hidden series isn't found, or on BROWSE, naming no source, when the ADD left the source mostly hidden (the first ADD from a source with nothing else here does); that band says what ADD AND DOWNLOAD queued and offers UNDO ("ADD outside reveal", below). A browsing record is not an add.                                                                          |
| **Off history**   | Its reads and watches never show in HISTORY, inside reveal or not, and its time is not in HISTORY's total ([`HISTORY.md`](HISTORY.md)). They are still logged: progress, CONTINUE, the series' own time and tracking are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Never tracked** | Nothing from it is sent to AniList, MAL or Ranobe (a light-novel catalogue tsundoku syncs reads to, [`RANOBE.md`](RANOBE.md)): progress, STATUS and SCORE, a rating, an anime's seasons, Ranobe's reads and its edition suggestion, and SUGGEST TO RANOBE all refuse, and a send already queued is dropped (AniList, MAL) or held until the switch is off (Ranobe) (`tracking.ts`'s `targets`, `ranobe.ts`'s sends). Its reads still count here: progress, CONTINUE, HISTORY and the series' own time are unchanged. The series screen's LISTS row says why instead of offering a send ([`TRACKING.md`](TRACKING.md), "Sending"). A search for a link is not a send: FIND stays, and a link is how a cover and its details arrive. |

**Kept** in the `settings` key/value table, one row per switch that is on
(`source.hidden:<id>`, `source.added-hidden:<id>`, `source.off-history:<id>`,
`source.never-tracked:<id>`, value `1`; off deletes the row), keyed by BROWSE's
source id (an engine source's number, `ln:<plugin>`). No migration: a row per
switch is a primary-key lookup for SQL (`sourceFlagSql`,
`src/lib/server/engine/source-flags.ts`), which is how HISTORY filters in SQL.
A series' source in SQL is `sourceIdSql(origin_key)`, held to `sourceOfKey`
over every key a writer stores (`tests/source-flags-db.spec.ts`).

**The kind it serves**: a fifth row, KIND, under the switches and above
CONCEAL — only for a family with more than one kind to choose
(`SOURCE_KIND_CHOICES` in `src/lib/library/kinds.ts`: a Mihon source offers
AUTO, MANGA, MANHWA, DOUJIN; an Aniyomi source AUTO, ANIME, MOVIE, SHOW; an
LNReader source has one kind and draws none). **AUTO** is no row, and means
what ADD already infers: a gallery's book, a webtoon-only source, a "Manhwa"
genre. A chosen kind is kept as `source.kind:<id>` = the kind's name, and every
**new** series from that source starts as it, at the importers' one writer; a
series already in the library keeps its own, and the series screen has its own
switch ([`KINDS.md`](KINDS.md), "The kind a source serves"). SEARCH THE
SOURCES reads the same answer (`kindOfSource`,
`src/routes/downloads/search/kinds.server.ts`), so a Mihon source marked
MANHWA is a MANHWA cell there. REMOVE keeps it, like the switches.
`tests/source-kind-db.spec.ts` holds it.

**REMOVE keeps them**: removing an extension or a novel plugin deletes only
its row (`removeExtension`, `removePlugin`), and its switches stay in
`settings`, so a source installed again comes back with HIDDEN SOURCE, ADDED
HIDDEN, OFF HISTORY and NEVER TRACKED as they were left: they were set on
purpose, and REMOVE's sheet already says ITS SETTINGS ARE KEPT. To start a
source afresh, turn its switches off before REMOVE; once it is removed its
settings page is gone with it, so they can be reached again only by installing
it. `tests/browse-extensions.e2e.ts` holds it (REMOVE, INSTALL again, the
switches still on).

**ADDED HIDDEN at the importer**: a series an import creates in the library
from a source with the switch on arrives hidden too, so **a backup can only
add hiding**. A series the backup hides stays hidden, one it shows arrives
hidden, and a series already in the library that the import only updates is
not newly hidden: the switch is about what arrives, not a rule over what is
there, so a series shown again inside reveal stays shown at the next scan. The
writer applies it in the same transaction that creates the series
(`writeSeries`'s `addedHidden`, `src/lib/server/import/write.ts`), and both of
the importer's callers pass it: a scan or IMPORT A BACKUP (`run`) and what
tsundoku's downloaders attach (`attachWritten`). Of what an import plans, keys
that name a source are switched by their source: a Mihon backup's series
(`mihon:<n>:<url>`), and tsundoku's own anime and novel downloads read back
(`aniyomi:`, `lnreader:`). **A Mihon download folder's own series**
(`mihon-dir:<source folder>/<title>`) names no source in its key
(`sourceIdSql` answers NULL), so the writer reads its source from the folder
instead (`folderSourceId`, `src/lib/server/import/fold.ts`): Mihon names the
folder `<name> (<LANG>)`, so the folder is the installed source with exactly
that name and language, or, failing any, the one installed source with exactly
that bare name. A folder series created from a switched source arrives hidden,
so **the order of arrival does not matter**: created before any backup names
it, it arrives hidden, and stays hidden when a backup later names it and
`adoptFolder` re-keys it to `mihon:<n>:<url>` (a fold never shows anything);
arriving first through a backup that names it, it arrives hidden too. **Only
one installed source may answer**: two installed sources with one name and one
language (two extensions calling themselves the same) cannot be told apart
from the folder, so neither's switch is applied and the folder's series
arrives visible, as it does from a source that is not installed (no
`engine_sources` row: its switch, which REMOVE keeps, is not read for a
folder) or whose switch is off. Two sources of one name in different languages
are told apart by the folder's language. As everywhere, only a series the
import **creates** is hidden: a folder series already in the library, adopted
or rescanned, is left as it is. Hentoid's books, an EPUB and a gallery name no
source, so the switch never reaches them. Any series can still be hidden by
hand inside reveal. What an attach creates also makes BROWSE ask its
per-source counts again (`forgetSourceUse`, as a run does), so `mostlyHidden`
does not wait out the cache's minute. `tests/import-db.spec.ts` holds every
combination, the attach included, and the folder in both orders, the shared
name and the language; `tests/devices-import-db.spec.ts` the folder adopted by
the library's own backup.

**ADD outside reveal.** The source's page draws the band the series page would
have, or BROWSE does when the source's page is not found (below): "ADDED TO
THE LIBRARY, AND HIDDEN", then "<SOURCE> ADDS ITS SERIES HIDDEN · 12 CHAPTERS
· 10 DOWNLOADING · REVEAL SHOWS IT" (ADD AND DOWNLOAD's `queued`, in
`addedDetail`'s words), and UNDO. The band is its URL
(`?added=hidden&series=<id>&preview=<preview id>&queued=`), so a reload says
the same. The id alone is never trusted, since a series' id is given again
once the series is gone: the band and its UNDO name the series only while its
id **and** the key of the preview it came from both still match, it is in the
library and the preview is this source's (`addedHere`,
`src/lib/server/engine/source-flags.ts`). UNDO is the series page's
(`undoAdd`): out of the library while nothing of it is downloaded or read, then
the preview again. Once something is, the band draws no UNDO and says "NO
UNDO: SOMETHING OF IT IS DOWNLOADED OR READ NOW", and an UNDO tapped after
that happened is refused with the same words. UNDO twice, or the band's URL
after UNDO, finds no series, says nothing and undoes nothing.

**Shelves in the ADD band.** Under this band, a second line in its panel: `PUT
ON A SHELF:` and the library's shelves (its collections) as chips, one tap
each, several allowed, a second tap takes one off; the line says `ON LATER,
TONIGHT` once it is on any. Then `+ NEW SHELF`, which opens `NewShelfSheet` as
it is (the URL's `new=shelf`), at the strip's right end under UNDO, so a
remote's ↓ from UNDO lands in the strip and ← walks the chips. The band still
says ADDED TO THE LIBRARY, AND HIDDEN, with the chips under it. The last shelf
a chip put the series on is offered first next time, per device
(`tsundoku:add-shelf`, its id; read once as the band mounts, so the order can
change once just after the first paint). Past six shelves the band draws the
first six, always including any the series is on, and `N OTHER SHELVES` opens
the SHELVES sheet (`ShelfPicker`, as it is, posting to the library's
`?/shelf`). The rules are `src/lib/library/add-shelf.ts`.

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

**The series screen's band is its own.** An ADD that is not hidden (the common
case) lands on the new series with its own ADDED TO THE LIBRARY band
(`src/routes/series/[id]/+page.svelte`), which draws the same chips from the
same rules in `add-shelf.ts` and writes through the series screen's `?/shelf`
action ([`SERIES.md`](SERIES.md), "Shelves in the ADDED band").

**Where the band lands.** The ADD can itself make the source mostly hidden:
more than half its series hidden (`mostlyHidden`), and the counts are asked
again at once (`forgetSourceUse`), so on a source with ADDED HIDDEN on and
nothing else here the first ADD leaves it 1 of 1 hidden, and its page is not
found outside reveal. That is the usual case for a source someone switched
ADDED HIDDEN on for, not an edge. So ADD asks after it has run
(`addedLanding`, `src/routes/browse/added.server.ts`): while the source is
still found, the band is on its page, its place kept; once it is not, the band
is on BROWSE (`/browse?added=hidden&…`, the same parameters), as CONCEAL's is,
and names no source outside reveal, since hidden means not named: "ITS SOURCE
ADDS ITS SERIES HIDDEN · … · THE SOURCE IS HIDDEN WITH IT · REVEAL SHOWS
BOTH". Inside reveal the source is here, so the band names it and has no tail.
BROWSE has its own UNDO (`?/undoAdd`), and both UNDOs ask only the band's
facts (the series' id and key, and the preview), never whether the source is
found, so a band drawn on the source's page is undone there even after the
source became mostly hidden (a second ADD, another tab). UNDO lands on the
preview while its source is found, and on BROWSE while it is not (other series
of it are still hidden, so the preview would not be found either).

**A refusal's words are the last answer, not a fact about now.** A no-script
refused UNDO on a source's page which can no longer draw its band lands on
BROWSE with the refusal's **code** in the URL
(`/browse?added=hidden&…&refused=409`, `refusedLanding`,
`src/routes/browse/added.server.ts`), and BROWSE's load turns it back into
words (`refusedWords`). A later load does not trust the code alone:
`standingRefusal` asks the cause again. A 409 is "something of it is
downloaded or read now", which is the band's own `touched` (the same query
`undoAdd` refuses on), so a reload after the chapter is marked unread draws
UNDO again, and the server accepts it. So the band never offers an UNDO the
server would refuse, nor hides one it would accept, and the refusal shows its
words without script as well. There is no 503: `undoAdd` is a local `DELETE`
and never asks the engine, so an engine that is down refuses no UNDO, and a
typed `refused=503` says nothing and hides nothing.

**The band's action keeps `from=`.** Without script UNDO's answer is a load of
the form's action URL, so that URL carries the band's own parameters and, on a
source's page, the tag origin the page was opened with (`from`, the value
`backOrigin` accepted, passed through `data.back`). Without it the answer
page's ← would go to the default back cell instead of the tag's screen.

**An accepted UNDO keeps the way back too.** It lands on the preview with
`from=/browse/<source>?from=<the tag's origin>`, the origin read again through
`backOrigin`, never the raw parameter. A preview's ← takes only a source's page
or the search (`sourceOrigin`), so the tag's origin cannot be its `from`
directly: ← goes where it did before the ADD, to the source's page, whose own
← is the tag's screen. With no origin, a refused one, or a landing on BROWSE,
there is no `from`.

The **series page's** own UNDO after an ADD keeps it too: its form carries the
origin the add landed with, and the redirect puts it on the preview's URL
([`SERIES.md`](SERIES.md), "The ADDED band's place in history"). So does the
hidden band's, on BROWSE's route: it hands back the catalog the ADD recorded on
the band's URL, and a preview reached by a shared link, which has no catalog
behind it, gets no `from=` at all.

**A search's query comes back with it.** An ADD found by a search hands back
`/downloads/search?q=<query>`, and the preview reads where it was found from
`q` alone (`downloads/source/[id]`'s load, `searchOrigin`), so `from=` on its
own would leave its ← on the bare search page: UNDO puts the query on the
preview's URL too, and ← is the search the entry was found by.

**ADD AND DOWNLOAD queues only what its own ADD hid.** Outside reveal a hidden
series is not the viewer's, but the one ADDED HIDDEN has just hidden is: it is
queued, and queueing it shows nothing. Every ADD also answers with a series
already here (`keepOrPromote`), and one hidden before, for its own reasons, is
not queued outside reveal and gets no band (the page is the source's again).
Which is which is read before and after the ADD, under the key the preview
knows the series by (`addWatchingHidden`): hidden after, not before, and the
series the ADD answered with. The adds that hide (`hideIfAddedHidden`):
`addToLibrary` (Mihon's, `engine/backend.ts`), `addNovel`
(`novels/source.ts`), `addAnime` (`engine/anime-source.ts`) and
`keepOrPromote` (`browsing.ts`), all reached by the preview's two actions
through `downloads.ts`'s `addToLibrary`, which is why the question is the
preview's, and the importer's `writeSeries`, which queues nothing.

**What ADDED HIDDEN does not reach:** a follow's or a refresh's new chapters
are not an add, and a download of a series already in the library neither.
Grouping books (`src/lib/server/books.ts`) makes a series from the library's
own books, with no source.

With reveal off, turning HIDDEN SOURCE on lands on BROWSE, since the page it
was set on is no longer found. Turning it off again is done inside reveal.

### Conceal its series

**CONCEAL** is the other half of HIDDEN SOURCE. HIDDEN SOURCE hides the source
and leaves its series' own state alone; CONCEAL hides the series, once, now,
and leaves the source's switches alone. It is an action, not a switch: it
stores nothing in `settings`, so a series added from the source afterwards is
not hidden by it (ADDED HIDDEN is that switch), and it is a row of its own
under the switches with a cell on the right, `CONCEAL <n>`. Its words avoid
HIDE and HIDDEN, because the page's HIDDEN SOURCE row and reveal's HIDE AGAIN
are found by those words and a locator matches by substring.

- **What it hides:** every series in the library from the source that the
  library shows (`concealable`, `src/lib/server/engine/source-flags.ts`),
  through `setHiddenWhole` (`src/lib/server/works.ts`), so a Work is never
  left half hidden: a Work with a part from the source is hidden whole, its
  parts from other sources too. So the count can be more than the source's own
  series, and the row says so: "Hides the 12 series here from it, once, now,
  and 2 more from other sources: the parts of their Work, since a Work is
  hidden whole." A series hidden already, for its own reasons or by its root,
  is not counted and not touched.
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
  does: a Work the library hid again with the same parts is the same hidden
  state, and UNDO shows it. So an UNDO also shows a Work hidden again, part
  for part, after the press: nothing records when a series was hidden (there
  is no `hidden_at` column that would tell the two apart). UNDO twice, or the
  band's URL after UNDO, shows nothing more.

## Where it lives in the code

| What                                                      | Where                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The filter logic                                          | `src/lib/library/browse-filters.ts`                                                                                                                                                                                                                                                                                                                                                |
| A tag's address on a source's page, and ← back            | `src/lib/library/tag-search.ts`; the preview's links in `src/routes/downloads/source/[id]/`, the series' sheet in `src/routes/series/[id]/` (`TagSheet.svelte`, `tag-source.server.ts`, `tag-search/`); the preview's `tag-search/` route                                                                                                                                          |
| Which sources, their shelves, what's kept                 | `src/lib/server/engine/browse.ts`                                                                                                                                                                                                                                                                                                                                                  |
| SELECT in a catalog                                       | `src/lib/library/browse-select.ts` (what can be ticked, the lines), `browse-press.ts` (the lanes, the band's words), `browse-selection.svelte.ts` (the selection and the run in this tab's memory); `src/routes/browse/` `SelectBar`, `PressBar`, `TickSheet`, `PressBand`; `src/lib/server/browse-press.ts` and `src/routes/api/browse/press/`; `src/lib/server/engine/adding.ts` |
| A result matched against the library (shared with search) | `asHits` in `src/lib/server/engine/backend.ts`                                                                                                                                                                                                                                                                                                                                     |
| BROWSE                                                    | `src/routes/browse/` (`+page.server.ts`, `+page.svelte`, `SourceRow.svelte`, shared with the empty search)                                                                                                                                                                                                                                                                         |
| An extension's icon                                       | `src/routes/api/browse/icon/[pkg]/+server.ts`                                                                                                                                                                                                                                                                                                                                      |
| A source's page                                           | `src/routes/browse/[source]/` (`+page.server.ts`, `+page.svelte`, `FilterForm.svelte`, `ResultTile.svelte`)                                                                                                                                                                                                                                                                        |
| A source's settings                                       | `src/routes/browse/[source]/settings/`, `src/lib/library/source-settings.ts`; tsundoku's own switches in `src/lib/server/engine/source-flags.ts`; CONCEAL in `src/routes/browse/conceal.server.ts` and `ConcealBand.svelte`                                                                                                                                                        |
| Extensions and repositories                               | `src/routes/browse/extensions/` (`ExtRow.svelte`), `src/lib/server/engine/manage.ts`                                                                                                                                                                                                                                                                                               |
| BROWSE's languages                                        | `src/routes/settings/` (07 — BROWSE)                                                                                                                                                                                                                                                                                                                                               |
| A WebView extension (mark, first download, failed call)   | `src/lib/webview.ts` (the words), `src/lib/server/engine/webview.ts`, `apk-webview.ts`, `src/routes/api/browse/webview/`, `src/lib/webview-watch.svelte.ts`                                                                                                                                                                                                                        |
| A site's check                                            | `checkingSince` / `noteSolvedChecks` in `engine/browse.ts`, `novels/solver.ts` (the app's own solve), `src/routes/api/browse/check/[source]/`, `src/lib/site-check.svelte.ts`; the engine fork's `ChallengeLog`                                                                                                                                                                    |
| The engine's schema                                       | the engine fork, `server/src/main/kotlin/mextensionserver/impl/FilterSchema.kt`                                                                                                                                                                                                                                                                                                    |

## Tests

- `tests/browse-filters.spec.ts`: the round trip (schema to URL and back,
  unchanged) over every real fixture, at defaults and with every choice
  moved; one choice moved is one key and one count; out-of-range values
  refused; the engine's format, top-level checkbox included.
- `tests/engine-browse-db.spec.ts`: which sources are named, pages one to N,
  a repeated series shown once, MORE asking only for the new page, a setting
  change asking again, filters sent as a search, a twin from a mostly-hidden
  source not named; BROWSE's list (the chosen languages, a language named
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
- `tests/browse-extensions-select.e2e.ts`: SELECT on EXTENSIONS: `?select=1`,
  a tick, the count, SELECT ALL, a section's TICK/UNTICK, ✕, Escape and Back
  ending it; a mixed cell and one press setting every source of each ticked
  package (a plugin's own id included); the band and its UNDO putting a mixed
  selection back mixed; a ticked row removed elsewhere counted as not changed;
  HIDE leaving the list and UNDO bringing the row back; UPDATE narrowed to the
  selection with BACK TO as its UNDO; and REMOVE's sheet, an OBSOLETE row
  staying installed, and no UNDO. `tests/extensions-select-db.spec.ts` holds
  the transaction, the facts, the language BROWSE does not list, a plugin's
  one id, the refusal whole, and REMOVE's obsolete rule. The frame is
  `tests/browse-extensions-select-frame.e2e.ts`, the tablet's selecting state.
  The browse world's seeded packages have no repository listing, so they are
  all NEEDS A HAND: the frame asserts the tab row, one section label and its
  right-hand cell, and the bulk bar and its four switch cells. The other two
  labels are the same `.label` markup and styles.
- `tests/source-settings.spec.ts`: each of the five types read from the
  engine's shapes, a value no longer offered not shown as chosen, a form's
  answer stored or refused.
- `tests/tag-search.spec.ts`: a genre in a tri-state group, one matching a
  checkbox, one with no match, an author, case and spacing, no schema, a
  default-on checkbox kept, and every option of every real fixture finding
  itself; each person's namespace against every real fixture's text fields,
  written out, and the comma split; `backOrigin`'s refusals and `keepOrigin`.
  `tests/browse-tags.e2e.ts` and `tests/tv-tags.e2e.ts`, on a world of their
  own (`tests/helpers/tag-world.ts`: a fake engine whose manga has an author
  and genres): a genre lands on FILTERED with its chip included and what the
  source was asked, a search for the rest, ← back to the preview (clicked, and
  its landing read), the series' sheet and each way in with no sheet, the
  engine down or slow, and the remote's walk to a tag.
- `tests/tv-browse-focus.e2e.ts` (the `tv` project, on a fake engine of its
  own): the focus mark on a catalog tile, on the cover as on a library tile,
  in POPULAR, LATEST, a search, back from a preview by both ways back (the
  remote's BACK, and the preview's own plain ←, after which the catalog
  restores the tile from `data-focus-id`), a forward arrival and a reload
  (neither puts a tile back; the forward visit starts at the top), a tag round
  trip and two of them (every ← lands on the screen it names, never on the tag
  search it shares a path with), a tag search opened by address with `from=`
  and none behind it (and after a reload), and under FILTER's scrim.
- `tests/browse-catalog-back.e2e.ts` (the `browse` project, on a seeded
  database and a fake source of its own): the catalog's place comes back. By
  the browser's back at the 20-page cap (the scroll, the tile at the top, **0**
  page calls and **0** cover fetches for what was drawn), by the preview's
  plain ←, by a TV's BACK (`tests/tv-browse-focus.e2e.ts`), from a source that
  answers slowly (its answers forgotten, so the return must ask: the place is
  held on an outline of the kept list's size, and not one kept tile is drawn
  while the answer is on its way), and on a novel plugin and an anime source; a
  series **hidden between leaving and coming back**, by the series screen's own
  HIDE, is never attached to the document on either way back (a
  MutationObserver, and the answer draws the list one shorter); the next page
  adds its tiles and leaves the drawn ones alone (the same elements, one call,
  no cover again); a reload and a forward visit keep the top; and under reveal
  nothing of the revealed list comes back after reveal ends (no record written,
  and not one frame draws it).
- `tests/browse-add-back.e2e.ts` (the `browse` project, on the fake engine):
  the add takes the preview's history entry — ADD and ADD AND DOWNLOAD each
  leave `history.length` as it was and one `page.goBack()` on the catalog at
  its place, with no page asked again; the ADDED HIDDEN landing on the source's
  page the same, with an observer saying the added-and-hidden result was never
  attached (its back is the same route as the landing, so the drawn tiles are
  reused rather than added: the flash that case cannot reach is the one the two
  HIDE cases above pin); and each case's UNDO puts the library back. A TV's ADD
  then BACK is in `tests/tv-browse-focus.e2e.ts`.
- `tests/source-flags-db.spec.ts`: a source's own switches: the rows they are
  kept in, `sourceIdSql` against `sourceOfKey` on every key, HIDDEN SOURCE at
  BROWSE, RECENT, EXTENSIONS (a package, and a plugin's INSTALLED rows, UPDATE
  ALL's set and AVAILABLE's NOVELS), both searches and SAME TITLE, and OFF
  HISTORY's rows, total and the log it leaves alone. ADDED HIDDEN per family in
  `tests/engine-backend-db.spec.ts`, `tests/anime-source-db.spec.ts` and
  `tests/novel-source-db.spec.ts` (a browsing record, then ADD; ADD alone; the
  switch off). `tests/browse-source-flags.e2e.ts`, on its own tag world: the
  page's rows, and each switch followed to the screens it changes.
- SELECT in a catalog: `tests/browse-select.spec.ts` (what can be ticked,
  every line of the bar, the bulk bar, SHOW and the band, the lanes and their
  one retry, the selection in a tab's memory ending where it should, a run,
  RETRY, a shelf chosen while it runs, UNDO); `tests/browse-press-db.spec.ts`
  (the press's server half on an in-memory library through the real writers:
  FIRST 10, ALL and nothing queued, a stale tick and a series being added
  skipped, failures in a word, a hidden source, ADDED HIDDEN for many after the
  source is mostly hidden, the shelves, UNDO leaving what is touched and never
  trusting an id alone); `tests/browse-select.e2e.ts` on a world of its own
  (`tests/helpers/select-world.ts`: two sources, a press adds series): the
  flow on a tablet, a phone and a desktop; the generated frame
  `tests/browse-select-frame.e2e.ts` and its sibling
  `tests/browse-select-measure.e2e.ts` (the bar's cells, the box and ring, the
  bulk bar's line and 60px cells, SHOW's rows).
- `tests/browse-flow.e2e.ts` and the generated `tests/browse-frame.e2e.ts`
  (a source's page) and `tests/browse-list-frame.e2e.ts` (BROWSE),
  in the `browse` project against a fake engine (`tests/browse-setup.ts`,
  [`TESTING.md`](TESTING.md)).
- The WebView ("Extensions that need a WebView"): `tests/webview-words.spec.ts`
  (every line, the mark, the capability, a failed call's mapping),
  `tests/engine-webview.spec.ts` (against a fake engine: a failed call's
  message and failure, the capability and its cache, SETTINGS' view, the
  switch, REMOVE's refusals), `tests/apk-webview.spec.ts` (the dex read),
  `tests/engine-extensions-db.spec.ts` (the flag at install, the fill, BACK
  TO), `tests/webview-switch.spec.ts` and `tests/release-plan.spec.ts` (the
  switch's file, and `ENGINE_WEBVIEW` on only when it's on), and
  `tests/browse-webview.e2e.ts` (the `browse` project, a world and fake
  engine of its own: the mark on and off, SETTINGS' row through ON, a
  restart, OFF and REMOVE, the first-use band, TRY AGAIN only once ready,
  and a failed browser's words).

## Limits

- **A press lives in its page.** SELECT's run is not kept on the server, so it
  does not outlive the tab or move to another device, and nothing finds it
  again: the queue (`/downloads`) has no ADDING section and the library's
  QUEUE cell (and the desktop sidebar's DOWNLOADS row) no ADDING count. There
  is no STOP. A second press waits for the first rather than queuing behind
  it. A source that starts refusing is not paused on its own lane; its series
  fail and RETRY asks them again. ADD + ALL asks without counting chapters or
  size. The band has no QUEUE → or REVIEW →, and its PUT ON A SHELF is the
  chips alone, with no `N OTHER SHELVES` sheet and no `+ NEW SHELF`: both act
  on one series (`ShelfPicker`, `NewShelfSheet`), and for a press they would
  need its series and those it has yet to add. The bulk bar has no offline or
  engine-down state: a press offline fails each series as `DID NOT ANSWER`,
  and RETRY asks again.
- **The WebView is proven on Linux only** ([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md),
  "Cloudflare and WebView"): it is untried on Windows, macOS and WSL.
- **Repositories are checked when asked** (CHECK NOW), not every few hours.
  Nothing updates by itself either way, so a periodic check would only move
  the count on EXTENSIONS sooner.
- **INSTALLING has no progress bar.** An APK is a few hundred KB from the
  repository; the button says INSTALLING… while it's fetched, checked and
  loaded.
- **A check is known once it's been passed** (since the engine started, then
  kept): a site's very first check still shows the 10 s band, not the check
  band, if it hasn't begun by the time the page asks. A novel is the
  exception: the app knows its own solve the moment it starts, so the check
  band is there during the first one, not only after it.
- **A text filter inside a group can't be set.** The engine reads a group's
  text child from the child's name, which is also how it finds the child, so
  it is dropped from the schema. None of the nine sources the engine was
  measured against has one ([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md),
  "Mihon manga").
- **Two filters with the same name** can only be told apart by their order;
  the engine matches by name, so the second can't be set.
- Long select rows wrap without a rule between their lines.
- The ✓ in a checkbox falls back from Plex Mono, as the design README's known
  gap says of `▶ ✕ ● ○ ▦ ☰` ([`design/README.md`](design/README.md)).
