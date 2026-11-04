import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { expect, test, readerReady } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * The end of a series in a Work (c280, W6; doc/WORKS.md): the end page's next
 * part, its four states, the tap-not-swipe rule, and the player's last
 * episode. The frame assertions below are design-tools/gen-conformance output
 * pinned from `Work-End.dc.html`; the preamble that makes the Work and serves
 * it is hand-written, and regenerating drops it (doc/WORKS.md, "The frames").
 *
 * A Work takes its parts' grid tiles away while it exists, so this runs on the
 * works frames' arrangement (tests/works-library-frame.e2e.ts): a seeded
 * database of its own and a preview of the same build on a free port. It also
 * seeds an anime series of its own, whose episodes are the fixture clip as
 * downloaded files, so the player's last episode is real without the browse
 * world's fake engine -- and without its shared database.
 */
const pinnedPort = Number(process.env.PLAYWRIGHT_WORKS_PORT);
const PORT =
	Number.isInteger(pinnedPort) && pinnedPort > 0 && pinnedPort <= 65535
		? pinnedPort
		: // Nothing outside this file needs the number: it seeds its own database
			// and serves it here. `PLAYWRIGHT_WORKS_PORT` pins the port when the
			// gate assigns one; unset, the OS hands out a free one, so the repo's
			// own `npx playwright test` runs the file and two concurrent runs do
			// not collide.
			await new Promise<number>((resolve, reject) => {
				const probe = createServer();
				probe.once('error', reject);
				probe.listen(0, '127.0.0.1', () => {
					const { port } = probe.address() as AddressInfo;
					probe.close(() => resolve(port));
				});
			});
