import { test, expect } from './fixtures';
import { devices, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { SOURCES } from './browse-world';

/**
 * The seek preview over the scrubber (doc/ANIME.md "The player"): a
 * downloaded episode shows its sprite's tile for the time under the pointer,
 * the time alone while it has none, and a stream shows a frame of its lowest
 * quality, fetched one segment per stop and only while the pointer is on the
 * bar.
 *
 * The browse world's fake engine (tests/browse-setup.ts, not this slot's)
 * serves the fixture clip as a plain WebM, with no HLS and no downloaded
 * file. So, as the language spec does, the episode's answer is widened in the
 * browser: a DOWNLOADED server whose file is the clip's own loopback address,
 * with or without a sprite; or a stream whose lowest quality is the clip cut
 * into HLS (fMP4, VP9: this Chromium plays no H.264), served here, where each
 * segment request is counted as the engine would receive it through the
 * loopback. The server's half (the sheet made from a real file, never served
 * for another) is tests/anime-sprites-db.spec.ts.
 */
test.use({
	viewport: { width: 1280, height: 800 },
	userAgent: devices['Desktop Chrome'].userAgent,
	hasTouch: false,
	isMobile: false,
	deviceScaleFactor: 1,
	serviceWorkers: 'block'
});

const CLIP = 'tests/fixtures/video/clip.webm';
const SPRITE = '/__preview/sprite.jpg';

type Quality = {
	label: string;
	height: number | null;
	kind: 'hls' | 'file';
	src: string;
	audio: unknown[];
	subtitles: unknown[];
	sprite?: unknown;
};
type Answer = { servers: { n: number; name: string; qualities: Quality[] }[] };

/** Widens the episode's answer: [change] gets the real one and returns what the player sees. */
async function widen(page: Page, change: (a: Answer) => Answer) {
	await page.route('**/api/anime/episode/*/videos**', async (route: Route) => {
		const res = await route.fetch();
		const real = (await res.json()) as Answer;
		await route.fulfill({ response: res, json: change(real) });
	});
}

/** The real clip's own address: server 2's, through the app's loopback. */
const clipSrc = (a: Answer) => a.servers.find((s) => s.n === 2)!.qualities[0];

async function openEpisode(page: Page) {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: 'A Letter from Hollin' })
		.locator('.entry-btn')
		.click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await page.waitForFunction(
		() => {
			const v = document.querySelector('.stage video') as HTMLVideoElement | null;
			return !!v && Number.isFinite(v.duration) && v.duration > 0;
		},
		undefined,
		{ timeout: 20_000 }
	);
	// The clip is 8 s and its end plays the next episode: held still.
	await page.evaluate(() => (document.querySelector('.stage video') as HTMLVideoElement).pause());
}

/** The bar's visible line, and a point at [f] of it. */
async function lineAt(page: Page, f: number) {
	const box = await page.locator('.scrubrow .track').evaluate((el) => {
		const r = el.getBoundingClientRect();
		return { x: r.left + el.clientLeft, y: r.top + r.height / 2, width: el.clientWidth };
	});
	return { x: box.x + box.width * f, y: box.y };
}

/**
 * The episode's length is stored, as it is once it has been watched: the
 * player's first report carries it. A player whose hls.js is still loading
 * has no picture to say how long the file is, so only a stored length gives
 * its bar a time to hover.
 */
async function knownLength(page: Page) {
	const told = page.waitForRequest(
		(r) =>
			r.method() === 'POST' &&
			r.url().endsWith('/api/reading') &&
			((r.postDataJSON() as { length?: number }).length ?? 0) > 0,
		{ timeout: 20_000 }
	);
	await openEpisode(page);
	await page.evaluate(() => (document.querySelector('.stage video') as HTMLVideoElement).play());
	await told;
}

/**
 * hls.js's chunk, held until [release]: the first, uncached `import('hls.js')`
 * of a fresh page. Its name is a hash, so it is known by its body.
 * Routing turns the browser's cache off, so a page loaded after this asks
 * for the chunk again.
 */
async function holdHls(page: Page) {
	let release!: () => void;
	const released = new Promise<void>((ok) => (release = ok));
	let asked!: () => void;
	const requested = new Promise<void>((ok) => (asked = ok));
	await page.route('**/_app/immutable/chunks/*.js', async (route) => {
		const res = await route.fetch();
		const body = await res.text();
		if (body.includes('hlsManifestParsed')) {
			asked();
			await released;
		}
		await route.fulfill({ response: res, body }).catch(() => undefined);
	});
	return { requested, release };
}

