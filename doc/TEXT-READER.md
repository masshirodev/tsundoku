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
its own file**. Scroll doesn't preload across a volume's end. Each volume is
kept in the device cache with markers for its own entries.

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
  columns the size of the page and turns by translating one page. Landscape
  shows two columns 96px apart, like a spread; COLUMNS turns that off.
- **Vertical Japanese** uses columns too. A `vertical-rl` multi-column
  container fragments along its width and stacks the overflow downward, so
  each page is one column and a turn translates it up. Lines are never cut at
  the edge.
- **Scroll** is one column that runs past the screen. The next chapter is
  already below the band that ends this one. Once its start passes the middle
  of the screen, the reader moves to it, keeping everything where it was on
  screen.

The chapter ends where it ends: the rest of its last page is the band that
names the next chapter ("END · CH. 212 / 212 OF 591 / NEXT … / ABOUT 12 MIN /
TAP OR SWIPE TO CONTINUE →"). It only gets a page of its own when the last page
is full.

## Position

A position is **the entry, the paragraph (block) and the character offset** of
the first character on screen, found with `caretPositionFromPoint`. After a
change of size, font, margins, layout or orientation, the chapter is laid out
again and opens on the page holding that character. Page numbers, percentages
and time left are worked out from the position and never stored.

It travels through `POST /api/reading` as before: `page` is the paragraph, and
two new optional fields carry `offset` (the character) and `total` (paragraphs
in the entry). The server stores them in `last_position`, `last_offset` (rung 11) and `page_count`, so the series screen's percentages work without the
server ever reading the book. The URL keeps `?at=<block>.<offset>`, so a
reload, or incognito, which saves nothing, still comes back to the same
sentence.

## Touch

The image reader's rules, and its code (`tapAction`, `swipeAction`), with
wider strips:

- the 30% edge strips turn (`TEXT_EDGE`; the image reader's are 16%), so
  only the middle 40% shows the controls. The owner found 16% too small to hit
  on 2026-10-22;
- a swipe turns anywhere;
- in vertical Japanese the left strip turns forward;
- in scroll a tap never turns.

Everywhere else a tap shows the controls, the text included. In a Japanese
book a **long press** on a word looks it up in the shared lookup panel; taps
are unchanged ([`JAPANESE.md`](JAPANESE.md), "In a book").

A tap on an illustration opens it full screen: black ground, pinch to zoom, one
finger pans, the zoom level shows for a moment, and a tap closes it. A tap on
OPEN opens a wide block on its own, to pan across.

## Mouse

On a PC, in paged layout, **the wheel turns the page**: down reads on, up goes
back, and a sideways scroll is spatial like the arrows (in vertical Japanese a
scroll to the left reads on). One gesture turns one page: the deltas add up to
40px before it turns, and the rest of the gesture, a touchpad's inertia
included, is spent until the wheel has been quiet for 200ms (`WheelTurn`,
`wheelForward` in `src/lib/reader/reader.ts`, covered by
`tests/reader-domain.spec.ts`). Ctrl+wheel stays the browser's zoom, the wheel
does nothing while a sheet, CONTENTS, the lookup or a full-screen image is open,
and scroll layout scrolls as before. The owner asked for this on 2026-10-22.

Arrows, Space, PageUp and PageDown turn too; Esc shows the controls, and the
mouse at the top or bottom of the window brings them up as in the image reader
([`READER.md`](READER.md), "Mouse").

## Controls

- **Top (64px):** ←, the series, and a meta line ("WEB NOVEL · CH. 812 OF
  1,429 · 57% OF BOOK"; "NOVEL" below 100 chapters; matter is named, not
  numbered), the rating bars and FAV.
- **Bottom:** the chapter with "P. 5 OF 13 · 7 MIN LEFT", a scrubber across the
  chapter's pages, then `← CH. 211`, CONTENTS, READING and `CH. 213 →`. In
  vertical the cells and the scrubber mirror.
- **READING** is the image reader's sheet with rows for text: LAYOUT (the
  series', with REMEMBER), COLUMNS, THEME, FONT, SIZE, LINE, MARGINS, JUSTIFY,
  FURIGANA, DIM and the rating. It has no scrim, so changes show as they're
  made. Everything below LAYOUT belongs to the device (`localStorage`,
  `tsundoku.text.settings`, stamped through `settings/local.ts` and mirrored
  on the workstation, [`SETTINGS.md`](SETTINGS.md), "Devices"), and DIM is
  shared with the image reader. A novel's default LAYOUT is SETTINGS'. The
  sheet ends with ALL SETTINGS →.
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
- **Scroll doesn't carry back into the previous chapter.** Scrolling up past
  the top stops there, and `← CH.` goes back.
- **The budget ignores books' weight after the first marker,** and letting go
  of an entry's marker doesn't delete the EPUB from the device cache.
- **Pasted web-novel chapters** (ARCHITECTURE.md, "Web novels").
