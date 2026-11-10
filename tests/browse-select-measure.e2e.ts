import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The hand-set measurements of SELECT in a catalog (card c868;
 * doc/handoffs/browse-select/, Select-Tablet, Bars, Tiles, Show-Tablet) that
 * the generated frame spec (tests/browse-select-frame.e2e.ts) does not
 * propose: the bulk bar's line and cells, the tile's box and ring, the bar's
 * cells and SHOW's rows. They are the mock's literals and do not round to a
 * spacing ladder, so a later pass that tidies them onto one would quietly
 * redraw the screen; this is what stops it. In the browse project, on its
 * fake engine's Open Source, at the board's own 1280x800; nothing is added.
 */

test.use({ viewport: { width: 1280, height: 800 } });

async function openSelecting(page: Page) {
	await page.goto('/browse/100');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.grid button.tile').first().click();
	await expect(page.locator('.grid button.tile[aria-pressed="true"]')).toHaveCount(1);
}

const style = (page: Page, sel: string, props: string[]) =>
	page
		.locator(sel)
		.first()
		.evaluate((node, ps) => {
			const cs = getComputedStyle(node);
			return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]));
		}, props);

test('the bar: ✕, the count, SHOW and the way to the search (Select-Tablet)', async ({ page }) => {
	await openSelecting(page);
	const bar = 'header[aria-label="Selection"]';
	expect(await style(page, `${bar} .x`, ['font-size', 'padding-left'])).toEqual({
		'font-size': '16px',
		'padding-left': '24px'
	});
	expect(await style(page, `${bar} .count`, ['font-size', 'padding-left', 'column-gap'])).toEqual({
		'font-size': '17px',
		'padding-left': '18px',
		'column-gap': '10px'
	});
	expect(
		await style(page, `${bar} .hint`, ['flex-grow', 'font-size', 'font-weight', 'padding-left'])
	).toEqual({
		'flex-grow': '1',
		'font-size': '16px',
		'font-weight': '400',
		'padding-left': '18px'
	});
	// SETTINGS is left out while selecting, and so is the source's own bar.
	await expect(page.getByRole('link', { name: 'SETTINGS' })).toHaveCount(0);
});

test('a tile: the box, the ring, and IN LIBRARY at 0.4 (Tiles)', async ({ page }) => {
	await openSelecting(page);
	const on = '.grid button.tile[aria-pressed="true"]';
	expect(
		await style(page, `${on} .check`, [
			'width',
			'height',
			'left',
			'top',
			'border-top-width',
			'font-size',
			'font-weight'
		])
	).toEqual({
		width: '26px',
		height: '26px',
		left: '6px',
		top: '6px',
		'border-top-width': '2px',
		'font-size': '15px',
		'font-weight': '700'
	});
	// The select ring is the cover's: 3px of accent, outside it.
	expect((await style(page, `${on} .cover`, ['box-shadow']))['box-shadow']).toMatch(
		/0px 0px 0px 3px$/
	);
	const off = '.grid .tile.off';
	expect(await style(page, off, ['opacity'])).toEqual({ opacity: '0.4' });
	await expect(page.locator(`${off} .check`)).toHaveCount(0);
	// The grid's tracks are equal (the library's grid: six on the board, as
	// many as `--grid-cols` gives this width in the app).
	const tracks = (await style(page, '.grid', ['grid-template-columns']))['grid-template-columns']
		.split(' ')
		.map(parseFloat);
	expect(tracks.length).toBeGreaterThanOrEqual(6);
	expect(Math.max(...tracks) - Math.min(...tracks)).toBeLessThan(1);
});

test('the bulk bar: its line, then three cells of 60px (Bars)', async ({ page }) => {
	await openSelecting(page);
	expect(
		await style(page, '.bulk', ['position', 'bottom', 'border-top-width', 'border-top-style'])
	).toEqual({
		position: 'fixed',
		bottom: '0px',
		'border-top-width': '1px',
		'border-top-style': 'solid'
	});
	expect(
		await style(page, '.bulk .say', [
			'min-height',
			'padding-top',
			'padding-left',
			'column-gap',
			'font-size',
			'border-bottom-width'
		])
	).toEqual({
		'min-height': '44px',
		'padding-top': '8px',
		'padding-left': '24px',
		'column-gap': '12px',
		'font-size': '13px',
		'border-bottom-width': '1px'
	});
	const cells = page.locator('.bulk .acts button');
	await expect(cells).toHaveCount(3);
	for (let i = 0; i < 3; i++) {
		const box = await cells.nth(i).boundingBox();
		expect(box?.height).toBe(60);
	}
	const widths = await cells.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
	expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
	expect(await style(page, '.bulk .acts button small', ['font-size'])).toEqual({
		'font-size': '11px'
	});
	// ADD + FIRST 10 EACH is the accent cell, the common case.
	await expect(cells.nth(1)).toHaveClass(/acc/);
});

test("SHOW's rows: the group head, 72px rows, a 60px tick (Show-Tablet)", async ({ page }) => {
	await openSelecting(page);
	await page
		.getByRole('banner', { name: 'Selection' })
		.getByRole('button', { name: 'SHOW' })
		.click();
	const sheet = page.getByRole('dialog', { name: 'The selection' });
	await expect(sheet).toBeVisible();
	expect(await style(page, '.sheet-head', ['height'])).toEqual({ height: '60px' });
	expect(
		await style(page, '.grph', ['padding-top', 'padding-left', 'font-size', 'letter-spacing'])
	).toEqual({
		'padding-top': '12px',
		'padding-left': '16px',
		'font-size': '13px',
		'letter-spacing': '0.78px'
	});
	const row = await sheet.locator('.rw').first().boundingBox();
	expect(row?.height).toBeGreaterThanOrEqual(72);
	expect((await sheet.locator('.rw .tick').first().boundingBox())?.width).toBe(60);
	expect((await sheet.locator('.rw .box').first().boundingBox())?.width).toBe(24);
});
