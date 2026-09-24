import { expect, test } from './fixtures';

/**
 * The frame on every device the design draws, hand-written beside the
 * generated tests/library-frame.e2e.ts (which pins the tablet-portrait
 * measurements and is overwritten when regenerated).
 *
 * The numbers come from Index Library.dc.html's parameters: columns
 * 3 / 6 / 9 / 8, header 60 / 72 / 72 / 64, page padding 16 / 24, continue rows
 * 2 / 4, continue columns 1 / 1 / 2 / 2, and a 248px sidebar on desktop only.
 * They are hand-set, not a ladder; a tidy-up that rounds them would redraw the
 * screen, and this is what would notice.
 */

type Frame = {
	cols: number;
	header: number;
	pad: number;
	cont: number;
	contCols: number;
	sidebar: boolean;
};

const FRAMES: Record<string, Frame> = {
	'tablet-portrait': { cols: 6, header: 72, pad: 24, cont: 4, contCols: 1, sidebar: false },
	'tablet-landscape': { cols: 9, header: 72, pad: 24, cont: 4, contCols: 2, sidebar: false },
	phone: { cols: 3, header: 60, pad: 16, cont: 2, contCols: 1, sidebar: false },
	desktop: { cols: 8, header: 64, pad: 24, cont: 4, contCols: 2, sidebar: true }
};

test('the library frame matches the design for this device', async ({ page }, info) => {
	const frame = FRAMES[info.project.name];
	test.skip(!frame, 'no frame drawn for this project');
	await page.goto('/');

	// Grid: repeat(N, minmax(0, 1fr)) resolves to N equal tracks.
	const tracks = (
		await page.locator('.grid').evaluate((n) => getComputedStyle(n).gridTemplateColumns)
	).split(' ');
	expect(tracks).toHaveLength(frame.cols);
	const widths = tracks.map(parseFloat);
	for (const w of widths) expect(Math.abs(w - widths[0])).toBeLessThan(0.5);

	const header = page.locator('header[aria-label="Library"]');
	expect((await header.boundingBox())!.height).toBe(frame.header);

	const row = page.locator('.cont > .row').first();
	expect(await row.evaluate((n) => getComputedStyle(n).paddingLeft)).toBe(`${frame.pad}px`);
	// Rendered once and shown per device by CSS, so the server's first paint is
	// already right; count what is visible, not what is in the DOM.
	const shown = await page
		.locator('.cont > .row')
		.evaluateAll((rows) => rows.filter((r) => r.checkVisibility()).length);
	expect(shown).toBe(frame.cont);
	const contTracks = (
		await page.locator('.cont').evaluate((n) => getComputedStyle(n).gridTemplateColumns)
	).split(' ');
	expect(contTracks).toHaveLength(frame.contCols);

	const sidebar = page.locator('aside.sidebar');
	if (frame.sidebar) {
		await expect(sidebar).toBeVisible();
		expect((await sidebar.boundingBox())!.width).toBe(248);
		// Shelves move into the sidebar, so the tab row is gone.
		await expect(page.locator('.library nav[aria-label="Shelves"]')).toBeHidden();
	} else {
		await expect(sidebar).toBeHidden();
		await expect(page.locator('.library nav[aria-label="Shelves"]')).toBeVisible();
	}
});

test('covers are 2:2.9 and badges sit flush in their corners', async ({ page }) => {
	await page.goto('/');
	// Not one a flow file opens: opening a series clears its +N (offline-flow
	// reads Drawing). reader-layout reads Frieren only in incognito.
	const tile = page.locator('.grid .tile', { hasText: 'Sousou no Frieren' });
	const cover = tile.locator('.cover');
	const box = (await cover.boundingBox())!;
	expect(box.height / box.width).toBeCloseTo(2.9 / 2, 1);

	const fav = tile.getByText('FAV', { exact: true });
	const favBox = (await fav.boundingBox())!;
	expect(Math.round(favBox.x + favBox.width)).toBe(Math.round(box.x + box.width));
	expect(Math.round(favBox.y)).toBe(Math.round(box.y));

	const fresh = tile.getByText('+1', { exact: true });
	const freshBox = (await fresh.boundingBox())!;
	expect(Math.round(freshBox.x)).toBe(Math.round(box.x));
	expect(Math.round(freshBox.y + freshBox.height)).toBe(Math.round(box.y + box.height));
});

test('unrated (0) draws no track at all; a rated series draws its whole track', async ({
	page
}) => {
	await page.goto('/');
	const bars = async (title: string) =>
		page
			.locator('.grid .tile', { hasText: title })
			.locator('.bars .bar')
			.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
	// Not one a flow file rates: flows run beside this spec, on the same database.
	const unrated = await bars('Villainess Level 99');
	const one = await bars('Lookism');
	expect(unrated).toHaveLength(5);
	for (const c of unrated) expect(c).toBe('rgba(0, 0, 0, 0)');
	// Rated 1: one filled bar and four empty ones, all of them drawn.
	for (const c of one) expect(c).not.toBe('rgba(0, 0, 0, 0)');
	expect(new Set(one).size).toBe(2);
});

test('nothing is rounded and nothing casts a shadow', async ({ page }) => {
	await page.goto('/');
	const offenders = await page.evaluate(() =>
		[...document.querySelectorAll('body *')]
			.filter((el) => {
				const cs = getComputedStyle(el);
				return (
					parseFloat(cs.borderTopLeftRadius) > 0 ||
					(cs.boxShadow !== 'none' && !cs.boxShadow.includes('inset') && !el.closest('.ring'))
				);
			})
			.map((el) => el.className || el.tagName)
	);
	expect(offenders).toEqual([]);
});

test('the first paint is already the right layout, before any script runs', async ({
	browser
}, info) => {
	const frame = FRAMES[info.project.name];
	test.skip(!frame, 'no frame drawn for this project');
	// No JavaScript at all: this is the server's HTML and the CSS, nothing else.
	const context = await browser.newContext({ ...info.project.use, javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto('/');
	const tracks = (
		await page.locator('.grid').evaluate((n) => getComputedStyle(n).gridTemplateColumns)
	).split(' ');
	expect(tracks).toHaveLength(frame.cols);
	await context.close();
});

test('the bar with the name, search and SELECT stays on top as the grid scrolls, except on a desktop', async ({
	page
}, info) => {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	const bar = page.getByRole('banner', { name: 'Library' });
	await page.evaluate(() => scrollTo(0, 250));
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200);
	const top = (await bar.boundingBox())!.y;
	if (FRAMES[info.project.name].sidebar) expect(top).toBeLessThan(-200);
	else {
		expect(top).toBe(0);
		// Opaque: tiles pass under it, not through it.
		const bg = await bar.evaluate((e) => getComputedStyle(e).backgroundColor);
		expect(bg).not.toBe('rgba(0, 0, 0, 0)');
	}
});
