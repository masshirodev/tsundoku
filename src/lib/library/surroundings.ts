import { runtimeWords, type TmdbCollection, type TmdbShowFacts } from './tmdb.ts';

/**
 * What surrounds a film or a show (card c990; doc/LINKS.md, "What surrounds
 * it"; the handoff's `Collection.dc.html` and `Show-Desk.dc.html` in
 * doc/handoffs/movies-shows/). Pure: the server hands it TMDB's cached facts
 * and what the library holds, and it says every row's words and cell. Nothing
 * here groups, adds or switches a source: a collection or a next season is an
 * offer (`GROUP →`, `FIND`, `NOT THIS`), never an automatic chain.
 *
 * The anime half of the same question is the relation cache's (c358,
 * `relations.ts`), unchanged: AniList needs no key, so anime keeps NEXT with
 * no setup at all.
 */

// ---- a show: which season a series is -----------------------------------------------------

/**
 * The season a source's title names: `Harbour Lights Season 3`, `… S2`,
 * `… 2nd Season`. A title that names none is null, which the show's heads read
 * as season 1, the season a show's first source entry almost always is (the
 * board's `SEASON 1 · Harbour Lights`). An episode code (`S02E05`) is not a
 * season title and is never read as one.
 */
export function titleSeason(title: string): number | null {
	const m =
		/\bseason\s*(\d{1,2})\b/i.exec(title) ??
		/\bs(\d{1,2})\b(?!\s*e\d)/i.exec(title) ??
		/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i.exec(title);
	if (!m) return null;
	const n = Number(m[1]);
	return n > 0 ? n : null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** `2026-11-03` as the screens say a day: `3 NOV`, with the year only when it is not this one's. */
export function dayWords(date: string | null, now: number): string {
	if (!date) return '';
	const [y, m, d] = date.split('-').map(Number);
	const year = new Date(now).getUTCFullYear();
	return `${d} ${MONTHS[m - 1]}${y !== year ? ` ${y}` : ''}`;
}

/** Whether a day has come, read in UTC as TMDB's dates are. */
const aired = (date: string | null, now: number) =>
	date !== null && Date.parse(`${date}T00:00:00Z`) <= now;

export type SeasonHead = {
	season: number;
	/** `SEASON 2 · 8 EP`, `… · THIS SERIES`, `… · TMDB · FROM 3 NOV`. */
	head: string;
	/** The library series' title, or TMDB's show name for a season not here. */
	title: string;
	state: 'this' | 'library' | 'missing';
	/** IN LIBRARY → opens that series; a missing season has no cell (FIND is the row's and the band's). */
	seriesId: number | null;
};

export type ShowView = {
	/** This series' season, and TMDB's count: `SEASON 3 OF 4`. */
	season: number;
	of: number;
	heads: SeasonHead[];
	/** The SEASONS row: `3 of 4 in the library`, `TMDB LISTS 4 · S4 NOT IN THE LIBRARY`, and FIND THE REST →. */
	row: { title: string; meta: string; findRest: boolean };
	/** SEASON 4 IS OUT: the first aired season past every one here, unless the owner said NOT THIS. */
	band: { season: number; title: string; meta: string } | null;
};

/**
 * A show's seasons as this series sees them. `held` is every library series
 * linked to the same TMDB show, by the season its title names; a season two
 * series claim is drawn as the first, by id, since the merge sheet is where
 * two of one season are settled (doc/WORKS.md).
 */
export function showView(o: {
	facts: TmdbShowFacts;
	showName: string;
	seriesId: number;
	seriesTitle: string;
	held: { seriesId: number; title: string }[];
	declined: Set<string>;
	now: number;
}): ShowView | null {
	const seasons = o.facts.seasons.filter((s) => s.episodes > 0 || aired(s.airDate, o.now));
	if (!seasons.length) return null;
	const own = titleSeason(o.seriesTitle) ?? 1;
	const bySeason = new Map<number, { seriesId: number; title: string }>();
	for (const h of [...o.held].sort((a, b) => a.seriesId - b.seriesId)) {
		const n = titleSeason(h.title) ?? 1;
		if (!bySeason.has(n)) bySeason.set(n, h);
	}
	bySeason.set(own, { seriesId: o.seriesId, title: o.seriesTitle });
	const heads: SeasonHead[] = seasons.map((s) => {
		const count = `SEASON ${s.season} · ${s.episodes} EP`;
		const here = bySeason.get(s.season);
		if (s.season === own)
			return {
				season: s.season,
				head: `${count} · THIS SERIES`,
				title: o.seriesTitle,
				state: 'this',
				seriesId: null
			};
		if (here)
			return {
				season: s.season,
				head: count,
				title: here.title,
				state: 'library',
				seriesId: here.seriesId
			};
		const from = dayWords(s.airDate, o.now);
		return {
			season: s.season,
			head: `${count} · TMDB${from ? ` · FROM ${from}` : ''}`,
			title: o.showName,
			state: 'missing',
			seriesId: null
		};
	});
	const missing = heads.filter((h) => h.state === 'missing');
	const inLibrary = heads.length - missing.length;
	const highest = Math.max(...heads.filter((h) => h.state !== 'missing').map((h) => h.season));
	const next = seasons.find(
		(s) =>
			s.season > highest &&
			!bySeason.has(s.season) &&
			aired(s.airDate, o.now) &&
			!o.declined.has(`season:${s.season}`)
	);
	return {
		season: own,
		of: seasons.length,
		heads,
		row: {
			title: `${inLibrary} of ${seasons.length} in the library`,
			meta: missing.length
				? `TMDB LISTS ${seasons.length} · ${missing.map((h) => `S${h.season}`).join(', ')} NOT IN THE LIBRARY`
				: `TMDB LISTS ${seasons.length} · ALL IN THE LIBRARY`,
			findRest: missing.length > 0
		},
		band: next
			? {
					season: next.season,
					title: `SEASON ${next.season} IS OUT · NOT IN YOUR LIBRARY`,
					meta: [
						`TMDB · ${next.episodes} EP`,
						next.airDate ? `FROM ${dayWords(next.airDate, o.now)}` : '',
						'NO SERIES HOLDS IT'
					]
						.filter(Boolean)
						.join(' · ')
				}
			: null
	};
}

// ---- a film: its collection ---------------------------------------------------------------

/** A collection part the library holds, as the row needs it. */
export type HeldFilm = {
	seriesId: number;
	watched: boolean;
	runtime: number | null;
	/** The Work it is in, if any (doc/WORKS.md). */
	workId: number | null;
};

export type CollectionRow = {
	key: number;
	/** `PART 2`, or `TMDB 2` once the film is in a Work (ORDER is the owner's there, not TMDB's). */
	tag: string;
	/** This film's tag is inverted. */
	on: boolean;
	title: string;
	meta: string;
	cell:
		| { label: 'IN LIBRARY →'; seriesId: number }
		| { label: 'FIND'; title: string }
		| { label: 'IN THE WORK' }
		| null;
};

export type CollectionItem =
	| { type: 'row'; row: CollectionRow }
	/** `↑ PARTS 1 – 4 · 3 IN LIBRARY · 1 NOT` with SHOW. */
	| { type: 'fold'; above: boolean; words: string; parts: number[] };

export type CollectionView =
	| {
			mode: 'parts';
			/** `01 — THE LONG FERRY COLLECTION`, and `PART 1 OF 3` on the right. */
			name: string;
			at: string;
			items: CollectionItem[];
			/** `2 OF 3 IN THE LIBRARY · NOT A WORK` with GROUP →, or the count alone. */
			foot: { words: string; group: boolean };
	  }
	| {
			mode: 'work';
			/** Folded as it loads: `THE LONG FERRY COLLECTION · ALL 3 IN THE WORK`, or `· 2 IN THE WORK`. */
			line: string;
			/** One fact a line, each with its own cell: never a second NEXT. */
			facts: CollectionRow[];
			/** Unfolded (SHOW): every part, tagged TMDB n, IN THE WORK where it is. */
			rows: CollectionRow[];
	  };

/** The part of a title after the collection's own name: `The Long Ferry: Ash` → `ASH`. */
export function partName(title: string, collection: string): string {
	const base = collection.replace(/\s+collection$/i, '').trim();
	const lower = title.toLowerCase();
	if (base && lower.startsWith(base.toLowerCase())) {
		const rest = title
			.slice(base.length)
			.replace(/^[\s:–—-]+/, '')
			.trim();
		if (rest) return rest.toUpperCase();
	}
	return title.toUpperCase();
}

const FOLD_AT = 6;

/**
 * A film's collection (Collection.dc.html). Every part in release order, this
 * film's tag inverted, so a prequel is simply the row above. Past six parts
 * the rest fold round this one, keeping the part before it and the two after
 * (board 2.3: of eight, at six, `↑ PARTS 1 – 4` then 5 to 8), and each fold
 * says how many it hides are in the library, so a gap is never out of sight.
 *
 * In a Work (board 2.4, 2.5) the Work row is the NEXT: the block folds to one
 * line, and says only what the Work does not, one fact a line.
 *
 * `held` is what the library holds **as the viewer may see it**: a hidden film
 * with reveal off is not in it, so the block never names one.
 */
export function collectionView(o: {
	collection: TmdbCollection;
	thisId: number;
	held: Map<number, HeldFilm>;
	/** This film's own Work, if any. */
	workId: number | null;
}): CollectionView | null {
	const parts = o.collection.parts;
	const at = parts.findIndex((p) => p.id === o.thisId);
	if (at < 0 || parts.length < 2) return null;
	const name = o.collection.name.toUpperCase();
	const metaOf = (p: (typeof parts)[number], h: HeldFilm | undefined) =>
		[
			p.year ? String(p.year) : '',
			h ? runtimeWords(h.runtime) : '',
			h ? (h.watched ? 'WATCHED' : 'NOT WATCHED') : ''
		]
			.filter(Boolean)
			.join(' · ');

	if (o.workId !== null) {
		const inWork = (id: number) => o.held.get(id)?.workId === o.workId;
		const rows: CollectionRow[] = parts.map((p, i) => {
			const h = o.held.get(p.id);
			const mine = p.id === o.thisId;
			return {
				key: p.id,
				tag: `TMDB ${i + 1}`,
				on: mine,
				title: p.title,
				meta: mine
					? `THIS FILM${p.year ? ` · ${p.year}` : ''}`
					: h
						? metaOf(p, h)
						: `${p.year ?? ''}`.trim(),
				cell: mine
					? null
					: inWork(p.id)
						? { label: 'IN THE WORK' }
						: h
							? { label: 'IN LIBRARY →', seriesId: h.seriesId }
							: { label: 'FIND', title: p.title }
			};
		});
		const count = parts.filter((p) => p.id === o.thisId || inWork(p.id)).length;
		const facts: CollectionRow[] = parts.flatMap((p, i): CollectionRow[] => {
			if (p.id === o.thisId || inWork(p.id)) return [];
			const h = o.held.get(p.id);
			const words = `PART ${i + 1} · ${partName(p.title, o.collection.name)}`;
			return [
				h
					? {
							key: p.id,
							tag: '',
							on: false,
							title: words,
							meta: 'IN THE LIBRARY · NOT IN THE WORK',
							cell: { label: 'IN LIBRARY →', seriesId: h.seriesId }
						}
					: {
							key: p.id,
							tag: '',
							on: false,
							title: words,
							meta: 'NOT IN THE LIBRARY',
							cell: { label: 'FIND', title: p.title }
						}
			];
		});
		return {
			mode: 'work',
			line: `${name} · ${count === parts.length ? `ALL ${count}` : count} IN THE WORK`,
			facts,
			rows
		};
	}

	const rowOf = (p: (typeof parts)[number], i: number): CollectionRow => {
		const h = o.held.get(p.id);
		const mine = p.id === o.thisId;
		return {
			key: p.id,
			tag: `PART ${i + 1}`,
			on: mine,
			title: p.title,
			meta: mine
				? `THIS FILM${p.year ? ` · ${p.year}` : ''}`
				: h
					? metaOf(p, h)
					: [p.year ? String(p.year) : '', 'NOT IN THE LIBRARY'].filter(Boolean).join(' · '),
			cell: mine
				? null
				: h
					? { label: 'IN LIBRARY →', seriesId: h.seriesId }
					: { label: 'FIND', title: p.title }
		};
	};
	const fold = (from: number, to: number, above: boolean): CollectionItem => {
		const list = parts.slice(from, to);
		const here = list.filter((p) => o.held.has(p.id)).length;
		const not = list.length - here;
		const span = list.length === 1 ? `PART ${from + 1}` : `PARTS ${from + 1} – ${to}`;
		return {
			type: 'fold',
			above,
			words: `${above ? '↑' : '↓'} ${span} · ${[here ? `${here} IN LIBRARY` : '', not ? `${not} NOT` : ''].filter(Boolean).join(' · ')}`,
			parts: list.map((p) => p.id)
		};
	};
	const items: CollectionItem[] = [];
	if (parts.length <= FOLD_AT)
		parts.forEach((p, i) => items.push({ type: 'row', row: rowOf(p, i) }));
	else {
		const first = Math.max(0, at - 1);
		const last = Math.min(parts.length, at + 3);
		if (first > 0) items.push(fold(0, first, true));
		for (let i = first; i < last; i++) items.push({ type: 'row', row: rowOf(parts[i], i) });
		if (last < parts.length) items.push(fold(last, parts.length, false));
	}
	const here = parts.filter((p) => p.id === o.thisId || o.held.has(p.id)).length;
	// GROUP → only with two or more parts here and none of them in a Work: a
	// part already in one is the owner's grouping, and the offer would undo it.
	const anyInWork = parts.some((p) => (o.held.get(p.id)?.workId ?? null) !== null);
	const group = here >= 2 && !anyInWork;
	return {
		mode: 'parts',
		name,
		at: `PART ${at + 1} OF ${parts.length}`,
		items,
		foot: {
			words: `${here} OF ${parts.length} IN THE LIBRARY${group ? ' · NOT A WORK' : ''}`,
			group
		}
	};
}
