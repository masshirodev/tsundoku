import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';
import { startPreview } from './highlights-preview';

/**
 * The handoff's measurements for the text reader's highlights (card c702;
 * `doc/handoffs/highlights/Novel.dc.html`, `hl.css`): the bar's 48 px cells and
 * mono type, the 14 px handles, the phone's sheet with its 56 px head and foot
 * and 44 px swatches, the 420 px panel with its 60 px foot, and the band's
 * minimum height. These are hand-set values, not a ladder (`reconcile-tokens`
 * says the theme has none), and this test is what stops a later pass rounding
 * them onto one. Written by hand from `extract-spec.mjs`'s output, not by the
 * generator: a selection and an open sheet are states it has no selector for.
 * It seeds a database of its own and takes a port from the OS. A plain
 * `*.e2e.ts`, so it would run in the four device projects: it sets each
 * viewport itself and skips the others.
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
const scratch = join(tmpdir(), `tsundoku-e2e-highlights-novel-frame-${process.pid}`);
const dbPath = join(scratch, 'library.sqlite');
let server: ChildProcess | null = null;

test.use({ baseURL: base, serviceWorkers: 'block', hasTouch: false, isMobile: false });

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
		'the novel highlights frame preview'
	);
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(scratch, { recursive: true, force: true });
});

test.beforeEach(() => {
	test.skip(test.info().project.name !== 'desktop', 'its own viewports, in one project');
	const d = new Database(dbPath);
	try {
		d.prepare(`DELETE FROM highlights WHERE kind = 'quote'`).run();
	} finally {
		d.close();
	}
});

function chapter(): number {
	const d = new Database(dbPath);
	try {
		const r = d
			.prepare(
				`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.title = 'Mushoku Tensei' AND e.matter = '' ORDER BY e.position LIMIT 1`
			)
			.get() as { id: number };
		return r.id;
	} finally {
		d.close();
	}
}

async function open(page: Page) {
	await page.goto(`/read/${chapter()}?at=2.0`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await page.waitForFunction(() => document.fonts.status === 'loaded');
}

/** Press and hold the first long word on the page. */
async function select(page: Page) {
	const p = await page.evaluate(() => {
		const b = document.querySelector<HTMLElement>('.blocks p')!;
		const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
		// A long enough node: a kept word splits the first one into pieces.
		let t = walk.nextNode()!;
		while (t.textContent!.length < 4) t = walk.nextNode()!;
		const r = document.createRange();
		r.setStart(t, 2);
		r.setEnd(t, 3);
		const c = r.getClientRects()[0];
		return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
	});
	await page.mouse.move(p.x, p.y);
	await page.mouse.down();
	await page.waitForTimeout(550);
	await page.mouse.up();
	await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeVisible();
}

test.describe('the phone', () => {
	test.use({ viewport: { width: 390, height: 780 } });

	test('N1: the bar, its cells and the handles', async ({ page }) => {
		await open(page);
		await select(page);
		const bar = page.getByRole('toolbar', { name: 'Selection' });
		await expect(bar).toHaveCSS('font-family', /Plex Mono/);
		await expect(bar).toHaveCSS('letter-spacing', '0.78px');
		const cell = bar.getByRole('button', { name: 'HIGHLIGHT' });
		await expect(cell).toHaveCSS('height', '48px');
		await expect(cell).toHaveCSS('padding-left', '16px');
		await expect(cell).toHaveCSS('font-size', '13px');
		// The handles: a 44 px target around a 14 px square.
		const hd = page.locator('.hd.end');
		await expect(hd).toHaveCSS('width', '44px');
		await expect(hd).toHaveCSS('height', '44px');
		const square = await hd.evaluate((el) => {
			const s = getComputedStyle(el, '::after');
			return { w: s.width, h: s.height };
		});
		expect(square).toEqual({ w: '14px', h: '14px' });
	});

	test('N5: the sheet', async ({ page }) => {
		await open(page);
		await select(page);
		await page
			.getByRole('toolbar', { name: 'Selection' })
			.getByRole('button', { name: 'HIGHLIGHT' })
			.click();
		await page.locator('.mk').first().click();
		const s = page.getByRole('dialog', { name: 'Highlight' });
		await expect(s.locator('.head')).toHaveCSS('height', '56px');
		await expect(s.locator('.body')).toHaveCSS('padding-left', '20px');
		await expect(s.locator('.body')).toHaveCSS('padding-top', '18px');
		await expect(s.locator('.body')).toHaveCSS('row-gap', '16px');
		await expect(s.locator('.quote')).toHaveCSS('font-size', '17px');
		await expect(s.locator('.sw').first()).toHaveCSS('width', '44px');
		await expect(s.locator('.sw').first()).toHaveCSS('height', '44px');
		await expect(s.locator('.note')).toHaveCSS('min-height', '76px');
		await expect(s.locator('.foot')).toHaveCSS('height', '56px');
	});
});

test.describe('the desktop', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('D2: the 420 px panel and its 60 px foot, and DELETE opens the band at 52 px', async ({
		page
	}) => {
		await open(page);
		await select(page);
		await page.keyboard.press('h');
		await page.locator('.mk').first().click();
		const s = page.getByRole('dialog', { name: 'Highlight' });
		await expect(s).toHaveCSS('width', '420px');
		await expect(s.locator('.quote')).toHaveCSS('font-size', '18px');
		await expect(s.locator('.body')).toHaveCSS('padding-left', '24px');
		await expect(s.locator('.body')).toHaveCSS('row-gap', '18px');
		await expect(s.locator('.foot')).toHaveCSS('height', '60px');
		await s.getByRole('button', { name: 'DELETE' }).click();
		const band = page.getByRole('status').filter({ hasText: 'HIGHLIGHT DELETED' });
		await expect(band).toHaveCSS('min-height', '52px');
		await expect(band).toHaveCSS('font-size', '13px');
	});
});
