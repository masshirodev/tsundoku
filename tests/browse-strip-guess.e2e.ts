import { devices, type Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';
import { BROWSE_PORT, resetEngine, SOURCES } from './browse-world';
import sharp from 'sharp';

/**
 * A strip page still guessing its size (doc/READER.md "Vertical"): an
 * online page whose image is slow (held here by `page.route`) is never shorter
 * than one screen, and a forward key step goes no further than that page's top
 * at the top of the screen, so it is read rather than stepped over, and at a
 * chapter's end neither the end page nor the next chapter is reached. Wheel
 * and touch stay free. A page that failed does not hold the keys; one that
 * never answers holds for `GUESS_WAIT_MS` from the first step it stopped, not
 * from the chapter's mount. A stored page the manifest could not measure
 * learns its shape when it loads. Also: a box growing above the page being
 * read still keeps it, and the stop holds on the three key paths (a press's
 * glide, a held key, reduced motion).
 *
 * In the browse project, as it reads the BROWSE world's online source (where a
 * chapter with no file lives), at the tablet portrait with SIDES (a strip
 * narrower than the screen) and the phone (full width). The fake source's
 * pages are 600 × 900; this file serves its own, so each case knows the very
 * height that is a guess. Built on the parked attempt of Kantoku wave 42.
 */

const BROWSE = `http://localhost:${BROWSE_PORT}`;

/** A page image of a chosen size (the fake engine's arcade, made here). */
const image = (w: number, h: number) =>
	sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 50, b: 70 } } })
		.png()
		.toBuffer();

type Gates = { release: (n: number) => void };
/**
 * Holds the chosen pages of every chapter (as a slow source's would), aborts
 * one page as a source that lost it would, and serves the rest. A held page
 * stays "still guessing its shape": its box is the strip's guess, never a
 * loaded one. Page 1 is served at [page1]'s size, page 0 is a tall slice and
 * every other page a generic one.
 */
async function slowPages(
	page: Page,
	page1: { w: number; h: number },
	held: number[] = [0, 2],
	abort?: number,
	page0: { w: number; h: number } = { w: 600, h: 2500 }
): Promise<Gates> {
	const gates = new Map<number, { promise: Promise<void>; release: () => void }>();
	const gate = (n: number) => {
		if (!gates.has(n)) {
			let release = () => {};
			const promise = new Promise<void>((r) => (release = r));
			gates.set(n, { promise, release });
		}
		return gates.get(n)!;
	};
	const loaded = await image(page1.w, page1.h);
	const generic = await image(600, 900);
	const tall = await image(page0.w, page0.h);
	await page.route('**/api/entries/*/pages/*', async (route) => {
		const m = /\/api\/entries\/(\d+)\/pages\/(\d+)/.exec(new URL(route.request().url()).pathname);
		const n = m ? Number(m[2]) : 0;
		if (abort !== undefined && n === abort) return route.abort();
		if (held.includes(n)) await gate(n).promise;
		await route.fulfill({
			status: 200,
			headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' },
			body: n === 1 ? loaded : n === 0 ? tall : generic
		});
	});
	return { release: (n) => gate(n).release() };
}

/** A page whose request never answers at all: the source hangs, it does not fail. */
async function hungPage(page: Page, n: number) {
	await page.route('**/api/entries/*/pages/*', async (route) => {
		const m = /\/api\/entries\/(\d+)\/pages\/(\d+)/.exec(new URL(route.request().url()).pathname);
		if (m && Number(m[2]) === n) return; // never continues: still on its way
		await route.fallback();
	});
}

/** The strip page slot for a chapter's page, in document coordinates. */
const slotOf = (page: Page, id: number, i: number) =>
	page.locator(`.strip [data-role="page"][data-entry="${id}"][data-index="${i}"]`);
const topOf = (page: Page, id: number, i: number) =>
	page.evaluate(
		([entry, index]) => {
			const el = document.querySelector<HTMLElement>(
				`.strip [data-role="page"][data-entry="${entry}"][data-index="${index}"]`
			)!;
			return Math.round(el.getBoundingClientRect().top + scrollY);
		},
		[id, i] as const
	);
