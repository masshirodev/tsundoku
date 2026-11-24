import { expect, test } from './fixtures';

/**
 * Design conformance, in a real browser.
 *
 * Generated from the design's mock, and
 * checked in deliberately. These assert the frame and the measurements — the
 * part visual review reliably misses. The numbers are hand-set in the mock and
 * do not round to a spacing ladder, so a later pass that tidies them would
 * silently redraw the screen. That is what this is here to stop; it is not
 * pedantry.
 *
 * Regenerating overwrites this file. Hand edits belong in a sibling spec.
 */

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

/*
 * The fold on a phone, at 390: ABOUT's body and the DETAILS line's text,
 * the two regions the fold draws. Two hand edits to this generated file, which regenerating undoes:
 * (1) it opens a series by title, Tower of God (series-layout's, read only
 * here), where the generator writes `page.goto(base + '/')`; (2) it runs on
 * the `phone` project alone, at the design's 390, because the fold is the
 * phone's and the TV's (the TV's measurements are tv-series-details.e2e.ts').
 */
test.use({ viewport: { width: 390, height: 844 } });
async function go(page: import('@playwright/test').Page) {
	test.skip(test.info().project.name !== 'phone', 'the board is the phone at 390');
	await page.goto(`${base}/?sort=title`);
	// The fixture's goto waits for hydration, so one tap opens it.
	await page.locator('.grid .tile', { hasText: 'Tower of God' }).first().click();
	await page.waitForURL(/\/series\/\d+/);
	await page.getByRole('heading', { name: 'Tower of God' }).waitFor();
}

const SEL = {
	region9: '.panel .about:visible',
	region10: '[data-row="details"] .dt'
};

test('screen: region9 matches the design', async ({ page }) => {
	await go(page);
	await expect(page.locator(SEL.region9)).toBeVisible();

	const region9Style = await page.locator(SEL.region9).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			alignItems: cs.alignItems,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft
		};
	});
	expect(region9Style.display).toBe('flex');
	expect(region9Style.flexDirection).toBe('column');
	expect(region9Style.alignItems).toBe('flex-start');
	expect(region9Style.rowGap).toBe('6px');
	expect(region9Style.columnGap).toBe('6px');
	expect(region9Style.paddingTop).toBe('14px');
	expect(region9Style.paddingRight).toBe('14px');
	expect(region9Style.paddingBottom).toBe('14px');
	expect(region9Style.paddingLeft).toBe('14px');
});

test('screen: region10 matches the design', async ({ page }) => {
	await go(page);
	await expect(page.locator(SEL.region10)).toBeVisible();

	const region10Style = await page.locator(SEL.region10).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft
		};
	});
	expect(region10Style.display).toBe('flex');
	expect(region10Style.flexDirection).toBe('column');
	expect(region10Style.justifyContent).toBe('center');
	expect(region10Style.rowGap).toBe('5px');
	expect(region10Style.columnGap).toBe('5px');
	expect(region10Style.paddingTop).toBe('12px');
	expect(region10Style.paddingRight).toBe('14px');
	expect(region10Style.paddingBottom).toBe('12px');
	expect(region10Style.paddingLeft).toBe('14px');
});
