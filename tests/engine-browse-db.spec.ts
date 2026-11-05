import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PlannedSeries } from '$lib/import/plan';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';

// A novel's check is solved by the app, which checks the address is on the
// internet before the solver hears of it (novels/solver.ts, net-guard.ts).
// Names resolve as the stub says, so the test site is a public one.
const ADDRESSES: Record<string, string[]> = { 'www.novel.example': ['93.184.215.14'] };
vi.mock('node:dns/promises', () => ({
	lookup: async (host: string) => (ADDRESSES[host] ?? []).map((address) => ({ address, family: 4 }))
}));

const { getDb } = await import('$lib/server/db');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const { forgetSourceUse } = await import('$lib/server/library-sources');
const { keepPreferences, setPreference } = await import('$lib/server/engine/extensions');
const browse = await import('$lib/server/engine/browse');

// Browsing a source on the engine (doc/BROWSE.md, card c141).

const OPEN = '100';
const HIDDEN = '200';
type Call = {
	method: string;
	sourceId: string;
	page?: number;
	search?: string;
	filterList?: unknown;
};
let calls: Call[] = [];
/** How many times the fake engine's /challenges was asked. */
let challengeCalls = 0;
/** What the fake engine's /challenges says. */
let challenges: { solving: Record<string, number>; solved: Record<string, number> } = {
	solving: {},
	solved: {}
};
let server: Server;
/** Where the app's own solver is stubbed: the same fake engine, on /v1. */
let enginePort = 0;

const manga = (sourceId: string, page: number, i: number) => ({
	url: `/s${sourceId}/p${page}-${i}`,
	title: `Series ${page}-${i}`,
	author: 'Someone',
	status: 1,
	thumbnail_url: `http://127.0.0.1:8080/image/tok${page}${i}`
});

beforeAll(async () => {
	server = createServer((req, res) => {
		if (req.url === '/challenges') {
			challengeCalls++;
			return res
				.writeHead(200, { 'content-type': 'application/json' })
				.end(JSON.stringify(challenges));
		}
		// A stubbed FlareSolverr (c152): a clearance for the novel site, slow
		// enough that a test can see the solve underway.
		if (req.url === '/v1') {
			let raw = '';
			req.on('data', (c) => (raw += c));
			req.on('end', () =>
				setTimeout(
					() =>
						res.writeHead(200, { 'content-type': 'application/json' }).end(
							JSON.stringify({
								status: 'ok',
								message: 'ok',
								solution: {
									url: 'https://www.novel.example/',
									status: 200,
									userAgent: 'StubBrowser/2.0',
									cookies: [{ name: 'cf_clearance', value: 'ok', domain: '.novel.example' }]
								}
							})
						),
					40
				)
			);
			return;
		}
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw) as Call;
			calls.push(b);
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			const page = b.page ?? 1;
			switch (b.method) {
				case 'supportLatestManga':
					return json(b.sourceId === OPEN);
				case 'filterSchemaManga':
					return json([
						{ type: 'select', name: 'Status', state: 0, values: ['All', 'Ongoing'] },
						{ type: 'mystery', name: 'Dropped' }
					]);
				case 'getPopularManga':
					return json({
						// Page 2 repeats page 1's last series, as a site that shifted between asks does.
						mangas:
							page === 2
								? [manga(b.sourceId, 1, 1), manga(b.sourceId, 2, 0)]
								: [manga(b.sourceId, page, 0), manga(b.sourceId, page, 1)],
						hasNextPage: page < 3
					});
				case 'getLatestManga':
					return json({ mangas: [manga(b.sourceId, 9, 0)], hasNextPage: false });
				case 'getSearchManga':
					return json({ mangas: [manga(b.sourceId, 7, 0)], hasNextPage: false });
			}
			res.writeHead(404).end('{}');
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	enginePort = (server.address() as AddressInfo).port;
	process.env.ENGINE_URL = `http://127.0.0.1:${enginePort}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
});
beforeEach(() => {
	calls = [];
	challengeCalls = 0;
	browse.forgetAll();
	forgetSourceUse();
});

const db = getDb();
const root = ensureRoot(db, 'Mihon', '/nowhere/Mihon', false);
const series = (sourceId: string, url: string, hidden: boolean): PlannedSeries => ({
	originKey: `mihon:${sourceId}:${url}`,
	source: 'mihon',
	title: `Series of ${url}`,
	kind: 'manga',
	rating: 0,
	favourite: false,
	hidden,
	shelves: [],
	tags: [],
	description: '',
	status: '',
	direction: null,
	addedAt: 1_700_000_000_000,
	sourceUrl: url,
	path: '',
	entries: []
});
const write = (p: PlannedSeries) =>
	writeSeries(p, { rootId: root, jobId: null, now: 1_700_000_000_000, markMissing: false }, db);
// The open source: one series here, which popular lists on its first page.
write(series(OPEN, `/s${OPEN}/p1-0`, false));
// One hidden series here that popular lists too.
write(series(OPEN, `/s${OPEN}/p1-1`, true));
write(series(OPEN, '/elsewhere', false));
// The other: two of its three series here hidden, so it's mostly hidden.
write(series(HIDDEN, '/a', true));
write(series(HIDDEN, '/b', true));
// Visible, from the mostly-hidden source, and the same title as a result of the open one.
write({ ...series(HIDDEN, '/c', false), title: 'Series 3-0' });

for (const [pkg, name, id] of [
	['en.open', 'Open Source', OPEN],
	['en.hidden', 'Hidden Source', HIDDEN]
]) {
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
		VALUES (?, ?, 'manga', 1, '1.0', '1.4', ?, 0, 0)`
	).run(pkg, name, pkg.padEnd(64, 'x'));
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://example.org')`
	).run(id, pkg, name);
}

