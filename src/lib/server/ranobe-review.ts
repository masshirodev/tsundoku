import { basename } from 'node:path';
import { getDb } from './db.ts';
import { HIDDEN_SQL } from './visibility.ts';
import {
	ELIGIBLE_NOVEL_SQL,
	ELIGIBLE_SQL,
	configured,
	afterLinking,
	linkWork,
	readWork,
	searchOne,
	suggestConfigured,
	unlinkSeries,
	workUnits
} from './ranobe.ts';
import { cleanTitle, coverOnly, isCutShort, normaliseTitle } from '../library/catalogue.ts';
import {
	RANOBE_KINDS,
	byWork,
	coverNote,
	halfRead,
	langName,
	ranobeIds,
	ranobeRows,
	ranobeUrl,
	ranobeWhy,
	volumeOf,
	type RanobeCandidate,
	type RanobeFacts,
	type RanobeRow
} from '../library/ranobe.ts';
import type { Kind } from '../library/types.ts';

/**
 * Choosing a Ranobe work (Ranobe Review; doc/RANOBE.md, "The review"), and
 * what the series screen and SETTINGS show of Ranobe. The review is the link
 * review's, with Ranobe's candidates: a work is chosen, never an edition,
 * and several series may choose one (1b).
 */

export type RanobeReviewCandidate = {
	key: string;
	work: string;
	title: string;
	alts: string[];
	why: string;
	rows: RanobeRow[];
	ids: string;
	coverUrl: string | null;
	coverNote: string | null;
	href: string;
	prior: boolean;
};

export type RanobeReviewItem = {
	service: 'ranobe';
	seriesId: number;
	title: string;
	alts: string[];
	kind: Kind;
	hue: number;
	sourceKind: string;
	chapters: number;
	hasCover: boolean;
	coverAt: number | null;
	query: string;
	found: number;
	searched: boolean;
	/** A SEARCH AGAIN waiting for the next pass (Ranobe was out of reach). */
	queued: boolean;
	cutShort: boolean;
	/** THIS SERIES' rows (1a): SOURCE, ENTRIES, LANGUAGE, ANILIST. */
	rows: { label: string; value: string }[];
	/** The line under them: why Ranobe was searched, and what it found. */
	searchedLine: string;
	candidates: RanobeReviewCandidate[];
};

type Row = {
	id: number;
	title: string;
	alt_titles: string;
	kind: Kind;
	hue: number;
	source: string;
	cover_key: string;
	cover_at: number | null;
	chapters: number;
	lang: string | null;
	query: string | null;
	found: number | null;
	searched_at: number | null;
	anilist_id: number | null;
	mal_id: number | null;
	format: string | null;
	in_anilist_review: number;
};

const ROW_SQL = `SELECT s.id, s.title, s.alt_titles, s.kind, s.hue, s.source, s.cover_key, s.cover_at,
		(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0) AS chapters,
		(SELECT e.language FROM entries e WHERE e.series_id = s.id AND e.language IS NOT NULL LIMIT 1) AS lang,
		rs.query, rs.found, rs.searched_at, l.anilist_id, l.mal_id, l.format,
		(l.series_id IS NULL AND EXISTS (SELECT 1 FROM link_searches ls WHERE ls.series_id = s.id AND ls.searched_at IS NOT NULL)
			AND NOT EXISTS (SELECT 1 FROM link_decisions d WHERE d.series_id = s.id)) AS in_anilist_review
	FROM series s JOIN roots r ON r.id = s.root_id
	LEFT JOIN ranobe_searches rs ON rs.series_id = s.id
	LEFT JOIN series_links l ON l.series_id = s.id`;

/**
 * Waiting on Ranobe: an eligible novel, not linked there, not settled, not
 * suggested and waiting. Comics link by their ids alone, so none waits here.
 */
const WAITING_SQL = `${ELIGIBLE_NOVEL_SQL}
	AND s.id NOT IN (SELECT series_id FROM ranobe_links)
	AND s.id NOT IN (SELECT series_id FROM ranobe_decisions)
	AND s.id NOT IN (SELECT series_id FROM ranobe_work_suggestions WHERE status = 'pending')`;

const titlesOf = (r: Pick<Row, 'title' | 'alt_titles'>) => [
	r.title,
	...(JSON.parse(r.alt_titles || '[]') as string[]).filter((t) => t && t !== r.title)
];

