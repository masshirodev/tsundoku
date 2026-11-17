# The design system ("Index")

tsundoku's look is a design system called **Index**: square, ruled, set in
IBM Plex, with mono for chrome, labels and numbers and sans for titles and
prose. Its palette is **Graphite / lime**, the dark default, and **Paper /
ink**, the light theme. This file is the reference for how it lives in the
code: the tokens, the words used for its parts, the components and where
each one is, the house rules, and where the code differs from the design on
purpose.

Before touching a component, read this file; before adding motion, read
[`../MOTION.md`](../MOTION.md).

## Terms

- **Index**: the design system itself, the name of the look as a whole.
- **Cell**: a box in a ruled row or grid, drawn by hairlines (`--line-1`)
  between it and its neighbours: a tab, a top-bar slot, an action in the bulk
  bar, a label in a sheet row, a rating half. A control is usually a cell, and
  a pressed or chosen cell **inverts** (ink ground, page-coloured text).
- **Band**: a full-width strip under a screen's top bar (or, for reveal,
  above it) that says one thing and offers at most one act: IMPORTING,
  ADDED, offline, incognito, a source not answering. Bands stack. Which ones
  can be dismissed, and why, is [`../BANDS.md`](../BANDS.md).
- **Mark**: the focus mark, the one way focus is drawn: a 4px frame of text
  ink held 3px off the thing by the page's colour. It is drawn outside
  something that stands alone (a cover, a button, a chip, a field) and inside
  a cell of a ruled block (`data-focus-mark="in"`), so it never crosses a
  hairline. Only `:focus-visible` draws it, so a finger or a mouse never sees
  it, and a keyboard gets exactly what a TV remote does
  ([`../FOCUS.md`](../FOCUS.md)). The "?" after a label that opens help is a
  different, smaller mark (`HelpMark.svelte`, [`../HELP.md`](../HELP.md)).
