import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { zip } from '../zip-write.ts';
import { listZip, readMember } from '../zip.ts';
import { publicFetch } from '../net-guard.ts';
import { imageType } from '../engine/protocol.ts';
import { TSUNDOKU_DEVICE } from '../engine/device.ts';
import { failed, isPaused, nextUp, queueRows, recover } from '../engine/queue.ts';
import { mihonFolderName } from '../../import/mihon-plan.ts';
import {
	CHAPTER_HREF,
	chapterDocument,
	IMAGE_HREF,
	NOVEL_MANIFEST,
	novelBookMembers,
	parseNovelManifest,
	tocLabel,
	type NovelBookChapter,
	type NovelManifest
} from '../../import/novel-book.ts';
import { parseNovelKey, type DownloadState } from '../../library/downloads.ts';
import type { SeriesDownloads } from '../download-types.ts';
import type { PlannedTag } from '../../import/plan.ts';
import { chapterImages, chapterXhtml, hasText } from './chapter-html.ts';
import { installedPlugins, novelHost, type InstalledPlugin } from './plugins.ts';

/**
 * The novel downloader (doc/NOVELS.md, "Downloading"; card c150): takes a
 * novel's chapters off the download queue, asks its plugin for each one
 * (`parseChapter`), and writes them into the novel's EPUB in tsundoku's
 * device folder, which the EPUB importer reads as it reads any book
 * (novel-book.ts says what makes it this series' own). As for manga, the
 * importer stays the one place a file becomes an entry.
 *
 * The book is rewritten whole, beside its place and renamed, so a reader
 * never meets half of one. To keep that from happening for every chapter of
 * a long ALL, a series' chapters are taken a batch at a time.
 */

/** Plugins downloading at once; one batch each. */
const LANES = 2;
/** A series' chapters fetched before its book is written. */
const BATCH = 10;
/** Between two chapters of one site: a reader's pace, not a crawler's. */
const PAUSE_MS = 1000;
/** A chapter's pictures: more than this is a gallery, not a chapter. */
const MAX_IMAGES = 40;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ImageFetch = (url: string, referer: string) => Promise<Buffer | null>;

export type NovelDeps = {
	db: Database.Database;
	/** `$LIBRARY_ROOT`, where `devices/tsundoku/` goes. */
	library: string;
	now: () => number;
	fetchImage?: ImageFetch;
	/** Waits between two chapters; the specs don't. */
	pause?: () => Promise<void>;
};

/** Why a chapter didn't download, in the queue's words (failure, as the engine's are). */
export type NovelFailure = 'source' | 'not-found' | 'not-at-source' | 'disk';

export class NovelDownloadError extends Error {
	readonly failure: NovelFailure;
	constructor(message: string, failure: NovelFailure) {
		super(message);
		this.failure = failure;
	}
}

const hash16 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** A chapter's document in the book, from its path at the source (novel-book.ts). */
export const chapterHref = (path: string) => `OEBPS/Text/c-${hash16(path)}.xhtml`;

type SeriesRow = {
	id: number;
	title: string;
	description: string;
	status: string;
	cover_url: string;
	origin_key: string;
};

function seriesRow(db: Database.Database, seriesId: number): SeriesRow | null {
	return (
		(db
			.prepare(
				`SELECT id, title, description, status, cover_url, origin_key FROM series WHERE id = ?`
			)
			.get(seriesId) as SeriesRow | undefined) ?? null
	);
}

function pluginOf(id: string): InstalledPlugin | null {
	const p = installedPlugins().find((x) => x.id === id);
	return p && !p.failed ? p : null;
}

/**
 * Where a series' book is, under the library folder: fixed at its first
 * download (rung 45), `devices/tsundoku/Library/Novels/<Source>/<Title>.epub`,
 * and never another series' file.
 */
