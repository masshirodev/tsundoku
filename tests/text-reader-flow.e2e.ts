import type { Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { sampleEpub } from '../src/lib/server/pages/sample-epub';
import { Zip } from '../src/lib/epub/unzip';
import { drawnFonts } from './helpers/fonts';
import { expect, test } from './helpers/hydrated';

/**
 * The text reader (doc/TEXT-READER.md), against the seed's generated EPUBs.
 * This file owns Honzuki no Gekokujou, a novel read to the end, so reading it
 * again moves no CONTINUE row another spec counts.
 */
const TITLE = 'Honzuki no Gekokujou';
test.describe.configure({ mode: 'serial' });
// `serveBook` stubs the whole book, `/api/series/<id>/epub`, which the service
// worker answers once it controls the page, and `page.route` never sees a
// request the worker sends: a trace of the Japanese case's failure shows the
// worker fetching the seed's English book while the files came from the stub,
// and the reader setting the English one (round 2, 1 in 34 at two workers).
// Nothing in this file reads offline; offline-flow owns that.
test.use({ serviceWorkers: 'block' });

async function openBook(page: Page) {
	await page.goto('/');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\//);
	await page
		.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ })
		.first()
		.click();
	await page.waitForURL(/\/read\//);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
}

/** The top margin: always the controls, never a word or an illustration. */
const middle = async (page: Page) => {
	const v = page.viewportSize()!;
	await page.mouse.click(v.width / 2, 30);
};
/**
 * Turn one page, and return once the reader has turned it and the page has
 * landed: the flow's transform (set to where the slide lands as it starts,
 * c441) or the chapter's heading has moved, both of which the click changes
 * at once, and the flow has stopped sliding, so what is measured next is not
 * moving. A click the reader hadn't handled
 * yet was read as "no turn" under a loaded suite, and the next click turned
 * twice, past the page the test was looking for (c394, c439). The URL is no
 * witness: the reader rewrites `?at=` 800 ms after the *previous* turn, so it
 * can move with no click at all (measured in round 2: `?at=0.0` became
 * `?at=3.0` 900 ms after a turn, nothing clicked).
 */
const forward = async (page: Page) => {
	const where = () =>
		page.evaluate(
			() =>
				`${document.querySelector('.blocks h1')?.textContent ?? ''} ${
					document.querySelector<HTMLElement>('.flow')?.style.transform ?? ''
				}`
		);
	const before = await where();
	const v = page.viewportSize()!;
	await page.mouse.click(v.width - 8, v.height / 2);
	await expect.poll(where).not.toBe(before);
	await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
};

test('a novel opens as text, turns, and carries on into the next chapter', async ({ page }) => {
	await openBook(page);
	// Vol. 1 of the sample: its heading, and the illustration it starts with.
	await expect(page.locator('.blocks h1')).toHaveText('Vol. 1');
	await expect(page.locator('figure.illus img').first()).toHaveAttribute('src', /^blob:/);
	const first = page.url();
	const report = page.waitForRequest(
		(r) => r.url().endsWith('/api/reading') && r.postDataJSON()?.kind === 'page'
	);
	// Page by page until the chapter changes: how many pages it has is the layout's business.
	for (let i = 0; i < 12 && (await page.locator('.blocks h1').textContent()) === 'Vol. 1'; i++)
		await forward(page);
	// Moving on is the reader's own business: no page load, a new URL.
	await expect(page.locator('.blocks h1')).toHaveText('Vol. 2');
	await expect(page).not.toHaveURL(first);
	// Progress is a paragraph and a character, with the chapter's size.
	const body = (await report).postDataJSON();
	expect(body).toMatchObject({ kind: 'page' });
	expect(Number.isInteger(body.offset) && body.total > 1).toBe(true);
});

test('left at once, the text reader never writes its ?at= onto the series it went back to (c565)', async ({
	page
}) => {
	await openBook(page);
	// The series slower to answer than the reader's 800 ms settle (see the
	// image reader's case in reader-flow): the timer used to fire while BACK's
	// load was out and write /read/<id>?at= onto the series' entry.
	await page.route('**/series/*/__data.json*', async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});
	// A page turned just before leaving: its settle is still to come as BACK
	// starts, whenever the book's first one fired.
	await forward(page);
	await middle(page);
	await page.getByRole('link', { name: 'Back to the series' }).click();
	await expect(page.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ }).first()).toBeVisible();
	await expect(page).toHaveURL(/\/series\/\d+(\?|$)/);
	await page.unroute('**/series/*/__data.json*');
	await page.reload();
	await expect(page).toHaveURL(/\/series\/\d+(\?|$)/);
	await page.goBack();
	await expect(page).not.toHaveURL(/\/read\//);
});

test('the controls say where you are, and READING keeps your place as type changes', async ({
	page
}) => {
	await openBook(page);
	await forward(page);
	await middle(page);
	await expect(page.locator('.top .meta')).toHaveText(/^NOVEL · CH\. 1 OF 33 · \d+% OF BOOK$/);
	await expect(page.locator('.bottom .left')).toHaveText(/^P\. 2 OF \d+/);
	const at = () => page.evaluate(() => new URL(location.href).searchParams.get('at'));
	await expect.poll(at).not.toBeNull();
	const before = await at();
	await page.getByRole('button', { name: /^PAGED · SERIF/ }).click();
	await page.getByRole('button', { name: 'Larger' }).click();
	await page.getByRole('button', { name: 'Larger' }).click();
	await expect(page.getByRole('button', { name: 'Device default' })).toHaveText('22 PX');
	// The same paragraph is still on screen after the text grew.
	const [b] = before!.split('.').map(Number);
	await expect(page.locator(`[data-b="${b}"]`)).toBeInViewport();
	await page.getByRole('button', { name: 'Device default' }).click();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
});