const base = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-work-end-${process.pid}.sqlite`);
const ANIME = "Frieren: Beyond Journey's End";
/**
 * An anime as a Work's next part (c343): its own row, because a series is in
 * one Work at most and ANIME is already the first part of the player's. No
 * file, so the block offers to download its first episodes.
 */
const ANIME_NEXT = 'Hoshizora Lantern';
/** The manga each case's Work offers as its next part. */
const PART2 = {
	block: 'Isekai Ojisan',
	meanwhile: 'Return of the Mount Hua Sect',
	online: 'Tower of God',
	read: 'Chainsaw Man',
	player: 'Boku no Kokoro no Yabai Yatsu',
	novel: 'Sousou no Frieren',
	stalled: 'The Greatest Estate Developer',
	scroll: 'Dungeon Meshi'
};
let server: ChildProcess | null = null;
const wipe = () => {
	for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
};
/** The end page's chapter per case: the last chapter of that Work's first part. */
const lastEntry: Record<string, number> = {};
/** The first chapter of each case's next part: where its block's START opens. */
const firstEntry: Record<string, number> = {};
const works: Record<string, number> = {};
let animeEpisode = 0;

test.use({ baseURL: base });

function seed() {
	wipe();
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
}

/**
 * The states the four boards draw, in SQL, because they are library facts the
 * seed has only one of each: an anime whose episodes are files, a part read
 * through, a part caught up on an ongoing source, and a next part with no file
 * that a source can serve (doc/WORKS.md, W6).
 */
function prepare() {
	const db = new Database(dbPath);
	const now = Date.now();
	const video = join(process.cwd(), 'tests/fixtures/video');
	const animeId = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, status, source, path, origin_key,
					source_url, added_at, indexed_at, in_library, hue)
				VALUES (1, ?, 'anime', 'completed', 'Kakkoi', ?, ?, ?, ?, ?, 1, 200)`
			)
			.run(
				ANIME,
				video,
				'aniyomi:1:https://example.test/frieren',
				'https://example.test/frieren',
				now,
				now
			).lastInsertRowid
	);
	const insert = db.prepare(
		`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
			available, duration_s, season, episode_number, source_url, origin_source)
		VALUES (?, ?, ?, ?, ?, 0, 'clip.webm', 1, 8, 3, ?, ?, '')`
	);
	const episode = (n: number, title: string) =>
		Number(
			insert.run(animeId, n, `Ep. ${n}`, title, now, n, `https://example.test/frieren/${n}`)
				.lastInsertRowid
		);
	episode(1, 'The Journey Begins');
	animeEpisode = episode(2, 'The Last Road');
	const animeNextId = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, status, source, path, origin_key,
					source_url, added_at, indexed_at, in_library, hue)
				VALUES (1, ?, 'anime', 'completed', 'Fake Source', ?, ?, ?, ?, ?, 1, 120)`
			)
			.run(
				ANIME_NEXT,
				video,
				'aniyomi:1:https://example.test/lantern',
				'https://example.test/lantern',
				now,
				now
			).lastInsertRowid
	);
	for (const n of [1, 2, 3])
		db.prepare(
			`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
				available, duration_s, season, episode_number, source_url, origin_source)
			VALUES (?, ?, ?, ?, ?, 0, '', 0, 0, 1, ?, ?, '')`
		).run(animeNextId, n, `Ep. ${n}`, `Lantern ${n}`, now, n, `https://example.test/lantern/${n}`);

	// Caught up: every chapter read on a source that is still ongoing (Kusuriya).
	db.prepare(`UPDATE entries SET read_at = ? WHERE series_id = 3`).run(now);
	// The run read: both parts read through.
	db.prepare(`UPDATE entries SET read_at = ? WHERE series_id IN (15, 21)`).run(now);
	// The next part isn't downloaded, and a source can serve it (Tower of God).
	db.prepare(`UPDATE entries SET available = 0 WHERE series_id = 14`).run();
	db.prepare(
		`UPDATE series SET origin_key = 'mihon:1:https://example.test/tower',
			source_url = 'https://example.test/tower', source = 'Fake Source' WHERE id = 14`
	).run();
	// A second caught-up part (Drawing is ongoing and read to its end) whose next
	// part has no file and no source: its meanwhile row cannot open.
	db.prepare(`UPDATE entries SET read_at = ? WHERE series_id = 1`).run(now);
	db.prepare(`UPDATE entries SET available = 0 WHERE series_id = 7`).run();
	// The scroll novel, whose last volume's end is the reader's end page too.
	db.prepare(`UPDATE series SET direction = 'scroll' WHERE id = 16`).run();
	db.prepare(
		`INSERT INTO engine_extensions (pkg, repo_id, name, kind, version_code, version_name, lib,
			handle, installed_at, updated_at) VALUES ('fake', NULL, 'Fake', 'manga', 1, '1.0', '1.0',
			'fake.apk', ?, ?)`
	).run(now, now);
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url)
			VALUES ('1', 'fake', 'Fake Source', 'en', 'https://example.test')`
	).run();
	// Lookism, the anime's first part, read paged R→L as openEnd turns it:
	// a manhwa scrolls by default, and a strip has no page to turn past.
	db.prepare(`UPDATE series SET direction = 'rtl' WHERE id = 19`).run();
	for (const id of [22, 3, 8, 21, 20, 1, 15, 16, 19])
		lastEntry[id] = (
			db
				.prepare(
					`SELECT id FROM entries WHERE series_id = ? AND shadowed = 0 AND matter = ''
						ORDER BY position DESC, id DESC LIMIT 1`
				)
				.get(id) as { id: number }
		).id;
	for (const id of [23, 10, 14, 21, 18, 5])
		firstEntry[id] = (
			db
				.prepare(
					`SELECT id FROM entries WHERE series_id = ? AND shadowed = 0 AND matter = ''
						ORDER BY position, id LIMIT 1`
				)
				.get(id) as { id: number }
		).id;
	db.close();
}

async function signedIn(browser: Browser, info: TestInfo) {
	const context = await browser.newContext({
		storageState: info.project.use.storageState as string,
		baseURL: base
	});
	return { page: await context.newPage(), close: () => context.close() };
}

/** A series tile by its exact title: "Isekai" is a prefix of two of them. */
const tile = (page: Page, title: string) =>
	page.locator('.grid .tile').filter({
		has: page.locator('.title', {
			hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
		})
	});

/**
 * Picks these two titles in this order and groups them AS A WORK through W4's
 * sheet, then opens the Work. Its name is this file's own (every Work here is
 * renamed in SQL after it is made), because titles sharing no words have no
 * default.
 */
let madeWorks = 0;
async function makeWork(page: Page, first: string, second: string): Promise<number> {
	// A name of its own per Work: nine of them exist at once, and a tile found
	// by a shared name would match the wrong one.
	const name = `Frame Run ${++madeWorks}`;
	await page.goto('/');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await tile(page, first).locator('.open').click();
	await tile(page, second).locator('.open').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill(name);
	await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
	await expect(page.locator('.band', { hasText: `${name.toUpperCase()} IS A WORK` })).toBeVisible();
	await page.locator('.grid .tile.work', { hasText: name }).click();
	await page.waitForURL(/\/work\/\d+/);
	return Number(/\/work\/(\d+)/.exec(page.url())![1]);
}

/** The end page of the chapter that ended: its last page, then one turn past it. */
async function openEnd(page: Page, seriesId = 22) {
	await page.goto(`${base}/read/${lastEntry[seriesId]}?p=last`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	// R→L: ← is forward, and at the last page it is the end page.
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('[data-end-page]')).toBeVisible();
}

test.beforeAll(async ({ browser }, info) => {
	// The hook builds nothing but waits up to 60 s for its own preview, then
	// makes nine Works: past the default 30 s under a loaded box, where it was
	// red in every run of wave 20's gate (c477). In a hook, test.setTimeout sets
	// the hook's own budget (Playwright's test.d.ts, "Changing timeout for a
	// beforeAll").
	test.setTimeout(120_000);
	seed();
	prepare();
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			// `readsOnline` asks whether an installed extension serves the source.
			// Nothing here reaches it; the address is one nothing listens on.
			ENGINE_URL: 'http://127.0.0.1:9',
			ENGINE_TOKEN: 'e2e',
			LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-work-end-empty-${process.pid}`),
			TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-work-end-home-${process.pid}`)
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
	if (!up) throw new Error('the work-end preview never answered');

	// Nine Works, each a pair this file owns: the database is its own, so no
	// title has to be kept from any other spec.
	const { page, close } = await signedIn(browser, info);
	works.block = await makeWork(page, 'Isekai Yakkyoku', PART2.block);
	works.meanwhile = await makeWork(page, 'Kusuriya no Hitorigoto', PART2.meanwhile);
	works.online = await makeWork(page, 'Yofukashi no Uta', PART2.online);
	works.read = await makeWork(page, 'Hikaru ga Shinda Natsu', PART2.read);
	works.player = await makeWork(page, ANIME, PART2.player);
	works.novel = await makeWork(page, 'Tensei Shitara Ken Deshita', PART2.novel);
	works.stalled = await makeWork(
		page,
		'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		PART2.stalled
	);
	works.scroll = await makeWork(page, 'Villainess Level 99', PART2.scroll);
	works.animeNext = await makeWork(page, 'Lookism', ANIME_NEXT);
	await close();

	// Their names, so the blocks say something this file can assert on.
	const db = new Database(dbPath);
	const rename = db.prepare(`UPDATE works SET name = ? WHERE id = ?`);
	rename.run('Isekai Run', works.block);
	rename.run('Kusuriya Run', works.meanwhile);
	rename.run('Yofukashi Run', works.online);
	rename.run('Hikaru Run', works.read);
	rename.run('Frieren Run', works.player);
	rename.run('Ken Run', works.novel);
	rename.run('Drawing Run', works.stalled);
	rename.run('Villainess Run', works.scroll);
	rename.run('Lookism Run', works.animeNext);
	db.close();
});

test.afterAll(() => {
	server?.kill();
	server = null;
	wipe();
});

const SEL = {
	nextw: '.end .nextw',
	coverWell: '.end .nextw .cvw',
	info: '.end .nextw .info',
	kickerLine: '.end .nextw .info .k',
	nextTitle: '.end .nextw .info .big',
	nextSub: '.end .nextw .info .sub',
	actions: '.end .nextw .go',
	start: '.end .nextw .go > .acc',
	workCell: '.end .nextw .go > a:not(.acc)',
	kicker: '.end .body > .kicker:first-of-type',
	title: '.end .body > .big',
	note: '.end .note',
	foot: '.end .foot',
	footCell: '.end .foot .fcell:first-child'
};

test('screen: nextw matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.nextw)).toBeVisible();

	const nextwStyle = await page.locator(SEL.nextw).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth
		};
	});
	expect(nextwStyle.display).toBe('flex');
	expect(nextwStyle.borderTopWidth).toBe('1px');
	expect(nextwStyle.borderRightWidth).toBe('1px');
	expect(nextwStyle.borderBottomWidth).toBe('1px');
	expect(nextwStyle.borderLeftWidth).toBe('1px');
});

test('screen: coverWell matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.coverWell)).toBeVisible();

	const coverWellStyle = await page.locator(SEL.coverWell).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderRightWidth: cs.borderRightWidth
		};
	});
	expect(coverWellStyle.display).toBe('block');
	expect(coverWellStyle.paddingTop).toBe('20px');
	expect(coverWellStyle.paddingRight).toBe('20px');
	expect(coverWellStyle.paddingBottom).toBe('20px');
	expect(coverWellStyle.paddingLeft).toBe('20px');
	expect(coverWellStyle.borderRightWidth).toBe('1px');
});

test('screen: info matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.info)).toBeVisible();

	const infoStyle = await page.locator(SEL.info).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft
		};
	});
	expect(infoStyle.display).toBe('flex');
	expect(infoStyle.flexDirection).toBe('column');
	expect(infoStyle.justifyContent).toBe('center');
	expect(infoStyle.rowGap).toBe('12px');
	expect(infoStyle.columnGap).toBe('12px');
	expect(infoStyle.paddingTop).toBe('20px');
	expect(infoStyle.paddingRight).toBe('24px');
	expect(infoStyle.paddingBottom).toBe('20px');
	expect(infoStyle.paddingLeft).toBe('24px');
});

test('screen: kickerLine matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.kickerLine)).toBeVisible();

	const kickerLineStyle = await page.locator(SEL.kickerLine).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(kickerLineStyle.display).toBe('block');
	expect(kickerLineStyle.fontSize).toBe('12px');
	expect(kickerLineStyle.fontWeight).toBe('500');
	expect(kickerLineStyle.letterSpacing).toBe('0.72px');
});

test('screen: nextTitle matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.nextTitle)).toBeVisible();

	const nextTitleStyle = await page.locator(SEL.nextTitle).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight
		};
	});
	expect(nextTitleStyle.display).toBe('block');
	expect(nextTitleStyle.fontSize).toBe('32px');
	expect(nextTitleStyle.fontWeight).toBe('500');
	expect(nextTitleStyle.lineHeight).toBe('38px');
});

test('screen: nextSub matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.nextSub)).toBeVisible();

	const nextSubStyle = await page.locator(SEL.nextSub).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			fontSize: cs.fontSize
		};
	});
	expect(nextSubStyle.display).toBe('block');
	expect(nextSubStyle.fontSize).toBe('15px');
});

test('screen: actions matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.actions)).toBeVisible();

	const actionsStyle = await page.locator(SEL.actions).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderTopWidth: cs.borderTopWidth
		};
	});
	expect(actionsStyle.display).toBe('flex');
	expect(actionsStyle.alignItems).toBe('stretch');
	expect(actionsStyle.borderTopWidth).toBe('1px');
});

test('screen: start matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.start)).toBeVisible();

	const startStyle = await page.locator(SEL.start).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(startStyle.display).toBe('flex');
	expect(startStyle.alignItems).toBe('center');
	expect(startStyle.justifyContent).toBe('space-between');
	expect(startStyle.paddingRight).toBe('24px');
	expect(startStyle.paddingLeft).toBe('24px');
	expect(startStyle.fontSize).toBe('15px');
	expect(startStyle.fontWeight).toBe('500');
	expect(startStyle.letterSpacing).toBe('0.6px');
});

test('screen: workCell matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.workCell)).toBeVisible();

	const workCellStyle = await page.locator(SEL.workCell).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(workCellStyle.display).toBe('flex');
	expect(workCellStyle.alignItems).toBe('center');
	expect(workCellStyle.paddingRight).toBe('24px');
	expect(workCellStyle.paddingLeft).toBe('24px');
	expect(workCellStyle.borderLeftWidth).toBe('1px');
	expect(workCellStyle.fontSize).toBe('15px');
	expect(workCellStyle.fontWeight).toBe('500');
	expect(workCellStyle.letterSpacing).toBe('0.6px');
});

test('screen: kicker matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.kicker)).toBeVisible();

	const kickerStyle = await page.locator(SEL.kicker).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(kickerStyle.display).toBe('flex');
	expect(kickerStyle.justifyContent).toBe('space-between');
	expect(kickerStyle.rowGap).toBe('12px');
	expect(kickerStyle.columnGap).toBe('12px');
	expect(kickerStyle.fontSize).toBe('13px');
	expect(kickerStyle.fontWeight).toBe('500');
	expect(kickerStyle.letterSpacing).toBe('0.78px');
});

test('screen: title matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.title)).toBeVisible();

	const titleStyle = await page.locator(SEL.title).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight
		};
	});
	expect(titleStyle.display).toBe('block');
	expect(titleStyle.fontSize).toBe('44px');
	expect(titleStyle.fontWeight).toBe('500');
	expect(titleStyle.lineHeight).toBe('50.6px');
});

test('screen: note matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.note)).toBeVisible();

	const noteStyle = await page.locator(SEL.note).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			fontSize: cs.fontSize,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(noteStyle.display).toBe('block');
	expect(noteStyle.fontSize).toBe('12px');
	expect(noteStyle.letterSpacing).toBe('0.48px');
});

test('screen: foot matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.foot)).toBeVisible();

	const footStyle = await page.locator(SEL.foot).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			borderTopWidth: cs.borderTopWidth
		};
	});
	expect(footStyle.display).toBe('flex');
	expect(footStyle.borderTopWidth).toBe('1px');
});

test('screen: footCell matches the handoff', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.footCell)).toBeVisible();

	const footCellStyle = await page.locator(SEL.footCell).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderRightWidth: cs.borderRightWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(footCellStyle.display).toBe('flex');
	expect(footCellStyle.alignItems).toBe('center');
	expect(footCellStyle.paddingRight).toBe('24px');
	expect(footCellStyle.paddingLeft).toBe('24px');
	expect(footCellStyle.borderRightWidth).toBe('1px');
	expect(footCellStyle.fontSize).toBe('14px');
	expect(footCellStyle.fontWeight).toBe('500');
	expect(footCellStyle.letterSpacing).toBe('0.56px');
});
// ---- the four states, the tap-not-swipe rule, the player (c280) ------------

test('the block is a tap, never a swipe: a chapter boundary cannot cross into another series', async ({
	page
}) => {
	await openEnd(page);
	const url = page.url();
	const stage = (await page.locator('.stage').boundingBox())!;
	// R→L: a swipe to the right is forward. At the end of the series it must do
	// nothing -- the next series may read the other way, and the rating is asked
	// here (Works Calls, "Why a tap and not a swipe"). The swipe starts above the
	// block: a drag that begins on a link is the link's, never the page's.
	const y = stage.y + stage.height * 0.15;
	await page.mouse.move(stage.x + stage.width * 0.4, y);
	await page.mouse.down();
	await page.mouse.move(stage.x + stage.width * 0.8, y, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(400);
	expect(page.url()).toBe(url);
	await expect(page.locator(SEL.nextw)).toBeVisible();
	// A key turns pages too, and one more turn past the end is not a crossing.
	await page.keyboard.press('ArrowLeft');
	await page.waitForTimeout(300);
	expect(page.url()).toBe(url);
	await expect(page.locator(SEL.nextw)).toBeVisible();
	// The tap is the way across: START opens the next part's first chapter.
	await page.locator(SEL.start).click();
	await page.waitForURL(new RegExp(`/read/${firstEntry[23]}\\?p=1`));
	await readerReady(page);
});

test('caught up on an ongoing part keeps END · LAST AVAILABLE and offers a MEANWHILE row', async ({
	page
}) => {
	await openEnd(page, 3);
	await expect(page.getByText('END · LAST AVAILABLE')).toBeVisible();
	await expect(page.locator(SEL.nextw)).toHaveCount(0);
	const row = page.locator('.end .wrow');
	await expect(row).toContainText('MEANWHILE');
	await expect(row).toContainText('Return of the Mount Hua Sect · CH. 1');
	await expect(row).toContainText(/NEXT IN KUSURIYA RUN · PART 2 · \d+ CH\. · ALL DOWNLOADED/);
	await expect(row).toContainText('START →');
	await expect(page.locator(SEL.foot)).toContainText('KUSURIYA RUN · WORK');
});

test('a next part with no file reads online from its source, and offers DOWNLOAD FIRST 10', async ({
	page
}) => {
	await openEnd(page, 8);
	await expect(page.locator(SEL.nextSub)).toHaveText(
		'○ NOT DOWNLOADED · READS ONLINE FROM FAKE SOURCE'
	);
	await expect(page.locator(SEL.start)).toContainText('▶ READ ONLINE · CH. 1');
	await expect(page.locator(SEL.start)).toContainText('STREAMED PAGES');
	await expect(page.locator('.end .nextw .go .dl')).toHaveText('DOWNLOAD FIRST 10 CHAPTERS');
});

test('DOWNLOAD FIRST 10 that queues nothing says so, and can be pressed again (c344)', async ({
	page
}) => {
	// The real action, on this file's own server: its engine is
	// http://127.0.0.1:9, where nothing listens, so the source lists no chapter
	// to fetch and ?/download answers a success that queued nothing.
	await openEnd(page, 8);
	const dl = page.locator('.end .nextw .go .dl');
	await expect(dl).toHaveText('DOWNLOAD FIRST 10 CHAPTERS');
	const asked = page.waitForRequest((r) => /\?\/download$/.test(r.url()) && r.method() === 'POST');
	await dl.click();
	const request = await asked;
	expect(request.url()).toContain('/series/14?/download');
	expect(request.postData()).toMatch(/name="which"\r\n\r\nnext\r\n/);
	// The answer as the page reads it: a success, and devalue's table says 0 queued.
	const answer = JSON.parse(await (await request.response())!.text());
	expect(answer.type).toBe('success');
	const table = JSON.parse(answer.data);
	expect(table[table[table[0].downloaded].queued]).toBe(0);
	await expect(dl).toHaveText('NOT QUEUED · TRY THE SERIES');
	// Not a dead end: still a cell, and a second press asks again.
	await expect(dl).toBeEnabled();

	// The engine down, as the action says it: HTTP 200 and a failure inside,
	// which is how SvelteKit answers an action called with x-sveltekit-action.
	await page.route(/\?\/download$/, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				type: 'failure',
				status: 503,
				data: '[{"message":1},"Downloading is not answering"]'
			})
		})
	);
	await dl.click();
	await expect(dl).toHaveText('NOT QUEUED · TRY THE SERIES');
	await expect(dl).toBeEnabled();

	// And a queue that took: QUEUED ✓, and the cell is done.
	await page.unroute(/\?\/download$/);
	await page.route(/\?\/download$/, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				type: 'success',
				status: 200,
				data: '[{"downloaded":1},{"queued":2,"missing":3},10,0]'
			})
		})
	);
	await dl.click();
	await expect(dl).toHaveText('QUEUED ✓');
	await expect(dl).toBeDisabled();
	await page.unroute(/\?\/download$/);
});

test('an anime next part with no file speaks in episodes, and offers its first 10 episodes (c343)', async ({
	page
}) => {
	// Reached through the app's own doors: an aniyomi series with no file is not
	// "online" to the end page (readsOnline knows Mihon keys only), so the block
	// is in its NOT DOWNLOADED state. The online words for every kind are
	// tests/works.spec.ts's, over the whole registry.
	await openEnd(page, 19);
	await expect(page.locator(SEL.kickerLine)).toHaveText('NEXT IN LOOKISM RUN · PART 2 OF 2');
	await expect(page.locator(SEL.nextTitle)).toHaveText(ANIME_NEXT);
	await expect(page.locator(SEL.nextSub)).toHaveText('○ NOT DOWNLOADED');
	const go = page.locator('.end .nextw .go');
	await expect(go.locator('> .dim')).toContainText('▶ WATCH · EP. 1');
	await expect(go).not.toContainText('PAGES');
	await expect(go).not.toContainText('CHAPTERS');
	await expect(go.locator('.dl')).toHaveText('DOWNLOAD FIRST 10 EPISODES');
});

test('offline and not cached: OFFLINE · NOT CACHED, START dimmed, no download cell', async ({
	page,
	context
}) => {
	await openEnd(page);
	await expect(page.locator(SEL.nextSub)).toHaveText(/ALL DOWNLOADED/);
	await context.setOffline(true);
	await expect(page.locator(SEL.nextSub)).toHaveText('○ OFFLINE · NOT CACHED');
	// START is a dimmed span, not a link: nothing pretends a chapter opens.
	await expect(page.locator('.end .nextw .go > a.acc')).toHaveCount(0);
	await expect(page.locator('.end .nextw .go > .dim')).toContainText('NOT CACHED');
	// DOWNLOAD FIRST 10 is a queue, and a queue with no network is a lie.
	await expect(page.locator('.end .nextw .go .dl')).toHaveCount(0);
	await context.setOffline(false);
});

test('a meanwhile row whose next part has no file says so instead of offering a cell', async ({
	page
}) => {
	await openEnd(page, 1);
	await expect(page.getByText('END · LAST AVAILABLE')).toBeVisible();
	await expect(page.locator(SEL.nextw)).toHaveCount(0);
	const row = page.locator('.end .wrow');
	await expect(row).toContainText('MEANWHILE');
	await expect(row).toContainText('The Greatest Estate Developer · CH. 1');
	await expect(row).toContainText(/NEXT IN DRAWING RUN · PART 2 · \d+ CH\. · ○ NOT DOWNLOADED/);
	// A group named for why it cannot open (c345), not a bare div read as text.
	// Not aria-disabled: that would reach the cell it holds, below.
	await expect(row).not.toHaveAttribute('aria-disabled');
	await expect(row).toHaveAttribute('role', 'group');
	await expect(
		page.getByRole('group', { name: 'NEXT IN DRAWING RUN, NOT DOWNLOADED' })
	).toBeVisible();
	// No link: the row is not a cell, so it cannot open the reader's IS NOT
	// DOWNLOADED page.
	await expect(page.locator('.end a.wrow')).toHaveCount(0);
	// Its one cell is the block's DOWNLOAD FIRST 10, the pad's stop on a TV. This
	// part has no source, so the real action refuses it, and the cell says so.
	const dl = row.getByRole('button', { name: 'DOWNLOAD FIRST 10 CHAPTERS' });
	await expect(dl).toBeEnabled();
	await expect(dl).toHaveAttribute('data-focus-mark', 'in');
	const asked = page.waitForRequest((r) => /\/series\/7\?\/download$/.test(r.url()));
	await dl.click();
	expect((await asked).postData()).toMatch(/name="which"\r\n\r\nnext\r\n/);
	await expect(row.locator('.dl')).toHaveText('NOT QUEUED · TRY THE SERIES');
	await expect(page.locator(SEL.foot)).toContainText('DRAWING RUN · WORK');

	// The same row with a source that can serve its first chapter: it opens, so
	// it is a link again, and says where it reads from.
	const db = new Database(dbPath);
	db.prepare(
		`UPDATE series SET origin_key = 'mihon:1:https://example.test/estate',
			source_url = 'https://example.test/estate', source = 'Fake Source' WHERE id = 7`
	).run();
	db.close();
	await openEnd(page, 1);
	const online = page.locator('.end a.wrow');
	await expect(online).toBeVisible();
	await expect(online).toContainText('○ NOT DOWNLOADED · READS ONLINE FROM FAKE SOURCE');
	await expect(online.locator('.wr')).toHaveText('READ ONLINE →');
});

test('a meanwhile row offline and not cached is a group named for why, with no cell (c345)', async ({
	page,
	context
}) => {
	await openEnd(page, 3);
	await expect(page.locator('.end a.wrow')).toBeVisible();
	await context.setOffline(true);
	const row = page.getByRole('group', { name: 'NEXT IN KUSURIYA RUN, NOT CACHED' });
	await expect(row).toBeVisible();
	await expect(row.locator('.wr')).toHaveText('NOT CACHED');
	await expect(row).toHaveAttribute('aria-disabled', 'true');
	// A queue with no network is a lie, here as in the block.
	await expect(row.getByRole('button')).toHaveCount(0);
	await context.setOffline(false);
});

test('a novel read in SCROLL reaches the end page, so the Work is offered there too', async ({
	page
}) => {
	await page.goto(`${base}/read/${lastEntry[16]}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	// This series' LAYOUT is SCROLL (its own database, so nothing to put back):
	// its last volume has no page to turn past, so its own end must be the end.
	await expect(page.locator('.text-reader.scroll')).toBeVisible();
	await page.locator('.page').evaluate((n) => (n.scrollTop = n.scrollHeight));
	await expect(page.locator('[data-end-page]')).toBeVisible();
	await expect(page.locator(SEL.kicker)).toContainText('NOVEL · CH. 20 OF 20');
	await expect(page.locator(SEL.nextw)).toBeVisible();
	await expect(page.locator(SEL.kickerLine)).toHaveText('NEXT IN VILLAINESS RUN · PART 2 OF 2');
	await expect(page.locator(SEL.nextTitle)).toHaveText('Dungeon Meshi');
	await expect(page.locator(SEL.nextSub)).toHaveText('MANGA · 97 CHAPTERS · ALL DOWNLOADED · R→L');
	// One rating ask, as the paged path has.
	await expect(page.locator('.end .note')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Rate 1 of 10' })).toHaveCount(1);
	// The end page is over the text: a wheel up returns to it, and a wheel down
	// at the bottom ends it again -- the door a chapter too short to scroll has,
	// since such a chapter never fires onscroll.
	await page.mouse.move(640, 400);
	await page.mouse.wheel(0, -400);
	await expect(page.locator('[data-end-page]')).toHaveCount(0);
	await page.mouse.wheel(0, 400);
	await expect(page.locator('[data-end-page]')).toBeVisible();
});

