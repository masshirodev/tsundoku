import { expect, test, type Locator } from '@playwright/test';

/**
 * The FILTER panel's measurements (doc/FILTERS.md). They're hand-set in the
 * mock, not a spacing scale: 132px labels, 52px rows, a 640px panel on the
 * desktop. Asserted so a later tidy-up can't round them onto something else
 * and redraw the screen.
 * Runs on every device project; each checks its own arrangement. The
 * phone's and tablet's FILTER is the KIND band's last cell, in the band's
 * 13px with 14px a side, and its panel opens
 * the band's width under it; the desktop's stays in the top bar at 14px.
 */

const px = (l: Locator, prop: string) =>
	l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test('the panel, as the mock measures it on this device', async ({ page }, info) => {
	const device = info.project.name;
	await page.goto('/?shelf=all&min=8');
	const cell = page.locator('summary', { hasText: 'FILTER' }).filter({ visible: true });
	await expect(cell).toHaveCount(1);
	// No wait for hydration: a native open before it now survives it.
	expect(await px(cell, 'font-size')).toBe(device === 'desktop' ? '14px' : '13px');
	if (device !== 'desktop') {
		expect(await px(cell, 'padding-left')).toBe('14px');
		expect(await px(cell, 'padding-right')).toBe('14px');
		// Inside the band, pinned at its right end.
		const band = page.getByRole('group', { name: 'Kind' });
		const b = (await band.boundingBox())!;
		const c = (await cell.boundingBox())!;
		expect(Math.round(c.x + c.width)).toBe(Math.round(b.x + b.width));
		expect(Math.round(c.height)).toBe(39);
	}
	// On the band FILTER draws its own divider; in the desktop's top bar the
	// cell before it draws that one, and FILTER the rule against SELECT.
	if (device === 'desktop') {
		expect(await px(cell, 'border-left-width')).toBe('0px');
		expect(await px(page.locator('.filter-desk'), 'border-right-width')).toBe('1px');
	} else expect(await px(cell, 'border-left-width')).toBe('1px');
	await cell.click();
	const panel = page.getByRole('group', { name: 'Filters' }).filter({ visible: true });
	await expect(panel).toBeVisible();
	expect(await px(panel, 'border-top-width')).toBe('1px');

	const head = panel.locator('.head');
	expect(await px(head, 'padding')).toBe('14px 16px');
	expect(await px(head, 'font-size')).toBe('12px');

	const row = panel.locator('.row').first();
	const label = row.locator('.label');
	const opt = row.locator('.opt').first();
	expect((await opt.boundingBox())!.height).toBeGreaterThanOrEqual(52);
	expect(await px(opt, 'padding-left')).toBe('14px');
	expect(await px(opt, 'font-size')).toBe('14px');

	const foot = panel.locator('.foot');
	expect((await foot.boundingBox())!.height).toBe(52);
	expect(await px(panel.locator('.done'), 'padding-left')).toBe('24px');

	if (device === 'phone') {
		// 3d: each label above its choices, the blocks a whole line under them.
		expect(await px(row, 'flex-direction')).toBe('column');
		expect(await px(label, 'padding')).toBe('12px 16px 6px');
		const blocks = row.locator('.blocks');
		expect((await blocks.boundingBox())!.width).toBeCloseTo((await row.boundingBox())!.width, 0);
	} else {
		expect(await px(row, 'flex-direction')).toBe('row');
		expect((await label.boundingBox())!.width).toBe(132);
		expect(await px(label, 'border-right-width')).toBe('1px');
	}

	const box = (await panel.boundingBox())!;
	const viewport = page.viewportSize()!;
	if (device === 'desktop') {
		// 3j: 640 wide, hanging from the top bar's right edge.
		expect(box.width).toBe(640);
		expect(Math.round(box.x + box.width)).toBe(viewport.width);
	} else {
		// On the band: the panel spans it.
		const bar = page.getByRole('group', { name: 'Kind' });
		const barBox = (await bar.boundingBox())!;
		expect(Math.round(box.width)).toBe(Math.round(barBox.width));
	}
});
