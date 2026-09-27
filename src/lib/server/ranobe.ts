import { basename } from 'node:path';
import { getDb } from './db.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { SignedOut, Unreachable } from './catalogue.ts';
import { coverOnly } from '../library/catalogue.ts';
import {
	DEFAULT_LANG,
	RANOBE_KINDS,
	chooseEdition,
	iso,
	mapUnits,
	ratingOut,
	suggestedUnits,
	unitsRead,
	volumeOf,
	type EditionSummary,
	type Unit
} from '../library/ranobe.ts';
import type { Kind } from '../library/types.ts';

/**
 * Ranobe (doc/RANOBE.md; card c66): the owner's own catalogue of novels, and
 * their library on it, kept moving from what's read here.
 *
 * - **Matching** asks `POST /lookup` with the AniList and MAL ids a novel's
 *   link already has. Choosing among search results is the /links review's,
 *   later.
 * - **Editions**: a series reads the work's edition in its own language. When
 *   Ranobe has none, the pass suggests one as a bundle, and the series waits
 *   until it is approved.
 * - **Units**: each entry keeps the unit it is, from the edition's table of
 *   contents, and a unit read here is sent as one read.
 * - **Never** for a hidden series or anything from Hentoid: not looked up,
 *   not suggested, not sent. Incognito reading records nothing, so nothing
 *   follows it here either.
 */

const BASE = () => (process.env.RANOBE_URL ?? 'https://ranobe.ink/api/v1').replace(/\/$/, '');
const token = () => process.env.RANOBE_TOKEN ?? '';

/** Whether Ranobe can be written to at all: a token in .env (doc/SECRETS.md). */
export const configured = () => token() !== '';

/** Ranobe answered, and said no. `code` is from its closed list (API-V1.md, "Errors"). */
export class Refused extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		readonly details: Record<string, unknown> = {}
	) {
		super(`Ranobe ${status} ${code}`);
	}
}

type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);

/** For specs: a stand-in for the network. */
export function setRanobeFetch(f: Fetch | null): void {
	fetcher = f ?? ((...a) => fetch(...a));
}

async function api<T>(
	path: string,
	init: { method?: string; body?: unknown; key?: string } = {}
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
					authorization: `Bearer ${token()}`,
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

const why = (e: unknown) =>
	e instanceof SignedOut
		? 'RANOBE REFUSED THE TOKEN'
		: e instanceof Unreachable
			? 'RANOBE DID NOT ANSWER'
			: 'RANOBE REFUSED IT';

/**
 * The series Ranobe may hear of: of a kind it tracks, not hidden, not from
 * Hentoid. The one place the rule is spelled, over `series s JOIN roots r`.
 */
const ELIGIBLE_SQL = `(s.kind IN (${RANOBE_KINDS.map((k) => `'${k}'`).join(', ')})
	AND ${VISIBLE_SQL} AND s.source != 'hentoid')`;

function eligible(seriesId: number): boolean {
	return !!getDb()
		.prepare(
			`SELECT 1 FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ? AND ${ELIGIBLE_SQL}`
		)
		.get(seriesId);
}

// ---- matching -------------------------------------------------------------------------------

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
			FROM series s JOIN roots r ON r.id = s.root_id JOIN series_links l ON l.series_id = s.id
			WHERE ${ELIGIBLE_SQL} AND s.id NOT IN (SELECT series_id FROM ranobe_links)
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
	const keysOf = (r: (typeof asked)[number]) => [
		...(r.anilist_id ? [`anilist:${r.anilist_id}`] : []),
		...(r.mal_id ? [`mal:${r.mal_id}`] : [])
	];
	const put = db.prepare(
		`INSERT INTO ranobe_links (series_id, work, lang, volume, via, linked_at) VALUES (?, ?, ?, ?, 'lookup', ?)
		ON CONFLICT (series_id) DO NOTHING`
	);
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
				const volume = volumeOf(r.title, r.file ? basename(r.file) : '');
				linked += put.run(r.id, work, r.lang ?? DEFAULT_LANG, volume, now).changes;
			}
		})();
	}
	return linked;
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
 * taken; with none, one is suggested (the owner chose this on 2026-09-27),
 * and a suggestion already made is asked after until it is decided.
 */
