/**
 * The library grid loads a page of cards at a time as it scrolls
 * (doc/LIBRARY.md, "Pages"). About five screens of tiles on the tablet: the
 * first paint carries this many, and each page after it is asked for when the
 * end of the grid comes within a screen or two.
 */
export const GRID_PAGE = 120;

/**
 * A smaller page, from the `tsundoku_grid_page` cookie: only the end-to-end
 * tests set it, so a seed of thirty series still has pages to scroll through.
 */
export function pageSizeOf(cookie: string | undefined): number {
	const n = Number(cookie);
	return Number.isInteger(n) && n >= 1 && n < GRID_PAGE ? n : GRID_PAGE;
}

/** The most one request may ask for: a refresh re-reads every page loaded so far. */
export const GRID_MAX = 10_000;

/** Where the next page, or a refresh of the loaded ones, comes from. */
export function pageQuery(o: {
	shelf: string;
	tag: string | null;
	sort: string;
	/** RANDOM's shuffle. */
	seed?: number;
	offset: number;
	limit: number;
}): string {
	const q = new URLSearchParams({
		shelf: o.shelf,
		sort: o.sort,
		offset: String(o.offset),
		limit: String(o.limit)
	});
	if (o.tag) q.set('tag', o.tag);
	if (o.sort === 'random' && o.seed) q.set('seed', String(o.seed));
	return q.toString();
}
