import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PlannedSeries } from '$lib/import/plan';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';
delete process.env.SUWAYOMI_URL;

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
/** What the fake engine's /challenges says. */
let challenges: { solving: Record<string, number>; solved: Record<string, number> } = {
	solving: {},
	solved: {}
};
let server: Server;

const manga = (sourceId: string, page: number, i: number) => ({
	url: `/s${sourceId}/p${page}-${i}`,
	title: `Series ${page}-${i}`,
	author: 'Someone',
	status: 1,
	thumbnail_url: `http://engine/image/tok${page}${i}`
});

beforeAll(async () => {
	server = createServer((req, res) => {
		if (req.url === '/challenges')
			return res
				.writeHead(200, { 'content-type': 'application/json' })
				.end(JSON.stringify(challenges));
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
	process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
});
beforeEach(() => {
	calls = [];
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
