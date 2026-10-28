import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * Downloading through Suwayomi (Index Series Download, Index Downloads;
 * doc/DOWNLOADING.md), end to end, against a fake Suwayomi answering
 * GraphQL from this process. Turning downloads on for the shared server
 * would draw a DOWNLOAD row under the specs that pin the series screen, so
 * this spec runs its own preview of the build, on its own seeded database,
 * with SUWAYOMI_URL pointing at the fake. Nothing here can reach a real
 * Suwayomi, or download anything.
 */

const PORT = Number(process.env.PLAYWRIGHT_DOWNLOADS_PORT ?? 4192);
const FAKE = Number(process.env.PLAYWRIGHT_SUWAYOMI_PORT ?? 4199);
const BASE = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-downloads-${process.pid}.sqlite`);
let server: ChildProcess | null = null;
let fake: Server | null = null;
const ids = { linden: 0, hidden: 0, bato: 0 };
/** Lindenborough's entry ids by chapter number. */
const ch: Record<number, number> = {};

// ---- the fake Suwayomi ----------------------------------------------------------------

type Item = { id: number; manga: number; state: string; progress: number; tries: number };
const MANGAS = [
	{ id: 7, title: 'Lindenborough (Suwayomi)', sourceId: '111', url: '/manga/linden', n: 30 },
	{ id: 8, title: 'Hidden One', sourceId: '111', url: '/manga/hidden', n: 3 },
	{ id: 20, title: 'Lindenborough: Side Stories', sourceId: '111', url: '/manga/side', n: 12 },
	{ id: 21, title: 'Lindenborough After Dark', sourceId: '222', url: '/manga/dark', n: 4 }
];
const chapterId = (manga: number, n: number) => manga * 1000 + n;
let state: {
	running: boolean;
	down: boolean;
	inLibrary: Set<number>;
	downloaded: Set<number>;
	/** Chapters Suwayomi fetched after the start, by id: what FOLLOW looks for. */
	fetchedLate: Set<number>;
	queue: Item[];
	calls: { op: string; vars: Record<string, unknown> }[];
};

function reset() {
	state = {
		running: true,
		down: false,
		inLibrary: new Set(),
		downloaded: new Set([chapterId(7, 11)]),
		fetchedLate: new Set(),
		queue: [
			{ id: chapterId(7, 13), manga: 7, state: 'DOWNLOADING', progress: 0.5, tries: 0 },
			{ id: chapterId(7, 12), manga: 7, state: 'QUEUED', progress: 0, tries: 0 },
			{ id: chapterId(7, 14), manga: 7, state: 'ERROR', progress: 0, tries: 3 },
			{ id: chapterId(8, 1), manga: 8, state: 'QUEUED', progress: 0, tries: 0 },
			{ id: chapterId(8, 2), manga: 8, state: 'ERROR', progress: 0, tries: 3 }
		],
		calls: []
	};
}
reset();

const called = (op: string) => state.calls.filter((c) => c.op === op).map((c) => c.vars);

function answer(query: string, vars: Record<string, unknown>): unknown {
	const op = /mutation[^{]*\{\s*(\w+)/.exec(query)?.[1];
	if (op) state.calls.push({ op, vars });
	const ids = (vars.ids as number[]) ?? [];
	switch (op) {
		case 'enqueueChapterDownloads':
			for (const id of ids)
				if (!state.queue.some((q) => q.id === id))
					state.queue.push({
						id,
						manga: Math.floor(id / 1000),
						state: 'QUEUED',
						progress: 0,
						tries: 0
					});
			return { enqueueChapterDownloads: { clientMutationId: null } };
		case 'dequeueChapterDownloads':
			state.queue = state.queue.filter((q) => !ids.includes(q.id));
			return { dequeueChapterDownloads: { clientMutationId: null } };
		case 'reorderChapterDownloads':
			return { reorderChapterDownloads: { clientMutationId: null } };
		case 'startDownloader':
			state.running = true;
			return { startDownloader: { clientMutationId: null } };
		case 'stopDownloader':
			state.running = false;
			return { stopDownloader: { clientMutationId: null } };
		case 'updateManga':
			if (query.includes('inLibrary: false')) state.inLibrary.delete(vars.id as number);
			else state.inLibrary.add(vars.id as number);
			return { updateManga: { clientMutationId: null } };
		case 'fetchSourceManga':
			return {
				fetchSourceManga: {
					mangas: MANGAS.filter(
						(m) =>
							m.sourceId === vars.s && m.title.toLowerCase().includes(String(vars.q).toLowerCase())
					).map((m) => ({
						id: m.id,
						title: m.title,
						author: 'Han Seol',
						status: 'ONGOING',
						url: m.url,
						sourceId: m.sourceId
					}))
				}
			};
		case 'fetchMangaAndChapters':
			return { fetchMangaAndChapters: { clientMutationId: null } };
	}
	if (query.includes('downloadStatus'))
		return {
			downloadStatus: {
				state: state.running ? 'STARTED' : 'STOPPED',
				queue: state.queue.map((q) => {
					const m = MANGAS.find((x) => x.id === q.manga)!;
					const n = q.id % 1000;
					return {
						state: q.state,
						progress: q.progress,
						tries: q.tries,
						chapter: { id: q.id, pageCount: 20, chapterNumber: n, name: `Chapter ${n}` },
						manga: { id: m.id, title: m.title, sourceId: m.sourceId, url: m.url }
					};
				})
			}
		};
	if (query.includes('sources'))
		return {
			sources: {
				nodes: [
					{ id: '111', displayName: 'Asura Scans (EN)' },
					{ id: '222', displayName: 'Toonily (EN)' }
				]
			}
		};
	if (query.includes('lastUpdateTimestamp'))
		return { lastUpdateTimestamp: { timestamp: String(Date.now() - 2 * 3_600_000) } };
	const chaptersOf = (m: (typeof MANGAS)[number]) =>
		Array.from({ length: m.n }, (_, i) => {
			const id = chapterId(m.id, i + 1);
			return {
				id,
				// Lindenborough's are the seeded entries' URLs; every other manga's are its own.
				url: m.id === 7 ? `/c/${i + 1}` : `/c/${m.id}/${i + 1}`,
				name: `Chapter ${i + 1}`,
				chapterNumber: i + 1,
				scanlator: null,
				sourceOrder: i,
				uploadDate: '0',
				fetchedAt: state.fetchedLate.has(id) ? String(Math.floor(Date.now() / 1000) + 60) : '1',
				isDownloaded: state.downloaded.has(id)
			};
		});
	if (query.includes('manga(id')) {
		const m = MANGAS.find((x) => x.id === vars.id);
		if (query.includes('sourceId url }') && !query.includes('chapters'))
			return { manga: m ? { sourceId: m.sourceId, url: m.url } : null };
		return {
			manga: m && {
				id: m.id,
				title: m.title,
				description: 'A side story.',
				author: 'Han Seol',
				artist: null,
				genre: ['Fantasy'],
				status: 'ONGOING',
				sourceId: m.sourceId,
				url: m.url,
				inLibrary: state.inLibrary.has(m.id),
				thumbnailUrl: null,
				realUrl: null,
				source: { displayName: m.sourceId === '111' ? 'Asura Scans (EN)' : 'Toonily (EN)' },
				chapters: { nodes: chaptersOf(m) }
			}
		};
	}
	if (query.includes('mangas')) {
		const m = MANGAS.find((x) => x.sourceId === vars.s && x.url === vars.u);
		return {
			mangas: {
				nodes: m
					? [
							{
								id: m.id,
								inLibrary: state.inLibrary.has(m.id),
								chapters: { nodes: chaptersOf(m) }
							}
						]
					: []
			}
		};
	}
	throw new Error(`the fake has no answer for ${query.slice(0, 60)}`);
}

function startFake(): Promise<void> {
	fake = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			// Not answering: the connection drops, as a stopped container's would.
			if (state.down) return req.socket.destroy();
			try {
				const { query, variables } = JSON.parse(body);
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ data: answer(query, variables ?? {}) }));
			} catch (e) {
				res.statusCode = 400;
				res.end(JSON.stringify({ errors: [{ message: (e as Error).message }] }));
			}
		});
	});
	return new Promise((r) => fake!.listen(FAKE, '127.0.0.1', () => r()));
}

// ---- the library ------------------------------------------------------------------------

function seed(): void {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
		.id;
	const now = Date.UTC(2026, 9, 4, 14, 20);
	const series = (title: string, key: string, n: number, have: number, hidden = 0) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, hidden)
					VALUES (?, ?, 'manhwa', 'mihon', 210, ?, ?, ?, ?)`
				)
				.run(root, title, now, now, key, hidden).lastInsertRowid
		);
		for (let i = 1; i <= n; i++) {
			const e = Number(
				db
					.prepare(
						`INSERT INTO entries (series_id, position, label, added_at, file, bytes, page_count, available, source_url, read_at)
						VALUES (?, ?, ?, ?, ?, ?, 20, ?, ?, ?)`
					)
					.run(
						id,
						i,
						`Ch. ${i}`,
						now,
						i <= have ? `${title}/${i}.cbz` : '',
						i <= have ? 40_000_000 : 0,
						i <= have ? 1 : 0,
						`/c/${i}`,
						i <= 5 && i <= have ? now : null
					).lastInsertRowid
			);
			if (title.startsWith('Linden')) ch[i] = e;
		}
		return id;
	};
	ids.linden = series('Lindenborough Heir', 'mihon:111:/manga/linden', 30, 10);
	ids.hidden = series('Hidden One', 'mihon:111:/manga/hidden', 3, 0, 1);
	ids.bato = series('Hoshikuzu no Kishi-dan', 'mihon:999:/manga/b', 5, 2);
	// Toonily: everything the library has from it is hidden, so it's searched only with reveal on.
	series('Toonily One', 'mihon:222:/manga/t1', 2, 0, 1);
	series('Toonily Two', 'mihon:222:/manga/t2', 2, 0, 1);
	const tag = Number(
		db.prepare(`INSERT INTO tags (namespace, value) VALUES ('source', 'bato.to')`).run()
			.lastInsertRowid
	);
	db.prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(ids.bato, tag);
	db.close();
}

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: BASE });

