import { expect, test } from './fixtures';

/**
 * On a TV a screen arrives at once (doc/MOTION.md, "Screens"; doc/TV.md):
 * the remote moves a key at a time, and the ten-foot layout answers a key
 * at once.
 */
test('a TV opens the next screen with nothing moving', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile a, .grid .tile button').first().press('Enter');
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.locator('.main > .route-view > *').first()).toHaveCSS('animation-name', 'none');
});
