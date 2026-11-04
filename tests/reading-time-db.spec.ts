import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb, climb } = await import('$lib/server/db');
const { seedSample, HIDDEN_TITLES } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const series = await import('$lib/server/series');
const history = await import('$lib/server/history');
const time = await import('$lib/server/reading-time');

/**
 * The reading-time summary (card c443; doc/READING-LOG.md, "Who reads it"):
 * by series, kind, day and series-day, hidden left out while reveal is off,
 * a 1970 row ignored, and rung 65's estimate of the anime watched before.
 *
 * The summary is checked against an oracle that reads the raw log in plain
 * script, with the hidden rule spelled out here rather than borrowed from
 * visibility.ts, over every group the seed and this spec's rows produce.
 */

const minute = 60_000;
// Local times on days after the seed, so these rows are the newest.
const at = (d: number, h: number, m = 0) => new Date(2030, 0, d, h, m).getTime();
const idOf = (title: string) => lib.listSeries({ reveal: true }).find((s) => s.title === title)!.id;

let visibleId = 0;
let hiddenId = 0;
let hiddenTitle = '';

beforeAll(() => {
	const db = getDb();
	seedSample(db, Date.UTC(2026, 8, 22));
	visibleId = idOf('Tower of God');
	hiddenTitle = HIDDEN_TITLES[0];
	hiddenId = idOf(hiddenTitle);
	const read = (
		seriesId: number,
		kind: 'open' | 'page' | 'close',
		d: number,
		h: number,
		ms: number
	) => {
		const entryId = series.seriesPage(seriesId, true)!.entries[0].id;
		series.recordReading({ seriesId, entryId, kind, page: 1, durationMs: ms, now: at(d, h) });
	};
	// Tower of God: 30 min on the 10th, 50 on the 11th (two sittings).
	read(visibleId, 'open', 10, 20, 0);
	read(visibleId, 'page', 10, 20, 20 * minute);
	read(visibleId, 'close', 10, 21, 10 * minute);
	read(visibleId, 'page', 11, 8, 20 * minute);
	read(visibleId, 'page', 11, 22, 30 * minute);
	// A hidden series read on the same days: 45 min.
	read(hiddenId, 'page', 10, 23, 25 * minute);
	read(hiddenId, 'page', 11, 23, 20 * minute);
	// Bookkeeping never counts, even with a duration on it.
	const entry = series.seriesPage(visibleId, true)!.entries[1].id;
	db.prepare(
		`INSERT INTO reading_events (at, series_id, entry_id, kind, duration_ms) VALUES (?, ?, ?, 'mark_read', ?)`
	).run(at(11, 9), visibleId, entry, 99 * minute);
	// The live library's bad clock: one page event at the epoch.
	db.prepare(
		`INSERT INTO reading_events (at, series_id, entry_id, kind, page, duration_ms) VALUES (0, ?, ?, 'page', 3, ?)`
	).run(visibleId, entry, 7 * minute);
});

type Raw = {
	seriesId: number;
	kind: string;
	day: string;
	ms: number;
	event: string;
	hidden: number;
	rootHidden: number;
	public: number;
};

/** The log read in script: every reading event a viewer may see, by the rule written out. */
function oracle(reveal: boolean): Raw[] {
	const rows = getDb()
		.prepare(
			`SELECT re.series_id AS seriesId, s.kind, re.day, re.duration_ms AS ms, re.kind AS event,
				s.hidden, r.hidden AS rootHidden, s.public
			FROM reading_events re JOIN series s ON s.id = re.series_id JOIN roots r ON r.id = s.root_id`
		)
		.all() as Raw[];
	return rows.filter(
		(r) =>
			['open', 'page', 'finish', 'close'].includes(r.event) &&
			r.day >= '2015-01-01' &&
			(reveal || !(r.hidden === 1 || (r.rootHidden === 1 && r.public === 0)))
	);
}

function sum(rows: Raw[], key: (r: Raw) => string) {
	const out = new Map<string, { ms: number; since: string }>();
	for (const r of rows) {
		const k = key(r);
		const o = out.get(k) ?? { ms: 0, since: r.day };
		o.ms += r.ms;
		if (r.day < o.since) o.since = r.day;
		out.set(k, o);
	}
	return out;
}

