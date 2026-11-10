import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { rmSync, readFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './helpers/hydrated';

/**
 * The player on a TV (c235; TV-Player, TV-Board-Player): the picture until a
 * key, then all eight cells on one row with the scrubber above (the minute pair
 * is c865), the settings as a 420px panel, and the media keys a remote sends.
 *
 * The seeded library has no anime -- the sample shelf is all books -- so this
 * runs against the browse world's own server, the one `tests/browse-anime.e2e.ts`
 * plays on, at an absolute address: the `tv` project's baseURL is the shared
 * library. It opens the episode in incognito, the app's own way of watching
 * without recording, so the flow files running beside it on that database keep
 * the CONTINUE line they assert on.
 */

const BROWSE = `http://localhost:${process.env.PLAYWRIGHT_BROWSE_PORT ?? '4194'}`;
const TITLE = 'Tsukiakari no Ryokōsha';
/** EP. 11: a title of its own, no stored position, and no other spec plays it. */
const EPISODE = "The Ferryman's Count";

test.use({ baseURL: BROWSE });

// Measured, not guessed (doc/TESTING.md, "Load"; c448): with the box at a
// load average of 15-68, every case here took 24-30 s even when it passed,
// and all eight reds of that run were the default 30 s running out, each
// waiting on the right state (the chrome's own 4 s, SKIP's 8 s alone window,
// the working stream's attach). Each case opens the episode through the
// library and the series, whose pages hydrate slowly under load.
test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ context, page }) => {
	await context.addCookies([{ name: 'tsundoku_incognito', value: '1', url: BROWSE }]);
	// The fixture clip is 8 s and its ending starts at 6. A loaded suite can
	// starve a worker for longer than that between two presses, and the clip
	// would end under the test; every play starts it 10x slower instead.
	await page.addInitScript(() => {
		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
			this.playbackRate = 0.1;
			return play.call(this);
		};
	});
});

async function openEpisode(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: EPISODE })
		.locator('.entry-btn')
		.click();
	await expect(page.locator('.player')).toBeVisible();
}

/**
 * The series' last episode, EP. 12 of season 2: it has no next, so the
 * end-of-episode card never appears and the bar keeps the keys through a seek
 * to the clip's end (c296).
 */
async function openLastEpisode(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.getByRole('region', { name: 'Episodes' }).locator('.entry-btn').last().click();
	await expect(page.locator('.player')).toBeVisible();
}

/**
 * Playing, on the working stream, with the bar up. A browser that won't start
 * a video by itself is started by the bar, as a remote would.
 *
 * Waits on the picture's own state, never on time (c448). Until wave 20 this
 * gave autoplay 5 s and then pressed ▶❚❚ regardless: under load autoplay
 * started in the same breath as the press, which paused it, and the case
 * began on a paused picture (its "Pause" read "Play"). So ▶❚❚ is pressed only
 * while its label still says Play, and again until the picture plays. And the
 * fake's first server always fails over (the clip is 8 s; see streamReady), so
 * this also waits for the working stream, whose attach would otherwise land
 * under the case's first key.
 */
async function play(page: import('@playwright/test').Page): Promise<void> {
	const video = page.locator('video');
	const pp = page.locator('.cells .pause');
	await expect(async () => {
		const playing = () => video.evaluate((v: HTMLVideoElement) => !v.paused);
		if (!(await playing()) && (await pp.getAttribute('aria-label')) === 'Play') {
			await page.keyboard.press('ArrowUp');
			await pp.focus();
			if ((await pp.getAttribute('aria-label')) === 'Play') await page.keyboard.press('Enter');
		}
		expect(await playing()).toBe(true);
		expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(7);
	}).toPass({ timeout: 60_000 });
	await page.keyboard.press('ArrowUp');
	await expect(page.locator('.player')).toHaveClass(/chrome/);
}

/**
 * The working stream is attached: the fake's first server always fails over
 * (the fixture clip is 8 s), and a re-attach would undo a pause the test just
 * made.
 */
async function streamReady(page: import('@playwright/test').Page): Promise<void> {
	await expect
		.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.duration), {
			timeout: 15_000
		})
		.toBeGreaterThan(7);
}

const bar = (page: import('@playwright/test').Page) => page.locator('.bottom .cells > :visible');

/**
 * The fixture clip claiming ten minutes (c865): at 8 s a 60 s jump and a 10 s
 * one both reach the same end, so the minute's landing could not be told from
 * the fine step's. The WebM's `Duration` (ID 0x4489, size 0x88, a double in
 * milliseconds) is raised, and the source's 6–8 s ending is taken out of the
 * answer so the next-episode card does not take the bar's focus mid-case.
 */
const DURATION = readFileSync('tests/fixtures/video/clip.webm').indexOf(
	Buffer.from([0x44, 0x89, 0x88])
);
async function longEpisode(page: import('@playwright/test').Page): Promise<void> {
	const clip = Buffer.from(readFileSync('tests/fixtures/video/clip.webm'));
	if (DURATION < 0) throw new Error('clip.webm has no Duration element');
	clip.writeDoubleBE(600_000, DURATION + 3);
	// A data URL, not the media route: the patched file over HTTP is only as
	// seekable as the bytes the server really has, and those stop at 8 s.
	const src = `data:video/webm;base64,${clip.toString('base64')}`;
	await page.route('**/api/anime/episode/*/videos*', async (route) => {
		const response = await route.fetch();
		const body = await response.json();
		body.intro = null;
		body.ending = null;
		body.servers = body.servers.map((s: { n: number; qualities: { src: string }[] }) =>
			s.n === 1 ? s : { ...s, qualities: s.qualities.map((q) => ({ ...q, src })) }
		);
		return route.fulfill({
			status: 200,
			headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
			body: JSON.stringify(body)
		});
	});
}

/**
 * One key as the TV app sends it (`Keys.kt`'s `dispatchScript`): a synthetic
 * keydown or keyup at the focused thing, bubbling to the window the player
 * listens on. Playwright has no name for most media keys.
 */
async function remoteKey(
	page: import('@playwright/test').Page,
	type: 'keydown' | 'keyup',
	key: string,
	repeat = false
): Promise<void> {
	await page.evaluate(
		({ type, key, repeat }) => {
			const at = document.activeElement ?? document.body;
			at.dispatchEvent(new KeyboardEvent(type, { key, repeat, bubbles: true }));
		},
		{ type, key, repeat }
	);
}

/**
 * A remote's hold, as MainActivity sends one (Keys.kt): repeats are fresh
 * keydowns with no `repeat` flag, at a remote's ~16/s. The burst is bounded by
 * the page's own clock, not by a count: eight 60 ms waits are 480 ms nominal
 * and ran past the player's 500 ms pace under load, moving two minutes where
 * the case says one. Every keydown here lands inside [deadlineMs] of the first.
 *
 * Returns how many keydowns it sent, so a case can prove repeats happened.
 */
async function holdKey(
	page: import('@playwright/test').Page,
	key: string,
	{ deadlineMs = 400, release = true, pressAfter = false } = {}
): Promise<number> {
	return page.evaluate(
		async ({ key, deadlineMs, release, pressAfter }) => {
			const send = (type: string) =>
				(document.activeElement ?? document.body).dispatchEvent(
					new KeyboardEvent(type, { key, bubbles: true })
				);
			const start = performance.now();
			let n = 0;
			do {
				send('keydown');
				n++;
				await new Promise((r) => setTimeout(r, 60));
			} while (performance.now() - start < deadlineMs);
			if (release) send('keyup');
			if (pressAfter) send('keydown');
			return n;
		},
		{ key, deadlineMs, release, pressAfter }
	);
}

