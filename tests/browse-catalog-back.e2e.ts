/**
 * MEASUREMENT PROBE (temporary; the real file replaces this): what a way back
 * from a preview does to BROWSE's catalog today (c930).
 */
import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { freePort } from './helpers/tag-world';

const SOURCE = { id: '600', name: 'Back Source' };
const ANIME = { id: '601', name: 'Back Anime' };

const PAGES = 25;
const PER = 13;

type World = {
	base: string;
	engine: () => number;
	kinds: () => string[];
	images: () => number;
	reset: () => void;
	stop: () => Promise<void>;
};
let world: World;

function seed(dbPath: string): void {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const ext = db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES (?, ?, ?, 1, '1', '1', ?, 0, 0, '')`
		);
		const src = db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', ?)`
		);
		ext.run('e2e.back', SOURCE.name, 'manga', 'e2e.back'.padEnd(64, '0'));
		src.run(SOURCE.id, 'e2e.back', SOURCE.name, 'https://back.example');
		ext.run('e2e.backanime', ANIME.name, 'anime', 'e2e.backanime'.padEnd(64, '0'));
		src.run(ANIME.id, 'e2e.backanime', ANIME.name, 'https://backanime.example');
	} finally {
		db.close();
	}
}

function startEngine(port: number, cover: Buffer) {
	let calls: { method: string; page?: number }[] = [];
	let images = 0;
	const server = createHttp((req, res) => {
		const json = (v: unknown) =>
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
		if (req.url === '/__calls') return json(calls);
		if (req.url === '/__images') return json(images);
		if (req.url === '/__reset') {
			calls = [];
			images = 0;
			return json({});
		}
		if (req.url === '/challenges') return json({ solving: {}, solved: {} });
		if (req.url?.startsWith('/image/')) {
			images += 1;
			return res.writeHead(200, { 'content-type': 'image/png' }).end(cover);
		}
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as {
				method: string;
				page?: number;
				search?: string;
				mangaData?: { url: string };
				animeData?: { url: string };
			};
			calls.push({ method: b.method, page: b.page });
			const page = b.page ?? 1;
			const list = (prefix: string) => ({
				mangas: Array.from({ length: PER }, (_, i) => ({
					url: `/manga/${prefix}-${page}-${i}`,
					title: `${prefix} ${page}-${i}`,
					status: 1,
					thumbnail_url: `http://127.0.0.1:${port}/image/cover-${prefix}-${page}-${i}`
				})),
				hasNextPage: page < PAGES
			});
			switch (b.method) {
				case 'filterSchemaManga':
				case 'filterSchemaAnime':
					return json([]);
				case 'supportLatestManga':
					return json(true);
				case 'supportLatestAnime':
					return json(false);
				case 'getPopularManga':
					return json(list('Popular'));
				case 'getLatestManga':
					return json(list('Latest'));
				case 'getSearchManga':
					return json(list('Found'));
				case 'getPopularAnime':
					return json({
						animes: Array.from({ length: PER }, (_, i) => ({
							url: `/show/${page}-${i}`,
							title: `Show ${page}-${i}`,
							status: 1,
							thumbnail_url: `http://127.0.0.1:${port}/image/anime-${page}-${i}`
						})),
						hasNextPage: page < 2
					});
				case 'getDetailsManga':
					return json({
						url: b.mangaData?.url ?? '',
						title: 'A Preview',
						description: 'One to come back from.',
						status: 1
					});
				case 'getDetailsAnime':
					return json({
						url: b.animeData?.url ?? '',
						title: 'A Show',
						description: 'One to come back from.',
						status: 1
					});
				case 'getChapterList':
					return json([{ url: `${b.mangaData?.url}/c1`, name: 'Chapter 1', chapter_number: 1 }]);
				case 'getEpisodeList':
					return json([{ url: `${b.animeData?.url}/e1`, name: 'Episode 1', episode_number: 1 }]);
				default:
					res.writeHead(404).end('{}');
			}
		});
	});
	return new Promise<Server>((ok) => server.listen(port, '127.0.0.1', () => ok(server))).then(
		(s) => ({
			server: s,
			calls: () => calls,
			images: () => images,
			reset: () => {
				calls = [];
				images = 0;
			}
		})
	);
}

