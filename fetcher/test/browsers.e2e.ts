// The built fetcher extension in real Chromium and Firefox, against a local
// server that records what it received (server.ts), and the store build's
// refusal of loopback pages. Run with `yarn run test:fetcher`, which builds
// both editions first; doc/TESTING.md, "The fetcher extension".
import { expect, test, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'vite';
import { startServer, type Received } from './server.ts';
import { BINARY_ANSWER, ENGINE_AGENT } from './shared.ts';
import { builtInAllowed, GUARD_FIRST_ID, guardRules } from '../../src/lib/fetcher/reach.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
// The development build answers the test server's loopback page; the store
// build must not.
const extension = `${root}build-fetcher/development`;
// The same scripts with Firefox's manifest (fetcher/build.ts).
const firefoxExtension = `${root}build-fetcher/development-firefox`;
const store = `${root}build-fetcher/store`;
const built = [extension, firefoxExtension, store].every((dir) =>
	existsSync(`${dir}/manifest.json`)
);
const manifest = built ? JSON.parse(readFileSync(`${extension}/manifest.json`, 'utf8')) : {};
// The system Firefox: Playwright's own build cannot install add-ons, and
// web-ext drives a release one.
const firefoxBinary = process.env.FIREFOX ?? '/usr/bin/firefox';

let pageScript = '';

test.beforeAll(async () => {
	const output = await build({
		configFile: false,
		logLevel: 'warn',
		build: {
			write: false,
			minify: false,
			lib: {
				entry: fileURLToPath(new URL('./page.ts', import.meta.url)),
				formats: ['iife'],
				name: 'fetcherTestPage'
			}
		}
	});
	const [first] = Array.isArray(output) ? output : [output];
	if (!('output' in first)) throw new Error('the page did not build');
	pageScript = first.output[0].code;
});

type Server = Awaited<ReturnType<typeof startServer>>;

/** Waits until every labelled page has reported. */
async function reported(server: Server, labels: string[]) {
	await expect
		.poll(() => labels.every((label) => server.results.has(label)), {
			timeout: 60_000,
			message: `${labels.join(' and ')} report what they saw`
		})
		.toBe(true);
}

/** Waits until the page and the foreign page have both reported. */
async function results(server: Server) {
	await reported(server, ['page', 'foreign']);
	return {
		page: server.results.get('page') as PageResult,
		foreign: server.results.get('foreign') as { state: string }
	};
}

interface CaseResult<T> {
	ok: boolean;
	value?: T;
	error?: string;
}
interface Summary {
	status: number;
	url: string;
	redirected: boolean;
	headers: [string, string][];
	bytes: number[];
	text: string;
}
interface PageResult {
	state: string;
	protocol: number;
	version: string;
	transport: string;
	access: string;
	userAgent: string;
	cases: Record<string, CaseResult<Summary>> & {
		same: CaseResult<number[]>;
		many: CaseResult<number[]>;
	};
}

function urls(port: number) {
	return {
		setCookies: `http://localhost:${port}/set-cookies`,
		page: `http://127.0.0.1:${port}/page?label=page`,
		// Not one of tsundoku's origins: the fetcher must not answer here.
		foreign: `http://[::1]:${port}/page?label=foreign`
	};
}

function only(received: Received[], url: string): Received {
	const matching = received.filter((r) => r.url === url);
	expect(matching, `one request to ${url}`).toHaveLength(1);
	return matching[0];
}

function cookies(header: string | string[] | undefined): string[] {
	return String(header ?? '')
		.split(';')
		.map((c) => c.trim())
		.filter(Boolean)
		.sort();
}

function assertRun(
	port: number,
	received: Received[],
	{ page, foreign }: { page: PageResult; foreign: { state: string } },
	transport: 'binary' | 'base64'
) {
	expect(foreign.state, 'no fetcher on a foreign origin').toBe('missing');
	expect(page.state).toBe('ready');
	expect(page.protocol).toBe(2);
	expect(page.version).toBe(manifest.version);
	expect(page.access, 'site access, granted').toBe('all');
	expect(page.transport, 'how this browser carries bytes in runtime messages').toBe(transport);
	const { cases } = page;

	// A site holding a clearance: both its jars' cookies, the page's own
	// Cookie dropped, the browser's User-Agent, the page's Referer.
	expect(cases.clearance).toMatchObject({ ok: true, value: { status: 200 } });
	const clearance = only(received, '/echo?case=clearance');
	expect(cookies(clearance.headers.cookie), 'unpartitioned and partitioned cookies').toEqual([
		'cf_clearance=c1',
		'plain=p1'
	]);
	expect(clearance.headers['user-agent'], "the browser's own User-Agent").toBe(page.userAgent);
	expect(clearance.headers.referer).toBe(`http://localhost:${port}/from`);
	expect(clearance.headers['x-tsundoku-test']).toBe('yes');
	expect(clearance.headers['accept-encoding']).not.toBe('x-made-up');
	expect(clearance.headers.origin).toBeUndefined();

	// A site with no clearance and no cookies: the engine's User-Agent and
	// Origin, no Cookie at all, and the bytes both ways exactly.
	expect(cases.post.ok, cases.post.error).toBe(true);
	const post = only(received, '/echo?case=post&binary=1');
	expect(post.method).toBe('POST');
	expect(post.headers['user-agent']).toBe(ENGINE_AGENT);
	expect(post.headers.origin).toBe(`http://[::1]:${port}`);
	expect(post.headers['content-type']).toBe('application/octet-stream');
	expect(post.headers.cookie).toBeUndefined();
	expect(post.body).toEqual(Array.from({ length: 256 }, (_, i) => i));
	expect(cases.post.value?.bytes).toEqual(BINARY_ANSWER);

	// A compressed answer reaches the page decoded, without the headers that
	// described the encoded bytes.
	expect(cases.gzip.ok, cases.gzip.error).toBe(true);
	expect(JSON.parse(cases.gzip.value!.text).case).toBe('gzip');
	const gzipHeaders = cases.gzip.value!.headers.map(([name]) => name.toLowerCase());
	expect(gzipHeaders).not.toContain('content-encoding');
	expect(gzipHeaders).not.toContain('content-length');

	expect(cases.redirect.ok, cases.redirect.error).toBe(true);
	expect(cases.redirect.value).toMatchObject({ redirected: true, status: 200 });
	expect(cases.redirect.value!.url).toMatch(/\/echo\?case=redirected$/);

	// Concurrent requests each carried their own headers.
	expect(cases.same).toEqual({ ok: true, value: Array(8).fill(200) });
	const same = received.filter((r) => r.url === '/echo?case=same');
	expect(same).toHaveLength(8);
	for (const r of same)
		expect(r.headers.referer).toMatch(new RegExp(`/ref/${r.headers['x-seq']}$`));
	expect(new Set(same.map((r) => r.headers['x-seq'])).size).toBe(8);

	expect(cases.many).toEqual({ ok: true, value: Array(8).fill(200) });
	const many = received.filter((r) => r.url.startsWith('/echo?case=many'));
	expect(many).toHaveLength(8);
	for (const r of many) {
		const n = new URL(r.url, 'http://x').searchParams.get('n');
		expect(r.headers['user-agent']).toBe(`${ENGINE_AGENT} n${n}`);
		expect(r.headers.referer).toMatch(new RegExp(`/ref/${n}$`));
	}

	expect(cases.unreachable.ok).toBe(false);
	expect(cases.unreachable.error).toMatch(/^network error/);
	expect(cases.notHttp).toEqual({ ok: false, error: 'only http and https are fetched, not file:' });

	// The reader's own network (c1140). Asked for: refused before anything
	// is sent. Redirected to: the browser's rules stop the hop, and the page
	// is told which address it was.
	expect(cases.privateLiteral.ok).toBe(false);
	expect(cases.privateLiteral.error).toMatch(/^refused: 127\.0\.0\.2 is on your own network/);
	expect(
		received.some((r) => r.url === '/echo?case=literal'),
		'nothing sent to 127.0.0.2'
	).toBe(false);
	expect(cases.privateHop.ok).toBe(false);
	expect(cases.privateHop.error).toMatch(/^refused: 127\.0\.0\.2 is on your own network/);
	only(received, '/redirect-private');
	expect(
		received.some((r) => r.url === '/echo?case=hop'),
		'the hop was never sent'
	).toBe(false);
}

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test('the fetcher in Chromium', async ({}, testInfo) => {
	test.skip(!built, 'run yarn run test:fetcher, which builds both editions');
	const server = await startServer(pageScript);
	const profile = testInfo.outputPath('chromium-profile');
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		args: [
			`--disable-extensions-except=${extension}`,
			`--load-extension=${extension}`,
			// A public-looking name that leads to the reader's own machine.
			'--host-resolver-rules=MAP rebind.test 127.0.0.2'
		]
	});
	try {
		const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
		const at = urls(server.port);
		const visit = await context.newPage();
		await visit.goto(at.setCookies);
		await (await context.newPage()).goto(at.page);
		await (await context.newPage()).goto(at.foreign);
		const run = await results(server);
		// The clearance really is in the site's partition, where an extension's
		// request does not find it on its own.
		const jars = await worker.evaluate(async (url) => {
			const names = (cookies: { name: string }[]) => cookies.map((c) => c.name).sort();
			return {
				unpartitioned: names(await chrome.cookies.getAll({ url })),
				partition: names(
					await chrome.cookies.getAll({ url, partitionKey: { topLevelSite: 'http://localhost' } })
				)
			};
		}, at.setCookies);
		expect(jars.unpartitioned).toEqual(['plain']);
		expect(jars.partition).toContain('cf_clearance');
		console.log(
			`chromium: transport ${run.page.transport}, access ${run.page.access}, ${run.page.userAgent}`
		);
		assertRun(server.port, server.received, run, 'base64');
		// Where a public-looking name led to the reader's own network,
		// Chromium can only tell afterwards: the request reached 127.0.0.2, and
		// its answer was thrown away (doc/WEB-EDITION.md, "The reader's own
		// network"). Firefox looks the name up first; its spec is the unit's.
		expect(run.page.cases.rebind.ok).toBe(false);
		expect(run.page.cases.rebind.error).toMatch(
			/^refused: rebind\.test led to 127\.0\.0\.2, which is on your own network/
		);
		only(server.received, '/echo?case=rebind');
		// Every request's rule was removed once it was answered; the guard's
		// (src/lib/fetcher/reach.ts) stay, numbered from GUARD_FIRST_ID.
		const left = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
		expect(left.filter((r) => r.id < GUARD_FIRST_ID)).toEqual([]);
		expect(left.length).toBe(guardRules(builtInAllowed('development')).length);
	} finally {
		await context.close();
		await server.close();
		rmSync(profile, { recursive: true, force: true });
	}
});

