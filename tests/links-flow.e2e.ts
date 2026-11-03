import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * Catalogue links end to end (doc/LINKS.md), on the seed's links: Mount Hua
 * with three candidates, Yofukashi no Uta searched and nothing found, and The
 * Greatest Estate Developer linked from Mihon's MAL tracker. AniList is
 * switched off for the suite's shared server (TSUNDOKU_ANILIST=off), so a
 * paste there reads as unreachable. The last block runs its own server, its own
 * seeded anime and a stand-in catalogue, because those two cases need a search
 * that answers. Serial, tablet-portrait only; every test puts back what it did,
 * but for a SKIP, which only reorders the queue.
 */
test.describe.configure({ mode: 'serial' });

const band = (page: import('@playwright/test').Page) => page.getByText(/SERIES TO LINK/).first();

test('the library band counts the series to review, and opens the review', async ({ page }) => {
	await page.goto('/');
	await expect(band(page)).toHaveText('02 SERIES TO LINK');
	await page.getByRole('link', { name: 'Review the series to link' }).click();
	await page.waitForURL(/\/links$/);
	await expect(page.locator('.counter')).toHaveText('01 OF 02');
	await expect(page.locator('.title')).toHaveText('Return of the Mount Hua Sect');
	await expect(page.locator('.cand')).toHaveCount(3);
});

test('nothing is preselected; a tap chooses, LINK links, UNDO takes it back', async ({ page }) => {
	await page.goto('/links');
	const link = page.locator('.actions button').last();
	await expect(link).toHaveText('TAP ONE TO LINK');
	await expect(link).toBeDisabled();
	await page.locator('.cand').first().click();
	await expect(page.locator('.cand').first()).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.cand').first().locator('.chip')).toHaveText('✓ LINK THIS');
	await expect(link).toHaveText('LINK A');
	await link.click();
	await expect(page.locator('.band .line').first()).toHaveText(
		'LINKED · RETURN OF THE BLOSSOMING BLADE'
	);
	await expect(page.locator('.title')).toHaveText('Yofukashi no Uta');
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.title')).toHaveText('Return of the Mount Hua Sect');
	await page.goto('/');
	await expect(band(page)).toHaveText('02 SERIES TO LINK');
});

test('NONE OF THESE leaves the queue, and its UNDO brings it back', async ({ page }) => {
	await page.goto('/links');
	await page.getByRole('button', { name: 'NONE OF THESE' }).click();
	await expect(page.locator('.band .line').first()).toHaveText('NONE OF THESE · WON’T ASK AGAIN');
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.title')).toHaveText('Return of the Mount Hua Sect');
});

test('with nothing found: SEARCH AGAIN, AniList out of reach, waits for the pass; UNDO takes it back', async ({
	page
}) => {
	await page.goto('/links');
	await page.getByRole('button', { name: 'SKIP' }).click();
	await expect(page.locator('.title')).toHaveText('Yofukashi no Uta');
	await expect(page.getByText('AniList found nothing under this title.')).toBeVisible();
	// Nothing found can be skipped too.
	await expect(page.locator('.actions button')).toHaveText([
		'SEARCH AGAIN',
		'PASTE A LINK',
		'SKIP'
	]);
	await page.locator('.actions button', { hasText: 'SEARCH AGAIN' }).click();
	await page.getByLabel('Title to search on AniList').fill('Call of the Night');
	await page.getByRole('button', { name: 'SEARCH', exact: true }).click();
	// AniList is off for the suite, so the search waits for the pass, and says why.
	await expect(page.getByText('○ ANILIST UNREACHABLE · LINK STILL WORKS')).toBeVisible();
	const done = page.locator('.band', { has: page.getByRole('button', { name: 'UNDO' }) });
	await expect(done.locator('.line').first()).toHaveText('QUEUED · “Call of the Night”');
	await expect(done.locator('.line').nth(1)).toHaveText(
		'ANILIST UNREACHABLE · SEARCHED IN THE NEXT COVER PASS'
	);
	// Out of the review until the next pass...
	await expect(page.locator('.title')).toHaveText('Return of the Mount Hua Sect');
	await expect(page.locator('.counter')).toHaveText('02 OF 02');
	// ...unless UNDO puts it back as it was.
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.title')).toHaveText('Yofukashi no Uta');
	await page.goto('/');
	await expect(band(page)).toHaveText('02 SERIES TO LINK');
});