test.beforeAll(async () => {
	seed();
	await startFake();
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			SUWAYOMI_URL: `http://127.0.0.1:${FAKE}`,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(tmpdir(), 'tsundoku-e2e-empty-library'),
			BACKUP_DIR: join(tmpdir(), 'tsundoku-e2e-backups')
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
	throw new Error('the downloads preview never answered');
});

test.beforeEach(async () => {
	reset();
	// The app keeps Suwayomi's queue for two seconds; let it go stale.
	await new Promise((r) => setTimeout(r, 2100));
});

test.afterAll(() => {
	server?.kill();
	fake?.close();
	rmSync(dbPath, { force: true });
});

const row = (page: import('@playwright/test').Page, n: number) => page.locator(`#entry-${ch[n]}`);

test('the DOWNLOAD row and every chapter state (state 1)', async ({ page }) => {
	await page.goto(`/series/${ids.linden}`);
	const dl = page.locator('.dl-row');
	await expect(dl.locator('.label')).toHaveText('DOWNLOAD');
	await expect(dl.locator('.lk-a')).toHaveText('20 unread chapters not downloaded');
	await expect(dl.locator('.lk-b')).toHaveText(
		'1 DOWNLOADING · 1 QUEUED · 1 FAILED · CH. 14 FAILED'
	);
	await expect(dl.locator('.lcs.inline .lc')).toHaveText(['NEXT 10', 'ALL 16', 'FOLLOW']);
	// The mock's literals, the LINK row's: pinned so a tidy-up can't round them.
	await expect(dl).toHaveCSS('min-height', '68px');
	await expect(dl.locator('.lk-a')).toHaveCSS('font-size', '15px');
	await expect(dl.locator('.lk-b')).toHaveCSS('font-size', '13px');

	await expect(row(page, 10).locator('.status .long')).toHaveText('');
	await expect(row(page, 11).locator('.status .long')).toHaveText('IMPORTING');
	await expect(row(page, 12).locator('.status .long')).toHaveText('QUEUED');
	await expect(row(page, 13).locator('.status .long')).toHaveText('DOWNLOADING · 10 / 20');
	await expect(row(page, 13).locator('.bar.ink > span')).toHaveAttribute('style', /width: 50%/);
	await expect(row(page, 14).locator('.status .long')).toHaveText('FAILED · 3 TRIES');
	await expect(row(page, 16).locator('.status .long')).toHaveText('NOT DOWNLOADED');
	// FAILED: full ink and a 3px ink rule, no new colour.
	await expect(row(page, 14).locator('.entry-btn')).toHaveCSS(
		'box-shadow',
		/3px 0px 0px 0px inset/
	);
	await expect(page.locator('.file-meta')).toContainText(
		'10 OF 30 DOWNLOADED · 2 QUEUED · 1 FAILED'
	);
});

