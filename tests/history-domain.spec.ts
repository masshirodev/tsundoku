import { describe, expect, it } from 'vitest';
import {
	dayLabel,
	entryRange,
	historyMeta,
	readTime,
	sinceDay,
	type HistoryDay
} from '$lib/library/history';
import { historyTotal } from '../src/routes/history/total';

const day = (
	over: Partial<Omit<HistoryDay, 'last'>> & { last?: Partial<HistoryDay['last']> } = {}
): HistoryDay => {
	const { last, ...rest } = over;
	return {
		seriesId: 1,
		title: 'T',
		kind: 'manhwa',
		hue: 0,
		cover: null,
		day: '2026-09-23',
		lastAt: 0,
		entryCount: 400,
		status: 'ongoing',
		first: { label: 'Ch. 380', rank: 380 },
		...rest,
		last: { label: 'Ch. 388', rank: 388, page: 11, pageCount: 54, finished: false, ...last }
	};
};

describe('history rows', () => {
	it('writes a range with the shared unit once', () => {
		expect(entryRange('Ch. 380', 'Ch. 388')).toBe('CH. 380 → 388');
		expect(entryRange('Ch. 22', 'Ch. 22')).toBe('CH. 22');
		expect(entryRange('Prologue', 'Ch. 2')).toBe('PROLOGUE → CH. 2');
	});

	it('says how far a day got, in the design voice', () => {
		expect(historyMeta(day())).toBe('MANHWA · CH. 380 → 388 · P. 12');
		expect(
			historyMeta(
				day({
					kind: 'manga',
					first: { label: 'Ch. 22', rank: 22 },
					last: { label: 'Ch. 22', rank: 22, page: 8, pageCount: 31 }
				})
			)
		).toBe('MANGA · CH. 22 · P. 9 OF 31');
		expect(
			historyMeta(
				day({
					kind: 'novel',
					first: { label: 'Vol. 13', rank: 13 },
					last: { label: 'Vol. 13', rank: 13, page: 40, pageCount: 100 }
				})
			)
		).toBe('NOVEL · VOL. 13 · 41%');
	});

	it('tells caught up from finished by the series status', () => {
		const end = { label: 'Ch. 140', rank: 140, finished: true, page: null };
		expect(
			historyMeta(
				day({ kind: 'manga', entryCount: 140, first: { label: 'Ch. 131', rank: 131 }, last: end })
			)
		).toBe('MANGA · CH. 131 → 140 · UP TO DATE');
		expect(
			historyMeta(
				day({
					kind: 'manga',
					entryCount: 140,
					status: 'completed',
					first: { label: 'Ch. 140', rank: 140 },
					last: end
				})
			)
		).toBe('MANGA · CH. 140 · FINISHED');
		// Finishing a chapter that isn't the last says nothing more.
		expect(historyMeta(day({ last: { finished: true, page: null } }))).toBe(
			'MANHWA · CH. 380 → 388'
		);
	});

	it('counts books, and a single book by its pages alone', () => {
		const single = day({ kind: 'doujin', entryCount: 1, first: { label: 'Book', rank: 1 } });
		expect(
			historyMeta({
				...single,
				last: { label: 'Book', rank: 1, page: 17, pageCount: 30, finished: false }
			})
		).toBe('DOUJIN · P. 18 OF 30');
		expect(
			historyMeta({
				...single,
				last: { label: 'Book', rank: 1, page: 29, pageCount: 30, finished: true }
			})
		).toBe('DOUJIN · FINISHED');
		const books = day({ kind: 'doujin', entryCount: 4, first: { label: 'Book', rank: 2 } });
		expect(
			historyMeta({
				...books,
				last: { label: 'Book', rank: 3, page: 4, pageCount: 30, finished: false }
			})
		).toBe('DOUJIN · BOOK 2 → 3 · P. 5');
	});

	it('drops the page and UP TO DATE from a range on a phone', () => {
		expect(historyMeta(day(), true)).toBe('MANHWA · CH. 380 → 388');
	});
});

