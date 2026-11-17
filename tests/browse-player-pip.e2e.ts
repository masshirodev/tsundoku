import { test, expect } from './fixtures';
import { devices, type Page } from '@playwright/test';

/**
 * Picture-in-picture with subtitles (doc/ANIME.md "The player"). Where
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
	test('PIP moves the picture and its subtitles into the window, and closing puts them back', async ({
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
		// The native track went too, drawn invisibly there as on the page: one line.
		expect(
			await page.evaluate(() => {
				const d = (window as Window & { documentPictureInPicture?: { window: Window | null } })
					.documentPictureInPicture!.window!.document;
				return d.querySelector('video')!.classList.contains('cueless');
			})
		).toBe(true);
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

	test('the window answers on its own: a click on the picture and the keys play and pause', async ({
		page
	}) => {
		test.setTimeout(90_000);
		await openEpisode(page);
		await showControls(page);
		const opened = page
			.context()
			.waitForEvent('page', { timeout: 5_000 })
			.catch(() => null);
		await page.getByRole('button', { name: 'Picture in picture' }).click();
		await expect.poll(() => inWindow(page)).toMatchObject({ video: true });
		const win = await opened;
		expect(win, 'Playwright drives the floating window as a page of its own').not.toBeNull();
		const paused = () => page.evaluate(() => document.querySelector('video')?.paused ?? null);
		const inside = () =>
			page.evaluate(() => {
				const w = (window as Window & { documentPictureInPicture?: { window: Window | null } })
					.documentPictureInPicture?.window;
				return w?.document.querySelector('video')?.paused ?? null;
			});
		// The picture went over paused (openEpisode holds it at 1 s).
		expect(await inside()).toBe(true);
		expect(await paused()).toBeNull();
		// A mouse's click in the middle of the picture, in the window: it plays...
		const box = await win!.evaluate(() => ({ w: innerWidth, h: innerHeight }));
		await win!.mouse.click(box.w / 2, box.h / 2);
		await expect.poll(inside).toBe(false);
		// ...and Space, typed with the window focused, pauses it again.
		await win!.keyboard.press(' ');
		await expect.poll(inside).toBe(true);
		// M mutes, the player's other keys being the same function.
		await win!.keyboard.press('m');
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(
							window as Window & { documentPictureInPicture?: { window: Window | null } }
						).documentPictureInPicture?.window?.document.querySelector('video')?.muted
				)
			)
			.toBe(true);
		await win!.keyboard.press('m');
		// Escape in the window brings the picture back, not the page away.
		const here = page.url();
		// Its keydown closes the window, so there may be no window for the keyup.
		await win!.keyboard.down('Escape').catch((e: Error) => {
			if (!/closed/.test(e.message)) throw e;
		});
		await expect.poll(() => inWindow(page)).toBeNull();
		await expect(page.locator('.player > .stage video')).toHaveCount(1);
		expect(page.url()).toBe(here);
		// Back in the page, the page's own click still plays and pauses: once, not
		// twice (the window's listeners went with it). Above the ▶ in the middle.
		const before = await paused();
		const stage = (await page.locator('.player > .stage').boundingBox())!;
		await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 4);
		await expect.poll(paused).toBe(!before);
	});

	test('PIP again, and NEXT, close the window: none is left empty', async ({ page }) => {
		test.setTimeout(90_000);
		await openEpisode(page);
		// The player drawn by the server too (a reload, a link): its PiP controls
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

/**
 * The picture the page shows of the <video> alone, its drawn line and the
 * controls set aside: with the track showing it must look as it does with
 * the track off, or the page shows a native cue box under tsundoku's line.
 */
async function pageCuesInvisible(page: Page): Promise<boolean> {
	const style = await page.addStyleTag({
		content: '.player > :not(.stage), .subs { visibility: hidden !important; }'
	});
	const video = page.locator('.player > .stage video');
	const shown = await video.screenshot({ animations: 'disabled' });
	const modes = await page.evaluate(() =>
		Array.from(document.querySelector('video')!.textTracks).map((t) => {
			const was = t.mode;
			t.mode = 'disabled';
			return was;
		})
	);
	const off = await video.screenshot({ animations: 'disabled' });
	await page.evaluate((modes) => {
		const tt = Array.from(document.querySelector('video')!.textTracks);
		tt.forEach((t, i) => (t.mode = modes[i]));
	}, modes);
	await style.evaluate((el) => (el as Element).remove());
	return shown.equals(off);
}

test.describe('a video’s own picture-in-picture (no Document PiP: Safari’s case)', () => {
	test('the native track shows always, drawn invisibly on the page except while the browser says PiP has it', async ({
		page
	}) => {
		test.setTimeout(90_000);
		await page.addInitScript(() => {
			delete (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
		});
		await openEpisode(page);
		const state = () =>
			page.evaluate(() => {
				const v = document.querySelector('video')!;
				const t = v.querySelector('track');
				const tt = Array.from(v.textTracks);
				return {
					track: t?.getAttribute('src') ?? null,
					kind: t?.getAttribute('kind') ?? null,
					modes: tt.map((x) => x.mode),
					// The cue a PiP window would read, loaded and active at the held time.
					active: tt.flatMap((x) => Array.from(x.activeCues ?? []).map((c) => (c as VTTCue).text)),
					cueless: v.classList.contains('cueless')
				};
			});
		await expect.poll(async () => (await state()).active).toEqual([CUE]);
		const before = await state();
		expect(before.kind).toBe('subtitles');
		expect(before.track).toMatch(/^\/api\/anime\//);
		// Showing, for a PiP window that opens without telling the page...
		expect(before.modes).toEqual(['showing']);
		expect(before.cueless).toBe(true);
		// ...and invisible on the page, where tsundoku draws its own line once.
		expect(await pageCuesInvisible(page), 'no native cue box on the page').toBe(true);
		// While the browser says its PiP has the picture, the cues are drawn plainly.
		await page.evaluate(() =>
			document.querySelector('video')!.dispatchEvent(new Event('enterpictureinpicture'))
		);
		await expect.poll(async () => (await state()).cueless).toBe(false);
		expect((await state()).modes).toEqual(['showing']);
		await page.evaluate(() =>
			document.querySelector('video')!.dispatchEvent(new Event('leavepictureinpicture'))
		);
		await expect.poll(async () => (await state()).cueless).toBe(true);

		// Subtitles off in the sheet: no track at all, so none shows anywhere.
		await page.keyboard.press('c');
		await expect.poll(async () => (await state()).track).toBeNull();
		await expect.poll(async () => (await state()).modes.filter((m) => m === 'showing')).toEqual([]);
		// And on again: the new track shows at once.
		await page.keyboard.press('c');
		await expect.poll(async () => (await state()).modes).toContain('showing');
	});
});