test('a pasted link needs AniList: unreachable, it says so and links nothing', async ({ page }) => {
	await page.goto('/links');
	// Either series may lead now (the SKIP above stands): PASTE A LINK is in the tools or the actions.
	await page.getByRole('button', { name: 'PASTE A LINK' }).click();
	await page.getByLabel('AniList or MAL link').fill('https://anilist.co/manga/85143');
	await expect(page.locator('.fnote.last')).toHaveText(
		'ANILIST DID NOT ANSWER · TRY AGAIN WHEN IT’S BACK'
	);
	await expect(page.getByText('○ ANILIST UNREACHABLE · LINK STILL WORKS')).toBeVisible();
	await page.getByLabel('AniList or MAL link').fill('not a link');
	await expect(page.locator('.fnote.last')).toHaveText('NOT AN ANILIST OR MAL MANGA LINK');
});

test('the series screen: LINK and COVER rows, and FIND opens its own review', async ({ page }) => {
	await page.goto('/');
	await page.locator('.tile', { hasText: 'The Greatest Estate Developer' }).first().click();
	await page.waitForURL(/\/series\/\d+/);
	const row = page.locator('.link-row');
	await expect(row.locator('.lk-a')).toHaveText('The Greatest Estate Developer');
	await expect(row.locator('.lk-b')).toHaveText(
		'ANILIST 900001 · MAL 800001 · FROM MIHON’S MAL TRACKER'
	);
	await expect(row.getByRole('link', { name: 'OPEN ↗' })).toHaveAttribute(
		'href',
		'https://anilist.co/manga/900001'
	);
	await expect(page.locator('.cover-row .cv-a')).toHaveText('NONE');

	const hua = page.url();
	await page.goto('/');
	await page.locator('.tile', { hasText: 'Return of the Mount Hua Sect' }).first().click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.locator('.link-row .lk-a')).toHaveText('Not linked');
	await expect(page.locator('.link-row .lk-b')).toHaveText(
		'3 CANDIDATES FROM THE LAST COVER PASS · NONE EXACT'
	);
	await page.locator('.lcs.inline').getByRole('link', { name: 'FIND' }).click();
	await page.waitForURL(/\/links\?series=\d+/);
	await expect(page.locator('.counter')).toHaveText('01 OF 01');
	await expect(page.locator('.back')).toHaveText('← SERIES');
	// One series only: no SKIP.
	await expect(page.getByRole('button', { name: 'SKIP' })).toHaveCount(0);
	await page.goto(hua);
});

// ---- a catalogue that answers (c298's two e2e cases) -------------------------------------
//
// The shared server runs with TSUNDOKU_ANILIST=off and seeds no anime, so the two cases the
// card asks for -- an anime series' search listing only anime, and one equal title that waits
// for LINK -- run against their own preview, their own seeded database and a stand-in AniList
// behind TSUNDOKU_ANILIST_URL. Nothing here can reach the real one.
//
// The address of both servers is the OS's to give (listen(0) then that number): no fixed port
// to collide with the specs running beside this one.

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
	title: { romaji: string | null; english: string | null; native: string | null };
	startDate: { year: number | null };
	coverImage: { extraLarge: string | null; large: string | null };
};

