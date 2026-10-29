import { describe, expect, it } from 'vitest';
import { continueCell, keptLine, recordLine, rowLook } from '$lib/library/browsing';

// A browsing record on its preview (doc/BROWSING.md; card c165; Online Calls 1B, 1D).
describe('a record’s preview rows', () => {
	it('say WATCHED, how much is left with how far, or nothing', () => {
		const s = { read: false, position: null, durationS: 1440, pageCount: 0 };
		expect(rowLook(null, true)).toEqual({ kind: 'plain', status: '' });
		expect(rowLook({ ...s, read: true }, true)).toEqual({ kind: 'read', status: 'WATCHED' });
		expect(rowLook({ ...s, position: 568 }, true)).toEqual({
			kind: 'progress',
			status: '14:32 LEFT',
			share: 568 / 1440
		});
		// No length known yet: where it stopped instead.
		expect(rowLook({ ...s, durationS: null, position: 90 }, true)).toMatchObject({
			status: 'AT 1:30',
			share: 0
		});
		expect(rowLook({ ...s, position: 11, pageCount: 41 }, false)).toMatchObject({
			status: 'P. 12 / 41'
		});
		expect(rowLook({ ...s, read: true }, false).status).toBe('READ');
	});
});

describe('the RECORD row and the bar', () => {
	it('say what the record holds and when it goes', () => {
		expect(recordLine({ read: 2, total: 12 }, true)).toBe('Not in library · 2 of 12 watched');
		expect(recordLine({ read: 3, total: 166 }, false, true)).toBe('Not in library · 3 of 166');
		const now = new Date(2026, 9, 29, 9, 0).getTime();
		const last = new Date(2026, 9, 28, 23, 10).getTime();
		expect(keptLine({ lastOpenedAt: last, keptUntil: last + 30 * 86400e3 }, now, 30)).toBe(
			'LAST OPENED YESTERDAY 23:10 · KEPT UNTIL 27 NOV'
		);
		expect(keptLine({ lastOpenedAt: now, keptUntil: now }, now, 30, true)).toBe(
			'KEPT 30 DAYS AFTER THE LAST OPEN'
		);
	});

	it('continue where the record stopped, or start at the first', () => {
		expect(continueCell(null, true)).toEqual({ label: '▶ EP. 1', meta: '' });
		expect(continueCell({ label: 'Ep. 3', position: 568, durationS: 1440 }, true)).toEqual({
			label: '▶ EP. 3',
			meta: '14:32 LEFT'
		});
		expect(continueCell({ label: 'Ep. 4', position: null, durationS: null }, true)).toEqual({
			label: '▶ EP. 4',
			meta: ''
		});
		// A manga: the first chapter online, or where the record stopped (Online Calls 1A, 1B).
		expect(continueCell(null, false)).toEqual({ label: '▶ READ CH. 1', meta: 'ONLINE' });
		expect(continueCell({ label: 'Ch. 4', position: 11, durationS: null }, false)).toEqual({
			label: '▶ CONTINUE',
			meta: 'CH. 4 · P. 12'
		});
		expect(continueCell({ label: 'Ch. 5', position: null, durationS: null }, false)).toEqual({
			label: '▶ CONTINUE',
			meta: 'CH. 5'
		});
	});
});
