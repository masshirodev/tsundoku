import { type Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';

/**
 * The reader end to end (doc/READER.md), on the seed library's generated
 * sample pages. Serial, tablet-portrait only. This file owns Hikaru ga
 * Shinda Natsu (paged), The Greatest Estate Developer (vertical) and
 * Chainsaw Man (end of series), and restores what it changes.
 */
test.describe.configure({ mode: 'serial' });

async function seriesId(page: Page, title: string) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	return Number(page.url().match(/\/series\/(\d+)/)![1]);
}

/** Tap at a fraction of the screen's width, mid-height: a finger, not a mouse (mouseAction). */
async function tap(page: Page, x: number) {
	const vp = page.viewportSize()!;
	await page.touchscreen.tap(vp.width * x, vp.height / 2);
}

const meta = (page: Page) => page.locator('header[aria-label="Reader"] .meta');

test('CONTINUE opens the reader where the chapter was left', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await expect(page.locator('[data-page]')).toHaveCount(1);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
});

test('the middle shows the controls; in R→L the left edge turns forward', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const entry = page.url().match(/\/read\/(\d+)/)![1];
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');

	await tap(page, 0.5);
	await expect(meta(page)).toContainText('P. 3 OF');
	await tap(page, 0.5);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);

	await tap(page, 0.05);
	await tap(page, 0.5);
	await expect(meta(page)).toContainText('P. 4 OF');
	await tap(page, 0.5);
	await tap(page, 0.95);
	await tap(page, 0.5);
	await expect(meta(page)).toContainText('P. 3 OF');
});

test('with a mouse, a click turns forward and a right click back, in R→L as in L→R', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	const entry = page.url().match(/\/read\/(\d+)/)![1];
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const vp = page.viewportSize()!;
	// Anywhere, the middle included: the buttons, not the side, say which way.
	await page.mouse.click(vp.width * 0.5, vp.height / 2);
	await page.mouse.click(vp.width * 0.95, vp.height / 2);
	await expect(page).toHaveURL(/p=5/);
	await page.mouse.click(vp.width * 0.05, vp.height / 2, { button: 'right' });
	await expect(page).toHaveURL(/p=4/);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	await page.mouse.click(vp.width * 0.5, vp.height / 2, { button: 'middle' });
	await expect(meta(page)).toContainText('P. 4 OF');
});

test('the last page leads to the chapter boundary, and a tap on into the next chapter', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const first = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	await page.goto(`${first}?p=last`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await tap(page, 0.05);
	await expect(page.getByText(/^END · CH\. \d+$/)).toBeVisible();
	await expect(page.getByText('← TAP OR SWIPE TO CONTINUE')).toBeVisible();
	const before = page.url();
	await tap(page, 0.05);
	await expect(page).not.toHaveURL(before);
	await expect(page).toHaveURL(/\/read\/\d+/);
});

test('going on into the next chapter starts it at page 1, not where it was left', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const cont = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	// The tests before leave CONTINUE on the last chapter: back from its first
	// page is the chapter before it, which has one after.
	await page.goto(`${cont}?p=1`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await tap(page, 0.95);
	await expect(page).toHaveURL(/p=last/);
	const first = new URL(page.url()).pathname;
	const toNext = async () => {
		await page.goto(`${first}?p=last`);
		await readerReady(page);
		await page.waitForLoadState('networkidle');
		await tap(page, 0.05);
		await expect(page.getByText('← TAP OR SWIPE TO CONTINUE')).toBeVisible();
		const before = page.url();
		await tap(page, 0.05);
		await expect(page).not.toHaveURL(before);
	};
	await toNext();
	const next = new URL(page.url()).pathname;
	// Leave the next chapter part-read, on page 4.
	await page.goto(`${next}?p=4`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await expect(page).toHaveURL(/p=4/, { timeout: 5000 });

	await toNext();
	await expect(page).toHaveURL(new RegExp(`${next}\\?p=1$`));
	await readerReady(page);
	await tap(page, 0.5);
	await expect(meta(page)).toContainText('P. 1 OF');
});

test('progress is saved: a reload resumes on the same page', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const href = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	await page.goto(`${href}?p=5`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	// Settled on a page: the page event goes out and the URL keeps it.
	await expect(page).toHaveURL(/p=5/, { timeout: 5000 });
	await page.goto(href!);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await tap(page, 0.5);
	await expect(meta(page)).toContainText('P. 5 OF');
});

test('the READING sheet switches mode for the session and offers REMEMBER', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await tap(page, 0.5);
	await page.getByRole('button', { name: /R→L · FIT SCREEN/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet.getByText('SERIES DEFAULT R→L')).toBeVisible();
	// The page, at this sheet's section (card c171).
	await expect(sheet.getByRole('link', { name: /ALL SETTINGS →/ })).toHaveAttribute(
		'href',
		'/settings?section=images'
	);
	await sheet.getByRole('radio', { name: 'L→R' }).click();
	await expect(sheet.getByRole('button', { name: 'REMEMBER L→R' })).toBeVisible();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.getByRole('button', { name: /L→R · FIT SCREEN/ })).toBeVisible();
	// In L→R the right edge turns forward. The controls are still up.
	const now = await meta(page).textContent();
	await tap(page, 0.5);
	await tap(page, 0.95);
	await tap(page, 0.5);
	await expect(meta(page)).not.toHaveText(now!);
});

