import type { Page } from '@playwright/test';
import { expect, test } from './helpers/hydrated';

/**
 * A novel's paged turn follows the finger and slides (c441; doc/TEXT-READER.md,
 * "Turning"), as a manga's does: a drag short of the swipe threshold moves the
 * page and gives it back, one past it turns, keys and taps slide too, a turn
 * asked for mid-slide is taken when it lands, a chapter's neighbour slides in
 * across the boundary, and reduced motion turns at once. It runs on every
 * device project because the page's width, its columns (two in landscape) and
 * the pointer differ on each. Read-only: it reads Mushoku Tensei in incognito,
 * so no progress is written (as tests/tv-text-reader.e2e.ts does), and no flow
 * file groups or removes that series. The seed's chapters are fourteen
 * paragraphs, a spread or two at the default size, so each context starts with
 * this device's type at its largest in one column (the device's own settings,
 * in a context that starts empty), which gives every project a chapter of
 * several pages to turn within.
 */

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
	await page.addInitScript(() => {
		if (!localStorage.getItem('tsundoku.text.settings'))
			localStorage.setItem(
				'tsundoku.text.settings',
				JSON.stringify({ size: 30, line: 1.8, margins: 'wide', columns: false })
			);
	});
});

/** A chapter's id, from the series screen's own ▶ (not the sidebar's GET STARTED). */
async function firstChapter(page: Page): Promise<string> {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Mushoku Tensei' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('link', { name: /^(?!GET).*(READ AGAIN|CONTINUE|START|▶)/ })
		.first()
		.click();
	await page.waitForURL(/\/read\/\d+/);
	return /\/read\/(\d+)/.exec(page.url())![1];
}

/** Open chapter `id` at its first page. */
async function openAt(page: Page, id: string) {
	await page.goto(`/read/${id}?at=0.0`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('.flow')).toHaveCSS('font-size', '30px');
}

/** The flow has stopped sliding: the turn, or the drag's return, has landed. */
const landed = (page: Page) => expect(page.locator('.flow')).not.toHaveClass(/sliding/);

/** How far the flow is translated along its axis, and one page's step. */
const flow = (page: Page) =>
	page.locator('.flow').evaluate((el: HTMLElement) => {
		const m = /translate([XY])\((-?[\d.]+)px\)/.exec(el.style.transform);
		const pageBox = el.parentElement!;
		const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
		const vertical = m?.[1] === 'Y';
		return {
			axis: m?.[1] ?? '',
			at: Number(m?.[2] ?? 0) || 0,
			step: (vertical ? pageBox.clientHeight : pageBox.clientWidth) + gap,
			pages: Math.round(
				((vertical ? el.scrollHeight : el.scrollWidth) + gap) /
					((vertical ? pageBox.clientHeight : pageBox.clientWidth) + gap)
			),
			heading: el.querySelector('.blocks h1')?.textContent ?? ''
		};
	});

/**
 * Count the flow's transform transitions from now on: the witness that a turn
 * slid, which a fixed wait could miss on a loaded machine (the event fires
 * whatever the frame rate).
 */
async function countSlides(page: Page) {
	await page.evaluate(() => {
		const w = window as unknown as { slides: number };
		w.slides = 0;
		document.querySelector('.flow')!.addEventListener('transitionrun', (e) => {
			if ((e as TransitionEvent).propertyName === 'transform') w.slides++;
		});
	});
	return () => page.evaluate(() => (window as unknown as { slides: number }).slides);
}

/** The middle of the page, where a drag starts: no strip, no illustration. */
function middleOf(page: Page) {
	const v = page.viewportSize()!;
	return { x: v.width / 2, y: v.height / 2 };
}

