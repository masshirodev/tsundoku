import { describe, expect, it } from 'vitest';
import {
	drawnToNote,
	pickedInOrder,
	refreshFacts,
	titlesLine,
	unseenCount,
	workOf,
	type Picked
} from '../src/lib/library/selection';

// The facts SELECT keeps about each series it ticked, so a selection that
// outlives the shelf it was made on still knows what it holds (c698;
// doc/LIBRARY.md, "A selection outlives the shelf").

const pick = (id: number, over: Partial<Picked> = {}): Picked => ({
	id,
	title: `Series ${id}`,
	hue: id * 10,
	addedAt: 1000 + id,
	cover: null,
	kind: 'manga',
	entryCount: 10,
	meta: 'MANGA · 10 CH.',
	work: null,
	inWork: null,
	hidden: false,
	language: null,
	languages: undefined,
	...over
});

const factsOf = (...ps: Picked[]) => new Map(ps.map((p) => [p.id, p]));

describe('pickedInOrder', () => {
	it('keeps the order the ids were selected in, which is GROUP’s BY HAND', () => {
		const facts = factsOf(pick(1), pick(2), pick(3));
		expect(pickedInOrder([3, 1, 2], facts).map((p) => p.id)).toEqual([3, 1, 2]);
	});
	it('leaves out an id the page never drew', () => {
		expect(pickedInOrder([1, 9, 2], factsOf(pick(1), pick(2))).map((p) => p.id)).toEqual([1, 2]);
	});
	it('answers nothing for nothing selected', () => {
		expect(pickedInOrder([], factsOf(pick(1)))).toEqual([]);
	});
});

describe('unseenCount', () => {
	it('counts the ids with no facts, and only those', () => {
		const facts = factsOf(pick(1), pick(2));
		expect(unseenCount([1, 2], facts)).toBe(0);
		expect(unseenCount([1, 7, 8], facts)).toBe(2);
		expect(unseenCount([], facts)).toBe(0);
	});
});

describe('titlesLine', () => {
	const facts = factsOf(pick(1), pick(2), pick(3), pick(4));
	it('names up to three, upper case, in selection order', () => {
		expect(titlesLine([2, 1], facts)).toBe('SERIES 2, SERIES 1');
		expect(titlesLine([3, 2, 1], facts)).toBe('SERIES 3, SERIES 2, SERIES 1');
	});
	it('counts the rest past three, seen or not', () => {
		expect(titlesLine([1, 2, 3, 4], facts)).toBe('SERIES 1, SERIES 2, SERIES 3 AND 1 MORE');
		// An unseen id among the first three is skipped by name and still counted.
		expect(titlesLine([9, 1, 2, 3, 4], facts)).toBe('SERIES 1, SERIES 2, SERIES 3 AND 2 MORE');
	});
	it('counts the unseen beside fewer than three names', () => {
		expect(titlesLine([1, 9], facts)).toBe('SERIES 1 AND 1 MORE');
	});
	it('is empty when no selected series was ever drawn', () => {
		expect(titlesLine([8, 9], facts)).toBe('');
		expect(titlesLine([], facts)).toBe('');
	});
});

describe('workOf', () => {
	const facts = factsOf(pick(1, { work: { id: 5, name: 'Noted' } }), pick(2));
	it('prefers the page’s own answer for a series it draws', () => {
		expect(workOf(1, { '1': { id: 6, name: 'Now' } }, facts)).toEqual({ id: 6, name: 'Now' });
	});
	it('falls back to what was noted for a series out of sight', () => {
		expect(workOf(1, {}, facts)).toEqual({ id: 5, name: 'Noted' });
	});
	it('is none for a series in no Work, or one never seen', () => {
		expect(workOf(2, {}, facts)).toBeNull();
		expect(workOf(9, {}, facts)).toBeNull();
	});
});

