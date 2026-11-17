import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';
import { revealOn } from './helpers/reveal';

/**
 * Downloading (Index Series Download, Index Downloads; doc/DOWNLOADS.md),
 * end to end, against a fake extension engine this spec serves. Turning
 * downloads on for the shared server would draw a DOWNLOAD row under the
 * specs that pin the series screen, so this spec runs its own preview of the
 * build, on its own seeded database, with ENGINE_URL pointing at the fake.
 * Nothing here can reach a real site.
 *
 * The queue starts paused and the fake has no pages to give, so nothing is
 * ever written or imported: what's tested is every screen over tsundoku's
 * queue, read back from the database itself. The download is the worker's
 * spec's (engine-worker-db.spec.ts).
 */

const PORT = Number(process.env.PLAYWRIGHT_DOWNLOADS_PORT ?? 4192);
const FAKE = Number(process.env.PLAYWRIGHT_DOWNLOADS_ENGINE_PORT ?? 4199);
const BASE = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-downloads-${process.pid}.sqlite`);
const library = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-downloads-library-'));
let server: ChildProcess | null = null;
let fake: Server | null = null;
let down = false;
/** The source lists a 31st chapter after this: REFRESH's test. */
let grow = false;
/** And a 32nd, for REFRESH over a selection, which runs after it. */
let grow32 = false;
/** A source whose search fails while set: DOWNLOADS' DID NOT ANSWER. */
let searchFails: string | null = null;
/** How many times each source was asked to search: what TRY AGAIN may add to. */
const searchCalls: Record<string, number> = {};
const ids = { linden: 0, hidden: 0, bato: 0 };
/** Lindenborough's entry ids by chapter number. */
const ch: Record<number, number> = {};
/** The hidden series' entry ids by chapter number. */
const hiddenCh: Record<number, number> = {};

const SOURCE = '111';
const TOONILY = '222';
const mangaId = (sourceId: string, url: string) =>
	`${sourceId}~${Buffer.from(url).toString('base64url')}`;
const SIDE = mangaId(SOURCE, '/manga/side');

// ---- the fake engine ----------------------------------------------------------------------

type Call = { method: string; sourceId: string; search?: string; mangaData?: { url: string } };

const chapters = (url: string, n: number) =>
	Array.from({ length: n }, (_, i) => ({
		url: url === '/manga/linden' ? `/c/${n - i}` : `${url}/c/${n - i}`,
		name: `Chapter ${n - i}`,
		scanlator: null,
		chapter_number: -1
	}));

function startFake(): Promise<void> {
	fake = createServer((req, res) => {
		if (down) return req.socket.destroy();
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			if (req.url === '/challenges') return json({ solving: {}, solved: {} });
			const b = JSON.parse(raw || '{}') as Call;
			const url = b.mangaData?.url ?? '';
			switch (b.method) {
				case 'getSearchManga':
					searchCalls[b.sourceId] = (searchCalls[b.sourceId] ?? 0) + 1;
					if (searchFails === b.sourceId)
						return res.writeHead(500).end(JSON.stringify({ error: 'fake: the site is down' }));
					return json({
						mangas:
							b.sourceId === SOURCE
								? [
										{ url: '/manga/linden', title: 'Lindenborough Heir', status: 1 },
										{ url: '/manga/side', title: 'Lindenborough: Side Stories', status: 2 },
										{ url: '/manga/hidden', title: 'Hidden One', status: 1 }
									]
								: [{ url: '/manga/dark', title: 'Lindenborough After Dark', status: 1 }],
						hasNextPage: false
					});
				case 'getDetailsManga':
					return json({
						url,
						title: url === '/manga/side' ? 'Lindenborough: Side Stories' : 'Lindenborough Heir',
						author: 'Someone',
						genre: 'Fantasy',
						status: 1,
						thumbnail_url: null
					});
				case 'getChapterList':
					return json(chapters(url, url === '/manga/side' ? 12 : grow32 ? 32 : grow ? 31 : 30));
				case 'getPageList':
					// Nothing is ever downloaded here: the queue is the subject.
					return res.writeHead(500).end(JSON.stringify({ error: 'fake: no pages' }));
				case 'supportLatestManga':
					return json(false);
				case 'filterSchemaManga':
					return json([]);
			}
			res.writeHead(404).end('{}');
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
	const now = Date.UTC(2026, 9, 28, 14, 20);
	const series = (
		title: string,
		key: string,
		n: number,
		have: number,
		o: { hidden?: number; into?: Record<number, number> } = {}
	) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, hidden)
					VALUES (?, ?, 'manhwa', 'mihon', 210, ?, ?, ?, ?)`
				)
				.run(root, title, now, now, key, o.hidden ?? 0).lastInsertRowid
		);
		const url = key.split(':').slice(2).join(':');
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
						url === '/manga/linden' ? `/c/${i}` : `${url}/c/${i}`,
						i <= 5 && i <= have ? now : null
					).lastInsertRowid
			);
			if (o.into) o.into[i] = e;
		}
		return id;
	};
	ids.linden = series('Lindenborough Heir', `mihon:${SOURCE}:/manga/linden`, 30, 10, { into: ch });
	ids.hidden = series('Hidden One', `mihon:${SOURCE}:/manga/hidden`, 3, 0, {
		hidden: 1,
		into: hiddenCh
	});
	ids.bato = series('Hoshikuzu no Kishi-dan', 'mihon:999:/manga/b', 5, 2);
	// Toonily: everything the library has from it is hidden, so it's searched only with reveal on.
	series('Toonily One', `mihon:${TOONILY}:/manga/t1`, 2, 0, { hidden: 1 });
	series('Toonily Two', `mihon:${TOONILY}:/manga/t2`, 2, 0, { hidden: 1 });
	const tag = Number(
		db.prepare(`INSERT INTO tags (namespace, value) VALUES ('source', 'bato.to')`).run()
			.lastInsertRowid
	);
	db.prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(ids.bato, tag);

	// The engine's side: two installed sources (none for bato.to), and Lindenborough
	// already resolved, so no background ask rewrites its chapters under a test.
	for (const [id, pkg, name] of [
		[SOURCE, 'e2e.asura', 'Asura Scans'],
		[TOONILY, 'e2e.toonily', 'Toonily']
	]) {
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
			VALUES (?, ?, 'manga', 1, '1.0', '1.4', ?, 0, 0)`
		).run(pkg, name, pkg.padEnd(64, '0'));
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://example.org')`
		).run(id, pkg, name);
	}
	db.prepare(
		`INSERT INTO engine_series (series_id, source_id, engine_url, title, resolved_at) VALUES (?, ?, '/manga/linden', 'Lindenborough Heir', ?)`
	).run(ids.linden, SOURCE, Date.now());
	const chap = db.prepare(
		`INSERT INTO engine_chapters (entry_id, engine_url, name, downloaded_at) VALUES (?, ?, ?, ?)`
	);
	for (let i = 1; i <= 30; i++) chap.run(ch[i], `/c/${i}`, `Chapter ${i}`, i === 11 ? now : null);
	// Chapter 11 is written and not imported yet; 12 and 13 queued; 14 failed three times.
	const q = db.prepare(
		`INSERT INTO download_queue (entry_id, series_id, position, state, tries, queued_at) VALUES (?, ?, ?, ?, ?, ?)`
	);
	q.run(ch[12], ids.linden, 1, 'queued', 0, now);
	q.run(ch[13], ids.linden, 2, 'queued', 0, now);
	q.run(ch[14], ids.linden, 3, 'failed', 3, now);
	q.run(hiddenCh[1], ids.hidden, 4, 'queued', 0, now);
	q.run(hiddenCh[2], ids.hidden, 5, 'failed', 3, now);
	// Paused: the worker downloads nothing while the screens are tested.
	db.prepare(
		`INSERT INTO settings (key, value) VALUES ('downloads_paused_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`
	).run(String(now));
	db.close();
}

