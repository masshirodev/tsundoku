import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type Locator, type Page } from '@playwright/test';
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
const TALL_SHELF = 'Filler Pile';
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
		// Rated, so a rating chosen in FILTER leaves a list as tall as the
		// fillers (c557's landing needs the room to put the band under the bar).
		db.prepare(`UPDATE series SET rating = 8 WHERE origin_key LIKE 'filler:%'`).run();
		// A shelf as tall as the fillers (c589): picking it mid-grid from ALL
		// would land partway down it if a shelf kept the scroll.
		const shelf = db
			.prepare(`INSERT INTO collections (name, position) VALUES (?, 99)`)
			.run(TALL_SHELF).lastInsertRowid;
		db.prepare(
			`INSERT INTO collection_series (collection_id, series_id)
			SELECT ?, id FROM series WHERE origin_key LIKE 'filler:%'`
		).run(shelf);
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
	// Eight loads, each waited to hydration: past the default 30 s on the phone
	// in a loaded run (the final run of wave 22, beside 40 other files).
	test.setTimeout(90_000);
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

/**
 * Landed at the band's own place (c436's round 2, c557): the grid's first
 * tile directly under the band, the band's top on the held bar's bottom
 * (±1px), and the band no longer pinned.
 */
async function landedAtBand(page: Page, what = 'landed') {
	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const band = document.querySelector('.kinds')!.getBoundingClientRect();
					const tile = document.querySelector('.grid .tile')!.getBoundingClientRect();
					const bar = document.querySelector('.library > header.bar')!.getBoundingClientRect();
					return {
						tileUnderBand: Math.abs(tile.top - band.bottom) <= 1,
						bandUnderBar: Math.abs(band.top - bar.bottom) <= 1,
						pinned: document.querySelector('.kinds')!.classList.contains('pinned')
					};
				}),
			{ message: what }
		)
		.toEqual({ tileUnderBand: true, bandUnderBar: true, pinned: false });
}

test('a kind chosen from the pinned band opens at its start: the band under the bar, its first row under the band', async ({
	page
}) => {
	const firstTile = (p: Page) => p.locator('.grid .tile').first();
	const firstTitle = (p: Page) => p.locator('.grid .tile .title').first().textContent();
	/**
	 * The grid's first tile directly under the band, the band directly under
	 * the held bar, and no longer pinned: the band's own place (c557 tightened
	 * it; a tile under a band still pinned mid-list also met the first half).
	 */
	async function landedUnderBand() {
		await landedAtBand(page);
	}
	/** What a fresh load of the kind shows first. */
	async function freshFirst(kind: string | null): Promise<string | null> {
		const other = await page.context().newPage();
		await other.goto(`${BASE}/?shelf=all&sort=title${kind ? `&kind=${kind}` : ''}`);
		await expect(other.locator('.grid .tile').first()).toBeVisible();
		const t = await firstTitle(other);
		await other.close();
		return t;
	}

	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await expect(firstTile(page)).toBeVisible();
	// Another kind, taken from the band so the seed has it.
	const other = kinds(page).locator('.kscroll a:not([aria-current])').first();
	const kind = new URL((await other.getAttribute('href'))!, BASE).searchParams.get('kind')!;
	// Held by its id: once chosen it is no longer the first unchosen cell.
	const cell = kinds(page).locator(`a[data-focus-id="kind-${kind}"]`);
	const want = await freshFirst(kind);

	await scrollScreens(page, 1.5);
	const shelf = kinds(page).getByRole('button', { name: /^ALL/ });
	await expect(shelf).toBeVisible();
	await cell.click();
	// The test's budget, not expect's 5 s: the URL moves once the data is in,
	// which ran out at a load of 54 (doc/TESTING.md, "Load").
	await page.waitForURL(new RegExp(`kind=${kind}`));
	await expect(cell).toHaveAttribute('aria-current', 'true');
	await landedUnderBand();
	expect(await firstTitle(page)).toBe(want);

	// ALL, from the band pinned again: the same.
	const wantAll = await freshFirst(null);
	await scrollScreens(page, 1.5);
	await expect(shelf).toBeVisible();
	const all = kinds(page).locator('.kscroll a').first();
	await all.click();
	await page.waitForURL((u) => !u.searchParams.has('kind'));
	await expect(all).toHaveAttribute('aria-current', 'true');
	await landedUnderBand();
	expect(await firstTitle(page)).toBe(wantAll);
});

