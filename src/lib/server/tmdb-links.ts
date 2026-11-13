import { getDb } from './db.ts';
import { HIDDEN_SQL, IN_LIBRARY_SQL, VISIBLE_SQL, visibleWhere } from './visibility.ts';
import { catalogueConfigured } from './catalogues.ts';
import { catalogueClient } from './catalogue-clients.ts';
import { KINDS, kindFacts, type Kind } from '../library/kinds.ts';
import { titlesOfRow } from './catalogue.ts';
import { tmdbQuery, tmdbRows, tmdbSure, tmdbWhy, type TmdbTitle } from '../library/tmdb.ts';
import type { Row } from '../library/catalogue.ts';

/**
 * TMDB links, a film's and a show's (card c989; doc/LINKS.md, "TMDB links").
 * The AniList link's rules in TMDB's terms, kept in their own tables (rung
 * 80): the pass searches what was never searched and links only a sure match,
 * the review offers the rest, and the owner's NONE OF THESE and UNLINK are
 * never undone by a pass.
 *
 * **No key is a state.** Every door asks `catalogueConfigured('tmdb')` first:
 * with no key the pass searches nothing and marks nothing, so a key added
 * later finds the whole library unsearched and the next pass is the backfill
 * (doc/MOVIES-TV.md, "Decided": "a key added later backfills … and never
 * invents one").
 *
 * A show links **once, as the whole show**: TMDB's seasons are inside its one
 * entry, and the source's seasons are the source's.
 */

export type TmdbKind = 'movie' | 'show';
export type TmdbVia = 'exact' | 'review' | 'pasted';

/** The kinds TMDB holds: asked of the registry, never spelled. */
export const TMDB_KINDS = KINDS.filter(
	(k) => kindFacts(k).catalogue.provider === 'tmdb'
) as readonly TmdbKind[];

export const isTmdbKind = (kind: Kind | null | undefined): kind is TmdbKind =>
	!!kind && (TMDB_KINDS as readonly Kind[]).includes(kind);

const KIND_IN = `s.kind IN (${TMDB_KINDS.map((k) => `'${k}'`).join(', ')})`;
/** What the pass and the queue may ask about: a film or a show in the library. Hidden is the caller's. */
const LINKABLE = `${KIND_IN} AND ${IN_LIBRARY_SQL}`;

type LinkRow = {
	series_id: number;
	tmdb_id: number;
	media: 'movie' | 'tv';
	via: TmdbVia;
	title: string;
	original_title: string;
	year: number | null;
	overview: string;
	poster_url: string;
	runtime: number | null;
	seasons: number | null;
	collection_id: number | null;
	collection_name: string;
	linked_at: number;
};

type SearchRow = {
	series_id: number;
	query: string;
	year: number | null;
	searched_at: number | null;
	found: number;
	decision: 'none' | 'unlinked' | null;
	decided_at: number | null;
};

const linkOf = (seriesId: number) =>
	(getDb().prepare(`SELECT * FROM series_tmdb_links WHERE series_id = ?`).get(seriesId) as
		LinkRow | undefined) ?? null;

const searchOf = (seriesId: number) =>
	(getDb().prepare(`SELECT * FROM tmdb_link_searches WHERE series_id = ?`).get(seriesId) as
		SearchRow | undefined) ?? null;

/** A stored link as the TMDB entry it names. */
export const titleOfLink = (l: LinkRow): TmdbTitle => ({
	id: l.tmdb_id,
	media: l.media,
	title: l.title,
	originalTitle: l.original_title,
	year: l.year,
	overview: l.overview,
	poster: l.poster_url || null,
	runtime: l.runtime,
	seasons: l.seasons,
	collection: l.collection_id !== null ? { id: l.collection_id, name: l.collection_name } : null
});

/** The candidates the last search kept, best first. */
export function candidatesOf(seriesId: number): TmdbTitle[] {
	return (
		getDb()
			.prepare(`SELECT data FROM tmdb_link_candidates WHERE series_id = ? ORDER BY rank`)
			.all(seriesId) as { data: string }[]
	).map((r) => JSON.parse(r.data) as TmdbTitle);
}

