import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample, HIDDEN_TITLES } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const series = await import('$lib/server/series');
const history = await import('$lib/server/history');

beforeAll(() => {
	seedSample(getDb(), Date.UTC(2026, 8, 22));
});

const idOf = (title: string) => lib.listSeries({ reveal: true }).find((s) => s.title === title)!.id;
// Local times on days after the seed, so these rows are the newest.
const at = (d: number, h: number, m = 0) => new Date(2030, 0, d, h, m).getTime();

describe('history', () => {
	it('has the seed reading, newest day first, hidden series only with reveal', () => {
		const shown = history.historyDays(false).rows;
		expect(shown.length).toBeGreaterThan(0);
		const days = shown.map((r) => r.day);
		expect([...days].sort().reverse()).toEqual(days);
		for (const r of shown) expect(HIDDEN_TITLES).not.toContain(r.title);
		const revealed = history.historyDays(true).rows;
		expect(revealed.some((r) => HIDDEN_TITLES.includes(r.title))).toBe(true);
	});

	it('makes one row per series per day with the range and the last page', () => {
		const id = idOf('Tower of God');
		const page = series.seriesPage(id, false)!;
		const [a, b, c] = [page.entries[379], page.entries[383], page.entries[387]];
		series.recordReading({
			seriesId: id,
			entryId: a.id,
			kind: 'finish',
			page: 50,
			now: at(15, 20)
		});
		series.recordReading({
			seriesId: id,
			entryId: b.id,
			kind: 'finish',
			page: 50,
			now: at(15, 21)
		});
		series.recordReading({
			seriesId: id,
			entryId: c.id,
			kind: 'page',
			page: 11,
			now: at(15, 23, 40)
		});

		const rows = history.historyDays(false).rows.filter((r) => r.day === '2030-01-15');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			seriesId: id,
			lastAt: at(15, 23, 40),
			first: { label: 'Ch. 380', rank: 380 },
			last: { label: 'Ch. 388', rank: 388, page: 11, finished: false }
		});
	});

	it('leaves MARK READ out: it is bookkeeping, not reading', () => {
		const id = idOf('Dungeon Meshi');
		const entry = series.seriesPage(id, false)!.entries[0];
		const before = history.historyDays(false).rows.length;
		series.markEntries(id, [entry.id], false);
		series.markEntries(id, [entry.id], true);
		expect(history.historyDays(false).rows.length).toBe(before);
	});

	it('removes only the row, and UNDO brings it back', () => {
		const id = idOf('Tower of God');
		const progress = () =>
			getDb()
				.prepare(`SELECT last_position FROM entries WHERE series_id = ? AND position = 388`)
				.get(id);
		const was = progress();
		history.removeHistoryRow(id, '2030-01-15');
		expect(history.historyDays(false).rows.some((r) => r.day === '2030-01-15')).toBe(false);
		expect(progress()).toEqual(was);
		expect(lib.continueReading(false, 50).items.some((i) => i.id === id)).toBe(true);
		history.restoreHistoryRow(id, '2030-01-15');
		expect(history.historyDays(false).rows.some((r) => r.day === '2030-01-15')).toBe(true);
	});

	it('pages by day and says where to continue', () => {
		const first = history.historyDays(true, { days: 1 });
		expect(new Set(first.rows.map((r) => r.day)).size).toBe(1);
		expect(first.older).toBe(first.rows[0].day);
		const next = history.historyDays(true, { days: 1, before: first.older });
		expect(next.rows.every((r) => r.day < first.older!)).toBe(true);
	});
});
