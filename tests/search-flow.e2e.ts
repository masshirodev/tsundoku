/**
 * The library's SELECT outlives the shelf, the kind and the filter it was
 * made on (c698): a series ticked out of sight stays ticked, SHOW lists the
 * whole selection to review or untick, and GROUP takes what SHOW lists, not
 * only the tiles on screen. A flow file, so it runs once, in
 * tablet-portrait; it only opens sheets and cancels them, so the shared seed
 * is left as it was.
 */
import { type Locator, type Page, type Route } from '@playwright/test';
import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as tcpServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

const tiles = (page: Page) => page.locator('.grid .tile');
const titleOf = async (tile: Locator) => (await tile.locator('.title').textContent())!.trim();
const kindCell = (page: Page, word: string) =>
	page.locator('.kinds .kc').filter({ hasText: new RegExp(`^${word}\\d`) });
const count = (page: Page) => page.locator('.selected-count');

/** Opens the library sorted by title and starts SELECT. */
async function startSelecting(page: Page) {
	await page.goto('/?sort=title');
	await expect(tiles(page).first()).toBeVisible();
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(count(page)).toHaveText('0 SELECTED');
}

/** A kind cell's own navigation, waited on by its URL and the grid it brings. */
async function toKind(page: Page, word: string, param: string) {
	await kindCell(page, word).click();
	await page.waitForURL(new RegExp(`kind=${param}`));
	await expect(kindCell(page, word)).toHaveAttribute('aria-current', 'true');
}

test('a series ticked on one kind stays ticked on another, SHOW lists both, and GROUP takes what SHOW keeps (c698)', async ({
	page
}) => {
	await startSelecting(page);
	await toKind(page, 'MANGA', 'manga');
	const a = await titleOf(tiles(page).first());
	await tiles(page).first().click();
	await expect(count(page)).toHaveText('1 SELECTED');

	// Another kind: A is not on screen, and the selection is still 1.
	await toKind(page, 'MANHWA', 'manhwa');
	await expect(tiles(page).filter({ hasText: a })).toHaveCount(0);
	await expect(count(page)).toHaveText('1 SELECTED');
	const b = await titleOf(tiles(page).nth(0));
	const c = await titleOf(tiles(page).nth(1));
	await tiles(page).nth(0).click();
	await tiles(page).nth(1).click();
	await expect(count(page)).toHaveText('3 SELECTED');

	// SHOW lists all three, in the order they were ticked, A out of sight included.
	await page.getByRole('button', { name: 'SHOW', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'The selection' });
	await expect(sheet).toBeVisible();
	await expect(sheet.locator('.show-title')).toHaveText('THE SELECTION · 3 SERIES');
	await expect(sheet.locator('.show-row .a')).toHaveText([a, b, c]);

	// Untick B there: the row stays, dimmed, until the sheet closes.
	await sheet.getByRole('checkbox', { name: `Keep ${b}` }).click();
	await expect(sheet.getByRole('checkbox', { name: `Keep ${b}` })).toHaveAttribute(
		'aria-checked',
		'false'
	);
	await expect(count(page)).toHaveText('2 SELECTED');
	await expect(sheet.locator('.show-row')).toHaveCount(3);
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(tiles(page).filter({ hasText: b }).first().locator('.open')).toHaveAttribute(
		'aria-pressed',
		'false'
	);

	// GROUP takes the two SHOW kept: its rows are what it posts (GroupSheet's
	// `series` fields are its ticked rows), and A is among them though off screen.
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const group = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(group.locator('.h-title')).toHaveText(/^GROUP 2 /);
	await expect(group.locator('.rows .row').filter({ hasText: a })).toHaveCount(1);
	await expect(group.locator('.rows .row').filter({ hasText: c })).toHaveCount(1);
	await expect(group.locator('.rows .row').filter({ hasText: b })).toHaveCount(0);
	await group.getByRole('button', { name: 'CANCEL' }).click();
	await expect(group).toHaveCount(0);

	// ✕ ends SELECT and drops it: SELECT again starts from none.
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await expect(count(page)).toHaveCount(0);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(count(page)).toHaveText('0 SELECTED');
});

