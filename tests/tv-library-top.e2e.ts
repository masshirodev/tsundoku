import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The library's top on a TV (doc/LIBRARY.md, "Sort and direction" and "The
 * top bar"): SORT's menu walked by the remote alone (c432). The `tv` project
 * has no pointer, so every press is a key. BACK from deep in the grid lands
 * at the top and stays there, sampled every frame for 2 s (c543). OK on a
 * shelf tab keeps the mark on the tab row (c589; a remote meets the tabs at
 * the top, so the case guards the mark, not the scroll). Sorting and shelves
 * only change the URL:
 * nothing here writes to the database the flow files share.
 */

const focused = (page: Page) =>
	page.evaluate(() => {
		const a = document.activeElement as HTMLElement | null;
		return (a?.getAttribute('aria-label') ?? a?.textContent ?? '').trim();
	});

/**
 * From the screen's start to SORT's cell, the way a remote gets there. Since
 * c436 the tabs take the width and FILTER is the KIND band's last cell, at the
 * right edge under SORT: down to the band, along it to FILTER, then up.
 */
async function toSort(page: Page) {
	await page.keyboard.press('ArrowDown'); // the screen's start, the first CONTINUE card
	await page.keyboard.press('ArrowDown'); // the shelf tabs
	await page.keyboard.press('ArrowDown'); // the KIND band
	await expect.poll(() => focused(page)).toMatch(/^ALL/);
	// Along the band to the last, FILTER, under the sort.
	let last = '';
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press('ArrowRight');
		const now = await focused(page);
		if (now === last) break;
		last = now;
	}
	// Up lands in the SORT block: on SORT, or on ↓ / ↑ beside it, then left.
	// The tabs run under SORT once the flow files beside this one have made
	// shelves enough on the shared database, so up may stop on them first.
	for (let i = 0; i < 3; i++) {
		await page.keyboard.press('ArrowUp');
		if (/^Sort, |^Reverse order$/.test(await focused(page))) break;
	}
	await expect.poll(() => focused(page)).toMatch(/^Sort, |^Reverse order$/);
	if ((await focused(page)) === 'Reverse order') await page.keyboard.press('ArrowLeft');
	await expect.poll(() => focused(page)).toMatch(/^Sort, /);
}

/** Whether the focused element is what the page draws at its own centre, nothing over it. */
const drawnAtCentre = (page: Page) =>
	page.evaluate(() => {
		const a = document.activeElement;
		if (!a) return false;
		const r = a.getBoundingClientRect();
		const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return !!hit && a.contains(hit);
	});

test('the remote reaches SORT, OK opens it on the choice in use, and the pad walks every choice', async ({
	page
}) => {
	await page.goto('/?sort=title');
	await toSort(page);
	const menu = page.getByRole('menu', { name: 'Sort' });

	await page.keyboard.press('Enter');
	await expect(menu).toBeVisible();
	await expect.poll(() => focused(page)).toBe('TITLE');
	// Up to the first, then down through every one, in SORTS' order.
	for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
	await expect.poll(() => focused(page)).toBe('RECENTLY READ');
	const walked = [await focused(page)];
	const drawn = [await drawnAtCentre(page)];
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('ArrowDown');
		walked.push(await focused(page));
		drawn.push(await drawnAtCentre(page));
	}
	// Each choice the mark is on is what the screen draws there: the KIND
	// band (9 on a TV) steps under the open list (c590).
	expect(drawn).toEqual(walked.map(() => true));
	expect(walked).toEqual([
		'RECENTLY READ',
		'RECENTLY ADDED',
		'PROGRESS',
		'TITLE',
		'RATING',
		'RANDOM'
	]);
	// The list keeps the pad: past the last there is nowhere, and the screen
	// under it takes nothing.
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => focused(page)).toBe('RANDOM');
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => focused(page)).toBe('RANDOM');

	// BACK closes it without choosing, and the mark is on the cell again.
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect.poll(() => focused(page)).toBe('Sort, TITLE');
	expect(page.url()).toMatch(/sort=title/);

	// OK picks: RATING, and focus comes back to the cell, which now says so.
	await page.keyboard.press('Enter');
	await expect.poll(() => focused(page)).toBe('TITLE');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/sort=rating/);
	await expect(menu).toBeHidden();
	await expect.poll(() => focused(page)).toBe('Sort, RATING');
});

