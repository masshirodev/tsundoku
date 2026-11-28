# Settings

`/settings`, one page with every setting on it. Settings also live where
they're used, in the READING sheet, the text reader's sheet, the
player's sheet and FILTER. This page is the overview. It shows each setting
once, says where it's kept, and sets the defaults the in-place controls start
from.

**Where it's said:** each row ends in a **scope cell**, and a legend at the top
says what the three kinds mean.

- **ALL DEVICES**: the workstation's `settings` table, one value everywhere.
  Shown in text-2, as the quiet common case.
- **THIS TABLET** (or THIS PHONE, THIS DESKTOP): the device's own value, kept in
  its browser and mirrored on the workstation (see "Devices"). Shown in ink.
- **DEFAULT · EVERY DEVICE**: where things start, which a series can differ
  from. It comes with **N SERIES DIFFER →** when some do.
- **EACH EPISODE**: SPEED, listed but not set here.

The catalogue of every setting is `src/lib/settings/catalog.ts`. It records
where each value is kept, its default, and its row, and the page, the
readers and the server all read that one list. The page's words come from
`settings/lines.ts`. Library values are read and written through
`server/settings-page.ts` (`libraryValues`, `setLibraryValue`, which accepts
only what the row offers and stores the default as a reset).

## Changed, reset, undo

- A value off its default gets **accent's 3px rule** on the row's left edge
  (accent means yours), and **RESET** in its scope cell. RESET says what the
  value goes back to: RESET TO 100%, RESET · FOLLOW, RESET · ALL KEPT,
  RESET · DEVICE'S.
- The section header counts **N CHANGED** and offers **RESET SECTION** (RESET on
  the phone). It applies at once, with no confirm. A band then says what
  moved (`ZOOM 125% → 100% · CROP BORDERS ON → OFF`), with **UNDO**. A single
  row's RESET puts the same band on that row. The band goes when you leave
  the page (`resetMoves`, `movesLine`).
- A reset **removes** the value, rather than storing the default. A library
  reset deletes the `settings` row; a device reset is a stamped removal. A
  later change of default then reaches it.

## 01 — Reading · manga and manhwa

- **MODE**: where a series of each kind starts, for MANGA, MANHWA and DOUJIN
  (R→L, L→R, VERT.). These are the settings `mode_manga`, `mode_manhwa` and
  `mode_doujin`, read by `kindDirection` and passed to `effectiveDirection` on
  the series screen and in the reader. REMEMBER in the reader makes a series
  differ. **N SERIES DIFFER →** opens the series reading against their
  kind's default. ✕ puts one back (`direction` NULL), and CLEAR ALL N puts
  them all back. A stored `direction` equal to the default is on no line, and
  ✕ leaves it (below, 02).
- **FIT, ZOOM, SPREADS, CROP BORDERS, WIDE PAGES, SIDES, BLOCKS**: the
  device's own, under the same `tsundoku.reader.*` keys the reader uses
  ([`READER.md`](READER.md)).
  - **ZOOM** shows all four kept values (paged and vertical, phone and
    wider), and **IN USE** on the two this screen uses.
- **DIM** is listed with its value and no control: a dim set without the page
  behind it is a guess.
- **CURSOR** (`tsundoku.reader.cursor`, off) is both readers': on hides
  the cursor after three seconds without the mouse moving. It is listed on every
  device, though only a mouse has a cursor, so the READING sheets leave their row
  out where there is none and this one says WITH A MOUSE.

Two rows close 01's strip settings: **CHAPTERS** (RUN ON
| STOP AT THE END) and **TO THE TOP** (OFF | ON), both this device's, both
vertical only ([`READER.md`](READER.md), "Two choices for the strip"). After them, **TAP ZONES** (OFF | ON, on): the
paged reader's zones drawn as a chapter opens, by finger ([`READER.md`](READER.md),
"Touch").

## 02 — Reading · novels

