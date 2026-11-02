import { expect, test } from './fixtures';

/**
 * The text reader's chrome on a TV (c241): OK brings it up as a focus row, the
 * pad reaches READING, and LAYOUT changes by keys alone. Read-only: it reads in
 * incognito, so no progress is written (the LAYOUT it changes is put back).
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
