/**
 * SELECT carried into the search and back (c698; doc/LIBRARY.md, "What ends
 * SELECT"; the handoff doc/handoffs/select-search/, Rules.dc.html): both ways
 * in, a hit that ticks, a Work's row that ticks its parts, CLEAR and SHOW over
 * the search, chips with →, and every door that keeps or ends the selection
 * (←, Android's back and the browser's forward, ✕, a bulk action's success, a
 * reload, a new tab, leaving for another screen, the commands). A flow file,
 * so it runs once, in tablet-portrait, and the phone's strip has a describe
 * at the phone's viewport. Its own preview of the build on a port from the
 * OS, on the seed plus the owner's case (three Haibara titles, two of them
 * novels) and a Work of two parts the seed lacks: GROUP here really groups,
 * which the shared seed must not see.
 */
import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as tcpServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

const dbPath = join(tmpdir(), `tsundoku-e2e-select-search-${process.pid}.sqlite`);
const library = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-select-search-'));
let server: ChildProcess | null = null;
let base = '';

const HAIBARA = 'Haibara-kun no Tsuyokute Seishun New Game';
const NOVELS = [HAIBARA, `${HAIBARA} (Web)`];
const MANGA = `${HAIBARA} (manga)`;
const WORK = 'Zelkova Saga';
const PARTS = ['Zelkova Saga: Roots', 'Zelkova Saga: Crown'];
const TAG = 'Quillon Varga';

test.describe.configure({ mode: 'serial' });

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
			VALUES (?, ?, ?, 0, ?, ?)`
		);
		const entry = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, ?, ?, ?)`
		);
		const made = (title: string, kind: string) => {
			const id = Number(add.run(root, title, kind, now, now).lastInsertRowid);
			entry.run(id, 1, 'Vol. 1', now);
			return id;
		};
		for (const t of NOVELS) made(t, 'novel');
		made(MANGA, 'manga');
		const ids = PARTS.map((t) => made(t, 'manga'));
		const work = Number(
			db
				.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES (?, ?, 'hand')`)
				.run(WORK, now).lastInsertRowid
		);
		ids.forEach((id, i) =>
			db
				.prepare(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`)
				.run(work, id, i + 1)
		);
		// A tag on the Work's parts, so a search for it draws a chip.
		const tag = Number(
			db.prepare(`INSERT INTO tags (namespace, value) VALUES ('artist', ?)`).run(TAG)
				.lastInsertRowid
		);
		for (const id of ids)
			db.prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(id, tag);
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
	throw new Error('the select-search preview never answered');
});

test.afterAll(() => {
	server?.kill();
	rmSync(dbPath, { force: true });
	rmSync(library, { recursive: true, force: true });
});

const tiles = (page: Page) => page.locator('.grid .tile');
/** The selection's count on whichever screen: the visible one (a phone's strip or the bar). */
const count = (page: Page) => page.locator('.selected-count').filter({ visible: true });
const field = (page: Page) => page.getByRole('searchbox').or(page.locator('input[type="search"]'));
const hit = (page: Page, title: string) =>
	// A row's name is its title, then its kind: "<title> NOVEL · TITLE".
	page.getByRole('checkbox', { name: new RegExp(`^${escape(title)} [A-Z]+ · `) });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The library sorted by title, SELECT on. */
async function libraryStart(page: Page, at = '/?sort=title') {
	await page.goto(`${base}${at}`);
	await expect(tiles(page).first()).toBeVisible();
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(count(page)).toHaveText('0 SELECTED');
}

/** Types into the search the way a finger does, and waits for the results to follow. */
async function typeQuery(page: Page, text: string) {
	await field(page).first().fill(text);
	await page.waitForURL(new RegExp(`q=${encodeURIComponent(text)}`));
}