- **LAYOUT**: a novel's default, PAGED or SCROLL (`mode_novel`). It is counted
  like MODE, and a novel kept **R→L** counts too: a novel's page direction is
  per series only (`series.text_direction`;
  [`TEXT-READER.md`](TEXT-READER.md), "Direction"), with no SETTINGS default,
  so NULL, L→R, is what it differs from. A chosen `'ltr'` reads as NULL does
  and is not counted. A novel that
  differs in both is counted once, and its line says both (`PAGED · R→L ·
NOVEL · CHOSEN IN THE READER`, `src/routes/settings/mode-line.ts`). ✕ and
  CLEAR ALL N clear **only what the line names**: a `direction` that differs goes to NULL, and R→L goes to
  NULL. A novel listed only for R→L keeps a `direction` stored equal to the
  LAYOUT default: REMEMBER stored it as a choice, so it does not start
  following a later change of default (when the default does change, that
  series then differs, and its line says so). A chosen `'ltr'` has nothing for
  the line to name, since it reads as NULL does, and ✕ clears it with the rest
  of the series' page direction: left behind, it would travel through a
  later fold as a choice the reader had just cleared. A comic's `text_direction`, left from a time it was a
  novel, is neither counted nor cleared, and a kind with no default of its
  own (an anime) is never listed, so a posted id of one changes nothing
  (`clearModes`, `src/lib/server/settings-page.ts`).
- **PAGE, TYPEFACE, SIZE, MARGINS, COLUMNS, JUSTIFY, FURIGANA**: fields of the
  text reader's `tsundoku.text.settings` object
  ([`TEXT-READER.md`](TEXT-READER.md)).
  - **SIZE** steps from the device's own size (`baseFontSize`) until it's
    changed.

## 03 — Watching

- **AUDIO** and **SUBTITLES** (track and size) start on **FOLLOW THE PLAYER**,
  the "none set" state. The meta line says what stands in: the last choice,
  where and when (`JA, ON HOLLIN'S FERRY YESTERDAY`). A hidden series is
  never named while reveal is off.
  - With a default set, the line says what every anime starts in, unless a
    series differs.
  - Before any choice, the original plays.
  - The player's order is `startTracks`: the series' own choice, then the
    default, then the last choice, then the original. Choices are kept in
    `series_player` (migration 53, `server/anime/choices.ts`).
  - **N SERIES DIFFER →** lists each series, what it keeps, and when it was
    chosen in the player.
