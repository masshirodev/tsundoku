import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * The Works flow end to end (c276, c277; doc/WORKS.md): browsing shows the run
 * as one tile and one CONTINUE row, finding shows the parts, and /work/N is the
 * run's own screen.
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

// ---- Works (c276, c277; doc/WORKS.md) ----------------------------------------
// Browsing shows the run as one tile and one CONTINUE row; finding shows the
// series; /work/N is the run's own screen. Each test makes its Work and ends
// it again, and a series it writes to is put back, so the next case -- and the
// file's own proof at the end -- sees the seed.

const workTile = (page: Page, name: string) => page.locator('.grid .tile.work', { hasText: name });

/** A series tile by its exact title: "Kaori Mama" is a prefix of two others. */
const tileByTitle = (page: Page, title: string) =>
	page.locator('.grid .tile').filter({
		has: page.locator('.title', {
			hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
		})
	});

/** Picks these titles in this order and presses WORK, landing on the Work. */
async function makeWork(page: Page, titles: string[]) {
	await page.goto('/');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of titles)
		await page.locator('.grid .tile', { hasText: t }).locator('.open').click();
	await page.getByRole('button', { name: 'WORK', exact: true }).click();
	await expect(page).toHaveURL(/\/work\/\d+/);
}

test('a Work is one tile, one CONTINUE row, and a screen of its own', async ({ page }) => {
	// Two runs in progress, the newest read of them five minutes old: the
	// Work's CONTINUE row is the first one, and the section counts rows.
	await makeWork(page, [
		'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		'Kusuriya no Hitorigoto'
	]);
	// They share no words, so it is named for the owner to replace.
	await expect(page.locator('.rename')).toBeVisible();
	await page.locator('.rename input').fill('Drawing Run');
	await page.locator('.rename').getByRole('button', { name: 'DONE' }).click();
	await expect(page.locator('.bar-title .t')).toHaveText('Drawing Run');
	await expect(page.locator('.bar-title .s')).toContainText('WORK · 2 SERIES');
	await expect(page.locator('.ident h1')).toHaveText('Drawing Run');
	await expect(page.locator('.ident .meta')).toHaveText('WORK · MANGA');
	await expect(page.locator('.ident .count').first()).toContainText('2 SERIES');
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
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(workTile(page, 'Drawing Run')).toHaveCount(0);
});

test('ORDER reorders the run, TAKE OUT of the second-to-last ends the Work, and UNDO restores it', async ({
	page
}) => {
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku']);
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
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('the TAKE OUT and ADD A SERIES bands name the series they moved', async ({ page }) => {
	// Three parts, so taking one out leaves a Work of two: the Work survives and
	// its own screen has to say which series left. The bands are built after
	// `update()` has re-read the lists the series used to be found in, so their
	// names come from the action's facts (round 2's finding).
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren', 'Isekai Ojisan']);
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
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('the ADD A SERIES picker asks once the typing pauses, not once a letter', async ({ page }) => {
	// A read per keystroke was seven `LIKE` scans over the library for one word
	// (round 2's finding); the sheet now asks 180ms behind the typing, the
	// library's own beat (doc/LIBRARY.md, "Search").
	await makeWork(page, ['Mushoku Tensei', 'Sousou no Frieren']);
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
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('a Work’s RATING and FAV are the parts’, set together while they agree, and RENAME undoes', async ({
	page
}) => {
	// These two share no words, so the Work is named for the owner to replace.
	await makeWork(page, [
		'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		'Hikaru ga Shinda Natsu'
	]);
	await expect(page.locator('.rename')).toBeVisible();
	await page.locator('.rename input').fill('Drawing Run');
	await page.locator('.rename').getByRole('button', { name: 'DONE' }).click();
	await expect(page.locator('.bar-title .t')).toHaveText('Drawing Run');
	await expect(page.locator('.band', { hasText: 'RENAMED · DRAWING RUN' })).toBeVisible();

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
	await page.goto(page.url().match(/\/work\/\d+/) ? page.url() : '/');
	// Back to the Work: it is on the library.
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
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);

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

	// Reveal, so the hidden doujins are tiles, and make a Work of two of them.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	// A series of books and two singles: not one book series' to group, so the
	// bulk bar offers a Work.
	for (const t of ['Kaori Mama', 'Kōhai no Himitsu Nikki', 'Onsen Ryokan no Yoru'])
		await tileByTitle(page, t).locator('.open').click();
	await page.getByRole('button', { name: 'WORK', exact: true }).click();
	await expect(page).toHaveURL(/\/work\/\d+/);
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
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku']);
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
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('SELECT ALL takes a Work’s every part, so a bulk HIDE hides the run whole', async ({
	page
}) => {
	// The seed has no anime series (fixtures.ts), so this is the same shape with
	// a manhwa part off the kind shelf: the Work's face is the manga.
	await makeWork(page, [
		'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		"Omniscient Reader's Viewpoint"
	]);
	const work = page.url().split('?')[0];
	// A page of six, sorted by title: the Work's own name ('Untitled work',
	// since these two share no words) sorts onto a later page. Hold the pages
	// after the first back until SELECT ALL has asked, so the Work's tile is
	// not among the cards the fast path expands: the ids read is what must
	// carry its manhwa part.
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
	// not on this shelf, so the old series-only read never selected it and the
	// tile stayed unchecked while HIDE took one part.
	const tile = page.locator('.grid .tile.work');
	await expect(tile).toHaveCount(1);
	await expect(tile.locator('.open')).toHaveAttribute('aria-pressed', 'true');
	// SELECT ALL selected the Work's every part -- the tile is checked only
	// when all of them are. HIDE acts on the selection, so hide this Work's own
	// parts by selecting its tile, never the whole kind shelf (round 2's
	// finding; the shelf-wide write is the node case in
	// tests/works-library-db.spec.ts).
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(tile.locator('.open')).toHaveAttribute('aria-pressed', 'false');
	await tile.locator('.open').click();
	await expect(tile.locator('.open')).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
	// Both parts are hidden, so with reveal off the Work is the 404 a missing id is.
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
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	// End the Work, then hide again.
	await revealed.click();
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});

test('WORK refuses a selection that already holds a Work, and leaves every Work a tile', async ({
	page
}) => {
	await makeWork(page, ['Isekai Ojisan', 'Isekai Yakkyoku']);
	await page.goto('/');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await page.getByRole('button', { name: 'WORK', exact: true }).click();
	// A selection that already holds a Work's part is W4's AS sheet to move,
	// not this cell's: it refuses, and the Work on the shelf is untouched.
	await expect(page.locator('.fold-refused')).toContainText('A WORK KEEPS ITS PARTS');
	await expect(page.locator('.grid .tile.work')).toHaveCount(1);
	// Done: end the Work so the seed is as the other specs expect.
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await page.locator('.grid .tile.work').click();
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await expect(page.locator('.grid .tile.work')).toHaveCount(0);
});
