import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * GROUP AS ONE SHOW's sheet, measured (c283, S2; doc/WORKS.md, "Per-season
 * sources"). The measurements below are `Seasons-Group.dc.html`'s (A1) and
 * the design system's `wk.css`: the AS row's two answers, NAME without its
 * season marker, SEASONS' order, the numbered rows (52px number cell, 34px
 * cover), the explanation and the merge foot. They are hand-pinned from
 * `design-tools/extract-spec.mjs`'s summary and `wk.css` rather than run
 * through `gen-conformance`, which would write `@playwright/test` back into
 * the frame (c542; doc/TESTING.md, "Regenerating the frame spec").
 *
 * It runs once, in `tablet-landscape`, the board's 1280x800; the other device
 * projects skip it. It seeds a database of its own and serves the build on a
 * free port, like the Works frames, because it selects anime the seed has none
 * of and must not leave a selection behind for anyone else.
 */
test.use({ viewport: { width: 1280, height: 800 } });
test.describe.configure({ mode: 'serial', timeout: 60_000 });

const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-seasons-frame-${process.pid}.sqlite`);
const wipe = () => {
	for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
};
let server: ChildProcess | null = null;
const SEASONS = ["Frieren: Beyond Journey's End", "Frieren: Beyond Journey's End Season 2"];

test.use({ baseURL: base });

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test.beforeAll(async ({}, testInfo) => {
	// The board is the tablet-landscape's 1280x800 (Seasons-Group.dc.html's own
	// preview props); the other device projects ignore this file.
	test.skip(
		testInfo.project.name !== 'tablet-landscape',
		'the group sheet frame is the handoff’s 1280x800'
	);
	test.setTimeout(120_000);
	wipe();
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	seedAnime();
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-seasons-frame-empty-${process.pid}`),
			TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-seasons-frame-home-${process.pid}`)
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
	if (!up) throw new Error('the seasons frame preview never answered');
});

test.afterAll(() => {
	server?.kill();
	server = null;
	wipe();
});

function seedAnime() {
	const db = new Database(dbPath);
	const root = (db.prepare(`SELECT id FROM roots ORDER BY id LIMIT 1`).get() as { id: number }).id;
	const now = Date.UTC(2026, 10, 9);
	// The source a season's row names: `engine_sources.name` for the id in its
	// key, which is what the SOURCE row shows (source-facts' `sourceName`).
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle,
			installed_at, updated_at)
		VALUES ('e2e.aniyomi', 'Aniyomi', 'anime', 1, '1.0', 'aniyomi', 'e2e', ?, ?)`
	).run(now, now);
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url)
		VALUES ('7', 'e2e.aniyomi', 'KICKASSANIME', 'en', 'https://example.test')`
	).run();
	SEASONS.forEach((title, i) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, status, source, path, origin_key,
						source_url, added_at, indexed_at, in_library, hue)
					VALUES (?, ?, 'anime', 'completed', 'Kakkoi', '', ?, ?, ?, ?, 1, 160)`
				)
				.run(root, title, `aniyomi:7:/frieren-${i + 1}`, `https://example.test/f${i}`, now, now)
				.lastInsertRowid
		);
		db.prepare(`INSERT INTO anime_series (series_id, folder) VALUES (?, ?)`).run(
			id,
			`Anime/Frieren ${i + 1}`
		);
		// The board's own year, from the catalogue entry `season-links.ts` writes.
		db.prepare(
			`INSERT INTO series_season_links (series_id, season, part, via, linked_at, year, episodes)
			VALUES (?, 1, 1, 'list', ?, ?, 2)`
		).run(id, now, i === 0 ? 2023 : 2026);
		for (const n of [1, 2])
			db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
					available, duration_s, season, episode_number, source_url, origin_source, read_at)
				VALUES (?, ?, ?, ?, ?, 0, '', ?, 1440, ?, ?, ?, '', ?)`
			).run(
				id,
				n,
				`Ep. ${n}`,
				`${title} ${n}`,
				now,
				// One episode on disk (HERE) and one watched (WATCHED): the board's line.
				n === 1 ? 1 : 0,
				i + 1,
				n,
				`https://example.test/f${i}/${n}`,
				n === 1 ? now : null
			);
	});
	db.close();
}

const sheetOf = (page: Page) => page.getByRole('dialog', { name: 'Group into a series' });