/** The queue as the database holds it: entry id → state. */
function queued(): Map<number, string> {
	const db = new Database(dbPath, { readonly: true });
	try {
		return new Map(
			(
				db.prepare(`SELECT entry_id, state FROM download_queue`).all() as {
					entry_id: number;
					state: string;
				}[]
			).map((r) => [r.entry_id, r.state])
		);
	} finally {
		db.close();
	}
}

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: BASE });

test.beforeAll(async () => {
	// This hook seeds a database and spawns a preview, then polls up to 60 s
	// for it: all inside the default 30 s hook budget, where `work-end-frame`'s
	// same shape ran past 30 s on a loaded machine. Measured at 3 s here,
	// at a load average of 20 with other runs at work; the house budget is
	// 120 s so a loaded gate fails a case, never the hook. In a hook,
	// `test.setTimeout` sets the hook's own budget (Playwright's test.d.ts).
	test.setTimeout(120_000);
	seed();
	await startFake();
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			ENGINE_URL: `http://127.0.0.1:${FAKE}`,
			ENGINE_TOKEN: 'e2e-engine-token',
			ENGINE_STORE: library,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: library,
			COVER_DIR: join(library, 'covers'),
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

test.afterAll(() => {
	server?.kill();
	fake?.close();
	rmSync(dbPath, { force: true });
	rmSync(library, { recursive: true, force: true });
});

const row = (page: import('@playwright/test').Page, n: number) => page.locator(`#entry-${ch[n]}`);

test('the DOWNLOAD row and every chapter state (state 1)', async ({ page }) => {
	await page.goto(`/series/${ids.linden}`);
	const dl = page.locator('.dl-row');
	// The label is also its "?" (doc/HELP.md): the word, then the mark.
	await expect(dl.locator('.label')).toHaveText('DOWNLOAD?');
	await expect(dl.locator('.label')).toHaveAccessibleName('Help: downloading');
	await expect(dl.locator('.lk-a')).toHaveText('20 unread chapters not downloaded');
	await expect(dl.locator('.lk-b')).toHaveText('2 QUEUED · 1 FAILED · CH. 14 FAILED');
	await expect(dl.locator('.lcs.inline .lc')).toHaveText([
		'NEXT 10',
		'ALL 16',
		'REFRESH',
		'FOLLOW'
	]);
	// The mock's literals, the LINK row's: pinned so a tidy-up can't round them.
	await expect(dl).toHaveCSS('min-height', '68px');
	await expect(dl.locator('.lk-a')).toHaveCSS('font-size', '15px');
	await expect(dl.locator('.lk-b')).toHaveCSS('font-size', '13px');

	await expect(row(page, 10).locator('.status .long')).toHaveText('');
	await expect(row(page, 11).locator('.status .long')).toHaveText('IMPORTING');
	await expect(row(page, 12).locator('.status .long')).toHaveText('QUEUED');
	await expect(row(page, 14).locator('.status .long')).toHaveText('FAILED · 3 TRIES');
	// A source serves it, so a chapter with no file reads online, and ↓ downloads
	// it apart (doc/READING-ONLINE.md).
	await expect(row(page, 16).locator('.status .long')).toHaveText('ONLINE');
	await expect(row(page, 16).locator('.dl-cell')).toHaveText('↓');
	await expect(row(page, 14).locator('.dl-cell')).toHaveText('RETRY');
	await expect(row(page, 10).locator('.dl-cell')).toHaveText('');
	// FAILED: full ink and a 3px ink rule, no new colour.
	await expect(row(page, 14).locator('.entry-btn')).toHaveCSS(
		'box-shadow',
		/3px 0px 0px 0px inset/
	);
	await expect(page.locator('.file-meta')).toContainText(
		'10 OF 30 DOWNLOADED · 2 QUEUED · 1 FAILED'
	);
});

test('NEXT 10 queues the next ten unread chapters with no file', async ({ page }) => {
	await page.goto(`/series/${ids.linden}`);
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'NEXT 10' }).click();
	await expect(row(page, 15).locator('.status .long')).toHaveText('QUEUED');
	const q = queued();
	for (const n of [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) expect(q.get(ch[n])).toBe('queued');
	expect(q.has(ch[25])).toBe(false);
});

test('↓ queues a row and RETRY retries a failed one; the row itself reads', async ({ page }) => {
	await page.goto(`/series/${ids.linden}`);
	await row(page, 14).locator('.dl-cell').click();
	await expect(row(page, 14).locator('.status .long')).toHaveText('QUEUED');
	expect(queued().get(ch[14])).toBe('queued');
	await row(page, 25).locator('.dl-cell').click();
	await expect(row(page, 25).locator('.status .long')).toHaveText('QUEUED');
	expect(queued().get(ch[25])).toBe('queued');
});

test('ALL asks first and queues every unread chapter with no file (state 3)', async ({ page }) => {
	// Back to the seeded queue (12, 13, 14): ten or fewer left would show NEXT alone.
	const db = new Database(dbPath);
	db.prepare(`DELETE FROM download_queue WHERE series_id = ? AND entry_id NOT IN (?, ?, ?)`).run(
		ids.linden,
		ch[12],
		ch[13],
		ch[14]
	);
	db.close();
	await page.goto(`/series/${ids.linden}`);
	const all = page.locator('.dl-row .lcs.inline').getByRole('link', { name: /^ALL / });
	await expect(all).toHaveText('ALL 16');
	await all.click();
	await expect(page).toHaveURL(/download=all/);
	const sheet = page.getByRole('dialog');
	await expect(sheet).toContainText('DOWNLOAD 16 CHAPTERS?');
	await expect(sheet).toContainText('CH. 15 – 30 · EVERY UNREAD CHAPTER WITH NO FILE');
	await expect(sheet).toContainText('ABOUT 640 MB ON /MNT/HDD2 · 40.0 MB A CHAPTER IN THIS SERIES');
	await sheet.getByRole('button', { name: 'DOWNLOAD 16' }).click();
	await expect(page).not.toHaveURL(/download=all/);
	await expect(row(page, 30).locator('.status .long')).toHaveText('QUEUED');
	for (let n = 15; n <= 30; n++) expect(queued().get(ch[n])).toBe('queued');
});

test('a source no extension has draws no DOWNLOAD row (state 4)', async ({ page }) => {
	await page.goto(`/series/${ids.bato}`);
	await expect(page.locator('.dl-row')).toHaveCount(0);
	await expect(page.locator('.file-meta')).toContainText('BATO.TO · NO EXTENSION HERE');
	await expect(page.locator('.entry.missing .status .long').first()).toHaveText('NOT DOWNLOADED');
});

test('the queue: failures first, series in order, RETRY and TO THE TOP (state 8)', async ({
	page
}) => {
	// A failure of its own again, for the queue's FAILED row.
	const db = new Database(dbPath);
	db.prepare(`UPDATE download_queue SET state = 'failed', tries = 3 WHERE entry_id = ?`).run(
		ch[14]
	);
	db.close();
	await page.goto('/');
	await expect(page.locator('.band.act').filter({ hasText: 'FAILED' })).toContainText(
		'01 DOWNLOAD FAILED'
	);
	await page.locator('.queue-cell').click();
	await expect(page).toHaveURL(/\/downloads$/);
	await expect(page.locator('.fail')).toHaveCount(1);
	await expect(page.locator('.fail .f-t')).toHaveText('Lindenborough Heir · Chapter 14');
	await expect(page.locator('.fail .f-m')).toHaveText('FAILED · 3 TRIES');
	// The hidden series' chapter is neither counted nor named with reveal off.
	await expect(page.locator('.group')).toHaveCount(1);
	await expect(page.getByText('Hidden One')).toHaveCount(0);

	await page.locator('.fail').getByRole('button', { name: 'RETRY' }).click();
	await expect(page.locator('.fail')).toHaveCount(0);
	expect(queued().get(ch[14])).toBe('queued');

	await page.locator('.g-more').click();
	await page.getByRole('button', { name: '↑ TO THE TOP' }).click();
	await expect
		.poll(() => {
			const db = new Database(dbPath, { readonly: true });
			const first = db
				.prepare(`SELECT series_id FROM download_queue ORDER BY position LIMIT 1`)
				.get() as { series_id: number };
			db.close();
			return first.series_id;
		})
		.toBe(ids.linden);
});

test('reveal on counts and names the hidden series (state 12)', async ({ page }) => {
	await revealOn(page.context());
	await page.goto('/downloads');
	await expect(page.locator('.fail')).toHaveCount(1);
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
	// A series of its own, so what's queued is all this test's.
	const db = new Database(dbPath);
	db.prepare(`DELETE FROM download_queue WHERE series_id = ?`).run(ids.linden);
	db.close();
	await page.goto(`/series/${ids.linden}`);
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'NEXT 10' }).click();
	await page.waitForLoadState();
	expect([...queued().keys()].filter((id) => Object.values(ch).includes(id))).toHaveLength(10);
	await ctx.close();
});

