import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { doubleTap } from './helpers/touch';

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
/** One line of the series screen's LISTS row: `anilist`, `ranobe`, or `s2` on an anime. */
const listLine = (page: import('@playwright/test').Page, key: string) =>
	page.locator(`[data-row="lists"] [data-line="${key}"]`);

const NO_ANSWER = 'THE WORKSTATION DID NOT ANSWER · NOTHING CHANGED';
const alertLine = (page: import('@playwright/test').Page) =>
	page.locator('.band[role="alert"] .line');
const undoButton = (page: import('@playwright/test').Page) =>
	page.getByRole('button', { name: 'UNDO' });
/** Every POST to the review's door that `when` picks gets no answer, as off the network. */
async function abortPosts(
	page: import('@playwright/test').Page,
	when: (body: Record<string, unknown>) => boolean
) {
	await page.route('**/api/links', (route) =>
		when((route.request().postDataJSON() ?? {}) as Record<string, unknown>)
			? route.abort()
			: route.continue()
	);
}

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

test('a double tap on SEARCH AGAIN opens the form and searches nothing', async ({ page }) => {
	// Every decision the page posts, so a search nobody typed is seen even when
	// the band would not show it.
	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/links')
			posts.push(r.postData() ?? '');
	});
	await page.goto('/links');
	// Nothing found puts SEARCH AGAIN among the actions, where the form's
	// SEARCH once took its place under the finger.
	if ((await page.locator('.title').textContent()) !== 'Yofukashi no Uta')
		await page.getByRole('button', { name: 'SKIP' }).click();
	await expect(page.locator('.title')).toHaveText('Yofukashi no Uta');
	posts.length = 0;
	const again = page.locator('.actions button', { hasText: 'SEARCH AGAIN' });
	const box = (await again.boundingBox())!;
	// A thumb's double tap, at once, on a page that has not settled anything.
	await doubleTap(page, box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.getByLabel('Title to search on AniList')).toBeVisible();
	// The search waits for the form's own SEARCH: give a stray one time to go out.
	await page.waitForTimeout(1000);
	expect(posts.filter((p) => p.includes('"search"'))).toEqual([]);
	await expect(page.locator('.cand')).toHaveCount(0);
	// A press while it is open only puts the caret back in the field.
	await page.getByLabel('Title to search on AniList').blur();
	await again.click();
	await expect(page.getByLabel('Title to search on AniList')).toBeFocused();
	expect(posts).toEqual([]);
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

test('in the queue a failure keeps a band with something to take back, and draws alone otherwise', async ({
	page
}) => {
	await page.goto('/links');
	const title = page.locator('.title');
	const first = await title.textContent();
	// Nothing decided yet: the failure alone, as ever.
	await abortPosts(page, () => true);
	await page.getByRole('button', { name: 'SKIP' }).click();
	await expect(alertLine(page)).toHaveText(NO_ANSWER);
	await expect(page.locator('.band')).toHaveCount(1);
	await expect(undoButton(page)).toHaveCount(0);
	await expect(title).toHaveText(first!);
	await page.unroute('**/api/links');

	// SKIP's band has nothing to take back, so a failure still replaces it.
	await page.getByRole('button', { name: 'SKIP' }).click();
	await expect(title).not.toHaveText(first!);
	await expect(page.locator('.band[role="status"] .line').first()).toContainText('SKIPPED');
	const second = await title.textContent();
	await abortPosts(page, () => true);
	await page.getByRole('button', { name: 'SKIP' }).click();
	await expect(alertLine(page)).toHaveText(NO_ANSWER);
	await expect(page.locator('.band')).toHaveCount(1);
	await expect(undoButton(page)).toHaveCount(0);
	await expect(title).toHaveText(second!);
	await page.unroute('**/api/links');

	// A decision to take back: its UNDO unanswered, then pressed again.
	await page.goto('/links');
	if ((await title.textContent()) !== 'Return of the Mount Hua Sect') {
		await page.getByRole('button', { name: 'SKIP' }).click();
		await expect(title).toHaveText('Return of the Mount Hua Sect');
	}
	await page.getByRole('button', { name: 'NONE OF THESE' }).click();
	await expect(page.locator('.band .line').first()).toHaveText('NONE OF THESE · WON’T ASK AGAIN');
	await abortPosts(page, (body) => body.undo === 'none');
	await undoButton(page).click();
	await expect(alertLine(page)).toHaveText(NO_ANSWER);
	await expect(undoButton(page)).toBeVisible();
	await expect(page.locator('.band[role="status"] .line').first()).toHaveText(
		'NONE OF THESE · WON’T ASK AGAIN'
	);
	await expect(title).not.toHaveText('Return of the Mount Hua Sect');
	await page.unroute('**/api/links');
	await undoButton(page).click();
	await expect(title).toHaveText('Return of the Mount Hua Sect');
	await expect(alertLine(page)).toHaveCount(0);
	await expect(page.locator('.band')).toHaveCount(0);
});

