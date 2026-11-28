import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { revealOn } from './helpers/reveal';

/**
 * Acting on a selection from `/search` (doc/LIBRARY.md, "SELECT across
 * the search"): the library's bar, its sheets and its actions, all posted to
 * `/`, and what each answer does here. Its own preview and seeded database,
 * because every case here writes: it is a flow, once, on the tablet.
 */
test.describe.configure({ mode: 'serial' });

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

test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-bulk-'));
	dbPath = join(work, 'library.sqlite');
	mkdirSync(join(work, 'library'));
	const env = {
		...process.env,
		DATABASE_PATH: dbPath,
		LIBRARY_ROOT: join(work, 'library'),
		NODE_NO_WARNINGS: '1'
	};
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env,
		stdio: 'pipe'
	});
	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...env,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
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
	throw new Error('the bulk preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	if (work) rmSync(work, { recursive: true, force: true });
});

const hit = (page: Page, title: string) =>
	page.locator('.hit:not(.work)', { hasText: new RegExp(`^.*${title}`) });
const barCell = (page: Page, name: string) =>
	page.locator('.bulk').getByRole('button', { name, exact: true });
const count = (page: Page) => page.locator('.selected-count').first();
const row = <T>(sql: string, ...args: unknown[]): T => {
	const db = new Database(dbPath, { readonly: true });
	const out = db.prepare(sql).get(...args) as T;
	db.close();
	return out;
};
const series = (title: string) =>
	row<{ id: number; hidden: number; favourite: number }>(
		`SELECT id, hidden, favourite FROM series WHERE title = ?`,
		title
	);
const write = (sql: string, ...args: unknown[]) => {
	const db = new Database(dbPath);
	db.prepare(sql).run(...args);
	db.close();
};
const hiddenOf = (seriesId: number) =>
	row<{ hidden: number }>(`SELECT hidden FROM series WHERE id = ?`, seriesId).hidden;
const inWork = (seriesId: number) =>
	row<{ work_id: number } | undefined>(
		`SELECT work_id FROM work_series WHERE series_id = ?`,
		seriesId
	);

/** A Work written as `?/work` writes it, for the cases that need one to already exist. */
function makeWork(name: string, titles: string[]): number {
	const db = new Database(dbPath);
	const { id } = db
		.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES (?, ?, 'hand') RETURNING id`)
		.get(name, Date.now()) as { id: number };
	const member = db.prepare(
		`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`
	);
	titles.forEach((t, i) => member.run(id, series(t).id, i + 1));
	db.close();
	return id;
}

/**
 * A series of one chapter under a made-up title, for the cases that need
 * their own: the seed's titles are other cases', and a new case names no real
 * series. Filed on the seed's open root, as a scan files one.
 */
function madeUp(title: string, hidden = 0): number {
	const db = new Database(dbPath);
	const root = db.prepare(`SELECT id FROM roots WHERE hidden = 0 ORDER BY id LIMIT 1`).get() as {
		id: number;
	};
	const now = Date.now();
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, hidden, added_at, indexed_at)
				VALUES (?, ?, 'manga', ?, ?, ?)`
			)
			.run(root.id, title, hidden, now, now).lastInsertRowid
	);
	db.prepare(
		`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, 1, 'Chapter 1', ?)`
	).run(id, now);
	db.close();
	return id;
}

/** GROUP, A WORK, CREATE WORK: the ticked hits made into a Work by the app's own sheet. */
async function createWork(page: Page, name: string) {
	await barCell(page, 'GROUP').click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill(name);
	await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
	await expect(sheet).toHaveCount(0);
}

/** GROUP, A WORK, ADD TO A WORK: the sheet, on the page's own list of Works. */
async function addToWork(page: Page) {
	await barCell(page, 'GROUP').click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('radio', { name: /ADD TO A WORK/ }).click();
	return sheet;
}
const searchField = (page: Page) =>
	page.getByRole('searchbox').or(page.locator('.bar input')).first();
