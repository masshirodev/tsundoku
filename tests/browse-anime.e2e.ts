import { test, expect } from './fixtures';

/**
 * An anime series in the library and on the series screen (doc/ANIME.md;
 * card c153), on the browse server's seeded "Tsukiakari no Ryokōsha"
 * (tests/browse-setup.ts), as Index Anime Series and Anime States 1a draw it.
 * The handoff's literals are pinned, so a tidy-up can't round them away.
 */

test('the library has an ANIME shelf, and CONTINUE says the episode and the time left', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.locator('.cont')).toContainText('ANIME · S2 EP. 7 · 14:32 LEFT');
	// The episode's bar, 568 of 1,440 s, not the series' 18 of 24.
	await expect(page.locator('.cont')).toContainText('39%');
	const tab = page.getByRole('link', { name: /^ANIME/ });
	await expect(tab).toBeVisible();
	await tab.click();
	await expect(page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' })).toBeVisible();
});

test('an anime series: its count, CONTINUE, and episodes by season', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await expect(page).toHaveURL(/\/series\/\d+/);

	await expect(page.locator('.names .meta')).toHaveText('ANIME · ANIMEPAHE · ONGOING');
	await expect(page.locator('.names .count')).toHaveText('24 EPISODES · 2 SEASONS · 18 WATCHED');
	await expect(page.locator('a.cta')).toContainText('▶ CONTINUE');
	await expect(page.locator('a.cta')).toContainText('S2 · EP. 7 · 14:32 LEFT');

	const list = page.getByRole('region', { name: 'Episodes' });
	await expect(list.locator('.title')).toContainText('01 — EPISODES');
	await expect(list.locator('.title')).toContainText('24 · 18 WATCHED');
	// Season 1 is watched through: one row, folded.
	const fold = list.locator('.fold button');
	await expect(fold).toContainText('↑ SEASON 1 · EP. 1 – 12');
	await expect(fold).toContainText('12 WATCHED · SHOW');
	await expect(list.locator('.season')).toHaveText(['SEASON 2 · EP. 1 – 12 6 WATCHED']);

	const row = (title: string) => list.locator('.entry', { hasText: title });
	await expect(row('The Lantern Market').locator('.status')).toHaveText('14:32 LEFT');
	await expect(row('The Lantern Market').locator('.num')).toHaveText('7');
	await expect(row('The Lantern Market').locator('.bar')).toBeVisible();
	await expect(row('Salt Road').locator('.status')).toHaveText('410 MB');
	await expect(row("The Ferryman's Count").locator('.status')).toHaveText('NOT DOWNLOADED');
	await expect(row('Two Roads North').locator('.status')).toHaveText('WATCHED');
	await expect(list.locator('.entry', { hasText: 'RECAP · 24 MIN' })).toHaveCount(1);
	await expect(list.locator('.entry', { hasText: 'FILLER · 24 MIN' })).toHaveCount(1);

	// The handoff's measurements: 72px rows, a 96×54 picture, a 64px number column.
	const btn = row('Salt Road').locator('.entry-btn');
	await expect(btn).toHaveCSS('height', '72px');
	await expect(row('Salt Road').locator('.thumb')).toHaveCSS('width', '96px');
	await expect(row('Salt Road').locator('.thumb')).toHaveCSS('height', '54px');
	await expect(row('Salt Road').locator('.num')).toHaveCSS('width', '64px');
	await expect(row('Salt Road').locator('.t')).toHaveCSS('font-size', '16px');
	await expect(row('Salt Road').locator('.m')).toHaveCSS('font-size', '12px');
	await expect(list.locator('.season')).toHaveCSS('height', '44px');
	await expect(fold).toHaveCSS('height', '52px');

	// SHOW opens season 1; # finds an episode by its number in the season being watched.
	await fold.click();
	await expect(list.locator('.season')).toHaveCount(2);
	await list.getByRole('button', { name: 'Go to episode number' }).click();
	await page.getByLabel('GO TO EP.').fill('9');
	await page.getByLabel('GO TO EP.').press('Enter');
	await expect(row('A Letter from Hollin')).toHaveClass(/flash/);
});
