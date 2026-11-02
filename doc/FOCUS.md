# Focus, and the D-pad

tsundoku gets a TV (`doc/TV.md`), and a TV is driven by a remote: the D-pad
sends arrow keys, OK sends Enter, Back is a history back or Escape. Tab order
is not how a D-pad moves — the arrows go to the nearest focusable thing _in
that direction_ — and Android's WebView does not expose Chromium's own spatial
navigation. So this is tsundoku's own small layer, for the whole app. Desktop
keyboard users get it too, with the same focus mark.

Card c234. The design is `doc/design/handoff/TV-Focus.dc.html` and `TV
Calls.dc.html` (its `calls`, `keys` and `qs` are the prose); the TV layout
itself is c238 and the player's bar is c235.

## What runs

`src/lib/focus/`:

| File          | What                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `geometry.ts` | The pure decision: given the focused rect, a direction and candidate rects, pick the next. No DOM, unit-tested. |
| `dom.ts`      | What counts as a stop, what is visible, and which keys a text entry owns.                                       |
| `keys.ts`     | The remote's keys as decisions: BACK, MENU, and OK's press-versus-hold (`OkPress`). Unit-tested.                |
| `layer.ts`    | The key listener, scopes, the start of a screen, scrolling, BACK's climb, and focus across history.             |
| `index.ts`    | What the app imports.                                                                                           |

The root layout installs it once (`installFocusLayer()` in `onMount`). A screen
does not opt in.

## How it decides

An arrow goes to the nearest thing that way, and "that way" is an edge test: a
thing is to the right only if its left edge is at or past the focused thing's
right edge (and so on for the other three). So → at the end of a row stops
there; it never wraps to the next row the way Tab does.

Among the things that way:

1. One that overlaps the focused thing across the way wins — in a grid ↓ keeps
   its column rather than sliding one cell sideways.
2. Then the smaller gap along the way.
3. Then the smaller gap across the way (a ragged last row lands on its nearest
   cell).
4. Then the larger overlap, then DOM order. A wide CONTINUE card over two of a
   six-wide grid's columns lands on the left one, under the card's left edge.

An off-screen candidate still counts; focusing it scrolls it into view. An
element that is hidden (`display:none`, `hidden`, `inert`, a closed `<details>`,
a zero rect) is not a stop, and neither is one inside `[aria-hidden="true"]`.

`tests/focus-geometry.spec.ts` pins these: rows, a ragged last row, a card over
two cells, an overlapping candidate, nothing that way, a candidate scrolled
off-screen.

**Nothing focused yet.** A screen in outline draws no mark. The first arrow puts
focus on the screen's start and does not also move it.

**The start of a screen** is its `data-focus-start` element (the first
CONTINUE card on the library, ▶ CONTINUE on a series); without one it is the
first stop in the scope, or the top-left one on the page.

**Scrolling** is `scrollIntoView({ block: 'nearest', inline: 'nearest',
behavior: 'instant' })` — instant, never smooth. In a uniform grid that moves a
whole row. The TV's focus line and pinned tabs are built (`doc/TV.md`,
c238); whole-row scrolling is still the layer's nearest.

**A held arrow** repeats at the remote's rate and we do nothing special: every
keydown is one move.

