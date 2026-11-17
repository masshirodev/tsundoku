import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { revealOn } from './helpers/reveal';

/**
 * Two one-offs added from a source and grouped keep READ ONLINE and DOWNLOAD,
 * and UNDO and UNGROUP give each its link back (card c885; doc/BOOKS.md,
 * "Where a book's origin lives"). On a book's own page those two are its own
 * offer, and a failed download offers RETRY (c885's last piece). READ ONLINE is
 * the book's own answer, not the group's: a book whose source lost its
 * extension, or which holds no key at all, is offered neither cell while its
 * twin is offered both (c885, round 2). It's in the browse project (its name)
 * for the fake engine, but in a world of its own: a gallery source only exists
 * here (the browse world's sources aren't galleries, and a one-off from one is
 * a manga, which GROUP won't bind), and every case groups, downloads and
 * ungroups. The one-offs come through the app's own ADD and GROUP, never a
 * seeded row; the two lost states are the world's own rows, which no door
 * writes.
 */

const SOURCE = { id: '500', pkg: 'e2e.gallery', name: 'nhentai' };
/** A second gallery source, so one book's own source can lose its extension (c885, round 2). */
const SOURCE2 = { id: '501', pkg: 'e2e.gallery2', name: 'hitomi' };
const previewOf = (url: string, sourceId = SOURCE.id) =>
	`${sourceId}~${Buffer.from(url).toString('base64url')}`;

let work: string;
let dbPath: string;
let base: string;
let preview: ChildProcess | undefined;
let engine: Server;
/** Sources whose page list the fake refuses, so a download can fail (c885's RETRY). */
const failing = new Set<string>();

function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address() as AddressInfo;
			s.close(() => resolve(port));
		});
	});
}

function startEngine(port: number, image: Buffer): Promise<Server> {
	const server = createHttp((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			if (req.url?.startsWith('/image/')) {
				res.writeHead(200, { 'content-type': 'image/png' }).end(image);
				return;
			}
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			if (req.url === '/challenges') return json({ solving: {}, solved: {} });
			const b = JSON.parse(raw || '{}') as {
				method: string;
				mangaData?: { url: string };
				chapterData?: { url?: string };
			};
			const url = b.mangaData?.url ?? '';
			if (
				b.method === 'getPageList' &&
				[...failing].some((f) => (b.chapterData?.url ?? '').includes(f))
			)
				// A site that refuses: the worker counts the try and fails the chapter
				// after MAX_TRIES, which is what c885's RETRY waits for.
				return res.writeHead(500, { 'content-type': 'application/json' }).end('{"code":500}');
			switch (b.method) {
				case 'getDetailsManga':
					return json({ url, title: `Gallery ${url.split('/').pop()}`, status: 2 });
				case 'getChapterList':
					// A gallery: one chapter, under its own URL.
					return json([
						{ url: `${url}/read`, name: 'Chapter', scanlator: null, chapter_number: 1 }
					]);
				case 'getPageList':
					return json(
						[0, 1].map((index) => ({
							index,
							url: '',
							imageUrl: `http://127.0.0.1:${port}/image/${index}.png`
						}))
					);
				default:
					return res.writeHead(404).end('{}');
			}
		});
	});
	return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-group-origin-'));
	dbPath = join(work, 'library.sqlite');
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		for (const s of [SOURCE, SOURCE2]) {
			db.prepare(
				`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
				VALUES (?, ?, 'manga', 1, '1', '1.6', ?, 0, 0, '')`
			).run(s.pkg, s.name, s.pkg.padEnd(64, '0'));
			db.prepare(
				`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://g.example')`
			).run(s.id, s.pkg, s.name);
		}
	} finally {
		db.close();
	}
	const image = await sharp({
		create: { width: 120, height: 170, channels: 3, background: '#778' }
	})
		.png()
		.toBuffer();
	const enginePort = await freePort();
	engine = await startEngine(enginePort, image);
	const port = await freePort();
	base = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			ENGINE_URL: `http://127.0.0.1:${enginePort}`,
			ENGINE_TOKEN: 'e2e-engine-token',
			TSUNDOKU_ANILIST: 'off',
			TSUNDOKU_HOME: join(work, 'home'),
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
			ENGINE_STORE: join(work, 'store'),
			BACKUP_DIR: join(work, 'backups')
		},
		stdio: 'ignore'
	});
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			up = (await fetch(base, { redirect: 'manual' })).status > 0;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	expect(up, 'the preview answered').toBe(true);
});