function kindOfSeries(seriesId: number): TmdbKind | null {
	const r = getDb().prepare(`SELECT kind FROM series WHERE id = ?`).get(seriesId) as
		{ kind: Kind } | undefined;
	return r && isTmdbKind(r.kind) ? r.kind : null;
}

function titlesOfSeries(seriesId: number): { title: string; titles: string[] } {
	const r = getDb().prepare(`SELECT title, alt_titles FROM series WHERE id = ?`).get(seriesId) as
		{ title: string; alt_titles: string | null } | undefined;
	if (!r) return { title: '', titles: [] };
	return { title: r.title, titles: titlesOfRow(r) };
}

// ---- the writes ---------------------------------------------------------------------------

/**
 * What a link replaced, so UNDO puts it back: the link before it (or none),
 * and the decision it cleared. Kept by the caller (the action's answer), as
 * the AniList review's UNDO keeps its own.
 */
export type TmdbBefore = { link: LinkRow | null; decision: SearchRow['decision'] };

const beforeOf = (seriesId: number): TmdbBefore => ({
	link: linkOf(seriesId),
	decision: searchOf(seriesId)?.decision ?? null
});

function writeLink(seriesId: number, t: TmdbTitle, via: TmdbVia, now: number): void {
	const db = getDb();
	db.prepare(
		`INSERT INTO series_tmdb_links (series_id, tmdb_id, media, via, title, original_title, year,
			overview, poster_url, runtime, seasons, collection_id, collection_name, linked_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (series_id) DO UPDATE SET tmdb_id = excluded.tmdb_id, media = excluded.media,
			via = excluded.via, title = excluded.title, original_title = excluded.original_title,
			year = excluded.year, overview = excluded.overview, poster_url = excluded.poster_url,
			runtime = excluded.runtime, seasons = excluded.seasons,
			collection_id = excluded.collection_id, collection_name = excluded.collection_name,
			linked_at = excluded.linked_at`
	).run(
		seriesId,
		t.id,
		t.media,
		via,
		t.title,
		t.originalTitle,
		t.year,
		t.overview,
		t.poster ?? '',
		t.runtime,
		t.seasons,
		t.collection?.id ?? null,
		t.collection?.name ?? '',
		now
	);
	db.prepare(
		`UPDATE tmdb_link_searches SET decision = NULL, decided_at = NULL WHERE series_id = ?`
	).run(seriesId);
}

/**
 * Link a film or a show to a TMDB entry: one the owner chose in the review,
 * pasted, or the pass's sure match. The entry is read by id first, so the
 * link keeps a film's runtime and collection and a show's season count, which
 * a search result does not carry. Answers what it replaced, for UNDO.
 */
export async function tmdbLink(
	seriesId: number,
	tmdbId: number,
	via: TmdbVia,
	now = Date.now()
): Promise<TmdbBefore> {
	const kind = kindOfSeries(seriesId);
	if (!kind) throw new Error('not a film or a show');
	const t = await catalogueClient('tmdb').byId(kind, tmdbId);
	if (!t) throw new Error('no such TMDB entry');
	const before = beforeOf(seriesId);
	getDb().transaction(() => writeLink(seriesId, t, via, now))();
	return before;
}

