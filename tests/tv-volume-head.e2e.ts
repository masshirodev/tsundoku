import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * A volume's head on a TV: it is not a focus stop, and arriving on the row
 * under it shows it. The row under a head is the first row that can take focus
 * after it, whatever it is -- a volume's first chapter, a front-matter entry
 * under its FRONT MATTER section, a fold, or, descending, its last chapter --
 * so each is walked upward here, and the head is read at its top and bottom
 * edges with `elementFromPoint` (a box can be right and still be behind a bar).
 * Its own preview and seeded database, because it groups two novels and writes
 * their entries' read state; nothing of the shared seed is written, and no
 * other TV spec touches these two.
 */

let work: string;
let dbPath: string;
let base: string;
let preview: ChildProcess | undefined;
let grouped = 0;
/** The volumes' files, in the order the heads are drawn (ascending). */
let files: string[] = [];
/** V1's and V2's chapters, ascending, front and back matter left out. */
let first: number[] = [];
let second: number[] = [];

function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address() as AddressInfo;
			s.close(() => resolve(port));
		});
	});
}

function query<T>(sql: string, ...args: unknown[]): T[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db.prepare(sql).all(...args) as T[];
	} finally {
		db.close();
	}
}

/** The world's own rows, written the way a real import's shapes are. */
function run(sql: string, ...args: unknown[]): void {
	const db = new Database(dbPath);
	try {
		db.pragma('busy_timeout = 5000');
		db.prepare(sql).run(...args);
	} finally {
		db.close();
	}
}

test.describe.configure({ mode: 'serial' });

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test.beforeAll(async ({}, testInfo) => {
	test.skip(testInfo.project.name !== 'tv', 'the TV project is the one with no pointer');
	test.setTimeout(180_000);
	work = mkdtempSync(join(tmpdir(), 'tsundoku-tv-volume-head-'));
	dbPath = join(work, 'library.sqlite');
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const port = await freePort();
	base = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			TSUNDOKU_HOME: join(work, 'home'),
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
			BACKUP_DIR: join(work, 'backups')
		},
		stdio: 'ignore'
	});
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			up = (await fetch(base, { redirect: 'manual' })).status > 0;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	expect(up, 'the preview answered').toBe(true);
});

test.afterAll(async () => {
	preview?.kill();
	if (work) rmSync(work, { recursive: true, force: true });
});

const url = (path: string) => `${base}${path}`;

async function scrollTop(page: Page): Promise<number> {
	return page.evaluate(() => {
		const rows = document.querySelector('ol.rows') as HTMLElement | null;
		for (let el = rows?.parentElement ?? null; el && el !== document.body; el = el.parentElement) {
			const overflow = getComputedStyle(el).overflowY;
			if (overflow === 'auto' || overflow === 'scroll') return el.scrollTop;
		}
		return window.scrollY;
	});
}

/** The id of the focused row's `li` (`entry-<id>`, or `fold`). */
async function activeRow(page: Page): Promise<string> {
	return page.evaluate(() => {
		const li = (document.activeElement as HTMLElement | null)?.closest('li');
		return li?.id || (li?.classList.contains('fold') ? 'fold' : '');
	});
}

/** The row under the [nth] volume's head, as its `li` id (`fold` for a fold). */
async function rowUnderHead(page: Page, nth: number): Promise<string> {
	return page.evaluate((n) => {
		const list = document.querySelector('section.list') as HTMLElement;
		const heads = [...list.querySelectorAll('ol.rows > li.volume')];
		let row = (heads[n] as HTMLElement).nextElementSibling;
		while (row && !row.matches('li.entry, li.fold')) row = row.nextElementSibling;
		return row?.id || (row?.classList.contains('fold') ? 'fold' : '');
	}, nth);
}

/**
 * Put the list where the [nth] head's row sits at the top of the band under
 * the sticky bar -- the state a `reveal` leaves for a row it found under a bar
 * -- and focus the row after it, so one ↑ arrives on it. Nothing is computed
 * by hand: the bar's own bottom and the row's own top are read from the DOM.
 */
