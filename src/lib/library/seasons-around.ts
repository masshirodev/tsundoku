/**
 * The seasons around an anime series (card c358; doc/SERIES.md, "The seasons
 * around it"; doc/LINKS.md, "The relation cache"): every TV season before the
 * ones the series holds, the one after, and the extras met on the way, read
 * from AniList's relation graph as the cache keeps it. Pure: no database, no
 * network. `src/lib/server/relations.ts` fetches the graph and stores it;
 * this walks it, says which entries it still needs, and draws the heads.
 *
 * What counts (the owner, 2026-11-03):
 *
 * - **the seasons** are the chain of PREQUEL edges back and SEQUEL edges
 *   forward, through entries whose format is TV, TV_SHORT or ONA. A MOVIE, an
 *   OVA or a SPECIAL standing on that chain is passed through and kept as an
 *   extra; it is never a season;
 * - **the extras** are what the walk meets beside the chain: a chain entry
 *   that isn't a season, a SIDE_STORY of any entry the walk stood on, and the
 *   other branch where a chain forks. Never followed further: a side story's
 *   own sequel is the side story's;
 * - **numbering** is the position along the chain of seasons (S1 is its first
 *   season entry), never a number read from a title, and only for the seasons
 *   before: the one after is `NEXT SEASON`, always, whether or not AniList
 *   knows one.
 *
 * AniList answers every edge an entry has, both ways, and chains loop and
 * branch, so the walk keeps a visited set, never takes an edge that goes
 * back in time (a PREQUEL starting after, a SEQUEL starting before: a loop's
 * closing edge; an announced entry starts after every one that has aired,
 * and an aired one AniList leaves undated starts no earlier than the seasons
 * it follows, `startsBy`), and stops after `HOPS` steps either way. A walk back stopped by the limit is
 * `truncated`, and its seasons are drawn unnumbered, since the first season
 * is not known. A walk forward stopped by it knows no season after, and says
 * so as AniList knowing none.
 */

/** A season's formats: what the chain of seasons is made of. */
export const SEASON_FORMATS: readonly string[] = ['TV', 'TV_SHORT', 'ONA'];
/** Every format an extra can have: the seasons' and the ones that are never a season. */
export const ANIME_FORMATS: readonly string[] = [...SEASON_FORMATS, 'MOVIE', 'OVA', 'SPECIAL'];
/** The steps the walk takes at most either way, so a long or broken chain ends. */
export const HOPS = 12;

/** An AniList entry as a relation edge's `node` answers it. */
export type RelNode = {
	id: number;
	type: string | null;
	format: string | null;
	status: string | null;
	episodes: number | null;
	/** A comic's or a novel's counts (c700); absent from a graph cached before them. */
	chapters?: number | null;
	volumes?: number | null;
	year: number | null;
	title: { english: string | null; romaji: string | null; native: string | null };
	/** Its own edges, once the entry was asked about; null for one only seen as a neighbour. */
	edges: { type: string; id: number }[] | null;
};

/** The cache's graph: every entry the walk met, by id. */
export type RelGraph = {
	nodes: Record<string, RelNode>;
	/**
	 * Linked middle seasons AniList answered nothing for when this graph was
	 * fetched (deleted, or another catalogue's): not asked again until the graph
	 * is. Absent when there are none, and from a graph cached before it.
	 */
	unanswered?: number[];
};

/**
 * Where the walk starts: the series' earliest linked entry (back from it) and
 * its latest (forward from it), and how many seasons the series holds beyond
 * them that no link names, which the walk steps over rather than offering a
 * season the series already has (doc/SERIES.md).
 */
export type WalkFrom = {
	first: number;
	last: number;
	/** Seasons the series holds before its first linked one, unlinked. */
	heldBefore: number;
	/** Seasons the series holds after its last linked one, unlinked. */
	heldAfter: number;
	/**
	 * The other seasons it has linked, between `first` and `last`: asked with
	 * their edges too, since OTHER FORMS reads one hop from each (c700). Best
	 * effort: one AniList can't answer doesn't fail the walk (`fetchGraph`).
	 */
	others?: number[];
};

