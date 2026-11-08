import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * Acting on a selection from `/search` (c838; doc/LIBRARY.md, "SELECT across
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

/** GROUP, A WORK, ADD TO A WORK: the sheet, on the page's own list of Works. */
async function addToWork(page: Page) {
	await barCell(page, 'GROUP').click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('radio', { name: /ADD TO A WORK/ }).click();
	return sheet;
}
const STALE = 'THAT WORK HAS CHANGED · LOOK AGAIN';
const hidBand = (page: Page) => page.locator('.band:visible', { hasText: 'HIDDEN' });

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

test('GROUP a Work from two ticked hits: ends SELECT, and ADD TO A WORK posts to the library', async ({
	page
}) => {
	const [a, b] = [series('Sousou no Frieren'), series('Yofukashi no Uta')];
	await page.goto(`${BASE}/search?q=o`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await hit(page, 'Sousou no Frieren').click();
	await hit(page, 'Yofukashi no Uta').click();
	await barCell(page, 'GROUP').click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Bulk Work');
	await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.bulk')).toHaveCount(0);
	expect(inWork(a.id)).toBeDefined();
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
	await context.addCookies([{ name: 'tsundoku_reveal', value: '1', url: BASE }]);
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

test('ADD TO A WORK whose Work was remade under its id (c583): refused, then the second press joins it', async ({
	page
}) => {
	const id = makeWork('Remade Work', ['Hoshi no Umi no Tabibito', 'Sekai no Owari no Kissaten']);
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

	await page.getByRole('searchbox').or(page.locator('.bar input')).first().fill('Tensei S');
	await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Tensei S');
	await expect(hidBand(page)).toHaveCount(0);
	await page.getByRole('searchbox').or(page.locator('.bar input')).first().fill('Tensei');
	await expect(hidBand(page)).toBeVisible();

	await hidBand(page).getByRole('button', { name: 'Dismiss this band' }).click();
	await expect(hidBand(page)).toHaveCount(0);
	expect(parts.map((t) => series(t).hidden)).toEqual([1, 1]);
});