const STALE = 'THAT WORK HAS CHANGED · LOOK AGAIN';
const hidBand = (page: Page) => page.locator('.band:visible', { hasText: 'HIDDEN' });
/** GROUP into a Work's band: the library's own words, `m.offer_work_made` and `m.offer_added_to`. */
const workBand = (page: Page, text: string | RegExp) =>
	page.locator('.band:visible', { hasText: text });

/** A library tile by its exact title. */
const libraryTile = (page: Page, title: string) =>
	page.locator('.grid .tile').filter({
		has: page.locator('.title', { hasText: new RegExp(`^${title}$`) })
	});

/** The library by title, SELECT, and this tile ticked: SELECT asserted on before anything ends it. */
async function selectOnLibrary(page: Page, tile: ReturnType<typeof libraryTile>) {
	await page.goto(`${BASE}/?shelf=all&sort=title`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const open = tile.locator('.open');
	await open.click();
	await expect(open).toHaveAttribute('aria-pressed', 'true');
	await expect(count(page)).toHaveText('1 SELECTED');
	await expect(page.locator('.bulk')).toBeVisible();
	return open;
}

/** A search, SELECT on the bar, and these hits ticked: the real way a selection starts here. */
async function tick(page: Page, q: string, titles: string[]) {
	await page.goto(`${BASE}/search?q=${encodeURIComponent(q)}`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of titles) await hit(page, t).click();
	await expect(count(page)).toHaveText(`${titles.length} SELECTED`);
}

test('the library’s bar is drawn at the foot, with the same cells', async ({ page }) => {
	await tick(page, 'Isekai', ['Isekai Yakkyoku']);
	const bar = page.locator('.bulk');
	await expect(bar).toBeVisible();
	for (const cell of ['FAV', '+ SHELF', 'TAG', 'GROUP', 'REFRESH', 'HIDE', 'DELETE'])
		await expect(barCell(page, cell)).toBeVisible();
	await expect(bar.getByRole('slider').or(bar.getByRole('group')).first()).toBeVisible();
	// The inverse block stays the entry, unchanged.
	await expect(page.locator('.sel.in-bar .selected-count')).toHaveText('1 SELECTED');
	const before = await page.locator('.sel.in-bar').boundingBox();
	const barBox = (await bar.boundingBox())!;
	expect(barBox.y + barBox.height).toBeCloseTo(page.viewportSize()!.height, 0);
	expect(before!.y).toBeLessThan(barBox.y);

	// A phone: the entry is the 48 px strip, and the bar under it is the library's, whole.
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.locator('.sel.strip .selected-count')).toHaveText('1 SELECTED');
	const phone = (await bar.boundingBox())!;
	expect(phone.width).toBeLessThanOrEqual(390);
	await expect(barCell(page, 'DELETE')).toBeVisible();
});

test('FAV posts to the library, keeps SELECT, and ← does not act twice', async ({ page }) => {
	const t = series('Isekai Yakkyoku');
	expect(t.favourite).toBe(0);
	await tick(page, 'Isekai', ['Isekai Yakkyoku']);
	const asked = page.waitForResponse(
		(r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/'
	);
	await barCell(page, 'FAV').click();
	expect((await asked).status()).toBe(200);
	await expect.poll(() => series('Isekai Yakkyoku').favourite).toBe(1);
	await expect(count(page)).toHaveText('1 SELECTED');

	// Acting, then going back: the ids come along, and nothing is posted again.
	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST') posts.push(r.url());
	});
	await page.getByRole('link', { name: 'Back' }).first().click();
	await page.waitForURL((u) => u.pathname === '/');
	await expect(page.locator('.selected-count').first()).toContainText('1');
	expect(posts).toEqual([]);
	expect(series('Isekai Yakkyoku').favourite).toBe(1);
});

test('going back, then acting: the ids made on /search are the ones the library acts on', async ({
	page
}) => {
	await tick(page, 'Isekai', ['Isekai Ojisan']);
	await page.getByRole('link', { name: 'Back' }).first().click();
	await page.waitForURL((u) => u.pathname === '/');
	await expect(page.locator('.selected-count').first()).toContainText('1');
	await page.locator('.bulk').getByRole('button', { name: 'FAV', exact: true }).click();
	await expect.poll(() => series('Isekai Ojisan').favourite).toBe(1);
});