function anilistRow(r: Row): string {
	if (r.anilist_id && coverOnly(r.kind, r.format ?? ''))
		return `COVER ONLY · ${r.anilist_id}, THE COMIC’S`;
	if (r.anilist_id) return `ANILIST ${r.anilist_id}`;
	if (r.mal_id) return `MAL ${r.mal_id}`;
	return r.in_anilist_review ? 'NOT LINKED · ITS OWN REVIEW' : 'NOT LINKED';
}

function searchedLine(r: Row): string {
	const found = r.found ?? 0;
	if (r.searched_at === null)
		return r.query
			? `A SEARCH FOR “${r.query}” WAITS FOR THE NEXT PASS`
			: 'NOT SEARCHED YET · SEARCH AGAIN ASKS RANOBE NOW';
	const why =
		r.anilist_id && coverOnly(r.kind, r.format ?? '')
			? 'ITS ANILIST LINK IS THE COMIC’S, SO IT WASN’T ASKED'
			: r.anilist_id || r.mal_id
				? 'RANOBE KNEW NONE OF ITS IDS'
				: 'NO ANILIST OR MAL ID TO SAY WHICH';
	return found
		? `${why} · SEARCHED RANOBE, NOVELS ONLY · ${found} FOUND`
		: `SEARCHED RANOBE FOR “${r.query}”, NOVELS ONLY · 0 FOUND`;
}

function candidatesOf(seriesId: number): RanobeCandidate[] {
	return (
		getDb()
			.prepare(`SELECT data FROM ranobe_candidates WHERE series_id = ? ORDER BY rank`)
			.all(seriesId) as { data: string }[]
	).map((x) => JSON.parse(x.data) as RanobeCandidate);
}

/** A candidate as the review draws it for this series. */
export function asReviewCandidate(
	series: { title: string },
	c: RanobeCandidate
): RanobeReviewCandidate {
	return {
		key: c.work,
		work: c.work,
		title: c.title,
		alts: c.matched && normaliseTitle(c.matched) !== normaliseTitle(c.title) ? [c.matched] : [],
		why: ranobeWhy(
			{ title: series.title, base: cleanTitle(series.title) || series.title },
			c,
			normaliseTitle
		),
		rows: ranobeRows(c),
		ids: ranobeIds(c),
		// A sensitive cover is never drawn (1a): its note stands in.
		coverUrl: c.cover && !c.cover.sensitive ? c.cover.url : null,
		coverNote: coverNote(c),
		href: ranobeUrl(c.work),
		prior: !!c.prior
	};
}

function itemOf(r: Row): RanobeReviewItem {
	const titles = titlesOf(r);
	return {
		service: 'ranobe',
		seriesId: r.id,
		title: r.title,
		alts: titles.slice(1),
		kind: r.kind,
		hue: r.hue,
		sourceKind: r.source.toUpperCase(),
		chapters: r.chapters,
		hasCover: r.cover_key !== '',
		coverAt: r.cover_at,
		query: r.query || cleanTitle(r.title) || r.title,
		found: r.found ?? 0,
		searched: r.searched_at !== null,
		queued: r.searched_at === null && r.query !== null,
		cutShort: isCutShort(r.title),
		rows: [
			{ label: 'SOURCE', value: r.source.toUpperCase() },
			{ label: 'ENTRIES', value: r.chapters.toLocaleString('en') },
			{ label: 'LANGUAGE', value: langName(r.lang ?? 'en') },
			{ label: 'ANILIST', value: anilistRow(r) }
		],
		searchedLine: searchedLine(r),
		candidates: candidatesOf(r.id).map((c) => asReviewCandidate(r, c))
	};
}

/**
 * The series waiting on a Ranobe choice: searched, not linked, not settled.
 * A skipped one goes to the back, then those with nothing found. Hidden
 * series and Hentoid are never eligible, so never here, reveal or not.
 */
export function ranobeQueue(): RanobeReviewItem[] {
	if (!configured()) return [];
	return (
		getDb()
			.prepare(
				`${ROW_SQL} WHERE rs.searched_at IS NOT NULL AND ${WAITING_SQL}
				ORDER BY rs.skipped_at IS NOT NULL, rs.skipped_at, rs.found = 0, s.id`
			)
			.all() as Row[]
	).map(itemOf);
}