test('OK on another shelf tab keeps the mark on the tab row (c589)', async ({ page }) => {
	// A remote meets the tabs at the screen's start (BACK from the grid climbs
	// past the pinned band to the first CONTINUE card), so what a TV needs of
	// c589 is that the shelf's links scrolling to the top keep the mark. The
	// page is at 0 before OK as well as after, so the scrollY read below
	// cannot fail on c589's own change (it passes with noscroll put back,
	// measured): this case guards keepfocus. The scroll is the device
	// projects' (library-top-scroll.e2e.ts, c589).
	await page.goto('/?sort=title');
	const onTab = () =>
		page.evaluate(() => document.activeElement?.getAttribute('data-focus-id') ?? '');
	await page.keyboard.press('ArrowDown'); // the screen's start
	await page.keyboard.press('ArrowDown'); // the shelf tabs
	await expect.poll(onTab).toMatch(/^shelf-/);
	await page.keyboard.press('ArrowRight');
	await expect.poll(onTab).toMatch(/^shelf-(?!all$)/);
	const picked = await onTab();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/shelf=/);
	await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
	await expect.poll(onTab).toBe(picked);
});

test('← from the first collection’s tab reaches ALL (c624)', async ({ page }) => {
	// Filed while c589's case above was written, as a layer bug: ← from the
	// first collection stayed on it while the second's reached the first. At
	// aa6a7b22 it does not: measured, ALL's box is 49-144 and the first
	// collection's starts at 144, so the layer's half-pixel slack already reads
	// it as "left of it" (`isInDirection`, geometry.ts). This case keeps the
	// walk the card names, so the state cannot come back silently.
	await page.goto('/?sort=title');
	const onTab = () =>
		page.evaluate(() => document.activeElement?.getAttribute('data-focus-id') ?? '');
	await page.keyboard.press('ArrowDown'); // the screen's start
	await page.keyboard.press('ArrowDown'); // the shelf tabs
	await expect.poll(onTab).toMatch(/^shelf-/);
	// Back along the row to ALL wherever the CONTINUE row put the mark, then one
	// right: the first collection even if this seed's rows land elsewhere.
	for (let i = 0; i < 8 && (await onTab()) !== 'shelf-all'; i++)
		await page.keyboard.press('ArrowLeft');
	await expect.poll(onTab).toBe('shelf-all');
	await page.keyboard.press('ArrowRight');
	const picked = await onTab();
	expect(picked).toMatch(/^shelf-c:/);
	// The first collection, not one further along: no collection before it in
	// the row a TV draws (the desktop sidebar's own tabs are in the DOM too).
	const order = await page.evaluate((id) => {
		const row = [...document.querySelectorAll<HTMLElement>('.tabs nav')].find(
			(nav) => nav.getBoundingClientRect().width > 0
		);
		const ids = [...(row?.querySelectorAll<HTMLElement>('.tab') ?? [])].map(
			(t) => t.dataset.focusId
		);
		return { at: ids.indexOf(id), first: ids.findIndex((k) => k?.startsWith('shelf-c:')) };
	}, picked);
	expect(order.at).toBe(order.first);
	// OK picks it, and ← goes back to ALL.
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/shelf=c/);
	await expect.poll(onTab).toBe(picked);
	await page.keyboard.press('ArrowLeft');
	await expect.poll(onTab).toBe('shelf-all');
});

/**
 * c612: the outline is drawn instead of the grid (`{#if outlined}`), so a
 * tile that holds the mark when a filter starts is unmounted and the mark
 * falls to `<body>`. The library page notes the tile and gives it back, or the
 * KIND band's chosen cell when the filter takes the tile away (c612; the
 * patch was written in doc/handoff-notes/tv.md, wave 27, Gaps). Each step is
 * asserted, so a setup that never put the mark on a tile cannot pass.
 */
