import { clock } from './anime.ts';
import { kindFacts, type MoveKind } from './kinds.ts';
import { formatNumber } from './series.ts';

/**
 * MOVE, the rules (doc/MOVE.md; card c139): moving a series from one source
 * to another without losing anything that is the owner's. Everything the
 * screen derives -- the by-number map, how runs fold, which odd rows are
 * kept or added, the counts "WHAT THE MOVE DOES" shows -- is decided here and
 * tested in tests/move-domain.spec.ts. Nothing here touches the database or
 * a source.
 *
 * The owner's decisions (2026-11-01) are the frame:
 *
 * - downloaded files stay, as the chapters or episodes they are;
 * - a chapter the new source lacks, or numbers differently, stays too, from
 *   the old source;
 * - FOLLOW and queued downloads move, except a queued chapter with no
 *   partner on the new source, which leaves the queue.
 *
 * Matching is by number and nothing else. Everything that is not 1:1 is a
 * row of its own, so the owner sees where a source numbers things oddly
 * before anything changes.
 */

/** A chapter or episode the series already has, as the map needs it. */
export type MoveEntry = {
	id: number;
	/** The entry's number: a chapter's, or an episode's within its season. */
	number: number;
	/** The entry's season; null when the series is one flat list. */
	season: number | null;
	/** The entry's own title, without the number. May be empty. */
	title: string;
	/** "Ch. 41", "Ep. 8", or an extra's own label ("Afterword"). */
	label: string;
	readAt: number | null;
	/** Last page (0-based), or seconds into an episode. */
	lastPosition: number | null;
	lastOpenedAt: number | null;
	/** On disk: downloaded. */
	available: boolean;
	queued: boolean;
};

/** A chapter or episode a candidate source lists. */
export type MoveCandidateEntry = {
	/** Its number at that source; -1 (or below) when it doesn't give one. */
	number: number;
	/** Its season there; null for a flat list. */
	season: number | null;
	/** Its own title, without the number. May be empty. */
	title: string;
	/** Its address at the source: what an added entry is downloaded by. */
	url: string;
	/** The source's name for it ("Chapter 10 - Ashes", "S3 · Ep. 8"). */
	name: string;
	/** When the source listed it. */
	uploaded: number;
	/** Its place in the source's own listing (newest first for a Mihon source). */
	order: number;
};

/**
 * A series that can be moved, as MOVE's map reads it: `MOVE_MAP` in the
 * registry, derived there from `movable` and the map's shape (doc/KINDS.md;
 * cards c301, c304), and `moveKindOf` reads it from a kind's medium. Today
 * `manga` (pages) and `anime` (video); a manhwa is movable and maps as a
 * manga, and a doujin does not move, even a gallery's with a `mihon:` key.
 */
export type { MoveKind };

/**
 * Whether a move maps video (episodes, seasons, an offset, a position in
 * time) rather than pages: the medium of MOVE's map kind (doc/KINDS.md; card
 * c304). Every per-medium rule below asks this, never the kind's name.
 */
export const movesVideo = (kind: MoveKind): boolean => kindFacts(kind).medium === 'video';

/**
 * YOUR EP. 1 IS THEIR EP. [offset]: only a candidate that numbers every
 * season as one list needs it. `offset` is that number, so their 50 is your
 * 1 when it is 50. Their numbers become "your space" by subtracting it.
 */
export const atOf = (number: number, offset: number) => number - offset + 1;

/** A title as titles are compared: case, punctuation and spacing aside. */
export const titleKey = (t: string) =>
	t
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

/**
 * The offset a flat candidate's list needs, guessed from episode titles: the
 * number of their episode that is your ep. 1. Only pairs whose titles agree
 * vote, and the offset with the most agreement wins (the smallest on a tie,
 * so a list that numbers as yours guesses 1). `of` is how many of your titled
 * episodes there are: "22 OF 24 TITLES AGREE".
 */
