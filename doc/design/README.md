# The design system ("Index")

tsundoku's look comes from a Claude Design project, direction **1b Index**, with
palette **2a Graphite / lime** as the dark default and **2d Paper / ink** as the
light theme. The project's own readme is the authority on the look itself, so
read [`handoff/readme.md`](handoff/readme.md) first. This file only covers how the
system got into the code.

- Project: `https://claude.ai/design/p/630f3cfa-f63f-4765-87a0-3c700e62dbda`
- Imported: 2026-09-22, all 91 files, byte-for-byte.

## `handoff/` is a mirror, not source

`handoff/` holds the design project exactly as it was exported, including
`support.js`, the React component sketches, the specimen cards and the
exploration canvas. Don't edit it. Prettier and ESLint skip it, and it's kept so
that a later change to the design can be diffed against what the code was built
from.

To refresh it, mirror the project again (`list_files` + `read_file` through the
`claude_design` MCP, decoding `&lt; &gt; &amp;`) over the top, then `git diff
doc/design/handoff` shows what the designer changed.

Which file is the spec:

| File                                                      | What it is                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Library Themes.dc.html`                                  | The exploration canvas. Turn 1 (four directions) and Turn 2 (four palettes) are history. Turn 3 is the chosen system in every state and on every device. |
| `Index Text Reader.dc.html`, `Text Reader States.dc.html` | The text reader's screen and its states (2026-09-23), from the brief `doc/briefs/done/TEXT-READER.md`. See `doc/TEXT-READER.md`.                         |
| `Index Library.dc.html`                                   | **The screen spec.** A single parametric screen (`state` × `device` × `palette`) that Turn 3 renders nine ways. Measurements come from here.             |
| `components/**/*.jsx`                                     | Sketches of the component set. They give the API and intent; where one disagrees with `Index Library.dc.html`, the screen wins (see Departures).         |
| `tokens/*.css`                                            | Tokens, transcribed into `src/lib/styles/`.                                                                                                              |
| `ui_kits/library/`                                        | A click-through prototype. Useful for intent (tap and long-press both open the sheet, for example), not for measurements.                                |

## Where it lives in the code

| Design system                                                    | Code                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `tokens/colors.css`, `typography.css`, `spacing.css`, `base.css` | `src/lib/styles/*.css`, verbatim apart from formatting                                         |
| `tokens/fonts.css` (Google Fonts)                                | `@fontsource/ibm-plex-{mono,sans}`, self-hosted (see Departures)                               |
| `styles.css`                                                     | `src/lib/styles/index.css`, plus `layout.css` for the per-device variables                     |
| `components/content/*`                                           | `src/lib/components/content/`: Badge, Cover, CoverTile, ContinueRow, ProgressBar, RatingBars   |
| `components/controls/*`                                          | `src/lib/components/controls/`: Button, RatingPicker, SearchField, ShelfTabs, Switch, TagChip  |
| `components/chrome/*`                                            | `src/lib/components/chrome/`: Banner, BulkBar, SectionLabel, Sheet, SheetRow, TopBar, Wordmark |

The components are Svelte 5 ports, not wrappers. Styles are scoped CSS that reads
tokens, and none of them hardcode a colour.

## Palette and scale, settled separately

`reconcile-tokens.mjs` on the screen spec found **7 distinct colours, all 7
already tokens**. So the code uses tokens and never literals, and a palette
change in `colors.css` carries everywhere.

It found **15 distinct lengths and no length ladder they sit on**. The `--space-*`
tokens exist, but the screen's interior density (10px tile padding, 8px gaps, 17px
row titles, 18px/12px label padding) is hand-set and doesn't round to them. The
literals are transcribed as they are, and
[`tests/library-frame.e2e.ts`](../../tests/library-frame.e2e.ts) pins them so a
later tidy-up can't round them onto a ladder that was never there.

## Departures

Every place the code deliberately differs from the design, with the reason. If a
departure isn't written down here, it's a bug.

1. **Fonts are self-hosted.** The design loads Plex from Google Fonts and notes
   "swap for self-hosted files in production". This is an offline-capable PWA on a
   tailnet, and a reader that loses its type when the Wi-Fi drops isn't
   offline-capable. Sans (and JP, KR) come from `@fontsource`. **Mono comes from
   IBM's complete build (`@ibm/plex-mono`) instead,** because Google's subsets
   (which Fontsource ships) include `↑↓` but not `←→`. Every left or right arrow
   in the chrome (`R→L`, `TIDY NEW →`, `← SERIES`) fell back to another font and
   was drawn over its neighbours. See `src/lib/styles/fonts-mono.css`.
   - **Known gap:** `▶ ✕ ● ○ ▦ ☰` aren't in any Plex Mono build, so the
     readme's "Unicode glyphs set in Plex Mono" is untrue for them. They fall
     back to the device's font. The design readme's own remedy, a 1.5px line-icon
     set, is the fix if one of them ever renders badly on the tablet.
2. **Screen over sketch.** Where a component sketch and `Index Library.dc.html`
   disagree, the screen wins. Concretely:
   - `SectionLabel` takes its top padding as a prop, because the screen uses 18px
     above CONTINUE and 24px elsewhere, and the sketch hardcodes 24px.
   - `Banner`'s progress band is 16px/10px, not the sketch's 14px/8px.
   - The finished band is 60px with a 3px line gap. The offline band is 48px on
     one line.
3. **Device layout is CSS, not props.** The sketches switch layouts with props
   (`compact`, `vertical`), which in SvelteKit would only be decided after
   hydration, so the server's first paint would be the tablet layout on every
   device and then jump. Grid columns, continue rows, the phone's compact row and
   the desktop sidebar are media queries in `src/lib/styles/layout.css` and the
   components. `tests/library-layout.e2e.ts` checks this with JavaScript switched
   off.
4. **"Desktop" means a fine pointer.** The design draws desktop at 1440px and
   landscape tablet at 1280px, both wider than 1024px. They're told apart by
   `(pointer: fine)`, so a tablet in landscape keeps the touch layout with no
   sidebar.
5. **The grid pads its last row** with empty cells in the page colour. The mock
   always has full rows. A real library doesn't, and the `--line-1` ground
   would otherwise show as grey blocks.
6. **The rating picker has six cells, 0–5, and 0 is unrated.** The library
   handoff drew seven (`—` then 0–5), and the series handoff drew six with no
   way back to unrated. The owner settled it on 2026-09-22: 0 is unrated. So
   every picker is the series one: six cells, none filled while unrated, the
   label reading UNRATED, and 0 clears a rating.
7. **Plex Sans JP and KR are self-hosted too**, for the series and reader
   titles. Fontsource splits them into `unicode-range` chunks, so only the
   characters on screen are downloaded.
8. **Theme switching is a search command** (`/light`, `/dark`), in the same idiom
   as `/reveal`. The Turn 3 matrix draws no theme control, and the UI kit's THEME
   button was a prototype convenience.
9. **Grids pad their last row everywhere,** not just the library's: the
   person page's grid and its SERIES strip do the same, for the same reason as 5.
10. **The incognito band is on every screen, not only the library.** The
    addendum puts it in the library. Outside the reader, the layout draws it
    under the reveal banner, so END is always one tap away.
11. **The blank screen is drawn on every trip to the background,** not only
    while reveal or incognito is on. It costs nothing, and the thumbnail never
    shows a page. Only when one of them was on does the return land on the
    library. See `doc/PRIVACY.md`.
12. **History pages by 60 days, with EARLIER →,** in place of `historyLong`'s
    month rail, which is deferred (`doc/HISTORY.md`).
13. **CONTINUE counts a book by its number** ("Book 3 of 4"). The mock never
    drew a series of books in CONTINUE.
14. **The reader is always dark** and uses the six-cell rating. Its other
    departures (no "↓ CACHED" claim before there's a device cache, the
    NOT DOWNLOADED boundary, dimmed rows in the READING sheet) are listed in
    `doc/READER.md`, next to the reader they describe.
15. **The app icon is typeset, not drawn:** 積 in Plex Sans JP on graphite. The
    readme says there is no logo and not to draw a mark, but an installed app
    needs an icon, and every icon in the system is a set glyph. See
    `doc/INSTALL.md`.
16. **Tiles edit FAV and the rating in place:** a ☆ / FAV toggle in the
    cover's top-right corner and the six rating cells over the tile's foot.
    The handoff's tiles only display them. See `doc/LIBRARY.md`, "On the tile".
17. **Plex Serif is self-hosted too** (`@fontsource/ibm-plex-serif`, 400,
    400 italic and 500), for the text reader's body, as `--font-serif`. The
    text reader's own departures are in `doc/TEXT-READER.md`.

Behavioural departures (what the library does that the mock never had to decide)
are in [`../LIBRARY.md`](../LIBRARY.md).
