import { chapterNumbers, toNumber } from '../../import/chapter-number.ts';
import { mihonFolderName } from '../../import/mihon-plan.ts';
import { splitMemo } from './protocol.ts';

/**
 * tsundoku as a Mihon device (doc/DOWNLOADER.md, "The one decision"): where
 * its files go, what they're named, and which of a source's chapters each
 * entry is. Pure; the worker does the writing.
 */

export const TSUNDOKU_DEVICE = 'tsundoku';

/** `<Source> (<LANG>)`, the folder Mihon gives a source's downloads; the importer matches it by name. */
export const sourceDir = (sourceName: string, lang: string) =>
	`${sourceName} (${(lang || 'all').toUpperCase()})`;

/** A chapter's name as the backup carries it, so the importer's label and title come out as the entry's. */
export function chapterName(e: { label: string; title: string }): string {
	return e.title && e.title !== e.label ? `${e.label} - ${e.title}` : e.label;
}

/** Mihon's file name for a chapter, `<Scanlator>_<Chapter>`, made safe for any disk. */
export function chapterFile(e: { label: string; title: string; scanlator: string }): string {
	const name = chapterName(e);
	return `${mihonFolderName(e.scanlator ? `${e.scanlator}_${name}` : name)}.cbz`;
}

/**
 * The chapter's URL as a full address, for ComicInfo's `Web`: the parser
 * keeps only http(s) URLs, and a Mihon chapter URL is usually a path. The
 * importer matches it by its end, so the base is only there to make it one.
 */
export function absoluteUrl(url: string, baseUrl: string): string {
	if (/^https?:\/\//.test(url)) return url;
	try {
		return new URL(url, baseUrl || 'https://source.invalid/').toString();
	} catch {
		return `https://source.invalid/${url.replace(/^\/+/, '')}`;
	}
}

/** The backup's file name: the importer reads the newest by the stamp in it. */
export function backupName(at: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${TSUNDOKU_DEVICE}_${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}_${p(at.getHours())}-${p(at.getMinutes())}.tachibk`;
}

export type LocalChapter = { id: number; url: string; position: number; scanlator: string };
export type SourceChapter = {
	url: string;
	name: string;
	scanlator: string | null;
	chapter_number: number;
};

/**
 * Every name a series goes by: its title, then its alternative titles
 * (`alt_titles`, a JSON list of strings; a rename keeps the old name there,
 * c526). Anything that is not such a list is no names.
 */
export function namesOf(title: string, altTitles: string | null | undefined): string[] {
	let alts: unknown;
	try {
		alts = JSON.parse(altTitles || '[]');
	} catch {
		alts = [];
	}
	const rest = Array.isArray(alts) ? alts.filter((t): t is string => typeof t === 'string') : [];
	return [...new Set([title, ...rest].filter((t) => t.trim() !== ''))];
}

/**
 * `chapterNumbers` over a series known by several names (c555). It takes the
 * series' title out of each chapter's name before reading a number, so a
 * number in the title is not read as the chapter's. A source still names
 * its chapters by the title it gave the series ("Squad 100 2") after the
 * owner has renamed it, and with fewer than three chapters to compare
 * (one new chapter, as FOLLOW usually finds) the 100 was read: measured, so
 * every name is taken out, the longest first, so a name inside another
 * ("Mob" in "Mob Psycho 100") cannot break the longer one up.
 */
export function numbersUnderNames(
	names: readonly string[],
	chapters: { name: string; number: number }[]
) {
	const longest = [...names].sort((a, b) => b.length - a.length).map((n) => n.toLowerCase());
	const strip = (name: string) =>
		longest.reduce((n, t) => (t ? n.split(t).join('') : n), name.toLowerCase());
	return chapterNumbers(
		names[0] ?? '',
		chapters.map((c) => ({ name: strip(c.name), number: c.number }))
	);
}

/**
 * Which of a source's chapters each entry is, and which of the source's
 * chapters no entry is (new ones, for FOLLOW). `names` are the series' (its
 * title first, then the names it had: `namesOf`). In passes, each taking only
 * an unambiguous match, as the importer's `matchChapters` does:
 *
 * 1. the URL, memo split off: every source the spike checked but Toonily;
 * 2. the chapter number, recognized from the name (1.6 sources give -1),
 *    with the same scanlator: Toonily, whose extension moved every URL
 *    (doc/DOWNLOADER.md, "Keys"), and whose 126 series are keyed by the old;
 * 3. the chapter number alone, when only one chapter has it.
 *
 * An entry matched to nothing is left out: the source no longer lists it.
 */
export function matchSourceChapters(
	names: string | readonly string[],
	local: LocalChapter[],
	source: SourceChapter[]
): { matched: Map<number, SourceChapter>; unmatched: SourceChapter[] } {
	const numbers = numbersUnderNames(
		typeof names === 'string' ? [names] : names,
		source.map((c) => ({ name: c.name, number: c.chapter_number }))
	).map((n) => (n.chapter === null ? null : toNumber(n.chapter)));
	const keyed = source.map((c, i) => ({ c, url: splitMemo(c.url).url, number: numbers[i] }));
	const matched = new Map<number, SourceChapter>();
	const taken = new Set<number>();
	const pick = (e: LocalChapter, test: (k: (typeof keyed)[number]) => boolean) => {
		const hits = keyed.map((k, i) => [k, i] as const).filter(([k, i]) => !taken.has(i) && test(k));
		if (hits.length !== 1) return;
		taken.add(hits[0][1]);
		matched.set(e.id, hits[0][0].c);
	};
	const passes: ((e: LocalChapter) => (k: (typeof keyed)[number]) => boolean)[] = [
		(e) => (k) => k.url === e.url,
		(e) => (k) => k.number === e.position && (k.c.scanlator ?? '') === e.scanlator,
		(e) => (k) => k.number === e.position
	];
	for (const pass of passes) for (const e of local) if (!matched.has(e.id)) pick(e, pass(e));
	return { matched, unmatched: keyed.filter((_, i) => !taken.has(i)).map((k) => k.c) };
}