test.describe('a tile focused while the grid becomes an outline (c612)', () => {
	test.use({ serviceWorkers: 'block' });

	/** Hold the library's data (for a KIND filter, or the bare URL), from now on, once. */
	async function holdData(page: Page, pattern: string) {
		let release: () => void = () => undefined;
		const held = new Promise<void>((r) => (release = r));
		await page.route(pattern, async (route) => {
			await held;
			await route.continue().catch(() => undefined);
		});
		return { release };
	}

	const mark = (page: Page) =>
		page.evaluate(() => document.activeElement?.getAttribute('data-focus-id') ?? '');

	/** From the screen's start, past the tabs and the KIND band, to the grid's first tile. */
	async function toFirstTile(page: Page, url: string) {
		await page.goto(url);
		await page.keyboard.press('ArrowDown'); // the screen's start
		await page.keyboard.press('ArrowDown'); // the shelf tabs
		await page.keyboard.press('ArrowDown'); // the KIND band
		await page.keyboard.press('ArrowDown'); // the first tile
		await expect.poll(() => mark(page)).toMatch(/^(series|work)-/);
		return mark(page);
	}

	test('a KIND filter chosen under a focused tile gives the mark back (c612)', async ({ page }) => {
		// At DOUJINS, so the first tile is a doujin, and ALL keeps it: the
		// give-back's first branch, the tile itself.
		const tile = await toFirstTile(page, '/?shelf=all&kind=doujin&sort=title');
		// ALL's link from a kind shelf is the bare library URL.
		const { release } = await holdData(page, '**/__data.json*');

		// A press on a band cell starts the navigation without moving the mark
		// off the tile (the pad's own cell keeps the mark only when it is the
		// pad that presses it; a pointer's tap focuses nothing on a TV, and an
		// element-made click is that tap's path).
		await page.evaluate(() =>
			(document.querySelector('[data-focus-id="kind-all"]') as HTMLElement | null)?.click()
		);
		// Still on the tile until the outline draws: the navigation has not
		// unmounted the grid yet.
		expect(await mark(page)).toBe(tile);
		// The outline is the library's own waiting state: LOADING beside SORT,
		// and the real tiles gone (c560 kept SORT drawn; the grid is outline).
		await expect(page.getByText('LOADING', { exact: true })).toBeVisible({ timeout: 15_000 });
		await expect(page.locator('.grid .tile .open')).toHaveCount(0);
		// The red: nothing else is left to hold it.
		expect(await mark(page)).toBe('');
		release();
		await expect(page).not.toHaveURL(/kind=/);
		await expect(page).toHaveURL(/sort=title/);
		await expect(page.locator('.grid .tile .open').first()).toBeVisible();
		// The tile the filter kept is where the mark goes back.
		await expect.poll(() => mark(page)).toBe(tile);
	});

	test('a KIND filter that takes the tile away leaves the mark on its cell (c612)', async ({
		page
	}) => {
		// At MANGA, so the first tile is a manga and NOVELS takes it away.
		const tile = await toFirstTile(page, '/?shelf=all&kind=manga&sort=title');
		const { release } = await holdData(page, '**/__data.json?*kind=novel*');
		await page.evaluate(() =>
			(document.querySelector('[data-focus-id="kind-novel"]') as HTMLElement | null)?.click()
		);
		expect(await mark(page)).toBe(tile);
		await expect(page.getByText('LOADING', { exact: true })).toBeVisible({ timeout: 15_000 });
		await expect(page.locator('.grid .tile .open')).toHaveCount(0);
		expect(await mark(page)).toBe('');
		release();
		await expect(page).toHaveURL(/kind=novel/);
		await expect(page.locator('.grid .tile .open').first()).toBeVisible();
		await expect(page.locator(`[data-focus-id="${tile}"]`)).toHaveCount(0);
		await expect.poll(() => mark(page)).toBe('kind-novel');
	});
});

