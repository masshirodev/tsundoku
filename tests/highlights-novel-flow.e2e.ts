import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIResponse, Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';
import { startPreview } from './highlights-preview';
import { Zip } from '../src/lib/epub/unzip';
import { sampleEpub } from '../src/lib/server/pages/sample-epub';

/**
 * Highlights H2 end to end (card c702; doc/HIGHLIGHTS.md, "Quotes"; Novel N1
 * to N8, D1, D2): the text reader's selection, its handles and bar, the
 * marker, the open highlight's sheet, a chapter that changed under a quote,
 * the keyboard, and the doors a rule has to hold at.
 *
 * It keeps quotes, so it seeds the seed into a database of its own and serves
 * the same build on a port the OS gives it (the `highlights-flow`
 * arrangement); nothing else sees what it writes. A `*-flow.e2e.ts`, so it
 * runs once, in tablet-portrait, where a press is a finger; the mouse's
 * cases are a describe with `hasTouch: false`, where the pointer is fine.
 */
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const scratch = join(tmpdir(), `tsundoku-e2e-highlights-novel-${process.pid}`);
const dbPath = join(scratch, 'library.sqlite');
let server: ChildProcess | null = null;

test.use({ baseURL: base, serviceWorkers: 'block' });

test.beforeAll(async () => {
	test.setTimeout(120_000);
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	server = await startPreview(
		() =>
			spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
				env: {
					...process.env,
					DATABASE_PATH: dbPath,
					TSUNDOKU_TOKEN: E2E_TOKEN,
					TSUNDOKU_ANILIST: 'off',
					LIBRARY_ROOT: join(scratch, 'library'),
					TRASH_DIR: join(scratch, 'trash'),
					TSUNDOKU_HOME: join(scratch, 'home')
				},
				stdio: 'ignore'
			}),
		base,
		'the novel highlights preview'
	);
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(scratch, { recursive: true, force: true });
});

const db = () => new Database(dbPath);
type Row = Record<string, unknown>;
/** Quotes of an entry, oldest first. */
const quotesOf = (entry: number): Row[] => {
	const d = db();
	try {
		return d
			.prepare(
				`SELECT * FROM highlights WHERE kind = 'quote' AND entry_id = ? AND deleted_at IS NULL ORDER BY id`
			)
			.all(entry) as Row[];
	} finally {
		d.close();
	}
};
const clearQuotes = () => {
	const d = db();
	try {
		d.prepare(`DELETE FROM highlights WHERE kind = 'quote'`).run();
	} finally {
		d.close();
	}
};

/**
 * A quote's row as a POST that reached the workstation once already made it: a
 * press whose answer was lost keeps its item on the device while the row is
 * here. The same span is what makes the door answer the repeat with this row
 * (`src/lib/server/highlights/quotes.ts`, the `same` branch), never a second.
 */
function seedQuote(entry: number, body: Record<string, unknown>, colour: string) {
	const d = db();
	try {
		const s = d.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(entry) as {
			series_id: number;
		};
		d.prepare(
			`INSERT INTO highlights (kind, series_id, entry_id, block, block_offset, end_block, end_offset,
				series_title, series_kind, quote, paragraph, context, colour, note, made_at)
			VALUES ('quote', ?, ?, ?, ?, ?, ?, '', 'novel', ?, ?, ?, ?, '', ?)`
		).run(
			s.series_id,
			entry,
			body.block,
			body.offset,
			body.endBlock,
			body.endOffset,
			String(body.quote ?? ''),
			String(body.paragraph ?? ''),
			String(body.context ?? ''),
			colour,
			Date.now()
		);
	} finally {
		d.close();
	}
}

/** A chapter of the seed's Mushoku Tensei, by its position; a novel nothing else here writes. */
function chapterId(n = 1): number {
	const d = db();
	try {
		const r = d
			.prepare(
				`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.title = 'Mushoku Tensei' AND e.matter = '' ORDER BY e.position LIMIT 1 OFFSET ?`
			)
			.get(n - 1) as { id: number } | undefined;
		if (!r) throw new Error('no such chapter in the seed');
		return r.id;
	} finally {
		d.close();
	}
}

async function open(page: Page, id: number) {
	// The seed's first block is a cover, alone on its page.
	await page.goto(`/read/${id}?at=2.0`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	// A press only counts once the reader has hydrated and laid the chapter out.
	await expect(page.locator('.flow')).toHaveCSS('column-gap', /px/);
	await page.waitForFunction(() => document.fonts.status === 'loaded');
}

/** The middle of the `n`th word of the chapter's first paragraphs, on screen. */
async function word(page: Page, n: number) {
	return page.evaluate((nth) => {
		const blocks = [...document.querySelectorAll<HTMLElement>('.blocks [data-b]')];
		const seen: { x: number; y: number; word: string; block: number }[] = [];
		const page = document.querySelector('.page')!.getBoundingClientRect();
		for (const b of blocks) {
			const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
			for (let t = walk.nextNode(); t; t = walk.nextNode()) {
				const text = t.textContent ?? '';
				for (const m of text.matchAll(/\p{L}{3,}/gu)) {
					const r = document.createRange();
					r.setStart(t, m.index);
					r.setEnd(t, m.index + m[0].length);
					const c = r.getClientRects()[0];
					if (!c) continue;
					const cx = c.left + c.width / 2;
					const cy = c.top + c.height / 2;
					if (cx < page.left || cx > page.right || cy < page.top || cy > page.bottom) continue;
					seen.push({ x: cx, y: cy, word: m[0], block: Number(b.dataset.b) });
					if (seen.length > nth) return seen[nth];
				}
			}
		}
		throw new Error(`no word ${nth} on this page: ${seen.length}`);
	}, n);
}

/**
 * A long press where a mouse can stand in for a finger (the rule reads time, not
 * the pointer). The release waits for the app's own answer — the bar over a
 * selection, or the lookup a Japanese book opens — rather than for a fixed hold:
 * the reader's timer is 450 ms, and a release a fixed 550 ms later is a tap on a
 * busy main thread, which clears the very selection it was meant to keep (R8 and
 * `R2 a joining press refused` failed that way). The cap only keeps a press that
 * is answered by nothing from hanging.
 */
async function longPress(page: Page, x: number, y: number) {
	await page.mouse.move(x, y);
	// A selection left up by an earlier step is not this press's answer. Every one
	// of its spans: a selection over several words is painted in several.
	await page.evaluate(() =>
		document.querySelectorAll('.sel').forEach((s) => s.setAttribute('data-before', '1'))
	);
	await page.mouse.down();
	await page
		.waitForFunction(
			() =>
				!!document.querySelector('.sel:not([data-before])') ||
				!!document.querySelector('[aria-label="Lookup"]'),
			null,
			{ timeout: 3_000 }
		)
		.catch(() => undefined);
	await page.mouse.up();
}

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' });

test.beforeEach(() => clearQuotes());

test('a finger: a real touch long press selects, and a real touch tap clears', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	const w = await word(page, 3);
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: 'touchStart' | 'touchEnd', x: number, y: number) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: type === 'touchEnd' ? [] : [{ x, y }]
		});
	await touch('touchStart', w.x, w.y);
	await page.waitForTimeout(600);
	await touch('touchEnd', w.x, w.y);
	await expect(page.locator('.sel')).toHaveText(w.word);
	await expect(bar(page)).toBeVisible();
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	// A quick tap elsewhere only clears; a tap in the strip would have turned without one.
	const v = page.viewportSize()!;
	await touch('touchStart', v.width / 2, v.height - 90);
	await touch('touchEnd', v.width / 2, v.height - 90);
	await expect(page.locator('.sel')).toHaveCount(0);
	expect(quotesOf(id)).toHaveLength(0);
});

test('N1: a long press selects the word and brings up the bar over it', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	const w = await word(page, 3);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await expect(page.locator('.sel')).toHaveText(w.word);
	await expect(page.locator('.hd')).toHaveCount(2);
	// Taken by the press, not by a tap: the page didn't turn and no chrome rose.
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	const box = await bar(page).boundingBox();
	const line = await page.locator('.sel').boundingBox();
	expect(box!.y + box!.height).toBeLessThanOrEqual(line!.y + 1);
	// LOOK UP is the bar's fourth cell wherever the book's language has a pack
	// (c198): the panel opens from the selection, not from the press itself.
	await expect(bar(page).getByRole('button')).toHaveText(['HIGHLIGHT', 'NOTE', 'COPY', 'LOOK UP']);
});

/** The selection's words, as the page shows them. */
const selected = (page: Page) =>
	page
		.locator('.sel')
		.allInnerTexts()
		.then((t) => t.join(''));

test('N2: the end handle extends the selection, and the start handle pulls it back', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const a = await word(page, 2);
	const b = await word(page, 6);
	await longPress(page, a.x, a.y);
	await expect(bar(page)).toBeVisible();
	const end = page.locator('.hd.end');
	const box = (await end.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x, b.y, { steps: 6 });
	await page.mouse.up();
	const text = await selected(page);
	expect(text).toContain(a.word);
	expect(text.length).toBeGreaterThan(a.word.length);
	// The bar stands over the first line selected.
	const line = await page.locator('.sel').first().boundingBox();
	const barBox = await bar(page).boundingBox();
	expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(line!.y + 1);

	// The start handle dragged past the end: the two ends swap, nothing breaks.
	const start = (await page.locator('.hd.start').boundingBox())!;
	const c = await word(page, 8);
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(c.x, c.y, { steps: 6 });
	await page.mouse.up();
	const swapped = await selected(page);
	expect(swapped.length).toBeGreaterThan(0);
	expect(swapped).not.toContain(a.word);
});

test('a tap only clears; a swipe turns the page and clears', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	const a = await word(page, 2);
	await longPress(page, a.x, a.y);
	await expect(bar(page)).toBeVisible();
	const before = await page.locator('.bottom').count();
	const tx = await page.locator('.flow').evaluate((el: HTMLElement) => el.style.transform);
	// A tap in the middle, away from the selection, only clears it.
	const v = page.viewportSize()!;
	await page.mouse.click(v.width / 2, v.height - 90);
	await expect(page.locator('.sel')).toHaveCount(0);
	await expect(bar(page)).toHaveCount(0);
	expect(await page.locator('.bottom').count()).toBe(before);
	expect(await page.locator('.flow').evaluate((el: HTMLElement) => el.style.transform)).toBe(tx);

	await longPress(page, a.x, a.y);
	await expect(bar(page)).toBeVisible();
	await page.mouse.move(v.width * 0.7, v.height * 0.8);
	await page.mouse.down();
	await page.mouse.move(v.width * 0.3, v.height * 0.8, { steps: 8 });
	await page.mouse.up();
	await expect(page.locator('.sel')).toHaveCount(0);
	await expect
		.poll(() => page.locator('.flow').evaluate((el: HTMLElement) => el.style.transform))
		.not.toBe(tx);
});

test('COPY copies the words and says so; a marker is drawn by HIGHLIGHT, and kept', async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const id = chapterId();
	await open(page, id);
	const a = await word(page, 2);
	await longPress(page, a.x, a.y);
	await bar(page).getByRole('button', { name: 'COPY' }).click();
	await expect(bar(page).getByRole('button', { name: '✓ COPIED' })).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(a.word);

	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(bar(page)).toHaveCount(0);
	await expect(page.locator('.mk')).toHaveText(a.word);
	await expect.poll(() => quotesOf(id).length).toBe(1);
	expect(quotesOf(id)[0]).toMatchObject({ quote: a.word, state: 'ok', colour: 'yellow' });

	// A reload draws it from the record, on the same word.
	await open(page, id);
	await expect(page.locator('.mk')).toHaveText(a.word);
});

test.describe('a mouse', () => {
	test.use({ hasTouch: false, isMobile: false });

	test('D1: a drag selects, the keys are on the bar, H keeps and nothing turned', async ({
		page
	}) => {
		const id = chapterId();
		await open(page, id);
		expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
		const tx = await page.locator('.flow').evaluate((el: HTMLElement) => el.style.transform);
		const a = await word(page, 1);
		const b = await word(page, 4);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 8 });
		// The bar waits for the release.
		await expect(bar(page)).toHaveCount(0);
		await page.mouse.up();
		await expect(bar(page)).toBeVisible();
		expect(await page.locator('.flow').evaluate((el: HTMLElement) => el.style.transform)).toBe(tx);
		// H, N and L: LOOK UP is on the bar for a book whose language has a pack.
		await expect(bar(page).locator('.key')).toHaveText(['H', 'N', 'L']);
		const text = await selected(page);
		await page.keyboard.press('h');
		await expect(page.locator('.mk').first()).toBeVisible();
		await expect.poll(() => quotesOf(id).length).toBe(1);
		// Each block is a line of the quote.
		expect(String(quotesOf(id)[0].quote).replace(/\n/g, '')).toBe(text.trim());
		// A letter with nothing selected does nothing, and an arrow still turns.
		await page.keyboard.press('h');
		await page.waitForTimeout(150);
		expect(quotesOf(id)).toHaveLength(1);
	});

	test("D1: a drag off the words still turns; at the page's end it waits 0.6 s and carries on", async ({
		page
	}) => {
		const id = chapterId();
		await open(page, id);
		const count = await page.locator('.flow').evaluate((el: HTMLElement) => {
			const step =
				el.parentElement!.clientWidth + parseFloat(getComputedStyle(el).columnGap || '0');
			return Math.round(
				(el.scrollWidth + parseFloat(getComputedStyle(el).columnGap || '0')) / step
			);
		});
		expect(count).toBeGreaterThan(1);
		const a = await word(page, 12);
		const v = page.viewportSize()!;
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(v.width - 6, v.height / 2, { steps: 8 });
		await expect(page.getByText('HOLD TO TURN →')).toBeVisible();
		const before = await page.locator('.flow').evaluate((el: HTMLElement) => el.style.transform);
		// Not yet: it waits its 0.6 s.
		await page.waitForTimeout(200);
		expect(await page.locator('.flow').evaluate((el: HTMLElement) => el.style.transform)).toBe(
			before
		);
		await expect
			.poll(() => page.locator('.flow').evaluate((el: HTMLElement) => el.style.transform))
			.not.toBe(before);
		await page.mouse.up();
		// The selection carried across: its last piece is on the page now on screen.
		await expect
			.poll(() =>
				page
					.locator('.sel')
					.last()
					.evaluate((el) => {
						const r = el.getBoundingClientRect();
						const box = document.querySelector('.page')!.getBoundingClientRect();
						return r.right > box.left && r.left < box.right;
					})
			)
			.toBe(true);
		await expect(bar(page)).toBeVisible();
	});
	test('a selection overlapping a highlight joins it: at H and N too', async ({ page }) => {
		const id = chapterId();
		await open(page, id);
		const a = await keepWord(page, id, 2);
		await page.locator('.mk').first().click();
		await sheet(page).getByLabel('NOTE').fill('older');
		await expect.poll(() => quotesOf(id)[0]?.note).toBe('older');
		await page.keyboard.press('Escape');
		const first = quotesOf(id)[0].id;
		const b = await word(page, 4);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 6 });
		await page.mouse.up();
		await page.keyboard.press('n');
		await expect(sheet(page)).toBeVisible();
		await expect.poll(() => quotesOf(id).length).toBe(1);
		await expect.poll(() => quotesOf(id)[0]?.id).toBe(first);
		await expect(sheet(page).getByLabel('NOTE')).toHaveValue('older');
	});
});

