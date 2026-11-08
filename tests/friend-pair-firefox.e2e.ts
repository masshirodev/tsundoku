import { expect, test } from './fixtures';
import {
	devices,
	type APIRequestContext,
	type Browser,
	type BrowserContextOptions,
	type Page
} from '@playwright/test';
import { connect, createServer as tcpServer, type Socket } from 'node:net';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { makeLogin, writeLogin } from '../src/lib/server/login.ts';
import { FRIEND_HOME, FRIEND_PORT } from './friend-world';

/**
 * A pairing link opened by a real browser (c723; doc/WIFI.md, "Signing in
 * over Wi-Fi"): the friend's phone, Firefox for Android, saw the tab "opening
 * and closing". The pair route is not a no-op on a second GET (it redeems the
 * code once and sends a repeat to `/login?pair=used`), so every request the
 * computer sees is logged and counted, and so is every main-frame
 * navigation the browser commits.
 *
 * What sees the requests: a logging relay on the computer's own home
 * address, in front of the friend install's real Wi-Fi listener. It records
 * each connection's first bytes (a TLS ClientHello is an https attempt, which
 * it passes on to the plain-http listener untouched, so the browser meets
 * exactly the refusal it would meet there) and each plain request's method,
 * path and answer. The Host is rewritten to the listener's own, which the
 * DNS-rebinding guard requires; the redirects are relative, so nothing else
 * needs rewriting.
 *
 * Firefox, in the friend project's Chromium run, as
 * tests/browse-player-pip-firefox.e2e.ts does, by `test.use` per describe:
 * Playwright's own Firefox profile turns HTTPS-First off
 * (`pref("dom.security.https_first", false)` in its playwright.cfg), so the
 * cases name the prefs: as Playwright ships it, HTTPS-First on with
 * Firefox's own defaults for the rest, and HTTPS-First on with its two
 * exemptions turned off (local addresses, custom ports). Then the Chromium
 * phone the card's done line asks for (Pixel 7 emulation). In the friend
 * project, whose one worker runs its files in order, so WI-FI is switched on
 * here and off again before friend-wifi.e2e.ts expects it off, and every
 * phone paired here is signed out again.
 */
test.describe.configure({ mode: 'serial' });

const local = `http://localhost:${FRIEND_PORT}`;
type Wifi = { on: boolean; phone: string | null; code: { url: string; state: string } | null };

/** A fresh code through the computer's own NEW CODE (POST /api/wifi), and the phone's address. */
async function freshCode(request: APIRequestContext): Promise<{ phone: string; code: string }> {
	const r = await request.post(`${local}/api/wifi`, { data: { action: 'code' } });
	expect(r.ok()).toBe(true);
	const w = (await r.json()) as Wifi;
	expect(w.code?.state).toBe('live');
	return { phone: w.phone!, code: new URL(w.code!.url).pathname };
}

type Relay = { origin: string; seen: string[]; close(): Promise<void> };

/** The logging relay, on the listener's own address and a port from the OS. */
async function relay(target: URL): Promise<Relay> {
	const seen: string[] = [];
	const sockets = new Set<Socket>();
	const plain = httpServer((req, res) => {
		const paired = /tsundoku_paired/.test(req.headers.cookie ?? '') ? ' +paired-cookie' : '';
		const asked = `${req.method} ${req.url}${paired}`;
		const up = httpRequest(
			{
				host: target.hostname,
				port: Number(target.port),
				method: req.method,
				path: req.url,
				headers: { ...req.headers, host: target.host }
			},
			(r) => {
				const to = r.headers.location ? ` ${r.headers.location}` : '';
				seen.push(`${asked} -> ${r.statusCode}${to}`);
				res.writeHead(r.statusCode ?? 502, r.headers);
				r.pipe(res);
			}
		);
		up.on('error', () => {
			seen.push(`${asked} -> relay error`);
			res.destroy();
		});
		req.pipe(up);
	});
	const tcp = tcpServer((sock) => {
		sockets.add(sock);
		sock.on('close', () => sockets.delete(sock));
		sock.on('error', () => sock.destroy());
		sock.once('data', (first) => {
			if (first[0] === 0x16) {
				// A TLS record: the browser tried https on this port first.
				seen.push('TLS ClientHello (https attempt)');
				const up = connect(Number(target.port), target.hostname);
				sockets.add(up);
				up.on('close', () => sockets.delete(up));
				up.on('error', () => sock.destroy());
				up.write(first);
				sock.pipe(up).pipe(sock);
				return;
			}
			sock.pause();
			sock.unshift(first);
			plain.emit('connection', sock);
			sock.resume();
		});
	});
	await new Promise<void>((ok) => tcp.listen(0, target.hostname, ok));
	const port = (tcp.address() as { port: number }).port;
	return {
		origin: `http://${target.hostname}:${port}`,
		seen,
		close: () =>
			new Promise<void>((ok) => {
				for (const s of sockets) s.destroy();
				tcp.close(() => ok());
			})
	};
}