export type Walked = {
	/** The seasons before `first`, the chain's first season first. */
	before: number[];
	/** The seasons on the chain before `first`, those the series holds included. */
	firstAt: number;
	/** The season after `last`, or null where AniList knows none. */
	next: number | null;
	/** Extras met, in the order they were met; never a season of the chain or the series' own. */
	extras: number[];
	/** Entries the walk stood on whose edges the graph doesn't hold yet: asked for before it can end. */
	needs: number[];
	/** A walk back stopped by `HOPS`: the chain went on, so the seasons before can't be numbered. */
	truncated: boolean;
};

const isAnime = (n: RelNode | undefined): n is RelNode =>
	!!n && (n.type === null || n.type === 'ANIME') && ANIME_FORMATS.includes(n.format ?? '');
export const isSeason = (n: RelNode | undefined): boolean =>
	!!n && SEASON_FORMATS.includes(n.format ?? '');

/**
 * When an entry starts, for the walk's loop cut: later than every year for
 * one AniList has announced (NOT_YET_RELEASED), dated or not, since an entry
 * that hasn't aired starts after every one that has; else its year, or null
 * for one that has aired (or stopped: RELEASING, FINISHED, CANCELLED,
 * HIATUS) that AniList leaves undated, mostly specials, OVAs and ONAs.
 */
export const when = (n: Pick<RelNode, 'status' | 'year'>): number | null =>
	n.status === 'NOT_YET_RELEASED' ? Infinity : n.year;

/**
 * When an entry starts, at the earliest, as the walk ranks it: `when`, and
 * for an aired entry AniList leaves undated, the latest start among its own
 * PREQUEL neighbours that have aired, since it can't start before a season
 * it follows (an undated neighbour counted by its own bound, so two undated
 * entries in a row are bounded by the dated one before them). `null` only
 * for one with no such neighbour, or whose edges the graph doesn't hold yet.
 * Without the bound, an undated aired entry closing a loop (a FINISHED last
 * season or OVA naming season 1 its SEQUEL) had no rank, its edges were all
 * taken, and the walk back from season 1 went round the chain (c358, round
 * 3's review). A lower bound, not a date: compared as one, it only ever cuts
 * an edge into the past of something the entry follows.
 */
export function startsBy(graph: RelGraph): (n: RelNode) => number | null {
	const known = new Map<number, number | null>();
	const rank = (n: RelNode): number | null => {
		const w = when(n);
		if (w !== null) return w;
		if (known.has(n.id)) return known.get(n.id)!;
		// Seen before its answer: an undated cycle bounds nothing.
		known.set(n.id, null);
		let bound: number | null = null;
		for (const e of n.edges ?? []) {
			if (e.type !== 'PREQUEL') continue;
			const p = graph.nodes[String(e.id)];
			if (!p || p.status === 'NOT_YET_RELEASED') continue;
			const r = rank(p);
			if (r !== null && (bound === null || r > bound)) bound = r;
		}
		known.set(n.id, bound);
		return bound;
	};
	return rank;
}

/**
 * Walk the graph from the series' own entries: back along PREQUEL to the
 * chain's start, forward along SEQUEL to the season after. Where an entry has
 * two edges the walk could take, a season goes before a movie or an OVA, then
 * AniList's own order; the others are extras. An entry the walk must stand on
 * whose edges the graph lacks is named in `needs`, and the walk stops there,
 * so a fetcher asks for those and walks again (relations.ts), and a reader
 * that finds `needs` not empty knows the cache can't say (a relink, a season
 * linked since the graph was fetched).
 */
