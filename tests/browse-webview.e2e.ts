import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * The engine's WebView, as BROWSE and SETTINGS say it (doc/BROWSE.md,
 * "Extensions that need a WebView"; doc/SETTINGS.md, "07 — BROWSE"): the
 * quiet NEEDS A WEBVIEW mark on an extension and its sources, said
 * in words where this install has the WebView off; SETTINGS' WEBVIEW row and
 * its switch, which a release's launcher reads (here, the file the spec reads
 * back); the first-use line while the browser downloads; a failed call that
 * says the browser instead of "timed out", with TRY AGAIN only once it's
 * ready; and REMOVE. In the browse project for its fake engine, in a world of
 * its own: the engine's answers are the spec's to steer.
 */

const WEBVIEW = { id: '700', pkg: 'e2e.mkissa', name: 'MKissa' };
const PLAIN = { id: '701', pkg: 'e2e.plain', name: 'Plainsite' };

let work: string;
let dbPath: string;
let base: string;
let preview: ChildProcess | undefined;
let engine: Server;

/** What the fake engine answers: its capability, its /webview, and the WebView source's calls. */
const fake = {
	webview: false,
	status: { enabled: false, state: 'off' } as Record<string, unknown>,
	/** The WebView source's popular list: fails with the WebView's status while this is set. */
	failWith: null as Record<string, unknown> | null
};

function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address() as AddressInfo;
			s.close(() => resolve(port));
		});
	});
}

function startEngine(port: number): Promise<Server> {
	const server = createHttp((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const json = (v: unknown, status = 200) =>
				res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			if (req.url === '/capabilities') return json({ imageProxy: true, webview: fake.webview });
			if (req.url === '/webview') return json(fake.status);
			if (req.url === '/challenges') return json({ solving: {}, solved: {} });
			const b = JSON.parse(raw || '{}') as { method: string; sourceId?: string };
			if (b.sourceId === WEBVIEW.id && fake.failWith)
				return json(
					{ error: 'Timed out waiting for the WebView', code: 500, webview: fake.failWith },
					500
				);
			switch (b.method) {
				case 'filterSchemaManga':
				case 'filterSchemaAnime':
					return json([]);
				case 'supportLatestManga':
				case 'supportLatestAnime':
					return json(false);
				case 'getPopularManga':
				case 'getPopularAnime':
					return json({ mangas: [], animes: [], hasNextPage: false });
				default:
					return json([]);
			}
		});
	});
	return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

const switchFile = () => join(work, 'home', 'engine', 'webview.json');
const chromium = () => join(work, 'home', 'engine', 'app', 'webview', 'chromium');
const switchOn = () => {
	try {
		return (JSON.parse(readFileSync(switchFile(), 'utf8')) as { on: boolean }).on;
	} catch {
		return false;
	}
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-webview-'));
	dbPath = join(work, 'library.sqlite');
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		for (const [s, webview] of [
			[WEBVIEW, 1],
			[PLAIN, 0]
		] as const) {
			db.prepare(
				`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed, webview)
				VALUES (?, ?, 'anime', 1, '16.75', '16', ?, 0, 0, '', ?)`
			).run(s.pkg, s.name, s.pkg.padEnd(64, '0'), webview);
			db.prepare(
				`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://s.example')`
			).run(s.id, s.pkg, s.name);
		}
	} finally {
		db.close();
	}
	const enginePort = await freePort();
	engine = await startEngine(enginePort);
	const port = await freePort();
	base = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			ENGINE_URL: `http://127.0.0.1:${enginePort}`,
			ENGINE_TOKEN: 'e2e-engine-token',
			// As a release's launcher tells the app (ops/release/launcher/plan.ts).
			ENGINE_WEBVIEW_SWITCH: switchFile(),
			ENGINE_WEBVIEW_DIR: chromium(),
			TSUNDOKU_ANILIST: 'off',
			TSUNDOKU_HOME: join(work, 'home'),
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
			ENGINE_STORE: join(work, 'store'),
			BACKUP_DIR: join(work, 'backups')
		},
		stdio: 'ignore'
	});
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			up = (await fetch(base, { redirect: 'manual' })).status > 0;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	expect(up, 'the preview answered').toBe(true);
});

