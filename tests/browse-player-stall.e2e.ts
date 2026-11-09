import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * What counts as a stall (c867; doc/ANIME.md): a held ← or →, a double-tap run
 * and the scrubber are the reader moving, so the 15 s clock starts over with
 * each of them, and only a full 15 s after the last does the player give up on
 * the quality. Runs in `browse`, where the fixture's real 8 s clip is served,
 * and each case switches to the device it is about.
 *
 * The stream is made to buffer for real: the video's own requests are answered
 * only up to KEPT bytes and every range past that is left hanging, so the
 * element runs dry and a seek past the bytes never lands. The list of servers
 * is the app's own answer with the broken first server dropped and the clip
 * offered at 1080 and 720, so the step a stall ends in is the one the owner saw:
 * a quality down, and `1080P COULDN'T KEEP UP`.
 */

test.describe.configure({ timeout: 120_000 });

// A route still answering when a case ends would fail the case it no longer belongs to.
test.afterEach(({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }));

/** About a third of the clip's 108 KB: enough to start, not enough to finish. */
const KEPT = 36_000;
const STALL_MS = 15_000;
const DROPPED = "COULDN'T KEEP UP";
const BROWSE = `http://localhost:${process.env.PLAYWRIGHT_BROWSE_PORT ?? '4194'}`;

type Sample = { t: number; panel: string | null; dropped: boolean };
declare global {
	interface Window {
		__stall: { samples: Sample[]; seekings: number[]; waitings: number[] };
	}
}

async function bufferingStream(page: Page) {
	let clip: string | null = null;
	// Every 100 ms, what the screen shows, and each seek the element announced.
	await page.addInitScript((dropped) => {
		window.__stall = { samples: [], seekings: [], waitings: [] };
		document.addEventListener(
			'seeking',
			() => window.__stall.seekings.push(performance.now()),
			true
		);
		document.addEventListener(
			'waiting',
			() => window.__stall.waitings.push(performance.now()),
			true
		);
		setInterval(() => {
			window.__stall.samples.push({
				t: performance.now(),
				panel: document.querySelector('.panel.buffer')?.textContent ?? null,
				dropped: !!document.body?.textContent?.includes(dropped)
			});
		}, 100);
	}, DROPPED);
	await page.route(
		(u) => /\/api\/anime\/episode\/\d+\/videos/.test(u.pathname),
		async (route) => {
			const answer = await route.fetch();
			const list = await answer.json();
			const last = list.servers[list.servers.length - 1];
			const q = last.qualities[0];
			clip = new URL(q.src, page.url()).pathname;
			// A fragment: the same bytes from the server, a different address to the player.
			last.qualities = [
				{ ...q, label: '1080p', height: 1080, src: `${q.src}#1080` },
				{ ...q, label: '720p', height: 720, src: `${q.src}#720` },
				// A phone starts on 720 (startIndex): it needs somewhere lower to go.
				{ ...q, label: '480p', height: 480, src: `${q.src}#480` }
			];
			await route.fulfill({ response: answer, json: { ...list, servers: [last] } });
		}
	);
	await page.route(
		(u) => u.pathname === clip,
		async (route) => {
			const from = Number(/bytes=(\d+)-/.exec(route.request().headers().range ?? '')?.[1] ?? 0);
			// Left hanging, not refused: this is a server that stopped sending.
			if (from >= KEPT) return;
			const whole = await route.fetch({ headers: { range: '' } });
			const body = await whole.body();
			await route.fulfill({
				status: 206,
				headers: {
					'content-type': 'video/webm',
					'accept-ranges': 'bytes',
					'content-range': `bytes ${from}-${KEPT - 1}/${body.length}`
				},
				body: body.subarray(from, KEPT)
			});
		}
	);
}

async function openPlaying(page: Page) {
	// Incognito, as tests/tv-player.e2e.ts plays: nothing watched here is written
	// to a database the other browse specs read.
	await page.context().addCookies([{ name: 'tsundoku_incognito', value: '1', url: BROWSE }]);
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: 'The Ferry at Imre' })
		.locator('.entry-btn')
		.click();
	await expect(page.locator('.player')).toBeVisible();
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && !v.paused && v.currentTime > 0.3;
		},
		undefined,
		{ timeout: 30_000 }
	);
}