test('a chapter ends a selection: no cue at the last page, and no marker on a crossing', async ({
	page
}) => {
	const id = chapterId();
	await page.goto(`/read/${id}?p=last`);
	await expect(page.locator('.blocks p').first()).toBeAttached({ timeout: 15_000 });
	await page.waitForFunction(() => document.fonts.status === 'loaded');
	const a = await word(page, 1);
	const v = page.viewportSize()!;
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.waitForTimeout(550);
	await page.mouse.up();
	await expect(bar(page)).toBeVisible();
	const end = (await page.locator('.hd.end').boundingBox())!;
	await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
	await page.mouse.down();
	await page.mouse.move(v.width - 8, v.height - 8, { steps: 6 });
	await page.waitForTimeout(800);
	await expect(page.getByText('HOLD TO TURN →')).toHaveCount(0);
	await page.mouse.up();
});

/**
 * A marker the workstation has answered for. Until then its `data-h` is the press's own
 * negative id, and the answer repaints it: a read landing on the old one finds it detached,
 * whose computed style is '' (measured, Chromium).
 */
const SETTLED = '.mk:not([data-h^="-"])';

/** Press a word, keep it and wait for its row: the app's own door. */
async function keepWord(page: Page, id: number, n: number) {
	const w = await word(page, n);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	const had = quotesOf(id).length;
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => quotesOf(id).length).toBeGreaterThan(had);
	await expect(page.locator(SETTLED, { hasText: w.word })).toBeVisible();
	return w;
}
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Highlight' });

test('the marker: lower two-thirds, full ink, and it moves no word', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	const before = await page.locator('.flow').evaluate((el) => el.scrollWidth);
	const w = await word(page, 2);
	const place = await page.evaluate(
		([x, y]) => {
			const r = document.caretRangeFromPoint(x, y)!;
			return r.startContainer.textContent;
		},
		[w.x, w.y]
	);
	expect(place).toBeTruthy();
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	const mark = page.locator('.mk').first();
	await expect(mark).toHaveText(w.word);
	// The answer has settled, so the marker it redraws isn't replaced under the reads below.
	await expect.poll(() => quotesOf(id).length).toBe(1);
	await expect(page.locator(SETTLED)).toHaveText(w.word);
	// Not the accent, not a whole-line tint: an inset band at the foot, in ink.
	await expect(mark).toHaveCSS('box-shadow', /inset/);
	await expect(mark).toHaveCSS('padding-left', '1px');
	await expect(mark).toHaveCSS('margin-left', '-1px');
	const color = await mark.evaluate((el) => getComputedStyle(el).color);
	expect(color).not.toBe(await page.locator('.flow').evaluate((el) => getComputedStyle(el).color));
	// The stroke is drawn, and nothing moved: no reflow, no extra page.
	expect(await page.locator('.flow').evaluate((el) => el.scrollWidth)).toBe(before);
	const after = await page.locator('.mk').first().boundingBox();
	expect(Math.abs(after!.x + after!.width / 2 - w.x)).toBeLessThan(4);
});

test('Novel 02: three colours, DARK and PAPER, and DIM over the marker too', async ({ page }) => {
	const id = chapterId();
	await page.addInitScript(() => {
		const k = 'tsundoku.text.settings';
		const s = JSON.parse(localStorage.getItem(k) ?? '{}');
		localStorage.setItem(k, JSON.stringify({ ...s, theme: 'paper' }));
		localStorage.setItem('tsundoku.reader.dim', '0.3');
	});
	await open(page, id);
	await keepWord(page, id, 2);
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'Blue' }).click();
	await expect(page.locator('.mk').first()).toHaveClass(/\bblue\b/);
	await expect.poll(() => quotesOf(id)[0]?.colour).toBe('blue');
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
	await expect(sheet(page)).toHaveCount(0);
	// The dim layer lies over it, as everything else on the page.
	await expect(page.locator('.dim')).toBeAttached();
	const on = await page
		.locator('.mk')
		.first()
		.evaluate((el) => {
			const r = el.getBoundingClientRect();
			const stack = document.elementsFromPoint(r.left + 3, r.top + r.height / 2);
			return { dim: stack.findIndex((e) => e.classList.contains('dim')), mk: stack.indexOf(el) };
		});
	expect(on.mk).toBeGreaterThanOrEqual(0);
	// `.dim` lets the press through, so it isn't hit: its z-index says it lies over the page.
	await expect(page.locator('.dim')).toHaveCSS('z-index', '50');
	expect(await page.locator('.text-reader').evaluate((el) => el.classList.contains('paper'))).toBe(
		true
	);
	expect(
		await page
			.locator('.text-reader')
			.evaluate((el) => getComputedStyle(el).getPropertyValue('--mk-y').trim())
	).toMatch(/^oklch\(90%/);
});

test('a tap on the words opens the sheet; colour, NOTE, its cell and COPY', async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const id = chapterId();
	await open(page, id);
	const w = await keepWord(page, id, 2);
	await page.locator('.mk').first().click();
	await expect(sheet(page)).toBeVisible();
	await expect(sheet(page)).toContainText(/HIGHLIGHT · CH\. \d+ · ¶ \d+/);
	await expect(sheet(page).locator('.quote')).toHaveText(w.word);
	await expect(sheet(page).locator('.lbl').first()).toHaveText('YELLOW');
	await sheet(page).getByRole('button', { name: 'Orange' }).click();
	await expect.poll(() => quotesOf(id)[0]?.colour).toBe('orange');
	await expect(sheet(page).locator('.lbl').first()).toHaveText('ORANGE');
	// The note saves as it's typed, and the cell comes up after the last word.
	const before = await page.locator('.blocks').evaluate((el) => el.textContent);
	await sheet(page).getByLabel('NOTE').fill('a line of mine');
	await expect.poll(() => quotesOf(id)[0]?.note).toBe('a line of mine');
	await expect(page.locator('.nm')).toHaveCount(1);
	// The cell adds no character: a place counted before it is the same after.
	expect(await page.locator('.blocks').evaluate((el) => el.textContent)).toBe(before);
	await sheet(page).getByRole('button', { name: 'COPY' }).click();
	await expect(sheet(page).getByRole('button', { name: '✓ COPIED' })).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(w.word);
	// Colour chosen is the next HIGHLIGHT's, on this device.
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
	await page.locator('.nm').first().click();
	await expect(sheet(page).getByLabel('NOTE')).toHaveValue('a line of mine');
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
	await keepWord(page, id, 9);
	await expect.poll(() => quotesOf(id).at(-1)?.colour).toBe('orange');
});

test('DELETE is at once, with UNDO, and its note comes back with it', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	await keepWord(page, id, 2);
	await page.locator('.mk').first().click();
	await sheet(page).getByLabel('NOTE').fill('kept');
	await expect.poll(() => quotesOf(id)[0]?.note).toBe('kept');
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(sheet(page)).toHaveCount(0);
	await expect(page.locator('.mk')).toHaveCount(0);
	const band = page.getByRole('status').filter({ hasText: 'HIGHLIGHT DELETED' });
	await expect(band).toBeVisible();
	await expect.poll(() => quotesOf(id).length).toBe(0);
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect.poll(() => quotesOf(id)[0]?.note).toBe('kept');
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('NOTE keeps it and opens the sheet on the note, the answer arriving under it', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const a = await word(page, 3);
	await longPress(page, a.x, a.y);
	await page.route('**/api/highlights/quotes', async (r) => {
		// The answer is late: the sheet is up on a highlight with no row yet.
		await new Promise((s) => setTimeout(s, 500));
		await r.continue();
	});
	await bar(page).getByRole('button', { name: 'NOTE' }).click();
	await expect(sheet(page)).toBeVisible();
	await expect(sheet(page).getByLabel('NOTE')).toBeFocused();
	await page.keyboard.type('written while it was on its way');
	await expect.poll(() => quotesOf(id)[0]?.note).toBe('written while it was on its way');
	await page.keyboard.press('Escape');
	await page.unroute('**/api/highlights/quotes');
});

test('a selection overlapping a highlight joins it, the older note kept: at the bar', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const a = await keepWord(page, id, 2);
	await page.locator('.mk').first().click();
	await sheet(page).getByLabel('NOTE').fill('the older');
	await expect.poll(() => quotesOf(id)[0]?.note).toBe('the older');
	await page.keyboard.press('Escape');
	const first = quotesOf(id)[0].id;
	// Press a word inside it, and drag the end handle on: an overlap.
	const b = await word(page, 3);
	await longPress(page, a.x, a.y);
	await expect(bar(page)).toBeVisible();
	const end = (await page.locator('.hd.end').boundingBox())!;
	await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + 2, b.y, { steps: 6 });
	await page.mouse.up();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => quotesOf(id)[0]?.quote).toMatch(new RegExp(`^${a.word}.*`));
	await expect.poll(() => quotesOf(id).length).toBe(1);
	const row = quotesOf(id)[0];
	expect(row.id).toBe(first);
	expect(row.note).toBe('the older');
	expect(String(row.quote).length).toBeGreaterThan(a.word.length);
	await expect(page.locator('.mk')).toHaveCount(1);
});

test('its words changed: DETACHED, drawn nowhere, and told; the words back, found again', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const a = await keepWord(page, id, 2);
	const row = quotesOf(id)[0];
	// The chapter is changed by the words a real re-download changes, not by the row's
	// numbers: `quote_before` as if the text before it had been edited.
	const d = db();
	d.prepare(`UPDATE highlights SET quote_before = 'not any longer' WHERE id = ?`).run(row.id);
	d.close();
	await open(page, id);
	await expect.poll(() => quotesOf(id)[0]?.state).toBe('detached');
	await expect(page.locator('.mk')).toHaveCount(0);
	// The words are back: the next open finds them, and says so.
	const e = db();
	e.prepare(`UPDATE highlights SET quote_before = ? WHERE id = ?`).run(row.quote_before, row.id);
	e.close();
	await open(page, id);
	await expect.poll(() => quotesOf(id)[0]?.state).toBe('ok');
	await expect(page.locator('.mk')).toHaveText(a.word);
	// A place moved, words found once: re-anchored, and written.
	const f = db();
	f.prepare(`UPDATE highlights SET block = 9, block_offset = 3 WHERE id = ?`).run(row.id);
	f.close();
	await open(page, id);
	await expect.poll(() => quotesOf(id)[0]?.block).toBe(row.block);
	await expect(page.locator('.mk')).toHaveText(a.word);
});

test('incognito: no HIGHLIGHT or NOTE, one INCOGNITO cell, a highlight still opens', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	await keepWord(page, id, 2);
	const puts: string[] = [];
	await page.context().addCookies([{ name: 'tsundoku_incognito', value: '1', url: base }]);
	page.on('request', (r) => {
		if (r.url().includes('/api/highlights/quotes') && r.method() === 'PUT') puts.push(r.url());
	});
	await open(page, id);
	await expect(page.locator('.mk')).toHaveCount(1);
	const b = await word(page, 6);
	await longPress(page, b.x, b.y);
	await expect(bar(page)).toBeVisible();
	await expect(bar(page).locator('.x')).toHaveText('INCOGNITO');
	// Incognito keeps LOOK UP: a lookup may be made, it is just never logged.
	await expect(bar(page).getByRole('button')).toHaveText(['COPY', 'LOOK UP']);
	await page.mouse.click(page.viewportSize()!.width / 2, page.viewportSize()!.height - 90);
	await page.locator('.mk').first().click();
	await sheet(page).getByLabel('NOTE').fill('still mine');
	await expect.poll(() => quotesOf(id)[0]?.note).toBe('still mine');
	// The door itself refuses a new one in incognito; the page opened incognito sent no PUT.
	const refused = await page.evaluate(
		async (e) =>
			(
				await fetch('/api/highlights/quotes', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						entry: e,
						block: 2,
						offset: 0,
						endBlock: 2,
						endOffset: 3,
						quote: 'one'
					})
				})
			).status,
		id
	);
	expect(refused).toBe(403);
	expect(puts).toEqual([]);
	await page.context().clearCookies({ name: 'tsundoku_incognito' });
});

test('SCROLL: a crossing keeps no marker on the copy, and no selection starts there', async ({
	page
}) => {
	const first = chapterId(2);
	await page.addInitScript(() => {
		const k = 'tsundoku.text.settings';
		localStorage.setItem(
			k,
			JSON.stringify({ size: 20, line: 1.6, margins: 'wide', columns: false })
		);
	});
	// SCROLL by the series' own setting, as REMEMBER writes it.
	const d = db();
	d.prepare(`UPDATE series SET direction = 'scroll' WHERE title = 'Mushoku Tensei'`).run();
	d.close();
	await page.goto(`/read/${first}?at=2.0`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await page.waitForFunction(() => document.fonts.status === 'loaded');
	// Well below the top: a mouse at the top edge brings the controls up.
	const a = await word(page, 30);
	await longPress(page, a.x, a.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect.poll(() => quotesOf(first).length).toBe(1);
	// Scroll to the chapter's end: the crossing opens the next and keeps a copy above it.
	await page.locator('.page').evaluate(async (el) => {
		for (let i = 0; i < 40; i++) {
			el.scrollTop = el.scrollTop + 900;
			await new Promise((r) => requestAnimationFrame(r));
			if (document.querySelector('.kept')?.childElementCount) break;
		}
	});
	await expect(page.locator('.kept').locator('*').first()).toBeAttached();
	await expect(page.locator('.kept .mk')).toHaveCount(0);
	await expect(page.locator('.kept .sel')).toHaveCount(0);
	expect(await page.locator('.kept').getAttribute('inert')).not.toBeNull();
	// A second crossing replaces it, still with no marker.
	await page.locator('.page').evaluate(async (el) => {
		for (let i = 0; i < 60; i++) {
			el.scrollTop = el.scrollTop + 900;
			await new Promise((r) => requestAnimationFrame(r));
		}
	});
	await expect(page.locator('.kept .mk')).toHaveCount(0);
	const e = db();
	e.prepare(`UPDATE series SET direction = NULL WHERE title = 'Mushoku Tensei'`).run();
	e.close();
});

// ---- offline: drawn at once, waiting on the device (c842's queue; Novel N7) ------------

/** Every item waiting on the device. */
const queued = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<
				{
					key: string;
					body: Record<string, unknown>;
					refused: string | null;
					label: string;
					entry: number;
					revised?: string[];
					covers?: { key: string; body: Record<string, unknown> }[];
				}[]
			>((ok) => {
				const r = indexedDB.open('tsundoku.highlights-queue', 1);
				r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'key' });
				r.onsuccess = () => {
					const q = r.result.transaction('items').objectStore('items').getAll();
					q.onsuccess = () => {
						r.result.close();
						ok(q.result);
					};
				};
			})
	);

