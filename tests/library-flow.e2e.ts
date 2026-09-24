import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * One complete flow with real data, end to end: rate, favourite, shelve and
 * hide from the long-press sheet, then reveal and unhide. This is the walk
 * doc/design's HANDOFF asks for early, because it is what surfaces an
 * invariant a mock never had to satisfy.
 *
 * Each test restores what it changed, so the order they run in does not
 * matter and the seeded library stays the one the other specs expect.
 */

const TITLE = 'Kusuriya no Hitorigoto';

// These write to the one seeded database the preview server holds, so they run
// in order, and only on the tablet project (the others ignore `*-flow.e2e.ts`
// in playwright.config.ts). The frame specs are read-only and run everywhere.
test.describe.configure({ mode: 'serial' });

async function longPress(page: Page, title: string) {
	const tile = page.locator('.grid .tile', { hasText: title });
	// Under a full parallel run hydration can trail the load event, and a
	// right-click before it opens nothing.
	await page.waitForLoadState('networkidle');
	await tile.scrollIntoViewIfNeeded();
	await tile.click({ button: 'right' }); // the context menu is the long press
	const sheet = page.getByRole('dialog', { name: title });
	await expect(sheet).toBeVisible();
	return sheet;
}

test('rating from the sheet persists, and 0 clears it back to unrated', async ({ page }) => {
	await page.goto('/');
	let sheet = await longPress(page, TITLE);
	// Unrated: no cell is filled and the label says so.
	await expect(sheet.getByText('UNRATED', { exact: true })).toBeVisible();
	for (const name of ['Unrated', 'Rate 1', 'Rate 5']) {
		await expect(sheet.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
	}

	await sheet.getByRole('button', { name: 'Rate 2' }).click();
	await expect(sheet.getByRole('button', { name: 'Rate 2' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.keyboard.press('Escape');
	const bars = page.locator('.grid .tile', { hasText: TITLE }).getByRole('img');
	await expect(bars).toHaveAttribute('aria-label', 'Rated 2 of 5');

	await page.reload();
	sheet = await longPress(page, TITLE);
	await expect(sheet.getByRole('button', { name: 'Rate 2' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await sheet.getByRole('button', { name: 'Unrated' }).click();
	await expect(sheet.getByText('UNRATED', { exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(bars).toHaveAttribute('aria-label', 'Unrated');
});

test('favourite toggles from the sheet and shows on the tile', async ({ page }) => {
	await page.goto('/');
	const tile = page.locator('.grid .tile', { hasText: TITLE });
	await expect(tile.getByText('FAV', { exact: true })).toHaveCount(0);

	const sheet = await longPress(page, TITLE);
	await sheet.getByRole('switch').click();
	await expect(sheet.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await expect(tile.getByText('FAV', { exact: true })).toBeVisible();

	await longPress(page, TITLE);
	await page.getByRole('switch').click();
	await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});

test('FAV toggles on the cover in one tap, without opening anything', async ({ page }) => {
	await page.goto('/');
	const tile = page.locator('.grid .tile', { hasText: TITLE });
	const fav = tile.getByRole('button', { name: 'Favourite' });
	await expect(fav).toHaveAttribute('aria-pressed', 'false');

	// The tile changes at once and saves behind it: a reload waits for the save.
	const saved = () => page.waitForResponse((r) => r.url().includes('/favourite') && r.ok());
	let save = saved();
	await fav.click();
	await expect(fav).toHaveAttribute('aria-pressed', 'true');
	await expect(tile.getByText('FAV', { exact: true })).toBeVisible();
	await save;
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('dialog')).toHaveCount(0);

	await page.reload();
	await expect(fav).toHaveAttribute('aria-pressed', 'true');
	save = saved();
	await fav.click();
	await expect(fav).toHaveAttribute('aria-pressed', 'false');
	await save;
	await page.reload();
	await expect(tile.getByText('FAV', { exact: true })).toHaveCount(0);
});

test('the rating bars open the six cells on the tile, and a cell saves', async ({ page }) => {
	await page.goto('/');
	const tile = page.locator('.grid .tile', { hasText: TITLE });
	const bars = tile.getByRole('img');
	await tile.getByRole('button', { name: /^Rate, / }).click();
	const picker = tile.getByRole('group', { name: 'Rating' });
	await expect(picker.getByRole('button')).toHaveCount(6);

	await picker.getByRole('button', { name: 'Rate 4' }).click();
	await expect(picker).toHaveCount(0);
	await expect(bars).toHaveAttribute('aria-label', 'Rated 4 of 5');
	await expect(page).toHaveURL(/\/$/);

	await page.reload();
	await expect(bars).toHaveAttribute('aria-label', 'Rated 4 of 5');
	// A tap elsewhere closes it without choosing.
	await tile.getByRole('button', { name: /^Rate, / }).click();
	await expect(picker).toBeVisible();
	await page.evaluate(() =>
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
	);
	await expect(picker).toHaveCount(0);

	await tile.getByRole('button', { name: /^Rate, / }).click();
	await picker.getByRole('button', { name: 'Unrated' }).click();
	await expect(bars).toHaveAttribute('aria-label', 'Unrated');
});

test('the app’s name goes home, and DOWNLOADED is a shelf', async ({ page }) => {
	await page.goto('/?shelf=rated4&sort=title');
	const downloaded = page.getByRole('link', { name: /^DOWNLOADED/ }).filter({ visible: true });
	await downloaded.click();
	await expect(page).toHaveURL(/shelf=downloaded/);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	await page.getByRole('link', { name: 'Library' }).filter({ visible: true }).first().click();
	await expect(page).toHaveURL(/\/$/);
});

test('hidden means hidden, until /reveal, and HIDE AGAIN ends it', async ({ page }) => {
	await page.goto('/');
	const sheet = await longPress(page, TITLE);
	await sheet.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(page.locator('.grid .tile', { hasText: TITLE })).toHaveCount(0);

	// Search does not find it either.
	await page.goto(`/search?q=${encodeURIComponent('Kusuriya')}`);
	await expect(page.getByText('TITLES')).toBeVisible();
	await expect(page.locator('.hit')).toHaveCount(0);

	// Reveal is the exact typed command, run on Enter.
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	await expect(page).toHaveURL('/');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	const tile = page.locator('.grid .tile', { hasText: TITLE });
	await expect(tile.getByText('HIDDEN', { exact: true })).toBeVisible();

	// Unhide it, then end reveal.
	await longPress(page, TITLE);
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(tile.getByText('HIDDEN', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	await expect(page.locator('.grid .tile', { hasText: TITLE })).toBeVisible();
});

test('nothing hints at the hidden root while reveal is off', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText(/HENTOID/i)).toHaveCount(0);
	await expect(page.getByText(/hidden/i)).toHaveCount(0);
	const res = await page.request.get('/search?q=Onsen');
	expect(await res.text()).not.toContain('Onsen Ryokan');
});

test('multi-select applies a rating to exactly the selection', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const tile = (title: string) => page.locator('.grid .tile', { hasText: title });
	// Two unrated series, so clearing them afterwards restores them exactly.
	const picked = ['Hoshi no Umi no Tabibito', 'Isekai Yakkyoku'];
	for (const t of picked) await tile(t).click();
	await expect(page.getByText('2 SELECTED')).toBeVisible();

	const bystander = tile('Isekai Ojisan').getByRole('img');
	await expect(bystander).toHaveAttribute('aria-label', 'Rated 3 of 5');

	const toolbar = page.getByRole('toolbar');
	await toolbar.getByRole('button', { name: 'Rate 5' }).click();
	for (const t of picked)
		await expect(tile(t).getByRole('img')).toHaveAttribute('aria-label', 'Rated 5 of 5');
	await expect(bystander).toHaveAttribute('aria-label', 'Rated 3 of 5');

	await toolbar.getByRole('button', { name: 'Unrated' }).click();
	for (const t of picked)
		await expect(tile(t).getByRole('img')).toHaveAttribute('aria-label', 'Unrated');
});

test('START SCAN with nothing to import says where it looked', async ({ request }) => {
	// playwright.config.ts points LIBRARY_ROOT at an empty folder, so a scan
	// here can never import into the shared seeded database.
	const res = await request.post('/?/scan', {
		headers: { origin: 'http://localhost:4183', 'x-sveltekit-action': 'true' },
		form: {}
	});
	expect(await res.text()).toContain('NOTHING TO IMPORT');
});

test('the grid loads a page at a time, says when the rest did not come, and SELECT ALL takes the whole shelf', async ({
	page
}) => {
	// A page of six, so the seed's twenty-odd series make several pages.
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '6', url: 'http://localhost' }]);
	// The workstation stops answering for pages (not for SELECT ALL's ids).
	const pages = (url: URL) => url.pathname === '/api/library' && !url.searchParams.has('ids');
	await page.route(pages, (route) => route.abort());
	await page.goto('/?shelf=all&sort=title');
	const tiles = page.locator('.grid .tile');
	await expect(tiles).toHaveCount(6);
	const more = page.locator('.more');
	await expect(more).toContainText(/^6 OF \d+ · THE REST\s+DID NOT LOAD/);
	const total = Number(/OF (\d+)/.exec((await more.textContent()) ?? '')![1]);
	expect(total).toBeGreaterThan(12);

	// SELECT ALL counts the series not loaded too.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	// More than the six on screen: other specs change the shelf in parallel, so not an exact figure.
	const picked = async () =>
		Number(/^(\d+)/.exec((await page.getByText(/^\d+ SELECTED$/).textContent()) ?? '')?.[1] ?? 0);
	await expect.poll(picked).toBeGreaterThan(total - 3);
	await page.getByRole('button', { name: 'Stop selecting' }).click();

	// Back again: RETRY, and the pages come in until the shelf is whole.
	await page.unroute(pages);
	await more.getByRole('button', { name: 'RETRY' }).click();
	for (let i = 0; i < 20 && (await more.count()) > 0; i++) {
		await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
		await page.waitForTimeout(150);
	}
	await expect(more).toHaveCount(0);
	expect(await tiles.count()).toBeGreaterThan(total - 3);
});

test('a page of the grid never carries a hidden series', async ({ page }) => {
	await page.goto('/');
	const request = page.request;
	const res = await request.get('/api/library?shelf=all&sort=title&offset=0&limit=500');
	expect(res.ok()).toBe(true);
	const body = await res.text();
	expect(body).not.toContain('Onsen Ryokan');
	const ids = await (await request.get('/api/library?shelf=all&ids=1')).json();
	expect(ids.ids.length).toBe(JSON.parse(body).series.length);
});

test('back from a series deep in the grid comes back to its pages and its place', async ({
	page
}) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '6', url: 'http://localhost' }]);
	// A phone: three columns, so the seed runs far past what's loaded on arrival.
	await page.setViewportSize({ width: 360, height: 400 });
	await page.goto('/?shelf=all&sort=title');
	const tiles = page.locator('.grid .tile');
	const more = page.locator('.more');
	for (let i = 0; i < 20 && (await more.count()) > 0; i++) {
		await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
		await page.waitForTimeout(150);
	}
	// Other specs change the library in parallel: the tile is found by its title, not a count.
	const last = tiles.last();
	const title = (await last.locator('.title').textContent())!.trim();
	await last.scrollIntoViewIfNeeded();
	const y = await page.evaluate(() => scrollY);
	expect(y).toBeGreaterThan(400);
	await last.click();
	await page.waitForURL(/\/series\//);
	await page.goBack();
	await page.waitForURL(/\/\?shelf=all/);
	// The pages are back (the tile is there at all) and so is the place, give
	// or take a row others may have moved it by.
	await expect(page.locator('.grid .tile', { hasText: title })).toBeAttached();
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y - 300);
});

test('the sync timer’s scan: behind the session, and says where it looked', async ({
	page,
	browser
}) => {
	await page.goto('/');
	const res = await page.request.post('/api/scan');
	expect(res.status()).toBe(200);
	// The e2e library folder is empty (playwright.config.ts): nothing starts.
	expect(await res.json()).toMatchObject({ started: false, looked: expect.any(String) });

	// Contexts inherit the project's signed-in storage unless told otherwise.
	const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const out = await stranger.request.post(`${new URL(page.url()).origin}/api/scan`);
	expect(out.status()).toBe(401);
	await stranger.close();
});

test('the app’s own ← buttons come back to the shelf, the order, the pages and the place', async ({
	page
}) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '6', url: 'http://localhost' }]);
	await page.setViewportSize({ width: 360, height: 640 });
	await page.goto('/?shelf=downloaded&sort=title');
	const tiles = page.locator('.grid .tile');
	const more = page.locator('.more');
	for (let i = 0; i < 20 && (await more.count()) > 0; i++) {
		await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
		await page.waitForTimeout(150);
	}
	const last = tiles.last();
	const title = (await last.locator('.title').textContent())!.trim();
	await last.scrollIntoViewIfNeeded();
	const y = await page.evaluate(() => scrollY);
	expect(y).toBeGreaterThan(400);

	// Into the series, into the reader, and back out with the app's own buttons.
	await last.click();
	await page.waitForURL(/\/series\//);
	await page.locator('a.cta').click();
	await page.waitForURL(/\/read\//);
	await page.waitForLoadState('networkidle');
	const vp = page.viewportSize()!;
	await page.touchscreen.tap(vp.width / 2, 30);
	await page.getByRole('link', { name: 'Back to the series' }).click();
	await page.waitForURL(/\/series\//);
	await page.locator('a.cell.back').click();

	await page.waitForURL(/\/\?/);
	expect(page.url()).toMatch(/shelf=downloaded/);
	expect(page.url()).toMatch(/sort=title/);
	await expect(page.locator('.grid .tile', { hasText: title })).toBeAttached();
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y - 300);
});

test('RANDOM shuffles anew each time it’s chosen, and keeps its shuffle across tabs', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=added');
	await page.getByRole('button', { name: 'Change sort' }).click();
	await expect(page).toHaveURL(/sort=random&seed=\d+|seed=\d+&sort=random|sort=random.*seed=\d+/);
	await expect(page.getByRole('button', { name: 'Change sort' })).toHaveText('RANDOM');
	const seed = new URL(page.url()).searchParams.get('seed');
	const order = await page.locator('.grid .tile .title').allTextContents();
	await page.reload();
	expect(await page.locator('.grid .tile .title').allTextContents()).toEqual(order);
	// Another tab keeps the shuffle; leaving RANDOM drops it.
	await page
		.getByRole('link', { name: /^DOWNLOADED/ })
		.first()
		.click();
	await expect(page).toHaveURL(new RegExp(`seed=${seed}`));
	await page.getByRole('button', { name: 'Change sort' }).click();
	await expect(page).not.toHaveURL(/seed=/);
});