const timeline = (page: Page) => page.evaluate(() => window.__stall);

/** ← or → held down: a press and its auto-repeat, as a keyboard sends it. */
async function holdKey(page: Page, key: string, ms: number) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		await page.keyboard.down(key);
		await page.waitForTimeout(100);
	}
	await page.keyboard.up(key);
}

/** The step, and how long after [from] (page time) it came. */
async function stepAfter(page: Page, from: number) {
	await page.waitForFunction(() => window.__stall.samples.some((s) => s.dropped), undefined, {
		timeout: STALL_MS + 10_000
	});
	const { samples } = await timeline(page);
	return samples.find((s) => s.dropped)!.t - from;
}

async function holdLeavesFullClock(page: Page, ms: number) {
	await bufferingStream(page);
	await openPlaying(page);
	const before = await timeline(page);
	const started = before.samples[before.samples.length - 1].t;
	await holdKey(page, 'ArrowRight', ms);
	const held = await timeline(page);
	const seekings = held.seekings.filter((t) => t > started);
	// The key did what it says: the element was asked to seek all the way through.
	expect(seekings.length).toBeGreaterThan((ms / 1000) * 3);
	const last = seekings[seekings.length - 1];
	const during = held.samples.filter((s) => s.t > started && s.t <= last);
	expect(during.length).toBeGreaterThan(ms / 200);
	expect(during.filter((s) => s.panel !== null)).toEqual([]);
	expect(during.filter((s) => s.dropped)).toEqual([]);

	// The clock did run after the release: the panel counts from zero, and the
	// quality goes at a full 15 s from the last seek, not before.
	const after = await stepAfter(page, last);
	expect(after).toBeGreaterThanOrEqual(STALL_MS);
	expect(after).toBeLessThan(STALL_MS + 6_000);
	const { samples } = await timeline(page);
	const first = samples.find((s) => s.t > last && s.panel !== null)!;
	expect(first.panel).toMatch(/BUFFERING\s*[23] S/);
	expect(first.t - last).toBeGreaterThanOrEqual(1_900);
}

const DESKTOP = {
	viewport: { width: 1280, height: 800 },
	userAgent: devices['Desktop Chrome'].userAgent,
	hasTouch: false,
	isMobile: false,
	deviceScaleFactor: 1,
	serviceWorkers: 'block' as const
};

