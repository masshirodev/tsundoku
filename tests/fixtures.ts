import { test as base, expect } from '@playwright/test';

/**
 * Every e2e spec imports `test` from here. Its `page.goto` waits for the
 * network to go quiet as well as for `load`: SvelteKit hydrates after
 * `load`, and under the full parallel run (four devices, a dozen workers) a
 * click can land on server-rendered markup whose handlers don't exist yet --
 * a tap that opens nothing, a form that posts without JavaScript. That was
 * the whole of this suite's flakiness, one spec at a time, until it was
 * fixed here once.
 */
export const test = base.extend({
	page: async ({ page }, use) => {
		const goto = page.goto.bind(page);
		page.goto = async (url, options) => {
			const res = await goto(url, options);
			await page.waitForLoadState('networkidle');
			return res;
		};
		await use(page);
	}
});

export { expect };

/**
 * The reader is ready: its stylesheet has applied (the ground is true black).
 * A client-side navigation into it doesn't change the document, so no load
 * state waits for its CSS, and until it lands the stage isn't full-screen --
 * taps miss it and the controls aren't fixed yet.
 */
export async function readerReady(page: import('@playwright/test').Page): Promise<void> {
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.reader')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
}

/**
 * The screen has come to rest: a client-side navigation slides the next
 * screen 40px in (doc/MOTION.md, "Screens"), and a measurement taken while it
 * moves reads fractions of a pixel. Call it before measuring a screen that
 * was navigated to.
 */
export async function screenSettled(page: import('@playwright/test').Page): Promise<void> {
	await page
		.locator('.main > .route-view > *')
		.first()
		.evaluate((n) =>
			Promise.all(n.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)))
		);
}
