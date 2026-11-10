import { expect, test } from './fixtures';
import { engineCalls, resetEngine, SOURCES } from './browse-world';

/**
 * + ADD TO LIBRARY and ADD AND DOWNLOAD from a preview replace the preview's
 * history entry instead of pushing one (c932, stage 1; doc/BROWSE.md,
 * doc/NAVIGATION.md): one swipe back from the new series lands on the catalog
 * the entry was found in, at the place it was left (c930), not on the preview
 * a second time. It counts history steps, and the source's own calls on the
 * way back. Runs in the `browse` project against its fake engine; the TV's
 * BACK is in `tests/tv-browse-focus.e2e.ts`, the project with a remote.
 */

const OPEN = `/browse/${SOURCES.open.id}`;

/** A tile on the source's page, by its title. */
const tile = (page: import('@playwright/test').Page, title: string) =>
	page.locator('.grid a.tile', { hasText: title }).first();

/** The preview's add, and the sheet's confirm: both name ADD in their own words. */
const addButton = (page: import('@playwright/test').Page) =>
	page.getByRole('button', { name: /ADD TO LIBRARY/ });

/** Where the list is: the scroll, and the tile at the top of the viewport. */
const place = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const tiles = [...document.querySelectorAll<HTMLElement>('.grid a.tile')];
		const top = tiles
			.filter((t) => t.getBoundingClientRect().bottom > 0)
			.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
		return { y: Math.round(scrollY), top: top?.querySelector('.t')?.textContent ?? null };
	});

/** The source's page-list calls: what a way back must not ask for again. */
const pageCalls = async () =>
	(await engineCalls()).filter((c) => /^get(Popular|Latest|Search)Manga$/.test(c.method));

/** Scroll into the list, at a place a return has to come back to. */
async function scrollInto(page: import('@playwright/test').Page, y: number) {
	await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
}

/** The source's page at a place, and the catalog back from it is where it was. */
async function openListAt(page: import('@playwright/test').Page) {
	await page.goto(`${OPEN}?pages=2`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Lindenborough Heir');
	await expect.poll(() => page.locator('.grid a.tile').count()).toBe(26);
	// Not the very end: the add changes the tile it adds (IN LIBRARY, and a
	// downloaded line), which can move the list's end by a few pixels.
	await scrollInto(page, 100);
	return place(page);
}

/**
 * Open a tile wholly in view, the [n]th of those drawn last: a click on a tile
 * cut by the viewport's edge is scrolled into view first, which moves the very
 * place the return has to come back to. The last ones are page 2's, which no
 * other spec opens.
 */
async function openVisible(page: import('@playwright/test').Page, n = 0) {
	const title = await page.evaluate((i) => {
		const whole = [...document.querySelectorAll<HTMLElement>('.grid a.tile')].filter((el) => {
			const r = el.getBoundingClientRect();
			return r.top >= 0 && r.bottom <= innerHeight;
		});
		const pick = whole[whole.length - 1 - i];
		return pick?.querySelector('.t')?.textContent ?? null;
	}, n);
	expect(title, 'a tile is whole in the viewport').toBeTruthy();
	await tile(page, title!).click();
	return title!;
}

/** The place a way back landed on: the same scroll (within a couple of pixels), the same tile. */
async function expectBackAt(
	page: import('@playwright/test').Page,
	before: { y: number; top: string | null },
	/** The tiles the list has now: one fewer when the add hid a result of it (the c435 landing). */
	count = 26
) {
	await expect.poll(() => new URL(page.url()).pathname).toBe(OPEN);
	await expect.poll(() => page.locator('.grid a.tile').count()).toBe(count);
	await expect
		.poll(async () => (await place(page)).y, { timeout: 10_000 })
		.toBeGreaterThanOrEqual(before.y - 2);
	const after = await place(page);
	expect(after.top, 'the same tile is at the top').toBe(before.top);
	expect(Math.abs(after.y - before.y), 'the same scroll').toBeLessThanOrEqual(2);
}

/** UNDO on the new series' band, forward in history: it puts the library back. */
async function undoFromTheSeries(page: import('@playwright/test').Page) {
	await page.goForward();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	const undo = page
		.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })
		.getByRole('button', { name: 'UNDO' });
	await expect(undo).toBeVisible();
	await undo.click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/downloads\/source\//);
	await expect(addButton(page)).toBeVisible();
}

test.beforeEach(async () => {
	await resetEngine();
});