test('+ SHELF puts the ticked series on the shelf from /search', async ({ page }) => {
	write(`INSERT INTO collections (name, position) VALUES ('Bulk Shelf', 99)`);
	await tick(page, 'Dungeon', ['Dungeon Meshi']);
	await barCell(page, '+ SHELF').click();
	await page
		.getByRole('dialog', { name: 'Add to shelf' })
		.getByRole('button', { name: /Bulk Shelf/i })
		.click();
	await expect
		.poll(
			() =>
				row<{ n: number }>(
					`SELECT COUNT(*) AS n FROM collection_series cs JOIN collections c ON c.id = cs.collection_id WHERE c.name = 'Bulk Shelf'`
				).n
		)
		.toBe(1);
	await expect(count(page)).toHaveText('1 SELECTED');
});

test('GROUP a Work from two ticked hits: the library’s band with UNDO, SELECT ends, and ADD TO A WORK posts to the library', async ({
	page
}) => {
	const [a, b] = [series('Sousou no Frieren'), series('Yofukashi no Uta')];
	const workHit = page.locator('.hit.work', { hasText: 'Bulk Work' });
	const made = workBand(page, 'BULK WORK IS A WORK');
	await page.goto(`${BASE}/search?q=o`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(count(page)).toHaveText('0 SELECTED');
	await hit(page, 'Sousou no Frieren').click();
	await hit(page, 'Yofukashi no Uta').click();
	await createWork(page, 'Bulk Work');
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect(count(page)).toHaveCount(0);
	expect(inWork(a.id)).toBeDefined();
	expect(inWork(b.id)?.work_id).toBe(inWork(a.id)?.work_id);
	// The library's band, in its words, and the hits read again with the Work in them.
	await expect(made).toContainText('2 SERIES · EACH KEEPS ITS OWN');
	await expect(workHit).toBeVisible();

	// UNDO posts the library's `?/undoWork`: the Work goes, and so do the band and the hit.
	const undone = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('undoWork')
	);
	await made.getByRole('button', { name: 'UNDO', exact: true }).click();
	expect(new URL((await undone).url()).pathname).toBe('/');
	await expect(made).toHaveCount(0);
	await expect(workHit).toHaveCount(0);
	expect(inWork(a.id)).toBeUndefined();
	expect(inWork(b.id)).toBeUndefined();

	// Made again, for the add below and the cases after it.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await hit(page, 'Sousou no Frieren').click();
	await hit(page, 'Yofukashi no Uta').click();
	await createWork(page, 'Bulk Work');
	await expect(made).toBeVisible();
	expect(inWork(b.id)?.work_id).toBe(inWork(a.id)?.work_id);

	// The trap: ADD TO A WORK's `?/addToWork` was relative, and `/search` has no such action.
	const c = series('Chainsaw Man');
	await page.goto(`${BASE}/search?q=Chainsaw`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await hit(page, 'Chainsaw Man').click();
	await barCell(page, 'GROUP').click();
	const add = page.getByRole('dialog', { name: 'Group into a series' });
	await add.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await add.getByRole('radio', { name: /ADD TO A WORK · 1/ }).click();
	await add.getByText('Bulk Work', { exact: true }).click();
	const posted = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('addToWork')
	);
	await add.getByRole('button', { name: /ADD 1 TO THE WORK/ }).click();
	expect(new URL((await posted).url()).pathname).toBe('/');
	await expect.poll(() => inWork(c.id)?.work_id).toBe(inWork(a.id)?.work_id);
	const added = workBand(page, 'ADDED TO BULK WORK');
	await expect(added).toContainText('1 SERIES · AT THE END OF THE RUN');
	await expect(page.locator('.bulk')).toHaveCount(0);
	// The band is the add's: the create's, on another query, is not drawn here.
	await expect(made).toHaveCount(0);

	await added.getByRole('button', { name: 'UNDO', exact: true }).click();
	await expect(added).toHaveCount(0);
	expect(inWork(c.id)).toBeUndefined();
	expect(inWork(a.id)).toBeDefined();
});

