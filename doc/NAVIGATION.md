# Going back

Going back comes back to the screen as it was left: the same shelf or tag,
the same kind on the KIND band, the same order, the pages the grid had
loaded, and the place in them. The owner's example: MANGA, A–Z, scrolled a
few pages down; open a book, read it or not, go back, and be exactly there.
MANGA was a shelf then (`?shelf=k:manga`); since c436 it is the band's
`?kind=manga` on a shelf, which comes back the same way, being in the URL.

## Two ways back, one result

- **The system's back** (Android's gesture, the browser's button) walks the
  browser's history. The library's snapshot keeps its loaded pages and scroll
  for each history entry ([`LIBRARY.md`](LIBRARY.md), "Pages"), and the shelf,
  tag, kind, filters, sort and RANDOM's seed are all in its URL.
- **The app's own ← buttons** are links, and a link opens a fresh copy of the
  screen: first page, default place. So a back link goes back in history
  instead, when the reader came from the screen it points to
  (`backLink`, `src/lib/back.ts`).

**The screens that keep a place, and what keeps it.** Two have a SvelteKit
snapshot: the **library** (its loaded pages and scroll, per history entry,
[`LIBRARY.md`](LIBRARY.md), "Pages") and **BROWSE's catalog for a source**
(`src/routes/browse/[source]/+page.svelte`: the list's key, how many tiles it
had drawn and the scroll, card c930; [`BROWSE.md`](BROWSE.md), "A way back
comes back to the place"). It is restored on a popstate only, so a reload and a
forward visit keep today's behaviour (the top), and a list drawn under reveal
or incognito writes none at all. The catalog keeps a count, never the answer:
the kept list would draw a series hidden since it was left, and a restore holds
the place on an outline of that size until the server's answer for this visit
is there. One more place is kept by hand, because the preview's ← is a plain
link and not a history step: the catalog leaves one record of where it was when
the reader opens a preview (`tsundoku.browse-left`) and that ← is the only
arrival that reads it. Every other screen's place is its URL alone, which is
why the readers write `?p=` and `?at=`.

**Every snapshot is one blob.** SvelteKit keeps every screen's snapshot for
every history entry in a single `sveltekit:snapshot` sessionStorage value, and
its write is best-effort: a value over the browser's storage quota is dropped
silently (no error reaches the page), so a tab full of screens then keeps no
place at all — the library's own included. That is why the catalog keeps a
count and a scroll rather than the answer it drew.

## How a back link decides

Every navigation notes where its history entry is (`noteVisit`, in the root
layout's `afterNavigate`), keyed by SvelteKit's own index in `history.state`
and kept in `sessionStorage`. A back link looks up to ten entries back for one
showing the screen it opens (the same path), and goes back that many steps:

- series → library: one step;
- library → series → reader, then the reader's ← SERIES: one step, and the
  series' ← LIBRARY: one more;
- library's CONTINUE ▶ → reader → series: the series' ← LIBRARY is two steps.

When there's no such entry (a link opened in a new tab, a bookmark, the app
opened on a series), the link opens its screen as it always did.

Back links: the series screen's ← (to the library, a shelf -- named by the
shelf alone, a kind being a filter on it, so a back link built afresh lands on
the shelf without its kind; walking history keeps it -- a person, history,
the source it was added from, or the Work whose run opened it), the readers' ←
and ← SERIES, the player's ← and ← SERIES, the end page's ← SERIES and LIBRARY,
a person page's ←, and the Work screen's ← LIBRARY (`/work/N`). Code that leaves a screen
by itself (the player's Escape) uses `goBackTo`, the same decision. The
player's were plain links until 2026-11-02: on a TV, ← then BACK opened the
player again (`tests/tv-player.e2e.ts`).

Tested in `tests/library-flow.e2e.ts` ("the app's own ← buttons come back…"),
which fails without it.

## From a source

A source's preview (`/downloads/source/<id>`) knows where it was opened from:
a source's BROWSE page (its `from`), else the search (`/downloads/search`, with
its `q`). Its ← says BROWSE or SOURCES and goes there.

That origin outlives the preview (card c262). + ADD TO LIBRARY, ADD AND
DOWNLOAD, and opening the preview of a series that is already in the library
all land on the series with `?from=<origin>`, as does a BROWSE tile of a series
already in the library, which opens the series directly. The series' ← then says
BROWSE or SOURCES and goes back to it instead of to the library. Being a back
link, it goes back in history when the source's page is a few entries back, so
its results come back as they were left.

The origin rides in the URL, so it is accepted only as an in-app path to a
source's BROWSE page or to the search (`sourceOrigin`,
`src/lib/library/origin.ts`, after the URL is normalised): an absolute URL,
`//host`, a backslash or a path that climbs out with `..` is ignored, and ←
says LIBRARY. Tested in `tests/origin.spec.ts`, `tests/browse-online.e2e.ts`
(BROWSE, the already-added preview, the refused origins) and
`tests/downloads-flow.e2e.ts` (SOURCES, with the query).