/** How many pages the open chapter's flow lays out to, from the flow itself. */
const pagesNow = (page: Page) =>
	page.locator('.flow').evaluate((el: HTMLElement) => {
		const box = el.parentElement!;
		const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
		return Math.round((el.scrollWidth + gap) / (box.clientWidth + gap));
	});

/** Whether OpenDyslexic is declared on the page at all, and whether a face of it has loaded. */
const dyslexic = (page: Page) =>
	page.evaluate(() => {
		const faces = [...document.fonts].filter(
			(f) => f.family.replace(/["']/g, '') === 'OpenDyslexic'
		);
		return { declared: faces.length > 0, loaded: faces.some((f) => f.status === 'loaded') };
	});

test('FONT offers OpenDyslexic, loads it only once chosen, keeps it, and lays the pages out again (c442)', async ({
	page
}) => {
	await openBook(page);
	// Nothing of it until it is asked for: the bundle's face costs nothing to a Plex reader.
	expect(await dyslexic(page)).toEqual({ declared: false, loaded: false });
	const before = await pagesNow(page);

	await middle(page);
	await page.getByRole('button', { name: /^PAGED · SERIF/ }).click();
	const choice = page.getByRole('radiogroup', { name: 'FONT' }).getByRole('radio', {
		name: 'OpenDyslexic'
	});
	// Each name is drawn in its own font.
	await expect(choice).toHaveCSS('font-family', /^"?OpenDyslexic"?,/);
	await choice.click();
	await expect(choice).toHaveAttribute('aria-checked', 'true');
	await expect(page.locator('.flow')).toHaveCSS(
		'font-family',
		/^"?OpenDyslexic"?, "IBM Plex Sans JP"/
	);
	await expect.poll(() => dyslexic(page)).toEqual({ declared: true, loaded: true });
	expect(await page.evaluate(() => document.fonts.check('20px OpenDyslexic'))).toBe(true);
	// The wider face makes more pages, and the reader counted them again.
	await expect.poll(() => pagesNow(page)).toBeGreaterThan(before);
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.getByRole('button', { name: /^PAGED · DYSLEXIC/ })).toBeVisible();

	// Kept on the device: a reload opens in it, and fetches it again.
	await page.reload();
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
	await expect(page.locator('.flow')).toHaveCSS('font-family', /^"?OpenDyslexic"?,/);
	await expect.poll(() => dyslexic(page)).toEqual({ declared: true, loaded: true });

	// A FONT this build doesn't know (a newer build's) is the default, never an
	// empty font-family; the rest of the stored settings stay.
	await page.evaluate(() => {
		const k = 'tsundoku.text.settings';
		const s = JSON.parse(localStorage.getItem(k) ?? '{}');
		localStorage.setItem(k, JSON.stringify({ ...s, font: 'literata', theme: 'paper' }));
	});
	await page.reload();
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
	await expect(page.locator('.flow')).toHaveCSS(
		'font-family',
		/^"IBM Plex Serif", "IBM Plex Sans JP"/
	);
	await expect(page.locator('.text-reader')).toHaveClass(/paper/);
	await middle(page);
	await expect(page.getByRole('button', { name: /^PAGED · SERIF \d+ · PAPER/ })).toBeVisible();
});

test('the wheel turns one page a gesture, and back', async ({ page }) => {
	await openBook(page);
	const v = page.viewportSize()!;
	await page.mouse.move(v.width / 2, v.height / 2);
	// The page on screen: the chapter, and how far its flow is translated. A
	// turn off a chapter's last page opens the next one at 0.
	const at = () =>
		page.evaluate(() => {
			const flow = document.querySelector<HTMLElement>('.flow');
			const x = /translateX\((-?[\d.]+)px\)/.exec(flow?.style.transform ?? '')?.[1] ?? '0';
			return `${document.querySelector('.blocks h1')?.textContent} @ ${Number(x)}`;
		});
	const start = await at();
	// A notch, then a touchpad's inertia: still one page. Dispatched in one go,
	// so a loaded machine can't space them into gestures of their own.
	await page.evaluate(() => {
		for (const deltaY of [120, 20, 20, 20, 20, 20])
			window.dispatchEvent(new WheelEvent('wheel', { deltaY, cancelable: true }));
	});
	await expect.poll(at).not.toBe(start);
	const turned = await at();
	await page.waitForTimeout(300);
	expect(await at()).toBe(turned);
	await page.mouse.wheel(0, -120);
	await expect.poll(at).toBe(start);
});

test('CONTENTS lists the book and opens a chapter', async ({ page }) => {
	await openBook(page);
	await middle(page);
	await page.getByRole('button', { name: 'CONTENTS' }).click();
	const sheet = page.locator('.contents');
	await expect(sheet.getByText('CONTENTS', { exact: true })).toBeVisible();
	await sheet.getByRole('button', { name: /↑ 1 – / }).click();
	await sheet.locator('.entry-btn', { hasText: 'Vol. 5' }).click();
	await expect(page.locator('.blocks h1')).toHaveText('Vol. 5');
});

test('a wide block opens whole, and an illustration full screen', async ({ page }) => {
	await openBook(page);
	await page.locator('figure.illus img').first().click();
	await expect(page.getByRole('dialog', { name: 'Illustration' })).toBeVisible();
	await page.getByRole('dialog', { name: 'Illustration' }).click();
	await expect(page.getByRole('dialog', { name: 'Illustration' })).toHaveCount(0);
	// Turn until OPEN is on this page: a block on the next one is laid out,
	// and "visible" to Playwright, but translated off-screen.
	const open = page.locator('.wide.code .open');
	// `forward` returns once the turn has happened, so the box is read where
	// the turn left it (c394).
	const onScreen = async () => {
		if ((await open.count()) === 0) return false;
		const b = await open.boundingBox();
		const v = page.viewportSize()!;
		return !!b && b.x >= 0 && b.x + b.width <= v.width;
	};
	for (let i = 0; i < 8 && !(await onScreen()); i++) await forward(page);
	await expect(page.locator('.wide.code .wlabel')).toHaveText(/^LISTING · \d+ COLUMNS, \d+ SHOWN$/);
	await open.click();
	const view = page.getByRole('dialog', { name: 'Listing' });
	await expect(view.locator('pre')).toContainText('walk the import descriptors');
	await view.getByRole('button', { name: 'Close' }).click();
	await expect(view).toHaveCount(0);
});

/** Answer the reader's asks -- file by file, then whole -- from a book made here (doc/TEXT-READER.md). */
async function serveBook(page: Page, epub: Buffer) {
	const zip = new Zip(new Uint8Array(epub));
	const files = await Promise.all(
		zip.names.map(async (name) => ({ name, size: (await zip.bytesOf(name)).length }))
	);
	await page.route('**/api/series/*/epub/files?*', (r) => r.fulfill({ json: { files } }));
	// And the whole book, downloading behind the first chapter.
	await page.route('**/api/series/*/epub?*', (r) =>
		r.fulfill({ body: epub, contentType: 'application/epub+zip' })
	);
	await page.route('**/api/series/*/epub/file?*', async (r) => {
		const name = new URL(r.request().url()).searchParams.get('p') ?? '';
		if (!zip.has(name)) return r.fulfill({ status: 404, body: 'not found' });
		await r.fulfill({ body: Buffer.from(await zip.bytesOf(name)) });
	});
}

/**
 * DIRECTION (c440): R→L, remembered for the series, read again after a reload,
 * and doing nothing in SCROLL. It writes `series.text_direction` for this
 * file's own series, and puts it back (REMEMBER L→R stores NULL, the default)
 * however the case ends, through the same action the sheet posts to.
 */
test('DIRECTION R→L is remembered for the series, survives a reload, and leaves SCROLL alone (c440)', async ({
	page
}) => {
	await openBook(page);
	const entry = /\/read\/(\d+)/.exec(page.url())![1];
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	try {
		await middle(page);
		await page.getByRole('button', { name: /^PAGED · / }).click();
		await expect(sheet.getByText('SERIES DEFAULT L→R')).toBeVisible();
		await sheet.getByRole('radio', { name: 'R→L' }).click();
		const saved = page.waitForResponse(
			(r) => r.url().includes('?/textDirection') && r.request().method() === 'POST'
		);
		await sheet.getByRole('button', { name: 'REMEMBER R→L' }).click();
		expect((await saved).status()).toBe(200);
		await expect(sheet.getByText('SERIES DEFAULT R→L')).toBeVisible();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();

		// Again after a reload: the series reads R→L, and a tap on the left
		// strip reads on, sliding the page right.
		await page.reload();
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		await expect(page.locator('.flow')).toHaveClass(/\brtl\b/);
		const at = () =>
			page
				.locator('.flow')
				.evaluate((el: HTMLElement) =>
					Number(/translateX\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0)
				);
		const before = await at();
		const v = page.viewportSize()!;
		await page.touchscreen.tap(8, v.height / 2);
		await expect.poll(at).toBeGreaterThan(before);
		await expect(page.locator('.flow')).not.toHaveClass(/sliding/);

		// SCROLL: the row is dimmed and says why, the columns run as always, and
		// a tap at the left edge is no turn.
		await middle(page);
		await page.getByRole('button', { name: /^PAGED R→L · / }).click();
		await sheet.getByRole('radio', { name: 'SCROLL' }).click();
		await expect(sheet.getByRole('radio', { name: 'R→L' })).toBeDisabled();
		await expect(sheet.getByText('PAGED ONLY')).toBeVisible();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		await expect(page.locator('.flow')).not.toHaveClass(/\brtl\b/);
		await page.locator('.page').evaluate((n) => (n.scrollTop = 0));
		await page.touchscreen.tap(8, v.height / 2);
		await page.waitForTimeout(300);
		expect(await page.locator('.page').evaluate((n) => n.scrollTop)).toBe(0);
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	} finally {
		// Put the series back: NULL, the default.
		await page.evaluate(async (entry) => {
			const body = new FormData();
			body.set('direction', 'ltr');
			await fetch(`/read/${entry}?/textDirection`, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
		}, entry);
	}
	await page.reload();
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
	await expect(page.locator('.flow')).not.toHaveClass(/\brtl\b/);
});

test('a Japanese book is set vertically, with furigana and upright numbers', async ({ page }) => {
	const ja = sampleEpub({
		title: TITLE,
		hue: 0,
		language: 'ja',
		chapters: Array.from({ length: 33 }, (_, i) => `第${i + 1}話`)
	});
	await serveBook(page, ja);
	await openBook(page);
	await expect(page.locator('.flow')).toHaveCSS('writing-mode', 'vertical-rl');
	await expect(page.locator('.blocks rt').first()).toHaveText('ぼうし');
	await expect(page.locator('.blocks .tcy', { hasText: /^12$/ }).first()).toBeAttached();
	// The kana and kanji are drawn in Plex Sans JP itself, from the woff2-only
	// faces of fonts-plex.css (c537), not a system font the stack fell to.
	await expect(page.locator('.blocks p').first()).toHaveCSS('font-family', /IBM Plex Sans JP/);
	await expect
		.poll(async () =>
			(await drawnFonts(page, '.blocks p'))
				.filter((f) => f.isCustomFont && f.glyphCount > 0)
				.map((f) => f.familyName)
		)
		.toContain('IBM Plex Sans JP');
	// Right to left: the left strip turns forward, onto the chapter's first page of text.
	const shift = () =>
		page
			.locator('.flow')
			.evaluate((el: HTMLElement) => /translate([XY])\((-?[\d.]+)px\)/.exec(el.style.transform));
	await page.mouse.click(8, page.viewportSize()!.height / 2);
	await expect(page.locator('.bottom')).toHaveCount(0);
	// It slid on the vertical text's own axis: the page went up (c441).
	await expect.poll(async () => (await shift())?.[1]).toBe('Y');
	await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
	const turned = Number((await shift())![2]);
	expect(turned).toBeLessThan(0);
	// A drag to the right pulls the next page in, so the page follows it up,
	// and lifted short of the swipe it comes back down.
	const v = page.viewportSize()!;
	await page.mouse.move(v.width / 2, v.height / 2);
	await page.mouse.down();
	await page.mouse.move(v.width / 2 + 24, v.height / 2, { steps: 4 });
	expect(Number((await shift())![2])).toBeLessThan(turned);
	await page.mouse.up();
	await expect.poll(async () => Number((await shift())![2])).toBe(turned);
	await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
	await middle(page);
	await expect(page.locator('.bottom .left')).toHaveText(/^P\. 2 OF /);
	await expect(page.getByRole('button', { name: /^VERTICAL · SANS JP/ })).toBeVisible();
	// DIRECTION is a horizontal book's (c440): vertical text reads R→L, and the row says so.
	await page.getByRole('button', { name: /^VERTICAL · SANS JP/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet.getByRole('radio', { name: 'R→L' })).toHaveAttribute('aria-checked', 'true');
	await expect(sheet.getByRole('radio', { name: 'R→L' })).toBeDisabled();
	await expect(sheet.getByRole('radio', { name: 'L→R' })).toBeDisabled();
	await expect(sheet.getByText('VERTICAL TEXT READS R→L')).toBeVisible();
	await expect(page.locator('.flow')).not.toHaveClass(/\brtl\b/);
});

test('a file that is not an EPUB says so, and offers the way back', async ({ page }) => {
	await page.route('**/api/series/*/epub/files?*', (r) =>
		r.fulfill({ status: 422, json: { message: 'NOT A ZIP' } })
	);
	await page.goto('/');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page
		.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ })
		.first()
		.click();
	await expect(page.getByText('DID NOT OPEN')).toBeVisible({ timeout: 15000 });
	await expect(page.getByText(/^BROKEN EPUB · /)).toBeVisible();
	await expect(page.getByRole('link', { name: '← SERIES' })).toBeVisible();
});

test('in SCROLL, a face arriving mid-scroll leaves the reader where they scrolled to', async ({
	page
}) => {
	await openBook(page);
	await middle(page);
	await page.getByRole('button', { name: /^PAGED · / }).click();
	await page.getByRole('radio', { name: 'SCROLL' }).click();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	const top = () => page.locator('.page').evaluate((n) => n.scrollTop);
	// The reader's place is read 250 ms after a scroll stops; a relayout before
	// then (here `loadingdone`, which a late face fires, c441) once took the
	// reader back to the place they had scrolled away from (work-end-frame's
	// SCROLL end page never opened). Halfway down: far from where it opened.
	const at = await page.locator('.page').evaluate((n) => {
		n.scrollTop = Math.round((n.scrollHeight - n.clientHeight) / 2);
		n.dispatchEvent(new Event('scroll'));
		document.fonts.dispatchEvent(new Event('loadingdone'));
		return n.scrollTop;
	});
	expect(at).toBeGreaterThan(0);
	await page.waitForTimeout(400);
	expect(Math.abs((await top()) - at)).toBeLessThanOrEqual(1);
});

test('in SCROLL, a relayout after the reader settles leaves the line where it stood (c516)', async ({
	page
}) => {
	await openBook(page);
	await middle(page);
	await page.getByRole('button', { name: /^PAGED · / }).click();
	await page.getByRole('radio', { name: 'SCROLL' }).click();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	const top = () => page.locator('.page').evaluate((n) => n.scrollTop);
	// Somewhere a line is cut by the top margin, as a hand leaves it: not on a
	// line's edge, which a relayout to the margin would have kept by luck.
	for (const at of [0.4, 0.6]) {
		await page.locator('.page').evaluate((n, at) => {
			const lh = parseFloat(getComputedStyle(n.querySelector('.flow p')!).lineHeight) || 32;
			n.scrollTop = Math.round((n.scrollHeight - n.clientHeight) * at) + Math.round(lh / 2);
			n.dispatchEvent(new Event('scroll'));
		}, at);
		// The place is read 250 ms after the scroll stops; the URL follows.
		await page.waitForTimeout(600);
		const settled = await top();
		await page.evaluate(() => window.dispatchEvent(new Event('load')));
		await page.waitForTimeout(400);
		// Until c516 the line was put on the top margin: up to a line back.
		expect(Math.abs((await top()) - settled)).toBeLessThanOrEqual(1);
		// The saved place (in the URL 800 ms after it is read) is a character on
		// the screen, not the start of its paragraph a screen higher.
		const shown = () =>
			page.evaluate(() => {
				const at = new URL(location.href).searchParams.get('at');
				if (!at) return false;
				const [b, o] = at.split('.').map(Number);
				const block = document.querySelector<HTMLElement>(`.blocks [data-b="${b}"]`);
				if (!block) return false;
				const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
				let left = o;
				for (let t = walk.nextNode(); t; t = walk.nextNode()) {
					const len = t.textContent?.length ?? 0;
					if (left < len) {
						const r = document.createRange();
						r.setStart(t, left);
						r.setEnd(t, left + 1);
						const box = document.querySelector('.page')!.getBoundingClientRect();
						const c = r.getBoundingClientRect();
						return c.top >= box.top - 1 && c.bottom <= box.bottom + 1;
					}
					left -= len;
				}
				return false;
			});
		await expect.poll(shown).toBe(true);
	}
});

// ---- SCROLL across a volume's end (c347) ------------------------------------------------
//
// A novel grouped from two books is one download per volume (doc/TEXT-READER.md,
// "Opening"). The shared seed has none, and grouping writes, so this block seeds a
// database of its own, groups two of its novels through GROUP as volumes-flow does,
// and serves the build on a port the OS gives. Nothing it writes reaches another spec.

test.describe('a novel of two volumes, read in SCROLL (c347)', () => {
	// Made in beforeAll, not at load: `playwright test --list` loads this file too.
	let work = '';
	let preview: ChildProcess | null = null;
	let base = '';

	function freePort(): Promise<number> {
		return new Promise((ok) => {
			const s = createServer();
			s.listen(0, '127.0.0.1', () => {
				const port = (s.address() as AddressInfo).port;
				s.close(() => ok(port));
			});
		});
	}

	test.beforeAll(async () => {
		work = mkdtempSync(
			join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-text-volumes-')
		);
		const dbPath = join(work, 'text-volumes.sqlite');
		const library = join(work, 'library');
		execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
			env: { ...process.env, DATABASE_PATH: dbPath, LIBRARY_ROOT: library, NODE_NO_WARNINGS: '1' },
			stdio: 'pipe'
		});
		const port = await freePort();
		base = `http://localhost:${port}`;
		preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				LIBRARY_ROOT: library,
				TSUNDOKU_HOME: join(work, 'home'),
				BACKUP_DIR: join(work, 'backups'),
				TSUNDOKU_ANILIST: 'off'
			},
			stdio: 'ignore'
		});
		for (let i = 0; i < 120; i++) {
			try {
				if ((await fetch(`${base}/`, { redirect: 'manual' })).status) return;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		throw new Error('the two-volume preview never answered');
	});

	test.afterAll(() => {
		preview?.kill();
		if (work) rmSync(work, { recursive: true, force: true });
	});

	test('scrolling past the band opens the next volume, as a turn does in PAGED', async ({
		page
	}) => {
		test.setTimeout(120_000);
		// Two Isekai: Tensei Shitara Ken Deshita's 15 volumes, then Villainess Level 99's.
		await page.goto(`${base}/?shelf=k:novel&sort=title`);
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		for (const t of ['Tensei Shitara Ken Deshita', 'Villainess Level 99'])
			await page.locator('.grid .tile', { hasText: t }).click();
		await page.getByRole('button', { name: /GROUP/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Group into a series' });
		await sheet.getByRole('textbox', { name: 'Series name' }).fill('Two Isekai');
		await sheet.getByRole('button', { name: 'BY TITLE' }).click();
		await sheet.getByRole('button', { name: /CREATE SERIES · 2 VOLUMES/ }).click();
		await expect(page).toHaveURL(/\/series\/\d+\?created=2/);

		// The first volume's last chapter, read in SCROLL (session state: nothing stored).
		const list = page.getByRole('region', { name: 'Contents' });
		await list.getByText('Vol. 15', { exact: true }).first().click();
		await page.waitForURL(/\/read\//);
		const heading = page.locator('.blocks:not(.next) h1').first();
		await expect(heading).toHaveText('Vol. 15', { timeout: 15_000 });
		await middle(page);
		await page.getByRole('button', { name: /^PAGED · / }).click();
		await page.getByRole('radio', { name: 'SCROLL' }).click();
		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		// The band promises the next chapter, the other book's first.
		const band = page.locator('.sband');
		await expect(band.getByText('↓ KEEP SCROLLING')).toBeVisible();
		await expect(band.locator('.nx .t')).toHaveText('Vol. 1');

		// Scroll on, as a reader does, until the heading moves or 80 notches pass.
		const files: string[] = [];
		page.on('request', (r) => {
			if (/\/epub\/files\?v=.*&f=/.test(r.url())) files.push(r.url());
		});
		const v = page.viewportSize()!;
		await page.mouse.move(v.width / 2, v.height / 2);
		for (let i = 0; i < 80 && (await heading.textContent()) === 'Vol. 15'; i++) {
			await page.mouse.wheel(0, 400);
			await page.waitForTimeout(60);
		}
		// Villainess' own Vol. 1, opened from its own file at its top.
		await expect(heading).toHaveText('Vol. 1', { timeout: 15_000 });
		expect(files.length).toBeGreaterThan(0);
		await expect(heading).toBeInViewport();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	});

	// In this block because a reload opens the series' own LAYOUT, so SCROLL
	// must be REMEMBERed, a write the shared seed cannot take back (REMEMBER
	// stores a layout; nothing stores the default, NULL, again).
	test('in SCROLL, a reload keeps the line where it stood, at any WIDTH, and an older ?at= opens on the margin (c554)', async ({
		page
	}) => {
		test.setTimeout(120_000);
		await page.goto(`${base}/?sort=title`);
		await page.locator('.grid .tile', { hasText: TITLE }).click();
		await page.waitForURL(/\/series\//);
		await page
			.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ })
			.first()
			.click();
		await page.waitForURL(/\/read\//);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await middle(page);
		await page.getByRole('button', { name: /^PAGED · / }).click();
		await sheet.getByRole('radio', { name: 'SCROLL' }).click();
		const saved = page.waitForResponse(
			(r) => r.url().includes('?/direction') && r.request().method() === 'POST'
		);
		await sheet.getByRole('button', { name: 'REMEMBER SCROLL' }).click();
		expect((await saved).status()).toBe(200);
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);

		const top = () => page.locator('.page').evaluate((n) => n.scrollTop);
		const at = () => new URL(page.url()).searchParams.get('at') ?? '';
		/** After a reload: the book open, its faces drawn, scrollTop held still. */
		const reloaded = async () => {
			await page.reload();
			await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
			await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
			await page.evaluate(() => document.fonts.ready);
		};
		// The URL settled on where SCROLL opened (800 ms after the place), so the
		// change awaited below is the scroll's, not the layout switch's.
		let opened = '';
		await expect
			.poll(
				() => {
					const now = at();
					const same = now !== '' && now === opened;
					opened = now;
					return same;
				},
				{ intervals: [1000] }
			)
			.toBe(true);
		// A line cut by the top margin, as a hand leaves it (on a line's edge the
		// margin would have been right by luck): the second line of a paragraph
		// mid-chapter with text above it, not an illustration. With the plate
		// between the margin and the first line, a WIDTH change in the session
		// itself kept the line 194 px off 1 run in 3 (reader notes, wave 25).
		await page.locator('.page').evaluate((n) => {
			// The first such paragraph of three lines or more: one further down can
			// bring the next chapter's start past the middle, which opens it at its top.
			const lh = parseFloat(getComputedStyle(n.querySelector('.flow p')!).lineHeight) || 32;
			const p = [...n.querySelectorAll<HTMLElement>('.blocks:not(.next) > p')].find(
				(p) => p.previousElementSibling?.tagName === 'P' && p.offsetHeight >= lh * 3 - 1
			)!;
			const margin = parseFloat(getComputedStyle(n.querySelector('.flow')!).paddingTop);
			n.scrollTop += Math.round(
				p.getBoundingClientRect().top - n.getBoundingClientRect().top - margin + lh * 1.5
			);
			n.dispatchEvent(new Event('scroll'));
		});
		// The place is read 250 ms after the scroll stops, and the URL keeps it
		// 800 ms after that.
		await expect.poll(at).not.toBe(opened);
		const settled = await top();
		// Somewhere mid-chapter, not its top: the case reads a place a reload could miss.
		expect(settled).toBeGreaterThan(0);
		await reloaded();
		await expect.poll(async () => Math.abs((await top()) - settled)).toBeLessThanOrEqual(1);
		// It could because the URL carries the line's height too (`b.o.y`).
		const place = at();
		expect(place).toMatch(/^\d+\.\d+\.-?\d+$/);

		// WIDTH changed, then a reload: the relayout put the line back at its
		// height, and the reload at the new width puts it there again.
		const measure = () =>
			page.locator('.blocks:not(.next)').evaluate((n: HTMLElement) => n.clientWidth);
		const wide = await measure();
		await middle(page);
		await page.getByRole('button', { name: /^SCROLL · / }).click();
		await sheet
			.getByRole('radiogroup', { name: 'Width' })
			.getByRole('radio', { name: '65%', exact: true })
			.click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		// Laid out at 65%, then held still: what the relayout kept.
		await expect.poll(measure).toBeLessThan(wide);
		let still = -1;
		await expect
			.poll(
				async () => {
					const now = await top();
					const same = now === still;
					still = now;
					return same;
				},
				{ intervals: [300] }
			)
			.toBe(true);
		expect(at()).toBe(place);
		await reloaded();
		await expect.poll(async () => Math.abs((await top()) - still)).toBeLessThanOrEqual(1);

		// A link from before c554, `?at=b.o`: its character on the top margin, as it did.
		const [b, o] = place.split('.');
		const url = new URL(page.url());
		url.searchParams.set('at', `${b}.${o}`);
		await page.goto(url.toString());
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		await page.evaluate(() => document.fonts.ready);
		const fromMargin = () =>
			page.evaluate(
				([b, o]) => {
					const pageEl = document.querySelector<HTMLElement>('.page')!;
					const margin = parseFloat(getComputedStyle(pageEl.querySelector('.flow')!).paddingTop);
					const block = document.querySelector(`.blocks [data-b="${b}"]`)!;
					const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
					let left = Number(o);
					for (let t = walk.nextNode(); t; t = walk.nextNode()) {
						const n = t.textContent?.length ?? 0;
						if (left < n) {
							const r = document.createRange();
							r.setStart(t, left);
							r.setEnd(t, left + 1);
							return r.getBoundingClientRect().top - pageEl.getBoundingClientRect().top - margin;
						}
						left -= n;
					}
					return NaN;
				},
				[b, o]
			);
		await expect.poll(async () => Math.abs(await fromMargin())).toBeLessThanOrEqual(1);
	});

	/**
	 * Read on through the chapters (c565, round 2): the text reader moves
	 * between chapters in place and writes `/read/<next id>` with
	 * `replaceState`, which leaves SvelteKit's `page.url` at the entry it was
	 * opened at. A guard that compared the two read every settle after the
	 * first one in the second chapter as leaving, so `?at=` froze there and no
	 * more progress was sent. Each chapter here is checked by its own entry: the
	 * window names it, `?at=` moves, a `page` event carries it, and a reload
	 * opens it, not the first chapter crossed into.
	 */
	type Sent = { entryId: number; kind: string };
	function watchReading(page: Page) {
		const sent: Sent[] = [];
		page.on('request', (r) => {
			if (r.url().endsWith('/api/reading') && r.method() === 'POST') {
				const body = r.postDataJSON() as Sent | null;
				if (body) sent.push(body);
			}
		});
		return sent;
	}
	/** Open Honzuki in this block's own library, by the series screen's own door. */
	async function openOwnBook(page: Page) {
		await page.goto(`${base}/?sort=title`);
		await page.locator('.grid .tile', { hasText: TITLE }).click();
		await page.waitForURL(/\/series\//);
		await page
			.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ })
			.first()
			.click();
		await page.waitForURL(/\/read\//);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
	}
	/**
	 * Move on until `heading` reads `title`, then check the window caught up:
	 * the entry the reader opened for it (its `open` event) is the URL's, with
	 * a place (entry and `?at=`) other than `before`, and a `page` event named it.
	 */
	async function readInto(
		page: Page,
		sent: Sent[],
		heading: ReturnType<Page['locator']>,
		title: string,
		step: () => Promise<void>,
		before: string
	) {
		for (let i = 0; i < 80 && (await heading.textContent()) !== title; i++) await step();
		await expect(heading).toHaveText(title, { timeout: 15_000 });
		await expect.poll(() => sent.filter((b) => b.kind === 'open').length).toBeGreaterThan(0);
		const id = sent.filter((b) => b.kind === 'open').at(-1)!.entryId;
		await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${id}`);
		await expect.poll(() => placeOf(page)).not.toBe(before);
		await expect.poll(() => sent.some((b) => b.kind === 'page' && b.entryId === id)).toBe(true);
		return id;
	}
	/** The window's place: the entry and its `?at=` (two chapters' tops are both `0.0`). */
	const placeOf = (page: Page) => {
		const u = new URL(page.url());
		return `${u.pathname}?at=${u.searchParams.get('at') ?? ''}`;
	};
	/** `?at=` alone, which the reader keeps 800 ms after it settles on a place. */
	const atOf = (page: Page) => new URL(page.url()).searchParams.get('at') ?? '';
	/** The place the reader has settled on, once its 800 ms write is behind it. */
	async function settledAt(page: Page) {
		let last = '';
		await expect
			.poll(
				() => {
					const now = atOf(page);
					const same = now !== '' && now === last;
					last = now;
					return same;
				},
				{ intervals: [1000], timeout: 15_000 }
			)
			.toBe(true);
		return atOf(page);
	}
	const continueLink = (page: Page) =>
		page.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ }).first();

	// After c554's case, which REMEMBERed SCROLL for this book: PAGED is set for
	// the session, and the reload opens in SCROLL, which reads the same entry.
	test('in PAGED, read on into a third chapter: the URL and progress follow every chapter, and a reload opens the last (c565, round 2)', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const sent = watchReading(page);
		await openOwnBook(page);
		await middle(page);
		await page.getByRole('button', { name: /^SCROLL · / }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'PAGED' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).not.toHaveClass(/scroll/);
		const heading = page.locator('.blocks h1');
		const n = Number(((await heading.textContent()) ?? '').replace(/\D/g, ''));
		const step = () => forward(page);
		const first = await readInto(page, sent, heading, `Vol. ${n + 1}`, step, placeOf(page));
		const second = await readInto(page, sent, heading, `Vol. ${n + 2}`, step, placeOf(page));
		expect(second).not.toBe(first);
		// A page further on: its settle is written too, wherever it landed.
		const before = placeOf(page);
		const count = sent.length;
		await forward(page);
		await expect.poll(() => placeOf(page)).not.toBe(before);
		await expect
			.poll(() => sent.slice(count).some((b) => b.kind === 'page' && b.entryId !== first))
			.toBe(true);
		const last = sent.filter((b) => b.kind === 'open').at(-1)!.entryId;
		await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${last}`);
		await page.reload();
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		expect(new URL(page.url()).pathname).toBe(`/read/${last}`);
		const opened = page.locator('.blocks:not(.next) h1').first();
		if (last === second) await expect(opened).toHaveText(`Vol. ${n + 2}`);
		else await expect(opened).not.toHaveText(`Vol. ${n + 1}`);
	});

	// An invalidation gives `page.url` a new object for the entry the reader was
	// opened at, which isn't a navigation: the place must go on following the
	// chapters (wave 25's r2). The app does it for real, here by a newer theme.
	test('an invalidation partway through leaves the URL and progress following the chapters', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const sent = watchReading(page);
		await openOwnBook(page);
		await middle(page);
		await page.getByRole('button', { name: /^SCROLL · / }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'PAGED' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).not.toHaveClass(/scroll/);
		const heading = page.locator('.blocks h1');
		const n = Number(((await heading.textContent()) ?? '').replace(/\D/g, ''));
		const step = () => forward(page);
		await readInto(page, sent, heading, `Vol. ${n + 1}`, step, placeOf(page));

		await page.route('**/api/devices/sync', (r) =>
			r.fulfill({ json: { newer: { 'tsundoku.theme': { v: 'light', at: Date.now() } } } })
		);
		const reloaded = page.waitForResponse((r) => r.url().includes('__data.json'));
		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		await reloaded;
		await page.unroute('**/api/devices/sync');

		const second = await readInto(page, sent, heading, `Vol. ${n + 2}`, step, placeOf(page));
		await page.reload();
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		expect(new URL(page.url()).pathname).toBe(`/read/${second}`);
	});

	// After c554's case, which REMEMBERed SCROLL for this book, so a reload opens in SCROLL.
	test('in SCROLL, read on into a third chapter: the URL and progress follow every chapter, and a reload opens the last (c565, round 2)', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const sent = watchReading(page);
		await openOwnBook(page);
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		const heading = page.locator('.blocks:not(.next) h1').first();
		const start = (await heading.textContent()) ?? '';
		const n = Number(start.replace(/\D/g, ''));
		const v = page.viewportSize()!;
		await page.mouse.move(v.width / 2, v.height / 2);
		const step = async () => {
			await page.mouse.wheel(0, 400);
			await page.waitForTimeout(60);
		};
		const first = await readInto(page, sent, heading, `Vol. ${n + 1}`, step, placeOf(page));
		const second = await readInto(page, sent, heading, `Vol. ${n + 2}`, step, placeOf(page));
		expect(second).not.toBe(first);
		await page.reload();
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		expect(new URL(page.url()).pathname).toBe(`/read/${second}`);
		await expect(heading).toHaveText(`Vol. ${n + 2}`);
	});

	// c623: a chapter moving in place is written with `replaceState`, whose
	// history entry keeps the URL of the last real navigation: a popstate into
	// it (BACK from the series, then forward) loaded the chapter the reader was
	// opened at, not the one it read on to.
	test('history into the reader entry after an in-place chapter move opens the chapter read on to, at its place (c623)', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const sent = watchReading(page);
		await openOwnBook(page);
		await middle(page);
		await page.getByRole('button', { name: /^(PAGED|SCROLL) · / }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'PAGED' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).not.toHaveClass(/scroll/);
		const heading = page.locator('.blocks:not(.next) h1').first();
		const n = Number(((await heading.textContent()) ?? '').replace(/\D/g, ''));
		const step = () => forward(page);
		await readInto(page, sent, heading, `Vol. ${n + 1}`, step, placeOf(page));
		await readInto(page, sent, heading, `Vol. ${n + 2}`, step, placeOf(page));
		// A place further into the third chapter, so the entry's URL is not its
		// top either. Larger type and half the page, as in c622: one paged turn
		// in a seed chapter's single page would reach its end and mark it read.
		await middle(page);
		await page.getByRole('button', { name: /^(PAGED|SCROLL) · / }).click();
		const reading = page.getByRole('dialog', { name: 'Reading settings' });
		await reading.getByRole('radio', { name: 'PAGED' }).click();
		for (let i = 0; i < 14; i++) {
			const larger = reading.getByRole('button', { name: 'Larger' });
			if (await larger.isDisabled()) break;
			await larger.click();
		}
		await reading
			.getByRole('radiogroup', { name: 'Width' })
			.getByRole('radio', { name: '50%', exact: true })
			.click();
		await reading.getByRole('button', { name: 'Close', exact: true }).click();
		expect(await pagesNow(page)).toBeGreaterThan(2);
		const before = await settledAt(page);
		await forward(page);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).not.toBe(before);
		const place = atOf(page);
		expect(place).not.toBe('0.0');
		const third = Number(new URL(page.url()).pathname.split('/').pop());

		// To the series by the reader's own link (which goes back in history),
		// and back into the reader entry by history's forward.
		await middle(page);
		await page.getByRole('link', { name: 'Back to the series' }).click();
		await expect(continueLink(page)).toBeVisible();
		await page.goForward();
		await page.waitForURL(/\/read\//);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		// The screen, not the address bar: a popstate that loads another chapter
		// leaves `location` naming the entry's own URL while the data loaded is
		// the stored one, so on the old code the window said the third chapter
		// and the page drew the first.
		await expect(page.locator('.blocks:not(.next) h1').first()).toHaveText(`Vol. ${n + 2}`);
		await expect
			.poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
			.toBe(`/read/${third}`);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).toBe(place);
	});
});
