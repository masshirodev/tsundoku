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
