import { devices, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

/**
 * The player's minute step (c865, doc/ANIME.md "The player"): a press of +1m or
 * −1m moves 60 s, from a desktop's bar cell, a touch tablet's middle cluster and
 * a phone's portrait row, while ← → keep moving 10 s. On the browse server's
 * "Tsukiakari no Ryokōsha", whose fixture clip is 8 s: the standing clip is
 * lengthened to ten minutes here, or a 60 s jump and a 10 s one would both
 * reach the same end of the file and prove nothing. It runs in `browse`
 * because that is where the clip is served, and each case switches to the
 * device it is about.
 */

const CLIP = readFileSync('tests/fixtures/video/clip.webm');
/** Where the WebM's `Duration` (ID 0x4489, size 0x88) puts its 8-byte double. */
const DURATION = CLIP.indexOf(Buffer.from([0x44, 0x89, 0x88]));

/**
 * The 8 s clip claiming ten minutes. TimecodeScale is the Matroska default,
 * 1 ms, so the value is milliseconds: the player reads `duration` from the
 * file, exactly as it reads a real episode's, and a seek to 1:30 lands there.
 */
function longClip(): Buffer {
	if (DURATION < 0) throw new Error('clip.webm has no Duration element');
	const bytes = Buffer.from(CLIP);
	bytes.writeDoubleBE(600_000, DURATION + 3);
	return bytes;
}

/**
 * Serves the long clip in place of every working server's stream, and takes the
 * source's 1–3 s opening and 6–8 s ending out of the answer: at ten minutes they
 * would show SKIP and the next-episode card over the bar the case is pressing,
 * which is a different screen's state. The first server (the broken one) keeps
 * its own address, so the player still fails over as it always does. A data URL
 * is what makes the ten minutes seekable at all: a patched file over HTTP is
 * only as seekable as the bytes the server really has, and these stop at 8 s.
 */
async function longEpisode(page: Page): Promise<void> {
	const src = `data:video/webm;base64,${longClip().toString('base64')}`;
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

async function openEpisode(page: Page): Promise<void> {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: 'A Letter from Hollin' })
		.locator('.entry-btn')
		.click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	// Ten minutes, from the stand-in file: metadata read, so a seek isn't
	// clamped by the 8 s the file really holds.
	await page.waitForFunction(
		() => {
			const v = document.querySelector('video');
			return !!v && Number.isFinite(v.duration) && v.duration > 300;
		},
		undefined,
		{ timeout: 20_000 }
	);
}

/** Held still at [second], with the chrome up (a paused picture keeps it). */
async function pauseAt(page: Page, second: number): Promise<void> {
	await page.evaluate((s) => {
		const v = document.querySelector('video')!;
		v.pause();
		v.currentTime = s;
	}, second);
	await expect.poll(() => at(page)).toBeCloseTo(second, 1);
	await expect(page.locator('.player')).toHaveClass(/chrome/);
}

const at = (page: Page) => page.evaluate(() => document.querySelector('video')!.currentTime);

/** A press of [label] lands at [to], and → still moves 10 s in the same run. */
async function minuteLands(page: Page, label: string, from: number, to: number): Promise<void> {
	await pauseAt(page, from);
	await page.getByRole('button', { name: label, exact: true }).click();
	await expect.poll(() => at(page)).toBeCloseTo(to, 1);
	// ← → are the fine step and were not swept up by the minute (c865).
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => at(page)).toBeCloseTo(to - 10, 1);
}

test.describe('on a desktop', () => {
	test.use({
		viewport: { width: 1440, height: 900 },
		userAgent: devices['Desktop Chrome'].userAgent,
		hasTouch: false,
		isMobile: false,
		deviceScaleFactor: 1,
		serviceWorkers: 'block'
	});

	test('the bar has +1m and −1m beside ▶❚❚, and they move a minute', async ({ page }) => {
		test.setTimeout(60_000);
		await longEpisode(page);
		await openEpisode(page);
		const cells = page.locator('.bottom .cells > :visible');
		await expect(cells.nth(0)).toHaveAttribute('aria-label', /Pause|Play/);
		await expect(cells.nth(1)).toHaveText('−1m');
		await expect(cells.nth(2)).toHaveText('+1m');

		await minuteLands(page, 'On a minute', 30, 90);
		await pauseAt(page, 30);
		await page.getByRole('button', { name: 'Back a minute', exact: true }).click();
		await expect.poll(() => at(page)).toBeCloseTo(0, 1);
	});
});

