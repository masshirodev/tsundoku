import { getDb } from '../db.ts';
import { zip } from '../zip-write.ts';
import { VISIBLE_SQL } from '../visibility.ts';
import { parseNovelKey } from '../../library/downloads.ts';
import { novelBookMembers, type NovelManifest } from '../../import/novel-book.ts';
import {
	chapterHref,
	fetchChapter,
	fetchImage,
	pluginOf,
	seriesRow,
	seriesTags
} from './downloader.ts';

/**
 * A novel's chapter read online (doc/READING-ONLINE.md, "Novels online"):
 * a chapter with no file, of a series an installed plugin serves, fetched from
 * the plugin through the downloader's own cleaner and made a book of one
 * chapter in memory, which the text reader opens like any volume (its file is
 * `online:<entry>`). Nothing is written, and nothing kept past a few minutes.
 */

export const ONLINE_FILE = /^online:(\d+)$/;
export const onlineFile = (entryId: number) => `online:${entryId}`;
/** The one version an online book has: never cached as immutable (the routes send no-store). */
export const ONLINE_VERSION = 'online';

const KEEP_MS = 10 * 60 * 1000;
const MAX_KEPT = 20;
const books = new Map<number, { at: number; book: Promise<Buffer> }>();

/** Whether a novel series' chapters with no file read online: its plugin is installed and loads. */
export function novelReadsOnline(seriesId: number, db = getDb()): boolean {
	const s = seriesRow(db, seriesId);
	const key = parseNovelKey(s?.origin_key ?? null);
	return !!key && pluginOf(key.plugin) !== null;
}

/** The chapters of a series with no file, as the reader will open them online: their file and locator. */
export function onlineChapters(
	seriesId: number,
	db = getDb()
): Map<number, { file: string; locator: string }> {
	const rows = db
		.prepare(
			`SELECT id, source_url FROM entries WHERE series_id = ? AND available = 0 AND source_url != ''`
		)
		.all(seriesId) as { id: number; source_url: string }[];
	return new Map(
		rows.map((r) => [r.id, { file: onlineFile(r.id), locator: chapterHref(r.source_url) }])
	);
}

/**
 * The book of one chapter, read from its plugin. Null for an entry that isn't
 * this series' or that the viewer may not see; throws when the plugin fails,
 * which the reader shows as the chapter not opening, with RETRY.
 */
export async function onlineNovelBook(
	seriesId: number,
	entryId: number,
	reveal: boolean,
	now = Date.now()
): Promise<Buffer | null> {
	const db = getDb();
	const e = db
		.prepare(
			`SELECT e.id, e.source_url AS path, e.label, e.title FROM entries e
			JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE e.id = ? AND s.id = ? AND s.kind = 'novel' AND e.available = 0 AND e.source_url != ''
				AND (? OR ${VISIBLE_SQL})`
		)
		.get(entryId, seriesId, reveal ? 1 : 0) as
		{ id: number; path: string; label: string; title: string } | undefined;
	if (!e) return null;
	const kept = books.get(entryId);
	if (kept && now - kept.at < KEEP_MS) return kept.book;
	const book = build(seriesId, e, now);
	books.delete(entryId);
	books.set(entryId, { at: now, book });
	if (books.size > MAX_KEPT) books.delete(books.keys().next().value!);
	// A failure isn't kept: RETRY asks the plugin again.
	book.catch(() => books.delete(entryId));
	return book;
}

async function build(
	seriesId: number,
	e: { id: number; path: string; label: string; title: string },
	now: number
): Promise<Buffer> {
	const db = getDb();
	const s = seriesRow(db, seriesId)!;
	const key = parseNovelKey(s.origin_key)!;
	const p = pluginOf(key.plugin);
	if (!p) throw new Error('No installed plugin has this source');
	const ch = await fetchChapter(p, e, p.lang, fetchImage);
	const rows = db
		.prepare(
			`SELECT source_url, position, label, title, added_at FROM entries
			WHERE series_id = ? AND source_url != '' ORDER BY position, id`
		)
		.all(seriesId) as {
		source_url: string;
		position: number;
		label: string;
		title: string;
		added_at: number;
	}[];
	const manifest: NovelManifest = {
		format: 'tsundoku-novel',
		version: 1,
		plugin: key.plugin,
		path: key.path,
		source: p.name,
		title: s.title,
		lang: p.lang,
		description: s.description,
		status: s.status,
		coverUrl: s.cover_url,
		tags: seriesTags(db, seriesId),
		chapters: rows.map((r) => ({
			path: r.source_url,
			position: r.position,
			label: r.label,
			title: r.title,
			addedAt: r.added_at,
			href: r.source_url === e.path ? ch.href : null
		}))
	};
	return Buffer.from(
		zip(novelBookMembers(manifest, new Map([[ch.href, ch.doc]]), ch.images, new Date(now)))
	);
}

/** For tests: forget the books kept. */
export const forgetOnlineBooks = () => books.clear();
