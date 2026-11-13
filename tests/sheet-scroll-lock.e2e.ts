import { expect, test } from './fixtures';

/**
 * The page holds still under an open sheet (src/lib/scroll-lock.ts): the
 * owner could scroll the library behind MORE on a phone (2026-11-13). Every
 * sheet is the one Sheet component, so MORE stands for all of them. Read-only:
 * the sheet is only opened and closed. The desktop has the sidebar and no MORE
 * cell, so it skips.
 */

test('the library does not scroll under MORE, and scrolls again once it closes', async ({
	page
}, info) => {
	test.skip(info.project.name === 'desktop', 'The desktop has the sidebar: no MORE cell');
	const width = page.viewportSize()!.width;
	await page.setViewportSize({ width, height: 600 });
	await page.goto('/');
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	const pageTop = () => page.evaluate(() => window.scrollY);

	await page.locator('[data-focus-id="library-more"]').click();
	const sheet = page.getByRole('dialog', { name: 'More' });
	await expect(sheet).toBeVisible();
	const before = await pageTop();

	// Over the scrim, above the sheet: where the owner's finger was.
	await page.mouse.move(width / 2, 40);
	await page.mouse.wheel(0, 600);
	// The lock itself, since a wheel alone can't speak for a touch drag on the phone.
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe(
		'hidden'
	);
	await page.waitForTimeout(150);
	expect(await pageTop()).toBe(before);

	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toBeHidden();
	expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
	await page.mouse.wheel(0, 600);
	await expect.poll(pageTop).toBeGreaterThan(before);
});
