import { MediaQuery } from 'svelte/reactivity';

/**
 * The four layouts the design draws, as media queries. Kept in one place and
 * mirrored exactly by the breakpoints in src/lib/styles/layout.css -- the CSS
 * decides what is drawn, these decide what is rendered at all (two continue
 * rows on a phone, not four hidden ones).
 *
 * "Desktop" is a fine pointer on a wide screen, not a width alone: a tablet in
 * landscape is 1280px wide and still wants the touch layout with no sidebar.
 */
export const PHONE = '(max-width: 599px)';
export const DESKTOP = '(min-width: 1024px) and (pointer: fine)';
export const WIDE = '(min-width: 1024px)';

export const phone = new MediaQuery(PHONE, false);
export const desktop = new MediaQuery(DESKTOP, false);
export const wide = new MediaQuery(WIDE, false);
