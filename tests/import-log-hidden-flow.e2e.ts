import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * What an import brought, on the screens that say so, with hidden series in
 * it (doc/IMPORT-BACKUP.md, "The log"): closed by default, counted with reveal
 * off, named only with reveal on, absent when nothing is hidden. On a
 * database and a preview of this file's own, because hidden rows and import
 * rows on the shared one would show up in every other file's log, and the
 * port is the OS's. Runs once, in tablet-portrait, as every `-flow` file does:
 * the fold is the same markup at every width.
 */

const scratch = process.env.TMPDIR ?? '/tmp';
const home = mkdtempSync(join(scratch, 'tsundoku-e2e-hidden-log-'));
const dbPath = join(home, 'db.sqlite');
const library = join(home, 'library');

const freePort = () =>
	new Promise<number>((done, fail) => {
		const probe = createServer();
		probe.on('error', fail);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as { port: number };
			probe.close(() => done(port));
		});
	});

const PORT = await freePort();
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess | null = null;

test.describe.configure({ mode: 'serial', timeout: 60_000 });
test.use({ baseURL: BASE });

const SECRETS = [
	'Secret Series Title',
	'Second Secret',
	'Hentoid Secret',
	'Secret Work Name',
	'Lone Secret'
];
const noSecrets = async (page: Page) => {
	const text = await page.content();
	for (const s of [...SECRETS, ...SECRETS.map((x) => x.toUpperCase())])
		expect(text).not.toContain(s);
};

