import { type Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';

/**
 * The reader end to end (doc/READER.md), on the seed library's generated
 * sample pages. Serial, tablet-portrait only. This file owns Hikaru ga
 * Shinda Natsu (paged), The Greatest Estate Developer (vertical) and
 * Chainsaw Man (end of series), and restores what it changes.
 */
test.describe.configure({ mode: 'serial' });

async function seriesId(page: Page, title: string) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	return Number(page.url().match(/\/series\/(\d+)/)![1]);
}

/** Tap at a fraction of the screen's width, mid-height: a finger, not a mouse (mouseAction). */
async function tap(page: Page, x: number) {
	const vp = page.viewportSize()!;
	await page.touchscreen.tap(vp.width * x, vp.height / 2);
}

const meta = (page: Page) => page.locator('header[aria-label="Reader"] .meta');

test('CONTINUE opens the reader where the chapter was left', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await expect(page.locator('[data-page]')).toHaveCount(1);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
});

test('the middle shows the controls; in R→L the left edge turns forward', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const entry = page.url().match(/\/read\/(\d+)/)![1];
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');

	await tap(page, 0.5);
	await expect(meta(page)).toContainText('P. 3 OF');
	await tap(page, 0.5);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);

	await tap(page, 0.05);
	await tap(page, 0.5);
	await expect(meta(page)).toContainText('P. 4 OF');
	await tap(page, 0.5);
	await tap(page, 0.95);
	await tap(page, 0.5);
	await expect(meta(page)).toContainText('P. 3 OF');
});

test('with a mouse, a click turns forward and a right click back, in R→L as in L→R', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	const entry = page.url().match(/\/read\/(\d+)/)![1];
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const vp = page.viewportSize()!;
	// Anywhere, the middle included: the buttons, not the side, say which way.
	await page.mouse.click(vp.width * 0.5, vp.height / 2);
	await page.mouse.click(vp.width * 0.95, vp.height / 2);
	await expect(page).toHaveURL(/p=5/);
	await page.mouse.click(vp.width * 0.05, vp.height / 2, { button: 'right' });
	await expect(page).toHaveURL(/p=4/);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	await page.mouse.click(vp.width * 0.5, vp.height / 2, { button: 'middle' });
	await expect(meta(page)).toContainText('P. 4 OF');
});

test('the last page leads to the chapter boundary, and a tap on into the next chapter', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const first = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	await page.goto(`${first}?p=last`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await tap(page, 0.05);
	await expect(page.getByText(/^END · CH\. \d+$/)).toBeVisible();
	await expect(page.getByText('← TAP OR SWIPE TO CONTINUE')).toBeVisible();
	const before = page.url();
	await tap(page, 0.05);
	await expect(page).not.toHaveURL(before);
	await expect(page).toHaveURL(/\/read\/\d+/);
});

test('progress is saved: a reload resumes on the same page', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const href = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	await page.goto(`${href}?p=5`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	// Settled on a page: the page event goes out and the URL keeps it.
	await expect(page).toHaveURL(/p=5/, { timeout: 5000 });
	await page.goto(href!);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await tap(page, 0.5);
	await expect(meta(page)).toContainText('P. 5 OF');
});

test('the READING sheet switches mode for the session and offers REMEMBER', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await tap(page, 0.5);
	await page.getByRole('button', { name: /R→L · FIT SCREEN/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet.getByText('SERIES DEFAULT R→L')).toBeVisible();
	await sheet.getByRole('radio', { name: 'L→R' }).click();
	await expect(sheet.getByRole('button', { name: 'REMEMBER L→R' })).toBeVisible();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.getByRole('button', { name: /L→R · FIT SCREEN/ })).toBeVisible();
	// In L→R the right edge turns forward. The controls are still up.
	const now = await meta(page).textContent();
	await tap(page, 0.5);
	await tap(page, 0.95);
	await tap(page, 0.5);
	await expect(meta(page)).not.toHaveText(now!);
});

test('vertical scroll: pages stitched, a ruled band, then the next chapter', async ({ page }) => {
	await seriesId(page, 'The Greatest Estate Developer');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const before = page.url().replace(/\?.*$/, '');
	await expect(page.locator('.strip')).toBeVisible();
	await page.evaluate(() => document.querySelector('.band')?.scrollIntoView({ block: 'center' }));
	await expect(page.getByText('↓ KEEP SCROLLING')).toBeVisible();
	for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
	await expect(page).not.toHaveURL(new RegExp(`^${before}(\\?|$)`), { timeout: 5000 });
});

test('the end of the series asks for a rating while unrated, and it saves', async ({ page }) => {
	const id = await seriesId(page, 'Chainsaw Man');
	const rate = (n: number) =>
		page.request.post(`/series/${id}?/rate`, {
			headers: { origin: 'http://localhost:4183', 'x-sveltekit-action': 'true' },
			form: { rating: String(n) }
		});
	await rate(0);
	// The last chapter: its row is the last entry in the list.
	await page.goto(`/series/${id}`);
	await page.getByRole('button', { name: 'Go to chapter number' }).click();
	await page.getByLabel('GO TO #').fill('200');
	await page.keyboard.press('Enter');
	await page.locator('.entry:has(.num:text-is("200")) .entry-btn').click();
	await readerReady(page);
	const entry = page.url().match(/\/read\/(\d+)/)![1];
	await page.goto(`/read/${entry}?p=last`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await tap(page, 0.05);
	await expect(page.getByText('END · LAST AVAILABLE')).toBeVisible();
	await expect(page.getByText('SHOWN WHILE UNRATED · RATING SAVES ON TAP')).toBeVisible();
	await page.getByRole('button', { name: 'Rate 4' }).click();
	await page.goto(`/series/${id}`);
	await expect(
		page.getByRole('region', { name: 'About this series' }).getByRole('button', { name: 'Rate 4' })
	).toHaveAttribute('aria-pressed', 'true');
});

test('incognito shows a dashed rule, INCOGNITO, and NOT SAVED', async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await expect(page.locator('.dashed')).toBeVisible();
	await tap(page, 0.5);
	await expect(page.getByRole('banner', { name: 'Reader' }).getByText('INCOGNITO')).toBeVisible();
	await expect(meta(page)).toContainText('NOT SAVED');
});
