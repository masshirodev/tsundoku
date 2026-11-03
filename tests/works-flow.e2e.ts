import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

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
test.describe.configure({ mode: 'serial' });

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

/** Ends the Work on its own screen, so the seed is what the other cases expect. */
async function endWork(page: Page) {
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
}

/** Reveal on for this page, as `/reveal` does: hidden series become tiles that
 * say HIDDEN. Each test has its own context, so the cookie ends with it. */
async function revealOn(page: Page) {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
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
	await page.locator('.rename input').fill('Drawing Run');
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

// ---- W4: GROUP AS A WORK, the person page, HIDE on a part (c278) ------------

test('GROUP AS A WORK from the library: the AS row, the name, the band and UNDO', async ({
	page
}) => {
	// Two doujin singletons: the AS row offers BOOKS as well, and a Work is the
	// answer chosen. The default name is the words every title starts with.
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
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
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
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
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku'], 'Isekai');
	await openWork(page, 'Isekai');
	// The part's own screen, opened from the run: ← names the Work (W5). Part 2
	// is the one in progress, so the row is the plain WORK row, not the accent.
	await page.locator('.run .part .rowlink').nth(1).click();
	await page.waitForURL(/\/series\/\d+\?from=work/);
	await expect(page.locator('a.back .back-label')).toHaveText('ISEKAI');
	await expect(page.locator('.prow.work-row')).toBeVisible();

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
	await whole.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.badge', { hasText: 'HIDDEN' })).toHaveCount(0);

	// Done: end the Work, and reveal off again.
	await page.goto('/');
	await workTile(page, 'Isekai').click();
	await endWork(page);
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
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
