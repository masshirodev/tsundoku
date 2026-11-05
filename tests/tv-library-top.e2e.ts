import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The library's top on a TV (doc/LIBRARY.md, "Sort and direction" and "The
 * top bar"): SORT's menu walked by the remote alone (c432). The `tv` project
 * has no pointer, so every press is a key. BACK from deep in the grid lands
 * at the top and stays there, sampled every frame for 2 s (c543). Sorting
 * only changes the URL:
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
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('ArrowDown');
		walked.push(await focused(page));
	}
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