/** AniList's two catalogues, as a stand-in for its search: the same titles, one of each kind. */
const entry = (o: Omit<Partial<Media>, 'title'> & { id: number; title: string }): Media => ({
	id: o.id,
	idMal: o.idMal ?? null,
	format: o.format ?? 'TV',
	countryOfOrigin: o.countryOfOrigin ?? 'JP',
	status: o.status ?? 'FINISHED',
	chapters: o.chapters ?? null,
	volumes: null,
	episodes: o.episodes ?? null,
	season: o.season ?? null,
	seasonYear: o.seasonYear ?? null,
	synonyms: [],
	title: { romaji: o.title, english: o.title, native: null },
	startDate: { year: o.seasonYear ?? null },
	coverImage: { extraLarge: null, large: null }
});
const ANIME_MEDIA: Media[] = [
	entry({ id: 30023, idMal: 23, title: 'Ranma ½', episodes: 18, season: 'FALL', seasonYear: 1989 }),
	entry({
		id: 166531,
		idMal: 59121,
		title: 'Ranma ½ (2024)',
		episodes: 24,
		season: 'FALL',
		seasonYear: 2024
	}),
	entry({
		id: 52991,
		idMal: 52991,
		title: 'Frieren',
		episodes: 28,
		season: 'FALL',
		seasonYear: 2023
	})
];
const COMIC_MEDIA: Media[] = [
	entry({ id: 30024, idMal: 24, title: 'Ranma ½', format: 'MANGA', chapters: 38 })
];

/** What the app asked for: the type and formats of each search (the kind rule's door). */
let asked: { type: string; formats: string[] }[] = [];

function catalogue(query: string, variables: Record<string, unknown>) {
	const out: Record<string, { media: Media[] }> = {};
	const search =
		/s(\d+):\s*Page\(perPage:\s*\d+\)\s*\{\s*media\(search:\s*\$q(\d+),\s*type:\s*(ANIME|MANGA),\s*format_in:\s*\$f(\d+)/g;
	for (const m of query.matchAll(search)) {
		const [, alias, qi, type, fi] = m;
		const formats = (variables[`f${fi}`] as string[]) ?? [];
		asked.push({ type, formats });
		const pool = (type === 'ANIME' ? ANIME_MEDIA : COMIC_MEDIA).filter(
			(e) =>
				formats.includes(e.format) &&
				[e.title.english, e.title.romaji, ...e.synonyms]
					.filter((t): t is string => !!t)
					.some((t) => t.toLowerCase().includes(String(variables[`q${qi}`]).toLowerCase()))
		);
		out[`s${alias}`] = { media: pool };
	}
	// A link's ids being resolved: fifty at a time, in one catalogue.
	const byIds =
		/Page\(perPage:\s*50\)\s*\{\s*media\((id_in|idMal_in):\s*\$ids,\s*type:\s*(ANIME|MANGA)\)/.exec(
			query
		);
	if (byIds) {
		const ids = (variables.ids as number[]) ?? [];
		const pool = byIds[2] === 'ANIME' ? ANIME_MEDIA : COMIC_MEDIA;
		out.Page = {
			media: pool.filter((e) => ids.includes(byIds[1] === 'id_in' ? e.id : (e.idMal ?? -1)))
		};
	}
	return out;
}

const scratch = (name: string) =>
	mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), name));
const work = scratch('tsundoku-links-');
const dbPath = join(work, 'links.sqlite');
const library = join(work, 'library');
let preview: ChildProcess | null = null;
let fakeCatalogue: Server | null = null;
let BASE = '';

/** The OS's own port: nothing this spec picks can collide with the suites beside it. */
function freePort(): Promise<number> {
	return new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});
}

