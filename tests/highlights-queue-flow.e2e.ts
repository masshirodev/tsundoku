import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, readerReady, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';
import { startPreview } from './highlights-preview';

/**
 * A page kept offline waits on the device and is sent at the next connection
 * (c842; doc/HIGHLIGHTS.md and doc/OFFLINE.md): the band says so and DON'T SEND
 * undoes it, two presses are one, closing the app loses nothing, and the
 * layout sends it from any screen with no further press; a page the
 * workstation refuses on arrival is told at the next reader. Writes highlights,
 * so it seeds a database of its own on a port the OS gives it (the
 * highlights-manga-flow arrangement); a `*-flow.e2e.ts`, so it runs once, in
 * tablet-portrait.
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
const scratch = join(
	process.env.TMPDIR ?? join(process.cwd(), 'temp'),
	`tsundoku-e2e-highlights-queue-${process.pid}`
);
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
		'the highlights queue preview'
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
const keptPages = (entry: number) =>
	sql<{ page: number }>(
		`SELECT page FROM highlights WHERE entry_id = ? AND deleted_at IS NULL ORDER BY page`,
		entry
	).map((r) => r.page);

const banner = (page: Page) => page.getByRole('banner', { name: 'Reader' });
async function controls(page: Page) {
	const vp = page.viewportSize()!;
	await page.mouse.move(vp.width / 2, vp.height / 2);
	await expect(async () => {
		if (!(await banner(page).count())) await page.keyboard.press('Escape');
		await expect(banner(page)).toBeVisible({ timeout: 1_000 });
	}).toPass();
}
/** [p] is the URL's: 1-based, where a kept row's `page` counts from 0. */
async function readAt(page: Page, entry: number, p: number) {
	await page.goto(`/read/${entry}?p=${p}`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await controls(page);
}
const cell = (page: Page) => page.locator('footer[aria-label="Reader controls"] .cell.hl');
const band = (page: Page) => page.locator('.hl-band');

/** The device's own queue, read from IndexedDB as the app wrote it. */
const queued = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<{ key: string; refused: string | null }[]>((ok, no) => {
				const r = indexedDB.open('tsundoku.highlights-queue', 1);
				r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'key' });
				r.onerror = () => no(r.error);
				r.onsuccess = () => {
					const q = r.result.transaction('items').objectStore('items').getAll();
					q.onsuccess = () => {
						r.result.close();
						ok(q.result);
					};
				};
			})
	);

function countAsks(page: Page) {
	const asks: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().endsWith('/api/highlights/pages'))
			asks.push(r.postData() ?? '');
	});
	return asks;
}

async function keepOffline(page: Page, context: BrowserContext) {
	await context.setOffline(true);
	await expect(cell(page)).toHaveText('○ HIGHLIGHT');
	await cell(page).click();
	await expect(band(page)).toContainText('WAITING TO BE SENT');
	await expect(cell(page)).toHaveText('KEEPING…');
}

test('a page kept offline waits, and two presses are one; it is sent at the next connection with no press (c842)', async ({
	page,
	context
}) => {
	const entry = firstEntry('Chainsaw Man');
	await readAt(page, entry, 6);
	const asks = countAsks(page);
	await keepOffline(page, context);
	await cell(page).click();
	await expect(band(page)).toContainText('WAITING TO BE SENT');
	// Waiting: on the device, and the workstation has been asked nothing.
	expect(await queued(page)).toHaveLength(1);
	expect(asks).toEqual([]);
	expect(keptPages(entry)).toEqual([]);

	await context.setOffline(false);
	await expect.poll(() => keptPages(entry), { timeout: 15_000 }).toEqual([5]);
	expect(asks).toHaveLength(1);
	await expect(cell(page)).toHaveText('✓ HIGHLIGHTED', { timeout: 10_000 });
	await expect.poll(() => queued(page)).toEqual([]);
});

test("DON'T SEND before it is sent: nothing is asked and nothing is kept (c842)", async ({
	page,
	context
}) => {
	const entry = firstEntry('Chainsaw Man');
	await readAt(page, entry, 8);
	const asks = countAsks(page);
	await keepOffline(page, context);
	await band(page).getByRole('button', { name: "DON'T SEND" }).click();
	await expect.poll(() => queued(page)).toEqual([]);
	await expect(cell(page)).toHaveText('○ HIGHLIGHT');
	await context.setOffline(false);
	// The other half: this same reader, connected, is one that would have sent it.
	await expect(cell(page)).toHaveText('HIGHLIGHT');
	expect(asks).toEqual([]);
	expect(keptPages(entry)).not.toContain(7);
});

test('the app closed while it waits: the next open of any screen sends it (c842)', async ({
	page,
	context
}) => {
	const entry = firstEntry('Chainsaw Man');
	await readAt(page, entry, 10);
	await keepOffline(page, context);
	await page.close();
	await context.setOffline(false);
	const again = await context.newPage();
	expect(keptPages(entry)).not.toContain(9);
	await again.goto('/');
	await expect.poll(() => keptPages(entry), { timeout: 15_000 }).toContain(9);
	await again.goto('/highlights');
	await expect(again.locator('body')).toContainText('Chainsaw Man');
});

test('refused on arrival: the next reader says so, and DISMISS forgets it (c842)', async ({
	page,
	context
}) => {
	const entry = firstEntry('Dungeon Meshi');
	await readAt(page, entry, 3);
	await keepOffline(page, context);
	// The workstation's own refusal: hidden since, so it no longer finds the entry.
	const hide = (v: number) => {
		const db = new Database(dbPath);
		try {
			db.prepare('UPDATE series SET hidden = ? WHERE title = ?').run(v, 'Dungeon Meshi');
		} finally {
			db.close();
		}
	};
	hide(1);
	try {
		await page.goto('about:blank');
		await context.setOffline(false);
		await page.goto('/');
		await expect
			.poll(async () => (await queued(page)).map((q) => q.refused), { timeout: 15_000 })
			.toEqual(['gone']);
		expect(keptPages(entry)).toEqual([]);
	} finally {
		hide(0);
	}
	await readAt(page, firstEntry('Chainsaw Man'), 2);
	await expect(band(page)).toContainText('NOT KEPT');
	await expect(band(page)).toContainText('GONE');
	await band(page).getByRole('button', { name: 'DISMISS' }).click();
	await expect.poll(() => queued(page)).toEqual([]);
	await page.reload();
	await readerReady(page);
	await expect(band(page)).toHaveCount(0);
});

test('incognito keeps nothing, online or off (c842)', async ({ page, context }) => {
	await context.addCookies([{ name: 'tsundoku_incognito', value: '1', url: base }]);
	const entry = firstEntry('Yofukashi no Uta');
	await readAt(page, entry, 5);
	await expect(cell(page)).toHaveText('INCOGNITO');
	await context.setOffline(true);
	await page.keyboard.press('h');
	await page.waitForTimeout(300);
	expect(await queued(page)).toEqual([]);
	await context.setOffline(false);
	expect(keptPages(entry)).toEqual([]);
});
