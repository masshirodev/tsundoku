import { test, expect, type Page } from '@playwright/test';
import { GENRE, SOURCE, previewId, startTagWorld, type TagWorld } from './helpers/tag-world';

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
const hrefOf = async (page: Page, name: string) =>
	new URL((await page.getByRole('link', { name, exact: true }).getAttribute('href'))!, world.base);
const series = (id: number) => `${world.base}/series/${id}`;
/**
 * `page.goto`, then network quiet: SvelteKit hydrates after `load`, and a tap
 * on server-rendered markup follows the link natively (tests/fixtures.ts says
 * why). The slow case goes without, since quiet there is the stream's end.
 */
async function open(page: Page, url: string) {
	await page.goto(url);
	await page.waitForLoadState('networkidle');
}
const tagsRow = (page: Page) =>
	page.locator('.row', { has: page.locator('.label', { hasText: /^TAGS$/ }) });

test('with the engine down, the preview and the series still paint, and a tag searches for its value', async ({
	page
}) => {
	world.reset();
	world.schema('down');
	await open(page, `${world.base}${previewPath}`);
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();
	const genre = await hrefOf(page, 'romance');
	expect(genre.pathname).toBe(fromBrowse);
	expect(genre.searchParams.get('q')).toBe('Romance');
	expect(genre.searchParams.get('tab')).toBeNull();

	await open(page, series(world.ids.tagged));
	await expect(page.getByRole('heading', { name: 'Tagbearer Heir' })).toBeVisible();
	await tagsRow(page).getByRole('link', { name: 'Romance', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'Look for Romance' });
	await expect(sheet).toBeVisible();
	const there = new URL(
		(await sheet
			.getByRole('link', { name: `IN ${SOURCE.name.toUpperCase()}` })
			.getAttribute('href'))!,
		world.base
	);
	expect(there.searchParams.get('q')).toBe('Romance');
	expect(world.calls().some((c) => c.method === 'filterSchemaManga')).toBe(true);
});

test('with the source slow to give its filters, both screens paint first', async ({ page }) => {
	world.reset();
	// `vite preview` gzips a page, and its compression holds a streamed one
	// until it ends; the release's server (adapter-node, scripts/serve.ts)
	// compresses no page, so it streams. Asked as the release answers.
	await page.setExtraHTTPHeaders({ 'accept-encoding': 'identity' });
	world.schema({ slowMs: 6000 });
	const started = Date.now();
	// The document stays open while the filters stream in (SvelteKit's streamed
	// data), so `load` waits for them: what the eye sees is the paint after commit.
	await page.goto(`${world.base}${previewPath}`, { waitUntil: 'commit' });
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();
	expect(Date.now() - started).toBeLessThan(4000);
	// And once they come, the genre the filters name is that filter.
	await expect
		.poll(async () => (await hrefOf(page, 'romance')).searchParams.get('tab'), { timeout: 15_000 })
		.toBe('filtered');

	// The series screen asks nothing at load: its filters wait for a tag.
	const asked: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/tag-filters')) asked.push(r.url());
	});
	world.schema({ slowMs: 6000 });
	const again = Date.now();
	await page.goto(series(world.ids.gallery), { waitUntil: 'commit' });
	await expect(page.getByRole('heading', { name: 'Gallery From Tags' })).toBeVisible();
	expect(Date.now() - again).toBeLessThan(4000);
	await page.waitForLoadState('load');
	expect(asked).toEqual([]);
	world.schema('ok');
});

test('a genre on the preview lands on FILTERED with its chip included, and ← comes back', async ({
	page
}) => {
	world.reset();
	await open(page, `${world.base}${previewPath}`);
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();
	await expect
		.poll(async () => (await hrefOf(page, 'romance')).searchParams.get('tab'))
		.toBe('filtered');
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

test('a genre the filters spell otherwise still matches; one they lack, and the author, are searches', async ({
	page
}) => {
	world.reset();
	await open(page, `${world.base}${previewPath}`);
	await expect
		.poll(async () => (await hrefOf(page, 'romance')).searchParams.get('tab'))
		.toBe('filtered');
	// "slice of life" on the manga, "Slice of Life" in the filter.
	expect((await hrefOf(page, 'slice of life')).searchParams.get(`f${GENRE}.2`)).toBe('1');

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

test('a tag on a library series asks where to look, and each row goes where it says', async ({
	page
}) => {
	world.reset();
	const home = series(world.ids.tagged);
	await open(page, home);
	await expect(page.getByRole('heading', { name: 'Tagbearer Heir' })).toBeVisible();
	const tags = tagsRow(page);

	const asked: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/tag-filters')) asked.push(r.url());
	});
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
	await expect
		.poll(async () =>
			new URL(
				(await sheet.getByRole('link', { name: /IN TAG SOURCE/ }).getAttribute('href'))!,
				world.base
			).searchParams.get(`f${GENRE}.1`)
		)
		.toBe('1');
	await sheet.getByRole('link', { name: /IN TAG SOURCE/ }).click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`));
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
	const searched = new URL(
		(await sheet.getByRole('link', { name: /IN TAG SOURCE/ }).getAttribute('href'))!,
		world.base
	);
	expect(searched.searchParams.get('q')).toBe('Ren Kisaragi');
	expect(searched.searchParams.get('from')).toBe(`/series/${world.ids.tagged}`);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	// Asked once a screen, however many tags are tapped there: the first, the one
	// after the library, and the one ← came back to. Ren Kisaragi asked nothing more.
	expect(asked).toHaveLength(3);

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