test('vertical scroll: pages stitched, a ruled band, then the next chapter', async ({ page }) => {
	await seriesId(page, 'The Greatest Estate Developer');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const before = page.url().replace(/\?.*$/, '');
	const first = before.match(/\/read\/(\d+)/)![1];
	await expect(page.locator('.strip')).toBeVisible();
	// The band into the next chapter: the last one, since the previous chapter may sit above.
	const band = page.locator(`.band[data-between^="${first}-"]`);
	await band.evaluate((b) => b.scrollIntoView({ block: 'center' }));
	await expect(band.getByText('↕ KEEP SCROLLING')).toBeVisible();
	for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
	await expect(page).not.toHaveURL(new RegExp(`^${before}(\\?|$)`), { timeout: 5000 });

	// Like Mihon: the chapter just left is still there, and scrolling back up
	// past the band goes back into it.
	await expect(page.locator(`[data-entry="${first}"][data-role="page"]`).first()).toBeAttached();
	for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
	await expect(page).toHaveURL(new RegExp(`/read/${first}\\?`), { timeout: 5000 });
});

test('vertical: nothing moves when chapters arrive above, or when the reader crosses a band', async ({
	page
}) => {
	await seriesId(page, 'The Greatest Estate Developer');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const first = page.url().match(/\/read\/(\d+)/)![1];
	const topOf = (sel: string) =>
		page
			.locator(sel)
			.first()
			.evaluate((e) => Math.round(e.getBoundingClientRect().top));
	// Opened where it was left, with the previous chapter loaded above it
	// since: that page of this chapter still starts at the top, not a band's
	// height or a chapter's height away.
	await expect(page.locator(`[data-entry="${first}"][data-index="0"]`)).toBeAttached();
	await expect(page.locator(`.band[data-between$="-${first}"]`)).toBeAttached();
	await expect(
		page.locator(`[data-role="page"]:not([data-entry="${first}"])`).first()
	).toBeAttached();
	const atTop = await page.evaluate(() => {
		const el = document.elementFromPoint(innerWidth / 2, 2)?.closest<HTMLElement>('[data-role]');
		return (
			el && {
				entry: el.dataset.entry,
				index: el.dataset.index,
				top: Math.round(el.getBoundingClientRect().top)
			}
		);
	});
	expect(atTop).toMatchObject({ entry: first });
	expect(Math.abs(atTop!.top)).toBeLessThan(4);

	// Put the next chapter's first page just over the middle line, and let the
	// reader cross into it and reshape the strip.
	const nextId = await page
		.locator(`.band[data-between^="${first}-"]`)
		.getAttribute('data-between')
		.then((b) => b!.split('-')[1]);
	const target = `[data-entry="${nextId}"][data-index="0"]`;
	await page.locator(target).evaluate((e) => {
		const y = innerHeight / 2 - 40;
		scrollBy(0, e.getBoundingClientRect().top - y);
	});
	await expect(page).toHaveURL(new RegExp(`/read/${nextId}\\?`));
	await page.waitForLoadState('networkidle');
	await expect.poll(() => topOf(target)).toBeGreaterThan(0);
	const vh = page.viewportSize()!.height;
	expect(Math.abs((await topOf(target)) - (vh / 2 - 40))).toBeLessThan(4);
});

