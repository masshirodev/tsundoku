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
 * (doc/LIBRARY.md, "The top bar" and "The band"; c433, c430), the KIND band
 * pinned under the top bar (c436), and BACK TO TOP after a resize past the
 * width that draws FILTER where it was opened (c474).
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

function setHidden(title: string, hidden: boolean): void {
	const db = new Database(dbPath);
	try {
		db.prepare(`UPDATE series SET hidden = ? WHERE title = ?`).run(hidden ? 1 : 0, title);
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
		// The counts it measures by, followed down: no hidden series, and none
		// counted with them since reveal was off (c430).
		expect(
			await page.evaluate(() =>
				JSON.parse(localStorage.getItem('tsundoku.library.links-put-away') ?? 'null')
			)
		).toEqual({ pub: 2, all: null });
		queueOneMore('Scroll Filler 02');
		await page.goto(`${BASE}/`);
		await expect(band(page)).toContainText('03 SERIES TO LINK');
	} finally {
		unqueue('Scroll Filler 01');
		unqueue('Scroll Filler 02');
	}
});

test('reveal off and on is no news: the band stays away until a series really is new (c430)', async ({
	page
}) => {
	// A hidden series in the queue: two to link with reveal off, three with it on.
	setHidden('Scroll Filler 03', true);
	queueOneMore('Scroll Filler 03');
	const reveal = async (on: boolean) => {
		if (on) await page.context().addCookies([{ name: 'tsundoku_reveal', value: '1', url: BASE }]);
		else await page.context().clearCookies({ name: 'tsundoku_reveal' });
		await page.goto(`${BASE}/`);
		await page.waitForFunction(() => document.cookie.includes('tsundoku_js=1'));
	};
	try {
		await page.goto(`${BASE}/`);
		await page.evaluate(() => localStorage.removeItem('tsundoku.library.links-put-away'));
		await reveal(true);
		await expect(band(page)).toContainText('03 SERIES TO LINK');
		// Put away with reveal on; off and on again: still away. Before c430's
		// second half, reveal off lowered the count to two and on brought three back.
		await putAway(page).click();
		await expect(band(page)).toHaveCount(0);
		await reveal(false);
		await expect(band(page)).toHaveCount(0);
		await reveal(true);
		await expect(band(page)).toHaveCount(0);

		// The other way round: put away with reveal off, then on.
		await page.evaluate(() => localStorage.removeItem('tsundoku.library.links-put-away'));
		await reveal(false);
		await expect(band(page)).toContainText('02 SERIES TO LINK');
		await putAway(page).click();
		await reveal(true);
		await expect(band(page)).toHaveCount(0);
		await reveal(false);
		await expect(band(page)).toHaveCount(0);

		// A series that really is new, and not hidden: back, either way.
		queueOneMore('Scroll Filler 04');
		await reveal(false);
		await expect(band(page)).toContainText('03 SERIES TO LINK');
		await reveal(true);
		await expect(band(page)).toContainText('04 SERIES TO LINK');

		// Putting the band away hides the band only: the links review's own door
		// (c475) still counts the queue, in the sidebar or under MORE.
		await putAway(page).click();
		await expect(band(page)).toHaveCount(0);
		const sidebarRow = page.locator('aside.sidebar').getByRole('link', { name: /^TO LINK/ });
		if (await sidebarRow.isVisible()) await expect(sidebarRow).toContainText('4');
		else {
			await page.getByRole('button', { name: 'MORE' }).click();
			await expect(
				page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: /TO LINK/ })
			).toContainText('4');
		}
	} finally {
		unqueue('Scroll Filler 03');
		unqueue('Scroll Filler 04');
		setHidden('Scroll Filler 03', false);
		await page.context().clearCookies({ name: 'tsundoku_reveal' });
	}
});

// ---- c436: the KIND band, pinned under the top bar ------------------------------------

const kinds = (page: Page) => page.getByRole('group', { name: 'Kind' });
const isDesktop = (name: string) => name === 'desktop';

