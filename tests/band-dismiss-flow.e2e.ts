import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { type Locator, type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * The ✕ on a band that reports something done (doc/BANDS.md). There is
 * no component-test harness in this repo, so this flow is the cell's test too:
 * the label, the place after UNDO, and each way a band can be stored. Its own
 * preview and seeded database, because the stored band is a finished scan, and
 * a finished scan changes what the library's load shows every other flow. It
 * runs once, on the tablet, as every flow does; the TV's stop is in
 * `tests/tv-servers.e2e.ts`. The port is the OS's to give.
 */
test.describe.configure({ mode: 'serial' });

const DISMISS = 'Dismiss this band';

let work = '';
let dbPath = '';
let preview: ChildProcess | null = null;
let BASE = '';
let seriesId = 0;

function freePort(): Promise<number> {
	return new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});
}

test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-bands-'));
	dbPath = join(work, 'library.sqlite');
	mkdirSync(join(work, 'library'));
	const env = {
		...process.env,
		DATABASE_PATH: dbPath,
		LIBRARY_ROOT: join(work, 'library'),
		NODE_NO_WARNINGS: '1'
	};
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env,
		stdio: 'pipe'
	});
	const db = new Database(dbPath, { readonly: true });
	seriesId = (db.prepare(`SELECT id FROM series ORDER BY id LIMIT 1`).get() as { id: number }).id;
	db.close();
	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...env,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			COVER_DIR: join(work, 'covers'),
			TSUNDOKU_HOME: join(work, 'home'),
			BACKUP_DIR: join(work, 'backups')
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${BASE}/`, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the bands preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	if (work) rmSync(work, { recursive: true, force: true });
});

const band = (page: Page, text: string | RegExp) =>
	page.locator('.band:visible', { hasText: text });
const x = (b: Locator) => b.getByRole('button', { name: DISMISS });
const seriesUrl = (query: string) => `${BASE}/series/${seriesId}?${query}`;
const added = (page: Page) => band(page, 'ADDED TO THE LIBRARY');
const moved = (page: Page) => band(page, /^MOVED TO/);
const undoAction = (b: Locator) => b.locator('form').getAttribute('action');
/**
 * Two URL bands that share no parameter. No redirect writes both at once, so
 * this is only for what stacking does to the screen. `added` must stay out of
 * it: a move reads it as a count and the created band as "into an existing
 * series", so with it here ✕ on MOVED would rewrite the created band.
 */
const STACKED = 'moved=1&kept=2&created=2&order=X';
const groupedBand = (page: Page) => band(page, 'SERIES CREATED');
/** Everything the series screen's bands could have touched. */
function shelfRows() {
	const db = new Database(dbPath, { readonly: true });
	const rows = {
		series: db.prepare(`SELECT id, title, hidden FROM series ORDER BY id`).all(),
		entries: db.prepare(`SELECT id, series_id, position FROM entries ORDER BY id`).all()
	};
	db.close();
	return rows;
}

test('ADDED TO THE LIBRARY: ✕ clears it and its URL, a reload keeps it gone, the series stays', async ({
	page
}) => {
	const before = new Database(dbPath, { readonly: true });
	const count = () => (before.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n;
	const series = count();

	await page.goto(seriesUrl('added=source~e2e&queued=3&keep=1'));
	await expect(added(page)).toBeVisible();
	const chips = page.locator('.added-shelves');
	await expect(chips).toBeVisible();
	expect(await undoAction(added(page))).toBe('?/undoSourceAdd');
	// The cell comes after UNDO, last in the band.
	await expect(x(added(page))).toHaveText('✕');
	const order = await added(page).evaluate((el) =>
		[...el.querySelectorAll('button')].map((b) => b.textContent?.trim())
	);
	expect(order).toEqual(['UNDO', '✕']);

	await x(added(page)).click();
	await expect(added(page)).toHaveCount(0);
	await expect(chips).toHaveCount(0);
	await expect(page).toHaveURL(/\?keep=1$/);
	await page.reload();
	await expect(added(page)).toHaveCount(0);
	await expect(page.locator('h1').first()).toBeVisible();
	expect(count()).toBe(series);
	before.close();
});

test('GROUP into an existing series: one band, its UNDO takes the book out, and ✕ leaves the rest', async ({
	page
}) => {
	// The real redirect's URL (`src/routes/+page.server.ts`): here `added` is an entry id.
	const db = new Database(dbPath, { readonly: true });
	const entry = (
		db.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY id LIMIT 1`).get(seriesId) as {
			id: number;
		}
	).id;
	db.close();
	const before = shelfRows();

	await page.goto(seriesUrl(`created=1&order=X&added=${entry}`));
	const grouped = band(page, '1 BOOKS ADDED');
	await expect(grouped).toBeVisible();
	await expect(added(page)).toHaveCount(0);
	await expect(page.locator('.added-shelves')).toHaveCount(0);
	expect(await undoAction(grouped)).toBe('?/undoAdd');
	await expect(grouped.locator('input[name="entry"]')).toHaveValue(String(entry));

	await x(grouped).click();
	await expect(grouped).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/series/${seriesId}$`));
	await page.reload();
	await expect(band(page, /ADDED|SERIES CREATED/)).toHaveCount(0);
	expect(shelfRows()).toEqual(before);

	// A novel's GROUP counts volumes, and says so in one more parameter.
	await page.goto(seriesUrl(`created=1&order=X&unit=volumes&added=${entry}`));
	const volumes = band(page, '1 VOLUMES ADDED');
	await expect(volumes).toBeVisible();
	await x(volumes).click();
	await expect(volumes).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/series/${seriesId}$`));
});

