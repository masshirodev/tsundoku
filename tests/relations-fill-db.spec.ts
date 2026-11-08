import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Candidate } from '$lib/library/catalogue';

/**
 * The relation cache's own timer (card c839; doc/LINKS.md, "How the cache
 * fills"). The database is a file, not `:memory:`: the last two describes
 * reach it from a second process, as `yarn run links` and the served app do.
 *
 * The stand-in answers as AniList does, measured on 2026-11-08 and quoted in
 * tests/other-forms-db.spec.ts: one id it can't answer is HTTP 404 and **every**
 * alias of the request null, the good ones too.
 */
const work = mkdtempSync(
	join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-fill-db-')
);
process.env.DATABASE_PATH = join(work, 'fill.db');
process.env.TRASH_DIR = join(work, 'trash');
delete process.env.TSUNDOKU_ANILIST;
delete process.env.TSUNDOKU_ANILIST_URL;

const { closeDb, getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const rel = await import('$lib/server/relations');
const cat = await import('$lib/server/catalogue');
const seasons = await import('$lib/server/season-links');
const fill = await import('$lib/server/relations-fill');

const NOW = Date.UTC(2026, 10, 8, 12);
const TICK = fill.FILL_EVERY_MS;
const db = getDb();
seedSample(db, NOW);

const node = (id: number, type: string, format: string, year = 2000) => ({
	id,
	type,
	format,
	status: 'FINISHED',
	episodes: 12,
	chapters: null,
	volumes: null,
	startDate: { year },
	title: { english: `Entry ${id}`, romaji: `Entry ${id}`, native: null }
});
const WORLD = new Map<number, ReturnType<typeof node> & { relations: unknown }>();
const world = (
	id: number,
	type: string,
	format: string,
	edges: { relationType: string; node: ReturnType<typeof node> }[] = [],
	year = 2000
) => WORLD.set(id, { ...node(id, type, format, year), relations: { edges } });
/** Two seasons: `base` names its SEQUEL, the sequel its PREQUEL. */
const chain = (base: number) => {
	world(base, 'ANIME', 'TV', [
		{ relationType: 'SEQUEL', node: node(base + 1, 'ANIME', 'TV', 2001) }
	]);
	world(
		base + 1,
		'ANIME',
		'TV',
		[{ relationType: 'PREQUEL', node: node(base, 'ANIME', 'TV', 2000) }],
		2001
	);
	return base;
};

let requests = 0;
let asked: number[] = [];
/** Runs before a request is answered: hold it, or answer it some other way. */
let before: ((n: number) => Promise<Response | void> | Response | void) | null = null;
const heard = () => {
	requests = 0;
	asked = [];
};

function answer(body: { query: string; variables: Record<string, unknown> }) {
	const wanted = [
		...body.query.matchAll(/m(\d+):\s*Media\(id:\s*\$i(\d+),\s*type:\s*(\w+)\)/g)
	].map((m) => ({ alias: `m${m[1]}`, id: Number(body.variables[`i${m[2]}`]), type: m[3] }));
	asked.push(...wanted.map((w) => w.id));
	const held = (w: (typeof wanted)[number]) => {
		const m = WORLD.get(w.id);
		return m?.type === w.type ? m : null;
	};
	if (wanted.some((w) => !held(w)))
		return {
			status: 404,
			payload: {
				errors: [{ message: 'Not Found.', status: 404 }],
				data: Object.fromEntries(wanted.map((w) => [w.alias, null]))
			}
		};
	return {
		status: 200,
		payload: { data: Object.fromEntries(wanted.map((w) => [w.alias, held(w)])) }
	};
}

const standIn: typeof fetch = async (_url, init) => {
	const n = ++requests;
	const instead = await before?.(n);
	if (instead) return instead;
	const { status, payload } = answer(JSON.parse(String(init?.body)));
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' }
	});
};

let serial = 0;
const root = (db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number })
	.id;
