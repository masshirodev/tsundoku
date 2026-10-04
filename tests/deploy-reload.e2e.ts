import { test, expect } from './fixtures';

/**
 * A deploy reaches the installed app (doc/SERVING.md): an app left open
 * runs the build it loaded, so once the server's version moves, the next tap
 * loads the screen whole, from the new build. Read-only; a new deployment is
 * faked by answering the version check with another version.
 */
const marker = (page: import('@playwright/test').Page) =>
	page.evaluate(() => (window as unknown as { marker?: number }).marker);

test('after a deploy, the next tap loads the new build whole', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
	await page.route('**/_app/version.json', (r) =>
		r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'a-new-build' }) })
	);
	// The app comes back to the front: it asks, and learns of the deploy.
	const asked = page.waitForResponse('**/_app/version.json');
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await asked;
	await page.locator('a.search-hint').click();
	await page.waitForURL(/\/search/);
	await expect.poll(() => marker(page)).toBeUndefined();
});

test('without a deploy, a tap stays a client-side navigation', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
	await page.locator('a.search-hint').click();
	await page.waitForURL(/\/search/);
	expect(await marker(page)).toBe(1);
});
