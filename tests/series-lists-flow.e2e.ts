import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * The series screen's LISTS row (c424; doc/SERIES.md "LISTS"), state by state,
 * reached through the app's own doors: a link pasted on the review, a chapter
 * marked read, a send to a catalogue that is down and then answers, TRY AGAIN,
 * EDIT's STATUS and UNLINK, HIDE with reveal on, the browser going offline,
 * and an anime's four seasons each linked on its own review. These link,
 * unlink, send and hide, so the file runs once (a `-flow`, tablet-portrait),
 * on a seeded database of its own, against its own preview on a port the OS
 * hands out and a stand-in AniList behind TSUNDOKU_ANILIST_URL. Nothing here
 * can reach the real one.
 *
 * Its last case is c390's: a refused UNDO of the series screen's TAKE OUT,
 * THEN HIDE, answered as a band, reached with a second tab that ends the Work
 * and makes a new one under its id between the HIDE and the UNDO.
 *
 * Two rows are written by hand, because no door here reaches them: the
 * AniList sign-in (OAuth leaves for anilist.co) and a season linked to a
 * manga's entry (a paste refuses the other kind). Both are under the notes'
 * Gaps (doc/handoff-notes/series.md, wave 20).
 */
test.describe.configure({ mode: 'serial' });

type Media = {
	id: number;
	idMal: number | null;
	format: string;
	countryOfOrigin: string;
	status: string;
	chapters: number | null;
	volumes: number | null;
	episodes: number | null;
	season: string | null;
	seasonYear: number | null;
	synonyms: string[];
	title: { romaji: string; english: string; native: null };
	startDate: { year: number | null };
	coverImage: { extraLarge: null; large: null };
};
const media = (o: { id: number; title: string; format?: string; episodes?: number }): Media => ({
	id: o.id,
	idMal: null,
	format: o.format ?? 'MANGA',
	countryOfOrigin: 'KR',
	status: 'RELEASING',
	chapters: null,
	volumes: null,
	episodes: o.episodes ?? null,
	season: null,
	seasonYear: 2024,
	synonyms: [],
	title: { romaji: o.title, english: o.title, native: null },
	startDate: { year: 2024 },
	coverImage: { extraLarge: null, large: null }
});
const COMIC = [
	media({ id: 7701, title: 'Lists Comic Entry' }),
	media({ id: 7901, title: 'Lists Novel’s Comic' })
];
const ANIME = [1, 2, 3, 4].map((n) =>
	media({ id: 7810 + n, title: `Four Seasons ${n}`, format: 'TV', episodes: 3 })
);

/** What the stand-in does with a send: answer it, or be down (the socket dropped). */
let sendMode: 'ok' | 'down' = 'ok';
/** Every SaveMediaListEntry it was asked for, in order. */
let sends: Record<string, unknown>[] = [];

function answer(query: string, variables: Record<string, unknown>) {
	if (query.includes('SaveMediaListEntry')) {
		sends.push(variables);
		return { SaveMediaListEntry: { id: 1 } };
	}
	const out: Record<string, unknown> = {};
	// A pasted link's id, resolved: Page(perPage: 50) { media(id_in: $ids, type: X) }.
	const byIds = /media\((id_in|idMal_in):\s*\$ids,\s*type:\s*(ANIME|MANGA)\)/.exec(query);
	if (byIds) {
		const ids = (variables.ids as number[]) ?? [];
		const pool = byIds[2] === 'ANIME' ? ANIME : COMIC;
		out.Page = { media: pool.filter((e) => ids.includes(e.id)) };
	}
	// A season LINK walks the relations: none here, so it goes back to the series (c423).
	for (const m of query.matchAll(/m(\d+):\s*Media\(id:\s*\$i(\d+)\)/g)) {
		const self = ANIME.find((e) => e.id === Number(variables[`i${m[2]}`]));
		if (self) out[`m${m[1]}`] = { ...self, relations: { edges: [] } };
	}
	// Any search finds nothing: FIND is not what this file is about.
	for (const m of query.matchAll(/s(\d+):\s*Page\(/g)) out[`s${m[1]}`] = { media: [] };
	return out;
}

const work = mkdtempSync(
	join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-lists-')
);
const dbPath = join(work, 'lists.sqlite');
let preview: ChildProcess | null = null;
let fake: Server | null = null;
let BASE = '';

function freePort(): Promise<number> {
	return new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});
}