const series = (t: string, kind: string) =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, in_library, hue)
				VALUES (?, ?, ?, ?, ?, 1, 30)`
			)
			.run(root, t, kind, NOW, `fill:${++serial}`).lastInsertRowid
	);
const entry = (anilistId: number, format: string): Candidate => ({
	anilistId,
	malId: null,
	title: `Linked ${anilistId}`,
	alts: [],
	format,
	country: 'JP',
	year: 2000,
	chapters: null,
	volumes: null,
	episodes: 12,
	season: null,
	seasonYear: null,
	status: 'FINISHED',
	coverUrl: ''
});
const anime = (t: string, anilist: number, at = NOW) => {
	const id = series(t, 'anime');
	db.prepare(
		`INSERT INTO entries (series_id, position, label, added_at, source_url, season, episode_number)
		VALUES (?, 1, 'Ep.', ?, ?, 1, 1)`
	).run(id, NOW, `/f/${id}`);
	expect(seasons.linkSeason(id, 1, 1, entry(anilist, 'TV'), 'review', at)).toBe(true);
	return id;
};
const comic = (t: string, kind: string, anilist: number, format: string, at = NOW) => {
	const id = series(t, kind);
	cat.link(id, entry(anilist, format), 'review', at);
	return id;
};
const row = (id: number) =>
	db
		.prepare(`SELECT graph, fetched_at, tried_at FROM series_relations WHERE series_id = ?`)
		.get(id) as { graph: string | null; fetched_at: number | null; tried_at: number } | undefined;
const graphOf = (id: number) => {
	const g = row(id)?.graph;
	return g ? (JSON.parse(g) as { nodes: Record<string, { edges: unknown }> }) : null;
};
const fresh = () => {
	for (const t of ['series_relations', 'series_season_links', 'series_links'])
		db.prepare(`DELETE FROM ${t}`).run();
	db.prepare(`DELETE FROM settings WHERE key = 'link_pass_until'`).run();
	WORLD.clear();
	before = null;
	heard();
	cat.setAnilistFetch(standIn, 0);
};
const FAR = 1e9;
const quietly = () => ({
	log: vi.spyOn(console, 'log').mockImplementation(() => {}),
	error: vi.spyOn(console, 'error').mockImplementation(() => {})
});
const idle = () => ({ refreshed: 0, failed: 0, dropped: 0, skipped: false, unreachable: false });

afterEach(() => {
	vi.restoreAllMocks();
	cat.setAnilistFetch(null);
});

describe('when the timer runs at all (c839)', () => {
	const url = 'http://127.0.0.1:1';
	it.each([
		['nothing set, the shipped case', {}, { first: fill.FIRST_FILL_MS, every: fill.FILL_EVERY_MS }],
		['off', { TSUNDOKU_ANILIST: 'off' }, null],
		['off beats a stand-in', { TSUNDOKU_ANILIST: 'off', TSUNDOKU_ANILIST_URL: url }, null],
		['a stand-in, which runs its own passes', { TSUNDOKU_ANILIST_URL: url }, null],
		['a stand-in, garbage', { TSUNDOKU_ANILIST_URL: url, TSUNDOKU_RELATIONS_FILL_MS: 'x' }, null],
		['a stand-in, zero', { TSUNDOKU_ANILIST_URL: url, TSUNDOKU_RELATIONS_FILL_MS: '0' }, null],
		['a stand-in, negative', { TSUNDOKU_ANILIST_URL: url, TSUNDOKU_RELATIONS_FILL_MS: '-5' }, null],
		[
			'a stand-in that asks',
			{ TSUNDOKU_ANILIST_URL: url, TSUNDOKU_RELATIONS_FILL_MS: '200' },
			{ first: 200, every: 200 }
		],
		[
			'the interval, with no stand-in beside it, is ignored',
			{ TSUNDOKU_RELATIONS_FILL_MS: '200' },
			{ first: fill.FIRST_FILL_MS, every: fill.FILL_EVERY_MS }
		]
	])('%s', (_name, env, expected) => {
		expect(fill.fillCadence(env as NodeJS.ProcessEnv)).toEqual(expected);
	});

	it('keeps the worst case inside one interval, with room beside it', () => {
		// doc comment in relations-fill.ts: 10 anime x (14 rounds + 5 re-asks) +
		// the comics' 11, at the queue's 2.1 s. Changing a limit changes this.
		const worstRequests = 10 * (14 + 5) + 11;
		expect(worstRequests * 2.1).toBeLessThan(TICK / 1000);
		expect((worstRequests * 60_000) / TICK).toBeLessThanOrEqual(20.1);
	});
});

describe('the ticks (c839)', () => {
	it('skips a tick that finds a pass running, and does not queue it', async () => {
		let release!: (r: ReturnType<typeof idle>) => void;
		const calls: number[] = [];
		const loop = fill.fillLoop({ first: FAR, every: FAR }, () => {
			calls.push(Date.now());
			return new Promise((r) => (release = r));
		});
		const running = loop.tick();
		await loop.tick();
		await loop.tick();
		expect(calls).toHaveLength(1);
		release(idle());
		await running;
		// Skipped, not queued: nothing ran when the pass ended.
		expect(calls).toHaveLength(1);
		const next = loop.tick();
		expect(calls).toHaveLength(2);
		release(idle());
		await next;
		loop.stop();
	});

	it('runs after the first delay, then every interval, and not once stopped', async () => {
		let n = 0;
		const loop = fill.fillLoop({ first: 20, every: 20 }, async () => {
			n += 1;
			return idle();
		});
		await vi.waitFor(() => expect(n).toBeGreaterThanOrEqual(3), { timeout: 5000 });
		loop.stop();
		const at = n;
		await new Promise((r) => setTimeout(r, 80));
		expect(n).toBe(at);
	});

	it('stopped before the first tick, never ticks', async () => {
		let n = 0;
		const loop = fill.fillLoop({ first: 10, every: 10 }, async () => {
			n += 1;
			return idle();
		});
		loop.stop();
		await new Promise((r) => setTimeout(r, 60));
		expect(n).toBe(0);
	});

	it('says an unreachable AniList once, as a plain line, until a pass gets through', async () => {
		const c = quietly();
		const results = [
			{ ...idle(), unreachable: true, reason: 'x' },
			{ ...idle(), unreachable: true, reason: 'y' },
			{ ...idle(), unreachable: true, reason: 'y' },
			{ ...idle(), refreshed: 1 },
			{ ...idle(), unreachable: true, reason: 'z' }
		];
		const loop = fill.fillLoop({ first: FAR, every: FAR }, async () => results.shift()!);
		for (let i = 0; i < 5; i++) await loop.tick();
		loop.stop();
		const lines = c.log.mock.calls.map((a) => String(a[0]));
		expect(lines).toEqual([
			'[relations] AniList is unreachable: the next pass carries on',
			'[relations] AniList is unreachable: the next pass carries on'
		]);
		expect(c.error).not.toHaveBeenCalled();
	});

	it('survives a locked database and a bug: one line for the first, an error for the second', async () => {
		const c = quietly();
		const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
		let turn = 0;
		const loop = fill.fillLoop({ first: FAR, every: FAR }, async () => {
			turn += 1;
			if (turn <= 2) throw busy;
			throw new Error('a real bug');
		});
		await loop.tick();
		await loop.tick();
		expect(c.log.mock.calls.map((a) => String(a[0]))).toEqual([
			'[relations] the database is busy: the next pass carries on'
		]);
		expect(c.error).not.toHaveBeenCalled();
		await loop.tick();
		expect(c.error).toHaveBeenCalledOnce();
		loop.stop();
	});

	// A real process: a timer that isn't unref'd never lets one end. The timeout's
	// SIGTERM would reach the fill's own handler and end it with status 0, so it
	// is the timeout (`error`) that says it hung, not the exit.
	const child = (code: string, env: Record<string, string> = {}) =>
		spawnSync(
			process.execPath,
			[
				'--experimental-strip-types',
				'--disable-warning=ExperimentalWarning',
				'--input-type=module',
				'-e',
				`const { startRelationsFill } = await import('./src/lib/server/relations-fill.ts');\n${code}`
			],
			{
				encoding: 'utf8',
				timeout: 25_000,
				env: { ...process.env, NODE_NO_WARNINGS: '1', ...env }
			}
		);

	it('does not hold the process open for its first tick, and leaves no signal handler behind', () => {
		const r = child(
			`const before = process.listenerCount('SIGTERM');
			const stop = startRelationsFill({ HOME: '/nowhere' });
			if (typeof stop !== 'function' || process.listenerCount('SIGTERM') !== before + 1) process.exit(3);
			stop();
			if (process.listenerCount('SIGTERM') !== before) process.exit(4);
			startRelationsFill({ HOME: '/nowhere' });`
		);
		expect(r.error).toBeUndefined();
		expect(r.stderr).toBe('');
		expect(r.status).toBe(0);
	}, 60_000);

	it('does not hold the process open between ticks either', () => {
		// Something else holds it past the first tick, so the interval exists.
		const r = child(
			`startRelationsFill({
				TSUNDOKU_ANILIST_URL: 'http://127.0.0.1:1',
				TSUNDOKU_RELATIONS_FILL_MS: '50'
			});
			setTimeout(() => {}, 1500);`,
			{ DATABASE_PATH: join(work, 'between-ticks.db'), TSUNDOKU_ANILIST_URL: 'http://127.0.0.1:1' }
		);
		expect(r.error).toBeUndefined();
		expect(r.status).toBe(0);
	}, 60_000);
});

describe('the fill, past every limit (c839)', () => {
	it('gets every series its graph, a dead link costs the rest nothing, and then it asks nothing', async () => {
		fresh();
		// Dead first, so a failure that stayed at the front would be seen.
		const deadAnime = [anime('Dead Show 1', 900_001), anime('Dead Show 2', 900_002)];
		const liveAnime = Array.from({ length: 24 }, (_, i) =>
			anime(`Show ${i}`, chain(100_000 + i * 10))
		);
		const deadComics = [
			comic('Dead Comic 1', 'manga', 900_101, 'MANGA'),
			comic('Dead Comic 2', 'manhwa', 900_102, 'MANGA'),
			comic('Dead Comic 3', 'novel', 900_103, 'NOVEL')
		];
		const kinds: [string, string][] = [
			['manga', 'MANGA'],
			['manhwa', 'MANGA'],
			['novel', 'NOVEL']
		];
		const liveComics = Array.from({ length: 67 }, (_, i) => {
			const [kind, format] = kinds[i % 3];
			world(200_000 + i, 'MANGA', format);
			return comic(`Comic ${i}`, kind, 200_000 + i, format);
		});
		const perPass: number[] = [];
		for (let i = 0; i < 8; i++) {
			heard();
			const r = await cat.fillRelations({ now: NOW + (i + 1) * TICK });
			expect(r).toMatchObject({ skipped: false, unreachable: false });
			perPass.push(requests);
		}
		for (const id of [...liveAnime, ...liveComics])
			expect(graphOf(id), `series ${id}`).not.toBeNull();
		for (const id of [...deadAnime, ...deadComics]) {
			expect(row(id)?.graph, `series ${id}`).toBeNull();
			expect(row(id)?.tried_at).toBeGreaterThan(NOW);
		}
		// Comics: at most one request of ten, then ten alone if a dead one voids it.
		expect(Math.max(...perPass)).toBeLessThanOrEqual(10 * (14 + 1) + 11);
		// The steady state: the cache full, the dead ones waiting, nothing asked.
		const after = NOW + 9 * TICK;
		expect(rel.relationsStale(deadAnime[0], after)).toBe(true);
		heard();
		await expect(cat.fillRelations({ now: after })).resolves.toMatchObject({
			refreshed: 0,
			failed: 0
		});
		expect(requests).toBe(0);
		// A day on, only what failed is asked again.
		heard();
		await cat.fillRelations({ now: NOW + rel.RELATIONS_RETRY_MS + 9 * TICK });
		expect(new Set(asked)).toEqual(new Set([900_001, 900_002, 900_101, 900_102, 900_103]));
		for (const id of liveAnime) expect(row(id)?.fetched_at).toBeLessThan(NOW + 9 * TICK);
	}, 60_000);

	it('keeps asking a series with a good graph each seven days, and a failed refresh keeps the graph', async () => {
		fresh();
		chain(100_000);
		const show = anime('A Show', 100_000);
		await cat.fillRelations({ now: NOW });
		const before7 = row(show)!;
		expect(before7.graph).not.toBeNull();
		const later = NOW + rel.RELATIONS_STALE_MS;
		heard();
		await cat.fillRelations({ now: later - 1 });
		expect(requests).toBe(0);
		await cat.fillRelations({ now: later });
		expect(row(show)!.fetched_at).toBe(later);
		WORLD.clear();
		const failing = later + rel.RELATIONS_STALE_MS;
		await cat.fillRelations({ now: failing });
		expect(row(show)).toMatchObject({ fetched_at: later, tried_at: failing });
		expect(row(show)!.graph).not.toBeNull();
		heard();
		await cat.fillRelations({ now: failing + TICK });
		expect(requests).toBe(0);
	});

	it('does not make a series that just failed wait when its link has changed since', async () => {
		fresh();
		const show = anime('Relink Show', 900_200, NOW);
		const book = comic('Relink Comic', 'manga', 900_201, 'MANGA', NOW);
		await cat.fillRelations({ now: NOW + TICK });
		expect(row(show)!.tried_at).toBe(NOW + TICK);
		expect(row(book)!.tried_at).toBe(NOW + TICK);
		chain(300_000);
		world(300_100, 'MANGA', 'MANGA');
		const at = NOW + 2 * TICK;
		heard();
		await cat.fillRelations({ now: at });
		expect(requests).toBe(0);
		expect(seasons.linkSeason(show, 1, 1, entry(300_000, 'TV'), 'review', at + 1)).toBe(true);
		cat.link(book, entry(300_100, 'MANGA'), 'review', at + 1);
		await cat.fillRelations({ now: at + 2 });
		expect(graphOf(show)).not.toBeNull();
		expect(graphOf(book)).not.toBeNull();
	});

	it('asks at once for a good graph an UNDO has made wrong, though the link is old', async () => {
		fresh();
		const show = anime('Undo Show', chain(300_000), NOW);
		await cat.fillRelations({ now: NOW + TICK });
		expect(row(show)!.fetched_at).toBe(NOW + TICK);
		// What an UNDO writes: the link it puts back keeps its old `linked_at`,
		// so no link is newer than the last ask, and the ask did not fail.
		chain(310_000);
		expect(seasons.linkSeason(show, 1, 1, entry(310_000, 'TV'), 'review', NOW - 1000)).toBe(true);
		expect(rel.relationsStale(show, NOW + 2 * TICK)).toBe(true);
		heard();
		await cat.fillRelations({ now: NOW + 2 * TICK });
		expect(asked).toContain(310_000);
		expect(row(show)!.fetched_at).toBe(NOW + 2 * TICK);
	});

	it('drops a row whose series has no link any more, and an idle pass writes nothing', async () => {
		fresh();
		const book = comic('Unlinked Comic', 'manga', 300_200, 'MANGA');
		world(300_200, 'MANGA', 'MANGA');
		await cat.fillRelations({ now: NOW });
		expect(row(book)).toBeDefined();
		db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(book);
		await expect(cat.fillRelations({ now: NOW + TICK })).resolves.toMatchObject({ dropped: 1 });
		expect(row(book)).toBeUndefined();
		// A DELETE of no rows still takes the write lock, so the idle tick must not run one.
		const prepared = vi.spyOn(db, 'prepare');
		await cat.fillRelations({ now: NOW + 2 * TICK });
		expect(
			prepared.mock.calls.map((c) => String(c[0])).filter((q) => /^\s*DELETE/.test(q))
		).toEqual([]);
	});
});

describe('Unreachable and a 429 (c839)', () => {
	it('stops the pass, stamps nothing, and the next tick asks as if nothing happened', async () => {
		fresh();
		chain(100_000);
		const show = anime('An Offline Show', 100_000);
		world(200_000, 'MANGA', 'MANGA');
		const book = comic('An Offline Comic', 'manga', 200_000, 'MANGA');
		before = () => {
			throw new TypeError('fetch failed');
		};
		const r = await cat.fillRelations({ now: NOW });
		expect(r).toMatchObject({ unreachable: true, refreshed: 0 });
		expect(r.reason).toContain('fetch failed');
		expect(row(show)).toBeUndefined();
		expect(row(book)).toBeUndefined();
		expect(requests).toBe(1);
		before = null;
		await expect(cat.fillRelations({ now: NOW + TICK })).resolves.toMatchObject({
			unreachable: false
		});
		expect(graphOf(show)).not.toBeNull();
		expect(graphOf(book)).not.toBeNull();
	});

	it('asks nothing while switched off', async () => {
		fresh();
		chain(100_000);
		anime('A Quiet Show', 100_000);
		process.env.TSUNDOKU_ANILIST = 'off';
		try {
			await expect(cat.fillRelations({ now: NOW })).resolves.toMatchObject({ unreachable: true });
			expect(requests).toBe(0);
		} finally {
			delete process.env.TSUNDOKU_ANILIST;
		}
	});

	it('waits a 429 as long as it says, and the next tick cannot join the wait', async () => {
		fresh();
		chain(100_000);
		const show = anime('A Rate Limited Show', 100_000);
		const c = quietly();
		const at: number[] = [];
		before = (n) => {
			at.push(Date.now());
			if (n === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
		};
		const loop = fill.fillLoop({ first: FAR, every: FAR }, (o) =>
			cat.fillRelations({ ...o, now: NOW })
		);
		const running = loop.tick();
		await vi.waitFor(() => expect(requests).toBe(1));
		// Inside the wait: a tick now is the tick the interval would have fired.
		await loop.tick();
		await new Promise((r) => setTimeout(r, 100));
		expect(requests).toBe(1);
		await running;
		loop.stop();
		expect(graphOf(show)).not.toBeNull();
		expect(at[1] - at[0]).toBeGreaterThanOrEqual(950);
		expect(c.error).not.toHaveBeenCalled();
	});

	it('takes three 429s for an unreachable AniList, quietly, and asks no faster for it', async () => {
		fresh();
		chain(100_000);
		const show = anime('Always Limited', 100_000);
		before = () => new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
		const r = await cat.fillRelations({ now: NOW });
		expect(r).toMatchObject({ unreachable: true, reason: 'rate limited' });
		expect(requests).toBe(3);
		// Not a failure of the series: it isn't kept waiting a day for it.
		expect(row(show)).toBeUndefined();
	});
});

const html = (status: number) => () =>
	new Response(`<html>${status} Bad Gateway</html>`, {
		status,
		headers: { 'content-type': 'text/html' }
	});
const json = (status: number, payload: unknown) => () =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' }
	});
const relationRows = () =>
	(db.prepare(`SELECT COUNT(*) AS n FROM series_relations`).get() as { n: number }).n;
/** `shows` anime and `books` comics, every one answerable: a library past a pass's limit. */
const library = (shows: number, books: number) => ({
	shows: Array.from({ length: shows }, (_, i) =>
		anime(`Outage Show ${i}`, chain(300_000 + i * 10))
	),
	books: Array.from({ length: books }, (_, i) => {
		world(400_000 + i, 'MANGA', 'MANGA');
		return comic(`Outage Comic ${i}`, 'manga', 400_000 + i, 'MANGA');
	})
});
/** A season of episodes the series holds beyond the one its link names. */
const holds = (id: number, season: number) =>
	db
		.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, source_url, season, episode_number)
			VALUES (?, ?, 'Ep.', ?, ?, ?, 1)`
		)
		.run(id, season, NOW, `/f/${id}/${season}`, season);

