import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer as createHttp, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { freePort } from './helpers/tag-world';
import { revealOn } from './helpers/reveal';

/**
 * BROWSE's catalog coming back (doc/BROWSE.md, "It scrolls on, and the
 * URL keeps the place" and "Back returns to where the tag was"): a way back
 * from a preview lands at the same scroll on the same tile, with the pages
 * already loaded drawn at once, no page asked of the source again and no
 * cover already shown fetched again; a reload and a forward visit start at
 * the top, and nothing of a revealed list comes back.
 *
 * The list a way back draws is this visit's own answer, never the one kept:
 * a series hidden since the list was left (HIDE on its screen, another tab,
 * an ADDED HIDDEN add) must not be drawn, title or cover, while the answer is
 * on its way — an outline of the kept list's size holds the place instead.
 *
 * It runs in the `browse` project against its own seeded database and a fake
 * engine on ports the OS gives, because it counts what the source is asked
 * (the shared browse world's engine is steered by the specs beside it) and
 * needs a list at the 20-page cap. The TV's own BACK is in
 * `tests/tv-browse-focus.e2e.ts`, the project that has a remote.
 */

const MANGA = { id: '600', name: 'Back Source' };
const ANIME = { id: '601', name: 'Back Anime' };
/** The LNReader plugin the world installs (tests/fixtures/lnreader/shelf.js). */
const PLUGIN = 'shelf';

/** Pages the fake source has, and results a page carries. Past the 20-page cap on purpose. */
const PAGES = 25;
const PER = 13;
/** What the cap leaves: `MAX_PAGES` in `src/lib/server/engine/browse.ts`. */
const CAP = 20;
/** The last result of a ten-page search: a library series the HIDE cases hide between leaving and coming back. */
const FOUND_PAGES = 10;
const HIDDEN_TITLE = `Found ${FOUND_PAGES}-${PER - 1}`;

type World = {
	base: string;
	/** The library series one of the source's own search results matches (the HIDE cases). */
	foundSeriesId: number;
	/** Page-list calls the source was asked for, in order: `getPopularManga:3`. */
	calls: () => string[];
	/** `/image/` fetches the source answered: what a cover *refetch* costs. */
	images: () => number;
	/** Make the next search wait [ms]: a source that answers slowly, as a cold one does. */
	slow: (ms: number) => void;
	reset: () => void;
	stop: () => Promise<void>;
};
let world: World;

function seed(dbPath: string, store: string): { found: number } {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 9, 28, 12);
		const ext = db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES (?, ?, ?, 1, '1', ?, ?, 0, 0, '')`
		);
		const src = db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', ?)`
		);
		ext.run('e2e.back', MANGA.name, 'manga', '1', 'e2e.back'.padEnd(64, '0'));
		src.run(MANGA.id, 'e2e.back', MANGA.name, 'https://back.example');
		ext.run('e2e.backanime', ANIME.name, 'anime', '16', 'e2e.backanime'.padEnd(64, '0'));
		src.run(ANIME.id, 'e2e.backanime', ANIME.name, 'https://backanime.example');
		// A hidden series the manga source lists, so a revealed list differs from
		// the one reveal off draws (the reveal case, below). Its key is the
		// source's own (`asHits`: `keyOf(sourceId, url)`). Two more, shown, keep
		// the source from being *mostly* hidden (which would 404 it with reveal
		// off); they name no result it lists.
		const series = db.prepare(
			`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, hidden)
			VALUES (?, ?, 'manga', 'mihon', 210, ?, ?, ?, ?)`
		);
		series.run(root, 'Popular 1-5', now, now, `mihon:${MANGA.id}:/manga/Popular-1-5`, 1);
		series.run(root, 'Seeded One', now, now, `mihon:${MANGA.id}:/manga/Seeded-1`, 0);
		series.run(root, 'Seeded Two', now, now, `mihon:${MANGA.id}:/manga/Seeded-2`, 0);
		// A result of the source's search, shown: the HIDE cases hide it after the
		// list has been left, and a way back must never draw it. Its own name is
		// the last of a ten-page search.
		const found = Number(
			series.run(
				root,
				HIDDEN_TITLE,
				now,
				now,
				`mihon:${MANGA.id}:/manga/${HIDDEN_TITLE.replace(/ /g, '-')}`,
				0
			).lastInsertRowid
		);
		// The novel source BROWSE already knows how to install (tests/browse-setup.ts):
		// an LNReader plugin whose file is its own hash in the store.
		const shelf = readFileSync('tests/fixtures/lnreader/shelf.js');
		const hash = createHash('sha256').update(shelf).digest('hex');
		mkdirSync(join(store, 'novels'), { recursive: true });
		writeFileSync(join(store, 'novels', `${hash}.js`), shelf);
		db.prepare(
			`INSERT INTO novel_plugins (id, name, site, lang, version, hash, installed_at, updated_at, failed)
			VALUES (?, 'Shelf Novels', 'https://shelf.example/', 'en', '1.0.0', ?, 0, 0, '')`
		).run(PLUGIN, hash);
		return { found };
	} finally {
		db.close();
	}
}