test.describe('a sort that takes past 1 s', () => {
	// The service worker answers `__data.json` itself once it controls the
	// page, past page.route (doc/TESTING.md, "Load").
	test.use({ serviceWorkers: 'block' });

	/** Hold the library's data for `ms` when the URL asks for `query`. */
	const slow = (page: Page, query: string, ms: number) =>
		page.route(`**/__data.json?*${query}*`, async (route) => {
			await new Promise((r) => setTimeout(r, ms));
			await route.continue().catch(() => undefined);
		});

	/** From now on, every frame: whether the label says LOADING, and whether the mark is in SORT. */
	const watchFocus = (page: Page) =>
		page.evaluate(() => {
			const w = window as unknown as { seen: { loading: boolean; inSort: boolean }[] };
			w.seen = [];
			const frame = () => {
				const loading = [...document.querySelectorAll('.right')].some((r) =>
					r.textContent?.includes('LOADING')
				);
				w.seen.push({ loading, inSort: !!document.activeElement?.closest('.sort') });
				if (w.seen.length < 100_000) requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		});
	const framesSeen = (page: Page) =>
		page.evaluate(
			() => (window as unknown as { seen: { loading: boolean; inSort: boolean }[] }).seen
		);

	test('SORT stays drawn under the outline’s LOADING, and the mark never leaves it (c560)', async ({
		page
	}) => {
		// What loaded runs did to `:49` 4 times in 10, forced: the outline goes
		// up at 1 s with the cell focused. Until c560 it put LOADING in SORT's
		// place, the focused cell left the page and the mark was on the body
		// until SORT came back (wave 24 gave it back afterwards).
		await page.goto('/?sort=title');
		await toSort(page);
		await slow(page, 'sort=rating', 2500);
		await page.keyboard.press('Enter');
		await expect.poll(() => focused(page)).toBe('TITLE');
		await page.keyboard.press('ArrowDown');
		await watchFocus(page);
		await page.keyboard.press('Enter');
		await expect(page.getByText('LOADING', { exact: true })).toBeVisible();
		// Drawn, dimmed, and the cell with the mark: OK or ↓ now still lands.
		await expect(page.locator('.sort')).toHaveCount(1);
		await expect(page.locator('.sort')).toHaveAttribute('aria-busy', 'true');
		await expect(page).toHaveURL(/sort=rating/);
		await expect(page.locator('.sort')).not.toHaveAttribute('aria-busy', 'true');
		await expect.poll(() => focused(page)).toBe('Sort, RATING');
		const sorting = await framesSeen(page);
		expect(sorting.filter((f) => f.loading).length, 'frames under LOADING').toBeGreaterThan(0);
		expect(
			sorting.filter((f) => !f.inSort),
			'frames with the mark off SORT'
		).toEqual([]);

		// ↓ / ↑ beside it, the same way.
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => focused(page)).toBe('Reverse order');
		await slow(page, 'dir=', 2500);
		await watchFocus(page);
		await page.keyboard.press('Enter');
		await expect(page.getByText('LOADING', { exact: true })).toBeVisible();
		await expect(page).toHaveURL(/dir=/);
		await expect(page.locator('.sort')).not.toHaveAttribute('aria-busy', 'true');
		await expect.poll(() => focused(page)).toBe('Reverse order');
		const turning = await framesSeen(page);
		expect(turning.filter((f) => f.loading).length, 'frames under LOADING').toBeGreaterThan(0);
		expect(
			turning.filter((f) => !f.inSort),
			'frames with the mark off SORT'
		).toEqual([]);
	});
});

/**
 * How far the focused cover's ring (7px outside it, `--focus-ring`) is clear
 * of every bar pinned over that column: the top bar, the shelf tabs (pinned
 * until c436), the KIND band (pinned in their place since) and the focus
 * line. Negative is covered.
 */
