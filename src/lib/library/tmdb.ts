import { cleanTitle, yearIn } from './catalogue.ts';

/**
 * What to search TMDB for, from the title a source gave (card c989;
 * doc/MOVIES-TV.md, "Decided"). A release site's title carries more than the
 * film: `Lupin [Hindi-English] 1080p WEB-DL x264`, `The Long Ferry (2024)
 * 2160p DUAL`, `Alchemy of Souls S2 720p ESub`. `cleanTitle` already takes the
 * brackets, a volume or a "Season 3", and a cut-short tail; this takes the
 * release-group words it does not, and the season number, which TMDB knows as
 * a season of the show rather than part of its title.
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