/** The sample library, then this spec's anime; the seed's own two review rows are settled. */
function seedAnime(): { ranma: number; frieren: number; sousou: number } {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, LIBRARY_ROOT: library, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 2, 12, 0);
		// The seed's own queue is this spec's business too: A and B below are all it looks at.
		db.prepare(
			`INSERT OR REPLACE INTO link_decisions (series_id, decision, at)
			SELECT id, 'none', ? FROM series WHERE title IN ('Return of the Mount Hua Sect', 'Yofukashi no Uta')`
		).run(now);
		const add = (title: string, n: number, key: string) => {
			const id = Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
						VALUES (?, ?, 'anime', 'aniyomi', 210, ?, ?, ?, 1, '')`
					)
					.run(root, title, now, now, key).lastInsertRowid
			);
			const put = db.prepare(
				`INSERT INTO entries (series_id, position, label, episode_number, added_at, file, bytes, page_count, available, source_url)
				VALUES (?, ?, ?, ?, ?, '', 0, 0, 0, ?)`
			);
			for (let i = 1; i <= n; i++) put.run(id, i, `Episode ${i}`, i, now, `/ep-${i}`);
			return id;
		};
		const ranma = add('Ranma ½ (2024)', 24, 'aniyomi:1:/ranma-2024');
		const frieren = add('Frieren', 28, 'aniyomi:1:/frieren');
		// Its own title is longer than the title a search will type at it, so the
		// chip has to come from the query rather than from the series' titles.
		const sousou = add('Sousou no Frieren', 28, 'aniyomi:1:/sousou-no-frieren');
		db.prepare(
			`INSERT OR REPLACE INTO link_decisions (series_id, decision, at) VALUES (?, 'none', ?)`
		).run(sousou, now);
		return { ranma, frieren, sousou };
	} finally {
		db.close();
	}
}

const ids = seedAnime();

test.describe('a catalogue that answers', () => {
	test.beforeAll(async () => {
		const fakePort = await freePort();
		fakeCatalogue = createServer((req: IncomingMessage, res: ServerResponse) => {
			let body = '';
			req.on('data', (b: Buffer) => (body += b.toString()));
			req.on('end', () => {
				const { query, variables } = JSON.parse(body || '{}') as {
					query: string;
					variables: Record<string, unknown>;
				};
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ data: catalogue(query, variables ?? {}) }));
			});
		});
		await new Promise<void>((ok) => fakeCatalogue!.listen(fakePort, '127.0.0.1', ok));

		const port = await freePort();
		BASE = `http://localhost:${port}`;
		preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				TSUNDOKU_ANILIST_URL: `http://127.0.0.1:${fakePort}`,
				LIBRARY_ROOT: library,
				COVER_DIR: join(work, 'covers'),
				TSUNDOKU_HOME: join(work, 'home'),
				BACKUP_DIR: join(work, 'backups')
			},
			stdio: 'ignore'
		});
		for (let i = 0; i < 120; i++) {
			try {
				if ((await fetch(`${BASE}/links`, { redirect: 'manual' })).status) return;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		throw new Error('the links preview never answered');
	});

	test.afterAll(() => {
		preview?.kill();
		fakeCatalogue?.close();
		rmSync(work, { recursive: true, force: true });
	});

	test('FIND on an anime series searches its own catalogue, and lists only anime', async ({
		page
	}) => {
		asked = [];
		// FIND on a series never searched: the review asks as it opens, with the title.
		await page.goto(`${BASE}/links?series=${ids.ranma}`);
		await expect(page.locator('.cand')).toHaveCount(1);
		await expect(page.locator('.cand .ctitle')).toHaveText('Ranma ½ (2024)');
		// The series panel is anime-shaped: EPISODES, and its source named once.
		await expect(page.locator('.series .r .rl')).toHaveText(['SOURCE', 'EPISODES', 'COVER']);
		await expect(page.locator('.series .r').first()).toContainText('ANIYOMI');
		// SEARCH AGAIN under the title both entries carry: two anime, and no manga of either.
		await page.getByRole('button', { name: 'SEARCH AGAIN' }).click();
		await page.getByLabel('Title to search on AniList').fill('Ranma ½');
		await page.getByRole('button', { name: 'SEARCH', exact: true }).click();
		await expect(page.locator('.searched')).toContainText('“Ranma ½” JUST NOW · 2 FOUND');
		await expect(page.locator('.cand')).toHaveCount(2);
		// Every search this series ran asked for AniList's anime catalogue and its anime
		// formats, and nothing else: the manga of the same name is not even a candidate
		// (the stand-in answers it under MANGA only).
		expect(asked.length).toBeGreaterThanOrEqual(2);
		for (const a of asked)
			expect(a).toEqual({
				type: 'ANIME',
				formats: ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL']
			});
		for (const cand of await page.locator('.cand').all()) {
			await expect(cand.locator('.rl')).toHaveText(['FORMAT', 'SEASON', 'EPISODES', 'STATUS']);
			await expect(cand.locator('.r').first()).toContainText('TV');
		}
		// The equal title is marked, never chosen: the series' own year ties 2024 over 1989.
		await expect(
			page.locator('.cand', { hasText: 'Ranma ½ (2024)' }).locator('.chip.exact')
		).toHaveText('EXACT TITLE');
		await expect(page.locator('.cand[aria-pressed="true"]')).toHaveCount(0);
	});

	test('one equal title is shown, links nothing until LINK, and UNDO takes it back', async ({
		page
	}) => {
		// FIND's own search finds exactly one entry, and its title is the series'.
		await page.goto(`${BASE}/links?series=${ids.frieren}`);
		await expect(page.locator('.cand')).toHaveCount(1);
		await expect(page.locator('.cand .chip.exact')).toHaveText('EXACT TITLE');
		await expect(page.locator('.actions button').last()).toHaveText('TAP ONE TO LINK');
		expect(linkedCount()).toBe(0);
		// The queue holds the two searched anime (the seed's own are settled): SKIP the first.
		await page.goto(`${BASE}/links`);
		await expect(page.locator('.counter')).toHaveText('01 OF 02');
		await page.getByRole('button', { name: 'SKIP' }).click();
		await expect(page.locator('.title')).toHaveText('Frieren');
		// Still nothing linked: the search only offered, one result or not.
		expect(linkedCount()).toBe(0);
		await page.locator('.cand').first().click();
		await page.locator('.actions button').last().click();
		await expect(page.locator('.band .line').first()).toHaveText('LINKED · FRIEREN');
		expect(link()).toMatchObject({ anilist_id: 52991, via: 'review' });
		await page.getByRole('button', { name: 'UNDO' }).click();
		await expect(page.locator('.title')).toHaveText('Frieren');
		expect(linkedCount()).toBe(0);
		await expect(page.locator('.cand')).toHaveCount(1);
	});

	test('the query counts as one of the series’ titles for the EXACT TITLE chip', async ({
		page
	}) => {
		// "Sousou no Frieren" is the series' own title; the chip has to see the
		// title the owner typed too, or an exact candidate carries no mark.
		await page.goto(`${BASE}/links?series=${ids.sousou}`);
		await page.getByRole('button', { name: 'SEARCH AGAIN' }).click();
		await page.getByLabel('Title to search on AniList').fill('Frieren');
		await page.getByRole('button', { name: 'SEARCH', exact: true }).click();
		await expect(page.locator('.searched')).toContainText('“Frieren” JUST NOW · 1 FOUND');
		await expect(page.locator('.cand')).toHaveCount(1);
		await expect(page.locator('.cand .ctitle')).toHaveText('Frieren');
		await expect(page.locator('.cand .chip.exact')).toHaveText('EXACT TITLE');
		// A mark is not a choice: the search still links nothing.
		await expect(page.locator('.cand[aria-pressed="true"]')).toHaveCount(0);
	});
});

/** The spec's own database, read beside the server: what a decision actually wrote. */
function linkedCount(): number {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (
			db.prepare(`SELECT COUNT(*) AS n FROM series_links WHERE series_id = ?`).get(ids.frieren) as {
				n: number;
			}
		).n;
	} finally {
		db.close();
	}
}

function link(): Record<string, unknown> | undefined {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare(`SELECT anilist_id, mal_id, via, format FROM series_links WHERE series_id = ?`)
			.get(ids.frieren) as Record<string, unknown> | undefined;
	} finally {
		db.close();
	}
}