const ringClear = (page: Page) =>
	page.evaluate(() => {
		const cover = document.activeElement?.querySelector('.cover');
		if (!cover) return null;
		const c = cover.getBoundingClientRect();
		const pinned = [
			...document.querySelectorAll<HTMLElement>('header.bar, .tabs, .kinds, .focus-line')
		]
			.filter((el) => ['sticky', 'fixed'].includes(getComputedStyle(el).position))
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.width > 0 && r.left < c.right && r.right > c.left && r.top < c.top);
		const under = Math.max(0, ...pinned.map((r) => r.bottom));
		return c.top - 7 - under;
	});

test('the pinned bars never cover the first row’s focus ring, and BACK from deep in the grid is back at the top', async ({
	page
}) => {
	// About twenty-five key presses after a cold load: measured at 34.6 s in a
	// loaded run (load ~55: the goto 11.5 s, hydration 3.3 s, each press
	// 0.1-0.8 s), every step on the right state, against the default 30 s (c439).
	test.setTimeout(60_000);
	await page.goto('/?sort=title');
	await page.keyboard.press('ArrowDown'); // the screen's start
	await page.keyboard.press('ArrowDown'); // the shelf tabs
	await page.keyboard.press('ArrowDown'); // the KIND band (c436): one stop more
	await page.keyboard.press('ArrowDown'); // the first row
	const firstRow = await page.evaluate(
		() => document.activeElement?.closest('.tile')?.getBoundingClientRect().top
	);
	expect(await ringClear(page)).toBeGreaterThanOrEqual(0);

	// Down three rows and back up to the first: still clear of the bars.
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
	expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
	for (let i = 0; i < 3; i++) {
		await page.keyboard.press('ArrowUp');
		expect(await ringClear(page)).toBeGreaterThanOrEqual(0);
	}
	expect(firstRow).toBeDefined();

	// A TV needs no BACK TO TOP (c433): one BACK from the bottom of the grid
	// is at the top of the screen, on its first CONTINUE card.
	for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
	expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
	await expect(page.getByRole('button', { name: 'BACK TO TOP ↑' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect.poll(() => focused(page)).toMatch(/^Resume /);
	// And it comes to rest there (c543): every frame for 2 s, not one read. A
	// single poll passed the first time it caught the top, so it could not see
	// a page that went on moving (wave 21 measured 0, 0, 3, 0, 0, 3… here).
	// Within a few pixels of the top, as before, since the flow files beside
	// this one hide and restore series on the same grid (2px once, under a
	// loaded run on wave 22's base); but the same few pixels all the way.
	const frames = await stillFor(page, 2_000);
	expect(frames.length, 'frames sampled in 2 s').toBeGreaterThan(20);
	expect([...new Set(frames)], 'scrollY over 2 s after BACK').toHaveLength(1);
	expect(frames[0]).toBeLessThanOrEqual(8);
	await expect.poll(() => focused(page)).toMatch(/^Resume /);
});

/**
 * The loaded runs' red, made on purpose (c543): ↓ on the last row has no stop
 * below it, and the page used to leave that key to the browser, whose own
 * scroll is animated. BACK pressed while it was still moving put the page at
 * the top (`climb()`'s instant `scrollTo(0)`), and then the animation's
 * remaining distance was applied from there: 33 px in one loaded run, 2 in
 * another. On a TV the layer now scrolls for that key itself, instantly.
 */
test('BACK pressed while ↓ past the last row still scrolls lands at the top and stays (c543)', async ({
	page
}) => {
	test.setTimeout(60_000);
	await page.goto('/?sort=title');
	for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
	// To the last row: ↓ until focus stops moving.
	let last = '';
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press('ArrowDown');
		const now = await focused(page);
		if (now === last) break;
		last = now;
	}
	// Room below for the key to scroll into, as the loaded runs had.
	await page.evaluate(() => scrollBy({ top: -200, behavior: 'instant' }));
	const before = await page.evaluate(() => scrollY);
	expect(before).toBeGreaterThan(200);
	// ↓ with nothing below, then BACK at once: no wait between the two.
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Escape');
	await expect.poll(() => focused(page)).toMatch(/^Resume /);
	const frames = await stillFor(page, 2_000);
	expect([...new Set(frames)], 'scrollY over 2 s after BACK').toEqual([0]);
});

/** `scrollY` at every frame for `ms`, read in the page so no sample is missed between round trips. */
const stillFor = (page: Page, ms: number) =>
	page.evaluate(
		(ms) =>
			new Promise<number[]>((done) => {
				const seen: number[] = [];
				const until = performance.now() + ms;
				const frame = () => {
					seen.push(scrollY);
					if (performance.now() < until) requestAnimationFrame(frame);
					else done(seen);
				};
				requestAnimationFrame(frame);
			}),
		ms
	);

test('the library keeps the TV’s own bottom safe margin, and the last row ends above it', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=title');
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	const { padding, safe } = await page.evaluate(() => {
		const lib = document.querySelector('.library') as HTMLElement;
		return {
			padding: getComputedStyle(lib).paddingBottom,
			safe: getComputedStyle(lib).getPropertyValue('--safe-y').trim()
		};
	});
	expect(safe).toBe('28px');
	expect(padding).toBe(safe);

	// Scrolled to the end, the last tile sits clear of the TV's overscan edge.
	await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
	await expect
		.poll(() =>
			page.evaluate(() => {
				const tiles = document.querySelectorAll('.grid .tile');
				const last = tiles[tiles.length - 1].getBoundingClientRect().bottom;
				return last - (innerHeight - 28);
			})
		)
		.toBeLessThanOrEqual(0.5);
});

/**
 * Two stops per CONTINUE card since c841: ▶ (the first stop, what BACK climbs
 * to) and the band, which opens the entry. A trip to the series and back
 * returns to the stop it left (doc/FOCUS.md, "Going back").
 */
test('a CONTINUE card has two stops: ← from ▶ reaches the band, OK opens it, BACK returns to it (c841)', async ({
	page
}) => {
	await page.goto('/');
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => focused(page)).toMatch(/^Resume /);
	await page.keyboard.press('ArrowLeft');
	const band = page.locator('.cont > .row').first().locator('a.band');
	await expect(band).toBeFocused();
	const href = (await band.getAttribute('href'))!;
	expect(href).toMatch(/^\/series\/\d+\?from=continue$/);
	await page.keyboard.press('Enter');
	await page.waitForURL((u) => u.pathname + u.search === href);
	await page.goBack();
	await page.waitForURL((u) => u.pathname === '/');
	await expect(page.locator('.cont > .row').first().locator('a.band')).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => focused(page)).toMatch(/^Resume /);
});

