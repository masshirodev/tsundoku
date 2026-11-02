import { expect, test } from './fixtures';

/**
 * The series screen on a TV (c238; TV-Series). Read-only: the one key it
 * presses is ← at the bottom of an unrated rating, which saves nothing
 * because the value does not change (0 stays 0).
 */

async function open(page: import('@playwright/test').Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Tower of God' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: 'Tower of God' })).toBeVisible();
}

test('the first arrow lands on ▶ CONTINUE', async ({ page }) => {
	await open(page);
	await page.keyboard.press('ArrowDown');
	const onContinue = await page.evaluate(() => document.activeElement?.closest('.cta') !== null);
	expect(onContinue).toBe(true);
});

test('RATING keeps ← →: the value moves, the mark does not walk the halves', async ({ page }) => {
	await open(page);
	// The first half-cell, unrated. ← at 0 is a no-op, so the database is safe.
	const first = page.locator('.rs .half').first();
	await first.focus();
	expect(await page.locator('.rs .half[aria-pressed="true"]').count()).toBe(0);
	await page.keyboard.press('ArrowLeft');
	// The focus layer let the rating have the key: focus is still on the same
	// half-cell, and still unrated.
	expect(
		await page.evaluate(() => document.activeElement?.classList.contains('half') ?? false)
	).toBe(true);
	expect(await page.locator('.rs .half[aria-pressed="true"]').count()).toBe(0);
	// The row says it owns ← → (src/lib/focus/dom.ts, keepsArrow).
	expect(
		await page.locator('.rs .track').evaluate((n) => n.hasAttribute('data-focus-adjust'))
	).toBe(true);
});