test('GROUP’s UNDO refused: the band stays and says why', async ({ page }) => {
	const ids = [madeUp('Paper Lantern Alley'), madeUp('Paper Lantern Ferry')];
	await tick(page, 'Paper Lantern', ['Paper Lantern Alley', 'Paper Lantern Ferry']);
	await createWork(page, 'Lantern Run');
	const band = workBand(page, 'LANTERN RUN');
	await expect(band).toContainText('LANTERN RUN IS A WORK');
	// Ended elsewhere: the Work the create made is not the one there now.
	const work = inWork(ids[0])!.work_id;
	// This connection keeps no foreign keys, so the members go by hand, as an UNGROUP's would.
	write(`DELETE FROM work_series WHERE work_id = ?`, work);
	write(`DELETE FROM works WHERE id = ?`, work);

	const undone = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('undoWork')
	);
	await band.getByRole('button', { name: 'UNDO', exact: true }).click();
	expect((await undone).status()).toBe(200);
	await expect(band).toContainText('LANTERN RUN HAS CHANGED SINCE IT WAS MADE');
	await expect(band.getByRole('button', { name: 'UNDO', exact: true })).toBeVisible();
	expect(ids.map((id) => inWork(id))).toEqual([undefined, undefined]);
});

test('GROUP’s band goes with its query and with ✕, and ✕ undoes nothing', async ({ page }) => {
	const ids = [madeUp('Copper Kettle Dawn'), madeUp('Copper Kettle Dusk')];
	await tick(page, 'Copper Kettle', ['Copper Kettle Dawn', 'Copper Kettle Dusk']);
	await createWork(page, 'Kettle Run');
	const band = workBand(page, 'KETTLE RUN IS A WORK');
	await expect(band).toBeVisible();

	await searchField(page).fill('Copper Kettle D');
	await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Copper Kettle D');
	await expect(band).toHaveCount(0);
	await searchField(page).fill('Copper Kettle');
	await expect(band).toBeVisible();

	await band.getByRole('button', { name: 'Dismiss this band' }).click();
	await expect(band).toHaveCount(0);
	const work = inWork(ids[0])?.work_id;
	expect(work).toBeDefined();
	expect(inWork(ids[1])?.work_id).toBe(work);
});

test('a HIDE of the Work’s series takes GROUP’s band down, and its name is not drawn again', async ({
	page
}) => {
	const ids = [madeUp('Velvet Orchard North'), madeUp('Velvet Orchard South')];
	await tick(page, 'Velvet Orchard', ['Velvet Orchard North', 'Velvet Orchard South']);
	await createWork(page, 'Orchard Run');
	await expect(workBand(page, 'ORCHARD RUN IS A WORK')).toBeVisible();

	// A part of the Work: the bar's HIDE asks, and HIDE ALL hides it whole.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await hit(page, 'Velvet Orchard North').click();
	await barCell(page, 'HIDE').click();
	await page
		.getByRole('dialog', { name: 'Hide' })
		.getByRole('button', { name: /HIDE ALL/ })
		.click();
	await expect(hidBand(page)).toContainText('THE WORK, WHOLE');
	await expect.poll(() => ids.map(hiddenOf)).toEqual([1, 1]);
	await expect(page.getByText('ORCHARD RUN')).toHaveCount(0);
	// Away and back to the query: the HIDE's band, never the GROUP's again.
	await searchField(page).fill('Velvet Orchard N');
	await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Velvet Orchard N');
	await searchField(page).fill('Velvet Orchard');
	await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Velvet Orchard');
	await expect(hidBand(page)).toBeVisible();
	await expect(page.getByText('ORCHARD RUN')).toHaveCount(0);
	expect(await page.content()).not.toContain('ORCHARD RUN');
});

