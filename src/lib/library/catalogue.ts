/**
 * Catalogue links, the pure part (doc/LINKS.md): what makes an AniList match
 * sure, reading a pasted link, a catalogue's score as a rating, and the words
 * the review shows beside each candidate. No database, no network.
 */

import type { Kind } from './types.ts';
export type { Kind };

/** One AniList entry, as the review and the series screen need it. */
export type Candidate = {
	anilistId: number;
	malId: number | null;
	/** English if it has one, else romaji. */
	title: string;
	/** The other titles: romaji, native, synonyms. Never the one in `title`. */
	alts: string[];
	/** 'MANGA', 'NOVEL', 'ONE_SHOT' (AniList's format). */
	format: string;
	/** 'JP', 'KR', 'CN', 'TW'. */
	country: string;
	year: number | null;
	chapters: number | null;
	volumes: number | null;
	/** 'RELEASING', 'FINISHED', 'HIATUS', 'CANCELLED', 'NOT_YET_RELEASED'. */
	status: string;
	coverUrl: string;
};

/**
 * A title as compared: case, accents, punctuation and spacing are left out,
 * and so are curly quotes, which Mihon and AniList spell differently
 * ("Duke’s" / "Duke's"). CJK is kept as it is.
 */
export function normaliseTitle(t: string): string {
	return (
		t
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			// Hangul decomposes into its jamo; put the syllables back together.
			.normalize('NFC')
			.toLowerCase()
			.replace(/[’‘'`´]/g, '')
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim()
	);
}

const BRACKETS = /\s*[([{【][^)\]}】]*[)\]}】]/g;

/**
 * A title as AniList would know it: without what the files and sources add.
 * Measured on the owner's library (2026-09-24), the searches that found
 * nothing were mostly these:
 *
 * - brackets: "One Piece (Official Colored)", "Hero Killer (Beolkkul)";
 * - volumes and books: "The Apothecary Diaries: Volume 4", "Alya …, Vol. 1",
 *   "The Beginning After the End: Book 10: Retribution";
 * - chapter ranges: "Lord of the Mysteries: 1-1429", "Pick Me Up! c1-591";
 * - a zero-padded number: "The Beginning After The End 08";
 * - curly quotes, which AniList's search doesn't match: "Swordmaster’s";
 * - the kind: "SSS-Class Suicide Hunter Novel";
 * - and Mihon's "..." when it cut a long title short.
 */
export function cleanTitle(t: string): string {
	// AniList's search misses a curly apostrophe: "Swordmaster’s" finds nothing.
	let s = t.trim().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
	if (/(\.\.\.|…)$/.test(s)) {
		s = s.replace(/(\.\.\.|…)$/, '').trim();
		// The cut often leaves a dangling "and" or "of".
		s = s.replace(/[\s,:;–—-]+(and|of|the|a|to|in|with|for)$/i, '');
	}
	s = s.replace(BRACKETS, ' ');
	for (let i = 0; i < 4; i++) {
		const was = s;
		s = s
			.replace(/[\s,:;–—-]*\b(vol(ume)?|book|part|season)\.?\s*\d+\b.*$/i, '')
			.replace(/[\s,:;–—-]+c?\d+\s*[-–]\s*\d+$/i, '')
			.replace(/\s+0\d+$/, '')
			.replace(/\s+(light\s+novel|web\s+novel|novel|ln|wn)$/i, '')
			.replace(/[\s,:;–—-]+$/, '')
			.trim();
		if (s === was) break;
	}
	s = s.replace(/\s{2,}/g, ' ').trim();
	return s || t.trim();
}

/**
 * What to search AniList for, in order: the clean title, then, should that
 * find nothing, only the part before a subtitle ("Clevatess - The King of
 * Devil Beasts, …" → "Clevatess").
 */
export function searchTitles(t: string): string[] {
	const clean = cleanTitle(t);
	const short = clean.split(/\s*:\s+|\s+[-–—]\s+/)[0].trim();
	return short && short !== clean && short.length >= 3 ? [clean, short] : [clean];
}

