import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { SOURCE, startTagWorld, type TagWorld } from './helpers/tag-world';

/**
 * BROWSE's RECENT fold with the remote (doc/BROWSE.md, "RECENT
 * folds"; doc/FOCUS.md): at 960×540 with no pointer, the D-pad reaches
 * RECENT's label as one stop, OK folds it, a folded RECENT's rows are no
 * stops, and OK opens it again. On the tag world's own database and engine
 * (tests/helpers/tag-world.ts), since BROWSE lists sources only against an
 * engine and the shared database has none; it writes nothing but the
 * source's RECENT visit, in that world.
 */

let world: TagWorld;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
	world = await startTagWorld('tv-browse-recent');
});
test.afterAll(async () => {
	await world?.stop();
});

const toggle = (page: Page) => page.getByRole('button', { name: '01 — RECENT · LAST BROWSED' });
const focusedIn = (page: Page, selector: string) =>
	page.evaluate((s) => !!document.activeElement?.closest(s), selector);

/** ↓ until the fold's label has the focus, or fail with where the pad went. */
async function padToFold(page: Page): Promise<void> {
	const path: string[] = [];
	for (let i = 0; i < 8; i++) {
		if (await focusedIn(page, 'button.fold')) return;
		path.push(
			await page.evaluate(
				() => (document.activeElement as HTMLElement | null)?.innerText?.trim().slice(0, 20) ?? ''
			)
		);
		await page.keyboard.press('ArrowDown');
	}
	throw new Error(`the pad never reached RECENT; path ${path.join(' > ')}`);
}

test('the pad reaches RECENT’s label, OK folds it and opens it again', async ({ page }) => {
	expect(
		await page.evaluate(() => matchMedia('(pointer: none)').matches),
		'the tv project has no pointer'
	).toBe(true);
	// A visit, so RECENT has a row.
	await page.goto(`${world.base}/browse/${SOURCE.id}`);
	await page.goto(`${world.base}/browse`);
	await expect(page.locator('#browse-recent .row').first()).toBeVisible();

	await padToFold(page);
	await expect(toggle(page)).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('#browse-recent')).toBeHidden();
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
	await expect(toggle(page)).toBeFocused();
	// Folded, its rows are no stops: ↓ goes past them, to the next section.
	await page.keyboard.press('ArrowDown');
	expect(await focusedIn(page, '#browse-recent')).toBe(false);
	expect(await focusedIn(page, '.rows')).toBe(true);
	await page.keyboard.press('ArrowUp');
	await expect(toggle(page)).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('#browse-recent')).toBeVisible();
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
	// Open, ↓ is RECENT's first row again.
	await page.keyboard.press('ArrowDown');
	expect(await focusedIn(page, '#browse-recent')).toBe(true);
});
