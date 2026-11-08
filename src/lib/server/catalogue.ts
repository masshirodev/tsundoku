import type Database from 'better-sqlite3';
import { getDb } from './db.ts';
import { HIDDEN_SQL, IN_LIBRARY_SQL, VISIBLE_SQL, visibleWhere } from './visibility.ts';
import { clearAniSkip } from './anime/marks.ts';
import { KINDS, anilistType } from '../library/kinds.ts';
import {
	ANIME_FORMATS,
	candidateKind,
	candidateRows,
	coverLines,
	coverOnly,
	idsLine,
	isAnime,
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
	type Row,
	type SeasonDecision
} from '../library/catalogue.ts';
import {
	legacyLink,
	linkSeason,
	noneOfSeason,
	firstSeasonLink,
	offeredSeason,
	openSeasonOf,
	resolveSeasonLinks,
	saveSeasonSearch,
	seasonCandidates,
	seasonLink,
	seasonSettled,
	seasonToLook,
	seriesSeasons,
	unlinkSeason,
	undoNoneSeason,
	undoSeasonLink
} from './season-links.ts';
import { seasonSearchTitle } from '../library/anime.ts';
import {
	RELATIONS_RETRY_MS,
	clearLinkPass,
	linkPassRunning,
	markLinkPass,
	refreshRelations,
	type RelationsPass
} from './relations.ts';

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

/** Nothing reached AniList: no internet, no answer from it, or switched off for the specs. */
export class Unreachable extends Error {}
/**
 * AniList answered, and the answer is about AniList rather than this request: a
 * 5xx, a 403, or a body that isn't JSON (doc/LINKS.md, "How the cache fills").
 * Only the background fill reads it, to stop a pass without costing a series its
 * turn. It is not an `Unreachable`, whose other readers (the links page's 503,
 * a season's count of zero, Ranobe's) were written for a failure to reach the
 * service, and every other caller goes on seeing the plain `Error` it always did.
 *
 * A 403 is here because the fill asks with no token, for public ids, by one query
 * shape: nothing in a request of it can be forbidden, so a 403 is AniList or its
 * Cloudflare refusing this client. No 403 was ever seen from here, so that is
 * reasoned from the request and not measured. The cost, if it is ever wrong, is a
 * pass that stops at the same request each tick, one quiet request ten minutes.
 */
export class AnilistDown extends Error {}
/** A catalogue refused the owner's sign-in: expired or revoked (doc/TRACKING.md). */
export class SignedOut extends Error {}

type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);
/** AniList asks for no more than 30 requests a minute (its degraded limit); one every 2.1 s. */
export const ANILIST_SPACING_MS = 2100;
let spacing = ANILIST_SPACING_MS;
let last = 0;
let chain: Promise<unknown> = Promise.resolve();
/** The wait in hand, and whether nothing should hold the process for a wait any more. */
let waiting: ReturnType<typeof setTimeout> | null = null;
let released = false;

/**
 * The server is stopping: a wait for AniList's turn, a 429's included (a minute
 * or more, past `TimeoutStopSec`), no longer holds the process open. Only the
 * served app calls this; a script's top-level await needs its waits to hold it.
 */
export function releaseAnilistWaits(): void {
	released = true;
	waiting?.unref();
}

/** For specs: a stand-in for the network, and no waiting between calls. */
export function setAnilistFetch(f: Fetch | null, gapMs = 0): void {
	fetcher = f ?? ((...a) => fetch(...a));
	spacing = f ? gapMs : ANILIST_SPACING_MS;
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
		if (wait)
			await new Promise((r) => {
				waiting = setTimeout(r, wait);
				if (released) waiting.unref();
			});
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
		const down = res.status >= 500 || res.status === 403 || !body;
		// A 404 inside the body is AniList's "no such entry", not a failure.
		if (!down && body?.errors?.every((e) => e.status === 404)) return body.data ?? null;
		if (res.status === 401 || body?.errors?.some((e) => e.status === 401))
			throw new SignedOut('AniList refused the sign-in');
		const failed = `AniList ${res.status}: ${body?.errors?.[0]?.message ?? 'no answer'}`;
		if (down) throw new AnilistDown(failed);
		if (!res.ok || body?.errors?.length) throw new Error(failed);
		return body?.data;
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
			`query ($ids: [Int]) { Page(perPage: 50) { media(${field}: $ids, type: ${anilistType(kind)}) { ...M } } } ${MEDIA}`,
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
						`s${j}: Page(perPage: ${per}) { media(search: $q${j}, type: ${anilistType(q.kind)}, format_in: $f${j}, sort: SEARCH_MATCH) { ...M } }`
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
	/** AniList's countryOfOrigin and start year (rung 70, c520); NULL until asked, '' when unknown. */
	country: string | null;
	year: number | null;
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
			.get(seriesId) ||
		// A series with season rows is linked by them: a row here would stand
		// beside them and be read by nothing (c467).
		db.prepare(`SELECT 1 FROM series_season_links WHERE series_id = ? LIMIT 1`).get(seriesId)
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
				resolved_at = NULL, format = NULL, country = NULL, year = NULL, score = ?, linked_at = ?
				WHERE series_id = ?`
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
 * that wrote `series_links` writes `series_season_links` instead. A caller
 * that names no season links the season that still wants a look
 * (`seasonToLook`), never one already linked or settled; only when every
 * season is, the one CONTINUE is in (a CHANGE). `linkSeason` is the one write,
 * and it refuses an entry another season of the show holds: then nothing is
 * written and this answers false.
 */
export function link(seriesId: number, c: Candidate, via: Via, now = Date.now()): boolean {
	if (isAnime(kindOf(seriesId)))
		return linkSeason(seriesId, seasonToLook(seriesId) ?? openSeasonOf(seriesId), 1, c, via, now);
	const db = getDb();
	db.transaction(() => {
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, mal_id, via, title, cover_url, linked_at, resolved_at, format, country, year)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (series_id) DO UPDATE SET anilist_id = excluded.anilist_id, mal_id = excluded.mal_id,
				via = excluded.via, title = excluded.title, cover_url = excluded.cover_url,
				linked_at = excluded.linked_at, resolved_at = excluded.resolved_at,
				filled_rating = NULL, score = NULL, format = excluded.format,
				country = excluded.country, year = excluded.year`
		).run(
			seriesId,
			c.anilistId,
			c.malId,
			via,
			c.title,
			c.coverUrl,
			now,
			now,
			c.format,
			c.country,
			c.year
		);
		db.prepare(`DELETE FROM link_decisions WHERE series_id = ?`).run(seriesId);
		clearAniSkip(seriesId, db);
	})();
	return true;
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
 *
 * An anime's UNDO is the season's it acted on (c240), which every caller
 * names; with none named it is the open season, since the season a LINK just
 * filled is no longer the one `seasonToLook` would answer.
 */
