import * as engine from './engine/backend.ts';
import { engineConfigured, engineDownSince, EngineError } from './engine/client.ts';
import { getSetting } from './settings.ts';
import { getDb } from './db.ts';
import { splitMemo } from './engine/protocol.ts';
import {
	allToDownload,
	keyFamily,
	nextToDownload,
	parseAnimeKey,
	parseKey,
	parseNovelKey,
	rowAction,
	type DownloadState
} from '../library/downloads.ts';
import * as novels from './novels/source.ts';
import * as novelDownloads from './novels/downloader.ts';
import * as novelFollow from './novels/follow.ts';
import * as anime from './engine/anime-source.ts';
import * as animeDownloads from './anime/download.ts';
import * as animeFollow from './anime/follow.ts';
import { NovelHostError } from './novels/host.ts';
import type { SeriesDownloads } from './download-types.ts';
import type { SourceFamily } from '../library/kinds.ts';
import { followOrigin } from './season-facts.ts';
import { whileAdding } from './engine/adding.ts';

/**
 * What the download screens ask (doc/DOWNLOADING.md, doc/DOWNLOADER.md):
 * tsundoku's own engine, through engine/backend.ts. This face is what the
 * routes import, so a screen never reaches into the engine directly. It chose
 * between Suwayomi and the engine until Suwayomi was retired (card c129,
 * 2026-10-28). A chapter id is tsundoku's entry id; a source manga's id is
 * the source and URL, opaque to the screens. A novel source (`ln:<plugin>`,
 * doc/NOVELS.md) answers the same questions through novels/source.ts.
 */

export type {
	Queue,
	QueueSummary,
	SeriesDownloads,
	SearchHit,
	SourceManga
} from './download-types.ts';
export { seriesForKey, arrivedSince } from './library-sources.ts';

/** Whether downloading is set up here at all: no DOWNLOAD row, QUEUE cell or DOWNLOADS without it. */
export const configured = () => engineConfigured();
export const notAnsweringSince = () => engineDownSince();

/** A refusal the screens band rather than an error page: the engine not answering, or not knowing. */
export const isDownloadsError = (e: unknown) =>
	e instanceof EngineError || e instanceof NovelHostError || e instanceof novels.NovelSourceError;
export const isAddError = (e: unknown) =>
	e instanceof engine.AddError || e instanceof novels.NovelAddError || isDownloadsError(e);

/** A series' source family, by its key (`keyFamily`); null when it has none. */
function seriesFamily(seriesId: number): SourceFamily | null {
	return keyFamily(followOrigin(seriesId).key);
}

/** One answer per downloader, and one for a series no family's downloader takes. */
type ByDownloader<T> = Record<SourceFamily, () => T> & { none: () => T };

/**
 * Which downloader takes a series (doc/DOWNLOADING.md; card c303): its key's
 * family, never its kind's name. An LNReader key is the novel downloader's
 * (novels/downloader.ts), an Aniyomi key the episode downloader's
 * (anime/download.ts), a Mihon key the engine's. **No family** (Hentoid's
 * `hentoid:`/`hentoid-dir:`, a folder's `mihon-dir:`, an EPUB's, no key) is
 * a case of its own, answered by `none`: today every caller sends it to the
 * engine too, which says `none` for its row and refuses FOLLOW, as it did
 * before the family was asked.
 */
function byDownloader<T>(seriesId: number, ways: ByDownloader<T>): T {
	const family = seriesFamily(seriesId);
	return family ? ways[family]() : ways.none();
}

export const queue = async () => engine.engineQueue();
export const queueSummary = async (reveal: boolean) => engine.queueSummary(reveal);
export const seriesDownloads = async (
	seriesId: number,
	entries: { id: number; available: boolean }[]
): Promise<SeriesDownloads> => {
	const fromEngine = () => engine.seriesDownloads(seriesId, entries);
	const d = byDownloader(seriesId, {
		lnreader: () => novelDownloads.novelSeriesDownloads(seriesId, entries),
		aniyomi: () => animeDownloads.animeSeriesDownloads(seriesId, entries),
		mihon: fromEngine,
		none: fromEngine
	});
	// REFRESH (card c220): the row offers it wherever the series has a source to
	// ask and is in the library. A folder-scanned series has nothing to ask, and
	// a browsing record is not kept.
	if (d.kind !== 'ok') return d;
	const row = getDb().prepare(`SELECT in_library FROM series WHERE id = ?`).get(seriesId) as
		{ in_library: number } | undefined;
	return {
		...d,
		// The key REFRESH would ask (`refreshSeries`), so the row never offers what it can't do.
		refreshable: !!row?.in_library && keyFamily(followOrigin(seriesId).key) !== null
	};
};

