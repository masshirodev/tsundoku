import { type Page } from '@playwright/test';
import { expect, test } from './helpers/hydrated';

/**
 * The FILTER panel and + NEW (Library Filters turn 3, card c68;
 * doc/FILTERS.md), end to end on the seeded library.
 */

const filterCell = (page: Page) =>
	page.locator('summary', { hasText: 'FILTER' }).filter({ visible: true });
const panel = (page: Page) =>
	page.getByRole('group', { name: 'Filters' }).filter({ visible: true });
const rowOf = (page: Page, label: string) =>
	panel(page).locator('.row', { has: page.locator('.label', { hasText: label }) });

/**
 * Open the panel, and make sure it stayed open. It's a <details>: a click that
 * lands before hydration opens it natively, and hydration's `bind:open` then
 * shuts it again, which under the full run left LANGUAGE's links unclickable
 * for 30 s (2026-10-15). A second click, as a person would make, opens it.
 */
async function openFilters(page: Page) {
	// The layout writes this cookie once its script has run, so it is the
	// app's own "hydrated" mark. A click before that opens the panel natively,
	// and hydration's `bind:open` then shuts it — under the full run that left
	// the panel closed for the next click (2026-10-15; seen again 2026-11-01).
	await page
		.waitForFunction(() => document.cookie.includes('tsundoku_js=1'), null, { timeout: 2000 })
		.catch(() => undefined);
	await expect(async () => {
		if (!(await panel(page).isVisible())) await filterCell(page).click();
		await expect(panel(page)).toBeVisible({ timeout: 1000 });
	}).toPass();
}

async function reveal(page: Page) {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
}

test('a filter narrows the shelf: the URL, the label, the tab’s count and the cell all say so', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=title');
	const tab = page.locator('nav[aria-label="Shelves"] .tab.on').filter({ visible: true });
	const total = Number((await tab.locator('.n').textContent())!.trim());
	// A kind from the KIND band (c436): the active tab says what it narrows, and
	// the label names it, but FILTER's badge leaves it to the band.
	const band = page.getByRole('group', { name: 'Kind' });
	await band.getByRole('link', { name: /^MANGA/ }).click();
	await expect(page).toHaveURL(/kind=manga/);
	await expect(page.getByText('02 — ALL · MANGA')).toBeVisible();
	await expect(filterCell(page).locator('.badge')).toHaveCount(0);
	await openFilters(page);
	await rowOf(page, 'FAV').getByRole('link', { name: 'NOT FAV' }).click();
	await expect(page).toHaveURL(/fav=0/);
	await expect(page.getByText('02 — ALL · MANGA · NOT FAV')).toBeVisible();
	await expect(filterCell(page)).toContainText('1');
	const shown = await page.locator('.grid .tile').count();
	await expect(tab).toContainText(`${shown} OF ${total}`);
	// The band's MANGA counts what the grid shows: every filter but KIND.
	await expect(band.getByRole('link', { name: /^MANGA/ }).locator('.n')).toHaveText(String(shown));
	// No favourite is left on the grid.
	await expect(page.locator('.grid .tile', { hasText: 'FAV' })).toHaveCount(0);

	// Filters combine, and the panel stays open until DONE.
	await rowOf(page, 'DOWNLOADED').getByRole('link', { name: 'YES' }).click();
	await expect(page).toHaveURL(/fav=0.*dl=1|dl=1.*fav=0/);
	await expect(filterCell(page)).toContainText('2');
	await panel(page).getByRole('button', { name: 'DONE' }).click();
	await expect(panel(page)).toBeHidden();

	// CLEAR ALL clears what FILTER holds; the kind is the band's, and stays.
	await openFilters(page);
	await panel(page).getByRole('link', { name: '✕ CLEAR ALL' }).click();
	await expect(page).not.toHaveURL(/fav=|dl=/);
	await expect(page).toHaveURL(/kind=manga/);
});

