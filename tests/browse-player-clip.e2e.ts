import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { devices, type Page, type Route } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * MARK IN, MARK OUT and KEEP in the player (c704; doc/HIGHLIGHTS.md, "Clips";
 * Anime.dc.html). Runs in `browse`, where a real 8 s clip is served through the
 * engine's proxy, so KEEP drives real ffmpeg end to end; the lane's own failure
 * shapes are `highlights-clips-db.spec.ts`'s, on a stand-in HLS server. Its own
 * episode (S2 EP. 5, which no other spec opens), its rows removed after each.
 */
test.use({
	viewport: { width: 1280, height: 800 },
	userAgent: devices['Desktop Chrome'].userAgent,
	hasTouch: false,
	isMobile: false,
	deviceScaleFactor: 1,
	serviceWorkers: 'block'
});
test.describe.configure({ mode: 'serial', timeout: 90_000 });

function dbPath() {
	const dir = process.env.TMPDIR!;
	const file = readdirSync(dir).find((f) => /^tsundoku-e2e-browse-.*\.sqlite$/.test(f));
	if (!file) throw new Error(`no browse database in ${dir}`);
	return join(dir, file);
}
function episodeId(): number {
	const db = new Database(dbPath(), { readonly: true });
	try {
		return (
			db
				.prepare(
					`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
					WHERE s.title = 'Tsukiakari no Ryokōsha' AND e.season = 2 AND e.episode_number = 5`
				)
				.get() as { id: number }
		).id;
	} finally {
		db.close();
	}
}
type Row = {
	clip_in: number;
	clip_out: number;
	copy_path: string;
	still_path: string;
	hidden: number;
};
function rows(entry: number): Row[] {
	const db = new Database(dbPath(), { readonly: true });
	try {
		return db
			.prepare(
				`SELECT clip_in, clip_out, copy_path, still_path, hidden FROM highlights WHERE kind = 'clip' AND entry_id = ?`
			)
			.all(entry) as Row[];
	} finally {
		db.close();
	}
}

// In a hook, not at load: `--list` collects this file with no browse world up.
let entry = 0;
test.beforeAll(() => {
	entry = episodeId();
});
test.afterEach(() => {
	const db = new Database(dbPath());
	try {
		db.prepare(`DELETE FROM highlights WHERE kind = 'clip' AND entry_id = ?`).run(entry);
	} finally {
		db.close();
	}
});

const bar = (page: Page) => page.locator('.cells');
const cell = (page: Page, name: string | RegExp) => bar(page).getByRole('button', { name });
const band = (page: Page) => page.locator('.clipband');

/** The file is in, paused, with the bar up, so marks land where the test puts the playhead. */
async function open(page: Page) {
	await page.goto(`/read/${entry}`);
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && v.duration > 7 && v.readyState >= 2;
		},
		undefined,
		{ timeout: 30_000 }
	);
	await page.evaluate(() => document.querySelector('video')!.pause());
	await expect(page.locator('.player')).toHaveClass(/chrome/);
}
async function at(page: Page, seconds: number) {
	await page.evaluate((t) => {
		document.querySelector('video')!.currentTime = t;
	}, seconds);
	await expect
		.poll(() => page.locator('.scrubrow .e').textContent(), { timeout: 5000 })
		.toBe(`0:${String(Math.floor(seconds)).padStart(2, '0')}`);
	await page.mouse.move(600, 400);
}

