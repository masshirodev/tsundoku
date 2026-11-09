# Books, people and grouping

A Hentoid library is mostly **singletons**: one doujin per series, one book per
folder. Mihon and Hentoid both leave them that way. Tsundoku lets the owner
gather related singletons into a **series of books** by hand. It suggests
candidates without ever grouping on its own. It also gives every artist,
circle, author and tag a page of its own.

Design: `doc/design/handoff/Index Books.dc.html` and `Books States.dc.html`.
Briefs: `doc/briefs/done/`. Cards: c15 ("Hentoid singleton into a series") and
its siblings on the Tsundoku board.

## The model

| Thing           | What it is                                                            |
| --------------- | --------------------------------------------------------------------- |
| Singleton       | A `doujin` series with exactly one entry.                             |
| Series of books | A `doujin` series with two or more entries. Each entry is a **book**. |
| Book number     | An entry's place in `entries.position`, the owner's reading order.    |

Which kinds GROUP binds, and how, is the kind registry's `grouping` fact
(`src/lib/library/kinds.ts`, [`KINDS.md`](KINDS.md); card c303): `books` for a
doujin, `volumes` for a novel. `src/lib/server/books.ts` asks it
(`bindsBooks`, `bindsVolumes`, and `kindsIn` for the BOOKS screen's SQL)
rather than naming either kind; the series it writes are still made as
`doujin` or `novel`.

These are shapes of the existing tables, not new ones. No flag says "series of
books": `isBookSeries()` in `src/lib/library/series.ts` asks the question,
`isSingleton()` in `src/lib/server/books.ts` asks its mirror, and the two
agree. Since c558 both count books as FILTER's ONE-OFF does (`isBookSql`: no
shadowed entry, no front or back matter,
[`FILTERS.md`](FILTERS.md), FORM, lists every reader and the `rg` that finds
them), and so do MOVE TO… and ADD TO EXISTING's targets (`seriesOfBooks`), a
person's page and the books a suggestion may name: a book with an extra beside
it is one book. FOLD AS LANGUAGES is the one reader with a stricter rule, from
the review it ends in: `foldEditions` folds one `edition_of IS NULL` entry, so
a folded edition beside the book is fine and an extra or a set-aside duplicate
is refused up front ([`FILTERS.md`](FILTERS.md), FORM).

A book with an extra or a duplicate beside it is still one book, and GROUP
refuses to bind it (`"…" holds an extra or a duplicate beside its book, which
grouping can't carry`): it moves the book alone, and the emptied singleton's
delete would take the rest with it. So neither a suggestion nor a person's
page offers it to GROUP. No importer writes front or back matter on a doujin
today -- only the EPUB plans set `matter` -- so the state comes from a hand-made
extra or the duplicates review.

**An extra is drawn apart, never counted** (c650). `booksOf()` in
`src/lib/library/series.ts` is the books alone and `extrasOf()` the rest, and
every count and number in the library and on the series screen asks them: a
single book beside a hand-made extra says `1 BOOK` (and is not a series of
books, so its pages stay the screen), a series of four says `4 BOOKS` with an
extra beside it, `CONTINUE`'s `BOOK n` numbers the books, and the order is
the books'. The extra is reachable under the grid: `ExtrasList.svelte` lists
it below the pages (a single book) or below the books (a series), each row a
link to its own pages (`?book=<id>`, which a doujin with an extra takes too),
so a TV's focus finds it with nothing extra. A folded edition is not an extra:
it carries no `matter`.

An extra's row may sort before the book's (`entries` are `ORDER BY position,
id`, and a front-matter row is naturally first): the pages grid and `READ` /
`CONTINUE` still ask `booksOf()[0]`, so the book is what is drawn and opened
and the extra stays the separate row it is. A single book beside an extra is
still not offered MIGHT BE ONE SERIES: a suggestion must be something GROUP
can bind, and `singletonCandidates` counts a series with nothing beside its
book.

### Every book keeps its own

The owner decided on 2026-09-22 that each book keeps its own rating, FAV and
tags, rather than inheriting them from the series. The storage follows from
that:

- **A singleton** keeps its rating, FAV and tags on the **series** row
  (`series.rating`, `series.favourite`, `series_tags`), which is where the
  library grid and sheet already read them.