test('NEXT 10 puts the series in Suwayomi’s library and queues the next ten', async ({ page }) => {
	await page.goto(`/series/${ids.linden}`);
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'NEXT 10' }).click();
	await expect(row(page, 15).locator('.status .long')).toHaveText('QUEUED');
	expect(called('updateManga')).toEqual([{ id: 7 }]);
	expect(called('enqueueChapterDownloads')).toEqual([
		{ ids: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24].map((n) => chapterId(7, n)) }
	]);
	expect(called('startDownloader')).toHaveLength(1);
});

test('a tap queues a row with no file and retries a failed one', async ({ page }) => {
	await page.goto(`/series/${ids.linden}`);
	await row(page, 16).locator('.entry-btn').click();
	await expect(row(page, 16).locator('.status .long')).toHaveText('QUEUED');
	expect(called('enqueueChapterDownloads')).toEqual([{ ids: [chapterId(7, 16)] }]);

	await row(page, 14).locator('.entry-btn').click();
	await expect(row(page, 14).locator('.status .long')).toHaveText('QUEUED');
	expect(called('dequeueChapterDownloads')).toEqual([{ ids: [chapterId(7, 14)] }]);
	// A row with a file still opens it; nothing was queued for it.
	expect(state.calls.filter((c) => c.op === 'enqueueChapterDownloads')).toHaveLength(2);
});

