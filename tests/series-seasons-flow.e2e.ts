import Database from 'better-sqlite3';
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * The series screen's seasons around an anime (c358; doc/SERIES.md, "The
 * seasons around it"), end to end: the link pass run by its own script
 * (`scripts/links.ts`) against a stand-in AniList fills the relation cache,
 * and the screen draws the seasons before, NEXT SEASON and the folded extras
 * from it without asking AniList. And KEEP BOTH's note (c671), which needs a
 * decision waiting that the next library load would carry out. Both need a
 * database of their own (the shared seed has no anime, and a KEEP BOTH writes),
 * so the file seeds one, serves the build on a port the OS hands out, with a
 * stand-in AniList behind TSUNDOKU_ANILIST_URL and a stand-in engine that
 * answers nothing (BROWSE's source rows are the database's; FIND is only an
 * address here). Serial, tablet-portrait only, as every `*-flow` file.
 */
test.describe.configure({ mode: 'serial' });

const work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-ssn-'));
const dbPath = join(work, 'seasons.sqlite');
const library = join(work, 'library');
let preview: ChildProcess | null = null;
let anilist: Server | null = null;
let engine: Server | null = null;
let BASE = '';
/** Every AniList request the stand-in answered: the screen's loads must add none. */
let anilistCalls = 0;

/** The OS's own port: nothing this spec picks can collide with the suites beside it. */
function freePort(): Promise<number> {
	return new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});
}

// ---- the stand-in AniList -------------------------------------------------------------------

/**
 * The card's chain (its 'What counts'), each entry with its edges both ways
 * as AniList answers `relations { edges { relationType node } }`: a loop
 * (S5 names S1 its SEQUEL), a branch (S4's SPECIAL prequel beside its ONA
 * one), a MOVIE on the main chain, OVAs and an ONA as side stories, an ONA
 * season on the main chain, a NOT_YET_RELEASED sequel and the manga as an
 * ADAPTATION; and a show AniList lists no sequel of.
 */
type Entry = {
	id: number;
	type?: string;
	format: string;
	status?: string;
	episodes?: number | null;
	year: number | null;
	title: string;
	edges: [string, number][];
};
const WORLD: Entry[] = [
	{
		id: 101,
		year: 2019,
		format: 'TV',
		title: 'Lantern Keeper',
		edges: [
			['SEQUEL', 102],
			['SIDE_STORY', 151],
			['ADAPTATION', 900],
			['PREQUEL', 105]
		]
	},
	{
		id: 102,
		year: 2021,
		format: 'TV',
		title: 'Lantern Keeper 2nd Season',
		edges: [
			['PREQUEL', 101],
			['SEQUEL', 160],
			['SIDE_STORY', 152]
		]
	},
	{
		id: 160,
		year: 2022,
		format: 'MOVIE',
		title: 'Lantern Keeper: The Long Night',
		episodes: 1,
		edges: [
			['PREQUEL', 102],
			['SEQUEL', 103]
		]
	},
	{
		id: 103,
		year: 2023,
		format: 'ONA',
		title: 'Lantern Keeper Season 3',
		episodes: 10,
		edges: [
			['PREQUEL', 160],
			['SEQUEL', 104],
			['SIDE_STORY', 153]
		]
	},
	{
		id: 104,
		year: 2025,
		format: 'TV',
		title: 'Lantern Keeper Season 4',
		edges: [
			['PREQUEL', 170],
			['PREQUEL', 103],
			['SEQUEL', 105]
		]
	},
	{
		id: 105,
		format: 'TV',
		title: 'Lantern Keeper Season 5',
		status: 'NOT_YET_RELEASED',
		episodes: null,
		// AniList leaves an announced sequel undated, as a rule.
		year: null,
		edges: [
			['PREQUEL', 104],
			['SEQUEL', 101]
		]
	},
	{ id: 151, year: 2019, format: 'OVA', title: 'Lantern Keeper: Festival', episodes: 1, edges: [] },
	{ id: 152, year: 2021, format: 'ONA', title: 'Lantern Keeper Shorts', episodes: 8, edges: [] },
	{ id: 153, year: 2023, format: 'OVA', title: 'Lantern Keeper: Winter', episodes: 2, edges: [] },
	{ id: 170, year: 2024, format: 'SPECIAL', title: 'Lantern Keeper Recap', episodes: 1, edges: [] },
	{ id: 900, year: 2018, type: 'MANGA', format: 'MANGA', title: 'Lantern Keeper', edges: [] },
	{ id: 201, year: 2016, format: 'TV', title: 'Quiet Shore', edges: [['SEQUEL', 202]] },
	{ id: 202, year: 2018, format: 'TV', title: 'Quiet Shore 2nd Season', edges: [['PREQUEL', 201]] }
];
const byId = new Map(WORLD.map((e) => [e.id, e]));
const media = (e: Entry) => ({
	id: e.id,
	type: e.type ?? 'ANIME',
	format: e.format,
	status: e.status ?? 'FINISHED',
	episodes: e.episodes === undefined ? 12 : e.episodes,
	startDate: { year: e.year },
	title: { english: e.title, romaji: null, native: null }
});

