import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Two failed saves on the series screen (c686; doc/WAITING.md, "Writes that
 * failed"): each is its own control's real save, lost on the wire with
 * `page.route`, and each keeps its own band, PUT BACK and RETRY through a
 * navigation. Runs once, in tablet-portrait, because the second failure is a
 * second control on one screen and needs no other device's layout.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Return of the Mount Hua Sect';

const isAction = (action: string) => (u: URL) =>
	/^\/series\/\d+$/.test(u.pathname) && u.search === `?/${action}`;

const band = (page: Page, text: string) => page.locator('[role="alert"]', { hasText: text });
const panelOf = (page: Page) => page.getByRole('region', { name: 'About this series' });

test('two failed fields on the series screen each keep PUT BACK and RETRY, through a navigation (c686)', async ({
	page
}) => {
	const lostFav = isAction('favourite');
	const lostRate = isAction('rate');
	await page.route(lostFav, (route) => route.abort());
	await page.route(lostRate, (route) => route.abort());

	await page.goto('/?shelf=all&sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	const panel = panelOf(page);
	const fav = panel.getByRole('button', { name: /^FAV( ✓)?$/ });
	const wasFav = await fav.getAttribute('aria-pressed');
	// A value the seed does not hold, so the tap is a change.
	const rate = panel.getByRole('button', { name: 'Rate 3 of 10' });
	const rated = (await rate.getAttribute('aria-pressed')) === 'true';
	const value = rated ? 4 : 3;
	const favText = wasFav === 'true' ? 'UNFAV NOT SAVED' : 'FAV NOT SAVED';
	const rateText = `RATING ${value} NOT SAVED`;

	await fav.click();
	await expect(band(page, favText)).toHaveCount(1);
	await panel.getByRole('button', { name: `Rate ${value} of 10` }).click();
	await expect(band(page, rateText)).toHaveCount(1);
	// The second failure did not take the first one's band.
	await expect(band(page, favText)).toHaveCount(1);
	await expect(page.locator('[role="alert"]')).toHaveCount(2);
	for (const text of [favText, rateText]) {
		await expect(band(page, text).getByRole('button', { name: /PUT BACK/ })).toBeVisible();
		await expect(band(page, text).getByRole('button', { name: 'RETRY' })).toBeVisible();
	}

	// Away and back, the nudge retrying and losing each time.
	await page.goBack();
	await expect(page.locator('.grid .tile', { hasText: TITLE })).toBeAttached();
	await expect(page.locator('[role="alert"]')).toHaveCount(2);
	// Each nudge's own two POSTs have to be lost before the route lifts below:
	// a retry still on its way would otherwise land by itself.
	const nudged = Promise.all(
		['favourite', 'rate'].map((action) =>
			page.waitForEvent('requestfailed', {
				predicate: (r) => new RegExp(`/series/\\d+\\?/${action}$`).test(r.url())
			})
		)
	);
	await page.goForward();
	await page.waitForURL(/\/series\/\d+/);
	await nudged;
	await expect(page.locator('[role="alert"]')).toHaveCount(2);
	await expect(band(page, favText).getByRole('button', { name: 'RETRY' })).toBeVisible();
	await expect(band(page, rateText).getByRole('button', { name: /PUT BACK/ })).toBeVisible();

	// RETRY lands for FAV alone: the rating's band is still up.
	await page.unroute(lostFav);
	const stored = page.waitForResponse((r) => /\/series\/\d+\?\/favourite$/.test(r.url()) && r.ok());
	await band(page, favText).getByRole('button', { name: 'RETRY' }).click();
	await stored;
	await expect(band(page, favText)).toHaveCount(0);
	await expect(band(page, rateText)).toHaveCount(1);

	// PUT BACK ends the rating's alone, and its value comes back.
	await band(page, rateText)
		.getByRole('button', { name: /PUT BACK/ })
		.click();
	await expect(page.locator('[role="alert"]')).toHaveCount(0);
	await page.unroute(lostRate);

	// Put FAV back as the seed has it: the RETRY did store it.
	const restored = page.waitForResponse(
		(r) => /\/series\/\d+\?\/favourite$/.test(r.url()) && r.ok()
	);
	await fav.click();
	await restored;
	await page.reload();
	await expect(panelOf(page).getByRole('button', { name: /^FAV( ✓)?$/ })).toHaveAttribute(
		'aria-pressed',
		wasFav!
	);
});