test('a Work made under reveal is not named once reveal has ended, even back on its query', async ({
	page,
	context
}) => {
	madeUp('Hollow Reed Ember', 1);
	madeUp('Hollow Reed Frost', 1);
	await revealOn(context, BASE);
	await tick(page, 'Hollow Reed', ['Hollow Reed Ember', 'Hollow Reed Frost']);
	await createWork(page, 'Reed Run');
	const band = workBand(page, 'REED RUN IS A WORK');
	await expect(band).toBeVisible();

	// Reveal ends without leaving the page (another tab's HIDE AGAIN, its 12 hours).
	await context.clearCookies({ name: 'tsundoku_reveal' });
	await searchField(page).fill('Hollow Reed E');
	await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Hollow Reed E');
	await searchField(page).fill('Hollow Reed');
	await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Hollow Reed');
	await expect(hit(page, 'Hollow Reed Ember')).toHaveCount(0);
	await expect(band).toHaveCount(0);
	expect(await page.content()).not.toContain('REED RUN');
});

test('a plain HIDE ends SELECT and takes the hit out of the results', async ({ page }) => {
	await tick(page, 'Lookism', ['Lookism']);
	await barCell(page, 'HIDE').click();
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect.poll(() => series('Lookism').hidden).toBe(1);
	await expect(hit(page, 'Lookism')).toHaveCount(0);
	// A series in no Work is a plain hide: `wholeAnswer` answers no facts, so no band.
	await expect(hidBand(page)).toHaveCount(0);
});

test('on the library too, a plain HIDE ends SELECT, FAV does not, and UNHIDE under reveal ends it', async ({
	page,
	context
}) => {
	const id = madeUp('Aardvark Quiet Harbor');
	const tile = libraryTile(page, 'Aardvark Quiet Harbor');
	const ticked = await selectOnLibrary(page, tile);
	// FAV is not a HIDE: the ticks stay, as on the search.
	await barCell(page, 'FAV').click();
	await expect
		.poll(() => row<{ f: number }>(`SELECT favourite AS f FROM series WHERE id = ?`, id).f)
		.toBe(1);
	await expect(count(page)).toHaveText('1 SELECTED');
	await expect(ticked).toHaveAttribute('aria-pressed', 'true');

	await barCell(page, 'HIDE').click();
	await expect.poll(() => hiddenOf(id)).toBe(1);
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect(count(page)).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toBeVisible();
	await expect(tile).toHaveCount(0);
	// A series in no Work is a plain hide: no band.
	await expect(hidBand(page)).toHaveCount(0);

	await revealOn(context, BASE);
	await selectOnLibrary(page, tile);
	await expect(barCell(page, 'HIDE')).toHaveCount(0);
	await barCell(page, 'UNHIDE').click();
	await expect.poll(() => hiddenOf(id)).toBe(0);
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect(count(page)).toHaveCount(0);
});

test('on the library, a plain HIDE that took a Work ends SELECT and keeps the band with UNDO', async ({
	page
}) => {
	const ids = [madeUp('Aardwolf Salt Road'), madeUp('Aardwolf Salt Sea')];
	const tile = libraryTile(page, 'Aardwolf Salt Road');
	await selectOnLibrary(page, tile);
	// The tick noted no Work, so the bar's HIDE is the plain one, posted to `?/bulk`,
	// and the workstation's `wholeAnswer` hides the Work it joined since.
	makeWork('Salt Run', ['Aardwolf Salt Road', 'Aardwolf Salt Sea']);
	await barCell(page, 'HIDE').click();
	await expect(hidBand(page)).toContainText('THE WORK, WHOLE');
	await expect(page.getByRole('dialog', { name: 'Hide' })).toHaveCount(0);
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect(count(page)).toHaveCount(0);
	await expect.poll(() => ids.map(hiddenOf)).toEqual([1, 1]);

	await hidBand(page).getByRole('button', { name: 'UNDO', exact: true }).click();
	await expect.poll(() => ids.map(hiddenOf)).toEqual([0, 0]);
	await expect(hidBand(page)).toHaveCount(0);
});

