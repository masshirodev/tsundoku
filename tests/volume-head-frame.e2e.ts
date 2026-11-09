import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * A volume's head, measured in a real browser (c835;
 * doc/handoffs/grouped-volumes/Head-Devices.dc.html and Head-Phone.dc.html). Its three widths, its
 * cover, its three lines of facts, the 3px bar on the volume being read and a
 * read volume's title in text-2. The numbers are the handoff's hand-set ones
 * (52/104 and 40/82) and do not round to a spacing ladder, so this stops a
 * later tidy-up from redrawing the row.
 *
 * A board, not a screen: the generator pins a screen's frame, so this was
 * written by hand from the boards' declared values (extract-spec's
 * `Head-Phone` summary: the head's grid is `346px 44px` at 412; the rest are
 * gv.css's `.vh` block). It seeds and serves its own database and port
 * because it groups two novels and marks chapters read; nothing of the shared
 * seed is written. It runs once, in tablet-portrait, and the TV's own
 * measurements are tests/tv-volume-head.e2e.ts's. Its last case is the
 * pointer's half of 1D: a tap focuses the row under a head and must move
 * nothing.
 */

let work: string;
let dbPath: string;
let base: string;
let preview: ChildProcess | undefined;
/** The group the first case made; the rail case reads the same one. */
let groupedSeries = 0;

function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address() as AddressInfo;
			s.close(() => resolve(port));
		});
	});
}

