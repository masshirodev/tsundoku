import type Database from 'better-sqlite3';
import { getDb } from './db.ts';
import { HIDDEN_SQL, IN_LIBRARY_SQL, VISIBLE_SQL, visibleWhere } from './visibility.ts';
import { clearAniSkip } from './anime/marks.ts';
import {
	ANIME_FORMATS,
	candidateKind,
	candidateRows,
	coverLines,
	coverOnly,
	idsLine,
	isCutShort,
	matchTitles,
	normaliseTitle,
	scoreToRating,
	searchTitles,
	sureMatch,
	wrongKind,
	whyLine,
	type Candidate,
	type Kind,
	type Pasted,
	type Row
} from '../library/catalogue.ts';
import {
	legacyLink,
	linkSeason,
	noneOfSeason,
	offeredSeason,
	openSeasonOf,
	resolveSeasonLinks,
	saveSeasonSearch,
	seasonLink,
	seriesSeasons,
	unlinkSeason,
	undoNoneSeason,
	undoSeasonLink
} from './season-links.ts';
import { seasonSearchTitle } from '../library/anime.ts';

/**
 * Catalogue links on the workstation (doc/LINKS.md): a series' MyAnimeList /
 * AniList entry, and what it gives -- a cover now, tracking later.
 *
 * - **Made without asking** when sure: a MAL tracker in Mihon's backup (at
 *   import), or a title equal to one AniList has (in the cover pass).
 * - **Offered** otherwise: the search's candidates wait for the review, one
 *   series at a time, and nothing unsure is ever linked silently.
 * - **Hidden means hidden, and more:** a hidden series is never searched, and
 *   Hentoid's books never are. Resolving a MAL id sends the id, never a title.
 */

// ---- AniList ------------------------------------------------------------------------------

const ANILIST = 'https://graphql.anilist.co';
/** The address, overridable so a spec can stand in for AniList (tests/links-flow.e2e.ts). */
const anilistUrl = () => process.env.TSUNDOKU_ANILIST_URL ?? ANILIST;

/** Nothing reached AniList: no internet, AniList down, or switched off for the specs. */
export class Unreachable extends Error {}
/** A catalogue refused the owner's sign-in: expired or revoked (doc/TRACKING.md). */
export class SignedOut extends Error {}

type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);
/** AniList asks for no more than 30 requests a minute (its degraded limit); one every 2.1 s. */
let spacing = 2100;
let last = 0;
let chain: Promise<unknown> = Promise.resolve();

/** For specs: a stand-in for the network, and no waiting between calls. */
export function setAnilistFetch(f: Fetch | null, gapMs = 0): void {
	fetcher = f ?? ((...a) => fetch(...a));
	spacing = f ? gapMs : 2100;
	last = 0;
}

async function post(
	query: string,
	variables: Record<string, unknown>,
	token?: string
): Promise<unknown> {
	if (process.env.TSUNDOKU_ANILIST === 'off') throw new Unreachable('switched off');
	for (let attempt = 0; attempt < 3; attempt++) {
		const wait = Math.max(0, last + spacing - Date.now());
		if (wait) await new Promise((r) => setTimeout(r, wait));
		last = Date.now();
		let res: Response;
		try {
			res = await fetcher(anilistUrl(), {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json',
					...(token ? { authorization: `Bearer ${token}` } : {})
				},
				body: JSON.stringify({ query, variables }),
				signal: AbortSignal.timeout(20_000)
			});
		} catch (e) {
			throw new Unreachable(String(e));
		}
		if (res.status === 429) {
			// Asked to wait: as long as it says, then once more.
			const after = Number(res.headers.get('retry-after') ?? '60');
			last = Date.now() + (Number.isFinite(after) ? after : 60) * 1000;
			continue;
		}
		const body = (await res.json().catch(() => null)) as {
			data?: unknown;
			errors?: { message: string; status?: number }[];
		} | null;
		// A 404 inside the body is AniList's "no such entry", not a failure.
		if (body?.errors?.every((e) => e.status === 404)) return body.data ?? null;
		if (res.status === 401 || body?.errors?.some((e) => e.status === 401))
			throw new SignedOut('AniList refused the sign-in');
		if (!res.ok || !body || body.errors?.length)
			throw new Error(`AniList ${res.status}: ${body?.errors?.[0]?.message ?? 'no answer'}`);
		return body.data;
	}
	throw new Unreachable('rate limited');
}

/** One request at a time, whoever asks: the pass and a paste share the one limit. */
function anilist(
	query: string,
	variables: Record<string, unknown>,
	token?: string
): Promise<unknown> {
	const run = chain.then(
		() => post(query, variables, token),
		() => post(query, variables, token)
	);
	chain = run.catch(() => undefined);
	return run;
}

/** An AniList query as the owner, for tracking (doc/TRACKING.md); the same one-at-a-time limit. */
export const anilistAs = (token: string, query: string, variables: Record<string, unknown> = {}) =>
	anilist(query, variables, token);

/**
 * AniList asked without a token, as its search asks it: its catalogue is
 * public, and an entry's relations are no more private than its title (c240).
 */
export const anilistPublic = (query: string, variables: Record<string, unknown> = {}) =>
	anilist(query, variables);

export const MEDIA = `fragment M on Media {
	id idMal format countryOfOrigin status chapters volumes episodes season seasonYear synonyms
	title { romaji english native }
	startDate { year }
	coverImage { extraLarge large }
}`;

export type Media = {
	id: number;
	idMal: number | null;
	format: string | null;
	countryOfOrigin: string | null;
	status: string | null;
	chapters: number | null;
	volumes: number | null;
	episodes: number | null;
	season: string | null;
	seasonYear: number | null;
	synonyms: string[] | null;
	title: { romaji: string | null; english: string | null; native: string | null };
	startDate: { year: number | null } | null;
	coverImage: { extraLarge: string | null; large: string | null } | null;
};

export function toCandidate(m: Media): Candidate {
	const title = m.title.english || m.title.romaji || m.title.native || `AniList ${m.id}`;
	const alts = [m.title.romaji, m.title.native, ...(m.synonyms ?? [])]
		.filter((t): t is string => !!t && t !== title)
		.filter((t, i, all) => all.indexOf(t) === i);
	return {
		anilistId: m.id,
		malId: m.idMal ?? null,
		title,
		alts,
		format: m.format ?? '',
		country: m.countryOfOrigin ?? '',
		year: m.startDate?.year ?? null,
		chapters: m.chapters ?? null,
		volumes: m.volumes ?? null,
		episodes: m.episodes ?? null,
		season: m.season ?? null,
		seasonYear: m.seasonYear ?? null,
		status: m.status ?? '',
		coverUrl: m.coverImage?.extraLarge || m.coverImage?.large || ''
	};
}

