import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * Ranobe on the link review, the series screen and SETTINGS (Ranobe.dc.html;
 * doc/RANOBE.md), end to end. Ranobe needs a token and candidates, and
 * turning that on for the shared server would redraw every novel's series
 * screen under the specs that pin it. So this spec runs its own preview of
 * the same build, on its own seeded database, with a dummy token and Ranobe
 * switched off: every decision here is local, and a paste reads as Ranobe
 * not answering.
 */

const PORT = Number(process.env.PLAYWRIGHT_RANOBE_PORT ?? 4191);
const BASE = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-ranobe-${process.pid}.sqlite`);
let server: ChildProcess | null = null;
const ids: Record<string, number> = {};

const candidate = (work: string, title: string, sensitive = false) =>
	JSON.stringify({
		work,
		kind: 'web_novel',
		title,
		matched: 'The Beginning After the End',
		status: 'ongoing',
		years: '2017–',
		units: { volume: 9 },
		cover: { url: `/nowhere/${work}.jpg`, sensitive }
	});

function seed(): void {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
		.id;
	const now = Date.UTC(2026, 8, 27, 14, 20);
	const series = (title: string) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at) VALUES (?, ?, 'novel', 'epub', 230, ?, ?)`
				)
				.run(root, title, now, now).lastInsertRowid
		);
		for (let i = 1; i <= 3; i++)
			db.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, file) VALUES (?, ?, ?, ?, ?)`
			).run(id, i, `Chapter ${i}`, now, `${title}.epub`);
		return id;
	};
	const searched = (id: number, query: string, cands: [string, string, boolean?][]) => {
		db.prepare(
			`INSERT INTO ranobe_searches (series_id, query, searched_at, found) VALUES (?, ?, ?, ?)`
		).run(id, query, now, cands.length);
		cands.forEach(([work, title, sensitive], rank) =>
			db
				.prepare(`INSERT INTO ranobe_candidates (series_id, work, rank, data) VALUES (?, ?, ?, ?)`)
				.run(id, work, rank, candidate(work, title, sensitive))
		);
	};
	const tbate: [string, string, boolean?][] = [
		['w388', 'The Beginning After the End'],
		['w1301', 'The Beginning After the End: Side Stories', true]
	];
	ids.v2 = series('The Beginning After the End, Vol. 2');
	ids.v3 = series('The Beginning After the End, Vol. 3');
	ids.v5 = series('The Beginning After the End, Vol. 5');
	ids.lotm = series('Lord of the Mysteries: 1-1429');
	searched(ids.v2, 'The Beginning After the End', tbate);
	searched(ids.v3, 'The Beginning After the End', tbate);
	searched(ids.v5, 'The Beginning After the End', tbate);
	searched(ids.lotm, 'Lord of the Mysteries', []);
	db.close();
}

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: BASE });

test.beforeAll(async () => {
	seed();
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			RANOBE_TOKEN: 'rb_e2e_not_a_token',
			TSUNDOKU_RANOBE: 'off',
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(tmpdir(), 'tsundoku-e2e-empty-library'),
			BACKUP_DIR: join(tmpdir(), 'tsundoku-e2e-backups')
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(BASE, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the Ranobe preview never answered');
});

test.afterAll(() => {
	server?.kill();
	rmSync(dbPath, { force: true });
});

const band = (page: import('@playwright/test').Page) => page.locator('.band .line').first();

test('a novel leads the review with Ranobe’s candidates (1a)', async ({ page }) => {
	await page.goto('/links');
	await expect(page.locator('.title')).toHaveText('The Beginning After the End, Vol. 2');
	await expect(page.locator('.ch').first()).toContainText('01 — ON RANOBE');
	await expect(page.locator('.ch').first()).toContainText('2 FOUND · A WORK, NOT AN EDITION');
	await expect(page.locator('.cand .ids')).toHaveText([
		'RANOBE W388 · WEB NOVEL',
		'RANOBE W1301 · WEB NOVEL'
	]);
	await expect(page.locator('.cand .why').first()).toHaveText('TITLE EQUAL WITHOUT “VOL. 2”');
	// A sensitive cover is never drawn; its note stands in.
	await expect(page.locator('.cand').nth(1).locator('.nc')).toHaveText('SENSITIVE · NOT SHOWN');
	await expect(page.locator('.cand').nth(1).locator('img')).toHaveCount(0);
	await expect(page.locator('.cand .open').first()).toHaveAttribute(
		'href',
		'https://ranobe.ink/w388'
	);
});

test('LINK offers the siblings, nothing preselected, and LINK N MORE takes them (1b)', async ({
	page
}) => {
	await page.goto('/links');
	await page.locator('.cand').first().click();
	await page.getByRole('button', { name: 'LINK A' }).click();
	await expect(page.locator('.sibq')).toHaveText('THE SAME WORK FOR THESE?');
	await expect(page.locator('.siblead')).toHaveText('The Beginning After the End');
	await expect(page.locator('.sib')).toHaveCount(2);
	await expect(page.locator('.sib[aria-pressed="true"]')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'TAP THE ONES THAT ARE' })).toBeDisabled();
	// The panel's measurements, as Ranobe Review.dc.html set them. Hand-set,
	// not a spacing ladder, like the rest of the review: pinned so a tidy-up
	// can't round them onto one and redraw the panel.
	const sib = page.locator('.sib').first();
	await expect(sib).toHaveCSS('min-height', '72px');
	await expect(sib.locator('.tickcell')).toHaveCSS('width', '64px');
	await expect(sib.locator('.tick')).toHaveCSS('width', '28px');
	await expect(sib.locator('.tick')).toHaveCSS('height', '28px');
	await expect(sib.locator('.sibcover')).toHaveCSS('width', '40px');
	await expect(sib.locator('.sibtitle')).toHaveCSS('font-size', '15px');
	await expect(page.locator('.sibhead')).toHaveCSS('padding', '24px 24px 18px');
	await expect(page.locator('.sibnotes')).toHaveCSS('padding', '16px 24px 24px');
	await expect(page.locator('.actions')).toHaveCSS('grid-template-columns', /^\S+px \S+px \S+px$/);
	await page.getByRole('button', { name: 'TAP ALL 2' }).click();
	await page.getByRole('button', { name: 'LINK 2 MORE' }).click();
	await expect(band(page)).toHaveText('LINKED 3 SERIES · THE BEGINNING AFTER THE END');
	// The rest of the queue: the novel Ranobe hasn't got.
	await expect(page.locator('.title')).toHaveText('Lord of the Mysteries: 1-1429');
	// UNDO takes back the two; the first stays linked.
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.title')).toHaveText('The Beginning After the End, Vol. 3');
});

test('one left out leads with the work, chosen just now (1c)', async ({ page }) => {
	await page.goto('/links');
	await expect(page.locator('.title')).toHaveText('The Beginning After the End, Vol. 3');
	await expect(page.locator('.cand .why').first()).toHaveText('CHOSEN FOR VOL. 2 JUST NOW');
});

test('nothing found: NOT ON RANOBE, and UNDO (1d)', async ({ page }) => {
	await page.goto('/links?series=' + ids.lotm + '&service=ranobe');
	await expect(page.getByText('Ranobe doesn’t have this novel.')).toBeVisible();
	await expect(page.locator('.suggest .sy')).toHaveText('NOT YET');
	// Suggesting needs the app account's token (c72); this preview has none, and says so.
	await expect(page.locator('.suggest .sd')).toHaveText(
		'NEEDS RANOBE_SUGGEST_TOKEN, THE APP ACCOUNT’S · DOC/RANOBE.MD'
	);
	await page.goto('/links');
	// Skip the two TBATE volumes to reach it.
	await page.getByRole('button', { name: 'SKIP' }).click();
	await page.getByRole('button', { name: 'SKIP' }).click();
	await expect(page.locator('.title')).toHaveText('Lord of the Mysteries: 1-1429');
	await expect(page.locator('.actions button')).toHaveText([
		'NOT ON RANOBE',
		'SEARCH AGAIN',
		'PASTE A LINK'
	]);
	await page.getByRole('button', { name: 'NOT ON RANOBE' }).click();
	await expect(band(page)).toHaveText('NOT ON RANOBE · WON’T ASK AGAIN');
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.title')).toHaveText('Lord of the Mysteries: 1-1429');
});

test('a pasted link reads the id only, and says when Ranobe doesn’t answer (1e)', async ({
	page
}) => {
	await page.goto(`/links?series=${ids.lotm}&service=ranobe&paste`);
	const field = page.getByLabel('Ranobe link');
	await field.fill('https://anilist.co/manga/2');
	await expect(page.locator('.fnote.last')).toHaveText('NOT A RANOBE WORK LINK');
	await field.fill('https://ranobe.ink/w2');
	await expect(page.locator('.fnote.last')).toHaveText(
		'RANOBE DID NOT ANSWER · TRY AGAIN WHEN IT’S BACK'
	);
});

test('the series screen draws Ranobe’s LINK and TRACKING rows (2a, 2h)', async ({ page }) => {
	await page.goto(`/series/${ids.v2}`);
	const link = page.locator('.link-row');
	await expect(link.locator('.lk-a')).toHaveText('The Beginning After the End');
	await expect(link.locator('.lk-b')).toContainText('RANOBE W388');
	await expect(link.getByRole('link', { name: 'RANOBE ↗' })).toHaveAttribute(
		'href',
		'https://ranobe.ink/w388'
	);
	await expect(page.locator('.track-row .tl-l').first()).toHaveText(
		'RANOBE · WAITING ON AN EDITION'
	);
	await page.goto(`/series/${ids.lotm}`);
	await expect(page.locator('.link-row .lk-a')).toHaveText('Not on Ranobe');
	await expect(page.locator('.track-row .tl-l')).toHaveText('NOT ON RANOBE');
	await expect(page.locator('.link-row').getByRole('link', { name: 'FIND' })).toHaveAttribute(
		'href',
		`/links?series=${ids.lotm}&service=ranobe`
	);
});

test('SETTINGS has a RANOBE row with no sign-in (3a)', async ({ page }) => {
	await page.goto('/settings');
	const row = page.locator('.acct.ranobe');
	await expect(row.locator('.label')).toHaveText('RANOBE');
	await expect(row.locator('.name')).toHaveText('Token in .env');
	await expect(row.locator('.meta').first()).toHaveText(
		'NOVELS · READ AND WRITTEN · NOTHING SENT YET'
	);
	await expect(row.getByRole('link', { name: /TO CHOOSE/ })).toHaveAttribute('href', '/links');
	await expect(row.getByRole('button')).toHaveCount(0);
	// Three lines, so taller than a sign-in's row (3a: 84px against 68px).
	await expect(row).toHaveCSS('min-height', '84px');
});
