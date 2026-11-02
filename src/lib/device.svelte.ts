import { MediaQuery } from 'svelte/reactivity';

/**
 * The four layouts the design draws, as media queries. Kept in one place and
 * mirrored exactly by the breakpoints in src/lib/styles/layout.css -- the CSS
 * decides what is drawn, these decide what is rendered at all (two continue
 * rows on a phone, not four hidden ones).
 *
 * "Desktop" is a fine pointer on a wide screen, not a width alone: a tablet in
 * landscape is 1280px wide and still wants the touch layout with no sidebar.
 * "TV" is the opposite: no pointer at all (a remote is a keyboard, not a
 * mouse), on a screen wide enough to be a television rather than a small
 * pointerless browser. `WIDE` excludes it, so a 1280-wide TV is not also wide.
 */
export const PHONE = '(max-width: 599px)';
export const DESKTOP = '(min-width: 1024px) and (pointer: fine)';
export const TV = '(pointer: none) and (min-width: 900px)';
export const WIDE = '(min-width: 1024px) and (not (pointer: none))';

export const phone = new MediaQuery(PHONE, false);
export const desktop = new MediaQuery(DESKTOP, false);
export const tv = new MediaQuery(TV, false);
export const wide = new MediaQuery(WIDE, false);
