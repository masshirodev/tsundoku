import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * GROUP AS ONE SHOW end to end (c283, S2; doc/WORKS.md, "Per-season sources"):
 * the AS row's ONE SHOW default on an anime selection, the NAME without its
 * trailing "Season 2", SEASONS' numbering, MERGE, the band and its UNDO, and
 * that an ordinary anime with seasons never offers UNGROUP.
 *
 * Every case here merges series, which deletes all but the first, so it runs
 * on the works-flow arrangement (`tests/works-flow.e2e.ts`): a seeded database
 * of its own and a preview of the same build on a free port no other spec
 * sees. It runs once, in the `tablet-portrait` project, because its subject is
 * a flow, not a frame.
 */
test.describe.configure({ mode: 'serial', timeout: 60_000 });

const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-seasons-group-${process.pid}.sqlite`);
const wipe = () => {
	for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
};
let server: ChildProcess | null = null;

const SEASONS = ['Lantern Keeper', 'Lantern Keeper Season 2', 'Lantern Keeper Season 3'];
/** The longest real line (c283's row): a three-digit episode count and every one on disk. */
const LONG = ['Long Runner', 'Long Runner Season 2'];
/** One series that already holds two seasons of its own: never a season set. */
const ORDINARY = 'Two Seasons, One Series';

test.use({ baseURL: base });

test.beforeAll(async () => {
	test.setTimeout(120_000);
	wipe();
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	seedAnime();
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-seasons-group-empty-${process.pid}`),
			TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-seasons-group-home-${process.pid}`)
		},
		stdio: 'ignore'
	});
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			up = (await fetch(`${base}/`, { redirect: 'manual' })).status > 0;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	if (!up) throw new Error('the seasons flow preview never answered');
});

test.afterAll(() => {
	server?.kill();
	server = null;
	wipe();
});

/** The seed holds no anime, so the three seasons and the ordinary show are SQL. */
function seedAnime() {
	const db = new Database(dbPath);
	const root = (db.prepare(`SELECT id FROM roots ORDER BY id LIMIT 1`).get() as { id: number }).id;
	const now = Date.UTC(2026, 10, 9);
	// The source a row names (`engine_sources.name`, the SOURCE row's own write).
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle,
			installed_at, updated_at)
		VALUES ('e2e.aniyomi', 'Aniyomi', 'anime', 1, '1.0', 'aniyomi', 'e2e', ?, ?)`
	).run(now, now);
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url)
		VALUES ('7', 'e2e.aniyomi', 'KICKASSANIME', 'en', 'https://example.test')`
	).run();
	const show = (title: string, key: string, folder: string) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, status, source, path, origin_key,
						source_url, added_at, indexed_at, in_library, hue)
					VALUES (?, ?, 'anime', 'completed', 'Kakkoi', '', ?, ?, ?, ?, 1, 200)`
				)
				.run(root, title, key, `https://example.test/${key}`, now, now).lastInsertRowid
		);
		db.prepare(`INSERT INTO anime_series (series_id, folder) VALUES (?, ?)`).run(id, folder);
		return id;
	};
	const season = (title: string, key: string, folder: string, number: number) => {
		const id = show(title, key, folder);
		db.prepare(
			`INSERT INTO series_season_links (series_id, season, part, via, linked_at, year, episodes)
			VALUES (?, 1, 1, 'list', ?, ?, 2)`
		).run(id, now, 2022 + number);
		for (const n of [1, 2])
			db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
					available, duration_s, season, episode_number, source_url, origin_source, read_at)
				VALUES (?, ?, ?, ?, ?, 0, '', ?, 1440, ?, ?, ?, '', ?)`
			).run(
				id,
				n,
				`Ep. ${n}`,
				`${title} ${n}`,
				now,
				// One episode on disk (HERE) and one watched (WATCHED): the board's line.
				n === 1 ? 1 : 0,
				number,
				n,
				`https://example.test/${key}/${n}`,
				n === 1 ? now : null
			);
		return id;
	};
	season(SEASONS[0], 'aniyomi:7:/lantern', 'Anime/Lantern', 1);
	season(SEASONS[1], 'aniyomi:7:/lantern-s2', 'Anime/Lantern S2', 2);
	season(SEASONS[2], 'aniyomi:7:/lantern-s3', 'Anime/Lantern S3', 3);
	// The longest line a row draws at 360 px: 120 episodes, 120 watched, 120 HERE.
	LONG.forEach((title, i) => {
		const id = show(title, `aniyomi:7:/long-${i + 1}`, `Anime/Long ${i + 1}`);
		db.prepare(
			`INSERT INTO series_season_links (series_id, season, part, via, linked_at, year, episodes)
			VALUES (?, 1, 1, 'list', ?, 2026, 120)`
		).run(id, now);
		for (let n = 1; n <= (i === 0 ? 120 : 1); n++)
			db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
					available, duration_s, season, episode_number, source_url, origin_source, read_at)
				VALUES (?, ?, ?, ?, ?, 0, '', 1, 1440, ?, ?, ?, '', ?)`
			).run(
				id,
				n,
				`Ep. ${n}`,
				`${title} ${n}`,
				now,
				i + 1,
				n,
				`https://example.test/long/${i}/${n}`,
				now
			);
	});
	const ordinary = show(ORDINARY, 'aniyomi:7:/two-seasons', 'Anime/Two Seasons');
	for (const [n, s] of [
		[1, 1],
		[2, 1],
		[3, 2],
		[4, 2]
	])
		db.prepare(
			`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
				available, duration_s, season, episode_number, source_url, origin_source)
			VALUES (?, ?, ?, ?, ?, 0, '', 0, 1440, ?, ?, ?, '')`
		).run(
			ordinary,
			n,
			`Ep. ${n}`,
			`Ordinary ${n}`,
			now,
			s,
			n,
			`https://example.test/ordinary/${n}`
		);
	db.close();
}

