import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from '../fspath.ts';
import { gzipSync } from 'node:zlib';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { zip } from '../zip-write.ts';
import { comicInfoXml } from '../../import/comicinfo.ts';
import { encodeBackup, type MihonBackup, type MihonManga } from '../../import/mihon-backup.ts';
import { mihonFolderName } from '../../import/mihon-plan.ts';
import { parseKey } from '../../library/downloads.ts';
import { call, fetchProxied, EngineError } from './client.ts';
import { extensionFor, preferences } from './extensions.ts';
import { imageType } from './protocol.ts';
import {
	absoluteUrl,
	backupName,
	chapterFile,
	chapterName,
	matchSourceChapters,
	sourceDir,
	TSUNDOKU_DEVICE,
	type SourceChapter
} from './device.ts';
import { failed, isPaused, nextUp, recover } from './queue.ts';

/**
 * The downloader (doc/DOWNLOADER.md; card c137): takes chapters off the
 * queue, has the engine fetch their pages through each source's own client,
 * writes them as Mihon would into `devices/tsundoku/Mihon/`, with a backup
 * that names them by tsundoku's own keys, and has the importer read that as
 * it reads any device.
 */

/** Sources downloading at once; one chapter each. */
const LANES = 3;
/** A chapter's pages fetched at once: six were fine in the spike, 200 pages in 15 s. */
const PAGE_LANES = 6;
/** A series' chapter list is asked again after this. */
const RESOLVE_TTL = 6 * 60 * 60 * 1000;

type Deps = {
	db: Database.Database;
	/** `$LIBRARY_ROOT`, where `devices/tsundoku/` goes. */
	library: string;
	now: () => number;
	/** Each file written, as it lands: attached at once (engine/run.ts). */
	arrived?: (file: string) => void;
};

const mihonDir = (d: Deps) => join(d.library, 'devices', TSUNDOKU_DEVICE, 'Mihon');

type SeriesRow = { id: number; title: string; origin_key: string };
type SourceInfo = { name: string; lang: string; base_url: string };

function sourceInfo(db: Database.Database, sourceId: string): SourceInfo | null {
	return (
		(db.prepare(`SELECT name, lang, base_url FROM engine_sources WHERE id = ?`).get(sourceId) as
			SourceInfo | undefined) ?? null
	);
}

type Manga = {
	url: string;
	title: string;
	artist?: string;
	author?: string;
	description?: string;
	genre?: string;
	status?: number;
	thumbnail_url?: string;
};

/**
 * What the source calls [seriesId] and its chapters now. A details call
 * first, on the URL last known: Toonily's extension answers an old URL with
 * its new one (and refuses the old one after, until the engine restarts, so
 * the new one is kept and used from then on). The chapter list is matched
 * onto the entries (matchSourceChapters); the series' key and the entries'
 * URLs never move. Returns the chapters no entry is: new ones.
 */
export async function resolveSeries(
	seriesId: number,
	d: Pick<Deps, 'db' | 'now'>,
	force = false
): Promise<SourceChapter[]> {
	const s = d.db.prepare(`SELECT id, title, origin_key FROM series WHERE id = ?`).get(seriesId) as
		SeriesRow | undefined;
	const key = parseKey(s?.origin_key ?? null);
	if (!s || !key) throw new EngineError('Not a series from a source', 'not-found');
	const ext = extensionFor(key.sourceId, d.db);
	if (!ext) throw new EngineError('No installed extension has this source', 'not-found');
	const known = d.db
		.prepare(`SELECT engine_url, title, resolved_at FROM engine_series WHERE series_id = ?`)
		.get(seriesId) as { engine_url: string; title: string; resolved_at: number | null } | undefined;
	if (known && !force && known.resolved_at && d.now() - known.resolved_at < RESOLVE_TTL) return [];

	const opts = { sourceId: key.sourceId, preferences: preferences(key.sourceId, d.db) };
	const asked = known?.engine_url ?? key.url;
	const details = await call<Manga>(
		ext,
		'getDetailsManga',
		{ mangaData: { url: asked, title: s.title } },
		opts
	);
	// A 1.6 source may give back a blank URL (Mangahere): the one asked stays.
	const engineUrl = details.url || asked;
	const chapters = await call<SourceChapter[]>(
		ext,
		'getChapterList',
		{ mangaData: { ...details, url: engineUrl, title: details.title || s.title } },
		opts
	);

	const local = d.db
		.prepare(
			`SELECT id, source_url AS url, position, scanlator FROM entries WHERE series_id = ? AND source_url != ''`
		)
		.all(seriesId) as { id: number; url: string; position: number; scanlator: string }[];
	const { matched, unmatched } = matchSourceChapters(s.title, local, chapters);
	d.db.transaction(() => {
		d.db
			.prepare(
				`INSERT INTO engine_series (series_id, source_id, engine_url, title, resolved_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (series_id) DO UPDATE SET engine_url = excluded.engine_url, resolved_at = excluded.resolved_at`
			)
			.run(seriesId, key.sourceId, engineUrl, known?.title ?? s.title, d.now());
		const put = d.db.prepare(
			`INSERT OR REPLACE INTO engine_chapters (entry_id, engine_url, name) VALUES (?, ?, ?)`
		);
		for (const [entryId, c] of matched) put.run(entryId, c.url, c.name);
	})();
	return unmatched;
}