test('offline: drawn at once, and it says it waits; the sheet edits what waits, and it goes', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	await page.context().setOffline(true);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	// Drawn at once, with nothing answered.
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	expect(quotesOf(id)).toHaveLength(0);
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Blue' }).click();
	await sheet(page).getByLabel('NOTE').fill('typed while waiting');
	await expect.poll(async () => (await queued(page))[0]?.body.note).toBe('typed while waiting');
	expect((await queued(page))[0].body.colour).toBe('blue');
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
	// The app closed and opened again, the workstation still not answering: still waiting,
	// still drawn, from the device. (Offline, a reload needs the service worker, blocked here.)
	await page.route('**/api/highlights/quotes', (r) =>
		r.request().method() === 'POST' ? r.abort() : r.continue()
	);
	await page.context().setOffline(false);
	await page.reload();
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.mk')).toHaveClass(/\bblue\b/);
	expect(quotesOf(id)).toHaveLength(0);
	// The workstation answers: it goes, with no press, once, as written.
	await page.unroute('**/api/highlights/quotes');
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	expect(quotesOf(id)[0]).toMatchObject({
		quote: w.word,
		colour: 'blue',
		note: 'typed while waiting'
	});
	await expect.poll(async () => (await queued(page)).length).toBe(0);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('online with no answer: it waits, and DELETE takes it back with nothing asked', async ({
	page
}) => {
	const id = chapterId();
	let asked = 0;
	await page.route('**/api/highlights/quotes', (r) => {
		if (r.request().method() !== 'POST') return r.continue();
		asked++;
		return r.abort();
	});
	await open(page, id);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	expect(asked).toBeGreaterThan(0);
	await expect(page.locator('.mk')).toHaveText(w.word);
	const firstAsked = asked;
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'HIGHLIGHT DELETED' })).toBeVisible();
	await expect(page.locator('.mk')).toHaveCount(0);
	await expect.poll(async () => (await queued(page)).length).toBe(0);
	// Nothing else was asked of the workstation: the POSTs are still only the first one's.
	await page.waitForTimeout(300);
	expect(asked).toBe(firstAsked);
	expect(quotesOf(id)).toHaveLength(0);
	await page.unroute('**/api/highlights/quotes');
});

test('refused on arrival: no marker, no title, and DISMISS', async ({ page }) => {
	const id = chapterId();
	await page.route('**/api/highlights/quotes', (r) => {
		if (r.request().method() !== 'POST') return r.continue();
		return r.fulfill({ status: 404, body: 'not found' });
	});
	await open(page, id);
	await page.context().setOffline(true);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	await page.context().setOffline(false);
	const band = page.getByRole('status').filter({ hasText: 'NOT KEPT' });
	await expect(band).toBeVisible({ timeout: 30_000 });
	await expect(band).toContainText('ITS SERIES OR CHAPTER IS GONE');
	await expect(band).not.toContainText(/mushoku/i);
	await expect(page.locator('.mk')).toHaveCount(0);
	// The words aren't left behind on the device either.
	const [told] = await queued(page);
	expect(JSON.stringify(told)).not.toContain(w.word);
	await band.getByRole('button', { name: 'DISMISS' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(0);
	await page.unroute('**/api/highlights/quotes');
});

test('hidden means hidden on the device: a hidden series and reveal never queue', async ({
	page
}) => {
	const id = chapterId();
	const d = db();
	d.prepare(`UPDATE series SET hidden = 1 WHERE title = 'Mushoku Tensei'`).run();
	d.close();
	await page.context().addCookies([{ name: 'tsundoku_reveal', value: '1', url: base }]);
	await open(page, id);
	await page.context().setOffline(true);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(
		page.getByRole('status').filter({ hasText: 'HIGHLIGHT NEEDS THE WORKSTATION' })
	).toBeVisible();
	await expect(page.locator('.mk')).toHaveCount(0);
	expect(await queued(page)).toEqual([]);
	await page.context().setOffline(false);
	const e = db();
	e.prepare(`UPDATE series SET hidden = 0 WHERE title = 'Mushoku Tensei'`).run();
	e.close();
	await page.context().clearCookies({ name: 'tsundoku_reveal' });
});

// ---- Japanese: a long press still looks up (Novel J1 to J3) -------------------------------

async function serveBook(page: Page, epub: Buffer) {
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

/** Honzuki, whose served EPUB says it is Japanese, so it is set vertically. */
function honzukiChapter(): number {
	const d = db();
	try {
		const r = d
			.prepare(
				`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.title = 'Honzuki no Gekokujou' AND e.matter = '' ORDER BY e.position LIMIT 1`
			)
			.get() as { id: number };
		return r.id;
	} finally {
		d.close();
	}
}

test.describe('a Japanese book', () => {
	async function openJapanese(page: Page) {
		const ja = sampleEpub({
			title: 'Honzuki no Gekokujou',
			hue: 0,
			language: 'ja',
			chapters: Array.from({ length: 33 }, (_, i) => `第${i + 1}話`)
		});
		await serveBook(page, ja);
		const id = honzukiChapter();
		await page.goto(`/read/${id}?at=2.0`);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
		await expect(page.locator('.flow')).toHaveCSS('writing-mode', 'vertical-rl');
		await page.waitForFunction(() => document.fonts.status === 'loaded');
		return id;
	}

	/** A place on the first paragraph's text, on this page. */
	const textPoint = (page: Page) =>
		page.evaluate(() => {
			const b = [...document.querySelectorAll<HTMLElement>('.blocks p')].find((e) => {
				const r = e.getBoundingClientRect();
				return r.width > 0 && r.right > 0 && r.left < innerWidth;
			})!;
			const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, {
				acceptNode: (n) =>
					n.parentElement?.closest('rt, rp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
			});
			const t = walk.nextNode()!;
			const r = document.createRange();
			r.setStart(t, 2);
			r.setEnd(t, 3);
			const c = r.getClientRects()[0];
			return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
		});

	/**
	 * The way into the panel for any language with a pack (c198): a long press
	 * selects the word, and LOOK UP on the bar opens the panel over it.
	 */
	async function lookUpFrom(page: Page, p: { x: number; y: number }) {
		await longPress(page, p.x, p.y);
		await expect(bar(page)).toBeVisible();
		await bar(page).getByRole('button', { name: 'LOOK UP' }).click();
		const panel = page.getByRole('region', { name: 'Lookup' });
		await expect(panel.locator('.words .w.on')).toBeVisible({ timeout: 15_000 });
		return panel;
	}

	test('J2: a long press is still the lookup, and its foot keeps the word', async ({ page }) => {
		const id = await openJapanese(page);
		const p = await textPoint(page);
		const panel = await lookUpFrom(page, p);
		await expect(bar(page)).toHaveCount(0);
		await expect(panel.getByRole('button', { name: 'HIGHLIGHT' })).toBeVisible();
		await panel.getByRole('button', { name: 'HIGHLIGHT' }).click();
		await expect(panel).toHaveCount(0);
		await expect.poll(() => quotesOf(id).length).toBe(1);
		const row = quotesOf(id)[0];
		await expect(page.locator(SETTLED)).toHaveText(String(row.quote));
		// Vertical: the band on the column's left two-thirds, as a line's lower.
		await expect(page.locator('.mk').first()).toHaveCSS('box-shadow', /inset$/);
		await expect
			.poll(() =>
				page
					.locator('.mk')
					.first()
					.evaluate((e) => getComputedStyle(e).boxShadow)
			)
			.toMatch(/inset/);
		const shadow = await page
			.locator('.mk')
			.first()
			.evaluate((e) => getComputedStyle(e).boxShadow);
		const inset = /(-?[\d.]+)px (-?[\d.]+)px 0px 0px inset/.exec(shadow)!;
		expect(Number(inset[1])).toBeGreaterThan(0);
		expect(Number(inset[2])).toBe(0);
	});

	test('J3: SELECT MORE makes it a selection with the bar, LOOK UP and all', async ({ page }) => {
		const id = await openJapanese(page);
		const p = await textPoint(page);
		const panel = await lookUpFrom(page, p);
		await panel.getByRole('button', { name: 'SELECT MORE' }).click();
		await expect(panel).toHaveCount(0);
		await expect(bar(page)).toBeVisible();
		await expect(bar(page).getByRole('button', { name: 'LOOK UP' })).toBeVisible();
		await expect(page.locator('.hd')).toHaveCount(2);
		expect(quotesOf(id)).toHaveLength(0);
		await bar(page).getByRole('button', { name: 'LOOK UP' }).click();
		await expect(panel).toBeVisible();
	});

	test('a selection overlapping a highlight joins it at the foot too', async ({ page }) => {
		const id = await openJapanese(page);
		const p = await textPoint(page);
		const panel = await lookUpFrom(page, p);
		await panel.getByRole('button', { name: 'NOTE' }).click();
		await expect(panel).toHaveCount(0);
		await expect(sheet(page)).toBeVisible();
		await sheet(page).getByLabel('NOTE').fill('first');
		await expect.poll(() => quotesOf(id)[0]?.note).toBe('first');
		await page.keyboard.press('Escape');
		// The same word pressed again, kept again: one row, the older note kept.
		await lookUpFrom(page, p);
		await panel.getByRole('button', { name: 'HIGHLIGHT' }).click();
		await expect(page.locator('.mk')).toHaveCount(1);
		await page.waitForTimeout(200);
		expect(quotesOf(id)).toHaveLength(1);
		expect(quotesOf(id)[0].note).toBe('first');
	});
});

/**
 * Round 2 (c702): each case reaches its state through the app's own doors and
 * holds or fails the named request with `page.route`.
 */
const HIGHLIGHT_ROW = /\/api\/highlights\/\d+$/;
const QUOTES_POST = '**/api/highlights/quotes';

/** Answer one method at a highlight's own address badly, the way a sleeping or broken workstation does. */
const failRow = (page: Page, method: string, fail: 'abort' | 500) =>
	page.route(HIGHLIGHT_ROW, (r) => {
		if (r.request().method() !== method) return r.continue();
		return fail === 'abort' ? r.abort() : r.fulfill({ status: 500, body: 'no' });
	});

/** Holds the quote's POST until `release` says what becomes of it, and keeps every body seen. */
async function holdPost(page: Page) {
	let open!: (how: 'abort' | 'continue') => void;
	const gate = new Promise<'abort' | 'continue'>((ok) => (open = ok));
	const bodies: Record<string, unknown>[] = [];
	await page.route(QUOTES_POST, async (r) => {
		if (r.request().method() !== 'POST') return r.continue();
		bodies.push(r.request().postDataJSON());
		if ((await gate) === 'abort') return r.abort();
		return r.continue();
	});
	return { release: open, bodies };
}

/** Every quote of an entry, the ones set aside too. */
const allQuotesOf = (entry: number): Row[] => {
	const d = db();
	try {
		return d
			.prepare(`SELECT * FROM highlights WHERE kind = 'quote' AND entry_id = ? ORDER BY id`)
			.all(entry) as Row[];
	} finally {
		d.close();
	}
};

/** Opens a chapter on its last page, where one more turn crosses. */
async function openLast(page: Page, id: number) {
	await page.goto(`/read/${id}?p=last`);
	await expect(page.locator('.blocks p').first()).toBeAttached({ timeout: 15_000 });
	await expect(page.locator('.flow')).toHaveCSS('column-gap', /px/);
	await page.waitForFunction(() => document.fonts.status === 'loaded');
}

/** A turn from a chapter's last page into the next chapter, and its heading is on. */
async function cross(page: Page) {
	const was = await page.locator('.blocks h1').first().innerText();
	for (let i = 0; i < 14; i++) {
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(350);
		if ((await page.locator('.blocks h1').first().innerText()) !== was) return;
	}
	throw new Error(`never left "${was}"`);
}

/** The middle of the `n`th long word under `selector`, on this page. */
const wordUnder = (page: Page, selector: string, n: number) =>
	page.evaluate(
		([sel, nth]) => {
			const seen: { x: number; y: number; word: string; offset: number }[] = [];
			for (const el of document.querySelectorAll<HTMLElement>(sel as string)) {
				const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
				for (let t = walk.nextNode(); t; t = walk.nextNode()) {
					for (const m of (t.textContent ?? '').matchAll(/\p{L}{3,}/gu)) {
						const r = document.createRange();
						r.setStart(t, m.index);
						r.setEnd(t, m.index + m[0].length);
						const c = r.getClientRects()[0];
						if (!c || c.left < 0 || c.right > innerWidth) continue;
						seen.push({
							x: c.left + c.width / 2,
							y: c.top + c.height / 2,
							word: m[0],
							offset: m.index
						});
						if (seen.length > (nth as number)) return seen[nth as number];
					}
				}
			}
			throw new Error(`no word ${nth} under ${sel}: ${seen.length}`);
		},
		[selector, n] as const
	);

/** Press a word and drag the end handle on to another: a selection of several words. */
async function selectThrough(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
	await longPress(page, a.x, a.y);
	await expect(bar(page)).toBeVisible();
	const end = (await page.locator('.hd.end').boundingBox())!;
	await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + 2, b.y, { steps: 6 });
	await page.mouse.up();
}

const band = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

for (const [how, fail] of [
	['no answer', 'abort'],
	['a 500', 500]
] as const) {
	test(`R2 DELETE that did not happen (${how}): the marker stays, NOT DELETED, no UNDO`, async ({
		page
	}) => {
		const id = chapterId();
		await open(page, id);
		await keepWord(page, id, 2);
		await failRow(page, 'DELETE', fail);
		await page.locator('.mk').first().click();
		await sheet(page).getByRole('button', { name: 'DELETE' }).click();
		const told = band(page, 'NOT DELETED');
		await expect(told).toBeVisible();
		await expect(told).toContainText('THE WORKSTATION DID NOT ANSWER');
		await expect(told.getByRole('button', { name: 'UNDO' })).toHaveCount(0);
		await expect(page.locator('.mk')).toHaveCount(1);
		await page.unroute(HIGHLIGHT_ROW);
		expect(quotesOf(id)).toHaveLength(1);
		await open(page, id);
		await expect(page.locator('.mk')).toHaveCount(1);
		expect(quotesOf(id)).toHaveLength(1);
	});

	test(`R2 a colour that did not take (${how}): the old one comes back, and it says so`, async ({
		page
	}) => {
		const id = chapterId();
		await open(page, id);
		await keepWord(page, id, 2);
		const was = String(quotesOf(id)[0].colour);
		const [to, toClass] = was === 'blue' ? ['Orange', 'orange'] : ['Blue', 'blue'];
		await failRow(page, 'PATCH', fail);
		await page.locator('.mk').first().click();
		await sheet(page).getByRole('button', { name: to }).click();
		await expect(band(page, 'COLOUR NOT CHANGED')).toContainText('THE WORKSTATION DID NOT ANSWER');
		await expect(page.locator('.mk').first()).toHaveClass(new RegExp(`\\b${was}\\b`));
		await expect(page.locator('.mk').first()).not.toHaveClass(new RegExp(`\\b${toClass}\\b`));
		await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
		await page.unroute(HIGHLIGHT_ROW);
		await open(page, id);
		await expect(page.locator('.mk').first()).toHaveClass(new RegExp(`\\b${was}\\b`));
		expect(quotesOf(id)[0].colour).toBe(was);
	});

	test(`R2 an UNDO that did not take (${how}): it says it was not brought back`, async ({
		page
	}) => {
		const id = chapterId();
		await open(page, id);
		await keepWord(page, id, 2);
		await page.locator('.mk').first().click();
		await sheet(page).getByRole('button', { name: 'DELETE' }).click();
		const deleted = band(page, 'HIGHLIGHT DELETED');
		await expect.poll(() => quotesOf(id).length).toBe(0);
		await failRow(page, 'POST', fail);
		await deleted.getByRole('button', { name: 'UNDO' }).click();
		await expect(band(page, 'NOT BROUGHT BACK')).toContainText('THE WORKSTATION DID NOT ANSWER');
		await expect(page.locator('.mk')).toHaveCount(0);
		await page.unroute(HIGHLIGHT_ROW);
		await open(page, id);
		await expect(page.locator('.mk')).toHaveCount(0);
		expect(quotesOf(id)).toHaveLength(0);
	});
}

test('R2 two colours at once, the last one refused: the one that took stands', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	await keepWord(page, id, 2);
	let patches = 0;
	let secondAsked!: () => void;
	const asked = new Promise<void>((ok) => (secondAsked = ok));
	let firstAnswered!: () => void;
	const answered = new Promise<void>((ok) => (firstAnswered = ok));
	// Both out at once, and answered in the order they were asked.
	await page.route(HIGHLIGHT_ROW, async (r) => {
		if (r.request().method() !== 'PATCH') return r.continue();
		if (++patches === 1) {
			await asked;
			await r.fulfill({ response: await r.fetch() });
			firstAnswered();
			return;
		}
		secondAsked();
		await answered;
		await page.waitForTimeout(100);
		return r.abort();
	});
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'Blue' }).click();
	await sheet(page).getByRole('button', { name: 'Orange' }).click();
	await expect(band(page, 'COLOUR NOT CHANGED')).toBeVisible();
	await expect(page.locator('.mk').first()).toHaveClass(/\bblue\b/);
	await expect.poll(() => quotesOf(id)[0]?.colour).toBe('blue');
	expect(patches).toBe(2);
});

