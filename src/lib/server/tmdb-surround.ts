import { getDb } from './db.ts';
import { IN_LIBRARY_SQL, visibleWhere } from './visibility.ts';
import { catalogueConfigured } from './catalogues.ts';
import { tmdbCollection, tmdbShowFacts } from './tmdb.ts';
import {
	collectionView,
	showView,
	type CollectionView,
	type HeldFilm,
	type ShowView
} from '../library/surroundings.ts';
import type { TmdbCollection, TmdbShowFacts } from '../library/tmdb.ts';

/**
 * What surrounds a film or a show, the workstation's half (card c990;
 * doc/LINKS.md, "What surrounds it"). TMDB's facts are cached per entry in
 * `tmdb_surroundings` (rung 81), filled by TMDB's timer and after a LINK, and
 * **only by id**: an entry the library already links, so nothing is searched
 * and no title leaves. A screen reads what is cached or draws nothing; it never
 * waits on TMDB.
 *
 * With no key nothing is fetched, and a cached answer from before the key
 * went is still drawn: it is TMDB's public catalogue, not the owner's.
 */

/** How long a cached answer stands. A show still airing changes weekly; a finished one, or a collection, rarely. */
export const AIRING_MS = 24 * 60 * 60 * 1000;
export const SETTLED_MS = 14 * 24 * 60 * 60 * 1000;

type Cached<T> = { data: T; fetched_at: number };

function cached<T>(media: 'tv' | 'collection', id: number): Cached<T> | null {
	const r = getDb()
		.prepare(`SELECT data, fetched_at FROM tmdb_surroundings WHERE media = ? AND tmdb_id = ?`)
		.get(media, id) as { data: string; fetched_at: number } | undefined;
	return r ? { data: JSON.parse(r.data) as T, fetched_at: r.fetched_at } : null;
}

