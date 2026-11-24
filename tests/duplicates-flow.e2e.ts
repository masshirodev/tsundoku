import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// (chmodSync, mkdirSync and writeFileSync are for "OPEN → past a stuck decision": real book files
// whose trash move a KEEP can fail on.)
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './helpers/hydrated';

/**
 * Duplicate books end to end (doc/DUPLICATE-BOOKS.md), on the seed's hidden
 * pair: Rakugaki Collection Vol. 3 and its [Digital] twin. Serial,
 * tablet-portrait only. This file owns both books; it ends on KEEP BOTH, so
 * nothing of the seed is deleted. Its last block runs its own preview and a
 * database of its own, because a decision the state refuses needs a
 * pair the seed does not hold: an edition the book already has.
 */
test.describe.configure({ mode: 'serial' });

async function command(page: Page, text: string) {
	await page.goto('/search');
	await page.getByRole('searchbox').fill(text);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
}

const band = (page: Page) => page.getByText(/POSSIBLE DUPLICATE/);
const tagOf = (page: Page, letter: 'A' | 'B') =>
	page.locator('.side', { has: page.locator('.letter', { hasText: letter }) }).locator('.tag');

test('a hidden pair has no band while reveal is off', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	await expect(band(page)).toHaveCount(0);
});

test('the pick comes selected with its reason; the other side can be chosen instead', async ({
	page
}) => {
	await command(page, '/reveal');
	await expect(band(page)).toContainText('01 POSSIBLE DUPLICATE');
	await page.getByRole('link', { name: 'REVIEW →' }).click();
	await page.waitForURL(/\/duplicates/);
	await expect(page.locator('.counter')).toHaveText('01 OF 01');
	await expect(page.locator('.conf')).toHaveText('LIKELY SAME');
	// Same pages, sharper [Digital]: rule 2 picks B.
	await expect(page.locator('.s2')).toContainText('PICK · B · SHARPER');
	await expect(page.locator('.s2')).toContainText('RULE 2 OF 5 · SHARPER');
	await expect(tagOf(page, 'B')).toHaveText('KEEP · PICK');
	await expect(tagOf(page, 'A')).toHaveText('TO TRASH');
	await expect(page.locator('.plabel')).toContainText(/\d+ MATCH · 0 ALONE/);

	await page.locator('.side', { has: page.locator('.letter', { hasText: 'A' }) }).click();
	await expect(tagOf(page, 'A')).toHaveText('KEEP · YOURS');
	await expect(page.locator('.s2')).toContainText('YOUR PICK · A · TSUNDOKU PICKED B');
	// What A would take over from B: B was rated, FAV'd and read.
	await expect(page.locator('.carry')).toContainText('TAKES OVER FROM B · RATING 8 · FAV · READ');
});

test('KEEP waits: UNDO brings the pair back, nothing deleted', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/duplicates');
	await page.getByRole('button', { name: 'KEEP B', exact: true }).click();
	await expect(page.locator('.review .band')).toContainText('KEPT B · A TO THE TRASH');
	await expect(page.getByText('00 — NO DUPLICATES')).toBeVisible();
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.counter')).toHaveText('01 OF 01');
});

test('the series screen offers the pair too, and REVIEW opens on it', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: '[Digital]' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.locator('.twin:visible')).toContainText(
		'SAME BOOK AS RAKUGAKI COLLECTION VOL. 3'
	);
	await page.locator('.twin:visible').getByRole('link', { name: 'REVIEW →' }).click();
	await page.waitForURL(/\/duplicates\?pair=/);
	await expect(page.locator('.counter')).toHaveText('01 OF 01');
});

test('the actions stay on screen under the reveal banner, however long the pair', async ({
	page
}) => {
	await command(page, '/reveal');
	await page.goto('/duplicates');
	const keep = page.getByRole('button', { name: 'KEEP BOTH', exact: true });
	const vh = page.viewportSize()!.height;
	const box = (await keep.boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual(vh);
	// Scrolled to the pages, they're still there.
	await page.locator('.plabel').scrollIntoViewIfNeeded();
	const after = (await keep.boundingBox())!;
	expect(after.y + after.height).toBeLessThanOrEqual(vh);
	expect(after.y).toBeGreaterThan(vh - 100);
});

test('side by side in landscape, one above the other in portrait', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/duplicates');
	const [a, b] = [page.locator('.side').nth(0), page.locator('.side').nth(1)];
	expect((await b.boundingBox())!.y).toBeGreaterThan((await a.boundingBox())!.y);
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect
		.poll(async () => (await b.boundingBox())!.y === (await a.boundingBox())!.y)
		.toBe(true);
});

