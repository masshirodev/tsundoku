import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, readerReady, test } from './fixtures';
import { sinceDay } from '../src/lib/library/history';

/**
 * Reading time end to end (card c443; doc/READING-LOG.md): read through the
 * app's own readers on a fake clock, and the time is on the series screen and
 * in HISTORY, its row and its total; a hidden series' time is in neither while
 * reveal is off.
 *
 * It logs reading, so it runs on its own preview and its own seeded database
 * (the links-flow arrangement), on a port the OS gives, in tablet-portrait
 * only (a `-flow` file). It reads series the seed never logs: Dungeon Meshi
 * (pages), Honzuki no Gekokujou (text) and, hidden, Kaori Mama Illustrations
 * 2024.
 */
test.describe.configure({ mode: 'serial' });

let work = '';
let dbPath = '';
let preview: ChildProcess | null = null;
let base = '';

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
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-time-'));
	dbPath = join(work, 'time.sqlite');
	const library = join(work, 'library');
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, LIBRARY_ROOT: library, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const port = await freePort();
	base = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			LIBRARY_ROOT: library,
			TSUNDOKU_HOME: join(work, 'home'),
			BACKUP_DIR: join(work, 'backups'),
			TSUNDOKU_ANILIST: 'off'
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${base}/`, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the reading-time preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	if (work) rmSync(work, { recursive: true, force: true });
});

/** What the log holds, read from the database itself: the oracle, not the summary. */
function logged(title: string): number {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (
			db
				.prepare(
					`SELECT COALESCE(SUM(re.duration_ms), 0) AS ms FROM reading_events re
					JOIN series s ON s.id = re.series_id WHERE s.title = ?`
				)
				.get(title) as { ms: number }
		).ms;
	} finally {
		db.close();
	}
}

async function openSeries(page: import('@playwright/test').Page, title: string) {
	await page.goto(`${base}/?sort=title`);
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
}

const readLine = (page: import('@playwright/test').Page) =>
	page.locator('.panel .readtime, .readtime').first();

test('the image reader: a page read for 90 s, then one left for 10 minutes, is 3 MIN on the series screen', async ({
	page
}) => {
	await page.clock.install();
	await openSeries(page, 'Dungeon Meshi');
	// Nothing logged, nothing said.
	await expect(page.locator('.readtime')).toHaveCount(0);
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	// R→L: ← is the next page. 90 s on the first page, then the turn settles.
	await page.clock.fastForward(90_000);
	await page.keyboard.press('ArrowLeft');
	await page.clock.fastForward(2_000);
	// Ten minutes on the second: an idle tablet, capped at the image cap's 2 minutes.
	await page.clock.fastForward(10 * 60_000);
	await page.keyboard.press('ArrowLeft');
	await page.clock.fastForward(2_000);
	await expect.poll(() => logged('Dungeon Meshi'), { timeout: 10_000 }).toBeGreaterThan(210_000);
	const ms = logged('Dungeon Meshi');
	// 92 s + 120 s, give or take the settle: never the ten minutes.
	expect(ms).toBeLessThan(4 * 60_000);
	await openSeries(page, 'Dungeon Meshi');
	await expect(readLine(page)).toHaveText('READ 3 MIN');
});

test('the text reader: four minutes on a page of prose stays four minutes', async ({ page }) => {
	await page.clock.install();
	await openSeries(page, 'Honzuki no Gekokujou');
	await page
		.getByRole('link', { name: /READ AGAIN|CONTINUE|START|▶/ })
		.first()
		.click();
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await page.waitForLoadState('networkidle');
	await page.clock.fastForward(4 * 60_000);
	// L→R: → turns forward.
	await page.keyboard.press('ArrowRight');
	await page.clock.fastForward(2_000);
	await expect
		.poll(() => logged('Honzuki no Gekokujou'), { timeout: 10_000 })
		.toBeGreaterThanOrEqual(4 * 60_000);
	// The image reader's cap would have made it 2 minutes.
	expect(logged('Honzuki no Gekokujou')).toBeLessThan(5 * 60_000 + 5_000);
	await openSeries(page, 'Honzuki no Gekokujou');
	await expect(readLine(page)).toHaveText('READ 4 MIN');
});

/** "READ 12 H 40" or "READ 40 MIN", as minutes. */
function minutes(text: string): number {
	const h = /(\d+) H (\d+)/.exec(text);
	if (h) return Number(h[1]) * 60 + Number(h[2]);
	const m = /(\d+) MIN/.exec(text);
	return m ? Number(m[1]) : 0;
}

test('HISTORY: each row says its time, the total says SINCE, and hidden is hidden', async ({
	page
}) => {
	await page.goto(`${base}/history`);
	const row = page.locator('.row', { hasText: 'Dungeon Meshi' }).first();
	await expect(row.locator('.spent')).toHaveText('3 MIN');
	await expect(
		page.locator('.row', { hasText: 'Honzuki no Gekokujou' }).first().locator('.spent')
	).toHaveText('4 MIN');
	const total = page.getByRole('region', { name: 'Time read' });
	await expect(total).toBeVisible();
	const line = total.locator('.total-line');
	// SINCE the first day the log holds, from the database itself.
	const first = (() => {
		const db = new Database(dbPath, { readonly: true });
		try {
			return (
				db
					.prepare(
						`SELECT MIN(re.day) AS d FROM reading_events re JOIN series s ON s.id = re.series_id
						JOIN roots r ON r.id = s.root_id
						WHERE re.kind IN ('open', 'page', 'finish', 'close') AND s.hidden = 0 AND (r.hidden = 0 OR s.public = 1)`
					)
					.get() as { d: string }
			).d;
		} finally {
			db.close();
		}
	})();
	await expect(line.locator('span').nth(1)).toHaveText(sinceDay(first));
	const off = minutes(await line.locator('span').first().innerText());
	expect(off).toBeGreaterThan(0);
	// Each kind's own total is there, with its label.
	await expect(total.locator('.kinds li', { hasText: 'MANGA' })).toBeVisible();
	// Every kind line reads "KIND <time>", and " · SINCE <day>" when it starts later.
	for (const li of await total.locator('.kinds li').allInnerTexts())
		expect(li.trim()).toMatch(
			/^[A-Z]+ (\d+ H \d{2}|\d+ MIN|< 1 MIN)( · SINCE \d{1,2} [A-Z]{3} \d{4})?$/
		);

	// Half an hour of a hidden series, through the reader's own call (reveal on, as it must be).
	await page.context().addCookies([{ name: 'tsundoku_reveal', value: '1', url: base }]);
	await page.goto(`${base}/?sort=title`);
	const db = new Database(dbPath, { readonly: true });
	const hidden = db
		.prepare(
			`SELECT s.id AS seriesId, e.id AS entryId FROM series s JOIN entries e ON e.series_id = s.id
			WHERE s.title = 'Kaori Mama Illustrations 2024' ORDER BY e.position LIMIT 1`
		)
		.get() as { seriesId: number; entryId: number };
	db.close();
	for (const [kind, durationMs] of [
		['open', 0],
		['page', 30 * 60_000]
	] as const) {
		const res = await page.request.post(`${base}/api/reading`, {
			data: { ...hidden, kind, page: 1, durationMs }
		});
		expect(await res.json()).toEqual({ saved: true });
	}
	await page.goto(`${base}/history`);
	const on = minutes(
		await page
			.getByRole('region', { name: 'Time read' })
			.locator('.total-line span')
			.first()
			.innerText()
	);
	// Revealing adds every hidden series' time, the seed's own and the half hour above.
	const hiddenMs = (() => {
		const h = new Database(dbPath, { readonly: true });
		try {
			return (
				h
					.prepare(
						`SELECT COALESCE(SUM(re.duration_ms), 0) AS ms FROM reading_events re
						JOIN series s ON s.id = re.series_id JOIN roots r ON r.id = s.root_id
						WHERE re.kind IN ('open', 'page', 'finish', 'close') AND (s.hidden = 1 OR (r.hidden = 1 AND s.public = 0))`
					)
					.get() as { ms: number }
			).ms;
		} finally {
			h.close();
		}
	})();
	expect(hiddenMs).toBeGreaterThanOrEqual(30 * 60_000);
	// Minutes are floored on both sides, so the difference is within one.
	expect(Math.abs(on - off - hiddenMs / 60_000)).toBeLessThanOrEqual(1);
	await expect(
		page.locator('.row', { hasText: 'Kaori Mama Illustrations 2024' }).first().locator('.spent')
	).toHaveText('30 MIN');

	// Reveal off: the row and its half hour are gone from HISTORY again.
	await page.context().clearCookies({ name: 'tsundoku_reveal' });
	await page.goto(`${base}/history`);
	await expect(page.locator('.row', { hasText: 'Kaori Mama Illustrations 2024' })).toHaveCount(0);
	const again = minutes(
		await page
			.getByRole('region', { name: 'Time read' })
			.locator('.total-line span')
			.first()
			.innerText()
	);
	expect(again).toBe(off);
});
