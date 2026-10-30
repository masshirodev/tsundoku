import { createReadStream, type ReadStream } from 'node:fs';
import { VISIBLE_SQL } from '../visibility.ts';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from '../fspath.ts';
import { getDb } from '../db.ts';
import { listZip, pageMembers, readMember, type ZipMember } from '../zip.ts';
import { imageSize, imageType } from './image-size.ts';
import { SAMPLE_PREFIX, samplePage, sampleSize } from './sample.ts';

/**
 * Where an entry's pages come from, and the pages themselves (doc/READER.md).
 * Four sources, decided per entry:
 *
 * - `entry_pages` rows: a folder of loose images in a stored order (Hentoid,
 *   where one folder can hold several entries);
 * - a `.cbz` / `.zip` file: its images, in Mihon's natural order;
 * - a folder: its images, naturally sorted (Mihon without "save as CBZ");
 * - a `sample:` series: generated pages for the seed library.
 *
 * Hidden means hidden here too: a hidden entry is not found while reveal is
 * off, the same 404 as one that doesn't exist.
 */

import { onlineManifest, readOnlinePage, readsOnline } from './online.ts';

export type Page = { w: number; h: number };

export type Manifest = {
	entryId: number;
	/** Changes when the files do, so a page URL can be cached as immutable. */
	version: string;
	pages: Page[];
	/** Read from its source, not a file (doc/BROWSING.md, "Manga online"): nothing of it is kept. */
	online?: true;
};

type Source =
	| { kind: 'sample'; hue: number; count: number }
	| { kind: 'zip'; path: string }
	| { kind: 'folder'; dir: string; files: string[] };

const IMAGE = /\.(jpe?g|png|webp|gif|avif|jxl)$/i;
const natural = (a: string, b: string) =>
	a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

type EntryRow = {
	id: number;
	file: string;
	page_count: number;
	available: number;
	path: string;
	hue: number;
};

function entryRow(entryId: number, reveal: boolean): EntryRow | null {
	return (
		(getDb()
			.prepare(
				`SELECT e.id, e.file, e.page_count, e.available, s.path, s.hue
				FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
				WHERE e.id = ? AND (? OR ${VISIBLE_SQL})`
			)
			.get(entryId, reveal ? 1 : 0) as EntryRow | undefined) ?? null
	);
}

async function sourceOf(e: EntryRow): Promise<Source | null> {
	if (e.path.startsWith(SAMPLE_PREFIX)) return { kind: 'sample', hue: e.hue, count: e.page_count };
	if (!e.available || e.path === '') return null;
	const base = join(e.path, e.file);
	const stored = getDb()
		.prepare(`SELECT file FROM entry_pages WHERE entry_id = ? ORDER BY position`)
		.all(e.id) as { file: string }[];
	if (stored.length) return { kind: 'folder', dir: base, files: stored.map((p) => p.file) };
	try {
		const info = await stat(base);
		if (info.isFile()) return /\.(cbz|zip)$/i.test(base) ? { kind: 'zip', path: base } : null;
		const files = (await readdir(base)).filter((f) => IMAGE.test(f)).sort(natural);
		return { kind: 'folder', dir: base, files };
	} catch {
		return null;
	}
}

async function headBytes(path: string, length = 65536): Promise<Uint8Array> {
	const fh = await open(path, 'r');
	try {
		const buf = Buffer.alloc(length);
		const { bytesRead } = await fh.read(buf, 0, length, 0);
		return buf.subarray(0, bytesRead);
	} finally {
		await fh.close();
	}
}

// Manifests are cheap to rebuild but not free (a header read per page), and
// a chapter is opened many times while it is read.
const manifests = new Map<string, Manifest>();

async function versionOf(src: Source): Promise<string> {
	if (src.kind === 'sample') return `s${src.count}`;
	const s = await stat(src.kind === 'zip' ? src.path : src.dir);
	return `${Math.round(s.mtimeMs)}-${src.kind === 'zip' ? s.size : src.files.length}`;
}

export async function manifest(entryId: number, reveal: boolean): Promise<Manifest | null> {
	const e = entryRow(entryId, reveal);
	if (!e) return null;
	const src = await sourceOf(e);
	// No file, but a source serves it: read online (throws the engine's error,
	// which the reader turns into its waiting and failure pages).
	if (!src) return readsOnline(entryId) ? onlineManifest(entryId) : null;
	const version = await versionOf(src);
	const key = `${entryId}:${version}`;
	const hit = manifests.get(key);
	if (hit) return hit;

	const unknown: Page = { w: 0, h: 0 };
	let pages: Page[];
	if (src.kind === 'sample') {
		pages = Array.from({ length: src.count }, (_, i) => sampleSize(i));
	} else if (src.kind === 'folder') {
		pages = await Promise.all(
			src.files.map(async (f) => {
				try {
					return imageSize(await headBytes(join(src.dir, f))) ?? unknown;
				} catch {
					return unknown;
				}
			})
		);
	} else {
		const fh = await open(src.path, 'r');
		try {
			const members = pageMembers(await listZip(fh, (await fh.stat()).size));
			pages = [];
			for (const m of members) {
				const head = m.method === 0 ? await readStoredHead(fh, m) : await readMember(fh, m);
				pages.push(imageSize(head) ?? unknown);
			}
		} finally {
			await fh.close();
		}
	}
	const out: Manifest = { entryId, version, pages };
	if (manifests.size > 200) manifests.delete(manifests.keys().next().value!);
	manifests.set(key, out);
	// The count on the row may have been a guess (an import that couldn't
	// open the file); the manifest is the truth, and the lists read the row.
	if (pages.length !== e.page_count)
		getDb().prepare(`UPDATE entries SET page_count = ? WHERE id = ?`).run(pages.length, entryId);
	return out;
}

async function readStoredHead(
	fh: import('node:fs/promises').FileHandle,
	m: ZipMember
): Promise<Uint8Array> {
	const header = Buffer.alloc(30);
	await fh.read(header, 0, 30, m.offset);
	const start = m.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
	const length = Math.min(m.compressedSize, 65536);
	const buf = Buffer.alloc(length);
	const { bytesRead } = await fh.read(buf, 0, length, start);
	return buf.subarray(0, bytesRead);
}

export type PageBody = { body: Buffer | ReadStream; type: string; size: number };

/** Page `index` (0-based) of an entry, or null. */
export async function readPage(
	entryId: number,
	index: number,
	reveal: boolean
): Promise<PageBody | null> {
	const e = entryRow(entryId, reveal);
	if (!e) return null;
	const src = await sourceOf(e);
	if (!Number.isInteger(index) || index < 0) return null;
	if (!src) return readsOnline(entryId) ? readOnlinePage(entryId, index) : null;
	if (src.kind === 'sample') {
		if (index >= src.count) return null;
		const body = samplePage(src.hue, index);
		return { body, type: 'image/png', size: body.length };
	}
	if (src.kind === 'folder') {
		const f = src.files[index];
		if (!f) return null;
		const path = join(src.dir, f);
		try {
			const { size } = await stat(path);
			return { body: createReadStream(path), type: imageType(f), size };
		} catch {
			return null;
		}
	}
	const fh = await open(src.path, 'r');
	try {
		const m = pageMembers(await listZip(fh, (await fh.stat()).size))[index];
		if (!m) return null;
		const body = await readMember(fh, m);
		return { body, type: imageType(m.name), size: body.length };
	} finally {
		await fh.close();
	}
}