test.describe('on a touch tablet', () => {
	test.use({
		viewport: { width: 1280, height: 800 },
		userAgent: devices['Galaxy Tab S4 landscape'].userAgent,
		hasTouch: true,
		isMobile: true,
		serviceWorkers: 'block'
	});

	test('the middle cluster has +1m and −1m, and they move a minute', async ({ page }) => {
		test.setTimeout(60_000);
		await longEpisode(page);
		await openEpisode(page);
		const cluster = page.locator('.cluster');
		await expect(cluster).toBeVisible();
		await expect(cluster.locator('button')).toHaveCount(5);
		await expect(cluster.locator('button').first()).toHaveText('−1m');

		const plus = cluster.getByRole('button', { name: 'On a minute' });
		const box = (await plus.boundingBox())!;
		await pauseAt(page, 30);
		await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
		await expect.poll(() => at(page)).toBeCloseTo(90, 1);
		// ← still moves 10 s on the same run.
		await page.keyboard.press('ArrowLeft');
		await expect.poll(() => at(page)).toBeCloseTo(80, 1);
	});
});

for (const width of [390, 360]) {
	test.describe(`on a phone in portrait, ${width}px wide`, () => {
		test.use({
			viewport: { width, height: 844 },
			hasTouch: true,
			isMobile: true,
			serviceWorkers: 'block'
		});

		test('the row has +1m and −1m, and with subtitles on no label wraps', async ({ page }) => {
			test.setTimeout(60_000);
			await longEpisode(page);
			await openEpisode(page);
			// Anime is watched with subtitles on, and the handoff draws the
			// stream cell as 'EN · 720P' (Index Player.dc.html:288): the row has
			// to fit that state, not the bare quality it reads with subs off.
			// The stream cell opens the playback sheet; EN is the fixture's one
			// track, picked there as a person picks it.
			await page.locator('.pcells .small').click();
			const sheet = page.getByRole('dialog', { name: 'Playback settings' });
			await expect(sheet).toBeVisible();
			await sheet.locator('.langs[data-which="subs"] [data-lang="EN"]').click();
			await sheet.getByRole('button', { name: 'Close', exact: true }).click();
			const cells = page.locator('.pcells');
			await expect(cells).toBeVisible();
			await expect(cells.locator('.small')).toContainText('EN');
			// The six cells share one row: every label is inside its own cell,
			// and no cell's text runs under the next border.
			const fit = await cells.evaluate((row) =>
				[...row.querySelectorAll('button')].map((b) => ({
					name: b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '',
					// 1 px of subpixel rounding on a mono face is not an overlap.
					over: b.scrollWidth > b.clientWidth + 1
				}))
			);
			expect(fit.map((f) => f.name).slice(0, 2)).toEqual(['Back a minute', 'Back 10 seconds']);
			expect(fit[2].name).toMatch(/Pause|Play/);
			expect(fit.map((f) => f.name).slice(3, 5)).toEqual(['On 10 seconds', 'On a minute']);
			// The stream's own cell keeps a label of its own in the last column.
			expect(fit[5].name).not.toBe('');
			expect(fit.filter((f) => f.over)).toEqual([]);
			// Wrapped text never makes scrollWidth exceed clientWidth, so the
			// overlap check above cannot see it: a Range over the cell's text
			// gives one rect per line box, and 60 px of cell holds one line.
			const stream = await cells.evaluate((row) => {
				const cell = row.querySelector('button.small')!;
				const range = document.createRange();
				range.selectNodeContents(cell);
				const box = cell.getBoundingClientRect();
				const text = range.getBoundingClientRect();
				return {
					text: cell.textContent?.trim() ?? '',
					width: box.width,
					height: box.height,
					textHeight: text.height,
					lines: range.getClientRects().length
				};
			});
			expect(stream.lines, JSON.stringify(stream)).toBe(1);

			const plus = cells.getByRole('button', { name: 'On a minute' });
			const box = (await plus.boundingBox())!;
			await pauseAt(page, 30);
			await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
			await expect.poll(() => at(page)).toBeCloseTo(90, 1);
			await page.keyboard.press('ArrowLeft');
			await expect.poll(() => at(page)).toBeCloseTo(80, 1);
		});
	});
}
