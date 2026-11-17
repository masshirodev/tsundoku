# Duplicate books

The same book downloaded twice (from two sites, or once on the tablet and
once on the phone) is found by its cover and settled by the owner, one pair
at a time. Nothing is ever removed automatically. Card c36. Designed in
`Pair Review.dc.html` and `Duplicate Books.dc.html` in
`design/handoff/`, the handoff for the brief
`briefs/done/DUPLICATE-BOOKS.md`.

(Chapters duplicated by several scanlators are another thing, settled on
their own: [`DUPLICATES.md`](DUPLICATES.md).)

## Finding

`findDuplicates`, `src/lib/server/dupes.ts`; the rules are pure, in
`src/lib/library/dupes.ts`.

1. **Covers.** Hentoid stores a 64-bit perceptual hash of every book's cover
   (`entries.cover_phash`, from the import). No other importer has one, so
   Mihon's books (its local folder, and galleries from its sources) aren't
   compared yet: card c130. Every book with a usable one is
   compared with every other: **8 bits apart or fewer** is a candidate. A blank
   or single-colour cover (a hash of all, or all but one, zeros or ones, such as
   Hentoid's `8000000000000000`) is never compared: it "matches" every other
   blank. Two books of one series are never a pair.
2. **Pages.** Hentoid hashes covers only, so for the books in a candidate pair
   the workstation hashes every page itself: a difference hash of the page's
   9×8 grey thumbnail (`imageHash`, with sharp), kept in `page_hashes`
   (rung 22). The two books' pages are then lined up (`matchPages`, a longest
   common run where "equal" is 12 bits or fewer), so a page one copy lacks, or
   a credits page one site added, shows where it falls.
3. **Same book, or alike covers.** A pair counts only when at least half the
   shorter book's pages match (`sameBook`): two books can share a cover
   template or the artist's same drawing.

Measured on the owner's library (2026-09-24): 4,069 books with a usable hash,
150 candidate pairs, **98 the same book** (69 likely, 24 maybe, 5 in two
languages). Page distances split cleanly: the same page lands at 0–12 bits, a
different one at 23 and up. Every pair involves the hidden Hentoid root.

