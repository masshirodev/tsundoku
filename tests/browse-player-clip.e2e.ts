import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { devices, type Locator, type Page, type Route } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * MARK IN, MARK OUT and KEEP in the player (doc/HIGHLIGHTS.md, "Clips";
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
test.afterEach(async ({ request }) => {
	// Jobs live in the server's memory for ten minutes, past the rows below: a failure
	// left by one case is otherwise the band the next case's wait is satisfied by.
	const left = (await (await request.get(`/api/highlights/clips?entry=${entry}`)).json()) as {
		id: string;
	}[];
	for (const j of left) await request.delete(`/api/highlights/clips/${j.id}`);
	const db = new Database(dbPath());
	try {
		db.prepare(`DROP TRIGGER IF EXISTS clip_fails_for_this_spec`).run();
		db.prepare(`DELETE FROM highlights WHERE kind = 'clip' AND entry_id = ?`).run(entry);
	} finally {
		db.close();
	}
});

/**
 * The next cut of this episode fails at its last step, in the real lane: ffmpeg
 * runs on the real file and the row refuses. Asked of the database because every
 * other way to fail the job is inside the server, where `page.route` can't reach.
 */
function failingCuts(on: boolean) {
	const db = new Database(dbPath());
	try {
		db.prepare(`DROP TRIGGER IF EXISTS clip_fails_for_this_spec`).run();
		if (on)
			db.exec(`CREATE TRIGGER clip_fails_for_this_spec BEFORE INSERT ON highlights
				WHEN NEW.kind = 'clip' AND NEW.entry_id = ${entry}
				BEGIN SELECT RAISE(ABORT, 'held by the spec'); END`);
	} finally {
		db.close();
	}
}
/** Every word the band says from now on, so a band that came and went is still seen. */
async function recordBand(page: Page) {
	await page.evaluate(() => {
		const seen: string[] = [];
		(window as unknown as { bandSaid: string[] }).bandSaid = seen;
		const note = () => {
			const text = document.querySelector('.clipband')?.textContent?.trim();
			if (text && seen.at(-1) !== text) seen.push(text);
		};
		new MutationObserver(note).observe(document.querySelector('.player')!, {
			subtree: true,
			childList: true,
			characterData: true
		});
	});
}
const bandSaid = (page: Page) =>
	page.evaluate(() => (window as unknown as { bandSaid: string[] }).bandSaid);
/** The POSTs a KEEP or a TRY AGAIN sent, from here on. */
function countPosts(page: Page) {
	const posts: Record<string, unknown>[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/highlights/clips')
			posts.push(r.postDataJSON());
	});
	return posts;
}
/** By the keyboard, as someone without a pointer gets there: the page's own tab order. */
async function tabTo(page: Page, target: Locator) {
	for (let i = 0; i < 60; i++) {
		await page.keyboard.press('Tab');
		if (await target.evaluate((el) => el === document.activeElement)) return;
	}
	throw new Error('Tab never reached it');
}
/** The range 1 s to 3 s marked, by the keys. */
async function markOneToThree(page: Page) {
	await at(page, 1);
	await page.keyboard.press('i');
	await at(page, 3);
	await page.keyboard.press('o');
	await expect(cell(page, /^KEEP/)).toHaveText('KEEP 0:02');
}

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

test('TRY AGAIN after a real failure: real POST, real poll, and the failure does not come back', async ({
	page
}) => {
	await open(page);
	await markOneToThree(page);
	failingCuts(true);
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText("THE CLIP WASN'T MADE", { timeout: 60_000 });
	await expect(cell(page, /^KEEP/)).toHaveText('KEEP 0:02');
	failingCuts(false);
	await recordBand(page);
	const posts = countPosts(page);
	await band(page).getByRole('button', { name: 'TRY AGAIN' }).click();
	await expect(band(page)).toContainText('CLIP KEPT · 0:02', { timeout: 60_000 });
	expect(posts).toHaveLength(1);
	expect(posts[0].fresh).toBe(true);
	// Past two of the poll's ticks: it is the poll that brought the failure back.
	await page.waitForTimeout(2300);
	await expect(band(page)).toContainText('CLIP KEPT · 0:02');
	const said = await bandSaid(page);
	expect(said.some((t) => /FETCHING|CUTTING|WAITING/.test(t))).toBe(true);
	expect(said.filter((t) => t.includes("WASN'T MADE"))).toEqual([]);
	expect(rows(entry)).toHaveLength(1);
	await expect(page.locator('.scrubrow .track .kr:not(.dash)')).toHaveCount(1);

	// A reload agrees: the box is there and no failure with it.
	await open(page);
	await expect(page.locator('.scrubrow .track .kr:not(.dash)')).toHaveCount(1);
	await expect(band(page)).toHaveCount(0);
});