test.describe('on a desktop', () => {
	test.use(DESKTOP);

	test('a key held 12 s leaves the full 15 s after the release (c867)', async ({ page }) => {
		await holdLeavesFullClock(page, 12_000);
	});

	test('a key held 20 s leaves the full 15 s after the release (c867)', async ({ page }) => {
		await holdLeavesFullClock(page, 20_000);
	});

	test('a seek that lands with nothing to play starts the clock from the landing (c867)', async ({
		page
	}) => {
		await bufferingStream(page);
		await openPlaying(page);
		await holdKey(page, 'ArrowRight', 1_000);
		// The element's real `waiting` has been and gone: nothing is left to start
		// the clock but the landing asking the element what it has. A landing with
		// nothing to play can't be made from this file, so it is told to the player.
		await page.waitForFunction(() => window.__stall.waitings.length > 0);
		await expect
			.poll(async () => (await timeline(page)).samples.at(-1)!.panel, { timeout: 14_000 })
			.toMatch(/BUFFERING\s*[6-9] S/);
		const landing = await page.evaluate(() => {
			const v = document.querySelector('video')!;
			Object.defineProperty(v, 'readyState', { configurable: true, get: () => 1 });
			v.dispatchEvent(new Event('seeked'));
			return performance.now();
		});
		// From zero: the panel the old clock was counting goes, and the step waits.
		await expect
			.poll(async () => (await timeline(page)).samples.at(-1)!.panel, { timeout: 3_000 })
			.toBeNull();
		expect(await stepAfter(page, landing)).toBeGreaterThanOrEqual(STALL_MS);
	});

	test('the scrubber held and moved is a seek, not a stall (c867)', async ({ page }) => {
		await bufferingStream(page);
		await openPlaying(page);
		await page.mouse.move(640, 400);
		const track = page.locator('.track').first();
		const box = (await track.boundingBox())!;
		const y = box.y + box.height / 2;
		const before = await timeline(page);
		const started = before.samples[before.samples.length - 1].t;
		await page.mouse.move(box.x + box.width * 0.7, y);
		await page.mouse.down();
		const end = Date.now() + 6_000;
		let i = 0;
		while (Date.now() < end) {
			await page.mouse.move(box.x + box.width * (0.7 + 0.1 * Math.sin(i++)), y);
			await page.waitForTimeout(150);
		}
		await page.mouse.up();
		const held = await timeline(page);
		const seekings = held.seekings.filter((t) => t > started);
		expect(seekings.length).toBeGreaterThan(5);
		const last = seekings[seekings.length - 1];
		expect(held.samples.filter((s) => s.t > started && s.t <= last && s.panel !== null)).toEqual(
			[]
		);
		expect(await stepAfter(page, last)).toBeGreaterThanOrEqual(STALL_MS);
	});

	test('a paused player runs no clock, and PLAY starts it (c867)', async ({ page }) => {
		await bufferingStream(page);
		await openPlaying(page);
		await page.evaluate(() => document.querySelector('video')!.pause());
		await holdKey(page, 'ArrowRight', 2_000);
		// Long enough that a clock left running would have stepped.
		await page.waitForTimeout(STALL_MS + 1_000);
		const paused = await timeline(page);
		expect(paused.samples.filter((s) => s.panel !== null || s.dropped)).toEqual([]);
		// The second half: the same player, asked to play, does run the clock.
		const played = await page.evaluate(() => {
			void document.querySelector('video')!.play();
			return performance.now();
		});
		expect(await stepAfter(page, played)).toBeGreaterThanOrEqual(STALL_MS);
	});
});

/** A run of double-taps on the picture's right third. */
async function tapRun(page: Page, ms: number) {
	const box = (await page.locator('.tapzone').boundingBox())!;
	const x = box.x + box.width * 0.85;
	const y = box.y + box.height / 2;
	const before = await timeline(page);
	const started = before.samples[before.samples.length - 1].t;
	const end = Date.now() + ms;
	while (Date.now() < end) {
		await page.touchscreen.tap(x, y);
		await page.waitForTimeout(120);
	}
	const run = await timeline(page);
	const seekings = run.seekings.filter((t) => t > started);
	expect(seekings.length).toBeGreaterThan(2);
	const last = seekings[seekings.length - 1];
	// A tap can arrive late on a touch screen, so the rule itself: the panel is
	// only ever up 2 s or more after the last seek.
	for (const s of run.samples.filter((s) => s.t > started && s.t <= last && s.panel !== null)) {
		const before = seekings.filter((t) => t <= s.t);
		expect(s.t - before[before.length - 1]).toBeGreaterThanOrEqual(1_900);
	}
	expect(run.samples.filter((s) => s.t > started && s.t <= last && s.dropped)).toEqual([]);
	return last;
}

/** A device's preset, less the browser type a `describe` is not allowed to set. */
function touch(name: string) {
	const device: Partial<(typeof devices)[string]> = { ...devices[name] };
	delete device.defaultBrowserType;
	return device;
}

test.describe('on a touch tablet', () => {
	test.use({ ...touch('Galaxy Tab S4 landscape'), serviceWorkers: 'block' });

	test('a double-tap run leaves the full 15 s after its last tap (c867)', async ({ page }) => {
		await bufferingStream(page);
		await openPlaying(page);
		const last = await tapRun(page, 6_000);
		expect(await stepAfter(page, last)).toBeGreaterThanOrEqual(STALL_MS);
	});
});

test.describe('on a phone', () => {
	test.use({ ...touch('Pixel 5'), serviceWorkers: 'block' });

	test('a double-tap run leaves the full 15 s after its last tap (c867)', async ({ page }) => {
		await bufferingStream(page);
		await openPlaying(page);
		const last = await tapRun(page, 6_000);
		expect(await stepAfter(page, last)).toBeGreaterThanOrEqual(STALL_MS);
	});
});