test('a part of a Work: HIDE asks first, and HIDE ALL posts to the library and shows the band', async ({
	page
}) => {
	await tick(page, 'Frieren', ['Sousou no Frieren']);
	// Facts taken from the writer: `/search`'s own Picked record says it is in a Work.
	await barCell(page, 'HIDE').click();
	const sheet = page.getByRole('dialog', { name: 'Hide' });
	await expect(sheet).toContainText('PART OF BULK WORK');
	const posted = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('hideAll')
	);
	await sheet.getByRole('button', { name: /HIDE ALL/ }).click();
	expect(new URL((await posted).url()).pathname).toBe('/');
	const band = page.locator('.band:visible', { hasText: 'HIDDEN' });
	await expect(band).toBeVisible();
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect.poll(() => series('Sousou no Frieren').hidden).toBe(1);
});

test('a selection all of hidden series offers UNHIDE, and it takes them back', async ({
	page,
	context
}) => {
	await revealOn(context, BASE);
	await tick(page, 'Lookism', ['Lookism']);
	await expect(barCell(page, 'UNHIDE')).toBeVisible();
	await expect(barCell(page, 'HIDE')).toHaveCount(0);
	await barCell(page, 'UNHIDE').click();
	await expect.poll(() => series('Lookism').hidden).toBe(0);
	await expect(page.locator('.bulk')).toHaveCount(0);
});

test('two languages ticked only on /search offer FOLD, and a refusal keeps the selection', async ({
	page
}) => {
	const [en, jp] = ['Ame no Hi no Toshokan', 'Natsu no Owari ni Kimi to'];
	// A card's language is its `language:` tag, which is what an import writes.
	const language = (title: string, value: string) => {
		const db = new Database(dbPath);
		const tag = db
			.prepare(
				`INSERT INTO tags (namespace, value) VALUES ('language', ?)
				ON CONFLICT (namespace, value) DO UPDATE SET value = excluded.value RETURNING id`
			)
			.get(value) as { id: number };
		db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
			series(title).id,
			tag.id
		);
		db.close();
	};
	language(en, 'english');
	language(jp, 'japanese');
	await tick(page, ' no ', [en, jp]);
	const fold = page.locator('.bulk button.fold');
	await expect(fold).toBeVisible();
	await expect(fold).toContainText(/EN|JP/);

	// The server is still the judge: the book gains an extra after the ticks,
	// which `?/fold` refuses, and SELECT stays on with its reason.
	write(
		`INSERT INTO entries (series_id, position, label, added_at, title) VALUES (?, 9, 'Extra', 1, 'Extra')`,
		series(en).id
	);
	await fold.click();
	await expect(page.locator('.fold-refused')).toContainText(/ONLY SINGLE BOOKS FOLD|CAN.T FOLD/);
	await expect(count(page)).toHaveText('2 SELECTED');
	await expect(page.locator('.bulk')).toBeVisible();
});

test('REFRESH answers in a band over the bar, and the selection stays', async ({ page }) => {
	await tick(page, 'Tower', ['Tower of God']);
	await barCell(page, 'REFRESH').click();
	await expect(page.locator('.refresh-band .band')).toBeVisible();
	await expect(count(page)).toHaveText('1 SELECTED');
	await page.locator('.refresh-band').getByRole('button', { name: 'Dismiss this band' }).click();
	await expect(page.locator('.refresh-band .band')).toHaveCount(0);
	await expect(count(page)).toHaveText('1 SELECTED');
});

test('DELETE asks, posts to the library, ends SELECT and takes the hit away', async ({ page }) => {
	await tick(page, 'Villainess', ['Villainess Level 99']);
	await barCell(page, 'DELETE').click();
	const sheet = page.getByRole('dialog', { name: 'DELETE 1 SERIES?' });
	await expect(sheet).toContainText('VILLAINESS LEVEL 99');
	const posted = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('delete')
	);
	await sheet.getByRole('button', { name: 'DELETE 1' }).click();
	expect(new URL((await posted).url()).pathname).toBe('/');
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect(hit(page, 'Villainess Level 99')).toHaveCount(0);
	expect(
		row<{ n: number }>(`SELECT COUNT(*) AS n FROM series WHERE title = 'Villainess Level 99'`).n
	).toBe(0);
});