test("the owner's case: search Haibara, SELECT, tick the novels, ←, and GROUP lists them all (c698)", async ({
	page
}) => {
	await page.goto(`${base}/?sort=title`);
	await expect(tiles(page).first()).toBeVisible();
	await page.getByRole('link', { name: 'Search', exact: true }).click();
	await page.waitForURL(/\/search/);
	// SELECT is shown only once a search has hits.
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toHaveCount(0);
	await typeQuery(page, 'haibara');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(count(page)).toHaveText('0 SELECTED');
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toHaveCount(0);
	await expect(page.getByText('· A TAP TICKS')).toBeVisible();

	for (const t of NOVELS) await hit(page, t).click();
	await expect(count(page)).toHaveText('2 SELECTED');
	await expect(hit(page, NOVELS[0])).toHaveAttribute('aria-checked', 'true');
	await expect(hit(page, MANGA)).toHaveAttribute('aria-checked', 'false');
	// Nothing opened the series sheet.
	await expect(page.getByRole('dialog')).toHaveCount(0);

	await page.getByRole('link', { name: 'Back to library' }).click();
	await page.waitForURL(/\/\?sort=title$/);
	await expect(count(page)).toHaveText('2 SELECTED');
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const group = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(group.locator('.h-title')).toHaveText(/^GROUP 2 /);
	// Its rows are what it posts, in the order they were ticked: the two novels, not the manga.
	await expect(group.locator('.rows .row .t')).toHaveText(NOVELS);
});

test('from the selecting bar: / keeps the ticks, CLEAR keeps them and the focus, SHOW is the same sheet, and ← brings them back to the shelf (c698)', async ({
	page
}) => {
	await libraryStart(page, '/?sort=title&kind=manga');
	const first = (await tiles(page).first().locator('.title').textContent())!.trim();
	await tiles(page).first().click();
	await expect(count(page)).toHaveText('1 SELECTED');

	await page.getByRole('link', { name: 'Search to tick' }).click();
	await page.waitForURL(/\/search/);
	// The field empty and focused, the 1 kept, the strip's SHOW live.
	await expect(field(page).first()).toBeFocused();
	await expect(field(page).first()).toHaveValue('');
	await expect(count(page)).toHaveText('1 SELECTED');

	await typeQuery(page, 'haibara');
	await hit(page, MANGA).click();
	await expect(count(page)).toHaveText('2 SELECTED');

	// CLEAR empties the field and nothing else; the field keeps focus.
	await page.getByRole('button', { name: 'CLEAR' }).click();
	await expect(field(page).first()).toHaveValue('');
	await expect(field(page).first()).toBeFocused();
	await expect(count(page)).toHaveText('2 SELECTED');

	// SHOW over the search lists both, the tile ticked in the library first.
	await typeQuery(page, 'haibara');
	await page.getByRole('button', { name: 'SHOW', exact: true }).filter({ visible: true }).click();
	const sheet = page.getByRole('dialog', { name: 'The selection' });
	await expect(sheet.locator('.show-row .a')).toHaveText([first, MANGA]);
	// Unticking there unticks the hit underneath.
	await sheet.getByRole('checkbox', { name: `Keep ${MANGA}` }).click();
	await expect(count(page)).toHaveText('1 SELECTED');
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await expect(hit(page, MANGA)).toHaveAttribute('aria-checked', 'false');
	await hit(page, MANGA).click();

	// ← is the library it came from: its kind, still selecting, the count grown.
	await page.getByRole('link', { name: 'Back to library' }).click();
	await page.waitForURL(/kind=manga/);
	await expect(count(page)).toHaveText('2 SELECTED');
	await expect(tiles(page).filter({ hasText: first }).first().locator('.open')).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	// / again is a new search, with the selection.
	await page.keyboard.press('/');
	await page.waitForURL(/\/search/);
	await expect(field(page).first()).toHaveValue('');
	await expect(count(page)).toHaveText('2 SELECTED');
});

