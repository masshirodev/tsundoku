import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * Highlights H1 end to end (c701; doc/HIGHLIGHTS.md): the sidebar's and
 * MORE's HIGHLIGHTS row with its count, /highlights (the list by day, the
 * filters, the search, the open item, a note, a colour, DELETE and UNDO, the
 * orphans and the disk line), /highlights in the search bar, the series
 * screen's row and its reading-order list, and DELETE's 14 HIGHLIGHTS ARE
 * KEPT, until the row goes at zero.
 *
 * H1 has no way to make a highlight, and the shared seed has none, so this
 * file seeds the seed into a database of its own, adds highlights to it the
 * way the readers will make them, and serves the same build on a port the OS
 * gives it (the `works-flow` arrangement). Its cases run in order and write
 * (a note, a delete), so nothing else may see this database. It is a
 * `*-flow.e2e.ts`, so it runs once, in tablet-portrait; the desktop's
 * sidebar and two-pane layout are one describe with the desktop's device.
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
const scratch = join(tmpdir(), `tsundoku-e2e-highlights-flow-${process.pid}`);
const dbPath = join(scratch, 'library.sqlite');
const home = join(scratch, 'home');
let server: ChildProcess | null = null;

test.use({ baseURL: base });

/** A 1×1 PNG: a page's copy the browser can draw. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);

const DAY = 86_400_000;
const now = Date.now();

/** The seed's series by title, and an entry of it by position. */
function seedHighlights(db: Database.Database) {
	const series = (title: string) =>
		db.prepare(`SELECT id, kind FROM series WHERE title = ?`).get(title) as {
			id: number;
			kind: string;
		};
	const entryAt = (seriesId: number, n: number) =>
		db
			.prepare(
				`SELECT id, label FROM entries WHERE series_id = ? ORDER BY position LIMIT 1 OFFSET ?`
			)
			.get(seriesId, n - 1) as { id: number; label: string };
	const put = db.prepare(
		`INSERT INTO highlights (kind, series_id, entry_id, origin_key, number, season, block, block_offset,
			page, clip_in, clip_out, series_title, series_kind, entry_label, entry_title, quote, paragraph,
			context, colour, note, made_at, hidden, copy_path, still_path, copy_bytes, copy_width, copy_height)
		VALUES (@kind, @series, @entry, NULL, @number, NULL, @block, @offset, @page, @in, @out, @title, @skind,
			@label, @etitle, @quote, @paragraph, @context, @colour, @note, @made, @hidden, @copy, @still,
			@bytes, @w, @h)`
	);
	const row = (o: Partial<Record<string, unknown>>) => ({
		kind: 'quote',
		series: null,
		entry: null,
		number: null,
		block: null,
		offset: null,
		page: null,
		in: null,
		out: null,
		title: '',
		skind: 'novel',
		label: '',
		etitle: '',
		quote: '',
		paragraph: '',
		context: '',
		colour: null,
		note: '',
		made: now,
		hidden: 0,
		copy: '',
		still: '',
		bytes: 0,
		w: null,
		h: null,
		...o
	});
	const novel = series('Mushoku Tensei');
	const ch1 = entryAt(novel.id, 1);
	const ch3 = entryAt(novel.id, 3);
	put.run(
		row({
			series: novel.id,
			entry: ch3.id,
			number: 3,
			block: 3,
			offset: 4,
			title: 'Mushoku Tensei',
			label: ch3.label,
			etitle: 'The Thirteenth Lamp',
			quote: 'Nothing is only anything',
			paragraph: '“Nothing is only anything,” she said, “if you wait long enough to see.”',
			context: '“You keep looking at it,” Teo said. “It’s only a lamp.”',
			colour: 'yellow',
			note: 'Her mother’s line, the one she won’t say out loud.',
			made: now
		})
	);
	put.run(
		row({
			series: novel.id,
			entry: ch1.id,
			number: 1,
			block: 0,
			offset: 0,
			title: 'Mushoku Tensei',
			label: ch1.label,
			quote: 'The lamps along the harbour went out one by one.',
			paragraph: 'The lamps along the harbour went out one by one.',
			colour: 'blue',
			made: now - 2 * DAY
		})
	);
	const manga = series('Dungeon Meshi');
	const page = entryAt(manga.id, 2);
	mkdirSync(join(home, 'highlights', 'pages'), { recursive: true });
	writeFileSync(join(home, 'highlights', 'pages', 'p1.png'), PNG);
	put.run(
		row({
			kind: 'page',
			series: manga.id,
			entry: page.id,
			number: 2,
			page: 13,
			title: 'Dungeon Meshi',
			skind: 'manga',
			label: page.label,
			note: 'The tower from above this time.',
			made: now - DAY,
			copy: 'pages/p1.png',
			bytes: 3 * 1024 * 1024,
			w: 1240,
			h: 1800
		})
	);
	// A clip from an anime no longer in the library: the copy is all there is.
	put.run(
		row({
			kind: 'clip',
			number: 7,
			in: 724,
			out: 816,
			title: 'Toudai no Mukou',
			skind: 'anime',
			label: 'Ep. 7',
			made: now - DAY,
			bytes: 38 * 1024 * 1024
		})
	);
	db.prepare(
		`UPDATE highlights SET state = 'orphan_series', orphaned_at = ? WHERE kind = 'clip'`
	).run(now - DAY);
	// A hidden series' page: kept hidden, and not counted without reveal.
	const secret = series('Kōhai no Himitsu Nikki');
	const book = entryAt(secret.id, 1);
	put.run(
		row({
			kind: 'page',
			series: secret.id,
			entry: book.id,
			number: 1,
			page: 8,
			title: 'Kōhai no Himitsu Nikki',
			skind: 'doujin',
			label: book.label,
			made: now,
			hidden: 1
		})
	);
}

