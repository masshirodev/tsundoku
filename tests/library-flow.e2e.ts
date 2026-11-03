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
	for (const name of ['Rate 1 of 10', 'Rate 10 of 10']) {
		await expect(sheet.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
	}

	await sheet.getByRole('button', { name: 'Rate 4 of 10' }).click();
	await expect(sheet.getByRole('button', { name: 'Rate 4 of 10' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.keyboard.press('Escape');
	const bars = page.locator('.grid .tile', { hasText: TITLE }).getByRole('img');
	await expect(bars).toHaveAttribute('aria-label', 'Rated 4 of 10');

	await page.reload();
	sheet = await longPress(page, TITLE);
	await expect(sheet.getByRole('button', { name: 'Rate 4 of 10' })).toHaveAttribute(
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

test('the rating bars open the slider on the tile, and a half saves', async ({ page }) => {
	await page.goto('/');
	const tile = page.locator('.grid .tile', { hasText: TITLE });
	const bars = tile.getByRole('img');
	await tile.getByRole('button', { name: /^Rate, / }).click();
	const picker = tile.locator('.picker');
	// The 0 cell and ten halves (c67).
	await expect(picker.getByRole('button')).toHaveCount(11);

	await picker.getByRole('button', { name: 'Rate 7 of 10' }).click();
	await expect(picker).toHaveCount(0);
	await expect(bars).toHaveAttribute('aria-label', 'Rated 7 of 10');
	await expect(page).toHaveURL(/\/$/);

	await page.reload();
	await expect(bars).toHaveAttribute('aria-label', 'Rated 7 of 10');
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

test('the app’s name goes home, and SERIES is a shelf', async ({ page }) => {
	await page.goto('/?shelf=k:manga&sort=title');
	const series = page.getByRole('link', { name: /^SERIES/ }).filter({ visible: true });
	await series.click();
	await expect(page).toHaveURL(/shelf=series/);
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
	await expect(bystander).toHaveAttribute('aria-label', 'Rated 6 of 10');

	const toolbar = page.getByRole('toolbar');
	await toolbar.getByRole('button', { name: 'Rate 10 of 10' }).click();
	for (const t of picked)
		await expect(tile(t).getByRole('img')).toHaveAttribute('aria-label', 'Rated 10 of 10');
	await expect(bystander).toHaveAttribute('aria-label', 'Rated 6 of 10');

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
	await page.goto('/?shelf=series&sort=title');
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
	expect(page.url()).toMatch(/shelf=series/);
	expect(page.url()).toMatch(/sort=title/);
	await expect(page.locator('.grid .tile', { hasText: title })).toBeAttached();
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y - 300);
});

test('RANDOM shuffles anew each time it’s chosen, and keeps its shuffle across tabs', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=added');
	await page.waitForLoadState('networkidle');
	const menu = page.getByRole('combobox', { name: 'Sort' });
	await menu.selectOption('random');
	await expect(page).toHaveURL(/sort=random&seed=\d+|seed=\d+&sort=random|sort=random.*seed=\d+/);
	await expect(menu).toHaveValue('random');
	const seed = new URL(page.url()).searchParams.get('seed');
	const order = await page.locator('.grid .tile .title').allTextContents();
	await page.reload();
	expect(await page.locator('.grid .tile .title').allTextContents()).toEqual(order);
	// Another tab keeps the shuffle; leaving RANDOM drops it.
	await page
		.getByRole('link', { name: /^SERIES/ })
		.first()
		.click();
	await expect(page).toHaveURL(new RegExp(`seed=${seed}`));
	await menu.selectOption('recent');
	await expect(page).not.toHaveURL(/seed=/);
});

test('SORT is a menu, and the toggle beside it turns the order round', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const menu = page.getByRole('combobox', { name: 'Sort' });
	await expect(menu).toHaveValue('recent');
	// Last read, then newest, then the rest.
	await expect(menu.locator('option')).toHaveText([
		'RECENTLY READ',
		'RECENTLY ADDED',
		'PROGRESS',
		'TITLE',
		'RATING',
		'RANDOM'
	]);

	await menu.selectOption('title');
	await page.waitForURL(/sort=title/);
	const tiles = page.locator('.grid .tile');
	const firstAz = await tiles.first().textContent();
	const toggle = page.getByRole('button', { name: /reverse/i });
	await expect(toggle).toHaveText('A–Z');

	await toggle.click();
	await page.waitForURL(/dir=desc/);
	await expect(toggle).toHaveText('Z–A');
	await expect(tiles.first()).not.toHaveText(firstAz ?? '');

	// Back to its own direction leaves no ?dir= behind.
	await toggle.click();
	await expect(page).not.toHaveURL(/dir=/);

	// A new sort starts in its own direction; RANDOM has none to turn.
	await menu.selectOption('random');
	await page.waitForURL(/sort=random/);
	await expect(page.getByRole('button', { name: /reverse/i })).toHaveCount(0);
});

// ---- Works (c276, c277; doc/WORKS.md) ----------------------------------------
// Browsing shows the run as one tile and one CONTINUE row; finding shows the
// series; /work/N is the run's own screen. Each test makes its Work and ends
// it again, so the seeded library is the one the other specs expect.

const workTile = (page: Page, name: string) => page.locator('.grid .tile.work', { hasText: name });

/** A series tile by its exact title: "Kaori Mama" is a prefix of two others. */
const tileByTitle = (page: Page, title: string) =>
	page.locator('.grid .tile').filter({
		has: page.locator('.title', {
			hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
		})
	});

/** Picks these titles in this order and presses WORK, landing on the Work. */
async function makeWork(page: Page, titles: string[]) {
	await page.goto('/');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of titles)
		await page.locator('.grid .tile', { hasText: t }).locator('.open').click();
	await page.getByRole('button', { name: 'WORK', exact: true }).click();
	await expect(page).toHaveURL(/\/work\/\d+/);
}

test('a Work is one tile, one CONTINUE row, and a screen of its own', async ({ page }) => {
	// Two runs in progress, the newest read of them five minutes old: the
	// Work's CONTINUE row is the first one, and the section counts rows.
	await makeWork(page, [
		'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		'Kusuriya no Hitorigoto'
	]);
	// They share no words, so it is named for the owner to replace.
	await expect(page.locator('.rename')).toBeVisible();
	await page.locator('.rename input').fill('Drawing Run');
	await page.locator('.rename').getByRole('button', { name: 'DONE' }).click();
	await expect(page.locator('.bar-title .t')).toHaveText('Drawing Run');
	await expect(page.locator('.bar-title .s')).toContainText('WORK · 2 SERIES');
	await expect(page.locator('.ident h1')).toHaveText('Drawing Run');
	await expect(page.locator('.ident .meta')).toHaveText('WORK · MANGA');
	await expect(page.locator('.ident .count').first()).toContainText('2 SERIES');
	await expect(page.locator('.band', { hasText: 'RENAMED · DRAWING RUN' })).toBeVisible();

	// CONTINUE across the Work opens the part CONTINUE opens for it.
	const cta = page.locator('.cta').first();
	await expect(cta).toContainText('PART 1');
	await expect(cta).toContainText('CH. 41');

	const rows = page.locator('.run .part');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText('Drawing: Saikyou Mangaka');
	await expect(rows.nth(1)).toContainText('Kusuriya no Hitorigoto');
	// The number cell is inverted on the part CONTINUE opens.
	await expect(rows.nth(0).locator('.no')).toHaveText(/^1\s*NOW$/);
	await expect(rows.nth(0).locator('.st')).toContainText('CH. 41 OF 58');
	await expect(rows.nth(1).locator('.no')).toHaveText(/^2\s*NEXT$/);

	// The library: one tile, its foot the run.
	await page.locator('a.back').click();
	await expect(page).toHaveURL('/');
	const tile = workTile(page, 'Drawing Run');
	await expect(tile).toBeVisible();
	await expect(tile.locator('.bdg.wb')).toHaveText('WORK · 2');
	await expect(tile.locator('.ft')).toContainText('PART 1 OF 2');
	// Online, a tile's ↓ is the device's cache, never the server's on-disk
	// count: both parts are downloaded on disk, but this browser has cached
	// none of them, so the Work wears no ↓ badge (round 2's finding).
	await expect(tile.locator('.badge.inverse')).toHaveCount(0);
	// The parts are not tiles of their own.
	await expect(page.locator('.grid .tile', { hasText: 'Kusuriya' })).toHaveCount(0);

	// One CONTINUE row for the run, never one per part.
	const cont = page.locator('.cont .row.work');
	await expect(cont).toHaveCount(1);
	await expect(cont).toContainText('WORK · PART 1');
	await expect(cont).toContainText('CH. 41');
	// The ▶ names the Work it resumes: a literal '{title}' would say the
	// placeholder, not the row's own title.
	await expect(cont.locator('.go')).toHaveAttribute('aria-label', 'Resume Drawing Run');

	// Finding opens the Work: its own name finds it first, its parts after.
	await page.goto('/search?q=Drawing');
	await expect(page.locator('.hit.work')).toContainText('WORK · 2 SERIES');
	await expect(page.locator('.hits .hit').first()).toContainText('Drawing Run');
	// A part found by its own name says which run it is in.
	await page.goto('/search?q=Kusuriya');
	await expect(page.locator('.hit', { hasText: 'Kusuriya' })).toContainText('PART 2 · DRAWING RUN');

	// UNGROUP ends it, and UNDO puts it back; then it ends for good.
	await page.goto('/');
	await tile.click();
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page).toHaveURL(/band=ungrouped/);
	const ungrouped = page.locator('.band', { hasText: 'UNGROUPED · DRAWING RUN' });
	await expect(ungrouped).toBeVisible();
	await expect(workTile(page, 'Drawing Run')).toHaveCount(0);
	await ungrouped.getByRole('button', { name: 'UNDO' }).click();
	await expect(workTile(page, 'Drawing Run')).toBeVisible();
	await workTile(page, 'Drawing Run').click();
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(workTile(page, 'Drawing Run')).toHaveCount(0);
});

test('ORDER reorders the run, TAKE OUT of the second-to-last ends the Work, and UNDO restores it', async ({
	page
}) => {
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku']);
	// Part 1 is read through and part 2 never started: CONTINUE crosses, and
	// its row on the screen points at part 2's first chapter (the UP NEXT case).
	await expect(page.locator('.cta').first()).toContainText('PART 2 · CH. 1');
	const rows = page.locator('.run .part');
	await expect(rows.nth(0)).toContainText('Isekai Ojisan');

	// ORDER: focus a row and use the arrow keys, as the books grid does; DONE saves.
	await page.getByRole('button', { name: 'ORDER', exact: true }).click();
	await page.locator('.run .part .rowlink').first().focus();
	await page.keyboard.press('ArrowDown');
	await page.getByRole('button', { name: 'DONE' }).click();
	await expect(rows.nth(0)).toContainText('Isekai Yakkyoku');
	await page.reload();
	await expect(page.locator('.run .part').nth(0)).toContainText('Isekai Yakkyoku');

	// SELECT, take one out: the Work of two ends, and the library says so.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.run .part', { hasText: 'Isekai Ojisan' }).locator('.rowlink').click();
	await page.getByRole('button', { name: 'TAKE OUT' }).click();
	await expect(page).toHaveURL(/band=ended/);
	const ended = page.locator('.band', { hasText: 'ISEKAI IS NO LONGER A WORK' });
	await expect(ended).toBeVisible();
	await expect(ended).toContainText('ONE SERIES WAS LEFT');
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);

	// The library replaced the dead Work in history: BACK lands on the library,
	// never on /work/N (doc/NAVIGATION.md, "Screens that are gone"). Forward
	// returns to the band, whose UNDO is the next step.
	await page.goBack();
	expect(new URL(page.url()).pathname).toBe('/');
	expect(page.url()).not.toMatch(/\/work\/\d+/);
	await page.goForward();
	await expect(page.locator('.band', { hasText: 'ISEKAI IS NO LONGER A WORK' })).toBeVisible();

	// UNDO puts the Work back with its name and its order.
	await ended.getByRole('button', { name: 'UNDO' }).click();
	await expect(workTile(page, 'Isekai')).toBeVisible();
	await workTile(page, 'Isekai').click();
	await expect(page.locator('.run .part').nth(0)).toContainText('Isekai Yakkyoku');
	// Done with it: the Work ends for good.
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('the TAKE OUT and ADD A SERIES bands name the series they moved', async ({ page }) => {
	// Three parts, so taking one out leaves a Work of two: the Work survives and
	// its own screen has to say which series left. The bands are built after
	// `update()` has re-read the lists the series used to be found in, so their
	// names come from the action's facts (round 2's finding).
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren', 'Isekai Ojisan']);
	await expect(page.locator('.run .part')).toHaveCount(3);

	// Take one out; two are left, so the Work stays and the band names it.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.run .part', { hasText: 'Isekai Ojisan' }).locator('.rowlink').click();
	await page.getByRole('button', { name: 'TAKE OUT' }).click();
	const takenOut = page.locator('.band', { hasText: 'TAKEN OUT · ISEKAI OJISAN' });
	await expect(takenOut).toBeVisible();
	await expect(takenOut).toContainText('A SERIES ON ITS OWN AGAIN');
	await expect(page.locator('.run .part')).toHaveCount(2);

	// Add one: the sheet lists the library, and the band names what joined.
	await page.getByRole('button', { name: '+ ADD A SERIES' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add a series to this Work' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: /Dungeon Meshi/ }).click();
	const added = page.locator('.band', { hasText: 'ADDED · DUNGEON MESHI' });
	await expect(added).toBeVisible();
	await expect(added).toContainText('AT THE END OF THE RUN');
	await expect(page.locator('.run .part')).toHaveCount(3);

	// Done with it: the seed stays what the other specs expect.
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('the ADD A SERIES picker asks once the typing pauses, not once a letter', async ({ page }) => {
	// A read per keystroke was seven `LIKE` scans over the library for one word
	// (round 2's finding); the sheet now asks 180ms behind the typing, the
	// library's own beat (doc/LIBRARY.md, "Search").
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren']);
	const reads: string[] = [];
	page.on('request', (request) => {
		const { pathname } = new URL(request.url());
		if (/^\/work\/\d+\/addable$/.test(pathname)) reads.push(request.url());
	});
	await page.getByRole('button', { name: '+ ADD A SERIES' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add a series to this Work' });
	await expect(sheet).toBeVisible();
	// The open is immediate: one read before anything is typed.
	await expect.poll(() => reads.length).toBe(1);

	await sheet
		.getByRole('searchbox', { name: 'Find a series' })
		.pressSequentially('dungeon', { delay: 30 });
	await expect(sheet.getByRole('button', { name: /Dungeon Meshi/ })).toBeVisible();
	// Seven letters, one paused word: a second read at most (a slow machine can
	// split the word, and the seq guard drops the older answer either way).
	expect(reads.length).toBeLessThanOrEqual(2);

	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('a Work’s RATING and FAV are the parts’, set together while they agree, and RENAME undoes', async ({
	page
}) => {
	// These two share no words, so the Work is named for the owner to replace.
	await makeWork(page, [
		'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		'Hikaru ga Shinda Natsu'
	]);
	await expect(page.locator('.rename')).toBeVisible();
	await page.locator('.rename input').fill('Drawing Run');
	await page.locator('.rename').getByRole('button', { name: 'DONE' }).click();
	await expect(page.locator('.bar-title .t')).toHaveText('Drawing Run');
	await expect(page.locator('.band', { hasText: 'RENAMED · DRAWING RUN' })).toBeVisible();

	// Both parts are rated 8 and both are a favourite: the row is settable.
	await expect(page.locator('.rs .num')).toHaveText('8');
	await expect(page.locator('.fav')).toHaveAttribute('aria-pressed', 'true');

	// A set writes every part, and the row follows.
	await page.getByRole('button', { name: 'Rate 5 of 10' }).click();
	await expect(page.locator('.rs .num')).toHaveText('5');
	await page.locator('.fav').click();
	await expect(page.locator('.fav')).toHaveAttribute('aria-pressed', 'false');

	// Rate one part apart: the row shows the average and refuses to set.
	await page.goto('/');
	await page.goto('/search?q=Hikaru');
	await page.locator('.hit', { hasText: 'Hikaru ga Shinda Natsu' }).click();
	const seriesSheet = page.getByRole('dialog', { name: 'Hikaru ga Shinda Natsu' });
	await expect(seriesSheet).toBeVisible();
	await seriesSheet.getByRole('button', { name: 'Rate 8 of 10' }).click();
	await page.keyboard.press('Escape');
	await page.goto(page.url().match(/\/work\/\d+/) ? page.url() : '/');
	// Back to the Work: it is on the library.
	const tile = workTile(page, 'Drawing Run');
	await tile.click();
	await expect(page.locator('.rs .lab-top')).toHaveText('PARTS DIFFER');
	await expect(page.getByRole('button', { name: 'Rate 5 of 10' })).toBeDisabled();

	// Put the part back, then ungroup: the seeded library as it was.
	await page.goto('/search?q=Hikaru');
	await page.locator('.hit', { hasText: 'Hikaru ga Shinda Natsu' }).click();
	await page
		.getByRole('dialog', { name: 'Hikaru ga Shinda Natsu' })
		.getByRole('button', { name: 'Rate 5 of 10' })
		.click();
	await page.keyboard.press('Escape');
	await page.goto('/');
	await workTile(page, 'Drawing Run').click();
	await expect(page.locator('.bar-title .t')).toHaveText('Drawing Run');
	await page.locator('.fav').click();
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('a hidden Work is the same 404 as one that does not exist', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('HENTOID')).toHaveCount(0);

	// Reveal, so the hidden doujins are tiles, and make a Work of two of them.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	// A series of books and two singles: not one book series' to group, so the
	// bulk bar offers a Work.
	for (const t of ['Kaori Mama', 'Kōhai no Himitsu Nikki', 'Onsen Ryokan no Yoru'])
		await tileByTitle(page, t).locator('.open').click();
	await page.getByRole('button', { name: 'WORK', exact: true }).click();
	await expect(page).toHaveURL(/\/work\/\d+/);
	const hiddenWork = page.url();

	// Reveal off: the Work's own page is the 404 a missing id gets.
	await page.goto('/');
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	const res = await page.goto(hiddenWork);
	expect(res?.status()).toBe(404);
	const missing = await page.goto('/work/999999');
	expect(missing?.status()).toBe(404);

	// Reveal on again: the Work is one tile with HIDDEN. Then ungroup it.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	await expect(page).toHaveURL('/');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await expect(page.locator('.grid .tile.work', { hasText: 'HIDDEN' })).toHaveCount(1);
	await page.goto(hiddenWork);
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('page two of the grid is the same list as page one: a Work once, never its parts', async ({
	page
}) => {
	// Two series that share a word, so the Work is named 'Isekai' without a
	// rename, and neither part is a tile of its own anywhere on the shelf.
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku']);
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '6', url: 'http://localhost' }]);
	// A phone: three columns, so the first page's end is near and the row below
	// the grid stays on screen to be read.
	await page.setViewportSize({ width: 360, height: 400 });
	await page.goto('/?shelf=all&sort=title');
	const tiles = page.locator('.grid .tile');
	const more = page.locator('.more');
	await expect(more).toBeVisible();
	const total = Number(/OF (\d+)/.exec((await more.textContent()) ?? '')![1]);
	// Scroll the pages in, as a reader would.
	for (let i = 0; i < 20 && (await more.count()) > 0; i++) {
		await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
		await page.waitForTimeout(150);
	}
	await expect(more).toHaveCount(0);
	// The offset is in tiles, so every unit arrives once and in one order: the
	// old endpoint paged series under a tile count, which skipped series and
	// sent a Work's remaining parts back as their own cards.
	await expect(tiles).toHaveCount(total);
	await expect(page.locator('.grid .tile.work', { hasText: 'Isekai' })).toHaveCount(1);
	for (const part of ['Isekai Ojisan', 'Isekai Yakkyoku'])
		await expect(
			page.locator('.grid .tile').filter({
				has: page.locator('.title', { hasText: new RegExp(`^${part}$`) })
			})
		).toHaveCount(0);
	// Done with it: the seed stays the one the other specs expect.
	await page.locator('.grid .tile.work', { hasText: 'Isekai' }).click();
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('SELECT ALL takes a Work’s every part, so a bulk HIDE hides the run whole', async ({
	page
}) => {
	// The seed has no anime series (fixtures.ts), so this is the same shape with
	// a manhwa part off the kind shelf: the Work's face is the manga.
	await makeWork(page, [
		'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		"Omniscient Reader's Viewpoint"
	]);
	const work = page.url().split('?')[0];
	// A page of six, sorted by title: the Work's own name ('Untitled work',
	// since these two share no words) sorts onto a later page. Hold the pages
	// after the first back until SELECT ALL has asked, so the Work's tile is
	// not among the cards the fast path expands: the ids read is what must
	// carry its manhwa part.
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '6', url: 'http://localhost' }]);
	const pages = (url: URL) => url.pathname === '/api/library' && !url.searchParams.has('ids');
	await page.route(pages, (route) => route.abort());
	await page.goto('/?shelf=k:manga&sort=title');
	await expect(page.locator('.more')).toContainText('THE REST');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await page.unroute(pages);
	await page.locator('.more').getByRole('button', { name: 'RETRY' }).click();
	const more = page.locator('.more');
	for (let i = 0; i < 20 && (await more.count()) > 0; i++) {
		await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
		await page.waitForTimeout(150);
	}
	// The tile is checked only when every part is selected. The manhwa part is
	// not on this shelf, so the old series-only read never selected it and the
	// tile stayed unchecked while HIDE took one part.
	const tile = page.locator('.grid .tile.work');
	await expect(tile).toHaveCount(1);
	await expect(tile.locator('.open')).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
	// Both parts are hidden, so with reveal off the Work is the 404 a missing id is.
	const res = await page.goto(work);
	expect(res?.status()).toBe(404);

	// Restore: reveal, and unhide the whole kind shelf the bulk HIDE took --
	// SELECT ALL meant every manga, not only the Work's parts.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	await expect(page).toHaveURL('/');
	await page.goto('/?shelf=k:manga');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	// End the Work, then hide the shelf again.
	await page.locator('.grid .tile.work').click();
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('WORK refuses a selection that already holds a Work, and leaves every Work a tile', async ({
	page
}) => {
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku']);
	await page.goto('/');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await page.getByRole('button', { name: 'WORK', exact: true }).click();
	// A selection that already holds a Work's part is W4's AS sheet to move,
	// not this cell's: it refuses, and the Work on the shelf is untouched.
	await expect(page.locator('.fold-refused')).toContainText('A WORK KEEPS ITS PARTS');
	await expect(page.locator('.grid .tile.work')).toHaveCount(1);
	// Done: end the Work so the seed is as the other specs expect.
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await page.locator('.grid .tile.work').click();
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});