export function bookFile(db: Database.Database, seriesId: number, source: string): string {
	const known = db.prepare(`SELECT file FROM novel_series WHERE series_id = ?`).get(seriesId) as
		{ file: string } | undefined;
	if (known) return known.file;
	const s = seriesRow(db, seriesId)!;
	const dir = posix.join(
		'devices',
		TSUNDOKU_DEVICE,
		'Library',
		'Novels',
		mihonFolderName(source || 'Novels')
	);
	const taken = db.prepare(`SELECT 1 FROM novel_series WHERE file = ?`);
	const stem = mihonFolderName(s.title).slice(0, 200);
	let file = posix.join(dir, `${stem}.epub`);
	for (let n = 2; taken.get(file); n++) file = posix.join(dir, `${stem} (${n}).epub`);
	db.prepare(`INSERT INTO novel_series (series_id, file) VALUES (?, ?)`).run(seriesId, file);
	return file;
}

/** What a book already holds: its chapters' documents and pictures, and its manifest. */
async function readBook(path: string): Promise<{
	manifest: NovelManifest | null;
	docs: Map<string, Buffer>;
	images: Map<string, Buffer>;
}> {
	const docs = new Map<string, Buffer>();
	const images = new Map<string, Buffer>();
	if (!existsSync(path)) return { manifest: null, docs, images };
	const fh = await open(path);
	try {
		const members = await listZip(fh, (await fh.stat()).size);
		let manifest: NovelManifest | null = null;
		for (const m of members) {
			if (CHAPTER_HREF.test(m.name)) docs.set(m.name, await readMember(fh, m));
			else if (IMAGE_HREF.test(m.name)) images.set(m.name, await readMember(fh, m));
			else if (m.name === NOVEL_MANIFEST)
				manifest = parseNovelManifest((await readMember(fh, m)).toString('utf8'));
		}
		return { manifest, docs, images };
	} finally {
		await fh.close();
	}
}

/** The fetch for a chapter's pictures: on the internet only, every redirect too (net-guard.ts). */
export const fetchImage: ImageFetch = async (url, referer) => {
	try {
		const res = await publicFetch(url, {
			headers: {
				'user-agent':
					'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36',
				referer,
				accept: 'image/webp,image/*,*/*;q=0.8'
			},
			signal: AbortSignal.timeout(20_000)
		});
		if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return null;
		const bytes = Buffer.from(await res.arrayBuffer());
		return bytes.length > MAX_IMAGE_BYTES ? null : bytes;
	} catch {
		return null;
	}
};

function dataImage(uri: string): Buffer | null {
	const m = /^data:image\/[\w.+-]+;base64,([\s\S]*)$/i.exec(uri);
	if (!m) return null;
	const b = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
	return b.length > 0 && b.length <= MAX_IMAGE_BYTES ? b : null;
}

export type FetchedChapter = {
	entryId: number;
	href: string;
	doc: string;
	images: Map<string, Buffer>;
};

/**
 * One chapter, from its plugin, as a document for the book and the pictures
 * it shows. Throws a NovelDownloadError (the queue counts the try).
 */
export async function fetchChapter(
	p: InstalledPlugin,
	e: { id: number; path: string; label: string; title: string },
	lang: string,
	get: ImageFetch
): Promise<FetchedChapter> {
	let html: unknown;
	try {
		html = await novelHost().call<unknown>(p.file, 'parseChapter', [e.path]);
	} catch (err) {
		throw new NovelDownloadError((err as Error).message, 'source');
	}
	if (typeof html !== 'string' || !hasText(html))
		throw new NovelDownloadError('The chapter came back empty', 'source');
	// A chapter's pictures are relative to its own page at the site.
	let base: string;
	try {
		base = new URL(e.path, p.site || 'https://invalid.example/').toString();
	} catch {
		base = p.site;
	}
	const referer = (() => {
		try {
			return `${new URL(p.site).origin}/`;
		} catch {
			return '';
		}
	})();
	const images = new Map<string, Buffer>();
	const local = new Map<string, string>();
	for (const url of chapterImages(html, base).slice(0, MAX_IMAGES)) {
		const bytes = url.startsWith('data:') ? dataImage(url) : await get(url, referer);
		const type = bytes ? imageType(new Uint8Array(bytes)) : null;
		// EPUB's own picture types only (novel-book.ts): anything else is left out.
		if (!bytes || !type || !['jpg', 'png', 'gif', 'webp'].includes(type)) continue;
		const href = `OEBPS/Images/i-${hash16(bytes)}.${type}`;
		images.set(href, bytes);
		local.set(url, `../Images/${href.slice('OEBPS/Images/'.length)}`);
	}
	const name = tocLabel(e);
	return {
		entryId: e.id,
		href: chapterHref(e.path),
		doc: chapterDocument(name, chapterXhtml(html, base, local), lang),
		images
	};
}

