import { getDb } from './db.ts';
import { getSetting, setSetting } from './settings.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { suwayomiAuth } from './suwayomi-auth.ts';
import {
	chapterStates,
	queueView,
	keyOf,
	parseKey,
	type DownloadState,
	type QueueItem,
	type QueueSeries,
	type SourceChapter
} from '../library/downloads.ts';

/**
 * tsundoku asking Suwayomi-Server (doc/DOWNLOADING.md, "From tsundoku"): what
 * a series has, what's queued, and to download. The screens are tsundoku's,
 * and this is the only thing that talks to Suwayomi on their behalf; it does so
 * on localhost, with the login Suwayomi asks for since it went on the tailnet.
 *
 * Off unless `SUWAYOMI_URL` is set, so a checkout without Suwayomi (and the
 * e2e build) draws no DOWNLOAD row at all rather than one that never answers.
 */

export const configured = () => !!process.env.SUWAYOMI_URL;
const server = () => process.env.SUWAYOMI_URL ?? '';

/** When Suwayomi stopped answering, for "○ NOT ANSWERING · SINCE 14:02". Null while it answers. */
let downSince: number | null = null;
export const notAnsweringSince = () => downSince;

export class SuwayomiError extends Error {}

export async function gql<T>(
	query: string,
	variables: Record<string, unknown> = {},
	timeoutMs = 4000
): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${server()}/api/graphql`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...suwayomiAuth(server()) },
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (e) {
		downSince ??= Date.now();
		throw new SuwayomiError(`Suwayomi is not answering (${(e as Error).message})`);
	}
	const body = (await res.json().catch(() => ({}))) as {
		data?: T;
		errors?: { message: string }[];
	};
	if (!res.ok || !body.data) {
		if (res.status >= 500) downSince ??= Date.now();
		throw new SuwayomiError(body.errors?.[0]?.message ?? `Suwayomi answered ${res.status}`);
	}
	downSince = null;
	return body.data;
}

// ---- the queue ------------------------------------------------------------------------

type RawItem = {
	state: QueueItem['state'];
	progress: number;
	tries: number;
	chapter: { id: number; pageCount: number; chapterNumber: number; name: string };
	manga: { id: number; title: string; sourceId: string; url: string };
};

export type Queue = { running: boolean; items: QueueItem[] };

let cached: { at: number; queue: Queue } | null = null;
const QUEUE_TTL = 2000;

/**
 * Suwayomi's whole queue (2,316 chapters on 2026-10-04: about 100 KB). Kept
 * for two seconds, so a series screen and the library's QUEUE cell drawn
 * together ask once.
 */
export async function queue(timeoutMs = 4000): Promise<Queue> {
	if (cached && Date.now() - cached.at < QUEUE_TTL) return cached.queue;
	const d = await gql<{ downloadStatus: { state: 'STARTED' | 'STOPPED'; queue: RawItem[] } }>(
		`{ downloadStatus { state queue { state progress tries
			chapter { id pageCount chapterNumber name } manga { id title sourceId url } } } }`,
		{},
		timeoutMs
	);
	const q: Queue = {
		running: d.downloadStatus.state === 'STARTED',
		items: d.downloadStatus.queue.map((r) => ({
			chapterId: r.chapter.id,
			state: r.state,
			progress: r.progress,
			tries: r.tries,
			pageCount: r.chapter.pageCount,
			number: r.chapter.chapterNumber,
			name: r.chapter.name,
			key: keyOf(r.manga.sourceId, r.manga.url),
			mangaId: r.manga.id,
			mangaTitle: r.manga.title
		}))
	};
	cached = { at: Date.now(), queue: q };
	return q;
}

export const forget = () => (cached = null);

/** The tsundoku series a queued manga is, by key; null when it hasn't been imported. */
export function seriesForKey(key: string): QueueSeries | null {
	const row = getDb()
		.prepare(
			`SELECT s.id, s.title, NOT ${VISIBLE_SQL} AS hidden, s.cover_at, s.hue
			FROM series s JOIN roots r ON r.id = s.root_id WHERE s.origin_key = ?`
		)
		.get(key) as
		{ id: number; title: string; hidden: number; cover_at: number | null; hue: number } | undefined;
	return row
		? { id: row.id, title: row.title, hidden: row.hidden === 1, cover: row.cover_at, hue: row.hue }
		: null;
}

// ---- a series ---------------------------------------------------------------------------

type Manga = {
	id: number;
	inLibrary: boolean;
	chapters: { nodes: { id: number; url: string; isDownloaded: boolean }[] };
};

export async function mangaOf(key: { sourceId: string; url: string }, timeoutMs = 4000) {
	const d = await gql<{ mangas: { nodes: Manga[] } }>(
		`query ($s: LongString!, $u: String!) { mangas(condition: { sourceId: $s, url: $u }) {
			nodes { id inLibrary chapters { nodes { id url isDownloaded } } } } }`,
		{ s: key.sourceId, u: key.url },
		timeoutMs
	);
	return d.mangas.nodes[0] ?? null;
}

let sources: { at: number; names: Map<string, string> } | null = null;

/** The sources Suwayomi has an extension for, by id. Kept a minute: they change when an extension is installed. */
export async function installedSources(timeoutMs = 4000): Promise<Map<string, string>> {
	if (sources && Date.now() - sources.at < 60_000) return sources.names;
	const d = await gql<{ sources: { nodes: { id: string; displayName: string }[] } }>(
		`{ sources { nodes { id displayName } } }`,
		{},
		timeoutMs
	);
	sources = { at: Date.now(), names: new Map(d.sources.nodes.map((s) => [s.id, s.displayName])) };
	return sources.names;
}

/** What the series row and its chapters need. */
export type SeriesDownloads =
	/** Nothing to say: not a Mihon series, or Suwayomi isn't set up here. */
	| { kind: 'none' }
	/** A Mihon source Suwayomi has no extension for (Bato.to, Hitomi): the tablet downloads it. */
	| { kind: 'elsewhere'; source: string }
	| { kind: 'down'; since: number }
	| {
			kind: 'ok';
			states: Record<number, DownloadState>;
			/** Chapters queued for other series, for ALL's confirmation. */
			queuedElsewhere: number;
			/** FOLLOW: whether it's on, and when Suwayomi last checked for new chapters. */
			follow: { on: boolean; checked: number | null };
	  };

/** The series' source, by the name the tablet gave it (the series' `source` tag), for "BATO.TO DOWNLOADS ON THE TABLET". */
function sourceName(seriesId: number, sourceId: string): string {
	const tag = getDb()
		.prepare(
			`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE st.series_id = ? AND t.namespace = 'source' AND t.value != 'mihon' LIMIT 1`
		)
		.get(seriesId) as { value: string } | undefined;
	return tag?.value ?? `source ${sourceId}`;
}

function entryUrls(seriesId: number): Map<number, string> {
	const rows = getDb()
		.prepare(`SELECT id, source_url FROM entries WHERE series_id = ? AND shadowed = 0`)
		.all(seriesId) as { id: number; source_url: string }[];
	return new Map(rows.filter((r) => r.source_url).map((r) => [r.id, r.source_url]));
}

function followedAt(seriesId: number): number | null {
	const row = getDb().prepare(`SELECT followed_at FROM series WHERE id = ?`).get(seriesId) as
		{ followed_at: number | null } | undefined;
	return row?.followed_at ?? null;
}

function originOf(seriesId: number): string | null {
	const row = getDb().prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null } | undefined;
	return row?.origin_key ?? null;
}

/**
 * Where a series' chapters stand. Never throws: Suwayomi not answering is a
 * state the row draws (Download States 1c, state 5), and the screen around it
 * mustn't wait long for it, so the timeout is short.
 */
export async function seriesDownloads(
	seriesId: number,
	entries: { id: number; available: boolean }[]
): Promise<SeriesDownloads> {
	const key = parseKey(originOf(seriesId));
	if (!configured() || !key) return { kind: 'none' };
	try {
		const [names, manga, q, checked] = await Promise.all([
			installedSources(1500),
			mangaOf(key, 1500),
			queue(1500),
			lastChecked().catch(() => null)
		]);
		if (!names.has(key.sourceId))
			return { kind: 'elsewhere', source: sourceName(seriesId, key.sourceId) };
		// The source is installed but Suwayomi has never seen this manga (a
		// series only the phone had): nothing it can be asked to download yet.
		if (!manga) return { kind: 'none' };
		const chapters: SourceChapter[] = manga.chapters.nodes.map((c) => ({
			id: c.id,
			url: c.url,
			downloaded: c.isDownloaded
		}));
		const mine = q.items.filter((i) => i.mangaId === manga.id);
		const states = chapterStates(entries, entryUrls(seriesId), chapters, mine);
		return {
			kind: 'ok',
			states: Object.fromEntries(states),
			queuedElsewhere: q.items.filter(
				(i) => i.mangaId !== manga.id && (i.state === 'QUEUED' || i.state === 'DOWNLOADING')
			).length,
			follow: { on: followedAt(seriesId) !== null, checked }
		};
	} catch {
		return { kind: 'down', since: downSince ?? Date.now() };
	}
}

/**
 * Queue entries of a series. The manga goes into Suwayomi's library first,
 * as DOWNLOADING.md's "Using it" asks: only library series are in its backup,
 * and the backup is what keys the download as the tablet's copy rather than
 * a folder of its own. Chapters Suwayomi doesn't list yet get one refresh
 * from the source before they're given up on.
 */
export async function enqueue(
	seriesId: number,
	entryIds: number[]
): Promise<{ queued: number; missing: number }> {
	const key = parseKey(originOf(seriesId));
	if (!configured() || !key)
		throw new SuwayomiError('this series is not downloaded through Suwayomi');
	let manga = await mangaOf(key);
	if (!manga) throw new SuwayomiError('Suwayomi does not know this series');
	const urls = entryUrls(seriesId);
	const wanted = entryIds.map((id) => urls.get(id)).filter((u): u is string => !!u);
	const find = (m: Manga) => {
		const byUrl = new Map(m.chapters.nodes.map((c) => [c.url, c]));
		return wanted.map((u) => byUrl.get(u));
	};
	let found = find(manga);
	if (found.some((c) => !c)) {
		await gql(
			`mutation ($id: Int!) { fetchMangaAndChapters(input: { id: $id, fetchManga: false, fetchChapters: true }) { clientMutationId } }`,
			{ id: manga.id },
			30_000
		).catch(() => undefined);
		manga = (await mangaOf(key)) ?? manga;
		found = find(manga);
	}
	const ids = found.filter((c) => c && !c.isDownloaded).map((c) => c!.id);
	if (!manga.inLibrary)
		await gql(
			`mutation ($id: Int!) { updateManga(input: { id: $id, patch: { inLibrary: true } }) { clientMutationId } }`,
			{ id: manga.id }
		);
	if (ids.length) {
		await gql(
			`mutation ($ids: [Int!]!) { enqueueChapterDownloads(input: { ids: $ids }) { clientMutationId } }`,
			{ ids }
		);
		if (!getSettingPaused()) await startDownloader();
	}
	forget();
	return { queued: ids.length, missing: entryIds.length - ids.length };
}

/** RETRY: a failed chapter out of the queue and back in at the end, its tries reset. */
export async function retry(chapterIds: number[]): Promise<void> {
	if (!chapterIds.length) return;
	await gql(
		`mutation ($ids: [Int!]!) { dequeueChapterDownloads(input: { ids: $ids }) { clientMutationId } }`,
		{ ids: chapterIds }
	);
	await gql(
		`mutation ($ids: [Int!]!) { enqueueChapterDownloads(input: { ids: $ids }) { clientMutationId } }`,
		{ ids: chapterIds }
	);
	if (!getSettingPaused()) await startDownloader();
	forget();
}

/** ✕ and CANCEL N: out of the queue. */
export async function dequeue(chapterIds: number[]): Promise<void> {
	if (!chapterIds.length) return;
	await gql(
		`mutation ($ids: [Int!]!) { dequeueChapterDownloads(input: { ids: $ids }) { clientMutationId } }`,
		{ ids: chapterIds }
	);
	forget();
}

/** ↑ TO THE TOP: a series' chapters ahead of everything else, in their own order. */
export async function toTheTop(chapterIds: number[]): Promise<void> {
	if (!chapterIds.length) return;
	await gql(
		`mutation ($r: [ReorderChapterDownloadInput!]!) { reorderChapterDownloads(input: { reorders: $r }) { clientMutationId } }`,
		{ r: chapterIds.map((chapterId, to) => ({ chapterId, to })) }
	);
	forget();
}

export async function startDownloader() {
	await gql(`mutation { startDownloader(input: {}) { clientMutationId } }`);
}

/**
 * PAUSE and RESUME. When it paused is kept here, not asked of Suwayomi,
 * which doesn't know: a pause made in its own web UI shows PAUSED without a
 * time (doc/DOWNLOADING.md, "Where it departs from the handoff").
 */
export async function setPaused(paused: boolean, now = Date.now()): Promise<void> {
	if (paused) await gql(`mutation { stopDownloader(input: {}) { clientMutationId } }`);
	else await startDownloader();
	setSetting('downloads_paused_at', paused ? String(now) : '');
	forget();
}

/** Paused from tsundoku: what's queued now waits for RESUME. */
export const getSettingPaused = () => getSetting('downloads_paused_at') !== '';

/** When Suwayomi last looked for new chapters, for FOLLOWING's "CHECKED 2 H AGO". */
async function lastChecked(timeoutMs = 1500): Promise<number | null> {
	const d = await gql<{ lastUpdateTimestamp: { timestamp: string } }>(
		`{ lastUpdateTimestamp { timestamp } }`,
		{},
		timeoutMs
	);
	const t = Number(d.lastUpdateTimestamp.timestamp);
	return t > 0 ? t : null;
}

export function pausedAt(): number | null {
	const v = Number(getSetting('downloads_paused_at'));
	return v > 0 ? v : null;
}

// ---- the QUEUE cell and the failures band ----------------------------------------------

export type QueueSummary = {
	queued: number;
	failed: number;
	/** The series that failed, by title, for the library's band. */
	failedSeries: string[];
	/** Suwayomi isn't answering: these are the last numbers it gave. */
	stale: boolean;
};

const lastKnown = new Map<boolean, QueueSummary>();
let lastAsked = 0;

/**
 * What every screen's chrome shows of the queue: the library's QUEUE cell,
 * the sidebar's DOWNLOADS, the failures band. Asked on every page load, so it
 * never waits long, and while Suwayomi isn't answering it isn't asked again
 * for fifteen seconds: the last numbers come back, marked stale.
 */
export async function queueSummary(reveal: boolean): Promise<QueueSummary | null> {
	if (!configured()) return null;
	const known = lastKnown.get(reveal) ?? null;
	if (downSince !== null && Date.now() - lastAsked < 15_000)
		return known && { ...known, stale: true };
	lastAsked = Date.now();
	try {
		const q = await queue(800);
		const v = queueView(q.items, seriesForKey, reveal);
		const summary: QueueSummary = {
			queued: v.queued,
			failed: v.failures.length,
			failedSeries: [...new Set(v.failures.map((f) => f.series?.title ?? f.mangaTitle))],
			stale: false
		};
		lastKnown.set(reveal, summary);
		return summary;
	} catch {
		return known && { ...known, stale: true };
	}
}

/**
 * Chapters that arrived since `since` (the NEW shelf's own clock,
 * `entries.arrived_at`), for "12 DOWNLOADED IN THE LAST HOUR": what finished
 * is the NEW shelf's, and the queue only points there.
 */
export function arrivedSince(since: number, reveal: boolean): number {
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM entries e JOIN series s ON s.id = e.series_id
				JOIN roots r ON r.id = s.root_id
				WHERE e.arrived_at >= ? AND e.shadowed = 0 AND ${reveal ? '1' : VISIBLE_SQL}`
			)
			.get(since) as { n: number }
	).n;
}
