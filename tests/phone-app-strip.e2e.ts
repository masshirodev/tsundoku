import { devices, type Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';

/**
 * The vertical strip zoomed past the screen, in the Android app (doc/READER.md,
 * "Zoom"; c1162). There the lane scrolls sideways, and `overflow-x: auto` makes
 * it a scroller both ways; the app's `overscroll-behavior: none` on every
 * element (base.css) then kept a drag down the page from passing to the page,
 * so a pinch or a double tap left the strip stuck: sideways only. A browser
 * never had it (it chains), so the case is the app's, on its tablet.
 *
 * The scroll is Chromium's own synthetic gesture, sent as a mouse's (a wheel):
 * headless Chromium drops a touch-sourced one (as phone-app-zoom says of the
 * pinch), and a wheel's chaining past a scroller is the same rule a finger's
 * is. Read-only: incognito, and the strip is READING's session state.
 */
test.use({
	serviceWorkers: 'block',
	viewport: { width: 800, height: 1280 },
	userAgent: `${devices['Galaxy Tab S4'].userAgent} TsundokuApp/2026.11.21`
});
test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function openStrip(page: Page) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await expect(page.locator('html')).toHaveAttribute('data-app', '');
	await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await page.keyboard.press('Escape');
	await page.locator('footer[aria-label="Reader controls"] .cell.grow').click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	const vertical = sheet.getByRole('radio', { name: 'VERTICAL' });
	await vertical.click();
	await expect(vertical).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.reader')).toHaveClass(/vertical/);
}

/** A drag of `dx`, `dy` from the middle of the screen, as a wheel; what the page and the lane moved. */
async function scrollBy(page: Page, dx: number, dy: number) {
	const before = await page.evaluate(() => ({
		y: scrollY,
		x: document.querySelector('.lane')!.scrollLeft
	}));
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.synthesizeScrollGesture', {
		x: 400,
		y: 800,
		xDistance: -dx,
		yDistance: -dy,
		gestureSourceType: 'mouse',
		speed: 800
	});
	await cdp.detach();
	await page.waitForTimeout(300);
	const after = await page.evaluate(() => ({
		y: scrollY,
		x: document.querySelector('.lane')!.scrollLeft
	}));
	return { dx: after.x - before.x, dy: after.y - before.y };
}

test('zoomed wider than the screen, the strip still scrolls down the page, and sideways', async ({
	page
}) => {
	await openStrip(page);
	// 200%, where a double tap lands: past the screen, SIDES' margins included.
	for (let i = 0; i < 4; i++) await page.keyboard.press('+');
	const lane = page.locator('.lane.wider');
	await expect.poll(() => lane.evaluate((n) => n.scrollWidth > n.clientWidth + 1)).toBe(true);
	await page.waitForTimeout(500);
	expect((await scrollBy(page, 0, 400)).dy).toBeGreaterThan(200);
	expect((await scrollBy(page, 0, -200)).dy).toBeLessThan(-100);
	expect((await scrollBy(page, 200, 0)).dx).toBeGreaterThan(100);
});
