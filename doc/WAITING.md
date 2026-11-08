# Waiting

The time between a tap and the next screen, on every screen. It's built from
`Loading States.dc.html` in [`design/handoff/`](design/handoff/), the handoff for
the brief [`briefs/done/LOADING.md`](briefs/done/LOADING.md).

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
  reads LOADING. A band tap (`?kind=`) is the same wait as a tab's (c436;
  `tests/waiting-flow.e2e.ts` slows the band's MANGA, the sidebar's MANGA
  shelf having gone).
- **Elsewhere → library:** header, tabs, the KIND band's row (empty grey
  cells: its counts are the next screen's to say) and the grid in outline
  (`WaitingScreen`).
- **Series:** opens with what the tapped tile knew (`SeriesOutline`). That's
  the real `SeriesPanel` in its `outline` mode:
  - cover, title, kind, rating, FAV and the list's counts are real;
  - rating and FAV already work;
  - alternate titles, the rows below and the list are outlined;
  - ▶ CONTINUE is drawn without its chapter and doesn't open until the chapter
    is known, so it can't open the wrong one.

  A series reached without a tile (a link) waits the full second and shows
  the outline with no title.

- **Person or tag page:** the name comes from the URL, so it's drawn in full
  over a grid in outline.
- **History:** day labels and rows, all in outline.
- **Search** never outlines. The last answer stays up under the line, because
  it's closer to right than an empty list.

While an outline is up, the old screen stays mounted but hidden, so nothing on
it is lost.

## Not answering

From 10 s the band says how long it has been asking, and the request carries
on. ← BACK stays where you are: it navigates to the current URL, which
replaces the stalled navigation and costs nothing.

## Writes that fail

Rating and FAV, on the series screen and on library tiles, show their new
value at once and save behind it (`src/lib/saves.svelte.ts`). When a save
fails:

- the new value stays, drawn dashed (on the series screen, the rating label
  reads NOT SAVED; on the library's tile, the FAV corner and the rating bars
  wear the same dashed mark, c659, for as long as the page holds that tap,
  a RETRY in flight included);
- on the library page, a second failed tap does not take the first tile's mark
  with it: the band carries one failure, and the page hands it back to a
  displaced one as it clears, so each unstored value keeps PUT BACK and RETRY
  **while the library page is open** (a displaced failure is dropped when the
  page is left; only the band's own failure survives the trip);
- a tile drawn again after a trip away draws the stored value with no mark --
  the page no longer holds the tap, and the mark means "this value is not
  stored", not "a save of this field failed" (c659);
- a band at the bottom says "RATING 4 NOT SAVED · WORKSTATION DID NOT ANSWER ·
  TRIES AGAIN WITH THE NEXT REQUEST", with PUT BACK 3 and RETRY;
- the next navigation that reaches the workstation tries it again, once.

The value only goes back if you ask.

## The reader

Between chapters, the reader keeps its page box. On a chapter's first page the
box names the chapter: "CH. 43 · P. 1".

## Where it departs from the handoff

- **Series and person pages open once the line shows (150 ms), not the frame
  after the tap.** The handoff was drawn against this morning's measurements,
  when the series screen took 230 ms. Since card c42 ("Make the library fast")
  it takes about 50 ms. An optimistic screen drawn at once would flash for a
  frame or two before the real one on most taps, so it waits for the same
  150 ms as the line. On a slow network it's what the handoff drew.
- **The handoff's scale is already out of date.** It placed the library's ALL
  shelf (2.1 s) in the outline zone. The shelf now answers in about 65 ms, so
  on the tablet's normal Wi-Fi nearly every wait stays under the line's
  threshold. The outline and the band are for a sleeping workstation and poor
  Wi-Fi.
- **The not-answering band has no CACHED · N →.** Reaching the cached shelf is
  itself a request to the workstation that isn't answering. The offline states
  (OFFLINE.md) take over once the tablet knows it's offline.
- **← BACK doesn't show the browser's copy at once (1m).** SvelteKit re-runs a
  screen's data on back, and keeping every screen's last data to redraw it
  first isn't built. Back waits like any navigation: pressed, then the line.
- **The page box's bar still slides** rather than filling with the page's bytes
  (1n). An `<img>` doesn't report its bytes. The box does name the chapter.
- **Failed saves are tracked for rating and FAV** on the series screen and the
  library's tiles. Shelves, HIDE, MARK READ and the reader's own rating and
  FAV still quietly keep whatever the server says.

## Tests

- `tests/waiting-domain.spec.ts`: the thresholds, the fill, the destinations.
- `tests/waiting-flow.e2e.ts` slows the network on purpose. It covers:
  - a slow shelf (pressed, then the line, then the outline, then the grid);
  - a slow series opening with the tile's title and counts, and CONTINUE
    disabled until known;
  - not answering, and ← BACK;
  - a rating that doesn't save staying dashed until PUT BACK.
