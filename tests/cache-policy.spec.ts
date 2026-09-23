import { describe, expect, it } from 'vitest';
import { evict, keepFor, markerPath, parseMarker, type EntryRef } from '$lib/cache/policy';

const e = (id: number, readAt: number | null = null, available = true): EntryRef => ({
	id,
	position: id,
	readAt,
	available
});

describe('what to keep ahead', () => {
	it('keeps the current chapter and the next two', () => {
		expect(keepFor([e(1, 1), e(2), e(3), e(4), e(5)], 2)).toEqual([2, 3, 4]);
	});

	it('lets a read chapter go, and skips what is not downloaded', () => {
		expect(keepFor([e(1, 1), e(2, 5), e(3, null, false), e(4), e(5), e(6)], 2)).toEqual([4, 5, 6]);
	});

	it('keeps nothing for an entry it doesn’t know', () => {
		expect(keepFor([e(1)], 9)).toEqual([]);
	});
});

describe('the budget', () => {
	it('lets the oldest go first, never what is being read', () => {
		const cached = [
			{ seriesId: 1, entryId: 10, at: 1, bytes: 600 },
			{ seriesId: 1, entryId: 11, at: 2, bytes: 600 },
			{ seriesId: 2, entryId: 20, at: 3, bytes: 600 }
		];
		expect(evict(cached, [], 1000)).toEqual([10, 11]);
		expect(evict(cached, [10], 1000)).toEqual([11, 20]);
		expect(evict(cached, [], 5000)).toEqual([]);
	});
});

describe('markers', () => {
	it('round-trip', () => {
		expect(parseMarker(markerPath(3, 42))).toEqual({ seriesId: 3, entryId: 42 });
		expect(parseMarker('/api/entries/42/pages/0')).toBeNull();
	});
});