test('the end of the series asks for a rating while unrated, and it saves', async ({ page }) => {
	const id = await seriesId(page, 'Chainsaw Man');
	const rate = (n: number) =>
		page.request.post(`/series/${id}?/rate`, {
			headers: { origin: 'http://localhost:4183', 'x-sveltekit-action': 'true' },
			form: { rating: String(n) }
		});
	await rate(0);
	// The last chapter: its row is the last entry in the list.
	await page.goto(`/series/${id}`);
	await page.getByRole('button', { name: 'Go to chapter number' }).click();
	await page.getByLabel('GO TO #').fill('200');
	await page.keyboard.press('Enter');
	await page.locator('.entry:has(.num:text-is("200")) .entry-btn').click();
	await readerReady(page);
	const entry = page.url().match(/\/read\/(\d+)/)![1];
	await page.goto(`/read/${entry}?p=last`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await tap(page, 0.05);
	await expect(page.getByText('END · LAST AVAILABLE')).toBeVisible();
	await expect(page.getByText('SHOWN WHILE UNRATED · RATING SAVES WHEN YOU LET GO')).toBeVisible();
	await page.getByRole('button', { name: 'Rate 8 of 10' }).click();
	await page.goto(`/series/${id}`);
	await expect(
		page
			.getByRole('region', { name: 'About this series' })
			.getByRole('button', { name: 'Rate 8 of 10' })
	).toHaveAttribute('aria-pressed', 'true');
});

test('incognito shows a dashed rule, INCOGNITO, and NOT SAVED', async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await expect(page.locator('.dashed')).toBeVisible();
	await tap(page, 0.5);
	await expect(page.getByRole('banner', { name: 'Reader' }).getByText('INCOGNITO')).toBeVisible();
	await expect(meta(page)).toContainText('NOT SAVED');
});

test('a finger’s first paged chapter says how pages turn, once per device', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const first = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	await page.goto(first!);
	await readerReady(page);
	// R→L: forward is to the left.
	const hint = page.getByText('← SWIPE OR TAP THE EDGES TO TURN');
	await expect(hint).toBeVisible();
	// It never takes a tap: the edge under it still turns.
	await tap(page, 0.05);
	await expect(hint).toHaveCount(0);
	await page.reload();
	await readerReady(page);
	await page.waitForTimeout(500);
	await expect(hint).toHaveCount(0);
});

test('vertical, on a PC: a wheel notch eases, ↓ and ↑ move a screen (c192)', async ({ page }) => {
	await seriesId(page, 'The Greatest Estate Developer');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await expect(page.locator('.strip')).toBeVisible();
	// Settled: no chapter still arriving above to keep the place for.
	await page.waitForTimeout(500);
	await page.mouse.move(400, 640);
	const y = () => page.evaluate(() => scrollY);
	const track = () =>
		page.evaluate(() => {
			const w = window as unknown as { ys: number[] };
			w.ys = [];
			const t = () => {
				w.ys.push(scrollY);
				if (w.ys.length < 60) requestAnimationFrame(t);
			};
			requestAnimationFrame(t);
		});
	const seen = () => page.evaluate(() => (window as unknown as { ys: number[] }).ys);

	// A notch: on its way through more than one place, not a jump, landing where
	// the event aimed. Its delta in CSS pixels is the device's scaled down
	// (44.44 for 100 at this project's 2.25): what a browser would scroll.
	const y0 = await y();
	await page.evaluate(() =>
		addEventListener('wheel', (e) => ((window as unknown as { delta: number }).delta = e.deltaY), {
			once: true,
			capture: true
		})
	);
	await track();
	await page.mouse.wheel(0, 100);
	await page.waitForTimeout(700);
	const ys = await seen();
	const delta = await page.evaluate(() => (window as unknown as { delta: number }).delta);
	expect(new Set(ys.filter((v) => v > y0 && v < y0 + delta)).size).toBeGreaterThan(2);
	// Within a pixel: the browser snaps a fractional scroll (44.44 here) to its own grid.
	expect(Math.abs((await y()) - y0 - delta)).toBeLessThanOrEqual(1);

	// ↓ a screen, less a little so the last line stays in sight; ↑ back.
	const screen = await page.evaluate(() => Math.round(innerHeight * 0.85));
	const y1 = await y();
	await page.keyboard.press('ArrowDown');
	await expect.poll(async () => Math.abs((await y()) - y1 - screen)).toBeLessThanOrEqual(1);
	await page.keyboard.press('ArrowUp');
	await expect.poll(async () => Math.abs((await y()) - y1)).toBeLessThanOrEqual(1);

	// Ctrl + ↓ / ↑ nudge, for a panel the screen cut in two.
	await page.keyboard.press('Control+ArrowDown');
	await expect.poll(async () => Math.abs((await y()) - y1 - 40)).toBeLessThanOrEqual(1);
	await page.keyboard.press('Control+ArrowUp');
	await expect.poll(async () => Math.abs((await y()) - y1)).toBeLessThanOrEqual(1);
});

