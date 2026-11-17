import { coverRoute } from '../novels/source.ts';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { browsedIds } from './browse.ts';
import { ensureNamedRoot, writeSeries } from '../import/write.ts';
import { dataPaths } from '../data-dirs.ts';
import { join } from '../fspath.ts';
import { refreshCovers } from '../covers.ts';
import {
	forgetSourceUse,
	libraryIndex,
	mihonRoot,
	seriesForKey,
	sourceUse
} from '../library-sources.ts';
import { planMihon } from '../../import/mihon-plan.ts';
import type { MihonManga } from '../../import/mihon-backup.ts';
import { chapterNumbers, toNumber } from '../../import/chapter-number.ts';
import {
	animeKeyOf,
	followQueue,
	highlight,
	keyOf,
	parseKey,
	queueView,
	sourcesToSearch,
	type DownloadState,
	type FollowFacts,
	type QueueItem,
	type ResultMatch
} from '../../library/downloads.ts';
import { call, engineDownSince, engineImageToken, EngineError } from './client.ts';
import { titleFromPath } from '../../library/titles.ts';
import { kindFacts, SOURCE_KINDS, type Medium, type SourceFamily } from '../../library/kinds.ts';
import { familyOfKind } from './repo-index.ts';
import { hideIfAddedHidden, sourcesWith } from './source-flags.ts';
import { extensionFor, preferences } from './extensions.ts';
import { splitMemo } from './protocol.ts';
import { chapterName, namesOf, numbersUnderNames } from './device.ts';
import * as queue from './queue.ts';
import { resolveBook, resolveSeries } from './worker.ts';
import { bookOrigins, entryOriginSql, seriesHolding } from '../season-facts.ts';
import { keepOrPromote } from '../browsing.ts';
import type {
	Queue,
	QueueSummary,
	SearchHit,
	SeriesDownloads,
	SourceManga
} from '../download-types.ts';

/**
 * The download screens' backend on tsundoku's own engine (doc/DOWNLOADS.md):
 * every function the screens call, answering in the types they were drawn
 * for (download-types.ts), so the screens are the
 * same whichever backend runs (server/downloads.ts picks). A chapter's id is
 * its entry's here, and a source's manga is named by source and URL.
 */

const db = (): Database.Database => getDb();

// ---- the queue, as the screens' QueueItems -------------------------------------------------

const STATE: Record<queue.QueueRow['state'], QueueItem['state']> = {
	queued: 'QUEUED',
	downloading: 'DOWNLOADING',
	failed: 'ERROR'
};

export function engineQueue(): Queue {
	const rows = db()
		.prepare(
			`SELECT q.entry_id, q.series_id, q.state, q.tries, q.done_pages, q.pages,
				-- An episode by its own number, which starts again each season (doc/ANIME.md).
				COALESCE(e.episode_number, e.position) AS position, e.label, e.title,
				${entryOriginSql('e', 's')} AS origin_key, s.title AS series_title
			FROM download_queue q JOIN entries e ON e.id = q.entry_id JOIN series s ON s.id = q.series_id
			ORDER BY q.position`
		)
		.all() as {
		entry_id: number;
		series_id: number;
		state: queue.QueueRow['state'];
		tries: number;
		done_pages: number;
		pages: number;
		position: number;
		label: string;
		title: string;
		origin_key: string;
		series_title: string;
	}[];
	return {
		running: !queue.isPaused(),
		items: rows.map((r) => ({
			chapterId: r.entry_id,
			state: STATE[r.state],
			progress: r.pages > 0 ? r.done_pages / r.pages : 0,
			tries: r.tries,
			pageCount: r.pages > 0 ? r.pages : -1,
			number: r.position,
			name: chapterName(r),
			key: r.origin_key,
			mangaId: r.series_id,
			mangaTitle: r.series_title
		}))
	};
}

export function queueSummary(reveal: boolean): QueueSummary {
	const v = queueView(engineQueue().items, seriesForKey, reveal);
	return {
		queued: v.queued,
		failed: v.failures.length,
		failedSeries: [...new Set(v.failures.map((f) => f.series?.title ?? f.mangaTitle))],
		stale: false
	};
}

// ---- a series --------------------------------------------------------------------------------

