import { basename } from './fspath.ts';
import { getDb } from './db.ts';
import { IN_LIBRARY_SQL, VISIBLE_SQL } from './visibility.ts';
import { sourceFlagSql } from './engine/source-flags.ts';
import { SignedOut, Unreachable } from './catalogue.ts';
import { cleanTitle, coverOnly, isAnime } from '../library/catalogue.ts';
import {
	DEFAULT_LANG,
	RANOBE_KINDS,
	byWork,
	chooseEdition,
	iso,
	mapAnimeUnits,
	mapUnits,
	mapWorkUnits,
	searchKinds,
	ratingOut,
	suggestedUnits,
	unitsRead,
	volumeOf,
	type EditionSummary,
	type RanobeCandidate,
	type Unit,
	type WorkUnits
} from '../library/ranobe.ts';
import type { Kind } from '../library/types.ts';

/**
 * Ranobe (doc/RANOBE.md, ranobe.ink): a catalogue of novels, and the
 * reader's library on it, kept moving from what's read here.
 *
 * - **Matching** asks `POST /lookup` with the AniList and MAL ids a novel's
 *   link already has. Choosing among search results is the /links review's,
 *   later.
 * - **Editions**: a series reads the work's edition in its own language. When
 *   Ranobe has none, the pass suggests one as a bundle, and the series waits
 *   until it is approved.
 * - **Units**: each entry keeps the unit it is, from the edition's table of
 *   contents, and a unit read here is sent as one read.
 * - **Comics** read against the work's own chapters: no edition,
 *   no suggestion, and only a chapter the work counts is sent.
 * - **Anime** read against the work's own episodes, numbered straight
 *   through the seasons: one work for the whole show, its entry on season 1.
 * - **Never** for a hidden series or anything from Hentoid: not looked up,
 *   not suggested, not sent. Incognito reading records nothing, so nothing
 *   follows it here either.
 */

const BASE = () => (process.env.RANOBE_URL ?? 'https://ranobe.ink/api/v1').replace(/\/$/, '');
const token = () => process.env.RANOBE_TOKEN ?? '';

/** Whether Ranobe can be written to at all: a token in .env (doc/SECRETS.md). */
export const configured = () => token() !== '';

/**
 * The app account's token (Ranobe's ACCOUNTS.md, "An app's account"), for
 * suggestions only. Its edits always wait for a person, where the reader's
 * own token -- a moderator's -- would have them applied as sent. The
 * reader's stays for the library.
 */
const suggestToken = () => process.env.RANOBE_SUGGEST_TOKEN ?? '';
export const suggestConfigured = () => configured() && suggestToken() !== '';

