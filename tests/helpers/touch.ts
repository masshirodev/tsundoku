import type { Page } from '@playwright/test';

/**
 * Two taps at one point, as a thumb's double tap: the four touch events go to
 * the browser together, so the gap between the taps is the browser's own,
 * not the test runner's.
 *
 * The reader counts a second tap within DOUBLE_TAP_MS (250 ms,
 * `src/lib/reader/zoom.ts`) as the double. Two `page.touchscreen.tap` calls
 * are two round trips each, every one waiting for the browser to answer, and
 * under a loaded suite the second tap landed past the window: the reader took
 * two single taps, and `reader-flow`'s "double tap on the strip" read 1600 px
 * where the zoom should have come back to 800. The events
 * are the same CDP `Input.dispatchTouchEvent` calls Playwright's own tap
 * sends, only not awaited one by one; the browser handles them in order.
 * Chromium only, which every touch project is.
 */
export async function doubleTap(page: Page, x: number, y: number): Promise<void> {
	const cdp = await page.context().newCDPSession(page);
	try {
		const start = { type: 'touchStart' as const, touchPoints: [{ x, y }] };
		const end = { type: 'touchEnd' as const, touchPoints: [] };
		await Promise.all([start, end, start, end].map((e) => cdp.send('Input.dispatchTouchEvent', e)));
	} finally {
		await cdp.detach();
	}
}
