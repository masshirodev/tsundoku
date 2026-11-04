import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The library's top on a TV (doc/LIBRARY.md, "Sort and direction" and "The
 * top bar"): SORT's menu walked by the remote alone (c432). The `tv` project
 * has no pointer, so every press is a key. Sorting only changes the URL:
 * nothing here writes to the database the flow files share.
 */

const focused = (page: Page) =>
	page.evaluate(() => {
		const a = document.activeElement as HTMLElement | null;
		return (a?.getAttribute('aria-label') ?? a?.textContent ?? '').trim();
	});

/** From the screen's start to SORT's cell, the way a remote gets there. */
async function toSort(page: Page) {
	await page.keyboard.press('ArrowDown'); // the screen's start, the first CONTINUE card
	await page.keyboard.press('ArrowDown'); // the shelf tabs
	// Along the tabs to the last, + NEW, under the sort.
	let last = '';
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press('ArrowRight');
		const now = await focused(page);
		if (now === last) break;
		last = now;
	}
	// Up lands in the SORT block: on SORT, or on ↓ / ↑ beside it, then left.
	await page.keyboard.press('ArrowUp');
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
 * of every bar pinned over that column: the top bar, the shelf tabs and the
 * focus line. Negative is covered.
 */
const ringClear = (page: Page) =>
	page.evaluate(() => {
		const cover = document.activeElement?.querySelector('.cover');
		if (!cover) return null;
		const c = cover.getBoundingClientRect();
		const pinned = [...document.querySelectorAll<HTMLElement>('header.bar, .tabs, .focus-line')]
			.filter((el) => ['sticky', 'fixed'].includes(getComputedStyle(el).position))
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.width > 0 && r.left < c.right && r.right > c.left && r.top < c.top);
		const under = Math.max(0, ...pinned.map((r) => r.bottom));
		return c.top - 7 - under;
	});

test('the pinned bars never cover the first row’s focus ring, and BACK from deep in the grid is back at the top', async ({
	page
}) => {
	await page.goto('/?sort=title');
	await page.keyboard.press('ArrowDown'); // the screen's start
	await page.keyboard.press('ArrowDown'); // the shelf tabs
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
	// At the top: within a few pixels of it, since the flow files beside this
	// one hide and restore series on the same grid as it settles (2px once,
	// under the loaded run, where 729 was the bottom).
	await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThanOrEqual(8);
});