test.afterAll(async () => {
	preview?.kill();
	await new Promise<void>((ok) => (engine ? engine.close(() => ok()) : ok()));
	if (work) rmSync(work, { recursive: true, force: true });
});

const url = (path: string) => `${base}${path}`;

async function reveal(page: Page) {
	await revealOn(page.context(), base);
}

/** ADD from the preview: a one-off, as the owner's were. */
async function addFromSource(page: Page, n: string, source = SOURCE) {
	await page.goto(url(`/downloads/source/${previewOf(`/g/${n}`, source.id)}`));
	await page.getByRole('button', { name: /^\+ ADD/ }).click();
	await page.waitForURL(/\/series\/\d+/);
	return Number(new URL(page.url()).pathname.split('/').pop());
}

/** SELECT the two on the library grid and open GROUP. */
async function openGroup(page: Page, titles: string[]) {
	await page.goto(url('/?shelf=all&sort=added'));
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of titles)
		await page
			.locator('.grid .tile')
			.filter({ has: page.locator('.title', { hasText: new RegExp(`^${t}$`) }) })
			.locator('.open')
			.click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	return page.getByRole('dialog', { name: 'Group into a series' });
}

function dbGet<T>(sql: string, ...args: unknown[]): T {
	const db = new Database(dbPath, { readonly: true });
	try {
		db.pragma('busy_timeout = 5000');
		return db.prepare(sql).get(...args) as T;
	} finally {
		db.close();
	}
}

/** The world's own rows, written the way a lost extension row really is (c885). */
function dbRun(sql: string, ...args: unknown[]): void {
	const db = new Database(dbPath);
	try {
		db.pragma('busy_timeout = 5000');
		db.prepare(sql).run(...args);
	} finally {
		db.close();
	}
}

/** A book's entry, by the title the world's fake gave it. */
const entryId = (series: number, title: string) =>
	dbGet<{ id: number }>(
		`SELECT id FROM entries WHERE series_id = ? AND title = ? ORDER BY id LIMIT 1`,
		series,
		title
	).id;

