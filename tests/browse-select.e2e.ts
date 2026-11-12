import Database from 'better-sqlite3';
import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	PAPER,
	SECOND,
	TITLES,
	resultId,
	startSelectWorld,
	type SelectWorld
} from './helpers/select-world';

/**
 * SELECT in a source's catalog (card c868; doc/BROWSE.md, "SELECT in a
 * catalog"), walked end to end on a tablet, a phone and a desktop: SELECT
 * starting and ending (✕, Escape, a reload, leaving the browse world), what
 * a tap ticks and what can't be ticked, the selection outliving LATEST, a
 * search, MORE, a tag's arrival, another source and BROWSE, SHOW, the bulk
 * bar's line, a press (each kind), its band and result, a stale tick
 * skipped, a refusal NOT ADDED with RETRY, PUT ON A SHELF, and one UNDO for
 * the press. In the `browse` project, on a world of its own
 * (tests/helpers/select-world.ts), since a press adds series and queues
 * chapters.
 */

let world: SelectWorld;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
	world = await startSelectWorld('select');
});
test.afterAll(async () => {
	await world?.stop();
});

const url = (path: string) => `${world.base}${path}`;
const bar = (page: Page) => page.getByRole('banner', { name: 'Selection' });
const bulk = (page: Page) => page.getByRole('toolbar', { name: 'Add the selection' });
const band = (page: Page) => page.getByRole('status', { name: 'The press' });
const tile = (page: Page, title: string) =>
	page.locator('.grid .tile', { has: page.locator('.t', { hasText: title }) });
const tick = (page: Page, title: string) =>
	page.getByRole('button', { name: new RegExp(`^${title}`) }).and(page.locator('.grid .tile'));

/** The library's rows a press touched, read from the world's own database. */
function read<T>(sql: string, ...args: unknown[]): T {
	const db = new Database(world.db, { readonly: true });
	try {
		return db.prepare(sql).get(...args) as T;
	} finally {
		db.close();
	}
}
const inLibrary = (source: string, path: string) =>
	read<{ n: number }>(
		`SELECT COUNT(*) AS n FROM series WHERE origin_key = ? AND in_library = 1`,
		`mihon:${source}:${path}`
	).n;

/** Every series of the world a press added, taken out again, so each case starts from the seed. */
async function undoEverything(page: Page) {
	const db = new Database(world.db);
	try {
		db.prepare(
			`DELETE FROM series WHERE origin_key LIKE 'mihon:${PAPER.id}:%' AND origin_key != ?`
		).run(`mihon:${PAPER.id}:/a/1`);
		db.prepare(
			`DELETE FROM series WHERE origin_key LIKE 'mihon:${SECOND.id}:%' AND origin_key != ?`
		).run(`mihon:${SECOND.id}:/b/twin`);
	} finally {
		db.close();
	}
	await page.request.get(url('/browse'));
}

/** A touch device's settings, without the browser type a describe cannot change. */
function touch(name: string) {
	const device: Partial<(typeof devices)[string]> = { ...devices[name] };
	delete device.defaultBrowserType;
	return device;
}

/** The browser's back until it lands on `to`: a client-side way back, so the selection rides along. */
async function backTo(page: Page, to: string) {
	for (let i = 0; i < 10 && page.url() !== to; i++) await page.goBack();
	await expect(page).toHaveURL(to);
}

test.afterEach(async ({ page }) => {
	await undoEverything(page);
});

