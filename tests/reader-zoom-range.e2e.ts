import type { Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';
import { doubleTap } from './helpers/touch';

/**
 * The image reader's zoom range, 20% to 500% (card c719; doc/READER.md,
 * "Zoom"): the READING sheet's ZOOM row walks the whole step list to each end
 * and stops there, a kept 20% survives a reload, and the geometry below 50%
 * holds on every device: a paged page shrunk and centred (fit screen, fit
 * width, a spread), the strip centred with its chapter band still a reader's
 * width, its double tap back to 100%, a tap beside it, and the scrubber. A
 * plain `*.e2e.ts` on purpose, so it runs in the four device projects: the
 * geometry is per screen. Read-only: it reads in incognito, a series no flow
 * file owns (Sousou no Frieren), and a kept zoom lives in the context's own
 * localStorage.
 */
test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function open(page: Page) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	// The mouse off the edges, where the reader would show its controls.
	const vp = page.viewportSize()!;
	await page.mouse.move(vp.width / 2, vp.height / 2);
}

const banner = (page: Page) => page.getByRole('banner', { name: 'Reader' });
const sheetOf = (page: Page) => page.getByRole('dialog', { name: 'Reading settings' });

/** READING, from the controls Escape brings up. */
async function openSheet(page: Page) {
	if (!(await banner(page).count())) await page.keyboard.press('Escape');
	await page.locator('footer[aria-label="Reader controls"] .cell.grow').click();
	await expect(sheetOf(page)).toBeVisible();
	return sheetOf(page);
}

/** Close READING and the controls, as a reader would before looking at the page. */
async function closeAll(page: Page) {
	await page.keyboard.press('Escape');
	await expect(sheetOf(page)).toHaveCount(0);
	await expect(async () => {
		if (await banner(page).count()) await page.keyboard.press('Escape');
		await expect(banner(page)).toHaveCount(0, { timeout: 1_000 });
	}).toPass();
}

/** The strip, from READING: its mode is session state, so nothing is written. */
async function toStrip(page: Page) {
	const sheet = await openSheet(page);
	const vertical = sheet.getByRole('radio', { name: 'VERTICAL' });
	await vertical.click();
	await expect(vertical).toHaveAttribute('aria-checked', 'true');
	await closeAll(page);
	await expect(page.locator('.reader')).toHaveClass(/vertical/);
}

/** Press the ZOOM row's − or + once per expected label, and read each answer. */
async function walk(page: Page, dir: 'Zoom out' | 'Zoom in', labels: string[]) {
	const sheet = sheetOf(page);
	const seen: string[] = [];
	for (const l of labels) {
		await sheet.getByRole('button', { name: dir, exact: true }).click();
		await expect(sheet.locator('.zval')).toHaveText(l);
		seen.push(l);
	}
	return seen;
}

const DOWN = ['75%', '50%', '33%', '25%', '20%', '20%', '20%'];
const UP = ['125%', '150%', '175%', '200%', '250%', '300%', '400%', '500%', '500%', '500%'];

const pagedBox = (page: Page) =>
	page.evaluate(() => {
		const s = document.querySelector('.stage .screen:not([aria-hidden])')!;
		const boxes = [...s.querySelectorAll('.page')].map((p) => p.getBoundingClientRect());
		const left = Math.min(...boxes.map((b) => b.left));
		const right = Math.max(...boxes.map((b) => b.right));
		const top = Math.min(...boxes.map((b) => b.top));
		const bottom = Math.max(...boxes.map((b) => b.bottom));
		return { pages: boxes.length, left, right, top, bottom, h: boxes[0].height };
	});