test('vertical: turning the device keeps the page being read under the middle', async ({
	page
}) => {
	await seriesId(page, 'The Greatest Estate Developer');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const entry = page.url().match(/\/read\/(\d+)/)![1];
	// A few pages in, a third of the way down one.
	const target = page.locator(`[data-entry="${entry}"][data-index="2"]`);
	await target.evaluate((e) => {
		const r = e.getBoundingClientRect();
		scrollBy(0, r.top + r.height / 3 - innerHeight / 2);
	});
	const middle = () =>
		page.evaluate(() => {
			const el = document
				.elementFromPoint(innerWidth / 2, innerHeight / 2)
				?.closest<HTMLElement>('[data-role="page"]');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return {
				entry: el.dataset.entry,
				index: el.dataset.index,
				at: Math.round(((innerHeight / 2 - r.top) / r.height) * 100)
			};
		});
	await expect.poll(middle).toEqual({ entry, index: '2', at: 33 });
	const portrait = page.viewportSize()!;
	await page.setViewportSize({ width: portrait.height, height: portrait.width });
	await expect.poll(middle).toMatchObject({ entry, index: '2' });
	expect(Math.abs((await middle())!.at - 33)).toBeLessThanOrEqual(1);
	await page.setViewportSize(portrait);
	await expect.poll(middle).toMatchObject({ entry, index: '2' });
	expect(Math.abs((await middle())!.at - 33)).toBeLessThanOrEqual(1);
	// The reader didn't wander off with the layout either.
	await expect(page).toHaveURL(new RegExp(`/read/${entry}\\?p=3`));
});

test('a finger held on a page never opens the browser’s image menu; a right click still does', async ({
	page
}) => {
	await seriesId(page, 'The Greatest Estate Developer');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	// The vertical strip is where the reader lets a right click through, so
	// it's the one place the difference shows.
	const img = page.locator('[data-role="page"] img').first();
	const held = (pointerType: string) =>
		img.evaluate((el, pointerType) => {
			el.dispatchEvent(new PointerEvent('pointerdown', { pointerType, bubbles: true }));
			const shown = el.dispatchEvent(
				new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
			);
			el.dispatchEvent(new PointerEvent('pointerup', { pointerType, bubbles: true }));
			return shown;
		}, pointerType);
	expect(await held('touch')).toBe(false);
	expect(await held('mouse')).toBe(true);
});

