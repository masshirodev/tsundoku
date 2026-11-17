import { type Page } from '@playwright/test';
import { expect, readerReady, test } from './helpers/hydrated';

/**
 * The Japanese layer end to end (doc/JAPANESE.md), on the seed's OCR text:
 * Drawing's chapters up to the one in progress carry the design's three
 * bubbles on every page. Serial, tablet-portrait only. The reader runs
 * incognito, so Drawing's progress -- offline-flow's -- is never written;
 * the words screen gets its lookup from the API instead. NOT TEXT is undone.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru';

async function command(page: Page, text: string) {
	await page.goto('/search');
	await page.getByRole('searchbox').fill(text);
	await page.keyboard.press('Enter');
}

async function series(page: Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	const id = Number(page.url().match(/\/series\/(\d+)/)![1]);
	const href = await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.getAttribute('href');
	return { id, entry: Number(href!.match(/\/read\/(\d+)/)![1]) };
}

/** Where the page is drawn: the box letterboxes it whenever the shapes differ. */
const drawn = (page: Page) =>
	page.locator('.screen:not([aria-hidden]) img').evaluate((img: HTMLImageElement) => {
		const r = img.getBoundingClientRect();
		const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
		const width = img.naturalWidth * s;
		const height = img.naturalHeight * s;
		return {
			x: r.x + (r.width - width) / 2,
			y: r.y + (r.height - height) / 2,
			width,
			height
		};
	});

/** Tap the middle of a seeded block (fractions of the page) with a finger. */
async function tapBlock(page: Page, box: [number, number, number, number]) {
	const r = await drawn(page);
	await page.touchscreen.tap(
		r.x + (box[0] + box[2] / 2) * r.width,
		r.y + (box[1] + box[3] / 2) * r.height
	);
}
const FIRST: [number, number, number, number] = [0.68, 0.06, 0.2, 0.1];
const SECOND: [number, number, number, number] = [0.12, 0.28, 0.2, 0.12];
const THIRD: [number, number, number, number] = [0.58, 0.72, 0.22, 0.11];

const panel = (page: Page) => page.getByRole('region', { name: 'Lookup' });

test('blocks are outlined with the controls, and a tap on one looks it up', async ({ page }) => {
	const { entry } = await series(page);
	await command(page, '/incognito');
	await page.waitForURL(/\/$/);
	await page.goto(`/read/${entry}?p=1`);
	await readerReady(page);
	await expect(page.locator('img[alt="Page 1"]')).toBeVisible();

	// The controls up: every block outlined. Down: none.
	const vp = page.viewportSize()!;
	await page.touchscreen.tap(vp.width / 2, vp.height / 2);
	await expect(page.getByRole('banner', { name: 'Reader' })).toBeVisible();
	await expect(page.locator('.ring')).toHaveCount(3);
	// Over the text, not over the box: the box is letterboxed here.
	const d = await drawn(page);
	const ring = (await page.locator('.ring').first().boundingBox())!;
	expect(Math.abs(ring.x - (d.x + FIRST[0] * d.width))).toBeLessThan(2);
	expect(Math.abs(ring.y - (d.y + FIRST[1] * d.height))).toBeLessThan(2);
	expect(Math.abs(ring.height - FIRST[3] * d.height)).toBeLessThan(2);
	await page.touchscreen.tap(vp.width / 2, vp.height / 2);
	await expect(page.locator('.ring')).toHaveCount(0);

	// A block: the panel, headed with where it is, its words tappable.
	await tapBlock(page, FIRST);
	await expect(panel(page)).toBeVisible();
	await expect(panel(page)).toContainText('LOOKUP · P. 1 · BLOCK 1');
	await expect(page.locator('.ring.selected')).toHaveCount(1);
	const words = panel(page).locator('.words button');
	await expect(words.first()).toBeVisible({ timeout: 15000 });
	await expect(words.first()).toHaveAttribute('aria-pressed', 'true');
	await words.nth(1).click();
	await expect(words.nth(1)).toHaveAttribute('aria-pressed', 'true');
	// Incognito: looked up, never logged.
	await expect(panel(page)).toContainText('NOT LOGGED · NO CANDIDATES');

	// Another block moves the panel (the third is under it: the panel rises
	// from the bottom for a block in the top half); anywhere else closes it,
	// and the controls stay down.
	await tapBlock(page, SECOND);
	await expect(panel(page)).toContainText('BLOCK 2');
	await page.touchscreen.tap(vp.width / 2, vp.height / 2);
	await expect(panel(page)).toHaveCount(0);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
});