test('R2 deleted while its POST is out, and the POST fails: nothing waits on the device', async ({
	page
}) => {
	const id = chapterId();
	const hold = await holdPost(page);
	await open(page, id);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(w.word);
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(page.locator('.mk')).toHaveCount(0);
	expect(hold.bodies).toHaveLength(1);
	hold.release('abort');
	// The press's own end: the band comes only once the POST has answered.
	await expect(band(page, 'HIGHLIGHT DELETED')).toBeVisible();
	await page.waitForTimeout(300);
	expect(await queued(page)).toHaveLength(0);
	await expect(page.locator('.mk')).toHaveCount(0);
	expect(allQuotesOf(id)).toHaveLength(0);
	// UNDO: nothing reached the workstation, so it waits on the device, as any press that couldn't.
	await band(page, 'HIGHLIGHT DELETED').getByRole('button', { name: 'UNDO' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
});

test('R2 a joining press refused: the highlights it took in are drawn again', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	const a = await word(page, 2);
	const b = await word(page, 4);
	await keepWord(page, id, 2);
	await keepWord(page, id, 4);
	await page.route(QUOTES_POST, (r) =>
		r.request().method() === 'POST' ? r.fulfill({ status: 400, body: 'no' }) : r.continue()
	);
	await selectThrough(page, a, b);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(band(page, 'NOT KEPT')).toBeVisible();
	await expect(page.locator('.mk', { hasText: a.word })).toHaveCount(1);
	await expect(page.locator('.mk', { hasText: b.word })).toHaveCount(1);
	expect(quotesOf(id)).toHaveLength(2);
});

test('R2 deleted while its POST is out, and the POST lands: no live row, no marker', async ({
	page
}) => {
	const id = chapterId();
	const hold = await holdPost(page);
	await open(page, id);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(page.locator('.mk')).toHaveCount(0);
	const answered = page.waitForResponse(
		(r) => r.url().includes('/api/highlights/quotes') && r.request().method() === 'POST'
	);
	hold.release('continue');
	expect((await answered).ok()).toBe(true);
	await expect(band(page, 'HIGHLIGHT DELETED')).toBeVisible();
	// It really was made, and it really was taken away again.
	await expect.poll(() => allQuotesOf(id).length).toBe(1);
	await expect.poll(() => quotesOf(id).length).toBe(0);
	await expect(page.locator('.mk')).toHaveCount(0);
	expect(await queued(page)).toHaveLength(0);
	await page.unroute(QUOTES_POST);
	await open(page, id);
	await expect(page.locator('.mk')).toHaveCount(0);
});

test('R2 deleted while the device is still writing it down: it does not stay there', async ({
	page
}) => {
	const id = chapterId();
	// The queue's database opens only when told: the moment between the press and its row.
	await page.addInitScript(() => {
		const w = window as unknown as { dbGate?: Promise<void>; openDb?: () => void };
		const open = IDBFactory.prototype.open;
		IDBFactory.prototype.open = function (this: IDBFactory, ...a: [string, number?]) {
			const r = open.apply(this, a);
			if (w.dbGate)
				Object.defineProperty(r, 'onsuccess', {
					set(f: (e: Event) => void) {
						r.addEventListener('success', (e) => void w.dbGate!.then(() => f(e)));
					}
				});
			return r;
		};
	});
	await page.route(QUOTES_POST, (r) =>
		r.request().method() === 'POST' ? r.abort() : r.continue()
	);
	await open(page, id);
	await page.evaluate(() => {
		const w = window as unknown as { dbGate?: Promise<void>; openDb?: () => void };
		w.dbGate = new Promise<void>((ok) => (w.openDb = ok));
	});
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(w.word);
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(page.locator('.mk')).toHaveCount(0);
	await page.evaluate(() => {
		const g = window as unknown as { dbGate?: Promise<void>; openDb?: () => void };
		g.openDb!();
		delete g.dbGate;
	});
	await expect(band(page, 'HIGHLIGHT DELETED')).toBeVisible();
	await expect.poll(async () => (await queued(page)).length).toBe(0);
	await page.waitForTimeout(300);
	expect(await queued(page)).toHaveLength(0);
	expect(quotesOf(id)).toHaveLength(0);
});

test('R2 a note written offline on a highlight already saved: it is there after reconnecting', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await keepWord(page, id, 2);
	const saved = quotesOf(id)[0];
	expect(saved.note).toBe('');
	await page.context().setOffline(true);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'NOTE' }).click();
	await sheet(page).getByLabel('NOTE').fill('written while it waited');
	await expect.poll(async () => (await queued(page))[0]?.body.note).toBe('written while it waited');
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
	await page.context().setOffline(false);
	await expect
		.poll(() => quotesOf(id)[0]?.note, { timeout: 30_000 })
		.toBe('written while it waited');
	expect(quotesOf(id)).toHaveLength(1);
	expect(quotesOf(id)[0].id).toBe(saved.id);
	await open(page, id);
	await expect(page.locator('.nm')).toHaveCount(1);
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByLabel('NOTE')).toHaveValue('written while it waited');
});

test('R2 UNDO after a crossing queues the deleted quote under its own chapter', async ({
	page
}) => {
	const first = chapterId(1);
	const second = chapterId(2);
	await page.route(QUOTES_POST, (r) =>
		r.request().method() === 'POST' ? r.abort() : r.continue()
	);
	await openLast(page, first);
	const w = await word(page, 1);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	const key = (await queued(page))[0].key;
	expect(key).toContain(`quote:${first}:`);
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(0);
	const deleted = band(page, 'HIGHLIGHT DELETED');
	await expect(deleted).toBeVisible();
	await cross(page);
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${second}`);
	await deleted.getByRole('button', { name: 'UNDO' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	const item = (await queued(page))[0] as unknown as {
		key: string;
		entry: number;
		body: { entry: number };
	};
	expect(item.key).toBe(key);
	expect(item.entry).toBe(first);
	expect(item.body.entry).toBe(first);
	// Not drawn on the chapter it is not of.
	await expect(page.locator('.mk')).toHaveCount(0);
});

test('R2 UNDO of a saved quote after a crossing brings the row back and draws nothing here', async ({
	page
}) => {
	const first = chapterId(1);
	await openLast(page, first);
	await keepWord(page, first, 1);
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	const deleted = band(page, 'HIGHLIGHT DELETED');
	await expect(deleted).toBeVisible();
	await expect.poll(() => quotesOf(first).length).toBe(0);
	await cross(page);
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${chapterId(2)}`);
	await deleted.getByRole('button', { name: 'UNDO' }).click();
	await expect.poll(() => quotesOf(first).length).toBe(1);
	await page.waitForTimeout(300);
	await expect(page.locator('.mk')).toHaveCount(0);
});

test('R2 a POST answered after a crossing draws nothing on the new chapter', async ({ page }) => {
	const first = chapterId(1);
	const hold = await holdPost(page);
	await openLast(page, first);
	const w = await word(page, 1);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(w.word);
	await cross(page);
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${chapterId(2)}`);
	await expect(page.locator('.mk')).toHaveCount(0);
	const answered = page.waitForResponse(
		(r) => r.url().includes('/api/highlights/quotes') && r.request().method() === 'POST'
	);
	hold.release('continue');
	expect((await answered).ok()).toBe(true);
	// The row is right, on its own chapter; only the drawing belongs to the chapter on screen.
	await expect.poll(() => quotesOf(first).length).toBe(1);
	await page.waitForTimeout(400);
	await expect(page.locator('.mk')).toHaveCount(0);
});

test("R2 a selection while a chapter's quotes are on their way sends only its own span", async ({
	page
}) => {
	const first = chapterId(1);
	const second = chapterId(2);
	// A long highlight in the block the next chapter's press will share a number with.
	await open(page, first);
	const a = await wordUnder(page, '.blocks [data-b="2"]', 0);
	const b = await wordUnder(page, '.blocks [data-b="2"]', 2);
	await selectThrough(page, a, b);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => quotesOf(first).length).toBe(1);
	const stale = quotesOf(first)[0];
	let release!: () => void;
	const gate = new Promise<void>((ok) => (release = ok));
	const bodies: Record<string, unknown>[] = [];
	await page.route(
		(u) => u.pathname.endsWith('/api/highlights/quotes'),
		async (r) => {
			const q = r.request();
			if (q.method() === 'POST') {
				bodies.push(q.postDataJSON());
				return r.continue();
			}
			if (!q.url().includes(`entry=${second}`)) return r.continue();
			// Answered as it stood when asked, before the press: the late list knows nothing of it.
			const asked = await r.fetch();
			await gate;
			return r.fulfill({ response: asked });
		}
	);
	await cross(page);
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${second}`);
	await expect(page.locator('.mk')).toHaveCount(0);
	const w = await wordUnder(page, '.blocks [data-b="2"]', 1);
	// The state named: this word's numbers lie inside the last chapter's highlight.
	expect(stale.block).toBe(2);
	expect(w.offset).toBeLessThan(Number(stale.end_offset));
	expect(w.offset + w.word.length).toBeGreaterThan(Number(stale.block_offset));
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => bodies.length).toBe(1);
	expect(bodies[0]).toMatchObject({ entry: second, block: 2, quote: w.word });
	expect(Number(bodies[0].endOffset) - Number(bodies[0].offset)).toBe(w.word.length);
	await expect.poll(() => quotesOf(second).length).toBe(1);
	// The list arriving after the press does not take the press's marker away.
	release();
	await page.waitForResponse((r) => r.url().includes(`entry=${second}`)).catch(() => null);
	await page.waitForTimeout(300);
	await expect(page.locator('.mk')).toHaveText(w.word);
});

test('R2 a long press on a book whose dc:language is en_US selects a word', async ({ page }) => {
	const epub = sampleEpub({
		title: 'Honzuki no Gekokujou',
		hue: 0,
		language: 'en_US',
		chapters: Array.from({ length: 33 }, (_, i) => `第${i + 1}話`)
	});
	await serveBook(page, epub);
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto(`/read/${honzukiChapter()}?at=2.0`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('.flow')).toHaveCSS('column-gap', /px/);
	await page.waitForFunction(() => document.fonts.status === 'loaded');
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	expect(errors).toEqual([]);
});

test('R2 in a cut table the words kept are the words painted, on a cut and an uncut width', async ({
	page
}) => {
	const id = chapterId(2);
	await page.setViewportSize({ width: 500, height: 900 });
	await page.goto(`/read/${id}?at=4.0`);
	await expect(page.locator('.wide.table')).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('.flow')).toHaveCSS('column-gap', /px/);
	await page.waitForFunction(() => document.fonts.status === 'loaded');
	await expect(page.locator('.wide.table')).toHaveClass(/\bcut\b/);
	const w = await wordUnder(page, '.wide.table th', 0);
	expect(w.word).toBe('FLAG');
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => quotesOf(id).length).toBe(1);
	expect(quotesOf(id)[0].quote).toBe('FLAG');
	await expect(page.locator('.mk')).toHaveText('FLAG');
	// What is cut is still said, in a part of the label no number counts.
	await expect(page.locator('.wide.table .wlabel')).toHaveText('TABLE');
	await expect(page.locator('.wide.table .wlabel')).toHaveAttribute('data-shown', /SHOWN/);
	// The same stored numbers, on a width where nothing is cut.
	await page.setViewportSize({ width: 1800, height: 1000 });
	await page.goto(`/read/${id}?at=4.0`);
	await expect(page.locator('.wide.table')).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('.flow')).toHaveCSS('column-gap', /px/);
	await expect(page.locator('.wide.table')).not.toHaveClass(/\bcut\b/);
	await expect(page.locator('.mk')).toHaveText('FLAG');
	expect(quotesOf(id)[0]).toMatchObject({ state: 'ok', quote: 'FLAG' });
});

for (const [how, press] of [
	['Escape', 'Escape'],
	['the back key', 'back']
] as const) {
	test(`R2 ${how} at once keeps the whole note`, async ({ page }) => {
		const id = chapterId();
		await open(page, id);
		await keepWord(page, id, 2);
		await page.locator('.mk').first().click();
		await sheet(page).getByLabel('NOTE').fill('every word of it, typed and closed at once');
		// The app's own BACK, with the note's field still holding the keyboard (src/lib/focus/layer.ts).
		if (press === 'back')
			await page.evaluate(() => (window as unknown as { tsundokuBack(): boolean }).tsundokuBack());
		else await page.keyboard.press(press);
		await expect(sheet(page)).toHaveCount(0);
		await expect
			.poll(() => quotesOf(id)[0]?.note)
			.toBe('every word of it, typed and closed at once');
		await open(page, id);
		await page.locator('.mk').first().click();
		await expect(sheet(page).getByLabel('NOTE')).toHaveValue(
			'every word of it, typed and closed at once'
		);
	});
}