const groupSheet = (page: Page) => page.getByRole('dialog', { name: 'Group into a series' });

/** A series tile by its exact title. */
const tileByTitle = (page: Page, title: string) =>
	page.locator('.grid .tile').filter({
		has: page.locator('.title', {
			hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
		})
	});

/** Selects these titles on the anime shelf, in this order, and opens GROUP. */
async function openGroup(page: Page, titles: string[]) {
	await page.goto('/?shelf=k:anime&sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const title of titles) await tileByTitle(page, title).locator('.open').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await expect(sheet).toBeVisible();
	return sheet;
}

test('GROUP on an anime selection opens on ONE SHOW and merges the seasons', async ({ page }) => {
	const sheet = await openGroup(page, SEASONS);
	// The AS row: ONE SHOW is the default for every anime selection, beside A WORK.
	await expect(sheet.getByRole('radio', { name: /ONE SHOW/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(sheet.getByRole('radio', { name: /^A WORK/ })).toHaveAttribute(
		'aria-checked',
		'false'
	);
	// The name is the shortest title, and the label says what it is without.
	await expect(sheet.getByRole('textbox', { name: 'Show name' })).toHaveValue('Lantern Keeper');
	await expect(sheet.locator('.sl.name-label')).toContainText('WITHOUT “SEASON 2”');
	// SEASONS' order is the numbering, from 1.
	await expect(sheet.locator('.sl.order-label')).toContainText('SEASONS · 3');
	await expect(sheet.locator('.sl.order-label')).toContainText('THE ORDER IS THE NUMBERING');
	const rows = sheet.locator('.rows.grows .row');
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0).locator('.num')).toHaveText('S1');
	await expect(rows.nth(1).locator('.num')).toHaveText('S2');
	await expect(rows.nth(2).locator('.num')).toHaveText('S3');
	await expect(rows.nth(0).locator('.a')).toHaveText('Lantern Keeper');
	await expect(rows.nth(1).locator('.a')).toHaveText('Lantern Keeper Season 2');
	// The row's meta line (c283's Build list; Seasons-Group.dc.html A1, lines
	// 76–77): the source, the episodes, the year, WATCHED in ink and what is on
	// disk. Each fact is the one its own writer keeps (season-facts.ts).
	await expect(rows.nth(0).locator('.b')).toHaveText(
		'KICKASSANIME · 2 EP. · 2023 · 1 WATCHED · 1 HERE'
	);
	await expect(rows.nth(0).locator('.b .ink')).toHaveText('1 WATCHED');
	await expect(rows.nth(1).locator('.b')).toHaveText(
		'KICKASSANIME · 2 EP. · 2024 · 1 WATCHED · 1 HERE'
	);
	// A show has no target yet: the ADD TO A SHOW cell is drawn, and disabled.
	await expect(sheet.getByRole('radio', { name: /ADD TO A SHOW · 0/ })).toBeDisabled();
	const merge = sheet.getByRole('button', { name: /MERGE · 3 SEASONS INTO ONE SERIES/ });
	await expect(merge).toBeVisible();
	await merge.click();

	// The show's own screen, with the band whose UNDO is UNGROUP.
	await page.waitForURL(/\/series\/\d+\?created=3&merge=1/);
	await expect(
		page.locator('.band', { hasText: 'MERGED · 3 SEASONS INTO ONE SERIES' })
	).toBeVisible();
	await expect(page.locator('.band')).toContainText('ONE TILE, ONE CONTINUE');
	// It is a merged show, so FILE offers UNGROUP.
	await expect(page.getByRole('button', { name: 'UNGROUP', exact: true })).toBeVisible();
});

test('UNDO puts the three seasons back under their own tiles', async ({ page }) => {
	const db = new Database(dbPath, { readonly: true });
	const showId = (db.prepare(`SELECT series_id AS id FROM season_merges`).get() as { id: number })
		.id;
	db.close();
	// The redirect's own URL, reached by a reload: the band is the press's answer
	// and it rides in the URL, not in a form that is gone.
	await page.goto(`/series/${showId}?created=3&merge=1`);
	const band = page.locator('.band', { hasText: 'MERGED · 3 SEASONS INTO ONE SERIES' });
	await expect(band).toBeVisible();
	await band.getByRole('button', { name: 'UNDO' }).click();
	await page.waitForURL(/\/\?sort=added$/);
	// Every series is back, its own title and its own tile.
	for (const title of SEASONS) await expect(tileByTitle(page, title)).toHaveCount(1);
	// And the show's screen is gone: no merged show is left to UNGROUP.
	const after = new Database(dbPath, { readonly: true });
	expect((after.prepare(`SELECT COUNT(*) AS n FROM season_merges`).get() as { n: number }).n).toBe(
		0
	);
	// The three seasons, the ordinary show, and the long pair the 360 px case uses.
	expect(
		(after.prepare(`SELECT COUNT(*) AS n FROM series WHERE kind = 'anime'`).get() as { n: number })
			.n
	).toBe(6);
	const first = (
		after.prepare(`SELECT id FROM series WHERE title = ?`).get(SEASONS[0]) as { id: number }
	).id;
	const before = after
		.prepare(`SELECT series_id, COUNT(*) AS n FROM entries GROUP BY series_id ORDER BY series_id`)
		.all();
	after.close();

	// The band's form says it is undoing a merge (round 2). A second press, or a
	// tab left on the band's URL, reaches the action after the journal is gone;
	// the first season's series still exists, so it must be a no-op redirect,
	// never the books' take-out that would break the anime into doujin singles.
	for (let i = 0; i < 2; i++) {
		const again = await page.request.post(`/series/${first}?/ungroup`, {
			form: { show: '1' },
			headers: { accept: 'text/html', origin: base },
			maxRedirects: 0
		});
		expect(again.status()).toBe(303);
	}
	// And a POST that does not say it is a show is refused: this is no book.
	const refused = await page.request.post(`/series/${first}?/ungroup`, {
		form: { other: '1' },
		headers: { accept: 'text/html', origin: base },
		maxRedirects: 0
	});
	expect(refused.status()).toBe(400);

	// The stale band's URL after an undo draws no band at all, including the
	// books' `SERIES CREATED` band, whose UNDO the server refuses (round 2), and
	// the series keeps every episode it had.
	await page.goto(`/series/${first}?created=3&merge=1`);
	await expect(page.locator('.band')).toHaveCount(0);
	await expect(page.getByText('SERIES CREATED')).toHaveCount(0);
	const unchanged = new Database(dbPath, { readonly: true });
	expect(
		unchanged
			.prepare(`SELECT series_id, COUNT(*) AS n FROM entries GROUP BY series_id ORDER BY series_id`)
			.all()
	).toEqual(before);
	expect(unchanged.prepare(`SELECT kind FROM series WHERE id = ?`).get(first)).toEqual({
		kind: 'anime'
	});
	unchanged.close();
});

test('an ordinary anime with seasons never offers UNGROUP', async ({ page }) => {
	await page.goto('/?shelf=k:anime&sort=title');
	await tileByTitle(page, ORDINARY).click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('button', { name: 'UNGROUP', exact: true })).toHaveCount(0);
});

test('the server refuses a show from a selection that is not all anime', async ({ page }) => {
	await page.goto('/');
	const db = new Database(dbPath, { readonly: true });
	const manga = (
		db.prepare(`SELECT id FROM series WHERE kind = 'manga' ORDER BY id LIMIT 1`).get() as {
			id: number;
		}
	).id;
	const anime = (
		db.prepare(`SELECT id FROM series WHERE title = ?`).get(SEASONS[0]) as {
			id: number;
		}
	).id;
	db.close();
	const answer = await page.evaluate(
		async ({ animeId, mangaId }) => {
			const form = new FormData();
			form.set('answer', 'show');
			form.set('name', 'Not A Show');
			form.append('series', String(animeId));
			form.append('series', String(mangaId));
			const res = await fetch('/?/group', {
				method: 'POST',
				body: form,
				headers: { 'x-sveltekit-action': 'true' }
			});
			return { status: res.status, body: (await res.json()) as unknown };
		},
		{ animeId: anime, mangaId: manga }
	);
	// A SvelteKit action answers 200 even when it fails (doc/WORKS.md, W6's
	// DOWNLOAD FIRST 10): the answer's own `type` is what says the show was refused.
	expect(answer.status).toBe(200);
	const body = answer.body as { type: string; data: unknown };
	expect(body.type).toBe('failure');
	expect(JSON.stringify(body.data)).toContain('ONLY ANIME');
});

test('ONE SHOW is offered only for what can be merged (round 2)', async ({ page }) => {
	const db = new Database(dbPath);
	const now = Date.UTC(2026, 10, 9);
	const root = (db.prepare(`SELECT id FROM roots ORDER BY id LIMIT 1`).get() as { id: number }).id;
	const add = (title: string) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, status, source, path, origin_key,
						source_url, added_at, indexed_at, in_library, hue)
					VALUES (?, ?, 'anime', 'completed', 'Kakkoi', '', ?, '', ?, ?, 1, 200)`
				)
				.run(root, title, `aniyomi:7:/${title.toLowerCase()}`, now, now).lastInsertRowid
		);
		db.prepare(
			`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
				available, duration_s, season, episode_number, source_url, origin_source)
			VALUES (?, 1, 'Ep. 1', ?, ?, 0, '', 0, 1440, 1, 1, ?, '')`
		).run(id, title, now, `https://example.test/${title}`);
		return id;
	};
	const alpha = add('Alpha');
	const beta = add('Beta');
	const gamma = add('Gamma');
	const delta = add('Delta');
	const work = (name: string, ids: number[]) => {
		const id = Number(
			db
				.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES (?, ?, 'hand')`)
				.run(name, now).lastInsertRowid
		);
		ids.forEach((seriesId, i) =>
			db
				.prepare(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`)
				.run(id, seriesId, i + 1)
		);
	};
	work('Run One', [alpha, beta]);
	work('Run Two', [gamma, delta]);
	db.close();
	// Reveal so a hidden tile can be ticked, as the library's own selection does.
	await page.context().addCookies([{ name: 'tsundoku_reveal', value: '1', url: base }]);

	const tick = async (title: string) => {
		const hit = page
			.locator('.hits .hit:not(.work)')
			.filter({ has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) });
		await expect(hit).toHaveCount(1);
		await hit.click();
	};
	const open = async (first: string, second: string) => {
		await page.goto(`/search?q=${encodeURIComponent(first)}`);
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await tick(first);
		await page.getByRole('searchbox', { name: 'Search' }).fill(second);
		await tick(second);
		await page.getByRole('button', { name: 'GROUP', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'Group into a series' });
		await expect(sheet).toBeVisible();
		return sheet;
	};

	// Two seasons of one Work: ONE SHOW is the default.
	let sheet = await open('Alpha', 'Beta');
	await expect(sheet.getByRole('radio', { name: /ONE SHOW/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await sheet.getByRole('button', { name: 'CANCEL' }).click();

	// Two Works: a show is one series, so it cannot join both. No ONE SHOW.
	sheet = await open('Alpha', 'Gamma');
	await expect(sheet.getByRole('radio', { name: /ONE SHOW/ })).toHaveCount(0);
	await expect(sheet.getByRole('radio', { name: /^A WORK/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await sheet.getByRole('button', { name: 'CANCEL' }).click();

	// Mixed hidden and visible: `alike` would refuse the merge, so the answer is
	// withheld rather than offered and refused after MERGE.
	const hide = new Database(dbPath);
	hide.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(beta);
	hide.close();
	sheet = await open('Alpha', 'Beta');
	await expect(sheet.getByRole('radio', { name: /ONE SHOW/ })).toHaveCount(0);
	await expect(sheet.getByRole('radio', { name: /^A WORK/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
});

/**
 * A season the load's first page did not draw (round 2): `groupFacts` answers
 * only the tiles the load sent, and GROUP's sheet can hold a season from a page
 * after it. The page reads those rows' facts through `/series/facts` (the same
 * ask a by-id selection makes), so both rows draw `<SOURCE> · … · HERE` rather
 * than the library's `ANIME · … WATCHED` line.
 */
test('a season selected past the first page draws the same show line (round 2)', async ({
	page
}) => {
	const db = new Database(dbPath);
	const now = Date.UTC(2026, 10, 9);
	const root = (db.prepare(`SELECT id FROM roots ORDER BY id LIMIT 1`).get() as { id: number }).id;
	// Three series of their own, newest last: with the grid's page at 2 the first
	// page is the two newest, and the third is drawn only by the page after it.
	const add = (title: string, key: string, addedAt: number) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, status, source, path, origin_key,
						source_url, added_at, indexed_at, in_library, hue)
					VALUES (?, ?, 'anime', 'completed', 'Kakkoi', '', ?, ?, ?, ?, 1, 200)`
				)
				.run(root, title, key, `https://example.test/${key}`, addedAt, addedAt).lastInsertRowid
		);
		db.prepare(`INSERT INTO anime_series (series_id, folder) VALUES (?, ?)`).run(id, title);
		db.prepare(
			`INSERT INTO series_season_links (series_id, season, part, via, linked_at, year, episodes)
			VALUES (?, 1, 1, 'list', ?, 2027, 2)`
		).run(id, addedAt);
		for (const n of [1, 2])
			db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
					available, duration_s, season, episode_number, source_url, origin_source, read_at)
				VALUES (?, ?, ?, ?, ?, 0, '', ?, 1440, 1, ?, ?, '', ?)`
			).run(
				id,
				n,
				`Ep. ${n}`,
				`${title} ${n}`,
				addedAt,
				n === 1 ? 1 : 0,
				n,
				`https://example.test/${key}/${n}`,
				n === 1 ? addedAt : null
			);
		return id;
	};
	// Seeded once per run: a repeat of this case (the world is shared) finds them
	// already there, and must not add a second set of the same titles.
	if (!db.prepare(`SELECT 1 FROM series WHERE title = 'Zeta One'`).get()) {
		add('Zeta One', 'aniyomi:7:/zeta-1', now + 1000);
		add('Zeta Two', 'aniyomi:7:/zeta-2', now + 2000);
		add('Zeta Three', 'aniyomi:7:/zeta-3', now + 3000);
	}
	db.close();
	// Only the end-to-end tests set the grid's page size (library/paging.ts).
	await page.context().addCookies([{ name: 'tsundoku_grid_page', value: '2', url: base }]);
	await page.goto('/?shelf=k:anime&sort=added');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	// One on the load's own first page.
	await tileByTitle(page, 'Zeta Three').locator('.open').click();
	// The rest of the grid, asked for as its end comes near: scroll to the end
	// until the oldest is drawn, and let the page read its show facts (the same
	// POST a by-id selection makes) before the sheet takes its rows.
	const past = tileByTitle(page, 'Zeta One');
	await page.evaluate(() => scrollTo({ top: document.body.scrollHeight }));
	await expect(past).toHaveCount(1);
	await past.locator('.open').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await expect(sheet).toBeVisible();
	const rowOf = (title: string) =>
		sheet
			.locator('.rows.grows .row')
			.filter({ has: page.locator('.a', { hasText: new RegExp(`^${title}$`) }) });
	// The first page's row and the page after it draw the same line.
	await expect(rowOf('Zeta Three').locator('.b')).toHaveText(
		'KICKASSANIME · 2 EP. · 2027 · 1 WATCHED · 1 HERE'
	);
	await expect(rowOf('Zeta One').locator('.b')).toHaveText(
		'KICKASSANIME · 2 EP. · 2027 · 1 WATCHED · 1 HERE'
	);
	await expect(rowOf('Zeta One').locator('.b .ink')).toHaveText('1 WATCHED');
	await sheet.getByRole('button', { name: 'CANCEL' }).click();
});

/**
 * The longest real line, at the phone's 360 px (c283's row): a source name the
 * length of KICKASSANIME, a three-digit episode count, and every episode
 * watched and on disk. The board truncates (`.t .b`'s `nowrap` + ellipsis) and
 * so does the sheet: the check reads a Range's rects, which a wrap would show
 * as more than one.
 */
test.describe('the row’s meta line at 360 px', () => {
	test.use({ viewport: { width: 360, height: 800 } });

	test('the longest real line stays one line, cut with the board’s ellipsis', async ({ page }) => {
		const sheet = await openGroup(page, LONG);
		const row = sheet.locator('.rows.grows .row').first();
		const line = row.locator('.b');
		await expect(line).toHaveText('KICKASSANIME · 120 EP. · 2026 · 120 WATCHED · 120 HERE');
		const measured = await line.evaluate((el) => {
			const range = document.createRange();
			range.selectNodeContents(el);
			// One rect per fragment (a dot, a word, WATCHED's ink span), so the lines
			// are the distinct tops: a wrap is a second top, not a second rect.
			const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
			const width = range.getBoundingClientRect().width;
			const cs = getComputedStyle(el);
			return { lines, width, box: el.clientWidth, whiteSpace: cs.whiteSpace };
		});
		expect(measured.lines, 'one line, not a wrap').toBe(1);
		expect(measured.whiteSpace).toBe('nowrap');
		expect(measured.width, 'the longest line does not fit at 360 px').toBeGreaterThan(measured.box);
		await expect(row.locator('.a')).toHaveCSS('text-overflow', 'ellipsis');
		const height = await row.evaluate((el) => Math.round(el.getBoundingClientRect().height));
		expect(height, 'the row does not grow').toBe(64);
	});
});

/**
 * GROUP opened before a page's show facts have answered (round 3): the sheet
 * takes its rows once, on open (`GroupSheet`'s reset), so a row whose
 * `/series/facts` ask is still out would keep the library's `ANIME · … WATCHED`
 * line for the whole sheet. The page's `fill` waits for those asks, bounded, and
 * an ask that answers after the list changed is dropped rather than drawn.
 */
const TAUS = ['Tau One', 'Tau Two', 'Tau Three'];

/** Three seasons of their own, newest last, so the grid's first page of 2 holds the newest. */
function seedTaus() {
	const db = new Database(dbPath);
	const now = Date.UTC(2026, 10, 10);
	const root = (db.prepare(`SELECT id FROM roots ORDER BY id LIMIT 1`).get() as { id: number }).id;
	if (db.prepare(`SELECT 1 FROM series WHERE title = ?`).get(TAUS[0])) {
		db.close();
		return;
	}
	TAUS.forEach((title, i) => {
		const at = now + (i + 1) * 1000;
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, status, source, path, origin_key,
						source_url, added_at, indexed_at, in_library, hue)
					VALUES (?, ?, 'anime', 'completed', 'Kakkoi', '', ?, ?, ?, ?, 1, 200)`
				)
				.run(root, title, `aniyomi:7:/tau-${i + 1}`, `https://example.test/tau-${i + 1}`, at, at)
				.lastInsertRowid
		);
		db.prepare(`INSERT INTO anime_series (series_id, folder) VALUES (?, ?)`).run(id, title);
		db.prepare(
			`INSERT INTO series_season_links (series_id, season, part, via, linked_at, year, episodes)
			VALUES (?, 1, 1, 'list', ?, 2027, 2)`
		).run(id, at);
		for (const n of [1, 2])
			db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
					available, duration_s, season, episode_number, source_url, origin_source, read_at)
				VALUES (?, ?, ?, ?, ?, 0, '', ?, 1440, 1, ?, ?, '', ?)`
			).run(
				id,
				n,
				`Ep. ${n}`,
				`${title} ${n}`,
				at,
				n === 1 ? 1 : 0,
				n,
				`https://example.test/tau-${i + 1}/${n}`,
				n === 1 ? at : null
			);
	});
	db.close();
}