/** AniList's two catalogues: an anime series asks ANIME, everything else MANGA. */
const mediaTypeOf = (kind: Kind): 'ANIME' | 'MANGA' => (kind === 'anime' ? 'ANIME' : 'MANGA');

/** The two families a MAL id belongs to: anime's ids and manga's are separate sequences. */
export const family = (kind: Kind): 'anime' | 'comic' => (kind === 'anime' ? 'anime' : 'comic');

/** The formats a kind can be: an anime its own, a novel NOVEL, anything else a comic. */
const formatsOf = (kind: Kind): string[] =>
	kind === 'anime' ? [...ANIME_FORMATS] : kind === 'novel' ? ['NOVEL'] : ['MANGA', 'ONE_SHOT'];

/** Entries by AniList id or by MAL id, fifty to a request, in the kind's own catalogue. */
async function byIds(ids: number[], field: 'id_in' | 'idMal_in', kind: Kind): Promise<Candidate[]> {
	const out: Candidate[] = [];
	for (let i = 0; i < ids.length; i += 50) {
		const data = (await anilist(
			`query ($ids: [Int]) { Page(perPage: 50) { media(${field}: $ids, type: ${mediaTypeOf(kind)}) { ...M } } } ${MEDIA}`,
			{ ids: ids.slice(i, i + 50) }
		)) as { Page: { media: Media[] } } | null;
		out.push(...(data?.Page.media ?? []).map(toCandidate));
	}
	return out;
}

/**
 * AniList's search for each title, only in its kind's own catalogue and
 * formats, five titles to a request, best match first. The type and the
 * format keep a manga out of an anime's candidates, a novel out of a
 * manhwa's (The Beginning After the End is both), and the other way round.
 */
async function searchMany(
	queries: { title: string; kind: Kind }[],
	per = 6
): Promise<Candidate[][]> {
	const out: Candidate[][] = [];
	for (let i = 0; i < queries.length; i += 5) {
		const chunk = queries.slice(i, i + 5);
		const vars = Object.fromEntries(
			chunk.flatMap((q, j) => [
				[`q${j}`, q.title],
				[`f${j}`, formatsOf(q.kind)]
			])
		);
		const query = `query (${chunk.map((_, j) => `$q${j}: String, $f${j}: [MediaFormat]`).join(', ')}) {
			${chunk
				.map(
					(q, j) =>
						`s${j}: Page(perPage: ${per}) { media(search: $q${j}, type: ${mediaTypeOf(q.kind)}, format_in: $f${j}, sort: SEARCH_MATCH) { ...M } }`
				)
				.join('\n')}
		} ${MEDIA}`;
		const data = (await anilist(query, vars)) as Record<string, { media: Media[] }> | null;
		chunk.forEach((_, j) => out.push((data?.[`s${j}`]?.media ?? []).map(toCandidate)));
	}
	return out;
}

// ---- links --------------------------------------------------------------------------------

export type Via = 'mihon' | 'exact' | 'review' | 'pasted' | 'list';

/** A season's link, and the two catalogue ids it names (c240). */
export type SeasonLinkFacts = {
	anilistId: number | null;
	malId: number | null;
	title: string;
	via: string;
	ids: string;
	/** The entry's own kind, from its stored format; null when it isn't known yet. */
	kind: Kind | null;
	format: string | null;
	episodes: number | null;
	year: number | null;
	meta: string;
	coverOnly: boolean;
	wrongKind: boolean;
	resolving: boolean;
	href: string | null;
};

type LinkRow = {
	series_id: number;
	anilist_id: number | null;
	mal_id: number | null;
	via: Via;
	title: string;
	cover_url: string;
	linked_at: number;
	resolved_at: number | null;
	filled_rating: number | null;
	score: number | null;
	format: string | null;
};

function linkOf(db: Database.Database, seriesId: number): LinkRow | null {
	return (
		(db.prepare(`SELECT * FROM series_links WHERE series_id = ?`).get(seriesId) as
			LinkRow | undefined) ?? null
	);
}

/**
 * An unrated series takes the link's score once, when the link is made
 * (Catalogue Links 1w). Returns the rating given, or null.
 */
export function fillRating(
	db: Database.Database,
	seriesId: number,
	score: number | null
): number | null {
	if (!score) return null;
	const r = scoreToRating(score);
	if (!r) return null;
	const done = db
		.prepare(`UPDATE series SET rating = ? WHERE id = ? AND COALESCE(rating, 0) = 0`)
		.run(r, seriesId).changes;
	return done ? r : null;
}

const fill = fillRating;

/**
 * A MAL tracker from Mihon's backup (called by the import's writer, inside
 * its transaction). Sure, so it links at once, unless the owner unlinked this
 * series or linked it some other way; a tracker that moved to another entry
 * moves a link it made.
 */
export function linkFromTracker(
	db: Database.Database,
	seriesId: number,
	mal: { id: number; score: number },
	now: number
): void {
	if (
		db
			.prepare(`SELECT 1 FROM link_decisions WHERE series_id = ? AND decision = 'unlinked'`)
			.get(seriesId)
	)
		return;
	const had = linkOf(db, seriesId);
	if (had && had.via !== 'mihon') return;
	if (had && had.mal_id === mal.id) {
		db.prepare(`UPDATE series_links SET score = ? WHERE series_id = ?`).run(
			mal.score || null,
			seriesId
		);
		return;
	}
	if (had) {
		db.prepare(
			`UPDATE series_links SET mal_id = ?, anilist_id = NULL, title = '', cover_url = '',
				resolved_at = NULL, format = NULL, score = ?, linked_at = ? WHERE series_id = ?`
		).run(mal.id, mal.score || null, now, seriesId);
		clearAniSkip(seriesId, db);
		return;
	}
	db.prepare(
		`INSERT INTO series_links (series_id, mal_id, via, linked_at, score) VALUES (?, ?, 'mihon', ?, ?)`
	).run(seriesId, mal.id, now, mal.score || null);
	clearAniSkip(seriesId, db);
	const filled = fill(db, seriesId, mal.score);
	if (filled)
		db.prepare(`UPDATE series_links SET filled_rating = ? WHERE series_id = ?`).run(
			filled,
			seriesId
		);
}

