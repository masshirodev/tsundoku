import { test, expect } from './fixtures';
import { devices, type Page } from '@playwright/test';

/**
 * Picture-in-picture with subtitles (c388, doc/ANIME.md "The player"). Where
 * Document Picture-in-Picture exists, PIP moves the picture layer -- the
 * <video> and tsundoku's drawn subtitles -- into a floating window with the
 * page's styles, and every way out puts it back. Where only a video's own
 * picture-in-picture exists, the same WebVTT is a native <track>, shown only
 * while that is open. On the browse server's "Tsukiakari no Ryokōsha"
 * (tests/browse-setup.ts), whose clip has English subtitles from 0.5 s.
 */
test.use({
	viewport: { width: 1280, height: 800 },
	userAgent: devices['Desktop Chrome'].userAgent,
	hasTouch: false,
	isMobile: false,
	deviceScaleFactor: 1,
	serviceWorkers: 'block'
});

const CUE = 'There is a town past this ridge.';

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
	// Held at the first line's time: the clip is 8 s and its end plays the next episode.
	await page.evaluate(() => {
		const v = document.querySelector('video')!;
		v.pause();
		v.currentTime = 1;
	});
	await expect(page.locator('.player .subs .line')).toHaveText(CUE);
}

async function showControls(page: Page) {
	await page.mouse.move(120, 120);
	await page.mouse.move(640, 300 + Math.random() * 10);
}

/** What the floating window holds, read from the page that opened it. */
const inWindow = (page: Page) =>
	page.evaluate(() => {
		const w = (window as Window & { documentPictureInPicture?: { window: Window | null } })
			.documentPictureInPicture?.window;
		if (!w) return null;
		const line = w.document.querySelector('.subs .line') as HTMLElement | null;
		const style = line ? w.getComputedStyle(line) : null;
		return {
			video: !!w.document.querySelector('.stage video'),
			line: line?.textContent ?? null,
			// Scoped styles came with it: the scrim and the sans face, not a bare div's.
			background: style?.backgroundColor ?? null,
			font: style?.fontFamily ?? null,
			bottom: line ? w.getComputedStyle(line.parentElement!).bottom : null
		};
	});