test('paged: − walks down to 20% and stops, + up to 500% and stops; the page shrinks centred', async ({
	page
}) => {
	await open(page);
	const vp = page.viewportSize()!;
	const fitted = await pagedBox(page);
	await openSheet(page);
	expect(await walk(page, 'Zoom out', DOWN)).toEqual(DOWN);
	// A fifth of the fitted page, in the middle of the screen, on black.
	await expect.poll(async () => (await pagedBox(page)).h).toBeCloseTo(fitted.h * 0.2, 0);
	await closeAll(page);
	const small = await pagedBox(page);
	expect((small.left + small.right) / 2).toBeCloseTo(vp.width / 2, 0);
	expect((small.top + small.bottom) / 2).toBeCloseTo(vp.height / 2, 0);
	await openSheet(page);
	// From 20% back to 100% and on to the top: the list's other half, both ends.
	await walk(page, 'Zoom in', ['25%', '33%', '50%', '75%', '100%']);
	expect(await walk(page, 'Zoom in', UP)).toEqual(UP);
	await expect.poll(async () => (await pagedBox(page)).h).toBeCloseTo(fitted.h * 5, 0);
});

test('paged: a kept 20% survives a reload', async ({ page }) => {
	await open(page);
	const fitted = await pagedBox(page);
	const sheet = await openSheet(page);
	await walk(page, 'Zoom out', DOWN.slice(0, 5));
	await sheet.getByRole('button', { name: 'KEEP FOR ALL PAGED' }).click();
	await expect(sheet).toContainText('EVERY PAGED SERIES STARTS HERE ON THIS SCREEN');
	await page.reload();
	await readerReady(page);
	await expect.poll(async () => (await pagedBox(page)).h).toBeCloseTo(fitted.h * 0.2, 0);
	await openSheet(page);
	await expect(sheetOf(page).locator('.zval')).toHaveText('20%');
});

test('paged, fit width at 20%: the page is centred both ways, not hung from the top', async ({
	page
}) => {
	await open(page);
	const vp = page.viewportSize()!;
	const sheet = await openSheet(page);
	await sheet.getByRole('radio', { name: 'WIDTH' }).click();
	await walk(page, 'Zoom out', DOWN.slice(0, 5));
	await closeAll(page);
	const box = await pagedBox(page);
	expect(box.right - box.left).toBeCloseTo(vp.width * 0.2, 0);
	expect((box.left + box.right) / 2).toBeCloseTo(vp.width / 2, 0);
	expect((box.top + box.bottom) / 2).toBeCloseTo(vp.height / 2, 0);
});

test('paged, a spread at 20%: both pages, side by side, the pair centred', async ({ page }) => {
	const vp = page.viewportSize()!;
	test.skip(vp.width <= vp.height, 'spreads are landscape only');
	await page.addInitScript(() => localStorage.setItem('tsundoku.reader.spreads', 'true'));
	await open(page);
	// A screen of two pages: turn until one is drawn (the cover stands alone).
	await expect(async () => {
		if ((await pagedBox(page)).pages < 2) await page.keyboard.press('ArrowLeft');
		expect((await pagedBox(page)).pages).toBe(2);
	}).toPass({ timeout: 10_000 });
	const whole = await pagedBox(page);
	await openSheet(page);
	await walk(page, 'Zoom out', DOWN.slice(0, 5));
	await closeAll(page);
	const box = await pagedBox(page);
	expect(box.pages).toBe(2);
	expect(box.h).toBeCloseTo(whole.h * 0.2, 0);
	expect(box.right - box.left).toBeCloseTo((whole.right - whole.left) * 0.2, 0);
	expect((box.left + box.right) / 2).toBeCloseTo(vp.width / 2, 0);
	expect((box.top + box.bottom) / 2).toBeCloseTo(vp.height / 2, 0);
});

const stripBox = (page: Page) =>
	page.locator('.strip').evaluate((e) => {
		const r = e.getBoundingClientRect();
		return { left: r.left, width: r.width };
	});

test('vertical: − walks down to 20% and stops, + up to 500% and stops; the strip stays centred', async ({
	page
}) => {
	await open(page);
	await toStrip(page);
	const vw = page.viewportSize()!.width;
	const full = (await stripBox(page)).width;
	await openSheet(page);
	expect(await walk(page, 'Zoom out', DOWN)).toEqual(DOWN);
	await expect.poll(async () => (await stripBox(page)).width).toBeCloseTo(full * 0.2, 0);
	const s = await stripBox(page);
	expect(s.left + s.width / 2).toBeCloseTo(vw / 2, 0);
	await walk(page, 'Zoom in', ['25%', '33%', '50%', '75%', '100%']);
	expect(await walk(page, 'Zoom in', UP)).toEqual(UP);
	await expect.poll(async () => (await stripBox(page)).width).toBeCloseTo(full * 5, 0);
});