/**
 * A source with [PAGES] pages of [PER] results each, every one with a cover on
 * the engine's own loopback `/image/` path — the shape a real extension answers
 * (`thumbnail_url`), which is what makes the app ask
 * `/api/downloads/engine-image/<token>` and the engine's `/image/<token>`.
 */
function startEngine(port: number, cover: Buffer) {
	let calls: string[] = [];
	let images = 0;
	/** How long the next search waits, once (`/__slow`). */
	let slowMs = 0;
	const server = createHttp((req, res) => {
		const json = (v: unknown) =>
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
		if (req.url === '/__calls') return json(calls);
		if (req.url === '/__images') return json(images);
		if (req.url === '/__reset') {
			calls = [];
			images = 0;
			slowMs = 0;
			return json({});
		}
		if (req.url?.startsWith('/__slow')) {
			slowMs = Number(new URL(req.url, 'http://x').searchParams.get('ms')) || 0;
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
				mangaData?: { url: string };
				animeData?: { url: string };
			};
			calls.push(`${b.method}:${b.page ?? ''}`);
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
				// One setting of the source's own, so a change of it can forget the
				// source's kept answers through the app's own action (the slow case).
				case 'preferencesManga':
					return json([
						{
							key: 'quality',
							listPreference: {
								title: 'Cover quality',
								summary: '%s',
								valueIndex: 0,
								entries: ['Original', 'Medium', 'Low'],
								entryValues: ['o', 'm', 'l']
							}
						}
					]);
				case 'supportLatestManga':
					return json(true);
				case 'supportLatestAnime':
					return json(false);
				case 'getPopularManga':
					return json(list('Popular'));
				case 'getLatestManga':
					return json(list('Latest'));
				case 'getSearchManga': {
					const answer = list('Found');
					if (!slowMs) return json(answer);
					const ms = slowMs;
					slowMs = 0;
					return setTimeout(() => json(answer), ms);
				}
				case 'getPopularAnime':
				case 'getLatestAnime':
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
			slow: (ms: number) => {
				slowMs = ms;
			},
			reset: () => {
				calls = [];
				images = 0;
				slowMs = 0;
			}
		})
	);
}

async function startWorld(): Promise<World> {
	const work = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-browse-back-'));
	const dbPath = join(work, 'library.sqlite');
	const store = join(work, 'store');
	const { found } = seed(dbPath, store);
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
				ENGINE_STORE: store,
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
		foundSeriesId: found,
		calls: () => engine.calls(),
		images: () => engine.images(),
		slow: (ms: number) => engine.slow(ms),
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
	// A seeded database and a preview of this build: the shared server is the
	// browse world's, steered by the project beside this one.
	test.setTimeout(120_000);
	world = await startWorld();
});
test.afterAll(async () => {
	await world?.stop();
});

/** One tile, by its title exactly (a title is a prefix of longer ones: "Popular 1-1"). */
const tileTitled = (page: Page, title: string) =>
	page
		.locator('.grid a.tile')
		.filter({
			has: page.locator('.t', {
				hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
			})
		})
		.first();