test('vertical: SIDES brings the strip in from both edges, and is kept on the device', async ({
	page
}) => {
	await seriesId(page, 'The Greatest Estate Developer');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const vw = page.viewportSize()!.width;
	const width = () => page.locator('.strip').evaluate((e) => e.getBoundingClientRect().width);
	expect(await width()).toBe(vw);
	await tap(page, 0.5);
	await page.getByRole('button', { name: /VERTICAL/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.getByRole('radio', { name: '20%' }).click();
	expect(await width()).toBeCloseTo(vw * 0.6, 0);
	await page.reload();
	await readerReady(page);
	expect(await width()).toBeCloseTo(vw * 0.6, 0);
	// Put back for the rest of the file.
	await page.evaluate(() => localStorage.removeItem('tsundoku.reader.sides'));
});

test('zoom: a paged page grows and scrolls, KEEP makes it every paged series’ start, RESET goes back (c169)', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const box = page.locator('.stage .screen:not([aria-hidden]) .page').first();
	const screen = page.locator('.stage .screen:not([aria-hidden])').first();
	const height = () => box.evaluate((e) => e.getBoundingClientRect().height);
	const fitted = await height();
	await page.keyboard.press('+');
	await page.keyboard.press('+');
	await expect.poll(height).toBeCloseTo(fitted * 1.5, 0);
	// Bigger than the screen: it scrolls, and starts at the top.
	expect(await screen.evaluate((e) => e.scrollHeight > e.clientHeight && e.scrollTop === 0)).toBe(
		true
	);
	await tap(page, 0.5);
	await page.getByRole('button', { name: /R→L/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet.locator('.zval')).toHaveText('150%');
	await sheet.getByRole('button', { name: 'KEEP FOR ALL PAGED' }).click();
	await expect(sheet).toContainText('EVERY PAGED SERIES STARTS HERE ON THIS SCREEN');
	// Kept on this device: the next visit starts at 150%.
	await page.reload();
	await readerReady(page);
	await expect.poll(height).toBeCloseTo(fitted * 1.5, 0);
	// 0 is RESET: to the kept zoom, then to 100%.
	await page.keyboard.press('+');
	await page.keyboard.press('0');
	await expect.poll(height).toBeCloseTo(fitted * 1.5, 0);
	await page.keyboard.press('0');
	await expect.poll(height).toBeCloseTo(fitted, 0);
	await page.evaluate(() => localStorage.removeItem('tsundoku.reader.zoom.paged.wide'));
});

test('zoom: the vertical strip widens past the screen and scrolls sideways, kept apart from paged (c169)', async ({
	page
}) => {
	await seriesId(page, 'The Greatest Estate Developer');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const vw = page.viewportSize()!.width;
	const width = () => page.locator('.strip').evaluate((e) => e.getBoundingClientRect().width);
	await page.keyboard.press('+');
	await expect.poll(width).toBeCloseTo(vw * 1.25, 0);
	expect(await page.locator('.lane').evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
	await page.keyboard.press('-');
	await page.keyboard.press('-');
	await expect.poll(width).toBeCloseTo(vw * 0.75, 0);
	await page.keyboard.press('0');
	await expect.poll(width).toBeCloseTo(vw, 0);
});

/** Where the screen point (x, y) falls on the page box under it, as fractions. */
const pointOn = (page: Page, sel: string, x: number, y: number) =>
	page
		.locator(sel)
		.first()
		.evaluate(
			(e, [x, y]) => {
				const r = e.getBoundingClientRect();
				return { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, h: r.height, w: r.width };
			},
			[x, y]
		);

test('double tap: 200% around the tapped point and back, with no controls on the way (c185)', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const vp = page.viewportSize()!;
	// Off-centre on purpose: the middle zone across, a third down.
	const [x, y] = [vp.width * 0.45, vp.height / 3];
	const sel = '.stage .screen:not([aria-hidden]) .page';
	const before = await pointOn(page, sel, x, y);
	await page.touchscreen.tap(x, y);
	await page.touchscreen.tap(x, y);
	await expect.poll(async () => (await pointOn(page, sel, x, y)).h).toBeCloseTo(before.h * 2, 0);
	// What was under the finger still is.
	const after = await pointOn(page, sel, x, y);
	expect(after.fx).toBeCloseTo(before.fx, 2);
	expect(after.fy).toBeCloseTo(before.fy, 2);
	// A double tap is never also a single one.
	await page.waitForTimeout(400);
	await expect(page.locator('header[aria-label="Reader"]')).toHaveCount(0);
	// Over 100%: back to it.
	await page.touchscreen.tap(x, y);
	await page.touchscreen.tap(x, y);
	await expect.poll(async () => (await pointOn(page, sel, x, y)).h).toBeCloseTo(before.h, 0);
	// Under 100%: up to it.
	await page.keyboard.press('-');
	await page.touchscreen.tap(x, y);
	await page.touchscreen.tap(x, y);
	await expect.poll(async () => (await pointOn(page, sel, x, y)).h).toBeCloseTo(before.h, 0);
});

test('a single tap in the middle still shows the controls, a moment later, fading in (c185)', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	const header = page.locator('header[aria-label="Reader"]');
	await tap(page, 0.5);
	// Held back while a second tap could still come.
	await expect(header).toHaveCount(0);
	await expect(header).toBeVisible();
	await expect(header).toHaveClass(/appear/);
	await expect.poll(() => header.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
	// A tap at the edge right after a middle one lets that one happen first:
	// with the controls up (the middle tap's), the edge only puts them away, and
	// the page doesn't turn under them.
	await tap(page, 0.5);
	await expect(header).toHaveCount(0);
	// The reader writes its page into the address once it's on one.
	await expect(page).toHaveURL(/\?p=\d+/);
	const at = page.url();
	await tap(page, 0.5);
	await tap(page, 0.95);
	await page.waitForTimeout(400);
	await expect(header).toHaveCount(0);
	expect(page.url()).toBe(at);
});

test('double tap on the strip: 200% around the point, the strip scrolling sideways to keep it (c185)', async ({
	page
}) => {
	await seriesId(page, 'The Greatest Estate Developer');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const vp = page.viewportSize()!;
	const [x, y] = [vp.width * 0.7, vp.height / 2];
	const under = () =>
		page.evaluate(
			([x, y]) => {
				const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-role="page"]');
				const r = el!.getBoundingClientRect();
				return {
					key: `${el!.dataset.entry}-${el!.dataset.index}`,
					fx: (x - r.left) / r.width,
					fy: (y - r.top) / r.height
				};
			},
			[x, y]
		);
	const before = await under();
	const width = () => page.locator('.strip').evaluate((e) => e.getBoundingClientRect().width);
	const fitted = await width();
	await page.touchscreen.tap(x, y);
	await page.touchscreen.tap(x, y);
	await expect.poll(width).toBeCloseTo(fitted * 2, 0);
	await page.waitForTimeout(300);
	const after = await under();
	expect(after.key).toBe(before.key);
	expect(after.fx).toBeCloseTo(before.fx, 1);
	expect(after.fy).toBeCloseTo(before.fy, 1);
	await page.touchscreen.tap(x, y);
	await page.touchscreen.tap(x, y);
	await expect.poll(width).toBeCloseTo(fitted, 0);
});

test('a pinch zooms around the fingers, not the page’s top left (c185)', async ({ page }) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const vp = page.viewportSize()!;
	const [cx, cy] = [vp.width * 0.6, vp.height * 0.6];
	const sel = '.stage .screen:not([aria-hidden]) .page';
	const before = await pointOn(page, sel, cx, cy);
	// Two fingers spreading from 60px to 150px apart around (cx, cy), dispatched
	// to the page itself: devtools' synthetic touches go through Chrome's own
	// gesture handling on a scrollable screen, which took some of them at random.
	await page.evaluate(
		async ([cx, cy]) => {
			const target = document.querySelector('.stage .screen:not([aria-hidden])')!;
			const touches = (d: number) =>
				[cx - d / 2, cx + d / 2].map(
					(x, i) => new Touch({ identifier: i + 1, target, clientX: x, clientY: cy })
				);
			const send = (type: string, t: Touch[]) =>
				target.dispatchEvent(
					new TouchEvent(type, { touches: t, changedTouches: t, bubbles: true, cancelable: true })
				);
			send('touchstart', touches(60));
			for (let d = 70; d <= 150; d += 10) {
				send('touchmove', touches(d));
				await new Promise((r) => requestAnimationFrame(r));
			}
			send('touchend', []);
		},
		[cx, cy]
	);
	await expect
		.poll(async () => (await pointOn(page, sel, cx, cy)).h)
		.toBeCloseTo(before.h * 2.5, 0);
	// Where the fingers began on the page is still between them.
	const after = await pointOn(page, sel, cx, cy);
	expect(after.fx).toBeCloseTo(before.fx, 2);
	expect(after.fy).toBeCloseTo(before.fy, 2);
	await page.keyboard.press('0');
});

