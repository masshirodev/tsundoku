import {
	cleanTitle,
	matchTitles,
	normaliseTitle,
	sharedWords,
	yearIn,
	type Row
} from './catalogue.ts';

/**
 * TMDB, the pure half (card c989; doc/LINKS.md, "TMDB links"): what a film or
 * a show is as TMDB answers it, the query a source's title becomes, what makes
 * a match sure, and the words the review draws beside a candidate. No
 * database, no network: `server/tmdb.ts` is the client, `server/tmdb-links.ts`
 * the links.
 */

/** A film or a show as TMDB knows it, in tsundoku's terms. */
export type TmdbTitle = {
	id: number;
	media: 'movie' | 'tv';
	title: string;
	/** The title in its own language, when it differs: a match's alternative. */
	originalTitle: string;
	year: number | null;
	overview: string;
	/** A full image URL, or null when TMDB has no poster. */
	poster: string | null;
	/** A film's runtime in minutes; null for a show, and for a search result (only details carry it). */
	runtime: number | null;
	/** A show's season count; null for a film, and for a search result. */
	seasons: number | null;
	/** A film's collection, when it belongs to one: the sequels and prequels. */
	collection: { id: number; name: string } | null;
};

// ---- what surrounds an entry (card c990) ---------------------------------------------------

/** One of a show's seasons as TMDB lists it. Season 0 (specials) is never one of them. */
export type TmdbSeason = {
	season: number;
	episodes: number;
	/** `YYYY-MM-DD`, or null when TMDB has no date. */
	airDate: string | null;
	name: string;
};

/** A show's seasons, and what airs next while it is in production. */
export type TmdbShowFacts = {
	id: number;
	seasons: TmdbSeason[];
	inProduction: boolean;
	next: { season: number; episode: number; airDate: string | null } | null;
};

/** A film's collection, its parts in release order (undated last), as TMDB lists them. */
export type TmdbCollection = {
	id: number;
	name: string;
	parts: { id: number; title: string; year: number | null; date: string | null }[];
};

/**
 * What to search TMDB for, from the title a source gave. A release site's
 * title carries more than the film: `Lupin [Hindi-English] 1080p WEB-DL x264`,
 * `The Long Ferry (2024) 2160p DUAL`, `Alchemy of Souls S2 720p ESub`.
 * `cleanTitle` already takes the brackets, a volume or a "Season 3", and a
 * cut-short tail; this takes the release-group words it does not, and the
 * season number, which TMDB knows as a season of the show rather than part of
 * its title.
 *
 * The year is read from the **source** title before cleaning, since the
 * bracket that holds it is one `cleanTitle` removes. Nothing is guessed: no
 * year found is null, and a query that would come out empty falls back to the
 * title untouched, so the caller sees the source's own words rather than "".
 */

const RELEASE = [
	/\b(?:2160p|1080p|720p|480p|4k|uhd)\b/gi,
	/\b(?:web[- ]?dl|webrip|bluray|brrip|hdtv|dvdrip)\b/gi,
	/\b(?:hevc|avc|x264|x265|h\.?264|h\.?265)\b/gi,
	/\b(?:aac|ac3|ddp|eac3|dts)\s*\d(?:\.\d)?\b/gi,
	/\b(?:dual|multi|esubs?|hdr|10bit|proper|repack)\b/gi,
	/\b(?:s\d{1,2}|season\s*\d{1,2})\b/gi
];