test('ALL asks first, by URL, and queues every unread chapter with no file (state 3)', async ({
	page
}) => {
	await page.goto(`/series/${ids.linden}`);
	await page.locator('.dl-row .lcs.inline').getByRole('link', { name: 'ALL 16' }).click();
	await expect(page).toHaveURL(/download=all/);
	const sheet = page.getByRole('dialog');
	await expect(sheet).toContainText('DOWNLOAD 16 CHAPTERS?');
	await expect(sheet).toContainText('CH. 15 – 30 · EVERY UNREAD CHAPTER WITH NO FILE');
	await expect(sheet).toContainText('ABOUT 640 MB ON /MNT/HDD2 · 40.0 MB A CHAPTER IN THIS SERIES');
	await sheet.getByRole('button', { name: 'DOWNLOAD 16' }).click();
	await expect(page).not.toHaveURL(/download=all/);
	expect(called('enqueueChapterDownloads')[0].ids).toHaveLength(16);
	await expect(row(page, 30).locator('.status .long')).toHaveText('QUEUED');
});

test('SELECT counts DOWNLOAD like the other actions (state 2)', async ({ page }) => {
	await page.goto(`/series/${ids.linden}`);
	await page.getByRole('button', { name: 'SELECT' }).click();
	for (const n of [10, 16, 17]) await row(page, n).locator('.entry-btn').click();
	const bulk = page.locator('form.bulk');
	await expect(bulk.locator('button').first()).toHaveText('DOWNLOAD2');
	await bulk.getByRole('button', { name: /DOWNLOAD/ }).click();
	await expect
		.poll(() => called('enqueueChapterDownloads'))
		.toEqual([{ ids: [chapterId(7, 16), chapterId(7, 17)] }]);
});

test('a source Suwayomi has no extension for draws no DOWNLOAD row (state 4)', async ({ page }) => {
	await page.goto(`/series/${ids.bato}`);
	await expect(page.locator('.dl-row')).toHaveCount(0);
	await expect(page.locator('.file-meta')).toContainText('BATO.TO DOWNLOADS ON THE TABLET');
	await expect(page.locator('.entry.missing .status .long').first()).toHaveText('NOT DOWNLOADED');
});

