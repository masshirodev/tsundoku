import { expect, test } from './fixtures';

/**
 * The player on a TV (c235; TV-Player, TV-Board-Player): the picture until a
 * key, then all six cells on one row with the scrubber above, the settings as a
 * 420px panel, and the media keys a remote sends.
 *
 * The seeded library has no anime -- the sample shelf is all books -- so this
 * runs against the browse world's own server, the one `tests/browse-anime.e2e.ts`
 * plays on, at an absolute address: the `tv` project's baseURL is the shared
 * library. It opens the episode in incognito, the app's own way of watching
 * without recording, so the flow files running beside it on that database keep
 * the CONTINUE line they assert on.
 */

const BROWSE = `http://localhost:${process.env.PLAYWRIGHT_BROWSE_PORT ?? '4194'}`;
const TITLE = 'Tsukiakari no Ryokōsha';
/** EP. 11: a title of its own, no stored position, and no other spec plays it. */
const EPISODE = "The Ferryman's Count";

test.use({ baseURL: BROWSE });

test.beforeEach(async ({ context }) => {
	await context.addCookies([{ name: 'tsundoku_incognito', value: '1', url: BROWSE }]);
});

async function openEpisode(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: EPISODE })
		.locator('.entry-btn')
		.click();
	await expect(page.locator('.player')).toBeVisible();
}

/** A browser that won't start a video by itself is started by the bar, as a remote would. */
async function play(page: import('@playwright/test').Page): Promise<void> {
	const video = page.locator('video');
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused), { timeout: 5000 })
		.toBe(false)
		.catch(async () => {
			await page.keyboard.press('ArrowUp');
			await page.locator('.cells .pause').focus();
			await page.keyboard.press('Enter');
		});
	await page.keyboard.press('ArrowUp');
	await expect(page.locator('.player')).toHaveClass(/chrome/);
}

const bar = (page: import('@playwright/test').Page) => page.locator('.bottom .cells > :visible');

/** A remote's media key. Playwright has no name for most of them. */
async function mediaKey(page: import('@playwright/test').Page, key: string): Promise<void> {
	await page.evaluate(
		(k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })),
		key
	);
}

test('six cells on one row, and the first arrow lands on ▶❚❚', async ({ page }) => {
	await openEpisode(page);
	await play(page);

	// 6B: the bar's own six cells, in the design's order, on one row. (The
	// eighth and seventh are the desktop's volume and ? KEYS, not drawn here.)
	await expect(bar(page)).toHaveCount(6);
	await expect(bar(page).nth(0)).toHaveAttribute('aria-label', /Pause|Play/);
	await expect(bar(page).nth(1)).toHaveText('−10');
	await expect(bar(page).nth(2)).toHaveText('+10');
	await expect(bar(page).nth(3)).toContainText('← EP. 10');
	// The one cell that names the stream and opens the settings.
	await expect(bar(page).nth(4)).toContainText('SUBS');
	await expect(bar(page).nth(5)).toContainText('EP. 12 →');
	// The first three are 76px, as TV-Focus draws the same bar.
	for (const i of [0, 1, 2]) expect((await bar(page).nth(i).boundingBox())!.width).toBe(76);
	// 56px under a 60px scrubber, inside the 28px safe bottom.
	expect((await page.locator('.cells').boundingBox())!.height).toBe(56);
	expect((await page.locator('.scrubrow').boundingBox())!.height).toBe(60);
	const bottom = (await page.locator('.bottom').boundingBox())!;
	expect(Math.round(bottom.y + bottom.height)).toBe(540 - 28);
	// 6A: no middle cluster on a TV -- the bar is the interface.
	await expect(page.locator('.cluster')).toBeHidden();

	// Nothing focused yet; an arrow puts it on ▶❚❚, the bar's own start.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await expect(bar(page).nth(0)).not.toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(bar(page).nth(0)).toBeFocused();
	// → walks the row.
	await page.keyboard.press('ArrowRight');
	await expect(bar(page).nth(1)).toBeFocused();
});

