# The text reader

Where novels are read: EPUBs. It shares
`/read/<entry>` with the image reader ([`READER.md`](READER.md)): the route
looks at the series' kind and draws one or the other, so every ▶ in the app
opens an entry without knowing which it is.

How books get into the library is [`IMPORT-EPUB.md`](IMPORT-EPUB.md).

**The text is the interface.** Nothing is on screen but the page and a 2px
progress line along the bottom edge until a tap asks for the controls.

## Opening

A book **opens at once, a chapter first, and downloads whole behind it**
(`src/lib/reader/book.ts`):

1. the reader asks for the book's list of files
   (`GET /api/series/<id>/epub/files?v=<version>`), then only what the chapter
   needs, one file at a time (`…/epub/file?v=…&p=<name>`: its documents and
   their images, unpacked on the server). The chapters either side come
   right behind, so a turn into them doesn't wait;
2. meanwhile the whole EPUB downloads in the background
   (`GET /api/series/<id>/epub?v=<version>`, `private`, `immutable`). When it
   arrives, every chapter reads from memory (`BookZip`,
   `src/lib/epub/remote.ts`) and moving between chapters happens in the page,
   with no load; the URL follows with `replaceState`;
3. the whole book is kept in the device cache (`cacheBook`,
   `src/lib/cache/device.ts`) with a marker for every entry. As everywhere
   else, a hidden series, reveal and incognito leave nothing (doc/OFFLINE.md);
4. a book already kept opens from the device, whole: the OPENING
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
downloads.
Each volume is kept in the device cache with markers for its own entries.

## A chapter's text

