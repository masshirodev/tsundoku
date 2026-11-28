import { describe, expect, it } from 'vitest';
import { LAST_BROWSED, planAsks } from '../src/lib/library/search-asks';

const src = (id: string) => ({ id });
const manga = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map(src);
const ids = (xs: { id: string }[]) => xs.map((s) => s.id);

describe('which sources a search asks first (c1142)', () => {
	it('asks the pinned of the kind, in their usual order, and counts the rest', () => {
		const p = planAsks(manga, new Set(['m5', 'm2', 'a1']), ['m1'], new Set(), false);
		expect(p.mode).toBe('pinned');
		expect(ids(p.first)).toEqual(['m2', 'm5']);
		expect(ids(p.rest)).toEqual(['m1', 'm3', 'm4', 'm6']);
		expect(p.band).toBeNull();
		expect(p.offer).toBeNull();
	});

	it('asks the rest too when asked to, keeping the pinned first', () => {
		const p = planAsks(manga, new Set(['m2']), [], new Set(), true);
		expect(p.askRest).toBe(true);
		expect(ids(p.first)).toEqual(['m2']);
		expect(ids(p.rest)).toEqual(['m1', 'm3', 'm4', 'm5', 'm6']);
	});

	it('with nothing pinned, asks the last browsed of the kind, most recent first, at most four', () => {
		const recent = ['a9', 'm6', 'm1', 'x', 'm3', 'm4', 'm2'];
		const p = planAsks(manga, new Set(), recent, new Set(['m3']), false);
		expect(p.mode).toBe('recent');
		expect(p.band).toBe('nothing-pinned');
		expect(ids(p.first)).toEqual(['m6', 'm1', 'm3', 'm4']);
		expect(p.first).toHaveLength(LAST_BROWSED);
		expect(ids(p.rest)).toEqual(['m2', 'm5']);
		// Offered once, in the band: the sources the library reads from.
		expect(p.offer).toBe('read-from');
		expect(ids(p.offered)).toEqual(['m3']);
	});

	it('with nothing pinned and nothing read from, offers the ones that find it', () => {
		const p = planAsks(manga, new Set(), ['m1'], new Set(), false);
		expect(p.band).toBe('nothing-pinned');
		expect(p.offer).toBe('found');
		expect(ids(p.offered)).toEqual(['m1']);
	});

	it('with nothing pinned or browsed, asks every one, and offers the ones that find it', () => {
		const p = planAsks(manga, new Set(), ['a1'], new Set(['m2']), false);
		expect(p.mode).toBe('all');
		expect(p.band).toBe('nothing-browsed');
		expect(ids(p.first)).toEqual(ids(manga));
		expect(p.rest).toEqual([]);
		expect(p.offer).toBe('found');
	});

	it('a kind with none pinned, while others are: its last browsed, else every one of it', () => {
		const pinnedElsewhere = new Set(['a1']);
		const browsed = planAsks(manga, pinnedElsewhere, ['m4'], new Set(), false);
		expect(browsed.band).toBe('kind-none-pinned');
		expect(ids(browsed.first)).toEqual(['m4']);
		const none = planAsks(manga, pinnedElsewhere, [], new Set(['m2']), false);
		expect(none.band).toBe('kind-none-pinned');
		expect(none.mode).toBe('all');
		expect(ids(none.first)).toEqual(ids(manga));
		expect(none.offer).toBe('read-from');
		expect(ids(none.offered)).toEqual(['m2']);
	});

	it('with no sources at all, asks nothing and says nothing is pinned or browsed', () => {
		const p = planAsks([], new Set(), [], new Set(), false);
		expect(p.first).toEqual([]);
		expect(p.rest).toEqual([]);
		expect(p.band).toBe('nothing-browsed');
	});
});
