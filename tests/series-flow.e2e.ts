import { type Page } from '@playwright/test';
import { expect, test } from './helpers/hydrated';

/**
 * The series screen end to end, on the seeded library. Writes run serially on
 * the tablet project only (the others ignore `*-flow.e2e.ts`), and each test
 * restores what it changed.
 */
test.describe.configure({ mode: 'serial' });

// Flow files run in parallel with each other against one database, so each
// owns its series: this file touches Mount Hua, Tower of God, Ame no Hi and
// Lookism, and nothing else. See doc/TESTING.md.

async function open(page: Page, title: string, shelf = 'all') {
	await page.goto(
		shelf === 'all' ? '/?sort=title' : `/?shelf=${encodeURIComponent(shelf)}&sort=title`
	);
	// Under the full parallel run hydration can trail the load event.
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: title }).click();
	// The title shows at once from the tile (doc/WAITING.md): wait for the
	// screen itself, which is there once the URL has moved.
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('a tap on a tile opens the series, and back returns to the shelf it came from', async ({
	page
}) => {
	await page.goto('/?sort=title');
	await page.getByRole('link', { name: /^TO FINISH/ }).click();
	await expect(page).toHaveURL(/shelf=c%3A\d+/);
	await page.locator('.grid .tile', { hasText: 'Return of the Mount Hua Sect' }).click();
	await expect(page).toHaveURL(/\/series\/\d+\?from=c%3A\d+/);
	await expect(page.getByRole('link', { name: /TO FINISH/ })).toBeVisible();
	await page.getByRole('link', { name: /TO FINISH/ }).click();
	await expect(page).toHaveURL(/\?shelf=c%3A\d+/);
});

