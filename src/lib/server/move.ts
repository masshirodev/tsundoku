import type Database from 'better-sqlite3';
import { getDb } from './db.ts';
import {
	imageRoute,
	parseSourceMangaId,
	sourceManga,
	sourceMedium,
	sourceName
} from './engine/backend.ts';
import { fetchAnime, planOf } from './engine/anime-source.ts';
import { engineDownSince } from './engine/client.ts';
import { coverRoute } from './novels/source.ts';
import { searchSources } from './downloads.ts';
import { forgetSourceUse } from './library-sources.ts';
import {
	entryOriginSql,
	heldByOther,
	resequenceAnime,
	seasonFacts,
	seasonOrigin,
	seasonRowOf
} from './season-facts.ts';
import { ago } from '../library/tracking.ts';
import {
	animeKeyOf,
	keyOf,
	parseAnimeKey,
	parseKey,
	sourceOfKey,
	type ResultMatch
} from '../library/downloads.ts';
import { formatNumber } from '../library/series.ts';
import {
	buildMoveMap,
	guessOffset,
	movedDetail,
	moveSummary,
	movesVideo,
	queueCounts,
	type MoveCandidateEntry,
	type MoveEntry,
	type MoveKind,
	type MovePlan,
	type MoveSummaryRow
} from '../library/move.ts';
import type { Kind } from '../library/types.ts';
import { isMovable, kindFacts, moveKindOf, type MovableKind } from '../library/kinds.ts';
import { moveHighlights, repointAdded, type MoveHighlights } from './highlights.ts';

/**
 * MOVE (doc/MOVE.md; card c139): moving a series to another source, as one
 * transaction, and the way back. The domain rules are in
 * `$lib/library/move.ts`; this is the database and the sources around them.
 *
 * The owner's decisions are the frame: downloaded files stay; a chapter the
 * new source lacks stays, from the old one; FOLLOW and queued downloads move,
 * except a queued chapter with no partner, which leaves the queue. Nothing
 * downloads because of a move.
 *
 * MOVE is for series whose chapters or episodes come from a Mihon or Aniyomi
 * source. A local import has none; a novel's chapters are one EPUB from one
 * plugin, so a novel isn't moved between plugins (doc/MOVE.md, "What it does
 * not do yet").
 */

/**
 * The kinds whose series can move: the registry's `movable` (doc/KINDS.md;
 * card c304), today a source's manga, manhwa, or anime. Not a doujin, even a
 * gallery's with a `mihon:` key, and not a novel.
 */
export const movableKind = (kind: Kind): kind is MovableKind => isMovable(kind);

export type MoveTarget = {
	key: string;
	/** The source's name, as the series will show it. */
	source: string;
	sourceId: string;
	url: string;
};

/** A candidate in full: the source's own answer, numbered by tsundoku's rules. */
export type MoveCandidate = {
	/** The opaque result id the search gave (`<source>~<url>`). */
	mangaId: string;
	sourceId: string;
	/** The source's name ("Weeb Central"). */
	source: string;
	url: string;
	title: string;
	status: string;
	cover: string;
	key: string;
	kind: MoveKind;
	chapters: MoveCandidateEntry[];
	/** The seasons the candidate lists, for TAKES. */
	seasons: number[];
	/** One flat list, no seasons: the offset case. */
	flat: boolean;
};

/** An anime that gives no episodes or a source that answers nothing: the page bands it. */
export class MoveError extends Error {}

// ---- what the series is ---------------------------------------------------------

type SeriesRow = {
	id: number;
	title: string;
	kind: Kind;
	status: string;
	source: string;
	origin_key: string | null;
	former_key: string | null;
	former_at: number | null;
	former_source: string;
	former_offset: number;
	followed_at: number | null;
	move_dismissed_at: number | null;
	in_library: number;
};

function seriesRow(seriesId: number, db: Database.Database = getDb()): SeriesRow | null {
	return (
		(db
			.prepare(
				`SELECT id, title, kind, status, source, origin_key, former_key, former_at, former_source,
					former_offset, followed_at, move_dismissed_at, in_library
				FROM series WHERE id = ?`
			)
			.get(seriesId) as SeriesRow | undefined) ?? null
	);
}

const GENERIC_SOURCES = new Set(['mihon', 'aniyomi', 'lnreader', 'hentoid', 'epub']);

/** The source's name as a row says it, never the key's number unless nothing knows it. */
export function sourceLabel(seriesId: number, key: string | null, fallback = ''): string {
	if (!key) return fallback;
	const id = sourceOfKey(key);
	if (!id) return fallback;
	const db = getDb();
	const engine = db.prepare(`SELECT name FROM engine_sources WHERE id = ?`).get(id) as
		{ name: string } | undefined;
	if (engine?.name) return engine.name;
	const novel = id.startsWith('ln:')
		? (db.prepare(`SELECT name FROM novel_plugins WHERE id = ?`).get(id.slice(3)) as
				{ name: string } | undefined)
		: undefined;
	if (novel?.name) return novel.name;
	const tag = db
		.prepare(
			`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE st.series_id = ? AND t.namespace = 'source' AND t.value != 'mihon' LIMIT 1`
		)
		.get(seriesId) as { value: string } | undefined;
	if (tag?.value) return tag.value;
	if (fallback && !GENERIC_SOURCES.has(fallback.toLowerCase())) return fallback;
	return `source ${id}`;
}

const dayOf = (at: number) =>
	new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();

