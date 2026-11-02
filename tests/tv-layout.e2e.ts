import { expect, test } from './fixtures';

/**
 * The TV's frame (c238; doc/TV.md, "The design"). Playwright has no context
 * option for the pointer type, so the `tv` project sets Blink's own media
 * features at launch (playwright.config.ts). These prove the query is really
 * `(pointer: none)` and not a narrow desktop dressed as one, and that the TV
 * block in src/lib/styles/layout.css is the one applied.
 *
 * The numbers are the handoff's, in its 960x540 frame: 48px safe sides, 28px
 * top, a 56px header, six 144px columns, CONTINUE three across, and the TV
 * type scale. Every other device's frame is pinned by library-layout,
 * series-layout and their generated specs; these run beside them.
 */

test('the project is a TV: no pointer, no hover, and wide enough', async ({ page }) => {
	await page.goto('/');
	const media = await page.evaluate(() => ({
		none: matchMedia('(pointer: none)').matches,
		fine: matchMedia('(pointer: fine)').matches,
		coarse: matchMedia('(pointer: coarse)').matches,
		hoverNone: matchMedia('(hover: none)').matches,
		wide: matchMedia('(min-width: 900px)').matches,
		tv: matchMedia('(pointer: none) and (min-width: 900px)').matches,
		wideLayout: matchMedia('(min-width: 1024px)').matches
	}));
	expect(media).toEqual({
		none: true,
		fine: false,
		coarse: false,
		hoverNone: true,
		wide: true,
		tv: true,
		// A 960-wide TV must not also be the wide (desktop/tablet-landscape) layout.
		wideLayout: false
	});
});

test('the TV block in layout.css is the one applied', async ({ page }) => {
	await page.goto('/');
	const vars = await page.evaluate(() => {
		const s = getComputedStyle(document.documentElement);
		const read = (name: string) => s.getPropertyValue(name).trim();
		return {
			pad: read('--pad'),
			safeY: read('--safe-y'),
			header: read('--header-h'),
			gridCols: read('--grid-cols'),
			contCols: read('--cont-cols')
		};
	});
	expect(vars).toEqual({
		pad: '48px',
		safeY: '28px',
		header: '56px',
		gridCols: '6',
		contCols: '3'
	});

	// The type floor, read off real chrome rather than the shorthand: 15px for
	// a label, 17px for a control, 16px for a tile's title.
	const sizes = await page.evaluate(() => {
		const px = (sel: string) => {
			const el = document.querySelector(sel);
			return el ? getComputedStyle(el).fontSize : null;
		};
		return {
			label: px('.cont-section > .label'),
			control: px('.tabs .tab'),
			tile: px('.grid .tile .title')
		};
	});
	expect(sizes).toEqual({ label: '15px', control: '17px', tile: '16px' });
});

test('the library frame: 6 columns, a 56px header, 3 CONTINUE cards, no SELECT', async ({
	page
}) => {
	await page.goto('/');

	const tracks = (
		await page.locator('.grid').evaluate((n) => getComputedStyle(n).gridTemplateColumns)
	).split(' ');
	expect(tracks).toHaveLength(6);
	const widths = tracks.map(parseFloat);
	for (const w of widths) expect(Math.abs(w - widths[0])).toBeLessThan(0.5);
	// The safe margin's 864px, its 1px border either side and the 1px rules
	// between cells: 144px of pitch, as TV Calls' "COVERS PER ROW" says.
	expect(Math.round((await page.locator('.grid').boundingBox())!.width)).toBe(864);
	expect(widths[0]).toBeCloseTo((864 - 2 - 5) / 6, 1);

	const header = page.locator('header[aria-label="Library"]');
	expect((await header.boundingBox())!.height).toBe(56);
	// The bar sits under the 28px safe top.
	expect(Math.round((await header.boundingBox())!.y)).toBe(28);

	const contTracks = (
		await page.locator('.cont').evaluate((n) => getComputedStyle(n).gridTemplateColumns)
	).split(' ');
	expect(contTracks).toHaveLength(3);
	const shown = await page
		.locator('.cont > .row')
		.evaluateAll((rows) => rows.filter((r) => r.checkVisibility()).length);
	expect(shown).toBe(3);

	// No SELECT on a TV: bulk tidying is not a couch job (TV Calls, "03 — SIDEBAR").
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toHaveCount(0);
});
