import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * The library as it scrolls, and the SERIES TO LINK band put away
 * (doc/LIBRARY.md, "The top bar" and "The band"; c433, c430).
 *
 * Its own preview and its own seeded database, one per device project: the
 * band's cases add and take away a series to link, which the shared server's
 * links-flow counts, and the seed is too short to scroll a desktop a screen.
 * So the seed gets eighty filler series here. The port is the OS's to give.
 */
test.describe.configure({ mode: 'serial' });

const FILLERS = 80;
let work = '';
let dbPath = '';
let preview: ChildProcess | null = null;
let BASE = '';

function freePort(): Promise<number> {
	return new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});
}

/** The sample library, and eighty more series shaped like one of its manga. */
function seed(): void {
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			LIBRARY_ROOT: join(work, 'library'),
			NODE_NO_WARNINGS: '1'
		},
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const like = db.prepare(`SELECT id FROM series WHERE title = 'Isekai Ojisan'`).get() as {
			id: number;
		};
		const add = db.prepare(
			`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
			SELECT root_id, ?, kind, source, hue, added_at, indexed_at, ?, 1, '' FROM series WHERE id = ?`
		);
		for (let i = 1; i <= FILLERS; i++)
			add.run(`Scroll Filler ${String(i).padStart(2, '0')}`, `filler:${i}`, like.id);
	} finally {
		db.close();
	}
}

/** One more series in the review queue: searched, nothing found, as the cover pass writes it. */
function queueOneMore(title: string): void {
	const db = new Database(dbPath);
	try {
		db.prepare(
			`INSERT INTO link_searches (series_id, query, searched_at, found)
			SELECT id, title, ?, 0 FROM series WHERE title = ?`
		).run(Date.now(), title);
	} finally {
		db.close();
	}
}

function unqueue(title: string): void {
	const db = new Database(dbPath);
	try {
		db.prepare(
			`DELETE FROM link_searches WHERE series_id = (SELECT id FROM series WHERE title = ?)`
		).run(title);
	} finally {
		db.close();
	}
}