/**
 * Starts headless Firefox with the extension installed by web-ext as a
 * temporary add-on, which is how a developer loads it by hand too. Its start
 * URLs open as tabs. No preference grants site access: Firefox 155 grants
 * the manifest's host permissions when the add-on is installed (a visitor can
 * withdraw them later in about:addons, which is the hello's `none`).
 */
function firefox(profile: string, startUrls: string[]) {
	const child = spawn(
		`${root}node_modules/.bin/web-ext`,
		[
			'run',
			'--source-dir',
			firefoxExtension,
			'--firefox',
			firefoxBinary,
			'--firefox-profile',
			profile,
			'--profile-create-if-missing',
			'--keep-profile-changes',
			'--no-reload',
			'--no-input',
			'--arg=--headless',
			...startUrls.flatMap((url) => ['--start-url', url])
		],
		{ stdio: ['ignore', 'pipe', 'pipe'], detached: true }
	);
	let log = '';
	child.stdout.on('data', (d) => (log += d));
	child.stderr.on('data', (d) => (log += d));
	return {
		log: () => log.slice(-4000),
		async stop() {
			// web-ext and the Firefox it started share the process group it was
			// given, and nothing else is in it.
			try {
				process.kill(-child.pid!, 'SIGTERM');
			} catch {
				// Already gone.
			}
			await new Promise((r) => child.once('exit', r).once('error', r));
		}
	};
}

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test('the fetcher in Firefox', async ({}, testInfo) => {
	test.skip(!built, 'run yarn run test:fetcher, which builds both editions');
	test.skip(!existsSync(firefoxBinary), `no Firefox at ${firefoxBinary} (set FIREFOX)`);
	const server = await startServer(pageScript);
	const profile = testInfo.outputPath('firefox-profile');
	const at = urls(server.port);
	// The page waits until the cookie visit is done before it fetches.
	const browser = firefox(profile, [at.setCookies, at.page, at.foreign]);
	try {
		const run = await results(server).catch((error) => {
			throw new Error(`${error.message}\n--- web-ext ---\n${browser.log()}`);
		});
		console.log(
			`firefox: transport ${run.page.transport}, access ${run.page.access}, ${run.page.userAgent}`
		);
		assertRun(server.port, server.received, run, 'binary');
	} finally {
		await browser.stop();
		await server.close();
		rmSync(profile, { recursive: true, force: true });
	}
});

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test('the store build gives a loopback page no fetcher, in Chromium', async ({}, testInfo) => {
	test.skip(!built, 'run yarn run test:fetcher, which builds both editions');
	const server = await startServer(pageScript);
	const profile = testInfo.outputPath('chromium-store-profile');
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		args: [`--disable-extensions-except=${store}`, `--load-extension=${store}`]
	});
	try {
		// The extension is loaded and running: only the origin keeps it out.
		const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
		expect(await worker.evaluate(() => chrome.runtime.getManifest().name)).toBe('tsundoku fetcher');
		await (await context.newPage()).goto(urls(server.port).page);
		await reported(server, ['page']);
		expect(server.results.get('page')).toEqual({ state: 'missing' });
	} finally {
		await context.close();
		await server.close();
		rmSync(profile, { recursive: true, force: true });
	}
});