/** The episode opened on a fresh page, its player still waiting on hls.js's chunk. */
async function openCold(page: Page, held: { requested: Promise<void> }) {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: 'A Letter from Hollin' })
		.locator('.entry-btn')
		.click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await held.requested;
	await expect(page.locator('.scrubrow .track')).toBeVisible();
}

/** The picture has its file: hls.js's chunk came, and the player's own import with it. */
async function pictureLoaded(page: Page) {
	await page.waitForFunction(
		() => {
			const v = document.querySelector('.stage video') as HTMLVideoElement | null;
			return !!v && Number.isFinite(v.duration) && v.duration > 0;
		},
		undefined,
		{ timeout: 20_000 }
	);
}

async function hover(page: Page, f: number) {
	await page.mouse.move(120, 120);
	await page.mouse.move(640, 300 + Math.random() * 10);
	const at = await lineAt(page, f);
	await page.mouse.move(at.x, at.y, { steps: 3 });
}

test('a downloaded episode shows its sprite’s tile for the time under the pointer', async ({
	page
}) => {
	test.setTimeout(90_000);
	// Four tiles, one every 2 s of the 8 s clip, each its own colour.
	const colours = ['#d02040', '#20b040', '#2040d0', '#d0b020'];
	const sheet = await sharp({
		create: { width: 1600, height: 90, channels: 3, background: '#000' }
	})
		.composite(
			await Promise.all(
				colours.map(async (c, i) => ({
					input: await sharp({
						create: { width: 160, height: 90, channels: 3, background: c }
					})
						.png()
						.toBuffer(),
					left: i * 160,
					top: 0
				}))
			)
		)
		.jpeg()
		.toBuffer();
	let sheetAsks = 0;
	await page.route(`**${SPRITE}`, (route) => {
		sheetAsks++;
		return route.fulfill({ body: sheet, contentType: 'image/jpeg' });
	});
	await widen(page, (a) => ({
		...a,
		servers: [
			{
				n: 0,
				name: 'DOWNLOADED',
				qualities: [
					{
						...clipSrc(a),
						label: 'Downloaded',
						kind: 'file',
						sprite: { src: SPRITE, everyS: 2, w: 160, h: 90, cols: 10, count: 4 }
					}
				]
			}
		]
	}));
	await openEpisode(page);
	const tip = page.locator('.scrubrow .track .tip');
	const frame = tip.locator('.frame');

	await hover(page, 0.5);
	await expect(frame).toBeVisible();
	await expect(frame).toHaveCSS('width', '160px');
	await expect(frame).toHaveCSS('background-image', new RegExp(SPRITE.replace(/[.]/g, '\\.')));
	// 4 s of 8: the frame nearest 4 s is the third tile.
	await expect(frame).toHaveCSS('background-position', '-320px 0px');
	await expect(tip.locator('.at')).toHaveText('0:04');
	await hover(page, 0.24);
	await expect(frame).toHaveCSS('background-position', '-160px 0px');
	await hover(page, 0.99);
	await expect(frame).toHaveCSS('background-position', '-480px 0px');
	// At the end of the bar the frame stays inside the track, not past it.
	const track = (await page.locator('.scrubrow .track').boundingBox())!;
	const box = (await tip.boundingBox())!;
	expect(box.x + box.width).toBeLessThanOrEqual(track.x + track.width + 1);
	expect(sheetAsks).toBeGreaterThan(0);

	// The pointer leaves: the tip goes.
	await page.mouse.move(640, 300);
	await expect(tip).toHaveCount(0);
});

test('a downloaded episode with no sprite yet shows the time alone', async ({ page }) => {
	test.setTimeout(90_000);
	await widen(page, (a) => ({
		...a,
		servers: [
			{
				n: 0,
				name: 'DOWNLOADED',
				qualities: [{ ...clipSrc(a), label: 'Downloaded', kind: 'file', sprite: null }]
			}
		]
	}));
	await openEpisode(page);
	const before = await page.evaluate(() => document.querySelectorAll('video').length);
	await hover(page, 0.5);
	const tip = page.locator('.scrubrow .track .tip');
	await expect(tip).toHaveText('0:04');
	await page.waitForTimeout(600);
	await expect(tip.locator('.frame')).toHaveCount(0);
	// And no second picture was started for it.
	expect(await page.evaluate(() => document.querySelectorAll('video').length)).toBe(before);
});