test.beforeAll(async () => {
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-top-'));
	dbPath = join(work, 'library.sqlite');
	seed();
	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
			TSUNDOKU_HOME: join(work, 'home'),
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
	throw new Error('the library preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	if (work) rmSync(work, { recursive: true, force: true });
});

const bar = (page: Page) => page.locator('.library > header.bar');
const toTop = (page: Page) => page.getByRole('button', { name: 'BACK TO TOP ↑' });
const windowY = (page: Page) => page.evaluate(() => window.scrollY);

/** Down the grid by a share of the screen, as a wheel or a finger would take it. */
async function scrollScreens(page: Page, screens: number) {
	await page.evaluate((s) => scrollTo({ top: innerHeight * s, behavior: 'instant' }), screens);
	await expect.poll(() => windowY(page)).toBeGreaterThan(0);
}

// ---- c433: the top bar stays, and BACK TO TOP -----------------------------------------

test('the top bar stays at the top while the grid scrolls, and BACK TO TOP takes the page back', async ({
	page
}) => {
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await expect(page.locator('.grid .tile', { hasText: 'Scroll Filler 01' })).toBeVisible();
	// Tall enough to scroll more than a screen on every device.
	const room = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
	expect(room).toBeGreaterThan(await page.evaluate(() => innerHeight * 1.5));

	// At the top and half a screen down, no BACK TO TOP.
	await expect(toTop(page)).toHaveCount(0);
	await scrollScreens(page, 0.5);
	await expect(toTop(page)).toHaveCount(0);

	// A screen and a half down: the bar is still at the top, and drawn over the grid.
	await scrollScreens(page, 1.5);
	const top = await bar(page).evaluate((h) => h.getBoundingClientRect().top);
	expect(Math.abs(top)).toBeLessThan(0.5);
	const atBar = await bar(page).evaluate((h) => {
		const r = h.getBoundingClientRect();
		return h.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
	});
	expect(atBar).toBe(true);
	await expect(bar(page).getByRole('button', { name: 'SELECT' })).toBeVisible();

	// BACK TO TOP: a corner cell, ruled on its inner sides, at the screen's corner.
	await expect(toTop(page)).toBeVisible();
	const cell = (await toTop(page).boundingBox())!;
	const view = page.viewportSize()!;
	expect(Math.round(cell.x + cell.width)).toBe(view.width);
	expect(Math.round(cell.y + cell.height)).toBe(view.height);
	await expect(toTop(page)).toHaveCSS('border-top-width', '1px');
	await expect(toTop(page)).toHaveCSS('border-left-width', '1px');
	await expect(toTop(page)).toHaveCSS('border-radius', '0px');

	await toTop(page).click();
	await expect.poll(() => windowY(page)).toBe(0);
	await expect(toTop(page)).toHaveCount(0);
	// Focus went up to the bar with the page, not down to the body with the cell.
	expect(await bar(page).evaluate((h) => h.contains(document.activeElement))).toBe(true);
});

test('BACK TO TOP scrolls there, and under reduced motion jumps', async ({ page }) => {
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await scrollScreens(page, 1.5);
	const from = await windowY(page);
	await toTop(page).click();
	// Smooth: on its way, not there yet, the moment after the tap.
	const moving = await windowY(page);
	expect(moving).toBeGreaterThan(0);
	expect(moving).toBeLessThanOrEqual(from);
	await expect.poll(() => windowY(page)).toBe(0);

	await page.emulateMedia({ reducedMotion: 'reduce' });
	await scrollScreens(page, 1.5);
	await toTop(page).click();
	expect(await windowY(page)).toBe(0);
});

test('no BACK TO TOP while selecting: the bulk bar has that corner', async ({ page }) => {
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await scrollScreens(page, 1.5);
	await expect(toTop(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'SELECT' }).click();
	await expect(toTop(page)).toHaveCount(0);
	// The selection bar is pinned the same way.
	const top = await page
		.locator('.library > header.bar')
		.evaluate((h) => h.getBoundingClientRect().top);
	expect(Math.abs(top)).toBeLessThan(0.5);
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await expect(toTop(page)).toBeVisible();
});

test('no BACK TO TOP while SORT’s list or FILTER’s panel is open over the grid', async ({
	page
}) => {
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await scrollScreens(page, 1.5);
	await expect(toTop(page)).toBeVisible();

	// SORT's list: opening it brings its cell into view, so the page goes on
	// down with the list still open, and the cell stays off the dimmed screen.
	const menu = page.getByRole('menu', { name: 'Sort' });
	await page.getByRole('button', { name: 'Sort, TITLE' }).click();
	await expect(menu).toBeVisible();
	await scrollScreens(page, 1.5);
	await expect(menu).toBeVisible();
	await expect(toTop(page)).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	// BACK gives focus back to the cell, which brings it into view again.
	await scrollScreens(page, 1.5);
	await expect(toTop(page)).toBeVisible();

	// FILTER's panel, whichever of the two this device draws (the desktop's
	// is in the pinned bar, where the reviewer saw the cell lit over it).
	const filter = page.locator('details.filter:visible').first();
	await filter.locator('summary').click();
	await expect(filter).toHaveAttribute('open', '');
	await scrollScreens(page, 1.5);
	await expect(filter).toHaveAttribute('open', '');
	await expect(toTop(page)).toBeHidden();
	await filter.locator('summary').click();
	await expect(filter).not.toHaveAttribute('open', '');
	await scrollScreens(page, 1.5);
	await expect(toTop(page)).toBeVisible();
});

// ---- c430: the SERIES TO LINK band put away -------------------------------------------

const band = (page: Page) => page.locator('.band', { hasText: 'SERIES TO LINK' });
const putAway = (page: Page) =>
	page.getByRole('button', { name: 'Put away the series to link until the count grows' });

test('✕ puts the band away; it stays away on reload, and a new series to link brings it back', async ({
	page
}) => {
	await page.goto(`${BASE}/`);
	await expect(band(page)).toContainText('02 SERIES TO LINK');
	// A plain cell after REVIEW, not a second accent action.
	const review = await page
		.getByRole('link', { name: 'Review the series to link' })
		.evaluate((n) => getComputedStyle(n).backgroundColor);
	await expect(putAway(page)).not.toHaveCSS('background-color', review);
	await expect(putAway(page)).toHaveCSS('border-left-width', '1px');
	// One block at the band's end, REVIEW then ✕: the band's own space-between
	// spread them apart once, REVIEW stranded mid-band.
	const r = (await page.getByRole('link', { name: 'Review the series to link' }).boundingBox())!;
	const x = (await putAway(page).boundingBox())!;
	const b = (await band(page).boundingBox())!;
	expect(Math.abs(x.x - (r.x + r.width))).toBeLessThanOrEqual(1);
	expect(Math.abs(x.x + x.width - (b.x + b.width))).toBeLessThanOrEqual(1);

	await putAway(page).click();
	await expect(band(page)).toHaveCount(0);
	await page.reload();
	await page.waitForFunction(() => document.cookie.includes('tsundoku_js=1'));
	await expect(band(page)).toHaveCount(0);

	// The same two again: still away.
	await page.goto(`${BASE}/?shelf=all`);
	await expect(band(page)).toHaveCount(0);

	// One more to link, as the cover pass finds one: back, counting three.
	queueOneMore('Scroll Filler 01');
	try {
		await page.goto(`${BASE}/`);
		await expect(band(page)).toContainText('03 SERIES TO LINK');

		// Another device (a fresh browser) never put it away.
		const other = await page.context().browser()!.newContext();
		try {
			const fresh = await other.newPage();
			await other.addCookies(await page.context().cookies());
			await fresh.goto(`${BASE}/`);
			await expect(band(fresh)).toContainText('03 SERIES TO LINK');
		} finally {
			await other.close();
		}

		// Put away at three, then one reviewed (two): the next new one is news again.
		await putAway(page).click();
		await expect(band(page)).toHaveCount(0);
		unqueue('Scroll Filler 01');
		await page.goto(`${BASE}/`);
		await page.waitForFunction(() => document.cookie.includes('tsundoku_js=1'));
		await expect(band(page)).toHaveCount(0);
		expect(await page.evaluate(() => localStorage.getItem('tsundoku.library.links-put-away'))).toBe(
			'2'
		);
		queueOneMore('Scroll Filler 02');
		await page.goto(`${BASE}/`);
		await expect(band(page)).toContainText('03 SERIES TO LINK');
	} finally {
		unqueue('Scroll Filler 01');
		unqueue('Scroll Filler 02');
	}
});
