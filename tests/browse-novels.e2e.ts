import { test, expect } from './fixtures';
import { resetEngine } from './browse-world';

/**
 * A novel from an LNReader plugin, end to end (doc/NOVELS.md,
 * "Downloading"; card c150): added from BROWSE, two of its three chapters
 * downloaded through the real plugin host into its EPUB, imported onto the
 * series ADD made, read in the text reader up to the chapter that isn't
 * downloaded, and followed (c151). The plugin is tests/fixtures/lnreader/shelf.js, installed by
 * tests/browse-setup.ts; it needs no network.
 */

test.beforeEach(async () => {
	await resetEngine();
});

test('a novel is added, downloaded into its EPUB chapter by chapter, and read on, online, past what’s there', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.goto('/browse/ln:shelf');
	await page.locator('.grid .tile', { hasText: 'The Quiet Shelf' }).click();
	await expect(page).toHaveURL(/\/downloads\/source\/ln:shelf~/);
	const add = page.getByRole('button', { name: /ADD TO LIBRARY/ });
	// Reading first, adding beside it (c167): every chapter reads online.
	await expect(page.locator('.cta-go .cta')).toContainText('▶ READ CH. 1');
	await expect(page.locator('.list .head')).toContainText('3 · ALL ONLINE');
	await add.click();
	await expect(page).toHaveURL(/\/series\/\d+\?added=/);
	const series = page.url().replace(/\?.*$/, '');

	// A novel's DOWNLOAD row: the same cells as a manga's, FOLLOW included (c151).
	const dl = page.locator('.dl-row');
	await expect(dl.locator('.lcs.inline .lc')).toHaveText(['FIRST 3', 'FOLLOW']);

	// Two chapters, ↓ each: queued in the one queue, downloaded by the novel worker.
	// The row itself reads online (the owner's answer to question 1, doc/BROWSING.md).
	const row = (title: string) => page.locator('[id^="entry-"]', { hasText: title });
	for (const t of ['Dust', 'Light']) {
		await row(t).locator('.dl-cell').click();
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
	await expect(row('Rain').locator('.status .long')).toHaveText('ONLINE');
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
	// Chapter 3 isn't downloaded: it reads on, online, from the plugin (c167).
	await expect(async () => {
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('.blocks')).toContainText('Line 1 of chapter 3', { timeout: 500 });
	}).toPass({ timeout: 20_000 });

	// Opened directly, the chapter with no file reads online, and isn't kept.
	await page.goto(series);
	const rain = await row('Rain').getAttribute('id');
	const rainId = rain!.replace('entry-', '');
	await page.goto(`/read/${rainId}`);
	await expect(page.locator('.blocks')).toContainText('Line 1 of chapter 3');
	const book = await page.request.get(
		`/api/series/${series.split('/').pop()}/epub?v=online&f=online:${rainId}`
	);
	expect(book.headers()['cache-control']).toBe('private, no-store');

	// FOLLOW: on, and the plugin asked at once.
	await page.goto(series);
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'FOLLOW' }).click();
	await expect(page.locator('.dl-row .lcs.inline .lc').last()).toHaveText('FOLLOWING ✓');
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'FOLLOWING ✓' }).click();
	await expect(page.locator('.dl-row .lcs.inline .lc').last()).toHaveText('FOLLOW');
});
