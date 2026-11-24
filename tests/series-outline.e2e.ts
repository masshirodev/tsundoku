import { expect, test } from './fixtures';

/**
 * The series screen's loading outline (SeriesOutline, doc/SERIES.md) draws
 * its rows where the real ones land, so nothing moves when the screen
 * arrives. Where nothing folds, TAGS stands above the direction row and
 * SHELVES; in the fold (a phone, a TV) it comes after them. The outline is
 * one snippet drawn in both orders' places, and drew the fold's order in both.
 */
test('the loading outline draws its rows in the order the screen lands them', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/series/*/__data.json**', async (route) => {
		await held;
		await route.continue();
	});
	const rows = ['TAGS', 'DIRECTION', 'SHELVES', 'FILE'];
	const visibleLabels = (sel: string) =>
		page
			.locator(`${sel}:visible`)
			.allTextContents()
			.then((all) => all.map((t) => t.trim()).filter((t) => rows.includes(t)));
	await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
	await expect(page.locator('.out-row:visible').first()).toBeVisible();
	const outline = await visibleLabels('.out-row .label');
	release();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.locator('.out-row:visible')).toHaveCount(0);
	const landed = await visibleLabels('.row .label');
	// The rows both draw, in each one's order: in the fold, rows behind DETAILS
	// are not on screen once it lands.
	expect(landed.length).toBeGreaterThan(0);
	expect(outline.filter((l) => landed.includes(l))).toEqual(landed);
	await page.unroute('**/series/*/__data.json**');
});