/**
 * How many tiles pages 1..n draw. The source's popular list is one short of
 * [per] per page, because the hidden series it lists is dropped outside
 * reveal; a search of it is not.
 */
const drawnBy = (pages: number, per = PER, offset = 1) => pages * per - offset;

/**
 * Let the list finish growing by itself — the end of a short list is on screen
 * at once, so it asks for its next page — and return the pages the URL says it
 * drew. Not for a list at the cap: there the URL can say more than was asked.
 */
async function settleList(page: Page, per = PER, offset = 1): Promise<number> {
	const pages = (u: string) => Number(new URL(u).searchParams.get('pages') ?? 1);
	await expect
		.poll(async () => (await gridCount(page)) === drawnBy(pages(page.url()), per, offset), {
			timeout: 30_000
		})
		.toBe(true);
	return pages(page.url());
}

/** The scroll and the tile at the top of the viewport, by its title. */
const place = (page: Page) =>
	page.evaluate(() => {
		const tiles = [...document.querySelectorAll<HTMLElement>('.grid a.tile')];
		const top = tiles
			.filter((t) => t.getBoundingClientRect().bottom > 0)
			.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
		return { y: Math.round(scrollY), top: top?.querySelector('.t')?.textContent ?? null };
	});

const gridCount = (page: Page) => page.locator('.grid a.tile').count();