/** "1, 2, 7 and 8" — the episodes a line names. */
function listed(numbers: number[]): string {
	const n = [...new Set(numbers)].sort((a, b) => a - b).map(formatNumber);
	if (n.length <= 1) return n[0] ?? '';
	return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** The old source's name from the key it was left under, falling back to the stored one. */
function formerName(s: SeriesRow): string {
	return (
		sourceLabel(s.id, s.former_key, s.former_source) ||
		s.former_source ||
		(s.former_key ? 'the old source' : '')
	);
}

// ---- NO SERVER, recorded (the band and the player's line) -----------------------

export type FailureRow = {
	entryId: number;
	number: number;
	season: number | null;
	firstAt: number;
	lastAt: number;
	tries: number;
};

/**
 * A NO SERVER answer for an episode (doc/MOVE.md, "The NO VIDEO band"). It
 * is kept against the episode so the series screen can say how many failed
 * and the player can say it isn't just this one. Incognito never calls this.
 */
export function recordNoVideo(
	entryId: number,
	now = Date.now(),
	db: Database.Database = getDb()
): void {
	const row = db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(entryId) as
		{ series_id: number } | undefined;
	if (!row) return;
	db.prepare(
		`INSERT INTO episode_failures (entry_id, series_id, first_at, last_at, tries)
		VALUES (?, ?, ?, ?, 1)
		ON CONFLICT (entry_id) DO UPDATE SET last_at = excluded.last_at, tries = episode_failures.tries + 1`
	).run(entryId, row.series_id, now, now);
}

export function episodeFailures(seriesId: number, db: Database.Database = getDb()): FailureRow[] {
	return (
		db
			.prepare(
				`SELECT f.entry_id, e.season, e.episode_number, e.position, f.first_at, f.last_at, f.tries
				FROM episode_failures f JOIN entries e ON e.id = f.entry_id
				WHERE f.series_id = ? ORDER BY e.season, e.position, e.id`
			)
			.all(seriesId) as {
			entry_id: number;
			season: number | null;
			episode_number: number | null;
			position: number;
			first_at: number;
			last_at: number;
			tries: number;
		}[]
	).map((r) => ({
		entryId: r.entry_id,
		number: r.episode_number ?? r.position,
		season: r.season,
		firstAt: r.first_at,
		lastAt: r.last_at,
		tries: r.tries
	}));
}

/** How long failures keep the band and the "not just this episode" line worth saying. */
const FAILURE_DAYS = 1;
/** A source that has added nothing for this long is worth mentioning (the design's eight weeks). */
const STALE_DAYS = 56;

/**
 * The player's one line under NO SERVER: null when it is just this episode.
 * "EPISODES 1, 2, 7 AND 8 FAILED THE SAME WAY SINCE 1 NOV".
 */
export async function noVideoLine(seriesId: number, now = Date.now()): Promise<string | null> {
	const recent = episodeFailures(seriesId).filter(
		(f) => now - f.lastAt <= FAILURE_DAYS * 86_400_000
	);
	if (recent.length < 2) return null;
	const first = Math.min(...recent.map((f) => f.firstAt));
	return `EPISODES ${listed(recent.map((f) => f.number)).toUpperCase()} FAILED THE SAME WAY SINCE ${dayOf(first)}`;
}

// ---- the series screen's SOURCE row and NO VIDEO band ---------------------------

export type MoveState = {
	/** False for a local import, a browsing record, or a kind that doesn't move. */
	eligible: boolean;
	kind: MoveKind;
	/** The source's own name, as the row says it. */
	source: string;
	sourceId: string;
	/** "LAST ASKED 2 H AGO · 25 EPISODES LISTED". */
	meta: string;
	/** The trouble in ink, or null. */
	trouble: string | null;
	/** The way back, for 30 days. */
	former: { name: string; until: number } | null;
	/** The source the way back goes to, when it is remembered. */
	formerSourceId: string | null;
	/** The NO VIDEO band, when the owner hasn't said NOT NOW since its last failure. */
	band: { title: string; detail: string } | null;
};

/**
 * MOVE BACK's offer: open for 30 days, and only while no other series has
 * come to hold the key, so the screen never offers what `applyMoveBack` refuses.
 */
function wayBack(
	s: SeriesRow,
	now: number,
	db: Database.Database = getDb()
): { name: string; until: number } | null {
	if (!s.former_key || s.former_at === null || now - s.former_at >= MOVE_BACK_DAYS * 86_400_000)
		return null;
	if (heldByOther(s.former_key, s.id, db)) return null;
	return { name: formerName(s), until: s.former_at + MOVE_BACK_DAYS * 86_400_000 };
}

export function moveState(seriesId: number, now = Date.now()): MoveState {
	const s = seriesRow(seriesId);
	if (!s || s.in_library !== 1 || !movableKind(s.kind)) return emptyState();
	const key = parseAnimeKey(s.origin_key) ?? parseKey(s.origin_key);
	if (!key) return emptyState();
	const kind: MoveKind = moveKindOf(s.kind);
	const video = movesVideo(kind);
	const db = getDb();
	const source = sourceLabel(seriesId, s.origin_key, s.source);
	const entries = db
		.prepare(
			`SELECT COUNT(*) AS n, MAX(added_at) AS latest FROM entries
				WHERE series_id = ? AND shadowed = 0 AND matter = ''`
		)
		.get(seriesId) as { n: number; latest: number | null };
	const resolved = db
		.prepare(`SELECT resolved_at FROM engine_series WHERE series_id = ?`)
		.get(seriesId) as { resolved_at: number | null } | undefined;
	const noun = kindFacts(kind).unit.long;
	const meta = [
		resolved?.resolved_at ? `LAST ASKED ${ago(resolved.resolved_at, now)}` : '',
		`${entries.n} ${noun}${entries.n === 1 ? '' : 'S'} LISTED`
	]
		.filter(Boolean)
		.join(' · ');

	const failures = episodeFailures(seriesId, db);
	const recent = failures.filter((f) => now - f.lastAt <= FAILURE_DAYS * 86_400_000);
	const trouble =
		video && recent.length
			? `NO VIDEO FOR ${recent.length} EPISODE${recent.length === 1 ? '' : 'S'} SINCE ${dayOf(Math.min(...recent.map((f) => f.firstAt)))}`
			: s.status.toLowerCase() === 'ongoing' &&
				  entries.latest !== null &&
				  now - entries.latest > STALE_DAYS * 86_400_000
				? `NOTHING NEW SINCE ${dayOf(entries.latest)}`
				: engineDownSince() !== null
					? `NOT ANSWERED SINCE ${dayOf(engineDownSince()!)}`
					: null;

	const former = wayBack(s, now, db);

	// Three episodes failed within a day, or every episode the series has where
	// it has fewer (the brief's "or on every episode tried, if fewer").
	const band =
		video &&
		recent.length > 0 &&
		(recent.length >= 3 || recent.length === entries.n) &&
		(s.move_dismissed_at === null || Math.max(...recent.map((f) => f.lastAt)) > s.move_dismissed_at)
			? {
					title: `NO VIDEO FROM ${source.toUpperCase()}`,
					detail: `${recent.length} EPISODE${recent.length === 1 ? '' : 'S'} TRIED SINCE ${dayOf(Math.min(...recent.map((f) => f.firstAt)))} · EACH LISTS SERVERS, NONE SENT VIDEO`
				}
			: null;

	return {
		eligible: true,
		kind,
		source,
		sourceId: sourceOfKey(s.origin_key) ?? key.sourceId,
		meta,
		trouble,
		former,
		formerSourceId: s.former_key ? sourceOfKey(s.former_key) : null,
		band
	};
}

function emptyState(): MoveState {
	return {
		eligible: false,
		kind: 'manga',
		source: '',
		sourceId: '',
		meta: '',
		trouble: null,
		former: null,
		formerSourceId: null,
		band: null
	};
}

export const MOVE_BACK_DAYS = 30;

/**
 * The reader's END page says a source that has added nothing for eight weeks
 * (doc/MOVE.md; Migrate Calls, READER): a quiet source isn't a broken one, so
 * there is a line and a way out, never a band.
 */
export function staleSource(
	seriesId: number,
	now = Date.now()
): { source: string; since: number } | null {
	const s = seriesRow(seriesId);
	if (!s || s.status.toLowerCase() !== 'ongoing') return null;
	if (!s.origin_key || (!parseKey(s.origin_key) && !parseAnimeKey(s.origin_key))) return null;
	const latest = (
		getDb()
			.prepare(
				`SELECT MAX(added_at) AS at FROM entries WHERE series_id = ? AND shadowed = 0 AND matter = ''`
			)
			.get(seriesId) as { at: number | null }
	).at;
	if (latest === null || now - latest <= STALE_DAYS * 86_400_000) return null;
	return { source: sourceLabel(seriesId, s.origin_key, s.source), since: latest };
}

/** NOT NOW on the NO VIDEO band: nothing shows until a new failure. */
export function dismissMoveBand(seriesId: number, now = Date.now()): void {
	getDb().prepare(`UPDATE series SET move_dismissed_at = ? WHERE id = ?`).run(now, seriesId);
}

/** Whether the series is one MOVE can be offered on, and the hidden rule is the caller's. */
export function moveEligible(seriesId: number): SeriesRow | null {
	const s = seriesRow(seriesId);
	return s && s.in_library === 1 && movableKind(s.kind) ? s : null;
}

// ---- candidates ------------------------------------------------------------------

/**
 * The installed sources of the series' kind, as the existing search asks them.
 * The source the series came from is first when it is remembered, even after
 * its last series left it (the library no longer reads from it), so moving
 * back is an ordinary MOVE with the old source at the top.
 */
export async function moveSources(
	kind: MoveKind,
	reveal: boolean,
	formerSourceId: string | null = null
): Promise<{ id: string; name: string }[]> {
	const all = await searchSources(reveal);
	// The sources that serve the map kind's medium: a video kind's Aniyomi
	// ones, a pages kind's Mihon ones, and never an LNReader plugin (text).
	const medium = kindFacts(kind).medium;
	const sources = all.filter((s) => sourceMedium(s.id) === medium);
	if (!formerSourceId) return sources;
	const at = sources.findIndex((s) => s.id === formerSourceId);
	if (at > 0) return [sources[at], ...sources.slice(0, at), ...sources.slice(at + 1)];
	if (at === 0) return sources;
	const name = (
		getDb().prepare(`SELECT name FROM engine_sources WHERE id = ?`).get(formerSourceId) as
			{ name: string } | undefined
	)?.name;
	return name ? [{ id: formerSourceId, name }, ...sources] : sources;
}

/**
 * The sources a search asks, each with its language (card c490): one
 * extension installs a source per language under one name (MANGADEX twice,
 * one English and one Portuguese), so the list says which. An extension's
 * source carries `engine_sources.lang`, a novel plugin (`ln:<id>`) its
 * `novel_plugins.lang`; one neither knows has none. DOWNLOADS' search asks
 * the same.
 */
export function withLanguages<S extends { id: string; name: string }>(
	sources: S[],
	db: Database.Database = getDb()
): (S & { lang: string })[] {
	const engine = db.prepare(`SELECT lang FROM engine_sources WHERE id = ?`);
	const novel = db.prepare(`SELECT lang FROM novel_plugins WHERE id = ?`);
	return sources.map((s) => {
		const row = (s.id.startsWith('ln:') ? novel.get(s.id.slice(3)) : engine.get(s.id)) as
			{ lang: string | null } | undefined;
		return { ...s, lang: row?.lang ?? '' };
	});
}

/** A candidate's chapters or episodes, numbered as tsundoku would write them. */
export async function candidateOf(kind: MoveKind, mangaId: string): Promise<MoveCandidate> {
	const ref = parseSourceMangaId(mangaId);
	if (!ref) throw new MoveError('That is not a result of a source');
	if (movesVideo(kind)) {
		const a = await fetchAnime(mangaId);
		if (!a) throw new MoveError('The source did not answer for that anime');
		const plan = planOf(a, Date.now());
		const chapters: MoveCandidateEntry[] = plan.entries.map((e, i) => ({
			number: e.episode?.number ?? e.position,
			season: e.episode?.season ?? null,
			title: e.title,
			url: e.sourceUrl,
			name: [e.label, e.title].filter(Boolean).join(' · '),
			uploaded: e.addedAt,
			order: i
		}));
		const seasons = [
			...new Set(chapters.map((c) => c.season).filter((s): s is number => s !== null))
		];
		return {
			mangaId,
			sourceId: a.sourceId,
			source: sourceName(a.sourceId),
			url: a.details.url,
			title: plan.title,
			status: plan.status,
			cover: imageRoute(a.details.thumbnail_url) || coverRoute(a.details.thumbnail_url),
			key: animeKeyOf(a.sourceId, a.details.url),
			kind,
			chapters,
			seasons,
			flat: seasons.length === 0
		};
	}
	const m = await sourceManga(mangaId);
	if (!m) throw new MoveError('The source did not answer for that series');
	return {
		mangaId,
		sourceId: m.sourceId,
		source: m.source,
		url: m.url,
		title: m.title,
		status: m.status,
		cover: m.cover,
		key: keyOf(m.sourceId, m.url),
		kind,
		chapters: m.chapters.map((c) => ({
			number: c.number,
			season: null,
			title: c.name,
			url: c.url,
			name: c.name,
			uploaded: c.uploadDate || c.fetchedAt,
			order: c.sourceOrder
		})),
		seasons: [],
		flat: true
	};
}

// ---- the comparison ---------------------------------------------------------------

type EntryRow = {
	id: number;
	position: number;
	label: string;
	title: string;
	season: number | null;
	episode_number: number | null;
	read_at: number | null;
	last_position: number | null;
	last_opened_at: number | null;
	available: number;
	queued: number;
};

/**
 * Which entries a MOVE is about (c282). A MOVE of the series is about what
 * the series' own key supplies: a season with a source of its own stays with
 * it. A MOVE of one season is about that season alone.
 */
const inScope = (season: number | null): string =>
	season === null
		? `AND ${entryOriginSql('e', 's')} IS s.origin_key`
		: `AND COALESCE(e.season, 0) = ${seasonRowOf(season)}`;

function entriesOf(
	seriesId: number,
	kind: MoveKind,
	db: Database.Database = getDb(),
	season: number | null = null
): MoveEntry[] {
	// An episode is numbered by its episode number in its season; a page's
	// entry by its position.
	const video = movesVideo(kind);
	return (
		db
			.prepare(
				`SELECT e.id, e.position, e.label, e.title, e.season, e.episode_number, e.read_at, e.last_position,
					e.last_opened_at, e.available,
					EXISTS (SELECT 1 FROM download_queue q WHERE q.entry_id = e.id) AS queued
				FROM entries e JOIN series s ON s.id = e.series_id
				WHERE e.series_id = ? AND e.shadowed = 0 AND e.matter = '' ${inScope(season)}
				ORDER BY e.position, e.id`
			)
			.all(seriesId) as EntryRow[]
	).map((e) => ({
		id: e.id,
		number: video ? (e.episode_number ?? e.position) : e.position,
		season: video ? e.season : null,
		title: e.title,
		label: e.label,
		readAt: e.read_at,
		lastPosition: e.last_position,
		lastOpenedAt: e.last_opened_at,
		available: e.available === 1,
		queued: e.queued === 1
	}));
}

export type MoveComparison = {
	seriesId: number;
	kind: MoveKind;
	source: string;
	former: { name: string; until: number } | null;
	candidate: MoveCandidate;
	plan: MovePlan;
	summary: MoveSummaryRow[];
	detail: string;
	/** The offset to offer, and how it was guessed. */
	offset: { value: number; guessed: boolean; agree: number; of: number } | null;
	/** The series' own season, when it has one. */
	season: number | null;
	/** Another series already owns the candidate's key: not a move this can make. */
	conflict: { seriesId: number; title: string } | null;
	/** A hit already in the library, so the row says so. */
	match: ResultMatch | null;
	/**
	 * HIGHLIGHTS FOLLOW (c701; Out X5): from this same plan, which the move
	 * builds again from the same chapters when it applies. A MOVE deletes no
	 * entry, so none loses its way back here; those on a kept chapter are named.
	 */
	highlights: MoveHighlights;
	/**
	 * The one episode to check for PLAYS (the one CONTINUE would play), in the
	 * candidate's own numbers. One call once a candidate is picked, never per
	 * candidate on the list (Migrate Calls Q2).
	 */
	playCheck: {
		sourceId: string;
		url: string;
		name: string;
		number: number;
		theirNumber: number;
	} | null;
};

/**
 * A source that lists one season, moved onto one season of a series: its
 * episodes are that season's here, whatever number it gives itself (the
 * entry "Season 2" of the series' list is often the source's own "Season 1").
 * A list of several seasons matches season by season, and a flat one by
 * offset, as ever.
 */
function inSeason(chapters: MoveCandidateEntry[], season: number | null): MoveCandidateEntry[] {
	if (season === null) return chapters;
	const listed = new Set(chapters.map((c) => c.season).filter((x) => x !== null));
	return listed.size === 1 ? chapters.map((c) => ({ ...c, season })) : chapters;
}

/**
 * The candidate beside the series, by number, before anything changes. The
 * offset is the URL's when given (the owner edited it), the guessed one
 * otherwise: a flat anime list's YOUR EP. 1 IS THEIR EP. N.
 */
export async function moveComparison(
	seriesId: number,
	mangaId: string,
	reveal: boolean,
	offsetParam: number | null,
	now = Date.now(),
	/** One season's MOVE (c282), or null for the series'. */
	scope: number | null = null
): Promise<MoveComparison | null> {
	const s = seriesRow(seriesId);
	if (!s || s.in_library !== 1 || !movableKind(s.kind)) return null;
	const kind: MoveKind = moveKindOf(s.kind);
	const found = await candidateOf(kind, mangaId);
	const chapters = inSeason(found.chapters, scope);
	const candidate = {
		...found,
		chapters,
		seasons: [...new Set(chapters.map((c) => c.season).filter((x): x is number => x !== null))]
	};
	const yours = entriesOf(seriesId, kind, getDb(), scope);
	const fromKey = scope === null ? s.origin_key : seasonOrigin(seriesId, scope);
	const seasons = new Set(yours.map((e) => e.season).filter((x): x is number => x !== null));
	const needsOffset = movesVideo(kind) && seasons.size > 0 && candidate.flat;
	const guess = needsOffset
		? guessOffset(yours, candidate.chapters)
		: { offset: 1, agree: 0, of: 0 };
	const offset =
		offsetParam !== null && Number.isFinite(offsetParam) && offsetParam > 0
			? offsetParam
			: guess.offset;
	const plan = buildMoveMap(yours, candidate.chapters, {
		kind,
		offset,
		from: sourceLabel(seriesId, fromKey, s.source),
		to: candidate.source
	});
	const season = seasons.size === 1 ? [...seasons][0] : null;
	const summary = moveSummary(plan, {
		kind,
		from: sourceLabel(seriesId, fromKey, s.source),
		to: candidate.source,
		follow: s.followed_at !== null,
		yours,
		season
	});
	const conflict = heldByOther(candidate.key, seriesId);
	// The episode CONTINUE would play: the one part-way, else the first unread.
	const open =
		[...yours]
			.filter((e) => e.readAt === null && e.lastOpenedAt !== null)
			.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0] ??
		yours.find((e) => e.readAt === null) ??
		yours[0];
	const playMatch = open ? plan.matches.find((m) => m.entry.id === open.id) : undefined;
	const playCheck =
		movesVideo(kind) && playMatch
			? {
					sourceId: candidate.sourceId,
					url: playMatch.candidate.url,
					name: playMatch.candidate.name,
					number: playMatch.entry.number,
					theirNumber: playMatch.candidate.number
				}
			: null;
	void reveal;
	return {
		seriesId,
		kind,
		source: sourceLabel(seriesId, fromKey, s.source),
		former: scope === null ? wayBack(s, now) : null,
		candidate,
		plan,
		summary,
		detail: movedDetail(plan, sourceLabel(seriesId, fromKey, s.source), kind),
		offset: needsOffset
			? { value: offset, guessed: offsetParam === null, agree: guess.agree, of: guess.of }
			: null,
		season,
		conflict: conflict ? { seriesId: conflict.id, title: conflict.title } : null,
		match: conflict ? { kind: 'in-library', seriesId: conflict.id, meta: 'ALSO IN LIBRARY' } : null,
		highlights: moveHighlights(seriesId, plan, {
			from: sourceLabel(seriesId, fromKey, s.source),
			to: candidate.source
		}),
		playCheck
	};
}

