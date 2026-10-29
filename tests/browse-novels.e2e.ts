import { test, expect } from './fixtures';
import { resetEngine } from './browse-world';

/**
 * A novel from an LNReader plugin, end to end (doc/NOVELS.md,
 * "Downloading"; card c150): added from BROWSE, two of its three chapters
 * downloaded through the real plugin host into its EPUB, imported onto the
 * series ADD made, and read in the text reader up to the chapter that isn't
 * downloaded. The plugin is tests/fixtures/lnreader/shelf.js, installed by
 * tests/browse-setup.ts; it needs no network.
 */

test.beforeEach(async () => {
	await resetEngine();
});

test('a novel is added, downloaded into its EPUB chapter by chapter, and read up to what’s there', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.goto('/browse/ln:shelf');
	await page.locator('.grid .tile', { hasText: 'The Quiet Shelf' }).click();
	await expect(page).toHaveURL(/\/downloads\/source\/ln:shelf~/);
	const add = page.getByRole('button', { name: /ADD TO LIBRARY/ });
	await expect(add).toContainText('3 CHAPTERS');
	await add.click();
	await expect(page).toHaveURL(/\/series\/\d+\?added=/);
	const series = page.url().replace(/\?.*$/, '');

	// A novel's DOWNLOAD row: the same cells as a manga's, and no FOLLOW yet (c151).
	const dl = page.locator('.dl-row');
	await expect(dl.locator('.lcs.inline .lc').first()).toHaveText('FIRST 3');
	await expect(dl).not.toContainText('FOLLOW');

	// Two chapters, a tap each: queued in the one queue, downloaded by the novel worker.
	const row = (title: string) => page.locator('[id^="entry-"]', { hasText: title });
	for (const t of ['Dust', 'Light']) {
		await row(t).locator('.entry-btn').click();
		await expect(row(t).locator('.status .long')).toHaveText(/QUEUED|DOWNLOADING|IMPORTING/);
	}
	await expect(async () => {
		await page.reload();
		await expect(row('Light').locator('.status .long')).toHaveText('IMPORTING');
	}).toPass({ timeout: 30_000 });
	// The app's own import follows twenty seconds on; START SCAN doesn't wait.
	expect((await page.request.post('/api/scan')).status()).toBeLessThan(300);
	await expect(async () => {
		await page.goto(series);
		await expect(row('Dust').locator('.status .long')).toHaveText('');
		await expect(row('Light').locator('.status .long')).toHaveText('');
	}).toPass({ timeout: 30_000 });
	await expect(row('Rain').locator('.status .long')).toHaveText('NOT DOWNLOADED');
	await expect(page.locator('.file-meta')).toContainText('2 OF 3 DOWNLOADED');

	// Read: the chapter's own text, nothing of the site's page, and on into the next.
	await row('Dust').locator('.entry-btn').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await expect(page.locator('.blocks')).toContainText('Line 1 of chapter 1');
	await expect(page.locator('.blocks')).not.toContainText('track()');
	await expect(async () => {
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('.blocks')).toContainText('Line 1 of chapter 2', { timeout: 500 });
	}).toPass({ timeout: 15_000 });
	await expect(page.locator('.blocks')).not.toContainText('chapter 1,');
	// Chapter 3 isn't downloaded: reading ends there, and says which.
	const end = page.locator('.screen', { hasText: 'END · LAST AVAILABLE' });
	await expect(async () => {
		await page.keyboard.press('ArrowRight');
		await expect(end).toBeVisible({ timeout: 500 });
	}).toPass({ timeout: 15_000 });
	await expect(end).toContainText('2 OF 3');
	await expect(end).toContainText('CH. 3 IS NOT DOWNLOADED');

	// Opened directly, the missing chapter says so instead of failing to find a file.
	await page.goto(series);
	const rain = await row('Rain').getAttribute('id');
	await page.goto(`/read/${rain!.replace('entry-', '')}`);
	await expect(page.locator('.screen')).toContainText('CH. 3 IS NOT DOWNLOADED');
	await expect(page.locator('.screen')).toContainText('Only part of this novel is downloaded');
});
