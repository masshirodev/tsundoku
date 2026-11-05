# The series screen

Everything about one series, and the list of what can be read in it. It's built
from `Index Series.dc.html` (the "Index" system, see
[`design/README.md`](design/README.md)) in all seven of its states, on phone,
tablet and desktop.

Route: `/series/[id]`, with `?from=` naming where it was opened from (a shelf
key, `continue`, a person's page, a source's page, or a Work as `work:<id>`) so
the back cell can say so, and `?edit=tags` to open straight into SHELVES & TAGS. That's what the library sheet's TAGS button uses.
`/api/series/[id]/tags?q=` answers the tag field's suggestions.

A tap on a library tile opens this screen. A long-press still opens the
library's sheet.

## The frame

- **Portrait:** metadata is a header that scrolls away with the list. Once
  CONTINUE has scrolled out of view, the top bar carries the title and a
  `▶ CH. N` cell (an `IntersectionObserver` on the CONTINUE bar).
- **Landscape and desktop** (≥1024px): metadata is a 440px panel that scrolls on
  its own, and the list keeps the full height with its own scroll.
- The order inside the metadata is the handoff's: identity, then rating and FAV,
  then CONTINUE, all within thumb reach. After that come direction, shelves,
  tags, about, and the FILE row with RENAME and HIDE, as far from CONTINUE as
  it can be.
  LISTS and COVER sit under SHELVES, and SOURCE after them ([`MOVE.md`](MOVE.md)).
- **On a phone and a TV** the rows a visit rarely touches fold behind DETAILS
  (c425; "DETAILS", below): SHELVES and ABOUT stay above it, so the order
  there is identity, RATING, CONTINUE, the WORK row and the bands, SHELVES,
  ABOUT, DETAILS, then the list.

Like the library, the frame is CSS media queries, so the server's first paint
is already right for the device. `tests/series-layout.e2e.ts` pins the panel
width, row height (60 / 52px) and rail width (56 / 44px) per device. On a TV
the panel is 352px beside the list, rows are 56px and the rail stays 56px
([`TV.md`](TV.md)).

## What drives each state

| State                | What drives it                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long manhwa, mid-way | Any series with chapters. The fold hides everything read before the last two chapters (`listRows`).                                                                                                                                                                                                                                                                                                                                                           |
| Doujin               | `kind = 'doujin'`. The contents are its pages, and the last page opened carries the accent ring.                                                                                                                                                                                                                                                                                                                                                              |
| Novel                | `kind = 'novel'`. The EPUB's table of contents with no number column, percentages, a typeset cover, and LAYOUT instead of DIRECTION.                                                                                                                                                                                                                                                                                                                          |
| 612 rows, 1 → 540    | The scrub rail (drag, or arrow keys and PageUp/PageDown when focused), and `#` for a typed number. Both open the fold if the target is inside it.                                                                                                                                                                                                                                                                                                             |
| Multi-select         | SELECT. Tap rows, or tap one, then RANGE and the other end. ALL UNREAD. Each bulk action shows how many rows it will change.                                                                                                                                                                                                                                                                                                                                  |
| Shelves & tags       | EDIT on either row. Shelves are toggles in the owner's order. Tags are typed as `namespace:value` with suggestions from existing tags.                                                                                                                                                                                                                                                                                                                        |
| Hidden, reveal on    | The magenta banner and frame from the layout, HIDDEN on the cover, and UNHIDE instead of HIDE. With reveal off the route answers 404, the same as a series that doesn't exist.                                                                                                                                                                                                                                                                                |
| Series of books      | A doujin series with two or more entries. BOOKS replaces the contents as a cover grid, `?book=` shows one book's pages, long-press opens its sheet, ORDER reorders. See [`BOOKS.md`](BOOKS.md).                                                                                                                                                                                                                                                               |
| Might be one series  | A single book whose title stem matches other singles. The suggestion band offers REVIEW → and NOT A SERIES ([`BOOKS.md`](BOOKS.md)).                                                                                                                                                                                                                                                                                                                          |
| Created / taken out  | `?created=N` after grouping, and a take-out, each show a band with UNDO.                                                                                                                                                                                                                                                                                                                                                                                      |
| Not downloaded       | An imported chapter whose file isn't on disk (`entries.available = 0`): NOT DOWNLOADED (phone: NO FILE), a dimmed title, and FILE reads "25 OF 166 DOWNLOADED". See [`IMPORT-MIHON.md`](IMPORT-MIHON.md).                                                                                                                                                                                                                                                     |
| Downloading          | A Mihon series from an installed source (`ENGINE_URL` set): the DOWNLOAD row under CONTINUE with NEXT 10 and ALL N, a tap on a row with no file queues it, and rows say QUEUED, DOWNLOADING, FAILED or IMPORTING. See [`DOWNLOADING.md`](DOWNLOADING.md), "From tsundoku".                                                                                                                                                                                    |
| From a source        | The SOURCE row under LISTS and COVER, on every series whose chapters or episodes come from a Mihon or Aniyomi source: the source's name, what it last answered and how many chapters or episodes it lists, with MOVE →. In trouble the second line is in ink (NO VIDEO, NOTHING NEW, NOT ANSWERED). After a move it reads WAS … · UNTIL 1 DEC with MOVE BACK for 30 days, and a kept chapter's status says the source it came from. See [`MOVE.md`](MOVE.md). |
| No video             | After NO SERVER on three episodes within a day (or on every episode, where the series has fewer), a NO VIDEO band under CONTINUE: NO VIDEO FROM KICKASSANIME, ANOTHER SOURCE → and NOT NOW. See [`MOVE.md`](MOVE.md), "The screens".                                                                                                                                                                                                                          |
| Followed             | FOLLOWING ✓ in accent at the DOWNLOAD row's end; caught up, it is the row's only cell and says when its source was last asked.                                                                                                                                                                                                                                                                                                                                |
| Refreshed            | REFRESH, the cell before FOLLOW, on a series in the library whose source can be asked: it looks once, adds what the source lists that no entry is, and queues nothing. The band says "3 NEW CHAPTERS" or "NOTHING NEW". See [`DOWNLOADING.md`](DOWNLOADING.md), "REFRESH" (c220).                                                                                                                                                                             |
| Just added           | `?added=<manga>` after ADD TO LIBRARY: the ADDED TO THE LIBRARY band with UNDO, FIRST 10, and START dimmed until chapter 1 has a file. `&queued=<n>`/`down` after ADD AND DOWNLOAD (c205): the band says what it queued.                                                                                                                                                                                                                                      |