test('MARK IN, the range grows, MARK OUT, KEEP: real ffmpeg, a row, and a box on the scrubber', async ({
	page
}) => {
	await open(page);
	await at(page, 1);
	await expect(cell(page, 'Mark in')).toHaveText('MARK IN');
	await cell(page, 'Mark in').click();
	await expect(cell(page, /Mark in at 0:01/)).toHaveText('IN · 0:01');
	await expect(page.locator('.scrubrow .track .in-mark')).toHaveCount(1);

	// A range up: KEEP and ✕, and VOL gives way (A2).
	await at(page, 3);
	await expect(cell(page, /^KEEP/)).toHaveText('KEEP 0:02');
	await expect(cell(page, 'Drop the range')).toBeVisible();
	await expect(page.locator('.vol.desk')).toBeHidden();
	await expect(page.locator('.scrubrow .track .mr')).toHaveCount(1);

	await cell(page, /Mark out/).click();
	await expect(cell(page, /Mark out/)).toHaveText('OUT · 0:03');
	await cell(page, /^KEEP/).click();

	await expect(band(page)).toContainText(/CUTTING|FETCHING|WAITING/);
	await expect(band(page)).toContainText('CLIP KEPT · 0:02', { timeout: 60_000 });
	await expect(band(page).getByRole('link', { name: 'OPEN →' })).toHaveAttribute(
		'href',
		/\/highlights\?open=\d+/
	);
	const row = rows(entry);
	expect(row).toHaveLength(1);
	expect(row[0].clip_in).toBeCloseTo(1, 0);
	expect(row[0].clip_out).toBeCloseTo(3, 0);
	expect(row[0].copy_path).toMatch(/^clips\/\d+\.mkv$/);
	// The range is spent, and the box is solid.
	await expect(cell(page, 'Mark in')).toHaveText('MARK IN');
	await expect(page.locator('.scrubrow .track .kr')).toHaveCount(1);
	await expect(page.locator('.scrubrow .track .kr.dash')).toHaveCount(0);

	// A click on the box seeks to its start (A4).
	await at(page, 6);
	await page.locator('.scrubrow .track .kr').click();
	await expect
		.poll(() => page.evaluate(() => document.querySelector('video')!.currentTime))
		.toBeLessThan(2);
});

test('the keys: I, O and ENTER keep, an out before the in swaps, and ESC drops', async ({
	page
}) => {
	await open(page);
	await at(page, 4);
	await page.keyboard.press('i');
	await at(page, 2);
	await page.keyboard.press('o');
	await expect(cell(page, /^KEEP/)).toHaveText('KEEP 0:02');
	await page.keyboard.press('Escape');
	await expect(cell(page, 'Mark in')).toHaveText('MARK IN');
	await expect(page.locator('.scrubrow .track .mr')).toHaveCount(0);
	// ESC took the range, not the page.
	await expect(page).toHaveURL(new RegExp(`/read/${entry}$`));

	await at(page, 4);
	await page.keyboard.press('i');
	await at(page, 2);
	await page.keyboard.press('o');
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText('CLIP KEPT · 0:02', { timeout: 60_000 });
	expect(rows(entry)[0].clip_in).toBeCloseTo(2, 0);
	expect(rows(entry)[0].clip_out).toBeCloseTo(4, 0);
});

test('playback carries on while it is cut, and a second KEEP is another job', async ({ page }) => {
	await open(page);
	await at(page, 1);
	await page.keyboard.press('i');
	await at(page, 2);
	await page.keyboard.press('o');
	await page.keyboard.press('Enter');
	await expect(band(page)).toBeVisible();
	await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused)).toBe(true);
	await page.evaluate(() => document.querySelector('video')!.play());
	await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused)).toBe(false);
	await page.evaluate(() => document.querySelector('video')!.pause());

	await at(page, 3);
	await page.keyboard.press('i');
	await at(page, 4);
	await page.keyboard.press('o');
	await page.keyboard.press('Enter');
	await expect.poll(() => rows(entry).length, { timeout: 90_000 }).toBe(2);
});

test('leaving the page mid-cut lets the job finish, and the next visit shows the box', async ({
	page
}) => {
	await open(page);
	await at(page, 1);
	await page.keyboard.press('i');
	await at(page, 3);
	await page.keyboard.press('o');
	await page.keyboard.press('Enter');
	await expect(band(page)).toBeVisible();
	await page.goto('/highlights');
	await expect.poll(() => rows(entry).length, { timeout: 60_000 }).toBe(1);
	await open(page);
	await expect(page.locator('.scrubrow .track .kr')).toHaveCount(1);
});

test('NEXT mid-cut carries on too, and the range does not follow to the next episode', async ({
	page
}) => {
	await open(page);
	await at(page, 1);
	await page.keyboard.press('i');
	await at(page, 3);
	await page.keyboard.press('o');
	await page.keyboard.press('Enter');
	await expect(band(page)).toBeVisible();
	await page.keyboard.press('n');
	await page.waitForURL((u) => !u.pathname.endsWith(`/${entry}`));
	await expect(cell(page, 'Mark in')).toHaveText('MARK IN');
	await expect.poll(() => rows(entry).length, { timeout: 60_000 }).toBe(1);
});