type Ids = { comic: number; novel: number; hidden: number; four: number; wrong: number };

/** The sample library, then this file's series. Rows only; every link is made through a door. */
function seed(): Ids {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			LIBRARY_ROOT: join(work, 'library'),
			NODE_NO_WARNINGS: '1'
		},
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 4, 12, 0);
		const series = (title: string, kind: string, key: string) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
						VALUES (?, ?, ?, 'mihon', 30, ?, ?, ?, 1, '')`
					)
					.run(root, title, kind, now, now, key).lastInsertRowid
			);
		const chapters = (id: number, n: number) => {
			const put = db.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, file, bytes, page_count, available, source_url)
				VALUES (?, ?, ?, ?, ?, 1000, 20, 1, ?)`
			);
			// Downloaded, as the sample's chapters are: a row with no file doesn't open.
			for (let i = 1; i <= n; i++)
				put.run(id, i, `Chapter ${i}`, now, `lists/${id}/Chapter ${i}.cbz`, `/c/${id}/${i}`);
		};
		const comic = series('Lists Comic', 'manhwa', 'mihon:1:/lists-comic');
		chapters(comic, 10);
		const novel = series('Lists Novel', 'novel', 'mihon:1:/lists-novel');
		chapters(novel, 4);
		const hidden = series('Lists Hidden', 'manhwa', 'mihon:1:/lists-hidden');
		chapters(hidden, 3);
		const anime = (title: string, key: string, seasons: number) => {
			const id = Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
						VALUES (?, ?, 'anime', 'aniyomi', 210, ?, ?, ?, 1, '')`
					)
					.run(root, title, now, now, key).lastInsertRowid
			);
			const put = db.prepare(
				`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
				VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, 0, ?)`
			);
			let position = 0;
			for (let s = 1; s <= seasons; s++)
				for (let e = 1; e <= 3; e++) {
					position += 1;
					put.run(id, position, `Episode ${e}`, s, e, now, `/a/${id}/${s}/${e}`);
				}
			return id;
		};
		const four = anime('Four Seasons', 'aniyomi:1:/four-seasons', 4);
		const wrong = anime('Wrong Kind Show', 'aniyomi:1:/wrong-kind', 1);
		// By hand (Gaps): a paste refuses another kind's entry, and the importer
		// that can still write one (Mihon's MAL tracker) needs a backup.
		db.prepare(
			`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, title, linked_at, resolved_at, format, episodes)
			VALUES (?, 1, 1, 30024, 'mihon', 'Wrong Kind Manga', ?, ?, 'MANGA', NULL)`
		).run(wrong, now, now);
		// By hand (Gaps): the sign-in, which leaves for anilist.co. MAL is never
		// signed in here, so nothing reaches api.myanimelist.net.
		db.prepare(
			`INSERT OR REPLACE INTO tracker_accounts (service, user_id, user_name, access_token, signed_in_at)
			VALUES ('anilist', '7', 'masshiro', 'e2e-token', ?)`
		).run(now);
		return { comic, novel, hidden, four, wrong };
	} finally {
		db.close();
	}
}

const ids = seed();
const lists = (page: import('@playwright/test').Page) => page.locator('[data-row="lists"]');
const line = (page: import('@playwright/test').Page, key: string) =>
	lists(page).locator(`[data-line="${key}"]`);
const sheetOf = (page: import('@playwright/test').Page) =>
	page.getByRole('dialog', { name: 'Tracking' });

/** A pasted AniList link, LINKed on the review, the way the owner pastes one. */
async function paste(page: import('@playwright/test').Page, href: string, url: string) {
	await page.goto(`${BASE}${href}`);
	await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
	await page.getByLabel('AniList or MAL link').fill(url);
	const link = page.locator('.actions button').last();
	await expect(link).toHaveText(/^LINK [A-Z]/);
	await link.click();
	// A season's LINK walks AniList's relations before it answers (c423, round 2).
	await page.waitForURL(/\/series\/\d+$/, { timeout: 20_000 });
}

test.beforeAll(async () => {
	const fakePort = await freePort();
	fake = createServer((req: IncomingMessage, res: ServerResponse) => {
		let body = '';
		req.on('data', (b: Buffer) => (body += b.toString()));
		req.on('end', () => {
			const { query, variables } = JSON.parse(body || '{}') as {
				query: string;
				variables: Record<string, unknown>;
			};
			// Down, for a send: the connection drops, as a catalogue that is down does.
			if (sendMode === 'down' && (query ?? '').includes('SaveMediaListEntry')) {
				req.socket.destroy();
				return;
			}
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ data: answer(query ?? '', variables ?? {}) }));
		});
	});
	await new Promise<void>((ok) => fake!.listen(fakePort, '127.0.0.1', ok));
	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST_URL: `http://127.0.0.1:${fakePort}`,
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
			TSUNDOKU_HOME: join(work, 'home'),
			BACKUP_DIR: join(work, 'backups')
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(BASE, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the lists preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	fake?.close();
	rmSync(work, { recursive: true, force: true });
});