- **A book in a series** keeps them on the **entry** (`entries.rating`,
  `entries.favourite`, `entry_tags`, rung 5).
- **Grouping** (`groupIntoSeries`) moves a singleton's values from its series
  row onto its entry, and re-homes its `reading_events` onto the target series,
  so nothing read is lost. The emptied series rows are deleted.
- **Taking out** (`takeOut`) is the inverse. It makes a new singleton series
  for the book and moves the entry's values and reading events back onto it.
  UNDO puts the book back into the series in the same place.
- **MOVE TO…** on a book's sheet moves it into another series of books in the
  same root, keeping its values. A series left empty is deleted.
- **UNGROUP** takes out every book.

### Where a book's origin lives

`series.origin_key` names **one** series at a source, and a group of one-offs
is several: its books are several manga at their sources, and may come from
different ones. So **each book's key is on the book** (rung 76; card c885): one
row of `entry_origins`, keyed by the entry, holding the key the singleton had
(`origin_key`), the name its source knows it by (`source_title`), and that
singleton's `engine_series` row (`engine_url`, `engine_title`, `resolved_at`).

- **`absorb` (GROUP), MOVE TO… of a series' last book and FOLD** put the key on
  the entry before the emptied series goes (`keepOrigin`, books.ts). A book that
  already holds one keeps it.
- **`takeOut` (UNGROUP, and the created band's UNDO), UNFOLD** give it back
  (`giveOriginBack`): the key is the new singleton's `origin_key` again, the
  engine row is its `engine_series`. An UNDO's new singleton has another id, and
  it's the entry that survives each step, which is why the row is keyed by it.
  A key something else has come to hold stays on the book, and works from there.
- **The one answer to "where does this entry come from"** is still
  `entryOriginSql` / `entryOrigin` (`src/lib/server/season-facts.ts`). It reads
  the book's own key first, then a season's, then the series': a one-off has no
  season, and a season row must never answer for it as season 0.

Every reader of a key says what it does with a book's:

| Reader                                                           | A book in a group                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `seriesDownloads`                                                | Answers per book (below)                                        |
| `readsOnline`, `chapterAtSource`, the queue, `deviceBackup`      | Read the book's key; its source, its address, its folder        |
| `resolveBook`                                                    | `resolveSeries` for one book, with the same six-hour keep       |
| REFRESH                                                          | Asks every book's source; adds nothing: a book is one entry     |
| Recognition (`seriesHolding`, `heldByOther`, `libraryIndex`)     | Finds the group by a book's key, so a book is never added twice |
| Deleting a group, or one book                                    | Buries each book's key, as its own series would have            |
| A source's switches (`sourceFlagSql`, `concealable`, `ofSource`) | A book in a group flags the group: a switch still reaches it    |

`seriesDownloads` on a group: `none` when no book is from a source, `elsewhere`
when no book's source has an extension, `down` when the engine isn't answering,
otherwise `ok`, each book its own state. A book whose own extension is gone is
a chapter its source can't be asked about (nothing to queue), beside one that
can.

**A grouped series is named from its root** (`nameFromRoot`), not from one
book's folder. The importer writes each download through the series its key
finds, and a path of none, or one inside the device's folder, would make it
read that one book's folder as the series' own and mark every other book's file
gone. A root can itself be the device's folder (a scan makes the Mihon root at
`<library>/devices/<device>/Mihon` when no other exists, and ADD then uses it),
so a root under the library's `devices` folder names the group from the library
folder instead. GROUP, MOVE TO… and FOLD all apply this, whenever the book they
bring holds a source's key.

