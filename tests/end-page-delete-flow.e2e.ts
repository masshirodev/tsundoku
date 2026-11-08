import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * DELETE on the reader's end page (c655; doc/DELETING.md): the series screen's
 * own door and confirmation, then the library, from the paged end page, the
 * strip's and the novel's. Runs in tablet-portrait on a seeded database and an
 * OS port of its own, the `works-flow` arrangement, because it really deletes
 * series, which no spec on the shared seed can afford.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.use({ serviceWorkers: 'block' });

const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-end-delete-${process.pid}.sqlite`);
const wipe = () => {
	for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
};
let server: ChildProcess | null = null;
let db: Database.Database;

test.use({ baseURL: base });

test.beforeAll(async () => {
	// Seed, spawn and first answer: past the default 30 s on a loaded box.
	test.setTimeout(120_000);
	wipe();
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-end-delete-empty-${process.pid}`),
			TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-end-delete-home-${process.pid}`)
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 240; i++) {
		try {
			if ((await fetch(`${base}/login`)).ok) break;
		} catch {
			// Not listening yet.
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	db = new Database(dbPath);
	db.pragma('busy_timeout = 5000');
});

test.afterAll(() => {
	db?.close();
	server?.kill();
	wipe();
});

const seriesOf = (title: string) =>
	db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number } | undefined;
const lastEntry = (series: number) =>
	(
		db
			.prepare(
				`SELECT id FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position DESC LIMIT 1`
			)
			.get(series) as { id: number }
	).id;

const endPage = (page: Page) => page.locator('[data-end-page]');
const askOf = (page: Page, title: string) =>
	page.getByRole('dialog', { name: `DELETE ${title.toUpperCase()}?` });

/** The paged end page's door: the last page, then one turn forward (the seed's manga read R→L). */
async function pagedEnd(page: Page, entry: number) {
	await page.goto(`/read/${entry}?p=last`);
	await expect(page.locator('.reader')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
	await page.waitForLoadState('networkidle');
	await page.keyboard.press('ArrowLeft');
	await expect(endPage(page).getByText('END · LAST AVAILABLE')).toBeVisible();
}

/** What the confirmation is asked and answered with, whichever end page drew it. */
async function deleteFromEnd(page: Page, title: string) {
	await endPage(page).getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, title);
	await expect(ask).toBeVisible();
	await expect(ask).toBeInViewport();
	await ask.getByRole('button', { name: 'DELETE', exact: true }).click();
	await expect(page).toHaveURL(`${base}/`);
	await expect.poll(() => seriesOf(title)).toBeUndefined();
	await expect(page.locator('.grid .tile', { hasText: title })).toHaveCount(0);
}

test('the paged end page asks first: CANCEL keeps it, DELETE lands on the library (c655)', async ({
	page
}) => {
	const title = 'Isekai Ojisan';
	const { id } = seriesOf(title)!;
	// Into the reader the way a reader comes: the library is in this tab's trail.
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	await pagedEnd(page, lastEntry(id));

	const end = endPage(page);
	await expect(end.getByRole('button', { name: 'HIDE', exact: true })).toHaveCount(0);
	await end.getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, title);
	await expect(ask).toBeVisible();
	await expect(ask.getByText('ITS READING HISTORY GOES WITH IT.')).toBeVisible();
	await ask.getByRole('button', { name: 'CANCEL', exact: true }).click();
	await expect(ask).toHaveCount(0);
	await expect(end.locator('.big')).toHaveText(title);
	expect(seriesOf(title)).toBeDefined();

	await deleteFromEnd(page, title);
});

test('the strip’s end page deletes too, and opened with no library behind it lands there (c655)', async ({
	page
}) => {
	const title = 'The Greatest Estate Developer';
	const { id } = seriesOf(title)!;
	await page.goto(`/read/${lastEntry(id)}`);
	await expect(page.locator('.reader')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
	await expect(page.locator('[data-page]').first()).toBeVisible({ timeout: 15_000 });
	await endPage(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await expect(endPage(page).getByText('END · LAST AVAILABLE')).toBeVisible();
	await deleteFromEnd(page, title);
});

test('the novel’s end page says what stays, deletes, and its highlight is kept (c655, c701)', async ({
	page
}) => {
	const title = 'Honzuki no Gekokujou';
	const { id } = seriesOf(title)!;
	const entry = lastEntry(id);
	db.prepare(
		`INSERT INTO highlights (kind, series_id, entry_id, origin_key, number, block, block_offset,
			quote, series_title, series_kind, entry_label, made_at)
		VALUES ('quote', ?, ?, 'sample:h', 33, 0, 0, 'kept words', ?, 'novel', 'Vol. 33', 1)`
	).run(id, entry, title);

	await page.goto(`/read/${entry}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	const v = page.viewportSize()!;
	await page.mouse.click(v.width / 2, 30);
	const track = page.locator('[role="slider"][aria-label="Page in chapter"]');
	await expect(track).toBeVisible();
	const box = (await track.boundingBox())!;
	await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
	await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
	await expect(page.locator('.bottom .left')).toHaveText(/^P\. (\d+) OF \1\b/);
	await page.keyboard.press('Escape');
	await expect(page.locator('.bottom')).toHaveCount(0);
	await page.mouse.click(v.width - 8, v.height / 2);
	await expect(endPage(page).getByText('END · LAST AVAILABLE')).toBeVisible();

	await endPage(page).getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, title);
	await expect(ask.locator('[data-highlights-kept]')).toContainText('1 HIGHLIGHT IS KEPT');
	await ask.getByRole('button', { name: 'DELETE', exact: true }).click();
	await expect(page).toHaveURL(`${base}/`);
	await expect.poll(() => seriesOf(title)).toBeUndefined();
	expect(
		db.prepare(`SELECT series_id FROM highlights WHERE quote = 'kept words'`).get()
	).toBeDefined();
});