test.describe('Document Picture-in-Picture (Chromium)', () => {
	test('PIP moves the picture and its subtitles into the window, and closing puts them back (c388)', async ({
		page
	}) => {
		test.setTimeout(90_000);
		await openEpisode(page);
		expect(
			await page.evaluate(() => 'documentPictureInPicture' in window),
			'this Chromium has Document Picture-in-Picture'
		).toBe(true);
		// The same <video> element goes and comes back: marked, to know it again.
		await page.evaluate(() => ((document.querySelector('video') as never as { m: number }).m = 7));
		await showControls(page);
		const cell = page.getByRole('button', { name: 'Picture in picture' });
		await cell.click();
		await expect.poll(() => inWindow(page)).toMatchObject({ video: true, line: CUE });
		const w = (await inWindow(page))!;
		expect(w.background).toBe('rgba(0, 0, 0, 0.6)');
		expect(w.font).toMatch(/plex|sans/i);
		// No controls in the window: the subtitles sit where the page puts them
		// with the controls hidden, 7 % from the bottom, and don't rise.
		expect(w.bottom).not.toBe('0px');
		// The page keeps no picture of its own meanwhile, and says where it went.
		await expect(page.locator('.player > .stage')).toHaveCount(0);
		await expect(page.locator('.pipnote')).toContainText('IN PICTURE-IN-PICTURE');
		await showControls(page);
		await expect(page.getByRole('button', { name: 'Bring the picture back' })).toHaveText(
			'PIP · ON'
		);

		// The drawn line follows the picture in the window.
		await page.evaluate(() => {
			const v = (
				window as Window & { documentPictureInPicture?: { window: Window | null } }
			).documentPictureInPicture!.window!.document.querySelector('video')!;
			v.currentTime = 4;
		});
		await expect.poll(async () => (await inWindow(page))?.line).toBe('Neither of us has seen it.');
		// A subtitle change made from the page reaches the window: off is off, on is on.
		await page.keyboard.press('c');
		await expect.poll(async () => (await inWindow(page))?.line).toBeNull();
		await page.keyboard.press('c');
		await expect.poll(async () => (await inWindow(page))?.line).toBe('Neither of us has seen it.');

		// The window's own close: the picture is back in the page, the same element.
		await page.evaluate(() =>
			(
				window as Window & { documentPictureInPicture?: { window: Window | null } }
			).documentPictureInPicture!.window!.close()
		);
		await expect(page.locator('.player > .stage video')).toHaveCount(1);
		await expect(page.locator('.pipnote')).toHaveCount(0);
		expect(
			await page.evaluate(() => (document.querySelector('video') as never as { m: number }).m)
		).toBe(7);
		expect(await inWindow(page)).toBeNull();
		await showControls(page);
		await expect(page.getByRole('button', { name: 'Picture in picture' })).toHaveText('PIP');
	});

	test('PIP again, and NEXT, close the window: none is left empty (c388)', async ({ page }) => {
		test.setTimeout(90_000);
		await openEpisode(page);
		// The player drawn by the server too (a reload, a link): its PiP doors
		// are the browser's alone, and the server's render must not reach them.
		const reload = await page.reload();
		expect(reload?.status()).toBe(200);
		await page.waitForFunction(() => (document.querySelector('video')?.duration ?? 0) > 0);
		await page.evaluate(() => {
			const v = document.querySelector('video')!;
			v.pause();
			v.currentTime = 1;
		});
		await showControls(page);
		await page.getByRole('button', { name: 'Picture in picture' }).click();
		await expect.poll(() => inWindow(page)).toMatchObject({ video: true });
		// PIP · ON brings it back.
		await showControls(page);
		await page.getByRole('button', { name: 'Bring the picture back' }).click();
		await expect.poll(() => inWindow(page)).toBeNull();
		await expect(page.locator('.player > .stage video')).toHaveCount(1);

		// Into the window again, then NEXT: the window goes with the old player.
		await showControls(page);
		await page.getByRole('button', { name: 'Picture in picture' }).click();
		await expect.poll(() => inWindow(page)).toMatchObject({ video: true });
		const before = page.url();
		await page.keyboard.press('n');
		await expect.poll(() => page.url()).not.toBe(before);
		await expect.poll(() => inWindow(page)).toBeNull();
		await expect(page.locator('.player > .stage video')).toHaveCount(1);

		// Into the window, then away to the series: the window goes too.
		await page.waitForFunction(() => (document.querySelector('video')?.duration ?? 0) > 0);
		await page.evaluate(() => document.querySelector('video')!.pause());
		await showControls(page);
		await page.getByRole('button', { name: 'Picture in picture' }).click();
		await expect.poll(() => inWindow(page)).toMatchObject({ video: true });
		await page.locator('a[href*="/series/"]').first().click();
		await expect(page).toHaveURL(/\/series\/\d+/);
		await expect.poll(() => inWindow(page)).toBeNull();
	});
});

test.describe('a browser with only the video’s own picture-in-picture', () => {
	test('the native track shows only between enter and leave, and follows the subtitles (c388)', async ({
		page
	}) => {
		test.setTimeout(90_000);
		// Firefox's and Safari's case: no Document Picture-in-Picture.
		await page.addInitScript(() => {
			delete (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
		});
		await openEpisode(page);
		const mode = () =>
			page.evaluate(() => {
				const v = document.querySelector('video')!;
				const t = v.querySelector('track');
				return {
					track: t?.getAttribute('src') ?? null,
					kind: t?.getAttribute('kind') ?? null,
					modes: Array.from(v.textTracks).map((x) => x.mode)
				};
			});
		const before = await mode();
		expect(before.kind).toBe('subtitles');
		expect(before.track).toMatch(/^\/api\/anime\//);
		// Hidden on the page: tsundoku draws its own, and never twice.
		expect(before.modes).toEqual(['hidden']);
		// The browser's own picture-in-picture opens and closes on the <video>.
		await page.evaluate(() =>
			document.querySelector('video')!.dispatchEvent(new Event('enterpictureinpicture'))
		);
		await expect.poll(async () => (await mode()).modes).toEqual(['showing']);
		await page.evaluate(() =>
			document.querySelector('video')!.dispatchEvent(new Event('leavepictureinpicture'))
		);
		await expect.poll(async () => (await mode()).modes).toEqual(['hidden']);

		// Subtitles off in the sheet while in PiP: no track at all, so none shows.
		await page.evaluate(() =>
			document.querySelector('video')!.dispatchEvent(new Event('enterpictureinpicture'))
		);
		await page.keyboard.press('c');
		await expect.poll(async () => (await mode()).track).toBeNull();
		await expect.poll(async () => (await mode()).modes.filter((m) => m === 'showing')).toEqual([]);
		// And on again: the new track shows at once, since PiP is still open.
		await page.keyboard.press('c');
		await expect.poll(async () => (await mode()).modes).toContain('showing');
	});
});
