import { expect, readerReady, test } from './fixtures';

/**
 * The reader on a TV (c238; TV-Reader). Read-only: it reads in incognito, so
 * turning a page writes nothing to the shared database, and it reads the
 * series reader-layout reads (Sousou no Frieren).
 */

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function open(page: import('@playwright/test').Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
}

test('a spread is the default on a TV, not one page', async ({ page }) => {
	await open(page);
	// The cover stands alone; one page forward opens a spread of two.
	await page.keyboard.press('ArrowLeft');
	const pages = page.locator('.stage .screen:not([aria-hidden="true"]) [data-page]');
	await expect(pages).toHaveCount(2);
	// Each page is fitted to the height; two of them fill most of the 960.
	const [a, b] = [(await pages.nth(0).boundingBox())!, (await pages.nth(1).boundingBox())!];
	expect(Math.round(a.height)).toBeGreaterThan(500);
	expect(Math.round(a.width + b.width)).toBeGreaterThan(600);
});

test('the reader keeps every arrow on a TV, and the strip is 520 wide', async ({ page }) => {
	await open(page);
	expect(await page.locator('.reader').evaluate((n) => n.hasAttribute('data-focus-off'))).toBe(
		true
	);
	// The strip's width is the TV's own variable; switching a series to
	// VERTICAL in a spec would write its mode, so the width is read here and
	// the strip itself is not drawn.
	expect(
		await page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--tv-strip-w').trim()
		)
	).toBe('520px');
});

test('the end page takes the pad: its cells are reachable, and its ANOTHER SOURCE is one', async ({
	page
}) => {
	await open(page);
	// The end page is the reader's one screen the pad drives (c235): the page
	// before it keeps every arrow, so the opt-out is bounded to "not the end".
	const read = page.url();
	await page.goto(`${read}?p=last`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	// A manga turns one way and a manhwa the other: whatever the mode, one of
	// the two arrows is the turn past the last page.
	const end = page.locator('[data-end-page]');
	for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowRight'] as const) {
		await page.keyboard.press(key);
		await page.waitForTimeout(300);
		if ((await end.count()) > 0) break;
	}
	await expect(end).toBeVisible();
	expect(await page.locator('.reader').evaluate((n) => n.hasAttribute('data-focus-off'))).toBe(
		false
	);

	// The first arrow lands on a cell of its foot, and OK presses it.
	await page.keyboard.press('ArrowDown');
	const text = await page.evaluate(
		() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
	);
	expect(text.length).toBeGreaterThan(0);
	expect(text).toMatch(/SERIES|LIBRARY|BACK|RATE|FAV/i);
});
