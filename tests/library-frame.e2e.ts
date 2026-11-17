// The shared `page.goto` waits for hydration (tests/fixtures.ts), as the other
// frame specs' do: kept by hand over the generator's own import.
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

const SEL = {
	continueList: '.cont',
	continueRow: '.cont > .row:nth-child(1)',
	grid: '.grid',
	tile: '.grid > .tile:nth-child(1)'
};

test('screen: continueList matches the design', async ({ page }) => {
	await page.goto(`${base}/`);
	await expect(page.locator(SEL.continueList)).toBeVisible();

	// authored as: 1fr
	const continueListTracks = (
		(await page
			.locator(SEL.continueList)
			.evaluate((node) => getComputedStyle(node).gridTemplateColumns)) as string
	).split(' ');
	expect(continueListTracks).toHaveLength(1);
	expect(parseFloat(continueListTracks[0])).toBeGreaterThan(0);

	const continueListStyle = await page.locator(SEL.continueList).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			borderTopWidth: cs.borderTopWidth
		};
	});
	expect(continueListStyle.display).toBe('grid');
	expect(continueListStyle.borderTopWidth).toBe('1px');
});

test('screen: continueRow matches the design', async ({ page }) => {
	await page.goto(`${base}/`);
	await expect(page.locator(SEL.continueRow)).toBeVisible();

	const continueRowStyle = await page.locator(SEL.continueRow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth
		};
	});
	expect(continueRowStyle.display).toBe('flex');
	expect(continueRowStyle.alignItems).toBe('center');
	expect(continueRowStyle.rowGap).toBe('16px');
	expect(continueRowStyle.columnGap).toBe('16px');
	expect(continueRowStyle.paddingTop).toBe('12px');
	expect(continueRowStyle.paddingRight).toBe('24px');
	expect(continueRowStyle.paddingBottom).toBe('12px');
	expect(continueRowStyle.paddingLeft).toBe('24px');
	expect(continueRowStyle.borderRightWidth).toBe('1px');
	expect(continueRowStyle.borderBottomWidth).toBe('1px');
});

test('screen: grid matches the design', async ({ page }) => {
	await page.goto(`${base}/`);
	await expect(page.locator(SEL.grid)).toBeVisible();

	// grid-template-columns: repeat(6, minmax(0px, 1fr)) — needs a hand-written assertion (repeat/minmax).

	const gridStyle = await page.locator(SEL.grid).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			borderTopWidth: cs.borderTopWidth,
			borderBottomWidth: cs.borderBottomWidth
		};
	});
	expect(gridStyle.display).toBe('grid');
	expect(gridStyle.rowGap).toBe('1px');
	expect(gridStyle.columnGap).toBe('1px');
	expect(gridStyle.borderTopWidth).toBe('1px');
	expect(gridStyle.borderBottomWidth).toBe('1px');
});

test('screen: tile matches the design', async ({ page }) => {
	await page.goto(`${base}/`);
	await expect(page.locator(SEL.tile)).toBeVisible();

	const tileStyle = await page.locator(SEL.tile).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft
		};
	});
	expect(tileStyle.display).toBe('flex');
	expect(tileStyle.flexDirection).toBe('column');
	expect(tileStyle.rowGap).toBe('8px');
	expect(tileStyle.columnGap).toBe('8px');
	expect(tileStyle.paddingTop).toBe('10px');
	expect(tileStyle.paddingRight).toBe('10px');
	expect(tileStyle.paddingBottom).toBe('10px');
	expect(tileStyle.paddingLeft).toBe('10px');
});