// ---- c557: a FILTER choice from the pinned band lands at the grid's start ----------

test('a FILTER choice from the pinned band opens the new results at their start; one already on, or made at the top, moves nothing (c557)', async ({
	page
}, info) => {
	const firstTitle = (p: Page) => p.locator('.grid .tile .title').first().textContent();
	// The desktop's FILTER is the top bar's, pinned with it; the others' the band's last cell.
	const filter = page.locator(isDesktop(info.project.name) ? '.filter-desk' : '.kfilter');
	const panel = filter.getByRole('group', { name: 'Filters' });
	const form = (choice: string) =>
		panel.locator('.row', { hasText: 'FORM' }).getByRole('link', { name: choice, exact: true });
	async function open() {
		if (!(await panel.isVisible())) await filter.locator('summary').click();
		await expect(panel).toBeVisible();
	}
	/** What a fresh load shows first. */
	async function freshFirst(query: string): Promise<string | null> {
		const other = await page.context().newPage();
		await other.goto(`${BASE}/?shelf=all&sort=title${query}`);
		await expect(other.locator('.grid .tile').first()).toBeVisible();
		const t = await firstTitle(other);
		await other.close();
		return t;
	}
	const want = await freshFirst('&form=series');

	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	await scrollScreens(page, 1.5);
	await expect(kinds(page)).toHaveClass(/pinned/);
	await open();
	await form('SERIES').click();
	// A client-side navigation: the URL moves once the data is in, so the
	// test's budget, not expect's 5 s (doc/TESTING.md, "Load").
	await page.waitForURL(/form=series/);
	await landedAtBand(page, 'FORM: SERIES');
	expect(await firstTitle(page)).toBe(want);
	// The panel stays open on the choice, over the grid; DONE shows the first row.
	await panel.getByRole('button', { name: 'DONE' }).click();
	await expect(panel).toBeHidden();
	await expect(page.locator('.grid .tile').first()).toBeInViewport();

	// The one already on, from the pinned band again: nothing changes, so
	// nothing moves.
	await scrollScreens(page, 1.5);
	await expect(kinds(page)).toHaveClass(/pinned/);
	await open();
	const at = await windowY(page);
	await form('SERIES').click();
	await expect(form('SERIES')).toHaveAttribute('aria-current', 'true');
	await page.waitForTimeout(600); // nothing is to happen: a while for it not to
	expect(await windowY(page)).toBe(at);
	await expect(page).toHaveURL(/form=series/);

	// The rating blocks, the panel's other way to choose (their own links,
	// which scroll to the top): lands the same.
	const blocks = panel.locator('.blocks');
	await blocks.getByRole('link', { name: 'At least 3+' }).click();
	await page.waitForURL(/min=6/);
	await landedAtBand(page, 'the rating blocks');
	await panel.getByRole('button', { name: 'DONE' }).click();

	// At the top, the band where it lies: a choice moves nothing. (FILTER's
	// panel brings itself into view as it opens, so the place is read after.)
	await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
	await expect(kinds(page)).not.toHaveClass(/pinned/);
	await open();
	// It scrolls itself in a moment after it shows, by how much each device
	// needs: the place is the one it comes to rest at.
	await expect
		.poll(async () => {
			const before = await windowY(page);
			await page.waitForTimeout(150);
			return before === (await windowY(page));
		})
		.toBe(true);
	const top = await windowY(page);
	await expect(kinds(page)).not.toHaveClass(/pinned/);
	await form('ANY').click();
	await page.waitForURL((u) => !u.searchParams.has('form'));
	await page.waitForTimeout(600); // nothing is to happen: a while for it not to
	expect(await windowY(page)).toBe(top);
});

