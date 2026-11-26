/**
 * Browsing a source and opening a series in the web edition (c1121): the
 * source's POPULAR through the engine in CheerpJ, its covers drawn in the tab
 * (web/sharp.js), and a series' preview, which draws at once and fills in
 * when the source answers (a streamed answer, doc/WEB-EDITION.md, "How a
 * request travels").
 *
 * The extension is Keiyoushi's Webtoons.com, installed as install.e2e.ts does;
 * the site is this test's own: every request to webtoons.com is answered here
 * with made-up pages, so nothing reaches the real site. Chromium only, with
 * the engine's jar, as install.e2e.ts.
 */
import { expect, test, type BrowserContext, type Route } from '@playwright/test';
import sharp from 'sharp';
import { fetcherBrowser, installWebtoons, ready, startRepo } from './extension';

test.skip(
	process.env.TSUNDOKU_ENGINE_JAR === undefined,
	'needs the engine: build the web edition with TSUNDOKU_ENGINE_JAR (doc/TESTING.md, "The web edition")'
);
test.skip(
	({ browserName }) => browserName !== 'chromium',
	'Playwright’s Firefox cannot load the fetcher'
);

let repo: Awaited<ReturnType<typeof startRepo>>;
test.beforeAll(async () => {
	repo = await startRepo();
});
test.afterAll(() => repo?.close());

const SITE = 'https://www.webtoons.com';
const STRIPS = [
	{ no: 101, slug: 'fake-strip-one', title: 'Fake Strip One' },
	{ no: 102, slug: 'fake-strip-two', title: 'Fake Strip Two' }
];
const listUrl = (s: (typeof STRIPS)[number]) =>
	`${SITE}/en/fantasy/${s.slug}/list?title_no=${s.no}`;

// A real image for the covers, made by sharp here in Node.
let PNG: Buffer;
test.beforeAll(async () => {
	PNG = await sharp({
		create: { width: 40, height: 60, channels: 3, background: '#3a6b8c' }
	})
		.png()
		.toBuffer();
});

/**
 * The made-up site, in the shapes Webtoons.com 1.6.2 reads: the ranking page's
 * `.webtoon_list li a`, a series page's `h1.subj`, and the mobile API's
 * episode list. `episodes` is held until the test lets it go.
 */
async function fakeSite(context: BrowserContext, episodes: Promise<void>) {
	const asked: string[] = [];
	const html = (route: Route, body: string) =>
		route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
	await context.route(/^https:\/\/(www|m)\.webtoons\.com\//, async (route) => {
		const url = new URL(route.request().url());
		asked.push(url.host + url.pathname);
		if (url.pathname.startsWith('/img/'))
			return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
		if (url.pathname.startsWith('/en/ranking/'))
			return html(
				route,
				`<html><body><ul class="webtoon_list">${STRIPS.map(
					(s) =>
						`<li><a href="${listUrl(s)}"><img src="${SITE}/img/${s.slug}.png"><p class="title">${s.title}</p></a></li>`
				).join('')}</ul></body></html>`
			);
		const strip = STRIPS.find((s) => url.pathname.includes(`/${s.slug}/list`));
		if (strip)
			return html(
				route,
				`<html><head><meta property="og:image" content="${SITE}/img/${strip.slug}.png"></head><body>
				<div class="detail_header"><div class="info"><span class="genre">Fantasy</span><a class="author">A. Writer</a></div></div>
				<h1 class="subj">${strip.title}</h1>
				<div id="_asideDetail"><p class="summary">Made up for a test.</p><p class="day_info">UP EVERY MONDAY</p></div>
				</body></html>`
			);
		const api = /^\/api\/v1\/webtoon\/(\d+)\/episodes$/.exec(url.pathname);
		if (url.host === 'm.webtoons.com' && api) {
			await episodes;
			const s = STRIPS.find((x) => String(x.no) === api[1])!;
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					result: {
						episodeList: [1, 2, 3].map((n) => ({
							episodeTitle: `Episode ${n}`,
							viewerLink: `${SITE}/en/fantasy/${s.slug}/episode-${n}/viewer?title_no=${s.no}&episode_no=${n}`,
							exposureDateMillis: 1_700_000_000_000 + n * 86_400_000
						}))
					}
				})
			});
		}
		return route.fulfill({ status: 404, body: '' });
	});
	return asked;
}

test('a source browsed, its covers drawn, and a series opened, its preview drawn before the source answers', async ({
	baseURL
}) => {
	test.setTimeout(900_000);
	const browser = await fetcherBrowser(baseURL, 'browse');
	let letEpisodesGo = () => {};
	const episodes = new Promise<void>((resolve) => (letEpisodesGo = resolve));
	try {
		const { page, context } = browser;
		const asked = await fakeSite(context, episodes);
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
		letEpisodesGo();
		await browser.close();
	}
});
