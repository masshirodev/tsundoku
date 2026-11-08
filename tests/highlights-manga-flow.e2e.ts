import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { expect, readerReady, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';
import { startPreview } from './highlights-preview';

/**
 * Highlights H3 end to end (card c703; doc/HIGHLIGHTS.md, "Pages"; Manga
 * M1–M7): the image reader's HIGHLIGHT cell, its states (KEEPING… until the
 * workstation answers, ✓ HIGHLIGHTED after, offline and incognito dimmed),
 * the scrubber's tick, the gutter rule, the page's sheet (NOTE, SAVE IMAGE,
 * DELETE with UNDO), H on a keyboard, the page menu's row, a spread's choice
 * and the strip's page; a late answer and a failure, through the reader's
 * own requests held or refused by the route.
 *
 * It keeps pages, so it seeds the seed into a database of its own and serves
 * the same build on a port the OS gives it (the `highlights-flow`
 * arrangement); nothing else sees what it writes. A `*-flow.e2e.ts`, so it
 * runs once, in tablet-portrait; the spread and the gutter rule are a
 * describe at the tablet's landscape, where spreads are offered.
 */
test.describe.configure({ mode: 'serial', timeout: 60_000 });

const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const scratch = join(tmpdir(), `tsundoku-e2e-highlights-manga-${process.pid}`);
const dbPath = join(scratch, 'library.sqlite');
const home = join(scratch, 'home');
let server: ChildProcess | null = null;

// The cases steer the reader's own requests with `page.route`, which never
// sees a request the service worker answers for the page once it controls it:
// the fourth case's refused keep reached the workstation and kept the page.
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
					TSUNDOKU_HOME: home
				},
				stdio: 'ignore'
			}),
		base,
		'the manga highlights preview'
	);
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(scratch, { recursive: true, force: true });
});

function sql<T>(q: string, ...args: unknown[]): T[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db.prepare(q).all(...args) as T[];
	} finally {
		db.close();
	}
}
const firstEntry = (title: string) =>
	sql<{ id: number }>(
		`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id WHERE s.title = ?
		ORDER BY e.position LIMIT 1`,
		title
	)[0].id;
type Row = { id: number; kind: string; page: number; page_end: number | null; note: string };
const kept = (entry: number) =>
	sql<Row>(
		`SELECT id, kind, page, page_end, note FROM highlights WHERE entry_id = ? AND deleted_at IS NULL ORDER BY id`,
		entry
	);