describe('day labels', () => {
	const today = '2026-09-23';
	it('names today and yesterday and dates them on the right', () => {
		expect(dayLabel('2026-09-23', 1, today, null)).toEqual({
			left: '01 — TODAY',
			right: 'WED 23 SEP'
		});
		expect(dayLabel('2026-09-22', 2, today, '2026-09-23')).toEqual({
			left: '02 — YESTERDAY',
			right: 'TUE 22 SEP'
		});
		expect(dayLabel('2026-09-21', 3, today, '2026-09-22')).toEqual({
			left: '03 — MON 21 SEP',
			right: ''
		});
	});

	it('says the year once, where it changes', () => {
		expect(dayLabel('2025-12-31', 118, today, '2026-01-02').right).toBe('2025');
		expect(dayLabel('2025-12-30', 119, today, '2025-12-31').right).toBe('');
	});

	it('counts episodes as chapters, an episode part-watched by its time (doc/ANIME.md)', () => {
		const ep = (o: Partial<Omit<HistoryDay, 'last'>> & { last?: Partial<HistoryDay['last']> }) =>
			day({
				kind: 'anime',
				entryCount: 24,
				first: { label: 'Ep. 3', rank: 3 },
				...o,
				last: { label: 'Ep. 5', rank: 5, page: 568, pageCount: 0, ...o.last }
			});
		expect(historyMeta(ep({}))).toBe('ANIME · EP. 3 → 5 · 9:28');
		expect(historyMeta(ep({}), true)).toBe('ANIME · EP. 3 → 5');
		expect(historyMeta(ep({ first: { label: 'Ep. 5', rank: 5 } }), true)).toBe(
			'ANIME · EP. 5 · 9:28'
		);
		expect(historyMeta(ep({ last: { finished: true, page: null } }))).toBe('ANIME · EP. 3 → 5');
	});
});

describe('reading time', () => {
	it('says hours and minutes from an hour, minutes under it, and never rounds up', () => {
		const cases: [number, string][] = [
			[0, '0 MIN'],
			[-5, '0 MIN'],
			[1, '< 1 MIN'],
			[59_999, '< 1 MIN'],
			[60_000, '1 MIN'],
			[59 * 60_000 + 59_999, '59 MIN'],
			[3_600_000, '1 H 00'],
			[(12 * 60 + 40) * 60_000 + 59_000, '12 H 40'],
			[(207 * 60 + 6) * 60_000, '207 H 06']
		];
		for (const [ms, text] of cases) expect(readTime(ms), String(ms)).toBe(text);
	});

	it('names the first day a total counts from', () => {
		expect(sinceDay('2023-05-12')).toBe('SINCE 12 MAY 2023');
		expect(sinceDay('2026-09-03')).toBe('SINCE 3 SEP 2026');
	});
});

describe('the total’s SINCE, each kind’s own first timed day', () => {
	const h = 3_600_000;
	it('says the total’s first timed day, and a later kind’s own after its time', () => {
		expect(
			historyTotal({
				ms: 6 * h,
				since: '2024-03-02',
				kinds: [
					{ kind: 'manga', ms: 2 * h, since: '2024-03-02' },
					{ kind: 'anime', ms: 3 * h, since: '2026-10-30' },
					{ kind: 'novel', ms: 1 * h, since: '2026-08-17' }
				]
			})
		).toEqual({
			time: '6 H 00',
			since: 'SINCE 2 MAR 2024',
			kinds: [
				{ kind: 'anime', label: 'ANIME 3 H 00 · SINCE 30 OCT 2026' },
				{ kind: 'manga', label: 'MANGA 2 H 00' },
				{ kind: 'novel', label: 'NOVEL 1 H 00 · SINCE 17 AUG 2026' }
			]
		});
	});

	it('a kind with no time is no line, and no time at all is no total', () => {
		const t = historyTotal({
			ms: h,
			since: '2025-01-05',
			kinds: [
				{ kind: 'manhwa', ms: h, since: '2025-01-05' },
				{ kind: 'anime', ms: 0, since: null }
			]
		});
		expect(t?.kinds).toEqual([{ kind: 'manhwa', label: 'MANHWA 1 H 00' }]);
		expect(historyTotal({ ms: 0, since: null, kinds: [] })).toBeNull();
		expect(historyTotal({ ms: 0, since: '2025-01-05', kinds: [] })).toBeNull();
	});
});