test.describe('a stream', () => {
	let hlsDir = '';
	test.afterAll(() => rmSync(hlsDir, { recursive: true, force: true }));
	test.beforeAll(() => {
		hlsDir = mkdtempSync(join(tmpdir(), 'tsundoku-preview-hls-'));
		execFileSync('ffmpeg', [
			'-loglevel',
			'error',
			'-y',
			'-i',
			CLIP,
			'-an',
			// The clip has one key frame; a segment starts on one, so every 2 s.
			'-c:v',
			'libvpx-vp9',
			'-g',
			'24',
			'-keyint_min',
			'24',
			'-deadline',
			'realtime',
			'-cpu-used',
			'8',
			'-f',
			'hls',
			'-hls_segment_type',
			'fmp4',
			'-hls_time',
			'2',
			'-hls_list_size',
			'0',
			'-hls_playlist_type',
			'vod',
			'-hls_fmp4_init_filename',
			'init.mp4',
			'-hls_segment_filename',
			join(hlsDir, 'seg%d.m4s'),
			join(hlsDir, 'low.m3u8')
		]);
	});

	/**
	 * Serves the cut HLS as the engine's loopback would, counting each segment
	 * asked for; [delayMs] holds every segment back, as a slow engine does.
	 */
	async function serveHls(
		page: Page,
		segments: string[],
		delayMs = 0,
		manifest: { delayMs: number; servedAt?: number } = { delayMs: 0 }
	) {
		await page.route('**/__preview/hls/**', async (route) => {
			const name = new URL(route.request().url()).pathname.split('/').pop()!;
			if (!readdirSync(hlsDir).includes(name)) return route.fulfill({ status: 404 });
			if (name.endsWith('.m4s')) {
				segments.push(name);
				if (delayMs) await new Promise((ok) => setTimeout(ok, delayMs));
			}
			if (name.endsWith('.m3u8') && manifest.delayMs) {
				await new Promise((ok) => setTimeout(ok, manifest.delayMs));
				manifest.servedAt = Date.now();
			}
			return route
				.fulfill({
					body: readFileSync(join(hlsDir, name)),
					contentType: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'
				})
				.catch(() => undefined); // hls.js stopped the load meanwhile
		});
	}

	/** The picture plays the 720p file; the preview reads the 360p HLS. */
	async function lowHls(page: Page) {
		await widen(page, (a) => ({
			...a,
			servers: [
				{
					n: 2,
					name: 'Kwik',
					qualities: [
						{ ...clipSrc(a), label: '720p', height: 720 },
						{
							...clipSrc(a),
							label: '360p',
							height: 360,
							kind: 'hls',
							src: '/__preview/hls/low.m3u8',
							subtitles: []
						}
					]
				}
			]
		}));
	}

	test('on a slow source, the last stop’s frame never sits over another time, and a stop soon after an earlier one still gets its own', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		// Each segment 800 ms late: a stop still waiting when the next begins,
		// and both answered inside a stop's second.
		await serveHls(page, segments, 800);
		await lowHls(page);
		await openEpisode(page);
		const frame = page.locator('.scrubrow .track .tip .frame');
		const at = page.locator('.scrubrow .track .tip .at');

		await hover(page, 2.5 / 8);
		await expect(frame).toBeVisible({ timeout: 5000 });
		await expect(at).toHaveText('0:02');
		// Along the bar to 5.5 s: the 2.5 s frame goes at once, before the next
		// one can be here (the debounce and 800 ms), and the time shows alone.
		let p = await lineAt(page, 5.5 / 8);
		await page.mouse.move(p.x, p.y);
		await expect(at).toHaveText('0:05');
		await expect(frame).toHaveCount(0, { timeout: 400 });
		// Then 5.5 s's own.
		await expect(frame).toBeVisible({ timeout: 5000 });

		// Two stops 300 ms apart, the first still waiting on its segment when the
		// second begins: the second still gets its frame. The first's give-up
		// (its second running out) used to stop the second's segment loading.
		p = await lineAt(page, 0.8 / 8);
		await page.mouse.move(p.x, p.y);
		await page.waitForTimeout(300);
		p = await lineAt(page, 6.5 / 8);
		await page.mouse.move(p.x, p.y);
		await expect(at).toHaveText('0:06');
		await expect(frame).toBeVisible({ timeout: 5000 });
	});

	test('shows a frame of its lowest quality, one segment a stop, nothing off the bar', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		await serveHls(page, segments);
		await lowHls(page);
		await openEpisode(page);
		// Played, paused, the controls shown and the pointer elsewhere: nothing.
		await page.waitForTimeout(1500);
		expect(segments).toEqual([]);

		// One stop at 2.5 s (the segment from 2 s): one segment, and its frame.
		await hover(page, 2.5 / 8);
		const frame = page.locator('.scrubrow .track .tip .frame');
		await expect(frame).toBeVisible({ timeout: 5000 });
		await expect(frame).toHaveCSS('background-image', /^url\("data:image\/jpeg/);
		expect(segments).toEqual(['seg1.m4s']);

		// Another stop at 4.5 s: one more.
		await hover(page, 4.5 / 8);
		await expect.poll(() => segments.length).toBe(2);
		await page.waitForTimeout(800);
		expect(segments).toEqual(['seg1.m4s', 'seg2.m4s']);

		// Off the bar: the frame goes, and nothing more is fetched.
		await page.mouse.move(640, 300);
		await expect(page.locator('.scrubrow .track .tip')).toHaveCount(0);
		await page.waitForTimeout(2000);
		expect(segments).toEqual(['seg1.m4s', 'seg2.m4s']);
	});

	test('a manifest later than the stop’s second, the pointer gone before it came: no segment after the leave, and the next hover still previews', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		// The playlist answers 2.5 s after it is asked: past the stop's second
		// (PREVIEW_TIMEOUT_MS) and past the leave below.
		const manifest: { delayMs: number; servedAt?: number } = { delayMs: 2500 };
		await serveHls(page, segments, 0, manifest);
		await lowHls(page);
		await openEpisode(page);
		const tip = page.locator('.scrubrow .track .tip');

		await hover(page, 2.5 / 8);
		await expect(tip.locator('.at')).toHaveText('0:02');
		// The stop asks for the playlist (after the debounce), then the pointer
		// leaves while it is still on its way.
		await page.waitForTimeout(600);
		await page.mouse.move(640, 300);
		await expect(tip).toHaveCount(0);
		await expect.poll(() => manifest.servedAt, { timeout: 10_000 }).toBeDefined();
		// The playlist is in; give hls.js every chance to start a load nothing stops.
		await page.waitForTimeout(2500);
		expect(segments).toEqual([]);

		// Past the first tick: the playlist is parsed now, so the next hover
		// fetches its one segment and shows its frame.
		await hover(page, 4.5 / 8);
		const frame = tip.locator('.frame');
		await expect(frame).toBeVisible({ timeout: 5000 });
		expect(segments).toEqual(['seg2.m4s']);
		await page.mouse.move(640, 300);
		await expect(tip).toHaveCount(0);
		await page.waitForTimeout(1500);
		expect(segments).toEqual(['seg2.m4s']);
	});

	test('a manifest later than the stop’s second, the pointer still on the bar: the stop gives up and fetches nothing, and the next stop has its frame', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		const manifest: { delayMs: number; servedAt?: number } = { delayMs: 2000 };
		await serveHls(page, segments, 0, manifest);
		await lowHls(page);
		await openEpisode(page);
		const tip = page.locator('.scrubrow .track .tip');

		await hover(page, 2.5 / 8);
		await expect.poll(() => manifest.servedAt, { timeout: 10_000 }).toBeDefined();
		await page.waitForTimeout(2000);
		// The stop gave up at its second: the time alone, and no load started
		// when the playlist came.
		await expect(tip.locator('.at')).toHaveText('0:02');
		await expect(tip.locator('.frame')).toHaveCount(0);
		expect(segments).toEqual([]);

		const p = await lineAt(page, 6.5 / 8);
		await page.mouse.move(p.x, p.y);
		await expect(tip.locator('.frame')).toBeVisible({ timeout: 5000 });
		expect(segments).toEqual(['seg3.m4s']);
	});

	test('a playlist that fails past hls.js’s own retry: that stop shows the time alone, and the next asks again and has its frame', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		let playlists = 0;
		let healthy = false;
		// The playlist's failure comes after the stop's second has given up
		// (hls.js retries once, a second later): nothing may be left to throw it
		// at the page as an unhandled rejection.
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await serveHls(page, segments);
		// A hoster's 503 on every playlist until the test says otherwise, so
		// hls.js's own retry fails too and the error is fatal. (Routed after
		// serveHls: the last route added is asked first.)
		await page.route('**/__preview/hls/low.m3u8', async (route) => {
			playlists++;
			if (!healthy) return route.fulfill({ status: 503, body: 'busy' });
			return route.fallback();
		});
		await lowHls(page);
		await openEpisode(page);
		const tip = page.locator('.scrubrow .track .tip');

		await hover(page, 2.5 / 8);
		// The first ask and hls.js's one retry, both refused.
		await expect.poll(() => playlists, { timeout: 10_000 }).toBeGreaterThan(1);
		await page.waitForTimeout(1500);
		await expect(tip.locator('.at')).toHaveText('0:02');
		await expect(tip.locator('.frame')).toHaveCount(0);
		expect(segments).toEqual([]);
		expect(errors).toEqual([]);
		const refused = playlists;

		healthy = true;
		const p = await lineAt(page, 4.5 / 8);
		await page.mouse.move(p.x, p.y);
		await expect(tip.locator('.frame')).toBeVisible({ timeout: 5000 });
		expect(playlists).toBeGreaterThan(refused);
		expect(segments).toEqual(['seg2.m4s']);
		expect(errors).toEqual([]);
	});

	/** Counts every ask for the preview's playlist (routed after serveHls, so asked first). */
	async function countPlaylists(page: Page) {
		const asked = { n: 0 };
		await page.route('**/__preview/hls/low.m3u8', async (route) => {
			asked.n++;
			return route.fallback();
		});
		return asked;
	}

	test('a leave while the first stop waits on hls.js’s chunk: nothing is fetched when it comes, and the next hover previews', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		await serveHls(page, segments);
		const playlists = await countPlaylists(page);
		await lowHls(page);
		await knownLength(page);
		const held = await holdHls(page);
		await openCold(page, held);
		const tip = page.locator('.scrubrow .track .tip');

		await hover(page, 2.5 / 8);
		await expect(tip.locator('.at')).toHaveText('0:02');
		// Past the debounce: the stop is waiting on the chunk. Then the pointer leaves.
		await page.waitForTimeout(600);
		await page.mouse.move(640, 300);
		await expect(tip).toHaveCount(0);
		held.release();
		await pictureLoaded(page);
		await page.waitForTimeout(2500);
		expect(playlists.n).toBe(0);
		expect(segments).toEqual([]);

		// Past the first tick: the next hover opens the preview and has its frame.
		await hover(page, 4.5 / 8);
		await expect(tip.locator('.frame')).toBeVisible({ timeout: 5000 });
		expect(playlists.n).toBe(1);
		expect(segments).toEqual(['seg2.m4s']);
	});

	test('a later stop while the first waits on hls.js’s chunk: one preview opens, for the later stop alone', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		await serveHls(page, segments);
		const playlists = await countPlaylists(page);
		await lowHls(page);
		await knownLength(page);
		const held = await holdHls(page);
		await openCold(page, held);
		const tip = page.locator('.scrubrow .track .tip');

		await hover(page, 2.5 / 8);
		await page.waitForTimeout(600);
		const p = await lineAt(page, 4.5 / 8);
		await page.mouse.move(p.x, p.y);
		await expect(tip.locator('.at')).toHaveText('0:04');
		await page.waitForTimeout(600);
		held.release();
		await expect(tip.locator('.frame')).toBeVisible({ timeout: 10_000 });
		await page.waitForTimeout(1500);
		// Two players would each ask for the playlist, and the earlier stop for its segment.
		expect(playlists.n).toBe(1);
		expect(segments).toEqual(['seg2.m4s']);
	});

	test('a stop made after the page began leaving is cancelled by the player’s own teardown, not only by beforeNavigate', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		await serveHls(page, segments);
		const playlists = await countPlaylists(page);
		await lowHls(page);
		await knownLength(page);
		const held = await holdHls(page);
		await openCold(page, held);
		const tip = page.locator('.scrubrow .track .tip');

		// The series page's data held: the way back has begun and not landed,
		// so the player is still mounted while it waits.
		let landed!: () => void;
		const land = new Promise<void>((ok) => (landed = ok));
		let left!: () => void;
		const leaving = new Promise<void>((ok) => (left = ok));
		await page.route('**/series/*/__data.json**', async (route) => {
			left();
			await land;
			await route.fallback();
		});

		// Leave first, then find the bar again while the load is held: the stop
		// is scheduled *after* `beforeNavigate`'s leave, so that bump cannot
		// cancel it. Only the player's teardown stands between it and a
		// preview fetched for a page nobody is on.
		await page.evaluate(() => history.back());
		await leaving;
		await hover(page, 2.5 / 8);
		await expect(tip.locator('.at')).toHaveText('0:02');
		// Past the debounce: the stop is waiting on hls.js's chunk.
		await page.waitForTimeout(600);
		// The player goes first, with the chunk still held; then the chunk comes.
		landed();
		await expect(page.locator('.stage video')).toHaveCount(0);
		held.release();
		await page.waitForTimeout(2500);
		expect(playlists.n).toBe(0);
		expect(segments).toEqual([]);
	});

	test('the page left while the first stop waits on hls.js’s chunk: no preview opens behind it', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		await serveHls(page, segments);
		const playlists = await countPlaylists(page);
		await lowHls(page);
		await knownLength(page);
		const held = await holdHls(page);
		await openCold(page, held);

		// The series page's data held: the way back has begun and not landed,
		// so the player is still mounted when hls.js's chunk comes.
		let landed!: () => void;
		const land = new Promise<void>((ok) => (landed = ok));
		let left!: () => void;
		const leaving = new Promise<void>((ok) => (left = ok));
		await page.route('**/series/*/__data.json**', async (route) => {
			left();
			await land;
			await route.fallback();
		});

		await hover(page, 2.5 / 8);
		await expect(page.locator('.scrubrow .track .tip .at')).toHaveText('0:02');
		await page.waitForTimeout(600);
		// Away by the browser's back, the pointer still where the bar was.
		await page.evaluate(() => history.back());
		await leaving;
		held.release();
		// The picture's own import of the same chunk has resolved, so has the
		// stop's, and the player is still on the page (a popstate has already
		// changed the address, so the address can't say so).
		await pictureLoaded(page);
		landed();
		await expect(page.locator('.stage video')).toHaveCount(0);
		await page.waitForTimeout(2500);
		expect(playlists.n).toBe(0);
		expect(segments).toEqual([]);
	});
});

