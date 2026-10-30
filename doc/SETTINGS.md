# Settings

`/settings`, one page with every setting on it (card c171, with c160 folded
in; the brief is [`briefs/SETTINGS.md`](briefs/SETTINGS.md), the handoff
`design/handoff/Settings*.dc.html` and `Reach.dc.html`). Settings still live
where they're used, in the READING sheet, the text reader's sheet, the
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
  them all back.
- **FIT, ZOOM, SPREADS, CROP BORDERS, WIDE PAGES, SIDES, BLOCKS**: the
  device's own, under the same `tsundoku.reader.*` keys the reader uses
  ([`READER.md`](READER.md)).
  - **ZOOM** shows all four kept values (paged and vertical, phone and
    wider), and **IN USE** on the two this screen uses.
- **DIM** is listed with its value and no control: a dim set without the page
  behind it is a guess.

## 02 — Reading · novels

- **LAYOUT**: a novel's default, PAGED or SCROLL (`mode_novel`). It is counted
  like MODE.
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
  - Before any choice, the original plays (question 3).
  - The player's order is `startTracks`: the series' own choice, then the
    default, then the last choice, then the original. Choices are kept in
    `series_player` (rung 53, `server/anime/choices.ts`).
  - **N SERIES DIFFER →** lists each series, what it keeps, and when it was
    chosen in the player.
- **QUALITY** is the device's: what a stream starts at.
- **SPEED** and **DIM** are listed with no control.

## 04 — Downloading

- **EPISODES AT** (`anime_download_quality`): every ALL asks again, with the
  size.
- **AUDIO KEPT** (card c160): **ORIGINAL · ALWAYS** is ticked and can't be
  unticked, then each language is a chip. By default every track is kept
  (`anime_download_audio` = `''`). Unticking one keeps the original and the
  rest; unticking every one keeps the original alone (`ORIGINAL`, never `''`,
  which would be every track again: reported 2026-10-29); ticking them all is
  the default again (`keptOf`). The rule is `keptTracks`.
  It applies to new downloads only.
- **SUBTITLES KEPT**: ALL by default (question 4: subtitles are kilobytes,
  and Japanese ones are study material), or AS AUDIO for a tidier file.

## 05 — Library

**BOOKS OPEN IN** is the language a folded book opens in
([`EDITIONS.md`](EDITIONS.md)): ENGLISH by default, or JAPANESE, CHINESE or
KOREAN. A book without an edition in that language opens in the one last
read. A book's own LANGUAGE row overrides this, and the row counts how many
books do. Changing it refreshes the folded books' covers. The header counts
the folded books. Counts follow reveal.

## 06 — Catalogues

The AniList and MAL sign-ins, and Ranobe's row, as before
([`TRACKING.md`](TRACKING.md), [`RANOBE.md`](RANOBE.md)). Each shows who's
signed in, what was sent, and what wasn't. The cells are SIGN IN →, SIGN OUT
and TRY AGAIN. The header counts the links and what's waiting in the link
review. Coming back from a sign-in, a band says how it went
(`?signin=ok|failed|refused|unconfigured`).

## 07 — BROWSE

Only while tsundoku downloads on its own engine. **LANGUAGES** has a chip for
each language the repositories list, most extensions first, twelve at most,
and English and Japanese always (`browse_languages`). The last one can't go
([`BROWSE.md`](BROWSE.md)).

## 08 — Devices

**THEME** (also `/dark` and `/light`), then a row per device that has checked
in: this one first (THIS), then the rest, most recently seen first. Each row
says what the device is (`Android tablet · Chrome`, from its browser's user
agent), when it was last opened, and how many of its rows changed. Its
scope cell is KEPT ON THE WORKSTATION.

On a friend's local install, **WI-FI** comes between THEME and the devices
(the Wi-Fi handoff, [`WIFI.md`](WIFI.md)): OFF | ON and, on, the pairing panel;
a paired phone's row says OVER WI-FI and has SIGN OUT. Two more rows close the
section (not drawn in a handoff; the PASSWORD form reuses the sign-in page's
fields):

- **UPDATES** ([`UPDATES.md`](UPDATES.md)): the version running, when it last
  looked and what it found; CHECK, and UPDATE (Windows, installed) or
  DOWNLOAD when a newer one is out, with its notes under the row. Opening
  SETTINGS marks the library's new-version band seen.
