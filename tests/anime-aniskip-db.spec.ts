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
const cat = await import('$lib/server/catalogue');
const { ANISKIP_RETRY_MS, lookupAniSkip } = await import('$lib/server/anime/aniskip');

const db = getDb();
const root = Number(
	db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Anime', '/nowhere', 0)`).run()
		.lastInsertRowid
);
let n = 0;
// A link's `format` is the entry's own (AniList's MediaFormat); `null` is a
// link that does not know it yet (rung 26's column, a Mihon tracker's link).
const series = (opts: { hidden?: number; mal?: number | null; format?: string | null } = {}) => {
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
			`INSERT INTO series_links (series_id, anilist_id, mal_id, via, linked_at, format) VALUES (?, 1, ?, 'mihon', 0, ?)`
		).run(id, opts.mal ?? 21, opts.format === undefined ? 'TV' : opts.format);
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

	it('a link set after a negative clears it, so the next resolve asks again (c299)', async () => {
		const show = series();
		const id = episode(show, { duration: 1440 });
		// Asked with the wrong link (a manga's MAL id), and answered 404: kept.
		answer = { found: false, results: [], statusCode: 404 };
		expect(await lookupAniSkip(id)).toBe(false);
		expect(marks.markTriedAt(id, 'aniskip')).not.toBeNull();

		// The owner relinks the series to the right entry: the negative goes.
		cat.link(
			show,
			{
				anilistId: 30024,
				malId: 23,
				title: 'Ranma ½',
				alts: [],
				format: 'TV',
				country: 'JP',
				year: 2024,
				chapters: null,
				volumes: null,
				episodes: 24,
				season: 'FALL',
				seasonYear: 2024,
				status: 'RELEASING',
				coverUrl: ''
			},
			'review',
			9_000
		);
		expect(marks.markTriedAt(id, 'aniskip')).toBeNull();
		answer = {
			found: true,
			results: [{ interval: { startTime: 90, endTime: 180 }, skipType: 'op' }]
		};
		expect(await lookupAniSkip(id)).toBe(true);
		expect(calls).toHaveLength(2);
		expect(calls[1]).toContain('/skip-times/23/');
		expect(chosen(id).intro).toEqual({ start: 90, end: 180 });
	});

	it('removing a link clears the answer too, and so does UNDO', async () => {
		const show = series();
		const id = episode(show);
		await lookupAniSkip(id);
		expect(marks.markTriedAt(id, 'aniskip')).not.toBeNull();
		cat.unlink(show, 9_001);
		expect(marks.markTriedAt(id, 'aniskip')).toBeNull();
		// UNDO of a link: the answers go with it.
		cat.link(
			show,
			{
				anilistId: 30024,
				malId: 23,
				title: 'Ranma ½',
				alts: [],
				format: 'TV',
				country: 'JP',
				year: 2024,
				chapters: null,
				volumes: null,
				episodes: 24,
				season: 'FALL',
				seasonYear: 2024,
				status: 'RELEASING',
				coverUrl: ''
			},
			'review',
			9_002
		);
		answer = {
			found: true,
			results: [{ interval: { startTime: 90, endTime: 180 }, skipType: 'op' }]
		};
		await lookupAniSkip(id);
		expect(marks.markTriedAt(id, 'aniskip')).not.toBeNull();
		cat.undoLink(show);
		expect(marks.markTriedAt(id, 'aniskip')).toBeNull();
	});

	it('unlinking clears AniSkip’s ending from where watching counts (round 2)', async () => {
		const show = series();
		const id = episode(show, { duration: 1440 });
		await lookupAniSkip(id);
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id)).toEqual({
			ending_at: 1300
		});
		cat.unlink(show, 9_003);
		// The row that gave the ending is gone, so nothing marks the episode watched.
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id)).toEqual({
			ending_at: null
		});
	});

	it('a relink leaves the fingerprint’s ending where AniSkip’s was (round 2)', async () => {
		const show = series();
		const id = episode(show, { duration: 1440 });
		await lookupAniSkip(id);
		marks.saveMark(id, 'fingerprint', {
			intro: null,
			ending: { start: 1000, end: 1100 }
		});
		// AniSkip wins over a fingerprint, so its ending is the one in force.
		expect(chosen(id).endingFrom).toBe('aniskip');
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id)).toEqual({
			ending_at: 1300
		});
		cat.link(
			show,
			{
				anilistId: 30025,
				malId: 24,
				title: 'Ranma ½',
				alts: [],
				format: 'TV',
				country: 'JP',
				year: 2024,
				chapters: null,
				volumes: null,
				episodes: 24,
				season: 'FALL',
				seasonYear: 2024,
				status: 'RELEASING',
				coverUrl: ''
			},
			'review',
			9_004
		);
		// The old entry’s ending is gone; the fingerprint’s what remains.
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id)).toEqual({
			ending_at: 1000
		});
	});

	it('writes nothing for a series with no AniSkip row, and nothing at all for a manga (c299)', () => {
		const changes = () => (db.prepare(`SELECT total_changes() AS n`).get() as { n: number }).n;
		// An anime no finder has reached yet: the DELETE matches nothing, so no
		// ending_at can have moved. `linkFromTracker` runs this per tracked series
		// inside an import's transaction.
		const show = series();
		episode(show, { position: 1 });
		episode(show, { position: 2 });
		let before = changes();
		marks.clearAniSkip(show);
		expect(changes() - before).toBe(0);
		// A manga never has an AniSkip row at all (`lookupRow` joins on an anime),
		// and a first import of a few hundred tracked comics reaches every one.
		const comic = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden)
					VALUES (?, 'A Comic', 'manga', 0, 'mihon:1:/comic', 0)`
				)
				.run(root).lastInsertRowid
		);
		episode(comic, { position: 1 });
		episode(comic, { position: 2 });
		before = changes();
		marks.clearAniSkip(comic);
		expect(changes() - before).toBe(0);
	});

	// c395: AniSkip's ids are MAL *anime* ids, and MAL numbers anime and manga
	// apart, so a manga's id names an unrelated anime. The fake answers any id
	// with an opening, as the real service does for a real anime, so a lookup
	// that should not happen leaves a wrong mark behind, not just a request.
	const ranma = (format: string) => ({
		anilistId: 30023,
		malId: 23,
		title: 'Ranma ½',
		alts: [],
		format,
		country: 'JP',
		year: 1987,
		chapters: 407,
		volumes: 38,
		episodes: null,
		season: null,
		seasonYear: null,
		status: 'FINISHED',
		coverUrl: ''
	});

	it('is never asked under a link to a manga’s entry, and remembers nothing (c395)', async () => {
		// Through the app's own door: LINK takes the entry it is given, and a
		// wrong-kind one is flagged on the series, not refused (c298).
		const show = series({ mal: null });
		const id = episode(show);
		expect(cat.link(show, ranma('MANGA'), 'review', 9_100)).toBe(true);
		expect(
			db.prepare(`SELECT mal_id, format FROM series_links WHERE series_id = ?`).get(show)
		).toEqual({ mal_id: 23, format: 'MANGA' });
		expect(await lookupAniSkip(id)).toBe(false);
		expect(calls).toEqual([]);
		// No row at all: a negative would hold AniSkip off for a week after a relink.
		expect(marks.markTriedAt(id, 'aniskip')).toBeNull();
		expect(chosen(id)).toMatchObject({ intro: null, ending: null });
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id)).toEqual({
			ending_at: null
		});
		// Relinked to the anime, it is asked at once.
		cat.link(show, { ...ranma('TV'), anilistId: 178533, malId: 58616 }, 'review', 9_101);
		expect(await lookupAniSkip(id)).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain('/skip-times/58616/');
	});

	it('is asked under an anime’s format and no other, an unknown one included (c395)', async () => {
		// Every format AniList gives (MediaFormat), and the two a link without
		// one carries: the whole domain, not a hand-picked part of it.
		const asked: Record<string, boolean> = {};
		for (const format of [
			'TV',
			'TV_SHORT',
			'MOVIE',
			'SPECIAL',
			'OVA',
			'ONA',
			'MUSIC',
			'MANGA',
			'NOVEL',
			'ONE_SHOT',
			'',
			null
		]) {
			calls.length = 0;
			const id = episode(series({ format }));
			await lookupAniSkip(id);
			asked[String(format)] = calls.length > 0;
			// What is not asked leaves no row: the series' own link may learn its
			// format later (the resolve pass), and must be asked then.
			if (!asked[String(format)]) expect(marks.markTriedAt(id, 'aniskip')).toBeNull();
		}
		expect(asked).toEqual({
			TV: true,
			TV_SHORT: true,
			MOVIE: true,
			SPECIAL: true,
			OVA: true,
			ONA: true,
			MUSIC: false,
			MANGA: false,
			NOVEL: false,
			ONE_SHOT: false,
			'': false,
			null: false
		});
	});
});
