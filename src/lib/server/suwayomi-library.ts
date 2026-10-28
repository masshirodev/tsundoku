import { getDb } from './db.ts';
import { writeSeries } from './import/write.ts';
import { refreshCovers } from './covers.ts';
import {
	SuwayomiError,
	configured,
	dequeue,
	forget,
	getSettingPaused,
	gql,
	installedSources,
	mangaOf,
	queue,
	startDownloader
} from './suwayomi.ts';
import { planMihon } from '../import/mihon-plan.ts';
import type { MihonManga } from '../import/mihon-backup.ts';
import { forgetSourceUse, libraryIndex, mihonRoot, sourceUse } from './library-sources.ts';
import {
	followQueue,
	highlight,
	keyOf,
	normTitle,
	parseKey,
	sourcesToSearch,
	type ResultMatch
} from '../library/downloads.ts';

/**
 * Finding a series that isn't in the library, adding it, and FOLLOW
 * (Download States 1d, 1e; doc/DOWNLOADING.md). Searching, previewing and
 * adding go through Suwayomi, which runs the extensions; what lands in
 * tsundoku is written by the importer's own writer from the plan the Mihon
 * importer would make, so the next import of Suwayomi's backup finds it
 * already there, under the same key.
 */

// ---- which sources ------------------------------------------------------------------

/** The sources a search asks, by name (Download States 1e: "7 SOURCES"). */
export async function searchSources(reveal: boolean): Promise<{ id: string; name: string }[]> {
	const names = await installedSources();
	return sourcesToSearch(
		[...names].map(([id, name]) => ({ id, name: name.replace(/\s*\([A-Z-]+\)$/, '') })),
		sourceUse(),
		reveal
	);
}

// ---- searching ----------------------------------------------------------------------

export type SearchHit = {
	/** Opaque: Suwayomi's manga id, or the engine's source and URL (engine/backend.ts). */
	mangaId: string;
	title: string;
	parts: { pre: string; mid: string; post: string };
	cover: string;
	meta: string;
	match: ResultMatch;
};

type RawManga = {
	id: number;
	title: string;
	author: string | null;
	status: string;
	url: string;
	sourceId: string;
};

const STATUS: Record<string, string> = {
	ONGOING: 'ONGOING',
	COMPLETED: 'COMPLETED',
	LICENSED: 'LICENSED',
	PUBLISHING_FINISHED: 'COMPLETED',
	CANCELLED: 'CANCELLED',
	ON_HIATUS: 'ON HIATUS'
};

/**
 * One source's answer to a query: twenty seconds, then it's DID NOT ANSWER
 * (Download States 1e). A result that is a hidden series is dropped with
 * reveal off, not dimmed.
 */
export async function searchSource(
	sourceId: string,
	query: string,
	reveal: boolean
): Promise<SearchHit[]> {
	const d = await gql<{ fetchSourceManga: { mangas: RawManga[] } }>(
		`mutation ($s: LongString!, $q: String!) { fetchSourceManga(input: { source: $s, type: SEARCH, query: $q, page: 1 }) {
			mangas { id title author status url sourceId } } }`,
		{ s: sourceId, q: query },
		20_000
	);
	const names = await installedSources();
	const { byKey, byTitle } = libraryIndex(reveal);
	const out: SearchHit[] = [];
	for (const m of d.fetchSourceManga.mangas) {
		const mine = byKey.get(keyOf(m.sourceId, m.url));
		if (mine?.hidden && !reveal) continue;
		const other = byTitle.get(normTitle(m.title));
		const match: ResultMatch = mine
			? {
					kind: 'in-library',
					seriesId: mine.id,
					meta: `${mine.have.toLocaleString('en-US')} OF ${mine.total.toLocaleString('en-US')} DOWNLOADED`
				}
			: other && other !== m.sourceId
				? {
						kind: 'same-title',
						source: (names.get(other) ?? '').replace(/\s*\([A-Z-]+\)$/, '').toUpperCase()
					}
				: { kind: 'new' };
		out.push({
			mangaId: String(m.id),
			title: m.title,
			parts: highlight(m.title, query),
			cover: `/api/downloads/thumb/${m.id}`,
			meta: [m.author?.toUpperCase(), STATUS[m.status]].filter(Boolean).join(' · '),
			match
		});
	}
	return out;
}