/** A remote's media key, pressed and released. */
async function mediaKey(page: import('@playwright/test').Page, key: string): Promise<void> {
	await remoteKey(page, 'keydown', key);
	await remoteKey(page, 'keyup', key);
}

test('eight cells on one row, and the first arrow lands on ▶❚❚', async ({ page }) => {
	await openEpisode(page);
	await play(page);

	// 6B: the bar's own cells, in the design's order, on one row. The minute
	// pair (c865) sits outside the 10 s pair. (The volume, ? KEYS and the
	// desktop's minute cells are not drawn here.)
	await expect(bar(page)).toHaveCount(8);
	await expect(bar(page).nth(0)).toHaveAttribute('aria-label', /Pause|Play/);
	await expect(bar(page).nth(1)).toHaveText('−1m');
	await expect(bar(page).nth(2)).toHaveText('−10');
	await expect(bar(page).nth(3)).toHaveText('+10');
	await expect(bar(page).nth(4)).toHaveText('+1m');
	await expect(bar(page).nth(5)).toContainText('← EP. 10');
	// The one cell that names the stream and opens the settings.
	await expect(bar(page).nth(6)).toContainText('SUBS');
	await expect(bar(page).nth(7)).toContainText('EP. 12 →');
	// The first five are 76px, as TV-Focus draws the same bar.
	for (const i of [0, 1, 2, 3, 4]) expect((await bar(page).nth(i).boundingBox())!.width).toBe(76);
	// 56px under a 60px scrubber, inside the 28px safe bottom and the 48px
	// sides. The bars themselves reach the screen's edges (TV-Player: the
	// margin is their padding), so no picture shows above or under them.
	const cells = (await page.locator('.cells').boundingBox())!;
	expect(cells.height).toBe(56);
	expect(Math.round(cells.y + cells.height)).toBe(540 - 28);
	expect([Math.round(cells.x), Math.round(cells.x + cells.width)]).toEqual([48, 960 - 48]);
	expect((await page.locator('.scrubrow').boundingBox())!.height).toBe(60);
	const bottom = (await page.locator('.bottom').boundingBox())!;
	expect(Math.round(bottom.y + bottom.height)).toBe(540);
	expect(Math.round((await page.locator('.top').boundingBox())!.y)).toBe(0);
	// 6A: no middle cluster on a TV -- the bar is the interface.
	await expect(page.locator('.cluster')).toBeHidden();

	// Nothing focused yet; an arrow puts it on ▶❚❚, the bar's own start.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await expect(bar(page).nth(0)).not.toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(bar(page).nth(0)).toBeFocused();
	// → walks the row.
	await page.keyboard.press('ArrowRight');
	await expect(bar(page).nth(1)).toBeFocused();
});

test('the settings cell opens the 420px panel, ← → changes a row, BACK gives focus back', async ({
	page
}) => {
	await openEpisode(page);
	await play(page);
	// Paused: SPEED's 1× below plays the clip at its own speed (the slowdown in
	// beforeEach is a tenth), and under load it reached the 1 s opening before
	// BACK, where SKIP INTRO takes the pad by design and the settings cell
	// never got it back (c448). A paused picture also keeps the bar up.
	await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
	await expect(page.locator('.cells .pause')).toHaveAttribute('aria-label', 'Play');
	const settings = page.locator('.cells .grow');
	await settings.focus();
	await page.keyboard.press('Enter');

	const panel = page.getByRole('dialog', { name: 'Playback settings' });
	await expect(panel).toBeVisible();
	expect((await panel.boundingBox())!.width).toBe(420);
	// It opens on its first row, not on its ✕ (TV-Focus, "A PANEL").
	await expect(panel.locator('.srow2').first().locator('button').first()).toBeFocused();

	// ← → move along the row and OK takes the value. SPEED is this episode's
	// alone, so nothing here changes what the series carries to every episode.
	const speed = panel.locator('.srow2', { hasText: 'SPEED' });
	const one = speed.getByRole('button', { name: '1×' });
	const faster = speed.getByRole('button', { name: '1.25' });
	await one.focus();
	await page.keyboard.press('ArrowRight');
	await expect(faster).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(faster).toHaveClass(/on/);
	// Back to 1× before leaving: the bar names the speed.
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Enter');
	await expect(one).toHaveClass(/on/);

	// BACK closes it and puts focus back on the cell that opened it.
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
	await expect(settings).toBeFocused();
});

/**
 * c715: KEYS' ten 56px rows and its head are 616px, past the 540px panel, and
 * the sheet is `overflow: hidden`: the last rows were cut off with no way to
 * reach them. The rows scroll now, under the head, and each is a stop: the
 * pad walks to the last, which is then wholly inside the panel and below the
 * head. A TV opens KEYS with `?` (its ? KEYS cell is the desktop's).
 */
test('KEYS: the pad walks to the last row, and it is wholly on the panel (c715)', async ({
	page
}) => {
	await openEpisode(page);
	await play(page);
	await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
	await expect(page.locator('.cells .pause')).toHaveAttribute('aria-label', 'Play');
	await page.keyboard.press('Shift+Slash');
	const keys = page.getByRole('dialog', { name: 'Keys' });
	await expect(keys).toBeVisible();
	const rows = keys.locator('.krow');
	await expect(rows).toHaveCount(11);
	// It opens on its first row, as the settings panel does.
	await expect(rows.first()).toBeFocused();
	for (let i = 1; i < 11; i++) {
		await page.keyboard.press('ArrowDown');
		await expect(rows.nth(i)).toBeFocused();
	}
	const last = rows.last();
	await expect(last).toContainText('These keys');
	const fits = () =>
		page.evaluate(() => {
			const panel = document.querySelector('.sheet.keys')!.getBoundingClientRect();
			const head = document.querySelector('.sheet.keys .shead')!.getBoundingClientRect();
			const row = [...document.querySelectorAll('.sheet.keys .krow')]
				.at(-1)!
				.getBoundingClientRect();
			return {
				inside: row.top >= head.bottom - 0.5 && row.bottom <= panel.bottom + 0.5,
				row: [Math.round(row.top), Math.round(row.bottom)],
				panel: [Math.round(head.bottom), Math.round(panel.bottom)]
			};
		});
	// The layer's reveal is instant, but wait on the page's own geometry.
	await expect.poll(async () => (await fits()).inside).toBe(true);
	// And back up: the first row comes back into view under the head.
	for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
	await expect(rows.first()).toBeFocused();
	const first = await rows.first().evaluate((r) => {
		const head = r.closest('.sheet')!.querySelector('.shead')!.getBoundingClientRect();
		return r.getBoundingClientRect().top - head.bottom;
	});
	expect(Math.abs(first)).toBeLessThanOrEqual(1);
	// The rows are a scroller of their own, not only stops a focus can drag
	// into view: a wheel over them moves them (it never moves `hidden`), as a
	// short desktop window or a finger needs.
	const box = (await rows.nth(2).boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.wheel(0, 300);
	await expect.poll(() => keys.locator('.krows').evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
	// BACK closes it.
	await page.keyboard.press('Escape');
	await expect(keys).toHaveCount(0);
});

test('the DIM range keeps ← → and lets ↑ leave it on a TV (c611)', async ({ page }) => {
	await openEpisode(page);
	await play(page);
	// Paused, so the clip cannot end under the panel and the bar stays up
	// (c448, as the settings case above).
	await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
	await expect(page.locator('.cells .pause')).toHaveAttribute('aria-label', 'Play');
	await page.locator('.cells .grow').focus();
	await page.keyboard.press('Enter');
	const panel = page.getByRole('dialog', { name: 'Playback settings' });
	await expect(panel).toBeVisible();

	const dim = panel.getByRole('slider', { name: 'Dim' });
	const at = () => dim.inputValue();
	await dim.focus();
	expect(await at()).toBe('0');
	// A native range with no attribute keeps the arrows along its axis (c259):
	// the browser's own step, 0.05 here.
	await page.keyboard.press('ArrowRight');
	await expect.poll(at).toBe('0.05');
	await page.keyboard.press('ArrowRight');
	await expect.poll(at).toBe('0.1');
	await page.keyboard.press('ArrowLeft');
	await expect.poll(at).toBe('0.05');
	await page.keyboard.press('ArrowLeft');
	await expect.poll(at).toBe('0');

	// ↑ leaves it. Before c259 a native range kept all four arrows, so the pad
	// was trapped in DIM (↑ stepped the value and nothing got out).
	await page.keyboard.press('ArrowUp');
	await expect(dim).not.toBeFocused();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const a = document.activeElement as HTMLElement | null;
				return {
					inPanel: !!a?.closest('[role="dialog"]'),
					isDim: a?.getAttribute('aria-label') === 'Dim'
				};
			})
		)
		.toEqual({ inPanel: true, isDim: false });
	await expect.poll(at).toBe('0');
});

