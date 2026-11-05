import { expect, test } from './fixtures';

/**
 * MOVE from a remote (c235; doc/MOVE.md). The screens are c139's, which
 * predates the focus layer: this pins that a D-pad reaches them, and that BACK
 * climbs the comparison before it leaves the page.
 *
 * It reads and never moves anything -- `tests/browse-move.e2e.ts` owns the move
 * itself, on its own series ("Movenberg Heir"), so this one walks
 * "Lindenborough Heir" to the comparison and stops there. The browse world's
 * server, because the fake engine is what has a candidate to offer.
 */

const BROWSE = `http://localhost:${process.env.PLAYWRIGHT_BROWSE_PORT ?? '4194'}`;
const TITLE = 'Lindenborough Heir';

test.use({ baseURL: BROWSE });

const focused = (page: import('@playwright/test').Page) =>
	page.evaluate(() => ({
		text: document.activeElement?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
		cls: document.activeElement?.className ?? ''
	}));

async function openMove(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	// SOURCE is folded under DETAILS on a TV (c425): one stop, OK opens it in place.
	const details = page.locator('[data-row="details"]');
	await details.focus();
	await expect(async () => {
		if ((await details.getAttribute('aria-expanded')) !== 'true')
			await page.keyboard.press('Enter');
		await expect(details).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
	}).toPass();
	// The SOURCE row's way out is a ruled cell of the panel, and a stop.
	await page.getByRole('link', { name: 'MOVE →' }).focus();
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/series\/\d+\/move/);
}

test('the SOURCE row opens the move page, and arrows walk its candidates', async ({ page }) => {
	await openMove(page);
	await expect(page.getByText('MOVE TO ANOTHER SOURCE')).toBeVisible();

	// Nothing focused: the first arrow takes the page's top-left, the top bar's ←.
	await page.keyboard.press('ArrowDown');
	expect((await focused(page)).text).toContain('SERIES');
	// ↓ to the search field, ↓ to the candidate the source answered with.
	await page.keyboard.press('ArrowDown');
	expect((await focused(page)).cls).toContain('svelte');
	await page.keyboard.press('ArrowDown');
	expect((await focused(page)).cls).toContain('cand');
});

test('a candidate opens the comparison, and BACK climbs before it leaves', async ({ page }) => {
	await openMove(page);
	const candidate = page.locator('a.cand').first();
	await expect(candidate).toBeVisible();
	await candidate.focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/to=/);

	// The comparison is a screen of ruled blocks: the fold, then the MOVE bar.
	const move = page.getByRole('button', { name: /MOVE TO .+ →/ });
	await expect(move).toBeVisible();
	await move.focus();
	expect((await focused(page)).text).toContain('MOVE TO');

	// BACK climbs to the top of the screen first (TV Calls, "BACK climbs before
	// it leaves"), and does not leave the page.
	const at = page.url();
	await page.keyboard.press('Escape');
	expect(page.url()).toBe(at);
	expect((await focused(page)).text).toContain('SERIES');
	// At the top there is nothing left for the page to take: the app leaves.
	expect(await page.evaluate(() => window.tsundokuBack!())).toBe(false);
});
