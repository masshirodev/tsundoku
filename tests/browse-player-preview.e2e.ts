import { test, expect } from './fixtures';
import { devices, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

/**
 * The seek preview over the scrubber (c385, doc/ANIME.md "The player"): a
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

async function hover(page: Page, f: number) {
	await page.mouse.move(120, 120);
	await page.mouse.move(640, 300 + Math.random() * 10);
	const at = await lineAt(page, f);
	await page.mouse.move(at.x, at.y, { steps: 3 });
}

test('a downloaded episode shows its sprite’s tile for the time under the pointer (c385)', async ({
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

test('a downloaded episode with no sprite yet shows the time alone (c385)', async ({ page }) => {
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

	test('shows a frame of its lowest quality, one segment a stop, nothing off the bar (c385)', async ({
		page
	}) => {
		test.setTimeout(90_000);
		const segments: string[] = [];
		await page.route('**/__preview/hls/**', (route) => {
			const name = new URL(route.request().url()).pathname.split('/').pop()!;
			if (!readdirSync(hlsDir).includes(name)) return route.fulfill({ status: 404 });
			if (name.endsWith('.m4s')) segments.push(name);
			return route.fulfill({
				body: readFileSync(join(hlsDir, name)),
				contentType: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'
			});
		});
		// The picture plays the 720p file; the preview reads the 360p HLS.
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
});