// ---- the move itself ----------------------------------------------------------------

export type ApplyResult = {
	added: number;
	matched: number;
	kept: number;
	queuedMoved: number;
	queuedDropped: number;
	detail: string;
	/** Highlights whose entry this move took away (c701): they keep their copy and note. */
	highlightsLost: number;
};

/** Above any real position: additions waiting for their places. */
const PENDING = 1e9;

/** A series MOVE: the season rows that named the key it left now name where it went (c282). */
function followSeasons(db: Database.Database, seriesId: number, from: string, to: string): void {
	db.prepare(
		`UPDATE series_season_facts SET origin_key = ? WHERE series_id = ? AND origin_key = ?`
	).run(to, seriesId, from);
}

/** The episode failures of what moved: the rest of the show still fails where it failed. */
function clearFailures(db: Database.Database, seriesId: number, scope: number | null): void {
	db.prepare(
		`DELETE FROM episode_failures WHERE series_id = ?
		AND entry_id IN (SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
			WHERE e.series_id = ? ${inScope(scope)})`
	).run(seriesId, seriesId);
}

/**
 * The key a series has just left joins every other one it has left (rung 58),
 * which is what the tablet's backup resolves through; the key it moved to is
 * its current one, so it is not also a former one. `series.former_key` keeps
 * the most recent, which is the one MOVE BACK offers.
 */
