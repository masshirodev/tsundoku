import type Database from 'better-sqlite3';
import { getDb } from './db.ts';
import { libraryWhere } from './visibility.ts';
import { kindFacts } from '../library/kinds.ts';
import type { Kind } from '../library/types.ts';
import {
	HOPS,
	seasonsAround,
	walkSeasons,
	type RelGraph,
	type RelNode,
	type SeasonsAround,
	type WalkFrom
} from '../library/seasons-around.ts';

/**
 * An anime's AniList relation graph, cached (card c358; doc/LINKS.md, "The
 * relation cache"; rung 73, `series_relations`). The link pass fills it
 * (`refreshRelations`, called by `refreshLinks` in catalogue.ts); the series
 * screen reads it (`seasonsAroundOf`) and never waits on AniList.
 *
 * Imports are relative and extension-ful: catalogue.ts is reached from
 * `scripts/` (tests/strip-types-db.spec.ts). Nothing here imports catalogue.ts,
 * which imports this: the pass hands in its own `ask`.
 */

/** One AniList request, as catalogue.ts' `anilistPublic` makes it: data, or a throw. */
export type Ask = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

/** A graph older than this is asked for again: a sequel announced, a season airing. */
export const RELATIONS_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Rounds of requests one walk may take: back and forward each step once a round. */
const MAX_ROUNDS = HOPS + 2;

const NODE_FIELDS = `id type format status episodes startDate { year } title { english romaji native }`;

type Answered = Omit<RelNode, 'edges' | 'year'> & {
	startDate: { year: number | null } | null;
	relations: { edges: { relationType: string; node: Omit<Answered, 'relations'> }[] } | null;
};

const asNode = (m: Omit<Answered, 'relations'>, edges: RelNode['edges']): RelNode => ({
	id: m.id,
	type: m.type ?? null,
	format: m.format ?? null,
	status: m.status ?? null,
	episodes: m.episodes ?? null,
	year: m.startDate?.year ?? null,
	title: {
		english: m.title?.english ?? null,
		romaji: m.title?.romaji ?? null,
		native: m.title?.native ?? null
	},
	edges
});

/** The anime catalogue's rule, asked of the registry (doc/KINDS.md): linked in AniList's ANIME. */
const inAnimeCatalogue = (kind: Kind) => {
	const c = kindFacts(kind).catalogue;
	return c.provider === 'anilist' && c.type === 'ANIME';
};

/**
 * Where a series' walk starts, from its own season links: back from the
 * earliest linked season, forward from the latest, and the seasons it holds
 * beyond those that no link names. Null for a series with no AniList id on
 * any season, and for one not in the anime catalogue: no chain to read.
 */
export function walkFrom(seriesId: number, db: Database.Database = getDb()): WalkFrom | null {
	const s = db.prepare(`SELECT kind FROM series WHERE id = ?`).get(seriesId) as
		{ kind: Kind } | undefined;
	if (!s || !inAnimeCatalogue(s.kind)) return null;
	const links = db
		.prepare(
			`SELECT season, anilist_id FROM series_season_links
			WHERE series_id = ? AND anilist_id IS NOT NULL ORDER BY season, part`
		)
		.all(seriesId) as { season: number; anilist_id: number }[];
	if (!links.length) return null;
	const first = links[0];
	const last = links[links.length - 1];
	const held = (
		db
			.prepare(
				`SELECT DISTINCT season FROM entries WHERE series_id = ? AND season IS NOT NULL AND season > 0`
			)
			.all(seriesId) as { season: number }[]
	).map((r) => r.season);
	return {
		first: first.anilist_id,
		last: last.anilist_id,
		// A flat list (season 0) has no seasons beside it to count.
		heldBefore: first.season > 0 ? held.filter((x) => x < first.season).length : 0,
		heldAfter: last.season > 0 ? held.filter((x) => x > last.season).length : 0
	};
}