test('a part of a Work deletes as the series screen does: the Work keeps its other parts (c655)', async ({
	page
}) => {
	const [title, b, c] = ['Dungeon Meshi', 'Tower of God', 'Lookism'];
	const ids = [title, b, c].map((t) => seriesOf(t)!.id);
	const work = Number(
		db.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES ('Run', 1, 'hand')`).run()
			.lastInsertRowid
	);
	ids.forEach((s, i) =>
		db
			.prepare(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`)
			.run(work, s, i + 1)
	);
	await pagedEndOfPart(page, lastEntry(ids[0]));
	await endPage(page).getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, title);
	await ask.getByRole('button', { name: 'DELETE', exact: true }).click();
	await expect(page).toHaveURL(`${base}/`);
	await expect.poll(() => seriesOf(title)).toBeUndefined();
	expect(
		db
			.prepare(`SELECT series_id AS s FROM work_series WHERE work_id = ? ORDER BY position`)
			.all(work)
	).toEqual([{ s: ids[1] }, { s: ids[2] }]);
});

/** A part's end names the series that ended when the Work carries on, not LAST AVAILABLE. */
async function pagedEndOfPart(page: Page, entry: number) {
	await page.goto(`/read/${entry}?p=last`);
	await expect(page.locator('.reader')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
	await page.waitForLoadState('networkidle');
	await page.keyboard.press('ArrowLeft');
	await expect(endPage(page).getByText(/^END · DUNGEON MESHI$/)).toBeVisible();
}

test('a hidden series read under /reveal offers UNHIDE beside DELETE, and DELETE takes it (c655, c673)', async ({
	page
}) => {
	const title = 'Chainsaw Man';
	const { id } = seriesOf(title)!;
	const hidden = await page.request.post(`${base}/series/${id}?/hide`, {
		headers: { origin: base, 'x-sveltekit-action': 'true' },
		form: { on: '1' }
	});
	expect(hidden.ok()).toBe(true);
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
	await pagedEnd(page, lastEntry(id));
	await expect(endPage(page).getByRole('button', { name: 'UNHIDE', exact: true })).toBeVisible();
	await deleteFromEnd(page, title);
});

test('a tap at the edge of the page, on DELETE’s row or sheet, does not turn the page (c655)', async ({
	page
}) => {
	const title = 'Mushoku Tensei';
	const novel = seriesOf(title)!.id;
	await page.goto(`/read/${lastEntry(novel)}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	const v = page.viewportSize()!;
	await page.mouse.click(v.width / 2, 30);
	const track = page.locator('[role="slider"][aria-label="Page in chapter"]');
	const box = (await track.boundingBox())!;
	await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
	await expect(page.locator('.bottom .left')).toHaveText(/^P\. (\d+) OF \1\b/);
	await page.keyboard.press('Escape');
	await expect(page.locator('.bottom')).toHaveCount(0);
	await page.mouse.click(v.width - 8, v.height / 2);
	const end = endPage(page);
	await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
	const del = end.getByRole('button', { name: 'DELETE', exact: true });
	const b = (await del.boundingBox())!;
	// The button's own left edge, inside the reader's ‹ tap zone.
	await page.mouse.click(b.x + 4, b.y + b.height / 2);
	const ask = askOf(page, title);
	await expect(ask).toBeVisible();
	await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
	// An arrow is the sheet's while it is up, not a turn off the end page.
	await page.keyboard.press('ArrowLeft');
	await expect(ask).toBeVisible();
	await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
	await ask.getByRole('button', { name: 'CANCEL', exact: true }).click();
	await expect(ask).toHaveCount(0);
	await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
	expect(seriesOf(title)).toBeDefined();
});

test('a refused DELETE says so in the row, and the series stays (c655)', async ({ page }) => {
	const title = 'Sousou no Frieren';
	const { id } = seriesOf(title)!;
	await page.route(/\/series\/\d+\?\/delete$/, (route) =>
		route.fulfill({
			status: 500,
			contentType: 'application/json',
			body: JSON.stringify({ type: 'error', status: 500, error: { message: 'no' } })
		})
	);
	await pagedEnd(page, lastEntry(id));
	await endPage(page).getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, title);
	await ask.getByRole('button', { name: 'DELETE', exact: true }).click();
	await expect(endPage(page).getByRole('alert')).toHaveText('COULD NOT SAVE');
	await expect(ask).toHaveCount(0);
	await expect(endPage(page).getByRole('button', { name: 'DELETE', exact: true })).toBeEnabled();
	expect(seriesOf(title)).toBeDefined();
});