describe('AniList down as a whole (c839, round 2)', () => {
	const OUTAGES: [string, () => Response][] = [
		['status 502 with an HTML body', html(502)],
		[
			'status 503 with a JSON errors body',
			json(503, { data: null, errors: [{ message: 'Service Unavailable', status: 503 }] })
		],
		['status 500 with an empty body', () => new Response('', { status: 500 })],
		['status 504 with an empty body', () => new Response('', { status: 504 })],
		['status 520 with an HTML body', html(520)],
		['a 200 whose body is not JSON', html(200)],
		['a 404 whose body is not JSON', html(404)],
		['a 400 whose body is not JSON', html(400)],
		[
			'a 5xx whose errors all say 404',
			json(502, { data: null, errors: [{ message: 'Not Found.', status: 404 }] })
		],
		['a 403 with an HTML body', html(403)],
		['a 403 with a JSON body', json(403, { data: null, errors: [{ message: 'x', status: 403 }] })]
	];

	it.each(OUTAGES)('%s stops the pass, unstamped and quiet', async (_name, outage) => {
		fresh();
		library(25, 25);
		const c = quietly();
		before = outage;
		const r = await cat.fillRelations({ now: NOW });
		expect(r).toMatchObject({ unreachable: true, refreshed: 0, failed: 0 });
		expect(r.reason).toMatch(/^AniList \d+: /);
		expect(requests).toBe(1);
		expect(relationRows()).toBe(0);
		expect(c.error).not.toHaveBeenCalled();

		const loop = fill.fillLoop({ first: FAR, every: FAR }, (o) =>
			cat.fillRelations({ ...o, now: NOW })
		);
		for (let i = 0; i < 4; i++) await loop.tick();
		loop.stop();
		expect(requests).toBe(5);
		expect(relationRows()).toBe(0);
		expect(c.error).not.toHaveBeenCalled();
		expect(c.log.mock.calls.map((a) => String(a[0]))).toEqual([
			'[relations] AniList is unreachable: the next pass carries on'
		]);
	});

	it('costs nothing once AniList answers: the next tick gets graphs, with no day to wait', async () => {
		fresh();
		const { shows, books } = library(25, 25);
		quietly();
		before = html(502);
		for (let i = 0; i < 3; i++) await cat.fillRelations({ now: NOW + i * TICK });
		expect(relationRows()).toBe(0);

		before = null;
		heard();
		const back = await cat.fillRelations({ now: NOW + 3 * TICK });
		expect(back).toMatchObject({ unreachable: false, refreshed: 20, failed: 0 });
		for (let i = 4; i < 6; i++) await cat.fillRelations({ now: NOW + i * TICK });
		for (const id of [...shows, ...books]) expect(graphOf(id)).not.toBeNull();
		heard();
		await cat.fillRelations({ now: NOW + 6 * TICK });
		expect(requests).toBe(0);
	});

	it.each([
		[
			'a 400, as AniList answers a query it refuses',
			json(400, {
				errors: [{ message: 'Cannot query field "x" on type "Media".', status: 400 }],
				data: null
			})
		],
		[
			'a 200 with an errors array that is not a 404',
			json(200, { errors: [{ message: 'Validation', status: 422 }], data: null })
		]
	])('%s still counts against the series, so it cannot stall the pass', async (_name, wrong) => {
		fresh();
		const { shows } = library(12, 0);
		const c = quietly();
		before = wrong;
		const first = await cat.fillRelations({ now: NOW });
		expect(first).toMatchObject({ unreachable: false, refreshed: 0, failed: 10 });
		expect(requests).toBe(10);
		expect(relationRows()).toBe(10);
		expect(c.error).toHaveBeenCalledTimes(10);
		heard();
		await expect(cat.fillRelations({ now: NOW + TICK })).resolves.toMatchObject({ failed: 2 });
		expect(requests).toBe(2);
		expect(shows.every((id) => row(id)?.graph === null)).toBe(true);
		heard();
		await cat.fillRelations({ now: NOW + 2 * TICK });
		expect(requests).toBe(0);
	});

	it('keeps tried_at and the graph of a series refreshed during an outage', async () => {
		fresh();
		const { shows, books } = library(1, 1);
		await cat.fillRelations({ now: NOW });
		const kept = [row(shows[0]), row(books[0])];
		expect(kept.every((k) => k?.graph)).toBe(true);
		heard();
		before = html(502);
		const stale = NOW + rel.RELATIONS_STALE_MS + 1;
		await expect(cat.fillRelations({ now: stale })).resolves.toMatchObject({ unreachable: true });
		expect(requests).toBe(1);
		expect([row(shows[0]), row(books[0])]).toEqual(kept);
		before = null;
		await cat.fillRelations({ now: stale });
		expect(row(shows[0])?.fetched_at).toBe(stale);
	});

	it('an outage that starts between two series keeps what the first one stored', async () => {
		fresh();
		const { shows } = library(2, 0);
		before = (n) => (n === 2 ? html(502)() : undefined);
		await expect(cat.fillRelations({ now: NOW })).resolves.toMatchObject({ unreachable: true });
		expect(requests).toBe(2);
		expect(graphOf(shows[0])).not.toBeNull();
		expect(row(shows[1])).toBeUndefined();
		before = null;
		heard();
		await cat.fillRelations({ now: NOW + TICK });
		expect(requests).toBe(1);
		expect(graphOf(shows[1])).not.toBeNull();
	});

	it('an outage inside a walk stores none of that walk', async () => {
		fresh();
		const base = 500_000;
		world(base, 'ANIME', 'TV', [
			{ relationType: 'SEQUEL', node: node(base + 1, 'ANIME', 'TV', 2001) }
		]);
		world(
			base + 1,
			'ANIME',
			'TV',
			[
				{ relationType: 'PREQUEL', node: node(base, 'ANIME', 'TV', 2000) },
				{ relationType: 'SEQUEL', node: node(base + 2, 'ANIME', 'TV', 2002) }
			],
			2001
		);
		world(
			base + 2,
			'ANIME',
			'TV',
			[{ relationType: 'PREQUEL', node: node(base + 1, 'ANIME', 'TV', 2001) }],
			2002
		);
		const show = anime('A Long Chain', base);
		holds(show, 2);
		holds(show, 3);
		before = (n) => (n === 2 ? html(502)() : undefined);
		await expect(cat.fillRelations({ now: NOW })).resolves.toMatchObject({ unreachable: true });
		expect(requests).toBe(2);
		expect(row(show)).toBeUndefined();
		before = null;
		await cat.fillRelations({ now: NOW + TICK });
		expect(graphOf(show)).not.toBeNull();
	});

	it('a 502 while the comics are asked alone stores and stamps none of them', async () => {
		fresh();
		world(600_000, 'MANGA', 'MANGA');
		world(600_002, 'MANGA', 'MANGA');
		const books = [
			comic('Alone A', 'manga', 600_000, 'MANGA'),
			// Not in the world: AniList voids the request of three for this one.
			comic('Alone Dead', 'manga', 600_001, 'MANGA'),
			comic('Alone C', 'manga', 600_002, 'MANGA')
		];
		const c = quietly();
		before = (n) => (n === 3 ? html(502)() : undefined);
		await expect(cat.fillRelations({ now: NOW })).resolves.toMatchObject({ unreachable: true });
		expect(requests).toBe(3);
		expect(relationRows()).toBe(0);
		expect(c.error).not.toHaveBeenCalled();
		before = null;
		await cat.fillRelations({ now: NOW + TICK });
		expect(graphOf(books[0])).not.toBeNull();
		expect(graphOf(books[2])).not.toBeNull();
		expect(row(books[1])).toMatchObject({ graph: null, tried_at: NOW + TICK });
	});

	it('a 502 while an anime’s seasons are asked alone stores and stamps nothing', async () => {
		fresh();
		chain(700_000);
		const show = anime('Three Links', 700_000);
		holds(show, 2);
		holds(show, 3);
		// The middle season is the dead one: it voids the walk's first request.
		expect(seasons.linkSeason(show, 2, 1, entry(700_500, 'TV'), 'review', NOW)).toBe(true);
		expect(seasons.linkSeason(show, 3, 1, entry(700_001, 'TV'), 'review', NOW)).toBe(true);
		const c = quietly();
		before = (n) => (n === 2 ? html(502)() : undefined);
		await expect(cat.fillRelations({ now: NOW })).resolves.toMatchObject({ unreachable: true });
		expect(requests).toBe(2);
		expect(row(show)).toBeUndefined();
		expect(c.error).not.toHaveBeenCalled();
	});

	it('a 502 in the comics’ step keeps the graphs the anime step stored', async () => {
		fresh();
		const { shows, books } = library(1, 1);
		const c = quietly();
		before = (n) => (n === 2 ? html(502)() : undefined);
		await expect(cat.fillRelations({ now: NOW })).resolves.toMatchObject({ unreachable: true });
		expect(graphOf(shows[0])).not.toBeNull();
		expect(row(books[0])).toBeUndefined();
		expect(c.error).not.toHaveBeenCalled();
		before = null;
		heard();
		await cat.fillRelations({ now: NOW + TICK });
		expect(asked).toEqual([400_000]);
		expect(graphOf(books[0])).not.toBeNull();
	});

	it('leaves `refreshLinks` as it was: an outage there still counts against the series', async () => {
		fresh();
		const { shows } = library(1, 0);
		const c = quietly();
		before = html(502);
		const r = await cat.refreshLinks({ now: NOW, limit: 0 });
		expect(r).toMatchObject({ unreachable: false, relations: 0 });
		expect(row(shows[0])).toMatchObject({ graph: null, tried_at: NOW });
		expect(c.error).toHaveBeenCalledTimes(1);
	});
});

