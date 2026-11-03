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
		'3 CANDIDATES FROM THE LAST COVER PASS · NONE LINKED'
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
	}),
	// A show the source names two seasons of, and AniList two entries (c240). FIND
	// asks with the season's own title, which the source's number and the series'
	// title give.
	entry({
		id: 9001,
		idMal: 7001,
		title: 'Sword Art Online',
		episodes: 12,
		season: 'FALL',
		seasonYear: 2012
	}),
	entry({
		id: 9002,
		idMal: 7002,
		title: 'Sword Art Online II',
		episodes: 11,
		season: 'FALL',
		seasonYear: 2014
	})
];
// The chain the relations are walked along: S1 and S2 are each other's sequel.
const RELATIONS: Record<number, { id: number; type: 'PREQUEL' | 'SEQUEL' }[]> = {
	9001: [{ id: 9002, type: 'SEQUEL' }],
	9002: [{ id: 9001, type: 'PREQUEL' }]
};
const COMIC_MEDIA: Media[] = [
	entry({ id: 30024, idMal: 24, title: 'Ranma ½', format: 'MANGA', chapters: 38 })
];

/** What the app asked for: the type and formats of each search (the kind rule's door). */
let asked: { type: string; formats: string[] }[] = [];

function catalogue(query: string, variables: Record<string, unknown>) {
	const out: Record<string, unknown> = {};
	const search =
		/s(\d+):\s*Page\(perPage:\s*\d+\)\s*\{\s*media\(search:\s*\$q(\d+),\s*type:\s*(ANIME|MANGA),\s*format_in:\s*\$f(\d+)/g;
	for (const m of query.matchAll(search)) {
		const [, alias, qi, type, fi] = m;
		const formats = (variables[`f${fi}`] as string[]) ?? [];
		asked.push({ type, formats });
		const pool = (type === 'ANIME' ? ANIME_MEDIA : COMIC_MEDIA).filter(
			(e) =>
				formats.includes(e.format) &&
				// A season is asked for by its own title: "Sword Art Online Season 2",
				// which the source's season number and the series' title give (c240).
				[e.title.english, e.title.romaji, ...e.synonyms]
					.filter((t): t is string => !!t)
					.some((t) => {
						const said = String(variables[`q${qi}`]).toLowerCase();
						const lower = t.toLowerCase();
						if (lower.includes(said)) return true;
						// The show's seasons, asked for as "Sword Art Online Season 2".
						const season = /\bseason\s*(\d+)$/.exec(said);
						if (!season) return false;
						return (
							(season[1] === '1' && lower === 'sword art online') ||
							(season[1] === '2' && lower === 'sword art online ii')
						);
					})
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
	// The relations (c240): m0: Media(id: $i0) { … relations { edges { relationType node { … } } } }.
	for (const m of query.matchAll(/m(\d+):\s*Media\(id:\s*\$i(\d+)\)/g)) {
		const id = Number(variables[`i${m[2]}`]);
		const self = ANIME_MEDIA.find((e) => e.id === id);
		if (!self) continue;
		out[`m${m[1]}`] = {
			...self,
			relations: {
				edges: (RELATIONS[id] ?? []).map((rel) => ({
					relationType: rel.type,
					node: ANIME_MEDIA.find((e) => e.id === rel.id) ?? self
				}))
			}
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
function seedAnime(): {
	ranma: number;
	frieren: number;
	sousou: number;
	sao: number;
} {
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
		// A show the source names two seasons of, for the per-season rows (c240):
		// one series here, one entry a season on AniList.
		const sao = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
					VALUES (?, 'Sword Art Online', 'anime', 'aniyomi', 210, ?, ?, 'aniyomi:1:/sao', 1, '')`
				)
				.run(root, now, now).lastInsertRowid
		);
		{
			let position = 0;
			const put = db.prepare(
				`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
				VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, 0, ?)`
			);
			for (const [season, count] of [
				[1, 12],
				[2, 11]
			] as const)
				for (let i = 1; i <= count; i++) {
					position += 1;
					put.run(sao, position, `Episode ${i}`, season, i, now, `/sao/${season}/${i}`);
				}
		}
		db.prepare(
			`INSERT OR REPLACE INTO link_decisions (series_id, decision, at) VALUES (?, 'none', ?)`
		).run(sousou, now);
		return { ranma, frieren, sousou, sao };
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

	test('a season links on its own line, and the rest come from the relations (c240)', async ({
		page
	}) => {
		// The source names two seasons of this show; AniList has an entry each.
		await page.goto(`${BASE}/series/${ids.sao}`);
		// The first season lines are the LINK row's; the TRACKING row has its own.
		const linkRow = page.locator('.seasons').first();
		await expect(linkRow.locator('.stag')).toHaveText(['S1', 'S2']);
		await expect(linkRow.locator('.s-b').first()).toHaveText('NOT SEARCHED YET');
		// FIND opens the review on that season, not the series.
		await linkRow.locator('.sline', { hasText: 'S2' }).getByRole('link', { name: 'FIND' }).click();
		await page.waitForURL(new RegExp(`/links\\?series=${ids.sao}&season=2`));
		await expect(page.locator('.heading .long')).toHaveText('LINK · SEASON 2');
		await expect(page.locator('.seasonbar .sb-b')).toHaveText('SEASON 2 OF 2 · 11 EPISODES HERE');
		// The season's own title is what was asked: the source's number and the
		// series' title, never invented.
		await expect(page.locator('.seasonbar .sb-c')).toHaveText('ASKED AS SWORD ART ONLINE SEASON 2');
		await expect(page.locator('.cand')).toHaveCount(1);
		await expect(page.locator('.cand .ctitle')).toHaveText('Sword Art Online II');
		await page.locator('.cand').first().click();
		await expect(page.locator('.actions button').last()).toHaveText('LINK A TO SEASON 2');
		await page.locator('.actions button').last().click();
		// The page turns to the rest of the show, the other season ticked (its count
		// agrees: 12 here, 12 there).
		await expect(page.locator('.band .line').first()).toHaveText(
			'LINKED · SEASON 2 TO SWORD ART ONLINE II'
		);
		// UNDO here is season 2's, though the series' open season is 1: a season's
		// decision is its own (c240).
		await page.getByRole('button', { name: 'UNDO' }).click();
		expect(seasonLinks()).toEqual([]);
		// Link it again, to carry on with the relations below.
		await page.locator('.cand').first().click();
		await page.locator('.actions button').last().click();
		await expect(page.locator('.band .line').first()).toHaveText(
			'LINKED · SEASON 2 TO SWORD ART ONLINE II'
		);
		expect(seasonLinks()).toEqual([{ season: 2, anilist_id: 9002, mal_id: 7002 }]);
		await expect(page.locator('.rels .ch div').first()).toHaveText(
			'02 — THE REST OF THE SERIES ON ANILIST'
		);
		const offered = page.locator('.relbtn');
		await expect(offered).toHaveCount(1);
		await expect(offered.locator('.rno')).toHaveText('S1');
		await expect(offered).toHaveAttribute('aria-pressed', 'true');
		await expect(offered.locator('.rwhy')).toContainText('COUNT AGREES');
		await page.getByRole('button', { name: 'LINK 1 SEASON' }).click();
		await page.waitForURL(new RegExp(`/series/${ids.sao}`));
		// Both seasons linked, each with its own line and its own entry.
		await expect(page.locator('.seasons').first().locator('.s-a')).toHaveText([
			'Sword Art Online',
			'Sword Art Online II'
		]);
		const written = seasonLinks();
		expect(written).toEqual([
			{ season: 1, anilist_id: 9001, mal_id: 7001 },
			{ season: 2, anilist_id: 9002, mal_id: 7002 }
		]);
		// And the TRACKING row draws the same two seasons: nothing is signed in here.
		await expect(page.locator('.track-row .stag')).toHaveText(['S1', 'S2']);
		await expect(page.locator('.track-row .tl-l').first()).toHaveText(
			'NOT SIGNED IN · NOTHING SENT'
		);
	});

	test('a sheet edit on a one-season anime in two parts goes to one part (c240)', async ({
		page
	}) => {
		// One season, split 12 + 11 on its catalogues: the sheet has no tabs to
		// read the season and part from, so it must still name them.
		const show = seedTwoParts();
		try {
			await page.goto(`${BASE}/series/${show}`);
			const row = page.locator('.track-row');
			await row.getByRole('button', { name: 'EDIT' }).click();
			await page.locator('form.statuses button', { hasText: 'COMPLETED' }).click();
			// The action queues and sends before it answers: what waits or what was
			// sent is this skill's to read, beside the server.
			await expect.poll(() => trackerRows(show).length).toBeGreaterThan(0);
			const rows = trackerRows(show);
			// Part 1 is what the sheet was on; part 2 keeps whatever its owner had.
			expect(rows.filter((r) => r.part === 1).map((r) => r.status)).toEqual(['completed']);
			expect(rows.filter((r) => r.part === 2)).toEqual([]);
		} finally {
			unseedAccount();
		}
	});
});

/** The one-season, two-part show this spec's last case edits, and a sign-in to reach the sheet. */
let twoParts: number | null = null;
function seedTwoParts(): number {
	if (twoParts !== null) return twoParts;
	const db = new Database(dbPath);
	try {
		const now = Date.UTC(2026, 10, 2, 12, 0);
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
					VALUES (?, 'Sword Art Online: Alicization', 'anime', 'aniyomi', 210, ?, ?, 'aniyomi:1:/sao-alicization', 1, '')`
				)
				.run(root, now, now).lastInsertRowid
		);
		const put = db.prepare(
			`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, ?, ?, 1, ?, ?, '', 0, 0, 0, ?)`
		);
		for (let i = 1; i <= 23; i++) put.run(id, i, `Episode ${i}`, i, now, `/sao4/${i}`);
		const link = db.prepare(
			`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, title, linked_at, resolved_at, format, episodes)
			VALUES (?, 1, ?, ?, 'relations', ?, ?, ?, 'TV', ?)`
		);
		link.run(id, 1, 9901, 'Sword Art Online: Alicization', now, now, 12);
		link.run(id, 2, 9902, 'Sword Art Online: Alicization Part 2', now, now, 11);
		// The sheet's EDIT needs a sign-in; nothing here reaches AniList but the
		// spec's stand-in, and MAL is not signed in at all.
		db.prepare(
			`INSERT OR REPLACE INTO tracker_accounts (service, user_id, user_name, access_token, signed_in_at)
			VALUES ('anilist', '7', 'masshiro', 'e2e-token', ?)`
		).run(now);
		return (twoParts = id);
	} finally {
		db.close();
	}
}

function unseedAccount(): void {
	const db = new Database(dbPath);
	try {
		db.prepare(`DELETE FROM tracker_accounts WHERE service = 'anilist'`).run();
	} finally {
		db.close();
	}
}

/** A season's sent or waiting rows, from either side of the send. */
function trackerRows(
	id: number
): { season: number; part: number; service: string; status: string }[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return [
			...(db
				.prepare(
					`SELECT season, part, service, status FROM season_tracker_state WHERE series_id = ?`
				)
				.all(id) as { season: number; part: number; service: string; status: string }[]),
			...(db
				.prepare(
					`SELECT season, part, service, status FROM season_tracker_sends WHERE series_id = ?`
				)
				.all(id) as { season: number; part: number; service: string; status: string }[])
		];
	} finally {
		db.close();
	}
}

/** The spec's own database, read beside the server: what a decision actually wrote. */
function seasonLinks(): { season: number; anilist_id: number; mal_id: number }[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare(
				`SELECT season, anilist_id, mal_id FROM series_season_links WHERE series_id = ? ORDER BY season`
			)
			.all(ids.sao) as { season: number; anilist_id: number; mal_id: number }[];
	} finally {
		db.close();
	}
}

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
