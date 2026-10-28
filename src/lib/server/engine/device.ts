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
 * Which of a source's chapters each entry is, and which of the source's
 * chapters no entry is (new ones, for FOLLOW). In passes, each taking only
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
	title: string,
	local: LocalChapter[],
	source: SourceChapter[]
): { matched: Map<number, SourceChapter>; unmatched: SourceChapter[] } {
	const numbers = chapterNumbers(
		title,
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