test('a poll still in flight when TRY AGAIN was pressed does not bring the failure back', async ({
	page
}) => {
	await open(page);
	await markOneToThree(page);
	const failed = {
		id: 'j-failed',
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
	const working = {
		...failed,
		id: 'j-new',
		step: 'cutting',
		percent: 20,
		why: null,
		stoppedAt: null
	};
	let posts = 0;
	await page.route('**/api/highlights/clips', (route: Route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		return route.fulfill({ status: 202, json: posts++ === 0 ? failed : working });
	});
	let polls = 0;
	// The server, as a poll sent before the retry reached it still sees it.
	await page.route(/\/api\/highlights\/clips\?entry=/, (route: Route) => {
		polls++;
		return route.fulfill({ json: [failed, working] });
	});
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText("THE CLIP WASN'T MADE");
	await recordBand(page);
	await band(page).getByRole('button', { name: 'TRY AGAIN' }).click();
	await expect(band(page)).toContainText('CUTTING');
	await expect.poll(() => polls, { timeout: 10_000 }).toBeGreaterThan(2);
	await expect(band(page)).toContainText('CUTTING');
	expect((await bandSaid(page)).filter((t) => t.includes("WASN'T MADE"))).toEqual([]);
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a plain KEEP again after a real failure, no retry, ends on the new clip, and a reload or a second page says so too', async ({
	page
}) => {
	await open(page);
	await markOneToThree(page);
	failingCuts(true);
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText("THE CLIP WASN'T MADE", { timeout: 60_000 });
	failingCuts(false);
	await recordBand(page);
	const posts = countPosts(page);
	await cell(page, /^KEEP/).click();
	await expect(band(page)).toContainText('CLIP KEPT · 0:02', { timeout: 60_000 });
	expect(posts.map((p) => p.fresh)).toEqual([false]);
	await page.waitForTimeout(2300);
	await expect(band(page)).toContainText('CLIP KEPT · 0:02');
	expect(rows(entry)).toHaveLength(1);

	// Within the lane's ten minutes, a new page asks the server what this range
	// came to: the clip, its box, and no failure over it.
	const second = await page.context().newPage();
	for (const p of [page, second]) {
		// The player asks the lane once as it mounts: that answer is the one read.
		const answered = p.waitForResponse(
			(r) => r.request().method() === 'GET' && /\/api\/highlights\/clips\?entry=/.test(r.url())
		);
		await open(p);
		const jobs = (await (await answered).json()) as { step: string }[];
		await expect(p.locator('.scrubrow .track .kr:not(.dash)')).toHaveCount(1);
		await expect(p.locator('.player')).toHaveClass(/chrome/);
		await expect(p.getByText("THE CLIP WASN'T MADE")).toHaveCount(0);
		expect(jobs.map((j) => j.step)).toEqual(['made']);
	}
	await second.close();
});

test('a second KEEP nobody answers says so over the first clip, and TRY AGAIN cuts the second range', async ({
	page
}) => {
	await open(page);
	await markOneToThree(page);
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText('CLIP KEPT · 0:02', { timeout: 60_000 });
	await expect(page.locator('.scrubrow .track .kr:not(.dash)')).toHaveCount(1);

	await at(page, 4);
	await page.keyboard.press('i');
	await at(page, 6);
	await page.keyboard.press('o');
	await page.route('**/api/highlights/clips', (route: Route) =>
		route.request().method() === 'POST' ? route.abort() : route.fallback()
	);
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText("THE WORKSTATION ISN'T ANSWERING");
	await expect(band(page)).not.toContainText('CLIP KEPT');
	const again = band(page).getByRole('button', { name: 'TRY AGAIN' });
	await expect(again).toBeVisible();
	await expect(cell(page, /^KEEP/)).toHaveText('KEEP 0:02');

	await page.unroute('**/api/highlights/clips');
	const posts = countPosts(page);
	await again.click();
	await expect.poll(() => rows(entry).length, { timeout: 60_000 }).toBe(2);
	expect(posts).toHaveLength(1);
	expect(posts[0].fresh).toBe(true);
	expect(rows(entry).map((r) => Math.round(r.clip_in))).toEqual([1, 4]);
	await expect(band(page)).toContainText('CLIP KEPT · 0:02');
});

