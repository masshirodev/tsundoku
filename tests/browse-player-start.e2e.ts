import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The player's `?t=` (c734; doc/HIGHLIGHTS.md): a link opens an episode at a
 * second, over its saved place, once, and that second is not the viewer's until
 * the picture plays from it. Runs in `browse`, where the fixture's real 8 s clip
 * is served, and through the fake's first server, which stops as the clip starts,
 * so `?t=` survives a failover as a viewer's link must. Its own episode (S2 EP. 10,
 * which no other spec opens) and the saved place put back after each case, since
 * the browse database is shared. The saved place is 5: at the clip's ending
 * (from 6 s, the fake's timestamps) an episode counts as watched and opens at 0.
 */
test.use({
	viewport: { width: 1280, height: 800 },
	userAgent: devices['Desktop Chrome'].userAgent,
	hasTouch: false,
	isMobile: false,
	deviceScaleFactor: 1,
	serviceWorkers: 'block'
});
test.describe.configure({ mode: 'serial' });

function dbPath() {
	const dir = process.env.TMPDIR!;
	const file = readdirSync(dir).find((f) => /^tsundoku-e2e-browse-.*\.sqlite$/.test(f));
	if (!file) throw new Error(`no browse database in ${dir}`);
	return join(dir, file);
}
/** S2 EP. 10, and what it held, so each case can put it back. */
function episode() {
	const db = new Database(dbPath(), { readonly: true });
	try {
		return db
			.prepare(
				`SELECT e.id, e.series_id AS series FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.title = 'Tsukiakari no Ryokōsha' AND e.season = 2 AND e.episode_number = 10`
			)
			.get() as { id: number; series: number };
	} finally {
		db.close();
	}
}
function setSaved(entry: number, at: number | null) {
	const db = new Database(dbPath());
	try {
		db.prepare(
			// duration_s too: a play reports the file's real 8 s, and these cases need
			// the seed's 24 minutes for a `?t=` only the file can refuse.
			`UPDATE entries SET last_position = ?, read_at = NULL, last_opened_at = NULL, duration_s = 1440
			WHERE id = ?`
		).run(at, entry);
	} finally {
		db.close();
	}
}
function savedPlace(entry: number): number | null {
	const db = new Database(dbPath(), { readonly: true });
	try {
		return (
			db.prepare(`SELECT last_position FROM entries WHERE id = ?`).get(entry) as {
				last_position: number | null;
			}
		).last_position;
	} finally {
		db.close();
	}
}

// In a hook, not at load: `--list` collects this file with no browse world up.
let ep: { id: number; series: number };
test.beforeAll(() => {
	ep = episode();
});
test.afterEach(() => setSaved(ep.id, null));

const now = (page: Page) =>
	page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).currentTime);
const band = (page: Page) => page.locator('.resume');

/** The file is in and at a place: failover done, and the second it opened at has landed. */
async function landed(page: Page) {
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && Number.isFinite(v.duration) && v.duration > 0 && v.readyState >= 2;
		},
		undefined,
		{ timeout: 20_000 }
	);
}
/** Autoplay refused, as a browser with no gesture does: the seek still lands, and nothing plays. */
/**
 * Records whether the RESUMED band was ever drawn: it lasts 5 s and goes with the
 * failover's notice, so its absence at the end proves nothing about the start.
 */
const watchBand = (page: Page) =>
	page.addInitScript(() => {
		const w = window as unknown as { bandSeen: boolean };
		w.bandSeen = false;
		new MutationObserver(() => {
			if (document.querySelector('.resume')) w.bandSeen = true;
		}).observe(document, { childList: true, subtree: true });
	});
const bandSeen = (page: Page) =>
	page.evaluate(() => (window as unknown as { bandSeen: boolean }).bandSeen);
const refusePlay = (page: Page) =>
	page.addInitScript(() => {
		const real = HTMLMediaElement.prototype.play;
		(window as unknown as { realPlay: typeof real }).realPlay = real;
		HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('', 'NotAllowedError'));
	});
const open = async (page: Page, query: string) => {
	await page.goto(`/read/${ep.id}${query}`);
	await landed(page);
};