## The WORK row

A series in a Work gets **one row between CONTINUE and DOWNLOAD**, because it
answers the same question: what after this ([`WORKS.md`](WORKS.md), W5;
`Work-Row.dc.html`, B3). It shows the Work's name over `PART 2 OF 3 · NEXT ·
ETERNAL FORCE`, and two 52px ← → cells (44px on a phone) that open the
neighbouring parts, dimmed at the ends. A tap on the name opens `/work/N`; a
long press, MENU or a held OK opens the row's sheet -- OPEN, MOVE ↑ ↓, and TAKE
OUT with a band and UNDO. That UNDO refuses rather than overwrite when the
library has moved on (the series is in another Work now, the Work has ended,
or a newer one has its id), and the refusal is the screen's band with NOTHING
CHANGED, never an error page (c468, as c390 did for TAKE OUT, THEN HIDE). A
series in no Work has no row.

- **Where the run is.** The line says `NEXT · <part>` while the run is here, and
  `YOU'RE IN <part>` once the owner is already in another part it has begun (the
  row's third board slice). Both are `workRowLine`'s.
- **The accent.** When this part is done -- read through, or caught up on a
  source still going -- and the next part has **not been started**, the row
  becomes the accent row `NEXT · <next part> · IN <WORK> · PART 3 · 98 CH. · ▶
CH. 1`, one tap into the next series' first chapter, and CONTINUE above it
  goes quiet as `↺ READ AGAIN`. There is **one accent on the screen, and it is
  the run's**: the panel and the header's ▶ cell read the same part state, so a
  read-through part never shows two accent bars. A next part the owner has
  already begun is not offered as an accent -- the plain row says `YOU'RE IN`
  it.
- **The back cell** names the Work when the series was opened from its run
  (`?from=work:<id>`): `← THE BREAKER`, and `← LIBRARY` otherwise. The id is
  validated and the series' own membership checked, so a stale id is not a
  claim the cell repeats ([`NAVIGATION.md`](NAVIGATION.md), "From a Work").

Tested in `tests/work-row-frame.e2e.ts` (the three states' measurements, the
links, MOVE and TAKE OUT) and in [`WORKS.md`](WORKS.md)'s flow.

## Rules worth knowing

- **The time read** is a line under the title and its alternatives (card
  c443): `READ 12 H 40`, or `WATCHED` for video (the registry's `unit.done`),
  `40 MIN` under an hour and `< 1 MIN` for a glance. It sits beside the read
  progress (an anime's `seriesCountLine` is just above it), comes from the
  reading log's one summary ([`READING-LOG.md`](READING-LOG.md), "Who reads
  it"), and is absent where the log holds no time. A series' own total needs
  no `SINCE`: it is that series' reading as logged. It is not drawn in the
  outline, and is at the top of the panel, so a fold (c425) keeps it in view.

- **A long press on a PAGES cell** opens the page menu: set it as the book's
  or series' cover, or read from it; the chosen page wears a COVER corner
  ([`COVERS.md`](COVERS.md), "Chosen").
- **SAME BOOK AS …** is a band under CONTINUE on a book with a likely twin,
  with KEEP BOTH and REVIEW → ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)).
