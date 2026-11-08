/**
 * The library's SELECT outlives the shelf, the kind and the filter it was
 * made on (c698): a series ticked out of sight stays ticked, SHOW lists the
 * whole selection to review or untick, and GROUP takes what SHOW lists, not
 * only the tiles on screen. A flow file, so it runs once, in
 * tablet-portrait; it only opens sheets and cancels them, so the shared seed
 * is left as it was.
 */
import { type Locator, type Page } from '@playwright/test';
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