export function guessOffset(
	yours: MoveEntry[],
	theirs: MoveCandidateEntry[]
): { offset: number; agree: number; of: number } {
	const mine = yours
		.filter((e) => e.number > 0 && titleKey(e.title) !== '')
		.map((e) => ({ number: e.number, title: titleKey(e.title) }));
	const theirTitles = new Map(theirs.map((t) => [t.number, titleKey(t.title)]));
	const votes = new Map<number, number>();
	for (const y of mine)
		for (const t of theirs) {
			if (t.number <= 0 || titleKey(t.title) !== y.title) continue;
			const offset = t.number - y.number + 1;
			votes.set(offset, (votes.get(offset) ?? 0) + 1);
		}
	const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
	if (!best) return { offset: 1, agree: 0, of: mine.length };
	const offset = best[0];
	// Agreement is judged on the offset's own alignment, not on how many pairs voted for it.
	const agree = mine.filter((y) => {
		const there = theirTitles.get(y.number + offset - 1);
		return there !== undefined && there !== '' && there === y.title;
	}).length;
	return { offset, agree, of: mine.length };
}

type Normalized = MoveCandidateEntry & {
	/** Its number in the series' own space: their number minus the offset, or its own. */
	at: number;
	/** The map key: a seasoned anime's season matters, everything else is the number. */
	key: string;
};

const keyOf = (season: number | null, number: number, seasoned: boolean) =>
	seasoned ? `${season ?? 0}\u0000${formatNumber(number)}` : formatNumber(number);

/**
 * How the move reads a kind: an anime that has seasons on both sides matches
 * season to season; one whose candidate is a flat list takes an offset; all
 * else matches by number alone. `seasoned` decides the keys, and a season an
 * anime candidate has is shown on every row.
 */
export type MapOptions = {
	kind: MoveKind;
	/** The offset for a flat anime candidate: the design's YOUR EP. 1 IS THEIR EP. N. */
	offset?: number;
	/** The old source's name ("Asura Scans"), for "KEPT FROM …". */
	from: string;
	/** The new source's name, for "Opens at p. 12 on Weeb Central's 41". */
	to: string;
	/** Whether FOLLOW is on; only when the caller isn't reading the series row. */
	follow?: boolean;
};

export type MoveRowVariant = 'match' | 'kept' | 'added' | 'split' | 'untaken';

/** One row of BY NUMBER, already said in the owner's terms. */
export type MoveRow = {
	variant: MoveRowVariant;
	/** "1 – 9", "10", "Afterword", or "—". */
	yours: string;
	theirs: string;
	/** The accent line: "9 MATCH · READ", "KEPT FROM ASURA SCANS". */
	status: string;
	/** The line under it, where the design draws one. */
	detail?: string;
	/** A mark in the number's column: it is on disk. */
	downloaded?: boolean;
	/** Where reading is now: the accent row. */
	here?: boolean;
	/** A match that was read, or an addition the split rule reached. */
	read?: boolean;
	/** A matched chapter that is queued. */
	queued?: boolean;
	/** Its season, when the rows are drawn season by season. */
	season?: number | null;
};

export type MoveMatch = { entry: MoveEntry; candidate: MoveCandidateEntry };

export type MovePlan = {
	kind: MoveKind;
	/** An anime's season, when both sides have seasons. */
	seasoned: boolean;
	/** The offset used for a flat anime candidate; 1 otherwise. */
	offset: number;
	matches: MoveMatch[];
	/** Yours that the candidate has no exact number for: they stay. */
	kept: MoveEntry[];
	/** Theirs that are new: added, unread, not downloaded. */
	added: MoveCandidateEntry[];
	/** Theirs added as the other half of a split, which a read mark reaches. */
	readAdded: MoveCandidateEntry[];
	/** Every split, with the old chapter it came from, for the reading line. */
	splits: { from: MoveEntry; to: MoveCandidateEntry[] }[];
	/** An anime candidate's episodes outside the season or range: not added, not followed. */
	notTaken: MoveCandidateEntry[];
	/** One row per fold; every odd row is one of its own. */
	rows: MoveRow[];
	/** The same map unfolded, for SHOW ALL. */
	allRows: MoveRow[];
};

/** The number a row shows: an anime's "S3 · 1 – 7", a manga's "1 – 9". */
function span(from: number, to: number, season: number | null, seasoned: boolean): string {
	const n = from === to ? formatNumber(from) : `${formatNumber(from)} – ${formatNumber(to)}`;
	return seasoned && season !== null ? `S${season} · ${n}` : n;
}

/** The reading position, for the row the design accents. */
function readingDetail(e: MoveEntry, to: string): string {
	if (e.lastPosition === null) return `Opens on ${to}'s ${formatNumber(e.number)}`;
	return `Opens at p. ${e.lastPosition + 1} on ${to}'s ${formatNumber(e.number)}`;
}

