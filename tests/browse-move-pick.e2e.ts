import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';

/**
 * MOVE's list and its pick (cards c490 and c491; doc/MOVE.md, "The
 * candidates" and "Picking a candidate"), against a world of its own: a fake
 * engine with seven sources that answer as real ones do (two MANGADEX, one
 * per language; two that find nothing; two that fail, one of them only
 * once; one that answers late) and whose candidates' details can be slowed
 * or failed on demand, a seeded database and a preview of the same build,
 * each on a port the OS hands out. Nothing here touches the browse world, so
 * it runs in the browse project beside its specs, once.
 *
 * c490: the matches first, the empty and the failed folded at the end, each
 * source named with its language, only the list scrolling beside the
 * comparison, a late answer never moving the hit under the pointer, and TRY
 * ALL AGAIN asking only the failed sources. c491: a pick asks no source
 * again, marks its row and draws the wait at once, a later pick wins over an
 * earlier one's late answer, and a failed comparison says so with MOVE off.
 */
test.describe.configure({ mode: 'serial' });

type Call = { method: string; sourceId: string; search?: string; url?: string };
type SearchMode = 'hits' | 'none' | 'fail' | 'fail-once';

const SERIES_TITLE = 'Pickwick Heir';
// LATE SCANS is first in the list's own order (the engine's, by source id),
// so a late answer drawn in that order would land above the
// hits already there: the order the matches use is the order they answered.
const SOURCES: { id: string; name: string; lang: string; mode: SearchMode }[] = [
	{ id: '100', name: 'Late Scans', lang: 'en', mode: 'hits' },
	{ id: '101', name: 'MangaDex', lang: 'en', mode: 'hits' },
	{ id: '102', name: 'MangaDex', lang: 'pt-BR', mode: 'hits' },
	{ id: '103', name: 'Quiet Scans', lang: 'en', mode: 'none' },
	{ id: '104', name: 'Empty Pages', lang: 'en', mode: 'none' },
	{ id: '105', name: 'Down Scans', lang: 'en', mode: 'fail-once' },
	{ id: '107', name: 'Gone Scans', lang: 'en', mode: 'fail' }
];
const LATE = '100';
const candidateId = (sourceId: string, url: string) =>
	`${sourceId}~${Buffer.from(url).toString('base64url')}`;
/** The candidates, by their URL at MangaDex (EN). */
const CAND = {
	a: { url: '/m/a', title: 'Pickwick Heir (A)' },
	b: { url: '/m/b', title: 'Pickwick Heir (B)' },
	c: { url: '/m/c', title: 'Pickwick Heir (C)' }
};

/** The candidate at MangaDex (PT-BR). */
const PT = { url: '/m/pt', title: 'Pickwick Herdeiro' };

const state = {
	calls: [] as Call[],
	/** A candidate's details wait this long, by URL. */
	slow: new Map<string, number>(),
	/** A candidate whose details fail, by URL. */
	failing: new Set<string>(),
	/** The late source's search waits this long. */
	lateMs: 0,
	/** Sources that failed once already. */
	failedOnce: new Set<string>(),
	/** Sources whose next search fails, whatever their mode. */
	failNext: new Set<string>()
};

async function freePort(): Promise<number> {
	return new Promise<number>((ok, no) => {
		const probe = createServer();
		probe.once('error', no);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => ok(port));
		});
	});
}

function hitsOf(sourceId: string) {
	const m = (url: string, title: string) => ({ url, title, status: 1, thumbnail_url: null });
	if (sourceId === '101')
		return [
			m('/manga/pick-me', SERIES_TITLE),
			m(CAND.a.url, CAND.a.title),
			m(CAND.b.url, CAND.b.title),
			m(CAND.c.url, CAND.c.title),
			// Enough rows that the list overflows at 1280 × 800.
			...Array.from({ length: 10 }, (_, i) => m(`/m/f${i}`, `Pickwick Filler ${i + 1}`))
		];
	if (sourceId === '102') return [m(PT.url, PT.title)];
	if (sourceId === LATE) return [m('/m/late', 'Pickwick Late')];
	if (sourceId === '105') return [m('/m/back', 'Pickwick Back Again')];
	return [];
}

