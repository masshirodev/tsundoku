/**
 * Catalogue links, the pure part (doc/LINKS.md): what makes an AniList match
 * sure, reading a pasted link, a catalogue's score as a rating, and the words
 * the review shows beside each candidate. No database, no network.
 */

import { anilistType, kindFacts, type KindFacts } from './kinds.ts';
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
	/** 'MANGA', 'NOVEL', 'ONE_SHOT', or an anime's 'TV', 'MOVIE'… (AniList's format). */
	format: string;
	/** 'JP', 'KR', 'CN', 'TW'. */
	country: string;
	year: number | null;
	chapters: number | null;
	volumes: number | null;
	/** An anime's episodes; null for anything else. */
	episodes: number | null;
	/** An anime's broadcast season ('FALL'), and the year it aired in. */
	season: string | null;
	seasonYear: number | null;
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

/**
 * The titles a sure match may equal: each as written, cleaned (`cleanTitle`),
 * and what its brackets hold, plus the title the owner typed (`query`), which
 * is the owner's choice of title and counts as one of the series' too. Shared
 * by the automatic pass and the review's EXACT TITLE chip, so both call the
 * same title exact.
 */
export const matchTitles = (titles: string[], query?: string | null): string[] => [
	...new Set(
		(query ? [...titles, query] : titles).flatMap((t) => [t, cleanTitle(t), ...bracketed(t)])
	)
];

/**
 * Whether a kind is listed by AniList and MAL as anime, a season at a time:
 * the registry's own answer (`anilistType`, kinds.ts), which is what decides
 * that its link, search and send are a season's (c240) and which pair of
 * catalogues a MAL id can be in (`family`). Asked of the registry rather than
 * spelled against a kind's name, so a new kind that airs needs no change here;
 * a kind outside AniList's catalogue (`anilistType` refuses one) is not anime.
 */
export const isAnime = (kind: Kind | null | undefined): boolean =>
	!!kind && kindFacts(kind).catalogue.provider === 'anilist' && anilistType(kind) === 'ANIME';

/**
 * The season a form field or a URL parameter names, or none. Absent or empty
 * is no season -- "every season" to UNLINK, "the open season" to the review --
 * and never season 0, which is a real one (a flat list): `Number(null)` and
 * `Number('')` are both 0, so neither may read the field (c240).
 */
export function seasonNamed(raw: unknown): number | undefined {
	if (raw === null || raw === undefined || String(raw) === '') return undefined;
	const n = Number(raw);
	return Number.isInteger(n) ? n : undefined;
}

/** The AniList formats an anime is (doc/LINKS.md, "A novel never matches a comic"). */
export const ANIME_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'] as const;

/** The kind a candidate would be here, from its format and country. */
export function candidateKind(c: Pick<Candidate, 'format' | 'country'>): Kind | null {
	if (c.format === 'NOVEL') return 'novel';
	if ((ANIME_FORMATS as readonly string[]).includes(c.format)) return 'anime';
	if (c.format !== 'MANGA' && c.format !== 'ONE_SHOT') return null;
	return c.country === 'KR' || c.country === 'CN' || c.country === 'TW' ? 'manhwa' : 'manga';
}

/**
 * Whether a candidate of [candidate] can be a series of [series]'s own entry
 * (doc/LINKS.md, "A novel never matches a comic"): manga and manhwa are one
 * kind to AniList, a novel is another work under the same title, and an anime
 * is another work again. The list is the registry's `matches` (doc/KINDS.md;
 * card c301), so a kind added there says who it may link to. Anything of an
 * unknown format fits nothing.
 */
export function sameKind(series: Kind, candidate: Kind | null): boolean {
	if (candidate === null) return false;
	const facts: KindFacts = kindFacts(series);
	return facts.matches.includes(candidate);
}

/** The year a title names in brackets: "Ranma ½ (2024)" → 2024. */
export function yearIn(title: string): number | null {
	const m = /[([{【]\s*((?:19|20)\d{2})\s*[)\]}】]/.exec(title);
	return m ? Number(m[1]) : null;
}

