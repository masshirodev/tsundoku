import { expect, test, type Locator } from '@playwright/test';

/**
 * The FILTER panel's measurements, from Library Filters.dc.html turn 3
 * (doc/FILTERS.md). They're hand-set in the mock, not a spacing scale:
 * 132px labels, 52px rows, a 640px panel on the desktop. Asserted so a later
 * tidy-up can't round them onto something else and redraw the screen.
 * Runs on every device project; each checks its own arrangement.
 */

const px = (l: Locator, prop: string) =>
	l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test('the panel, as the mock measures it on this device', async ({ page }, info) => {
	const device = info.project.name;
	await page.goto('/?shelf=all&min=8');
	const cell = page.locator('summary', { hasText: 'FILTER' }).filter({ visible: true });
	await expect(cell).toHaveCount(1);
	// Hydration's bind:open shuts a panel a native click opened (filters-flow).
	await page
		.waitForFunction(() => document.cookie.includes('tsundoku_js=1'), null, { timeout: 2000 })
		.catch(() => undefined);
	expect(await px(cell, 'font-size')).toBe('14px');
	expect(await px(cell, 'border-left-width')).toBe('1px');
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
		// On the tabs: the panel spans the bar.
		const bar = page.locator('div.tabs').filter({ visible: true });
		const barBox = (await bar.boundingBox())!;
		expect(Math.round(box.width)).toBe(Math.round(barBox.width));
	}
});
