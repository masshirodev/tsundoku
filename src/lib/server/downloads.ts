import * as engine from './engine/backend.ts';
import { engineConfigured, engineDownSince, EngineError } from './engine/client.ts';
import { getSetting } from './settings.ts';
import * as novels from './novels/source.ts';
import * as novelDownloads from './novels/downloader.ts';
import * as novelFollow from './novels/follow.ts';
import * as anime from './engine/anime-source.ts';
import { NovelHostError } from './novels/host.ts';

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

export const queue = async () => engine.engineQueue();
export const queueSummary = async (reveal: boolean) => engine.queueSummary(reveal);
export const seriesDownloads = async (
	seriesId: number,
	entries: { id: number; available: boolean }[]
) =>
	novelDownloads.isNovelSeries(seriesId)
		? novelDownloads.novelSeriesDownloads(seriesId, entries)
		: engine.seriesDownloads(seriesId, entries);

export const enqueue = async (seriesId: number, entryIds: number[]) =>
	engine.enqueue(seriesId, entryIds);
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
export const addToLibrary = async (id: string) =>
	novels.parseNovelMangaId(id)
		? novels.addNovel(id)
		: isAnimeId(id)
			? anime.addAnime(id)
			: engine.addToLibrary(id);
export const undoAdd = async (seriesId: number) => engine.undoAdd(seriesId);
export const setFollowed = async (seriesId: number, on: boolean) =>
	novelDownloads.isNovelSeries(seriesId)
		? novelFollow.setNovelFollowed(seriesId, on)
		: engine.setFollowed(seriesId, on);
/**
 * FOLLOW's step: the engine's followed manga and the plugins' followed
 * novels, each whatever the other did, so an engine that stopped answering
 * doesn't keep novels from being asked.
 */
export async function followNew() {
	const done = await Promise.allSettled([engine.followNew(), novelFollow.followNovels()]);
	const failed = done.find((d) => d.status === 'rejected');
	if (failed) throw failed.reason;
	const [manga, novels] = done.map(
		(d) => (d as PromiseFulfilledResult<{ series: number; queued: number }>).value
	);
	return { series: manga.series + novels.series, queued: manga.queued + novels.queued };
}
