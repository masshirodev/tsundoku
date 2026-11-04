import type { Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';

/**
 * The readers' tap surfaces never tint under a mouse (c485; doc/READER.md and
 * doc/TEXT-READER.md, "Tap zones"; doc/MOTION.md, "Hovering"). The player's
 * tap zone was a `<button>` and tinted (tests/browse-player-hover.e2e.ts); the
 * image reader's stage and the text reader's page catch taps on a plain
 * element, which the hover rule never matches. This file holds that: hovering
 * the middle of a page finds no pressable under the pointer and no tint on
 * anything there, so a later change that makes a zone a button turns it red,
 * while a visible control of the same reader still tints, so the rule itself
 * is shown to be live. Hover only exists on a fine pointer, so it runs in the
 * `desktop` project alone and skips itself in the touch ones. Read-only: it
 * reads in incognito, and only series no flow file writes to (Sousou no
 * Frieren, as tests/reader-layout.e2e.ts; Mushoku Tensei, as
 * tests/text-reader-turn.e2e.ts).
 */

test.beforeEach(async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', 'hover exists only on a fine pointer');
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function openSeries(page: Page, title: string) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	await page
		.getByRole('link', { name: /^(?!GET).*(READ AGAIN|CONTINUE|START|▶)/ })
		.first()
		.click();
	await page.waitForURL(/\/read\/\d+/);
}

/**
 * What lies under (x, y): whether any of it is pressable (press.ts's
 * PRESSABLE, the same list the hover rule tints), and every background-image
 * that is a tint.
 */
const under = (page: Page, x: number, y: number) =>
	page.evaluate(
		([x, y]) => {
			const pressable =
				'a[href], button, summary, [role="button"], [role="tab"], [role="option"], [role="menuitem"]';
			const els = document.elementsFromPoint(x, y);
			return {
				pressable: els.filter((e) => e.matches(pressable)).map((e) => e.outerHTML.slice(0, 80)),
				tinted: els
					.map((e) => getComputedStyle(e).backgroundImage)
					.filter((b) => b.includes('gradient'))
			};
		},
		[x, y]
	);

const tint = (page: Page, selector: string) =>
	page
		.locator(selector)
		.first()
		.evaluate((el) => getComputedStyle(el).backgroundImage);

test('the image reader: hovering the page tints nothing, its controls still tint (c485)', async ({
	page
}) => {
	await openSeries(page, 'Sousou no Frieren');
	await readerReady(page);
	expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(
		true
	);
	const vp = page.viewportSize()!;
	for (const [fx, fy] of [
		[0.5, 0.5],
		[0.05, 0.5],
		[0.95, 0.5]
	]) {
		await page.mouse.move(vp.width * fx, vp.height * fy);
		expect(await under(page, vp.width * fx, vp.height * fy)).toEqual({
			pressable: [],
			tinted: []
		});
	}
	// The middle button raises the controls without turning (reader-layout.e2e.ts).
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	await expect(page.getByRole('banner', { name: 'Reader' })).toBeVisible();
	const cell = page.locator('.cells button').first();
	await cell.hover();
	await expect.poll(() => tint(page, '.cells button')).toContain('linear-gradient');
});

test('the text reader: hovering the page tints nothing, its controls still tint (c485)', async ({
	page
}) => {
	await openSeries(page, 'Mushoku Tensei');
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	const box = (await page.locator('.text-reader').boundingBox())!;
	for (const [fx, fy] of [
		[0.5, 0.5],
		[0.05, 0.5],
		[0.95, 0.5]
	]) {
		const x = box.x + box.width * fx;
		const y = box.y + box.height * fy;
		await page.mouse.move(x, y);
		expect(await under(page, x, y)).toEqual({ pressable: [], tinted: [] });
	}
	// A tap in the middle raises the controls (doc/TEXT-READER.md); a cell of
	// theirs keeps the hover.
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	const cell = page.locator('header.top .fav');
	await expect(cell).toBeVisible();
	await cell.hover();
	await expect
		.poll(() => cell.evaluate((el) => getComputedStyle(el).backgroundImage))
		.toContain('linear-gradient');
});
