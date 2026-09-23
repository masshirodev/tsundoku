import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { imageSize } from '$lib/server/pages/image-size';
import { samplePage, sampleSize } from '$lib/server/pages/sample';
import { spelledOut } from '$lib/reader/reader';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { manifest, readPage } = await import('$lib/server/pages');
const { writeHentoidFolder } = await import('./helpers/hentoid-fixture');
const { writeMihonFolder } = await import('./helpers/mihon-fixture');

describe('image sizes from their first bytes', () => {
	it('reads PNG, GIF, WebP and JPEG headers', () => {
		expect(imageSize(samplePage(120, 0))).toEqual(sampleSize(0));
		const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0xc8, 0x00]);
		expect(imageSize(gif)).toEqual({ w: 300, h: 200 });
		const webp = new Uint8Array(30);
		webp.set([0x52, 0x49, 0x46, 0x46], 0);
		webp.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
		webp.set([0x1f, 0x03, 0x00, 0xc7, 0x04, 0x00], 24); // 800 x 1224
		expect(imageSize(webp)).toEqual({ w: 800, h: 1224 });
		// SOI, an APP0 segment, then SOF0 with height 1136 and width 800.
		const jpeg = Uint8Array.from([
			0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x70,
			0x03, 0x20, 0x03
		]);
		expect(imageSize(jpeg)).toEqual({ w: 800, h: 1136 });
		expect(imageSize(Uint8Array.from([1, 2, 3]))).toBeNull();
	});

	it('draws sample pages, every seventh one a spread', () => {
		expect(sampleSize(0)).toEqual({ w: 800, h: 1136 });
		expect(sampleSize(6)).toEqual({ w: 1600, h: 1136 });
	});

	it('spells chapters out for the boundary pages', () => {
		expect(spelledOut('Ch. 42')).toBe('Chapter 42');
		expect(spelledOut('Vol. 3')).toBe('Volume 3');
	});
});

describe('where pages come from', () => {
	let library: string;
	const entryOf = (seriesTitle: string, label?: string) =>
		(
			getDb()
				.prepare(
					`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id WHERE s.title = ? ${label ? 'AND e.label = ?' : ''} LIMIT 1`
				)
				.get(...(label ? [seriesTitle, label] : [seriesTitle])) as { id: number }
		).id;

	beforeAll(async () => {
		library = dirname(writeMihonFolder(mkdtempSync(join(tmpdir(), 'tsundoku-pages-'))));
		writeHentoidFolder(library);
		await runImport(library);
	});

	it('lists a CBZ’s pages in Mihon’s order, and serves one', async () => {
		const id = entryOf('Drawing: Saikyou Mangaka', 'Ch. 2');
		const m = await manifest(id, false);
		expect(m?.pages).toHaveLength(12);
		const page = await readPage(id, 0, false);
		expect(page?.type).toBe('image/png');
		expect(await readPage(id, 99, false)).toBeNull();
	});

	it('serves a folder’s pages in the stored order, and hides a hidden root', async () => {
		const id = entryOf('Summer Days');
		expect(await manifest(id, false)).toBeNull();
		const m = await manifest(id, true);
		expect(m?.pages).toHaveLength(4);
		expect((await readPage(id, 3, true))?.type).toBe('image/jpeg');
	});

	it('has nothing for a chapter that isn’t downloaded', async () => {
		const id = entryOf('Drawing: Saikyou Mangaka', 'Ch. 1');
		expect(await manifest(id, false)).toBeNull();
	});
});