test('a real MOVE: one band, MOVED, with its counts, and ✕ clears all of its URL', async ({
	page
}) => {
	const before = shelfRows();
	await page.goto(seriesUrl('moved=1&added=5&kept=2'));
	await expect(moved(page)).toBeVisible();
	await expect(moved(page)).toContainText(/5 \w+S ADDED, NOT DOWNLOADED/);
	await expect(moved(page)).toContainText(/2 KEPT FROM/);
	await expect(page.locator('.band:visible')).toHaveCount(1);
	await expect(added(page)).toHaveCount(0);
	expect(await undoAction(moved(page))).toBe('?/undoMove');

	await x(moved(page)).click();
	await expect(moved(page)).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/series/${seriesId}$`));

	// A count of 0 and a move that lost highlights are the values beside it.
	await page.goto(seriesUrl('moved=1&added=0&kept=0&lost=3&keep=1'));
	await expect(moved(page)).toBeVisible();
	await expect(added(page)).toHaveCount(0);
	await x(moved(page)).click();
	await expect(moved(page)).toHaveCount(0);
	await expect(page).toHaveURL(/\?keep=1$/);
	expect(shelfRows()).toEqual(before);
});

test('a dismissed band is not in Back: the entry was replaced', async ({ page }) => {
	await page.goto(`${BASE}/`);
	await page.goto(seriesUrl('added=source~e2e'));
	await x(added(page)).click();
	await expect(added(page)).toHaveCount(0);
	await page.goBack();
	await expect(page).toHaveURL(`${BASE}/`);
	await page.goForward();
	await expect(page).toHaveURL(new RegExp(`/series/${seriesId}$`));
	await expect(added(page)).toHaveCount(0);
});

test('clearing the URL keeps the place and, when focus is elsewhere, the focus', async ({
	page
}) => {
	// Short enough that losing the band and its chips cannot clamp the scroll.
	await page.setViewportSize({ width: 800, height: 300 });
	await page.goto(seriesUrl(STACKED));
	await expect(moved(page)).toBeVisible();
	await expect(groupedBand(page)).toBeVisible();
	await page.evaluate(() => window.scrollTo(0, 200));
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
	// What stays still is what the user sees; the browser's scroll anchoring
	// is what keeps it there when a band above goes, so scrollY itself moves.
	const list = page.locator('.list-col').first();
	const before = (await list.boundingBox())!.y;

	// A programmatic press does not move focus, as a keyboard's ✕ would.
	const undo = groupedBand(page).getByRole('button', { name: 'UNDO' });
	// Above the fold from here, and a plain focus() would scroll to it.
	await undo.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
	await x(moved(page)).evaluate((el) => (el as HTMLElement).click());
	await expect(moved(page)).toHaveCount(0);
	await expect(page).toHaveURL(/created=2/);
	// 5 px measured; a scroll to the top would move it by about 200.
	expect(Math.abs((await list.boundingBox())!.y - before)).toBeLessThanOrEqual(16);
	await expect(undo).toBeFocused();
});

test('✕ on one of two stacked bands leaves the other as it was, either way round', async ({
	page
}) => {
	await page.goto(seriesUrl(STACKED));
	await expect(groupedBand(page)).toContainText('SERIES CREATED · 2 BOOKS');
	expect(await undoAction(groupedBand(page))).toBe('?/ungroup');
	await x(moved(page)).click();
	await expect(moved(page)).toHaveCount(0);
	await expect(groupedBand(page)).toContainText('SERIES CREATED · 2 BOOKS');
	await expect(groupedBand(page)).toContainText('ORDERED X');
	expect(await undoAction(groupedBand(page))).toBe('?/ungroup');

	await page.goto(seriesUrl(STACKED));
	await expect(moved(page)).toContainText(/2 KEPT FROM/);
	await x(groupedBand(page)).click();
	await expect(groupedBand(page)).toHaveCount(0);
	await expect(moved(page)).toBeVisible();
	await expect(moved(page)).toContainText(/2 KEPT FROM/);
	expect(await undoAction(moved(page))).toBe('?/undoMove');
	await expect(page).toHaveURL(new RegExp(`\\?moved=1&kept=2$`));
});

test('bands stacked: hit areas do not overlap, and a double press takes only one', async ({
	page
}) => {
	await page.goto(seriesUrl(STACKED));
	await expect(moved(page)).toBeVisible();
	await expect(groupedBand(page)).toBeVisible();
	const first = (await x(moved(page)).boundingBox())!;
	const second = (await x(groupedBand(page)).boundingBox())!;
	const nextBand = (await groupedBand(page).boundingBox())!;
	const firstBand = (await moved(page).boundingBox())!;
	expect(first.y + first.height).toBeLessThanOrEqual(nextBand.y + 0.5);
	expect(firstBand.y + firstBand.height).toBeLessThanOrEqual(second.y + 0.5);

	// The second press of a double tap: on the place the first ✕ was, the
	// moment that band has gone and the next has moved up there.
	const secondPress = page.evaluate(
		([px, py, title]) =>
			new Promise<boolean>((done) => {
				const gone = () =>
					![...document.querySelectorAll('.band')].some((b) => b.textContent?.includes(title));
				const seen = new MutationObserver(() => {
					if (!gone()) return;
					seen.disconnect();
					const at = document.elementFromPoint(px, py) as HTMLElement | null;
					const hitsNext = at?.getAttribute('aria-label') === 'Dismiss this band';
					at?.click();
					done(hitsNext);
				});
				seen.observe(document.body, { childList: true, subtree: true });
			}),
		[first.x + first.width / 2, first.y + first.height / 2, 'MOVED TO'] as const
	);
	await x(moved(page)).click();
	expect(await secondPress).toBe(true);
	await expect(moved(page)).toHaveCount(0);
	await expect(groupedBand(page)).toBeVisible();
	await page.waitForTimeout(150);
	await expect(groupedBand(page)).toBeVisible();
	await expect(page).toHaveURL(/created=2/);
});

test('a form answer: ✕ clears it, and the next answer draws a new band', async ({ page }) => {
	await page.goto(seriesUrl('moved=1'));
	const undo = moved(page).getByRole('button', { name: 'UNDO' });
	const refusal = band(page, 'THE WAY BACK HAS CLOSED');

	await undo.click();
	await expect(refusal).toBeVisible();
	await expect(moved(page)).toHaveCount(0);

	await x(refusal).click();
	await expect(refusal).toHaveCount(0);
	// The refusal hid the URL's band; with it gone, the URL's band is back.
	await expect(moved(page)).toBeVisible();

	await undo.click();
	await expect(refusal).toBeVisible();
});

test('a URL band: its ✕ navigates, so a form answer on screen goes with it', async ({ page }) => {
	const db = new Database(dbPath, { readonly: true });
	const entry = (
		db.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY id LIMIT 1`).get(seriesId) as {
			id: number;
		}
	).id;
	db.close();
	await page.goto(seriesUrl('moved=1&kept=2'));
	await expect(moved(page)).toBeVisible();
	// The chapter menu's READ THROUGH HERE, through the form it submits.
	await page.locator('form[action="?/markThrough"]').evaluate((f, id) => {
		(f.querySelector('input[name="through"]') as HTMLInputElement).value = String(id);
		(f as HTMLFormElement).requestSubmit();
	}, entry);
	const answer = band(page, 'READ THROUGH');
	await expect(answer).toBeVisible();
	await expect(moved(page)).toBeVisible();

	await x(moved(page)).click();
	await expect(moved(page)).toHaveCount(0);
	await expect(answer).toHaveCount(0);
});