test.describe.configure({ mode: 'serial' });

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test.beforeAll(async ({}, testInfo) => {
	test.skip(testInfo.project.name !== 'tablet-portrait', 'once: it seeds its own database');
	test.setTimeout(180_000);
	work = mkdtempSync(join(tmpdir(), 'tsundoku-volume-head-'));
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

/** The two novels grouped through the app's own SELECT and GROUP, as a person does. */
async function groupTwo(page: import('@playwright/test').Page): Promise<number> {
	const titles = ['Villainess Level 99', 'Tensei Shitara Ken Deshita'];
	await page.goto(url('/?shelf=k:novel&sort=title'));
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of titles) await page.locator('.grid .tile', { hasText: t }).click();
	await page.getByRole('button', { name: /GROUP/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('textbox', { name: 'Series name' }).fill('Measured Volumes');
	await sheet.getByRole('button', { name: /CREATE SERIES · 2 VOLUMES/ }).click();
	await expect(page).toHaveURL(/\/series\/\d+\?created=2/);
	return Number(new URL(page.url()).pathname.split('/').pop());
}

test.describe('the volume head', () => {
	// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
	test.beforeEach(async ({}, testInfo) => {
		test.skip(testInfo.project.name !== 'tablet-portrait', 'pinned at tablet-portrait');
	});

	test('is 104px at tablet and desktop and 82 on a phone, its cover at 2:2.9', async ({ page }) => {
		const series = (groupedSeries = await groupTwo(page));
		// Mark volume 1 read and volume 2 all but its last chapter: one head is
		// read (text-2 title), one is being read (accent word and a bar).
		const files = volumeFiles(series);
		const one = chapterIds(series, files[0]);
		const two = chapterIds(series, files[1]);
		for (const id of [...one, ...two.slice(0, -1)])
			await page.request.post(url('/api/reading'), {
				data: { seriesId: series, entryId: id, kind: 'finish', page: 0 },
				headers: { origin: base }
			});
		await page.reload();

		const read = page.locator('.volume.read').first();
		const reading = page.locator('.volume.reading').first();
		await expect(read).toHaveCount(1);
		await expect(reading).toHaveCount(1);
		// Not a button, and no focus stop inside: the D-pad walks the chapters.
		expect(await read.locator('a, button').count()).toBe(0);
		expect(await read.getAttribute('data-focus-mark')).toBeNull();

		for (const [name, width, height, headH, coverW, titlePx, metaPx] of [
			['tablet', 800, 1280, 104, 52, 17, 13],
			['phone', 412, 915, 82, 40, 16, 12],
			['desktop', 1280, 800, 104, 52, 17, 13]
		] as const) {
			await page.setViewportSize({ width, height });
			await expect(read, `${name}: the read head is drawn`).toBeVisible();
			const box = (await read.boundingBox())!;
			expect(Math.round(box.height), `${name}: the head's height`).toBe(headH);

			const cover = (await read.locator('.vcover').boundingBox())!;
			expect(Math.round(cover.width), `${name}: the cover's width`).toBe(coverW);
			// 2:2.9, the design's cover shape at every width.
			expect(Math.abs(cover.height - coverW * 1.45), `${name}: 2:2.9`).toBeLessThan(1);

			const style = await read.evaluate((n) => {
				const cs = (sel: string) => getComputedStyle(n.querySelector(sel)!);
				const probe = document.createElement('span');
				probe.style.background = 'var(--surface-page)';
				document.body.append(probe);
				const page = getComputedStyle(probe).backgroundColor;
				probe.remove();
				const vnum = n.querySelector('.vnum > span') as HTMLElement;
				const box = vnum.getBoundingClientRect();
				return {
					title: cs('.vt').fontSize,
					label: cs('.vk').fontSize,
					meta: cs('.vm').fontSize,
					readTitle: cs('.vt').color,
					metaColor: cs('.vm').color,
					weight: cs('.vt').fontWeight,
					vnumText: vnum.textContent,
					vnumSize: getComputedStyle(vnum).fontSize,
					vnumWidth: Math.round(box.width),
					vnumBg: getComputedStyle(vnum).backgroundColor,
					page
				};
			});
			expect(style.title, `${name}: the title's size`).toBe(`${titlePx}px`);
			expect(style.weight).toBe('500');
			expect(style.label, `${name}: the label and state`).toBe(`${metaPx}px`);
			expect(style.meta, `${name}: the facts`).toBe(`${metaPx}px`);
			// A read volume's title drops to text-2, as its facts are.
			expect(style.readTitle, `${name}: a read title is text-2`).toBe(style.metaColor);
			// No cover (the seed's novels have no files): the series' stripes with
			// the volume's number in a page-coloured cell (c835, 1A/1C).
			expect(style.vnumText, `${name}: the volume's number on the stripes`).toBe('1');
			expect(style.vnumSize, `${name}: the number's size`).toBe(name === 'phone' ? '13px' : '15px');
			expect(style.vnumWidth, `${name}: the number's cell`).toBe(name === 'phone' ? 22 : 26);
			expect(style.vnumBg, `${name}: the number's page cell`).toBe(style.page);
			// The seed's novels carry a sample with no cover: the endpoint 404s and
			// the image takes itself out, leaving the stripes and the number.
			if (await read.locator('.vcover img').count())
				await expect(read.locator('.vcover img')).toBeHidden();

			// The volume being read: its word and its bar are the accent.
			const accent = await reading.evaluate((n) => ({
				word: getComputedStyle(n.querySelector('.vst')!).color,
				bar: getComputedStyle(n.querySelector('.vpb > i')!).backgroundColor,
				track: Math.round(n.querySelector('.vpb')!.getBoundingClientRect().height),
				height: Math.round(n.querySelector('.vpb')!.getBoundingClientRect().height)
			}));
			expect(accent.word).toBe(accent.bar);
			expect(accent.height, `${name}: the 3px bar`).toBe(3);
			// The fill is the fraction of the volume's chapters read (all but the last).
			const fill = (await reading.locator('.vpb > i').boundingBox())!;
			const track = (await reading.locator('.vpb').boundingBox())!;
			expect(fill.width / track.width).toBeCloseTo((two.length - 1) / two.length, 1);
		}
	});

	test('the rail ticks are the volumes, the thumb’s in ink (1C)', async ({ page }) => {
		await page.goto(url(`/series/${groupedSeries}`));
		await page.setViewportSize({ width: 800, height: 1280 });
		const ticks = page.locator('.rail .tick.vol');
		await expect(ticks).toHaveCount(2);
		expect(await ticks.locator('> span').allTextContents()).toEqual(['V1', 'V2']);
		// The volume the thumb is in is the one in ink, and every hairline is 1px.
		await expect(page.locator('.rail .tick.vol.on')).toHaveCount(1);
		const hairline = await ticks.first().evaluate((n) => getComputedStyle(n).borderTopWidth);
		expect(hairline).toBe('1px');
		// A series with one volume keeps today's list: no volume ticks, and the
		// numbers' ticks stay (the brief's own case).
		const one = seriesId('Mushoku Tensei');
		await page.goto(url(`/series/${one}`));
		await expect(page.locator('.rail .tick.vol')).toHaveCount(0);
		expect(await page.locator('.rail .tick').count()).toBeGreaterThan(0);
	});

	test('a pointer’s tap on the row under a head focuses it and moves nothing (1D)', async ({
		page
	}) => {
		await page.goto(url(`/series/${groupedSeries}`));
		await page.setViewportSize({ width: 800, height: 1280 });
		// V1's head: the first case left V1 read and V2 the volume being read, so
		// V1 lists every chapter (no fold) and the page has room to scroll.
		const files = volumeFiles(groupedSeries);
		const under = page.locator(`#entry-${chapterIds(groupedSeries, files[0])[0]} .entry-btn`);
		// Scroll the page so V1's head is behind the sticky bar and the row under
		// it sits just below: the state the focus layer's reveal leaves.
		const hidden = await page.evaluate(() => {
			const list = document.querySelector('section.list') as HTMLElement;
			const bar = list.querySelector(':scope > .head') as HTMLElement;
			const heads = [...list.querySelectorAll('ol.rows > li.volume')];
			let row = (heads[0] as HTMLElement).nextElementSibling;
			while (row && !row.matches('li.entry, li.fold')) row = row.nextElementSibling;
			// The page scrolls here, and the bar only pins once it reaches its own
			// sticky top: aim at the row's place in the document, not at its
			// distance from a bar that is still moving.
			const docTop = (row as HTMLElement).getBoundingClientRect().top + window.scrollY;
			const stick = Number.parseFloat(getComputedStyle(bar).top) || 0;
			window.scrollTo({
				top: docTop - stick - bar.getBoundingClientRect().height,
				behavior: 'instant'
			});
			const r = (heads[0] as HTMLElement).getBoundingClientRect();
			return document.elementFromPoint(r.left + 20, r.top + 2)?.closest('.volume') !== heads[0];
		});
		expect(hidden, 'the head starts behind the bar').toBe(true);

		// A pointer's tap focuses the row and must move nothing. The click is
		// stopped at the document, so the row is not also opened.
		await page.evaluate(() => {
			const stop = (e: Event) => {
				e.preventDefault();
				e.stopImmediatePropagation();
			};
			(window as unknown as { stopTap: (e: Event) => void }).stopTap = stop;
			document.addEventListener('click', stop, true);
		});
		const before = await page.evaluate(() => window.scrollY);
		await under.click();
		expect(
			await page.evaluate(() => document.activeElement?.closest('li')?.id ?? ''),
			'the tap focused the row it landed on'
		).toBe(await under.evaluate((n) => n.closest('li')!.id));
		expect(await page.evaluate(() => window.scrollY), 'a tap moved nothing').toBe(before);
		await page.evaluate(() => {
			const w = window as unknown as { stopTap: (e: Event) => void };
			document.removeEventListener('click', w.stopTap, true);
		});
	});
});

/** A volume's chapters, front and back matter not among them. */
function chapterIds(series: number, file: string): number[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (
			db
				.prepare(
					`SELECT id FROM entries WHERE series_id = ? AND file = ? AND matter = '' ORDER BY position`
				)
				.all(series, file) as { id: number }[]
		).map((r) => r.id);
	} finally {
		db.close();
	}
}

/** The volume files in reading order, as the series' entries give them. */
function volumeFiles(series: number): string[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (
			db
				.prepare(
					`SELECT file, MIN(position) AS p FROM entries WHERE series_id = ? GROUP BY file ORDER BY p`
				)
				.all(series) as { file: string }[]
		).map((r) => r.file);
	} finally {
		db.close();
	}
}

/** A seeded series' id, by its title. */
function seriesId(title: string): number {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (
			db.prepare(`SELECT id FROM series WHERE title = ? AND in_library = 1`).get(title) as {
				id: number;
			}
		).id;
	} finally {
		db.close();
	}
}