test('a failed clip says why, and TRY AGAIN keeps the range and asks afresh', async ({ page }) => {
	await open(page);
	await at(page, 1);
	await page.keyboard.press('i');
	await at(page, 3);
	await page.keyboard.press('o');
	const job = {
		id: 'job1',
		entryId: entry,
		seriesId: 1,
		seriesTitle: 'T',
		entryLabel: 'Ep. 5',
		from: 1,
		to: 3,
		streamed: true,
		step: 'failed',
		percent: 0,
		why: 'stream',
		stoppedAt: 2,
		highlightId: null,
		finishedAt: 1
	};
	const posts: Record<string, unknown>[] = [];
	await page.route('**/api/highlights/clips', async (route: Route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		posts.push(route.request().postDataJSON());
		await route.fulfill({ status: 202, json: job });
	});
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText(
		"THE CLIP WASN'T MADE · THE STREAM STOPPED ANSWERING AT 0:02"
	);
	// The range stays marked, so trying again needs nothing (A8).
	await expect(cell(page, /^KEEP/)).toHaveText('KEEP 0:02');
	await band(page).getByRole('button', { name: 'TRY AGAIN' }).click();
	await expect.poll(() => posts.length).toBe(2);
	expect(posts[0].fresh).toBe(false);
	expect(posts[1].fresh).toBe(true);
	expect(posts[1].from).toBe(1);
});

for (const [why, words] of [
	['disk', 'NO ROOM ON THE DISK'],
	['down', "THE WORKSTATION ISN'T ANSWERING"]
] as const)
	test(`the band says ${words} (${why})`, async ({ page }) => {
		await open(page);
		await at(page, 1);
		await page.keyboard.press('i');
		await at(page, 2);
		await page.route('**/api/highlights/clips', (route: Route) =>
			route.request().method() === 'POST'
				? route.fulfill({
						status: 202,
						json: {
							id: `j-${why}`,
							entryId: entry,
							seriesId: 1,
							seriesTitle: 'T',
							entryLabel: 'Ep. 5',
							from: 1,
							to: 2,
							streamed: false,
							step: 'failed',
							percent: 0,
							why,
							stoppedAt: null,
							highlightId: null,
							finishedAt: 1
						}
					})
				: route.fallback()
		);
		await page.keyboard.press('Enter');
		await expect(band(page)).toContainText(words);
	});

test('a KEEP nobody answers says the workstation is away, and the range stands', async ({
	page
}) => {
	await open(page);
	await at(page, 1);
	await page.keyboard.press('i');
	await at(page, 2);
	await page.route('**/api/highlights/clips', (route: Route) =>
		route.request().method() === 'POST' ? route.abort() : route.fallback()
	);
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText("THE CLIP WASN'T MADE · THE WORKSTATION ISN'T ANSWERING");
	await expect(cell(page, /^KEEP/)).toHaveText('KEEP 0:01');
});

test('incognito dims MARK IN with its word, and the server refuses a KEEP', async ({ page }) => {
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/incognito');
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
	await open(page);
	const mark = cell(page, 'Mark in: INCOGNITO');
	await expect(mark).toHaveText('INCOGNITO');
	await expect(mark).toHaveCSS('opacity', '0.4');
	// aria-disabled keeps a pointer's press out only by its own guard.
	await mark.click({ force: true });
	await expect(page.locator('.scrubrow .track .in-mark')).toHaveCount(0);
	const r = await page.request.post('/api/highlights/clips', {
		data: { entry, from: 1, to: 2 }
	});
	expect(r.status()).toBe(403);
	expect(rows(entry)).toEqual([]);
});

test('offline dims MARK IN with its words', async ({ page, context }) => {
	await open(page);
	await context.setOffline(true);
	await expect(cell(page, 'Mark in: ○ NEEDS THE WORKSTATION')).toHaveText(
		'○ NEEDS THE WORKSTATION'
	);
	await context.setOffline(false);
	await expect(cell(page, 'Mark in')).toHaveText('MARK IN');
});

test('a kept clip’s copy and still are served from the page’s own door', async ({ page }) => {
	await open(page);
	await at(page, 1);
	await page.keyboard.press('i');
	await at(page, 2);
	await page.keyboard.press('o');
	await page.keyboard.press('Enter');
	await expect.poll(() => rows(entry).length, { timeout: 60_000 }).toBe(1);
	const id = /\/(\d+)\.mkv$/.exec(rows(entry)[0].copy_path)![1];
	for (const file of ['copy', 'still'])
		expect((await page.request.get(`/api/highlights/${id}/${file}`)).status(), file).toBe(200);
});
