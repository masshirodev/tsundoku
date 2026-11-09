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

/**
 * Two one-offs added from a source and grouped keep READ ONLINE and DOWNLOAD,
 * and UNDO and UNGROUP give each its link back (card c885; doc/BOOKS.md,
 * "Where a book's origin lives"). It's in the browse project (its name) for the
 * fake engine, but in a world of its own: a gallery source only exists here
 * (the browse world's sources aren't galleries, and a one-off from one is a
 * manga, which GROUP won't bind), and every case groups, downloads and ungroups.
 * The one-offs come through the app's own ADD and GROUP, never a seeded row.
 */

const SOURCE = { id: '500', pkg: 'e2e.gallery', name: 'nhentai' };
const previewOf = (url: string) => `${SOURCE.id}~${Buffer.from(url).toString('base64url')}`;

let work: string;
let dbPath: string;
let base: string;
let preview: ChildProcess | undefined;
let engine: Server;

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
			const b = JSON.parse(raw || '{}') as { method: string; mangaData?: { url: string } };
			const url = b.mangaData?.url ?? '';
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
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES (?, ?, 'manga', 1, '1', '1.6', ?, 0, 0, '')`
		).run(SOURCE.pkg, SOURCE.name, SOURCE.pkg.padEnd(64, '0'));
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://g.example')`
		).run(SOURCE.id, SOURCE.pkg, SOURCE.name);
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
	await page.context().addCookies([{ name: 'tsundoku_reveal', value: '1', url: base }]);
}

/** ADD from the preview: a one-off, as the owner's were. */
async function addFromSource(page: Page, n: string) {
	await page.goto(url(`/downloads/source/${previewOf(`/g/${n}`)}`));
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
