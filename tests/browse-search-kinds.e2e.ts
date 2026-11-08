/**
 * SEARCH THE SOURCES' KIND band (c699): ALL asks every source, as before, and
 * a kind asks only its own sources, so an anime search does not wait on the
 * manga extensions. In the browse world, because only it has installed
 * sources of more than one kind (a Mihon manga source, an Aniyomi anime
 * source and an LNReader plugin) and a fake engine that records what it was
 * asked.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ANIME_SOURCE, engineCalls, SOURCES } from './browse-world';

// The browse project's files share the fake engine and its call log, so this
// file's searches carry a word no other file searches for, and its calls are
// read by it.
const Q = 'kindband';
const kinds = (page: Page) => page.getByRole('navigation', { name: 'Kinds' });
const sources = (page: Page) => page.getByRole('navigation', { name: 'Sources' });
const searchCalls = async () =>
	(await engineCalls()).filter((c) => c.method.startsWith('getSearch') && c.search === Q);

test('ALL asks every kind’s sources, a kind only its own, and the kind stays through a reload (c699)', async ({
	page
}) => {
	await page.goto(`/downloads/search?q=${Q}`);
	// ALL is the default and today's search: every source, the manga source's hit among them.
	const band = kinds(page);
	await expect(band.getByRole('link', { name: /^ALL/ })).toHaveClass(/\bon\b/);
	await expect(band.getByRole('link')).toHaveText([/^ALL/, /^MANGA/, /^NOVELS/, /^ANIME/]);
	await expect(sources(page).getByRole('link', { name: SOURCES.open.name })).toBeVisible();
	await expect(sources(page).getByRole('link', { name: ANIME_SOURCE.name })).toBeVisible();
	await expect(page.locator('a.hit', { hasText: 'Filtered One' }).first()).toBeVisible();
	await expect(page.getByText(/STILL ASKING/)).toHaveCount(0);
	const underAll = await searchCalls();
	expect(underAll.some((c) => c.sourceId === SOURCES.open.id)).toBe(true);
	expect(underAll.some((c) => c.sourceId === ANIME_SOURCE.id)).toBe(true);

	// ANIME: its one source's tab, no manga hit, and the manga source not asked.
	const before = underAll.length;
	await band.getByRole('link', { name: /^ANIME/ }).click();
	await page.waitForURL(/kind=anime/);
	await expect(band.getByRole('link', { name: /^ANIME/ })).toHaveClass(/\bon\b/);
	const tabs = sources(page).getByRole('link');
	await expect(tabs).toHaveText([/^ALL/, new RegExp(`^${ANIME_SOURCE.name}`, 'i')]);
	await expect(page.locator('a.hit', { hasText: 'Filtered One' })).toHaveCount(0);
	await expect(page.getByText(/STILL ASKING/)).toHaveCount(0);
	await expect(page.locator('.label').first()).toContainText('OF 1 SOURCE ANSWERED');
	const underAnime = (await searchCalls()).slice(before);
	expect(underAnime.map((c) => c.sourceId)).toEqual([ANIME_SOURCE.id]);

	// A reload keeps the kind, and still asks only its source.
	const beforeReload = (await searchCalls()).length;
	await page.reload();
	await expect(kinds(page).getByRole('link', { name: /^ANIME/ })).toHaveClass(/\bon\b/);
	await expect(sources(page).getByRole('link')).toHaveText([
		/^ALL/,
		new RegExp(`^${ANIME_SOURCE.name}`, 'i')
	]);
	await expect(page.getByText(/STILL ASKING/)).toHaveCount(0);
	const afterReload = (await searchCalls()).slice(beforeReload);
	expect(afterReload.map((c) => c.sourceId)).toEqual([ANIME_SOURCE.id]);

	// A source's tab under a kind keeps the kind; ALL in the band goes back to every source.
	await expect(tabs.nth(1)).toHaveAttribute(
		'href',
		new RegExp(`kind=anime&source=${ANIME_SOURCE.id}$`)
	);
	await kinds(page).getByRole('link', { name: /^ALL/ }).click();
	await page.waitForURL((u) => !u.searchParams.has('kind'));
	await expect(sources(page).getByRole('link', { name: SOURCES.open.name })).toBeVisible();
});

test('a re-ask under a kind is refused for a source of another kind (c699)', async ({ page }) => {
	const ask = (source: string, kind: string) =>
		page.request.get(`/downloads/search/ask?${new URLSearchParams({ q: Q, source, kind })}`);
	expect((await ask(SOURCES.open.id, 'anime')).status()).toBe(404);
	expect((await ask(SOURCES.open.id, 'manga')).status()).toBe(200);
	expect((await ask(ANIME_SOURCE.id, 'anime')).status()).toBe(200);
});

test('the library’s search hands its kind to SEARCH THE SOURCES (c699)', async ({ page }) => {
	await page.goto('/?kind=anime');
	const cell = page.getByRole('link', { name: 'Search' }).filter({ visible: true }).first();
	await expect(cell).toHaveAttribute('href', '/search?kind=anime');
	await cell.click();
	await page.waitForURL(/\/search\?kind=anime/);
	await page.getByRole('searchbox').fill(Q);
	await page.waitForURL(new RegExp(`q=${Q}&kind=anime`));
	const to = page.locator('a.to-sources');
	await expect(to).toHaveAttribute('href', `/downloads/search?q=${Q}&kind=anime`);
	await expect(to).toContainText('1 SOURCE ·');
	await to.click();
	await page.waitForURL(/\/downloads\/search\?q=kindband&kind=anime/);
	await expect(kinds(page).getByRole('link', { name: /^ANIME/ })).toHaveClass(/\bon\b/);
});
