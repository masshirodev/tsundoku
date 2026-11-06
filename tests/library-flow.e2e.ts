import { type Page, type Request } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The preview's own origin, which a form action's POST must carry or
 * SvelteKit refuses it as cross-site: the project's `baseURL`, which follows
 * PLAYWRIGHT_PORT. It was a fixed 'http://localhost:4183', so on any other
 * port the POST was refused and the case failed (c311).
 */
const sameOrigin = () => new URL(test.info().project.use.baseURL!).origin;

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

/** SORT's cell (c432): named for what it sorts by, "Sort, TITLE". */
const sortCell = (page: Page) => page.getByRole('button', { name: /^Sort, / });

/** Choose a sort the way a finger does: open the menu, tap the choice. */
async function sortBy(page: Page, name: string) {
	await sortCell(page).click();
	await page.getByRole('menu', { name: 'Sort' }).getByRole('menuitemradio', { name }).click();
	await expect(page.getByRole('menu', { name: 'Sort' })).toBeHidden();
}

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

test.describe('two quick taps on a tile (c615)', () => {
	// The tile's saves queue on the series screen's own keys (`fav:<id>`,
	// `rating:<id>`), so a tile tap and a series-screen tap on one series wait
	// for each other (doc/SERIES.md, "FAV and the rating"; c566's queue).
	// `__data.json` is answered by the service worker past `page.route`
	// (c477), so the second case holds the reload by it.
	test.use({ serviceWorkers: 'block' });

	/**
	 * Hold the first POST of the library's `?/<action>` until `release()`;
	 * every later one is aborted (the wire losing the newest tap). Counts the
	 * answers the page got, and the most saves it had out at once.
	 */
	async function holdFirst(
		page: Page,
		action: 'favourite' | 'rate',
		after: 'pass' | 'abort' = 'pass'
	) {
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		const isAction = (u: URL) => u.pathname === '/' && u.search === `?/${action}`;
		let first = true;
		let answered = 0;
		let asked = 0;
		let most = 0;
		await page.route(isAction, async (route) => {
			asked++;
			most = Math.max(most, asked - answered);
			if (first) {
				first = false;
				await held;
				return route.continue();
			}
			return after === 'abort' ? route.abort() : route.continue();
		});
		page.on('requestfinished', (r) => {
			if (isAction(new URL(r.url()))) answered++;
		});
		page.on('requestfailed', (r) => {
			if (isAction(new URL(r.url()))) answered++;
		});
		return {
			release,
			answered: () => answered,
			most: () => most,
			done: () => page.unroute(isAction)
		};
	}

	test('two quick FAV taps with the first save slow end on the second tap, after a reload too (c615)', async ({
		page
	}) => {
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const fav = tile.getByRole('button', { name: 'Favourite' });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		const h = await holdFirst(page, 'favourite');
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		h.release();
		await expect.poll(h.answered).toBe(2);
		// Never two saves out at once, and the second tap is what is left.
		expect(h.most()).toBe(1);
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await page.reload();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await expect(tile.getByText('FAV', { exact: true })).toHaveCount(0);
		await h.done();
	});

	test('two quick rating taps with the first slow store the second, and the tile shows it after a reload (c615)', async ({
		page
	}) => {
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const bars = tile.getByRole('img');
		const rate = tile.getByRole('button', { name: /^Rate, / });
		await expect(bars).toHaveAttribute('aria-label', 'Unrated');
		const h = await holdFirst(page, 'rate');
		await rate.click();
		await expect(tile.locator('.picker')).toBeVisible();
		await tile.getByRole('button', { name: 'Rate 6 of 10' }).click();
		// The second tap while the first save is still out.
		await rate.click();
		await tile.getByRole('button', { name: 'Rate 3 of 10' }).click();
		await expect(bars).toHaveAttribute('aria-label', 'Rated 3 of 10');
		h.release();
		await expect.poll(h.answered).toBe(2);
		expect(h.most()).toBe(1);
		await page.reload();
		await expect(bars).toHaveAttribute('aria-label', 'Rated 3 of 10');
		await h.done();
		// Put it back as the seed has it.
		await rate.click();
		await tile.getByRole('button', { name: 'Unrated' }).click();
		await expect(bars).toHaveAttribute('aria-label', 'Unrated');
		await page.reload();
		await expect(bars).toHaveAttribute('aria-label', 'Unrated');
	});

	test('a tile tap, then the series opened before it settles: the screen’s tap waits on the same key (c615)', async ({
		page
	}) => {
		await page.goto('/?sort=title');
		const fav = page
			.locator('.grid .tile', { hasText: TITLE })
			.getByRole('button', { name: 'Favourite' });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');

		// Hold the tile's own POST; the series screen's is counted, not held.
		const isTile = (u: URL) => u.pathname === '/' && u.search === '?/favourite';
		const isPanel = (u: URL) => /^\/series\/\d+$/.test(u.pathname) && u.search === '?/favourite';
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		let first = true;
		let panelAsked = 0;
		let panelAnswered = 0;
		await page.route(isTile, async (route) => {
			if (!first) return route.continue();
			first = false;
			await held;
			return route.continue();
		});
		page.on('request', (r) => {
			if (isPanel(new URL(r.url()))) panelAsked++;
		});
		page.on('requestfinished', (r) => {
			if (isPanel(new URL(r.url()))) panelAnswered++;
		});

		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		// The series opens while the tile's save is still out.
		await page.locator('.grid .tile', { hasText: TITLE }).locator('.open').click();
		await page.waitForURL(/\/series\//);
		const panel = page.getByRole('region', { name: 'About this series' });
		const seriesFav = panel.getByRole('button', { name: 'FAV', exact: true });
		await expect(seriesFav).toBeVisible();
		// Its FAV is the same `fav:<id>` key, so it waits: nothing is sent while
		// the tile's save is held (a second queue would send it at once).
		await seriesFav.click();
		await page.waitForTimeout(300);
		expect(panelAsked).toBe(0);
		release();
		await expect.poll(() => panelAnswered).toBe(1);
		await expect(panel.getByRole('button', { name: 'FAV ✓' })).toBeVisible();
		await page.reload();
		await expect(panel.getByRole('button', { name: 'FAV ✓' })).toBeVisible();
		await page.unroute(isTile);
		// Put it back as the seed has it.
		await panel.getByRole('button', { name: 'FAV ✓' }).click();
		await expect(panel.getByRole('button', { name: 'FAV', exact: true })).toBeVisible();
		await page.reload();
		await expect(panel.getByRole('button', { name: 'FAV', exact: true })).toBeVisible();
	});

	test('a newer tap that fails during the earlier tap’s reload keeps its band, and PUT BACK reads what is stored (c615)', async ({
		page
	}) => {
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const fav = tile.getByRole('button', { name: 'Favourite' });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');

		// The first FAV POST goes through; every later one is lost on the wire.
		const isFav = (u: URL) => u.pathname === '/' && u.search === '?/favourite';
		let posts = 0;
		let firstAnswered = false;
		await page.route(isFav, (route) => (++posts === 1 ? route.continue() : route.abort()));
		page.on('requestfinished', (r) => {
			if (isFav(new URL(r.url()))) firstAnswered = true;
		});
		// The reload after it is held until released, once.
		let releaseReload!: () => void;
		const reloadHeld = new Promise<void>((r) => (releaseReload = r));
		let reloadAsked = false;
		const isData = (u: URL) => u.pathname === '/__data.json';
		await page.route(isData, async (route) => {
			if (reloadAsked) return route.continue();
			reloadAsked = true;
			await reloadHeld;
			return route.continue();
		});

		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(() => firstAnswered && reloadAsked).toBe(true);
		// UNFAV, while FAV's reload is still out: it waits for that reload, so
		// nothing is on the wire yet (the base posted at once, and took a band
		// the newest tap had not claimed).
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await expect.poll(() => posts).toBe(1);
		await expect(page.getByText('UNFAV NOT SAVED')).toHaveCount(0);
		releaseReload();

		// FAV is what is stored: the band says UNFAV was not, and PUT BACK goes to FAV.
		await expect(page.getByText('UNFAV NOT SAVED')).toBeVisible();
		await page.getByRole('button', { name: 'PUT BACK · FAV' }).click();
		await expect(page.getByText('UNFAV NOT SAVED')).toHaveCount(0);
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		expect(posts).toBe(2);
		await page.unroute(isFav);
		await page.unroute(isData);
		await page.reload();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');

		// Put it back as the seed has it.
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await page.reload();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
	});

	test('a tile past the first page reads what FAV stored, so PUT BACK goes to FAV (c615)', async ({
		page
	}) => {
		// A page of two: the seed's titles after those two live in `more`, which
		// `invalidateAll` does not refresh and only the loaded pages' refill does.
		await page
			.context()
			.addCookies([{ name: 'tsundoku_grid_page', value: '2', url: 'http://localhost' }]);
		await page.goto('/?shelf=all&sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		/** Scroll until the tile's page is in: the pages come as the end comes near. */
		const drawTile = async () => {
			const more = page.locator('.more');
			for (let i = 0; i < 20 && (await tile.count()) === 0; i++) {
				await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
				await page.waitForTimeout(150);
			}
			await expect(tile).toHaveCount(1);
			await tile.scrollIntoViewIfNeeded();
		};
		await drawTile();
		// The tile is past the first page, not in it: the two titles before it
		// fill the page the cookie asks for.
		const beyond = await page
			.locator('.grid .tile')
			.evaluateAll(
				(els, title) => els.findIndex((el) => (el.textContent ?? '').includes(title)),
				TITLE
			);
		expect(beyond).toBeGreaterThan(1);

		const fav = tile.getByRole('button', { name: 'Favourite' });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');

		// The first FAV POST goes through; every later one is lost on the wire.
		const isFav = (u: URL) => u.pathname === '/' && u.search === '?/favourite';
		let posts = 0;
		let firstAnswered = false;
		await page.route(isFav, (route) => (++posts === 1 ? route.continue() : route.abort()));
		page.on('requestfinished', (r) => {
			if (isFav(new URL(r.url()))) firstAnswered = true;
		});
		// FAV's reload is held, so UNFAV is tapped while it is still out.
		let releaseReload!: () => void;
		const reloadHeld = new Promise<void>((r) => (releaseReload = r));
		let reloadAsked = false;
		const isData = (u: URL) => u.pathname === '/__data.json';
		await page.route(isData, async (route) => {
			if (reloadAsked) return route.continue();
			reloadAsked = true;
			await reloadHeld;
			return route.continue();
		});

		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(() => firstAnswered && reloadAsked).toBe(true);
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await expect.poll(() => posts).toBe(1);
		await expect(page.getByText('UNFAV NOT SAVED')).toHaveCount(0);
		releaseReload();

		// FAV is what is stored, past the first page too: the band says UNFAV
		// was not, and PUT BACK goes to FAV. Without the loaded pages' refill
		// the band reads the tile's value from before FAV and offers NOT FAV.
		await expect(page.getByText('UNFAV NOT SAVED')).toBeVisible();
		await page.getByRole('button', { name: 'PUT BACK · FAV' }).click();
		await expect(page.getByText('UNFAV NOT SAVED')).toHaveCount(0);
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		expect(posts).toBe(2);
		await page.unroute(isFav);
		await page.unroute(isData);
		await page.reload();
		await drawTile();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');

		// Put it back as the seed has it.
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await page.reload();
		await drawTile();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
	});

	/**
	 * A phone and a page of six: the seed runs past what loads on arrival, so
	 * the grid still has pages to ask for after the first page and a tile past
	 * it can be tapped. The library's own load is the same one; only the
	 * viewport and the page size are pinned for the case.
	 */
	async function gridOnAPhone(page: Page) {
		// 360x600: three columns, so a page of six is two rows. Taller and the
		// end stays in reach until the shelf is whole; shorter and only the
		// first two pages come, which a refill cannot be told from a loadMore by.
		await page.setViewportSize({ width: 360, height: 600 });
		await page
			.context()
			.addCookies([{ name: 'tsundoku_grid_page', value: '6', url: 'http://localhost' }]);
		const pages = (u: URL) => u.pathname === '/api/library' && !u.searchParams.has('ids');
		// `waitForLoadState('networkidle')` answers at once once it has fired for
		// the document, so the pages' own requests are what says they are in:
		// nothing asked for a moment (`settled`).
		const inFlight = new Set<Request>();
		const isPage = (r: Request) => pages(new URL(r.url()));
		page.on('request', (r) => isPage(r) && inFlight.add(r));
		const done = (r: Request) => inFlight.delete(r);
		page.on('requestfinished', done);
		page.on('requestfailed', done);
		/** Nothing asked for a moment: the pages that were coming have come. */
		const settled = async () => {
			let quiet = 0;
			await expect
				.poll(() => (quiet = inFlight.size === 0 ? quiet + 1 : 0), {
					intervals: [250],
					timeout: 20_000
				})
				.toBeGreaterThanOrEqual(4);
		};

		await page.goto('/?shelf=all&sort=title');
		// The pages come in as the end comes near, until it moves out of reach.
		await settled();
		const tiles = page.locator('.grid .tile');
		const more = page.locator('.more');
		const loaded = await tiles.count();
		// Two pages past the first, so a refill's `limit` (the loaded pages'
		// count) is not a page size: that is how the cases below tell a refill
		// from a loadMore, which always asks for six.
		expect(loaded).toBeGreaterThan(12);
		// A tile unfavourited, so a tap turns FAV on, by index: a locator on
		// `[aria-pressed="false"]` would move on to the next one when it is tapped.
		const favs = page.locator('.grid .tile button.fav');
		const favIdx = await favs.evaluateAll((els) =>
			els.findIndex((el) => el.getAttribute('aria-pressed') === 'false')
		);
		expect(favIdx).toBeGreaterThanOrEqual(0);
		const fav = favs.nth(favIdx);
		/** A refill: the write's reload of the pages after the first. */
		const isRefill = (u: URL) =>
			u.pathname === '/api/library' &&
			Number(u.searchParams.get('offset')) === 6 &&
			Number(u.searchParams.get('limit')) > 6;
		return { tiles, more, loaded, fav, isRefill, pages };
	}

	test('a save does not leave the grid unable to load more pages (c615)', async ({ page }) => {
		const { tiles, more, loaded, isRefill, pages } = await gridOnAPhone(page);
		// A little down the grid (nowhere near the end), so a row is in view.
		await page.evaluate(() => scrollTo({ top: 300, behavior: 'instant' }));
		const at = await tiles.evaluateAll((els) =>
			els.findIndex((el) => {
				const top = el.getBoundingClientRect().top;
				return (
					top > 0 &&
					top < innerHeight &&
					el.querySelector('button.fav[aria-pressed="false"]') !== null &&
					el.querySelector('[aria-label^="Rate, "]') !== null
				);
			})
		);
		expect(at).toBeGreaterThanOrEqual(0);
		const tile = tiles.nth(at);
		const fav = tile.locator('button.fav');
		const bars = tile.getByRole('button', { name: /^Rate, / });
		// Its own rating, put back after: the seed rates most tiles.
		const wasRated = await bars.getAttribute('aria-label');
		// The grid still has pages to ask for, or the case proves nothing.
		await expect(more).toHaveCount(1);

		// Hold the first save's reload of the pages, and the page the grid asks
		// for once the second save's data has landed: both are still out when
		// the second refill's bump comes. A bump that does not release
		// `loadingMore` leaves every page after it refused (c615, r3).
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		let refillHeld = false;
		let pageHeld = false;
		let refills = 0;
		await page.route(pages, async (route) => {
			const u = new URL(route.request().url());
			if (isRefill(u)) {
				refills++;
				if (!refillHeld) {
					refillHeld = true;
					await held;
				}
			} else if (Number(u.searchParams.get('offset')) > 6 && !pageHeld) {
				pageHeld = true;
				await held;
			}
			return route.continue();
		});

		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(() => refillHeld).toBe(true);
		// The rating is a second save on its own key, so it does not wait for the
		// first: its reload is queued behind that one.
		const reloaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/__data.json');
		await bars.click();
		await tile.getByRole('button', { name: 'Rate 5 of 10' }).click();
		await reloaded;
		// The end brought into view after that reload's own release, so the page
		// it asks for is out when the second refill starts.
		await more.scrollIntoViewIfNeeded();
		await expect.poll(() => pageHeld).toBe(true);
		release();
		// Two refills: the second has bumped over the page asked for above.
		await expect.poll(() => refills).toBeGreaterThan(1);

		for (let i = 0; i < 20 && (await more.count()) > 0; i++) {
			await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
			await page.waitForTimeout(150);
		}
		await expect(more).toHaveCount(0);
		expect(await tiles.count()).toBeGreaterThan(loaded);
		await expect(page.getByText('LOADING', { exact: true })).toHaveCount(0);
		await page.unroute(pages);

		// Put it back as the seed has it.
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await bars.click();
		const back = /(\d+) of 10/.exec(wasRated ?? '')?.[1];
		await tile.getByRole('button', { name: back ? `Rate ${back} of 10` : 'Unrated' }).click();
		await expect(bars).toHaveAttribute('aria-label', wasRated!);
		await page.reload();
		await expect(tiles.nth(at).locator('button.fav')).toHaveAttribute('aria-pressed', 'false');
	});

	test('a tile save refills the loaded pages once, and no more (c615)', async ({ page }) => {
		const { loaded, fav, isRefill, pages } = await gridOnAPhone(page);
		await expect(fav).toHaveAttribute('aria-pressed', 'false');

		// Every refill the save sends, by its `limit`: the loaded pages' count.
		const refills: number[] = [];
		await page.route(pages, async (route) => {
			const u = new URL(route.request().url());
			if (isRefill(u)) refills.push(Number(u.searchParams.get('limit')));
			return route.continue();
		});
		// A second tap on the same key, lost on the wire: its save is sent only
		// after the first turn has settled -- its reload included -- so its own
		// band is the mark that everything the first turned sent is in.
		const isFav = (u: URL) => u.pathname === '/' && u.search === '?/favourite';
		let posts = 0;
		await page.route(isFav, (route) => (++posts === 1 ? route.continue() : route.abort()));
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await expect(page.getByText('UNFAV NOT SAVED')).toBeVisible();
		// One, not the effect's refill and a forced one behind it (c615, r3).
		expect(refills).toEqual([loaded - 6]);
		await page.unroute(isFav);
		await page.unroute(pages);

		// Put it back as the seed has it: FAV is what turn 1 stored.
		await page.reload();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await page.reload();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
	});

	test('a refill that fails keeps the pages already drawn (c615)', async ({ page }) => {
		const { tiles, loaded, fav, isRefill, pages } = await gridOnAPhone(page);
		await expect(fav).toHaveAttribute('aria-pressed', 'false');

		// The write's own refill is lost on the wire, and so is every page after
		// it (the grid would otherwise put the collapsed pages straight back).
		await page.route(pages, (route) => route.abort());
		const lost = page.waitForEvent('requestfailed', {
			predicate: (r) => isRefill(new URL(r.url()))
		});
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		await lost;
		// A blip must not fold a deep grid back to its first page.
		await expect(tiles).toHaveCount(loaded);
		await page.unroute(pages);

		// Put it back as the seed has it.
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await page.reload();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
	});
});

test('the app’s name goes home, and SERIES, once a shelf, is FILTER’s FORM (c436)', async ({
	page
}) => {
	await page.goto('/?shelf=all&kind=manga&sort=title');
	// The shelves hold shelves only: no SERIES, ONE-OFF or kind among them.
	const shelves = page.locator('nav[aria-label="Shelves"]').filter({ visible: true });
	for (const gone of [/^SERIES/, /^ONE-OFF/, /^MANGA/, /^MANHWA/, /^NOVELS/])
		await expect(shelves.getByRole('link', { name: gone })).toHaveCount(0);
	await page.goto('/?shelf=series&sort=title');
	await expect(page).toHaveURL(/form=series/);
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
		headers: { origin: sameOrigin(), 'x-sveltekit-action': 'true' },
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
	// Incognito, because the last series by title is Yofukashi no Uta, which
	// privacy-flow owns, and READ AGAIN would log its Ch. 1 on the shared
	// database (c499; "Each flow file owns its series", doc/TESTING.md). The
	// case is about the way back, which incognito does not change.
	await page.context().addCookies([
		{ name: 'tsundoku_grid_page', value: '6', url: 'http://localhost' },
		{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }
	]);
	await page.setViewportSize({ width: 360, height: 640 });
	await page.goto('/?shelf=all&form=series&sort=title');
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
	// Left at once, before the reader keeps its page in the URL (800 ms): the
	// timer that used to write /read/<id>?p=1 onto the series' entry on the
	// way back is the app's to stop (c565; reader-flow's c565 case pins it).
	const vp = page.viewportSize()!;
	await page.touchscreen.tap(vp.width / 2, 30);
	await page.getByRole('link', { name: 'Back to the series' }).click();
	await page.waitForURL(/\/series\//);
	await page.locator('a.cell.back').click();

	await page.waitForURL(/\/\?/);
	expect(page.url()).toMatch(/form=series/);
	expect(page.url()).toMatch(/sort=title/);
	await expect(page.locator('.grid .tile', { hasText: title })).toBeAttached();
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y - 300);
});

test('RANDOM shuffles anew each time it’s chosen, and keeps its shuffle across tabs', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=added');
	await sortBy(page, 'RANDOM');
	await expect(page).toHaveURL(/sort=random&seed=\d+|seed=\d+&sort=random|sort=random.*seed=\d+/);
	await expect(sortCell(page)).toHaveAccessibleName('Sort, RANDOM');
	const seed = new URL(page.url()).searchParams.get('seed');
	const order = await page.locator('.grid .tile .title').allTextContents();
	await page.reload();
	expect(await page.locator('.grid .tile .title').allTextContents()).toEqual(order);
	// Another tab keeps the shuffle; leaving RANDOM drops it.
	await page
		.locator('nav[aria-label="Shelves"]')
		.filter({ visible: true })
		.getByRole('link', { name: /^TO FINISH/ })
		.click();
	await expect(page).toHaveURL(new RegExp(`seed=${seed}`));
	await sortBy(page, 'RECENTLY READ');
	await expect(page).not.toHaveURL(/seed=/);
});

test('SORT is a menu, and the toggle beside it turns the order round', async ({ page }) => {
	await page.goto('/');
	await expect(sortCell(page)).toHaveAccessibleName('Sort, RECENTLY READ');
	// Last read, then newest, then the rest; the one in use is the one checked.
	await sortCell(page).click();
	const choices = page.getByRole('menu', { name: 'Sort' }).getByRole('menuitemradio');
	await expect(choices).toHaveText([
		'RECENTLY READ',
		'RECENTLY ADDED',
		'PROGRESS',
		'TITLE',
		'RATING',
		'RANDOM'
	]);
	await expect(page.getByRole('menuitemradio', { checked: true })).toHaveText('RECENTLY READ');
	await sortCell(page).click();
	await expect(page.getByRole('menu', { name: 'Sort' })).toBeHidden();

	await sortBy(page, 'TITLE');
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
	await sortBy(page, 'RANDOM');
	await page.waitForURL(/sort=random/);
	await expect(page.getByRole('button', { name: /reverse/i })).toHaveCount(0);
});