/** The first of `searchTitles`: what the pass searches first. */
export const searchTitle = (t: string) => searchTitles(t)[0];

/** What's in a title's brackets, as more titles of the series ("Hero Killer (Beolkkul)"). */
export function bracketed(t: string): string[] {
	return [...t.matchAll(/[([{【]([^)\]}】]+)[)\]}】]/g)].map((m) => m[1].trim()).filter(Boolean);
}

/** Whether Mihon cut the title short: the review's hint says so. */
export function isCutShort(t: string): boolean {
	return /(\.\.\.|…)$/.test(t.trim());
}

/** Every title of a candidate: the one shown and all the others. */
export function titlesOf(c: Pick<Candidate, 'title' | 'alts'>): string[] {
	return [c.title, ...c.alts];
}

/**
 * A sure match: one of the candidate's titles equals one of the series'
 * after normalising. A title Mihon cut short never matches exactly; it goes
 * to the review.
 */
export function isExact(seriesTitles: string[], c: Pick<Candidate, 'title' | 'alts'>): boolean {
	const ours = new Set(
		seriesTitles
			.filter((t) => !isCutShort(t))
			.map(normaliseTitle)
			.filter((t) => t !== '')
	);
	return titlesOf(c).some((t) => ours.has(normaliseTitle(t)));
}

/** The kind a candidate would be here, from its format and country. */
export function candidateKind(c: Pick<Candidate, 'format' | 'country'>): Kind | null {
	if (c.format === 'NOVEL') return 'novel';
	if (c.format !== 'MANGA' && c.format !== 'ONE_SHOT') return null;
	return c.country === 'KR' || c.country === 'CN' || c.country === 'TW' ? 'manhwa' : 'manga';
}

/**
 * The one sure link among a search's results, or null. Exact on a title, and
 * of the same kind when more than one is exact (a manhwa and its novel share
 * a title more often than not). Two of the same kind is no sure link.
 */
export function sureMatch(
	seriesTitles: string[],
	kind: Kind,
	found: Candidate[]
): Candidate | null {
	const exact = found.filter((c) => isExact(seriesTitles, c));
	// Manga and manhwa are one kind to AniList (MANGA, told apart by country),
	// and Mihon's guess between them can be wrong; a novel against a comic is
	// another work under the same title.
	const fits = (c: Candidate) => {
		const k = candidateKind(c);
		return k === null || k === kind || (k !== 'novel' && kind !== 'novel');
	};
	if (exact.length === 1) return fits(exact[0]) ? exact[0] : null;
	const same = exact.filter((c) => candidateKind(c) === kind);
	return same.length === 1 ? same[0] : null;
}

/**
 * A link across kinds: a novel linked to its comic's entry, or a comic to its
 * novel's (the owner's call, 2026-09-24: AniList lacks many web novels, and
 * the comic's entry still has the cover and the details). Such a link is for
 * those only: a novel's chapter 300 isn't the manhwa's, so tracking never
 * sends progress through it, and it's never made without the owner.
 */
export function coverOnly(seriesKind: Kind, format: string): boolean {
	const k = candidateKind({ format, country: '' });
	if (k === null || !format) return false;
	return (seriesKind === 'novel') !== (k === 'novel');
}

export type Pasted = { service: 'anilist' | 'mal'; id: number };

/**
 * A pasted link, read for its id and nothing else: `anilist.co/manga/171204`,
 * `myanimelist.net/manga/160388/Some_Title`, with or without the scheme. An
 * anime link, or anything else, is null.
 */
