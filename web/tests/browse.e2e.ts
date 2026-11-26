/**
 * Browsing a source and opening a series in the web edition (c1121): the
 * source's POPULAR and a search through the engine in CheerpJ, its covers
 * drawn in the tab
 * (web/sharp.js), and a series' preview, which draws at once and fills in
 * when the source answers (a streamed answer, doc/WEB-EDITION.md, "How a
 * request travels").
 *
 * The extension is Keiyoushi's Webtoons.com, installed as install.e2e.ts does;
 * the site is this test's own: every request to webtoons.com is answered here
 * with made-up pages, so nothing reaches the real site. Chromium and Firefox,
 * with the engine's jar, as install.e2e.ts.
 */
import { expect, test } from '@playwright/test';
import { fakeWebtoons, fetcherBrowser, installWebtoons, ready, startRepo } from './extension';

test.skip(
	process.env.TSUNDOKU_ENGINE_JAR === undefined,
	'needs the engine: build the web edition with TSUNDOKU_ENGINE_JAR (doc/TESTING.md, "The web edition")'
);

let repo: Awaited<ReturnType<typeof startRepo>>;
test.beforeAll(async () => {
	repo = await startRepo();
});
test.afterAll(() => repo?.close());

test('a source browsed and searched, its covers drawn, and a series opened, its preview drawn before the source answers', async ({
	baseURL,
	browserName
}) => {
	test.setTimeout(900_000);
	let letEpisodesGo = () => {};
	const episodes = new Promise<void>((resolve) => (letEpisodesGo = resolve));
	const site = await fakeWebtoons({ episodes });
	const browser = await fetcherBrowser(baseURL, 'browse', browserName, site);
	try {
		const { page } = browser;
		const { asked } = site;
		await ready(page);
		await installWebtoons(page, repo.base);

		// BROWSE › the source › POPULAR: the made-up ranking, through the engine.
		await page.goto('/browse');
		await page
			.getByRole('link', { name: /Webtoons\.com/ })
			.first()
			.click();
		const tile = (title: string) =>
			page.locator('a[href^="/downloads/source/"]', { hasText: title });
		await expect(tile('Fake Strip One')).toBeVisible({ timeout: 180_000 });
		await expect(tile('Fake Strip Two')).toBeVisible();
		// The fetcher's requests were this test's: the engine reached no real site.
		expect(asked).toContain('www.webtoons.com/en/ranking/trending');

		// Its covers: the tile's background names the engine's image, which the
		// tab's server fetches through the fetcher and redraws (web/sharp.js).
		const cover = await tile('Fake Strip One')
			.locator('.cover')
			.evaluate(
				(el) => /url\("?([^")]+)"?\)/.exec(getComputedStyle(el).backgroundImage)?.[1] ?? ''
			);
		expect(cover).toMatch(/\/api\/downloads\/engine-image\//);
		const drawn = await page.evaluate(async (url) => {
			const res = await fetch(url);
			const image = await createImageBitmap(await res.blob());
			return { status: res.status, type: res.headers.get('content-type'), width: image.width };
		}, cover);
		// The made-up image is 40 px wide, under the thumbnail's 400: kept as it is.
		expect(drawn).toEqual({ status: 200, type: 'image/webp', width: 40 });

		// A search, answered by the source: only the strip that matches. The
		// new address first, so nothing is read off the POPULAR grid still on
		// screen while the search's page replaces it.
		await page.getByPlaceholder(/search Webtoons\.com/).fill('two');
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/[?&]q=two\b/);
		await expect
			.poll(() => asked.includes('www.webtoons.com/en/search'), { timeout: 180_000 })
			.toBe(true);
		await expect(tile('Fake Strip Two')).toBeVisible({ timeout: 180_000 });
		await expect(tile('Fake Strip One')).toHaveCount(0);
		await page.goBack();
		await expect(tile('Fake Strip One')).toBeVisible({ timeout: 180_000 });

		// A series: its preview draws while the source's episode list is still
		// held back, then fills in when it comes.
		await tile('Fake Strip One').click();
		await expect(page.getByText('ASKING THE SOURCE…')).toBeVisible({ timeout: 120_000 });
		letEpisodesGo();
		await expect(page.getByRole('heading', { name: 'Fake Strip One' })).toBeVisible({
			timeout: 180_000
		});
		await expect(page.getByText('ASKING THE SOURCE…')).toHaveCount(0);
	} finally {
		if (test.info().status !== test.info().expectedStatus) console.log(browser.report());
		letEpisodesGo();
		await browser.close();
		site.close();
	}
});
