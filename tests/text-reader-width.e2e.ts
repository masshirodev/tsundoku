import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DEFAULT_SETTINGS, TEXT_WIDTHS, frame, type TextWidth } from '../src/lib/reader/text';
import { sampleEpub } from '../src/lib/server/pages/sample-epub';
import { Zip } from '../src/lib/epub/unzip';

/**
 * WIDTH in the text reader's READING sheet (c437; doc/TEXT-READER.md,
 * "WIDTH"): each step draws the column the frame says, centred, in PAGED and
 * SCROLL, in landscape's two columns, R→L and vertical Japanese; the place
 * being read survives the relayout; the series keeps its width across a
 * reload; and another series opens at the device's last choice. Plain
 * `*.e2e.ts`, so it runs on all four device projects: the owner asked for it
 * to read on a PC, and the column, its floor and its columns differ on each
 * screen. Read-only: incognito, so no progress is written, and WIDTH lives in
 * the context's own browser storage. It reads Mushoku Tensei and Honzuki no
 * Gekokujou, neither of which any flow file groups away; the vertical case
 * serves a generated Japanese book in place of Mushoku Tensei's, as
 * text-reader-flow's Japanese case does.
 */

// 60 s: the series case opens three readers and reloads one, and at a load of
// 45 (four device projects beside four other slots) a library tile took past
// the default 30 s to answer its click in the first run.
test.describe.configure({ timeout: 60_000 });

/**
 * Type large enough that a seed chapter (fourteen paragraphs) runs past one
 * page at every width, and small enough that the 20 em floor (480 px) leaves
 * the steps room to narrow on a tablet and a PC: at 30 px the floor was 600,
 * the whole of a desktop's two columns, and every step drew 100%.
 */
const SETTINGS = { size: 24, line: 1.8 };

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
	await page.addInitScript((s) => {
		if (!localStorage.getItem('tsundoku.text.settings'))
			localStorage.setItem('tsundoku.text.settings', JSON.stringify(s));
	}, SETTINGS);
});

/** Open the series' first chapter from its own ▶, at its first character. */
async function open(page: Page, title: string): Promise<string> {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('link', { name: /^(?!GET).*(READ AGAIN|CONTINUE|START|▶)/ })
		.first()
		.click();
	await page.waitForURL(/\/read\/\d+/);
	const id = /\/read\/(\d+)/.exec(page.url())![1];
	await page.goto(`/read/${id}?at=0.0`);
	await ready(page);
	return id;
}

async function ready(page: Page) {
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('.flow')).toHaveCSS('font-size', '24px');
}

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Reading settings' });
const radio = (page: Page, name: string) =>
	sheet(page).getByRole('radiogroup', { name: 'Width' }).getByRole('radio', { name, exact: true });

async function openSheet(page: Page) {
	// The top margin: the controls, never a word.
	await page.mouse.click(page.viewportSize()!.width / 2, 30);
	await page.getByRole('button', { name: /^(PAGED|SCROLL|VERTICAL)\b/ }).click();
	await expect(sheet(page)).toBeVisible();
}
async function closeSheet(page: Page) {
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
	await expect(sheet(page)).toHaveCount(0);
}

/** Pick a WIDTH from READING, and wait for the flow to be laid out at it. */
async function pick(page: Page, width: TextWidth, vertical = false) {
	await openSheet(page);
	const name = TEXT_WIDTHS.find(([w]) => w === width)![1];
	await radio(page, name).click();
	await expect(radio(page, name)).toHaveAttribute('aria-checked', 'true');
	await closeSheet(page);
	const want = expected(page, width, vertical);
	await expect
		.poll(() => page.locator('.page').evaluate((el: HTMLElement) => Math.round(el.offsetWidth)))
		.toBe(want.w);
}

/** The frame the reader should draw at `width` on this screen. */
function expected(page: Page, width: TextWidth, vertical = false, columns = true) {
	const v = page.viewportSize()!;
	return frame(v.width, v.height, { ...DEFAULT_SETTINGS, ...SETTINGS, columns }, vertical, width);
}

/** The text column as drawn: the page box, the flow's column width, a paragraph's width. */
const drawn = (page: Page) =>
	page.locator('.flow').evaluate((el: HTMLElement) => {
		const box = el.parentElement!.getBoundingClientRect();
		const p = el.querySelector('.blocks p')!.getBoundingClientRect();
		return {
			left: Math.round(box.left),
			right: Math.round(innerWidth - box.right),
			w: Math.round(box.width),
			column: parseFloat(getComputedStyle(el).columnWidth),
			paragraph: Math.round(p.width),
			pages: Math.round((el.scrollWidth + parseFloat(getComputedStyle(el).columnGap)) / box.width)
		};
	});

/**
 * Whether the character the URL names (`?at=b.o`) is on the page now: the
 * place being read, after a relayout.
 */
