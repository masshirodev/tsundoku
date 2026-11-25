// The built fetcher extension in real Chromium and Firefox, against a local
// server that records what it received (server.ts). Run with
// `yarn run test:fetcher`, which builds build-fetcher/ first; doc/TESTING.md,
// "The fetcher extension".
import { expect, test, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { startServer, type Received } from './server.ts';
import { BINARY_ANSWER, ENGINE_AGENT } from './shared.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const extension = `${root}build-fetcher`;
const manifest = JSON.parse(readFileSync(`${extension}/manifest.json`, 'utf8'));
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

/** Waits until the page and the foreign page have both reported. */
async function results(server: Awaited<ReturnType<typeof startServer>>) {
	await expect
		.poll(() => server.results.has('page') && server.results.has('foreign'), {
			timeout: 60_000,
			message: 'both pages report what they saw'
		})
		.toBe(true);
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
	expect(page.protocol).toBe(1);
	expect(page.version).toBe(manifest.version);
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
}

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test('the fetcher in Chromium', async ({}, testInfo) => {
	test.skip(!existsSync(`${extension}/manifest.json`), 'run yarn run build:fetcher first');
	const server = await startServer(pageScript);
	const profile = testInfo.outputPath('chromium-profile');
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
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
		console.log(`chromium: transport ${run.page.transport}, ${run.page.userAgent}`);
		assertRun(server.port, server.received, run, 'base64');
		// Every request's rule was removed once it was answered.
		expect(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).toEqual([]);
	} finally {
		await context.close();
		await server.close();
		rmSync(profile, { recursive: true, force: true });
	}
});

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test('the fetcher in Firefox', async ({}, testInfo) => {
	test.skip(!existsSync(`${extension}/manifest.json`), 'run yarn run build:fetcher first');
	test.skip(!existsSync(firefoxBinary), `no Firefox at ${firefoxBinary} (set FIREFOX)`);
	const server = await startServer(pageScript);
	const profile = testInfo.outputPath('firefox-profile');
	const at = urls(server.port);
	// web-ext installs the extension as a temporary add-on, which is how a
	// developer loads it by hand too. Its start URLs open as tabs; the page
	// waits until the cookie visit is done before it fetches.
	const firefox = spawn(
		`${root}node_modules/.bin/web-ext`,
		[
			'run',
			'--source-dir',
			extension,
			'--firefox',
			firefoxBinary,
			'--firefox-profile',
			profile,
			'--profile-create-if-missing',
			'--keep-profile-changes',
			'--no-reload',
			'--no-input',
			'--arg=--headless',
			// Manifest V3 host permissions are opt-in in Firefox: a visitor
			// grants them when installing, this grants them here.
			'--pref',
			'extensions.originControls.grantByDefault=true',
			'--start-url',
			at.setCookies,
			'--start-url',
			at.page,
			'--start-url',
			at.foreign
		],
		{ stdio: ['ignore', 'pipe', 'pipe'], detached: true }
	);
	let log = '';
	firefox.stdout.on('data', (d) => (log += d));
	firefox.stderr.on('data', (d) => (log += d));
	try {
		const run = await results(server).catch((error) => {
			throw new Error(`${error.message}\n--- web-ext ---\n${log.slice(-4000)}`);
		});
		console.log(`firefox: transport ${run.page.transport}, ${run.page.userAgent}`);
		assertRun(server.port, server.received, run, 'binary');
	} finally {
		// web-ext and the Firefox it started share the process group it was
		// given, and nothing else is in it.
		try {
			process.kill(-firefox.pid!, 'SIGTERM');
		} catch {
			// Already gone.
		}
		await new Promise((r) => firefox.once('exit', r).once('error', r));
		await server.close();
		rmSync(profile, { recursive: true, force: true });
	}
});