- **QUALITY** is the device's: what a stream starts at.
- **NEVER LOWER** (`tsundoku:anime:keep`, off) is the device's too, and
  the player's sheet has the same row. On, a stall never drops the quality: it
  keeps buffering and says so, and a move to another server only counts if
  the quality QUALITY's cap picks on that server is the chosen one or better,
  and the move plays that quality, by the same rule as a start and a fresh
  re-attach — with QUALITY on HIGHEST, the
  one playing is the chosen one, and since QUALITY is a cap, what is really
  playing is the height kept. Servers this outage already moved to are left
  until the picture plays again or a choice is made by hand, so two slow ones
  cannot take turns. A server whose qualities are not known yet (nothing
  resolved) is not a move, since the promise is about a known height. The
  BUFFERING panel names no lower step and the manual SERVER n NOW → and the
  sheet's own rows are still the way by hand. A fatal error asks the source's
  list afresh once and re-attaches only where the quality QUALITY's cap
  chooses keeps the height; with none, the no-server panel says "NOTHING
  KEEPS THE QUALITY" with CHOOSE (the player's sheet, over the panel, where a
  choice by hand plays) and TRY AGAIN (which asks for the same height again),
  and never attaches a lower quality by itself. Off, a stall is as it was:
  the next server, then one quality down ([`ANIME.md`](ANIME.md), "Servers
  fail all the time").
- **SPEED**, **DIM** and **VOLUME** are listed with no control. VOLUME
  (`tsundoku:anime:volume`, the device's) is where the next episode
  starts, set by the player's VOL slider, wheel and ↑ ↓; mute is never kept,
  so a muted episode does not leave the next one silent.
- **CURSOR** (`tsundoku:anime:cursor`, on) is the player's own: on hides
  the cursor when the controls go during playback. It is a separate key from
  the readers' because the two defaults differ, and one key with two defaults
  would make this page say OFF while the player hid the cursor. Older versions
  had the player read the readers' key, so the first time a device opens the
  player an answer stored there is carried to this one, once
  (`src/lib/reader/cursor.ts`): a RESET removes this value, and reading the
  readers' key again would bring the old OFF back. On a device holding that OFF, this row reads ON until the player
  has been opened once there, since the carry happens in the player.

## 04 — Downloading

- **EPISODES AT** (`anime_download_quality`): every ALL asks again, with the
  size.
- **AUDIO KEPT**: **ORIGINAL · ALWAYS** is ticked and can't be
  unticked, then each language is a chip. By default every track is kept
  (`anime_download_audio` = `''`). Unticking one keeps the original and the
  rest; unticking every one keeps the original alone (`ORIGINAL`, never `''`,
  which would be every track again); ticking them all is
  the default again (`keptOf`). The rule is `keptTracks`.
  It applies to new downloads only.
- **SUBTITLES KEPT**: ALL by default (subtitles are kilobytes, and Japanese
  ones are study material), or AS AUDIO for a tidier file.

## 05 — Library

**BOOKS OPEN IN** is the language a folded book opens in
([`EDITIONS.md`](EDITIONS.md)): ENGLISH by default, or JAPANESE, CHINESE or
KOREAN. A book without an edition in that language opens in the one last
read. A book's own LANGUAGE row overrides this, and the row counts how many
books do. Changing it refreshes the folded books' covers. The header counts
the folded books. Counts follow reveal.

**IMPORT A BACKUP** ([`IMPORT-BACKUP.md`](IMPORT-BACKUP.md)) is the way in for a later
import: _Mihon, Aniyomi or LNReader_, when the last one came in
(`LAST: MIHON BACKUP · 2 NOV · 382 SERIES`, or `NO IMPORT YET`), CHOOSE A
FILE → to `/import`, and IMPORT LOG → in the scope cell. Its meta line says a
second backup of the same app adds and updates and removes nothing. The count
follows reveal. On a TV the row says _From the computer or a phone_ and has no
button and nothing to focus: the TV never imports. It is a catalogue row of
type `account` (`src/lib/settings/catalog.ts`), drawn by the page itself.

## 06 — Catalogues

TMDB's key, the AniList and MAL sign-ins, and Ranobe's row
([`TRACKING.md`](TRACKING.md), [`RANOBE.md`](RANOBE.md)). Each shows who's
signed in, what was sent, and what wasn't. The cells are SIGN IN →, SIGN OUT
and TRY AGAIN. The header counts the links and what's waiting in the link
review. Coming back from a sign-in, a band says how it went
(`?signin=ok|failed|refused|unconfigured`).

**TMDB** comes first: films and shows, a key and no sign-in, the one place in
the app a secret is typed ([`TRACKING.md`](TRACKING.md), "Films, shows, and a
tracker for any kind"; [`SECRETS.md`](SECRETS.md)). A password field with
SHOW; SAVE checks the key with TMDB first and keeps nothing it refuses, and
waits for the connection when offline; a saved row reads `KEY SAVED · ENDS IN
a41f`, with REPLACE and REMOVE, and the key is never shown whole again. A key
set in the environment wins, reads `KEY SET · ENDS IN …` and has no cells. A
TV reads the row and says to add a key from a phone or computer. The series
screen's lists link here at `?section=catalogues#tmdb`.

## 07 — BROWSE

Only while tsundoku downloads on its own engine. **LANGUAGES** has a chip for
each language the repositories list, most extensions first, twelve at most,
and English and Japanese always (`browse_languages`). The last one can't go
([`BROWSE.md`](BROWSE.md)).

**EXTENSIONS**, after LANGUAGES: a second way to BROWSE › EXTENSIONS, for
readers who come from Mihon or Aniyomi and look in settings first. It reads `N INSTALLED · M
UPDATES`, its meta says where it lives (`IN BROWSE › EXTENSIONS`), and the
whole body is the link, so a TV's ↓ from LANGUAGES lands on it (the focus
layer moves by geometry, and a cell at the row's right end is off that
line). Nothing is managed from here.

- **The counts are EXTENSIONS' own**: its INSTALLED tab's count and its two
  UPDATES sections, from the same views its load reads (`installedView`, and
  the LNReader plugins through `pluginsShown(pluginView())`), so a hidden
  source's extension is counted only inside reveal, as there. Every
  installed row counts, a failed or obsolete one included, as the tab's
  count does.
- **They are the database's record** (`engine_extensions`, `novel_plugins`,
  and the repositories' listings), not the engine's answer, so an engine that
  has stopped leaves them as they were, as it leaves EXTENSIONS' own page.
  With no engine set up at all, 07 isn't drawn, and neither is the row:
  EXTENSIONS has no page then (404).
- Its words are in `messages/` (`settings_extensions_*`, and the screens'
  names), so they read in Portuguese too, where the rest of SETTINGS is
  still English (doc/I18N.md).
- HELP's 03 names both ways in ([`HELP.md`](HELP.md)).
- Tests: `tests/settings-extensions-db.spec.ts` (the counts against
  EXTENSIONS' load, reveal, an install and an update, no engine) and
  `tests/settings-devices.e2e.ts` (an install of its own with the engine set
  up: the row, its tap landing on EXTENSIONS, a TV's arrows reaching it, and
  no 07 without the engine).

**WEBVIEW**, after EXTENSIONS (WI-FI's row again: its OFF | ON, meta lines
and two-cell strip): the engine's headless browser
for the few extensions that need one ([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md),
"Cloudflare and WebView extensions"; [`BROWSE.md`](BROWSE.md), "Extensions that need a
WebView"). **Off by default, on every install**: it runs those extensions'
sites' scripts in Chromium 111 without a sandbox, so it stays off until turned
on. The row says so in its second meta line.

- **OFF | ON** writes the switch, a file in the data folder
  (`engine/webview.json`), which the launcher reads at every engine start
  and watches: it restarts the engine to take a change, and the ON cell
  reads **ON · RESTARTING THE ENGINE…** until `/capabilities` agrees. Set on
  the computer, never from a phone over Wi-Fi (403), as WI-FI is. Where
  tsundoku's launcher doesn't start the engine (development's compose
  engine), there is no switch: the row shows ON or OFF and says it is set
  where the engine is started (`ENGINE_WEBVIEW`).
- **Its state**, the first meta line, from the engine's `GET /webview`:
  **NOT NEEDED YET**, **DOWNLOADING 40 %**, **READY · 1 PAGE OPEN**, or
  **FAILED: <the engine's reason>**, verbatim (the reason is written for
  people). An engine older than the support says so; one that isn't
  answering says that. While it changes (a restart, a download, the engine
  not answering) the row asks `/api/browse/webview` every 2 s until it
  settles.
- **CHROMIUM** and **ON DISK**: where Chromium lives
  (`<data folder>/engine/app/webview/chromium`) and its size (about 360 MB
  unpacked), or NOT DOWNLOADED. **REMOVE** deletes the folder, offered only
  with the switch off and the engine restarted without it (an engine still
  running Chromium has its files open, and would download them again);
  `removeChromium` refuses otherwise, and refuses any folder that isn't
  `…/webview/chromium`.
- The page limit (`ENGINE_WEBVIEW_PAGES`) is left out of the UI.
- Kept per install, not in the `settings` table: the launcher has no
  database. Its scope cell is THIS COMPUTER · OFF UNTIL TURNED ON HERE.
- Tests: `tests/engine-webview.spec.ts`, `tests/browse-webview.e2e.ts`.

A source's own switches are not here but on its settings page in BROWSE
(`/browse/<source>/settings`, `01 — IN TSUNDOKU`): **HIDDEN SOURCE** (listed,
searched and named only inside reveal), **ADDED HIDDEN** (a series added
from it starts hidden, whether by ADD or by an import: a backup can only add
hiding) and **OFF HISTORY** (its reading never shows in HISTORY, and is
still logged). They are kept per source in the `settings` table
(`source.<switch>:<source id>`); [`BROWSE.md`](BROWSE.md), "A source's own
switches". Beside them is one action, not a switch: **CONCEAL** hides, once,
every series from the source the library shows now (a Work whole), with UNDO,
and keeps nothing in `settings` (BROWSE.md, "Conceal its series").

## 08 — Devices

**THEME** (also `/dark` and `/light`), **APP LANGUAGE** (AUTO, ENGLISH,
PORTUGUÊS (BRASIL): [`I18N.md`](I18N.md); THEME's row again), then a row per device that has checked in: this one first (THIS), then the rest, most recently seen first. Each row
says what the device is (`Android tablet · Chrome`, from its browser's user
agent), when it was last opened, and how many of its rows changed. Its
scope cell is KEPT ON THE WORKSTATION.

On a friend's local install, **WI-FI** comes between APP LANGUAGE and the devices
([`WIFI.md`](WIFI.md)): OFF | ON and, on, the pairing panel;
a paired phone's row says OVER WI-FI and has SIGN OUT. Two more rows close the
section (the PASSWORD form reuses the sign-in page's fields):

- **UPDATES** ([`UPDATES.md`](UPDATES.md)): the version running, when it last
  looked and what it found; CHECK, and UPDATE (Windows, installed) or
  DOWNLOAD when a newer one is out, with its notes under the row. Opening
  SETTINGS marks the library's new-version band seen.
- **PASSWORD** ([`SIGN-IN.md`](SIGN-IN.md)): SET or NONE; CHANGE or SET, and
  REMOVE, each opening a form under the row.

The workstation has neither: its sign-in is the token and it never updates
itself.

### How a device is kept

- Every browser makes a random id the first time (`tsundoku.device`). There
  are no accounts.
- Every device setting is read and written through `settings/local.ts`. It
  stamps each change (`tsundoku.device.stamps`) and checks in with
  `POST /api/devices/sync` on every load, 1.5 s after a change, and when the
  network comes back.
- The workstation keeps each device's record (`devices`, migration 53;
  `server/devices.ts`). For each key the newer stamp wins
  (`mergeStamped`), and the response is whatever the workstation has that's
  newer. A value kept before the device first checked in has no stamp and goes at
  stamp 0, so anything set elsewhere wins over it.
- **A device is one of four kinds**: phone, tablet, desktop or TV
  (`DeviceKind`, `settings/catalog.ts`; `devices.kind`, migration 59). The screen
  says the first three; only the TV app's own user agent says TV
  ([`ANDROID.md`](ANDROID.md)), and `/api/devices/sync` reads it from the
  request header rather than trusting the page's guess. So a TV's row is kept
  as `tv`, says TV in the section, and counts as another device on `/start`.
- The theme is a cookie the server reads. The record mirrors it as
  `tsundoku.theme`, and a newer one from the workstation sets the cookie.
  The language is the same, as `tsundoku.lang` and the cookie
  `tsundoku_lang`; AUTO clears the cookie, and a change reloads the page.
- **SHOW** switches the page to that device's settings. The top bar
  says SHOWING: DESKTOP, and a band offers BACK TO THIS TABLET. The scope
  cells read THE DESKTOP. A change made here is stamped now, and the device
  takes it the next time it opens, unless it changed the same key since.
  ALL DEVICES rows are the same everywhere.
- **START FROM**: a device with nothing changed is offered every other
  device's settings. It takes them, stamped now, at its next check-in.
- **Which devices are kept.** A browser with nothing to keep isn't recorded
  until it opens SETTINGS (`register`). The theme is mirrored only once it's
  been set, and a device not seen for 180 days is forgotten (`FORGET_MS`).
  Otherwise every fresh browser, a private window or a test's, would be a
  device forever. In the full e2e run, hundreds of them made every SETTINGS
  load draw hundreds of rows.
- Player choices an older browser kept on its own
  (`tsundoku:anime:<series>:<what>`) go along with the first check-in. The
  workstation takes it once (`adoptLegacy`), and the browser drops it.

## Offline

A band says ○ OFFLINE. ALL DEVICES and DEFAULT rows dim to 0.4, their scope
cell says ○ NEEDS THE WORKSTATION, and their controls are disabled. This
device's rows still change: they're kept here and sent when the
workstation is back.

## Getting there

- **The desktop**: the sidebar's SETTINGS, inverted while you're on the page.
  The page then drops its ← LIBRARY cell.
- **The tablet and phone**: **MORE** at the end of the library's top bar opens
  the sidebar's foot as a sheet ([`LIBRARY.md`](LIBRARY.md)). SETTINGS there
  counts this device's changed rows.
- **`/settings` in search** is offered as a result rather than run blind:
  COMMAND, `SETTINGS`, ENTER →. `/settings watching` lands on that section
  (`?section=`, `sectionFor`).
- **ALL SETTINGS →** ends the READING sheet, the text reader's sheet and the
  player's sheet, and opens the page at their section.
- The series screen keeps its sign-in link.

## Layout

- **Tablet portrait**: one column, then the legend, then the sections.
- **Landscape** (1024px and wider): a 260px **section index** on the left,
  with each section's changed count. It scrolls the page, and the section
  in view is inverted. The legend is left out.
- **Desktop**: the library's sidebar, a 232px index, and rows at 880px at most.
- **Phone** (under 600px):
  - the scope drops under each control as one line;
  - segments shorten (PLAYER, EN), and chips wrap;
  - RESET SECTION is RESET, and section 01 is READING · IMAGES;
  - a device row with two or three actions (START FROM, SHOW, SIGN OUT) puts
    the device's name on a line of its own and the actions on the line under
    it, sharing it equally: beside them the name had no room, and at 360px
    the row ran off the screen;
  - a label of nine letters or more takes its row's `short` (SUBS, SUBS KEPT,
    LANGS, EXTS), drawn by CSS from `data-short` so the first paint has it: the
    84px column holds eight letters, and LANGUAGES ran into its chips.
    `settings-domain.spec.ts` refuses a long label without a short one.

The measurements are hand-set, not a spacing scale; the colours are the
theme's tokens. `tests/settings-frame.e2e.ts`, generated from the design's
frames, pins them. The
flows are `tests/settings-flow.e2e.ts`. The domain is covered by
`settings-domain`, `settings-db` and `settings-local` specs.

## Details

- **LAYOUT is a default, not the device's**: it's the series' direction with a
  kind default, exactly like MODE, so it's drawn as DEFAULT · EVERY DEVICE
  with its own N SERIES DIFFER.
- **N BOOKS DIFFER has no list.** BOOKS OPEN IN counts the books whose own
  language row overrides it; the count is plain text, without the →.
- **A long segment takes the room it needs.** Equal segments would let FOLLOW
  THE PLAYER overflow a quarter of the tablet's control column, so a segment
  grows to its text, and the rest share what's left. Under 420px (a narrow
  phone) a segment wraps at its spaces instead: PLEX SERIF · PLEX SANS ·
  OPENDYSLEXIC on one line each was wider than a 360px screen's control column.
- **AUDIO KEPT's saving isn't stated.** The meta line says what's kept, not a
  number the page can't compute.
- **HISTORY in MORE has no count.**
- **DEVICES lists only devices that have checked in.** The server can't know
  about a browser before it calls.
- **Each segment, chip and cell is its own button**, so Tab and Enter reach
  every one.
- **Controls are ruled off what's around them.** A row's meta line has a
  hairline above it, and each ZOOM cell one between its label (PAGED · PHONE,
  IN USE) and its − 100% + controls.

## Limits

- **No live push to another device.** A change made from here waits for the
  device's next check-in (its next page load, change, or reconnection). An
  app left open for days takes it on the next page it opens.
- **The phone's bar at 360px** fits the brand, /, SELECT and MORE. Under
  420px the search hint is / alone (the link is still named Search). `settings-flow.e2e.ts` checks this at the browser's default
  font size; a phone with its font scaled up isn't checked.
- **Reveal, incognito and the grid's page size aren't on the page.** The first
  two are the session's, and the third is a cookie
  only the tests set.
- **A series' own player choice can't be set from here**, only cleared. It's
  made in the player.
- **No per-series AUDIO KEPT.** The kept languages are the library's, for
  every download.
- **No Trakt row, and no field for a friend's own AniList or MAL app.** Their
  sign-ins use the app codes in `.env` ([`SECRETS.md`](SECRETS.md)).