const resolving = new Set<number>();

/** Asks the source about a series in the background, so the next look is precise. */
function resolveLater(seriesId: number, force = false) {
	if (resolving.has(seriesId)) return;
	resolving.add(seriesId);
	void resolveSeries(seriesId, { db: db(), now: Date.now }, force)
		.catch(() => {})
		.finally(() => resolving.delete(seriesId));
}

const resolvingBooks = new Set<number>();

/** Asks a book's own source, as `resolveLater` asks a series'. */
function resolveBookLater(entryId: number) {
	if (resolvingBooks.has(entryId)) return;
	resolvingBooks.add(entryId);
	void resolveBook(entryId, { db: db(), now: Date.now })
		.catch(() => {})
		.finally(() => resolvingBooks.delete(entryId));
}

/**
 * How many unasked books one look at a group asks about in the background: the
 * look is a page load, a group can be long, and an engine call serialises per
 * source. The next look asks the next few, and the worker asks for itself.
 */
const BOOKS_AT_A_LOOK = 6;

function sourceTag(seriesId: number, sourceId: string): string {
	const tag = db()
		.prepare(
			`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE st.series_id = ? AND t.namespace = 'source' AND t.value != 'mihon' LIMIT 1`
		)
		.get(seriesId) as { value: string } | undefined;
	return tag?.value ?? `source ${sourceId}`;
}

/**
 * Where a series' chapters stand, from tsundoku's own queue: no waiting on a
 * network. A series the engine hasn't been asked about yet is asked in the
 * background, and until then every chapter with a URL counts as listed; the
 * worker finds out for certain, and a chapter the source doesn't list fails
 * at once as NOT AT THE SOURCE.
 */
export function seriesDownloads(
	seriesId: number,
	entries: { id: number; available: boolean }[]
): SeriesDownloads {
	const s = db()
		.prepare(`SELECT origin_key, followed_at FROM series WHERE id = ?`)
		.get(seriesId) as { origin_key: string | null; followed_at: number | null } | undefined;
	const own = parseKey(s?.origin_key ?? null);
	// A book grouped from a source has a key of its own (doc/BOOKS.md,
	// "Where a book's origin lives"), so a group answers per book: `none` when
	// nothing here is from a source, `elsewhere` when no book's source has an
	// extension, `down` when the engine isn't answering, and otherwise `ok`, a
	// book whose own source has no extension standing as a chapter its source
	// can't be asked about.
	const books = bookOrigins(seriesId, db()).flatMap((b) => {
		const key = parseKey(b.key);
		return key ? [{ ...b, parsed: key }] : [];
	});
	if (!own && books.length === 0) return { kind: 'none' };
	const installed = new Map<string, boolean>();
	const served = (sourceId: string) => {
		if (!installed.has(sourceId)) installed.set(sourceId, !!extensionFor(sourceId));
		return installed.get(sourceId)!;
	};
	if (!(own && served(own.sourceId)) && !books.some((b) => served(b.parsed.sourceId)))
		return {
			kind: 'elsewhere',
			source: sourceTag(seriesId, (own ?? books[0].parsed).sourceId)
		};
	const since = engineDownSince();
	if (since !== null) return { kind: 'down', since };

	const resolved = db()
		.prepare(`SELECT resolved_at FROM engine_series WHERE series_id = ?`)
		.get(seriesId) as { resolved_at: number | null } | undefined;
	if (own && served(own.sourceId) && !resolved) resolveLater(seriesId);
	books
		.filter((b) => b.resolvedAt === null && served(b.parsed.sourceId))
		.slice(0, BOOKS_AT_A_LOOK)
		.forEach((b) => resolveBookLater(b.entryId));
	const bookOf = new Map(books.map((b) => [b.entryId, b]));
	const listed = new Map(
		(
			db()
				.prepare(
					`SELECT c.entry_id, c.downloaded_at FROM engine_chapters c JOIN entries e ON e.id = c.entry_id WHERE e.series_id = ?`
				)
				.all(seriesId) as { entry_id: number; downloaded_at: number | null }[]
		).map((r) => [r.entry_id, r.downloaded_at])
	);
	const urls = new Set(
		(
			db()
				.prepare(`SELECT id FROM entries WHERE series_id = ? AND source_url != ''`)
				.all(seriesId) as { id: number }[]
		).map((r) => r.id)
	);
	const rows = new Map(queue.queueRows().map((r) => [r.entryId, r]));
	const states: Record<number, DownloadState> = {};
	const clear = db().prepare(`UPDATE engine_chapters SET downloaded_at = NULL WHERE entry_id = ?`);
	for (const e of entries) {
		const downloadedAt = listed.get(e.id) ?? null;
		if (e.available) {
			states[e.id] = { kind: 'have' };
			// Imported: the mark has done its job, and must not outlive a delete.
			if (downloadedAt !== null) clear.run(e.id);
			continue;
		}
		const q = rows.get(e.id);
		if (downloadedAt !== null) states[e.id] = { kind: 'importing' };
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
		else {
			const book = bookOf.get(e.id);
			const source = book ? book.parsed.sourceId : own?.sourceId;
			const asked = book ? book.resolvedAt !== null : !!resolved;
			states[e.id] = {
				kind: 'none',
				chapterId:
					source !== undefined && served(source) && urls.has(e.id) && (!asked || listed.has(e.id))
						? e.id
						: null
			};
		}
	}
	const queuedElsewhere = [...rows.values()].filter(
		(r) => r.seriesId !== seriesId && r.state !== 'failed'
	).length;
	// FOLLOW is a series' idea (doc/BOOKS.md): a group of one-offs has no one
	// thing to follow, so it isn't offered. `askable` rides on the answer past
	// the shared type; `downloadRow` reads it.
	const follow: FollowFacts = {
		on: (s?.followed_at ?? null) !== null,
		checked: resolved?.resolved_at ?? null,
		askable: !!own && served(own.sourceId)
	};
	return { kind: 'ok', states, queuedElsewhere, follow };
}