function startEngine(port: number): Promise<Server> {
	const server = createHttp((req, res) => {
		const json = (status: number, v: unknown) =>
			res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
		if (req.url === '/challenges') return json(200, { solving: {}, solved: {} });
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as Call & { mangaData?: { url: string } };
			const url = b.mangaData?.url ?? '';
			state.calls.push({ method: b.method, sourceId: b.sourceId, search: b.search, url });
			const source = SOURCES.find((s) => s.id === b.sourceId);
			switch (b.method) {
				case 'getSearchManga': {
					const mode = source?.mode ?? 'none';
					if (state.failNext.delete(b.sourceId)) return json(500, { error: 'the site is down' });
					if (mode === 'fail') return json(500, { error: 'the site is down' });
					if (mode === 'fail-once' && !state.failedOnce.has(b.sourceId)) {
						state.failedOnce.add(b.sourceId);
						return json(500, { error: 'the site is down' });
					}
					const answer = { mangas: hitsOf(b.sourceId), hasNextPage: false };
					if (b.sourceId === LATE && state.lateMs > 0) {
						setTimeout(() => json(200, answer), state.lateMs);
						return;
					}
					return json(200, answer);
				}
				case 'getDetailsManga':
				case 'getChapterList': {
					const answer =
						b.method === 'getDetailsManga'
							? {
									url,
									title:
										[...Object.values(CAND), PT].find((c) => c.url === url)?.title ??
										'Pickwick Elsewhere',
									status: 1
								}
							: [3, 2, 1].map((n) => ({
									url: `${url}/c${n}`,
									name: `Chapter ${n}`,
									scanlator: null,
									chapter_number: n
								}));
					if (state.failing.has(url)) return json(500, { error: 'the site is down' });
					const ms = b.method === 'getDetailsManga' ? (state.slow.get(url) ?? 0) : 0;
					if (ms) {
						setTimeout(() => json(200, answer), ms);
						return;
					}
					return json(200, answer);
				}
				case 'supportLatestManga':
					return json(200, false);
				default:
					return json(404, { error: 'unknown' });
			}
		});
	});
	return new Promise<Server>((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

function seed(dbPath: string): number {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 4, 12);
		const series = (title: string, key: string) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library)
						VALUES (?, ?, 'manga', 'mihon', 210, ?, ?, ?, 1)`
					)
					.run(root, title, now, now, key).lastInsertRowid
			);
		for (const s of SOURCES) {
			// One extension per source, as the language a source serves is the
			// engine's own record of it (engine_sources.lang).
			const pkg = `e2e.pick.${s.id}`;
			db.prepare(
				`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
				VALUES (?, ?, 'manga', 1, '1', '1', ?, 0, 0, '')`
			).run(pkg, s.name, pkg.padEnd(64, '0'));
			db.prepare(
				`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, ?, ?)`
			).run(s.id, pkg, s.name, s.lang, `https://s${s.id}.example`);
			// A series from each, so the search asks every one (sourcesToSearch).
			if (s.id !== '101') series(`Kept From ${s.id}`, `mihon:${s.id}:/manga/kept`);
		}
		const id = series(SERIES_TITLE, 'mihon:101:/manga/pick-me');
		for (const n of [1, 2])
			db.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, file, bytes, page_count, available, source_url)
				VALUES (?, ?, ?, ?, '', 0, 0, 0, ?)`
			).run(id, n, `Ch. ${n}`, now, `/manga/pick-me/c${n}`);
		return id;
	} finally {
		db.close();
	}
}

let work = '';
let base = '';
let seriesId = 0;
let engine: Server | null = null;
let preview: ChildProcess | null = null;

test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-pick-'));
	const dbPath = join(work, 'library.sqlite');
	seriesId = seed(dbPath);
	const enginePort = await freePort();
	engine = await startEngine(enginePort);
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
			BACKUP_DIR: join(work, 'backups'),
			SUWAYOMI_URL: ''
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
	if (!up) throw new Error('the pick preview never answered');
});

test.afterAll(async () => {
	preview?.kill();
	engine?.closeAllConnections();
	if (engine) await new Promise((ok) => engine!.close(ok));
	if (work) rmSync(work, { recursive: true, force: true });
});

test.beforeEach(() => {
	state.calls = [];
	state.slow.clear();
	state.failing.clear();
	state.lateMs = 0;
	state.failedOnce.clear();
	state.failNext.clear();
});

/** The session cookie is the suite's (localhost, any port), so this preview takes it too. */
async function open(page: Page, query = '', waitUntil: 'load' | 'commit' = 'load') {
	await page.goto(`${base}/series/${seriesId}/move${query}`, { waitUntil });
}

const searches = () => state.calls.filter((c) => c.method === 'getSearchManga');
const heads = (page: Page) => page.locator('.scroll > .ghead').allTextContents();
const settledList = (page: Page) => expect(page.locator('.scroll .asking')).toHaveCount(0);

test('the matches come first, each source with its language, and the empty and the failed fold at the end (c490)', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await open(page);
	await settledList(page);
	await expect(page.locator('.lab')).toContainText('01 — 5 OF 7 SOURCES ANSWERED');

	// The two MANGADEX are told apart by language; only sources with hits are open.
	const open_ = (await heads(page)).map((t) => t.replace(/\s+/g, ' ').trim());
	expect(open_).toHaveLength(3);
	expect(open_.some((t) => t.startsWith('MANGADEX · EN'))).toBe(true);
	expect(open_.some((t) => t.startsWith('MANGADEX · PT-BR'))).toBe(true);
	expect(open_.some((t) => t.startsWith('LATE SCANS · EN'))).toBe(true);

	// Both folds are closed, and after every hit.
	const nothing = page.locator('details.fold.nothing');
	const failed = page.locator('details.fold.unanswered');
	await expect(nothing.locator('summary')).toContainText('2 FOUND NOTHING');
	await expect(failed.locator('summary')).toContainText('2 DID NOT ANSWER');
	await expect(nothing).not.toHaveAttribute('open');
	await expect(failed).not.toHaveAttribute('open');
	await expect(page.getByText('QUIET SCANS · EN')).toBeHidden();
	const order = await page
		.locator('.scroll')
		.evaluate((el) =>
			[...el.children].map((c) =>
				c.matches('details.nothing')
					? 'nothing'
					: c.matches('details.unanswered')
						? 'failed'
						: c.matches('.cand')
							? 'hit'
							: 'other'
			)
		);
	expect(order.lastIndexOf('hit')).toBeLessThan(order.indexOf('nothing'));
	expect(order.indexOf('nothing')).toBeLessThan(order.indexOf('failed'));
	expect(order.at(-1)).toBe('failed');
	// The series itself still counts as a match of its source.
	await expect(page.locator('.cand.now', { hasText: 'THIS SERIES NOW' })).toBeVisible();

	// Opening a fold shows its sources; the failed one keeps each TRY AGAIN.
	await nothing.locator('summary').click();
	await expect(nothing.getByText('QUIET SCANS · EN')).toBeVisible();
	await expect(nothing.getByText('EMPTY PAGES · EN')).toBeVisible();
	await failed.locator('summary').click();
	await expect(failed.getByRole('link', { name: 'TRY AGAIN', exact: true })).toHaveCount(2);
	await expect(failed.getByRole('link', { name: 'TRY ALL AGAIN' })).toHaveCount(1);
});

test('TRY ALL AGAIN asks only the sources that did not answer, and TRY AGAIN only its own (c490)', async ({
	page
}) => {
	await open(page);
	await settledList(page);
	expect(searches()).toHaveLength(7);
	state.calls = [];

	const failed = page.locator('details.fold.unanswered');
	await failed.locator('summary').click();
	await failed.getByRole('link', { name: 'TRY ALL AGAIN' }).click();
	// DOWN SCANS answers this time and joins the matches; GONE SCANS fails again.
	await expect(page.locator('a.cand', { hasText: 'Pickwick Back Again' })).toBeVisible();
	await expect(failed.locator('summary')).toContainText('1 DID NOT ANSWER');
	expect(
		searches()
			.map((c) => c.sourceId)
			.sort()
	).toEqual(['105', '107']);
	expect(page.url()).not.toContain('source=');

	state.calls = [];
	await failed.getByRole('link', { name: 'TRY AGAIN', exact: true }).click();
	await expect(failed.locator('summary')).toContainText('1 DID NOT ANSWER');
	await expect.poll(() => searches().map((c) => c.sourceId)).toEqual(['107']);
});

test('a source that answers late joins below, and the hit under the pointer stays put (c490)', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	// LATE SCANS fails first, then answers late when asked again. (A late
	// answer on the first paint can't be watched here: the e2e's server is
	// `vite preview`, which gzips every response whole, so a streamed page
	// arrives at once. TRY AGAIN's answer is the list's same door.)
	state.failNext.add(LATE);
	await open(page);
	await settledList(page);
	const failed = page.locator('details.fold.unanswered');
	await failed.locator('summary').click();
	state.lateMs = 2500;
	await failed.locator('.failed', { hasText: 'LATE SCANS' }).getByRole('link').click();
	await expect(page.locator('.scroll .asking')).toContainText('1 STILL ASKING');

	const hit = page.locator('a.cand', { hasText: CAND.b.title });
	await hit.hover();
	const before = await hit.boundingBox();
	await expect(page.locator('a.cand', { hasText: 'Pickwick Late' })).toBeVisible({
		timeout: 10_000
	});
	expect(await hit.boundingBox()).toEqual(before);
	// It joined the matches below the ones already drawn.
	const lastHead = (await heads(page)).at(-1) ?? '';
	expect(lastHead).toContain('LATE SCANS');
});

test('beside the comparison only the list scrolls: the comparison stays and the page never moves (c490)', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await open(page, `?to=${candidateId('101', CAND.a.url)}`);
	await expect(page.getByRole('heading', { name: CAND.a.title })).toBeVisible();
	await settledList(page);
	const cmp = page.locator('.cmp');
	const before = await cmp.boundingBox();
	const list = page.locator('.scroll');
	expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	await list.hover();
	await page.mouse.wheel(0, 1200);
	await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	expect(await cmp.boundingBox()).toEqual(before);
	await expect(page.getByRole('button', { name: /MOVE TO MANGADEX →/ })).toBeInViewport();
	// The bar, the search and OTHER NAMES' line stay put too.
	await expect(page.locator('.qform')).toBeInViewport();
	await expect(page.locator('.lab')).toBeInViewport();
});

test('picking a candidate asks no source again, marks it at once and shows its comparison (c491)', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await open(page);
	await settledList(page);
	state.calls = [];
	state.slow.set(CAND.a.url, 1500);
	const loads: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('__data.json')) loads.push(r.url());
	});

	const a = page.locator('a.cand', { hasText: CAND.a.title });
	await a.click();
	// Within a frame: the row is marked and the right side says it is reading.
	await expect(a).toHaveClass(/\bon\b/, { timeout: 200 });
	await expect(page.locator('.empty.wait')).toBeVisible({ timeout: 200 });
	await expect(page.locator('.empty.wait')).toContainText('MANGADEX');
	await expect(page.locator('.empty.wait')).toHaveAttribute('aria-busy', 'true');
	await expect(page.getByRole('button', { name: 'MOVE', exact: true })).toBeDisabled();
	await expect(page).toHaveURL(/to=/);

	await expect(page.getByRole('heading', { name: CAND.a.title })).toBeVisible();
	await expect(page.locator('.confirm input[name="to"]')).toHaveValue(
		candidateId('101', CAND.a.url)
	);
	expect(searches()).toHaveLength(0);
	expect(loads).toHaveLength(0);
	// The list did not reset under the pointer.
	await expect(page.locator('.scroll .asking')).toHaveCount(0);
});

test('a second quick pick wins over the first one’s late answer, and BACK and a reload land on the URL’s (c491)', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await open(page);
	await settledList(page);
	state.calls = [];
	state.slow.set(CAND.a.url, 2000);
	await page.locator('a.cand', { hasText: CAND.a.title }).click();
	// A is being asked when B is picked.
	await expect
		.poll(() => state.calls.filter((c) => c.method === 'getDetailsManga' && c.url === CAND.a.url))
		.toHaveLength(1);
	// The second pick is on the other MANGADEX: a source is asked one call at
	// a time, so a candidate of the same source would queue behind A's.
	await page.locator('a.cand', { hasText: PT.title }).click();
	await expect(page.getByRole('heading', { name: PT.title })).toBeVisible();
	// A's answer arrives after B's, and is dropped.
	await expect
		.poll(() => state.calls.filter((c) => c.method === 'getChapterList' && c.url === CAND.a.url))
		.toHaveLength(1);
	await page.waitForTimeout(500);
	await expect(page.getByRole('heading', { name: PT.title })).toBeVisible();
	await expect(page.getByRole('heading', { name: CAND.a.title })).toHaveCount(0);
	await expect(page.locator('.confirm input[name="to"]')).toHaveValue(candidateId('102', PT.url));
	await expect(page.locator('a.cand.on')).toHaveCount(1);
	expect(searches()).toHaveLength(0);

	// BACK goes to A's comparison, a reload keeps it.
	state.slow.clear();
	await page.goBack();
	await expect(page.getByRole('heading', { name: CAND.a.title })).toBeVisible();
	await expect(page.locator('a.cand.on')).toContainText(CAND.a.title);
	await page.reload();
	await expect(page.getByRole('heading', { name: CAND.a.title })).toBeVisible();
	await expect(page.locator('a.cand.on')).toContainText(CAND.a.title);
});

test('a comparison that fails says so with TRY AGAIN, and MOVE is off until it answers (c491)', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await open(page);
	await settledList(page);
	// A first, so an old comparison is on screen when C fails.
	await page.locator('a.cand', { hasText: CAND.a.title }).click();
	await expect(page.getByRole('heading', { name: CAND.a.title })).toBeVisible();
	state.failing.add(CAND.c.url);
	await page.locator('a.cand', { hasText: CAND.c.title }).click();
	await expect(
		page.getByText('That source wouldn’t say.').or(page.getByText("That source wouldn't say."))
	).toBeVisible();
	await expect(page.getByRole('heading', { name: CAND.a.title })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /MOVE TO/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'MOVE', exact: true })).toBeDisabled();
	await expect(page.locator('form.confirm')).toHaveCount(0);

	state.failing.clear();
	await page.locator('.cmp').getByRole('link', { name: 'TRY AGAIN' }).click();
	await expect(page.getByRole('heading', { name: CAND.c.title })).toBeVisible();
	await expect(page.getByRole('button', { name: /MOVE TO MANGADEX →/ })).toBeEnabled();
});

test('without script a pick is a page of its own, with its comparison (c491)', async ({
	browser
}) => {
	const ctx = await browser.newContext({
		javaScriptEnabled: false,
		storageState: test.info().project.use.storageState
	});
	const page = await ctx.newPage();
	await page.goto(`${base}/series/${seriesId}/move`);
	await expect(page.locator('.lab')).toContainText('01 — 5 OF 7 SOURCES ANSWERED');
	await expect(page.locator('details.fold.unanswered summary')).toContainText('2 DID NOT ANSWER');
	await page.locator('a.cand', { hasText: CAND.b.title }).click();
	await expect(page.getByRole('heading', { name: CAND.b.title })).toBeVisible();
	await expect(page.getByRole('button', { name: /MOVE TO MANGADEX →/ })).toBeVisible();
	await ctx.close();
});