async function startWorld(): Promise<World> {
	const work = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-browse-back-'));
	const dbPath = join(work, 'library.sqlite');
	seed(dbPath);
	const enginePort = await freePort();
	// A real 64×90 PNG, so the thumbnail step has something to resize.
	const { default: sharp } = await import('sharp');
	const cover = await sharp({
		create: { width: 64, height: 90, channels: 3, background: { r: 20, g: 40, b: 60 } }
	})
		.png()
		.toBuffer();
	const engine = await startEngine(enginePort, cover);
	const port = await freePort();
	const base = `http://localhost:${port}`;
	const preview: ChildProcess = spawn(
		'npx',
		['vite', 'preview', '--port', String(port), '--strictPort'],
		{
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				ENGINE_URL: `http://127.0.0.1:${enginePort}`,
				ENGINE_TOKEN: 'e2e-engine-token',
				TSUNDOKU_ANILIST: 'off',
				TSUNDOKU_HOME: join(work, 'home'),
				LIBRARY_ROOT: join(work, 'library'),
				COVER_DIR: join(work, 'covers'),
				ENGINE_STORE: join(work, 'store'),
				BACKUP_DIR: join(work, 'backups')
			},
			stdio: 'ignore'
		}
	);
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			up = (await fetch(base, { redirect: 'manual' })).status > 0;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	if (!up) throw new Error('the browse-back preview never answered');
	return {
		base,
		engine: () => engine.calls().length,
		kinds: () => engine.calls().map((c) => `${c.method}:${c.page ?? ''}`),
		images: () => engine.images(),
		reset: () => engine.reset(),
		stop: async () => {
			preview.kill();
			engine.server.closeAllConnections();
			await new Promise((ok) => engine.server.close(ok));
			rmSync(work, { recursive: true, force: true });
		}
	};
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
	world = await startWorld();
});
test.afterAll(async () => {
	await world?.stop();
});

/** The tile at the top of the viewport, by its title, and the scroll. */
const place = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const tiles = [...document.querySelectorAll<HTMLElement>('.grid a.tile')];
		const top = tiles
			.filter((t) => t.getBoundingClientRect().bottom > 0)
			.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
		return { y: Math.round(scrollY), top: top?.querySelector('.t')?.textContent ?? null };
	});

test('MEASURE: goBack from a preview', async ({ page }) => {
	test.setTimeout(180_000);
	const covers: string[] = [];
	const fromCache: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/downloads/engine-image/')) covers.push(r.url());
	});
	page.on('response', (r) => {
		if (!r.url().includes('/api/downloads/engine-image/')) return;
		const h = r.headers();
		fromCache.push(
			`${r.status()} sw=${r.fromServiceWorker()} cc=${h['cache-control']} age=${h['age']} date=${h['date']} vary=${h['vary']} setcookie=${'set-cookie' in h} timing=${JSON.stringify(r.request().timing())}`
		);
	});
	await page.goto(`${world.base}/browse/${SOURCE.id}?pages=3`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 1-0');
	await expect.poll(() => page.locator('.grid a.tile').count()).toBeGreaterThanOrEqual(3 * PER);
	await page.waitForTimeout(1000);
	console.log('measure: tiles drawn', await page.locator('.grid a.tile').count(), page.url());
	const urlsBefore = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLImageElement>('.grid .cover img')].map((i) => i.src)
	);
	console.log(
		'measure: covers on the first draw',
		covers.length,
		JSON.stringify(fromCache.slice(0, 2))
	);
	await page.evaluate(() => scrollTo({ top: 900, behavior: 'instant' }));
	const before = await place(page);
	console.log('measure: before leaving', JSON.stringify(before));
	await world.reset();
	covers.length = 0;
	fromCache.length = 0;

	// Open a tile at the top of the viewport (a link, then the preview).
	const tile = page.locator('.grid a.tile').nth(6);
	await tile.click();
	await page.waitForURL(/\/downloads\/source\//);
	await expect(page.getByText('A Preview').first()).toBeVisible();
	await page.goBack();
	await page.waitForURL(/\/browse\//);
	await expect(page.locator('.grid a.tile').first()).toBeVisible();
	await page.waitForTimeout(1200);
	const after = await place(page);
	const urlsAfter = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLImageElement>('.grid .cover img')].map((i) => i.src)
	);
	console.log('measure: after goBack', JSON.stringify(after));
	console.log('measure: page requests at the source after goBack', world.engine(), world.kinds());
	console.log(
		'measure: engine image fetches after goBack',
		world.images(),
		'of',
		covers.length,
		'browser requests'
	);
	console.log('measure: cover requests after goBack', JSON.stringify(covers.slice(0, 2)));
	console.log('measure: cover responses after goBack', JSON.stringify(fromCache.slice(0, 3)));
	console.log(
		'measure: cover urls (from the background styles)',
		await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('.grid .cover')]
				.slice(0, 2)
				.map((el) => el.style.background)
		)
	);
	console.log(
		'measure: cover urls stable',
		urlsBefore.length === urlsAfter.length && urlsBefore.every((u, i) => u === urlsAfter[i]),
		urlsBefore[0],
		urlsAfter[0]
	);
});