function seriesTags(db: Database.Database, seriesId: number): PlannedTag[] {
	return db
		.prepare(
			`SELECT t.namespace, t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE st.series_id = ? AND t.namespace IN ('author', 'artist', 'genre', 'source')
			ORDER BY t.namespace, t.value`
		)
		.all(seriesId) as PlannedTag[];
}

/**
 * Writes [arrived] into the series' book, beside its place and renamed:
 * what it held already, the new chapters, and a manifest of every chapter
 * the series has now, in its order. Returns the book's path.
 */
export async function writeBook(
	seriesId: number,
	p: InstalledPlugin,
	arrived: FetchedChapter[],
	d: NovelDeps
): Promise<string> {
	const s = seriesRow(d.db, seriesId);
	const key = parseNovelKey(s?.origin_key ?? null);
	if (!s || !key) throw new NovelDownloadError('Not a novel from a source', 'not-found');
	const path = join(d.library, bookFile(d.db, seriesId, p.name));
	const old = await readBook(path);
	const oldHref = new Map(
		(old.manifest?.chapters ?? []).filter((c) => c.href).map((c) => [c.path, c.href!])
	);
	const fresh = new Map(arrived.map((a) => [a.entryId, a]));
	const docs = new Map<string, string | Buffer>();
	const rows = d.db
		.prepare(
			`SELECT id, source_url, position, label, title, added_at FROM entries
			WHERE series_id = ? AND source_url != '' ORDER BY position, id`
		)
		.all(seriesId) as {
		id: number;
		source_url: string;
		position: number;
		label: string;
		title: string;
		added_at: number;
	}[];
	const chapters: NovelBookChapter[] = rows.map((r) => {
		const got = fresh.get(r.id);
		let href: string | null = null;
		if (got) {
			href = got.href;
			docs.set(href, got.doc);
		} else {
			const was = oldHref.get(r.source_url);
			if (was && old.docs.has(was)) {
				href = was;
				docs.set(href, old.docs.get(was)!);
			}
		}
		return {
			path: r.source_url,
			position: r.position,
			label: r.label,
			title: r.title,
			addedAt: r.added_at,
			href
		};
	});
	// The pictures the book's documents still show.
	const images = new Map<string, Buffer>();
	const shown = [...docs.values()].map((v) => v.toString()).join('\n');
	for (const [href, bytes] of [...old.images, ...arrived.flatMap((a) => [...a.images])])
		if (shown.includes(href.slice('OEBPS/Images/'.length))) images.set(href, bytes);
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
		tags: seriesTags(d.db, seriesId),
		chapters
	};
	const book = zip(novelBookMembers(manifest, docs, images, new Date(d.now())));
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(`${path}.partial`, book);
		renameSync(`${path}.partial`, path);
	} catch (err) {
		throw new NovelDownloadError(`The book couldn’t be written: ${(err as Error).message}`, 'disk');
	}
	const put = d.db.prepare(
		`INSERT OR REPLACE INTO novel_chapters (entry_id, downloaded_at) VALUES (?, ?)`
	);
	d.db.transaction(() => arrived.forEach((a) => put.run(a.entryId, d.now())))();
	return path;
}

type Job = { entryId: number; path: string; label: string; title: string };