test.beforeAll(async () => {
	test.setTimeout(120_000);
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		seedHighlights(db);
	} finally {
		db.close();
	}
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(scratch, 'library'),
			TRASH_DIR: join(scratch, 'trash'),
			TSUNDOKU_HOME: home
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
	if (!up) throw new Error('the highlights flow preview never answered');
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(scratch, { recursive: true, force: true });
});

/** A command typed into search, as privacy-flow does it. */
async function command(page: Page, text: string) {
	await page.goto('/search');
	await page.getByRole('searchbox').fill(text);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
}

const more = (page: Page) => page.getByRole('dialog', { name: 'More' });
const rows = (page: Page) => page.locator('a.hl');
const open = (page: Page) => page.locator('aside.open');

test('MORE has HIGHLIGHTS after HISTORY with the count, a hidden series’ not counted', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'MORE' }).click();
	const names = await more(page).locator('.row > span:first-child').allTextContents();
	expect(names.indexOf('HIGHLIGHTS →')).toBe(names.indexOf('HISTORY →') + 1);
	await expect(more(page).getByRole('link', { name: /^HIGHLIGHTS →/ })).toHaveText(
		/HIGHLIGHTS →\s*4/
	);
	await more(page)
		.getByRole('link', { name: /^HIGHLIGHTS →/ })
		.click();
	await expect(page).toHaveURL(/\/highlights$/);
	await expect(page.locator('header.bar .title')).toHaveText(/HIGHLIGHTS · 4/);
});

test('every highlight newest first, by day; the orphan says so; the disk line counts what shows', async ({
	page
}) => {
	await page.goto('/highlights');
	await expect(page.locator('.lbl.day')).toHaveText(['TODAY', /^\d+ [A-Z]{3}/, /^\d+ [A-Z]{3}/]);
	await expect(rows(page)).toHaveCount(4);
	await expect(rows(page).first()).toContainText('Mushoku Tensei');
	await expect(rows(page).first()).toContainText('Nothing is only anything');
	const clip = rows(page).filter({ hasText: 'Toudai no Mukou' });
	await expect(clip.locator('.tag')).toHaveText(/FROM A SERIES NO LONGER IN THE LIBRARY/);
	await expect(clip).toContainText('CLIP · EP. 7 · 12:04–13:36');
	await expect(clip.locator('.al')).toHaveText('1:32');
	await expect(page.locator('[data-disk]')).toContainText('PAGES 3 MB');
	await expect(page.locator('[data-disk]')).toContainText('CLIPS 38 MB');
	// The chips count what shows; NO WAY BACK only while there is one.
	await expect(page.locator('.chips .chip')).toHaveText([
		'ALL 4',
		'QUOTES 2',
		'PAGES 1',
		'CLIPS 1',
		'SERIES · ALL ↓',
		'NO WAY BACK 1'
	]);
	await page.getByRole('link', { name: 'PAGES 1' }).click();
	await expect(page).toHaveURL(/kind=page/);
	await expect(rows(page)).toHaveCount(1);
	await page.getByRole('link', { name: 'NO WAY BACK 1' }).click();
	await expect(rows(page)).toHaveText([/Toudai no Mukou/]);
});

