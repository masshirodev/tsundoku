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
 * Highlights H2 on a TV (doc/HIGHLIGHTS.md, "Quotes"): the TV shows a
 * quote's marker and makes none: there is no long press and no selection, H
 * does nothing, and no focus stop moved. The `tv` project shares the seeded
 * database with the flow files, and this file writes a quote, so it seeds a
 * database of its own and serves the build on a port the OS gives it. A
 * `tv-*` file: it runs in the `tv` project only, at 960x540 with no pointer.
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
const scratch = join(tmpdir(), `tsundoku-e2e-tv-highlights-novel-${process.pid}`);
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
		'the TV novel highlights preview'
	);
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(scratch, { recursive: true, force: true });
});

/** A quote written the way the reader writes one, on the seed's Mushoku Tensei. */
function seedQuote(): number {
	const d = new Database(dbPath);
	try {
		const r = d
			.prepare(
				`SELECT e.id, e.series_id FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.title = 'Mushoku Tensei' AND e.matter = '' ORDER BY e.position LIMIT 1`
			)
			.get() as { id: number; series_id: number };
		d.prepare(
			`INSERT INTO highlights (kind, series_id, entry_id, block, block_offset, end_block, end_offset,
				series_title, series_kind, quote, quote_before, quote_after, paragraph, colour, made_at, hidden)
			VALUES ('quote', ?, ?, 2, 1, 2, 4, 'Mushoku Tensei', 'novel', 'How', '', ' large?" he', '', 'orange', 1, 0)`
		).run(r.series_id, r.id);
		return r.id;
	} finally {
		d.close();
	}
}

const quotes = (id: number): number => {
	const d = new Database(dbPath);
	try {
		return (
			d
				.prepare(`SELECT COUNT(*) AS n FROM highlights WHERE kind = 'quote' AND entry_id = ?`)
				.get(id) as { n: number }
		).n;
	} finally {
		d.close();
	}
};

async function open(page: Page, id: number) {
	await page.goto(`/read/${id}?at=2.0`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await page.waitForFunction(() => document.fonts.status === 'loaded');
}

test('a TV shows the marker and makes none: no long press, no selection, no H', async ({
	page
}) => {
	const id = seedQuote();
	await open(page, id);
	// The pad has no pointer: the marker is there from the record, in its own colour.
	await expect(page.locator('.mk')).toHaveCount(1);
	await expect(page.locator('.mk.orange')).toBeVisible();
	await expect(page.locator('.mk')).toHaveCSS('box-shadow', /inset/);

	const box = (await page.locator('.blocks p').first().boundingBox())!;
	const x = box.x + 80;
	const y = box.y + 12;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.waitForTimeout(650);
	await page.mouse.up();
	await page.waitForTimeout(120);
	expect(await page.evaluate(() => matchMedia('(pointer: none)').matches)).toBe(true);
	await expect(page.getByRole('toolbar', { name: 'Selection' })).toHaveCount(0);
	await expect(page.locator('.sel')).toHaveCount(0);
	await expect(page.locator('.hd')).toHaveCount(0);

	// H with nothing selected is nothing; OK is still the chrome (the reader's own key).
	await page.keyboard.press('h');
	await page.waitForTimeout(150);
	expect(quotes(id)).toBe(1);
	await page.keyboard.press('Enter');
	await expect(page.locator('footer [data-focus-start]')).toBeFocused();
});