test.afterAll(async () => {
	preview?.kill();
	await new Promise<void>((ok) => (engine ? engine.close(() => ok()) : ok()));
	if (work) rmSync(work, { recursive: true, force: true });
});

const url = (path: string) => `${base}${path}`;
const row = (page: import('@playwright/test').Page, name: string) =>
	page.locator('a.row').filter({ has: page.locator('.t', { hasText: new RegExp(`^${name}$`) }) });

test('off on this install: the mark says so in words, and only on the source that needs it', async ({
	page
}) => {
	fake.webview = false;
	fake.status = { enabled: false, state: 'off' };
	await page.goto(url('/browse'));
	await expect(row(page, WEBVIEW.name).last().locator('.m')).toContainText(
		'NEEDS A WEBVIEW, WHICH THIS INSTALL HAS TURNED OFF'
	);
	await expect(row(page, PLAIN.name).last().locator('.m')).not.toContainText('WEBVIEW');

	await page.goto(url('/browse/extensions'));
	const ext = page.locator('.row').filter({ hasText: WEBVIEW.name });
	await expect(ext.locator('.m')).toContainText(
		'NEEDS A WEBVIEW, WHICH THIS INSTALL HAS TURNED OFF'
	);
	await expect(
		page.locator('.row').filter({ hasText: PLAIN.name }).locator('.m')
	).not.toContainText('WEBVIEW');
});

test('a call to it says the install has it off, not an error', async ({ page }) => {
	fake.failWith = { enabled: false, state: 'off' };
	await page.goto(url(`/browse/${WEBVIEW.id}`));
	const band = page.getByRole('status').filter({ hasText: 'NEEDS A WEBVIEW' });
	await expect(band).toContainText('NEEDS A WEBVIEW, WHICH THIS INSTALL HAS TURNED OFF');
	await expect(band).toContainText('SETTINGS › BROWSE › WEBVIEW');
	await expect(page.getByText('DID NOT ANSWER')).toHaveCount(0);
	fake.failWith = null;
});