/** The year the series' own titles name, if any: what a season or year tie is broken on. */
export function seriesYear(titles: string[]): number | null {
	for (const t of titles) {
		const y = yearIn(t);
		if (y !== null) return y;
	}
	return null;
}

/**
 * The one sure link among a search's results, or null. Exact on a title, and
 * of the same kind (a manhwa and its novel share a title more often than
 * not, and an anime is never its manga). Two candidates of the same kind are
 * no sure link, unless one names the series' own year ("Ranma ½ (2024)",
 * where AniList holds the 1989 series and the 2024 one under one title).
 */
export function sureMatch(
	seriesTitles: string[],
	kind: Kind,
	found: Candidate[]
): Candidate | null {
	const exact = found.filter((c) => isExact(seriesTitles, c));
	const fits = (c: Candidate) => sameKind(kind, candidateKind(c));
	if (exact.length === 1) return fits(exact[0]) ? exact[0] : null;
	const same = exact.filter(fits);
	if (same.length === 1) return same[0];
	const year = seriesYear(seriesTitles);
	if (year !== null) {
		const aged = same.filter((c) => (c.seasonYear ?? c.year) === year);
		if (aged.length === 1) return aged[0];
	}
	return null;
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
	// The crossing is a novel's to its comic's entry, and the other way round:
	// an anime's entry is another work, never a cover for one (c298).
	if (seriesKind === 'anime' || k === 'anime') return false;
	return (seriesKind === 'novel') !== (k === 'novel');
}

export type Pasted = { service: 'anilist' | 'mal'; id: number };

/**
 * A pasted link, read for its id and nothing else: `anilist.co/manga/171204`,
 * `myanimelist.net/manga/160388/Some_Title`, with or without the scheme. An
 * anime series reads `/anime/`, and only its own kind's path is accepted (a
 * manga link on an anime is another work). Anything else is null.
 */
