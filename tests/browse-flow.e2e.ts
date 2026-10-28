import { test, expect } from './fixtures';
import { engineCalls, engineDown, resetEngine, SOURCES } from './browse-world';

/**
 * Browsing a source (Index-Browse; doc/BROWSE.md; card c141), end to end,
 * against the fake engine tests/browse-setup.ts starts. Nothing here can
 * reach a real site. The fake keeps what it's asked, so the filters the
 * panel sends are checked as the engine receives them.
 */

const OPEN = `/browse/${SOURCES.open.id}`;

test.beforeEach(async () => {
	await resetEngine();
});

test('a source’s POPULAR shelf says what’s already yours, and names no hidden source', async ({
	page
}) => {
	await page.goto(OPEN);
	await expect(page.locator('.screen > .label')).toContainText('01 — POPULAR');
	await expect(page.locator('nav[aria-label="Lists"]')).toContainText('LATEST');
	const linden = page.locator('.tile', { hasText: 'Lindenborough Heir' });
	await expect(linden.locator('.badge')).toHaveText('IN LIBRARY');
	await expect(linden).toHaveAttribute('href', /^\/series\/\d+$/);
	// A twin of a series from Toonily, which is mostly hidden: SAME TITLE, but not "FROM TOONILY".
	const twin = page.locator('.tile', { hasText: 'Toonily One' });
	await expect(twin.locator('.m')).toHaveText('SAME TITLE IN LIBRARY');
	await expect(page.locator('body')).not.toContainText('TOONILY');
	// Anything else opens c94's preview, which returns here.
	const other = page.locator('.tile', { hasText: 'Open Source 1-2' });
	await expect(other).toHaveAttribute('href', /^\/downloads\/source\/100~.+\?from=%2Fbrowse%2F100/);
});

test('it scrolls on: the next page is asked for and added, and the URL keeps the place', async ({
	page
}) => {
	// A list of its own, so nothing an earlier test asked for is kept for it.
	await page.goto(`${OPEN}?q=paged`);
	// At tablet height the end is near at once, so page 2 comes without a scroll.
	await expect(page).toHaveURL(/pages=2/);
	await expect(page.locator('.grid .tile')).toHaveCount(26);
	await expect(page.locator('.screen > .label')).toContainText('26 IN ALL');
	const pages = (await engineCalls())
		.filter((c) => c.method === 'getSearchManga' && c.search === 'paged')
		.map((c) => c.page);
	// Page 1 was kept from the first ask: each page went to the source once.
	expect(pages).toEqual([1, 2]);
	// Back to the start of the list is a different list, and a link.
	await expect(page.locator('nav[aria-label="Lists"] a', { hasText: 'POPULAR' })).toHaveAttribute(
		'href',
		OPEN
	);
});

test('filters wait for APPLY, land on FILTERED, and reach the engine as it reads them', async ({
	page
}) => {
	await page.goto(OPEN);
	await page.getByRole('link', { name: /^FILTER/ }).click();
	const panel = page.locator('form.panel');
	await expect(panel.locator('.head')).toContainText('0 ON');
	await panel.getByRole('button', { name: /^Cooking/ }).click();
	await panel.getByRole('button', { name: /^Romance/ }).click();
	await panel.getByRole('button', { name: /^Romance/ }).click();
	await panel.locator('label', { hasText: 'COMPLETED' }).click();
	await panel.locator('label', { hasText: 'HAS CHAPTERS' }).click();
	await expect(panel.locator('.head')).toContainText('4 ON');
	// Nothing was asked yet: filters wait.
	expect((await engineCalls()).some((c) => c.method === 'getSearchManga')).toBe(false);

	await panel.getByRole('button', { name: /APPLY/ }).click();
	await expect(page).toHaveURL(/tab=filtered/);
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('FILTERED');
	await expect(page.locator('a.filter .badge')).toHaveText('4');
	await expect(page.locator('.tile')).toHaveText(/Filtered One/);

	const search = (await engineCalls()).find((c) => c.method === 'getSearchManga')!;
	expect(search.filterList).toEqual(
		expect.arrayContaining([
			{ name: 'Status', type: 'select', stateInt: 2 },
			{
				name: 'Has chapters',
				type: 'checkbox',
				stateList: [{ name: 'Has chapters', type: 'checkbox', stateBoolean: false }]
			},
			{
				name: 'Genre',
				type: 'group',
				stateList: [
					{ name: 'Action', type: 'tristate', stateInt: 0 },
					{ name: 'Cooking', type: 'tristate', stateInt: 1 },
					{ name: 'Romance', type: 'tristate', stateInt: 2 }
				]
			}
		])
	);
});

