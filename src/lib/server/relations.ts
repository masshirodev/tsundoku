import type Database from 'better-sqlite3';
import { getDb } from './db.ts';
import { libraryWhere } from './visibility.ts';
import { kindFacts } from '../library/kinds.ts';
import { candidateKind, sameKind } from '../library/catalogue.ts';
import type { Kind } from '../library/types.ts';
import {
	HOPS,
	formFacts,
	formNodes,
	relTitle,
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
 * (`refreshRelations`, from `refreshLinks` and the background fill in
 * catalogue.ts and relations-fill.ts); the series screen reads it
 * (`seasonsAroundOf`) and never waits on AniList.
 *
 * Imports are relative and extension-ful: catalogue.ts is reached from
 * `scripts/` (tests/strip-types-db.spec.ts). Nothing here imports catalogue.ts,
 * which imports this: the pass hands in its own `ask`.
 */

/** One AniList request, as catalogue.ts' `anilistPublic` makes it: data, or a throw. */
export type Ask = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

/** A graph older than this is asked for again: a sequel announced, a season airing. */
export const RELATIONS_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How long the background fill leaves a series whose last ask failed (doc/LINKS.md,
 * "How the cache fills"). A dead link stays due for good (`relationsStale`), so
 * without this the fill would ask it every tick, forever. A link made since the
 * failed ask is another question, and is not kept waiting (`waitsItsTurn`).
 */
export const RELATIONS_RETRY_MS = 24 * 60 * 60 * 1000;
/** Rounds of requests one walk may take: back and forward each step once a round. */
const MAX_ROUNDS = HOPS + 2;

const NODE_FIELDS = `id type format status episodes chapters volumes startDate { year } title { english romaji native }`;

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
	chapters: m.chapters ?? null,
	volumes: m.volumes ?? null,
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

/** Whether a stored format names a kind other than the series'. Unknown says nothing. */
const otherKinds = (kind: Kind, format: string | null) => {
	const k = format ? candidateKind({ format, country: '' }) : null;
	return k !== null && !sameKind(kind, k);
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
			`SELECT season, anilist_id, format FROM series_season_links
			WHERE series_id = ? AND anilist_id IS NOT NULL ORDER BY season, part`
		)
		.all(seriesId) as { season: number; anilist_id: number; format: string | null }[];
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
		heldAfter: last.season > 0 ? held.filter((x) => x > last.season).length : 0,
		// `type: ANIME` can't answer a link stored as another kind's, and one
		// such id costs every other entry of the request its answer (`askEntries`).
		others: [
			...new Set(links.filter((l) => !otherKinds(s.kind, l.format)).map((l) => l.anilist_id))
		].filter((id) => id !== first.anilist_id && id !== last.anilist_id)
	};
}

/** The comics' and novels' catalogue, asked of the registry: linked in AniList's MANGA. */
const inMangaCatalogue = (kind: Kind) => {
	const c = kindFacts(kind).catalogue;
	return c.provider === 'anilist' && c.type === 'MANGA';
};

/**
 * A comic's or a novel's own AniList entry, for OTHER FORMS (c700): its link,
 * unless that entry is another kind's. A novel linked to its comic only for the
 * cover would otherwise read the comic's relations as its own.
 */
function ownEntry(
	r: { kind: Kind; anilist: number | null; format: string | null } | undefined
): number | null {
	if (!r || r.anilist === null || !r.format || !inMangaCatalogue(r.kind)) return null;
	return sameKind(r.kind, candidateKind({ format: r.format, country: '' })) ? r.anilist : null;
}

/** One request for these entries, several to a request (aliases); null for one not answered. */
async function askEntries(
	ids: number[],
	type: 'ANIME' | 'MANGA',
	ask: Ask
): Promise<Map<number, Answered | null>> {
	const unique = [...new Set(ids)];
	const query = `query (${unique.map((_, i) => `$i${i}: Int`).join(', ')}) {
		${unique
			.map(
				(_, i) =>
					`m${i}: Media(id: $i${i}, type: ${type}) { ${NODE_FIELDS} relations { edges { relationType node { ${NODE_FIELDS} } } } }`
			)
			.join('\n')}
	}`;
	const data = (await ask(
		query,
		Object.fromEntries(unique.map((id, i) => [`i${i}`, id]))
	)) as Record<string, Answered | null> | null;
	return new Map(
		unique.map((id, i) => {
			const m = data?.[`m${i}`];
			return [id, m && m.id === id ? m : null];
		})
	);
}

/**
 * Whether a request of several answered nothing at all. AniList voids the
 * whole request when one id can't be answered (HTTP 404, every alias null, the
 * good ones too; measured 2026-11-08, quoted in tests/other-forms-db.spec.ts),
 * so this says only that one of them is dead, not which.
 */
