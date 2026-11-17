import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { previewId, SOURCE, startTagWorld, type TagWorld } from './helpers/tag-world';
import { revealOn } from './helpers/reveal';

/**
 * PUT ON A SHELF in the band ADD leaves (card c724; doc/BROWSE.md, "Shelves in
 * the ADD band"), on the band this slot owns: ADDED TO THE LIBRARY, AND
 * HIDDEN, drawn on the source's page when the source adds its series hidden
 * and reveal is off. A preview's ADD lands there; a chip puts the series on a
 * shelf, + NEW SHELF makes one with it on, the library's shelf shows it
 * (inside reveal, since it is hidden), a second tap takes it off, UNDO takes
 * the series and its shelves back, and a chip tapped after UNDO shelves
 * nothing. The series screen's own band (an ADD that is not hidden) is
 * another slot's file this wave (doc/handoff-notes/browse.md, wave 33).
 * In the `browse` project, on its own world (tests/helpers/tag-world.ts:
 * its own database, engine and preview), since it turns ADDED HIDDEN on,
 * makes shelves and adds series.
 */

let world: TagWorld;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
	world = await startTagWorld('add-shelf');
});
test.afterAll(async () => {
	await world?.stop();
});
// Teardown has its own budget, so the switch goes back off even after a timed-out
// case, and a failed put-back never hides the body's error (c649, c507).
test.afterEach(async ({ page }) => {
	const r = await page.request.post(url(`/browse/${SOURCE.id}/settings?/flag`), {
		form: { flag: 'addedHidden', value: 'false' },
		headers: { origin: world.base }
	});
	expect.soft(r.ok(), `ADDED HIDDEN back off: ${r.status()}`).toBe(true);
});

const url = (path: string) => `${world.base}${path}`;
const previewPath = `/downloads/source/${previewId}?from=${encodeURIComponent(`/browse/${SOURCE.id}`)}`;
const band = (page: Page) => page.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' });
const strip = (page: Page) => page.getByRole('group', { name: 'Put on a shelf' });
const chip = (page: Page, name: string) =>
	strip(page).getByRole('button', { name: new RegExp(`^(✓ )?${name}$`) });

async function reveal(context: BrowserContext, on: boolean) {
	if (on) await revealOn(context, world.base);
	else await context.clearCookies({ name: 'tsundoku_reveal' });
}

async function addedHidden(page: Page, on: boolean) {
	const r = await page.request.post(url(`/browse/${SOURCE.id}/settings?/flag`), {
		form: { flag: 'addedHidden', value: String(on) },
		headers: { origin: world.base }
	});
	expect(r.ok(), `ADDED HIDDEN ${on}: ${r.status()}`).toBe(true);
}

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

/** The preview's + ADD TO LIBRARY, outside reveal: it lands on the source's page with the band. */
async function add(page: Page) {
	await page.goto(url(previewPath));
	await page
		.getByRole('button', { name: /ADD TO LIBRARY/ })
		.first()
		.click();
	await page.waitForURL((u) => u.searchParams.get('added') === 'hidden');
	expect(new URL(page.url()).pathname).toBe(`/browse/${SOURCE.id}`);
	await expect(band(page)).toBeVisible();
}

/** Whether the library's shelf `id` lists the preview's series (inside reveal: it is hidden). */
async function onShelf(page: Page, context: BrowserContext, id: number): Promise<boolean> {
	await reveal(context, true);
	const r = await page.request.get(url(`/?shelf=c:${id}`));
	await reveal(context, false);
	return (await r.text()).includes('Preview Me Tagged');
}