/** What the pass asks, answered: the relations by alias, empty searches, no MAL ids resolved. */
function answer(query: string, variables: Record<string, unknown>) {
	const data: Record<string, unknown> = { Page: { media: [] } };
	for (const m of query.matchAll(/\b(s\d+):\s*Page/g)) data[m[1]] = { media: [] };
	for (const m of query.matchAll(/\bm(\d+):\s*Media\(id:\s*\$i(\d+)/g)) {
		const e = byId.get(Number(variables[`i${m[2]}`]));
		data[`m${m[1]}`] = e
			? {
					...media(e),
					relations: {
						edges: e.edges.map(([relationType, to]) => ({
							relationType,
							node: media(byId.get(to)!)
						}))
					}
				}
			: null;
	}
	return data;
}

// ---- the library ------------------------------------------------------------------------------

/** The anime source the series come from: BROWSE lists it from these rows. */
const SOURCE = { id: '9300', name: 'Lantern Streams' };

type Ids = {
	s4: number;
	s2: number;
	shore: number;
	unlinked: number;
	twin: number;
	earlier: string;
};

/** The sample library, then this file's anime and their season links (rows only). */
function seed(): Ids {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, LIBRARY_ROOT: library, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 7, 12, 0);
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES ('e2e.lantern', ?, 'anime', 1, '1', '1', ?, 0, 0, '')`
		).run(SOURCE.name, 'e2e.lantern'.padEnd(64, '0'));
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'e2e.lantern', ?, 'en', 'https://lantern.example')`
		).run(SOURCE.id, SOURCE.name);
		const anime = (title: string, seasons: number[]) => {
			const id = Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
						VALUES (?, ?, 'anime', 'aniyomi', 210, ?, ?, ?, 1, '')`
					)
					.run(root, title, now, now, `aniyomi:${SOURCE.id}:/${title.replace(/\W+/g, '-')}`)
					.lastInsertRowid
			);
			const put = db.prepare(
				`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
				VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, 0, ?)`
			);
			let position = 0;
			for (const season of seasons)
				for (let n = 1; n <= 3; n++) {
					position += 1;
					put.run(id, position, `Episode ${n}`, season, n, now, `/${id}/${season}/${n}`);
				}
			return id;
		};
		const link = (id: number, season: number, anilistId: number) =>
			db
				.prepare(
					`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, title, linked_at, resolved_at, format)
					VALUES (?, ?, 1, ?, 'review', ?, ?, ?, 'TV')`
				)
				.run(id, season, anilistId, byId.get(anilistId)!.title, now, now);
		const s4 = anime('Lantern Keeper Season 4', [4]);
		link(s4, 4, 104);
		// Season 2 is in the library as its own series, by its own link.
		const s2 = anime('Lantern Keeper II', [1]);
		link(s2, 1, 102);
		const shore = anime('Quiet Shore Season 2', [2]);
		link(shore, 2, 202);
		const unlinked = anime('Lantern Keeper Season 6', [6]);
		// The seed's own queue is not this file's: settled, so the pass searches none of it.
		db.prepare(
			`INSERT OR REPLACE INTO link_decisions (series_id, decision, at) SELECT id, 'none', ? FROM series`
		).run(now);

		// KEEP BOTH (c671): the seed's twin pair, and a FOLD waiting from before
		// that the library will refuse (two series of several entries: only a
		// single book folds), as tests/dupes-db.spec.ts' case.
		const twin = (
			db.prepare(`SELECT id FROM series WHERE title = 'Rakugaki Collection Vol. 3'`).get() as {
				id: number;
			}
		).id;
		const many = db
			.prepare(
				`SELECT e.series_id AS id, MIN(e.id) AS entry FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.kind = 'manga' GROUP BY e.series_id HAVING COUNT(*) > 1 ORDER BY e.series_id LIMIT 2`
			)
			.all() as { id: number; entry: number }[];
		const [ea, eb] = [many[0].entry, many[1].entry].sort((x, y) => x - y);
		db.prepare(`INSERT INTO dupe_pairs (a, b, bits, rows, found_at) VALUES (?, ?, 0, ?, 1)`).run(
			ea,
			eb,
			JSON.stringify({ rows: [{ a: 1, b: 1 }], sizes: { [ea]: [0, 0], [eb]: [0, 0] } })
		);
		return { s4, s2, shore, unlinked, twin, earlier: `${ea},${eb}` };
	} finally {
		db.close();
	}
}

const ids = seed();

/**
 * The pass, by its own door: `yarn run links` with no search, against the
 * stand-in. Asynchronous: the stand-in answers from this process, which a
 * synchronous child would hold until AniList's own 20 s timeout.
 */
async function runPass(anilistPort: number): Promise<string> {
	const { stdout } = await promisify(execFile)(
		process.execPath,
		['--experimental-strip-types', 'scripts/links.ts', '--limit', '0'],
		{
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				LIBRARY_ROOT: library,
				TSUNDOKU_ANILIST_URL: `http://127.0.0.1:${anilistPort}`,
				TSUNDOKU_ANILIST: '',
				NODE_NO_WARNINGS: '1'
			},
			encoding: 'utf8'
		}
	);
	return stdout;
}

