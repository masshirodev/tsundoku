import { test, expect } from './fixtures';
import { devices, type Page } from '@playwright/test';

/**
 * The player's seek bar and middle cluster off a TV (doc/ANIME.md, "The
 * player"). c315: the strip between the elapsed time and the line is inert on
 * a desktop, a touch tablet and a phone's portrait scrubber, as it was before
 * c296's TV-only border reached every bar. c429: the −10 / pause / +10 cluster
 * over the picture is translucent, and its labels keep AA contrast over a
 * white and a black frame. On the browse server's "Tsukiakari no Ryokōsha",
 * whose episodes are the fixture's 8 s clip (tests/browse-setup.ts); it runs
 * in the `browse` project because that is where the clip is served, and each
 * case switches to the device it is about.
 */

async function openEpisode(page: Page) {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: 'A Letter from Hollin' })
		.locator('.entry-btn')
		.click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && Number.isFinite(v.duration) && v.duration > 0;
		},
		undefined,
		{ timeout: 20_000 }
	);
	// Held still at 4 s: a paused picture keeps the chrome up, and a seek to
	// 0:00 is then something that moved.
	await page.evaluate(() => {
		const v = document.querySelector('video')!;
		v.pause();
		v.currentTime = 4;
	});
	await expect.poll(() => at(page)).toBeCloseTo(4, 1);
	await expect(page.locator('.player')).toHaveClass(/chrome/);
}

const at = (page: Page) => page.evaluate(() => document.querySelector('video')!.currentTime);

/** The drawn line's box and the elapsed time's right edge, in the row `row`. */
async function strip(page: Page, row: string) {
	return page.locator(row).evaluate((el) => {
		const track = el.querySelector('.track') as HTMLElement;
		const time = el.firstElementChild as HTMLElement;
		const t = track.getBoundingClientRect();
		return {
			lineLeft: t.left + track.clientLeft,
			lineWidth: track.clientWidth,
			timeRight: time.getBoundingClientRect().right,
			y: t.top + t.height / 2
		};
	});
}

/**
 * A press 16px left of the line leaves the picture where it was, and one on
 * the line still seeks: the bar responds, the strip does not. 16px is inside
 * c296's 20px border, so the border anywhere but a TV turns it into a seek to
 * 0:00, and it is past the reach of Chromium's touch adjustment, which moves a
 * tap within about 10px of the line onto it with or without the border
 * (measured here at 2, 5 and 9px; 12px and beyond stay where they land). In
 * the bar that point is in the 18px gap after the time; under a portrait
 * picture, whose gap is 12px, it is on the time itself.
 */
async function stripIsInert(
	page: Page,
	row: string,
	press: (x: number, y: number) => Promise<void>
) {
	const s = await strip(page, row);
	const x = s.lineLeft - 16;
	expect(x).toBeLessThan(s.lineLeft);
	expect(x).toBeGreaterThan(s.timeRight - 20);
	await press(x, s.y);
	// Nothing to wait on: the assertion is that nothing happens.
	await page.waitForTimeout(300);
	expect(await at(page)).toBeCloseTo(4, 1);
	// The line itself, at three quarters: a seek to 6 s of the 8 s clip.
	await press(s.lineLeft + s.lineWidth * 0.75, s.y);
	await expect.poll(() => at(page)).toBeGreaterThan(5.5);
}

test.describe('on a desktop', () => {
	test.use({
		viewport: { width: 1280, height: 800 },
		userAgent: devices['Desktop Chrome'].userAgent,
		hasTouch: false,
		isMobile: false,
		deviceScaleFactor: 1,
		serviceWorkers: 'block'
	});

	test('a click between the time and the seek bar does not seek (c315)', async ({ page }) => {
		test.setTimeout(60_000);
		await openEpisode(page);
		await stripIsInert(page, '.scrubrow', (x, y) => page.mouse.click(x, y));
	});
});

test.describe('on a touch tablet', () => {
	test.use({
		viewport: { width: 1280, height: 800 },
		userAgent: devices['Galaxy Tab S4 landscape'].userAgent,
		hasTouch: true,
		isMobile: true,
		serviceWorkers: 'block'
	});

	test('a tap between the time and the seek bar does not seek (c315)', async ({ page }) => {
		test.setTimeout(60_000);
		await openEpisode(page);
		await stripIsInert(page, '.scrubrow', (x, y) => page.touchscreen.tap(x, y));
	});
});

test.describe('on a phone, in portrait', () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
		serviceWorkers: 'block'
	});

	test('a tap between the time and the scrubber under the picture does not seek (c315)', async ({
		page
	}) => {
		test.setTimeout(60_000);
		await openEpisode(page);
		await stripIsInert(page, '.pscrub', (x, y) => page.touchscreen.tap(x, y));
	});
});
