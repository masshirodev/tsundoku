import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { freePort } from './helpers/tag-world';

/**
 * The focus mark on BROWSE's catalog tiles with the remote (card c864;
 * doc/BROWSE.md, doc/FOCUS.md, "The mark"), at 960×540 with no pointer. The
 * mark is read off the page: the focused tile's cover carries the ring, and
 * every side and corner of that ring is on the focused tile, with no
 * neighbour or bar drawn over it. On a world of its own, because the catalog
 * needs a grid with neighbours on all sides and a LATEST tab, which the tag
 * world (one result, no LATEST) cannot give, and the browse world's engine is
 * steered by the `browse` project running beside this one.
 */

const SOURCE = { id: '500', name: 'Mark Source' };

type World = { base: string; stop: () => Promise<void> };
let world: World;

function seed(dbPath: string): void {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES ('e2e.mark', ?, 'manga', 1, '1', '1', ?, 0, 0, '')`
		).run(SOURCE.name, 'e2e.mark'.padEnd(64, '0'));
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'e2e.mark', ?, 'en', 'https://mark.example')`
		).run(SOURCE.id, SOURCE.name);
	} finally {
		db.close();
	}
}

/** A page of a list, as a source answers: enough tiles for a row below a row. */
const page14 = (prefix: string, hasNextPage = false) => ({
	mangas: Array.from({ length: 14 }, (_, i) => ({
		url: `/manga/${prefix}-${i}`,
		title: `${prefix} ${i}`,
		status: 1,
		thumbnail_url: null
	})),
	hasNextPage
});

function startEngine(port: number): Promise<Server> {
	const server = createHttp((req, res) => {
		const json = (v: unknown) =>
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
		if (req.url === '/challenges') return json({ solving: {}, solved: {} });
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as { method: string; mangaData?: { url: string } };
			const url = b.mangaData?.url ?? '';
			switch (b.method) {
				case 'filterSchemaManga':
					return json([]);
				case 'supportLatestManga':
					return json(true);
				case 'getPopularManga':
					return json(page14('Popular'));
				case 'getLatestManga':
					return json(page14('Latest'));
				case 'getSearchManga':
					return json(page14('Found'));
				case 'getDetailsManga':
					return json({
						url,
						title: 'A Preview',
						description: 'One to come back from.',
						status: 1
					});
				case 'getChapterList':
					return json([{ url: `${url}/c1`, name: 'Chapter 1', chapter_number: 1 }]);
				default:
					res.writeHead(404).end('{}');
			}
		});
	});
	return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