test('an earlier part of a read run is not called the end of the Work', async ({ page }) => {
	await openEnd(page, 15);
	// Both parts are read, and this is part 1 of 2: the Work is read, but this
	// part is not where it ends, so the page is the series' own end page.
	await expect(page.getByText('THE WORK IS READ')).toHaveCount(0);
	await expect(page.locator(SEL.kicker)).toContainText('END · HIKARU GA SHINDA NATSU');
	await expect(page.locator(SEL.title)).toHaveText('Hikaru ga Shinda Natsu');
	await expect(page.locator(SEL.nextw)).toHaveCount(0);
	await expect(page.locator(SEL.foot)).toContainText('HIKARU RUN · WORK');
});

test('the last part says the Work is read, what it held, and WORK → where START was', async ({
	page
}) => {
	await openEnd(page, 21);
	await expect(page.getByText('THE WORK IS READ · 2 OF 2')).toBeVisible();
	await expect(page.locator(SEL.kicker)).toContainText('END · CHAINSAW MAN');
	await expect(page.locator(SEL.title)).toHaveText('Hikaru Run');
	const held = page.locator('.end .sub').first();
	await expect(held).toContainText('2 SERIES');
	await expect(held).toContainText('CHAPTERS');
	const row = page.locator('.end .wrow');
	await expect(row).toContainText('The run, from part 1');
	await expect(row).toContainText('WORK →');
	// No START: the run is read, and WORK → is where START was.
	await expect(page.locator(SEL.start)).toHaveCount(0);
	await expect(page.locator(SEL.foot)).toContainText('HIKARU RUN · WORK');
});

