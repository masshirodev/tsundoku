import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { freePort } from './helpers/tag-world';

/**
 * The focus mark on BROWSE's catalog tiles with the remote (card c864;
 * doc/BROWSE.md, doc/FOCUS.md, "The mark"), at 960×540 with no pointer. The
 * mark is read off the page: the focused tile's cover carries the ring, and
 * every side and corner of that ring is on the focused tile, with no
 * neighbour or bar drawn over it. It also walks the ways back a tag opens:
 * the catalog's ← and the preview's ← each land on the screen they name, never
 * on the tag search they share a path with, and the tile the reader left comes
 * back with a plain navigation (c864). On a world of its own, because the catalog
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
/**
 * The page-list calls the fake source is asked for, so a way back can say it
 * asked for none of what was drawn (c930). Reset before the return.
 */
let asks: string[] = [];

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
			const b = JSON.parse(raw || '{}') as {
				method: string;
				page?: number;
				mangaData?: { url: string };
			};
			const url = b.mangaData?.url ?? '';
			if (/^get(Popular|Latest|Search)Manga$/.test(b.method))
				asks.push(`${b.method}:${b.page ?? 1}`);
			switch (b.method) {
				case 'filterSchemaManga':
					return json([]);
				case 'supportLatestManga':
					return json(true);
				case 'getPopularManga':
					// Two pages, so a place deep in the list is a real one (c930).
					return json((b.page ?? 1) === 1 ? page14('Popular', true) : page14('Popular two'));
				case 'getLatestManga':
					return json(page14('Latest'));
				case 'getSearchManga':
					return json(page14('Found'));
				case 'getDetailsManga':
					return json({
						url,
						title: 'A Preview',
						description: 'One to come back from.',
						status: 1,
						// A tag to leave the preview by (c456); the search for it is a plain `q=`.
						author: 'Ren Kisaragi'
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

/** The page's address as the click left it, for asserting a destination rather than an href. */
const where = (page: Page) => {
	const u = new URL(page.url());
	return u.pathname + u.search;
};

/** Follow a link the way the remote does: focus it, then Enter. */
async function press(page: Page, link: Locator): Promise<void> {
	await link.focus();
	await page.keyboard.press('Enter');
}

/** Wait for the address a link's click lands on, never the address it names. */
async function expectWhere(page: Page, want: string): Promise<void> {
	await expect.poll(() => where(page)).toBe(want);
}

/** The preview's own ←, never a catalog's ←, and only the one naming `href`. */
const previewBack = (page: Page, href: string) =>
	page.locator('.preview header.bar a.back').and(page.locator(`a[href="${href}"]`));

/**
 * The catalog's ← a tag sent the reader to, naming `href`, once its screen is
 * up. A key comes first: the arrival may still be putting a tile back
 * (`restoreFocus`), and the reader's first key is what ends that, so focussing
 * the ← from script must end it too or the tile takes focus back mid-frame.
 */
async function catalogBack(page: Page, href: string) {
	await page.keyboard.press('ArrowUp');
	const link = page
		.getByRole('link', { name: 'Back to the preview' })
		.and(page.locator(`a[href="${href}"]`));
	await expect(link).toBeVisible();
	return link;
}

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
	expect(left, 'a tile was focused before leaving').toMatch(/^Popular/);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/downloads\/source\//);
	await page.goBack();
	await page.waitForURL(/\/browse\//);
	await expect(page.locator('.grid a.tile:focus .t')).toHaveText(left as string);
	await expectMark(page);
});

test('BACK from a preview, deep in the list: the same tile, and the same scroll', async ({
	page
}) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}?pages=2`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');
	await expect.poll(() => page.locator('.grid a.tile').count()).toBe(28);
	// Down into the lower rows, so the place is not the top of the list.
	await padToInnerTile(page);
	for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
	const left = await focusedTitle(page);
	expect(left, 'a tile was focused before leaving').toMatch(/^Popular/);
	const y = await page.evaluate(() => Math.round(scrollY));
	expect(y, 'the list is scrolled away from the top').toBeGreaterThan(0);

	asks = [];
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/downloads\/source\//);
	await expect(page.getByText('A Preview').first()).toBeVisible();
	// The remote's BACK (doc/FOCUS.md): a GoBack key through the layer, which
	// leaves the screen when there is nothing open for it to close.
	await page.evaluate(() =>
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'GoBack', bubbles: true }))
	);
	await page.waitForURL(/\/browse\//);
	await expect(page.locator('.grid a.tile:focus .t')).toHaveText(left as string);
	await expectMark(page);
	await expect
		.poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000 })
		.toBeGreaterThanOrEqual(y - 2);
	expect(asks, 'the source was asked nothing it had drawn again').toEqual([]);
});

test('ADD from a preview: BACK is one press, onto the catalog at its place', async ({ page }) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');
	await expect.poll(() => page.locator('.grid a.tile').count()).toBe(28);
	await padToInnerTile(page);
	for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
	const left = await focusedTitle(page);
	expect(left, 'a tile was focused before leaving').toMatch(/^Popular/);
	const y = await page.evaluate(() => Math.round(scrollY));
	expect(y, 'the list is scrolled away from the top').toBeGreaterThan(0);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/downloads\/source\//);
	await expect(page.getByText('A Preview').first()).toBeVisible();

	// + ADD TO LIBRARY, pressed the remote's way: the button focused, then OK.
	const add = page.getByRole('button', { name: /ADD TO LIBRARY/ });
	await add.focus();
	await page.keyboard.press('Enter');
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	await expect(page.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })).toBeVisible();
	// One press of BACK (c932: the add replaced the preview's entry) lands on the
	// catalog, not on the preview again.
	await page.evaluate(() =>
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'GoBack', bubbles: true }))
	);
	await page.waitForURL(/\/browse\//);
	await expect(page.locator('.grid a.tile:focus .t')).toHaveText(left as string);
	await expectMark(page);
	await expect
		.poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000 })
		.toBeGreaterThanOrEqual(y - 2);

	// The library back as it was: forward to the series, UNDO on its band.
	await page.goForward();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	const undo = page
		.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })
		.getByRole('button', { name: 'UNDO' });
	await expect(undo).toBeVisible();
	await undo.click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/downloads\/source\//);
	await expect(add).toBeVisible();
});

test('back by the preview’s own ←: the same tile holds the mark again', async ({ page }) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');
	await padToInnerTile(page);
	const left = await page.evaluate(
		() => (document.activeElement as HTMLElement).querySelector('.t')?.textContent
	);
	expect(left, 'a tile was focused before leaving').toMatch(/^Popular/);
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

/** Down from an inner tile to the list's last row, far enough that a return to it scrolls. */
async function padToLowTile(page: Page): Promise<void> {
	await padToInnerTile(page);
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
	expect(await focusedTile(page), 'the pad is on a low tile').toBe(true);
}

/** The focused thing's title, before the screen is left by key. */
const focusedTitle = (page: Page) =>
	page.evaluate(() => (document.activeElement as HTMLElement).querySelector('.t')?.textContent);

/** The preview's own ←, pressed the way the remote reaches it. */
async function backByPreview(page: Page): Promise<void> {
	await expect(page.getByText('A Preview').first()).toBeVisible();
	const onBack = () => page.evaluate(() => !!document.activeElement?.matches('a.back'));
	for (let i = 0; i < 12 && !(await onBack()); i++) await page.keyboard.press('ArrowUp');
	expect(await onBack(), 'the pad reached the preview’s ←').toBe(true);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/browse\//);
}

/** Two frames, so a restore that would put a tile back has had its moment. */
const twoFrames = (page: Page) =>
	page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('a forward arrival with a saved id: no tile is focused, and the list starts at the top', async ({
	page
}) => {
	await page.goto(`${world.base}/browse`);
	const row = page.getByRole('link', { name: new RegExp(SOURCE.name) }).first();
	await expect(row).toBeVisible();
	await press(page, row);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');

	// Down to the last row, so a tile put back would have to scroll the list.
	await padToLowTile(page);
	const left = await focusedTitle(page);
	expect(left, 'a low tile was focused before leaving').toMatch(/^Popular/);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/downloads\/source\//);
	await backByPreview(page);
	// The leg that left this list puts the tile back, so an id was saved for it.
	await expect(page.locator('.grid a.tile:focus .t')).toHaveText(left as string);
	expect(await page.evaluate(() => scrollY), 'the saved tile pulled the list down').toBeGreaterThan(
		0
	);

	// The catalog’s ← names BROWSE and opens it; the same row, pressed again,
	// is a forward visit, which must start at the top with no tile held. The
	// key first ends the restore that put the tile back, or the tile takes
	// focus from the ← as it is focused from script.
	await page.keyboard.press('ArrowUp');
	const browseBack = page.getByRole('link', { name: 'Back to BROWSE' });
	await expect(browseBack).toBeVisible();
	await press(page, browseBack);
	await expectWhere(page, '/browse');
	await press(page, page.getByRole('link', { name: new RegExp(SOURCE.name) }).first());
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');
	await twoFrames(page);
	expect(await focusedTile(page), 'a forward visit holds no tile').toBe(false);
	expect(await page.evaluate(() => scrollY), 'a forward visit starts at the top').toBe(0);
});

test('a reload with a saved id: no tile is focused, and only the page’s own scroll comes back', async ({
	page
}) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');
	await padToLowTile(page);
	const left = await focusedTitle(page);
	expect(left, 'a low tile was focused before leaving').toMatch(/^Popular/);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/downloads\/source\//);
	await backByPreview(page);
	// The leg that left this list puts the tile back, so an id was saved for it.
	await expect(page.locator('.grid a.tile:focus .t')).toHaveText(left as string);
	expect(await page.evaluate(() => scrollY), 'the saved tile pulled the list down').toBeGreaterThan(
		0
	);

	await page.reload();
	await expect(page.locator('.grid a.tile').first()).toContainText('Popular 0');
	await twoFrames(page);
	// SvelteKit restores a reload's scroll itself (it puts `scrollRestoration`
	// back to `auto` on `beforeunload`, client.js), so the list is not at the
	// top here: what the fix changes is that no tile is put back. Measured with
	// no saved id too, so this place is the page's own: 500 -> 467.
	expect(await focusedTile(page), 'a reload holds no tile').toBe(false);
	expect(
		await page.evaluate(() => scrollY),
		'the reload’s place is the page’s own'
	).toBeGreaterThan(0);
});

test('a tag from a preview: each ← lands on the screen it names, and the list’s tile comes back', async ({
	page
}) => {
	await page.goto(`${world.base}/browse/${SOURCE.id}?tab=latest`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Latest 0');
	await padToInnerTile(page);
	const left = await page.evaluate(
		() => (document.activeElement as HTMLElement).querySelector('.t')?.textContent
	);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'A Preview' })).toBeVisible();
	const preview = where(page);
	expect(preview).toContain(`/downloads/source/${SOURCE.id}~`);
	await press(page, page.getByRole('link', { name: 'Ren Kisaragi', exact: true }));
	await expect.poll(() => where(page)).toContain(`/browse/${SOURCE.id}?`);
	expect(new URL(page.url()).searchParams.get('q')).toBe('Ren Kisaragi');
	expect(new URL(page.url()).searchParams.get('from')).toBe(preview);
	// The catalog's ← opens the preview it names, and the preview's ← opens the
	// list: neither matches the tag search by path, so the two cannot loop.
	await press(page, await catalogBack(page, preview));
	await expectWhere(page, preview);
	await press(page, previewBack(page, `/browse/${SOURCE.id}?tab=latest`));
	await expectWhere(page, `/browse/${SOURCE.id}?tab=latest`);
	// The list's own mark still comes back with it: a plain way back has no
	// popstate to restore it, so the catalog restores it on arrival (c864).
	await expect(page.locator('.grid a.tile:focus .t')).toHaveText(left as string);
	await expectMark(page);
});

test('two tag round trips: ← walks the tag, its preview, the first tag, its preview, the list', async ({
	page
}) => {
	const list = `/browse/${SOURCE.id}?tab=latest`;
	await page.goto(`${world.base}${list}`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Latest 0');

	// X, from the list; tag A, from X.
	await padToInnerTile(page);
	const left = await page.evaluate(
		() => (document.activeElement as HTMLElement).querySelector('.t')?.textContent
	);
	expect(left, 'a tile was focused before leaving').toMatch(/^Latest \d+$/);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'A Preview' })).toBeVisible();
	const x = where(page);
	await press(page, page.getByRole('link', { name: 'Ren Kisaragi', exact: true }));
	await expect.poll(() => where(page)).toContain(`/browse/${SOURCE.id}?`);
	const a = where(page);
	expect(a).not.toBe(list);

	// Y, from A's grid; tag B, from Y. Different tiles, so a different preview.
	await padToInnerTile(page);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'A Preview' })).toBeVisible();
	const y = where(page);
	expect(y).not.toBe(x);
	await press(page, page.getByRole('link', { name: 'Ren Kisaragi', exact: true }));
	await expect.poll(() => where(page)).toContain(`/browse/${SOURCE.id}?`);
	const b = where(page);
	expect(b).not.toBe(a);

	// B -> Y -> A -> X -> the list, one ← at a time, with no loop.
	await press(page, await catalogBack(page, y));
	await expectWhere(page, y);
	await press(page, previewBack(page, a));
	await expectWhere(page, a);
	await press(page, await catalogBack(page, x));
	await expectWhere(page, x);
	await press(page, previewBack(page, list));
	await expectWhere(page, list);
	// And the tile the walk began from is marked again, three screens later.
	await expect(page.locator('.grid a.tile:focus .t')).toHaveText(left as string);
	await expectMark(page);
});

test('a tag search opened by address, with nothing behind it: ← opens the screen it names', async ({
	page
}) => {
	const from = `/downloads/source/${SOURCE.id}~${Buffer.from('/manga/Popular-2').toString('base64url')}?from=${encodeURIComponent(`/browse/${SOURCE.id}`)}`;
	await page.goto(
		`${world.base}/browse/${SOURCE.id}?q=Ren+Kisaragi&from=${encodeURIComponent(from)}`
	);
	await expect(page.locator('.grid a.tile').first()).toBeVisible();
	await press(page, await catalogBack(page, from));
	await expectWhere(page, from);
});

test('the same after a reload: ← still opens the screen it names', async ({ page }) => {
	const from = `/downloads/source/${SOURCE.id}~${Buffer.from('/manga/Popular-3').toString('base64url')}?from=${encodeURIComponent(`/browse/${SOURCE.id}`)}`;
	await page.goto(
		`${world.base}/browse/${SOURCE.id}?q=Ren+Kisaragi&from=${encodeURIComponent(from)}`
	);
	await page.reload();
	await expect(page.locator('.grid a.tile').first()).toBeVisible();
	await press(page, await catalogBack(page, from));
	await expectWhere(page, from);
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
