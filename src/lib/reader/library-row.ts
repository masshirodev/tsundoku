/**
 * The end page's library row (c655): which cell it draws, if any.
 *
 * A browsing record is added through BROWSE's own `?/add`; a series in the
 * library is hidden through the series screen's `?/hide`. HIDE is what the
 * series screen and the library's bulk bar call it: the series leaves every
 * shelf but stays in the library (`in_library` stays 1), and `/reveal` brings
 * it back. There is no door here that sets `in_library = 0`, so the cell must
 * not be called REMOVE (round 2's medium).
 *
 * A series in a Work draws neither: `?/hide` refuses a part
 * (`A WORK IS HIDDEN WHOLE · HIDE ALL OR TAKE OUT`, series/[id]/+page.server.ts)
 * and a Work is hidden or taken out whole from its own screen, so a cell here
 * would be a dead button (round 2's medium).
 *
 * The answers this page's own forms have given win, so the row never offers
 * again what it just did: `added`/`hidden`/`unhidden` are its terminal cells.
 *
 * A hidden series is read only under `/reveal`, so its end page must offer the
 * way back rather than HIDE again (c673): `seriesHidden` is the series' own
 * state (`data.series.hidden`), never this page's answer. The two are
 * separate inputs because they mean different things: a stored `hidden` row
 * is true only until the page is left, while `seriesHidden` stays true until
 * the series is shown again.
 */
export type LibraryCell = 'add' | 'hide' | 'unhide' | 'added' | 'hidden' | 'unhidden' | null;

export function libraryCell(state: {
	/** The page loaded it as in the library (`in_library = 1`). */
	inLibrary: boolean;
	/** The series is a part of a Work (the end page's `work`). */
	inWork: boolean;
	/** A browsing record's own `?/add` door is known. */
	hasAddHref: boolean;
	/** The series is hidden, and this page is being read under `/reveal`. */
	seriesHidden: boolean;
	/** This page's ADD has answered. */
	added: boolean;
	/** This page's HIDE has answered. */
	hidden: boolean;
	/** This page's UNHIDE has answered. */
	unhidden: boolean;
}): LibraryCell {
	if (state.hidden) return 'hidden';
	if (state.unhidden) return 'unhidden';
	if (state.added) return 'added';
	if (!state.inLibrary) return state.hasAddHref ? 'add' : null;
	if (state.inWork) return null;
	return state.seriesHidden ? 'unhide' : 'hide';
}
