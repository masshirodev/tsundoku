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
 * OTHER FORMS on the series screen (doc/SERIES.md, "OTHER FORMS"): FIND
 * lands on SEARCH THE SOURCES with the other kind's band picked, and GROUP AS A
 * WORK on an IN LIBRARY row opens the GROUP flow with both series picked, after
 * which the row reads IN THIS WORK. A `-flow`, because it groups: it runs once
 * (tablet-portrait), on a seeded database of its own and its own preview on a
 * port the OS hands out. ENGINE_URL names a port nothing answers: the sources
 * SEARCH lists are rows, and only the asking would reach it.
 *
 * The cache's rows are written by hand: the link pass fills them, through
 * nothing a browser can reach, and tests/other-forms-db.spec.ts walks that
 * pass over AniList's recorded answer. The graph here is that answer's shape.
 */
test.describe.configure({ mode: 'serial' });

const work = mkdtempSync(
	join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-forms-')
);
const dbPath = join(work, 'forms.sqlite');
let preview: ChildProcess | null = null;
let BASE = '';

const freePort = (): Promise<number> =>
	new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});

const node = (id: number, format: string, type: string, title: string, chapters?: number) => ({
	id,
	type,
	format,
	status: 'FINISHED',
	episodes: null,
	chapters: chapters ?? null,
	volumes: null,
	year: 2000,
	title: { english: title, romaji: title, native: null },
	edges: null
});

type Ids = { finds: number; groups: number; manga: number };

function seed(): Ids {
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
		const now = Date.UTC(2026, 10, 8, 12);
		const series = (title: string, kind: string, source: string, key: string) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library)
						VALUES (?, ?, ?, ?, 30, ?, ?, ?, 1)`
					)
					.run(root, title, kind, source, now, now, key).lastInsertRowid
			);
		const anime = (title: string, key: string, anilist: number) => {
			const id = series(title, 'anime', 'aniyomi', key);
			db.prepare(
				`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
				VALUES (?, 1, 'Episode 1', 1, 1, ?, '', 0, 0, 0, ?)`
			).run(id, now, `/a/${id}/1`);
			db.prepare(
				`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, title, linked_at, resolved_at, format)
				VALUES (?, 1, 1, ?, 'review', ?, ?, ?, 'TV')`
			).run(id, anilist, title, now, now);
			return id;
		};
		const graph = (self: number, title: string, edges: ReturnType<typeof node>[]) =>
			JSON.stringify({
				nodes: {
					[self]: {
						...node(self, 'TV', 'ANIME', title),
						edges: edges.map((e) => ({ type: 'SOURCE', id: e.id }))
					},
					...Object.fromEntries(edges.map((e) => [e.id, e]))
				}
			});
		const cache = (id: number, g: string) =>
			db
				.prepare(
					`INSERT INTO series_relations (series_id, graph, fetched_at, tried_at) VALUES (?, ?, ?, ?)`
				)
				.run(id, g, now, now);
		const finds = anime('Forms Find Show', 'aniyomi:400:/forms-find', 9101);
		cache(
			finds,
			graph(9101, 'Forms Find Show', [node(9201, 'MANGA', 'MANGA', 'Forms Far Manga', 40)])
		);
		const groups = anime('Forms Group Show', 'aniyomi:400:/forms-group', 9102);
		cache(
			groups,
			graph(9102, 'Forms Group Show', [node(9202, 'MANGA', 'MANGA', 'Forms Near Manga', 12)])
		);
		const manga = series('Forms Group Manga', 'manga', 'mihon', 'mihon:100:/forms-group-manga');
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, 1, 'Chapter 1', ?, 'forms/1.cbz', 1000, 20, 1, ?)`
		).run(manga, now, `/c/${manga}/1`);
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, via, title, linked_at, resolved_at, format)
			VALUES (?, 9202, 'review', 'Forms Near Manga', ?, ?, 'MANGA')`
		).run(manga, now, now);
		const source = (id: string, pkg: string, name: string, kind: string) => {
			db.prepare(
				`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
				VALUES (?, ?, ?, 1, '1.0', '1.4', ?, 0, 0, '')`
			).run(pkg, name, kind, pkg.padEnd(64, '0'));
			db.prepare(
				`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://example.org')`
			).run(id, pkg, name);
		};
		source('100', 'e2e.pages', 'Pages Source', 'manga');
		source('400', 'e2e.video', 'Video Source', 'anime');
		return { finds, groups, manga };
	} finally {
		db.close();
	}
}

const ids = seed();