test('searching the sources works without script: the server waits for every source', async ({
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

test('library search carries the query to the sources, leaving out a mostly hidden one', async ({
	page
}) => {
	await page.goto('/search?q=linden');
	const to = page.locator('a.to-sources');
	// Toonily is all hidden here: with reveal off it is neither asked nor counted.
	await expect(to).toContainText('1 SOURCE · RESULTS ARRIVE ONE BY ONE');
	await to.click();
	await expect(page).toHaveURL(/\/downloads\/search\?q=linden$/);
	await expect(page.locator('.g-head')).toHaveCount(1);
	await expect(page.locator('.g-head').first()).toContainText('ASURA SCANS');
	const hits = page.locator('a.hit');
	await expect(hits).toHaveCount(2);
	// The library's copy says so and opens it; the hidden series is dropped, not dimmed.
	await expect(hits.nth(0).locator('.m')).toContainText('IN LIBRARY ·');
	await expect(hits.nth(0).locator('.open')).toHaveText('OPEN →');
	await expect(hits.nth(0).locator('mark')).toHaveText('Linden');
	await expect(hits.nth(1).locator('.t')).toHaveText('Lindenborough: Side Stories');
	await expect(page.getByText('Hidden One')).toHaveCount(0);
	await expect(page.getByText('After Dark')).toHaveCount(0);
});

test('reveal on asks the mostly hidden source too', async ({ page }) => {
	await revealOn(page.context());
	await page.goto('/downloads/search?q=linden');
	await expect(page.locator('.g-head')).toHaveCount(2);
	await expect(page.getByText('Lindenborough After Dark')).toBeVisible();
	await page.context().clearCookies({ name: 'tsundoku_reveal' });
});

test('TRY ALL AGAIN and TRY AGAIN ask only the source that did not answer, and ask opens no hidden source', async ({
	page
}) => {
	const reveal = (on: boolean) =>
		on ? revealOn(page.context()) : page.context().clearCookies({ name: 'tsundoku_reveal' });
	const calls = () => ({ asura: searchCalls[SOURCE] ?? 0, toonily: searchCalls[TOONILY] ?? 0 });
	// Inside reveal both sources are asked; Asura Scans' site is down.
	await reveal(true);
	searchFails = SOURCE;
	try {
		await page.goto('/downloads/search?q=linden');
		const failed = page.locator('details.fold.unanswered');
		await expect(failed.locator('summary')).toContainText('1 DID NOT ANSWER');
		await expect(page.getByText('Lindenborough After Dark')).toBeVisible();
		await failed.locator('summary').click();
		await expect(failed).toContainText('ASURA SCANS · EN · DID NOT ANSWER IN 20 S');

		// TRY AGAIN while it is still down: Asura Scans is asked once more, Toonily not at all.
		let before = calls();
		const askedAgain = page.waitForResponse((r) => r.url().includes('/downloads/search/ask?'));
		await failed.getByRole('link', { name: 'TRY AGAIN', exact: true }).click();
		expect((await askedAgain).status()).toBe(200);
		await expect(failed.locator('summary')).toContainText('1 DID NOT ANSWER');
		expect(calls()).toEqual({ asura: before.asura + 1, toonily: before.toonily });
		// In place: the page was not loaded again, and Toonily's answer is still drawn.
		await expect(page).toHaveURL(/\/downloads\/search\?q=linden$/);
		await expect(page.getByText('Lindenborough After Dark')).toBeVisible();

		// Up again: TRY ALL AGAIN asks only the one that did not answer, and its answer joins the list.
		searchFails = null;
		before = calls();
		// The fold came back as it was left, open (`foldOpen`).
		await expect(failed).toHaveAttribute('open', '');
		await failed.getByRole('link', { name: 'TRY ALL AGAIN' }).click();
		await expect(page.locator('a.hit', { hasText: 'Lindenborough: Side Stories' })).toBeVisible();
		await expect(failed).toHaveCount(0);
		expect(calls()).toEqual({ asura: before.asura + 1, toonily: before.toonily });
	} finally {
		searchFails = null;
		await reveal(false);
	}

	// `ask` answers only for a source the page asks: Toonily, whose every
	// series here is hidden, is not found outside reveal, and is asked inside it.
	const ask = (source: string) =>
		page.request.get(`/downloads/search/ask?${new URLSearchParams({ q: 'linden', source })}`);
	const before = calls();
	expect((await ask(TOONILY)).status()).toBe(404);
	expect(calls().toonily).toBe(before.toonily);
	expect((await ask(SOURCE)).status()).toBe(200);
	await reveal(true);
	try {
		const inside = await ask(TOONILY);
		expect(inside.status()).toBe(200);
		expect(await inside.json()).toMatchObject({ ok: true });
		expect(calls().toonily).toBe(before.toonily + 1);
	} finally {
		await reveal(false);
	}
});

test('a preview adds to the library, lands on the series, and UNDO takes it back', async ({
	page
}) => {
	await page.goto(`/downloads/source/${SIDE}?q=linden`);
	const add = page.getByRole('button', { name: /ADD TO LIBRARY/ });
	// Reading first, adding beside it: the count is the list's.
	await expect(page.locator('.list .head')).toContainText('12 · ALL ONLINE');
	await expect(page.locator('.ch')).toHaveCount(12);
	await add.click();
	await expect(page).toHaveURL(/\/series\/\d+\?added=/);
	// ← goes back to the search it was added from, query kept.
	const back = page.getByRole('banner', { name: 'Series' }).locator('a.back');
	await expect(back.locator('.back-label')).toHaveText('SOURCES');
	await expect(back).toHaveAttribute('href', '/downloads/search?q=linden');
	await expect(page.locator('.band')).toContainText('ADDED TO THE LIBRARY');
	await expect(page.locator('.band')).toContainText('12 CHAPTERS · NONE DOWNLOADED');
	await expect(page.locator('.dl-row .lcs.inline .lc').first()).toHaveText('FIRST 10');
	// START reads chapter 1 online (doc/READING-ONLINE.md): it needn't wait for a file.
	await expect(page.locator('a.cta')).toHaveAttribute('aria-disabled', 'false');
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page).toHaveURL(/\/downloads\/source\//);
	// Gone from tsundoku: the preview is a preview again, not a redirect.
	await expect(page.getByRole('button', { name: /ADD TO LIBRARY/ })).toBeVisible();
});

test('a preview downloads too: our sheet says it adds it first, then ADD AND DOWNLOAD', async ({
	page
}) => {
	await page.goto(`/downloads/source/${SIDE}?q=linden`);
	const dl = page.locator('.dl-row');
	await expect(dl.locator('.lk-a')).toHaveText('12 unread chapters not downloaded');
	await expect(dl.locator('.lk-b')).toHaveText('ADDS IT TO YOUR LIBRARY FIRST · IT ASKS');
	await expect(dl.locator('.lcs.inline .lc')).toHaveText(['FIRST 10', 'ALL 12']);
	// Asking is ours, not the browser's: a confirm() would fail this.
	const dialogs: string[] = [];
	page.on('dialog', (d) => {
		dialogs.push(d.message());
		void d.dismiss();
	});
	await dl.locator('.lcs.inline').getByRole('button', { name: 'ALL 12' }).click();
	const sheet = page.getByRole('dialog', { name: 'DOWNLOADING ADDS IT TO YOUR LIBRARY' });
	await expect(sheet).toContainText('LINDENBOROUGH: SIDE STORIES GOES INTO YOUR LIBRARY');
	await expect(sheet).toContainText('THEN ALL 12 UNREAD CHAPTERS DOWNLOAD.');
	// CANCEL changes nothing: still a preview, nothing queued.
	const before = queued().size;
	await sheet.getByRole('button', { name: 'CANCEL' }).click();
	await expect(sheet).toBeHidden();
	await expect(page.getByRole('button', { name: /ADD TO LIBRARY/ })).toBeVisible();
	expect(queued().size).toBe(before);

	await dl.locator('.lcs.inline').getByRole('button', { name: 'FIRST 10' }).click();
	await expect(sheet).toContainText('THEN ITS FIRST 10 UNREAD CHAPTERS DOWNLOAD.');
	await sheet.getByRole('button', { name: 'ADD AND DOWNLOAD' }).click();
	await expect(page).toHaveURL(/\/series\/\d+\?added=.*&queued=10/);
	await expect(
		page.getByRole('banner', { name: 'Series' }).locator('a.back .back-label')
	).toHaveText('SOURCES');
	await expect(page.locator('.band')).toContainText('12 CHAPTERS · 10 DOWNLOADING');
	expect(queued().size).toBe(before + 10);
	// UNDO still takes it back, its queue with it.
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page).toHaveURL(/\/downloads\/source\//);
	expect(queued().size).toBe(before);
	expect(dialogs).toEqual([]);
});

test('DOWNLOAD’s ? opens 03’s In short, landing at ADD, DOWNLOAD, FOLLOW (doc/HELP.md)', async ({
	page
}) => {
	await page.goto(`/series/${ids.linden}`);
	await page.getByRole('button', { name: 'Help: downloading' }).click();
	const sheet = page.getByRole('dialog', { name: 'Help' });
	await expect(sheet).toContainText('HELP · 03 — FINDING AND DOWNLOADING');
	await expect(sheet).toContainText('OPENS AT 03 — ADD, DOWNLOAD, FOLLOW');
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toBeHidden();
});

test('FOLLOW turns accent, offers FOLLOWED, and comes off again', async ({ page }) => {
	await page.goto(`/series/${ids.linden}`);
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'FOLLOW' }).click();
	const following = page
		.locator('.dl-row .lcs.inline')
		.getByRole('button', { name: 'FOLLOWING ✓' });
	await expect(following).toBeVisible();
	await expect(following).toHaveClass(/acc/);
	await page.goto('/?shelf=all&followed=1');
	await expect(page.locator('.grid .tile')).toHaveCount(1);
	// What FOLLOW then queues, the app's ten-minute step decides: engine-backend-db.spec.ts.
	await page.goto(`/series/${ids.linden}`);
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'FOLLOWING ✓' }).click();
	await expect(
		page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'FOLLOW', exact: true })
	).toBeVisible();
});

