import { createReadStream, type ReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from './db.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { SAMPLE_PREFIX } from './pages/sample.ts';
import { sampleEpub } from './pages/sample-epub.ts';

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