test.beforeAll(async () => {
	const port = await freePort();
	const engine = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			ENGINE_URL: `http://127.0.0.1:${engine}`,
			ENGINE_TOKEN: 'e2e-forms-token',
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
	throw new Error('the forms preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	rmSync(work, { recursive: true, force: true });
});

const line = (page: Page) => page.getByRole('button', { name: /OTHER FORMS?\b/ });

/** Unfold it as a user does, once the page runs. */
async function unfold(page: Page, url: string) {
	await page.goto(url);
	await expect(async () => {
		if ((await line(page).getAttribute('aria-expanded')) !== 'true') await line(page).click();
		await expect(line(page)).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
	}).toPass({ timeout: 20_000 });
}

test('FIND asks SEARCH THE SOURCES for that title in that kind, its band picked', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${ids.finds}`);
	await expect(line(page)).toHaveText(/\+ 1 OTHER FORM · MANGA/);
	await expect(page.locator('[data-form]')).toHaveCount(0);
	await unfold(page, `${BASE}/series/${ids.finds}`);
	const row = page.locator('[data-form="9201"]');
	await expect(row).toContainText('MANGA · FINISHED · 40 CH.');
	await expect(row).toContainText('Forms Far Manga');
	await row.getByRole('link', { name: /Find MANGA/ }).click();
	await page.waitForURL(/\/downloads\/search\?/);
	expect(new URL(page.url()).searchParams.get('q')).toBe('Forms Far Manga');
	expect(new URL(page.url()).searchParams.get('kind')).toBe('manga');
	const band = page.getByRole('navigation', { name: 'Kinds' });
	await expect(band.getByRole('link', { name: /^MANGA/ })).toHaveClass(/\bon\b/);
	await expect(band.getByRole('link', { name: /^ALL/ })).not.toHaveClass(/\bon\b/);
	// Only that kind's sources are asked.
	await expect(page.getByRole('navigation', { name: 'Sources' }).getByRole('link')).toHaveText([
		/^ALL/,
		/^Pages Source/i
	]);
});

test('GROUP AS A WORK opens the flow with both series, this one first; after it the row reads IN THIS WORK', async ({
	page
}) => {
	await unfold(page, `${BASE}/series/${ids.groups}`);
	const row = page.locator('[data-form="9202"]');
	await expect(row.getByRole('link', { name: 'MANGA · IN LIBRARY →' })).toHaveAttribute(
		'href',
		new RegExp(`/series/${ids.manga}$`)
	);
	// Nothing changes until it is tapped: CANCEL leaves the row as it was.
	await row.getByRole('button', { name: 'GROUP AS A WORK' }).click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(sheet.locator('.row .a')).toHaveText(['Forms Group Show', 'Forms Group Manga']);
	await sheet.getByRole('button', { name: 'CANCEL' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(row.getByRole('button', { name: 'GROUP AS A WORK' })).toBeVisible();

	await row.getByRole('button', { name: 'GROUP AS A WORK' }).click();
	await expect(sheet.locator('.row .a')).toHaveText(['Forms Group Show', 'Forms Group Manga']);
	await sheet.getByRole('textbox').fill('Forms Work');
	await sheet.getByRole('button', { name: 'CREATE WORK · 2 SERIES' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(row).toContainText('IN THIS WORK · PART 2');
	await expect(row.getByRole('button', { name: 'GROUP AS A WORK' })).toHaveCount(0);
	await expect(row.getByRole('link', { name: 'MANGA · IN LIBRARY →' })).toHaveAttribute(
		'href',
		new RegExp(`/series/${ids.manga}\\?`)
	);

	// UNDO is the flow's own, on the band it left, and puts the offer back.
	const band = page.locator('.band', { hasText: 'FORMS WORK' });
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(row.getByRole('button', { name: 'GROUP AS A WORK' })).toBeVisible();
	await expect(row).not.toContainText('IN THIS WORK');
	await expect(band).toHaveCount(0);
});

test('a refused UNDO says why on its band, and the row still tells the truth', async ({ page }) => {
	await unfold(page, `${BASE}/series/${ids.groups}`);
	const row = page.locator('[data-form="9202"]');
	await row.getByRole('button', { name: 'GROUP AS A WORK' }).click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('textbox').fill('Forms Refused');
	await sheet.getByRole('button', { name: 'CREATE WORK · 2 SERIES' }).click();
	await expect(row).toContainText('IN THIS WORK · PART 2');
	const band = page.locator('.band', { hasText: 'FORMS REFUSED' });
	await expect(band).toBeVisible();
	// Another tab ended the Work since: its UNDO has nothing to take back.
	const db = new Database(dbPath);
	try {
		db.pragma('foreign_keys = ON');
		db.prepare(`DELETE FROM works`).run();
	} finally {
		db.close();
	}
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(band).toHaveCount(1);
	await expect(band).not.toContainText('EACH KEEPS ITS OWN');
	await expect(row.getByRole('button', { name: 'GROUP AS A WORK' })).toBeVisible();
});

test('the band goes when the screen is left, and BACK does not bring it back', async ({ page }) => {
	await unfold(page, `${BASE}/series/${ids.groups}`);
	const row = page.locator('[data-form="9202"]');
	await row.getByRole('button', { name: 'GROUP AS A WORK' }).click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('textbox').fill('Forms Left');
	await sheet.getByRole('button', { name: 'CREATE WORK · 2 SERIES' }).click();
	await expect(row).toContainText('IN THIS WORK · PART 2');
	const band = page.locator('.band', { hasText: 'FORMS LEFT' });
	await expect(band).toBeVisible();

	// The page component is reused from one series to the next, and the row's
	// link is a real navigation away from this one.
	await row.getByRole('link', { name: 'MANGA · IN LIBRARY →' }).click();
	await page.waitForURL(new RegExp(`/series/${ids.manga}\\b`));
	await expect(band).toHaveCount(0);

	await page.goBack();
	await page.waitForURL(new RegExp(`/series/${ids.groups}\\b`));
	await expect(line(page)).toBeVisible();
	await expect(band).toHaveCount(0);
});
