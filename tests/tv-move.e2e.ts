import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * MOVE from a remote (doc/MOVE.md). The screens are not built on the focus
 * layer: this pins that a D-pad reaches them, and that BACK
 * climbs the comparison before it leaves the page.
 *
 * It reads and never moves anything -- `tests/browse-move.e2e.ts` owns the move
 * itself, on its own series ("Movenberg Heir"), so this one walks
 * "Lindenborough Heir" to the comparison and stops there. The browse world's
 * server, because the fake engine is what has a candidate to offer.
 *
 * Its last describe needs sources that find nothing and fail, which the
 * browse world has none of, so it brings a world of its own, as
 * `browse-move-pick.e2e.ts` does: a fake engine, a seeded database and a
 * preview of the same build, each on a port the OS hands out.
 */

const BROWSE = `http://localhost:${process.env.PLAYWRIGHT_BROWSE_PORT ?? '4194'}`;
const TITLE = 'Lindenborough Heir';

test.use({ baseURL: BROWSE });

const focused = (page: import('@playwright/test').Page) =>
	page.evaluate(() => ({
		text: document.activeElement?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
		cls: document.activeElement?.className ?? ''
	}));

async function openMove(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	// SOURCE is folded under DETAILS on a TV: one stop, OK opens it in place.
	const details = page.locator('[data-row="details"]');
	await details.focus();
	await expect(async () => {
		if ((await details.getAttribute('aria-expanded')) !== 'true')
			await page.keyboard.press('Enter');
		await expect(details).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
	}).toPass();
	// The SOURCE row's way out is a ruled cell of the panel, and a stop.
	await page.getByRole('link', { name: 'MOVE →' }).focus();
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/series\/\d+\/move/);
}

test('the SOURCE row opens the move page, and arrows walk its candidates', async ({ page }) => {
	await openMove(page);
	await expect(page.getByText('MOVE TO ANOTHER SOURCE')).toBeVisible();

	// Nothing focused: the first arrow takes the page's top-left, the top bar's ←.
	await page.keyboard.press('ArrowDown');
	expect((await focused(page)).text).toContain('SERIES');
	// ↓ to the search field, ↓ to the candidate the source answered with.
	await page.keyboard.press('ArrowDown');
	expect((await focused(page)).cls).toContain('svelte');
	await page.keyboard.press('ArrowDown');
	expect((await focused(page)).cls).toContain('cand');
});

test('a candidate opens the comparison, and BACK climbs before it leaves', async ({ page }) => {
	await openMove(page);
	const candidate = page.locator('a.cand').first();
	await expect(candidate).toBeVisible();
	await candidate.focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/to=/);

	// The comparison is a screen of ruled blocks: the fold, then the MOVE bar.
	const move = page.getByRole('button', { name: /MOVE TO .+ →/ });
	await expect(move).toBeVisible();
	await move.focus();
	expect((await focused(page)).text).toContain('MOVE TO');

	// BACK climbs to the top of the screen first (doc/FOCUS.md), and does not
	// leave the page.
	const at = page.url();
	await page.keyboard.press('Escape');
	expect(page.url()).toBe(at);
	expect((await focused(page)).text).toContain('SERIES');
	// At the top there is nothing left for the page to take: the app leaves.
	expect(await page.evaluate(() => window.tsundokuBack!())).toBe(false);
});

// ---- a world with a failing source ----------------------------------------------------