test('ADD TO A WORK whose Work is gone: the refusal is drawn, the ticks stay, and the sheet stops offering it', async ({
	page
}) => {
	const gone = makeWork('Gone Work', ['Hikaru ga Shinda Natsu', 'Boku no Kokoro no Yabai Yatsu']);
	makeWork('Standing Work', ['Return of the Mount Hua Sect', 'The Greatest Estate Developer']);
	await tick(page, 'Dungeon', ['Dungeon Meshi']);
	const sheet = await addToWork(page);
	await sheet.getByText('Gone Work', { exact: true }).click();
	write(`DELETE FROM works WHERE id = ?`, gone);
	const posted = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('addToWork')
	);
	await sheet.getByRole('button', { name: /ADD 1 TO THE WORK/ }).click();
	await posted;

	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.fold-refused')).toHaveText(STALE);
	await expect(count(page)).toHaveText('1 SELECTED');
	await expect(page.locator('.bulk')).toBeVisible();

	// The second press: the list is the one the workstation holds now.
	const again = await addToWork(page);
	await expect(again.getByText('Gone Work', { exact: true })).toHaveCount(0);
	await expect(again.getByText('Standing Work', { exact: true })).toBeVisible();
	await again.getByRole('button', { name: /CANCEL/ }).click();
	await expect(count(page)).toHaveText('1 SELECTED');
});

test('ADD TO A WORK whose Work was remade under its id: refused, then the second press joins it', async ({
	page
}) => {
	const id = makeWork('Remade Work', [
		'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		'Natsu no Owari ni Kimi to'
	]);
	const dungeon = series('Dungeon Meshi').id;
	await tick(page, 'Dungeon', ['Dungeon Meshi']);
	const sheet = await addToWork(page);
	await sheet.getByText('Remade Work', { exact: true }).click();
	// A newer Work under the same id: what `created_at` being posted back is for.
	write(`UPDATE works SET created_at = created_at + 1 WHERE id = ?`, id);
	await sheet.getByRole('button', { name: /ADD 1 TO THE WORK/ }).click();
	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.fold-refused')).toHaveText(STALE);
	await expect(count(page)).toHaveText('1 SELECTED');
	expect(inWork(dungeon)).toBeUndefined();

	// The Work is still there: the re-read gave the sheet its new `created_at`.
	const again = await addToWork(page);
	await again.getByText('Remade Work', { exact: true }).click();
	await again.getByRole('button', { name: /ADD 1 TO THE WORK/ }).click();
	await expect.poll(() => inWork(dungeon)?.work_id).toBe(id);
	await expect(page.locator('.bulk')).toHaveCount(0);
});

test('a plain HIDE of a series that joined a Work after the tick: its band and UNDO, for the whole Work', async ({
	page
}) => {
	const parts = ['Kusuriya no Hitorigoto', 'Mushoku Tensei', 'Honzuki no Gekokujou'];
	await tick(page, 'Kusuriya', ['Kusuriya no Hitorigoto']);
	// The tick noted no Work, so the bar's HIDE is the plain one, posted to `?/bulk`.
	makeWork('Late Work', parts);
	await barCell(page, 'HIDE').click();

	await expect(hidBand(page)).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Hide' })).toHaveCount(0);
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect.poll(() => parts.map((t) => series(t).hidden)).toEqual([1, 1, 1]);

	await hidBand(page).getByRole('button', { name: 'UNDO', exact: true }).click();
	await expect.poll(() => parts.map((t) => series(t).hidden)).toEqual([0, 0, 0]);
	await expect(hidBand(page)).toHaveCount(0);
});