const episodeReadingDetail = (e: MoveEntry) => `Resumes at ${clock(e.lastPosition ?? 0)} there`;

type Unit =
	| { kind: 'match'; entry: MoveEntry; candidate: Normalized; at: number; season: number | null }
	| { kind: 'kept'; entry: MoveEntry; at: number; season: number | null }
	| { kind: 'added'; candidate: Normalized; at: number; season: number | null; read: boolean }
	| { kind: 'untaken'; candidate: Normalized; reason: 'before' | 'after' | 'season' }
	| { kind: 'split'; entry: MoveEntry; added: Normalized[] };

/** The unit's place in the list: season first for a seasoned anime, then the number. */
const unitKey = (u: Unit, seasoned: boolean): [number, number] => {
	if (u.kind === 'untaken') return [seasoned ? (u.candidate.season ?? 0) : 0, u.candidate.at];
	if (u.kind === 'split') return [seasoned ? (u.entry.season ?? 0) : 0, u.entry.number];
	return [seasoned ? (u.season ?? 0) : 0, u.at];
};

/**
 * The whole comparison: what matches, what is kept, what appears, and the
 * rows that say so. Exact numbers only; a read mark on a chapter that split
 * (10 -> 10.1 and 10.2) carries to the pieces between 10 and 11, so they
 * arrive read rather than as holes in the middle of what was read.
 */