/**
 * Runs one built script in a fresh context with a fake browser, and returns
 * what it registered. Read from the bundles themselves, so what is checked is
 * what ships.
 */
function runBundle(file: string, origin: string) {
	const messageListeners: ((...args: unknown[]) => boolean)[] = [];
	const windowListeners: unknown[] = [];
	const sent: unknown[] = [];
	const api = {
		runtime: {
			id: 'ext',
			getManifest: () => ({ version: '0.0.0' }),
			getURL: (path: string) => `chrome-extension://ext/${path}`,
			sendMessage: async (message: unknown) => {
				sent.push(message);
				return undefined;
			},
			onMessage: { addListener: (l: (...args: unknown[]) => boolean) => messageListeners.push(l) }
		},
		cookies: { getAll: async () => [] },
		permissions: { contains: async () => true, getAll: async () => ({ origins: [] }) },
		declarativeNetRequest: { getSessionRules: async () => [], updateSessionRules: async () => {} },
		webRequest: {
			onBeforeRequest: { addListener: () => {} },
			onBeforeRedirect: { addListener: () => {} },
			onResponseStarted: { addListener: () => {} },
			onCompleted: { addListener: () => {} },
			onErrorOccurred: { addListener: () => {} }
		},
		storage: { local: { get: async () => ({}) }, onChanged: { addListener: () => {} } }
	};
	const window = {
		location: { origin },
		addEventListener: (_: string, l: unknown) => windowListeners.push(l),
		removeEventListener: () => {},
		postMessage: () => {}
	};
	vm.runInNewContext(readFileSync(file, 'utf8'), { chrome: api, window, fetch, URL, console });
	return { messageListeners, windowListeners, sent };
}