test.describe('the minute step (c865)', () => {
	// The worker answers an episode's videos and media itself once it has
	// installed, past page.route (doc/TESTING.md, "Load"): the stand-in long
	// episode below can only be seen with it out of the way.
	test.use({ serviceWorkers: 'block' });

	test('the media keys a remote sends: ▶❚❚, ⏩ and ⏪', async ({ page }) => {
		await longEpisode(page);
		await openEpisode(page);
		await play(page);
		const pp = page.locator('.cells .pause');
		await expect(pp).toHaveAttribute('aria-label', 'Pause');
		await mediaKey(page, 'MediaPlayPause');
		await expect(pp).toHaveAttribute('aria-label', 'Play');
		await mediaKey(page, 'MediaPlayPause');
		await expect(pp).toHaveAttribute('aria-label', 'Pause');

		const at = () => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
		const video = page.locator('video');
		// ⏪ ⏩ are a minute each (c865): 1:40 back to 0:40, and on to 1:40 again,
		// on the ten-minute stand-in, where a 10 s step could not reach either.
		await video.evaluate((v: HTMLVideoElement) => {
			v.pause();
			v.currentTime = 100;
		});
		await mediaKey(page, 'MediaRewind');
		await expect.poll(at).toBeCloseTo(40, 1);
		await expect(page.locator('.flash .by')).toHaveText('−60 S');
		await mediaKey(page, 'MediaFastForward');
		await expect.poll(at).toBeCloseTo(100, 1);
		await expect(page.locator('.flash .by')).toHaveText('+60 S');
	});

	test('a held ⏩ is one minute, not a minute per repeat (c865)', async ({ page }) => {
		await longEpisode(page);
		await openEpisode(page);
		await play(page);
		const video = page.locator('video');
		const at = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);
		await video.evaluate((v: HTMLVideoElement) => {
			v.pause();
			v.currentTime = 100;
		});
		// The app's own key, as MainActivity sends an Android repeat: a fresh
		// keydown with no `repeat` flag (Keys.kt), at a remote's ~16/s. A hold
		// must move a minute, not one per repeat. No keyup here: this also
		// leaves the pace to expire on its own, below.
		const sent = await holdKey(page, 'MediaFastForward', { release: false });
		expect(sent).toBeGreaterThanOrEqual(3);
		await expect.poll(at).toBeCloseTo(160, 1);
		await expect(page.locator('.flash .by')).toHaveText('+60 S');
		// A browser's own repeats (a keyboard's, or a desktop's remote) are no
		// step at all, however quickly they come.
		await page.evaluate(() => {
			for (let i = 0; i < 5; i++)
				(document.activeElement ?? document.body).dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'MediaFastForward',
						repeat: true,
						bubbles: true
					})
				);
		});
		await page.waitForTimeout(100);
		expect(await at()).toBeCloseTo(160, 1);
		// And the pace is no lock: a door that sends no keyup still lets go once
		// the interval has passed.
		await page.waitForTimeout(600);
		await mediaKey(page, 'MediaFastForward');
		await expect.poll(at).toBeCloseTo(220, 1);
	});

	test('a press right after a held ⏩ is released moves a minute again (c865)', async ({
		page
	}) => {
		await longEpisode(page);
		await openEpisode(page);
		await play(page);
		const at = () => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
		await page.locator('video').evaluate((v: HTMLVideoElement) => {
			v.pause();
			v.currentTime = 100;
		});
		// A hold as MainActivity sends it, then the release and a press in the
		// same breath: repeats are ACTION_DOWNs, the release is the one keyup
		// (Keys.kt). The pace must end with the key, or that press is swallowed
		// as if the button were still down.
		const sent = await holdKey(page, 'MediaFastForward', { pressAfter: true });
		expect(sent).toBeGreaterThanOrEqual(3);
		// One minute for the hold, one for the press: 1:40 to 2:20 to 3:40.
		await expect.poll(at).toBeCloseTo(220, 1);
		// The pace is per direction, so the other way moves at once.
		await mediaKey(page, 'MediaRewind');
		await expect.poll(at).toBeCloseTo(160, 1);
	});

	test('the bar’s −1m and +1m are stops in reading order, and each moves a minute (c865)', async ({
		page
	}) => {
		await longEpisode(page);
		await openEpisode(page);
		await play(page);
		const at = () => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
		await page.locator('video').evaluate((v: HTMLVideoElement) => {
			v.pause();
			v.currentTime = 100;
		});
		// ↓ from the picture puts the pad on ▶❚❚; nothing may hold focus first
		// (play() leaves the pad wherever its own ↑ put it).
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await expect(page.locator('.player')).toHaveClass(/chrome/);
		await page.keyboard.press('ArrowDown');
		await expect(page.locator('.cells .pause')).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(bar(page).nth(1)).toBeFocused();
		await page.keyboard.press('Enter');
		await expect.poll(at).toBeCloseTo(40, 1);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await expect(bar(page).nth(4)).toBeFocused();
		await page.keyboard.press('Enter');
		await expect.poll(at).toBeCloseTo(100, 1);
		// ← → stay 10 s: on the seek bar they seek and flash 10.
		await page.locator('.cells .pause').focus();
		await page.keyboard.press('ArrowUp');
		await expect(page.locator('.scrubrow .track')).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect.poll(at).toBeCloseTo(110, 1);
		await expect(page.locator('.flash .by')).toHaveText('+10 S');
	});
});

test('the picture until a key, SKIP INTRO taking OK, and BACK hiding then leaving', async ({
	page
}) => {
	await openEpisode(page);
	await play(page);
	const player = page.locator('.player');
	// 6A/6B: the bar hides after a few seconds of playing, and a key brings it
	// back with focus on ▶❚❚; BACK hides it at once.
	await expect(player).not.toHaveClass(/chrome/, { timeout: 10_000 });
	await page.keyboard.press('ArrowDown');
	await expect(player).toHaveClass(/chrome/);
	await expect(page.locator('.cells .pause')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(player).not.toHaveClass(/chrome/);

	// 6D: SKIP INTRO shows alone and takes OK, so skipping is one press.
	await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 1.2));
	await expect(page.getByRole('button', { name: 'SKIP INTRO →' })).toBeVisible();
	await page.keyboard.press('Enter');
	await expect
		.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
		.toBeGreaterThanOrEqual(3);

	// BACK at the picture leaves for the series, as the tablet's ← does.
	await page.keyboard.press('Escape');
	await page.waitForURL(/\/series\/\d+/);
});