**A queued book goes with its entry.** `download_queue.series_id` is what the
queue screen joins to find the series, and it cascades with that series, so
every door that moves an entry to another series (GROUP, UNGROUP and the created
band's UNDO, MOVE TO…, volumes bound and taken out, FOLD, UNFOLD) carries it, in
any state, before the old series can go. A chapter that leaves a series which
stays keeps no key: if its new series has none it stays on the queue and the
worker fails it where it shows, as it fails any chapter its source can't be asked
for.

**On the series screen** a group offers READ (the panel's ▶, online for a book
with no file) and DOWNLOAD (the panel's FIRST n / ALL n), both per book on the
server. **One book's own page offers them for that book** (c885): a tap on a
single undownloaded book opens `?book=<id>`, whose page grid draws ▶ READ
ONLINE and DOWNLOAD in the house cells above the pages. READ ONLINE is drawn
when `readsOnline(book.id)` says the book reads online and the workstation is
reachable — the reader's own rule, not the group's state: a book whose own
source has no extension, or which holds no key at all, is offered neither cell.
DOWNLOAD is drawn when `rowAction` would queue that book's own row of
`seriesDownloads`, and RETRY when its download failed, as its row on the list
does. Both ask `?/download` with that one entry, so each queues one book. A
folded book keeps the screen it had.

**FOLLOW is a series' idea.** A group of one-offs has no one thing to follow,
so the row leaves FOLLOW out and `setFollowed` still refuses. A series that
holds a key of its own and has books grouped into it follows that key, as it
always did.

**Books grouped before rung 76 hold nothing to rebuild from.** What a book keeps
is its chapter's address and `origin_source` (only MOVE writes it); the source
id and the manga's address went with its series row, and nothing else recorded
them. Such a book answers `none` until the owner re-adds it from the source.

### A volume's cover

A **volume's** cover is its EPUB's, kept in the cover directory by its **file**
(c835), so no row or column names it: `readVolumeCover` (`src/lib/server/covers.ts`)
hashes the file's path and its size and mtime, and keeps `volumes/<path>-<version>.webp`.
Every chapter of a volume shares that one file, so every chapter asks the same
cover; taking the volume out, UNGROUP or a re-group in another order leaves the
same file, and its cover is kept. A rescan that replaces the file makes a new
version, removes the old one on the next ask, and `refreshCovers` sweeps a
cover whose file the library no longer has. The endpoint is
`GET /series/volume-cover/<entry>` (any entry of the volume), and it is guarded
as the series' cover is: hidden means a 404 while reveal is off.

A book whose cover is a **page** rather than a manifest image (Haibara's) is
read too: when the package names no `cover-image` and no `<meta name="cover">`,
the image an XHTML page in a `Cover` entry holds (`<img src>` or an SVG's
`<image>`) is taken as the cover, by the series' cover as well. Whether the
owner's own six books have such a page is unverified here: `readEpub` is not
given the live files in a spec (see the card's Gaps).

A series of books has a rating and FAV of its own too: they belong to the
series, not to any book.

**TAGS on a book's sheet** edits that book's own tags (`entry_tags`), in the
shelves-and-tags sheet with the shelves left out: they belong to the series
(`EditSheet`'s book mode, `addBookTag` / `removeBookTag`). A series of books
carries every tag its books carry, which is what the library's tag filters
and person pages find it by, so a tag added to a book is added to the series
too, and one taken off the last book that has it leaves the series.
Suggestions mark ✓ ON THIS by the book's tags, not the series'.

### Rules grouping enforces

`GroupingError` is thrown, and the route answers 400, when:

- a series given isn't a singleton (manga and series of books can't be grouped,
  only books added to them). Novels group by their own rules (below);
- the books are hidden and visible at once: a series can't straddle a hidden
  source and a visible one, or a hidden book would show in a visible series.
  Books from **different sources that are alike** do group: the same work is
  often in both Mihon's local source and Hentoid (the owner's _Akiko-san to
  Issho_), both hidden. The series lives in the first book's source, its path
  widens to hold every book's folder, and a rescan finds each book in it
  whichever source it came from. Until 2026-09-23 any two sources were
  refused, and the refusal never reached the screen;
- a new series would hold fewer than two books, or has no name;
- a book is moved (MOVE TO… on its sheet) to a series that's hidden when it
  isn't, or the other way round.

A refusal is always shown: in the group sheet, which stays open, and on the
series screen as a band ("… · NOTHING CHANGED").

## Volumes of a novel

Every EPUB imports as a series of its own ([`IMPORT-EPUB.md`](IMPORT-EPUB.md)),
so a work in several books arrives as several series: six Beginning After The
End books are six tiles. GROUP gathers them into one. Select the novels on the
library grid (the KIND band's NOVELS helps), or on their author's page, and tap
GROUP. The same group sheet reads VOLUMES instead of BOOKS: name the series,
order the volumes by date added, by title or by hand, then CREATE SERIES, or
ADD TO EXISTING to put them after another novel.

GROUP is offered for any selection (W4). The sheet's first row is **AS**, and
it shows only the answers the selection allows:

| Answer                 | What it takes                                                     |
| ---------------------- | ----------------------------------------------------------------- |
| `ONE SERIES · BOOKS`   | doujin singletons, every selected item one book                   |
| `ONE SERIES · VOLUMES` | novels, every selected item one file's series                     |
| `A WORK · SERIES`      | any series: a Work keeps them apart, so nothing here has to merge |

The answer names the noun for the rest of the sheet, which is otherwise the
same as it always was: NEW SERIES / ADD TO EXISTING, NAME, ORDER, rows, and
CREATE. Books and volumes behave exactly as they did; the AS row only decides
which grouping the sheet is asking about. `ONE SHOW · SEASONS` is S2's, and
`groupAnswers()` in `src/lib/library/books.ts` is where the rule lives.
Selecting the work's answer is doc/WORKS.md, "Making one".

The model is the same tables again:

| Thing             | What it is                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Volume            | Every entry of one EPUB file, in a `novel` series.                                             |
| Series of volumes | A `novel` whose entries come from two or more files (`isVolumeSeries()`).                      |
| `entries.volume`  | The title of the book an entry came from, set by grouping (rung 16). `''` in a one-book novel. |
| An entry's `file` | Relative to the series' path, as always. Grouping takes the folder the volumes share.          |

What grouping does (`groupVolumes` in `src/lib/server/books.ts`):

- every entry moves to the series, keeping its read state, position in the
  book and log rows. Positions run 1…n across the volumes, in the order chosen;
- each file is re-expressed from the shared folder
  (`Light novels/Frieren Vol 1.epub`);
- the series takes the highest rating of its volumes, FAV if any had it, all
  their tags and shelves, and the first volume's cover (made off the request);
- the series takes the first volume's layout (`direction`) and page direction
  (`text_direction`, the text reader's R→L, c551): the first volume's own,
  else the first later volume that has one. NULL is the default L→R and
  `'rtl'` the only stored value, so a novel any volume of which was set to
  R→L stays R→L. Volumes joining an existing series (ADD TO EXISTING) take
  that series' direction, as they take its layout;
- the emptied series are deleted.

A novel doesn't keep a rating per volume the way a book in a series does: a
volume isn't a thing the library shows on its own.

On the series screen, CONTENTS heads each volume ("VOL. 2 · FRIEREN: VOLUME
2 · 12 · 3 READ"), each with its own front and back matter. Only the volume
being read folds its read chapters. The text reader downloads each volume's
EPUB on its own, when reading reaches it ([`TEXT-READER.md`](TEXT-READER.md)).

**UNGROUP** (`takeOutVolumes`) gives every volume a series of its own again:

- its book's title;
- its folder and file name;
- the series' rating, FAV, tags and shelves;
- the series' layout and page direction (`direction`, `text_direction`: an
  R→L novel's volumes read R→L on their own, c551);
- the date its entries arrived;
- its original origin key, so the next scan finds it by its file as before.

Progress was on the entries all along. If one volume is left, it's a plain
book again. The created band's UNDO does the same; after ADD TO EXISTING, it
takes out only the volumes just added.

**Rescans** keep a grouped volume where it is ([`IMPORT-EPUB.md`](IMPORT-EPUB.md),
"Rescanning").

## Order

A new series starts **by date added**, because that is how Hentoid numbers
things. The group sheet also offers BY TITLE and BY HAND (↑↓ per row). On the
series screen, **ORDER** switches the books grid into reorder mode:

- drag a cover (pointer), or focus one and use the arrow keys;
- BY DATE and BY TITLE re-sort in one tap;
- DONE saves (`reorderBooks`) and ✕ discards.

Only the order changes. CONTINUE and the book numbers follow it.

## Suggestions

`suggestionSets()` in `src/lib/library/books.ts` proposes singletons that are
probably one series. It never groups anything. Two singletons match when they
share a **stem**: the first two words of their titles (`stemKey()`). Two
guards keep it from matching everything:

- the title needs at least three words, so a two-word title isn't all stem;
- the two words need at least six letters between them, so "Ai no" or "The
  Greatest" pairs don't count, but "Kaori Mama" does.

`tests/books-domain.spec.ts` holds the examples.

- Only visible singletons are candidates while reveal is off.
- The series screen shows **MIGHT BE ONE SERIES** on a singleton that has
  candidates. REVIEW → opens the group sheet with a tick per book. NOT A SERIES
  dismisses. Both bands' words are messages since c587 (`offer_*` in
  `messages/`, [`I18N.md`](I18N.md)); its count is the plural
  `offer_suggestion_books` since wave 31 (c587), and the `· …` half is still
  the books' own `suggestionLabel`.
- A dismissal is stored in `suggestion_dismissals` as the sorted,
  comma-joined series ids (`setKey`). A suggestion whose books are all inside a
  dismissed set stays dismissed, so dismissing "A, B, C" also silences "A, B".
  One with a new book in it comes back.
- Unticking books in REVIEW and creating the series records the whole
  suggested set as dismissed, so the leftovers aren't suggested again straight
  away.

## Person and tag pages

`/?tag=namespace:value` is the library with a richer header
(`src/routes/PersonView.svelte`, data from `tagPage()` in
`src/lib/server/people.ts`):

- **People** (`artist`, `circle`, `author`) get FAV, which adds them to the
  **PEOPLE** shelf. A circle also gets its ARTISTS row, counted over the
  books this page shows.
- A **SERIES** strip lists the series of books with a matching book.
- The grid holds **books in series** (matched by their own `entry_tags`) and
  **everything else as its series** (matched by `series_tags`). Tapping a book
  opens its series with `?book=` so the book's pages are showing, and ← comes
  back here.
- Tabs ALL / UNREAD and BY SERIES (one tile per series of books), sorts, and
  the library's FILTER panel, filtering on the device: rating, FAV, language,
  date added, downloaded, and hidden while reveal is on
  ([`FILTERS.md`](FILTERS.md)).
- SELECT and the library's bulk bar work here, REFRESH included (a book with no
  source is skipped). **GROUP** is the bulk bar's, and its AS sheet can make a
  series of books, a series of volumes, or a **Work** (W4) -- the common way an
  author's Work is made. Books already in a series can't be selected (they are
  entries, not series), and a Work with a series here gets one row above the
  grid saying the run exists without pulling its other series in.

Hidden means hidden here too. Every query takes `reveal`, and a tag with
nothing visible is a **404**, the same answer as a tag that doesn't exist. A
circle made only of hidden books has no page while reveal is off. The PEOPLE
shelf leaves out a favourite person with no visible books for the same reason.

## Where it lives

| Concern                                | Code                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| Pure rules (stems, order, labels)      | `src/lib/library/books.ts`, `series.ts`                             |
| Grouping, take-out, order, suggestions | `src/lib/server/books.ts`                                           |
| Person and tag pages, PEOPLE           | `src/lib/server/people.ts`                                          |
| Series screen: books grid, book sheet  | `src/routes/series/[id]/BookGrid.svelte`, `BookSheet.svelte`        |
| Group sheet (library and suggestion)   | `src/routes/GroupSheet.svelte`                                      |
| Person page                            | `src/routes/PersonView.svelte`                                      |
| Volumes of a novel                     | `src/lib/server/books.ts` (`groupVolumes`, `takeOutVolumes`)        |
| Tests                                  | `tests/books-domain.spec.ts`, `tests/books-db.spec.ts`              |
| Tests, volumes                         | `tests/epub-import-db.spec.ts`, `tests/volumes-flow.e2e.ts`         |
| A book's origin, tests                 | `tests/group-origin-db.spec.ts`, `tests/browse-group-origin.e2e.ts` |

## Known gaps

- **Grouping moves no files.** The books stay in their Hentoid folders, and the
  series lives only in the database. Moving folders on disk would fight the
  Hentoid importer's rescans. FILE on a series of books says "N FOLDERS".
  Each book names its own folder relative to the series path, which grouping
  and take-out copy over ([`IMPORT-HENTOID.md`](IMPORT-HENTOID.md)), and a
  rescan finds a grouped book where it now lives.
- **`cover_phash` finds duplicates, not series yet.** The duplicates review
  uses it ([`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md)); cover similarity would
  make a better suggestion signal than titles too.
- **The READ button waits on the reader** (c13).
