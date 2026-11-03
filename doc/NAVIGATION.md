# Going back

Going back comes back to the screen as it was left: the same shelf or tag,
the same order, the pages the grid had loaded, and the place in them. The
owner's example: MANGA, A–Z, scrolled a few pages down; open a book, read
it or not, go back, and be exactly there.

## Two ways back, one result

- **The system's back** (Android's gesture, the browser's button) walks the
  browser's history. The library's snapshot keeps its loaded pages and scroll
  for each history entry ([`LIBRARY.md`](LIBRARY.md), "Pages"), and the shelf,
  tag, sort and RANDOM's seed are all in its URL.
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

Back links: the series screen's ← (to the library, a shelf, a person,
history, or the source it was added from), the readers' ← and ← SERIES, the player's ← and ← SERIES, the end
page's ← SERIES and LIBRARY, a person page's ←, and the Work screen's
← LIBRARY (`/work/N`; W5 will name the series it was opened from). Code that leaves a screen
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

## Screens that are gone

Some actions end what their own screen shows, then redirect somewhere else:

| Action, on the screen it ends                 | Goes to                  |
| --------------------------------------------- | ------------------------ |
| GROUP (a singleton, from its suggestion)      | the new series           |
| UNGROUP, or the UNDO after SERIES CREATED     | the library              |
| TAKE OUT or MOVE TO… on the series' last book | that book, or its target |
| HIDE, with reveal off                         | the library              |
| DELETE on the series' last book               | the library              |

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