test.describe('a stream whose lowest quality is a plain file', () => {
	let dir = '';
	let file: Buffer;
	test.afterAll(() => rmSync(dir, { recursive: true, force: true }));
	test.beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), 'tsundoku-preview-file-'));
		// A hoster's file is megabytes, not the fixture's 108 KB that one answer
		// would carry whole: the clip re-cut at a high rate, a key frame a second.
		execFileSync('ffmpeg', [
			'-loglevel',
			'error',
			'-y',
			'-i',
			CLIP,
			'-an',
			'-c:v',
			'libvpx-vp9',
			'-b:v',
			'4M',
			'-minrate',
			'4M',
			'-maxrate',
			'4M',
			'-g',
			'12',
			'-deadline',
			'realtime',
			'-cpu-used',
			'8',
			join(dir, 'low.webm')
		]);
		file = readFileSync(join(dir, 'low.webm'));
	});

	/**
	 * A hoster's plain file: it answers a Range with 206 and at most [chunk]
	 * bytes, as many hosters cap an open-ended range, so the browser asks again
	 * as it reads further. Each Range asked is counted.
	 */
	async function serveFile(page: Page, ranges: string[], delayMs = 0, chunk = 256 * 1024) {
		await page.route('**/__preview/file/low.webm', async (route) => {
			const range = route.request().headers()['range'];
			if (!range) {
				return route
					.fulfill({
						status: 200,
						body: file,
						contentType: 'video/webm',
						headers: { 'accept-ranges': 'bytes' }
					})
					.catch(() => undefined);
			}
			ranges.push(range);
			if (delayMs) await new Promise((ok) => setTimeout(ok, delayMs));
			const m = /bytes=(\d+)-(\d*)/.exec(range)!;
			const start = Number(m[1]);
			const end = Math.min(
				m[2] ? Number(m[2]) : file.length - 1,
				start + chunk - 1,
				file.length - 1
			);
			return route
				.fulfill({
					status: 206,
					body: file.subarray(start, end + 1),
					contentType: 'video/webm',
					headers: {
						'accept-ranges': 'bytes',
						'content-range': `bytes ${start}-${end}/${file.length}`
					}
				})
				.catch(() => undefined); // the picture let go of the request meanwhile
		});
	}

	/** The picture plays the 720p file; the preview reads the hoster's 360p file. */
	async function lowFile(page: Page) {
		await widen(page, (a) => ({
			...a,
			servers: [
				{
					n: 2,
					name: 'Hoster',
					qualities: [
						{ ...clipSrc(a), label: '720p', height: 720 },
						{
							...clipSrc(a),
							label: '360p',
							height: 360,
							kind: 'file',
							src: '/__preview/file/low.webm',
							subtitles: []
						}
					]
				}
			]
		}));
	}

	test('reads a few Ranges a stop, near the time asked, and none off the bar', async ({ page }) => {
		test.setTimeout(90_000);
		const ranges: string[] = [];
		await serveFile(page, ranges);
		await lowFile(page);
		await openEpisode(page);
		await page.waitForTimeout(1500);
		expect(ranges).toEqual([]);
		expect(file.length).toBeGreaterThan(2 * 256 * 1024);

		const frame = page.locator('.scrubrow .track .tip .frame');
		await hover(page, 6.5 / 8);
		await expect(frame).toBeVisible({ timeout: 5000 });
		const first = ranges.length;
		expect(first).toBeGreaterThan(0);
		// A stop near the end reads where that time is, not the file from the top.
		const starts = ranges.map((r) => Number(/bytes=(\d+)/.exec(r)![1]));
		expect(Math.max(...starts)).toBeGreaterThan(file.length / 2);
		// Resting on the bar, the browser may read on past the frame; then it is still.
		await page.waitForTimeout(1500);
		const stopRanges = ranges.length;

		await page.mouse.move(640, 300);
		await expect(page.locator('.scrubrow .track .tip')).toHaveCount(0);
		await page.waitForTimeout(2500);
		// Off the bar: no Range asked after the leave.
		expect(ranges.length).toBe(stopRanges);

		// Past the first tick: the file was let go at the leave, so the next
		// stop opens it again from its header and has its own frame.
		await hover(page, 1.5 / 8);
		await expect(frame).toBeVisible({ timeout: 5000 });
		expect(ranges.length).toBeGreaterThan(stopRanges);
		expect(ranges[stopRanges]).toBe('bytes=0-');
		await page.mouse.move(640, 300);
		await expect(page.locator('.scrubrow .track .tip')).toHaveCount(0);
		// And the whole file was never read for one stop.
		const total = ranges.slice(0, stopRanges).reduce((n, r) => {
			const m = /bytes=(\d+)-(\d*)/.exec(r)!;
			const s0 = Number(m[1]);
			const e = Math.min(
				m[2] ? Number(m[2]) : file.length - 1,
				s0 + 256 * 1024 - 1,
				file.length - 1
			);
			return n + (e - s0 + 1);
		}, 0);
		test.info().annotations.push({
			type: 'ranges',
			description: `${ranges.length} Range(s), ${total} of ${file.length} bytes: ${ranges.join(', ')}`
		});
		expect(total).toBeLessThan(file.length);
	});

	test('on a slow hoster, the pointer leaving mid-read stops the reading: no Range after the leave', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const ranges: string[] = [];
		// Each Range answered 600 ms late: the stop's header, index and frame
		// are three answers in a row, so the leave lands between them.
		await serveFile(page, ranges, 600);
		await lowFile(page);
		await openEpisode(page);
		await hover(page, 6.5 / 8);
		await expect.poll(() => ranges.length, { timeout: 5000 }).toBeGreaterThan(0);
		await page.mouse.move(640, 300);
		const atLeave = ranges.length;
		await expect(page.locator('.scrubrow .track .tip')).toHaveCount(0);
		await page.waitForTimeout(3000);
		expect(ranges.length).toBe(atLeave);
	});

	test('a leave while hls.js’s chunk is still loading: no Range after it, and a plain file previews without hls.js at all', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const ranges: string[] = [];
		await serveFile(page, ranges);
		await lowFile(page);
		await knownLength(page);
		const held = await holdHls(page);
		await openCold(page, held);
		const tip = page.locator('.scrubrow .track .tip');

		await hover(page, 2.5 / 8);
		await page.waitForTimeout(600);
		await page.mouse.move(640, 300);
		await expect(tip).toHaveCount(0);
		const atLeave = ranges.length;
		await page.waitForTimeout(2000);
		expect(ranges.length).toBe(atLeave);

		// The chunk still held: a plain file's stop needs none of it, reads its
		// header and has its frame.
		await hover(page, 6.5 / 8);
		await expect(tip.locator('.frame')).toBeVisible({ timeout: 5000 });
		expect(ranges[atLeave]).toBe('bytes=0-');
		await page.mouse.move(640, 300);
		await expect(tip).toHaveCount(0);
		await page.waitForTimeout(1000);
		const atSecondLeave = ranges.length;

		// The chunk comes (the picture's own player): still nothing off the bar.
		held.release();
		await pictureLoaded(page);
		await page.waitForTimeout(2500);
		expect(ranges.length).toBe(atSecondLeave);
	});
});

