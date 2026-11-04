import { test, expect, type Page } from '@playwright/test';
import {
	COLD,
	GENRE,
	SOURCE,
	coldPreviewId,
	previewId,
	repeatId,
	startTagWorld,
	type TagWorld
} from './helpers/tag-world';

/**
 * Tapping an author, an artist, a genre or a tag searches for it in the
 * series' source (card c313; doc/BROWSE.md, "Arriving from a tag";
 * doc/SERIES.md, the TAGS row). Its own world (tests/helpers/tag-world.ts):
 * a fake engine whose manga has an author and genres, its own database and
 * preview, so nothing the browse world's specs pin changes.
 *
 * Serial, and in this order, because a source's filters are kept once they
 * answer (`keep`): the engine-down and slow cases must ask a cold cache.
 */

let world: TagWorld;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
	world = await startTagWorld('tags');
});
test.afterAll(async () => {
	await world?.stop();
});

const fromBrowse = `/browse/${SOURCE.id}`;
const previewPath = `/downloads/source/${previewId}?from=${encodeURIComponent(fromBrowse)}`;
const at = (page: Page) => new URL(page.url());
const series = (id: number) => `${world.base}/series/${id}`;
/**
 * `page.goto`, then network quiet: SvelteKit hydrates after `load`, and a tap
 * on server-rendered markup follows the link natively (tests/fixtures.ts says
 * why). The slow case taps its preview before that, as a quick thumb does.
 */
async function open(page: Page, url: string) {
	await page.goto(url);
	await page.waitForLoadState('networkidle');
}
const tagsRow = (page: Page) =>
	page.locator('.row', { has: page.locator('.label', { hasText: /^TAGS$/ }) });

test('with the engine down, both screens paint, and a tag lands on a search for its value', async ({
	page
}) => {
	world.reset();
	world.schema('down');
	await open(page, `${world.base}${previewPath}`);
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();
	await page.getByRole('link', { name: 'romance', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`));
	expect(at(page).searchParams.get('q')).toBe('Romance');
	expect(at(page).searchParams.get('tab')).toBeNull();
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('SEARCH');

	await open(page, series(world.ids.tagged));
	await expect(page.getByRole('heading', { name: 'Tagbearer Heir' })).toBeVisible();
	await tagsRow(page).getByRole('link', { name: 'Romance', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'Look for Romance' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('link', { name: `IN ${SOURCE.name.toUpperCase()}` }).click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`));
	expect(at(page).searchParams.get('q')).toBe('Romance');
	expect(at(page).searchParams.get('tab')).toBeNull();
	expect(at(page).searchParams.get('from')).toBe(`/series/${world.ids.tagged}`);
	// The filters were asked, failed, and the failure was the answer: a search.
	expect(world.calls().some((c) => c.method === 'filterSchemaManga')).toBe(true);
});

/**
 * Round 2 (review finding 1): a tag's link never guesses before the source's
 * filters have settled. On a cold cache with the filters slow, a tap made the
 * moment the link is there, with nothing polled first, still lands on the
 * filter the genre names. Each screen asks a source no earlier case has (the
 * series SOURCE, after the engine-down case, which keeps nothing; the preview
 * COLD), because the first answer warms the cache (`keep`).
 */
