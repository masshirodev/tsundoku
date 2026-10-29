import { expect, test, type Page } from '@playwright/test';
import { SOURCES } from './browse-world';

/**
 * Reading online on the other devices (card c168; Online Calls 1C, 1D and
 * board 5): the preview and the series rows at phone width and in the
 * landscape panel, and the RECORD row's own measurements. The fresh
 * preview's frame is pinned by the generated browse-preview-frame.e2e.ts;
 * these are the hand-written additions it can't reach (a record, other
 * viewports). The numbers are the handoff's literals, pinned so a tidy-up
 * can't round them away.
 */

const preview = (n: number) =>
	`/downloads/source/${SOURCES.open.id}~${Buffer.from(`/s${SOURCES.open.id}/p1-${n}`).toString('base64url')}`;
const css = (page: Page, sel: string, prop: string) =>
	page
		.locator(sel)
		.first()
		.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe('the phone (Online Calls 1C)', () => {
	test.use({ viewport: { width: 360, height: 780 } });

	test('the bar keeps both cells, + ADD short; 56px cells and 52px rows', async ({ page }) => {
		await page.goto(preview(7));
		await expect(page.locator('.cta-go .cta')).toContainText('▶ READ CH. 1');
		await expect(page.locator('.add .short')).toBeVisible();
		await expect(page.locator('.add .long')).toBeHidden();
		expect(await css(page, '.cta-go .cta', 'height')).toBe('56px');
		expect(await css(page, '.add', 'height')).toBe('56px');
		expect(await css(page, '.list .ch', 'height')).toBe('52px');
	});
});

test.describe('tablet landscape (board 5A)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('the 440px panel beside the list, + ADD shortened', async ({ page }) => {
		await page.goto(preview(8));
		expect(await css(page, '.panel', 'width')).toBe('440px');
		// Each row fills the list's column, not just its title (reported 2026-10-29).
		const [list, row] = await Promise.all([
			page.locator('.list').evaluate((el) => el.getBoundingClientRect().width),
			page
				.locator('.list .ch')
				.first()
				.evaluate((el) => el.getBoundingClientRect().width)
		]);
		expect(row).toBe(list);
		await expect(page.locator('.add .short')).toBeVisible();
		expect(await css(page, '.cta-go .cta', 'height')).toBe('64px');
	});
});

test('a record’s RECORD row is 68px with FORGET its cell, and the series rows’ ↓ is 72px (1B, 2A)', async ({
	page
}) => {
	test.setTimeout(60_000);
	await page.goto(preview(9));
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await page.goto(preview(9));
	const record = page.locator('.row.record');
	await expect(record).toBeVisible();
	expect(await css(page, '.row.record', 'min-height')).toBe('68px');
	await expect(record.getByRole('button', { name: 'FORGET' })).toBeVisible();
	// Added, its chapters' ↓ cells are 72px on the tablet.
	await page.getByRole('button', { name: /ADD TO LIBRARY/ }).click();
	await expect(page).toHaveURL(/\/series\/\d+/);
	expect(await css(page, '.dl-cell', 'width')).toBe('72px');
});