test('the queue: what’s downloading, failures first, series in order (state 8)', async ({
	page
}) => {
	await page.goto('/');
	// QUEUE over its count; the hidden series' chapter isn't counted.
	await expect(page.locator('.queue-cell .q-n')).toHaveText('2');
	await expect(page.locator('.band.act').filter({ hasText: 'FAILED' })).toContainText(
		'01 DOWNLOAD FAILED'
	);
	await page.locator('.queue-cell').click();
	await expect(page).toHaveURL(/\/downloads$/);
	await expect(page.locator('.band.progress .line').first()).toContainText(
		'DOWNLOADING · LINDENBOROUGH HEIR'
	);
	await expect(page.locator('.fail')).toHaveCount(1);
	await expect(page.locator('.fail .f-t')).toHaveText('Lindenborough Heir · Chapter 14');
	await expect(page.locator('.fail .f-m')).toHaveText('FAILED · 3 TRIES');
	await expect(page.locator('.group')).toHaveCount(1);
	await expect(page.locator('.group .g-m')).toContainText('2 QUEUED');

	await page.locator('.fail').getByRole('button', { name: 'RETRY' }).click();
	await expect(page.locator('.fail')).toHaveCount(0);
	expect(called('dequeueChapterDownloads')).toEqual([{ ids: [chapterId(7, 14)] }]);

	await page.locator('.g-more').click();
	await expect(page).toHaveURL(/open=7/);
	await page.getByRole('button', { name: '↑ TO THE TOP' }).click();
	await expect.poll(() => called('reorderChapterDownloads').length).toBe(1);
});

test('PAUSE stops Suwayomi, and RESUME is the accent cell while paused (state 9)', async ({
	page
}) => {
	await page.goto('/downloads');
	await page.getByRole('button', { name: 'PAUSE' }).click();
	const resume = page.getByRole('button', { name: 'RESUME' });
	await expect(resume).toBeVisible();
	await expect(page.locator('.band.info')).toContainText('PAUSED · 2 QUEUED');
	expect(called('stopDownloader')).toHaveLength(1);
	await resume.click();
	await expect(page.getByRole('button', { name: 'PAUSE' })).toBeVisible();
	expect(called('startDownloader')).toHaveLength(1);
});

test('reveal on counts and names the hidden series (state 12)', async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
	await page.goto('/downloads');
	await expect(page.locator('.fail')).toHaveCount(2);
	await expect(page.locator('.group')).toHaveCount(2);
	await expect(page.locator('.group').nth(1).locator('.hidden-badge')).toHaveText('HIDDEN');
	await page.context().clearCookies({ name: 'tsundoku_reveal' });
});

test('NEXT 10 works without script, as a form post', async ({ browser }) => {
	const ctx = await browser.newContext({
		javaScriptEnabled: false,
		baseURL: BASE,
		storageState: test.info().project.use.storageState
	});
	const page = await ctx.newPage();
	await page.goto(`/series/${ids.linden}`);
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'NEXT 10' }).click();
	await page.waitForLoadState();
	expect(called('enqueueChapterDownloads')).toHaveLength(1);
	await ctx.close();
});

test('searching the sources works without script: the server waits for every source (c146)', async ({
	browser
}) => {
	const ctx = await browser.newContext({
		javaScriptEnabled: false,
		baseURL: BASE,
		storageState: test.info().project.use.storageState
	});
	const page = await ctx.newPage();
	await page.goto('/downloads/search?q=linden');
	await expect(page.locator('.label')).toContainText('01 — 1 OF 1 SOURCE ANSWERED');
	await expect(page.locator('a.hit')).toHaveCount(2);
	await expect(page.locator('.hit.ghost')).toHaveCount(0);
	await ctx.close();
});

test('library search carries the query to the sources, leaving out a mostly hidden one (1e)', async ({
	page
}) => {
	await page.goto('/search?q=linden');
	const row = page.locator('a.to-sources');
	// Toonily is all hidden here: with reveal off it is neither asked nor counted.
	await expect(row).toContainText('1 SOURCE · RESULTS ARRIVE ONE BY ONE');
	await row.click();
	await expect(page).toHaveURL(/\/downloads\/search\?q=linden$/);
	await expect(page.locator('.g-head')).toHaveCount(1);
	await expect(page.locator('.g-head').first()).toContainText('ASURA SCANS');
	await expect(page.locator('.label')).toContainText('01 — 1 OF 1 SOURCE ANSWERED');
	const hits = page.locator('a.hit');
	await expect(hits).toHaveCount(2);
	// The library's copy says so and opens it; the hidden series is dropped, not dimmed.
	await expect(hits.nth(0).locator('.m')).toHaveText('IN LIBRARY · 10 OF 30 DOWNLOADED');
	await expect(hits.nth(0).locator('.open')).toHaveText('OPEN →');
	await expect(hits.nth(0).locator('mark')).toHaveText('Linden');
	await expect(hits.nth(1).locator('.t')).toHaveText('Lindenborough: Side Stories');
	await expect(page.getByText('Hidden One')).toHaveCount(0);
	await expect(page.getByText('After Dark')).toHaveCount(0);
});