test.describe('on a tablet', () => {
	test('SELECT starts in the bar, ticks what a press could add, and ends on ✕ and Escape', async ({
		page
	}) => {
		await page.goto(url(`/browse/${PAPER.id}`));
		await expect(page.getByRole('link', { name: 'SETTINGS' })).toBeVisible();
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await expect(bar(page)).toContainText('0 SELECTED');
		// SETTINGS goes while selecting, and the source's name heads the tab row.
		await expect(page.getByRole('link', { name: 'SETTINGS' })).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'Lists' })).toContainText(
			'IN PAPER MOON · MANGA · EN'
		);
		await expect(bulk(page)).toContainText('A TAP ON A TILE TICKS IT');
		// IN LIBRARY: dimmed, no box, no tap.
		const mine = tile(page, TITLES['/a/1']);
		await expect(mine).toHaveCSS('opacity', '0.4');
		await expect(mine.locator('.check')).toHaveCount(0);
		await expect(mine).not.toHaveAttribute('aria-pressed');
		// SAME TITLE is tickable, and counted.
		await tick(page, TITLES['/a/2']).click();
		await tick(page, TITLES['/a/3']).click();
		await expect(tick(page, TITLES['/a/3'])).toHaveAttribute('aria-pressed', 'true');
		// The ticked cover carries the select ring; a tap opened nothing.
		await expect(tile(page, TITLES['/a/3']).locator('.cover')).toHaveClass(/ring/);
		// The list scrolls on by itself (`?pages=`), and stays the source's page.
		await expect(page).toHaveURL(new RegExp(`/browse/${PAPER.id}(\\?pages=\\d+)?$`));
		await expect(bar(page)).toContainText('2 SELECTED');
		await expect(bulk(page)).toContainText('2 TO ADD · 1 HAS A TWIN IN LIBRARY');
		await expect(bulk(page)).toContainText('PAPER MOON');
		await expect(bulk(page)).toContainText('UP TO 20 CHAPTERS');
		// A second tap unticks.
		await tick(page, TITLES['/a/3']).click();
		await expect(bar(page)).toContainText('1 SELECTED');
		await page.getByRole('button', { name: 'Stop selecting' }).click();
		await expect(bar(page)).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'SETTINGS' })).toBeVisible();
		// The next SELECT starts with nothing ticked; Escape ends it.
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await expect(bar(page)).toContainText('0 SELECTED');
		await page.keyboard.press('Escape');
		await expect(bar(page)).toHaveCount(0);
	});

	test('the selection outlives LATEST, MORE, a search, another source and BROWSE; SHOW lists it', async ({
		page
	}) => {
		await page.goto(url('/browse'));
		await page
			.getByRole('link', { name: /Paper Moon/ })
			.first()
			.click();
		await expect(page).toHaveURL(url(`/browse/${PAPER.id}`));
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await tick(page, TITLES['/a/3']).click();
		await page.getByRole('link', { name: 'LATEST' }).click();
		await expect(page).toHaveURL(/tab=latest/);
		await tick(page, TITLES['/a/l1']).click();
		await expect(bar(page)).toContainText('2 SELECTED');
		await expect(bulk(page)).toContainText('2 TO ADD · 1 OF THEM TICKED IN POPULAR');
		// The source's search, through the bar's own way to it.
		await page.getByRole('link', { name: 'Search Paper Moon to tick' }).click();
		const field = page.getByRole('searchbox', { name: 'Search Paper Moon' });
		await field.fill('solo');
		await field.press('Enter');
		await expect(page).toHaveURL(/q=solo/);
		await tick(page, TITLES['/a/s1']).click();
		await expect(bar(page)).toContainText('3 SELECTED');
		// Back to POPULAR and on to its second page: still held.
		await page.getByRole('link', { name: 'POPULAR' }).click();
		await expect(tick(page, TITLES['/a/3'])).toHaveAttribute('aria-pressed', 'true');
		// The second page comes as the end nears (MORE), and adds to the ticks.
		await tick(page, TITLES['/a/p2-1']).click();
		await expect(bar(page)).toContainText('4 SELECTED');
		// BROWSE, by the browser's back (the selecting bar has no ←): the bar
		// stays inverse and the row says how many are ticked.
		await backTo(page, url('/browse'));
		await expect(bar(page)).toContainText('4 SELECTED');
		await expect(page.getByRole('link', { name: /Paper Moon/ }).first()).toContainText('4 TICKED');
		// Another source opens still selecting.
		await page
			.getByRole('link', { name: /Second Shelf/ })
			.first()
			.click();
		await expect(bar(page)).toContainText('4 SELECTED');
		await tick(page, TITLES['/b/1']).click();
		await expect(bar(page)).toContainText('5 SELECTED · 2 SOURCES');
		await expect(bulk(page)).toContainText('PAPER MOON 4 · SECOND SHELF 1');
		// SHOW: by source, in tick order, where each was ticked.
		await bar(page).getByRole('button', { name: 'SHOW' }).click();
		const sheet = page.getByRole('dialog', { name: 'The selection' });
		await expect(sheet).toContainText('SELECTED · 5 · 2 SOURCES · IN THE ORDER TICKED');
		await expect(sheet).toContainText('PAPER MOON · 4');
		await expect(sheet).toContainText('4 NOT IN THE LIST YOU ARE ON');
		await expect(sheet).toContainText('MANGA · TICKED IN LATEST');
		await expect(sheet).toContainText('MANGA · TICKED IN SEARCH "solo"');
		const rows = sheet.locator('.rw b');
		await expect(rows).toHaveText([
			TITLES['/a/3'],
			TITLES['/a/l1'],
			TITLES['/a/s1'],
			TITLES['/a/p2-1'],
			TITLES['/b/1']
		]);
		// Untick in the sheet: the row stays, says so, and a tap puts it back.
		await sheet.getByRole('checkbox', { name: `Keep ${TITLES['/a/l1']}` }).click();
		await expect(sheet).toContainText('UNTICKED · A TAP PUTS IT BACK');
		await expect(bar(page)).toContainText('4 SELECTED');
		await sheet.getByRole('checkbox', { name: `Keep ${TITLES['/a/l1']}` }).click();
		await expect(bar(page)).toContainText('5 SELECTED');
		await sheet.getByRole('button', { name: 'DONE' }).click();
		await expect(sheet).toHaveCount(0);
		// A reload ends it: nothing of it is in the URL or history state.
		await page.reload();
		await expect(bar(page)).toHaveCount(0);
	});

	test('a long press opens the preview, ← comes back selecting, and a tag arrives selecting', async ({
		page
	}) => {
		await page.goto(url(`/browse/${PAPER.id}`));
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await tick(page, TITLES['/a/3']).click();
		await tick(page, TITLES['/a/4']).click({ button: 'right' });
		await expect(page).toHaveURL(new RegExp(`/downloads/source/${resultId(PAPER.id, '/a/4')}`));
		await expect(page.getByRole('heading', { name: TITLES['/a/4'] })).toBeVisible();
		// A tag, inside the app: the selection lives on.
		await page.getByRole('link', { name: 'Action', exact: true }).click();
		await expect(page).toHaveURL(/tab=filtered/);
		await expect(bar(page)).toContainText('1 SELECTED');
		await tick(page, TITLES['/a/g1']).click();
		await bar(page).getByRole('button', { name: 'SHOW' }).click();
		await expect(page.getByRole('dialog', { name: 'The selection' })).toContainText(
			'MANGA · TICKED IN GENRE: ACTION'
		);
		await page.keyboard.press('Escape');
		// Escape closed the sheet first, and SELECT is still on.
		await expect(bar(page)).toContainText('2 SELECTED');
		// The preview's ←, the same way.
		await tick(page, TITLES['/a/g1']).click({ button: 'right' });
		await expect(page.getByRole('heading', { name: TITLES['/a/g1'] })).toBeVisible();
		await page.locator('a.back').click();
		await expect(bar(page)).toContainText('2 SELECTED');
		// Leaving the browse world ends it: a client-side visit to the library,
		// then back again, arrives with nothing selected.
		await page.evaluate(() => {
			const a = document.createElement('a');
			a.href = '/';
			document.body.append(a);
			a.click();
		});
		await expect(page).toHaveURL(url('/'));
		await page.goBack();
		await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toBeVisible();
		await expect(bar(page)).toHaveCount(0);
	});

	test('ADD + FIRST 10 EACH: one band while it runs, one result, a shelf for the press, and one UNDO', async ({
		page
	}) => {
		await page.goto(url(`/browse/${PAPER.id}`));
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		for (const t of [TITLES['/a/3'], TITLES['/a/4'], TITLES['/a/5']]) await tick(page, t).click();
		await bulk(page)
			.getByRole('button', { name: /ADD \+ FIRST 10 EACH/ })
			.click();
		// The press ends SELECT.
		await expect(bar(page)).toHaveCount(0);
		await expect(band(page)).toContainText('ADDED 3 SERIES · 30 CHAPTERS QUEUED');
		expect(inLibrary(PAPER.id, '/a/3')).toBe(1);
		expect(
			read<{ n: number }>(
				`SELECT COUNT(*) AS n FROM download_queue q JOIN series s ON s.id = q.series_id WHERE s.origin_key LIKE ?`,
				`mihon:${PAPER.id}:/a/%`
			).n
		).toBe(30);
		// The tiles say IN LIBRARY now.
		await expect(tile(page, TITLES['/a/3'])).toContainText('IN LIBRARY');
		// PUT ON A SHELF, for every series of the press.
		await band(page).getByRole('button', { name: 'LATER' }).click();
		await expect(band(page)).toContainText('ON LATER');
		await expect
			.poll(
				() =>
					read<{ n: number }>(
						`SELECT COUNT(*) AS n FROM collection_series WHERE collection_id = ?`,
						world.later
					).n
			)
			.toBe(3);
		// Something of one is downloaded now: UNDO says it leaves that one.
		const db = new Database(world.db);
		db.prepare(
			`UPDATE entries SET available = 1 WHERE id = (SELECT MIN(e.id) FROM entries e JOIN series s ON s.id = e.series_id WHERE s.origin_key = ?)`
		).run(`mihon:${PAPER.id}:/a/3`);
		db.close();
		await expect(band(page)).toContainText('1 HAS A CHAPTER DOWNLOADED NOW · UNDO LEAVES IT', {
			timeout: 15_000
		});
		await band(page).getByRole('button', { name: 'UNDO 2' }).click();
		await expect(band(page)).toContainText('UNDONE · 2 TAKEN OUT, WITH THEIR 20 QUEUED CHAPTERS');
		await expect(band(page)).toContainText('1 STAYS: SOMETHING OF IT IS DOWNLOADED OR READ');
		expect(inLibrary(PAPER.id, '/a/4')).toBe(0);
		expect(inLibrary(PAPER.id, '/a/3')).toBe(1);
		await band(page).getByRole('button', { name: 'Close' }).click();
		await expect(band(page)).toHaveCount(0);
	});

	test('a refusal is NOT ADDED with RETRY, and a stale tick is skipped and said', async ({
		page
	}) => {
		await page.goto(url(`/browse/${PAPER.id}`));
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		for (const t of [TITLES['/a/6'], TITLES['/a/7'], TITLES['/a/refuse']])
			await tick(page, t).click();
		// Another tab adds one meanwhile: the press skips it.
		const r = await page.request.post(url('/api/browse/press'), {
			data: { id: resultId(PAPER.id, '/a/7'), which: 'none' }
		});
		expect((await r.json()).status).toBe('added');
		await bulk(page)
			.getByRole('button', { name: /ADD TO LIBRARY/ })
			.click();
		await expect(band(page)).toContainText('ADDED 1 OF 3');
		await expect(band(page)).toContainText(
			`1 NOT ADDED · ${TITLES['/a/refuse'].toUpperCase()} REFUSED · 1 SKIPPED · 1 WAS IN THE LIBRARY BY THEN`
		);
		await band(page).getByRole('button', { name: 'RETRY 1' }).click();
		await expect(band(page)).toContainText('ADDED 1 OF 3');
		await expect(band(page).getByRole('button', { name: 'RETRY 1' })).toBeVisible();
		expect(inLibrary(PAPER.id, '/a/refuse')).toBe(0);
	});
});