test.beforeAll(async () => {
	test.setTimeout(180_000);
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	const now = Date.now();
	db.exec(`DELETE FROM series; DELETE FROM scan_jobs; DELETE FROM imports;`);
	db.prepare(
		`INSERT INTO roots (id, name, path, hidden) VALUES (6330, 'Open', '/c633/o', 0)`
	).run();
	db.prepare(`INSERT INTO roots (id, name, path, hidden) VALUES (6331, 'H', '/c633/h', 1)`).run();
	const dropped = JSON.stringify([
		{
			work: 'Secret Work Name',
			series: 'Open Survivor',
			ended: true,
			workId: 900,
			workAt: 1,
			seriesId: 6335,
			seriesAt: now,
			hiddenAtFold: true
		},
		{
			work: 'Public Work Name',
			series: 'Plain Series',
			ended: true,
			workId: 901,
			workAt: 1,
			seriesId: 6336,
			seriesAt: now,
			hiddenAtFold: false
		}
	]);
	const job = db.prepare(
		`INSERT INTO scan_jobs (id, started_at, finished_at, source_label, dismissed_at, dropped)
		VALUES (?, ?, ?, 'MIHON BACKUP', ?, ?)`
	);
	job.run(6330, now, now, now, dropped);
	job.run(6331, now - 1000, now - 1000, now - 1000, '[]');
	// One hidden series and nothing dropped: the headline's singular.
	job.run(6338, now - 2000, now - 2000, now - 2000, '[]');
	const series = db.prepare(
		`INSERT INTO series (id, root_id, title, kind, hidden, added_at, indexed_at, scan_job_id)
		VALUES (?, ?, ?, 'manga', ?, ?, ?, ?)`
	);
	series.run(6332, 6330, 'Secret Series Title', 1, now, now, 6330);
	series.run(6333, 6330, 'Second Secret', 1, now, now, null);
	series.run(6334, 6331, 'Hentoid Secret', 0, now, now, 6330);
	series.run(6335, 6330, 'Open Survivor', 0, now, now, null);
	series.run(6336, 6330, 'Plain Series', 0, now, now, null);
	series.run(6337, 6330, 'Lone Plain Series', 0, now, now, 6331);
	series.run(6339, 6330, 'Lone Secret', 1, now, now, 6338);
	const imp = db.prepare(
		`INSERT INTO imports (id, created_at, app, file_name, state, job_id, series_total, series_done, started_at, finished_at)
		VALUES (?, ?, 'mihon', ?, 'done', ?, 4, 4, ?, ?)`
	);
	imp.run(6330, now, 'hidden.tachibk', 6330, now, now);
	imp.run(6331, now - 1000, 'plain.tachibk', 6331, now - 1000, now - 1000);
	imp.run(6338, now - 2000, 'lone.tachibk', 6338, now - 2000, now - 2000);
	const put = db.prepare(
		`INSERT INTO import_series (import_id, series_id, created) VALUES (?, ?, ?)`
	);
	put.run(6330, 6332, 1);
	put.run(6330, 6333, 0);
	put.run(6330, 6334, 1);
	put.run(6330, 6336, 1);
	put.run(6331, 6337, 1);
	put.run(6338, 6339, 1);
	db.close();
	// `vite` itself rather than `npx vite`, so the pid is the server's.
	server = spawn(
		process.execPath,
		['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
		{
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				TSUNDOKU_ANILIST: 'off',
				LIBRARY_ROOT: library,
				COVER_DIR: join(home, 'covers'),
				BACKUP_DIR: join(home, 'backups')
			},
			stdio: 'ignore'
		}
	);
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(BASE, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the preview never answered');
});

test.afterAll(() => {
	server?.kill();
	rmSync(home, { recursive: true, force: true });
});

test('with reveal off, the log counts what is hidden, folded, and names none of it', async ({
	page
}) => {
	await page.goto('/import/log?open=backup:6330');
	const fold = page.locator('details.fold');
	await expect(fold).toHaveCount(1);
	// Closed until asked.
	await expect(fold).not.toHaveAttribute('open', /.*/);
	// The whole headline: series and WORKS lines together (3 + 1), as items.
	await expect(fold.locator('summary')).toHaveText(/^4 HIDDEN ITEMS\s*↓$/);
	await expect(
		fold.getByText('2 NEW · 1 MERGED · 3 WITHOUT A SOURCE · 1 WORK DROPPED')
	).toBeHidden();
	await fold.locator('summary').click();
	await expect(fold).toHaveAttribute('open', /.*/);
	await expect(
		fold.getByText('2 NEW · 1 MERGED · 3 WITHOUT A SOURCE · 1 WORK DROPPED')
	).toBeVisible();
	// The line that belongs to nothing hidden is where it always was.
	await expect(
		page.getByText('DROPPED FROM PUBLIC WORK NAME · Plain Series · THE WORK ENDED')
	).toBeVisible();
	await noSecrets(page);
});

test('the result page says the same, closed, and names none of it', async ({ page }) => {
	await page.goto('/import/6330');
	const fold = page.locator('details.fold');
	await expect(fold.locator('summary')).toHaveText(/^4 HIDDEN ITEMS\s*↓$/);
	await expect(fold).not.toHaveAttribute('open', /.*/);
	await noSecrets(page);
});

test('one hidden series and nothing dropped is one item, in the singular', async ({ page }) => {
	await page.goto('/import/log?open=backup:6338');
	const fold = page.locator('details.fold');
	await expect(fold.locator('summary')).toHaveText(/^1 HIDDEN ITEM\s*↓$/);
	await fold.locator('summary').click();
	await expect(fold.getByText('1 NEW', { exact: false })).toBeVisible();
	await expect(fold).not.toContainText('DROPPED');
	await page.goto('/import/6338');
	await expect(page.locator('details.fold summary')).toHaveText(/^1 HIDDEN ITEM\s*↓$/);
	await noSecrets(page);
});

test('an import with nothing hidden has no section at all', async ({ page }) => {
	await page.goto('/import/log?open=backup:6331');
	await expect(page.locator('.detail')).toContainText('plain.tachibk');
	await expect(page.locator('details.fold')).toHaveCount(0);
	await expect(page.getByText(/HIDDEN ITEMS?/)).toHaveCount(0);
	await page.goto('/import/6331');
	await expect(page.getByRole('heading', { name: '1 series came in.' })).toBeVisible();
	await expect(page.locator('details.fold')).toHaveCount(0);
});

test('with reveal on, the same lines where they are today, and no section', async ({ page }) => {
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
	await page.goto('/import/log?open=backup:6330');
	await expect(
		page.getByText('DROPPED FROM SECRET WORK NAME · Open Survivor · THE WORK ENDED')
	).toBeVisible();
	await expect(page.locator('details.fold')).toHaveCount(0);
	await expect(page.locator('.entry', { hasText: 'CLOSE ↑' })).toContainText('3 NEW');
});
