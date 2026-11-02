import { beforeEach, describe, expect, it, vi } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

// AniSkip (doc/ANIME.md, "Openings and endings"; card c239): the MAL id and
// episode number go out, the opening and ending come back. A hidden series is
// never asked about, nor one with no MAL link; a 404 is remembered for a week.
const calls: string[] = [];
let answer: unknown = {
	found: true,
	results: [
		{ interval: { startTime: 90, endTime: 180 }, skipType: 'op' },
		{ interval: { startTime: 1300, endTime: 1390 }, skipType: 'ed' }
	]
};
vi.stubGlobal('fetch', async (input: string | URL | Request) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	calls.push(url);
	if (!/^https:\/\/api\.aniskip\.com\/v2\/skip-times\//.test(url))
		return new Response('{}', { status: 500 });
	return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
});

const { getDb } = await import('$lib/server/db');
const marks = await import('$lib/server/anime/marks');
const { ANISKIP_RETRY_MS, lookupAniSkip } = await import('$lib/server/anime/aniskip');

const db = getDb();
const root = Number(
	db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Anime', '/nowhere', 0)`).run()
		.lastInsertRowid
);
let n = 0;
const series = (opts: { hidden?: number; mal?: number | null } = {}) => {
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden)
				VALUES (?, ?, 'anime', 0, ?, ?)`
			)
			.run(root, `Show ${++n}`, `aniyomi:7000:/show/${n}`, opts.hidden ?? 0).lastInsertRowid
	);
	if (opts.mal !== null)
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, mal_id, via, linked_at) VALUES (?, 1, ?, 'mihon', 0)`
		).run(id, opts.mal ?? 21);
	return id;
};
const episode = (
	seriesId: number,
	o: {
		position?: number;
		season?: number | null;
		number?: number | null;
		duration?: number | null;
	} = {}
) =>
	Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url, season, episode_number, duration_s)
				VALUES (?, ?, 'Ep.', 0, ?, ?, ?, ?)`
			)
			.run(
				seriesId,
				o.position ?? 1,
				`/ep/${o.position ?? 1}`,
				o.season === undefined ? 1 : o.season,
				o.number === undefined ? 7 : o.number,
				o.duration === undefined ? 1440 : o.duration
			).lastInsertRowid
	);

const chosen = (id: number) => marks.chosenMarks(id);

beforeEach(() => {
	calls.length = 0;
	answer = {
		found: true,
		results: [
			{ interval: { startTime: 90, endTime: 180 }, skipType: 'op' },
			{ interval: { startTime: 1300, endTime: 1390 }, skipType: 'ed' }
		]
	};
});

describe('AniSkip', () => {
	it('asks with the MAL id, the episode and its length, and keeps both marks', async () => {
		const id = episode(series());
		expect(await lookupAniSkip(id)).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBe(
			'https://api.aniskip.com/v2/skip-times/21/7?episodeLength=1440&types%5B%5D=op&types%5B%5D=ed'
		);
		expect(chosen(id)).toMatchObject({
			intro: { start: 90, end: 180 },
			ending: { start: 1300, end: 1390 },
			introFrom: 'aniskip',
			endingFrom: 'aniskip'
		});
		// The ending is where watching counts from, everywhere the app reads it.
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id)).toEqual({
			ending_at: 1300
		});
	});

	it('never asks an episode it already resolved', async () => {
		const id = episode(series());
		await lookupAniSkip(id);
		expect(await lookupAniSkip(id)).toBe(false);
		expect(calls).toHaveLength(1);
	});

	it('never displaces the source’s own timestamps', async () => {
		const id = episode(series());
		marks.saveSourceMarks(id, {
			intro: { start: 85, end: 175 },
			ending: { start: 1290, end: 1380 }
		});
		await lookupAniSkip(id);
		expect(chosen(id)).toMatchObject({
			intro: { start: 85, end: 175 },
			ending: { start: 1290, end: 1380 },
			introFrom: 'source',
			endingFrom: 'source'
		});
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id)).toEqual({
			ending_at: 1290
		});
	});

	it('is never asked about a hidden series, even with reveal on', async () => {
		const id = episode(series({ hidden: 1 }));
		expect(await lookupAniSkip(id)).toBe(false);
		expect(calls).toEqual([]);
	});

	it('is never asked without a MAL link', async () => {
		const id = episode(series({ mal: null }));
		expect(await lookupAniSkip(id)).toBe(false);
		expect(calls).toEqual([]);
	});

	it('is not asked for a later season: the link is one season’s entry until c240', async () => {
		const id = episode(series(), { season: 2 });
		expect(await lookupAniSkip(id)).toBe(false);
		expect(calls).toEqual([]);
	});

	it('is not asked without a length', async () => {
		const id = episode(series(), { duration: null });
		expect(await lookupAniSkip(id)).toBe(false);
		expect(calls).toEqual([]);
	});

	it('takes the length a caller has just measured', async () => {
		const id = episode(series(), { duration: null });
		expect(await lookupAniSkip(id, { durationS: 1420 })).toBe(true);
		expect(calls[0]).toContain('episodeLength=1420');
	});

	it('remembers a 404, then asks again after a week', async () => {
		const id = episode(series());
		const now = 1_800_000_000_000;
		answer = { found: false, results: [], statusCode: 404 };
		expect(await lookupAniSkip(id, { now })).toBe(false);
		expect(marks.markTriedAt(id, 'aniskip')).toBe(now);
		expect(marks.needsLookup(id, 'aniskip', ANISKIP_RETRY_MS, now + 1000)).toBe(false);
		expect(marks.needsLookup(id, 'aniskip', ANISKIP_RETRY_MS, now + ANISKIP_RETRY_MS)).toBe(true);
		answer = {
			found: true,
			results: [{ interval: { startTime: 30, endTime: 90 }, skipType: 'op' }]
		};
		expect(await lookupAniSkip(id, { now: now + ANISKIP_RETRY_MS })).toBe(true);
		expect(calls).toHaveLength(2);
		expect(chosen(id).intro).toEqual({ start: 30, end: 90 });
	});

	it('does not remember a server that could not answer', async () => {
		const id = episode(series());
		const real = answer;
		try {
			answer = 'not json';
			vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
			expect(await lookupAniSkip(id)).toBe(false);
			expect(marks.markTriedAt(id, 'aniskip')).toBeNull();
			expect(marks.needsLookup(id, 'aniskip', ANISKIP_RETRY_MS)).toBe(true);
		} finally {
			answer = real;
			vi.stubGlobal('fetch', async (input: string | URL | Request) => {
				const url =
					typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				calls.push(url);
				return new Response(JSON.stringify(answer), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			});
		}
	});

	it('leaves a found answer alone when a later attempt finds nothing', async () => {
		const id = episode(series());
		await lookupAniSkip(id);
		const tried = marks.markTriedAt(id, 'aniskip');
		marks.saveAttempt(id, 'aniskip', db, 999);
		expect(marks.markTriedAt(id, 'aniskip')).toBe(tried);
		expect(chosen(id).ending).toEqual({ start: 1300, end: 1390 });
	});

	it('reads mixed op and ed types too', async () => {
		answer = {
			found: true,
			results: [
				{ interval: { startTime: 10, endTime: 100 }, skipType: 'mixed-op' },
				{ interval: { startTime: 1400, endTime: 1440 }, skipType: 'mixed-ed' }
			]
		};
		const id = episode(series());
		await lookupAniSkip(id);
		expect(chosen(id).intro).toEqual({ start: 10, end: 100 });
		expect(chosen(id).ending).toEqual({ start: 1400, end: 1440 });
	});
});
