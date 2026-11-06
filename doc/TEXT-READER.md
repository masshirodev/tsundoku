# The text reader

Where novels are read: EPUBs, and later pasted web-novel chapters. It shares
`/read/<entry>` with the image reader ([`READER.md`](READER.md)): the route
looks at the series' kind and draws one or the other, so every ▶ in the app
opens an entry without knowing which it is.

It's built from `Index Text Reader.dc.html` and `Text Reader States.dc.html` in
[`design/handoff/`](design/handoff/), the handoff for the brief
[`briefs/done/TEXT-READER.md`](briefs/done/TEXT-READER.md). How books get into
the library is [`IMPORT-EPUB.md`](IMPORT-EPUB.md).

**The text is the interface.** Nothing is on screen but the page and a 2px
progress line along the bottom edge until a tap asks for the controls.

## Opening

A book **opens at once, a chapter first, and downloads whole behind it**
(`src/lib/reader/book.ts`, since 2026-09-24):

1. the reader asks for the book's list of files
   (`GET /api/series/<id>/epub/files?v=<version>`), then only what the chapter
   needs, one file at a time (`…/epub/file?v=…&p=<name>`: its documents and
   their images, unpacked on the workstation). The chapters either side come
   right behind, so a turn into them doesn't wait;
2. meanwhile the whole EPUB downloads in the background
   (`GET /api/series/<id>/epub?v=<version>`, `private`, `immutable`). When it
   arrives, every chapter reads from memory (`BookZip`,
   `src/lib/epub/remote.ts`) and moving between chapters happens in the page,
   with no load; the URL follows with `replaceState`;
3. the whole book is kept in the device cache (`cacheBook`,
   `src/lib/cache/device.ts`) with a marker for every entry. As everywhere
   else, a hidden series, reveal and incognito leave nothing (doc/OFFLINE.md);
4. a book already kept opens from the device, whole, as before: the OPENING
   screen with the file's size, and no network.

A file that isn't a zip answers `/files` with a 422, and the reader says
BROKEN EPUB. Offline, a chapter of a book not yet kept whole says THIS CHAPTER
IS NOT ON THE TABLET, with RETRY.

A 591-chapter web novel is 2–5 MB and an illustrated light novel is up to about
30 MB.