test("Android's back and the browser's forward carry it both ways; a reload and a new tab do not (c698)", async ({
	page,
	context
}) => {
	await libraryStart(page);
	await tiles(page).first().click();
	await page.getByRole('link', { name: 'Search to tick' }).click();
	await page.waitForURL(/\/search/);
	await typeQuery(page, 'haibara');
	await hit(page, NOVELS[0]).click();
	await expect(count(page)).toHaveText('2 SELECTED');

	await page.goBack();
	await expect(tiles(page).first()).toBeVisible();
	await expect(count(page)).toHaveText('2 SELECTED');
	await page.goForward();
	await page.waitForURL(/q=haibara/);
	await expect(count(page)).toHaveText('2 SELECTED');
	await expect(hit(page, NOVELS[0])).toHaveAttribute('aria-checked', 'true');

	// A new tab of the same search arrives with no selection.
	const other = await context.newPage();
	try {
		await other.goto(page.url());
		await expect(other.locator('.hits .hit').first()).toBeVisible();
		await expect(count(other)).toHaveCount(0);
		await expect(other.getByRole('checkbox')).toHaveCount(0);
	} finally {
		await other.close();
	}

	// A reload ends it: plain hits, and SELECT offered again.
	await page.reload();
	await expect(page.locator('.hits .hit').first()).toBeVisible();
	await expect(count(page)).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toBeVisible();
});