test('the settings cell opens the 420px panel, ← → changes a row, BACK gives focus back', async ({
	page
}) => {
	await openEpisode(page);
	await play(page);
	const settings = page.locator('.cells .grow');
	await settings.focus();
	await page.keyboard.press('Enter');

	const panel = page.getByRole('dialog', { name: 'Playback settings' });
	await expect(panel).toBeVisible();
	expect((await panel.boundingBox())!.width).toBe(420);
	// It opens on its first row, not on its ✕ (TV-Focus, "A PANEL").
	await expect(panel.locator('.srow2').first().locator('button').first()).toBeFocused();

	// ← → move along the row and OK takes the value. SPEED is this episode's
	// alone, so nothing here changes what the series carries to every episode.
	const speed = panel.locator('.srow2', { hasText: 'SPEED' });
	const one = speed.getByRole('button', { name: '1×' });
	const faster = speed.getByRole('button', { name: '1.25' });
	await one.focus();
	await page.keyboard.press('ArrowRight');
	await expect(faster).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(faster).toHaveClass(/on/);
	// Back to 1× before leaving: the bar names the speed.
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Enter');
	await expect(one).toHaveClass(/on/);

	// BACK closes it and puts focus back on the cell that opened it.
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
	await expect(settings).toBeFocused();
});

test('the media keys a remote sends: ▶❚❚, ⏩ and ⏪', async ({ page }) => {
	await openEpisode(page);
	await play(page);
	const pp = page.locator('.cells .pause');
	await expect(pp).toHaveAttribute('aria-label', 'Pause');
	await mediaKey(page, 'MediaPlayPause');
	await expect(pp).toHaveAttribute('aria-label', 'Play');
	await mediaKey(page, 'MediaPlayPause');
	await expect(pp).toHaveAttribute('aria-label', 'Pause');

	const at = () => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
	const video = page.locator('video');
	// The fixture clip is 8s, so a ±10s key reaches its end: rewinding first
	// keeps both moves inside the clip and off the END card.
	await video.evaluate((v: HTMLVideoElement) => {
		v.pause();
		v.currentTime = 3;
	});
	await mediaKey(page, 'MediaRewind');
	await expect.poll(at).toBeLessThan(1);
	await expect(page.locator('.flash .by')).toHaveText('−10 S');
	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 0));
	await mediaKey(page, 'MediaFastForward');
	await expect.poll(at).toBeGreaterThan(5);
});

test('the picture until a key, SKIP INTRO taking OK, and BACK hiding then leaving', async ({
	page
}) => {
	await openEpisode(page);
	await play(page);
	const player = page.locator('.player');
	// 6A/6B: the bar hides after a few seconds of playing, and a key brings it
	// back with focus on ▶❚❚; BACK hides it at once.
	await expect(player).not.toHaveClass(/chrome/, { timeout: 10_000 });
	await page.keyboard.press('ArrowDown');
	await expect(player).toHaveClass(/chrome/);
	await expect(page.locator('.cells .pause')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(player).not.toHaveClass(/chrome/);

	// 6D: SKIP INTRO shows alone and takes OK, so skipping is one press.
	await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 1.2));
	await expect(page.getByRole('button', { name: 'SKIP INTRO →' })).toBeVisible();
	await page.keyboard.press('Enter');
	await expect
		.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
		.toBeGreaterThanOrEqual(3);

	// BACK at the picture leaves for the series, as the tablet's ← does.
	await page.keyboard.press('Escape');
	await page.waitForURL(/\/series\/\d+/);
});

test('next episode is a cell of the bar, and OK on it moves to EP. 12', async ({ page }) => {
	await openEpisode(page);
	await play(page);
	const next = page.locator('.cells').getByRole('button', { name: /EP\. 12/ });
	await expect(next).toBeEnabled();
	await next.focus();
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.bottom .cells .grow')).toContainText('SUBS');
});
