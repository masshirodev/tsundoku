# Duplicate books

The same book downloaded twice (from two sites, or once on the tablet and
once on the phone) is found by its cover and settled by the owner, one pair
at a time. Nothing is ever removed automatically. Card c36. Designed in
`Pair Review.dc.html` and `Duplicate Books.dc.html` in
[`design/handoff/`](design/handoff/), the handoff for the brief
[`briefs/done/DUPLICATE-BOOKS.md`](briefs/done/DUPLICATE-BOOKS.md).

(Chapters duplicated by several scanlators are another thing, settled on
their own: [`DUPLICATES.md`](DUPLICATES.md).)

## Finding

`findDuplicates`, `src/lib/server/dupes.ts`; the rules are pure, in
`src/lib/library/dupes.ts`.

1. **Covers.** Hentoid stores a 64-bit perceptual hash of every book's cover
   (`entries.cover_phash`, from the import). Every book with a usable one is
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
hand with `yarn run dupes`. Pages already hashed aren't hashed again; lining
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
  apart, with its reason in words:
  1. **Complete over partial**: the one with pages the other lacks
     ("MORE PAGES · B IS MISSING P 12–13");
  2. **Sharper**: larger pages, by a tenth or more (the median page's size);
  3. **What you chose**: the one read, rated, FAV'd, shelved or in a series;
  4. **Older**: downloaded first.

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

### Deciding

`POST /api/dupes`. A decision is recorded in `dupe_decisions` (rung 22) and
**waits**: it's carried out when the next one is made, on leaving the review,
or when the library next loads. So **UNDO** only forgets it; nothing is
deleted and then brought back. SKIP isn't recorded: the pair goes to the back
of this visit's queue and comes up again next time.

| Decision          | Carried out                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KEEP              | The kept copy takes over the higher rating, FAV, read state or the further page, the other's shelves, and its place in a series of books (moving in where it was). Then the other is **deleted** as any delete is: files to the trash, a tombstone ([`DELETING.md`](DELETING.md)). |
| KEEP BOTH         | Nothing. The pair is never offered again, even after a rescan.                                                                                                                                                                                                                     |
| GROUP AS A SERIES | The two become a series of books through the grouping that exists ([`BOOKS.md`](BOOKS.md)), named by their titles' shared start. A book already in a series brings the other into it.                                                                                              |
| KEEP APART        | As KEEP BOTH, for a fold.                                                                                                                                                                                                                                                          |
| FOLD              | Recorded, and the pair leaves the review; see "Not yet".                                                                                                                                                                                                                           |

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
- **The fold's detail line** names the two languages; the mock's "OPENS IN
  ENGLISH, THE ONE LAST READ" describes the folded book, which isn't built.

## Not yet

- **FOLD INTO ONE BOOK is recorded but not carried out.** The handoff drew the
  offer, not the folded book: its tile, its screen's language choice, and the
  reader's switch to the same page in the other language. Card c60 ("Book
  editions: fold two languages into one book") holds it, and it wants its own
  design round. Until then a folded pair stays as two books, out of the review,
  and its decision waits (`applied_at` NULL).
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
- `tests/duplicates-flow.e2e.ts`: on the seed's hidden twins (Rakugaki
  Collection Vol. 3 and its [Digital] copy): no band with reveal off, the pick
  and its reason, choosing the other side, KEEP and UNDO, the series band,
  side by side in landscape and stacked in portrait, KEEP BOTH ending the band.