/** UNDO a link, an UNLINK or a NONE OF THESE: what stood before comes back. */
export function tmdbUndo(seriesId: number, before: TmdbBefore): void {
	const db = getDb();
	db.transaction(() => {
		if (before.link) {
			const l = before.link;
			db.prepare(`DELETE FROM series_tmdb_links WHERE series_id = ?`).run(seriesId);
			db.prepare(
				`INSERT INTO series_tmdb_links (series_id, tmdb_id, media, via, title, original_title, year,
					overview, poster_url, runtime, seasons, collection_id, collection_name, linked_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			).run(
				seriesId,
				l.tmdb_id,
				l.media,
				l.via,
				l.title,
				l.original_title,
				l.year,
				l.overview,
				l.poster_url,
				l.runtime,
				l.seasons,
				l.collection_id,
				l.collection_name,
				l.linked_at
			);
		} else db.prepare(`DELETE FROM series_tmdb_links WHERE series_id = ?`).run(seriesId);
		decide(seriesId, before.decision, before.decision ? Date.now() : null);
	})();
}

function decide(seriesId: number, decision: SearchRow['decision'], at: number | null): void {
	const db = getDb();
	const changed = db
		.prepare(`UPDATE tmdb_link_searches SET decision = ?, decided_at = ? WHERE series_id = ?`)
		.run(decision, at, seriesId).changes;
	if (!changed && decision) {
		// Never searched (an UNLINK of a pasted link): the decision still needs its row.
		const { title } = titlesOfSeries(seriesId);
		db.prepare(
			`INSERT INTO tmdb_link_searches (series_id, query, searched_at, decision, decided_at)
			VALUES (?, ?, NULL, ?, ?)`
		).run(seriesId, tmdbQuery(title).query, decision, at);
	}
}

/**
 * UNLINK: the link goes, and so does every later pass's chance to make it
 * again. A NONE OF THESE leaves the review the same way, with no link to take.
 */
export function tmdbUnlink(seriesId: number, now = Date.now()): TmdbBefore {
	const before = beforeOf(seriesId);
	getDb().transaction(() => {
		getDb().prepare(`DELETE FROM series_tmdb_links WHERE series_id = ?`).run(seriesId);
		decide(seriesId, 'unlinked', now);
	})();
	return before;
}

export function tmdbNone(seriesId: number, now = Date.now()): TmdbBefore {
	const before = beforeOf(seriesId);
	decide(seriesId, 'none', now);
	return before;
}

// ---- searching ----------------------------------------------------------------------------

function saveSearch(
	seriesId: number,
	query: string,
	year: number | null,
	found: TmdbTitle[],
	now: number
): void {
	const db = getDb();
	db.prepare(
		`INSERT INTO tmdb_link_searches (series_id, query, year, searched_at, found)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (series_id) DO UPDATE SET query = excluded.query, year = excluded.year,
			searched_at = excluded.searched_at, found = excluded.found`
	).run(seriesId, query, year, now, found.length);
	db.prepare(`DELETE FROM tmdb_link_candidates WHERE series_id = ?`).run(seriesId);
	const put = db.prepare(
		`INSERT OR IGNORE INTO tmdb_link_candidates (series_id, tmdb_id, rank, data) VALUES (?, ?, ?, ?)`
	);
	found.forEach((t, rank) => put.run(seriesId, t.id, rank, JSON.stringify(t)));
}

/**
 * One search: the source title's query with its year, and, should a year
 * find nothing, the query alone (a source's year is sometimes the upload's).
 */
async function find(kind: TmdbKind, query: string, year: number | null): Promise<TmdbTitle[]> {
	const client = catalogueClient('tmdb');
	const hits = await client.search(kind, query, year);
	return hits.length || year === null ? hits : client.search(kind, query, null);
}

export type TmdbPassResult = { searched: number; linked: number; offered: number };

/**
 * The pass (after an import and in `yarn run links`, beside AniList's): up to
 * `limit` films and shows never searched, or waiting on a SEARCH AGAIN, are
 * searched; a sure match links (`via = 'exact'`), the rest wait in the review.
 * A hidden series is never searched (doc/LINKS.md, decision 1), a settled one
 * never again. With no key it does nothing at all.
 */
export async function tmdbPass(
	opts: { limit?: number; now?: number; log?: (line: string) => void } = {}
): Promise<TmdbPassResult> {
	const out: TmdbPassResult = { searched: 0, linked: 0, offered: 0 };
	if (!catalogueConfigured('tmdb')) return out;
	const now = opts.now ?? Date.now();
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.kind, s.title, ls.query AS queued FROM series s JOIN roots r ON r.id = s.root_id
			LEFT JOIN tmdb_link_searches ls ON ls.series_id = s.id
			WHERE ${LINKABLE} AND ${VISIBLE_SQL}
				AND NOT EXISTS (SELECT 1 FROM series_tmdb_links l WHERE l.series_id = s.id)
				AND (ls.series_id IS NULL OR (ls.searched_at IS NULL AND ls.decision IS NULL))
			ORDER BY s.id LIMIT ?`
		)
		.all(opts.limit ?? 60) as {
		id: number;
		kind: TmdbKind;
		title: string;
		queued: string | null;
	}[];
	for (const r of rows) {
		const own = tmdbQuery(r.title);
		// A SEARCH AGAIN the owner typed is asked as typed, with no year.
		const query = r.queued ?? own.query;
		const year = r.queued && r.queued !== own.query ? null : own.year;
		const found = await find(r.kind, query, year);
		const sure = tmdbSure(titlesOfSeries(r.id).titles, year, found);
		const linked = sure ? await catalogueClient('tmdb').byId(r.kind, sure.id) : null;
		getDb().transaction(() => {
			saveSearch(r.id, query, year, found, now);
			if (linked) writeLink(r.id, linked, 'exact', now);
		})();
		out.searched += 1;
		if (linked) out.linked += 1;
		else if (found.length) out.offered += 1;
	}
	if (rows.length) opts.log?.(`tmdb: ${out.searched} searched, ${out.linked} linked`);
	return out;
}

/**
 * FIND and SEARCH AGAIN from the review or the series screen: TMDB asked at
 * once with the owner's words. A search the owner runs never links by
 * itself, even on one equal title (the AniList review's rule, 2026-11-02).
 */
export async function tmdbSearchNow(
	seriesId: number,
	query: string,
	now = Date.now()
): Promise<number> {
	const q = query.trim();
	if (!q) throw new Error('a title to search');
	const kind = kindOfSeries(seriesId);
	if (!kind) throw new Error('not a film or a show');
	const own = tmdbQuery(q);
	const found = await find(kind, own.query, own.year);
	saveSearch(seriesId, q, own.year, found, now);
	return found.length;
}

// ---- what the screens read ----------------------------------------------------------------

export type TmdbLinkState = {
	/** This install has a TMDB key. Without one, every other field is empty and the line says SET UP. */
	configured: boolean;
	linked: {
		tmdbId: number;
		media: 'movie' | 'tv';
		title: string;
		year: number | null;
		via: TmdbVia;
		runtime: number | null;
		seasons: number | null;
		collection: { id: number; name: string } | null;
	} | null;
	decision: 'none' | 'unlinked' | null;
	candidates: number;
	searched: boolean;
	/** A SEARCH AGAIN waiting for the next pass. */
	queued: boolean;
	/** Hidden series are never searched: FIND is a pasted link only. */
	hidden: boolean;
};

/** The LINK state of a film or a show, or null for any other kind. */
export function tmdbLinkState(seriesId: number): TmdbLinkState | null {
	const r = getDb()
		.prepare(
			`SELECT s.kind, ${HIDDEN_SQL} AS hidden FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
		)
		.get(seriesId) as { kind: Kind; hidden: number } | undefined;
	if (!r || !isTmdbKind(r.kind)) return null;
	const l = linkOf(seriesId);
	const s = searchOf(seriesId);
	return {
		configured: catalogueConfigured('tmdb'),
		linked: l
			? {
					tmdbId: l.tmdb_id,
					media: l.media,
					title: l.title,
					year: l.year,
					via: l.via,
					runtime: l.runtime,
					seasons: l.seasons,
					collection:
						l.collection_id !== null ? { id: l.collection_id, name: l.collection_name } : null
				}
			: null,
		decision: l ? null : (s?.decision ?? null),
		candidates: l ? 0 : candidatesOf(seriesId).length,
		searched: !!s?.searched_at,
		queued: !!s && s.searched_at === null && s.decision === null,
		hidden: !!r.hidden
	};
}

/** What a linked film or show knows from TMDB, for the screen's count line and ABOUT. */
export function tmdbFacts(seriesId: number): TmdbTitle | null {
	const l = linkOf(seriesId);
	return l ? titleOfLink(l) : null;
}

/**
 * SEARCH AGAIN that waits for the pass, with the owner's words: the row's
 * search is cleared, its candidates go, and a decision stays (the owner asked
 * for a search, not to take back NONE OF THESE; FIND clears that).
 */
export function tmdbQueueSearch(seriesId: number, query: string): void {
	const db = getDb();
	db.transaction(() => {
		db.prepare(
			`INSERT INTO tmdb_link_searches (series_id, query, searched_at, found) VALUES (?, ?, NULL, 0)
			ON CONFLICT (series_id) DO UPDATE SET query = excluded.query, searched_at = NULL, found = 0,
				decision = NULL, decided_at = NULL`
		).run(seriesId, query.trim());
		db.prepare(`DELETE FROM tmdb_link_candidates WHERE series_id = ?`).run(seriesId);
	})();
}

export type TmdbReviewCandidate = TmdbTitle & { why: string; rows: Row[]; ids: string };

export type TmdbReviewItem = {
	seriesId: number;
	kind: TmdbKind;
	title: string;
	titles: string[];
	query: string;
	year: number | null;
	hidden: boolean;
	candidates: TmdbReviewCandidate[];
};

const reviewCandidate = (
	series: { titles: string[]; year: number | null },
	c: TmdbTitle
): TmdbReviewCandidate => ({
	...c,
	why: tmdbWhy(series, c),
	rows: tmdbRows(series, c),
	ids: `TMDB ${c.id}`
});

/** One film's or show's review item: its titles and what the last search found. */
export function tmdbReviewItem(seriesId: number): TmdbReviewItem | null {
	const r = getDb()
		.prepare(
			`SELECT s.id, s.kind, s.title, ${HIDDEN_SQL} AS hidden FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.id = ?`
		)
		.get(seriesId) as { id: number; kind: Kind; title: string; hidden: number } | undefined;
	if (!r || !isTmdbKind(r.kind)) return null;
	const s = searchOf(seriesId);
	const { titles } = titlesOfSeries(seriesId);
	const year = s?.year ?? tmdbQuery(r.title).year;
	return {
		seriesId: r.id,
		kind: r.kind,
		title: r.title,
		titles,
		query: s?.query ?? tmdbQuery(r.title).query,
		year,
		hidden: !!r.hidden,
		candidates: candidatesOf(seriesId).map((c) => reviewCandidate({ titles, year }, c))
	};
}

const QUEUE_SQL = (reveal: boolean) => `SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
	JOIN tmdb_link_searches ls ON ls.series_id = s.id
	WHERE ${LINKABLE} AND ${visibleWhere(reveal)} AND ls.searched_at IS NOT NULL AND ls.decision IS NULL
		AND NOT EXISTS (SELECT 1 FROM series_tmdb_links l WHERE l.series_id = s.id)`;

/**
 * The films and shows that wait for the owner: searched, not linked, not
 * settled. A search that found nothing waits too, as AniList's does, since
 * FIND with other words is what it wants.
 */
export function tmdbQueue(reveal: boolean): TmdbReviewItem[] {
	if (!catalogueConfigured('tmdb')) return [];
	return (
		getDb()
			.prepare(`${QUEUE_SQL(reveal)} ORDER BY s.title`)
			.all() as { id: number }[]
	)
		.map((r) => tmdbReviewItem(r.id))
		.filter((x): x is TmdbReviewItem => x !== null);
}

export function tmdbQueueCount(reveal: boolean): number {
	if (!catalogueConfigured('tmdb')) return 0;
	return (
		getDb()
			.prepare(`SELECT COUNT(*) AS n FROM (${QUEUE_SQL(reveal)})`)
			.get() as { n: number }
	).n;
}

/** How many films and shows are linked: the CATALOGUES line's count. */
export function tmdbLinkCount(): number {
	return (getDb().prepare(`SELECT COUNT(*) AS n FROM series_tmdb_links`).get() as { n: number }).n;
}