test('a pasted link lands on AniList’s line, its list’s word beside it (1B, 1 → 2)', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${ids.comic}`);
	const a = line(page, 'anilist');
	await expect(a.locator('.t')).toHaveText('Not linked');
	await expect(a.locator('.m')).toHaveText('NOT SEARCHED YET · THE NEXT PASS SEARCHES IT');
	await expect(a.getByRole('link', { name: 'FIND' })).toHaveClass(/acc/);
	await paste(page, `/links?series=${ids.comic}`, 'https://anilist.co/manga/7701');
	await expect(a.locator('.t')).toHaveText('Lists Comic Entry');
	await expect(a.locator('.m')).toHaveText('MANGA · ANILIST 7701');
	// Signed in, never read: not on the list yet, and when it will be.
	await expect(a.locator('.s .l')).toHaveText(['NOT ON YOUR LIST']);
	await expect(a.locator('.s .r')).toHaveText(['ADDED ON THE NEXT CHAPTER READ']);
	// MAL has no entry here, and AniList is signed in: EDIT alone.
	await expect(a.locator('.c:visible')).toHaveText(['EDIT']);
});

test('a send to a catalogue that is down says so on its line, and TRY AGAIN sends it (1B, 4)', async ({
	page
}) => {
	sends = [];
	sendMode = 'down';
	await page.goto(`${BASE}/series/${ids.comic}`);
	// The long press on chapter 3 reads everything up to it, and the catalogue moves.
	await page.locator('.entry:has(.num:text-is("3")) .entry-btn').click({ button: 'right' });
	await expect(page.getByText(/^MARKED READ THROUGH/)).toBeVisible();
	const a = line(page, 'anilist');
	await expect
		.poll(
			async () => {
				await page.reload();
				return a.locator('.s .l').first().textContent();
			},
			{ timeout: 30_000 }
		)
		.toBe('CH. 3 NOT SENT');
	await expect(a.locator('.s .r.al')).toHaveText(/^ANILIST DID NOT ANSWER · \d\d:\d\d$/);
	expect(sends).toEqual([]);
	// Back up: TRY AGAIN is the line's own, and sends what waited.
	sendMode = 'ok';
	await a.getByRole('button', { name: 'TRY AGAIN' }).click();
	await expect(a.locator('.s .l').first()).toHaveText('READING · CH. 3');
	await expect(a.locator('.s .r')).toHaveText('SENT JUST NOW');
	await expect(a.getByRole('button', { name: 'TRY AGAIN' })).toHaveCount(0);
	expect(sends).toEqual([{ mediaId: 7701, progress: 3, status: 'CURRENT' }]);
});

test('EDIT opens the sheet on the entry, and its STATUS sends at once', async ({ page }) => {
	sends = [];
	await page.goto(`${BASE}/series/${ids.comic}`);
	await line(page, 'anilist').getByRole('button', { name: 'EDIT' }).click();
	const sheet = sheetOf(page);
	await expect(sheet.locator('.ti')).toHaveText('ANILIST');
	await expect(sheet.locator('.ent .t')).toHaveText('Lists Comic Entry');
	await expect(sheet.locator('.ent .m')).toHaveText('ANILIST 7701 · MANGA');
	await expect(sheet.locator('.sl', { hasText: 'ENTRY' })).toContainText('PASTED');
	await expect(sheet.locator('.sl', { hasText: 'STATUS' })).toContainText(
		'GOES TO ANILIST · A TAP SENDS IT'
	);
	await sheet.getByRole('button', { name: 'COMPLETED' }).click();
	await expect(sheet.getByRole('button', { name: 'COMPLETED' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect(sends).toEqual([{ mediaId: 7701, status: 'COMPLETED' }]);
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await expect(line(page, 'anilist').locator('.s .l').first()).toHaveText('COMPLETED · CH. 3');
});

test('offline: EDIT turns into OPEN ↗, every other cell dims, and the strip says why (1B, 8)', async ({
	page,
	context
}) => {
	await page.goto(`${BASE}/series/${ids.comic}`);
	await expect(line(page, 'anilist').getByRole('button', { name: 'EDIT' })).toBeVisible();
	await context.setOffline(true);
	try {
		await expect(lists(page).locator('.strip .note')).toHaveText(
			'○ OFFLINE · CHANGES NEED THE WORKSTATION'
		);
		const a = line(page, 'anilist');
		await expect(a.getByRole('button', { name: 'EDIT' })).toHaveCount(0);
		await expect(a.getByRole('link', { name: 'OPEN ↗' })).toHaveAttribute(
			'href',
			'https://anilist.co/manga/7701'
		);
		// What was sent is said as of when, not how long ago.
		await expect(a.locator('.s .r')).toHaveText(/^AS OF \d\d:\d\d$/);
	} finally {
		await context.setOffline(false);
	}
	await expect(line(page, 'anilist').getByRole('button', { name: 'EDIT' })).toBeVisible();
});

test('UNLINK in EDIT’s ENTRY: the line goes back to FIND, settled, and no pass asks again', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${ids.comic}`);
	await line(page, 'anilist').getByRole('button', { name: 'EDIT' }).click();
	const sheet = sheetOf(page);
	await sheet.getByRole('button', { name: 'UNLINK' }).click();
	await expect(sheet.locator('.ent .t')).toHaveText('Not linked');
	await sheet.getByRole('button', { name: 'DONE' }).click();
	const a = line(page, 'anilist');
	await expect(a.locator('.t')).toHaveText('Not linked');
	await expect(a.locator('.m')).toHaveText('UNLINKED · NO PASS ASKS AGAIN');
	// You already said no: FIND is plain, not the accent (1C).
	await expect(a.getByRole('link', { name: 'FIND' })).not.toHaveClass(/acc/);
});

