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
import { previewId, startTagWorld, type TagWorld } from './helpers/tag-world';

/**
 * The seasons around an anime on a TV (doc/SERIES.md, "The seasons
 * around it"; doc/FOCUS.md): the heads are rows on a screen the TV opens,
 * so the remote must reach each one's FIND or IN LIBRARY →, and the folded
 * extras line, with ↑ and ↓, and OK opens the fold in place. It runs in the
 * `tv` project (960x540, no pointer). The shared seed has no anime, so, as
 * `series-seasons-flow.e2e.ts` does (its world, copied: a spec file cannot
 * import another's), it seeds its own database, fills the relation cache by
 * running the link pass against a stand-in AniList, and serves the build on a
 * port the OS hands out. Read only after the pass: nothing here writes.
 */
const work = mkdtempSync(
	join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-tvssn-')
);
const dbPath = join(work, 'tv-seasons.sqlite');
const library = join(work, 'library');
let preview: ChildProcess | null = null;
let anilist: Server | null = null;
let engine: Server | null = null;
let BASE = '';

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
 * The chain, each entry with its edges both ways as AniList answers
 * `relations { edges { relationType node } }`: a loop (season 5 names season
 * 1 its SEQUEL), a branch (season 4's SPECIAL prequel beside its ONA one), a
 * MOVIE on the main chain, OVAs and an ONA as side stories, an ONA season on
 * the main chain, a NOT_YET_RELEASED sequel and the manga as an ADAPTATION; and
 * a show AniList lists no sequel of.
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

		return { s4, s2, shore, unlinked };
	} finally {
		db.close();
	}
}

const ids = seed();

/**
 * The pass, by its own command: `yarn run links` with no search, against the
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
	// is 120 s so a loaded box fails a case, never the hook.
	test.setTimeout(120_000);
	const anilistPort = await freePort();
	anilist = createServer((req: IncomingMessage, res: ServerResponse) => {
		let body = '';
		req.on('data', (b: Buffer) => (body += b.toString()));
		req.on('end', () => {
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
	throw new Error('the TV seasons preview never answered');
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

/** Where the focus is in the list: a head's id (`next`, `extras`), an episode, or `out`. */
const at = (page: Page) =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null;
		const li = el?.closest('.rows > li');
		if (!li) return 'out';
		if (li.classList.contains('extras')) return 'extras';
		if (li.classList.contains('around')) return li.getAttribute('data-around') ?? '';
		return 'ep';
	});

test('the remote reaches every head’s cell above and below the episodes, and OK opens the extras', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${ids.s4}`);
	await expect(list(page).locator('.entry')).toHaveCount(3);
	await list(page).locator('.entry-btn').first().focus();
	await expect.poll(() => at(page)).toBe('ep');
	// ↑ from the first episode: past the season's own head (not a stop) to the
	// seasons before, nearest first.
	for (const id of ['103', '102', '101']) {
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => at(page)).toBe(id);
	}
	await expect(page.locator(':focus')).toHaveText('FIND');
	// ↓ back through them and the episodes, to NEXT SEASON and the fold.
	for (const want of ['102', '103', 'ep', 'ep', 'ep', '105', 'extras']) {
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => at(page)).toBe(want);
	}
	const fold = list(page).locator('.extras button');
	await expect(fold).toHaveAttribute('aria-expanded', 'false');
	await page.keyboard.press('Enter');
	await expect(fold).toHaveAttribute('aria-expanded', 'true');
	await expect(list(page).locator('.season.around')).toHaveCount(10);
	// The extras' own cells come next, one stop each.
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => at(page)).toMatch(/^1[5-7]\d$/);
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => at(page)).toBe('extras');
	await page.keyboard.press('Enter');
	await expect(fold).toHaveAttribute('aria-expanded', 'false');
	await expect(list(page).locator('.season.around')).toHaveCount(5);
	// The heads fit the TV's width: no row wider than the list.
	const overflow = await list(page)
		.locator('.season.around')
		.evaluateAll((n) => n.filter((li) => li.scrollWidth > li.clientWidth + 1).length);
	expect(overflow).toBe(0);
});

/**
 * PUT ON A SHELF under ADDED TO THE LIBRARY (doc/SERIES.md,
 * "Shelves in the ADDED band") is a row of stops on the series screen,
 * which a TV opens: the remote reaches every chip from UNDO, and OK puts the
 * series on a shelf. On the tag world (tests/helpers/tag-world.ts: its own
 * database, engine and preview), since it adds a series and makes shelves;
 * the device projects' walk is tests/series-add-shelf.e2e.ts.
 */
test.describe('the ADDED band’s shelves on a TV', () => {
	let shelfWorld: TagWorld;
	test.beforeAll(async () => {
		shelfWorld = await startTagWorld('tv-series-add-shelf');
	});
	test.afterAll(async () => {
		await shelfWorld?.stop();
	});

	test('↓ from UNDO reaches the strip, ← and → walk every chip, and OK puts it on a shelf', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const base = shelfWorld.base;
		for (const name of ['Couch', 'Weekend']) {
			const r = await page.request.post(`${base}/?/newShelf`, {
				form: { name },
				headers: { origin: base, accept: 'text/html' },
				maxRedirects: 0
			});
			expect(r.status()).toBe(303);
		}
		await page.goto(`${base}/downloads/source/${previewId}`);
		await page.locator('form[action="?/add"] button.add').click();
		await page.waitForURL((u) => /^\/series\/\d+$/.test(u.pathname) && u.searchParams.has('added'));
		const strip = page.getByRole('group', { name: 'Put on a shelf' });
		await expect(strip).toBeVisible();
		const cells = await strip.locator('.chip').allInnerTexts();
		expect(cells).toContain('COUCH');
		expect(cells).toContain('+ NEW SHELF');

		const focused = () =>
			page.evaluate(() => {
				const el = document.activeElement as HTMLElement | null;
				return el?.closest('[aria-label="Put on a shelf"]') && el.matches('.chip')
					? el.innerText
					: 'out';
			});
		const undo = page
			.locator('.band', { has: page.getByText('ADDED TO THE LIBRARY', { exact: true }) })
			.getByRole('button', { name: 'UNDO' });
		await undo.focus();
		await page.keyboard.press('ArrowDown');
		await expect.poll(focused).not.toBe('out');
		// Walk the strip both ways, gathering every cell the arrows land on inside it.
		const seen = new Set<string>([await focused()]);
		for (const key of ['ArrowLeft', 'ArrowRight']) {
			for (let i = 0; i < cells.length; i++) {
				await page.keyboard.press(key);
				const f = await focused();
				if (f === 'out') break;
				seen.add(f);
			}
			// Back into the strip for the other direction.
			await undo.focus();
			await page.keyboard.press('ArrowDown');
		}
		expect([...seen].sort()).toEqual([...cells].sort());

		// OK on a chip puts the series on that shelf.
		const couch = strip.getByRole('button', { name: /^(✓ )?COUCH$/ });
		await couch.focus();
		await page.keyboard.press('Enter');
		await expect(couch).toHaveAttribute('aria-pressed', 'true');
		// The strip fits the TV's width.
		expect(await strip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
		await undo.click();
		await page.waitForURL((u) => u.pathname.startsWith('/downloads/source/'));
	});
});
