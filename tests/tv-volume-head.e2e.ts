import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * A volume's head on a TV (c835; doc/handoffs/grouped-volumes/Head-TV.dc.html,
 * 1D): it is not a focus stop, the D-pad goes from V1's last chapter to V2's
 * first, and the head is in view when focus arrives under it. Its own preview
 * and seeded database, because it groups two novels; nothing of the shared
 * seed is written, and no other TV spec touches these two.
 */

let work: string;
let dbPath: string;
let base: string;
let preview: ChildProcess | undefined;
let grouped = 0;

function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address() as AddressInfo;
			s.close(() => resolve(port));
		});
	});
}

function query<T>(sql: string, ...args: unknown[]): T[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db.prepare(sql).all(...args) as T[];
	} finally {
		db.close();
	}
}

test.describe.configure({ mode: 'serial' });

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test.beforeAll(async ({}, testInfo) => {
	test.skip(testInfo.project.name !== 'tv', 'the TV project is the one with no pointer');
	test.setTimeout(180_000);
	work = mkdtempSync(join(tmpdir(), 'tsundoku-tv-volume-head-'));
	dbPath = join(work, 'library.sqlite');
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const port = await freePort();
	base = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			TSUNDOKU_HOME: join(work, 'home'),
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
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
	if (work) rmSync(work, { recursive: true, force: true });
});

const url = (path: string) => `${base}${path}`;

test.describe('a volume’s head on a TV', () => {
	// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
	test.beforeEach(async ({}, testInfo) => {
		test.skip(testInfo.project.name !== 'tv', 'the TV project alone');
	});

	test('is not a stop: ↓ goes from V1’s last chapter to V2’s first, and shows its head', async ({
		page
	}) => {
		// The TV has no SELECT: GROUP is the sheet's own form action, posted with
		// the two novels' ids, which is what the sheet sends.
		const ids = query<{ id: number; title: string }>(
			`SELECT id, title FROM series WHERE title IN ('Villainess Level 99', 'Tensei Shitara Ken Deshita')`
		);
		if (ids.length !== 2) throw new Error(`the seed's two novels: ${JSON.stringify(ids)}`);
		const body = new URLSearchParams();
		for (const s of ids) body.append('series', String(s.id));
		body.append('name', 'TV Volumes');
		const answer = await page.request.post(url('/?/group'), {
			data: body.toString(),
			headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' },
			maxRedirects: 0
		});
		expect(answer.status(), 'the GROUP action answered').toBeLessThan(400);
		grouped = (
			query<{ id: number }>(`SELECT id FROM series WHERE title = 'TV Volumes'`)[0] ?? { id: 0 }
		).id;
		expect(grouped, 'the group exists').toBeGreaterThan(0);
		await page.goto(url(`/series/${grouped}`));

		const files = query<{ file: string }>(
			`SELECT file, MIN(position) AS p FROM entries WHERE series_id = ? AND matter = '' GROUP BY file ORDER BY p`,
			grouped
		).map((r) => r.file);
		const chapters = (file: string) =>
			query<{ id: number }>(
				`SELECT id FROM entries WHERE series_id = ? AND file = ? AND matter = '' ORDER BY position`,
				grouped,
				file
			).map((r) => r.id);
		const one = chapters(files[0]);
		const two = chapters(files[1]);
		const lastOfOne = one[one.length - 1];
		const firstOfTwo = two[0];

		// The head is not a focus stop and holds nothing focusable.
		const head = page.locator('.volume').nth(1);
		await expect(head).toBeVisible();
		expect(await head.locator('a, button, [tabindex]').count()).toBe(0);

		// A person arrives on V1's last chapter (its row carries focus), then ↓.
		await page.locator(`#entry-${lastOfOne} .entry-btn`).focus();
		await page.keyboard.press('ArrowDown');
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.closest('li')?.id ?? ''), {
				message: 'the D-pad skipped the head, to V2'
			})
			.toBe(`entry-${firstOfTwo}`);
		// Nothing on the way landed on the head: it has no focus id, and the
		// active element is a chapter row, not the volume row.
		expect(await page.evaluate(() => document.activeElement?.closest('.volume') !== null)).toBe(
			false
		);

		// Its head is in view above the row focus arrived on (1D's scroll margin).
		const view = page.viewportSize()!;
		const box = (await head.boundingBox())!;
		expect(box.y, 'the head’s top').toBeGreaterThanOrEqual(0);
		expect(box.y + box.height, 'the head’s bottom, on screen').toBeLessThanOrEqual(view.height);
		const row = (await page.locator(`#entry-${firstOfTwo}`).boundingBox())!;
		expect(row.y + 1, 'the row sits under its head').toBeGreaterThanOrEqual(box.y + box.height - 1);
	});
});