test('a KEEP nobody answers is not forgotten when the poll for another job answers', async ({
	page
}) => {
	await open(page);
	await markOneToThree(page);
	const working = {
		id: 'j-working',
		entryId: entry,
		seriesId: 1,
		seriesTitle: 'T',
		entryLabel: 'Ep. 5',
		from: 5,
		to: 6,
		streamed: true,
		step: 'cutting',
		percent: 10,
		why: null,
		stoppedAt: null,
		highlightId: null,
		finishedAt: null
	};
	let polls = 0;
	await page.route(/\/api\/highlights\/clips\?entry=/, (route: Route) => {
		polls++;
		return route.fulfill({ json: [working] });
	});
	let sent = 0;
	await page.route('**/api/highlights/clips', (route: Route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		return sent++ === 0 ? route.fulfill({ status: 202, json: working }) : route.abort();
	});
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText('CUTTING');
	await at(page, 7);
	await page.keyboard.press('i');
	await at(page, 5);
	await page.keyboard.press('o');
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText("THE WORKSTATION ISN'T ANSWERING");
	const seen = polls;
	await expect.poll(() => polls, { timeout: 10_000 }).toBeGreaterThan(seen + 1);
	await expect(band(page)).toContainText("THE WORKSTATION ISN'T ANSWERING");
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const [status, words] of [
	[400, "THAT RANGE CAN'T BE KEPT"],
	[403, 'INCOGNITO KEEPS NO CLIPS'],
	[404, 'THE EPISODE IS GONE']
] as const)
	test(`a refused KEEP (${status}) says ${words}, with no TRY AGAIN`, async ({ page }) => {
		await open(page);
		await markOneToThree(page);
		await page.route('**/api/highlights/clips', (route: Route) =>
			route.request().method() === 'POST'
				? route.fulfill({ status, json: { message: 'no' } })
				: route.fallback()
		);
		await page.keyboard.press('Enter');
		await expect(band(page)).toContainText(`THE CLIP WASN'T MADE · ${words}`);
		await expect(band(page)).not.toContainText('WORKSTATION');
		await expect(band(page).getByRole('button', { name: 'TRY AGAIN' })).toHaveCount(0);
		await expect(cell(page, /^KEEP/)).toHaveText('KEEP 0:02');
		// The next KEEP starts clean: its answer is the only word on the band.
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		await page.keyboard.press('Enter');
		await expect(band(page)).toContainText('CLIP KEPT · 0:02', { timeout: 60_000 });
	});

test('ENTER on the focused ✕ drops the range, and starts no cut', async ({ page }) => {
	await open(page);
	await markOneToThree(page);
	const posts = countPosts(page);
	await tabTo(page, cell(page, 'Drop the range'));
	await page.keyboard.press('Enter');
	await expect(cell(page, 'Mark in')).toHaveText('MARK IN');
	await expect(page.locator('.scrubrow .track .mr')).toHaveCount(0);
	expect(posts).toEqual([]);
	expect(rows(entry)).toEqual([]);
});

test('ENTER on the focused TRY AGAIN retries, once', async ({ page }) => {
	await open(page);
	await markOneToThree(page);
	failingCuts(true);
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText("THE CLIP WASN'T MADE", { timeout: 60_000 });
	failingCuts(false);
	const posts = countPosts(page);
	await tabTo(page, band(page).getByRole('button', { name: 'TRY AGAIN' }));
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText('CLIP KEPT · 0:02', { timeout: 60_000 });
	expect(posts).toHaveLength(1);
	expect(posts[0].fresh).toBe(true);
});

test('ENTER on a focused transport cell is that cell’s, and the range stands', async ({ page }) => {
	await open(page);
	await markOneToThree(page);
	const posts = countPosts(page);
	await tabTo(page, page.locator('.cells [data-focus-start]'));
	await page.keyboard.press('Enter');
	await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused)).toBe(false);
	await page.evaluate(() => document.querySelector('video')!.pause());
	await expect(cell(page, /^KEEP/)).toBeVisible();
	expect(posts).toEqual([]);
});

test('ENTER on the focused KEEP keeps, once', async ({ page }) => {
	await open(page);
	await markOneToThree(page);
	const posts = countPosts(page);
	await tabTo(page, cell(page, /^KEEP/));
	await page.keyboard.press('Enter');
	await expect(band(page)).toContainText('CLIP KEPT · 0:02', { timeout: 60_000 });
	expect(posts).toHaveLength(1);
	expect(rows(entry)).toHaveLength(1);
});

test('/highlights says KEEPING while a job is held in progress, and stops when it is done', async ({
	page
}) => {
	let answer: unknown[] = [
		{
			id: 'j-held',
			entryId: entry,
			seriesId: 1,
			seriesTitle: 'T',
			entryLabel: 'Ep. 5',
			from: 1,
			to: 3,
			streamed: true,
			step: 'cutting',
			percent: 40,
			why: null,
			stoppedAt: null,
			highlightId: null,
			finishedAt: null
		}
	];
	await page.route('**/api/highlights/clips', (route: Route) =>
		route.request().method() === 'GET' ? route.fulfill({ json: answer }) : route.fallback()
	);
	await page.goto('/highlights');
	const line = page.locator('[data-keeping]');
	await expect(line).toHaveText('KEEPING · EP. 5 · 0:01–0:03 · 40%');
	answer = [];
	await expect(line).toHaveCount(0, { timeout: 10_000 });
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
