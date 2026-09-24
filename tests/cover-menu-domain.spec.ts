import { describe, expect, it } from 'vitest';
import { bandFor, menuRows, type BookCover, type SeriesCover } from '$lib/library/cover-menu';

const labelOf = (id: number) => `Ch. ${id}`;
const auto: BookCover = { coverPage: null, hasFile: false };
const site: SeriesCover = { chosen: null, automatic: 'url' };

describe('the page menu’s rows', () => {
	it('a book in a series of books: BOOK and SERIES, each saying where its cover comes from', () => {
		const rows = menuRows({ kind: 'book', entry: 3, page: 13, book: auto, series: site, labelOf });
		expect(rows.map((r) => [r.label, r.line, r.action])).toEqual([
			['BOOK', 'NOW P. 1 · AUTOMATIC', 'SET AS BOOK COVER'],
			['SERIES', 'NOW FROM THE SOURCE SITE', 'SET AS SERIES COVER']
		]);
	});
	it('a chapter of a manga: SERIES only', () => {
		const rows = menuRows({
			kind: 'series',
			entry: 88,
			page: 13,
			book: auto,
			series: site,
			labelOf
		});
		expect(rows.map((r) => r.label)).toEqual(['SERIES']);
	});
	it('a single doujin: one COVER row', () => {
		const rows = menuRows({ kind: 'single', entry: 1, page: 2, book: auto, series: site, labelOf });
		expect(rows).toMatchObject([
			{ label: 'COVER', line: 'NOW P. 1 · AUTOMATIC', action: 'SET AS COVER' }
		]);
	});
	it('this page already the cover: ✓ and the way back, naming what automatic would give', () => {
		const rows = menuRows({
			kind: 'book',
			entry: 3,
			page: 13,
			book: { coverPage: 13, hasFile: false },
			series: site,
			labelOf
		});
		expect(rows[0]).toMatchObject({
			isThis: true,
			line: 'AUTOMATIC WOULD BE P. 1',
			action: 'BACK TO AUTOMATIC'
		});
		expect(rows[1].isThis).toBe(false);
	});
	it('another page chosen: NOW P. 3 · CHOSEN, and a chosen series page names its chapter', () => {
		const rows = menuRows({
			kind: 'book',
			entry: 3,
			page: 13,
			book: { coverPage: 2, hasFile: true },
			series: { chosen: { entry: 7, page: 4 }, automatic: 'book' },
			labelOf
		});
		expect(rows.map((r) => r.line)).toEqual(['NOW P. 3 · CHOSEN', 'NOW CH. 7 · P. 5 · CHOSEN']);
	});
});

describe('the band after a choice', () => {
	it('names what was chosen and what it was', () => {
		const [row] = menuRows({ kind: 'book', entry: 3, page: 13, book: auto, series: site, labelOf });
		expect(bandFor(row, 13, 'Summer Afternoon')).toEqual({
			title: 'BOOK COVER · P. 14',
			detail: 'SUMMER AFTERNOON · WAS P. 1, AUTOMATIC'
		});
	});
	it('back to automatic says what automatic gives', () => {
		const [row] = menuRows({
			kind: 'book',
			entry: 3,
			page: 13,
			book: { coverPage: 13, hasFile: false },
			series: site,
			labelOf
		});
		expect(bandFor(row, 13, 'Summer Afternoon').title).toBe('BOOK COVER · AUTOMATIC, P. 1');
	});
});
