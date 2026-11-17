import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';
import { backup } from './helpers/mihon-fixture';

/**
 * IMPORT A BACKUP end to end (doc/IMPORT.md), and START SCAN on a
 * `Mihon/` with no backup in it. An import writes series, so
 * this seeds and serves a database of its own on a free port (the
 * works-flow arrangement), with a library folder whose `Mihon/` is empty and
 * an import area of its own: no other spec sees what it brings in. As a
 * `*-flow` file it runs in tablet-portrait alone.
 */
test.describe.configure({ mode: 'serial' });

const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const scratch = join(tmpdir(), `tsundoku-e2e-import-flow-${process.pid}`);
const dbPath = join(scratch, 'db.sqlite');
const library = join(scratch, 'library');
const files = join(scratch, 'files');
let server: ChildProcess | null = null;

test.use({ baseURL: base });

/** A backup on disk, as the friend's phone saved it; padded past one upload piece. */
function backupFile(name: string, extra: number[] = [], pad = 0): string {
	const more = Array.from({ length: pad }, (_, i) => [
		[1, 2131019126180322627n],
		[2, `/series/pad-${i}`],
		[3, `Only browsed ${i} ${'x'.repeat(300)}`],
		[100, false]
	]);
	const path = join(files, name);
	writeFileSync(path, gzipSync(backup(extra, more as never), { level: 0 }));
	return path;
}

test.beforeAll(async () => {
	rmSync(scratch, { recursive: true, force: true });
	// c268: the library's Mihon folder exists, with no backup in it.
	mkdirSync(join(library, 'Mihon', 'autobackup'), { recursive: true });
	mkdirSync(files, { recursive: true });
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
			// Covers and links after an import reach the internet: not here.
			TSUNDOKU_IMPORT_COVERS: '0',
			LIBRARY_ROOT: library,
			TSUNDOKU_HOME: join(scratch, 'home'),
			IMPORT_DIR: join(scratch, 'imports')
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
	if (!up) throw new Error('the import flow preview never answered');
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(scratch, { recursive: true, force: true });
});

test('START SCAN on a Mihon folder with no backup says where it looked', async ({ request }) => {
	const res = await request.post('/?/scan', {
		headers: { origin: base, 'x-sveltekit-action': 'true' },
		form: {}
	});
	const body = await res.text();
	expect(body).toContain('NOTHING TO IMPORT');
	expect(body).toContain(`NO BACKUP IN ${join(library, 'Mihon', 'autobackup')}`);
});

test('a file that is not a backup is refused on the pick screen, and nothing changes', async ({
	page
}) => {
	const notes = join(files, 'Notes.txt');
	writeFileSync(notes, 'not a backup');
	await page.goto('/import');
	await page.getByLabel('The backup file').setInputFiles(notes);
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('NOT A BACKUP TSUNDOKU READS');
	await expect(alert).toContainText('NOTES.TXT · NOT A MIHON BACKUP');
	await expect(alert).toContainText('NOTHING CHANGED');
	await expect(page).toHaveURL(/\/import$/);
	// The log keeps it, NOT READ.
	await page.goto('/import/log');
	await expect(page.getByText('A FILE · NOT READ')).toBeVisible();
});

