/**
 * BROWSE's RECENT folds away (doc/BROWSE.md, "RECENT folds"): its
 * label row is a toggle, `HIDE ↑` / `SHOW ↓`, open by default and remembered
 * per device in one localStorage key. The series screen's DETAILS fold
 * (`src/routes/series/[id]/details.ts`) is the idiom; it is closed by default,
 * so its server can draw the default and only an opened device changes after
 * the page runs. RECENT is open by default, and a device that folded it must
 * not see it open and then shut on every load, so the fold is also written on
 * `<html>` before the body is painted (`PREPAINT`), and the stylesheet folds
 * from that.
 */

/** The localStorage key: folded or not, on this device, for BROWSE's RECENT alone. */
export const RECENT_KEY = 'tsundoku:browse-recent';

/** What the key holds while RECENT is folded; open removes it. */
export const FOLDED = 'folded';

/** The stored word, read back: only `folded` folds; anything else (nothing, junk) is the default, open. */
export const recentFolded = (stored: string | null | undefined): boolean => stored === FOLDED;

/** The `<html>` attribute the pre-paint script sets while RECENT is folded (`data-recent-folded`). */
export const PREPAINT_ATTR = 'data-recent-folded';

/**
 * The script BROWSE puts in its `<head>`, run by the browser before the body
 * is parsed on a document load (a reload, a bookmark, a new tab): it marks
 * `<html>` when the device folded RECENT, so the server's open markup is
 * painted folded from the first frame. A client-side navigation never runs it
 * (an inserted script is inert), and needs it not: the page reads the key as
 * it mounts, before that frame is painted. Storage that throws leaves RECENT
 * open, the default.
 */
export const PREPAINT = `try{if(localStorage.getItem(${JSON.stringify(RECENT_KEY)})===${JSON.stringify(FOLDED)})document.documentElement.setAttribute(${JSON.stringify(PREPAINT_ATTR)},'')}catch(e){}`;

/** `PREPAINT` as the `<head>` element BROWSE draws (`{@html}`): kept here, where a closing tag in a string is only a string. */
export const PREPAINT_TAG = `<script>${PREPAINT}</script>`;

/** The label row's right half: what it says, open or folded (`4 RECENT` folded, so it isn't forgotten). */
export function recentRight(folded: boolean, n: number): { text: string; toggle: string } {
	return folded
		? { text: `${n} RECENT`, toggle: 'SHOW ↓' }
		: { text: 'LAST BROWSED', toggle: 'HIDE ↑' };
}