test('REFRESH asks the source once, adds what is new, and downloads nothing', async ({ page }) => {
	await page.goto(`/series/${ids.linden}`);
	const refresh = page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'REFRESH' });
	await expect(refresh).toBeVisible();
	// The source lists exactly what the library has: a look that found nothing still says so.
	await refresh.click();
	await expect(page.locator('.band')).toContainText('NOTHING NEW');
	await expect(page.locator('.band')).toContainText('THE SOURCE LISTS NOTHING NEW');

	// A 31st chapter at the source: the refresh makes it an entry and queues nothing.
	grow = true;
	await page.locator('.dl-row .lcs.inline').getByRole('button', { name: 'REFRESH' }).click();
	await expect(page.locator('.band')).toContainText('1 NEW CHAPTER');
	await expect(page.locator('.band')).toContainText('NOTHING DOWNLOADED');
	const db = new Database(dbPath, { readonly: true });
	const added = db
		.prepare(
			`SELECT id, label, available FROM entries WHERE series_id = ? AND source_url = '/c/31'`
		)
		.get(ids.linden) as { id: number; label: string; available: number } | undefined;
	const queuedNew = added
		? (
				db.prepare(`SELECT COUNT(*) AS n FROM download_queue WHERE entry_id = ?`).get(added.id) as {
					n: number;
				}
			).n
		: -1;
	db.close();
	expect(added).toMatchObject({ label: 'Ch. 31', available: 0 });
	expect(queuedNew).toBe(0);
	// In the list it is, read from the screen as well as the database.
	await expect(page.locator(`#entry-${added!.id}`)).toBeVisible();
	grow = false;
});

