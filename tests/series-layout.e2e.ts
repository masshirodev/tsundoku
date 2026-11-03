import { expect, screenSettled, test } from './fixtures';

/**
 * The series frame per device, from Index Series.dc.html: metadata is a header
 * above the list in portrait and a 440px panel beside it in landscape; rows
 * are 60px (52px on a phone); the rail is 56px (44px on a phone).
 */
type Frame = { side: boolean; row: number; rail: number; panel?: number; gap?: number };
const FRAMES: Record<string, Frame> = {
	'tablet-portrait': { side: false, row: 60, rail: 56 },
	'tablet-landscape': { side: true, row: 60, rail: 56 },
	phone: { side: false, row: 52, rail: 44 },
	desktop: { side: true, row: 60, rail: 56 },
	// TV-Series: a 352px column, 32px away from a list whose rows are 56 tall.
	tv: { side: true, row: 56, rail: 56, panel: 352, gap: 32 }
};

test('the series frame matches the design for this device', async ({ page }, info) => {
	const frame = FRAMES[info.project.name];
	test.skip(!frame, 'no frame drawn for this project');
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Tower of God' }).click();
	// The title shows at once from the tile (doc/WAITING.md): wait for the screen itself.
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: 'Tower of God' })).toBeVisible();
	await screenSettled(page);

	const panel = (await page.locator('.panel-col').boundingBox())!;
	const list = (await page.locator('.list-col').boundingBox())!;
	if (frame.side) {
		expect(panel.width).toBe(frame.panel ?? 440);
		expect(Math.round(list.x)).toBe(Math.round(panel.x + panel.width + (frame.gap ?? 0)));
		// Each column scrolls on its own.
		expect(await page.locator('.panel-col').evaluate((n) => getComputedStyle(n).overflowY)).toBe(
			'auto'
		);
		expect(await page.locator('.list-col').evaluate((n) => getComputedStyle(n).overflowY)).toBe(
			'auto'
		);
	} else {
		expect(list.y).toBeGreaterThanOrEqual(panel.y + panel.height - 1);
	}

	const row = (await page.locator('.entry-btn').first().boundingBox())!;
	expect(row.height).toBe(frame.row);
	// The fold is a row like the others, the full width of the list. It lost
	// its shared rule once (0ae283a) and shrank to a bordered button.
	const fold = (await page.locator('.fold button').boundingBox())!;
	expect(fold.height).toBe(frame.row);
	expect(fold.width).toBeCloseTo(row.width, 0);
	const rail = (await page.locator('.rail').boundingBox())!;
	expect(rail.width).toBe(frame.rail);
});

test('a doujin reads as a book: pages, not a chapter list', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Hoshi no Umi no Tabibito' }).click();
	await expect(page.getByText('01 — PAGES')).toBeVisible();
	await expect(page.locator('.entry')).toHaveCount(0);
	await expect(page.locator('.page')).toHaveCount(30);
	await expect(page.locator('.page[aria-current="page"]')).toContainText('18');
	await expect(page.getByRole('link', { name: /READ FROM P\. 18/ })).toBeVisible();
	// Each page shows its thumbnail, made on the workstation.
	const thumb = page.locator('.page img.thumb').first();
	// Lazy: only a cell near the screen asks, and on a phone the grid is below the panel.
	await thumb.scrollIntoViewIfNeeded();
	await expect
		.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
		.toBeGreaterThan(0);
});

test('a novel shows its contents without numbers, and a typeset cover', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Mushoku Tensei' }).click();
	await expect(page.getByText('01 — CONTENTS')).toBeVisible();
	await expect(page.getByText('NO COVER · EPUB')).toBeVisible();
	await expect(page.getByText('LAYOUT', { exact: true })).toBeVisible();
	await expect(page.locator('.entry .num')).toHaveCount(0);
});