test('▶❚❚ on the band resumes, as it does on ▶ (c841)', async ({ page }) => {
	// Incognito, so resuming writes nothing to the shared database.
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
	await page.goto('/');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('.cont > .row').first().locator('a.band')).toBeFocused();
	await page.evaluate(() =>
		document.activeElement!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'MediaPlayPause', cancelable: true, bubbles: true })
		)
	);
	await page.waitForURL(/\/read\/\d+/);
});

test('each stop draws the ring inside the card, and ▶ is a visible cell (c841)', async ({
	page
}) => {
	await page.goto('/');
	const row = page.locator('.cont > .row').first();
	const box = (await row.boundingBox())!;
	const go = row.locator('.go');
	const cell = (await go.boundingBox())!;
	expect(cell.width).toBe(48);
	expect(Math.round(cell.height)).toBe(Math.round(box.height));
	expect(Math.abs(cell.x + cell.width - (box.x + box.width))).toBeLessThanOrEqual(1);
	await expect(go.locator('svg')).toBeVisible();

	await page.keyboard.press('ArrowDown');
	await expect(go).toBeFocused();
	const ring = (n: Element) => getComputedStyle(n).boxShadow;
	expect(await go.evaluate(ring)).toContain('inset');
	await page.keyboard.press('ArrowLeft');
	const band = row.locator('a.band');
	await expect(band).toBeFocused();
	expect(await band.evaluate(ring)).toContain('inset');
});