const heightOf = (page: Page, id: number, i: number) =>
	page.evaluate(
		([entry, index]) => {
			const el = document.querySelector<HTMLElement>(
				`.strip [data-role="page"][data-entry="${entry}"][data-index="${index}"] .page`
			)!;
			return Math.round(el.getBoundingClientRect().height);
		},
		[id, i] as const
	);
/** The page under the middle of the screen: what the strip calls the page being read. */
const middlePage = (page: Page) =>
	page.evaluate(() => {
		const mid = innerHeight / 2;
		for (const el of document.querySelectorAll<HTMLElement>('[data-role="page"]')) {
			const r = el.getBoundingClientRect();
			if (r.top <= mid && r.bottom >= mid)
				return { entry: Number(el.dataset.entry), index: Number(el.dataset.index) };
		}
		return null;
	});

async function openStrip(page: Page, sides = 0): Promise<number> {
	if (sides)
		await page.addInitScript(
			(s) => localStorage.setItem('tsundoku.reader.sides', String(s)),
			sides
		);
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-5' }).click();
	await page.locator('.cta-go .cta').click();
	await readerReady(page);
	const id = Number(new URL(page.url()).pathname.split('/').pop()!);
	// VERTICAL from the controls, the reader's own door (not a stored mode).
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /R→L ·/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.getByRole('radio', { name: 'VERTICAL' }).click();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.strip')).toBeVisible();
	// The chrome goes before a key is the reader's: with it up, the pad and a
	// focused cell own the arrows, and the strip's own step never fires.
	const banner = page.getByRole('banner', { name: 'Reader' });
	if (await banner.count()) await page.keyboard.press('Escape');
	await expect(banner).toHaveCount(0);
	// The strip's own effects finish after the switch (its chapter is built,
	// a box arrives), and one of them stops a hold: a key pressed in that
	// window is not the hold a reader would have. Wait for it to hold still.
	await still(page);
	return id;
}

/** The strip's own scroll (its window is the page). */
const scrollAt = (page: Page) => page.evaluate(() => Math.round(scrollY));
/** Put the strip's top at [y] without a key: scrolling is the reader's to do freely. */
const scrollTo = (page: Page, y: number) => page.evaluate((v) => window.scrollTo(0, v), y);

/** Playwright's `keyboard.down` sends no repeats, so a held key is down + repeats (~30/s). */
async function repeats(page: Page, count: number) {
	await page.evaluate(async (n) => {
		for (let i = 0; i < n; i++) {
			await new Promise((r) => setTimeout(r, 33));
			window.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'ArrowDown',
					code: 'ArrowDown',
					keyCode: 40,
					which: 40,
					repeat: true,
					bubbles: true,
					cancelable: true
				})
			);
		}
	}, count);
}

/** Wait until the strip holds still, and its scroll is final. */
async function still(page: Page): Promise<number> {
	let last = await scrollAt(page);
	let unchanged = 0;
	for (let i = 0; i < 100; i++) {
		await page.waitForTimeout(100);
		const now = await scrollAt(page);
		if (now === last) unchanged += 1;
		else unchanged = 0;
		last = now;
		if (unchanged >= 5) return now;
	}
	return last;
}

test.use({ baseURL: BROWSE, serviceWorkers: 'block' });

// Incognito: the chapter is a browsing record (not in the library), and its
// place would otherwise be saved and reopened on the next run, moving the
// strip under a case that has just placed it.
test.beforeEach(async ({ context }) => {
	await resetEngine();
	await context.addCookies([{ name: 'tsundoku_incognito', value: '1', url: BROWSE }]);
});

