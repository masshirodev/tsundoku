import { expect, test } from './fixtures';

/**
 * Catalogue links end to end (doc/LINKS.md), on the seed's links: Mount Hua
 * with three candidates, Yofukashi no Uta searched and nothing found, and The
 * Greatest Estate Developer linked from Mihon's MAL tracker. AniList is
 * switched off for the suite (TSUNDOKU_ANILIST=off), so a paste reads as
 * unreachable. Serial, tablet-portrait only; every test puts back what it did,
 * but for a SKIP, which only reorders the queue.
 */
test.describe.configure({ mode: 'serial' });

const band = (page: import('@playwright/test').Page) => page.getByText(/SERIES TO LINK/).first();

test('the library band counts the series to review, and opens the review', async ({ page }) => {
	await page.goto('/');
	await expect(band(page)).toHaveText('02 SERIES TO LINK');
	await page.getByRole('link', { name: 'Review the series to link' }).click();
	await page.waitForURL(/\/links$/);
	await expect(page.locator('.counter')).toHaveText('01 OF 02');
	await expect(page.locator('.title')).toHaveText('Return of the Mount Hua Sect');
	await expect(page.locator('.cand')).toHaveCount(3);
});

test('nothing is preselected; a tap chooses, LINK links, UNDO takes it back', async ({ page }) => {
	await page.goto('/links');
	const link = page.locator('.actions button').last();
	await expect(link).toHaveText('TAP ONE TO LINK');
	await expect(link).toBeDisabled();
	await page.locator('.cand').first().click();
	await expect(page.locator('.cand').first()).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.cand').first().locator('.chip')).toHaveText('✓ LINK THIS');
	await expect(link).toHaveText('LINK A');
	await link.click();
	await expect(page.locator('.band .line').first()).toHaveText(
		'LINKED · RETURN OF THE BLOSSOMING BLADE'
	);
	await expect(page.locator('.title')).toHaveText('Yofukashi no Uta');
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.title')).toHaveText('Return of the Mount Hua Sect');
	await page.goto('/');
	await expect(band(page)).toHaveText('02 SERIES TO LINK');
});

test('NONE OF THESE leaves the queue, and its UNDO brings it back', async ({ page }) => {
	await page.goto('/links');
	await page.getByRole('button', { name: 'NONE OF THESE' }).click();
	await expect(page.locator('.band .line').first()).toHaveText('NONE OF THESE · WON’T ASK AGAIN');
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.title')).toHaveText('Return of the Mount Hua Sect');
});

test('with nothing found: SEARCH AGAIN, AniList out of reach, waits for the pass; UNDO takes it back', async ({
	page
}) => {
	await page.goto('/links');
	await page.getByRole('button', { name: 'SKIP' }).click();
	await expect(page.locator('.title')).toHaveText('Yofukashi no Uta');
	await expect(page.getByText('AniList found nothing under this title.')).toBeVisible();
	// Nothing found can be skipped too.
	await expect(page.locator('.actions button')).toHaveText([
		'SEARCH AGAIN',
		'PASTE A LINK',
		'SKIP'
	]);
	await page.locator('.actions button', { hasText: 'SEARCH AGAIN' }).click();
	await page.getByLabel('Title to search on AniList').fill('Call of the Night');
	await page.getByRole('button', { name: 'SEARCH', exact: true }).click();
	// AniList is off for the suite, so the search waits for the pass, and says why.
	await expect(page.getByText('○ ANILIST UNREACHABLE · LINK STILL WORKS')).toBeVisible();
	const done = page.locator('.band', { has: page.getByRole('button', { name: 'UNDO' }) });
	await expect(done.locator('.line').first()).toHaveText('QUEUED · “Call of the Night”');
	await expect(done.locator('.line').nth(1)).toHaveText(
		'ANILIST UNREACHABLE · SEARCHED IN THE NEXT COVER PASS'
	);
	// Out of the review until the next pass...
	await expect(page.locator('.title')).toHaveText('Return of the Mount Hua Sect');
	await expect(page.locator('.counter')).toHaveText('02 OF 02');
	// ...unless UNDO puts it back as it was.
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.title')).toHaveText('Yofukashi no Uta');
	await page.goto('/');
	await expect(band(page)).toHaveText('02 SERIES TO LINK');
});

test('a pasted link needs AniList: unreachable, it says so and links nothing', async ({ page }) => {
	await page.goto('/links');
	// Either series may lead now (the SKIP above stands): PASTE A LINK is in the tools or the actions.
	await page.getByRole('button', { name: 'PASTE A LINK' }).click();
	await page.getByLabel('AniList or MAL link').fill('https://anilist.co/manga/85143');
	await expect(page.locator('.fnote.last')).toHaveText(
		'ANILIST DID NOT ANSWER · TRY AGAIN WHEN IT’S BACK'
	);
	await expect(page.getByText('○ ANILIST UNREACHABLE · LINK STILL WORKS')).toBeVisible();
	await page.getByLabel('AniList or MAL link').fill('not a link');
	await expect(page.locator('.fnote.last')).toHaveText('NOT AN ANILIST OR MAL MANGA LINK');
});

test('the series screen: LINK and COVER rows, and FIND opens its own review', async ({ page }) => {
	await page.goto('/');
	await page.locator('.tile', { hasText: 'The Greatest Estate Developer' }).first().click();
	await page.waitForURL(/\/series\/\d+/);
	const row = page.locator('.link-row');
	await expect(row.locator('.lk-a')).toHaveText('The Greatest Estate Developer');
	await expect(row.locator('.lk-b')).toHaveText(
		'ANILIST 900001 · MAL 800001 · FROM MIHON’S MAL TRACKER'
	);
	await expect(row.getByRole('link', { name: 'OPEN ↗' })).toHaveAttribute(
		'href',
		'https://anilist.co/manga/900001'
	);
	await expect(page.locator('.cover-row .cv-a')).toHaveText('NONE');

	const hua = page.url();
	await page.goto('/');
	await page.locator('.tile', { hasText: 'Return of the Mount Hua Sect' }).first().click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.locator('.link-row .lk-a')).toHaveText('Not linked');
	await expect(page.locator('.link-row .lk-b')).toHaveText(
		'3 CANDIDATES FROM THE LAST COVER PASS · NONE EXACT'
	);
	await page.locator('.lcs.inline').getByRole('link', { name: 'FIND' }).click();
	await page.waitForURL(/\/links\?series=\d+/);
	await expect(page.locator('.counter')).toHaveText('01 OF 01');
	await expect(page.locator('.back')).toHaveText('← SERIES');
	// One series only: no SKIP.
	await expect(page.getByRole('button', { name: 'SKIP' })).toHaveCount(0);
	await page.goto(hua);
});
