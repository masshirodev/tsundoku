import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * The text reader on a TV: its chrome (c241) -- OK brings it up as a focus row,
 * the pad reaches READING, and LAYOUT changes by keys alone -- and its end page,
 * which takes the pad as the image reader's does (c280: a novel's last volume
 * is EndPage, so its cells are the Work's block, the rating and the foot).
 * Read-only: it reads in incognito, so no progress is written (the LAYOUT it
 * changes is put back).
 *
 * It reads Mushoku Tensei, which no flow file removes from the library:
 * history-flow removes one of its history rows and undoes it, and series-layout
 * reads its series frame; neither groups or ungroups it. Villainess Level 99
 * would not do: volumes-flow groups it away mid-run, in a project that runs
 * beside `tv` on the same database.
 */

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function open(page: import('@playwright/test').Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Mushoku Tensei' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('link', { name: /READ AGAIN|CONTINUE|START|▶/ })
		.first()
		.click();
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
}

test('OK brings the chrome as a focus row, and READING changes LAYOUT by keys', async ({
	page
}) => {
	await open(page);
	const reader = page.locator('.text-reader');
	const chromeUp = () => reader.evaluate((n) => !n.hasAttribute('data-focus-off'));

	expect(await chromeUp()).toBe(false);

	// OK shows the chrome and puts the pad on the scrubber.
	await page.keyboard.press('Enter');
	const scrub = page.locator('.text-reader footer .track');
	await expect(scrub).toBeVisible();
	await expect(scrub).toBeFocused();
	expect(await chromeUp()).toBe(true);

	// ↓ reaches the cells, and READING is the widest of them.
	await page.keyboard.press('ArrowDown');
	const reading = page.locator('.text-reader footer .cell.grow');
	await expect(reading).toBeFocused();

	// OK opens READING, where the pad lands on the layout in use.
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet).toBeVisible();
	// The panel keeps the TV's 48px right side (Sheet.svelte): its ✕ ends there,
	// not at the screen edge inside the overscan.
	const panel = (await sheet.boundingBox())!;
	const close = (await sheet.getByRole('button', { name: 'Close' }).boundingBox())!;
	expect(panel.x + panel.width - (close.x + close.width)).toBeGreaterThanOrEqual(47);
	const paged = sheet.getByRole('radio', { name: 'PAGED' });
	const scroll = sheet.getByRole('radio', { name: 'SCROLL' });
	const started = (await paged.getAttribute('aria-checked')) === 'true' ? paged : scroll;
	await expect(started).toBeFocused();
	const other = started === paged ? scroll : paged;
	const label = other === paged ? 'PAGED' : 'SCROLL';

	// ← → move along the row, and OK takes the other layout.
	await page.keyboard.press(started === paged ? 'ArrowRight' : 'ArrowLeft');
	await expect(other).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(other).toHaveAttribute('aria-checked', 'true');

	// BACK closes READING; the footer comes back with the pad on its scrubber,
	// and the chrome says what the layout now is.
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(scrub).toBeFocused();
	await expect(reading).toContainText(label);

	// BACK again hides the chrome, and the reader has its own keys back.
	await page.keyboard.press('Escape');
	await expect(page.locator('.text-reader header.top')).toHaveCount(0);
	expect(await chromeUp()).toBe(false);

	// Put it back the way it was found, by keys alone.
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowDown');
	await expect(reading).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(sheet).toBeVisible();
	await expect(other).toBeFocused();
	await page.keyboard.press(other === paged ? 'ArrowRight' : 'ArrowLeft');
	await expect(started).toBeFocused();
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect(reading).toContainText(started === paged ? 'PAGED' : 'SCROLL');
});