export function buildMoveMap(
	yours: MoveEntry[],
	theirs: MoveCandidateEntry[],
	opts: MapOptions
): MovePlan {
	const video = movesVideo(opts.kind);
	const offset = opts.offset ?? 1;
	const yourSeasons = new Set(yours.map((e) => e.season).filter((s): s is number => s !== null));
	const theirSeasons = new Set(theirs.map((t) => t.season).filter((s): s is number => s !== null));
	// Seasons are compared only when both sides have them: a flat candidate is
	// the offset case, and a flat series is one list like a manga's.
	const seasoned = video && yourSeasons.size > 0 && theirSeasons.size > 0;
	// A flat candidate for a series that knows its season: the offset maps its
	// numbers into the series' own.
	const flatOffset = video && yourSeasons.size > 0 && theirSeasons.size === 0;

	const normalized: Normalized[] = theirs.map((t) => ({
		...t,
		at: flatOffset ? atOf(t.number, offset) : t.number,
		key: keyOf(seasoned ? t.season : null, flatOffset ? atOf(t.number, offset) : t.number, seasoned)
	}));
	const theirByKey = new Map<string, Normalized>();
	for (const t of normalized) if (!theirByKey.has(t.key)) theirByKey.set(t.key, t);

	// A season's range is the series' own: theirs beyond its last are FOLLOW's,
	// not the move's, and another season is another series (doc/MOVE.md).
	const ranges = new Map<number | null, { from: number; to: number }>();
	for (const e of yours) {
		const s = seasoned ? e.season : null;
		const r = ranges.get(s);
		if (!r) ranges.set(s, { from: e.number, to: e.number });
		else ranges.set(s, { from: Math.min(r.from, e.number), to: Math.max(r.to, e.number) });
	}
	const inRange = (t: Normalized): boolean => {
		if (!video) return true;
		if (seasoned && !ranges.has(t.season)) return false;
		const r = ranges.get(seasoned ? t.season : null);
		return !!r && t.at >= r.from && t.at <= r.to;
	};

	const matched = new Set<string>();
	const matches: MoveMatch[] = [];
	const kept: MoveEntry[] = [];
	const splitAdded: { entry: MoveEntry; candidates: Normalized[] }[] = [];
	const pendingYour: MoveEntry[] = [];
	for (const e of yours) {
		const key = keyOf(seasoned ? e.season : null, e.number, seasoned);
		const t = theirByKey.get(key);
		if (t) {
			matched.add(key);
			matches.push({ entry: e, candidate: t });
		} else pendingYour.push(e);
	}

	// A split: their 10.1 and 10.2 with no 10, where the series has a whole 10.
	// A fractional chapter of ours (an afterword at 10.5) against their whole 11
	// is not a split: the numbers differ, that is all.
	const taken = new Set<Normalized>();
	for (const e of pendingYour) {
		if (!Number.isInteger(e.number)) {
			kept.push(e);
			continue;
		}
		const pieces = normalized.filter(
			(t) =>
				!matched.has(t.key) &&
				!taken.has(t) &&
				inRange(t) &&
				t.at % 1 !== 0 &&
				t.at > e.number &&
				t.at < e.number + 1 &&
				(!seasoned || (t.season ?? null) === (e.season ?? null))
		);
		if (pieces.length) {
			for (const p of pieces) taken.add(p);
			splitAdded.push({ entry: e, candidates: pieces });
		} else kept.push(e);
	}

	const splitEntries = new Set(splitAdded.map((s) => s.entry.id));
	const added: Normalized[] = [];
	const notTaken: { candidate: Normalized; reason: 'before' | 'after' | 'season' }[] = [];
	for (const t of normalized) {
		if (matched.has(t.key) || taken.has(t)) continue;
		if (!inRange(t)) {
			const r = ranges.get(seasoned ? t.season : null);
			const reason: 'before' | 'after' | 'season' = !r
				? 'season'
				: t.at < r.from
					? 'before'
					: 'after';
			notTaken.push({ candidate: t, reason });
			continue;
		}
		added.push(t);
	}

	const readAdded = splitAdded.filter((s) => s.entry.readAt !== null).flatMap((s) => s.candidates);

	const units: Unit[] = [];
	for (const m of matches)
		units.push({
			kind: 'match',
			entry: m.entry,
			candidate: m.candidate as Normalized,
			at: m.entry.number,
			season: seasoned ? m.entry.season : null
		});
	for (const e of kept)
		units.push({ kind: 'kept', entry: e, at: e.number, season: seasoned ? e.season : null });
	for (const s of splitAdded) units.push({ kind: 'split', entry: s.entry, added: s.candidates });
	const readIds = new Set(readAdded.map((t) => t.url));
	for (const t of added)
		units.push({
			kind: 'added',
			candidate: t,
			at: t.at,
			season: seasoned ? t.season : null,
			read: readIds.has(t.url)
		});
	for (const t of notTaken)
		units.push({ kind: 'untaken', candidate: t.candidate, reason: t.reason });
	units.sort((a, b) => {
		const [as, an] = unitKey(a, seasoned);
		const [bs, bn] = unitKey(b, seasoned);
		return as - bs || an - bn;
	});

	// The row reading is at: the one part-read and not finished.
	const here = yours
		.filter((e) => e.readAt === null && e.lastOpenedAt !== null && !splitEntries.has(e.id))
		.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
	const allRows = units.map((u) => rowOf(u, { ...opts, seasoned, here }));
	const rows = foldRows(units, allRows, seasoned, opts.from);

	return {
		kind: opts.kind,
		seasoned,
		offset,
		matches,
		kept,
		added,
		readAdded,
		splits: splitAdded.map((s) => ({ from: s.entry, to: s.candidates })),
		notTaken: notTaken.map((t) => t.candidate),
		rows,
		allRows
	};
}

