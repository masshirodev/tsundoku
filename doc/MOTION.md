# Motion

How tsundoku moves, and when it doesn't. The owner asked on 2026-11-03 for it
to "feel more like an app and less like a website": most taps showed nothing
until their result arrived (card c396, "Make tsundoku feel like an app: every
tap lands, sheets and screens move"). This document is the rulebook that came
out of it. It's adapted from Kumiko's `doc/MOTION.md`, which translates Emil
Kowalski's animation standards (the `animate`, `review-animations`,
`improve-animations` and `animation-performance` skills on the workstation) to
plain CSS and Svelte. **Where this document and the skills disagree, this
document wins.**

It departs from the design handoff, whose motion is "minimal and instant"
(`design/handoff/readme.md`). The departure is number 20 in
[`design/README.md`](design/README.md), "Departures". The press look stays
the handoff's own: the cell inverts.

## The tokens

In `src/lib/styles/spacing.css`, beside the design's own `--ease` and
`--motion-fast`. The same values are written in `src/lib/motion.ts` and
`src/lib/press.ts`, where script needs them; keep the two in step.

| Token             | Value                            | For                                                    |
| ----------------- | -------------------------------- | ------------------------------------------------------ |
| `--ease`          | `cubic-bezier(0.2, 0, 0, 1)`     | The design's curve: fades (`.appear`), the switch knob |
| `--ease-out`      | `cubic-bezier(0.23, 1, 0.32, 1)` | Anything moving in or out: a press, a dialog, a screen |
| `--ease-drawer`   | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheets and panels, in and out                          |
| `--motion-fast`   | `120ms`                          | The switch knob (the design's)                         |
| `--motion-press`  | `140ms`                          | A press sinking and coming back                        |
| `--motion-appear` | `160ms`                          | Fades in (c185)                                        |
| `--motion-leave`  | `180ms`                          | Anything leaving; the old screen fading out            |
| `--motion-panel`  | `240ms`                          | Sheets rising, dialogs, the next screen sliding in     |

**Don't invent a sixth duration or a fourth curve.** A value the table can't
express is a question for this document. Constant motion (the waiting line's
fill, spinners) is `linear` or stepped, as `WAITING.md` says.

## Should it animate at all

Ask in this order, and stop at the first "no".

1. **How often is it seen?** A reader turns pages hundreds of times a sitting:
   **page turns, scrolling and zoom never animate for style**, and the readers'
   next chapter or episode is the same screen, so no screen transition plays
   for it either. Things seen tens of times a day (a press, a hover) get a fast,
   small change. Occasional surfaces (sheets, dialogs, a new screen) get the
   standard motion.
2. **What is it for?** Name it: a tap was heard, where something came from or
   went, a state change made legible. If none fits, it doesn't animate.
3. **Is the person reading it?** What's being read doesn't move for style.

## Pressing

Every tap is drawn, by one layer for the whole app (`src/lib/press.ts`,
installed by the root layout; the CSS is `src/lib/styles/motion.css`). Left to
`:active`, the press was drawn on a handful of components and seen on fewer: a
quick tap on a phone ends before `:active` paints, and iOS doesn't apply it at
all without a touch listener.

- A pointer going down on anything pressable (`PRESSABLE` in `press.ts`: links,
  buttons, summaries, checkbox labels and the button-like roles) marks it
  `data-pressed`. It **inverts** (`--surface-inverse` / `--text-inverse`), and
  when it is no wider than 360px it also **sinks** to `scale: 0.97` over
  `--motion-press` on `--ease-out`.
- The press is **held at least 100 ms**, so a quick tap is seen.
- A finger waits **60 ms** before pressing, and a finger that moves more than
  10px is scrolling: a scroll that starts on a tile doesn't flash it. A mouse
  presses at once.
- Anything covering more than a quarter of the screen isn't pressed: it's a
  surface (a scrim, a reader's tap zone).
- An element can choose with `data-press`: `off`, `scale` (sinks, keeps its
  colours: a switch is one by its role), `fill` (inverts, doesn't sink), `both`.
- Disabled things, and things under `[inert]`, are never pressed.
- The navigation's own press (`.nav-pressed`, `WAITING.md`) carries on from
  there: it holds the inversion until the next screen draws.
- Reduced motion keeps the inversion and drops the sink.

The components' own `:active` rules (Button's outline and ghost, CoverTile)
still apply where the layer doesn't run, before hydration for one.

## Hovering

A pointer over something pressable tints it: a gradient of 9% of its own text
colour over its own background, so it works on any colour, and it leaves
box-shadows alone, which are the focus mark and reveal's frame. **Only under
`(hover: hover) and (pointer: fine)`**: a tap fires a false hover on touch, and
a TV has no pointer. Scrims, `data-press="off"` and `"scale"`, and anything
with an inline `background-image` (the player's thumbnails) are left out. The
tint is a colour change, so it is instant and isn't gated by reduced motion.

## Arriving and leaving

Everything that appears over the page leaves **the way it came**, with
Svelte's `out:leave` (`src/lib/motion.ts`). A leaving element takes no taps,
so a second tap on a closing scrim can't land. That's in the leave's own
frames, not set on the element: a sheet opened again before it's gone is the
same element, resumed, and it must take taps again.

| Thing                                          | In                                       | Out                   |
| ---------------------------------------------- | ---------------------------------------- | --------------------- |
| Scrims, the readers' bars, tap zones, overlays | `.appear`: fade, `--motion-appear`       | `out:leave` (fade)    |
| Bottom sheets (`Sheet`, PageMenu, READING, …)  | `.rise`: up from the bottom edge, drawer | `out:leave={'down'}`  |
| The same sheets on a TV, where they're panels  | `.rise`: in from the right               | to the right          |
| The player's side panels (PLAYBACK, KEYS)      | `.rise .rise-right`                      | `out:leave={'right'}` |
| A centred dialog (the update dialog)           | `.pop`: fade and grow from 0.96, never 0 | `out:leave={'pop'}`   |

Sheets slide with `translate`, never `transform`, so a sheet's own transform is
never fought. A sheet is opaque and doesn't fade while it slides. Under reduced
motion, entrances and exits keep their fades and lose their movement: the
same rule `.appear` has kept since c185, and a deliberate difference from
Kumiko, which zeroes everything.

**A new overlay gets both halves:** the entrance class and `out:leave`.

## Screens

The next screen moves in as it's drawn: the root layout works out the move as
the navigation starts (`screenMove` in `src/lib/motion.ts`), and once the new
screen is in the page, before it's painted, puts it on `.main` as
`data-arrived`. The screen's own elements then play a CSS animation (the end of
`motion.css`).

- **Deeper slides in from the right, shallower from the left, side by side
  fades in.** Depth is the route's path length (`depthOf`). Back and forward
  follow history.
- It moves **40px** and fades in, over `--motion-panel` on `--ease-out`.
  Enough to say where it came from, not enough to wait for. The old screen
  goes at once.
- **It's the real screen that moves, never a View Transition.** The first build
  used one, and while a View Transition plays Chromium sends every tap to
  `<html>`, whatever its pictures' `pointer-events` say: the reader lost the
  first tap after it opened (`reader-layout.e2e.ts` caught it). Nothing covers
  the moving screen, so a tap lands on it from the first frame
  (`motion.e2e.ts`, "a tap the moment a screen arrives").
- **The same screen doesn't move:** a shelf tab, a filter, the reader's next
  chapter, the player's next episode.
- **Into and out of a reader it only fades.** A reader is fixed to the screen,
  and a moving ancestor holds everything fixed inside it to its own box for as
  long as it moves. Elsewhere that's only a sheet opened within the first
  240 ms, which is accepted.
- **Once it has arrived, the screen holds nothing.** The animation fills
  `backwards`, never `both` or `forwards` (c426). A finished animation that
  keeps filling its last frame still sets `translate: 0px` on the screen, and
  that makes the screen the containing block of everything fixed inside it,
  for good: FILTER's scrim began a sidebar's width past the sidebar and was
  only as tall as the library, and a sheet's scrim missed the screen's left
  edge. `motion.e2e.ts` measures both scrims against the viewport after a
  navigation, and checks a screen at rest has `translate: none`.
- **A slow screen's outline is what slides in.** From 150 ms the next screen's
  outline shows (`WAITING.md`). It carries `data-arrive`, and `.main` carries
  `data-arriving` from the moment the navigation starts, so the outline slides
  in as it appears. The real screen then only fades over it, since sliding
  again would arrive twice.
- **Not on a TV** (`pointer: none`): the remote moves a key at a time, and the
  ten-foot layout answers a key at once.
- Reduced motion fades only.

## Checking feel

Code can't settle feel. When it matters, slow animations down in DevTools'
Animations panel, step frame by frame, try taps and scrolls on the tablet and
the phone themselves, and look again the next day. `tests/motion.e2e.ts`
checks the mechanics on every device (the press and its hold, the scrim, a
sheet leaving and being opened again before it's gone, the screen moving both
ways, a tap the moment it arrives, the slow screen's outline, the hover, and
the scrims' boxes once a screen has arrived);
`tests/tv-motion.e2e.ts` checks a TV's screens don't move;
`tests/motion.spec.ts` covers the decisions.

## Known debt

- FILTER's panel opens and closes at once. It's a `<details>`, and a closing
  one hides its content before anything can run. An entrance was tried: inside
  a `<details>` opened without script, Chromium never let it settle
  (`filters-flow.e2e.ts`, "without script…"), and why isn't understood yet.
- Hover tints appear and go at once: a gradient can't be transitioned. A
  pseudo-element overlay could fade, but every component would have to give up
  its own `::after`.
- Menus that scale from their trigger: tsundoku has none yet, since every menu
  is a sheet. When one comes, it scales from 0.96 with `transform-origin` on
  the control's side.