/** The covers drawn now, as the app's own token names them. */
const coversDrawn = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('.grid .cover')].flatMap((el) => {
			const m = /\/api\/downloads\/engine-image\/([^/?#"')]+)/.exec(el.style.background);
			return m ? [m[1]] : [];
		})
	);

/** Cover requests the browser makes, and which of them were for covers drawn before leaving. */
function watchCovers(page: Page) {
	const sent: string[] = [];
	page.on('request', (r) => {
		const m = /\/api\/downloads\/engine-image\/([^/?#]+)/.exec(r.url());
		if (m) sent.push(m[1]);
	});
	return {
		clear: () => (sent.length = 0),
		sent: () => sent.slice(),
		again: (drawn: string[]) => sent.filter((t) => drawn.includes(t))
	};
}

/** Scroll into the list, at a place a return has to come back to. */
async function scrollInto(page: Page, y: number) {
	await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
}

/**
 * Leave the list by a tile wholly in view, and wait for its preview. Wholly:
 * a tile cut by the viewport's top edge is scrolled into place by the click,
 * which moves the very place the return has to come back to.
 */
async function openTopTile(page: Page) {
	const title = await page.evaluate(() => {
		const tiles = [...document.querySelectorAll<HTMLElement>('.grid a.tile')];
		const seen = tiles.find((el) => {
			const r = el.getBoundingClientRect();
			return r.top >= 0 && r.bottom <= innerHeight;
		});
		return seen?.querySelector('.t')?.textContent ?? null;
	});
	expect(title, 'a tile is whole in the viewport').toBeTruthy();
	await tileTitled(page, title!).click();
	await page.waitForURL(/\/downloads\/source\//);
	await expect(page.getByText('A Preview').first()).toBeVisible();
	return title!;
}

/** A tile wholly in view, for a source whose preview is not "A Preview" (an anime's). */
const visibleTitle = (page: Page) =>
	page.evaluate(() => {
		const tiles = [...document.querySelectorAll<HTMLElement>('.grid a.tile')];
		const seen = tiles.find((el) => {
			const r = el.getBoundingClientRect();
			return r.top >= 0 && r.bottom <= innerHeight;
		});
		return seen?.querySelector('.t')?.textContent ?? null;
	});

/** The source's page-list calls for pages that were already drawn. */
const pagesReasked = (asks: string[], upTo: number) =>
	asks
		.filter((c) => /^(getPopularManga|getLatestManga|getSearchManga):\d+$/.test(c))
		.filter((c) => {
			const page = Number(c.split(':')[1]);
			return page >= 1 && page <= upTo;
		});

/**
 * The source's kept answers forgotten, as its settings page's own `set` does
 * (`settings/+page.server.ts`, `forgetSource`): the way back must ask again,
 * which is what makes a cold answer, slowly.
 */
async function forgetKept(page: Page) {
	// The settings page's load is what keeps the source's preferences, and the
	// action reads them; asked without navigating, so history is left alone.
	await page.request.get(`${world.base}/browse/${MANGA.id}/settings`);
	const set = await page.request.post(`${world.base}/browse/${MANGA.id}/settings?/set`, {
		form: { key: 'quality', value: '1' },
		headers: { origin: world.base }
	});
	expect(set.ok(), 'the setting was saved').toBe(true);
}

/**
 * Record every tile title the document attaches from here on. A kept list drawn
 * for a frame (or a second) leaves its record, and no polling of the count can
 * see it: the observer sees every node as it is added.
 */
async function watchTiles(page: Page) {
	await page.evaluate(() => {
		const seen: string[] = [];
		(window as unknown as { __tiles: string[] }).__tiles = seen;
		const note = (node: Node) => {
			if (!(node instanceof Element)) return;
			const tiles = [
				...(node.matches('.grid a.tile') ? [node] : []),
				...node.querySelectorAll('.grid a.tile')
			];
			for (const t of tiles) seen.push(t.querySelector('.t')?.textContent ?? '');
		};
		new MutationObserver((records) => {
			for (const r of records) for (const n of r.addedNodes) note(n);
		}).observe(document.body, { childList: true, subtree: true });
	});
}

/** Every tile title attached since `watchTiles`. */
const tilesSeen = (page: Page) =>
	page.evaluate(() => (window as unknown as { __tiles?: string[] }).__tiles ?? []);

/** The waiting outline's cells: the kept list's size, no title and no cover. */
const outlineCells = (page: Page) => page.locator('.grid[aria-hidden="true"] .tile').count();

/** The library series the HIDE cases hide, through the series screen's own action. */
async function hideFound(page: Page, on: boolean) {
	// Hiding is the reader's own act with reveal off (the action answers it with a
	// 303 to the library). Showing it again needs reveal: hidden with reveal off,
	// the series is not found, so the screen's own action 404s.
	if (!on) await revealOn(page.context(), world.base);
	try {
		const answer = await page.request.post(`${world.base}/series/${world.foundSeriesId}?/hide`, {
			form: { on: on ? '1' : '0' },
			headers: { origin: world.base }
		});
		expect(answer.ok(), 'the series screen hid or showed it').toBe(true);
	} finally {
		if (!on) await page.context().clearCookies({ name: 'tsundoku_reveal' });
	}
}

test('the browser’s back, from a preview at the 20-page cap: the same scroll, the same tile, nothing asked again', async ({
	page
}) => {
	test.setTimeout(120_000);
	const covers = watchCovers(page);
	// Past the cap on purpose: the server asks 20 pages at most.
	await page.goto(`${world.base}/browse/${MANGA.id}?pages=30`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 1-0');
	await expect.poll(() => gridCount(page), { timeout: 60_000 }).toBe(drawnBy(CAP));

	await scrollInto(page, 5000);
	const before = await place(page);
	expect(before.top, 'a tile is at the top').toMatch(/^Popular \d+-\d+$/);
	const drawn = await coversDrawn(page);
	expect(drawn.length, 'the covers are drawn').toBe(drawnBy(CAP));

	await openTopTile(page);
	// From here on: only what the way back asks.
	world.reset();
	covers.clear();
	await page.goBack();
	await page.waitForURL(/\/browse\//);
	await expect.poll(() => gridCount(page), { timeout: 30_000 }).toBe(drawnBy(CAP));
	await expect
		.poll(async () => (await place(page)).y, { timeout: 10_000 })
		.toBeGreaterThanOrEqual(before.y - 2);

	const after = await place(page);
	expect(after.top, 'the same tile is at the top').toBe(before.top);
	expect(Math.abs(after.y - before.y), 'the same scroll').toBeLessThanOrEqual(2);
	// The answer is still the source's own, kept: nothing is asked at all.
	expect(world.calls(), 'the source is asked nothing on the way back').toEqual([]);
	expect(world.images(), 'no cover is fetched again').toBe(0);
	expect(covers.again(drawn), 'no cover already shown is sent again').toEqual([]);
});

test('a source that answers slowly: the place is held while this visit’s answer is on its way', async ({
	page
}) => {
	test.setTimeout(120_000);
	// The source's own settings first, so changing one can forget its kept
	// answers the way the app's own action does (settings/+page.server.ts, `set`).
	await page.request.get(`${world.base}/browse/${MANGA.id}/settings`);
	await page.goto(`${world.base}/browse/${MANGA.id}?q=cold&pages=1`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Found 1-0');
	const pages = await settleList(page, PER, 0);
	await scrollInto(page, 900);
	const before = await place(page);
	expect(before.top, 'a result is at the top').toMatch(/^Found \d+-\d+$/);

	await openTopTile(page);
	// Forgotten answers: the way back must ask the source, which then answers
	// slowly, so this visit's list is on its way for seconds.
	await forgetKept(page);
	world.reset();
	world.slow(4000);
	await page.goBack();
	await page.waitForURL(/\/browse\//);
	// While the answer is out, the place is an outline of the kept list's size:
	// not one tile of the kept list is drawn.
	await expect
		.poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000 })
		.toBeGreaterThanOrEqual(before.y - 2);
	expect(await gridCount(page), 'no kept tile is drawn before the answer').toBe(0);
	expect(await outlineCells(page), 'an outline holds the place').toBeGreaterThan(0);

	// Then this visit's answer draws in that place.
	await expect
		.poll(() => gridCount(page), { timeout: 30_000 })
		.toBeGreaterThanOrEqual(drawnBy(pages, PER, 0));
	const after = await place(page);
	expect(after.top, 'the same result is at the top').toBe(before.top);
	expect(Math.abs(after.y - before.y), 'the same scroll').toBeLessThanOrEqual(2);
	// And it really ran cold: the source was asked for the pages it had drawn.
	expect(
		pagesReasked(world.calls(), pages).length,
		'the cold list was asked for again'
	).toBeGreaterThan(0);
});

test('a series hidden after the list was left is never drawn on a popstate', async ({ page }) => {
	test.setTimeout(180_000);
	await page.goto(`${world.base}/browse/${MANGA.id}?q=hidden&pages=${FOUND_PAGES}`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Found 1-0');
	await expect.poll(() => gridCount(page), { timeout: 60_000 }).toBe(drawnBy(FOUND_PAGES, PER, 0));
	await scrollInto(page, 2500);
	const before = await place(page);
	expect(before.top, 'a result is at the top').toMatch(/^Found \d+-\d+$/);
	await expect(tileTitled(page, HIDDEN_TITLE), 'the series is drawn now').toHaveCount(1);

	await openTopTile(page);
	try {
		// Hidden between leaving and coming back, by the series screen's own HIDE.
		await hideFound(page, true);
		// The way back asks the source again, slowly: the kept answer would be on
		// screen for seconds if it were drawn.
		await forgetKept(page);
		world.reset();
		world.slow(4000);
		await watchTiles(page);
		await page.goBack();
		await page.waitForURL(/\/browse\//);

		// An outline the kept list's size holds the place, and no kept tile is drawn.
		await expect
			.poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000 })
			.toBeGreaterThanOrEqual(before.y - 2);
		expect(await gridCount(page), 'no kept tile is drawn before the answer').toBe(0);
		expect(await outlineCells(page), 'an outline holds the place').toBeGreaterThan(0);

		// This visit's answer: the list, one shorter, at the same place.
		await expect
			.poll(() => gridCount(page), { timeout: 30_000 })
			.toBe(drawnBy(FOUND_PAGES, PER, 0) - 1);
		const after = await place(page);
		expect(after.top, 'the same result is at the top').toBe(before.top);
		expect(Math.abs(after.y - before.y), 'the same scroll').toBeLessThanOrEqual(2);

		// Not once, not for a frame: the observer saw every tile the document took,
		// and the hidden series is not among them.
		await expect
			.poll(async () => (await tilesSeen(page)).length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const seen = await tilesSeen(page);
		expect(seen, 'the hidden series was never attached').not.toContain(HIDDEN_TITLE);
		expect(seen, 'the list was drawn after the observer watched').toContain(before.top!);
	} finally {
		await hideFound(page, false);
	}
});

test('a series hidden after the list was left is never drawn by the preview’s ←', async ({
	page
}) => {
	test.setTimeout(180_000);
	await page.goto(`${world.base}/browse/${MANGA.id}?q=hidden-left&pages=${FOUND_PAGES}`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Found 1-0');
	await expect.poll(() => gridCount(page), { timeout: 60_000 }).toBe(drawnBy(FOUND_PAGES, PER, 0));
	await scrollInto(page, 2500);
	const before = await place(page);
	expect(before.top, 'a result is at the top').toMatch(/^Found \d+-\d+$/);

	// The departure toward the preview leaves the record the ← reads.
	await openTopTile(page);
	try {
		await hideFound(page, true);
		await forgetKept(page);
		world.reset();
		world.slow(4000);
		await watchTiles(page);
		await page.locator('.preview header.bar a.back').click();
		await page.waitForURL(/\/browse\//);

		await expect
			.poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000 })
			.toBeGreaterThanOrEqual(before.y - 2);
		expect(await gridCount(page), 'no kept tile is drawn before the answer').toBe(0);
		expect(await outlineCells(page), 'an outline holds the place').toBeGreaterThan(0);

		await expect
			.poll(() => gridCount(page), { timeout: 30_000 })
			.toBe(drawnBy(FOUND_PAGES, PER, 0) - 1);
		const after = await place(page);
		expect(after.top, 'the same result is at the top').toBe(before.top);
		expect(Math.abs(after.y - before.y), 'the same scroll').toBeLessThanOrEqual(2);

		await expect
			.poll(async () => (await tilesSeen(page)).length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const seen = await tilesSeen(page);
		expect(seen, 'the hidden series was never attached').not.toContain(HIDDEN_TITLE);
		expect(seen, 'the list was drawn after the observer watched').toContain(before.top!);
	} finally {
		await hideFound(page, false);
	}
});

test('the preview’s plain ←: the same scroll, the same tile, nothing asked again', async ({
	page
}) => {
	test.setTimeout(120_000);
	const covers = watchCovers(page);
	await page.goto(`${world.base}/browse/${MANGA.id}?pages=4`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 1-0');
	const pages = await settleList(page);

	await scrollInto(page, 900);
	const before = await place(page);
	const drawn = await coversDrawn(page);
	await openTopTile(page);
	world.reset();
	covers.clear();
	await page.locator('.preview header.bar a.back').click();
	await page.waitForURL(/\/browse\//);
	await expect(page.locator('.grid a.tile').first()).toBeVisible();
	await expect
		.poll(async () => (await place(page)).y, { timeout: 10_000 })
		.toBeGreaterThanOrEqual(before.y - 2);

	const after = await place(page);
	expect(after.top, 'the same tile is at the top').toBe(before.top);
	expect(Math.abs(after.y - before.y), 'the same scroll').toBeLessThanOrEqual(2);
	expect(pagesReasked(world.calls(), pages), 'no page already drawn is asked again').toEqual([]);
	expect(covers.again(drawn), 'no cover already shown is sent again').toEqual([]);
});

test('the next page adds its tiles and leaves the drawn ones alone', async ({ page }) => {
	test.setTimeout(120_000);
	// A search of this source, so the pages are ones no earlier case asked the
	// source for (its kept answers live in the preview's process, not the test's).
	await page.goto(`${world.base}/browse/${MANGA.id}?q=found&pages=1`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Found 1-0');
	// The end of a short list comes into view at once, so it asks for more by
	// itself: settle where it stopped, which is the URL's own `pages`.
	const startsAt = await settleList(page, PER, 0);
	expect(startsAt).toBeGreaterThan(1);
	expect(await gridCount(page)).toBe(drawnBy(startsAt, PER, 0));
	const drawn = await coversDrawn(page);

	await page.evaluate(() => {
		document.querySelector('.grid a.tile')?.setAttribute('data-probe', 'kept');
	});
	world.reset();
	const covers = watchCovers(page);
	covers.clear();
	// MORE ↓ is the same `?pages=N+1` load as the one scrolling on asks for, and
	// the way on a short list keeps: the observer speaks only on a change, and
	// the row below the grid is already in view at this width.
	await page.locator('.more .go').click();
	await expect.poll(() => gridCount(page), { timeout: 30_000 }).toBe(drawnBy(startsAt + 1, PER, 0));

	expect(
		await page.evaluate(() => document.querySelector('.grid a.tile')?.getAttribute('data-probe')),
		'the tiles already drawn are the same elements'
	).toBe('kept');
	const asks = world
		.calls()
		.filter((c) => /^(getPopularManga|getLatestManga|getSearchManga):\d+$/.test(c));
	expect(asks, 'the new page is the only page asked for').toEqual([
		`getSearchManga:${startsAt + 1}`
	]);
	expect(covers.again(drawn), 'no cover already shown is sent again').toEqual([]);
});

test('a reload keeps today’s behaviour: the URL’s pages, and no place put back', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.goto(`${world.base}/browse/${MANGA.id}?pages=4`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 1-0');
	const pages = await settleList(page);
	await scrollInto(page, 900);
	const before = await place(page);
	// A kept place is in the entry now: leaving and coming back by the browser's
	// back puts it there, and its snapshot is what a reload would restore.
	await openTopTile(page);
	await page.goBack();
	await page.waitForURL(/\/browse\//);
	await expect.poll(async () => (await place(page)).y).toBeGreaterThanOrEqual(before.y - 2);

	// The browser's own reload scroll is taken out of it, so what is left is the
	// page's: a restored snapshot would land at 900, today's page at the top.
	await page.addInitScript(() => (history.scrollRestoration = 'manual'));
	await page.reload();
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 1-0');
	// The URL's pages, and the one a fresh mount asks for by itself: what the
	// page does at the top, not a kept list.
	await expect
		.poll(() => gridCount(page), { timeout: 30_000 })
		.toBeGreaterThanOrEqual(drawnBy(pages));
	await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThanOrEqual(1);
	expect(await place(page)).toEqual({ y: 0, top: 'Popular 1-0' });
});

test('a forward visit keeps today’s behaviour: the top, with no place put back', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.goto(`${world.base}/browse/${MANGA.id}?pages=4`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 1-0');
	await settleList(page);
	await scrollInto(page, 900);
	const before = await place(page);
	expect(before.top).toMatch(/^Popular \d+-\d+$/);
	// The preview's ← puts the place back, so the departure left a record.
	await openTopTile(page);
	await page.locator('.preview header.bar a.back').click();
	await page.waitForURL(/\/browse\//);
	await expect.poll(async () => (await place(page)).y).toBeGreaterThanOrEqual(before.y - 2);

	// The catalog's ← names BROWSE; the same source, pressed there, is a forward
	// visit, and it starts at the top.
	await page.locator('a[aria-label="Back to BROWSE"]').click();
	await page.waitForURL(/\/browse$/);
	const row = page.getByRole('link', { name: new RegExp(MANGA.name) }).first();
	await expect(row).toBeVisible();
	await row.click();
	await page.waitForURL(new RegExp(`/browse/${MANGA.id}`));
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 1-0');
	await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThanOrEqual(1);
	expect((await place(page)).top).toBe('Popular 1-0');
});

test('under reveal: nothing of the revealed list comes back after reveal ends', async ({
	page,
	context
}) => {
	test.setTimeout(120_000);
	const reveal = (on: boolean) =>
		on ? revealOn(context, world.base) : context.clearCookies({ name: 'tsundoku_reveal' });
	await reveal(true);
	await page.goto(`${world.base}/browse/${MANGA.id}?pages=2`);
	// The hidden series is drawn inside reveal, and is not with it off.
	const hidden = tileTitled(page, 'Popular 1-5');
	await expect(hidden).toBeVisible();
	await expect(hidden.locator('.badge.reveal')).toHaveText('HIDDEN');
	// Inside reveal nothing is dropped, so a page carries all of them.
	const pages = await settleList(page, PER, 0);
	expect(pages, 'more than one page, so the place is a real one').toBeGreaterThan(1);
	await page.evaluate(() => scrollTo({ top: 40, behavior: 'instant' }));

	// Leave toward the preview inside reveal: no record may be kept for it.
	await openTopTile(page);
	expect(
		await page.evaluate(() => sessionStorage.getItem('tsundoku.browse-left')),
		'a revealed list leaves no place'
	).toBeNull();

	await reveal(false);
	// What the eye would see of a kept list, frame by frame: the document stays
	// while the popstate draws the list again, so this samples every frame.
	await page.evaluate(() => {
		const seen: { tiles: number; hidden: number }[] = [];
		(window as unknown as { __seen: typeof seen }).__seen = seen;
		const tick = () => {
			seen.push({
				tiles: document.querySelectorAll('.grid a.tile').length,
				hidden: document.querySelectorAll('.grid .badge.reveal').length
			});
			if (seen.length < 600) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await page.goBack();
	await page.waitForURL(/\/browse\//);
	// The reveal-off list: the hidden series gone, so one fewer than the pages
	// would carry.
	await expect
		.poll(() => gridCount(page), { timeout: 30_000 })
		.toBeGreaterThanOrEqual(pages * PER - 1);
	await expect(tileTitled(page, 'Popular 1-5')).toHaveCount(0);
	const seen = await page.evaluate(
		() => (window as unknown as { __seen: { tiles: number; hidden: number }[] }).__seen
	);
	expect(
		seen.some((s) => s.tiles > 0),
		'the sampler saw the list drawn'
	).toBe(true);
	expect(
		seen.filter((s) => s.hidden > 0),
		'no frame drew the revealed list'
	).toEqual([]);
});

test('a novel source: its place comes back too', async ({ page }) => {
	test.setTimeout(120_000);
	await page.goto(`${world.base}/browse/ln:${PLUGIN}`);
	const tile = page.locator('.grid a.tile', { hasText: 'The Quiet Shelf' }).first();
	await expect(tile).toBeVisible();
	await tile.click();
	await page.waitForURL(/\/downloads\/source\/ln%3A|^[^?]*\/downloads\/source\//);
	await expect(page.getByText('The Quiet Shelf').first()).toBeVisible();
	await page.goBack();
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/browse/ln:${PLUGIN}`);
	await expect(page.locator('.grid a.tile', { hasText: 'The Quiet Shelf' })).toHaveCount(1);
	expect((await place(page)).top).toBe('The Quiet Shelf');

	// And the preview's ←, which this plugin's list shares the path with.
	await tile.click();
	await expect(page.getByText('The Quiet Shelf').first()).toBeVisible();
	await page.locator('.preview header.bar a.back').click();
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/browse/ln:${PLUGIN}`);
	await expect(page.locator('.grid a.tile', { hasText: 'The Quiet Shelf' })).toHaveCount(1);
});

test('an anime source: the same scroll and tile come back', async ({ page }) => {
	test.setTimeout(120_000);
	const covers = watchCovers(page);
	await page.goto(`${world.base}/browse/${ANIME.id}?pages=2`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Show 1-0');
	await expect.poll(() => gridCount(page), { timeout: 30_000 }).toBe(2 * PER);
	await scrollInto(page, 260);
	const before = await place(page);
	expect(before.top, 'a show is at the top').toMatch(/^Show \d+-\d+$/);
	const drawn = await coversDrawn(page);
	world.reset();
	covers.clear();
	const leaving = (await visibleTitle(page))!;
	await tileTitled(page, leaving).click();
	await page.waitForURL(/\/downloads\/source\//);
	await expect(page.getByRole('heading', { name: 'A Show' })).toBeVisible();
	await page.goBack();
	await page.waitForURL(/\/browse\//);
	await expect.poll(() => gridCount(page), { timeout: 30_000 }).toBe(2 * PER);
	await expect
		.poll(async () => (await place(page)).y, { timeout: 10_000 })
		.toBeGreaterThanOrEqual(before.y - 2);
	const after = await place(page);
	expect(after.top, 'the same show is at the top').toBe(before.top);
	expect(pagesReasked(world.calls(), 2), 'no page already drawn is asked again').toEqual([]);
	expect(covers.again(drawn), 'no cover already shown is sent again').toEqual([]);
});
