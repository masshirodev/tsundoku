import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page, type Request } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, readerReady, test } from './helpers/hydrated';
import { E2E_TOKEN } from '../playwright.config';
import { revealOn as revealContext } from './helpers/reveal';

/**
 * The Works flow end to end (c276, c277, c278; doc/WORKS.md): browsing shows
 * the run as one tile and one CONTINUE row, finding shows the parts, /work/N
 * is the run's own screen, and W4's AS sheet is how a Work is made.
 *
 * Every case here groups series into a Work, and a Work takes its parts' own
 * tiles off the grid while it exists: a spec that finds a series by its grid
 * tile, running beside this file on the shared database, would time out
 * (round 2's finding -- tests/reader-flow.e2e.ts's `seriesId()` is the
 * arrangement that fails). So this runs on the seed's own arrangement, as the
 * works frames do (tests/works-library-frame.e2e.ts): a seeded database of its
 * own and a preview of the same build on its own port, which no other spec
 * sees. No title has to be kept from anyone, and a case that fails halfway
 * leaves the suite's database as it was.
 *
 * A case that changes a series still puts the value back: this file is also
 * the proof that a Work's grouping, name, rating and FAV end where they
 * started.
 */
// Measured, not guessed (doc/TESTING.md, "Load"; c439): alone at a load
// average of 15-31 the slowest case took 17.7 s, and in whole loaded runs two
// cases ran out the default 30 s, each in a page's load wait on this file's
// own server (`:170` at about 48, `:359` at 16-54). One red here also leaves
// the rest of the file unrun, since it is serial.
test.describe.configure({ mode: 'serial', timeout: 60_000 });