/** Runs [work] over [items], [lanes] at a time, keeping their order in the result. */
async function pooled<T, R>(
	items: T[],
	lanes: number,
	work: (t: T, i: number) => Promise<R>
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(lanes, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await work(items[i], i);
			}
		})
	);
	return out;
}

/**
 * Downloads one queued chapter into the device folder. Throws an
 * EngineError (the queue counts the try) when anything doesn't hold;
 * writes nothing half-done: the CBZ is written beside its place and renamed.
 */
/**
 * A chapter at its source, right now: the entry, its source and extension, and
 * the page list the engine hands out for it (asked fresh: page tokens die with
 * an engine restart). What a download zips and what reading online shows
 * (doc/BROWSING.md, "Manga online"; card c166).
 */
export async function chapterAtSource(entryId: number, d: Pick<Deps, 'db' | 'now'>) {
	const e = d.db
		.prepare(
			`SELECT e.id, e.series_id, e.label, e.title, e.scanlator, e.position, e.source_url, e.origin_source,
				s.origin_key
			FROM entries e JOIN series s ON s.id = e.series_id WHERE e.id = ?`
		)
		.get(entryId) as
		| {
				id: number;
				series_id: number;
				label: string;
				title: string;
				scanlator: string;
				position: number;
				source_url: string;
				origin_source: string;
				origin_key: string;
		  }
		| undefined;
	const key = parseKey(e?.origin_key ?? null);
	if (!e || !key) throw new EngineError('Not a chapter from a source', 'not-found');
	// A chapter kept from the source the series left asks that source, not the
	// series' new one (doc/MOVE.md): its address and its extension are there.
	const sourceId = e.origin_source || key.sourceId;
	const ext = extensionFor(sourceId, d.db);
	const source = sourceInfo(d.db, sourceId);
	if (!ext || !source) throw new EngineError('No installed extension has this source', 'not-found');

	let chapter = d.db
		.prepare(`SELECT engine_url, name FROM engine_chapters WHERE entry_id = ?`)
		.get(entryId) as { engine_url: string; name: string } | undefined;
	if (!chapter) {
		await resolveSeries(e.series_id, d, true);
		chapter = d.db
			.prepare(`SELECT engine_url, name FROM engine_chapters WHERE entry_id = ?`)
			.get(entryId) as typeof chapter;
	}
	if (!chapter) throw new EngineError('The source no longer lists this chapter', 'not-at-source');
	const series = d.db
		.prepare(`SELECT title FROM engine_series WHERE series_id = ?`)
		.get(e.series_id) as { title: string };

	const opts = { sourceId, preferences: preferences(sourceId, d.db) };
	const pages = await call<{ index: number; url: string; imageUrl: string | null }[]>(
		ext,
		'getPageList',
		{ chapterData: { url: chapter.engine_url, name: chapter.name } },
		opts
	);
	if (pages.length === 0) throw new EngineError('The chapter has no pages', 'source');
	return { e, source, series, pages };
}

export async function downloadChapter(entryId: number, d: Deps): Promise<string> {
	const { e, source, series, pages } = await chapterAtSource(entryId, d);
	d.db
		.prepare(`UPDATE download_queue SET pages = ?, done_pages = 0 WHERE entry_id = ?`)
		.run(pages.length, entryId);

	const progress = d.db.prepare(
		`UPDATE download_queue SET done_pages = done_pages + 1 WHERE entry_id = ?`
	);
	const images = await pooled(pages, PAGE_LANES, async (p) => {
		const target = p.imageUrl || p.url;
		let last: unknown;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const { bytes } = await fetchProxied(target);
				const type = imageType(bytes);
				if (!type)
					throw new EngineError('A page came back as something other than an image', 'source');
				progress.run(entryId);
				return { bytes, type };
			} catch (err) {
				last = err;
			}
		}
		throw last;
	});

	const width = String(images.length).length;
	const cbz = zip([
		...images.map((img, i) => ({
			name: `${String(i + 1).padStart(Math.max(3, width), '0')}.${img.type}`,
			data: Buffer.from(img.bytes)
		})),
		{
			name: 'ComicInfo.xml',
			deflate: true,
			data: comicInfoXml({
				title: chapterName(e),
				series: series.title,
				number: e.position,
				web: [absoluteUrl(e.source_url, source.base_url)],
				translator: e.scanlator,
				source: source.name
			})
		}
	]);
	const folder = join(
		mihonDir(d),
		'downloads',
		sourceDir(source.name, source.lang),
		mihonFolderName(series.title)
	);
	mkdirSync(folder, { recursive: true });
	const path = join(folder, chapterFile(e));
	writeFileSync(`${path}.partial`, cbz);
	renameSync(`${path}.partial`, path);
	// IMPORTING until the import attaches the file.
	d.db
		.prepare(`UPDATE engine_chapters SET downloaded_at = ? WHERE entry_id = ?`)
		.run(d.now(), entryId);
	return path;
}

