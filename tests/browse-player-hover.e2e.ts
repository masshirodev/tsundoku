import { test, expect } from './fixtures';
import { devices, type Page } from '@playwright/test';

/**
 * Hovering the picture never tints it, and clicking it never flashes it
 * (c485; doc/ANIME.md, "The player"; doc/MOTION.md, "Hovering"). The tap zone
 * over the picture is a `<button>`, so the hover rule in motion.css tinted it
 * until it said `data-press="off"`; the visible controls (the cluster, the
 * scrubber, the bar's cells) keep their tint, and one of them is asserted
 * here so the fix cannot be "no tint anywhere". It runs in the `browse`
 * project because that is where the fixture's clip is served
 * (tests/browse-setup.ts), and switches to a desktop, because hover only
 * exists on a fine pointer and `browse` is a touch tablet.
 */

test.use({
	viewport: { width: 1280, height: 800 },
	userAgent: devices['Desktop Chrome'].userAgent,
	hasTouch: false,
	isMobile: false,
	deviceScaleFactor: 1,
	serviceWorkers: 'block'
});

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
	// Playing until it is under way, as browse-player-cluster's c429 case does:
	// the fake's first server stops as the clip starts and its notice sets the
	// cluster aside; playback on the second clears it. Then held still, which
	// keeps the chrome (and the cluster) up.
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video')!;
			return !v.paused && v.currentTime > 0.5;
		},
		undefined,
		{ timeout: 20_000 }
	);
	await page.evaluate(() => document.querySelector('video')!.pause());
	await expect(page.locator('.player')).toHaveClass(/chrome/);
}

const tint = (page: Page, selector: string) =>
	page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundImage);

/** A point on the picture that is the tap zone itself, clear of every control over it. */
async function bareSpot(page: Page): Promise<{ x: number; y: number }> {
	return page.locator('.tapzone').evaluate((zone) => {
		const r = zone.getBoundingClientRect();
		// Walk a grid over the middle band of the picture for a point whose top
		// element is the tap zone: the cluster sits in the very middle.
		for (const fy of [0.5, 0.4, 0.6, 0.35, 0.65])
			for (const fx of [0.2, 0.8, 0.3, 0.7, 0.1, 0.9]) {
				const x = r.left + r.width * fx;
				const y = r.top + r.height * fy;
				if (document.elementFromPoint(x, y) === zone) return { x, y };
			}
		throw new Error('no point of the picture is the bare tap zone');
	});
}

test('hovering the picture leaves it untinted, and a visible control still tints (c485)', async ({
	page
}) => {
	test.setTimeout(60_000);
	await openEpisode(page);
	// The rule only exists under a real pointer: without it this case proves nothing.
	expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(
		true
	);

	// The cluster's play/pause keeps its hover: the fix is the tap zone's, not
	// the rule's. First, while the picture is paused and the chrome is up.
	await page.locator('.cluster .pp').hover();
	await expect.poll(() => tint(page, '.cluster .pp')).toContain('linear-gradient');

	const spot = await bareSpot(page);
	await page.mouse.move(spot.x, spot.y);
	expect(await page.locator('.tapzone').evaluate((el) => el.matches(':hover'))).toBe(true);
	expect(await tint(page, '.tapzone')).toBe('none');

	// A click on the picture is a tap, not a press of a button: nothing flashes.
	await page.mouse.down();
	expect(await page.locator('.tapzone').getAttribute('data-pressed')).toBeNull();
	await page.mouse.up();
});
