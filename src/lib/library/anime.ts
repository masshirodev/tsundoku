import { currentEntry, formatBytes, formatNumber, type SeriesEntry } from './series.ts';

/**
 * Anime, the pure part (doc/ANIME.md; card c153): an anime series is
 * episodes, and an episode is a chapter with a duration and a position in
 * seconds instead of pages (Anime States, "Episodes for chapters"). The
 * series screen, the library's CONTINUE and the history read their words
 * from here; nothing here touches the database.
 */

/** What an episode has that a chapter doesn't (rung 47). */
export type Episode = {
	/** Seconds; null until a source or a file says. */
	durationS: number | null;
	/** The source's season; null for a flat list. */
	season: number | null;
	/** Its number within its season, as the source gives it; null when the position is the number. */
	number: number | null;
	note: '' | 'filler' | 'recap';
	/** Its 16:9 picture, as one of tsundoku's own URLs; '' for none. */
	thumb: string;
	/** Where the ending starts, from the source's timestamps. */
	endingAt: number | null;
};

type E = Pick<SeriesEntry, 'id' | 'number' | 'readAt' | 'lastPosition' | 'lastOpenedAt'> & {
	episode?: Episode | null;
};

/** "14:32", "1:02:03": a time on a clock, never negative. */
export function clock(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "24 MIN", "RECAP · 23 MIN", "FILLER"; '' when the source said nothing. */
export function episodeMeta(e: E): string {
	const parts: string[] = [];
	if (e.episode?.note) parts.push(e.episode.note.toUpperCase());
	const d = e.episode?.durationS;
	if (d) parts.push(`${Math.max(1, Math.round(d / 60))} MIN`);
	return parts.join(' · ');
}

/** An episode's own number: within its season, where the source numbers them so. */
export const episodeNumber = (e: E) => e.episode?.number ?? e.number;

/** "EP. 7", or "S2 EP. 7" where the series has seasons and [withSeason] asks. */
export function episodeLabel(e: E, withSeason = false): string {
	const ep = `EP. ${formatNumber(episodeNumber(e))}`;
	return withSeason && e.episode?.season != null ? `S${e.episode.season} ${ep}` : ep;
}

/** Seconds left of an episode part-watched, or null when it isn't (or its length isn't known). */
export function secondsLeft(e: E): number | null {
	const d = e.episode?.durationS;
	if (e.readAt !== null || e.lastPosition === null || !d) return null;
	return Math.max(0, d - e.lastPosition);
}

/**
 * Whether a position counts as watched (Anime Calls, "Resume"): past the
 * ending's start where the source gave one, otherwise in the last 3 %.
 */
export function isWatchedAt(position: number, durationS: number, endingAt: number | null): boolean {
	if (durationS <= 0) return false;
	if (endingAt !== null && endingAt > 0 && endingAt < durationS) return position >= endingAt;
	return position >= durationS * 0.97;
}

/**
 * An episode row's right-hand word (Anime States, 1a): WATCHED, "14:32
 * LEFT" for the one part-watched, its size when it's on the workstation,
 * NOT DOWNLOADED otherwise -- a fact, not a warning, since it streams.
 */
export function episodeStatus(
	e: E & Pick<SeriesEntry, 'available' | 'bytes'>,
	current: boolean
): string {
	if (e.readAt !== null) return 'WATCHED';
	const left = current ? secondsLeft(e) : null;
	if (left !== null) return `${clock(left)} LEFT`;
	if (e.available) return formatBytes(e.bytes) || 'DOWNLOADED';
	return 'NOT DOWNLOADED';
}

/** How far into a part-watched episode, 0-1, for its bar. */
export function watchedFraction(e: E): number {
	const d = e.episode?.durationS;
	if (!d || e.lastPosition === null) return 0;
	return Math.min(1, Math.max(0, e.lastPosition / d));
}

/** Whether the list has seasons at all: Aniyomi's flat list stays flat without them. */
export const hasSeasons = (entries: E[]) =>
	new Set(entries.map((e) => e.episode?.season ?? null).filter((s) => s !== null)).size > 0;

export type EpisodeRow<T extends E = SeriesEntry> =
	| { type: 'fold'; season: number; from: number; to: number; count: number }
	| { type: 'head'; season: number; from: number; to: number; watched: number; count: number }
	| { type: 'episode'; entry: T; current: boolean };

/**
 * The episode list (Anime States, 1a): grouped by season where the source
 * has seasons, each group headed "SEASON 2 · EP. 1 – 12". A season watched
 * through folds into one row ("↑ SEASON 1 · EP. 1 – 12", "12 WATCHED ·
 * SHOW") unless [expanded], as read chapters fold; the season being watched
 * never does. Without seasons it's one flat list, folded as nothing.
 */
export function episodeRows<T extends E>(
	entries: T[],
	opts: { expanded?: boolean; current?: T | null } = {}
): EpisodeRow<T>[] {
	const current = opts.current === undefined ? currentEntry(entries as never) : opts.current;
	const row = (e: T): EpisodeRow<T> => ({
		type: 'episode',
		entry: e,
		current: current !== null && (current as T).id === e.id
	});
	if (!hasSeasons(entries)) return entries.map(row);
	const groups: { season: number; items: T[] }[] = [];
	for (const e of entries) {
		const season = e.episode?.season ?? 0;
		const last = groups[groups.length - 1];
		if (last && last.season === season) last.items.push(e);
		else groups.push({ season, items: [e] });
	}
	const out: EpisodeRow<T>[] = [];
	for (const g of groups) {
		const from = episodeNumber(g.items[0]);
		const to = episodeNumber(g.items[g.items.length - 1]);
		const watched = g.items.filter((e) => e.readAt !== null).length;
		const holdsCurrent = current !== null && g.items.includes(current as T);
		if (!opts.expanded && watched === g.items.length && !holdsCurrent && g.items.length > 1)
			out.push({ type: 'fold', season: g.season, from, to, count: watched });
		else {
			out.push({ type: 'head', season: g.season, from, to, watched, count: g.items.length });
			out.push(...g.items.map(row));
		}
	}
	return out;
}

/** A season's own words: "SEASON 2 · EP. 1 – 12"; season 0 is the episodes the source gave none. */
export const seasonLabel = (season: number, from: number, to: number) =>
	`${season > 0 ? `SEASON ${season}` : 'OTHER'} · EP. ${formatNumber(from)}${to !== from ? ` – ${formatNumber(to)}` : ''}`;

/** The short tag in front of a season's line: "S3", "S1"; "ALL" for a list with no seasons. */
export const seasonTag = (season: number) => (season > 0 ? `S${season}` : 'ALL');

/**
 * One season of an anime series, as the LINK and TRACKING rows count it
 * (doc/TRACKING.md, "A link per season"; card c240). `season` is the
 * source's own number -- 0 for a flat list, which is one season to tsundoku
 * -- and `aired` is what a catalogue counts: whole numbered episodes, a
 * recap left out (S3's 14.5 is never sent).
 */
export type SeasonSpan = {
	season: number;
	from: number;
	to: number;
	/** Episodes in the list, recaps and half numbers included. */
	count: number;
	/** Episodes a catalogue counts: whole numbers, no recap. */
	aired: number;
	/** Watched here. */
	watched: number;
};

/** Whether an episode is one a catalogue numbers: a whole number, and not a recap. */
export const counted = (e: E) =>
	e.episode?.note !== 'recap' && Number.isInteger(episodeNumber(e)) && episodeNumber(e) > 0;

/** The seasons an episode list holds, in the order it holds them (season 0 is "no season given"). */
export function seasonsOf<E2 extends E>(entries: E2[]): SeasonSpan[] {
	const out: SeasonSpan[] = [];
	for (const e of entries) {
		const season = e.episode?.season ?? 0;
		const n = episodeNumber(e);
		const last = out[out.length - 1];
		if (!last || last.season !== season)
			out.push({
				season,
				from: n,
				to: n,
				count: 1,
				aired: counted(e) ? 1 : 0,
				watched: e.readAt !== null ? 1 : 0
			});
		else {
			last.to = n;
			last.count += 1;
			if (counted(e)) last.aired += 1;
			if (e.readAt !== null) last.watched += 1;
		}
	}
	return out;
}

/**
 * The season an anime's CONTINUE is in, or the one the screen opens on: the
 * part-watched episode's, the first season on a series not begun, the last
 * one watched through ("FINISHED opens its last season"). Null for no
 * episodes at all.
 */
export function openSeason<E2 extends E>(entries: E2[]): number | null {
	const seasons = seasonsOf(entries);
	if (!seasons.length) return null;
	const cur = currentEntry(entries as never) as E2 | null;
	if (!cur) return seasons[0].season;
	const season = cur.episode?.season ?? 0;
	if (seasons.some((s) => s.season === season)) return season;
	return seasons[seasons.length - 1].season;
}

/** An episode's own number in its season: the catalogue counts from 1 on its entry. */
export const episodeInSeason = (e: E) => episodeNumber(e);

/**
 * The furthest episode watched in one season, or within one part of it, as a
 * catalogue counts it: whole numbers only, recaps and half numbers passed
 * over (c240). 0 when nothing countable is read in the range.
 */
export function watchedReached<E2 extends E>(
	entries: E2[],
	o: { season: number; from?: number; to?: number } = { season: 0 }
): number {
	let top = 0;
	for (const e of entries) {
		if ((e.episode?.season ?? 0) !== o.season || e.readAt === null || !counted(e)) continue;
		const n = episodeInSeason(e);
		if (o.from !== undefined && n < o.from) continue;
		if (o.to !== undefined && n > o.to) continue;
		top = Math.max(top, n);
	}
	return top;
}

/** A part of a season, as the catalogue split it: `PART 1 · EP. 1 – 12`. */
export type PartSpan = { part: number; from: number; to: number };

/**
 * Where each linked part starts and ends in the season's own numbering: part
 * 2 begins after part 1's episode count, so the season's EP. 13 is part 2's
 * EP. 1 (the design's SAO S4, 12 + 11). A season with one part is 1..`of`.
 */
export function partsOf(
	parts: { part: number; episodes: number | null }[],
	of: number
): PartSpan[] {
	const out: PartSpan[] = [];
	let next = 1;
	for (const p of [...parts].sort((a, b) => a.part - b.part)) {
		const count = p.episodes && p.episodes > 0 ? p.episodes : Math.max(0, of - next + 1);
		if (count <= 0) continue;
		out.push({ part: p.part, from: next, to: next + count - 1 });
		next += count;
	}
	return out.length ? out : [{ part: 1, from: 1, to: of }];
}

/** Which part of a season an episode is in, and where the catalogue files it. */
export function partOf(parts: PartSpan[], n: number): { part: number; number: number } | null {
	for (const p of parts)
		if (n >= p.from && n <= p.to) return { part: p.part, number: n - p.from + 1 };
	return null;
}

/** `PART 1 · EP. 1 – 12 · PART 2 · EP. 13 – 23`, only when there are two parts. */
export function partsLabel(parts: PartSpan[]): string {
	if (parts.length < 2) return '';
	return parts
		.map((p) => `PART ${p.part} · EP. ${formatNumber(p.from)} – ${formatNumber(p.to)}`)
		.join(' · ');
}

/**
 * What FIND searches for a season: the series' own title for season 1 (or a
 * flat list), and the title with the source's season number after it for any
 * other. Nothing is invented: the source gave the series one title and its
 * episodes a season number, and that is what goes to AniList.
 */
export function seasonSearchTitle(seriesTitle: string, season: number): string {
	return season > 1 ? `${seriesTitle} Season ${season}` : seriesTitle;
}

export type SeasonRowPlan =
	| { type: 'line'; season: number }
	| { type: 'fold'; above: boolean; seasons: number[] }
	| { type: 'toggle'; seasons: number[]; expanded: boolean };

/**
 * How the LINK and TRACKING rows stack their seasons (Track Calls, "The
 * shape"): three seasons or fewer have a line each; more fold round the one
 * being watched, above and below, as the episode list does. SHOW opens both
 * at once, and a fold that would hold one season is drawn as that season's
 * line instead.
 */
export function seasonPlan(seasons: number[], current: number, expanded: boolean): SeasonRowPlan[] {
	if (seasons.length <= 3) return seasons.map((season) => ({ type: 'line', season }));
	if (expanded)
		return [
			{ type: 'toggle', seasons, expanded: true },
			...seasons.map((season): SeasonRowPlan => ({ type: 'line', season }))
		];
	const at = Math.max(0, seasons.indexOf(current));
	const above = seasons.slice(0, at);
	const below = seasons.slice(at + 1);
	const out: SeasonRowPlan[] = [];
	const fold = (list: number[], isAbove: boolean) => {
		if (!list.length) return;
		if (list.length === 1) out.push({ type: 'line', season: list[0] });
		else out.push({ type: 'fold', above: isAbove, seasons: list });
	};
	fold(above, true);
	out.push({ type: 'line', season: seasons[at] });
	fold(below, false);
	return out;
}

/** "24 · 18 WATCHED", the list head's count; "24 · NONE WATCHED" before any. */
export function episodeCount(entries: E[]): string {
	const watched = entries.filter((e) => e.readAt !== null).length;
	return `${entries.length} · ${watched ? `${watched} WATCHED` : 'NONE WATCHED'}`;
}

/** The series' count line: "24 EPISODES · 2 SEASONS · 18 WATCHED". */
export function seriesCountLine(entries: E[]): string {
	const seasons = new Set(entries.map((e) => e.episode?.season).filter((s) => s != null)).size;
	const watched = entries.filter((e) => e.readAt !== null).length;
	const parts = [`${entries.length} EPISODE${entries.length === 1 ? '' : 'S'}`];
	if (seasons > 0) parts.push(`${seasons} SEASON${seasons === 1 ? '' : 'S'}`);
	if (watched > 0) parts.push(`${watched} WATCHED`);
	return parts.join(' · ');
}

/**
 * CONTINUE for an anime series: "▶ CONTINUE · S2 · EP. 7 · 14:32 LEFT" on
 * the one part-watched, START on a series not begun ("EP. 1 · STREAMS" when
 * it has no file, since it plays from the source), WATCH AGAIN once every
 * episode is watched.
 */
export function animeContinue(entries: (E & Pick<SeriesEntry, 'available' | 'label'>)[]): {
	label: string;
	meta: string;
	short: string;
	entry: (E & Pick<SeriesEntry, 'available' | 'label'>) | null;
} {
	const cur = currentEntry(entries as never) as (typeof entries)[number] | null;
	const seasons = hasSeasons(entries);
	if (!cur) {
		const first = entries[0] ?? null;
		return {
			label: 'WATCH AGAIN',
			meta: first ? episodeLabel(first, seasons) : '',
			short: '',
			entry: first
		};
	}
	const started = entries.some((e) => e.readAt !== null || e.lastOpenedAt !== null);
	const where =
		seasons && cur.episode?.season != null
			? `S${cur.episode.season} · ${episodeLabel(cur)}`
			: episodeLabel(cur);
	const left = secondsLeft(cur);
	const meta =
		left !== null ? `${where} · ${clock(left)} LEFT` : cur.available ? where : `${where} · STREAMS`;
	return {
		label: started ? 'CONTINUE' : 'START',
		meta,
		short: `${episodeLabel(cur, seasons)}${left !== null ? ` · ${clock(left)} LEFT` : ''}`,
		entry: cur
	};
}

/**
 * Where watching got to, as the library's CONTINUE and the history say it:
 * "S2 EP. 7 · 14:32 LEFT", "EP. 3 · 9:28" (watched so far) when the length
 * isn't known, or just "EP. 3".
 */
export function watchingAt(e: E, withSeason: boolean, left = true): string {
	const label = episodeLabel(e, withSeason);
	if (e.lastPosition === null || e.readAt !== null) return label;
	const rest = left ? secondsLeft(e) : null;
	return rest !== null ? `${label} · ${clock(rest)} LEFT` : `${label} · ${clock(e.lastPosition)}`;
}

/** A day's episodes in the history: "EP. 3 → 5", or "EP. 3" for one. */
export function episodesSpan(from: number, to: number): string {
	return from === to
		? `EP. ${formatNumber(from)}`
		: `EP. ${formatNumber(from)} → ${formatNumber(to)}`;
}

/**
 * ALL N's sizes, from the source's bitrate (doc/ANIME.md): an episode's
 * bytes when it has a known length and a quality's bits a second. Always
 * ABOUT, since a stream's BANDWIDTH is a ceiling, not a measurement.
 */
export function aboutBytes(durationS: number | null, bitsPerSecond: number): number | null {
	if (!durationS || bitsPerSecond <= 0) return null;
	return Math.round((durationS * bitsPerSecond) / 8);
}

/**
 * ALL N's confirmation for an anime (Index Anime Series, confirm): the
 * episodes, their ABOUT size at the chosen height, where they go, and what
 * they wait behind. Sizes are always ABOUT, from the source's bitrate.
 */
export function animeConfirm(o: {
	entries: (E & Pick<SeriesEntry, 'id'>)[];
	ids: number[];
	elsewhere: number;
	/** One episode's size at the chosen height, when the source's bitrate says. */
	each: number | null;
	free: number | null;
	folder: string;
}): { title: string; lines: string[] } {
	const picked = o.entries.filter((e) => o.ids.includes(e.id));
	const n = picked.length;
	const seasons = [...new Set(picked.map((e) => e.episode?.season ?? null))];
	const span = picked.length
		? `EP. ${formatNumber(episodeNumber(picked[0]))}${n > 1 ? ` – ${formatNumber(episodeNumber(picked[n - 1]))}` : ''}`
		: '';
	const where = seasons.length === 1 && seasons[0] !== null ? ` · SEASON ${seasons[0]}` : '';
	return {
		title: `DOWNLOAD ${n} EPISODE${n === 1 ? '' : 'S'}?`,
		lines: [
			`${span}${where} · EVERY EPISODE WITH NO FILE`,
			o.each
				? `ABOUT ${formatBytes(o.each)} AN EPISODE · ${formatBytes(o.each * n)} IN ALL · FROM THE SOURCE'S BITRATE, SO ABOUT`
				: 'THE SIZE IS ASKED OF THE SOURCE…',
			`TO ${o.folder.toUpperCase()}${o.free !== null ? ` · ${formatBytes(o.free)} FREE` : ''}`,
			`AN EPISODE TAKES MINUTES${o.elsewhere ? ` · BEHIND ${o.elsewhere} OTHER${o.elsewhere === 1 ? '' : 'S'} IN THE QUEUE` : ''}`
		]
	};
}