export function undoLink(seriesId: number, season?: number, part = 1): boolean {
	if (isAnime(kindOf(seriesId)))
		return undoSeasonLink(seriesId, season ?? openSeasonOf(seriesId), part);
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

// ---- UNLINK, and its UNDO (c520) ----------------------------------------------------------

/** The columns a comic's link and a season's share past their keys. */
const SHARED_COLUMNS = [
	'anilist_id',
	'mal_id',
	'via',
	'title',
	'cover_url',
	'linked_at',
	'resolved_at',
	'filled_rating',
	'score',
	'format'
] as const;
/** Every column of a comic's `series_links` row past its key: what UNDO puts back. */
const LINK_COLUMNS = [...SHARED_COLUMNS, 'country', 'year'] as const;
/** Every column of an anime's `series_season_links` row past its key. */
const SEASON_LINK_COLUMNS = [...SHARED_COLUMNS, 'episodes', 'year'] as const;

type TakenRow = Record<string, string | number | null>;
type Decision = { decision: 'none' | 'unlinked'; at: number };

/**
 * What UNLINK took, exactly, so its band's UNDO can put it back (c520). The
 * rows are keyed by the series and, for an anime, by season and part: never a
 * row id, which a later link could reuse. `at` is the UNLINK's own time, the
 * mark its decision rows carry; UNDO knows its own decision by it.
 */
export type UnlinkFacts = {
	seriesId: number;
	at: number;
	/** The entry's title, for the band. */
	title: string;
	/** The season the UNLINK named; null when it named none. */
	season: number | null;
	/** A comic's link and the decision row it replaced (null: there was none). */
	link: TakenRow | null;
	decision: Decision | null;
	/** An anime's parts, each as it was. */
	parts: { season: number; part: number; link: TakenRow | null; decision: Decision | null }[];
};

const pick = (r: Record<string, unknown> | undefined, cols: readonly string[]): TakenRow | null =>
	r ? Object.fromEntries(cols.map((c) => [c, (r[c] ?? null) as string | number | null])) : null;

/**
 * UNLINK, on the series screen: the link goes and stays gone. An import won't
 * bring Mihon's tracker back, and the pass won't search it again; FIND and
 * PASTE A LINK still can. The rating it gave, long since the owner's, stays.
 * AniSkip's answers go: the old MAL id's negatives are not this series'.
 *
 * An anime unlinks a season -- every part of it, since a season's line stands
 * for the whole season -- or every season it has when nobody said, which is
 * what the review's own UNLINK means. It answers what it took, for the
 * band's UNDO (c520).
 */
export function unlink(seriesId: number, now = Date.now(), season?: number): UnlinkFacts {
	const db = getDb();
	const linkRow = () =>
		pick(
			db.prepare(`SELECT * FROM series_links WHERE series_id = ?`).get(seriesId) as
				Record<string, unknown> | undefined,
			LINK_COLUMNS
		);
	const facts: UnlinkFacts = {
		seriesId,
		at: now,
		title: '',
		season: season ?? null,
		link: null,
		decision: null,
		parts: []
	};
	if (isAnime(kindOf(seriesId))) {
		const view = seriesSeasons(seriesId);
		const list = view ? view.seasons.map((s) => s.season) : [0];
		for (const s of season === undefined ? list : [season]) {
			const parts = view?.seasons.find((x) => x.season === s)?.parts.map((p) => p.part) ?? [1];
			for (const p of parts) {
				const link = pick(
					db
						.prepare(
							`SELECT * FROM series_season_links WHERE series_id = ? AND season = ? AND part = ?`
						)
						.get(seriesId, s, p) as Record<string, unknown> | undefined,
					SEASON_LINK_COLUMNS
				);
				const decision =
					(db
						.prepare(
							`SELECT decision, at FROM season_link_decisions WHERE series_id = ? AND season = ? AND part = ?`
						)
						.get(seriesId, s, p) as Decision | undefined) ?? null;
				facts.parts.push({ season: s, part: p, link, decision });
				unlinkSeason(seriesId, s, p, now);
			}
		}
		facts.title = String(facts.parts.find((p) => p.link)?.link?.title ?? '');
		return facts;
	}
	db.transaction(() => {
		facts.link = linkRow();
		facts.decision =
			(db.prepare(`SELECT decision, at FROM link_decisions WHERE series_id = ?`).get(seriesId) as
				Decision | undefined) ?? null;
		db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(seriesId);
		db.prepare(
			`INSERT OR REPLACE INTO link_decisions (series_id, decision, at) VALUES (?, 'unlinked', ?)`
		).run(seriesId, now);
		clearAniSkip(seriesId, db);
	})();
	facts.title = String(facts.link?.title ?? '');
	return facts;
}

/** Why an UNDO of UNLINK put nothing back: the band says it, and nothing changed. */
export class UndoUnlinkRefused extends Error {}

const sameLink = (a: TakenRow | null, b: TakenRow | null) =>
	!!a &&
	!!b &&
	a.anilist_id === b.anilist_id &&
	a.mal_id === b.mal_id &&
	a.linked_at === b.linked_at;

/** A posted row, read back as the columns it may carry and nothing else. */
function rowFrom(r: unknown, cols: readonly string[]): TakenRow | null {
	if (!r || typeof r !== 'object') return null;
	const o = r as Record<string, unknown>;
	const out: TakenRow = {};
	for (const c of cols) {
		const v = o[c];
		if (v !== null && typeof v !== 'string' && typeof v !== 'number') return null;
		out[c] = v ?? null;
	}
	// The tables' own CHECK on `via`: a posted word outside it is refused here,
	// not by SQLite halfway through the UNDO.
	const vias = cols.includes('episodes') ? SEASON_VIAS : VIAS;
	return typeof out.linked_at === 'number' && vias.includes(out.via as string) ? out : null;
}
const VIAS = ['mihon', 'exact', 'review', 'pasted', 'list'];
const SEASON_VIAS = [...VIAS, 'relations'];

function decisionFrom(d: unknown): Decision | null {
	if (!d || typeof d !== 'object') return null;
	const o = d as Record<string, unknown>;
	return (o.decision === 'none' || o.decision === 'unlinked') && typeof o.at === 'number'
		? { decision: o.decision, at: o.at }
		: null;
}

/**
 * The band's facts, as posted: checked field by field, so UNDO writes only
 * what an UNLINK of this series could have taken. Null when they are not.
 */
export function parseUnlinkFacts(raw: string, seriesId: number): UnlinkFacts | null {
	let f: Record<string, unknown>;
	try {
		f = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (!f || typeof f !== 'object' || f.seriesId !== seriesId || typeof f.at !== 'number')
		return null;
	const parts = Array.isArray(f.parts) ? f.parts : [];
	const read = parts.map((p) => {
		const o = (p ?? {}) as Record<string, unknown>;
		return {
			season: o.season,
			part: o.part,
			link: o.link == null ? null : rowFrom(o.link, SEASON_LINK_COLUMNS),
			decision: o.decision == null ? null : decisionFrom(o.decision),
			bad:
				(o.link != null && !rowFrom(o.link, SEASON_LINK_COLUMNS)) ||
				(o.decision != null && !decisionFrom(o.decision))
		};
	});
	if (read.some((p) => p.bad || !Number.isInteger(p.season) || (p.part !== 1 && p.part !== 2)))
		return null;
	const link = f.link == null ? null : rowFrom(f.link, LINK_COLUMNS);
	// A band drawn before rung 74 still posts `mirror`, a copy of a season row
	// (c467). It is not read: the seasons' own rows are what UNDO puts back.
	if (f.link != null && !link) return null;
	if (f.decision != null && !decisionFrom(f.decision)) return null;
	return {
		seriesId,
		at: f.at,
		title: typeof f.title === 'string' ? f.title : '',
		season: Number.isInteger(f.season) ? (f.season as number) : null,
		link,
		decision: f.decision == null ? null : decisionFrom(f.decision),
		parts: read.map((p) => ({
			season: p.season as number,
			part: p.part as number,
			link: p.link,
			decision: p.decision
		}))
	};
}

const insertRow = (
	db: Database.Database,
	table: string,
	key: Record<string, number>,
	row: TakenRow
) => {
	const cols = [...Object.keys(key), ...Object.keys(row)];
	db.prepare(
		`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
	).run(...Object.values(key), ...Object.values(row));
};

/**
 * UNDO on UNLINK's band (c520): the rows the UNLINK took, back as they were,
 * and its decision ("no pass asks again") gone with it, so the next pass
 * treats the series as linked again. All or nothing, and never over a newer
 * act: a link made since, or a decision since (NONE OF THESE, another UNLINK),
 * refuses the whole UNDO. A second UNDO of the same facts finds its rows back
 * and says so. AniSkip's marks, which UNLINK cleared, are fetched again on the
 * next look as for any new link; they were never the owner's.
 */
export function undoUnlink(facts: UnlinkFacts): 'undone' {
	const db = getDb();
	const id = facts.seriesId;
	return db.transaction(() => {
		if (isAnime(kindOf(id))) {
			if (!facts.parts.some((p) => p.link)) throw new UndoUnlinkRefused('NOTHING TO UNDO');
			// Every part the UNLINK named, not only the ones it took a link from:
			// it wrote its own decision over each, and a part it found with no
			// link (NONE OF THESE, or never looked at) may be linked since too.
			const now = facts.parts.map((p) => ({
				p,
				link: pick(
					db
						.prepare(
							`SELECT * FROM series_season_links WHERE series_id = ? AND season = ? AND part = ?`
						)
						.get(id, p.season, p.part) as Record<string, unknown> | undefined,
					SEASON_LINK_COLUMNS
				),
				decision:
					(db
						.prepare(
							`SELECT decision, at FROM season_link_decisions WHERE series_id = ? AND season = ? AND part = ?`
						)
						.get(id, p.season, p.part) as Decision | undefined) ?? null
			}));
			const taken = now.filter((n) => n.p.link);
			if (taken.every((n) => sameLink(n.link, n.p.link)))
				throw new UndoUnlinkRefused('ALREADY UNDONE');
			for (const n of now)
				if (n.link || n.decision?.decision !== 'unlinked' || n.decision.at !== facts.at)
					throw new UndoUnlinkRefused('LINKED OR DECIDED AGAIN SINCE');
			for (const p of facts.parts) {
				// Only the UNLINK's own decision goes; the one it replaced comes back.
				db.prepare(
					`DELETE FROM season_link_decisions WHERE series_id = ? AND season = ? AND part = ?
					AND decision = 'unlinked' AND at = ?`
				).run(id, p.season, p.part, facts.at);
				if (p.decision)
					db.prepare(
						`INSERT OR IGNORE INTO season_link_decisions (series_id, season, part, decision, at)
						VALUES (?, ?, ?, ?, ?)`
					).run(id, p.season, p.part, p.decision.decision, p.decision.at);
				if (p.link)
					insertRow(
						db,
						'series_season_links',
						{ series_id: id, season: p.season, part: p.part },
						p.link
					);
			}
			return 'undone' as const;
		}
		if (!facts.link) throw new UndoUnlinkRefused('NOTHING TO UNDO');
		const link = pick(
			db.prepare(`SELECT * FROM series_links WHERE series_id = ?`).get(id) as
				Record<string, unknown> | undefined,
			LINK_COLUMNS
		);
		if (sameLink(link, facts.link)) throw new UndoUnlinkRefused('ALREADY UNDONE');
		const decision =
			(db.prepare(`SELECT decision, at FROM link_decisions WHERE series_id = ?`).get(id) as
				Decision | undefined) ?? null;
		if (link || decision?.decision !== 'unlinked' || decision.at !== facts.at)
			throw new UndoUnlinkRefused('LINKED OR DECIDED AGAIN SINCE');
		db.prepare(`DELETE FROM link_decisions WHERE series_id = ?`).run(id);
		if (facts.decision)
			db.prepare(`INSERT INTO link_decisions (series_id, decision, at) VALUES (?, ?, ?)`).run(
				id,
				facts.decision.decision,
				facts.decision.at
			);
		insertRow(db, 'series_links', { series_id: id }, facts.link);
		return 'undone' as const;
	})();
}

/**
 * NONE OF THESE: remembered, so it doesn't come back. An anime settles the
 * season it names, or with none named the one that still wants a look
 * (`seasonToLook`): the season the queue offered, never one already linked.
 */
export function noneOfThese(seriesId: number, now = Date.now(), season?: number, part = 1): void {
	if (isAnime(kindOf(seriesId))) {
		noneOfSeason(seriesId, season ?? seasonToLook(seriesId) ?? openSeasonOf(seriesId), part, now);
		return;
	}
	getDb()
		.prepare(
			`INSERT OR REPLACE INTO link_decisions (series_id, decision, at) VALUES (?, 'none', ?)`
		)
		.run(seriesId, now);
}

/** UNDO of NONE OF THESE: an anime's is the season named, or the open one (as `undoLink`). */
export function undoNone(seriesId: number, season?: number, part = 1): boolean {
	if (isAnime(kindOf(seriesId)))
		return undoNoneSeason(seriesId, season ?? openSeasonOf(seriesId), part);
	return (
		getDb()
			.prepare(`DELETE FROM link_decisions WHERE series_id = ? AND decision = 'none'`)
			.run(seriesId).changes > 0
	);
}

/** The season an anime's search door acts on: the one named, else the one that wants a look, else the open one. */
function searchSeason(seriesId: number, o: { season?: number; part?: number }) {
	return {
		season: o.season ?? seasonToLook(seriesId) ?? openSeasonOf(seriesId),
		part: o.part ?? 1
	};
}

/** SKIP: to the back of the queue. An anime's item is a season's, and so is its place (c352). */
export function skip(seriesId: number, now = Date.now(), season?: number): void {
	if (isAnime(kindOf(seriesId))) {
		const at = searchSeason(seriesId, { season });
		getDb()
			.prepare(
				`UPDATE season_link_searches SET skipped_at = ? WHERE series_id = ? AND season = ? AND part = ?`
			)
			.run(now, seriesId, at.season, at.part);
		return;
	}
	getDb().prepare(`UPDATE link_searches SET skipped_at = ? WHERE series_id = ?`).run(now, seriesId);
}

export type QueuedFrom = { query: string; searchedAt: number | null } | null;

/**
 * SEARCH AGAIN (or FIND on a series never searched): the title to search,
 * for the next pass. The series leaves the review until then. Its old
 * candidates stay until the search replaces them, so UNDO (`unqueueSearch`,
 * with what this returns) puts it back as it was. An anime's is the season's
 * own row (named, or the one that wants a look), which the pass then
 * searches under this title.
 */
export function queueSearch(
	seriesId: number,
	query: string,
	o: { season?: number; part?: number } = {}
): QueuedFrom {
	const db = getDb();
	const q = query.trim();
	if (!q) throw new Error('a title to search');
	const anime = isAnime(kindOf(seriesId));
	const at = searchSeason(seriesId, o);
	return db.transaction(() => {
		if (anime) {
			const was = db
				.prepare(
					`SELECT query, searched_at FROM season_link_searches WHERE series_id = ? AND season = ? AND part = ?`
				)
				.get(seriesId, at.season, at.part) as
				{ query: string; searched_at: number | null } | undefined;
			db.prepare(
				`INSERT INTO season_link_searches (series_id, season, part, query, searched_at, found)
				VALUES (?, ?, ?, ?, NULL, 0)
				ON CONFLICT (series_id, season, part) DO UPDATE SET query = excluded.query,
					searched_at = NULL, skipped_at = NULL`
			).run(seriesId, at.season, at.part, q);
			return was ? { query: was.query, searchedAt: was.searched_at } : null;
		}
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

/** UNDO a SEARCH AGAIN that hasn't run yet: an anime's on the season it was queued for. */
export function unqueueSearch(
	seriesId: number,
	was: QueuedFrom,
	o: { season?: number; part?: number } = {}
): void {
	const db = getDb();
	if (isAnime(kindOf(seriesId))) {
		const at = searchSeason(seriesId, o);
		if (was === null)
			db.prepare(
				`DELETE FROM season_link_searches WHERE series_id = ? AND season = ? AND part = ? AND searched_at IS NULL`
			).run(seriesId, at.season, at.part);
		else
			db.prepare(
				`UPDATE season_link_searches SET query = ?, searched_at = ?
				WHERE series_id = ? AND season = ? AND part = ? AND searched_at IS NULL`
			).run(was.query, was.searchedAt, seriesId, at.season, at.part);
		return;
	}
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
		// Also a link from before rung 26, which doesn't know its entry's format
		// yet, and one from before rung 70, which doesn't know its country or year
		// (c520). Not an anime's that has season rows: those are its links, and
		// the season keeps its own year.
		.prepare(
			`SELECT l.series_id, l.anilist_id, l.mal_id, s.kind,
				l.resolved_at IS NOT NULL AND l.format IS NOT NULL AS known FROM series_links l
			JOIN series s ON s.id = l.series_id
			WHERE l.resolved_at IS NULL OR (l.format IS NULL AND l.anilist_id IS NOT NULL)
				OR (l.country IS NULL AND l.anilist_id IS NOT NULL
					AND NOT EXISTS (SELECT 1 FROM series_season_links x WHERE x.series_id = l.series_id))`
		)
		.all() as {
		series_id: number;
		anilist_id: number | null;
		mal_id: number | null;
		kind: Kind;
		/** Resolved and its format known: only its country and year are asked (rung 70). */
		known: number;
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
			format = ?, country = ?, year = ? WHERE series_id = ?`
	);
	// A link resolved before rung 70 learns only what it lacks: its title,
	// cover and format were settled then, and the owner may have chosen them.
	const backfill = db.prepare(`UPDATE series_links SET country = ?, year = ? WHERE series_id = ?`);
	// Asked and not found: '' marks it asked, so the next pass doesn't ask again.
	const none = db.prepare(
		`UPDATE series_links SET resolved_at = ?, format = COALESCE(format, ''),
			country = COALESCE(country, '') WHERE series_id = ?`
	);
	let n = 0;
	db.transaction(() => {
		for (const w of waiting) {
			const c =
				w.anilist_id !== null
					? alById.get(w.anilist_id)
					: malById.get(`${family(w.kind)}:${w.mal_id ?? -1}`);
			if (c && w.known) {
				backfill.run(c.country, c.year, w.series_id);
				n += 1;
			} else if (c) {
				set.run(
					c.anilistId,
					c.malId,
					c.title,
					c.coverUrl,
					now,
					c.format,
					c.country,
					c.year,
					w.series_id
				);
				n += 1;
			} else none.run(now, w.series_id);
		}
	})();
	return n;
}

/**
 * The owner-facing queue, and the pass that fills it: what a catalogue of manga,
 * novels and anime holds, never a doujin, never Hentoid's. An import's Mihon
 * tracker is the other door, and it can link a doujin (`resolveLinks`).
 */
// A browsing record (doc/BROWSING.md) is never in the LINK queue: it isn't the library's.
const LINKABLE = `s.kind IN ('manga', 'manhwa', 'novel', 'anime') AND s.source != 'hentoid' AND ${IN_LIBRARY_SQL}`;

/**
 * A series still wants a look: the one rule of "not linked and not settled"
 * (c240), at every door that asks it of a series -- the cover pass, the
 * review queue and its count and `links --again` for a comic or a novel, and
 * the tracker lists' auto-link (`linkableByTitle`) for every kind. Those
 * doors ask an anime the same rule a season at a time (`seasonOpen`, below),
 * since its search and its queue item are a season's (wave 17).
 *
 * A series with season rows (an anime linked or settled a season at a time,
 * rung 62) is decided by those rows alone: it wants a look while one of its
 * seasons has neither a link nor a decision. Computed from the rows rather
 * than cached on the series, so a season the source adds later puts the
 * series back by itself.
 *
 * A series with no season rows -- every comic and novel, and an anime nobody
 * has acted on -- keeps the series-level gate: no `series_links` row and no
 * `link_decisions` row, so a legacy NONE OF THESE still counts. An anime
 * linked before rung 62 was one of these, its one link ending the look while
 * season 2 was open, until rung 68 (c383) gave the link its season row; from
 * there the season rule above decides it.
 *
 * Its TypeScript twin is `seasonToLook` (season-links.ts), which names the
 * season this lets a series in for; `IN_LINK_REVIEW` builds on it for
 * Ranobe's review line that says an item is in the AniList review
 * (ranobe-review.ts).
 */
export const NEEDS_LOOK = `(CASE WHEN EXISTS (SELECT 1 FROM series_season_links x WHERE x.series_id = s.id)
		OR EXISTS (SELECT 1 FROM season_link_decisions x WHERE x.series_id = s.id)
	THEN EXISTS (
		SELECT 1 FROM entries e
		WHERE e.series_id = s.id AND e.shadowed = 0
			AND NOT EXISTS (SELECT 1 FROM series_season_links sl
				WHERE sl.series_id = s.id AND sl.season = COALESCE(e.season, 0))
			AND NOT EXISTS (SELECT 1 FROM season_link_decisions sd
				WHERE sd.series_id = s.id AND sd.season = COALESCE(e.season, 0)))
	ELSE NOT EXISTS (SELECT 1 FROM series_links l WHERE l.series_id = s.id)
		AND NOT EXISTS (SELECT 1 FROM link_decisions d WHERE d.series_id = s.id)
	END)`;

/**
 * The kinds a catalogue lists a season at a time: AniList's ANIME type, whose
 * every season (and MAL's) is its own entry (c240). Their link, search,
 * candidates and decisions are a season's rows (rung 62), never the
 * series-level `link_searches`/`link_candidates`, which are one search for the
 * whole series and so stand for no season in particular.
 */
const SEASONAL_KINDS = KINDS.filter(isAnime);
const seasonal = (alias: string) =>
	`${alias}.kind IN (${SEASONAL_KINDS.map((k) => `'${k}'`).join(', ')})`;

/**
 * One season of `s` still wants a look (c240, wave 17): `season` (an SQL
 * expression) has neither a link nor a decision of its own, and -- for a
 * series with no season rows at all, which is every anime nobody has acted on
 * and every one linked before rung 62 -- the series-level gate holds too.
 * `NEEDS_LOOK` is exactly "some season of the series passes this".
 */
const seasonOpen = (season: string) => `(NOT EXISTS (SELECT 1 FROM series_season_links sl
		WHERE sl.series_id = s.id AND sl.season = ${season})
	AND NOT EXISTS (SELECT 1 FROM season_link_decisions sd
		WHERE sd.series_id = s.id AND sd.season = ${season})
	AND (EXISTS (SELECT 1 FROM series_season_links x WHERE x.series_id = s.id)
		OR EXISTS (SELECT 1 FROM season_link_decisions x WHERE x.series_id = s.id)
		OR (NOT EXISTS (SELECT 1 FROM series_links l WHERE l.series_id = s.id)
			AND NOT EXISTS (SELECT 1 FROM link_decisions d WHERE d.series_id = s.id))))`;

/**
 * Whether `season` is one of `s`'s seasons, as `NEEDS_LOOK` and `seasonToLook`
 * count them: `COALESCE(entries.season, 0)` over its unshadowed entries, or
 * season 0 for an anime whose source gave no episodes yet and that has no
 * season rows (the season its first link or search lands on).
 */
const seasonOf = (season: string) => `(EXISTS (SELECT 1 FROM entries e
		WHERE e.series_id = s.id AND e.shadowed = 0 AND COALESCE(e.season, 0) = ${season})
	OR (${season} = 0
		AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0)
		AND NOT EXISTS (SELECT 1 FROM series_season_links x WHERE x.series_id = s.id)
		AND NOT EXISTS (SELECT 1 FROM season_link_decisions x WHERE x.series_id = s.id)))`;

/** Every season of every seasonal series, as `seasonOf` counts them: `(series_id, season)`. */
const SEASONS_SQL = `SELECT DISTINCT e.series_id, COALESCE(e.season, 0) AS season
		FROM entries e JOIN series k ON k.id = e.series_id
		WHERE e.shadowed = 0 AND ${seasonal('k')}
	UNION SELECT k.id, 0 FROM series k
		WHERE ${seasonal('k')}
			AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.series_id = k.id AND e.shadowed = 0)
			AND NOT EXISTS (SELECT 1 FROM series_season_links x WHERE x.series_id = k.id)
			AND NOT EXISTS (SELECT 1 FROM season_link_decisions x WHERE x.series_id = k.id)`;

/**
 * A series is in the AniList review: searched, and not linked or settled. A
 * comic or a novel by its series-level search; an anime when one of its open
 * seasons has a searched row of its own (c352: the queue holds an item a
 * season). Ranobe's review line asks this too (ranobe-review.ts).
 */
export const IN_LINK_REVIEW = `(CASE WHEN ${seasonal('s')}
	THEN EXISTS (SELECT 1 FROM season_link_searches ss
		WHERE ss.series_id = s.id AND ss.part = 1 AND ss.searched_at IS NOT NULL
			AND ${seasonOf('ss.season')} AND ${seasonOpen('ss.season')})
	ELSE ${NEEDS_LOOK}
		AND EXISTS (SELECT 1 FROM link_searches ls WHERE ls.series_id = s.id AND ls.searched_at IS NOT NULL)
	END)`;

type SearchRow = {
	id: number;
	title: string;
	alt_titles: string;
	kind: Kind;
	query: string | null;
	/**
	 * An anime's season this row searches (c240): each open season is searched
	 * by its own title, against its own row. Null for a comic or a novel.
	 */
	season?: number | null;
};

/**
 * What the pass may search: manga, manhwa and novels with no link and no NONE
 * OF THESE or UNLINK, never searched or waiting on a SEARCH AGAIN; and each
 * open season of an anime whose own search hasn't run, or waits on a SEARCH
 * AGAIN (wave 17: never the series-level search, which is no season's).
 * Never a hidden series, never Hentoid's. A SEARCH AGAIN goes first, then
 * the series with no cover.
 */
export function searchable(limit: number): SearchRow[] {
	return getDb()
		.prepare(
			`SELECT id, title, alt_titles, kind, query, season FROM (
				SELECT s.id, s.title, s.alt_titles, s.kind, ls.query, NULL AS season,
					ls.series_id IS NULL AS fresh, s.cover_key != '' AS covered
				FROM series s JOIN roots r ON r.id = s.root_id
				LEFT JOIN link_searches ls ON ls.series_id = s.id
				WHERE ${LINKABLE} AND ${VISIBLE_SQL} AND NOT ${seasonal('s')}
					AND ${NEEDS_LOOK}
					AND (ls.series_id IS NULL OR ls.searched_at IS NULL)
				UNION ALL
				SELECT s.id, s.title, s.alt_titles, s.kind, ss.query, q.season,
					ss.series_id IS NULL AS fresh, s.cover_key != '' AS covered
				FROM series s JOIN roots r ON r.id = s.root_id
				JOIN (${SEASONS_SQL}) q ON q.series_id = s.id
				LEFT JOIN season_link_searches ss
					ON ss.series_id = s.id AND ss.season = q.season AND ss.part = 1
				WHERE ${LINKABLE} AND ${VISIBLE_SQL} AND ${seasonal('s')}
					AND ${seasonOpen('q.season')}
					AND (ss.series_id IS NULL OR ss.searched_at IS NULL)
			)
			ORDER BY fresh, covered, id, season
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
	all: SearchRow[],
	now = Date.now(),
	opts: { autoLink?: boolean } = {}
): Promise<{ linked: number; offered: number }> {
	const autoLink = opts.autoLink ?? true;
	const db = getDb();
	// The owner's own title for a SEARCH AGAIN, as typed; the pass's cleaned,
	// with a shorter one to fall back on. An anime is searched by its season's
	// own title, since each season is its own catalogue entry (c240): the
	// season the row names (`searchable` gives a row a season), or with none
	// named the one that still wants a look, never the one CONTINUE is in,
	// which may be linked already. An anime with no such season is not
	// searched at all.
	const named = all.map((r) => (isAnime(r.kind) ? (r.season ?? seasonToLook(r.id)) : undefined));
	const rows = all.filter((r, i) => !isAnime(r.kind) || named[i] !== undefined);
	const seasonOfRow = named.filter((_, i) => !isAnime(all[i].kind) || named[i] !== undefined);
	const tries = rows.map((r, i) => {
		if (r.query) return [r.query];
		if (isAnime(r.kind)) {
			const at = seasonOfRow[i]!;
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
		const at = seasonOfRow[i];
		// The by-hand query is the owner's choice of title, so it counts as one of
		// the series'. A season past the first is judged by its own titles
		// ("Show Season 2") and the typed query, never the series' plain one,
		// which is season 1's entry: AniList's answer for "Show Season 2" lists
		// "Show" too (wave 17, round 2). Not through `matchTitles`, whose cleaning
		// cuts "Season 2" off and gives the plain title back.
		const titles =
			at !== undefined && at > 1
				? [
						...new Set([
							...titlesOfRow(r)
								.flatMap((t) => [t, ...searchTitles(t)])
								.map((t) => seasonSearchTitle(t, at)),
							...(r.query ? [r.query] : [])
						])
					]
				: matchTitles(titlesOfRow(r), r.query);
		const sure = crossed.has(i) ? null : sureMatch(titles, r.kind, hits);
		db.transaction(() => {
			if (isAnime(r.kind) && at !== undefined) {
				// An anime's search is its season's, and stored once (c355): the
				// season's own row and candidates, which the queue, FIND and the
				// season's line all read. The series-level pair is never written
				// for it, so it can never stand in for another season.
				saveSeasonSearch(r.id, at, 1, queries[i], hits, now);
				// A sure match links only the season searched, and only while it is
				// still open: never a season with a link or a decision (the owner's
				// season 1, its score and its AniSkip answers stay as they were).
				// And never an entry another season holds (`linkSeason` refuses it,
				// and the save above left it out of the candidates): offered instead.
				const open = !seasonLink(r.id, at) && !seasonSettled(r.id, at);
				if (sure && autoLink && open && linkSeason(r.id, at, 1, sure, 'exact', now)) linked += 1;
				else offered += 1;
				return;
			}
			saveSearch.run(r.id, queries[i], now, hits.length);
			clear.run(r.id);
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
 * SEARCH AGAIN titles, NONE OF THESE and UNLINK are left alone. An anime's
 * searches are its seasons': each open season the pass searched by its own
 * title is searched again, a settled one never (wave 17).
 */
export function requeueSearched(): number {
	const db = getDb();
	return db.transaction(() => {
		const ids = (
			db
				.prepare(
					`SELECT ls.series_id AS id, ls.query, s.title FROM link_searches ls JOIN series s ON s.id = ls.series_id
					WHERE ls.searched_at IS NOT NULL AND ${IN_LIBRARY_SQL} AND NOT ${seasonal('s')}
						AND ${NEEDS_LOOK}`
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
		// An anime: the season's own row, when its query is the pass's for that
		// season ("Show", "Show Season 2", or a cleaning of either).
		const seasons = (
			db
				.prepare(
					`SELECT ss.series_id AS id, ss.season, ss.part, ss.query, s.title
					FROM season_link_searches ss JOIN series s ON s.id = ss.series_id
					WHERE ss.searched_at IS NOT NULL AND ${IN_LIBRARY_SQL} AND ${seasonal('s')}
						AND ${seasonOpen('ss.season')}`
				)
				.all() as { id: number; season: number; part: number; query: string; title: string }[]
		).filter((r) =>
			[r.title, r.title.replace(/\s*(\.\.\.|…)$/, ''), ...searchTitles(r.title)].some(
				(t) => seasonSearchTitle(t, r.season) === r.query
			)
		);
		const delSeason = db.prepare(
			`DELETE FROM season_link_searches WHERE series_id = ? AND season = ? AND part = ?`
		);
		const clearSeason = db.prepare(
			`DELETE FROM season_link_candidates WHERE series_id = ? AND season = ? AND part = ?`
		);
		for (const r of seasons) {
			delSeason.run(r.id, r.season, r.part);
			clearSeason.run(r.id, r.season, r.part);
		}
		return ids.length + seasons.length;
	})();
}

export type PassResult = {
	resolved: number;
	/** Anime whose relation graph was fetched and cached (c358; doc/LINKS.md, "The relation cache"). */
	relations?: number;
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
 * `limit` series searched, then the relations of up to `relations` anime
 * cached (c358). Unreachable is not an error: the next pass tries.
 */
export async function refreshLinks(
	opts: {
		limit?: number;
		/** Anime whose relations are asked for at most (`refreshRelations`); 10 by default. */
		relations?: number;
		now?: number;
		log?: (line: string) => void;
	} = {}
): Promise<PassResult> {
	const out: PassResult = { resolved: 0, searched: 0, linked: 0, offered: 0, unreachable: false };
	const now = opts.now ?? Date.now();
	// The background fill stands aside for this, in any process (doc/LINKS.md,
	// "How the cache fills"). Real time, whatever `now` a spec passes.
	markLinkPass();
	try {
		out.resolved = await resolveLinks(now);
		// A season's own link, where only one id was known (c240).
		out.resolved += await resolveSeasonLinks(now);
		const rows = searchable(opts.limit ?? 60);
		for (let i = 0; i < rows.length; i += 25) {
			const r = await searchSeries(rows.slice(i, i + 25), now);
			markLinkPass();
			out.searched += Math.min(25, rows.length - i);
			out.linked += r.linked;
			out.offered += r.offered;
			opts.log?.(`links: ${out.searched} of ${rows.length} searched`);
		}
		// Last, so a link this pass made has its relations asked for in it
		// (c358): the series screen's seasons around an anime come from here,
		// never from a page load.
		const r = await refreshRelations(anilistPublic, {
			limit: opts.relations,
			now,
			log: opts.log,
			fatal: (e) => e instanceof Unreachable
		});
		out.relations = r.refreshed;
	} catch (e) {
		if (e instanceof Unreachable) {
			out.unreachable = true;
			out.reason = e.message;
		} else throw e;
	} finally {
		clearLinkPass();
	}
	return out;
}

export type FillResult = RelationsPass & {
	/** A link pass was running, so this one asked nothing. */
	skipped: boolean;
	unreachable: boolean;
	/** Why AniList couldn't be reached, for the log. */
	reason?: string;
};

const anilistIsOut = (e: unknown) => e instanceof Unreachable || e instanceof AnilistDown;

/**
 * The background fill's pass (relations-fill.ts; doc/LINKS.md, "How the cache
 * fills"): only the relations step of `refreshLinks`, never its search. It
 * stands aside for a link pass and gives way to one that starts while it
 * runs. Unreachable is not an error here either, nor is AniList being down
 * (`AnilistDown`): the next tick carries on, and no series lost its turn.
 */
export async function fillRelations(
	opts: { now?: number; log?: (line: string) => void; stop?: () => boolean } = {}
): Promise<FillResult> {
	const out: FillResult = {
		refreshed: 0,
		failed: 0,
		dropped: 0,
		skipped: false,
		unreachable: false
	};
	if (linkPassRunning()) return { ...out, skipped: true };
	try {
		Object.assign(
			out,
			await refreshRelations(anilistPublic, {
				now: opts.now,
				log: opts.log,
				fatal: anilistIsOut,
				retryMs: RELATIONS_RETRY_MS,
				stop: () => !!opts.stop?.() || linkPassRunning()
			})
		);
	} catch (e) {
		if (!anilistIsOut(e)) throw e;
		out.unreachable = true;
		out.reason = e.message;
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
	/**
	 * An anime's season the item is for (c240): the one that still wants a look
	 * (`seasonToLook`), which LINK, NONE OF THESE and their UNDO post, so the
	 * queue never leans on a default. Absent for a comic, a novel, and an anime
	 * with every season settled.
	 */
	season?: number;
	part?: number;
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
	skipped_at: number | null;
	/** An anime's season the row's search is (c240); null for a comic or a novel. */
	season: number | null;
};

/** The series' own columns, whatever search the row is drawn from. */
const ITEM_COLS = `s.id, s.title, s.alt_titles, s.kind, s.hue, s.source, s.cover_key, s.cover_at,
		s.cover_url, s.cover_failed_at,
		(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0) AS chapters,
		(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0 AND e.available = 1 AND e.file != '') AS downloaded,
		(SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE st.series_id = s.id AND t.namespace = 'source' LIMIT 1) AS site`;

/** A comic's or a novel's item: the series-level search. */
const ITEM_SQL = `SELECT ${ITEM_COLS},
		COALESCE(ls.query, '') AS query, COALESCE(ls.found, 0) AS found, ls.searched_at, ls.skipped_at,
		NULL AS season
	FROM series s JOIN roots r ON r.id = s.root_id LEFT JOIN link_searches ls ON ls.series_id = s.id`;

/**
 * An anime's item for one season (the one bound as the first parameter): that
 * season's own search, never the series' (c240, wave 17).
 */
const SEASON_ITEM_SQL = `SELECT ${ITEM_COLS},
		COALESCE(ss.query, '') AS query, COALESCE(ss.found, 0) AS found, ss.searched_at, ss.skipped_at,
		q.season AS season
	FROM (SELECT ? AS season, ? AS part) q JOIN series s JOIN roots r ON r.id = s.root_id
	LEFT JOIN season_link_searches ss ON ss.series_id = s.id AND ss.season = q.season AND ss.part = q.part`;

/** The queue's anime items: every open season with a searched row of its own (c352). */
const SEASON_QUEUE_SQL = `SELECT ${ITEM_COLS},
		ss.query, ss.found, ss.searched_at, ss.skipped_at, ss.season AS season
	FROM season_link_searches ss JOIN series s ON s.id = ss.series_id JOIN roots r ON r.id = s.root_id
	WHERE ss.part = 1 AND ss.searched_at IS NOT NULL AND ${seasonal('s')}
		AND ${seasonOf('ss.season')} AND ${seasonOpen('ss.season')}`;

function firstPageOf(seriesId: number): string | undefined {
	const r = getDb()
		.prepare(
			`SELECT label FROM entries WHERE series_id = ? AND available = 1 AND shadowed = 0 ORDER BY position, id LIMIT 1`
		)
		.get(seriesId) as { label: string } | undefined;
	return r?.label.toUpperCase();
}

function itemOf(r: ItemRow, part = 1): ReviewItem {
	const db = getDb();
	const titles = titlesOfRow(r);
	// An anime's item is one season's, or one of its parts' (c350, c592): its
	// candidates are that part's own, checked against the part's episodes.
	const season = isAnime(r.kind) ? r.season : null;
	const own =
		season !== null ? seriesSeasons(r.id)?.seasons.find((x) => x.season === season) : undefined;
	const span = part > 1 ? own?.parts.find((p) => p.part === part) : null;
	// What a part's candidates are checked against: its own episodes. Part 2's
	// span exists once it is linked (`partsOf`); before that it is what part 1
	// leaves, as `+ A SECOND PART` says (c350). An orphaned part 2's span is
	// empty (nothing places it, c592), so the check falls back to the season's
	// own listed count, less part 1's episodes where part 1 is linked.
	const partOne = own?.parts.find((p) => p.part === 1)?.link ?? null;
	const spanCount = span && span.to >= span.from ? span.to - span.from + 1 : null;
	const chapters =
		spanCount !== null
			? spanCount
			: part > 1 && own
				? Math.max(0, own.aired - (partOne?.episodes ?? 0))
				: own
					? own.aired
					: r.chapters;
	const cands =
		season !== null
			? seasonCandidates(r.id, season, part)
			: (
					db
						.prepare(`SELECT data FROM link_candidates WHERE series_id = ? ORDER BY rank`)
						.all(r.id) as { data: string }[]
				).map((x) => JSON.parse(x.data) as Candidate);
	const series = {
		titles: own ? [own.searchTitle, ...titles.slice(1)] : titles,
		kind: r.kind,
		chapters
	};
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
			linkCover: linkCover(r.id) !== null,
			pageOf: r.cover_key.startsWith('page:') ? firstPageOf(r.id) : undefined
		}),
		query: r.query || (own ? own.searchTitle : r.title),
		found: r.found,
		searched: r.searched_at !== null,
		searchedAt: r.searched_at,
		cutShort: isCutShort(r.title),
		...(season !== null ? { season, part } : {}),
		candidates: cands.map((c) => ({
			...c,
			why: whyLine(series, c),
			rows: candidateRows(series, c),
			ids: idsLine(c.anilistId, c.malId)
		}))
	};
}

/** The queue's order: a skipped item last, then nothing found, then a series with a cover. */
const QUEUE_ORDER = `ORDER BY skipped_at IS NOT NULL, skipped_at, found = 0, cover_key != '', id, season`;

/**
 * The series to review: searched, not linked, not settled with NONE OF THESE
 * or UNLINK, with candidates, or none found. An anime is an item a season
 * (c352): each open season with a searched row of its own, carrying that
 * season's search and candidates -- never another season's, and never the
 * series-level search (wave 17). A skipped one goes to the back. Hidden
 * series are never searched, so they're never here while reveal is off; the
 * filter is only belt and braces for one hidden since.
 */
export function linkQueue(reveal: boolean): ReviewItem[] {
	const rows = getDb()
		.prepare(
			`SELECT * FROM (
				${ITEM_SQL}
				WHERE ls.searched_at IS NOT NULL AND ${visibleWhere(reveal)} AND ${LINKABLE}
					AND NOT ${seasonal('s')} AND ${NEEDS_LOOK}
				UNION ALL
				${SEASON_QUEUE_SQL} AND ${visibleWhere(reveal)} AND ${LINKABLE}
			) ${QUEUE_ORDER}`
		)
		.all() as ItemRow[];
	return rows.map((r) => itemOf(r));
}

/** How many wait in the review: the library band's count, an anime's seasons each one. */
export function linkQueueCount(reveal: boolean): number {
	const db = getDb();
	const comics = db
		.prepare(
			`SELECT COUNT(*) AS n FROM link_searches ls JOIN series s ON s.id = ls.series_id JOIN roots r ON r.id = s.root_id
			WHERE ls.searched_at IS NOT NULL AND ${visibleWhere(reveal)} AND ${LINKABLE}
				AND NOT ${seasonal('s')} AND ${NEEDS_LOOK}`
		)
		.get() as { n: number };
	const seasons = db
		.prepare(
			`SELECT COUNT(*) AS n FROM (${SEASON_QUEUE_SQL} AND ${visibleWhere(reveal)} AND ${LINKABLE})`
		)
		.get() as { n: number };
	return comics.n + seasons.n;
}

/**
 * One series as the review shows it, whether or not it's in the queue: FIND
 * on its screen. An anime is shown as one season, or one part of one: the
 * one named, else the one that still wants a look, else the one CONTINUE is
 * in. `part` 2 is a season's second part by hand (c350), and the item a
 * season whose only row is part 2 stands on too (c592): its search, its
 * candidates and its own share of the episodes.
 */
export function reviewItem(
	seriesId: number,
	reveal: boolean,
	season?: number,
	part = 1
): ReviewItem | null {
	const db = getDb();
	if (isAnime(kindOf(seriesId))) {
		const at = season ?? seasonToLook(seriesId) ?? openSeasonOf(seriesId);
		const r = db
			.prepare(`${SEASON_ITEM_SQL} WHERE s.id = ? AND ${visibleWhere(reveal)}`)
			.get(at, part, seriesId) as ItemRow | undefined;
		return r ? itemOf(r, part) : null;
	}
	const r = db.prepare(`${ITEM_SQL} WHERE s.id = ? AND ${visibleWhere(reveal)}`).get(seriesId) as
		ItemRow | undefined;
	return r ? itemOf(r) : null;
}

/**
 * A candidate the review offered for this series, for LINK. An anime's is the
 * season's own only (named, or the one that still wants a look): the queue
 * and FIND both draw a season's candidates, so one season's candidate is
 * never offered for another (wave 17; the series' own candidates, which
 * belong to no season, are not asked).
 */
export function offered(
	seriesId: number,
	anilistId: number,
	season?: number,
	part = 1
): Candidate | null {
	const kind = kindOf(seriesId);
	if (kind && isAnime(kind))
		return offeredSeason(
			seriesId,
			season ?? seasonToLook(seriesId) ?? openSeasonOf(seriesId),
			kind,
			anilistId,
			part
		);
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
		/**
		 * The entry's stored format (`MANGA`, `NOVEL`, `TV`): the LISTS line's
		 * meta names it (c424). Null until a pass or a link has read it.
		 */
		format: string | null;
		/**
		 * Where the entry comes from (AniList's countryOfOrigin) and the year it
		 * began (rung 70, c520): a comic's line says `MANHWA · 2020`. Null for a
		 * link not asked yet, and for an anime, whose season keeps its own year.
		 */
		country: string | null;
		year: number | null;
	} | null;
	/**
	 * What settled it when no link stands: NONE OF THESE or an UNLINK (c424).
	 * The line says so in the decision's own word, and its FIND goes plain.
	 */
	decision: SeasonDecision | null;
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
 * The LINK and COVER rows (Series Link 1k–1s). Null for a doujin: it is never
 * offered a row, although an import's Mihon tracker can link one
 * (`resolveLinks`).
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
	if (isAnime(r.kind)) return seasonLinkState(seriesId, r, season);
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
					kind: l.format ? candidateKind({ format: l.format, country: '' }) : null,
					format: l.format || null,
					country: l.country || null,
					year: l.year
				}
			: null,
		decision: l ? null : decisionOf(db, seriesId),
		candidates: item.candidates.length,
		searched: r.searched_at !== null,
		queued: r.query !== '' && r.searched_at === null,
		hidden: !!r.hidden,
		cover: item.cover
	};
}

/** A comic's or a novel's settled decision (`link_decisions`), when no link stands. */
function decisionOf(db: Database.Database, seriesId: number): SeasonDecision | null {
	const d = db.prepare(`SELECT decision FROM link_decisions WHERE series_id = ?`).get(seriesId) as
		{ decision: SeasonDecision } | undefined;
	return d?.decision ?? null;
}

/**
 * An anime's LINK row for one season: its own row, or the series' shape from
 * before rung 62 -- which `seriesSeasons` reads as the first season's, and only
 * for a series that has no season rows at all. A season with no row of its own
 * is not linked, whatever the open season or the mirror says (c240).
 */
function seasonLinkState(
	seriesId: number,
	r: ItemRow & { hidden: number },
	season?: number
): LinkState {
	const view = seriesSeasons(seriesId);
	const at = season ?? view?.open ?? 0;
	const sv = view?.seasons.find((s) => s.season === at) ?? null;
	const l = sv?.link ?? null;
	// Only the cover is read from the item; it is drawn as the season's, so no
	// series-level search is asked for an anime (wave 17).
	const item = itemOf({ ...r, chapters: sv?.aired ?? r.chapters, season: at });
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
					kind: l.format ? candidateKind({ format: l.format, country: '' }) : null,
					format: l.format || null,
					country: null,
					year: l.year ?? null
				}
			: null,
		decision: l ? null : (sv?.decision ?? null),
		candidates: sv?.candidates ?? 0,
		searched: sv?.searched ?? false,
		queued: sv?.queued ?? false,
		hidden: !!r.hidden,
		cover: item.cover
	};
}

/**
 * The cover a link offers (doc/COVERS.md), for covers.ts and the review's cover
 * line, so the two can never disagree. An anime's is the open season's, else
 * its first season's (a cover is the series', and season 1's art is a cover of
 * it), else a link from before rung 62.
 */
export function linkCover(seriesId: number): { anilistId: number; url: string } | null {
	if (isAnime(kindOf(seriesId))) {
		const l =
			seasonLink(seriesId, openSeasonOf(seriesId)) ??
			firstSeasonLink(seriesId) ??
			legacyLink(seriesId);
		return l?.anilistId && l.coverUrl ? { anilistId: l.anilistId, url: l.coverUrl } : null;
	}
	const r = getDb()
		.prepare(
			`SELECT anilist_id, cover_url FROM series_links WHERE series_id = ? AND anilist_id IS NOT NULL AND cover_url != ''`
		)
		.get(seriesId) as { anilist_id: number; cover_url: string } | undefined;
	return r ? { anilistId: r.anilist_id, url: r.cover_url } : null;
}

/**
 * The catalogue's names for a series, for OTHER NAMES on MOVE (c467): a comic's
 * link, or every season an anime has linked, in season order. Read from the
 * season rows, so a show with only season 2 linked still has its name.
 */
export function linkedNames(seriesId: number): string[] {
	return (
		getDb()
			.prepare(
				`SELECT title FROM (
					SELECT title, -1 AS season, 0 AS part FROM series_links WHERE series_id = ?
					UNION ALL SELECT title, season, part FROM series_season_links WHERE series_id = ?
				) WHERE title != '' ORDER BY season, part`
			)
			.all(seriesId, seriesId) as { title: string }[]
	).map((r) => r.title);
}

/**
 * Series linked, for SETTINGS and the logs: a comic's or a novel's link, or
 * any season of an anime's (c240). An anime counts once.
 */
export function linkCount(): number {
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM (SELECT series_id FROM series_links
				UNION SELECT series_id FROM series_season_links)`
			)
			.get() as { n: number }
	).n;
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

/**
 * What a search replaced, so its UNDO can put it back. One per series (an
 * anime's: one per season searched), this process only.
 */
type Before = {
	search: {
		query: string;
		searched_at: number | null;
		found: number;
		skipped_at: number | null;
	} | null;
	candidates: { anilist_id: number; rank: number; data: string }[];
};
const before = new Map<string, Before>();
const beforeKey = (seriesId: number, at?: { season: number; part: number }) =>
	at ? `${seriesId}:${at.season}:${at.part}` : String(seriesId);

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
 * formats, kept against that season only -- the one record of it, which the
 * queue, FIND and the season's line all read (c355) -- and LINK writes that
 * season's row. With no season named, the season that still wants a look,
 * and only when every season is settled, the open one.
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
	const at = isAnime(row.kind) ? searchSeason(seriesId, o) : undefined;
	const snapshot: Before = at
		? {
				search:
					(db
						.prepare(
							`SELECT query, searched_at, found, skipped_at FROM season_link_searches
							WHERE series_id = ? AND season = ? AND part = ?`
						)
						.get(seriesId, at.season, at.part) as Before['search'] | undefined) ?? null,
				candidates: db
					.prepare(
						`SELECT anilist_id, rank, data FROM season_link_candidates
						WHERE series_id = ? AND season = ? AND part = ?`
					)
					.all(seriesId, at.season, at.part) as Before['candidates']
			}
		: {
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
		if (at) {
			const hits = (await searchMany([{ title: q, kind: row.kind }]))[0] ?? [];
			const found = saveSeasonSearch(seriesId, at.season, at.part, q, hits, now);
			before.set(beforeKey(seriesId, at), snapshot);
			return { outcome: 'found', found };
		}
		await searchSeries([{ ...row, query: q }], now, { autoLink: false });
		before.set(beforeKey(seriesId), snapshot);
		const found = (
			db.prepare(`SELECT found FROM link_searches WHERE series_id = ?`).get(seriesId) as {
				found: number;
			}
		).found;
		return { outcome: 'found', found };
	} catch (e) {
		if (!(e instanceof Unreachable)) throw e;
		before.delete(beforeKey(seriesId, at));
		return { outcome: 'queued', was: queueSearch(seriesId, q, at ?? {}) };
	}
}

/**
 * UNDO a SEARCH AGAIN: the search and the candidates it replaced come back.
 * A search the owner runs never makes a link (c298's rule), so there is
 * nothing of the search's to take back here -- a link made by the review's
 * own LINK is undone by that decision's UNDO. A search that waited for the
 * pass (AniList out of reach) is taken back as before, with what `searchNow`
 * returned. An anime's is the season's it searched, which the caller names.
 */
export function undoSearch(
	seriesId: number,
	was: QueuedFrom | undefined,
	o: { season?: number; part?: number } = {}
): void {
	const db = getDb();
	const at = isAnime(kindOf(seriesId)) ? searchSeason(seriesId, o) : undefined;
	const key = beforeKey(seriesId, at);
	const b = before.get(key);
	if (!b) {
		unqueueSearch(seriesId, was ?? null, at ?? {});
		return;
	}
	db.transaction(() => {
		if (at) {
			const where = `WHERE series_id = ? AND season = ? AND part = ?`;
			db.prepare(`DELETE FROM season_link_candidates ${where}`).run(seriesId, at.season, at.part);
			db.prepare(`DELETE FROM season_link_searches ${where}`).run(seriesId, at.season, at.part);
			if (b.search)
				db.prepare(
					`INSERT INTO season_link_searches (series_id, season, part, query, searched_at, found, skipped_at)
					VALUES (?, ?, ?, ?, ?, ?, ?)`
				).run(
					seriesId,
					at.season,
					at.part,
					b.search.query,
					b.search.searched_at,
					b.search.found,
					b.search.skipped_at
				);
			const put = db.prepare(
				`INSERT INTO season_link_candidates (series_id, season, part, anilist_id, rank, data)
				VALUES (?, ?, ?, ?, ?, ?)`
			);
			for (const c of b.candidates)
				put.run(seriesId, at.season, at.part, c.anilist_id, c.rank, c.data);
			return;
		}
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
	before.delete(key);
}

/**
 * Series an entry on the owner's list could link to, by title: linkable, in
 * view, not linked and not settled (`NEEDS_LOOK`: an anime while one season
 * has neither) -- each under its titles, cleaned and normalised as a sure
 * match compares them (doc/TRACKING.md). The season an anime's entry lands on
 * is `linkSeasonFromList`'s to decide, and it never replaces a settled one.
 */
export function linkableByTitle(): Map<string, { id: number; kind: Kind }[]> {
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.title, s.alt_titles, s.kind FROM series s JOIN roots r ON r.id = s.root_id
			WHERE ${LINKABLE} AND ${VISIBLE_SQL}
				AND ${NEEDS_LOOK}`
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
