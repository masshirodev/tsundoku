import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * A film's screen, end to end (card c992; the handoff's Film-Desk and Kind
 * boards, doc/handoffs/movies-shows/): the count line and the one cell, the
 * stage in the list's place (the collection from c990's cache, ABOUT), and
 * KIND's CHANGE through the sheet to the band. Its own preview and database,
 * as tmdb-link-flow's, with a linked film and its collection seeded; TMDB is a
 * fake that answers nothing, since the screen never asks it.
 */
test.describe.configure({ mode: 'serial' });

let work = '';
let dbPath = '';
let preview: ChildProcess | null = null;
let tmdb: Server | null = null;
let BASE = '';
let filmId = 0;
let wakeId = 0;
let firstSeason = 0;
let secondSeason = 0;

const freePort = (): Promise<number> =>
	new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});

test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-film-'));
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
	const db = new Database(dbPath);
	const root = (db.prepare(`SELECT id FROM roots ORDER BY id LIMIT 1`).get() as { id: number }).id;
	const film = (title: string, tmdbId: number, year: number, runtime: number) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, in_library, source, origin_key)
					VALUES (?, ?, 'movie', 1, 1, 'aniyomi', ?)`
				)
				.run(root, title, `aniyomi:9:/film/${tmdbId}`).lastInsertRowid
		);
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, 1, ?, 1)`
		).run(id, title);
		db.prepare(
			`INSERT INTO series_tmdb_links (series_id, tmdb_id, media, via, title, year, overview, runtime,
				collection_id, collection_name, linked_at)
			VALUES (?, ?, 'movie', 'review', ?, ?, ?, ?, 500, 'The Long Ferry Collection', 1)`
		).run(id, tmdbId, title, year, 'A ferry pilot takes on a passenger with no ticket.', runtime);
		return id;
	};
	filmId = film('The Long Ferry', 11, 2024, 118);
	wakeId = film('The Long Ferry: Wake', 12, 2025, 112);
	db.prepare(
		`INSERT INTO tmdb_surroundings (media, tmdb_id, data, fetched_at) VALUES ('collection', 500, ?, ?)`
	).run(
		JSON.stringify({
			id: 500,
			name: 'The Long Ferry Collection',
			parts: [
				{ id: 11, title: 'The Long Ferry', year: 2024, date: '2024-03-01' },
				{ id: 12, title: 'The Long Ferry: Wake', year: 2025, date: '2025-04-01' },
				{ id: 13, title: 'The Long Ferry: Ash', year: 2026, date: '2026-06-01' }
			]
		}),
		Date.now()
	);
	// A show: seasons 1 and 2 in the library, TMDB's season 3 aired and nobody's.
	const show = (title: string) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, in_library, source, origin_key)
					VALUES (?, ?, 'show', 1, 1, 'aniyomi', ?)`
				)
				.run(root, title, `aniyomi:9:/show/${title}`).lastInsertRowid
		);
		for (let n = 1; n <= 2; n++)
			db.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, episode_number) VALUES (?, ?, ?, 1, ?)`
			).run(id, n, `Ep. ${n}`, n);
		db.prepare(
			`INSERT INTO series_tmdb_links (series_id, tmdb_id, media, via, title, year, linked_at)
			VALUES (?, 77, 'tv', 'review', 'Harbour Lights', 2022, 1)`
		).run(id);
		return id;
	};
	firstSeason = show('Harbour Lights');
	secondSeason = show('Harbour Lights Season 2');
	db.prepare(
		`INSERT INTO tmdb_surroundings (media, tmdb_id, data, fetched_at) VALUES ('tv', 77, ?, ?)`
	).run(
		JSON.stringify({
			id: 77,
			inProduction: true,
			next: null,
			seasons: [
				{ season: 1, episodes: 10, airDate: '2022-01-01', name: 'Season 1' },
				{ season: 2, episodes: 8, airDate: '2023-01-01', name: 'Season 2' },
				{ season: 3, episodes: 8, airDate: '2024-11-03', name: 'Season 3' }
			]
		}),
		Date.now()
	);
	db.close();

	const tmdbPort = await freePort();
	tmdb = createServer((_req, res) => {
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
	throw new Error('the film preview never answered');
});

test.afterAll(async () => {
	preview?.kill();
	await new Promise<void>((ok) => (tmdb ? tmdb.close(() => ok()) : ok()));
	if (work) rmSync(work, { recursive: true, force: true });
});

