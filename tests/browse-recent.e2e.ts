import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { resetEngine, SOURCES } from './browse-world';

/**
 * BROWSE's RECENT folds away (doc/BROWSE.md, "RECENT folds"): its
 * label is a toggle, open by default, remembered per device in one
 * localStorage key, and a reload of a device that folded it paints it folded
 * from the first frame (the head's pre-paint mark), never open and then shut.
 * Runs in the `browse` project because RECENT lists sources, which exist only
 * against the browse world's fake engine.
 */

const OPEN = `/browse/${SOURCES.open.id}`;
const KEY = 'tsundoku:browse-recent';

const toggle = (page: Page) => page.getByRole('button', { name: /^01 — RECENT/ });
const recentRows = (page: Page) => page.locator('#browse-recent');
/** What the label's right half shows (both words are in the markup; the fold shows one pair). */
const shown = (page: Page) => toggle(page).locator('.right > span:visible');
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);

test.beforeEach(async ({ page }) => {
	await resetEngine();
	// A visit, so RECENT has a row whatever ran before.
	await page.goto(OPEN);
});

test('RECENT folds, stays folded across a reload, and unfolds', async ({ page }) => {
	await page.goto('/browse');
	await expect(recentRows(page)).toBeVisible();
	const n = await recentRows(page).locator('.row').count();
	expect(n).toBeGreaterThan(0);
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
	await expect(shown(page)).toHaveText(['LAST BROWSED', 'HIDE ↑']);
	// Its name holds the words drawn, so "click hide" finds it (WCAG 2.5.3).
	await expect(toggle(page)).toHaveAccessibleName(/LAST BROWSED.*HIDE ↑/);

	await toggle(page).click();
	await expect(recentRows(page)).toBeHidden();
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
	// Folded, it still says how many, so it isn't forgotten.
	await expect(shown(page)).toHaveText([`${n} RECENT`, 'SHOW ↓']);
	await expect(toggle(page)).toHaveAccessibleName(new RegExp(`${n} RECENT.*SHOW ↓`));
	await expect(toggle(page)).not.toHaveAccessibleName(/HIDE|LAST BROWSED/);
	expect(await stored(page)).toBe('folded');
	// The sections after it keep their numbers.
	await expect(page.locator('.screen > .label').nth(1)).toContainText('02 — MANGA');

	await page.reload();
	await expect(recentRows(page)).toBeHidden();
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
	await expect(shown(page)).toHaveText([`${n} RECENT`, 'SHOW ↓']);

	await toggle(page).click();
	await expect(recentRows(page)).toBeVisible();
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
	expect(await stored(page)).toBeNull();
	await page.reload();
	await expect(recentRows(page)).toBeVisible();
	await expect(shown(page)).toHaveText(['LAST BROWSED', 'HIDE ↑']);
});

test.describe('the first paint', () => {
	// The service worker would serve the app's script from its cache, past `page.route`.
	test.use({ serviceWorkers: 'block' });

	test('a folded RECENT is folded in the first paint, before the page’s script runs', async ({
		page,
		context
	}) => {
		await page.goto('/browse');
		await toggle(page).click();
		await expect(recentRows(page)).toBeHidden();
		// The server's markup alone, the app's script never arriving: what the first frame shows.
		// A page of the context's own (the same storage), whose loads wait for no hydration.
		const bare = await context.newPage();
		// Only the scripts: the stylesheet still arrives, as it does before any first paint.
		await bare.route(/\/_app\/immutable\/.*\.js(\?|$)/, (r) => r.abort());
		await bare.goto('/browse', { waitUntil: 'domcontentloaded' });
		await expect(bare.locator('html')).toHaveAttribute('data-recent-folded', '');
		await expect(recentRows(bare)).toBeHidden();
		await expect(shown(bare)).toHaveText([/^\d RECENT$/, 'SHOW ↓']);
		// The page's script never ran: the server's own `aria-expanded` is still there.
		await expect(toggle(bare)).toHaveAttribute('aria-expanded', 'true');

		// And a device that never folded it paints it open, the same way.
		await page.evaluate((k) => localStorage.removeItem(k), KEY);
		await bare.goto('/browse', { waitUntil: 'domcontentloaded' });
		await expect(bare.locator('html')).not.toHaveAttribute('data-recent-folded', '');
		await expect(recentRows(bare)).toBeVisible();
		await expect(shown(bare)).toHaveText(['LAST BROWSED', 'HIDE ↑']);
		await bare.close();
	});
});

test('BROWSE reached inside the app keeps the fold, both ways', async ({ page }) => {
	await page.goto('/browse');
	await toggle(page).click();
	await expect(recentRows(page)).toBeHidden();
	// Away and back without a document load: no head script runs, the page's own read does.
	await page.goto(OPEN);
	await page.getByRole('link', { name: 'Back to BROWSE' }).click();
	await expect(page).toHaveURL(/\/browse$/);
	await expect(recentRows(page)).toBeHidden();
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');

	// Unfolded in a document whose head marked it folded: the mark goes too, so
	// the next arrival inside the app is open.
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-recent-folded', '');
	await toggle(page).click();
	await expect(recentRows(page)).toBeVisible();
	await expect(page.locator('html')).not.toHaveAttribute('data-recent-folded', '');
	await page.getByRole('link', { name: 'EXTENSIONS' }).first().click();
	await expect(page).toHaveURL(/\/browse\/extensions/);
	await page.getByRole('link', { name: 'Back to BROWSE' }).click();
	await expect(page).toHaveURL(/\/browse$/);
	await expect(recentRows(page)).toBeVisible();
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
	// The toggle's word is still drawn: the head's <noscript> rule that hides it
	// is for a page without script, never one SvelteKit put in place.
	await expect(shown(page)).toHaveText(['LAST BROWSED', 'HIDE ↑']);
});

test('another tab’s fold is not undone by this one’s stale mark', async ({ page, context }) => {
	await page.goto('/browse');
	await toggle(page).click();
	await expect(recentRows(page)).toBeHidden();
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-recent-folded', '');
	// A second tab unfolds it.
	const other = await context.newPage();
	await other.goto('/browse');
	await toggle(other).click();
	await expect(recentRows(other)).toBeVisible();
	await other.close();
	// This document's head marked it folded; arriving at BROWSE again inside
	// it (no document load, so the mark stays) reads the word, not the mark.
	await page.locator('.rows').nth(1).locator('.row', { hasText: 'Open Source' }).click();
	await expect(page).toHaveURL(new RegExp(`${OPEN}$`));
	await page.getByRole('link', { name: 'Back to BROWSE' }).click();
	await expect(page).toHaveURL(/\/browse$/);
	await expect(recentRows(page)).toBeVisible();
	await expect(page.locator('html')).not.toHaveAttribute('data-recent-folded', '');
});