/** The reader at a page, with its controls up. */
async function readAt(page: Page, title: string, p: number) {
	const entry = firstEntry(title);
	await page.goto(`/read/${entry}?p=${p}`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await controls(page);
	return entry;
}
const banner = (page: Page) => page.getByRole('banner', { name: 'Reader' });
async function controls(page: Page) {
	const vp = page.viewportSize()!;
	await page.mouse.move(vp.width / 2, vp.height / 2);
	await expect(async () => {
		if (!(await banner(page).count())) await page.keyboard.press('Escape');
		await expect(banner(page)).toBeVisible({ timeout: 1_000 });
	}).toPass();
}
const cell = (page: Page) => page.locator('footer[aria-label="Reader controls"] .cell.hl');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Highlight' });
const band = (page: Page) => page.locator('.hl-band');

test('HIGHLIGHT joins the row before FULL SCREEN, keeps the page, and ticks the scrubber (M1, M3)', async ({
	page
}) => {
	const entry = await readAt(page, 'Dungeon Meshi', 5);
	const names = await page
		.locator('footer[aria-label="Reader controls"] .cells > *')
		.allTextContents();
	const at = names.indexOf('HIGHLIGHT');
	expect(at, names.join(' | ')).toBeGreaterThan(0);
	const full = names.findIndex((n) => /FULL SCREEN|EXIT FULL/.test(n));
	if (full !== -1) expect(at).toBeLessThan(full);
	await expect(page.locator('.track .tick')).toHaveCount(0);
	await cell(page).click();
	await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
	await expect(cell(page)).toHaveClass(/kept/);
	expect(kept(entry)).toEqual([expect.objectContaining({ kind: 'page', page: 4, page_end: null })]);
	// The tick sits where the thumb does at that page.
	const tick = page.locator('.track .tick');
	await expect(tick).toHaveCount(1);
	await expect(tick).toHaveAttribute('data-tick', '5');
	const [t, th] = await Promise.all([
		tick.evaluate((e) => e.getBoundingClientRect().left + 2),
		page.locator('.track .thumb').evaluate((e) => e.getBoundingClientRect().left + 2)
	]);
	expect(t).toBeCloseTo(th, 0);
	// The copy is the page at its own size, as WebP, behind the highlight's id.
	const [{ id }] = kept(entry);
	const r = await page.request.get(`/api/highlights/${id}/copy`);
	expect(r.headers()['content-type']).toBe('image/webp');
	const meta = await sharp(await r.body()).metadata();
	const source = await sharp(
		await (await page.request.get(`/api/entries/${entry}/pages/4`)).body()
	).metadata();
	expect([meta.width, meta.height]).toEqual([source.width, source.height]);
});

test('✓ HIGHLIGHTED opens the page’s sheet and never unmarks; NOTE, SAVE IMAGE, DELETE and UNDO (M6)', async ({
	page
}) => {
	const entry = await readAt(page, 'Dungeon Meshi', 5);
	await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
	await cell(page).click();
	await expect(sheet(page)).toBeVisible();
	await expect(sheet(page).locator('.h')).toHaveText(/^HIGHLIGHT · .+ · P\. 5$/);
	await expect(sheet(page).locator('.made')).toHaveText(
		/^MADE \d+ [A-Z]{3} · A COPY ON THE WORKSTATION · \d+ (KB|MB)$/
	);
	expect(kept(entry)).toHaveLength(1);
	const save = sheet(page).getByRole('link', { name: 'SAVE IMAGE' });
	await expect(save).toHaveAttribute(
		'href',
		new RegExp(`/api/highlights/${kept(entry)[0].id}/copy\\?save=1$`)
	);
	await sheet(page).locator('textarea').fill('The tower, from above this time.');
	const patched = page.waitForResponse((r) => r.request().method() === 'PATCH');
	await sheet(page).getByRole('button', { name: 'Close' }).click();
	expect((await patched).ok()).toBe(true);
	await expect(sheet(page)).toHaveCount(0);
	expect(kept(entry)[0].note).toBe('The tower, from above this time.');
	// Again: the note is there, and DELETE is at once with the band.
	await controls(page);
	await cell(page).click();
	await expect(sheet(page).locator('textarea')).toHaveValue('The tower, from above this time.');
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(sheet(page)).toHaveCount(0);
	await expect(band(page)).toContainText('HIGHLIGHT DELETED');
	await expect.poll(() => kept(entry).length).toBe(0);
	await controls(page);
	await expect(cell(page)).toHaveText('HIGHLIGHT');
	await expect(page.locator('.track .tick')).toHaveCount(0);
	await band(page).getByRole('button', { name: 'UNDO' }).click();
	await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
	await expect.poll(() => kept(entry).length).toBe(1);
	await expect(page.locator('.track .tick')).toHaveCount(1);
});

test('DELETE, HIGHLIGHT again, then UNDO: the page keeps one highlight, the same one (round 2)', async ({
	page
}) => {
	const entry = await readAt(page, 'Natsu no Owari ni Kimi to', 2);
	await cell(page).click();
	await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
	const [{ id }] = kept(entry);
	await cell(page).click();
	await sheet(page).getByRole('button', { name: 'DELETE' }).click();
	await expect(band(page)).toContainText('HIGHLIGHT DELETED');
	await expect.poll(() => kept(entry).length).toBe(0);
	// HIGHLIGHT again inside the UNDO window: the deleted row is brought back.
	await page.keyboard.press('Escape');
	const answered = page.waitForResponse((r) => r.url().endsWith('/api/highlights/pages'));
	await page.keyboard.press('h');
	const again = await answered;
	expect(again.status()).toBe(200);
	expect(((await again.json()) as { highlight: { id: number } }).highlight.id).toBe(id);
	// The UNDO the delete offered, as /highlights' band or another screen still holds it.
	const undo = await page.request.post(`/api/highlights/${id}`, { data: { undo: true } });
	expect(undo.status()).toBe(404);
	expect(kept(entry)).toEqual([expect.objectContaining({ id, page: 1, page_end: null })]);
	// The reader's own load after a reload: one highlight, one tick.
	await page.reload();
	await readerReady(page);
	await controls(page);
	await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
	await expect(page.locator('.track .tick')).toHaveCount(1);
});

test('H on a keyboard keeps the page on screen, and a second H opens it rather than keeping it twice', async ({
	page
}) => {
	const entry = await readAt(page, 'Kusuriya no Hitorigoto', 3);
	await page.keyboard.press('Escape');
	await expect(banner(page)).toHaveCount(0);
	const answered = page.waitForResponse((r) => r.url().endsWith('/api/highlights/pages'));
	await page.keyboard.press('h');
	expect((await answered).status()).toBe(201);
	expect(kept(entry).map((r) => r.page)).toEqual([2]);
	await page.keyboard.press('h');
	await expect(sheet(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
	expect(kept(entry)).toHaveLength(1);
});

test('a late answer: KEEPING… and nothing HIGHLIGHTED until it comes, and pressing again asks nothing more (M7)', async ({
	page
}) => {
	const entry = await readAt(page, 'Yofukashi no Uta', 7);
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	let asks = 0;
	await page.route('**/api/highlights/pages', async (route) => {
		asks += 1;
		await held;
		await route.continue();
	});
	await cell(page).click();
	await expect(cell(page)).toHaveText('KEEPING…');
	await expect(cell(page)).toHaveAttribute('aria-disabled', 'true');
	// Pressed again while it is on its way (forced: Playwright waits on aria-disabled).
	await cell(page).click({ force: true });
	await page.keyboard.press('h');
	await page.waitForTimeout(300);
	expect(asks).toBe(1);
	expect(kept(entry)).toEqual([]);
	await expect(page.locator('.track .tick')).toHaveCount(0);
	release();
	await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
	expect(kept(entry)).toHaveLength(1);
	expect(asks).toBe(1);
});

test('a failure keeps nothing and says why; TRY AGAIN keeps one (M7)', async ({ page }) => {
	const entry = await readAt(page, 'Yofukashi no Uta', 9);
	let refuse = true;
	await page.route('**/api/highlights/pages', async (route) => {
		if (refuse) return route.fulfill({ status: 502, body: 'the source did not send this page' });
		await route.continue();
	});
	await cell(page).click();
	await expect(band(page)).toContainText('P. 9 NOT KEPT');
	await expect(band(page)).toContainText('THE SOURCE DID NOT SEND IT');
	await expect(cell(page)).toHaveText('HIGHLIGHT');
	expect(kept(entry).filter((r) => r.page === 8)).toEqual([]);
	refuse = false;
	await band(page).getByRole('button', { name: 'TRY AGAIN' }).click();
	await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
	expect(kept(entry).filter((r) => r.page === 8)).toHaveLength(1);
});

test('offline: ○ HIGHLIGHT at 0.4, and a press says it needs the workstation, asking nothing (M7)', async ({
	page,
	context
}) => {
	await readAt(page, 'Chainsaw Man', 4);
	let asks = 0;
	await page.route('**/api/highlights/pages', (route) => {
		asks += 1;
		return route.continue();
	});
	await context.setOffline(true);
	try {
		await expect(cell(page)).toHaveText('○ HIGHLIGHT');
		await expect(cell(page)).toHaveCSS('opacity', '0.4');
		await cell(page).click();
		await expect(band(page)).toContainText('HIGHLIGHT NEEDS THE WORKSTATION');
		expect(asks).toBe(0);
	} finally {
		await context.setOffline(false);
	}
});

test('incognito: the cell reads INCOGNITO, dimmed, the menu’s row is off, and the workstation refuses one (M7)', async ({
	page
}) => {
	await page.context().addCookies([{ name: 'tsundoku_incognito', value: '1', url: base }]);
	const entry = await readAt(page, 'Isekai Yakkyoku', 2);
	await expect(cell(page)).toHaveText('INCOGNITO');
	await expect(cell(page)).toBeDisabled();
	await expect(cell(page)).toHaveCSS('opacity', '0.4');
	await page.keyboard.press('h');
	const r = await page.request.post('/api/highlights/pages', { data: { entry, page: 1 } });
	expect(r.status()).toBe(403);
	expect(kept(entry)).toEqual([]);
	// The page menu's row is there, and off.
	await page.keyboard.press('Escape');
	const vp = page.viewportSize()!;
	await page.mouse.move(vp.width / 2, vp.height / 3);
	await page.mouse.down();
	const menu = page.getByRole('dialog', { name: /^Page \d+$/ });
	await expect(menu).toBeVisible();
	await page.mouse.up();
	await expect(menu.getByRole('button', { name: /HIGHLIGHT THIS PAGE/ })).toBeDisabled();
	await expect(menu).toContainText('INCOGNITO MAKES NONE');
});

test('the page menu: HIGHLIGHT THIS PAGE first, then ✓ HIGHLIGHTED · OPEN on the kept page (M5)', async ({
	page
}) => {
	const entry = await readAt(page, 'Isekai Ojisan', 6);
	await page.keyboard.press('Escape');
	await expect(banner(page)).toHaveCount(0);
	const vp = page.viewportSize()!;
	const hold = async () => {
		await expect(page.getByRole('dialog', { name: /^Page \d+$/ })).toHaveCount(0);
		await page.mouse.move(vp.width / 2, vp.height / 3);
		await page.mouse.down();
		await expect(page.getByRole('dialog', { name: /^Page \d+$/ })).toBeVisible();
		await page.mouse.up();
	};
	await hold();
	const menu = page.getByRole('dialog', { name: /^Page \d+$/ });
	// First, before the cover rows.
	await expect(menu.locator('.row').first().locator('.hl-label')).toHaveText('HIGHLIGHT');
	// Waited on the reader's own answer: the row is in the database a moment
	// before the page hears back, and the menu only knows once it has.
	const answered = page.waitForResponse((r) => r.url().endsWith('/api/highlights/pages'));
	await menu.getByRole('button', { name: /HIGHLIGHT THIS PAGE/ }).click();
	expect((await answered).status()).toBe(201);
	expect(kept(entry).map((r) => r.page)).toEqual([5]);
	// Gone, not leaving: a menu on its way out still answers to the locator.
	await expect(menu).toHaveCount(0);
	await hold();
	await expect(menu.getByRole('button', { name: /✓ HIGHLIGHTED/ })).toContainText('OPEN');
	await menu.getByRole('button', { name: /✓ HIGHLIGHTED/ }).click();
	await expect(sheet(page)).toBeVisible();
	await expect(sheet(page).locator('.h')).toHaveText(/P\. 6$/);
	expect(kept(entry)).toHaveLength(1);
});

test('the strip: the page under the middle is outlined while the controls are up, and is the one kept (M4)', async ({
	page
}) => {
	const entry = await readAt(page, 'Tower of God', 10);
	await expect(page.locator('.reader')).toHaveClass(/vertical/);
	const outlined = page.locator('.slot.outlined');
	await expect(outlined).toHaveCount(1);
	const index = Number(await outlined.getAttribute('data-index'));
	await expect(outlined).toHaveAttribute('data-entry', String(entry));
	await expect(cell(page)).toHaveText(`HIGHLIGHT P. ${index + 1}`);
	// The outline is 3px of ink inside the page's edge.
	expect(await outlined.evaluate((e) => getComputedStyle(e, '::after').boxShadow)).toMatch(/inset/);
	await cell(page).click();
	await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
	expect(kept(entry).map((r) => r.page)).toEqual([index]);
	// The controls gone, the outline goes with them.
	await page.keyboard.press('Escape');
	await expect(banner(page)).toHaveCount(0);
	await expect(outlined).toHaveCount(0);
});

test.describe('landscape', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('a spread asks which, in reading order, then BOTH as one; BOTH ticks both pages (M2)', async ({
		page
	}) => {
		await page.addInitScript(() => localStorage.setItem('tsundoku.reader.spreads', 'true'));
		const entry = await readAt(
			page,
			'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
			4
		);
		const pages = await page.locator('.stage .screen:not([aria-hidden]) [data-page]').count();
		expect(pages, 'a spread on screen').toBe(2);
		await cell(page).click();
		const ask = page.getByRole('dialog', { name: 'Highlight which page' });
		await expect(ask).toBeVisible();
		const rows = await ask.locator('.ch').allInnerTexts();
		// R→L: the right page, the earlier one, first.
		expect(rows.map((r) => r.replace(/\s+/g, ' ').trim())).toEqual([
			expect.stringMatching(/^P\. (\d+) RIGHT$/),
			expect.stringMatching(/^P\. (\d+) LEFT$/),
			'BOTH AS ONE'
		]);
		const [a, b] = rows.slice(0, 2).map((r) => Number(/P\. (\d+)/.exec(r)![1]));
		expect(b).toBe(a + 1);
		await ask.getByRole('button', { name: /BOTH/ }).click();
		await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
		expect(kept(entry).map((r) => [r.page, r.page_end])).toEqual([[a - 1, b - 1]]);
		await expect(page.locator('.track .tick')).toHaveCount(2);
		// Asked again, BOTH is kept: it opens rather than keeping a second.
		await cell(page).click();
		await expect(ask.getByRole('button', { name: /✓ BOTH/ })).toContainText('OPEN');
		await page.keyboard.press('Escape');
		await expect(ask).toHaveCount(0);
		expect(kept(entry)).toHaveLength(1);
	});

	test('a letterboxed kept page has a 4px yellow rule 6px off its outer side, off the art (M3)', async ({
		page
	}) => {
		const entry = await readAt(page, 'Hikaru ga Shinda Natsu', 3);
		await cell(page).click();
		await expect(cell(page)).toHaveText('✓ HIGHLIGHTED');
		expect(kept(entry)).toHaveLength(1);
		await page.keyboard.press('Escape');
		await expect(banner(page)).toHaveCount(0);
		const rule = page.locator('.stage .screen:not([aria-hidden]) [data-kept-rule]');
		await expect(rule).toHaveCount(1);
		// R→L: the outer side is the right.
		await expect(rule).toHaveAttribute('data-kept-rule', 'right');
		const [r, art] = await Promise.all([
			rule.evaluate((e) => {
				const b = e.getBoundingClientRect();
				return {
					left: b.left,
					width: b.width,
					top: b.top,
					h: b.height,
					bg: getComputedStyle(e).backgroundColor
				};
			}),
			page.locator('.stage .screen:not([aria-hidden]) [data-text-frame]').evaluate((e) => {
				const b = e.getBoundingClientRect();
				return { right: b.right, top: b.top, h: b.height };
			})
		]);
		expect(r.width).toBe(4);
		expect(r.left - art.right).toBeCloseTo(6, 0);
		expect([r.top, r.h]).toEqual([art.top, art.h]);
		expect(r.left + r.width).toBeLessThanOrEqual(page.viewportSize()!.width);
	});
});