export function ranobeQueueCount(): number {
	if (!configured()) return 0;
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id
				JOIN ranobe_searches rs ON rs.series_id = s.id
				WHERE rs.searched_at IS NOT NULL AND ${WAITING_SQL}`
			)
			.get() as { n: number }
	).n;
}

/** One series as the review shows it: FIND or CHANGE on its screen. Hidden ones too, for PASTE. */
export function ranobeItem(seriesId: number): RanobeReviewItem | null {
	const r = getDb()
		.prepare(
			`${ROW_SQL} WHERE s.id = ? AND s.kind IN (${RANOBE_KINDS.map((k) => `'${k}'`).join(', ')}) AND s.source != 'hentoid'`
		)
		.get(seriesId) as Row | undefined;
	return r ? itemOf(r) : null;
}

/** Whether a series is one Ranobe may hear of (a search, a candidate): not hidden, not Hentoid. */
export function searchableOnRanobe(seriesId: number): boolean {
	return !!getDb()
		.prepare(
			`SELECT 1 FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ? AND ${ELIGIBLE_SQL}`
		)
		.get(seriesId);
}

// ---- deciding -------------------------------------------------------------------------------

export type Sibling = { seriesId: number; title: string; meta: string };

/** A series' volume, as the sibling rows say it: "VOL. 8", or nothing. */
function volumeOfSeries(seriesId: number): string | null {
	const v = getDb().prepare(`SELECT volume FROM ranobe_links WHERE series_id = ?`).get(seriesId) as
		{ volume: string | null } | undefined;
	return v?.volume ?? null;
}

/**
 * The other series waiting on Ranobe with this series' title before a
 * volume number (1b): The Beginning After the End's seven EPUBs. Nothing is
 * decided for them here; the review lists them, nothing preselected.
 */
export function siblingsOf(seriesId: number): Sibling[] {
	const db = getDb();
	const me = db.prepare(`SELECT title FROM series WHERE id = ?`).get(seriesId) as
		{ title: string } | undefined;
	if (!me) return [];
	const key = normaliseTitle(cleanTitle(me.title) || me.title);
	if (!key) return [];
	const rows = db
		.prepare(
			`SELECT s.id, s.title, s.source,
				(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0 AND e.matter = '') AS n,
				(SELECT e.file FROM entries e WHERE e.series_id = s.id AND e.file != '' LIMIT 1) AS file
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.id != ? AND ${WAITING_SQL} ORDER BY s.title, s.id`
		)
		.all(seriesId) as {
		id: number;
		title: string;
		source: string;
		n: number;
		file: string | null;
	}[];
	const mine = rows.filter((r) => normaliseTitle(cleanTitle(r.title) || r.title) === key);
	const seen = new Map<string, number>();
	const myVol = volumeOfSeries(seriesId);
	if (myVol) seen.set(myVol, 1);
	return mine.map((r) => {
		const vol = volumeFromTitle(r.title, r.file);
		const copies = vol ? (seen.get(vol) ?? 0) : 0;
		if (vol) seen.set(vol, copies + 1);
		return {
			seriesId: r.id,
			title: r.title,
			meta: [
				r.source.toUpperCase(),
				`${r.n} CHAPTERS`,
				vol ? `VOL. ${vol}` : '',
				copies ? 'A SECOND COPY' : ''
			]
				.filter(Boolean)
				.join(' · ')
		};
	});
}

const volumeFromTitle = (title: string, file: string | null) =>
	volumeOf(title, file ? basename(file) : '');

/**
 * LINK in the review: the series to the work. Each sibling still waiting
 * gets the work as its first candidate, marked as chosen for this one (1c),
 * so any left out of LINK N MORE leads with it.
 */
export async function linkFromReview(
	seriesId: number,
	work: string,
	via: 'review' | 'pasted',
	now = Date.now()
): Promise<{ title: string; siblings: Sibling[] }> {
	const db = getDb();
	const offered = db
		.prepare(`SELECT data FROM ranobe_candidates WHERE series_id = ? AND work = ?`)
		.get(seriesId, work) as { data: string } | undefined;
	const c =
		via === 'pasted'
			? await readWork(work)
			: offered
				? (JSON.parse(offered.data) as RanobeCandidate)
				: null;
	if (!c) throw new NotACandidate();
	linkWork(seriesId, work, via, now, { title: c.title });
	// Its units, and its reads so far, at once rather than at the next pass.
	void afterLinking(seriesId, now);
	const siblings = siblingsOf(seriesId);
	const vol = volumeOfSeries(seriesId);
	const prior: RanobeCandidate = { ...c, prior: vol ? `VOL. ${vol}` : 'ITS TWIN' };
	// A sibling that found the work itself keeps that find underneath, for UNDO.
	const had = db.prepare(
		`SELECT rank, data FROM ranobe_candidates WHERE series_id = ? AND work = ?`
	);
	const put = db.prepare(
		`INSERT INTO ranobe_candidates (series_id, work, rank, data) VALUES (?, ?, -1, ?)
		ON CONFLICT (series_id, work) DO UPDATE SET rank = -1, data = excluded.data`
	);
	db.transaction(() => {
		for (const s of siblings) {
			const h = had.get(s.seriesId, work) as { rank: number; data: string } | undefined;
			const was = h && h.rank >= 0 ? { rank: h.rank, data: h.data } : null;
			put.run(s.seriesId, work, JSON.stringify({ ...prior, was }));
		}
	})();
	return { title: c.title, siblings };
}

export class NotACandidate extends Error {}

/** LINK N MORE (1b): each named sibling to the same work. Only series still waiting are linked. */
export function linkMany(seriesIds: number[], work: string, now = Date.now()): number[] {
	const db = getDb();
	const title =
		(
			db
				.prepare(`SELECT title FROM ranobe_links WHERE work = ? AND title != '' LIMIT 1`)
				.get(work) as { title: string } | undefined
		)?.title ?? '';
	const waiting = new Set(
		(
			db
				.prepare(
					`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
					WHERE s.id IN (${seriesIds.map(() => '?').join(',') || 'NULL'}) AND ${WAITING_SQL}`
				)
				.all(...seriesIds) as { id: number }[]
		).map((r) => r.id)
	);
	const done: number[] = [];
	for (const id of seriesIds)
		if (waiting.has(id) && linkWork(id, work, 'review', now, { title })) {
			done.push(id);
			void afterLinking(id, now);
		}
	return done;
}

/**
 * UNDO a LINK: the link goes, with no decision, and the siblings lose the
 * work as a candidate it gave them. Returns false when it wasn't a review's.
 */
export function undoLink(seriesId: number): boolean {
	const db = getDb();
	const l = db.prepare(`SELECT work, via FROM ranobe_links WHERE series_id = ?`).get(seriesId) as
		{ work: string; via: string } | undefined;
	if (!l || (l.via !== 'review' && l.via !== 'pasted')) return false;
	unlinkSeries(seriesId, Date.now(), false);
	const sibs = siblingsOf(seriesId);
	const get = db.prepare(
		`SELECT data FROM ranobe_candidates WHERE series_id = ? AND work = ? AND rank = -1`
	);
	const drop = db.prepare(
		`DELETE FROM ranobe_candidates WHERE series_id = ? AND work = ? AND rank = -1`
	);
	const restore = db.prepare(
		`UPDATE ranobe_candidates SET rank = ?, data = ? WHERE series_id = ? AND work = ?`
	);
	db.transaction(() => {
		for (const s of sibs) {
			const row = get.get(s.seriesId, l.work) as { data: string } | undefined;
			if (!row) continue;
			const was = (JSON.parse(row.data) as { was?: { rank: number; data: string } | null }).was;
			if (was) restore.run(was.rank, was.data, s.seriesId, l.work);
			else drop.run(s.seriesId, l.work);
		}
	})();
	return true;
}

/** UNDO of LINK N MORE: each linked series back to waiting. */
export function undoMany(seriesIds: number[]): void {
	for (const id of seriesIds) unlinkSeries(id, Date.now(), false);
}

/** NOT ON RANOBE / NONE OF THESE: not asked again. Its reads stay here. */
export function notOnRanobe(seriesId: number, now = Date.now()): void {
	getDb()
		.prepare(
			`INSERT INTO ranobe_decisions (series_id, decision, at) VALUES (?, 'none', ?)
			ON CONFLICT (series_id) DO UPDATE SET decision = 'none', at = excluded.at`
		)
		.run(seriesId, now);
}

export function undoNone(seriesId: number): boolean {
	return (
		getDb()
			.prepare(`DELETE FROM ranobe_decisions WHERE series_id = ? AND decision = 'none'`)
			.run(seriesId).changes > 0
	);
}

/** SKIP: to the back of the queue. */
export function skip(seriesId: number, now = Date.now()): void {
	getDb()
		.prepare(`UPDATE ranobe_searches SET skipped_at = ? WHERE series_id = ?`)
		.run(now, seriesId);
}

type Before = {
	search: {
		query: string;
		searched_at: number | null;
		found: number;
		skipped_at: number | null;
	} | null;
	candidates: { work: string; rank: number; data: string }[];
};
const before = new Map<number, Before>();

/**
 * SEARCH AGAIN, now, with this title only. Ranobe out of reach, the search
 * waits for the next pass instead. Its UNDO puts the old candidates back.
 */
export async function searchAgain(
	seriesId: number,
	query: string,
	now = Date.now()
): Promise<{ outcome: 'found'; found: number } | { outcome: 'queued' }> {
	const db = getDb();
	before.set(seriesId, {
		search:
			(db
				.prepare(
					`SELECT query, searched_at, found, skipped_at FROM ranobe_searches WHERE series_id = ?`
				)
				.get(seriesId) as Before['search'] | undefined) ?? null,
		candidates: db
			.prepare(`SELECT work, rank, data FROM ranobe_candidates WHERE series_id = ?`)
			.all(seriesId) as Before['candidates']
	});
	try {
		return { outcome: 'found', found: await searchOne(seriesId, query, now) };
	} catch (e) {
		const { Unreachable } = await import('./catalogue.ts');
		if (!(e instanceof Unreachable)) throw e;
		db.prepare(
			`INSERT INTO ranobe_searches (series_id, query, searched_at, found) VALUES (?, ?, NULL, 0)
			ON CONFLICT (series_id) DO UPDATE SET query = excluded.query, searched_at = NULL`
		).run(seriesId, query.trim());
		return { outcome: 'queued' };
	}
}

export function undoSearch(seriesId: number): void {
	const db = getDb();
	const b = before.get(seriesId);
	if (!b) return;
	db.transaction(() => {
		db.prepare(`DELETE FROM ranobe_candidates WHERE series_id = ?`).run(seriesId);
		db.prepare(`DELETE FROM ranobe_searches WHERE series_id = ?`).run(seriesId);
		if (b.search)
			db.prepare(
				`INSERT INTO ranobe_searches (series_id, query, searched_at, found, skipped_at) VALUES (?, ?, ?, ?, ?)`
			).run(seriesId, b.search.query, b.search.searched_at, b.search.found, b.search.skipped_at);
		const put = db.prepare(
			`INSERT INTO ranobe_candidates (series_id, work, rank, data) VALUES (?, ?, ?, ?)`
		);
		for (const c of b.candidates) put.run(seriesId, c.work, c.rank, c.data);
	})();
	before.delete(seriesId);
}

// ---- the series screen ----------------------------------------------------------------------

export type RanobeSeries = {
	configured: boolean;
	hidden: boolean;
	link: {
		work: string;
		title: string;
		href: string;
		/** "ENGLISH EDITION", "BY CHAPTER", "2 SERIES SHARE IT", the AniList id. */
		meta: string;
	} | null;
	/** Not linked: the LINK row's meta line (2h, 2j). */
	unlinkedMeta: string;
	facts: RanobeFacts;
};

/** The LINK and TRACKING rows for a novel (Ranobe Series 2a–2k). Null: not a kind Ranobe tracks. */
export function ranobeSeries(seriesId: number): RanobeSeries | null {
	const db = getDb();
	const s = db
		.prepare(
			`SELECT s.kind, s.source, ${HIDDEN_SQL} AS hidden, sl.anilist_id, sl.format,
				l.work, l.edition, l.lang, l.title
			FROM series s JOIN roots r ON r.id = s.root_id
			LEFT JOIN ranobe_links l ON l.series_id = s.id
			LEFT JOIN series_links sl ON sl.series_id = s.id
			WHERE s.id = ?`
		)
		.get(seriesId) as
		| {
				kind: Kind;
				source: string;
				hidden: number;
				anilist_id: number | null;
				format: string | null;
				work: string | null;
				edition: string | null;
				lang: string | null;
				title: string | null;
		  }
		| undefined;
	if (!s || !RANOBE_KINDS.includes(s.kind) || s.source === 'hentoid') return null;
	const lang = s.lang ?? 'en';
	const w = s.work
		? (db.prepare(`SELECT * FROM ranobe_works WHERE work = ?`).get(s.work) as
				| {
						status: string | null;
						progress_type: string | null;
						progress_number: string | null;
						progress_of: number | null;
						remote_rating: number | null;
						remote_favourite: number | null;
						state_at: number | null;
				  }
				| undefined)
		: undefined;
	const entries = db
		.prepare(
			`SELECT ranobe_unit AS unit, read_at AS readAt FROM entries
			WHERE series_id = ? AND shadowed = 0 AND ranobe_unit IS NOT NULL ORDER BY position`
		)
		.all(seriesId) as { unit: string; readAt: number | null }[];
	const units = [...new Set(entries.map((e) => e.unit))];
	const marks = units.map(() => '?').join(',');
	const failed = units.length
		? (db
				.prepare(
					`SELECT unit, error, failed_at AS at FROM ranobe_units
					WHERE unit IN (${marks}) AND failed_at IS NOT NULL ORDER BY failed_at DESC LIMIT 1`
				)
				.get(...units) as { unit: string; error: string; at: number } | undefined)
		: undefined;
	const sentAt = units.length
		? ((
				db
					.prepare(`SELECT MAX(sent_at) AS at FROM ranobe_units WHERE unit IN (${marks})`)
					.get(...units) as { at: number | null }
			).at ?? null)
		: null;
	const shares = s.work
		? (
				db.prepare(`SELECT COUNT(*) AS n FROM ranobe_links WHERE work = ?`).get(s.work) as {
					n: number;
				}
			).n
		: 0;
	const byChapter = units.some((u) => u.split(':')[1] === 'chapter');
	const comic = byWork(s.kind);
	const counted = comic && s.work ? workUnits(s.work) : null;
	const refused = s.work
		? !!db
				.prepare(
					`SELECT 1 FROM ranobe_suggestions WHERE work = ? AND lang = ? AND status IN ('rejected', 'withdrawn')`
				)
				.get(s.work, lang)
		: false;
	const anilist = s.anilist_id ? `ANILIST ${s.anilist_id}` : '';
	const search = db
		.prepare(`SELECT searched_at, found FROM ranobe_searches WHERE series_id = ?`)
		.get(seriesId) as { searched_at: number | null; found: number } | undefined;
	const decision = (
		db.prepare(`SELECT decision FROM ranobe_decisions WHERE series_id = ?`).get(seriesId) as
			{ decision: string } | undefined
	)?.decision;
	const suggested = db
		.prepare(
			`SELECT bundle FROM ranobe_work_suggestions WHERE series_id = ? AND status = 'pending'`
		)
		.get(seriesId) as { bundle: number } | undefined;
	const unlinkedMeta = s.hidden
		? 'HIDDEN SERIES ARE NEVER LOOKED UP ON RANOBE'
		: suggested
			? `SUGGESTED TO RANOBE · BUNDLE ${suggested.bundle} · WAITS FOR YOUR REVIEW THERE`
			: decision === 'none'
				? 'NOT ON RANOBE · SETTLED IN THE REVIEW · NOTHING SENT'
				: decision === 'unlinked'
					? 'UNLINKED · A PASS WON’T LINK IT AGAIN'
					: search?.searched_at && search.found
						? `${search.found} CANDIDATE${search.found === 1 ? '' : 'S'} FROM THE LAST PASS · NONE CHOSEN`
						: [
								anilist ? `${anilist} · COVER AND DETAILS` : '',
								search?.searched_at
									? 'RANOBE FOUND NOTHING BY ITS IDS OR ITS TITLE'
									: 'NOT SEARCHED ON RANOBE YET'
							]
								.filter(Boolean)
								.join(' · ');
	return {
		unlinkedMeta,
		configured: configured(),
		hidden: !!s.hidden,
		link: s.work
			? {
					work: s.work,
					title: s.title || s.work.toUpperCase(),
					href: ranobeUrl(s.work),
					meta: [
						`RANOBE ${s.work.toUpperCase()}`,
						comic
							? counted
								? `${counted.count.toLocaleString('en')} CHAPTERS ON RANOBE`
								: 'NO CHAPTER COUNT ON RANOBE YET'
							: s.edition
								? `${langName(lang)} EDITION`
								: `NO ${langName(lang)} EDITION YET`,
						byChapter && !comic ? 'BY CHAPTER' : '',
						shares > 1 ? `${shares} SERIES SHARE IT` : '',
						anilist
					]
						.filter(Boolean)
						.join(' · ')
				}
			: null,
		facts: {
			configured: configured(),
			hidden: !!s.hidden,
			linked: !!s.work,
			suggested: !!suggested,
			edition: !!s.edition,
			comic,
			counted: !!counted,
			suggestionRefused: refused,
			lang,
			remote:
				w && w.state_at !== null
					? {
							status: w.status,
							progress:
								w.progress_type && w.progress_number
									? { type: w.progress_type, number: w.progress_number, of: w.progress_of }
									: null,
							rating: w.remote_rating,
							favourite: !!w.remote_favourite
						}
					: null,
			sentAt,
			failed: failed ?? null,
			half: halfRead(entries)
		}
	};
}

/** TRY AGAIN, on a series or on SETTINGS: what failed goes again, now. */
export async function retryRanobe(seriesId?: number): Promise<void> {
	const db = getDb();
	const { flush, unmapped } = await import('./ranobe.ts');
	// A link never mapped has nothing to send until it is: map it, which sends too.
	if (seriesId !== undefined && unmapped(seriesId)) return afterLinking(seriesId);
	if (seriesId === undefined) {
		db.prepare(`UPDATE ranobe_units SET failed_at = NULL WHERE failed_at IS NOT NULL`).run();
		db.prepare(`UPDATE ranobe_works SET failed_at = NULL WHERE failed_at IS NOT NULL`).run();
	} else
		db.prepare(
			`UPDATE ranobe_units SET failed_at = NULL
			WHERE unit IN (SELECT ranobe_unit FROM entries WHERE series_id = ? AND ranobe_unit IS NOT NULL)`
		).run(seriesId);
	await flush();
}

// ---- SETTINGS -------------------------------------------------------------------------------

export type RanobeAccount = {
	configured: boolean;
	/** The app account's token is there: novels can be suggested, and wait for the owner. */
	suggests: boolean;
	/** Suggestions waiting for the owner on Ranobe. */
	suggested: number;
	failed: { count: number; at: number | null; error: string | null };
	lastSent: number | null;
	passAt: number | null;
	linked: number;
	toChoose: number;
	notOn: number;
};

/** SETTINGS' RANOBE row (3a–3c). The counts are the database's, never the mock's. */
export function ranobeAccount(): RanobeAccount {
	const db = getDb();
	const f = db
		.prepare(
			`SELECT COUNT(*) AS n, MAX(failed_at) AS at,
				(SELECT error FROM ranobe_units WHERE failed_at IS NOT NULL ORDER BY failed_at DESC LIMIT 1) AS error
			FROM ranobe_units WHERE failed_at IS NOT NULL`
		)
		.get() as { n: number; at: number | null; error: string | null };
	const pass = db.prepare(`SELECT value FROM settings WHERE key = 'ranobe_pass_at'`).get() as
		{ value: string } | undefined;
	const count = (sql: string) =>
		(
			db
				.prepare(`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id WHERE ${sql}`)
				.get() as { n: number }
		).n;
	return {
		configured: configured(),
		suggests: suggestConfigured(),
		suggested: (
			db
				.prepare(`SELECT COUNT(*) AS n FROM ranobe_work_suggestions WHERE status = 'pending'`)
				.get() as { n: number }
		).n,
		failed: { count: f.n, at: f.at, error: f.error },
		lastSent: (
			db.prepare(`SELECT MAX(sent_at) AS at FROM ranobe_units`).get() as { at: number | null }
		).at,
		passAt: pass ? Number(pass.value) : null,
		linked: count(`${ELIGIBLE_SQL} AND s.id IN (SELECT series_id FROM ranobe_links)`),
		// Disjoint from notOn (3c): a choice waits only where Ranobe found something.
		toChoose: count(
			`${WAITING_SQL} AND s.id IN (SELECT series_id FROM ranobe_searches WHERE searched_at IS NOT NULL AND found > 0)`
		),
		// Settled as not there, or searched and nothing found.
		notOn: count(`${WAITING_SQL.replace(
			'AND s.id NOT IN (SELECT series_id FROM ranobe_decisions)',
			''
		)} AND (s.id IN (SELECT series_id FROM ranobe_decisions WHERE decision = 'none')
			OR s.id IN (SELECT series_id FROM ranobe_searches WHERE searched_at IS NOT NULL AND found = 0))`)
	};
}
