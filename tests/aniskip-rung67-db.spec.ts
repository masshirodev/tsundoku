import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

/**
 * Rung 67 (card c463): AniSkip answers asked before c349 under another
 * season's entry are forgotten, and asked again on the next play.
 *
 * Each library is made the way the app made it. The links are written by the
 * app's own door (`linkSeason`) on the app's database and copied into a
 * database stopped at v66, with the `series_links` mirror that `syncSeriesLink`
 * wrote then (it and the mirror are gone since c467). The answers are written by the app's own `saveMark`/`saveAttempt`
 * under the key the old lookup used: the mirror's MAL id and the season's own
 * episode number (`lookupRow` joined `series_links` until e587f8d). Then the
 * rung climbs, and the next play asks through today's `lookupAniSkip`.
 */
const calls: string[] = [];
vi.stubGlobal('fetch', async (input: string | URL | Request) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	calls.push(url);
	return new Response(
		JSON.stringify({
			found: true,
			results: [
				{ interval: { startTime: 95, endTime: 185 }, skipType: 'op' },
				{ interval: { startTime: 1310, endTime: 1400 }, skipType: 'ed' }
			]
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
});

const { climb, getDb } = await import('$lib/server/db');
const seasons = await import('$lib/server/season-links');
const marks = await import('$lib/server/anime/marks');
const { lookupAniSkip } = await import('$lib/server/anime/aniskip');

const app = getDb();
app.prepare(`INSERT INTO roots (id, name, path, hidden) VALUES (1, 'Anime', '/nowhere', 0)`).run();

beforeEach(() => {
	calls.length = 0;
});

/** The MAL id and episode each AniSkip call named. */
const asked = () =>
	calls.map((u) => {
		const m = /\/skip-times\/(\d+)\/([\d.]+)\?/.exec(u)!;
		return [Number(m[1]), Number(m[2])];
	});

const entryOf = (anilistId: number, malId: number, episodes: number | null = 12) => ({
	anilistId,
	malId,
	title: `Entry ${anilistId}`,
	alts: [] as string[],
	format: 'TV',
	country: 'JP',
	year: 2024,
	chapters: null,
	volumes: null,
	episodes,
	season: null,
	seasonYear: 2024,
	status: 'FINISHED',
	coverUrl: ''
});

type Ep = { id: number; season: number | null; number: number | null; position: number };
type Link = {
	season: number;
	part: number;
	anilist: number;
	mal: number;
	episodes?: number | null;
};

/**
 * The row's columns that the v66 table has. The app's database stands at the
 * top rung, so a later rung's column (rung 70's `series_links.country` and
 * `year`) is in its rows and not in a v66 library; the rung climbs past them
 * and adds them itself.
 */
const columnsAt66 = (old: Database.Database, table: string, row: Record<string, unknown>) => {
	const has = new Set(
		(old.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
	);
	return Object.keys(row).filter((c) => has.has(c));
};

let nextSeries = 100;
let nextEntry = 1000;

/**
 * One anime in both databases under the same ids: its episodes, its links
 * made by `linkSeason` on the app's database, those season rows copied into
 * `old`, which stands at v66, and the mirror as v66's app kept it beside them
 * (no door writes one since rung 74, c467, but this rung is about that row).
 */
function show(old: Database.Database, eps: Omit<Ep, 'id'>[], links: Link[]) {
	const id = ++nextSeries;
	const made = eps.map((e) => ({ ...e, id: ++nextEntry }));
	for (const conn of [app, old]) {
		if (!conn.prepare(`SELECT 1 FROM roots WHERE id = 1`).get())
			conn.prepare(`INSERT INTO roots (id, name, path, hidden) VALUES (1, 'Anime', '/n', 0)`).run();
		conn
			.prepare(
				`INSERT INTO series (id, root_id, title, kind, added_at, origin_key) VALUES (?, 1, ?, 'anime', 0, ?)`
			)
			.run(id, `Show ${id}`, `aniyomi:1:/show/${id}`);
		for (const e of made)
			conn
				.prepare(
					`INSERT INTO entries (id, series_id, position, label, added_at, source_url, season, episode_number, duration_s)
					VALUES (?, ?, ?, 'Ep.', 0, ?, ?, ?, 1440)`
				)
				.run(e.id, id, e.position, `/ep/${e.id}`, e.season, e.number);
	}
	for (const l of links)
		expect(
			seasons.linkSeason(
				id,
				l.season,
				l.part,
				entryOf(l.anilist, l.mal, l.episodes === undefined ? 12 : l.episodes),
				'review',
				1
			)
		).toBe(true);
	for (const r of app.prepare(`SELECT * FROM series_season_links WHERE series_id = ?`).all(id)) {
		const row = r as Record<string, unknown>;
		const cols = columnsAt66(old, 'series_season_links', row);
		old
			.prepare(
				`INSERT INTO series_season_links (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
			)
			.run(...cols.map((c) => row[c]));
	}
	// `syncSeriesLink` as it stood: the lowest season linked, part 1, and only
	// while that is season 1 or a flat list.
	const mirror = old
		.prepare(
			`SELECT anilist_id, mal_id, via, title, cover_url, linked_at, resolved_at, format
			FROM series_season_links WHERE series_id = ? AND part = 1 AND season <= 1
			ORDER BY season LIMIT 1`
		)
		.get(id) as Record<string, unknown> | undefined;
	if (mirror) {
		const cols = Object.keys(mirror);
		old
			.prepare(
				`INSERT INTO series_links (series_id, ${cols.join(', ')})
				VALUES (?, ${cols.map(() => '?').join(', ')})`
			)
			.run(id, ...cols.map((c) => mirror[c]));
	}
	return { id, eps: made, mirrorMal: (mirror?.mal_id as number | undefined) ?? null };
}

/** What the old lookup stored: an answer under the mirror's id, or a remembered miss. */
function oldAnswer(conn: Database.Database, e: Ep, found = true) {
	if (found)
		marks.saveMark(
			e.id,
			'aniskip',
			{ intro: { start: 80, end: 170 }, ending: { start: 1300, end: 1390 } },
			conn,
			1
		);
	else marks.saveAttempt(e.id, 'aniskip', conn, 1);
}

const at66 = () => {
	const conn = new Database(':memory:');
	climb(conn, 66);
	return conn;
};

const aniskipRows = (conn: Database.Database) =>
	(
		conn
			.prepare(`SELECT entry_id FROM episode_marks WHERE method = 'aniskip' ORDER BY entry_id`)
			.all() as { entry_id: number }[]
	).map((r) => r.entry_id);

const methods = (conn: Database.Database) =>
	conn.prepare(`SELECT entry_id, method FROM episode_marks ORDER BY entry_id, method`).all();

/** Every entry's `ending_at` is what the app's own rule chooses from the marks left. */
function agreesWithTheRule(conn: Database.Database): void {
	for (const { id } of conn.prepare(`SELECT id FROM entries`).all() as { id: number }[])
		expect(
			(conn.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id) as { ending_at: unknown })
				.ending_at,
			`entry ${id}`
		).toBe(marks.chosenMarks(id, conn).ending?.start ?? null);
}

describe('rung 67: AniSkip answers asked under another season’s entry (c463)', () => {
	it('the mirror the old lookup read is the lowest season linked, part 1', () => {
		// The premise every case below stands on: with season 0 and season 1
		// both linked, the mirror is season 0's, so a season-1 episode was asked
		// under season 0's entry, not its own.
		const old = at66();
		const s = show(
			old,
			[{ season: 1, number: 1, position: 1 }],
			[
				{ season: 1, part: 1, anilist: 11, mal: 511 },
				{ season: 0, part: 1, anilist: 10, mal: 510 }
			]
		);
		expect(s.mirrorMal).toBe(510);
	});

	it('forgets a season-1 episode asked under season 0’s entry, its own season linked or not, and asks it again', async () => {
		const old = at66();
		// Season 0 (a special) and season 1, both linked: the mirror is season 0's.
		const both = show(
			old,
			[
				{ season: 0, number: 1, position: 1 },
				{ season: 1, number: 1, position: 2 },
				{ season: 1, number: 2, position: 3 },
				{ season: 1, number: 3, position: 4 }
			],
			[
				{ season: 0, part: 1, anilist: 20, mal: 520, episodes: 1 },
				{ season: 1, part: 1, anilist: 21, mal: 521 }
			]
		);
		// Season 0 alone is linked: season 1's episodes were asked under it too.
		const alone = show(
			old,
			[
				{ season: 0, number: 1, position: 1 },
				{ season: 1, number: 1, position: 2 }
			],
			[{ season: 0, part: 1, anilist: 30, mal: 530, episodes: 1 }]
		);
		const [special, one, two, three] = both.eps;
		oldAnswer(old, special);
		oldAnswer(old, one);
		oldAnswer(old, two, false);
		oldAnswer(old, three);
		// A source mark and a fingerprint on the same entries are no AniSkip answer.
		marks.saveMark(one.id, 'source', { intro: null, ending: { start: 1200, end: 1290 } }, old, 1);
		marks.saveMark(
			three.id,
			'fingerprint',
			{ intro: null, ending: { start: 1250, end: 1340 } },
			old,
			1
		);
		oldAnswer(old, alone.eps[0]);
		oldAnswer(old, alone.eps[1]);

		climb(old, 67);
		expect(old.pragma('user_version', { simple: true })).toBe(67);
		// Season 0's own episodes were asked under their own entry and stay.
		expect(aniskipRows(old)).toEqual([special.id, alone.eps[0].id]);
		expect(methods(old)).toEqual([
			{ entry_id: special.id, method: 'aniskip' },
			{ entry_id: one.id, method: 'source' },
			{ entry_id: three.id, method: 'fingerprint' },
			{ entry_id: alone.eps[0].id, method: 'aniskip' }
		]);
		agreesWithTheRule(old);
		// The miss is gone too, so the next play asks at once rather than in a week.
		for (const e of [one, two, three, alone.eps[1]])
			expect(marks.markTriedAt(e.id, 'aniskip', old)).toBeNull();

		climb(old);
		for (const e of [one, two, three, alone.eps[1]]) await lookupAniSkip(e.id, { db: old, now: 5 });
		// Each season-1 episode asks season 1's own entry; with none, nothing is asked.
		expect(asked()).toEqual([
			[521, 1],
			[521, 2],
			[521, 3]
		]);
		expect(marks.markTriedAt(alone.eps[1].id, 'aniskip', old)).toBeNull();
	});

	it('forgets part 2 of a split season, asked under part 1 as the season’s EP. 13, and keeps part 1', async () => {
		const old = at66();
		const eps = Array.from({ length: 23 }, (_, i) => ({
			season: 1,
			number: i + 1,
			position: i + 1
		}));
		const split = show(old, eps, [
			{ season: 1, part: 1, anilist: 40, mal: 540, episodes: 12 },
			{ season: 1, part: 2, anilist: 41, mal: 541, episodes: 11 }
		]);
		expect(split.mirrorMal).toBe(540);
		const ep = (n: number) => split.eps[n - 1];
		for (const n of [1, 12, 13, 23]) oldAnswer(old, ep(n));
		oldAnswer(old, ep(14), false);

		climb(old, 67);
		expect(aniskipRows(old)).toEqual([ep(1).id, ep(12).id]);
		agreesWithTheRule(old);

		climb(old);
		for (const n of [12, 13, 14, 23]) await lookupAniSkip(ep(n).id, { db: old, now: 5 });
		// EP. 12 kept its answer and is not asked; part 2 is asked under its own
		// entry, numbered within it.
		expect(asked()).toEqual([
			[541, 1],
			[541, 2],
			[541, 11]
		]);
	});

	it('forgets every answer of a split season whose part 1 has no length, and asks part 1’s again the same', async () => {
		const old = at66();
		const eps = Array.from({ length: 4 }, (_, i) => ({
			season: 1,
			number: i + 1,
			position: i + 1
		}));
		const split = show(old, eps, [
			{ season: 1, part: 1, anilist: 42, mal: 542, episodes: null },
			{ season: 1, part: 2, anilist: 43, mal: 543, episodes: 2 }
		]);
		for (const e of split.eps) oldAnswer(old, e);
		climb(old, 67);
		expect(aniskipRows(old)).toEqual([]);
		agreesWithTheRule(old);
		climb(old);
		await lookupAniSkip(split.eps[0].id, { db: old, now: 5 });
		expect(asked()).toEqual([[542, 1]]);
	});

	it('forgets a season-0 episode asked under season 1’s entry when only season 1 is linked', async () => {
		const old = at66();
		// A special with no season at all (NULL, read as 0) beside season 1.
		const s = show(
			old,
			[
				{ season: 1, number: 1, position: 1 },
				{ season: null, number: null, position: 2 }
			],
			[{ season: 1, part: 1, anilist: 50, mal: 550 }]
		);
		const [one, special] = s.eps;
		oldAnswer(old, one);
		oldAnswer(old, special);
		climb(old, 67);
		expect(aniskipRows(old)).toEqual([one.id]);
		agreesWithTheRule(old);
		climb(old);
		await lookupAniSkip(special.id, { db: old, now: 5 });
		expect(asked()).toEqual([]);
	});

	it('keeps every answer asked under the episode’s own entry', () => {
		const old = at66();
		// A flat list linked as season 0; a season-1 show; seasons 1 and 2 (whose
		// season-2 answer only c349 could ask); a season in one part of unknown
		// length; and a link from before rung 62, with no season rows.
		const flat = show(
			old,
			[
				{ season: null, number: null, position: 1 },
				{ season: 0, number: 2, position: 2 }
			],
			[{ season: 0, part: 1, anilist: 60, mal: 560 }]
		);
		const two = show(
			old,
			[
				{ season: 1, number: 1, position: 1 },
				{ season: 2, number: 1, position: 2 }
			],
			[
				{ season: 1, part: 1, anilist: 61, mal: 561 },
				{ season: 2, part: 1, anilist: 62, mal: 562 }
			]
		);
		const unknown = show(
			old,
			[
				{ season: 1, number: 1, position: 1 },
				{ season: 1, number: 20, position: 2 }
			],
			[{ season: 1, part: 1, anilist: 63, mal: 563, episodes: null }]
		);
		const legacyId = ++nextSeries;
		old
			.prepare(
				`INSERT INTO series (id, root_id, title, kind, added_at, origin_key) VALUES (?, 1, 'Old', 'anime', 0, 'a:old')`
			)
			.run(legacyId);
		old
			.prepare(
				`INSERT INTO series_links (series_id, anilist_id, mal_id, via, linked_at, format) VALUES (?, 64, 564, 'review', 0, 'TV')`
			)
			.run(legacyId);
		const legacyEps = [1, 2].map((n) => {
			const id = ++nextEntry;
			old
				.prepare(
					`INSERT INTO entries (id, series_id, position, label, added_at, source_url, season, episode_number, duration_s)
					VALUES (?, ?, ?, 'Ep.', 0, ?, ?, ?, 1440)`
				)
				.run(id, legacyId, n, `/old/${n}`, n === 1 ? null : 1, n);
			return { id, season: n === 1 ? null : 1, number: n, position: n };
		});
		const kept = [...flat.eps, ...two.eps, ...unknown.eps, ...legacyEps];
		for (const e of kept) oldAnswer(old, e);
		const before = old.prepare(`SELECT * FROM episode_marks ORDER BY entry_id`).all();
		const endings = old.prepare(`SELECT id, ending_at FROM entries ORDER BY id`).all();
		climb(old, 67);
		expect(old.prepare(`SELECT * FROM episode_marks ORDER BY entry_id`).all()).toEqual(before);
		expect(old.prepare(`SELECT id, ending_at FROM entries ORDER BY id`).all()).toEqual(endings);
	});
});