test('a film: one cell, no list, the collection and ABOUT on the stage (c992)', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${filmId}`);
	await expect(page.locator('.panel .count').first()).toHaveText('2024 · 1 H 58');
	await expect(page.locator('.cta').first()).toContainText('▶ PLAY');
	await expect(page.locator('.cta').first()).toContainText('1 H 58');
	// No list: no episode rows, and no NEXT 10, ALL, REFRESH or FOLLOW.
	await expect(page.getByRole('region', { name: 'Episodes' })).toHaveCount(0);
	for (const word of ['NEXT 10', 'ALL', 'REFRESH', 'FOLLOW'])
		await expect(
			page.locator('.dl-row').getByRole('button', { name: word, exact: true })
		).toHaveCount(0);
	const stage = page.getByRole('region', { name: 'The film' });
	await expect(stage).toContainText('01 — THE LONG FERRY COLLECTION');
	await expect(stage).toContainText('PART 1 OF 3');
	const rows = stage.locator('.row:visible');
	await expect(rows.nth(0)).toContainText('THIS FILM · 2024');
	await expect(rows.nth(1)).toContainText('IN LIBRARY →');
	await expect(rows.nth(2)).toContainText('NOT IN THE LIBRARY');
	await expect(stage).toContainText('2 OF 3 IN THE LIBRARY · NOT A WORK');
	await expect(stage.getByRole('button', { name: 'GROUP →' })).toBeVisible();
	await expect(stage).toContainText('02 — ABOUT');
	await expect(stage).toContainText('A ferry pilot takes on a passenger');
	await page.screenshot({ path: join(process.cwd(), 'temp', 'film-screen.png'), fullPage: false });
	// IN LIBRARY → opens the other part.
	await rows.nth(1).click();
	await expect(page).toHaveURL(new RegExp(`/series/${wakeId}`));
});

test('KIND: CHANGE, the sheet says what a pick does, and the band says it was done (c992)', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${filmId}`);
	// On a phone KIND lives inside DETAILS, closed until it is opened (Kind 4.1).
	const details = page.locator('.details-line').first();
	if (await details.isVisible()) await details.click();
	const kind = page.locator('.kind-row').first();
	await expect(kind).toContainText('Movie');
	await expect(kind).toContainText('MOVIES/ · 1 FILE');
	await kind.getByRole('button', { name: 'CHANGE' }).click();
	const sheet = page.getByRole('dialog', { name: /Kind/ });
	await expect(sheet).toContainText('KIND · THE LONG FERRY');
	// Nothing picked yet: the move is not offered until a kind is.
	await expect(sheet.getByRole('button', { name: /MAKE IT A SHOW/ })).toHaveCount(0);
	await sheet.getByRole('button', { name: /SHOW/ }).first().click();
	await expect(sheet).toContainText('03 — WHAT CHANGES');
	await expect(sheet).toContainText('THE FILM BECOMES EPISODE 1 OF A LIST');
	await expect(sheet).toContainText('PROGRESS · RATING AND FAV');
	await page.screenshot({
		path: join(process.cwd(), 'temp', 'film-kind-sheet.png'),
		fullPage: false
	});
	await sheet.getByRole('button', { name: /MAKE IT A SHOW/ }).click();
	await expect(page.locator('.band', { hasText: 'NOW A SHOW' })).toBeVisible();
	await expect(page.locator('.kind-row').first()).toContainText('Show');
	// UNDO puts it back.
	await page
		.locator('.band', { hasText: 'NOW A SHOW' })
		.getByRole('button', { name: 'UNDO' })
		.click();
	await expect(page.locator('.kind-row').first()).toContainText('Movie');
});

test('a show: TMDB’s seasons as heads, SEASONS under LISTS, and SEASON 3 IS OUT with NOT THIS (c992)', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${secondSeason}`);
	const list = page.getByRole('region', { name: 'Episodes' });
	const s1 = list.locator('.season.around', { hasText: 'SEASON 1' });
	await expect(s1).toContainText('10 EP');
	await expect(s1.getByRole('link', { name: /in the library/ })).toHaveAttribute(
		'href',
		new RegExp(`/series/${firstSeason}`)
	);
	await expect(list.locator('.season.around', { hasText: 'SEASON 3' })).toContainText('TMDB');
	const details = page.locator('.details-line').first();
	if (await details.isVisible()) await details.click();
	const row = page.locator('.seasons-row').first();
	await expect(row).toContainText('2 of 3 in the library');
	await expect(row).toContainText('TMDB LISTS 3 · S3 NOT IN THE LIBRARY');
	const band = page.locator('.band', { hasText: 'SEASON 3 IS OUT' });
	await expect(band).toContainText('NO SERIES HOLDS IT');
	await band.getByRole('button', { name: 'NOT THIS' }).click();
	const kept = page.locator('.band', { hasText: 'WON’T ASK AGAIN' });
	await expect(kept).toBeVisible();
	await expect(page.locator('.band', { hasText: 'SEASON 3 IS OUT' })).toHaveCount(0);
	await kept.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.band', { hasText: 'SEASON 3 IS OUT' })).toBeVisible();
});