/** Ranobe answered, and said no. `code` is from its closed list (API-V1.md, "Errors"). */
export class Refused extends Error {
	// Plain fields, not parameter properties: scripts run this file with
	// Node's type stripping, which can't compile those.
	readonly status: number;
	readonly code: string;
	readonly details: Record<string, unknown>;
	constructor(status: number, code: string, details: Record<string, unknown> = {}) {
		super(`Ranobe ${status} ${code}`);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);

/** For specs: a stand-in for the network. */
export function setRanobeFetch(f: Fetch | null): void {
	fetcher = f ?? ((...a) => fetch(...a));
}

export async function api<T>(
	path: string,
	init: { method?: string; body?: unknown; key?: string; as?: 'suggest' } = {}
): Promise<T | null> {
	// The e2e server reaches no catalogue at all, Ranobe included.
	if (process.env.TSUNDOKU_ANILIST === 'off' || process.env.TSUNDOKU_RANOBE === 'off')
		throw new Unreachable('switched off');
	for (let attempt = 0; attempt < 2; attempt++) {
		let res: Response;
		try {
			res = await fetcher(`${BASE()}${path}`, {
				method: init.method ?? 'GET',
				headers: {
					accept: 'application/json',
					authorization: `Bearer ${init.as === 'suggest' ? suggestToken() : token()}`,
					...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
					...(init.key ? { 'idempotency-key': init.key } : {})
				},
				body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
				signal: AbortSignal.timeout(20_000)
			});
		} catch (e) {
			throw new Unreachable(String(e));
		}
		if (res.status === 429 && attempt === 0) {
			const after = Number(res.headers.get('retry-after') ?? '10');
			await new Promise((r) =>
				setTimeout(r, Math.min(60, Number.isFinite(after) ? after : 10) * 1000)
			);
			continue;
		}
		if (res.status === 204) return null;
		const body = (await res.json().catch(() => null)) as
			(T & { error?: { code: string; details?: Record<string, unknown> } }) | null;
		if (res.ok) return body;
		const code = body?.error?.code ?? 'no_answer';
		if (res.status === 401) throw new SignedOut(`Ranobe refused the token (${code})`);
		throw new Refused(res.status, code, body?.error?.details ?? {});
	}
	throw new Unreachable('rate limited');
}

export const why = (e: unknown) =>
	e instanceof SignedOut
		? 'RANOBE REFUSED THE TOKEN'
		: e instanceof Unreachable
			? 'RANOBE DID NOT ANSWER'
			: 'RANOBE REFUSED IT';

/**
 * The series Ranobe may hear of: of a kind it tracks, not hidden, in the
 * library (never a browsing record), not from Hentoid. The one place the
 * rule is spelled, over `series s JOIN roots r`.
 */
export const ELIGIBLE_SQL = `(s.kind IN (${RANOBE_KINDS.map((k) => `'${k}'`).join(', ')})
	AND ${VISIBLE_SQL} AND ${IN_LIBRARY_SQL} AND s.source != 'hentoid')`;

/**
 * The novels among them: what is searched, reviewed and suggested, and what
 * reads an edition. Comics only ever link by their ids (doc/RANOBE.md, "Comics").
 */
export const ELIGIBLE_NOVEL_SQL = `(${ELIGIBLE_SQL} AND s.kind = 'novel')`;

export function eligible(seriesId: number): boolean {
	return !!getDb()
		.prepare(
			`SELECT 1 FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ? AND ${ELIGIBLE_SQL}`
		)
		.get(seriesId);
}

// ---- matching -------------------------------------------------------------------------------

/**
 * The AniList/MAL ids Ranobe knows a series by, as a table to join on
 * `series_id` (`anilist_id`, `mal_id`, `format`): its link, or -- for an anime
 * linked a season at a time -- its lowest linked season's own row,
 * part 1, and still an answer when only a later season is linked:
 * Ranobe keeps one work for the whole show either way. An anime's
 * `series_links` row answers only with no season row beside it.
 */
export const LINK_IDS_SQL = `(SELECT series_id, anilist_id, mal_id, format FROM series_links
		WHERE series_id NOT IN (SELECT series_id FROM series_season_links)
	UNION ALL SELECT x.series_id, x.anilist_id, x.mal_id, x.format FROM series_season_links x
		WHERE x.part = 1
			AND x.season = (SELECT MIN(y.season) FROM series_season_links y WHERE y.series_id = x.series_id))`;

/**
 * Link every novel Ranobe knows by an id its catalogue link already has.
 * A cover-only link (a novel to its comic's entry) is the comic's id, so it
 * is never asked about: it would answer the comic.
 */
export async function matchByLookup(now = Date.now()): Promise<number> {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT s.id, s.title, s.kind, l.anilist_id, l.mal_id, l.format,
				(SELECT e.file FROM entries e WHERE e.series_id = s.id AND e.file != '' LIMIT 1) AS file,
				(SELECT e.language FROM entries e WHERE e.series_id = s.id AND e.language IS NOT NULL LIMIT 1) AS lang
			FROM series s JOIN roots r ON r.id = s.root_id JOIN ${LINK_IDS_SQL} l ON l.series_id = s.id
			WHERE ${ELIGIBLE_SQL} AND s.id NOT IN (SELECT series_id FROM ranobe_links)
				AND s.id NOT IN (SELECT series_id FROM ranobe_decisions)
				AND (l.anilist_id IS NOT NULL OR l.mal_id IS NOT NULL)`
		)
		.all() as {
		id: number;
		title: string;
		kind: Kind;
		anilist_id: number | null;
		mal_id: number | null;
		format: string | null;
		file: string | null;
		lang: string | null;
	}[];
	const asked = rows.filter((r) => !coverOnly(r.kind, r.format ?? ''));
	// MAL keeps anime ids apart from manga's, and Ranobe files them that way
	// (`mal_anime:`; API-V1.md, "External ids"). AniList's one sequence serves
	// both lists.
	const keysOf = (r: (typeof asked)[number]) => [
		...(r.anilist_id ? [`anilist:${r.anilist_id}`] : []),
		...(r.mal_id ? [`${isAnime(r.kind) ? 'mal_anime' : 'mal'}:${r.mal_id}`] : [])
	];
	let linked = 0;
	// 200 keys a request; a series asks with at most two.
	for (let i = 0; i < asked.length; i += 100) {
		const batch = asked.slice(i, i + 100);
		const answer = await api<{ results: Record<string, { ref: string } | null> }>('/lookup', {
			method: 'POST',
			body: { keys: batch.flatMap(keysOf) }
		});
		db.transaction(() => {
			for (const r of batch) {
				const work = keysOf(r)
					.map((k) => answer?.results[k]?.ref)
					.find((ref) => ref && /^w\d+$/.test(ref));
				if (!work) continue;
				if (linkWork(r.id, work, 'lookup', now, { replace: false })) linked += 1;
			}
		})();
	}
	return linked;
}

/**
 * Link a series to a work: its language and volume worked out from its
 * files, a decision about it gone. `replace: false` leaves a link that's
 * there alone. The edition follows in the next pass (or at once, when the
 * work's links already have one in the language). True when it linked.
 */
export function linkWork(
	seriesId: number,
	work: string,
	via: 'lookup' | 'review' | 'pasted',
	now = Date.now(),
	o: { replace?: boolean; title?: string } = {}
): boolean {
	const db = getDb();
	const r = db
		.prepare(
			`SELECT s.title, s.kind,
				(SELECT e.file FROM entries e WHERE e.series_id = s.id AND e.file != '' LIMIT 1) AS file,
				(SELECT e.language FROM entries e WHERE e.series_id = s.id AND e.language IS NOT NULL LIMIT 1) AS lang
			FROM series s WHERE s.id = ?`
		)
		.get(seriesId) as
		{ title: string; kind: Kind; file: string | null; lang: string | null } | undefined;
	if (!r) return false;
	const lang = r.lang ?? DEFAULT_LANG;
	// A comic is the work's chapters: no volume of its own, no edition to share.
	const comic = byWork(r.kind);
	const volume = comic ? null : volumeOf(r.title, r.file ? basename(r.file) : '');
	// A sibling of the same work in the same language already knows the edition.
	const known = comic
		? undefined
		: (db
				.prepare(
					`SELECT edition, title FROM ranobe_links WHERE work = ? AND lang = ? AND edition IS NOT NULL LIMIT 1`
				)
				.get(work, lang) as { edition: string; title: string } | undefined);
	return db.transaction(() => {
		if (
			o.replace === false &&
			db.prepare(`SELECT 1 FROM ranobe_links WHERE series_id = ?`).get(seriesId)
		)
			return false;
		db.prepare(`DELETE FROM ranobe_decisions WHERE series_id = ?`).run(seriesId);
		db.prepare(`UPDATE entries SET ranobe_unit = NULL WHERE series_id = ?`).run(seriesId);
		db.prepare(
			`INSERT INTO ranobe_links (series_id, work, edition, lang, volume, via, title, linked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (series_id) DO UPDATE SET work = excluded.work, edition = excluded.edition, lang = excluded.lang,
				volume = excluded.volume, via = excluded.via, title = excluded.title, linked_at = excluded.linked_at, mapped_at = NULL`
		).run(
			seriesId,
			work,
			known?.edition ?? null,
			lang,
			volume,
			via,
			known?.title ?? o.title ?? '',
			now
		);
		return true;
	})();
}

/**
 * UNLINK: the link goes and the entries lose their units. What was sent
 * stays on Ranobe. With `decide`, a pass never links it again (the reader
 * said no); UNDO of a LINK just made passes false.
 */
export function unlinkSeries(seriesId: number, now = Date.now(), decide = true): void {
	const db = getDb();
	db.transaction(() => {
		db.prepare(`DELETE FROM ranobe_links WHERE series_id = ?`).run(seriesId);
		db.prepare(`UPDATE entries SET ranobe_unit = NULL WHERE series_id = ?`).run(seriesId);
		if (decide)
			db.prepare(
				`INSERT INTO ranobe_decisions (series_id, decision, at) VALUES (?, 'unlinked', ?)
				ON CONFLICT (series_id) DO UPDATE SET decision = 'unlinked', at = excluded.at`
			).run(seriesId, now);
	})();
}

// ---- searching ------------------------------------------------------------------------------

type SearchItem = {
	ref: string;
	kind: { id: string };
	title: string;
	matched: string;
	status: string;
	years: string;
	cover: { url: string; sensitive: boolean } | null;
	units: Record<string, number>;
};

const asCandidate = (i: SearchItem): RanobeCandidate => ({
	work: i.ref,
	kind: i.kind.id,
	title: i.title,
	matched: i.matched ?? '',
	status: i.status ?? '',
	years: i.years ?? '',
	units: i.units ?? {},
	cover: i.cover?.url
		? {
				url: i.cover.url.startsWith('/') ? `${ORIGIN()}${i.cover.url}` : i.cover.url,
				sensitive: !!i.cover.sensitive
			}
		: null
});
const ORIGIN = () => new URL(BASE()).origin;

/** A work as a candidate, from `/works/{ref}`: PASTE A LINK. Null: no such work. */
export async function readWork(ref: string): Promise<RanobeCandidate | null> {
	try {
		const w = await api<{
			ref: string;
			title: string;
			kind: { id: string };
			cover: { url: string; sensitive: boolean } | null;
			editions: EditionSummary[];
			snapshot?: { status?: string };
			units?: WorkUnits | null;
		}>(`/works/${ref}?fields=units`);
		if (!w) return null;
		const units: Record<string, number> = {};
		for (const e of w.editions ?? [])
			for (const [t, n] of Object.entries(e.units ?? {})) units[t] = Math.max(units[t] ?? 0, n);
		// A comic has no edition: its count is the work's own.
		if (w.units) units[w.units.type] = Math.max(units[w.units.type] ?? 0, w.units.count ?? 0);
		return asCandidate({
			ref: w.ref,
			kind: w.kind,
			title: w.title,
			matched: 'FROM YOUR LINK',
			status: w.snapshot?.status ?? '',
			years: '',
			cover: w.cover,
			units
		});
	} catch (e) {
		if (e instanceof Refused && (e.status === 404 || e.status === 410)) return null;
		throw e;
	}
}

/**
 * Search Ranobe for one series' title, novels only, and keep what it
 * found as the series' candidates (contract step 2). A work chosen for a
 * sibling just now stays first. Only the title is sent.
 */
export async function searchOne(
	seriesId: number,
	query: string,
	now = Date.now()
): Promise<number> {
	const db = getDb();
	const q = query.trim();
	const { kind } = (db.prepare(`SELECT kind FROM series WHERE id = ?`).get(seriesId) as
		{ kind: Kind } | undefined) ?? { kind: 'novel' as Kind };
	const a = await api<{ items: SearchItem[] }>(
		`/search?q=${encodeURIComponent(q)}&kind=${searchKinds(kind)}&limit=10`
	);
	const items = a?.items ?? [];
	db.transaction(() => {
		db.prepare(`DELETE FROM ranobe_candidates WHERE series_id = ? AND rank >= 0`).run(seriesId);
		const put = db.prepare(
			`INSERT INTO ranobe_candidates (series_id, work, rank, data) VALUES (?, ?, ?, ?)
			ON CONFLICT (series_id, work) DO NOTHING`
		);
		items.forEach((i, rank) => put.run(seriesId, i.ref, rank, JSON.stringify(asCandidate(i))));
		db.prepare(
			`INSERT INTO ranobe_searches (series_id, query, searched_at, found) VALUES (?, ?, ?, ?)
			ON CONFLICT (series_id) DO UPDATE SET query = excluded.query, searched_at = excluded.searched_at,
				found = excluded.found, skipped_at = NULL`
		).run(seriesId, q, now, items.length);
	})();
	return items.length;
}

/**
 * Every eligible novel the ids didn't link, not settled and not searched
 * yet (or waiting on a SEARCH AGAIN), searched by its title with the volume
 * taken off. Nothing is linked from a search: the reader chooses on /links.
 * Never a comic: AniList links nearly all of them, and the rest would fill the
 * review with titles the ids already had their chance at. FIND on a comic's
 * screen still searches it.
 */
export async function searchNovels(now = Date.now(), limit = 200): Promise<number> {
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.title, rs.query FROM series s JOIN roots r ON r.id = s.root_id
			LEFT JOIN ranobe_searches rs ON rs.series_id = s.id
			WHERE ${ELIGIBLE_NOVEL_SQL} AND rs.searched_at IS NULL
				AND s.id NOT IN (SELECT series_id FROM ranobe_links)
				AND s.id NOT IN (SELECT series_id FROM ranobe_decisions)
				AND s.id NOT IN (SELECT series_id FROM ranobe_work_suggestions WHERE status = 'pending')
			ORDER BY s.id LIMIT ?`
		)
		.all(limit) as { id: number; title: string; query: string | null }[];
	let n = 0;
	for (const r of rows)
		try {
			await searchOne(r.id, r.query || cleanTitle(r.title) || r.title, now);
			n += 1;
		} catch (e) {
			if (!(e instanceof Refused)) throw e;
			console.error('tsundoku: a Ranobe search was refused:', e.code);
		}
	return n;
}

// ---- what Ranobe says -----------------------------------------------------------------------

type EntryAnswer = {
	work: string;
	status?: string;
	rating?: number | null;
	favourite?: boolean;
	progress?: { type: string; number: string; of: number | null } | null;
};

/** Keep what Ranobe answered of an entry: from the library, a PUT, or a read's answer. */
function saveRemote(e: EntryAnswer, now: number): void {
	getDb()
		.prepare(
			`INSERT INTO ranobe_works (work, status, progress_type, progress_number, progress_of, remote_rating, remote_favourite, state_at)
			VALUES (@work, @status, @ptype, @pnum, @pof, @rating, @fav, @now)
			ON CONFLICT (work) DO UPDATE SET
				status = COALESCE(@status, status),
				progress_type = CASE WHEN @hasProgress THEN @ptype ELSE progress_type END,
				progress_number = CASE WHEN @hasProgress THEN @pnum ELSE progress_number END,
				progress_of = CASE WHEN @hasProgress THEN @pof ELSE progress_of END,
				remote_rating = CASE WHEN @hasRating THEN @rating ELSE remote_rating END,
				remote_favourite = COALESCE(@fav, remote_favourite),
				state_at = @now`
		)
		.run({
			work: e.work,
			status: e.status ?? null,
			hasProgress: e.progress !== undefined ? 1 : 0,
			ptype: e.progress?.type ?? null,
			pnum: e.progress?.number ?? null,
			pof: e.progress?.of ?? null,
			hasRating: e.rating !== undefined ? 1 : 0,
			rating: e.rating ?? null,
			fav: e.favourite === undefined ? null : e.favourite ? 1 : 0,
			now
		});
}

/** The reader's library on Ranobe, for the works linked here: the TRACKING line's words. */
export async function readLibrary(now = Date.now()): Promise<number> {
	const works = new Set(
		(getDb().prepare(`SELECT DISTINCT work FROM ranobe_links`).all() as { work: string }[]).map(
			(r) => r.work
		)
	);
	if (!works.size) return 0;
	let cursor: string | null = null;
	let n = 0;
	do {
		const page: { items: EntryAnswer[]; nextCursor: string | null } | null = await api(
			`/me/library?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
		);
		for (const e of page?.items ?? [])
			if (works.has(e.work)) {
				saveRemote(e, now);
				n += 1;
			}
		cursor = page?.nextCursor ?? null;
	} while (cursor);
	return n;
}

// ---- editions -------------------------------------------------------------------------------

type Work = { ref: string; title: string; editions: EditionSummary[] };
type BundleAnswer = {
	bundle: number;
	status: string;
	items: { key: string; ref: string | null; status: string }[];
};

function setEdition(work: string, lang: string, edition: string): void {
	getDb()
		.prepare(
			`UPDATE ranobe_links SET edition = ?, mapped_at = NULL WHERE work = ? AND lang = ? AND edition IS NULL`
		)
		.run(edition, work, lang);
}

/**
 * The edition each linked series reads. One in the series' language is
 * taken; with none, one is suggested,
 * and a suggestion already made is asked after until it is decided.
 */
export async function resolveEditions(now = Date.now()): Promise<{
	found: number;
	suggested: number;
	waiting: number;
}> {
	const db = getDb();
	// NEVER TRACKED stops the whole step for a work only its series link:
	// no `GET /works/{ref}` and, above all, no suggestion. A work another
	// linked series still wants is looked up and may be suggested, but that
	// series' volumes alone build the reason (`suggestEdition`).
	const wanted = db
		.prepare(
			`SELECT DISTINCT l.work, l.lang FROM ranobe_links l JOIN series s ON s.id = l.series_id
			JOIN roots r ON r.id = s.root_id WHERE l.edition IS NULL AND ${ELIGIBLE_NOVEL_SQL}
				AND NOT ${sourceFlagSql('neverTracked', 's.origin_key')}`
		)
		.all() as { work: string; lang: string }[];
	const out = { found: 0, suggested: 0, waiting: 0 };
	for (const { work, lang } of wanted) {
		const w = await api<Work>(`/works/${work}`);
		if (!w) continue;
		db.prepare(`UPDATE ranobe_links SET title = ? WHERE work = ?`).run(w.title, work);
		const e = chooseEdition(w.editions, lang);
		if (e) {
			setEdition(work, lang, e.ref);
			out.found += 1;
			continue;
		}
		const s = db
			.prepare(`SELECT * FROM ranobe_suggestions WHERE work = ? AND lang = ?`)
			.get(work, lang) as { bundle: number | null; status: string } | undefined;
		if (s?.status === 'rejected' || s?.status === 'withdrawn') continue;
		if (s?.status === 'pending' && s.bundle !== null) {
			const b = await api<BundleAnswer>(`/bundles/${s.bundle}`);
			const settled = settle(work, lang, b, now);
			if (settled) out.found += 1;
			else out.waiting += 1;
			continue;
		}
		try {
			const b = await suggestEdition(work, lang, now);
			out.suggested += 1;
			if (settle(work, lang, b, now)) out.found += 1;
		} catch (err) {
			if (err instanceof Unreachable) throw err;
			db.prepare(
				`INSERT INTO ranobe_suggestions (work, lang, status, sent_at, error) VALUES (?, ?, 'failed', ?, ?)
				ON CONFLICT (work, lang) DO UPDATE SET status = 'failed', sent_at = excluded.sent_at, error = excluded.error`
			).run(work, lang, now, why(err));
		}
	}
	return out;
}

/** What a bundle's answer settles: approved gives the edition, anything else is kept as it is. */
function settle(work: string, lang: string, b: BundleAnswer | null, now: number): boolean {
	if (!b) return false;
	const edition = b.items.find((i) => i.key === 'edition')?.ref ?? null;
	const status = ['approved', 'rejected', 'withdrawn'].includes(b.status) ? b.status : 'pending';
	getDb()
		.prepare(
			`INSERT INTO ranobe_suggestions (work, lang, bundle, status, edition, sent_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (work, lang) DO UPDATE SET bundle = excluded.bundle, status = excluded.status,
				edition = excluded.edition, checked_at = excluded.checked_at, error = NULL`
		)
		.run(work, lang, b.bundle, status, edition, now, now);
	if (status !== 'approved' || !edition) return false;
	setEdition(work, lang, edition);
	return true;
}

/**
 * Suggest the edition a work lacks, in one language, as a one-item bundle
 * (API-V1.md, "Bundles"). Its table of contents is volumes 1 to the highest
 * this library holds; a licensed ebook is the likeliest, and a person reviews
 * it on Ranobe either way.
 */
async function suggestEdition(work: string, lang: string, now: number): Promise<BundleAnswer> {
	const volumes = (
		getDb()
			.prepare(
				`SELECT l.volume FROM ranobe_links l JOIN series s ON s.id = l.series_id JOIN roots r ON r.id = s.root_id
				WHERE l.work = ? AND l.lang = ? AND l.volume IS NOT NULL AND ${ELIGIBLE_NOVEL_SQL}
					AND NOT ${sourceFlagSql('neverTracked', 's.origin_key')}`
			)
			.all(work, lang) as { volume: string }[]
	).map((r) => r.volume);
	const units = suggestedUnits(volumes).map((u) => ({
		...u,
		part: null,
		title: null,
		releasedOn: null,
		attributes: {}
	}));
	const answer = await api<BundleAnswer>('/bundles', {
		method: 'POST',
		// Through the app account when there is one, so it waits for a person.
		...(suggestConfigured() ? { as: 'suggest' as const } : {}),
		key: `tsundoku-edition-${work}-${lang}-${now}`,
		body: {
			reason: `From Tsundoku: the owner reads this work in ${lang}${
				volumes.length
					? `, volumes ${[...new Set(volumes)].sort((a, b) => Number(a) - Number(b)).join(', ')}`
					: ''
			}, and Ranobe has no ${lang} edition.`,
			items: [
				{
					key: 'edition',
					type: 'edition',
					snapshot: {
						workId: work,
						hidden: false,
						lang,
						title: null,
						latin: null,
						format: 'ebook',
						origin: 'licensed',
						age: null,
						publisherIds: [],
						releasedOn: null,
						coverImageId: null,
						attributes: {},
						credits: [],
						voices: [],
						links: [],
						parts: [],
						units
					}
				}
			]
		}
	});
	if (!answer) throw new Refused(0, 'no_answer');
	return answer;
}

// ---- units ----------------------------------------------------------------------------------

/**
 * What each comic's work counts, from `GET /works/{ref}?fields=units`, kept
 * for mapSeries. Asked every pass: Ranobe's counts grow as chapters come out,
 * and a work that counts nothing yet may count them by the next one.
 */
export async function readWorkUnits(
	now = Date.now(),
	/** Only these works: a link just made (afterLinking), not the whole library. */
	only?: string[]
): Promise<{ counted: number; not: number }> {
	const db = getDb();
	const works = (
		db
			.prepare(
				`SELECT DISTINCT l.work FROM ranobe_links l JOIN series s ON s.id = l.series_id
				JOIN roots r ON r.id = s.root_id WHERE ${ELIGIBLE_SQL} AND s.kind != 'novel'`
			)
			.all() as { work: string }[]
	)
		.map((r) => r.work)
		.filter((w) => !only || only.includes(w));
	const put = db.prepare(
		`INSERT INTO ranobe_work_units (work, type, count, extra, open_run, checked_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (work) DO UPDATE SET type = excluded.type, count = excluded.count,
			extra = excluded.extra, open_run = excluded.open_run, checked_at = excluded.checked_at`
	);
	const title = db.prepare(`UPDATE ranobe_links SET title = ? WHERE work = ?`);
	const out = { counted: 0, not: 0 };
	for (const work of works) {
		let units: WorkUnits | null = null;
		try {
			const w = await api<{ title?: string; units?: WorkUnits | null }>(
				`/works/${work}?fields=units`
			);
			units = w?.units ?? null;
			// A comic has no edition step to name its link, so the title comes from here.
			if (w?.title) title.run(w.title, work);
		} catch (e) {
			// A work gone or hidden since counts nothing; anything else is the pass's.
			if (!(e instanceof Refused && (e.status === 404 || e.status === 410))) throw e;
		}
		put.run(
			work,
			units?.type ?? null,
			units?.count ?? 0,
			JSON.stringify(units?.extra ?? []),
			units?.open ? 1 : 0,
			now
		);
		if (units) out.counted += 1;
		else out.not += 1;
	}
	return out;
}

/** What a work counts, as the last pass read it. Null: nothing, or never asked. */
export function workUnits(work: string): WorkUnits | null {
	const r = getDb()
		.prepare(`SELECT type, count, extra, open_run FROM ranobe_work_units WHERE work = ?`)
		.get(work) as
		{ type: string | null; count: number; extra: string; open_run: number } | undefined;
	if (!r?.type) return null;
	return {
		type: r.type,
		count: r.count,
		extra: JSON.parse(r.extra) as string[],
		open: r.open_run === 1
	};
}

/**
 * Each entry's unit, for every linked series whose edition is known, and
 * every linked comic (or `seriesId` alone). Every pass maps again, since an
 * import may have added chapters; the edition's table of contents is read
 * once a pass, and a comic's count is readWorkUnits'.
 */
export async function mapSeries(o: { seriesId?: number; now?: number } = {}): Promise<number> {
	const db = getDb();
	const now = o.now ?? Date.now();
	const links = db
		.prepare(
			`SELECT l.series_id, l.work, l.edition, l.volume, s.kind FROM ranobe_links l JOIN series s ON s.id = l.series_id
			JOIN roots r ON r.id = s.root_id
			WHERE (l.edition IS NOT NULL OR s.kind != 'novel') AND ${ELIGIBLE_SQL}
				${o.seriesId !== undefined ? 'AND l.series_id = ?' : ''}`
		)
		.all(...(o.seriesId !== undefined ? [o.seriesId] : [])) as {
		series_id: number;
		work: string;
		edition: string | null;
		volume: string | null;
		kind: Kind;
	}[];
	const tocs = new Map<string, Unit[]>();
	let mapped = 0;
	for (const l of links) {
		const comic = byWork(l.kind);
		if (!comic && l.edition && !tocs.has(l.edition)) {
			const e = await api<{ units?: Unit[] }>(`/editions/${l.edition}?fields=units`);
			tocs.set(l.edition, e?.units ?? []);
		}
		const entries = db
			.prepare(
				`SELECT id, label, matter, read_at AS readAt, COALESCE(episode_note, '') AS note
				FROM entries WHERE series_id = ? AND shadowed = 0`
			)
			.all(l.series_id) as {
			id: number;
			label: string;
			matter: string;
			readAt: number | null;
			note: string;
		}[];
		const rows = entries.map((e) => ({ ...e, recap: e.note === 'recap' }));
		const units = isAnime(l.kind)
			? mapAnimeUnits(l.work, workUnits(l.work), rows)
			: comic
				? mapWorkUnits(l.work, workUnits(l.work), rows)
				: mapUnits(tocs.get(l.edition!) ?? [], { volume: l.volume, entries: rows });
		db.transaction(() => {
			const set = db.prepare(`UPDATE entries SET ranobe_unit = ? WHERE id = ?`);
			for (const e of entries) set.run(units.get(e.id) ?? null, e.id);
			db.prepare(`UPDATE ranobe_links SET mapped_at = ? WHERE series_id = ?`).run(now, l.series_id);
		})();
		mapped += units.size;
	}
	return mapped;
}

/**
 * What each unit of a work is here: read once every entry mapped onto it is,
 * in any series of the work that Ranobe may hear of (two copies of a volume
 * count once). A unit only ever mapped from a series hidden since is left
 * alone: hiding a series takes nothing back. A series from a NEVER TRACKED
 * source never contributes a read here, even when another series maps
 * the same unit: the switch is about the source, not the work.
 */
export function refreshUnits(work?: string): void {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT l.work, e.series_id, e.ranobe_unit AS unit, e.read_at AS readAt
			FROM entries e JOIN ranobe_links l ON l.series_id = e.series_id
			JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE e.ranobe_unit IS NOT NULL AND e.shadowed = 0 AND ${ELIGIBLE_SQL}
				AND NOT ${sourceFlagSql('neverTracked', 's.origin_key')}
				${work !== undefined ? 'AND l.work = ?' : ''}`
		)
		.all(...(work !== undefined ? [work] : [])) as {
		work: string;
		series_id: number;
		unit: string;
		readAt: number | null;
	}[];
	const bySeries = new Map<number, typeof rows>();
	for (const r of rows) bySeries.set(r.series_id, [...(bySeries.get(r.series_id) ?? []), r]);
	const units = new Map<string, { work: string; readAt: number | null }>();
	for (const list of bySeries.values())
		for (const [unit, readAt] of unitsRead(list)) {
			const had = units.get(unit);
			const best =
				had?.readAt != null && readAt != null
					? Math.max(had.readAt, readAt)
					: (readAt ?? had?.readAt ?? null);
			units.set(unit, { work: list[0].work, readAt: best });
		}
	const put = db.prepare(
		`INSERT INTO ranobe_units (unit, work, read_at) VALUES (?, ?, ?)
		ON CONFLICT (unit) DO UPDATE SET read_at = excluded.read_at`
	);
	db.transaction(() => {
		for (const [unit, u] of units) put.run(unit, u.work, u.readAt);
	})();
}

// ---- sending --------------------------------------------------------------------------------

/**
 * Send what differs. Reads in batches of 500; a read Ranobe refuses by its
 * unit is kept with why and the rest go without it. A unit read here no
 * longer, that tsundoku once sent, is unread there. Then each work's rating
 * and favourite, with the entry's `rev`.
 */
export function flush(
	o: { backfill?: boolean; now?: number } = {}
): Promise<{ read: number; unread: number; works: number; failed: number }> {
	// One at a time: a chapter finished during the pass waits for it rather
	// than sending the same reads beside it.
	const run = flushing.then(() => flushNow(o));
	flushing = run.catch(() => undefined);
	return run;
}
let flushing: Promise<unknown> = Promise.resolve();

async function flushNow(o: { backfill?: boolean; now?: number }) {
	const db = getDb();
	const now = o.now ?? Date.now();
	const out = { read: 0, unread: 0, works: 0, failed: 0 };
	// Only units some series Ranobe may hear of still maps: a series hidden
	// since its read was queued sends nothing.
	// NEVER TRACKED is asked here too, where the queue is drained: a unit
	// queued before the switch went on waits, as a hidden series' does, and goes
	// only if the switch is turned off again (the same rule as shown again).
	const live = `EXISTS (SELECT 1 FROM entries e JOIN ranobe_links l ON l.series_id = e.series_id
		JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
		WHERE e.ranobe_unit = u.unit AND ${ELIGIBLE_SQL} AND NOT ${sourceFlagSql('neverTracked', 's.origin_key')})`;
	let reads = db
		.prepare(
			`SELECT unit, read_at FROM ranobe_units u WHERE read_at IS NOT NULL AND sent_at IS NULL AND ${live}`
		)
		.all() as { unit: string; read_at: number }[];
	const fail = db.prepare(`UPDATE ranobe_units SET failed_at = ?, error = ? WHERE unit = ?`);
	const sent = db.prepare(
		`UPDATE ranobe_units SET sent_at = ?, failed_at = NULL, error = NULL WHERE unit = ?`
	);
	while (reads.length) {
		const batch = reads.slice(0, 500);
		try {
			const answer = await api<{ entries?: EntryAnswer[] }>('/me/reads', {
				method: 'POST',
				body: {
					reads: batch.map((r) => ({ unit: r.unit, at: iso(r.read_at) })),
					backfill: !!o.backfill
				}
			});
			db.transaction(() => {
				for (const r of batch) sent.run(now, r.unit);
				for (const e of answer?.entries ?? [])
					saveRemote({ work: e.work, progress: e.progress ?? null }, now);
			})();
			out.read += batch.length;
			reads = reads.slice(500);
		} catch (e) {
			// All or nothing: the rows it names go aside, and the rest again.
			const bad = new Set(
				e instanceof Refused && e.code === 'invalid_field'
					? ((e.details.issues as { path: string }[] | undefined) ?? [])
							.map((i) => i.path.match(/^reads\.(\d+)\./)?.[1])
							.filter((n): n is string => n !== undefined)
							.map(Number)
					: []
			);
			const failed = bad.size ? batch.filter((_, i) => bad.has(i)) : batch;
			for (const r of failed) fail.run(now, why(e), r.unit);
			out.failed += failed.length;
			if (!bad.size) break;
			reads = reads.filter((r) => !failed.includes(r));
		}
	}
	const unreads = db
		.prepare(
			`SELECT unit FROM ranobe_units u WHERE read_at IS NULL AND sent_at IS NOT NULL AND ${live}`
		)
		.all() as { unit: string }[];
	for (const { unit } of unreads) {
		try {
			await api(`/me/reads/${encodeURIComponent(unit)}`, { method: 'DELETE' });
		} catch (e) {
			if (!(e instanceof Refused && e.status === 404)) {
				fail.run(now, why(e), unit);
				out.failed += 1;
				continue;
			}
		}
		db.prepare(
			`UPDATE ranobe_units SET sent_at = NULL, failed_at = NULL, error = NULL WHERE unit = ?`
		).run(unit);
		out.unread += 1;
	}
	// A work is wanted by the series that read it, so it goes only while one of
	// them may still be sent: NEVER TRACKED and a hidden series both hold
	// a rating or FAV back, and it goes if one is shown or switched off again.
	const works = db
		.prepare(
			`SELECT work, rating, favourite FROM ranobe_works w
			WHERE wanted_at IS NOT NULL AND (sent_at IS NULL OR sent_at < wanted_at)
				AND EXISTS (SELECT 1 FROM ranobe_links l JOIN series s ON s.id = l.series_id
					JOIN roots r ON r.id = s.root_id
					WHERE l.work = w.work AND ${ELIGIBLE_SQL} AND NOT ${sourceFlagSql('neverTracked', 's.origin_key')})`
		)
		.all() as { work: string; rating: number | null; favourite: number | null }[];
	for (const w of works) {
		try {
			await putEntry(w.work, {
				...(w.rating !== null ? { rating: ratingOut(w.rating) } : {}),
				...(w.favourite !== null ? { favourite: !!w.favourite } : {})
			});
			// Sent only if it still wants what went: a rating or FAV set while
			// the PUT was out cleared sent_at (wantWork) and goes next flush.
			db.prepare(
				`UPDATE ranobe_works SET sent_at = ?, failed_at = NULL, error = NULL
				WHERE work = ? AND rating IS ? AND favourite IS ?`
			).run(now, w.work, w.rating, w.favourite);
			out.works += 1;
		} catch (e) {
			db.prepare(`UPDATE ranobe_works SET failed_at = ?, error = ? WHERE work = ?`).run(
				now,
				why(e),
				w.work
			);
			out.failed += 1;
		}
	}
	return out;
}

/** `PUT /me/library/{work}` with the rev it has now; once more on a stale one. */
async function putEntry(work: string, fields: Record<string, unknown>): Promise<void> {
	let rev: number | undefined;
	try {
		rev = (await api<{ rev: number }>(`/me/library/${work}`))?.rev;
	} catch (e) {
		if (!(e instanceof Refused && e.status === 404)) throw e;
	}
	let answer: EntryAnswer | null;
	try {
		answer = await api<EntryAnswer>(`/me/library/${work}`, {
			method: 'PUT',
			body: { ...fields, rev }
		});
	} catch (e) {
		if (!(e instanceof Refused && e.code === 'stale_rev')) throw e;
		answer = await api<EntryAnswer>(`/me/library/${work}`, {
			method: 'PUT',
			body: { ...fields, rev: e.details.currentRev }
		});
	}
	if (answer) saveRemote({ ...answer, work }, Date.now());
}

/** The works these series read on Ranobe, for the ones it may hear of. */
function worksOf(seriesIds: number[]): string[] {
	if (!seriesIds.length) return [];
	return (
		getDb()
			.prepare(
				`SELECT DISTINCT l.work FROM ranobe_links l JOIN series s ON s.id = l.series_id
				JOIN roots r ON r.id = s.root_id
				WHERE l.series_id IN (${seriesIds.map(() => '?').join(',')}) AND ${ELIGIBLE_SQL}
					AND NOT ${sourceFlagSql('neverTracked', 's.origin_key')}`
			)
			.all(...seriesIds) as { work: string }[]
	).map((r) => r.work);
}

/**
 * A rating or FAV to send. It clears sent_at rather than trusting
 * `sent_at < wanted_at`: both are milliseconds, and a FAV set in the same one
 * as the last send of the work was never sent.
 */
function wantWork(
	works: string[],
	w: { rating?: number; favourite?: boolean },
	now = Date.now()
): void {
	const db = getDb();
	const put = db.prepare(
		`INSERT INTO ranobe_works (work, rating, favourite, wanted_at) VALUES (@work, @rating, @favourite, @now)
		ON CONFLICT (work) DO UPDATE SET
			rating = COALESCE(@rating, rating), favourite = COALESCE(@favourite, favourite),
			wanted_at = @now, sent_at = NULL, failed_at = NULL, error = NULL`
	);
	for (const work of works)
		put.run({
			work,
			rating: w.rating ?? null,
			favourite: w.favourite === undefined ? null : w.favourite ? 1 : 0,
			now
		});
}

const quietly = (what: string) => (e: unknown) => {
	if (!(e instanceof Unreachable)) console.error(`tsundoku: Ranobe ${what} failed:`, e);
};

/**
 * After a chapter is finished, marked read or marked unread: the series'
 * units again, and what differs, sent off the request.
 */
export function afterReading(seriesId: number): void {
	if (!configured() || !eligible(seriesId)) return;
	const [work] = worksOf([seriesId]);
	if (!work) return;
	// Linked but never mapped (a link made between passes): map it first, and
	// what's read goes with it (afterLinking).
	if (unmapped(seriesId)) return void afterLinking(seriesId);
	refreshUnits(work);
	void flush().catch(quietly('sending reads'));
}

/** Its link's chapters were never matched to units: nothing read can go until they are. */
export const unmapped = (seriesId: number) =>
	!!getDb()
		.prepare(`SELECT 1 FROM ranobe_links WHERE series_id = ? AND mapped_at IS NULL`)
		.get(seriesId);

/**
 * A link just made by hand (the review, a pasted link, an approved
 * suggestion): the series' own steps of the pass, at once, so what was read
 * before the link goes now, and what's read after it has units to go to. The
 * lookup's links are made inside the pass, which does this for them. Without
 * it, a series linked in the review after the last pass has no units, so
 * neither its earlier reads nor its later ones go.
 */
export function afterLinking(seriesId: number, now = Date.now()): Promise<void> {
	if (!configured() || !eligible(seriesId)) return Promise.resolve();
	const [work] = worksOf([seriesId]);
	if (!work) return Promise.resolve();
	const kind = (
		getDb().prepare(`SELECT kind FROM series WHERE id = ?`).get(seriesId) as { kind: Kind }
	).kind;
	return (async () => {
		if (byWork(kind)) await readWorkUnits(now, [work]);
		else await resolveEditions(now);
		await mapSeries({ seriesId, now });
		refreshUnits(work);
		await flush({ backfill: true, now });
	})().catch(quietly('sending a new link'));
}

/** A rating set here is the work's rating there (1 to 10, and 0 clears it). */
export function afterRating(seriesIds: number[], rating: number): void {
	if (!configured()) return;
	const works = worksOf(seriesIds);
	if (!works.length) return;
	wantWork(works, { rating });
	void flush().catch(quietly('sending a rating'));
}

/** FAV here is the favourite there. */
export function afterFavourite(seriesIds: number[], favourite: boolean): void {
	if (!configured()) return;
	const works = worksOf(seriesIds);
	if (!works.length) return;
	wantWork(works, { favourite });
	void flush().catch(quietly('sending a favourite'));
}

// ---- the pass -------------------------------------------------------------------------------

export type SyncSummary = {
	linked: number;
	/** Novels searched by title, for the review. */
	searched: number;
	/** Suggested novels: approved since the last pass (and linked), still waiting. */
	suggestions: { approved: number; waiting: number };
	editions: { found: number; suggested: number; waiting: number };
	/** Comics' works: counting their chapters on Ranobe, or not yet. */
	works: { counted: number; not: number };
	mapped: number;
	sent: { read: number; unread: number; works: number; failed: number };
	unreachable: boolean;
};

/**
 * The whole pass, after an import and from `yarn run ranobe`: link what the
 * ids answer, search the rest for the review, settle editions, map units,
 * read the library, and send what's read. What was
 * read before is sent marked as a backfill (API-V1.md step 7): entries'
 * `read_at`, never a replay of the reading log.
 */
export async function syncRanobe(now = Date.now()): Promise<SyncSummary | null> {
	if (!configured()) return null;
	const out: SyncSummary = {
		linked: 0,
		searched: 0,
		suggestions: { approved: 0, waiting: 0 },
		editions: { found: 0, suggested: 0, waiting: 0 },
		works: { counted: 0, not: 0 },
		mapped: 0,
		sent: { read: 0, unread: 0, works: 0, failed: 0 },
		unreachable: false
	};
	// Each step on its own: one Ranobe refuses doesn't keep the reads from
	// going. Out of reach, the rest would only fail the same way.
	const step = async (name: string, run: () => Promise<void> | void) => {
		if (out.unreachable) return;
		try {
			await run();
		} catch (e) {
			if (e instanceof Unreachable) out.unreachable = true;
			else console.error(`tsundoku: Ranobe ${name} failed:`, e);
		}
	};
	await step('lookup', async () => void (out.linked = await matchByLookup(now)));
	// Suggested novels first: one approved since links its series, and has its
	// siblings searched again in the next step, which now finds it.
	await step('suggestions', async () => {
		const { checkWorkSuggestions } = await import('./ranobe-suggest.ts');
		out.suggestions = await checkWorkSuggestions(now);
	});
	await step('search', async () => void (out.searched = await searchNovels(now)));
	await step('editions', async () => void (out.editions = await resolveEditions(now)));
	await step('work units', async () => void (out.works = await readWorkUnits(now)));
	await step('units', async () => void (out.mapped = await mapSeries({ now })));
	await step('reads', async () => {
		refreshUnits();
		out.sent = await flush({ backfill: true, now });
	});
	await step('library', async () => void (await readLibrary(now)));
	// SETTINGS' LAST PASS line: when it ran, whatever it managed.
	getDb()
		.prepare(
			`INSERT INTO settings (key, value) VALUES ('ranobe_pass_at', ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`
		)
		.run(String(now));
	return out;
}