It runs after every import (`startScan`, so the sync timer's too) and by
hand with `yarn run dupes`. For a pair that counts, it also makes every page's
thumbnail (`readPageThumb`, kept on disk), so the review never waits on them;
the review itself fetches the next pair's covers and first pages while the
owner decides, and draws each pair afresh, so the last pair's images never
linger under the next one's text (the owner, 2026-09-24). Pages already hashed aren't hashed again; lining
them up again is cheap and follows any change in how pages are matched. It
logs counts, never titles.

## The pair

For each pair (`reviewQueue`):

- **Kind.** Two languages (the books' `language:` tags differ) are two
  **editions** of one book: a **fold** is offered, never a delete. Otherwise
  it's a duplicate.
- **Confidence.** LIKELY SAME when the page counts agree (within two pages or
  a tenth), MAYBE otherwise (often a volume and the collection that holds it),
  SAME BOOK · ENGLISH AND JAPANESE for a fold.
- **The pick** (`pick`): which copy to keep, by the first rule that tells them
  apart, with its reason in words. Resolution counts for more than a page or
  two, but not for a much shorter book (the owner, 2026-09-24):
  1. **Complete over partial**, when the page counts are far apart (more than
     two pages and a tenth, the line between LIKELY and MAYBE): the one with
     the pages the other lacks ("MORE PAGES · A IS MISSING P 31–96");
  2. **Sharper**: larger pages, by a tenth or more (the median page's size),
     when the counts are close; a credits page one site added doesn't beat a
     sharper scan;
  3. **More pages**, a few, when the pages are as sharp;
  4. **What you chose**: the one read, rated, FAV'd, shelved or in a series;
  5. **Older**: downloaded first.

## The review

`/duplicates` (Pair Review). One pair at a time, closest first, with where
the owner is ("12 OF 98").

- **The two copies** as two columns where both fit (landscape) and one above
  the other where they don't (portrait): the sides wrap, as the mock's do
  (`flex: 1 1 560px`), rather than switching at a breakpoint.
- Each side: cover, title, and the fields SITE, LANGUAGE, PAGES, PAGE SIZE,
  ADDED, RATING, FAV, READ, SHELVES and SERIES. **What differs is marked** in
  the accent with a square; what matches is quiet.
- **The pick comes selected** (KEEP · PICK); a tap on the other side selects
  it instead (KEEP · YOURS), and the reason line says so. The kept side says
  what it will take over from the other.
- **02 — PAGES**: the pages lined up, a pair of thumbnails per row, a page
  only one copy has shown alone ("ONLY IN B").
- **Actions:** KEEP BOTH, GROUP AS A SERIES (absent when both books are
  already in series of books), SKIP, and KEEP A or B. A fold: KEEP APART,
  SKIP, FOLD INTO ONE BOOK.
- **A book folded already** (Pair Review 3b) and a new language: SAME BOOK ·
  A THIRD LANGUAGE, with KEEP APART, SKIP and ADD AS A THIRD LANGUAGE.
- **Part of a bigger book** (3c): two languages where the longer has many
  pages the shorter's don't match (fewer than 6 in 10). The shorter is one
  story in a collection, so nothing folds: KEEP APART or SKIP only. The line
  says where the story sits in the collection.

### Deciding

`POST /api/dupes`. A decision is recorded in `dupe_decisions` (rung 22) and
**waits**: it's carried out when the next one is made, on leaving the review,
or when the library next loads. So **UNDO** only forgets it; nothing is
deleted and then brought back. SKIP isn't recorded: the pair goes to the back
of this visit's queue and comes up again next time.

Once decisions are carried out, the covers of every series they touched are
remade from the files, off the request. That covers a new series of books (its
first book's cover), a fold, and a KEEP's series. A decision that was refused
touches nothing, so it asks for no cover (c648).
Until 2026-09-25 (card c63), GROUP here left the new series with no cover
until the next import; the library's GROUP and the series screen always
remade theirs.

**A decision the state refuses is dropped** (c648). The library answers with
the pair and its own reason, the review says so in a band, and the pair comes
back to the review undecided -- into this visit's queue at its back, and into
the next load's, if the visit has ended -- while the UNDO that named it goes,
since its decision is gone. The band's words are the
fold's, `A BOOK CAN’T FOLD · SOMETHING SITS BESIDE IT`; a KEEP or a GROUP has
its own, `A BOOK CAN’T GO TO THE TRASH · THE PAIR ISN’T WHAT IT WAS` and
`TWO BOOKS CAN’T JOIN · THE PAIR ISN’T WHAT IT WAS`, since neither refuses
because something sits beside a book. Until wave 29 a refused decision was
left waiting: `reviewQueue` hides every decided pair, applied or not, so the
owner saw neither the pair nor a reason, it could not be undone once the
review's session ended, and every library load tried it again and queued a
cover refresh. A decision's carry-over is now one transaction, so a KEEP
refused halfway leaves no shelf row behind. The delete that follows is its own
transaction, after the carry-over has committed: its two refusal checks are
made when it is called, with no `await` between them and the carry-over, so a
refused delete cannot follow a committed one -- what can fail there is the
file move, which is not a refusal (the decision stays waiting, under
`failed`). Only a refusal the fold, the grouping or the delete actually raises
is treated as one.

UNDO after the decision was carried out says so (`THE DECISION WAS ALREADY
CARRIED OUT · NOTHING CHANGED`) and takes nothing back; OPEN → after a fold
opens the book unless the refusal or failure names that fold's own pair
(c670).

**A decision that fails for any other reason stays waiting.** A bug, or the
disk refusing a file move, is not the library's state and nothing is gained by
dropping the decision: the row is neither dropped nor marked applied, it is
logged, and the answer names the pair under `failed`, which the review draws
as `THE WORKSTATION COULDN’T CARRY THAT OUT · IT STAYS WAITING`. One such
decision no longer aborts the ones behind it -- they are still carried out and
their covers remade -- and it can never take the library's own load down: the
load calls `applyPending` on every load and answers even if it throws (c648,
round 2). The KEEP whose trash move fails is where this was measured: the
carry-over is committed, the loser stays, and the pair is retried on the next
load.

| Decision          | Carried out                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KEEP              | The kept copy takes over the higher rating, FAV, read state or the further page, the other's shelves, and its place in a series of books (moving in where it was). Then the other is **deleted** as any delete is: files to the trash, a tombstone ([`DELETING.md`](DELETING.md)). |
| KEEP BOTH         | Nothing. The pair is never offered again, even after a rescan.                                                                                                                                                                                                                     |
| GROUP AS A SERIES | The two become a series of books through the grouping that exists ([`BOOKS.md`](BOOKS.md)), named by their titles' shared start. A book already in a series brings the other into it.                                                                                              |
| KEEP APART        | As KEEP BOTH, for a fold.                                                                                                                                                                                                                                                          |
| FOLD              | The two become one book in two languages ([`EDITIONS.md`](EDITIONS.md)): the folded side, else A, is the base. The band offers OPEN →, which carries it out now and opens the book.                                                                                                |

## The ways in

Only while there are pairs the viewer can see. **Hidden means hidden**: with
reveal off, a pair with a hidden book isn't in any list or count, and today
that's all of them.

- **A band in the library**, "03 POSSIBLE DUPLICATES · SAME COVER, DOWNLOADED
  TWICE · REVIEW →" (the `action` Banner).
- **A band on the series screen** of a book with a twin, the treatment
  MIGHT BE ONE SERIES has: "SAME BOOK AS … · LIKELY · 24 OF 24 PAGES MATCH"
  with **KEEP BOTH** and **REVIEW →**, which opens the review on that pair
  (`?pair=`).

## Where it departs from the handoff

- **The page scrolls, and the actions stick to the bottom.** The mock is a
  screen of its own height with only its middle scrolling; in the app the
  layout's reveal banner (always there for these pairs) or incognito band sits
  above it, and a fixed height pushed the actions off the bottom. Found by the
  owner on 2026-09-24.
- **Page thumbnails are the pages'**, not the mock's stripes; covers are the
  books' own covers (`/api/entries/<id>/cover`).
- **A page alone says ONLY IN A / ONLY IN B**, one wording for both sides; the
  mock's notes ("MISSING IN B", "CREDITS · ONLY IN B") need knowing what a page
  is.
- **GROUP AS A SERIES isn't offered when both books are already in series of
  books**: they can't become one without taking one apart.
- **The phone heading** says DUPLICATES and the actions set in 12px under
  600px, as the mock's phone frame does; the switch is a width, not a device.
- **The fold's detail line** names the two languages and says nothing is
  deleted.

## Not yet

- ~~FOLD INTO ONE BOOK is recorded but not carried out.~~ Done in card c60
  ("Book editions: fold two languages into one book"): [`EDITIONS.md`](EDITIONS.md).
  Folds recorded before it are carried out on the next decision or library
  load, as any pending decision is.
- **FOLD AS LANGUAGES from the library's selection** brings in pairs the
  covers didn't find ([`EDITIONS.md`](EDITIONS.md), "The screens").
- **Books Hentoid didn't hash** (Mihon's local books, and a few others: 2,929
  of 6,998) are never compared. Hashing their covers here (`imageHash` does
  it) would bring them in.
- **A manga series in two languages** is the same idea one level up, and out
  of scope (the brief says so).

## Tests

- `tests/dupes-domain.spec.ts`: distances, blank covers, candidate pairs,
  pages lined up, the four rules of the pick, fold and confidence, carry-over,
  same book or alike covers.
- `tests/dupes-db.spec.ts`: hidden pairs hidden, finding again from the
  hashes, a decision waiting for UNDO, KEEP BOTH remembered, KEEP's carry-over
  and delete. `tests/dupes-group-db.spec.ts`: GROUP AS A SERIES.
  `tests/duplicates-db.spec.ts`: the scanlator collapse (below), and a fold the
  state refuses -- answered under `refused`, dropped, and not tried again (c648).
- `tests/duplicates-flow.e2e.ts`: on the seed's hidden twins (Rakugaki
  Collection Vol. 3 and its [Digital] copy): no band with reveal off, the pick
  and its reason, choosing the other side, KEEP and UNDO, the series band,
  side by side in landscape and stacked in portrait, KEEP BOTH ending the band.
  Its last block runs a world of its own for a fold the state refuses (c648):
  the third language a book already has, the band that says so, the pair back
  in the review on the next load, and OPEN → landing on the refusal.
