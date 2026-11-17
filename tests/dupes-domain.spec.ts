import { describe, expect, it } from 'vitest';
import {
	candidatePairs,
	carryOver,
	confidence,
	distance,
	kindOf,
	matchPages,
	pageList,
	pairKey,
	pick,
	sameBook,
	usable,
	type Copy
} from '$lib/library/dupes';

/** A hash `bits` bits away from `base` (the low bits flipped). */
const near = (base: string, bits: number) => {
	const lo = parseInt(base.slice(8), 16) ^ (2 ** bits - 1);
	return base.slice(0, 8) + (lo >>> 0).toString(16).padStart(8, '0');
};
const H = '5a3c96e1c3a50f78';

const copy = (o: Partial<Copy>): Copy => ({
	entryId: 1,
	seriesId: 1,
	title: 'Summer Rain, Afterwards',
	site: 'nhentai',
	language: 'english',
	pages: 24,
	width: 1280,
	height: 1810,
	addedAt: Date.UTC(2023, 5, 11),
	rating: 0,
	favourite: false,
	read: null,
	shelves: [],
	series: null,
	hidden: false,
	...o
});

describe('hashes', () => {
	it('counts the bits two hashes differ in', () => {
		expect(distance(H, H)).toBe(0);
		expect(distance(H, near(H, 5))).toBe(5);
		expect(distance('0000000000000000', 'ffffffffffffffff')).toBe(64);
	});
	it('leaves out blank covers, whose hash matches every other blank', () => {
		expect(usable('8000000000000000')).toBe(false);
		expect(usable('0000000000000000')).toBe(false);
		expect(usable('ffffffffffffffff')).toBe(false);
		expect(usable(H)).toBe(true);
		expect(usable(null)).toBe(false);
		expect(usable('xyz')).toBe(false);
	});
});

describe('candidate pairs', () => {
	const books = [
		{ entryId: 1, seriesId: 1, hash: H },
		{ entryId: 2, seriesId: 2, hash: near(H, 3) },
		{ entryId: 3, seriesId: 3, hash: near(H, 12) },
		{ entryId: 4, seriesId: 1, hash: near(H, 1) },
		{ entryId: 5, seriesId: 5, hash: '8000000000000000' },
		{ entryId: 6, seriesId: 6, hash: '8000000000000000' }
	];
	it('pairs covers within 8 bits, closest first, never two books of one series or two blanks', () => {
		expect(candidatePairs(books, new Set())).toEqual([
			{ a: 2, b: 4, bits: 2 },
			{ a: 1, b: 2, bits: 3 }
		]);
	});
	it('leaves out a pair already settled, whichever way round', () => {
		expect(candidatePairs(books, new Set([pairKey(2, 1)])).map((p) => pairKey(p.a, p.b))).toEqual([
			'2,4'
		]);
	});
});

describe('pages, lined up', () => {
	/** Distinct pages: hashes from a small generator, far apart from each other. */
	const pages = (n: number) => {
		let x = 0x9e3779b9;
		const next = () => ((x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0), x);
		return Array.from({ length: n }, () =>
			[next(), next()].map((v) => v.toString(16).padStart(8, '0')).join('')
		);
	};
	const A = pages(6);
	it('matches the same pages in order', () => {
		expect(matchPages(A, [...A]).every((r) => r.a === r.b)).toBe(true);
	});
	it('shows a page one copy lacks, and a credits page one added, where they fall', () => {
		const B = ['0123456789abcdef', ...A.slice(0, 2), ...A.slice(4)];
		const rows = matchPages(A, B);
		expect(rows.filter((r) => r.a && r.b)).toHaveLength(4);
		expect(rows.filter((r) => r.a && !r.b).map((r) => r.a)).toEqual([3, 4]);
		expect(rows.filter((r) => r.b && !r.a).map((r) => r.b)).toEqual([1]);
		expect(rows.find((r) => r.a === 5)).toEqual({ a: 5, b: 4 });
	});
	it('names pages as runs', () => {
		expect(pageList([12, 13])).toBe('P 12–13');
		expect(pageList([4, 9, 10, 11])).toBe('P 4, 9–11');
	});
});

