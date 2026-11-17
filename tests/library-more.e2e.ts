import { type Page, type Route } from '@playwright/test';
import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { startPreview } from './highlights-preview';

/**
 * The grid's next page, reached by any trigger (doc/LIBRARY.md, "Pages",
 * "The grid never stalls with its end on screen"). A plain `*.e2e.ts`, so the
 * four device projects each run it: where the end of the grid is depends on
 * the device, the bug on nothing else. Read-only, on the shared database.
 */

const pageRequests = (page: Page) => {
	const offsets: number[] = [];
	page.on('request', (r) => {
		const u = new URL(r.url());
		if (r.method() === 'GET' && u.pathname === '/api/library' && !u.searchParams.has('ids'))
			offsets.push(Number(u.searchParams.get('offset')));
	});
	return offsets;
};

async function shortPages(page: Page, size: number) {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: String(size), url: 'http://localhost' }]);
}

/**
 * Tiles tall enough that one page puts the end well past any device's margin,
 * from the first paint: a short tile would let the page's own `keepGoing`
 * read to the end of the seed before the case begins.
 */
async function tallTiles(page: Page) {
	await page.addInitScript(() => {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync('.grid .tile { height: 4000px; }');
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
	});
}

/**
 * The reported symptom: a page lands and the
 * viewport is at the new bottom within that same task, so the
 * IntersectionObserver takes no sample with the row out of range and has no
 * change to report. The scroll waits out a few microtasks because
 * `keepGoing` measures after `tick()`, in the same task: it must have
 * measured the row a page away, which is the state the bug needs.
 */
const bottomInSameTask = (page: Page) =>
	page.evaluate(() => {
		const grid = document.querySelector('.grid')!;
		const mo = new MutationObserver(async () => {
			mo.disconnect();
			for (let i = 0; i < 20; i++) await Promise.resolve();
			scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
			(window as unknown as { landed: boolean }).landed = true;
		});
		mo.observe(grid, { childList: true });
	});

test('a page that lands with the bottom on screen in the same task still asks for the next', async ({
	page
}) => {
	await shortPages(page, 9);
	const offsets = pageRequests(page);
	await tallTiles(page);
	await page.goto('/?sort=title');
	await expect(page.locator('.more')).toBeVisible();
	expect(offsets, 'nothing asked before the end comes near').toEqual([]);
	await bottomInSameTask(page);

	await page.evaluate(() =>
		scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
	);
	await page.waitForFunction(() => (window as unknown as { landed?: boolean }).landed === true);
	expect(offsets[0], 'the page that landed').toBe(9);
	await expect
		.poll(() => offsets, {
			message: 'the next page was asked for with no further input',
			timeout: 8000
		})
		.toEqual([9, 18]);
});

const isPageRead = (u: URL) => u.pathname === '/api/library' && !u.searchParams.has('ids');
const toBottom = (page: Page) =>
	page.evaluate(() =>
		scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
	);

/** An observer that never reports, so only the page's own checks can ask. */
const silentObserver = (page: Page) =>
	page.addInitScript(() => {
		window.IntersectionObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		} as unknown as typeof IntersectionObserver;
	});

async function onGrid(page: Page, size: number) {
	await shortPages(page, size);
	const offsets = pageRequests(page);
	await tallTiles(page);
	await page.goto('/?sort=title');
	await expect(page.locator('.more')).toBeVisible();
	return offsets;
}