export function enqueue(seriesId: number, entryIds: number[]): { queued: number; missing: number } {
	const mine = new Set(
		(
			db().prepare(`SELECT id FROM entries WHERE series_id = ?`).all(seriesId) as { id: number }[]
		).map((r) => r.id)
	);
	const ids = entryIds.filter((id) => mine.has(id));
	const queued = queue.enqueue(ids);
	return { queued, missing: entryIds.length - queued };
}

export const retry = (ids: number[]) => queue.retry(ids);
export const dequeue = (ids: number[]) => queue.dequeue(ids);
export const setPaused = (paused: boolean) => queue.setPaused(paused);

/** ↑ TO THE TOP: these chapters ahead of everything else, in their own order. */
export function toTheTop(ids: number[]): void {
	if (!ids.length) return;
	const d = db();
	d.transaction(() => {
		const first = (
			d.prepare(`SELECT COALESCE(MIN(position), 0) AS p FROM download_queue`).get() as { p: number }
		).p;
		const set = d.prepare(`UPDATE download_queue SET position = ? WHERE entry_id = ?`);
		ids.forEach((id, i) => set.run(first - ids.length + i, id));
	})();
}

// ---- finding and adding a series -------------------------------------------------------------

/** A source's manga, as a search result names it: its source and its URL (memo included), in one string. */
export const sourceMangaId = (sourceId: string, url: string) =>
	`${sourceId}~${Buffer.from(url).toString('base64url')}`;

export function parseSourceMangaId(id: string): { sourceId: string; url: string } | null {
	const m = /^(\d+)~([A-Za-z0-9_-]+)$/.exec(id);
	if (!m) return null;
	const url = Buffer.from(m[2], 'base64url').toString('utf8');
	return url ? { sourceId: m[1], url } : null;
}

/** The engine's /image/ token as one of tsundoku's own URLs: the browser can't reach the engine, nor hold its token. */
export function imageRoute(engineUrl: string | undefined | null): string {
	const token = engineImageToken(engineUrl);
	return token ? `/api/downloads/engine-image/${token}` : '';
}

