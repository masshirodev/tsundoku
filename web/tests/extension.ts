/**
 * What the web edition's browser tests with a real extension share: a
 * repository of their own on a loopback port, listing Keiyoushi's Webtoons.com
 * extension (tests/fixtures/apk/README.md), a Chromium with the development
 * fetcher, the steps that install it (doc/WEB-EDITION.md, "Installing an
 * extension"), and a made-up webtoons.com for it to read. Used by
 * install.e2e.ts, browse.e2e.ts and read.e2e.ts.
 */
import { chromium, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

export const KEIYOUSHI = '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2';
export const PKG = 'eu.kanade.tachiyomi.extension.all.webtoons';
export const FETCHER = join(process.cwd(), 'build-fetcher', 'development');

/** The test's repository, as Mihon's index v2 shapes one. */
function repoAnswer(path: string): { type: string; body: Buffer | string } | null {
	if (path === '/good/repo.json')
		return {
			type: 'application/json',
			body: JSON.stringify({ meta: { name: 'Fake Repo', signingKeyFingerprint: KEIYOUSHI } })
		};
	// The older index only (`parseIndexLegacy`): `index.json` answers 404, and the
	// app falls back to `index.min.json`, files beside it under apk/.
	if (path === '/good/index.min.json')
		return {
			type: 'application/json',
			body: JSON.stringify([
				{
					name: 'Webtoons.com',
					pkg: PKG,
					apk: 'webtoons.apk',
					lang: 'all',
					code: 2,
					version: '1.6.2',
					nsfw: 0,
					sources: [{ id: '1', name: 'Webtoons.com', lang: 'en', baseUrl: 'https://example.org' }]
				}
			])
		};
	if (path === '/good/apk/webtoons.apk')
		return {
			type: 'application/vnd.android.package-archive',
			body: readFileSync('tests/fixtures/apk/tachiyomi-all.webtoons-v1.6.2.apk')
		};
	return null;
}

/** Starts the repository; `base` is its address. */
export async function startRepo(): Promise<{ base: string; close: () => void }> {
	const repo: Server = createServer((req, res) => {
		const answer = repoAnswer(new URL(req.url ?? '/', 'http://x').pathname);
		if (!answer) return void res.writeHead(404).end();
		res.writeHead(200, { 'content-type': answer.type }).end(answer.body);
	});
	await new Promise<void>((resolve) => repo.listen(0, '127.0.0.1', resolve));
	return {
		base: `http://127.0.0.1:${(repo.address() as AddressInfo).port}`,
		close: () => void repo.close()
	};
}

/**
 * A Chromium with the development fetcher, on a profile of its own (an
 * extension needs a persistent context), removed by `close`.
 */
export async function fetcherBrowser(
	baseURL: string | undefined,
	name: string
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
	const profile = mkdtempSync(join(process.cwd(), 'test-results', `${name}-profile-`));
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		baseURL,
		viewport: { width: 1440, height: 900 },
		args: [`--disable-extensions-except=${FETCHER}`, `--load-extension=${FETCHER}`]
	});
	const page = context.pages()[0] ?? (await context.newPage());
	return {
		context,
		page,
		close: async () => {
			await context.close();
			rmSync(profile, { recursive: true, force: true });
		}
	};
}

/** The app up, and the engine started (CheerpJ from its CDN, then the jar). */
export async function ready(page: Page, path = '/'): Promise<void> {
	await page.goto(path);
	await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', { timeout: 60_000 });
	await expect(page.locator('html')).toHaveAttribute('data-web-engine', 'ready', {
		timeout: 180_000
	});
}

/** A row of BROWSE › EXTENSIONS. */
export const extensionRow = (page: Page, name: string) =>
	page.locator('.rows .row', { hasText: name });

/** The repository added and Webtoons.com installed, through the app's own screens. */
export async function installWebtoons(page: Page, base: string): Promise<void> {
	await page.goto(
		`/browse/extensions?tab=repos&add=${encodeURIComponent(`${base}/good/index.min.json`)}`
	);
	await expect(page.locator('.found')).toContainText('FOUND · Fake Repo', { timeout: 60_000 });
	await page.getByRole('button', { name: 'ADD Fake Repo' }).click();
	await expect(extensionRow(page, 'Fake Repo')).toBeVisible();
	await page.goto('/browse/extensions?tab=available');
	await extensionRow(page, 'Webtoons.com').getByRole('button', { name: 'INSTALL' }).click();
	await expect(extensionRow(page, 'Webtoons.com')).toContainText('INSTALLED ✓', {
		timeout: 300_000
	});
}