async function startWorld(): Promise<World> {
	const work = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-tv-browse-focus-'));
	const dbPath = join(work, 'library.sqlite');
	seed(dbPath);
	const enginePort = await freePort();
	const engine = await startEngine(enginePort);
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
	if (!up) throw new Error('the tv-browse-focus preview never answered');
	return {
		base,
		stop: async () => {
			preview.kill();
			engine.closeAllConnections();
			await new Promise((ok) => engine.close(ok));
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

const focusedTile = (page: Page) =>
	page.evaluate(() => !!document.activeElement?.closest('.grid a.tile'));

/** Down from wherever the pad is to the grid, then in to a tile with neighbours on every side. */
async function padToInnerTile(page: Page): Promise<void> {
	await expect(page.locator('.grid a.tile').first()).toBeVisible();
	for (let i = 0; i < 12 && !(await focusedTile(page)); i++) {
		await page.keyboard.press('ArrowDown');
	}
	expect(await focusedTile(page), 'the pad reached the grid').toBe(true);
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowDown');
	expect(await focusedTile(page), 'the pad stayed on a tile').toBe(true);
}

type Ring = {
	shadow: string;
	covered: string[];
	neighbours: { right: boolean; below: boolean };
};

/**
 * The ink band sits 3 to 7 px off the cover (`--focus-ring`). A point in the
 * middle of it, on each side and at each corner, has to hit the focused tile
 * itself: a neighbour's background or a bar over it would hit that instead.
 */
const readRing = (page: Page) =>
	page.evaluate((): Ring => {
		const tile = document.activeElement as HTMLElement;
		const cover = tile.querySelector('.cover') as HTMLElement;
		const c = cover.getBoundingClientRect();
		const t = tile.getBoundingClientRect();
		const off = 5;
		const points: Record<string, [number, number]> = {
			top: [c.left + c.width / 2, c.top - off],
			right: [c.right + off, c.top + c.height / 2],
			bottom: [c.left + c.width / 2, c.bottom + off],
			left: [c.left - off, c.top + c.height / 2],
			'top-left': [c.left - off, c.top - off],
			'top-right': [c.right + off, c.top - off],
			'bottom-right': [c.right + off, c.bottom + off],
			'bottom-left': [c.left - off, c.bottom + off]
		};
		const covered = Object.entries(points)
			.filter(([, [x, y]]) => {
				const hit = document.elementFromPoint(x, y);
				return !hit || !tile.contains(hit);
			})
			.map(([side]) => side);
		// By rects, not `elementFromPoint`: the row below is usually past a 540 px screen.
		const others = [...document.querySelectorAll('.grid a.tile')]
			.filter((el) => el !== tile)
			.map((el) => el.getBoundingClientRect());
		const across = (r: DOMRect) => r.left < t.right && r.right > t.left;
		const along = (r: DOMRect) => r.top < t.bottom && r.bottom > t.top;
		return {
			shadow: getComputedStyle(cover).boxShadow,
			covered,
			neighbours: {
				right: others.some((r) => along(r) && r.left >= t.right),
				below: others.some((r) => across(r) && r.top >= t.bottom)
			}
		};
	});

/** The mark, read the same way on whichever list is showing. */
async function expectMark(page: Page): Promise<void> {
	const ring = await readRing(page);
	// The token's own shape: 3 px of page, then 4 px of ink.
	expect(ring.shadow, 'the cover wears the focus ring').toMatch(/0px 0px 0px 3px.*0px 0px 0px 7px/);
	expect(ring.covered, 'no side of the ring is covered').toEqual([]);
	expect(ring.neighbours, 'a tile with neighbours, or this proves nothing').toEqual({
		right: true,
		below: true
	});
}

test('POPULAR: the focused tile wears the mark, whole, among its neighbours', async ({ page }) => {
	expect(
		await page.evaluate(() => matchMedia('(pointer: none)').matches),
		'the tv project has no pointer'
	).toBe(true);
	await page.goto(`${world.base}/browse/${SOURCE.id}`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');
	await padToInnerTile(page);
	await expectMark(page);
});

test('LATEST: the same mark', async ({ page }) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}?tab=latest`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Latest 0');
	await padToInnerTile(page);
	await expectMark(page);
});

test('a search: the same mark', async ({ page }) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}?q=found`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Found 0');
	await padToInnerTile(page);
	await expectMark(page);
});

test('back from a preview: the same tile holds the mark again', async ({ page }) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');
	await padToInnerTile(page);
	const left = await page.evaluate(
		() => (document.activeElement as HTMLElement).querySelector('.t')?.textContent
	);
	expect(left, 'a tile was focused before leaving').toMatch(/^Popular \d+$/);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/downloads\/source\//);
	await page.goBack();
	await page.waitForURL(/\/browse\//);
	await expect(page.locator('.grid a.tile:focus .t')).toHaveText(left as string);
	await expectMark(page);
});

test('back by the preview’s own ←: the same tile holds the mark again', async ({ page }) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');
	await padToInnerTile(page);
	const left = await page.evaluate(
		() => (document.activeElement as HTMLElement).querySelector('.t')?.textContent
	);
	expect(left, 'a tile was focused before leaving').toMatch(/^Popular \d+$/);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/downloads\/source\//);
	await expect(page.getByText('A Preview').first()).toBeVisible();
	const onBack = () => page.evaluate(() => !!document.activeElement?.matches('a.back'));
	for (let i = 0; i < 12 && !(await onBack()); i++) await page.keyboard.press('ArrowUp');
	expect(await onBack(), 'the pad reached the preview’s ←').toBe(true);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/browse\//);
	await expect(page.locator('.grid a.tile:focus .t')).toHaveText(left as string);
	await expectMark(page);
});

test('under FILTER’s scrim: the mark is drawn over it', async ({ page }) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}?panel=1`);
	await expect(page.locator('.grid.dim a.tile').first()).toBeVisible();
	await page.locator('.grid a.tile').first().focus();
	// A real key, so the browser counts the focus as `:focus-visible`.
	await page.keyboard.press('ArrowRight');
	expect(await focusedTile(page), 'the pad is on a tile').toBe(true);
	await expectMark(page);
});
