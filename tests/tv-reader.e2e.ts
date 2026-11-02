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

test('OK brings the chrome as a focus row, and READING opens, changes the mode, and goes back', async ({
	page
}) => {
	await open(page);
	const reader = page.locator('.reader');
	const chromeUp = () => reader.evaluate((n) => !n.hasAttribute('data-focus-off'));

	// The chrome is hidden, so the arrows are the reader's and the layer is out.
	expect(await chromeUp()).toBe(false);

	// OK shows it and puts the pad on the scrubber (TV-Reader 7D).
	await page.keyboard.press('Enter');
	const scrub = page.locator('footer[aria-label="Reader controls"] .track');
	await expect(scrub).toBeVisible();
	await expect(scrub).toBeFocused();
	expect(await chromeUp()).toBe(true);

	// ↓ reaches the cells: READING is the widest, and says the mode in use.
	await page.keyboard.press('ArrowDown');
	const reading = page.locator('footer[aria-label="Reader controls"] .cell.grow');
	await expect(reading).toBeFocused();
	await expect(reading).toContainText('R→L');

	// OK opens READING, where the pad lands on the mode in use.
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('radio', { name: 'R→L' })).toBeFocused();

	// ← → walk the row, and OK takes the new mode.
	await page.keyboard.press('ArrowRight');
	const ltr = sheet.getByRole('radio', { name: 'L→R' });
	await expect(ltr).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(ltr).toHaveAttribute('aria-checked', 'true');

	// BACK closes READING and gives the pad back to its cell...
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(reading).toBeFocused();
	await expect(reading).toContainText('L→R');

	// ...and BACK again hides the chrome, and the arrows are the reader's again.
	await page.keyboard.press('Escape');
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	expect(await chromeUp()).toBe(false);

	// Put the mode back, by keys alone: R→L as the series has it.
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowDown');
	await expect(reading).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('radio', { name: 'L→R' })).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(sheet.getByRole('radio', { name: 'R→L' })).toBeFocused();
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect(reading).toContainText('R→L');
});