test('rating fills up to the choice, 0 clears it, and FAV toggles', async ({ page }) => {
	await open(page, 'Return of the Mount Hua Sect');
	const panel = page.getByRole('region', { name: 'About this series' });
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();

	await panel.getByRole('button', { name: 'Rate 6 of 10' }).click();
	await expect(panel.getByText('RATING', { exact: true })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Rate 6 of 10' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.reload();
	await expect(panel.getByRole('button', { name: 'Rate 6 of 10' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	await panel.getByRole('button', { name: 'Unrated' }).click();
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();

	await panel.getByRole('button', { name: 'FAV', exact: true }).click();
	await expect(panel.getByRole('button', { name: 'FAV ✓' })).toBeVisible();
	await panel.getByRole('button', { name: 'FAV ✓' }).click();
	await expect(panel.getByRole('button', { name: 'FAV', exact: true })).toBeVisible();
});

/**
 * Hold the first POST of `?/<action>` until `release()` (or abort it, or
 * every one after the first), and count the answers the page got.
 * The held one reaches the server only once released, so on a page that sends
 * both taps at once the second is stored first: the order a slow network gives.
 */
async function holdFirst(
	page: Page,
	action: 'favourite' | 'rate',
	after: 'pass' | 'abort' = 'pass'
) {
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	let first = true;
	let answered = 0;
	let asked = 0;
	let most = 0;
	const isAction = (u: URL) => /^\/series\/\d+$/.test(u.pathname) && u.search === `?/${action}`;
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
		/** The most saves the page had out at once. */
		most: () => most,
		done: async () => page.unroute(isAction)
	};
}

test('two quick FAV taps with the first save slow end on the second tap, after a reload too', async ({
	page
}) => {
	await open(page, 'Return of the Mount Hua Sect');
	const panel = page.getByRole('region', { name: 'About this series' });
	const fav = panel.getByRole('button', { name: 'FAV', exact: true });
	const faved = panel.getByRole('button', { name: 'FAV ✓' });
	await expect(fav).toBeVisible();
	const h = await holdFirst(page, 'favourite');
	await fav.click();
	await faved.click();
	await expect(fav).toBeVisible();
	h.release();
	await expect.poll(h.answered).toBe(2);
	await expect(fav).toBeVisible();
	await page.reload();
	await expect(panel.getByRole('button', { name: 'FAV', exact: true })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'FAV ✓' })).toHaveCount(0);
	// The second waited for the first: never two out at once.
	expect(h.most()).toBe(1);
	await h.done();
});

test('three quick rating taps with the first slow store the third, and a lost first save is no band', async ({
	page
}) => {
	await open(page, 'Return of the Mount Hua Sect');
	const panel = page.getByRole('region', { name: 'About this series' });
	const pressed = (n: number) =>
		expect(panel.getByRole('button', { name: `Rate ${n} of 10` })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();
	const h = await holdFirst(page, 'rate');
	await panel.getByRole('button', { name: 'Rate 6 of 10' }).click();
	await panel.getByRole('button', { name: 'Rate 8 of 10' }).click();
	await panel.getByRole('button', { name: 'Rate 3 of 10' }).click();
	await pressed(3);
	h.release();
	// 8 was superseded before its turn: never sent, so two answers, not three.
	await expect.poll(h.answered).toBe(2);
	await pressed(3);
	await page.reload();
	await pressed(3);
	expect(h.most()).toBe(1);
	await h.done();

	// The first save lost (aborted) while the second waits: the second is stored, no band.
	let first = true;
	const isRate = (u: URL) => /^\/series\/\d+$/.test(u.pathname) && u.search === '?/rate';
	await page.route(isRate, (route) => {
		if (!first) return route.continue();
		first = false;
		return route.abort();
	});
	await panel.getByRole('button', { name: 'Rate 9 of 10' }).click();
	await panel.getByRole('button', { name: 'Unrated' }).click();
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();
	await page.reload();
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();
	await expect(page.getByText(/NOT SAVED/)).toHaveCount(0);
	await page.unroute(isRate);
});

test('the last of two taps failing names what is stored now, and PUT BACK shows it', async ({
	page
}) => {
	await open(page, 'Return of the Mount Hua Sect');
	const panel = page.getByRole('region', { name: 'About this series' });
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();
	const h = await holdFirst(page, 'rate', 'abort');
	await panel.getByRole('button', { name: 'Rate 6 of 10' }).click();
	await panel.getByRole('button', { name: 'Rate 3 of 10' }).click();
	h.release();
	// 6 was stored before 3 was lost: PUT BACK goes to 6, not to the 0 the page first loaded.
	await expect(page.getByText('RATING 3 NOT SAVED')).toBeVisible();
	await page.getByRole('button', { name: 'PUT BACK 6' }).click();
	await expect(page.getByText('RATING 3 NOT SAVED')).toHaveCount(0);
	await expect(panel.getByRole('button', { name: 'Rate 6 of 10' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await h.done();
	await panel.getByRole('button', { name: 'Unrated' }).click();
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();
	await page.reload();
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();
});

test.describe('a tap during the earlier tap’s reload', () => {
	// The service worker answers `__data.json` past `page.route`, and
	// this case holds the page's reload by its `__data.json`.
	test.use({ serviceWorkers: 'block' });

	test('a tap whose save fails while the earlier tap reloads keeps its band, and PUT BACK shows what is stored', async ({
		page
	}) => {
		await open(page, 'Return of the Mount Hua Sect');
		const panel = page.getByRole('region', { name: 'About this series' });
		const fav = panel.getByRole('button', { name: 'FAV', exact: true });
		const faved = panel.getByRole('button', { name: 'FAV ✓' });
		await expect(fav).toBeVisible();

		// The first FAV POST goes through; every later one is lost on the wire.
		const isFav = (u: URL) => /^\/series\/\d+$/.test(u.pathname) && u.search === '?/favourite';
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
		const isData = (u: URL) => /^\/series\/\d+\/__data\.json$/.test(u.pathname);
		await page.route(isData, async (route) => {
			if (reloadAsked) return route.continue();
			reloadAsked = true;
			await reloadHeld;
			return route.continue();
		});

		await fav.click();
		await expect.poll(() => firstAnswered && reloadAsked).toBe(true);
		// UNFAV, while FAV's reload is still out.
		await faved.click();
		await expect(fav).toBeVisible();
		releaseReload();

		// FAV is what is stored: the band says UNFAV was not, and PUT BACK goes to FAV.
		await expect(page.getByText('UNFAV NOT SAVED')).toBeVisible();
		await page.getByRole('button', { name: 'PUT BACK · FAV' }).click();
		await expect(page.getByText('UNFAV NOT SAVED')).toHaveCount(0);
		await expect(faved).toBeVisible();
		expect(posts).toBe(2);
		await page.unroute(isFav);
		await page.unroute(isData);
		await page.reload();
		await expect(faved).toBeVisible();

		// Put it back as the seed has it.
		await faved.click();
		await expect(fav).toBeVisible();
		await page.reload();
		await expect(fav).toBeVisible();
	});
});

test('direction is stored per series', async ({ page }) => {
	await open(page, 'Return of the Mount Hua Sect');
	const ltr = page.getByRole('button', { name: 'L→R' });
	await ltr.click();
	await expect(ltr).toHaveAttribute('aria-pressed', 'true');
	await page.reload();
	await expect(page.getByRole('button', { name: 'L→R' })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: '↓ SCROLL' }).click();
	await expect(page.getByRole('button', { name: '↓ SCROLL' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('tags are added from a suggestion and removed with ✕', async ({ page }) => {
	await open(page, 'Return of the Mount Hua Sect');
	await page.getByRole('button', { name: 'EDIT' }).nth(1).click();
	const sheet = page.getByRole('dialog', { name: 'Shelves and tags' });
	await sheet.getByRole('textbox', { name: /Add a tag/ }).fill('genre:ise');
	await sheet.getByRole('button', { name: /genre\s+isekai/ }).click();
	await expect(sheet.getByRole('button', { name: 'Remove genre:isekai' })).toBeVisible();
	await sheet.getByRole('button', { name: 'DONE' }).click();
	// By role: TAGS is drawn twice, one copy for each order of the rows, the
	// other hidden by the layout (SeriesPanel's tagsGroup).
	await expect(
		page.getByRole('region', { name: 'About this series' }).getByRole('link', { name: 'isekai' })
	).toBeVisible();

	await page.getByRole('button', { name: 'EDIT' }).nth(1).click();
	await sheet.getByRole('button', { name: 'Remove genre:isekai' }).click();
	await expect(sheet.getByRole('button', { name: 'Remove genre:isekai' })).toHaveCount(0);
});

test('multi-select marks a range read, counting what it will change', async ({ page }) => {
	await open(page, 'Return of the Mount Hua Sect');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const row = (n: number) => page.locator(`.entry:has(.num:text-is("${n}")) .entry-btn`);
	await row(90).click();
	await page.getByRole('button', { name: 'RANGE' }).click();
	await row(93).click();
	await expect(page.getByText('4 SELECTED')).toBeVisible();
	const markRead = page.getByRole('button', { name: /MARK READ/ });
	await expect(markRead).toContainText('4');
	await markRead.click();
	await expect(page.getByRole('button', { name: /MARK UNREAD/ })).toContainText('4');
	await page.getByRole('button', { name: /MARK UNREAD/ }).click();
	await expect(markRead).toContainText('4');
});

test('a long press on a chapter reads everything up to it, and UNDO puts it back', async ({
	page
}) => {
	await open(page, 'Return of the Mount Hua Sect');
	const row = (n: number) => page.locator(`.entry:has(.num:text-is("${n}")) .entry-btn`);
	const unread = await page.locator('.entry.unread').count();
	await row(95).click({ button: 'right' }); // the context menu is the long press
	await expect(page.getByText('MARKED READ THROUGH CH. 95')).toBeVisible();
	await expect(page).toHaveURL(/\/series\/\d+/);
	await expect(page.locator('.entry:has(.num:text-is("95"))')).not.toHaveClass(/unread/);
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.getByText('MARKED READ THROUGH CH. 95')).toHaveCount(0);
	await expect(page.locator('.entry.unread')).toHaveCount(unread);
});

test('# jumps into the fold and opens it', async ({ page }) => {
	await open(page, 'Tower of God');
	await expect(page.getByRole('button', { name: /↑ 1 – 591/ })).toBeVisible();
	await page.getByRole('button', { name: 'Go to chapter number' }).click();
	await page.getByLabel('GO TO #').fill('540');
	await page.getByLabel('GO TO #').press('Enter');
	await expect(page.locator('#entry-' + (await entryId(page, 540)))).toBeInViewport();
	await expect(page.getByRole('button', { name: /↑ 1 – 591/ })).toHaveCount(0);
});

async function entryId(page: Page, n: number) {
	return page
		.locator(`.entry:has(.num:text-is("${n}"))`)
		.evaluate((el) => el.id.replace('entry-', ''));
}

test('hiding a series with reveal off leaves it, and it is then unreachable', async ({ page }) => {
	await open(page, 'Ame no Hi no Toshokan');
	const url = page.url();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(page).toHaveURL('/');
	const res = await page.request.get(url);
	expect(res.status()).toBe(404);

	// Restore: reveal, unhide from the series screen, end reveal.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	// /reveal asks the server whether a fingerprint is needed before it goes.
	await page.waitForURL(/\/$/);
	await page.goto(url);
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(page.getByRole('button', { name: 'HIDE', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	expect((await page.request.get(url)).status()).toBe(200);
});

test('a tapped suggestion wins over the half-typed text beside it', async ({ page }) => {
	await open(page, 'Lookism');
	await page.getByRole('button', { name: 'EDIT' }).nth(1).click();
	const sheet = page.getByRole('dialog', { name: 'Shelves and tags' });
	await sheet.getByRole('textbox', { name: /Add a tag/ }).fill('genre:ise');
	await sheet.getByRole('button', { name: /genre\s+isekai/ }).click();
	await expect(sheet.getByRole('button', { name: 'Remove genre:isekai' })).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Remove genre:ise', exact: true })).toHaveCount(0);
	await sheet.getByRole('button', { name: 'Remove genre:isekai' }).click();
	await expect(sheet.getByRole('button', { name: 'Remove genre:isekai' })).toHaveCount(0);
});

test('the cover resumes, as ▶ CONTINUE does', async ({ page }) => {
	await open(page, 'Tower of God');
	const cta = await page
		.getByRole('link', { name: /▶ (CONTINUE|START|READ)/ })
		.first()
		.getAttribute('href');
	const cover = page.locator('.panel a.cover');
	await expect(cover).toHaveAttribute('href', cta!);
	await cover.click();
	await page.waitForURL(/\/read\/\d+/);
});

// ---- Two failed saves on one screen (doc/WAITING.md, "Writes that fail") ----
// Each is its own control's real save, lost on the wire with `page.route`, and
// each keeps its own band, PUT BACK and RETRY through a navigation. Here, not
// in a file of its own: its RETRY really stores Mount Hua's FAV, which this
// file's FAV cases read, and as two flow files they ran at once and one saw
// the other's FAV ✓ ("two quick FAV taps…" could not find FAV).

const MOUNT_HUA = 'Return of the Mount Hua Sect';

const seriesAction = (action: string) => (u: URL) =>
	/^\/series\/\d+$/.test(u.pathname) && u.search === `?/${action}`;

const failBand = (page: Page, text: string) => page.locator('[role="alert"]', { hasText: text });
const seriesPanel = (page: Page) => page.getByRole('region', { name: 'About this series' });

test('two failed fields on the series screen each keep PUT BACK and RETRY, through a navigation', async ({
	page
}) => {
	const lostFav = seriesAction('favourite');
	const lostRate = seriesAction('rate');
	await page.route(lostFav, (route) => route.abort());
	await page.route(lostRate, (route) => route.abort());

	await page.goto('/?shelf=all&sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: MOUNT_HUA }).click();
	await page.waitForURL(/\/series\/\d+/);
	const panel = seriesPanel(page);
	const fav = panel.getByRole('button', { name: /^FAV( ✓)?$/ });
	const wasFav = await fav.getAttribute('aria-pressed');
	// A value the seed does not hold, so the tap is a change.
	const rate = panel.getByRole('button', { name: 'Rate 3 of 10' });
	const rated = (await rate.getAttribute('aria-pressed')) === 'true';
	const value = rated ? 4 : 3;
	const favText = wasFav === 'true' ? 'UNFAV NOT SAVED' : 'FAV NOT SAVED';
	const rateText = `RATING ${value} NOT SAVED`;

	await fav.click();
	await expect(failBand(page, favText)).toHaveCount(1);
	await panel.getByRole('button', { name: `Rate ${value} of 10` }).click();
	await expect(failBand(page, rateText)).toHaveCount(1);
	// The second failure did not take the first one's band.
	await expect(failBand(page, favText)).toHaveCount(1);
	await expect(page.locator('[role="alert"]')).toHaveCount(2);
	for (const text of [favText, rateText]) {
		await expect(failBand(page, text).getByRole('button', { name: /PUT BACK/ })).toBeVisible();
		await expect(failBand(page, text).getByRole('button', { name: 'RETRY' })).toBeVisible();
	}

	// Away and back, the nudge retrying and losing each time.
	await page.goBack();
	await expect(page.locator('.grid .tile', { hasText: MOUNT_HUA })).toBeAttached();
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
	await expect(failBand(page, favText).getByRole('button', { name: 'RETRY' })).toBeVisible();
	await expect(failBand(page, rateText).getByRole('button', { name: /PUT BACK/ })).toBeVisible();

	// RETRY lands for FAV alone: the rating's band is still up.
	await page.unroute(lostFav);
	const stored = page.waitForResponse((r) => /\/series\/\d+\?\/favourite$/.test(r.url()) && r.ok());
	await failBand(page, favText).getByRole('button', { name: 'RETRY' }).click();
	await stored;
	await expect(failBand(page, favText)).toHaveCount(0);
	await expect(failBand(page, rateText)).toHaveCount(1);

	// PUT BACK ends the rating's alone, and its value comes back.
	await failBand(page, rateText)
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
	await expect(seriesPanel(page).getByRole('button', { name: /^FAV( ✓)?$/ })).toHaveAttribute(
		'aria-pressed',
		wasFav!
	);
});
