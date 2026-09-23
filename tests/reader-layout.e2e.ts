import { expect, readerReady, test } from './fixtures';

/**
 * The reader's frame on every device (doc/READER.md). Read-only: it reads in
 * incognito, so opening pages writes nothing to the shared database, and it
 * reads a series no flow file owns (Sousou no Frieren).
 */
test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function open(page: import('@playwright/test').Page) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
}

test('the page fills the screen on true black, with nothing over it', async ({ page }) => {
	await open(page);
	const vp = page.viewportSize()!;
	const box = await page.locator('[data-page]').first().boundingBox();
	expect(box!.height).toBeCloseTo(vp.height, -1);
	expect(await page.locator('.reader').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
		'rgb(0, 0, 0)'
	);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	// The library's chrome is gone: no sidebar, no bands.
	await expect(page.locator('.sidebar')).toHaveCount(0);
});

test('the controls: a 64px bar on top, a 56px scrubber and 64px cells below', async ({ page }) => {
	await open(page);
	const vp = page.viewportSize()!;
	// The middle button: a left click would turn the page (mouseAction).
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	const top = await page.getByRole('banner', { name: 'Reader' }).boundingBox();
	expect(top).toMatchObject({ y: 0, height: 64 });
	const scrub = await page.locator('.scrub').boundingBox();
	expect(scrub!.height).toBe(56);
	const cells = await page.locator('.cells').boundingBox();
	expect(cells!.height).toBe(64);
	expect(cells!.y + cells!.height).toBeCloseTo(vp.height, 0);
});

test('nothing hidden opens while reveal is off', async ({ request }) => {
	const res = await request.get('/api/entries/999999/pages');
	expect(res.status()).toBe(404);
});
