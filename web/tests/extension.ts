/**
 * What the web edition's browser tests with a real extension share: a
 * repository of their own on a loopback port, listing Keiyoushi's Webtoons.com
 * extension (tests/fixtures/apk/README.md), a Chromium with the development
 * fetcher, the steps that install it (doc/WEB-EDITION.md, "Installing an
 * extension"), and a made-up webtoons.com for it to read. Used by
 * install.e2e.ts, browse.e2e.ts and read.e2e.ts.
 */
import { chromium, expect, firefox, type BrowserContext, type Page } from '@playwright/test';
import { connect, createServer as netServer } from 'node:net';
import sharp from 'sharp';
import { createServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
 * The made-up site's hosts, sent nowhere: a request the test fails to answer
 * (an unrouted host, a route that stopped matching) fails, rather than
 * reaching the real site. Playwright's routing comes first.
 */
const FAKED_HOSTS = ['www.webtoons.com', 'm.webtoons.com'];

/** A loopback port nothing listens on yet. */
async function freePort(): Promise<number> {
	const server = netServer();
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as AddressInfo).port;
	await new Promise((resolve) => server.close(resolve));
	return port;
}

/**
 * Installs an unpacked extension into a running Firefox as a temporary add-on,
 * over its remote debugging protocol (what `web-ext run` does): Playwright's
 * own API loads extensions in Chromium only. Packets are length-prefixed JSON.
 */
async function installInFirefox(port: number, dir: string): Promise<void> {
	const deadline = Date.now() + 30_000;
	for (;;) {
		try {
			await new Promise<void>((resolve, reject) => {
				const sock = connect(port, '127.0.0.1');
				let buf = '';
				let step: 'hello' | 'root' | 'install' = 'hello';
				const send = (packet: object) => {
					const text = JSON.stringify(packet);
					sock.write(`${Buffer.byteLength(text)}:${text}`);
				};
				sock.on('error', reject);
				sock.on('data', (d) => {
					buf += d.toString('utf8');
					for (;;) {
						const colon = buf.indexOf(':');
						if (colon < 0) return;
						const len = Number(buf.slice(0, colon));
						if (buf.length < colon + 1 + len) return;
						const msg = JSON.parse(buf.slice(colon + 1, colon + 1 + len));
						buf = buf.slice(colon + 1 + len);
						if (step === 'hello' && msg.applicationType) {
							step = 'root';
							send({ to: 'root', type: 'getRoot' });
						} else if (step === 'root' && msg.addonsActor) {
							step = 'install';
							send({ to: msg.addonsActor, type: 'installTemporaryAddon', addonPath: dir });
						} else if (step === 'install' && (msg.addon || msg.error)) {
							sock.end();
							if (msg.error) reject(new Error(`${msg.error}: ${msg.message}`));
							else resolve();
						}
					}
				});
			});
			return;
		} catch (e) {
			if (Date.now() > deadline) throw e;
			await new Promise((r) => setTimeout(r, 300));
		}
	}
}

/**
 * A browser with the development fetcher, on a profile of its own (an
 * extension needs a persistent context), removed by `close`. Chromium loads
 * it at launch; Firefox takes it as a temporary add-on once started.
 */