test('?t= opens there over a saved place, draws no RESUMED band, and leaves the URL', async ({
	page
}) => {
	setSaved(ep.id, 5);
	await watchBand(page);
	await open(page, '?t=3');
	await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause());
	expect(await bandSeen(page)).toBe(false);
	expect(await now(page)).toBeGreaterThanOrEqual(2.5);
	expect(await now(page)).toBeLessThan(4.9);
	await expect(band(page)).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/read/${ep.id}$`));
});

test('a reload after ?t= opens at the saved place: the link wins once', async ({ page }) => {
	setSaved(ep.id, 5);
	// Paused as it lands, inside the second a link's place is held for: the place stays 5.
	await open(page, '?t=3');
	await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause());
	await expect(page).toHaveURL(new RegExp(`/read/${ep.id}$`));
	expect(savedPlace(ep.id)).toBe(5);
	await page.reload();
	await landed(page);
	await expect(band(page)).toHaveText(/RESUMED AT 0:05/);
	expect(await now(page)).toBeGreaterThanOrEqual(4.5);
});

test('?t= typed again on a page that spent one wins again: once is per open, not per episode', async ({
	page
}) => {
	setSaved(ep.id, 5);
	await open(page, '?t=3');
	await watchBand(page);
	await open(page, '?t=1');
	await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause());
	expect(await now(page)).toBeLessThan(3);
	expect(await bandSeen(page)).toBe(false);
});

for (const bad of ['abc', '-5', '1e3', ''])
	test(`?t=${bad || '(empty)'} is no place: the saved place and its band stand, and the URL is clean`, async ({
		page
	}) => {
		setSaved(ep.id, 5);
		await open(page, `?t=${bad}`);
		await expect(band(page)).toHaveText(/RESUMED AT 0:05/);
		expect(await now(page)).toBeGreaterThanOrEqual(4.5);
		await expect(page).toHaveURL(new RegExp(`/read/${ep.id}$`));
	});

test('?t= past the catalogue’s length is no place either', async ({ page }) => {
	setSaved(ep.id, 5);
	await open(page, '?t=5000');
	await expect(band(page)).toHaveText(/RESUMED AT 0:05/);
	expect(await now(page)).toBeGreaterThanOrEqual(4.5);
});

test('?t= inside the catalogue’s length but past the file’s falls back to the saved place', async ({
	page
}) => {
	// The stored length says 24 minutes, the real clip 8 s: only the file can refuse it.
	setSaved(ep.id, 5);
	await open(page, '?t=100');
	await expect(band(page)).toHaveText(/RESUMED AT 0:05/);
	expect(await now(page)).toBeLessThan(8);
	expect(savedPlace(ep.id)).toBe(5);
});

test('nothing is saved while the picture sits at ?t=; playing from it is what saves', async ({
	page
}) => {
	setSaved(ep.id, 5);
	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().endsWith('/api/reading')) posts.push(r.postData() ?? '');
	});
	// The seek still lands and its timeupdate still fires, with nothing playing.
	await refusePlay(page);
	await open(page, '?t=3');
	await page.waitForFunction(
		() => (document.querySelector('video') as HTMLVideoElement).currentTime > 2.5
	);
	await page.waitForTimeout(1500);
	expect(posts).toEqual([]);
	expect(savedPlace(ep.id)).toBe(5);

	// The viewer presses play: the picture moves, and it is theirs now.
	await page.evaluate(() => {
		const w = window as unknown as { realPlay: () => Promise<void> };
		return w.realPlay.call(document.querySelector('video'));
	});
	await expect.poll(() => posts.length, { timeout: 10_000 }).toBeGreaterThan(0);
	expect(JSON.parse(posts[0])).toMatchObject({ kind: 'open', entryId: ep.id });
	expect(JSON.parse(posts[0]).page).toBeGreaterThanOrEqual(3);
});

test('NEXT and the previous episode do not carry ?t=', async ({ page }) => {
	await open(page, '?t=3');
	await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause());
	await page.keyboard.press('n');
	await page.waitForURL((u) => !u.pathname.endsWith(`/${ep.id}`));
	expect(new URL(page.url()).search).toBe('');
	await landed(page);
	expect(await now(page)).toBeLessThan(2);

	await open(page, '?t=3');
	await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause());
	await page.locator('.cells .cell', { hasText: /^← / }).click();
	await page.waitForURL((u) => !u.pathname.endsWith(`/${ep.id}`));
	expect(new URL(page.url()).search).toBe('');
	await landed(page);
	expect(await now(page)).toBeLessThan(2);
});

test('the highlights page’s EPISODE · m:ss → lands on the clip’s in point', async ({ page }) => {
	const db = new Database(dbPath());
	const id = Number(
		db
			.prepare(
				`INSERT INTO highlights (kind, series_id, entry_id, number, clip_in, clip_out, series_title,
					series_kind, entry_label, made_at)
				VALUES ('clip', ?, ?, 10, 3, 5, 'Tsukiakari no Ryokōsha', 'anime', 'Ep. 10', ?)`
			)
			.run(ep.series, ep.id, Date.now()).lastInsertRowid
	);
	db.close();
	try {
		setSaved(ep.id, 5);
		await watchBand(page);
		await page.goto(`/highlights?open=${id}`);
		await page
			.locator('[data-open-highlight]')
			.getByRole('link', { name: /· 00:03 →/ })
			.click();
		await page.waitForURL(new RegExp(`/read/${ep.id}`));
		await landed(page);
		await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause());
		expect(await now(page)).toBeGreaterThanOrEqual(2.5);
		expect(await now(page)).toBeLessThan(4.9);
		expect(await bandSeen(page)).toBe(false);
	} finally {
		const del = new Database(dbPath());
		del.prepare('DELETE FROM highlights WHERE id = ?').run(id);
		del.close();
	}
});