export async function resolveEditions(now = Date.now()): Promise<{
	found: number;
	suggested: number;
	waiting: number;
}> {
	const db = getDb();
	const wanted = db
		.prepare(
			`SELECT DISTINCT l.work, l.lang FROM ranobe_links l JOIN series s ON s.id = l.series_id
			JOIN roots r ON r.id = s.root_id WHERE l.edition IS NULL AND ${ELIGIBLE_SQL}`
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
 * this library holds; a licensed ebook is the likeliest, and the owner reviews
 * it on Ranobe either way.
 */
async function suggestEdition(work: string, lang: string, now: number): Promise<BundleAnswer> {
	const volumes = (
		getDb()
			.prepare(
				`SELECT l.volume FROM ranobe_links l JOIN series s ON s.id = l.series_id JOIN roots r ON r.id = s.root_id
				WHERE l.work = ? AND l.lang = ? AND l.volume IS NOT NULL AND ${ELIGIBLE_SQL}`
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
 * Each entry's unit, for every linked series whose edition is known (or
 * `seriesId` alone). Every pass maps again, since an import may have added
 * chapters; the edition's table of contents is read once a pass.
 */
export async function mapSeries(o: { seriesId?: number; now?: number } = {}): Promise<number> {
	const db = getDb();
	const now = o.now ?? Date.now();
	const links = db
		.prepare(
			`SELECT l.series_id, l.edition, l.volume FROM ranobe_links l JOIN series s ON s.id = l.series_id
			JOIN roots r ON r.id = s.root_id
			WHERE l.edition IS NOT NULL AND ${ELIGIBLE_SQL}
				${o.seriesId !== undefined ? 'AND l.series_id = ?' : ''}`
		)
		.all(...(o.seriesId !== undefined ? [o.seriesId] : [])) as {
		series_id: number;
		edition: string;
		volume: string | null;
	}[];
	const tocs = new Map<string, Unit[]>();
	let mapped = 0;
	for (const l of links) {
		if (!tocs.has(l.edition)) {
			const e = await api<{ units?: Unit[] }>(`/editions/${l.edition}?fields=units`);
			tocs.set(l.edition, e?.units ?? []);
		}
		const entries = db
			.prepare(
				`SELECT id, label, matter, read_at AS readAt FROM entries WHERE series_id = ? AND shadowed = 0`
			)
			.all(l.series_id) as { id: number; label: string; matter: string; readAt: number | null }[];
		const units = mapUnits(tocs.get(l.edition) ?? [], { volume: l.volume, entries });
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
 * alone: hiding a series takes nothing back.
 */
export function refreshUnits(work?: string): void {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT l.work, e.series_id, e.ranobe_unit AS unit, e.read_at AS readAt
			FROM entries e JOIN ranobe_links l ON l.series_id = e.series_id
			JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE e.ranobe_unit IS NOT NULL AND e.shadowed = 0 AND ${ELIGIBLE_SQL}
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
	const live = `EXISTS (SELECT 1 FROM entries e JOIN ranobe_links l ON l.series_id = e.series_id
		JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
		WHERE e.ranobe_unit = u.unit AND ${ELIGIBLE_SQL})`;
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
			await api('/me/reads', {
				method: 'POST',
				body: {
					reads: batch.map((r) => ({ unit: r.unit, at: iso(r.read_at) })),
					backfill: !!o.backfill
				}
			});
			db.transaction(() => {
				for (const r of batch) sent.run(now, r.unit);
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
	const works = db
		.prepare(
			`SELECT work, rating, favourite FROM ranobe_works
			WHERE wanted_at IS NOT NULL AND (sent_at IS NULL OR sent_at < wanted_at)`
		)
		.all() as { work: string; rating: number | null; favourite: number | null }[];
	for (const w of works) {
		try {
			await putEntry(w.work, {
				...(w.rating !== null ? { rating: ratingOut(w.rating) } : {}),
				...(w.favourite !== null ? { favourite: !!w.favourite } : {})
			});
			db.prepare(
				`UPDATE ranobe_works SET sent_at = ?, failed_at = NULL, error = NULL WHERE work = ?`
			).run(now, w.work);
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
	try {
		await api(`/me/library/${work}`, { method: 'PUT', body: { ...fields, rev } });
	} catch (e) {
		if (!(e instanceof Refused && e.code === 'stale_rev')) throw e;
		await api(`/me/library/${work}`, {
			method: 'PUT',
			body: { ...fields, rev: e.details.currentRev }
		});
	}
}

/** The works these series read on Ranobe, for the ones it may hear of. */
function worksOf(seriesIds: number[]): string[] {
	if (!seriesIds.length) return [];
	return (
		getDb()
			.prepare(
				`SELECT DISTINCT l.work FROM ranobe_links l JOIN series s ON s.id = l.series_id
				JOIN roots r ON r.id = s.root_id
				WHERE l.series_id IN (${seriesIds.map(() => '?').join(',')}) AND ${ELIGIBLE_SQL}`
			)
			.all(...seriesIds) as { work: string }[]
	).map((r) => r.work);
}

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
			wanted_at = @now, failed_at = NULL, error = NULL`
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
	refreshUnits(work);
	void flush().catch(quietly('sending reads'));
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
	editions: { found: number; suggested: number; waiting: number };
	mapped: number;
	sent: { read: number; unread: number; works: number; failed: number };
	unreachable: boolean;
};

/**
 * The whole pass, after an import and from `yarn run ranobe`: link what the
 * ids answer, settle editions, map units, and send what's read. What was
 * read before is sent marked as a backfill (API-V1.md step 7): entries'
 * `read_at`, never a replay of the reading log.
 */
export async function syncRanobe(now = Date.now()): Promise<SyncSummary | null> {
	if (!configured()) return null;
	const out: SyncSummary = {
		linked: 0,
		editions: { found: 0, suggested: 0, waiting: 0 },
		mapped: 0,
		sent: { read: 0, unread: 0, works: 0, failed: 0 },
		unreachable: false
	};
	try {
		out.linked = await matchByLookup(now);
		out.editions = await resolveEditions(now);
		out.mapped = await mapSeries({ now });
		refreshUnits();
		out.sent = await flush({ backfill: true, now });
	} catch (e) {
		if (!(e instanceof Unreachable)) throw e;
		out.unreachable = true;
	}
	return out;
}