test('KEEP BOTH settles it for good: the band goes', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/duplicates');
	await page.getByRole('button', { name: 'KEEP BOTH', exact: true }).click();
	await expect(page.locator('.review .band')).toContainText('KEPT BOTH · WON’T ASK AGAIN');
	await page.getByRole('link', { name: '← LIBRARY' }).click();
	await page.waitForURL(/\/$/);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	await expect(band(page)).toHaveCount(0);
});

// ---- a decision the state refuses ---------------------------------------------------
//
// A fold the library can't carry out -- the third language a book already has
// -- is decided here and carried out on the next pair's decision. The review
// must say so, and the pair must come back undecided rather than being retried
// on every load. Its own preview and database: the shared seed's only pair is
// a plain duplicate, and this file owns that pair's books.

const scratch = (name: string) =>
	mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), name));
const work = scratch('tsundoku-dupes-');
const dbPath = join(work, 'dupes.sqlite');
const library = join(work, 'library');
let preview: ChildProcess | null = null;
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

type World = { fold: string };

/**
 * The sample library, then two pairs of this block's own: a folded book with a
 * Japanese edition and a separate Japanese copy of it (the "third language"
 * the review offers and `foldEditions` refuses), and a plain duplicate to
 * decide second, which is what carries the refused fold out.
 */