/** The series' chapters to fetch with [first]: the next ready ones of it in the queue, a batch at most. */
function batchOf(
	db: Database.Database,
	first: number,
	now: number
): { seriesId: number; jobs: Job[] } {
	const head = db
		.prepare(`SELECT series_id, position FROM download_queue WHERE entry_id = ?`)
		.get(first) as { series_id: number; position: number };
	const jobs = db
		.prepare(
			`SELECT e.id AS entryId, e.source_url AS path, e.label, e.title FROM download_queue q
			JOIN entries e ON e.id = q.entry_id
			WHERE q.series_id = ? AND (q.entry_id = ? OR (q.state = 'queued' AND q.next_at <= ?))
			ORDER BY q.entry_id = ? DESC, q.position LIMIT ?`
		)
		.all(head.series_id, first, now, first, BATCH) as Job[];
	return { seriesId: head.series_id, jobs };
}

/**
 * One series' batch: each chapter fetched in turn (marked DOWNLOADING as it
 * goes), then the book written with those that came, and they leave the
 * queue. A chapter that failed counts a try; if the book can't be written,
 * every chapter of the batch does.
 */
async function runBatch(first: number, d: NovelDeps): Promise<number> {
	const { seriesId, jobs } = batchOf(d.db, first, d.now());
	const s = seriesRow(d.db, seriesId);
	const key = parseNovelKey(s?.origin_key ?? null);
	const p = key ? pluginOf(key.plugin) : null;
	if (!p) {
		for (const j of jobs)
			failed(j.entryId, 'not-found', 'No installed plugin has this source', d.now(), d.db);
		return 0;
	}
	const mark = d.db.prepare(
		`UPDATE download_queue SET state = 'downloading', pages = 1, done_pages = ? WHERE entry_id = ?`
	);
	const arrived: FetchedChapter[] = [];
	for (const [i, j] of jobs.entries()) {
		// PAUSE between chapters takes effect at once; what came is still written.
		if (i > 0 && isPaused()) break;
		if (i > 0) await (d.pause ?? (() => new Promise((r) => setTimeout(r, PAUSE_MS))))();
		mark.run(0, j.entryId);
		try {
			arrived.push(
				await fetchChapter(p, { ...j, id: j.entryId }, p.lang, d.fetchImage ?? fetchImage)
			);
			mark.run(1, j.entryId);
		} catch (err) {
			const f = err instanceof NovelDownloadError ? err.failure : 'source';
			failed(j.entryId, f, (err as Error).message, d.now(), d.db);
		}
	}
	if (arrived.length === 0) return 0;
	try {
		await writeBook(seriesId, p, arrived, d);
	} catch (err) {
		const f = err instanceof NovelDownloadError ? err.failure : 'disk';
		for (const a of arrived) failed(a.entryId, f, (err as Error).message, d.now(), d.db);
		return 0;
	}
	const done = d.db.prepare(`DELETE FROM download_queue WHERE entry_id = ?`);
	d.db.transaction(() => arrived.forEach((a) => done.run(a.entryId)))();
	return arrived.length;
}

/** One pass: a batch for each plugin that has chapters ready, LANES at once. Returns how many chapters arrived. */
export async function runNovelOnce(d: NovelDeps): Promise<number> {
	if (isPaused()) return 0;
	const jobs = nextUp(LANES, d.now(), d.db, 'novel');
	const done = await Promise.all(jobs.map((j) => runBatch(j.entryId, d)));
	return done.reduce((a, b) => a + b, 0);
}

// ---- running in the app -----------------------------------------------------------------

let loop: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * Starts the novel downloader in the app, once, beside the engine's
 * (engine/run.ts). [onArrived] runs after chapters land: the app's scan,
 * debounced.
 */