test('MEASURE: the preview’s ←', async ({ page }) => {
	test.setTimeout(180_000);
	const covers: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/downloads/engine-image/')) covers.push(r.url());
	});
	await page.goto(`${world.base}/browse/${SOURCE.id}?pages=3`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 1-0');
	await expect.poll(() => page.locator('.grid a.tile').count()).toBeGreaterThanOrEqual(3 * PER);
	await page.waitForTimeout(1000);
	await page.evaluate(() => scrollTo({ top: 900, behavior: 'instant' }));
	const before = await place(page);
	console.log('measure: before ←', JSON.stringify(before), page.url());
	await world.reset();
	covers.length = 0;
	await page.locator('.grid a.tile').nth(6).click();
	await page.waitForURL(/\/downloads\/source\//);
	await expect(page.getByText('A Preview').first()).toBeVisible();
	await page.locator('.preview header.bar a.back').click();
	await page.waitForURL(/\/browse\//);
	await expect(page.locator('.grid a.tile').first()).toBeVisible();
	await page.waitForTimeout(1200);
	console.log('measure: after ←', JSON.stringify(await place(page)));
	console.log('measure: page requests at the source after ←', world.engine(), world.kinds());
	console.log(
		'measure: engine image fetches after ←',
		world.images(),
		'of',
		covers.length,
		'browser requests'
	);
});

test('MEASURE: ?pages=N+1 adds', async ({ page }) => {
	test.setTimeout(180_000);
	const covers: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/downloads/engine-image/')) covers.push(r.url());
	});
	await page.goto(`${world.base}/browse/${SOURCE.id}?pages=2`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 1-0');
	await expect.poll(() => page.locator('.grid a.tile').count()).toBeGreaterThanOrEqual(2 * PER);
	await page.waitForTimeout(1200);
	const atStart = await page.locator('.grid a.tile').count();
	console.log('measure: pages+1 started at', atStart, page.url());
	// Mark the first tile, to see whether the next page remounts it.
	await page.evaluate(() => {
		const t = document.querySelector('.grid a.tile');
		t?.setAttribute('data-probe', 'kept');
	});
	const before = await page.locator('.grid a.tile').first().boundingBox();
	await world.reset();
	covers.length = 0;
	const urlsBefore = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLImageElement>('.grid .cover img')].map((i) => i.src)
	);
	await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
	await expect.poll(() => page.locator('.grid a.tile').count(), { timeout: 20_000 }).toBe(3 * PER);
	await page.waitForTimeout(800);
	const kept = await page.evaluate(() =>
		document.querySelector('.grid a.tile')?.getAttribute('data-probe')
	);
	console.log('measure: pages+1 page requests at the source', world.engine());
	console.log('measure: pages+1 cover requests sent', covers.length);
	console.log('measure: pages+1 tile kept (not remounted)', kept === 'kept');
	console.log('measure: pages+1 first tile box before', JSON.stringify(before));
	const urlsAfter = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLImageElement>('.grid .cover img')].map((i) => i.src)
	);
	console.log(
		'measure: pages+1 prefixes stable',
		urlsBefore.every((u, i) => u === urlsAfter[i])
	);
});
