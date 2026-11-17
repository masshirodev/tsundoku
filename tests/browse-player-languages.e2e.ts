import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { langName, trackCodes } from '../src/lib/library/streams';

/**
 * The settings sheet's AUDIO and SUBTITLES rows with many languages (c386,
 * doc/ANIME.md "The settings sheet"): the owner's VidStreaming episode offered
 * a few dozen subtitles, which a segmented row printed over each other. On the
 * browse server's "Tsukiakari no Ryokōsha", whose source offers one English
 * track; the episode's answer is widened in the browser to 11 audio and 30
 * subtitle languages, labelled as the workstation labels them (trackCodes,
 * langName), so the sheet draws what a source like that gives it.
 */

const AUDIO = [
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
const SUBS = [
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
	// A second English, as a source lists full subtitles beside signs and
	// songs: trackCodes makes it EN-2, a code of its own.
	'English (Full)'
];

/** The episode's streams, with every quality offering AUDIO and SUBS. */
async function manyLanguages(page: Page): Promise<void> {
	await page.route('**/api/anime/episode/*/videos**', async (route) => {
		const response = await route.fetch();
		const body = (await response.json()) as {
			servers: {
				qualities: { audio: unknown[]; subtitles: { lang: string; src: string }[] }[];
			}[];
		};
		const vtt = body.servers
			.flatMap((s) => s.qualities)
			.flatMap((q) => q.subtitles)
			.find((t) => t.lang === 'EN')?.src;
		const audioCodes = trackCodes(AUDIO);
		const subCodes = trackCodes(SUBS);
		for (const q of body.servers.flatMap((s) => s.qualities)) {
			// The clip is a file, not HLS: its audio is never switched, only chosen.
			q.audio = AUDIO.map((n, i) => ({
				lang: audioCodes[i],
				name: langName(n),
				src: `/api/anime/media/fake-audio-${i}`
			}));
			q.subtitles = SUBS.map((n, i) => ({
				lang: subCodes[i],
				name: langName(n),
				src: `${vtt}?n=${i}`
			}));
		}
		await route.fulfill({ response, json: body });
	});
}

/** No two cells overlap, each is at least a tap, and no code is cut short. */
async function cellsFit(cells: Locator, tap = 44): Promise<void> {
	const boxes = await cells.evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect();
			return {
				text: el.textContent?.trim() ?? '',
				x: r.x,
				y: r.y,
				w: r.width,
				h: r.height,
				clipped: el.scrollWidth > el.clientWidth
			};
		})
	);
	expect(boxes.length).toBeGreaterThan(0);
	const small = boxes.filter((b) => b.w < tap || b.h < tap).map((b) => `${b.text} ${b.w}x${b.h}`);
	expect(small).toEqual([]);
	expect(boxes.filter((b) => b.clipped).map((b) => b.text)).toEqual([]);
	const overlaps: string[] = [];
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i];
			const b = boxes[j];
			// Neighbours share a hairline at most; anything more is printing over.
			const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
			const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
			if (dx > 1 && dy > 1) overlaps.push(`${a.text} / ${b.text}`);
		}
	expect(overlaps).toEqual([]);
}

async function openEpisode(page: Page, title: RegExp | string) {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	const row =
		typeof title === 'string'
			? page.getByRole('region', { name: 'Episodes' }).locator('.entry', { hasText: title })
			: page
					.getByRole('region', { name: 'Episodes' })
					.locator('.entry')
					.filter({ has: page.locator('.num', { hasText: title }) });
	await row.locator('.entry-btn').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	const player = page.locator('.player');
	// Server 1 always fails first; the sheet is opened on server 2, which plays.
	await expect(player.locator('.cells .grow')).toContainText('360P', { timeout: 20_000 });
	await expect(player.locator('.cells .grow')).toContainText('SUBS', { timeout: 20_000 });
	return player;
}

async function openSheet(page: Page) {
	const player = page.locator('.player');
	await page.mouse.move(120, 120);
	await page.mouse.move(640, 300 + Math.random() * 10);
	await player.locator('.cells .grow').click();
	const sheet = page.getByRole('dialog', { name: 'Playback settings' });
	await expect(sheet).toBeVisible();
	return sheet;
}