function rememberKey(
	db: Database.Database,
	seriesId: number,
	leftKey: string,
	source: string,
	currentKey: string,
	now: number
): void {
	db.prepare(
		`INSERT INTO series_former_keys (series_id, origin_key, source, left_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (series_id, origin_key) DO UPDATE SET source = excluded.source,
			left_at = excluded.left_at`
	).run(seriesId, leftKey, source, now);
	db.prepare(`DELETE FROM series_former_keys WHERE series_id = ? AND origin_key = ?`).run(
		seriesId,
		currentKey
	);
}

/**
 * An entry matched to a candidate takes the new source's address. The one it
 * had becomes `former_url` and joins every other address it has left (rung 58),
 * so a backup naming any of them finds this chapter rather than adding a second
 * copy; the address it now has is not also a former one.
 */
function rekeyEntry(db: Database.Database, entryId: number, url: string, now: number): void {
	const was = (
		db.prepare(`SELECT source_url FROM entries WHERE id = ?`).get(entryId) as {
			source_url: string;
		}
	).source_url;
	if (was !== '')
		db.prepare(
			`INSERT INTO entry_former_urls (entry_id, former_url, left_at) VALUES (?, ?, ?)
			ON CONFLICT (entry_id, former_url) DO UPDATE SET left_at = excluded.left_at`
		).run(entryId, was, now);
	db.prepare(
		`UPDATE entries SET former_url = CASE WHEN source_url != '' THEN source_url ELSE former_url END,
			source_url = ?, origin_source = '' WHERE id = ?`
	).run(url, entryId);
	if (url !== '')
		db.prepare(`DELETE FROM entry_former_urls WHERE entry_id = ? AND former_url = ?`).run(
			entryId,
			url
		);
}