test.describe('each trigger, on its own', () => {
	test('settling looks afresh: the end comes near with no scroll event and no sample between', async ({
		page
	}) => {
		const offsets = await onGrid(page, 9);
		// The page lands, `keepGoing` measures it far, and then, in that task,
		// only the new tiles shrink: the row is in reach, the scroll position
		// is untouched, and the observer's last word is still "intersecting".
		await page.evaluate(() => {
			const grid = document.querySelector('.grid')!;
			const mo = new MutationObserver(async () => {
				mo.disconnect();
				for (let i = 0; i < 20; i++) await Promise.resolve();
				const sheet = new CSSStyleSheet();
				sheet.replaceSync('.grid .tile:nth-child(n+10) { height: 40px; }');
				document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
				(window as unknown as { shrunk: boolean }).shrunk = true;
				addEventListener('scroll', () => ((window as unknown as { moved: boolean }).moved = true), {
					once: true
				});
			});
			mo.observe(grid, { childList: true });
		});
		await toBottom(page);
		await page.waitForFunction(() => (window as unknown as { shrunk?: boolean }).shrunk === true);
		await expect.poll(() => offsets, { timeout: 8000 }).toEqual([9, 18]);
		expect(
			await page.evaluate(() => (window as unknown as { moved?: boolean }).moved ?? false),
			'nothing scrolled: only the re-armed observer could have asked'
		).toBe(false);
	});

	test('scrolling asks by itself, with an observer that never speaks', async ({ page }) => {
		await silentObserver(page);
		const offsets = await onGrid(page, 9);
		expect(offsets).toEqual([]);
		await toBottom(page);
		await expect.poll(() => offsets, { timeout: 8000 }).toContain(9);
	});

	test('a scroll while a page is out asks for nothing more', async ({ page }) => {
		let release = () => {};
		const held = new Promise<void>((r) => (release = r));
		await page.route(
			(u) => isPageRead(u),
			async (route) => {
				await held;
				await route.continue();
			}
		);
		const offsets = await onGrid(page, 9);
		await toBottom(page);
		await expect.poll(() => offsets).toEqual([9]);
		for (let i = 0; i < 6; i++) {
			await page.evaluate((y) => scrollBy({ top: y, behavior: 'instant' }), i % 2 ? 300 : -300);
			await page.evaluate(() => new Promise(requestAnimationFrame));
		}
		expect(offsets, 'the one page out, once').toEqual([9]);
		release();
		await expect(page.locator('.grid .tile')).not.toHaveCount(9);
	});

	test('a re-read out holds the next page back, and its settle asks (the snapshot trigger)', async ({
		page
	}) => {
		// An observer that never speaks: a real change is still its to report
		// during a re-read, so only the frame-by-frame check is what this holds.
		await silentObserver(page);
		const SIZE = 7;
		// The page past the two kept out: it would make the re-read's limit 16, or
		// end the list, depending on who reaches the bottom first on a loaded box.
		const third = (u: URL) => isPageRead(u) && u.searchParams.get('offset') === '21';
		await page.route(third, () => undefined);
		const offsets = await onGrid(page, SIZE);
		// Two pages past the first, so the re-read (limit 14) is told from a page (limit 7).
		for (const want of [14, 21]) {
			await toBottom(page);
			await expect.poll(() => page.locator('.grid .tile').count()).toBeGreaterThanOrEqual(want);
		}
		await expect(page.locator('.more')).toBeVisible();

		await page.locator('.grid .tile .open').first().click();
		await page.waitForURL(/\/series\/\d+/);
		await page.unroute(third);
		offsets.length = 0;
		let release = () => {};
		const held = new Promise<void>((r) => (release = r));
		await page.route(
			(u) => isPageRead(u) && u.searchParams.get('limit') === '14',
			async (route) => {
				await held;
				await route.continue();
			}
		);
		const reread = page.waitForRequest((r) => new URL(r.url()).searchParams.get('limit') === '14');
		await page.goBack();
		await page.waitForURL((u) => u.pathname === '/');
		await reread;
		await toBottom(page);
		await page.evaluate(() => new Promise(requestAnimationFrame));
		await page.waitForTimeout(300);
		expect(
			offsets.filter((o) => o >= 21),
			'no next page while the re-read is out'
		).toEqual([]);
		release();
		await expect
			.poll(() => offsets.filter((o) => o >= 21), { message: 'the settle asked', timeout: 8000 })
			.toEqual([21]);
	});
});