/**
 * Hold the page's `/series/facts` asks, make them fail, or leave them hanging,
 * so a row's show line is late (or never comes) exactly when the sheet opens.
 * A wrapped `fetch` in the page, not a Playwright route: a pending route holds
 * `page.goto` itself, and what the app must see is only a fetch that has not
 * answered. `asked` counts the asks the page has really made; `release` lets
 * them all through, as a slow answer would.
 */
async function factsUnderControl(page: Page, answer: 'hold' | 'fail' | 'never') {
	await page.addInitScript((mode) => {
		const w = window as unknown as { __facts: { asked: number; release: () => void } };
		const waiting: Array<() => void> = [];
		w.__facts = {
			asked: 0,
			release: () => {
				for (const go of waiting.splice(0)) go();
			}
		};
		const real = window.fetch.bind(window);
		window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (!url.includes('/series/facts')) return real(input, init);
			w.__facts.asked += 1;
			if (mode === 'fail') return Promise.resolve(new Response('no', { status: 500 }));
			if (mode === 'never') return new Promise<Response>(() => {});
			return new Promise<Response>((resolve, reject) => {
				waiting.push(() => void real(input, init).then(resolve, reject));
			});
		};
	}, answer);
	return {
		asked: () =>
			page.evaluate(() => (window as unknown as { __facts: { asked: number } }).__facts.asked),
		release: () =>
			page.evaluate(() =>
				(window as unknown as { __facts: { release: () => void } }).__facts.release()
			)
	};
}