test('next episode is a cell of the bar, and OK on it moves to EP. 12', async ({ page }) => {
	await openEpisode(page);
	await play(page);
	const next = page.locator('.cells').getByRole('button', { name: /EP\. 12/ });
	await expect(next).toBeEnabled();
	await next.focus();
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.bottom .cells .grow')).toContainText('SUBS');
});

test('the player’s ← goes back to the series, so the next BACK does not reopen the player', async ({
	page
}) => {
	await openEpisode(page);
	await play(page);
	const series = page.url().replace(/\/read\/.*/, '');
	await page.locator('.top a.back').focus();
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/series\/\d+/);
	// Back in history, not a new series screen on top of the player
	// (2026-11-02, the first real TV): one more step back is the library.
	await page.goBack();
	await expect(page).not.toHaveURL(/\/read\//);
	expect(page.url().startsWith(series)).toBe(true);
});

/**
 * The seek bar as the pad's own control (c296, parts 1-3): ← → are the
 * slider's, ↑ from any cell in the bar's row lands on it, and the bar's ⇥
 * keeps seeking with the flash. The last episode has no next, so a seek to the
 * clip's end cannot offer the end card over this.
 */
test('the seek bar keeps ← →, and ↑ from every cell of the row lands on it', async ({ page }) => {
	await openLastEpisode(page);
	await play(page);
	await streamReady(page);
	const track = page.locator('.scrubrow .track');
	const video = page.locator('video');
	const at = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);

	// A paused picture keeps the chrome up and the next-episode card away.
	await video.evaluate((v: HTMLVideoElement) => {
		v.pause();
		v.currentTime = 0.5;
	});
	await expect(page.locator('.player')).toHaveClass(/chrome/);

	// ↑ from ▶❚❚: before c296 this took the far top bar's ←, which overlaps
	// the cell while the line started one pixel past it.
	await page.locator('.cells .pause').focus();
	await page.keyboard.press('ArrowUp');
	await expect(track).toBeFocused();

	// → seeks 10 s, flashes, and the bar keeps the keys.
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.flash .by')).toHaveText('+10 S');
	await expect(track).toBeFocused();
	await expect.poll(at).toBeGreaterThan(5);

	// ← the same, the other way.
	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 5));
	await page.keyboard.press('ArrowLeft');
	await expect(track).toBeFocused();
	await expect.poll(at).toBeLessThan(1);

	// The right-most cell that can take focus (the last one is disabled here).
	const cells = page.locator('.bottom .cells > :visible:not([disabled])');
	await cells.last().focus();
	await page.keyboard.press('ArrowUp');
	await expect(track).toBeFocused();

	// OK on the bar is the pad's click on it, and it toggles the picture rather
	// than doing nothing at all (c296, the review's round-1 low 5).
	await page.keyboard.press('Enter');
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
	await page.keyboard.press('Enter');
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

/**
 * Part 2: with the bar hidden and nothing offered, ← → seek and the bar comes
 * with the keys on it. This is the state the opt-out exists for: no SKIP, no
 * card, so the root carries `data-focus-off`, the focus layer never sees the
 * arrow, and the player's own handler seeks (doc/handoff-notes/tv-player.md,
 * part 2). The pause is at 0.4 s because the browse world's episodes open at
 * 1-3 s (tests/browse-setup.ts), and inside the opening SKIP INTRO is offered,
 * which lifts the opt-out (c316).
 */
test('← → with the bar hidden and nothing offered seek and put focus on the seek bar', async ({
	page
}) => {
	await openLastEpisode(page);
	await play(page);
	await streamReady(page);
	const player = page.locator('.player');
	const track = page.locator('.scrubrow .track');
	const video = page.locator('video');
	const at = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);

	await video.evaluate((v: HTMLVideoElement) => {
		v.pause();
		v.currentTime = 0.4;
	});
	// The player has taken the pause in (its ▶❚❚ reads Play), which shows the
	// bar: under a loaded suite the pause event landed after Escape and drew
	// the bar again over the hidden one (c336, c439).
	await expect(page.locator('.cells .pause')).toHaveAttribute('aria-label', 'Play');
	await expect(page.getByRole('button', { name: /^SKIP/ })).toHaveCount(0);
	// Escape hides the bar; the paused picture leaves it hidden, and with
	// nothing offered the root opts out of the focus layer.
	await page.keyboard.press('Escape');
	await expect(player).not.toHaveClass(/chrome/);
	await expect(player).toHaveAttribute('data-focus-off', '');

	await page.keyboard.press('ArrowRight');
	await expect(player).toHaveClass(/chrome/);
	await expect(page.locator('.flash .by')).toHaveText('+10 S');
	await expect(track).toBeFocused();
	await expect.poll(at).toBeGreaterThan(5);

	// ← the same way: the bar hidden again, at 5 s (past the opening, before
	// the ending's 6 s), so the key again reaches the player and not the layer.
	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 5));
	await expect.poll(at).toBe(5);
	await page.keyboard.press('Escape');
	await expect(player).not.toHaveClass(/chrome/);
	await expect(player).toHaveAttribute('data-focus-off', '');
	await page.keyboard.press('ArrowLeft');
	await expect(player).toHaveClass(/chrome/);
	await expect(page.locator('.flash .by')).toHaveText('−10 S');
	await expect(track).toBeFocused();
	await expect.poll(at).toBeLessThan(1);
});

/**
 * The same keys inside the opening, where SKIP INTRO is offered: the bar is
 * hidden but the root's opt-out is lifted so the pad can reach SKIP (part 5),
 * and ← → come through the focus layer, which has no stop beside SKIP and
 * lets the key fall through to the player. Until c316 this was the only part-2
 * case, under the title of the one above.
 */
test('with SKIP INTRO offered and the bar hidden, ← → still seek and put focus on the seek bar', async ({
	page
}) => {
	await openLastEpisode(page);
	await play(page);
	await streamReady(page);
	const player = page.locator('.player');
	const track = page.locator('.scrubrow .track');
	const video = page.locator('video');
	const at = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);

	await video.evaluate((v: HTMLVideoElement) => {
		v.pause();
		v.currentTime = 1;
	});
	await expect(page.locator('.cells .pause')).toHaveAttribute('aria-label', 'Play');
	await page.keyboard.press('Escape');
	await expect(player).not.toHaveClass(/chrome/);
	// SKIP is up on its own (its first 8 s), so the layer has the arrows.
	await expect(page.getByRole('button', { name: 'SKIP INTRO →' })).toBeVisible();
	await expect(player).not.toHaveAttribute('data-focus-off');

	await page.keyboard.press('ArrowRight');
	await expect(player).toHaveClass(/chrome/);
	await expect(track).toBeFocused();
	await expect.poll(at).toBeGreaterThan(5);

	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 5));
	await page.keyboard.press('ArrowLeft');
	await expect.poll(at).toBeLessThan(1);
	await expect(track).toBeFocused();
});

/**
 * The next-episode card (c296, part 4): PLAY NOW is focused the moment it
 * appears, ← → walk it, ↓ reaches the bar, ↑ comes back and OK plays EP. 12.
 */
