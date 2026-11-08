import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The clip cells on a TV's bar (c704; Anime.dc.html A9): MARK IN and MARK OUT
 * after +10, KEEP takes the pad once there's a range, the row stays eight cells
 * because ← EP. gives way, BACK drops the range before it closes the bar, and a
 * remote's seek keys still seek. On the browse server's anime, in the `tv`
 * project, with its own episode's rows removed after each case.
 */
const BROWSE = `http://localhost:${process.env.PLAYWRIGHT_BROWSE_PORT ?? '4194'}`;
test.use({ baseURL: BROWSE, serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial', timeout: 60_000 });

function dbPath() {
	const dir = process.env.TMPDIR!;
	const file = readdirSync(dir).find((f) => /^tsundoku-e2e-browse-.*\.sqlite$/.test(f));
	if (!file) throw new Error(`no browse database in ${dir}`);
	return join(dir, file);
}
const entry = (() => {
	const db = new Database(dbPath(), { readonly: true });
	try {
		return (
			db
				.prepare(
					`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
					WHERE s.title = 'Tsukiakari no Ryokōsha' AND e.season = 2 AND e.episode_number = 3`
				)
				.get() as { id: number }
		).id;
	} finally {
		db.close();
	}
})();
test.afterEach(() => {
	const db = new Database(dbPath());
	try {
		db.prepare(`DELETE FROM highlights WHERE kind = 'clip' AND entry_id = ?`).run(entry);
	} finally {
		db.close();
	}
});

const cells = (page: Page) => page.locator('.bottom .cells > :visible');
async function open(page: Page) {
	await page.goto(`/read/${entry}`);
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && v.duration > 7 && v.readyState >= 2;
		},
		undefined,
		{ timeout: 30_000 }
	);
	await page.evaluate(() => document.querySelector('video')!.pause());
	await expect(page.locator('.player')).toHaveClass(/chrome/);
}
async function at(page: Page, seconds: number) {
	await page.evaluate((t) => (document.querySelector('video')!.currentTime = t), seconds);
	await expect
		.poll(() => page.locator('.scrubrow .e').textContent())
		.toBe(`0:${String(seconds).padStart(2, '0')}`);
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('.player')).toHaveClass(/chrome/);
}

test('MARK IN and MARK OUT sit after +10, and KEEP takes the pad once there’s a range: eight cells', async ({
	page
}) => {
	await open(page);
	const before = await cells(page).allTextContents();
	expect(before.slice(0, 6).map((t) => t.trim())).toEqual([
		expect.anything(),
		'−10',
		'+10',
		expect.stringMatching(/^← EP/),
		'MARK IN',
		'MARK OUT'
	]);
	await at(page, 1);
	await page.locator('.cells .cell', { hasText: 'MARK IN' }).click();
	await at(page, 3);
	await expect(page.locator('[data-clip-keep]')).toBeFocused();
	await expect(cells(page)).toHaveCount(8);
	const after = (await cells(page).allTextContents()).map((t) => t.trim());
	expect(after).not.toContain('✕');
	expect(after.some((t) => t.startsWith('← EP'))).toBe(false);
	expect(after).toContain('KEEP 0:02');
});

test('BACK drops the range before it closes the bar', async ({ page }) => {
	await open(page);
	await at(page, 1);
	await page.locator('.cells .cell', { hasText: 'MARK IN' }).click();
	await at(page, 2);
	await page.keyboard.press('Escape');
	await expect(page.locator('.cells .cell', { hasText: 'MARK IN' })).toBeVisible();
	await expect(page.locator('.scrubrow .track .mr')).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/read/${entry}$`));
	await expect(page.locator('.player')).toHaveClass(/chrome/);
});

test('a remote’s ⏪ ⏩ still seek, and do not mark', async ({ page }) => {
	await open(page);
	await at(page, 2);
	await page.evaluate(() =>
		window.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'MediaFastForward', cancelable: true })
		)
	);
	await expect
		.poll(() => page.evaluate(() => document.querySelector('video')!.currentTime))
		.toBeGreaterThan(5);
	await expect(page.locator('.cells .cell', { hasText: 'MARK IN' })).toBeVisible();
	await expect(page.locator('.scrubrow .track .mr')).toHaveCount(0);
});
