import { createReadStream, type ReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from './fspath.ts';
import { getDb } from './db.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { SAMPLE_PREFIX } from './pages/sample.ts';
import { sampleEpub } from './pages/sample-epub.ts';
import { readMember, withZip } from './zip.ts';
import { Zip } from '../epub/unzip.ts';

/**
 * A novel's EPUB, whole (doc/TEXT-READER.md). The reader downloads it once
 * and reads it on the tablet: the book is the unit that's cached, so a
 * chapter never waits on the network after the first open.
 *
 * Hidden means hidden: a hidden series' book is a 404 while reveal is off.
 */

export type EpubBody = {
	body: Buffer | ReadStream;
	size: number;
	/** Changes when the file does, so a versioned URL can be cached as immutable. */
	version: string;
};

import { ONLINE_FILE, ONLINE_VERSION, onlineNovelBook } from './novels/online.ts';

type Row = { path: string; hue: number; title: string; file: string };

/**
 * The series' book, or with `file` one of its volumes (doc/BOOKS.md): a
 * novel grouped from several EPUBs is one download per volume.
 */
function bookRow(seriesId: number, reveal: boolean, file?: string): Row | null {
	return (
		(getDb()
			.prepare(
				`SELECT s.path, s.hue, s.title, e.file FROM series s
				JOIN roots r ON r.id = s.root_id
				JOIN entries e ON e.series_id = s.id AND e.file != ''
				WHERE s.id = ? AND s.kind = 'novel' AND (? OR ${VISIBLE_SQL})
					AND (? IS NULL OR e.file = ?)
				ORDER BY e.position, e.id
				LIMIT 1`
			)
			.get(seriesId, reveal ? 1 : 0, file ?? null, file ?? null) as Row | undefined) ?? null
	);
}

async function versionOf(row: Row): Promise<string | null> {
	if (row.path.startsWith(SAMPLE_PREFIX)) return 'sample-1';
	try {
		const st = await stat(join(row.path, row.file));
		return `${st.size}-${Math.round(st.mtimeMs)}`;
	} catch {
		return null;
	}
}

/** Where the book is and what version it's at, without reading it. */
export async function epubVersion(
	seriesId: number,
	reveal: boolean,
	file?: string
): Promise<string | null> {
	if (file && ONLINE_FILE.test(file)) return ONLINE_VERSION;
	const row = bookRow(seriesId, reveal, file);
	return row ? versionOf(row) : null;
}

/** Every volume's version, by file: one entry for a series of one book. */
export async function epubVersions(
	seriesId: number,
	reveal: boolean
): Promise<Record<string, string | null>> {
	const first = bookRow(seriesId, reveal);
	if (!first) return {};
	const files = (
		getDb()
			.prepare(
				`SELECT file FROM entries WHERE series_id = ? AND file != '' GROUP BY file ORDER BY MIN(position)`
			)
			.all(seriesId) as { file: string }[]
	).map((r) => r.file);
	const out: Record<string, string | null> = {};
	for (const file of files) out[file] = await versionOf({ ...first, file });
	return out;
}

export async function readEpubFile(
	seriesId: number,
	reveal: boolean,
	file?: string
): Promise<EpubBody | null> {
	// A chapter read online (doc/BROWSING.md, "Novels online"): a book of one
	// chapter, made in memory from its plugin.
	const online = file ? ONLINE_FILE.exec(file) : null;
	if (online) {
		const body = await onlineNovelBook(seriesId, Number(online[1]), reveal);
		return body ? { body, size: body.length, version: ONLINE_VERSION } : null;
	}
	const row = bookRow(seriesId, reveal, file);
	if (!row) return null;
	if (row.path.startsWith(SAMPLE_PREFIX)) {
		const labels = (
			getDb()
				.prepare(`SELECT label FROM entries WHERE series_id = ? AND file = ? ORDER BY position, id`)
				.all(seriesId, row.file) as { label: string }[]
		).map((r) => r.label);
		const body = sampleEpub({ title: row.title, hue: row.hue, chapters: labels });
		return { body, size: body.length, version: 'sample-1' };
	}
	const path = join(row.path, row.file);
	try {
		const st = await stat(path);
		return {
			body: createReadStream(path),
			size: st.size,
			version: `${st.size}-${Math.round(st.mtimeMs)}`
		};
	} catch {
		return null;
	}
}

// ---- file by file (doc/TEXT-READER.md, "A chapter at a time") ------------------------------

export type BookFileInfo = { name: string; size: number };

/** The file is there, but isn't a zip an EPUB can be read from. */
export class BrokenBook extends Error {}

/** An opened book's listing, kept for a few books: a chapter asks for several files. */
type Listing = {
	version: string;
	files: BookFileInfo[];
	read: (name: string) => Promise<Buffer | null>;
};
const listings = new Map<string, Listing>();

async function listingOf(
	seriesId: number,
	reveal: boolean,
	file?: string
): Promise<Listing | null> {
	const online = file ? ONLINE_FILE.exec(file) : null;
	if (online) {
		// Never kept with the others: the book is the plugin's, a few minutes at a time.
		const book = await onlineNovelBook(seriesId, Number(online[1]), reveal);
		if (!book) return null;
		const z = new Zip(new Uint8Array(book));
		const files: BookFileInfo[] = [];
		for (const name of z.names) files.push({ name, size: (await z.bytesOf(name)).length });
		return {
			version: ONLINE_VERSION,
			files,
			read: async (name) => (z.has(name) ? Buffer.from(await z.bytesOf(name)) : null)
		};
	}
	const row = bookRow(seriesId, reveal, file);
	if (!row) return null;
	const version = await versionOf(row);
	if (!version) return null;
	const key = `${row.path}/${row.file}@${version}`;
	const had = listings.get(key);
	if (had) return had;
	let listing: Listing;
	if (row.path.startsWith(SAMPLE_PREFIX)) {
		// The sample books are made in memory; the browser's reader reads them here too.
		const book = (await readEpubFile(seriesId, reveal, file))!.body as Buffer;
		const zip = new Zip(new Uint8Array(book));
		const files: BookFileInfo[] = [];
		for (const name of zip.names) files.push({ name, size: (await zip.bytesOf(name)).length });
		listing = {
			version,
			files,
			read: async (name) => (zip.has(name) ? Buffer.from(await zip.bytesOf(name)) : null)
		};
	} else {
		const path = join(row.path, row.file);
		let members: Awaited<ReturnType<typeof listZipOf>>;
		try {
			members = await listZipOf(path);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw new BrokenBook(e instanceof Error ? e.message.toUpperCase() : 'NOT A ZIP');
		}
		const byName = new Map(members.map((m) => [m.name, m]));
		listing = {
			version,
			files: members
				.filter((m) => !m.name.endsWith('/'))
				.map((m) => ({ name: m.name, size: m.size })),
			read: async (name) => {
				const m = byName.get(name);
				return m ? withZip(path, (fh) => readMember(fh, m)).catch(() => null) : null;
			}
		};
	}
	listings.set(key, listing);
	if (listings.size > 8) listings.delete(listings.keys().next().value!);
	return listing;
}

const listZipOf = (path: string) => withZip(path, async (_, m) => m);

/** The files in a book, with their sizes unpacked. Hidden means hidden: null while reveal is off. */
export async function epubFiles(
	seriesId: number,
	reveal: boolean,
	file?: string
): Promise<{ version: string; files: BookFileInfo[] } | null> {
	const l = await listingOf(seriesId, reveal, file);
	return l ? { version: l.version, files: l.files } : null;
}

/** One file of a book, unpacked; null for a name the book doesn't have. */
export async function epubMember(
	seriesId: number,
	reveal: boolean,
	name: string,
	file?: string
): Promise<{ version: string; body: Buffer } | null> {
	const l = await listingOf(seriesId, reveal, file);
	const body = l ? await l.read(name) : null;
	return l && body ? { version: l.version, body } : null;
}
