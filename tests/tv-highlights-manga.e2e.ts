import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, readerReady, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';
import { startPreview } from './highlights-preview';

/**
 * Highlights H3 on a TV (Manga M1, M2, M5, doc/TV.md): the
 * reader's controls gain a focus stop, HIGHLIGHT, which OK presses; on a
 * spread (the TV's default) it asks which, and the pad walks the rows; MENU
 * opens the page menu, whose first row is HIGHLIGHT THIS PAGE.
 *
 * The `tv` project shares the seeded database with the flow files, and this
 * file keeps pages, so it seeds a database of its own and serves the build
 * on a port the OS gives it, as the highlights flow files do. A `tv-*` file:
 * it runs in the `tv` project only, at 960x540 with no pointer.
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
const scratch = join(tmpdir(), `tsundoku-e2e-tv-highlights-${process.pid}`);
const dbPath = join(scratch, 'library.sqlite');
let server: ChildProcess | null = null;

test.use({ baseURL: base });

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
		'the TV highlights preview'
	);
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(scratch, { recursive: true, force: true });
});

function kept(entry: number) {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare(
				`SELECT page, page_end FROM highlights WHERE entry_id = ? AND deleted_at IS NULL ORDER BY id`
			)
			.all(entry) as { page: number; page_end: number | null }[];
	} finally {
		db.close();
	}
}
function firstEntry(title: string) {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (
			db
				.prepare(
					`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id WHERE s.title = ?
					ORDER BY e.position LIMIT 1`
				)
				.get(title) as { id: number }
		).id;
	} finally {
		db.close();
	}
}

/** The focused thing's words; `(nothing)` when the pad is on no stop at all. */
const focused = (page: Page) =>
	page.evaluate(() =>
		!document.activeElement || document.activeElement === document.body
			? '(nothing)'
			: (document.activeElement.textContent?.replace(/\s+/g, ' ').trim() ?? '')
	);

/** OK brings the controls with the pad on the scrubber; ↓ and → reach HIGHLIGHT. */
async function toHighlight(page: Page) {
	await page.keyboard.press('Enter');
	await expect(page.locator('footer[aria-label="Reader controls"] .track')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	const cell = page.locator('footer[aria-label="Reader controls"] .cell.hl');
	for (let i = 0; i < 6 && !(await cell.evaluate((e) => e === document.activeElement)); i++)
		await page.keyboard.press('ArrowRight');
	await expect(cell).toBeFocused();
	return cell;
}

test('OK on HIGHLIGHT keeps the page alone on screen; the cell is a stop in the controls’ row', async ({
	page
}) => {
	const entry = firstEntry('Dungeon Meshi');
	await page.goto(`/read/${entry}?p=1`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const cell = await toHighlight(page);
	await expect(cell).toHaveText('HIGHLIGHT');
	const answered = page.waitForResponse((r) => r.url().endsWith('/api/highlights/pages'));
	await page.keyboard.press('Enter');
	expect((await answered).status()).toBe(201);
	await expect(cell).toHaveText('✓ HIGHLIGHTED');
	expect(kept(entry)).toEqual([{ page: 0, page_end: null }]);
	// OK again opens the page's sheet, which the pad reaches; BACK closes it.
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Highlight' });
	await expect(sheet).toBeVisible();
	await expect.poll(() => focused(page)).toBe('SAVE IMAGE');
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	expect(kept(entry)).toHaveLength(1);
});

test('on a spread, OK asks which; the pad walks to BOTH and keeps the two as one', async ({
	page
}) => {
	const entry = firstEntry('Yofukashi no Uta');
	await page.goto(`/read/${entry}?p=1`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	// One screen on from the cover, to a spread of two.
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('.stage .screen:not([aria-hidden]) [data-page]')).toHaveCount(2);
	await toHighlight(page);
	await page.keyboard.press('Enter');
	const ask = page.getByRole('dialog', { name: 'Highlight which page' });
	await expect(ask).toBeVisible();
	await expect.poll(() => focused(page)).toMatch(/^P\. \d+\s*RIGHT$/);
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => focused(page)).toMatch(/^BOTH\s*AS ONE$/);
	const answered = page.waitForResponse((r) => r.url().endsWith('/api/highlights/pages'));
	await page.keyboard.press('Enter');
	expect((await answered).status()).toBe(201);
	await expect(ask).toHaveCount(0);
	expect(kept(entry)).toEqual([{ page: 1, page_end: 2 }]);
});

test('MENU opens the page menu with HIGHLIGHT THIS PAGE first, and OK on it keeps the page', async ({
	page
}) => {
	const entry = firstEntry('Chainsaw Man');
	await page.goto(`/read/${entry}?p=1`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await page.keyboard.press('ContextMenu');
	const menu = page.getByRole('dialog', { name: /^Page \d+$/ });
	await expect(menu).toBeVisible();
	await expect.poll(() => focused(page)).toMatch(/HIGHLIGHT THIS PAGE$/);
	const answered = page.waitForResponse((r) => r.url().endsWith('/api/highlights/pages'));
	await page.keyboard.press('Enter');
	expect((await answered).status()).toBe(201);
	expect(kept(entry)).toEqual([{ page: 0, page_end: null }]);
});