describe('the summary', () => {
	for (const reveal of [false, true]) {
		it(`agrees with the log by series, kind, day and series-day (reveal ${reveal ? 'on' : 'off'})`, () => {
			const raw = oracle(reveal);
			const cases = [
				['series', (r: Raw) => String(r.seriesId), (t: { seriesId: number }) => String(t.seriesId)],
				['kind', (r: Raw) => r.kind, (t: { kind: string }) => t.kind],
				['day', (r: Raw) => r.day, (t: { day: string }) => t.day],
				[
					'seriesDay',
					(r: Raw) => `${r.seriesId}:${r.day}`,
					(t: { seriesId: number; day: string }) => `${t.seriesId}:${t.day}`
				]
			] as const;
			for (const [by, rawKey, rowKey] of cases) {
				const want = sum(raw, rawKey);
				const got = time.readingTime(by, { reveal });
				expect(got.length, by).toBe(want.size);
				for (const t of got) {
					const key = (rowKey as (t: unknown) => string)(t);
					expect({ by, key, ms: t.ms, since: t.since }).toEqual({ by, key, ...want.get(key) });
				}
			}
		});
	}

	it('counts a series’ sittings, and only reading', () => {
		// 30 + 50 minutes; MARK READ's 99 and the 1970 row's 7 are not reading.
		const before = time.seriesReadingTime(visibleId, false);
		const seeded = oracle(false)
			.filter((r) => r.seriesId === visibleId && r.day < '2030-01-01')
			.reduce((n, r) => n + r.ms, 0);
		expect(before - seeded).toBe(80 * minute);
		const days = time.readingTime('seriesDay', {
			reveal: false,
			seriesId: visibleId,
			from: '2030-01-01'
		});
		expect(days.map((d) => [d.day, d.ms])).toEqual([
			['2030-01-11', 50 * minute],
			['2030-01-10', 30 * minute]
		]);
	});

	it('ignores an event before the first plausible day: no day reads 1970', () => {
		for (const reveal of [false, true]) {
			const days = time.readingTime('day', { reveal }).map((d) => d.day);
			expect(days.every((d) => d >= time.FIRST_PLAUSIBLE_DAY)).toBe(true);
			for (const by of ['series', 'kind', 'seriesDay'] as const)
				expect(
					time.readingTime(by, { reveal }).every((t) => t.since >= time.FIRST_PLAUSIBLE_DAY)
				).toBe(true);
		}
		// HISTORY's days too: its last page ends before 1970.
		const all = history.historyDays(true, { days: 100_000 }).rows;
		expect(all.every((r) => r.day >= time.FIRST_PLAUSIBLE_DAY)).toBe(true);
	});
});

describe('hidden means hidden, at every door to the number', () => {
	it('the series screen: a hidden series’ time is 0 while reveal is off', () => {
		expect(time.seriesReadingTime(hiddenId, false)).toBe(0);
		expect(time.seriesReadingTime(hiddenId, true)).toBeGreaterThanOrEqual(45 * minute);
	});

	it('a kind’s total, and the total of everything', () => {
		const kind = lib.listSeries({ reveal: true }).find((s) => s.id === hiddenId)!.kind;
		const hiddenMs = time.seriesReadingTime(hiddenId, true);
		const off = time.readingTotals(false);
		const on = time.readingTotals(true);
		const k = (t: typeof off) => t.kinds.find((x) => x.kind === kind)?.ms ?? 0;
		// Revealing adds at least the hidden series' time to its kind and to the sum.
		expect(k(on) - k(off)).toBeGreaterThanOrEqual(hiddenMs);
		expect(on.ms - off.ms).toBeGreaterThanOrEqual(hiddenMs);
		expect(off.ms).toBe(off.kinds.reduce((n, x) => n + x.ms, 0));
	});

	it('HISTORY: no row of it and no time, then both with reveal', () => {
		const off = history.historyDays(false, { days: 3 }).rows;
		expect(off.some((r) => r.title === hiddenTitle)).toBe(false);
		const offDay = off.filter((r) => r.day === '2030-01-10');
		expect(offDay.map((r) => [r.seriesId, r.timeMs])).toEqual([[visibleId, 30 * minute]]);
		const on = history.historyDays(true, { days: 3 }).rows;
		const hid = on.filter((r) => r.seriesId === hiddenId).map((r) => [r.day, r.timeMs]);
		expect(hid).toEqual([
			['2030-01-11', 20 * minute],
			['2030-01-10', 25 * minute]
		]);
	});
});