test('a sheet on its way out keeps no keys: ↓ at once after BACK reaches the cells (c445)', async ({
	page
}) => {
	await open(page);
	await page.keyboard.press('Enter');
	const scrub = page.locator('.text-reader footer .track');
	await expect(scrub).toBeFocused();
	await page.keyboard.press('ArrowDown');
	const reading = page.locator('.text-reader footer .cell.grow');
	await expect(reading).toBeFocused();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet).toBeVisible();
	await sheet.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)))
	);
	// BACK and ↓ in one go, inside the sheet's 180 ms exit: while it leaves it
	// is inert, and an inert sheet that kept the scope swallowed the arrow.
	await page.evaluate(() => {
		const key = (k: string) => {
			const init = { key: k, bubbles: true, cancelable: true };
			document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', init));
			document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', init));
		};
		key('Escape');
		return new Promise<void>((r) =>
			requestAnimationFrame(() => requestAnimationFrame(() => (key('ArrowDown'), r())))
		);
	});
	await expect(sheet).toHaveCount(0);
	await expect(reading).toBeFocused();
});

test('CONTENTS is a focus scope: OK lands on a row, and BACK gives the pad back to the cell (c250)', async ({
	page
}) => {
	await open(page);
	await page.keyboard.press('Enter');
	const scrub = page.locator('.text-reader footer .track');
	await expect(scrub).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('.text-reader footer .cell.grow')).toBeFocused();
	// CONTENTS is the cell left of READING (TextChrome: prev, CONTENTS, READING, next).
	const cell = page.locator('.text-reader footer .cell', { hasText: 'CONTENTS' });
	await page.keyboard.press('ArrowLeft');
	await expect(cell).toBeFocused();
	await page.keyboard.press('Enter');
	const panel = page.locator('.text-reader .contents');
	await expect(panel).toBeVisible();
	// The pad is inside, on a chapter row -- the one being read -- not on the
	// cell the panel now covers.
	const row = panel.locator('.entry-btn:focus');
	await expect(row).toHaveCount(1);
	const read = await page.evaluate(() => location.pathname.match(/\/read\/(\d+)/)?.[1]);
	await expect(panel.locator(`#entry-${read} .entry-btn`)).toBeFocused();
	// The arrows stay inside: ↓ moves to the next row, still in the panel.
	await page.keyboard.press('ArrowDown');
	await expect(panel.locator('.entry-btn:focus')).toHaveCount(1);
	// BACK closes it and the pad is on CONTENTS again, as soon as the panel leaves.
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
	await expect(cell).toBeFocused();
	// ...and it still walks the chrome: → is READING.
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.text-reader footer .cell.grow')).toBeFocused();
});

test('the end of the book takes the pad: its cells are reachable, as the image reader’s are', async ({
	page
}) => {
	await open(page);
	const reader = page.locator('.text-reader');
	const end = page.locator('[data-end-page]');
	// L→R: → turns forward, and past the last page it is the end page (a novel's
	// last volume is EndPage, so the Work's block and the rating are cells there).
	for (let i = 0; i < 500 && (await end.count()) === 0; i++) {
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(20);
	}
	await expect(end).toBeVisible({ timeout: 15_000 });
	// The end page lifts the reader's opt-out, as the image reader's has since
	// c235: before it, every arrow was the reader's.
	expect(await reader.evaluate((n) => n.hasAttribute('data-focus-off'))).toBe(false);
	await page.keyboard.press('ArrowDown');
	const cell = await page.evaluate(
		() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
	);
	expect(cell).toMatch(/SERIES|LIBRARY|RATE|FAV/i);
});

// ---- a novel downloaded so far (c251) ---------------------------------------------------
//
// A volume that isn't the last ends on TextScreen's END · LAST AVAILABLE, naming the chapter
// that isn't downloaded. The shared seed has every novel chapter downloaded, so this block
// runs its own preview on its own seeded database, where only each novel's first chapter is
// available, on a port the OS gives. Mushoku Tensei is rated (no ask), Tensei Shitara Ken
// Deshita is not (the rating and FAV are asked).