test('SETTINGS: off, nothing downloaded; ON writes the switch and waits for the engine’s restart', async ({
	page
}) => {
	await page.goto(url('/settings?section=browse'));
	const r = page.locator('.row.webview');
	await expect(r.locator('.label')).toHaveText('WEBVIEW');
	await expect(r.getByRole('button', { name: 'OFF', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(r.locator('.wifi-meta').first()).toHaveText('OFF');
	await expect(r).toContainText('WITHOUT A SANDBOX');
	await expect(r).toContainText('NOT DOWNLOADED');
	await expect(r).toContainText(chromium());
	await expect(r.getByRole('button', { name: 'REMOVE' })).toHaveCount(0);

	await r.getByRole('button', { name: 'ON', exact: true }).click();
	await expect.poll(switchOn).toBe(true);
	// The fake engine is still the old one, off: the launcher would be restarting it.
	await expect(r.getByRole('button', { name: /^ON · RESTARTING THE ENGINE/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// Restarted with ENGINE_WEBVIEW=on: the row settles by itself.
	fake.webview = true;
	fake.status = { enabled: true, state: 'idle', dir: chromium() };
	await expect(r.locator('.wifi-meta').first()).toHaveText('NOT NEEDED YET', { timeout: 15_000 });
	await expect(r.getByRole('button', { name: 'ON', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('on: the mark is quiet, and the first download is counted where the extension is', async ({
	page
}) => {
	fake.webview = true;
	fake.status = { enabled: true, state: 'starting', phase: 'downloading', percent: 40 };
	// The app asks the engine's capabilities again after a few seconds (webview.ts,
	// CAPS_MS): the restart the last test stood in for shows within them.
	await expect
		.poll(
			async () => {
				await page.goto(url('/browse'));
				return row(page, WEBVIEW.name).last().locator('.m').textContent();
			},
			{ timeout: 15_000 }
		)
		.toBe('EN · NEEDS A WEBVIEW');

	await page.goto(url('/browse/extensions'));
	await expect(
		page.getByRole('status').filter({ hasText: 'GETTING THE BROWSER THIS SOURCE NEEDS' })
	).toContainText('GETTING THE BROWSER THIS SOURCE NEEDS · 40 % OF ABOUT 180 MB');
	// Ready: nothing is said.
	fake.status = { enabled: true, state: 'ready', openPages: 0 };
	await expect(page.getByText('GETTING THE BROWSER THIS SOURCE NEEDS')).toHaveCount(0, {
		timeout: 10_000
	});
});

test('a call made while it downloads says so, with TRY AGAIN only once it’s ready', async ({
	page
}) => {
	fake.status = { enabled: true, state: 'starting', phase: 'downloading', percent: 70 };
	fake.failWith = { enabled: true, state: 'starting', phase: 'downloading', percent: 70 };
	await page.goto(url(`/browse/${WEBVIEW.id}`));
	const band = page.getByRole('status').filter({ hasText: 'THE BROWSER THIS SOURCE NEEDS' });
	await expect(band).toContainText('GETTING THE BROWSER THIS SOURCE NEEDS · 70 % OF ABOUT 180 MB');
	await expect(page.getByText('Timed out waiting for the WebView', { exact: false })).toHaveCount(
		0
	);
	await expect(page.getByRole('link', { name: 'TRY AGAIN' })).toHaveCount(0);

	fake.status = { enabled: true, state: 'ready', openPages: 0 };
	fake.failWith = null;
	await expect(band).toContainText('THE BROWSER THIS SOURCE NEEDS IS READY', { timeout: 10_000 });
	await page.getByRole('link', { name: 'TRY AGAIN' }).click();
	await expect(page.getByText('NOTHING HERE')).toBeVisible();
});

test('a failed browser is the engine’s own words', async ({ page }) => {
	const error = 'needs an X display: install Xvfb (the xvfb package), or run with DISPLAY set';
	fake.status = { enabled: true, state: 'failed', error };
	fake.failWith = { enabled: true, state: 'failed', error };
	// POPULAR answered in the last test and is kept a while (browse.ts): a search asks the engine.
	await page.goto(url(`/browse/${WEBVIEW.id}?q=frieren`));
	const band = page.getByRole('status').filter({ hasText: "DIDN'T START" });
	await expect(band).toContainText(error);
	await expect(page.getByRole('link', { name: 'TRY AGAIN' })).toBeVisible();

	await page.goto(url('/settings?section=browse'));
	await expect(page.locator('.row.webview .wifi-meta').first()).toHaveText(`FAILED: ${error}`);
	fake.failWith = null;
});

test('SETTINGS: OFF, then REMOVE deletes the downloaded browser', async ({ page }) => {
	mkdirSync(join(chromium(), 'lib'), { recursive: true });
	writeFileSync(join(chromium(), 'lib', 'libcef.so'), Buffer.alloc(2 * 1024 ** 2));
	fake.webview = true;
	fake.status = { enabled: true, state: 'idle', dir: chromium() };
	await page.goto(url('/settings?section=browse'));
	const r = page.locator('.row.webview');
	await expect(r).toContainText('2 MB');
	// On: no REMOVE, the engine would only download it again.
	await expect(r.getByRole('button', { name: 'REMOVE' })).toHaveCount(0);

	await r.getByRole('button', { name: 'OFF', exact: true }).click();
	await expect.poll(switchOn).toBe(false);
	fake.webview = false;
	fake.status = { enabled: false, state: 'off' };
	await expect(r.getByRole('button', { name: 'REMOVE' })).toBeVisible({ timeout: 15_000 });
	await r.getByRole('button', { name: 'REMOVE' }).click();
	await expect(r).toContainText('NOT DOWNLOADED');
	expect(existsSync(chromium())).toBe(false);
});