/**
 * MOVE as one transaction (doc/MOVE.md, "The move"): re-key the series, match,
 * keep and add chapters by number, carry reading by number, move FOLLOW and
 * the queue, and take an unmatched queued chapter out of the queue. Nothing
 * downloads, nothing is deleted, and a kept chapter keeps the source it came
 * from. The old key and when it was left stay on the series for MOVE BACK.
 */
export function applyMove(
	seriesId: number,
	target: MoveTarget,
	chapters: MoveCandidateEntry[],
	opts: { offset?: number; now?: number; db?: Database.Database; season?: number } = {}
): ApplyResult {
	const db = opts.db ?? getDb();
	const now = opts.now ?? Date.now();
	const scope = opts.season ?? null;
	return db
		.transaction((): ApplyResult => {
			const s = seriesRow(seriesId, db);
			const oldKey = s ? (scope === null ? s.origin_key : seasonOrigin(s.id, scope, db)) : null;
			if (!s || s.in_library !== 1 || !movableKind(s.kind) || !oldKey)
				throw new MoveError('That series cannot move');
			// One series holds a source entry: moving onto another series' key, or
			// a season of it (c282), would make two, and every import would then
			// find one at random. A key of this series' own is not another's: two
			// seasons of one show may share a source.
			if (heldByOther(target.key, seriesId, db))
				throw new MoveError('That entry is already another series in the library');
			const kind: MoveKind = moveKindOf(s.kind);
			const video = movesVideo(kind);
			const oldSource = sourceOfKey(oldKey) ?? '';
			const oldName = sourceLabel(seriesId, oldKey, s.source);
			const yours = entriesOf(seriesId, kind, db, scope);
			// Seasons that each have their own source leave the series' key
			// supplying nothing: there is nothing here to move (a series with no
			// season rows never reaches this, whatever it holds).
			if (yours.length === 0 && seasonFacts(seriesId, db).length > 0)
				throw new MoveError('Every season here has its own source: move one of those');
			const plan = buildMoveMap(yours, inSeason(chapters, scope), {
				kind,
				offset: opts.offset ?? 1,
				from: oldName,
				to: target.source
			});
			if (plan.matches.length === 0 && plan.kept.length === 0 && plan.added.length === 0)
				throw new MoveError('The source lists nothing to move to');

			// Matched: the same chapter, now from the new source. Its file and its
			// reading state stay; the address it had is kept for the backup's plan,
			// and every address before it too (rung 58).
			const setChapter = db.prepare(
				`INSERT INTO engine_chapters (entry_id, engine_url, name) VALUES (?, ?, ?)
				ON CONFLICT (entry_id) DO UPDATE SET engine_url = excluded.engine_url, name = excluded.name`
			);
			for (const m of plan.matches) {
				const url = m.candidate.url;
				rekeyEntry(db, m.entry.id, url, now);
				setChapter.run(m.entry.id, url, m.candidate.name);
			}

			// Kept: still the old source's, and told so, so the list can say its
			// name and a re-download asks the right source. One that was already
			// from the new source (kept by an earlier move) is current again.
			const keep = db.prepare(
				`UPDATE entries SET origin_source = CASE WHEN origin_source = '' THEN ?
					WHEN origin_source = ? THEN '' ELSE origin_source END
				WHERE series_id = ? AND id = ?`
			);
			for (const e of plan.kept) keep.run(oldSource, target.sourceId, seriesId, e.id);
			// Copies, front matter and anything not in the map stay the old source's too.
			const matchedIds = new Set(plan.matches.map((m) => m.entry.id));
			const untouched = (
				db
					.prepare(
						`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
						WHERE e.series_id = ? AND e.origin_source = ''
							AND (e.shadowed = 1 OR e.matter != '') ${inScope(scope)}`
					)
					.all(seriesId) as { id: number }[]
			).map((r) => r.id);
			for (const id of untouched)
				if (!matchedIds.has(id)) keep.run(oldSource, target.sourceId, seriesId, id);

			// Added: unread and not downloaded, except a split where a read mark spreads.
			const readOfUrl = new Map<string, number>();
			for (const split of plan.splits)
				if (split.from.readAt !== null)
					for (const t of split.to) readOfUrl.set(t.url, split.from.readAt);
			const insert = db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, read_at, last_position,
					last_opened_at, page_count, file, bytes, source_url, available, origin_source, season,
					episode_number, episode_note, arrived_at)
				VALUES (@series, @position, @label, @title, @added, @read, NULL, NULL, 0, '', 0, @url, 0, '', @season,
					@number, '', NULL)`
			);
			const maxPosition = (
				db
					.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM entries WHERE series_id = ?`)
					.get(seriesId) as { p: number }
			).p;
			const additions = [...plan.added, ...plan.readAdded].sort(
				(a, b) => (a.number >= 0 ? a.number : PENDING) - (b.number >= 0 ? b.number : PENDING)
			);
			let unnumbered = 0;
			let pending = 0;
			const addedIds: number[] = [];
			for (const t of additions) {
				const numbered = t.number >= 0;
				const position = video
					? PENDING + ++pending
					: numbered
						? t.number
						: maxPosition + ++unnumbered / 1000;
				const entryId = Number(
					insert.run({
						series: seriesId,
						position,
						label: numbered ? `${video ? 'Ep.' : 'Ch.'} ${formatNumber(t.number)}` : 'Chapter',
						title: t.title || t.name,
						added: t.uploaded || now,
						read: readOfUrl.get(t.url) ?? null,
						url: t.url,
						season: video ? (scope ?? t.season) : null,
						number: video ? t.number : null
					}).lastInsertRowid
				);
				setChapter.run(entryId, t.url, t.name);
				addedIds.push(entryId);
			}
			if (video) resequenceAnime(db, seriesId);
			// A chapter deleted before the move, listed again here, takes back the
			// highlights it lost, by the same numbers the map used (c701).
			repointAdded(db, seriesId, addedIds);

			// Queued chapters move by number; one with no partner leaves the queue.
			const queued = queueCounts(yours, plan);
			if (plan.kept.length) {
				const drop = db.prepare(`DELETE FROM download_queue WHERE entry_id = ?`);
				for (const e of plan.kept) drop.run(e.id);
			}

			if (scope !== null) {
				// One season (c282): `series.former_key` is the series' way back, and
				// stays exactly what it was, so MOVE BACK never returns the show to a
				// source only this season left. There is no way back for a season
				// yet; the left key joins `series_former_keys`, unless the series or
				// another season still holds it, so a backup still finds the series.
				db.prepare(
					`INSERT INTO series_season_facts (series_id, season, origin_key) VALUES (?, ?, ?)
					ON CONFLICT (series_id, season) DO UPDATE SET origin_key = excluded.origin_key`
				).run(seriesId, scope, target.key);
				const held =
					s.origin_key === oldKey || seasonFacts(seriesId, db).some((f) => f.originKey === oldKey);
				if (!held) rememberKey(db, seriesId, oldKey, oldName, target.key, now);
			} else {
				db.prepare(
					`UPDATE series SET origin_key = ?, former_key = ?, former_at = ?, former_source = ?,
						former_offset = ?, source = ?, source_url = ?, move_dismissed_at = NULL
					WHERE id = ?`
				).run(
					target.key,
					oldKey,
					now,
					oldName,
					opts.offset ?? 1,
					target.source,
					target.url,
					seriesId
				);
				// A season row that named the series' key names where the series went.
				followSeasons(db, seriesId, oldKey, target.key);
				rememberKey(db, seriesId, oldKey, oldName, target.key, now);
				const title = (
					db.prepare(`SELECT title FROM engine_series WHERE series_id = ?`).get(seriesId) as
						{ title: string } | undefined
				)?.title;
				db.prepare(
					`INSERT INTO engine_series (series_id, source_id, engine_url, title, resolved_at)
					VALUES (?, ?, ?, ?, ?)
					ON CONFLICT (series_id) DO UPDATE SET source_id = excluded.source_id,
						engine_url = excluded.engine_url, resolved_at = excluded.resolved_at`
				).run(seriesId, target.sourceId, target.url, title ?? s.title, now);
			}
			// A new source's first check is its own, not the old one's.
			db.prepare(`DELETE FROM anime_checks WHERE series_id = ?`).run(seriesId);
			forgetSourceUse();
			clearFailures(db, seriesId, scope);

			return {
				added: additions.length,
				matched: plan.matches.length,
				kept: plan.kept.length,
				queuedMoved: queued.moving,
				queuedDropped: queued.dropping,
				detail: movedDetail(plan, oldName, kind),
				highlightsLost: 0
			};
		})
		.immediate();
}