export function startNovelWorker(
	library: string,
	onArrived: () => void,
	db: Database.Database = getDb()
): void {
	if (loop || running) return;
	recover(db, 'novel');
	const d: NovelDeps = { db, library, now: Date.now };
	const tick = async () => {
		running = true;
		try {
			if ((await runNovelOnce(d)) > 0) onArrived();
		} catch (err) {
			console.warn(`tsundoku: novel downloader: ${(err as Error).message}`);
		} finally {
			running = false;
			loop = setTimeout(() => void tick(), 3000);
			loop.unref();
		}
	};
	loop = setTimeout(() => void tick(), 1000);
	loop.unref();
	const stop = () => {
		if (loop) clearTimeout(loop);
		loop = null;
	};
	process.once('SIGTERM', stop);
	process.once('SIGINT', stop);
}

// ---- the series screen ------------------------------------------------------------------

/** Whether a series is a novel from a plugin: its downloads are this module's. */
export function isNovelSeries(seriesId: number, db: Database.Database = getDb()): boolean {
	const s = db.prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null } | undefined;
	return parseNovelKey(s?.origin_key ?? null) !== null;
}

/**
 * Where a novel's chapters stand, for its DOWNLOAD row and chapter rows, as
 * the engine's backend answers for a manga: from the queue, and from what
 * the worker wrote into the book that the import hasn't attached yet
 * (IMPORTING), and FOLLOW's state (novels/follow.ts). A plugin no longer
 * installed has no row.
 */
export function novelSeriesDownloads(
	seriesId: number,
	entries: { id: number; available: boolean }[],
	db: Database.Database = getDb()
): SeriesDownloads {
	const s = db
		.prepare(
			`SELECT s.origin_key, s.followed_at, c.checked_at FROM series s
			LEFT JOIN novel_checks c ON c.series_id = s.id WHERE s.id = ?`
		)
		.get(seriesId) as
		| { origin_key: string | null; followed_at: number | null; checked_at: number | null }
		| undefined;
	const key = parseNovelKey(s?.origin_key ?? null);
	if (!s || !key || !pluginOf(key.plugin)) return { kind: 'none' };
	const written = new Set(
		(
			db
				.prepare(
					`SELECT c.entry_id FROM novel_chapters c JOIN entries e ON e.id = c.entry_id WHERE e.series_id = ?`
				)
				.all(seriesId) as { entry_id: number }[]
		).map((r) => r.entry_id)
	);
	const listed = new Set(
		(
			db
				.prepare(`SELECT id FROM entries WHERE series_id = ? AND source_url != ''`)
				.all(seriesId) as { id: number }[]
		).map((r) => r.id)
	);
	const rows = new Map(queueRows(db).map((r) => [r.entryId, r]));
	const states: Record<number, DownloadState> = {};
	for (const e of entries) {
		const q = rows.get(e.id);
		if (e.available) states[e.id] = { kind: 'have' };
		else if (written.has(e.id)) states[e.id] = { kind: 'importing' };
		else if (q?.state === 'queued') states[e.id] = { kind: 'queued', chapterId: e.id };
		else if (q?.state === 'downloading')
			states[e.id] = {
				kind: 'downloading',
				chapterId: e.id,
				page: q.donePages,
				pages: q.pages,
				fraction: q.pages > 0 ? q.donePages / q.pages : 0
			};
		else if (q?.state === 'failed')
			states[e.id] = { kind: 'failed', chapterId: e.id, tries: q.tries };
		else states[e.id] = { kind: 'none', chapterId: listed.has(e.id) ? e.id : null };
	}
	const queuedElsewhere = [...rows.values()].filter(
		(r) => r.seriesId !== seriesId && r.state !== 'failed'
	).length;
	return {
		kind: 'ok',
		states,
		queuedElsewhere,
		follow: { on: s.followed_at !== null, checked: s.checked_at }
	};
}

/** Chapters written into a book and not imported yet: a restart dropped their import. */
export const pendingNovelImports = (db: Database.Database = getDb()) =>
	(
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM novel_chapters c JOIN entries e ON e.id = c.entry_id WHERE e.available = 0`
			)
			.get() as { n: number }
	).n;