test('wide pages: SPLIT reads the halves in order, ROTATE turns the page, WHOLE as before', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const href = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	// The sample's seventh page is twice as wide as it is tall.
	await page.goto(`${href}?p=7`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const box = page.locator('.stage .screen:not([aria-hidden]) .page');
	const img = box.locator('img');
	// WHOLE: the page as it is.
	await expect(box).not.toHaveClass(/half|rotate/);

	await tap(page, 0.5);
	await page.getByRole('button', { name: /R→L/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.getByRole('radio', { name: 'SPLIT' }).click();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await tap(page, 0.5);

	// R→L: the right half first, then the left, then the next page.
	await expect(box).toHaveClass(/half/);
	await expect(img).toHaveClass(/right/);
	await tap(page, 0.05);
	await expect(img).not.toHaveClass(/right/);
	await expect(page).toHaveURL(/p=7/);
	await tap(page, 0.05);
	await expect(page).toHaveURL(/p=8/, { timeout: 5000 });
	await expect(box).not.toHaveClass(/half/);
	// Back comes into the second half.
	await tap(page, 0.95);
	await expect(box).toHaveClass(/half/);
	await expect(img).not.toHaveClass(/right/);

	await tap(page, 0.5);
	await page.getByRole('button', { name: /R→L/ }).click();
	await sheet.getByRole('radio', { name: 'ROTATE' }).click();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(box).toHaveClass(/rotate/);
	expect(await img.evaluate((e) => getComputedStyle(e).transform)).not.toBe('none');
	await page.evaluate(() => localStorage.removeItem('tsundoku.reader.wide'));
});

test('CROP BORDERS shows each page without its plain margin, sized to what is left', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const href = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	await page.goto(`${href}?p=2`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const img = page.locator('.stage .screen:not([aria-hidden]) .page img');
	const box = () => img.evaluate((e) => getComputedStyle(e).getPropertyValue('object-view-box'));
	expect(await box()).toMatch(/^(none|)$/);
	await tap(page, 0.5);
	await page.getByRole('button', { name: /R→L/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.locator('.row', { hasText: 'CROP BORDERS' }).getByRole('switch').click();
	await expect.poll(box).toMatch(/^inset\(/);
	await page.evaluate(() => localStorage.removeItem('tsundoku.reader.crop'));
});

test('paged: the page follows a drag with the next beside it, and a swipe slides it in', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const href = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	await page.goto(`${href}?p=3`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const vp = page.viewportSize()!;
	const track = page.locator('.stage .track');
	const x = () => track.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);

	// R→L: the next page lies to the left, so it's pulled in by dragging right.
	await page.mouse.move(vp.width / 2, vp.height / 2);
	await page.mouse.down();
	await page.mouse.move(vp.width / 2 + 120, vp.height / 2, { steps: 6 });
	expect(await x()).toBeCloseTo(120, -1);
	await expect(page.locator('.stage .screen')).toHaveCount(2);
	await expect(page.locator('.stage .screen[aria-hidden] img')).toHaveAttribute('alt', 'Page 4');
	await page.mouse.up();
	await expect(page).toHaveURL(/p=4/, { timeout: 5000 });
	await expect(page.locator('.stage .screen')).toHaveCount(1);
	expect(await x()).toBe(0);

	// Too short to turn: back into place.
	await page.mouse.move(vp.width / 2, vp.height / 2);
	await page.mouse.down();
	await page.mouse.move(vp.width / 2 + 25, vp.height / 2, { steps: 4 });
	await page.mouse.up();
	await expect.poll(x).toBe(0);
	await expect(page.locator('.stage .screen')).toHaveCount(1);
	await expect(page).toHaveURL(/p=4/);
});

test('paged: the next pages and the one before are fetched before they’re turned to', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	const href = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	const asked = new Set<number>();
	page.on('request', (r) => {
		const m = /\/api\/entries\/\d+\/pages\/(\d+)\?/.exec(r.url());
		if (m) asked.add(Number(m[1]));
	});
	await page.goto(`${href}?p=3`);
	await readerReady(page);
	// Page 3 on screen (index 2): 4 and 5 ahead, 2 behind, without a turn.
	await expect.poll(() => [1, 3, 4].every((i) => asked.has(i))).toBe(true);
	await expect(page).toHaveURL(/p=3/);
});

test('a mouse at the top or bottom of the window brings the controls up, and leaving puts them away', async ({
	page
}) => {
	await seriesId(page, 'Hikaru ga Shinda Natsu');
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const vp = page.viewportSize()!;
	const bar = page.getByRole('banner', { name: 'Reader' });

	await page.mouse.move(vp.width / 2, vp.height / 2);
	await expect(bar).toHaveCount(0);
	await page.mouse.move(vp.width / 2, 8);
	await expect(bar).toBeVisible();
	// On the bar, below the edge band: they stay.
	await page.mouse.move(vp.width / 2, 60);
	await expect(bar).toBeVisible();
	await page.mouse.move(vp.width / 2, vp.height / 2);
	await expect(bar).toHaveCount(0);
	await page.mouse.move(vp.width / 2, vp.height - 8);
	await expect(page.getByRole('contentinfo', { name: 'Reader controls' })).toBeVisible();
	await page.mouse.move(vp.width / 2, vp.height / 2);
});