test('a novel on its comic’s entry is linked for the cover, never tracked (1B, 5)', async ({
	page
}) => {
	await paste(page, `/links?series=${ids.novel}`, 'https://anilist.co/manga/7901');
	const a = line(page, 'anilist');
	await expect(a.locator('.m')).toHaveText('THE COMIC’S ENTRY · MANGA · ANILIST 7901');
	await expect(a.locator('.s .l')).toHaveText(['COVER AND DETAILS ONLY · NEVER TRACKED']);
	await a.getByRole('button', { name: 'EDIT' }).click();
	const sheet = sheetOf(page);
	await expect(sheet.locator('form.sts')).toHaveCount(0);
	await expect(sheet.locator('.note').first()).toHaveText('COVER AND DETAILS ONLY · NEVER TRACKED');
});

test('hidden, with reveal on: never searched, PASTE A LINK alone and the accent (1B, 7)', async ({
	page,
	context
}) => {
	await context.addCookies([
		{ name: 'tsundoku_reveal', value: '1', domain: 'localhost', path: '/' }
	]);
	await page.goto(`${BASE}/series/${ids.hidden}`);
	await expect(line(page, 'anilist').getByRole('link', { name: 'FIND' })).toBeVisible();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(page.getByRole('button', { name: 'UNHIDE' })).toBeVisible();
	const a = line(page, 'anilist');
	await expect(a.locator('.m')).toHaveText('HIDDEN SERIES ARE NEVER SEARCHED');
	await expect(a.locator('.c:visible')).toHaveText(['PASTE A LINK']);
	await expect(a.getByRole('link', { name: 'PASTE A LINK' })).toHaveClass(/acc/);
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(page.getByRole('button', { name: 'HIDE', exact: true })).toBeVisible();
});

