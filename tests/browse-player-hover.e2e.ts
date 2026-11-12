import { test, expect } from './fixtures';
import { devices, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hydrated } from './helpers/hydration';

/**
 * Hovering the picture never tints it, and clicking it never flashes it
 * (c485; doc/ANIME.md, "The player"; doc/MOTION.md, "Hovering"). The tap zone
 * over the picture is a `<button>`, so the hover rule in motion.css tinted it
 * until it said `data-press="off"`; the visible controls (the cluster, the
 * scrubber, the bar's cells) keep their tint, and one of them is asserted
 * here so the fix cannot be "no tint anywhere". It runs in the `browse`
 * project because that is where the fixture's clip is served
 * (tests/browse-setup.ts), and switches to a desktop, because hover only
 * exists on a fine pointer and `browse` is a touch tablet.
 */

test.use({
	viewport: { width: 1280, height: 800 },
	userAgent: devices['Desktop Chrome'].userAgent,
	hasTouch: false,
	isMobile: false,
	deviceScaleFactor: 1,
	serviceWorkers: 'block'
});

/** Type `/incognito` in search, the app's own door (doc/PRIVACY.md). */
async function incognito(page: Page) {
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/incognito');
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
}

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
			const v = document.querySelector('video');
			return !!v && Number.isFinite(v.duration) && v.duration > 0;
		},
		undefined,
		{ timeout: 20_000 }
	);
	// Playing until it is under way, as browse-player-cluster's c429 case does:
	// the fake's first server stops as the clip starts and its notice sets the
	// cluster aside; playback on the second clears it. Then held still, which
	// keeps the chrome (and the cluster) up.
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video')!;
			return !v.paused && v.currentTime > 0.5;
		},
		undefined,
		{ timeout: 20_000 }
	);
	await page.evaluate(() => document.querySelector('video')!.pause());
	await expect(page.locator('.player')).toHaveClass(/chrome/);
}

const tint = (page: Page, selector: string) =>
	page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundImage);

/** A point on the picture that is the tap zone itself, clear of every control over it. */
async function bareSpot(page: Page): Promise<{ x: number; y: number }> {
	return page.locator('.tapzone').evaluate((zone) => {
		const r = zone.getBoundingClientRect();
		// Walk a grid over the middle band of the picture for a point whose top
		// element is the tap zone: the cluster sits in the very middle.
		for (const fy of [0.5, 0.4, 0.6, 0.35, 0.65])
			for (const fx of [0.2, 0.8, 0.3, 0.7, 0.1, 0.9]) {
				const x = r.left + r.width * fx;
				const y = r.top + r.height * fy;
				if (document.elementFromPoint(x, y) === zone) return { x, y };
			}
		throw new Error('no point of the picture is the bare tap zone');
	});
}

test('hovering the picture leaves it untinted, and a visible control still tints (c485)', async ({
	page
}) => {
	test.setTimeout(60_000);
	await openEpisode(page);
	// The rule only exists under a real pointer: without it this case proves nothing.
	expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(
		true
	);

	// The cluster's play/pause keeps its hover: the fix is the tap zone's, not
	// the rule's. First, while the picture is paused and the chrome is up.
	await page.locator('.cluster .pp').hover();
	await expect.poll(() => tint(page, '.cluster .pp')).toContain('linear-gradient');

	const spot = await bareSpot(page);
	await page.mouse.move(spot.x, spot.y);
	expect(await page.locator('.tapzone').evaluate((el) => el.matches(':hover'))).toBe(true);
	expect(await tint(page, '.tapzone')).toBe('none');

	// A click on the picture is a tap, not a press of a button: nothing flashes.
	// A guard only, which passes with or without data-press="off": press.ts
	// (SURFACE_SHARE) already refuses a press on anything larger than 25 % of
	// the viewport, and the tap zone is the whole picture. The hover assertion
	// above is the one that falsifies c485's fix.
	await page.mouse.down();
	expect(await page.locator('.tapzone').getAttribute('data-pressed')).toBeNull();
	await page.mouse.up();
});