describe('two passes at once (c839)', () => {
	it('stands aside for a link pass in this process, and asks again once it is done', async () => {
		fresh();
		chain(100_000);
		chain(110_000);
		const a = anime('Pass A', 100_000);
		const b = anime('Pass B', 110_000);
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		before = (n) => (n === 1 ? held.then(() => undefined) : undefined);
		const pass = cat.refreshLinks({ limit: 0, relations: 1, now: NOW });
		await vi.waitFor(() => expect(requests).toBe(1));
		expect(rel.linkPassRunning()).toBe(true);
		await expect(cat.fillRelations({ now: NOW })).resolves.toMatchObject({ skipped: true });
		expect(requests).toBe(1);
		release();
		await pass;
		expect(rel.linkPassRunning()).toBe(false);
		await expect(cat.fillRelations({ now: NOW + TICK })).resolves.toMatchObject({ skipped: false });
		expect(graphOf(a)).not.toBeNull();
		expect(graphOf(b)).not.toBeNull();
	});

	it('gives way, at the next series, to a link pass that starts while it runs', async () => {
		fresh();
		const shows = [chain(100_000), chain(110_000), chain(120_000)].map((id, i) =>
			anime(`Yield ${i}`, id)
		);
		before = (n) => {
			if (n === 1) rel.markLinkPass();
		};
		await cat.fillRelations({ now: NOW });
		rel.clearLinkPass();
		expect(graphOf(shows[0])).not.toBeNull();
		expect(row(shows[1])).toBeUndefined();
		expect(row(shows[2])).toBeUndefined();
	});

	it('stops at the next series on shutdown, and what it wrote is whole', async () => {
		fresh();
		const shows = [chain(100_000), chain(110_000)].map((id, i) => anime(`Stop ${i}`, id));
		let stopping = false;
		before = (n) => {
			if (n === 1) stopping = true;
		};
		await cat.fillRelations({ now: NOW, stop: () => stopping });
		expect(graphOf(shows[0])).not.toBeNull();
		expect(row(shows[1])).toBeUndefined();
	});

	it('forgets a claim whose pass died', () => {
		fresh();
		rel.markLinkPass(Date.now() - 16 * 60 * 1000);
		expect(rel.linkPassRunning()).toBe(false);
		rel.clearLinkPass();
	});

	it('races stamps safely: a failure beside a stored graph keeps the graph', async () => {
		fresh();
		chain(100_000);
		const show = anime('Racing Show', 100_000);
		// One pass answered, the other not: the order a second process makes.
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		let first = true;
		const ask: Parameters<typeof rel.refreshRelations>[0] = async (q, v) => {
			if (first) {
				first = false;
				await held;
				return Object.fromEntries([...q.matchAll(/m(\d+):/g)].map((m) => [`m${m[1]}`, null]));
			}
			return (answer({ query: q, variables: v }).payload as { data: unknown }).data;
		};
		const failing = rel.refreshRelations(ask, { now: NOW });
		const answered = rel.refreshRelations(ask, { now: NOW });
		await answered;
		expect(graphOf(show)).not.toBeNull();
		const stored = row(show)!;
		release();
		await failing;
		expect(row(show)).toMatchObject({
			graph: stored.graph,
			fetched_at: stored.fetched_at,
			tried_at: NOW
		});
	});
});