// Nothing outside this file needs the number: it seeds its own database and
// serves it here. A literal default is what two concurrent runs collide on.
const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-works-flow-${process.pid}.sqlite`);
const wipe = () => {
	for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
};
let server: ChildProcess | null = null;

// Every page in this file talks to this file's own preview, so `goto('/')` and
// `toHaveURL('/')` mean the seeded copy no other spec can see.
test.use({ baseURL: base });

test.beforeAll(async () => {
	// This hook seeds the file's own database and waits up to 60 s for its own
	// preview (below), which is past the default 30 s on a loaded box; in a
	// hook, test.setTimeout sets the hook's own budget (Playwright's test.d.ts,
	// "Changing timeout for a beforeAll"). Measured here on 2026-11-05 at a
	// 1-minute load average of about 10: the hook took 2.1 s (seed, spawn and
	// the first answer), the way work-end-frame's hook was measured (c599).
	test.setTimeout(120_000);
	wipe();
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-works-flow-empty-${process.pid}`),
			TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-works-flow-home-${process.pid}`)
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
	if (!up) throw new Error('the works flow preview never answered');
});

test.afterAll(() => {
	server?.kill();
	server = null;
	wipe();
});

// ---- Works (c276, c277, c278; doc/WORKS.md) ----------------------------------
// Browsing shows the run as one tile and one CONTINUE row; finding shows the
// series; /work/N is the run's own screen; GROUP AS A WORK makes one. Each
// test makes its Work and ends it again, and a series it writes to is put
// back, so the next case -- and the file's own proof at the end -- sees the
// seed.

const workTile = (page: Page, name: string) => page.locator('.grid .tile.work', { hasText: name });

/** A series tile by its exact title: "Kaori Mama" is a prefix of two others. */
const tileByTitle = (page: Page, title: string) =>
	page.locator('.grid .tile').filter({
		has: page.locator('.title', {
			hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
		})
	});

const groupSheet = (page: Page) => page.getByRole('dialog', { name: 'Group into a series' });

/** Selects these titles on the library, in this order. */
async function select(page: Page, titles: string[]) {
	await page.goto('/');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of titles)
		await page.locator('.grid .tile', { hasText: t }).locator('.open').click();
}

/**
 * Makes a Work of these titles through W4's AS sheet, and leaves the library
 * showing its band. The name is typed: titles that share no words have none.
 */
async function makeWork(page: Page, titles: string[], name: string) {
	await select(page, titles);
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await expect(sheet).toBeVisible();
	// A selection of singles or novels opens on BOOKS/VOLUMES; a Work is chosen.
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill(name);
	await sheet.getByRole('button', { name: /CREATE WORK · \d+ SERIES/ }).click();
	await expect(page.locator('.band', { hasText: `${name.toUpperCase()} IS A WORK` })).toBeVisible();
	await expect(workTile(page, name)).toBeVisible();
}

/** Opens a Work by its name from the library, and is on its screen. */
async function openWork(page: Page, name: string): Promise<number> {
	await workTile(page, name).click();
	await page.waitForURL(/\/work\/\d+/);
	return Number(/\/work\/(\d+)/.exec(page.url())![1]);
}

/**
 * Ends the Work on its own screen, so the seed is what the other cases expect.
 *
 * UNGROUP redirects to the library's `UNGROUPED · <NAME>` band. Until wave 20
 * (c439) this then asserted that no Work tile was left at all, which was
 * wrong both ways: read on the Work screen, before the redirect landed, it
 * passed with nothing ended (the screen has no grid); read on the library
 * while a second Work was still up (three cases end two in a row), it was
 * red, as in wave 19's loaded r2-tv1 (`a selection that touches two Works is
 * refused`, one `.grid .tile.work` found). It waits for the band, then asks
 * after this Work's tile alone.
 */
async function endWork(page: Page) {
	await expect(page).toHaveURL(/\/work\/\d+/);
	const name = (await page.title()).replace(/ · tsundoku$/, '');
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(
		page.locator('.band', { hasText: `UNGROUPED · ${name.toUpperCase()}` })
	).toBeVisible();
	await expect(
		page.locator('.grid .tile.work').getByRole('button', { name, exact: true })
	).toHaveCount(0);
}

/** Reveal on for this page, as `/reveal` does: hidden series become tiles that
 * say HIDDEN. Each test has its own context, so the cookie ends with it. */
async function revealOn(page: Page) {
	await revealContext(page.context());
}

test('a Work is one tile, one CONTINUE row, and a screen of its own', async ({ page }) => {
	// Two runs in progress, the newest read of them five minutes old: the
	// Work's CONTINUE row is the first one, and the section counts rows.
	await makeWork(
		page,
		['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Kusuriya no Hitorigoto'],
		'Drawing Run'
	);
	await openWork(page, 'Drawing Run');
	await expect(page.locator('.bar-title .t')).toHaveText('Drawing Run');
	await expect(page.locator('.bar-title .s')).toContainText('WORK · 2 SERIES');
	await expect(page.locator('.ident h1')).toHaveText('Drawing Run');
	await expect(page.locator('.ident .meta')).toHaveText('WORK · MANGA');
	await expect(page.locator('.ident .count').first()).toContainText('2 SERIES');

	// RENAME is a round trip: the same name, DONE, and a band -- nothing changed.
	await page.getByRole('button', { name: 'RENAME' }).click();
	await page.getByRole('textbox', { name: "The Work's name" }).fill('Drawing Run');
	await page.locator('.rename').getByRole('button', { name: 'DONE' }).click();
	await expect(page.locator('.band', { hasText: 'RENAMED · DRAWING RUN' })).toBeVisible();

	// CONTINUE across the Work opens the part CONTINUE opens for it.
	const cta = page.locator('.cta').first();
	await expect(cta).toContainText('PART 1');
	await expect(cta).toContainText('CH. 41');

	const rows = page.locator('.run .part');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText('Drawing: Saikyou Mangaka');
	await expect(rows.nth(1)).toContainText('Kusuriya no Hitorigoto');
	// The number cell is inverted on the part CONTINUE opens.
	await expect(rows.nth(0).locator('.no')).toHaveText(/^1\s*NOW$/);
	await expect(rows.nth(0).locator('.st')).toContainText('CH. 41 OF 58');
	await expect(rows.nth(1).locator('.no')).toHaveText(/^2\s*NEXT$/);

	// The library: one tile, its foot the run.
	await page.locator('a.back').click();
	await expect(page).toHaveURL('/');
	const tile = workTile(page, 'Drawing Run');
	await expect(tile).toBeVisible();
	await expect(tile.locator('.bdg.wb')).toHaveText('WORK · 2');
	await expect(tile.locator('.ft')).toContainText('PART 1 OF 2');
	// Online, a tile's ↓ is the device's cache, never the server's on-disk
	// count: both parts are downloaded on disk, but this browser has cached
	// none of them, so the Work wears no ↓ badge (round 2's finding).
	await expect(tile.locator('.badge.inverse')).toHaveCount(0);
	// The parts are not tiles of their own.
	await expect(page.locator('.grid .tile', { hasText: 'Kusuriya' })).toHaveCount(0);

	// One CONTINUE row for the run, never one per part.
	const cont = page.locator('.cont .row.work');
	await expect(cont).toHaveCount(1);
	await expect(cont).toContainText('WORK · PART 1');
	await expect(cont).toContainText('CH. 41');
	// The ▶ names the Work it resumes: a literal '{title}' would say the
	// placeholder, not the row's own title.
	await expect(cont.locator('.go')).toHaveAttribute('aria-label', 'Resume Drawing Run');

	// Finding opens the Work: its own name finds it first, its parts after.
	await page.goto('/search?q=Drawing');
	await expect(page.locator('.hit.work')).toContainText('WORK · 2 SERIES');
	await expect(page.locator('.hits .hit').first()).toContainText('Drawing Run');
	// A part found by its own name says which run it is in.
	await page.goto('/search?q=Kusuriya');
	await expect(page.locator('.hit', { hasText: 'Kusuriya' })).toContainText('PART 2 · DRAWING RUN');

	// UNGROUP ends it, and UNDO puts it back; then it ends for good.
	await page.goto('/');
	await tile.click();
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page).toHaveURL(/band=ungrouped/);
	const ungrouped = page.locator('.band', { hasText: 'UNGROUPED · DRAWING RUN' });
	await expect(ungrouped).toBeVisible();
	await expect(workTile(page, 'Drawing Run')).toHaveCount(0);
	await ungrouped.getByRole('button', { name: 'UNDO' }).click();
	await expect(workTile(page, 'Drawing Run')).toBeVisible();
	await workTile(page, 'Drawing Run').click();
	await endWork(page);
});

test('ORDER reorders the run, TAKE OUT of the second-to-last ends the Work, and UNDO restores it', async ({
	page
}) => {
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Isekai');
	await openWork(page, 'Isekai');
	// Part 1 is read through and part 2 never started: CONTINUE crosses, and
	// its row on the screen points at part 2's first chapter (the UP NEXT case).
	await expect(page.locator('.cta').first()).toContainText('PART 2 · CH. 1');
	const rows = page.locator('.run .part');
	await expect(rows.nth(0)).toContainText('Isekai Ojisan');

	// ORDER: focus a row and use the arrow keys, as the books grid does; DONE saves.
	await page.getByRole('button', { name: 'ORDER', exact: true }).click();
	await page.locator('.run .part .rowlink').first().focus();
	await page.keyboard.press('ArrowDown');
	await page.getByRole('button', { name: 'DONE' }).click();
	await expect(rows.nth(0)).toContainText('Isekai Yakkyoku');
	await page.reload();
	await expect(page.locator('.run .part').nth(0)).toContainText('Isekai Yakkyoku');

	// SELECT, take one out: the Work of two ends, and the library says so.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.run .part', { hasText: 'Isekai Ojisan' }).locator('.rowlink').click();
	await page.getByRole('button', { name: 'TAKE OUT' }).click();
	await expect(page).toHaveURL(/band=ended/);
	const ended = page.locator('.band', { hasText: 'ISEKAI IS NO LONGER A WORK' });
	await expect(ended).toBeVisible();
	await expect(ended).toContainText('ONE SERIES WAS LEFT');
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);

	// The library replaced the dead Work in history: BACK lands on the library,
	// never on /work/N (doc/NAVIGATION.md, "Screens that are gone"). Forward
	// returns to the band, whose UNDO is the next step.
	await page.goBack();
	expect(new URL(page.url()).pathname).toBe('/');
	expect(page.url()).not.toMatch(/\/work\/\d+/);
	await page.goForward();
	await expect(page.locator('.band', { hasText: 'ISEKAI IS NO LONGER A WORK' })).toBeVisible();

	// UNDO puts the Work back with its name and its order.
	await ended.getByRole('button', { name: 'UNDO' }).click();
	await expect(workTile(page, 'Isekai')).toBeVisible();
	await workTile(page, 'Isekai').click();
	await expect(page.locator('.run .part').nth(0)).toContainText('Isekai Yakkyoku');
	// Done with it: the Work ends for good.
	await endWork(page);
});

test('the TAKE OUT and ADD A SERIES bands name the series they moved', async ({ page }) => {
	// Three parts, so taking one out leaves a Work of two: the Work survives and
	// its own screen has to say which series left. The bands are built after
	// `update()` has re-read the lists the series used to be found in, so their
	// names come from the action's facts (round 2's finding).
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren', 'Isekai Ojisan'], 'Mushoku Run');
	await openWork(page, 'Mushoku Run');
	await expect(page.locator('.run .part')).toHaveCount(3);

	// Take one out; two are left, so the Work stays and the band names it.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.run .part', { hasText: 'Isekai Ojisan' }).locator('.rowlink').click();
	await page.getByRole('button', { name: 'TAKE OUT' }).click();
	const takenOut = page.locator('.band', { hasText: 'TAKEN OUT · ISEKAI OJISAN' });
	await expect(takenOut).toBeVisible();
	await expect(takenOut).toContainText('A SERIES ON ITS OWN AGAIN');
	await expect(page.locator('.run .part')).toHaveCount(2);

	// Add one: the sheet lists the library, and the band names what joined.
	await page.getByRole('button', { name: '+ ADD A SERIES' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add a series to this Work' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: /Dungeon Meshi/ }).click();
	const added = page.locator('.band', { hasText: 'ADDED · DUNGEON MESHI' });
	await expect(added).toBeVisible();
	await expect(added).toContainText('AT THE END OF THE RUN');
	await expect(page.locator('.run .part')).toHaveCount(3);

	// Done with it: the seed stays what the other specs expect.
	await endWork(page);
});

test('the ADD A SERIES picker asks once the typing pauses, not once a letter', async ({ page }) => {
	// A read per keystroke was seven `LIKE` scans over the library for one word
	// (round 2's finding); the sheet now asks 180ms behind the typing, the
	// library's own beat (doc/LIBRARY.md, "Search").
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren'], 'Mushoku Run');
	await openWork(page, 'Mushoku Run');
	const reads: string[] = [];
	page.on('request', (request) => {
		const { pathname } = new URL(request.url());
		if (/^\/work\/\d+\/addable$/.test(pathname)) reads.push(request.url());
	});
	await page.getByRole('button', { name: '+ ADD A SERIES' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add a series to this Work' });
	await expect(sheet).toBeVisible();
	// The open is immediate: one read before anything is typed.
	await expect.poll(() => reads.length).toBe(1);

	await sheet
		.getByRole('searchbox', { name: 'Find a series' })
		.pressSequentially('dungeon', { delay: 30 });
	await expect(sheet.getByRole('button', { name: /Dungeon Meshi/ })).toBeVisible();
	// Seven letters, one paused word: a second read at most (a slow machine can
	// split the word, and the seq guard drops the older answer either way).
	expect(reads.length).toBeLessThanOrEqual(2);

	await page.keyboard.press('Escape');
	await endWork(page);
});

test('a Work’s RATING and FAV are the parts’, set together while they agree, and RENAME undoes', async ({
	page
}) => {
	await makeWork(
		page,
		['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Hikaru ga Shinda Natsu'],
		'Drawing Run'
	);
	await openWork(page, 'Drawing Run');

	// Both parts are rated 8 and both are a favourite: the row is settable.
	await expect(page.locator('.rs .num')).toHaveText('8');
	await expect(page.locator('.fav')).toHaveAttribute('aria-pressed', 'true');

	// A set writes every part, and the row follows.
	await page.getByRole('button', { name: 'Rate 5 of 10' }).click();
	await expect(page.locator('.rs .num')).toHaveText('5');
	await page.locator('.fav').click();
	await expect(page.locator('.fav')).toHaveAttribute('aria-pressed', 'false');

	// Rate one part apart: the row shows the average and refuses to set.
	await page.goto('/');
	await page.goto('/search?q=Hikaru');
	await page.locator('.hit', { hasText: 'Hikaru ga Shinda Natsu' }).click();
	const seriesSheet = page.getByRole('dialog', { name: 'Hikaru ga Shinda Natsu' });
	await expect(seriesSheet).toBeVisible();
	await seriesSheet.getByRole('button', { name: 'Rate 8 of 10' }).click();
	await page.keyboard.press('Escape');
	// Back to the Work: it is on the library.
	await page.goto('/');
	const tile = workTile(page, 'Drawing Run');
	await tile.click();
	await expect(page.locator('.rs .lab-top')).toHaveText('PARTS DIFFER');
	await expect(page.getByRole('button', { name: 'Rate 5 of 10' })).toBeDisabled();

	// Put the part back, so the parts agree at 5 again, then write the seed's 8
	// through the Work's own row: one set writes every part. The case used to
	// end here with both series at 5 while claiming it had put the library
	// back (round 2's finding).
	await page.goto('/search?q=Hikaru');
	await page.locator('.hit', { hasText: 'Hikaru ga Shinda Natsu' }).click();
	await page
		.getByRole('dialog', { name: 'Hikaru ga Shinda Natsu' })
		.getByRole('button', { name: 'Rate 5 of 10' })
		.click();
	await page.keyboard.press('Escape');
	await page.goto('/');
	await workTile(page, 'Drawing Run').click();
	await expect(page.locator('.bar-title .t')).toHaveText('Drawing Run');
	await page.getByRole('button', { name: 'Rate 8 of 10' }).click();
	await expect(page.locator('.rs .num')).toHaveText('8');
	await page.locator('.fav').click();
	await expect(page.locator('.fav')).toHaveAttribute('aria-pressed', 'true');
	await endWork(page);

	// From outside: each part, found by its own name, is the seed's 8 again.
	for (const [q, title] of [
		['Drawing', 'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru'],
		['Hikaru', 'Hikaru ga Shinda Natsu']
	]) {
		await page.goto(`/search?q=${q}`);
		await page.locator('.hit', { hasText: title }).click();
		const sheet = page.getByRole('dialog', { name: title });
		await expect(sheet).toBeVisible();
		await expect(sheet.getByRole('button', { name: 'Rate 8 of 10' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.keyboard.press('Escape');
	}
});

test('a hidden Work is the same 404 as one that does not exist', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('HENTOID')).toHaveCount(0);

	// Reveal, so the hidden doujins are tiles, and make a Work of them.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	// A series of books and two singles: not one book series' to group, so the
	// AS row offers only a Work.
	for (const t of ['Kaori Mama', 'Kōhai no Himitsu Nikki', 'Onsen Ryokan no Yoru'])
		await tileByTitle(page, t).locator('.open').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Hidden Run');
	await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
	await expect(page.locator('.band', { hasText: 'HIDDEN RUN IS A WORK' })).toBeVisible();
	await workTile(page, 'Hidden Run').click();
	await page.waitForURL(/\/work\/\d+/);
	const hiddenWork = page.url();

	// Reveal off: the Work's own page is the 404 a missing id gets.
	await page.goto('/');
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	const res = await page.goto(hiddenWork);
	expect(res?.status()).toBe(404);
	const missing = await page.goto('/work/999999');
	expect(missing?.status()).toBe(404);

	// Reveal on again: the Work is one tile with HIDDEN. Then ungroup it.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	await expect(page).toHaveURL('/');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await expect(page.locator('.grid .tile.work', { hasText: 'HIDDEN' })).toHaveCount(1);
	await page.goto(hiddenWork);
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('page two of the grid is the same list as page one: a Work once, never its parts', async ({
	page
}) => {
	// Two series that share a word, so the Work is named 'Isekai' without a
	// rename, and neither part is a tile of its own anywhere on the shelf.
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Isekai');
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '6', url: 'http://localhost' }]);
	// A phone: three columns, so the first page's end is near and the row below
	// the grid stays on screen to be read.
	await page.setViewportSize({ width: 360, height: 400 });
	await page.goto('/?shelf=all&sort=title');
	const tiles = page.locator('.grid .tile');
	const more = page.locator('.more');
	await expect(more).toBeVisible();
	const total = Number(/OF (\d+)/.exec((await more.textContent()) ?? '')![1]);
	// Scroll the pages in, as a reader would.
	for (let i = 0; i < 20 && (await more.count()) > 0; i++) {
		await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
		await page.waitForTimeout(150);
	}
	await expect(more).toHaveCount(0);
	// The offset is in tiles, so every unit arrives once and in one order: the
	// old endpoint paged series under a tile count, which skipped series and
	// sent a Work's remaining parts back as their own cards.
	await expect(tiles).toHaveCount(total);
	await expect(page.locator('.grid .tile.work', { hasText: 'Isekai' })).toHaveCount(1);
	for (const part of ['Isekai Ojisan', 'Isekai Yakkyoku'])
		await expect(
			page.locator('.grid .tile').filter({
				has: page.locator('.title', { hasText: new RegExp(`^${part}$`) })
			})
		).toHaveCount(0);
	// Done with it: the seed stays the one the other specs expect.
	await page.locator('.grid .tile.work', { hasText: 'Isekai' }).click();
	await endWork(page);
});

test('SELECT ALL takes a Work’s every part, so a bulk HIDE asks and hides the run whole', async ({
	page
}) => {
	// The seed has no anime series (fixtures.ts), so this is the same shape with
	// a manhwa part off the kind shelf: the Work's face is the manga.
	await makeWork(
		page,
		[
			'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
			"Omniscient Reader's Viewpoint"
		],
		'Cover Run'
	);
	await workTile(page, 'Cover Run').click();
	await page.waitForURL(/\/work\/\d+/);
	const work = page.url().split('?')[0];
	// A page of six, sorted by title: the Work's own name sorts onto a later
	// page. Hold the pages after the first back until SELECT ALL has asked, so
	// the Work's tile is not among the cards the fast path expands: the ids
	// read is what must carry its manhwa part.
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '6', url: 'http://localhost' }]);
	const pages = (url: URL) => url.pathname === '/api/library' && !url.searchParams.has('ids');
	await page.route(pages, (route) => route.abort());
	await page.goto('/?shelf=k:manga&sort=title');
	await expect(page.locator('.more')).toContainText('THE REST');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await page.unroute(pages);
	await page.locator('.more').getByRole('button', { name: 'RETRY' }).click();
	const more = page.locator('.more');
	for (let i = 0; i < 20 && (await more.count()) > 0; i++) {
		await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
		await page.waitForTimeout(150);
	}
	// The tile is checked only when every part is selected. The manhwa part is
	// not on this shelf, so an old series-only read never selected it and the
	// tile stayed unchecked while HIDE took one part.
	const tile = page.locator('.grid .tile.work');
	await expect(tile).toHaveCount(1);
	await expect(tile.locator('.open')).toHaveAttribute('aria-pressed', 'true');
	// SELECT ALL selected the Work's every part -- the tile is checked only
	// when all of them are. HIDE acts on the selection, and a part of a Work
	// asks first (W4).
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(tile.locator('.open')).toHaveAttribute('aria-pressed', 'false');
	await tile.locator('.open').click();
	await expect(tile.locator('.open')).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	const hide = page.getByRole('dialog', { name: 'Hide' });
	await expect(hide).toBeVisible();
	await hide.getByRole('button', { name: /HIDE ALL 2/ }).click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })).toBeVisible();
	await page.locator('.band').getByRole('button', { name: 'UNDO' }).click();
	// UNDO ended the selection, and the Work is one tile again with nothing hidden.
	await expect(tile).toBeVisible();
	await expect(page.locator('.grid .tile.work')).toHaveCount(1);
	// Hide it again, for real this time: with reveal off the Work is the 404 a
	// missing id is.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.grid .tile.work').locator('.open').click();
	await expect(page.locator('.grid .tile.work').locator('.open')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(hide).toBeVisible();
	await hide.getByRole('button', { name: /HIDE ALL 2/ }).click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })).toBeVisible();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
	const res = await page.goto(work);
	expect(res?.status()).toBe(404);

	// Restore: reveal, unhide the Work's own parts, end it, hide again.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	await expect(page).toHaveURL('/');
	await page.goto('/?shelf=k:manga');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const revealed = page.locator('.grid .tile.work');
	await revealed.locator('.open').click();
	// UNHIDE on a part of a Work shows the Work whole (W4).
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(revealed.locator('.open')).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	// End the Work, then hide again.
	await revealed.click();
	await endWork(page);
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

/** Loads every page of the grid, so a refill is the only list request left. */
async function loadEveryPage(page: Page) {
	const more = page.locator('.more');
	for (let i = 0; i < 40 && (await more.count()) > 0; i++) {
		await more.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
		await page.waitForTimeout(150);
	}
	await expect(page.locator('.more')).toHaveCount(0);
}

/**
 * A refill: the pages after the first page of two, asked for in one go, not a
 * loadMore's own page (which always asks for the page size).
 */
const isRefill = (u: URL) =>
	u.pathname === '/api/library' &&
	!u.searchParams.has('ids') &&
	Number(u.searchParams.get('offset')) === 2 &&
	Number(u.searchParams.get('limit')) > 2;

/**
 * Every refill asked for from now on, in order, and a way to wait until the
 * grid has stopped asking for list pages -- so a count is the whole answer,
 * not the first request of it (the c615 helper's rule).
 */
function watchList(page: Page) {
	const seen: string[] = [];
	const inFlight = new Set<Request>();
	const isPage = (u: URL) => u.pathname === '/api/library' && !u.searchParams.has('ids');
	page.on('request', (r) => {
		const u = new URL(r.url());
		if (isPage(u)) inFlight.add(r);
		if (isRefill(u)) seen.push(u.search);
	});
	const done = (r: Request) => inFlight.delete(r);
	page.on('requestfinished', done);
	page.on('requestfailed', done);
	const settled = async () => {
		let quiet = 0;
		await expect
			.poll(() => (quiet = inFlight.size === 0 ? quiet + 1 : 0), {
				intervals: [250],
				timeout: 20_000
			})
			.toBeGreaterThanOrEqual(4);
	};
	return { refills: () => seen, reset: () => (seen.length = 0), settled };
}

test('HIDE ALL n and its UNDO read the loaded pages once each (c660)', async ({ page }) => {
	// The Work sorts first, so its tile is on the first page and HIDE asks
	// (a Work's parts are only known to the page through a tile it drew).
	// Both answers move the first page, which is the refill the load's own
	// re-read queues.
	await makeWork(
		page,
		[
			'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
			"Omniscient Reader's Viewpoint"
		],
		'Aaa Refill Run'
	);
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '2', url: 'http://localhost' }]);
	await page.goto('/?shelf=k:manga&sort=title');
	await loadEveryPage(page);
	const tile = page.locator('.grid .tile.work', { hasText: 'Aaa Refill Run' });
	await expect(tile).toHaveCount(1);

	const list = watchList(page);

	// HIDE ALL n from the sheet.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await tile.locator('.open').click();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	const hide = page.getByRole('dialog', { name: 'Hide' });
	await expect(hide).toBeVisible();
	await hide.getByRole('button', { name: /HIDE ALL 2/ }).click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })).toBeVisible();
	await expect(tile).toHaveCount(0);
	await list.settled();
	expect(list.refills()).toHaveLength(1);

	// Its UNDO puts it back, and reads the loaded pages once as well.
	list.reset();
	await page
		.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })
		.getByRole('button', { name: 'UNDO' })
		.click();
	await expect(tile).toBeVisible();
	await list.settled();
	expect(list.refills()).toHaveLength(1);

	// Done: end the Work, so the seed is what the other cases expect.
	await tile.click();
	await endWork(page);
});

test('a HIDE and an UNDO past the first page read the loaded pages once each too (c660)', async ({
	page
}) => {
	// The Work's name sorts last, so its tile lives in `more`: a HIDE past page
	// one changes nothing on page one, and only the loaded pages' own re-read
	// can take the tile out and bring it back. The bulk HIDE is the door a deep
	// tile has (its parts are not among the page's first-page feet).
	await makeWork(
		page,
		[
			'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
			"Omniscient Reader's Viewpoint"
		],
		'Zzz Refill Run'
	);
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '2', url: 'http://localhost' }]);
	await page.goto('/?shelf=k:manga&sort=title');
	await loadEveryPage(page);
	const tile = page.locator('.grid .tile.work', { hasText: 'Zzz Refill Run' });
	await expect(tile).toHaveCount(1);
	const at = await page
		.locator('.grid .tile')
		.evaluateAll(
			(els, name) => els.findIndex((el) => (el.textContent ?? '').includes(name)),
			'Zzz Refill Run'
		);
	expect(at).toBeGreaterThan(1);

	const list = watchList(page);

	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await tile.locator('.open').click();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();

	// A Work is hidden whole, so a deep tile's HIDE asks as well (W4). Asking
	// writes nothing and reads nothing: the one read below is the answer's.
	const hide = page.getByRole('dialog', { name: 'Hide' });
	await expect(hide.locator('.h-title .t')).toHaveText('HIDE 2 SERIES?');
	await expect(hide.locator('.h-title .s')).toHaveText('PART OF ZZZ REFILL RUN');
	await list.settled();
	expect(list.refills()).toHaveLength(0);
	await expect(tile).toHaveCount(1);

	await hide.getByRole('button', { name: 'HIDE ALL 2', exact: true }).click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })).toBeVisible();
	await expect(tile).toHaveCount(0);
	await list.settled();
	expect(list.refills()).toHaveLength(1);

	list.reset();
	await page
		.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })
		.getByRole('button', { name: 'UNDO' })
		.click();
	await expect(tile).toBeVisible();
	await list.settled();
	expect(list.refills()).toHaveLength(1);

	// Done: end the Work, so the seed is what the other cases expect. Answering
	// the sheet ended the selection, so a tap on the tile opens the Work.
	await expect(page.getByRole('button', { name: 'Stop selecting' })).toHaveCount(0);
	await tile.click();
	await endWork(page);
});

test('a URL band’s UNDO is a redirect, and the loaded pages are read once (c660, round 2)', async ({
	page
}) => {
	// Ending a Work of two on its screen with reveal off leaves the library
	// carrying the band in its URL: `?/undoWork` with `from=band` answers with a
	// redirect, and `update({ invalidateAll: false })` does not govern that --
	// applyAction sends it through `goto` with `invalidateAll`. The band lands
	// on the default shelf, so the redirect comes back to the same list: its
	// re-read must not refill the loaded pages a second time.
	const name = 'Zzz Redirect Run';
	await makeWork(
		page,
		[
			'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
			"Omniscient Reader's Viewpoint"
		],
		name
	);
	const id = await openWork(page, name);

	// A page of two, so the library has pages to load at all (the seed fits in
	// one at the grid's own size).
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '2', url: 'http://localhost' }]);
	await page.goto(`/work/${id}`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.run .part .rowlink').first().click();
	await page.getByRole('button', { name: 'TAKE OUT' }).click();
	await expect(page).toHaveURL(/band=ended/);
	const band = page.locator('.band', { hasText: `${name.toUpperCase()} IS NO LONGER A WORK` });
	await expect(band).toBeVisible();
	await expect(workTile(page, name)).toHaveCount(0);

	const list = watchList(page);
	// The load's own re-read, which the redirect's `goto` sends; the refills
	// above are the list's pages.
	let loads = 0;
	page.on('request', (r) => {
		if (new URL(r.url()).pathname.endsWith('/__data.json')) loads++;
	});
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(workTile(page, name)).toBeVisible();
	await list.settled();
	expect(list.refills()).toHaveLength(1);
	expect(loads).toBe(1);

	// Done: the Work is back, so end it and the seed is what the next case expects.
	await workTile(page, name).click();
	await page.waitForURL(/\/work\/\d+/);
	await endWork(page);
});

// ---- W4: GROUP AS A WORK, the person page, HIDE on a part (c278) ------------

test('GROUP AS A WORK from the library: the AS row, the name, the band and UNDO', async ({
	page
}) => {
	// Two doujin singletons: the AS row offers BOOKS as well, and a Work is the
	// answer chosen. The default name is the words every title starts with.
	await revealOn(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await tileByTitle(page, 'Kōhai no Himitsu Nikki').locator('.open').click();
	await tileByTitle(page, 'Onsen Ryokan no Yoru').locator('.open').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await expect(sheet).toBeVisible();
	// The AS row: what the selection allows, and what it becomes.
	await expect(sheet.getByRole('radio', { name: /ONE SERIES · BOOKS/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(sheet.getByRole('radio', { name: /A WORK · SERIES/ })).toHaveAttribute(
		'aria-checked',
		'false'
	);
	await expect(sheet.getByRole('button', { name: /CREATE SERIES/ })).toBeVisible();
	// A Work: NEW WORK, the name prompt, BY HAND first, numbered rows and the line.
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await expect(sheet.getByRole('radio', { name: /NEW WORK/ })).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'BY HAND', exact: true })).toHaveClass(/on/);
	await expect(sheet.locator('.keeps')).toContainText('EACH KEEPS ITS OWN');
	await expect(sheet.getByRole('textbox', { name: 'Work name' })).toHaveValue('');
	await expect(sheet.getByText('THE TITLES SHARE NO WORDS')).toBeVisible();
	await expect(sheet.getByRole('button', { name: /CREATE WORK/ })).toBeDisabled();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Onsen Run');
	await sheet.getByRole('button', { name: /CREATE WORK · 2 SERIES/ }).click();

	// The band is the answer, on the library the sheet was opened from.
	const band = page.locator('.band', { hasText: 'ONSEN RUN IS A WORK' });
	await expect(band).toBeVisible();
	await expect(band).toContainText('2 SERIES · EACH KEEPS ITS OWN');
	await expect(workTile(page, 'Onsen Run')).toBeVisible();
	// Both parts are off the grid: the Work is one tile over them.
	await expect(tileByTitle(page, 'Onsen Ryokan no Yoru')).toHaveCount(0);

	// UNDO takes the Work apart again, and both tiles come back.
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
	await expect(tileByTitle(page, 'Onsen Ryokan no Yoru')).toBeVisible();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
});

test('a person’s page groups its series into a Work, and says the run without pulling it in', async ({
	page
}) => {
	await revealOn(page);
	const circle = '/?tag=' + encodeURIComponent('circle:Hakka Kousha');
	await page.goto(circle);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.grid li', { hasText: 'Holiday Duty' }).getByRole('button').click();
	await page.locator('.grid li', { hasText: 'Illustrations 2024' }).getByRole('button').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Hakka Run');
	await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
	await expect(page.locator('.band', { hasText: 'HAKKA RUN IS A WORK' })).toBeVisible();

	// One row for the Work, above the grid: the run is said, not pulled in.
	const row = page.locator('.work-row', { hasText: 'Hakka Run' });
	await expect(row).toBeVisible();
	await expect(row).toContainText('2 OF 2 HERE');
	await expect(row).toContainText('UP NEXT:');
	// The page still holds the person's series as their own tiles.
	await expect(page.locator('.grid li', { hasText: 'Holiday Duty' })).toBeVisible();

	// OPEN is the Work's own screen; UNGROUP ends it and the row goes.
	await row.click();
	await page.waitForURL(/\/work\/\d+/);
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
	await page.goto(circle);
	await page.waitForLoadState('networkidle');
	await expect(page.locator('.work-row')).toHaveCount(0);
});

test('ADD TO A WORK puts a series at the end, and IN <WORK> · MOVES HERE moves one', async ({
	page
}) => {
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Isekai');
	// One more series, added through the sheet's existing Work.
	await select(page, ['Dungeon Meshi']);
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	let sheet = groupSheet(page);
	// A manga selection has one answer, and the sheet opens on it.
	await expect(sheet.getByRole('radio', { name: /A WORK · SERIES/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await sheet.getByRole('radio', { name: /ADD TO A WORK · 1/ }).click();
	await sheet.getByText('Isekai', { exact: true }).click();
	await sheet.getByRole('button', { name: /ADD 1 TO THE WORK/ }).click();
	const band = page.locator('.band', { hasText: 'ADDED TO ISEKAI' });
	await expect(band).toBeVisible();
	await expect(band).toContainText('1 SERIES · AT THE END OF THE RUN');
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.band', { hasText: 'ADDED TO ISEKAI' })).toHaveCount(0);
	await expect(workTile(page, 'Isekai')).toBeVisible();
	await openWork(page, 'Isekai');
	await expect(page.locator('.run .part')).toHaveCount(2);
	await page.goto('/');

	// A second Work, then one of its parts moved into the first: the row says
	// which Work it leaves, because a series belongs to one Work at most.
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren'], 'Mushoku Run');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await workTile(page, 'Mushoku Run').locator('.open').click();
	await tileByTitle(page, 'Dungeon Meshi').locator('.open').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await expect(sheet.locator('.gr', { hasText: 'Mushoku Tensei' })).toContainText(
		'IN MUSHOKU RUN · MOVES HERE'
	);
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Moved Run');
	await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
	await expect(page.locator('.band', { hasText: 'MOVED RUN IS A WORK' })).toBeVisible();
	// The moved Work was left with one series, so it ended: the band's UNDO puts
	// it back whole.
	await expect(workTile(page, 'Mushoku Run')).toHaveCount(0);
	await page.locator('.band').getByRole('button', { name: 'UNDO' }).click();
	await expect(workTile(page, 'Mushoku Run')).toBeVisible();
	await expect(workTile(page, 'Moved Run')).toHaveCount(0);

	// Done with them.
	for (const name of ['Isekai', 'Mushoku Run']) {
		await workTile(page, name).click();
		await page.waitForURL(/\/work\/\d+/);
		await endWork(page);
	}
});

test('HIDE on a part asks: the Work whole, or take it out and hide it', async ({ page }) => {
	await revealOn(page);
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Isekai');
	await openWork(page, 'Isekai');
	// The part's own screen, opened from the run: ← names the Work (W5). Part 2
	// is the one in progress, so the row is the plain WORK row, not the accent.
	await page.locator('.run .part .rowlink').nth(1).click();
	await page.waitForURL(/\/series\/\d+\?from=work/);
	await expect(page.locator('a.back .back-label')).toHaveText('ISEKAI');
	await expect(page.locator('.prow.work-row')).toBeVisible();

	// Every control that acts on the Work posts the Work it was drawn on (c640),
	// in the markup rather than added by script: a screen left open while the
	// series joined another Work refuses, and the next press posts the new one.
	const sheet = page.getByRole('dialog', { name: /WORK$/ });
	await page.locator('.prow.work-row .lk').click({ button: 'right' });
	await expect(sheet).toBeVisible();
	const workMade = await sheet.locator('form[action="?/moveWork"] input[name="made"]').inputValue();
	expect(workMade).toMatch(/^\d+$/);
	await expect(sheet.locator('form[action="?/takeOutWork"] input[name="made"]')).toHaveValue(
		workMade
	);
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);

	// The plain HIDE action is not a second door: posted for a part, it refuses
	// rather than leaving the Work hidden in one series.
	const here = new URL(page.url());
	here.search = '';
	const plain = await page.request.post(`${here.href}?/hide`, {
		form: { on: '1' },
		headers: { origin: here.origin }
	});
	const answer = (await plain.json()) as { type: string; status: number; data: string };
	expect(answer.type).toBe('failure');
	expect(answer.status).toBe(400);
	expect(answer.data).toContain('A WORK IS HIDDEN WHOLE');
	await expect(page.locator('.badge', { hasText: 'HIDDEN' })).toHaveCount(0);

	// HIDE on a part asks: the Work whole, or this series out of it.
	await page.locator('.file-row').getByRole('button', { name: 'HIDE' }).click();
	let hide = page.getByRole('dialog', { name: 'Hide' });
	await expect(hide).toBeVisible();
	await expect(hide).toContainText("IT'S PART 2 OF ISEKAI");
	await expect(hide.getByRole('button', { name: /HIDE ALL 2/ })).toBeVisible();
	await expect(hide.locator('form[action="?/hideWork"] input[name="made"]')).toHaveValue(workMade);
	await hide.getByRole('button', { name: 'TAKE OUT' }).click();
	// Taken out and hidden: it is its own series again, and the Work of one ended.
	const band = page.locator('.band', { hasText: 'HIDDEN · TAKEN OUT' });
	await expect(band).toBeVisible();
	await expect(page.locator('.prow.work-row')).toHaveCount(0);
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · TAKEN OUT' })).toHaveCount(0);
	await expect(page.locator('.prow.work-row')).toBeVisible();

	// HIDE ALL n hides the Work whole, and UNDO shows it again.
	await page.locator('.file-row').getByRole('button', { name: 'HIDE' }).click();
	hide = page.getByRole('dialog', { name: 'Hide' });
	await hide.getByRole('button', { name: /HIDE ALL 2/ }).click();
	const whole = page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' });
	await expect(whole).toBeVisible();
	await expect(whole).toContainText('2 SERIES');
	// UNHIDE shows the Work whole, and names the same Work: the screen's form
	// carries the moment it was drawn on, not one script looked up later.
	await expect(page.locator('form[action="?/showWork"] input[name="made"]')).toHaveValue(workMade);
	await whole.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.badge', { hasText: 'HIDDEN' })).toHaveCount(0);

	// Done: end the Work, and reveal off again.
	await page.goto('/');
	await workTile(page, 'Isekai').click();
	await endWork(page);
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
});

test('a Work control refused for a Work that moved on re-reads the screen, and the next press posts the new moment (c640)', async ({
	page,
	context
}) => {
	// The screen is drawn while the series is in Work A. In the owner's other
	// tab A ends, and the same two series make Work B, which takes A's id under
	// a new moment: the drawn screen's `made` now names no Work.
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Moved Run');
	const workId = await openWork(page, 'Moved Run');
	await page.locator('.run .part .rowlink').nth(1).click();
	await page.waitForURL(/\/series\/\d+\?from=work/);
	const sheet = page.getByRole('dialog', { name: /WORK$/ });
	await page.locator('.prow.work-row .lk').click({ button: 'right' });
	await expect(sheet).toBeVisible();
	// The sheet was drawn on this Work, and says so in its own markup.
	await expect(sheet.locator('a.lc')).toHaveAttribute('href', `/work/${workId}`);
	const old = await sheet.locator('form[action="?/moveWork"] input[name="made"]').inputValue();
	expect(old).toMatch(/^\d+$/);

	const other = await context.newPage();
	await other.goto('/');
	await openWork(other, 'Moved Run');
	await endWork(other);
	await makeWorkExact(other, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Moved Run');
	// The newer Work reuses the ended one's id: only their moments tell them apart.
	expect(await openWork(other, 'Moved Run')).toBe(workId);

	// MOVE is refused, and the band says why.
	await sheet.getByRole('button', { name: '↑', exact: true }).click();
	const refusal = page.locator('.band', { hasText: 'THAT WORK HAS CHANGED · LOOK AGAIN' });
	await expect(refusal).toBeVisible();
	await expect(refusal).toContainText('NOTHING CHANGED');
	// Nothing in the sheet can answer for the Work it was drawn on, so it closes.
	await expect(sheet).toHaveCount(0);

	// The page was read again: the row and its sheet are drawn from the Work
	// there is now, so the next press posts the new moment and goes through.
	await page.locator('.prow.work-row .lk').click({ button: 'right' });
	await expect(sheet).toBeVisible();
	const fresh = await sheet.locator('form[action="?/moveWork"] input[name="made"]').inputValue();
	expect(fresh).not.toBe(old);
	await sheet.getByRole('button', { name: '↑', exact: true }).click();
	await expect(refusal).toHaveCount(0);
	// It moved in the newer Work: part 2 is that Work's part 1 now.
	await other.goto(`/work/${workId}`);
	await expect(other.locator('.run .part').nth(0)).toContainText('Isekai Yakkyoku');
	await other.close();

	// Done with it: the seed has no Work.
	await page.goto(`/work/${workId}`);
	await endWork(page);
});

test('a stale HIDE ALL n and UNHIDE close the sheet and re-read the screen too (c640)', async ({
	page,
	context
}) => {
	// The same defect at the other two doors: the HIDE sheet's HIDE ALL n
	// (HideSheet's `after`) and the screen's UNHIDE (`replacingStale`). Each is
	// drawn on one Work, refused once that Work has moved on, and the screen
	// must be read again before the next press can post the new moment.
	await revealOn(page);
	const pair = ['Isekai Ojisan', 'Isekai Yakkyoku'];
	await makeWork(page, pair, 'Hidden Run');
	const workId = await openWork(page, 'Hidden Run');
	await page.locator('.run .part .rowlink').nth(1).click();
	await page.waitForURL(/\/series\/\d+\?from=work/);
	const hideButton = page.locator('.file-row').getByRole('button', { name: 'HIDE', exact: true });
	const hide = page.getByRole('dialog', { name: 'Hide' });
	const refusal = page.locator('.band', { hasText: 'THAT WORK HAS CHANGED · LOOK AGAIN' });
	const other = await context.newPage();

	await other.goto('/');
	await openWork(other, 'Hidden Run');
	await endWork(other);
	await makeWorkExact(other, pair, 'Hidden Run');
	expect(await openWork(other, 'Hidden Run')).toBe(workId);

	// HIDE ALL 2: refused, the sheet closes, and the screen is read again.
	await hideButton.click();
	await expect(hide).toBeVisible();
	const hideOld = await hide.locator('form[action="?/hideWork"] input[name="made"]').inputValue();
	expect(hideOld).toMatch(/^\d+$/);
	await hide.getByRole('button', { name: /HIDE ALL 2/ }).click();
	await expect(refusal).toBeVisible();
	await expect(hide).toHaveCount(0);
	await hideButton.click();
	await expect(hide).toBeVisible();
	await expect(hide.locator('form[action="?/hideWork"] input[name="made"]')).not.toHaveValue(
		hideOld
	);
	await hide.getByRole('button', { name: /HIDE ALL 2/ }).click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })).toBeVisible();

	// UNHIDE, drawn on that hidden Work, while the Work is replaced again.
	const unhide = page.locator('form[action="?/showWork"]');
	await expect(unhide).toBeVisible();
	const unhideOld = await unhide.locator('input[name="made"]').inputValue();
	await other.goto('/');
	await openWork(other, 'Hidden Run');
	await endWork(other);
	await makeWorkExact(other, pair, 'Hidden Run');
	await unhide.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(refusal).toBeVisible();
	// The page was read again: the form posts the Work there is now.
	await expect(unhide.locator('input[name="made"]')).not.toHaveValue(unhideOld);
	await unhide.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(page.locator('form[action="?/showWork"]')).toHaveCount(0);
	await expect(hideButton).toBeVisible();

	// Done: the Work ends, and both series are visible again as the seed has them.
	await other.close();
	await page.goto(`/work/${workId}`);
	await endWork(page);
});

test('a Work ended in another tab re-reads on MOVE and HIDE ALL n, and its row goes (c661)', async ({
	page,
	context
}) => {
	// The screen is drawn while the series is in a Work. In the owner's other
	// tab the Work ends, so the series is in no Work: the refusal before the
	// `made` check (c640) used to come back without `stale`, and no handler
	// re-read the page -- the sheet stayed open and the WORK row and UNHIDE
	// stayed drawn over a Work that no longer exists.
	const pair = ['Isekai Ojisan', 'Isekai Yakkyoku'];
	const other = await context.newPage();
	await makeWork(page, pair, 'Ended Run');
	await openWork(page, 'Ended Run');
	await page.locator('.run .part .rowlink').nth(1).click();
	await page.waitForURL(/\/series\/\d+\?from=work/);
	const seriesUrl = page.url();
	const sheet = page.getByRole('dialog', { name: /WORK$/ });
	const refusal = page.locator('.band', { hasText: 'THIS SERIES IS IN NO WORK' });

	// MOVE ↑, drawn on the Work another tab ends.
	await page.locator('.prow.work-row .lk').click({ button: 'right' });
	await expect(sheet).toBeVisible();
	await other.goto('/');
	await openWork(other, 'Ended Run');
	await endWork(other);
	await sheet.getByRole('button', { name: '↑', exact: true }).click();
	await expect(refusal).toBeVisible();
	await expect(refusal).toContainText('NOTHING CHANGED');
	// Nothing in the sheet can answer for a Work that is gone, so it closes,
	// and the screen is read again: the WORK row is not drawn any more.
	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.prow.work-row')).toHaveCount(0);
	await expect(page.locator('form[action="?/showWork"]')).toHaveCount(0);

	// HIDE ALL n, the sheet's own door: a fresh screen drawn on a new Work,
	// which the other tab ends before the press.
	await makeWorkExact(other, pair, 'Ended Again');
	await page.goto(seriesUrl);
	await expect(page.locator('.prow.work-row')).toHaveCount(1);
	await page.locator('.file-row').getByRole('button', { name: 'HIDE', exact: true }).click();
	const hide = page.getByRole('dialog', { name: 'Hide' });
	await expect(hide).toBeVisible();
	await other.goto('/');
	await openWork(other, 'Ended Again');
	await endWork(other);
	await hide.getByRole('button', { name: /HIDE ALL 2/ }).click();
	await expect(refusal).toBeVisible();
	await expect(hide).toHaveCount(0);
	await expect(page.locator('.prow.work-row')).toHaveCount(0);

	// Done: both Works are gone, and the pair is visible as the seed has it.
	await other.close();
});

test('a selection that touches two Works is refused: SELECT ALL cannot collapse them', async ({
	page
}) => {
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Isekai');
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren'], 'Mushoku Run');

	// SELECT ALL touches both Works, so the sheet's own door refuses: one Work
	// swallowing another is the collapse the stopgap refused.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Everything');
	await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
	await expect(sheet.locator('.refused')).toContainText('A WORK KEEPS ITS PARTS');
	// Both Works are still one tile each, untouched.
	await expect(page.locator('.grid .tile.work')).toHaveCount(2);
	await sheet.getByRole('button', { name: 'CANCEL' }).click();

	// Done with them.
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	for (const name of ['Isekai', 'Mushoku Run']) {
		await workTile(page, name).click();
		await page.waitForURL(/\/work\/\d+/);
		await endWork(page);
	}
});

// ---- W4 round 2: ADD TO EXISTING's target, TAKE OUT's band, UNHIDE ----------

test('ADD TO EXISTING on volumes starts on the series of volumes, not on a Work', async ({
	page
}) => {
	// A Work exists, which is the library's normal state after W4. With the old
	// target the sheet would start on the Work's id -- a small integer, like a
	// series' -- so no volume was checked and ADD posted nothing at all.
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Isekai');

	// A series of volumes to add to: two of the seed's four novels.
	await page.goto('/?shelf=k:novel&sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of ['Mushoku Tensei', 'Honzuki no Gekokujou'])
		await page.locator('.grid .tile', { hasText: t }).locator('.open').click();
	await page.getByRole('button', { name: /GROUP/ }).click();
	let sheet = groupSheet(page);
	await expect(sheet.getByText('GROUP 2 VOLUMES')).toBeVisible();
	await sheet.getByRole('textbox', { name: 'Series name' }).fill('Two Novels');
	await sheet.getByRole('button', { name: /CREATE SERIES · 2 VOLUMES/ }).click();
	await page.waitForURL(/\/series\/\d+\?created=2/);
	const volumes = page.url().replace(/\?.*$/, '');

	// The other two novels, onto the end of it.
	await page.goto('/?shelf=k:novel&sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of ['Villainess Level 99', 'Tensei Shitara Ken Deshita'])
		await page.locator('.grid .tile', { hasText: t }).locator('.open').click();
	await page.getByRole('button', { name: /GROUP/ }).click();
	sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /ADD TO EXISTING · 1/ }).click();
	// The target is the series of volumes, and it arrives already chosen.
	await expect(sheet.getByRole('radio', { name: /Two Novels/ })).toBeChecked();
	await sheet.getByRole('button', { name: /ADD 2 VOLUMES/ }).click();
	await expect(page.getByText('2 VOLUMES ADDED')).toBeVisible();
	await expect(page.getByText('AT THE END · ORDER TO CHANGE')).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`^${volumes}\\?`));

	// Restore: the volumes back out on their own, and the Work ended.
	await page.goto(volumes);
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await page.waitForURL(/\/\?sort=added/);
	await page.goto('/');
	await workTile(page, 'Isekai').click();
	await page.waitForURL(/\/work\/\d+/);
	await endWork(page);
});

test('ADD TO EXISTING on books starts on the series of books, not on a Work', async ({ page }) => {
	// A Work first: the same small-integer collision, now for books, where the
	// old target could even pre-check an unrelated doujin series.
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Isekai');

	// A series of books to add to: the seed's doujin are all singletons, so it
	// is made the way the owner would.
	await page.goto('/?shelf=k:doujin&sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of ['Hoshi no Umi no Tabibito', 'Natsu no Owari ni Kimi to'])
		await page.locator('.grid .tile', { hasText: t }).locator('.open').click();
	await page.getByRole('button', { name: /GROUP/ }).click();
	let sheet = groupSheet(page);
	await expect(sheet.getByText('GROUP 2 BOOKS')).toBeVisible();
	await sheet.getByRole('textbox', { name: 'Series name' }).fill('Quiet Books');
	await sheet.getByRole('button', { name: /CREATE SERIES · 2 BOOKS/ }).click();
	await page.waitForURL(/\/series\/\d+\?created=2/);
	const books = page.url().replace(/\?.*$/, '');

	// Two more singletons, into it.
	await page.goto('/?shelf=k:doujin&sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of ['Ame no Hi no Toshokan', 'Sekai no Owari no Kissaten'])
		await page.locator('.grid .tile', { hasText: t }).locator('.open').click();
	await page.getByRole('button', { name: /GROUP/ }).click();
	sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /ADD TO EXISTING · 1/ }).click();
	await expect(sheet.getByRole('radio', { name: /Quiet Books/ })).toBeChecked();
	await sheet.getByRole('button', { name: /ADD 2 BOOKS/ }).click();
	await expect(page.getByText('2 BOOKS ADDED')).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`^${books}\\?`));

	// Restore: the books back out, and the Work ended.
	await page.goto(books);
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await page.waitForURL(/\/\?sort=added/);
	await page.goto('/');
	await workTile(page, 'Isekai').click();
	await page.waitForURL(/\/work\/\d+/);
	await endWork(page);
});

test('TAKE OUT with reveal off says the series left, not that the Work was hidden whole', async ({
	page
}) => {
	// A Work of three: taking one part out leaves two, so the Work is still the
	// shelf's and only that series was hidden.
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku', 'Dungeon Meshi'], 'Three Run');
	await openWork(page, 'Three Run');
	await page.locator('.run .part .rowlink').nth(1).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.locator('.file-row').getByRole('button', { name: 'HIDE' }).click();
	const hide = page.getByRole('dialog', { name: 'Hide' });
	await expect(hide).toBeVisible();
	await hide.getByRole('button', { name: 'TAKE OUT' }).click();

	// Reveal off: the screen is gone, and the library says what was done. It
	// was not the Work, whole -- the other two parts are still on the shelf.
	await expect(page).toHaveURL(/\/\?.*band=taken-out/);
	const band = page.locator('.band', { hasText: 'HIDDEN · TAKEN OUT' });
	await expect(band).toBeVisible();
	await expect(band).toContainText('A SERIES ON ITS OWN AGAIN');
	await expect(band).toContainText('SHOWN AGAIN BY UNDO');
	await expect(workTile(page, 'Three Run')).toBeVisible();
	await expect(tileByTitle(page, 'Dungeon Meshi')).toHaveCount(0);

	// UNDO puts the part back into the run.
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · TAKEN OUT' })).toHaveCount(0);
	await openWork(page, 'Three Run');
	await expect(page.locator('.run .part')).toHaveCount(3);
	await endWork(page);

	// A Work of two: taking one out ends it, and the band says so.
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Two Run');
	await openWork(page, 'Two Run');
	await page.locator('.run .part .rowlink').nth(1).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.locator('.file-row').getByRole('button', { name: 'HIDE' }).click();
	await page
		.getByRole('dialog', { name: 'Hide' })
		.getByRole('button', { name: 'TAKE OUT' })
		.click();
	await expect(page).toHaveURL(/\/\?.*band=taken-out/);
	const ended = page.locator('.band', { hasText: 'HIDDEN · TAKEN OUT' });
	await expect(ended).toBeVisible();
	await expect(ended).toContainText('TWO RUN IS NO LONGER A WORK');
	await expect(workTile(page, 'Two Run')).toHaveCount(0);
	// The series left behind is its own tile again.
	await expect(tileByTitle(page, 'Isekai Ojisan')).toBeVisible();

	// UNDO restores the run whole; then it ends for good.
	await ended.getByRole('button', { name: 'UNDO' }).click();
	await expect(workTile(page, 'Two Run')).toBeVisible();
	await openWork(page, 'Two Run');
	await endWork(page);
});

test('UNHIDE on one part of a hidden Work shows the Work whole', async ({ page }) => {
	// The seed's book shop is a hidden root, so these two are hidden already:
	// the Work made of them is a hidden Work, and its parts are selectable tiles
	// of their own here (a shelf draws the Work as one card instead).
	await revealOn(page);
	const circle = '/?tag=' + encodeURIComponent('circle:Hakka Kousha');
	const parts = [/Holiday Duty/, /Illustrations 2024/];
	const tile = (title: RegExp) =>
		page.locator('.grid li').filter({ has: page.locator('.title', { hasText: title }) });
	await page.goto(circle);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of parts) await tile(t).getByRole('button').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Duty Run');
	await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
	await expect(page.locator('.band', { hasText: 'DUTY RUN IS A WORK' })).toBeVisible();

	// ONE part of the hidden Work selected: UNHIDE shows the run whole, never
	// one part among hidden ones.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await tile(/Holiday Duty/)
		.getByRole('button')
		.click();
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	const shown = page.locator('.band', { hasText: 'SHOWN · THE WORK, WHOLE' });
	await expect(shown).toBeVisible();
	await expect(shown).toContainText('2 SERIES · HIDDEN AGAIN BY UNDO');
	await expect(shown.getByRole('button', { name: 'UNDO' })).toBeVisible();

	// The proof is on the shelf: the Work's own tile, with no HIDDEN mark. The
	// old write left the other part hidden, so the tile kept it.
	await page.goto('/?shelf=k:doujin');
	const run = page.locator('.grid .tile.work', { hasText: 'Duty Run' });
	await expect(run).toBeVisible();
	await expect(run.locator('.badge', { hasText: 'HIDDEN' })).toHaveCount(0);

	// Back to the seed: the run hidden whole again, then ended and reveal off.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await run.locator('.open').click();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Hide' })
		.getByRole('button', { name: /HIDE ALL 2/ })
		.click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })).toBeVisible();
	await run.click();
	await page.waitForURL(/\/work\/\d+/);
	await endWork(page);
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
});

test('UNDO after UNHIDE hides the Work whole again', async ({ page }) => {
	await revealOn(page);
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Undo Run');
	await page.goto('/?shelf=k:manga');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const run = page.locator('.grid .tile.work', { hasText: 'Undo Run' });
	await run.locator('.open').click();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Hide' })
		.getByRole('button', { name: /HIDE ALL 2/ })
		.click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })).toBeVisible();

	// UNHIDE, then its UNDO: shown whole, hidden whole again.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await run.locator('.open').click();
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	const shown = page.locator('.band', { hasText: 'SHOWN · THE WORK, WHOLE' });
	await expect(shown).toContainText('2 SERIES · HIDDEN AGAIN BY UNDO');
	await shown.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.band', { hasText: 'SHOWN · THE WORK, WHOLE' })).toHaveCount(0);
	await expect(run.locator('.badge', { hasText: 'HIDDEN' })).toBeVisible();

	// Shown again, so the seed is what the next case expects, and ended.
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(run.locator('.badge', { hasText: 'HIDDEN' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await run.click();
	await page.waitForURL(/\/work\/\d+/);
	await endWork(page);
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
});

// ---- Wave 16: the one rule at every door that writes `hidden` --------------

/** The ids of a Work's parts, in its order, read from its own screen's run. */
async function partIds(page: Page, workUrl: string): Promise<number[]> {
	await page.goto(workUrl);
	const hrefs = await page
		.locator('.run .part .rowlink')
		.evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
	return hrefs.map((h) => Number(/\/series\/(\d+)/.exec(h)![1]));
}

/** Whether each series is hidden, as the series sheet reads it (`/api/series/N`, reveal on). */
async function hiddenOf(page: Page, ids: number[]): Promise<boolean[]> {
	return Promise.all(
		ids.map(async (id) => {
			const res = await page.request.get(`/api/series/${id}`);
			expect(res.ok()).toBe(true);
			return ((await res.json()) as { hidden: boolean }).hidden;
		})
	);
}

test('the search sheet’s HIDE on a part hides its Work whole, and UNHIDE shows it whole', async ({
	page
}) => {
	// The door wave 14's review reproduced: the search page opens the library's
	// series sheet on any hit, a Work's part included, and its HIDE posts the
	// library's plain ?/hide. Reached here through the app from the seed.
	await revealOn(page);
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Sheet Run');
	const workId = await openWork(page, 'Sheet Run');
	const parts = await partIds(page, `/work/${workId}`);
	expect(parts).toHaveLength(2);
	expect(await hiddenOf(page, parts)).toEqual([false, false]);

	// Search a part, open its hit's sheet: the cell says what HIDE takes.
	await page.goto('/search?q=' + encodeURIComponent('Isekai Yakkyoku'));
	const hit = page.locator('.hits .hit:not(.work)', { hasText: 'Isekai Yakkyoku' });
	await expect(hit).toContainText('· SHEET RUN');
	await hit.click();
	let sheet = page.getByRole('dialog', { name: 'Isekai Yakkyoku' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: 'HIDE ALL 2', exact: true }).click();
	// The band, at once, in the library's words (c391): before, the search page
	// dropped the answer, and a press that hid two series had no UNDO.
	let band = page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' });
	await expect(band).toBeVisible();
	await expect(band).toContainText('2 SERIES · SHOWN AGAIN BY UNDO');
	await expect(sheet).toHaveCount(0);
	// The Work went whole: both parts hidden, not the one the sheet was open on.
	await expect.poll(() => hiddenOf(page, parts)).toEqual([true, true]);

	// UNDO responds: the Work is shown again, whole, and the band goes.
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(band).toHaveCount(0);
	await expect.poll(() => hiddenOf(page, parts)).toEqual([false, false]);
	await expect(page).toHaveURL(/\/search\?q=/);

	// Hide it again, then UNHIDE through the same sheet: the Work back whole.
	await page.locator('.hits .hit:not(.work)', { hasText: 'Isekai Yakkyoku' }).click();
	sheet = page.getByRole('dialog', { name: 'Isekai Yakkyoku' });
	await sheet.getByRole('button', { name: 'HIDE ALL 2', exact: true }).click();
	await expect(band).toBeVisible();
	await expect.poll(() => hiddenOf(page, parts)).toEqual([true, true]);
	await page.goto('/search?q=' + encodeURIComponent('Isekai Yakkyoku'));
	// A new page: the band belonged to the press, not to the search.
	await expect(band).toHaveCount(0);
	await page.locator('.hits .hit:not(.work)', { hasText: 'Isekai Yakkyoku' }).click();
	sheet = page.getByRole('dialog', { name: 'Isekai Yakkyoku' });
	await sheet.getByRole('button', { name: 'UNHIDE ALL 2', exact: true }).click();
	band = page.locator('.band', { hasText: 'SHOWN · THE WORK, WHOLE' });
	await expect(band).toBeVisible();
	await expect(band).toContainText('2 SERIES · HIDDEN AGAIN BY UNDO');
	await expect(sheet).toHaveCount(0);
	await expect.poll(() => hiddenOf(page, parts)).toEqual([false, false]);
	// Its UNDO hides the Work again; a last UNHIDE puts the seed back.
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(band).toHaveCount(0);
	await expect.poll(() => hiddenOf(page, parts)).toEqual([true, true]);
	await page.locator('.hits .hit:not(.work)', { hasText: 'Isekai Yakkyoku' }).click();
	sheet = page.getByRole('dialog', { name: 'Isekai Yakkyoku' });
	await sheet.getByRole('button', { name: 'UNHIDE ALL 2', exact: true }).click();
	await expect.poll(() => hiddenOf(page, parts)).toEqual([false, false]);

	// Put it back: the Work ended, nothing hidden.
	await page.goto(`/work/${workId}`);
	await endWork(page);
	expect(await hiddenOf(page, parts)).toEqual([false, false]);
});

test('HIDE ALL n on a half-hidden Work settles it hidden, and offers no UNDO that would show a hidden part (c390, c391)', async ({
	page
}) => {
	// A Work one of whose parts is hidden on its own: no door the app offers
	// makes this any more, but an import's fold did until c389, so a library
	// can hold one. It is written here as the fold left it, in the database.
	await revealOn(page);
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Mixed Run');
	const workId = await openWork(page, 'Mixed Run');
	const parts = await partIds(page, `/work/${workId}`);
	const first = (await (await page.request.get(`/api/series/${parts[0]}`)).json()) as {
		title: string;
	};
	const [shownPart, hiddenPart] = first.title === 'Isekai Ojisan' ? parts : [...parts].reverse();
	const db = new Database(dbPath);
	db.prepare(`UPDATE series SET hidden = 1, public = 0 WHERE id = ?`).run(hiddenPart);
	db.close();
	expect(await hiddenOf(page, [shownPart, hiddenPart])).toEqual([false, true]);

	// The visible part's sheet, from search: HIDE ALL 2 settles the Work hidden.
	await page.goto('/search?q=' + encodeURIComponent('Isekai Ojisan'));
	await page.locator('.hits .hit:not(.work)', { hasText: 'Isekai Ojisan' }).click();
	const sheet = page.getByRole('dialog', { name: 'Isekai Ojisan' });
	await sheet.getByRole('button', { name: 'HIDE ALL 2', exact: true }).click();
	await expect(sheet).toHaveCount(0);
	await expect.poll(() => hiddenOf(page, [shownPart, hiddenPart])).toEqual([true, true]);
	// No band (reveal's own, HIDDEN SHOWN, aside): its UNDO could only leave
	// the Work half-hidden again, or show the part the owner had hidden --
	// before c390 it showed both.
	await expect(page.locator('.band', { hasText: 'THE WORK, WHOLE' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'UNDO' })).toHaveCount(0);

	// Put it back: the Work shown whole, then ended.
	await page.locator('.hits .hit:not(.work)', { hasText: 'Isekai Ojisan' }).click();
	await page
		.getByRole('dialog', { name: 'Isekai Ojisan' })
		.getByRole('button', { name: 'UNHIDE ALL 2', exact: true })
		.click();
	await expect.poll(() => hiddenOf(page, [shownPart, hiddenPart])).toEqual([false, false]);
	await page.goto(`/work/${workId}`);
	await endWork(page);
});

test('UNDO of a TAKE OUT refuses once the series has joined another Work, and leaves both whole (c308)', async ({
	page,
	context
}) => {
	// The interleaving W4 made reachable: the Work screen's band and its UNDO
	// stay up while, in another tab, the owner groups the series it took out.
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren', 'Isekai Ojisan'], 'Undo Run');
	const runId = await openWork(page, 'Undo Run');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.run .part', { hasText: 'Isekai Ojisan' }).locator('.rowlink').click();
	await page.getByRole('button', { name: 'TAKE OUT' }).click();
	const takenOut = page.locator('.band', { hasText: 'TAKEN OUT · ISEKAI OJISAN' });
	await expect(takenOut).toBeVisible();

	const other = await context.newPage();
	await makeWork(other, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Other Run');
	const otherId = await openWork(other, 'Other Run');

	// Before c308, this UNDO's INSERT OR REPLACE took Isekai Ojisan out of
	// Other Run without ending it: a Work of one, for good.
	await takenOut.getByRole('button', { name: 'UNDO' }).click();
	const refused = page.locator('.band', { hasText: 'ISEKAI OJISAN IS IN OTHER RUN NOW' });
	await expect(refused).toBeVisible();
	await expect(refused).toContainText('NOTHING CHANGED');
	await expect(page.locator('.run .part')).toHaveCount(2);
	expect(await partIds(other, `/work/${otherId}`)).toHaveLength(2);
	await expect(other.locator('.run .part', { hasText: 'Isekai Ojisan' })).toHaveCount(1);

	// Put both back: the seed has no Work.
	await endWork(other);
	await page.goto(`/work/${runId}`);
	await endWork(page);
});

test('every library door that hides by id takes a part’s Work whole, both ways', async ({
	page
}) => {
	// The class, not the site: `?/hide` (the series sheet's) and `?/bulk`'s
	// HIDE / UNHIDE (the bar's, for a selection it thinks is Work-free) each
	// get one part's id, by hand, and each must leave the Work whole.
	await revealOn(page);
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Door Run');
	const id = await openWork(page, 'Door Run');
	const parts = await partIds(page, `/work/${id}`);
	const post = async (action: string, form: Record<string, string>) => {
		const res = await page.request.post(`/?/${action}`, {
			form,
			headers: { origin: new URL(page.url()).origin }
		});
		const answer = (await res.json()) as { type: string; data: string };
		expect(answer.type).toBe('success');
		return answer.data;
	};

	// ?/hide with the second part's id, on: the Work hidden whole, and the
	// answer is the library's HIDE band (the Work, both its series).
	const hid = await post('hide', { id: String(parts[1]), on: '1' });
	expect(hid).toContain('hideFacts');
	expect(await hiddenOf(page, parts)).toEqual([true, true]);
	// ... and off: shown whole.
	const shown = await post('hide', { id: String(parts[0]), on: '0' });
	expect(shown).toContain('showFacts');
	expect(await hiddenOf(page, parts)).toEqual([false, false]);

	// ?/bulk do=hide / do=unhide with one part: the same rule.
	await post('bulk', { id: String(parts[0]), do: 'hide' });
	expect(await hiddenOf(page, parts)).toEqual([true, true]);
	await post('bulk', { id: String(parts[1]), do: 'unhide' });
	expect(await hiddenOf(page, parts)).toEqual([false, false]);

	// A series in no Work is hidden and shown on its own, as before, with no band.
	await page.goto(`/work/${id}`);
	await endWork(page);
	const plain = await post('hide', { id: String(parts[0]), on: '1' });
	expect(plain).not.toContain('hideFacts');
	expect(await hiddenOf(page, parts)).toEqual([true, false]);
	await post('hide', { id: String(parts[0]), on: '0' });
	expect(await hiddenOf(page, parts)).toEqual([false, false]);
});

test('a bulk HIDE over two Works says 2 WORKS, WHOLE and keeps the loose series apart', async ({
	page
}) => {
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'First Run');
	await makeWork(page, ['Sousou no Frieren', 'Dungeon Meshi'], 'Second Run');
	// SELECT ALL over the manga shelf: two Works, and the shelf's series in none.
	await page.goto('/?shelf=k:manga');
	await expect(page.locator('.grid .tile.work')).toHaveCount(2);
	const loose = await page.locator('.grid .tile:not(.work)').count();
	expect(loose).toBeGreaterThan(0);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	const hide = page.getByRole('dialog', { name: 'Hide' });
	await expect(hide).toContainText('PART OF 2 WORKS');
	await hide.getByRole('button', { name: /HIDE ALL \d+/ }).click();
	// One band for two Works: their count in the title, their four series in
	// the detail, and the loose series named apart rather than counted in.
	const band = page.locator('.band', { hasText: 'HIDDEN · 2 WORKS, WHOLE' });
	await expect(band).toBeVisible();
	await expect(band).toContainText(
		`4 SERIES · ${loose} MORE ON ${loose === 1 ? 'ITS' : 'THEIR'} OWN · SHOWN AGAIN BY UNDO`
	);
	await expect(page.locator('.band', { hasText: 'THE WORK, WHOLE' })).toHaveCount(0);

	// UNDO shows everything again; then both Works end, and the seed is back.
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(2);
	await expect(page.locator('.grid .tile:not(.work)')).toHaveCount(loose);
	for (const name of ['First Run', 'Second Run']) {
		await page.goto('/?shelf=k:manga');
		await openWork(page, name);
		// Not endWork: it waits for a grid with no Work, and the other is still one.
		await page.getByRole('button', { name: 'UNGROUP' }).click();
		await expect(page).toHaveURL(/band=ungrouped/);
	}
	await page.goto('/?shelf=k:manga');
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

/**
 * c469 (wave 19's Gap 2): a refusal from a band's UNDO came back as the
 * library's `workMessage`, which the page drew only inside the bulk bar, so
 * with SELECT off nothing said why the band just stayed. Reached through the
 * app: GROUP AS A WORK's band is up in one tab while the other takes a part
 * out on the Work's screen, which ends the Work; the band's UNDO then refuses.
 */
test('a refused UNDO on the library says why with no selection open (c469)', async ({
	page,
	context
}) => {
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren'], 'Refused Run');
	const made = page.locator('.band', { hasText: 'REFUSED RUN IS A WORK' });
	// The create ended the selection: the refusal has no bulk bar to stand over.
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toBeVisible();

	const other = await context.newPage();
	await other.goto('/');
	await openWork(other, 'Refused Run');
	await other.getByRole('button', { name: 'SELECT', exact: true }).click();
	await other.locator('.run .part', { hasText: 'Sousou no Frieren' }).locator('.rowlink').click();
	await other.getByRole('button', { name: 'TAKE OUT' }).click();
	await expect(
		other.locator('.band', { hasText: 'REFUSED RUN IS NO LONGER A WORK' })
	).toBeVisible();
	await other.close();

	await made.getByRole('button', { name: 'UNDO' }).click();
	const refusal = page.locator('.band', { hasText: 'REFUSED RUN HAS CHANGED SINCE IT WAS MADE' });
	await expect(refusal).toBeVisible();
	await expect(refusal).toContainText('NOTHING CHANGED');
	await expect(page.locator('.fold-refused')).toHaveCount(0);
	// The take-out ended the Work, so nothing is left to put back.
	await expect(workTile(page, 'Refused Run')).toHaveCount(0);

	// The owner moves on (c469's round 2): SELECT does not carry the refusal
	// into the bar, and ✕ does not bring the band back. `form` still holds the
	// answer all along, which is what both used to draw from.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop selecting' })).toBeVisible();
	await expect(refusal).toHaveCount(0);
	await expect(page.locator('.fold-refused')).toHaveCount(0);
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toBeVisible();
	await expect(refusal).toHaveCount(0);
	await expect(page.locator('.lib-band .band')).toHaveCount(0);
});

/**
 * c469's round 3: the bands stay drawn while a selection is open, so their
 * UNDO can be pressed then too, and its refusal has to be said there as well.
 * The refusal band used to be gated on `!selecting`, so a refusal pressed
 * under SELECT showed nowhere and UNDO looked as if it had worked. Reached
 * through the app as the case above: GROUP's band is up in one tab while the
 * other takes a part out and ends the Work, but here SELECT is pressed before
 * the band's UNDO. The refusal is the band (not the bar's line), and the next
 * form sent -- a bulk HIDE here -- retires it. ✕ then moves the owner on
 * without bringing it back; a ✕ pressed with the refusal still drawn is the
 * case below (c649).
 */
test('a band’s UNDO refused while a selection is open says so, and the form sent after it retires it (c469)', async ({
	page,
	context
}) => {
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren'], 'Refused Run Too');
	const made = page.locator('.band', { hasText: 'REFUSED RUN TOO IS A WORK' });
	await expect(made).toBeVisible();

	const other = await context.newPage();
	await other.goto('/');
	await openWork(other, 'Refused Run Too');
	await other.getByRole('button', { name: 'SELECT', exact: true }).click();
	await other.locator('.run .part', { hasText: 'Sousou no Frieren' }).locator('.rowlink').click();
	await other.getByRole('button', { name: 'TAKE OUT' }).click();
	await expect(
		other.locator('.band', { hasText: 'REFUSED RUN TOO IS NO LONGER A WORK' })
	).toBeVisible();
	await other.close();

	// SELECT first: the band is still drawn, and the Undo is still its own.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop selecting' })).toBeVisible();
	await expect(made).toBeVisible();
	await made.getByRole('button', { name: 'UNDO' }).click();
	const refusal = page.locator('.band', {
		hasText: 'REFUSED RUN TOO HAS CHANGED SINCE IT WAS MADE'
	});
	await expect(refusal).toBeVisible();
	await expect(refusal).toContainText('NOTHING CHANGED');
	// The band's own answer, not the bar's: the line is for bulk answers.
	await expect(page.locator('.fold-refused')).toHaveCount(0);
	// Still selecting, and the refusal stayed where the band is.
	await expect(page.getByRole('button', { name: 'Stop selecting' })).toBeVisible();
	await expect(workTile(page, 'Refused Run Too')).toHaveCount(0);

	// Any other form sent says the owner has moved on (the r2 low: every form
	// on the page retires a refusal, even one whose enhance answers nothing).
	// HIDE over one ticked series is the cheapest real press: it answers
	// `{ok: true}`, so it draws no band of its own.
	await tileByTitle(page, 'Dungeon Meshi').locator('.open').click();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(refusal).toHaveCount(0);
	await expect(page.locator('.lib-band .band')).toHaveCount(0);
	// Give the series back (the HIDE above changed only this file's database).
	const db = new Database(dbPath);
	db.prepare(`UPDATE series SET hidden = 0, public = 0 WHERE title = 'Dungeon Meshi'`).run();
	db.close();

	// ✕ moves the owner on: neither place repeats it, then or on the next SELECT.
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toBeVisible();
	await expect(refusal).toHaveCount(0);
	await expect(page.locator('.lib-band .band')).toHaveCount(0);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop selecting' })).toBeVisible();
	await expect(refusal).toHaveCount(0);
	await page.getByRole('button', { name: 'Stop selecting' }).click();
});

/**
 * c649 (works review r1, low 1): the case above says "✕ retires it", but by the
 * time ✕ was pressed the HIDE step had already retired the refusal, so no copy
 * had ever seen ✕ meet one. This is that state, reached the same way: a band's
 * UNDO is refused while a selection is open, and ✕ is pressed with the refusal
 * drawn under it. If ✕ stopped setting `passed`, the band would still be drawn
 * right after the press, which is what the first assertion below would catch.
 */
test('✕ retires a refusal that is visible under a selection, and the next SELECT does not bring it back (c649)', async ({
	page,
	context
}) => {
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren'], 'Refused Run Three');
	const made = page.locator('.band', { hasText: 'REFUSED RUN THREE IS A WORK' });
	await expect(made).toBeVisible();

	const other = await context.newPage();
	await other.goto('/');
	await openWork(other, 'Refused Run Three');
	await other.getByRole('button', { name: 'SELECT', exact: true }).click();
	await other.locator('.run .part', { hasText: 'Sousou no Frieren' }).locator('.rowlink').click();
	await other.getByRole('button', { name: 'TAKE OUT' }).click();
	await expect(
		other.locator('.band', { hasText: 'REFUSED RUN THREE IS NO LONGER A WORK' })
	).toBeVisible();
	await other.close();

	// SELECT, then the band's UNDO: the refusal is drawn, and still selecting.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop selecting' })).toBeVisible();
	await expect(made).toBeVisible();
	await made.getByRole('button', { name: 'UNDO' }).click();
	const refusal = page.locator('.band', {
		hasText: 'REFUSED RUN THREE HAS CHANGED SINCE IT WAS MADE'
	});
	// The state the card names, asserted right before the press.
	await expect(refusal).toBeVisible();
	await expect(page.getByRole('button', { name: 'Stop selecting' })).toBeVisible();

	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toBeVisible();
	await expect(refusal).toHaveCount(0);
	await expect(page.locator('.lib-band .band')).toHaveCount(0);

	// Nor on the next selection: the answer was passed, not merely hidden.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop selecting' })).toBeVisible();
	await expect(refusal).toHaveCount(0);
	await expect(page.locator('.lib-band .band')).toHaveCount(0);
	await page.getByRole('button', { name: 'Stop selecting' }).click();

	// The take-out ended the Work, so nothing is left to put back.
	await expect(workTile(page, 'Refused Run Three')).toHaveCount(0);
});

/**
 * c469's round 2: a refusal answered over the bulk bar stays in the bar's
 * `.fold-refused` line and goes with the selection. Reached through the app:
 * GROUP's ADD TO A WORK is open on a Work that the other tab ends, so the add
 * refuses as stale (c584), the sheet closes and the selection stays. Before
 * the fix, ✕ turned the line into a library band, `NOTHING CHANGED`, over a
 * library where nothing had been asked.
 */
test('a refusal over the bulk bar goes with ✕, and is not drawn as a library band (c469)', async ({
	page,
	context
}) => {
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Stale Run');
	await select(page, ['Dungeon Meshi']);
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /ADD TO A WORK · 1/ }).click();
	await sheet.getByText('Stale Run', { exact: true }).click();

	const other = await context.newPage();
	await other.goto('/');
	await openWork(other, 'Stale Run');
	await endWork(other);
	await other.close();

	await sheet.getByRole('button', { name: /ADD 1 TO THE WORK/ }).click();
	await expect(sheet).toBeHidden();
	const line = page.locator('.fold-refused');
	await expect(line).toHaveText('THAT WORK HAS CHANGED · LOOK AGAIN');
	await expect(page.locator('.lib-band .band')).toHaveCount(0);

	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await expect(page.getByRole('button', { name: 'SELECT', exact: true })).toBeVisible();
	await expect(line).toHaveCount(0);
	await expect(page.locator('.band', { hasText: 'THAT WORK HAS CHANGED' })).toHaveCount(0);
	await expect(page.locator('.lib-band .band')).toHaveCount(0);

	// Nor does the next selection start on it.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop selecting' })).toBeVisible();
	await expect(line).toHaveCount(0);
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	// The Work ended in the other tab, and Dungeon Meshi joined nothing.
	await expect(workTile(page, 'Stale Run')).toHaveCount(0);
});

/**
 * c469 (wave 19's Gaps 3 and 7, decision 12): HIDE ALL over a selection whose
 * Work is hidden whole already and a loose series beside it. The press hides
 * only the loose one, and that one is what its UNDO may show: the band says
 * so, never TAKEN OUT OF THE WORK (nothing was), never THE WORK, WHOLE (it
 * hid none of it), and its UNDO shows the loose series and leaves the Work
 * hidden. Before c469 the press answered no band at all.
 */
test('HIDE ALL beside a Work hidden already says only what it hid, and its UNDO shows only that (c469)', async ({
	page
}) => {
	await revealOn(page);
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Settled Run');
	await page.goto('/?shelf=k:manga');
	const run = page.locator('.grid .tile.work', { hasText: 'Settled Run' });
	const loose = tileByTitle(page, 'Sousou no Frieren');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await run.locator('.open').click();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Hide' })
		.getByRole('button', { name: /HIDE ALL 2/ })
		.click();
	await expect(page.locator('.band', { hasText: 'HIDDEN · THE WORK, WHOLE' })).toBeVisible();

	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await run.locator('.open').click();
	await loose.locator('.open').click();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Hide' })
		.getByRole('button', { name: /HIDE ALL \d+/ })
		.click();
	const band = page.locator('.band', { hasText: 'HIDDEN · 1 SERIES' });
	await expect(band).toBeVisible();
	await expect(band).toContainText('SHOWN AGAIN BY UNDO');
	await expect(band).not.toContainText('TAKEN OUT');
	await expect(page.locator('.band', { hasText: 'THE WORK, WHOLE' })).toHaveCount(0);
	await expect(loose.locator('.badge', { hasText: 'HIDDEN' })).toBeVisible();

	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(band).toHaveCount(0);
	await expect(loose.locator('.badge', { hasText: 'HIDDEN' })).toHaveCount(0);
	await expect(run.locator('.badge', { hasText: 'HIDDEN' })).toBeVisible();

	// Back to the seed: the Work shown, then ended, and reveal off.
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await run.locator('.open').click();
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(run.locator('.badge', { hasText: 'HIDDEN' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await run.click();
	await page.waitForURL(/\/work\/\d+/);
	await endWork(page);
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
});

test('a Work cannot be made of a hidden series and a visible one', async ({ page }) => {
	await revealOn(page);
	await page.goto('/?shelf=all&sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	// Kōhai is hidden in the seed; Isekai Ojisan is not.
	for (const t of ['Kōhai no Himitsu Nikki', 'Isekai Ojisan'])
		await tileByTitle(page, t).locator('.open').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Mixed Run');
	await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
	// The server refuses, the sheet stays open with the reason, and no Work is made.
	await expect(sheet.locator('.refused')).toContainText(
		/HIDDEN AND VISIBLE SERIES CAN.T SHARE A WORK/
	);
	await expect(sheet).toBeVisible();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
	await sheet.getByRole('button', { name: 'CANCEL' }).click();
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
});

// ---- W7 (c281; doc/WORKS.md, "The offer" and "The flow") ----------------------

/** A library tile by its exact title, on a page where `.grid .tile` holds it. */
async function openSeries(page: Page, title: string): Promise<number> {
	await page.goto('/');
	await tileByTitle(page, title).locator('.open').click();
	await page.waitForURL(/\/series\/\d+/);
	return Number(/\/series\/(\d+)/.exec(page.url())![1]);
}

/** Makes a Work of exact titles through the AS sheet, from the library's SELECT. */
async function makeWorkExact(page: Page, titles: string[], name: string) {
	await page.goto('/');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of titles) await tileByTitle(page, t).locator('.open').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill(name);
	await sheet.getByRole('button', { name: /CREATE WORK · \d+ SERIES/ }).click();
	await expect(page.locator('.band', { hasText: `${name.toUpperCase()} IS A WORK` })).toBeVisible();
}

test('MIGHT CONTINUE <WORK>: REVIEW opens ADD TO A WORK with it last and ticked, only that tap adds, and NOT THIS never asks again', async ({
	page
}) => {
	// The circle's books are in the hidden Hentoid root: reveal on, as the
	// owner would be to see them. The Work and the newcomer are both hidden,
	// so the newcomer could join it (a visible series is never offered a
	// hidden Work: tests/works-offer-db.spec.ts).
	await revealOn(page);
	await makeWorkExact(page, ['Kaori Mama', 'Kaori Mama on Holiday Duty'], 'Kaori Mama');
	const id = await openSeries(page, 'Kaori Mama Illustrations 2024');

	// Work-States 1: under CONTINUE, why, and the place it would take.
	const offer = page.getByRole('region', { name: 'Might continue Kaori Mama' });
	await expect(offer).toContainText('MIGHT CONTINUE KAORI MAMA · AS PART 3');
	await expect(offer).toContainText(
		"ITS TITLE STARTS WITH THE WORK'S NAME · THE WORK HOLDS 2 SERIES"
	);
	// Never on its own: seeing the offer, and coming back to it, joins nothing.
	await page.reload();
	await expect(offer).toBeVisible();
	await expect(page.locator('.work-row')).toHaveCount(0);

	// REVIEW → the sheet in ADD TO A WORK: the run numbered, it last and ticked.
	await offer.getByRole('button', { name: 'REVIEW →' }).click();
	const sheet = groupSheet(page);
	await expect(sheet).toBeVisible();
	await expect(sheet.locator('.h-title')).toHaveText('INTO KAORI MAMA · AS PART 3');
	const rows = sheet.locator('.rows .row');
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toContainText('01');
	await expect(rows.nth(1)).toContainText('Kaori Mama on Holiday Duty');
	await expect(rows.nth(2)).toContainText('03');
	await expect(rows.nth(2)).toContainText('Kaori Mama Illustrations 2024');
	const tick = sheet.getByRole('checkbox', { name: 'Include Kaori Mama Illustrations 2024' });
	await expect(tick).toHaveAttribute('aria-checked', 'true');
	// Only the newcomer is tickable; the run is not reordered here.
	await expect(sheet.getByRole('checkbox')).toHaveCount(1);
	await expect(sheet.getByRole('button', { name: /^Move .* (up|down)$/ })).toHaveCount(0);
	// Unticked, there is nothing to add.
	const add = sheet.getByRole('button', { name: 'ADD 1 TO THE WORK' });
	await tick.click();
	await expect(sheet.getByRole('button', { name: 'ADD 0 TO THE WORK' })).toBeDisabled();
	// CANCEL leaves everything as it was.
	await sheet.getByRole('button', { name: 'CANCEL' }).click();
	await expect(sheet).toBeHidden();
	await page.reload();
	await expect(offer).toBeVisible();

	// The tap: it joins, last, and says so with UNDO.
	await offer.getByRole('button', { name: 'REVIEW →' }).click();
	await add.click();
	await expect(sheet).toBeHidden();
	const band = page.locator('.band', { hasText: 'ADDED TO KAORI MAMA · PART 3' });
	await expect(band).toBeVisible();
	await expect(page.locator('.work-row')).toContainText('PART 3 OF 3');
	await expect(offer).toHaveCount(0);
	expect(page.url()).toContain(`/series/${id}`);

	// UNDO takes it out again, and the offer is back.
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.work-row')).toHaveCount(0);
	await expect(offer).toBeVisible();

	// NOT THIS: its band's UNDO brings the offer straight back.
	await offer.getByRole('button', { name: 'NOT THIS' }).click();
	// The bands are drawn twice, one copy per order, and CSS shows one (c556,
	// doc/SERIES.md, "Two markups"): the band is the copy that can be seen.
	const dismissed = page
		.locator('.band', { hasText: "NOT THIS · WON'T ASK AGAIN" })
		.filter({ visible: true });
	await expect(dismissed).toBeVisible();
	await expect(offer).toHaveCount(0);
	await dismissed.getByRole('button', { name: 'UNDO' }).click();
	await expect(offer).toBeVisible();

	// The sheet's own NOT THIS is the same answer, and it holds for good:
	// across a reload and a second visit, nothing is offered and nothing joined.
	await offer.getByRole('button', { name: 'REVIEW →' }).click();
	await sheet.getByRole('button', { name: 'NOT THIS' }).click();
	await expect(sheet).toBeHidden();
	await expect(dismissed).toBeVisible();
	await page.reload();
	await expect(offer).toHaveCount(0);
	await expect(page.locator('.work-row')).toHaveCount(0);
	await page.goto('/');
	await expect(workTile(page, 'Kaori Mama').locator('.bdg.wb')).toHaveText('WORK · 2');
	await page.goto(`/series/${id}`);
	await expect(page.getByRole('heading', { name: 'Kaori Mama Illustrations 2024' })).toBeVisible();
	await expect(offer).toHaveCount(0);

	// Done: the Work ends. Its dismissal names this Work's moment of making,
	// which no later Work shares, so nothing else is silenced by it.
	await page.goto('/');
	await workTile(page, 'Kaori Mama').click();
	await endWork(page);
});

/**
 * c584: the offer the sheet was drawn with goes stale while it is open, made
 * so through the app's own doors in a second page (the owner's other tab).
 * The add refuses (`THAT WORK HAS CHANGED · LOOK AGAIN`, c583's shape), and
 * the sheet must not stay open on the dead offer: it closes, the screen says
 * why, and MIGHT CONTINUE shows what is true now -- the newer Work's offer
 * when one was made under the same id, or nothing once there is no Work.
 */
test('a refused stale offer closes its sheet, and MIGHT CONTINUE shows the offer there is now, or none (c584)', async ({
	page
}) => {
	await revealOn(page);
	const pair = ['Kaori Mama', 'Kaori Mama on Holiday Duty'];
	await makeWorkExact(page, pair, 'Kaori Mama');
	const id = await openSeries(page, 'Kaori Mama Illustrations 2024');
	const offer = page.getByRole('region', { name: 'Might continue Kaori Mama' });
	const keyOf = () => offer.locator('input[name="key"]').first().inputValue();
	const sheet = groupSheet(page);
	const refusal = page.locator('.band', { hasText: 'THAT WORK HAS CHANGED · LOOK AGAIN' });
	const other = await page.context().newPage();

	// The Work is ungrouped in the other tab and made again from the same two
	// series: the newer Work takes the old one's id, under a new moment.
	const old = await keyOf();
	await offer.getByRole('button', { name: 'REVIEW →' }).click();
	await expect(sheet.locator('.h-title')).toHaveText('INTO KAORI MAMA · AS PART 3');
	await other.goto('/');
	await openWork(other, 'Kaori Mama');
	await endWork(other);
	await makeWorkExact(other, pair, 'Kaori Mama');
	await sheet.getByRole('button', { name: 'ADD 1 TO THE WORK' }).click();
	await expect(sheet).toBeHidden();
	await expect(refusal).toBeVisible();
	// The offer drawn now is the newer Work's, not the dead one's, and the
	// series joined nothing.
	await expect(offer).toBeVisible();
	await expect.poll(keyOf).not.toBe(old);
	await expect(page.locator('.work-row')).toHaveCount(0);
	expect(page.url()).toContain(`/series/${id}`);

	// Ungrouped for good in the other tab: the refusal leaves no offer at all.
	await offer.getByRole('button', { name: 'REVIEW →' }).click();
	await expect(sheet).toBeVisible();
	await other.goto('/');
	await openWork(other, 'Kaori Mama');
	await endWork(other);
	await sheet.getByRole('button', { name: 'ADD 1 TO THE WORK' }).click();
	await expect(sheet).toBeHidden();
	await expect(refusal).toBeVisible();
	await expect(offer).toHaveCount(0);
	await expect(page.locator('.work-row')).toHaveCount(0);
	await other.close();
});

/** Adds or removes one tag on a series, through its screen's EDIT sheet. */
async function tagSeries(page: Page, title: string, tag: string, on: boolean) {
	await openSeries(page, title);
	await page
		.locator('.row', { hasText: 'SHELVES' })
		.getByRole('button', { name: 'EDIT', exact: true })
		.click();
	const edit = page.getByRole('dialog', { name: 'Shelves and tags' });
	await expect(edit).toBeVisible();
	if (on) {
		const field = edit.getByRole('textbox', { name: 'Add a tag, as namespace:value' });
		await field.fill(tag);
		await field.press('Enter');
		await expect(field).toHaveValue('');
		await expect(edit.getByRole('button', { name: `Remove ${tag}` })).toBeVisible();
	} else {
		await edit.getByRole('button', { name: `Remove ${tag}` }).click();
		await expect(edit.getByRole('button', { name: `Remove ${tag}` })).toHaveCount(0);
	}
	await page.keyboard.press('Escape');
	await expect(edit).toBeHidden();
}

test('one Work end to end: a person’s page groups three, part 1 read to its end opens part 2, the run moves on, and a TAKE OUT’s UNDO and UNGROUP end where it began (c281)', async ({
	page
}) => {
	// The board's way a Work is made (Work-States 7): an author's page. The
	// seed's artist has one series, so two more take the artist's tag first,
	// by the series screen's own EDIT, and give it back at the end.
	const artist = 'artist:Aoi Hanamura';
	const [first, second, third] = [
		'Hikaru ga Shinda Natsu',
		'Isekai Yakkyoku',
		'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru'
	];
	await tagSeries(page, first, artist, true);
	await tagSeries(page, second, artist, true);

	// Group the three from the person's page, BY HAND in the order selected.
	const person = '/?tag=' + encodeURIComponent(artist);
	await page.goto(person);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of [first, second, third])
		await page.locator('.grid li', { hasText: t }).getByRole('button').click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = groupSheet(page);
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Aoi Run');
	await sheet.getByRole('button', { name: 'CREATE WORK · 3 SERIES' }).click();
	await expect(page.locator('.band', { hasText: 'AOI RUN IS A WORK' })).toBeVisible();
	const said = page.locator('.work-row', { hasText: 'Aoi Run' });
	await expect(said).toContainText('3 OF 3 HERE');

	// The Work's screen: three parts in that order, and the rating line is the
	// parts' (c309: every number is of the parts this page sees, here all).
	await said.click();
	await page.waitForURL(/\/work\/\d+/);
	const workUrl = page.url();
	const parts = page.locator('.run .part');
	await expect(parts).toHaveCount(3);
	await expect(parts.nth(0)).toContainText(first);
	await expect(parts.nth(1)).toContainText(second);
	await expect(page.locator('.mix')).not.toContainText('SEES ONLY SOME');

	// Read part 1 to its end: its last chapter, the last page, one turn past.
	const db = new Database(dbPath, { readonly: true });
	const entryOf = (title: string, order: 'ASC' | 'DESC') =>
		(
			db
				.prepare(
					`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
					WHERE s.title = ? ORDER BY e.position ${order} LIMIT 1`
				)
				.get(title) as { id: number }
		).id;
	const last = entryOf(first, 'DESC');
	const next = entryOf(second, 'ASC');
	db.close();
	await page.goto(`/read/${last}?p=last`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	// A manga reads R→L: ← is forward, and past the last page is the end page.
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('[data-end-page]')).toBeVisible();
	const block = page.locator('.end .nextw');
	await expect(block).toContainText('NEXT IN AOI RUN · PART 2 OF 3');
	await expect(block).toContainText(second);

	// START part 2 from the end page: a tap, into its first chapter.
	await block.locator('.go > .acc').click();
	await page.waitForURL(new RegExp(`/read/${next}\\b`));
	await readerReady(page);
	await page.waitForLoadState('networkidle');

	// CONTINUE and the tile move on to part 2.
	await page.goto('/');
	const cont = page.locator('.cont .row.work', { hasText: 'Aoi Run' });
	await expect(cont).toContainText('WORK · PART 2');
	const tile = workTile(page, 'Aoi Run');
	await expect(tile.locator('.ft')).toContainText('PART 2 OF 3');
	await expect(tile.locator('.bdg.wb')).toHaveText('WORK · 3');

	// Take out one (a Work of two stays), then the second-to-last: the Work
	// ends, and UNDO puts it back with its name and order.
	await page.goto(workUrl);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.run .part', { hasText: 'Drawing: Saikyou' }).locator('.rowlink').click();
	await page.getByRole('button', { name: 'TAKE OUT' }).click();
	await expect(page.locator('.band', { hasText: 'TAKEN OUT · DRAWING' })).toBeVisible();
	await expect(parts).toHaveCount(2);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.run .part', { hasText: second }).locator('.rowlink').click();
	await page.getByRole('button', { name: 'TAKE OUT' }).click();
	await expect(page).toHaveURL(/band=ended/);
	const ended = page.locator('.band', { hasText: 'AOI RUN IS NO LONGER A WORK' });
	await expect(ended).toBeVisible();
	await expect(workTile(page, 'Aoi Run')).toHaveCount(0);
	await ended.getByRole('button', { name: 'UNDO' }).click();
	await expect(workTile(page, 'Aoi Run')).toBeVisible();
	await expect(workTile(page, 'Aoi Run').locator('.bdg.wb')).toHaveText('WORK · 2');
	await workTile(page, 'Aoi Run').click();
	await expect(parts).toHaveCount(2);
	await expect(parts.nth(0)).toContainText(first);
	await expect(parts.nth(1)).toContainText(second);

	// UNGROUP: three series on their own again, and the tags given back.
	await endWork(page);
	await expect(tileByTitle(page, first)).toBeVisible();
	await expect(tileByTitle(page, second)).toBeVisible();
	await tagSeries(page, first, artist, false);
	await tagSeries(page, second, artist, false);
	await page.goto(person);
	await expect(page.locator('.grid li', { hasText: first })).toHaveCount(0);
});