export function walkSeasons(graph: RelGraph, from: WalkFrom): Walked {
	const node = (id: number) => graph.nodes[String(id)];
	const visited = new Set<number>([from.first, from.last]);
	const extras: number[] = [];
	const needs: number[] = [];
	let truncated = false;
	const extra = (id: number) => {
		if (visited.has(id) || !isAnime(node(id))) return;
		visited.add(id);
		extras.push(id);
	};
	/** The edges of a kind, to anime the walk hasn't met: a season first, then AniList's order. */
	const step = (id: number, type: string): number[] | null => {
		const n = node(id);
		if (!n?.edges) {
			if (!needs.includes(id)) needs.push(id);
			return null;
		}
		const out = n.edges
			.filter(
				(e) =>
					e.type === type &&
					!visited.has(e.id) &&
					isAnime(node(e.id)) &&
					!loopsBack(n, node(e.id), type)
			)
			.map((e) => e.id);
		return [...out.filter((x) => isSeason(node(x))), ...out.filter((x) => !isSeason(node(x)))];
	};
	/**
	 * The edge that closes a loop: a PREQUEL that starts after the entry it
	 * comes before, or a SEQUEL that starts before the one it follows (a
	 * remake's or a reboot's chain naming the original's first season as its
	 * SEQUEL, and that season naming it as its PREQUEL). The visited set
	 * alone cuts a loop wherever the walk happens to meet itself, which from a
	 * series holding two seasons is in the middle; the dates say where the
	 * chain really starts. An entry AniList has announced starts after every
	 * one that has aired (`when`): AniList leaves an announced sequel undated
	 * as a rule, and that sequel is the loop's usual closer. An aired entry
	 * AniList leaves undated ranks by the seasons it follows (`startsBy`): a
	 * FINISHED movie between two dated seasons ranks with the first and stays
	 * on the chain, a FINISHED last season naming season 1 its SEQUEL ranks
	 * after season 1 and closes the loop. One with nothing before it has no
	 * place in time to compare, so its edges are taken as AniList gives them,
	 * except against an announced one, which it still comes before: a PREQUEL
	 * from it into the announced sequel closes the loop as it does from a
	 * dated season. Two entries of the same rank are taken as AniList says.
	 */
	const rank = startsBy(graph);
	const loopsBack = (from: RelNode, to: RelNode, type: string) => {
		const a = rank(from);
		const b = rank(to);
		if (a === null || b === null) {
			// Undated and aired: only an announced entry on the other side ranks against it.
			if (a !== Infinity && b !== Infinity) return false;
			return type === 'PREQUEL' ? b === Infinity : a === Infinity;
		}
		return type === 'PREQUEL' ? b > a : b < a;
	};
	/** A SIDE_STORY of an entry the walk stood on: an extra, never followed. */
	const sides = (id: number) => {
		for (const e of node(id)?.edges ?? []) if (e.type === 'SIDE_STORY') extra(e.id);
	};

	// Forward first: past the seasons the series holds unlinked, to the one
	// after. It goes first so that a chain looping back (the season after
	// naming the first season as its SEQUEL, and the first naming it as its
	// PREQUEL) is met as the season after, never as a season before the first.
	let next: number | null = null;
	let skip = from.heldAfter;
	let cur = from.last;
	sides(cur);
	for (let hops = 0; ; hops++) {
		const ahead = step(cur, 'SEQUEL');
		// Past the limit the season after is not known: drawn as one AniList
		// doesn't list, which FIND still finds.
		if (!ahead || !ahead.length || hops >= HOPS) break;
		const [take, ...rest] = ahead;
		visited.add(take);
		for (const r of rest) extra(r);
		if (isSeason(node(take))) {
			if (skip === 0) {
				next = take;
				break;
			}
			skip -= 1;
		} else extras.push(take);
		cur = take;
		sides(cur);
	}

	// Back: to the chain's start, every season on the way.
	const chain: number[] = [];
	cur = from.first;
	sides(cur);
	for (let hops = 0; ; hops++) {
		const prev = step(cur, 'PREQUEL');
		if (!prev || !prev.length) break;
		if (hops >= HOPS) {
			truncated = true;
			break;
		}
		const [take, ...rest] = prev;
		visited.add(take);
		for (const r of rest) extra(r);
		if (isSeason(node(take))) chain.unshift(take);
		else extras.push(take);
		cur = take;
		sides(cur);
	}
	// The seasons the series holds before its first link are the chain's last
	// ones before it: the series has them, so they are not offered.
	const before = chain.slice(0, Math.max(0, chain.length - from.heldBefore));

	return { before, firstAt: chain.length, next, extras, needs, truncated };
}

