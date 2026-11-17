import { type Page } from '@playwright/test';
import { expect, hydrated, test } from './fixtures';

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
 * The series screen's LISTS row (doc/SERIES.md): every state in
 * the 440px side panel, pinned on The Greatest Estate Developer (the seed's
 * one linked series, signed out, so its line drops two cells, SIGN IN → and
 * EDIT, in equal columns). Read-only. It runs in tablet-landscape alone, the
 * project whose panel is the board's 440px; the other devices' measurements
 * are tests/series-layout.e2e.ts's and tests/tv-series.e2e.ts's.
 *
 * Regenerating overwrites this file. Hand edits belong in a sibling spec.
 * Three hand edits must survive a regeneration: the series is opened by its
 * title (`openByTitle`), not `/series/7`, once the library has
 * hydrated, and region7's widths below.
 */

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

// Drawn at one viewport: the board's 440px panel is tablet-landscape's, and
// every other project ignores this file (playwright.config.ts's
// TABLET_LANDSCAPE_ONLY). This comment is a hand edit: regenerating the file
// drops it, and nothing else needs putting back, since the
// config is what keeps it to its project.
//
// Hand edit: the series is found by its title, through the library as
// a person would open it, not by the seed's id (`/series/7` moved whenever the
// seed reordered its series). The generator takes one URL, so regenerating
// writes a fixed `/series/<id>` back: keep this lookup when you regenerate.
const TITLE = 'The Greatest Estate Developer';

// Hand edit: the tile is clicked once the library has hydrated. This
// file's `test` is `@playwright/test`'s (generated so), whose
// `goto` waits for neither network quiet nor hydration, and a click on the
// server's markup before then does nothing.
async function openByTitle(page: Page, title: string): Promise<void> {
	await page.goto(`${base}/?sort=title`);
	await hydrated(page);
	await page.locator('.grid .tile', { hasText: title }).first().click();
	await page.waitForURL(/\/series\/\d+/);
}

const SEL = {
	region7: '[data-row="lists"] [data-line="anilist"] .drop'
};

test('screen: region7 matches the design', async ({ page }) => {
	await openByTitle(page, TITLE);
	await expect(page.locator(SEL.region7)).toBeVisible();

	// authored as: 219px 219px
	const region7Tracks = (
		(await page
			.locator(SEL.region7)
			.evaluate((node) => getComputedStyle(node).gridTemplateColumns)) as string
	).split(' ');
	expect(region7Tracks).toHaveLength(2);
	// Hand edit: 219 is the board's 440px frame less its own two 1px borders;
	// the app's panel draws one, on the list's side. The design's intent is
	// equal columns across the line's whole width (`minmax(0, 1fr)`).
	const lineWidth = (await page.locator(SEL.region7).boundingBox())!.width;
	expect(parseFloat(region7Tracks[0])).toBe(parseFloat(region7Tracks[1]));
	expect(Math.round(parseFloat(region7Tracks[0]) * 2)).toBe(Math.round(lineWidth));
	// The 440px panel less its own 1px rule on the list's side.
	expect(Math.round(lineWidth)).toBe(439);

	const region7Style = await page.locator(SEL.region7).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			borderTopWidth: cs.borderTopWidth,
			minHeight: cs.minHeight
		};
	});
	expect(region7Style.display).toBe('grid');
	expect(region7Style.borderTopWidth).toBe('1px');
	expect(region7Style.minHeight).toBe('48px');
});