test('the next-episode card takes PLAY NOW, and the bar’s ↑ comes back to it', async ({ page }) => {
	await openEpisode(page);
	await play(page);
	await streamReady(page);
	const video = page.locator('video');
	const track = page.locator('.scrubrow .track');
	const playNow = page.locator('.endcard .acc');
	const stay = page.locator('.endcard .two button').first();

	// Near the end (the clip is 8 s, its ending starts at 6), paused so the
	// card stays up while the test walks it.
	await video.evaluate((v: HTMLVideoElement) => {
		v.pause();
		v.currentTime = 6.2;
	});
	await expect(page.locator('.endcard')).toBeVisible();
	await expect(playNow).toBeFocused();

	// ← is STAY, the card's other button.
	await page.keyboard.press('ArrowLeft');
	await expect(stay).toBeFocused();

	// ↓ into the bar, and ↑ back to PLAY NOW.
	await page.keyboard.press('ArrowDown');
	await expect(track).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(playNow).toBeFocused();

	// OK plays the next episode at once, rather than when this one ends.
	const before = page.url();
	await page.keyboard.press('Enter');
	await page.waitForURL((url) => url.toString() !== before);
	await expect(page.locator('.player')).toBeVisible();
});

/**
 * SKIP on a TV (c296, part 5): it takes focus when it appears, ↓ puts the pad
 * on the bar, ↑ returns to it, and the opening passing takes it away without
 * losing focus.
 */
test('SKIP takes focus, gives the bar focus, and gives it back', async ({ page }) => {
	await openEpisode(page);
	await play(page);
	await streamReady(page);
	const video = page.locator('video');
	const track = page.locator('.scrubrow .track');
	const skip = page.getByRole('button', { name: 'SKIP INTRO →' });

	// Paused: the chrome's 4 s timer never races the assertions below, and the
	// opening stays open while the test walks the keys.
	await video.evaluate((v: HTMLVideoElement) => v.pause());
	await video.evaluate((v: HTMLVideoElement) => {
		v.currentTime = 1.2;
	});
	await expect(skip).toBeVisible();
	await expect(skip).toBeFocused();

	// The bar goes, so SKIP is alone as 6D draws it; it keeps the focus.
	await page.keyboard.press('Escape');
	await expect(page.locator('.player')).not.toHaveClass(/chrome/);
	await expect(skip).toBeFocused();

	// ↓ into the bar, ↑ back to SKIP.
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('.player')).toHaveClass(/chrome/);
	await expect(track).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(skip).toBeFocused();

	// The opening passes without a skip: the button goes and focus lands on
	// the bar, not on nothing.
	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 3.5));
	await expect(skip).toHaveCount(0);
	await expect(track).toBeFocused();
});

/** OK on the focused SKIP skips the opening in one press (c296, part 5). */
test('OK on the focused SKIP skips the opening', async ({ page }) => {
	await openEpisode(page);
	await play(page);
	await streamReady(page);
	const video = page.locator('video');
	const skip = page.getByRole('button', { name: 'SKIP INTRO →' });
	await video.evaluate((v: HTMLVideoElement) => {
		v.currentTime = 1.2;
	});
	await expect(skip).toBeFocused();
	await page.keyboard.press('Enter');
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
		.toBeGreaterThanOrEqual(3);
	await expect(skip).toHaveCount(0);
});

/**
 * The chrome's own 4 s must not strand the pad on the bar it has just hidden
 * (c296, round 2): with the card up, `.bottom` is `data-focus-skip`, so a cell
 * focused there stops being a stop at all -- every arrow ran the layer's
 * "nothing focused" path (STAY), and OK clicked the dead track. The offer keeps
 * the pad while it is up. Playing, not paused: the card only stays while the
 * clip does, and hiding the bar by hand would leave the timer out of it.
 */
test('the chrome’s auto-hide hands the pad back to the card', async ({ page }) => {
	await openEpisode(page);
	await play(page);
	await streamReady(page);
	const video = page.locator('video');
	const track = page.locator('.scrubrow .track');
	const playNow = page.locator('.endcard .acc');

	// Playing with the bar down: the card appears over the picture. The bar
	// goes by its own 4 s rather than by BACK: under load those 4 s could pass
	// before the key, and BACK at a bare picture leaves for the series (c448).
	await expect(page.locator('.player')).not.toHaveClass(/chrome/, { timeout: 15_000 });
	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 6.2));
	await expect(page.locator('.endcard')).toBeVisible();
	await expect(playNow).toBeFocused();

	// ↓ brings the bar, with the pad on the seek bar.
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('.player')).toHaveClass(/chrome/);
	await expect(track).toBeFocused();

	// The 4 s go by with the card still up: focus comes back to the offer
	// rather than staying on a cell that is no longer a stop. Waited on as the
	// bar going, not as 4.5 s, which a loaded worker stretches (c448).
	await expect(page.locator('.player')).not.toHaveClass(/chrome/, { timeout: 15_000 });
	await expect(playNow).toBeFocused();

	// ↑ has nothing above it, so the card keeps the pad (and the bar stays
	// down); OK plays EP. 12 now. One snapshot: an assertion that polls would
	// be satisfied later by the auto-hide putting the pad back on the card.
	await page.keyboard.press('ArrowUp');
	expect(
		await page.evaluate(() => ({
			chrome: document.querySelector('.player')?.classList.contains('chrome') ?? false,
			onCard: document.activeElement?.hasAttribute('data-player-play') ?? false
		}))
	).toEqual({ chrome: false, onCard: true });
	const before = page.url();
	await page.keyboard.press('Enter');
	await page.waitForURL((url) => url.toString() !== before);
	await expect(page.locator('.player')).toBeVisible();
});

/**
 * Revealing the bar must not take the mark off ▶❚❚ and put it on SKIP (c296,
 * round 2). A SKIP inside its 8 s alone window is offered while the chrome is
 * hidden, and the bar coming up renders it again: a reveal, not a new offer, so
 * ▶❚❚ keeps the focus the owner asked for. ↑ still reaches SKIP, which is part
 * 5's return path, one press later because ↑ from a cell stops on the bar.
 */
test('revealing the bar keeps ▶❚❚, and ↑ still reaches an offered SKIP', async ({ page }) => {
	await openEpisode(page);
	await play(page);
	await streamReady(page);
	const video = page.locator('video');
	const track = page.locator('.scrubrow .track');
	const skip = page.getByRole('button', { name: 'SKIP INTRO →' });

	// Inside the opening with the bar down: SKIP shows alone and takes the pad.
	// Paused, so the opening cannot run out while the alone window does (a
	// loaded worker stretched the wait past the clip's 3 s), and the bar stays
	// up until BACK hides it rather than hiding by itself first, which turned
	// BACK into leaving the player (c448).
	await video.evaluate((v: HTMLVideoElement) => {
		v.pause();
		v.currentTime = 1.2;
	});
	await expect(page.locator('.cells .pause')).toHaveAttribute('aria-label', 'Play');
	await expect(skip).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.locator('.player')).not.toHaveClass(/chrome/);

	// The alone window (8 s) ends while the opening still runs: SKIP goes with
	// the bar, and nothing is left focused on it.
	await expect(skip).toHaveCount(0, { timeout: 15_000 });
	await expect(page.locator('.player')).not.toHaveClass(/chrome/);

	// OK brings the bar on ▶❚❚; the offer was already running, so it does not
	// steal the mark.
	await page.keyboard.press('Enter');
	await expect(page.locator('.player')).toHaveClass(/chrome/);
	await expect(skip).toBeVisible();
	await expect(page.locator('.cells .pause')).toBeFocused();

	// ↑ from the bar reaches SKIP: one press to the bar, one to the button.
	await page.keyboard.press('ArrowUp');
	await expect(track).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(skip).toBeFocused();
});