export function tmdbQuery(sourceTitle: string): { query: string; year: number | null } {
	const year = yearIn(sourceTitle);
	let query = cleanTitle(sourceTitle);
	for (const token of RELEASE) query = query.replace(token, ' ');
	query = query
		.replace(/[-–—:|]+\s*$/, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
	return { query: query || sourceTitle.trim(), year };
}

/** A TMDB entry's titles: the English one shown, then its own language's when it differs. */
export const tmdbTitles = (c: Pick<TmdbTitle, 'title' | 'originalTitle'>): string[] =>
	[c.title, c.originalTitle].filter((t, i, all) => t !== '' && all.indexOf(t) === i);

/**
 * The titles a sure match may equal: the series' own (as `matchTitles` reads
 * them for AniList, cleaned and with their brackets) and each one's TMDB
 * query, so a release tail never stops an equal title from being equal.
 */
export const tmdbMatchTitles = (titles: string[]): string[] => [
	...new Set([...matchTitles(titles), ...titles.map((t) => tmdbQuery(t).query)])
];

/**
 * Release years and TMDB's dates disagree by one often enough (a festival
 * premiere, a December release dated by its country), so a year one either
 * way still agrees. Two years apart is another film.
 */
export const yearsAgree = (a: number | null, b: number | null): boolean =>
	a !== null && b !== null && Math.abs(a - b) <= 1;

/**
 * The one sure link among a search's results, or null: the AniList pass's
 * rule in TMDB's terms (doc/LINKS.md, "Sure"). One result whose title equals
 * one of the series' after normalising, and, when the source named a year,
 * of that year: a remake shares its title with the original, and the year is
 * what tells them apart. Several equal titles with no year to choose by are
 * no sure link; they go to the review.
 */
export function tmdbSure(
	seriesTitles: string[],
	year: number | null,
	found: TmdbTitle[]
): TmdbTitle | null {
	const ours = new Set(tmdbMatchTitles(seriesTitles).map(normaliseTitle).filter(Boolean));
	const exact = found.filter((c) => tmdbTitles(c).some((t) => ours.has(normaliseTitle(t))));
	if (year !== null) {
		const aged = exact.filter((c) => yearsAgree(c.year, year));
		return aged.length === 1 ? aged[0] : null;
	}
	return exact.length === 1 ? exact[0] : null;
}

/** A runtime in the screen's words: `1 H 58`, `45 MIN`. */
export function runtimeWords(minutes: number | null): string {
	if (minutes === null || !(minutes > 0)) return '';
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m} MIN`;
	return m === 0 ? `${h} H` : `${h} H ${String(m).padStart(2, '0')}`;
}

/** What the review calls a TMDB entry's kind. */
export const tmdbFormat = (media: TmdbTitle['media']): string => (media === 'tv' ? 'SHOW' : 'FILM');

/**
 * The line under a TMDB candidate (Link Review 1b's rule): the shared title
 * words, else that it is under another title, and the year when it agrees
 * with the one the source named.
 */
export function tmdbWhy(series: { titles: string[]; year: number | null }, c: TmdbTitle): string {
	const shared = sharedWords(series.titles, { title: c.title, alts: tmdbTitles(c).slice(1) });
	const parts = [
		shared.length
			? `SHARES ${shared.slice(0, 3).join(' · ').toUpperCase()}`
			: 'ANOTHER ENGLISH TITLE'
	];
	if (yearsAgree(c.year, series.year)) parts.push('SAME YEAR');
	return parts.join(' · ');
}

/**
 * A TMDB candidate's rows in the review: FORMAT, YEAR, then RUNTIME for a film
 * or SEASONS for a show (a search result carries neither, so `—` until the
 * entry is read). YEAR agrees, and is drawn strong, when the source named the
 * same year.
 */
export function tmdbRows(series: { year: number | null }, c: TmdbTitle): Row[] {
	const film = c.media === 'movie';
	return [
		{ label: 'FORMAT', value: `${tmdbFormat(c.media)} · SAME`, agree: true },
		{
			label: 'YEAR',
			value: c.year ? `${c.year}${yearsAgree(c.year, series.year) ? ' · SAME' : ''}` : '—',
			agree: yearsAgree(c.year, series.year)
		},
		film
			? { label: 'RUNTIME', value: runtimeWords(c.runtime) || '—', agree: false }
			: {
					label: 'SEASONS',
					value: c.seasons ? `${c.seasons}` : '—',
					agree: false
				}
	];
}

/** "TMDB 12345": the ids line a linked film or show shows. */
export const tmdbIdsLine = (id: number | null): string => (id ? `TMDB ${id}` : '');

/**
 * A pasted TMDB link, read for its kind and id and nothing else:
 * `themoviedb.org/movie/603-the-matrix`, `www.themoviedb.org/tv/1399`, with or
 * without the scheme. Anything else is null; whether its kind is the series'
 * is the workstation's check, which says so rather than reading another work.
 */
export function parseTmdbUrl(text: string): { media: 'movie' | 'tv'; id: number } | null {
	const m = /^(?:https?:\/\/)?(?:www\.)?themoviedb\.org\/(movie|tv)\/(\d+)(?:[-/?#].*)?$/i.exec(
		text.trim()
	);
	if (!m) return null;
	const id = Number(m[2]);
	if (!Number.isSafeInteger(id) || id <= 0) return null;
	return { media: m[1].toLowerCase() as 'movie' | 'tv', id };
}