export async function fetcherBrowser(
	baseURL: string | undefined,
	name: string,
	browserName = 'chromium',
	site?: FakeSite
): Promise<{
	context: BrowserContext;
	page: Page;
	report: () => string;
	close: () => Promise<void>;
}> {
	const profile = mkdtempSync(join(process.cwd(), 'test-results', `${name}-profile-`));
	const common = { headless: true, baseURL, viewport: { width: 1440, height: 900 } };
	let context: BrowserContext;
	if (browserName === 'firefox') {
		const port = await freePort();
		context = await firefox.launchPersistentContext(profile, {
			...common,
			// The made-up site's certificate is its own (fakeWebtoons).
			ignoreHTTPSErrors: !!site,
			args: ['-start-debugger-server', String(port)],
			firefoxUserPrefs: {
				'devtools.debugger.remote-enabled': true,
				'devtools.chrome.enabled': true,
				'devtools.debugger.prompt-connection': false,
				// The storage prompt answers itself (playwright.web.config.ts says why).
				'dom.storageManager.prompt.testing': true,
				'dom.storageManager.prompt.testing.allow': true,
				'network.dns.localDomains': FAKED_HOSTS.join(','),
				...site?.firefoxPrefs
			}
		});
		await installInFirefox(port, FETCHER);
	} else {
		context = await chromium.launchPersistentContext(profile, {
			...common,
			channel: 'chromium',
			args: [
				`--disable-extensions-except=${FETCHER}`,
				`--load-extension=${FETCHER}`,
				`--host-resolver-rules=${FAKED_HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(',')}`
			]
		});
	}
	if (site && browserName !== 'firefox') await site.route(context);
	const page = context.pages()[0] ?? (await context.newPage());
	// The page's last words, for a failing test to print (`report`).
	const lines: string[] = [];
	page.on('console', (m) => lines.push(`${m.type()}: ${m.text()}`.slice(0, 400)));
	page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`.slice(0, 400)));
	return {
		context,
		page,
		report: () =>
			`the made-up site was asked: ${JSON.stringify(site?.asked ?? [])}\n` +
			`the page's console, last 60 lines:\n${lines.slice(-60).join('\n')}`,
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

/** One answer of the made-up site. */
type Answer = { status: number; contentType: string; body: Buffer | string };

/**
 * The made-up site's answer to `url`, in the shapes Webtoons.com 1.6.2 reads:
 * the ranking and search pages' `.webtoon_list li a`, a series page's
 * `h1.subj`, the mobile API's episode list, an episode's
 * `div#_imageList > img[data-url]`, and their images.
 */
async function answer(
	url: URL,
	art: { cover: Buffer; page: Buffer },
	episodes: Promise<void> | undefined
): Promise<Answer> {
	const html = (body: string): Answer => ({
		status: 200,
		contentType: 'text/html; charset=utf-8',
		body
	});
	if (url.pathname.startsWith('/img/'))
		return {
			status: 200,
			contentType: 'image/png',
			body: url.pathname.includes('/page-') ? art.page : art.cover
		};
	// Search: the strips whose title has the keyword, in the ranking's shape.
	const keyword = url.pathname.startsWith('/en/search')
		? (url.searchParams.get('keyword') ?? '').toLowerCase()
		: null;
	if (url.pathname.startsWith('/en/ranking/') || keyword !== null)
		return html(
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
			`<html><body><div id="_imageList">${Array.from(
				{ length: PAGES },
				(_, i) => `<img data-url="${SITE}/img/${viewer[1]}/page-${viewer[2]}-${i + 1}.png">`
			).join('')}</div></body></html>`
		);
	const strip = STRIPS.find((s) => url.pathname.includes(`/${s.slug}/list`));
	if (strip)
		return html(
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
		return {
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
		};
	}
	return { status: 404, contentType: 'text/plain', body: '' };
}

/** The made-up site, running: what it was asked, and how a browser reaches it. */
export type FakeSite = {
	/** Host and path of every request it answered. */
	asked: string[];
	/** Chromium: answered by Playwright's routing, which reaches the fetcher's requests. */
	route(context: BrowserContext): Promise<void>;
	/**
	 * Firefox, whose extension requests Playwright cannot route: a proxy that
	 * sends the site's hosts to a local HTTPS server with a certificate made
	 * for this run, and tunnels every other host to itself.
	 */
	firefoxPrefs: Record<string, string | number | boolean>;
	close(): void;
};

/**
 * Starts the made-up webtoons.com, so the extension never reaches the real
 * one. `episodes`, when given, holds the episode list until it settles.
 */
export async function fakeWebtoons({
	episodes
}: { episodes?: Promise<void> } = {}): Promise<FakeSite> {
	const art = {
		cover: await image(40, 60, '#3a6b8c'),
		page: await image(400, 600, '#8c5a3a')
	};
	const asked: string[] = [];
	const answered = async (url: URL) => {
		asked.push(url.host + url.pathname);
		return answer(url, art, episodes);
	};

	// Firefox's way in: a certificate for the two hosts, an HTTPS server with
	// it, and a proxy that hands it every CONNECT.
	const dir = mkdtempSync(join(tmpdir(), 'tsundoku-fake-site-'));
	execFileSync(
		'openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-days',
			'1',
			'-keyout',
			join(dir, 'key.pem'),
			'-out',
			join(dir, 'cert.pem'),
			'-subj',
			'/CN=www.webtoons.com',
			'-addext',
			`subjectAltName=${FAKED_HOSTS.map((h) => `DNS:${h}`).join(',')}`
		],
		{ stdio: 'ignore' }
	);
	const tls = createHttpsServer(
		{ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
		(req, res) => {
			const url = new URL(req.url ?? '/', `https://${req.headers.host}`);
			void answered(url).then((a) =>
				res.writeHead(a.status, { 'content-type': a.contentType }).end(a.body)
			);
		}
	);
	rmSync(dir, { recursive: true, force: true });
	await new Promise<void>((resolve) => tls.listen(0, '127.0.0.1', resolve));
	const tlsPort = (tls.address() as AddressInfo).port;
	// Firefox's proxy for everything (a fixed setting: a proxy script loads
	// asynchronously, and requests made meanwhile failed at random). The
	// made-up hosts go to the server above; any other host is tunnelled to
	// itself, so CheerpJ's CDN and the rest are untouched. Loopback never
	// goes through a proxy in Firefox.
	const proxy = createServer((_req, res) => res.writeHead(405).end());
	proxy.on('connect', (req, client, head) => {
		const [host, port] = (req.url ?? '').split(':');
		const faked = FAKED_HOSTS.includes(host);
		const upstream = connect(
			faked ? tlsPort : Number(port) || 443,
			faked ? '127.0.0.1' : host,
			() => {
				client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
				upstream.write(head);
				upstream.pipe(client);
				client.pipe(upstream);
			}
		);
		upstream.on('error', () => client.destroy());
		client.on('error', () => upstream.destroy());
	});
	await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
	const proxyPort = (proxy.address() as AddressInfo).port;

	return {
		asked,
		async route(context) {
			await context.route(/^https:\/\/(www|m)\.webtoons\.com\//, async (route) => {
				const a = await answered(new URL(route.request().url()));
				await route.fulfill(a);
			});
		},
		firefoxPrefs: {
			'network.proxy.type': 1,
			'network.proxy.ssl': '127.0.0.1',
			'network.proxy.ssl_port': proxyPort,
			'network.proxy.share_proxy_settings': false
		},
		close() {
			proxy.close();
			tls.close();
		}
	};
}