test('a page out when a snapshot comes back does not keep the flag for ever', async ({ page }) => {
	// The first page's tiles short, so the screen coming back asks for a page
	// by itself, and the snapshot's bump drops that answer.
	await page.addInitScript(() => {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync('.grid .tile:nth-child(n+8) { height: 4000px; }');
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
	});
	await shortPages(page, 7);
	const offsets = pageRequests(page);
	const third = (u: URL) => isPageRead(u) && u.searchParams.get('offset') === '21';
	await page.route(third, () => undefined);
	await page.goto('/?sort=title');
	await expect.poll(() => page.locator('.grid .tile').count()).toBeGreaterThanOrEqual(14);
	await toBottom(page);
	await expect.poll(() => page.locator('.grid .tile').count()).toBeGreaterThanOrEqual(21);
	await page.locator('.grid .tile .open').first().click();
	await page.waitForURL(/\/series\/\d+/);
	await page.unroute(third);
	offsets.length = 0;

	// Whether the mount asks before the snapshot lands is the browser's timing,
	// so the case holds that request when it comes and asserts the outcome.
	const out: Route[] = [];
	await page.route(
		(u) =>
			isPageRead(u) && u.searchParams.get('offset') === '7' && u.searchParams.get('limit') === '7',
		(route) => void out.push(route) // kept out past the restore, so its bump drops the answer
	);
	await page.goBack();
	await page.waitForURL((u) => u.pathname === '/');
	await expect.poll(() => page.locator('.grid .tile').count()).toBeGreaterThanOrEqual(21);
	// A dropped answer is no help to the flag; it only ever frees one still current.
	for (const route of out) await route.continue().catch(() => undefined);
	// To the end by hand, again each poll: `settleScroll` keeps putting the page
	// back at its place for up to two seconds. Only a free flag asks.
	await expect
		.poll(
			async () => {
				await toBottom(page);
				return offsets.filter((o) => o === 21);
			},
			{ message: 'the next page', timeout: 8000 }
		)
		.toEqual([21]);
});

test.describe('a page that never answers', () => {
	test('ends in RETRY; a scroll does not ask again; the late answer is dropped; RETRY brings it', async ({
		page
	}) => {
		let late: Route | null = null;
		let first = true;
		await page.route(
			(u) => isPageRead(u),
			async (route) => {
				if (first) {
					first = false;
					late = route;
					return;
				}
				await route.continue();
			}
		);
		const offsets = await onGrid(page, 9);
		// After the load: only the page's own timer needs moving, and a clock
		// installed before it starves Playwright's hydration wait on a loaded box.
		await page.clock.install();
		await toBottom(page);
		const more = page.locator('.more');
		await expect(more).toContainText('LOADING');
		// The request's event can reach this process after the row has drawn.
		await expect.poll(() => offsets).toEqual([9]);
		const tiles = await page.locator('.grid .tile').count();

		await page.clock.fastForward(29_000);
		await expect(more).toContainText('LOADING');
		await page.clock.fastForward(1_500);
		const retry = more.getByRole('button', { name: 'RETRY' });
		await expect(retry).toBeVisible();
		await expect(more).toContainText('THE REST DID NOT LOAD');
		await expect(more).not.toContainText('LOADING');

		// A failure is not asked for again by a scroll: only RETRY or coming back.
		await page.evaluate(() => scrollBy({ top: -200, behavior: 'instant' }));
		await page.evaluate(() => new Promise(requestAnimationFrame));
		await page.waitForTimeout(200);
		expect(offsets, 'a scroll while failed asked nothing').toEqual([9]);

		// The answer after the timeout: the request is gone, nothing is drawn from it.
		await late!.fulfill({ json: { series: [] } }).catch(() => undefined);
		await page.waitForTimeout(200);
		await expect(page.locator('.grid .tile')).toHaveCount(tiles);
		await expect(retry).toBeVisible();

		await retry.click();
		await expect(page.locator('.grid .tile')).not.toHaveCount(tiles);
		expect(offsets.slice(0, 2), 'RETRY asked for the same page').toEqual([9, 9]);
		await expect(more.getByRole('button', { name: 'RETRY' })).toHaveCount(0);
	});
});