/** The grid's second page ticked: the newest from the tree, the oldest from the page after it. */
async function tickPastTheFirstPage(page: Page) {
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await tileByTitle(page, TAUS[2]).locator('.open').click();
	const past = tileByTitle(page, TAUS[0]);
	await page.evaluate(() => scrollTo({ top: document.body.scrollHeight }));
	await expect(past).toHaveCount(1);
	await past.locator('.open').click();
}

const rowIn = (page: Page, sheet: ReturnType<typeof groupSheet>, title: string) =>
	sheet
		.locator('.rows.grows .row')
		.filter({ has: page.locator('.a', { hasText: new RegExp(`^${title}$`) }) });

test('GROUP waits for a page’s show facts, however late they answer (round 3)', async ({
	page
}) => {
	seedTaus();
	await page.context().addCookies([{ name: 'tsundoku_grid_page', value: '2', url: base }]);
	const facts = await factsUnderControl(page, 'hold');
	await page.goto('/?shelf=k:anime&sort=added');
	// The page's ask for the pages after the first is out, and held.
	await expect.poll(() => facts.asked(), 'the page asked for the show line').toBeGreaterThan(0);
	await tickPastTheFirstPage(page);
	await expect.poll(() => facts.asked()).toBeGreaterThan(0);
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	// The sheet's rows are taken once, on open: it waits for the line rather
	// than drawing the library's and never updating it.
	await expect(groupSheet(page)).toHaveCount(0);
	await facts.release();
	const sheet = groupSheet(page);
	await expect(sheet).toBeVisible();
	for (const title of [TAUS[0], TAUS[2]])
		await expect(rowIn(page, sheet, title).locator('.b')).toHaveText(
			'KICKASSANIME · 2 EP. · 2027 · 1 WATCHED · 1 HERE'
		);
	await sheet.getByRole('button', { name: 'CANCEL' }).click();
});