test.describe('a strip narrower than the screen (SIDES on a tablet)', () => {
	test.use({
		viewport: { width: 800, height: 1280 },
		userAgent: devices['Galaxy Tab S4'].userAgent,
		hasTouch: true,
		isMobile: true
	});

	test('↓ from a page that has loaded lands on the next, not two on', async ({ page }) => {
		test.setTimeout(90_000);
		// The strip is 320px wide; this page is 800px tall (past half the
		// screen, so the middle starts on it), and the next one's guess
		// without a min-height would be the same.
		await slowPages(page, { w: 800, h: 2000 });
		const id = await openStrip(page, 30);
		await expect(slotOf(page, id, 1).locator('img')).toBeVisible({ timeout: 20_000 });
		const one = await topOf(page, id, 1);
		const two = await topOf(page, id, 2);
		// The page after the loaded one is still guessing, and a screen tall:
		// the rule the card is about.
		expect(await heightOf(page, id, 2)).toBeGreaterThanOrEqual(1280);
		await scrollTo(page, one);
		await page.keyboard.press('ArrowDown');
		const y = await still(page);
		expect(y).toBeGreaterThanOrEqual(two);
		expect(y).toBeLessThan(two + (await heightOf(page, id, 2)));
		expect(await middlePage(page)).toEqual({ entry: id, index: 2 });
	});

	test('↓ never passes the last page still loading, into the end page', async ({ page }) => {
		test.setTimeout(90_000);
		await slowPages(page, { w: 800, h: 2000 });
		const id = await openStrip(page, 30);
		await expect(slotOf(page, id, 1).locator('img')).toBeVisible({ timeout: 20_000 });
		const two = await topOf(page, id, 2);
		// Inside the last page, past its top: the stop is what keeps the reader
		// in it; without it the step passes the end marker into the next chapter.
		await scrollTo(page, two + 400);
		const endTop = await page
			.locator(`.strip [data-role="end"][data-entry="${id}"]`)
			.evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY));
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
		const y = await still(page);
		expect(y).toBeLessThan(two + (await heightOf(page, id, 2)));
		expect(y).toBeLessThan(endTop);
	});
});

