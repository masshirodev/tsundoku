import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { E2E_TOKEN } from '../playwright.config';
import { WHEEL_QUIET_MS } from '../src/lib/reader/reader';
import { expect, test } from './fixtures';
import { revealOn } from './helpers/reveal';

/**
 * DELETE on the reader's end page (doc/DELETING.md): the series screen's
 * own button and confirmation, then the library, from the paged end page, the
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

/** The way to the paged end page: the last page, then one turn forward (the seed's manga read R→L). */
async function pagedEnd(page: Page, entry: number) {
	await page.goto(`/read/${entry}?p=last`);
	await expect(page.locator('.reader')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
	await page.waitForLoadState('networkidle');
	await page.keyboard.press('ArrowLeft');
	await expect(endPage(page).getByText('END · LAST AVAILABLE')).toBeVisible();
}

/** A novel's last chapter, walked to its last page by the slider as a reader gets there. */
async function novelLastPage(page: Page, entry: number) {
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
	return v;
}

/** A novel's end page in PAGED: one turn past its last page. */
async function novelPagedEnd(page: Page, entry: number) {
	const v = await novelLastPage(page, entry);
	await page.mouse.click(v.width - 8, v.height / 2);
	await expect(endPage(page).getByText('END · LAST AVAILABLE')).toBeVisible();
}

/** A novel's end page in SCROLL: the layout chosen, then the wheel past the last line. */
async function novelScrollEnd(page: Page, entry: number) {
	await page.goto(`/read/${entry}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	const v = page.viewportSize()!;
	await page.mouse.click(v.width / 2, 30);
	await page.getByRole('button', { name: /^PAGED · / }).click();
	await page.getByRole('radio', { name: 'SCROLL' }).click();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	await page.keyboard.press('Escape');
	await expect(page.locator('.bottom')).toHaveCount(0);
	await page.mouse.move(v.width / 2, v.height / 2);
	const end = endPage(page).getByText('END · LAST AVAILABLE');
	for (let i = 0; i < 80 && !(await end.isVisible()); i++) {
		await page.mouse.wheel(0, 400);
		await page.waitForTimeout(60);
	}
	await expect(end).toBeVisible();
}

/**
 * `count` notches, each a gesture of its own: seen by the page, then quiet for
 * longer than `WheelTurn` waits, so a reader's handler would act on every one.
 */
async function notches(page: Page, count: number, deltaY: number) {
	const seen = () =>
		page.evaluate(() => {
			const w = window as unknown as { wheels?: number };
			if (w.wheels === undefined) {
				w.wheels = 0;
				addEventListener('wheel', () => w.wheels!++, { capture: true, passive: true });
			}
			return w.wheels;
		});
	const before = await seen();
	for (let i = 1; i <= count; i++) {
		await page.mouse.wheel(0, deltaY);
		await expect.poll(seen).toBe(before + i);
		await page.waitForTimeout(WHEEL_QUIET_MS + 50);
	}
}

/** The pointer over the open confirmation, where a reader's wheel would be. */
async function overSheet(page: Page, ask: ReturnType<typeof askOf>) {
	// Risen first: mid-rise its box still reaches past the screen's foot, and a
	// wheel at a point off the screen reaches nothing.
	await ask.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
	const b = (await ask.boundingBox())!;
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
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

test('the paged end page asks first: CANCEL keeps it, DELETE lands on the library', async ({
	page
}) => {
	const title = 'Isekai Ojisan';
	const { id } = seriesOf(title)!;
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

test('the strip’s end page deletes too, and opened with no library behind it lands there', async ({
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

test('the novel’s end page says what stays, deletes, and its highlight is kept', async ({
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

	await novelPagedEnd(page, entry);

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

test('a part of a Work deletes as the series screen does: the Work keeps its other parts', async ({
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

test('a hidden series read under /reveal offers UNHIDE beside DELETE, and DELETE takes it', async ({
	page
}) => {
	const title = 'Chainsaw Man';
	const { id } = seriesOf(title)!;
	const hidden = await page.request.post(`${base}/series/${id}?/hide`, {
		headers: { origin: base, 'x-sveltekit-action': 'true' },
		form: { on: '1' }
	});
	expect(hidden.ok()).toBe(true);
	await revealOn(page.context());
	await pagedEnd(page, lastEntry(id));
	await expect(endPage(page).getByRole('button', { name: 'UNHIDE', exact: true })).toBeVisible();
	await deleteFromEnd(page, title);
});

test('a tap at the edge of the page, on DELETE’s row or sheet, does not turn the page', async ({
	page
}) => {
	const title = 'Mushoku Tensei';
	const novel = seriesOf(title)!.id;
	await novelPagedEnd(page, lastEntry(novel));
	const end = endPage(page);
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

const WHEEL_NOVEL = 'Mushoku Tensei';

test('PAGED: the wheel over DELETE’s sheet does not turn the page under it', async ({ page }) => {
	const entry = lastEntry(seriesOf(WHEEL_NOVEL)!.id);
	await novelPagedEnd(page, entry);
	const end = endPage(page);
	await end.getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, WHEEL_NOVEL);
	await expect(ask).toBeVisible();
	await overSheet(page, ask);
	await notches(page, 3, -240);
	await expect(ask).toBeVisible();
	await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
	expect(new URL(page.url()).pathname).toBe(`/read/${entry}`);
});

test('SCROLL: the wheel over DELETE’s sheet does not leave the end page', async ({ page }) => {
	const entry = lastEntry(seriesOf(WHEEL_NOVEL)!.id);
	await novelScrollEnd(page, entry);
	const end = endPage(page);
	await end.getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, WHEEL_NOVEL);
	await expect(ask).toBeVisible();
	await overSheet(page, ask);
	await notches(page, 3, -240);
	await expect(ask).toBeVisible();
	await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
	expect(new URL(page.url()).pathname).toBe(`/read/${entry}`);
});

test('the strip stays where it is under DELETE’s sheet, and a notch eases it again after', async ({
	page
}) => {
	const title = 'Return of the Mount Hua Sect';
	await page.goto(`/read/${lastEntry(seriesOf(title)!.id)}`);
	await expect(page.locator('.strip')).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('[data-page]').first()).toBeVisible({ timeout: 15_000 });
	await page.waitForLoadState('networkidle');
	const end = endPage(page);
	await end.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
	await end.getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, title);
	await expect(ask).toBeVisible();
	await overSheet(page, ask);
	const y = () => page.evaluate(() => scrollY);
	// Settled, so whatever moves it from here is the wheel.
	await expect.poll(async () => [await y(), await y()].reduce((a, b) => a - b)).toBe(0);
	const y0 = await y();
	// `isNotch` reads device pixels: a notch of 100 is this far in CSS pixels.
	const notch = await page.evaluate(() => 100 / devicePixelRatio);
	await notches(page, 3, -notch);
	await expect(ask).toBeVisible();
	expect(await y()).toBe(y0);

	await ask.getByRole('button', { name: 'CANCEL', exact: true }).click();
	await expect(ask).toHaveCount(0);
	await notches(page, 1, -notch);
	await expect.poll(y).toBeLessThan(y0);
});

test('a sheet too tall for the screen still scrolls under the wheel, and the strip does not', async ({
	page
}) => {
	const title = 'Return of the Mount Hua Sect';
	await page.goto(`/read/${lastEntry(seriesOf(title)!.id)}`);
	await expect(page.locator('[data-page]').first()).toBeVisible({ timeout: 15_000 });
	await page.waitForLoadState('networkidle');
	const end = endPage(page);
	await end.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await end.getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, title);
	await expect(ask).toBeVisible();
	await page.setViewportSize({ width: 800, height: 260 });
	await overSheet(page, ask);
	const box = () =>
		ask.evaluate((n) => ({
			top: n.scrollTop,
			room: n.scrollHeight - n.clientHeight
		}));
	expect((await box()).room).toBeGreaterThan(0);
	const y = () => page.evaluate(() => scrollY);
	await expect.poll(async () => [await y(), await y()].reduce((a, b) => a - b)).toBe(0);
	const y0 = await y();
	await notches(page, 1, 100);
	await expect.poll(async () => (await box()).top).toBeGreaterThan(0);
	expect(await y()).toBe(y0);
	// At its foot and at its head, the wheel stops there instead of chaining on.
	await notches(page, 3, 400);
	expect(await y()).toBe(y0);
	await notches(page, 6, -400);
	await expect.poll(async () => (await box()).top).toBe(0);
	await notches(page, 2, -400);
	expect(await y()).toBe(y0);
	await expect(ask).toBeVisible();
});

for (const layout of ['PAGED', 'SCROLL'] as const) {
	test(`${layout}: once DELETE’s sheet has gone, a wheel up goes back to the text`, async ({
		page
	}) => {
		const entry = lastEntry(seriesOf(WHEEL_NOVEL)!.id);
		await (layout === 'PAGED' ? novelPagedEnd : novelScrollEnd)(page, entry);
		const end = endPage(page);
		await end.getByRole('button', { name: 'DELETE', exact: true }).click();
		const ask = askOf(page, WHEEL_NOVEL);
		await expect(ask).toBeVisible();
		await ask.getByRole('button', { name: 'CANCEL', exact: true }).click();
		// Its exit finished: the dialog is out of the page, not only closing.
		await expect(ask).toHaveCount(0);
		await notches(page, 1, -240);
		await expect(end.getByText('END · LAST AVAILABLE')).toHaveCount(0);
		await expect(page.locator('.blocks p').first()).toBeVisible();
		expect(new URL(page.url()).pathname).toBe(`/read/${entry}`);
	});
}

test('DELETE goes back over the reader to the library it was walked from', async ({ page }) => {
	const title = 'Hikaru ga Shinda Natsu';
	const { position } = db
		.prepare(`SELECT position FROM entries WHERE id = ?`)
		.get(lastEntry(seriesOf(title)!.id)) as { position: number };
	// Every step a client navigation: `page.goto` would start a document with no trail.
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.locator(`.entry:has(.num:text-is("${position}")) .entry-btn`).click();
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.reader')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
	await page.waitForLoadState('networkidle');
	const v = page.viewportSize()!;
	const track = page.locator('[role="slider"][aria-label="Page"]');
	// A touch: in this reader a mouse's click at the middle turns the page.
	await page.touchscreen.tap(v.width / 2, v.height / 2);
	await expect(track).toBeVisible();
	const box = (await track.boundingBox())!;
	// The seed's manga read R→L, so the last page is the track's left end.
	await page.mouse.click(box.x + 2, box.y + box.height / 2);
	await expect
		.poll(async () => {
			return (
				(await track.getAttribute('aria-valuenow')) === (await track.getAttribute('aria-valuemax'))
			);
		})
		.toBe(true);
	await page.keyboard.press('Escape');
	await expect(track).toHaveCount(0);
	await page.keyboard.press('ArrowLeft');
	const end = endPage(page);
	await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();

	await end.getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = askOf(page, title);
	await ask.getByRole('button', { name: 'DELETE', exact: true }).click();
	await expect(page).toHaveURL(`${base}/?sort=title`);
	await expect.poll(() => seriesOf(title)).toBeUndefined();
	await expect(page.locator('.grid .tile', { hasText: title })).toHaveCount(0);
});

test('a refused DELETE says so in the row, and the series stays', async ({ page }) => {
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
