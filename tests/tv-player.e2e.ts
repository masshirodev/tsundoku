import { expect, test } from './helpers/hydrated';

/**
 * The player on a TV (c235; TV-Player, TV-Board-Player): the picture until a
 * key, then all six cells on one row with the scrubber above, the settings as a
 * 420px panel, and the media keys a remote sends.
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

/** A browser that won't start a video by itself is started by the bar, as a remote would. */
async function play(page: import('@playwright/test').Page): Promise<void> {
	const video = page.locator('video');
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused), { timeout: 5000 })
		.toBe(false)
		.catch(async () => {
			await page.keyboard.press('ArrowUp');
			await page.locator('.cells .pause').focus();
			await page.keyboard.press('Enter');
		});
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

/** A remote's media key. Playwright has no name for most of them. */
async function mediaKey(page: import('@playwright/test').Page, key: string): Promise<void> {
	await page.evaluate(
		(k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })),
		key
	);
}

test('six cells on one row, and the first arrow lands on ▶❚❚', async ({ page }) => {
	await openEpisode(page);
	await play(page);

	// 6B: the bar's own six cells, in the design's order, on one row. (The
	// eighth and seventh are the desktop's volume and ? KEYS, not drawn here.)
	await expect(bar(page)).toHaveCount(6);
	await expect(bar(page).nth(0)).toHaveAttribute('aria-label', /Pause|Play/);
	await expect(bar(page).nth(1)).toHaveText('−10');
	await expect(bar(page).nth(2)).toHaveText('+10');
	await expect(bar(page).nth(3)).toContainText('← EP. 10');
	// The one cell that names the stream and opens the settings.
	await expect(bar(page).nth(4)).toContainText('SUBS');
	await expect(bar(page).nth(5)).toContainText('EP. 12 →');
	// The first three are 76px, as TV-Focus draws the same bar.
	for (const i of [0, 1, 2]) expect((await bar(page).nth(i).boundingBox())!.width).toBe(76);
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

test('the media keys a remote sends: ▶❚❚, ⏩ and ⏪', async ({ page }) => {
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
	// The fixture clip is 8s, so a ±10s key reaches its end: rewinding first
	// keeps both moves inside the clip and off the END card.
	await video.evaluate((v: HTMLVideoElement) => {
		v.pause();
		v.currentTime = 3;
	});
	await mediaKey(page, 'MediaRewind');
	await expect.poll(at).toBeLessThan(1);
	await expect(page.locator('.flash .by')).toHaveText('−10 S');
	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 0));
	await mediaKey(page, 'MediaFastForward');
	await expect.poll(at).toBeGreaterThan(5);
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

/** Part 2: with the bar hidden, ← → seek and the bar comes with the keys on it. */
test('← → with the bar hidden seek and put focus on the seek bar', async ({ page }) => {
	await openLastEpisode(page);
	await play(page);
	await streamReady(page);
	const track = page.locator('.scrubrow .track');
	const video = page.locator('video');
	const at = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);

	await video.evaluate((v: HTMLVideoElement) => {
		v.pause();
		v.currentTime = 1;
	});
	// The player has taken the pause in (its ▶❚❚ reads Play), which shows the
	// bar: under a loaded suite the pause event landed after Escape and drew
	// the bar again over the hidden one (c336, c439).
	await expect(page.locator('.cells .pause')).toHaveAttribute('aria-label', 'Play');
	// Escape hides the bar; the paused picture leaves it hidden.
	await page.keyboard.press('Escape');
	await expect(page.locator('.player')).not.toHaveClass(/chrome/);

	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.player')).toHaveClass(/chrome/);
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

	// Playing with the bar down: the card appears over the picture.
	await page.keyboard.press('Escape');
	await expect(page.locator('.player')).not.toHaveClass(/chrome/);
	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 6.2));
	await expect(page.locator('.endcard')).toBeVisible();
	await expect(playNow).toBeFocused();

	// ↓ brings the bar, with the pad on the seek bar.
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('.player')).toHaveClass(/chrome/);
	await expect(track).toBeFocused();

	// The 4 s go by with the card still up: focus comes back to the offer
	// rather than staying on a cell that is no longer a stop.
	await page.waitForTimeout(4500);
	await expect(page.locator('.player')).not.toHaveClass(/chrome/);
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
	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 1.2));
	await expect(skip).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.locator('.player')).not.toHaveClass(/chrome/);

	// The alone window ends while the opening still runs: SKIP goes with the
	// bar, and nothing is left focused on it.
	await page.waitForTimeout(8500);
	await expect(skip).toHaveCount(0);
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
