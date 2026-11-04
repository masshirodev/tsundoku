import { test as plain, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The library's top bar (c431, c105; doc/LIBRARY.md, "The top bar"). Runs on
 * every device project, each checking its own arrangement of cells. Reads the
 * seed only: nothing here writes.
 */

/**
 * The rules in the bar's right-hand group, boundary by boundary: the group's
 * own left edge, then every pair of cells that are drawn. Each boundary's
 * number is the width of rule painted there, whichever side draws it. A cell
 * may be a wrapper (the desktop's FILTER), so its inner summary counts too.
 */
async function rules(page: Page) {
	return page.locator('header.bar[aria-label="Library"] .right').evaluate((right) => {
		const w = (el: Element | null, side: 'left' | 'right') =>
			el ? parseFloat(getComputedStyle(el).getPropertyValue(`border-${side}-width`)) : 0;
		const shown = [...right.children].filter((c) => c.getBoundingClientRect().width > 0);
		const name = (c: Element) => (c.textContent ?? '').replace(/\s+/g, ' ').trim().split(' ')[0];
		const left = (c: Element) => w(c, 'left') + w(c.querySelector(':scope summary'), 'left');
		const rightOf = (c: Element) => w(c, 'right') + w(c.querySelector(':scope summary'), 'right');
		const out: { between: string; px: number }[] = [
			{ between: `| ${name(shown[0])}`, px: w(right, 'left') + left(shown[0]) }
		];
		for (let i = 1; i < shown.length; i++)
			out.push({
				between: `${name(shown[i - 1])} | ${name(shown[i])}`,
				px: rightOf(shown[i - 1]) + left(shown[i])
			});
		return out;
	});
}

test('every pair of cells in the top bar has one hairline between them, FILTER and SELECT too', async ({
	page
}, info) => {
	await page.goto('/');
	const bar = page.locator('header.bar[aria-label="Library"]');
	await expect(bar.getByRole('button', { name: 'SELECT' })).toBeVisible();
	const closed = await rules(page);
	// The card's own pair is the desktop's: FILTER sits beside SELECT there.
	if (info.project.name === 'desktop')
		expect(closed.map((r) => r.between)).toContain('FILTER | SELECT');
	for (const r of closed) expect(r, r.between).toEqual({ between: r.between, px: 1 });

	if (info.project.name !== 'desktop') return;
	// Open, FILTER's cell turns inverse; the rule against SELECT stays.
	await bar.locator('summary', { hasText: 'FILTER' }).click();
	await expect(
		page.getByRole('group', { name: 'Filters' }).filter({ visible: true })
	).toBeVisible();
	expect(await rules(page)).toEqual(closed);
	const desk = bar.locator('.filter-desk');
	await expect(desk).toHaveCSS('border-right-width', '1px');
	await expect(desk).toHaveCSS('border-right-style', 'solid');
});

// The plain runner's goto, not the fixture's: that one waits for the network
// to go quiet, which is exactly the hydration this case must beat.
plain('FILTER tapped before the page hydrates stays open (c105)', async ({ page }) => {
	// Hold the app's scripts back, so the server's markup is all there is.
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/_app/immutable/**/*.js', async (route) => {
		await held;
		await route.continue();
	});
	await page.goto('/', { waitUntil: 'commit' });
	const cell = page.locator('summary', { hasText: 'FILTER' }).filter({ visible: true });
	// Until the stylesheet lands, the desktop draws both FILTERs (the tabs' too).
	await expect(cell).toHaveCount(1);
	await cell.click();
	const panel = page.getByRole('group', { name: 'Filters' }).filter({ visible: true });
	await expect(panel).toBeVisible();
	expect(await page.evaluate(() => document.cookie.includes('tsundoku_js=1'))).toBe(false);

	release();
	await page.waitForFunction(() => document.cookie.includes('tsundoku_js=1'));
	await page.waitForLoadState('networkidle');
	// Hydrated, the panel is still open, and the page knows it is (the caret).
	await expect(panel).toBeVisible();
	await expect(cell).toContainText('▴');
	// And it still closes the way it always did.
	await panel.getByRole('button', { name: 'DONE' }).click();
	await expect(panel).toBeHidden();
	await expect(cell).toContainText('▾');
});