/**
 * Link a series to an AniList entry the owner chose (the review, FIND, a
 * pasted link) or that matched exactly. Replaces a link it had. The series
 * leaves the review; its search and candidates are kept, so UNDO brings it
 * back as it was. AniSkip's answers go with the old link: the new MAL id must
 * be asked afresh (c299).
 *
 * An anime links a season, not the series (c240, doc/LINKS.md): every door
 * that wrote `series_links` writes `series_season_links` instead, at the
 * season CONTINUE is in, so no caller has to know. `linkSeason` is the one
 * write.
 */
export function link(seriesId: number, c: Candidate, via: Via, now = Date.now()): void {
	if (kindOf(seriesId) === 'anime') {
		linkSeason(seriesId, openSeasonOf(seriesId), 1, c, via, now);
		return;
	}
	const db = getDb();
	db.transaction(() => {
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, mal_id, via, title, cover_url, linked_at, resolved_at, format)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (series_id) DO UPDATE SET anilist_id = excluded.anilist_id, mal_id = excluded.mal_id,
				via = excluded.via, title = excluded.title, cover_url = excluded.cover_url,
				linked_at = excluded.linked_at, resolved_at = excluded.resolved_at,
				filled_rating = NULL, score = NULL, format = excluded.format`
		).run(seriesId, c.anilistId, c.malId, via, c.title, c.coverUrl, now, now, c.format);
		db.prepare(`DELETE FROM link_decisions WHERE series_id = ?`).run(seriesId);
		clearAniSkip(seriesId, db);
	})();
}

/**
 * A link from the owner's AniList list (doc/TRACKING.md): sure, since it's
 * their own entry, and its score fills an unrated series' rating once (1w).
 */
export function linkFromList(
	seriesId: number,
	c: Candidate,
	score: number | null,
	now = Date.now()
): void {
	const db = getDb();
	db.transaction(() => {
		link(seriesId, c, 'list', now);
		const filled = fill(db, seriesId, score);
		db.prepare(`UPDATE series_links SET score = ?, filled_rating = ? WHERE series_id = ?`).run(
			score || null,
			filled,
			seriesId
		);
	})();
}

/**
 * UNDO, just after a LINK: the link goes, and a rating it gave goes with it
 * (if nobody changed it since). The series is back in the review. AniSkip's
 * answers go too: with no link there is no MAL entry (c299).
 */
export function undoLink(seriesId: number): boolean {
	if (kindOf(seriesId) === 'anime') return undoSeasonLink(seriesId, openSeasonOf(seriesId));
	const db = getDb();
	return db.transaction(() => {
		const had = linkOf(db, seriesId);
		if (!had) return false;
		if (had.filled_rating)
			db.prepare(`UPDATE series SET rating = 0 WHERE id = ? AND rating = ?`).run(
				seriesId,
				had.filled_rating
			);
		db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(seriesId);
		clearAniSkip(seriesId, db);
		return true;
	})();
}

/**
 * UNLINK, on the series screen: the link goes and stays gone. An import won't
 * bring Mihon's tracker back, and the pass won't search it again; FIND and
 * PASTE A LINK still can. The rating it gave, long since the owner's, stays.
 * AniSkip's answers go: the old MAL id's negatives are not this series'.
 *
 * An anime unlinks a season -- the one the screen asked about, or every one
 * it has when nobody said, which is what the review's own UNLINK means.
 */
export function unlink(seriesId: number, now = Date.now(), season?: number): void {
	if (kindOf(seriesId) === 'anime') {
		const view = seriesSeasons(seriesId);
		const list = view ? view.seasons.map((s) => s.season) : [0];
		for (const s of season === undefined ? list : [season]) unlinkSeason(seriesId, s, 1, now);
		return;
	}
	const db = getDb();
	db.transaction(() => {
		db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(seriesId);
		db.prepare(
			`INSERT OR REPLACE INTO link_decisions (series_id, decision, at) VALUES (?, 'unlinked', ?)`
		).run(seriesId, now);
		clearAniSkip(seriesId, db);
	})();
}

/** NONE OF THESE: remembered, so it doesn't come back. */
export function noneOfThese(seriesId: number, now = Date.now(), season?: number): void {
	if (kindOf(seriesId) === 'anime') {
		noneOfSeason(seriesId, season ?? openSeasonOf(seriesId), 1, now);
		return;
	}
	getDb()
		.prepare(
			`INSERT OR REPLACE INTO link_decisions (series_id, decision, at) VALUES (?, 'none', ?)`
		)
		.run(seriesId, now);
}

export function undoNone(seriesId: number): boolean {
	if (kindOf(seriesId) === 'anime') return undoNoneSeason(seriesId, openSeasonOf(seriesId));
	return (
		getDb()
			.prepare(`DELETE FROM link_decisions WHERE series_id = ? AND decision = 'none'`)
			.run(seriesId).changes > 0
	);
}

/** SKIP: to the back of the queue. */
export function skip(seriesId: number, now = Date.now()): void {
	getDb().prepare(`UPDATE link_searches SET skipped_at = ? WHERE series_id = ?`).run(now, seriesId);
}

export type QueuedFrom = { query: string; searchedAt: number | null } | null;

/**
 * SEARCH AGAIN (or FIND on a series never searched): the title to search,
 * for the next pass. The series leaves the review until then. Its old
 * candidates stay until the search replaces them, so UNDO (`unqueueSearch`,
 * with what this returns) puts it back as it was.
 */
export function queueSearch(seriesId: number, query: string): QueuedFrom {
	const db = getDb();
	const q = query.trim();
	if (!q) throw new Error('a title to search');
	return db.transaction(() => {
		const was = db
			.prepare(`SELECT query, searched_at FROM link_searches WHERE series_id = ?`)
			.get(seriesId) as { query: string; searched_at: number | null } | undefined;
		db.prepare(
			`INSERT INTO link_searches (series_id, query, searched_at, found) VALUES (?, ?, NULL, 0)
			ON CONFLICT (series_id) DO UPDATE SET query = excluded.query, searched_at = NULL, skipped_at = NULL`
		).run(seriesId, q);
		return was ? { query: was.query, searchedAt: was.searched_at } : null;
	})();
}

/** UNDO a SEARCH AGAIN that hasn't run yet. */
export function unqueueSearch(seriesId: number, was: QueuedFrom): void {
	const db = getDb();
	if (was === null)
		db.prepare(`DELETE FROM link_searches WHERE series_id = ? AND searched_at IS NULL`).run(
			seriesId
		);
	else
		db.prepare(
			`UPDATE link_searches SET query = ?, searched_at = ? WHERE series_id = ? AND searched_at IS NULL`
		).run(was.query, was.searchedAt, seriesId);
}

/**
 * A pasted link, read as one candidate (Link Review 1d). Only its id goes to
 * AniList, never the title, and the id is read in the series' own catalogue
 * (an anime's `/anime/` id is not a manga's). A MAL id AniList doesn't know
 * can't be shown, and says so.
 */
export async function readPasted(p: Pasted, kind: Kind): Promise<Candidate> {
	const found = await byIds([p.id], p.service === 'anilist' ? 'id_in' : 'idMal_in', kind);
	const c = found.find((x) => (p.service === 'anilist' ? x.anilistId : x.malId) === p.id);
	if (!c)
		throw new Error(
			p.service === 'anilist' ? 'no such AniList entry' : 'AniList has no entry for that MAL id'
		);
	return c;
}

/** A series' kind, for the doors that read a pasted link or ask for an id. */
export function kindOf(seriesId: number): Kind | null {
	const r = getDb().prepare(`SELECT kind FROM series WHERE id = ?`).get(seriesId) as
		{ kind: Kind } | undefined;
	return r?.kind ?? null;
}

// ---- the pass -----------------------------------------------------------------------------

/**
 * Links that only know a MAL id (Mihon's trackers) learn their AniList entry
 * and cover: fifty ids a request, and ids are all that's sent. Each series'
 * own kind picks the catalogue the id is read in: a MAL id means a manga on
 * one and an anime on the other, and the wrong one is another work.
 */
export async function resolveLinks(now = Date.now()): Promise<number> {
	const db = getDb();
	const waiting = db
		// Also a link from before rung 26, which doesn't know its entry's format yet.
		.prepare(
			`SELECT l.series_id, l.anilist_id, l.mal_id, s.kind FROM series_links l
			JOIN series s ON s.id = l.series_id
			WHERE l.resolved_at IS NULL OR (l.format IS NULL AND l.anilist_id IS NOT NULL)`
		)
		.all() as {
		series_id: number;
		anilist_id: number | null;
		mal_id: number | null;
		kind: Kind;
	}[];
	if (!waiting.length) return 0;
	const kinds: Kind[] = [...new Set(waiting.map((w) => w.kind))];
	/** The ids of one field, read in each kind's own catalogue. */
	const lookup = async (field: 'id_in' | 'idMal_in'): Promise<Candidate[]> => {
		const out: Candidate[] = [];
		for (const kind of kinds) {
			const col = field === 'id_in' ? 'anilist_id' : 'mal_id';
			const ids = [...new Set(waiting.filter((w) => w.kind === kind).map((w) => w[col]))].filter(
				(n): n is number => n !== null
			);
			if (ids.length) out.push(...(await byIds(ids, field, kind)));
		}
		return out;
	};
	const malById = new Map(
		(await lookup('idMal_in'))
			.filter((c) => c.malId !== null)
			.map((c) => [`${family(candidateKind(c) ?? 'manga')}:${c.malId}`, c])
	);
	const alById = new Map((await lookup('id_in')).map((c) => [c.anilistId, c]));
	const set = db.prepare(
		`UPDATE series_links SET anilist_id = ?, mal_id = COALESCE(?, mal_id), title = ?, cover_url = ?, resolved_at = ?,
			format = ? WHERE series_id = ?`
	);
	const none = db.prepare(
		`UPDATE series_links SET resolved_at = ?, format = COALESCE(format, '') WHERE series_id = ?`
	);
	let n = 0;
	db.transaction(() => {
		for (const w of waiting) {
			const c =
				w.anilist_id !== null
					? alById.get(w.anilist_id)
					: malById.get(`${family(w.kind)}:${w.mal_id ?? -1}`);
			if (c) {
				set.run(c.anilistId, c.malId, c.title, c.coverUrl, now, c.format, w.series_id);
				n += 1;
			} else none.run(now, w.series_id);
		}
	})();
	return n;
}

/** What a catalogue of manga, novels and anime holds: never a doujin, never Hentoid's. */
// A browsing record (doc/BROWSING.md) is never in the LINK queue: it isn't the library's.
const LINKABLE = `s.kind IN ('manga', 'manhwa', 'novel', 'anime') AND s.source != 'hentoid' AND ${IN_LIBRARY_SQL}`;

type SearchRow = {
	id: number;
	title: string;
	alt_titles: string;
	kind: Kind;
	query: string | null;
};

/**
 * What the pass may search: manga, manhwa, novels and anime with no link and
 * no NONE OF THESE or UNLINK, never searched or waiting on a SEARCH AGAIN.
 * Never a hidden series, never Hentoid's. A SEARCH AGAIN goes first, then
 * the series with no cover.
 */
export function searchable(limit: number): SearchRow[] {
	return getDb()
		.prepare(
			`SELECT s.id, s.title, s.alt_titles, s.kind, ls.query
			FROM series s JOIN roots r ON r.id = s.root_id
			LEFT JOIN link_searches ls ON ls.series_id = s.id
			WHERE ${LINKABLE} AND ${VISIBLE_SQL}
				AND NOT EXISTS (SELECT 1 FROM series_links l WHERE l.series_id = s.id)
				AND NOT EXISTS (SELECT 1 FROM link_decisions d WHERE d.series_id = s.id)
				AND (ls.series_id IS NULL OR ls.searched_at IS NULL)
			ORDER BY ls.series_id IS NULL, s.cover_key != '', s.id
			LIMIT ?`
		)
		.all(limit) as SearchRow[];
}

const titlesOfRow = (r: { title: string; alt_titles: string }): string[] => {
	let alts: string[] = [];
	try {
		alts = JSON.parse(r.alt_titles) as string[];
	} catch {
		// Not a list: the title alone.
	}
	return [r.title, ...alts];
};

/**
 * Search AniList for each: the automatic pass links a sure match at once
 * ('exact'); the owner's own search (`autoLink: false`) only stores what it
 * found, even a single equal title, and waits for LINK (the owner's rule,
 * 2026-11-02). Either way the first four results wait for the review, and a
 * search that found nothing does too, so the owner can search again or paste
 * a link.
 */
export async function searchSeries(
	rows: SearchRow[],
	now = Date.now(),
	opts: { autoLink?: boolean } = {}
): Promise<{ linked: number; offered: number }> {
	const autoLink = opts.autoLink ?? true;
	const db = getDb();
	// The owner's own title for a SEARCH AGAIN, as typed; the pass's cleaned,
	// with a shorter one to fall back on. An anime is searched by its season's
	// own title, since each season is its own catalogue entry (c240).
	const seasonOfRow = new Map<number, number>();
	const tries = rows.map((r) => {
		if (r.query) return [r.query];
		if (r.kind === 'anime') {
			const at = openSeasonOf(r.id);
			seasonOfRow.set(r.id, at);
			// The cleaned title, as any search uses, and the season's number after
			// it: "Ranma ½ (2024)" asks for "Ranma ½", season 1 of it.
			return [seasonSearchTitle(searchTitles(r.title)[0], at)];
		}
		return searchTitles(r.title);
	});
	const found = await searchMany(tries.map((t, i) => ({ title: t[0], kind: rows[i].kind })));
	const queries = tries.map((t) => t[0]);
	const again = rows.map((_, i) => i).filter((i) => found[i].length === 0 && tries[i].length > 1);
	if (again.length) {
		const second = await searchMany(again.map((i) => ({ title: tries[i][1], kind: rows[i].kind })));
		again.forEach((i, j) => {
			if (second[j].length) {
				found[i] = second[j];
				queries[i] = tries[i][1];
			}
		});
	}
	// A novel AniList doesn't have as a novel: its comic's entry, offered only,
	// for the cover and the details (`coverOnly`; never linked by itself).
	const crossed = new Set<number>();
	const comics = rows
		.map((_, i) => i)
		.filter((i) => found[i].length === 0 && rows[i].kind === 'novel');
	if (comics.length) {
		const third = await searchMany(
			comics.map((i) => ({ title: tries[i][0], kind: 'manga' as Kind }))
		);
		comics.forEach((i, j) => {
			if (third[j].length) {
				found[i] = third[j];
				queries[i] = tries[i][0];
				crossed.add(i);
			}
		});
	}
	let linked = 0;
	let offered = 0;
	const saveSearch = db.prepare(
		`INSERT INTO link_searches (series_id, query, searched_at, found) VALUES (?, ?, ?, ?)
		ON CONFLICT (series_id) DO UPDATE SET query = excluded.query, searched_at = excluded.searched_at, found = excluded.found`
	);
	const clear = db.prepare(`DELETE FROM link_candidates WHERE series_id = ?`);
	const offer = db.prepare(
		`INSERT OR REPLACE INTO link_candidates (series_id, anilist_id, rank, data) VALUES (?, ?, ?, ?)`
	);
	rows.forEach((r, i) => {
		const hits = found[i] ?? [];
		// The by-hand query is the owner's choice of title, so it counts as one of the series'.
		const sure = crossed.has(i)
			? null
			: sureMatch(matchTitles(titlesOfRow(r), r.query), r.kind, hits);
		db.transaction(() => {
			saveSearch.run(r.id, queries[i], now, hits.length);
			clear.run(r.id);
			// A season keeps its own search and candidates too, so FIND on it has
			// what the pass found without asking AniList again (c240).
			if (r.kind === 'anime') {
				const at = seasonOfRow.get(r.id) ?? openSeasonOf(r.id);
				saveSeasonSearch(r.id, at, 1, queries[i], hits, now);
			}
			if (sure && autoLink) {
				link(r.id, sure, 'exact', now);
				linked += 1;
			} else {
				hits
					.slice(0, 4)
					.forEach((c, rank) => offer.run(r.id, c.anilistId, rank, JSON.stringify(c)));
				offered += 1;
			}
		})();
	});
	return { linked, offered };
}

/**
 * Search again every series the pass searched and couldn't link, with the
 * titles cleaned as they are now: `yarn run links --again`. The owner's own
 * SEARCH AGAIN titles, NONE OF THESE and UNLINK are left alone.
 */
export function requeueSearched(): number {
	const db = getDb();
	return db.transaction(() => {
		const ids = (
			db
				.prepare(
					`SELECT ls.series_id AS id, ls.query, s.title FROM link_searches ls JOIN series s ON s.id = ls.series_id
					WHERE ls.searched_at IS NOT NULL AND ${IN_LIBRARY_SQL}
						AND NOT EXISTS (SELECT 1 FROM series_links l WHERE l.series_id = ls.series_id)
						AND NOT EXISTS (SELECT 1 FROM link_decisions d WHERE d.series_id = ls.series_id)`
				)
				.all() as { id: number; query: string; title: string }[]
		)
			// The pass's own query: the title, the title without Mihon's "...", or a
			// cleaning of it. Anything else the owner typed.
			.filter(
				(r) =>
					r.query === r.title ||
					r.query === r.title.replace(/\s*(\.\.\.|…)$/, '') ||
					searchTitles(r.title).includes(r.query)
			)
			.map((r) => r.id);
		const del = db.prepare(`DELETE FROM link_searches WHERE series_id = ?`);
		const clear = db.prepare(`DELETE FROM link_candidates WHERE series_id = ?`);
		for (const id of ids) {
			del.run(id);
			clear.run(id);
		}
		return ids.length;
	})();
}

export type PassResult = {
	resolved: number;
	searched: number;
	linked: number;
	offered: number;
	unreachable: boolean;
	/** Why AniList couldn't be reached, for the log. */
	reason?: string;
};

/**
 * The link pass, before the covers are made (after an import, and in
 * `yarn run covers` / `yarn run links`): MAL ids resolved, then up to
 * `limit` series searched. Unreachable is not an error: the next pass tries.
 */
export async function refreshLinks(
	opts: { limit?: number; now?: number; log?: (line: string) => void } = {}
): Promise<PassResult> {
	const out: PassResult = { resolved: 0, searched: 0, linked: 0, offered: 0, unreachable: false };
	const now = opts.now ?? Date.now();
	try {
		out.resolved = await resolveLinks(now);
		// A season's own link, where only one id was known (c240).
		out.resolved += await resolveSeasonLinks(now);
		const rows = searchable(opts.limit ?? 60);
		for (let i = 0; i < rows.length; i += 25) {
			const r = await searchSeries(rows.slice(i, i + 25), now);
			out.searched += Math.min(25, rows.length - i);
			out.linked += r.linked;
			out.offered += r.offered;
			opts.log?.(`links: ${out.searched} of ${rows.length} searched`);
		}
	} catch (e) {
		if (e instanceof Unreachable) {
			out.unreachable = true;
			out.reason = e.message;
		} else throw e;
	}
	return out;
}

// ---- the review ----------------------------------------------------------------------------

export type ReviewCandidate = Candidate & { why: string; rows: Row[]; ids: string };

export type ReviewItem = {
	seriesId: number;
	title: string;
	alts: string[];
	kind: Kind;
	hue: number;
	/** Mihon's source name ("ASURA SCANS"), or ''. */
	source: string;
	sourceKind: string;
	chapters: number;
	hasCover: boolean;
	coverAt: number | null;
	cover: { a: string; b: string };
	query: string;
	found: number;
	/** Searched in some pass: false for a series FIND opens before any. */
	searched: boolean;
	/** When the last search ran: the review says "JUST NOW" for one the owner ran. */
	searchedAt: number | null;
	cutShort: boolean;
	candidates: ReviewCandidate[];
};

type ItemRow = {
	id: number;
	title: string;
	alt_titles: string;
	kind: Kind;
	hue: number;
	source: string;
	cover_key: string;
	cover_at: number | null;
	cover_url: string;
	cover_failed_at: number | null;
	chapters: number;
	downloaded: number;
	site: string | null;
	query: string;
	found: number;
	searched_at: number | null;
	link_cover: string | null;
};

const ITEM_SQL = `SELECT s.id, s.title, s.alt_titles, s.kind, s.hue, s.source, s.cover_key, s.cover_at,
		s.cover_url, s.cover_failed_at,
		(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0) AS chapters,
		(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0 AND e.available = 1 AND e.file != '') AS downloaded,
		(SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE st.series_id = s.id AND t.namespace = 'source' LIMIT 1) AS site,
		COALESCE(ls.query, '') AS query, COALESCE(ls.found, 0) AS found, ls.searched_at,
		(SELECT l.cover_url FROM series_links l WHERE l.series_id = s.id) AS link_cover
	FROM series s JOIN roots r ON r.id = s.root_id LEFT JOIN link_searches ls ON ls.series_id = s.id`;

function firstPageOf(seriesId: number): string | undefined {
	const r = getDb()
		.prepare(
			`SELECT label FROM entries WHERE series_id = ? AND available = 1 AND shadowed = 0 ORDER BY position, id LIMIT 1`
		)
		.get(seriesId) as { label: string } | undefined;
	return r?.label.toUpperCase();
}

function itemOf(r: ItemRow): ReviewItem {
	const db = getDb();
	const titles = titlesOfRow(r);
	const cands = (
		db.prepare(`SELECT data FROM link_candidates WHERE series_id = ? ORDER BY rank`).all(r.id) as {
			data: string;
		}[]
	).map((x) => JSON.parse(x.data) as Candidate);
	const series = { titles, kind: r.kind, chapters: r.chapters };
	return {
		seriesId: r.id,
		title: r.title,
		alts: titles.slice(1),
		kind: r.kind,
		hue: r.hue,
		source: (r.site ?? '').toUpperCase(),
		sourceKind: r.source.toUpperCase(),
		chapters: r.chapters,
		hasCover: r.cover_key !== '',
		coverAt: r.cover_at,
		cover: coverLines({
			key: r.cover_key,
			url: r.cover_url !== '',
			urlFailed: r.cover_url !== '' && r.cover_failed_at !== null,
			downloaded: r.downloaded,
			kind: r.kind,
			linkCover: !!r.link_cover,
			pageOf: r.cover_key.startsWith('page:') ? firstPageOf(r.id) : undefined
		}),
		query: r.query || r.title,
		found: r.found,
		searched: r.searched_at !== null,
		searchedAt: r.searched_at,
		cutShort: isCutShort(r.title),
		candidates: cands.map((c) => ({
			...c,
			why: whyLine(series, c),
			rows: candidateRows(series, c),
			ids: idsLine(c.anilistId, c.malId)
		}))
	};
}

/**
 * The series to review: searched, not linked, not settled with NONE OF THESE
 * or UNLINK -- with candidates, or none found. A skipped one goes to the
 * back. Hidden series are never searched, so they're never here while reveal
 * is off; the filter is only belt and braces for one hidden since.
 */
export function linkQueue(reveal: boolean): ReviewItem[] {
	const rows = getDb()
		.prepare(
			`${ITEM_SQL}
			WHERE ls.searched_at IS NOT NULL AND ${visibleWhere(reveal)} AND ${LINKABLE}
				AND NOT EXISTS (SELECT 1 FROM series_links l WHERE l.series_id = s.id)
				AND NOT EXISTS (SELECT 1 FROM link_decisions d WHERE d.series_id = s.id)
			ORDER BY ls.skipped_at IS NOT NULL, ls.skipped_at, ls.found = 0, s.cover_key != '', s.id`
		)
		.all() as ItemRow[];
	return rows.map(itemOf);
}

/** How many wait in the review: the library band's count. */
export function linkQueueCount(reveal: boolean): number {
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM link_searches ls JOIN series s ON s.id = ls.series_id JOIN roots r ON r.id = s.root_id
				WHERE ls.searched_at IS NOT NULL AND ${visibleWhere(reveal)} AND ${LINKABLE}
					AND NOT EXISTS (SELECT 1 FROM series_links l WHERE l.series_id = s.id)
					AND NOT EXISTS (SELECT 1 FROM link_decisions d WHERE d.series_id = s.id)`
			)
			.get() as { n: number }
	).n;
}

