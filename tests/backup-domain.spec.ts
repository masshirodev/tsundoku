import { describe, expect, it } from 'vitest';
import { parseSnapshot, snapshotName, toKeep, toPrune } from '$lib/backup/retention';

const at = (y: number, m: number, d: number, h = 4) => new Date(y, m - 1, d, h, 0, 0);
const name = (d: Date) => snapshotName('library', d);

describe('snapshot names', () => {
	it('round-trip in local time', () => {
		const d = new Date(2026, 8, 23, 4, 5, 6);
		expect(name(d)).toBe('library-20260923-040506.sqlite');
		expect(parseSnapshot('library', name(d))?.getTime()).toBe(d.getTime());
	});

	it('are not confused with another database, a pre-migration copy, or a partial', () => {
		expect(parseSnapshot('library', 'tsundoku-20260923-040506.sqlite')).toBeNull();
		expect(parseSnapshot('library', 'library-pre-v10-20260923-040506.sqlite')).toBeNull();
		expect(parseSnapshot('library', 'library-20260923-040506.sqlite.partial')).toBeNull();
		expect(parseSnapshot('library', 'library-20261341-040506.sqlite')).toBeNull();
	});
});

describe('retention', () => {
	const tiers = { daily: 7, weekly: 8, monthly: 12 };

	it('keeps one per day for a week, and drops the second of a day', () => {
		const names = [
			...Array.from({ length: 7 }, (_, i) => name(at(2026, 9, 23 - i))),
			name(at(2026, 9, 23, 1))
		];
		expect(toPrune('library', names, tiers)).toEqual([name(at(2026, 9, 23, 1))]);
	});

	it('thins a year of nightly snapshots to days, weeks and months', () => {
		const names = Array.from({ length: 365 }, (_, i) => name(at(2026, 9, 23 - i)));
		const keep = toKeep('library', names, tiers);
		// 7 days; the weeks and months overlap them and each other.
		expect(keep.size).toBeGreaterThanOrEqual(12);
		expect(keep.size).toBeLessThanOrEqual(7 + 8 + 12);
		expect(keep.has(name(at(2026, 9, 23)))).toBe(true);
		expect(keep.has(name(at(2026, 9, 17)))).toBe(true);
		// The newest of a month eleven months back is kept; one from 13 months back isn't.
		expect(keep.has(name(at(2025, 10, 31)))).toBe(true);
		expect(
			[...keep].every((n) => parseSnapshot('library', n)!.getTime() > at(2025, 9, 1).getTime())
		).toBe(true);
	});

	it('always keeps the newest, and never touches files that are not its own', () => {
		const names = ['notes.txt', 'library-pre-v9-20260101-000000.sqlite', name(at(2020, 1, 1))];
		expect(toPrune('library', names, { daily: 0, weekly: 0, monthly: 0 })).toEqual([]);
		expect(toKeep('library', names, tiers)).toEqual(new Set([name(at(2020, 1, 1))]));
	});
});