/**
 * The device's backup: every series tsundoku has downloaded for, under its
 * own key and with its entries' own URLs, so the importer folds the files
 * into the series and entries they are (doc/DOWNLOADER.md, "Keys"). No read
 * state: tsundoku is the source of truth for that, and the importer only
 * moves it forward.
 */
export function deviceBackup(db: Database.Database): MihonBackup {
	const rows = db
		.prepare(
			`SELECT es.series_id, es.source_id, es.title, s.origin_key FROM engine_series es JOIN series s ON s.id = es.series_id`
		)
		.all() as { series_id: number; source_id: string; title: string; origin_key: string }[];
	const entries = db.prepare(
		`SELECT source_url, label, title, scanlator, position, added_at FROM entries
		WHERE series_id = ? AND source_url != '' ORDER BY position DESC`
	);
	const sources = new Map<string, string>();
	const manga: MihonManga[] = [];
	for (const r of rows) {
		const key = parseKey(r.origin_key);
		if (!key) continue;
		sources.set(key.sourceId, sourceInfo(db, key.sourceId)?.name ?? key.sourceId);
		const chapters = (
			entries.all(r.series_id) as {
				source_url: string;
				label: string;
				title: string;
				scanlator: string;
				position: number;
				added_at: number;
			}[]
		).map((c, i) => ({
			url: c.source_url,
			name: chapterName(c),
			scanlator: c.scanlator,
			read: false,
			bookmark: false,
			lastPageRead: 0,
			dateFetch: c.added_at,
			dateUpload: c.added_at,
			number: c.position,
			sourceOrder: i
		}));
		manga.push({
			source: key.sourceId,
			url: key.url,
			title: r.title,
			artist: '',
			author: '',
			description: '',
			genres: [],
			status: 0,
			thumbnailUrl: '',
			dateAdded: null,
			viewer: 0,
			chapters,
			categories: [],
			favorite: true,
			history: [],
			trackers: []
		});
	}
	return { manga, categories: [], sources };
}

/** Writes the device's backup, keeping its three newest, and returns its path. */
export function writeDeviceBackup(d: Deps): string {
	const folder = join(mihonDir(d), 'autobackup');
	mkdirSync(folder, { recursive: true });
	const path = join(folder, backupName(new Date(d.now())));
	writeFileSync(`${path}.partial`, gzipSync(encodeBackup(deviceBackup(d.db))));
	renameSync(`${path}.partial`, path);
	const own = readdirSync(folder)
		.filter((n) => n.startsWith(`${TSUNDOKU_DEVICE}_`) && n.endsWith('.tachibk'))
		.sort();
	for (const old of own.slice(0, Math.max(0, own.length - 3)))
		rmSync(join(folder, old), { force: true });
	return path;
}

/**
 * One pass: starts what can start (one chapter per source, LANES sources),
 * and waits for those. Each finished chapter leaves the queue; a failed one
 * counts a try. Returns how many finished.
 */
export async function runOnce(d: Deps): Promise<number> {
	if (isPaused()) return 0;
	// A novel's chapters are the novel worker's (novels/downloader.ts).
	const jobs = nextUp(LANES, d.now(), d.db, 'manga');
	if (jobs.length === 0) return 0;
	const mark = d.db.prepare(`UPDATE download_queue SET state = 'downloading' WHERE entry_id = ?`);
	for (const j of jobs) mark.run(j.entryId);
	let done = 0;
	await Promise.all(
		jobs.map(async (j) => {
			try {
				const file = await downloadChapter(j.entryId, d);
				d.db.prepare(`DELETE FROM download_queue WHERE entry_id = ?`).run(j.entryId);
				d.arrived?.(file);
				done++;
			} catch (err) {
				const f = err instanceof EngineError ? err.failure : 'source';
				failed(j.entryId, f, (err as Error).message, d.now(), d.db);
			}
		})
	);
	if (done > 0) writeDeviceBackup(d);
	return done;
}

// ---- running in the app -----------------------------------------------------------------

let loop: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * Starts the downloader in the app, once, when the engine backend is on
 * (`DOWNLOADS_BACKEND=engine`). [onArrived] gets the files that landed:
 * attached at once (engine/run.ts).
 */
export function startWorker(
	library: string,
	onArrived: (files: string[]) => void,
	db: Database.Database = getDb()
): void {
	if (loop || running) return;
	recover(db, 'manga');
	const d: Deps = { db, library, now: Date.now };
	const tick = async () => {
		running = true;
		try {
			const written: string[] = [];
			d.arrived = (file) => written.push(file);
			if ((await runOnce(d)) > 0) onArrived(written);
		} catch (err) {
			console.warn(`tsundoku: downloader: ${(err as Error).message}`);
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