test.describe('as a series of books', () => {
	let seriesId: number;

	test('two undownloaded one-offs group and still offer READ ONLINE and DOWNLOAD', async ({
		page
	}) => {
		await reveal(page);
		await addFromSource(page, '101');
		await addFromSource(page, '102');
		const sheet = await openGroup(page, ['Gallery 101', 'Gallery 102']);
		await sheet.getByRole('textbox', { name: 'Series name' }).fill('The Pair');
		await sheet.getByRole('button', { name: /CREATE SERIES · 2 BOOKS/ }).click();
		await expect(page).toHaveURL(/\/series\/\d+\?created=2/);
		seriesId = Number(new URL(page.url()).pathname.split('/').pop());
		// The key is on each book, not the series: the server's own answer drew this row.
		expect(
			dbGet<{ n: number }>(
				`SELECT COUNT(*) AS n FROM entry_origins eo JOIN entries e ON e.id = eo.entry_id WHERE e.series_id = ?`,
				seriesId
			).n
		).toBe(2);
		await expect(page.getByRole('button', { name: /FIRST 2/ })).toBeVisible();
		// READ is a link to the reader, not the dimmed "nothing on disk" button.
		await expect(page.locator('.cta')).toHaveAttribute('href', /\/read\/\d+/);
		await expect(page.locator('.cta')).not.toHaveClass(/nofile/);
		await expect(page.getByRole('button', { name: /^FOLLOW$/ })).toHaveCount(0);
	});

	test('READ ONLINE opens a book, its pages through the source', async ({ page }) => {
		await reveal(page);
		await page.goto(url(`/series/${seriesId}`));
		await page.locator('.cta').click();
		await expect(page).toHaveURL(/\/read\/\d+/);
		await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
			timeout: 20_000
		});
	});

	test('DOWNLOAD fetches each book at its own source, and both open', async ({ page }) => {
		test.setTimeout(60_000);
		await reveal(page);
		await page.goto(url(`/series/${seriesId}`));
		await page.getByRole('button', { name: /FIRST 2/ }).click();
		await expect
			.poll(
				() =>
					dbGet<{ n: number }>(
						`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND available = 1 AND file != ''`,
						seriesId
					).n,
				{ timeout: 45_000, message: 'both books downloaded and attached' }
			)
			.toBe(2);
		const { path, n } = dbGet<{ path: string; n: number }>(
			`SELECT s.path, COUNT(*) AS n FROM series s JOIN entries e ON e.series_id = s.id WHERE s.id = ?`,
			seriesId
		);
		expect(n).toBe(2);
		expect(path, 'named from the root, never one book’s folder').toContain('/library');
	});

	test('the created band’s UNDO gives each book its key back', async ({ page }) => {
		await reveal(page);
		const a = await addFromSource(page, '201');
		const b = await addFromSource(page, '202');
		const sheet = await openGroup(page, ['Gallery 201', 'Gallery 202']);
		await sheet.getByRole('textbox', { name: 'Series name' }).fill('Undone');
		await sheet.getByRole('button', { name: /CREATE SERIES · 2 BOOKS/ }).click();
		await expect(page).toHaveURL(/\/series\/\d+\?created=2/);
		await page.getByRole('button', { name: 'UNDO' }).click();
		await expect(page).toHaveURL(/\/($|\?)/);
		// UNDO makes new singletons, with new ids: the key finds them, not the id.
		for (const [key, title] of [
			[`mihon:${SOURCE.id}:/g/201`, 'Gallery 201'],
			[`mihon:${SOURCE.id}:/g/202`, 'Gallery 202']
		]) {
			expect(
				dbGet<{ title: string }>(`SELECT title FROM series WHERE origin_key = ?`, key).title
			).toBe(title);
		}
		expect(
			dbGet<{ n: number }>(`SELECT COUNT(*) AS n FROM entry_origins`).n,
			'the two kept rows went back to their series'
		).toBe(2 /* The Pair's */);
		expect(a).toBeGreaterThan(0);
		expect(b).toBeGreaterThan(0);
	});

	test('UNGROUP gives each book its key back', async ({ page }) => {
		await reveal(page);
		await page.goto(url(`/series/${seriesId}`));
		await page.locator('.file-row').getByRole('button', { name: 'UNGROUP', exact: true }).click();
		await expect(page).toHaveURL(/\/\?sort=added/);
		for (const n of ['101', '102'])
			expect(
				dbGet<{ title: string }>(
					`SELECT title FROM series WHERE origin_key = ?`,
					`mihon:${SOURCE.id}:/g/${n}`
				).title
			).toBe(`Gallery ${n}`);
	});
});

for (const [label, viewport] of [
	['phone', { width: 412, height: 915 }],
	['desktop', { width: 1280, height: 800 }]
] as const)
	test.describe(`as a Work, on a ${label}`, () => {
		test.use({ viewport });

		test('a Work of two undownloaded one-offs keeps its parts at their source', async ({
			page
		}) => {
			await reveal(page);
			const a = `30${label.length}`;
			const b = `40${label.length}`;
			await addFromSource(page, a);
			await addFromSource(page, b);
			const sheet = await openGroup(page, [`Gallery ${a}`, `Gallery ${b}`]);
			await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
			await sheet.getByRole('textbox', { name: 'Work name' }).fill(`Work ${label}`);
			await sheet.getByRole('button', { name: /CREATE WORK/ }).click();
			await expect(page.locator('.band', { hasText: 'IS A WORK' })).toBeVisible();
			const { id } = dbGet<{ id: number }>(`SELECT id FROM works ORDER BY id DESC LIMIT 1`);
			await page.goto(url(`/work/${id}`));
			await expect(page.getByText(/0 OF 1 DOWNLOADED/).first()).toBeVisible();
			await expect(page.getByText(/READS ONLINE/).first()).toBeVisible();
			await page
				.getByRole('link', { name: new RegExp(`Gallery ${a}`) })
				.first()
				.click();
			await expect(page).toHaveURL(/\/series\/\d+/);
			// On a phone the row lives in DETAILS, shut by default.
			if (label === 'phone') await page.locator('.details-line').click();
			await expect(page.getByRole('button', { name: /FIRST 1/ })).toBeVisible();
			await expect(page.locator('.cta')).toHaveAttribute('href', /\/read\/\d+/);
		});
	});

