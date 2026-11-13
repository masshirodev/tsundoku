import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * A film's TMDB link, end to end (card c989; doc/LINKS.md, "TMDB links"): the
 * LISTS line says what the pass found, FIND opens the review on it, LINK reads
 * the entry by id and the line names it. Its own preview and database,
 * because the shared server has no key by design (playwright.config.ts) and a
 * film in the shared seed would move every count the other flows assert. TMDB
 * is a fake on a port of its own: nothing leaves the box.
 */
test.describe.configure({ mode: 'serial' });

let work = '';
let dbPath = '';
let preview: ChildProcess | null = null;
let tmdb: Server | null = null;
let BASE = '';
let filmId = 0;
const asked: string[] = [];

const freePort = (): Promise<number> =>
	new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});

const hit = (id: number, title: string, year: number) => ({
	id,
	media: 'movie',
	title,
	originalTitle: '',
	year,
	overview: '',
	poster: null,
	runtime: null,
	seasons: null,
	collection: null
});

test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-tmdb-'));
	dbPath = join(work, 'library.sqlite');
	mkdirSync(join(work, 'library'));
	const env = {
		...process.env,
		DATABASE_PATH: dbPath,
		LIBRARY_ROOT: join(work, 'library'),
		NODE_NO_WARNINGS: '1'
	};
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env,
		stdio: 'pipe'
	});
	// A film the pass searched: two equal titles and no year, so nothing was sure.
	const db = new Database(dbPath);
	const root = (db.prepare(`SELECT id FROM roots ORDER BY id LIMIT 1`).get() as { id: number }).id;
	filmId = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, in_library, path) VALUES (?, 'Nosferatu 1080p', 'movie', 1, 1, ?)`
			)
			.run(root, join(work, 'library', 'Nosferatu')).lastInsertRowid
	);
	db.prepare(
		`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, 1, 'Nosferatu', 1)`
	).run(filmId);
	db.prepare(
		`INSERT INTO tmdb_link_searches (series_id, query, searched_at, found) VALUES (?, 'Nosferatu', 1, 2)`
	).run(filmId);
	const put = db.prepare(
		`INSERT INTO tmdb_link_candidates (series_id, tmdb_id, rank, data) VALUES (?, ?, ?, ?)`
	);
	put.run(filmId, 653, 0, JSON.stringify(hit(653, 'Nosferatu', 1922)));
	put.run(filmId, 426063, 1, JSON.stringify(hit(426063, 'Nosferatu', 2024)));
	db.close();

	// The fake TMDB: the one entry LINK reads by id.
	const tmdbPort = await freePort();
	tmdb = createServer((req, res) => {
		asked.push(req.url ?? '');
		res.setHeader('content-type', 'application/json');
		if (req.url?.startsWith('/3/movie/426063')) {
			res.end(
				JSON.stringify({
					id: 426063,
					title: 'Nosferatu',
					release_date: '2024-12-25',
					runtime: 132,
					belongs_to_collection: null
				})
			);
			return;
		}
		res.statusCode = 404;
		res.end('{}');
	});
	await new Promise<void>((ok) => tmdb!.listen(tmdbPort, '127.0.0.1', ok));

	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...env,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			TMDB_API_KEY: 'e2e',
			TMDB_API_URL: `http://127.0.0.1:${tmdbPort}/3`,
			COVER_DIR: join(work, 'covers'),
			TSUNDOKU_HOME: join(work, 'home'),
			BACKUP_DIR: join(work, 'backups')
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${BASE}/`, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the TMDB preview never answered');
});

test.afterAll(async () => {
	preview?.kill();
	await new Promise<void>((ok) => (tmdb ? tmdb.close(() => ok()) : ok()));
	if (work) rmSync(work, { recursive: true, force: true });
});

test('a film’s LISTS line, FIND, LINK, and the line names the entry (c989)', async ({ page }) => {
	await page.goto(`${BASE}/series/${filmId}`);
	const line = page.locator('[data-line="tmdb"]').first();
	await expect(line).toBeVisible();
	await expect(line).toContainText('TMDB');
	await expect(line).toContainText('2 FOUND ON TMDB · NOT FOR CERTAIN');
	// A film never gets an AniList line beside it.
	await expect(page.locator('[data-line="anilist"]')).toHaveCount(0);

	await line.getByRole('link', { name: 'FIND' }).click();
	await expect(page).toHaveURL(new RegExp(`/links\\?series=${filmId}`));
	const cands = page.locator('.cand');
	await expect(cands).toHaveCount(2);
	await expect(cands.nth(0)).toContainText('TMDB 653');
	await expect(cands.nth(1)).toContainText('EXACT TITLE');
	await expect(page.getByText('SEARCHED TMDB FOR “Nosferatu”')).toBeVisible();

	await cands.nth(1).click();
	await page.getByRole('button', { name: 'LINK B' }).click();
	await expect(page).toHaveURL(new RegExp(`/series/${filmId}`));
	const linked = page.locator('[data-line="tmdb"]').first();
	await expect(linked).toContainText('FILM · 2024 · 2 H 12');
	await expect(linked.getByRole('link', { name: 'CHANGE' })).toBeVisible();
	expect(asked.some((u) => u.startsWith('/3/movie/426063'))).toBe(true);
	// Only the id was asked of TMDB on LINK: never a search with the title.
	expect(asked.some((u) => u.includes('/search/'))).toBe(false);
});
