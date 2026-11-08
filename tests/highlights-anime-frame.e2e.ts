import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * The clip marks' measurements on the desktop (c704;
 * doc/handoffs/highlights/Anime.dc.html and hl.css's `.scrub` and `.band`
 * rules). Written by hand and not generated: design-tools/gen-conformance.mjs's
 * regions are the board's own layout (the whole board is one `screen`), so its
 * output would assert the mock's page, not the player. These numbers are hand-set
 * in the mock and do not round to a spacing ladder, so a later pass that tidies
 * them would silently redraw the marks; that is what this is here to stop.
 *
 * Its own seeded database and an OS port, with the video list stood in, because
 * the shared seed serves no episode. The board is the desktop's, so it runs
 * there and skips itself in the others.
 */
const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const scratch = join(tmpdir(), `tsundoku-e2e-anime-frame-${process.pid}`);
const dbPath = join(scratch, 'library.sqlite');
let server: ChildProcess | null = null;
let entry = 0;

test.use({ baseURL: base, viewport: { width: 1280, height: 720 } });
test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
	test.skip(test.info().project.name !== 'desktop', 'the board is drawn at the desktop’s width');
});

test.beforeAll(async () => {
	if (test.info().project.name !== 'desktop') return;
	test.setTimeout(90_000);
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (
			db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number }
		).id;
		const series = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, rating, added_at, path, origin_key, indexed_at, source)
					VALUES (?, 'Toudai no Mukou', 'anime', 0, 1, '/x', 'aniyomi:999:/show/toudai', 1, 'aniyomi')`
				)
				.run(root).lastInsertRowid
		);
		entry = Number(
			db
				.prepare(
					`INSERT INTO entries (series_id, position, label, title, added_at, available, source_url, episode_number, season, duration_s)
					VALUES (?, 7, 'Ep. 7', 'Lamp', 1, 0, '/ep/7', 7, 1, 8)`
				)
				.run(series).lastInsertRowid
		);
	} finally {
		db.close();
	}
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DATABASE_PATH: dbPath,
		TSUNDOKU_TOKEN: E2E_TOKEN,
		TSUNDOKU_ANILIST: 'off',
		LIBRARY_ROOT: join(scratch, 'library'),
		TSUNDOKU_HOME: join(scratch, 'home')
	};
	delete env.ORIGIN;
	server = spawn(
		process.execPath,
		[
			'node_modules/vite/bin/vite.js',
			'preview',
			'--port',
			String(PORT),
			'--strictPort',
			'--host',
			'localhost'
		],
		{ env, stdio: 'ignore' }
	);
	for (let i = 0; i < 300; i++) {
		if (server.exitCode !== null) throw new Error('preview exited');
		const up = await fetch(base).then(
			(r) => r.status > 0,
			() => false
		);
		if (up) return;
		await new Promise((ok) => setTimeout(ok, 200));
	}
	throw new Error('preview did not start');
});

test.afterAll(async () => {
	server?.kill('SIGTERM');
	rmSync(scratch, { recursive: true, force: true });
});

test('the range box, the kept box and the cells are the handoff’s', async ({ page }) => {
	const clip = readFileSync('tests/fixtures/video/clip.webm');
	await page.route('**/api/anime/episode/*/videos**', (route) =>
		route.fulfill({
			json: {
				entryId: entry,
				intro: null,
				ending: null,
				resolvedAt: 0,
				servers: [
					{
						n: 1,
						name: 'S1',
						qualities: [
							{
								label: '360p',
								height: 360,
								kind: 'file',
								src: `data:video/webm;base64,${clip.toString('base64')}`,
								audio: [],
								subtitles: []
							}
						]
					}
				]
			}
		})
	);
	await page.route('**/api/highlights/clips', (route) => {
		if (route.request().method() !== 'POST') return route.fulfill({ json: [] });
		return route.fulfill({
			status: 202,
			json: {
				id: 'j',
				entryId: entry,
				seriesId: 1,
				seriesTitle: 'T',
				entryLabel: 'Ep. 7',
				from: 1,
				to: 3,
				streamed: false,
				step: 'cutting',
				percent: 40,
				why: null,
				stoppedAt: null,
				highlightId: null,
				finishedAt: null
			}
		});
	});
	await page.goto(`/read/${entry}`);
	await page.waitForFunction(() => {
		const v = document.querySelector('video');
		return !!v && v.duration > 7 && v.readyState >= 2;
	});
	await page.evaluate(() => document.querySelector('video')!.pause());
	await expect(page.locator('.player')).toHaveClass(/chrome/);
	const seek = async (t: number) => {
		await page.evaluate((s) => (document.querySelector('video')!.currentTime = s), t);
		await expect
			.poll(() => page.locator('.scrubrow .e').textContent())
			.toBe(`0:${String(t).padStart(2, '0')}`);
	};
	await seek(1);
	await page.keyboard.press('i');
	await expect(page.locator('.scrubrow .track .in-mark')).toHaveCSS('height', '30px');
	await expect(page.locator('.scrubrow .track .in-mark')).toHaveCSS('width', '2px');
	await expect(page.locator('.scrubrow .track .in-mark')).toHaveCSS('top', '-14px');
	await seek(3);
	await page.mouse.move(600, 400);
	const range = page.locator('.scrubrow .track .mr');
	await expect(range).toHaveCSS('height', '26px');
	await expect(range).toHaveCSS('top', '-12px');
	await expect(range).toHaveCSS('border-top-width', '2px');
	const io = page.locator('.scrubrow .track .io');
	await expect(io).toHaveCSS('font-size', '11px');
	await expect(io).toHaveCSS('top', '-26px');
	await expect(page.locator('.cells')).toHaveCSS('height', /^(64|56)px$/);
	await page.keyboard.press('Enter');
	const band = page.locator('.clipband');
	await expect(band).toBeVisible();
	await expect(band).toHaveCSS('min-height', '52px');
	await expect(band).toHaveCSS('font-size', '13px');
	await expect(band.locator('span')).toHaveCSS('padding-left', '18px');
	await expect(band).toContainText('CUTTING THE CLIP · 0:01–0:03 · 40%');
	const dash = page.locator('.scrubrow .track .kr.dash');
	await expect(dash).toHaveCSS('top', '-7px');
	await expect(dash).toHaveCSS('height', '16px');
	await expect(dash).toHaveCSS('border-top-style', 'dashed');
});