- **LISTS and COVER** sit under SHELVES on every series but a doujin. LISTS
  (card c424) is one row with a line per list: the entry the series is linked
  to, what that list says of it, what was sent, and the line's cells. It
  replaced the LINK and TRACKING rows, which listed AniList, MAL and Ranobe
  twice; its own section below says what each line draws. COVER says where
  the cover comes from ([`LINKS.md`](LINKS.md)).
- **TAGS** groups a series' tags by namespace (genre, circle, artist, …; a
  bare tag under `tag`), four lines at most. **Every value is a link** (card
  c313): to the library's person page for a person and its tag page for the
  rest (`/?tag=<namespace>:<value>`, or the bare value for a tag with none).
  On a series whose origin key names a source BROWSE can open (installed,
  listed with this reveal, loaded, and the engine there:
  `tag-source.server.ts`), a tap opens a sheet of two rows instead, the
  owner's choice (2026-11-02): **IN THE LIBRARY**, the same page, and **IN
  <SOURCE>**, that source's page finding it -- its genre's filter included,
  or a search for the value ([`BROWSE.md`](BROWSE.md), "Arriving from a
  tag"), whose ← comes back to the series. A series with no origin, a source
  not installed or failed, and a Hentoid, folder, EPUB or import key have no
  sheet: the tap goes straight to the library, as before. The key decides,
  never the kind: a doujin from a Mihon source's gallery asks too. The
  screen asks the source nothing: IN <SOURCE> is a link to
  `/series/<id>/tag-search?ns=&value=&from=`, a server route that waits
  for the source's filters (or `TAG_SCHEMA_WAIT_MS`) and then answers 303,
  so the row is never a guess made before they came, and the sheet stays
  open while it waits. That wait is up to 20 s on a cold source, and a TV's
  WebView draws no loading bar, so the chosen row says it: `aria-busy` and a
  second line, `FINDING <SOURCE>'S FILTERS…`, until the page goes; it stays
  the focused stop, readable (c452). BACK restores the screen from the
  bfcache, where nothing else runs, so `pageshow` clears the mark, and so
  does another tag. A hidden series, with reveal off, has no sheet and
  its route is not found. Without script the tag's link is the library's.
  A value appears as often as it is stored: a bare `x` and a `tag:x` are
  two values in the `tag` group, each its own link to its own library tag
  (`?tag=x` and `?tag=tag%3Ax`). Each link is built from its stored tag, in
  `tagGroups`' order, never looked up by its value: until c451 both found the
  first and linked to `?tag=x`. On a TV the pad reaches the
  values (↓ to the row meets its EDIT, ← into them), OK opens the sheet on
  its first row, and BACK closes it onto the tag.
- **SOURCE sits after LISTS and COVER**, before TAGS and ABOUT, on every series
  whose chapters or episodes come from a Mihon or Aniyomi source: MOVE → to
  another source, and for 30 days after a move WAS … · UNTIL … with MOVE BACK
  ([`MOVE.md`](MOVE.md)). A local import has no such row. A chapter kept from
  the source the series left says its source in the status column, and FILE
  counts it (`25 OF 125 DOWNLOADED · 2 FROM ASURA SCANS`).
- **OCR and WORDS** sit under DIRECTION on every series that isn't a novel:
  how far OCR has read it on the workstation, with **OCR** to switch it on
  for one not seen as Japanese, and the words looked up in it waiting for
  review. [`JAPANESE.md`](JAPANESE.md) has the states.
- **Marked unread stays unread.** The import moves read state only forward,
  from Mihon's and Hentoid's own records, and Mihon keeps a chapter's old
  "read" for good. So MARK UNREAD is remembered (`entries.unread_at`, rung
  28), and an import brings a read back only when it's newer than the unmark:
  a chapter read again on the phone since still counts. MARK READ, or
  finishing the chapter here, forgets the unmark. (Until 2026-09-25 an
  unmarked chapter came back read on the next import. The rung repaired what
  it had undone, from the reading log.)
- **Rating** is out of 10, set with the blocky slider, and 0 is unrated. It
  fills up to the rating, FAV sits at its end, and on a linked series it is
  also the score AniList and MAL get ([`RATINGS.md`](RATINGS.md)).
- **Direction** is stored per series (`series.direction`), and `NULL` means the
  kind's default: manhwa scrolls, manga and doujin read R→L, novels page. The
  reader's REMEMBER will write the same field.
- **One row per chapter,** even when Mihon had it from two scanlators. The
  SCANLATOR row, shown only on a series with duplicates, picks whose copy
  represents a chapter ([`DUPLICATES.md`](DUPLICATES.md)).
- **A long press on a chapter row reads it and everything before it,** in
  reading order, whatever order the list is sorted in. A band says "MARKED
  READ THROUGH CH. 41 · 38 CHAPTERS" and offers UNDO, which unmarks exactly
  the chapters that changed and leaves the ones already read alone. It's the
  common case after an import, in one gesture where RANGE takes three taps.
  It's logged as marks (`mark_read`), not reading. It works on not-downloaded
  rows too, which a tap doesn't open, and is off while selecting.
- **The fold** only forms when it would hide at least three rows, because a
  fold of one saves nothing. It sits at the bottom when the list is flipped to
  newest-first. The flip is remembered per series on the device (localStorage).
- **Mark read / unread** changes exactly the selected entries that weren't
  already in that state, and never an entry of another series, whatever the
  form says (`markEntries`).
- **A tapped tag suggestion wins over the half-typed text.** The suggestion is
  submitted as `pick` beside the field's `tag`. Reading `tag` first once stored
  `genre:ise` instead of `genre:isekai`, a second spelling, which is exactly what
  suggestions exist to prevent. `tests/series-flow.e2e.ts` holds that down.
- **Suggestion counts only include visible series**, so the tag field can't be
  used to learn how many hidden series carry a tag.

## DETAILS (c425)

The handoff is `doc/handoffs/series-phone/` (`canvas.json`, five boards: 1A a
manga before, folded and open, 1B a novel and an anime, `Phone.dc.html` the
live screen, 1C what the folded line says, 1D the tablet in portrait and the
TV), from the brief `doc/briefs/SERIES-PHONE.md`. On a phone every row of the
panel came before the chapter list; now the settings-like rows fold behind one
line.

- **What stays above:** identity, RATING and FAV, ▶ CONTINUE, the WORK row and
  every band (NO VIDEO, MIGHT BE ONE SERIES, SAME BOOK AS, the panel's own
  UNDO bands), SHELVES, ABOUT. **What folds**, in today's order: DOWNLOAD
  (with REFRESH and FOLLOW), LANGUAGE, DIRECTION or LAYOUT, OCR and WORDS,
  SCANLATOR, LISTS, COVER, SOURCE, TAGS, EDITIONS, FILE (or FOLDED) and
  RENAME's field. One fold, not one per group, and CONTINUE stays at the top.
- **Where:** the phone (`max-width: 599px`) and the TV (`(pointer: none) and
(min-width: 900px)`), by CSS media queries alone. The tablet in either
  orientation and the desktop are unchanged. The handoff folds the tablet in
  portrait too; that part is not built (below, "What it does not do yet").
- **One DOM, two orders.** The markup is in the fold's order, rows grouped in
  wrappers that are no boxes (`display: contents`); where nothing folds, CSS
  `order` puts each group back where it always was (`.o1`–`.o7`:
  DOWNLOAD under the WORK row, the bands, LANGUAGE to SCANLATOR, SHELVES,
  LISTS to TAGS, ABOUT, EDITIONS and FILE). The rules are `> :global(*)`:
  a scoped `*` matches this component's elements only, and LISTS' row is
  ListsRow's, which then sat above DIRECTION. `tests/series-details.e2e.ts`
  checks today's order on the tablet and the desktop. The focus layer moves
  by geometry (`doc/FOCUS.md`), so the TV, which folds, walks the visual
  order; a keyboard's Tab on the desktop walks the markup's, which puts
  SHELVES and ABOUT before DOWNLOAD.
- **The folded line** (1C) is one row, 64px at the least: DETAILS | a state
  line over the names inside | SHOW ↓. Its words are `details.ts`'
  `detailsLine`, from facts the panel already has, no query of its own:
  - **quiet**, in text-2: FOLLOWING (the DOWNLOAD row's FOLLOW on) or else
    the chosen direction (`R→L`, `PAGED`), then what was sent, `SENT CH.
214`, built from LISTS' own line (its state's unit and the `SENT …` on
    its right; the handoff's `SENT CH. 186` is that, read off a mock).
  - **a mark**, in ink and 500 (SOURCE's idiom for trouble), when something
    needs the owner: a send that failed (a LISTS state line in `alert`: the
    line's `NOT SENT`, named by its list, `MAL · CH. 214 NOT SENT`), a list
    not linked (AniList's or a season's `Not linked` line that offers FIND;
    a hidden series' PASTE-only line and Ranobe's `Not on Ranobe` are not
    marks), a fold of seasons in ink (`foldWord`), and a source not
    answering (SOURCE's `move.trouble`, named by the source). Two or more
    become a count, `2 TO LOOK AT · MAL · MANGADEX`.
  - **running work** (a chapter downloading, from the DOWNLOAD states; else OCR
    running, from `ocrLines`) takes the quiet line's first word (`CH. 9
DOWNLOADING`, `OCR 128 OF 212 CHAPTERS`) and draws a 3px accent bar on the
    bottom rule, its fill the download's or OCR's fraction.
  - It never opens itself: the mark tells, the owner decides. Open, the state
    line goes (the rows say it themselves), the cell inverts to HIDE ↑ and the
    rule goes full ink.
  - Its accessible name is `DETAILS`, or `DETAILS · <the state>` while
    folded: never SHOW, HIDE or MORE, so no other control's locator finds it.
- **Remembered for the device**, one localStorage key,
  `tsundoku:series-details` (`DETAILS_KEY`), `1` for open: wanting the
  settings showing is the owner's habit, not a fact about a series (the list's
  newest-first flip stays per series, `tsundoku:series-sort:<id>`). Closed
  by default. **The server draws it closed**, so the first paint is never a
  flash of it open; a device that remembers it open opens it once the page
  runs, a frame later. **Without script** a `<noscript>` rule shows every
  row and no line, since nothing could open it.
- **ABOUT** clamps to three lines with MORE ↓ / LESS ↑ on a phone (two
  elsewhere, and two on the TV, as its board draws), never remembered.
- **On the TV** (1D, B and C) DETAILS is one stop; OK opens or closes it in
  place and the focus stays on it; ↓ goes into the first opened row. Folded,
  nothing under it is a stop (a row with no box is not one), and → is the
  list beside the column. Its text is a size up (state 14, names 12, the cell
  14 with 18px sides), the cell reads `OK · SHOW ↓`, and the names are cut to
  four and a count (`DIRECTION · LISTS · COVER · TAGS · 1 MORE`).
- **FIRST READ's ring** on DOWNLOAD (doc/ONBOARDING.md) sits on the DETAILS
  line while the fold is closed, the way in, since the fold never opens
  itself.

Specs: `tests/series-lists.spec.ts` (the marks over `listsRow`'s real output,
the line, the names, the key), `tests/series-details.e2e.ts` (the phone, and
today's order where nothing folds), `tests/tv-series-details.e2e.ts` (the TV
stop) and `tests/series-phone-frame.e2e.ts` (the design tools' conformance
file for ABOUT's body and the line's text at 390).

### Where DETAILS departs from the handoff

- **The quiet line's words are the repo's.** The mock's `SENT CH. 186` and
  `MAL DIDN'T TAKE CH. 186` are drawn words; the line reads LISTS' own
  (`SENT CH. 214` built from its state, `MAL · CH. 214 NOT SENT`), so the
  folded line and the row it folds never say the same thing two ways.
- **OCR's running word keeps what was sent.** The mock replaces the whole quiet
  line (`OCR · 128 OF 212 · RUNNING`); here running work takes the first
  word, as the anime's `EP. 9 DOWNLOADING · SENT EP. 6` does, so both kinds
  of work read alike.
- **The TV column keeps TV-Series' own measurements** (a 96px cover, a 22px
  title, a 116px label column). 1D's TV frames redraw the column smaller (64,
  18, 88); the brief asked for the fold, not a new TV panel, so only the
  DETAILS line takes 1D's measurements, and `tests/tv-series-frame.e2e.ts`
  still pins TV-Series for what the fold leaves alone.
- **ABOUT's MORE stays on the TV.** 1D draws ABOUT with no MORE; it is a
  control the TV already had, so it stays, one more stop.

### What DETAILS does not do yet

- **The tablet in portrait does not fold.** The handoff folds it (1D, A), and
  the CSS is one query away (add `(min-width: 600px) and (max-width: 1023px)`
  to the fold's media queries, and to their negation). It is left because
  every flow spec runs at that size (`tablet-portrait`): the fold would close
  DOWNLOAD, LISTS, FILE and the rest under a dozen specs this slot does not
  own (doc/handoff-notes/series.md, wave 22, Gaps, has the list and the
  one-line way to open it for them).
- **A download that failed is not a mark.** The rows already say FAILED, and
  the handoff's marks are the three above; a series with failed chapters
  folds quiet.

## FILE and RENAME (c526)

**The row.** FILE (FOLDED on a book folded from editions) is its label, the
text (the path, then `13 EPUB · 6.8 MB`), and its cells: RENAME, UNGROUP on a
series of books or volumes, HIDE (UNHIDE), DELETE (UNFOLD in FOLDED's place).
It follows LISTS' rule (`doc/handoffs/series-lists/`): where the panel is
narrow (the phone, the 440px landscape panel and the TV's 352px column, the
same query as the LINK row's) two or more cells drop under the line in equal
columns, edge to edge, and the text has the whole line after the label; the
tablet in portrait has the width and keeps them at the line's end. Before,
the text was `flex: 1` beside three cells and got 136px at the 440 panel,
155px at 390 and 74px on the TV, a word a line; now 319, 306 and 236
(`tests/series-layout.e2e.ts` measures it per device on Tower of God,
`tests/series-rename-flow.e2e.ts` on a novel of thirteen EPUBs at 390 and
440). One DOM, no second copy of the cells: the row wraps
(`flex-wrap`), and the cells' box takes a line of its own.

**RENAME** is the Work screen's idiom on the series: the cell opens a field in
place under the row (focused, the name selected), DONE writes it, CANCEL
leaves it, and the answer is a band, `RENAMED · NEW NAME` / `WAS OLD NAME`,
with UNDO. A rename to the same name says THE SAME NAME and offers nothing to
undo; an empty one is refused (`A SERIES NEEDS A NAME · NOTHING CHANGED`).
Spaces fold as a typed name's would. Every series has it, not only a grouped
one: whatever a series was called by its importer, the owner may call it
something else.

- **It sticks, with no column of its own.** `series.title` is written at the
  series' INSERT (the importers' writer, `import/write.ts`, and the grouping
  doors in `books.ts`) and at one place after: `carryEdit`
  (`import/fold.ts`), which carries an owner's name _onto_ the survivor when a
  download folder's series folds into the one a backup names. Nothing else
  writes it (`rg -nU "UPDATE\s+series\s+SET[^;\`]*" src -o | rg title`). Every
door that meets a series again finds it by its key, its former keys, its
files or its entries' URLs, never by its title, so
`tests/series-rename-db.spec.ts` renames and then runs a rescan (the backup
and tsundoku's own downloads), a newer backup that names the manga by its
source's title, a REFRESH whose source answers its own title, a cover pass,
and tsundoku's next download, which the engine files in a folder named after
the *new* title (`engine/worker.ts`); each keeps the name and makes no twin.
- **The old name joins `alt_titles`.** The catalogue's and Ranobe's title
  matches read the alternative titles, so a link search still knows the series
  by the name it came with. UNDO puts back the name and `alt_titles` exactly,
  and only while the series still has the name that rename gave it: a second
  tab's later rename is the owner's newer word, and the older band's UNDO says
  RENAMED AGAIN SINCE.
- **The library's search reads `title` and tags, not `alt_titles`**
  (`library.ts`), so a renamed series is found by its new name, and by its old
  one only if that is also a tag. That is the card's "or the alternative
  titles hold it" (doc/handoff-notes/series.md, wave 22, Gaps).
- **The colour stays.** `hueFor(title)` picks a series' hue once, at its
  INSERT; the rename leaves `hue` alone.
- **A Work keeps its own name.** A Work's name is `works.name`, renamed on the
  Work screen; a series that is its face keeps the Work's name there and its
  own here.
- **The id is the identity.** A rename keeps the series' id, so every link,
  shelf, Work part and reading stays with it; UNDO finds it by id.

## LISTS (c424)

The handoff is `doc/handoffs/series-lists/` (`canvas.json`, five boards:
1A before and after, 1B every state in the 440px panel, 1C an anime, 1D the
phone, the TV and the tablet in portrait, 1E EDIT's sheet), from the brief
`doc/briefs/SERIES-LISTS.md`. It was implemented with `design-tools`
(extract, reconcile, pin): every colour is a token, and the spacing is the
mock's own literals, on no ladder, pinned by `tests/series-lists-frame.e2e.ts`,
`tests/series-layout.e2e.ts` and `tests/tv-series.e2e.ts`.

**What draws it.** `src/routes/series/[id]/lists.ts` derives every word and
cell from what the server already hands the panel (`LinkState`, `Tracking`,
`RanobeSeries`, an anime's `SeasonRow`s); `ListsRow.svelte` only draws, and
`TrackingSheet.svelte` is EDIT's sheet. `tests/series-lists.spec.ts` pins the
rules; `tests/series-lists-flow.e2e.ts` reaches the states through the app's
doors.

**A line** is a tag cell (ANILIST, RNB, or S1 to S4 on an anime with several
seasons), then the entry's title, its meta, and its state lines, then its
cells. The line that tracks comes first: AniList on a comic, Ranobe on a
novel (`Tracking.catalogueTracks`, never a kind check), the seasons on an
anime with Ranobe's one line under them, a rule above it.

- **MAL folds into AniList's line**: its id in the meta, and `ANILIST AND MAL
· SENT 12 MIN AGO` on the right. It gets a quiet line of its own, inside
  AniList's, only when it differs (`entryStates`): signed in where AniList
  isn't or the other way round, a send of its own that failed, or another
  word or chapter on its list (`MAL AT CH. 198`). MAL alone (AniList not asked
  yet) leads with its name and says `SHOWN · ANILIST HAS NOTHING`. The line
  speaks for the first list that is signed in, AniList before MAL
  (`mainList`): with AniList signed out and MAL signed in, MAL's word leads
  (`MAL · WATCHING · EP. 8`, on every season, watched or not) and AniList's
  NOT SIGNED IN is the quiet line. A fold's word and the sheet's STATUS ask
  the same list (`listState`).
- **An anime's seasons**: three or fewer have a line each; more fold round the
  one being watched (its tag inverted), and the fold says the run's state
  (`COMPLETED`, `2 NOT LINKED`, `A SEND FAILED`). SHOW opens one row now, not
  two. Every season line carries its list's word; only the season being
  watched adds its meta and what was sent. A season in two parts leads with
  `PART 2 · `, part 1's word on the right and the send under it.
- **A flat list** (episodes with no season numbers, season 0 inside) and a
  show of one season draw one ANILIST line, never an S tag and never SEASON 0
  (c423). Season 0 beside numbered seasons is tagged OTHER, and a fold that
  holds it says `OTHER + S1 – S2`.

**The cells.** One stays at the line's end; two or more drop under the line
in equal columns on the phone, the 440px panel and the TV, and stay inline
on the tablet in portrait. The order is TRY AGAIN, SIGN IN →, FIND or CHANGE,
PASTE A LINK, EDIT. TRY AGAIN is per line: a season's names its season
(`?/retryTracking` sends that season's alone), a comic's sends both its lists,
and Ranobe's is `?/retryRanobe`. A sign-in that expired offers SIGN IN → in
TRY AGAIN's place, unless the other list's send failed for another reason:
then the line offers both. A season's FIND keeps one cell (PASTE A LINK is on the
review it opens); a hidden season's is PASTE. A settled line's FIND is plain,
not the accent: the owner already said no.

**Where the row sends you** (1E's table): FIND on AniList's line opens
`/links?series=N`, a season's `&season=S`, Ranobe's `&service=ranobe`, and
PASTE adds `&paste`. CHANGE on a wrong-kind line, and in the sheet, opens the
review on the current link. SIGN IN → goes to SETTINGS. EDIT opens the sheet.

**EDIT's sheet** opens on that line's entry and season tab. ENTRY is new:
the entry's title and ids, where the link came from, and OPEN ↗, CHANGE and
UNLINK, which left the row (UNLINK names the tab's season on a show with
several, and none on a show of one, whose UNLINK takes every part). STATUS
sends at once to the lists signed in, and says NOTHING SIGNED IN rather than
offering what can't be sent; a cover-only, wrong-kind, hidden or novel's
entry says why it is never tracked instead. PROGRESS is each list's. On
Ranobe's line it is the same sheet with nothing to set: Ranobe works the
status out from the reads, and its ENTRY has RANOBE ↗, CHANGE and UNLINK.

**Every state, and where it is drawn** (the brief's twelve):

| State                 | Drawn as                                                                                                                                                                                                                                                                                             | Reached in                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1 Not linked          | `Not linked` muted; the search's own words (`NOT SEARCHED YET · THE NEXT PASS SEARCHES IT`, `A SEARCH WAITS FOR THE NEXT COVER PASS`, `4 FOUND ON ANILIST · NOT FOR CERTAIN`, `NOTHING FOUND ON ANILIST`, `NONE OF THESE · NO PASS ASKS AGAIN`, `UNLINKED · NO PASS ASKS AGAIN`); FIND, PASTE A LINK | links-flow, series-lists-flow                |
| 2 Linked and tracked  | the list's word in ink, what was sent on the right; EDIT                                                                                                                                                                                                                                             | series-lists-flow                            |
| 3 Signed out          | `ANILIST AND MAL · NOT SIGNED IN` / `NOTHING SENT`, or MAL's quiet line; SIGN IN → and EDIT                                                                                                                                                                                                          | tracking-flow, the frame spec                |
| 4 A send that failed  | `CH. 3 NOT SENT`, the reason in ink on the right; TRY AGAIN                                                                                                                                                                                                                                          | series-lists-flow (a catalogue that is down) |
| 5 Cover-only          | `THE COMIC’S ENTRY · …`; `COVER AND DETAILS ONLY · NEVER TRACKED`                                                                                                                                                                                                                                    | series-lists-flow                            |
| 6 Wrong kind          | `LINKED TO THE WRONG KIND · NOTHING SENT`, `CHANGE SEARCHES ANILIST’S ANIME`; CHANGE as the accent, EDIT                                                                                                                                                                                             | series-lists-flow (hand-seeded link)         |
| 7 Hidden              | `HIDDEN SERIES ARE NEVER SEARCHED`, PASTE A LINK alone as the accent; linked, `NOTHING SENT · HIDDEN SERIES STAY OFF EVERY LIST`; with seasons the strip says `NOTHING SENT · HIDDEN` once                                                                                                           | series-lists-flow                            |
| 8 Offline             | the strip: `○ OFFLINE · CHANGES NEED THE WORKSTATION`; EDIT turns into OPEN ↗, every other cell dims, sends read `AS OF 14:20`                                                                                                                                                                       | series-lists-flow                            |
| 9 Ranobe on a novel   | RNB first; the AniList line `COVER AND DETAILS · TRACKED ON RANOBE`                                                                                                                                                                                                                                  | ranobe-flow                                  |
| 10 Ranobe on an anime | one RNB line under the seasons, `RANOBE · ONE ENTRY FOR ALL 4 SEASONS`                                                                                                                                                                                                                               | series-layout (one season), the unit spec    |
| 11 Many seasons       | the fold, the watched season inverted, SHOW / HIDE                                                                                                                                                                                                                                                   | series-lists-flow                            |
| 12 A flat list        | one ANILIST line, no S tag, no SEASON 0 on the row or in the sheet                                                                                                                                                                                                                                   | links-flow                                   |

**Per device** (1B, 1D): the 440px panel and desktop: a 36px strip above the
lines, tag 64, line 56, title 14, meta 12, cells 13, the drop 48. The phone:
tag 60 (see below), line 52, title 13, the drop 52. The tablet in portrait:
the label column (120) instead of the strip, title 15, meta 13, cells 14,
every cell inline. The TV: tag 56, line 56, title 16, meta hidden (one OK
away, in EDIT), cells 15; ↑ ↓ move a line at a time and ← → between a line's
cells, with the house's inset focus mark.

### Where LISTS departs from the handoff

- **EDIT stays on a line that is signed out.** 1B says AniList signed out has
  one cell, SIGN IN →, and EDIT "waits for the sign-in". But OPEN ↗, CHANGE and
  UNLINK live in EDIT's sheet now, so without it a signed-out series could
  never be relinked or unlinked from this screen. The sheet says NOTHING
  SIGNED IN where STATUS would be.
- **The phone's tag is 60px, not 1D's 56.** 1D only ever puts S3 or RNB in
  it; ANILIST, which 1A draws on a phone at 60, does not fit 56.
- **A line's meta names no year or country**: `series_links` stores neither,
  so a comic reads `MANGA · MAL 132214`, not 1B's `MANHWA · 2020 · …`. The
  ANILIST id stands in for MAL's where there is no MAL entry (1B, 5 and 9 do
  the same).
- **1B's `SEARCH WAITS · ANILIST OUT OF REACH · NEXT PASS` is not drawn**: a
  queued search doesn't know whether AniList was out of reach, so it keeps
  `A SEARCH WAITS FOR THE NEXT COVER PASS`, which is true of every queued one.
- **A novel's AniList line says `COVER AND DETAILS · TRACKED ON RANOBE`**, not
  1B's `… · NOVELS ARE TRACKED ON RANOBE`, so no line names a kind; without a
  Ranobe token it says `COVER AND DETAILS · NOT TRACKED HERE`.
- **The sheet's UNLINK has no UNDO band.** 1E's table says "the band with
  UNDO"; the series screen never had one for UNLINK, and this wave didn't add
  it.
- **Ranobe's line keeps FIND and PASTE A LINK on a comic or a novel** (1B, 1
  and 8) and FIND alone on an anime (1C), as the boards draw each.

### What LISTS does not do yet

- The fold in the phone's series header (c425, `doc/handoffs/series-phone/`):
  the next wave folds these rows.
- `doc/TV.md` (not this slot's) doesn't say yet that the TV's focus moves
  through LISTS a line at a time.

## Where it departs from the handoff

- **Rating on this screen has a way back to unrated** (0), which the handoff
  lacked. The owner decided on 2026-09-22 that 0 is unrated.
- **On a phone, `#` and SELECT stay in the list header**, and only the sort cell
  is dropped. The handoff hid all three there and said they "move into the list
  once the header has scrolled away", without drawing where. The count
  shortens to the total so it isn't cut mid-word.
- **The fold row's SHOW** expands in place and stays expanded for the visit.
- **Novels' untitled entries show their label** ("Vol. 13"), not "Chapter 13".
  The sample library's novels are volumes.
- **Long press on a chapter row** (mark read through it) isn't in the
  handoff. It's Mihon's "mark previous as read", and it reuses the books
  handoff's confirmation band for UNDO.
- **SCANLATOR** is a row the handoff doesn't have. It's in the shelves-row
  idiom (outlined chips, the chosen one inverted), placed after DIRECTION, and
  only drawn when there are duplicates to hide.
- **The FILE row counts files, not entries.** A novel's chapters share one EPUB,
  so it reads "1 EPUB" (a novel grouped from six books reads "6 EPUB", with
  UNGROUP among its cells and a heading per volume in CONTENTS,
  [`BOOKS.md`](BOOKS.md)).
  A Hentoid book is a folder of loose images, so it reads
  "1 FOLDER", not the handoff's "1 CBZ", which doesn't match what Hentoid stores
  (`IMPORT-FORMATS.md`).
- **`#`** is an inline field in the list header. The handoff names it but
  doesn't draw it.

## What it does not do yet

- **The cover resumes.** A tap on it goes where ▶ CONTINUE goes, once that is
  known (not while the series is still drawn in outline). The owner asked for
  it on 2026-09-23: the biggest thing on the screen is the way in.
- **A chapter that isn't downloaded doesn't open.** Everything else does:
  CONTINUE, `▶ CH. N`, a chapter row, a doujin page and a book's ▶ open the
  image reader ([`READER.md`](READER.md)), and a novel's the text reader
  ([`TEXT-READER.md`](TEXT-READER.md)).
- **Alternative titles, source, status, description, per-entry titles and page
  counts** come from the sample seed. The importers will fill them from
  `ComicInfo.xml`, `contentV2.json` and the EPUB's metadata.