describe('rung 65: anime watched before c443 gets the time its positions vouch for', () => {
	const old = () => {
		const conn = new Database(':memory:');
		climb(conn, 64);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Engine', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES
				(1, 1, 'Ranma', 'anime', 1), (2, 1, 'Frieren', 'manga', 1);
			INSERT INTO entries (id, series_id, position, label, added_at) VALUES
				(1, 1, 1, 'Ep. 1', 1), (2, 1, 2, 'Ep. 2', 1), (3, 2, 1, 'Ch. 1', 1);
		`);
		const put = conn.prepare(
			`INSERT INTO reading_events (id, at, series_id, entry_id, kind, page, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`
		);
		const t0 = new Date(2026, 9, 30, 21, 0).getTime();
		const s = 1000;
		// Episode 1 as the player sent it: a page every 15 s.
		put.run(1, t0, 1, 1, 'open', 0, 0);
		put.run(2, t0 + 15 * s, 1, 1, 'page', 15, 0); // played: 15 s
		put.run(3, t0 + 30 * s, 1, 1, 'page', 30, 0); // played: 15 s
		put.run(4, t0 + 46 * s, 1, 1, 'page', 44, 0); // 14 s in 16 s: within 2 s, 14 s
		put.run(5, t0 + 61 * s, 1, 1, 'page', 140, 0); // SKIP INTRO: a seek, 0
		put.run(6, t0 + 76 * s, 1, 1, 'page', 145, 0); // paused part of it: 0
		put.run(7, t0 + 10 * 60 * s, 1, 1, 'page', 150, 0); // a long pause: 0
		put.run(8, t0 + 10 * 60 * s + 15 * s, 1, 1, 'page', 120, 0); // back: 0
		put.run(9, t0 + 10 * 60 * s + 23 * s, 1, 1, 'close', 128, 0); // 8 s
		// Episode 2: a step that looks played but spans the open of another
		// sitting is the open's, which keeps 0; its page counts.
		put.run(10, t0 + 3600 * s, 1, 2, 'open', 0, 0);
		put.run(11, t0 + 3615 * s, 1, 2, 'page', 15, 0); // 15 s
		// A step the player already timed is left as it is.
		put.run(12, t0 + 3630 * s, 1, 2, 'page', 30, 4000);
		// An event of a book never moves, whatever its pages say.
		put.run(13, t0, 2, 3, 'page', 1, 0);
		put.run(14, t0 + 1 * s, 2, 3, 'page', 2, 0);
		// A mark: bookkeeping, never time.
		put.run(15, t0 + 3700 * s, 1, 2, 'mark_read', null, 0);
		return conn;
	};

	it('fills only the steps whose position moved with the clock', () => {
		const conn = old();
		climb(conn, 65);
		expect(conn.pragma('user_version', { simple: true })).toBe(65);
		const got = Object.fromEntries(
			(
				conn.prepare(`SELECT id, duration_ms FROM reading_events ORDER BY id`).all() as {
					id: number;
					duration_ms: number;
				}[]
			).map((r) => [r.id, r.duration_ms])
		);
		expect(got).toEqual({
			1: 0,
			2: 15_000,
			3: 15_000,
			4: 14_000,
			5: 0,
			6: 0,
			7: 0,
			8: 0,
			9: 8_000,
			10: 0,
			11: 15_000,
			12: 4_000,
			13: 0,
			14: 0,
			15: 0
		});
	});

	it('is the top of a fresh database', () => {
		expect(getDb().pragma('user_version', { simple: true })).toBe(65);
	});
});