/** The sources a search asks: the installed ones the library reads from. */
export function searchSources(reveal: boolean): { id: string; name: string }[] {
	const rows = db()
		.prepare(
			`SELECT s.id, s.name FROM engine_sources s JOIN engine_extensions e ON e.pkg = s.pkg
			WHERE e.failed = ''`
		)
		.all() as { id: string; name: string }[];
	// A HIDDEN SOURCE is asked only inside reveal.
	const hiddenOn = reveal ? new Set<string>() : sourcesWith('hidden');
	return sourcesToSearch(
		rows.filter((r) => !hiddenOn.has(r.id)),
		sourceUse(),
		reveal,
		browsedIds(reveal)
	);
}

export type EngineManga = {
	url: string;
	title: string;
	artist?: string | null;
	author?: string | null;
	description?: string | null;
	genre?: string | null;
	status?: number | null;
	thumbnail_url?: string | null;
};

/** Mihon's SManga status numbers, as words for the result line. */
const STATUS = ['', 'ONGOING', 'COMPLETED', 'LICENSED', 'COMPLETED', 'CANCELLED', 'ON HIATUS'];
const STATUS_NAME = [
	'',
	'ONGOING',
	'COMPLETED',
	'LICENSED',
	'PUBLISHING_FINISHED',
	'CANCELLED',
	'ON_HIATUS'
];

/**
 * The source family a source is: an LNReader plugin's
 * (`ln:<plugin>`, BROWSE's id for it) is `lnreader`, and an installed
 * extension's is the family whose kind its row names (`engine_extensions.kind`,
 * `manga` for a Mihon APK and `anime` for an Aniyomi one, decoded by
 * `familyOfKind`, repo-index.ts). Null for a source the engine has no row for.
 */
export function sourceFamily(sourceId: string): SourceFamily | null {
	if (sourceId.startsWith('ln:')) return 'lnreader';
	const r = db()
		.prepare(
			`SELECT e.kind FROM engine_sources s JOIN engine_extensions e ON e.pkg = s.pkg WHERE s.id = ?`
		)
		.get(sourceId) as { kind: string } | undefined;
	return r ? familyOfKind(r.kind) : null;
}

/**
 * The medium a source serves (doc/KINDS.md): the medium of its
 * family's kind, so an LNReader plugin's is text, a Mihon extension's pages
 * and an Aniyomi one's video. Null for a source the engine has no row for,
 * which serves nothing it can say. MOVE asks it for the sources of a series'
 * medium (`moveSources`, server/move.ts).
 */
export function sourceMedium(sourceId: string): Medium | null {
	const family = sourceFamily(sourceId);
	return family ? kindFacts(SOURCE_KINDS[family]).medium : null;
}

/** Whether a source is an Aniyomi one: an anime extension's (doc/ANIME.md). */
export const isAnimeSource = (sourceId: string): boolean => sourceFamily(sourceId) === 'aniyomi';

/**
 * An Aniyomi source's names for the calls a Mihon one answers (doc/EXTENSION-ENGINE.md,
 * "the anime ones are the same with Anime/Episode"): BROWSE, search and the
 * settings ask a source the same questions whichever kind it is.
 */
const ANIME_METHOD: Record<string, string> = {
	getPopularManga: 'getPopularAnime',
	getLatestManga: 'getLatestAnime',
	getSearchManga: 'getSearchAnime',
	getDetailsManga: 'getDetailsAnime',
	getMangaUrl: 'getAnimeUrl',
	getChapterList: 'getEpisodeList',
	supportLatestManga: 'supportLatestAnime',
	filterSchemaManga: 'filterSchemaAnime',
	preferencesManga: 'preferencesAnime',
	setPreferenceManga: 'setPreferenceAnime',
	headersManga: 'headersAnime'
};

export async function callSource<T>(
	sourceId: string,
	method: string,
	args: Record<string, unknown>,
	timeoutMs?: number
): Promise<T> {
	const ext = extensionFor(sourceId);
	if (!ext) throw new EngineError('No installed extension has this source', 'not-found');
	const opts = { sourceId, preferences: preferences(sourceId), timeoutMs };
	if (!isAnimeSource(sourceId) || !(method in ANIME_METHOD))
		return call<T>(ext, method, args, opts);
	// An anime is a manga's shape (url, title, thumbnail_url…), carried as animeData.
	const { mangaData, ...rest } = args;
	const got = await call<unknown>(
		ext,
		ANIME_METHOD[method],
		mangaData === undefined ? rest : { ...rest, animeData: mangaData },
		opts
	);
	// A page of anime is `animes`, where a manga page is `mangas`.
	if (got && typeof got === 'object' && 'animes' in got) {
		const { animes, ...page } = got as { animes: unknown };
		return { ...page, mangas: animes ?? [] } as T;
	}
	return got as T;
}