test.describe('a strip at full width (a phone)', () => {
	test.use({
		viewport: { width: 390, height: 844 },
		userAgent: devices['Pixel 7'].userAgent,
		hasTouch: true,
		isMobile: true
	});

	test('↓ from a page that has loaded lands on the next, not two on', async ({ page }) => {
		test.setTimeout(90_000);
		await slowPages(page, { w: 800, h: 1025 });
		const id = await openStrip(page);
		await expect(slotOf(page, id, 1).locator('img')).toBeVisible({ timeout: 20_000 });
		const one = await topOf(page, id, 1);
		const two = await topOf(page, id, 2);
		expect(await heightOf(page, id, 2)).toBeGreaterThanOrEqual(844);
		await scrollTo(page, one);
		await page.keyboard.press('ArrowDown');
		const y = await still(page);
		expect(y).toBeGreaterThanOrEqual(two);
		expect(y).toBeLessThan(two + (await heightOf(page, id, 2)));
		expect(await middlePage(page)).toEqual({ entry: id, index: 2 });
	});

	test('the wheel still crosses a page while it loads', async ({ page }) => {
		test.setTimeout(90_000);
		await slowPages(page, { w: 800, h: 1025 });
		const id = await openStrip(page);
		await expect(slotOf(page, id, 1).locator('img')).toBeVisible({ timeout: 20_000 });
		const two = await topOf(page, id, 2);
		// The same place a key stops at, scrolled by a wheel instead: the rule is
		// the keys', and a thumb or a wheel reads on while the page loads.
		await scrollTo(page, two + 400);
		await still(page);
		const before = await scrollAt(page);
		// The key at this very spot is refused...
		await page.keyboard.press('ArrowDown');
		expect(await still(page)).toBe(before);
		// ...and the wheel moves on regardless.
		await page.mouse.move(195, 400);
		await page.mouse.wheel(0, 600);
		await expect.poll(() => scrollAt(page)).toBeGreaterThan(before + 100);
	});

	test('a held ↓ reaches a page still loading and stops there', async ({ page }) => {
		test.setTimeout(90_000);
		// Only the last page is slow: pages 0 and 1 have loaded, so a held ↓
		// really travels before it reaches the page it must stop at.
		await slowPages(page, { w: 800, h: 1025 }, [2]);
		const id = await openStrip(page);
		await expect(slotOf(page, id, 0).locator('img')).toBeVisible({ timeout: 20_000 });
		await expect(slotOf(page, id, 1).locator('img')).toBeVisible({ timeout: 20_000 });
		await scrollTo(page, await topOf(page, id, 0));
		await still(page);
		const start = await scrollAt(page);
		const two = await topOf(page, id, 2);
		await page.keyboard.down('ArrowDown');
		// The hold is running (a ramp of its own) before it meets the page.
		await repeats(page, 6);
		expect((await scrollAt(page)) - start).toBeGreaterThan(100);
		await repeats(page, 30);
		await page.keyboard.up('ArrowDown');
		const y = await still(page);
		// It stopped with the guessing page under the middle, not past it.
		expect(y).toBeLessThan(two + (await heightOf(page, id, 2)));
		expect(await middlePage(page)).toEqual({ entry: id, index: 2 });
	});

	test('a page that did not load does not hold the keys', async ({ page }) => {
		test.setTimeout(90_000);
		// Every attempt at page 2 is aborted, as a source that lost it: RETRY
		// cannot help, and the box stays a screen tall.
		await slowPages(page, { w: 800, h: 1025 }, [], 2);
		const id = await openStrip(page);
		const failed = slotOf(page, id, 2).locator('.failed');
		await slotOf(page, id, 2).evaluate((el) => el.scrollIntoView({ block: 'start' }));
		await expect(failed.getByText(/DID NOT LOAD/)).toBeVisible({ timeout: 20_000 });
		const one = await topOf(page, id, 1);
		await scrollTo(page, one);
		await still(page);
		const two = await topOf(page, id, 2);
		const box = await heightOf(page, id, 2);
		const middle = await page.evaluate(() => innerHeight / 2);
		// Still drawn a screen tall, and no longer a stop: a failed page must
		// not end a TV's chapter (a TV has no wheel or thumb to go round it).
		expect(box).toBeGreaterThanOrEqual(844);
		await page.keyboard.press('ArrowDown');
		await still(page);
		await page.keyboard.press('ArrowDown');
		const y = await still(page);
		expect(y + middle).toBeGreaterThan(two + box);
		expect(await middlePage(page)).not.toEqual({ entry: id, index: 2 });
	});

	test('two pages still loading keep the first under the middle', async ({ page }) => {
		test.setTimeout(90_000);
		// Page 0 is loaded and short; pages 1 and 2 are on their way, and a
		// short `last` leaves their boxes at the one-screen minimum. That is
		// the case the old rule let a second press put the middle on page 2,
		// and then kept it there.
		const gates = await slowPages(page, { w: 800, h: 1025 }, [1, 2], undefined, {
			w: 800,
			h: 1025
		});
		const id = await openStrip(page);
		await expect(slotOf(page, id, 0).locator('img')).toBeVisible({ timeout: 20_000 });
		const one = await topOf(page, id, 1);
		await scrollTo(page, one);
		await still(page);
		const box = await heightOf(page, id, 1);
		const middle = await page.evaluate(() => innerHeight / 2);
		expect(box).toBeGreaterThanOrEqual(844);
		expect(box).toBeLessThan(1000);
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press('ArrowDown');
			await page.waitForTimeout(400);
		}
		const y = await still(page);
		expect(y + middle).toBeLessThanOrEqual(one + box);
		expect(await middlePage(page)).toEqual({ entry: id, index: 1 });
		// Both arrive: `reshaped` keeps the page that was under the middle.
		gates.release(1);
		gates.release(2);
		await expect.poll(() => heightOf(page, id, 1)).toBeLessThan(700);
		await expect.poll(() => middlePage(page)).toEqual({ entry: id, index: 1 });
	});

	test('a page that never answers holds for its limit from its own first stop', async ({
		page
	}) => {
		test.setTimeout(120_000);
		await slowPages(page, { w: 800, h: 1025 }, []);
		await hungPage(page, 2);
		const id = await openStrip(page);
		await expect(slotOf(page, id, 1).locator('img')).toBeVisible({ timeout: 20_000 });
		// Read slowly: past the limit since the chapter was built, which is
		// where the parked attempt's clock started and had already let go.
		await page.waitForTimeout(11_000);
		const two = await topOf(page, id, 2);
		await scrollTo(page, two + 200);
		await still(page);
		const box = await heightOf(page, id, 2);
		const middle = await page.evaluate(() => innerHeight / 2);
		// The first step this page meets still holds: its wait starts now.
		await page.keyboard.press('ArrowDown');
		expect(await still(page)).toBe(two + 200);
		// Held at it for the limit, it lets go: a source that hangs cannot end
		// a TV's chapter. The box is still a screen tall and still waiting.
		await page.waitForTimeout(11_000);
		await page.keyboard.press('ArrowDown');
		const y = await still(page);
		expect(y + middle).toBeGreaterThan(two + box);
	});

	test('reduced motion keeps the stop too', async ({ page }) => {
		test.setTimeout(90_000);
		await slowPages(page, { w: 800, h: 1025 });
		const id = await openStrip(page);
		await expect(slotOf(page, id, 1).locator('img')).toBeVisible({ timeout: 20_000 });
		const two = await topOf(page, id, 2);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await scrollTo(page, two + 400);
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
		const y = await still(page);
		expect(y).toBeLessThan(two + (await heightOf(page, id, 2)));
	});

	test('a box growing above the page being read still keeps it', async ({ page }) => {
		test.setTimeout(90_000);
		const gates = await slowPages(page, { w: 800, h: 1025 });
		const id = await openStrip(page);
		await expect(slotOf(page, id, 1).locator('img')).toBeVisible({ timeout: 20_000 });
		const one = await topOf(page, id, 1);
		// From the loaded page's top, one ↓ stops inside the guessing one.
		await scrollTo(page, one);
		await page.keyboard.press('ArrowDown');
		await still(page);
		expect(await middlePage(page)).toEqual({ entry: id, index: 2 });
		// Page 0 arrives now, far taller than the guess it wore above page 1.
		gates.release(0);
		await expect.poll(() => heightOf(page, id, 0)).toBeGreaterThan(1000);
		// `reshaped` kept the page under the middle: the two rules do not fight.
		await expect.poll(() => middlePage(page)).toEqual({ entry: id, index: 2 });
	});
});