/**
 * Many languages on the 420px panel (c386, doc/ANIME.md "The settings
 * sheet"): the episode's answer is widened in the browser to 11 audio and 30
 * subtitle languages, labelled as the workstation labels them, as
 * tests/browse-player-languages.e2e.ts does at the 520px sheet. Incognito
 * keeps no choice, so nothing here carries to another spec.
 */
const MANY_AUDIO = [
	'Japanese',
	'English',
	'German',
	'Spanish',
	'French',
	'Hindi',
	'Hungarian',
	'Italian',
	'Portuguese (Brazil)',
	'Thai',
	'Spanish (Latin America)'
];
const MANY_SUBS = [
	'English',
	'Arabic',
	'Chinese (Simplified)',
	'Chinese (Traditional)',
	'Czech',
	'Danish',
	'Dutch',
	'Finnish',
	'French',
	'German',
	'Greek',
	'Hebrew',
	'Hindi',
	'Hungarian',
	'Indonesian',
	'Italian',
	'Japanese',
	'Korean',
	'Malay',
	'Norwegian (nob)',
	'Polish',
	'Portuguese (Brazil)',
	'Romanian',
	'Russian',
	'Spanish',
	'Spanish (Latin America)',
	'Swedish',
	'Thai',
	'Turkish',
	'Vietnamese'
];

test.describe('many languages (c386)', () => {
	// The service worker answers a page it controls itself, past page.route.
	test.use({ serviceWorkers: 'block' });

	test('on the 420px panel they wrap, and the pad moves through the grid and MORE', async ({
		page
	}) => {
		const { langName, trackCodes } = await import('../src/lib/library/streams');
		await page.route('**/api/anime/episode/*/videos**', async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as {
				servers: {
					qualities: { audio: unknown[]; subtitles: { lang: string; src: string }[] }[];
				}[];
			};
			const qualities = body.servers.flatMap((s) => s.qualities);
			const vtt = qualities.flatMap((q) => q.subtitles).find((t) => t.lang === 'EN')?.src;
			const a = trackCodes(MANY_AUDIO);
			const t = trackCodes(MANY_SUBS);
			for (const q of qualities) {
				q.audio = MANY_AUDIO.map((n, i) => ({
					lang: a[i],
					name: langName(n),
					src: `/api/anime/media/fake-audio-${i}`
				}));
				q.subtitles = MANY_SUBS.map((n, i) => ({
					lang: t[i],
					name: langName(n),
					src: `${vtt}?n=${i}`
				}));
			}
			await route.fulfill({ response, json: body });
		});
		await openEpisode(page);
		await play(page);
		await streamReady(page);
		const settings = page.locator('.cells .grow');
		await settings.focus();
		await page.keyboard.press('Enter');
		const panel = page.getByRole('dialog', { name: 'Playback settings' });
		await expect(panel).toBeVisible();
		expect((await panel.boundingBox())!.width).toBe(420);

		// AUDIO: all eleven, wrapped, none over another, each at least a tap.
		const audio = panel.getByRole('group', { name: 'Audio' }).getByRole('button');
		await expect(audio).toHaveText(trackCodes(MANY_AUDIO));
		const boxes = await audio.evaluateAll((els) =>
			els.map((el) => {
				const r = el.getBoundingClientRect();
				return {
					x: r.x,
					y: r.y,
					w: r.width,
					h: r.height,
					clipped: el.scrollWidth > el.clientWidth
				};
			})
		);
		expect(boxes.every((b) => b.w >= 44 && b.h >= 44 && !b.clipped)).toBe(true);
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) {
				const dx =
					Math.min(boxes[i].x + boxes[i].w, boxes[j].x + boxes[j].w) -
					Math.max(boxes[i].x, boxes[j].x);
				const dy =
					Math.min(boxes[i].y + boxes[i].h, boxes[j].y + boxes[j].h) -
					Math.max(boxes[i].y, boxes[j].y);
				expect(dx > 1 && dy > 1, `cells ${i} and ${j} overlap`).toBe(false);
			}
		// The pad moves through the wrapped grid: → along a line, ↓ to the cell
		// beneath, on the next line.
		const perLine = boxes.filter((b) => Math.abs(b.y - boxes[0].y) < 1).length;
		expect(perLine).toBeGreaterThan(1);
		expect(perLine).toBeLessThan(boxes.length);
		await audio.first().focus();
		await page.keyboard.press('ArrowRight');
		await expect(audio.nth(1)).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(audio.nth(1 + perLine)).toBeFocused();

		// SUBTITLES: OFF, what is on, MORE · 29. OK on MORE opens the list on what is on.
		const subs = panel.getByRole('group', { name: 'Subtitles' }).getByRole('button');
		await expect(subs).toHaveText(['OFF', 'EN', 'MORE · 29']);
		const more = panel.getByRole('button', { name: 'MORE · 29' });
		await more.focus();
		await page.keyboard.press('Enter');
		const list = panel.getByRole('group', { name: 'Every subtitle language' }).getByRole('button');
		await expect(list).toHaveCount(30);
		await expect(list.first()).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(list.nth(1)).toBeFocused();
		// BACK closes the list first, and MORE has the mark again; the panel stays.
		await page.keyboard.press('Escape');
		await expect(list).toHaveCount(0);
		await expect(more).toBeFocused();
		await expect(panel).toBeVisible();
		// OK on a language in the list takes it, and the mark lands on its cell.
		await page.keyboard.press('Enter');
		await expect(list.first()).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await expect(list).toHaveCount(0);
		const ar = panel.getByRole('button', { name: 'Arabic', exact: true });
		await expect(ar).toHaveClass(/on/);
		await expect(ar).toBeFocused();
		await expect(subs).toHaveText(['OFF', 'EN', 'AR', 'MORE · 28']);
	});
});

