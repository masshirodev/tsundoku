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

function bookRow(seriesId: number, reveal: boolean): Row | null {
	return (
		(getDb()
			.prepare(
				`SELECT s.path, s.hue, s.title, e.file FROM series s
				JOIN roots r ON r.id = s.root_id
				JOIN entries e ON e.series_id = s.id AND e.file != ''
				WHERE s.id = ? AND s.kind = 'novel' AND (? OR ${VISIBLE_SQL})
				LIMIT 1`
			)
			.get(seriesId, reveal ? 1 : 0) as Row | undefined) ?? null
	);
}

/** Where the book is and what version it's at, without reading it. */
export async function epubVersion(seriesId: number, reveal: boolean): Promise<string | null> {
	const row = bookRow(seriesId, reveal);
	if (!row) return null;
	if (row.path.startsWith(SAMPLE_PREFIX)) return 'sample-1';
	try {
		const st = await stat(join(row.path, row.file));
		return `${st.size}-${Math.round(st.mtimeMs)}`;
	} catch {
		return null;
	}
}

export async function readEpubFile(seriesId: number, reveal: boolean): Promise<EpubBody | null> {
	const row = bookRow(seriesId, reveal);
	if (!row) return null;
	if (row.path.startsWith(SAMPLE_PREFIX)) {
		const labels = (
			getDb()
				.prepare(`SELECT label FROM entries WHERE series_id = ? ORDER BY position, id`)
				.all(seriesId) as { label: string }[]
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
