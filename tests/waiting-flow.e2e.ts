import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Waiting (doc/WAITING.md): the screens between a tap and the next one, with
 * the network slowed on purpose. Nothing here writes to the database: the one
 * write it makes is refused on its way out.
 */
test.describe.configure({ mode: 'serial' });
// Three cases slow a screen's `__data.json` with page.route, and the service
// worker answers every `__data.json` itself once it controls the page, past the
// route (src/service-worker.ts; doc/TESTING.md, "Load"). Nothing here reads
// offline; offline-flow owns that (c477).
test.use({ serviceWorkers: 'block' });

/** Hold a screen's data for `ms` before letting it through. */
async function slow(page: Page, pattern: string, ms: number) {
	await page.route(pattern, async (route) => {
		await new Promise((r) => setTimeout(r, ms));
		await route.continue().catch(() => undefined);
	});
}

test('a slow shelf: the tab is pressed, then the line, then the grid in outline', async ({
	page
}) => {
	await page.goto('/?sort=title');
	// The KIND band's MANGA (c436), which asks `?kind=manga`: the sidebar's
	// MANGA shelf, `?shelf=k:manga`, is gone, and a route on it matched nothing.
	await slow(page, '**/__data.json?*kind=manga*', 2500);
	const tab = page
		.getByRole('group', { name: 'Kind' })
		.getByRole('link', { name: /^MANGA/ })
		.filter({ visible: true });
	await tab.click();
	await expect(tab).toHaveClass(/nav-pressed/);
	await expect(page.getByRole('progressbar', { name: 'Loading' }).first()).toBeVisible();
	// From 1 s: CONTINUE and the tabs stay, the grid goes to outline.
	await expect(page.getByText('LOADING', { exact: true })).toBeVisible({ timeout: 3000 });
	await expect(page.locator('.grid .tile .cover').first()).toBeVisible();
	await expect(page.locator('.grid .tile', { hasText: 'Dungeon Meshi' })).toHaveCount(0);
	// And the real shelf lands in its place.
	await expect(page.locator('.grid .tile', { hasText: 'Dungeon Meshi' })).toBeVisible({
		timeout: 5000
	});
	await expect(page.getByRole('progressbar', { name: 'Loading' })).toHaveCount(0);
	await expect(page.locator('.nav-pressed')).toHaveCount(0);
});

test('a slow series opens at once with what the tile knew', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await slow(page, '**/series/*/__data.json*', 2500);
	await page.locator('.grid .tile', { hasText: 'Dungeon Meshi' }).click();
	// The title, the rating and the list's counts are the tile's; the rest is outline.
	await expect(page.getByRole('heading', { name: 'Dungeon Meshi' })).toBeVisible({ timeout: 1000 });
	await expect(page.getByText('97 · 97 READ')).toBeVisible();
	await expect(page.locator('[aria-busy="true"]')).toBeVisible();
	// CONTINUE can't open until its chapter is known.
	await expect(page.locator('.cta')).toHaveAttribute('aria-disabled', 'true');
	await page.waitForURL(/\/series\/\d+/, { timeout: 5000 });
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
	await expect(page.locator('.cta')).toHaveAttribute('aria-disabled', 'false');
});

test('a workstation that doesn’t answer says so, and ← BACK stays put', async ({ page }) => {
	test.setTimeout(40_000);
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await slow(page, '**/history/__data.json*', 30_000);
	await page
		.getByRole('link', { name: /HISTORY/ })
		.first()
		.click();
	await expect(page.getByText('○ WORKSTATION NOT ANSWERING')).toBeVisible({ timeout: 12_000 });
	await expect(page.getByText(/^ASKED \d+ S AGO · STILL ASKING$/)).toBeVisible();
	await page.getByRole('button', { name: '← BACK' }).click();
	await expect(page.getByText('○ WORKSTATION NOT ANSWERING')).toHaveCount(0);
	await expect(page).toHaveURL(/\/\?sort=title$/);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
});

test('a rating that doesn’t save stays, dashed, until PUT BACK', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Dungeon Meshi' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.route('**/series/*?/rate', (route) => route.abort());
	const panel = page.getByRole('region', { name: 'About this series' });
	await expect(panel.getByRole('button', { name: 'Rate 10 of 10' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await panel.getByRole('button', { name: 'Rate 4 of 10' }).click();
	await expect(page.getByText('RATING 4 NOT SAVED')).toBeVisible();
	await expect(panel.getByText('NOT SAVED', { exact: true })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Rate 4 of 10' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// RETRY still can't reach it; PUT BACK shows what's stored.
	await page.getByRole('button', { name: 'RETRY' }).click();
	await expect(page.getByText('RATING 4 NOT SAVED')).toBeVisible();
	await page.getByRole('button', { name: 'PUT BACK 10' }).click();
	await expect(page.getByText('RATING 4 NOT SAVED')).toHaveCount(0);
	await expect(panel.getByRole('button', { name: 'Rate 10 of 10' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});