// ---- the Work card (c517) ------------------------------------------------------------
//
// The player's last episode of a series in a Work offers the Work's next part
// (`.upn`, `data-player-work`), and on a TV that card takes the pad as PLAY NOW
// does. The browse world has no Work, and a Work takes its parts' grid tiles
// away, so this block seeds a database of its own (work-end-frame's
// arrangement): the seed, one anime whose episodes are the fixture clip as
// files, and a Work of it and a seed manga, in SQL. It serves the build on a
// port the OS gives and reads in incognito, so nothing it does reaches another
// spec.
test.describe('the Work card on a TV (c517)', () => {
	let server: ChildProcess | null = null;
	let port = 0;
	let episode = 0;
	const dbPath = join(tmpdir(), `tsundoku-e2e-tv-work-${process.pid}.sqlite`);
	const wipe = () => {
		for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
	};
	const at = () => `http://localhost:${port}`;

	test.beforeAll(async () => {
		test.setTimeout(120_000);
		port = await new Promise<number>((resolve, reject) => {
			const probe = createServer();
			probe.once('error', reject);
			probe.listen(0, '127.0.0.1', () => {
				const { port } = probe.address() as AddressInfo;
				probe.close(() => resolve(port));
			});
		});
		wipe();
		execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
			env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
			stdio: 'pipe'
		});
		const db = new Database(dbPath);
		const now = Date.now();
		const anime = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, status, source, path, origin_key,
						source_url, added_at, indexed_at, in_library, hue)
					VALUES (1, 'Hoshi no Michi', 'anime', 'completed', 'Kakkoi', ?, ?, ?, ?, ?, 1, 200)`
				)
				.run(
					join(process.cwd(), 'tests/fixtures/video'),
					'aniyomi:1:https://example.test/michi',
					'https://example.test/michi',
					now,
					now
				).lastInsertRowid
		);
		const insert = db.prepare(
			`INSERT INTO entries (series_id, position, label, title, added_at, page_count, file,
				available, duration_s, season, episode_number, source_url, origin_source)
			VALUES (?, ?, ?, ?, ?, 0, 'clip.webm', 1, 8, 1, ?, ?, '')`
		);
		insert.run(anime, 1, 'Ep. 1', 'The Road Out', now, 1, 'https://example.test/michi/1');
		episode = Number(
			insert.run(anime, 2, 'Ep. 2', 'The Road Home', now, 2, 'https://example.test/michi/2')
				.lastInsertRowid
		);
		const manga = (
			db.prepare(`SELECT id FROM series WHERE title = 'Boku no Kokoro no Yabai Yatsu'`).get() as {
				id: number;
			}
		).id;
		const work = Number(
			db
				.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES ('Michi Run', ?, 'hand')`)
				.run(now).lastInsertRowid
		);
		const part = db.prepare(
			`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`
		);
		part.run(work, anime, 1);
		part.run(work, manga, 2);
		db.close();
		server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				TSUNDOKU_ANILIST: 'off',
				ENGINE_URL: 'http://127.0.0.1:9',
				ENGINE_TOKEN: 'e2e',
				LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-tv-work-empty-${process.pid}`),
				TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-tv-work-home-${process.pid}`)
			},
			stdio: 'ignore'
		});
		let up = false;
		for (let i = 0; i < 120 && !up; i++) {
			try {
				up = (await fetch(`${at()}/`, { redirect: 'manual' })).status > 0;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		if (!up) throw new Error('the Work preview never answered');
	});

	test.afterAll(() => {
		server?.kill();
		server = null;
		wipe();
	});

	test('↓ from the Work card is the seek bar, ↑ goes nowhere, and ← → stay on the card', async ({
		context,
		page
	}) => {
		await context.addCookies([{ name: 'tsundoku_incognito', value: '1', url: at() }]);
		await page.goto(`${at()}/read/${episode}`);
		await expect(page.locator('.player')).toBeVisible();
		await play(page);
		const video = page.locator('video');
		const card = page.locator('.upn');
		const offer = card.locator('[data-player-work]');
		const track = page.locator('.scrubrow .track');

		// The bar down by its own 4 s, then the ending: the card over the picture,
		// with the pad on its ▶ READ.
		await expect(page.locator('.player')).not.toHaveClass(/chrome/, { timeout: 15_000 });
		await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 6.2));
		await expect(card).toBeVisible();
		await expect(card).toContainText('NEXT IN THE WORK');
		await expect(offer).toBeFocused();

		// ↑ has nothing above the card: it keeps the pad and the bar stays down.
		// One snapshot, as for PLAY NOW: a poll would pass later by the bar's own
		// auto-hide handing the pad back.
		await page.keyboard.press('ArrowUp');
		expect(
			await page.evaluate(() => ({
				chrome: document.querySelector('.player')?.classList.contains('chrome') ?? false,
				onCard: document.activeElement?.hasAttribute('data-player-work') ?? false
			}))
		).toEqual({ chrome: false, onCard: true });

		// → and ← walk the card's own row (▶ READ, WORK, ✕) and seek nothing.
		// Measured so at the base too (c517 named ↓ and ↑ only): kept as a guard.
		const t0 = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
		await page.keyboard.press('ArrowRight');
		await expect(card.getByRole('link', { name: 'WORK' })).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(offer).toBeFocused();
		expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(t0 + 5);
		expect(await page.locator('.player').getAttribute('class')).not.toMatch(/\bchrome\b/);

		// ↓ brings the bar with the pad on the seek bar, as from PLAY NOW and SKIP.
		await page.keyboard.press('ArrowDown');
		await expect(page.locator('.player')).toHaveClass(/chrome/);
		await expect(track).toBeFocused();
	});
});

/**
 * The seek preview on a TV (c457; doc/ANIME.md, "The player"): no pointer, so
 * while ← → move the time with the bar up, the bar's tip shows the sprite's
 * tile for where it landed, kept inside the track at either end. The episode's
 * answer is widened in the browser as tests/browse-player-preview.e2e.ts
 * widens it, with that spec's sprite fixture: a DOWNLOADED server whose file is
 * the clip's own loopback address, and a sheet of four coloured tiles, one
 * every 2 s of the 8 s clip. A stream keeps the time alone.
 */
