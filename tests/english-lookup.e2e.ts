import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { sampleEpub } from '../src/lib/server/pages/sample-epub';
import { Zip } from '../src/lib/epub/unzip';
import { expect, test } from './helpers/hydrated';

/**
 * Reading English (c198, doc/LANGUAGES.md): a long press in a book whose
 * language has a pack opens the same panel Japanese opens, and the entry it
 * draws is the pack's — including the source and licence line CC BY-SA asks
 * for.
 *
 * The book is Honzuki's, served as English so its first paragraph is known
 * (`sampleEpub`'s chapter 1 opens on `"How large?" he asked.`), and the answer
 * comes from the five-word pack `en-pack-setup.ts` writes beside the preview.
 * Japanese's own trip through this panel is `japanese-flow.e2e.ts` (a tap on an
 * OCR block) and `highlights-novel-flow.e2e.ts` (J2, a long press).
 */
test.use({ serviceWorkers: 'block' });

/** The preview's own database: the seeded books, and the entries this needs. */
const db = () => new Database(process.env.PLAYWRIGHT_DATABASE_PATH!, { readonly: true });

function honzukiChapter(): number {
	const d = db();
	try {
		const r = d
			.prepare(
				`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.title = 'Honzuki no Gekokujou' AND e.matter = '' ORDER BY e.position LIMIT 1`
			)
			.get() as { id: number };
		return r.id;
	} finally {
		d.close();
	}
}

/** The whole book, stubbed: the route serves the bytes, the service worker never sees them. */
async function serveBook(page: Page, epub: Buffer) {
	const zip = new Zip(new Uint8Array(epub));
	const files = await Promise.all(
		zip.names.map(async (name) => ({ name, size: (await zip.bytesOf(name)).length }))
	);
	await page.route('**/api/series/*/epub/files?*', (r) => r.fulfill({ json: { files } }));
	await page.route('**/api/series/*/epub?*', (r) =>
		r.fulfill({ body: epub, contentType: 'application/epub+zip' })
	);
	await page.route('**/api/series/*/epub/file?*', async (r) => {
		const name = new URL(r.request().url()).searchParams.get('p') ?? '';
		if (!zip.has(name)) return r.fulfill({ status: 404, body: 'not found' });
		await r.fulfill({ body: Buffer.from(await zip.bytesOf(name)) });
	});
}

async function openEnglish(page: Page) {
	const epub = sampleEpub({
		title: 'Honzuki no Gekokujou',
		hue: 0,
		language: 'en',
		chapters: Array.from({ length: 33 }, (_, i) => `第${i + 1}話`)
	});
	await serveBook(page, epub);
	await page.goto(`/read/${honzukiChapter()}?at=1.0`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
}

/** A place on the first paragraph's text, on this page. */
const textPoint = (page: Page) =>
	page.evaluate(() => {
		const all = [...document.querySelectorAll<HTMLElement>('.blocks p')];
		const b = all.find((e) => {
			const r = e.getBoundingClientRect();
			return r.width > 0 && r.right > 0 && r.left < innerWidth;
		});
		// The chapter's heading sits on a page of its own, so the paragraphs that
		// follow it are laid out past the right edge: open at a block, not at 0.
		if (!b) throw new Error('no paragraph is on this page');
		const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) =>
				n.parentElement?.closest('rt, rp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
		});
		const t = walk.nextNode()!;
		const r = document.createRange();
		r.setStart(t, 2);
		r.setEnd(t, 3);
		const c = r.getClientRects()[0];
		return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
	});

/** A long press selects the word: the bar, with LOOK UP on it, is the app's own menu. */
async function longPress(page: Page, x: number, y: number) {
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.waitForFunction(() => !!document.querySelector('.sel'), null, { timeout: 15_000 });
	await page.mouse.up();
}

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' });

/** Select a word, then open the panel from the bar's LOOK UP. */
async function lookUp(page: Page) {
	const p = await textPoint(page);
	await longPress(page, p.x, p.y);
	await expect(bar(page)).toBeVisible();
	await bar(page).getByRole('button', { name: 'LOOK UP' }).click();
	const panel = page.getByRole('region', { name: 'Lookup' });
	await expect(panel.locator('.words .w.on')).toBeVisible({ timeout: 15_000 });
	return panel;
}

test('an English book opens the panel, and its entry names its dictionary', async ({ page }) => {
	await openEnglish(page);
	const panel = await lookUp(page);
	// The words are the pack's: English text, in English, with no ruby.
	await expect(panel.locator('.words')).toHaveAttribute('lang', 'en');

	await panel.locator('.words').getByRole('button', { name: 'large', exact: true }).click();
	await expect(panel.locator('.lemma')).toHaveText('large');
	await expect(panel.locator('.sense').first()).toContainText('considerable');
	// Every entry ends with its source and licence (the handoff's Main 104).
	await expect(panel.locator('.source')).toContainText('WIKTIONARY · CC BY-SA 4.0');

	// An inflected form answers with its lemma, and the panel says which it met.
	await panel.locator('.words').getByRole('button', { name: 'asked', exact: true }).click();
	await expect(panel.locator('.lemma')).toHaveText('ask');
	await expect(panel.locator('.infl')).toHaveText('asked ← ask');
});

test('a word the pack has not got says so, in words that name no dictionary', async ({ page }) => {
	await openEnglish(page);
	const panel = await lookUp(page);
	// "How" is not in the five-word pack; the handoff's copy (Main 175) is the
	// same sentence for every language, so it names no dictionary of its own.
	await panel.locator('.words').getByRole('button', { name: 'How', exact: true }).click();
	await expect(panel.locator('.ot')).toHaveText('NOT IN THE DICTIONARY');
});
