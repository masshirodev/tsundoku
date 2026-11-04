import type { Kind } from '../library/types.ts';
import type { MihonBackup } from './mihon-backup.ts';
import { categoryEffect, type MihonPlan } from './mihon-plan.ts';
import type { PlannedSeries } from './plan.ts';

/**
 * IMPORT A BACKUP's preview (c438, doc/IMPORT.md): what a backup holds,
 * worked out before anything is written. Pure: the server gathers the facts
 * about the library (what is here, which shelves exist, which sources an
 * extension provides) and this says what the file would do with them.
 *
 * The preview counts the file, which is in the owner's hand, hidden series
 * included: nothing on it says a series would be hidden (Main.dc.html,
 * "WORDS AND RULES").
 */

/** Which app a file came from. Only Mihon's is read today; the others say NOT YET. */
export type BackupApp = 'mihon' | 'aniyomi' | 'lnreader';

export const APP_NAMES: Record<BackupApp, string> = {
	mihon: 'MIHON',
	aniyomi: 'ANIYOMI',
	lnreader: 'LNREADER'
};

/**
 * What a backup's job is called on the band and in the log. A job with this
 * label counts series in `bytes_done`/`bytes_total`, not bytes (import/index.ts,
 * `Source.counts`).
 */
export const BACKUP_LABEL = 'MIHON BACKUP';

/** A source the file names: an extension provides it, a repository lists it, or neither. */
export type MissingSource = {
	id: string;
	name: string;
	/** Series of the file from it. */
	series: number;
	/** The extension an added repository lists for it, when one does. */
	found: { pkg: string; extension: string; repo: string } | null;
};

export type CategoryChip = {
	name: string;
	/** Series of the file in it (library series, not browsed or local ones). */
	series: number;
	/**
	 * What it becomes, ticked: a new shelf, more on a shelf of that name, or a
	 * rating (the importer's rating names, `categoryEffect`).
	 */
	effect: 'shelf' | 'adds' | 'rates';
	rating: number;
};

export type PreviewRow = {
	title: string;
	kind: Kind;
	source: string;
	sourceId: string;
	read: number;
	chapters: number;
	categories: string[];
	here: boolean;
	missing: boolean;
};

export type SameLibrary = {
	importId: number;
	at: number;
	/** In the file, not here. */
	fresh: number;
	/** In the file and here already. */
	here: number;
	/** Here, with chapters the file has read that are unread here. */
	newer: number;
	/** Brought by that import and gone from the file: they stay. */
	gone: number;
};

export type BackupPreview = {
	app: BackupApp;
	series: number;
	sources: number;
	kinds: { kind: Kind; series: number }[];
	withReading: number;
	chaptersRead: number;
	chapters: number;
	alreadyHere: number;
	newerReading: number;
	same: SameLibrary | null;
	missing: MissingSource[];
	categories: CategoryChip[];
	leftOut: { browsed: number; local: number; damaged: string[] };
	rows: PreviewRow[];
};

/** What the server knows about the library, for one file. */
export type LibraryFacts = {
	/**
	 * Series here by origin key, with the source URLs of their entries read
	 * here: "already here", and "newer reading" where the file has read more.
	 */
	here: Map<string, Set<string>>;
	/** Shelves by name, exactly as a shelf is found by the writer (`ensureShelf`). */
	shelves: Set<string>;
	/** Source ids an installed extension provides. */
	installed: Set<string>;
	/** What the added repositories list: an extension and the source ids it provides. */
	listings: { pkg: string; name: string; repo: string; sources: string[] }[];
	/** Earlier imports of the same app, newest first, with the keys of the series each brought. */
	earlier: { id: number; at: number; keys: Set<string> }[];
};

/** `mihon:<source id>:<url>`'s source id. */
export const sourceIdOf = (key: string): string => key.split(':')[1] ?? '';

/**
 * Which earlier import was the same library (c438's identity, decided alone
 * and written in doc/IMPORT.md, "The same library"): a backup carries no id
 * of its own, so a library is what it holds. The newest earlier import of the
 * same app that brought series, at least half of which are in this file, is
 * the same library. A friend's other phone, or someone else's backup, shares
 * few series and is not; a library that grew shares all of the old one's.
 */
export function sameLibraryAs(
	keys: Set<string>,
	earlier: LibraryFacts['earlier']
): LibraryFacts['earlier'][number] | null {
	for (const e of earlier) {
		if (e.keys.size === 0) continue;
		let shared = 0;
		for (const k of e.keys) if (keys.has(k)) shared += 1;
		if (shared * 2 >= e.keys.size) return e;
	}
	return null;
}

/** The planned series in a file whose source the importer reads as a library series. */
const isLibrary = (m: MihonBackup['manga'][number]) => m.favorite && m.source !== '0';

