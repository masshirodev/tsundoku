import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Firefox's picture-in-picture (doc/ANIME.md "The player",
 * pip.ts). Firefox 155 has both the Picture-in-Picture web API and Document
 * Picture-in-Picture (in a secure context, which 127.0.0.1 is), so the PIP
 * cell opens the same floating window as in Chrome. Firefox's own PiP
 * toggle, on the picture, gives the <video> alone, and the subtitles go as
 * the native <track>: showing all the time (that toggle may not tell the
 * page), drawn invisibly on the page so tsundoku's line stays the only one.
 *
 * What this cannot check is what Firefox's own video PiP window draws:
 * Playwright opens one, but nothing here can look into it, so that is checked
 * by hand. Its own file because
 * `browserName` is a worker's option, which a describe in the Chromium spec
 * cannot change. On the browse server's "Tsukiakari no Ryokōsha"
 * (tests/browse-setup.ts), whose WebM clip has English subtitles from 0.5 s.
 */
test.use({
	browserName: 'firefox',
	viewport: { width: 1280, height: 800 },
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
	await page.evaluate(() => {
		const v = document.querySelector('video')!;
		v.pause();
		v.currentTime = 1;
	});
	await expect(page.locator('.player .subs .line')).toHaveText(CUE);
}

const track = (page: Page) =>
	page.evaluate(() => {
		const v = document.querySelector('video')!;
		const t = v.querySelector('track');
		const tt = Array.from(v.textTracks);
		return {
			src: t?.getAttribute('src') ?? null,
			modes: tt.map((x) => x.mode),
			// The cue Firefox's PiP would read: loaded and active at the held time.
			active: tt.flatMap((x) => Array.from(x.activeCues ?? []).map((c) => (c as VTTCue).text)),
			cueless: v.classList.contains('cueless'),
			inPip: document.pictureInPictureElement === v
		};
	});

/** As in browse-player-pip.e2e.ts: the page's <video> looks the same with the track off. */
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
		const v = w.document.querySelector('.stage video') as HTMLVideoElement | null;
		const line = w.document.querySelector('.subs .line') as HTMLElement | null;
		return {
			video: !!v,
			paused: v?.paused ?? null,
			cueless: v?.classList.contains('cueless') ?? null,
			line: line?.textContent ?? null,
			background: line ? w.getComputedStyle(line).backgroundColor : null
		};
	});

test('PIP opens Firefox’s Document Picture-in-Picture with the drawn subtitles, and it answers clicks and keys', async ({
	page
}) => {
	test.setTimeout(90_000);
	await openEpisode(page);
	expect(
		await page.evaluate(() => ({
			api: 'pictureInPictureEnabled' in document,
			doc: 'documentPictureInPicture' in window
		})),
		'Firefox 155 has both: the video PiP API and Document PiP'
	).toEqual({ api: true, doc: true });
	await expect(page.locator('.player > .stage video')).toHaveCount(1);
	await showControls(page);
	const opened = page
		.context()
		.waitForEvent('page', { timeout: 10_000 })
		.catch(() => null);
	await page.getByRole('button', { name: 'Picture in picture' }).click();
	await expect
		.poll(() => inWindow(page))
		.toMatchObject({ video: true, line: CUE, background: 'rgba(0, 0, 0, 0.6)', cueless: true });
	await expect(page.locator('.player > .stage')).toHaveCount(0);
	// The window's own input, as in Chromium: a click plays, Space pauses.
	const win = await opened;
	expect(win, 'Playwright drives the floating window as a page of its own').not.toBeNull();
	const box = await win!.evaluate(() => ({ w: innerWidth, h: innerHeight }));
	await win!.mouse.click(box.w / 2, box.h / 2);
	await expect.poll(async () => (await inWindow(page))?.paused).toBe(false);
	await win!.keyboard.press(' ');
	await expect.poll(async () => (await inWindow(page))?.paused).toBe(true);
	// PIP · ON brings it back.
	await showControls(page);
	await page.getByRole('button', { name: 'Bring the picture back' }).click();
	await expect.poll(() => inWindow(page)).toBeNull();
	await expect(page.locator('.player > .stage video')).toHaveCount(1);
});

test('the native track shows all the time, drawn invisibly on the page, for Firefox’s own PiP toggle', async ({
	page
}) => {
	test.setTimeout(90_000);
	await openEpisode(page);
	await expect.poll(async () => (await track(page)).active).toEqual([CUE]);
	expect(await track(page)).toMatchObject({ modes: ['showing'], cueless: true, inPip: false });
	expect((await track(page)).src).toMatch(/^\/api\/anime\//);
	expect(await pageCuesInvisible(page), 'no native cue box on the page').toBe(true);
	// The video's own PiP, as Firefox's toggle on the picture opens it (here by
	// the API, the one way a page can open it): Firefox says so, and the track
	// keeps showing there, its cues drawn plainly.
	await page.evaluate(() => document.querySelector('video')!.requestPictureInPicture());
	await expect.poll(async () => (await track(page)).inPip).toBe(true);
	expect(await track(page)).toMatchObject({ modes: ['showing'], cueless: false, active: [CUE] });
	await page.evaluate(() => document.exitPictureInPicture());
	await expect.poll(async () => (await track(page)).inPip).toBe(false);
	await expect.poll(async () => (await track(page)).cueless).toBe(true);
	expect((await track(page)).modes).toEqual(['showing']);
});

test('subtitles off is no track, and on again is a showing one', async ({ page }) => {
	test.setTimeout(90_000);
	await openEpisode(page);
	await expect.poll(async () => (await track(page)).modes).toEqual(['showing']);
	await page.keyboard.press('c');
	await expect.poll(async () => (await track(page)).src).toBeNull();
	await expect
		.poll(async () => (await track(page)).modes.filter((m) => m === 'showing'))
		.toEqual([]);
	await page.keyboard.press('c');
	await expect.poll(async () => (await track(page)).modes).toContain('showing');
});
