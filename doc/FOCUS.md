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

**`tabindex="-1"` is not an opt-out.** It takes an element out of the browser's
own Tab order, but it does not hide it from the layer: a stop is
`button:not([disabled])` (beside `a[href]`, the form controls, `summary`, and
`[tabindex]:not([tabindex="-1"])`), so an enabled button is a stop whatever its
tabindex. `data-focus-skip` is the opt-out: `isVisible` refuses anything inside
it, as it does inside `inert`, `hidden`, `data-focus-off` and
`[aria-hidden="true"]` (`src/lib/focus/dom.ts`).

`tests/focus-geometry.spec.ts` pins these: rows, a ragged last row, a card over
two cells, an overlapping candidate, nothing that way, a candidate scrolled
off-screen.

**Nothing focused yet.** A screen in outline draws no mark. The first arrow puts
focus on the screen's start and does not also move it.

**The start of a screen** is its `data-focus-start` element (the first
CONTINUE card on the library, ▶ CONTINUE on a series); without one it is the
first stop in the scope, or the top-left one on the page.

**Scrolling** is `reveal()` in `layer.ts`: `scrollIntoView({ block: 'nearest',
inline: 'nearest', behavior: 'instant' })` when the thing is off screen —
instant, never smooth; in a uniform grid that moves a whole row — and then a
`scrollBy` for whatever a pinned bar still covers. `nearest` counts a thing
under a sticky or fixed bar as shown, so `uncovered()` finds the bars drawn
over the thing's own top and bottom edges (stacked: the library's focus line
under its KIND band, under the top bar) and the difference is made up (the
first real TV, 2026-11-02). By the thing's own vertical scrollers first,
innermost out, each measured against its own clip as well as the bars, and
only then the page (c861): the series screen's columns scroll themselves, so
moving the page did nothing and ↑ left a row under the bar or the list's
sticky head on most presses. A `position: fixed` box ends the walk, because
nothing outside it moves what is in it: a sheet drawn inside a column leaves
the column alone. A bar is looked for at the middle of the thing's width, so
one covering only its right part (SELECT's bulk bar on a TV) does not count.
A scrim or a sheet, half the screen or taller, is not a bar. The TV's focus line and pinned rows are built
(`doc/TV.md`, c238; the KIND band pins since c436); whole-row scrolling is
still the layer's nearest.

**A held arrow** repeats at the remote's rate and we do nothing special: every
keydown is one move. (The vertical strip's own held arrow is the reader's, not
the layer's: c668 makes its repeats scroll steadily instead of stacking steps —
`doc/READER.md`, "Scrolling on a PC".)

**Nothing that way.** On the page, an arrow with no stop in its direction
still scrolls, so prose (HELP, a series' ABOUT) can be read past the last
stop. A desktop keyboard leaves it to the browser. **A TV's ↑ and ↓ are
scrolled by the layer** (`stepScroll`, c543): the browser's own step
(Chromium's 40 px line step) on the nearest ancestor that scrolls vertically
**and can still move that way**, else the page, but instant, and only once the key has been through every
listener with none taking it (the player and the readers read some arrows
themselves). ← and → stay the browser's: a reader's sideways scroller snaps a
whole page for one step. The browser's keyboard scroll is animated, and BACK's instant
`scrollTo(0)` did not stop an animation already running: BACK pressed just
after a ↓ past the library's last row landed 2 to 47 px under the top, still
moving. Inside a sheet the key is swallowed: the scope keeps its keys.

**A scroller at its end is passed over** (c578), as Chromium's own arrow
scroll chains to the next scroller out and finally to the page. Until c578 the
nearest scroller was taken whether it could move or not, so ↓ in a list at
its end inside a longer page did nothing. An ancestor counts only with
`overflow-y: auto` or `scroll` (a key never scrolls `hidden`), and only if it
can move in the key's direction: `canScroll` in `geometry.ts`, `scrollTop >
1` for ↑ and `scrollTop + clientHeight < scrollHeight - 1` for ↓. The pixel
(`SCROLL_SLACK`) is rounding, not content: `scrollHeight` and `clientHeight`
are integers each rounded from a fractional layout and `scrollTop` is not, so
a scroller at its very end can read up to a pixel short of it. The page at
its own end scrolls nowhere, and that is no error. **A page a screen has
locked** (`overflow: hidden` or `clip` on the root, or on `body`, which CSS hands the
viewport when the root is `visible`) scrolls nothing either (c618, c647): the image
reader sets `hidden` while its lookup panel or page menu is open, and so does
every open `Sheet.svelte` and every overlay that draws its own scrim (c1033), all
through `lockPage()` (`src/lib/scroll-lock.ts`, counted, so a cover closing never
unlocks the page under one still open), and Chromium's
own arrow stops there, where the layer's fallback used to move it (`overflow:
hidden`, and a clipped viewport too, is still a scroller a script can move). What it reaches is every vertical scroller on a screen a TV opens
(`rg -l "overflow(-y)?:\s*(auto|scroll)" src/routes src/lib/components`, 16
files at wave 25): the series screen's panel and list columns, a Work's
panel and list, MOVE's lists, `/links`' candidates and siblings, the
layout's own scrollers, the readers' READING and text sheets and their
views, the lookup panel and the page menu. A `Sheet.svelte` panel is one too,
but a sheet is a scope, so its arrows are swallowed before they get here. The
whole `tv` project ran on this rule (wave 25).

## Sections

On a TV a screen of two columns is two **sections**: the mark goes where the
arrows send it, and the arrows do not walk out of a column at its edge. Put
`data-focus-section` on the column (`src/routes/series/[id]/+page.svelte` is
the one user so far, its `.panel-col` and `.list-col`, card c861).

The series screen wears the mark **only while both columns are drawn**
(`twoColumns`: not in SELECT, not while reordering, not on a book's page grid).
A lone column has nothing to be kept apart from, and as a section it stranded
SELECT's bulk bar, so those screens take the ordinary rule.

Why it exists: an arrow goes to the nearest thing that way over the whole
screen, so ↓ at the left column's last row went into the chapter list, and
the rest of the column could only be reached by a candidate landing in it.
Rows that are not stops, labels and prose, never got a turn, which is how
part of the details column could never be seen (the owner's TV, 2026-11-08).

**What it does**, on a TV and only there (`sectionOf`; a section on a phone or
a tablet stack is not a column, and a desktop's browser scrolls for itself):

- **↑ and ↓ stay in the section** (`stepInSection`, pure, in `geometry.ts`,
  and `tests/focus-geometry.spec.ts` pins it). The nearest stop of its own,
  unless the way there would carry more than the section shows past the screen
  unseen (prose between two stops, taller than the column): then a step instead,
  so it can all be read. With no stop that way, a step of the section's scroller
  (`stepScroll`, the layer's 40 px) while it can still move. The focused thing
  keeps the mark while the column moves under it, so it may be out of sight for
  a press or two.
- **At the section's real end**, ↑ or ↓ does nothing, the page behind included.
  "Real end" is `canScroll` on the nearest ancestor up to and including the
  section's own element (`scrollerFrom`), so a stop inside an inner scroller
  scrolls that first. The one exception is ↑ or ↓ with a stop **outside any
  section** that way, and another section is never it. ↑ looks from the
  section's top edge, for the series screen's bar above the columns; it is not
  looked for from the stop, because a stop the column scrolled away below the
  screen would count what is pinned at the bottom as above it. ↓ looks from the
  focused stop's bottom, held inside the section's box (a stop scrolled away
  above the screen starts from the section's top, so the bar above is not below
  it).
- **A stop pinned over a section's bottom edge is below what ends above it.**
  `position: fixed` puts it over the edge, so measured from the edge it would
  be nothing's next: that is `SaveBand` on the series screen, a failed save's
  PUT BACK and RETRY, drawn on every screen and so while both columns are. ↓
  reaches it from the last stop of a section whose stops end above it (at
  960×540, a list of six rows or fewer), once the section's own stops and its
  scroll are spent; touching counts. A stop the band covers has nothing below
  it, as under the ordinary rule: a list of seven rows or more ends under it
  and stays on its last row, and so does `DETAILS`, the panel's last stop.
  SELECT's bulk bar (`.bulk`) is the same shape and leaves by the other door: in
  SELECT the list is the only column, wears no mark, and the ordinary rule
  reaches the bar.
- **← and → cross**, to the nearest thing the other side, by the ordinary rule.
- **Coming back lands on the row left.** Leaving a section by ← or → notes
  the row left, for that section only (`sectionRows`). A later crossing into it
  goes there instead of the nearest. It holds the element itself, and a row
  that can no longer take focus is refused and the nearest used: the row is
  gone (the list redrew), a fold it was in closed, or the page reloaded. A
  sheet opened and closed does not end it; each crossing writes its row anew.

**What beats it.** A scope first: a sheet is not a section's, even one drawn
inside the column (the WORK row's), because the scope owns the keys whatever
the sheet sits inside. Then `data-focus-up` / `-down`, `data-focus-skip`,
`data-focus-off` and a hidden copy are as they are everywhere else: a named
target goes first, and what is not a stop is no candidate (the panel draws
`fold-only` and `screen-only` copies, and the `display: none` one has no
box).

Nothing else wears the mark yet. `work/[id]` is the closest fit (a panel
beside a list, like the series screen) and the two-column settings on a TV
could use it; neither is changed here.

## Scopes

A **scope** owns the keys while it is open. `Sheet.svelte` is a scope
(`use:focusScope`): arrows and Tab stay inside it, its first row takes focus
when it opens, and focus goes back to whatever opened it when it closes. The
screen under the scrim takes no keys — a press that would act there moves focus
into the sheet instead. Nor does it scroll: the sheet locks the page while it is
open (`lockPage()`, `src/lib/scroll-lock.ts`), so a drag on the scrim or a sheet
scrolled to its end no longer moves the library behind MORE, and the sheet's
own scroll is `overscroll-behavior: contain`.

The overlays that draw their own scrim rather than use `Sheet.svelte` take the
same lock (c1033): FILTER and BROWSE's filter, the SORT menu, NEW SHELF, the
update modal, the highlights page's EXPORT and its open highlight off the
desktop (where it fills the screen), and the image reader's READING and
highlight sheets and the text reader's quote sheet. Each scroller among them
contains its own overscroll. Three rules come with it:

- **A dropdown scrolls itself.** FILTER's panel and the SORT list hang under
  their cell, and used to reach their last rows by scrolling the page; locked,
  the page can't, so each is capped at `70dvh` and scrolls inside, as BROWSE's
  filter already did. Opening one low on a page still brings it into view,
  since a locked page is a scroller a script can move.
- **A cover a media query can hide holds the page only while it is drawn.**
  The desktop's top-bar FILTER is hidden with its cell below 1024px, open or
  not, and a plain lock left the page locked under nothing. The filter panels
  take `lockPageWhileShown(el)`, which lets go while the box is gone and takes
  the lock again when it comes back.
- **The text reader's CONTENTS and the player's sheets take no lock.** Each of
  those screens scrolls its own element (the text reader's `.page`, the
  player's rows) over a document that doesn't move, so locking the root would
  change nothing; they only contain their overscroll. The quote sheet takes the
  lock all the same, as every sheet drawn only while open does, though in the
  text reader it holds a page that was still already.

A scope is a stack, so a sheet opened from a sheet restores to the lower one.

**A scope's start.** A scope opens on its `data-focus-start`, or its first stop.
A panel that hosts another screen's list, and so cannot put the attribute in
that list's markup, names it instead: `use:focusScope={{ start: [selectors] }}`,
tried in order, the first that finds a stop winning, before the markup's own
start (c250). The text reader's CONTENTS is that: it hosts the series' own
`EntryList` and starts on the row being read (`#entry-<id> .entry-btn`), then
any row, never the list's `#` tool above them. BACK closes it, and focus goes
back to the CONTENTS cell, which the panel never removed.

**A scope closes when its sheet starts to leave, not when it is gone** (c445).
A sheet with `out:leave` ([`MOTION.md`](MOTION.md)) stays in the page for its
180 ms exit, and Svelte makes it `inert` the moment the exit starts, so
`focusScope` watches the attribute. Inert, the sheet stops being a scope at
once: a ↓ pressed in those 180 ms reaches the screen, not a sheet that takes
nothing. Focus then goes back to the opener **only if it was lost** (on the
body, or inside the leaving sheet), never over a place the screen has already
chosen: the text reader puts the pad on its scrubber when READING closes, and
the READING cell that opened it can still be there, since a footer brought back
before its own exit ended is the same element. A sheet opened again before it
was gone loses `inert` and becomes the scope again, and its opener is the one
that opened it this time (wave 24: the library's MORE, pressed while SERVERS
opened from the server cell was still leaving, gave focus back to the cell
when MORE closed). `tv-text-reader.e2e.ts` checks the first two;
`tv-servers.e2e.ts` the opener, in one task so the exit cannot end first.

**Opting out.** A screen that already reads the arrows puts `data-focus-off` on
its root and keeps every one of them:

- `ImageReader.svelte` (pages, scrolling a strip) and its panels, **while its
  chrome is hidden** — and everywhere off a TV, whatever the chrome. On a TV
  with the chrome up the pad walks the chrome's cells instead (c241): the
  page scrubber is the screen's start, ↓ reaches the chapter cells and
  READING, and the reader's own turn keys stand down. Its **end page** lifts
  the opt-out everywhere (c235), because there is no page left to turn;
- `TextReader.svelte` the same way (c241): opted out while its chrome is
  hidden, and off a TV always. At its end it lifts the opt-out everywhere,
  as the image reader does: the last volume's end page and the END · LAST
  AVAILABLE screen of a novel downloaded so far both take the pad, their
  ruled cells marked inside (c251);
- `VideoPlayer.svelte` (seek and volume) **while its bar is hidden**, on a TV
  only — except while SKIP or the next-episode card is up, which take the pad
  for themselves (c296). With the bar shown the pad moves among its cells and
  the seek bar, and the player's own arrows are the reader's again once BACK
  hides it (c235);
- `EntryList.svelte`'s scrub rail and `BookGrid.svelte` while reordering, which
  use the arrows themselves.

A sheet inside an opted-out screen is left alone too — unless it forces the
scope in (`use:focusScope={{ force: true }}`, the reader's page menu). A sheet
inside a reader whose chrome is up is a plain scope, the way it is on a tablet
(c241: the reader's READING, the text reader's).

**Within it.** Three attributes keep a screen's own controls out of the pad's way
without hiding them from Tab:

- `data-focus-skip` on a subtree: not an arrow stop (a tile's rating and FAV
  buttons — a tile is its cover, and its options are a held OK, c235);
- `data-focus-mark="in"` on a focusable cell of a ruled block: the mark is drawn
  inside it (see below);
- `data-focus-up` (and `-down`, `-left`, `-right`) on a control, with a
  selector: that arrow goes there instead of to the nearest thing. It is for
  the case the geometry cannot choose — the player's seek bar sends ↑ back to
  PLAY NOW, where the card's two buttons above it are equally near (c296).

**Text entries.** ←/→ keep the caret in a single-line input; ↑/↓ leave it. A
textarea or a contenteditable keeps all four. A `<select>` keeps ←/→ to change
its value in place (a remote has no other key for it) and lets ↑/↓ leave, or it
would trap the pad; no screen draws one now, the library's SORT being a
`ChoiceMenu` (c432), whose open list is a focus scope.

**A slider is a slider without being told** (c259). An element with
`role="slider"`, or a native `<input type="range">`, keeps the two arrows
along its axis for its own value and lets the other two leave: ← → on a
horizontal one (the default), ↑ ↓ on one that says
`aria-orientation="vertical"`. A remote has no other keys for a value and no
other way out of a row, so a new slider needs no attribute and cannot forget
one. A key it keeps is not touched by the layer: it reaches the slider's own
handler, or the browser's step for a native range. Before c259 a native range
kept all four, which trapped the pad in the player's DIM on a TV.

**Anything else that adjusts a value** says so with `data-focus-adjust` and
keeps ←/→ only, so ↑/↓ still leave it: the series screen's rating row (c238),
a `role="group"` of half-bar buttons, moves by half a bar, saved as it
changes. On a slider the attribute means the same ← → as before, and wins
over its axis. The reader's page scrubber and its dim slider (c241), the text
reader's two (c241), and the player's seek bar (c296) still carry it, from
before the rule; it now says what their role already does.

**The nearest decides.** The layer looks from the focused element outward and
the first slider, range or `[data-focus-adjust]` it meets rules: a slider
inside an adjusting row is its own slider, and a button inside one is the
row's (`arrowKept` in `keys.ts`, read off the DOM by `keepsArrow` in
`dom.ts`).

**The way out** is `data-focus-adjust="none"`: a slider that must not adjust
under the pad (its value moved some other way, or a screen that wants the
pad to walk past it) lets all four arrows go to the layer. A slider that
reads every arrow itself (the series' scrub rail) still opts out with
`data-focus-off`, as before.

**On every device.** The rule is the layer's, and the layer runs on a
keyboard too, where a slider that lost its arrows to the focus layer was a
broken slider. Measured at c259 (`rg -n 'role="slider"|type="range"' src/routes`, nine): off a
TV, every slider sits inside a `[data-focus-off]` screen (the readers'
chrome and sheets, the whole player) or opts out itself (the series' scrub
rail), and the layer never reads those keys, so the rule changes nothing
there, with one exception: the readers lift the opt-out at their end page,
where the chrome can still be up (a pointer at the edge brings it). There a
keyboard's ← → on the page scrubber, or on READING's dim, now reach the
slider's own handler, which steps the page or the dim, where before the
layer moved the mark off it; ↑ ↓ leave as before. c611 walks that state:
`tests/focus.e2e.ts` (the desktop project) puts the mark on the page
scrubber at the end page and wants a page step with the mark still on it.
On a TV the player's DIM range went the other way: as a native range it kept
all four arrows, and now keeps ← → and lets ↑ ↓ leave, pinned by
`tests/tv-player.e2e.ts` (c611).

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
- **The continue row** (`ContinueRow.svelte`, c860) answers a held OK, on the band and on ▶, with the options sheet a grid tile opens.
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
  3. **A dialog that is not a scope** — a lightbox, the new-shelf sheet — gets
     the same Escape, because it is the page's own to close and not the
     climb's to take from it.
  4. **Climb.** From inside a `[data-back-climb="<selector>"]` container, to the
     first stop that selector names — the library's grid climbs to the KIND
     band's chosen cell (the active shelf tab until c436). Only to a place out
     of full view: where that is already shown, BACK goes on to the screen's
     `[data-focus-start]`, or its top-left stop, and the page goes to the very
     top first (`scrollTo(0)`, header and all), then `reveal()`s the start.
     BACK never moves the mark downward. That one `scrollTo(0)` is the only
     script that scrolls after BACK (c543, wave 23: every `scrollTo`,
     `scrollBy`, `scrollIntoView` and `scrollTop` write logged with its stack
     for 6 s after BACK from deep in the grid). What moved the library off the
     top in loaded runs was the browser's own animated scroll from a ↓ with
     nothing below (see "Nothing that way"): an instant `scrollTo` does not
     stop it, so its remaining distance was applied from the top. On a TV the
     layer now scrolls for that key itself, and `tv-library-top.e2e.ts`
     samples `scrollY` every frame for 2 s after BACK and holds it still. **On a TV only** (the `TV`
     query), and never inside a `[data-focus-off]` screen: on a keyboard,
     Escape belongs to whatever listens for it (a tile's rating picker, the
     lookup panel), and a climb that took it left those open. `focus.e2e.ts`
     pins that a keyboard's Escape leaves focus where it was.
  5. **Nothing.** `window.tsundokuBack()` returns false and the app leaves or
     goes back natively (c236's contract, [`TV.md`](TV.md)). Escape is then
     left to the browser, because it is also the way out of a filter panel, a
     lightbox or a typed field; `BrowserBack`/`GoBack` take the history step
     themselves.

  A text entry keeps Escape (the go-to row's own cancel).

**A forced scope.** A dialog opened over a screen that reads its own keys can
say `use:focusScope={{ force: true }}`: the reader's page menu is that. Force
lets the dialog take the keys; it does not make its rows stops while they sit
inside the screen's `data-focus-off` (`isVisible` refuses anything under it),
so the screen lifts its opt-out while the dialog is open, as the image reader
does since c703, and the pad reaches it even though the page behind keeps every
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
  band cell, a bar cell, a list row. Those say so with `data-focus-mark="in"`.
- **On a cover tile**, the mark frames the cover, not the tile's title and
  rating bar: `CoverTile` and `BookTile` move it to the `.cover` child, and
  BROWSE's `ResultTile` (c864) draws it there too: its own three hairlines
  outweigh the global ring, so a focused tile had none, and in a grid with a
  1 px gap an outer ring on the tile would be painted under its neighbours.
  The cover's ring ends 7 px out, inside the tile's 10 px padding. Under
  FILTER's scrim the focused tile is lifted over it.
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

| Screen  | ids                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Library | `series-<id>` (the tile), `continue-<id>` (the resume cell), `shelf-<key>`, `library-more`, `library-server` (S1, the TV app's server cell) |
| Series  | `series-back`, `series-continue` (the bar's ▶ and the panel's), `entry-<id>`, `book-<id>`                                                   |
| BROWSE  | `result-<mangaId>` (a catalog tile, c864: back from its preview puts the mark on it again)                                                  |
| Sheets  | none: the opener is remembered in memory, not by id                                                                                         |

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
- **The reader keeps every arrow while its chrome is hidden (c241).** The
  design says ↓ reaches the chapters either side and READING from the page
  scrubber; with the chrome up it now does, on a TV. While the chrome is
  hidden — and off a TV, always — the arrows are the reader's own, because
  that is what turns pages and scrolls a strip.
- **←/→ on a `<select>` change its value**, rather than moving focus: a remote
  has no other key for it. ↑/↓ leave, so the control is not a trap. The rule
  stays for any `<select>` a screen adds; the library's SORT stopped being one
  in c432.
- **A tile's rating and FAV are not arrow stops.** The design's focus board
  draws the mark on the cover, and c235 puts the tile's options behind a held
  OK; stopping on three controls per cell would make a 6-wide grid unwalkable.
  Tab still reaches them.
- **BACK climbing the screen** (to the shelf's tab, then the first CONTINUE card)
  is c235's, and is built: see "The remote's other three keys".

## Tests

- `tests/focus-geometry.spec.ts` — the pure decision, and `canScroll` (c578):
  either end, the pixel of slack each way, and a scroller with nothing to
  scroll at both ends.
- `tests/focus-keys.spec.ts` — the remote's keys as decisions: which key is
  BACK, which is MENU, and a held OK that opens, clicks, or does neither when
  repeated or cancelled (c235); and the arrows a slider keeps (c259), every
  shape in every direction: a role, a range, a vertical one, the attribute on
  a slider and on a thing that is not one, `none`, and the nearest deciding
  (a slider inside an adjusting row, a button inside one, a slider's thumb).
- `tests/focus.e2e.ts` — keyboard only: an arrow starts focus and the mark is an
  ink frame (all devices); a sheet is a scope and gives focus back (tablet and
  phone bars); library → series → reader → back, focus restored (the reader leg
  writes progress, so tablet-portrait only; it owns Hoshi no Umi no Tabibito);
  and, on the desktop, the page scrubber at the end page steps the page with
  the mark still on it (c611).
- `tests/tv-series-sections.e2e.ts` — the series screen's columns as sections
  (c861), on a world of its own with a 60-chapter series: both directions at
  both ends of each column, crossing and the row left, and what ends that
  memory (a row gone, a fold closed, a reload, a new series) and what does not
  (a sheet, ← then ← again); a sheet inside the column keeping its keys; off a
  TV, the columns are no sections.
- `tests/tv-keys.e2e.ts` — OK held and MENU on a cover, a chapter row and a
  history row; BACK closing a sheet, climbing the KIND band → CONTINUE, and
  `window.tsundokuBack()` answering false at the top (c235). And c578's
  chain, on a page of scrollers built for the case on the live layer: ↓ moving
  the nearest scroller while it can, an inner one at its end handing ↓ to the
  outer, both at their end to the page, a box with `overflow: hidden` passed
  over, the page at its end moving nothing and throwing nothing, and ↑ at an
  inner scroller's top scrolling the page up. And c618: with the root locked
  (`html`, and `body`), ↓ moves nothing, while the same page still scrolls
  with no lock. And c861: a section's end moves nothing outside it, not even
  the page, with the step still running inside it.
- `tests/tv-browse-focus.e2e.ts` — the mark on BROWSE's tiles (c864): POPULAR,
  LATEST, a search, back from a preview and under FILTER's scrim, each reading
  the cover's computed ring and hitting all four sides and corners of it.
- `tests/tv-library-top.e2e.ts` — the pinned rows never covering the first
  row's focus ring (`reveal()`'s bar step), and one BACK from deep in the
  grid landing on the first CONTINUE card at the top and staying there, every
  frame for 2 s; and BACK pressed at once after a ↓ past the last row, which
  went red eight times in ten before the layer scrolled that key itself
  (c543); and SORT, and ↓ / ↑, kept drawn and holding the mark at every
  frame of a sort slow enough for the outline to draw LOADING beside them
  (c560; until then LOADING took their place, and wave 24 gave the mark back
  afterwards); and ← from the first collection's tab reaching ALL (c624);
  and the repro of a focused tile lost when the outline replaces the grid
  (c612, expected to fail until the library page gives the mark back).
- `tests/tv-reader.e2e.ts` — the reader's chrome as a focus row: OK brings it
  with focus on the scrubber, ↓ reaches READING, and the mode changes by keys
  alone (c241).
- `tests/tv-text-reader.e2e.ts` — the same for the text reader's LAYOUT
  (c241); a sheet leaving keeps no keys (c445); CONTENTS as a scope that
  starts on the row being read and gives the pad back to its cell (c250); and
  both ends of a book: the end page, and, on the spec's own seeded database,
  END · LAST AVAILABLE with its cells marked inside, rated and unrated (c251).
