import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MIN,
	halfOn,
	isRated,
	minLabel,
	parseMin,
	withMin,
	parseRating,
	ratingBars,
	ratingText,
	readout,
	valueAt
} from '$lib/library/rating';
import { likePattern, parseSearch, splitMatch } from '$lib/library/search';
import {
	continueSub,
	count,
	nextSort,
	parseSeed,
	parseSort,
	percent,
	progress,
	sheetMeta
} from '$lib/library/labels';
import { coverPlaceholder, hueFor } from '$lib/library/cover';
import type { ContinueItem, SeriesCard } from '$lib/library/types';

const card = (over: Partial<SeriesCard> = {}): SeriesCard => ({
	cover: null,
	id: 1,
	title: 'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
	kind: 'manga',
	rating: 4,
	favourite: true,
	hidden: false,
	newCount: 3,
	entryCount: 58,
	readCount: 41,
	hue: 30,
	indexed: true,
	addedAt: 0,
	...over
});

describe('rating', () => {
	// 0 is unrated (the owner's scale): it draws no track at all, so it never
	// looks like a series someone rated low.
	it('draws unrated (0) with no track and a rated series with its track', () => {
		expect(ratingBars(0)).toEqual(['none', 'none', 'none', 'none', 'none']);
		expect(ratingBars(2)).toEqual(['on', 'off', 'off', 'off', 'off']);
		expect(isRated(0)).toBe(false);
		expect(isRated(1)).toBe(true);
	});

	it('fills bars up to the rating out of 10, a half the left half of a bar (1e)', () => {
		expect(ratingBars(8)).toEqual(['on', 'on', 'on', 'on', 'off']);
		expect(ratingBars(7)).toEqual(['on', 'on', 'on', 'half', 'off']);
		expect(ratingBars(1)).toEqual(['half', 'off', 'off', 'off', 'off']);
		expect(ratingBars(10)).toEqual(['on', 'on', 'on', 'on', 'on']);
	});

	it('writes a rating out as the stored number out of 10 (1f)', () => {
		expect(ratingText(7)).toBe('7 OF 10');
		expect(ratingText(0)).toBe('UNRATED');
	});

	it('parses form values 0-10, refusing rather than clamping out-of-range input', () => {
		expect(parseRating('')).toBe(0);
		expect(parseRating(null)).toBeUndefined();
		expect(parseRating('0')).toBe(0);
		expect(parseRating('7')).toBe(7);
		expect(parseRating('10')).toBe(10);
		expect(parseRating('11')).toBeUndefined();
		expect(parseRating('-1')).toBeUndefined();
		expect(parseRating('2.5')).toBeUndefined();
		expect(parseRating('four')).toBeUndefined();
	});
});

describe('the blocky slider (Ratings out of 10)', () => {
	it('snaps a finger to one of ten halves, off the left end clearing', () => {
		expect(valueAt(0.1, 500)).toBe(1);
		expect(valueAt(349, 500)).toBe(7);
		expect(valueAt(351, 500)).toBe(8);
		expect(valueAt(600, 500)).toBe(10);
		expect(valueAt(-10, 500)).toBe(0);
		// A threshold never includes unrated: off the left end is still 1.
		expect(valueAt(-10, 500, 'min')).toBe(1);
	});

	it('fills up to a rating, and from a threshold up', () => {
		expect([...Array(10).keys()].filter((i) => halfOn(i, 7))).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect([...Array(10).keys()].filter((i) => halfOn(i, 7, 'min'))).toEqual([6, 7, 8, 9]);
		expect([...Array(10).keys()].filter((i) => halfOn(i, 0, 'min'))).toEqual([]);
	});

	it('reads out the value in five steps while dragging (1b, turn 2)', () => {
		expect(readout(7)).toEqual({ num: '7', sub: '3½ OF 5' });
		expect(readout(8)).toEqual({ num: '8', sub: '4 OF 5' });
		expect(readout(0)).toEqual({ num: '0', sub: 'UNRATED' });
		expect(readout(7, 'min')).toEqual({ num: '3.5+', sub: '7–10' });
	});

	it('names a threshold in five steps, 4+ by default', () => {
		expect(minLabel(8)).toBe('4+');
		expect(minLabel(7)).toBe('3.5+');
		expect(DEFAULT_MIN).toBe(8);
		expect(parseMin('7')).toBe(7);
		expect(parseMin(null)).toBe(8);
		expect(parseMin('0')).toBe(8);
		expect(parseMin('11')).toBe(8);
		expect(parseMin('')).toBe(8);
	});
});