// ---- the heads -----------------------------------------------------------------------------

/** One head the episode list draws: what it is, plain facts, and where a tap goes. */
export type AroundHead = {
	/** The AniList entry's id: the row's key. */
	key: number;
	/** `SEASON 2`, `SEASON` (unnumbered), `NEXT SEASON`, or an extra's format: `MOVIE`, `OVA`. */
	label: string;
	/** What AniList says of it, as facts: `12 EP`, `AIRING`, `ANNOUNCED · 2027`. */
	facts: string[];
	/** Its title, as AniList gives it; '' for a NEXT SEASON AniList doesn't know. */
	title: string;
	/** The library series holding it (matched by that series' own season link), or null. */
	seriesId: number | null;
	/** What FIND searches the series' own source for, when it isn't in the library. */
	query: string;
};

export type SeasonsAround = {
	before: AroundHead[];
	next: AroundHead;
	extras: AroundHead[];
	/** The folded line: `+ 3 EXTRAS · 2 OVA · 1 MOVIE`; '' for none. */
	extrasLine: string;
};

/** A title as the heads draw it, and as FIND searches it: English, else romaji, else native. */
export const relTitle = (n: Pick<RelNode, 'title'>): string =>
	n.title.english || n.title.romaji || n.title.native || '';

/** The format as words: TV_SHORT is `TV SHORT`. */
const formatWord = (format: string | null) => (format ?? '').replace(/_/g, ' ');

/**
 * What makes another entry the same work in another form (c700; doc/SERIES.md,
 * "OTHER FORMS"), most direct first. AniList writes the relation from the
 * entry it is asked about, so an anime's own manga answers ADAPTATION as often
 * as SOURCE (Ranma 1/2 (2024), recorded in tests/other-forms-db.spec.ts).
 */
export const FORM_RELATIONS: readonly string[] = ['SOURCE', 'ADAPTATION', 'ALTERNATIVE'];

/**
 * The entries one hop from `starts` by a form's relation that `other` accepts,
 * each once, under its most direct relation, then oldest first. One hop only:
 * an adaptation's own adaptation is another work's business. Pure.
 */
export function formNodes(
	graph: RelGraph,
	starts: readonly number[],
	other: (n: RelNode) => boolean
): RelNode[] {
	const met = new Map<number, { n: RelNode; rank: number }>();
	for (const start of starts)
		for (const e of graph.nodes[String(start)]?.edges ?? []) {
			const rank = FORM_RELATIONS.indexOf(e.type);
			const n = graph.nodes[String(e.id)];
			if (rank < 0 || !n || starts.includes(e.id) || !other(n)) continue;
			const had = met.get(e.id);
			if (!had || rank < had.rank) met.set(e.id, { n, rank });
		}
	return [...met.values()]
		.sort(
			(a, b) =>
				a.rank - b.rank || (a.n.year ?? Infinity) - (b.n.year ?? Infinity) || a.n.id - b.n.id
		)
		.map((m) => m.n);
}

/** An entry's AniList facts as plain words: its format, its status, what it counts. */
export function formFacts(n: RelNode): string[] {
	return [
		formatWord(n.format),
		(n.status ?? '').replace(/_/g, ' '),
		n.chapters ? `${n.chapters} CH.` : '',
		n.volumes ? `${n.volumes} VOL.` : '',
		n.episodes ? `${n.episodes} EP.` : ''
	].filter(Boolean);
}

