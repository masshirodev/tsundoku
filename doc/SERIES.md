# The series screen

Everything about one series, and the list of what can be read in it, on phone,
tablet, desktop and TV. Its components follow the design system in
[`design/README.md`](design/README.md).

Route: `/series/[id]`, with `?from=` naming where it was opened from (a shelf
key, `continue`, a person's page, a source's page, or a Work as `work:<id>`) so
the back cell can say so, and `?edit=tags` to open straight into SHELVES & TAGS,
which is what the library sheet's TAGS button uses. `/api/series/[id]/tags?q=`
answers the tag field's suggestions.

A tap on a library tile opens this screen. A long-press opens the library's
sheet.

## The frame

- **Portrait:** metadata is a header that scrolls away with the list. Once
  CONTINUE has scrolled out of view, the top bar carries the title and a
  `▶ CH. N` cell (an `IntersectionObserver` on the CONTINUE bar).
- **Landscape and desktop** (≥1024px): metadata is a 440px panel that scrolls on
  its own, and the list keeps the full height with its own scroll.
- The order inside the metadata is identity, then rating and FAV, then CONTINUE,
  all within thumb reach. Where nothing folds, ABOUT and TAGS come next, under
  DOWNLOAD's REFRESH and FOLLOW, then the bands, direction, shelves, and the
  FILE row with RENAME and HIDE, as far from CONTINUE as it can be. LISTS and
  COVER sit under SHELVES, and SOURCE after them ([`MOVE.md`](MOVE.md)).
- **On a phone and a TV** the rows a visit rarely touches fold behind DETAILS
  ("DETAILS", below): SHELVES and ABOUT stay above it, so the order there is
  identity, RATING, CONTINUE, the WORK row and the bands, SHELVES, ABOUT,
  DETAILS, then the list.
- **On a phone, `#` and SELECT stay in the list header**, and only the sort cell
  is dropped. The count shortens to the total so it isn't cut mid-word.

Like the library, the frame is CSS media queries, so the server's first paint
is already right for the device. `tests/series-layout.e2e.ts` pins the panel
width, row height (60 / 52px) and rail width (56 / 44px) per device. On a TV
the panel is 352px beside the list, rows are 56px and the rail stays 56px
([`TV.md`](TV.md)).

## What drives each state

| State                     | What drives it                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Long manhwa, mid-way      | Any series with chapters. The fold hides everything read before the last two chapters (`listRows`).                                                                                                                                                                                                                                                                                                                                                                                  |
| Doujin                    | `kind = 'doujin'`. The contents are its pages, and the last page opened carries the accent ring.                                                                                                                                                                                                                                                                                                                                                                                     |
| Novel                     | `kind = 'novel'`. The EPUB's table of contents with no number column, percentages, a typeset cover, and LAYOUT instead of DIRECTION.                                                                                                                                                                                                                                                                                                                                                 |
| A grouped novel's volumes | A novel made from two or more EPUBs (`volumesIn`) heads each volume with its own cover ("A grouped novel's volumes", below).                                                                                                                                                                                                                                                                                                                                                         |
| 612 rows, 1 → 540         | The scrub rail (drag, or arrow keys and PageUp/PageDown when focused), and `#` for a typed number. Both open the fold if the target is inside it.                                                                                                                                                                                                                                                                                                                                    |
| Multi-select              | SELECT. Tap rows, or tap one, then RANGE and the other end. ALL UNREAD. Each bulk action shows how many rows it will change.                                                                                                                                                                                                                                                                                                                                                         |
| Shelves & tags            | EDIT on either row. Shelves are toggles in the library's order. Tags are typed as `namespace:value` with suggestions from existing tags.                                                                                                                                                                                                                                                                                                                                             |
| Hidden, reveal on         | The magenta banner and frame from the layout, HIDDEN on the cover, and UNHIDE instead of HIDE. With reveal off the route answers 404, the same as a series that doesn't exist.                                                                                                                                                                                                                                                                                                       |
| Series of books           | A doujin series with two or more books (an extra is not one, and is neither counted in `N BOOKS` nor numbered `BOOK n`). BOOKS replaces the contents as a cover grid, `?book=` shows one book's pages, long-press opens its sheet, ORDER reorders. See [`BOOKS.md`](BOOKS.md).                                                                                                                                                                                                       |
| Might be one series       | A single book whose title stem matches other singles. The suggestion band offers REVIEW → and NOT A SERIES ([`BOOKS.md`](BOOKS.md)). Its words, and the other offer's, are translatable messages ([`I18N.md`](I18N.md)).                                                                                                                                                                                                                                                             |
| Might continue a Work     | A series in no Work whose title continues a Work's name or a part's title: MIGHT CONTINUE <WORK> · AS PART N under CONTINUE, with REVIEW → (the GROUP sheet in ADD TO A WORK, this series last and ticked) and NOT THIS, which never asks again. See [`WORKS.md`](WORKS.md), "MIGHT CONTINUE <WORK>".                                                                                                                                                                                |
| Created / taken out       | `?created=N` after grouping, and a take-out, each show a band with UNDO and a ✕ that clears it ([`BANDS.md`](BANDS.md)).                                                                                                                                                                                                                                                                                                                                                             |
| Not downloaded            | An imported chapter whose file isn't on disk (`entries.available = 0`): NOT DOWNLOADED (phone: NO FILE), a dimmed title, and FILE reads "25 OF 166 DOWNLOADED". See [`IMPORT-MIHON.md`](IMPORT-MIHON.md).                                                                                                                                                                                                                                                                            |
| Downloading               | A Mihon series from an installed source (`ENGINE_URL` set): the DOWNLOAD row under CONTINUE with NEXT 10 and ALL N, and rows say QUEUED, DOWNLOADING, FAILED or IMPORTING. A tap on a row with no file reads it online and the row's own ↓ cell queues it ([`READING-ONLINE.md`](READING-ONLINE.md)); offline, such a row says ○ ONLINE ONLY and does not open. See [`DOWNLOADS.md`](DOWNLOADS.md), "The series screen".                                                             |
| From a source             | The SOURCE row under LISTS and COVER, on every series whose chapters or episodes come from a Mihon or Aniyomi source: the source's name, what it last answered and how many chapters or episodes it lists, with MOVE →. In trouble the second line is in ink (NO VIDEO, NOTHING NEW, NOT ANSWERED). After a move it reads WAS … · UNTIL 1 DEC with MOVE BACK for 30 days, and a kept chapter's status says the source it came from. See [`MOVE.md`](MOVE.md).                        |
| No video                  | After NO SERVER on three episodes within a day (or on every episode, where the series has fewer), a NO VIDEO band under CONTINUE: NO VIDEO FROM KICKASSANIME, ANOTHER SOURCE → and NOT NOW. See [`MOVE.md`](MOVE.md), "The screens".                                                                                                                                                                                                                                                 |
| Followed                  | FOLLOWING ✓ in accent at the DOWNLOAD row's end; caught up, it is the row's only cell and says when its source was last asked.                                                                                                                                                                                                                                                                                                                                                       |
| Refreshed                 | REFRESH, the cell before FOLLOW, on a series in the library whose source can be asked: it looks once, adds what the source lists that no entry is, and queues nothing. The band says "3 NEW CHAPTERS" or "NOTHING NEW". See [`DOWNLOADS.md`](DOWNLOADS.md), "REFRESH".                                                                                                                                                                                                               |
| Just added                | `?added=<manga>` after ADD TO LIBRARY: the ADDED TO THE LIBRARY band with UNDO, FIRST 10, and START dimmed until chapter 1 has a file. `&queued=<n>`/`down` after ADD AND DOWNLOAD: the band says what it queued. Under it, PUT ON A SHELF: the library's shelves as chips ("Shelves in the ADDED band", below). ✕ clears the band and its chips, both being the one `?added=`. Only an ADD draws it: a MOVE's and a GROUP's `?added=` mean something else ([`BANDS.md`](BANDS.md)). |

## A grouped novel's volumes