export function previewBackup(
	backup: MihonBackup,
	plan: MihonPlan,
	facts: LibraryFacts,
	damaged: string[] = []
): BackupPreview {
	const series = plan.series;
	const kinds = new Map<Kind, number>();
	for (const s of series) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);

	const readOf = (s: PlannedSeries) => s.entries.filter((e) => e.readAt !== null);
	const keys = new Set(series.map((s) => s.originKey));
	let alreadyHere = 0;
	let newerReading = 0;
	for (const s of series) {
		const readHere = facts.here.get(s.originKey);
		if (!readHere) continue;
		alreadyHere += 1;
		if (readOf(s).some((e) => !readHere.has(e.sourceUrl))) newerReading += 1;
	}

	const bySource = new Map<string, number>();
	for (const s of series) {
		const id = sourceIdOf(s.originKey);
		bySource.set(id, (bySource.get(id) ?? 0) + 1);
	}
	const missing: MissingSource[] = [...bySource]
		.filter(([id]) => !facts.installed.has(id))
		.map(([id, n]) => {
			const l = facts.listings.find((x) => x.sources.includes(id));
			return {
				id,
				name: backup.sources.get(id) ?? `Source ${id}`,
				series: n,
				found: l ? { pkg: l.pkg, extension: l.name, repo: l.repo } : null
			};
		})
		.sort((a, b) => Number(b.found !== null) - Number(a.found !== null) || b.series - a.series);

	const inLibrary = backup.manga.filter(isLibrary);
	const categories: CategoryChip[] = backup.categories
		.slice()
		.sort((a, b) => a.order - b.order)
		.map((c) => {
			const effect = categoryEffect(c.name);
			return {
				name: c.name,
				series: inLibrary.filter((m) => m.categories.includes(c.order)).length,
				effect:
					effect.rating > 0 ? 'rates' : facts.shelves.has(effect.shelf ?? '') ? 'adds' : 'shelf',
				rating: effect.rating
			};
		});

	const earlier = sameLibraryAs(keys, facts.earlier);
	const same: SameLibrary | null = earlier
		? {
				importId: earlier.id,
				at: earlier.at,
				fresh: series.length - alreadyHere,
				here: alreadyHere,
				newer: newerReading,
				gone: [...earlier.keys].filter((k) => !keys.has(k)).length
			}
		: null;

	const categoryNames = new Map(backup.categories.map((c) => [c.order, c.name]));
	const byKey = new Map(inLibrary.map((m) => [`mihon:${m.source}:${m.url}`, m]));
	const rows: PreviewRow[] = series.map((s) => {
		const id = sourceIdOf(s.originKey);
		const m = byKey.get(s.originKey);
		return {
			title: s.title,
			kind: s.kind,
			source: backup.sources.get(id) ?? '',
			sourceId: id,
			read: readOf(s).length,
			chapters: s.entries.length,
			categories: (m?.categories ?? [])
				.map((o) => categoryNames.get(o))
				.filter((n): n is string => !!n),
			here: facts.here.has(s.originKey),
			missing: !facts.installed.has(id)
		};
	});

	return {
		app: 'mihon',
		series: series.length,
		sources: bySource.size,
		kinds: [...kinds].map(([kind, n]) => ({ kind, series: n })).sort((a, b) => b.series - a.series),
		withReading: series.filter((s) => readOf(s).length > 0).length,
		chaptersRead: series.reduce((a, s) => a + readOf(s).length, 0),
		chapters: series.reduce((a, s) => a + s.entries.length, 0),
		alreadyHere,
		newerReading,
		same,
		missing,
		categories,
		leftOut: {
			browsed: backup.manga.filter((m) => !m.favorite && m.source !== '0').length,
			local: backup.manga.filter((m) => m.source === '0').length,
			damaged
		},
		rows
	};
}

/** SEE ALL's list: a search over titles and a tab per kind, 150 rows at a time. */
export const SEE_ALL_PAGE = 150;

export function seeAll(
	rows: PreviewRow[],
	opts: { query?: string; kind?: Kind | null; shown?: number }
): { rows: PreviewRow[]; matching: number } {
	const q = (opts.query ?? '').trim().toLowerCase();
	const matching = rows.filter(
		(r) => (!opts.kind || r.kind === opts.kind) && (q === '' || r.title.toLowerCase().includes(q))
	);
	return { rows: matching.slice(0, opts.shown ?? SEE_ALL_PAGE), matching: matching.length };
}

/**
 * The refused row's two lines (Import-File-States C, D): the word, then the
 * reason. The reason is the server's sentence, which starts with the file's
 * name; NOTHING TO BRING IN is a backup with an empty library, said as such.
 */
export function refusalLines(reason: string): { a: string; b: string } {
	const NOTHING = 'NOTHING TO BRING IN · ';
	if (reason.startsWith(NOTHING))
		return { a: 'NOTHING TO BRING IN', b: reason.slice(NOTHING.length) };
	if (/ OVER THE \d+ MB /.test(reason)) return { a: 'TOO LARGE TO BE A BACKUP', b: reason };
	if (/INTERRUPTED|GONE/.test(reason)) return { a: 'THE FILE DID NOT ARRIVE', b: reason };
	return { a: 'NOT A BACKUP TSUNDOKU READS', b: reason };
}

/** A file's size as the screens say it: 2.4 MB, 812 KB. */
export function sizeWords(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 2 NOV, in the viewer's own time. */
export const dayMonth = (at: number): string => {
	const d = new Date(at);
	return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/** 18:24, in the viewer's own time. */
export const clock = (at: number): string => {
	const d = new Date(at);
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** How long a run took: 1 MIN 48 S, 12 S. */
export function took(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	return s >= 60 ? `${Math.floor(s / 60)} MIN ${s % 60} S` : `${s} S`;
}

/** 1,234 */
export const n = (v: number): string => v.toLocaleString('en-US');