test('a shelf switch keeps the selection, and SHOW still lists what is off the shelf (c698)', async ({
	page
}) => {
	await startSelecting(page);
	const a = await titleOf(tiles(page).first());
	await tiles(page).first().click();
	await expect(count(page)).toHaveText('1 SELECTED');

	const shelves = page.locator('nav[aria-label="Shelves"]').filter({ visible: true });
	// A shelf the first series is not on: the seed's empty RAWS (JP) shelf.
	await shelves.getByRole('link', { name: /^RAWS \(JP\)/ }).click();
	await page.waitForURL(/shelf=/);
	await expect(tiles(page).filter({ hasText: a })).toHaveCount(0);
	await expect(count(page)).toHaveText('1 SELECTED');
	await page.getByRole('button', { name: 'SHOW', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'The selection' });
	await expect(sheet.locator('.show-row .a')).toHaveText([a]);
	await sheet.getByRole('button', { name: 'DONE' }).click();

	// DELETE's question names it too, off the shelf as it is; CANCEL deletes nothing.
	await page.getByRole('toolbar').getByRole('button', { name: 'DELETE' }).click();
	const ask = page.getByRole('dialog', { name: /DELETE 1 SERIES/ });
	await expect(ask.getByText(`1 SELECTED · ${a.toUpperCase()}`)).toBeVisible();
	await ask.getByRole('button', { name: 'CANCEL' }).click();
	await expect(ask).toHaveCount(0);

	// BACK to ALL is the same page: the selection and the tick are still there.
	await page.goBack();
	await expect(page).not.toHaveURL(/shelf=/);
	await expect(count(page)).toHaveText('1 SELECTED');
	await expect(tiles(page).filter({ hasText: a }).first().locator('.open')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('a reload ends SELECT; a trip to /search and back keeps it, and ✕ ends it (c698)', async ({
	page
}) => {
	// The selection lives in the tab (src/lib/library/selection.ts,
	// `carrySelection`): a reload makes the library again from nothing
	// (doc/LIBRARY.md, "What ends SELECT"), and the search takes it and gives
	// it back. Every other door is tests/select-search-flow.e2e.ts'.
	await startSelecting(page);
	await tiles(page).first().click();
	await expect(count(page)).toHaveText('1 SELECTED');
	await page.reload();
	await expect(tiles(page).first()).toBeVisible();
	await expect(count(page)).toHaveCount(0);

	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const a = await titleOf(tiles(page).first());
	await tiles(page).first().click();
	await expect(count(page)).toHaveText('1 SELECTED');
	await page.getByRole('link', { name: 'Search to tick' }).click();
	await page.waitForURL(/\/search/);
	await expect(count(page).filter({ visible: true })).toHaveText('1 SELECTED');
	await page.getByRole('link', { name: 'Back to library' }).click();
	await expect(tiles(page).first()).toBeVisible();
	await expect(count(page)).toHaveText('1 SELECTED');
	await expect(tiles(page).filter({ hasText: a }).first().locator('.open')).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	// ✕ ends it, and the next trip to the search starts with none.
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await expect(count(page)).toHaveCount(0);
	await page.getByRole('link', { name: 'Search', exact: true }).click();
	await page.waitForURL(/\/search/);
	await expect(page.locator('.selected-count')).toHaveCount(0);
});

/**
 * SELECT ALL on a library longer than one page (c737): the pages never loaded
 * are ticked by id, and their facts are read by id (POST /api/library), so
 * SHOW lists every series and GROUP counts them all. Its own install (a port
 * from the OS, the seed plus 130 series titled to sort after it, past the
 * grid's 120-tile page), since the shared seed is one page and the cases
 * delete and hide.
 */
test.describe('SELECT ALL past one page (c737)', () => {
	const dbPath = join(tmpdir(), `tsundoku-e2e-select-all-${process.pid}.sqlite`);
	const library = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-select-all-'));
	let server: ChildProcess | null = null;
	let base = '';
	const LOTS = 130;
	const lot = (n: number) => `Zz Lot ${String(n).padStart(3, '0')}`;
	const sql = (q: string, ...args: unknown[]) => {
		const db = new Database(dbPath);
		try {
			db.prepare(q).run(...args);
		} finally {
			db.close();
		}
	};
	/** POSTs to the by-id read, counted. */
	const reads = (page: Page) => {
		const seen: string[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/library') seen.push(r.url());
		});
		return seen;
	};
	async function selectAllOnTitles(page: Page): Promise<number> {
		await page.goto(`${base}/?sort=title`);
		await expect(tiles(page).first()).toBeVisible();
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await page.getByRole('button', { name: 'SELECT ALL' }).click();
		await expect(count(page)).not.toHaveText('0 SELECTED');
		// The loaded pages first, then every id the shelf holds.
		await expect
			.poll(async () => Number((await count(page).textContent())!.split(' ')[0]))
			.toBeGreaterThan(120);
		return Number((await count(page).textContent())!.split(' ')[0]);
	}

	test.beforeAll(async () => {
		test.setTimeout(120_000);
		const port = await new Promise<number>((ok, no) => {
			const probe = tcpServer();
			probe.once('error', no);
			probe.listen(0, '127.0.0.1', () => {
				const { port } = probe.address() as AddressInfo;
				probe.close(() => ok(port));
			});
		});
		base = `http://localhost:${port}`;
		rmSync(dbPath, { force: true });
		execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
			env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
			stdio: 'pipe'
		});
		const db = new Database(dbPath);
		try {
			const now = Date.now();
			const root = (db.prepare('SELECT MIN(id) AS id FROM roots').get() as { id: number }).id;
			const add = db.prepare(
				`INSERT INTO series (root_id, title, kind, hue, added_at, indexed_at)
				VALUES (?, ?, 'manga', 0, ?, ?)`
			);
			for (let n = 1; n <= LOTS; n++) add.run(root, lot(n), now - n, now);
		} finally {
			db.close();
		}
		server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				ENGINE_URL: 'http://127.0.0.1:1',
				ENGINE_TOKEN: 'e2e-engine-token',
				ENGINE_STORE: library,
				TSUNDOKU_ANILIST: 'off',
				LIBRARY_ROOT: library,
				COVER_DIR: join(library, 'covers'),
				BACKUP_DIR: join(library, 'backups')
			},
			stdio: 'ignore'
		});
		for (let i = 0; i < 120; i++) {
			try {
				if ((await fetch(base, { redirect: 'manual' })).status) return;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		throw new Error('the select-all preview never answered');
	});

	test.afterAll(() => {
		server?.kill();
		rmSync(dbPath, { force: true });
		rmSync(library, { recursive: true, force: true });
	});

	test('SHOW lists every series SELECT ALL took, GROUP counts them all, and one read serves both, twice', async ({
		page
	}) => {
		const asked = reads(page);
		const n = await selectAllOnTitles(page);
		// The grid drew one page: the rest were never on screen.
		expect(await tiles(page).count()).toBeLessThan(n);
		await page.getByRole('button', { name: 'SHOW', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'The selection' });
		await expect(sheet.locator('.show-row')).toHaveCount(n);
		// In the order they were ticked: SELECT ALL's ids come in the shelf's order.
		await expect(sheet.locator('.show-row .a').last()).toHaveText(lot(LOTS));
		await expect(sheet.locator('.show-unseen')).toHaveCount(0);
		await sheet.getByRole('button', { name: 'DONE' }).click();
		// SHOW again: listed at once, nothing asked again.
		await page.getByRole('button', { name: 'SHOW', exact: true }).click();
		await expect(sheet.locator('.show-row')).toHaveCount(n);
		await sheet.getByRole('button', { name: 'DONE' }).click();

		await page.getByRole('button', { name: 'GROUP', exact: true }).click();
		const group = page.getByRole('dialog', { name: 'Group into a series' });
		await expect(group.locator('.h-title')).toHaveText(new RegExp(`^GROUP ${n} `));
		await group.getByRole('button', { name: 'CANCEL' }).click();
		expect(asked).toHaveLength(1);
	});

	test('GROUP tapped while SELECT ALL’s own read is still out waits for it, and counts them all', async ({
		page
	}) => {
		// SELECT ALL's read held, as a slow answer over Wi-Fi would be: GROUP
		// is tapped before it lands, so its wait must be for that read.
		let release: () => void = () => {};
		const held = new Promise<void>((r) => (release = r));
		let posted = 0;
		await page.route('**/api/library', async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			posted++;
			await held;
			await route.continue();
		});
		const n = await selectAllOnTitles(page);
		await expect.poll(() => posted).toBe(1);
		await page.getByRole('button', { name: 'GROUP', exact: true }).click();
		const group = page.getByRole('dialog', { name: 'Group into a series' });
		release();
		await expect(group.locator('.h-title')).toHaveText(new RegExp(`^GROUP ${n} `));
		// The title follows the rows handed down; the sheet's own rows and
		// ticks are taken once, on open, and are what GROUP posts.
		await expect(group.locator('.rows .row')).toHaveCount(n);
		await expect(group.locator('input[type="hidden"][name="series"]')).toHaveCount(n);
		await group.getByRole('button', { name: 'CANCEL' }).click();
		expect(posted).toBe(1);
	});

	/*
	 * SELECT ALL's own id read held (`GET /api/library?…&ids=1`), the first of
	 * its two requests (wave 34's review): every case below taps while that
	 * GET is out, where wave 34's round-2 case held the POST behind it and so
	 * tapped after the window. The held route is answered by the case.
	 */
	const isIdRead = (url: URL) =>
		url.pathname === '/api/library' && url.searchParams.get('ids') === '1';
	const sel = (page: Page) => count(page).textContent();
	const groupSheet = (page: Page) => page.getByRole('dialog', { name: 'Group into a series' });
	const tapGroup = (page: Page) => page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const tapDelete = (page: Page) =>
		page.getByRole('toolbar').getByRole('button', { name: 'DELETE' }).click();
	/** GROUP's title, its rows and the fields it posts are all `n`. */
	async function expectGroupOf(page: Page, n: number) {
		const group = groupSheet(page);
		await expect(group.locator('.h-title')).toHaveText(new RegExp(`^GROUP ${n} `));
		await expect(group.locator('.rows .row')).toHaveCount(n);
		await expect(group.locator('input[type="hidden"][name="series"]')).toHaveCount(n);
		await group.getByRole('button', { name: 'CANCEL' }).click();
		await expect(group).toHaveCount(0);
	}
	/** A late answer has nothing to wait on but itself, so let it land and run. */
	async function letItLand(route: Route, page: Page) {
		const landed = page.waitForResponse((r) => isIdRead(new URL(r.url())));
		await route.continue();
		await (await landed).finished();
		await page.evaluate(() => new Promise((ok) => setTimeout(ok, 100)));
	}
	/**
	 * SELECT ALL pressed with its id read held: `loaded` is what the bar counts
	 * while it is out, `n` what the same read answers when asked directly.
	 */
	async function selectAllHeld(page: Page, presses = 1) {
		const out: Route[] = [];
		await page.route(isIdRead, (route) => void out.push(route));
		await page.goto(`${base}/?sort=title`);
		await expect(tiles(page).first()).toBeVisible();
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		for (let i = 1; i <= presses; i++) {
			await page.getByRole('button', { name: 'SELECT ALL' }).click();
			await expect.poll(() => out.length).toBe(i);
		}
		const loaded = Number((await sel(page))!.split(' ')[0]);
		const answer = await page.request.get(out[0].request().url());
		const n = ((await answer.json()) as { ids: number[] }).ids.length;
		expect(n).toBeGreaterThan(loaded);
		return { out, loaded, n };
	}

	test('GROUP tapped while the id GET itself is out opens on every series once it lands', async ({
		page
	}) => {
		const { out, n } = await selectAllHeld(page);
		await tapGroup(page);
		// Held: nothing to list yet, so the sheet is not drawn on the loaded rows.
		await expect(groupSheet(page)).toHaveCount(0);
		await out[0].continue();
		await expectGroupOf(page, n);
	});

	test('DELETE tapped while the id GET is out asks about every series', async ({ page }) => {
		const { out, n } = await selectAllHeld(page);
		await tapDelete(page);
		await expect(page.getByRole('dialog', { name: /DELETE \d+ SERIES/ })).toHaveCount(0);
		await out[0].continue();
		const ask = page.getByRole('dialog', { name: new RegExp(`DELETE ${n} SERIES`) });
		await expect(ask).toBeVisible();
		await expect(ask.locator('input[type="hidden"][name="id"]')).toHaveCount(n);
		await ask.getByRole('button', { name: 'CANCEL' }).click();
		await expect(ask).toHaveCount(0);
	});

	test('the Works HIDE sheet tapped while the id GET is out counts every series', async ({
		page
	}) => {
		// A Work that sorts first, so its tile is on the loaded page and HIDE is
		// the button that asks first (W4); past the loaded pages HIDE is a plain
		// submit (measured: this file's Work titled to sort last drew no tile here).
		const db = new Database(dbPath);
		const work = (() => {
			try {
				const id = Number(
					db
						.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES ('0 Run', ?, 'hand')`)
						.run(Date.now()).lastInsertRowid
				);
				const part = db.prepare(
					`INSERT INTO work_series (work_id, series_id, position)
					VALUES (?, (SELECT id FROM series WHERE title = ?), ?)`
				);
				part.run(id, lot(1), 1);
				part.run(id, lot(2), 2);
				return id;
			} finally {
				db.close();
			}
		})();
		try {
			const { out, n } = await selectAllHeld(page);
			await expect(page.locator('.tile.work')).toHaveCount(1);
			await page.getByRole('toolbar').getByRole('button', { name: 'HIDE', exact: true }).click();
			const ask = page.getByRole('dialog', { name: 'Hide' });
			await expect(ask).toHaveCount(0);
			await out[0].continue();
			await expect(ask.locator('.h-title .t')).toHaveText(`HIDE ${n} SERIES?`);
			await ask.getByRole('button', { name: 'CANCEL' }).click();
			await expect(ask).toHaveCount(0);
		} finally {
			sql(`DELETE FROM works WHERE id = ?`, work);
		}
	});

	test('✕ while the id GET is out: its answer changes nothing, and a tap left waiting opens nothing', async ({
		page
	}) => {
		const asked = reads(page);
		const { out } = await selectAllHeld(page);
		await tapGroup(page);
		await page.getByRole('button', { name: 'Stop selecting' }).click();
		await expect(count(page)).toHaveCount(0);
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await expect(count(page)).toHaveText('0 SELECTED');
		await letItLand(out[0], page);
		await expect(count(page)).toHaveText('0 SELECTED');
		await expect(groupSheet(page)).toHaveCount(0);
		expect(asked).toHaveLength(0);
	});

	test('a new SELECT does not wait for the last selection’s read, still held', async ({ page }) => {
		const { out } = await selectAllHeld(page);
		await page.getByRole('button', { name: 'Stop selecting' }).click();
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await expect(count(page)).toHaveText('0 SELECTED');
		await tiles(page).first().click();
		await expect(count(page)).toHaveText('1 SELECTED');
		await tapGroup(page);
		await expectGroupOf(page, 1);
		await letItLand(out[0], page);
		await expect(count(page)).toHaveText('1 SELECTED');
	});

	test('the id GET failing: GROUP stops waiting and opens on what is selected, the loaded series', async ({
		page
	}) => {
		const { out, loaded } = await selectAllHeld(page);
		await tapGroup(page);
		await expect(groupSheet(page)).toHaveCount(0);
		await out[0].abort();
		await expectGroupOf(page, loaded);
		await expect(count(page)).toHaveText(`${loaded} SELECTED`);
	});

	test('SELECT ALL pressed twice while the first GET is held: GROUP waits for both, and reads once', async ({
		page
	}) => {
		const asked = reads(page);
		const { out, n } = await selectAllHeld(page, 2);
		await tapGroup(page);
		// The second answers first and adds nothing, as a press on a narrower
		// shelf would: the first is still out, and it is the one with the ids.
		await out[1].fulfill({ json: { ids: [] } });
		await out[1].request().response();
		await page.evaluate(() => new Promise((ok) => setTimeout(ok, 100)));
		await expect(groupSheet(page)).toHaveCount(0);
		await out[0].continue();
		await expectGroupOf(page, n);
		await expect(count(page)).toHaveText(`${n} SELECTED`);
		expect(asked).toHaveLength(1);
	});

	test('SHOW opened while the id GET is out lists every series once it lands', async ({ page }) => {
		const { out, loaded, n } = await selectAllHeld(page);
		await page.getByRole('button', { name: 'SHOW', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'The selection' });
		await expect(sheet.locator('.show-row')).toHaveCount(loaded);
		await out[0].continue();
		await expect(sheet.locator('.show-row')).toHaveCount(n);
		await sheet.getByRole('button', { name: 'DONE' }).click();
	});

	test('a tile unticked while the id GET is out stays unticked when the ids land', async ({
		page
	}) => {
		const { out, n } = await selectAllHeld(page);
		const first = tiles(page).first();
		await first.click();
		await expect(first.locator('.open')).toHaveAttribute('aria-pressed', 'false');
		await out[0].continue();
		await expect(count(page)).toHaveText(`${n - 1} SELECTED`);
		await expect(first.locator('.open')).toHaveAttribute('aria-pressed', 'false');
	});

	test('of two taps made while the id GET is out, the last one opens', async ({ page }) => {
		const { out, n } = await selectAllHeld(page);
		await tapGroup(page);
		await tapDelete(page);
		await out[0].continue();
		const ask = page.getByRole('dialog', { name: new RegExp(`DELETE ${n} SERIES`) });
		await expect(ask).toBeVisible();
		await expect(groupSheet(page)).toHaveCount(0);
		await ask.getByRole('button', { name: 'CANCEL' }).click();
	});

	test('SHOW tapped after GROUP while the id GET is out: SHOW opens, and GROUP does not over it', async ({
		page
	}) => {
		const { out, n } = await selectAllHeld(page);
		await tapGroup(page);
		await page.getByRole('button', { name: 'SHOW', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'The selection' });
		await expect(sheet).toBeVisible();
		await out[0].continue();
		await expect(sheet.locator('.show-row')).toHaveCount(n);
		await expect(groupSheet(page)).toHaveCount(0);
		await sheet.getByRole('button', { name: 'DONE' }).click();
	});

	test('leaving for the search while the id GET is out carries what the bar read, and its late answer adds nothing', async ({
		page
	}) => {
		const { out, loaded } = await selectAllHeld(page);
		await page.getByRole('link', { name: 'Search to tick' }).click();
		await page.waitForURL(/\/search/);
		await expect(count(page).filter({ visible: true })).toHaveText(`${loaded} SELECTED`);
		await letItLand(out[0], page);
		await page.getByRole('link', { name: 'Back to library' }).click();
		await expect(tiles(page).first()).toBeVisible();
		await expect(count(page)).toHaveText(`${loaded} SELECTED`);
		await tapGroup(page);
		await expectGroupOf(page, loaded);
	});

	test('a series deleted, and one hidden, between SELECT ALL and the read are taken out and said so', async ({
		page
	}) => {
		// The read held until both have happened, as a slow answer would be.
		let release: () => void = () => {};
		const held = new Promise<void>((r) => (release = r));
		await page.route('**/api/library', async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			await held;
			await route.continue();
		});
		const n = await selectAllOnTitles(page);
		// The last two by title: on a page the grid never loaded.
		const [gone, hidden] = [lot(LOTS), lot(LOTS - 1)];
		await expect(tiles(page).filter({ hasText: gone })).toHaveCount(0);
		sql(`DELETE FROM series WHERE title = ?`, gone);
		sql(`UPDATE series SET hidden = 1 WHERE title = ?`, hidden);
		await page.getByRole('button', { name: 'SHOW', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'The selection' });
		await expect(sheet.getByRole('status')).toContainText('MORE FROM SELECT ALL · LOADING');
		release();
		await expect(sheet.locator('.show-unseen')).toHaveText(
			'2 GONE OR HIDDEN SINCE SELECT ALL · TAKEN OUT'
		);
		await expect(sheet.locator('.show-row')).toHaveCount(n - 2);
		await expect(sheet.locator('.show-row .a').filter({ hasText: gone })).toHaveCount(0);
		await expect(sheet.locator('.show-row .a').filter({ hasText: hidden })).toHaveCount(0);
		await sheet.getByRole('button', { name: 'DONE' }).click();
		await expect(count(page)).toHaveText(`${n - 2} SELECTED`);
		await page.getByRole('button', { name: 'Stop selecting' }).click();
		sql(`UPDATE series SET hidden = 0 WHERE title = ?`, hidden);
		const db = new Database(dbPath);
		try {
			const root = (db.prepare('SELECT MIN(id) AS id FROM roots').get() as { id: number }).id;
			db.prepare(
				`INSERT INTO series (root_id, title, kind, hue, added_at, indexed_at)
				VALUES (?, ?, 'manga', 0, ?, ?)`
			).run(root, gone, Date.now(), Date.now());
		} finally {
			db.close();
		}
	});

	test('hidden means hidden: an id asked for under reveal answers, and after reveal is off answers nothing', async ({
		page
	}) => {
		const id = (() => {
			const db = new Database(dbPath);
			try {
				return (db.prepare('SELECT id FROM series WHERE title = ?').get(lot(3)) as { id: number })
					.id;
			} finally {
				db.close();
			}
		})();
		sql(`UPDATE series SET hidden = 1 WHERE id = ?`, id);
		try {
			/** The cards answered, and the ids the server names missing. */
			const ask = async () => {
				const got = (await (
					await page.request.post(`${base}/api/library`, { data: { ids: [id] } })
				).json()) as { series: { id: number }[]; missing: number[] };
				return { cards: got.series.map((c) => c.id), missing: got.missing };
			};
			expect(await ask()).toEqual({ cards: [], missing: [id] });
			// Reveal on, through the search's own command.
			await page.goto(`${base}/search`);
			await page.locator('input[type="search"]').fill('/reveal');
			await page.locator('input[type="search"]').press('Enter');
			await page.waitForURL(new RegExp(`^${base}/$`));
			expect(await ask()).toEqual({ cards: [id], missing: [] });
			await page.goto(`${base}/search`);
			await page.locator('input[type="search"]').fill('/hide');
			await page.locator('input[type="search"]').press('Enter');
			await page.waitForURL(new RegExp(`^${base}/$`));
			expect(await ask()).toEqual({ cards: [], missing: [id] });
		} finally {
			sql(`UPDATE series SET hidden = 0 WHERE id = ?`, id);
		}
	});
});
