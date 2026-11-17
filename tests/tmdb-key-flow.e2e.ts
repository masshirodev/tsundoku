import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * TMDB's key on SETTINGS › CATALOGUES (Keys-Key 3A–3F): a key
 * TMDB refuses is never kept, one it takes is kept and shown by its last four
 * characters only, the band counts what it will look up, and REMOVE is asked
 * in the row. Its own preview with no key in the environment, and a fake TMDB
 * that takes one key.
 */
test.describe.configure({ mode: 'serial' });

let work = '';
let preview: ChildProcess | null = null;
let tmdb: Server | null = null;
let BASE = '';
const GOOD = 'good-v3-key-a41f';

const freePort = (): Promise<number> =>
	new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});

test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-key-'));
	const env = {
		...process.env,
		DATABASE_PATH: join(work, 'library.sqlite'),
		LIBRARY_ROOT: join(work, 'library'),
		NODE_NO_WARNINGS: '1'
	};
	mkdirSync(join(work, 'library'));
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env,
		stdio: 'pipe'
	});
	const tmdbPort = await freePort();
	tmdb = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://x');
		res.setHeader('content-type', 'application/json');
		const ok = url.searchParams.get('api_key') === GOOD;
		res.statusCode = ok ? 200 : 401;
		res.end(ok ? '{"images":{}}' : '{"status_code":7}');
	});
	await new Promise<void>((ok) => tmdb!.listen(tmdbPort, '127.0.0.1', ok));
	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...env,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			TMDB_API_URL: `http://127.0.0.1:${tmdbPort}/3`,
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
	throw new Error('the key preview never answered');
});

test.afterAll(async () => {
	preview?.kill();
	await new Promise<void>((ok) => (tmdb ? tmdb.close(() => ok()) : ok()));
	if (work) rmSync(work, { recursive: true, force: true });
});

test('ADD KEY: a wrong key is not kept, the right one is, and REMOVE asks in the row', async ({
	page
}) => {
	await page.goto(`${BASE}/settings?section=catalogues#tmdb`);
	const row = page.locator('#tmdb');
	await expect(row).toContainText('No key');
	await expect(row).toContainText('A FREE KEY ADDS OVERVIEWS');
	await row.getByRole('button', { name: 'ADD KEY' }).click();
	const field = page.getByLabel('YOUR TMDB KEY');
	await expect(field).toHaveAttribute('type', 'password');
	await field.fill('a-wrong-key');
	await page.getByRole('button', { name: 'SAVE' }).click();
	await expect(page.getByText("TMDB DIDN'T TAKE THAT KEY · NOTHING SAVED")).toBeVisible();
	await expect(row).toContainText('No key');
	// The paste stays so it can be fixed.
	await expect(field).toHaveValue('a-wrong-key');
	await field.fill(GOOD);
	await page.getByRole('button', { name: 'SAVE' }).click();
	await expect(page.locator('.band', { hasText: 'TMDB KEY SAVED' })).toContainText(
		'ARE LOOKED UP IN THE NEXT PASS'
	);
	await expect(row).toContainText('Key saved · ends in a41f');
	// Never shown again: the page holds no more of it than four characters.
	expect(await page.content()).not.toContain(GOOD);
	await row.getByRole('button', { name: 'REMOVE' }).click();
	await expect(row).toContainText('Remove the key?');
	await expect(row).toContainText('LINKS ALREADY MADE STAY');
	await row.getByRole('button', { name: 'REMOVE KEY' }).click();
	await expect(row).toContainText('No key');
});