function store(media: 'tv' | 'collection', id: number, data: unknown, now: number): void {
	getDb()
		.prepare(
			`INSERT INTO tmdb_surroundings (media, tmdb_id, data, fetched_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (media, tmdb_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
		)
		.run(media, id, JSON.stringify(data), now);
}

const stale = (c: Cached<unknown> | null, ms: number, now: number) =>
	!c || now - c.fetched_at >= ms;

/** Ask TMDB for one entry's surroundings now, whatever the cache says: after a LINK. */
export async function refreshEntry(
	what: { media: 'tv' | 'collection'; id: number },
	now = Date.now()
): Promise<boolean> {
	if (!catalogueConfigured('tmdb')) return false;
	const data = what.media === 'tv' ? await tmdbShowFacts(what.id) : await tmdbCollection(what.id);
	if (!data) return false;
	store(what.media, what.id, data, now);
	return true;
}

/** Every entry the library links whose surroundings could be drawn: shows, and films in a collection. */
function wanted(): { media: 'tv' | 'collection'; id: number }[] {
	return getDb()
		.prepare(
			`SELECT DISTINCT 'tv' AS media, tmdb_id AS id FROM series_tmdb_links WHERE media = 'tv'
			UNION SELECT DISTINCT 'collection', collection_id FROM series_tmdb_links
				WHERE media = 'movie' AND collection_id IS NOT NULL
			ORDER BY media, id`
		)
		.all() as { media: 'tv' | 'collection'; id: number }[];
}

/**
 * The timer's step: up to `limit` entries never asked or gone stale, a request
 * each. A show still airing goes stale after a day, anything else after two
 * weeks, so a library of finished shows asks almost nothing.
 */
export async function refreshSurroundings(
	opts: { limit?: number; now?: number; log?: (line: string) => void } = {}
): Promise<number> {
	if (!catalogueConfigured('tmdb')) return 0;
	const now = opts.now ?? Date.now();
	const due = wanted().filter((w) => {
		const c = cached<TmdbShowFacts | TmdbCollection>(w.media, w.id);
		const ms =
			w.media === 'tv' && (c?.data as TmdbShowFacts | undefined)?.inProduction
				? AIRING_MS
				: SETTLED_MS;
		return stale(c, ms, now);
	});
	let n = 0;
	for (const w of due.slice(0, opts.limit ?? 20)) if (await refreshEntry(w, now)) n += 1;
	if (n) opts.log?.(`surroundings: ${n} refreshed`);
	return n;
}

// ---- what the screens read ----------------------------------------------------------------

export type Surroundings =
	{ kind: 'seasons'; view: ShowView } | { kind: 'collection'; view: CollectionView } | null;

type LinkRow = {
	kind: string;
	title: string;
	tmdb_id: number;
	media: 'movie' | 'tv';
	link_title: string;
	collection_id: number | null;
};

/**
 * A film's collection or a show's seasons as this series sees them, from the
 * cache alone. The library's other films and seasons are read as the viewer
 * may see them: with reveal off a hidden one is not there, so the block never
 * names it (doc/LIBRARY.md, "Hidden means hidden"), and a browsing record is
 * never "in the library".
 */
export function surroundingsOf(seriesId: number, reveal: boolean, now = Date.now()): Surroundings {
	const db = getDb();
	const l = db
		.prepare(
			`SELECT s.kind, s.title, l.tmdb_id, l.media, l.title AS link_title, l.collection_id
			FROM series s JOIN series_tmdb_links l ON l.series_id = s.id WHERE s.id = ?`
		)
		.get(seriesId) as LinkRow | undefined;
	if (!l) return null;
	const where = `${IN_LIBRARY_SQL} AND ${visibleWhere(reveal)}`;
	if (l.media === 'tv') {
		const c = cached<TmdbShowFacts>('tv', l.tmdb_id);
		if (!c) return null;
		const held = db
			.prepare(
				`SELECT s.id AS seriesId, s.title FROM series s JOIN roots r ON r.id = s.root_id
				JOIN series_tmdb_links x ON x.series_id = s.id
				WHERE x.media = 'tv' AND x.tmdb_id = ? AND s.id != ? AND ${where}`
			)
			.all(l.tmdb_id, seriesId) as { seriesId: number; title: string }[];
		const view = showView({
			facts: c.data,
			showName: l.link_title,
			seriesId,
			seriesTitle: l.title,
			held,
			declined: declinedOf(seriesId),
			now
		});
		return view ? { kind: 'seasons', view } : null;
	}
	if (l.collection_id === null) return null;
	const c = cached<TmdbCollection>('collection', l.collection_id);
	if (!c) return null;
	const ids = c.data.parts.map((p) => p.id);
	const rows = db
		.prepare(
			`SELECT x.tmdb_id, s.id AS series_id, x.runtime,
				(SELECT ws.work_id FROM work_series ws WHERE ws.series_id = s.id) AS work_id,
				EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.read_at IS NOT NULL) AS watched
			FROM series s JOIN roots r ON r.id = s.root_id JOIN series_tmdb_links x ON x.series_id = s.id
			WHERE x.media = 'movie' AND x.tmdb_id IN (${ids.map(() => '?').join(', ')})
				AND (s.id = ? OR (${where}))
			ORDER BY s.id`
		)
		.all(...ids, seriesId) as {
		tmdb_id: number;
		series_id: number;
		runtime: number | null;
		work_id: number | null;
		watched: number;
	}[];
	const held = new Map<number, HeldFilm>();
	// Two films linked to one part: the first, by id, is the one the row opens.
	for (const r of rows)
		if (!held.has(r.tmdb_id))
			held.set(r.tmdb_id, {
				seriesId: r.series_id,
				watched: !!r.watched,
				runtime: r.runtime,
				workId: r.work_id
			});
	const view = collectionView({
		collection: c.data,
		thisId: l.tmdb_id,
		held,
		workId: held.get(l.tmdb_id)?.workId ?? null
	});
	return view ? { kind: 'collection', view } : null;
}

// ---- NOT THIS -----------------------------------------------------------------------------

function declinedOf(seriesId: number): Set<string> {
	return new Set(
		(
			getDb()
				.prepare(`SELECT offer FROM tmdb_offers_declined WHERE series_id = ?`)
				.all(seriesId) as {
				offer: string;
			}[]
		).map((r) => r.offer)
	);
}

/** NOT THIS on an offer (`season:4`): no refresh asks it again. UNDO is `undoDecline`. */
export function declineOffer(seriesId: number, offer: string, now = Date.now()): void {
	getDb()
		.prepare(
			`INSERT INTO tmdb_offers_declined (series_id, offer, at) VALUES (?, ?, ?)
			ON CONFLICT (series_id, offer) DO NOTHING`
		)
		.run(seriesId, offer, now);
}

export function undoDecline(seriesId: number, offer: string): boolean {
	return (
		getDb()
			.prepare(`DELETE FROM tmdb_offers_declined WHERE series_id = ? AND offer = ?`)
			.run(seriesId, offer).changes > 0
	);
}
