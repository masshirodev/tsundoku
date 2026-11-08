import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { previewId, SOURCE, startTagWorld, type TagWorld } from './helpers/tag-world';

/**
 * PUT ON A SHELF under the series screen's ADDED TO THE LIBRARY (card c724;
 * doc/SERIES.md, "Shelves in the ADDED band"): the common path, a preview's
 * + ADD TO LIBRARY from a source that does not add hidden, lands on the
 * series screen, and its band offers the owner's shelves as chips. A chip
 * puts the series on a shelf and the library's shelf shows it; the band
 * survives the page's own re-read and a reload; a second tap takes it off;
 * + NEW SHELF opens the SHELVES sheet at its name field; ↓ from UNDO reaches
 * the chips; UNDO takes the series and its shelves back; the next ADD offers
 * the last shelf chosen first. (/browse's own band, for a hidden ADD, is
 * tests/browse-add-shelf.e2e.ts.) A plain `*.e2e.ts`, so it runs in the four
 * device projects: the strip wraps differently at each width. It makes
 * shelves and adds a series, so it runs on its own world
 * (tests/helpers/tag-world.ts: its own database, engine and preview, one per
 * project's worker), touching nothing another spec reads.
 */

let world: TagWorld;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
	world = await startTagWorld('series-add-shelf');
});
test.afterAll(async () => {
	await world?.stop();
});

const TITLE = 'Preview Me Tagged';
const url = (path: string) => `${world.base}${path}`;
const previewPath = `/downloads/source/${previewId}?from=${encodeURIComponent(`/browse/${SOURCE.id}`)}`;
const band = (page: Page) =>
	page.locator('.band', { has: page.getByText('ADDED TO THE LIBRARY', { exact: true }) });
const strip = (page: Page) => page.getByRole('group', { name: 'Put on a shelf' });
const chip = (page: Page, name: string) =>
	strip(page).getByRole('button', { name: new RegExp(`^(✓ )?${name}$`) });
const remembered = (page: Page) => page.evaluate(() => localStorage.getItem('tsundoku:add-shelf'));

/** A shelf made through the library's own + NEW, by name; its id, from where it lands. */
async function newShelf(page: Page, name: string): Promise<number> {
	const r = await page.request.post(url('/?/newShelf'), {
		form: { name },
		headers: { origin: world.base, accept: 'text/html' },
		maxRedirects: 0
	});
	expect(r.status()).toBe(303);
	return Number(/shelf=c:(\d+)/.exec(r.headers()['location'] ?? '')![1]);
}

/** The preview's + ADD TO LIBRARY (+ ADD on the phone): it lands on the series screen with the band. */
async function add(page: Page): Promise<number> {
	await page.goto(url(previewPath));
	await page.locator('form[action="?/add"] button.add').click();
	await page.waitForURL((u) => /^\/series\/\d+$/.test(u.pathname) && u.searchParams.has('added'));
	await expect(band(page)).toBeVisible();
	return Number(/\/series\/(\d+)/.exec(page.url())![1]);
}

/** Whether the library's shelf `id` lists the preview's series, as the library page draws it. */
async function onShelf(page: Page, id: number): Promise<boolean> {
	const r = await page.request.get(url(`/?shelf=c:${id}`));
	expect(r.ok()).toBe(true);
	return (await r.text()).includes(TITLE);
}