// ---- a result's preview, and adding it ------------------------------------------------

export type SourceManga = {
	id: string;
	title: string;
	description: string;
	author: string;
	artist: string;
	genres: string[];
	status: string;
	source: string;
	sourceId: string;
	url: string;
	inLibrary: boolean;
	thumbnailUrl: string;
	/** The preview's cover, as one of tsundoku's own URLs. */
	cover: string;
	/** The series' page at the source, for OPEN ↗; '' when the source doesn't say. */
	realUrl: string;
	/** The source's language, from its name: "EN". */
	lang: string;
	chapters: {
		id: string;
		url: string;
		name: string;
		number: number;
		scanlator: string;
		sourceOrder: number;
		uploadDate: number;
		fetchedAt: number;
	}[];
};

type RawDetail = {
	id: number;
	title: string;
	description: string | null;
	author: string | null;
	artist: string | null;
	genre: string[];
	status: string;
	sourceId: string;
	url: string;
	inLibrary: boolean;
	thumbnailUrl: string | null;
	realUrl: string | null;
	source: { displayName: string } | null;
	chapters: {
		nodes: {
			id: number;
			url: string;
			name: string;
			chapterNumber: number;
			scanlator: string | null;
			sourceOrder: number;
			uploadDate: string;
			fetchedAt: string;
		}[];
	};
};

const DETAIL = `id title description author artist genre status sourceId url inLibrary thumbnailUrl realUrl
	source { displayName }
	chapters { nodes { id url name chapterNumber scanlator sourceOrder uploadDate fetchedAt } }`;

/**
 * A search result in full: the manga and its chapters, fetched from the
 * source first when Suwayomi only has what the search returned.
 */
export async function sourceManga(id: number): Promise<SourceManga | null> {
	let d = await gql<{ manga: RawDetail | null }>(
		`query ($id: Int!) { manga(id: $id) { ${DETAIL} } }`,
		{
			id
		}
	);
	if (!d.manga) return null;
	if (d.manga.chapters.nodes.length === 0) {
		await gql(
			`mutation ($id: Int!) { fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) { clientMutationId } }`,
			{ id },
			30_000
		);
		d = await gql(`query ($id: Int!) { manga(id: $id) { ${DETAIL} } }`, { id });
		if (!d.manga) return null;
	}
	const m = d.manga;
	return {
		id: String(m.id),
		title: m.title,
		description: m.description ?? '',
		author: m.author ?? '',
		artist: m.artist ?? '',
		genres: m.genre,
		status: m.status,
		source: (m.source?.displayName ?? '').replace(/\s*\([A-Z-]+\)$/, ''),
		sourceId: m.sourceId,
		url: m.url,
		inLibrary: m.inLibrary,
		thumbnailUrl: m.thumbnailUrl ?? '',
		cover: `/api/downloads/thumb/${m.id}`,
		realUrl: m.realUrl ?? '',
		lang: /\(([A-Z-]+)\)$/.exec(m.source?.displayName ?? '')?.[1] ?? '',
		chapters: m.chapters.nodes
			.map((c) => ({
				id: String(c.id),
				url: c.url,
				name: c.name,
				number: c.chapterNumber,
				scanlator: c.scanlator ?? '',
				sourceOrder: c.sourceOrder,
				uploadDate: Number(c.uploadDate),
				fetchedAt: Number(c.fetchedAt) * 1000
			}))
			.sort((a, b) => b.sourceOrder - a.sourceOrder)
	};
}