test('✕ while UNDO is mid-flight: the band goes, and UNDO still answers', async ({ page }) => {
	let release = () => undefined as void;
	const held = new Promise<void>((done) => (release = done));
	await page.route('**/*', async (route) => {
		if (route.request().method() === 'POST' && route.request().url().includes('undoMove'))
			await held;
		await route.continue();
	});
	await page.goto(seriesUrl('moved=1'));
	const answered = page.waitForResponse((r) => r.url().includes('undoMove'));
	await moved(page).getByRole('button', { name: 'UNDO' }).click();
	await x(moved(page)).click();
	await expect(moved(page)).toHaveCount(0);
	await expect(page).not.toHaveURL(/moved=1/);

	release();
	await answered;
	await expect(band(page, 'THE WAY BACK HAS CLOSED')).toBeVisible();
	await expect(x(band(page, 'THE WAY BACK HAS CLOSED'))).toBeVisible();
});

test('the stored band: two tabs, one row, and a new import brings a new band', async ({
	browser
}) => {
	const stage = () => {
		const db = new Database(dbPath);
		const now = Date.now();
		const id = Number(
			db
				.prepare(
					`INSERT INTO scan_jobs (started_at, finished_at, source_label, series_found) VALUES (?, ?, 'MIHON', 3)`
				)
				.run(now - 60_000, now - 1_000).lastInsertRowid
		);
		db.close();
		return id;
	};
	const stamp = (id: number) => {
		const db = new Database(dbPath, { readonly: true });
		const row = db.prepare(`SELECT dismissed_at FROM scan_jobs WHERE id = ?`).get(id) as {
			dismissed_at: number | null;
		};
		db.close();
		return row.dismissed_at;
	};
	const id = stage();
	const context = await browser.newContext();
	try {
		const a = await context.newPage();
		const b = await context.newPage();
		const finished = (p: Page) => p.locator('.band.act:visible', { hasText: 'IMPORT FINISHED' });
		await a.goto(`${BASE}/`);
		await b.goto(`${BASE}/`);
		await expect(finished(a)).toBeVisible();
		await expect(finished(b)).toBeVisible();
		// With no ?shelf= the grid's default is the import's own shelf.
		const heading = a.getByText(/just imported/i);
		const shelf = a.locator('.tabs [aria-current="page"]').first();
		await expect(heading).toBeVisible();
		await expect(shelf).toHaveAttribute('data-focus-id', 'shelf-new');

		await x(finished(a)).click();
		await expect(finished(a)).toHaveCount(0);
		// ✕ stays here: only TIDY NEW goes on to the NEW shelf.
		await expect(a).toHaveURL(`${BASE}/`);
		// Dismissing ends the import's default view: the shelf falls back to ALL.
		await expect(heading).toHaveCount(0);
		await expect(shelf).toHaveAttribute('data-focus-id', 'shelf-all');
		const first = stamp(id);
		expect(first).not.toBeNull();

		// The other tab drew it before: its ✕ is the same row again.
		await x(finished(b)).click();
		await expect(finished(b)).toHaveCount(0);
		await expect(b.locator('.band', { hasText: 'NOTHING CHANGED' })).toHaveCount(0);

		await a.reload();
		await b.reload();
		await expect(finished(a)).toHaveCount(0);
		await expect(finished(b)).toHaveCount(0);

		stage();
		await a.reload();
		await expect(finished(a)).toBeVisible();
	} finally {
		await context.close();
	}
});

