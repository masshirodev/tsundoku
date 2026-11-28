import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Clips on a TV: it shows the kept ranges and makes none. Its bar stays the
 * eight cells it was (MARK IN and MARK OUT beside them do not fit 960 px with
 * the stream's label whole, doc/HIGHLIGHTS.md "Limits"), I, O and ENTER mark
 * nothing, a kept clip's box is on the scrubber and is no stop for the pad,
 * and a remote's seek keys still seek. Runs in `tv` (`tv-*.e2e.ts`, 960x540,
 * no pointer), on the browse server's anime with its own episode, whose clip
 * rows are removed after each case.
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
function episode(): { id: number; series: number } {
	const db = new Database(dbPath(), { readonly: true });
	try {
		return db
			.prepare(
				`SELECT e.id, e.series_id AS series FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.title = 'Tsukiakari no Ryokōsha' AND e.season = 2 AND e.episode_number = 3`
			)
			.get() as { id: number; series: number };
	} finally {
		db.close();
	}
}
// In a hook, not at load: `--list` collects this file with no browse world up.
let entry = 0;
let series = 0;
test.beforeAll(() => {
	({ id: entry, series } = episode());
});
/** A clip kept on another device: its row, as the lane writes one. */
function keptClip(from: number, to: number) {
	const db = new Database(dbPath());
	try {
		db.prepare(
			`INSERT INTO highlights (kind, series_id, entry_id, number, season, clip_in, clip_out,
				series_title, series_kind, entry_label, made_at)
			VALUES ('clip', ?, ?, 3, 2, ?, ?, 'Tsukiakari no Ryokōsha', 'anime', 'Ep. 3', ?)`
		).run(series, entry, from, to, Date.now());
	} finally {
		db.close();
	}
}
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

test('the bar keeps its eight cells and offers no MARK IN, and I, O and ENTER mark nothing', async ({
	page
}) => {
	await open(page);
	const row = (await cells(page).allTextContents()).map((t) => t.trim());
	expect(row).toHaveLength(8);
	expect(row.slice(1, 6)).toEqual(['−1m', '−10', '+10', '+1m', expect.stringMatching(/^← EP/)]);
	expect(row.some((t) => /MARK|KEEP|^IN ·/.test(t))).toBe(false);
	// The keys a desktop marks with, from the picture's own handler: M after
	// them shows the handler took the letters, and nothing was marked.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	for (const key of ['i', 'o', 'Enter']) await page.keyboard.press(key);
	await page.keyboard.press('m');
	await expect(page.locator('video')).toHaveJSProperty('muted', true);
	await expect(page.locator('.scrubrow .track .in-mark, .scrubrow .track .mr')).toHaveCount(0);
	await expect(page.locator('.clipband')).toHaveCount(0);
	await page.keyboard.press('m');
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
	await expect(page.locator('.scrubrow .track .in-mark, .scrubrow .track .mr')).toHaveCount(0);
});

test('a clip kept elsewhere shows on the scrubber, is no stop: ↑ lands on the track, and ← → still seek over its box', async ({
	page
}) => {
	keptClip(1, 3);
	await open(page);
	await expect(page.locator('.scrubrow .track .kr:not(.dash)')).toHaveCount(1);
	await at(page, 2);
	await page.locator('.cells .cell', { hasText: /^← EP/ }).focus();
	const track = page.locator('.scrubrow .track');
	await page.keyboard.press('ArrowUp');
	await expect(track).toBeFocused();
	// ← first, and an 8 s episode: → from here is the end card, which takes the pad.
	await page.keyboard.press('ArrowLeft');
	await expect(track).toBeFocused();
	await expect
		.poll(() => page.evaluate(() => document.querySelector('video')!.currentTime))
		.toBeLessThan(2);
	const before = await page.evaluate(() => document.querySelector('video')!.currentTime);
	await page.keyboard.press('ArrowRight');
	await expect
		.poll(() => page.evaluate(() => document.querySelector('video')!.currentTime))
		.toBeGreaterThan(before);
});
