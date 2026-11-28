import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * What counts as a stall (doc/ANIME.md): a held ← or →, a double-tap run
 * and the scrubber are the reader moving, so the 15 s clock starts over with
 * each of them, and only a full 15 s after the last does the player give up on
 * the quality. Runs in `browse`, where the fixture's real 8 s clip is served,
 * and each case switches to the device it is about.
 *
 * The stream is made to buffer for real: the video's own requests are answered
 * only up to KEPT bytes and every range past that is left hanging, so the
 * element runs dry and a seek past the bytes never lands. The list of servers
 * is the app's own answer with the broken first server dropped and the clip
 * offered at 1080 and 720, so the step a stall ends in is the one seen in use:
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

async function bufferingStream(page: Page, withLower = false) {
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
			// A server that offers only the lower quality: with NEVER LOWER on it is
			// not an automatic move, and the panel's SERVER n NOW → is the way.
			// The pair is numbered from 1 so the panel's "SERVER n OF 2" reads right.
			const playing = { ...last, n: 1 };
			const lower = {
				...playing,
				n: 2,
				name: 'Lower',
				qualities: [{ ...q, label: '720p', height: 720, src: `${q.src}#lower` }]
			};
			await route.fulfill({
				response: answer,
				json: { ...list, servers: withLower ? [playing, lower] : [last] }
			});
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
	await openPlayer(page);
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && !v.paused && v.currentTime > 0.3;
		},
		undefined,
		{ timeout: 30_000 }
	);
}

/** The episode's player, opened but not yet playing: a broken first stream never is. */
async function openPlayer(page: Page) {
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
}

const timeline = (page: Page) => page.evaluate(() => window.__stall);

/** The player's settings sheet, opened from the bar's cell (its chrome first). */
async function openSheet(page: Page) {
	await page.mouse.move(640, 400);
	await page.mouse.move(700, 400);
	await page.locator('.cells .grow').click();
	const sheet = page.getByRole('dialog', { name: 'Playback settings' });
	await expect(sheet).toBeVisible();
	return sheet;
}

/** NEVER LOWER, pressed in the player's sheet as the owner would. */
async function neverLower(page: Page, on: boolean) {
	const sheet = await openSheet(page);
	const row = sheet.locator('.srow2', { hasText: 'NEVER LOWER' });
	await row.getByRole('button', { name: on ? 'ON' : 'OFF', exact: true }).click();
	await expect(row.getByRole('button', { name: on ? 'ON' : 'OFF', exact: true })).toHaveClass(/on/);
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(sheet).toHaveCount(0);
}

/** What the sheet says the setting is now: the value read back, after a reload too. */
async function neverLowerIs(page: Page, on: boolean) {
	const sheet = await openSheet(page);
	const row = sheet.locator('.srow2', { hasText: 'NEVER LOWER' });
	await expect(row.getByRole('button', { name: on ? 'ON' : 'OFF', exact: true })).toHaveClass(/on/);
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(sheet).toHaveCount(0);
}

/**
 * NEVER LOWER pressed in SETTINGS › 03 — WATCHING, before a player is opened:
 * the same device value, so a case about the player's first attach can have it
 * on. It also proves the SETTINGS row writes it, which the sheet reads.
 */