/**
 * A book's own page (c885's last piece): `?book=<id>` is where a tap on one
 * book lands, and a book with no file offers READ ONLINE and DOWNLOAD there,
 * each for that book alone. A queued book keeps READ ONLINE and drops DOWNLOAD;
 * one whose download failed offers RETRY, as its row does on the list
 * (`EntryList`), and that press queues it again. All through the app's doors.
 */
test.describe('on a book’s own page', () => {
	let offerSeries: number;
	let retrySeries: number;
	let offerA: number;
	let offerB: number;
	let retryA: number;
	let retryB: number;

	async function makeGroup(
		page: Page,
		first: string,
		second: string,
		name: string
	): Promise<number> {
		await reveal(page);
		await addFromSource(page, first);
		await addFromSource(page, second);
		const sheet = await openGroup(page, [`Gallery ${first}`, `Gallery ${second}`]);
		await sheet.getByRole('textbox', { name: 'Series name' }).fill(name);
		await sheet.getByRole('button', { name: /CREATE SERIES · 2 BOOKS/ }).click();
		await expect(page).toHaveURL(/\/series\/\d+\?created=2/);
		return Number(new URL(page.url()).pathname.split('/').pop());
	}

	// Both groups through the app's own ADD and GROUP, once, so any case can be
	// run on its own (and each is falsified on its own).
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		const page = await browser.newPage();
		try {
			offerSeries = await makeGroup(page, '301', '302', 'The Offer');
			retrySeries = await makeGroup(page, '501', '502', 'The Retry');
			offerA = entryId(offerSeries, 'Gallery 301');
			offerB = entryId(offerSeries, 'Gallery 302');
			retryA = entryId(retrySeries, 'Gallery 501');
			retryB = entryId(retrySeries, 'Gallery 502');
		} finally {
			await page.close();
		}
	});

	test('a book with no file offers READ ONLINE and DOWNLOAD, its own', async ({ page }) => {
		await reveal(page);
		await page.goto(url(`/series/${offerSeries}`));
		await page.locator('.grid .tile').filter({ hasText: 'Gallery 301' }).click();
		await expect(page).toHaveURL(new RegExp(`[?&]book=${offerA}`));
		await expect(page.locator('.book-offer')).toBeVisible();
		await expect(page.getByRole('link', { name: /READ ONLINE/ })).toBeVisible();
		await expect(page.getByRole('button', { name: 'DOWNLOAD', exact: true })).toBeVisible();
		// The panel's group offer is not on this screen: this pair is the book's.
		await expect(page.locator('.cta')).toHaveCount(0);
	});

	test('READ ONLINE opens the reader on that book', async ({ page }) => {
		await reveal(page);
		await page.goto(url(`/series/${offerSeries}?book=${offerA}`));
		await page.getByRole('link', { name: /READ ONLINE/ }).click();
		await expect(page).toHaveURL(new RegExp(`/read/${offerA}(\\?|$)`));
		await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
			timeout: 20_000
		});
	});

	test('DOWNLOAD queues that book alone, and the offer goes once it has a file', async ({
		page
	}) => {
		test.setTimeout(90_000);
		await reveal(page);
		const a = offerA;
		const b = offerB;
		await page.goto(url(`/series/${offerSeries}?book=${a}`));
		const [answer] = await Promise.all([
			page.waitForResponse(
				(r) => r.request().method() === 'POST' && r.url().includes('?/download')
			),
			page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click()
		]);
		const body = (await answer.json()) as {
			type: string;
			// devalue's table, a string on the wire, as `$app/forms` decodes it.
			data?: string;
		};
		expect(body.type).toBe('success');
		const table = JSON.parse(body.data ?? '[]');
		// The action's `{ downloaded: { queued, missing, already } }` as indices.
		expect(table[table[table[0].downloaded].queued], 'one book asked for, one queued').toBe(1);
		expect(table[table[table[0].downloaded].missing]).toBe(0);
		await expect
			.poll(
				() =>
					dbGet<{ n: number }>(
						`SELECT COUNT(*) AS n FROM entries WHERE id = ? AND available = 1 AND file != ''`,
						a
					).n,
				{ timeout: 45_000, message: 'the book downloaded and attached' }
			)
			.toBe(1);
		expect(
			dbGet<{ n: number }>(`SELECT COUNT(*) AS n FROM download_queue WHERE entry_id = ?`, b).n,
			'the other book was never queued'
		).toBe(0);
		// A book that has a file has nothing to offer.
		await page.reload();
		await expect(page.locator('.book-offer')).toHaveCount(0);
		// Its twin still does: the offer is the book's, not the group's.
		await page.goto(url(`/series/${offerSeries}?book=${b}`));
		await expect(page.locator('.book-offer')).toBeVisible();
	});

	test('a queued book offers only READ ONLINE, and a failed one RETRY', async ({ page }) => {
		test.setTimeout(210_000);
		await reveal(page);
		const a = retryA;
		failing.add('/g/501');
		await page.goto(url(`/series/${retrySeries}?book=${a}`));
		await page.getByRole('button', { name: 'DOWNLOAD', exact: true }).click();
		// Queued: `rowAction` answers null, so DOWNLOAD goes and READ ONLINE stays.
		await expect(page.getByRole('button', { name: 'DOWNLOAD', exact: true })).toHaveCount(0);
		await expect(page.getByRole('link', { name: /READ ONLINE/ })).toBeVisible();
		// The worker's own three tries, then a failure the screen can offer RETRY for.
		await expect
			.poll(
				() =>
					dbGet<{ state: string }>(`SELECT state FROM download_queue WHERE entry_id = ?`, a)?.state,
				{ timeout: 150_000, message: 'the worker gave up on the chapter' }
			)
			.toBe('failed');
		await page.reload();
		await expect(page.getByRole('button', { name: 'RETRY', exact: true })).toBeVisible();
		// The site answers again: RETRY queues the same chapter, and it lands.
		failing.delete('/g/501');
		await page.getByRole('button', { name: 'RETRY', exact: true }).click();
		await expect
			.poll(
				() =>
					dbGet<{ n: number }>(
						`SELECT COUNT(*) AS n FROM entries WHERE id = ? AND available = 1 AND file != ''`,
						a
					).n,
				{ timeout: 60_000, message: 'RETRY downloaded the book' }
			)
			.toBe(1);
		await page.reload();
		await expect(page.locator('.book-offer')).toHaveCount(0);
	});

	test('offline, the offer needs the workstation and is not drawn', async ({ page }) => {
		await reveal(page);
		const b = retryB;
		await page.goto(url(`/series/${retrySeries}?book=${b}`));
		await expect(page.locator('.book-offer')).toBeVisible();
		await page.context().setOffline(true);
		await expect(page.locator('.book-offer')).toHaveCount(0);
		await page.context().setOffline(false);
		await expect(page.locator('.book-offer')).toBeVisible();
	});

	test('hidden and incognito still draw the offer', async ({ page }) => {
		await reveal(page);
		// HIDE from the panel's own FILE row; reveal keeps the screen reachable.
		await page.goto(url(`/series/${retrySeries}`));
		await page.locator('.file-row').getByRole('button', { name: 'HIDE', exact: true }).click();
		await expect
			.poll(
				() =>
					dbGet<{ hidden: number }>(`SELECT hidden FROM series WHERE id = ?`, retrySeries).hidden,
				{ message: 'the series is hidden' }
			)
			.toBe(1);
		const b = retryB;
		await page.goto(url(`/series/${retrySeries}?book=${b}`));
		await expect(page.locator('.book-offer')).toBeVisible();
		await page.context().addCookies([{ name: 'tsundoku_incognito', value: '1', url: base }]);
		await page.reload();
		await expect(page.getByRole('link', { name: /READ ONLINE/ })).toBeVisible();
		await expect(page.getByRole('button', { name: 'DOWNLOAD', exact: true })).toBeVisible();
	});
});