test.describe('the settings sheet with many languages, tablet landscape', () => {
	// The service worker answers a page it controls itself, past page.route,
	// and the second episode's answer would come back unwidened.
	test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });

	test('AUDIO wraps, SUBTITLES shows what matters with MORE, and a pick from MORE is remembered', async ({
		page
	}) => {
		test.setTimeout(120_000);
		await manyLanguages(page);
		await openEpisode(page, 'A Letter from Hollin');
		const back = await page.locator('a[href*="/series/"]').first().getAttribute('href');
		const seriesId = Number(/\/series\/(\d+)/.exec(back!)![1]);
		try {
			let sheet = await openSheet(page);
			await expect(sheet).toHaveCSS('width', '520px');

			// AUDIO: eleven languages, all of them, wrapped onto lines of equal cells.
			const audio = sheet.getByRole('group', { name: 'Audio' }).getByRole('button');
			await expect(audio).toHaveText(trackCodes(AUDIO));
			await cellsFit(audio);
			const tops = new Set(
				await audio.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)))
			);
			expect(tops.size).toBeGreaterThan(1);
			// Each cell is the code; its title and accessible name are the name in full.
			const hu = sheet.getByRole('group', { name: 'Audio' }).getByRole('button', {
				name: 'Hungarian',
				exact: true
			});
			await expect(hu).toHaveText('HU');
			await expect(hu).toHaveAttribute('title', 'Hungarian');
			await expect(
				sheet
					.getByRole('group', { name: 'Audio' })
					.getByRole('button', { name: 'Spanish (Latin America)' })
			).toHaveText('ES-419');

			// SUBTITLES: thirty is past the twelve a row shows, so OFF, what is on
			// (English, the device's language) and MORE · 29.
			const subs = sheet.getByRole('group', { name: 'Subtitles' }).getByRole('button');
			await expect(subs).toHaveText(['OFF', 'EN', 'MORE · 29']);
			await cellsFit(subs);
			// The S M L row is untouched.
			await expect(
				sheet.locator('.srow2', { hasText: 'SUBTITLES' }).locator('.seg button')
			).toHaveText(['S', 'M', 'L']);

			// MORE opens the whole list in the sheet, one language a line, in full.
			await sheet.getByRole('button', { name: 'MORE · 29' }).click();
			await expect(sheet.getByRole('button', { name: 'MORE · 29' })).toHaveAttribute(
				'aria-expanded',
				'true'
			);
			const list = sheet
				.getByRole('group', { name: 'Every subtitle language' })
				.getByRole('button');
			await expect(list).toHaveCount(30);
			await expect(list.nth(3)).toContainText('CHINESE (TRADITIONAL)');
			await expect(list.nth(3)).toContainText('ZH-HANT');
			await cellsFit(list);
			// Picking from it closes it; the pick is a cell of the row, on. A code
			// with a variant, which the workstation must keep as it is.
			const kept = page.waitForResponse(
				(r) => r.url().includes(`/api/anime/series/${seriesId}/choice`) && r.ok()
			);
			await list.filter({ hasText: 'CHINESE (TRADITIONAL)' }).click();
			expect(await (await kept).json()).toEqual({ kept: true });
			await expect(list).toHaveCount(0);
			await expect(subs).toHaveText(['OFF', 'EN', 'ZH-HANT', 'MORE · 28']);
			await expect(sheet.getByRole('button', { name: 'Chinese (Traditional)' })).toHaveClass(/on/);
			await sheet.getByRole('button', { name: 'Close' }).click();
			await expect(page.locator('.player .cells .grow')).toContainText('ZH-HANT SUBS');

			// It carries to the next episode, as a choice in the sheet always has.
			await openEpisode(page, /^10$/);
			await expect(page.locator('.player .cells .grow')).toContainText('ZH-HANT SUBS');
			sheet = await openSheet(page);
			await expect(sheet.getByRole('group', { name: 'Subtitles' }).getByRole('button')).toHaveText([
				'OFF',
				'EN',
				'ZH-HANT',
				'MORE · 28'
			]);
			await expect(sheet.getByRole('button', { name: 'Chinese (Traditional)' })).toHaveClass(/on/);

			// The second English, from MORE (review finding 1): the
			// track that is on is its own cell, on and focused, and the next
			// episode starts on it, not on the first English.
			await sheet.getByRole('button', { name: /^MORE · / }).click();
			await list.filter({ hasText: 'EN-2' }).click();
			await expect(list).toHaveCount(0);
			const en2 = sheet.locator('.langs[data-which="subs"] [data-lang="EN-2"]');
			await expect(en2).toBeVisible();
			await expect(en2).toHaveClass(/on/);
			await expect(en2).toBeFocused();
			await expect(sheet.locator('.langs[data-which="subs"] .on')).toHaveCount(1);
			await sheet.getByRole('button', { name: 'Close' }).click();
			await expect(page.locator('.player .cells .grow')).toContainText('EN-2 SUBS');
			await openEpisode(page, 'A Letter from Hollin');
			await expect(page.locator('.player .cells .grow')).toContainText('EN-2 SUBS');
			sheet = await openSheet(page);
			await expect(sheet.getByRole('group', { name: 'Subtitles' }).getByRole('button')).toHaveText([
				'OFF',
				'EN',
				'EN-2',
				'MORE · 28'
			]);
			await expect(sheet.locator('.langs[data-which="subs"] [data-lang="EN-2"]')).toHaveClass(/on/);
		} finally {
			// The series and every other anime start in English again, as the
			// other specs on this server expect.
			const put = await page.request.post(`/api/anime/series/${seriesId}/choice`, {
				data: { what: 'subs', v: 'EN' }
			});
			expect(put.ok()).toBe(true);
		}
	});
});