An entry starts at its locator (`doc.xhtml#anchor`) and runs up to the next
entry's (`entryDocs`, `src/lib/epub/epub.ts`). Documents before the first entry
belong to it, so nothing in a book is unreachable. That's why the sample's
first chapter opens on its cover, under the band that starts every chapter
("A chapter's start", below; in vertical Japanese the cover is a page wide,
so it is the page after the band's).

The markup never reaches the page as it is (`src/lib/reader/text-dom.ts`). It's
parsed with the browser's DOMParser, which runs no scripts, and rebuilt from an
allowlist:

- paragraphs, headings, lists, quotes, rules;
- illustrations, including a cover drawn as `<svg><image>`;
- code and tables, as boxed "wide" blocks;
- inline emphasis and ruby.

No attributes survive except an image's source (a `blob:` URL from the zip) and
a cell's span. The reader adds one of its own: every image is
`draggable=false`, so a mouse drag on an illustration turns the page as a drag
on text does, where the browser's own image drag would cancel the press. No
book CSS, fonts, links or scripts come through. The reader's
type settings apply to every book alike, and that costs the odd centred scene
break. Paragraph style follows the size of the book, not its markup: series
with 100 or more chapters (web-novel compilations) get spaced paragraphs, and
the rest are indented. The book's CSS isn't read, so this is a heuristic.
There is no kicker above a chapter's heading: real books put their own heading
in the text, and one built from the table of contents would repeat it
("Chapter 1: The Article" over "Chapter 1: The Article"), so the book's
heading is the title, and the start band carries the rest ("A chapter's
start").

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
  of the screen, the reader moves to it, and **nothing on screen moves**: the line being read stays at the height it was. A screen of the old
  chapter's end and its END band are kept above the new chapter's start band
  as copies (`.kept`, the whole chapter when it is shorter than the screen),
  so there is room above for the jump the crossing would otherwise clamp to
  the top. A next volume keeps nothing: it is crossed as an empty room
  under OPENING, nothing on screen runs on into it, and it opens at its own
  top. The kept part is not the chapter: it carries no `data-b` and is
  `inert`, so it isn't a position, a lookup or a press; the progress, `?at=`
  and CONTENTS count from the new chapter's own top; the next crossing
  replaces it, it doesn't grow; and every other way into a chapter empties
  it, as does a reload (it doesn't carry back, so scrolling up reads it and
  stops at its top: "Limits").

### WIDTH

**WIDTH** sets how much of the screen the
text takes: **50%, 65%, 80%, 100%** of the screen's width, or **PAGE**, a
page of A4's proportion (1 : √2) as tall as the text area. The text is
centred: the side margins take up what the column gives back. The rule is
`frame()` in `src/lib/reader/text.ts`; `tests/reader-domain.spec.ts` pins every
step on five screens and `tests/text-reader-width.e2e.ts` measures the drawn
column on the four device projects.

- **100% is the full column** (the screen less MARGINS on each side), and the
  default. Measured at the default size: 364 px on a phone (412 wide), 656 on
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
- **R→L** mirrors the columns inside the same centred box.
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
  SETTINGS' DEVICES list does not show or mirror them.

The chapter ends where it ends: the rest of its last page is the band that
names the next chapter ("END · CH. 212 / 212 OF 591 / NEXT … / ABOUT 12 MIN /
TAP OR SWIPE TO CONTINUE →"). It only gets a page of its own when the last page
is full.

### A chapter's start

END's twin opens every chapter, above its first block, in END's type, rule and
colours (`.cstart` in `TextReader.svelte`):

- **Always** `CH. 212` and `212 OF 591`, END's row and END's count: chapters,
  not table-of-contents entries, with matter named (`COVER`) and counted among
  the entries, as END · COVER is. Under it, `ABOUT 12 MIN` once ten minutes of
  reading are behind the speed, by END's own estimate of the chapter (its
  size), so the END band's NEXT and the start band below it in SCROLL never
  say two different minutes.
- **The table-of-contents title, only where the book doesn't print it.** It is
  compared with the chapter's first heading, or, with none before the text
  starts, its first short line (100 characters or fewer), or, with neither, a
  short blockquote. A short blockquote before the heading or among the short
  lines is read beside them. All of them after folding case,
  punctuation, symbols, whitespace and a leading `Chapter 212:`, `Ch. 212 -`,
  `Chap. 12.`, `Chapter IV:`, `Chapter One:`, `1. ` or `第212話` / `第十二章`
  prefix away. A chapter number in figures, words or kanji is the same number
  (`第一章` and `第1章`; `Chapter One` and `Chapter 1`), and words count only
  after `Chapter`, `Chap.` or `Ch.`, so `One Piece` is a title. A line that is
  only a kanji numeral is that number too (`一`, `第一章` and `1`). The two are
  also compared with the `1. ` left in and a spelled number left as words,
  which keeps `1. The Article` and `1 The Article` the same, and
  `Chapter One: The Article` and `Chapter OneThe Article`, a heading split by
  a `<br>`, which adds no text. Equal: no title in the band. Different, or no
  heading at all (common in a web-novel chapter from a source): the title, in
  the band. A title that is only its number compares as the number
  (`Chapter 212` and `第212話` are the same).
  **A lead that is only a number reads the lines beside it**: the short
  paragraph right before it (a title line standing over the number), and
  the next one. Many publishers' books print the number and the title in two
  blocks (`<h1>Chapter 1</h1>` then `<h2>The Article</h2>`, two short
  paragraphs, `<h2>第一章</h2>` then `<h1>旅立ち</h1>`), so when the first line
  folds to its number alone, the next block with text, if it is a heading, a
  short line or a short blockquote inside the six blocks, is compared too,
  alone and joined to the number. Equal to either: no title. A bare
  `Chapter 1` with the text right after it still gets the title, since the book never prints it. Matter never gets one: the band's
  `COVER` already names it. The rule is `src/lib/reader/start-band.ts`
  (`leadLines`, `bandTitle`), pure, and `tests/text-start-band.spec.ts` holds
  every prefix, a heading that differs, no heading, a first short line, a
  number and a title in two blocks (headings, paragraphs, Japanese), five
  more shapes (a line before the number, words, a blockquote, a leading `1. `,
  kanji), the edges of 100 characters and six blocks, and the fold on its own
  output.
- **It is not a block.** It sits in the flow before `<div class="blocks">`,
  so `data-b` numbering is what it always was and every saved place opens on
  the same words ("Position", below).
- **PAGED**: it opens the chapter's first page, on the same page as the text.
  It is a page of its own only when the chapter's first block is a
  full-page illustration, which leaves no room beside it. That page has no
  character, so it stands for the chapter's first, and a relayout keeps the
  reader on it ("Position").
- **SCROLL**: above the first line. A chapter opened at its start opens at the
  top, with the band showing, and the first line is kept at the height it
  stands at under the band, so a face arriving doesn't scroll the band away.
  Below this chapter: END, then the next chapter's start band (once its text
  is ready), then its text. The crossing into the next chapter is its
  first block passing the middle of the screen, and its first
  line stays where it stood, under its band ("Pages", above, for what is kept
  above it); a relayout right after keeps its first line where the crossing
  put it. A next volume's room has no band
  before it: that chapter isn't read until it opens, and its band is then at
  its top. **Where you are counts from the band down**: the scroll's
  fraction (the progress bar, the scrubber's 1–100, and the finish at 0.999)
  runs from the top to the chapter's last line at the screen's foot, the
  blocks' bottom (`offsetTop + offsetHeight`, from `.page`), not their height
  alone. Measured on the tablet portrait (a `text-reader-flow` case): the
  band 86 px, the blocks starting 214 px down (the flow's padding and the
  band), so the height alone would read 1 and finish the chapter 214 px
  before its last line reached the foot, with the scrubber's right end there
  too.
- **Vertical Japanese**: the same band, vertical, its rule on the left
  between it and the first column (logical sides, `border-block-end`).
- **Both themes and DIM** by the page's own colours (`--ink`, `--mut`); on a
  TV it is no stop of the pad's, since it is not a control.
- **END follows the page's colours in both layouts**, as this band does.
  PAGED's END (`.band`) and SCROLL's (`.sband`) draw their rules and title in
  `--ink`, their row, NEXT and minutes in `--mut`, and CONTINUE in the accent,
  with no ground of their own: they sit on the page's. SCROLL's inner rule,
  between the row and NEXT, is the page's own line (`--pl1`), which in DARK is
  the same graphite as before. So PAPER's END is ink on paper, not a dark
  block, and DARK's END band sits on the page's true black, where it once
  painted the app's own `--surface-page` (`--graphite-950`) block across the
  page. The copy of SCROLL's END kept above the next chapter after a crossing
  ("Pages") is the same element, so it paints the same.

Tested in `tests/text-reader-flow.e2e.ts` ("the band at a chapter's start":
a book whose chapters have the title as heading, no heading, another
heading, a `Chapter 4:` prefix, a full-page illustration first, and
`Chapter 6` over a second heading that is the title, in PAGED
and SCROLL, with a saved place reopened on its words; and the rule's
side in a vertical book, computed and drawn, and END's colours in DARK, PAPER
and under DIM). SCROLL's END is tested too, by computed value in DARK and
PAPER: its rules, row, title and minutes against the start band's, its inner
rule against the page's line, the ground it sits on against the page's, and
the copy kept above the next chapter after a crossing).

## Position

A position is **the entry, the paragraph (block) and the character offset** of
the first character on screen, found with `caretPositionFromPoint`. After a
change of size, font, margins, WIDTH, layout or orientation, the chapter is laid out
again and opens on the page holding that character. Page numbers, percentages
and time left are worked out from the position and never stored.

In SCROLL the position is read a quarter of a second after the reader stops
scrolling, so a relayout that lands while they are still moving (a face
arriving, which `loadingdone` reports, or an illustration loading)
leaves the scroll where the reader put it rather than taking them back to the
character they scrolled away from. Only the reader's own scrolls count: the
scrolls the reader makes itself (opening a chapter, keeping the character,
crossing into the next chapter) are remembered as its own, so a face arriving
just after a chapter opens on a saved place still keeps that place.

**What SCROLL saves is the first line of text on screen**: the line
crossing the top margin, or the next one with text. The first thing found
there would be, on an illustration, the figure itself, whose start can be a
screen higher (`?at=5.0` with the figure's top 177 px above the screen), and a
reload would go back up to the illustration's top. A screen with no text on it
keeps the figure. And **a relayout leaves that line where it stood**: the
reader notes how far below the top the character was when it read the place,
and puts it back there. Put on the top margin instead, it would move the
reader up to a line at every relayout after a scroll, as the line crossing
the margin starts up to a line above it. **A reload keeps that height too**:
in SCROLL the URL is `?at=<block>.<offset>.<y>`, `y` being how far below the
top of the screen, in CSS px, the character's line stood, and a reload puts
the line back there (`parseAt` / `formatAt` in `src/lib/reader/text.ts`).
`y` is a height on
the screen, so it means the same at any WIDTH or size: after a WIDTH change
the relayout keeps the line at its height and the URL keeps the same `y`, and
a reload at the new width lands there again. It is held on screen (no higher
than a line above the top, no lower than a line above the bottom), and PAGED
ignores it, keeping the page that holds the character. A two-part
`?at=<block>.<offset>` (a bookmark, a history entry, an older link) opens on
the top margin, as does a place from the server, which
has only its character.

**A page that is the band alone** (a chapter whose text ends exactly at a
page's end) has no character of its own to keep, so its position is the
chapter's last character, on the page before. The reader also remembers that
it is on the band's page, whether it got there by turning or by coming back
from the next chapter, and a relayout keeps it there rather than a page back.

**The start band's page alone** (a chapter that opens on a full-page
illustration) is the same at the other end. Its position is the chapter's
first character (`0.0`), however the reader got there (opening the chapter,
turning back, a scrub from pages on), and a relayout keeps it on that page.
So the chapter's first character opens on the band's page: an entry opened
at its top starts on its band, and so does a reload there. A PAGED reload on the illustration's own page, whose place is
also `0.0`, lands one page back, on the band. In SCROLL a `0.0` with no line
height opens at the top, the band above it; with one (`0.0.<y>`), the line
goes back to its height as any place does.

It travels through `POST /api/reading`: `page` is the paragraph, and two
optional fields carry `offset` (the character) and `total` (paragraphs in the
entry). The server stores them in `last_position`, `last_offset` (migration 11) and `page_count`, so the series screen's percentages work without the
server ever reading the book. A text reader opened incognito sends none of
this at all ([`PRIVACY.md`](PRIVACY.md), "Incognito"). The URL keeps `?at=<block>.<offset>`, so a
reload, or incognito, which saves nothing, still comes back to the same
sentence (and in SCROLL, the same line: `?at=<block>.<offset>.<y>`, above).
The reader is the URL's only writer and its only reader: CONTINUE, history
and the end page link to the entry without `?at=` (`rg -n
"searchParams.get\('at'\)|[?&]at=" src`).

**Where each way in opens a chapter.** The effect that opens the first
chapter takes, in order: `?p=last` (its end, stepping back from the next
chapter); a place the URL names (`?at=0.0` included, the top, whatever the
server saved); the server's saved place (`last_position` and `last_offset`)
when the chapter is not read; and otherwise its top. A saved block the chapter
no longer has (its text changed) opens at the top and settles there
(`openChapter`, which alone knows the chapter's length).

| The way in                                                                      | Where it opens                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ▶ CONTINUE, a chapter row, history, the end page, an unread chapter left midway | the saved block and character                                                            |
| any of those, the chapter read                                                  | its top                                                                                  |
| a read chapter marked unread (MARK UNREAD on the series screen)                 | its top: the mark clears the saved place ([`SERIES.md`](SERIES.md))                      |
| UNDO of a long-press MARK READ THROUGH                                          | the saved block and character: `?/undoMarkThrough` puts them back, never `?/mark read=0` |
| any of those, the saved block past the chapter's end                            | its top                                                                                  |
| `?at=<block>.<offset>` (a reload, a bookmark, the URL the reader keeps)         | that character                                                                           |
| `?at=0.0`                                                                       | its top                                                                                  |

The URL is the reader's only writer; `keepHistoryUrl()` copies it into the
history entry too, so a popstate back into that entry opens what the reader was
left on (`doc/NAVIGATION.md`, "A screen being left writes nothing").

Each event's `durationMs` is capped at **five minutes** a page, not the image
reader's two: a page of prose at the default size is 352–391 words, which a
slow, careful reader takes up to five minutes over
([`READING-LOG.md`](READING-LOG.md), "The caps").

## Turning

Paged turns slide and follow the finger, as a manga's do ([`READER.md`](READER.md),
"Turning pages"), on the same numbers
(`TURN_MS`, `TURN_EASE`, `DRAG_PX`, `EDGE_GIVE` and `swipeAction` in
`src/lib/reader/reader.ts`; [`MOTION.md`](MOTION.md), "Page turns"):

- **The page follows a sideways drag.** Let go past the swipe threshold
  (40px, mostly sideways) and it slides the rest of the way; short of it, it
  goes back. Where no page lies that way in this chapter (its last page going
  on, its first going back) the drag gives a quarter as much.
- **Taps, arrows, Space and the wheel slide too**, in 220ms, and so does a
  TV's key turn. A turn asked for mid-slide is taken when it lands, so quick
  taps all count.
- **Anything else that moves the reader mid-slide wins**: the scrubber,
  CONTENTS, a chapter opening. The slide stops where the newer ask put the
  page, and the turn gives way to it, rather than choosing its page when the
  slide ends, one past wherever the scrub had left it (a remote's →, OK onto
  the scrubber, ← within 220 ms). The reader counts its own
  moves (each page it goes to, each chapter it opens), and the turn lands only
  if the count is still the one it started with: comparing the character
  being read would miss a scrub onto the band's page alone, which has no
  character, and turn one back from it. A relayout mid-slide is not a
  move: it keeps the character being read, so the turn still lands on the page
  after it.
- **One finger drags.** The press follows the pointer that began it; a
  second finger going down (a pinch beginning) ends it as a cancel would, so
  the page goes back instead of jerking towards the new finger, and neither
  finger moves it until both lift (`src/lib/reader/pointer.ts`, shared with
  the image reader). A drag is never a long press: once it starts (8 px) the
  hold is given up, so a drag that pauses does not select the word under the
  finger (it did between 8 and 10 px, until 2026-11-24).
- **Across a chapter's end** the next chapter's first page slides in from
  where the next page lies, and back across it the previous chapter's last
  page slides in from the other side. Into another volume it slides in once
  OPENING is done. The end page arrives, and leaves, at once.
- **Vertical Japanese slides on its own axis**: its pages lie one below the
  next, so its turn translates up, while the finger pulls the next page in by
  dragging right, as in every right-to-left book.
- **Reduced motion** turns at once and the page doesn't follow the finger.
  Scroll layout is untouched.

The chapter is one CSS-columns flow, so the page either side is already laid
out beside this one: a turn is a transition on the flow's transform, which is
on a layer of its own, and the columns are never laid out again for it. The
axis and its sign are one pair in `TextReader.svelte` (`pageAxis`,
`pageSign`): a horizontal book read R→L ("Direction" below) is the x
axis with the sign -1, its columns run right to left, and its turns slide the
other way on the same code. Tested in `tests/text-reader-turn.e2e.ts`
on every device, and vertical Japanese in `tests/text-reader-flow.e2e.ts`.

## Touch

The image reader's rules, and its code (`tapAction`, `swipeAction`), with
wider strips:

- the 30% edge strips turn (`TEXT_EDGE`; the image reader's are 16%, too
  small to hit on a page of text), so only the middle 40% shows the controls;
- a swipe turns anywhere;
- in vertical Japanese, and in a horizontal book read R→L ("Direction"),
  the left strip turns forward and a swipe to the right reads on;
- in scroll a tap never turns.

Everywhere else a tap shows the controls, the text included. A **long press**
on a word selects it, in every book but a Japanese one, where it still looks the
word up in the shared lookup panel; taps are unchanged ([`JAPANESE.md`](JAPANESE.md),
"In a book"; "Highlights", below).

A tap on a marked word opens that highlight, before the edge strips: a marker
is the words' own, and the strips are for the margins' bits of page.

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
does nothing while a sheet (the end page's DELETE among them), CONTENTS, the lookup or a full-screen image is open,
and scroll layout scrolls.

A drag on the words selects, with a mouse (it never turns a page; off the words it
still does): "Highlights", below.

Arrows, Space, PageUp and PageDown turn too; OK (Enter), Esc or the mouse at
the top or bottom of the window shows the controls. On a TV, OK shows the
controls and BACK closes CONTENTS or an image, then the controls, then leaves
([`TV.md`](TV.md), [`READER.md`](READER.md)). With the controls up, a TV's pad
walks them: focus starts on the page scrubber, ↓ reaches CONTENTS and
READING, and READING is a 420px panel where LAYOUT and the rest change by keys
alone — ← → along a row, ↑ ↓ between rows, OK takes the value. BACK closes it
and the pad goes back to the scrubber in the chrome's place (the footer gives
way to the sheet, so the cell that opened it is gone). OK on CONTENTS opens a
focus scope that starts on the row being read, the arrows stay in it,
and BACK gives the pad to CONTENTS again. At the end of what is downloaded
(END · LAST AVAILABLE, a volume that isn't the last) the pad reaches the
rating, FAV, ← SERIES and LIBRARY, marked inside; the last volume's end
is the end page, which takes the pad the same way, and its library row
(DELETE, or + ADD for a record) is a stop of its own. Off a TV the arrows stay
the reader's whatever the controls.

**CURSOR** is the image reader's row, with the same choice (off by
default; [`READER.md`](READER.md), "Mouse"): with it on, three seconds without
the mouse moving hides the cursor over the page, and a move or a press brings
it back at once. A key and the wheel do not, and it never hides while the
bars, the sheet, CONTENTS, the lookup, a full-screen image, a wide block or
the end page is open. The row is left out where there is no mouse, so a phone,
a tablet and a TV show none. It is the same device setting
(`tsundoku.reader.cursor`), and SETTINGS lists it under 01.

## Highlights

The rules and the record are [`HIGHLIGHTS.md`](HIGHLIGHTS.md), "Quotes". Text
stays `user-select: none`: a selection is the reader's own state, a span in
`TextReader.svelte`, painted as spans around pieces of its text nodes
(`src/lib/reader/text-marks.ts`). Wrapping never changes a block's text, so a saved
position is unaffected by a mark on or off.

- **Making one.** A **long press** (450 ms, the reader's own) selects the word and the
  bar comes up over it, with LOOK UP on it whenever the book's language has a pack
  (doc/LANGUAGES.md); that panel's foot has HIGHLIGHT, NOTE and SELECT MORE. Two square handles extend it,
  a sideways drag on a vertical book reaching the next column. With a **fine pointer
  a drag on the words selects** (never turns a page, and off the words it still
  turns); on touch, drags still turn. HIGHLIGHT keeps it, at once and with nothing
  else (no band, no toast: the stroke says so), and the marker takes the colour last
  chosen here. NOTE keeps it and opens its sheet on the note. H and N are the keys
  (shown on a mouse's bar), L is LOOK UP (the Japanese bar), Ctrl+C copies, Esc
  clears; with nothing selected H does nothing and the arrows still turn.
- **The bar** sits over the first selected line, below it near the page's top
  (`barPlace`), across the top of a vertical book. LOOK UP only where a pack answers;
  incognito leaves HIGHLIGHT and NOTE out and adds an INCOGNITO cell, and a browsing
  record offers neither, as it has no rating.
- **Taps clear, swipes turn and clear.** With a selection up a tap anywhere else
  only clears it. A key, the wheel and the scrubber clear it too.
- **HOLD TO TURN →**, paged: the end handle (or a mouse) held at the page's end
  shows the cue; after 0.6 s the page turns under it and the selection reaches the
  page turned to (the first word there, at least, or wherever the finger is on the
  text), and it arms again. In SCROLL the page just scrolls as the handle nears an
  edge. Never into another chapter: no position exists past the chapter's end, so a
  highlight crosses pages but never chapters. The cue never shows at the last page.
- **The marker** (`.mk`, DARK and PAPER, `--mk-y`/`-o`/`-b`): the lower two-thirds of
  the line, the words in full ink, square-ended; in vertical Japanese the left of the
  column. Its 1 px either side is a padding with an equal negative margin, so making
  one moves no word. A note shows as the empty `≡` cell after the last word, drawn by
  CSS so the block's text doesn't change. DIM lies over it as over everything.
- **A tap on the words opens it**, the sheet on a phone and a 420 px panel on the side
  away from the words: the quote, its place, the three colours, NOTE (saved as typed),
  `MADE 2 NOV · KEPT ON THE WORKSTATION`, COPY and DELETE. DELETE is at once, with
  `HIGHLIGHT DELETED · UNDO`. DELETE (the key) deletes too.
- **A wide block's numbers don't depend on the screen.** Its head says `TABLE` or
  `LISTING` and never another length: `· 640PX, 320 SHOWN` is the label's `data-shown`,
  drawn by CSS, so the same stored span paints the same words on a cut and an uncut
  screen. In a table a long press takes a word from its own cell, since cells have
  nothing between them.
- **Only the current chapter holds marks and selections.** The `.kept` copies a
  SCROLL crossing leaves have every mark removed (`keepForCrossing`), and nothing in
  them answers a press (`data-b` is gone), so a selection can't start there. Next-chapter
  text below the current one is unmarked until the crossing opens it.

The TV shows the markers and has no selection: no long press, no handles, no bar, H
does nothing, and no focus stop moved.

## Direction

READING's DIRECTION row, under LAYOUT, says which way a horizontal book's pages turn in
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
  book's spread does: the other order would have the eye cross the page
  against the way the pages turn.
- **SCROLL never turns**, so the row is dimmed there with PAGED ONLY, as the
  image sheet's PAGED ONLY rows are, and nothing mirrors.
- **Vertical Japanese keeps its own direction**: the row shows R→L, dimmed,
  with VERTICAL TEXT READS R→L.
- **Kept like the image reader's MODE**: this session's when picked, the
  series' once REMEMBER R→L (or L→R) is pressed, on every device. SERIES
  DEFAULT says what the series reads as. It is stored in
  `series.text_direction` (migration 69), its own column because `series.direction`
  already holds a novel's LAYOUT. NULL is 'never chosen', which reads as L→R;
  REMEMBER L→R stores `'ltr'`, so an import's fold can tell a chosen L→R
  from a series nobody set ([`IMPORT-MIHON.md`](IMPORT-MIHON.md)). A NULL
  written by an older build stays ambiguous: nothing recorded which it was.
  REMEMBER posts to the reader's own action
  (`/read/<entry>?/textDirection`), which only a book of text takes
  (`kindFacts(kind).medium`) and which, like the page, answers 404 for a
  hidden series with reveal off. There is no SETTINGS default for it: L→R is
  the default everywhere. A novel
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
`tests/migrations-db.spec.ts` (migration 69).

## Controls

- **Top (64px):** ←, the series, and a meta line ("WEB NOVEL · CH. 812 OF
  1,429 · 57% OF BOOK"; "NOVEL" below 100 chapters; matter is named, not
  numbered), the rating bars and FAV, which turns accent when on. On a phone
  the top bar drops the rating bars, which don't fit beside the title at
  360px.
- **Bottom:** the chapter with "P. 5 OF 13 · 7 MIN LEFT", a scrubber across the
  chapter's pages, then `← CH. 211`, CONTENTS, READING and `CH. 213 →`. In
  vertical, and in R→L, the cells and the scrubber mirror (one path,
  `TextChrome`'s `rtl`). In SCROLL the scrubber runs 1–100 (percent of the
  chapter), because a scrolled chapter has no pages. **On a phone the row
  scrolls**: at 360 px its cells are wider than the screen, and a clipped row
  would leave the last ones (FULL SCREEN at 100% text) unreachable. The cells keep their size and
  order, READING's summary ellipsizes but SETTINGS ↑ keeps its width, and a
  sideways drag on the row reaches the rest; the bar keeps its height, so the
  reading area under it does too.
- **READING** is the image reader's sheet with rows for text: LAYOUT (the
  series', with REMEMBER), DIRECTION (the series', with REMEMBER),
  COLUMNS, THEME, FONT, SIZE, LINE, MARGINS, WIDTH ("Pages" above),
  JUSTIFY, FURIGANA, DIM and the rating. FURIGANA's ALL and NONE work; UNKNOWN
  is disabled, since it needs a known-words list. It has no scrim, so changes show as
  they're made. Everything below DIRECTION belongs to the device
  (`localStorage`, `tsundoku.text.settings`, stamped through
  `settings/local.ts` and mirrored on the server,
  [`SETTINGS.md`](SETTINGS.md), "Devices"), except WIDTH, which is the
  series' with the device's last choice as its default and is not mirrored,
  and DIM is shared with the image reader. A novel's default LAYOUT is SETTINGS'. The
  sheet ends with ALL SETTINGS →. A long sheet scrolls under a head that stays
  at its top, so ✕ is always reachable, and `scroll-padding-top` keeps a
  focused row from stopping beneath it.
- **FONT** offers three, in this order: **Plex Serif** (the default),
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
    the build carries (`ls -l build/client/_app/immutable/assets`):
    `opendyslexic-latin-400-normal` 115,280 bytes, `-400-italic` 112,360 and
    `-700-normal` 120,356, 347,996 in all, plus a 478-byte stylesheet; the
    service worker's list names exactly those three woff2 and
    `fonts-reading.*.css`. Never a CDN.
  - **A face without a glyph falls back cleanly.** OpenDyslexic is Latin only,
    so its stack goes on to Plex Sans JP and KR, and a mixed novel shows no
    boxes. Vertical Japanese is set in Plex Sans JP whatever FONT says.
  - **A saved FONT this build doesn't know** (a newer build's, or one edited
    by hand) reads as Plex Serif, never as an empty `font-family`
    (`textSettings`); one saved before FONT had three faces reads as it was.
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
- **PAPER:** the library's light palette, with full-ink body
  text.

There's no sepia: DIM over DARK does what sepia is usually asked for at night.

## Failure

DID NOT OPEN names what happened:

- **LOCKED · ADOBE DRM** (`rights.xml`, or `encryption.xml` encrypting more
  than fonts);
- **BROKEN EPUB · …** (not a zip, `CONTAINER.XML NOT FOUND`, an empty spine);
- the file gone from the server;
- offline before the book was kept, with RETRY;
- a chapter of a novel downloaded so far that isn't downloaded yet ("CH. 3 IS
  NOT DOWNLOADED", [`NOVELS.md`](NOVELS.md), "Reading it").

A chapter with no file reads online when the novel's plugin is installed
([`READING-ONLINE.md`](READING-ONLINE.md), "Novels online"); without one, a novel
downloaded so far stops at its first chapter with no file: no NEXT
on the last page, and END · LAST AVAILABLE past it, "2 OF 3" and which
chapter isn't downloaded. The contents list doesn't jump to one.

There's always ← SERIES and LIBRARY.

There is no offline band on a chapter's last page: a book is kept whole, so a
next chapter that isn't cached only happens when the book never finished
downloading, and that is the offline DID NOT OPEN.

## Limits

- **Furigana generation.** Books that carry `<ruby>` show it; books that don't
  get none.
- **No mincho for Japanese.** Vertical text is set in Plex Sans JP, since Plex
  has no Japanese serif.
- **Three reading fonts.** A new one is a row in `TEXT_FONTS`, hand-written
  woff2-only `@font-face` rules in `fonts-reading.css` (not an `@import` of
  @fontsource's CSS, which would put woff back in every device's precache),
  and the TYPEFACE row's option.
- **Scroll doesn't carry back into the previous chapter.** Scrolling up past
  the top (or past the end a crossing kept, which isn't the chapter) stops
  there, and `← CH.` goes back.
- **The budget ignores books' weight after the first marker,** and letting go
  of an entry's marker doesn't delete the EPUB from the device cache.
- **Pasted web-novel chapters** are not read here ([`ARCHITECTURE.md`](ARCHITECTURE.md),
  "Limits").