/**
 * Ask AniList for the entries the walk needs, with their edges, several to a
 * request (aliases), and walk again until it needs nothing. A walk that still
 * needs entries after `MAX_ROUNDS`, or an entry AniList answers nothing for,
 * is not a graph: null, and the cache keeps what it had.
 */
export async function fetchGraph(from: WalkFrom, ask: Ask): Promise<RelGraph | null> {
	const graph: RelGraph = { nodes: {} };
	let needs = [...new Set([from.first, from.last])];
	for (let round = 0; needs.length; round++) {
		if (round >= MAX_ROUNDS) return null;
		const vars = Object.fromEntries(needs.map((id, i) => [`i${i}`, id]));
		const query = `query (${needs.map((_, i) => `$i${i}: Int`).join(', ')}) {
			${needs
				.map(
					(_, i) =>
						`m${i}: Media(id: $i${i}, type: ANIME) { ${NODE_FIELDS} relations { edges { relationType node { ${NODE_FIELDS} } } } }`
				)
				.join('\n')}
		}`;
		const data = (await ask(query, vars)) as Record<string, Answered | null> | null;
		for (const [i, id] of needs.entries()) {
			const m = data?.[`m${i}`];
			if (!m || m.id !== id) return null;
			const edges = (m.relations?.edges ?? []).filter((e) => e?.node?.id);
			graph.nodes[String(id)] = asNode(
				m,
				edges.map((e) => ({ type: e.relationType, id: e.node.id }))
			);
			// A neighbour's own facts come with the edge; its edges only when the walk asks.
			for (const e of edges)
				if (!graph.nodes[String(e.node.id)]) graph.nodes[String(e.node.id)] = asNode(e.node, null);
		}
		needs = walkSeasons(graph, from).needs;
	}
	return graph;
}

type CacheRow = { graph: string | null; fetched_at: number | null; tried_at: number };

function cached(seriesId: number, db: Database.Database): RelGraph | null {
	const row = db.prepare(`SELECT graph FROM series_relations WHERE series_id = ?`).get(seriesId) as
		Pick<CacheRow, 'graph'> | undefined;
	if (!row?.graph) return null;
	try {
		return JSON.parse(row.graph) as RelGraph;
	} catch {
		return null;
	}
}

/**
 * Whether a series' cache can't answer for it now: none yet, a graph that
 * needs entries it doesn't hold (a relink, a season linked since), or one
 * older than `RELATIONS_STALE_MS`. A series with no walk (unlinked, not an
 * anime) needs nothing.
 */
export function relationsStale(
	seriesId: number,
	now = Date.now(),
	db: Database.Database = getDb()
): boolean {
	const from = walkFrom(seriesId, db);
	if (!from) return false;
	const row = db
		.prepare(`SELECT graph, fetched_at FROM series_relations WHERE series_id = ?`)
		.get(seriesId) as Pick<CacheRow, 'graph' | 'fetched_at'> | undefined;
	const graph = cached(seriesId, db);
	if (!row?.fetched_at || !graph) return true;
	if (walkSeasons(graph, from).needs.length) return true;
	return now - row.fetched_at >= RELATIONS_STALE_MS;
}

export type RelationsPass = { refreshed: number; failed: number; dropped: number };

/**
 * The pass's step (called by `refreshLinks`): up to `limit` anime series whose
 * cache can't answer for them, the ones never asked first, then by when they
 * were last asked, each walked afresh and stored when the walk ends. A walk
 * that fails (AniList answering nothing, an error) keeps the graph the series
 * had and moves only `tried_at`, so the next pass asks the others first. An
 * `Unreachable` (catalogue.ts) is not caught here: the pass stops and the next
 * one carries on, as it does for the links. A cache whose series has no link
 * any more (UNLINK) is dropped, so a reader never meets a graph for a link
 * the series doesn't have.
 */