test.describe('the end of what is downloaded (c251)', () => {
	// Made in beforeAll, not at load: `playwright test --list` loads this file too.
	let work = '';
	let dbPath = '';
	let library = '';
	let preview: ChildProcess | null = null;
	let base = '';
	const first: Record<string, number> = {};

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
		work = mkdtempSync(
			join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-tv-text-end-')
		);
		dbPath = join(work, 'tv-text-end.sqlite');
		library = join(work, 'library');
		execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
			env: { ...process.env, DATABASE_PATH: dbPath, LIBRARY_ROOT: library, NODE_NO_WARNINGS: '1' },
			stdio: 'pipe'
		});
		const db = new Database(dbPath);
		try {
			for (const title of ['Mushoku Tensei', 'Tensei Shitara Ken Deshita']) {
				const { id } = db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as {
					id: number;
				};
				db.prepare(`UPDATE entries SET available = 0 WHERE series_id = ? AND position > 1`).run(id);
				first[title] = (
					db
						.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY position LIMIT 1`)
						.get(id) as { id: number }
				).id;
			}
		} finally {
			db.close();
		}
		const port = await freePort();
		base = `http://localhost:${port}`;
		preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				LIBRARY_ROOT: library,
				TSUNDOKU_HOME: join(work, 'home'),
				BACKUP_DIR: join(work, 'backups'),
				TSUNDOKU_ANILIST: 'off'
			},
			stdio: 'ignore'
		});
		for (let i = 0; i < 120; i++) {
			try {
				if ((await fetch(`${base}/`, { redirect: 'manual' })).status) return;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		throw new Error('the TV text end preview never answered');
	});

	test.afterAll(() => {
		preview?.kill();
		if (work) rmSync(work, { recursive: true, force: true });
	});

	async function finish(page: import('@playwright/test').Page, title: string) {
		await page.goto(`${base}/read/${first[title]}`);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
		const end = page.getByText('END · LAST AVAILABLE');
		for (let i = 0; i < 500 && (await end.count()) === 0; i++) {
			await page.keyboard.press('ArrowRight');
			await page.waitForTimeout(20);
		}
		await expect(end).toBeVisible();
		await expect(page.getByText('CH. 2 IS NOT DOWNLOADED')).toBeVisible();
		// The reader lifts its opt-out at the end (c241/W6), on this branch too.
		expect(
			await page.locator('.text-reader').evaluate((n) => n.hasAttribute('data-focus-off'))
		).toBe(false);
	}

	const focused = (page: import('@playwright/test').Page) =>
		page.evaluate(() => {
			const a = document.activeElement as HTMLElement | null;
			return {
				text: a?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
				mark: a?.getAttribute('data-focus-mark') ?? null
			};
		});

	test('rated: ↓ reaches ← SERIES, → LIBRARY, both marked inside, and OK leaves', async ({
		page
	}) => {
		await finish(page, 'Mushoku Tensei');
		await page.keyboard.press('ArrowDown');
		expect(await focused(page)).toEqual({ text: '← SERIES', mark: 'in' });
		await page.keyboard.press('ArrowRight');
		expect(await focused(page)).toEqual({ text: 'LIBRARY', mark: 'in' });
		// It responds: OK on LIBRARY leaves the finished book for the library.
		await page.keyboard.press('Enter');
		await page.waitForURL((u) => !u.pathname.startsWith('/read/'));
	});

	test('unrated: ↓ walks the rating, FAV and the foot, and OK on FAV switches it', async ({
		page
	}) => {
		await finish(page, 'Tensei Shitara Ken Deshita');
		// The first arrow lands on the screen's top-left stop: the rating's first cell.
		await page.keyboard.press('ArrowDown');
		await expect(page.locator('.screen .ask')).toContainText('FAV');
		expect(await page.evaluate(() => !!document.activeElement?.closest('.screen .ask'))).toBe(true);
		await page.keyboard.press('ArrowDown');
		const fav = page.locator('.screen').getByRole('switch');
		await expect(fav).toBeFocused();
		await expect(fav).toHaveAttribute('data-focus-mark', 'in');
		await expect(fav).toHaveAttribute('aria-checked', 'false');
		await page.keyboard.press('Enter');
		await expect(fav).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('ArrowDown');
		expect(await focused(page)).toEqual({ text: '← SERIES', mark: 'in' });
	});
});