/** One series as the review shows it, whether or not it's in the queue: FIND on its screen. */
export function reviewItem(seriesId: number, reveal: boolean): ReviewItem | null {
	const r = getDb()
		.prepare(`${ITEM_SQL} WHERE s.id = ? AND ${visibleWhere(reveal)}`)
		.get(seriesId) as ItemRow | undefined;
	return r ? itemOf(r) : null;
}

/** A candidate the review offered for this series, for LINK. */
export function offered(seriesId: number, anilistId: number, season?: number): Candidate | null {
	const kind = kindOf(seriesId);
	if (kind === 'anime')
		return offeredSeason(seriesId, season ?? openSeasonOf(seriesId), kind, anilistId);
	const r = getDb()
		.prepare(`SELECT data FROM link_candidates WHERE series_id = ? AND anilist_id = ?`)
		.get(seriesId, anilistId) as { data: string } | undefined;
	return r ? (JSON.parse(r.data) as Candidate) : null;
}

// ---- the series screen ---------------------------------------------------------------------

export type LinkState = {
	linked: {
		anilistId: number | null;
		malId: number | null;
		title: string;
		via: Via;
		ids: string;
		/** A MAL link AniList hasn't been asked about yet. */
		resolving: boolean;
		/** Across kinds (a novel to its comic's entry): cover and details only, never tracked. */
		coverOnly: boolean;
		/** The entry is the other kind: a manga's on an anime, or an anime's on a manga (c298). */
		wrongKind: boolean;
		/**
		 * The entry's own kind, from its stored format: what OPEN and the TRACKING
		 * sheet must use, so a wrong-kind link opens the entry it names rather than
		 * another work (c298). Null when the format isn't known yet.
		 */
		kind: Kind | null;
	} | null;
	/** Not linked: what the last pass found. */
	candidates: number;
	searched: boolean;
	/** Waiting on a SEARCH AGAIN. */
	queued: boolean;
	/** Hidden series are never searched (Series Link 1s): FIND is PASTE A LINK only. */
	hidden: boolean;
	cover: { a: string; b: string };
};