/**
 * IMPORT FINISHED's ✕ is a stored band's, not a form answer: it clears the
 * band on the workstation and leaves the page's `form` alone. It used plain
 * `use:enhance`, so its own answer became the new `form` and took a HIDE
 * band on screen with it, UNDO and all.
 */
test('IMPORT FINISHED’s ✕ leaves a HIDE band on screen, and its UNDO', async ({ page }) => {
	const db = new Database(dbPath);
	const now = Date.now();
	db.prepare(
		`INSERT INTO scan_jobs (started_at, finished_at, source_label, series_found) VALUES (?, ?, 'MIHON', 3)`
	).run(now - 60_000, now - 1_000);
	db.close();
	await page.goto(`${BASE}/?shelf=all`);
	const finished = page.locator('.band.act:visible', { hasText: 'IMPORT FINISHED' });
	await expect(finished).toBeVisible();
	// HIDE over one series, as the bulk bar posts it: the answer is the band.
	await page.evaluate((id) => {
		const f = document.createElement('form');
		f.method = 'POST';
		f.action = '?/hideAll';
		f.innerHTML = `<input type="hidden" name="id" value="${id}">`;
		document.body.append(f);
		f.submit();
	}, seriesId);
	const hidden = band(page, 'HIDDEN · 1 SERIES');
	await expect(hidden).toBeVisible();
	await expect(finished).toBeVisible();

	await x(finished).click();
	await expect(finished).toHaveCount(0);
	await page.waitForLoadState('networkidle');
	await expect(hidden).toBeVisible();
	// And its UNDO still works: the series is shown again.
	await hidden.getByRole('button', { name: 'UNDO' }).click();
	await expect(hidden).toHaveCount(0);
	const after = new Database(dbPath, { readonly: true });
	const row = after.prepare(`SELECT hidden FROM series WHERE id = ?`).get(seriesId) as {
		hidden: number;
	};
	after.close();
	expect(row.hidden).toBe(0);
});

