# Ratings

Ratings out of 10, drawn in half-stars.

## The scale

- **An integer 0–10, and 0 is unrated.** Drawn as five blocks with halves, as
  Ranobe rates ([`RANOBE.md`](RANOBE.md)), so 7 is three and a half. Written out it is the stored number:
  `7 OF 10` (`ratingText`), never "3½ stars" except in the drag readout.
- **Migration 29 doubled an earlier 0–5 scale exactly** (`series`, `entries`,
  and `series_links.filled_rating`, so UNDO still gives back what a link
  filled): a 4 became an 8, and the odd numbers are new. The 0–5 columns stay
  as `rating5`, unread, rather than rebuilding two tables to drop them. The new columns carry `CHECK (rating BETWEEN 0 AND 10)`.
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
  saves behind the value, one save at a time with the last tap winning
  ([`SERIES.md`](SERIES.md), "FAV and the rating"), and shows NOT SAVED with
  a dashed outline if the write fails); submit buttons named `rating` (the library sheet and bulk bar,
  so it works in a plain form without script); or links (the RATED threshold).
- **It never shrinks**: its root has `flex-shrink: 0`, so a flex column that
  scrolls (the READING sheets, capped at 90dvh) keeps it at its `height`
  (64px) or `phoneHeight` (52px below 600px) instead of squeezing it to its
  content, about 37px. The sheets' rule against shrinking rows doesn't reach
  it, the rating not being a row. `tests/reader-layout.e2e.ts` measures it.
- The pure part (where a finger is, what fills, what the readout says) is in
  `src/lib/library/rating.ts` and tested in `tests/library-domain.spec.ts`.
- The tile's picker is the slider, compact: 44px tall, no label, a narrower
  0 cell.
- Sizes are per device. The phone's apply under 600px by media query, so the server's first paint is already right.

## One number with the catalogues

- **The rating is the score.** AniList and MAL both score out of 10, so there
  is nothing to convert and no reason for two numbers. Setting a rating on a
  linked series sends it as the score (`afterRating` in
  `src/lib/server/tracking.ts`, through the usual queue); 0 clears it.
- **EDIT's sheet on LISTS has no SCORE row.** It sets status only; the note
  says the rating is what both catalogues get.
- **A catalogue's score fills only an unrated series**, once, as it is: 9
  stays 9 (`scoreToRating`; other scales are read as out of 10 first). UNDO
  takes it back. A series already rated keeps its rating.

## The RATED threshold

The slider in mode `min` (filled from the threshold up, no 0 cell, written in
five steps: `minLabel`) is the rating row of the FILTER panel: `?min=8` narrows
any shelf, and a `?shelf=rated4` link redirects to it
([`FILTERS.md`](FILTERS.md)).

## Accessibility

- **`role="group"` of real controls, not `role="slider"`.** Each half is a
  button or a link with its own label (`Rate 7 of 10`, `At least 3.5+`), which
  is what lets the slider work without script and in a plain form. The chosen
  half is `aria-pressed` (a link: `aria-current`). There are no arrow keys; Tab
  walks the halves.
- **The 0 cell carries no `aria-pressed`.** Unrated is said by the label,
  UNRATED.