test('a search inside the source keeps its filters', async ({ page }) => {
	await page.goto(`${OPEN}?tab=filtered&f2=1&f3=1&f5.1=1`);
	const field = page.getByRole('searchbox', { name: /Search Open Source/ });
	await field.fill('linden');
	await field.press('Enter');
	await expect(page).toHaveURL(/q=linden/);
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('SEARCH');
	const search = (await engineCalls()).find(
		(c) => c.method === 'getSearchManga' && c.search === 'linden'
	)!;
	expect(search.filterList).toEqual(
		expect.arrayContaining([{ name: 'Status', type: 'select', stateInt: 1 }])
	);
});

test.describe('without script', () => {
	test.use({ javaScriptEnabled: false });

	test('the shelf is drawn whole, MORE is a link, and the panel’s cells apply', async ({
		page
	}) => {
		await page.goto(OPEN);
		await expect(page.locator('.grid .tile')).toHaveCount(14);
		await expect(page.locator('.screen > .label')).not.toContainText('MORE AS YOU SCROLL');
		await page.getByRole('link', { name: 'MORE ↓' }).click();
		await expect(page).toHaveURL(/pages=2/);
		await expect(page.locator('.grid .tile')).toHaveCount(26);

		await page.goto(`${OPEN}?panel=1`);
		await page.locator('.tri', { hasText: 'Cooking' }).getByLabel('include').check({ force: true });
		await page.getByRole('button', { name: /APPLY/ }).click();
		await expect(page).toHaveURL(/f5\.1=1/);
		const search = (await engineCalls()).find((c) => c.method === 'getSearchManga')!;
		expect(search.filterList).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'Genre',
					stateList: expect.arrayContaining([{ name: 'Cooking', type: 'tristate', stateInt: 1 }])
				})
			])
		);
	});
});

test('hidden means hidden: a mostly-hidden source isn’t there with reveal off, and is with it', async ({
	page,
	context
}) => {
	const res = await page.goto(`/browse/${SOURCES.hidden.id}`);
	expect(res?.status()).toBe(404);

	await context.addCookies([
		{ name: 'tsundoku_reveal', value: '1', domain: 'localhost', path: '/', httpOnly: true }
	]);
	await page.goto(`/browse/${SOURCES.hidden.id}`);
	await expect(page.locator('header.bar .name')).toHaveText('TOONILY');
	await page.goto(OPEN);
	await expect(page.locator('.tile', { hasText: 'Toonily One' }).locator('.m')).toHaveText(
		'SAME TITLE · FROM TOONILY'
	);
});

test('a source that failed to load, and an engine that stopped, say so', async ({ page }) => {
	await page.goto(`/browse/${SOURCES.broken.id}`);
	await expect(page.locator('.band')).toContainText('FAILED TO LOAD · PROTOBUF');

	await engineDown();
	// A list not asked before in this run, so nothing kept answers for the engine.
	await page.goto(`${OPEN}?q=asked-while-down`);
	await expect(page.locator('.band')).toContainText('NOT ANSWERING');
});

test('on the phone, / opens the search in the title’s place, and the grid is three wide', async ({
	page
}) => {
	await page.setViewportSize({ width: 360, height: 780 });
	await page.goto(OPEN);
	await expect(page.locator('header.bar .find')).toBeHidden();
	await expect(page.locator('header.bar .slash')).toBeVisible();
	const cols = await page
		.locator('.screen > .grid')
		.evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
	expect(cols).toBe(3);
	await page.locator('header.bar .slash').click();
	await expect(page.locator('header.bar .find')).toBeVisible();
	await expect(page.locator('header.bar .title')).toBeHidden();
});