test('vertical: a kept 20% survives a reload, kept apart from paged', async ({ page }) => {
	await open(page);
	await toStrip(page);
	const full = (await stripBox(page)).width;
	const sheet = await openSheet(page);
	await walk(page, 'Zoom out', DOWN.slice(0, 5));
	await sheet.getByRole('button', { name: 'KEEP FOR ALL VERTICAL' }).click();
	await expect(sheet).toContainText('EVERY VERTICAL SERIES STARTS HERE ON THIS SCREEN');
	await page.reload();
	await readerReady(page);
	// The series reads paged again (the strip was session state), at its own 100%.
	await openSheet(page);
	await expect(sheetOf(page).locator('.zval')).toHaveText('100%');
	await closeAll(page);
	await toStrip(page);
	await expect.poll(async () => (await stripBox(page)).width).toBeCloseTo(full * 0.2, 0);
});

test('vertical at 20%: a chapter band keeps a reader’s width, centred over the strip', async ({
	page
}) => {
	await open(page);
	await toStrip(page);
	const vw = page.viewportSize()!.width;
	await openSheet(page);
	await walk(page, 'Zoom out', DOWN.slice(0, 5));
	await closeAll(page);
	const band = page.locator('.strip .band').first();
	await expect(band).toHaveCount(1);
	const b = await band.evaluate((e) => {
		const r = e.getBoundingClientRect();
		return { left: r.left, width: r.width };
	});
	// min(the screen, 360px): never the strip's 20%.
	expect(b.width).toBeCloseTo(Math.min(vw, 360), 0);
	expect(b.left + b.width / 2).toBeCloseTo(vw / 2, 0);
});

test('vertical at 20%: the scrubber still takes the strip to the chapter’s last page', async ({
	page
}) => {
	await open(page);
	await toStrip(page);
	await openSheet(page);
	await walk(page, 'Zoom out', DOWN.slice(0, 5));
	await page.keyboard.press('Escape');
	await expect(sheetOf(page)).toHaveCount(0);
	if (!(await banner(page).count())) await page.keyboard.press('Escape');
	const track = page.locator('footer[aria-label="Reader controls"] .track');
	await expect(track).toBeVisible();
	const total = Number(await track.getAttribute('aria-valuemax'));
	const box = (await track.boundingBox())!;
	await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
	await expect(track).toHaveAttribute('aria-valuenow', String(total));
	const entry = /\/read\/(\d+)/.exec(page.url())![1];
	await expect(
		page.locator(`[data-role="page"][data-entry="${entry}"][data-index="${total - 1}"]`)
	).toBeInViewport();
});

test('vertical at 20% by finger: a tap beside the strip shows the controls, and a double tap goes to 100%', async ({
	page
}) => {
	test.skip(!test.info().project.use.hasTouch, 'a finger');
	await open(page);
	await toStrip(page);
	const vp = page.viewportSize()!;
	const full = (await stripBox(page)).width;
	await openSheet(page);
	await walk(page, 'Zoom out', DOWN.slice(0, 5));
	await closeAll(page);
	await expect.poll(async () => (await stripBox(page)).width).toBeCloseTo(full * 0.2, 0);
	const s = await stripBox(page);
	// In the black beside the strip: the lane is the screen's width, so the tap is the strip's.
	const x = s.left / 2;
	expect(x).toBeLessThan(s.left);
	await page.touchscreen.tap(x, vp.height / 2);
	await expect(banner(page)).toBeVisible();
	await page.touchscreen.tap(x, vp.height / 2);
	await expect(banner(page)).toHaveCount(0);
	// On the strip itself: under 100%, up to it.
	await page.waitForTimeout(400);
	await doubleTap(page, vp.width / 2, vp.height / 2);
	await expect.poll(async () => (await stripBox(page)).width).toBeCloseTo(full, 0);
	await page.waitForTimeout(400);
	await expect(banner(page)).toHaveCount(0);
});
