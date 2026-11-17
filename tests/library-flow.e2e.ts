import { type Page, type Request, type Route } from '@playwright/test';
import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as tcpServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { startPreview } from './highlights-preview';
import { E2E_TOKEN } from '../playwright.config';

/**
 * The preview's own origin, which a form action's POST must carry or
 * SvelteKit refuses it as cross-site: the project's `baseURL`, which follows
 * PLAYWRIGHT_PORT. It was a fixed 'http://localhost:4183', so on any other
 * port the POST was refused and the case failed.
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

/** SORT's cell: named for what it sorts by, "Sort, TITLE". */
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
	// The 0 cell and ten halves.
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

test.describe('two quick taps on a tile', () => {
	// The tile's saves queue on the series screen's own keys (`fav:<id>`,
	// `rating:<id>`), so a tile tap and a series-screen tap on one series wait
	// for each other (doc/SERIES.md, "FAV and the rating"; c566's queue).
	// `__data.json` is answered by the service worker past `page.route`
	//, so the second case holds the reload by it.
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

	test('two quick FAV taps with the first save slow end on the second tap, after a reload too', async ({
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

	test('two quick rating taps with the first slow store the second, and the tile shows it after a reload', async ({
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

	test('a tile tap, then the series opened before it settles: the screen’s tap waits on the same key', async ({
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

	test('a newer tap that fails during the earlier tap’s reload keeps its band, and PUT BACK reads what is stored', async ({
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

	test('a tile past the first page reads what FAV stored, so PUT BACK goes to FAV', async ({
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

	test('a save does not leave the grid unable to load more pages', async ({ page }) => {
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
		// `loadingMore` leaves every page after it refused (r3).
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

	test('a tile save refills the loaded pages once, and no more', async ({ page }) => {
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
		// One, not the effect's refill and a forced one behind it (r3).
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

	test('a refill that fails keeps the pages already drawn', async ({ page }) => {
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

test.describe('a tile save that fails draws its value unsaved', () => {
	// The library's own failure store (`saves`, not the queue): the key is
	// `fav:<id>` or `rating:<id>`, read by the tile's own props. The band the
	// layout draws offers PUT BACK and RETRY (doc/WAITING.md, "Writes that fail").
	/** Lose only the first POST of this action; later ones go through. */
	async function loseFirst(page: Page, action: 'favourite' | 'rate') {
		const isAction = (u: URL) => u.pathname === '/' && u.search === `?/${action}`;
		let first = true;
		await page.route(isAction, (route) => {
			if (!first) return route.continue();
			first = false;
			return route.abort();
		});
		return () => page.unroute(isAction);
	}

	/**
	 * Lose every POST of this action. The nudge on the next navigation retries
	 * a failed save (`+layout.svelte`, `afterNavigate`), so a case that leaves
	 * the page needs this rather than `loseFirst`.
	 */
	async function loseAll(page: Page, action: 'favourite' | 'rate') {
		const isAction = (u: URL) => u.pathname === '/' && u.search === `?/${action}`;
		await page.route(isAction, (route) => route.abort());
		return () => page.unroute(isAction);
	}

	test('FAV PUT BACK: the tile draws it dashed until the stored value comes back', async ({
		page
	}) => {
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const fav = tile.getByRole('button', { name: 'Favourite' });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		const done = await loseFirst(page, 'favourite');

		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByText('FAV NOT SAVED')).toBeVisible();
		await expect(fav).toHaveClass(/unsaved/);
		expect(await fav.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');

		await page.getByRole('button', { name: 'PUT BACK · NOT FAV' }).click();
		await expect(page.getByText('FAV NOT SAVED')).toHaveCount(0);
		await expect(fav).not.toHaveClass(/unsaved/);
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await done();
	});

	test('FAV RETRY: a retry that lands ends it, and the tile reads the stored value', async ({
		page
	}) => {
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const fav = tile.getByRole('button', { name: 'Favourite' });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		const done = await loseFirst(page, 'favourite');

		await fav.click();
		await expect(fav).toHaveClass(/unsaved/);
		await done();
		await page.getByRole('button', { name: 'RETRY' }).click();
		await expect(page.getByText('FAV NOT SAVED')).toHaveCount(0);
		await expect(fav).not.toHaveClass(/unsaved/);
		await expect(fav).toHaveAttribute('aria-pressed', 'true');

		// Put it back as the seed has it.
		await fav.click();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await page.reload();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
	});

	test('a later tap: the one that lands ends it, and one that fails marks it again', async ({
		page
	}) => {
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const bars = tile.getByRole('img');
		const rate = tile.getByRole('button', { name: /^Rate, / });
		await expect(bars).toHaveAttribute('aria-label', 'Unrated');
		// The rating, not FAV: a FAV tap sends the value back to the seed's, so a
		// reload cannot show whether the later POST was stored. Any rating can,
		// so this one sends 4 -- neither the seed's 0 nor the lost 6.
		const isRate = (u: URL) => u.pathname === '/' && u.search === '?/rate';
		let lose = true;
		await page.route(isRate, (route) => (lose ? route.abort() : route.continue()));
		const pick = async (name: string) => {
			await rate.click();
			await tile.getByRole('button', { name }).click();
		};

		await pick('Rate 6 of 10');
		await expect(bars).toHaveAttribute('aria-label', 'Rated 6 of 10');
		await expect(page.getByText('RATING 6 NOT SAVED')).toBeVisible();
		await expect(rate).toHaveClass(/unsaved/);

		// The same field's next tap clears the failure before it saves. This one
		// lands: wait for its own answer, then read the stored value back off a
		// reload rather than trusting the tap.
		lose = false;
		const answered = page.waitForResponse((r) => {
			const u = new URL(r.url());
			return u.pathname === '/' && u.search === '?/rate' && r.ok();
		});
		await pick('Rate 4 of 10');
		expect(((await (await answered).json()) as { type?: string }).type).toBe('success');
		await expect(page.getByText('RATING 6 NOT SAVED')).toHaveCount(0);
		await expect(rate).not.toHaveClass(/unsaved/);
		await page.reload();
		await expect(bars).toHaveAttribute('aria-label', 'Rated 4 of 10');

		// A later tap that fails brings the mark back, and PUT BACK reads the
		// value the reload stored.
		lose = true;
		await pick('Rate 8 of 10');
		await expect(page.getByText('RATING 8 NOT SAVED')).toBeVisible();
		await expect(rate).toHaveClass(/unsaved/);
		await page.getByRole('button', { name: 'PUT BACK 4' }).click();
		await expect(page.getByText('RATING 8 NOT SAVED')).toHaveCount(0);
		await expect(rate).not.toHaveClass(/unsaved/);
		await expect(bars).toHaveAttribute('aria-label', 'Rated 4 of 10');

		// Back to the seed: unrated.
		lose = false;
		const cleared = page.waitForResponse((r) => {
			const u = new URL(r.url());
			return u.pathname === '/' && u.search === '?/rate' && r.ok();
		});
		await rate.click();
		await tile.getByRole('button', { name: 'Unrated' }).click();
		await cleared;
		await page.reload();
		await expect(bars).toHaveAttribute('aria-label', 'Unrated');
		await page.unroute(isRate);
	});

	/** The band a tile's failure draws: one each, named for the tile. */
	const bandOf = (page: Page, title: string | null) =>
		page.locator('[role="alert"]', { hasText: (title ?? '').toUpperCase() });

	test('two failed taps: both tiles stay dashed, each with its own band and way back', async ({
		page
	}) => {
		// The store holds a list now: two lost taps are two bands, stacked,
		// each with its own PUT BACK and RETRY.
		await page.goto('/?sort=title');
		const tiles = page
			.locator('.grid .tile')
			.filter({ has: page.getByRole('button', { name: 'Favourite' }) });
		await expect(tiles.nth(1)).toBeAttached();
		const first = tiles.nth(0);
		const second = tiles.nth(1);
		const favA = first.getByRole('button', { name: 'Favourite' });
		const favB = second.getByRole('button', { name: 'Favourite' });
		const wasA = await favA.getAttribute('aria-pressed');
		const wasB = await favB.getAttribute('aria-pressed');
		const done = await loseAll(page, 'favourite');

		const titleA = await first.locator('.title').textContent();
		const titleB = await second.locator('.title').textContent();
		const bandA = bandOf(page, titleA);
		const bandB = bandOf(page, titleB);

		await favA.click();
		await expect(favA).toHaveClass(/unsaved/);
		await favB.click();
		await expect(favB).toHaveClass(/unsaved/);
		await expect(favA).toHaveClass(/unsaved/);
		await expect(page.locator('[role="alert"]')).toHaveCount(2);
		for (const band of [bandA, bandB]) {
			await expect(band).toHaveCount(1);
			await expect(band.getByRole('button', { name: /PUT BACK/ })).toBeVisible();
			await expect(band.getByRole('button', { name: 'RETRY' })).toBeVisible();
		}

		// Each PUT BACK ends its own: the other band stays.
		await bandB.getByRole('button', { name: /PUT BACK/ }).click();
		await expect(favB).not.toHaveClass(/unsaved/);
		await expect(favA).toHaveClass(/unsaved/);
		await expect(bandB).toHaveCount(0);
		await expect(bandA).toHaveCount(1);
		await bandA.getByRole('button', { name: /PUT BACK/ }).click();
		await expect(page.locator('[role="alert"]')).toHaveCount(0);
		await expect(favA).not.toHaveClass(/unsaved/);
		await expect(favA).toHaveAttribute('aria-pressed', wasA!);
		await expect(favB).toHaveAttribute('aria-pressed', wasB!);
		await done();

		// Neither was stored: a reload draws the seed's values.
		await page.reload();
		await expect(tiles.nth(0).getByRole('button', { name: 'Favourite' })).toHaveAttribute(
			'aria-pressed',
			wasA!
		);
		await expect(tiles.nth(1).getByRole('button', { name: 'Favourite' })).toHaveAttribute(
			'aria-pressed',
			wasB!
		);
	});

	test('FAV then a rating on one tile: each failure keeps its own way back', async ({ page }) => {
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const fav = tile.getByRole('button', { name: 'Favourite' });
		const bars = tile.getByRole('img');
		const rate = tile.getByRole('button', { name: /^Rate, / });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await expect(bars).toHaveAttribute('aria-label', 'Unrated');
		const noFav = await loseAll(page, 'favourite');
		const noRate = await loseAll(page, 'rate');

		await fav.click();
		await rate.click();
		await tile.getByRole('button', { name: 'Rate 6 of 10' }).click();
		await expect(fav).toHaveClass(/unsaved/);
		await expect(rate).toHaveClass(/unsaved/);
		await expect(page.getByText('RATING 6 NOT SAVED')).toBeVisible();

		// Two bands for one tile; putting the rating back leaves FAV's.
		await page.getByRole('button', { name: 'PUT BACK 0' }).click();
		await expect(page.getByText('RATING 6 NOT SAVED')).toHaveCount(0);
		await expect(rate).not.toHaveClass(/unsaved/);
		await expect(fav).toHaveClass(/unsaved/);
		await expect(page.getByText('FAV NOT SAVED')).toBeVisible();
		await page.getByRole('button', { name: 'PUT BACK · NOT FAV' }).click();
		await expect(page.getByText('FAV NOT SAVED')).toHaveCount(0);
		await expect(fav).not.toHaveClass(/unsaved/);
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		await expect(bars).toHaveAttribute('aria-label', 'Unrated');
		await noFav();
		await noRate();
	});

	test('a tile read again after a trip away draws the stored value, not a mark', async ({
		page
	}) => {
		// `saves` outlives the page and `favNow` does not: the failure is still
		// the band's, but the tile that comes back holds the stored value, so
		// nothing on it is "not stored yet".
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const fav = tile.getByRole('button', { name: 'Favourite' });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		const done = await loseAll(page, 'favourite');

		await fav.click();
		await expect(fav).toHaveClass(/unsaved/);
		await expect(page.getByText('FAV NOT SAVED')).toBeVisible();

		// The series and back, as the owner does; the nudge retries on the way and
		// loses too.
		await tile.locator('.open').click();
		await page.waitForURL(/\/series\//);
		await page.goBack();
		await expect(page.locator('.grid .tile', { hasText: TITLE })).toBeAttached();

		const back = page.locator('.grid .tile', { hasText: TITLE });
		const backFav = back.getByRole('button', { name: 'Favourite' });
		await expect(backFav).toHaveAttribute('aria-pressed', 'false');
		await expect(backFav).not.toHaveClass(/unsaved/);
		// The band is the app's, not the page's: it still offers the way back.
		await expect(page.getByText('FAV NOT SAVED')).toBeVisible();
		await page.getByRole('button', { name: 'PUT BACK · NOT FAV' }).click();
		await expect(page.getByText('FAV NOT SAVED')).toHaveCount(0);
		await expect(backFav).not.toHaveClass(/unsaved/);
		await done();
	});

	/**
	 * Answer this action's POSTs in the order given: lost, held until
	 * `release`, or let through; every one after the script goes through.
	 * `held` resolves once the held POST has arrived, so a case acts while it
	 * is out, the way a slow workstation keeps a RETRY out.
	 */
	async function scripted(page: Page, action: 'favourite' | 'rate', steps: ('lose' | 'hold')[]) {
		const isAction = (u: URL) => u.pathname === '/' && u.search === `?/${action}`;
		const script = [...steps];
		let arrived!: (r: Route) => void;
		const held = new Promise<Route>((resolve) => (arrived = resolve));
		await page.route(isAction, (route) => {
			const step = script.shift();
			if (step === 'lose') return route.abort();
			if (step === 'hold') return arrived(route);
			return route.continue();
		});
		return { held, done: () => page.unroute(isAction) };
	}

	/** The next answered POST of `?/favourite`, read as stored or not. */
	function favAnswer(page: Page) {
		return page
			.waitForResponse((r) => {
				const u = new URL(r.url());
				return u.pathname === '/' && u.search === '?/favourite';
			})
			.then(async (r) => ((await r.json()) as { type?: string }).type === 'success');
	}

	test('a RETRY that lands while another tile has failed leaves that tile’s band up', async ({
		page
	}) => {
		// Wave 30's round-2 medium 1, in its own route order: A's tap lost, A's
		// RETRY held, B's tap lost, A's RETRY let through. A retry clears only its
		// own failure now, so B keeps its band.
		await page.goto('/?sort=title');
		const tiles = page
			.locator('.grid .tile')
			.filter({ has: page.getByRole('button', { name: 'Favourite' }) });
		await expect(tiles.nth(1)).toBeAttached();
		const favA = tiles.nth(0).getByRole('button', { name: 'Favourite' });
		const favB = tiles.nth(1).getByRole('button', { name: 'Favourite' });
		const wasA = await favA.getAttribute('aria-pressed');
		const wasB = await favB.getAttribute('aria-pressed');
		const flip = (v: string | null) => (v === 'true' ? 'false' : 'true');
		const bandA = bandOf(page, await tiles.nth(0).locator('.title').textContent());
		const bandB = bandOf(page, await tiles.nth(1).locator('.title').textContent());
		const { held, done } = await scripted(page, 'favourite', ['lose', 'hold', 'lose']);

		await favA.click();
		await expect(favA).toHaveClass(/unsaved/);
		await expect(bandA).toHaveCount(1);
		await bandA.getByRole('button', { name: 'RETRY' }).click();
		const retry = await held;
		// The RETRY is out: its value is still not stored, so the mark stays.
		await expect(favA).toHaveClass(/unsaved/);

		await favB.click();
		await expect(favB).toHaveClass(/unsaved/);
		await expect(bandB).toHaveCount(1);
		await expect(bandA).toHaveCount(1);

		const landed = favAnswer(page);
		await retry.continue();
		expect(await landed).toBe(true);
		// A is stored; B is not, and its band is back.
		await expect(favA).not.toHaveClass(/unsaved/);
		await expect(favA).toHaveAttribute('aria-pressed', flip(wasA));
		await expect(favB).toHaveClass(/unsaved/);
		await expect(favB).toHaveAttribute('aria-pressed', flip(wasB));
		await expect(bandA).toHaveCount(0);
		await expect(bandB).toHaveCount(1);
		await expect(bandB.getByRole('button', { name: 'RETRY' })).toBeVisible();

		// B's PUT BACK reads B's stored value.
		await bandB
			.getByRole('button', { name: wasB === 'true' ? 'PUT BACK · FAV' : 'PUT BACK · NOT FAV' })
			.click();
		await expect(bandB).toHaveCount(0);
		await expect(favB).not.toHaveClass(/unsaved/);
		await expect(favB).toHaveAttribute('aria-pressed', wasB!);
		await done();

		await page.reload();
		const backA = tiles.nth(0).getByRole('button', { name: 'Favourite' });
		await expect(backA).toHaveAttribute('aria-pressed', flip(wasA));
		await expect(tiles.nth(1).getByRole('button', { name: 'Favourite' })).toHaveAttribute(
			'aria-pressed',
			wasB!
		);
		// Put A back as the seed has it.
		const restored = favAnswer(page);
		await backA.click();
		expect(await restored).toBe(true);
		await page.reload();
		await expect(tiles.nth(0).getByRole('button', { name: 'Favourite' })).toHaveAttribute(
			'aria-pressed',
			wasA!
		);
	});

	test('a tile drawn again while its RETRY is out stays dashed, and is still dashed when it fails', async ({
		page
	}) => {
		// Wave 30's round-2 medium 2, in its own route order: A's tap lost, A's
		// RETRY held, tile C's tap landing (its re-read hands the grid new
		// cards), A's RETRY lost. The mark used to drop at C's redraw and never
		// come back, leaving FAV NOT SAVED over a tile drawn as stored.
		await page.goto('/?sort=title');
		const tiles = page
			.locator('.grid .tile')
			.filter({ has: page.getByRole('button', { name: 'Favourite' }) });
		await expect(tiles.nth(2)).toBeAttached();
		const favA = tiles.nth(0).getByRole('button', { name: 'Favourite' });
		const favC = tiles.nth(2).getByRole('button', { name: 'Favourite' });
		const wasA = await favA.getAttribute('aria-pressed');
		const wasC = await favC.getAttribute('aria-pressed');
		const flip = (v: string | null) => (v === 'true' ? 'false' : 'true');
		const band = page.getByText(/FAV NOT SAVED|UNFAV NOT SAVED/);
		const { held, done } = await scripted(page, 'favourite', ['lose', 'hold']);

		await favA.click();
		await expect(favA).toHaveClass(/unsaved/);
		await page.getByRole('button', { name: 'RETRY' }).click();
		const retry = await held;

		// C lands, and its re-read draws the grid again. Wait for that re-read
		// itself: the redraw it brings is the one that used to drop A's mark,
		// and it must land before A's RETRY is lost, as in the review's order.
		const landed = favAnswer(page);
		const reread = page.waitForResponse(
			(r) => new URL(r.url()).pathname === '/__data.json' && r.ok()
		);
		await favC.click();
		expect(await landed).toBe(true);
		await reread;
		await expect(favC).toHaveAttribute('aria-pressed', flip(wasC));
		await expect(favC).not.toHaveClass(/unsaved/);
		await expect(favA).toHaveClass(/unsaved/);

		const lost = page.waitForEvent('requestfailed', {
			predicate: (r) => new URL(r.url()).search === '?/favourite'
		});
		await retry.abort();
		await lost;
		await expect(band).toHaveCount(1);
		await expect(favA).toHaveAttribute('aria-pressed', flip(wasA));
		await expect(favA).toHaveClass(/unsaved/);

		await page
			.getByRole('button', { name: wasA === 'true' ? 'PUT BACK · FAV' : 'PUT BACK · NOT FAV' })
			.click();
		await expect(band).toHaveCount(0);
		await expect(favA).not.toHaveClass(/unsaved/);
		await expect(favA).toHaveAttribute('aria-pressed', wasA!);
		await done();

		// A was never stored; C was. Put C back as the seed has it.
		await page.reload();
		await expect(tiles.nth(0).getByRole('button', { name: 'Favourite' })).toHaveAttribute(
			'aria-pressed',
			wasA!
		);
		const backC = tiles.nth(2).getByRole('button', { name: 'Favourite' });
		await expect(backC).toHaveAttribute('aria-pressed', flip(wasC));
		const restored = favAnswer(page);
		await backC.click();
		expect(await restored).toBe(true);
		await page.reload();
		await expect(tiles.nth(2).getByRole('button', { name: 'Favourite' })).toHaveAttribute(
			'aria-pressed',
			wasC!
		);
	});

	test('a series screen failure carried here keeps its band beside a tile’s', async ({ page }) => {
		// Wave 30's round-2 low: a failure raised on the series screen was
		// dropped as a tile's took the band. The store keeps both now.
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const isSeriesFav = (u: URL) =>
			/^\/series\/\d+$/.test(u.pathname) && u.search === '?/favourite';
		await page.route(isSeriesFav, (route) => route.abort());
		const noTileFav = await loseAll(page, 'favourite');
		// The series screen's own words name no tile.
		const seriesBand = page
			.locator('[role="alert"]')
			.filter({ has: page.locator('.what', { hasText: /^FAV NOT SAVED$/ }) });
		const bands = page.locator('[role="alert"]');

		await tile.locator('.open').click();
		await page.waitForURL(/\/series\//);
		const panel = page.getByRole('region', { name: 'About this series' });
		await panel.getByRole('button', { name: 'FAV', exact: true }).click();
		await expect(bands).toHaveCount(1);
		// Back to the library; the nudge retries on the way and loses too.
		await page.goBack();
		const other = page
			.locator('.grid .tile')
			.filter({ has: page.getByRole('button', { name: 'Favourite' }) })
			.filter({ hasNotText: TITLE })
			.first();
		const favOther = other.getByRole('button', { name: 'Favourite' });
		await expect(favOther).toBeVisible();
		await expect(bands).toHaveCount(1);
		const wasOther = await favOther.getAttribute('aria-pressed');
		const otherBand = bandOf(page, await other.locator('.title').textContent());

		await favOther.click();
		await expect(favOther).toHaveClass(/unsaved/);
		await expect(bands).toHaveCount(2);
		await otherBand
			.getByRole('button', {
				name: wasOther === 'true' ? 'PUT BACK · FAV' : 'PUT BACK · NOT FAV'
			})
			.click();
		await expect(favOther).not.toHaveClass(/unsaved/);
		await expect(otherBand).toHaveCount(0);
		// The series screen's failure still has its band and its way out.
		await expect(seriesBand).toContainText('FAV NOT SAVED');
		await expect(seriesBand.getByRole('button', { name: 'RETRY' })).toBeVisible();
		await seriesBand.getByRole('button', { name: 'PUT BACK · NOT FAV' }).click();
		await expect(bands).toHaveCount(0);
		await noTileFav();
		await page.unroute(isSeriesFav);

		// Nothing was stored.
		await page.reload();
		await expect(
			page.locator('.grid .tile', { hasText: TITLE }).getByRole('button', { name: 'Favourite' })
		).toHaveAttribute('aria-pressed', 'false');
	});

	test('SELECT keeps the mark on the plain badge and bars the tile draws then', async ({
		page
	}) => {
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const fav = tile.getByRole('button', { name: 'Favourite' });
		const rate = tile.getByRole('button', { name: /^Rate, / });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		const noFav = await loseAll(page, 'favourite');
		const noRate = await loseAll(page, 'rate');

		await fav.click();
		await expect(fav).toHaveClass(/unsaved/);
		await rate.click();
		await tile.getByRole('button', { name: 'Rate 6 of 10' }).click();
		await expect(rate).toHaveClass(/unsaved/);

		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		// The controls are gone: every tap is a pick now.
		await expect(tile.getByRole('button', { name: 'Favourite' })).toHaveCount(0);
		await expect(tile.getByRole('button', { name: /^Rate, / })).toHaveCount(0);
		const corner = tile.locator('.fav-plain.unsaved');
		const bars = tile.locator('.rating-plain.unsaved');
		await expect(corner).toContainText('FAV');
		await expect(bars.getByRole('img')).toHaveAttribute('aria-label', 'Rated 6 of 10');
		expect(await corner.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');
		expect(await bars.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');

		// A mark is not a control: the corner still picks the tile.
		await corner.click();
		await expect(tile.locator('.open')).toHaveAttribute('aria-pressed', 'true');
		await tile.locator('.open').click();
		await expect(tile.locator('.open')).toHaveAttribute('aria-pressed', 'false');

		await page.getByRole('button', { name: 'PUT BACK 0' }).click();
		await expect(bars).toHaveCount(0);
		await expect(corner).toContainText('FAV');
		await page.getByRole('button', { name: 'PUT BACK · NOT FAV' }).click();
		await expect(corner).toHaveCount(0);
		await expect(tile.getByText('FAV', { exact: true })).toHaveCount(0);
		await noFav();
		await noRate();
	});

	test('a failed UNFAV keeps its mark in SELECT too, though no badge is drawn', async ({
		page
	}) => {
		// The value a failed UNFAV leaves is the absence of a badge: a mark that
		// lived on the badge would have nothing to sit on.
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const fav = tile.getByRole('button', { name: 'Favourite' });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
		const stored = page.waitForResponse((r) => new URL(r.url()).search === '?/favourite' && r.ok());
		await fav.click();
		await stored;
		await expect(fav).toHaveAttribute('aria-pressed', 'true');
		await expect(fav).not.toHaveClass(/unsaved/);
		await page.reload();
		await expect(fav).toHaveAttribute('aria-pressed', 'true');

		const noFav = await loseAll(page, 'favourite');
		await fav.click();
		await expect(fav).toHaveClass(/unsaved/);
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		const corner = tile.locator('.fav-plain.unsaved');
		await expect(corner).toBeVisible();
		await expect(corner).not.toContainText('FAV');
		await page.getByRole('button', { name: 'PUT BACK · FAV' }).click();
		await expect(corner).toHaveCount(0);
		await expect(tile.getByText('FAV', { exact: true })).toBeVisible();
		await noFav();

		// Back as the seed has it.
		await page.reload();
		const restored = page.waitForResponse(
			(r) => new URL(r.url()).search === '?/favourite' && r.ok()
		);
		await fav.click();
		await restored;
		await page.reload();
		await expect(fav).toHaveAttribute('aria-pressed', 'false');
	});

	test('failures raised on the library survive a trip to a series screen, each with its way back', async ({
		page
	}) => {
		// `displaced` used to die with the page: only the failure the band held
		// came back. Both are the store's now.
		await page.goto('/?sort=title');
		const tiles = page
			.locator('.grid .tile')
			.filter({ has: page.getByRole('button', { name: 'Favourite' }) });
		await expect(tiles.nth(1)).toBeAttached();
		const titleA = await tiles.nth(0).locator('.title').textContent();
		const titleB = await tiles.nth(1).locator('.title').textContent();
		const bandA = bandOf(page, titleA);
		const bandB = bandOf(page, titleB);
		const noFav = await loseAll(page, 'favourite');

		await tiles.nth(0).getByRole('button', { name: 'Favourite' }).click();
		await expect(bandA).toHaveCount(1);
		await tiles.nth(1).getByRole('button', { name: 'Favourite' }).click();
		await expect(bandB).toHaveCount(1);
		await expect(bandA).toHaveCount(1);

		// The series screen: the nudge retries each, and each loses.
		await tiles.nth(0).locator('.open').click();
		await page.waitForURL(/\/series\//);
		await expect(page.locator('[role="alert"]')).toHaveCount(2);
		for (const band of [bandA, bandB]) {
			await expect(band.getByRole('button', { name: /PUT BACK/ })).toBeVisible();
			await expect(band.getByRole('button', { name: 'RETRY' })).toBeVisible();
		}

		// And back: still both, each ending only its own.
		await page.goBack();
		await expect(page.locator('.grid .tile').first()).toBeAttached();
		await expect(page.locator('[role="alert"]')).toHaveCount(2);
		await bandA.getByRole('button', { name: /PUT BACK/ }).click();
		await expect(bandA).toHaveCount(0);
		await expect(bandB).toHaveCount(1);
		await bandB.getByRole('button', { name: /PUT BACK/ }).click();
		await expect(page.locator('[role="alert"]')).toHaveCount(0);
		await noFav();
	});

	// The band is the app's and outlives reveal: HIDE AGAIN is a `use:enhance`
	// form answering a 303, so the store survives it. doc/LIBRARY.md's "while
	// reveal is off a hidden title never reaches the browser" has to hold there.
	for (const { how, title, ownFlag } of [
		{ how: 'through its hidden root', title: 'Onsen Ryokan no Yoru', ownFlag: false },
		{ how: 'by its own flag', title: TITLE, ownFlag: true }
	]) {
		test(`a series hidden ${how} is not named on its band, before or after reveal ends`, async ({
			page
		}) => {
			const VISIBLE = 'Hoshi no Umi no Tabibito';
			const revealOn = async () => {
				await page.goto('/search');
				await page.getByRole('searchbox').fill('/reveal');
				await page.keyboard.press('Enter');
				await page.waitForURL((u) => u.pathname === '/');
				await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
				await page.goto('/?shelf=all&sort=title');
			};
			if (ownFlag) {
				await page.goto('/');
				const sheet = await longPress(page, title);
				await sheet.getByRole('button', { name: 'HIDE', exact: true }).click();
				await expect(page.locator('.grid .tile', { hasText: title })).toHaveCount(0);
			}
			await revealOn();

			const hidden = page.locator('.grid .tile', { hasText: title });
			await expect(hidden.getByText('HIDDEN', { exact: true })).toBeVisible();
			const visible = page.locator('.grid .tile', { hasText: VISIBLE });
			await expect(visible.getByText('HIDDEN', { exact: true })).toHaveCount(0);

			// Aborted for the whole case, so the nudge HIDE AGAIN causes loses too.
			let favsLost = 0;
			const isFav = (u: URL) => u.pathname === '/' && u.search === '?/favourite';
			const isRate = (u: URL) => u.pathname === '/' && u.search === '?/rate';
			await page.route(isFav, (route) => {
				favsLost++;
				return route.abort();
			});
			await page.route(isRate, (route) => route.abort());

			const fav = hidden.getByRole('button', { name: 'Favourite' });
			const word = (await fav.getAttribute('aria-pressed')) === 'true' ? 'UNFAV' : 'FAV';
			await fav.click();
			await expect(fav).toHaveClass(/unsaved/);
			await hidden.getByRole('button', { name: /^Rate, / }).click();
			await hidden.getByRole('button', { name: 'Rate 6 of 10' }).click();
			const visibleFav = visible.getByRole('button', { name: 'Favourite' });
			const visibleWord =
				(await visibleFav.getAttribute('aria-pressed')) === 'true' ? 'UNFAV' : 'FAV';
			await visibleFav.click();
			await expect(visibleFav).toHaveClass(/unsaved/);

			const bands = page.locator('[role="alert"]');
			await expect(bands).toHaveCount(3);
			const named = bands.filter({ hasText: title.toUpperCase() });
			const favBand = bands.filter({
				has: page.locator('.what', { hasText: new RegExp(`^${word} NOT SAVED$`) })
			});
			const rateBand = bands.filter({
				has: page.locator('.what', { hasText: /^RATING 6 NOT SAVED$/ })
			});
			const visibleBand = bands.filter({ hasText: VISIBLE.toUpperCase() });

			// The hidden tile's two bands say what failed and nothing about whose.
			const unnamed = async () => {
				await expect(bands).toHaveCount(3);
				await expect(named).toHaveCount(0);
				await expect(favBand).toHaveCount(1);
				await expect(rateBand).toHaveCount(1);
				// The neighbouring value: a visible tile's band still says which.
				await expect(visibleBand.locator('.what')).toHaveText(
					`${visibleWord} NOT SAVED · ${VISIBLE.toUpperCase()}`
				);
			};
			await unnamed();
			for (const band of [favBand, rateBand]) {
				await expect(band.getByRole('button', { name: /PUT BACK/ })).toBeVisible();
				await expect(band.getByRole('button', { name: 'RETRY' })).toBeVisible();
			}

			// End reveal by the banner. The grid drops the series, the store does not.
			const before = favsLost;
			await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
			await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
			await expect(page.locator('.grid .tile', { hasText: title })).toHaveCount(0);
			// Both held FAVs were tried again and lost: the state after the nudge.
			await expect.poll(() => favsLost).toBeGreaterThanOrEqual(before + 2);
			await unnamed();

			for (const band of [favBand, rateBand, visibleBand]) {
				await band.getByRole('button', { name: /PUT BACK/ }).click();
				await expect(band).toHaveCount(0);
			}
			await expect(bands).toHaveCount(0);
			await page.unroute(isFav);
			await page.unroute(isRate);

			if (ownFlag) {
				await revealOn();
				await longPress(page, title);
				await page.getByRole('button', { name: 'UNHIDE' }).click();
				await expect(hidden.getByText('HIDDEN', { exact: true })).toHaveCount(0);
				await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
				await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
			}
		});
	}

	test('a tile gone from the grid when its save fails is not named, and leaves no separator', async ({
		page
	}) => {
		await page.goto('/?shelf=all&sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const fav = tile.getByRole('button', { name: 'Favourite' });
		await expect(fav).toHaveAttribute('aria-pressed', 'false');

		// Held, so the shelf can change under the save before it is lost.
		let lose = () => {};
		const lost = new Promise<void>((resolve) => (lose = resolve));
		const isFav = (u: URL) => u.pathname === '/' && u.search === '?/favourite';
		await page.route(isFav, async (route) => {
			await lost;
			await route.abort();
		});
		const asked = page.waitForRequest((r) => isFav(new URL(r.url())));
		await fav.click();
		await asked;

		await page.locator('.kinds .kc', { hasText: 'NOVEL' }).click();
		await expect(page).toHaveURL(/kind=novel/);
		await expect(tile).toHaveCount(0);
		lose();

		const band = page.locator('[role="alert"]');
		await expect(band).toHaveCount(1);
		await expect(band.locator('.what')).toHaveText('FAV NOT SAVED');
		await band.getByRole('button', { name: /PUT BACK/ }).click();
		await expect(band).toHaveCount(0);
		await page.unroute(isFav);
	});

	test('the rating draws dashed as well, and PUT BACK ends it', async ({ page }) => {
		await page.goto('/?sort=title');
		const tile = page.locator('.grid .tile', { hasText: TITLE });
		const bars = tile.getByRole('img');
		const rate = tile.getByRole('button', { name: /^Rate, / });
		await expect(bars).toHaveAttribute('aria-label', 'Unrated');
		const done = await loseFirst(page, 'rate');

		await rate.click();
		await expect(tile.locator('.picker')).toBeVisible();
		await tile.getByRole('button', { name: 'Rate 6 of 10' }).click();
		await expect(bars).toHaveAttribute('aria-label', 'Rated 6 of 10');
		await expect(page.getByText('RATING 6 NOT SAVED')).toBeVisible();
		await expect(rate).toHaveClass(/unsaved/);
		expect(await rate.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');

		await page.getByRole('button', { name: 'PUT BACK 0' }).click();
		await expect(page.getByText('RATING 6 NOT SAVED')).toHaveCount(0);
		await expect(rate).not.toHaveClass(/unsaved/);
		await expect(bars).toHaveAttribute('aria-label', 'Unrated');
		await done();
	});
});

/**
 * A seeded library of its own, served on a port the OS gave it: for a case that
 * reshapes the seed or deletes from it, so nothing it does reaches the shared
 * database the other flow files read. `test.use({ baseURL: library.base })` in
 * the describe, `start` and `stop` in its hooks.
 */
function ownLibrary(name: string, port: number, prepare: (db: Database.Database) => void) {
	const scratch = mkdtempSync(join(tmpdir(), `tsundoku-e2e-${name}-`));
	const dbPath = join(scratch, 'library.sqlite');
	const base = `http://localhost:${port}`;
	let server: ChildProcess | null = null;
	const withDb = <T>(read: (db: Database.Database) => T): T => {
		const db = new Database(dbPath);
		try {
			return read(db);
		} finally {
			db.close();
		}
	};
	return {
		base,
		withDb,
		idOf: (title: string) =>
			withDb(
				(db) =>
					(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id
			),
		start: async () => {
			execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
				env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
				stdio: 'pipe'
			});
			withDb(prepare);
			server = await startPreview(
				() =>
					spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
						env: {
							...process.env,
							DATABASE_PATH: dbPath,
							TSUNDOKU_TOKEN: E2E_TOKEN,
							TSUNDOKU_ANILIST: 'off',
							LIBRARY_ROOT: join(scratch, 'library'),
							TRASH_DIR: join(scratch, 'trash'),
							COVER_DIR: join(scratch, 'covers'),
							BACKUP_DIR: join(scratch, 'backups'),
							TSUNDOKU_HOME: join(scratch, 'home')
						},
						stdio: 'ignore'
					}),
				base,
				`the ${name} preview`
			);
		},
		stop: () => {
			server?.kill();
			server = null;
			rmSync(scratch, { recursive: true, force: true });
		}
	};
}

/** A port the OS has free now. */
const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const probe = tcpServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});

const foldPort = await freePort();

test.describe('FOLD is offered only over books with nothing beside them', () => {
	const PLAIN_JA = 'Ame no Hi no Toshokan';
	const PLAIN_EN = 'Hoshi no Umi no Tabibito';
	const WITH_EXTRA = 'Onsen Ryokan no Yoru';
	const WITH_DUPLICATE = 'Sekai no Owari no Kissaten';

	const library = ownLibrary('fold', foldPort, (db) => {
		// The seed keeps some of its books in a hidden root.
		db.exec(`UPDATE roots SET hidden = 0`);
		const seriesOf = (title: string) =>
			(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
		const tag = db.prepare(`INSERT OR IGNORE INTO tags (namespace, value) VALUES ('language', ?)`);
		const onSeries = db.prepare(
			`INSERT INTO series_tags (series_id, tag_id)
			SELECT ?, id FROM tags WHERE namespace = 'language' AND value = ?`
		);
		// Four languages, so only what is beside a book can refuse it.
		for (const [title, language] of [
			[PLAIN_JA, 'japanese'],
			[PLAIN_EN, 'english'],
			[WITH_EXTRA, 'korean'],
			[WITH_DUPLICATE, 'chinese']
		]) {
			tag.run(language);
			onSeries.run(seriesOf(title), language);
		}
		const beside = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, matter, shadowed)
			VALUES (?, 99, 'Beside', 1, ?, ?)`
		);
		beside.run(seriesOf(WITH_EXTRA), 'back', 0);
		beside.run(seriesOf(WITH_DUPLICATE), '', 1);
	});

	test.use({ baseURL: library.base });
	test.beforeAll(async () => {
		test.setTimeout(120_000);
		await library.start();
	});
	test.afterAll(() => library.stop());

	test('a book with an extra or a set-aside duplicate beside it takes the FOLD cell away', async ({
		page
	}) => {
		await page.goto('/?shelf=all&sort=title');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		const tick = (title: string) => page.locator('.grid .tile', { hasText: title }).click();
		const fold = page.locator('button.fold');
		const group = page.getByRole('button', { name: 'GROUP', exact: true });

		// The control: these two are foldable, so a missing cell below is the rule's.
		await tick(PLAIN_JA);
		await tick(PLAIN_EN);
		await expect(fold).toContainText('JA · EN');

		// An extra beside the third book: three books, three languages, no FOLD.
		await tick(WITH_EXTRA);
		await expect(fold).toHaveCount(0);
		await expect(group).toBeVisible();
		await tick(PLAIN_EN);
		await expect(fold).toHaveCount(0);

		// A set-aside duplicate does the same.
		await tick(WITH_EXTRA);
		await tick(WITH_DUPLICATE);
		await expect(fold).toHaveCount(0);
		await expect(group).toBeVisible();

		// And the two that can fold offer it again.
		await tick(WITH_DUPLICATE);
		await tick(PLAIN_EN);
		await expect(fold).toContainText('JA · EN');
	});

	test('the card says alone for one book, and not for anything beside it', async ({ page }) => {
		const shapes = {
			plain: library.idOf(PLAIN_JA),
			extra: library.idOf(WITH_EXTRA),
			duplicate: library.idOf(WITH_DUPLICATE),
			folded: library.idOf('Harbour Lights'),
			several: library.idOf('Kaori Mama')
		};
		// `?/fold` passes a folded edition beside the book: it is the book's own.
		expect(
			library.withDb(
				(db) =>
					(
						db
							.prepare(
								`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND edition_of IS NOT NULL`
							)
							.get(shapes.folded) as { n: number }
					).n
			)
		).toBe(1);
		const res = await page.request.post('/api/library', {
			data: { ids: Object.values(shapes) }
		});
		expect(res.ok()).toBe(true);
		const { series } = (await res.json()) as { series: { id: number; alone?: boolean }[] };
		const alone = (id: number) => series.find((c) => c.id === id)?.alone;
		expect(alone(shapes.plain)).toBe(true);
		expect(alone(shapes.extra)).toBe(false);
		expect(alone(shapes.duplicate)).toBe(false);
		expect(alone(shapes.folded)).toBe(true);
		expect(alone(shapes.several)).toBe(false);
	});
});

const deepPort = await freePort();

test.describe('a Work past the first page asks like one on it', () => {
	const FIRST = 'Aaa First Run';
	const DEEP = 'Zzz Deep Run';

	const library = ownLibrary('deep-work', deepPort, (db) => {
		db.exec(`UPDATE roots SET hidden = 0`);
		const work = (name: string, titles: string[]) => {
			const id = db
				.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES (?, 1, 'hand')`)
				.run(name).lastInsertRowid;
			titles.forEach((title, i) =>
				db
					.prepare(
						`INSERT INTO work_series (work_id, series_id, position)
						SELECT ?, id, ? FROM series WHERE title = ?`
					)
					.run(id, i + 1, title)
			);
		};
		work(FIRST, ['Ame no Hi no Toshokan', 'Boku no Kokoro no Yabai Yatsu']);
		work(DEEP, ['Tower of God', 'Yofukashi no Uta']);
	});

	test.use({ baseURL: library.base });
	test.beforeAll(async () => {
		test.setTimeout(120_000);
		await library.start();
	});
	test.afterAll(() => library.stop());

	async function shortPages(page: Page, size = 2) {
		await page
			.context()
			.addCookies([{ name: 'tsundoku_grid_page', value: String(size), url: 'http://localhost' }]);
	}

	/** Scroll the grid until `tile`, and assert it sits past the first page. */
	async function reach(page: Page, tile: ReturnType<Page['locator']>, text: string, size = 2) {
		const more = page.locator('.more');
		for (let i = 0; i < 25 && (await tile.count()) === 0; i++) {
			await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
			await page.waitForTimeout(150);
		}
		await expect(tile).toHaveCount(1);
		const at = await page
			.locator('.grid .tile')
			.evaluateAll((els, t) => els.findIndex((el) => (el.textContent ?? '').includes(t)), text);
		expect(at).toBeGreaterThanOrEqual(size);
		await tile.scrollIntoViewIfNeeded();
	}

	test('a Work tile opens the HIDE sheet on the first page and past it', async ({ page }) => {
		await shortPages(page);
		await page.goto('/?shelf=all&sort=title');
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		const first = page.locator('.grid .tile.work', { hasText: FIRST });
		await first.locator('.open').click();
		await page.getByRole('button', { name: 'HIDE', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'Hide' });
		await expect(sheet).toBeVisible();
		await expect(sheet.getByRole('button', { name: /HIDE ALL 2/ })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);
		await first.locator('.open').click();

		const deep = page.locator('.grid .tile.work', { hasText: DEEP });
		await reach(page, deep, DEEP);
		await deep.locator('.open').click();
		await page.getByRole('button', { name: 'HIDE', exact: true }).click();
		await expect(sheet).toBeVisible();
		await expect(sheet.getByRole('button', { name: /HIDE ALL 2/ })).toBeVisible();
	});
});

const deletePort = await freePort();

test.describe('the bulk DELETE says what it does to highlights', () => {
	const NONE = 'Sekai no Owari no Kissaten';
	const TWO_AND_A_HIDDEN = 'Hoshi no Umi no Tabibito';
	const ONE = 'Ame no Hi no Toshokan';
	const GOES_WITH = 'Natsu no Owari ni Kimi to';
	const GOES_WITH_TOO = 'Kōhai no Himitsu Nikki';
	const STAYS_TOO = 'Onsen Ryokan no Yoru';

	const library = ownLibrary('bulk-delete', deletePort, (db) => {
		db.exec(`UPDATE roots SET hidden = 0`);
		const put = db.prepare(
			`INSERT INTO highlights (kind, series_id, series_title, series_kind, quote, paragraph, made_at, hidden)
			SELECT 'quote', id, title, kind, 'a line', 'a paragraph', 1, ? FROM series WHERE title = ?`
		);
		for (const [title, hidden] of [
			[TWO_AND_A_HIDDEN, 0],
			[TWO_AND_A_HIDDEN, 0],
			[TWO_AND_A_HIDDEN, 1],
			[ONE, 0],
			[GOES_WITH, 0],
			[GOES_WITH, 0],
			[GOES_WITH_TOO, 1],
			[STAYS_TOO, 0]
		] as const)
			put.run(hidden, title);
	});

	/** Every highlight of a series by the title it remembers, however it was left. */
	const heldRows = (title: string) =>
		library.withDb(
			(db) =>
				db
					.prepare(`SELECT state, deleted_at, hidden FROM highlights WHERE series_title = ?`)
					.all(title) as { state: string; deleted_at: number | null; hidden: number }[]
		);

	const isHeld = (u: URL) => u.pathname === '/' && u.search === '?/held';

	async function selecting(page: Page, titles: string[]) {
		await page.goto('/?shelf=all&sort=title');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		for (const title of titles) await page.locator('.grid .tile', { hasText: title }).click();
	}

	/** Tap DELETE, and the sheet it opens once the highlights are read. */
	async function askDelete(page: Page, count: number) {
		await page.getByRole('button', { name: 'DELETE', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: `DELETE ${count} SERIES?` });
		await expect(sheet).toBeVisible();
		return sheet;
	}

	test.use({ baseURL: library.base });
	test.beforeAll(async () => {
		test.setTimeout(120_000);
		await library.start();
	});
	test.afterAll(() => library.stop());

	test('the row is absent at zero, counts what the viewer can see, and the switch names the action', async ({
		page
	}) => {
		await selecting(page, [NONE]);
		let sheet = await askDelete(page, 1);
		await expect(sheet.locator('[data-highlights-kept]')).toHaveCount(0);
		await expect(sheet.getByRole('switch')).toHaveCount(0);
		await expect(sheet.getByRole('button', { name: 'DELETE 1', exact: true })).toBeVisible();
		await sheet.getByRole('button', { name: 'CANCEL' }).click();
		await expect(sheet).toHaveCount(0);

		// One series: the single line, the hidden highlight not counted.
		await page.locator('.grid .tile', { hasText: NONE }).click();
		await page.locator('.grid .tile', { hasText: TWO_AND_A_HIDDEN }).click();
		sheet = await askDelete(page, 1);
		await expect(sheet.locator('[data-highlights-kept]')).toContainText('2 HIGHLIGHTS ARE KEPT');
		await sheet.getByRole('button', { name: 'CANCEL' }).click();

		// Two series: totalled across them.
		await page.locator('.grid .tile', { hasText: ONE }).click();
		sheet = await askDelete(page, 2);
		await expect(sheet.locator('[data-highlights-kept]')).toContainText(
			'3 HIGHLIGHTS IN 2 SERIES ARE KEPT'
		);
		const toggle = sheet.getByRole('switch');
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await expect(sheet.locator('button.del-go')).toHaveText('DELETE 2');
		await toggle.click();
		await expect(sheet.locator('button.del-go')).toHaveText('DELETE WITH 3 HIGHLIGHTS');
		await toggle.click();
		await expect(sheet.locator('button.del-go')).toHaveText('DELETE 2');

		// Left on and cancelled, it is off again on the next opening.
		await toggle.click();
		await sheet.getByRole('button', { name: 'CANCEL' }).click();
		sheet = await askDelete(page, 2);
		await expect(sheet.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
		await expect(sheet.locator('button.del-go')).toHaveText('DELETE 2');
	});

	test('with reveal on, a hidden highlight is counted too', async ({ page }) => {
		await page.goto('/search');
		await page.getByRole('searchbox').fill('/reveal');
		await page.keyboard.press('Enter');
		await page.waitForURL((u) => u.pathname === '/');
		await selecting(page, [TWO_AND_A_HIDDEN]);
		const sheet = await askDelete(page, 1);
		await expect(sheet.locator('[data-highlights-kept]')).toContainText('3 HIGHLIGHTS ARE KEPT');
	});

	test('a read that fails, or hangs, opens the sheet without the row', async ({ page }) => {
		await selecting(page, [ONE]);
		await page.route(isHeld, (route) => route.abort());
		let sheet = await askDelete(page, 1);
		await expect(sheet.locator('[data-highlights-kept]')).toHaveCount(0);
		await sheet.getByRole('button', { name: 'CANCEL' }).click();
		await page.unroute(isHeld);

		// Held past the read's own limit, and answered only after it.
		let answer: Route | null = null;
		await page.route(isHeld, (route) => {
			answer = route;
		});
		sheet = await askDelete(page, 1);
		await expect(sheet.locator('[data-highlights-kept]')).toHaveCount(0);
		await sheet.getByRole('button', { name: 'CANCEL' }).click();
		await (answer as Route | null)?.continue().catch(() => undefined);
		await page.unroute(isHeld);
	});

	test('a tick made while the read is out is counted before the sheet opens', async ({ page }) => {
		await selecting(page, [ONE]);
		let first: Route | null = null;
		const arrived = new Promise<void>((resolve) => {
			void page.route(isHeld, (route) => {
				if (first) return route.continue();
				first = route;
				resolve();
			});
		});
		await page.getByRole('button', { name: 'DELETE', exact: true }).click();
		await arrived;
		await page.locator('.grid .tile', { hasText: GOES_WITH }).click();
		await (first as Route | null)?.continue();
		const sheet = page.getByRole('dialog', { name: 'DELETE 2 SERIES?' });
		await expect(sheet.locator('[data-highlights-kept]')).toContainText(
			'3 HIGHLIGHTS IN 2 SERIES ARE KEPT'
		);
		await sheet.getByRole('button', { name: 'CANCEL' }).click();
		await page.unroute(isHeld);
	});

	test('DELETE keeps them as orphans; with the switch on they go, only what could be seen', async ({
		page
	}) => {
		await selecting(page, [ONE, STAYS_TOO]);
		let sheet = await askDelete(page, 2);
		await expect(sheet.locator('[data-highlights-kept]')).toContainText(
			'2 HIGHLIGHTS IN 2 SERIES ARE KEPT'
		);
		await sheet.locator('button.del-go').click();
		await expect(sheet).toHaveCount(0);
		await expect(page.locator('.grid .tile', { hasText: ONE })).toHaveCount(0);
		for (const title of [ONE, STAYS_TOO])
			expect(heldRows(title)).toEqual([{ state: 'orphan_series', deleted_at: null, hidden: 0 }]);

		await selecting(page, [GOES_WITH, GOES_WITH_TOO]);
		sheet = await askDelete(page, 2);
		await expect(sheet.locator('[data-highlights-kept]')).toContainText('2 HIGHLIGHTS ARE KEPT');
		await sheet.getByRole('switch').click();
		await sheet.locator('button.del-go').click();
		await expect(sheet).toHaveCount(0);
		await expect(page.locator('.grid .tile', { hasText: GOES_WITH })).toHaveCount(0);
		expect(heldRows(GOES_WITH)).toEqual([]);
		// The hidden one was not counted, so the switch could not reach it.
		expect(heldRows(GOES_WITH_TOO)).toEqual([
			{ state: 'orphan_series', deleted_at: null, hidden: 1 }
		]);
	});
});

test('the app’s name goes home, and SERIES, once a shelf, is FILTER’s FORM', async ({ page }) => {
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
	// database ("Each flow file owns its series", doc/TESTING.md). The
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
	// way back is the app's to stop (reader-flow's c565 case pins it).
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

/**
 * The empty library's GET STARTED asks for itself again (c722;
 * doc/ONBOARDING.md, "What ticks a step without a reload"), as `/start`'s
 * does: a phone pairing ticks 04 on the open list with no reload. And the
 * poll's lifetime: it runs exactly while the list is drawn, so it stops when
 * the library fills or the page is left, and never starts on a library with
 * series. Its own preview of the build on a port from the OS, on a database
 * seeded and then emptied of series and devices (start-flow's arrangement),
 * because the shared seed is a library with series. A poll is counted by its
 * own request: `invalidate('tsundoku:start')` re-reads the layout's data
 * (`x-sveltekit-invalidated=1…` on the URL, the layout's node first), and
 * nothing else on these pages does while no scan runs. Playwright's clock stands in for the 5 s wait in the
 * lifetime case, so a count, not a timing, says whether it asked.
 */
test.describe('the empty library’s GET STARTED asks again', () => {
	const dbPath = join(tmpdir(), `tsundoku-e2e-library-start-${process.pid}.sqlite`);
	const library = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-library-start-'));
	let server: ChildProcess | null = null;
	let base = '';
	const sql = (q: string, ...args: unknown[]) => {
		const db = new Database(dbPath);
		try {
			db.prepare(q).run(...args);
		} finally {
			db.close();
		}
	};
	const four = (page: Page) => page.locator('.step[data-step="phone"]');
	const asks = (page: Page) => {
		const seen: string[] = [];
		page.on('request', (r) => {
			// The layout's node re-read: `1` first. A client-side navigation reuses
			// the layout, so its own data request reads `01`, and is not an ask.
			if (/[?&]x-sveltekit-invalidated=1/.test(r.url())) seen.push(r.url());
		});
		return seen;
	};

	test.beforeAll(async () => {
		test.setTimeout(120_000);
		const port = await new Promise<number>((ok, no) => {
			const probe = tcpServer();
			probe.once('error', no);
			probe.listen(0, '127.0.0.1', () => {
				const { port } = probe.address() as AddressInfo;
				probe.close(() => ok(port));
			});
		});
		base = `http://localhost:${port}`;
		rmSync(dbPath, { force: true });
		execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
			env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
			stdio: 'pipe'
		});
		const db = new Database(dbPath);
		db.exec(`DELETE FROM series; DELETE FROM devices; DELETE FROM paired_devices;
			DELETE FROM scan_jobs;`);
		db.close();
		server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				ENGINE_URL: 'http://127.0.0.1:1',
				ENGINE_TOKEN: 'e2e-engine-token',
				ENGINE_STORE: library,
				TSUNDOKU_ANILIST: 'off',
				LIBRARY_ROOT: library,
				COVER_DIR: join(library, 'covers'),
				BACKUP_DIR: join(library, 'backups')
			},
			stdio: 'ignore'
		});
		for (let i = 0; i < 120; i++) {
			try {
				if ((await fetch(base, { redirect: 'manual' })).status) return;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		throw new Error('the empty library preview never answered');
	});

	test.afterAll(() => {
		server?.kill();
		rmSync(dbPath, { force: true });
		rmSync(library, { recursive: true, force: true });
	});

	test('a phone pairing ticks 04 on the open list, with no reload', async ({ page }) => {
		test.setTimeout(60_000);
		await page.goto(`${base}/`);
		await expect(four(page)).toBeVisible();
		await expect(four(page)).not.toHaveClass(/\bdone\b/);
		const loads: string[] = [];
		page.on('request', (q) => {
			if (q.isNavigationRequest() && q.frame() === page.mainFrame()) loads.push(q.url());
		});
		// What pairing writes (`addPaired`): friend-pair-firefox.e2e.ts walks the
		// real link to it; here the list's own asking is what is under test.
		sql(
			`INSERT INTO paired_devices (token_hash, label, address, paired_at, seen_at)
			VALUES ('e2e-library', 'Phone', '192.168.1.21', ?, ?)`,
			Date.now(),
			Date.now()
		);
		// Within one 5 s ask and its answer, with room for a loaded box.
		await expect(four(page)).toHaveClass(/\bdone\b/, { timeout: 15_000 });
		await expect(four(page)).toContainText('Done · a phone or tablet reads here', {
			ignoreCase: true
		});
		expect(loads).toEqual([]);
	});

	test('it asks only while the list is drawn: not after the page is left, the library fills, or on a library with series', async ({
		page
	}) => {
		test.setTimeout(60_000);
		await page.clock.install();
		const seen = asks(page);
		await page.goto(`${base}/`);
		await expect(four(page)).toBeVisible();

		// Drawn: a period asks. At least once: `pollStart` also asks when the
		// window regains focus, and beside other workers' browsers it may.
		await page.clock.runFor(5_100);
		await expect.poll(() => seen.length).toBeGreaterThanOrEqual(1);

		// Left, client-side (the effect torn down, not a fresh page): nothing
		// asks from /search, by the interval or by focus.
		await page.getByRole('link', { name: 'Search' }).click();
		await page.waitForURL(/\/search/);
		await page.clock.runFor(11_000);
		await page.getByRole('link', { name: 'Back to library' }).click();
		await expect(four(page)).toBeVisible();
		expect(seen.filter((u) => new URL(u).pathname.startsWith('/search'))).toEqual([]);

		// Back on the list it asks again; the library fills, and the ask that
		// brings the grid is the last one.
		const back = seen.length;
		sql(
			`INSERT INTO series (root_id, title, kind, hue, added_at, indexed_at)
			VALUES ((SELECT MIN(id) FROM roots), 'Filled While Open', 'manga', 0, ?, ?)`,
			Date.now(),
			Date.now()
		);
		await page.clock.runFor(5_100);
		await expect(page.locator('.grid .tile', { hasText: 'Filled While Open' })).toBeVisible();
		await expect(four(page)).toHaveCount(0);
		const filled = seen.length;
		expect(filled).toBeGreaterThan(back);
		await page.clock.runFor(11_000);
		expect(seen.length).toBe(filled);

		// A library with series, opened afresh: no list, no asking.
		await page.goto(`${base}/`);
		await expect(page.locator('.grid .tile').first()).toBeVisible();
		const before = seen.length;
		await page.clock.runFor(11_000);
		expect(seen.length).toBe(before);
	});
});