/**
 * A group stays `ok` with a book whose own source has no extension, and with a
 * book that holds no key at all (grouped before rung 76). READ ONLINE is the
 * book's own answer (`readsOnline`), never the group's, and DOWNLOAD is the
 * book's own row of `seriesDownloads`: neither cell on those books, both on a
 * twin that can be read. The two groups come through the app's own ADD and
 * GROUP; the lost states are the world's own rows, because no door makes them.
 */
test.describe('READ ONLINE and DOWNLOAD are the book’s own answers', () => {
	let missingSeries: number;
	let missingBook: number;
	let missingTwin: number;
	let keylessSeries: number;
	let keylessBook: number;
	let keylessTwin: number;

	async function makeMixedGroup(
		page: Page,
		first: { n: string; source?: typeof SOURCE },
		second: { n: string; source?: typeof SOURCE },
		name: string
	): Promise<number> {
		await reveal(page);
		await addFromSource(page, first.n, first.source);
		await addFromSource(page, second.n, second.source);
		const sheet = await openGroup(page, [`Gallery ${first.n}`, `Gallery ${second.n}`]);
		await sheet.getByRole('textbox', { name: 'Series name' }).fill(name);
		await sheet.getByRole('button', { name: /CREATE SERIES · 2 BOOKS/ }).click();
		await expect(page).toHaveURL(/\/series\/\d+\?created=2/);
		return Number(new URL(page.url()).pathname.split('/').pop());
	}

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		const page = await browser.newPage();
		try {
			missingSeries = await makeMixedGroup(
				page,
				{ n: '601' },
				{ n: '602', source: SOURCE2 },
				'The Half Served'
			);
			missingTwin = entryId(missingSeries, 'Gallery 601');
			missingBook = entryId(missingSeries, 'Gallery 602');
			// Its extension is gone; the group's other book still is served, so the
			// group answers `ok` and only this book's own answer changes.
			dbRun(`DELETE FROM engine_extensions WHERE pkg = ?`, SOURCE2.pkg);
			keylessSeries = await makeMixedGroup(page, { n: '701' }, { n: '702' }, 'A Keyless Book');
			keylessTwin = entryId(keylessSeries, 'Gallery 701');
			keylessBook = entryId(keylessSeries, 'Gallery 702');
			// A book grouped before rung 76 holds no key: no door writes that state now.
			dbRun(`DELETE FROM entry_origins WHERE entry_id = ?`, keylessBook);
		} finally {
			await page.close();
		}
	});

	test('a book whose source lost its extension offers neither cell, its twin both', async ({
		page
	}) => {
		await reveal(page);
		// The group really is `ok`: its twin's row has something to queue.
		expect(
			dbGet<{ n: number }>(
				`SELECT COUNT(*) AS n FROM entry_origins eo JOIN entries e ON e.id = eo.entry_id WHERE e.series_id = ?`,
				missingSeries
			).n
		).toBe(2);
		await page.goto(url(`/series/${missingSeries}?book=${missingBook}`));
		await expect(page.locator('.book-offer')).toHaveCount(0);
		await expect(page.getByRole('link', { name: /READ ONLINE/ })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'DOWNLOAD', exact: true })).toHaveCount(0);
		await page.goto(url(`/series/${missingSeries}?book=${missingTwin}`));
		await expect(page.getByRole('link', { name: /READ ONLINE/ })).toBeVisible();
		await expect(page.getByRole('button', { name: 'DOWNLOAD', exact: true })).toBeVisible();
	});

	test('its twin’s READ ONLINE still lands on its reader', async ({ page }) => {
		await reveal(page);
		await page.goto(url(`/series/${missingSeries}?book=${missingTwin}`));
		await page.getByRole('link', { name: /READ ONLINE/ }).click();
		await expect(page).toHaveURL(new RegExp(`/read/${missingTwin}(\\?|$)`));
		await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
			timeout: 20_000
		});
	});

	test('a book with no key and no file offers neither cell', async ({ page }) => {
		await reveal(page);
		await page.goto(url(`/series/${keylessSeries}?book=${keylessBook}`));
		await expect(page.locator('.book-offer')).toHaveCount(0);
		await expect(page.getByRole('link', { name: /READ ONLINE/ })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'DOWNLOAD', exact: true })).toHaveCount(0);
		// Its twin is served, so the group's own state would have drawn both.
		await page.goto(url(`/series/${keylessSeries}?book=${keylessTwin}`));
		await expect(page.getByRole('link', { name: /READ ONLINE/ })).toBeVisible();
		await expect(page.getByRole('button', { name: 'DOWNLOAD', exact: true })).toBeVisible();
	});
});
