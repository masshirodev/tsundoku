import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Tab and a screen reader read the series panel in the order it is drawn
 * (c556, WCAG 2.4.3; doc/SERIES.md, "Two markups"). Where nothing folds, the
 * screen's order is the DOM's: DOWNLOAD, the bands, DIRECTION, SHELVES, LISTS
 * to TAGS, ABOUT, FILE; on a phone or a TV the bands, SHELVES and ABOUT stand
 * above DETAILS instead, and the other copy of each is `display: none`. A plain
 * `*.e2e.ts`, so it runs on the four device projects: the walk by Tab needs a
 * fine pointer and a panel that does not fold, so it is the desktop's, and the
 * "one copy is drawn" case is every project's. It only reads the shared seed:
 * Holiday Duty, the seed's single book with look-alikes, carries the MIGHT BE
 * ONE SERIES band (hidden, so the case reveals, which is the browser's own
 * cookie); Tower of God has no band and an ABOUT.
 */

const openCircle = async (page: Page, title: string) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
	await page.goto('/?sort=title');
	await expect(async () => {
		await page.locator('.grid .tile', { hasText: title }).first().click();
		await page.waitForURL(/\/series\/\d+/, { timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
};

type Stop = { label: string; top: number; group: string };

/** Tab from CONTINUE until the focus leaves the panel, reading each stop's row. */
async function walk(page: Page): Promise<Stop[]> {
	await page.locator('.panel a.cta').focus();
	const stops: Stop[] = [];
	for (let i = 0; i < 120; i++) {
		await page.keyboard.press('Tab');
		const s = await page.evaluate(() => {
			const el = document.activeElement as HTMLElement | null;
			const panel = el?.closest('section.panel') as HTMLElement | null;
			if (!el || !panel) return null;
			const row =
				(el.closest('.row, .prow, .sugg, .twin, .band, [data-row]') as HTMLElement | null) ?? el;
			const scroller = panel.scrollTop;
			return {
				label: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
				top: row.getBoundingClientRect().top - panel.getBoundingClientRect().top + scroller,
				group: row.querySelector('.label')?.textContent?.replace(/\?/g, '').trim() ?? ''
			};
		});
		if (!s) break;
		stops.push(s);
	}
	return stops;
}

test.describe('Tab through the panel', () => {
	test.beforeEach(({ page }, info) => {
		void page;
		test.skip(info.project.name !== 'desktop', 'the walk needs a fine pointer, and no fold');
	});

	test('follows the rows top to bottom, a band included', async ({ page }) => {
		await openCircle(page, 'Holiday Duty');
		await expect(page.getByRole('region', { name: 'Might be one series' })).toBeVisible();
		const stops = await walk(page);
		expect(stops.length, stops.map((s) => s.label).join(' | ')).toBeGreaterThan(4);
		for (let i = 1; i < stops.length; i++)
			expect(
				stops[i].top,
				`${stops[i - 1].label} (${stops[i - 1].top}) then ${stops[i].label} (${stops[i].top})`
			).toBeGreaterThanOrEqual(stops[i - 1].top - 1);
		const at = (name: RegExp) => stops.findIndex((s) => name.test(s.label));
		const band = at(/REVIEW/);
		const shelves = stops.findIndex((s) => s.group === 'SHELVES');
		const direction = stops.findIndex((s) => /^(READ|DIRECTION)|R→L|L→R|PAGED|STRIP/.test(s.group));
		expect(band, stops.map((s) => s.label).join(' | ')).toBeGreaterThan(-1);
		expect(shelves).toBeGreaterThan(band);
		// The row the fold's order moved under SHELVES comes first where nothing folds.
		if (direction !== -1) expect(direction).toBeLessThan(shelves);
	});

	test('reaches DIRECTION before SHELVES, and ABOUT after LISTS', async ({ page }) => {
		await openCircle(page, 'Tower of God');
		const stops = await walk(page);
		const names = stops.map((s) => `${s.group}:${s.label}`);
		const edit = names.findIndex((n) => n.startsWith('SHELVES:EDIT'));
		const more = names.findIndex((n) => /MORE ↓/.test(n));
		const r2l = names.findIndex((n) => /R→L|L→R|PAGED|STRIP/.test(n));
		expect(edit, names.join(' | ')).toBeGreaterThan(-1);
		expect(r2l, names.join(' | ')).toBeGreaterThan(-1);
		expect(r2l).toBeLessThan(edit);
		expect(more, names.join(' | ')).toBeGreaterThan(edit);
	});
});

test('one copy of the bands, SHELVES and ABOUT is drawn, on every device', async ({ page }) => {
	await openCircle(page, 'Tower of God');
	// Where the fold applies, open it: the screen's copies are inside it.
	const line = page.locator('[data-row="details"]');
	if (await line.isVisible())
		await expect(async () => {
			if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
			await expect(line).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
		}).toPass();
	await expect(page.locator('.panel .about:visible')).toHaveCount(1);
	await expect(
		page
			.locator('.panel .row:visible', { hasText: 'SHELVES' })
			.getByRole('button', { name: 'EDIT' })
	).toHaveCount(1);
});