test('R2 joining at the bar keeps a newer note when the oldest has none', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	const a = await word(page, 2);
	const b = await word(page, 4);
	await keepWord(page, id, 2);
	await keepWord(page, id, 4);
	const rows = quotesOf(id);
	expect(rows).toHaveLength(2);
	expect(Number(rows[0].made_at)).toBeLessThanOrEqual(Number(rows[1].made_at));
	await page.locator('.mk', { hasText: b.word }).first().click();
	await sheet(page).getByLabel('NOTE').fill('only the newer has one');
	await expect.poll(() => quotesOf(id)[1]?.note).toBe('only the newer has one');
	await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
	await selectThrough(page, a, b);
	const hold = await holdPost(page);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	// On the client too: the press draws the join with the note, before any answer.
	await expect.poll(() => hold.bodies.length).toBe(1);
	expect(hold.bodies[0].note).toBe('only the newer has one');
	await expect(page.locator('.nm')).toHaveCount(1);
	hold.release('continue');
	await expect.poll(() => quotesOf(id).length).toBe(1);
	expect(quotesOf(id)[0].id).toBe(rows[0].id);
	expect(quotesOf(id)[0].note).toBe('only the newer has one');
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('R2 a join while the queue’s POST is out: the joined row stays, with its note', async ({
	page
}) => {
	const id = chapterId();
	// The queue's own POST for a waiting quote: the workstation makes the row, and
	// its answer is kept back so the join's press reaches the workstation first.
	let phase: 'wait' | 'hold' = 'wait';
	let posts = 0;
	let held = false;
	let taken!: (r: APIResponse) => void;
	const made = new Promise<APIResponse>((ok) => (taken = ok));
	let free!: () => void;
	const freed = new Promise<void>((ok) => (free = ok));
	const deletes: string[] = [];
	await page.route(QUOTES_POST, async (r) => {
		if (r.request().method() !== 'POST') return r.continue();
		posts++;
		if (phase === 'wait') return r.abort();
		if (!held) {
			held = true;
			// Answered already by the workstation, then held: the row is there for
			// the join's POST, and this answer will still say it made one.
			const response = await r.fetch();
			taken(response);
			await freed;
			return r.fulfill({ response });
		}
		return r.continue();
	});
	await page.route(HIGHLIGHT_ROW, (r) => {
		if (r.request().method() === 'DELETE') deletes.push(r.request().url());
		return r.continue();
	});

	await open(page, id);
	const a = await word(page, 2);
	await longPress(page, a.x, a.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(a.word);
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	// The note it carries into the join.
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByLabel('NOTE').fill('the note the join must keep');
	await expect
		.poll(async () => (await queued(page))[0]?.body.note)
		.toBe('the note the join must keep');
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
	// The retry tick sends it, and the answer is held back once the row is made.
	phase = 'hold';
	await made;
	// Select over the waiting quote and keep the union while that answer waits.
	const b = await word(page, 4);
	await selectThrough(page, a, b);
	const union = (await selected(page)).trim();
	expect(union).toMatch(new RegExp(`^${a.word}`));
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk').first()).toBeVisible();
	await expect.poll(() => quotesOf(id).length).toBe(1);
	// The queue's old answer lands. Its item is superseded, not unwanted: what that
	// POST made is the row the join kept, so it must not be DELETEd.
	free();
	await expect.poll(async () => (await queued(page)).length).toBe(0);
	// The held POST ran (the workstation answered it), and the join's went past it.
	expect(held).toBe(true);
	expect(posts).toBeGreaterThanOrEqual(2);
	await page.waitForTimeout(400);
	expect(deletes).toEqual([]);
	expect(quotesOf(id)).toHaveLength(1);
	// A reload draws the one row: the union, with its note, and a marker on it.
	await open(page, id);
	const row = quotesOf(id)[0];
	expect(String(row.quote).replace(/\n/g, '')).toBe(union);
	expect(row.note).toBe('the note the join must keep');
	await expect(page.locator(SETTLED).first()).toBeVisible();
	expect(await page.locator(SETTLED).first().innerText()).toContain(a.word);
});

test('R2 offline, a press inside a waiting quote keeps it: one item, its note, a row after', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	await page.context().setOffline(true);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	// The note the re-press must carry through the take-back.
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByLabel('NOTE').fill('the note the re-press must keep');
	await expect
		.poll(async () => (await queued(page))[0]?.body.note)
		.toBe('the note the re-press must keep');
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
	// The exact re-press of the same word: the same key, and `keepSpan` runs the
	// take-back and the press that covers it in one tick.
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	// The press is still one item, carrying the note: an unsequenced take-back
	// would leave nothing here under WAITING TO BE SENT. Its removal is two
	// IndexedDB turns, so let them pass before reading what stayed.
	await page.waitForTimeout(500);
	expect(await queued(page)).toHaveLength(1);
	expect((await queued(page))[0].body.note).toBe('the note the re-press must keep');
	// Reconnected, the one item goes on its own, and the row is there.
	await page.context().setOffline(false);
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	expect(quotesOf(id)[0].note).toBe('the note the re-press must keep');
	await open(page, id);
	expect(quotesOf(id)).toHaveLength(1);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator(SETTLED).first()).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('R2 the join reaching the workstation first: the queue’s body is its row, not a second', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	await page.context().setOffline(true);
	const a = await word(page, 2);
	await longPress(page, a.x, a.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(a.word);
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByLabel('NOTE').fill('the note the union must keep');
	await expect
		.poll(async () => (await queued(page))[0]?.body.note)
		.toBe('the note the union must keep');
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);

	// The queue's own POST is held before it reaches the workstation, so the
	// join's POST goes past it and its row exists when the body arrives.
	let held = false;
	let released!: () => void;
	const gate = new Promise<void>((ok) => (released = ok));
	const bodies: Record<string, unknown>[] = [];
	const deletes: string[] = [];
	await page.route(QUOTES_POST, async (r) => {
		if (r.request().method() !== 'POST') return r.continue();
		bodies.push(r.request().postDataJSON());
		if (!held) {
			held = true;
			await gate;
		}
		return r.continue();
	});
	await page.route(HIGHLIGHT_ROW, (r) => {
		if (r.request().method() === 'DELETE') deletes.push(r.request().url());
		return r.continue();
	});
	await page.context().setOffline(false);
	// The reconnection sends the waiting quote, and its POST is held.
	await expect.poll(() => held, { timeout: 30_000 }).toBe(true);
	const b = await word(page, 4);
	await selectThrough(page, a, b);
	const union = (await selected(page)).trim();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	// The join's POST passes the held one and makes its row.
	await expect.poll(() => quotesOf(id).length).toBe(1);
	await expect.poll(() => bodies.length).toBeGreaterThanOrEqual(2);
	// Released: the waiting body arrives after the join, and it is the join's row.
	const answered = page.waitForResponse(
		(r) => r.url().includes('/api/highlights/quotes') && r.request().method() === 'POST'
	);
	released();
	expect((await answered).ok()).toBe(true);
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	expect(deletes).toEqual([]);
	// One live row, not two: the body lies inside the join, so it answers it.
	expect(quotesOf(id)).toHaveLength(1);
	const row = quotesOf(id)[0];
	expect(String(row.quote).replace(/\n/g, '')).toBe(union);
	expect(row.note).toBe('the note the union must keep');
	// A reload draws it, with its note and a marker.
	await open(page, id);
	expect(quotesOf(id)).toHaveLength(1);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator('.nm')).toHaveCount(1);
});

/**
 * Round 3 (c702): a join that ends with no row and no queue item puts back the
 * waiting quotes it took in. `keepSpan` takes each one off the device before
 * the join has an answer, and only saved rows are restored by `settleQuote`, so
 * a refusal or a refused storage lost the waiting highlight and its note.
 */
const KEPT_NOTE = 'the note the refusal must keep';

/** A quote waiting on the device with a note, one press away from being sent. */
async function waitingQuote(page: Page, n = 2) {
	await page.context().setOffline(true);
	const w = await word(page, n);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByLabel('NOTE').fill(KEPT_NOTE);
	await expect.poll(async () => (await queued(page))[0]?.body.note).toBe(KEPT_NOTE);
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
	const key = (await queued(page))[0].key;
	return { ...w, key, note: KEPT_NOTE };
}

/**
 * The queue's own POST is held before the workstation, and the join's is held
 * until `answerJoin` says what becomes of it: the joining quote is still
 * waiting when the join is pressed, and its answer is ours to choose.
 */
async function holdQueueThenJoin(page: Page) {
	let posts = 0;
	let releaseQueue!: (how: 'abort' | 'continue') => void;
	const queueGate = new Promise<'abort' | 'continue'>((ok) => (releaseQueue = ok));
	// One answer per join, in the order the joins are pressed: the answer may be
	// given before its POST arrives, so it is kept until the POST asks for it.
	// `abort` is the POST that never reaches the workstation, which is how a
	// press deleted in flight ends unreachable.
	const answers: (number | 'continue' | 'abort')[] = [];
	const waiting: ((how: number | 'continue' | 'abort') => void)[] = [];
	const answerJoin = (how: number | 'continue' | 'abort') => {
		const next = waiting.shift();
		if (next) next(how);
		else answers.push(how);
	};
	const nextAnswer = (): Promise<number | 'continue' | 'abort'> => {
		const had = answers.shift();
		if (had !== undefined) return Promise.resolve(had);
		return new Promise<number | 'continue' | 'abort'>((ok) => waiting.push(ok));
	};
	const bodies: Record<string, unknown>[] = [];
	const deletes: string[] = [];
	await page.route(QUOTES_POST, async (r) => {
		if (r.request().method() !== 'POST') return r.continue();
		bodies.push(r.request().postDataJSON());
		posts++;
		if (posts === 1) {
			if ((await queueGate) === 'abort') return r.abort();
			return r.continue();
		}
		const answer = await nextAnswer();
		if (answer === 'abort') return r.abort();
		return answer === 'continue' ? r.continue() : r.fulfill({ status: answer, body: 'no' });
	});
	await page.route(HIGHLIGHT_ROW, (r) => {
		if (r.request().method() === 'DELETE') deletes.push(r.request().url());
		return r.continue();
	});
	return { bodies, deletes, releaseQueue, answerJoin, held: () => posts >= 1, posts: () => posts };
}

/** The union a selection over `a` and `b` makes, as the bar reports it. */
async function joinedSelection(
	page: Page,
	a: { x: number; y: number },
	b: { x: number; y: number }
) {
	await selectThrough(page, a, b);
	const union = (await selected(page)).trim();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	return union;
}

/** Answers the first quote POST with [status]; every later one goes through. */
async function refuseFirstPost(page: Page, status = 400) {
	let posts = 0;
	await page.route(QUOTES_POST, (r) => {
		if (r.request().method() !== 'POST') return r.continue();
		posts++;
		return posts === 1 ? r.fulfill({ status, body: 'no' }) : r.continue();
	});
	return () => posts;
}

/**
 * Holds every quote POST until `release`, then answers each 400: the refusal
 * comes after a reload, with the join still on the device across the page's life.
 */
async function holdThenRefuse(page: Page) {
	let release!: () => void;
	const gate = new Promise<void>((ok) => (release = ok));
	const bodies: Record<string, unknown>[] = [];
	await page.route(QUOTES_POST, async (r) => {
		if (r.request().method() !== 'POST') return r.continue();
		bodies.push(r.request().postDataJSON());
		await gate;
		// The page that made it may have gone: its own POST is past recall.
		await r.fulfill({ status: 400, body: 'no' }).catch(() => undefined);
	});
	return { bodies, release };
}

