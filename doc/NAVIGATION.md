# Going back

Going back comes back to the screen as it was left: the same shelf or tag,
the same order, the pages the grid had loaded, and the place in them. The
owner's example: DOWNLOADED, A–Z, scrolled a few pages down; open a book, read
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

Back links: the series screen's ← (to the library, a shelf, a person or
history), the readers' ← and ← SERIES, the end page's ← SERIES and LIBRARY,
and a person page's ←.

Tested in `tests/library-flow.e2e.ts` ("the app's own ← buttons come back…"),
which fails without it.