test('a page of nothing but repeats moves on, as a hand-shaped reply', async ({ page }) => {
	let once = true;
	await page.route(
		(u) => isPageRead(u),
		async (route, request) => {
			const u = new URL(request.url());
			if (!once) return route.continue();
			once = false;
			const res = await page.request.get(
				`/api/library?${new URLSearchParams({ ...Object.fromEntries(u.searchParams), offset: '0' })}`
			);
			await route.fulfill({ response: res });
		}
	);
	const offsets = await onGrid(page, 9);
	await toBottom(page);
	await expect.poll(() => offsets, { timeout: 8000 }).toEqual([9, 18]);
});

/**
 * The same page from a real writer: reading is what moves a series on RECENT,
 * so three chapters read on another device (`POST /api/reading`, the reader's
 * one progress call) put the next page's three in front and the page the
 * grid asks for next is the one it already shows. A database of its own,
 * because this writes.
 */
test.describe('a page of repeats from a real shelf move', () => {
	const scratch = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-more-'));
	const dbPath = join(scratch, 'library.sqlite');
	let server: ChildProcess | null = null;
	let base = '';

	// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
	test.beforeAll(async ({}, info) => {
		test.skip(info.project.name !== 'tablet-portrait', 'once: it needs its own preview');
		test.setTimeout(120_000);
		const port = await new Promise<number>((resolve, reject) => {
			const probe = createServer();
			probe.once('error', reject);
			probe.listen(0, '127.0.0.1', () => {
				const { port } = probe.address() as AddressInfo;
				probe.close(() => resolve(port));
			});
		});
		base = `http://localhost:${port}`;
		execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
			env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
			stdio: 'pipe'
		});
		server = await startPreview(
			() =>
				spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
					env: {
						...process.env,
						DATABASE_PATH: dbPath,
						TSUNDOKU_TOKEN: E2E_TOKEN,
						TSUNDOKU_ANILIST: 'off',
						LIBRARY_ROOT: join(scratch, 'library'),
						TSUNDOKU_HOME: join(scratch, 'home')
					},
					stdio: 'ignore'
				}),
			base,
			'library-more preview'
		);
	});

	test.afterAll(() => {
		server?.kill();
		server = null;
		rmSync(scratch, { recursive: true, force: true });
	});

	test('the offset moves past it, and nothing is asked twice', async ({ page }) => {
		const SIZE = 3;
		await shortPages(page, SIZE);
		const offsets = pageRequests(page);
		await tallTiles(page);
		await page.goto(`${base}/?sort=recent`);
		await expect(page.locator('.more')).toBeVisible();

		const ids = async (offset: number) =>
			(
				(await (
					await page.request.get(
						`${base}/api/library?shelf=all&sort=recent&offset=${offset}&limit=${SIZE}`
					)
				).json()) as { series: { id: number }[] }
			).series.map((s) => s.id);
		const shown = await ids(0);
		const next = await ids(SIZE);
		const db = new Database(dbPath, { readonly: true });
		const entry = (series: number) =>
			(
				db.prepare('SELECT id FROM entries WHERE series_id = ? LIMIT 1').get(series) as {
					id: number;
				}
			).id;
		const reads = next.reverse().map((seriesId) => ({ seriesId, entryId: entry(seriesId) }));
		db.close();
		for (const r of reads) {
			const res = await page.request.post(`${base}/api/reading`, { data: { ...r, kind: 'open' } });
			expect(res.ok()).toBe(true);
			// The writer's clock is a millisecond: each read its own place on RECENT.
			await page.waitForTimeout(5);
		}
		expect(await ids(SIZE), 'the shelf really moved: the next page is the one drawn').toEqual(
			shown
		);

		await toBottom(page);
		// Further pages may follow: a short page leaves the row near on a wide grid.
		await expect.poll(() => offsets.slice(0, 2), { timeout: 8000 }).toEqual([SIZE, SIZE * 2]);
		await expect.poll(() => page.locator('.grid .tile').count()).toBeGreaterThan(SIZE);
		expect(
			offsets.filter((o) => o === SIZE),
			'the repeated page was asked for once'
		).toHaveLength(1);
	});
});