test('NOT TEXT takes a block out, UNDO puts it back, and so does RESTORE later', async ({
	page
}) => {
	const { id: seriesOf, entry } = await series(page);
	await command(page, '/incognito');
	await page.waitForURL(/\/$/);
	await page.goto(`/read/${entry}?p=2`);
	await readerReady(page);
	await expect(page.locator('img[alt="Page 2"]')).toBeVisible();

	await tapBlock(page, THIRD);
	await panel(page).getByRole('button', { name: 'NOT TEXT' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'NOT TEXT' })).toContainText(
		'BLOCK 3 · NOT TEXT · NO LONGER TAPPABLE'
	);
	// Gone on the workstation too (the band shows before it answers).
	const blocksOnPage2 = async () => {
		const r = await page.request.get(`/api/entries/${entry}/text`);
		return ((await r.json()) as { pages: unknown[][] }).pages[1].length;
	};
	await expect.poll(blocksOnPage2).toBe(2);

	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'NOT TEXT' })).toHaveCount(0);
	await expect.poll(blocksOnPage2).toBe(3);
	await tapBlock(page, THIRD);
	await expect(panel(page)).toContainText('BLOCK 3');

	// Marked again, and the band tapped away: the series screen restores it.
	await panel(page).getByRole('button', { name: 'NOT TEXT' }).click();
	await expect.poll(blocksOnPage2).toBe(2);
	const vp = page.viewportSize()!;
	await page.touchscreen.tap(vp.width / 2, vp.height / 2);
	await expect(page.getByRole('status').filter({ hasText: 'NOT TEXT' })).toHaveCount(0);
	await page.goto(`/series/${seriesOf}`);
	await expect(page.getByText('1 MARKED NOT TEXT')).toBeVisible();
	await page.getByRole('button', { name: 'RESTORE' }).click();
	await expect(page.getByText('1 MARKED NOT TEXT')).toHaveCount(0);
	await expect.poll(blocksOnPage2).toBe(3);
});

test('BLOCKS in READING outlines them always, or never', async ({ page }) => {
	const { entry } = await series(page);
	await command(page, '/incognito');
	await page.waitForURL(/\/$/);
	await page.goto(`/read/${entry}?p=1`);
	await readerReady(page);
	await expect(page.locator('img[alt="Page 1"]')).toBeVisible();
	const vp = page.viewportSize()!;
	await page.touchscreen.tap(vp.width / 2, vp.height / 2);
	await page.getByRole('button', { name: /FIT/ }).click();
	await page.getByRole('radio', { name: 'NEVER' }).click();
	await page.keyboard.press('Escape');
	await expect(page.locator('.ring')).toHaveCount(0);
	await page.getByRole('button', { name: /FIT/ }).click();
	await page.getByRole('radio', { name: 'ALWAYS' }).click();
	await page.keyboard.press('Escape');
	await page.touchscreen.tap(vp.width / 2, vp.height / 2);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	await expect(page.locator('.ring')).toHaveCount(3);
	// Back to the default, for whoever reads next on this device.
	await page.evaluate(() => localStorage.removeItem('tsundoku.reader.blocks'));
});

test('a word looked up waits in /words until approved; unset Kumiko keeps it', async ({ page }) => {
	const { id } = await series(page);
	const logged = await page.request.post('/api/lookups', {
		data: {
			seriesId: id,
			entryId: null,
			place: 'P. 14',
			lemma: '東門',
			surface: '東門',
			reading: 'ひがしもん',
			pos: '名詞',
			sentence: '明後日の十時に、東門へ。',
			at: Date.now()
		}
	});
	expect(((await logged.json()) as { logged: boolean }).logged).toBe(true);

	await command(page, '/words');
	await page.waitForURL(/\/words$/);
	const row = page.locator('.row', { hasText: '東門' });
	await expect(row).toBeVisible();
	await expect(row).toContainText('DRAWING: SAIKYOU MANGAKA');
	await expect(page.getByRole('button', { name: /SEND TO KUMIKO/ })).toBeDisabled();

	await row.getByRole('button', { name: 'Approve 東門' }).click();
	await expect(page.getByRole('button', { name: /SEND \d+ TO KUMIKO/ })).toBeEnabled();
	await page.getByRole('button', { name: /SEND \d+ TO KUMIKO/ }).click();
	// The suite has no Kumiko: the approval is kept, and says why.
	await expect(page.getByText("KUMIKO ISN'T SET UP")).toBeVisible();
	await expect(row.getByRole('button', { name: 'Approve 東門' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	// The series screen counts it.
	await page.goto(`/series/${id}`);
	await expect(page.locator('.row', { hasText: 'WORDS' })).toContainText('TO REVIEW');
	await expect(page.locator('.row', { hasText: 'OCR' }).first()).toContainText('OF 58 CHAPTERS');
});