test('with the filters slow on a cold cache, the series paints at once and IN <SOURCE> waits for them', async ({
	page
}) => {
	world.reset();
	world.schema({ slowMs: 3000 });
	const started = Date.now();
	await open(page, series(world.ids.tagged));
	await expect(page.getByRole('heading', { name: 'Tagbearer Heir' })).toBeVisible();
	expect(Date.now() - started).toBeLessThan(3000);
	// Nothing asked the source for its filters to paint.
	expect(world.calls().filter((c) => c.method === 'filterSchemaManga')).toEqual([]);

	await tagsRow(page).getByRole('link', { name: 'Romance', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Look for Romance' })
		.getByRole('link', { name: `IN ${SOURCE.name.toUpperCase()}` })
		.click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`), { timeout: 15_000 });
	const u = at(page);
	expect(u.searchParams.get('q'), u.href).toBeNull();
	expect(u.searchParams.get('tab'), u.href).toBe('filtered');
	expect(u.searchParams.get(`f${GENRE}.1`), u.href).toBe('1');
	expect(u.searchParams.get('from'), u.href).toBe(`/series/${world.ids.tagged}`);
	world.schema('ok');
});

test('with the filters slow on a cold cache, the preview paints at once and a genre waits for them', async ({
	page
}) => {
	world.reset();
	world.schema({ slowMs: 3000 });
	const from = `/downloads/source/${coldPreviewId}?from=${encodeURIComponent(`/browse/${COLD.id}`)}`;
	// `vite preview` gzips a page, and its compression holds a streamed one
	// until it ends; the release's server (adapter-node, scripts/serve.ts)
	// compresses no page, so it streams. Asked as the release answers.
	await page.setExtraHTTPHeaders({ 'accept-encoding': 'identity' });
	const started = Date.now();
	// Tapped as soon as the link shows, as a quick thumb does: hydrated or not.
	await page.goto(`${world.base}${from}`, { waitUntil: 'commit' });
	const romance = page.getByRole('link', { name: 'romance', exact: true });
	await expect(romance).toBeVisible();
	expect(Date.now() - started).toBeLessThan(3000);
	await romance.click();
	await expect(page).toHaveURL(new RegExp(`/browse/${COLD.id}\\?`), { timeout: 15_000 });
	const u = at(page);
	expect(u.searchParams.get('q'), u.href).toBeNull();
	expect(u.searchParams.get('tab'), u.href).toBe('filtered');
	expect(u.searchParams.get(`f${GENRE}.1`), u.href).toBe('1');
	expect(u.searchParams.get('from'), u.href).toBe(from);
	world.schema('ok');
});

test('a genre on the preview lands on FILTERED with its chip included, and ← comes back', async ({
	page
}) => {
	// No reset: the series' slow case above already opened this very list, and
	// the source page keeps it (`keep`), so what the source was asked for it is there.
	await open(page, `${world.base}${previewPath}`);
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();
	await page.getByRole('link', { name: 'romance', exact: true }).click();

	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`));
	const u = at(page);
	expect(u.searchParams.get('tab')).toBe('filtered');
	expect(u.searchParams.get(`f${GENRE}.1`)).toBe('1');
	expect(u.searchParams.get(`f${GENRE}.0`)).toBe('0');
	expect(u.searchParams.get('q')).toBeNull();
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('FILTERED');
	await expect(page.getByText('Found By Tag')).toBeVisible();
	// What the source was asked: Romance included, every other choice its own default.
	const asked = world.calls().filter((c) => c.method === 'getSearchManga');
	const filters = asked[asked.length - 1].filterList!;
	expect(filters.find((f) => f.name === 'Genre')!.stateList).toEqual([
		{ name: 'Action', type: 'tristate', stateInt: 0 },
		{ name: 'Romance', type: 'tristate', stateInt: 1 },
		{ name: 'Slice of Life', type: 'tristate', stateInt: 0 }
	]);
	expect(filters.find((f) => f.name === 'Has chapters')!.stateList![0].stateBoolean).toBe(true);
	expect(filters.find((f) => f.name === 'Status')!.stateInt).toBe(0);
	// The panel shows the chip included.
	await page.getByRole('link', { name: /^FILTER/ }).click();
	await expect(page.getByRole('button', { name: 'Romance: included' })).toBeVisible();

	// ← returns to the preview, whose own ← still goes to BROWSE.
	const back = page.getByRole('link', { name: 'Back to the preview' });
	await back.click();
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();
	expect(at(page).pathname + at(page).search).toBe(previewPath);
	const own = page.locator('header.bar a.back');
	await expect(own).toHaveText(/BROWSE/);
	expect(new URL((await own.getAttribute('href'))!, world.base).pathname).toBe(fromBrowse);
});

/**
 * Card c453: every way to another list of the same source keeps the tag's
 * origin, so ← still lands on the preview after the reader has looked around.
 * Each step is a tap on what the screen offers (the tabs, the search field,
 * FILTER's APPLY and RESET, SETTINGS and its ←), and each is asserted by the
 * parameter the next ← reads. LATEST is not offered here (this world's source
 * has no latest list); browse-flow.e2e.ts taps it in BROWSE's own world.
 */