export const sourceName = (sourceId: string) =>
	(
		db().prepare(`SELECT name FROM engine_sources WHERE id = ?`).get(sourceId) as
			{ name: string } | undefined
	)?.name ?? '';

/**
 * A source's results as the screens show them: matched against the library
 * (IN LIBRARY, SAME TITLE), a hidden series left out while reveal is off, and
 * a result the source repeats shown once. Search and BROWSE both answer this.
 */
export function asHits(
	sourceId: string,
	mangas: EngineManga[],
	reveal: boolean,
	query = ''
): SearchHit[] {
	const { byKey, sameTitle, nameable } = libraryIndex(reveal);
	// An anime result is in the library by its own key (doc/ANIME.md).
	const anime = isAnimeSource(sourceId);
	const seen = new Set<string>();
	const out: SearchHit[] = [];
	for (const m of mangas) {
		const url = splitMemo(m.url).url;
		if (seen.has(url)) continue;
		seen.add(url);
		const key = anime ? animeKeyOf(sourceId, url) : keyOf(sourceId, url);
		const mine = byKey.get(key);
		if (mine?.hidden && !reveal) continue;
		const other = sameTitle(key, m.title);
		const match: ResultMatch = mine
			? {
					kind: 'in-library',
					seriesId: mine.id,
					meta: `${mine.have.toLocaleString('en-US')} OF ${mine.total.toLocaleString('en-US')} DOWNLOADED`,
					hidden: !!mine.hidden
				}
			: other && other !== sourceId
				? { kind: 'same-title', source: nameable(other) ? sourceName(other).toUpperCase() : '' }
				: { kind: 'new' };
		rememberTitle(sourceMangaId(sourceId, m.url), m.title);
		out.push({
			mangaId: sourceMangaId(sourceId, m.url),
			title: m.title,
			parts: highlight(m.title, query),
			// An anime source may give its site's picture rather than the engine's
			// proxy: fetched by the server all the same, never by the browser.
			cover: imageRoute(m.thumbnail_url) || (anime ? coverRoute(m.thumbnail_url) : ''),
			meta: [m.author?.toUpperCase(), STATUS[m.status ?? 0]].filter(Boolean).join(' · '),
			match
		});
	}
	return out;
}

/** One source's answer to a query. */
export async function searchSource(
	sourceId: string,
	query: string,
	reveal: boolean
): Promise<SearchHit[]> {
	const page = await callSource<{ mangas: EngineManga[] }>(
		sourceId,
		'getSearchManga',
		{ page: 1, search: query },
		45_000
	);
	return asHits(sourceId, page.mangas, reveal, query);
}

type EngineChapter = {
	url: string;
	name: string;
	scanlator?: string | null;
	chapter_number: number;
	date_upload?: number | null;
};

/** The titles hits were listed under, for a source whose details forget theirs. */
const hitTitles = new Map<string, string>();
function rememberTitle(id: string, title: string | null | undefined) {
	if (!title?.trim()) return;
	hitTitles.delete(id);
	hitTitles.set(id, title.trim());
	if (hitTitles.size > 5000) hitTitles.delete(hitTitles.keys().next().value!);
}