test.describe('the seek preview on a TV (c457)', () => {
	// The stand-ins below are `page.route`s on the stream list, which a service
	// worker answers without passing them (src/service-worker.ts): once it had
	// claimed the page in time, the player got the real two servers and no sprite
	// (c709: 4 of 30 alone, exactly the 4 `fromServiceWorker` answers).
	test.use({ serviceWorkers: 'block' });

	const SPRITE = '/__preview/tv-sprite.jpg';
	type Answer = { servers: { n: number; name: string; qualities: Record<string, unknown>[] }[] };

	async function withSprite(page: import('@playwright/test').Page) {
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
		await page.route(`**${SPRITE}`, (route) =>
			route.fulfill({ body: sheet, contentType: 'image/jpeg' })
		);
		await page.route('**/api/anime/episode/*/videos**', async (route) => {
			const res = await route.fetch();
			const real = (await res.json()) as Answer;
			const clip = real.servers.find((x) => x.n === 2)!.qualities[0];
			await route.fulfill({
				response: res,
				json: {
					...real,
					servers: [
						{
							n: 0,
							name: 'DOWNLOADED',
							qualities: [
								{
									...clip,
									label: 'Downloaded',
									kind: 'file',
									sprite: { src: SPRITE, everyS: 2, w: 160, h: 90, cols: 10, count: 4 }
								}
							]
						}
					]
				}
			});
		});
	}

	/** Paused at [t] with the bar up and the pad on the seek bar. */
	async function onTheBar(page: import('@playwright/test').Page, t: number) {
		await openLastEpisode(page);
		await play(page);
		await streamReady(page);
		const video = page.locator('video');
		await video.evaluate((v: HTMLVideoElement, at: number) => {
			v.pause();
			v.currentTime = at;
		}, t);
		await expect(page.locator('.cells .pause')).toHaveAttribute('aria-label', 'Play');
		await expect(page.locator('.player')).toHaveClass(/chrome/);
		await page.locator('.cells .pause').focus();
		await page.keyboard.press('ArrowUp');
		await expect(page.locator('.scrubrow .track')).toBeFocused();
	}

	/**
	 * The tip as it is drawn, read in the page the moment it carries a frame:
	 * the tile lives as long as the flash (900 ms), which a loaded box can
	 * spend between two of Playwright's round trips.
	 */
	async function tipNow(page: import('@playwright/test').Page, at: string) {
		const h = await page.waitForFunction(
			(want) => {
				const track = document.querySelector('.scrubrow .track');
				const tip = track?.querySelector('.tip');
				const frame = tip?.querySelector('.frame');
				const time = tip?.querySelector('.at')?.textContent;
				if (!track || !tip || !frame || time !== want) return null;
				const t = track.getBoundingClientRect();
				const b = tip.getBoundingClientRect();
				const css = getComputedStyle(frame);
				return {
					position: css.backgroundPosition,
					image: css.backgroundImage,
					width: css.width,
					inside: b.left >= t.left - 1 && b.right <= t.right + 1,
					above: b.bottom <= t.top,
					focused: document.activeElement === track
				};
			},
			at,
			{ timeout: 10_000, polling: 25 }
		);
		return (await h.jsonValue())!;
	}

	test('← → show the tile for where they land above the time, inside the track, and it goes with the flash', async ({
		page
	}) => {
		await withSprite(page);
		await onTheBar(page, 0.5);
		const tip = page.locator('.scrubrow .track .tip');
		const video = page.locator('video');
		// Nothing over the bar before a key.
		await expect(tip).toHaveCount(0);

		// ← to the start: the first tile, above the time, kept inside the
		// track's left end, and the pad still on the bar.
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('.flash .by')).toHaveText('−10 S');
		let got = await tipNow(page, '0:00');
		expect(got.image).toMatch(/tv-sprite\.jpg/);
		expect(got).toMatchObject({
			position: '0px 0px',
			width: '160px',
			inside: true,
			above: true,
			focused: true
		});

		// The flash goes, and the tile with it: nothing hangs over the bar.
		await expect(page.locator('.flash')).toHaveCount(0);
		await expect(tip).toHaveCount(0);

		// A run of presses moves the tile with each: from 5 s, ← is 0 s, and →
		// straight after is the end (8 s), the last tile, kept inside the
		// track's right end. 5 s is past the opening, where SKIP INTRO would
		// take the pad (the browse world's episodes open at 1-3 s), and before
		// the ending's 6 s; the end last, since past it the episode is over.
		await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 5));
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(5);
		await expect(page.locator('.scrubrow .track')).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		expect((await tipNow(page, '0:00')).position).toBe('0px 0px');
		await page.keyboard.press('ArrowRight');
		got = await tipNow(page, '0:08');
		expect(got).toMatchObject({ position: '-480px 0px', inside: true, above: true });
	});

	/**
	 * Every server's qualities get one more, lower than any the fake engine
	 * offers (its streams are 360p), at an address of its own: the one a
	 * stream's seek preview reads (`previewQuality`, the lowest at or under
	 * 480p). It is last, so the picture still starts on the first. Every
	 * request for it is counted and then answered with the real clip, as the
	 * engine's loopback would answer it. A preview that started would ask for
	 * it, playlist or file, the moment it opened (c575).
	 */
	async function countedLowQuality(page: import('@playwright/test').Page): Promise<string[]> {
		const LOW = '/__preview/tv-low.webm';
		const asked: string[] = [];
		let clip = '';
		await page.route('**/api/anime/episode/*/videos**', async (route) => {
			const res = await route.fetch();
			const real = (await res.json()) as Answer;
			clip = String(real.servers.find((x) => x.n === 2)!.qualities[0].src);
			await route.fulfill({
				response: res,
				json: {
					...real,
					servers: real.servers.map((x) => ({
						...x,
						qualities: [...x.qualities, { ...x.qualities[0], label: '144p', height: 144, src: LOW }]
					}))
				}
			});
		});
		await page.route(`**${LOW}`, (route) => {
			asked.push(route.request().url());
			return route.continue({ url: new URL(clip, route.request().url()).href });
		});
		return asked;
	}

	test('a stream keeps the time alone: no tip over the bar', async ({ page }) => {
		const low = await countedLowQuality(page);
		await onTheBar(page, 0.5);
		// ← first (to the start), since → from here is the end, and past it the
		// episode is over.
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('.flash .by')).toHaveText('−10 S');
		await expect(page.locator('.flash')).toHaveCount(0);
		await expect(page.locator('.scrubrow .track')).toBeFocused();
		// Watched from inside the page while the move's flash is up: a retrying
		// toHaveCount(0) would pass the moment a tip that came had gone again.
		const watch = page.evaluate(
			() =>
				new Promise<{ flash: number; tip: number }>((done) => {
					const seen = { flash: 0, tip: 0 };
					const end = Date.now() + 1500;
					const tick = () => {
						if (document.querySelector('.flash')) seen.flash++;
						if (document.querySelector('.scrubrow .track .tip')) seen.tip++;
						if (Date.now() > end) done(seen);
						else setTimeout(tick, 10);
					};
					tick();
				})
		);
		await page.keyboard.press('ArrowRight');
		const seen = await watch;
		expect(seen.flash).toBeGreaterThan(0);
		expect(seen.tip).toBe(0);
		await expect(page.locator('.scrubrow .track .tip')).toHaveCount(0);
		// Until the → flash has gone: a preview is asked for 150 ms after a
		// stop (PREVIEW_DEBOUNCE_MS), well inside the flash's 900 ms, so by
		// then a started one has asked for its quality, for ← and → alike.
		// Until c575 this counted the document's <video>s, which a preview's
		// hidden picture is never one of, so it read 1 either way.
		await expect(page.locator('.flash')).toHaveCount(0);
		expect(low, 'a stream on a TV started a seek preview').toEqual([]);
	});
});

/**
 * c867 on a TV: a held → is the reader moving, not a stall. Tests/browse-player-stall.e2e.ts
 * is the whole account and the other devices; this is the same stream made to
 * buffer, on the remote's own door (the bar's slider keeps the key once it has it).
 */
test('a held → leaves the full 15 s after the release on a TV (c867)', async ({ page }) => {
	test.setTimeout(120_000);
	const KEPT = 36_000;
	let clip: string | null = null;
	await page.route(
		(u) => /\/api\/anime\/episode\/\d+\/videos/.test(u.pathname),
		async (route) => {
			const answer = await route.fetch();
			const list = await answer.json();
			const last = list.servers[list.servers.length - 1];
			const q = last.qualities[0];
			clip = new URL(q.src, page.url()).pathname;
			last.qualities = [
				{ ...q, label: '1080p', height: 1080, src: `${q.src}#1080` },
				{ ...q, label: '720p', height: 720, src: `${q.src}#720` }
			];
			await route.fulfill({ response: answer, json: { ...list, servers: [last] } });
		}
	);
	await page.route(
		(u) => u.pathname === clip,
		async (route) => {
			const from = Number(/bytes=(\d+)-/.exec(route.request().headers().range ?? '')?.[1] ?? 0);
			// Left hanging, not refused: a server that stopped sending.
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
	await page.addInitScript(() => {
		const w = window as unknown as { __seekings: number[]; __panels: number[]; __drop: number[] };
		w.__seekings = [];
		w.__panels = [];
		w.__drop = [];
		document.addEventListener('seeking', () => w.__seekings.push(performance.now()), true);
		setInterval(() => {
			if (document.querySelector('.panel.buffer')) w.__panels.push(performance.now());
			if (document.body?.textContent?.includes("COULDN'T KEEP UP"))
				w.__drop.push(performance.now());
		}, 100);
	});
	// The last episode: a clamped seek reaches the clip's end, where any other
	// episode's next-up card takes the focus and with it the remote's arrows.
	await openLastEpisode(page);
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && !v.paused && v.currentTime > 0.1;
		},
		undefined,
		{ timeout: 30_000 }
	);
	const end = Date.now() + 12_000;
	while (Date.now() < end) {
		await page.keyboard.down('ArrowRight');
		await page.waitForTimeout(100);
	}
	await page.keyboard.up('ArrowRight');
	const read = () =>
		page.evaluate(() => {
			const w = window as unknown as { __seekings: number[]; __panels: number[]; __drop: number[] };
			return { seekings: w.__seekings, panels: w.__panels, drop: w.__drop };
		});
	const held = await read();
	expect(held.seekings.length).toBeGreaterThan(30);
	const last = held.seekings[held.seekings.length - 1];
	expect(held.panels.filter((t) => t <= last)).toEqual([]);
	expect(held.drop.filter((t) => t <= last)).toEqual([]);
	await page.waitForFunction(
		() => (window as unknown as { __drop: number[] }).__drop.length > 0,
		undefined,
		{
			timeout: 25_000
		}
	);
	const after = await read();
	expect(after.drop[0] - last).toBeGreaterThanOrEqual(15_000);
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});