**Nothing that way.** On the page, an arrow with no stop in its direction is
left to the browser, so a desktop keyboard still scrolls prose (HELP, a
series' ABOUT) past the last stop. Inside a sheet it is swallowed: the scope
keeps its keys.

## Scopes

A **scope** owns the keys while it is open. `Sheet.svelte` is a scope
(`use:focusScope`): arrows and Tab stay inside it, its first row takes focus
when it opens, and focus goes back to whatever opened it when it closes. The
screen under the scrim takes no keys — a press that would act there moves focus
into the sheet instead.

A scope is a stack, so a sheet opened from a sheet restores to the lower one.

**Opting out.** A screen that already reads the arrows puts `data-focus-off` on
its root and keeps every one of them:

- `ImageReader.svelte` and `TextReader.svelte` (pages, scrolling a strip), and
  their panels. The reader's **end page** lifts it (c235): the pad walks the
  END page's cells — ← SERIES, the rating, ANOTHER SOURCE → — because there is
  no page left to turn;
- `VideoPlayer.svelte` (seek and volume) **while its bar is hidden**, on a TV
  only. With the bar shown the pad moves among its six cells, and the player's
  own arrows are the reader's again once BACK hides it (c235);
- `EntryList.svelte`'s scrub rail and `BookGrid.svelte` while reordering, which
  use the arrows themselves.

A sheet inside an opted-out screen is left alone too — unless it forces the
scope in (`use:focusScope={{ force: true }}`, the reader's page menu).

**Within it.** Two attributes keep a screen's own controls out of the pad's way
without hiding them from Tab:

- `data-focus-skip` on a subtree: not an arrow stop (a tile's rating and FAV
  buttons — a tile is its cover, and its options are a held OK, c235);
- `data-focus-mark="in"` on a focusable cell of a ruled block: the mark is drawn
  inside it (see below).

**Text entries.** ←/→ keep the caret in a single-line input; ↑/↓ leave it. A
textarea or a contenteditable keeps all four. A `<select>` keeps ←/→ to change
its value in place (a remote has no other key for it) and lets ↑/↓ leave, or the
sort control would trap the pad. A range input is a slider and keeps all four.
**A ruled row that adjusts a value** says so with `data-focus-adjust` and keeps
←/→ only, so ↑/↓ still leave it: the series screen's rating row (c238) moves by
half a bar, saved as it changes.

## The remote's other three keys (c235)

A D-pad and OK get the pad around the app; a remote's other keys are the ones
that open things and get out. All three live in `layer.ts`, with the pure part
of them in `keys.ts`, and `tests/tv-keys.e2e.ts` walks them.

- **OK held** is Enter kept down past **450 ms**, the same hold the pointer's
  long press has (`src/lib/actions/longpress.ts`, `HOLD_MS`). It dispatches
  `contextmenu` on the focused thing — the very event every long-press sheet
  already listens for — so a remote and a finger open the same sheet through
  one path: `CoverTile`, `BookTile`, `use:longpress` (the chapter, episode and
  page rows, history), `PageMenu`. A thing with no handler for it is simply
  pressed, so a held OK on a plain button is not a dead press. The release
  after a hold presses nothing, and `e.repeat` neither opens twice nor clicks:
  a short press is the click a keyboard's Enter would have made, made on the
  release (`keys.ts`, `OkPress`).
- **MENU** (`ContextMenu`) is the same event at once, where the remote has the
  key.
- **BACK** is Escape, `BrowserBack` or `GoBack`, and it goes in the design's
  order (TV Calls, "BACK climbs before it leaves"):

  1. **A screen's own step first.** A screen that has something to close but is
     not a focus scope — the player's bar and panel, the reader's chrome and
     its page menu, a history row's REMOVE — says so with `registerBack(step)`,
     the innermost first. The step returns true when it took the key.
  2. **An open sheet.** A scope closes itself on Escape, so the layer sends it
     one (`sendEscape`, and a guard keeps it from coming back round).
  3. **A dialog that is not a scope** — the update notice, a lightbox — gets
     the same Escape, because it is the page's own to close and not the
     climb's to take from it.
  4. **Climb.** From inside a `[data-back-climb="<selector>"]` container, to the
     first stop that selector names — the library's grid climbs to the active
     shelf tab. Otherwise to the screen's `[data-focus-start]`, or its top-left
     stop. BACK never moves the mark downward.
  5. **Nothing.** `window.tsundokuBack()` returns false and the app leaves or
     goes back natively (c236's contract, [`TV.md`](TV.md)). Escape is then
     left to the browser, because it is also the way out of a filter panel, a
     lightbox or a typed field; `BrowserBack`/`GoBack` take the history step
     themselves.

  A text entry keeps Escape (the go-to row's own cancel).

**A forced scope.** A dialog opened over a screen that reads its own keys can
say `use:focusScope={{ force: true }}`: the reader's page menu is that, and
while it is open the pad reaches it even though the page behind keeps every
arrow.

## The mark

One treatment, from the design's board: a **4 px frame in text ink**
(`--text-1`) held off the thing by **3 px of page** (`--surface-page`). Never
the accent (which means "yours") and never magenta. Both palettes get it because
it reads only theme tokens.

`--focus-ring` and `--focus-ring-in` are in `src/lib/styles/spacing.css`, and
`src/lib/styles/focus.css` applies them to `:focus-visible` — so a mouse or a
finger never sees a mark, and a desktop keyboard sees exactly what a TV does.

- **Outside** a thing that stands alone: a cover, a button, a chip, a field.
- **Inside** a cell of a ruled block, so the frame never crosses the hairline: a
  shelf tab, a bar cell, a list row. Those say so with `data-focus-mark="in"`.
- **On a cover tile**, the mark frames the cover, not the tile's title and
  rating bar: `CoverTile` and `BookTile` move it to the `.cover` child.
- On a selected cover the mark replaces the accent select ring while focused;
  the two rings would sit on the same pixels.

It jumps and never animates or grows: there is no transition on it.

## Going back

Before a screen is left, `saveFocus` stores the focused thing's
`data-focus-id` under the URL the screen belongs to — the URL it was _left_
from, which on a popstate is not `location` any more. Coming back (`popstate`,
the system's back or a `use:backLink` ←) puts focus back on it. It waits for the
element (the library's grid arrives a page at a time) and holds it briefly while
that page can redraw the tiles; the reader's first key, tap, wheel or finger
scroll ends it (each held frame scrolls the tile into view, so a wheel left
running would be pulled back).

**Only after a keyboard.** Focus is saved only when the last input before
leaving was a key (a remote, a desktop keyboard). A tablet's tap also focuses
the tile it pressed, and putting that back on a swipe back would scroll the page
against [`NAVIGATION.md`](NAVIGATION.md)'s own restore; leaving by touch forgets
any older id for that URL instead.

The ids the app sets:

| Screen  | ids                                                                                        |
| ------- | ------------------------------------------------------------------------------------------ |
| Library | `series-<id>` (the tile), `continue-<id>` (the resume cell), `shelf-<key>`, `library-more` |
| Series  | `series-back`, `series-continue` (the bar's ▶ and the panel's), `entry-<id>`, `book-<id>`  |
| Sheets  | none: the opener is remembered in memory, not by id                                        |

## What the audit changed

Every action was already a `<button>` or an `<a>` on the library and series
screens; the joins were missing where the pad had nowhere to land, and the mark
had no styles. Screen by screen:

- **Library.** Tiles, the rating and FAV buttons, the CONTINUE cells, the shelf
  tabs, MORE and the bar's cells are all real buttons and links. Added focus
  ids, the start on the first CONTINUE cell, inside marks on the tab row and the
  bar, and `data-focus-skip` on a tile's rating/FAV so ↓ does not stop twice in
  every cell.
- **Series.** The bar's ←, ▶ and selection/reorder cells and the panel's CTA
  are links and buttons already. Added marks inside the bar's cells, the start
  and id on ▶ CONTINUE (in the bar and the panel; the one on screen wins), ids
  on chapter and book rows, and `data-focus-off` on the reorder grid and the
  scrub rail, which use the arrows themselves.
- **Sheets.** `Sheet.svelte` is a scope; MORE's rows and its ✕ are marked
  inside. Rows in the other sheets are already buttons, links, chips or a
  rating slider; the scope makes them reachable and trapped.
- **Readers and player.** Opted out (above), so their arrows are untouched.

Known gaps, left on purpose: a tile's rating and FAV are Tab stops, not arrow
stops, on the desktop; `PersonView`, `/history`, `/settings`, `/browse`,
`/downloads`, `/links` and `/duplicates` were not given the inside mark
everywhere (their actions are already buttons and links, and their layouts are
not the couch's). c235 closed two of these: the held-OK options are built, and
BACK climbs the screen before it leaves.

## Departures from the design, and why

- **Whole-row scrolling** is c238's next step: the layer scrolls the nearest it
  can; the TV's focus line and pinned tabs are built, but the grid still scrolls
  by `scrollIntoView` rather than snapping to whole rows.
- **The reader keeps every arrow, and its chrome is not a focus row.** The
  design says ↓ reaches the chapters either side and READING from the page
  scrubber; the reader's chrome is still the tap-only `Chrome.svelte`, so its
  cells are not stops. c235 gives it OK (chrome), OK held and MENU (the page
  menu), and BACK (menu, then chrome, then the series), and leaves READING
  unreachable from a remote (TV.md, "What it does not do yet").
- **←/→ on a `<select>` change its value**, rather than moving focus: a remote
  has no other key for it. ↑/↓ leave, so the control is not a trap.
- **A tile's rating and FAV are not arrow stops.** The design's focus board
  draws the mark on the cover, and c235 puts the tile's options behind a held
  OK; stopping on three controls per cell would make a 6-wide grid unwalkable.
  Tab still reaches them.
- **BACK climbing the screen** (to the shelf's tab, then the first CONTINUE card)
  is c235's, and is built: see "The remote's other three keys".

## Tests

- `tests/focus-geometry.spec.ts` — the pure decision.
- `tests/focus-keys.spec.ts` — the remote's keys as decisions: which key is
  BACK, which is MENU, and a held OK that opens, clicks, or does neither when
  repeated or cancelled (c235).
- `tests/focus.e2e.ts` — keyboard only: an arrow starts focus and the mark is an
  ink frame (all devices); a sheet is a scope and gives focus back (tablet and
  phone bars); library → series → reader → back, focus restored (the reader leg
  writes progress, so tablet-portrait only; it owns Hoshi no Umi no Tabibito).
- `tests/tv-keys.e2e.ts` — OK held and MENU on a cover, a chapter row and a
  history row; BACK closing a sheet, climbing shelf tab → CONTINUE, and
  `window.tsundokuBack()` answering false at the top (c235).