/**
 * The LINK and COVER rows (Series Link 1k–1s). Null for what's never linked: doujins.
 * An anime answers for one season (c240): the one the screen asked about, or
 * the one CONTINUE is in.
 */
export function linkState(seriesId: number, season?: number): LinkState | null {
	const db = getDb();
	const r = db
		.prepare(
			`${ITEM_SQL.replace('FROM series s', `, ${HIDDEN_SQL} AS hidden FROM series s`)} WHERE s.id = ?`
		)
		.get(seriesId) as (ItemRow & { hidden: number }) | undefined;
	if (!r || r.kind === 'doujin') return null;
	if (r.kind === 'anime') return seasonLinkState(seriesId, r, season);
	const l = linkOf(db, seriesId);
	const item = itemOf(r);
	return {
		linked: l
			? {
					anilistId: l.anilist_id,
					malId: l.mal_id,
					title: l.title,
					via: l.via,
					ids: idsLine(l.anilist_id, l.mal_id),
					resolving: l.resolved_at === null,
					coverOnly: coverOnly(r.kind, l.format ?? ''),
					wrongKind: wrongKind(r.kind, l.format ?? ''),
					kind: l.format ? candidateKind({ format: l.format, country: '' }) : null
				}
			: null,
		candidates: item.candidates.length,
		searched: r.searched_at !== null,
		queued: r.query !== '' && r.searched_at === null,
		hidden: !!r.hidden,
		cover: item.cover
	};
}