const placeShown = (page: Page) =>
	page.evaluate(() => {
		const at = new URL(location.href).searchParams.get('at') ?? '';
		const [b, o] = at.split('.').map(Number);
		const block = document.querySelector(`.blocks [data-b="${b}"]`);
		if (!block) return `no block ${b}`;
		const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
		let left = o;
		for (let t = walk.nextNode(); t; t = walk.nextNode()) {
			const n = t.textContent?.length ?? 0;
			if (left < n) {
				const r = document.createRange();
				r.setStart(t, left);
				r.setEnd(t, left + 1);
				const c = r.getBoundingClientRect();
				const box = document.querySelector('.page')!.getBoundingClientRect();
				const x = c.left + c.width / 2;
				const y = c.top + c.height / 2;
				return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
					? 'shown'
					: `off the page at ${Math.round(x)},${Math.round(y)}`;
			}
			left -= n;
		}
		return `no character ${o} in block ${b}`;
	});

/**
 * Turn forward by a click on the edge that reads on (the right one, the left
 * in R→L) until the URL keeps a new place (800 ms after each turn). More than
 * one turn when it must: which chapter ▶ opens follows Mushoku Tensei's
 * progress in the shared seed, and a page that is an illustration alone has
 * no character, so the place, rightly, doesn't move with it.
 */
async function forward(page: Page, rtl = false) {
	const before = new URL(page.url()).searchParams.get('at');
	const v = page.viewportSize()!;
	// With the controls up a tap only puts them away: put them away first. The
	// mouse leaves the top edge, where it brought them up by hover (it opened
	// READING from the top margin), and Escape, the keyboard's toggle, is
	// pressed only while they show.
	await page.mouse.move(v.width / 2, v.height / 2);
	const bar = page.locator('.text-reader footer.bottom');
	await expect(async () => {
		if (await bar.count()) await page.keyboard.press('Escape');
		await expect(bar).toHaveCount(0, { timeout: 1_000 });
	}).toPass();
	await expect(async () => {
		await page.mouse.click(rtl ? 8 : v.width - 8, v.height / 2);
		await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
		await expect
			.poll(() => new URL(page.url()).searchParams.get('at'), { timeout: 2_500 })
			.not.toBe(before);
	}).toPass({ timeout: 15_000 });
}

test('each WIDTH draws its column, centred, and the place being read stays on the page', async ({
	page
}) => {
	await open(page, 'Mushoku Tensei');
	// Before any choice: 100%, the column every device drew before WIDTH.
	const today = expected(page, 100);
	const first = await drawn(page);
	expect(first.w).toBe(today.w);
	expect(first.left).toBe(today.x);
	await openSheet(page);
	await expect(radio(page, '100%')).toHaveAttribute('aria-checked', 'true');
	await closeSheet(page);
	// A page in, so the place is a character mid-chapter, not the start.
	await forward(page);
	expect(await placeShown(page)).toBe('shown');

	for (const [width] of TEXT_WIDTHS) {
		await pick(page, width);
		const want = expected(page, width);
		const got = await drawn(page);
		expect(got.w, `${width}: the column's box`).toBe(want.w);
		expect(got.left, `${width}: its left`).toBe(want.x);
		// Centred to the pixel.
		expect(Math.abs(got.left - got.right), `${width}: centred`).toBeLessThanOrEqual(1);
		// The text is set at the column's width: one column, or each of two.
		const col = want.cols > 1 ? (want.w - want.gap) / 2 : want.w;
		expect(got.column, `${width}: the flow's column`).toBeCloseTo(col, 0);
		expect(got.paragraph, `${width}: a paragraph's measure`).toBeLessThanOrEqual(Math.ceil(col));
		// Past the obvious size: the chapter runs past one page at every width.
		expect(got.pages, `${width}: pages`).toBeGreaterThan(1);
		// The relayout kept the character being read on the page (c516's rule).
		await expect.poll(() => placeShown(page), { message: `${width}: the place` }).toBe('shown');
	}
	// Never wider than 100%; and not a test of nothing: wherever 100% is wider
	// than the floor (every project but the phone), a step drew narrower.
	const widths = TEXT_WIDTHS.map(([width]) => expected(page, width).w);
	for (const w of widths) expect(w).toBeLessThanOrEqual(today.w);
	if (page.viewportSize()!.width >= 600) expect(Math.min(...widths)).toBeLessThan(today.w);
});

test('a series keeps its WIDTH across a reload, and another series opens at the device’s last', async ({
	page
}) => {
	await open(page, 'Mushoku Tensei');
	await pick(page, 65);
	await pick(page, 'page');
	await page.reload();
	await ready(page);
	await expect.poll(() => drawn(page).then((d) => d.w)).toBe(expected(page, 'page').w);
	await openSheet(page);
	await expect(radio(page, 'PAGE')).toHaveAttribute('aria-checked', 'true');
	await closeSheet(page);

	// A series never set: the device's last choice, PAGE.
	await open(page, 'Honzuki no Gekokujou');
	await expect.poll(() => drawn(page).then((d) => d.w)).toBe(expected(page, 'page').w);
	// Set to 80% there, which becomes the device's...
	await pick(page, 80);
	// ...while the first series keeps its own PAGE.
	await open(page, 'Mushoku Tensei');
	await expect.poll(() => drawn(page).then((d) => d.w)).toBe(expected(page, 'page').w);
	expect(
		await page.evaluate(() => [
			localStorage.getItem('tsundoku.text.width'),
			Object.keys(localStorage).filter((k) => k.startsWith('tsundoku.text.width.')).length
		])
	).toEqual(['80', 2]);
});