describe('the pick', () => {
	const same = (n: number) => Array.from({ length: n }, (_, i) => ({ a: i + 1, b: i + 1 }));
	const credits = [{ a: null, b: 1 }, ...same(24).map((r) => ({ a: r.a, b: r.b + 1 }))];
	it('1: far more pages win, however sharp the other', () => {
		const rows = [...same(30), ...Array.from({ length: 66 }, (_, i) => ({ a: null, b: 31 + i }))];
		const p = pick(
			copy({ pages: 30, width: 1600, height: 2263 }),
			copy({ pages: 96, width: 900, height: 1273 }),
			rows
		);
		expect(p).toMatchObject({ keep: 'b', rule: 1, ruleName: 'COMPLETE OVER PARTIAL' });
		expect(p.why).toBe('MORE PAGES · A IS MISSING P 31–96');
	});
	it('2: sharper wins over a page or two more', () => {
		const p = pick(copy({ width: 1600, height: 2263 }), copy({ pages: 25 }), credits);
		expect(p).toMatchObject({
			keep: 'a',
			rule: 2,
			why: 'SHARPER · A IS 1600 × 2263, B IS 1280 × 1810'
		});
	});
	it('3: a few more pages, when the pages are as sharp', () => {
		const rows = [...same(11), { a: 12, b: null }, { a: 13, b: null }, { a: null, b: 12 }];
		const p = pick(copy({}), copy({ pages: 23 }), rows);
		expect(p).toMatchObject({ keep: 'a', rule: 3, why: 'MORE PAGES · B IS MISSING P 12–13' });
	});
	it('4: the one the user read, rated or shelved', () => {
		const p = pick(copy({}), copy({ rating: 3, read: 'read' }), same(24));
		expect(p).toMatchObject({ keep: 'b', rule: 4 });
	});
	it('5: the one downloaded first', () => {
		const p = pick(
			copy({ addedAt: Date.UTC(2024, 1, 3) }),
			copy({ addedAt: Date.UTC(2023, 5, 11) }),
			same(24)
		);
		expect(p).toMatchObject({ keep: 'b', rule: 5, why: 'DOWNLOADED FIRST · 2023-06-11' });
	});
});

describe('the rest', () => {
	it('a book in another language is a fold, not a duplicate', () => {
		expect(kindOf(copy({}), copy({ language: 'japanese' }))).toBe('fold');
		expect(confidence(copy({}), copy({ language: 'japanese' }))).toBe('lang');
		expect(kindOf(copy({}), copy({ language: '' }))).toBe('dup');
	});
	it('likely when the lengths agree, maybe when they do not', () => {
		expect(confidence(copy({ pages: 24 }), copy({ pages: 23 }))).toBe('likely');
		expect(confidence(copy({ pages: 30 }), copy({ pages: 96 }))).toBe('maybe');
	});
	it('the kept copy takes over what the other had more of', () => {
		const lose = copy({
			rating: 3,
			favourite: true,
			read: 'read',
			shelves: ['Weekend'],
			series: { id: 9, title: 'Night Shift', position: 1 }
		});
		expect(carryOver(copy({}), lose)).toEqual([
			'RATING 3',
			'FAV',
			'READ',
			'SHELF WEEKEND',
			'PLACE IN NIGHT SHIFT'
		]);
		expect(carryOver(copy({ read: 18 }), copy({ read: 4 }))).toEqual([]);
		expect(carryOver(copy({ read: 4 }), copy({ read: 18 }))).toEqual(['READ TO P 18']);
	});
});

describe('same book, or just alike covers', () => {
	const rows = (matched: number, alone: number) => [
		...Array.from({ length: matched }, (_, i) => ({ a: i + 1, b: i + 1 })),
		...Array.from({ length: alone }, (_, i) => ({ a: matched + i + 1, b: null }))
	];
	it('needs half the shorter book’s pages to match', () => {
		expect(sameBook(rows(12, 12), 24, 24)).toBe(true);
		expect(sameBook(rows(3, 21), 24, 24)).toBe(false);
	});
	it('keeps a volume inside its collection', () => {
		expect(sameBook(rows(30, 66), 96, 30)).toBe(true);
	});
});