- **PASSWORD** ([`SIGN-IN.md`](SIGN-IN.md)): SET or NONE; CHANGE or SET, and
  REMOVE, each opening a form under the row.

The workstation has neither: its sign-in is the token and it never updates
itself.

### How a device is kept (the owner's answer to question 1)

- Every browser makes a random id the first time (`tsundoku.device`). There
  are no accounts.
- Every device setting is read and written through `settings/local.ts`. It
  stamps each change (`tsundoku.device.stamps`) and checks in with
  `POST /api/devices/sync` on every load, 1.5 s after a change, and when the
  network comes back.
- The workstation keeps each device's record (`devices`, rung 53;
  `server/devices.ts`). For each key the newer stamp wins
  (`mergeStamped`), and the response is whatever the workstation has that's
  newer. A value set before c171 goes at stamp 0, so anything set elsewhere
  wins over it.
- The theme is a cookie the server reads. The record mirrors it as
  `tsundoku.theme`, and a newer one from the workstation sets the cookie.
- **SHOW** switches the page to that device's settings (2C). The top bar
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
- What a browser kept of the player's choices before c171
  (`tsundoku:anime:<series>:<what>`) goes along with the first check-in. The
  workstation takes it once (`adoptLegacy`), and the browser drops it.

## Offline (2D)

A band says ○ OFFLINE. ALL DEVICES and DEFAULT rows dim to 0.4, their scope
cell says ○ NEEDS THE WORKSTATION, and their controls are disabled. This
device's rows still change: they're kept here and sent when the
workstation is back.

## Getting there (Reach)

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
  - RESET SECTION is RESET, and section 01 is READING · IMAGES.

The measurements are the handoff's own (hand-set, not a spacing scale; the
colours are the theme's tokens). `tests/settings-frame.e2e.ts` is generated
from the handoff by `design-tools/gen-conformance.mjs` and pins them. The
flows are `tests/settings-flow.e2e.ts`. The domain is covered by
`settings-domain`, `settings-db` and `settings-local` specs.

## Where it departs from the handoff

- **LAYOUT is a default, not the device's.** The mock lists novel LAYOUT under
  THIS TABLET. In the repo it's the series' direction with a kind default,
  exactly like MODE, so it's drawn as DEFAULT · EVERY DEVICE with its own
  N SERIES DIFFER.
- **N BOOKS DIFFER has no list.** BOOKS OPEN IN counts the books whose own
  language row overrides it, as before, but the mock draws no list for them.
  The count is plain text, without the →.
- **A long segment takes the room it needs.** The mock's segments are equal,
  and FOLLOW THE PLAYER overflows a quarter of the tablet's control column.
  A segment grows to its text, and the rest share what's left.
- **AUDIO KEPT's saving isn't stated.** The mock's "about 130 MB instead of
  310 MB" was one episode's figure. The meta line says what's kept, not a
  number the page can't compute.
- **HISTORY in MORE has no count.** The mock's "4 OPEN" has no source in the
  repo.
- **DEVICES lists only devices that have checked in.** The workstation can't
  know about a browser before it calls. Each device appears after its first
  visit since c171.
- **Rows are buttons, not one button each.** The mock says "rows are buttons,
  so Tab and Enter work". Each segment, chip and cell is its own button
  here, which Tab and Enter reach the same way.
- **Controls are ruled off what's around them** (asked 2026-10-29). A row's
  meta line has a hairline above it, and each ZOOM cell one between its label
  (PAGED · PHONE, IN USE) and its − 100% + controls. The mock draws neither.

## What it does not do yet

- **No live push to another device.** A change made from here waits for the
  device's next check-in (its next page load, change, or reconnection). An
  app left open for days takes it on the next page it opens.
- **The phone's bar at 360px** fits the brand, /, SELECT and MORE. Under
  420px the search hint is / alone, as the handoff draws it (the link is still
  named Search). `settings-flow.e2e.ts` checks this at the browser's default
  font size; a phone with its font scaled up isn't checked.
- **Reveal, incognito and the grid's page size aren't on the page**, by the
  handoff's call. The first two are the session's, and the third is a cookie
  only the tests set.
- **A series' own player choice can't be set from here**, only cleared. It's
  made in the player.
- **No per-series AUDIO KEPT.** The kept languages are the library's, for
  every download.