test.describe('a stored page the manifest could not measure', () => {
	// The seeded library, not the online world: `imageSize` cannot read an AVIF
	// or JXL (both admitted by the page route), nor a JPEG whose frame header is
	// past the 64 KiB head it takes, so such a page's manifest says `{w: 0,
	// h: 0}`. The strip's neighbour chapters ask for their manifests over the
	// API, which is where this one is made sizeless; the opened chapter's own
	// comes in its page's load.
	test.use({
		baseURL: `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '4183'}`,
		serviceWorkers: 'block',
		viewport: { width: 390, height: 844 },
		userAgent: devices['Pixel 7'].userAgent,
		hasTouch: true,
		isMobile: true
	});

	test('a loaded page is never a guess, and ↓ crosses it', async ({ page }) => {
		test.setTimeout(120_000);
		await page.route('**/api/entries/*/pages', async (route) => {
			const answer = await route.fetch();
			const list = (await answer.json()) as { pages: { w: number; h: number }[] };
			// One page with no size at all, as a stored page the reader could not
			// measure.
			list.pages = list.pages.map((p, i) => (i === 5 ? { w: 0, h: 0 } : p));
			await route.fulfill({ response: answer, json: list });
		});
		await page.goto('/?sort=title');
		await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
		await page.waitForURL(/\/series\/\d+/);
		await page.getByRole('link', { name: /▶/ }).first().click();
		await readerReady(page);
		const id = Number(new URL(page.url()).pathname.split('/').pop()!);
		// VERTICAL from READING's sheet, the reader's own door.
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: /R→L ·/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'VERTICAL' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.strip')).toBeVisible();
		// The neighbour on the strip is the chapter whose manifest came over the
		// API; the opened chapter's page 5 kept the size its own load gave it.
		const other = page.locator(`.strip [data-role="page"]:not([data-entry="${id}"])`).first();
		await expect(other, 'a neighbouring chapter on the strip').toHaveCount(1, {
			timeout: 20_000
		});
		const next = Number(await other.getAttribute('data-entry'));
		const slot = slotOf(page, next, 5);
		await expect(slot).toHaveCount(1, { timeout: 20_000 });
		await slot.evaluate((el) => el.scrollIntoView({ block: 'start' }));
		await expect(slot.locator('img')).toBeVisible({ timeout: 20_000 });
		// Its box is the page's own shape now, not a screen: 800 × 1136 at this
		// strip's width is about 553 px, where the guess held 844.
		await expect.poll(() => heightOf(page, next, 5)).toBeLessThan(700);
		const top = await topOf(page, next, 5);
		const box = await heightOf(page, next, 5);
		const middle = await page.evaluate(() => innerHeight / 2);
		await page.keyboard.press('ArrowDown');
		const y = await still(page);
		// A loaded page is not a guess, so the step crosses it.
		expect(y + middle).toBeGreaterThan(top + box);
	});
});