test('R3 a join refused with a 401 keeps the waiting quote it took in, with its note', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	// The reconnection started sending the waiting quote, and it is held.
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	const b = await word(page, 4);
	await joinedSelection(page, w, b);
	held.answerJoin(401);
	await expect(band(page, 'NOT KEPT')).toBeVisible();
	// The quote the join took in waits again: drawn once, with its note, under
	// its own key. Before the fix nothing was left: the join had removed it.
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	const kept = await queued(page);
	expect(kept).toHaveLength(1);
	expect(kept[0].key).toBe(w.key);
	expect(kept[0].body.note).toBe(w.note);
	expect(kept[0].entry).toBe(id);
	// The POST already out for that very item answers with its row: the
	// re-queued item is the one present, so nothing is DELETEd and one row stands.
	held.releaseQueue('continue');
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	await expect.poll(() => quotesOf(id).length).toBe(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	expect(held.deletes).toEqual([]);
	// A reload draws the one row, its note and its marker.
	await open(page, id);
	expect(quotesOf(id)).toHaveLength(1);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator(SETTLED).first()).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('R3 a join refused with a 400 puts the waiting quote back the same way', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	const b = await word(page, 4);
	await joinedSelection(page, w, b);
	held.answerJoin(400);
	await expect(band(page, 'NOT KEPT')).toBeVisible();
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	const kept = await queued(page);
	expect(kept).toHaveLength(1);
	expect(kept[0].key).toBe(w.key);
	expect(kept[0].body.note).toBe(w.note);
	held.releaseQueue('continue');
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	await expect.poll(() => quotesOf(id).length).toBe(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	expect(held.deletes).toEqual([]);
	await open(page, id);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('R3 the exact re-press of the waiting quote, refused, keeps it and its note', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	// The same span as the waiting item: the same key, a new incarnation.
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	held.answerJoin(401);
	await expect(band(page, 'NOT KEPT')).toBeVisible();
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	const kept = await queued(page);
	expect(kept).toHaveLength(1);
	expect(kept[0].key).toBe(w.key);
	expect(kept[0].body.note).toBe(w.note);
	held.releaseQueue('continue');
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	await expect.poll(() => quotesOf(id).length).toBe(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	expect(held.deletes).toEqual([]);
});

test('R3 a join deleted while its POST is out, then refused: nothing is put back', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	const b = await word(page, 4);
	await joinedSelection(page, w, b);
	// The join is on the page at once, its POST still out: DELETE it.
	await expect(page.locator('.mk').first()).toBeVisible();
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(page.locator('.mk')).toHaveCount(0);
	held.answerJoin(401);
	await expect(band(page, 'HIGHLIGHT DELETED')).toBeVisible();
	// The reader wanted the join gone, so the quote it took in is not put back.
	expect(await queued(page)).toHaveLength(0);
	await expect(page.locator('.mk')).toHaveCount(0);
	// The POST already out for that quote makes its row, and that row is set aside:
	// since round 4 the quote was still on the device when the join was deleted,
	// so DELETE took it back (not a supersede), and what its POST made goes too.
	held.releaseQueue('continue');
	await expect.poll(() => held.deletes.length, { timeout: 30_000 }).toBe(1);
	await expect.poll(() => quotesOf(id).length).toBe(0);
	await expect(page.locator('.mk')).toHaveCount(0);
});

test('R3 a chapter turned while the join’s POST is out: the quote waits under its own chapter', async ({
	page
}) => {
	const first = chapterId(1);
	const second = chapterId(2);
	await openLast(page, first);
	const w = await waitingQuote(page, 1);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	const b = await word(page, 2);
	await joinedSelection(page, w, b);
	await cross(page);
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${second}`);
	held.answerJoin(401);
	await expect(band(page, 'NOT KEPT')).toBeVisible();
	// Waiting on the device under the chapter it was pressed on, drawn nowhere here.
	// The band is said before `restoreJoinedWaiting`'s write ends, and on another
	// chapter no marker is drawn to wait on (the other R3 refusals wait on `.mk`,
	// which `putBack` draws after the write): wait on the device itself.
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	const kept = await queued(page);
	expect(kept).toHaveLength(1);
	expect(kept[0].key).toBe(w.key);
	expect(kept[0].body.note).toBe(w.note);
	expect(kept[0].entry).toBe(first);
	await expect(page.locator('.mk')).toHaveCount(0);
	expect(quotesOf(first)).toHaveLength(0);
	// Its own POST answers with the row, on its own chapter.
	held.releaseQueue('continue');
	await expect.poll(() => quotesOf(first).length, { timeout: 30_000 }).toBe(1);
	expect(quotesOf(first)[0].note).toBe(w.note);
	await openLast(page, first);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator(SETTLED).first()).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('R3 a second join over the re-queued quote: one row, and the held body folds into it', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	const b = await word(page, 4);
	await joinedSelection(page, w, b);
	held.answerJoin(401);
	await expect(band(page, 'NOT KEPT')).toBeVisible();
	await expect(page.locator('.mk')).toHaveText(w.word);
	expect(await queued(page)).toHaveLength(1);
	// The re-queued quote is joined again, and this press is answered normally.
	const union = await joinedSelection(page, w, b);
	held.answerJoin('continue');
	await expect.poll(() => quotesOf(id).length).toBe(1);
	expect(String(quotesOf(id)[0].quote).replace(/\n/g, '')).toBe(union);
	expect(quotesOf(id)[0].note).toBe(w.note);
	// The held body arrives after the join: it lies inside that row, so it is
	// answered as the row (`made: false`), not a second one and not a DELETE.
	held.releaseQueue('continue');
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	await page.waitForTimeout(400);
	expect(held.deletes).toEqual([]);
	expect(quotesOf(id)).toHaveLength(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	await open(page, id);
	expect(quotesOf(id)).toHaveLength(1);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('R3 a reload with the quote re-queued draws it waiting, and the next connection sends it', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	const b = await word(page, 4);
	await joinedSelection(page, w, b);
	held.answerJoin(401);
	await expect(band(page, 'NOT KEPT')).toBeVisible();
	await expect(page.locator('.mk')).toHaveText(w.word);
	expect(await queued(page)).toHaveLength(1);
	// The page goes: the held POST gives up, and the item it was for stays on the
	// device. A reload must draw it waiting again, and its own door sends it.
	held.releaseQueue('abort');
	await page.unroute(QUOTES_POST);
	const again = await holdPost(page);
	// `page.reload`, not `open`: the fixture's `goto` waits for the network to go
	// quiet, and the POST this case means to hold never quiets it.
	await page.reload();
	await expect.poll(() => again.bodies.length, { timeout: 30_000 }).toBe(1);
	expect(again.bodies[0].note).toBe(w.note);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await page.keyboard.press('Escape');
	expect(await queued(page)).toHaveLength(1);
	again.release('continue');
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	expect(quotesOf(id)[0].note).toBe(w.note);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator(SETTLED).first()).toHaveText(w.word);
});

/**
 * Round 4 (c702): a join that waits on the device carries what it took in on
 * its own queue item, so a refusal at the flush puts those waiting quotes back
 * with their notes — and it survives a reload, since the join can sit in the
 * queue for sessions. The refusal is reachable without a bug in the reader: a
 * join covers the union of the spans it took in, and the workstation caps the
 * quote at 20,000 characters (`src/lib/server/highlights/quotes.ts`).
 */
test('R4 a join waiting on the device, refused at the flush, keeps the quote it covered', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const b = await word(page, 4);
	await selectThrough(page, w, b);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	// The join is the item now, and it carries the note of the quote it took in.
	await expect
		.poll(async () => (await queued(page)).some((i) => i.key !== w.key), { timeout: 30_000 })
		.toBe(true);
	const join = (await queued(page)).find((i) => i.key !== w.key)!;
	expect.soft(join.covers?.[0]?.key).toBe(w.key);
	expect.soft(join.covers?.[0]?.body.note).toBe(w.note);
	await expect.poll(async () => (await queued(page)).length).toBe(1);

	// Online, the flush sends it, and the workstation refuses the join itself.
	const posts = await refuseFirstPost(page);
	await page.context().setOffline(false);
	await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 30_000 });
	expect(posts()).toBeGreaterThanOrEqual(1);
	// The quote the join covered is drawn waiting again, with its note, and the
	// device still holds it: before the fix it existed nowhere.
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await page.keyboard.press('Escape');
	const back = (await queued(page)).find((i) => i.key === w.key);
	expect(back?.body.note).toBe(w.note);

	// Let it send: one row, with its note, and a marker over its words.
	await page.context().setOffline(true);
	await page.context().setOffline(false);
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	await open(page, id);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator(SETTLED).first()).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('R4 a join waiting across a reload, refused after it, keeps the quote it covered', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const b = await word(page, 4);
	await selectThrough(page, w, b);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect
		.poll(async () => (await queued(page)).some((i) => i.key !== w.key), { timeout: 30_000 })
		.toBe(true);
	const join = (await queued(page)).find((i) => i.key !== w.key)!;
	expect.soft(join.covers?.[0]?.key).toBe(w.key);
	expect.soft(join.covers?.[0]?.body.note).toBe(w.note);

	// The join sits on the device while the page that made it goes: its POST is
	// held across the reload, and only refused after the new page has read it.
	const held = await holdThenRefuse(page);
	await page.context().setOffline(false);
	await expect.poll(() => held.bodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
	await page.reload();
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('.flow')).toHaveCSS('column-gap', /px/);
	await expect.poll(() => held.bodies.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
	held.release();

	await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	const back = (await queued(page)).find((i) => i.key === w.key);
	expect(back?.body.note).toBe(w.note);

	await page.unroute(QUOTES_POST);
	await page.context().setOffline(true);
	await page.context().setOffline(false);
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	await open(page, id);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator(SETTLED).first()).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('R4 a colour chosen while its POST was out comes back with the quote the join took in', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	// The reconnection sent the waiting quote, and its POST is held.
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	// The reader turns it blue while that POST is out.
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Blue' }).click();
	await expect(page.locator('.mk').first()).toHaveClass(/\bblue\b/);
	await expect
		.poll(async () => (await queued(page)).find((i) => i.key === w.key)?.body.colour)
		.toBe('blue');
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);

	// A join over it, refused: the item put back must still say the colour changed.
	const b = await word(page, 4);
	await joinedSelection(page, w, b);
	held.answerJoin(401);
	await expect(band(page, 'NOT KEPT')).toBeVisible();
	await expect(page.locator('.mk')).toHaveText(w.word);
	const back = (await queued(page)).find((i) => i.key === w.key);

	// The held POST lands with the row it made from the body it sent (yellow):
	// only the carried list says to patch it to the blue the reader chose.
	held.releaseQueue('continue');
	await expect.poll(() => quotesOf(id)[0]?.colour, { timeout: 30_000 }).toBe('blue');
	expect(quotesOf(id)).toHaveLength(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	expect(back?.revised).toContain('colour');
	await open(page, id);
	await expect(page.locator(SETTLED).first()).toHaveClass(/\bblue\b/);
	await expect(page.locator('.nm')).toHaveCount(1);
});

/**
 * Round 5 (c702): UNDO restores what DELETE removed, all of it. A waiting join
 * carries the quotes it took in (`covers`), and DELETE takes the whole item
 * back. UNDO must put that item back as it was, or a later refusal of the join
 * loses the covered quote and its note for good.
 */
test('R5 UNDO of a deleted waiting join brings back the quote it covered', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	// The waiting quote's own marker, by the id the page drew it under.
	const wId = await page.locator('.mk').first().getAttribute('data-h');
	// Still offline: a selection over it makes the join, which waits with its covers.
	const b = await word(page, 4);
	await selectThrough(page, w, b);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect
		.poll(async () => (await queued(page)).some((i) => i.key !== w.key), { timeout: 30_000 })
		.toBe(true);
	const join = (await queued(page)).find((i) => i.key !== w.key)!;
	expect.soft(join.covers?.[0]?.key).toBe(w.key);
	expect.soft(join.covers?.[0]?.body.note).toBe(w.note);
	expect(await queued(page)).toHaveLength(1);
	// The join covers the waiting quote: its marker is not drawn beside it.
	await expect(page.locator(`.mk[data-h="${wId}"]`)).toHaveCount(0);

	// DELETE the join, then UNDO: it is the same join, and must keep what it covers.
	await expect(page.locator('.mk').first()).toBeVisible();
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(band(page, 'HIGHLIGHT DELETED')).toBeVisible();
	await expect(page.locator('.mk')).toHaveCount(0);
	expect(await queued(page)).toHaveLength(0);
	await band(page, 'HIGHLIGHT DELETED').getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.mk').first()).toBeVisible();
	const again = await queued(page);
	expect(again).toHaveLength(1);
	expect(again[0].key).toBe(join.key);
	// The UNDO is DELETE's inverse: the covers come back with the item.
	expect.soft(again[0].covers?.map((c) => c.key)).toEqual([w.key]);
	expect.soft(again[0].covers?.[0]?.body.note).toBe(w.note);

	// Online with the join refused: the quote it covered must be drawn waiting.
	const posts = await refuseFirstPost(page);
	await page.context().setOffline(false);
	await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 30_000 });
	expect(posts()).toBeGreaterThanOrEqual(1);
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	const back = (await queued(page)).find((i) => i.key === w.key);
	expect(back?.body.note).toBe(w.note);

	// Let it send, reload, and one row with its note and a marker stands.
	await page.context().setOffline(true);
	await page.context().setOffline(false);
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	await open(page, id);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator(SETTLED).first()).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
});

test('R5 UNDO of a join deleted while its POST is out brings back the quote it covered', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	// The reconnection started sending the waiting quote, and it is held.
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	const b = await word(page, 4);
	await joinedSelection(page, w, b);
	await expect(page.locator('.mk').first()).toBeVisible();
	// DELETE while the join's POST is out, and let that POST end unreachable: the
	// join waits on the device, and what it covered is still in the reader's map.
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	held.answerJoin('abort');
	await expect(band(page, 'HIGHLIGHT DELETED')).toBeVisible();
	await expect(page.locator('.mk')).toHaveCount(0);
	expect((await queued(page)).filter((i) => !i.refused)).toHaveLength(0);
	// UNDO: the join is back, and must keep the waiting quote it took in.
	await band(page, 'HIGHLIGHT DELETED').getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.mk').first()).toBeVisible();
	const again = (await queued(page)).find((i) => !i.refused);
	expect.soft(again?.covers?.map((c) => c.key)).toEqual([w.key]);
	expect.soft(again?.covers?.[0]?.body.note).toBe(w.note);
	// The first pass is still holding the waiting quote's own POST: let it end
	// unreachable, so the queue's next try reaches the join that waits beside it.
	held.releaseQueue('abort');
	held.answerJoin(400);
	await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 40_000 });
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	const back = (await queued(page)).find((i) => i.key === w.key);
	expect(back?.body.note).toBe(w.note);
	// It sends at the next connection: one row survives.
	held.answerJoin('continue');
	await page.context().setOffline(true);
	await page.context().setOffline(false);
	await expect
		.poll(async () => (await queued(page)).filter((i) => !i.refused).length, { timeout: 30_000 })
		.toBe(0);
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	await open(page, id);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	await expect(page.locator(SETTLED).first()).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
});

/**
 * Round 6 (c702): the exact re-press of a waiting quote. The press supersedes
 * the item and queues the same key again (`waitOnDevice`'s own-span branch:
 * `j.waiting === key`). What the reader changed while it waited — a colour
 * chosen in the sheet — lives on the taken-back item, not on the drawn quote
 * alone, and must ride the new item: the door answers the repeat with the row
 * it already holds (`made: false`), and only the item's `revised` says a colour
 * PATCH is owed.
 */
test('R6 the exact re-press of a waiting quote carries the colour the reader chose', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	await page.context().setOffline(true);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	// Turn it blue while it waits, as the sheet edits what waits.
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Blue' }).click();
	await expect(page.locator('.mk').first()).toHaveClass(/\bblue\b/);
	await expect.poll(async () => (await queued(page))[0]?.body.colour).toBe('blue');
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);

	// Its earlier POST reached the workstation, but the answer was lost: the row
	// is here, yellow, and the item stayed. Its own span is what finds it again.
	const item = (await queued(page))[0] as unknown as { body: Record<string, unknown> };
	seedQuote(id, item.body, 'yellow');

	// The exact re-press of the same word: same key, and the item that replaces
	// it must still say the colour changed, or the repeat's answer loses it.
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await page.waitForTimeout(500);
	expect(await queued(page)).toHaveLength(1);
	const again = (await queued(page))[0];
	expect(again.body.colour).toBe('blue');
	expect(again.revised).toContain('colour');

	// Online, the door answers the repeat with the yellow row it holds; the
	// colour the reader chose is a PATCH after it.
	await page.context().setOffline(false);
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	await expect.poll(() => quotesOf(id)[0]?.colour, { timeout: 30_000 }).toBe('blue');
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	// A reload draws the one row, blue, with a marker over its words.
	await open(page, id);
	await expect(page.locator(SETTLED).first()).toHaveClass(/\bblue\b/);
	expect(quotesOf(id)).toHaveLength(1);
	expect(quotesOf(id)[0].colour).toBe('blue');
});

/**
 * Round 7 (c702): a DELETE inside the press's own POST. `waitOnDevice` returns
 * at once for a DELETE that came first, so `deleteQuote`'s in-flight door is
 * the one that answers UNDO. On the exact re-press of a waiting quote W the
 * press is W itself, not something it covers: what W carried — the colour the
 * reader chose while it waited — must ride the UNDONE item, or the repeat's
 * answer is the yellow row and no PATCH follows.
 */
test('R7 UNDO of a waiting quote deleted in flight keeps the colour chosen while it waited', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	await page.context().setOffline(true);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	// Turn it blue while it waits, as the sheet edits what waits.
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Blue' }).click();
	await expect(page.locator('.mk').first()).toHaveClass(/\bblue\b/);
	await expect.poll(async () => (await queued(page))[0]?.body.colour).toBe('blue');
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
	// Its earlier POST reached the workstation, but the answer was lost: the row
	// is here, yellow, and the item stayed.
	const item = (await queued(page))[0] as unknown as { body: Record<string, unknown> };
	seedQuote(id, item.body, 'yellow');

	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);

	// The exact re-press of the same word, while the first POST is out.
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => held.posts(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
	// DELETE while that POST is out, and let it end unreachable.
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	held.answerJoin('abort');
	await expect(band(page, 'HIGHLIGHT DELETED')).toBeVisible();
	// UNDO: the item is W again, and W's colour must come with it.
	await band(page, 'HIGHLIGHT DELETED').getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.mk').first()).toBeVisible();
	const again = (await queued(page)).find((i) => !i.refused);
	expect(again?.revised).toContain('colour');

	// The first POST ends, the UNDOne item goes and the door answers with the
	// yellow row it holds: only the carried revised says a colour PATCH is owed.
	held.releaseQueue('abort');
	held.answerJoin('continue');
	await page.context().setOffline(true);
	await page.context().setOffline(false);
	await expect.poll(() => quotesOf(id)[0]?.colour, { timeout: 30_000 }).toBe('blue');
	expect(quotesOf(id)).toHaveLength(1);
});

/**
 * Round 8 (c702): the same in-flight door, for a join W over a waiting quote X.
 * The exact re-press of W makes W the item again, and W's own covers (X, note
 * included) must ride the UNDONE item, or a later refusal of W skips the cover
 * under its own key and X exists nowhere.
 */
test('R8 UNDO of a join deleted in flight keeps the quote it covered', async ({ page }) => {
	const id = chapterId();
	await open(page, id);
	const x = await waitingQuote(page);
	// Still offline: a selection over X makes a join that covers it.
	const b = await word(page, 4);
	await selectThrough(page, x, b);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect
		.poll(async () => (await queued(page)).some((i) => i.key !== x.key), { timeout: 30_000 })
		.toBe(true);
	const join = (await queued(page)).find((i) => i.key !== x.key)!;
	expect(join.covers?.[0]?.key).toBe(x.key);
	expect(await queued(page)).toHaveLength(1);

	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);

	// The exact re-press of the join: pressing the word inside it grows the span
	// to the join itself, so the new press is W under W's key.
	await longPress(page, x.x, x.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => held.posts(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	held.answerJoin('abort');
	await expect(band(page, 'HIGHLIGHT DELETED')).toBeVisible();
	// UNDO: W comes back, and the quote it covered must come with it.
	await band(page, 'HIGHLIGHT DELETED').getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.mk').first()).toBeVisible();
	const again = (await queued(page)).find((i) => !i.refused);
	expect.soft(again?.covers?.map((c) => c.key)).toEqual([x.key]);
	expect.soft(again?.covers?.[0]?.body.note).toBe(x.note);

	// The queue's own POST ends, the UNDOne join is refused: the quote it took
	// in is drawn waiting again, with its note, and is back on the device.
	held.releaseQueue('abort');
	held.answerJoin(400);
	await page.context().setOffline(true);
	await page.context().setOffline(false);
	await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 40_000 });
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(x.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await page.keyboard.press('Escape');
	const back = (await queued(page)).find((i) => i.key === x.key);
	expect(back?.body.note).toBe(x.note);
});

/**
 * Round 9 (c702, wave 46): the chapter's own re-read can land after a press took
 * a saved row in. `onQueueChange`'s refused event calls `loadMarks`, whose GET
 * may still be out when the press removes that row from `quotes`; the answer it
 * carries names the row again, so `fresh` draws it beside the press that covers
 * it: two markers over the same words, and the sheet can open the row the join
 * already took in. A refusal is what re-reads the chapter here, and both ends of
 * the press's own answer are run: a fold into the saved row, and a refusal that
 * puts the saved row back. Either way the words are drawn once.
 */
const QUOTES_GET = '**/api/highlights/quotes?entry=*';

for (const how of ['lands', 'refused'] as const) {
	test(`R9 a join over a saved row while the chapter's quotes are re-read draws it once (the press ${how})`, async ({
		page
	}) => {
		const id = chapterId();
		await open(page, id);
		// The saved row, made through the app: the press below lands on its word.
		const x = await keepWord(page, id, 2);
		const rowId = quotesOf(id)[0].id as number;

		// A waiting quote whose refusal is the event that re-reads the chapter.
		await page.context().setOffline(true);
		const q = await word(page, 5);
		await longPress(page, q.x, q.y);
		await expect(bar(page)).toBeVisible();
		await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
		await expect.poll(async () => (await queued(page)).length).toBe(1);

		// The re-read is answered from the database now and delivered later, so its
		// answer still names the saved row when the press has taken it in. The
		// press's own POST is held for the same reason: its answer ends that state.
		let deliver!: () => void;
		const gate = new Promise<void>((ok) => (deliver = ok));
		let answered = false;
		await page.route(QUOTES_GET, async (r) => {
			const res = await r.fetch();
			answered = true;
			await gate;
			await r.fulfill({ response: res }).catch(() => undefined);
		});
		let posts = 0;
		let endJoin!: () => void;
		const joinGate = new Promise<void>((ok) => (endJoin = ok));
		await page.route(QUOTES_POST, async (r) => {
			if (r.request().method() !== 'POST') return r.continue();
			posts++;
			// The waiting quote is refused on arrival: the refusal re-reads the chapter.
			if (posts === 1) return r.fulfill({ status: 400, body: 'no' });
			await joinGate;
			return how === 'lands' ? r.continue() : r.fulfill({ status: 400, body: 'no' });
		});

		await page.context().setOffline(false);
		await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 30_000 });
		await expect.poll(() => answered, { timeout: 30_000 }).toBe(true);

		// Inside the saved row, while its chapter's list is on its way back.
		await longPress(page, x.x, x.y);
		await expect(bar(page)).toBeVisible();
		await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
		await expect.poll(() => posts, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

		// The held list lands. Its arrival is seen in the page's own paint: `loadMarks`
		// ends by drawing every marker again, so the mark standing now is replaced.
		await page.evaluate(() => document.querySelector('.mk')?.setAttribute('data-before', '1'));
		deliver();
		await page.waitForFunction(() => !document.querySelector('.mk[data-before]'), null, {
			timeout: 10_000
		});
		// The row the press took in must not be drawn beside it.
		await expect(page.locator('.mk')).toHaveCount(1);
		await expect(page.locator('.mk')).toHaveText(x.word);

		// The press's own answer, either end: one row, drawn once, after a reload too.
		endJoin();
		await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
		expect(quotesOf(id)[0].id).toBe(rowId);
		await expect(page.locator('.mk')).toHaveCount(1);
		await open(page, id);
		await expect(page.locator('.mk')).toHaveCount(1);
		await expect(page.locator('.mk')).toHaveText(x.word);
		expect(quotesOf(id)).toHaveLength(1);
	});
}