/**
 * c655's record half: the end page's library row for a browsing
 * record, in the paged reader. The shared seed has no record (fixtures make
 * none), so this needs the browse world; the reader slot owns no other file
 * that runs in that project — its flow files run in tablet-portrait against
 * the shared seed — so the case lives here, beside the player's.
 *
 * The bug it pins: ImageReader draws EndPage twice, and only the strip's
 * instance passed `inLibrary`/`addHref`. The paged one kept EndPage's default
 * `inLibrary = true`, so a record's end offered REMOVE for a series that was
 * not in the library, with no + ADD.
 */
test.describe('the reader end page for a browsing record', () => {
	test('a record in a paged read offers + ADD and no DELETE', async ({ page }) => {
		test.setTimeout(90_000);
		await page.goto(`/browse/${SOURCES.open.id}`);
		// A tile no other browse spec opens: browse-online adds 1-4 to the
		// library and reads 1-5, browse-flow reads 1-2, and an added series
		// would open its series screen instead of a preview on the next run.
		await page.locator('.grid .tile', { hasText: 'Open Source 1-7' }).click();
		await expect(page).toHaveURL(/\/downloads\/source\//);
		const preview = page.url();
		let failed: unknown;
		try {
			// Its last chapter, opened online from the preview: a record, not added.
			const list = page.getByRole('region', { name: /Chapters/ });
			await list.getByRole('button', { name: 'Read Chapter 3' }).click();
			await expect(page).toHaveURL(/\/read\/\d+/);
			await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
				timeout: 20_000
			});
			// Esc shows the controls: the meta line is what says it is a record.
			await page.keyboard.press('Escape');
			await expect(page.locator('header[aria-label="Reader"] .meta')).toContainText(
				'NOT IN LIBRARY'
			);
			const entry = page.url().match(/\/read\/(\d+)/)![1];
			// Paged: `?p=last` plus one turn forward (left, this source reads R→L)
			// is the paged end page's door — the instance that was missing the props.
			await page.goto(`/read/${entry}?p=last`);
			await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
				timeout: 20_000
			});
			await page.keyboard.press('ArrowLeft');
			const end = page.locator('[data-end-page]');
			await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
			await expect(end.getByRole('button', { name: '+ ADD TO LIBRARY' })).toBeVisible();
			await expect(end.getByRole('button', { name: 'HIDE', exact: true })).toHaveCount(0);
			await expect(end.getByRole('button', { name: 'DELETE', exact: true })).toHaveCount(0);
			await expect(end.getByRole('button', { name: /REMOVE/ })).toHaveCount(0);
		} catch (e) {
			failed = e;
		}
		// Leave the world as it was: FORGET the record this case made, through
		// the preview's own action (the browse world is one database for the
		// whole project). It runs whether the body passed or not, and its own
		// failure — a refused answer or a throw — is soft so it cannot hide the
		// body's.
		try {
			const forgotten = await page.request.post(`${new URL(preview).pathname}?/forget`, {
				headers: { origin: new URL(preview).origin, 'x-sveltekit-action': 'true' },
				form: {}
			});
			expect.soft(forgotten.ok()).toBe(true);
		} catch (error) {
			// A timeout or a dead server is this cleanup's failure, not the body's.
			expect.soft(error).toBeUndefined();
		}
		if (failed) throw failed;
	});
});