test('ADDED TO THE LIBRARY offers the shelves: a chip, the library shows it, a reload, + NEW SHELF, UNDO takes both back', async ({
	page
}) => {
	// A whole walk through the band's states, each waiting on the page's own answer.
	test.setTimeout(120_000);
	const later = await newShelf(page, 'Later');
	const series = await add(page);
	await expect(strip(page)).toContainText('PUT ON A SHELF:');
	await expect(chip(page, 'LATER')).toHaveAttribute('aria-pressed', 'false');

	// A chip: on the shelf, the band says so, and it is remembered on this device.
	await chip(page, 'LATER').click();
	await expect(chip(page, 'LATER')).toHaveAttribute('aria-pressed', 'true');
	await expect(strip(page)).toContainText('ON LATER');
	await expect(band(page)).toBeVisible();
	expect(await remembered(page)).toBe(String(later));
	expect(await onShelf(page, later)).toBe(true);
	// The page's re-read kept the band: `added` stays in the address.
	expect(new URL(page.url()).searchParams.has('added')).toBe(true);

	// A reload draws the band again, the chip still on: it is read from the series.
	await page.reload();
	await expect(band(page)).toBeVisible();
	await expect(chip(page, 'LATER')).toHaveAttribute('aria-pressed', 'true');

	// A second tap takes it off, and leaves what is remembered alone.
	await chip(page, 'LATER').click();
	await expect(chip(page, 'LATER')).toHaveAttribute('aria-pressed', 'false');
	await expect(strip(page)).toContainText('PUT ON A SHELF:');
	expect(await onShelf(page, later)).toBe(false);
	expect(await remembered(page)).toBe(String(later));
	await chip(page, 'LATER').click();
	await expect(chip(page, 'LATER')).toHaveAttribute('aria-pressed', 'true');

	// + NEW SHELF: the SHELVES sheet, its name field open; the new shelf has the series on it.
	await strip(page).getByRole('button', { name: '+ NEW SHELF' }).click();
	const sheet = page.getByRole('dialog', { name: 'Shelves and tags' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('textbox', { name: 'New shelf name' }).fill('Tonight');
	await sheet.getByRole('button', { name: 'ADD', exact: true }).click();
	await expect(sheet.getByRole('checkbox', { name: /Tonight/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await expect(sheet).toBeHidden();
	await expect(band(page)).toBeVisible();
	await expect(chip(page, 'TONIGHT')).toHaveAttribute('aria-pressed', 'true');
	await expect(strip(page)).toContainText('ON LATER, TONIGHT');
	const tonight = Number(
		await strip(page)
			.locator('form', { has: page.getByRole('button', { name: /^(✓ )?TONIGHT$/ }) })
			.locator('input[name="collection"]')
			.inputValue()
	);
	expect(await onShelf(page, tonight)).toBe(true);
	// EDIT's own door opens the sheet as it always did: the name field closed.
	await page.reload();
	await expect(band(page)).toBeVisible();

	// The keys reach the strip: ↓ from UNDO lands on one of its cells (doc/FOCUS.md;
	// which one depends on how the width wraps it: + NEW SHELF where it shares
	// UNDO's column, a chip on the phone). The TV's walk over every chip is
	// tests/tv-series-seasons.e2e.ts'.
	await band(page).getByRole('button', { name: 'UNDO' }).focus();
	await page.keyboard.press('ArrowDown');
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					!!document.activeElement?.matches('.chip') &&
					!!document.activeElement.closest('[aria-label="Put on a shelf"]')
			)
		)
		.toBe(true);

	// A second tab still showing the band, for a tap after UNDO.
	const stale = await page.context().newPage();
	await stale.goto(page.url());
	await expect(chip(stale, 'LATER')).toBeVisible();

	// UNDO takes both back: back to the preview, and neither shelf lists the series.
	await band(page).getByRole('button', { name: 'UNDO' }).click();
	await page.waitForURL((u) => u.pathname.startsWith('/downloads/source/'));
	expect(await onShelf(page, later)).toBe(false);
	expect(await onShelf(page, tonight)).toBe(false);
	expect((await page.request.get(url(`/series/${series}`))).status()).toBe(404);

	// A chip tapped after UNDO shelves nothing, says why, and leaves the band's words.
	await chip(stale, 'TONIGHT').click();
	await expect(strip(stale)).toContainText('NOT SHELVED: THE SERIES IS NOT IN THE LIBRARY NOW');
	expect(await onShelf(page, tonight)).toBe(false);
	await stale.close();

	// The next ADD offers the last shelf put on first (TONIGHT was made in the sheet, LATER tapped).
	await add(page);
	await expect(strip(page).getByRole('button').first()).toHaveText('LATER');
	await band(page).getByRole('button', { name: 'UNDO' }).click();
	await page.waitForURL((u) => u.pathname.startsWith('/downloads/source/'));
});

test('more shelves than the band holds: N OTHER SHELVES opens the SHELVES sheet with them all', async ({
	page
}) => {
	test.setTimeout(90_000);
	for (const n of ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'])
		await newShelf(page, `Many ${n}`);
	await add(page);
	await expect(strip(page).getByRole('button', { name: /^\d+ OTHER SHEL(F|VES)$/ })).toBeVisible();
	// Six chips, then the rest by count.
	await expect(strip(page).locator('form button.chip')).toHaveCount(6);
	await strip(page)
		.getByRole('button', { name: /^\d+ OTHER SHEL(F|VES)$/ })
		.click();
	const sheet = page.getByRole('dialog', { name: 'Shelves and tags' });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('checkbox', { name: /Many Seven/ })).toBeVisible();
	// Put on from the sheet, it is drawn as a chip even past the six: the band never hides it.
	await sheet.getByRole('checkbox', { name: /Many Seven/ }).click();
	await expect(sheet.getByRole('checkbox', { name: /Many Seven/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await expect(chip(page, 'MANY SEVEN')).toHaveAttribute('aria-pressed', 'true');
	await expect(strip(page).locator('form button.chip')).toHaveCount(6);
	await band(page).getByRole('button', { name: 'UNDO' }).click();
	await page.waitForURL((u) => u.pathname.startsWith('/downloads/source/'));
});
