import { describe, expect, it } from 'vitest';
import {
	automaticScanlator,
	mergedState,
	representative,
	type Copy
} from '$lib/library/duplicates';

const copy = (id: number, o: Partial<Copy> = {}): Copy => ({
	id,
	available: false,
	scanlator: '',
	readAt: null,
	lastOpenedAt: null,
	lastPosition: null,
	...o
});

describe('automaticScanlator', () => {
	it('prefers whoever has the most chapters on disk', () => {
		const copies = [
			{ scanlator: 'Asura', available: false },
			{ scanlator: 'Asura', available: false },
			{ scanlator: 'Flame', available: true }
		];
		expect(automaticScanlator(copies)).toBe('Flame');
	});

	it('falls back to the most chapters at all, and breaks ties alphabetically', () => {
		expect(
			automaticScanlator([
				{ scanlator: 'Zeta', available: false },
				{ scanlator: 'Alpha', available: false },
				{ scanlator: '', available: false }
			])
		).toBe('Alpha');
		expect(automaticScanlator([{ scanlator: '', available: true }])).toBe('');
	});
});

describe('representative', () => {
	it('is a copy you can open, before the preferred scanlator', () => {
		const a = copy(1, { scanlator: 'Asura' });
		const b = copy(2, { scanlator: 'Flame', available: true });
		expect(representative([a, b], 'Asura').id).toBe(2);
	});

	it('then the preferred scanlator, then the one opened, then the oldest', () => {
		const a = copy(1, { scanlator: 'Asura' });
		const b = copy(2, { scanlator: 'Flame', lastOpenedAt: 5 });
		expect(representative([a, b], 'Asura').id).toBe(1);
		expect(representative([a, b], '').id).toBe(2);
		expect(representative([copy(3), copy(2)], '').id).toBe(2);
	});
});

describe('mergedState', () => {
	it('counts the chapter read when any copy was, and keeps the latest open', () => {
		const rep = copy(1);
		const other = copy(2, { readAt: 100, lastOpenedAt: 90, lastPosition: 12 });
		expect(mergedState([rep, other], rep)).toEqual({
			readAt: 100,
			lastOpenedAt: 90,
			lastPosition: 12
		});
	});

	it('keeps the representative’s own read and place', () => {
		const rep = copy(1, { readAt: 50, lastOpenedAt: 40, lastPosition: 3 });
		const other = copy(2, { readAt: 100, lastOpenedAt: 90, lastPosition: 12 });
		expect(mergedState([rep, other], rep)).toEqual({
			readAt: 50,
			lastOpenedAt: 90,
			lastPosition: 3
		});
	});
});