A novel made from two or more EPUBs (`volumesIn`) heads each volume with its
own cover (its EPUB's, `GET /series/volume-cover/<entry>`), `VOL. n`, its state
(READING in accent, READ ✓, nothing unread), its title verbatim and
`n CHAPTERS · m READ`. The volume being read adds a 3px accent bar, and a read
volume's title drops to text-2. A coverless volume draws the series' stripes
with its number. Front and back matter list under the head, uncounted. The
rail's ticks become one per volume, thinning their labels under 28px.

The head is 104px at tablet and desktop, 82 on a phone and 96 on a TV. It is
not a button and never a focus stop. Arriving on the row under it with the pad
shows the head from the list itself (`showHeadUnder`). The row under a head is
the first one after it that can take focus: a first chapter, a front-matter
entry under its `FRONT MATTER` section, a fold, or, descending, a last chapter,
V1 included. A pointer's tap focuses the row and moves nothing.

`tests/volume-head-frame.e2e.ts` pins the widths and the tap,
`tests/tv-volume-head.e2e.ts` the pad and each upward walk.

## The WORK row

A series in a Work gets **one row between CONTINUE and DOWNLOAD**, because it
answers the same question: what after this ([`WORKS.md`](WORKS.md)). It shows
the Work's name over `PART 2 OF 3 · NEXT · ETERNAL FORCE`, and two 52px ← →
cells (44px on a phone) that open the neighbouring parts, dimmed at the ends. A
tap on the name opens `/work/N`; a long press, MENU or a held OK opens the
row's sheet: OPEN, MOVE ↑ ↓, and TAKE OUT with a band and UNDO. That UNDO
refuses rather than overwrite when the library has moved on (the series is in
another Work now, the Work has ended, or a newer one has its id), and the
refusal is the screen's band with NOTHING CHANGED, never an error page, as TAKE
OUT, THEN HIDE's is. A series in no Work has no row.

- **Where the run is.** The line says `NEXT · <part>` while the run is here, and
  `YOU'RE IN <part>` once the reader is already in another part it has begun.
  Both are `workRowLine`'s.
- **The accent.** When this part is done (read through, or caught up on a
  source still going) and the next part has **not been started**, the row
  becomes the accent row `NEXT · <next part> · IN <WORK> · PART 3 · 98 CH. · ▶
CH. 1`, one tap into the next series' first chapter, and CONTINUE above it
  goes quiet as `↺ READ AGAIN`. There is **one accent on the screen, and it is
  the run's**: the panel and the header's ▶ cell read the same part state, so a
  read-through part never shows two accent bars. A next part already begun is
  not offered as an accent: the plain row says `YOU'RE IN` it.
- **The back cell** names the Work when the series was opened from its run
  (`?from=work:<id>`): `← THE BREAKER`, and `← LIBRARY` otherwise. The id is
  validated and the series' own membership checked, so a stale id is not a
  claim the cell repeats ([`NAVIGATION.md`](NAVIGATION.md), "From a Work").
- **Every Work control posts the Work it was drawn on.** MOVE and TAKE OUT in
  the row's sheet, the screen's UNHIDE, and the HIDE sheet's HIDE ALL n each
  post the Work's `created_at` as `made`; a Work under that id made at another
  moment (its id given to another) or a post with no moment is refused with
  `THAT WORK HAS CHANGED · LOOK AGAIN` and nothing written. A Work that has
  ended leaves the series in no Work, and the same four actions answer
  `THIS SERIES IS IN NO WORK` instead; that refusal says `stale: true` as well.
  Either way the screen then re-reads its load, so the band is drawn over the
  Work the series is in now (or the absence of one) and the next press posts
  that Work's moment; the row's sheet closes on the refusal, and so does the
  HIDE sheet. [`WORKS.md`](WORKS.md), "Every form names the Work by its id and
  its moment".

Tested in `tests/work-row-frame.e2e.ts` (the three states' measurements, the
links, MOVE and TAKE OUT) and in [`WORKS.md`](WORKS.md)'s flow.

## Rules worth knowing

- **The cover resumes.** A tap on it goes where ▶ CONTINUE goes, once that is
  known (not while the series is still drawn in outline): the biggest thing on
  the screen is the way in.
- **The time read** is a line under the title and its alternatives:
  `READ 12 H 40`, or `WATCHED` for video (the registry's `unit.done`), `40 MIN`
  under an hour and `< 1 MIN` for a glance. It sits beside the read progress
  (an anime's `seriesCountLine` is just above it), comes from the reading log's
  one summary ([`READING-LOG.md`](READING-LOG.md), "Who reads it"), and is
  absent where the log holds no time. A series' own total needs no `SINCE`: it
  is that series' reading as logged. It is not drawn in the outline, and is at
  the top of the panel, so the DETAILS fold keeps it in view.
- **A long press on a PAGES cell** opens the page menu: set it as the book's
  or series' cover, or read from it; the chosen page wears a COVER corner
  ([`COVERS.md`](COVERS.md), "Chosen").
- **SAME BOOK AS …** is a band under CONTINUE on a book with a likely twin,
  with KEEP BOTH and REVIEW → ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)).
  KEEP BOTH carries out the decisions waiting from before first, as every
  decision does, and says when one of them could not be: a band where the
  twin's was, `KEPT BOTH · 1 EARLIER DECISION COULDN’T BE CARRIED OUT`, with
  `BACK IN THE REVIEW` (refused: dropped, the pair is undecided again),
  `STILL WAITING` (a bug or the disk; tried again on the next library load) or
  both counted, and `SEE DUPLICATES →`. This KEEP BOTH is recorded either way,
  so the answer is a success carrying `refused` and `failed`, never a 409. The
  band is drawn from the action's `form`: it outlives the reload that takes the
  twin's band away, and goes with the next action, a navigation or a reload.
  Nothing is drawn when everything was carried out.
- **LISTS and COVER** sit under SHELVES on every series but a doujin. LISTS is
  one row with a line per list: the entry the series is linked to, what that
  list says of it, what was sent, and the line's cells (its own section,
  below). COVER says where the cover comes from ([`LINKS.md`](LINKS.md)).