/** An anime's LINK row for one season: its own link, or the series' shape before rung 62. */
function seasonLinkState(
	seriesId: number,
	r: ItemRow & { hidden: number },
	season?: number
): LinkState {
	const view = seriesSeasons(seriesId);
	const at = season ?? view?.open ?? 0;
	const sv = view?.seasons.find((s) => s.season === at) ?? null;
	const l = sv?.link ?? legacyLink(seriesId);
	const item = itemOf({ ...r, chapters: sv?.aired ?? r.chapters });
	return {
		linked: l
			? {
					anilistId: l.anilistId,
					malId: l.malId,
					title: l.title,
					via: l.via as Via,
					ids: idsLine(l.anilistId, l.malId),
					resolving: l.resolvedAt === null,
					coverOnly: coverOnly(r.kind, l.format ?? ''),
					wrongKind: wrongKind(r.kind, l.format ?? ''),
					kind: l.format ? candidateKind({ format: l.format, country: '' }) : null
				}
			: null,
		candidates: sv?.candidates ?? 0,
		searched: sv?.searched ?? false,
		queued: sv?.queued ?? false,
		hidden: !!r.hidden,
		cover: item.cover
	};
}

/** The cover a link offers (doc/COVERS.md), for covers.ts. An anime's is the open season's. */
export function linkCover(seriesId: number): { anilistId: number; url: string } | null {
	if (kindOf(seriesId) === 'anime') {
		const l = seasonLink(seriesId, openSeasonOf(seriesId));
		const legacy = l ?? legacyLink(seriesId);
		return legacy?.anilistId && legacy.coverUrl
			? { anilistId: legacy.anilistId, url: legacy.coverUrl }
			: null;
	}
	const r = getDb()
		.prepare(
			`SELECT anilist_id, cover_url FROM series_links WHERE series_id = ? AND anilist_id IS NOT NULL AND cover_url != ''`
		)
		.get(seriesId) as { anilist_id: number; cover_url: string } | undefined;
	return r ? { anilistId: r.anilist_id, url: r.cover_url } : null;
}