/** A result in full, its chapters numbered as Mihon numbers them (the source gives -1). */
export async function sourceManga(id: string): Promise<SourceManga | null> {
	const ref = parseSourceMangaId(id);
	if (!ref) return null;
	const details = await callSource<EngineManga>(
		ref.sourceId,
		'getDetailsManga',
		{ mangaData: { url: ref.url } },
		45_000
	);
	const url = details.url || ref.url;
	const chapters = await callSource<EngineChapter[]>(
		ref.sourceId,
		'getChapterList',
		{ mangaData: { ...details, url } },
		45_000
	);
	const numbers = chapterNumbers(
		details.title || hitTitles.get(id) || '',
		chapters.map((c) => ({ name: c.name, number: c.chapter_number }))
	);
	const source = db()
		.prepare(`SELECT name, lang FROM engine_sources WHERE id = ?`)
		.get(ref.sourceId) as { name: string; lang: string } | undefined;
	const now = Date.now();
	return {
		id,
		// Some 1.6 sources answer their details with a blank title (Mangahere's, for
		// one): the title its hit showed, else
		// the address's own words.
		title: details.title?.trim() || hitTitles.get(id) || titleFromPath(splitMemo(url).url),
		description: details.description ?? '',
		author: details.author ?? '',
		artist: details.artist ?? '',
		genres: (details.genre ?? '')
			.split(',')
			.map((g) => g.trim())
			.filter(Boolean),
		status: STATUS_NAME[details.status ?? 0] ?? '',
		source: source?.name ?? '',
		sourceId: ref.sourceId,
		url,
		inLibrary: false,
		thumbnailUrl: details.thumbnail_url ?? '',
		cover: imageRoute(details.thumbnail_url),
		realUrl: '',
		lang: (source?.lang ?? '').toUpperCase(),
		chapters: chapters.map((c, i) => ({
			id: String(i),
			url: c.url,
			name: c.name,
			number: numbers[i].chapter === null ? -1 : toNumber(numbers[i].chapter!),
			scanlator: c.scanlator ?? '',
			sourceOrder: i,
			uploadDate: c.date_upload ?? 0,
			fetchedAt: now
		}))
	};
}

export class AddError extends Error {}

/** A preview as Mihon's backup would carry it: what the planner reads. Keys never carry a memo. */
function asMihon(m: SourceManga): MihonManga {
	return {
		source: m.sourceId,
		url: splitMemo(m.url).url,
		title: m.title,
		artist: m.artist,
		author: m.author,
		description: m.description,
		genres: m.genres,
		status: Math.max(0, STATUS_NAME.indexOf(m.status)),
		thumbnailUrl: '',
		dateAdded: null,
		viewer: 0,
		chapters: m.chapters.map((c) => ({
			url: splitMemo(c.url).url,
			name: c.name,
			scanlator: c.scanlator,
			read: false,
			bookmark: false,
			lastPageRead: 0,
			dateFetch: c.fetchedAt,
			dateUpload: c.uploadDate,
			number: c.number,
			sourceOrder: c.sourceOrder
		})),
		categories: [],
		favorite: true,
		history: [],
		trackers: []
	};
}

/** Remembers what the source calls a series and its chapters, so the worker needn't ask again. */
function rememberAtSource(seriesId: number, m: SourceManga, now: number) {
	const d = db();
	d.prepare(
		`INSERT INTO engine_series (series_id, source_id, engine_url, title, resolved_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (series_id) DO UPDATE SET engine_url = excluded.engine_url, resolved_at = excluded.resolved_at`
	).run(seriesId, m.sourceId, m.url, m.title, now);
	const byUrl = new Map(
		(
			d.prepare(`SELECT id, source_url FROM entries WHERE series_id = ?`).all(seriesId) as {
				id: number;
				source_url: string;
			}[]
		).map((e) => [e.source_url, e.id])
	);
	const put = d.prepare(
		`INSERT OR REPLACE INTO engine_chapters (entry_id, engine_url, name) VALUES (?, ?, ?)`
	);
	for (const c of m.chapters) {
		const id = byUrl.get(splitMemo(c.url).url);
		if (id) put.run(id, c.url, c.name);
	}
}

/**
 * ADD TO LIBRARY: into tsundoku's library at once, every chapter NOT
 * DOWNLOADED, by the Mihon importer's own plan and writer. A browsing record
 * of it becomes the library's, its place kept. With `browsing`, a chapter
 * opened from the preview without ADD (doc/READING-ONLINE.md): a record, or the
 * library's series when it has one.
 */