/**
 * AniList's facts about an entry, as plain words (the card: `ANNOUNCED ·
 * 2027`, `AIRING`, `12 EP`): its status when it isn't finished, its year
 * while it isn't out, and its episodes when AniList counts them. A finished
 * entry says only its episodes.
 */
export function relFacts(n: RelNode): string[] {
	const status: Record<string, string> = {
		NOT_YET_RELEASED: 'ANNOUNCED',
		RELEASING: 'AIRING',
		CANCELLED: 'CANCELLED',
		HIATUS: 'ON HIATUS'
	};
	const out: string[] = [];
	const said = n.status ? status[n.status] : undefined;
	if (said) out.push(said);
	if (n.status === 'NOT_YET_RELEASED' && n.year) out.push(String(n.year));
	if (n.episodes) out.push(`${n.episodes} EP`);
	return out;
}

/**
 * A title with its season suffix taken off: what FIND searches the source
 * for when AniList lists no sequel (`… 3rd Season`, `… Season 3`, `… S3`,
 * `… Part 2`, `… Cour 2`, and a bracketed one, `… (Season 3)`), the
 * separators before it too. A title that is nothing but a suffix is kept as
 * it is. It holds on its own output: a suffix inside a suffix
 * (`Season 2 Part 2`) is taken off until none is left, so the stem of a stem
 * is the stem.
 */
export function titleStem(title: string): string {
	const SUFFIX =
		/[\s:\-–—,]*(?:\(\s*)?(?:\b(?:\d+(?:st|nd|rd|th)\s+(?:season|part|cour)|(?:season|part|cour)\s*\d+|s\d+)|第\s*[0-9０-９]+\s*期)(?:\s*\))?\s*$/i;
	let stem = title.trim();
	for (;;) {
		const cut = stem.replace(SUFFIX, '').replace(/[\s:\-–—,]+$/, '');
		if (cut === stem || cut === '') return stem;
		stem = cut;
	}
}

/**
 * The heads, from a walk and the graph: the seasons before numbered along
 * the chain (unnumbered when the walk was truncated), NEXT SEASON with what
 * AniList says of it, or `FIND` for the series' own title stem when it knows
 * none, and the extras with their counts by format. `inLibrary` is another
 * series' own season link for an entry, never a title match.
 */
export function seasonsAround(
	graph: RelGraph,
	walked: Walked,
	o: { title: string; inLibrary: Map<number, number> }
): SeasonsAround {
	const node = (id: number) => graph.nodes[String(id)];
	const head = (id: number, label: string): AroundHead => {
		const n = node(id);
		const title = relTitle(n);
		return {
			key: id,
			label,
			facts: relFacts(n),
			title,
			seriesId: o.inLibrary.get(id) ?? null,
			query: title || titleStem(o.title)
		};
	};
	// `before` starts at the chain's first season: its position is its number.
	const before = walked.before.map((id, i) =>
		head(id, walked.truncated ? 'SEASON' : `SEASON ${i + 1}`)
	);
	const next: AroundHead =
		walked.next === null
			? {
					key: 0,
					label: 'NEXT SEASON',
					facts: [],
					title: '',
					seriesId: null,
					query: titleStem(o.title)
				}
			: head(walked.next, 'NEXT SEASON');
	const extras = walked.extras.map((id) => head(id, formatWord(node(id).format)));
	const counts = new Map<string, number>();
	for (const x of extras) counts.set(x.label, (counts.get(x.label) ?? 0) + 1);
	const extrasLine = extras.length
		? [
				`+ ${extras.length} EXTRA${extras.length === 1 ? '' : 'S'}`,
				...[...counts].map(([label, n]) => `${n} ${label}`)
			].join(' · ')
		: '';
	return { before, next, extras, extrasLine };
}
