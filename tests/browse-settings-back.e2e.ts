import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { resetEngine, SOURCES } from './browse-world';

/**
 * A source's SETTINGS knows where it was opened from (doc/NAVIGATION.md,
 * "From a source"). Opened from EXTENSIONS' SETTINGS cell, its ← says Back to
 * EXTENSIONS and goes back there, through history when the list is a few entries
 * back (so the list comes back as it was left), else by the address it was given
 * (a reload, a new tab, a bookmark). Opened from the source's own page, ← is the
 * source's, as before. A forged `from` is ignored. Runs in the `browse` project
 * because EXTENSIONS and a source's settings exist only against the browse world's
 * fake engine; desktop and phone are set per `describe`.
 */

const OPEN = SOURCES.open;
const SETTINGS = `/browse/${OPEN.id}/settings`;
const LIST = '/browse/extensions?tab=installed';
const fromList = `${SETTINGS}?from=${encodeURIComponent(LIST)}`;

/** SvelteKit's index of the history entry the page is on: the witness that ← went back, not forward. */
const entry = (page: Page) =>
	page.evaluate(() => (history.state as Record<string, number> | null)?.['sveltekit:history']);
const settingsCell = (page: Page) =>
	page.locator('.rows .row', { hasText: OPEN.name }).getByRole('link', { name: 'SETTINGS' });

test.beforeEach(async () => {
	await resetEngine();
});

const VIEWPORTS = [
	{
		name: 'desktop',
		use: {
			viewport: { width: 1440, height: 900 },
			userAgent: devices['Desktop Chrome'].userAgent,
			hasTouch: false,
			isMobile: false,
			deviceScaleFactor: 1
		}
	},
	{
		name: 'phone',
		use: (({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch }) => ({
			viewport,
			userAgent,
			deviceScaleFactor,
			isMobile,
			hasTouch
		}))(devices['Pixel 7'])
	}
];

for (const v of VIEWPORTS)
	test.describe(`on a ${v.name}`, () => {
		test.use(v.use);

		test('EXTENSIONS › a source’s SETTINGS › ← goes back to EXTENSIONS, on its tab', async ({
			page
		}) => {
			await page.goto(LIST);
			const listEntry = await entry(page);
			await expect(settingsCell(page)).toHaveAttribute('href', fromList);
			await settingsCell(page).click();
			await expect(page).toHaveURL(new RegExp(`${SETTINGS}\\?from=`));
			await expect(page.locator('.title .name')).toHaveText('SETTINGS');
			const link = page.getByRole('link', { name: 'Back to EXTENSIONS' });
			await expect(link).toBeVisible();
			await expect(link).toHaveAttribute('href', LIST);
			// A switch saved here is not a step away: ← still goes back to the list.
			const saver = page.locator('form.set', { hasText: 'Data saver' });
			const was = await saver.getByRole('switch').getAttribute('aria-checked');
			await saver.getByRole('switch').click();
			await expect(saver).toHaveClass(/\bsaved\b/);
			await link.click();
			await expect(page).toHaveURL(LIST);
			await expect(page.locator('.rows .row', { hasText: OPEN.name })).toBeVisible();
			// Back in history to the entry it came from, not a new one on top.
			expect(await entry(page)).toBe(listEntry);
			// Put the switch back, for whoever reads the source's settings next.
			await settingsCell(page).click();
			await page.locator('form.set', { hasText: 'Data saver' }).getByRole('switch').click();
			await expect(
				page.locator('form.set', { hasText: 'Data saver' }).getByRole('switch')
			).toHaveAttribute('aria-checked', was!);
		});

		test('a reload of SETTINGS keeps the way back to EXTENSIONS, through history', async ({
			page
		}) => {
			await page.goto(LIST);
			const listEntry = await entry(page);
			await settingsCell(page).click();
			await expect(page).toHaveURL(new RegExp(`${SETTINGS}\\?from=`));
			await page.reload();
			await page.getByRole('link', { name: 'Back to EXTENSIONS' }).click();
			await expect(page).toHaveURL(LIST);
			expect(await entry(page)).toBe(listEntry);
		});

		test('SETTINGS replaced by its own question (?ask=conceal) still goes back to EXTENSIONS', async ({
			page
		}) => {
			await page.goto(LIST);
			await settingsCell(page).click();
			await expect(page).toHaveURL(new RegExp(`${SETTINGS}\\?from=`));
			// The no-script question's address, as a reload or a link without script lands on it;
			// the page then replaces it with its own (`closeAsk`) or leaves it, and ← is the list's either way.
			await page.goto(`${fromList}&ask=conceal`);
			await page.keyboard.press('Escape');
			await page.getByRole('link', { name: 'Back to EXTENSIONS' }).click();
			await expect(page).toHaveURL(LIST);
		});

		test('opened in a new tab, or from a bookmark, ← opens EXTENSIONS by its address', async ({
			page,
			context
		}) => {
			// A new tab: no history behind it.
			const tab = await context.newPage();
			await tab.goto(fromList);
			await expect(tab.getByRole('link', { name: 'Back to EXTENSIONS' })).toHaveAttribute(
				'href',
				LIST
			);
			const first = await entry(tab);
			await tab.getByRole('link', { name: 'Back to EXTENSIONS' }).click();
			await expect(tab).toHaveURL(LIST);
			expect(await entry(tab)).not.toBe(first);
			await tab.close();

			// A bookmark, opened after another screen: ← is EXTENSIONS, not that screen.
			await page.goto('/browse');
			await page.goto(fromList);
			await page.getByRole('link', { name: 'Back to EXTENSIONS' }).click();
			await expect(page).toHaveURL(LIST);
		});

		test('the source’s own SETTINGS cell keeps ← to the source', async ({ page }) => {
			await page.goto(`/browse/${OPEN.id}`);
			const sourceEntry = await entry(page);
			await page.locator('a.cell.settings').click();
			await expect(page).toHaveURL(SETTINGS);
			await expect(page.getByRole('link', { name: 'Back to EXTENSIONS' })).toHaveCount(0);
			const link = page.getByRole('link', { name: `Back to ${OPEN.name}` });
			await expect(link).toHaveAttribute('href', `/browse/${OPEN.id}`);
			await link.click();
			// The entry as it was left: a tall screen loaded a second page (`?pages=2`) there.
			await expect(page).toHaveURL(new RegExp(`/browse/${OPEN.id}(\\?pages=\\d+)?$`));
			await expect(page.locator('.grid .tile').first()).toBeVisible();
			expect(await entry(page)).toBe(sourceEntry);
		});

		test('a forged origin is ignored: ← is the source’s', async ({ page }) => {
			for (const forged of [
				'https://evil.example/browse/extensions',
				'//evil.example/browse/extensions',
				'/browse/x/../extensions',
				'/browse/x/%2e%2e/extensions',
				'/%2F%2Fevil.example/browse/extensions',
				'/browse/extensions%5C',
				'/browse/extensions/'
			]) {
				await page.goto(`${SETTINGS}?from=${encodeURIComponent(forged)}`);
				await expect(page.getByRole('link', { name: 'Back to EXTENSIONS' }), forged).toHaveCount(0);
				await expect(
					page.getByRole('link', { name: `Back to ${OPEN.name}` }),
					forged
				).toHaveAttribute('href', `/browse/${OPEN.id}`);
			}
			// And the switches' own posts don't carry it on either.
			await expect(page.locator('form.own').first()).toHaveAttribute('action', `${SETTINGS}?/flag`);
		});
	});