test('four seasons, each linked on its own review, fold round the one being watched (1C, 11)', async ({
	page
}) => {
	// Four reviews, each LINK walking the relations first.
	test.setTimeout(120_000);
	for (const s of [1, 2, 3, 4])
		await paste(
			page,
			`/links?series=${ids.four}&season=${s}`,
			`https://anilist.co/anime/${7810 + s}`
		);
	const row = lists(page);
	// S1 is the one being watched (nothing watched yet); S2 – S4 fold under it.
	await expect(row.locator('.tag')).toHaveText(['S1']);
	await expect(row.locator('.tag.on')).toHaveText('S1');
	const fold = row.locator('button.fold');
	await expect(fold.locator('.ft')).toHaveText('S2 – S4');
	await expect(fold.locator('.fb')).toHaveText('↓ LINKED');
	await fold.click();
	await expect(row.locator('.tag')).toHaveText(['S1', 'S2', 'S3', 'S4']);
	await expect(row.locator('button.fold .go')).toHaveText('HIDE');
	// Only the season being watched carries its meta.
	await expect(line(page, 's1').locator('.m')).toHaveText('TV · 3 EP. · 2024');
	await expect(line(page, 's3').locator('.m')).toHaveCount(0);
	// EDIT on S3 opens the sheet on S3's tab and S3's entry.
	await line(page, 's3').getByRole('button', { name: 'EDIT' }).click();
	const sheet = sheetOf(page);
	await expect(sheet.locator('.ti')).toHaveText('S3 · ANILIST');
	await expect(sheet.locator('.tab.on .no')).toHaveText('S3');
	await expect(sheet.locator('.ent .t')).toHaveText('Four Seasons 3');
	await expect(sheet.getByRole('link', { name: 'CHANGE' })).toHaveAttribute(
		'href',
		`/links?series=${ids.four}&season=3`
	);
	await expect(sheet.locator('form[action="?/unlink"] input[name="season"]')).toHaveValue('3');
	await expect(sheet).not.toContainText(/SEASON 0|\bS0\b/);
});

