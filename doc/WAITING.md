# Waiting

The time between a tap and the next screen, on every screen.

It's one state shared by every screen (`src/lib/waiting.svelte.ts`), started
and ended by the root layout from SvelteKit's `beforeNavigate` and
`afterNavigate`. No screen draws its own.

## The scale

`src/lib/waiting.ts` holds the thresholds:

| Since the tap | What's drawn                                                              |
| ------------- | ------------------------------------------------------------------------- |
| 0 – 150 ms    | Only the tapped element, holding its pressed inversion (`.nav-pressed`).  |
| 150 ms – 1 s  | The header's bottom rule becomes a 2px progress line over the old screen. |
| 1 s and up    | The next screen in outline.                                               |
| 10 s and up   | A band: `○ WORKSTATION NOT ANSWERING / ASKED 12 S AGO · STILL ASKING`.    |

A fast answer draws nothing but the pressed state, so nothing flashes.

The pressed state itself is the press layer's from the moment the pointer goes
down ([`MOTION.md`](MOTION.md), "Pressing"); `.nav-pressed` takes over at the
click and holds it to the next screen. When the next screen arrives it slides
in, and when its outline shows first, the outline is what slides in
([`MOTION.md`](MOTION.md), "Screens").

## The line

The line sits over the header's own hairline (`NavLine`, in `TopBar` and the
series screen's bar), so the header never changes height.

- It's ink while the workstation is working.
- It fills with accent as the screen's `__data.json` arrives, measured against
  its `content-length`. The fill moves in steps, with no easing.
- Nothing is faked: without a length, or before the first byte, it doesn't
  move. So `prefers-reduced-motion` has nothing to remove.

The bytes are counted by a small wrapper around `fetch` in `src/app.html`,
installed before SvelteKit starts and keeps its own reference. It passes the
same bytes straight through and only counts screens' data.

The top edge belongs to incognito's dashed rule and reveal's band and frame,
so progress never goes there.

## Outlines

The outline cells are flat panel grey, with grey bars where text will go.
They're never dashed, because dashed means "not stored yet". Nothing is
dimmed either, since dimmed already means "offline and not cached".

An outline fills the viewport and stops (`GridOutline` counts the cells from
the screen, not the shelf). It never scrolls, so it can't say how long a list
is or count a hidden series.

Per destination:

- **Library shelf → library shelf:** CONTINUE, the tabs and the KIND band
  stay as they are. The grid goes to outline, and the label's right side
  reads LOADING. A band tap (`?kind=`) is the same wait as a tab's
  (`tests/waiting-flow.e2e.ts` slows the band's MANGA).
- **Elsewhere → library:** header, tabs, the KIND band's row (empty grey
  cells: its counts are the next screen's to say) and the grid in outline
  (`WaitingScreen`).
- **Series:** opens once the line shows (150 ms), not the frame after the
  tap, with what the tapped tile knew (`SeriesOutline`). That's
  the real `SeriesPanel` in its `outline` mode:
  - cover, title, kind, rating, FAV and the list's counts are real;
  - rating and FAV already work;
  - alternate titles, the rows below and the list are outlined, the rows in
    the order the screen lands them: TAGS first where nothing folds, after the
    direction row and SHELVES in the fold (`tests/series-outline.e2e.ts`);
  - ▶ CONTINUE is drawn without its chapter and doesn't open until the chapter
    is known, so it can't open the wrong one.

  A series reached without a tile (a link) waits the full second and shows
  the outline with no title. The series screen usually answers in about
  50 ms, so an outline drawn at once would flash for a frame or two before
  the real one on most taps; on a slow network it shows as soon as the line
  does.

- **Person or tag page:** the name comes from the URL, so it's drawn in full
  over a grid in outline, from 150 ms as a series is.
- **History:** day labels and rows, all in outline.
- **Search** never outlines. The last answer stays up under the line, because
  it's closer to right than an empty list.

While an outline is up, the old screen stays mounted but hidden, so nothing on
it is lost.

## Not answering

From 10 s the band says how long it has been asking, and the request carries
on. ← BACK stays where you are: it navigates to the current URL, which
replaces the stalled navigation and costs nothing. These bands say what is
true now, so they carry no ✕ ([`BANDS.md`](BANDS.md)).

The band has no CACHED · N →: reaching the cached shelf is itself a request to
the workstation that isn't answering. The offline states
([`OFFLINE.md`](OFFLINE.md)) take over once the device knows it's offline.

Most waits stay under the line's threshold on a home Wi-Fi: the library's
shelves answer in tens of milliseconds. The outline and the band are for a
sleeping workstation and poor Wi-Fi.

## Writes that fail

Rating and FAV, on the series screen and on library tiles, and a page set as
a cover show their new value at once and save behind it (`src/lib/saves.svelte.ts`). When a save
fails:

- the new value stays, drawn dashed (on the series screen, the rating label
  reads NOT SAVED; on the library's tile, the FAV corner and the rating bars
  wear the same dashed mark, for as long as the page holds that tap,
  a RETRY in flight included);
- each failure keeps its own band: the store (`saves`) holds a list keyed by
  save (`fav:<id>`, `rating:<id>`, `cover:<entry>`), so a second failed field
  or tile does not take the first one's PUT BACK or RETRY, and the bands stack
  at the bottom, the newest where a lone band sits. The list is the app's, so
  they survive leaving the screen that raised them;
- a tile drawn again after a trip away draws the stored value with no mark --
  the page no longer holds the tap, and the mark means "this value is not
  stored", not "a save of this field failed";
- a band at the bottom says "RATING 4 NOT SAVED · WORKSTATION DID NOT ANSWER ·
  TRIES AGAIN WITH THE NEXT REQUEST", with PUT BACK 3 and RETRY (a library
  tile's band names the tile, since several can be up at once, unless the
  card is hidden when the save fails: the band outlives reveal, and with
  reveal off a hidden title does not reach the browser);
- RETRY and PUT BACK end only their own failure; a newer failure of the same
  field replaces it, and a retry that lands leaves that newer one up;
- the next navigation that reaches the workstation tries each held failure
  again, once.

The value only goes back if you ask.

## The reader

Between chapters, the reader keeps its page box. On a chapter's first page the
box names the chapter: "CH. 43 · P. 1".

## Limits

- **← BACK doesn't show the browser's copy at once.** SvelteKit re-runs a
  screen's data on back, and screens don't keep their last data to redraw it
  first. Back waits like any navigation: pressed, then the line.
- **The page box's bar slides** rather than filling with the page's bytes: an
  `<img>` doesn't report its bytes.
- **Only rating, FAV and a chosen cover keep a failed save.** Shelves, HIDE,
  MARK READ and the reader's own rating and FAV keep whatever the server says.

## Tests

- `tests/waiting-domain.spec.ts`: the thresholds, the fill, the destinations.
- `tests/waiting-flow.e2e.ts` slows the network on purpose. It covers:
  - a slow shelf (pressed, then the line, then the outline, then the grid);
  - a slow series opening with the tile's title and counts, and CONTINUE
    disabled until known;
  - not answering, and ← BACK;
  - a rating that doesn't save staying dashed until PUT BACK.
