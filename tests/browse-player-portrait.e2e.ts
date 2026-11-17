import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * The player in portrait on a phone (doc/ANIME.md "The player"): the
 * scrubber under the picture seeks on a tap and follows a drag, shows the time
 * under the finger while it drags, and a drag never scrolls what is below.
 * On the browse server's "Tsukiakari no Ryokōsha", whose episodes are the
 * fixture's 8 s clip (tests/browse-setup.ts).
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function openPlayer(page: Page) {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: 'Salt Road' })
		.locator('.entry-btn')
		.click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	const controls = page.getByRole('region', { name: 'Controls' });
	await expect(controls).toBeVisible({ timeout: 20_000 });
	// The clip's length is known once its metadata is in; hold it still, so
	// the position read back is the seek's and not playback's.
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && Number.isFinite(v.duration) && v.duration > 0;
		},
		undefined,
		{ timeout: 20_000 }
	);
	await page.evaluate(() => document.querySelector('video')?.pause());
	return controls;
}

/** The visible line's box (on a TV the track's own box carries a transparent left border). */
async function lineBox(page: Page) {
	return page.locator('.pscrub .track').evaluate((el) => {
		const r = el.getBoundingClientRect();
		return { x: r.left + el.clientLeft, y: r.top + r.height / 2, width: el.clientWidth };
	});
}

const position = (page: Page) =>
	page.evaluate(() => {
		const v = document.querySelector('video')!;
		return v.currentTime / v.duration;
	});

test('the portrait scrubber seeks on a tap and follows a drag, without scrolling', async ({
	page
}) => {
	test.setTimeout(60_000);
	const controls = await openPlayer(page);
	const track = controls.locator('.pscrub .track');
	const line = await lineBox(page);
	// A tap at the middle of the line lands at the middle of the episode.
	await page.touchscreen.tap(line.x + line.width * 0.5, line.y);
	await expect.poll(() => position(page)).toBeGreaterThan(0.45);
	expect(await position(page)).toBeLessThan(0.55);
	// It is a slider, reachable and announced as the landscape one is.
	await expect(track).toHaveAttribute('role', 'slider');
	await expect(track).toHaveAttribute('aria-label', 'Position');
	const now = Number(await track.getAttribute('aria-valuenow'));
	const max = Number(await track.getAttribute('aria-valuemax'));
	expect(max).toBeGreaterThan(0);
	expect(Math.abs(now / max - 0.5)).toBeLessThan(0.15);

	// The whole row's height is the finger's target, not the 4px line. Asked of
	// the hit test itself: Chromium's touch adjustment would carry a near miss
	// onto the line anyway, which a phone's other browsers do not promise.
	const row = (await controls.locator('.pscrub').boundingBox())!;
	const hits = await page.evaluate(
		([x, top, height]) => {
			const out: string[] = [];
			for (let dy = 2; dy <= height - 3; dy += 2) {
				const el = document.elementFromPoint(x, top + dy);
				if (!el?.closest('.pscrub .track')) out.push(`${dy}: ${el?.className}`);
			}
			return out;
		},
		[line.x + line.width * 0.3, row.y, row.height]
	);
	expect(hits).toEqual([]);

	// A drag from the middle to three quarters, a finger's move at a time, as
	// the screen sends it. The row is 44px; the finger is 19px below the
	// line, still inside the row (where a thumb actually lands) and past the
	// bar's own 14px reach, so the row's whole height is what is tested.
	// What keeps a drag from scrolling is the track's own `touch-action: none`:
	// the browser hands the finger to the page's handlers instead of panning.
	// Asked of the style, since the scroll check at the end is structural:
	// the row sits outside the scrolling .pbody and the page itself does not
	// scroll, so it would hold with or without the rule (finding 3).
	await expect(track).toHaveCSS('touch-action', 'none');
	const before = await page.evaluate(() => ({
		body: document.querySelector('.pbody')!.scrollTop,
		page: window.scrollY
	}));
	const cdp = await page.context().newCDPSession(page);
	const y = line.y + 19;
	const at = (f: number) => [{ x: line.x + line.width * f, y }];
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0.5) });
	for (let f = 0.52; f <= 0.75001; f += 0.023) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(f) });
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(0.75) });
	// While the finger is down, the time under it shows over the line.
	const tip = controls.locator('.pscrub .tip');
	await expect(tip).toBeVisible();
	await expect(tip).toHaveText(/^\d+:\d\d$/);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

	await expect.poll(() => position(page)).toBeGreaterThan(0.7);
	expect(await position(page)).toBeLessThan(0.8);
	await expect(tip).toBeHidden();
	const after = await page.evaluate(() => ({
		body: document.querySelector('.pbody')!.scrollTop,
		page: window.scrollY
	}));
	expect(after).toEqual(before);
});