/**
 * c713: the player's own key. SETTINGS says what the player does on a device
 * that never touched it, an OFF already stored on the readers' key is carried
 * once, and after that the two are apart: RESET does not bring the old OFF
 * back, and the readers' key no longer moves the player. Through SETTINGS' own
 * row. A context of its own each, because the keys are this browser's storage.
 */
test.describe('the player’s CURSOR has its own key (c713)', () => {
	const SHARED = 'tsundoku.reader.cursor';
	const OWN = 'tsundoku:anime:cursor';
	const local = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
	const setLocal = (page: Page, key: string, value: string) =>
		page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value]);
	const row = (page: Page, id: string) => page.locator(`[data-row="${id}"]`);
	const pressed = (page: Page, id: string) => row(page, id).locator('button[aria-pressed="true"]');

	async function settings(page: Page) {
		await page.goto('/settings');
		await hydrated(page);
		await expect(row(page, 'player-cursor')).toBeVisible();
	}

	/** Open the episode, let the controls go, and read the cursor over the picture. */
	async function cursorWhilePlaying(page: Page) {
		await openEpisode(page);
		const player = page.locator('.player');
		await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).play());
		await expect(player).not.toHaveClass(/chrome/, { timeout: 15_000 });
		// The class goes on the same render as `chrome`, so this reads the settled value.
		return player.evaluate((el) => getComputedStyle(el).cursor);
	}

	test('a device that never touched either: SETTINGS says what each one does, and the player hides it', async ({
		page
	}) => {
		test.setTimeout(90_000);
		await incognito(page);
		await settings(page);
		await expect(pressed(page, 'cursor')).toHaveText('OFF');
		await expect(pressed(page, 'player-cursor')).toHaveText('ON');
		// The readers' row writes the key the readers read.
		await row(page, 'cursor').getByRole('button', { name: 'ON', exact: true }).click();
		await expect.poll(() => local(page, SHARED)).toBe('true');
		expect(await cursorWhilePlaying(page)).toBe('none');
	});

	test('an OFF stored on the readers’ key is carried once, and RESET does not bring it back', async ({
		page
	}) => {
		test.setTimeout(120_000);
		await incognito(page);
		await setLocal(page, SHARED, 'false');
		expect(await cursorWhilePlaying(page)).toBe('auto');
		expect(await local(page, OWN)).toBe('false');
		// SETTINGS now says what the player did.
		await settings(page);
		await expect(pressed(page, 'player-cursor')).toHaveText('OFF');
		// ON is the default, so the page stores nothing: the key is removed.
		await row(page, 'player-cursor').getByRole('button', { name: 'ON', exact: true }).click();
		await expect.poll(() => local(page, OWN)).toBeNull();
		expect(await local(page, SHARED)).toBe('false');
		// The readers' OFF is still stored, and must not be read a second time.
		expect(await cursorWhilePlaying(page)).toBe('none');
	});

	test('after the carry, the readers’ key does not move the player, and the player’s row does', async ({
		page
	}) => {
		test.setTimeout(120_000);
		await incognito(page);
		// Nothing stored: the carry is a no-op, and the player's default holds.
		expect(await cursorWhilePlaying(page)).toBe('none');
		await setLocal(page, SHARED, 'false');
		expect(await cursorWhilePlaying(page)).toBe('none');
		await settings(page);
		await expect(pressed(page, 'player-cursor')).toHaveText('ON');
		await row(page, 'player-cursor').getByRole('button', { name: 'OFF', exact: true }).click();
		await expect.poll(() => local(page, OWN)).toBe('false');
		// And the reverse: the player's row left the readers' key alone.
		expect(await local(page, SHARED)).toBe('false');
		expect(await cursorWhilePlaying(page)).toBe('auto');
	});
});

/**
 * c678: the player's cursor follows its controls. The player's CURSOR defaults
 * to on (c713, a key of its own), so no row is touched here; the
 * player has no timer of its own, and the cursor goes exactly when the controls
 * go during playback (`HIDE_MOUSE_MS` after the last move) and comes back with
 * them: a move, a key, a pause. Incognito, so nothing is logged.
 */