test('a source page opened from a tag keeps its origin through every tab, search, FILTER and SETTINGS', async ({
	page
}) => {
	// The preview's own address, its own `from` included.
	const origin = previewPath;
	const fromHere = () => at(page).searchParams.get('from');
	await open(page, `${world.base}${previewPath}`);
	await page.getByRole('link', { name: 'romance', exact: true }).click();
	await expect(page).toHaveURL(/tab=filtered/);
	expect(fromHere()).toBe(origin);

	// POPULAR, the tab every source has.
	await page.locator('nav[aria-label="Lists"]').getByRole('link', { name: 'POPULAR' }).click();
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('POPULAR');
	await expect(page).not.toHaveURL(/tab=filtered/);
	expect(fromHere()).toBe(origin);

	// One search, typed into the source's own field (on the tablet's bar).
	const field = page.getByRole('searchbox', { name: `Search ${SOURCE.name}` });
	await field.fill('Found');
	await field.press('Enter');
	await expect(page).toHaveURL(/q=Found/);
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('SEARCH');
	expect(fromHere()).toBe(origin);

	// FILTER's APPLY, then its RESET.
	await page.getByRole('link', { name: /^FILTER/ }).click();
	await page.getByRole('button', { name: /^APPLY/ }).click();
	await expect(page).toHaveURL(/tab=filtered/);
	await expect(page).not.toHaveURL(/panel=1/);
	expect(fromHere()).toBe(origin);
	await page.getByRole('link', { name: /^FILTER/ }).click();
	await page.getByRole('link', { name: '✕ RESET' }).click();
	await expect(page).toHaveURL(/panel=1/);
	expect(fromHere()).toBe(origin);

	// SETTINGS and back.
	await page.getByRole('link', { name: 'SETTINGS', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}/settings\\?`));
	expect(fromHere()).toBe(origin);
	await page.getByRole('link', { name: `Back to ${SOURCE.name}` }).click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`));
	expect(fromHere()).toBe(origin);

	// And ← is still the preview's.
	await page.getByRole('link', { name: 'Back to the preview' }).click();
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();
	expect(at(page).pathname + at(page).search).toBe(previewPath);
});

test('a genre the filters spell otherwise still matches; one they lack, and the author, are searches', async ({
	page
}) => {
	world.reset();
	await open(page, `${world.base}${previewPath}`);
	// "slice of life" on the manga, "Slice of Life" in the filter.
	await page.getByRole('link', { name: 'slice of life', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`));
	expect(at(page).searchParams.get(`f${GENRE}.2`)).toBe('1');
	expect(at(page).searchParams.get('tab')).toBe('filtered');
	await page.getByRole('link', { name: 'Back to the preview' }).click();
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();

	await page.getByRole('link', { name: 'gourmet', exact: true }).click();
	await expect(page).toHaveURL(/q=Gourmet/);
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('SEARCH');
	await expect
		.poll(() => world.calls().some((c) => c.method === 'getSearchManga' && c.search === 'Gourmet'))
		.toBe(true);
	await page.getByRole('link', { name: 'Back to the preview' }).click();
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();

	await page.getByRole('link', { name: 'Aoi Hanamura', exact: true }).click();
	await expect(page).toHaveURL(/q=Aoi\+Hanamura/);
	expect(at(page).searchParams.get('tab')).toBeNull();
	await expect
		.poll(() =>
			world.calls().some((c) => c.method === 'getSearchManga' && c.search === 'Aoi Hanamura')
		)
		.toBe(true);
});

/**
 * Round 2 (review finding 2): a source's genre string can name a genre twice
 * ("Action, Comedy, Action"), and the engine keeps both. The preview renders,
 * and each distinct genre is one link.
 */
test('a preview whose source lists a genre twice still renders, each genre once', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await open(
		page,
		`${world.base}/downloads/source/${repeatId}?from=${encodeURIComponent(fromBrowse)}`
	);
	await expect(page.getByRole('heading', { name: 'Repeats Its Genres' })).toBeVisible();
	const genres = page.locator('.tag-line', { has: page.locator('.ns', { hasText: /^genre$/ }) });
	await expect(genres.getByRole('link')).toHaveText(['action', 'comedy', 'romance']);
	expect(errors).toEqual([]);
});

test('a tag on a library series asks where to look, and each row goes where it says', async ({
	page
}) => {
	world.reset();
	const home = series(world.ids.tagged);
	await open(page, home);
	await expect(page.getByRole('heading', { name: 'Tagbearer Heir' })).toBeVisible();
	const tags = tagsRow(page);

	// A genre: the library's tag page, or the source's filter.
	await tags.getByRole('link', { name: 'Romance', exact: true }).click();
	let sheet = page.getByRole('dialog', { name: 'Look for Romance' });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('link')).toHaveText([/IN THE LIBRARY/, /IN TAG SOURCE/]);
	await sheet.getByRole('link', { name: /IN THE LIBRARY/ }).click();
	await expect(page).toHaveURL(/\/\?tag=genre%3ARomance$/);
	await expect(page.locator('.grid .tile', { hasText: 'Tagbearer Heir' })).toBeVisible();

	await open(page, home);
	await tags.getByRole('link', { name: 'Romance', exact: true }).click();
	sheet = page.getByRole('dialog', { name: 'Look for Romance' });
	await sheet.getByRole('link', { name: /IN TAG SOURCE/ }).click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`));
	expect(at(page).searchParams.get(`f${GENRE}.1`)).toBe('1');
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('FILTERED');
	await page.getByRole('link', { name: 'Back to the series' }).click();
	await expect(page.getByRole('heading', { name: 'Tagbearer Heir' })).toBeVisible();
	expect(at(page).pathname).toBe(`/series/${world.ids.tagged}`);

	// A person: their page in the library, or a search in the source.
	await tags.getByRole('link', { name: 'Ren Kisaragi', exact: true }).click();
	sheet = page.getByRole('dialog', { name: 'Look for Ren Kisaragi' });
	const person = new URL(
		(await sheet.getByRole('link', { name: /IN THE LIBRARY/ }).getAttribute('href'))!,
		world.base
	);
	expect(person.searchParams.get('tag')).toBe('artist:Ren Kisaragi');
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await tags.getByRole('link', { name: 'Ren Kisaragi', exact: true }).click();
	await sheet.getByRole('link', { name: /IN TAG SOURCE/ }).click();
	await expect(page).toHaveURL(/q=Ren\+Kisaragi/);
	expect(at(page).searchParams.get('tab')).toBeNull();
	expect(at(page).searchParams.get('from')).toBe(`/series/${world.ids.tagged}`);
	await page.getByRole('link', { name: 'Back to the series' }).click();
	await expect(page.getByRole('heading', { name: 'Tagbearer Heir' })).toBeVisible();

	// A bare tag is stored with no namespace: the library's key is the value alone.
	await tags.getByRole('link', { name: 'slice of life', exact: true }).click();
	sheet = page.getByRole('dialog', { name: 'Look for slice of life' });
	const bare = new URL(
		(await sheet.getByRole('link', { name: /IN THE LIBRARY/ }).getAttribute('href'))!,
		world.base
	);
	expect(bare.searchParams.get('tag')).toBe('slice of life');
	await sheet.getByRole('link', { name: /IN THE LIBRARY/ }).click();
	await expect(page.locator('.grid .tile', { hasText: 'Tagbearer Heir' })).toBeVisible();
});