async function openShow(page: Page) {
	await page.goto('/?shelf=k:anime&sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const title of SEASONS)
		await page
			.locator('.grid .tile')
			.filter({
				has: page.locator('.title', {
					hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
				})
			})
			.locator('.open')
			.click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = sheetOf(page);
	await expect(sheet).toBeVisible();
	// The sheet rises; measure once it has come to rest (doc/MOTION.md).
	await sheet.evaluate(async (el) => {
		await Promise.allSettled(el.getAnimations({ subtree: true }).map((a) => a.finished));
	});
	return sheet;
}

test('The ONE SHOW sheet: AS label, answers, NAME, SEASONS', async ({ page }) => {
	const sheet = await openShow(page);
	await expect(sheet.getByRole('radio', { name: /ONE SHOW/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(sheet.getByRole('textbox', { name: 'Show name' })).toHaveValue(SEASONS[0]);
	await expect(sheet.locator('.sl.name-label')).toContainText('WITHOUT “SEASON 2”');

	const asLabel = await sheet.locator('.sl.as').evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			justifyContent: cs.justifyContent,
			columnGap: cs.columnGap,
			padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
			font: [cs.fontSize, cs.fontWeight]
		};
	});
	expect(asLabel).toEqual({
		display: 'flex',
		justifyContent: 'space-between',
		columnGap: '12px',
		padding: ['18px', '24px', '10px', '24px'],
		font: ['13px', '500']
	});

	// Two answers, equal cells, the board's tall 64px.
	const answers = sheet.locator('.seg.answers');
	const tracks = (
		(await answers.evaluate((node) => getComputedStyle(node).gridTemplateColumns)) as string
	).split(' ');
	expect(tracks).toHaveLength(2);
	expect(parseFloat(tracks[1])).toBeCloseTo(parseFloat(tracks[0]), 0);
	const cell = await answers
		.locator('button')
		.first()
		.evaluate((node) => {
			const cs = getComputedStyle(node);
			return { minHeight: cs.minHeight, fontSize: cs.fontSize };
		});
	expect(cell).toEqual({ minHeight: '64px', fontSize: '13px' });

	const name = await sheet.getByRole('textbox', { name: 'Show name' }).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			height: cs.height,
			padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
			fontSize: cs.fontSize,
			borderTopWidth: cs.borderTopWidth
		};
	});
	expect(name).toEqual({
		height: '52px',
		padding: ['0px', '14px', '0px', '14px'],
		fontSize: '16px',
		borderTopWidth: '1px'
	});

	await expect(sheet.locator('.sl.order-label')).toContainText('SEASONS · 2');
	await expect(sheet.locator('.sl.order-label')).toContainText('THE ORDER IS THE NUMBERING');
});

test('The ONE SHOW sheet: numbered rows and the merge foot', async ({ page }) => {
	const sheet = await openShow(page);
	const rows = sheet.locator('.rows.grows .row');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0).locator('.num')).toHaveText('S1');
	await expect(rows.nth(1).locator('.num')).toHaveText('S2');

	// The board's meta line (A1, line 76): the source's name, EP., the year,
	// WATCHED in ink and how many episodes are on disk.
	const line = rows.first().locator('.t .b');
	await expect(line).toHaveText('KICKASSANIME · 2 EP. · 2023 · 1 WATCHED · 1 HERE');
	await expect(line.locator('.ink')).toHaveText('1 WATCHED');
	await expect(rows.nth(1).locator('.t .b')).toHaveText(
		'KICKASSANIME · 2 EP. · 2026 · 1 WATCHED · 1 HERE'
	);

	const row = await rows.first().evaluate((node) => {
		const cs = getComputedStyle(node);
		const num = getComputedStyle(node.querySelector('.num') as Element);
		const cover = (node.querySelector('.cov .cover') as HTMLElement).getBoundingClientRect();
		const nudges = [...node.querySelectorAll('.nudge')].map((n) => n.getBoundingClientRect().width);
		const title = getComputedStyle(node.querySelector('.t .a') as Element);
		const meta = getComputedStyle(node.querySelector('.t .b') as Element);
		return {
			minHeight: cs.minHeight,
			numWidth: num.width,
			coverWidth: Math.round(cover.width),
			coverHeight: Math.round(cover.height),
			nudges,
			title: [title.fontSize, title.fontWeight],
			meta: [meta.fontSize, meta.fontWeight]
		};
	});
	expect(row).toEqual({
		minHeight: '64px',
		numWidth: '52px',
		coverWidth: 34,
		coverHeight: 49,
		nudges: [44, 44],
		title: ['14px', '500'],
		meta: ['11px', '400']
	});

	const keeps = sheet.locator('.keeps');
	await expect(keeps).toContainText("S2'S EPISODES BECOME");
	await expect(keeps).toContainText('EACH SEASON KEEPS ITS SOURCE ENTRY');

	const foot = await sheet.locator('.sfoot').evaluate((node) => {
		const cs = getComputedStyle(node);
		const button = (node.querySelector('.create') as HTMLElement).getBoundingClientRect();
		return { height: cs.height, buttonWidth: Math.round(button.width) };
	});
	const width = await sheet.evaluate((node) => Math.round(node.getBoundingClientRect().width));
	expect(foot.height).toBe('64px');
	expect(foot.buttonWidth).toBe(width);
	await expect(
		sheet.getByRole('button', { name: /MERGE · 2 SEASONS INTO ONE SERIES/ })
	).toBeVisible();
	await expect(sheet.locator('.create')).toContainText('UNDO AFTER');
});