test('a Mihon backup uploads in pieces, previews, imports, and lands in the log', async ({
	page
}) => {
	// Past one 256 KB piece: the upload's own path, not one request.
	const file = backupFile('app.mihon_2026-11-02_03-14.tachibk', [], 1200);
	await page.goto('/import');
	await page.getByLabel('The backup file').setInputFiles(file);
	await page.waitForURL(/\/import\/\d+$/);

	// What it holds, before anything is written.
	await expect(page.getByRole('heading', { name: '4 series, from 2 sources.' })).toBeVisible();
	await expect(page.getByText('NOTHING WRITTEN YET')).toBeVisible();
	await expect(page.getByText('NONE OF IT IS HERE YET')).toBeVisible();
	await expect(page.getByText("1,201 browsed, never added to the app's library")).toBeVisible();
	// Every source is missing (no extension here), and says so.
	await expect(page.getByLabel('Missing sources')).toContainText('Weeb Central');
	await expect(page.getByLabel('Missing sources')).toContainText(
		"NO REPOSITORY YOU'VE ADDED LISTS IT"
	);
	// Categories as chips; a rating name says RATES.
	const chips = page.getByRole('group', { name: 'Categories' });
	await expect(chips.getByRole('button', { name: /^✓ Good \d/ })).toContainText('RATES 8');
	const toRead = chips.getByRole('button', { name: /To Read/ });
	await expect(toRead).toHaveAttribute('aria-pressed', 'true');
	await toRead.click();
	await expect(toRead).toHaveAttribute('aria-pressed', 'false');

	// SEE ALL opens the list in place.
	await page.getByRole('button', { name: 'SEE ALL 4 →' }).click();
	const list = page.getByLabel('Every series in the file');
	await expect(list).toContainText('Drawing: Saikyou Mangaka');
	await page.getByLabel('Search the backup').fill('bunk');
	await expect(list).toContainText('Bunk Beds');
	await expect(list).not.toContainText('Drawing: Saikyou Mangaka');

	await page.getByRole('button', { name: 'IMPORT 4 SERIES →' }).click();
	// The preview counts the file (4); once written every count follows reveal,
	// and the "+" series is hidden: 3 with reveal off.
	await expect(page.getByRole('heading', { name: '3 series came in.' })).toBeVisible({
		timeout: 20_000
	});
	const result = page.getByLabel('The result', { exact: true }).first();
	await expect(result).toContainText('NEW · ON THE NEW SHELF');
	await expect(page.getByText("03 — DOWNLOADS AREN'T IN A BACKUP")).toBeVisible();
	await expect(page.getByText('TO READ LEFT OUT')).toBeVisible();

	// The library has them, on NEW.
	await page.goto('/?shelf=new');
	await expect(
		page.locator('.grid .tile .title', { hasText: 'Drawing: Saikyou Mangaka' })
	).toBeVisible();
	// To Read was unticked: Myst, in it in the app, is on no To Read shelf here.
	const db = new Database(dbPath, { readonly: true });
	const onToRead = db
		.prepare(
			`SELECT COUNT(*) n FROM collection_series cs JOIN collections c ON c.id = cs.collection_id
			JOIN series s ON s.id = cs.series_id WHERE c.name = 'To Read' AND s.title = 'Myst, Might, Mayhem'`
		)
		.get() as { n: number };
	const myst = db
		.prepare(`SELECT COUNT(*) n FROM series WHERE title = 'Myst, Might, Mayhem'`)
		.get();
	db.close();
	expect(myst).toEqual({ n: 1 });
	expect(onToRead.n).toBe(0);

	// The log, with reveal off: the "+" series is not counted.
	await page.goto('/import/log');
	await expect(page.getByText('MIHON BACKUP · 3 SERIES')).toBeVisible();
	await page.getByRole('button', { name: 'OPEN ↓' }).first().click();
	await expect(page.getByText('app.mihon_2026-11-02_03-14.tachibk')).toBeVisible();
});

test('a second backup of the same library says so, and merges', async ({ page }) => {
	const file = backupFile('app.mihon_2026-11-03_08-00.tachibk', [4]);
	await page.goto('/import');
	await page.getByLabel('The backup file').setInputFiles(file);
	await page.waitForURL(/\/import\/\d+$/);
	await expect(page.getByText(/THE SAME MIHON LIBRARY CAME IN ON \d+ [A-Z]{3}/)).toBeVisible();
	await expect(page.getByText('THIS ONE ADDS AND UPDATES · NOTHING IS REMOVED')).toBeVisible();
	// Import-Preview's measurements, extracted from the board (temp/design by
	// design-tools/extract-spec): hand-set, so pinned rather than tidied.
	const css = (sel: string, props: string[]) =>
		page
			.locator(sel)
			.first()
			.evaluate((el, ps) => {
				const cs = getComputedStyle(el);
				return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]));
			}, props);
	expect(await css('.imp .lab.first', ['padding-top', 'padding-bottom'])).toEqual({
		'padding-top': '0px',
		'padding-bottom': '12px'
	});
	expect(await css('.imp .h1.flush', ['margin-top', 'font-size'])).toEqual({
		'margin-top': '0px',
		'font-size': '34px'
	});
	expect(await css('.imp section.pg > .nums', ['margin-top', 'column-gap', 'row-gap'])).toEqual({
		'margin-top': '24px',
		'column-gap': '1px',
		'row-gap': '1px'
	});
	expect(await css('.imp .nums > div', ['padding-top', 'padding-left', 'padding-bottom'])).toEqual({
		'padding-top': '18px',
		'padding-left': '20px',
		'padding-bottom': '20px'
	});
	expect(await css('.imp .blk.under', ['border-top-width'])).toEqual({ 'border-top-width': '0px' });
	expect(await css('.imp .blk .r', ['min-height'])).toEqual({ 'min-height': '64px' });
	expect(await css('.imp .chips .chip', ['min-height', 'padding-left'])).toEqual({
		'min-height': '44px',
		'padding-left': '14px'
	});
	expect(await css('.imp .confirm', ['height', 'border-top-width'])).toEqual({
		height: '72px',
		'border-top-width': '1px'
	});
	expect(await css('.imp .confirm .c.go', ['padding-left', 'font-size'])).toEqual({
		'padding-left': '28px',
		'font-size': '15px'
	});
	await page.getByRole('button', { name: 'IMPORT 4 SERIES →' }).click();
	await expect(page.getByRole('heading', { name: '3 series came in.' })).toBeVisible({
		timeout: 20_000
	});
	// All three visible ones were here: merged, none new.
	const nums = page.getByLabel('The result', { exact: true }).first();
	await expect(nums.locator('.v').nth(0)).toHaveText('0');
	await expect(nums.locator('.v').nth(1)).toHaveText('3');
});

