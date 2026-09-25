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

## AT LEAST (turn 2, then the FILTER panel)

The RATED shelf's threshold, drawn as the slider in mode `min` (filled from
the threshold up, no 0 cell, written in five steps: `minLabel`), shipped with
c67 as an AT LEAST band under the tabs. Since c68 the rating is a row of the
FILTER panel instead, and RATED is no longer a shelf: `?min=8` narrows any
shelf, and an old `?shelf=rated4` link redirects to it
([`FILTERS.md`](FILTERS.md)).

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
4. **The 0 cell carries no `aria-pressed`.** Unrated is said by the label,
   UNRATED, as before.