test('that band goes with its query and with ✕, and ✕ undoes nothing', async ({ page }) => {
	const parts = ['Tensei Shitara Ken Deshita', 'Tower of God'];
	await tick(page, 'Tensei', ['Tensei Shitara Ken Deshita']);
	makeWork('Second Late Work', parts);
	await barCell(page, 'HIDE').click();
	await expect(hidBand(page)).toBeVisible();

	await searchField(page).fill('Tensei S');
	await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Tensei S');
	await expect(hidBand(page)).toHaveCount(0);
	await searchField(page).fill('Tensei');
	await expect(hidBand(page)).toBeVisible();

	await hidBand(page).getByRole('button', { name: 'Dismiss this band' }).click();
	await expect(hidBand(page)).toHaveCount(0);
	expect(parts.map((t) => series(t).hidden)).toEqual([1, 1]);
});

test('GROUP into a series: the library’s redirect, and SELECT ends by leaving', async ({
	page
}) => {
	await tick(page, ' no ', ['Hoshi no Umi no Tabibito', 'Sekai no Owari no Kissaten']);
	await barCell(page, 'GROUP').click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('textbox', { name: 'Series name' }).fill('Bulk Book');
	const posted = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('group')
	);
	await sheet.getByRole('button', { name: /CREATE SERIES · 2 BOOKS/ }).click();
	expect(new URL((await posted).url()).pathname).toBe('/');
	await page.waitForURL(/\/series\/\d+\?created=2&/);
	await expect(page.locator('.bulk')).toHaveCount(0);
});

test('the refusal over the bar lasts until the user moves on: a tick, the query, ✕; ← leaves it behind', async ({
	page
}) => {
	const id = makeWork('Refusal Work', ['Hikaru ga Shinda Natsu', 'Boku no Kokoro no Yabai Yatsu']);
	const refused = page.locator('.fold-refused');
	/** A refusal reached the real way: the Work is remade between the pick and ADD. */
	const refuse = async () => {
		const sheet = await addToWork(page);
		await sheet.getByText('Refusal Work', { exact: true }).click();
		write(`UPDATE works SET created_at = created_at + 1 WHERE id = ?`, id);
		await sheet.getByRole('button', { name: /ADD \d+ TO THE WORK/ }).click();
		await expect(refused).toHaveText(STALE);
	};
	await tick(page, 'Isekai', ['Isekai Yakkyoku', 'Isekai Ojisan']);

	await refuse();
	await hit(page, 'Isekai Ojisan').click();
	await expect(refused).toHaveCount(0);
	await expect(count(page)).toHaveText('1 SELECTED');

	await refuse();
	await searchField(page).fill('Isekai Y');
	await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Isekai Y');
	await expect(refused).toHaveCount(0);
	await expect(count(page)).toHaveText('1 SELECTED');

	await refuse();
	await page.getByRole('button', { name: 'Stop selecting' }).first().click();
	await expect(page.locator('.bulk')).toHaveCount(0);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(refused).toHaveCount(0);

	await hit(page, 'Isekai Yakkyoku').click();
	await refuse();
	await page.getByRole('link', { name: 'Back' }).first().click();
	await page.waitForURL((u) => u.pathname === '/');
	await expect(page.locator('.selected-count').first()).toContainText('1');
	await expect(refused).toHaveCount(0);
});

test('a DELETE that comes back without a success says so, keeps the ticks and reads the page again', async ({
	page
}) => {
	await tick(page, 'Isekai', ['Isekai Ojisan']);
	await page.route(
		(u) => u.search === '?/delete',
		(r) => r.fulfill({ status: 500, body: 'no' })
	);
	await barCell(page, 'DELETE').click();
	const sheet = page.getByRole('dialog', { name: 'DELETE 1 SERIES?' });
	const reread = page.waitForRequest((r) => r.url().includes('__data.json'));
	await sheet.getByRole('button', { name: 'DELETE 1' }).click();
	await reread;
	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.fold-refused')).toContainText('NOT DELETED');
	await expect(count(page)).toHaveText('1 SELECTED');
	await page.unroute((u) => u.search === '?/delete');

	await hit(page, 'Isekai Yakkyoku').click();
	await expect(page.locator('.fold-refused')).toHaveCount(0);
});