export function parsePasted(text: string): Pasted | null {
	const t = text.trim();
	const m =
		/^(?:https?:\/\/)?(?:www\.)?(anilist\.co|myanimelist\.net)\/manga\/(\d+)(?:[/?#].*)?$/i.exec(t);
	if (!m) return null;
	const id = Number(m[2]);
	if (!Number.isSafeInteger(id) || id <= 0) return null;
	return { service: m[1].toLowerCase() === 'anilist.co' ? 'anilist' : 'mal', id };
}

export const anilistUrl = (id: number) => `https://anilist.co/manga/${id}`;
export const malUrl = (id: number) => `https://myanimelist.net/manga/${id}`;

/**
 * A catalogue's score as a rating here, for an unrated series when a link is
 * made (the owner's decision, Catalogue Links 1w). Both are out of 10 since
 * c67, so a whole score is the rating as it is, 9 -> 9. Another scale is read
 * as out of 10 and rounded to the nearest half-step: AniList's 100 is asked
 * for as POINT_10, so that's for a scale nobody sends yet. Any score at all is
 * at least 1, since 0 is unrated.
 */
export function scoreToRating(score: number, outOf = 10): number {
	if (!(score > 0) || !(outOf > 0)) return 0;
	return Math.min(10, Math.max(1, Math.round((score / outOf) * 10)));
}

/** The words that carry a title: none of the small ones every title has. */
const SMALL = new Set(
	'a an the of and or to in on at for with by from is was as my i me you your his her its our their be been who that this into'.split(
		' '
	)
);

function words(t: string): string[] {
	return normaliseTitle(t)
		.split(' ')
		.filter((w) => w.length > 1 && !SMALL.has(w));
}

/** The words a candidate shares with the series' titles, in the series' order. */
export function sharedWords(
	seriesTitles: string[],
	c: Pick<Candidate, 'title' | 'alts'>
): string[] {
	const theirs = new Set(titlesOf(c).flatMap(words));
	const out: string[] = [];
	for (const t of seriesTitles)
		for (const w of words(t)) if (theirs.has(w) && !out.includes(w)) out.push(w);
	return out;
}

/** Chapters close enough to be the same run: five either way. */
export const chaptersClose = (a: number | null, b: number | null) =>
	a !== null && b !== null && a > 0 && b > 0 && Math.abs(a - b) <= 5;

/**
 * The line under a candidate (Link Review 1b): why it might be the one, in
 * the review's words. Shared title words first; with none, it's under
 * another title, and the kind and chapters are what's left to go on.
 */
export function whyLine(
	series: { titles: string[]; kind: Kind; chapters: number },
	c: Candidate
): string {
	const parts: string[] = [];
	const shared = sharedWords(series.titles, c);
	const sameKind = candidateKind(c) === series.kind;
	const close = chaptersClose(c.chapters, series.chapters);
	if (shared.length) parts.push(`SHARES ${shared.slice(0, 3).join(' · ').toUpperCase()}`);
	else parts.push('ANOTHER ENGLISH TITLE');
	if (sameKind && close) parts.push('SAME KIND, CHAPTERS CLOSE');
	else if (sameKind && !shared.length) parts.push('SAME KIND');
	if (c.malId === null) parts.push('NOT ON MAL');
	if (coverOnly(series.kind, c.format))
		parts.unshift(
			series.kind === 'novel'
				? 'A COMIC · COVER ONLY, NEVER TRACKED'
				: 'A NOVEL · COVER ONLY, NEVER TRACKED'
		);
	return parts.join(' · ');
}

/** A candidate's kind as the review names it: "MANHWA", "NOVEL", "ONE SHOT". */
export function formatLabel(c: Pick<Candidate, 'format' | 'country'>): string {
	if (c.format === 'ONE_SHOT') return 'ONE SHOT';
	return (candidateKind(c) ?? c.format.toLowerCase()).toUpperCase();
}

/** AniList's release status in the review's words. */
export function statusLabel(s: string): string {
	return s === 'NOT_YET_RELEASED' ? 'NOT YET OUT' : s.replace(/_/g, ' ');
}

export type Row = { label: string; value: string; agree: boolean };

/**
 * A candidate's rows in the review: FORMAT, YEAR, CHAPTERS, STATUS. Where it
 * agrees with the series (the same kind, chapters within five) it says so,
 * and the row is drawn strong.
 */
export function candidateRows(series: { kind: Kind; chapters: number }, c: Candidate): Row[] {
	const sameKind = candidateKind(c) === series.kind;
	const close = chaptersClose(c.chapters, series.chapters);
	return [
		{
			label: 'FORMAT',
			value: sameKind ? `${formatLabel(c)} · SAME` : formatLabel(c),
			agree: sameKind
		},
		{ label: 'YEAR', value: c.year ? String(c.year) : '—', agree: false },
		{
			label: 'CHAPTERS',
			value:
				c.chapters !== null
					? `${c.chapters}${close ? ` · THIS HAS ${series.chapters}` : ''}`
					: c.volumes !== null
						? `${c.volumes} VOL.`
						: '—',
			agree: close
		},
		{ label: 'STATUS', value: c.status ? statusLabel(c.status) : '—', agree: false }
	];
}

/** "ANILIST 132215 · MAL 128830", or with no MAL entry just the first. */
export function idsLine(anilistId: number | null, malId: number | null): string {
	return [anilistId ? `ANILIST ${anilistId}` : '', malId ? `MAL ${malId}` : '']
		.filter(Boolean)
		.join(' · ');
}

/** Where a link came from, as the series screen's LINK row says it. */
export function viaLabel(via: string): string {
	switch (via) {
		case 'mihon':
			return 'FROM MIHON’S MAL TRACKER';
		case 'list':
			return 'FROM YOUR ANILIST LIST';
		case 'exact':
			return 'THE SAME TITLE ON ANILIST';
		case 'review':
			return 'CHOSEN IN THE REVIEW';
		case 'pasted':
			return 'PASTED';
		default:
			return '';
	}
}

/** What the COVER rows know about a series' cover (the review's and the series screen's). */
export type CoverFacts = {
	/** `series.cover_key`: what the thumbnail was made from, '' for none. */
	key: string;
	/** Mihon's backup gave a cover URL, and whether fetching it failed. */
	url: boolean;
	urlFailed: boolean;
	/** Entries with a file on disk. */
	downloaded: number;
	kind: Kind;
	/** Linked, and the link has a cover to offer. */
	linkCover: boolean;
	/** The label of the chapter whose first page it is ("CH. 1"), for a page cover. */
	pageOf?: string;
};

/**
 * The COVER row (Series Link 1k, Link Review's COVER): where the cover comes
 * from, and why the sources before it gave nothing. The order is
 * doc/COVERS.md's: chosen, a book's, the files, Mihon's URL, the link, a page.
 */
export function coverLines(f: CoverFacts): { a: string; b: string } {
	const why = [
		f.urlFailed ? 'MIHON’S COVER URL IS DEAD' : '',
		f.downloaded === 0 ? 'NOTHING DOWNLOADED' : '',
		f.kind === 'novel' && f.downloaded > 0 ? 'THE EPUB HAS NO IMAGE' : ''
	]
		.filter(Boolean)
		.join(' · ');
	const before = f.linkCover ? 'COMES BEFORE THE LINK’S' : '';
	const k = f.key;
	if (k.startsWith('link:')) return { a: 'FROM THE ANILIST LINK', b: why };
	if (k.startsWith('chosen:')) return { a: 'CHOSEN BY HAND', b: before };
	if (k.startsWith('book:')) return { a: 'ITS FIRST BOOK’S', b: before };
	if (k.startsWith('edition:')) return { a: 'THE OPENING EDITION’S', b: before };
	if (k.startsWith('file:')) return { a: 'FROM THE FILES', b: before };
	if (k.startsWith('epub:')) return { a: 'THE EPUB’S OWN', b: before };
	if (k.startsWith('url:')) return { a: 'FROM MIHON’S COVER URL', b: before };
	if (k.startsWith('page:'))
		return {
			a: `FIRST PAGE OF ${f.pageOf ?? 'THE FIRST CHAPTER'}`,
			b: f.linkCover ? 'THE LINK’S COVER DIDN’T LOAD' : why
		};
	return { a: 'NONE', b: why };
}