test('RATING is one line: the blocks pick AT LEAST, UNRATED replaces it, ANY clears', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=title');
	await openFilters(page);
	const rating = rowOf(page, 'RATING');
	await rating.getByRole('link', { name: 'At least 3+' }).click();
	await expect(page).toHaveURL(/min=6/);
	await expect(page.getByText('· RATED 3+')).toBeVisible();
	await expect(rating.getByRole('link', { name: 'AT LEAST', exact: true })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await rating.getByRole('link', { name: 'UNRATED', exact: true }).click();
	await expect(page).toHaveURL(/rated=0/);
	await expect(page).not.toHaveURL(/min=/);
	await rating.getByRole('link', { name: 'ANY', exact: true }).click();
	await expect(page).not.toHaveURL(/rated=|min=/);
});

test('the retired shelves’ old links land on the same books, as filters', async ({ page }) => {
	await page.goto('/?shelf=favourites&sort=title');
	await expect(page).toHaveURL(/shelf=all.*fav=1|fav=1.*shelf=all/);
	await page.goto('/?shelf=rated4&min=7');
	await expect(page).toHaveURL(/min=7/);
	await expect(page).not.toHaveURL(/rated4/);
	await page.goto('/?shelf=downloaded');
	await expect(page).toHaveURL(/dl=1/);
	// And c436's: SERIES and ONE-OFF are FORM, each kind's shelf the band's ?kind=.
	await page.goto('/?shelf=series&sort=title');
	await expect(page).toHaveURL(/shelf=all.*form=series/);
	await expect(page.getByText('02 — ALL · SERIES')).toBeVisible();
	await page.goto('/?shelf=oneoff');
	await expect(page).toHaveURL(/form=oneoff/);
	await page.goto('/?shelf=k:novel&sort=title');
	await expect(page).toHaveURL(/shelf=all.*kind=novel/);
	await expect(
		page.getByRole('group', { name: 'Kind' }).getByRole('link', { name: /^NOVELS/ })
	).toHaveAttribute('aria-current', 'true');
});

test('the old shelf links answer 308, a permanent move, with the filter in its place', async ({
	request
}) => {
	for (const [from, to] of [
		['/?shelf=k:manga', '/?shelf=all&kind=manga'],
		['/?shelf=series&sort=title', '/?shelf=all&sort=title&form=series'],
		['/?shelf=oneoff', '/?shelf=all&form=oneoff']
	]) {
		const res = await request.get(from, { maxRedirects: 0 });
		expect(res.status()).toBe(308);
		expect(res.headers().location).toBe(to);
	}
});

test('filters that leave nothing say so about the shelf, and one move clears them', async ({
	page
}) => {
	await page.goto('/?shelf=all&kind=novel&min=10&fav=0');
	await expect(page.getByText('Nothing on All matches these filters.')).toBeVisible();
	await page.getByRole('link', { name: /^✕ CLEAR · SHOW \d+$/ }).click();
	await expect(page).not.toHaveURL(/min=|fav=/);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
});

test('hidden means hidden: no HIDDEN and no LANGUAGE while reveal is off', async ({ page }) => {
	await page.goto('/?shelf=all&hidden=1&lang=ja');
	// The language isn't on the visible shelf, so it drops; HIDDEN is never asked.
	await expect(page).not.toHaveURL(/lang=/);
	await openFilters(page);
	await expect(rowOf(page, 'HIDDEN')).toHaveCount(0);
	await expect(rowOf(page, 'LANGUAGE')).toHaveCount(0);
	await expect(page.locator('.grid .tile', { hasText: 'HIDDEN' })).toHaveCount(0);
});