function rowOf(u: Unit, opts: MapOptions & { seasoned: boolean; here?: MoveEntry }): MoveRow {
	const { from, to, seasoned, kind } = opts;
	if (u.kind === 'match') {
		const isHere = !!opts.here && opts.here.id === u.entry.id;
		const read = u.entry.readAt !== null;
		const queued = u.entry.queued;
		return {
			variant: 'match',
			yours: span(u.entry.number, u.entry.number, u.season, seasoned),
			theirs: span(u.candidate.number, u.candidate.number, u.candidate.season, seasoned),
			status: isHere
				? 'MATCH · READING CARRIES'
				: `MATCH${read ? ' · READ' : ''}${queued ? ' · QUEUED' : ''}`,
			...(isHere
				? {
						detail: movesVideo(kind) ? episodeReadingDetail(u.entry) : readingDetail(u.entry, to)
					}
				: {}),
			downloaded: u.entry.available,
			read,
			queued,
			here: isHere,
			season: u.season
		};
	}
	if (u.kind === 'kept') {
		return {
			variant: 'kept',
			yours: u.entry.title || formatNumber(u.entry.number),
			theirs: '—',
			status: `KEPT FROM ${from.toUpperCase()}`,
			downloaded: u.entry.available,
			read: u.entry.readAt !== null,
			queued: u.entry.queued,
			season: u.season
		};
	}
	if (u.kind === 'split') {
		const read = u.entry.readAt !== null;
		const numbers = u.added.map((t) => formatNumber(t.number)).join(' and ');
		return {
			variant: 'split',
			yours: formatNumber(u.entry.number),
			theirs: u.added.map((t) => formatNumber(t.number)).join(' · '),
			status: `SPLIT · ${formatNumber(u.entry.number)} KEPT${u.entry.available ? ' WITH ITS FILE' : ''}`,
			detail: `${numbers} added${read ? ', read' : ', unread'}`,
			downloaded: u.entry.available,
			read,
			season: seasoned ? u.entry.season : null
		};
	}
	if (u.kind === 'added') {
		const n = u.candidate.number;
		return {
			variant: 'added',
			yours: '—',
			theirs: n >= 0 ? span(n, n, u.candidate.season, seasoned) : u.candidate.name || 'Unnumbered',
			status: u.read ? 'ADDED · READ' : 'ADDED · UNREAD',
			read: u.read,
			season: seasoned ? u.candidate.season : null
		};
	}
	return {
		variant: 'untaken',
		yours: '—',
		theirs: span(u.candidate.number, u.candidate.number, u.candidate.season, seasoned),
		status: `NOT TAKEN · ${
			u.reason === 'before'
				? 'BEFORE YOURS'
				: u.reason === 'after'
					? 'AFTER YOURS'
					: 'ANOTHER SEASON'
		}`,
		season: seasoned ? u.candidate.season : null
	};
}

/**
 * Fold runs of consecutive rows of one kind into one, except the row reading
 * is at and every odd row, which stays its own so it is seen. "1 – 9" with
 * "9 MATCH" is what the design draws; a kept extra or a split is never
 * folded into its neighbours.
 */
function foldRows(units: Unit[], all: MoveRow[], seasoned: boolean, from: string): MoveRow[] {
	const out: MoveRow[] = [];
	let i = 0;
	while (i < units.length) {
		const u = units[i];
		if (u.kind === 'split' || (all[i].here ?? false)) {
			out.push(all[i]);
			i++;
			continue;
		}
		// A run of the same kind, consecutive in number (and season).
		let j = i + 1;
		const [season] = unitKey(u, seasoned);
		while (j < units.length) {
			const v = units[j];
			if (v.kind !== u.kind || all[j].here) break;
			const [s2] = unitKey(v, seasoned);
			if (s2 !== season) break;
			if (u.kind === 'match' && v.kind === 'match') {
				if (v.at !== (units[j - 1] as Extract<Unit, { kind: 'match' }>).at + 1) break;
			} else if (u.kind === 'kept' && v.kind === 'kept') {
				if (v.at !== (units[j - 1] as Extract<Unit, { kind: 'kept' }>).at + 1) break;
			} else if (u.kind === 'added' && v.kind === 'added') {
				if (v.at !== (units[j - 1] as Extract<Unit, { kind: 'added' }>).at + 1) break;
			} else if (u.kind === 'untaken' && v.kind === 'untaken') {
				if (v.reason !== (u as Extract<Unit, { kind: 'untaken' }>).reason) break;
			}
			j++;
		}
		if (j - i < 2) {
			out.push(all[i]);
			i++;
			continue;
		}
		out.push(runRow(units.slice(i, j), all.slice(i, j), seasoned, from));
		i = j;
	}
	return out;
}