test.afterEach(async ({ page }) => {
	// The ADDED HIDDEN switch one case sets, off again whether it passed or not.
	await page.request.post(`${OPEN}/settings?/flag`, {
		form: { flag: 'addedHidden', value: 'false' },
		headers: { origin: new URL(page.url()).origin }
	});
});

test('ADD replaces the preview’s entry: one swipe back lands on the catalog, at its place', async ({
	page
}) => {
	const before = await openListAt(page);
	await openVisible(page);
	await expect(addButton(page)).toBeVisible();
	const stepsOnPreview = await page.evaluate(() => history.length);

	await addButton(page).click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	expect(new URL(page.url()).searchParams.get('added')).toBeTruthy();
	await expect(page.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })).toBeVisible();
	expect(await page.evaluate(() => history.length), 'the add replaced the preview’s entry').toBe(
		stepsOnPreview
	);

	// What the way back asks the source: nothing it had drawn.
	await resetEngine();
	await page.goBack();
	await expectBackAt(page, before);
	expect(await pageCalls(), 'no page already drawn is asked again').toEqual([]);

	await undoFromTheSeries(page);
});

test('ADD AND DOWNLOAD: the same one swipe, with what it queued on the band', async ({
	page
}, testInfo) => {
	// A tile no other spec opens, and a different one per repeat: its queued
	// chapters really download here, so a second press of this case must not
	// find the first one's series already in the library.
	const before = await openListAt(page);
	await openVisible(page, 1 + (testInfo.repeatEachIndex % 6));
	await expect(addButton(page)).toBeVisible();
	await page.getByRole('button', { name: 'FIRST 3' }).click();
	// Ours, asking first (card c205), and on top.
	await expect(page.getByText('DOWNLOADING ADDS IT TO YOUR LIBRARY')).toBeVisible();
	const stepsOnPreview = await page.evaluate(() => history.length);
	await page.getByRole('button', { name: 'ADD AND DOWNLOAD' }).click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	expect(new URL(page.url()).searchParams.get('queued')).toBeTruthy();
	await expect(page.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })).toContainText(
		/DOWNLOAD/
	);
	expect(await page.evaluate(() => history.length), 'the add replaced the preview’s entry').toBe(
		stepsOnPreview
	);

	await resetEngine();
	await page.goBack();
	await expectBackAt(page, before);
	expect(await pageCalls(), 'no page already drawn is asked again').toEqual([]);

	// The library back as it was, usually: the queued chapters download at once,
	// and once one has the band rightly offers no UNDO (c505's rule), so the
	// series stays for a repeat that opens another tile.
	await page.goForward();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	const undo = page
		.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })
		.getByRole('button', { name: 'UNDO' });
	if (await undo.count()) {
		await undo.click();
		await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/downloads\/source\//);
	}
});

test('an ADD that hid the series lands on the source’s page, and one swipe back still reaches the list', async ({
	page
}) => {
	// ADDED HIDDEN on this source, with reveal off: the new series isn't found,
	// so the band is drawn on the source's page instead of the series (c435,
	// c505), and the add still replaces the preview's entry.
	const before = await openListAt(page);
	const on = await page.request.post(`${OPEN}/settings?/flag`, {
		form: { flag: 'addedHidden', value: 'true' },
		headers: { origin: new URL(page.url()).origin }
	});
	expect(on.ok()).toBe(true);
	await tile(page, 'Open Source 1-5').click();
	await expect(addButton(page)).toBeVisible();
	const stepsOnPreview = await page.evaluate(() => history.length);
	await addButton(page).click();
	await expect.poll(() => new URL(page.url()).pathname).toBe(OPEN);
	expect(new URL(page.url()).searchParams.get('added')).toBe('hidden');
	await expect(
		page.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' })
	).toBeVisible();
	expect(await page.evaluate(() => history.length), 'the add replaced the preview’s entry').toBe(
		stepsOnPreview
	);

	await page.goBack();
	// The series the add hid is one of the source's own results, so the list is
	// one shorter outside reveal: the place is still the same.
	await expectBackAt(page, before, 25);

	// The library back as it was: forward to the band's page, UNDO it there.
	await page.goForward();
	await expect.poll(() => new URL(page.url()).searchParams.get('added')).toBe('hidden');
	const undo = page
		.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' })
		.getByRole('button', { name: 'UNDO' });
	await expect(undo).toBeVisible();
	await undo.click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/downloads\/source\//);
	await expect(addButton(page)).toBeVisible();
});