test('search finds a quote by its words and a page by its note, the match in full ink', async ({
	page
}) => {
	await page.goto('/highlights');
	await page.getByRole('searchbox').fill('lamps');
	await expect(page).toHaveURL(/q=lamps/);
	await expect(rows(page)).toHaveCount(1);
	await expect(rows(page).locator('.q .match')).toHaveText('lamps');
	await page.getByRole('searchbox').fill('tower');
	await expect(rows(page)).toHaveText([/Dungeon Meshi[\s\S]*IN THE NOTE/]);
	await expect(rows(page).locator('.n .match')).toHaveText('tower');
	await expect(page.locator('.lbl.found')).toHaveText('1 HIGHLIGHT · 1 SERIES');
});

test('/highlights in the search bar is a page result, and carries its words', async ({ page }) => {
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/highlights lamps');
	await expect(page.locator('.page-cmd')).toHaveText(/HIGHLIGHTS · LAMPS\s*ENTER →/);
	await page.getByRole('searchbox').press('Enter');
	await expect(page).toHaveURL(/\/highlights\?q=lamps/);
	await expect(rows(page)).toHaveCount(1);
});

test('a quote opens with its paragraph and the marker; its note and colour change and stay', async ({
	page
}) => {
	await page.goto('/highlights');
	await rows(page).filter({ hasText: 'Nothing is only anything' }).click();
	await expect(page).toHaveURL(/open=\d+/);
	await expect(open(page).locator('.sh .lbl')).toHaveText('QUOTE · MUSHOKU TENSEI · VOL. 3 · ¶ 4');
	await expect(open(page).locator('.ctx')).toContainText('It’s only a lamp');
	await expect(open(page).locator('.mk')).toHaveText('Nothing is only anything');
	await expect(open(page).locator('.mk')).toHaveClass(/yellow/);
	await expect(open(page).locator('.nm')).toBeVisible();
	await expect(open(page).getByRole('link', { name: 'VOL. 3 →' })).toHaveAttribute(
		'href',
		/\/read\/\d+\?at=3\.4$/
	);

	await open(page).getByRole('button', { name: 'Orange' }).click();
	await expect(open(page).locator('.mk')).toHaveClass(/orange/);
	const note = open(page).getByRole('textbox', { name: 'NOTE' });
	await note.fill('Changed, and kept.');
	await note.blur();
	await expect(rows(page).filter({ hasText: 'Nothing is only anything' })).toContainText(
		'Changed, and kept.'
	);
	await page.reload();
	await expect(open(page).getByRole('textbox', { name: 'NOTE' })).toHaveValue('Changed, and kept.');
	await expect(open(page).getByRole('button', { name: 'Orange, chosen' })).toBeVisible();
});