test('a season on the wrong kind is flagged, never removed, and CHANGE is its accent (1B, 6)', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${ids.wrong}`);
	const a = line(page, 'anilist');
	await expect(a.locator('.s .l')).toHaveText([
		'LINKED TO THE WRONG KIND · NOTHING SENT',
		'CHANGE SEARCHES ANILIST’S ANIME'
	]);
	await expect(a.locator('.c:visible')).toHaveText(['CHANGE', 'EDIT']);
	await expect(a.getByRole('link', { name: 'CHANGE' })).toHaveClass(/acc/);
	await expect(a.getByRole('link', { name: 'CHANGE' })).toHaveAttribute(
		'href',
		`/links?series=${ids.wrong}`
	);
});

// ---- c390: the series screen's answer to a refused UNDO -------------------------------

/** A series' id by its exact title, read from this file's own database. */
function idOf(title: string): number {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
	} finally {
		db.close();
	}
}

/** What the database says now: P's hidden flag, and a Work's members in order. */
function now(seriesId: number, workId: number) {
	const db = new Database(dbPath, { readonly: true });
	try {
		return {
			hidden: (
				db.prepare(`SELECT hidden FROM series WHERE id = ?`).get(seriesId) as { hidden: number }
			).hidden,
			members: (
				db
					.prepare(`SELECT series_id FROM work_series WHERE work_id = ? ORDER BY position`)
					.all(workId) as { series_id: number }[]
			).map((r) => r.series_id)
		};
	} finally {
		db.close();
	}
}

/** A tile by its exact title: some of the sample's titles are prefixes of others. */
const tileOf = (page: import('@playwright/test').Page, title: string) =>
	page.locator('.grid .tile').filter({
		has: page.locator('.title', {
			hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
		})
	});

/** GROUP on the library, AS A WORK, the way the owner makes one; then its screen, and its id. */
async function makeWork(page: import('@playwright/test').Page, titles: string[], name: string) {
	await page.goto(`${BASE}/`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of titles) await tileOf(page, t).locator('.open').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill(name);
	await sheet.getByRole('button', { name: /CREATE WORK · \d+ SERIES/ }).click();
	await expect(page.locator('.band', { hasText: `${name.toUpperCase()} IS A WORK` })).toBeVisible();
	await page.locator('.grid .tile.work', { hasText: name }).click();
	await page.waitForURL(/\/work\/\d+/);
	return Number(/\/work\/(\d+)/.exec(page.url())![1]);
}

test('a refused UNDO of TAKE OUT, THEN HIDE is a band, never an error page, and changes nothing (c390)', async ({
	page,
	context
}) => {
	const [P, Q, R] = ['Isekai Yakkyoku', 'Tensei Shitara Ken Deshita', 'Mushoku Tensei'];
	const [X, Y] = ['Villainess Level 99', 'Chainsaw Man'];
	await context.addCookies([
		{ name: 'tsundoku_reveal', value: '1', domain: 'localhost', path: '/' }
	]);
	const old = await makeWork(page, [P, Q, R], 'Undo Run');
	const p = idOf(P);

	// Page A: HIDE on part P, and TAKE OUT; the band keeps its UNDO.
	await page.goto(`${BASE}/series/${p}`);
	await page.locator('.file-row').getByRole('button', { name: 'HIDE', exact: true }).click();
	const hide = page.getByRole('dialog', { name: 'Hide' });
	await expect(hide).toContainText("IT'S PART 1 OF UNDO RUN");
	await hide.getByRole('button', { name: 'TAKE OUT' }).click();
	const band = page.locator('.band', { hasText: 'HIDDEN · TAKEN OUT' });
	await expect(band).toBeVisible();
	expect(now(p, old)).toEqual({ hidden: 1, members: [idOf(Q), idOf(R)] });

	// Page B, a second tab: the Work ends on its own screen, and a new one takes its id.
	const b = await context.newPage();
	await b.goto(`${BASE}/work/${old}`);
	await b.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(b.locator('.grid .tile.work')).toHaveCount(0);
	const newer = await makeWork(b, [X, Y], 'Newer Run');
	expect(newer).toBe(old);
	const members = [idOf(X), idOf(Y)];
	expect(now(p, newer).members).toEqual(members);

	// Page A, at once: UNDO is refused, said on the screen, and nothing moved.
	await band.getByRole('button', { name: 'UNDO' }).click();
	const refused = page.locator('.band', { hasText: /HAS ENDED/ });
	await expect(refused).toBeVisible();
	await expect(refused).toContainText('NOTHING CHANGED');
	await expect(page).toHaveURL(`${BASE}/series/${p}`);
	await expect(page.getByRole('button', { name: 'UNHIDE' })).toBeVisible();
	expect(now(p, newer)).toEqual({ hidden: 1, members });
	await b.close();
});