test('with reveal on, LANGUAGE offers what the shelf holds and HIDDEN narrows to hidden', async ({
	page
}) => {
	await reveal(page);
	await page.goto('/?shelf=all&sort=title');
	await openFilters(page);
	await rowOf(page, 'LANGUAGE').getByRole('link', { name: 'JA' }).click();
	await expect(page).toHaveURL(/lang=ja/);
	await rowOf(page, 'HIDDEN').getByRole('link', { name: 'ONLY' }).click();
	await expect(page).toHaveURL(/hidden=1/);
	await expect(page.getByText('· JA · HIDDEN')).toBeVisible();
	const tiles = page.locator('.grid .tile');
	await expect(tiles.first()).toBeVisible();
	// A shelf without that language drops it rather than showing nothing.
	await page.goto('/?shelf=k:manhwa&lang=ja');
	await expect(page).not.toHaveURL(/lang=/);
});

test('the KIND band narrows any shelf to one kind, and FILTER has FORM instead of KIND', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=title');
	const band = page.getByRole('group', { name: 'Kind' });
	await expect(band.getByRole('link', { name: /^ALL/ })).toHaveAttribute('aria-current', 'true');
	await band.getByRole('link', { name: /^MANHWA/ }).click();
	await expect(page).toHaveURL(/kind=manhwa/);
	await expect(page.getByText(/· MANHWA/)).toBeVisible();
	await expect(band.getByRole('link', { name: /^MANHWA/ })).toHaveAttribute('aria-current', 'true');
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	const manhwa = await page.locator('.grid .tile').count();
	await expect(band.getByRole('link', { name: /^MANHWA/ }).locator('.n')).toHaveText(
		String(manhwa)
	);
	// FILTER no longer has KIND here: the band is that choice. It has FORM.
	await openFilters(page);
	await expect(rowOf(page, 'KIND')).toHaveCount(0);
	await rowOf(page, 'FORM').getByRole('link', { name: 'SERIES' }).click();
	await expect(page).toHaveURL(/form=series/);
	await expect(page).toHaveURL(/kind=manhwa/);
	await expect(page.getByText(/· MANHWA · SERIES/)).toBeVisible();
	await rowOf(page, 'FORM').getByRole('link', { name: 'ANY' }).click();
	await expect(page).not.toHaveURL(/form=/);
	await panel(page).getByRole('button', { name: 'DONE' }).click();
	// ALL clears the kind.
	await band.getByRole('link', { name: /^ALL/ }).click();
	await expect(page).not.toHaveURL(/kind=/);
});

test('the kind is remembered across shelves, kept at 0 where a shelf has none, and ALL KINDS shows the shelf', async ({
	page
}) => {
	await page.goto('/?shelf=all&kind=novel&sort=title');
	const band = page.getByRole('group', { name: 'Kind' });
	await expect(band.getByRole('link', { name: /^NOVELS/ })).toHaveAttribute('aria-current', 'true');
	// TO FINISH holds manga and manhwa: the tab carries the kind there.
	const toFinish = page
		.locator('nav[aria-label="Shelves"]')
		.filter({ visible: true })
		.getByRole('link', { name: /^TO FINISH/ });
	const held = Number((await toFinish.locator('.n').textContent())!.trim());
	await toFinish.click();
	await expect(page).toHaveURL(/shelf=c(%3A|:)\d+.*kind=novel/);
	const novels = band.getByRole('link', { name: /^NOVELS/ });
	await expect(novels).toHaveAttribute('aria-current', 'true');
	await expect(novels).toHaveClass(/zero/);
	await expect(novels.locator('.n')).toHaveText('0');
	await expect(page.getByText('No novels on To finish.')).toBeVisible();
	await page.getByRole('link', { name: `✕ ALL KINDS · SHOW ${held}` }).click();
	await expect(page).not.toHaveURL(/kind=/);
	await expect(page.locator('.grid .tile')).toHaveCount(held);
	// Gone where the shelf has none of it, now nothing chose it.
	await expect(band.getByRole('link', { name: /^NOVELS/ })).toHaveCount(0);
});