async function standBelowHead(page: Page, nth: number): Promise<void> {
	await page.evaluate((n) => {
		const list = document.querySelector('section.list') as HTMLElement;
		const bar = list.querySelector(':scope > .head') as HTMLElement;
		const heads = [...list.querySelectorAll('ol.rows > li.volume')];
		const nextRow = (from: Element | null) => {
			let row = from?.nextElementSibling ?? null;
			while (row && !row.matches('li.entry, li.fold')) row = row.nextElementSibling;
			return row as HTMLElement | null;
		};
		const under = nextRow(heads[n])!;
		const below = nextRow(under)!;
		let scroller = under.parentElement;
		while (
			scroller &&
			scroller !== document.body &&
			!['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)
		)
			scroller = scroller.parentElement;
		const target = (scroller ?? document.scrollingElement) as HTMLElement;
		const by = under.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
		target.scrollTop += by;
		below.querySelector<HTMLElement>('.entry-btn, button')!.focus({ preventScroll: true });
	}, nth);
}

/**
 * What the [nth] head looks like now: is the element at its top edge and its
 * bottom edge the head itself (inside the list column), and is it on screen?
 */
async function headDrawn(
	page: Page,
	nth: number
): Promise<{ top: boolean; bottom: boolean; inView: boolean }> {
	return page.evaluate((n) => {
		const list = document.querySelector('section.list') as HTMLElement;
		const head = [...list.querySelectorAll('ol.rows > li.volume')][n] as HTMLElement;
		const r = head.getBoundingClientRect();
		// A point inside the list column, where the head spans.
		const x = r.left + Math.min(40, r.width / 2);
		const isHead = (y: number) => document.elementFromPoint(x, y)?.closest('.volume') === head;
		return {
			top: isHead(r.top + 2),
			bottom: isHead(r.bottom - 2),
			inView: r.top >= 0 && r.bottom <= window.innerHeight
		};
	}, nth);
}

/** One upward walk: the head hidden, one ↑, then the head drawn and the list moved. */
async function walkUpToHead(page: Page, nth: number, expected: string, name: string) {
	await standBelowHead(page, nth);
	expect((await headDrawn(page, nth)).top, `${name}: the head starts hidden`).toBe(false);
	const before = await scrollTop(page);
	await page.keyboard.press('ArrowUp');
	await expect
		.poll(() => activeRow(page), { message: `${name}: ↑ arrived under the head` })
		.toBe(expected);
	const drawn = await headDrawn(page, nth);
	expect({ top: drawn.top, bottom: drawn.bottom, inView: drawn.inView }, name).toEqual({
		top: true,
		bottom: true,
		inView: true
	});
	// The list had room the way it came: the arrival itself moved it up.
	await expect
		.poll(() => scrollTop(page), { message: `${name}: the arriving row moved the list` })
		.toBeLessThan(before);
}

test.describe('a volume’s head on a TV', () => {
	// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
	test.beforeEach(async ({}, testInfo) => {
		test.skip(testInfo.project.name !== 'tv', 'the TV project alone');
	});

	test.beforeAll(async ({ browser }, testInfo) => {
		if (testInfo.project.name !== 'tv') return;
		test.setTimeout(120_000);
		// The TV has no SELECT: GROUP is the sheet's own form action, posted with
		// the two novels' ids, which is what the sheet sends.
		const ids = query<{ id: number; title: string }>(
			`SELECT id, title FROM series WHERE title IN ('Villainess Level 99', 'Tensei Shitara Ken Deshita')`
		);
		if (ids.length !== 2) throw new Error(`the seed's two novels: ${JSON.stringify(ids)}`);
		const body = new URLSearchParams();
		for (const s of ids) body.append('series', String(s.id));
		body.append('name', 'TV Volumes');
		const page = await browser.newPage();
		try {
			const answer = await page.request.post(url('/?/group'), {
				data: body.toString(),
				headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' },
				maxRedirects: 0
			});
			expect(answer.status(), 'the GROUP action answered').toBeLessThan(400);
		} finally {
			await page.close();
		}
		grouped = (
			query<{ id: number }>(`SELECT id FROM series WHERE title = 'TV Volumes'`)[0] ?? { id: 0 }
		).id;
		expect(grouped, 'the group exists').toBeGreaterThan(0);
		files = query<{ file: string }>(
			`SELECT file, MIN(position) AS p FROM entries WHERE series_id = ? AND matter = '' GROUP BY file ORDER BY p`,
			grouped
		).map((r) => r.file);
		const chapters = (file: string) =>
			query<{ id: number }>(
				`SELECT id FROM entries WHERE series_id = ? AND file = ? AND matter = '' ORDER BY position`,
				grouped,
				file
			).map((r) => r.id);
		first = chapters(files[0]);
		second = chapters(files[1]);
		expect(first.length, 'V1 has chapters').toBeGreaterThan(2);
		expect(second.length, 'V2 has chapters').toBeGreaterThan(2);
	});

	test('is not a stop: ↓ goes from V1’s last chapter to V2’s first', async ({ page }) => {
		await page.goto(url(`/series/${grouped}`));
		const lastOfOne = first[first.length - 1];
		const firstOfTwo = second[0];

		// The head is not a focus stop and holds nothing focusable.
		const head = page.locator('ol.rows > li.volume').nth(1);
		await expect(head).toBeVisible();
		expect(await head.locator('a, button, [tabindex]').count()).toBe(0);

		// A person arrives on V1's last chapter (its row carries focus), then ↓.
		await page.locator(`#entry-${lastOfOne} .entry-btn`).focus();
		await page.keyboard.press('ArrowDown');
		await expect
			.poll(() => activeRow(page), {
				message: 'the D-pad skipped the head, to V2'
			})
			.toBe(`entry-${firstOfTwo}`);
		// Nothing on the way landed on the head: it has no focus id, and the
		// active element is a chapter row, not the volume row.
		expect(await page.evaluate(() => document.activeElement?.closest('.volume') !== null)).toBe(
			false
		);
		// The head sits above the row this lands on. Walking down, that is true
		// whether or not anything scrolls the head into view, so this case shows
		// nothing about the arrival under a head; the upward walks below do.
		const view = page.viewportSize()!;
		const box = (await head.boundingBox())!;
		expect(box.y, 'the head’s top').toBeGreaterThanOrEqual(0);
		expect(box.y + box.height, 'the head’s bottom, on screen').toBeLessThanOrEqual(view.height);
	});

	test('upward, no front matter: arriving on V2’s first chapter shows its head', async ({
		page
	}) => {
		await page.goto(url(`/series/${grouped}`));
		expect(await rowUnderHead(page, 1)).toBe(`entry-${second[0]}`);
		await walkUpToHead(page, 1, `entry-${second[0]}`, 'V2, no front matter');
	});

	test('upward, front matter under the head: the entry under FRONT MATTER shows it', async ({
		page
	}) => {
		// A real import's shape: the volume's first entry is its Cover, so the
		// rows read v2, v2:front, the front-matter entry, v2:chapters, …
		const cover = second[0];
		const was = query<{ matter: string }>(`SELECT matter FROM entries WHERE id = ?`, cover)[0];
		run(`UPDATE entries SET matter = 'front' WHERE id = ?`, cover);
		try {
			await page.goto(url(`/series/${grouped}`));
			expect(await rowUnderHead(page, 1)).toBe(`entry-${cover}`);
			await walkUpToHead(page, 1, `entry-${cover}`, 'V2, front matter');
		} finally {
			run(`UPDATE entries SET matter = ? WHERE id = ?`, was.matter, cover);
		}
	});

	test('upward, the volume being read: a fold under its head shows it', async ({ page }) => {
		// V1 is the volume being read: its first five chapters read, the sixth
		// where the reader is, so its leading read chapters fold under the head.
		const read = first.slice(0, 5);
		const at = first[5];
		const was = read.map(
			(id) => query<{ read_at: number | null }>(`SELECT read_at FROM entries WHERE id = ?`, id)[0]
		);
		const wasAt = query<{ read_at: number | null; last_opened_at: number | null }>(
			`SELECT read_at, last_opened_at FROM entries WHERE id = ?`,
			at
		)[0];
		for (const id of read) run(`UPDATE entries SET read_at = ? WHERE id = ?`, Date.now(), id);
		run(`UPDATE entries SET read_at = NULL, last_opened_at = ? WHERE id = ?`, Date.now(), at);
		try {
			await page.goto(url(`/series/${grouped}`));
			expect(await rowUnderHead(page, 0)).toBe('fold');
			await walkUpToHead(page, 0, 'fold', 'V1, a fold under its head');
		} finally {
			for (const [i, id] of read.entries())
				run(`UPDATE entries SET read_at = ? WHERE id = ?`, was[i].read_at, id);
			run(
				`UPDATE entries SET read_at = ?, last_opened_at = ? WHERE id = ?`,
				wasAt.read_at,
				wasAt.last_opened_at,
				at
			);
		}
	});

	test('upward, descending: the volume’s last chapter is the row under its head', async ({
		page
	}) => {
		await page.goto(url(`/series/${grouped}`));
		// The sort cell flips the list, as it does for a person.
		await page.locator('.tool.sort').click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(document.querySelector('ol.rows > li.volume') as HTMLElement)?.getAttribute(
							'aria-label'
						) ?? ''
				)
			)
			.toContain('VOL. 2');
		expect(await rowUnderHead(page, 1)).toBe(`entry-${first[first.length - 1]}`);
		await walkUpToHead(page, 1, `entry-${first[first.length - 1]}`, 'V1, descending');
	});

	test('upward, V1: its own first chapter shows the first head', async ({ page }) => {
		await page.goto(url(`/series/${grouped}`));
		expect(await rowUnderHead(page, 0)).toBe(`entry-${first[0]}`);
		await walkUpToHead(page, 0, `entry-${first[0]}`, 'V1, ascending');
	});
});