const voided = (answers: Map<number, Answered | null>) =>
	answers.size > 1 && [...answers.values()].every((m) => !m);

/**
 * Ask a voided request's entries one at a time, into `answers`, stopping at
 * the first one `required` says the caller can't do without.
 */
async function askAlone(
	answers: Map<number, Answered | null>,
	type: 'ANIME' | 'MANGA',
	ask: Ask,
	required: (id: number) => boolean = () => false
): Promise<void> {
	for (const id of answers.keys()) {
		const m = (await askEntries([id], type, ask)).get(id) ?? null;
		answers.set(id, m);
		if (!m && required(id)) return;
	}
}

/**
 * Ask AniList for the entries the walk needs, with their edges, and walk again
 * until it needs nothing. A walk that still needs entries after `MAX_ROUNDS`,
 * or a `first`, a `last` or a need of the walk's that AniList answers nothing
 * for, is not a graph: null, and the cache keeps what it had. An `others` id
 * is best effort (c700, round 2): it only adds OTHER FORMS' reach from that
 * season, so one AniList can't answer (deleted, or another catalogue's) is
 * left out and named in the graph's `unanswered`, for `relationsStale`.
 */
export async function fetchGraph(from: WalkFrom, ask: Ask): Promise<RelGraph | null> {
	const graph: RelGraph = { nodes: {} };
	const others = new Set(from.others ?? []);
	const unanswered = new Set<number>();
	let needs = [...new Set([from.first, from.last, ...others])];
	for (let round = 0; needs.length; round++) {
		if (round >= MAX_ROUNDS) return null;
		const answers = await askEntries(needs, 'ANIME', ask);
		// Only the first round holds an `others`: without one, a void is a dead
		// `first`, `last` or need, and the walk fails as it did before them.
		if (round === 0 && others.size && voided(answers))
			await askAlone(answers, 'ANIME', ask, (id) => !others.has(id));
		for (const id of needs) {
			const m = answers.get(id);
			if (!m) {
				// A later round is the walk standing on it: that is a need.
				if (round > 0 || !others.has(id)) return null;
				unanswered.add(id);
				continue;
			}
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
	if (unanswered.size) graph.unanswered = [...unanswered];
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
 * anime) needs nothing. A middle season the graph records as `unanswered` is
 * not a need: it waits for the seven days with the rest of the graph, and a
 * relink is another id, which the record doesn't name, so it is asked at once.
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
	const unanswered = new Set(graph.unanswered ?? []);
	if ((from.others ?? []).some((id) => !unanswered.has(id) && !graph.nodes[String(id)]?.edges))
		return true;
	return now - row.fetched_at >= RELATIONS_STALE_MS;
}

export type RelationsPass = { refreshed: number; failed: number; dropped: number };

/**
 * Whether a series the fill would otherwise ask has to wait: its last ask
 * failed (asked since its graph was stored, or no graph ever), under `retryMs`
 * ago, and no link has been made since. Only a stamp `tried_at` wrote with no
 * `fetched_at` beside it says "failed": `store` writes the two as one value.
 */
const waitsItsTurn = (
	r: { tried: number | null; fetched: number | null; linked: number },
	now: number,
	retryMs: number | undefined
) =>
	retryMs !== undefined &&
	r.tried !== null &&
	(r.fetched === null || r.tried > r.fetched) &&
	now - r.tried < retryMs &&
	r.linked <= r.tried;

/** A pass with no series left to it: a row whose series has no link any more (UNLINK). */
const ORPHANED = `series_id NOT IN (SELECT series_id FROM series_season_links WHERE anilist_id IS NOT NULL)
	AND series_id NOT IN (SELECT series_id FROM series_links WHERE anilist_id IS NOT NULL)`;

/** Where `refreshLinks` says it is running, in any process (the 2.1 s queue is per process). */
const LINK_PASS_KEY = 'link_pass_until';
/** Long enough for a step of the pass; a pass that dies stops counting after this. */
const LINK_PASS_LEASE_MS = 15 * 60 * 1000;

/**
 * Say a link pass is running, and until when; renewed as it goes. Best effort:
 * a database too busy to say so must not cost the pass itself, and the worst
 * that follows is the two passes sharing AniList's limit for a while.
 */
export function markLinkPass(now = Date.now(), db: Database.Database = getDb()): void {
	try {
		db.prepare(
			`INSERT INTO settings (key, value) VALUES (?, ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`
		).run(LINK_PASS_KEY, String(now + LINK_PASS_LEASE_MS));
	} catch {
		// See above: not the pass's to fail on.
	}
}

export function clearLinkPass(db: Database.Database = getDb()): void {
	try {
		db.prepare(`DELETE FROM settings WHERE key = ?`).run(LINK_PASS_KEY);
	} catch {
		// It ends by itself (`LINK_PASS_LEASE_MS`).
	}
}

/** Whether a link pass is running somewhere, so the background fill stands aside. */
export function linkPassRunning(now = Date.now(), db: Database.Database = getDb()): boolean {
	const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(LINK_PASS_KEY) as
		{ value: string } | undefined;
	return row !== undefined && Number(row.value) > now;
}

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
		/** The background fill's patience with a series that failed (`waitsItsTurn`). */
		retryMs?: number;
		/** Checked before each series: true ends the pass where it stands, and is no failure. */
		stop?: () => boolean;
	} = {},
	db: Database.Database = getDb()
): Promise<RelationsPass> {
	const now = opts.now ?? Date.now();
	const out: RelationsPass = { refreshed: 0, failed: 0, dropped: 0 };
	// Looked for first: an idle tick of the fill takes no write lock.
	if (db.prepare(`SELECT 1 FROM series_relations WHERE ${ORPHANED} LIMIT 1`).get())
		out.dropped = db.prepare(`DELETE FROM series_relations WHERE ${ORPHANED}`).run().changes;
	const rows = db
		.prepare(
			`SELECT l.series_id AS id, r.tried_at AS tried, r.fetched_at AS fetched,
				MAX(l.linked_at) AS linked
			FROM series_season_links l
			LEFT JOIN series_relations r ON r.series_id = l.series_id
			WHERE l.anilist_id IS NOT NULL
			GROUP BY l.series_id
			ORDER BY r.tried_at IS NOT NULL, r.tried_at, l.series_id`
		)
		.all() as { id: number; tried: number | null; fetched: number | null; linked: number }[];
	const due = rows
		.filter((r) => !waitsItsTurn(r, now, opts.retryMs) && relationsStale(r.id, now, db))
		.slice(0, opts.limit ?? 10);
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
		if (opts.stop?.()) break;
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
	const comics = opts.stop?.()
		? { asked: 0, refreshed: 0, failed: 0 }
		: await refreshComics(ask, { ...opts, now }, stamp, store, db);
	out.refreshed += comics.refreshed;
	out.failed += comics.failed;
	if (due.length || comics.asked)
		opts.log?.(
			`relations: ${out.refreshed} of ${due.length + comics.asked} refreshed, ${out.failed} failed`
		);
	return out;
}