- **TAGS** groups a series' tags by namespace (genre, circle, artist, …; a
  bare tag under `tag`). **Every tag can be read and opened**: a line wraps
  instead of cutting off, one value longer than the row breaks inside itself,
  and each value is its own box with its dot (`.val`, `inline-flex`), because
  the pad compares boxes and an inline link's is the whole wrapped area, and so
  that no line starts on a dot. A namespace may be any length (`parseTag`), so
  a long one wraps inside its column and never reaches its values, whose left
  edge does not move. Four namespaces show; past that, `+ N MORE ↓` (`N`
  counts values, as `tagGroups`' `more` does) opens the rest and `LESS ↑`
  folds them, ABOUT's own control and look, set under the values and not the
  namespaces so ↑ and ↓ on a TV meet the lines instead of passing them. It is
  never remembered and belongs to the series it was opened on (`tagsOpenOn`).
- **Every tag value is a link**: to the library's person page for a person and
  its tag page for the rest (`/?tag=<namespace>:<value>`, or the bare value
  for a tag with none). On a series whose origin key names a source BROWSE can
  open (installed, listed with this reveal, loaded, and the engine there:
  `tag-source.server.ts`), a tap opens a sheet of two rows instead: **IN THE
  LIBRARY**, the same page, and **IN <SOURCE>**, that source's page finding
  it, its genre's filter included, or a search for the value
  ([`BROWSE.md`](BROWSE.md), "Arriving from a tag"), whose ← comes back to the
  series. A series with no origin, a source not installed or failed, and a
  Hentoid, folder, EPUB or import key have no sheet: the tap goes straight to
  the library. The key decides, never the kind: a doujin from a Mihon source's
  gallery asks too.
  - The screen asks the source nothing: IN <SOURCE> is a link to
    `/series/<id>/tag-search?ns=&value=&from=`, a server route that waits for
    the source's filters (or `TAG_SCHEMA_WAIT_MS`) and then answers 303, so the
    row is never a guess made before they came, and the sheet stays open while
    it waits. That wait is up to 20 s on a cold source, and a TV's WebView
    draws no loading bar, so the chosen row says it: `aria-busy` and a second
    line, `FINDING <SOURCE>'S FILTERS…`, until the page goes; it stays the
    focused stop, readable. BACK restores the screen from the bfcache, where
    nothing else runs, so `pageshow` clears the mark, and so does another tag.
  - A hidden series, with reveal off, has no sheet and its route is not found.
    Without script the tag's link is the library's.
  - A value appears as often as it is stored: a bare `x` and a `tag:x` are two
    values in the `tag` group, each its own link to its own library tag
    (`?tag=x` and `?tag=tag%3Ax`). Each link is built from its stored tag, in
    `tagGroups`' order, never looked up by its value, which would find the
    first for both and link both to `?tag=x`.
  - On a TV the pad reaches the values (↓ to the row meets its EDIT, ← into
    them), OK opens the sheet on its first row, and BACK closes it onto the
    tag.
- **SOURCE sits after LISTS and COVER**, before EDITIONS and FILE (and, in the
  fold, before TAGS), on every series whose chapters or episodes come from a
  Mihon or Aniyomi source: MOVE → to another source, and for 30 days after a
  move WAS … · UNTIL … with MOVE BACK ([`MOVE.md`](MOVE.md)). A local import
  has no such row. A chapter kept from the source the series left says its
  source in the status column, and FILE counts it
  (`25 OF 125 DOWNLOADED · 2 FROM ASURA SCANS`).
- **OCR and WORDS** sit under DIRECTION on every series that isn't a novel:
  how far OCR has read it on the workstation, with **OCR** to switch it on for
  one not seen as Japanese, and the words looked up in it waiting for review.
  [`JAPANESE.md`](JAPANESE.md) has the states.
- **Marked unread stays unread.** The import moves read state only forward,
  from Mihon's and Hentoid's own records, and Mihon keeps a chapter's old
  "read" for good. So MARK UNREAD is remembered (`entries.unread_at`,
  migration 28), and an import brings a read back only when it's newer than the
  unmark: a chapter read again on the phone since still counts. MARK READ, or
  finishing the chapter here, forgets the unmark.
- **Rating** is out of 10, set with the blocky slider, and 0 is unrated, so the
  slider always has a way back to unrated. It fills up to the rating, FAV sits
  at its end, and on a linked series it is also the score AniList and MAL get
  ([`RATINGS.md`](RATINGS.md)).
- **Direction** is stored per series (`series.direction`), and `NULL` means the
  kind's default, which Settings sets per kind (MODE): out of the box manhwa
  scrolls, manga and doujin read R→L, novels page. The reader's REMEMBER writes
  the same field.
- **One row per chapter,** even when Mihon had it from two scanlators. The
  SCANLATOR row picks whose copy represents a chapter
  ([`DUPLICATE-CHAPTERS.md`](DUPLICATE-CHAPTERS.md)). It is drawn only on a
  series with duplicates to hide, after DIRECTION, in the shelves row's idiom
  (outlined chips, the chosen one inverted).
- **Novels' untitled entries show their label** ("Vol. 13"), not
  "Chapter 13", because a novel's entries are often volumes.
- **`#`** is an inline field in the list header.
- **A long press on a chapter row reads it and everything before it,** in
  reading order, whatever order the list is sorted in: Mihon's "mark previous
  as read". A band says "MARKED READ THROUGH CH. 41 · 38 CHAPTERS" and offers
  UNDO, which unmarks exactly the chapters that changed and leaves the ones
  already read alone. It's the common case after an import, in one gesture
  where RANGE takes three taps. It's logged as marks (`mark_read`), not
  reading. It works on not-downloaded rows too, which a tap doesn't open, and
  is off while selecting. An episode row's long press does the same, and its
  bands say episodes and watched ("MARKED WATCHED THROUGH EP. 5 · 3 EPISODES",
  "PUT BACK 4 EPISODES"). The words are in both languages and take the unit
  from the series' kind (`through-words.ts`, `tests/through-words.spec.ts`).
- **UNDO of a MARK READ THROUGH puts the old place back**, through its own
  action, `?/undoMarkThrough`, because `?/mark read=0` is MARK UNREAD, which
  clears the place. The answer of `?/markThrough` carries the press's stamp and
  each changed chapter's `last_position` and `last_offset` (a page, or a block
  and its character), and UNDO posts them back. They are a claim, read as
  "UNDO's facts" says (below), and compared: the press writes no place, so a
  chapter still holding the press's stamp and the place it handed back goes
  back to unread there, and a ▶ CONTINUE resumes it. A chapter read or marked
  since, in another tab or on another device, does not match: it is the newer
  word, so it stays as it is, and the band says `PUT BACK n CHAPTERS` and
  `m READ OR MARKED SINCE · LEFT AS THEY ARE`. A reader still open elsewhere
  that posts its place after the UNDO moves the place as any reading does; the
  chapter is unread and resumes there. No `reading_events` row and no clock
  decides any of it.
- **The fold** only forms when it would hide at least three rows, because a
  fold of one saves nothing. Its SHOW expands in place and stays expanded for
  the visit. It sits at the bottom when the list is flipped to newest-first.
  The flip is remembered per series on the device (localStorage).
- **Mark read / unread** changes exactly the selected entries that weren't
  already in that state, and never an entry of another series, whatever the
  form says (`markEntries`).
- **MARK UNREAD starts a read chapter from the top.** `?/mark read=0` clears
  `last_position` and `last_offset` on every entry it changes (those are the
  ones that were read, by a finish or by a mark), text and image and episode
  alike, and on the copies a representative stands for, or the next reconcile
  would carry a copy's place back
  ([`DUPLICATE-CHAPTERS.md`](DUPLICATE-CHAPTERS.md)). A chapter that was never
  finished is not one it changes, so it keeps its place and ▶ CONTINUE resumes
  it. Marking read writes no place. Rows marked unread before this rule keep
  their old place: nothing recorded which were finished when they were marked,
  so no migration can tell them from a chapter left midway, and they are left
  as they are.
- **A tapped tag suggestion wins over the half-typed text.** The suggestion is
  submitted as `pick` beside the field's `tag`. Reading `tag` first would store
  `genre:ise` instead of `genre:isekai`, a second spelling, which is exactly
  what suggestions exist to prevent. `tests/series-flow.e2e.ts` holds that
  down.
- **Enter adds what was typed, never a suggestion.** The suggestions are the
  form's submit buttons, so left to the browser, Enter submitted through the
  first of them: a tag never typed, or nothing at all when that one was ✓ ON
  THIS and so disabled. The field submits the form itself, with no submitter,
  so only a tap sends `pick`. A suggestion list whose answer lands after the
  text moved on is dropped, not drawn under the new text.
  `tests/browse-tags.e2e.ts`' "a bare tag and its tag: twin" case holds Enter
  down with the disabled suggestion first.
- **Suggestion counts only include visible series**, so the tag field can't be
  used to learn how many hidden series carry a tag.

## FAV and the rating

A tap on FAV or the rating shows at once and saves behind it
([`WAITING.md`](WAITING.md), "Writes that fail"). Two quick taps posted
together could be stored in either order, and the first answer's reload would
put the stored value back over the second tap. So saves are serialised by
`src/lib/serial-saves.ts`:

- **One save in flight per series and field.** A tap's save waits for the
  one before it on the same key (`fav:<id>`, `rating:<id>`); FAV never waits
  for the rating, nor one series for another. The queue is the app's, not
  the panel's, so a panel mounted again (out to the library and back within
  a slow save) still waits.
