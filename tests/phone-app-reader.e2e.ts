import { type Page } from '@playwright/test';
import { expect, readerReady, test } from './helpers/hydrated';

/**
 * The reader under the camera in the phone app (c521; doc/ANDROID.md,
 * "Drawn under the camera"). The app pads the page out of the camera band
 * everywhere else; the image reader asks for the band (`edge(true)`) while it
 * is open and gives it back on leaving, and keeps its top bar below the band
 * with the bar's background reaching up through it. The bottom bar hugs the
 * display's edge.
 *
 * A stand-in for the phone app's bridge records the asks, and sets the band's
 * height the way the app does, as `--app-inset-top` on the root.
 */
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true });

declare global {
	interface Window {
		__edge?: boolean[];
		TsundokuTV?: Record<string, unknown>;
	}
}

async function phoneApp(page: Page) {
	await page.addInitScript(() => {
		window.__edge = [];
		window.TsundokuTV = {
			edge: (on: boolean) => window.__edge!.push(on)
		};
	});
}

/** What the app does once a page has loaded, and on every inset change (Insets.cssScript). */
const sayBand = (page: Page, top: number) =>
	page.evaluate(
		(t) => document.documentElement.style.setProperty('--app-inset-top', `${t}px`),
		top
	);

async function openReader(page: Page) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: 'Hikaru ga Shinda Natsu' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
}

const bar = (page: Page) => page.getByRole('banner', { name: 'Reader' });

test('the reader asks for the band while open, and gives it back on leaving', async ({ page }) => {
	await phoneApp(page);
	await openReader(page);
	await expect.poll(() => page.evaluate(() => window.__edge)).toEqual([true]);
	await page.goBack();
	await page.waitForURL(/\/series\/\d+/);
	await expect.poll(() => page.evaluate(() => window.__edge)).toEqual([true, false]);
});

test('the top bar stays below the band, its background through it; the bottom hugs the edge', async ({
	page
}) => {
	await phoneApp(page);
	await openReader(page);
	await sayBand(page, 32);
	await page.touchscreen.tap(195, 422);
	await expect(bar(page)).toBeVisible();
	const top = (await bar(page).boundingBox())!;
	// The bar starts at the display's top and is 64 under the 32 px band.
	expect(top.y).toBe(0);
	expect(top.height).toBe(64 + 32);
	const back = (await bar(page).locator('a').first().boundingBox())!;
	expect(back.y).toBeGreaterThanOrEqual(32);
	expect(await bar(page).evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
		'rgba(0, 0, 0, 0)'
	);
	const bottom = (await page.getByRole('contentinfo', { name: 'Reader controls' }).boundingBox())!;
	expect(Math.round(bottom.y + bottom.height)).toBe(844);
});

test('in a browser, with no band said, the top bar is the 64 it always was', async ({ page }) => {
	await openReader(page);
	await page.touchscreen.tap(195, 422);
	await expect(bar(page)).toBeVisible();
	expect((await bar(page).boundingBox())!.height).toBe(64);
});