test('SCROLL, R→L and one column take the width too', async ({ page }) => {
	await open(page, 'Mushoku Tensei');
	await pick(page, 50);
	const want = expected(page, 50);

	// R→L: the columns mirror inside the same centred box.
	await openSheet(page);
	await sheet(page).getByRole('radio', { name: 'R→L' }).click();
	await closeSheet(page);
	await expect(page.locator('.flow')).toHaveClass(/rtl/);
	const got = await drawn(page);
	expect(got.w).toBe(want.w);
	expect(got.left).toBe(want.x);
	await forward(page, true);
	expect(await placeShown(page)).toBe('shown');

	// SCROLL: the column is the flow's padding inside a full-width scroller.
	await openSheet(page);
	await sheet(page).getByRole('radio', { name: 'SCROLL' }).click();
	await closeSheet(page);
	await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	const one = expected(page, 50, false, false);
	const scroll = () =>
		page.locator('.blocks:not(.next)').evaluate((el: HTMLElement) => {
			const pageEl = el.closest<HTMLElement>('.page')!;
			const r = el.getBoundingClientRect();
			return {
				left: Math.round(r.left - pageEl.getBoundingClientRect().left),
				w: Math.round(r.width),
				inner: pageEl.clientWidth
			};
		});
	await expect.poll(() => scroll().then((s) => s.left)).toBe(one.x);
	const s = await scroll();
	expect(s.w).toBe(s.inner - 2 * one.x);
	// A line no longer than the paged column a single column would have.
	expect(s.w).toBeLessThanOrEqual(one.w);
	expect(await placeShown(page)).toBe('shown');

	// One column in landscape (COLUMNS off): the step is of the screen, one column.
	await openSheet(page);
	await sheet(page).getByRole('radio', { name: 'PAGED' }).click();
	const columns = sheet(page).getByRole('switch').first();
	if (await columns.isEnabled()) {
		await columns.click();
		await closeSheet(page);
		await expect.poll(() => drawn(page).then((d) => d.column)).toBeCloseTo(one.w, 0);
		expect((await drawn(page)).left).toBe(one.x);
	} else await closeSheet(page);
});

/** A generated Japanese book in place of the series' own (text-reader-flow's `serveBook`). */
async function serveJapanese(page: Page) {
	const epub = sampleEpub({
		title: 'Mushoku Tensei',
		hue: 0,
		language: 'ja',
		// As many as the seed's book has, so whichever chapter ▶ opens is there.
		chapters: Array.from({ length: 40 }, (_, i) => `第${i + 1}話`)
	});
	const zip = new Zip(new Uint8Array(epub));
	const files = await Promise.all(
		zip.names.map(async (name) => ({ name, size: (await zip.bytesOf(name)).length }))
	);
	await page.route('**/api/series/*/epub/files?*', (r) => r.fulfill({ json: { files } }));
	await page.route('**/api/series/*/epub?*', (r) =>
		r.fulfill({ body: epub, contentType: 'application/epub+zip' })
	);
	await page.route('**/api/series/*/epub/file?*', async (r) => {
		const name = new URL(r.request().url()).searchParams.get('p') ?? '';
		if (!zip.has(name)) return r.fulfill({ status: 404, body: 'not found' });
		await r.fulfill({ body: Buffer.from(await zip.bytesOf(name)) });
	});
}

test.describe('vertical Japanese', () => {
	// The book is served by page.route, which the service worker would answer past.
	test.use({ serviceWorkers: 'block' });
	test('WIDTH is how wide the page of vertical lines is; a line keeps its length', async ({
		page
	}) => {
		await serveJapanese(page);
		await open(page, 'Mushoku Tensei');
		await expect(page.locator('.flow')).toHaveCSS('writing-mode', 'vertical-rl');
		const full = expected(page, 100, true);
		const height = () =>
			page.locator('.page').evaluate((el: HTMLElement) => Math.round(el.offsetHeight));
		expect(await height()).toBe(full.h);
		for (const width of [50, 'page'] as const) {
			await pick(page, width, true);
			const want = expected(page, width, true);
			const got = await drawn(page);
			expect(got.w, `${width}: the page's width`).toBe(want.w);
			expect(got.left, `${width}: its left`).toBe(want.x);
			// Its columns run down the page as before: a line is as long at every width.
			expect(await height()).toBe(full.h);
			expect(got.column).toBeCloseTo(full.h, 0);
		}
	});
});
