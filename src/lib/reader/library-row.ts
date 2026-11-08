import { fileMeta } from '$lib/library/series';
import type { SeriesEntry } from '$lib/library/series';

/**
 * What on an end page is its own, so the page does not turn under it (c655):
 * its controls, and DELETE's confirmation, which is drawn inside the page and
 * which a tap at the screen's edge would otherwise pass through to the reader.
 */
export const END_PAGE_CONTROLS = 'a, button, [data-end-sheet]';

/** DELETE's confirmation is up: the keys are its own, not the reader's. */
export const endSheetOpen = () => endSheet() !== null;
const endSheet = () => document.querySelector('[data-end-sheet] [role="dialog"]');

/**
 * Whether a wheel moves the confirmation itself: a sheet taller than the screen
 * with room left that way. Anything else would chain to the page under it.
 */
export function sheetTakesWheel(
	box: Pick<Element, 'scrollTop' | 'clientHeight' | 'scrollHeight'>,
	deltaY: number
): boolean {
	if (deltaY < 0) return box.scrollTop > 0;
	return deltaY > 0 && box.scrollTop + box.clientHeight < box.scrollHeight - 1;
}

/**
 * A wheel while DELETE's confirmation is up is the confirmation's, not the
 * reader's: true when the reader must stand down. Standing down is not enough,
 * because a sheet with nothing to scroll chains the wheel natively to the page
 * under it, so that is refused too. Ctrl stays the browser's zoom, as under
 * every other panel.
 */
export function holdWheelForEndSheet(e: WheelEvent): boolean {
	const open = endSheet();
	if (!open) return false;
	const over = e.target instanceof Element && open.contains(e.target);
	if (!e.ctrlKey && !(over && sheetTakesWheel(open, e.deltaY))) e.preventDefault();
	return true;
}

/** DELETE's confirmation names what goes first (doc/DELETING.md): the series screen's and the end page's line. */
export function entriesLine(entries: SeriesEntry[]): string {
	return `${entries.length} ${entries.length === 1 ? 'ENTRY' : 'ENTRIES'} · ${fileMeta(entries)}`;
}

/**
 * The end page's library row (c655): which cells it draws.
 *
 * A browsing record is added through BROWSE's own `?/add`. A series in the
 * library is taken out through the series screen's own DELETE (the owner's
 * decision of 2026-11-07, on c655): `in_library` is not a flag over files
 * here, so taking a series out is deleting it, and the end page asks with the
 * series screen's own confirmation first.
 *
 * A part of a Work draws DELETE too, as the series screen does: the series
 * goes, the Work carries on with its other parts, and a Work left with one
 * ends (the trigger `series_deleted_ends_work`, `db.ts`).
 *
 * A hidden series is read only under `/reveal`, and its end page keeps UNHIDE
 * beside DELETE (c673): that is the series' own state (`seriesHidden`,
 * `data.series.hidden`), never this page's answer. A part draws no UNHIDE: a
 * Work is hidden whole, from its own screen (`?/hide` refuses a part).
 *
 * The answers this page's own forms have given win, so the row never offers
 * again what it just did: `added` and `unhidden` are terminal cells.
 *
 * Incognito changes nothing here: it keeps reading out of the log, and none
 * of these writes reading (doc/PRIVACY.md).
 */
export type LibraryCell = 'add' | 'added' | 'delete' | null;
export type UnhideCell = 'unhide' | 'unhidden' | null;

export function libraryCells(state: {
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
	/** This page's UNHIDE has answered. */
	unhidden: boolean;
}): { cell: LibraryCell; unhide: UnhideCell } {
	if (!state.inLibrary) {
		const cell = state.added ? 'added' : state.hasAddHref ? 'add' : null;
		return { cell, unhide: null };
	}
	if (state.inWork || !state.seriesHidden) return { cell: 'delete', unhide: null };
	return { cell: 'delete', unhide: state.unhidden ? 'unhidden' : 'unhide' };
}