test('REFRESH in the bulk bar asks the selection’s sources once, and downloads nothing', async ({
	page
}) => {
	await page.goto('/?sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const tile = (title: string) => page.locator('.grid .tile', { hasText: title });
	await tile('Lindenborough Heir').click();
	// A book with no source: skipped and counted, not refused.
	await tile('Hoshi no Umi no Tabibito').click();
	await expect(page.getByText('2 SELECTED')).toBeVisible();

	const refresh = page.getByRole('toolbar').getByRole('button', { name: 'REFRESH' });
	const band = page.locator('.refresh-band');
	await refresh.click();
	// One source asked (it lists exactly what the library has), one item skipped.
	await expect(band).toContainText('1 ASKED · 0 FOUND SOMETHING');
	await expect(band).toContainText('ALL ANSWERED');
	await expect(band).toContainText('1 SKIPPED');

	// A 32nd chapter at the source: the next run makes it an entry, and queues nothing.
	grow32 = true;
	const queuedBefore = queued().size;
	await refresh.click();
	await expect(band).toContainText('1 ASKED · 1 FOUND SOMETHING');
	const db = new Database(dbPath, { readonly: true });
	const ch32 = db
		.prepare(`SELECT label FROM entries WHERE series_id = ? AND label = 'Ch. 32'`)
		.get(ids.linden) as { label: string } | undefined;
	db.close();
	expect(ch32).toMatchObject({ label: 'Ch. 32' });
	// A look, not a fetch: FOLLOW stays the only thing that queues.
	expect(queued().size).toBe(queuedBefore);
	grow32 = false;

	// A source that doesn't answer is one failure among the run, and the band says which.
	down = true;
	await refresh.click();
	await expect(band).toContainText('1 FAILED · LINDENBOROUGH HEIR');
	down = false;
});

test('the live stream gives a version, and nothing of a hidden series', async ({ page }) => {
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
	// Paused: nothing downloading, and the version says so.
	expect(first.downloading).toBeNull();
	expect(first.version).toMatch(/^stop\|/);
	expect(first.version).not.toContain(String(hiddenCh[2]));
});

test('PAUSE and RESUME: RESUME is the accent cell while paused (state 9)', async ({ page }) => {
	await page.goto('/downloads');
	const resume = page.getByRole('button', { name: 'RESUME' });
	await expect(resume).toBeVisible();
	await expect(page.locator('.band.info')).toContainText('PAUSED ·');
	await resume.click();
	await expect(page.getByRole('button', { name: 'PAUSE' })).toBeVisible();
	await page.getByRole('button', { name: 'PAUSE' }).click();
	await expect(page.getByRole('button', { name: 'RESUME' })).toBeVisible();
});

// Last: once the engine stops answering, the screens say so.
test('the engine not answering keeps the row, dimmed, and says so (state 5)', async ({ page }) => {
	down = true;
	// A call that fails is what marks the engine down.
	await page.goto(`/downloads/source/${SIDE}`);
	await page.goto(`/series/${ids.linden}`);
	const dl = page.locator('.dl-row');
	await expect(dl.locator('.lk-b')).toContainText(
		'○ NOT ANSWERING · THE EXTENSION ENGINE ON THE WORKSTATION'
	);
	await expect(dl.locator('.lcs.inline .lc.dim')).toHaveCount(2);
	await expect(dl.locator('.lcs.inline .lc').first()).toHaveCSS('opacity', '0.35');
});