test('a doujin from a source’s gallery asks too: the key decides, never the kind', async ({
	page
}) => {
	await open(page, series(world.ids.gallery));
	await expect(page.getByRole('heading', { name: 'Gallery From Tags' })).toBeVisible();
	await tagsRow(page).getByRole('link', { name: 'Romance', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Look for Romance' })).toBeVisible();
});

/**
 * Round 2 (review finding 2): a bare `Mecha` and a `tag:Mecha` both group
 * under `tag`, the same value twice in one group. The row renders, both.
 */
test('a series with a bare tag and the same value under tag: still renders its TAGS row', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await open(page, series(world.ids.twice));
	await expect(page.getByRole('heading', { name: 'Twice Tagged Mecha' })).toBeVisible();
	const line = tagsRow(page).locator('.tag-line', {
		has: page.locator('.ns', { hasText: /^tag$/ })
	});
	await expect(line.getByRole('link')).toHaveText(['Mecha', 'Mecha']);
	await line.getByRole('link').first().click();
	await expect(page.getByRole('dialog', { name: 'Look for Mecha' })).toBeVisible();
	expect(errors).toEqual([]);
});

for (const [door, key, title] of [
	['no origin at all', 'unsourced', 'Keyless Wanderer'],
	['a source not installed', 'missing', 'Gone Source Saga'],
	['a source whose extension failed', 'broken', 'Broken Source Tale'],
	['a Hentoid gallery', 'hentoid', 'Hentoid Gallery Tags']
] as const)
	test(`with ${door}, a tag goes straight to the library`, async ({ page }) => {
		await open(page, series(world.ids[key]));
		await expect(page.getByRole('heading', { name: title })).toBeVisible();
		const romance = tagsRow(page).getByRole('link', { name: 'Romance', exact: true });
		// No sheet to open: the link is the library's, and says nothing pops up.
		await expect(romance).not.toHaveAttribute('aria-haspopup');
		await romance.click();
		await expect(page).toHaveURL(/\/\?tag=genre%3ARomance$/);
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});