function seedWorld(): World {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, LIBRARY_ROOT: library, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 6, 12, 0);
		// The seed's own pair is settled out of this block's way.
		db.prepare(
			`INSERT OR REPLACE INTO dupe_decisions (pair, decision, keep, at)
			SELECT p.a || ',' || p.b, 'apart', NULL, ? FROM dupe_pairs p`
		).run(now);
		const tag = db.prepare(
			`INSERT INTO tags (namespace, value) VALUES ('language', ?) ON CONFLICT DO UPDATE SET value = value`
		);
		const tagId = db.prepare(`SELECT id FROM tags WHERE namespace = 'language' AND value = ?`);
		const series = (title: string, originKey: string) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
						VALUES (?, ?, 'doujin', 'hentoid', 0, ?, ?, ?, 1, '')`
					)
					.run(root, title, now, now, originKey).lastInsertRowid
			);
		const entry = (
			seriesId: number,
			o: { language: string; shadowed?: boolean; editionOf?: number }
		) =>
			Number(
				db
					.prepare(
						`INSERT INTO entries (series_id, position, label, title, language, added_at, file, bytes,
							page_count, available, source_url, shadowed, edition_of)
						VALUES (?, 1, 'Book', ?, ?, ?, '', 0, 3, 1, ?, ?, ?)`
					)
					.run(
						seriesId,
						`Book ${seriesId}`,
						o.language,
						now,
						`/book/${seriesId}`,
						o.shadowed ? 1 : 0,
						o.editionOf ?? null
					).lastInsertRowid
			);
		const language = (seriesId: number, value: string) => {
			tag.run(value);
			db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
				seriesId,
				(tagId.get(value) as { id: number }).id
			);
		};
		const pair = (a: number, b: number, bits: number) =>
			db.prepare(`INSERT INTO dupe_pairs (a, b, bits, rows, found_at) VALUES (?, ?, ?, ?, ?)`).run(
				Math.min(a, b),
				Math.max(a, b),
				bits,
				JSON.stringify({
					rows: [1, 2, 3].map((n) => ({ a: n, b: n })),
					sizes: { [a]: [1200, 1700], [b]: [1200, 1700] }
				}),
				now
			);
		// The folded book: English with a Japanese edition inside it.
		const base = series('Fold Base', 'hentoid:fold-base');
		language(base, 'english');
		const baseEntry = entry(base, { language: 'english' });
		entry(base, { language: 'japanese', shadowed: true, editionOf: baseEntry });
		// A separate Japanese copy: the review offers it as the third language.
		const copy = series('Fold Copy', 'hentoid:fold-copy');
		language(copy, 'japanese');
		const copyEntry = entry(copy, { language: 'japanese' });
		pair(baseEntry, copyEntry, 0);
		// A plain duplicate, decided second.
		const twinA = series('Twin One', 'hentoid:twin-one');
		language(twinA, 'english');
		const twinB = series('Twin Two', 'hentoid:twin-two');
		language(twinB, 'english');
		pair(entry(twinA, { language: 'english' }), entry(twinB, { language: 'english' }), 1);
		return { fold: `${Math.min(baseEntry, copyEntry)},${Math.max(baseEntry, copyEntry)}` };
	} finally {
		db.close();
	}
}

let world: World | null = null;

test.describe('a fold the state refuses', () => {
	test.beforeAll(async () => {
		// It seeds a database and spawns a preview, then polls up to 60 s for
		// it: measured at 2-3 s with the other slots at work, and the house
		// budget is 120 s, so a loaded gate fails a case, never the hook.
		test.setTimeout(120_000);
		world = seedWorld();
		const port = await freePort();
		BASE = `http://localhost:${port}`;
		preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				LIBRARY_ROOT: library,
				COVER_DIR: join(work, 'covers'),
				TSUNDOKU_HOME: join(work, 'home'),
				BACKUP_DIR: join(work, 'backups')
			},
			stdio: 'ignore'
		});
		for (let i = 0; i < 120; i++) {
			try {
				if ((await fetch(`${BASE}/duplicates`, { redirect: 'manual' })).status) return;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		throw new Error('the duplicates preview never answered');
	});

	test.afterAll(() => {
		preview?.kill();
		rmSync(work, { recursive: true, force: true });
	});

	test('the pair comes back undecided, and the screen says why', async ({ page }) => {
		const fold = world!.fold;
		await page.goto(`${BASE}/duplicates?pair=${encodeURIComponent(fold)}`);
		await expect(page.locator('.counter')).toHaveText('01 OF 02');
		await expect(page.locator('.conf')).toHaveText('SAME BOOK · A THIRD LANGUAGE');
		await page.getByRole('button', { name: 'ADD AS A THIRD LANGUAGE' }).click();
		// The decision waits, as every decision does, until the next one.
		await expect(page.locator('.review .band')).toContainText('ADDED · FOLD BASE IN 3 LANGUAGES');
		// The next pair is drawn; its decision carries the fold out, and the
		// library refuses it: the third language is the one it already has.
		await expect(page.locator('.counter')).toHaveText('02 OF 02');
		await page.getByRole('button', { name: 'KEEP BOTH', exact: true }).click();
		await expect(
			page.locator('.band.refused').getByText(/A BOOK CAN.T FOLD · SOMETHING SITS BESIDE IT/)
		).toBeVisible();
		await expect(
			page.locator('.band.refused').getByText(/THE BOOK HAS A JAPANESE EDITION ALREADY/)
		).toBeVisible();
		// The pair is back in this visit's queue too, not only on the next load:
		// the counter and the pair shown are the fold's again.
		await expect(page.locator('.counter')).toHaveText('02 OF 02');
		await expect(page.locator('.conf')).toHaveText('SAME BOOK · A THIRD LANGUAGE');
		// Dropped, so the next load draws it again, undecided, and does not
		// carry it out behind the user's back.
		const db = new Database(dbPath, { readonly: true });
		try {
			expect(
				db.prepare(`SELECT decision FROM dupe_decisions WHERE pair = ?`).get(fold)
			).toBeUndefined();
		} finally {
			db.close();
		}
		await page.goto(`${BASE}/duplicates`);
		await expect(page.locator('.counter')).toHaveText('01 OF 01');
		await expect(page.locator('.conf')).toHaveText('SAME BOOK · A THIRD LANGUAGE');
		await expect(page.locator('.band.refused')).toHaveCount(0);
	});

	test('OPEN → on a refused fold says so and stays, never a book that isn’t folded', async ({
		page
	}) => {
		// The band's OPEN → carries the fold out now and opens the book. When the
		// state refuses it there is no folded book to open.
		await page.goto(`${BASE}/duplicates`);
		await expect(page.locator('.counter')).toHaveText('01 OF 01');
		await page.getByRole('button', { name: 'ADD AS A THIRD LANGUAGE' }).click();
		await page.getByRole('button', { name: 'OPEN →' }).click();
		await expect(
			page.locator('.band.refused').getByText(/A BOOK CAN.T FOLD · SOMETHING SITS BESIDE IT/)
		).toBeVisible();
		await expect(page).toHaveURL(/\/duplicates$/);
		// The decision the band's UNDO named is gone, so the band is too: there
		// is nothing left for UNDO to forget.
		await expect(page.getByRole('button', { name: 'UNDO', exact: true })).toHaveCount(0);
		// And the pair it was for is back in this visit's queue.
		await expect(page.locator('.counter')).toHaveText('01 OF 01');
		await expect(page.locator('.conf')).toHaveText('SAME BOOK · A THIRD LANGUAGE');
	});
});

