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

| File                                                                                                                                                                                                                                                                                                                                                                   | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Library Themes.dc.html`                                                                                                                                                                                                                                                                                                                                               | The exploration canvas. Turn 1 (four directions) and Turn 2 (four palettes) are history. Turn 3 is the chosen system in every state and on every device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Index Text Reader.dc.html`, `Text Reader States.dc.html`                                                                                                                                                                                                                                                                                                              | The text reader's screen and its states (2026-09-23), from the brief `doc/briefs/done/TEXT-READER.md`. See `doc/TEXT-READER.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Loading States.dc.html`                                                                                                                                                                                                                                                                                                                                               | Waiting on every screen (2026-09-23), from the brief `doc/briefs/done/LOADING.md`. See `doc/WAITING.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Index Series Download.dc.html`, `Index Downloads.dc.html`, `Download States.dc.html`                                                                                                                                                                                                                                                                                  | Downloading through Suwayomi (2026-10-04): the series screen with its DOWNLOAD row, the queue, source search and the preview, from the brief `doc/briefs/done/DOWNLOADS.md`. See `doc/DOWNLOADING.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Index-Browse.dc.html`, `Index-Extensions.dc.html`, `R1-Browse.dc.html` … `R8-Hidden.dc.html`, `Browse Calls.dc.html`, `Browse canvas.json`                                                                                                                                                                                                                            | Browsing sources, extensions, repositories and a source's settings (2026-10-28), from the brief `doc/briefs/BROWSE.md`, card c126. See `doc/BROWSE.md`. The two `Index-*` files are the parametric screens (a `state` prop); `R1`–`R8` lay out the brief's states; `Browse Calls.dc.html` is the designer's decisions and answers (the canvas's `Main.dc.html`, renamed so the two canvases' mains don't collide). Canvas: `https://claude.ai/artifact/12d7e7f2-9c99-4c3f-a36e-cbc9146d0e9d`.                                                                                                                                                                     |
| `Index Player.dc.html`, `Index Anime Series.dc.html`, `Index Anime Library.dc.html`, `Anime States.dc.html`, `Player States.dc.html`, `Player Waiting.dc.html`, `Anime Calls.dc.html`, `Anime canvas.json`                                                                                                                                                             | Anime and the player (2026-10-28), from the brief `doc/briefs/PLAYER.md`, card c128. The three `Index *` files are parametric; the three States boards lay out the brief's states; `Anime Calls.dc.html` is the designer's decisions (the canvas's `Main.dc.html`, renamed). Canvas: `https://claude.ai/artifact/3452ab55-76d7-454a-93ee-bd653bcac29e`.                                                                                                                                                                                                                                                                                                           |
| `Online Calls.dc.html`, `Online Board Series.dc.html`, `Online Board Reader.dc.html`, `Online Board Text-Player.dc.html`, `Online Board History-Devices.dc.html`, `Online-Preview.dc.html`, `Online-Series.dc.html`, `Online-Reader.dc.html`, `Online-Text.dc.html`, `Online-Player.dc.html`, `Online-History.dc.html`, `Online canvas.json`                           | Reading and watching online, before adding (2026-10-29), from the brief `doc/briefs/READING-ONLINE.md`, card c161. `Online Calls.dc.html` is the designer's decisions and the four questions' defaults (the canvas's `Main.dc.html`, renamed); the `Online Board *` files lay out each board's states and import the `Online-*` screens by name, which is why those keep theirs. Downloaded as a zip (the canvas hit its deploy limit); canvas: `https://claude.ai/artifact/5Zg7hSTiqf6h3LNBUcFfmj`.                                                                                                                                                              |
| `Wifi.dc.html`, `Wifi-Phone.dc.html`, `Wifi-Board-PC.dc.html`, `Wifi-Board-Phone.dc.html`, `Wifi Calls.dc.html`, `Wifi canvas.json`                                                                                                                                                                                                                                    | Reading on a phone over home Wi-Fi (2026-10-30), from the brief `doc/briefs/done/WIFI.md`, card c188. See `doc/WIFI.md`. `Wifi.dc.html` (SETTINGS › 08 — DEVICES on the computer) and `Wifi-Phone.dc.html` (the phone) are the parametric screens (a `state` prop); the two boards lay out their states; `Wifi Calls.dc.html` is the designer's decisions and answers (the canvas's `Main.dc.html`). `Phone` and `Board-*` were renamed with a `Wifi-` prefix so later canvases' generic names can't collide; their `<dc-import name="Wifi"\|"Phone">` lines still name the originals. Canvas: `https://claude.ai/artifact/23f7687c-f43c-44bf-a2d4-c98b91bfea32`. |
| `Settings Calls.dc.html`, `Settings Board States.dc.html`, `Settings Board Devices.dc.html`, `Settings.dc.html`, `Reach.dc.html`, `Settings canvas.json`                                                                                                                                                                                                               | One settings page (2026-10-29), from the brief `doc/briefs/SETTINGS.md`, card c171. `Settings Calls.dc.html` is the designer's decisions and the four questions' defaults (the canvas's `Main.dc.html`, renamed); the two `Settings Board *` files lay out the states and the devices and import `Settings` and `Reach` by name, which is why those keep theirs. Downloaded as a zip.                                                                                                                                                                                                                                                                             |
| `Start Calls.dc.html`, `Start-Checklist.dc.html`, `Start-Steps.dc.html`, `Start-Start-Phone.dc.html`, `Start-WayBack-Arrive.dc.html`, `Start-WayBack-Done.dc.html`, `Start-FirstDay.dc.html`, `Start-Update.dc.html`, `Start-Update-States.dc.html`, `Start-Update-Checklist.dc.html`, `ob.css`, `Start canvas.json`                                                   | Getting started and an update on entry (2026-10-31), from the brief `doc/briefs/GETTING-STARTED.md`, card c208. See `doc/UPDATES.md` ("Told on entry"). `Start Calls.dc.html` is the designer's decisions and answers (the canvas's `Main.dc.html`); every other board was prefixed `Start-` so later canvases' generic names can't collide, and `ob.css`, which they all link, keeps its name. Canvas: `https://claude.ai/artifact/f447ba73-87f9-422b-8069-d4d0c7250b5e`.                                                                                                                                                                                        |
| `FirstRead Calls.dc.html`, `FirstRead-List.dc.html`, `FirstRead-Steps.dc.html`, `FirstRead-Phone.dc.html`, `FirstRead-Search.dc.html`, `FirstRead-Preview.dc.html`, `FirstRead-Added.dc.html`, `FirstRead-Done.dc.html`, `FirstRead-Next.dc.html`, `FirstRead-Counts.dc.html`, `fr.css`, `ds/tsundoku/tokens.json`, `FirstRead canvas.json`                            | GET STARTED's second part, FIRST READ (2026-10-31), from the brief `doc/briefs/FIRST-READ.md`, card c209. See `doc/ONBOARDING.md`. `FirstRead Calls.dc.html` is the decisions (the canvas's `Main.dc.html`); every other board was prefixed `FirstRead-` so later canvases' generic names can't collide, and `fr.css`, which they all link, keeps its name. Downloaded as a zip.                                                                                                                                                                                                                                                                                  |
| `Help Calls.dc.html`, `Help-Board.dc.html`, `Help.dc.html`, `Ask.dc.html`, `Help canvas.json`                                                                                                                                                                                                                                                                          | HELP and the ? (2026-10-31), from the brief `doc/briefs/HELP.md`, card c208. `Help Calls.dc.html` is the decisions (the canvas's `Main.dc.html`); `Help-Board.dc.html` lays out the states and imports `Help` and `Ask` by name, which is why those keep theirs. Canvas: `https://claude.ai/artifact/fa9c535d-5b41-429f-95dc-495f1c0c082a`.                                                                                                                                                                                                                                                                                                                       |
| `Migrate Calls.dc.html`, `Migrate-Start.dc.html`, `Migrate-Player.dc.html`, `Migrate-Choose.dc.html`, `Migrate-Compare.dc.html`, `Migrate-Moved.dc.html`, `Migrate-Season.dc.html`, `Migrate-Phone.dc.html`, `mv.css`, `Migrate canvas.json`                                                                                                                           | Moving a series to another source, MOVE (2026-11-01), from the brief `doc/briefs/MIGRATE.md`, card c139. `Migrate Calls.dc.html` is the designer's decisions and answers (the canvas's `Main.dc.html`); every other board was prefixed `Migrate-` so later canvases' generic names can't collide, and `mv.css`, which they all link, keeps its name. Canvas: `https://claude.ai/artifact/ead1bd2c-36bd-4563-b35f-01e3591c4be1`.                                                                                                                                                                                                                                   |
| `TV Calls.dc.html`, `TV-Focus.dc.html`, `TV-Board-Library.dc.html`, `TV-Board-Series.dc.html`, `TV-Board-Player.dc.html`, `TV-Board-Reader.dc.html`, `TV-Board-SearchPair.dc.html`, `TV-Board-States.dc.html`, `TV-Library.dc.html`, `TV-Series.dc.html`, `TV-Player.dc.html`, `TV-Reader.dc.html`, `TV-Search.dc.html`, `TV-Pair.dc.html`, `tv.css`, `TV canvas.json` | tsundoku on a TV with a remote (2026-11-01), from the brief `doc/briefs/TV.md`, card c233. See `doc/TV.md`. `TV Calls.dc.html` is the designer's decisions, sizes, the media query, the remote's keys and the four questions' answers (the canvas's `Main.dc.html`, renamed); the `TV-Board-*` files lay out each board's states and import the six parametric `TV-*` screens by name (a `state` prop, and `palette` on most). `tv.css`, which they all link, keeps its name. Canvas: `https://claude.ai/artifact/91833e89-1e36-4d09-9f98-077c88bcf921`.                                                                                                          |
| `Track Calls.dc.html`, `Season-Panel.dc.html`, `Season-Rows.dc.html`, `Season-Find.dc.html`, `Season-Sequels.dc.html`, `Season-Sheet.dc.html`, `Season-Phone.dc.html`, `tk.css`, `Track canvas.json`                                                                                                                                                                   | Anime tracked a season at a time (2026-11-01), from the brief `doc/briefs/ANIME-TRACKING.md`, card c240. `Track Calls.dc.html` is the designer's decisions and answers (the canvas's `Main.dc.html`); the boards kept their `Season-` names, and `tk.css`, which they all link, keeps its name. Downloaded as a zip.                                                                                                                                                                                                                                                                                                                                              |
| `Works Calls.dc.html`, `Seasons-Group.dc.html`, `Seasons-Series.dc.html`, `Seasons-Newcomer.dc.html`, `Work-Library.dc.html`, `Work-Screen.dc.html`, `Work-Row.dc.html`, `Work-End.dc.html`, `Work-EndStates.dc.html`, `Work-Group.dc.html`, `Work-States.dc.html`, `Work-Phone.dc.html`, `wk.css`, `Works canvas.json`                                                | Anime seasons as one series, and a Work that leads into the next (2026-11-02), from the brief `doc/briefs/done/WORKS.md`, cards c215 and c216. See `doc/WORKS.md`, which records where the build departs (a Work's derived rating and FAV, the owner's call). `Works Calls.dc.html` is the designer's decisions (the canvas's `Main.dc.html`); the boards kept their `Seasons-` and `Work-` names, and `wk.css`, which they all link, keeps its name. Mirrored file by file with `read_file` (each checked against the artifact's sha256); canvas: `https://claude.ai/artifact/LMzdUzR8JemZer1tS3ECQq`.                                                           |
| `Index Library.dc.html`                                                                                                                                                                                                                                                                                                                                                | **The screen spec.** A single parametric screen (`state` × `device` × `palette`) that Turn 3 renders nine ways. Measurements come from here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `components/**/*.jsx`                                                                                                                                                                                                                                                                                                                                                  | Sketches of the component set. They give the API and intent; where one disagrees with `Index Library.dc.html`, the screen wins (see Departures).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tokens/*.css`                                                                                                                                                                                                                                                                                                                                                         | Tokens, transcribed into `src/lib/styles/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ui_kits/library/`                                                                                                                                                                                                                                                                                                                                                     | A click-through prototype. Useful for intent (tap and long-press both open the sheet, for example), not for measurements.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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

## The published design system

The system as the code now has it is also published as a Claude Design System
artifact, **tsundoku**: `https://claude.ai/artifact/HFPS3mJVpRM9WjuzvYy92T`.
It was synced from `main` at `c6c97f4` on 2026-10-29 (UTC): `tokens.json`, the
self-hosted Plex faces (Latin subsets), a brand book, static cards for 19
components (their CSS transcribed under `ts-` class names in
`components/bundle.css`) and the app icons.

It is a different thing from the Claude Design project above. The project is
where the look was designed and `handoff/` mirrors it; the artifact is a
read-out of what the code became, departures included, for a designer to build
new screens on. So:

- **A new brief points the designer at it** alongside the repository, so a new
  screen starts from the tokens and components as shipped rather than from the
  2026-09 exploration.
- **It is downstream of the code, never a source.** Nothing in `src/` is
  regenerated from it. When tokens or components change, resync it from the
  repository; until then it describes `c6c97f4`.
- **Its README's "Not synced" section is what it leaves out:** the `--type-*`
  shorthands, motion, per-theme cover numbers and device variables (in
  `bundle.css` instead), Plex Sans JP/KR, and the components with no card
  (BookTile, PageMenu, FilterPanel, ConfirmSheet, PrivacyShield, LookupPanel,
  the waiting set).

### Rules written there first

The rules below got into the artifact's README before the code
followed them, so for these the artifact is ahead of `src/`. They are house
rules all the same: new work follows them, and code that breaks one is a bug to
fix, not a departure. When the code has caught up, the artifact goes back to
being downstream.

- **Close every block** (added 2026-10-31, under "Corners, borders,
  elevation"). A block set inside the page's padding (a list of steps, a table,
  a group of rows, a panel, a replica of a control) has all four sides: a 1px
  `--line-1` frame, with hairlines between its rows inside it. A block drawn
  only with rules above and below its rows is left open at both ends and reads
  as loose lines, not a box. The one exception is a block that runs edge to edge
  of its container (a bar under the header, a list flush against the sidebar's
  rule, a band across the main column), where the container's edges close it.
  The code has not been audited against this rule yet.

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
   sidebar. **"TV" is the other pointer extreme:** `(pointer: none)` on a screen
   at least 900px wide, and `WIDE` excludes it, so a 1280px TV is not also the
   wide layout. It is the ten-foot layout in [`../TV.md`](../TV.md).
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

18. **What appears over the page fades in** (asked 2026-10-29, card c185). The
    handoff's motion is "minimal and instant": its one transition is the switch
    knob. With the double tap, a single tap in the reader waits ~250 ms to rule
    out a second, and controls that then snapped in felt clunky. So the readers'
    controls, every sheet, menu and scrim fade in over `--motion-appear` (160 ms)
    on the design's own `--ease`, opacity only, through one class, `.appear`
    (`src/lib/styles/base.css`). In only: they still go at once. The video
    player's bars, which already faded both ways at 0.15s, use the same token.
19. **The empty library doesn't mention the workstation** (2026-10-30, card
    c187). The handoff's line opens "Imports run on the workstation.", true of
    the owner's install and nonsense on a friend's, which has none
    ([`../DISTRIBUTION.md`](../DISTRIBUTION.md)). It now starts at "Put files in
    the library folder…". The handoff's copies are left as drawn.