// The open source's extension also has a French and a Japanese source: BROWSE
// lists the owner's languages (EN, JA by default) and leaves French out.
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES ('101', 'en.open', 'Open Source', 'fr', ''), ('102', 'en.open', 'Open Source', 'ja', '')`
).run();

describe('BROWSE’s list', () => {
	it('lists the owner’s languages, names a language only where an extension has several', () => {
		const list = browse.browseList(false);
		expect(list.manga.map((r) => r.label)).toEqual(['Open Source · EN', 'Open Source · JA']);
		expect(list.extensions).toBe(1);
	});

	it('keeps RECENT to the last four browsed, newest first, and never a hidden source outside reveal', () => {
		browse.noteBrowsed(HIDDEN, 3_000);
		browse.noteBrowsed(OPEN, 1_000);
		browse.noteBrowsed('102', 2_000);
		browse.noteBrowsed(OPEN, 4_000);
		expect(browse.browseList(false).recent.map((r) => [r.id, r.browsedAt])).toEqual([
			[OPEN, 4_000],
			['102', 2_000]
		]);
		expect(browse.browseList(true).recent.map((r) => r.id)).toEqual([OPEN, HIDDEN, '102']);
	});

	it('counts an update only for an extension the viewer may see', () => {
		db.prepare(
			`INSERT INTO engine_repos (id, base, name, fingerprint, added_at) VALUES (9, 'https://r.example/', 'R', 'f', 0)`
		).run();
		for (const pkg of ['en.open', 'en.hidden'])
			db.prepare(`INSERT INTO engine_listings (repo_id, pkg, listing) VALUES (9, ?, ?)`).run(
				pkg,
				JSON.stringify({
					pkg,
					name: pkg,
					kind: 'manga',
					versionCode: 2,
					versionName: '2.0',
					sources: []
				})
			);
		expect(browse.browseList(false).updates).toBe(1);
		expect(browse.browseList(true).updates).toBe(2);
		db.prepare(`DELETE FROM engine_listings WHERE repo_id = 9`).run();
		db.prepare(`DELETE FROM engine_repos WHERE id = 9`).run();
	});
});

describe('which sources BROWSE names', () => {
	it('leaves a mostly-hidden source out with reveal off, counts only what may be seen', () => {
		expect(browse.browseSources(false).map((s) => [s.name, s.lang, s.series, s.hidden])).toEqual([
			['Open Source', 'en', 2, 0],
			['Open Source', 'fr', 0, 0],
			['Open Source', 'ja', 0, 0]
		]);
		expect(browse.browseSource(HIDDEN, false)).toBeNull();
	});

	it('names it with reveal on, marked, with every count', () => {
		const all = browse.browseSources(true);
		expect(all.map((s) => [s.name, s.lang, s.series, s.hidden, s.mostlyHidden])).toEqual([
			['Hidden Source', 'en', 3, 2, true],
			['Open Source', 'en', 3, 1, false],
			['Open Source', 'fr', 0, 0, false],
			['Open Source', 'ja', 0, 0, false]
		]);
	});
});

describe('a source’s shelf', () => {
	it('loads pages one to N, shows a repeated series once, and says there is more', async () => {
		const got = await browse.shelf(OPEN, 'popular', { pages: 2, reveal: false });
		expect(got.pages).toBe(2);
		expect(got.more).toBe(true);
		// p1-1 is hidden here, so with reveal off it isn't shown, nor its repeat on page 2.
		expect(got.hits.map((h) => h.title)).toEqual(['Series 1-0', 'Series 2-0']);
		expect(got.hits[0].match.kind).toBe('in-library');
		expect(got.hits[0].cover).toBe('/api/downloads/engine-image/tok10');
		expect(calls.map((c) => [c.method, c.page])).toEqual([
			['getPopularManga', 1],
			['getPopularManga', 2]
		]);
	});

	it('stops at the source’s last page however many were asked for', async () => {
		const got = await browse.shelf(OPEN, 'popular', { pages: 9, reveal: true });
		expect(got.pages).toBe(3);
		expect(got.more).toBe(false);
		expect(got.hits.map((h) => h.title)).toContain('Series 1-1');
	});

	it('asks only for the new page when MORE adds one, and nothing on a reload', async () => {
		await browse.shelf(OPEN, 'popular', { pages: 1, reveal: false });
		await browse.shelf(OPEN, 'popular', { pages: 2, reveal: false });
		await browse.shelf(OPEN, 'popular', { pages: 2, reveal: false });
		expect(calls.map((c) => c.page)).toEqual([1, 2]);
	});

	it('asks again once a setting changes, since a setting can change what a source lists', async () => {
		await browse.shelf(OPEN, 'popular', { pages: 1, reveal: false });
		keepPreferences(OPEN, [
			{
				key: 'quality',
				listPreference: {
					title: 'Quality',
					valueIndex: 0,
					entries: ['A', 'B'],
					entryValues: ['a', 'b']
				}
			}
		]);
		await browse.shelf(OPEN, 'popular', { pages: 1, reveal: false });
		expect(setPreference(OPEN, 'quality', 1)).toBe(true);
		await browse.shelf(OPEN, 'popular', { pages: 1, reveal: false });
		expect(calls.filter((c) => c.method === 'getPopularManga').length).toBe(3);
	});

	it('sends the filters as a search, and keeps a filtered answer apart from another', async () => {
		const applied = [
			{ name: 'Status', type: 'select' as const, values: ['Any', 'Ongoing'], state: 1 }
		];
		const filters = [{ name: 'Status', type: 'select', stateInt: 1 }];
		await browse.shelf(OPEN, 'filtered', { pages: 1, query: 'x', applied, reveal: false });
		await browse.shelf(OPEN, 'filtered', { pages: 1, query: 'x', applied: [], reveal: false });
		expect(calls.map((c) => [c.method, c.search, c.filterList])).toEqual([
			['getSearchManga', 'x', filters],
			['getSearchManga', 'x', []]
		]);
	});
});

describe('a twin from a mostly-hidden source', () => {
	it('is still SAME TITLE, but the source isn’t named with reveal off', async () => {
		const twin = async (reveal: boolean) =>
			(await browse.shelf(OPEN, 'popular', { pages: 3, reveal })).hits.find(
				(h) => h.title === 'Series 3-0'
			)!.match;
		expect(await twin(false)).toEqual({ kind: 'same-title', source: '' });
		expect(await twin(true)).toEqual({ kind: 'same-title', source: 'HIDDEN SOURCE' });
	});
});

describe('a site’s browser check', () => {
	it('matches a host to a source’s site, subdomains included', () => {
		expect(browse.siteOf('https://www.mangadex.org/')).toBe('mangadex.org');
		expect(browse.siteOf('not a url')).toBe('');
		expect(browse.sameSite('api.mangadex.org', 'mangadex.org')).toBe(true);
		expect(browse.sameSite('mangadex.org', 'mangadex.org')).toBe(true);
		expect(browse.sameSite('notmangadex.org', 'mangadex.org')).toBe(false);
		expect(browse.sameSite('example.org', '')).toBe(false);
	});

	it('says since when the engine has been passing it, and BROWSE remembers it after', async () => {
		challenges = { solving: { 'api.example.org': 1_000 }, solved: {} };
		expect(await browse.checkingSince(OPEN)).toBe(1_000);
		challenges = { solving: { 'elsewhere.net': 5 }, solved: {} };
		expect(await browse.checkingSince(OPEN)).toBeNull();
		expect(browse.browseList(false).manga.find((r) => r.id === OPEN)!.check).toBe(false);
		challenges = { solving: {}, solved: { 'example.org': 2_000 } };
		await browse.checkingSince(OPEN);
		expect(browse.browseList(false).manga.find((r) => r.id === OPEN)!.check).toBe(true);
		challenges = { solving: {}, solved: {} };
	});

	it('is a novel’s own, matched by its plugin’s site (c152)', async () => {
		db.prepare(
			`INSERT INTO novel_plugins (id, name, site, lang, version, hash, installed_at, updated_at, failed)
			VALUES ('shelfish', 'Shelf Novels', 'https://www.novel.example/', 'en', '1.0.0', 'h', 0, 0, '')`
		).run();
		challenges = { solving: { 'api.novel.example': 7_000 }, solved: {} };
		expect(await browse.checkingSince('ln:shelfish')).toBe(7_000);
		// A plugin that isn't installed has no site, and the engine isn't asked at all.
		challengeCalls = 0;
		expect(await browse.checkingSince('ln:absent')).toBeNull();
		expect(challengeCalls).toBe(0);
		challenges = { solving: {}, solved: { 'www.novel.example': 8_000 } };
		await browse.checkingSince('ln:shelfish');
		expect(browse.browseList(false).novels.find((r) => r.id === 'ln:shelfish')!.check).toBe(true);
		challenges = { solving: {}, solved: {} };
	});

	it('is the app’s own solve while it runs, and the engine needn’t answer (c152)', async () => {
		// This test's own preconditions: no engine solve left by the test above.
		challenges = { solving: {}, solved: {} };
		// `shelfish` is the test above's; a second plugin so neither leans on the other.
		db.prepare(
			`INSERT INTO novel_plugins (id, name, site, lang, version, hash, installed_at, updated_at, failed)
			VALUES ('junction', 'Junction Novels', 'https://www.novel.example/', 'en', '1.0.0', 'h', 0, 0, '')`
		).run();
		const solver = await import('$lib/server/novels/solver');
		const engine = process.env.ENGINE_URL;
		const stub = process.env.NOVEL_SOLVER_URL;
		// The engine is not there: a novel's live line is the app's own solve, and
		// checkingSince's catch is what must still return it.
		delete process.env.ENGINE_URL;
		process.env.NOVEL_SOLVER_URL = `http://127.0.0.1:${enginePort}/v1`;
		try {
			const running = solver.solveChallenge('https://www.novel.example/');
			await new Promise((ok) => setTimeout(ok, 10));
			expect(await browse.checkingSince('ln:junction')).toEqual(expect.any(Number));
			expect(await running).not.toBeNull();
			expect(await browse.checkingSince('ln:junction')).toBeNull();
		} finally {
			challenges = { solving: {}, solved: {} };
			process.env.ENGINE_URL = engine;
			if (stub === undefined) delete process.env.NOVEL_SOLVER_URL;
			else process.env.NOVEL_SOLVER_URL = stub;
		}
	});
});

