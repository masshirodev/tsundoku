import { test, expect, type Page } from '@playwright/test';

/**
 * MOVE end to end (doc/MOVE.md; card c139): a series moves to another entry on
 * its source, keeps what the new entry lacks, adds what only it has, and comes
 * back with MOVE BACK. The fake engine (tests/browse-setup.ts) gives any search
 * one result, whose chapter list is 1, 2 and 3; the seeded series has 1, 2 and
 * an extra at 2.5, with 2 and 2.5 queued.
 *
 * One pane here (800 × 1280, tablet portrait): picking a candidate swaps the
 * candidates for the comparison, as the design draws it.
 */

const TITLE = 'Movenberg Heir';

async function openSeries(page: Page) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
}

test('a series moves to another entry, keeps what it lacks and adds what it has, then comes back', async ({
	page
}) => {
	await openSeries(page);

	// Board 1: a SOURCE row under LINK and COVER, with MOVE →.
	const panel = page.getByRole('region', { name: 'About this series' });
	await expect(panel.getByText('SOURCE', { exact: true })).toBeVisible();
	await expect(panel.getByText('Open Source', { exact: true })).toBeVisible();
	await panel.getByRole('link', { name: 'MOVE →' }).click();
	await expect(page).toHaveURL(/\/series\/\d+\/move/);

	// Board 2: the candidate as the source answers. The current entry is named,
	// not offered.
	const current = page.locator('.cand.now', { hasText: 'THIS SERIES NOW' });
	await expect(current).toBeVisible();
	await expect(current).toHaveAttribute('aria-disabled', 'true');
	const candidate = page.locator('a.cand', { hasText: 'Movenberg Heir (new)' });
	await expect(candidate).toBeVisible();
	await candidate.click();
	await expect(page).toHaveURL(/to=/);

	// Board 3: what the move does, in the series' own terms.
	await expect(
		page.getByText(/2 match by number · 1 kept from Open Source · 1 added/)
	).toBeVisible();
	await expect(page.getByText(/1 HAS NO PARTNER · LEAVES THE QUEUE/)).toBeVisible();
	await expect(page.getByText(/2 queued, ch\. 2 and 2\.5/)).toBeVisible();
	await expect(page.getByText('NOTHING DOWNLOADS ON MOVE')).toBeVisible();

	// The number map draws the kept extra and the added chapter apart.
	const map = page.locator('.blk.map');
	await expect(map.locator('.mr.run', { hasText: 'KEPT FROM OPEN SOURCE' }).first()).toBeVisible();
	await expect(map.locator('.mr.run', { hasText: 'ADDED · UNREAD' }).first()).toBeVisible();

	await page.getByRole('button', { name: 'MOVE TO OPEN SOURCE →' }).click();

	// The same series, its new entry, the band and the way back.
	await expect(page).toHaveURL(/\/series\/\d+\?moved=1/);
	await expect(page.getByText('MOVED TO OPEN SOURCE')).toBeVisible();
	await expect(
		page.getByText(/1 CHAPTER ADDED, NOT DOWNLOADED · 1 KEPT FROM OPEN SOURCE/)
	).toBeVisible();
	await expect(panel.getByText('WAS OPEN SOURCE · UNTIL')).toBeVisible();
	await expect(panel.getByRole('button', { name: 'MOVE BACK' })).toBeVisible();
	// The kept chapter says whose it is (board 4, frame 3).
	await expect(page.locator('.entry .src', { hasText: 'OPEN SOURCE' })).toBeVisible();
	// The chapter only the new entry has is listed; MOVE downloaded none of it.
	await expect(page.locator('.entry', { has: page.locator('.num:text-is("3")') })).toBeVisible();

	await panel.getByRole('button', { name: 'MOVE BACK' }).click();
	await expect(page).toHaveURL(/\/series\/\d+\?moved=1/);
	await expect(page.getByText('MOVED TO OPEN SOURCE')).toBeVisible();
	// Back: the chapter the new entry added has no file, so it is not in the
	// series again; the extra kept from the old entry is.
	await expect(page.locator('.entry', { has: page.locator('.num:text-is("3")') })).toHaveCount(0);
	await expect(page.locator('.entry', { has: page.locator('.num:text-is("2.5")') })).toBeVisible();
	await expect(panel.getByText('SOURCE', { exact: true })).toBeVisible();
});