export async function addToLibrary(
	id: string,
	now = Date.now(),
	browsing = false
): Promise<number> {
	const quick = mangaKey(id);
	// Held by a series or by a book in a group: never added twice.
	const known = quick ? seriesHolding(quick, db()) : null;
	if (known) return keepOrPromote(known, browsing, now, db());
	const m = await sourceManga(id);
	if (!m) throw new AddError('That series isn’t at its source');
	const key = keyOf(m.sourceId, splitMemo(m.url).url);
	const existing = seriesHolding(key, db());
	if (existing) return keepOrPromote(existing, browsing, now, db());
	// A library with no Mihon folder yet (a friend's new install, doc/READING-ONLINE.md):
	// the root a scan of `Mihon/` would make, made now, so the first ADD or
	// online read works, rather than refusing.
	const rootId =
		mihonRoot() ?? ensureNamedRoot(db(), 'Mihon', join(dataPaths().library, 'Mihon'), false);
	const plan = planMihon(
		{ manga: [asMihon(m)], categories: [], sources: new Map([[m.sourceId, m.source]]) },
		[],
		now
	).series[0];
	const engineUrl = process.env.ENGINE_URL?.replace(/\/$/, '');
	plan.coverUrl =
		m.cover && engineUrl
			? `${engineUrl}${m.cover.replace('/api/downloads/engine-image/', '/image/')}`
			: undefined;
	writeSeries(plan, { rootId, jobId: null, now, browsing });
	const row = db().prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key) as
		{ id: number } | undefined;
	if (!row) {
		const buried = db().prepare(`SELECT 1 FROM tombstones WHERE key = ?`).get(key);
		throw new AddError(
			buried
				? 'that series was deleted here once, and stays gone'
				: 'its chapters are already in another series here'
		);
	}
	if (!browsing) {
		db().prepare(`UPDATE series SET arrived_at = ? WHERE id = ?`).run(now, row.id);
		// ADD from a source that adds hidden: it starts hidden.
		hideIfAddedHidden(row.id, db());
	}
	rememberAtSource(row.id, m, now);
	if (!browsing) forgetSourceUse();
	void refreshCovers({ ids: [row.id], remote: true });
	return row.id;
}

/** UNDO after adding, while nothing of it is downloaded or read. Not a delete: it can be added again. */
export function undoAdd(seriesId: number): boolean {
	const d = db();
	const touched = d
		.prepare(
			`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND (available = 1 OR read_at IS NOT NULL)`
		)
		.get(seriesId) as { n: number };
	if (touched.n > 0) return false;
	d.prepare(`DELETE FROM series WHERE id = ?`).run(seriesId);
	forgetSourceUse();
	return true;
}

/** The key a result would have here, for opening the series instead of its preview. */
export function mangaKey(id: string): string | null {
	const ref = parseSourceMangaId(id);
	return ref ? keyOf(ref.sourceId, splitMemo(ref.url).url) : null;
}

// ---- FOLLOW ------------------------------------------------------------------------------------

/** FOLLOW and FOLLOWING ✓: followed from now on; the source is asked at once, so the next check has a baseline. */
export function setFollowed(seriesId: number, on: boolean, now = Date.now()): void {
	const s = db().prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null } | undefined;
	const key = parseKey(s?.origin_key ?? null);
	if (!key || !extensionFor(key.sourceId))
		throw new EngineError('only a series from an installed source can be followed', 'not-found');
	db()
		.prepare(`UPDATE series SET followed_at = ? WHERE id = ?`)
		.run(on ? now : null, seriesId);
	if (on) resolveLater(seriesId, true);
}

/** How often a followed series' source is asked for new chapters. */
const FOLLOW_EVERY = 6 * 60 * 60 * 1000;

/** A chapter the source lists that no entry was: what FOLLOW queues, and REFRESH counts. */
export type Arrived = { id: number; url: string; fetchedAt: number; downloaded: boolean };

/**
 * The entries a source's new chapters became, through the importers' one
 * writer and the Mihon plan ADD uses, so everything the user set on the
 * series stays. What FOLLOW queues, and what REFRESH only counts:
 * it downloads nothing. Null when the series isn't from a source with an
 * installed extension, or its source lists nothing new.
 */