// ---- the way back --------------------------------------------------------------------

/** What MOVE BACK returns to, for the 30 days the SOURCE row offers it. */
export function moveBackTarget(seriesId: number): MoveTarget | null {
	const s = seriesRow(seriesId);
	if (!s?.former_key) return null;
	const at = parseAnimeKey(s.former_key) ?? parseKey(s.former_key);
	if (!at) return null;
	return {
		key: s.former_key,
		source: formerName(s),
		sourceId: at.sourceId,
		url: at.url
	};
}

/**
 * MOVE BACK (doc/MOVE.md, "The way back"): the old source is where chapters
 * come from again, reading carries back by number including what was read in
 * between, FOLLOW and the queue go with it, and a chapter the new source
 * added stays if it has a file and goes if it has none. It is a move, so
 * nothing downloads and nothing on disk is deleted. The key just left becomes
 * the remembered one, so the way back can be undone the same way.
 */
export function applyMoveBack(
	seriesId: number,
	chapters: MoveCandidateEntry[],
	opts: { now?: number; db?: Database.Database } = {}
): ApplyResult {
	const db = opts.db ?? getDb();
	const now = opts.now ?? Date.now();
	return db
		.transaction((): ApplyResult => {
			const s = seriesRow(seriesId, db);
			const target = moveBackTarget(seriesId);
			if (!s || !target || !s.origin_key) throw new MoveError('There is no source to move back to');
			// The key it left may have been taken up since, as another series' own
			// or a season's (c282): the same one-holder rule as a MOVE to it.
			if (heldByOther(target.key, seriesId, db))
				throw new MoveError('That entry is already another series in the library');
			const kind: MoveKind = moveKindOf(s.kind);
			const video = movesVideo(kind);
			const leftKey = s.origin_key;
			const leftSource = sourceOfKey(leftKey) ?? '';
			const leftName = sourceLabel(seriesId, leftKey, s.source);
			const yours = entriesOf(seriesId, kind, db);
			if (yours.length === 0 && seasonFacts(seriesId, db).length > 0)
				throw new MoveError('Every season here has its own source: move one of those');
			const plan = buildMoveMap(yours, chapters, {
				kind,
				offset: s.former_offset || 1,
				from: leftName,
				to: target.source
			});

			const setChapter = db.prepare(
				`INSERT INTO engine_chapters (entry_id, engine_url, name) VALUES (?, ?, ?)
				ON CONFLICT (entry_id) DO UPDATE SET engine_url = excluded.engine_url, name = excluded.name`
			);
			for (const m of plan.matches) {
				rekeyEntry(db, m.entry.id, m.candidate.url, now);
				setChapter.run(m.entry.id, m.candidate.url, m.candidate.name);
			}
			// A chapter only the source just left has: it stays if it has a file
			// (nothing deletes a file) and goes if it hasn't.
			const gone: number[] = [];
			const keep = db.prepare(
				`UPDATE entries SET origin_source = CASE WHEN origin_source = '' THEN ?
					WHEN origin_source = ? THEN '' ELSE origin_source END
				WHERE series_id = ? AND id = ?`
			);
			const originOf = new Map(
				(
					db.prepare(`SELECT id, origin_source FROM entries WHERE series_id = ?`).all(seriesId) as {
						id: number;
						origin_source: string;
					}[]
				).map((r) => [r.id, r.origin_source])
			);
			const keptIds = new Set<number>();
			for (const e of plan.kept) {
				keptIds.add(e.id);
				const origin = originOf.get(e.id) ?? '';
				// A chapter another source kept through an earlier move stays as
				// it is: this move is not about it.
				if (origin !== '' && origin !== target.sourceId && origin !== leftSource) continue;
				// The chapter the source being left added: a file keeps it, no file
				// means it goes (nothing on disk is deleted either way).
				if ((origin === '' || origin === leftSource) && !e.available) gone.push(e.id);
				else keep.run(leftSource, target.sourceId, seriesId, e.id);
			}
			// Copies and front matter are not in the map; the source they came
			// from is told the same way, so none is left saying nothing.
			const untouched = (
				db
					.prepare(
						`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id
						WHERE e.series_id = ? AND (e.shadowed = 1 OR e.matter != '') ${inScope(null)}`
					)
					.all(seriesId) as { id: number }[]
			).map((r) => r.id);
			for (const id of untouched)
				if (!keptIds.has(id)) keep.run(leftSource, target.sourceId, seriesId, id);
			// Counted from this plan before the rows go; rung 72's trigger marks
			// them ORPHAN (entry) as they do (c701).
			const highlightsLost = moveHighlights(
				seriesId,
				plan,
				{ gone: new Set(gone), from: leftName, to: target.source },
				db
			).lose;
			const del = db.prepare(`DELETE FROM entries WHERE id = ? AND series_id = ?`);
			for (const id of gone) del.run(id, seriesId);
			// The old source's chapters that are no longer here (deleted while away)
			// are back: unread, not downloaded, as the source lists them.
			const insert = db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, read_at, last_position,
					last_opened_at, page_count, file, bytes, source_url, available, origin_source, season,
					episode_number, episode_note, arrived_at)
				VALUES (@series, @position, @label, @title, @added, NULL, NULL, NULL, 0, '', 0, @url, 0, '', @season,
					@number, '', NULL)`
			);
			const maxPosition = (
				db
					.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM entries WHERE series_id = ?`)
					.get(seriesId) as { p: number }
			).p;
			let pending = 0;
			const readd = [...plan.added, ...plan.readAdded].sort((a, b) => a.number - b.number);
			const addedIds: number[] = [];
			for (const t of readd) {
				const entryId = Number(
					insert.run({
						series: seriesId,
						position: video
							? PENDING + ++pending
							: t.number >= 0
								? t.number
								: maxPosition + pending / 1000,
						label: `${video ? 'Ep.' : 'Ch.'} ${formatNumber(t.number)}`,
						title: t.title || t.name,
						added: t.uploaded || now,
						url: t.url,
						season: video ? t.season : null,
						number: video ? t.number : null
					}).lastInsertRowid
				);
				setChapter.run(entryId, t.url, t.name);
				addedIds.push(entryId);
				if (!video) pending++;
			}
			if (video) resequenceAnime(db, seriesId);
			repointAdded(db, seriesId, addedIds);

			// Queued chapters without a partner in the old source leave.
			const queued = queueCounts(yours, plan);
			if (plan.kept.length) {
				const drop = db.prepare(`DELETE FROM download_queue WHERE entry_id = ?`);
				for (const e of plan.kept) drop.run(e.id);
			}

			db.prepare(
				`UPDATE series SET origin_key = ?, former_key = ?, former_at = ?, former_source = ?,
					former_offset = ?, source = ?, source_url = ?, move_dismissed_at = NULL WHERE id = ?`
			).run(
				target.key,
				leftKey,
				now,
				leftName,
				s.former_offset || 1,
				target.source,
				target.url,
				seriesId
			);
			followSeasons(db, seriesId, leftKey, target.key);
			rememberKey(db, seriesId, leftKey, leftName, target.key, now);
			db.prepare(
				`INSERT INTO engine_series (series_id, source_id, engine_url, title, resolved_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (series_id) DO UPDATE SET source_id = excluded.source_id,
					engine_url = excluded.engine_url, resolved_at = excluded.resolved_at`
			).run(seriesId, target.sourceId, target.url, s.title, now);
			db.prepare(`DELETE FROM anime_checks WHERE series_id = ?`).run(seriesId);
			clearFailures(db, seriesId, null);
			forgetSourceUse();

			const keptStayed = plan.kept.length - gone.length;
			const detail = [
				readd.length
					? `${readd.length} ${kindFacts(kind).unit.long}${readd.length === 1 ? '' : 'S'} BACK FROM THE OLD SOURCE`
					: '',
				keptStayed ? `${keptStayed} KEPT FROM ${leftName.toUpperCase()}` : ''
			]
				.filter(Boolean)
				.join(' · ');
			return {
				added: readd.length,
				matched: plan.matches.length,
				kept: keptStayed,
				queuedMoved: queued.moving,
				queuedDropped: queued.dropping,
				detail: detail || 'NOTHING ADDED OR KEPT',
				highlightsLost
			};
		})
		.immediate();
}

/** MOVE BACK's candidate list, from the key the series remembers. */
export async function formerCandidate(seriesId: number): Promise<MoveCandidate | null> {
	const s = seriesRow(seriesId);
	if (!s?.former_key) return null;
	const id = sourceMangaIdOf(s.former_key);
	if (!id) return null;
	return candidateOf(moveKindOf(s.kind), id);
}

/** A key as the opaque result id the candidate fetch takes. */
function sourceMangaIdOf(key: string): string {
	const at = parseAnimeKey(key) ?? parseKey(key);
	if (!at) return '';
	return `${at.sourceId}~${Buffer.from(at.url).toString('base64url')}`;
}