test('the rating is asked once: it sits below the block, and goes when rated', async ({ page }) => {
	await openEnd(page);
	await expect(page.locator(SEL.nextw)).toBeVisible();
	await expect(page.locator('.end .note')).toContainText('SHOWN WHILE UNRATED');
	await expect(page.locator('.end .note')).toContainText('OPENS ON A TAP, NEVER A SWIPE');
	const rate = page.getByRole('button', { name: 'Rate 8 of 10' });
	await expect(rate).toBeVisible();
	await rate.click();
	await expect(page.locator('.end .note')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Rate 8 of 10' })).toHaveCount(0);
});

test('the last episode ends on the Work: no countdown, and nothing plays by itself', async ({
	page,
	context
}) => {
	// Incognito, as the TV's player spec watches: nothing is written.
	await context.addCookies([{ name: 'tsundoku_incognito', value: '1', url: base }]);
	await page.goto(`${base}/read/${animeEpisode}`);
	await expect(page.locator('.player')).toBeVisible();
	const card = page.locator('.upn');
	await expect(card).toBeVisible({ timeout: 20_000 });
	await expect(card).toContainText('NEXT IN THE WORK · READ');
	await expect(card).toContainText('PART 2 OF 2');
	await expect(card).toContainText('Boku no Kokoro no Yabai Yatsu');
	await expect(card).toContainText('WORK · FRIEREN RUN');
	// The part's own line, built once: one dot, and the unit's.
	await expect(card.locator('.b').first()).toHaveText('MANGA · 160 CH. · IN PROGRESS');
	await expect(card.locator('.acc')).toContainText('▶ READ · CH. 1');
	await expect(card.getByRole('link', { name: 'WORK' })).toBeVisible();
	// The countdown is for episodes, never for another series.
	await expect(card).not.toContainText('PLAYS IN');
	const url = page.url();
	await page.waitForTimeout(6000);
	expect(page.url()).toBe(url);
});

test('a novel’s last volume is the same end page, so it offers the Work too', async ({ page }) => {
	// The text reader's own end (TextScreen) is the end of what is downloaded;
	// the last volume ends on the reader's end page (Work-End, "A novel's last
	// volume"), with one rating ask and the same block.
	await page.goto(`${base}/read/${lastEntry[20]}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	const forward = async () => {
		const v = page.viewportSize()!;
		await page.mouse.click(v.width - 8, v.height / 2);
	};
	for (let i = 0; i < 60; i++) {
		if (await page.locator('[data-end-page]').isVisible()) break;
		await forward();
	}
	const end = page.locator('[data-end-page]');
	await expect(end).toBeVisible();
	await expect(page.locator(SEL.kicker)).toContainText('NOVEL · CH. 15 OF 15');
	await expect(page.locator(SEL.nextw)).toBeVisible();
	await expect(page.locator(SEL.kickerLine)).toHaveText('NEXT IN KEN RUN · PART 2 OF 2');
	await expect(page.locator(SEL.nextTitle)).toHaveText('Sousou no Frieren');
	await expect(page.locator(SEL.nextSub)).toHaveText('MANGA · 140 CHAPTERS · ALL DOWNLOADED · R→L');
	// One ask: the rating row is below the block, and there is exactly one.
	await expect(page.locator('.end .note')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Rate 1 of 10' })).toHaveCount(1);
});
