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
/** One line of the series screen's LISTS row (c424): `anilist`, `ranobe`, or `s2` on an anime. */
const listLine = (page: import('@playwright/test').Page, key: string) =>
	page.locator(`[data-row="lists"] [data-line="${key}"]`);

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

test('the series screen: LISTS and COVER rows, and FIND opens its own review', async ({ page }) => {
	await page.goto('/');
	await page.locator('.tile', { hasText: 'The Greatest Estate Developer' }).first().click();
	await page.waitForURL(/\/series\/\d+/);
	// LINK's facts are AniList's line on LISTS now (c424): the entry, MAL's id with it.
	const line = listLine(page, 'anilist');
	await expect(line.locator('.t')).toHaveText('The Greatest Estate Developer');
	await expect(line.locator('.m')).toHaveText('MAL 800001');
	// OPEN ↗, CHANGE and UNLINK moved into EDIT's sheet, under ENTRY, with where the link came from.
	await line.getByRole('button', { name: 'EDIT' }).click();
	const sheet = page.getByRole('dialog', { name: 'Tracking' });
	await expect(sheet.locator('.sl', { hasText: 'ENTRY' })).toContainText(
		'FROM MIHON’S MAL TRACKER'
	);
	await expect(sheet.locator('.ent .m')).toHaveText('ANILIST 900001 · MAL 800001');
	await expect(sheet.locator('.cells').getByRole('link', { name: 'OPEN ↗' })).toHaveAttribute(
		'href',
		'https://anilist.co/manga/900001'
	);
	await expect(sheet.getByRole('link', { name: 'CHANGE' })).toHaveAttribute(
		'href',
		/\/links\?series=\d+$/
	);
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await expect(page.locator('.cover-row .cv-a')).toHaveText('NONE');

	const hua = page.url();
	await page.goto('/');
	await page.locator('.tile', { hasText: 'Return of the Mount Hua Sect' }).first().click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(listLine(page, 'anilist').locator('.t')).toHaveText('Not linked');
	// What the search found, never who ran it (c337: the review band can't tell either).
	await expect(listLine(page, 'anilist').locator('.m')).toHaveText(
		'3 FOUND ON ANILIST · NOT FOR CERTAIN'
	);
	await listLine(page, 'anilist').getByRole('link', { name: 'FIND' }).click();
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
	}),
	// Beside SAO's chain, as AniList lists them (c351): a special that is its
	// side story, and a TV spin-off whose 11 episodes agree with season 2's.
	entry({
		id: 9003,
		idMal: 7003,
		title: 'Sword Art Online: Extra Edition',
		format: 'SPECIAL',
		episodes: 1,
		season: 'WINTER',
		seasonYear: 2013
	}),
	entry({
		id: 9004,
		idMal: 7004,
		title: 'Sword Art Online Alternative: Gun Gale Online',
		episodes: 11,
		season: 'SPRING',
		seasonYear: 2018
	}),
	// A flat list's show (c423): the source gave its 12 episodes no season, so
	// tsundoku has one season, numbered 0. AniList has the show and two sequels,
	// and its search for the show's title lists all three, as it did for Ranma ½
	// (2024): the sequels are what the old page offered after a LINK.
	entry({
		id: 9301,
		idMal: 9401,
		title: 'Flat List Show',
		episodes: 12,
		season: 'FALL',
		seasonYear: 2024
	}),
	entry({
		id: 9302,
		idMal: 9402,
		title: 'Flat List Show Season 2',
		episodes: 12,
		season: 'FALL',
		seasonYear: 2025
	}),
	entry({
		id: 9303,
		idMal: 9403,
		title: 'Flat List Show Season 3',
		episodes: 12,
		season: 'FALL',
		seasonYear: 2026
	}),
	// A show whose second season AniList splits in two (round 2 of c418): 12,
	// then 12 + 11 for the source's 23, then 12. The chain runs through all four.
	entry({ id: 9501, idMal: 9511, title: 'Split Show', episodes: 12, seasonYear: 2020 }),
	entry({ id: 9502, idMal: 9512, title: 'Split Show 2nd Season', episodes: 12, seasonYear: 2021 }),
	entry({
		id: 9503,
		idMal: 9513,
		title: 'Split Show 2nd Season Part 2',
		episodes: 11,
		seasonYear: 2022
	}),
	entry({ id: 9504, idMal: 9514, title: 'Split Show 3rd Season', episodes: 12, seasonYear: 2023 }),
	// The same show in AniList's usual shape (c464): part 2 chained off part 1.
	entry({ id: 9701, idMal: 9711, title: 'Chain Split Show', episodes: 12, seasonYear: 2020 }),
	entry({
		id: 9702,
		idMal: 9712,
		title: 'Chain Split Show 2nd Season',
		episodes: 12,
		seasonYear: 2021
	}),
	entry({
		id: 9703,
		idMal: 9713,
		title: 'Chain Split Show 2nd Season Part 2',
		episodes: 11,
		seasonYear: 2022
	}),
	entry({
		id: 9704,
		idMal: 9714,
		title: 'Chain Split Show 3rd Season',
		episodes: 12,
		seasonYear: 2023
	}),
	// A show whose entry has no chain edge into the show's seasons (round 2 of
	// c423): only the manga it adapts. And one whose relations AniList fails to
	// answer (the stand-in errors on it), as when it is out of reach.
	entry({ id: 9601, idMal: 9611, title: 'Lone Show', episodes: 12, seasonYear: 2019 }),
	entry({ id: 9602, idMal: 9612, title: 'Lone Show Again', episodes: 12, seasonYear: 2021 })
];
/** The entries whose relations the stand-in answers with an error, as AniList's 500. */
const RELATIONS_FAIL = new Set([9602]);
// The chain the relations are walked along: S1 and S2 are each other's sequel.
// Every edge AniList lists is answered, not only the chain's: the manga S1 was
// adapted from, its side story, S2's spin-off (and the spin-off's way back).
const RELATIONS: Record<number, { id: number; type: string }[]> = {
	9001: [
		{ id: 9002, type: 'SEQUEL' },
		{ id: 30024, type: 'ADAPTATION' },
		{ id: 9003, type: 'SIDE_STORY' }
	],
	9002: [
		{ id: 9001, type: 'PREQUEL' },
		{ id: 9004, type: 'SPIN_OFF' }
	],
	9003: [{ id: 9001, type: 'PARENT' }],
	9004: [{ id: 9002, type: 'SPIN_OFF' }],
	9301: [{ id: 9302, type: 'SEQUEL' }],
	9302: [
		{ id: 9301, type: 'PREQUEL' },
		{ id: 9303, type: 'SEQUEL' }
	],
	9303: [{ id: 9302, type: 'PREQUEL' }],
	// Both parts listed as season 1's sequel (as in season-links-db's Split
	// Show). AniList more often chains part 2 off part 1: Chain Split Show, below
	// (c464). The walker pairs both shapes.
	9501: [
		{ id: 9502, type: 'SEQUEL' },
		{ id: 9503, type: 'SEQUEL' },
		{ id: 30024, type: 'ADAPTATION' }
	],
	9502: [
		{ id: 9501, type: 'PREQUEL' },
		{ id: 9503, type: 'SEQUEL' }
	],
	9503: [
		{ id: 9502, type: 'PREQUEL' },
		{ id: 9501, type: 'PREQUEL' },
		{ id: 9504, type: 'SEQUEL' }
	],
	9504: [{ id: 9503, type: 'PREQUEL' }],
	9701: [
		{ id: 9702, type: 'SEQUEL' },
		{ id: 30024, type: 'ADAPTATION' }
	],
	9702: [
		{ id: 9701, type: 'PREQUEL' },
		{ id: 9703, type: 'SEQUEL' }
	],
	9703: [
		{ id: 9702, type: 'PREQUEL' },
		{ id: 9704, type: 'SEQUEL' }
	],
	9704: [{ id: 9703, type: 'PREQUEL' }],
	9601: [{ id: 30024, type: 'ADAPTATION' }],
	9602: [{ id: 9601, type: 'PREQUEL' }]
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
					node: [...ANIME_MEDIA, ...COMIC_MEDIA].find((e) => e.id === rel.id) ?? self
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
				// A relations request for an entry AniList fails on: a 500, as when
				// it is down, so the LINK's answer carries no relations at all.
				const relationsOf = [...(query ?? '').matchAll(/Media\(id:\s*\$i(\d+)\)/g)].map((m) =>
					Number((variables ?? {})[`i${m[1]}`])
				);
				if (relationsOf.some((id) => RELATIONS_FAIL.has(id))) {
					res.writeHead(500, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ errors: [{ message: 'Internal Server Error', status: 500 }] }));
					return;
				}
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
		// A line a season on LISTS (c424), each with its own search and its own FIND.
		const row = page.locator('[data-row="lists"]');
		await expect(row.locator('.tag')).toHaveText(['S1', 'S2']);
		await expect(listLine(page, 's1').locator('.m')).toHaveText(
			'NOT SEARCHED YET · THE NEXT PASS SEARCHES IT'
		);
		// FIND opens the review on that season, not the series.
		await listLine(page, 's2').getByRole('link', { name: 'FIND' }).click();
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
		// decision is its own (c240). The bar goes once the workstation has taken
		// it back, which is when the row is really gone.
		await page.getByRole('button', { name: 'UNDO' }).click();
		await expect(page.getByRole('button', { name: 'UNDO' })).toHaveCount(0);
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
		const offered = page.locator('.rel:not(.outside) .relbtn');
		await expect(offered).toHaveCount(1);
		await expect(offered.locator('.rno')).toHaveText('S1');
		await expect(offered).toHaveAttribute('aria-pressed', 'true');
		await expect(offered.locator('.rwhy')).toContainText('COUNT AGREES');
		// The side story and the spin-off are listed after the seasons, dimmed and
		// never ticked, though the spin-off is TV and its count agrees with season
		// 2's (c351). The manga S1 was adapted from is not listed at all.
		const outside = page.locator('.rel.outside .relbtn');
		await expect(outside.locator('.rtitle')).toHaveText([
			'Sword Art Online: Extra Edition',
			'Sword Art Online Alternative: Gun Gale Online'
		]);
		await expect(outside.locator('.rmeta')).toHaveText([
			'SIDE STORY · SPECIAL · 1 EP. · 2013',
			'SPIN-OFF, NOT A SEQUEL · TV · 11 EP. · 2018'
		]);
		for (const b of await outside.all()) {
			await expect(b).toBeDisabled();
			await expect(b).toHaveAttribute('aria-pressed', 'false');
		}
		await expect(page.locator('.rels .ch div').nth(1)).toHaveText('1 OF 1 TICKED');
		// Meanwhile (a second tab, say) season 1's entry is taken by season 2's
		// part 2: LINK 1 SEASON is refused, and the page names the season and
		// what holds its entry, from the workstation's answer (c418).
		holdSeasonOneEntry(true);
		try {
			await page.getByRole('button', { name: 'LINK 1 SEASON' }).click();
			await expect(page.locator('.band[role="alert"] .line')).toHaveText(
				'NOTHING LINKED · SEASON 1 NOT LINKED · SEASON 2 PART 2 HOLDS ITS ENTRY'
			);
			expect(seasonLinks().filter((l) => l.season === 1)).toEqual([]);
		} finally {
			holdSeasonOneEntry(false);
		}
		// Nothing outside the numbering became a season's candidate.
		expect(candidatesOf(ids.sao).filter((c) => [9003, 9004, 30024].includes(c))).toEqual([]);
		await page.getByRole('button', { name: 'LINK 1 SEASON' }).click();
		await page.waitForURL(new RegExp(`/series/${ids.sao}`));
		// Both seasons linked, each with its own line and its own entry.
		await expect(page.locator('[data-row="lists"] .t')).toHaveText([
			'Sword Art Online',
			'Sword Art Online II'
		]);
		const written = seasonLinks();
		expect(written).toEqual([
			{ season: 1, anilist_id: 9001, mal_id: 7001 },
			{ season: 2, anilist_id: 9002, mal_id: 7002 }
		]);
		// A link given by the relations says where it came from, as every other
		// one does (c240): in EDIT's ENTRY now, which the season's EDIT opens on it.
		await listLine(page, 's1').getByRole('button', { name: 'EDIT' }).click();
		const sheet = page.getByRole('dialog', { name: 'Tracking' });
		await expect(sheet.locator('.tab.on .no')).toHaveText('S1');
		await expect(sheet.locator('.sl', { hasText: 'ENTRY' })).toContainText(
			'FROM ANILIST’S RELATIONS'
		);
		await sheet.getByRole('button', { name: 'DONE' }).click();
		// And each season's line carries its list's word: nothing is signed in here.
		await expect(page.locator('[data-row="lists"] .tag')).toHaveText(['S1', 'S2']);
		await expect(listLine(page, 's1').locator('.s .l').first()).toHaveText(
			'ANILIST AND MAL · NOT SIGNED IN'
		);
		// A pasted link is a door that offers a season an entry too (c418):
		// season 2's entry pasted on season 1 is read, said to be held, and its
		// LINK stays dimmed.
		await page.goto(`${BASE}/links?series=${ids.sao}&season=1`);
		await page.getByRole('button', { name: 'PASTE A LINK' }).click();
		await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9002');
		await expect(page.locator('.fnote.last')).toHaveText(
			'SEASON 2 HOLDS THIS ENTRY · LINK REFUSES IT'
		);
		await expect(page.locator('.actions button').last()).toHaveText(/^LINK [A-Z] TO SEASON 1$/);
		await expect(page.locator('.actions button').last()).toBeDisabled();
		// Its own entry pasted back is not held: a CHANGE to itself.
		await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9001');
		await expect(page.locator('.fnote.last')).toHaveText(
			'READ AS ANILIST 9001 · ONLY THE ID WAS SENT, NEVER THE TITLE'
		);
		await expect(page.locator('.actions button').last()).toBeEnabled();
		expect(seasonLinks()).toEqual(written);
	});

	test('a sheet edit on a one-season anime in two parts goes to one part (c240)', async ({
		page
	}) => {
		// One season, split 12 + 11 on its catalogues: the sheet has no tabs to
		// read the season and part from, so it must still name them.
		const show = seedTwoParts();
		try {
			await page.goto(`${BASE}/series/${show}`);
			// One season: one ANILIST line (c424), and its EDIT opens the sheet on it.
			await listLine(page, 'anilist').getByRole('button', { name: 'EDIT' }).click();
			const sheet = page.getByRole('dialog', { name: 'Tracking' });
			// The status rule, as the send keeps it (round 1's low): the last episode
			// completes a season, but never over the owner's ON HOLD or DROPPED.
			await expect(sheet.locator('.note').last()).toContainText(
				'ITS LAST SENDS COMPLETED. ON HOLD AND DROPPED ARE YOURS AND STAY: ONLY THE EPISODE GOES.'
			);
			await sheet.locator('form.sts button', { hasText: 'COMPLETED' }).click();
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

	test('UNLINK on a one-season anime takes its link, every part of it (c240)', async ({ page }) => {
		// The one-season row is the LINK row a series always drew, and its UNLINK
		// form names no season: absent is every season, never season 0, which is
		// a real one (a flat list). Wave 13's round 2 found it read as 0, and the
		// link stayed while a season-0 decision was written.
		const show = seedTwoParts();
		try {
			expect(seasonRowsOf(show).links).toEqual([
				{ season: 1, part: 1 },
				{ season: 1, part: 2 }
			]);
			await page.goto(`${BASE}/series/${show}`);
			// UNLINK lives in EDIT's ENTRY now (c424); a one-season show's sheet has no tabs.
			await listLine(page, 'anilist').getByRole('button', { name: 'EDIT' }).click();
			const unlinkButton = page.locator('form[action="?/unlink"] button:visible');
			await expect(page.locator('form[action="?/unlink"] input[name="season"]')).toHaveCount(0);
			await expect(unlinkButton).toHaveText('UNLINK');
			await unlinkButton.click();
			await expect(unlinkButton).toHaveCount(0);
			const after = seasonRowsOf(show);
			expect(after.links).toEqual([]);
			// The decision is the season's own, for each part it had -- never season 0's.
			expect(after.decisions).toEqual([
				{ season: 1, part: 1, decision: 'unlinked' },
				{ season: 1, part: 2, decision: 'unlinked' }
			]);
		} finally {
			relinkTwoParts(show);
		}
	});
	test('a season settled without a link says which decision settled it (c240)', async ({
		page
	}) => {
		// What UNLINK and NONE OF THESE leave on season 2: no row, and a decision.
		// Season 2's own rows are put back as they were, whichever case ran first.
		const db = new Database(dbPath);
		const kept = db
			.prepare(`SELECT * FROM series_season_links WHERE series_id = ? AND season = 2`)
			.all(ids.sao) as Record<string, unknown>[];
		const decide = (decision: 'unlinked' | 'none') => {
			db.prepare(`DELETE FROM series_season_links WHERE series_id = ? AND season = 2`).run(ids.sao);
			db.prepare(
				`INSERT OR REPLACE INTO season_link_decisions (series_id, season, part, decision, at)
				VALUES (?, 2, 1, ?, ?)`
			).run(ids.sao, decision, Date.UTC(2026, 10, 3));
		};
		try {
			const line = () => listLine(page, 's2').locator('.m');
			// UNLINK is not NONE OF THESE: the owner never dismissed a search.
			decide('unlinked');
			await page.goto(`${BASE}/series/${ids.sao}`);
			await expect(line()).toHaveText('UNLINKED · NO PASS ASKS AGAIN');
			decide('none');
			await page.reload();
			await expect(line()).toHaveText('NONE OF THESE · NO PASS ASKS AGAIN');
		} finally {
			db.prepare(`DELETE FROM season_link_decisions WHERE series_id = ? AND season = 2`).run(
				ids.sao
			);
			for (const row of kept) {
				const cols = Object.keys(row);
				db.prepare(
					`INSERT OR REPLACE INTO series_season_links (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
				).run(...cols.map((c) => row[c]));
			}
			db.close();
		}
	});
	test('the review with no season asked opens on the open season, never season 0 (c240)', async ({
		page
	}) => {
		// A list holding a flat, unseasoned part (season 0, a real season) and
		// then season 1. Season 0 is watched, so the open season is 1: an absent
		// `&season=` is that one, not `Number(null)`'s 0.
		const id = seedFlatThenNumbered();
		await page.goto(`${BASE}/links?series=${id}`);
		await expect(page.locator('.heading .long')).toHaveText('LINK · SEASON 1');
		await expect(page.locator('.seasonbar .sb-b')).toHaveText('SEASON 1 OF 2 · 3 EPISODES HERE');
		// Asked for, season 0 is still there to link.
		await page.goto(`${BASE}/links?series=${id}&season=0`);
		await expect(page.locator('.seasonbar .sb-b')).toContainText('2 EPISODES HERE');
	});

	test('LINK on a flat-list anime names no season 0, writes season 0’s row and goes back to the series (c423)', async ({
		page
	}) => {
		// The owner's Ranma ½ (2024): twelve episodes the source gave no season,
		// relinked from the series screen's CHANGE, which opens the review with
		// no `&season=`. Its one season is numbered 0, and is real.
		const id = seedFlatList();
		try {
			await page.goto(`${BASE}/series/${id}`);
			// One ANILIST line, never S0 or SEASON 0 (c423's series-screen half, c424's state 12).
			await expect(page.locator('[data-row="lists"] .tag')).toHaveText(['ANILIST']);
			await expect(page.locator('[data-row="lists"]')).not.toContainText(/SEASON 0|\bS0\b/);
			await listLine(page, 'anilist').getByRole('link', { name: 'FIND' }).click();
			await page.waitForURL(new RegExp(`/links\\?series=${id}$`));
			// The header names no season: no `LINK · SEASON 0`, no `S0`, and the bar
			// says what the list holds without a season number.
			await expect(page.locator('.heading .long')).toHaveText('SERIES TO LINK');
			await expect(page.locator('.heading .short')).toHaveText('TO LINK');
			await expect(page.locator('.seasonbar .sb-b')).toHaveText('12 EPISODES HERE');
			await expect(page.locator('.seasonbar .sb-c')).toHaveText('ASKED AS FLAT LIST SHOW');
			// FIND's own search, as AniList answers it: the show and both sequels.
			await expect(page.locator('.cand')).toHaveCount(3);
			const show = page.locator('.cand', {
				has: page.locator('.ctitle', { hasText: /^Flat List Show$/ })
			});
			await show.click();
			const link = page.locator('.actions button').last();
			await expect(link).toHaveText(/^LINK [A-D]$/);
			await expect(page.getByText(/SEASON 0|\bS0\b/)).toHaveCount(0);
			const posted = page.waitForRequest(
				(r) => r.url().endsWith('/api/links') && r.method() === 'POST' && !!r.postDataJSON()?.link
			);
			// Pressed at once: nothing on the page is waited for first.
			await link.click();
			expect((await posted).postDataJSON()).toMatchObject({
				series: id,
				link: 9301,
				season: 0,
				part: 1
			});
			// The LINK worked, and the page says so by going back to the series, where
			// the LINK row shows it: no rest of the show to stay for.
			await page.waitForURL(new RegExp(`/series/${id}$`));
			const line = listLine(page, 'anilist');
			await expect(line.locator('.t')).toHaveText('Flat List Show');
			await expect(line.locator('.m')).toContainText('MAL 9401');
			// The series screen names no season 0 either, on the row or in the sheet
			// EDIT opens (c423's series-screen half).
			await expect(page.locator('[data-row="lists"] .tag')).toHaveText(['ANILIST']);
			await line.getByRole('button', { name: 'EDIT' }).click();
			const sheet = page.getByRole('dialog', { name: 'Tracking' });
			await expect(sheet.locator('.ent .m')).toContainText('ANILIST 9301');
			await expect(sheet.locator('.tabs')).toHaveCount(0);
			await expect(page.getByRole('region', { name: 'About this series' })).not.toContainText(
				/SEASON 0|\bS0\b/
			);
			await expect(sheet).not.toContainText(/SEASON 0|\bS0\b/);
			// Season 0's own row, the whole show's, and its mirror.
			expect(seasonLinksOf(id)).toEqual([{ season: 0, anilist_id: 9301, via: 'review' }]);
			expect(mirrorOf(id)).toMatchObject({ anilist_id: 9301, mal_id: 9401 });
		} finally {
			forgetFlatList(id);
		}
	});

	test('a split season is one season on the relations: its count, its button, and LINK lands (c418, round 2)', async ({
		page
	}) => {
		// Two seasons here, the second 23 episodes; AniList has it as 12 + 11. The
		// relations from season 1 tick both parts, and they are one season.
		const id = seedSeasons('Split Pair Show', [12, 23]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9501');
			const link = page.locator('.actions button').last();
			await expect(link).toHaveText(/^LINK [A-Z] TO SEASON 1$/);
			await link.click();
			// The relations walk is two paced AniList requests: seconds, not one.
			const offered = page.locator('.rel:not(.outside) .relbtn');
			await expect(offered.locator('.rno')).toHaveText(['S2', 'PART 2'], { timeout: 20_000 });
			await expect(page.locator('.rels .ch div').nth(1)).toHaveText('1 OF 1 TICKED');
			await expect(page.locator('.relacts button').last()).toHaveText('LINK 1 SEASON');
			// Pressed at once, and back on the series with both parts written.
			await page.locator('.relacts button').last().click();
			await page.waitForURL(new RegExp(`/series/${id}$`));
			await expect(page.locator('[data-row="lists"] .t')).toHaveText([
				'Split Show',
				'Split Show 2nd Season'
			]);
			expect(partsOf(id)).toEqual([
				{ season: 1, part: 1, anilist_id: 9501 },
				{ season: 2, part: 1, anilist_id: 9502 },
				{ season: 2, part: 2, anilist_id: 9503 }
			]);
		} finally {
			forgetFlatList(id);
		}
	});

	test('a split season chained part 1 → part 2, AniList’s usual shape, is one season too (c464)', async ({
		page
	}) => {
		const id = seedSeasons('Chain Split Pair Show', [12, 23, 12]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9701');
			const link = page.locator('.actions button').last();
			await expect(link).toHaveText(/^LINK [A-Z] TO SEASON 1$/);
			await link.click();
			// Three paced requests: part 2 took no step, so it is asked once more.
			const offered = page.locator('.rel:not(.outside) .relbtn');
			await expect(offered.locator('.rno')).toHaveText(['S2', 'PART 2', 'S3'], { timeout: 30_000 });
			await expect(page.locator('.rels .ch div').nth(1)).toHaveText('2 OF 2 TICKED');
			await expect(page.locator('.relacts button').last()).toHaveText('LINK 2 SEASONS');
			await page.locator('.relacts button').last().click();
			await page.waitForURL(new RegExp(`/series/${id}$`));
			expect(partsOf(id)).toEqual([
				{ season: 1, part: 1, anilist_id: 9701 },
				{ season: 2, part: 1, anilist_id: 9702 },
				{ season: 2, part: 2, anilist_id: 9703 },
				{ season: 3, part: 1, anilist_id: 9704 }
			]);
		} finally {
			forgetFlatList(id);
		}
	});

	test('LINK N SEASONS counts a pair as one and names the season it refused (c418, round 2)', async ({
		page
	}) => {
		// Four seasons: 12, 23 (AniList's 12 + 11), 12, and a fourth of 10 the
		// chain does not reach. Season 1 linked offers the pair and season 3.
		const id = seedSeasons('Split Four Show', [12, 23, 12, 10]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9501');
			await expect(page.locator('.actions button').last()).toHaveText(/^LINK [A-Z] TO SEASON 1$/);
			await page.locator('.actions button').last().click();
			const offered = page.locator('.rel:not(.outside) .relbtn');
			await expect(offered.locator('.rno')).toHaveText(['S2', 'PART 2', 'S3'], { timeout: 20_000 });
			const count = page.locator('.rels .ch div').nth(1);
			const go = page.locator('.relacts button').last();
			await expect(count).toHaveText('2 OF 2 TICKED');
			await expect(go).toHaveText('LINK 2 SEASONS');
			// Untick and retick season 3: the same state reads the same both ways.
			await offered.filter({ has: page.locator('.rno', { hasText: 'S3' }) }).click();
			await expect(count).toHaveText('1 OF 2 TICKED');
			await expect(go).toHaveText('LINK 1 SEASON');
			await offered.filter({ has: page.locator('.rno', { hasText: 'S3' }) }).click();
			await expect(count).toHaveText('2 OF 2 TICKED');
			await expect(go).toHaveText('LINK 2 SEASONS');
			// Meanwhile, in a second tab, season 4 is given season 3's entry by a
			// pasted link: the app's own door, not a row written here.
			const other = await page.context().newPage();
			try {
				await other.goto(`${BASE}/links?series=${id}&season=4`);
				await other.getByRole('button', { name: 'PASTE A LINK' }).first().click();
				await other.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9504');
				await expect(other.locator('.actions button').last()).toHaveText(
					/^LINK [A-Z] TO SEASON 4$/
				);
				await other.locator('.actions button').last().click();
				await expect.poll(() => partsOf(id).map((l) => l.season)).toEqual([1, 4]);
			} finally {
				await other.close();
			}
			// LINK 2 SEASONS: the pair is written, season 3 refused. The band counts
			// seasons (the pair is one), and names the one refused and why.
			await go.click();
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 1 OF 2 SEASONS · SPLIT FOUR SHOW'
			);
			await expect(page.locator('.band .line').nth(1)).toHaveText(
				'SEASON 3 NOT LINKED · SEASON 4 HOLDS ITS ENTRY'
			);
			expect(partsOf(id)).toEqual([
				{ season: 1, part: 1, anilist_id: 9501 },
				{ season: 2, part: 1, anilist_id: 9502 },
				{ season: 2, part: 2, anilist_id: 9503 },
				{ season: 4, part: 1, anilist_id: 9504 }
			]);
		} finally {
			forgetFlatList(id);
		}
	});

	for (const [what, entry, season] of [
		['no chain edge into the show’s seasons', 9601, 1],
		['relations AniList fails to answer', 9602, 2]
	] as const)
		test(`a season LINK with ${what} goes back to the series (c423, round 2)`, async ({ page }) => {
			const id = seedSeasons(`Lone Show ${season}`, [12, 12]);
			try {
				await page.goto(`${BASE}/links?series=${id}&season=${season}`);
				await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
				await page.getByLabel('AniList or MAL link').fill(`https://anilist.co/anime/${entry}`);
				const link = page.locator('.actions button').last();
				await expect(link).toHaveText(new RegExp(`^LINK [A-Z] TO SEASON ${season}$`));
				// Pressed at once: the answer has no rest of the show to stay for.
				await link.click();
				await page.waitForURL(new RegExp(`/series/${id}$`));
				const line = listLine(page, `s${season}`);
				await expect(line.locator('.t')).toHaveText(
					entry === 9601 ? 'Lone Show' : 'Lone Show Again'
				);
				expect(partsOf(id)).toEqual([{ season, part: 1, anilist_id: entry }]);
			} finally {
				forgetFlatList(id);
			}
		});

	test('NOT NOW on the rest of the show goes back to the series, the season linked (c423, round 2)', async ({
		page
	}) => {
		const id = seedSeasons('Split Pair Not Now', [12, 23]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9501');
			await expect(page.locator('.actions button').last()).toHaveText(/^LINK [A-Z] TO SEASON 1$/);
			await page.locator('.actions button').last().click();
			await page.getByRole('button', { name: 'NOT NOW' }).click({ timeout: 20_000 });
			await page.waitForURL(new RegExp(`/series/${id}$`));
			await expect(listLine(page, 's1').locator('.t')).toHaveText('Split Show');
			expect(partsOf(id)).toEqual([{ season: 1, part: 1, anilist_id: 9501 }]);
		} finally {
			forgetFlatList(id);
		}
	});

	test('NOT NOW on an offer EDIT opened stays, and the season can still be relinked (round 3)', async ({
		page
	}) => {
		const id = seedSeasons('Edit Not Now Show', [12, 23]);
		try {
			// Season 1 linked through the page's own door; NOT NOW after that
			// LINK goes back to the series, as before.
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9501');
			await expect(page.locator('.actions button').last()).toHaveText(/^LINK [A-Z] TO SEASON 1$/);
			await page.locator('.actions button').last().click();
			await page.getByRole('button', { name: 'NOT NOW' }).click({ timeout: 20_000 });
			await page.waitForURL(new RegExp(`/series/${id}$`));
			expect(partsOf(id)).toEqual([{ season: 1, part: 1, anilist_id: 9501 }]);

			// CHANGE on the linked season (EDIT's sheet, c424): its URL. The offer comes with the load.
			const edit = `${BASE}/links?series=${id}&season=1`;
			await page.goto(edit);
			await expect(page.getByRole('button', { name: 'NOT NOW' })).toBeVisible();
			await page.getByRole('button', { name: 'NOT NOW' }).click();
			// It follows no decision made here: the page stays, with the season's
			// tools. Leaving would start at once, so a few seconds without it is
			// the answer; checked before it, the old page would still read right.
			await expect(page.waitForURL(/\/series\/\d+$/, { timeout: 4_000 })).rejects.toThrow();
			await expect(page.getByRole('button', { name: 'PASTE A LINK' }).first()).toBeVisible();
			await expect(page.getByRole('button', { name: 'UNLINK' })).toBeVisible();
			expect(page.url()).toBe(edit);

			// And the season relinks from there: another entry, pasted and linked.
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9601');
			const link = page.locator('.actions button').last();
			await expect(link).toHaveText('LINK A TO SEASON 1');
			await link.click();
			await expect.poll(() => partsOf(id)).toEqual([{ season: 1, part: 1, anilist_id: 9601 }]);
		} finally {
			forgetFlatList(id);
		}
	});

	test('the queue holds an anime a season at a time, each with its own search, and names the season (c240, c352)', async ({
		page
	}) => {
		// What the pass leaves after searching both seasons: each season's own
		// search and candidates, and nothing at series level (wave 17). The
		// owner links season 1 from the queue; season 2's item must then be its
		// own search, never season 1's entry.
		const id = seedQueuedSecondSeason();
		/** SKIP until the show's item for this season is first, each SKIP waiting for the page to turn. */
		const toItem = async (season: number) => {
			for (let i = 0; i < 8; i++) {
				const shown = `${await page.locator('.title').textContent()}|${await page.locator('.heading .long').textContent()}`;
				if (shown === `Queued Second Season|LINK · SEASON ${season}`) return;
				await page.getByRole('button', { name: 'SKIP' }).click();
				await expect
					.poll(
						async () =>
							`${await page.locator('.title').textContent()}|${await page.locator('.heading .long').textContent()}`
					)
					.not.toBe(shown);
			}
		};
		const link = async (season: number, anilistId: number, band: string) => {
			await page.locator('.cand').first().click();
			// The button says which season the LINK writes (the low of wave 15's round 2).
			await expect(page.locator('.actions button').last()).toHaveText(`LINK A TO SEASON ${season}`);
			const posted = page.waitForRequest(
				(r) => r.url().endsWith('/api/links') && r.method() === 'POST'
			);
			await page.locator('.actions button').last().click();
			expect((await posted).postDataJSON()).toMatchObject({
				series: id,
				link: anilistId,
				season,
				part: 1
			});
			// And so does the band its UNDO lives in.
			await expect(page.locator('.band .line').first()).toHaveText(band);
		};
		try {
			await page.goto(`${BASE}/links`);
			// Before season 1 is linked, season 2's item lists both entries: the
			// rule below is about a held entry, not a missing one.
			await toItem(2);
			await expect(page.locator('.cand')).toHaveCount(2);
			await toItem(1);
			await expect(page.locator('.heading .long')).toHaveText('LINK · SEASON 1');
			await expect(page.locator('.cand')).toHaveCount(1);
			await expect(page.locator('.cand')).toContainText('9201');
			await link(1, 9201, 'LINKED · SEASON 1 · QUEUED SECOND SEASON');
			expect(seasonLinksOf(id)).toEqual([{ season: 1, anilist_id: 9201, via: 'review' }]);

			// The queue as the workstation now draws it: season 2's own search only.
			await page.goto(`${BASE}/links`);
			await toItem(2);
			await expect(page.locator('.heading .long')).toHaveText('LINK · SEASON 2');
			await expect(page.locator('.cand')).toHaveCount(1);
			await expect(page.locator('.cand')).toContainText('9202');
			await expect(page.locator('.cand')).not.toContainText('9201');
			// Nor does LINK take it for season 2, whatever the page posts (wave 17, round 2).
			const refused = await page.request.post(`${BASE}/api/links`, {
				data: { series: id, link: 9201, season: 2, part: 1 }
			});
			expect(refused.status()).toBe(409);
			expect(seasonLinksOf(id)).toEqual([{ season: 1, anilist_id: 9201, via: 'review' }]);
			// FIND with no season named opens where the queue does: season 1 is the
			// open season (nothing watched) but linked, so season 2.
			await link(2, 9202, 'LINKED · SEASON 2 · QUEUED SECOND SEASON II');
			expect(seasonLinksOf(id)).toEqual([
				{ season: 1, anilist_id: 9201, via: 'review' },
				{ season: 2, anilist_id: 9202, via: 'review' }
			]);
			// UNDO takes back the season the band named, and no other.
			await page.getByRole('button', { name: 'UNDO' }).click();
			await expect
				.poll(() => seasonLinksOf(id))
				.toEqual([{ season: 1, anilist_id: 9201, via: 'review' }]);
			await page.goto(`${BASE}/links?series=${id}`);
			await expect(page.locator('.heading .long')).toHaveText('LINK · SEASON 2');
		} finally {
			unlinkQueuedSecondSeason(id);
		}
	});
});

/**
 * A two-season anime the pass searched in one go: each season's own search
 * and candidates, exactly what `searchSeries` writes (`saveSeasonSearch`)
 * while no season is linked, season 2's listing season 1's entry after its
 * own; and no series-level row, which the pass never writes for an anime
 * (wave 17).
 */
let queuedSecond: number | null = null;
function seedQueuedSecondSeason(): number {
	if (queuedSecond !== null) return queuedSecond;
	const db = new Database(dbPath);
	try {
		const now = Date.UTC(2026, 10, 2, 12, 0);
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
					VALUES (?, 'Queued Second Season', 'anime', 'aniyomi', 210, ?, ?, 'aniyomi:1:/queued-second', 1, '')`
				)
				.run(root, now, now).lastInsertRowid
		);
		const put = db.prepare(
			`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, 0, ?)`
		);
		let position = 0;
		for (const season of [1, 2])
			for (let i = 1; i <= 3; i++) {
				position += 1;
				put.run(id, position, `Episode ${i}`, season, i, now, `/queued/${season}/${i}`);
			}
		const candidate = (anilistId: number, title: string) =>
			JSON.stringify({
				anilistId,
				malId: null,
				title,
				alts: [],
				format: 'TV',
				country: 'JP',
				year: 2020,
				chapters: null,
				volumes: null,
				episodes: 3,
				season: 'FALL',
				seasonYear: 2020,
				status: 'FINISHED',
				coverUrl: ''
			});
		// Season 2's search lists season 1's entry too, after its own, as
		// AniList's answer for "… Season 2" does: both seasons were searched in
		// one pass while neither was linked, so nobody held 9201 to leave out.
		const s1: [number, string] = [9201, 'Queued Second Season'];
		const s2: [number, string] = [9202, 'Queued Second Season II'];
		for (const [season, query, hits] of [
			[1, 'Queued Second Season', [s1]],
			[2, 'Queued Second Season Season 2', [s2, s1]]
		] as const) {
			db.prepare(
				`INSERT INTO season_link_searches (series_id, season, part, query, searched_at, found)
				VALUES (?, ?, 1, ?, ?, ?)`
			).run(id, season, query, now, hits.length);
			hits.forEach(([anilistId, title], rank) =>
				db
					.prepare(
						`INSERT INTO season_link_candidates (series_id, season, part, anilist_id, rank, data)
						VALUES (?, ?, 1, ?, ?, ?)`
					)
					.run(id, season, anilistId, rank, candidate(anilistId, title))
			);
		}
		return (queuedSecond = id);
	} finally {
		db.close();
	}
}

/** Put the queued show back as seeded: both seasons open and searched, nothing skipped. */
function unlinkQueuedSecondSeason(id: number): void {
	const db = new Database(dbPath);
	try {
		db.prepare(`DELETE FROM series_season_links WHERE series_id = ?`).run(id);
		db.prepare(`DELETE FROM season_link_decisions WHERE series_id = ?`).run(id);
		db.prepare(`UPDATE season_link_searches SET skipped_at = NULL WHERE series_id = ?`).run(id);
		// LINK asks the relations, which a catalogue that answers keeps as candidates.
		db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(id);
	} finally {
		db.close();
	}
}

function seasonLinksOf(id: number): { season: number; anilist_id: number; via: string }[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare(
				`SELECT season, anilist_id, via FROM series_season_links WHERE series_id = ? ORDER BY season`
			)
			.all(id) as { season: number; anilist_id: number; via: string }[];
	} finally {
		db.close();
	}
}

/** A flat list: twelve episodes with no season, one season to tsundoku, numbered 0 (c423). */
let flatList: number | null = null;
function seedFlatList(): number {
	if (flatList !== null) return flatList;
	const db = new Database(dbPath);
	try {
		const now = Date.UTC(2026, 10, 2, 12, 0);
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
					VALUES (?, 'Flat List Show', 'anime', 'aniyomi', 210, ?, ?, 'aniyomi:1:/flat-list-show', 1, '')`
				)
				.run(root, now, now).lastInsertRowid
		);
		const put = db.prepare(
			`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, ?, ?, NULL, ?, ?, '', 0, 0, 0, ?)`
		);
		for (let i = 1; i <= 12; i++) put.run(id, i, `Episode ${i}`, i, now, `/flat-list/${i}`);
		return (flatList = id);
	} finally {
		db.close();
	}
}