test('DELETE is at once, with UNDO in the band; the count follows', async ({ page }) => {
	await page.goto('/highlights');
	await rows(page).filter({ hasText: 'Toudai no Mukou' }).click();
	await open(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(page.getByRole('status')).toContainText('HIGHLIGHT DELETED');
	await expect(rows(page)).toHaveCount(3);
	await expect(page.locator('header.bar .title')).toHaveText(/HIGHLIGHTS · 3/);
	await page.getByRole('status').getByRole('button', { name: 'UNDO' }).click();
	await expect(rows(page)).toHaveCount(4);
	await expect(page.locator('header.bar .title')).toHaveText(/HIGHLIGHTS · 4/);
});

test('reveal shows the hidden series’ highlight with the HIDDEN badge, and counts it', async ({
	page
}) => {
	await command(page, '/reveal');
	try {
		await page.goto('/highlights');
		await expect(rows(page)).toHaveCount(5);
		await expect(page.locator('header.bar .title')).toHaveText(/HIGHLIGHTS · 5/);
		await expect(rows(page).filter({ hasText: 'Kōhai no Himitsu Nikki' })).toContainText('HIDDEN');
	} finally {
		await command(page, '/hide');
	}
	await page.goto('/highlights');
	await expect(rows(page)).toHaveCount(4);
});

test('the series screen’s row, only when it has one, opens its highlights in reading order', async ({
	page
}) => {
	await page.goto('/');
	const db = new Database(dbPath, { readonly: true });
	const id = (title: string) =>
		(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
	const novel = id('Mushoku Tensei');
	const none = id('Sousou no Frieren');
	db.close();
	await page.goto(`/series/${none}`);
	await expect(page.locator('[data-highlights-row]:visible')).toHaveCount(0);
	await page.goto(`/series/${novel}`);
	const row = page.locator('[data-highlights-row]:visible');
	await expect(row).toHaveCount(1);
	await expect(row).toHaveText(/HIGHLIGHTS\s*2 · 1 NOTE\s*→/);
	await row.click();
	await expect(page).toHaveURL(new RegExp(`/highlights\\?series=${novel}$`));
	await expect(page.locator('header.bar .title')).toContainText('READING ORDER');
	// Reading order: chapter 1 before chapter 3, whatever order they were made in.
	await expect(rows(page)).toHaveText([/harbour/, /Nothing is only anything/]);
	await expect(page.locator('.lbl.day').last()).toHaveText(/— THE THIRTEENTH LAMP$/);
});

test('DELETE on the series screen says the highlights are kept, and keeps them, ORPHAN', async ({
	page
}) => {
	const db = new Database(dbPath, { readonly: true });
	const manga = (
		db.prepare(`SELECT id FROM series WHERE title = 'Dungeon Meshi'`).get() as { id: number }
	).id;
	db.close();
	await page.goto(`/series/${manga}`);
	await page.getByRole('button', { name: 'DELETE', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: /^DELETE DUNGEON MESHI\?/ });
	await expect(sheet.locator('[data-highlights-kept]')).toContainText('1 HIGHLIGHT IS KEPT');
	const toggle = sheet.getByRole('switch');
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await toggle.click();
	await expect(sheet.locator('button.go')).toHaveText('DELETE WITH 1 HIGHLIGHT');
	await toggle.click();
	await expect(sheet.locator('button.go')).toHaveText('DELETE');
	await sheet.locator('button.go').click();
	await expect(page).not.toHaveURL(new RegExp(`/series/${manga}$`));
	await page.goto('/highlights');
	const kept = rows(page).filter({ hasText: 'Dungeon Meshi' });
	await expect(kept.locator('.tag')).toHaveText(/FROM A SERIES NO LONGER IN THE LIBRARY/);
	await kept.click();
	await expect(open(page).getByRole('link', { name: /→$/ })).toHaveCount(0);
	await expect(open(page).getByRole('link', { name: 'SAVE IMAGE' })).toHaveAttribute(
		'href',
		/\/api\/highlights\/\d+\/copy\?save=1$/
	);
	const saved = await page.request.get(
		(await open(page).getByRole('link', { name: 'SAVE IMAGE' }).getAttribute('href'))!
	);
	expect(saved.headers()['content-disposition']).toBe(
		'attachment; filename="dungeon-meshi-ch2-p14.png"'
	);
	expect((await saved.body()).equals(PNG)).toBe(true);
});

test.describe('on a desktop', () => {
	// Context options only (a fine pointer, no touch): a worker-scoped one would
	// start this serial file's server a second time.
	test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

	test('the sidebar’s HIGHLIGHTS after HISTORY, and the open item beside the list', async ({
		page
	}) => {
		await page.goto('/highlights');
		const foot = page.locator('.side-foot > a');
		const names = await foot.allTextContents();
		const at = names.findIndex((n) => n.startsWith('HIGHLIGHTS'));
		expect(names[at - 1]).toBe('HISTORY');
		await expect(foot.nth(at)).toHaveText(/HIGHLIGHTS\s*4/);
		await expect(foot.nth(at)).toHaveAttribute('aria-current', 'page');
		await rows(page).first().click();
		// The open item is drawn once the navigation lands: measure after it,
		// or the list is measured at its full width (a race seen at repeat 5).
		await expect(page).toHaveURL(/open=\d+/);
		await expect(open(page)).toBeVisible();
		await expect(rows(page).first()).toHaveClass(/\bon\b/);
		const list = await page.locator('.list').boundingBox();
		const pane = await open(page).boundingBox();
		expect(pane!.width).toBe(560);
		expect(pane!.x).toBeGreaterThanOrEqual(list!.x + list!.width - 1);
	});
});

test('at zero the rows go, and /highlights says where they are made', async ({ page }) => {
	const db = new Database(dbPath);
	db.exec(`DELETE FROM highlights`);
	db.close();
	await page.goto('/');
	await page.getByRole('button', { name: 'MORE' }).click();
	await expect(more(page).getByRole('link', { name: /^HIGHLIGHTS/ })).toHaveCount(0);
	await page.goto('/highlights');
	await expect(page.locator('.empty')).toContainText('00 — NO HIGHLIGHTS YET');
});