/**
 * Round 11 (c702, wave 46): DISMISS is not a door onto a cover. The refusal puts
 * each waiting quote back before the join is stored refused (`sendAll`), so the
 * band's DISMISS only takes the refused item: the quote it covered stays drawn,
 * stays on the device with its note, and is sent at the next connection. The
 * notes' table had this row marked 'not a door' with no case.
 */
test('R11 DISMISS takes only the refused join: the quote it covered stays waiting', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);
	const refused = await refuseFirstPost(page);
	const b = await word(page, 4);
	await selectThrough(page, w, b);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	// Online, the join is refused: the quote it covered is put back and drawn.
	await page.context().setOffline(false);
	await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 30_000 });
	expect(refused()).toBe(1);
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	// DISMISS takes the refused join and nothing else.
	await band(page, 'NOT KEPT').getByRole('button', { name: 'DISMISS' }).click();
	await expect(band(page, 'NOT KEPT')).toHaveCount(0);
	const left = await queued(page);
	expect(left.map((i) => i.key)).toEqual([w.key]);
	expect(left[0].body.note).toBe(w.note);
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	// It goes at the next connection, and one row with its note stands.
	await page.context().setOffline(true);
	await page.context().setOffline(false);
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	await open(page, id);
	await expect(page.locator(SETTLED)).toHaveText(w.word);
	expect(quotesOf(id)).toHaveLength(1);
});

/**
 * Round 12 (c702, wave 46): the in-flight DELETE door's band with no UNDO. The
 * door consumes its carry when it builds the band (`carryFor` reads the stash,
 * or `carriedBy` on the early-return path R7 takes), so nothing waits on the
 * reader's press: leaving the band alone for its six seconds must draw nothing,
 * queue nothing, and bring nothing back. The row the press's lost answer had
 * already made is still the one row, as it was before the press.
 */
test('R12 a DELETE left un-undone in flight leaves nothing drawn and nothing waiting', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	await page.context().setOffline(true);
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(page.locator('.mk')).toHaveText(w.word);
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	// The item's earlier POST reached the workstation and its answer was lost: the row is there.
	const item = (await queued(page))[0] as unknown as { body: Record<string, unknown> };
	seedQuote(id, item.body, 'yellow');

	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	// The exact re-press, then DELETE while that POST is out, and the POST fails.
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => held.posts(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	held.answerJoin('abort');
	await expect(band(page, 'HIGHLIGHT DELETED')).toBeVisible();
	// No UNDO: the band's six seconds run out.
	await expect(band(page, 'HIGHLIGHT DELETED')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.locator('.mk')).toHaveCount(0);
	expect((await queued(page)).filter((i) => !i.refused)).toHaveLength(0);
	held.releaseQueue('abort');
	// What the press's lost answer made is the row that was already there: one, yellow.
	await open(page, id);
	await expect(page.locator(SETTLED)).toHaveText(w.word);
	expect(quotesOf(id)).toHaveLength(1);
	expect(quotesOf(id)[0].colour).toBe('yellow');
});

/**
 * Round 13 (c702, wave 46): the press that may not wait. In reveal a hidden
 * series is read but nothing is queued (`mayWait`), and a press that took a
 * waiting quote in would otherwise keep it off the device for good. Its end here
 * is `restoreJoinedWaiting`: the quote comes back under its own key with its
 * note, and the join that may not wait leaves nothing. The case is set up the
 * way a reader reaches it: the quote queued while the series was shown, then the
 * series hidden and reveal opened, with the queue's own POST held so the quote
 * is still waiting when the reveal page loads.
 */
test('R13 a press in reveal puts back the waiting quote it took in, and keeps the join off the device', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const w = await waitingQuote(page);

	// The queue's own POST is refused on arrival, the "stop" end: the quote stays
	// waiting across the reload that opens the hidden series in reveal.
	await page.route(QUOTES_POST, (r) =>
		r.request().method() !== 'POST' ? r.continue() : r.abort()
	);
	await page.context().setOffline(false);
	// Hidden, with reveal: this page keeps highlights and queues none.
	const d = db();
	d.prepare(`UPDATE series SET hidden = 1 WHERE title = 'Mushoku Tensei'`).run();
	d.close();
	await page.context().addCookies([{ name: 'tsundoku_reveal', value: '1', url: base }]);
	await open(page, id);
	await expect(page.locator('.mk')).toHaveText(w.word);

	await page.context().setOffline(true);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect(
		page.getByRole('status').filter({ hasText: 'HIGHLIGHT NEEDS THE WORKSTATION' })
	).toBeVisible();
	// The join leaves nothing on the device, and the quote it took in is drawn
	// waiting again under its own key.
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(w.word);
	const back = await queued(page);
	expect(back).toHaveLength(1);
	expect(back[0].key).toBe(w.key);
	expect(back[0].body.note).toBe(w.note);
	await page.unroute(QUOTES_POST);

	// Shown again, it is sent as it was: one row, and its note with it.
	const e = db();
	e.prepare(`UPDATE series SET hidden = 0 WHERE title = 'Mushoku Tensei'`).run();
	e.close();
	await page.context().clearCookies({ name: 'tsundoku_reveal' });
	await page.context().setOffline(false);
	await open(page, id);
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	expect(quotesOf(id)[0].note).toBe(w.note);
	await expect(page.locator(SETTLED)).toHaveText(w.word);
});

/**
 * Round 14 (c702, wave 46): the browser that will not keep the queue. A press
 * that cannot be put on the device says so (`NOT KEPT`), and the saved row it
 * took in is drawn again by `settleQuote`, not lost with the join. The notes'
 * table marked this row `none`, on the claim that a browser's refused storage
 * cannot be made here; it can: an init script takes `indexedDB` away before the
 * reader mounts, which is the same `false` `queueHighlight` returns on a refused
 * `put`.
 */
test('R14 a browser that will not keep the queue: the press says so, and the row it took in stays', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const x = await keepWord(page, id, 2);
	await page.addInitScript(() => {
		Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
	});
	await open(page, id);
	await expect(page.locator(SETTLED)).toHaveText(x.word);

	await page.context().setOffline(true);
	await longPress(page, x.x, x.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	const told = band(page, 'NOT KEPT');
	await expect(told).toBeVisible();
	await expect(told).toContainText('THE WORKSTATION DID NOT ANSWER');
	// The row the press took in is back where it was, drawn once, and still the only row.
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator(SETTLED)).toHaveText(x.word);
	expect(quotesOf(id)).toHaveLength(1);
	// Nothing waits anywhere: the device refused the item, so no reload brings one.
	await page.context().setOffline(false);
	await open(page, id);
	await expect(page.locator('.mk')).toHaveCount(1);
	expect(quotesOf(id)).toHaveLength(1);
});

/**
 * Holds every open of the queue's database until `release`, as R2's "deleted
 * while the device is still writing it down" does: the store opens a connection
 * per read and write (`pending-highlights.ts`, `tx`), so this holds the device's
 * real IndexedDB write, not a stand-in for it, and a DELETE can land inside it.
 * Installed before the page loads; `hold` arms it, `release` lets every held
 * open through in the order it was asked for.
 */
async function gateQueueDb(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as { dbGate?: Promise<void> };
		const open = IDBFactory.prototype.open;
		IDBFactory.prototype.open = function (this: IDBFactory, ...a: [string, number?]) {
			const r = open.apply(this, a);
			if (w.dbGate)
				Object.defineProperty(r, 'onsuccess', {
					set(f: (e: Event) => void) {
						r.addEventListener('success', (e) => void w.dbGate!.then(() => f(e)));
					}
				});
			return r;
		};
	});
	return {
		hold: () =>
			page.evaluate(() => {
				const w = window as unknown as { dbGate?: Promise<void>; openDb?: () => void };
				w.dbGate = new Promise<void>((ok) => (w.openDb = ok));
			}),
		release: () =>
			page.evaluate(() => {
				const w = window as unknown as { dbGate?: Promise<void>; openDb?: () => void };
				w.openDb!();
				delete w.dbGate;
			})
	};
}

