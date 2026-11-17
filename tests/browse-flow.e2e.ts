import { devices } from '@playwright/test';
import { test, expect, hydrated } from './helpers/hydrated';
import { behindACheck, engineCalls, engineDown, resetEngine, SOURCES } from './browse-world';
import { revealOn } from './helpers/reveal';

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
	// Its series, which keeps this page as where ← goes (c262).
	await expect(linden).toHaveAttribute('href', /^\/series\/\d+\?from=%2Fbrowse%2F100/);
	// A twin of a series from Toonily, which is mostly hidden: SAME TITLE, but not "FROM TOONILY".
	const twin = page.locator('.tile', { hasText: 'Toonily One' });
	await expect(twin.locator('.m')).toHaveText('SAME TITLE IN LIBRARY');
	await expect(page.locator('body')).not.toContainText('TOONILY');
	// Anything else opens c94's preview, which returns here.
	const other = page.locator('.tile', { hasText: 'Open Source 1-2' });
	await expect(other).toHaveAttribute('href', /^\/downloads\/source\/100~.+\?from=%2Fbrowse%2F100/);
});

test('LATEST keeps the origin a tag opened the source from, and ← still returns to it (c453)', async ({
	page
}) => {
	// The address a tag on a preview builds (tag-search.ts, `tagSearchHref`); this
	// world's details carry no tags to tap, so the source page is opened at it.
	const origin = `/downloads/source/100~${Buffer.from('/manga/tagged').toString('base64url')}`;
	await page.goto(`${OPEN}?from=${encodeURIComponent(origin)}`);
	const latest = page.locator('nav[aria-label="Lists"]').getByRole('link', { name: 'LATEST' });
	await latest.click();
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('LATEST');
	const u = new URL(page.url());
	expect(u.searchParams.get('tab')).toBe('latest');
	expect(u.searchParams.get('from')).toBe(origin);
	const back = page.locator('header.bar a.back');
	await expect(back).toHaveAttribute('aria-label', 'Back to the preview');
	expect(new URL((await back.getAttribute('href'))!, u).pathname).toBe(origin);
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

	await revealOn(context);
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

/**
 * c654 (the owner, 2026-11-06, on a phone): "the back button at the top of a
 * browsed entry goes back and opens the search bar". Measured on this base by
 * the owner's own steps — BROWSE, a source, a tile, the preview's ← — it does
 * not: with real taps the return is the source page's URL with no `find` or
 * `q`, its search form hidden, and focus on `body`. The two causes the card
 * named are both out of reach of those steps: the tile's `from` is the source
 * page's own URL (which has no `find` unless the search was already open,
 * `doc/handoff-notes/series.md`, wave 29), and a tap cannot be dispatched a
 * second time onto the page it navigates to (a click navigates on `click`,
 * and the link is inside the client-side router). So this case is a guard,
 * not a fix: it pins the expected return, and goes red if the return ever
 * starts drawing the search.
 *
 * The browse world runs once, in the `browse` project (Galaxy Tab S4 at
 * 800 × 1280), so the describe takes the Pixel 7 and skips itself elsewhere.
 */
test.describe('on a phone, the back from a browsed entry (c654)', () => {
	// A Pixel 7's own viewport, touch and mobile flag. `defaultBrowserType` is
	// left out: a describe may not set it (Playwright would need a new worker).
	const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
	test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

	test('← goes back to the source’s own URL, and the search stays as it was', async ({
		page
	}, testInfo) => {
		test.skip(testInfo.project.name !== 'browse', 'the browse world runs in the `browse` project');
		await page.goto(OPEN);
		// A real tap, as the owner made: a click cannot reproduce a tap-through.
		await page.locator('.tile', { hasText: 'Open Source 1-2' }).tap();
		await page.waitForURL(/\/downloads\/source\//);
		await page.locator('a.back').tap();

		await page.waitForURL(/\/browse\/100/);
		const u = new URL(page.url());
		expect(u.pathname).toBe('/browse/100');
		expect(u.searchParams.has('find')).toBe(false);
		expect(u.searchParams.get('q')).toBeNull();
		// Both halves of what the owner expected: the source page, its search shut.
		await expect(page.locator('header.bar .find')).toBeHidden();
		await expect(page.locator('header.bar .title')).toBeVisible();
		await expect(page.locator('header.bar .slash')).toBeVisible();
		expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
	});
});

test('BROWSE lists the sources by kind, RECENT once one is visited, and no hidden source', async ({
	page
}) => {
	await page.goto(OPEN);
	await page.getByRole('link', { name: 'Back to BROWSE' }).click();
	await expect(page).toHaveURL(/\/browse$/);
	const labels = page.locator('.screen > .label');
	await expect(labels.nth(0)).toContainText('01 — RECENT');
	await expect(labels.nth(1)).toContainText('02 — MANGA');
	// The newest visit first (an earlier test visited the broken one too).
	await expect(page.locator('.rows').first().locator('.row').first()).toContainText('Open Source');
	// The failed extension is c94's failed row, and leads to EXTENSIONS, not its page.
	// (In RECENT too, from an earlier test: the MANGA section's is the one checked.)
	const broken = page.locator('.rows').nth(1).locator('.row', { hasText: 'Broken Source' });
	await expect(broken).toContainText('FAILED TO LOAD · PROTOBUF');
	await expect(broken).toHaveAttribute('href', '/browse/extensions');
	// Toonily is mostly hidden: not listed, named or counted.
	await expect(page.locator('body')).not.toContainText('Toonily');
	await expect(labels.nth(1)).toContainText('2');
});

test('the ways in: a cell on the tablet’s bar, and the empty search on a phone', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.locator('a.browse-cell')).toBeVisible();

	await page.setViewportSize({ width: 360, height: 780 });
	await page.goto(OPEN);
	await page.goto('/search');
	await expect(page.locator('.label.first')).toContainText('BROWSE A SOURCE');
	await expect(page.locator('.b-rows .row').first()).toContainText('Open Source');
	await page.getByRole('link', { name: /ALL SOURCES · BROWSE/ }).click();
	await expect(page).toHaveURL(/\/browse$/);
});

test.describe('on a desktop', () => {
	// A desktop is a fine pointer, not a width: the tablet project's touch is switched off.
	test.use({
		viewport: { width: 1440, height: 900 },
		userAgent: devices['Desktop Chrome'].userAgent,
		hasTouch: false,
		isMobile: false,
		deviceScaleFactor: 1
	});

	test('BROWSE is in the sidebar, under HISTORY, and not on the bar', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('a.browse-cell')).toBeHidden();
		// BROWSE sits under HISTORY, whatever else the foot holds: GET STARTED
		// sits above it until onboarding is done (doc/ONBOARDING.md), so
		// asserting "the first link is HISTORY" passed only after some earlier
		// spec had finished the trail (c273).
		const browse = page.locator('.side-foot a', { hasText: 'BROWSE' });
		await expect(browse).toBeVisible();
		await expect(browse.locator('xpath=preceding-sibling::a[1]')).toHaveText('HISTORY');
	});
});