/** [height]: an anime's episodes at a quality of their own (ALL's QUALITY); SETTINGS' otherwise. */
export const enqueue = async (
	seriesId: number,
	entryIds: number[],
	height: number | null = null
) => {
	// A browsing record (doc/BROWSING.md) downloads nothing: ADD comes first.
	if (!inLibrary(seriesId)) return { queued: 0, missing: entryIds.length };
	// A quality of its own is the episode downloader's alone.
	if (height !== null && seriesFamily(seriesId) === 'aniyomi')
		animeDownloads.rememberQuality(entryIds, height);
	return engine.enqueue(seriesId, entryIds);
};
/**
 * DOWNLOAD's NEXT 10, ALL N, or chosen chapters, on a library series, or the
 * end page's DOWNLOAD FIRST 10 (`first`): each chapter decided again from
 * what the queue says now, a file-less one queued and a failed one retried,
 * anything else left alone. The series screen's
 * DOWNLOAD and a preview's ADD AND DOWNLOAD (card c205) both come here, so
 * the two can't count differently. Null when the series has nothing to
 * download from; a DownloadsError when the engine doesn't answer.
 */
export async function queueSeries(
	seriesId: number,
	entries: Parameters<typeof nextToDownload>[0],
	which: 'next' | 'all' | 'first' | number[],
	quality: number | null = null
): Promise<{ queued: number; missing: number; already: number } | null> {
	const d = await seriesDownloads(seriesId, entries);
	if (d.kind === 'down') throw new EngineError('Downloading is not answering', 'down');
	if (d.kind !== 'ok') return null;
	const states = new Map(Object.entries(d.states).map(([k, v]) => [Number(k), v as DownloadState]));
	const ids =
		which === 'next'
			? nextToDownload(entries, states)
			: which === 'all'
				? allToDownload(entries, states)
				: which === 'first'
					? firstUnread(entries)
					: which;
	const fresh = ids.filter((id) => rowAction(states.get(id)) === 'queue');
	const failed = ids
		.map((id) => states.get(id))
		.flatMap((st) => (st?.kind === 'failed' ? [st.chapterId] : []));
	const result = fresh.length ? await enqueue(seriesId, fresh, quality) : { queued: 0, missing: 0 };
	await retry(failed);
	// What was asked for and is already under way (c534): a second press, or one
	// after a reload while the first chapter downloads, queues nothing new, and
	// that is not a failure. NEXT and ALL ask for every unread chapter; FIRST
	// and chosen ones for themselves. A downloaded chapter is not counted: it
	// is no queue.
	const asked =
		which === 'next' || which === 'all'
			? entries.filter((e) => e.readAt === null && !e.matter).map((e) => e.id)
			: ids;
	const already = asked.filter((id) => underWay(states.get(id))).length;
	return { queued: result.queued + failed.length, missing: result.missing, already };
}

/**
 * The end page's DOWNLOAD FIRST 10 (c534, round 2): the part's first [n]
 * unread chapters in reading order, whatever their download state. NEXT 10
 * skips what is under way, so a press after a reload, while the first ten
 * still download, would have queued the next ten as well: twenty for a press
 * that names ten. These ten are the same ten on every press, and the ones
 * already under way are counted as `already`, not asked for again.
 */
const firstUnread = (entries: Parameters<typeof nextToDownload>[0], n = 10) =>
	entries
		.filter((e) => e.readAt === null && !e.matter)
		.slice(0, n)
		.map((e) => e.id);

/** Queued, downloading, or downloaded and waiting to be imported: in hand, not to ask for again. */
const underWay = (s: DownloadState | undefined) =>
	s?.kind === 'queued' || s?.kind === 'downloading' || s?.kind === 'importing';
export const retry = async (ids: number[]) => engine.retry(ids);
export const dequeue = async (ids: number[]) => engine.dequeue(ids);
export const toTheTop = async (ids: number[]) => engine.toTheTop(ids);
export const setPaused = async (paused: boolean) => engine.setPaused(paused);
/** When the queue was paused from tsundoku; null while it runs. */
export function pausedAt(): number | null {
	const v = Number(getSetting('downloads_paused_at'));
	return v > 0 ? v : null;
}

export const searchSources = async (reveal: boolean) => [
	...engine.searchSources(reveal),
	...novels.novelSearchSources(reveal)
];
export const searchSource = async (sourceId: string, query: string, reveal: boolean) =>
	novels.isNovelSource(sourceId)
		? novels.novelSearch(sourceId, query, reveal)
		: engine.searchSource(sourceId, query, reveal);