test('a hidden ADD’s band offers the shelves: a chip, + NEW SHELF, the library shows it, a second tap, UNDO takes both back', async ({
	page,
	context
}) => {
	// A whole walk through the band's states, each waiting on the page's own answer.
	test.setTimeout(120_000);
	const later = await newShelf(page, 'Later');
	await reveal(context, false);
	await addedHidden(page, true);
	{
		await add(page);
		// It still says it is hidden, now with the shelves under it.
		await expect(band(page)).toContainText('ADDS ITS SERIES HIDDEN');
		await expect(strip(page)).toContainText('PUT ON A SHELF:');
		await expect(chip(page, 'LATER')).toHaveAttribute('aria-pressed', 'false');
		const bandUrl = page.url();

		// A chip: on the shelf, and the band says so.
		await chip(page, 'LATER').click();
		await expect(chip(page, 'LATER')).toHaveAttribute('aria-pressed', 'true');
		await expect(strip(page)).toContainText('ON LATER');
		expect(await page.evaluate(() => localStorage.getItem('tsundoku:add-shelf'))).toBe(
			String(later)
		);
		expect(await onShelf(page, context, later)).toBe(true);

		// + NEW SHELF: NewShelfSheet as it is; the new shelf has the series on it.
		await strip(page).getByRole('link', { name: '+ NEW SHELF' }).click();
		const sheet = page.getByRole('dialog', { name: 'New shelf' });
		await expect(sheet).toBeVisible();
		await sheet.getByRole('textbox', { name: 'Shelf name' }).fill('Tonight');
		await sheet.getByRole('button', { name: 'CREATE TONIGHT' }).click();
		await expect(sheet).toBeHidden();
		await expect(page).not.toHaveURL(/new=shelf/);
		await expect(band(page)).toBeVisible();
		await expect(chip(page, 'TONIGHT')).toHaveAttribute('aria-pressed', 'true');
		await expect(strip(page)).toContainText('ON LATER, TONIGHT');
		const tonight = Number(
			await strip(page)
				.locator('form', { has: page.getByRole('button', { name: /^(✓ )?TONIGHT$/ }) })
				.locator('input[name="collection"]')
				.inputValue()
		);
		expect(await onShelf(page, context, tonight)).toBe(true);

		// A second tap takes it off; tapped on again it is the last one chosen.
		await chip(page, 'TONIGHT').click();
		await expect(chip(page, 'TONIGHT')).toHaveAttribute('aria-pressed', 'false');
		expect(await onShelf(page, context, tonight)).toBe(false);
		expect(await page.evaluate(() => localStorage.getItem('tsundoku:add-shelf'))).toBe(
			String(later)
		);
		await chip(page, 'TONIGHT').click();
		await expect(chip(page, 'TONIGHT')).toHaveAttribute('aria-pressed', 'true');
		expect(await page.evaluate(() => localStorage.getItem('tsundoku:add-shelf'))).toBe(
			String(tonight)
		);

		// The keys reach the chips: ↓ from UNDO is a chip (doc/FOCUS.md; the TV's arrows).
		await band(page).getByRole('button', { name: 'UNDO' }).focus();
		await page.keyboard.press('ArrowDown');
		await expect(strip(page).locator('.chip:focus')).toHaveCount(1);
		// ← walks the chips (the world's own shelves wrap them onto more than one line).
		await page.keyboard.press('ArrowLeft');
		expect(
			await page.evaluate(
				() =>
					document.activeElement?.matches('button.chip') &&
					!!document.activeElement.closest('[aria-label="Put on a shelf"]')
			)
		).toBe(true);

		// A second tab still showing the band, for the tap after UNDO.
		const stale = await context.newPage();
		await stale.goto(bandUrl);
		await expect(chip(stale, 'LATER')).toBeVisible();

		// UNDO takes both back: the series leaves, and neither shelf lists it.
		await band(page).getByRole('button', { name: 'UNDO' }).click();
		await page.waitForURL((u) => u.pathname.startsWith('/downloads/source/'));
		expect(await onShelf(page, context, later)).toBe(false);
		expect(await onShelf(page, context, tonight)).toBe(false);

		// A chip tapped after UNDO shelves nothing, and says why.
		await chip(stale, 'TONIGHT').click();
		await expect(strip(stale)).toContainText('NOT SHELVED: THE SERIES IS NOT IN THE LIBRARY NOW');
		expect(await onShelf(page, context, tonight)).toBe(false);
		await stale.close();

		// The next ADD offers the last shelf chosen first.
		await add(page);
		await expect(strip(page).getByRole('button').first()).toHaveText('TONIGHT');
		await band(page).getByRole('button', { name: 'UNDO' }).click();
		await page.waitForURL((u) => u.pathname.startsWith('/downloads/source/'));
	}
});

test('more shelves than the band holds: the rest are in the SHELVES sheet', async ({
	page,
	context
}) => {
	test.setTimeout(90_000);
	// The world's own three, two from the case above, and six more: eleven, past the band's six.
	const made: number[] = [];
	for (const n of ['One', 'Two', 'Three', 'Four', 'Five', 'Six'])
		made.push(await newShelf(page, `Many ${n}`));
	await reveal(context, false);
	await addedHidden(page, true);
	{
		await add(page);
		await expect(strip(page).locator('form button')).toHaveCount(6);
		// The last one made is past the six: not a chip, but in the sheet.
		await expect(chip(page, 'MANY SIX')).toHaveCount(0);
		const others = strip(page).getByRole('button', { name: /^\d+ OTHER SHELVES$/ });
		const more = Number((await others.innerText()).split(' ')[0]);
		expect(more).toBe(5);
		await others.click();
		const sheet = page.getByRole('dialog', { name: 'Add to shelf' });
		await expect(sheet).toBeVisible();
		// The SHELVES sheet lists every shelf; the last one is past the band's six.
		await sheet.getByRole('button', { name: 'MANY SIX' }).click();
		await expect(sheet).toBeHidden();
		expect(await onShelf(page, context, made[5])).toBe(true);
		// On it now, so the band draws it in place of a chip it isn't on.
		await expect(chip(page, 'MANY SIX')).toHaveAttribute('aria-pressed', 'true');
		await expect(strip(page).locator('form button')).toHaveCount(6);
		await band(page).getByRole('button', { name: 'UNDO' }).click();
		await page.waitForURL((u) => u.pathname.startsWith('/downloads/source/'));
		expect(await onShelf(page, context, made[5])).toBe(false);
	}
});