test('reveal on asks the mostly hidden source too', async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
	await page.goto('/downloads/search?q=linden');
	await expect(page.locator('.g-head')).toHaveCount(2);
	await expect(page.getByText('Lindenborough After Dark')).toBeVisible();
	await page.context().clearCookies({ name: 'tsundoku_reveal' });
});

test('a preview adds to both libraries, lands on the series, and UNDO takes it back (1e)', async ({
	page
}) => {
	await page.goto('/downloads/source/20?q=linden');
	const add = page.getByRole('button', { name: /ADD TO LIBRARY/ });
	await expect(add).toContainText('12 CHAPTERS · NOTHING DOWNLOADS UNTIL ASKED');
	await expect(page.locator('.ch')).toHaveCount(12);
	await add.click();
	await expect(page).toHaveURL(/\/series\/\d+\?added=20/);
	await expect(page.locator('.band')).toContainText('ADDED TO THE LIBRARY');
	await expect(page.locator('.band')).toContainText('12 CHAPTERS · NONE DOWNLOADED');
	await expect(page.locator('.dl-row .lcs.inline .lc').first()).toHaveText('FIRST 10');
	// START is dimmed until chapter 1 has a file.
	await expect(page.locator('a.cta')).toHaveAttribute('aria-disabled', 'true');
	expect(state.inLibrary.has(20)).toBe(true);
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page).toHaveURL(/\/downloads\/source\/20/);
	expect(state.inLibrary.has(20)).toBe(false);
	// Gone from tsundoku too: the preview is a preview again, not a redirect.
	await expect(page.getByRole('button', { name: /ADD TO LIBRARY/ })).toBeVisible();
});

test('FOLLOW turns accent, offers FOLLOWED, and queues what Suwayomi fetches later (1d)', async ({
	page
}) => {
	await page.goto(`/series/${ids.linden}`);
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'FOLLOW' }).click();
	const following = page
		.locator('.dl-row .lcs.inline')
		.getByRole('button', { name: 'FOLLOWING ✓' });
	await expect(following).toBeVisible();
	await expect(following).toHaveClass(/acc/);
	expect(state.inLibrary.has(7)).toBe(true);

	await page.goto('/?shelf=all&followed=1');
	await expect(page.locator('.grid .tile')).toHaveCount(1);

	// Suwayomi's update finds chapter 30 again, fetched after the follow; the timer's step queues it.
	state.queue = [];
	state.fetchedLate.add(chapterId(7, 30));
	const r = await page.request.post('/api/downloads/follow');
	expect(await r.json()).toEqual({ series: 1, queued: 1 });
	expect(called('enqueueChapterDownloads')).toEqual([{ ids: [chapterId(7, 30)] }]);

	await page.goto(`/series/${ids.linden}`);
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'FOLLOWING ✓' }).click();
	await expect(
		page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'FOLLOW', exact: true })
	).toBeVisible();
});

test('the live stream says what is downloading, and nothing of a hidden series', async ({
	page
}) => {
	await page.goto('/downloads');
	const first = await page.evaluate(
		() =>
			new Promise<{ version: string; downloading: { chapterId: number } | null }>((res) => {
				const es = new EventSource('/api/downloads/events');
				es.onmessage = (e) => {
					es.close();
					res(JSON.parse(e.data));
				};
			})
	);
	expect(first.downloading?.chapterId).toBe(chapterId(7, 13));
	expect(first.version).not.toContain(String(chapterId(8, 2)));
});

// Last: once Suwayomi stops answering, the chrome doesn't ask again for fifteen seconds.
test('Suwayomi not answering keeps the row, dimmed, and says so (state 5)', async ({ page }) => {
	state.down = true;
	await page.goto(`/series/${ids.linden}`);
	const dl = page.locator('.dl-row');
	await expect(dl.locator('.lk-b')).toContainText('○ NOT ANSWERING · SUWAYOMI ON THE WORKSTATION');
	await expect(dl.locator('.lcs.inline .lc.dim')).toHaveCount(2);
	await expect(dl.locator('.lcs.inline .lc').first()).toHaveCSS('opacity', '0.35');
	await page.goto('/downloads');
	await expect(page.locator('.band.info')).toContainText('○ NOT ANSWERING');
});
