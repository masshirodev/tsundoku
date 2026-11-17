import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { ANIME_SOURCE, noVideo, resetEngine } from './browse-world';

/**
 * NO SERVER on a browsing record (doc/MOVE.md): an episode played from a
 * preview whose source sends no video offers + ADD, never ANOTHER SOURCE →,
 * which linked to MOVE, and MOVE never opens on a series that isn't in the
 * library (it would 404). The library series' case keeps the
 * cell. Runs in `browse`, whose fake engine sends no video while
 * `/__novideo` is set.
 *
 * Each case plays an episode of a series of its own, written here and deleted
 * after: the server keeps an episode's videos for ten minutes and asks for the
 * next episode's ahead (src/lib/server/anime/streams.ts), so a seeded episode
 * another spec has reached would play from what was kept, never asking the
 * source. In incognito, and the engine is reset.
 */
test.describe.configure({ mode: 'serial' });

function db(): Database.Database {
	const dir = process.env.TMPDIR!;
	const file = readdirSync(dir).find((f) => /^tsundoku-e2e-browse-.*\.sqlite$/.test(f));
	if (!file) throw new Error(`no browse database in ${dir}`);
	return new Database(join(dir, file));
}

/** A series of one episode no other spec reaches, in the library or a browsing record. */
function series(slug: string, inLibrary: boolean): { series: number; entry: number } {
	const d = db();
	try {
		const root = (d.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.now();
		const id = Number(
			d
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, status, added_at, indexed_at, origin_key, in_library)
					VALUES (?, ?, 'anime', 'AnimePahe', 'ongoing', ?, ?, ?, ?)`
				)
				.run(
					root,
					`No Server ${slug}`,
					now,
					now,
					`aniyomi:${ANIME_SOURCE.id}:/show/${slug}`,
					inLibrary ? 1 : 0
				).lastInsertRowid
		);
		const entry = Number(
			d
				.prepare(
					`INSERT INTO entries (series_id, position, label, added_at, season, episode_number, available, source_url)
					VALUES (?, 1, 'Ep. 1', ?, 1, 1, 0, ?)`
				)
				.run(id, now, `/ep/${slug}-1`).lastInsertRowid
		);
		return { series: id, entry };
	} finally {
		d.close();
	}
}

const made: number[] = [];
test.beforeEach(async ({ page, baseURL }) => {
	await page.context().addCookies([{ name: 'tsundoku_incognito', value: '1', url: baseURL! }]);
	await noVideo();
});
test.afterEach(async () => {
	await resetEngine();
});
test.afterAll(() => {
	const d = db();
	try {
		for (const id of made) {
			d.prepare(`DELETE FROM entries WHERE series_id = ?`).run(id);
			d.prepare(`DELETE FROM series WHERE id = ?`).run(id);
		}
	} finally {
		d.close();
	}
});

const cells = (page: import('@playwright/test').Page) => page.locator('.player .icells');

test('a preview’s NO SERVER offers + ADD, not ANOTHER SOURCE', async ({ page }) => {
	const record = series('c999-preview', false);
	made.push(record.series);
	await page.goto(`/read/${record.entry}`);

	await expect(cells(page).getByRole('button', { name: 'TRY AGAIN' })).toBeVisible();
	await expect(cells(page).getByRole('button', { name: '+ ADD' })).toBeVisible();
	await expect(cells(page).getByRole('link', { name: 'ANOTHER SOURCE →' })).toHaveCount(0);
});

test('a library series’ NO SERVER keeps ANOTHER SOURCE, and it opens MOVE', async ({ page }) => {
	const library = series('c999-library', true);
	made.push(library.series);
	await page.goto(`/read/${library.entry}`);

	const another = cells(page).getByRole('link', { name: 'ANOTHER SOURCE →' });
	await expect(another).toBeVisible();
	await expect(cells(page).getByRole('button', { name: '+ ADD' })).toHaveCount(0);
	const opened = await page.request.get((await another.getAttribute('href'))!);
	expect(opened.status()).toBe(200);
});