test('a source’s settings: each type saves, and the source’s page asks again with them', async ({
	page
}) => {
	await page.goto(OPEN);
	await page.getByRole('link', { name: 'SETTINGS' }).click();
	await expect(page).toHaveURL(`${OPEN}/settings`);
	await hydrated(page);
	const row = (t: string) => page.locator('form.set', { hasText: t });
	// In the source's own order, not the keys'.
	await expect(page.locator('form.set .t')).toHaveText([
		'Cover quality',
		'Data saver',
		'Alternative titles',
		'Content rating',
		'Blocked groups'
	]);
	await row('Data saver').getByRole('switch').click();
	await expect(row('Data saver').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
	await row('Alternative titles').getByRole('checkbox').click();
	await expect(row('Alternative titles').getByRole('checkbox')).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await row('Cover quality').getByRole('radio', { name: 'LOW' }).click();
	await expect(row('Cover quality').getByRole('radio', { name: 'LOW' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	// A box is ticked by the browser at once, and saved after: the row is
	// marked saved when the page has the action's answer. Read only the tick
	// and the test went on while the save was in flight, so the source's page
	// sometimes asked before it landed (c249).
	await row('Content rating').locator('label', { hasText: 'SUGGESTIVE' }).click();
	await expect(row('Content rating').locator('input[value="suggestive"]')).toBeChecked();
	await expect(row('Content rating')).toHaveClass(/\bsaved\b/);
	await row('Blocked groups').getByRole('textbox').fill('abc-123');
	await row('Blocked groups').getByRole('button', { name: 'SAVE' }).click();
	await expect(row('Blocked groups')).toHaveClass(/\bsaved\b/);
	await expect(row('Blocked groups').getByRole('textbox')).toHaveValue('abc-123');

	await resetEngine();
	await page.getByRole('link', { name: /^Back to/ }).click();
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	// The answer may have been on its way before the tile was drawn: wait for the call itself.
	let seen: string[] = [];
	await expect
		.poll(
			async () => {
				const all = await engineCalls();
				seen = all.map((c) => c.method);
				return all.some((c) => c.method === 'getPopularManga');
			},
			{ message: `calls after the settings changed: ${seen.join(', ')}` }
		)
		.toBe(true);
	const popular = (await engineCalls()).find((c) => c.method === 'getPopularManga')!;
	const sent = Object.fromEntries((popular.preferences ?? []).map((p) => [p.key, p]));
	expect(sent.saver.switchPreferenceCompat.value).toBe(true);
	expect(sent.alt.checkBoxPreference.value).toBe(true);
	expect(sent.quality.listPreference.valueIndex).toBe(2);
	expect(sent.rating.multiSelectListPreference.values).toEqual(['safe', 'suggestive']);
	expect(sent.blocked.editTextPreference.value).toBe('abc-123');
});

test('a site’s browser check is named at once, and BROWSE says a first visit waits for it', async ({
	page
}) => {
	await page.goto(OPEN);
	await behindACheck(4000);
	// A search from the page is a client-side navigation: the page is there at once,
	// and the answer streams in after the check.
	const field = page.getByRole('searchbox', { name: /Search Open Source/ });
	await field.fill('behind-a-check');
	await field.press('Enter');
	const band = page.locator('.band', { hasText: "PASSING THE SITE'S BROWSER CHECK" });
	await expect(band).toBeVisible({ timeout: 2500 });
	await expect(band).toContainText('A FIRST VISIT TAKES 20–45 S');
	await expect(page.locator('.screen > .label')).toContainText('WAITING FOR THE SITE');
	await expect(page.locator('.grid .tile', { hasText: 'Filtered One' })).toBeVisible({
		timeout: 10_000
	});
	await expect(band).toHaveCount(0);

	await page.goto('/browse');
	await expect(
		page.locator('.rows').nth(1).locator('.row', { hasText: 'Open Source' })
	).toContainText("FIRST VISIT WAITS FOR THE SITE'S CHECK");
});