/**
 * The comics' and novels' step of the pass (c700): one more ask, in AniList's
 * MANGA catalogue, of up to `limit` series whose one-hop graph is missing, for
 * another entry, or old. It shares the table and the staleness of the anime
 * walk; it has its own `limit`, so a large library of comics cannot keep an
 * anime from its turn. Never called on a page load.
 */
async function refreshComics(
	ask: Ask,
	opts: { limit?: number; now: number; fatal?: (e: unknown) => boolean; retryMs?: number },
	stamp: Database.Statement,
	store: Database.Statement,
	db: Database.Database
): Promise<{ asked: number; refreshed: number; failed: number }> {
	const rows = db
		.prepare(
			`SELECT l.series_id AS id, l.anilist_id AS anilist, l.format, s.kind,
				r.fetched_at AS fetched, r.tried_at AS tried, l.linked_at AS linked
			FROM series_links l JOIN series s ON s.id = l.series_id
			LEFT JOIN series_relations r ON r.series_id = l.series_id
			WHERE l.anilist_id IS NOT NULL
			ORDER BY r.tried_at IS NOT NULL, r.tried_at, l.series_id`
		)
		.all() as {
		id: number;
		anilist: number;
		format: string | null;
		kind: Kind;
		fetched: number | null;
		tried: number | null;
		linked: number;
	}[];
	const fresh = (r: (typeof rows)[number]) =>
		r.fetched !== null &&
		opts.now - r.fetched < RELATIONS_STALE_MS &&
		!!cached(r.id, db)?.nodes[String(r.anilist)]?.edges;
	const due = rows
		.filter((r) => ownEntry(r) !== null && !waitsItsTurn(r, opts.now, opts.retryMs) && !fresh(r))
		.slice(0, opts.limit ?? 10);
	if (!due.length) return { asked: 0, refreshed: 0, failed: 0 };
	let answers = new Map<number, Answered | null>();
	try {
		answers = await askEntries(
			due.map((r) => r.anilist),
			'MANGA',
			ask
		);
		// One dead link must not cost the other nine their answers (`voided`).
		if (voided(answers)) await askAlone(answers, 'MANGA', ask);
	} catch (e) {
		if (opts.fatal?.(e)) throw e;
		console.error('tsundoku: comics’ relations could not be fetched:', e);
	}
	let refreshed = 0;
	for (const r of due) {
		const m = answers.get(r.anilist);
		// The link may have moved while AniList answered.
		const now = db
			.prepare(`SELECT anilist_id AS anilist FROM series_links WHERE series_id = ?`)
			.get(r.id) as { anilist: number | null } | undefined;
		if (!m || now?.anilist !== r.anilist) {
			stamp.run(r.id, opts.now);
			continue;
		}
		const edges = (m.relations?.edges ?? []).filter((e) => e?.node?.id);
		const graph: RelGraph = {
			nodes: {
				[String(m.id)]: asNode(
					m,
					edges.map((e) => ({ type: e.relationType, id: e.node.id }))
				)
			}
		};
		for (const e of edges)
			if (!graph.nodes[String(e.node.id)]) graph.nodes[String(e.node.id)] = asNode(e.node, null);
		store.run(r.id, JSON.stringify(graph), opts.now, opts.now);
		refreshed += 1;
	}
	return { asked: due.length, refreshed, failed: due.length - refreshed };
}

