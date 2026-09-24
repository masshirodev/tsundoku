import type { ReadStream } from 'node:fs';
import { getDb } from '../db.ts';
import { manifest, readPage } from './index.ts';
import { insetOf, NO_INSET, type Inset } from '../../reader/crop.ts';

/**
 * Each page's plain border (doc/READER.md, "Crop borders"), found on the
 * workstation the first time a chapter is asked for, and kept in
 * `page_crops`: the tablet never decodes a page to measure it.
 *
 * A page is measured on a small copy (300px wide), trimming the colour of its
 * corner -- white paper or a black frame -- with some tolerance for scans.
 */

const SAMPLE_WIDTH = 300;
const THRESHOLD = 24;
const AT_ONCE = 4;

async function bytesOf(body: Buffer | ReadStream): Promise<Buffer> {
	if (Buffer.isBuffer(body)) return body;
	const chunks: Buffer[] = [];
	for await (const c of body) chunks.push(c as Buffer);
	return Buffer.concat(chunks);
}

async function measure(image: Buffer): Promise<Inset> {
	process.env.VIPS_WARNING ??= '0';
	const sharp = (await import('sharp')).default;
	const small = await sharp(image, { failOn: 'none', animated: false })
		.rotate()
		.resize({ width: SAMPLE_WIDTH, withoutEnlargement: true })
		.png()
		.toBuffer({ resolveWithObject: true });
	const { width, height } = small.info;
	try {
		const t = await sharp(small.data)
			.trim({ threshold: THRESHOLD })
			.toBuffer({ resolveWithObject: true });
		return insetOf({
			width,
			height,
			x: -(t.info.trimOffsetLeft ?? 0),
			y: -(t.info.trimOffsetTop ?? 0),
			w: t.info.width,
			h: t.info.height
		});
	} catch {
		// One colour all over: nothing to crop.
		return NO_INSET;
	}
}

/** Every page's inset, measuring those not measured yet. Null: no such (visible) chapter. */
export async function cropsFor(entryId: number, reveal: boolean): Promise<Inset[] | null> {
	const m = await manifest(entryId, reveal);
	if (!m) return null;
	const db = getDb();
	const known = new Map(
		(
			db
				.prepare(`SELECT page, top, right, bottom, left FROM page_crops WHERE entry_id = ?`)
				.all(entryId) as {
				page: number;
				top: number;
				right: number;
				bottom: number;
				left: number;
			}[]
		).map((r) => [r.page, [r.top, r.right, r.bottom, r.left] as Inset])
	);
	const missing = m.pages.map((_, i) => i).filter((i) => !known.has(i));
	const save = db.prepare(
		`INSERT OR REPLACE INTO page_crops (entry_id, page, top, right, bottom, left) VALUES (?, ?, ?, ?, ?, ?)`
	);
	let next = 0;
	const worker = async () => {
		while (next < missing.length) {
			const i = missing[next++];
			const page = await readPage(entryId, i, reveal).catch(() => null);
			const inset = page ? await measure(await bytesOf(page.body)).catch(() => NO_INSET) : NO_INSET;
			save.run(entryId, i, ...inset);
			known.set(i, inset);
		}
	};
	await Promise.all(Array.from({ length: AT_ONCE }, worker));
	return m.pages.map((_, i) => known.get(i) ?? NO_INSET);
}