/** The source a result is from, by BROWSE's id for it; null for an id that isn't a result's. */
export function sourceOfMangaId(id: string): string | null {
	return novels.parseNovelMangaId(id)?.sourceId ?? engine.parseSourceMangaId(id)?.sourceId ?? null;
}
export const isSourceMangaId = (id: string) => sourceOfMangaId(id) !== null;
/** Whether a result is an Aniyomi source's anime (doc/ANIME.md). */
const isAnimeId = (id: string) => {
	const ref = engine.parseSourceMangaId(id);
	return ref !== null && engine.isAnimeSource(ref.sourceId);
};
export const sourceManga = async (id: string) =>
	novels.parseNovelMangaId(id)
		? novels.novelManga(id)
		: isAnimeId(id)
			? anime.animeManga(id)
			: engine.sourceManga(id);
export const mangaKey = async (id: string) =>
	novels.parseNovelMangaId(id)
		? novels.novelMangaKey(id)
		: isAnimeId(id)
			? anime.animeKey(id)
			: engine.mangaKey(id);
/**
 * ADD, whichever family the result is (the preview's, and each series of a
 * SELECT press: card c868). While it runs the result is marked as being added
 * (`whileAdding`), so a source's page draws it ADDING and a press skips it.
 */
export const addToLibrary = (id: string): Promise<number> =>
	whileAdding(id, () =>
		novels.parseNovelMangaId(id)
			? novels.addNovel(id)
			: isAnimeId(id)
				? anime.addAnime(id)
				: engine.addToLibrary(id)
	);
export const undoAdd = async (seriesId: number) => engine.undoAdd(seriesId);

/** A chapter's or episode's address as its entry keeps it: without the engine's memo. */
export const entryKey = (url: string) => splitMemo(url).url;

/** A series' preview at its source, by its key: where a browsing record lives (doc/BROWSING.md). */
export function previewIdOf(originKey: string | null): string | null {
	const novel = parseNovelKey(originKey);
	if (novel) return novels.novelMangaId(`ln:${novel.plugin}`, novel.path);
	const at = parseAnimeKey(originKey) ?? parseKey(originKey);
	return at ? engine.sourceMangaId(at.sourceId, at.url) : null;
}

/** Whether a series is the library's, not a browsing record (doc/BROWSING.md). */
function inLibrary(seriesId: number): boolean {
	const r = getDb().prepare(`SELECT in_library FROM series WHERE id = ?`).get(seriesId) as
		{ in_library: number } | undefined;
	return r?.in_library === 1;
}

/**
 * Opens one of a preview's episodes or chapters without ADD (doc/BROWSING.md;
 * cards c161, c166): the entry to play or read online, in a browsing record
 * unless the series is the library's. Novels are null until they read online.
 */
export async function openFromSource(id: string, url: string): Promise<number | null> {
	const seriesId = novels.parseNovelMangaId(id)
		? await novels.addNovel(id, Date.now(), true)
		: isAnimeId(id)
			? await anime.browseAnime(id)
			: await engine.addToLibrary(id, Date.now(), true);
	const row = getDb()
		.prepare(`SELECT id FROM entries WHERE series_id = ? AND source_url IN (?, ?) LIMIT 1`)
		.get(seriesId, url, splitMemo(url).url) as { id: number } | undefined;
	return row?.id ?? null;
}
export const setFollowed = async (seriesId: number, on: boolean) => {
	if (on && !inLibrary(seriesId))
		throw new EngineError('only a series in the library can be followed', 'not-found');
	const engineFollows = () => engine.setFollowed(seriesId, on);
	return byDownloader(seriesId, {
		lnreader: () => novelFollow.setNovelFollowed(seriesId, on),
		aniyomi: () => animeFollow.setAnimeFollowed(seriesId, on),
		mihon: engineFollows,
		none: engineFollows
	});
};
/**
 * FOLLOW's step: the engine's followed manga and anime and the plugins'
 * followed novels, each whatever the others did, so an engine that stopped
 * answering doesn't keep novels from being asked.
 */
export async function followNew() {
	const done = await Promise.allSettled([
		engine.followNew(),
		novelFollow.followNovels(),
		animeFollow.followAnime()
	]);
	const failed = done.find((d) => d.status === 'rejected');
	if (failed) throw failed.reason;
	const all = done.map(
		(d) => (d as PromiseFulfilledResult<{ series: number; queued: number }>).value
	);
	return all.reduce((a, b) => ({ series: a.series + b.series, queued: a.queued + b.queued }));
}