export async function refreshRelations(
	ask: Ask,
	opts: {
		limit?: number;
		now?: number;
		log?: (line: string) => void;
		/** Whether a failure is the pass's to stop on (catalogue.ts' `Unreachable`). */
		fatal?: (e: unknown) => boolean;
	} = {},
	db: Database.Database = getDb()
): Promise<RelationsPass> {
	const now = opts.now ?? Date.now();
	const out: RelationsPass = { refreshed: 0, failed: 0, dropped: 0 };
	out.dropped = db
		.prepare(
			`DELETE FROM series_relations WHERE series_id NOT IN
				(SELECT series_id FROM series_season_links WHERE anilist_id IS NOT NULL)`
		)
		.run().changes;
	const rows = db
		.prepare(
			`SELECT DISTINCT l.series_id AS id, r.tried_at AS tried FROM series_season_links l
			LEFT JOIN series_relations r ON r.series_id = l.series_id
			WHERE l.anilist_id IS NOT NULL
			ORDER BY r.tried_at IS NOT NULL, r.tried_at, l.series_id`
		)
		.all() as { id: number; tried: number | null }[];
	const due = rows.filter((r) => relationsStale(r.id, now, db)).slice(0, opts.limit ?? 10);
	const stamp = db.prepare(
		`INSERT INTO series_relations (series_id, tried_at) VALUES (?, ?)
		ON CONFLICT (series_id) DO UPDATE SET tried_at = excluded.tried_at`
	);
	const store = db.prepare(
		`INSERT INTO series_relations (series_id, graph, fetched_at, tried_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (series_id) DO UPDATE SET graph = excluded.graph,
			fetched_at = excluded.fetched_at, tried_at = excluded.tried_at`
	);
	for (const { id } of due) {
		const from = walkFrom(id, db);
		if (!from) continue;
		let graph: RelGraph | null = null;
		try {
			graph = await fetchGraph(from, ask);
		} catch (e) {
			if (opts.fatal?.(e)) throw e;
			console.error('tsundoku: an anime’s relations could not be fetched:', id, e);
		}
		// The links may have moved while AniList answered: store only a graph
		// that answers for the links the series has now.
		const still = walkFrom(id, db);
		if (graph && still && !walkSeasons(graph, still).needs.length) {
			store.run(id, JSON.stringify(graph), now, now);
			out.refreshed += 1;
		} else {
			stamp.run(id, now);
			out.failed += 1;
		}
	}
	if (due.length)
		opts.log?.(`relations: ${out.refreshed} of ${due.length} refreshed, ${out.failed} failed`);
	return out;
}

/**
 * The seasons around a series, for its screen: from the cache alone, never
 * AniList. Null where there is nothing to draw: not an anime in AniList's
 * anime catalogue, no season linked, no graph yet, or a graph that can't
 * answer for the links the series has now (until the next pass). "In the
 * library" is another series' own season link for that entry, under the
 * reveal filter, never a title.
 */
export function seasonsAroundOf(
	seriesId: number,
	reveal: boolean,
	db: Database.Database = getDb()
): SeasonsAround | null {
	const from = walkFrom(seriesId, db);
	if (!from) return null;
	const graph = cached(seriesId, db);
	if (!graph) return null;
	const walked = walkSeasons(graph, from);
	if (walked.needs.length) return null;
	const ids = [...walked.before, ...(walked.next === null ? [] : [walked.next]), ...walked.extras];
	const inLibrary = new Map<number, number>();
	if (ids.length) {
		const rows = db
			.prepare(
				`SELECT l.anilist_id AS anilist, MIN(l.series_id) AS series FROM series_season_links l
				JOIN series s ON s.id = l.series_id JOIN roots r ON r.id = s.root_id
				WHERE l.anilist_id IN (${ids.map(() => '?').join(',')}) AND l.series_id != ?
					AND ${libraryWhere(reveal)}
				GROUP BY l.anilist_id`
			)
			.all(...ids, seriesId) as { anilist: number; series: number }[];
		for (const r of rows) inLibrary.set(r.anilist, r.series);
	}
	const title = (db.prepare(`SELECT title FROM series WHERE id = ?`).get(seriesId) as {
		title: string;
	})!.title;
	return seasonsAround(graph, walked, { title, inLibrary });
}