test('the store bundles refuse loopback pages, and the development bundles answer them', () => {
	test.skip(!built, 'run yarn run test:fetcher, which builds both editions');
	const probe = { kind: 'probe', bytes: new Uint8Array(1) };
	const sender = (origin: string) => ({ id: 'ext', tab: {}, frameId: 0, origin });
	for (const [dir, loopback] of [
		[store, false],
		[extension, true]
	] as const) {
		const content = runBundle(`${dir}/content.js`, 'http://127.0.0.1:42160');
		expect(content.windowListeners.length > 0, `${dir}: content script listens`).toBe(loopback);
		expect(content.sent.length > 0, `${dir}: content script probes`).toBe(loopback);
		expect(runBundle(`${dir}/content.js`, 'https://tsundoku.lt').windowListeners).toHaveLength(1);

		const [listener] = runBundle(`${dir}/background.js`, '').messageListeners;
		const keepsOpen = (origin: string) => listener(probe, sender(origin), () => {});
		expect(keepsOpen('http://localhost:5173'), `${dir}: background answers loopback`).toBe(
			loopback
		);
		expect(keepsOpen('https://tsundoku.lt')).toBe(true);
		expect(keepsOpen('https://example.com')).toBe(false);
	}
	const storeManifest = readFileSync(`${store}/manifest.json`, 'utf8');
	expect(storeManifest).not.toMatch(/127\.0\.0\.1|localhost/);
});
