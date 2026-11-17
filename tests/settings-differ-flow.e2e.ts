import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { hydrated } from './helpers/hydration';

/**
 * SETTINGS' N SERIES DIFFER on LAYOUT, in a browser (c637; doc/SETTINGS.md,
 * "02"): the novel kept R→L by the reader's own REMEMBER, its line on the
 * list, ✕, and the count gone. The logic is in `settings-db.spec.ts` and the
 * words in `settings-domain.spec.ts`; this is the page's glue, which only
 * svelte-check saw before.
 *
 * Its own seeded database and an OS port (the `settings-devices` arrangement),
 * because it changes a series' layout and the shared seed is read by every
 * flow file. Runs once, in tablet-portrait: the list is the same markup at
 * every width.
 */
test.describe.configure({ mode: 'serial', timeout: 60_000 });

const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});

const port = await freePort();
const base = `http://localhost:${port}`;
const work = mkdtempSync(
	join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'settings-differ-')
);
const dbPath = join(work, 'differ.sqlite');
let server: ChildProcess | null = null;

test.beforeAll(async () => {
	// One seed and one `vite preview` start, polled for up to 60 s.
	test.setTimeout(120_000);
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DATABASE_PATH: dbPath,
		TSUNDOKU_TOKEN: E2E_TOKEN,
		TSUNDOKU_ANILIST: 'off',
		LIBRARY_ROOT: join(work, 'library'),
		TSUNDOKU_HOME: join(work, 'home')
	};
	delete env.ORIGIN;
	// vite itself, not `npx vite`: stopping this pid then stops the server.
	server = spawn(
		process.execPath,
		['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'],
		{ env, stdio: 'ignore' }
	);
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${base}/manifest.webmanifest`)).ok) return;
		} catch {
			// Not up yet.
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`the ${base} preview never answered`);
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(work, { recursive: true, force: true });
});

const opened: BrowserContext[] = [];
test.afterEach(async () => {
	for (const context of opened.splice(0)) await context.close().catch(() => {});
});

async function signedIn(browser: Browser, info: TestInfo): Promise<Page> {
	const context = await browser.newContext({
		storageState: info.project.use.storageState as string,
		baseURL: base
	});
	opened.push(context);
	return context.newPage();
}

/** One visible novel of the seed and its first entry, by its position among the novels. */
function novel(at: number): { series: number; entry: number; title: string } {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare(
				`SELECT s.id AS series, s.title, (SELECT MIN(e.id) FROM entries e WHERE e.series_id = s.id) AS entry
				FROM series s JOIN roots r ON r.id = s.root_id
				WHERE s.kind = 'novel' AND r.hidden = 0 AND s.hidden = 0 ORDER BY s.id LIMIT 1 OFFSET ?`
			)
			.get(at) as { series: number; entry: number; title: string };
	} finally {
		db.close();
	}
}

function stored(series: number): { direction: string | null; text_direction: string | null } {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db.prepare(`SELECT direction, text_direction FROM series WHERE id = ?`).get(series) as {
			direction: string | null;
			text_direction: string | null;
		};
	} finally {
		db.close();
	}
}

/** A SvelteKit form action, posted as the page's own form would be: it must answer success. */
async function post(page: Page, path: string, direction: string) {
	const r = await page.request.post(`${base}${path}`, {
		form: { direction },
		headers: { origin: base, 'x-sveltekit-action': 'true' }
	});
	expect(r.status()).toBe(200);
	expect(((await r.json()) as { type: string }).type).toBe('success');
}

const layout = (page: Page) => page.locator('[data-row="layout"]');

async function settings(page: Page) {
	await page.goto('/settings');
	await hydrated(page);
}

test('a novel remembered R→L is on LAYOUT’s list, and ✕ takes it off and the count with it', async ({
	browser
}, info) => {
	const page = await signedIn(browser, info);
	const { series, entry, title } = novel(0);
	await settings(page);
	await expect(layout(page).locator('.sb')).toHaveCount(0);

	await post(page, `/read/${entry}?/textDirection`, 'rtl');
	await settings(page);
	const differs = layout(page).getByRole('button', { name: '1 SERIES DIFFERS →' });
	await expect(differs).toBeVisible();
	await differs.click();
	const line = layout(page).locator('.list .item');
	await expect(line).toHaveCount(1);
	await expect(line.locator('.it-t')).toHaveText(title);
	await expect(line.locator('.it-v')).toHaveText('R→L · NOVEL · CHOSEN IN THE READER');

	await line.getByRole('button', { name: 'Back to the default' }).click();
	await expect(layout(page).locator('.sb')).toHaveCount(0);
	await expect(layout(page).locator('.list .item')).toHaveCount(0);
	expect(stored(series)).toEqual({ direction: null, text_direction: null });

	// The workstation's, not the page's: another visit draws no count.
	await settings(page);
	await expect(layout(page).locator('.sb')).toHaveCount(0);
});

test('✕ on a novel listed for its layout takes a chosen L→R with it, so no later fold reads it as a choice', async ({
	browser
}, info) => {
	const page = await signedIn(browser, info);
	const { series, entry } = novel(2);
	// The reader's REMEMBER both ways: 'ltr' is what going back to L→R stores.
	await post(page, `/read/${entry}?/textDirection`, 'rtl');
	await post(page, `/read/${entry}?/textDirection`, 'ltr');
	await post(page, `/series/${series}?/direction`, 'scroll');
	expect(stored(series)).toEqual({ direction: 'scroll', text_direction: 'ltr' });

	await settings(page);
	await layout(page).getByRole('button', { name: '1 SERIES DIFFERS →' }).click();
	const line = layout(page).locator('.list .item');
	// A chosen L→R reads as the default does, so the line names the layout alone.
	await expect(line.locator('.it-v')).toHaveText('SCROLL · NOVEL · CHOSEN IN THE READER');
	await line.getByRole('button', { name: 'Back to the default' }).click();
	await expect(layout(page).locator('.sb')).toHaveCount(0);
	expect(stored(series)).toEqual({ direction: null, text_direction: null });
});

test('✕ on a novel listed only for R→L keeps a layout stored equal to the default', async ({
	browser
}, info) => {
	const page = await signedIn(browser, info);
	const { series, entry } = novel(1);
	// PAGED is LAYOUT's default: chosen on the series screen, it is a choice all the same.
	await post(page, `/series/${series}?/direction`, 'paged');
	await post(page, `/read/${entry}?/textDirection`, 'rtl');
	expect(stored(series)).toEqual({ direction: 'paged', text_direction: 'rtl' });

	await settings(page);
	await layout(page).getByRole('button', { name: '1 SERIES DIFFERS →' }).click();
	const line = layout(page).locator('.list .item');
	// The line names R→L and nothing else, so R→L is all ✕ may take.
	await expect(line.locator('.it-v')).toHaveText('R→L · NOVEL · CHOSEN IN THE READER');
	await line.getByRole('button', { name: 'Back to the default' }).click();
	await expect(layout(page).locator('.sb')).toHaveCount(0);
	expect(stored(series)).toEqual({ direction: 'paged', text_direction: null });
});