/**
 * Opens a pair link the way a scanned code does, a new tab with nothing in
 * its jar, and returns the main-frame URLs it committed and the requests the
 * computer saw. The window after the welcome screen is the one measured wait:
 * Firefox's HTTPS-First sends its plain-http fallback on a 3000 ms timer
 * (`dom.security.https_only_fire_http_request_background_timer_ms`), so a
 * reload it caused would land inside 4 s of the page settling.
 */
async function openPairLink(
	browser: Browser,
	request: APIRequestContext,
	options: BrowserContextOptions = {}
) {
	const { phone, code } = await freshCode(request);
	const r = await relay(new URL(phone));
	const ctx = await browser.newContext({
		viewport: { width: 412, height: 915 },
		locale: 'en-US',
		...options,
		storageState: { cookies: [], origins: [] }
	});
	const tab = await ctx.newPage();
	const at = (u: string) => new URL(u).pathname + new URL(u).search;
	// Document requests the tab made (each one a load the person sees), and
	// every URL the main frame committed, same-document history entries included.
	const documents: string[] = [];
	const navigations: string[] = [];
	tab.on('request', (q) => {
		if (q.isNavigationRequest() && q.frame() === tab.mainFrame()) documents.push(at(q.url()));
	});
	tab.on('framenavigated', (f) => {
		if (f === tab.mainFrame()) navigations.push(at(f.url()));
	});
	try {
		await tab.goto(`${r.origin}${code}`);
		await expect(tab).toHaveURL(/\/welcome$/);
		await expect(tab.locator('main.welcome h1')).toBeVisible();
		await tab.waitForLoadState('networkidle');
		await tab.waitForTimeout(4000);
		const secure = await tab.evaluate(() => ({
			secureContext: window.isSecureContext,
			serviceWorker: 'serviceWorker' in navigator,
			// The one document load the tab made, and how it was made.
			loads: performance
				.getEntriesByType('navigation')
				.map((n) => (n as PerformanceNavigationTiming).type)
		}));
		// Signed in: the library answers this tab, not the sign-in page.
		const library = await ctx.request.get(`${r.origin}/`, { maxRedirects: 0 });
		return {
			tab,
			documents,
			navigations,
			seen: [...r.seen],
			secure,
			libraryStatus: library.status(),
			finalUrl: tab.url(),
			done: async () => {
				await ctx.close();
				await r.close();
			}
		};
	} catch (e) {
		await ctx.close();
		await r.close();
		throw e;
	}
}

