import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * LISTS on a TV, walked line by line with the remote (c519; doc/SERIES.md
 * "LISTS", doc/FOCUS.md). ↓ is one stop a line: ANILIST, then RNB on a comic;
 * on an anime of four seasons the open season's line, then the fold of the
 * other three (one stop, however many it holds), then RNB. ← → move between
 * a line's own cells and never leave it. It runs in the `tv` project (960x540,
 * no pointer). The shared seed has no anime and no Ranobe, so the file seeds a
 * database of its own and serves the build on a port the OS hands out, with
 * Ranobe configured (a token) and every catalogue switched off: the lines are
 * drawn from the database, and nothing here can reach a real service. Read
 * only: nothing is linked, sent or written, so its series are its own and no
 * other spec opens them.
 */

const work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-tvl-'));
const dbPath = join(work, 'tv-lists.sqlite');
let preview: ChildProcess | null = null;
let BASE = '';

function freePort(): Promise<number> {
	return new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});
}

/** The sample library, then this file's two series: rows only, nothing linked. */
function seed(): { comic: number; anime: number } {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			LIBRARY_ROOT: join(work, 'library'),
			NODE_NO_WARNINGS: '1'
		},
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 5, 12, 0);
		const series = (title: string, kind: string, source: string, key: string) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
						VALUES (?, ?, ?, ?, 30, ?, ?, ?, 1, '')`
					)
					.run(root, title, kind, source, now, now, key).lastInsertRowid
			);
		const comic = series('Remote Walk Comic', 'manhwa', 'mihon', 'mihon:1:/remote-walk-comic');
		const chapter = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, ?, ?, ?, ?, 1000, 20, 1, ?)`
		);
		for (let i = 1; i <= 3; i++)
			chapter.run(comic, i, `Chapter ${i}`, now, `tvl/${comic}/${i}.cbz`, `/c/${comic}/${i}`);
		const anime = series('Remote Walk Seasons', 'anime', 'aniyomi', 'aniyomi:1:/remote-walk');
		const episode = db.prepare(
			`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, 0, ?)`
		);
		let position = 0;
		for (let s = 1; s <= 4; s++)
			for (let e = 1; e <= 2; e++) {
				position += 1;
				episode.run(anime, position, `Episode ${e}`, s, e, now, `/a/${anime}/${s}/${e}`);
			}
		return { comic, anime };
	} finally {
		db.close();
	}
}

const ids = seed();

test.beforeAll(async () => {
	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			// Ranobe's line is drawn once a token is configured; every request
			// it would make throws Unreachable instead (src/lib/server/ranobe.ts).
			RANOBE_TOKEN: 'e2e-ranobe',
			TSUNDOKU_RANOBE: 'off',
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
			TSUNDOKU_HOME: join(work, 'home'),
			BACKUP_DIR: join(work, 'backups')
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(BASE, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the TV lists preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	rmSync(work, { recursive: true, force: true });
});

/** DETAILS folds LISTS behind one stop on a TV (c425): OK opens it in place. */
async function openLists(page: Page, id: number) {
	await page.goto(`${BASE}/series/${id}`);
	const details = page.locator('[data-row="details"]');
	await details.focus();
	await expect(async () => {
		if ((await details.getAttribute('aria-expanded')) !== 'true')
			await page.keyboard.press('Enter');
		await expect(details).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
	}).toPass();
	await expect(page.locator('[data-row="lists"]')).toBeVisible();
}

/**
 * Where the focus is inside LISTS: the line's key and the cell's words, the
 * fold's tag, or `out` once it has left the row.
 */
const at = (page: Page) =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null;
		if (!el?.closest('[data-row="lists"]')) return 'out';
		const fold = el.closest('.fold');
		if (fold) return `fold ${fold.querySelector('.ft')?.textContent?.trim()}`;
		const line = el.closest('[data-line]')?.getAttribute('data-line');
		return `${line} ${el.textContent?.trim()}`;
	});

test('a comic: ↓ is one stop a line, ANILIST then RNB, and ← → walk a line’s cells', async ({
	page
}) => {
	await openLists(page, ids.comic);
	const row = page.locator('[data-row="lists"]');
	// The line that tracks comes first: AniList on a comic, then Ranobe's.
	await expect(row.locator('[data-line]')).toHaveCount(2);
	expect(
		await row.locator('[data-line]').evaluateAll((n) => n.map((l) => l.getAttribute('data-line')))
	).toEqual(['anilist', 'ranobe']);
	const cells = (key: string) =>
		row
			.locator(`[data-line="${key}"] .drop .c`)
			.evaluateAll((n) => n.map((c) => c.textContent?.trim() ?? ''));
	const anilist = await cells('anilist');
	const ranobe = await cells('ranobe');
	expect(anilist.length).toBeGreaterThan(1);
	expect(ranobe.length).toBeGreaterThan(1);

	await row.locator('[data-line="anilist"] .drop .c').first().focus();
	await expect.poll(() => at(page)).toBe(`anilist ${anilist[0]}`);
	// → through every cell, in order. Past the last one → is the screen's
	// spatial move (the episodes, to the right), which this file does not pin.
	for (const c of anilist.slice(1)) {
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => at(page)).toBe(`anilist ${c}`);
	}
	// ← back to the first.
	for (const c of anilist.slice(0, -1).reverse()) {
		await page.keyboard.press('ArrowLeft');
		await expect.poll(() => at(page)).toBe(`anilist ${c}`);
	}
	// ↓ is the next line, never a cell further along this one.
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => at(page)).toBe(`ranobe ${ranobe[0]}`);
	for (const c of ranobe.slice(1)) {
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => at(page)).toBe(`ranobe ${c}`);
	}
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => at(page)).toBe(`ranobe ${ranobe[ranobe.length - 2]}`);
	// ↓ again leaves the row: RNB was the last line.
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => at(page)).toBe('out');
	// ↑ comes back into it, on its last line.
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => at(page)).toMatch(/^ranobe /);
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => at(page)).toMatch(/^anilist /);
});

test('an anime of four seasons: the open season, the fold as one stop, then RNB', async ({
	page
}) => {
	await openLists(page, ids.anime);
	const row = page.locator('[data-row="lists"]');
	// Four seasons fold round the open one (S1): its line, one fold for S2-S4,
	// then Ranobe's line.
	await expect(row.locator('.fold')).toHaveCount(1);
	const fold = await row.locator('.fold .ft').textContent();
	expect(fold?.trim()).toMatch(/^S2/);
	const first = row.locator('[data-line]').first();
	const firstKey = await first.getAttribute('data-line');
	expect(firstKey).not.toBe('ranobe');
	await first.locator('.drop .c, .cs .c').filter({ visible: true }).first().focus();
	await expect.poll(() => at(page)).toMatch(new RegExp(`^${firstKey} `));
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => at(page)).toBe(`fold ${fold?.trim()}`);
	// One stop: the next ↓ is past the fold, on RNB, not inside the seasons it holds.
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => at(page)).toMatch(/^ranobe /);
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => at(page)).toBe(`fold ${fold?.trim()}`);
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => at(page)).toMatch(new RegExp(`^${firstKey} `));
});