test('the series screen: LISTS and COVER rows, and FIND opens its own review', async ({ page }) => {
	await page.goto('/');
	await page.locator('.tile', { hasText: 'The Greatest Estate Developer' }).first().click();
	await page.waitForURL(/\/series\/\d+/);
	// LINK's facts are AniList's line on LISTS now: the entry, MAL's id with it.
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
	// What the search found, never who ran it (the review band can't tell either).
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
	// A show the source names two seasons of, and AniList two entries. FIND
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
	// Beside SAO's chain, as AniList lists them: a special that is its
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
	// A flat list's show: the source gave its 12 episodes no season, so
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
	// A season AniList splits at an episode its relations do not show: 12
	// and 11 for the source's 23, with no edge between them and no part in the
	// second's title. Only a search finds the second, by `+ A SECOND PART`.
	entry({
		id: 9801,
		idMal: 9811,
		title: 'Hand Split Show 2nd Season',
		episodes: 12,
		seasonYear: 2020
	}),
	entry({
		id: 9802,
		idMal: 9812,
		title: 'Hand Split Show Final Chapter',
		episodes: 11,
		seasonYear: 2021
	}),
	// The same show in AniList's usual shape: part 2 chained off part 1.
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
	//. The walker pairs both shapes.
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
				// which the source's season number and the series' title give.
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
	// The relations: m0: Media(id: $i0) { … relations { edges { relationType node { … } } } }.
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
		// A show the source names two seasons of, for the per-season rows:
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
		// This hook seeds a database and spawns a stand-in catalogue and a
		// preview, then polls up to 60 s for it: all inside the default 30 s hook
		// budget, where `work-end-frame`'s same shape ran past 30 s in wave 20's
		// gate. Measured at 2 s here, at a load average of 20 with the
		// other slots at work; the house budget is 120 s so a loaded gate fails a
		// case, never the hook. In a hook, `test.setTimeout` sets the
		// hook's own budget (Playwright's test.d.ts).
		test.setTimeout(120_000);
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

	test('a season links on its own line, and the rest come from the relations', async ({ page }) => {
		// The source names two seasons of this show; AniList has an entry each.
		await page.goto(`${BASE}/series/${ids.sao}`);
		// A line a season on LISTS, each with its own search and its own FIND.
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
		// decision is its own. The bar goes once the workstation has taken
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
		// 2's. The manga S1 was adapted from is not listed at all.
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
		// what holds its entry, from the workstation's answer.
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
		// The page stays with its band and UNDO; ← is the way back.
		await expect(page.locator('.band .line').first()).toHaveText(
			'LINKED 1 SEASON · SWORD ART ONLINE'
		);
		await page.getByRole('link', { name: '← SERIES' }).click();
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
		// one does: in EDIT's ENTRY now, which the season's EDIT opens on it.
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
		// A pasted link is a door that offers a season an entry too:
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

	test('a sheet edit on a one-season anime in two parts goes to one part', async ({ page }) => {
		// One season, split 12 + 11 on its catalogues: the sheet has no tabs to
		// read the season and part from, so it must still name them.
		const show = seedTwoParts();
		try {
			await page.goto(`${BASE}/series/${show}`);
			// One season: one ANILIST line, and its EDIT opens the sheet on it.
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

	test('UNLINK on a one-season anime takes its link, every part of it', async ({ page }) => {
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
			// UNLINK lives in EDIT's ENTRY now; a one-season show's sheet has no tabs.
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
	test('a season settled without a link says which decision settled it', async ({ page }) => {
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
	test('the review with no season asked opens on the open season, never season 0', async ({
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

	test('LINK on a flat-list anime names no season 0, writes season 0’s row and goes back to the series', async ({
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
			// Season 0's own row, the whole show's, and nothing at series level.
			expect(seasonLinksOf(id)).toEqual([{ season: 0, anilist_id: 9301, via: 'review' }]);
			expect(seriesRowOf(id)).toBeUndefined();
		} finally {
			forgetFlatList(id);
		}
	});

	test('a split season is one season on the relations: its count, its button, and LINK lands', async ({
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
			// Pressed at once: the page stays with its band, and ← shows
			// both parts written on the series.
			await page.locator('.relacts button').last().click();
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 1 SEASON · SPLIT PAIR SHOW'
			);
			await page.getByRole('link', { name: '← SERIES' }).click();
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

	test('a split season chained part 1 → part 2, AniList’s usual shape, is one season too', async ({
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
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 2 SEASONS · CHAIN SPLIT PAIR SHOW'
			);
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

	/** A season 1 linked by a paste, and LINK 2 SEASONS pressed on what it offers. */
	async function linkTwoSeasons(page: import('@playwright/test').Page) {
		await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
		await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9701');
		await expect(page.locator('.actions button').last()).toHaveText(/^LINK [A-Z] TO SEASON 1$/);
		await page.locator('.actions button').last().click();
		const go = page.locator('.relacts button').last();
		await expect(go).toHaveText('LINK 2 SEASONS', { timeout: 30_000 });
		await go.click();
	}
	const ONLY_SEASON_1 = [{ season: 1, part: 1, anilist_id: 9701 }];
	const ALL_THREE = [
		...ONLY_SEASON_1,
		{ season: 2, part: 1, anilist_id: 9702 },
		{ season: 2, part: 2, anilist_id: 9703 },
		{ season: 3, part: 1, anilist_id: 9704 }
	];

	test('a full LINK N SEASONS from ?series= stays, and UNDO takes both back; a second LINK works; ← shows them unlinked', async ({
		page
	}) => {
		test.slow();
		const id = seedSeasons('Stay Pair Show', [12, 23, 12]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await linkTwoSeasons(page);
			const line = page.locator('.band .line');
			await expect(line.first()).toHaveText('LINKED 2 SEASONS · STAY PAIR SHOW');
			await expect(line.nth(1)).toHaveText('EACH SENDS ITS OWN EPISODES FROM THE NEXT ONE WATCHED');
			await expect(page).toHaveURL(new RegExp(`/links\\?series=${id}&season=1$`));
			expect(partsOf(id)).toEqual(ALL_THREE);
			// Under the band the season is drawn as it stands, not the review.
			await expect(
				page.locator('.rows .r').filter({ has: page.locator('.rl', { hasText: /^LINKED$/ }) })
			).toHaveText(/^LINKED\s*Chain Split Show · A NEW LINK REPLACES IT$/);

			// UNDO pressed again in both windows it stays on screen for: while its
			// post is out, and while the season is read back after it. Each request
			// is held, so the press lands inside the window whatever the box's speed.
			let undoPosts = 0;
			let letPost = () => {};
			const postHeld = new Promise<void>((go) => (letPost = go));
			await page.route('**/api/links', async (route) => {
				if ((route.request().postDataJSON() as { undo?: string })?.undo === 'seasons') {
					undoPosts++;
					await postHeld;
				}
				await route.continue();
			});
			let redraws = 0;
			let letRedraw = () => {};
			const redrawHeld = new Promise<void>((go) => (letRedraw = go));
			await page.route('**/links/season?*', async (route) => {
				redraws++;
				await redrawHeld;
				await route.continue();
			});
			const undo = page.getByRole('button', { name: 'UNDO' });
			await undo.click();
			await expect.poll(() => undoPosts).toBe(1);
			await undo.click();
			letPost();
			await expect.poll(() => redraws).toBe(1);
			await undo.click();
			letRedraw();
			await expect(page.locator('.band')).toHaveCount(0);
			expect(undoPosts).toBe(1);
			expect(partsOf(id)).toEqual(ONLY_SEASON_1);
			await page.unroute('**/api/links');
			await page.unroute('**/links/season?*');

			// A second LINK after the UNDO: the season's own, then the offer again.
			await linkTwoSeasons(page);
			await expect(line.first()).toHaveText('LINKED 2 SEASONS · STAY PAIR SHOW');
			expect(partsOf(id)).toEqual(ALL_THREE);
			// The read back unanswered: the UNDO still stands, and the page as drawn.
			await page.route('**/links/season?*', (route) => route.abort());
			await page.getByRole('button', { name: 'UNDO' }).click();
			await expect.poll(() => partsOf(id)).toEqual(ONLY_SEASON_1);
			await expect(page.locator('.band')).toHaveCount(0);
			await expect(
				page.locator('.rows .r').filter({ has: page.locator('.rl', { hasText: /^LINKED$/ }) })
			).toHaveText(/^LINKED\s*Chain Split Show · A NEW LINK REPLACES IT$/);
			await page.unroute('**/links/season?*');

			// The read back answered with a page, not JSON: /links/season is outside
			// /api/, so a lapsed session is a 303 to /login's HTML, and a 200 to fetch.
			await linkTwoSeasons(page);
			await expect(line.first()).toHaveText('LINKED 2 SEASONS · STAY PAIR SHOW');
			await page.route('**/links/season?*', (route) =>
				route.fulfill({ status: 200, contentType: 'text/html', body: '<html>' })
			);
			await page.getByRole('button', { name: 'UNDO' }).click();
			await expect.poll(() => partsOf(id)).toEqual(ONLY_SEASON_1);
			await expect(page.locator('.band')).toHaveCount(0);
			await page.unroute('**/links/season?*');
			// `busy` was let go: the next LINK N SEASONS and its UNDO both still work.
			await linkTwoSeasons(page);
			await expect(line.first()).toHaveText('LINKED 2 SEASONS · STAY PAIR SHOW');
			await page.getByRole('button', { name: 'UNDO' }).click();
			await expect.poll(() => partsOf(id)).toEqual(ONLY_SEASON_1);
			await expect(page.locator('.band')).toHaveCount(0);

			await page.getByRole('link', { name: '← SERIES' }).click();
			await page.waitForURL(new RegExp(`/series/${id}$`));
			// Season 1 keeps the link its own LINK made; the UNDO took the other two.
			await expect(page.locator('[data-row="lists"] .t')).toHaveText([
				'Chain Split Show',
				'Not linked',
				'Not linked'
			]);
		} finally {
			forgetFlatList(id);
		}
	});

	test('an UNDO that gets no answer keeps its band and UNDO, says so, and a second press takes both back', async ({
		page
	}) => {
		test.slow();
		const id = seedSeasons('Undo Retry Show', [12, 23, 12]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await linkTwoSeasons(page);
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 2 SEASONS · UNDO RETRY SHOW'
			);
			expect(partsOf(id)).toEqual(ALL_THREE);

			await abortPosts(page, (body) => body.undo === 'seasons');
			await undoButton(page).click();
			await expect(page.getByText(NO_ANSWER)).toBeVisible();
			await expect(undoButton(page)).toBeVisible();
			await expect(page.locator('.band[role="status"] .line').first()).toHaveText(
				'LINKED 2 SEASONS · UNDO RETRY SHOW'
			);
			expect(partsOf(id)).toEqual(ALL_THREE);
			await page.unroute('**/api/links');

			await undoButton(page).click();
			await expect.poll(() => partsOf(id)).toEqual(ONLY_SEASON_1);
			await expect(page.getByText(NO_ANSWER)).toHaveCount(0);
			await expect(page.locator('.band')).toHaveCount(0);

			await page.getByRole('link', { name: '← SERIES' }).click();
			await page.waitForURL(new RegExp(`/series/${id}$`));
			await expect(page.locator('[data-row="lists"] .t')).toHaveText([
				'Chain Split Show',
				'Not linked',
				'Not linked'
			]);
		} finally {
			forgetFlatList(id);
		}
	});

	/** One press of UNDO, and the workstation's answer to it. */
	async function pressUndo(page: import('@playwright/test').Page) {
		const answer = page.waitForResponse(
			(r) => r.url().endsWith('/api/links') && r.request().postDataJSON()?.undo === 'seasons'
		);
		await undoButton(page).click();
		return answer;
	}

	test('an UNDO refused because a part changed since says why, keeps its UNDO, and writes nothing on a second press', async ({
		page
	}) => {
		test.slow();
		const id = seedSeasons('Undo Refused Show', [12, 23, 12]);
		const relinked = [...ALL_THREE.slice(0, 3), { season: 3, part: 1, anilist_id: 9999 }];
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await linkTwoSeasons(page);
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 2 SEASONS · UNDO REFUSED SHOW'
			);
			// A second door changes one part the band's post wrote.
			const db = new Database(dbPath);
			try {
				db.prepare(
					`UPDATE series_season_links SET anilist_id = 9999 WHERE series_id = ? AND season = 3`
				).run(id);
			} finally {
				db.close();
			}
			const reason = 'LINKED OR DECIDED AGAIN SINCE · NOTHING UNDONE';
			for (let press = 1; press <= 2; press++) {
				expect((await pressUndo(page)).status(), `press ${press}`).toBe(409);
				await expect(alertLine(page), `press ${press}`).toHaveText(reason);
				await expect(undoButton(page), `press ${press}`).toBeVisible();
				expect(partsOf(id), `press ${press}`).toEqual(relinked);
			}
		} finally {
			forgetFlatList(id);
		}
	});

	test('an UNDO another tab already did says ALREADY UNDONE, and takes nothing back', async ({
		page
	}) => {
		test.slow();
		const id = seedSeasons('Undo Twice Show', [12, 23, 12]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			const linked = page.waitForResponse(
				(r) => r.url().endsWith('/api/links') && !!r.request().postDataJSON()?.seasons
			);
			await linkTwoSeasons(page);
			const { facts } = (await (await linked).json()) as { facts: unknown };
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 2 SEASONS · UNDO TWICE SHOW'
			);
			// The other tab's press: the same post, from the same band's facts.
			const other = await page.request.post(`${BASE}/api/links`, {
				data: { series: id, undo: 'seasons', facts }
			});
			expect(other.status()).toBe(200);
			expect(partsOf(id)).toEqual(ONLY_SEASON_1);

			for (let press = 1; press <= 2; press++) {
				expect((await pressUndo(page)).status(), `press ${press}`).toBe(409);
				await expect(alertLine(page), `press ${press}`).toHaveText(
					'ALREADY UNDONE · NOTHING UNDONE'
				);
				await expect(undoButton(page), `press ${press}`).toBeVisible();
				expect(partsOf(id), `press ${press}`).toEqual(ONLY_SEASON_1);
			}
		} finally {
			forgetFlatList(id);
		}
	});

	test('another decision failing under the band leaves the band and its UNDO, which still works', async ({
		page
	}) => {
		test.slow();
		const id = seedSeasons('Undo Beside Show', [12, 23, 12]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await linkTwoSeasons(page);
			const status = page.locator('.band[role="status"] .line').first();
			await expect(status).toHaveText('LINKED 2 SEASONS · UNDO BESIDE SHOW');

			// A LINK on the same page, its post unanswered.
			await abortPosts(page, (body) => body.link !== undefined);
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9801');
			const link = page.locator('.actions button').last();
			await expect(link).toHaveText(/^LINK [A-Z] TO SEASON 1$/);
			await link.click();
			await expect(alertLine(page)).toHaveText(NO_ANSWER);
			await expect(status).toHaveText('LINKED 2 SEASONS · UNDO BESIDE SHOW');
			await expect(undoButton(page)).toBeVisible();
			expect(partsOf(id)).toEqual(ALL_THREE);
			await page.getByRole('button', { name: 'CANCEL' }).click();
			await page.unroute('**/api/links');

			// UNLINK, the other door the page keeps open under the band.
			await abortPosts(page, (body) => body.unlink === true);
			await page.getByRole('button', { name: 'UNLINK' }).click();
			await expect(alertLine(page)).toHaveText(NO_ANSWER);
			await expect(status).toHaveText('LINKED 2 SEASONS · UNDO BESIDE SHOW');
			expect(partsOf(id)).toEqual(ALL_THREE);
			await page.unroute('**/api/links');

			// The UNDO is the band's, and the failure beside it was not about it.
			await undoButton(page).click();
			await expect.poll(() => partsOf(id)).toEqual(ONLY_SEASON_1);
			await expect(alertLine(page)).toHaveCount(0);
			await expect(page.locator('.band')).toHaveCount(0);
		} finally {
			forgetFlatList(id);
		}
	});

	test('the TO LINK count is right on the way back, after LINK N SEASONS and after its UNDO', async ({
		page
	}) => {
		test.slow();
		const id = seedSeasons('Stay Count Show', [12, 23, 12]);
		// What the pass leaves: seasons 2 and 3 searched, each with a candidate, so
		// both wait in the queue until LINK N SEASONS answers them.
		const db = new Database(dbPath);
		try {
			for (const season of [2, 3]) {
				db.prepare(
					`INSERT INTO season_link_searches (series_id, season, part, query, searched_at, found)
					VALUES (?, ?, 1, 'Stay Count Show', ?, 1)`
				).run(id, season, Date.UTC(2026, 10, 2, 12, 0));
				db.prepare(
					`INSERT INTO season_link_candidates (series_id, season, part, anilist_id, rank, data)
					VALUES (?, ?, 1, ?, 0, ?)`
				).run(
					id,
					season,
					9900 + season,
					JSON.stringify({
						anilistId: 9900 + season,
						malId: null,
						title: `Stay Count ${season}`,
						alts: [],
						format: 'TV',
						country: 'JP',
						year: 2020,
						chapters: null,
						volumes: null,
						episodes: 12,
						season: 'FALL',
						seasonYear: 2020,
						status: 'FINISHED',
						coverUrl: ''
					})
				);
			}
		} finally {
			db.close();
		}
		// The row is drawn only while something waits, so no row reads as 0.
		const badge = page.locator('a.with-n[href$="/links"] .n');
		const waiting = async () => ((await badge.count()) ? Number(await badge.textContent()) : 0);
		const back = async () => {
			await page.getByRole('link', { name: '← SERIES' }).click();
			await page.waitForURL(new RegExp(`/series/${id}$`));
		};
		try {
			await page.goto(`${BASE}/series/${id}`);
			const before = await waiting();
			expect(before).toBeGreaterThanOrEqual(2);

			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await linkTwoSeasons(page);
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 2 SEASONS · STAY COUNT SHOW'
			);
			await back();
			await expect.poll(waiting).toBe(before - 2);

			// And back again once the UNDO has put both seasons in the queue.
			forgetLinksOnly(id);
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await linkTwoSeasons(page);
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 2 SEASONS · STAY COUNT SHOW'
			);
			await page.getByRole('button', { name: 'UNDO' }).click();
			await expect.poll(() => partsOf(id)).toEqual(ONLY_SEASON_1);
			await expect(page.locator('.band')).toHaveCount(0);
			await back();
			await expect.poll(waiting).toBe(before);
		} finally {
			forgetFlatList(id);
		}
	});

	/** The season links alone: the searches stay, so the seasons are queued again. */
	function forgetLinksOnly(id: number) {
		const db = new Database(dbPath);
		try {
			db.prepare(`DELETE FROM series_season_links WHERE series_id = ?`).run(id);
			db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(id);
		} finally {
			db.close();
		}
	}

	test('/links/season answers as the page’s load does: never for what cannot be seen', async ({
		page
	}) => {
		const id = seedSeasons('Season Door Show', [12, 12]);
		const ask = (query: string) => page.request.get(`${BASE}/links/season?${query}`);
		const open = await ask(`series=${id}&season=2`);
		expect(open.status()).toBe(200);
		expect(await open.json()).toMatchObject({ season: { no: 2, of: 2 }, single: { linked: null } });
		// A season it does not have, no season at all, and a series that isn't one.
		expect((await ask(`series=${id}&season=9`)).status()).toBe(404);
		expect((await ask(`series=${id}`)).status()).toBe(404);
		expect((await ask('series=nope&season=1')).status()).toBe(404);
		// Hidden means hidden: with reveal off, the same 404 as a missing one.
		const db = new Database(dbPath);
		const hide = db.prepare(`UPDATE series SET hidden = ? WHERE id = ?`);
		try {
			hide.run(1, id);
			expect((await ask(`series=${id}&season=2`)).status()).toBe(404);
		} finally {
			hide.run(0, id);
			db.close();
		}
	});

	test('after a full LINK N SEASONS a reload keeps the links and drops the band, and ← shows them', async ({
		page
	}) => {
		test.slow();
		const id = seedSeasons('Stay Reload Show', [12, 23, 12]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await linkTwoSeasons(page);
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 2 SEASONS · STAY RELOAD SHOW'
			);
			await page.reload();
			await expect(page.getByRole('button', { name: 'UNDO' })).toHaveCount(0);
			await expect(
				page.locator('.rows .r').filter({ has: page.locator('.rl', { hasText: /^LINKED$/ }) })
			).toHaveText(/^LINKED\s*Chain Split Show · A NEW LINK REPLACES IT$/);
			expect(partsOf(id)).toEqual(ALL_THREE);
			await page.getByRole('link', { name: '← SERIES' }).click();
			await page.waitForURL(new RegExp(`/series/${id}$`));
			await expect(page.locator('[data-row="lists"] .t')).toHaveText([
				'Chain Split Show',
				'Chain Split Show 2nd Season',
				'Chain Split Show 3rd Season'
			]);
		} finally {
			forgetFlatList(id);
		}
	});

	test('UNDO of a LINK that took the season’s own other part redraws the season from the workstation', async ({
		page
	}) => {
		test.slow();
		// Season 2's 23 episodes, AniList's 12 + 11: linking part 1 offers part 2
		// on the same season (and season 1 from its PREQUEL), so the UNDO changes
		// the very season under the band.
		const id = seedSeasons('Own Part Show', [12, 23]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=2`);
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9502');
			await expect(page.locator('.actions button').last()).toHaveText(/^LINK [A-Z] TO SEASON 2$/);
			await page.locator('.actions button').last().click();
			const go = page.locator('.relacts button').last();
			await expect(go).toHaveText('LINK 2 SEASONS', { timeout: 30_000 });
			await go.click();
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 2 SEASONS · OWN PART SHOW'
			);
			expect(partsOf(id)).toEqual([
				{ season: 1, part: 1, anilist_id: 9501 },
				{ season: 2, part: 1, anilist_id: 9502 },
				{ season: 2, part: 2, anilist_id: 9503 }
			]);
			// While part 2 is linked there is no second part left to add.
			const addSecond = page.getByRole('link', { name: '+ A SECOND PART' });
			await expect(addSecond).toHaveCount(0);
			await page.getByRole('button', { name: 'UNDO' }).click();
			await expect.poll(() => partsOf(id)).toEqual([{ season: 2, part: 1, anilist_id: 9502 }]);
			// Part 2 is free again, and the page says so without a reload.
			await expect(addSecond).toBeVisible();
		} finally {
			forgetFlatList(id);
		}
	});

	test('LINK N SEASONS counts a pair as one and names the season it refused', async ({ page }) => {
		// A walk, a second tab and a LINK: past 30 s on a box loaded past 70
		// with four workers, at the base too (wave 24's notes), so three times it.
		test.slow();
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
			// The page stays, and under the band the season it is on is drawn as it
			// now stands: linked, with its entry and its UNLINK, not the untouched
			// review it opened on.
			const linkedRow = page
				.locator('.rows .r')
				.filter({ has: page.locator('.rl', { hasText: /^LINKED$/ }) });
			await expect(linkedRow).toHaveText(/^LINKED\s*Split Show · A NEW LINK REPLACES IT$/);
			await expect(page.getByRole('button', { name: 'UNLINK', exact: true })).toBeVisible();
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

	test('a split season with a part held elsewhere is refused whole, and says so once', async ({
		page
	}) => {
		// A walk, a second tab and a LINK: past 30 s on a box loaded past 70
		// with four workers, at the base too (wave 24's notes), so three times it.
		test.slow();
		// 12, 23 (AniList's 12 + 11), 12 and 11: season 1 linked offers the pair
		// and season 3. Season 4's 11 episodes take part 2's entry meanwhile.
		const id = seedSeasons('Split Held Show', [12, 23, 12, 11]);
		try {
			await page.goto(`${BASE}/links?series=${id}&season=1`);
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9501');
			await expect(page.locator('.actions button').last()).toHaveText(/^LINK [A-Z] TO SEASON 1$/);
			await page.locator('.actions button').last().click();
			const offered = page.locator('.rel:not(.outside) .relbtn');
			await expect(offered.locator('.rno')).toHaveText(['S2', 'PART 2', 'S3'], { timeout: 20_000 });
			const go = page.locator('.relacts button').last();
			await expect(go).toHaveText('LINK 2 SEASONS');
			// A second tab gives season 4 part 2's entry, by a pasted link.
			const other = await page.context().newPage();
			try {
				await other.goto(`${BASE}/links?series=${id}&season=4`);
				await other.getByRole('button', { name: 'PASTE A LINK' }).first().click();
				await other.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9503');
				await expect(other.locator('.actions button').last()).toHaveText(
					/^LINK [A-Z] TO SEASON 4$/
				);
				await other.locator('.actions button').last().click();
				await expect.poll(() => partsOf(id).map((l) => l.season)).toEqual([1, 4]);
			} finally {
				await other.close();
			}
			await go.click();
			// Season 3 is linked; season 2 is not, either part, and its why is said
			// once for the season, naming the part and what holds it.
			await expect(page.locator('.band .line').first()).toHaveText(
				'LINKED 1 OF 2 SEASONS · SPLIT HELD SHOW'
			);
			await expect(page.locator('.band .line').nth(1)).toHaveText(
				'SEASON 2 NOT LINKED · SEASON 4 HOLDS PART 2’S ENTRY'
			);
			// The band has an UNDO for the season it did write, and only
			// that one: season 1 and season 4 are not its post's.
			await expect(page.getByRole('button', { name: 'UNDO' })).toBeVisible();
			await page.getByRole('button', { name: 'UNDO' }).click();
			await expect
				.poll(() => partsOf(id))
				.toEqual([
					{ season: 1, part: 1, anilist_id: 9501 },
					{ season: 4, part: 1, anilist_id: 9503 }
				]);
		} finally {
			forgetFlatList(id);
		}
	});

	test('+ A SECOND PART links a season’s part 2 by hand, FROM EP. 13', async ({ page }) => {
		// A walk, a second tab and a LINK: past 30 s on a box loaded past 70
		// with four workers, at the base too (wave 24's notes), so three times it.
		test.slow();
		const id = seedSeasons('Hand Split Show', [12, 23]);
		try {
			// Season 2's part 1, by a pasted link: no relation offers anything, so
			// the LINK goes back to the series.
			await page.goto(`${BASE}/links?series=${id}&season=2`);
			await page.getByRole('button', { name: 'PASTE A LINK' }).first().click();
			await page.getByLabel('AniList or MAL link').fill('https://anilist.co/anime/9801');
			await expect(page.locator('.actions button').last()).toHaveText(/^LINK [A-Z] TO SEASON 2$/);
			await page.locator('.actions button').last().click();
			await page.waitForURL(new RegExp(`/series/${id}$`));
			// The season's page: linked, and the second part offered under it.
			await page.goto(`${BASE}/links?series=${id}&season=2`);
			const row = page
				.locator('.rows .r')
				.filter({ has: page.locator('.rl', { hasText: /^PART 2$/ }) });
			await expect(row).toHaveText(/^PART 2\s*AFTER PART 1’S 12 EPISODES · \+ A SECOND PART$/);
			await row.getByRole('link', { name: '+ A SECOND PART' }).click();
			await page.waitForURL(/&part=2$/);
			await expect(page.locator('.heading .long')).toHaveText('LINK · SEASON 2 · PART 2');
			await expect(page.locator('.seasonbar .sb-b')).toHaveText(
				'SEASON 2 OF 2 · 23 EPISODES HERE · PART 2 FROM EP. 13'
			);
			await expect(
				page.locator('.rows .r').filter({ has: page.locator('.rl', { hasText: /^PART 1$/ }) })
			).toHaveText(/^PART 1\s*Hand Split Show 2nd Season · EP\. 1 – 12$/);
			const from = page.getByLabel('Part 2 starts at the season’s episode');
			await expect(from).toHaveValue('13');
			// The same search, part 2's own, run as the page opens (a FIND on a
			// part never searched) and again by hand: part 1's entry is no
			// candidate of it, and each is checked against part 2's 11 episodes.
			await expect(page.locator('.band .line').first()).toHaveText(
				'SEARCHED · “Hand Split Show Season 2” · 1 FOUND'
			);
			await expect(page.locator('.cand').first()).toContainText('11 · THIS HAS 11');
			await page.getByRole('button', { name: 'SEARCH AGAIN' }).click();
			await page.getByLabel('Title to search on AniList').fill('Hand Split Show');
			await page.locator('form.field .go').click();
			await expect(page.locator('.cand')).toHaveCount(1);
			await expect(page.locator('.cand').first()).toContainText('Hand Split Show Final Chapter');
			await page.locator('.cand').first().click();
			const link = page.locator('.actions button').last();
			await expect(link).toHaveText('LINK A TO SEASON 2 PART 2');
			// Another start has nowhere to be kept: said, and LINK is dimmed.
			await from.fill('14');
			await expect(page.locator('.fromnote')).toHaveText(
				'PART 2 STARTS WHERE PART 1’S 12 EPISODES END · FROM EP. 13'
			);
			await expect(link).toHaveClass(/dim/);
			await expect(link).toBeDisabled();
			expect(partsOf(id)).toEqual([{ season: 2, part: 1, anilist_id: 9801 }]);
			await from.fill('13');
			await expect(page.locator('.fromnote')).toHaveText('PART 2’S EP. 1 IS THE SEASON’S EP. 13');
			await link.click();
			await page.waitForURL(new RegExp(`/series/${id}$`));
			expect(partsOf(id)).toEqual([
				{ season: 2, part: 1, anilist_id: 9801 },
				{ season: 2, part: 2, anilist_id: 9802 }
			]);
			// Linked: the season's page no longer offers a second part.
			await page.goto(`${BASE}/links?series=${id}&season=2`);
			await expect(page.locator('.heading .long')).toHaveText('LINK · SEASON 2');
			await expect(page.getByRole('link', { name: '+ A SECOND PART' })).toHaveCount(0);
		} finally {
			forgetFlatList(id);
		}
	});

	for (const [what, entry, season] of [
		['no chain edge into the show’s seasons', 9601, 1],
		['relations AniList fails to answer', 9602, 2]
	] as const)
		test(`a season LINK with ${what} goes back to the series`, async ({ page }) => {
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

	test('NOT NOW on the rest of the show goes back to the series, the season linked', async ({
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

	test('NOT NOW on an offer EDIT opened stays, and the season can still be relinked', async ({
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

			// CHANGE on the linked season (EDIT's sheet): its URL. The offer comes with the load.
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

	test('the queue holds an anime a season at a time, each with its own search, and names the season', async ({
		page
	}) => {
		// What the pass leaves after searching both seasons: each season's own
		// search and candidates, and nothing at series level. The
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
			// Nor does LINK take it for season 2, whatever the page posts.
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
 *.
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

/** A flat list: twelve episodes with no season, one season to tsundoku, numbered 0. */
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

/** A series' `series_links` row: an anime has none beside a season row. */
function seriesRowOf(id: number): Record<string, unknown> | undefined {
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
			db
				.prepare(`SELECT COUNT(*) AS n FROM series_season_links WHERE series_id = ?`)
				.get(ids.frieren) as {
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
			.prepare(
				`SELECT anilist_id, mal_id, via, format FROM series_season_links WHERE series_id = ?`
			)
			.get(ids.frieren) as Record<string, unknown> | undefined;
	} finally {
		db.close();
	}
}
