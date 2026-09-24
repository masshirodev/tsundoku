/**
 * The page menu's rows (Page Menu, card c26; doc/COVERS.md, "Chosen"). Pure:
 * the reader and the PAGES grid draw from these, and say where each cover
 * comes from now, so the choice is an informed one.
 */

/** What the pressed page can become: a single doujin is one tile; a book in a series is two; a chapter is the series'. */
export type MenuKind = 'single' | 'book' | 'series';
export type Target = 'cover' | 'book' | 'series';

/** Where a series' cover comes from without a chosen page (`automaticCover`). */
export type Automatic = 'book' | 'file' | 'url' | 'page' | 'none';

export type BookCover = { coverPage: number | null; hasFile: boolean };
export type SeriesCover = {
	chosen: { entry: number; page: number } | null;
	automatic: Automatic;
};

export type MenuRow = {
	target: Target;
	/** The label cell: BOOK, SERIES, COVER. */
	label: string;
	/** This page is already what the row sets. */
	isThis: boolean;
	/** "NOW P. 1 · AUTOMATIC", or, when it's this page, "AUTOMATIC WOULD BE P. 1". */
	line: string;
	/** The button: SET AS BOOK COVER, or BACK TO AUTOMATIC. */
	action: string;
};

const pageName = (page: number) => `P. ${page + 1}`;

export const bookNow = (b: BookCover) =>
	b.coverPage !== null
		? `${pageName(b.coverPage)} · CHOSEN`
		: b.hasFile
			? 'FROM THE FILES · AUTOMATIC'
			: 'P. 1 · AUTOMATIC';
export const bookAutomatic = (b: BookCover) => (b.hasFile ? 'THE FILES’ COVER' : 'P. 1');

const AUTO: Record<Automatic, string> = {
	book: 'THE FIRST BOOK’S COVER',
	file: 'THE FILES’ COVER',
	url: 'THE SOURCE SITE’S',
	page: 'P. 1',
	none: 'NO COVER'
};
const AUTO_NOW: Record<Automatic, string> = {
	book: 'FROM THE FIRST BOOK',
	file: 'FROM THE FILES',
	url: 'FROM THE SOURCE SITE',
	page: 'P. 1 · AUTOMATIC',
	none: 'NONE YET'
};

/** A chosen series cover names its chapter when it isn't the one pressed in. */
export function seriesNow(s: SeriesCover, entry: number, labelOf: (id: number) => string): string {
	if (!s.chosen) return AUTO_NOW[s.automatic];
	const where = s.chosen.entry === entry ? '' : `${labelOf(s.chosen.entry).toUpperCase()} · `;
	return `${where}${pageName(s.chosen.page)} · CHOSEN`;
}
export const seriesAutomatic = (s: SeriesCover) => AUTO[s.automatic];

/** The rows for page `page` (0-based) of entry `entry`. */
export function menuRows(o: {
	kind: MenuKind;
	entry: number;
	page: number;
	book: BookCover;
	series: SeriesCover;
	labelOf: (id: number) => string;
}): MenuRow[] {
	const bookIsThis = o.book.coverPage === o.page;
	const seriesIsThis = o.series.chosen?.entry === o.entry && o.series.chosen.page === o.page;
	const book = (): MenuRow => ({
		target: 'book',
		label: 'BOOK',
		isThis: bookIsThis,
		line: bookIsThis ? `AUTOMATIC WOULD BE ${bookAutomatic(o.book)}` : `NOW ${bookNow(o.book)}`,
		action: bookIsThis ? 'BACK TO AUTOMATIC' : 'SET AS BOOK COVER'
	});
	const series = (): MenuRow => ({
		target: 'series',
		label: 'SERIES',
		isThis: seriesIsThis,
		line: seriesIsThis
			? `AUTOMATIC WOULD BE ${seriesAutomatic(o.series)}`
			: `NOW ${seriesNow(o.series, o.entry, o.labelOf)}`,
		action: seriesIsThis ? 'BACK TO AUTOMATIC' : 'SET AS SERIES COVER'
	});
	if (o.kind === 'series') return [series()];
	if (o.kind === 'book') return [book(), series()];
	// A single doujin: the book and its series are one tile, one row.
	return [
		{
			target: 'cover',
			label: 'COVER',
			isThis: seriesIsThis,
			line: seriesIsThis
				? `AUTOMATIC WOULD BE ${bookAutomatic(o.book)}`
				: `NOW ${o.series.chosen ? seriesNow(o.series, o.entry, o.labelOf) : bookNow(o.book)}`,
			action: seriesIsThis ? 'BACK TO AUTOMATIC' : 'SET AS COVER'
		}
	];
}

/** The band after a choice: "BOOK COVER · P. 14" / "SUMMER AFTERNOON · WAS P. 1, AUTOMATIC". */
export function bandFor(
	row: MenuRow,
	page: number,
	title: string
): { title: string; detail: string } {
	const what =
		row.target === 'book' ? 'BOOK COVER' : row.target === 'series' ? 'SERIES COVER' : 'COVER';
	const was = row.line.replace(/^NOW /, '').replace(' · ', ', ');
	if (row.isThis)
		return {
			title: `${what} · AUTOMATIC, ${row.line.replace(/^AUTOMATIC WOULD BE /, '')}`,
			detail: `${title.toUpperCase()} · WAS ${pageName(page)}`
		};
	return { title: `${what} · ${pageName(page)}`, detail: `${title.toUpperCase()} · WAS ${was}` };
}
