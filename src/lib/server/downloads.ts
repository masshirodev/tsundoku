import * as suwayomi from './suwayomi.ts';
import * as suwayomiLibrary from './suwayomi-library.ts';
import * as engine from './engine/backend.ts';
import { engineDownSince, EngineError } from './engine/client.ts';
import { downloadsBackend } from './engine/run.ts';

/**
 * What the download screens ask, whichever backend answers
 * (doc/DOWNLOADER.md, "The switch"): Suwayomi's (suwayomi.ts,
 * suwayomi-library.ts) or tsundoku's own engine's (engine/backend.ts),
 * chosen by DOWNLOADS_BACKEND. Both answer in the same types, so the screens
 * don't know which. A chapter id is Suwayomi's chapter id or tsundoku's entry
 * id, and a source manga's id an opaque string, as the backend gave them.
 */

export type { Queue, QueueSummary, SeriesDownloads } from './suwayomi.ts';
export type { SearchHit, SourceManga } from './suwayomi-library.ts';
export { seriesForKey, arrivedSince } from './suwayomi.ts';

const onEngine = () => downloadsBackend() === 'engine';

/** Whether downloading is set up here at all: no DOWNLOAD row, QUEUE cell or DOWNLOADS without it. */
export const configured = () => onEngine() || suwayomi.configured();

export const notAnsweringSince = () =>
	onEngine() ? engineDownSince() : suwayomi.notAnsweringSince();

/** A refusal the screens band rather than an error page: the backend not answering, or not knowing. */
export const isDownloadsError = (e: unknown) =>
	e instanceof suwayomi.SuwayomiError || e instanceof EngineError;
export const isAddError = (e: unknown) =>
	e instanceof suwayomiLibrary.AddError || e instanceof engine.AddError || isDownloadsError(e);

export const queue = async (timeoutMs?: number) =>
	onEngine() ? engine.engineQueue() : suwayomi.queue(timeoutMs);
export const forget = () => (onEngine() ? undefined : suwayomi.forget());

export const queueSummary = async (reveal: boolean) =>
	onEngine() ? engine.queueSummary(reveal) : suwayomi.queueSummary(reveal);

export const seriesDownloads = async (
	seriesId: number,
	entries: { id: number; available: boolean }[]
) =>
	onEngine()
		? engine.seriesDownloads(seriesId, entries)
		: suwayomi.seriesDownloads(seriesId, entries);

export const enqueue = async (seriesId: number, entryIds: number[]) =>
	onEngine() ? engine.enqueue(seriesId, entryIds) : suwayomi.enqueue(seriesId, entryIds);

export const retry = async (ids: number[]) =>
	onEngine() ? engine.retry(ids) : suwayomi.retry(ids);
export const dequeue = async (ids: number[]) =>
	onEngine() ? engine.dequeue(ids) : suwayomi.dequeue(ids);
export const toTheTop = async (ids: number[]) =>
	onEngine() ? engine.toTheTop(ids) : suwayomi.toTheTop(ids);
export const setPaused = async (paused: boolean) =>
	onEngine() ? engine.setPaused(paused) : suwayomi.setPaused(paused);
export const pausedAt = () => suwayomi.pausedAt();

export const searchSources = async (reveal: boolean) =>
	onEngine() ? engine.searchSources(reveal) : suwayomiLibrary.searchSources(reveal);

export const searchSource = async (sourceId: string, query: string, reveal: boolean) =>
	onEngine()
		? engine.searchSource(sourceId, query, reveal)
		: suwayomiLibrary.searchSource(sourceId, query, reveal);

/** A source manga's id as the backend made it; null when it isn't one of its ids. */
function suwayomiId(id: string): number | null {
	const n = Number(id);
	return Number.isInteger(n) && n > 0 ? n : null;
}

export const isSourceMangaId = (id: string) =>
	onEngine() ? engine.parseSourceMangaId(id) !== null : suwayomiId(id) !== null;

export const sourceManga = async (id: string) => {
	if (onEngine()) return engine.sourceManga(id);
	const n = suwayomiId(id);
	return n === null ? null : suwayomiLibrary.sourceManga(n);
};

export const mangaKey = async (id: string) => {
	if (onEngine()) return engine.mangaKey(id);
	const n = suwayomiId(id);
	return n === null ? null : suwayomiLibrary.mangaKey(n);
};

export const addToLibrary = async (id: string) => {
	if (onEngine()) return engine.addToLibrary(id);
	const n = suwayomiId(id);
	if (n === null) throw new suwayomiLibrary.AddError('not a series Suwayomi knows');
	return suwayomiLibrary.addToLibrary(n);
};

export const undoAdd = async (seriesId: number) =>
	onEngine() ? engine.undoAdd(seriesId) : suwayomiLibrary.undoAdd(seriesId);

export const setFollowed = async (seriesId: number, on: boolean) =>
	onEngine() ? engine.setFollowed(seriesId, on) : suwayomiLibrary.setFollowed(seriesId, on);

export const followNew = async () =>
	onEngine() ? engine.followNew() : suwayomiLibrary.followNew();