export async function addNewChapters(
	seriesId: number,
	now = Date.now(),
	d: Database.Database = db()
): Promise<{ arrived: Arrived[]; read: Set<string> } | null> {
	const s = d
		.prepare(`SELECT id, root_id, title, alt_titles, origin_key FROM series WHERE id = ?`)
		.get(seriesId) as
		| { id: number; root_id: number; title: string; alt_titles: string; origin_key: string | null }
		| undefined;
	const key = parseKey(s?.origin_key ?? null);
	if (!s || !key || !extensionFor(key.sourceId)) return null;
	const fresh: EngineChapter[] = await resolveSeries(seriesId, { db: d, now: () => now }, true);
	if (fresh.length === 0) return null;
	// Read under every name the series has had: one new chapter named
	// "Squad 100 4" by a series renamed from Squad 100 was chapter 100.
	const numbers = numbersUnderNames(
		namesOf(s.title, s.alt_titles),
		fresh.map((c) => ({ name: c.name, number: c.chapter_number }))
	);
	const manga: MihonManga = {
		...asMihon({
			id: '',
			title: s.title,
			description: '',
			author: '',
			artist: '',
			genres: [],
			status: '',
			source: sourceName(key.sourceId),
			sourceId: key.sourceId,
			url: key.url,
			inLibrary: true,
			thumbnailUrl: '',
			cover: '',
			realUrl: '',
			lang: '',
			chapters: fresh.map((c, i) => ({
				id: String(i),
				url: c.url,
				name: c.name,
				number: numbers[i].chapter === null ? -1 : toNumber(numbers[i].chapter!),
				scanlator: c.scanlator ?? '',
				sourceOrder: i,
				uploadDate: c.date_upload ?? 0,
				fetchedAt: now
			}))
		})
	};
	const plan = planMihon(
		{
			manga: [manga],
			categories: [],
			sources: new Map([[key.sourceId, sourceName(key.sourceId)]])
		},
		[],
		now
	).series[0];
	// Only the new chapters: everything the user set on the series stays, as the writer keeps it.
	writeSeries(plan, { rootId: s.root_id, jobId: null, now, markMissing: false }, d);
	const ids = new Map(
		(
			d.prepare(`SELECT id, source_url, read_at FROM entries WHERE series_id = ?`).all(s.id) as {
				id: number;
				source_url: string;
				read_at: number | null;
			}[]
		).map((e) => [e.source_url, e])
	);
	const put = d.prepare(
		`INSERT OR REPLACE INTO engine_chapters (entry_id, engine_url, name) VALUES (?, ?, ?)`
	);
	const arrived: Arrived[] = [];
	const read = new Set<string>();
	for (const c of fresh) {
		const url = splitMemo(c.url).url;
		const e = ids.get(url);
		if (!e) continue;
		put.run(e.id, c.url, c.name);
		arrived.push({ id: e.id, url, fetchedAt: now, downloaded: false });
		if (e.read_at !== null) read.add(url);
	}
	return { arrived, read };
}

/**
 * Queue what's new in every followed series, run every ten minutes by the
 * import timer (POST /api/downloads/follow). Each series is asked every six
 * hours, so a run asks a few, not the whole followed list at once. A chapter
 * the source lists that no entry is becomes one (the Mihon importer's plan
 * and writer, as ADD does), and is queued unless read, at most fifty a
 * series a run, as followQueue rules.
 */
export async function followNew(now = Date.now()): Promise<{ series: number; queued: number }> {
	const d = db();
	const due = d
		.prepare(
			`SELECT s.id, s.root_id, s.title, s.origin_key, s.followed_at FROM series s
			LEFT JOIN engine_series es ON es.series_id = s.id
			WHERE s.followed_at IS NOT NULL AND (es.resolved_at IS NULL OR es.resolved_at < ?)`
		)
		.all(now - FOLLOW_EVERY) as {
		id: number;
		root_id: number;
		title: string;
		origin_key: string;
		followed_at: number;
	}[];
	let queued = 0;
	for (const s of due) {
		let got: Awaited<ReturnType<typeof addNewChapters>>;
		try {
			got = await addNewChapters(s.id, now, d);
		} catch {
			continue;
		}
		if (!got) continue;
		const pick = followQueue(
			got.arrived,
			s.followed_at,
			new Set(queue.queueRows().map((r) => r.entryId)),
			got.read
		);
		queued += queue.enqueue(pick, now, d);
	}
	return { series: due.length, queued };
}