A novel grouped from several books ([`BOOKS.md`](BOOKS.md), "Volumes of a
novel") is one download **per volume**. The URL names the file
(`…/epub?v=<version>&f=<file>`); a series of one book leaves `f` out, so the
copy a device already keeps stays valid. The reader opens the volume the
chapter is in, and moving past a volume's last chapter shows OPENING while the
next one downloads, once. An entry's documents run up to the next entry **of
its own file**. Scroll doesn't preload across a volume's end: below the band
that ends a volume's last chapter is a screen of room where the next volume's
first chapter will be, and when its top passes the middle of the screen, as
any next chapter's start does, the next volume opens, OPENING over it while it
downloads (c347; before, the band said ↓ KEEP SCROLLING and nothing came).
Each volume is kept in the device cache with markers for its own entries.

## A chapter's text

An entry starts at its locator (`doc.xhtml#anchor`) and runs up to the next
entry's (`entryDocs`, `src/lib/epub/epub.ts`). Documents before the first entry
belong to it, so nothing in a book is unreachable. That's why the sample's
first chapter opens on its cover.

The markup never reaches the page as it is (`src/lib/reader/text-dom.ts`). It's
parsed with the browser's DOMParser, which runs no scripts, and rebuilt from an
allowlist:

- paragraphs, headings, lists, quotes, rules;
- illustrations, including a cover drawn as `<svg><image>`;
- code and tables, as boxed "wide" blocks;
- inline emphasis and ruby.

No attributes survive except an image's source (a `blob:` URL from the zip) and
a cell's span. No book CSS, fonts, links or scripts come through. The reader's
type settings apply to every book alike, and that costs the odd centred scene
break.

Each top-level block carries `data-b`, its index. That's what a position is
made of.

## Pages

- **Paged** (the default, including web novels) lays the chapter out in CSS
  columns the size of the page and turns by translating one page, sliding
  ("Turning", below). Landscape
  shows two columns 96px apart, like a spread; COLUMNS turns that off. In
  R→L ("Direction", below) the right-hand column is read first, as a
  right-to-left book's right-hand page is.
- **Vertical Japanese** uses columns too. A `vertical-rl` multi-column
  container fragments along its width and stacks the overflow downward, so
  each page is one column and a turn translates it up. Lines are never cut at
  the edge.
- **Scroll** is one column that runs past the screen. The next chapter is
  already below the band that ends this one. Once its start passes the middle
  of the screen, the reader moves to it, keeping everything where it was on
  screen.

### WIDTH

**WIDTH** (card c437; the owner, 2026-11-03: "novels should let you pick the
content area %, in case you want a A4 page on center or the content area with
text"; 2026-11-05: "so i can read on a pc") sets how much of the screen the
text takes: **50%, 65%, 80%, 100%** of the screen's width, or **PAGE**, a
page of A4's proportion (1 : √2) as tall as the text area. The text is
centred: the side margins take up what the column gives back. The rule is
`frame()` in `src/lib/reader/text.ts`; `tests/reader-domain.spec.ts` pins every
step on five screens and `tests/text-reader-width.e2e.ts` measures the drawn
column on the four device projects.

- **100% is the column every device drew before WIDTH** (the screen less
  MARGINS on each side), so it is the default and nobody's page moved on
  upgrade. Measured at the default size: 364 px on a phone (412 wide), 656 on
  a portrait tablet (800), two columns of 520 on a landscape tablet (1280),
  two of 600 on a 1440 desktop and two of 840 on a 1920 PC. That last is a
  line of about 90 characters at the PC's 19 px, well past the length prose
  reads best at, and one column (COLUMNS OFF) is 1776 px.
- **Never narrower than 20 ems of the body text** (`MIN_MEASURE_EM`), about
  forty characters, the shortest line that still reads as prose; never wider
  than 100%. A step that would go below the floor stops there. So **on a
  phone the steps change almost nothing** (50% of 412 px is 206 px, a dozen
  words a line: the floor holds it at 360, against 100%'s 364), and PAGE is
  100% there and on a portrait tablet, whose text area is already narrower
  than an A4 page as tall. The steps are for a tablet in landscape and a PC.
- **Landscape's two columns: the share is of the spread.** 65% of the screen
  holds both columns and the 96 px between them, so each column is a little
  under a third of the screen; PAGE is **two A4 pages side by side**, each as
  tall as the text area, like an open book (1442 px on a 1920 × 1080 PC,
  1188 on a 1440 × 900 desktop). The floor is per column, so on a 1280 px
  tablet in landscape 50% and 65% both stop at two columns of 20 ems (856 px
  in all, at its 19 px).
  COLUMNS OFF makes it one column of the share.
- **SCROLL is one column whatever COLUMNS says**, so its share is of that one:
  the flow's side padding is the margin, and a line is never longer than the
  paged single column would be.
- **R→L** (c440) mirrors the columns inside the same centred box.
- **Vertical Japanese** runs its lines down the page, so a line's length is the
  text area's height, which WIDTH leaves alone. There WIDTH is how wide the
  page of lines is: fewer lines a page at 50%, the same lines. PAGE is a
  portrait page of A4's proportion, as tall as the text area.
- **A change of width lays the chapter out again and keeps the place**, as a
  change of size does ("Position", below): the page holding the character
  being read in PAGED, the line where it stood in SCROLL.
- **Kept per series, with the device's last choice as the default.** The
  series' own is `tsundoku.text.width.<series id>` and the device's is
  `tsundoku.text.width`, both in this browser's `localStorage`; a choice
  writes both, so a series never set opens at the width last chosen on this
  device, and a series once set keeps its own. Unlike
  `tsundoku.text.settings` these keys are not in the settings catalogue, so
  SETTINGS' DEVICES list does not show or mirror them (a catalogue entry is
  a _Suggestion_ in `doc/handoff-notes/reader.md`, wave 25).

The chapter ends where it ends: the rest of its last page is the band that
names the next chapter ("END · CH. 212 / 212 OF 591 / NEXT … / ABOUT 12 MIN /
TAP OR SWIPE TO CONTINUE →"). It only gets a page of its own when the last page
is full.

## Position

A position is **the entry, the paragraph (block) and the character offset** of
the first character on screen, found with `caretPositionFromPoint`. After a
change of size, font, margins, WIDTH, layout or orientation, the chapter is laid out
again and opens on the page holding that character. Page numbers, percentages
and time left are worked out from the position and never stored.

In SCROLL the position is read a quarter of a second after the reader stops
scrolling, so a relayout that lands while they are still moving (a face
arriving, which `loadingdone` reports since c441, or an illustration loading)
leaves the scroll where the reader put it rather than taking them back to the
character they scrolled away from. Only the reader's own scrolls count: the
scrolls the reader makes itself (opening a chapter, keeping the character,
crossing into the next chapter) are remembered as its own, so a face arriving
just after a chapter opens on a saved place still keeps that place.

**What SCROLL saves is the first line of text on screen** (c516): the line
crossing the top margin, or the next one with text. Before c516 it was the
first thing found there, and on an illustration that is the figure itself,
whose start can be a screen higher (`?at=5.0` with the figure's top 177 px
above the screen, measured in wave 22): a reload went back up to the
illustration's top. A screen with no text on it keeps the figure. And **a
relayout leaves that line where it stood**: the reader notes how far below
the top the character was when it read the place, and puts it back there.
It used to put it on the top margin, and as the line crossing the margin
starts up to a line above it, every relayout after a scroll moved the reader
up to a line. **A reload keeps that height too** (c554): in SCROLL the URL is
`?at=<block>.<offset>.<y>`, `y` being how far below the top of the screen, in
CSS px, the character's line stood, and a reload puts the line back there
(`parseAt` / `formatAt` in `src/lib/reader/text.ts`). Before c554 the URL had
the character alone, and a reload landed up to a line off. `y` is a height on
the screen, so it means the same at any WIDTH or size: after a WIDTH change
the relayout keeps the line at its height and the URL keeps the same `y`, and
a reload at the new width lands there again. It is held on screen (no higher
than a line above the top, no lower than a line above the bottom), and PAGED
ignores it, keeping the page that holds the character. A two-part
`?at=<block>.<offset>` (a bookmark, a history entry, any link made before
c554) still opens on the top margin, as does a place from the server, which
has only its character.

**A page that is the band alone** (a chapter whose text ends exactly at a
page's end) has no character of its own to keep, so its position is the
chapter's last character, on the page before. The reader also remembers that
it is on the band's page (c516), whether it got there by turning or by coming
back from the next chapter, and a relayout keeps it there; until c516 it went
a page back.

It travels through `POST /api/reading` as before: `page` is the paragraph, and
two new optional fields carry `offset` (the character) and `total` (paragraphs
in the entry). The server stores them in `last_position`, `last_offset` (rung 11) and `page_count`, so the series screen's percentages work without the
server ever reading the book. The URL keeps `?at=<block>.<offset>`, so a
reload, or incognito, which saves nothing, still comes back to the same
sentence (and in SCROLL, the same line: `?at=<block>.<offset>.<y>`, above).

**Where a door opens a chapter** (c622). A URL with `?at=` opens at that
place: the reader's own writes, and any link that names one. A URL without
one — what every door into a novel makes, because `readHref()`
(`src/lib/library/links.ts`) writes none — resumes from the server's saved
place for that chapter, unless the chapter is already read (`readAt` set),
which opens at its top. So:

| Door                                                                                                                                                    | Opens at                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| ▶ CONTINUE, on the series screen and on the library                                                                                                     | the entry it chooses (`resumeEntry`, the one in progress), at its saved place; its top when that chapter is read |
| a history entry                                                                                                                                         | its chapter, at its saved place; the top when read                                                               |
| a chapter row, or the end page's next part (`readHref(first.id, 1)`; the `?p=1` is the image reader's, and the text reader does not read it as a place) | that chapter, at its saved place; the top when read                                                              |
| CONTENTS inside the reader, a turn past a chapter's end, SCROLL crossing into the next                                                                  | the chapter's top                                                                                                |
| the in-place move's own URL (`replaceState`, `?at=<block>.<offset>[.<y>]`)                                                                              | exactly that place, on a reload or a history entry                                                               |
| a reload before the reader has settled                                                                                                                  | the server's saved place (the last `page` event), or the top                                                     |

An explicit `?at=0.0` is a place like any other: the top, whatever the server
saved. A saved place past the chapter's last block — its text changed under
it — opens at the top, and settles there rather than carrying a block number
nothing answers. Until c622 an absent `?at=` read as the first character
(`Number('')` was 0), so every one of those doors opened a novel at its
chapter's top. The image reader shares `+page.server.ts`'s `lastPosition` but
not this rule: it already resumed from the saved page with no `?p=`
(`+page.server.ts`'s `start`), so c622 is the text reader's alone.

The URL is the reader's only writer, but not its only reader: the
first-chapter effect reads it, and `keepHistoryUrl()` writes the same URL into
the history entry so a popstate back into it opens what it was left on
(`doc/NAVIGATION.md`, "A screen being left writes nothing", c623). The
server's place has only its character, not SCROLL's height, so a place from
the server opens on the top margin.

Each event's `durationMs` is capped at **five minutes** a page, not the image
reader's two: a page of prose at the default size is 352–391 words, which a
slow, careful reader takes up to five minutes over (card c443;
[`READING-LOG.md`](READING-LOG.md), "The caps").

## Turning

Paged turns slide and follow the finger, as a manga's do ([`READER.md`](READER.md),
"Turning pages"; the owner asked on 2026-11-03, c441), on the same numbers
(`TURN_MS`, `TURN_EASE`, `DRAG_PX`, `EDGE_GIVE` and `swipeAction` in
`src/lib/reader/reader.ts`; [`MOTION.md`](MOTION.md), "Page turns"):

- **The page follows a sideways drag.** Let go past the swipe threshold
  (40px, mostly sideways) and it slides the rest of the way; short of it, it
  goes back. Where no page lies that way in this chapter (its last page going
  on, its first going back) the drag gives a quarter as much.
- **Taps, arrows, Space and the wheel slide too**, in 220ms, and so does a
  TV's key turn. A turn asked for mid-slide is taken when it lands, so quick
  taps all count.
- **Anything else that moves the reader mid-slide wins** (c515): the scrubber,
  CONTENTS, a chapter opening. The slide stops where the newer ask put the
  page, and the turn gives way to it; until c515 it chose its page when the
  slide ended, one past wherever the scrub had left it (a remote's →, OK onto
  the scrubber, ← within 220 ms did it). The reader counts its own
  moves (each page it goes to, each chapter it opens), and the turn lands only
  if the count is still the one it started with: comparing the character
  being read missed a scrub onto the band's page alone, which has no
  character, so the turn went one back from it. A relayout mid-slide is not a
  move: it keeps the character being read, so the turn still lands on the page
  after it.
- **One finger drags** (c515). The press follows the pointer that began it; a
  second finger going down (a pinch beginning) ends it as a cancel would, so
  the page goes back instead of jerking towards the new finger, and neither
  finger moves it until both lift (`src/lib/reader/pointer.ts`, shared with
  the image reader).
- **Across a chapter's end** the next chapter's first page slides in from
  where the next page lies, and back across it the previous chapter's last
  page slides in from the other side. Into another volume it slides in once
  OPENING is done. The end page arrives, and leaves, at once, as it always has.
- **Vertical Japanese slides on its own axis**: its pages lie one below the
  next, so its turn translates up, while the finger pulls the next page in by
  dragging right, as in every right-to-left book.
- **Reduced motion** turns at once and the page doesn't follow the finger.
  Scroll layout is untouched.

The chapter is one CSS-columns flow, so the page either side is already laid
out beside this one: a turn is a transition on the flow's transform, which is
on a layer of its own, and the columns are never laid out again for it. The
axis and its sign are one pair in `TextReader.svelte` (`pageAxis`,
`pageSign`): a horizontal book read R→L (c440, "Direction" below) is the x
axis with the sign -1, its columns run right to left, and its turns slide the
other way on the same code. Tested in `tests/text-reader-turn.e2e.ts`
on every device, and vertical Japanese in `tests/text-reader-flow.e2e.ts`.

## Touch

The image reader's rules, and its code (`tapAction`, `swipeAction`), with
wider strips:

- the 30% edge strips turn (`TEXT_EDGE`; the image reader's are 16%), so
  only the middle 40% shows the controls. The owner found 16% too small to hit
  on 2026-10-22;
- a swipe turns anywhere;
- in vertical Japanese, and in a horizontal book read R→L ("Direction"),
  the left strip turns forward and a swipe to the right reads on;
- in scroll a tap never turns.

Everywhere else a tap shows the controls, the text included. In a Japanese
book a **long press** on a word looks it up in the shared lookup panel; taps
are unchanged ([`JAPANESE.md`](JAPANESE.md), "In a book").

A tap on an illustration opens it full screen: black ground, pinch to zoom, one
finger pans, the zoom level shows for a moment, and a tap closes it. A tap on
OPEN opens a wide block on its own, to pan across.

## Mouse

On a PC, in paged layout, **the wheel turns the page**: down reads on, up goes
back, and a sideways scroll is spatial like the arrows (in vertical Japanese,
and in R→L, a scroll to the left reads on). One gesture turns one page: the deltas add up to
40px before it turns, and the rest of the gesture, a touchpad's inertia
included, is spent until the wheel has been quiet for 200ms (`WheelTurn`,
`wheelForward` in `src/lib/reader/reader.ts`, covered by
`tests/reader-domain.spec.ts`). Ctrl+wheel stays the browser's zoom, the wheel
does nothing while a sheet, CONTENTS, the lookup or a full-screen image is open,
and scroll layout scrolls as before. The owner asked for this on 2026-10-22.

Arrows, Space, PageUp and PageDown turn too; OK (Enter), Esc or the mouse at
the top or bottom of the window shows the controls. On a TV, OK shows the
controls and BACK closes CONTENTS or an image, then the controls, then leaves
([`TV.md`](TV.md), [`READER.md`](READER.md)). With the controls up, a TV's pad
walks them (c241): focus starts on the page scrubber, ↓ reaches CONTENTS and
READING, and READING is a 420px panel where LAYOUT and the rest change by keys
alone — ← → along a row, ↑ ↓ between rows, OK takes the value. BACK closes it
and the pad goes back to the scrubber in the chrome's place (the footer gives
way to the sheet, so the cell that opened it is gone). OK on CONTENTS opens a
focus scope that starts on the row being read (c250), the arrows stay in it,
and BACK gives the pad to CONTENTS again. At the end of what is downloaded
(END · LAST AVAILABLE, a volume that isn't the last) the pad reaches the
rating, FAV, ← SERIES and LIBRARY, marked inside (c251); the last volume's end
is the end page, which takes the pad the same way. Off a TV the arrows stay
the reader's whatever the controls.

## Direction

The owner, 2026-11-03 (c440): "option to L->R, R->L on novels". READING's
DIRECTION row, under LAYOUT, says which way a horizontal book's pages turn in
PAGED: **L→R** (the default) reads on to the right, **R→L** reads on to the
left. It decides which way the pages turn, never how the text runs.

- **Everything that turns follows it**: the 30 % edge strips (the left one
  reads on in R→L), a swipe (to the right reads on), ← and → (spatial, as in
  the image reader), a sideways wheel, and the slide, whose next page lies to
  the left and comes in from there (the flow's columns run right to left,
  `.flow.rtl`; the text inside keeps its own direction).
- **The controls mirror** as they do for vertical Japanese, by the same path:
  the scrubber fills from the right with page 1 at its right end, and the
  next chapter is the left-hand cell. The end band says ← TAP OR SWIPE TO
  CONTINUE, and READING's cell says `PAGED R→L · SERIF 20 · DARK`.
- **Landscape's two columns** read right column first, as a right-to-left
  book's spread does (decided alone, wave 22: the other order would have the
  eye cross the page against the way the pages turn).
- **SCROLL never turns**, so the row is dimmed there with PAGED ONLY, as the
  image sheet's PAGED ONLY rows are, and nothing mirrors.
- **Vertical Japanese keeps its own direction**: the row shows R→L, dimmed,
  with VERTICAL TEXT READS R→L.
- **Kept like the image reader's MODE**: this session's when picked, the
  series' once REMEMBER R→L (or L→R) is pressed, on every device. SERIES
  DEFAULT says what the series reads as. It is stored in
  `series.text_direction` (rung 69), its own column because `series.direction`
  already holds a novel's LAYOUT; NULL is L→R, so REMEMBER L→R stores NULL.
  REMEMBER posts to the reader's own action
  (`/read/<entry>?/textDirection`), which only a book of text takes
  (`kindFacts(kind).medium`) and which, like the page, answers 404 for a
  hidden series with reveal off. There is no SETTINGS default for it, by the
  owner's choice (c552, 2026-11-05): L→R is the default everywhere. A novel
  kept R→L is counted under SETTINGS' LAYOUT, N SERIES DIFFER →, whose ✕
  puts it back on L→R ([`SETTINGS.md`](SETTINGS.md), "02 — Reading ·
  novels").
- **On a TV** the row is a stop in READING's panel: ↓ from LAYOUT lands on it,
  ← → move along it, OK takes a value; with the panel and the controls gone,
  the remote's ← reads on in R→L.

Tested in `tests/text-reader-turn.e2e.ts` (every device: ←, →, a drag, the
edge strips by finger, the mirrored scrubber, the slide's sign, and the
landscape columns' order), `tests/text-reader-flow.e2e.ts` (REMEMBER, a
reload, SCROLL untouched, vertical Japanese's row),
`tests/tv-text-reader.e2e.ts` (the pad), `tests/reader-domain.spec.ts`
(`textMode` over all twelve cases), `tests/text-direction-db.spec.ts` and
`tests/migrations-db.spec.ts` (rung 69).

## Controls

- **Top (64px):** ←, the series, and a meta line ("WEB NOVEL · CH. 812 OF
  1,429 · 57% OF BOOK"; "NOVEL" below 100 chapters; matter is named, not
  numbered), the rating bars and FAV.
- **Bottom:** the chapter with "P. 5 OF 13 · 7 MIN LEFT", a scrubber across the
  chapter's pages, then `← CH. 211`, CONTENTS, READING and `CH. 213 →`. In
  vertical, and in R→L, the cells and the scrubber mirror (one path,
  `TextChrome`'s `rtl`).
- **READING** is the image reader's sheet with rows for text: LAYOUT (the
  series', with REMEMBER), DIRECTION (the series', with REMEMBER; c440),
  COLUMNS, THEME, FONT, SIZE, LINE, MARGINS, WIDTH (c437, "Pages" above),
  JUSTIFY, FURIGANA, DIM and the rating. It has no scrim, so changes show as
  they're made. Everything below DIRECTION belongs to the device
  (`localStorage`, `tsundoku.text.settings`, stamped through
  `settings/local.ts` and mirrored on the workstation,
  [`SETTINGS.md`](SETTINGS.md), "Devices"), except WIDTH, which is the
  series' with the device's last choice as its default and is not mirrored,
  and DIM is shared with the image reader. A novel's default LAYOUT is SETTINGS'. The
  sheet ends with ALL SETTINGS →.
- **FONT** (c442) offers three, in this order: **Plex Serif** (the default),
  **Plex Sans** and **OpenDyslexic**. The list is `TEXT_FONTS` in
  `src/lib/reader/text.ts`, and SETTINGS' TYPEFACE row allows exactly those
  values (`tests/settings-domain.spec.ts` holds the two together). Each name
  in the row is drawn in its own font; when they don't fit on one line (a
  phone, a TV's panel) they wrap into blocky cells rather than shrink.
  - **Self-hosted and precached; declared once chosen or READING is open.**
    Plex is the app's own type, imported eagerly by `index.css`. OpenDyslexic
    is declared by `src/lib/styles/fonts-reading.css`, which
    `loadReadingFonts()` imports once the font is chosen or READING is open
    (the FONT row draws its name in the face, so opening READING fetches that
    face's woff2). The files themselves are in the build, so the service
    worker precaches all three woff2 on every installed device whatever FONT
    says (doc/OFFLINE.md, the shell cache); that is what lets OpenDyslexic
    work offline once chosen, and after install the page's fetch is answered
    from that cache. The stylesheet's `@font-face` rules are hand-written and
    name woff2 only: @fontsource's own CSS also names a woff per face, which
    put 389,208 bytes of woff in the build that no woff2 browser uses. What
    the build carries (round 2, `ls -l build/client/_app/immutable/assets`):
    `opendyslexic-latin-400-normal` 115,280 bytes, `-400-italic` 112,360 and
    `-700-normal` 120,356, 347,996 in all, plus a 478-byte stylesheet; the
    service worker's list names exactly those three woff2 and
    `fonts-reading.*.css`. Never a CDN.
  - **A face without a glyph falls back cleanly.** OpenDyslexic is Latin only,
    so its stack goes on to Plex Sans JP and KR, and a mixed novel shows no
    boxes. Vertical Japanese is set in Plex Sans JP whatever FONT says.
  - **A saved FONT this build doesn't know** (a newer build's, or one edited
    by hand) reads as Plex Serif, never as an empty `font-family`
    (`textSettings`); one saved before c442 reads as it was.
  - Changing it lays the chapter out again, keeping the character, as SIZE
    does; the face arriving later lays it out once more (`loadingdone`).
  - READING's cell names it SERIF, SANS or DYSLEXIC ("PAGED · DYSLEXIC 20 ·
    DARK").
- **CONTENTS** is the series screen's own list (`EntryList`, in its sheet
  mode). It's headed CONTENTS with a ✕, has `#` and the rail only from 60
  entries, and opens on the chapter being read. A book's front and back matter
  are listed under their own labels in 44px rows and never count as chapters.

**Time left** comes from this device's reading speed (characters per minute,
`tsundoku.text.speed`, with a page held over two minutes counted as a pause).
It's left out until ten minutes of reading are behind it.

## Themes

The controls are always dark, as in the image reader. The page follows THEME:

- **DARK:** true black, body text in `--text-prose` (`#b4b6b8`), headings in
  full ink, illustrations at 85% so they don't glare.
- **PAPER:** the library's light palette (2d Paper / ink), with full-ink body
  text.

There's no sepia: DIM over DARK does what sepia is usually asked for at night.

## Failure

DID NOT OPEN names what happened:

- **LOCKED · ADOBE DRM** (`rights.xml`, or `encryption.xml` encrypting more
  than fonts);
- **BROKEN EPUB · …** (not a zip, `CONTAINER.XML NOT FOUND`, an empty spine);
- the file gone from the workstation;
- offline before the book was kept, with RETRY;
- a chapter of a novel downloaded so far that isn't downloaded yet ("CH. 3 IS
  NOT DOWNLOADED", [`NOVELS.md`](NOVELS.md), "Reading it").

A chapter with no file reads online when the novel's plugin is installed
([`BROWSING.md`](BROWSING.md), "Novels online"); without one, a novel
downloaded so far stops at its first chapter with no file: no NEXT
on the last page, and END · LAST AVAILABLE past it, "2 OF 3" and which
chapter isn't downloaded. The contents list doesn't jump to one.

There's always ← SERIES and LIBRARY.

## Where it departs from the handoff

- **No kicker above chapter headings.** The mock draws "CHAPTER 212" over "The
  Commission". Real books put their own heading in the text, and a kicker built
  from the table of contents would repeat it ("Chapter 1: The Article" over
  "Chapter 1: The Article"). The book's heading is styled as the mock's title.
- **Paragraph style follows the size of the book, not its markup.** Series with
  100 or more chapters (web-novel compilations) get spaced paragraphs, and the
  rest are indented. The book's CSS isn't read, so this is a heuristic.
- **"END · CH. n / n OF m" counts chapters,** not table-of-contents entries.
  Matter is named ("END · COVER").
- **The FAV cell turns accent when on.** The mock only draws it off.
- **On a phone the top bar drops the rating bars,** which don't fit beside the
  title at 360px.
- **Scroll's scrubber runs 1–100** (percent of the chapter), because a
  scrolled chapter has no pages.
- **The offline band** shows on a chapter's last page while offline. A book is
  kept whole, so a next chapter that isn't cached only happens when the book
  never finished downloading. That's the offline DID NOT OPEN, not a band.
- **The lookup (1h, jpLookup) and the phase 2 tap zones (1i, zones2) aren't
  built.** They're sketches for the Japanese layer.
- **FURIGANA's UNKNOWN is disabled.** It needs the known-words list from the
  Japanese layer. ALL and NONE work.

## What it doesn't do yet

- **Furigana generation.** Books that carry `<ruby>` show it; books that don't
  get none. shiori's rules for generating readings wait on the shared tokenizer
  (card "Japanese layer").
- **A mincho for Japanese.** Vertical text is set in Plex Sans JP, since Plex
  has no Japanese serif. Whether FONT should offer a mincho is still open.
- **More reading fonts.** Atkinson Hyperlegible and a book serif such as
  Literata were suggested beside OpenDyslexic (c442) and wait on the owner. A
  new one is a row in `TEXT_FONTS`, hand-written woff2-only `@font-face` rules
  in `fonts-reading.css` (not an `@import` of @fontsource's CSS, which would
  put woff back in every device's precache), and the TYPEFACE row's option.
- **Scroll doesn't carry back into the previous chapter.** Scrolling up past
  the top stops there, and `← CH.` goes back.
- **The budget ignores books' weight after the first marker,** and letting go
  of an entry's marker doesn't delete the EPUB from the device cache.
- **Pasted web-novel chapters** (ARCHITECTURE.md, "Web novels").
