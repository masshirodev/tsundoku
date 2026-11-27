/**
 * A new build under an open tab (doc/WEB-EDITION.md, "A new build"; c1138).
 *
 * The old build's server runs in the leading tab and loads its route chunks
 * lazily. A deploy replaces the host's files and brings a new service
 * worker, which takes over at once. Before c1138 it deleted the old build's
 * files: the next route the old server needed was gone from the cache and
 * from the host, and the tab broke with a 500 until it was reopened.
 *
 * Here a second build is made from `build-web/` the way a deploy changes the
 * host: a new version, and every server chunk under a new name, so none of the
 * old ones is on the host any more. One tab opens on the old build, the host
 * switches, the new worker comes in, and:
 *
 * - the open tab still reaches a screen whose server chunk it had not loaded;
 * - a tab opened meanwhile runs the old build too, the one its server runs;
 * - once the app sees the deploy, the next tap moves both tabs to the new
 *   build together, and the old build's files go once no tab runs it.
 */
import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import {
	createReadStream,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
	cpSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative } from 'node:path';
import type { AddressInfo } from 'node:net';

const OLD = normalize(join(import.meta.dirname, '..', '..', 'build-web'));

const TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.webmanifest': 'application/manifest+json'
};

/** A static host whose files can be replaced, as a deploy does (web/serve.js, without ranges). */
async function host(start: string) {
	let root = start;
	const server: Server = createServer((req, res) => {
		const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
		let file = normalize(join(root, path === '/' ? 'index.html' : path));
		if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory())
			file = join(root, 'index.html');
		res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
		res.setHeader('Content-Length', String(statSync(file).size));
		createReadStream(file).pipe(res);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return {
		url: `http://localhost:${(server.address() as AddressInfo).port}`,
		deploy: (to: string) => void (root = to),
		close: () => new Promise<void>((resolve) => server.close(() => resolve()))
	};
}

const versionOf = (dir: string) =>
	(JSON.parse(readFileSync(join(dir, '_app', 'version.json'), 'utf8')) as { version: string })
		.version;

const textFiles = (dir: string): string[] =>
	readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile() && /\.(js|json|html|css|webmanifest)$/.test(e.name))
		.map((e) => join(e.parentPath, e.name));

/**
 * The next build: `build-web/` copied, its version changed everywhere it is
 * written, and each server chunk renamed (every reference with it), so the
 * host no longer has a single one of the old build's chunks.
 */
function nextBuild(): { dir: string; version: string } {
	const dir = mkdtempSync(join(tmpdir(), 'tsundoku-next-build-'));
	cpSync(OLD, dir, { recursive: true });
	const old = versionOf(OLD);
	const version = `${old}9`;
	const serverDir = join(dir, 'server');
	const renamed = readdirSync(serverDir)
		.filter((f) => f.endsWith('.js') && f !== 'worker.js')
		.map((f) => [f, f.replace(/\.js$/, 'n.js')] as const);
	for (const [from, to] of renamed) {
		writeFileSync(join(serverDir, to), readFileSync(join(serverDir, from)));
		rmSync(join(serverDir, from));
	}
	for (const file of textFiles(dir)) {
		let text = readFileSync(file, 'utf8');
		const before = text;
		text = text.replaceAll(old, version);
		// Longest names first, so no name is replaced inside another.
		for (const [from, to] of [...renamed].sort((a, b) => b[0].length - a[0].length))
			text = text.replaceAll(from, to);
		if (text !== before) writeFileSync(file, text);
	}
	expect(relative(dir, serverDir)).toBe('server');
	return { dir, version };
}

async function started(page: Page) {
	await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', { timeout: 30_000 });
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
}

/** The build a tab runs; read again once a reload under it is over. */
async function buildOf(page: Page): Promise<string> {
	for (let i = 0; ; i++) {
		try {
			await page.waitForLoadState();
			return await page.evaluate(() => document.documentElement.dataset.webBuild ?? '');
		} catch (e) {
			// The tab moved on to the new build while it was read.
			if (i > 5) throw e;
		}
	}
}