/** A show in numbered seasons of these counts, once a run (its origin key is unique). */
const seasonShows = new Map<string, number>();
function seedSeasons(title: string, counts: number[]): number {
	const known = seasonShows.get(title);
	if (known !== undefined) return known;
	const db = new Database(dbPath);
	try {
		const now = Date.UTC(2026, 10, 2, 12, 0);
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
					VALUES (?, ?, 'anime', 'aniyomi', 210, ?, ?, ?, 1, '')`
				)
				.run(root, title, now, now, `aniyomi:1:/${title.toLowerCase().replace(/\W+/g, '-')}`)
				.lastInsertRowid
		);
		const put = db.prepare(
			`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, 0, ?)`
		);
		let position = 0;
		counts.forEach((count, i) => {
			for (let e = 1; e <= count; e++) {
				position += 1;
				put.run(id, position, `Episode ${e}`, i + 1, e, now, `/${id}/${i + 1}/${e}`);
			}
		});
		seasonShows.set(title, id);
		return id;
	} finally {
		db.close();
	}
}

/** A season's link, with its part. */
function partsOf(id: number): { season: number; part: number; anilist_id: number }[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare(
				`SELECT season, part, anilist_id FROM series_season_links WHERE series_id = ? ORDER BY season, part`
			)
			.all(id) as { season: number; part: number; anilist_id: number }[];
	} finally {
		db.close();
	}
}

/** Put the flat list back as seeded: never searched, never linked, out of the queue. */
function forgetFlatList(id: number): void {
	const db = new Database(dbPath);
	try {
		for (const table of [
			'series_season_links',
			'season_link_decisions',
			'season_link_searches',
			'season_link_candidates',
			'series_links'
		])
			db.prepare(`DELETE FROM ${table} WHERE series_id = ?`).run(id);
	} finally {
		db.close();
	}
}

/** A series' `series_links` row: an anime's mirror of its first season. */
function mirrorOf(id: number): Record<string, unknown> | undefined {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare(`SELECT anilist_id, mal_id, via FROM series_links WHERE series_id = ?`)
			.get(id) as Record<string, unknown> | undefined;
	} finally {
		db.close();
	}
}

/** An anime whose list is two watched unseasoned episodes, then a season 1 of three. */
let flatThenNumbered: number | null = null;
function seedFlatThenNumbered(): number {
	// Once a run: its origin key is unique, and a retry must not insert it again.
	if (flatThenNumbered !== null) return flatThenNumbered;
	const db = new Database(dbPath);
	try {
		const now = Date.UTC(2026, 10, 2, 12, 0);
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
					VALUES (?, 'Flat Then Numbered', 'anime', 'aniyomi', 210, ?, ?, 'aniyomi:1:/flat-then-numbered', 1, '')`
				)
				.run(root, now, now).lastInsertRowid
		);
		const put = db.prepare(
			`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url, read_at)
			VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, 0, ?, ?)`
		);
		put.run(id, 1, 'Episode 1', null, 1, now, '/flat/1', now);
		put.run(id, 2, 'Episode 2', null, 2, now, '/flat/2', now);
		for (let i = 1; i <= 3; i++)
			put.run(id, 2 + i, `Episode ${i}`, 1, i, now, `/flat/s1/${i}`, null);
		return (flatThenNumbered = id);
	} finally {
		db.close();
	}
}