test.describe('on a phone', () => {
	test.use(touch('Pixel 5'));

	test('SELECT after /, the short bar, and ADD + ALL asks first', async ({ page }) => {
		await page.goto(url(`/browse/${PAPER.id}`));
		await expect(page.getByRole('link', { name: 'SETTINGS' })).toContainText('SET.');
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await expect(bar(page)).toContainText('0 SELECTED');
		// `/` alone: the words are the tablet's.
		const hint = bar(page).getByRole('link', { name: 'Search Paper Moon to tick' });
		await expect(hint).toBeVisible();
		await expect(hint.getByText('SEARCH PAPER MOON TO TICK')).toBeHidden();
		await tick(page, TITLES['/a/2']).click();
		await tick(page, TITLES['/a/3']).click();
		// What is drawn, not the tablet's words hidden beside it.
		await expect(bulk(page)).toContainText('2 TO ADD · 1 TWIN IN LIBRARY', { useInnerText: true });
		await expect(bulk(page)).not.toContainText('HAS A TWIN', { useInnerText: true });
		await expect(bulk(page)).toContainText('1 SOURCE', { useInnerText: true });
		await expect(bulk(page).getByRole('button', { name: /ADD \+ 10/ })).toBeVisible();
		await bulk(page)
			.getByRole('button', { name: /ADD \+ ALL/ })
			.click();
		const ask = page.getByRole('dialog', { name: 'Add and download all' });
		await expect(ask).toContainText('ADD 2 SERIES AND DOWNLOAD EVERY CHAPTER?');
		await ask.getByRole('button', { name: 'ADD 2 + ALL' }).click();
		await expect(band(page)).toContainText('ADDED 2 SERIES · 24 CHAPTERS QUEUED');
	});
});