test('a drag short of the threshold follows the finger and goes back; past it, the page turns (c441)', async ({
	page
}) => {
	const id = await firstChapter(page);
	await openAt(page, id);
	const start = await flow(page);
	expect(start.axis).toBe('X');
	expect(start.at).toBe(0);
	expect(start.pages).toBeGreaterThanOrEqual(3);
	const slides = await countSlides(page);
	const { x, y } = middleOf(page);

	// 24px to the left, under the 40px swipe: the page is 24px over, and back on release.
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 24, y, { steps: 4 });
	expect((await flow(page)).at).toBe(-24);
	await page.mouse.up();
	await expect.poll(async () => (await flow(page)).at).toBe(0);
	await landed(page);
	expect(await slides()).toBe(1);

	// 140px: past it. The page slides the rest of the way and stays one step on.
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 140, y, { steps: 6 });
	expect((await flow(page)).at).toBe(-140);
	await page.mouse.up();
	await expect.poll(async () => (await flow(page)).at).toBe(-start.step);
	await landed(page);
	expect(await slides()).toBe(2);
	expect((await flow(page)).heading).toBe(start.heading);

	// Back past the first page, the other way: nothing lies there in this
	// chapter (it is the first), so the page gives a quarter of the finger.
	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => (await flow(page)).at).toBe(0);
	await landed(page);
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 24, y, { steps: 4 });
	expect((await flow(page)).at).toBe(6);
	await page.mouse.move(x, y, { steps: 2 });
	await page.mouse.up();
	await expect.poll(async () => (await flow(page)).at).toBe(0);
});

test('keys slide, and a turn asked for mid-slide is taken when it lands (c441)', async ({
	page
}) => {
	const id = await firstChapter(page);
	await openAt(page, id);
	const { step, pages } = await flow(page);
	expect(pages).toBeGreaterThanOrEqual(3);
	const slides = await countSlides(page);
	// Two presses inside one 220 ms slide: both count.
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => (await flow(page)).at).toBe(-2 * step);
	await landed(page);
	expect(await slides()).toBe(2);
	// Settled: nothing more is waiting to turn.
	await page.waitForTimeout(500);
	expect((await flow(page)).at).toBe(-2 * step);
	// And back, by key.
	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => (await flow(page)).at).toBe(-step);
	await landed(page);
	expect(await slides()).toBe(3);
});

test("across a chapter's end the next chapter's first page slides in, and back its last (c441)", async ({
	page
}) => {
	const id = await firstChapter(page);
	await openAt(page, id);
	const first = await flow(page);
	expect(first.pages).toBeGreaterThanOrEqual(3);
	const lastAt = -(first.pages - 1) * first.step;
	// To the chapter's last page, a turn at a time.
	for (let i = 1; i < first.pages; i++) {
		await page.keyboard.press('ArrowRight');
		await expect.poll(async () => (await flow(page)).at).toBe(-i * first.step);
		await landed(page);
	}
	const slides = await countSlides(page);

	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => (await flow(page)).heading).not.toBe(first.heading);
	await expect.poll(async () => (await flow(page)).at).toBe(0);
	await landed(page);
	// The flow is a new chapter's, but the same element: the slide in is on it.
	expect(await slides()).toBe(1);

	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => (await flow(page)).heading).toBe(first.heading);
	await expect.poll(async () => (await flow(page)).at).toBe(lastAt);
	await landed(page);
	expect(await slides()).toBe(2);
	// And it stays on the last page when the chapter is laid out again, as an
	// illustration arriving late lays it out (the reader listens for `load`).
	await page.evaluate(() => window.dispatchEvent(new Event('load')));
	await page.waitForTimeout(500);
	expect((await flow(page)).at).toBe(lastAt);
});

test('with reduced motion a turn is instant and a drag does not move the page (c441)', async ({
	page
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const id = await firstChapter(page);
	await openAt(page, id);
	const { step, pages } = await flow(page);
	expect(pages).toBeGreaterThanOrEqual(3);
	const slides = await countSlides(page);
	const { x, y } = middleOf(page);

	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 24, y, { steps: 4 });
	expect((await flow(page)).at).toBe(0);
	await page.mouse.move(x - 140, y, { steps: 4 });
	expect((await flow(page)).at).toBe(0);
	await page.mouse.up();
	// Turned, at once: no transition ran.
	await expect.poll(async () => (await flow(page)).at).toBe(-step);
	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => (await flow(page)).at).toBe(-2 * step);
	expect(await slides()).toBe(0);
});