/** One other form of a series' work, as the list's line draws it (c700). */
export type OtherForm = {
	anilistId: number;
	/** The library kind it would be: what FIND asks SEARCH THE SOURCES for. */
	kind: Kind;
	/** `MANGA`, `LIGHT NOVEL`, `ONE-SHOT`, `ANIME`. */
	word: string;
	title: string;
	facts: string[];
	/** Another series' own link to this entry, under the reveal filter; null is FIND. */
	seriesId: number | null;
};

/** The word a form goes by. An anime's format is detail, so all of them read ANIME. */
const formWord = (format: string, kind: Kind): string =>
	kindFacts(kind).medium === 'video'
		? 'ANIME'
		: format === 'NOVEL'
			? 'LIGHT NOVEL'
			: format.replace(/_/g, '-');

/**
 * The same work's other forms, for the series screen (c700): from the cache
 * alone, never AniList, and one hop from the series' own entry or from each
 * season's. In the library means another series whose own link names that
 * entry and whose kind is that form's, never a title, and a hidden series is
 * not one outside reveal. Null where there is nothing to draw.
 */
export function otherFormsOf(
	seriesId: number,
	reveal: boolean,
	db: Database.Database = getDb()
): OtherForm[] | null {
	const s = db.prepare(`SELECT kind FROM series WHERE id = ?`).get(seriesId) as
		{ kind: Kind } | undefined;
	if (!s) return null;
	const link = db
		.prepare(`SELECT anilist_id AS anilist, format FROM series_links WHERE series_id = ?`)
		.get(seriesId) as { anilist: number | null; format: string | null } | undefined;
	const own = link ? ownEntry({ kind: s.kind, ...link }) : null;
	const starts = inAnimeCatalogue(s.kind)
		? (
				db
					.prepare(
						`SELECT DISTINCT anilist_id AS id FROM series_season_links
						WHERE series_id = ? AND anilist_id IS NOT NULL`
					)
					.all(seriesId) as { id: number }[]
			).map((r) => r.id)
		: own !== null
			? [own]
			: [];
	if (!starts.length) return null;
	const graph = cached(seriesId, db);
	if (!graph) return null;
	const kindOf = (format: string | null) =>
		format ? candidateKind({ format, country: '' }) : null;
	const nodes = formNodes(graph, starts, (n) => {
		const k = kindOf(n.format);
		return k !== null && !sameKind(s.kind, k);
	});
	if (!nodes.length) return null;
	const ids = nodes.map((n) => n.id);
	const marks = ids.map(() => '?').join(',');
	const holders = db
		.prepare(
			`SELECT x.anilist, x.series, s.kind FROM (
				SELECT anilist_id AS anilist, series_id AS series FROM series_season_links WHERE anilist_id IN (${marks})
				UNION SELECT anilist_id, series_id FROM series_links WHERE anilist_id IN (${marks})
			) x JOIN series s ON s.id = x.series JOIN roots r ON r.id = s.root_id
			WHERE x.series != ? AND ${libraryWhere(reveal)}
			ORDER BY x.series`
		)
		.all(...ids, ...ids, seriesId) as { anilist: number; series: number; kind: Kind }[];
	return nodes.map((n) => {
		const kind = kindOf(n.format)!;
		return {
			anilistId: n.id,
			kind,
			word: formWord(n.format!, kind),
			title: relTitle(n),
			facts: formFacts(n),
			// A link can be another kind's (a novel on its comic's entry, for the
			// cover): that series is not this form.
			seriesId: holders.find((h) => h.anilist === n.id && sameKind(h.kind, kind))?.series ?? null
		};
	});
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