test('DONE tapped while a FILTER choice from the pinned band loads still lands at the new results', async ({
	page
}, info) => {
	const filter = page.locator(isDesktop(info.project.name) ? '.filter-desk' : '.kfilter');
	const panel = filter.getByRole('group', { name: 'Filters' });
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	await scrollScreens(page, 1.5);
	await expect(kinds(page)).toHaveClass(/pinned/);
	await filter.locator('summary').click();
	await expect(panel).toBeVisible();
	// A slow load: the press lands after the choice and before the new page.
	await page.route('**/__data.json*', async (r) => {
		await new Promise((done) => setTimeout(done, 1500));
		await r.continue();
	});
	await panel
		.locator('.row', { hasText: 'FORM' })
		.getByRole('link', { name: 'SERIES', exact: true })
		.click();
	await panel.getByRole('button', { name: 'DONE' }).click();
	await page.waitForURL(/form=series/);
	await page.unroute('**/__data.json*');
	await landedAtBand(page, 'FORM: SERIES');
});

test('a press on the rating blocks that chooses nothing leaves no note: a kind chosen later at the top moves nothing (c557, round 2)', async ({
	page
}, info) => {
	const filter = page.locator(isDesktop(info.project.name) ? '.filter-desk' : '.kfilter');
	const panel = filter.getByRole('group', { name: 'Filters' });
	const blocks = panel.locator('.blocks');
	const block = blocks.getByRole('link', { name: 'At least 3+' });

	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	const url = page.url();
	await scrollScreens(page, 1.5);
	await expect(kinds(page)).toHaveClass(/pinned/);
	await filter.locator('summary').click();
	await expect(panel).toBeVisible();

	// Three presses on the blocks, none of which RatingSlider acts on: a
	// right-click (its drag takes the main button only), a key a desktop or
	// a tablet does not move them with (← moves them on a TV only), and a
	// drag the browser cancels, which commits nothing.
	await block.click({ button: 'right' });
	await page.keyboard.press('Escape');
	// Escape may have shut the panel: open again for the next two.
	if (!(await panel.isVisible())) await filter.locator('summary').click();
	await expect(panel).toBeVisible();
	await block.focus();
	await page.keyboard.press('ArrowLeft');
	const track = blocks.locator('.track');
	const box = (await block.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await track.dispatchEvent('pointercancel');
	await page.mouse.up();
	// None of them went anywhere.
	await page.waitForTimeout(600); // nothing is to happen: a while for it not to
	expect(page.url()).toBe(url);

	// Closed, and back at the top: the band lies where it is, unpinned.
	if (await panel.isVisible()) await panel.getByRole('button', { name: 'DONE' }).click();
	await expect(panel).toBeHidden();
	await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
	await expect(kinds(page)).not.toHaveClass(/pinned/);
	expect(await windowY(page)).toBe(0);

	// A kind from the unpinned band: its cells keep the scroll, and no FILTER
	// note left by the blocks may land it at the band (c436: unpinned,
	// nothing moves).
	const cell = kinds(page).locator('.kscroll a:not([aria-current])').first();
	const kind = new URL((await cell.getAttribute('href'))!, BASE).searchParams.get('kind')!;
	const chosen = kinds(page).locator(`a[data-focus-id="kind-${kind}"]`);
	await chosen.click();
	await page.waitForURL(new RegExp(`kind=${kind}`));
	await expect(chosen).toHaveAttribute('aria-current', 'true');
	await page.waitForTimeout(600); // nothing is to happen: a while for it not to
	expect(await windowY(page)).toBe(0);
});

// ---- c590: an open menu over the KIND band ------------------------------------------

const sortCell = (page: Page) => page.getByRole('button', { name: /^Sort, / });
const sortMenu = (page: Page) => page.getByRole('menu', { name: 'Sort' });

/**
 * Each element's centre, and what the page draws there: `top` when the
 * element itself (or something inside it) is, else what covers it. Read in
 * the page, so all of them are read in one frame.
 */
const whatIsAt = (els: Locator) =>
	els.evaluateAll((all) =>
		all.map((el) => {
			const r = el.getBoundingClientRect();
			const x = r.left + r.width / 2;
			const y = r.top + r.height / 2;
			const hit = document.elementFromPoint(x, y);
			const bar = document.querySelector('.library > header.bar')!.getBoundingClientRect();
			const band = document.querySelector('.kinds')!.getBoundingClientRect();
			return {
				label: el.textContent?.trim() ?? '',
				y,
				onScreen: y > 0 && y < innerHeight && x > 0 && x < innerWidth,
				underBar: y < bar.bottom,
				overBand: y > band.top && y < band.bottom,
				top: !!hit && el.contains(hit),
				inBar: !!hit && !!hit.closest('.library > header.bar'),
				hit: hit ? `${hit.tagName}.${hit.className}` : 'nothing'
			};
		})
	);

test('an open SORT list is over the KIND band, at the top and pinned, under the top bar, and the band is back over the grid once it closes (c590)', async ({
	page
}) => {
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	const zClosed = await kinds(page).evaluate((b) => getComputedStyle(b).zIndex);

	// At the top: the list hangs from SORT over the tabs and the band, and
	// every choice is what is drawn at its centre (the owner's screenshot:
	// the band's strip cut the list under RECENTLY READ).
	await sortCell(page).click();
	await expect(sortMenu(page)).toBeVisible();
	const choices = sortMenu(page).getByRole('menuitemradio');
	await expect(choices).toHaveCount(6);
	const atTop = await whatIsAt(choices);
	// The state reached: some choice lies over the band.
	expect(atTop.some((c) => c.overBand)).toBe(true);
	for (const c of atTop) expect(c, `${c.label} at the top`).toMatchObject({ top: true });

	// Scrolled with it open until the band pins under the bar, and a
	// choice's height (52px) on, so the list's head is under the bar on every
	// device (the desktop has no tabs between SORT and the band): what is
	// still under the bar's foot is the list's, and what went up is under
	// the bar (a sheet from the bar, at 20, is over both).
	const pinAt = await page.evaluate(() => {
		const mark = document.querySelector('.band-mark')!.getBoundingClientRect().top;
		const bar = document.querySelector('.library > header.bar')!.getBoundingClientRect();
		return scrollY + mark - bar.bottom + 52;
	});
	await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), pinAt);
	await expect(kinds(page)).toHaveClass(/pinned/);
	await expect(sortMenu(page)).toBeVisible();
	const pinned = (await whatIsAt(choices)).filter((c) => c.onScreen);
	expect(pinned.some((c) => c.overBand)).toBe(true);
	expect(pinned.some((c) => c.underBar)).toBe(true);
	for (const c of pinned)
		expect(c, `${c.label} pinned`).toMatchObject(c.underBar ? { inBar: true } : { top: true });
	// BACK TO TOP stays out of the way while it is open (c433).
	await expect(toTop(page)).toHaveCount(0);

	// Closed: the band is at its own layer again, over the grid it is pinned on.
	await page.keyboard.press('Escape');
	await expect(sortMenu(page)).toBeHidden();
	expect(await kinds(page).evaluate((b) => getComputedStyle(b).zIndex)).toBe(zClosed);
	const atBand = await kinds(page).evaluate((b) => {
		const r = b.getBoundingClientRect();
		return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
	});
	expect(atBand).toBe(true);
});