function runRow(units: Unit[], rows: MoveRow[], seasoned: boolean, from: string): MoveRow {
	const first = units[0];
	const last = units[units.length - 1];
	const number = (u: Unit) =>
		u.kind === 'match' || u.kind === 'kept'
			? { number: u.entry.number, season: seasoned ? u.season : null }
			: u.kind === 'added' || u.kind === 'untaken'
				? { number: u.candidate.number, season: seasoned ? u.candidate.season : null }
				: { number: 0, season: null };
	const a = number(first);
	const b = number(last);
	const yours = first.kind === 'added' ? '—' : span(a.number, b.number, a.season, seasoned);
	const theirs = last.kind === 'kept' ? '—' : span(a.number, b.number, a.season, seasoned);
	if (first.kind === 'match') {
		const read = rows.filter((r) => r.read).length;
		const queued = rows.filter((r) => r.queued).length;
		const here = rows.some((r) => r.here);
		return {
			variant: 'match',
			yours,
			theirs,
			status: `${rows.length} MATCH${here ? ' · READING CARRIES' : ''}${read === rows.length ? ' · READ' : read ? ` · ${read} READ` : ''}${queued ? ` · ${queued} QUEUED` : ''}`,
			read: read === rows.length,
			queued: queued === rows.length,
			season: a.season
		};
	}
	if (first.kind === 'kept') {
		return {
			variant: 'kept',
			yours,
			theirs: '—',
			status: `${rows.length} KEPT FROM ${from.toUpperCase()}`,
			season: a.season
		};
	}
	if (first.kind === 'added') {
		return {
			variant: 'added',
			yours: '—',
			theirs,
			status: `${rows.length} ADDED · NOT DOWNLOADED`,
			read: rows.every((r) => r.read),
			season: a.season
		};
	}
	const u = first as Extract<Unit, { kind: 'untaken' }>;
	return {
		variant: 'untaken',
		yours: '—',
		theirs,
		status: `NOT TAKEN · ${u.reason === 'before' ? 'BEFORE YOURS' : u.reason === 'after' ? 'AFTER YOURS' : 'ANOTHER SEASON'}`,
		season: a.season
	};
}

/** The numbers a queued chapter that will leave the queue has: no partner on the new source. */
export function queueCounts(
	yours: MoveEntry[],
	plan: MovePlan
): { queued: number; moving: number; dropping: number } {
	const matched = new Set(plan.matches.map((m) => m.entry.id));
	const queued = yours.filter((e) => e.queued);
	return {
		queued: queued.length,
		moving: queued.filter((e) => matched.has(e.id)).length,
		dropping: queued.filter((e) => !matched.has(e.id)).length
	};
}

/** "ch. 1 – 25", "ch. 1" and "25", for the summary lines. */
function numberList(numbers: number[]): string {
	if (numbers.length === 0) return '';
	if (numbers.length === 1) return `ch. ${formatNumber(numbers[0])}`;
	const sorted = [...numbers].sort((a, b) => a - b);
	return `ch. ${formatNumber(sorted[0])} and ${formatNumber(sorted[sorted.length - 1])}`;
}

export type MoveSummaryRow = {
	key: 'chapters' | 'reading' | 'files' | 'follow' | 'queue' | 'rest';
	label: string;
	a: string;
	b: string;
	status: 'MOVES' | 'KEPT' | 'UNCHANGED';
};

export type MoveSummaryContext = {
	kind: MoveKind;
	/** The old source's name. */
	from: string;
	/** The new source's name. */
	to: string;
	/** FOLLOW as it stands. */
	follow: boolean;
	/** The whole series, for reading and the queue. */
	yours: MoveEntry[];
	/** The series' own season, where it has one (anime): "STILL SEASON 3". */
	season?: number | null;
};

/**
 * WHAT THE MOVE DOES, in the design's own rows: CHAPTERS, READING, FILES,
 * FOLLOW, QUEUE, THE REST. Every line is derived from the map, so nothing
 * here can promise a count the move won't deliver.
 */