/** A series' season links and season decisions, as the server left them. */
function seasonRowsOf(id: number): {
	links: { season: number; part: number }[];
	decisions: { season: number; part: number; decision: string }[];
} {
	const db = new Database(dbPath, { readonly: true });
	try {
		return {
			links: db
				.prepare(
					`SELECT season, part FROM series_season_links WHERE series_id = ? ORDER BY season, part`
				)
				.all(id) as { season: number; part: number }[],
			decisions: db
				.prepare(
					`SELECT season, part, decision FROM season_link_decisions WHERE series_id = ? ORDER BY season, part`
				)
				.all(id) as { season: number; part: number; decision: string }[]
		};
	} finally {
		db.close();
	}
}

/** Put the two-part show's links back as `seedTwoParts` wrote them, and forget the UNLINK. */
function relinkTwoParts(id: number): void {
	const db = new Database(dbPath);
	try {
		const now = Date.UTC(2026, 10, 2, 12, 0);
		db.prepare(`DELETE FROM season_link_decisions WHERE series_id = ?`).run(id);
		const link = db.prepare(
			`INSERT OR REPLACE INTO series_season_links (series_id, season, part, anilist_id, via, title, linked_at, resolved_at, format, episodes)
			VALUES (?, 1, ?, ?, 'relations', ?, ?, ?, 'TV', ?)`
		);
		link.run(id, 1, 9901, 'Sword Art Online: Alicization', now, now, 12);
		link.run(id, 2, 9902, 'Sword Art Online: Alicization Part 2', now, now, 11);
	} finally {
		db.close();
	}
}

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

/** Season 2's part 2 holding season 1's entry, or no longer: the race c418's band is for. */
function holdSeasonOneEntry(on: boolean): void {
	const db = new Database(dbPath);
	try {
		if (on)
			db.prepare(
				`INSERT INTO series_season_links (series_id, season, part, anilist_id, mal_id, via, title, linked_at, resolved_at, format, episodes)
				VALUES (?, 2, 2, 9001, 7001, 'review', 'Sword Art Online', ?, ?, 'TV', 12)`
			).run(ids.sao, Date.UTC(2026, 10, 3), Date.UTC(2026, 10, 3));
		else
			db.prepare(
				`DELETE FROM series_season_links WHERE series_id = ? AND season = 2 AND part = 2`
			).run(ids.sao);
	} finally {
		db.close();
	}
}

/** Every AniList id kept as a candidate of any season of a series. */
function candidatesOf(id: number): number[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (
			db.prepare(`SELECT anilist_id FROM season_link_candidates WHERE series_id = ?`).all(id) as {
				anilist_id: number;
			}[]
		).map((r) => r.anilist_id);
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
