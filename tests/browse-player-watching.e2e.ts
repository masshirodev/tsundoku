import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { ANIME_SOURCE, ENGINE_PORT } from './browse-world';

/**
 * The watching clock's wiring (doc/READING-LOG.md): what the
 * player posts as `durationMs` is the time the picture actually played on a
 * page someone could see. The unit cases of `isWatching` and `WatchClock`
 * (tests/reader-domain.spec.ts) cannot tell whether VideoPlayer.svelte asks
 * them, so this plays the browse world's 8 s clip, the one
 * tests/browse-anime.e2e.ts and tests/tv-player.e2e.ts use, and reads what
 * was posted. With `watching` hard-coded to true, the hidden page's case is
 * the one that goes red.
 *
 * Its own database and preview, on a port the OS hands out, so the episode's
 * position and the reading log it writes reach no other spec. The stream
 * still comes from the browse world's fake engine (tests/browse-setup.ts),
 * which answers any episode with a broken server and then the clip.
 */

const TITLE = 'Watching Clock';

function freePort(): Promise<number> {
	return new Promise((ok, fail) => {
		const s = createServer();
		s.once('error', fail);
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});
}

/**
 * The sample library, and two anime of one episode each on the browse world's
 * anime source, one per case: a watched episode sends no second `finish`.
 * One episode a series, so an end plays nothing on.
 */
function seed(dbPath: string): number[] {
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES (?, ?, 'anime', 1, '1.0', '16', ?, 0, 0, '')`
		).run(ANIME_SOURCE.pkg, ANIME_SOURCE.name, ANIME_SOURCE.pkg.padEnd(64, '0'));
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://anime.example')`
		).run(ANIME_SOURCE.id, ANIME_SOURCE.pkg, ANIME_SOURCE.name);
		const now = Date.UTC(2026, 10, 1, 12);
		return [1, 2].map((n) => {
			const series = Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, status, hue, added_at, indexed_at, origin_key)
						VALUES (?, ?, 'anime', ?, 'ongoing', 255, ?, ?, ?)`
					)
					.run(
						root,
						`${TITLE} ${n}`,
						ANIME_SOURCE.name,
						now,
						now,
						`aniyomi:${ANIME_SOURCE.id}:/show/watching-${n}`
					).lastInsertRowid
			);
			return Number(
				db
					.prepare(
						`INSERT INTO entries (series_id, position, label, title, added_at, duration_s, season,
							episode_number, source_url)
						VALUES (?, 1, 'Ep. 1', 'The Clock', ?, 1440, 1, 1, ?)`
					)
					.run(series, now, `/ep/watching-${n}-s1e1`).lastInsertRowid
			);
		});
	} finally {
		db.close();
	}
}

let work = '';
let base = '';
let episodes: number[] = [];
let preview: ChildProcess | null = null;

test.describe.configure({ mode: 'serial', timeout: 90_000 });
test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-watching-'));
	const dbPath = join(work, 'library.sqlite');
	episodes = seed(dbPath);
	const port = await freePort();
	base = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			ENGINE_URL: `http://127.0.0.1:${ENGINE_PORT}`,
			ENGINE_TOKEN: 'e2e-engine-token',
			TSUNDOKU_ANILIST: 'off',
			TSUNDOKU_HOME: join(work, 'home'),
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
			ENGINE_STORE: join(work, 'store'),
			BACKUP_DIR: join(work, 'backups'),
			SUWAYOMI_URL: ''
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
	if (!up) throw new Error('the watching preview never answered');
});
test.afterAll(() => {
	preview?.kill();
	if (work) rmSync(work, { recursive: true, force: true });
});

type Posted = { kind: string; durationMs: number; page: number };

/** Every progress event the player sends, as it sent it (a beacon included). */
function recordPosts(page: Page): Posted[] {
	const posts: Posted[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/reading')
			posts.push(r.postDataJSON() as Posted);
	});
	return posts;
}

const video = (page: Page) => page.locator('video');
const at = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentTime);

/**
 * The episode open, on the working stream: the fake's first server always
 * fails over, and that re-attach would undo a pause made before it.
 */
async function openEpisode(page: Page, episode: number): Promise<void> {
	await page.goto(`${base}/read/${episode}`);
	await expect(page.locator('.player')).toBeVisible();
	await expect
		.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.duration), { timeout: 30_000 })
		.toBeGreaterThan(7);
}

/** Plays it, muted: a muted picture may start without a gesture. */
async function play(page: Page): Promise<void> {
	await expect(async () => {
		await video(page).evaluate((v: HTMLVideoElement) => {
			v.muted = true;
			return v.play();
		});
		expect(await video(page).evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
	}).toPass({ timeout: 20_000 });
}

const finished = (page: Page) =>
	page.waitForRequest(
		(r) =>
			r.method() === 'POST' &&
			new URL(r.url()).pathname === '/api/reading' &&
			(r.postDataJSON() as Posted).kind === 'finish',
		{ timeout: 45_000 }
	);

test('counts the time it played, and nothing while paused', async ({ page }) => {
	const posts = recordPosts(page);
	await openEpisode(page, episodes[0]);
	await play(page);
	await expect.poll(() => at(page), { timeout: 20_000 }).toBeGreaterThan(1);
	await video(page).evaluate((v: HTMLVideoElement) => v.pause());
	const pausedAt = await at(page);
	const before = posts.length;
	// Three seconds paused: nothing posted counts any of it.
	await page.waitForTimeout(3000);
	expect(posts.slice(before).filter((p) => p.durationMs > 0)).toEqual([]);
	expect(await at(page)).toBe(pausedAt);

	const finish = finished(page);
	await play(page);
	await finish;
	const counted = posts.reduce((n, p) => n + p.durationMs, 0);
	// Something played and was counted...
	expect(posts.find((p) => p.kind === 'finish')!.durationMs).toBeGreaterThan(0);
	expect(counted).toBeGreaterThan(0);
	// ...and no more than the clip holds, though more than three seconds of
	// wall time went by on top of it (a second's slack: timeupdate's jitter).
	expect(counted).toBeLessThanOrEqual(8000 + 1000);
});

test('counts nothing while the page is hidden, though the picture plays', async ({ page }) => {
	// The tab is in view, so the picture plays as ever; the page is told it is
	// hidden, as a backgrounded tab is, and no floating window is open.
	await page.addInitScript(() => {
		Object.defineProperty(Document.prototype, 'visibilityState', {
			configurable: true,
			get: () => 'hidden'
		});
		Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => true });
	});
	const posts = recordPosts(page);
	await openEpisode(page, episodes[1]);
	expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');
	const finish = finished(page);
	await play(page);
	await finish;
	// It played into the ending, where watching counts (the clip's last 2 s)...
	expect(await at(page)).toBeGreaterThanOrEqual(6);
	// ...and every event said none of it was watched.
	expect(posts.length).toBeGreaterThan(0);
	expect(posts.map((p) => p.durationMs)).toEqual(posts.map(() => 0));
});