/** Links in all, for SETTINGS and the logs. */
export function linkCount(): number {
	return (getDb().prepare(`SELECT COUNT(*) AS n FROM series_links`).get() as { n: number }).n;
}

/** A candidate as the review draws it for this series: a pasted one, read afresh. */
export function asReviewCandidate(item: ReviewItem, c: Candidate): ReviewCandidate {
	const series = { titles: [item.title, ...item.alts], kind: item.kind, chapters: item.chapters };
	return {
		...c,
		why: whyLine(series, c),
		rows: candidateRows(series, c),
		ids: idsLine(c.anilistId, c.malId)
	};
}

/** Whether a series can be seen (reveal on, or not hidden), and whether it's hidden. Null: no such series. */
export function seriesAccess(seriesId: number, reveal: boolean): { hidden: boolean } | null {
	const r = getDb()
		.prepare(
			`SELECT ${HIDDEN_SQL} AS hidden FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
		)
		.get(seriesId) as { hidden: number } | undefined;
	if (!r || (r.hidden && !reveal)) return null;
	return { hidden: !!r.hidden };
}

// ---- SEARCH AGAIN, now ----------------------------------------------------------------------

/** What a search replaced, so its UNDO can put it back. One per series, this process only. */
type Before = {
	search: {
		query: string;
		searched_at: number | null;
		found: number;
		skipped_at: number | null;
	} | null;
	candidates: { anilist_id: number; rank: number; data: string }[];
};
const before = new Map<number, Before>();

export type SearchNow =
	{ outcome: 'found'; found: number } | { outcome: 'queued'; was: QueuedFrom };

/**
 * SEARCH AGAIN (and FIND on a series never searched): AniList asked at once,
 * with this title only, in the series' own catalogue and kind. What it found
 * replaces the candidates and waits for LINK: a search the owner runs never
 * links by itself, even on one equal title (the owner's rule, 2026-11-02).
 * AniList out of reach, the search waits for the next pass instead, as it
 * used to.
 *
 * An anime searches one season (c240): a season's own title, in the anime
 * formats, kept against that season, and LINK writes that season's row.
 */
export async function searchNow(
	seriesId: number,
	query: string,
	now = Date.now(),
	o: { season?: number; part?: number } = {}
): Promise<SearchNow> {
	const db = getDb();
	const q = query.trim();
	if (!q) throw new Error('a title to search');
	const row = db
		.prepare(`SELECT id, title, alt_titles, kind FROM series WHERE id = ?`)
		.get(seriesId) as Omit<SearchRow, 'query'> | undefined;
	if (!row) throw new Error('no such series');
	const snapshot: Before = {
		search:
			(db
				.prepare(
					`SELECT query, searched_at, found, skipped_at FROM link_searches WHERE series_id = ?`
				)
				.get(seriesId) as Before['search'] | undefined) ?? null,
		candidates: db
			.prepare(`SELECT anilist_id, rank, data FROM link_candidates WHERE series_id = ?`)
			.all(seriesId) as Before['candidates']
	};
	try {
		// A season's own search (c240): asked in the anime catalogue and kept
		// against that season, not the one CONTINUE happens to be in. The series'
		// own row is written too, so the review queue still finds it.
		if (row.kind === 'anime' && o.season !== undefined) {
			const hits = (await searchMany([{ title: q, kind: 'anime' }]))[0] ?? [];
			saveSeasonSearch(seriesId, o.season, o.part ?? 1, q, hits, now);
			before.set(seriesId, snapshot);
			db.transaction(() => {
				db.prepare(
					`INSERT INTO link_searches (series_id, query, searched_at, found) VALUES (?, ?, ?, ?)
					ON CONFLICT (series_id) DO UPDATE SET query = excluded.query,
						searched_at = excluded.searched_at, found = excluded.found`
				).run(seriesId, q, now, hits.length);
				db.prepare(`DELETE FROM link_candidates WHERE series_id = ?`).run(seriesId);
				const put = db.prepare(
					`INSERT OR REPLACE INTO link_candidates (series_id, anilist_id, rank, data) VALUES (?, ?, ?, ?)`
				);
				hits
					.slice(0, 4)
					.forEach((c, rank) => put.run(seriesId, c.anilistId, rank, JSON.stringify(c)));
			})();
			return { outcome: 'found', found: hits.length };
		}
		await searchSeries([{ ...row, query: q }], now, { autoLink: false });
		before.set(seriesId, snapshot);
		const found = (
			db.prepare(`SELECT found FROM link_searches WHERE series_id = ?`).get(seriesId) as {
				found: number;
			}
		).found;
		return { outcome: 'found', found };
	} catch (e) {
		if (!(e instanceof Unreachable)) throw e;
		before.delete(seriesId);
		return { outcome: 'queued', was: queueSearch(seriesId, q) };
	}
}

/**
 * UNDO a SEARCH AGAIN: the search and the candidates it replaced come back.
 * A search the owner runs never makes a link (c298's rule), so there is
 * nothing of the search's to take back here -- a link made by the review's
 * own LINK is undone by that decision's UNDO. A search that waited for the
 * pass (AniList out of reach) is taken back as before, with what `searchNow`
 * returned.
 */
export function undoSearch(seriesId: number, was: QueuedFrom | undefined): void {
	const db = getDb();
	const b = before.get(seriesId);
	if (!b) {
		unqueueSearch(seriesId, was ?? null);
		return;
	}
	db.transaction(() => {
		db.prepare(`DELETE FROM link_candidates WHERE series_id = ?`).run(seriesId);
		db.prepare(`DELETE FROM link_searches WHERE series_id = ?`).run(seriesId);
		if (b.search)
			db.prepare(
				`INSERT INTO link_searches (series_id, query, searched_at, found, skipped_at) VALUES (?, ?, ?, ?, ?)`
			).run(seriesId, b.search.query, b.search.searched_at, b.search.found, b.search.skipped_at);
		const put = db.prepare(
			`INSERT INTO link_candidates (series_id, anilist_id, rank, data) VALUES (?, ?, ?, ?)`
		);
		for (const c of b.candidates) put.run(seriesId, c.anilist_id, c.rank, c.data);
	})();
	before.delete(seriesId);
}

/**
 * Series an entry on the owner's list could link to, by title: linkable, in
 * view, not linked and not settled -- each under its titles, cleaned and
 * normalised as a sure match compares them (doc/TRACKING.md).
 */
export function linkableByTitle(): Map<string, { id: number; kind: Kind }[]> {
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.title, s.alt_titles, s.kind FROM series s JOIN roots r ON r.id = s.root_id
			WHERE ${LINKABLE} AND ${VISIBLE_SQL}
				AND NOT EXISTS (SELECT 1 FROM series_links l WHERE l.series_id = s.id)
				AND NOT EXISTS (SELECT 1 FROM link_decisions d WHERE d.series_id = s.id)`
		)
		.all() as { id: number; title: string; alt_titles: string; kind: Kind }[];
	const out = new Map<string, { id: number; kind: Kind }[]>();
	for (const r of rows)
		for (const t of matchTitles(titlesOfRow(r))) {
			const k = normaliseTitle(t);
			if (!k) continue;
			const list = out.get(k) ?? [];
			if (!list.some((x) => x.id === r.id)) list.push({ id: r.id, kind: r.kind });
			out.set(k, list);
		}
	return out;
}