/**
 * Round 15 (c702, wave 46): the door R7 and R8 never reach. A DELETE that lands
 * while the device is still writing the press down finds `waitOnDevice` past its
 * early return: the item is written, then taken back (`takeBackHighlight`), and
 * the take-back clears `remembered` for the item's own key. On the exact
 * re-press of a waiting join W, that key is W's, so the only copy of what W
 * carried (its colour, and the quote X it covered, note and all) is the item
 * the take-back returned, which `waitOnDevice` keeps in `takenInFlight` for the
 * in-flight door's UNDO. The notes called this window untimeable; R2's gate on
 * the queue's own database opens reaches it.
 */
test('R15 UNDO of a re-press deleted while the device writes it keeps its colour and its quote', async ({
	page
}) => {
	const gate = await gateQueueDb(page);
	const id = chapterId();
	await open(page, id);
	const x = await waitingQuote(page);
	// Still offline: W joins X, and W is turned blue while it waits.
	const b = await word(page, 4);
	await selectThrough(page, x, b);
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect
		.poll(async () => (await queued(page)).some((i) => i.key !== x.key), { timeout: 30_000 })
		.toBe(true);
	const w = (await queued(page)).find((i) => i.key !== x.key)!;
	expect(w.covers?.map((c) => c.key)).toEqual([x.key]);
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Blue' }).click();
	await expect.poll(async () => (await queued(page))[0]?.revised).toContain('colour');
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);

	// The exact re-press of W, with the device's write held, and DELETE inside it.
	await gate.hold();
	await longPress(page, x.x, x.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	// The press is drawn at once (a join of several words is painted in several marks).
	await expect(bar(page)).toHaveCount(0);
	await expect(page.locator('.mk').first()).toBeVisible();
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(page.locator('.mk')).toHaveCount(0);
	await gate.release();
	const deleted = band(page, 'HIGHLIGHT DELETED');
	await expect(deleted).toBeVisible();
	// The write was made and taken back: nothing waits until UNDO.
	await expect.poll(async () => (await queued(page)).length).toBe(0);

	await deleted.getByRole('button', { name: 'UNDO' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	const again = (await queued(page))[0];
	expect(again.key).toBe(w.key);
	expect.soft(again.revised).toContain('colour');
	expect.soft(again.covers?.map((c) => c.key)).toEqual([x.key]);
	expect.soft(again.covers?.[0]?.body.note).toBe(x.note);

	// Refused at the next connection: X is put back, drawn waiting with its note.
	await refuseFirstPost(page);
	await page.context().setOffline(false);
	await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk')).toHaveText(x.word);
	await expect(page.locator('.nm')).toHaveCount(1);
	const back = (await queued(page)).find((i) => i.key === x.key);
	expect(back?.body.note).toBe(x.note);
});

/**
 * Round 16 (c702, wave 46): the in-flight DELETE door's band across a chapter's
 * end. `carryFor` has consumed the carry when the band is drawn, and the band
 * outlives the turn, so UNDO on the next chapter must queue W under its own
 * chapter, with what it carried, and draw nothing on the chapter it is not of.
 */
test('R16 UNDO of a re-press deleted in flight, after a crossing, keeps it under its own chapter', async ({
	page
}) => {
	const first = chapterId(1);
	const second = chapterId(2);
	await openLast(page, first);
	await page.context().setOffline(true);
	const w = await word(page, 1);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	const key = (await queued(page))[0].key;
	expect(key).toContain(`quote:${first}:`);
	await page.locator('.mk').first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByRole('button', { name: 'Blue' }).click();
	await expect.poll(async () => (await queued(page))[0]?.revised).toContain('colour');
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);

	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => held.posts(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
	await page.locator('.mk').first().click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	held.answerJoin('abort');
	const deleted = band(page, 'HIGHLIGHT DELETED');
	await expect(deleted).toBeVisible();

	await cross(page);
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${second}`);
	await deleted.getByRole('button', { name: 'UNDO' }).click();
	await expect.poll(async () => (await queued(page)).filter((i) => !i.refused).length).toBe(1);
	const item = (await queued(page)).find((i) => !i.refused)!;
	expect(item.key).toBe(key);
	expect(item.entry).toBe(first);
	expect(item.body.entry).toBe(first);
	expect(item.revised).toContain('colour');
	// Not drawn on the chapter it is not of.
	await expect(page.locator('.mk')).toHaveCount(0);
	held.releaseQueue('abort');
});

/**
 * Round 17 (c702, wave 46; fixed in round 4): a device whose storage stops
 * keeping new writes after a quote already waits there (a full quota: a delete
 * still goes through, a larger put is aborted, here by the browser's own
 * `abort()`). Every press that covers that quote used to take it off the device
 * first (`supersedeHighlight`) and then fail to write itself, and the quote's
 * way back was another `put`: the quote and its note existed nowhere. Since
 * round 4 a waiting quote leaves the device only once the press that covers it
 * is kept, so each door below leaves it waiting, drawn, with its note: a join
 * offline (`queueCovering` refused), the exact re-press of the quote itself
 * (one write over the item, refused), and a join online that the workstation
 * refuses (`restoreJoinedWaiting` draws it again without a write).
 */
for (const door of ['a join offline', 'the exact re-press', 'a join refused online'] as const) {
	test(`R17 storage that stops keeping writes: ${door} does not lose the waiting quote`, async ({
		page
	}) => {
		await page.addInitScript(() => {
			const put = IDBObjectStore.prototype.put;
			IDBObjectStore.prototype.put = function (
				this: IDBObjectStore,
				...a: [unknown, IDBValidKey?]
			) {
				const r = put.apply(this, a);
				if ((window as unknown as { refusePut?: boolean }).refusePut) this.transaction.abort();
				return r;
			};
		});
		const id = chapterId();
		await open(page, id);
		const x = await waitingQuote(page);
		const held = door === 'a join refused online' ? await holdQueueThenJoin(page) : null;
		if (held) {
			await page.context().setOffline(false);
			await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
		}
		await page.evaluate(() => ((window as unknown as { refusePut?: boolean }).refusePut = true));
		if (door === 'the exact re-press') {
			await longPress(page, x.x, x.y);
			await expect(bar(page)).toBeVisible();
		} else {
			await selectThrough(page, x, await word(page, 4));
		}
		await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
		held?.answerJoin(400);
		await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 30_000 });
		// The quote that waited before the press still waits, drawn, with its note.
		await expect(page.locator('.mk')).toHaveCount(1);
		await expect(page.locator('.mk')).toHaveText(x.word);
		await expect(page.locator('.nm')).toHaveCount(1);
		const left = await queued(page);
		expect(left.map((i) => i.key)).toEqual([x.key]);
		expect(left[0].body.note).toBe(x.note);
		held?.releaseQueue('abort');
	});
}

/**
 * Round 19 (c702, round 4): the new state round 4 makes. A waiting quote now
 * stays on the device while the press that covers it is out, so two things can
 * reach it there that could not before.
 *
 * (a) The chapter is re-read meanwhile (a refusal of another quote does it):
 * `loadMarks` reads the device and would draw the covered quote again beside the
 * press over it. `covering` keeps it off, as `joining` does for a saved row (R9).
 *
 * (b) The queue sends the covered quote while the press is out, and the press is
 * then refused: the quote is no longer on the device, so `restoreJoinedWaiting`
 * puts it back as it was (the door answers the repeat with the row it made) and
 * it ends drawn once, as its one row, with its note.
 */
test('R19 a re-read while a join over a waiting quote is out draws the quote once', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	// A quote whose refusal is what re-reads the chapter, queued first so it goes first.
	await page.context().setOffline(true);
	const q = await word(page, 7);
	await longPress(page, q.x, q.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(1);
	// x, waiting with its note (`waitingQuote`, made by hand: q is drawn already).
	const w = await word(page, 2);
	await longPress(page, w.x, w.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(async () => (await queued(page)).length).toBe(2);
	await page.locator('.mk', { hasText: w.word }).first().click();
	await expect(sheet(page).getByText('WAITING TO BE SENT')).toBeVisible();
	await sheet(page).getByLabel('NOTE').fill(KEPT_NOTE);
	await expect
		.poll(async () => (await queued(page)).find((i) => i.body.note === KEPT_NOTE)?.key)
		.toBeTruthy();
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
	const x = { ...w, note: KEPT_NOTE };

	let deliver!: () => void;
	const gate = new Promise<void>((ok) => (deliver = ok));
	let answered = false;
	await page.route(QUOTES_GET, async (r) => {
		const res = await r.fetch();
		answered = true;
		await gate;
		await r.fulfill({ response: res }).catch(() => undefined);
	});
	// The first POST is q's, refused; the second is x's own, unreachable, which
	// ends the pass (a refusal is told at a pass's end) and leaves x on the device;
	// the third is the join's, held until the end.
	let posts = 0;
	let endJoin!: () => void;
	const joinGate = new Promise<void>((ok) => (endJoin = ok));
	await page.route(QUOTES_POST, async (r) => {
		if (r.request().method() !== 'POST') return r.continue();
		posts++;
		if (posts === 1) return r.fulfill({ status: 400, body: 'no' });
		if (posts === 2) return r.abort();
		await joinGate;
		return r.continue().catch(() => undefined);
	});
	await page.context().setOffline(false);
	await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 30_000 });
	await expect.poll(() => answered, { timeout: 30_000 }).toBe(true);
	await expect.poll(() => posts, { timeout: 30_000 }).toBe(2);

	// The join over x, while the chapter's list is on its way back.
	await selectThrough(page, x, await word(page, 4));
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => posts, { timeout: 30_000 }).toBe(3);
	expect((await queued(page)).some((i) => i.body.note === x.note)).toBe(true);

	await page.evaluate(() =>
		document.querySelectorAll('.mk').forEach((m) => m.setAttribute('data-before', '1'))
	);
	deliver();
	await page.waitForFunction(() => !document.querySelector('.mk[data-before]'), null, {
		timeout: 10_000
	});
	// One highlight is drawn over those words: the join's, not x beside it.
	const drawn = await page.evaluate(
		() => new Set([...document.querySelectorAll('.mk')].map((m) => m.getAttribute('data-h'))).size
	);
	expect(drawn).toBe(1);

	// Both POSTs end: one row, with x's note, drawn once.
	endJoin();
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	expect(quotesOf(id)[0].note).toBe(x.note);
	await open(page, id);
	await expect(page.locator(SETTLED).first()).toBeVisible();
	expect(quotesOf(id)).toHaveLength(1);
});

test('R19 the queue sends a covered quote while its join is out, and the join is refused: one row', async ({
	page
}) => {
	const id = chapterId();
	await open(page, id);
	const x = await waitingQuote(page);
	const held = await holdQueueThenJoin(page);
	await page.context().setOffline(false);
	await expect.poll(held.held, { timeout: 30_000 }).toBe(true);
	await selectThrough(page, x, await word(page, 4));
	await bar(page).getByRole('button', { name: 'HIGHLIGHT' }).click();
	await expect.poll(() => held.posts(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
	// x's own POST lands while the join is out: its row is made, and x leaves the device as sent.
	held.releaseQueue('continue');
	await expect.poll(() => quotesOf(id).length, { timeout: 30_000 }).toBe(1);
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	// The join is refused: x is not on the device to draw, so it is put back as it
	// was, and the next pass is answered with the row x already made.
	held.answerJoin(400);
	await expect(band(page, 'NOT KEPT')).toBeVisible({ timeout: 30_000 });
	await expect.poll(async () => (await queued(page)).map((i) => i.key)).toContain(x.key);
	// Its repeat goes through to the door, which answers with x's row.
	held.answerJoin('continue');
	await page.context().setOffline(true);
	await page.context().setOffline(false);
	await expect(page.locator(SETTLED)).toHaveText(x.word, { timeout: 30_000 });
	await expect(page.locator('.nm')).toHaveCount(1);
	await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);
	expect(quotesOf(id)).toHaveLength(1);
	expect(quotesOf(id)[0].note).toBe(x.note);
	expect(held.deletes).toEqual([]);
});

/**
 * Round 20 (c702, round 4; R13's cause): a chapter's list of quotes taken before
 * a waiting quote of that chapter is sent. The reader draws a chapter from its
 * list (the page's own load, or the next chapter's prefetch) and from the
 * device, read when the chapter opens. A quote sent in between is in neither:
 * the list predates its row, and the device no longer holds it, so it was drawn
 * nowhere until the next load. R13 met it through the page's load (its reveal
 * page sent the quote as the case reopened the chapter); this case reaches it
 * through the prefetch, where the timing is the case's own: the quote is sent
 * from the chapter before, after its list was fetched, and the reader crosses.
 */
test('R20 a quote sent after its chapter was prefetched is drawn when that chapter opens', async ({
	page
}) => {
	const first = chapterId(1);
	const second = chapterId(2);
	await open(page, second);
	const w = await waitingQuote(page);
	// It stays on the device: its POST does not reach the workstation yet.
	await page.route(QUOTES_POST, (r) =>
		r.request().method() === 'POST' ? r.abort() : r.continue()
	);
	await page.context().setOffline(false);
	// SCROLL, by the series' own setting: there the next chapter is laid out below
	// this one, and its list fetched with it (`loadNext`).
	const d = db();
	d.prepare(`UPDATE series SET direction = 'scroll' WHERE title = 'Mushoku Tensei'`).run();
	d.close();
	try {
		const prefetch = page.waitForResponse(
			(r) => r.url().includes(`/api/highlights/quotes?entry=${second}`),
			{ timeout: 30_000 }
		);
		await page.goto(`/read/${first}?at=2.0`);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
		// The next chapter's list is fetched before its quote is sent: empty.
		const listed = (await (await prefetch).json()) as { quotes: unknown[] };
		expect(listed.quotes).toHaveLength(0);
		expect((await queued(page)).map((i) => i.key)).toEqual([w.key]);

		// Sent from this chapter's page, where it is not drawn: one row, the device empty.
		await page.unroute(QUOTES_POST);
		await page.context().setOffline(true);
		await page.context().setOffline(false);
		await expect.poll(() => quotesOf(second).length, { timeout: 30_000 }).toBe(1);
		await expect.poll(async () => (await queued(page)).length, { timeout: 30_000 }).toBe(0);

		// Reading on into the next chapter, and stopping at the crossing: the URL is
		// written once the reader settles, so the copy kept above is the crossing's sign.
		await page.locator('.page').evaluate(async (el) => {
			for (let i = 0; i < 400 && !document.querySelector('.kept')?.childElementCount; i++) {
				el.scrollTop = el.scrollTop + 200;
				await new Promise((r) => requestAnimationFrame(r));
			}
		});
		await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${second}`);
		// Its row is what the chapter shows, with its note.
		await expect(page.locator(`.blocks ${SETTLED}`)).toHaveText(w.word, { timeout: 10_000 });
	} finally {
		const e = db();
		e.prepare(`UPDATE series SET direction = NULL WHERE title = 'Mushoku Tensei'`).run();
		e.close();
	}
});