A source's BROWSE page opened from a tag (an author, an artist or a genre on a
preview, a tag on a series: [`BROWSE.md`](BROWSE.md), "Arriving from a tag")
carries `from=<that preview or series>`, and its ← returns there, saying
"Back to the preview" or "Back to the series". It is a plain link, not a back
link (c864): a source's list and its tag search share the path `/browse/<id>`,
so a back link would match the tag search the reader came through instead of
the preview it names, and the two ←s would alternate for good. The preview's
own ← is a plain link for the same reason; the catalog itself puts the tile's
focus back when that ← brings it back, and not on a forward visit or a reload
(`restoreFocus`). It keeps `from` on every way
to another list of the same source (POPULAR, LATEST, its search, FILTER's
APPLY and RESET, MORE, SETTINGS and back), so ← still lands on the preview
after the reader has looked around (card c453). Only an in-app
`/downloads/source/<id>` or `/series/<id>` path is accepted (`backOrigin`,
`src/lib/library/tag-search.ts`); anything else leaves ← on BROWSE.

A source's SETTINGS has one more origin: **EXTENSIONS** (card c727, wave
33). EXTENSIONS' SETTINGS cell sends `from=/browse/extensions?<its tab and
filters>` (no open sheet: `extensionsFrom`), and the settings page's ← then
says "Back to EXTENSIONS" and returns to the list; opened from the source's
page it says "Back to <source>" and returns there, keeping a tag's origin as
above. Either way ← is a back link (`backLink`): when that screen is a few
history entries back (the settings page, any band or question opened on it,
a reload of it) it goes back in history, so the list is as it was left;
with no such history (a new tab, a bookmark) it opens the address. Only the
settings page accepts EXTENSIONS (`settingsOrigin`, tag-search.ts): its path
must be exactly `/browse/extensions` as typed, and every refusal
`backOrigin` makes holds for both, the encoded spellings included (`%2F%2F`,
`%5C`, and a `.`/`..` segment spelled out or as `%2e`, which since wave 33
`backOrigin` refuses even when the climb lands on an accepted screen).
Tested in `tests/tag-search.spec.ts` and `tests/browse-settings-back.e2e.ts`.

## From a Work

A Work's run rows open their series with `?from=work:<id>` (`tests/work/[id]/
Run.svelte`), and the series' ← then says `← <WORK>` -- `← THE BREAKER` -- and
opens the Work, as a back link, so it returns through history when the Work is
a few entries back.

The id is a claim, not a fact (W5). `backTo` in
`src/routes/series/[id]/+page.server.ts` accepts it only when it is a positive
integer _and_ the series really is a part of that Work; anything else -- a
stale id, a hand-typed one, a Work that has since ended -- says `← LIBRARY`
rather than lying or 404ing. Tested in `tests/work-row-frame.e2e.ts`.

## From the highlights page

`/highlights` (c701; [`HIGHLIGHTS.md`](HIGHLIGHTS.md)) keeps everything it
shows in its URL: the kind, the series, NO WAY BACK, the search and the open
item (`?open=`). Opening an item replaces the history entry rather than adding
one, so ← leaves the page instead of stepping back through the items read.
Its own ← (the phone and the tablet: the desktop has the sidebar) goes to the
library, or with `?series=` to that series' screen, where its row was.
A highlight's → goes to the place it came from (the reader, at the quote's
paragraph or the page), and is not drawn once the place is gone.

It is reached from the desktop sidebar's foot, **HIGHLIGHTS** after HISTORY,
and from **MORE**'s same row on the tablet, the phone and the TV, both with the
count and both absent while there are none; and by `/highlights` in a bar.

## Screens that are gone

Some actions end what their own screen shows, then redirect somewhere else:

| Action, on the screen it ends                             | Goes to                  |
| --------------------------------------------------------- | ------------------------ |
| GROUP (a singleton, from its suggestion)                  | the new series           |
| UNGROUP, or the UNDO after SERIES CREATED                 | the library              |
| TAKE OUT or MOVE TO… on the series' last book             | that book, or its target |
| TAKE OUT of a Work's second-to-last, or UNGROUP on a Work | the library              |
| HIDE, with reveal off                                     | the library              |
| DELETE on the series' last book                           | the library              |

HIDE covers both of W4's answers. `HIDE ALL n` redirects with `band=hidden` and
`TAKE OUT` with `band=taken-out`, so the library's band says which of them
happened -- a Work hidden whole, or one series on its own again, naming the Work
it left when that Work ended. UNDO from that band leaves the page it was on.

Followed as an ordinary navigation, each one pushed a new history entry on
top of a screen that no longer exists, so the system's back (a swipe on
Android) landed on a 404: grouping two books from one's own screen and
swiping back did exactly that (2026-09-25). Each now **replaces** the gone
screen in history (`replacing` / `settleReplacing` in `src/lib/back.ts`), so
back goes to wherever that screen was opened from. DELETE on the series
itself already did (`leaveDeleted`).

**A preview ends in the same way** (card c932, stage 1). + ADD TO LIBRARY and
ADD AND DOWNLOAD end the preview, so the series they open takes its history
entry rather than a new one: one swipe back from the new series is the catalog
it was found in, at the place it was left ([`BROWSE.md`](BROWSE.md), "The add
replaces the preview"). The ADDED band's **UNDO** ends the series in turn, so
it replaces the series' entry too and lands on the preview with its `from=`
(c262) kept: one swipe back from the preview is the catalog, and the preview's
← still says BROWSE ([`SERIES.md`](SERIES.md), "The ADDED band's place in
history"). Without script either 303 is a full navigation, which no page can
replace, and it still pushes.

GROUP from the library or a person page still pushes: the screen it was sent
from is still there to go back to.

Only the entry being left is replaced. A gone series further back in history
(opened, left, then grouped from somewhere else) still answers 404 if the
back gesture walks that far.

Tested in `tests/books-flow.e2e.ts` ("grouping from a single book's own
screen, then back…"), which fails without it.

## A screen being left writes nothing

A screen keeps its own place in its URL with `replaceState`: the image reader
writes `?p=` and the text reader `?at=` 800 ms after they settle, so a reload
comes back to the page. Such a write lands on whatever history entry is current
when it fires, and a reader stays mounted while the screen it is going to
loads. BACK to the series moved the browser's entry first, and the reader's
timer then wrote `/read/<id>?p=1` onto the series' entry: the series screen was
drawn under the reader's URL, and its reload, share or BACK went to the reader
(c565; `library-flow`'s ← case reproduced it 2 in 5 at a load of 45, wave 23).
A late `goto` is worse: it replaces the navigation away with one back in.

So nothing late writes the URL or navigates once a reader is on its way out
(`leavingReader()` in `src/lib/reader/leaving.ts`): a navigation to another
screen has begun (`navigating.to`), or the window no longer shows this reader.
The window is read for the moment after a popstate BACK has moved the browser
and before SvelteKit's `navigating` says so. It is another screen when its path
is not a reader route at all (`resolve('/read/[entry]', …)`'s shape, the base
included, one segment after `/read/`), or another reader entry than this one's.
"This one's" is not simply `page.url`: SvelteKit's `replaceState` sets only
`page.state` and leaves `page.url` at the last real navigation, and the text
reader moves between chapters in place, writing `/read/<next id>` with
`replaceState`. So a reader that moves the window itself says so
(`readerMovedTo(path)`, right after the write), and the guard takes that path
as its own until the next real navigation, which `afterNavigate` reports
(`forgetReaderMove`); an invalidation gives `page.url` a new object for the same
entry and isn't one. Comparing against `page.url` alone
froze the text reader's `?at=` and its progress after the first settle in the
second chapter it read into (round 2 of wave 25). Each reader's
`beforeNavigate` also drops its settle timer when it leaves the reader route
(its `close` event carries the place). Moving between chapters, `/read` to
`/read`, is not leaving. The writers it covers, every one in
`src/routes/read/`:

**An in-place write keeps the history entry's own URL too** (c623).
SvelteKit stores each history entry's URL in its state (`sveltekit:pageurl`,
set by `replaceState` at `client.js:2573`, @sveltejs/kit 2.70.3), and a
popstate into the entry navigates to that URL, not to `location`
(`client.js:2883`). `replaceState` writes it from `page.url`, which stays at
the last **real** navigation, so a reader that moves its chapter (the text
reader) or its page (either reader) in place left history naming the old one:
BACK to the series and forward again loaded the chapter the reader was opened
at, not the one read on to. `keepHistoryUrl()` (`src/lib/reader/history.ts`)
patches that key after each of the readers' own writes. Until it did, the
address bar kept saying the right chapter while the page drew the first: a
popstate navigation never rewrites the entry itself (`client.js:1873`).

| Writer                                                 | Late?                         | Guarded |
| ------------------------------------------------------ | ----------------------------- | ------- |
| Image reader's settle (`?p=`)                          | a timer, 800 ms               | yes     |
| Text reader's settle (`?at=`)                          | a timer, 800 ms               | yes     |
| The strip's crossing (`goto` into the next chapter)    | a scroll still gliding        | yes     |
| A paged turn landing (`next()` / `prev()` past an end) | the slide's 220 ms            | yes     |
| A turn queued during a slide or a settle-back          | taken after the 220 ms        | yes     |
| The player's countdown into the next episode           | a 1 s interval                | yes     |
| An edition switch, CH. ←/→, CONTINUE ON, ▶ NEXT        | the user's own press, at once | no      |

Tested in `tests/reader-flow.e2e.ts` and `tests/text-reader-flow.e2e.ts`
("left at once, … never writes …onto the series it went back to (c565)"),
which hold the series' data past the 800 ms and fail without it.
`tests/text-reader-flow.e2e.ts` also reads on into a third chapter, in PAGED
and in SCROLL ("…read on into a third chapter: the URL and progress follow
every chapter…"): the window names each chapter's entry, a `page` event carries
it, and a reload opens the last one. Both fail with the `page.url` comparison.
c623's own cases go to the series and back by history: the text reader's
("history into the reader entry after an in-place chapter move opens the
chapter read on to, at its place") and the image reader's in incognito
("history into an image reader entry opens the page it settled on, in
incognito too"), where only the entry's URL can carry the page.