/** The build of the service worker controlling the page. */
const workerBuild = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<string>((resolve) => {
				const channel = new MessageChannel();
				channel.port1.onmessage = ({ data }) => resolve(String(data));
				navigator.serviceWorker.controller?.postMessage({ type: 'tsundoku-worker-build' }, [
					channel.port2
				]);
			})
	);

const shells = (page: Page) =>
	page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('tsundoku-shell-')));

test('a deploy under an open tab: nothing breaks, and the tabs move to the new build together', async ({
	browser
}) => {
	test.setTimeout(180_000);
	const next = nextBuild();
	const old = versionOf(OLD);
	const site = await host(OLD);
	const context = await browser.newContext({ baseURL: site.url });
	try {
		const page = await context.newPage();
		await page.goto('/');
		await started(page);
		expect(await buildOf(page)).toBe(old);
		// The tab keeps the build for offline use once it runs (MESSAGES.precache);
		// its server chunks must be in before the host loses them.
		await expect
			.poll(
				() =>
					page.evaluate(
						async (name) =>
							(await (await caches.open(name)).keys()).filter((r) =>
								new URL(r.url).pathname.startsWith('/server/')
							).length,
						`tsundoku-shell-${old}`
					),
				{ timeout: 60_000 }
			)
			.toBeGreaterThan(10);

		// The deploy: new files on the host, and the new worker in.
		site.deploy(next.dir);
		await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
		// Watched on the registration, not by asking the worker: a message is an
		// event, and Chromium hands over only once the old worker is idle.
		await expect
			.poll(
				() =>
					page.evaluate(async () => {
						const r = await navigator.serviceWorker.getRegistration();
						return !r?.installing && !r?.waiting;
					}),
				{ timeout: 30_000 }
			)
			.toBe(true);
		expect(await workerBuild(page)).toBe(next.version);

		// The old server reaches a screen it had not loaded: its chunk is the
		// old build's, kept, though the host has none of them now.
		await page.getByRole('link', { name: 'SETTINGS', exact: true }).click();
		await expect(page).toHaveURL(/\/settings/);
		await expect(page.getByRole('heading', { name: /01 — READING/ })).toBeVisible();
		expect(await buildOf(page)).toBe(old);

		// A tab opened now runs the build its server runs.
		const second = await context.newPage();
		await second.goto('/');
		await started(second);
		expect(await buildOf(second)).toBe(old);

		// The app sees the deploy (it asks when it comes back to the front),
		// and the next tap takes both tabs to the new build.
		// It learns of a deploy by asking `/_app/version.json` when it comes back
		// to the front; the tap after that moves every tab. A tap made before the
		// answer is an ordinary one, so it is tried again, as a reader would.
		for (let i = 0; i < 10 && (await buildOf(page)) === old; i++) {
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			await page.waitForTimeout(500);
			await page.getByRole('link', { name: 'HELP', exact: true }).click();
			await page.waitForTimeout(1_500);
		}
		await page.getByRole('link', { name: 'SETTINGS', exact: true }).click();
		await expect(page).toHaveURL(/\/settings/);
		await started(page);
		await expect.poll(() => buildOf(page), { timeout: 30_000 }).toBe(next.version);
		await expect.poll(() => buildOf(second), { timeout: 30_000 }).toBe(next.version);
		await started(second);
		await expect(page.getByRole('heading', { name: /01 — READING/ })).toBeVisible();

		// No tab runs the old build: its files go.
		await expect
			.poll(() => shells(page), { timeout: 30_000 })
			.toEqual([`tsundoku-shell-${next.version}`]);
	} finally {
		await context.close();
		await site.close();
		rmSync(next.dir, { recursive: true, force: true });
	}
});