- **Door**: an entry point, any place in the app that opens a given screen or
  action. A screen with several entry points (IMPORT A BACKUP, from SETTINGS
  and from GET STARTED's step on the empty library, for instance) behaves the
  same whichever was used.

## Tokens

Every colour, size and duration comes from a token in `src/lib/styles/`,
never a literal in a component. `index.css` imports them in order.

| File                | What it holds                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `colors.css`        | The base palettes (graphite, lime, magenta; paper, green) and the semantic tokens, dark on `:root`, light on `[data-theme='light']` |
| `typography.css`    | `--font-mono`, `--font-sans`, `--font-serif`, and the `--type-*` shorthands                                                         |
| `spacing.css`       | `--space-*`, page padding, hit sizes, bar and header heights, the sidebar width, rules, rings, motion tokens                        |
| `base.css`          | Page ground, links, box sizing, thin scrollbars in the system's lines, and `.appear`                                                |
| `focus.css`         | The focus mark                                                                                                                      |
| `motion.css`        | The press, the hover tint, entrances (`.appear`, `.rise`, `.pop`) and screen transitions ([`../MOTION.md`](../MOTION.md))           |
| `layout.css`        | Per-device variables (`--pad`, `--header-h`, `--grid-cols`, `--cont-cols`, `--cont-count`) by media query                           |
| `tv.css`            | The TV's fixed sizes and its overscan-safe reveal frame ([`../TV.md`](../TV.md))                                                    |
| `fonts-mono.css`    | IBM Plex Mono, 400 and 500, from IBM's complete build                                                                               |
| `fonts-plex.css`    | Plex Sans, Serif, Sans JP and Sans KR, generated from `@fontsource` with woff2 only                                                 |
| `fonts-reading.css` | The text reader's extra faces (OpenDyslexic), loaded only once chosen                                                               |

### Colour

The semantic tokens are what components read:

| Token                                   | Use                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `--surface-page`, `--surface-panel`     | The page ground, and a raised panel or band                                 |
| `--surface-inverse`, `--text-inverse`   | An inverted cell: pressed, chosen, selected mode                            |
| `--line-1`, `--line-2`, `--line-subtle` | Hairlines; `--line-2` for a rule that must read on a panel                  |
| `--text-1`, `--text-2`, `--text-prose`  | Ink, dimmed ink, and long prose (a series' ABOUT)                           |
| `--accent`, `--on-accent`               | Lime in dark, green in light: the one thing to press, FAV, progress         |
| `--accent-highlight`, `--accent-select` | A highlight, and a selected list row's tint                                 |
| `--reveal`, `--on-reveal`               | Magenta, **reserved for reveal mode**: the banner, the frame, HIDDEN badges |
| `--scrim`                               | Under a sheet or menu                                                       |
| `--rating-on`, `--rating-off`           | Rating bars and the slider                                                  |
| `--cover-l`, `--cover-c`                | Lightness and chroma of a cover placeholder's tint, per theme               |

The screen design uses seven distinct colours and all seven are tokens, so a
palette change in `colors.css` carries everywhere. The theme switches with the
`/light` and `/dark` search commands, in the same idiom as `/reveal`, or a
device's synced setting.

### Type

Mono is chrome, labels and numbers; sans is titles and prose; serif is the
text reader's body. `--type-label` is set in capitals with
`--tracking-label` (0.06em). Latin, Japanese and Korean each take their own
face from one stack (`--font-sans` lists Plex Sans, then JP, then KR), so a
mixed title draws each script in its own Plex. The TV raises every
`--type-*` to a 15px floor (`layout.css`).

### Space and shape

`--radius` is 0: everything is square. Elevation is a scrim plus a full-ink
rule (`--rule-strong`) on a sheet's top edge, never a shadow or a blur. Hit
targets are at least `--hit-min` (44px; 56px on a TV), list rows
`--hit-row`. Covers are `--cover-ratio` (2 / 2.9).

The screen's interior density (10px tile padding, 8px gaps, 17px row titles,
18px/12px label padding) is hand-set: the screen design uses 15 distinct
lengths that sit on no ladder, and they do not round to the `--space-*`
tokens. They are transcribed as they are, and
[`tests/library-frame.e2e.ts`](../../tests/library-frame.e2e.ts) pins them so a
tidy-up cannot round them onto a ladder that was never there.

### Devices

Layout is decided by CSS media queries, not by props or script, so the
server's first paint is already the right layout. `src/lib/device.svelte.ts`
holds the same queries for what is rendered at all, mirrored exactly by
`layout.css`:

| Device  | Query                                   | Grid columns | Notes                                     |
| ------- | --------------------------------------- | ------------ | ----------------------------------------- |
| Phone   | `max-width: 599px`                      | 3            | 16px padding, 60px header, compact rows   |
| Tablet  | `min-width: 600px`                      | 6 (9 wide)   | 24px padding, 72px header, no sidebar     |
| Desktop | `min-width: 1024px` and `pointer: fine` | 8            | 64px header, the 248px sidebar            |
| TV      | `pointer: none` and `min-width: 900px`  | 6            | 48px safe sides, 56px header, D-pad focus |

`tests/library-layout.e2e.ts` checks the layouts with JavaScript switched off.

## Components

Svelte 5 components that read tokens through scoped CSS; none hardcodes a
colour.

### `src/lib/components/content/`

| Component     | What it is                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `Cover`       | A cover at 2:2.9, or the striped placeholder tinted by hue; dashed while still indexing           |
| `CoverTile`   | A library grid cell: cover, corner badges, title, rating bars; FAV and the rating edited in place |
| `BookTile`    | A book in a cover grid, with a meta line and a position badge ([`../BOOKS.md`](../BOOKS.md))      |
| `WorkTile`    | A Work in the library grid, one segment per part ([`../WORKS.md`](../WORKS.md))                   |
| `ContinueRow` | A CONTINUE row: cover, title, where reading got to, ▶                                             |
| `Badge`       | A square corner badge: `accent` (FAV), `page` (+N new), `inverse` (↓N cached), `reveal` (HIDDEN)  |
| `ProgressBar` | A fraction as a bar                                                                               |
| `RatingBars`  | The rating as five flat bars, a half being the left half of a bar; unrated draws no track         |
| `PageMenu`    | What a long-pressed page can become ([`../COVERS.md`](../COVERS.md))                              |
| `QrCode`      | A QR code drawn as SVG squares, encoded in the browser ([`../WIFI.md`](../WIFI.md))               |
| `FocusLine`   | The TV's line naming the focused cover in full ([`../TV.md`](../TV.md))                           |

### `src/lib/components/controls/`

| Component      | What it is                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`       | Square, uppercase mono; `lg` is the 56px empty-state action                                                                                 |
| `RatingSlider` | Five blocks each split in two, plus a 0 cell: drag or tap, snapping to halves ([`../RATINGS.md`](../RATINGS.md))                            |
| `ChoiceMenu`   | One choice out of a few: a cell with ▾ opening a list of blocky cells. Used instead of a native `<select>`, whose open list is the system's |
| `FilterPanel`  | FILTER's rows ([`../FILTERS.md`](../FILTERS.md))                                                                                            |
| `SearchField`  | The search input; the leading `/` is a prompt glyph, not part of the value                                                                  |
| `ShelfTabs`    | Shelves as a row of cells, or the desktop sidebar's column; links, so a shelf has a URL                                                     |
| `Switch`       | A square switch                                                                                                                             |
| `TagChip`      | A 44px chip, `namespace value count`, the outer two dimmed                                                                                  |

### `src/lib/components/chrome/`

| Component       | What it is                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `TopBar`        | A row of cells split by hairlines; `inverse` is multi-select, `strong` the full-ink rule under search |
| `Band`          | Most bands, with an optional ✕ ([`../BANDS.md`](../BANDS.md))                                         |
| `Banner`        | The reveal, progress and action bands                                                                 |
| `BulkBar`       | Pinned to the bottom while selecting: a RATE row over the actions, one cell each                      |
| `Sheet`         | A bottom sheet over a scrim, and a focus scope                                                        |
| `SheetRow`      | A labelled row in a sheet: a 120px label cell, then content                                           |
| `ConfirmSheet`  | Asking before something that cannot be taken back ([`../DELETING.md`](../DELETING.md))                |
| `SectionLabel`  | `01 — CONTINUE` on the left, a count or the sort on the right                                         |
| `PrivacyShield` | The blank cover drawn when the app goes to the background ([`../PRIVACY.md`](../PRIVACY.md))          |
| `Wordmark`      | The typeset wordmark; there is no logo                                                                |

### Elsewhere

| Where                         | What it is                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/components/waiting/` | The waiting set: `WaitingScreen`, `GridOutline`, `NavLine`, `StalledBand`, `SaveBand` ([`../WAITING.md`](../WAITING.md)) |
| `src/lib/components/help/`    | `HelpMark` (the "?"), `HelpSheet`, `InShort` ([`../HELP.md`](../HELP.md))                                                |
| `src/lib/components/start/`   | GET STARTED: `StartList`, `StartTrail`, `StartFirstDay` ([`../ONBOARDING.md`](../ONBOARDING.md))                         |
| `src/lib/components/lookup/`  | `LookupPanel`, shared by both readers ([`../JAPANESE.md`](../JAPANESE.md))                                               |
| `src/lib/press.ts`            | The press layer: every tap on anything pressable is drawn ([`../MOTION.md`](../MOTION.md))                               |
| `src/lib/motion.ts`           | The curves for Svelte transitions, and `out:leave`                                                                       |
| `src/lib/focus/`              | The focus layer a D-pad or keyboard moves ([`../FOCUS.md`](../FOCUS.md))                                                 |
| `src/lib/device.svelte.ts`    | The device media queries, for script                                                                                     |
| `src/routes/`                 | Screens, with their own components beside them (the series screen in `series/[id]/`, the readers in `read/[entry]/`)     |

## House rules

- **Tokens, never literals.** A value no token expresses is a question for
  this file or [`../MOTION.md`](../MOTION.md), not a new literal.
- **`--reveal` is only for reveal mode.**
- **Device layout is CSS**, never a prop decided after hydration.
- **Close every block.** A block set inside the page's padding (a list of
  steps, a table, a group of rows, a panel, a replica of a control) has all
  four sides: a 1px `--line-1` frame, with hairlines between its rows inside
  it. A block drawn only with rules above and below its rows is open at both
  ends and reads as loose lines, not a box. The one exception is a block that
  runs edge to edge of its container (a bar under the header, a list flush
  against the sidebar's rule, a band across the main column), where the
  container's edges close it. Code that breaks this is a bug.
- **Grids pad their last row** with empty cells in the page colour, wherever
  they are (the library, a person's page and its SERIES strip). A real
  library rarely fills its last row, and the `--line-1` ground would
  otherwise show as grey blocks.
- **A new overlay gets both halves of motion**: an entrance class and
  `out:leave`.

## Departures

Every place the code deliberately differs from the design, with the reason.
A difference not written here is a bug.

| Where                    | Differs from the design because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fonts                    | Self-hosted, not loaded from Google Fonts, because tsundoku works offline and a reader that loses its type when the network drops does not. Sans, Serif, JP and KR come from `@fontsource`; JP and KR are split into `unicode-range` chunks, so only the characters on screen are downloaded.                                                                                                                                                                                                                                                                                                          |
| Plex Mono                | Taken from IBM's complete build (`@ibm/plex-mono`), not Fontsource, because Google's subsets have `↑↓` but not `←→`, and every left or right arrow in the chrome (`R→L`, `TIDY NEW →`, `← SERIES`) fell back to another font and was drawn over its neighbours (`fonts-mono.css`).                                                                                                                                                                                                                                                                                                                     |
| Glyphs outside Plex Mono | `▶ ✕ ● ○ ▦ ☰` are in no Plex Mono build, so they fall back to the device's font rather than being set in Plex Mono. A 1.5px line-icon set is the remedy if one renders badly.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Plex Serif               | Added (400, 400 italic, 500, as `--font-serif`) for the text reader's body, which the system's sans and mono do not suit for long reading.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Component measurements   | Follow the screen, not the component sketch, where the two disagree: `SectionLabel` takes its top padding as a prop (18px above the first section, 24px elsewhere), `Banner`'s progress band is 16px/10px, the finished band is 60px with a 3px line gap, and the offline band is 48px on one line.                                                                                                                                                                                                                                                                                                    |
| Device layout            | Media queries rather than the sketches' layout props, because a prop is decided only after hydration, so the first paint would be the tablet layout on every device and then jump.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| "Desktop"                | A fine pointer on a wide screen, not a width, because a tablet in landscape is as wide as a desktop and still wants the touch layout with no sidebar. The TV is the other extreme: no pointer, at least 900px wide, and never also the wide layout.                                                                                                                                                                                                                                                                                                                                                    |
| Last grid row            | Padded with empty cells, because the design always draws full rows and a real library does not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Theme switching          | A search command (`/light`, `/dark`) and a setting, because the design draws no theme control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Incognito band           | On every screen outside the reader, under the reveal banner, not only in the library, so END is always one tap away.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The blank screen         | Drawn on every trip to the background, not only while reveal or incognito is on, because it costs nothing and the recent-apps thumbnail never shows a page ([`../PRIVACY.md`](../PRIVACY.md)).                                                                                                                                                                                                                                                                                                                                                                                                         |
| HISTORY                  | Pages by 60 days with EARLIER →, in place of a month rail ([`../HISTORY.md`](../HISTORY.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CONTINUE                 | Names a book in a series of books by its place ("Book 3"), because a book's own label is just "Book" and the design never drew a series of books in CONTINUE.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| The reader               | Always dark, whatever the theme. Its other differences are in [`../READER.md`](../READER.md) and [`../TEXT-READER.md`](../TEXT-READER.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The app icon             | Typeset, not drawn: 積 in Plex Sans JP on graphite. The system has no logo and draws no mark, but an installed app needs an icon, and every icon in the system is a set glyph ([`../INSTALL.md`](../INSTALL.md)).                                                                                                                                                                                                                                                                                                                                                                                      |
| Library tiles            | Edit FAV and the rating in place (a ☆ / FAV toggle in the cover's top-right corner, the rating slider over the tile's foot), where the design's tiles only display them ([`../LIBRARY.md`](../LIBRARY.md), "On the tile").                                                                                                                                                                                                                                                                                                                                                                             |
| The empty library        | Says to put files in the library folder and does not name the computer imports run on, because every install has its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Overlays                 | Fade in over `--motion-appear` (160ms, opacity only, `.appear`) and fade out with `out:leave`, rather than appearing at once. With the reader's double tap a single tap waits about 250ms to rule out a second, and controls that then snapped in felt abrupt.                                                                                                                                                                                                                                                                                                                                         |
| Motion                   | The design's motion is minimal and instant, which left most taps showing nothing until their result arrived. The press keeps the design's look, the inversion, but one layer draws it on everything pressable and holds it 100ms, and small things also sink to 0.97. A real pointer tints what it is over. Sheets rise on the drawer curve and leave the way they came, the update dialog grows in, and the next screen slides 40px in from the side it lies on (a reader fades; not on a TV). Paged turns in the readers follow the finger and slide ([`../MOTION.md`](../MOTION.md), "Page turns"). |

Behaviour the design never had to decide (what the library does with real
data) is in [`../LIBRARY.md`](../LIBRARY.md).