describe('refreshFacts', () => {
	it('notes a drawn series once it is selected, and not before', () => {
		const drawn = [pick(1), pick(2)];
		expect(refreshFacts(new Set([2]), new Map(), drawn)).toEqual({ set: [pick(2)], drop: [] });
		expect(refreshFacts(new Set(), new Map(), drawn)).toEqual({ set: [], drop: [] });
	});
	it('keeps the facts of a selected series that is no longer drawn', () => {
		const facts = factsOf(pick(1));
		expect(refreshFacts(new Set([1]), facts, [pick(2)])).toEqual({ set: [], drop: [] });
	});
	it('forgets the facts of a series no longer selected, drawn or not', () => {
		const facts = factsOf(pick(1), pick(2));
		expect(refreshFacts(new Set([2]), facts, [pick(1), pick(2)])).toEqual({ set: [], drop: [1] });
	});
	it('keeps the facts of a row SHOW still lists, unticked or not', () => {
		const facts = factsOf(pick(1), pick(2));
		expect(refreshFacts(new Set([2]), facts, [], new Set([1, 2]))).toEqual({ set: [], drop: [] });
		// Unticked rows are not noted afresh, only kept.
		expect(refreshFacts(new Set([2]), facts, [pick(1, { title: 'New' })], new Set([1]))).toEqual({
			set: [],
			drop: []
		});
		// Once SHOW closes, they go.
		expect(refreshFacts(new Set([2]), facts, [])).toEqual({ set: [], drop: [1] });
	});
	it('writes nothing when what is drawn is what was noted', () => {
		const facts = factsOf(pick(1));
		expect(refreshFacts(new Set([1]), facts, [pick(1)])).toEqual({ set: [], drop: [] });
		// Its own output, applied, changes nothing further.
		const again = refreshFacts(new Set([1]), facts, [{ ...pick(1) }]);
		expect(again).toEqual({ set: [], drop: [] });
	});
	it('refreshes every fact a bulk action reads when it changes on screen', () => {
		const was = pick(1);
		const changes: Partial<Picked>[] = [
			{ title: 'Renamed' },
			{ hue: 1 },
			{ addedAt: 1 },
			{ cover: 4 },
			{ kind: 'novel' },
			{ entryCount: 11 },
			{ meta: 'NOVEL · 1 VOL.' },
			{ work: { id: 3, name: 'W' } },
			{ inWork: 'W' },
			{ hidden: true },
			{ language: 'ja' },
			{ languages: ['en', 'ja'] }
		];
		for (const c of changes) {
			const now = { ...was, ...c };
			expect(refreshFacts(new Set([1]), factsOf(was), [now]), JSON.stringify(c)).toEqual({
				set: [now],
				drop: []
			});
		}
		// A Work renamed, same id.
		const inWork = pick(1, { work: { id: 3, name: 'W' } });
		const renamed = pick(1, { work: { id: 3, name: 'W2' } });
		expect(refreshFacts(new Set([1]), factsOf(inWork), [renamed]).set).toEqual([renamed]);
	});
});

describe('drawnToNote (c740)', () => {
	const counted = () => {
		let calls = 0;
		const drawn = () => {
			calls++;
			return [pick(1), pick(2)];
		};
		return { drawn, calls: () => calls };
	};
	it('never builds the drawn series while SELECT is off', () => {
		const c = counted();
		expect([...drawnToNote(false, new Set(), c.drawn)]).toEqual([]);
		// Off with ids left over (none should be, stopSelecting clears them): still no pass.
		expect([...drawnToNote(false, new Set([1]), c.drawn)]).toEqual([]);
		expect(c.calls()).toBe(0);
	});
	it('never builds them while selecting with nothing ticked', () => {
		const c = counted();
		expect([...drawnToNote(true, new Set(), c.drawn)]).toEqual([]);
		expect(c.calls()).toBe(0);
	});
	it('builds them once per pass while something is ticked', () => {
		const c = counted();
		expect([...drawnToNote(true, new Set([2]), c.drawn)].map((p) => p.id)).toEqual([1, 2]);
		expect(c.calls()).toBe(1);
	});
	it('a skipped pass still forgets what left the selection, and keeps what SHOW holds', () => {
		// The last tick undone in SHOW: nothing selected, 1 held by the open sheet, 2 gone.
		const facts = factsOf(pick(1), pick(2));
		const drawn = drawnToNote(true, new Set(), () => [pick(1), pick(2)]);
		expect(refreshFacts(new Set(), facts, drawn, new Set([1]))).toEqual({ set: [], drop: [2] });
	});
});
