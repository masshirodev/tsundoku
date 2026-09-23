import { describe, expect, it } from 'vitest';
import { RATING_OPTIONS, isRated, parseRating, ratingBars } from '$lib/library/rating';
import { likePattern, parseSearch, splitMatch } from '$lib/library/search';
import {
	continueSub,
	count,
	nextSort,
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
		expect(ratingBars(1)).toEqual(['on', 'off', 'off', 'off', 'off']);
		expect(isRated(0)).toBe(false);
		expect(isRated(1)).toBe(true);
	});

	it('fills bars up to the rating', () => {
		expect(ratingBars(4)).toEqual(['on', 'on', 'on', 'on', 'off']);
		expect(ratingBars(5)).toEqual(['on', 'on', 'on', 'on', 'on']);
	});

	it('offers 0 through 5, 0 clearing the rating', () => {
		expect(RATING_OPTIONS).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('parses form values, refusing rather than clamping out-of-range input', () => {
		expect(parseRating('')).toBe(0);
		expect(parseRating(null)).toBeUndefined();
		expect(parseRating('0')).toBe(0);
		expect(parseRating('5')).toBe(5);
		expect(parseRating('6')).toBeUndefined();
		expect(parseRating('-1')).toBeUndefined();
		expect(parseRating('2.5')).toBeUndefined();
		expect(parseRating('four')).toBeUndefined();
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

	it('cycles sorts and falls back to recent', () => {
		expect(nextSort('recent')).toBe('title');
		expect(nextSort('added')).toBe('recent');
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
});
