# Ratings

Card c67 ("Ratings out of 10, in half-stars"). The handoff is
`doc/handoffs/done/Ratings.zip`, mirrored as
[`design/handoff/Ratings out of 10.dc.html`](design/handoff/Ratings%20out%20of%2010.dc.html)
and [`design/handoff/RatingSlider.dc.html`](design/handoff/RatingSlider.dc.html);
the brief is [`briefs/done/RATINGS.md`](briefs/done/RATINGS.md).

## The scale

- **An integer 0–10, and 0 is unrated.** Drawn as five blocks with halves, as
  Ranobe rates, so 7 is three and a half. Written out it is the stored number:
  `7 OF 10` (`ratingText`), never "3½ stars" except in the drag readout.
- **Rung 29 doubled the old 0–5 exactly** (`series`, `entries`, and
  `series_links.filled_rating`, so UNDO still gives back what a link filled).
  Nobody's rating moved: a 4 became an 8, and the odd numbers are simply new.
  The old columns stay as `rating5`, unread, rather than rebuilding two tables
  to drop them. The new columns carry `CHECK (rating BETWEEN 0 AND 10)`.
- Out-of-range input is refused, never clamped (`parseRating`): a clamped 12
  would silently become a 10 nobody chose.
- On a tile the five bars fill whole, and a half is the left half of a bar on
  its track. Unrated draws no track at all.

## The slider

`src/lib/components/controls/RatingSlider.svelte`, one component everywhere a
rating is set: the series row, the library sheet and bulk bar, the book sheet,
the reader's end page and sheets, the text reader, and the tile.

- **Press anywhere on the row and drag.** It snaps to halves, a readout above
  the finger says `7 · 3½ OF 5`, and it commits when the finger lifts. A tap
  is a drag that didn't move. The 0 cell on the left clears, and so does
  dragging off the left end.
- **It commits the way its caller needs:** a callback (the series row, which
  saves behind the value and shows NOT SAVED with a dashed outline if the
  write fails); submit buttons named `rating` (the library sheet and bulk bar,
  so it works in a plain form without script); or links (the RATED threshold).
- The pure part (where a finger is, what fills, what the readout says) is in
  `src/lib/library/rating.ts` and tested in `tests/library-domain.spec.ts`.
- Sizes are the mock's per device. The phone's apply under 600px by media
  query, so the server's first paint is already right.

## One number with the catalogues

The owner's call on c67 (2026-09-25, "go with your recommendation"):

- **The rating is the score.** AniList and MAL both score out of 10, so there
  is nothing to convert and no reason for two numbers. Setting a rating on a
  linked series sends it as the score (`afterRating` in
  `src/lib/server/tracking.ts`, through the usual queue); 0 clears it.
- **The TRACKING sheet lost its SCORE row.** It sets status only; the note
  says the rating is what both catalogues get.
- **A catalogue's score fills only an unrated series**, once, as it is: 9
  stays 9 (`scoreToRating`; other scales are read as out of 10 first). UNDO
  takes it back. A series already rated keeps its rating.

## RATED at a threshold (turn 2)

- **The shelf keeps its name and gains halves:** RATED 4+, RATED 3.5+. The
  threshold is `?min=` (1–10), out of 10 in the URL and written in five steps
  on screen (`minLabel`). 4+ (8 and up) is the default, as RATED 4+ always was.
  The shelf key is still `rated4`, so old links keep working.
- **While the shelf is showing, an AT LEAST row sits under the tabs:** the
  same slider in mode `min`, filled from the threshold up, with no 0 cell
  (a threshold never includes unrated) and a count cell, `N SERIES`. Each
  half is a link (`minHref`), so it works without script.
- **The threshold lasts while you stay on RATED.** Another shelf drops it,
  and RATED is back at 4+ next time (`shelfHref`).
- The server counts the shelf list at the default. The screen renames RATED
  and takes the grid's own count while another threshold is showing
  (`withMin`), in the tabs and in the desktop sidebar alike, so the list is
  never counted twice per navigation.
- **The person page has the same filter**, held on the page (no URL), with a
  `N BOOKS` count.

## Where it departs from the handoff

1. **`role="group"` of real controls, not `role="slider"`.** The mock's track
   is one `role="slider"` with `aria-valuenow`. Here each half is a button or
   a link with its own label (`Rate 7 of 10`, `At least 3.5+`), which is what
   lets the slider work without script and in a plain form. The chosen half is
   `aria-pressed` (a link: `aria-current`), as the old picker's cell was.
   There are no arrow keys; Tab walks the halves.
2. **The tile's picker is the slider, compact** (44px tall, no label, a
   narrower 0 cell). The handoff doesn't draw the tile at all.
3. **The TRACKING sheet has no SCORE row** (above). The Catalogue Links
   handoff (1m) drew one, from before ratings were out of 10.
4. **No AT LEAST row offline.** Another threshold is another page load, and
   offline the tabs are the CACHED set anyway.
5. **The person page's row uses the phone's sizes on a tablet too** (52px,
   84px label, 60px count). The handoff drew it at 360 only.
6. **The 0 cell carries no `aria-pressed`.** Unrated is said by the label,
   UNRATED, as before.
