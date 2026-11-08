import { describe, expect, it } from 'vitest';
import {
	BAND_SHELVES,
	SHELF_KEY,
	bandChips,
	bandOrder,
	collectionShelves,
	lastShelf,
	otherShelves,
	shelfLine,
	type BandShelf
} from '$lib/library/add-shelf';

/** PUT ON A SHELF in the ADD band (card c724; doc/BROWSE.md, "Shelves in the ADD band"): the band's rules. */

const shelf = (id: number, name = `Shelf ${id}`): BandShelf => ({ id, name });
const ids = (xs: readonly BandShelf[]) => xs.map((s) => s.id);
const many = (n: number) => Array.from({ length: n }, (_, i) => shelf(i + 1));

describe('the shelves offered', () => {
	it('are the library’s collections alone, in its order', () => {
		expect(
			collectionShelves([
				{ key: 'all', name: 'All', kind: 'all' },
				{ key: 'c:7', name: 'Later', kind: 'collection' },
				{ key: 'k:manga', name: 'Manga', kind: 'kind' },
				{ key: 'c:2', name: 'Faves', kind: 'collection' },
				{ key: 'r:3', name: 'Root', kind: 'root' },
				{ key: 'people', name: 'People', kind: 'people' },
				// A collection whose key isn't an id is not one a series can be put on.
				{ key: 'c:x', name: 'Odd', kind: 'collection' }
			])
		).toEqual([shelf(7, 'Later'), shelf(2, 'Faves')]);
		expect(collectionShelves([])).toEqual([]);
	});
});

describe('the last shelf chosen', () => {
	it('is one key of its own', () => {
		expect(SHELF_KEY).toBe('tsundoku:add-shelf');
	});
	it('reads back an id, and nothing else', () => {
		expect(lastShelf('12')).toBe(12);
		for (const v of [
			null,
			undefined,
			'',
			'0',
			'-1',
			'1.5',
			'012',
			'c:1',
			' 1',
			'1e3',
			'99999999999999999'
		])
			expect(lastShelf(v), String(v)).toBeNull();
		// It holds on its own output.
		expect(lastShelf(String(lastShelf('42')))).toBe(42);
	});
	it('goes first; the rest keep the library’s order', () => {
		const xs = many(5);
		expect(ids(bandOrder(xs, 4))).toEqual([4, 1, 2, 3, 5]);
		expect(ids(bandOrder(xs, 1))).toEqual([1, 2, 3, 4, 5]);
		expect(ids(bandOrder(xs, 5))).toEqual([5, 1, 2, 3, 4]);
		// None, or one deleted since: the library's order, nothing stale drawn.
		expect(ids(bandOrder(xs, null))).toEqual([1, 2, 3, 4, 5]);
		expect(ids(bandOrder(xs, 99))).toEqual([1, 2, 3, 4, 5]);
		expect(bandOrder([], 3)).toEqual([]);
		// It never changes what it is given.
		expect(ids(xs)).toEqual([1, 2, 3, 4, 5]);
	});
});

describe('the chips the band holds', () => {
	const none = new Set<number>();
	it('are every shelf up to the limit, and exactly at it', () => {
		expect(BAND_SHELVES).toBe(6);
		expect(bandChips(many(3), none)).toEqual({ chips: many(3), more: 0 });
		expect(bandChips(many(BAND_SHELVES), none)).toEqual({ chips: many(BAND_SHELVES), more: 0 });
		expect(bandChips([], none)).toEqual({ chips: [], more: 0 });
	});
	it('past it, the first ones, and the rest wait in the SHELVES sheet', () => {
		const r = bandChips(many(BAND_SHELVES + 1), none);
		expect(ids(r.chips)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(r.more).toBe(1);
		expect(bandChips(many(20), none).more).toBe(14);
	});
	it('never hide a shelf the series is on: it takes the last place not on one', () => {
		const r = bandChips(many(9), new Set([8]));
		expect(ids(r.chips)).toEqual([1, 2, 3, 4, 5, 8]);
		expect(r.more).toBe(3);
		const two = bandChips(many(9), new Set([2, 9]));
		expect(ids(two.chips)).toEqual([1, 2, 3, 4, 5, 9]);
		expect(two.more).toBe(3);
		// On more shelves past the limit than chips not on one: every one still drawn.
		const all = bandChips(many(8), new Set([1, 2, 3, 4, 5, 6, 7, 8]));
		expect(ids(all.chips).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(all.more).toBe(0);
	});
	it('count every shelf once: drawn or waiting', () => {
		for (const n of [0, 1, 5, 6, 7, 12])
			for (const on of [new Set<number>(), new Set([1]), new Set([n]), new Set([2, n - 1])]) {
				const r = bandChips(many(n), on);
				expect(r.chips.length + r.more, `${n} with ${[...on]}`).toBe(n);
				expect(new Set(ids(r.chips)).size).toBe(r.chips.length);
				for (const id of on) if (id >= 1 && id <= n) expect(ids(r.chips)).toContain(id);
			}
	});
});

describe('the chip for the rest', () => {
	it('counts them, one or many', () => {
		expect(otherShelves(1)).toBe('1 OTHER SHELF');
		expect(otherShelves(3)).toBe('3 OTHER SHELVES');
	});
});

describe('the band’s line', () => {
	it('asks, until the series is on a shelf; then says which', () => {
		const xs = [shelf(1, 'Later'), shelf(2, 'Faves')];
		expect(shelfLine(xs, new Set())).toBe('PUT ON A SHELF:');
		expect(shelfLine(xs, new Set([2]))).toBe('ON FAVES');
		expect(shelfLine(xs, new Set([1, 2]))).toBe('ON LATER, FAVES');
	});
});