test('a show-facts ask that answers after the list changed is not drawn (round 3)', async ({
	page
}) => {
	seedTaus();
	await page.context().addCookies([{ name: 'tsundoku_grid_page', value: '2', url: base }]);
	const facts = await factsUnderControl(page, 'hold');
	{
		await page.goto('/?shelf=k:anime&sort=added');
		await expect.poll(() => facts.asked()).toBeGreaterThan(0);
		await tickPastTheFirstPage(page);
		await expect.poll(() => facts.asked()).toBeGreaterThan(0);
		// Another kind is another list: the page bumps its generation, so an
		// answer for the old one is not drawn on the new one's selection. (The
		// SORT cell is the library bar's, which SELECT's bar covers.)
		await page.locator('.kinds .kc', { hasText: 'Manga' }).click();
		await expect(page).toHaveURL(/kind=manga/);
		await page.evaluate(() => scrollTo({ top: 0 }));
		await facts.release();
		await expect(page.getByRole('button', { name: 'GROUP', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'GROUP', exact: true }).click();
		const sheet = groupSheet(page);
		await expect(sheet).toBeVisible();
		// The selection outlives the sort, and its row keeps the line it was
		// drawn with: the late answer belongs to the list that is gone.
		await expect(rowIn(page, sheet, TAUS[0]).locator('.b')).toHaveText('ANIME · 2 EP · 1 WATCHED');
		await sheet.getByRole('button', { name: 'CANCEL' }).click();
	}
});

test('a show-facts ask that fails: GROUP still opens, with the line the row has (round 3)', async ({
	page
}) => {
	seedTaus();
	await page.context().addCookies([{ name: 'tsundoku_grid_page', value: '2', url: base }]);
	await factsUnderControl(page, 'fail');
	{
		await page.goto('/?shelf=k:anime&sort=added');
		await tickPastTheFirstPage(page);
		await page.getByRole('button', { name: 'GROUP', exact: true }).click();
		const sheet = groupSheet(page);
		await expect(sheet).toBeVisible();
		await expect(rowIn(page, sheet, TAUS[0]).locator('.b')).toHaveText('ANIME · 2 EP · 1 WATCHED');
		await expect(rowIn(page, sheet, TAUS[2]).locator('.b')).toHaveText(
			'KICKASSANIME · 2 EP. · 2027 · 1 WATCHED · 1 HERE'
		);
		await sheet.getByRole('button', { name: 'CANCEL' }).click();
	}
});

test('a show-facts ask that never answers: GROUP opens anyway, after its wait (round 3)', async ({
	page
}) => {
	seedTaus();
	await page.context().addCookies([{ name: 'tsundoku_grid_page', value: '2', url: base }]);
	await factsUnderControl(page, 'never');
	{
		await page.goto('/?shelf=k:anime&sort=added');
		await tickPastTheFirstPage(page);
		await page.getByRole('button', { name: 'GROUP', exact: true }).click();
		const sheet = groupSheet(page);
		// The wait is bounded (3 s): a read that never answers must not hold the
		// sheet shut, the rule DELETE's own held read follows.
		await expect(sheet).toBeVisible({ timeout: 10_000 });
		await expect(rowIn(page, sheet, TAUS[0]).locator('.b')).toHaveText('ANIME · 2 EP · 1 WATCHED');
		await sheet.getByRole('button', { name: 'CANCEL' }).click();
	}
});