test.beforeAll(async () => {
	// The hook seeds, runs the pass against the stand-in (about 2 s a request,
	// AniList's own spacing) and waits for its own preview: the house budget
	// is 120 s so a loaded box fails a case, never the hook (c599).
	test.setTimeout(120_000);
	const anilistPort = await freePort();
	anilist = createServer((req: IncomingMessage, res: ServerResponse) => {
		let body = '';
		req.on('data', (b: Buffer) => (body += b.toString()));
		req.on('end', () => {
			anilistCalls += 1;
			const { query, variables } = JSON.parse(body || '{}') as {
				query: string;
				variables: Record<string, unknown>;
			};
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ data: answer(query ?? '', variables ?? {}) }));
		});
	});
	await new Promise<void>((ok) => anilist!.listen(anilistPort, '127.0.0.1', ok));
	const enginePort = await freePort();
	// An engine that answers nothing it is asked: the screen's downloads say so.
	engine = createServer((_req, res) => {
		res.writeHead(503, { 'content-type': 'application/json' });
		res.end('{}');
	});
	await new Promise<void>((ok) => engine!.listen(enginePort, '127.0.0.1', ok));

	const log = await runPass(anilistPort);
	const db = new Database(dbPath, { readonly: true });
	try {
		const cached = db
			.prepare(`SELECT series_id FROM series_relations WHERE graph IS NOT NULL ORDER BY series_id`)
			.all() as { series_id: number }[];
		// The pass's own line, and the rows it wrote: what ran, not only that it passed.
		expect(log, log).toContain('relations: 3 of 3 refreshed');
		expect(cached.map((r) => r.series_id)).toEqual(
			[ids.s4, ids.s2, ids.shore].sort((a, b) => a - b)
		);
	} finally {
		db.close();
	}

	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST_URL: `http://127.0.0.1:${anilistPort}`,
			TSUNDOKU_ANILIST: '',
			ENGINE_URL: `http://127.0.0.1:${enginePort}`,
			ENGINE_TOKEN: 'e2e-engine-token',
			LIBRARY_ROOT: library,
			COVER_DIR: join(work, 'covers'),
			TSUNDOKU_HOME: join(work, 'home'),
			ENGINE_STORE: join(work, 'store'),
			BACKUP_DIR: join(work, 'backups')
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${BASE}/`, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the seasons preview never answered');
});

test.afterAll(async () => {
	preview?.kill();
	for (const s of [anilist, engine]) {
		s?.closeAllConnections();
		if (s) await new Promise((ok) => s.close(ok));
	}
	rmSync(work, { recursive: true, force: true });
});

const list = (page: Page) => page.getByRole('region', { name: 'Episodes' });
const heads = (page: Page) =>
	list(page)
		.locator('.season.around .a-what')
		.evaluateAll((n) => n.map((x) => x.textContent?.trim() ?? ''));

test('an anime’s screen draws the seasons before it, NEXT SEASON, and the extras folded (c358)', async ({
	page
}) => {
	anilistCalls = 0;
	await page.goto(`${BASE}/series/${ids.s4}`);
	await expect(list(page).locator('.entry')).toHaveCount(3);
	// Numbered along the chain, the ONA on it a season; the season after never numbered.
	expect(await heads(page)).toEqual([
		'SEASON 1 · 12 EP',
		'SEASON 2 · 12 EP',
		'SEASON 3 · 10 EP',
		'NEXT SEASON · ANNOUNCED'
	]);
	// Above the episodes and below them, in the list's own order.
	const order = await list(page)
		.locator('.rows > li')
		.evaluateAll((n) =>
			n.map((li) =>
				li.classList.contains('extras')
					? 'extras'
					: li.classList.contains('around')
						? (li.getAttribute('data-around') ?? '')
						: li.classList.contains('entry')
							? 'ep'
							: li.className
			)
		);
	expect(order.slice(0, 3)).toEqual(['101', '102', '103']);
	expect(order.filter((x) => x === 'ep')).toHaveLength(3);
	expect(order.slice(-2)).toEqual(['105', 'extras']);
	// IN LIBRARY by season 2's own link; FIND for the others, at this series' source.
	const s2 = list(page).locator('[data-around="102"]');
	await expect(s2.getByRole('link')).toHaveText('IN LIBRARY →');
	await expect(s2.getByRole('link')).toHaveAttribute('href', `/series/${ids.s2}`);
	const from = encodeURIComponent(`/series/${ids.s4}`);
	await expect(list(page).locator('[data-around="101"]').getByRole('link')).toHaveAttribute(
		'href',
		`/browse/${SOURCE.id}?q=Lantern+Keeper&from=${from}`
	);
	const next = list(page).locator('[data-around="105"]');
	await expect(next.locator('.a-title')).toHaveText('Lantern Keeper Season 5');
	await expect(
		next.getByRole('link', { name: `Search ${SOURCE.name} for Lantern Keeper Season 5` })
	).toHaveAttribute('href', `/browse/${SOURCE.id}?q=Lantern+Keeper+Season+5&from=${from}`);
	// The extras: one quiet folded line, and none of their rows until it opens.
	const fold = list(page).locator('.extras button');
	await expect(fold).toHaveAttribute('aria-expanded', 'false');
	await expect(fold).toContainText('+ 5 EXTRAS');
	for (const n of ['2 OVA', '1 MOVIE', '1 ONA', '1 SPECIAL']) await expect(fold).toContainText(n);
	await expect(list(page).locator('.season.around')).toHaveCount(5);
	await fold.click();
	await expect(fold).toHaveAttribute('aria-expanded', 'true');
	await expect(list(page).locator('.season.around')).toHaveCount(10);
	await expect(list(page).locator('[data-around="160"] .a-what')).toHaveText('MOVIE · 1 EP');
	await expect(list(page).locator('[data-around="160"]').getByRole('link')).toHaveText('FIND');
	// Never the manga, never a Work offered.
	await expect(list(page).locator('[data-around="900"]')).toHaveCount(0);
	await expect(page.getByText(/MIGHT CONTINUE/)).toHaveCount(0);
	await fold.click();
	await expect(list(page).locator('.season.around')).toHaveCount(5);
	// The screen asked AniList nothing: it drew from the cache.
	expect(anilistCalls).toBe(0);
	// IN LIBRARY → opens that series.
	await s2.getByRole('link').click();
	await page.waitForURL(new RegExp(`/series/${ids.s2}$`));
	await expect(page.getByRole('heading', { name: 'Lantern Keeper II' })).toBeVisible();
	// Its own seasons around: season 1 before it, and the extras folded again.
	await expect(list(page).locator('[data-around="101"]')).toBeVisible();
	await expect(list(page).locator('.extras button')).toHaveAttribute('aria-expanded', 'false');
	expect(anilistCalls).toBe(0);
});

test('NEXT SEASON · FIND searches the source for the title’s stem when AniList lists none', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${ids.shore}`);
	expect(await heads(page)).toEqual(['SEASON 1 · 12 EP', 'NEXT SEASON']);
	const next = list(page).locator('[data-around="next"]');
	await expect(next.locator('.a-title')).toHaveCount(0);
	await expect(next.getByRole('link')).toHaveText('FIND');
	await expect(next.getByRole('link')).toHaveAttribute(
		'href',
		`/browse/${SOURCE.id}?q=Quiet+Shore&from=${encodeURIComponent(`/series/${ids.shore}`)}`
	);
	await expect(list(page).locator('.extras')).toHaveCount(0);
});

