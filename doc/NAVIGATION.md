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
"Back to the preview" or "Back to the series". It keeps `from` on every way
to another list of the same source (POPULAR, LATEST, its search, FILTER's
APPLY and RESET, MORE, SETTINGS and back), so ← still lands on the preview
after the reader has looked around (card c453). Only an in-app
`/downloads/source/<id>` or `/series/<id>` path is accepted (`backOrigin`,
`src/lib/library/tag-search.ts`); anything else leaves ← on BROWSE.

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
as its own until the next real navigation. Comparing against `page.url` alone
froze the text reader's `?at=` and its progress after the first settle in the
second chapter it read into (round 2 of wave 25). Each reader's
`beforeNavigate` also drops its settle timer when it leaves the reader route
(its `close` event carries the place). Moving between chapters, `/read` to
`/read`, is not leaving. The writers it covers, every one in
`src/routes/read/`:

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