test('the cursor goes with the controls during playback and comes back with them (c678)', async ({
	page
}) => {
	test.setTimeout(90_000);
	await incognito(page);
	await openEpisode(page);
	const player = page.locator('.player');
	const cursor = () => player.evaluate((el) => getComputedStyle(el).cursor);
	// Playing: the controls go by themselves, and the cursor with them.
	await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).play());
	await expect(player).not.toHaveClass(/chrome/, { timeout: 15_000 });
	await expect.poll(cursor).toBe('none');
	// A move brings both back, at once.
	await page.mouse.move(300, 200);
	await page.mouse.move(700, 400);
	await expect(player).toHaveClass(/chrome/);
	await expect.poll(cursor).toBe('auto');
	// Paused, the controls stay and so does the cursor.
	await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause());
	await page.waitForTimeout(2500);
	await expect(player).toHaveClass(/chrome/);
	expect(await cursor()).toBe('auto');
	// Playing again: it hides with the controls, and a sheet over the picture
	// keeps both up.
	await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).play());
	await expect(player).not.toHaveClass(/chrome/, { timeout: 15_000 });
	await expect.poll(cursor).toBe('none');
	await page.mouse.move(300, 200);
	await page.mouse.move(700, 400);
	await page.locator('.cells .cell.grow').click();
	const sheet = page.getByRole('dialog', { name: 'Playback settings' });
	await expect(sheet).toBeVisible();
	await page.waitForTimeout(2500);
	expect(await cursor()).toBe('auto');
	// The KEYS dialog keeps both up too (round 2). Close the settings sheet,
	// let playback carry on, then press `?` and keep the mouse still past
	// HIDE_MOUSE_MS: the bar stays because the dialog is open, so the cursor
	// must stay over the dialog and its ✕.
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(player).not.toHaveClass(/chrome/, { timeout: 15_000 });
	await page.keyboard.press('Shift+Slash');
	const keys = page.getByRole('dialog', { name: 'Keys' });
	await expect(keys).toBeVisible();
	await page.waitForTimeout(2500);
	await expect(keys).toBeVisible();
	expect(await cursor()).toBe('auto');
	await expect(player).toHaveClass(/chrome/);
	await keys.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(keys).toBeHidden();
});

/**
 * c680: the player's half of "a reader opened incognito sends nothing". Every
 * writer goes through `send`, which returns on `data.incognito` taken at open,
 * so END pressed from another tab cannot turn its `open`, a `page` or the
 * close on the way out into saved reading. The browse world is where an anime
 * exists (the shared seed has none); its database is this run's one, and the
 * anime's events are counted before and after.
 */
test('an episode watched incognito posts nothing, even when END is pressed elsewhere (c680)', async ({
	page,
	context
}) => {
	test.setTimeout(90_000);
	const dbPath = () => {
		const dir = process.env.TMPDIR!;
		const file = readdirSync(dir).find((f) => /^tsundoku-e2e-browse-.*\.sqlite$/.test(f));
		if (!file) throw new Error(`no browse database in ${dir}`);
		return join(dir, file);
	};
	const events = () => {
		const db = new Database(dbPath(), { readonly: true });
		const { id } = db
			.prepare(`SELECT id FROM series WHERE title = 'Tsukiakari no Ryokōsha'`)
			.get() as { id: number };
		const { n } = db
			.prepare('SELECT COUNT(*) AS n FROM reading_events WHERE series_id = ?')
			.get(id) as { n: number };
		db.close();
		return n;
	};
	const before = events();
	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().endsWith('/api/reading')) posts.push(r.postData() ?? '');
	});
	await incognito(page);
	await openEpisode(page);
	await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).play());
	// Long enough for the open and a page report to have been due.
	await page.waitForTimeout(3000);
	// END in the band, pressed from another tab, then the player taken away by
	// hand, whose pagehide sends its close.
	const other = await context.newPage();
	await other.goto('/');
	await other.getByRole('button', { name: 'END' }).click();
	await expect(other.getByText('INCOGNITO · NOTHING SAVED')).toHaveCount(0);
	await other.close();
	await page.goto('/');
	await page.waitForTimeout(1000);
	expect(posts).toEqual([]);
	expect(events()).toBe(before);
});