test('+ NEW makes a shelf by name and lands on it, empty, with how to fill it', async ({
	page
}) => {
	await page.goto('/?shelf=all');
	await page.getByRole('link', { name: '+ NEW' }).filter({ visible: true }).click();
	await expect(page).toHaveURL(/new=shelf/);
	const sheet = page.getByRole('dialog', { name: 'New shelf' });
	const name = `Finished ${Date.now() % 100000}`;
	await sheet.getByLabel('Shelf name').fill(name);
	await sheet.getByRole('button', { name: `CREATE ${name.toUpperCase()}` }).click();
	await expect(page).toHaveURL(/shelf=c(%3A|:)\d+/);
	await expect(page.getByText(`Nothing on ${name} yet.`)).toBeVisible();
	// An empty shelf has nothing to filter.
	await expect(filterCell(page)).toHaveCount(0);

	// A kind carried here (the band keeps it across shelves): still the empty
	// shelf and how to fill it, not "no manga on it" with SHOW 0.
	const url = new URL(page.url());
	url.searchParams.set('kind', 'manga');
	await page.goto(url.pathname + url.search);
	await expect(page.getByText(`Nothing on ${name} yet.`)).toBeVisible();
	await expect(page.locator('.empty-shelf').getByRole('button', { name: 'SELECT' })).toBeVisible();
	await expect(page.getByText(/^No manga on/)).toHaveCount(0);
	await expect(page.getByText(/ALL KINDS · SHOW 0/)).toHaveCount(0);
});

test('without script, the panel still opens and every choice is a link', async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto('/?shelf=k:manga');
	await openFilters(page);
	await rowOf(page, 'FAV').getByRole('link', { name: 'NOT FAV' }).click();
	await expect(page).toHaveURL(/fav=0/);
	await expect(page.getByText('02 — ALL · MANGA · NOT FAV')).toBeVisible();
	// The KIND band is links too: a kind without script.
	await page
		.getByRole('group', { name: 'Kind' })
		.getByRole('link', { name: /^MANHWA/ })
		.click();
	await expect(page).toHaveURL(/kind=manhwa.*fav=0|fav=0.*kind=manhwa/);
	await expect(page.getByText('02 — ALL · MANHWA · NOT FAV')).toBeVisible();
	await context.close();
});

test('a person’s page filters on the device, LANGUAGE included', async ({ page }) => {
	await reveal(page);
	await page.goto('/?tag=circle:Hakka%20Kousha');
	await openFilters(page);
	await rowOf(page, 'FAV').getByRole('button', { name: 'NOT FAV' }).click();
	await expect(page.getByText(/— BOOKS · NOT FAV/)).toBeVisible();
	await expect(rowOf(page, 'LANGUAGE')).toBeVisible();
	await panel(page).getByRole('button', { name: '✕ CLEAR ALL' }).click();
	await expect(page.getByText(/— BOOKS · NOT FAV/)).toHaveCount(0);
});

test('READING narrows hidden series too: unread, then read', async ({ page }) => {
	await reveal(page);
	await page.goto('/?shelf=all&sort=title&hidden=1');
	const all = await page.locator('.grid .tile').count();
	await page.waitForLoadState('networkidle');
	await openFilters(page);
	const reading = rowOf(page, 'READING');
	await reading.getByRole('link', { name: 'UNREAD' }).click();
	await expect(page).toHaveURL(/progress=unread/);
	await expect(page.getByText('02 — ALL · UNREAD · HIDDEN')).toBeVisible();
	const unread = await page.locator('.grid .tile').count();
	await reading.getByRole('link', { name: 'READ', exact: true }).click();
	await expect(page).toHaveURL(/progress=read(&|$)/);
	const begun = await page.locator('.grid .tile').count();
	expect(unread + begun).toBeLessThanOrEqual(all);
	await reading.getByRole('link', { name: 'ANY' }).click();
	await expect(page).not.toHaveURL(/progress=/);
});