test('a Work’s row ticks every part, says 1 OF 2 TICKED until it has them all, and a chip opens the library still selecting (c698)', async ({
	page
}) => {
	await page.goto(`${base}/search?q=zelkova`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const work = page.getByRole('checkbox', { name: new RegExp(`^${WORK}\\s+WORK`) });
	await expect(work).toHaveAttribute('aria-checked', 'false');

	await hit(page, PARTS[0]).click();
	await expect(work).toHaveAttribute('aria-checked', 'mixed');
	await expect(work.locator('.why')).toHaveText('WORK · 2 SERIES · 1 OF 2 TICKED');
	// A tap ticks the rest.
	await work.click();
	await expect(work).toHaveAttribute('aria-checked', 'true');
	await expect(work.locator('.why')).toHaveText('WORK · 2 SERIES · BOTH TICKED');
	await expect(hit(page, PARTS[1])).toHaveAttribute('aria-checked', 'true');
	await expect(count(page)).toHaveText('2 SELECTED');
	// And a tap on a wholly ticked Work unticks every part.
	await work.click();
	await expect(count(page)).toHaveText('0 SELECTED');
	await work.click();
	await expect(count(page)).toHaveText('2 SELECTED');
});

test('a chip, selecting, ends in → and opens the library at its tag with SELECT on, where SELECT ALL takes them (c698)', async ({
	page
}) => {
	await page.goto(`${base}/search?q=haibara`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await hit(page, MANGA).click();
	await typeQuery(page, 'quillon');
	await expect(page.getByText('OPEN IN THE LIBRARY, STILL SELECTING')).toBeVisible();
	const chip = page.locator('.chips a').filter({ hasText: TAG });
	await expect(chip.locator('.go')).toHaveText('→');
	await expect(count(page)).toHaveText('1 SELECTED');
	await chip.click();
	await page.waitForURL(/[?&]tag=/);
	await expect(count(page)).toHaveText('1 SELECTED');
	// The Work's tile there: SELECT ALL takes its two parts, the manga ticked before kept.
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await expect(count(page)).toHaveText('3 SELECTED');
	await page.getByRole('button', { name: 'SHOW', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'The selection' });
	await expect(sheet.locator('.show-row .a')).toHaveText([MANGA, ...PARTS]);
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await page.getByRole('button', { name: 'Stop selecting' }).click();
});

test('✕ ends SELECT on the search: plain hits, and a tap opens the sheet again (c698)', async ({
	page
}) => {
	await libraryStart(page);
	await tiles(page).first().click();
	await page.getByRole('link', { name: 'Search to tick' }).click();
	await typeQuery(page, 'haibara');
	await page.getByRole('button', { name: 'Stop selecting' }).filter({ visible: true }).click();
	await expect(count(page)).toHaveCount(0);
	await expect(page.getByRole('checkbox')).toHaveCount(0);
	await page.locator('.hits .hit').filter({ hasText: MANGA }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('link', { name: 'Back to library' }).click();
	await expect(tiles(page).first()).toBeVisible();
	await expect(count(page)).toHaveCount(0);
});

test('leaving for another screen ends it; Enter on a query does not, and /lock answers on its row as it does today (c698)', async ({
	page
}) => {
	await libraryStart(page);
	await tiles(page).first().click();
	await page.getByRole('link', { name: 'Search to tick' }).click();
	await typeQuery(page, 'haibara');
	// Enter on the query: the results stay, and so does the selection.
	await field(page).first().press('Enter');
	await expect(count(page)).toHaveText('1 SELECTED');
	await expect(hit(page, MANGA)).toBeVisible();

	// /lock answers on its COMMAND row, here, as it does without SELECT (its device
	// ceremony is unlock-gate.e2e.ts'), and the selection stays.
	await field(page).first().fill('/lock');
	await field(page).first().press('Enter');
	await expect(page.getByRole('status')).toContainText('/lock');
	await expect(count(page)).toHaveText('1 SELECTED');

	// A page command's link is a client-side way to another screen: it drops the selection.
	await field(page).first().fill('/help');
	await page.locator('a.page-cmd').click();
	await page.waitForURL(/\/help/);
	// Back to the search from there: it arrives as a plain search.
	await page.goBack();
	await expect(page).toHaveURL(/\/search/);
	await expect(page.locator('.hits .hit').first()).toBeVisible();
	await expect(count(page)).toHaveCount(0);
	await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('/reveal while selecting does what it does today: the library, revealed, not selecting (c698)', async ({
	page
}) => {
	await libraryStart(page);
	await tiles(page).first().click();
	await page.getByRole('link', { name: 'Search to tick' }).click();
	await field(page).first().fill('/reveal');
	await field(page).first().press('Enter');
	await page.waitForURL(new RegExp(`^${escape(base)}/$`));
	await expect(page.locator('.reveal-frame')).toHaveCount(1);
	await expect(count(page)).toHaveCount(0);
	// Back to hidden, so the cases after see the library as seeded.
	await page.goto(`${base}/search`);
	await field(page).first().fill('/hide');
	await field(page).first().press('Enter');
	await page.waitForURL(new RegExp(`^${escape(base)}/$`));
});

test('a bulk action’s success ends it, after a trip to the search too (c698)', async ({ page }) => {
	await page.goto(`${base}/search?q=haibara`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of NOVELS) await hit(page, t).click();
	await page.getByRole('link', { name: 'Back to library' }).click();
	await expect(count(page)).toHaveText('2 SELECTED');
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const group = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(group.locator('.rows .row')).toHaveCount(2);
	await group.locator('button.create').click();
	await expect(group).toHaveCount(0);
	await expect(count(page)).toHaveCount(0);
});

test.describe('a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('the bar reads / and ALL, and the search draws the selection as a strip under the field (c698)', async ({
		page
	}) => {
		await libraryStart(page);
		const to = page.getByRole('link', { name: 'Search to tick' });
		// What is drawn, not the text behind it: the long words are there, not shown.
		await expect(to).toHaveJSProperty('innerText', '/');
		await expect(page.getByRole('button', { name: 'SELECT ALL' })).toHaveJSProperty(
			'innerText',
			'ALL'
		);
		await tiles(page).first().click();
		await to.click();
		await page.waitForURL(/\/search/);
		const strip = page.locator('.sel.strip');
		await expect(strip).toBeVisible();
		await expect(page.locator('.sel.in-bar')).toBeHidden();
		await expect(strip.locator('.selected-count')).toHaveText('1 SELECTED');
		const box = await strip.boundingBox();
		expect(box?.height).toBe(48);
	});
});