describe('the doors: a second process and the running app (c839)', () => {
	let anilist: Server;
	let port = 0;
	let child: ChildProcess | null = null;

	beforeAll(async () => {
		// The same answers as `standIn`, over the wire, so the second process
		// meets what the first does.
		anilist = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (c: Buffer) => chunks.push(c));
			req.on('end', () => {
				void (async () => {
					const n = ++requests;
					await before?.(n);
					const { status, payload } = answer(JSON.parse(Buffer.concat(chunks).toString('utf8')));
					res.writeHead(status, { 'content-type': 'application/json' });
					res.end(JSON.stringify(payload));
				})();
			});
		});
		await new Promise<void>((r) => anilist.listen(0, '127.0.0.1', r));
		port = (anilist.address() as { port: number }).port;
	});

	afterAll(async () => {
		// Collected, not thrown: a cleanup that throws hides the body's failure.
		if (child?.pid) child.kill();
		await new Promise<void>((r) => anilist.close(() => r()));
		try {
			closeDb();
			rmSync(work, { recursive: true, force: true });
		} catch (e) {
			console.warn('could not clear', work, e);
		}
	});

	const url = () => `http://127.0.0.1:${port}`;
	const appEnv = (extra: Record<string, string>) => {
		const home = join(work, 'home');
		mkdirSync(home, { recursive: true });
		return {
			...process.env,
			DATABASE_PATH: process.env.DATABASE_PATH!,
			TSUNDOKU_TOKEN: 'door-token',
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
			TSUNDOKU_HOME: home,
			BACKUP_DIR: join(work, 'backups'),
			ENGINE_URL: 'http://127.0.0.1:1',
			TSUNDOKU_ANILIST: '',
			TSUNDOKU_ANILIST_URL: url(),
			NODE_NO_WARNINGS: '1',
			...extra
		};
	};

	it('stands aside for `yarn run links` in another process', async () => {
		fresh();
		cat.setAnilistFetch(null);
		chain(100_000);
		const show = anime('Two Processes', 100_000);
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		before = (n) => (n === 1 ? held : undefined);
		child = spawn(
			process.execPath,
			['--experimental-strip-types', 'scripts/links.ts', '--limit', '0'],
			{ env: appEnv({}), stdio: 'ignore' }
		);
		const done = new Promise<number | null>((r) => child!.once('exit', r));
		await vi.waitFor(() => expect(requests).toBe(1), { timeout: 30_000, interval: 50 });
		expect(rel.linkPassRunning()).toBe(true);
		// The script is in its AniList call; the served app's tick stands aside.
		process.env.TSUNDOKU_ANILIST_URL = url();
		try {
			await expect(cat.fillRelations({ now: NOW })).resolves.toMatchObject({ skipped: true });
			expect(requests).toBe(1);
		} finally {
			delete process.env.TSUNDOKU_ANILIST_URL;
		}
		release();
		await expect(done).resolves.toBe(0);
		child = null;
		expect(rel.linkPassRunning()).toBe(false);
		expect(graphOf(show)).not.toBeNull();
	}, 60_000);

	it('fills a fresh link through the real init, with no manual run, then stops asking', async () => {
		fresh();
		cat.setAnilistFetch(null);
		chain(100_000);
		world(200_000, 'MANGA', 'MANGA');
		const show = anime('Door Show', 100_000);
		const book = comic('Door Comic', 'manga', 200_000, 'MANGA');
		const s = createNetServer();
		await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
		const appPort = (s.address() as { port: number }).port;
		await new Promise<void>((r) => s.close(() => r()));
		child = spawn(
			process.execPath,
			[
				'node_modules/vite/bin/vite.js',
				'dev',
				'--host',
				'127.0.0.1',
				'--port',
				String(appPort),
				'--strictPort'
			],
			{ env: appEnv({ TSUNDOKU_RELATIONS_FILL_MS: '200' }), stdio: 'ignore' }
		);
		const app = child;
		// In dev SvelteKit runs `init` on the first request reaching it; adapter-node
		// at startup (handler.js). A request the guard refuses at once is enough.
		await vi.waitFor(
			async () => {
				const r = await fetch(`http://127.0.0.1:${appPort}/api/fill-door`, { redirect: 'manual' });
				expect(r.status).toBe(401);
			},
			{ timeout: 90_000, interval: 250 }
		);
		await vi.waitFor(
			() => {
				expect(graphOf(show)).not.toBeNull();
				expect(graphOf(book)).not.toBeNull();
			},
			{ timeout: 30_000, interval: 100 }
		);
		expect(requests).toBeGreaterThan(0);
		// Nothing due: three more ticks, and not one more request.
		const settled = requests;
		await new Promise((r) => setTimeout(r, 900));
		expect(requests).toBe(settled);
		app.kill();
		child = null;
		await new Promise((r) => app.once('exit', r));
	}, 150_000);
});