test('the KIND band sits under the tabs, over the grid, 40px, and pins under the bar where the tabs go up', async ({
	page
}, info) => {
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	const box = (await kinds(page).boundingBox())!;
	expect(box.height).toBe(40);
	// Directly over the grid: nothing goes between a kind chosen and its tiles.
	const grid = (await page.locator('.grid').boundingBox())!;
	expect(Math.abs(grid.y - (box.y + box.height))).toBeLessThanOrEqual(1);
	const tabs = page.locator('.library div.tabs');
	if (isDesktop(info.project.name)) {
		// The desktop's shelves are the sidebar, and its FILTER is the top bar's.
		await expect(tabs).toBeHidden();
		await expect(kinds(page).locator('summary')).toBeHidden();
		await expect(kinds(page)).toHaveCSS('border-top-width', '1px');
	} else {
		// Directly under the shelf tabs, FILTER at the band's own right end.
		const t = (await tabs.boundingBox())!;
		expect(Math.abs(box.y - (t.y + t.height))).toBeLessThanOrEqual(1);
		const filter = (await kinds(page).locator('summary').boundingBox())!;
		expect(Math.round(filter.x + filter.width)).toBe(Math.round(box.x + box.width));
	}
	// The phone drops the KIND label for room; the rest lead with it.
	await expect(
		kinds(page).getByText('KIND', { exact: true }).filter({ visible: true })
	).toHaveCount(info.project.name === 'phone' ? 0 : 1);

	// A screen and a half down: the band is pinned under the bar, and names
	// the shelf in a first cell; the tabs went up with the page.
	await scrollScreens(page, 1.5);
	const barBottom = await bar(page).evaluate((h) => h.getBoundingClientRect().bottom);
	await expect
		.poll(() => kinds(page).evaluate((b) => b.getBoundingClientRect().top))
		.toBeCloseTo(barBottom, 0);
	const shelf = kinds(page).getByRole('button', { name: /^ALL/ });
	await expect(shelf).toBeVisible();
	await expect(kinds(page).getByText('KIND', { exact: true })).toHaveCount(0);
	if (!isDesktop(info.project.name))
		expect(await tabs.evaluate((t) => t.getBoundingClientRect().bottom)).toBeLessThan(barBottom);
	// The pinned band is drawn over the grid: what is at its middle is the band's.
	const atBand = await kinds(page).evaluate((b) => {
		const r = b.getBoundingClientRect();
		return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
	});
	expect(atBand).toBe(true);

	// Its first cell goes back to the tabs, the mark on the shelf showing.
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await shelf.click();
	await expect(shelf).toHaveCount(0);
	if (!isDesktop(info.project.name)) {
		const t = await tabs.evaluate((n) => n.getBoundingClientRect().top);
		expect(t).toBeGreaterThanOrEqual(barBottom - 1);
		await expect(tabs.locator('.tab.on')).toBeFocused();
	}
	await expect(
		kinds(page).getByText('KIND', { exact: true }).filter({ visible: true })
	).toHaveCount(info.project.name === 'phone' ? 0 : 1);
});

test('the band scrolls sideways and never wraps, keeping the chosen kind in view', async ({
	page
}) => {
	await page.setViewportSize({ width: 300, height: 700 });
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	const strip = kinds(page).locator('.kscroll');
	const cells = strip.locator('a');
	expect(await cells.count()).toBeGreaterThan(3);
	// One row, the band's own height, however many kinds.
	expect((await kinds(page).boundingBox())!.height).toBe(40);
	const tops = await cells.evaluateAll((as) =>
		as.map((a) => Math.round(a.getBoundingClientRect().top))
	);
	expect(new Set(tops).size).toBe(1);
	expect(await strip.evaluate((s) => s.scrollWidth > s.clientWidth)).toBe(true);
	// The last kind is chosen: the strip scrolls so it is in view, ALL off the left.
	const last = cells.last();
	await last.click();
	await expect(last).toHaveAttribute('aria-current', 'true');
	const s = (await strip.boundingBox())!;
	await expect
		.poll(async () => {
			const c = (await cells.last().boundingBox())!;
			return c.x >= s.x - 1 && c.x + c.width <= s.x + s.width + 1;
		})
		.toBe(true);
	expect(await strip.evaluate((n) => n.scrollLeft)).toBeGreaterThan(0);
});

// ---- c474: BACK TO TOP after a resize past FILTER's own width -----------------------

test('a FILTER left open where CSS has since hidden it does not hide BACK TO TOP', async ({
	page
}, info) => {
	// The desktop is the one project with a fine pointer, so the one where the
	// top bar's FILTER is drawn at 1024px and up and the band's below it.
	test.skip(!isDesktop(info.project.name), 'needs the desktop’s fine pointer');
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await expect(page.locator('.grid .tile').first()).toBeVisible();

	// The top bar's FILTER, open, and the window narrowed to 900px: the panel
	// is hidden with its cell, BACK TO TOP shows a screen and a half down.
	const desk = page.locator('.filter-desk details.filter');
	await desk.locator('summary').click();
	await expect(desk).toHaveAttribute('open', '');
	await page.setViewportSize({ width: 900, height: 900 });
	await expect(desk).toBeHidden();
	await scrollScreens(page, 1.5);
	await expect(toTop(page)).toBeVisible();

	// And the other way: the band's FILTER, open at 900px, then the window
	// widened past 1024px, where the band draws none.
	await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
	await page.reload();
	const inBand = kinds(page).locator('details.filter');
	await inBand.locator('summary').click();
	await expect(inBand).toHaveAttribute('open', '');
	await scrollScreens(page, 1.5);
	await expect(toTop(page)).toBeHidden();
	await page.setViewportSize({ width: 1280, height: 900 });
	await expect(inBand).toBeHidden();
	await scrollScreens(page, 1.5);
	await expect(toTop(page)).toBeVisible();
	// The FILTER drawn here, opened, still hides it, as c433 has it.
	await desk.locator('summary').click();
	await expect(desk).toHaveAttribute('open', '');
	await expect(toTop(page)).toBeHidden();
});