async function settingsNeverLower(page: Page, on: boolean) {
	await page.goto('/settings?section=watching');
	const row = page.locator('.row', {
		has: page.locator('.label', { hasText: /^NEVER LOWER$/ })
	});
	await row.getByRole('button', { name: on ? 'ON' : 'OFF', exact: true }).click();
	await expect(row.getByRole('button', { name: on ? 'ON' : 'OFF', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// Reloaded: the row comes back on, so the device value was really kept.
	await page.reload();
	await expect(row.getByRole('button', { name: on ? 'ON' : 'OFF', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
}

/** QUALITY pressed in SETTINGS › 03 — WATCHING: the device's cap, as `startIndex` reads it. */
async function settingsQuality(page: Page, label: string) {
	await page.goto('/settings?section=watching');
	const row = page.locator('.row', { has: page.locator('.label', { hasText: /^QUALITY$/ }) });
	await row.getByRole('button', { name: label, exact: true }).click();
	await expect(row.getByRole('button', { name: label, exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
}

/** Playing again: the interstitial gone, and the picture moving. */
async function playsAgain(page: Page) {
	await expect(page.locator('.inter')).toHaveCount(0, { timeout: 15_000 });
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && !v.paused && v.currentTime > 0.3 && v.readyState >= 3;
		},
		undefined,
		{ timeout: 30_000 }
	);
}

/**
 * NOTHING KEEPS THE QUALITY's CHOOSE, and a row of the sheet it opens pressed
 * where the eye sees it: the point under the row's middle must be the row
 * (the sheet on top of the panel, not under it), and the press goes to that
 * point, not to the element, so a panel painted over it would take it.
 */
async function chooseFromPanel(page: Page, row: string, press: 'mouse' | 'tap') {
	const panel = page.locator('.inter');
	await panel.getByRole('button', { name: 'CHOOSE' }).click();
	const sheet = page.getByRole('dialog', { name: 'Playback settings' });
	await expect(sheet).toBeVisible();
	const target = sheet.getByRole('button', { name: row, exact: true });
	await expect(target).toBeVisible();
	// The refusal left nothing current: no quality on, no server PLAYING, so
	// no lower one reads as the chosen one.
	await expect(sheet.locator('.seg button.on', { hasText: /^\d+P$/ })).toHaveCount(0);
	await expect(sheet.getByText(/● PLAYING/)).toHaveCount(0);
	// Measured where it lands, not mid-rise: the sheet slides in from the side.
	await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
	const box = (await target.boundingBox())!;
	const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
	const hit = await page.evaluate(
		([x, y]) => {
			const at = document.elementFromPoint(x, y);
			return { inSheet: !!at?.closest('.sheet'), text: at?.textContent?.trim() ?? '' };
		},
		[x, y]
	);
	expect(hit).toEqual({ inSheet: true, text: row });
	if (press === 'tap') await page.touchscreen.tap(x, y);
	else await page.mouse.click(x, y);
}

/**
 * The BUFFERING panel's words, every 100 ms, from the page's own clock: a hold
 * of two servers that took turns would show it as SERVER 1 again.
 */
async function samplePanels(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as { __panels: { t: number; panel: string | null }[] };
		w.__panels = [];
		setInterval(() => {
			w.__panels.push({
				t: performance.now(),
				panel: document.querySelector('.panel.buffer')?.textContent ?? null
			});
		}, 100);
	});
}

const panels = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { __panels: { t: number; panel: string | null }[] }).__panels
	);

type ServerSpec = { heights: number[]; stall?: boolean; broken?: boolean };

/**
 * The episode's list, made of the servers a case names: `heights` each, a
 * `stall` one answering only `KEPT` bytes and leaving the rest hanging, and a
 * `broken` one at an address that cannot answer. `fresh` is the same source's answer
 * to a `?fresh=1` ask, or a function of the ask's number (1 first), so a case
 * can bring a height back between two TRY AGAINs. A segment that stalls says so
 * in its own query, so a healthy server beside it is served whole.
 */
async function answerServers(
	page: Page,
	servers: ServerSpec[],
	fresh?: ServerSpec[] | ((ask: number) => ServerSpec[])
) {
	let freshAsks = 0;
	let clip: string | null = null;
	await page.route('**/api/anime/episode/*/videos*', async (route) => {
		const answer = await route.fetch();
		const list = await answer.json();
		const last = list.servers[list.servers.length - 1];
		const q = last.qualities[0];
		clip = new URL(q.src, page.url()).pathname;
		const asked = new URL(route.request().url()).searchParams.has('fresh');
		if (asked) freshAsks += 1;
		const freshList = typeof fresh === 'function' ? fresh(freshAsks) : fresh;
		const out = ((asked ? freshList : undefined) ?? servers).map((s, i) => ({
			n: i + 1,
			name: `Server ${i + 1}`,
			qualities: s.heights.map((h) => ({
				...q,
				label: `${h}p`,
				height: h,
				src: s.broken
					? 'http://127.0.0.1:1/lost.webm'
					: `${q.src}?s=${i + 1}&stall=${s.stall ? 1 : 0}#${h}`
			}))
		}));
		await route.fulfill({
			response: answer,
			json: { ...list, intro: null, ending: null, servers: out }
		});
	});
	await page.route(
		(u) => u.searchParams.get('stall') === '1',
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
	return { freshAsks: () => freshAsks, clip: () => clip };
}

/** Every `<video>` the page attached, and whether it was at a height: the silent drop would show here. */
async function attaches(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as { __srcs: string[] };
		w.__srcs = [];
		document.addEventListener(
			'loadstart',
			(e) => {
				const v = e.target;
				if (v instanceof HTMLVideoElement) w.__srcs.push(v.currentSrc);
			},
			true
		);
	});
	return () => page.evaluate(() => (window as unknown as { __srcs: string[] }).__srcs);
}

/** The server the BUFFERING panel names, or null when no panel is up. */
function panelServer(panel: string | null): number | null {
	const m = /SERVER (\d+) OF/.exec(panel ?? '');
	return m ? Number(m[1]) : null;
}

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

	test('NEVER LOWER: a stall waits at 1080 past 15 s and offers no drop', async ({ page }) => {
		// A second server, but only at 720: not an automatic move with the setting on.
		await bufferingStream(page, true);
		await openPlaying(page);
		// The device setting, pressed in the player's own sheet (not written into
		// storage behind the app's back), and read back after a reload.
		await neverLower(page, true);
		await page.reload();
		await page.waitForFunction(
			() => {
				const v = document.querySelector('video');
				return !!v && !v.paused && v.currentTime > 0.3;
			},
			undefined,
			{ timeout: 30_000 }
		);
		await neverLowerIs(page, true);
		const cell = page.locator('.cells .grow');
		await expect(cell).toContainText('1080P');
		// Past a full 15 s: the clock's own samples say so, and it is still 1080.
		await expect
			.poll(async () => (await timeline(page)).samples.at(-1)!.panel, {
				timeout: STALL_MS + 10_000
			})
			.toMatch(/BUFFERING\s*1[5-9] S/);
		const { samples } = await timeline(page);
		// The clock really ran: the panel's own seconds reached 15, not a step at 14.
		const seconds = samples.map((s) => Number(/BUFFERING\s*(\d+) S/.exec(s.panel ?? '')?.[1] ?? 0));
		expect(Math.max(...seconds)).toBeGreaterThanOrEqual(15);
		expect(samples.filter((s) => s.dropped)).toEqual([]);
		for (const s of samples) expect(s.panel ?? '').not.toMatch(/DROPS TO|COULDN'T KEEP UP/);
		await expect(cell).toContainText('1080P');
		// It says it waits, and the lower server is still a press away by hand.
		const panel = page.locator('.panel.buffer');
		await expect(panel).toContainText('WAITING ON THE SERVER');
		await expect(panel.getByRole('button')).toContainText('SERVER');
	});

	test('with NEVER LOWER on, a fatal error re-asks once and plays on at 1080', async ({ page }) => {
		test.setTimeout(120_000);
		// One server at 1080 whose address is gone: the source's fresh answer
		// (`?fresh=1`) has the same height at a working address.
		const server = await answerServers(
			page,
			[{ heights: [1080], broken: true }],
			[{ heights: [1080] }]
		);
		const srcs = await attaches(page);
		await settingsNeverLower(page, true);
		await openPlayer(page);
		// The broken address is fatal and the kept height is on the fresh list:
		// the player asks once and re-attaches there, instead of freezing.
		await page.waitForFunction(
			() => {
				const v = document.querySelector('video');
				return !!v && !v.paused && v.currentTime > 0.3;
			},
			undefined,
			{ timeout: 30_000 }
		);
		expect(server.freshAsks()).toBe(1);
		await expect(page.locator('.cells .grow')).toContainText('1080P');
		// It really was the dead address first, and never a lower quality.
		const attached = await srcs();
		expect(attached.some((s) => s.includes('lost.webm'))).toBe(true);
		expect(attached.filter((s) => /#720$/.test(s))).toEqual([]);
	});

	test('with nothing acceptable, it says so and still says so past 4 s', async ({ page }) => {
		test.setTimeout(120_000);
		// The fresh list has only 720, and NEVER LOWER keeps 1080: no lower
		// quality may be attached by itself, and the screen must say why for
		// longer than the old 4 s notice.
		const server = await answerServers(
			page,
			[{ heights: [1080], broken: true }],
			[{ heights: [720] }]
		);
		const srcs = await attaches(page);
		await settingsNeverLower(page, true);
		await openPlayer(page);
		const panel = page.locator('.inter');
		await expect(panel).toContainText('NOTHING KEEPS THE QUALITY', { timeout: 30_000 });
		await expect(panel).toContainText('NEVER LOWER');
		await expect(panel).toContainText('1080P');
		expect(server.freshAsks()).toBe(1);
		// Past the 4 s the server notice lived for.
		await page.waitForTimeout(5_000);
		await expect(panel).toContainText('NOTHING KEEPS THE QUALITY');
		await expect(panel).toContainText('NEVER LOWER');
		// A way to choose by hand, and the fresh ask is not repeated.
		await expect(panel.getByRole('button', { name: 'CHOOSE' })).toBeVisible();
		expect(server.freshAsks()).toBe(1);
		// No lower quality was attached behind the setting's back.
		const attached = await srcs();
		expect(attached.filter((s) => /#720$/.test(s))).toEqual([]);
	});

	test('two slow servers do not take turns: one move, then it stays and counts', async ({
		page
	}) => {
		test.setTimeout(120_000);
		// Two servers, both 1080, both running dry: without a record of what this
		// hold already left, they alternated for ever.
		await answerServers(page, [
			{ heights: [1080, 720, 480], stall: true },
			{ heights: [1080, 720, 480], stall: true }
		]);
		await samplePanels(page);
		await settingsNeverLower(page, true);
		await openPlaying(page);
		const last = async () => (await panels(page)).map((s) => panelServer(s.panel)).at(-1) ?? null;
		// The first outage moves to server 2 at its full 15 s.
		await expect.poll(last, { timeout: STALL_MS + 10_000 }).toBe(2);
		const after = (await panels(page)).length;
		// The second window runs its own full 15 s on server 2 and keeps counting
		// past it (a move at 15 would take the clock back to zero).
		await expect
			.poll(
				async () => {
					const seen = (await panels(page)).slice(after);
					return Math.max(
						0,
						...seen.map((s) => Number(/BUFFERING\s*(\d+) S/.exec(s.panel ?? '')?.[1] ?? 0))
					);
				},
				{ timeout: STALL_MS + 12_000 }
			)
			.toBeGreaterThanOrEqual(16);
		const names = (await panels(page)).map((s) => panelServer(s.panel));
		const moved = names.indexOf(2);
		expect(moved).toBeGreaterThan(-1);
		// At most one automatic move: nothing after it names server 1 again.
		expect(names.slice(moved).filter((n) => n === 1)).toEqual([]);
	});

	test('the move to a good 1080 server is taken', async ({ page }) => {
		test.setTimeout(120_000);
		// The second server keeps 1080 and answers: the stall must actually move
		// here, which the 720-only server of the wait case never does.
		await answerServers(page, [
			{ heights: [1080, 720, 480], stall: true },
			{ heights: [1080, 720, 480] }
		]);
		await samplePanels(page);
		await settingsNeverLower(page, true);
		await openPlaying(page);
		const at = () => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
		// The stall moved by itself, to the second server's own stream: the
		// panel resets on a move and may never paint there, so the element's
		// own address is the record.
		await expect
			.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentSrc), {
				timeout: STALL_MS + 10_000
			})
			.toContain('s=2');
		// It plays on from the same second at the same height: the picture moved
		// past where the first server ran dry (~2.7 s of this clip).
		await expect(page.locator('.cells .grow')).toContainText('1080P');
		await expect.poll(at).toBeGreaterThan(3);
	});

	test('TRY AGAIN waits at the height the panel names, and attaches the lower one never', async ({
		page
	}) => {
		test.setTimeout(150_000);
		// 1080 plays, then the stream dies: a fatal error mid-episode. The
		// source's fresh list has only 720 for the first two asks, and 1080 again
		// from the third.
		const server = await answerServers(page, [{ heights: [1080] }], (ask) =>
			ask >= 3 ? [{ heights: [1080] }] : [{ heights: [720] }]
		);
		const srcs = await attaches(page);
		await settingsNeverLower(page, true);
		await openPlaying(page);
		await expect(page.locator('.cells .grow')).toContainText('1080P');
		expect((await srcs()).at(-1)).toMatch(/s=1&.*#1080$/);
		// A plain file that dies says so by the element's own `error` (Chrome reads
		// a refused range as a stall, so a route cannot make it): told to the
		// player as the element tells it, with the picture stopped as a dead one is.
		await page.locator('video').evaluate((v: HTMLVideoElement) => {
			v.pause();
			v.dispatchEvent(new Event('error'));
		});

		const panel = page.locator('.inter');
		await expect(panel).toContainText('NOTHING KEEPS THE QUALITY', { timeout: 30_000 });
		await expect(panel).toContainText('waits at 1080P');
		expect(server.freshAsks()).toBe(1);
		const refused = (await srcs()).length;

		// TRY AGAIN with the list still at 720: it asks, and stays.
		const asked = page.waitForResponse(
			(r) => /\/videos/.test(r.url()) && new URL(r.url()).searchParams.has('fresh')
		);
		await panel.getByRole('button', { name: 'TRY AGAIN' }).click();
		await asked;
		expect(server.freshAsks()).toBe(2);
		// The answer is in; an attach would follow it within a tick and a dynamic
		// import, so a second is room enough for one to show.
		await page.waitForTimeout(1_500);
		await expect(panel).toContainText('NOTHING KEEPS THE QUALITY');
		await expect(panel).toContainText('waits at 1080P');
		expect((await srcs()).slice(refused)).toEqual([]);

		// 1080 back on the list: TRY AGAIN plays it.
		await panel.getByRole('button', { name: 'TRY AGAIN' }).click();
		await playsAgain(page);
		expect(server.freshAsks()).toBe(3);
		expect((await srcs()).slice(refused)).toEqual([expect.stringMatching(/s=1&.*#1080$/)]);
		await expect(page.locator('.cells .grow')).toContainText('1080P');
	});

	test('CHOOSE opens the sheet over the panel, and a quality chosen there plays', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const server = await answerServers(
			page,
			[{ heights: [1080], broken: true }],
			[{ heights: [720] }]
		);
		const srcs = await attaches(page);
		await settingsNeverLower(page, true);
		await openPlayer(page);
		await expect(page.locator('.inter')).toContainText('NOTHING KEEPS THE QUALITY', {
			timeout: 30_000
		});
		expect(server.freshAsks()).toBe(1);
		const episode = page.url();
		await chooseFromPanel(page, '720P', 'mouse');
		// A choice by hand is the way out: it attaches, and the panel goes. On
		// this episode, from this list: a panel left up would let the clip run
		// out underneath it and the next episode play, from an ask of its own.
		await playsAgain(page);
		expect(page.url()).toBe(episode);
		expect(server.freshAsks()).toBe(1);
		expect((await srcs()).at(-1)).toMatch(/s=1&.*#720$/);
		await expect(page.locator('.cells .grow')).toContainText('720P');
	});

	test("a fresh re-attach keeps the device's cap: 720 chosen, 720 played though 1080 keeps it too", async ({
		page
	}) => {
		test.setTimeout(120_000);
		// QUALITY 720 caps the device; the fresh list offers 1080 and 720. What
		// keeps 720 and is what the cap chooses is 720, not the server's top.
		const server = await answerServers(
			page,
			[{ heights: [1080, 720], broken: true }],
			[{ heights: [1080, 720] }]
		);
		const srcs = await attaches(page);
		await settingsQuality(page, '720P');
		await settingsNeverLower(page, true);
		await openPlayer(page);
		await playsAgain(page);
		expect(server.freshAsks()).toBe(1);
		const attached = await srcs();
		expect(attached.some((s) => s.includes('lost.webm'))).toBe(true);
		expect(attached.at(-1)).toMatch(/s=1&.*#720$/);
		expect(attached.filter((s) => /#1080$/.test(s))).toEqual([]);
		await expect(page.locator('.cells .grow')).toContainText('720P');
	});

	test('a key held 12 s leaves the full 15 s after the release', async ({ page }) => {
		await holdLeavesFullClock(page, 12_000);
	});

	test('a key held 20 s leaves the full 15 s after the release', async ({ page }) => {
		await holdLeavesFullClock(page, 20_000);
	});

	test('a seek that lands with nothing to play starts the clock from the landing', async ({
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

	test('the scrubber held and moved is a seek, not a stall', async ({ page }) => {
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

	test('a paused player runs no clock, and PLAY starts it', async ({ page }) => {
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

	test('a double-tap run leaves the full 15 s after its last tap', async ({ page }) => {
		await bufferingStream(page);
		await openPlaying(page);
		const last = await tapRun(page, 6_000);
		expect(await stepAfter(page, last)).toBeGreaterThanOrEqual(STALL_MS);
	});
});

test.describe('on a phone', () => {
	test.use({ ...touch('Pixel 5'), serviceWorkers: 'block' });

	test("a fresh re-attach keeps the phone's 720 though the server tops out at 1080", async ({
		page
	}) => {
		// A phone starts at 720 with QUALITY on HIGHEST (startIndex): that cap holds
		// for the re-attach after a fatal error too.
		const server = await answerServers(
			page,
			[{ heights: [1080, 720], broken: true }],
			[{ heights: [1080, 720] }]
		);
		const srcs = await attaches(page);
		await settingsNeverLower(page, true);
		await openPlayer(page);
		await playsAgain(page);
		expect(server.freshAsks()).toBe(1);
		const attached = await srcs();
		expect(attached.some((s) => s.includes('lost.webm'))).toBe(true);
		expect(attached.at(-1)).toMatch(/s=1&.*#720$/);
		expect(attached.filter((s) => /#1080$/.test(s))).toEqual([]);
	});

	test('CHOOSE opens the sheet over the panel, and a quality tapped there plays', async ({
		page
	}) => {
		const server = await answerServers(
			page,
			[{ heights: [1080], broken: true }],
			[{ heights: [720] }]
		);
		const srcs = await attaches(page);
		await settingsNeverLower(page, true);
		await openPlayer(page);
		await expect(page.locator('.inter')).toContainText('NOTHING KEEPS THE QUALITY', {
			timeout: 30_000
		});
		expect(server.freshAsks()).toBe(1);
		const episode = page.url();
		await chooseFromPanel(page, '720P', 'tap');
		await playsAgain(page);
		expect(page.url()).toBe(episode);
		expect(server.freshAsks()).toBe(1);
		expect((await srcs()).at(-1)).toMatch(/s=1&.*#720$/);
	});

	test('a double-tap run leaves the full 15 s after its last tap', async ({ page }) => {
		await bufferingStream(page);
		await openPlaying(page);
		const last = await tapRun(page, 6_000);
		expect(await stepAfter(page, last)).toBeGreaterThanOrEqual(STALL_MS);
	});
});