export function moveSummary(plan: MovePlan, ctx: MoveSummaryContext): MoveSummaryRow[] {
	const video = movesVideo(ctx.kind);
	// EPISODE or CHAPTER: the map kind's own unit, spelled out.
	const noun = kindFacts(ctx.kind).unit.long;
	const nouns = `${noun}S`;

	const downloaded = ctx.yours.filter((e) => e.available);
	const dlNumbers = downloaded.map((e) => e.number);
	const read = ctx.yours.filter((e) => e.readAt !== null);
	const current = ctx.yours
		.filter((e) => e.readAt === null && e.lastOpenedAt !== null)
		.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
	const through = read.length
		? `${video ? 'Watched' : 'Read'} through ${video ? 'ep.' : 'ch.'} ${formatNumber(read[read.length - 1].number)}`
		: '';
	const where = current
		? video
			? `at ${clock(current.lastPosition ?? 0)} in ep. ${formatNumber(current.number)}`
			: `on p. ${(current.lastPosition ?? 0) + 1} of ch. ${formatNumber(current.number)}`
		: '';
	const reading = [through, where].filter(Boolean).join(', ');
	const splitCarry = plan.splits
		.filter((s) => s.from.readAt !== null)
		.map(
			(s) =>
				`${formatNumber(s.from.number)}'S READ MARK GOES TO ${s.to.map((t) => formatNumber(t.number)).join(' AND ')}`
		)
		.join(' · ');
	const carries = [read.length || current ? 'CARRIES BY NUMBER' : 'NOTHING TO CARRY', splitCarry]
		.filter(Boolean)
		.join(' · ');

	const queued = queueCounts(ctx.yours, plan);
	const queueNumbers = ctx.yours.filter((e) => e.queued).map((e) => e.number);
	const queueA = queued.queued
		? `${queued.queued} queued, ${numberList(queueNumbers)}`
		: 'Nothing queued';
	const queueB = queued.dropping
		? `${queued.dropping} HAS NO PARTNER · LEAVES THE QUEUE`
		: queued.moving
			? `FETCHED FROM ${ctx.to.toUpperCase()}`
			: 'NOTHING WAITING';

	const addedText =
		plan.added.length + plan.readAdded.length > 0
			? ` · THE ${plan.added.length + plan.readAdded.length} ADDED AREN'T DOWNLOADED`
			: '';

	return [
		{
			key: 'chapters',
			label: video ? 'EPISODES' : 'CHAPTERS',
			a: [
				`${plan.matches.length} match by number`,
				plan.kept.length ? `${plan.kept.length} kept from ${ctx.from}` : '',
				plan.added.length + plan.readAdded.length
					? `${plan.added.length + plan.readAdded.length} added`
					: ''
			]
				.filter(Boolean)
				.join(' · '),
			b: `${plan.matches.length + plan.kept.length + plan.added.length + plan.readAdded.length} IN ALL AFTER THE MOVE${addedText}`,
			status: 'MOVES'
		},
		{
			key: 'reading',
			label: video ? 'WATCHING' : 'READING',
			a: reading || 'Nothing read yet',
			b: carries,
			status: 'MOVES'
		},
		{
			key: 'files',
			label: 'FILES',
			a: downloaded.length
				? `${downloaded.length} downloaded, ${video ? 'ep.' : 'ch.'} ${
						dlNumbers.length === 1
							? formatNumber(dlNumbers[0])
							: `${formatNumber(Math.min(...dlNumbers))} – ${formatNumber(Math.max(...dlNumbers))}`
					}`
				: 'Nothing downloaded',
			b: 'KEPT AS THEY ARE · MOVE DOWNLOADS NOTHING',
			status: 'KEPT'
		},
		{
			key: 'follow',
			label: 'FOLLOW',
			a: ctx.follow ? 'Following' : 'Not followed',
			b: ctx.follow
				? `NEW ${nouns} COME FROM ${ctx.to.toUpperCase()}`
				: 'NOT FOLLOWED, AND STAYS SO',
			status: ctx.follow ? 'MOVES' : 'UNCHANGED'
		},
		{
			key: 'queue',
			label: 'QUEUE',
			a: queueA,
			b: queueB,
			status: queued.queued ? 'MOVES' : 'UNCHANGED'
		},
		{
			key: 'rest',
			label: 'THE REST',
			a: video
				? 'Title, cover, rating, FAV, shelves, tags, link, season'
				: 'Title, cover, rating, FAV, shelves, tags, link, notes',
			b:
				video && ctx.season != null
					? `THE SAME SERIES · STILL SEASON ${ctx.season}`
					: 'THE SAME SERIES',
			status: 'UNCHANGED'
		}
	] satisfies MoveSummaryRow[];
}

/**
 * The band's one line after the move: "6 CHAPTERS ADDED, NOT DOWNLOADED ·
 * 2 KEPT FROM ASURA SCANS". It says what changed and nothing it didn't.
 */
export function movedDetail(plan: MovePlan, from: string, kind: MoveKind): string {
	const parts: string[] = [];
	const added = plan.added.length + plan.readAdded.length;
	if (added)
		parts.push(
			`${added} ${kindFacts(kind).unit.long}${added === 1 ? '' : 'S'} ADDED, NOT DOWNLOADED`
		);
	if (plan.kept.length) parts.push(`${plan.kept.length} KEPT FROM ${from.toUpperCase()}`);
	return parts.join(' · ') || 'NOTHING ADDED OR KEPT';
}