export function parsePasted(text: string, kind: Kind = 'manga'): Pasted | null {
	const t = text.trim();
	const m =
		/^(?:https?:\/\/)?(?:www\.)?(anilist\.co|myanimelist\.net)\/(manga|anime)\/(\d+)(?:[/?#].*)?$/i.exec(
			t
		);
	if (!m) return null;
	const asAnime = anilistType(kind) === 'ANIME';
	if ((m[2].toLowerCase() === 'anime') !== asAnime) return null;
	const id = Number(m[3]);
	if (!Number.isSafeInteger(id) || id <= 0) return null;
	return { service: m[1].toLowerCase() === 'anilist.co' ? 'anilist' : 'mal', id };
}

/**
 * An entry's own page, on the path its kind lives under: AniList's `ANIME`
 * path for an anime and `MANGA` for everything else (the registry's
 * `catalogue.type`; doc/KINDS.md, card c301). MAL uses the same two words.
 */
export const anilistUrl = (id: number, kind: Kind = 'manga') =>
	`https://anilist.co/${anilistType(kind).toLowerCase()}/${id}`;
export const malUrl = (id: number, kind: Kind = 'manga') =>
	`https://myanimelist.net/${anilistType(kind).toLowerCase()}/${id}`;

/**
 * A link whose entry is the other kind: a manga's entry on an anime, or an
 * anime's on a manga (doc/LINKS.md). Such a link is flagged, never removed:
 * the owner may have meant it, and UNDO still takes it back. A novel across
 * to its comic is the deliberate cover-only link, not this.
 */
export function wrongKind(series: Kind, format: string): boolean {
	if (!format) return false;
	const k = candidateKind({ format, country: '' });
	return k !== null && !sameKind(series, k) && !coverOnly(series, format);
}

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
	const close = chaptersClose(c.chapters ?? c.episodes, series.chapters);
	const unit = series.kind === 'anime' ? 'EPISODES CLOSE' : 'CHAPTERS CLOSE';
	if (shared.length) parts.push(`SHARES ${shared.slice(0, 3).join(' · ').toUpperCase()}`);
	else parts.push('ANOTHER ENGLISH TITLE');
	if (sameKind && close) parts.push(`SAME KIND, ${unit}`);
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

/** A candidate's kind as the review names it: "MANHWA", "NOVEL", "ONE SHOT", "TV". */
export function formatLabel(c: Pick<Candidate, 'format' | 'country'>): string {
	if (c.format === 'ONE_SHOT') return 'ONE SHOT';
	const k = candidateKind(c);
	if (k === 'anime') return c.format.replace(/_/g, ' ');
	return (k ?? c.format.toLowerCase()).toUpperCase();
}

/** AniList's release status in the review's words. */
export function statusLabel(s: string): string {
	return s === 'NOT_YET_RELEASED' ? 'NOT YET OUT' : s.replace(/_/g, ' ');
}

export type Row = { label: string; value: string; agree: boolean };

/**
 * A candidate's rows in the review: FORMAT, YEAR, CHAPTERS, STATUS for a
 * comic or a novel; FORMAT, SEASON, EPISODES, STATUS for an anime. Where it
 * agrees with the series (the same kind, chapters or episodes within five,
 * the year the series' own title names) it says so, and the row is drawn
 * strong.
 */
export function candidateRows(
	series: { kind: Kind; chapters: number; titles?: string[] },
	c: Candidate
): Row[] {
	const sameKind = candidateKind(c) === series.kind;
	const close = chaptersClose(c.chapters ?? c.episodes, series.chapters);
	const rows: Row[] = [
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
	if (series.kind !== 'anime') return rows;
	const year = seriesYear(series.titles ?? []);
	const aired = c.seasonYear ?? c.year;
	return [
		rows[0],
		{
			label: 'SEASON',
			value: c.season
				? [statusLabel(c.season), aired ?? ''].filter(Boolean).join(' ')
				: aired
					? String(aired)
					: '—',
			agree: year !== null && aired === year
		},
		{
			label: 'EPISODES',
			value:
				c.episodes != null ? `${c.episodes}${close ? ` · THIS HAS ${series.chapters}` : ''}` : '—',
			agree: close
		},
		rows[3]
	];
}

/**
 * One season of an anime as the series screen's rows draw it (c240): its
 * link, its parts and what the last search found. Plain data, so the server's
 * `seriesSeasons` can hand it to the component as it is.
 */
export type SeasonRowLink = {
	anilistId: number | null;
	malId: number | null;
	title: string;
	via: string;
	format: string | null;
	episodes: number | null;
	year: number | null;
	resolvedAt: number | null;
};
export type SeasonRow = {
	season: number;
	from: number;
	to: number;
	count: number;
	aired: number;
	watched: number;
	link: SeasonRowLink | null;
	parts: { part: number; from: number; to: number; link: SeasonRowLink | null }[];
	candidates: number;
	searched: boolean;
	queued: boolean;
	/**
	 * What settled it, when something did: NONE OF THESE (`none`) or UNLINK
	 * (`unlinked`). No pass asks again either way, but the line says which
	 * (c240).
	 */
	decision: SeasonDecision | null;
	searchTitle: string;
};

/** A season settled without a link: the owner's NONE OF THESE, or an UNLINK. */
export type SeasonDecision = 'none' | 'unlinked';

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
		case 'relations':
			return 'FROM ANILIST’S RELATIONS';
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
		f.urlFailed
			? f.kind === 'anime'
				? 'ITS SOURCE’S COVER IS DEAD'
				: 'MIHON’S COVER URL IS DEAD'
			: '',
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
	// An Aniyomi series' picture is the engine's, not a Mihon backup's URL.
	if (k.startsWith('url:'))
		return {
			a: f.kind === 'anime' ? 'FROM THE SOURCE’S COVER' : 'FROM MIHON’S COVER URL',
			b: before
		};
	if (k.startsWith('page:'))
		return {
			a: `FIRST PAGE OF ${f.pageOf ?? 'THE FIRST CHAPTER'}`,
			b: f.linkCover ? 'THE LINK’S COVER DIDN’T LOAD' : why
		};
	return { a: 'NONE', b: why };
}