test.describe('MOVE’s folds on a TV', () => {
	test.describe.configure({ mode: 'serial' });

	const SERIES = 'Foldwell Heir';
	const SOURCES = [
		{ id: '201', name: 'Answer Scans', mode: 'hits' },
		{ id: '202', name: 'Quiet Scans', mode: 'none' },
		{ id: '203', name: 'Down Scans', mode: 'fail' }
	] as const;
	const searches: string[] = [];
	let work = '';
	let base = '';
	let seriesId = 0;
	let engine: Server | null = null;
	let preview: ChildProcess | null = null;

	const freePort = () =>
		new Promise<number>((ok, no) => {
			const probe = createServer();
			probe.once('error', no);
			probe.listen(0, '127.0.0.1', () => {
				const { port } = probe.address() as AddressInfo;
				probe.close(() => ok(port));
			});
		});

	function startEngine(port: number): Promise<Server> {
		const server = createHttp((req, res) => {
			const json = (status: number, v: unknown) =>
				res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			if (req.url === '/challenges') return json(200, { solving: {}, solved: {} });
			let raw = '';
			req.on('data', (c) => (raw += c));
			req.on('end', () => {
				const b = JSON.parse(raw || '{}') as {
					method: string;
					sourceId: string;
					mangaData?: { url: string };
				};
				const mode = SOURCES.find((x) => x.id === b.sourceId)?.mode ?? 'none';
				const url = b.mangaData?.url ?? '';
				switch (b.method) {
					case 'getSearchManga':
						searches.push(b.sourceId);
						if (mode === 'fail') return json(500, { error: 'the site is down' });
						return json(200, {
							mangas:
								mode === 'hits'
									? [{ url: '/m/fold', title: `${SERIES} (Elsewhere)`, status: 1 }]
									: [],
							hasNextPage: false
						});
					case 'getDetailsManga':
						return json(200, { url, title: `${SERIES} (Elsewhere)`, status: 1 });
					case 'getChapterList':
						return json(
							200,
							[2, 1].map((n) => ({
								url: `${url}/c${n}`,
								name: `Chapter ${n}`,
								scanlator: null,
								chapter_number: n
							}))
						);
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
			const root = (
				db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number }
			).id;
			const now = Date.UTC(2026, 10, 5, 12);
			const series = (title: string, key: string) =>
				Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library)
							VALUES (?, ?, 'manga', 'mihon', 210, ?, ?, ?, 1)`
						)
						.run(root, title, now, now, key).lastInsertRowid
				);
			for (const x of SOURCES) {
				const pkg = `e2e.fold.${x.id}`;
				db.prepare(
					`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
					VALUES (?, ?, 'manga', 1, '1', '1', ?, 0, 0, '')`
				).run(pkg, x.name, pkg.padEnd(64, '0'));
				db.prepare(
					`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', ?)`
				).run(x.id, pkg, x.name, `https://s${x.id}.example`);
				// A series from each, so MOVE's search asks every one (sourcesToSearch).
				if (x.id !== '201') series(`Kept From ${x.id}`, `mihon:${x.id}:/manga/kept`);
			}
			const id = series(SERIES, 'mihon:201:/manga/foldwell');
			for (const n of [1, 2])
				db.prepare(
					`INSERT INTO entries (series_id, position, label, added_at, file, bytes, page_count, available, source_url)
					VALUES (?, ?, ?, ?, '', 0, 0, 0, ?)`
				).run(id, n, `Ch. ${n}`, now, `/manga/foldwell/c${n}`);
			return id;
		} finally {
			db.close();
		}
	}

	test.beforeAll(async () => {
		test.setTimeout(120_000);
		work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-tvfold-'));
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
		if (!up) throw new Error('the TV fold preview never answered');
	});

	test.afterAll(async () => {
		preview?.kill();
		engine?.closeAllConnections();
		if (engine) await new Promise((ok) => engine!.close(ok));
		if (work) rmSync(work, { recursive: true, force: true });
	});

	/** Where focus is: the element's own words, and which fold holds it, if any. */
	const at = (page: import('@playwright/test').Page) =>
		page.evaluate(() => {
			const el = document.activeElement as HTMLElement | null;
			const fold = el?.closest('details.fold');
			return {
				text: el?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
				summary: el?.tagName === 'SUMMARY',
				fold: fold ? (fold.classList.contains('nothing') ? 'nothing' : 'unanswered') : null
			};
		});

	test('FOUND NOTHING and DID NOT ANSWER are one stop each, and TRY AGAIN inside the opened fold is a stop', async ({
		page
	}) => {
		await page.goto(`${base}/series/${seriesId}/move`);
		const nothing = page.locator('details.fold.nothing');
		const failed = page.locator('details.fold.unanswered');
		await expect(nothing.locator('summary')).toContainText('1 FOUND NOTHING');
		await expect(failed.locator('summary')).toContainText('1 DID NOT ANSWER');
		await expect(page.locator('.scroll .asking')).toHaveCount(0);

		// ↓ until focus stops moving: every stop on the way, from the top.
		const stops: Awaited<ReturnType<typeof at>>[] = [];
		for (let i = 0; i < 30; i++) {
			await page.keyboard.press('ArrowDown');
			const now = await at(page);
			const last = stops.at(-1);
			if (last && last.text === now.text && last.fold === now.fold) break;
			stops.push(now);
		}
		const inFold = (f: 'nothing' | 'unanswered') => stops.filter((x) => x.fold === f);
		// Closed, each fold is its summary alone: one stop, nothing inside it.
		expect(inFold('nothing'), JSON.stringify(stops)).toEqual([
			expect.objectContaining({ summary: true, text: expect.stringContaining('1 FOUND NOTHING') })
		]);
		expect(inFold('unanswered'), JSON.stringify(stops)).toEqual([
			expect.objectContaining({ summary: true, text: expect.stringContaining('1 DID NOT ANSWER') })
		]);

		// OK opens DID NOT ANSWER where it is; ↓ then walks into it, TRY ALL AGAIN first.
		await failed.locator('summary').focus();
		await page.keyboard.press('Enter');
		await expect(failed).toHaveAttribute('open', '');
		await page.keyboard.press('ArrowDown');
		expect(await at(page)).toMatchObject({ fold: 'unanswered', text: 'TRY ALL AGAIN' });
		await page.keyboard.press('ArrowDown');
		expect(await at(page)).toMatchObject({ fold: 'unanswered', text: 'TRY AGAIN' });
		// And OK on it asks that source again, in place.
		const before = searches.filter((x) => x === '203').length;
		await page.keyboard.press('Enter');
		await expect.poll(() => searches.filter((x) => x === '203').length).toBe(before + 1);
		await expect(failed.locator('summary')).toContainText('1 DID NOT ANSWER');
		expect(page.url()).toBe(`${base}/series/${seriesId}/move`);
	});
});