describe('search input', () => {
	it('treats the exact slash commands as commands', () => {
		expect(parseSearch('/reveal')).toEqual({ type: 'command', command: 'reveal' });
		expect(parseSearch('  /REVEAL ')).toEqual({ type: 'command', command: 'reveal' });
		expect(parseSearch('/hide')).toEqual({ type: 'command', command: 'hide' });
		expect(parseSearch('/light')).toEqual({ type: 'command', command: 'light' });
	});

	// Reveal must not be one accidental keystroke away: without the slash, or
	// with anything else around it, it is an ordinary query.
	it('does not reveal on anything but the exact command', () => {
		expect(parseSearch('reveal')).toEqual({ type: 'query', text: 'reveal' });
		expect(parseSearch('/reveal all')).toEqual({ type: 'query', text: '/reveal all' });
		expect(parseSearch('/revea')).toEqual({ type: 'query', text: '/revea' });
	});

	it('reports empty input as empty', () => {
		expect(parseSearch('   ')).toEqual({ type: 'empty' });
	});

	it('splits a title around the match without changing its casing', () => {
		expect(splitMatch('Isekai Ojisan', 'isekai')).toEqual({
			pre: '',
			mid: 'Isekai',
			post: ' Ojisan'
		});
		expect(
			splitMatch('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'ISEKAI').mid
		).toBe('Isekai');
		expect(splitMatch('Lookism', 'isekai')).toEqual({ pre: 'Lookism', mid: '', post: '' });
	});

	it('escapes LIKE wildcards in a query', () => {
		expect(likePattern('100%_done\\')).toBe('%100\\%\\_done\\\\%');
	});
});

describe('labels', () => {
	it('groups counts and never abbreviates them', () => {
		expect(count(1284)).toBe('1,284');
		expect(count(0)).toBe('0');
	});

	it('computes progress from entries, and zero for an empty series', () => {
		expect(percent(progress(card({ entryCount: 58, readCount: 41 })))).toBe('71%');
		expect(progress(card({ entryCount: 0, readCount: 0 }))).toBe(0);
	});

	it('describes a continue row online and offline', () => {
		const item: ContinueItem = {
			...card({ kind: 'manhwa', entryCount: 243 }),
			entryLabel: 'Ch. 214',
			lastReadAt: 0,
			resumeId: null
		};
		expect(continueSub(item)).toBe('MANHWA · Ch. 214 of 243');
		expect(continueSub(item, { cached: true })).toBe('MANHWA · Ch. 214 of 243 · CACHED');
		expect(continueSub(item, { cached: false })).toBe('MANHWA · NOT CACHED');
	});

	it('counts books in a series of books, and nothing for a single book', () => {
		const book = (entryCount: number, entryLabel: string): ContinueItem => ({
			...card({ kind: 'doujin', entryCount }),
			entryLabel,
			lastReadAt: 0,
			resumeId: null
		});
		expect(continueSub(book(4, 'Book 3'))).toBe('DOUJIN · Book 3 of 4');
		expect(continueSub(book(1, 'Book'))).toBe('DOUJIN');
		expect(continueSub(book(1, 'Book'), { cached: true })).toBe('DOUJIN · CACHED');
	});

	it('writes the sheet meta line in the design voice', () => {
		expect(sheetMeta(card())).toBe('MANGA · 58 CH · 41 READ · +3 NEW');
		expect(sheetMeta(card({ kind: 'novel', entryCount: 26, readCount: 12, newCount: 0 }))).toBe(
			'NOVEL · 26 VOL · 12 READ'
		);
	});

	it("reads RANDOM's seed as a whole number, or 1", () => {
		expect(parseSeed('4242')).toBe(4242);
		expect(parseSeed('1; DROP TABLE series')).toBe(1);
		expect(parseSeed('-3')).toBe(1);
		expect(parseSeed(null)).toBe(1);
		expect(parseSeed(String(2 ** 31))).toBe(1);
	});

	it('cycles sorts and falls back to recent', () => {
		expect(nextSort('recent')).toBe('title');
		expect(nextSort('added')).toBe('random');
		expect(nextSort('random')).toBe('recent');
		expect(parseSort('random')).toBe('random');
		expect(parseSort('nonsense')).toBe('recent');
		expect(parseSort(null)).toBe('recent');
	});
});

describe('cover placeholder', () => {
	it('is tinted by the theme tokens, not by fixed colours', () => {
		const bg = coverPlaceholder(125);
		expect(bg).toContain('var(--cover-l)');
		expect(bg).toContain('var(--cover-c)');
		expect(bg).toContain(' 125)');
	});

	it('gives a title the same hue every time', () => {
		expect(hueFor('Dungeon Meshi')).toBe(hueFor('Dungeon Meshi'));
		expect(hueFor('Dungeon Meshi')).toBeGreaterThanOrEqual(0);
		expect(hueFor('Dungeon Meshi')).toBeLessThan(360);
	});
});

describe('shelf links', () => {
	it('name ALL, so it never falls through to NEW while an import band is up', async () => {
		const { shelfHref } = await import('$lib/library/links');
		expect(shelfHref(new URL('https://x/?shelf=new&sort=title'), 'all')).toBe(
			'/?shelf=all&sort=title'
		);
		expect(shelfHref(new URL('https://x/'), 'rated4')).toBe('/?shelf=rated4');
	});

	it('keep RATED’s threshold only while staying on RATED (c67)', async () => {
		const { shelfHref, minHref } = await import('$lib/library/links');
		const on = new URL('https://x/?shelf=rated4&min=7&sort=title');
		expect(shelfHref(on, 'rated4')).toBe('/?shelf=rated4&sort=title&min=7');
		expect(shelfHref(on, 'all')).toBe('/?shelf=all&sort=title');
		expect(minHref(on, 5)).toBe('/?shelf=rated4&min=5&sort=title');
		expect(minHref(new URL('https://x/?shelf=all'), 9)).toBe('/?shelf=rated4&min=9');
	});
});

describe('RATED at a threshold (c67, turn 2)', () => {
	const shelves = [
		{ key: 'all', name: 'All', count: 40 },
		{ key: 'rated4', name: 'Rated 4+', count: 12 }
	];

	it('leaves the list alone at the default', () => {
		expect(withMin(shelves, 8)).toBe(shelves);
	});

	it('renames RATED in its own five steps, and takes the count the grid shows', () => {
		expect(withMin(shelves, 7, 15)[1]).toEqual({ key: 'rated4', name: 'Rated 3.5+', count: 15 });
		expect(withMin(shelves, 7)[1].count).toBe(12);
		expect(withMin(shelves, 7, 15)[0]).toBe(shelves[0]);
	});

	it('asks the next page for the same threshold, and only on RATED', async () => {
		const { pageQuery } = await import('$lib/library/paging');
		const q = (shelf: string) =>
			new URLSearchParams(
				pageQuery({ shelf, tag: null, sort: 'title', min: 7, offset: 0, limit: 60 })
			);
		expect(q('rated4').get('min')).toBe('7');
		expect(q('all').get('min')).toBeNull();
	});
});