// ---- a made-up webtoons.com -------------------------------------------------

export const SITE = 'https://www.webtoons.com';
export const STRIPS = [
	{ no: 101, slug: 'fake-strip-one', title: 'Fake Strip One' },
	{ no: 102, slug: 'fake-strip-two', title: 'Fake Strip Two' }
];
/** Each strip's episodes, and each episode's pages. */
export const EPISODES = 3;
export const PAGES = 3;
const listUrl = (s: (typeof STRIPS)[number]) =>
	`${SITE}/en/fantasy/${s.slug}/list?title_no=${s.no}`;
// A path, as the real API answers it: the extension puts the site in front.
const viewerPath = (s: (typeof STRIPS)[number], n: number) =>
	`/en/fantasy/${s.slug}/episode-${n}/viewer?title_no=${s.no}&episode_no=${n}`;

/** A real image, made by sharp here in Node: a cover is small, a page tall. */
const image = (width: number, height: number, background: string) =>
	sharp({ create: { width, height, channels: 3, background } })
		.png()
		.toBuffer();

/**
 * Answers every request to webtoons.com in the shapes Webtoons.com 1.6.2
 * reads, so the extension never reaches the real site: the ranking and search
 * pages' `.webtoon_list li a`, a series page's `h1.subj`, the mobile API's
 * episode list, an episode's `div#_imageList > img[data-url]`, and their
 * images. Playwright's `context.route` reaches the fetcher's own requests.
 * `episodes`, when given, holds the episode list until it settles. Answers
 * the paths it was asked, host and path only.
 */
export async function fakeWebtoons(
	context: BrowserContext,
	{ episodes }: { episodes?: Promise<void> } = {}
): Promise<string[]> {
	const cover = await image(40, 60, '#3a6b8c');
	const page = await image(400, 600, '#8c5a3a');
	const asked: string[] = [];
	const html = (route: Route, body: string) =>
		route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
	await context.route(/^https:\/\/(www|m)\.webtoons\.com\//, async (route) => {
		const url = new URL(route.request().url());
		asked.push(url.host + url.pathname);
		if (url.pathname.startsWith('/img/'))
			return route.fulfill({
				status: 200,
				contentType: 'image/png',
				body: url.pathname.includes('/page-') ? page : cover
			});
		// Search: the strips whose title has the keyword, in the ranking's shape.
		const keyword = url.pathname.startsWith('/en/search')
			? (url.searchParams.get('keyword') ?? '').toLowerCase()
			: null;
		if (url.pathname.startsWith('/en/ranking/') || keyword !== null)
			return html(
				route,
				`<html><body><ul class="webtoon_list">${STRIPS.filter(
					(s) => keyword === null || s.title.toLowerCase().includes(keyword)
				)
					.map(
						(s) =>
							`<li><a href="${listUrl(s)}"><img src="${SITE}/img/${s.slug}.png"><p class="title">${s.title}</p></a></li>`
					)
					.join('')}</ul></body></html>`
			);
		const viewer = /\/([a-z-]+)\/episode-(\d+)\/viewer$/.exec(url.pathname);
		if (viewer)
			return html(
				route,
				`<html><body><div id="_imageList">${Array.from(
					{ length: PAGES },
					(_, i) => `<img data-url="${SITE}/img/${viewer[1]}/page-${viewer[2]}-${i + 1}.png">`
				).join('')}</div></body></html>`
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
						episodeList: Array.from({ length: EPISODES }, (_, i) => ({
							episodeTitle: `Episode ${i + 1}`,
							viewerLink: viewerPath(s, i + 1),
							exposureDateMillis: 1_700_000_000_000 + (i + 1) * 86_400_000
						}))
					}
				})
			});
		}
		return route.fulfill({ status: 404, body: '' });
	});
	return asked;
}