/** What the measurement asserts, and prints so the notes quote the run, not an expectation. */
function judge(label: string, m: Awaited<ReturnType<typeof openPairLink>>) {
	console.log(`[c723] ${label}: document requests ${JSON.stringify(m.documents)}`);
	console.log(`[c723] ${label}: main-frame commits ${JSON.stringify(m.navigations)}`);
	// The assets are the page's own; the requests that matter are the rest.
	const asset = /^GET \/(_app|icons|favicon|manifest)/;
	const assets = m.seen.filter((l) => asset.test(l));
	for (const line of m.seen.filter((l) => !asset.test(l)))
		console.log(`[c723] ${label}: seen ${line}`);
	console.log(
		`[c723] ${label}: seen ${assets.length} asset requests, ${assets.filter((l) => !/-> 200$/.test(l)).length} not 200`
	);
	console.log(`[c723] ${label}: ${JSON.stringify(m.secure)}, library ${m.libraryStatus}`);
	// The link is asked for once, and only once: a second GET would be a redeem of a used code.
	expect(m.seen.filter((l) => /^GET \/pair\//.test(l))).toHaveLength(1);
	// One navigation: the link, its one redirect, the welcome screen. No reload,
	// no bounce, no second document. A same-document commit (SvelteKit's own
	// history.replaceState as it starts, which Firefox reports as a frame
	// navigation, and so does Chromium) is not a load.
	expect(m.documents).toEqual([
		new URL(m.seen.find((l) => /^GET \/pair\//.test(l))!.split(' ')[1], 'http://x').pathname,
		'/welcome'
	]);
	expect(new Set(m.navigations)).toEqual(new Set(['/welcome']));
	expect(
		m.seen.filter((l) => /^(GET|POST) \/(login|pair)/.test(l) && !/-> 303 \/welcome$/.test(l))
	).toHaveLength(0);
	// Plain http over a home address: no service worker to reload or hand off the tab.
	expect(m.secure).toEqual({
		secureContext: false,
		serviceWorker: false,
		loads: ['navigate']
	});
	expect(m.libraryStatus).toBe(200);
}

test.beforeAll(async ({ request }) => {
	writeLogin(FRIEND_HOME, makeLogin(null));
	const r = await request.post(`${local}/api/wifi`, { data: { action: 'on' } });
	expect(r.ok()).toBe(true);
	await expect
		.poll(async () => ((await (await request.get(`${local}/api/wifi`)).json()) as Wifi).phone, {
			timeout: 15_000
		})
		.toMatch(/^http:\/\//);
});

test.afterAll(async ({ browser, request }) => {
	// Every phone paired here off again, through the computer's own SIGN OUT,
	// then WI-FI off: friend-wifi.e2e.ts starts from OFF with no paired row.
	const page: Page = await browser.newPage({ storageState: { cookies: [], origins: [] } });
	try {
		await page.goto(`${local}/settings#s-devices`);
		const out = page.getByRole('button', { name: 'SIGN OUT' });
		for (let n = await out.count(); n > 0; n = await out.count()) {
			await out.first().click();
			await expect(out).toHaveCount(n - 1);
		}
	} finally {
		await page.close();
		await request.post(`${local}/api/wifi`, { data: { action: 'off' } });
	}
});

type Launch = { name: string; browser: 'firefox' | 'chromium'; prefs?: Record<string, boolean> };

/**
 * Each browser launched by the case itself, through the `playwright` fixture:
 * a `browserName` or `launchOptions` in a describe would force a worker of its
 * own, which Playwright refuses there.
 */
const LAUNCHES: { launch: Launch; options?: BrowserContextOptions; title: string }[] = [
	{
		title:
			'Firefox as Playwright ships it (HTTPS-First off): the link lands once, signed in (c723)',
		launch: { name: 'firefox, https_first off', browser: 'firefox' }
	},
	{
		title:
			'Firefox with HTTPS-First on and its own exemptions as they are, in Portuguese: the link lands once, signed in (c723)',
		launch: {
			name: 'firefox, https_first on',
			browser: 'firefox',
			prefs: { 'dom.security.https_first': true }
		},
		options: { locale: 'pt-BR' }
	},
	{
		title:
			'Firefox with HTTPS-First on and its local-address and custom-port exemptions off: the link still lands once (c723)',
		launch: {
			name: 'firefox, https_first on, no exemptions',
			browser: 'firefox',
			prefs: {
				'dom.security.https_first': true,
				'dom.security.https_first_for_local_addresses': true,
				'dom.security.https_first_for_custom_ports': true
			}
		}
	},
	{
		title: 'Chromium as a Pixel 7: the link lands once, signed in (c723)',
		launch: { name: 'chromium pixel 7', browser: 'chromium' },
		// Its context options, as Playwright's documentation spreads a device.
		options: devices['Pixel 7']
	}
];

for (const { title, launch, options } of LAUNCHES)
	test(title, async ({ playwright, request }) => {
		const browser = await playwright[launch.browser].launch(
			launch.prefs ? { firefoxUserPrefs: launch.prefs } : {}
		);
		try {
			const m = await openPairLink(browser, request, options);
			try {
				judge(launch.name, m);
			} finally {
				await m.done();
			}
		} finally {
			await browser.close();
		}
	});

/**
 * The control: the relay does see an https attempt when Firefox makes one.
 * HTTPS-Only mode (a setting Firefox for Android offers, off by default)
 * with local addresses included sends a TLS ClientHello to the plain-http
 * port and, with nothing to fall back to without a press, shows its own
 * error page: the link is never asked for over http, so the code stays live.
 * Without this case, "no ClientHello" above could mean the relay is blind.
 */
test('the relay sees an https attempt: Firefox in HTTPS-Only mode never asks for the link over http (c723)', async ({
	playwright,
	request
}) => {
	const browser = await playwright.firefox.launch({
		firefoxUserPrefs: {
			'dom.security.https_only_mode': true,
			'dom.security.https_only_mode.upgrade_local': true
		}
	});
	const { phone, code } = await freshCode(request);
	const r = await relay(new URL(phone));
	try {
		const tab = await browser.newPage();
		await tab.goto(`${r.origin}${code}`).catch(() => undefined);
		await expect.poll(() => r.seen.some((l) => l.startsWith('TLS ClientHello'))).toBe(true);
		await tab.waitForLoadState('load').catch(() => undefined);
		for (const line of r.seen) console.log(`[c723] firefox, https_only: seen ${line}`);
		console.log(`[c723] firefox, https_only: tab at ${tab.url()}`);
		expect(r.seen.filter((l) => /^GET \/pair\//.test(l))).toHaveLength(0);
		const w = (await (await request.get(`${local}/api/wifi`)).json()) as Wifi;
		expect(w.code?.state).toBe('live');
	} finally {
		await browser.close();
		await r.close();
	}
});