test('FILTER’s open panel is over the KIND band and the grid, at the top and pinned (c590)', async ({
	page
}, info) => {
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	// The desktop's FILTER is the top bar's; the others' is the band's last cell.
	const filter = page.locator(isDesktop(info.project.name) ? '.filter-desk' : '.kfilter');
	const panel = filter.getByRole('group', { name: 'Filters' });
	const parts = panel.locator('.head, .opt, .done');

	for (const where of ['top', 'pinned'] as const) {
		if (where === 'pinned') {
			await scrollScreens(page, 1.5);
			await expect(kinds(page)).toHaveClass(/pinned/);
		}
		await filter.locator('summary').click();
		await expect(panel).toBeVisible();
		const seen = (await whatIsAt(parts)).filter((c) => c.onScreen && !c.underBar);
		expect(seen.length).toBeGreaterThan(3);
		for (const c of seen) expect(c, `${c.label} (${where})`).toMatchObject({ top: true });
		await panel.getByRole('button', { name: 'DONE' }).click();
		await expect(panel).toBeHidden();
	}
});

// ---- c589: a shelf opens at its top -------------------------------------------------

test.describe('a shelf from the tabs or the sidebar (c589)', () => {
	// The service worker answers `__data.json` itself once it controls the
	// page, past page.route (doc/TESTING.md, "Load").
	test.use({ serviceWorkers: 'block' });

	test('a shelf picked mid-grid opens at its top, the one showing too, and BACK finds the old place (c589)', async ({
		page
	}, info) => {
		const desktop = isDesktop(info.project.name);
		// The desktop's shelves are the sidebar, in sight all the way down; the
		// others' are the tabs over the band, which don't pin: mid-grid they are
		// reached by the pinned band's first cell, which brings them under the bar.
		const shelves = desktop
			? page.locator('aside.sidebar').getByRole('navigation', { name: 'Shelves' })
			: page.locator('.library .tabs').getByRole('navigation', { name: 'Shelves' });
		const tab = (name: RegExp) => shelves.getByRole('link', { name });
		const tall = tab(new RegExp(`^${TALL_SHELF.toUpperCase()}`));
		/** 1.5 screens down, then (where the shelves are tabs) up to them by `ALL ▴`. */
		async function downTheGrid() {
			await scrollScreens(page, 1.5);
			if (desktop) return;
			await kinds(page).getByRole('button', { name: /^ALL/ }).click();
			await expect(tab(/^ALL/)).toBeFocused();
			// The tabs under the bar, the page still well off its top.
			await expect
				.poll(async () => {
					const under = await bar(page).evaluate((h) => h.getBoundingClientRect().bottom);
					const t = await shelves.evaluate((n) => n.getBoundingClientRect().top);
					return Math.abs(t - under);
				})
				.toBeLessThanOrEqual(2);
		}
		// The jumps are instant this way; SvelteKit's own scroll is a jump either way.
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto(`${BASE}/?shelf=all&sort=title`);
		await expect(page.locator('.grid .tile').first()).toBeVisible();

		// Another shelf, from down the grid, its data held 2.5 s: the grid is in
		// outline from 1 s, as a loaded box drew it, and SvelteKit reads the place
		// to come back to only after the data is in.
		await downTheGrid();
		const leftAt = await windowY(page);
		expect(leftAt).toBeGreaterThan(50);
		await page.route('**/__data.json?*shelf=c*', async (route) => {
			await new Promise((r) => setTimeout(r, 2500));
			await route.continue().catch(() => undefined);
		});
		await tall.click();
		await expect(page.getByText('LOADING', { exact: true })).toBeVisible();
		await expect(page).toHaveURL(/shelf=c%3A|shelf=c:/);
		await expect(page.locator('.grid .tile').first()).toContainText('Scroll Filler');
		await expect.poll(() => windowY(page)).toBe(0);
		// Tall enough that a kept scroll would have shown: the case is reached.
		expect(
			await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
		).toBeGreaterThan(leftAt);
		// Focus stays on the shelf picked (keepfocus).
		await expect(tall).toBeFocused();

		// BACK: ALL, where it was left.
		await page.goBack();
		await expect(page).not.toHaveURL(/shelf=c/);
		await expect.poll(async () => Math.abs((await windowY(page)) - leftAt)).toBeLessThanOrEqual(2);

		// The shelf already showing goes to the top too, and stays on its URL.
		const url = page.url();
		await downTheGrid();
		expect(await windowY(page)).toBeGreaterThan(50);
		await tab(/^ALL/).click();
		await expect.poll(() => windowY(page)).toBe(0);
		expect(page.url()).toBe(url);
		await expect(tab(/^ALL/)).toBeFocused();
	});
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
	// The last kind chosen, on a fresh load (a click would have Playwright
	// scroll it into view itself): the strip scrolls so it is in view, ALL off
	// the left.
	const last = cells.last();
	const kind = new URL((await last.getAttribute('href'))!, BASE).searchParams.get('kind');
	await page.goto(`${BASE}/?shelf=all&sort=title&kind=${kind}`);
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