test('an unlinked anime, a manga and a novel draw no seasons around', async ({ page }) => {
	await page.goto(`${BASE}/series/${ids.unlinked}`);
	await expect(list(page).locator('.entry')).toHaveCount(3);
	await expect(page.locator('.season.around')).toHaveCount(0);
	const db = new Database(dbPath, { readonly: true });
	const visible = (kind: string) =>
		db
			.prepare(
				`SELECT s.id, s.title FROM series s JOIN roots r ON r.id = s.root_id
				WHERE s.kind = ? AND s.hidden = 0 AND r.hidden = 0 ORDER BY s.id LIMIT 1`
			)
			.get(kind) as { id: number; title: string };
	const others = [visible('manga'), visible('novel')];
	db.close();
	for (const s of others) {
		await page.goto(`${BASE}/series/${s.id}`);
		await expect(page.getByRole('heading', { name: s.title })).toBeVisible();
		await expect(page.locator('.season.around')).toHaveCount(0);
	}
});

test('KEEP BOTH says an earlier decision could not be carried out, and the note outlives the band (c671)', async ({
	page
}) => {
	await page.context().addCookies([{ name: 'tsundoku_reveal', value: '1', url: BASE }]);
	// A FOLD decided before, waiting: written just now, so no library load has
	// carried it out (the library's load runs `applyPending`; this file never
	// opens the library).
	{
		const db = new Database(dbPath);
		db.prepare(
			`INSERT OR REPLACE INTO dupe_decisions (pair, decision, keep, at) VALUES (?, 'fold', NULL, 1)`
		).run(ids.earlier);
		db.close();
	}
	await page.goto(`${BASE}/series/${ids.twin}`);
	const band = page.locator('.twin');
	await expect(band).toContainText('SAME BOOK AS');
	await band.getByRole('button', { name: 'KEEP BOTH', exact: true }).click();
	const note = page.locator('.kept-both');
	await expect(note).toContainText('KEPT BOTH · 1 EARLIER DECISION COULDN’T BE CARRIED OUT');
	await expect(note).toContainText('BACK IN THE REVIEW');
	await expect(note.getByRole('link', { name: 'SEE DUPLICATES →' })).toHaveAttribute(
		'href',
		'/duplicates'
	);
	// The reload `use:enhance` ran took the band away (the pair is decided);
	// the note is still there.
	await expect(band).toHaveCount(0);
	await expect(note).toBeVisible();
	{
		const db = new Database(dbPath, { readonly: true });
		const decisions = db
			.prepare(`SELECT pair, decision FROM dupe_decisions ORDER BY pair`)
			.all() as { pair: string; decision: string }[];
		db.close();
		// This KEEP BOTH is recorded; the refused FOLD is dropped.
		expect(decisions.map((d) => d.decision)).toEqual(['both']);
		expect(decisions.some((d) => d.pair === ids.earlier)).toBe(false);
	}
	// A reload is a new page: the note was the answer's, and is gone; the band too.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Rakugaki Collection Vol. 3' })).toBeVisible();
	await expect(note).toHaveCount(0);
	await expect(band).toHaveCount(0);
});