/** A quote on the first series, through the columns `tests/highlights-flow.e2e.ts` writes. */
function putHighlight(quote: string): number {
	const db = new Database(dbPath);
	const info = db
		.prepare(
			`INSERT INTO highlights (kind, series_id, entry_id, origin_key, number, season, block, block_offset,
				page, clip_in, clip_out, series_title, series_kind, entry_label, entry_title, quote, paragraph,
				context, colour, note, made_at, hidden, copy_path, still_path, copy_bytes, copy_width, copy_height)
			VALUES ('quote', ?, NULL, NULL, 1, NULL, 0, 0, NULL, NULL, NULL, 'Band Series', 'novel', 'Ch. 1', '',
				?, ?, '', NULL, '', ?, 0, '', '', 0, NULL, NULL)`
		)
		.run(seriesId, quote, quote, Date.now());
	db.close();
	return Number(info.lastInsertRowid);
}
const deletedAt = (id: number) => {
	const db = new Database(dbPath, { readonly: true });
	const row = db.prepare(`SELECT deleted_at AS at FROM highlights WHERE id = ?`).get(id) as {
		at: number | null;
	};
	db.close();
	return row.at;
};

test('/highlights: ✕ takes HIGHLIGHT DELETED, a reload keeps it gone, it stays deleted, and the next one draws', async ({
	page,
	context
}) => {
	const one = putHighlight('Quote one to delete');
	const two = putHighlight('Quote two to delete');
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
	await page.goto(`${BASE}/highlights`);
	const row = (q: string) => page.locator('a.hl', { hasText: q });
	const open = page.locator('aside.open');
	const deleted = band(page, 'HIGHLIGHT DELETED');

	await row('Quote one').click();
	await open.getByRole('button', { name: 'COPY', exact: true }).click();
	const copied = band(page, 'COPIED · 1');
	await expect(copied).toBeVisible();
	// The open quote covers the band on a tablet; COPY leaves it open.
	await open.getByRole('link', { name: 'Close' }).click();
	await x(copied).click();
	await expect(copied).toHaveCount(0);
	await page.reload();
	await expect(copied).toHaveCount(0);

	await row('Quote one').click();
	await open.getByRole('button', { name: 'DELETE' }).click();
	await expect(deleted).toBeVisible();
	await x(deleted).click();
	await expect(deleted).toHaveCount(0);
	await page.reload();
	await expect(deleted).toHaveCount(0);
	expect(deletedAt(one), 'dismiss is not UNDO').not.toBeNull();

	// A new event brings a new band, the way a real answer does.
	await row('Quote two').click();
	await open.getByRole('button', { name: 'DELETE' }).click();
	await expect(deleted).toBeVisible();
	expect(deletedAt(two)).not.toBeNull();

	// A refusal, as `?/undo` answers one when the row is gone for good: its own ✕.
	const gone = new Database(dbPath);
	gone.prepare(`DELETE FROM highlights WHERE id = ?`).run(two);
	gone.close();
	await deleted.getByRole('button', { name: 'UNDO' }).click();
	const refused = band(page, 'THAT HIGHLIGHT HAS GONE FOR GOOD');
	await expect(refused).toBeVisible();
	await x(refused).click();
	await expect(refused).toHaveCount(0);
	await page.reload();
	await expect(refused).toHaveCount(0);
});

