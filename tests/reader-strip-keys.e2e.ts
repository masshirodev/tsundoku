import { expect, readerReady, test } from './fixtures';

/**
 * The vertical strip's ← and → (c527; doc/READER.md, "Scrolling on a PC"):
 * they nudge like Ctrl + ↑ / ↓, follow the mode rather than the kind, keep
 * panning sideways while the strip is zoomed wider than the screen, and a
 * paged reader still turns on them. Runs on every device because the keys are
 * the same on each and the strip's width is not. Read-only: it reads in
 * incognito, so nothing is written to the shared database, and it reads the
 * series reader-layout reads (Sousou no Frieren), switched to the strip from
 * READING, whose mode is session state that only REMEMBER stores.
 */

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function open(page: import('@playwright/test').Page) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
}

/**
 * The strip's scroll, less what keeping its place added since `toStrip` began.
 * Once `toStrip` has settled it is read off one page slot instead (`ref`, the
 * one under the middle then): how far that slot's top has gone up the screen.
 * `kept` counts only the app's own place-keeping, and under load the browser's
 * scroll anchoring moved `scrollY` by thousands of pixels as images above came
 * in, with no event (4864 px on tablet-portrait, 10504 on the phone, wave 23's
 * loaded whole run; c439). A nudge moves the slot by its 40 px whatever
 * arrives above it. If that slot leaves the strip, `place()` throws rather
 * than switch measures mid-case.
 */
const place = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const w = window as unknown as { kept?: number; ref?: Element };
		if (!w.ref) return Math.round(scrollY - (w.kept ?? 0));
		// Never fall back to the scroll once the slot is the measure: a start read
		// off the slot against a scroll read now differs by thousands of pixels,
		// which reads as a wrong nudge rather than as what it is.
		if (!w.ref.isConnected) throw new Error('place(): the reference page slot left the strip');
		return Math.round(-w.ref.getBoundingClientRect().top);
	});

const pageParam = (page: import('@playwright/test').Page) =>
	Number(new URL(page.url()).searchParams.get('p') ?? '0');

/** The strip, from READING (session state): the controls come and go by Escape. */
async function toStrip(page: import('@playwright/test').Page) {
	await page.keyboard.press('Escape');
	await page.locator('footer[aria-label="Reader controls"] .cell.grow').click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	const vertical = sheet.getByRole('radio', { name: 'VERTICAL' });
	await vertical.click();
	await expect(vertical).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.reader')).toHaveClass(/vertical/);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	// The strip finds its place after the switch (pages above arrive and the
	// place is kept): wait until it has held still for a second. A chapter can
	// still arrive later under load, and the strip then scrolls with it by
	// thousands of pixels (`keepPlaceBy`); `place()` takes those away, as
	// reader-flow's c192 case does.
	await page.evaluate(() => {
		const w = window as unknown as { kept: number };
		w.kept = 0;
		addEventListener('tsundoku:kept-place', (e) => (w.kept += (e as CustomEvent<number>).detail));
	});
	const y = () => place(page);
	let before = await y();
	await expect
		.poll(
			async () => {
				const now = await y();
				const still = now === before;
				before = now;
				return still;
			},
			{ intervals: [1000], timeout: 30_000 }
		)
		.toBe(true);
	// Measured from here: what was kept while settling is the start, and the
	// slot under the middle is what `place()` reads from now on.
	await page.evaluate(() => {
		const w = window as unknown as { kept: number; ref?: Element };
		w.kept = 0;
		w.ref =
			document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-role="page"]') ??
			undefined;
	});
}

test('a paged reader still turns on ← and →', async ({ page }) => {
	await open(page);
	await expect(page.locator('.reader')).not.toHaveClass(/vertical/);
	// The URL follows the page once the reader settles on it (800 ms).
	await expect.poll(() => pageParam(page)).toBeGreaterThan(0);
	const from = pageParam(page);
	// R→L: ← reads on.
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => pageParam(page)).toBeGreaterThan(from);
	const on = pageParam(page);
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => pageParam(page)).toBeLessThan(on);
});

test('on the strip, → and ← nudge as Ctrl + ↓ and Ctrl + ↑ do; Ctrl + → / ← add nothing', async ({
	page
}) => {
	await open(page);
	await toStrip(page);
	const y = () => place(page);
	const y0 = await y();
	// Room above for ← to nudge back up.
	expect(await page.evaluate(() => scrollY)).toBeGreaterThan(40);

	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => Math.abs((await y()) - y0 - 40)).toBeLessThanOrEqual(1);
	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => Math.abs((await y()) - y0)).toBeLessThanOrEqual(1);

	// The same distance as the Ctrl nudge, both ways.
	await page.keyboard.press('Control+ArrowDown');
	await expect.poll(async () => Math.abs((await y()) - y0 - 40)).toBeLessThanOrEqual(1);
	await page.keyboard.press('Control+ArrowUp');
	await expect.poll(async () => Math.abs((await y()) - y0)).toBeLessThanOrEqual(1);

	// Twice: a second press mid-glide adds a nudge, it doesn't restart one.
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => Math.abs((await y()) - y0 - 80)).toBeLessThanOrEqual(1);
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => Math.abs((await y()) - y0)).toBeLessThanOrEqual(1);

	// Ctrl + → / ← are nothing new: the strip stays put.
	await page.keyboard.press('Control+ArrowRight');
	await page.keyboard.press('Control+ArrowLeft');
	// Nothing to wait on: the assertion is that nothing happens.
	await page.waitForTimeout(500);
	expect(Math.abs((await y()) - y0)).toBeLessThanOrEqual(1);
});

test('zoomed wider than the screen, ← and → pan the strip sideways instead', async ({ page }) => {
	await open(page);
	await toStrip(page);
	// 300%: past the screen on every device, SIDES' margins included.
	for (let i = 0; i < 8; i++) await page.keyboard.press('+');
	const lane = page.locator('.lane.wider');
	await expect.poll(() => lane.evaluate((n) => n.scrollWidth > n.clientWidth + 1)).toBe(true);
	await page.waitForTimeout(500);
	const at = () =>
		page.evaluate(() => ({
			x: Math.round(document.querySelector('.lane.wider')!.scrollLeft),
			y: Math.round(scrollY - ((window as unknown as { kept?: number }).kept ?? 0))
		}));
	const before = await at();
	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => (await at()).x).toBeGreaterThan(before.x);
	const right = await at();
	expect(right.y).toBe(before.y);
	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => (await at()).x).toBeLessThan(right.x);
	expect((await at()).y).toBe(before.y);
});