- **A latest save's reload is part of its turn.** The next save on the key
  waits until the newest one has answered _and_ its reload has landed, so a
  tap made during that reload posts only after it, and is judged against the
  value the reload brought (what is stored, PUT BACK's label). The reload is
  awaited in a `finally` that lets the queue go, so a reload that throws never
  holds the key for the session.
- **A save superseded before its turn is not sent.** Three quick taps send
  the first and the third: when the second's turn comes, a newer tap is
  already queued and only the last value matters, so N taps are never N
  round trips.
- **The last tap wins.** Only the newest save reloads the page; a superseded
  one, stored or not, does nothing more. "Newer" means a tap on the same key
  made after this one, never "a save is pending": an older turn still
  reloading is pending too, and its pending must not swallow the newest tap's
  band. The local value stands while any save of its field is pending (queued,
  running, or answered and reloading) or unsaved, so neither an earlier
  answer's reload nor one from elsewhere resets it. Once nothing is pending,
  the stored value is the one shown.
- **A failure is the newest tap's alone.** A first save lost while a second
  waits leaves no band: the second is what counts. When the newest fails, its
  band names what is stored now: if an earlier tap of the burst was stored,
  the page is reloaded first, so PUT BACK says `PUT BACK 6` (what tap one
  stored), not the value the page loaded before both. A failed save of the
  value already stored (tap 6 lost, then tap 0 lost, on an unrated series)
  leaves nothing unsaved and shows no band.
- **RETRY and the next request's retry wait their turn too**, and a tap while
  the band shows clears it.
- **The URL is taken at the tap.** A save that waits its turn still posts to
  the series it was tapped on, whatever the screen shows by then.

The library tile's FAV and rating (`src/routes/+page.svelte`) run on the same
queue, with the same `fav:<id>`/`rating:<id>` keys, so a tile tap and a
series-screen tap on one series wait for each other too.

Tested in `tests/series-domain.spec.ts` (the queue: order, three taps,
failures, independence, a tap during the reload), `tests/series-flow.e2e.ts`
(two FAV taps and three rating taps with the first save held, a lost first
save, and the newest failing after an earlier one was stored, each through a
reload) and `tests/library-flow.e2e.ts` (the first tap held, two quick taps,
the screen's tap after a tile tap, and a newer tap failing during the earlier
tap's reload).

## UNDO's facts

A band carries what its action did as JSON in a hidden field, and its UNDO
posts it back. What arrives is a claim (a stale page, a hand-made form, a
truncated field), so each UNDO on this screen reads it with
`src/routes/series/[id]/posted-facts.ts` before writing: parsed inside a
guard, checked field by field (a missing number would reach SQLite as
`undefined`), and checked to be this series' own. Anything else is 400
`NOTHING TO UNDO` with nothing written. The four that post facts:

| Action              | This series' own when                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| `?/undoTakeOutWork` | `seriesId` is this series, and an ended Work (`ended`) had it among its members        |
| `?/undoAddToWork`   | `seriesId` is this series, and every Work the add ended (`ended[]`) had it as a member |
| `?/undoHide`        | it is among what the HIDE hid, or a take-out names it; every take-out is its own       |
| `?/undoRename`      | `seriesId` is this series                                                              |

HIDE ALL n hid every part of the Work, so `?/undoHide`'s other ids are not
checked against the Work now: one ended since by another press is still
undone part by part, as `undoHideWhole` does for a series in no Work. Facts
that pass, but describe a library that has moved on, are refused by the
writers ([`WORKS.md`](WORKS.md), "An UNDO puts back only what its press
changed"). Tested in `tests/works-offer-db.spec.ts` ("every UNDO on the series
screen…"), each action with every field missing or mistyped, another series'
facts and a library moved on, against a whole snapshot.

## At a larger text size

The phone and tablet app follows Android's font size up to 130% through the
WebView's `textZoom` ([`ANDROID.md`](ANDROID.md)), which scales every computed
font size and nothing else. Two things on this screen are sized so they hold
at 130% on a 360 px phone:

- **A tile's title** (`CoverTile.svelte`, the library's and every grid's) is a
  two-line clamp. A fixed `height: 32px` box would cut the second line through
  the middle, so the box is `calc(32em / 13)`: exactly 32 px at the tile's
  13 px type, so every tile measures 32 px at 100%, and it grows with the type,
  two lines at any size.
- **The rows' label column** (`.label`, every row of this panel: SHELVES,
  TAGS, FILE, DIRECTION, LANGUAGE and the rest) is `--label-w` wide, and a
  one-word label cannot wrap, so at a fixed width SHELVES would run past the
  rule into its chips (and DETAILS, on the phone's fold, past its own). The
  column is never narrower than its word (`min-width: min-content`): at 100%
  nothing moves, and at 130% only a row whose word is too wide widens its own
  label.

**How 130% is made in a browser** (`tests/text-zoom.e2e.ts`, the `phone`
project): a browser has no text zoom, so the spec multiplies every element's
computed `font-size` by 1.3 in place at 360 × 780, reading all of them first
and then writing, so nothing is scaled twice. Unitless and `em` line heights
follow, as under `textZoom`; px ones stay, as they do there. It asserts the
tile boxes are 32 px at 100%, that at 130% Drawing's long title still has
both lines' room (less at most the second's half-leading) and never three,
and that no visible label's text runs past its column at either size. The spec
is a browser's stand-in and does not run on a phone.

## DETAILS

On a phone and a TV the settings-like rows of the panel fold behind one line,
so the chapter list is not pushed below every row.

- **What stays above:** identity, RATING and FAV, ▶ CONTINUE, the WORK row and
  every band (NO VIDEO, MIGHT BE ONE SERIES, MIGHT CONTINUE <WORK>, SAME BOOK
  AS, the panel's own UNDO bands), SHELVES, ABOUT, and HIGHLIGHTS when the
  series has any ("HIGHLIGHTS", below). **What folds**, in order: DOWNLOAD
  (with REFRESH and FOLLOW), LANGUAGE, DIRECTION or LAYOUT, OCR and WORDS,
  SCANLATOR, LISTS, COVER, SOURCE, TAGS, EDITIONS, FILE (or FOLDED) and
  RENAME's field. One fold, not one per group, and CONTINUE stays at the top.
- **Where:** the phone (`max-width: 599px`) and the TV (`(pointer: none) and
(min-width: 900px)`), by CSS media queries alone. The tablet in either
  orientation and the desktop do not fold (see "Limits" for the tablet in
  portrait).
- **Two markups.** Where nothing folds the DOM's order is the screen's:
  DOWNLOAD, ABOUT, TAGS, the bands, LANGUAGE to SCANLATOR, SHELVES, LISTS to
  SOURCE, EDITIONS and FILE. Where the fold applies, the bands, SHELVES and
  ABOUT stand above the line and TAGS stays inside it, after SOURCE. Those
  four groups (`.o2`, `.o4`, `.o6`, `.o8`) are the ones the two orders place
  differently, so they are one snippet each drawn twice, one copy per order
  (`.fold-only`, `.screen-only`), and each is hidden by the other's media query
  with `display: none`. The two queries are exact complements
  (`(min-width: 600px)` and `not (min-width: 600px)`), because `max-width:
599px` would leave a fractional viewport (browser zoom) between 599 and
  600 px drawing both. So there is no script (the first paint is right), and
  the copy not drawn is out of Tab, the focus layer (`isVisible`,
  [`FOCUS.md`](FOCUS.md)) and the screen reader. The other four groups are in
  the DOM once. The wrappers are no boxes (`display: contents`).
  - Text inside a drawn-twice group is in the DOM twice, so `getByText` in a
    test needs `.filter({ visible: true })` (roles already skip the hidden
    copy). A test that finds such a row by its class says `:visible`.
  - Neither copy holds an id, a `bind:this`, a `for=`, `aria-controls` or a
    focus scope, and what they show is the panel's own state (`aboutOpen`, the
    page's bands, `tagsOpenOn`), so a band or MORE drawn in the one copy is
    the other's too; a form submits from the copy that can be seen.
  - `tests/series-panel-order.e2e.ts` Tabs the panel on the desktop, top to
    bottom.
- **The folded line** is one row, 64px at the least: DETAILS | a state line
  over the names inside | SHOW ↓. Its words are `details.ts`' `detailsLine`,
  from facts the panel already has, no query of its own:
  - **quiet**, in text-2: FOLLOWING (the DOWNLOAD row's FOLLOW on) or else
    the chosen direction (`R→L`, `PAGED`), then what was sent,
    `SENT CH. 214`, built from LISTS' own line (its state's unit and the
    `SENT …` on its right), so the folded line and the row it folds never say
    the same thing two ways.
  - **a mark**, in ink and 500 (SOURCE's idiom for trouble), when something
    needs attention: a send that failed (a LISTS state line in `alert`: the
    line's `NOT SENT`, named by its list, `MAL · CH. 214 NOT SENT`), a list
    not linked (AniList's or a season's `Not linked` line that offers FIND;
    a hidden series' PASTE-only line and Ranobe's `Not on Ranobe` are not
    marks), a fold of seasons in ink (`foldWord`), and a source not
    answering (SOURCE's `move.trouble`, named by the source). Two or more
    become a count, `2 TO LOOK AT · MAL · MANGADEX`.
  - **running work** (a chapter downloading, from the DOWNLOAD states; else OCR
    running, from `ocrLines`) takes the quiet line's first word
    (`CH. 9 DOWNLOADING`, `OCR 128 OF 212 CHAPTERS`) and keeps the rest, as an
    anime's `EP. 9 DOWNLOADING · SENT EP. 6` does, so both kinds of work read
    alike. It draws a 3px accent bar on the bottom rule, its fill the
    download's or OCR's fraction.
  - It never opens itself: the mark tells, the reader decides. Open, the state
    line goes (the rows say it themselves), the cell inverts to HIDE ↑ and the
    rule goes full ink.
  - Its accessible name is `DETAILS`, or `DETAILS · <the state>` while
    folded: never SHOW, HIDE or MORE, so no other control's locator finds it.
- **Remembered for the device**, one localStorage key,
  `tsundoku:series-details` (`DETAILS_KEY`), `1` for open: wanting the
  settings showing is a habit, not a fact about a series (the list's
  newest-first flip stays per series, `tsundoku:series-sort:<id>`). Closed
  by default. **The server draws it closed**, so the first paint is never a
  flash of it open; a device that remembers it open opens it once the page
  runs, a frame later. **Without script** a `<noscript>` rule shows every
  row and no line, since nothing could open it.
- **ABOUT** clamps to three lines with MORE ↓ / LESS ↑ on a phone (two
  elsewhere, and two on the TV), never remembered. On the TV its MORE is one
  more stop.
- **On the TV** DETAILS is one stop; OK opens or closes it in place and the
  focus stays on it; ↓ goes into the first opened row. Folded, nothing under
  it is a stop (a row with no box is not one), and → is the list beside the
  column. Its text is a size up (state 14, names 12, the cell 14 with 18px
  sides), the cell reads `OK · SHOW ↓`, and the names are cut to four and a
  count (`DIRECTION · LISTS · COVER · TAGS · 1 MORE`). The rest of the TV
  column keeps its own measurements (a 96px cover, a 22px title, a 116px label
  column); `tests/tv-series-frame.e2e.ts` pins them.
- **FIRST READ's ring** on DOWNLOAD ([`ONBOARDING.md`](ONBOARDING.md)) sits on
  the DETAILS line while the fold is closed, the way in, since the fold never
  opens itself.

Specs: `tests/series-lists.spec.ts` (the marks over `listsRow`'s real output,
the line, the names, the key), `tests/series-details.e2e.ts` (the phone, and
the order where nothing folds), `tests/tv-series-details.e2e.ts` (the TV
stop) and `tests/series-phone-frame.e2e.ts` (ABOUT's body and the line's text
at 390).

## FILE and RENAME

**The row.** FILE (FOLDED on a book folded from editions) is its label, the
text (the path, then `13 EPUB · 6.8 MB`), and its cells: RENAME, UNGROUP on a
series of books, a series of volumes or a merged show
([`WORKS.md`](WORKS.md), "UNGROUP, and taking a season out"), HIDE (UNHIDE),
DELETE (UNFOLD in FOLDED's place).

It follows LISTS' rule: where the panel is narrow (the phone, the 440px
landscape panel and the TV's 352px column, the same query as LISTS') two or
more cells drop under the line in equal columns, edge to edge, and the text
has the whole line after the label; the tablet in portrait has the width and
keeps them at the line's end. Beside three cells the text would get 136px at
the 440 panel, 155px at 390 and 74px on the TV, a word a line; under them it
gets 319, 306 and 236 (`tests/series-layout.e2e.ts` measures it per device on
Tower of God, `tests/series-rename-flow.e2e.ts` on a novel of thirteen EPUBs at
390 and 440). One DOM, no second copy of the cells: the row wraps
(`flex-wrap`), and the cells' box takes a line of its own.

**The FILE row counts files, not entries.** A novel's chapters share one EPUB,
so it reads "1 EPUB" (a novel grouped from six books reads "6 EPUB", with
UNGROUP among its cells and a head per volume in CONTENTS,
[`BOOKS.md`](BOOKS.md)). A Hentoid book is a folder of loose images, so it
reads "1 FOLDER", which is what Hentoid stores
([`IMPORT-FORMATS.md`](IMPORT-FORMATS.md)).

**RENAME** is the Work screen's idiom on the series: the cell opens a field in
place under the row (focused, the name selected), DONE writes it, CANCEL
leaves it, and the answer is a band, `RENAMED · NEW NAME` / `WAS OLD NAME`,
with UNDO. A rename to the same name says THE SAME NAME and offers nothing to
undo; an empty one is refused (`A SERIES NEEDS A NAME · NOTHING CHANGED`).
Spaces fold as a typed name's would. Every series has it, not only a grouped
one: whatever a series was called by its importer, it may be called something
else.

- **It sticks, with no column of its own.** `series.title` is written at the
  series' INSERT (the importers' writer, `import/write.ts`, and the grouping
  actions in `books.ts`) and at one place after: `carryEdit`
  (`import/fold.ts`), which carries a hand-given name _onto_ the survivor when
  a download folder's series folds into the one a backup names. Nothing else
  writes it (`rg -nU "UPDATE\s+series\s+SET[^;\`]*" src -o | rg title`).
Every path that meets a series again finds it by its key, its former keys,
its files or its entries' URLs, never by its title, so
`tests/series-rename-db.spec.ts` renames and then runs a rescan (the backup
and tsundoku's own downloads), a newer backup that names the manga by its
source's title, a REFRESH whose source answers its own title, a cover pass,
and tsundoku's next download, which the engine files in a folder named after
the _new_ title (`engine/worker.ts`); each keeps the name and makes no twin.
- **The old name joins `alt_titles`.** The catalogue's and Ranobe's title
  matches read the alternative titles, so a link search still knows the series
  by the name it came with; so do the library's search (`ALSO <old name>`),
  browse's SAME TITLE and a source's chapter numbers. UNDO puts back the name
  and `alt_titles` exactly, and only while the series still has the name that
  rename gave it: a second tab's later rename is the newer word, and the older
  band's UNDO says RENAMED AGAIN SINCE.
- **The library's search reads `title`, then each name in `alt_titles`, then
  tags** (`library.ts`), so a renamed series is found by its new name as TITLE
  and by its old one as `ALSO <old name>`.
- **The colour stays.** `hueFor(title)` picks a series' hue once, at its
  INSERT; the rename leaves `hue` alone.
- **A Work keeps its own name.** A Work's name is `works.name`, renamed on the
  Work screen; a series that is its face keeps the Work's name there and its
  own here.
- **The id is the identity.** A rename keeps the series' id, so every link,
  shelf, Work part and reading stays with it; UNDO finds it by id.

## HIGHLIGHTS

One row, **HIGHLIGHTS · 14 · 3 NOTES →**, in the screen's label-then-value
form, drawn only when the series has a highlight the viewer may see
(`highlights` in the load, `seriesLine`): a book's quotes counted bare, a
manga's `6 PAGES`, an anime's `4 CLIPS`. It opens `/highlights?series=<id>`,
the series' highlights in reading order. The feature is
[`HIGHLIGHTS.md`](HIGHLIGHTS.md).

- **Where:** after ABOUT and above the DETAILS fold on the phone and the TV,
  because highlights are the reader's own, like ABOUT and SHELVES, and a line
  folded away would never be found; after LISTS on the tablet and the desktop.
  The two places want different neighbours, and the screen places rows by
  `order` (above), so the row is in the markup twice: `.hl-fold` after ABOUT,
  `.hl-wide` as the `o5` group's child right after `ListsRow`, and each
  layout's media query shows one (`SeriesPanel.svelte`).
- **DELETE** says what is kept (`14 HIGHLIGHTS ARE KEPT`, DELETE THEM TOO),
  as does a book's DELETE ([`DELETING.md`](DELETING.md)).

## LISTS

One row with a line per list the series is on: AniList, MAL, and Ranobe
(`ranobe.ink`, the reading catalogue tsundoku sends novel, manga and anime
progress to; [`RANOBE.md`](RANOBE.md)). Every colour is a token, and the
spacing is fixed literals on no ladder, pinned by
`tests/series-lists-frame.e2e.ts`, `tests/series-layout.e2e.ts` and
`tests/tv-series.e2e.ts`.

**What draws it.** `src/routes/series/[id]/lists.ts` derives every word and
cell from what the server already hands the panel (`LinkState`, `Tracking`,
`RanobeSeries`, an anime's `SeasonRow`s); `ListsRow.svelte` only draws, and
`TrackingSheet.svelte` is EDIT's sheet. `tests/series-lists.spec.ts` pins the
rules; `tests/series-lists-flow.e2e.ts` reaches the states through the app's
own actions.

**A line** is a tag cell (ANILIST, RNB, or S1 to S4 on an anime with several
seasons), then the entry's title, its meta, and its state lines, then its
cells. The line that tracks comes first: AniList on a comic, Ranobe on a
novel (`Tracking.catalogueTracks`, never a kind check), the seasons on an
anime with Ranobe's one line under them, a rule above it.

- **MAL folds into AniList's line**: its id in the meta, and
  `ANILIST AND MAL · SENT 12 MIN AGO` on the right. It gets a quiet line of its
  own, inside AniList's, only when it differs (`entryStates`): signed in where
  AniList isn't or the other way round, a send of its own that failed, or
  another word or chapter on its list (`MAL AT CH. 198`). MAL alone (AniList
  not asked yet) leads with its name and says `SHOWN · ANILIST HAS NOTHING`.
  The line speaks for the first list that is signed in, AniList before MAL
  (`mainList`): with AniList signed out and MAL signed in, MAL's word leads
  (`MAL · WATCHING · EP. 8`, on every season, watched or not) and AniList's
  NOT SIGNED IN is the quiet line. A fold's word, the sheet's STATUS and a
  two-part season's other part (`PART 2 PLANNING` on the right, and the
  sheet's PART row) ask the same list (`listState`, which lives with
  `mainList` in `src/lib/library/tracking.ts` so the server's
  `seasonsTracking` asks it too). A signed-out list keeps what it last said,
  so a chooser that read AniList first would show its stale word there.
- **An anime's seasons**: three or fewer have a line each; more fold round the
  one being watched (its tag inverted), and the fold says the run's state
  (`COMPLETED`, `2 NOT LINKED`, `A SEND FAILED`). SHOW draws every season.
  Every season line carries its list's word; only the season being watched
  adds its meta and what was sent. A season in two parts leads with
  `PART 2 · `, part 1's word on the right and the send under it.
- **A flat list** (episodes with no season numbers, season 0 inside) and a
  show of one season draw one ANILIST line, never an S tag and never SEASON 0.
  Season 0 beside numbered seasons is tagged OTHER, and a fold that holds it
  says `OTHER + S1 – S2`.
- **A comic's meta says where it comes from once AniList has said so.**
  `series_links` keeps the entry's `country` (AniList's `countryOfOrigin`) and
  start `year` wherever a link is made (FIND, the review, a paste, the list,
  the cover pass's resolve), so a KR comic reads `MANHWA · 2020 · MAL 132214`,
  a CN or TW one `MANHUA`, a JP one `MANGA` (`entryWords` in `lists.ts`, a map
  from the country applied to AniList's one comic format, MANGA; every other
  format is its own word). A link made before migration 70 has neither until
  the next cover pass asks AniList for them (`resolveLinks`, which then writes
  only those two, never the title, cover or format the link already settled),
  and until then it reads `MANGA · MAL 132214`, never `MANGA · null`. An entry
  AniList does not have any more is asked once (`country = ''`). An anime's
  season link is never asked: its season keeps its own year. EDIT's ENTRY says
  the same (`ANILIST 7701 · MANHWA · 2024`). The ANILIST id stands in for MAL's
  where there is no MAL entry.
- **A novel's AniList line says `COVER AND DETAILS · TRACKED ON RANOBE`**, so
  no line names a kind; without a Ranobe token it says
  `COVER AND DETAILS · NOT TRACKED HERE`.
- **A queued search says `A SEARCH WAITS FOR THE NEXT COVER PASS`**, which is
  true of every queued one: a queued search doesn't know whether AniList was
  out of reach, so it never claims so.

**The cells.** One stays at the line's end; two or more drop under the line
in equal columns on the phone, the 440px panel and the TV, and stay inline
on the tablet in portrait. The order is TRY AGAIN, SIGN IN →, FIND or CHANGE,
PASTE A LINK, EDIT. TRY AGAIN is per line: a season's names its season
(`?/retryTracking` sends that season's alone), a comic's sends both its lists,
and Ranobe's is `?/retryRanobe`. A sign-in that expired offers SIGN IN → in
TRY AGAIN's place, unless the other list's send failed for another reason:
then the line offers both. A season's FIND keeps one cell (PASTE A LINK is on
the review it opens); a hidden season's is PASTE. A settled line's FIND is
plain, not the accent: the answer was already no. Ranobe's line keeps FIND and
PASTE A LINK on a comic or a novel, and FIND alone on an anime.

- **EDIT stays on a line that is signed out.** OPEN ↗, CHANGE and UNLINK live
  in EDIT's sheet, so without it a signed-out series could never be relinked
  or unlinked from this screen. The sheet says NOTHING SIGNED IN where STATUS
  would be.

**Where the row sends you.** FIND on AniList's line opens `/links?series=N`, a
season's `&season=S`, Ranobe's `&service=ranobe`, and PASTE adds `&paste`.
CHANGE on a wrong-kind line, and in the sheet, opens the review on the current
link. SIGN IN → goes to SETTINGS. EDIT opens the sheet.

**EDIT's sheet** opens on that line's entry and season tab. ENTRY holds the
entry's title and ids, where the link came from, and OPEN ↗, CHANGE and
UNLINK (UNLINK names the tab's season on a show with several, and none on a
show of one, whose UNLINK takes every part). STATUS sends at once to the lists
signed in, and says NOTHING SIGNED IN rather than offering what can't be sent;
a cover-only, wrong-kind, hidden or novel's entry says why it is never tracked
instead. PROGRESS is each list's. On Ranobe's line it is the same sheet with
nothing to set: Ranobe works the status out from the reads, and its ENTRY has
RANOBE ↗, CHANGE and UNLINK.

**UNLINK** closes the sheet on a band, `UNLINKED · <ENTRY>` /
`NO PASS LINKS IT AGAIN` (`S3 · NO PASS LINKS IT AGAIN` on a season), with
UNDO: the rows that went come back with every column (`via`, dates, score,
`filled_rating`, a season's `episodes` and `year`), keyed by the series and
its season and part, never a row id, and the UNLINK's own `unlinked` decision
goes with them (the one it replaced, if any, comes back), so the next pass
treats the series as linked. The band carries what went in its form, as
RENAME's and ADD TO A WORK's do (`UnlinkFacts`, read back field by field by
`parseUnlinkFacts`), so it goes with the screen: after a reload FIND is the
way back. UNDO is all or nothing and never writes over a newer act: a link
made since (another tab's PASTE, a pass) or a decision since (NONE OF THESE),
on any part the UNLINK named, the parts it found with no link included,
refuses it as `LINKED OR DECIDED AGAIN SINCE` · NOTHING CHANGED, and a second
UNDO of the same band says `ALREADY UNDONE`. AniSkip's marks, which UNLINK
clears, are asked again as for any new link.

**Every state, and where it is drawn:**

| State              | Drawn as                                                                                                                                                                                                                                                                                             | Reached in                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Not linked         | `Not linked` muted; the search's own words (`NOT SEARCHED YET · THE NEXT PASS SEARCHES IT`, `A SEARCH WAITS FOR THE NEXT COVER PASS`, `4 FOUND ON ANILIST · NOT FOR CERTAIN`, `NOTHING FOUND ON ANILIST`, `NONE OF THESE · NO PASS ASKS AGAIN`, `UNLINKED · NO PASS ASKS AGAIN`); FIND, PASTE A LINK | links-flow, series-lists-flow                                               |
| Linked and tracked | the list's word in ink, what was sent on the right; EDIT                                                                                                                                                                                                                                             | series-lists-flow                                                           |
| Signed out         | `ANILIST AND MAL · NOT SIGNED IN` / `NOTHING SENT`, or MAL's quiet line; SIGN IN → and EDIT                                                                                                                                                                                                          | tracking-flow, the frame spec                                               |
| A send that failed | `CH. 3 NOT SENT`, the reason in ink on the right; TRY AGAIN                                                                                                                                                                                                                                          | series-lists-flow (a catalogue that is down)                                |
| Cover-only         | `THE COMIC’S ENTRY · …`; `COVER AND DETAILS ONLY · NEVER TRACKED`                                                                                                                                                                                                                                    | series-lists-flow                                                           |
| Wrong kind         | `LINKED TO THE WRONG KIND · NOTHING SENT`, `CHANGE SEARCHES ANILIST’S ANIME`; CHANGE as the accent, EDIT                                                                                                                                                                                             | series-lists-flow (hand-seeded link)                                        |
| Hidden             | `HIDDEN SERIES ARE NEVER SEARCHED`, PASTE A LINK alone as the accent; linked, `NOTHING SENT · HIDDEN SERIES STAY OFF EVERY LIST`; with seasons the strip says `NOTHING SENT · HIDDEN` once                                                                                                           | series-lists-flow                                                           |
| Never tracked      | `NOTHING SENT · ITS SOURCE IS NEVER TRACKED` on every line (AniList's, each season's, Ranobe's), and the strip says `NOTHING SENT · NEVER TRACKED`; no EDIT, TRY AGAIN or SIGN IN →, and an unlinked line keeps FIND, since a search is not a send                                                   | `browse-source-flags` (the switch, the screen), the unit spec (every shape) |
| Offline            | the strip: `○ OFFLINE · CHANGES NEED THE WORKSTATION`; EDIT turns into OPEN ↗, every other cell dims, sends read `AS OF 14:20`                                                                                                                                                                       | series-lists-flow                                                           |
| Ranobe on a novel  | RNB first; the AniList line `COVER AND DETAILS · TRACKED ON RANOBE`                                                                                                                                                                                                                                  | ranobe-flow                                                                 |
| Ranobe on an anime | one RNB line under the seasons, `RANOBE · ONE ENTRY FOR ALL 4 SEASONS`                                                                                                                                                                                                                               | series-layout (one season), the unit spec                                   |
| Many seasons       | the fold, the watched season inverted, SHOW / HIDE                                                                                                                                                                                                                                                   | series-lists-flow                                                           |
| A flat list        | one ANILIST line, no S tag, no SEASON 0 on the row or in the sheet                                                                                                                                                                                                                                   | links-flow                                                                  |

**Per device.** The 440px panel and desktop: a 36px strip above the lines,
tag 64, line 56, title 14, meta 12, cells 13, the drop 48. The phone: tag 60
(ANILIST does not fit 56), line 52, title 13, the drop 52. The tablet in
portrait: the label column (120) instead of the strip, title 15, meta 13,
cells 14, every cell inline. The TV: tag 56, line 56, title 16, meta hidden
(one OK away, in EDIT), cells 15; ↑ ↓ move a line at a time and ← → between a
line's cells, with the house's inset focus mark.

### A film's and a show's line

A film or a show has **one line, TMDB's**, and never an AniList line:
`linkState` answers null for a kind AniList does not hold, and `tmdbLine`
draws the `TmdbLinkState` the load hands the panel. With no key it reads
_Not looked up_ and `SET UP →` in ink; linked, the entry and
`FILM · 2019 · 1 H 52` with CHANGE. The trackers' `LIST · Kept in HISTORY`
line sits beside it. [`LINKS.md`](LINKS.md), "TMDB links", has the whole of
it.

## A film's screen

A film is a series of one entry with no list, so what a list says elsewhere is
said once (`src/lib/library/film.ts`, pinned by `tests/film.spec.ts`). More on
films and shows in [`FILMS-SHOWS.md`](FILMS-SHOWS.md).

- **One primary cell**: `▶ PLAY · 1 H 58`, `▶ CONTINUE · 42 MIN LEFT` with its
  3px on-accent line at the foot, `↺ WATCH AGAIN · WATCHED 3 NOV`, quiet. The
  length is the file's once measured, TMDB's runtime until then, else none.
- **The count line**: `2024 · 1 H 58 · DRAMA`, `· WATCHED` once it is; with no
  TMDB link it closes up to `FILM · <SOURCE> · 1 FILE`, nothing dimmed or
  unknown. The genre is the series' own (its source's first genre tag), so
  ABOUT's foot lists the source's, and a film with none says none.
- **DOWNLOAD** is one file's: not here, queued, downloading, failed, here, with
  one cell (DOWNLOAD, CANCEL, TRY AGAIN; `?/cancelDownload`, `?/retryDownload`,
  scoped to the series' own entries). No NEXT 10, ALL, REFRESH or FOLLOW.
  QUEUED says only its size, and a failure says `THE LAST TRY FAILED`, since
  the page carries neither the queue's order nor its error.
- **KIND** takes DIRECTION's place (a video has none) and lives inside DETAILS on
  a phone. CHANGE opens `KindSheet.svelte` on `planKindSwitch`
  (`src/lib/server/kind-switch.ts`), loaded with the page (nothing moves until
  asked); the band after it says what moved and where, with UNDO.
- **The stage** (`FilmStage.svelte`) takes the list's column: the backdrop at
  16:9 on the series' stripes until it loads, `01 — THE COLLECTION` (the TMDB
  collection, with its fold and GROUP →, which opens the GROUP sheet with the
  parts here in TMDB's order), and `02 — ABOUT`. With no link the stage is
  empty. The backdrop is stored with the link (`series_tmdb_links.backdrop_url`,
  migration 82).
- **On a TV** the stage is facts only: each linked row is drawn twice and CSS
  keeps the plain copy, so the focus layer never finds a cell, and ABOUT is
  not drawn. With no key the film reads as it does on every other device, and
  the DOWNLOAD row reads as it does elsewhere. `tests/tv-film-screen.e2e.ts`.

`tests/film-screen.e2e.ts` walks it on every device with a seeded linked film.

### A show's screen

A show is the anime's screen, with its TMDB view drawn in three places:

- **The heads**: the show's other seasons in the episode list, before and after
  this series' own, in the shape the anime's seasons around it already draw
  (`showAround` in `src/lib/library/surroundings.ts`, returning a
  `SeasonsAround`): `SEASON 1 · 10 EP` with IN LIBRARY →,
  `SEASON 4 · 8 EP · TMDB · FROM 3 NOV`. `next` is null for a show on its last
  season, and `after` carries the seasons past the next, which AniList's walk
  never has.
- **SEASONS** under LISTS: `3 of 4 in the library`,
  `TMDB LISTS 4 · S4 NOT IN THE LIBRARY`, and FIND THE REST →, the series'
  own source searched for the show's name. No key, no row.
- **SEASON 4 IS OUT** under CONTINUE, for the first aired season past every one
  here: FIND and NOT THIS, which is kept (`tmdb_offers_declined`) and has UNDO.

## The ADDED band's place in history

**The add replaces the preview's history entry**: the series takes its place
in history, so one swipe back from it is the catalog it was found in, at the
place it was left ([`BROWSE.md`](BROWSE.md), "The add replaces the preview").
The band's own **UNDO ends the series and returns to the preview, so it
replaces the series' entry too**: one swipe back from the preview is that same
catalog, not the series UNDO deleted (a 404), and the preview's ← says BROWSE
because the origin rides back with it (`?from=`). Both forms are
`use:enhance={replacing}` (`src/lib/back.ts`). A search's origin comes back as
its query too (`?q=`): the preview reads where it was found from `q` alone, so
`from=` alone would leave its ← on the bare search page. Without script the
POST's 303 is a full navigation, which no page can replace: it still pushes.

The **hidden band** (`/browse/<source>`'s, or `/browse`'s once the source is
mostly hidden; `src/routes/browse/AddedBand.svelte`) has the same UNDO, and
none of this screen's route: it replaces the landing's entry, and the catalog
the ADD recorded on its URL (`catalog`) rides back to the preview, so ← says
BROWSE there too. A preview reached by a shared link records no catalog, so
its ← says SOURCES ([`BROWSE.md`](BROWSE.md), "The add replaces the preview").

## Shelves in the ADDED band

A preview's **+ ADD TO LIBRARY** (and ADD AND DOWNLOAD) lands here with
`?added=`, and under ADDED TO THE LIBRARY the band has a second line:
`PUT ON A SHELF:` and the library's shelves as chips, one tap each, several
allowed. A chip that is on reads `✓ LATER` and the line says which shelves
the series is on (`ON LATER, TONIGHT`); a second tap takes it off. Adding
stays one tap for someone who doesn't shelve, and shelving is the same moment
for someone who does. It is the band `/browse` draws for a hidden ADD
([`BROWSE.md`](BROWSE.md), "Shelves in the ADD band";
`src/routes/browse/AddedBand.svelte`), on the same rules
(`src/lib/library/add-shelf.ts`, called as it is):

- **The order**: the shelf last put on from a band, on this device, first
  (`tsundoku:add-shelf` in localStorage, read once as the band is drawn, so
  the chips keep their places while it is up), then the library's order. A
  shelf put on from the SHELVES sheet is not remembered: only a chip is.
- **Past six shelves** the chips stop at six and `N OTHER SHELVES` opens the
  SHELVES row's sheet (`EditSheet`, the one EDIT opens); a shelf the series
  is on is always drawn as a chip, in place of the last one that is not.
- **+ NEW SHELF** opens the same sheet with its name field open; the shelf
  it makes has the series on it (its `?/shelf` with a name).
- **The write** is this screen's own `?/shelf` (`collection`, `on`), the
  SHELVES sheet's: no new storage. A chip's post carries the page's query,
  so without script its answer is still the band. A refused tap (a shelf
  that is not there, or the series gone after an UNDO in another tab) says
  `NOT SHELVED: …` in the strip, and the band and its UNDO stay. A tap
  that is put through reads the page again and leaves the screen's other
  answers alone: REFRESH's or FIRST 10's band beside the chips stays up
  (`invalidateAll`, not `enhance`'s `update`, whose `{ ok: true }` would
  clear them).
- **UNDO** (`?/undoSourceAdd`) deletes the series row, and its shelf rows
  go by the schema's cascade (`collection_series … ON DELETE CASCADE`):
  UNDO takes both back. The shelves themselves stay.
- **The TV**: the strip is a row of stops under the band; `+ NEW SHELF` sits
  at its right end, under UNDO, so ↓ from UNDO lands in the strip and ← → walk
  the chips ([`FOCUS.md`](FOCUS.md)).
- **Not here**: just after the FIRST READ step's ADD the band is the start
  trail's (`readBand`), which keeps UNDO and draws no chips. A hidden ADD
  lands on `/browse`, whose band has its own chips; the ADDED HIDDEN rules
  are its own.
- **The words**: the band is untranslated, as ADDED TO THE LIBRARY is, and
  the chips' words are `add-shelf.ts`' (`PUT ON A SHELF:`, `ON …`,
  `N OTHER SHELVES`), as on `/browse`.

Tests: `tests/series-add-shelf.e2e.ts` (the four devices),
`tests/tv-series-seasons.e2e.ts` (the TV's walk), `tests/series-db.spec.ts`
(the writes and UNDO's cascade, read from the database).

## The seasons around it

An anime linked to its own AniList entries shows, in its episode list, dim
**heads for the seasons around it**: every season before the ones it holds
above the list, **NEXT SEASON** below it, and the extras under one folded
line. They reuse the list's season-head row (`EpisodeList.svelte`, 44px,
`--surface-panel`'s row without its fill, in `--text-2`).

- **A season before**: `SEASON 2 · 12 EP`, its AniList title, and a cell:
  `IN LIBRARY →` when another series holds that entry by its own season link
  (never a title match; under the reveal filter), opening that series (its
  WORK row is its place in a Work); otherwise `FIND`. Numbered by position
  along the chain of TV, TV_SHORT and ONA entries (S1 is the chain's first),
  never from a title; drawn `SEASON` unnumbered when the walk back stopped at
  its 12-step limit, since the first season is not known.
- **NEXT SEASON**, never numbered (a `SEASON 4` would claim a fourth exists),
  always drawn: with what AniList says of the sequel as plain facts
  (`ANNOUNCED · 2027`, `AIRING`, `12 EP`) and its title when AniList knows
  one; `NEXT SEASON · FIND` when it knows none, searching for the series' own
  title with its season suffix taken off (`titleStem`: `3rd Season`,
  `Season 3`, `S3`, `Part 2`, `Cour 2`, `第3期`, a bracketed one; it holds on
  its own output).
- **The extras**: `+ 5 EXTRAS · 2 OVA · 1 MOVIE · …`, folded by default, one
  stop on a TV; unfolded, a row each, the same cells. A MOVIE, OVA or SPECIAL
  on the chain, an ONA or anything else off it reached by SIDE_STORY, and the
  other branch where a chain forks.
- **FIND** is the TAGS row's mechanism, `tagSearchHref` from `tag-search.ts`
  called as it is with no schema: `/browse/<source>?q=<title>&from=/series/<id>`,
  the series' own source (the TAGS row's `tagSource`), so ← on the source page
  comes back here. No source BROWSE can open, no FIND; the head still says
  what it is. A FIND never preloads on hover (the source page asks the
  source as it loads).
- **Never groups, merges or offers a Work**: it shows and finds; GROUP stays a
  deliberate tap.
- **Nothing for** an unlinked anime, a manga, a novel or a doujin (no chain
  to read: the rule asks the registry for the AniList ANIME catalogue,
  [`KINDS.md`](KINDS.md)), and nothing until the link pass has cached the
  series' relations, or while the cache can't answer for the links it has now.

**Which entries**: the walk goes back from the earliest linked season's entry
and forward from the latest's, and steps over the seasons the series holds
beyond them that no link names (a series holding seasons 3 and 4 with only 4
linked offers no SEASON 3). **Where the data comes from**: the relation cache
([`LINKS.md`](LINKS.md), "The relation cache"), filled by the link pass; the
screen never asks AniList and never waits. Code:
`src/lib/library/seasons-around.ts` (the walk and the heads, pure),
`src/lib/server/relations.ts` (the cache), `seasonsAroundOf` in the load.
Tests: `series-seasons-domain.spec.ts`, `series-seasons-db.spec.ts`,
`series-seasons-flow.e2e.ts` (the pass run by its script against a stand-in
AniList, then the screen) and `tv-series-seasons.e2e.ts` (the remote's stops).

## OTHER FORMS

The same work's manga, novel or anime, on a series linked to its AniList
entry: a quiet folded line under the list's season heads (the extras' idiom),
`+ 2 OTHER FORMS · MANGA · LIGHT NOVEL`, that unfolds to one row each
(`OtherForms.svelte`; on a comic's or a novel's list, under the chapters and
outside the rows the rail measures). It reads the relation cache and nothing
else ([`LINKS.md`](LINKS.md), "The relation cache"), so it asks AniList on no
page load, and it draws nothing where the cache has no such edge.

**What counts** (`formNodes`): an entry one hop from the series' entry or from
any season's, by `SOURCE`, `ADAPTATION` or `ALTERNATIVE`, whose format maps to
another kind than the series' (`candidateKind`, `sameKind`: the registry, so a
manga is not another form of a manhwa). An `ALTERNATIVE` anime of an anime is
the same kind and is not one; a format of no kind (`MUSIC`) is none.

**A row** carries the entry's facts as plain text (format, status, chapters,
volumes, episodes) and:

- **in the library**: `MANGA · IN LIBRARY →` opens it, in its Work's place
  when the two are one Work. "In the library" is another series' own AniList
  link (season links as well as `series_links`), of that form's kind, under the
  reveal filter: never a title, a novel holding the comic's entry for its cover
  is not the comic, and a hidden series is not offered outside reveal (FIND
  stands in its place, which says nothing about the library).
- **not in the library**: `FIND`, `/downloads/search?q=<title>&kind=<kind>`,
  so an anime's FIND for its manga asks only manga sources.

**Beside IN LIBRARY:**

| The two                           | The second cell                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| in no Work                        | `GROUP AS A WORK`: the GROUP flow (`GroupSheet`) with both series picked, this one first. ORDER, the name and UNDO are the flow's |
| one Work                          | `IN THIS WORK · PART n`, the other's part, and no cell                                                                            |
| one in a Work, or each in its own | nothing                                                                                                                           |

Nothing changes until the sheet is answered: the screen never groups and never
offers a Work unprompted. The sheet posts to the library's `?/work`, whose
answer SvelteKit applies only to the page that action belongs to, so the sheet
hands it to this screen (`ondone`) for the band and its UNDO. A refused UNDO
(the Work changed since) says why on the band and reads the page again, because
`update()` re-reads a page only on a success.

## Limits

- **A chapter with no file opens only where it can be read online.** On a
  series from an installed source, a tap reads it online while the device is
  online; an imported chapter with no source behind it, or any chapter with no
  file while offline, does not open. Everything else does:
  CONTINUE, `▶ CH. N`, a chapter row, a doujin page and a book's ▶ open the
  image reader ([`READER.md`](READER.md)), and a novel's the text reader
  ([`TEXT-READER.md`](TEXT-READER.md)).
- **The tablet in portrait does not fold behind DETAILS.** The CSS is one query
  away (add `(min-width: 600px) and (max-width: 1023px)` to the fold's media
  queries, and to their negation), but every flow spec runs at that size
  (`tablet-portrait`), and the fold would close DOWNLOAD, LISTS, FILE and the
  rest under all of them.
- **A download that failed is not a DETAILS mark.** The rows already say
  FAILED; a series with failed chapters folds quiet.
- **A film's screen fetches nothing more from TMDB than the link holds**: no
  TMDB genres (the genre is the source's), no credits (no `DIRECTED BY`, a call
  per film that nothing else needs), and a link made before migration 82 has
  no backdrop.
- **A film's QUEUED does not say its place in the queue** (`2 AHEAD OF IT`):
  the screen does not know it.
- **OTHER FORMS offers no `ADD TO <WORK>`.** This screen's `?/addToWork` takes
  only MIGHT CONTINUE's offer, for this series, so when one of the two is in a
  Work and the other is not, the row offers nothing.