test('the doors: SETTINGS › 05 and MORE name the last import, the log opens from both', async ({
	page
}) => {
	await page.goto('/settings');
	const r = page.locator('.row', { has: page.locator('.label', { hasText: /^IMPORT A BACKUP$/ }) });
	await expect(r).toContainText(/LAST: MIHON BACKUP · \d+ [A-Z]{3} · 3 SERIES/);
	await r.getByRole('link', { name: 'IMPORT LOG →' }).click();
	await expect(page).toHaveURL(/\/import\/log$/);
	await page.goto('/');
	await page.getByRole('button', { name: 'MORE' }).click();
	const sheet = page.getByRole('dialog', { name: 'More' });
	const log = sheet.getByRole('link', { name: /IMPORT LOG →/ });
	await expect(log).toContainText(/LAST \d+ [A-Z]{3}/);
	await log.click();
	await expect(page).toHaveURL(/\/import\/log$/);
});

/**
 * The release serves adapter-node through scripts/serve.ts, which refuses a
 * body over BODY_SIZE_LIMIT (512 KB unless set) with a bare 413, where `vite
 * preview` above enforces nothing alike. So the upload is proved here through
 * that server itself, on the build this run made: one 600 KB body is refused,
 * and a 4 MB backup in the page's 256 KB pieces arrives whole.
 */
test('a multi-megabyte backup arrives through the release’s server, in pieces under its limit', async () => {
	test.setTimeout(90_000);
	const port = await new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});
	const home = join(scratch, 'serve');
	mkdirSync(join(home, 'library'), { recursive: true });
	const token = 'import-flow-serve-token';
	const release = spawn(process.execPath, ['--experimental-strip-types', 'scripts/serve.ts'], {
		env: {
			...process.env,
			TSUNDOKU_SERVE: 'local',
			TSUNDOKU_PROJECT_ENV: 'off',
			TSUNDOKU_SNAPSHOT: 'off',
			PORT: String(port),
			TSUNDOKU_TOKEN: token,
			DATABASE_PATH: join(home, 'db.sqlite'),
			TSUNDOKU_HOME: join(home, 'home'),
			LIBRARY_ROOT: join(home, 'library'),
			IMPORT_DIR: join(home, 'imports'),
			TSUNDOKU_ANILIST: 'off',
			TSUNDOKU_IMPORT_COVERS: '0',
			NODE_NO_WARNINGS: '1'
		},
		stdio: 'ignore'
	});
	try {
		const url = `http://localhost:${port}`;
		let up = false;
		for (let i = 0; i < 60 && !up; i++) {
			try {
				up = (await fetch(`${url}/`, { redirect: 'manual' })).status > 0;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		expect(up).toBe(true);
		const cookie = `tsundoku_session=${createHash('sha256').update(`tsundoku/v1:${token}`).digest('hex')}`;
		const send = (body: Uint8Array<ArrayBuffer>, q: Record<string, string>) =>
			fetch(`${url}/import/upload?${new URLSearchParams(q)}`, {
				method: 'POST',
				headers: { cookie, 'content-type': 'application/octet-stream' },
				body
			});
		// One body past adapter-node's default: what a plain upload would meet.
		const big = new Uint8Array(600 * 1024);
		const refused = await send(big, { name: 'big.bin', size: String(big.length), offset: '0' });
		expect(refused.status).toBe(413);

		const file = new Uint8Array(
			readFileSync(backupFile('app.mihon_2026-11-04_09-00.tachibk', [], 9000))
		);
		expect(file.length).toBeGreaterThan(3 * 1024 * 1024);
		let at = 0;
		let tok = '';
		let pieces = 0;
		let answer: { state: string; id?: number; token?: string; written?: number } = {
			state: 'more'
		};
		while (answer.state === 'more') {
			const res = await send(file.subarray(at, at + 256 * 1024), {
				name: 'app.mihon_2026-11-04_09-00.tachibk',
				size: String(file.length),
				offset: String(at),
				from: 'desktop',
				token: tok
			});
			expect(res.status).toBe(200);
			answer = await res.json();
			pieces += 1;
			if (answer.state === 'more') {
				tok = answer.token!;
				at = answer.written!;
			}
		}
		expect(answer.state).toBe('read');
		expect(pieces).toBe(Math.ceil(file.length / (256 * 1024)));
		const kept = readFileSync(
			join(home, 'imports', `${answer.id}-app.mihon_2026-11-04_09-00.tachibk`)
		);
		expect(kept.length).toBe(file.length);
	} finally {
		release.kill();
	}
});