// ---- OPEN → past another pair's stuck decision ---------------------------------------
//
// A KEEP that cannot move its loser to the trash (EACCES, here a folder with
// no write bit) stays waiting and is retried by every apply, while its band
// stays on screen. A fold decided after it is carried out all the same: OPEN →
// must open the folded book, not stop because the stuck KEEP's band is up.
// Its own database, library and preview, so the decisions above are untouched.

const work2 = scratch('tsundoku-dupes-open-');
const dbPath2 = join(work2, 'dupes.sqlite');
const library2 = join(work2, 'library');
let preview2: ChildProcess | null = null;
let BASE2 = '';
/** The two twin folders, made read-only while the KEEP is decided. */
let twinDirs: string[] = [];
type OpenWorld = { twin: string; fold: string; base: number };

function seedOpenWorld(): OpenWorld {
	rmSync(dbPath2, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath2, LIBRARY_ROOT: library2, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath2);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 6, 12, 0);
		db.prepare(
			`INSERT OR REPLACE INTO dupe_decisions (pair, decision, keep, at)
			SELECT p.a || ',' || p.b, 'apart', NULL, ? FROM dupe_pairs p`
		).run(now);
		const tag = db.prepare(
			`INSERT INTO tags (namespace, value) VALUES ('language', ?) ON CONFLICT DO UPDATE SET value = value`
		);
		const tagId = db.prepare(`SELECT id FROM tags WHERE namespace = 'language' AND value = ?`);
		const series = (title: string, originKey: string, path = '') =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, path, added_at, indexed_at, origin_key, in_library, cover_key)
						VALUES (?, ?, 'doujin', 'hentoid', 0, ?, ?, ?, ?, 1, '')`
					)
					.run(root, title, path, now, now, originKey).lastInsertRowid
			);
		const entry = (seriesId: number, language: string, file = '') =>
			Number(
				db
					.prepare(
						`INSERT INTO entries (series_id, position, label, title, language, added_at, file, bytes,
							page_count, available, source_url, shadowed, edition_of)
						VALUES (?, 1, 'Book', ?, ?, ?, ?, 0, 3, 1, ?, 0, NULL)`
					)
					.run(seriesId, `Book ${seriesId}`, language, now, file, `/book/${seriesId}`)
					.lastInsertRowid
			);
		const language = (seriesId: number, value: string) => {
			tag.run(value);
			db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
				seriesId,
				(tagId.get(value) as { id: number }).id
			);
		};
		const pair = (a: number, b: number, bits: number) =>
			db.prepare(`INSERT INTO dupe_pairs (a, b, bits, rows, found_at) VALUES (?, ?, ?, ?, ?)`).run(
				Math.min(a, b),
				Math.max(a, b),
				bits,
				JSON.stringify({
					rows: [1, 2, 3].map((n) => ({ a: n, b: n })),
					sizes: { [a]: [1200, 1700], [b]: [1200, 1700] }
				}),
				now
			);
		// The KEEP's pair first (bits 0): its books are real files, so the trash
		// move can be refused by the filesystem.
		for (const d of ['twin-a', 'twin-b']) {
			mkdirSync(join(library2, d), { recursive: true });
			writeFileSync(join(library2, d, 'book.cbz'), d);
		}
		const twinA = series('Twin One', 'hentoid:twin-one', library2);
		language(twinA, 'english');
		const twinB = series('Twin Two', 'hentoid:twin-two', library2);
		language(twinB, 'english');
		const twinAEntry = entry(twinA, 'english', 'twin-a/book.cbz');
		const twinBEntry = entry(twinB, 'english', 'twin-b/book.cbz');
		pair(twinAEntry, twinBEntry, 0);
		// Then a fold that succeeds: English and French editions of one book.
		const base = series('Open Base', 'hentoid:open-base');
		language(base, 'english');
		const baseEntry = entry(base, 'english');
		const copy = series('Open Copy', 'hentoid:open-copy');
		language(copy, 'french');
		const copyEntry = entry(copy, 'french');
		pair(baseEntry, copyEntry, 1);
		return {
			twin: `${Math.min(twinAEntry, twinBEntry)},${Math.max(twinAEntry, twinBEntry)}`,
			fold: `${Math.min(baseEntry, copyEntry)},${Math.max(baseEntry, copyEntry)}`,
			base
		};
	} finally {
		db.close();
	}
}

let openWorld: OpenWorld | null = null;

test.describe('OPEN → past a stuck decision', () => {
	test.beforeAll(async () => {
		test.setTimeout(120_000);
		openWorld = seedOpenWorld();
		twinDirs = ['twin-a', 'twin-b'].map((d) => join(library2, d));
		const port = await freePort();
		BASE2 = `http://localhost:${port}`;
		preview2 = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath2,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				LIBRARY_ROOT: library2,
				COVER_DIR: join(work2, 'covers'),
				TSUNDOKU_HOME: join(work2, 'home'),
				BACKUP_DIR: join(work2, 'backups')
			},
			stdio: 'ignore'
		});
		for (let i = 0; i < 120; i++) {
			try {
				if ((await fetch(`${BASE2}/duplicates`, { redirect: 'manual' })).status) return;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		throw new Error('the second preview (BASE2) never answered');
	});

	test.afterAll(() => {
		// Put the folders back before the tree is removed, whatever happened.
		for (const d of twinDirs) {
			try {
				chmodSync(d, 0o755);
			} catch {
				// Already gone, or never made.
			}
		}
		preview2?.kill();
		rmSync(work2, { recursive: true, force: true });
	});

	test('a stuck KEEP ahead does not keep OPEN → from opening the folded book', async ({ page }) => {
		// Both books' folders refuse a rename: whichever side KEEP loses, its
		// trash move fails, and the decision stays waiting.
		for (const d of twinDirs) chmodSync(d, 0o500);
		try {
			await page.goto(`${BASE2}/duplicates?pair=${encodeURIComponent(openWorld!.twin)}`);
			await expect(page.locator('.counter')).toHaveText('01 OF 02');

			// KEEP, through the review's own button.
			await page.getByRole('button', { name: /^KEEP [AB]$/ }).click();
			await expect(page.locator('.review .band')).toContainText(/KEPT [AB]/);
			await expect(page.locator('.counter')).toHaveText('02 OF 02');

			// The fold is decided second: deciding it carries the KEEP out, the
			// move fails, and the band says the decision stays waiting.
			await page.getByRole('button', { name: 'FOLD INTO ONE BOOK' }).click();
			await expect(page.locator('.band.failed')).toContainText('IT STAYS WAITING');

			// The fold itself was carried out. OPEN → opens it, though the stuck
			// KEEP's band is still up: that band names another pair.
			await page.getByRole('button', { name: 'OPEN →' }).click();
			await expect(page).toHaveURL(new RegExp(`/series/${openWorld!.base}$`));
		} finally {
			for (const d of twinDirs) chmodSync(d, 0o755);
		}
	});

	test('UNDO of a carried-out decision says so and puts nothing back', async ({ page }) => {
		// The case above left its stuck KEEP waiting, and every apply retries it.
		// Take it out: this case is about UNDO's own answer, not that failure.
		const db = new Database(dbPath2);
		try {
			db.prepare(`DELETE FROM dupe_decisions WHERE pair = ?`).run(openWorld!.twin);
		} finally {
			db.close();
		}
		await page.goto(`${BASE2}/duplicates?pair=${encodeURIComponent(openWorld!.twin)}`);
		await expect(page.locator('.counter')).toHaveText('01 OF 01');
		await page.getByRole('button', { name: 'GROUP AS A SERIES' }).click();
		await expect(page.locator('.review .band')).toContainText('GROUPED AS A SERIES');
		// A library load carries the waiting GROUP out, behind this screen:
		// `undoDecision` now answers `{undone: false}` with a 200.
		await page.request.get(`${BASE2}/`);
		await page.getByRole('button', { name: 'UNDO' }).click();
		await expect(page.locator('.review .band')).toContainText(
			'THE DECISION WAS ALREADY CARRIED OUT'
		);
		// Nothing comes back to the queue: the pair is one series now.
		await expect(page.locator('.counter')).toHaveText('00');
		await expect(page.getByRole('button', { name: 'UNDO' })).toHaveCount(0);
	});
});