/** Mihon's status numbers, which the planner reads. */
const MIHON_STATUS: Record<string, number> = {
	ONGOING: 1,
	COMPLETED: 2,
	LICENSED: 3,
	PUBLISHING_FINISHED: 4,
	CANCELLED: 5,
	ON_HIATUS: 6
};

/** A Suwayomi manga as Mihon's backup would carry it: what the planner reads. */
export function asMihon(m: SourceManga): MihonManga {
	return {
		source: m.sourceId,
		url: m.url,
		title: m.title,
		artist: m.artist,
		author: m.author,
		description: m.description,
		genres: m.genres,
		status: MIHON_STATUS[m.status] ?? 0,
		thumbnailUrl: '',
		dateAdded: null,
		viewer: 0,
		chapters: m.chapters.map((c) => ({
			url: c.url,
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

export class AddError extends Error {}

/**
 * ADD TO LIBRARY (Download States 1e): into Suwayomi's library, so its backup
 * keys it, then into tsundoku's at once, every chapter NOT DOWNLOADED, by the
 * Mihon importer's own plan and writer. Returns the new series. Its cover is
 * Suwayomi's thumbnail until an import brings the source's.
 */
export async function addToLibrary(mangaId: number, now = Date.now()): Promise<number> {
	if (!configured()) throw new AddError('downloading is not set up here');
	const m = await sourceManga(mangaId);
	if (!m) throw new AddError('Suwayomi does not know that series');
	const key = keyOf(m.sourceId, m.url);
	const existing = getDb().prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key) as
		{ id: number } | undefined;
	if (existing) return existing.id;
	const rootId = mihonRoot();
	if (rootId === null) throw new AddError('there is no Mihon library to add it to');
	if (!m.inLibrary)
		await gql(
			`mutation ($id: Int!) { updateManga(input: { id: $id, patch: { inLibrary: true } }) { clientMutationId } }`,
			{ id: Number(m.id) }
		);
	const plan = planMihon(
		{ manga: [asMihon(m)], categories: [], sources: new Map([[m.sourceId, m.source]]) },
		[],
		now
	).series[0];
	plan.coverUrl = m.thumbnailUrl ? `${process.env.SUWAYOMI_URL}${m.thumbnailUrl}` : undefined;
	writeSeries(plan, { rootId, jobId: null, now });
	const row = getDb().prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key) as
		{ id: number } | undefined;
	if (!row) {
		// Deleted once (doc/DELETING.md): the writer passed it by, and it stays gone.
		const buried = getDb().prepare(`SELECT 1 FROM tombstones WHERE key = ?`).get(key);
		throw new AddError(
			buried
				? 'that series was deleted here once, and stays gone'
				: 'its chapters are already in another series here'
		);
	}
	getDb().prepare(`UPDATE series SET arrived_at = ? WHERE id = ?`).run(now, row.id);
	forgetSourceUse();
	void refreshCovers({ ids: [row.id], remote: true });
	return row.id;
}

/**
 * UNDO after adding: out of Suwayomi's library and out of tsundoku's, as long
 * as nothing of it was downloaded or read since. Not a delete: no tombstone,
 * so it can be added again.
 */
export async function undoAdd(seriesId: number): Promise<boolean> {
	const db = getDb();
	const s = db.prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null } | undefined;
	const key = parseKey(s?.origin_key ?? null);
	if (!key) return false;
	const touched = db
		.prepare(
			`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND (available = 1 OR read_at IS NOT NULL)`
		)
		.get(seriesId) as { n: number };
	if (touched.n > 0) return false;
	const manga = await mangaOf(key);
	if (manga) {
		const mine = (await queue()).items
			.filter((i) => i.mangaId === manga.id)
			.map((i) => i.chapterId);
		await dequeue(mine);
		await gql(
			`mutation ($id: Int!) { updateManga(input: { id: $id, patch: { inLibrary: false } }) { clientMutationId } }`,
			{ id: manga.id }
		);
	}
	db.prepare(`DELETE FROM series WHERE id = ?`).run(seriesId);
	forgetSourceUse();
	return true;
}

// ---- FOLLOW --------------------------------------------------------------------------

/** FOLLOW and FOLLOWING ✓: followed from now on, and into Suwayomi's library so its update checks it. */
export async function setFollowed(seriesId: number, on: boolean, now = Date.now()): Promise<void> {
	const db = getDb();
	const s = db.prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null } | undefined;
	const key = parseKey(s?.origin_key ?? null);
	if (!key) throw new SuwayomiError('only a series Suwayomi downloads can be followed');
	if (on) {
		const manga = await mangaOf(key);
		if (!manga) throw new SuwayomiError('Suwayomi does not know this series');
		if (!manga.inLibrary)
			await gql(
				`mutation ($id: Int!) { updateManga(input: { id: $id, patch: { inLibrary: true } }) { clientMutationId } }`,
				{ id: manga.id }
			);
	}
	db.prepare(`UPDATE series SET followed_at = ? WHERE id = ?`).run(on ? now : null, seriesId);
}

/**
 * Queue what's new in every followed series: run by the Suwayomi timer every
 * ten minutes (POST /api/downloads/follow), so a chapter Suwayomi's own
 * update found is queued within ten minutes of it.
 */
export async function followNew(): Promise<{ series: number; queued: number }> {
	if (!configured()) return { series: 0, queued: 0 };
	const db = getDb();
	const followed = db
		.prepare(`SELECT id, origin_key, followed_at FROM series WHERE followed_at IS NOT NULL`)
		.all() as { id: number; origin_key: string; followed_at: number }[];
	if (!followed.length) return { series: 0, queued: 0 };
	const q = await queue();
	const queued = new Set(q.items.map((i) => i.chapterId));
	const reads = db.prepare(
		`SELECT source_url FROM entries WHERE series_id = ? AND read_at IS NOT NULL AND source_url != ''`
	);
	const ids: number[] = [];
	for (const s of followed) {
		const key = parseKey(s.origin_key);
		if (!key) continue;
		const d = await gql<{
			mangas: {
				nodes: {
					chapters: {
						nodes: { id: number; url: string; fetchedAt: string; isDownloaded: boolean }[];
					};
				}[];
			};
		}>(
			`query ($s: LongString!, $u: String!) { mangas(condition: { sourceId: $s, url: $u }) {
				nodes { chapters { nodes { id url fetchedAt isDownloaded } } } } }`,
			{ s: key.sourceId, u: key.url }
		);
		const chapters = (d.mangas.nodes[0]?.chapters.nodes ?? []).map((c) => ({
			id: c.id,
			url: c.url,
			fetchedAt: Number(c.fetchedAt) * 1000,
			downloaded: c.isDownloaded
		}));
		const readUrls = new Set(
			(reads.all(s.id) as { source_url: string }[]).map((r) => r.source_url)
		);
		ids.push(...followQueue(chapters, s.followed_at, queued, readUrls));
	}
	if (ids.length) {
		await gql(
			`mutation ($ids: [Int!]!) { enqueueChapterDownloads(input: { ids: $ids }) { clientMutationId } }`,
			{ ids }
		);
		if (!getSettingPaused()) await startDownloader();
		forget();
	}
	return { series: followed.length, queued: ids.length };
}

/** Just enough of a Suwayomi manga to tell whether tsundoku has it already. */
export async function mangaKey(id: number): Promise<string | null> {
	const d = await gql<{ manga: { sourceId: string; url: string } | null }>(
		`query ($id: Int!) { manga(id: $id) { sourceId url } }`,
		{ id },
		4000
	);
	return d.manga ? keyOf(d.manga.sourceId, d.manga.url) : null;
}