describe('what a source can do', () => {
	it('says whether it has LATEST, and its filters, cleaned, asked once', async () => {
		expect(await browse.supportsLatest(OPEN)).toBe(true);
		expect(await browse.supportsLatest(HIDDEN)).toBe(false);
		expect(await browse.filterSchema(OPEN)).toEqual([
			{ type: 'select', name: 'Status', state: 0, values: ['All', 'Ongoing'] }
		]);
		await browse.filterSchema(OPEN);
		expect(calls.filter((c) => c.method === 'filterSchemaManga').length).toBe(1);
	});
});

describe('an extension with nothing in the owner’s languages', () => {
	it('shows all its sources, since it was installed on purpose (a pt-BR site, 2026-10-30)', () => {
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
			VALUES ('pt.livre', 'Manga Livre Blog', 'manga', 1, '1.0', '1.4', ?, 0, 0)`
		).run('pt.livre'.padEnd(64, 'x'));
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES ('201', 'pt.livre', 'Manga Livre Blog', 'pt-BR', '')`
		).run();
		const labels = browse.browseList(false).manga.map((r) => r.label);
		expect(labels).toContain('Manga Livre Blog');
		// Open Source has EN and JA, so its French one stays out.
		expect(labels.filter((l) => l.startsWith('Open Source'))).toEqual([
			'Open Source · EN',
			'Open Source · JA'
		]);
	});
});

describe('BROWSE’s lists by family (K3, c303)', () => {
	it('puts every source in its family’s list, as the old kind filters did', () => {
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
			VALUES ('en.k3anime', 'K3 Anime', 'anime', 1, '1.0', '1.4', ?, 0, 0)`
		).run('en.k3anime'.padEnd(64, 'x'));
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES ('300', 'en.k3anime', 'K3 Anime', 'en', '')`
		).run();
		for (const reveal of [false, true]) {
			const list = browse.browseList(reveal);
			const all = [...list.manga, ...list.anime, ...list.novels];
			// The filters at fb2bd3a7 (engine/browse.ts:260-262), written out.
			expect(list.manga).toEqual(all.filter((r) => r.kind === 'manga'));
			expect(list.anime).toEqual(all.filter((r) => r.kind === 'anime'));
			expect(list.novels).toEqual(all.filter((r) => r.kind === 'novel'));
			// Each list is reached: the anime source is in its own.
			expect(list.anime.map((r) => r.id)).toContain('300');
			expect(list.manga.length).toBeGreaterThan(0);
			for (const r of all)
				expect(browse.browseSources(reveal).find((s) => s.id === r.id)?.kind).toBe(r.kind);
		}
	});
});