test.describe('on a desktop', () => {
	test.use({
		viewport: { width: 1440, height: 900 },
		userAgent: devices['Desktop Chrome'].userAgent,
		hasTouch: false,
		isMobile: false,
		deviceScaleFactor: 1
	});

	test('two sources in the bar, and the press runs a lane each', async ({ page }) => {
		await page.goto(url('/browse'));
		await page
			.getByRole('link', { name: /Second Shelf/ })
			.first()
			.click();
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await tick(page, TITLES['/b/2']).click();
		await tick(page, TITLES['/b/3']).click();
		await backTo(page, url('/browse'));
		await page
			.getByRole('link', { name: /Paper Moon/ })
			.first()
			.click();
		await tick(page, TITLES['/a/3']).click();
		await expect(bar(page)).toContainText('3 SELECTED · 2 SOURCES');
		await expect(bar(page)).toContainText('SEARCH PAPER MOON TO TICK');
		await bulk(page)
			.getByRole('button', { name: /ADD TO LIBRARY/ })
			.click();
		await expect(band(page)).toContainText('ADDED 3 SERIES');
		await expect(band(page)).toContainText('SECOND SHELF 2 · PAPER MOON 1');
		expect(inLibrary(SECOND.id, '/b/2')).toBe(1);
	});
});