test('/search: ✕ takes HIDDEN, a reload keeps it gone, and the Work stays hidden', async ({
	page
}) => {
	// Named: the stored-band case above leaves an import band up, and with one
	// the library opens on NEW.
	await page.goto(`${BASE}/?shelf=all`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	// Two the seed can group: the pair `works-library-frame` makes a Work of.
	for (const title of ["Omniscient Reader's Viewpoint", 'Hoshi no Umi no Tabibito'])
		await page
			.locator('.grid .tile')
			.filter({ has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) })
			.locator('.open')
			.click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const group = page.getByRole('dialog', { name: 'Group into a series' });
	await group.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await group.getByRole('textbox', { name: 'Work name' }).fill('Bandhide Run');
	await group.getByRole('button', { name: /CREATE WORK/ }).click();
	await expect(page.locator('.band', { hasText: 'BANDHIDE RUN IS A WORK' })).toBeVisible();

	// HIDE on a hit's sheet, the one that hands /search its band.
	await page.goto(`${BASE}/search?q=Omniscient`);
	// A part of a Work: a series hit, so its sheet is the one that hands the band over.
	await page.locator('.hit:not(.work)', { hasText: "Omniscient Reader's Viewpoint" }).click();
	const sheet = page.getByRole('dialog', { name: "Omniscient Reader's Viewpoint" });
	await sheet.getByRole('button', { name: /HIDE ALL 2/ }).click();
	const hidden = band(page, 'HIDDEN');
	await expect(hidden).toBeVisible();
	await expect(hidden.getByRole('button', { name: 'UNDO' })).toBeVisible();
	await x(hidden).click();
	await expect(hidden).toHaveCount(0);
	await page.reload();
	await expect(hidden).toHaveCount(0);

	const db = new Database(dbPath, { readonly: true });
	const hiddenCount = db
		.prepare(
			`SELECT COUNT(*) AS n FROM series s JOIN work_series w ON w.series_id = s.id WHERE s.hidden = 1`
		)
		.get() as { n: number };
	db.close();
	expect(hiddenCount.n, 'dismiss is not UNDO').toBeGreaterThan(0);
});

test('SETTINGS: ✕ takes the sign-in band and its URL, and a reload keeps it gone', async ({
	page
}) => {
	await page.goto(`${BASE}/settings?signin=ok&service=anilist`);
	const signin = band(page, 'SIGNED IN TO');
	await expect(signin).toBeVisible();
	await x(signin).click();
	await expect(signin).toHaveCount(0);
	await expect.poll(() => new URL(page.url()).search).toBe('');
	await page.reload();
	await expect(signin).toHaveCount(0);
});

test('a band that says what is true now has no ✕', async ({ context, page }) => {
	await context.addCookies([{ name: 'tsundoku_incognito', value: '1', url: BASE }]);
	await page.goto(`${BASE}/`);
	const incognito = page.locator('.band.dashed');
	await expect(incognito).toBeVisible();
	await expect(x(incognito)).toHaveCount(0);
});

test('the library band from the URL leaves the rest of its URL alone', async ({ page }) => {
	await page.goto(`${BASE}/?sort=title&band=ungrouped&facts=%7B%7D&name=Kaze`);
	const gone = band(page, 'UNGROUPED');
	await expect(gone).toBeVisible();
	await x(gone).click();
	await expect(gone).toHaveCount(0);
	await expect(page).toHaveURL(`${BASE}/?sort=title`);
});

test.describe('a browser that speaks Portuguese', () => {
	test.use({ locale: 'pt-BR' });

	test('the ✕ is named in Portuguese', async ({ page }) => {
		await page.goto(seriesUrl('added=source~e2e'));
		await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
		await expect(page.getByRole('button', { name: 'Dispensar este aviso' })).toBeVisible();
	});
});
