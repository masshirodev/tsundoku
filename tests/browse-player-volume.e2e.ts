import { test, expect } from './fixtures';
import { devices, type Page } from '@playwright/test';

/**
 * The VOL cell's slider (doc/ANIME.md "The player"): it sets the
 * picture's volume, the wheel steps it, the level is this device's and the
 * next episode starts at it, and mute is never carried over. On the browse
 * server's "Tsukiakari no Ryokōsha" (tests/browse-setup.ts), on a desktop: VOL
 * is a pointer's cell. Every test is a fresh browser context, so the device's
 * storage starts empty and nothing here reaches another spec.
 */
// A desktop is a fine pointer, not a width: the browse project is a touch
// tablet, so its touch is switched off (as browse-flow's desktop cases do).
test.use({
	viewport: { width: 1280, height: 800 },
	userAgent: devices['Desktop Chrome'].userAgent,
	hasTouch: false,
	isMobile: false,
	deviceScaleFactor: 1,
	serviceWorkers: 'block'
});

async function openEpisode(page: Page, title: string) {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: title })
		.locator('.entry-btn')
		.click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await waitForPicture(page);
}

async function waitForPicture(page: Page) {
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && Number.isFinite(v.duration) && v.duration > 0;
		},
		undefined,
		{ timeout: 20_000 }
	);
	// The clip is 8 s, and its end plays the next episode on its own: held still,
	// only NEXT moves the player on.
	await page.evaluate(() => document.querySelector('video')?.pause());
}

/** The controls come back on a real move, not a jitter. */
async function showControls(page: Page) {
	await page.mouse.move(120, 120);
	await page.mouse.move(640, 300 + Math.random() * 10);
}

const videoVolume = (page: Page) =>
	page.evaluate(() => {
		const v = document.querySelector('video')!;
		return { volume: v.volume, muted: v.muted };
	});

/** Hovers VOL and puts the pointer at `f` of the slider's height, from the bottom. */
async function slideTo(page: Page, f: number) {
	const vol = page.locator('.cells .vol');
	await showControls(page);
	await vol.locator('.cell').hover();
	const track = vol.locator('.vtrack');
	await expect(track).toBeVisible();
	const box = (await track.boundingBox())!;
	const y = box.y + box.height * (1 - f);
	// Up the column from the cell, so the pointer never leaves the stack.
	await page.mouse.move(box.x + box.width / 2, box.y + box.height + 20);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height - 1, { steps: 4 });
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, y, { steps: 6 });
	await page.mouse.up();
}

test('the VOL slider sets the volume, the wheel steps it, and NEXT starts at it', async ({
	page
}) => {
	test.setTimeout(120_000);
	await openEpisode(page, 'A Letter from Hollin');
	// Nothing kept yet: the full volume.
	expect(await videoVolume(page)).toEqual({ volume: 1, muted: false });
	const vol = page.locator('.cells .vol');
	// Closed until the pointer comes to it.
	await expect(vol.locator('.vtrack')).toBeHidden();

	await slideTo(page, 0.3);
	const set = (await videoVolume(page)).volume;
	expect(set).toBeGreaterThan(0.25);
	expect(set).toBeLessThan(0.35);
	await expect(vol.locator('.cell')).toHaveText(`VOL ${Math.round(set * 100)}%`);
	await expect(vol.locator('.vtrack')).toHaveAttribute(
		'aria-valuenow',
		String(Math.round(set * 100))
	);
	// Kept as this device's, under the catalogue's key.
	expect(
		await page.evaluate(() => JSON.parse(localStorage.getItem('tsundoku:anime:volume')!))
	).toBe(set);

	// The wheel over the cell steps 5 %, up and down.
	await vol.locator('.cell').hover();
	await page.mouse.wheel(0, -100);
	await expect.poll(async () => (await videoVolume(page)).volume).toBeCloseTo(set + 0.05, 5);
	await page.mouse.wheel(0, 100);
	await page.mouse.wheel(0, 100);
	await expect.poll(async () => (await videoVolume(page)).volume).toBeCloseTo(set - 0.05, 5);
	const kept = (await videoVolume(page)).volume;
	// The page did not scroll for it.
	expect(await page.evaluate(() => window.scrollY)).toBe(0);

	// Muted, then NEXT: the next episode starts at the kept level, and not muted.
	await vol.locator('.cell').click();
	await expect(vol.locator('.cell')).toHaveText('MUTED');
	expect(await videoVolume(page)).toEqual({ volume: kept, muted: true });
	const before = page.url();
	await page.keyboard.press('n');
	await expect.poll(() => page.url()).not.toBe(before);
	await waitForPicture(page);
	expect(await videoVolume(page)).toEqual({ volume: kept, muted: false });
	await showControls(page);
	await expect(page.locator('.cells .vol .cell')).toHaveText(`VOL ${Math.round(kept * 100)}%`);
});

test('↑ ↓ go through the same path: kept, and read once on the next open', async ({ page }) => {
	test.setTimeout(90_000);
	await openEpisode(page, 'A Letter from Hollin');
	await page.locator('.player').focus();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await expect.poll(async () => (await videoVolume(page)).volume).toBe(0.8);
	expect(
		await page.evaluate(() => JSON.parse(localStorage.getItem('tsundoku:anime:volume')!))
	).toBe(0.8);
	// A fresh open of another episode: the first frame is at the kept level.
	await openEpisode(page, 'Salt Road');
	expect(await videoVolume(page)).toEqual({ volume: 0.8, muted: false });
});
