import { expect, test } from './fixtures';

/**
 * The search's COMMAND row (doc/LIBRARY.md, the Search row). Typing follows the results a
 * beat behind, by replacing the address 180 ms after the last key; a command
 * typed over results clears them that way too. Read-only, on the shared
 * database.
 */

test('a page command tapped within the beat opens its page, however slowly it loads', async ({
	page
}) => {
	await page.goto('/search?q=chainsaw');
	await expect(page.locator('.hits .hit').first()).toBeVisible();
	// The page's data held past the beat, as a slow phone's would be: the
	// replace that clears the results comes due while /help is on its way.
	let release = () => {};
	const held = new Promise<void>((done) => (release = done));
	let reached = () => {};
	const asked = new Promise<void>((done) => (reached = done));
	await page.route(
		(u) => u.pathname === '/help/__data.json',
		async (route) => {
			reached();
			await held;
			await route.continue();
		}
	);
	await page.getByRole('searchbox', { name: 'Search' }).fill('/help');
	await page.locator('a.page-cmd').click();
	await asked;
	// Past the beat with the navigation still out: a replace left pending
	// would go to /search now and take the place of /help.
	await page.waitForTimeout(600);
	release();
	await page.waitForURL(/\/help/);
	await page.waitForTimeout(600);
	await expect(page).toHaveURL(/\/help/);
});
