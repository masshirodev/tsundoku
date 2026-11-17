import { chapterNumbers, toNumber } from './chapter-number.ts';
import { chapterTitle, formatNumber, people, positions, statusOf } from './mihon-plan.ts';
import type { PlannedEntry, PlannedSeries, PlannedTag } from './plan.ts';
import type { NovelManifest } from './novel-book.ts';
import { novelKeyOf } from '../library/downloads.ts';

/**
 * A novel from an LNReader plugin as a series to write (doc/NOVELS.md): what
 * parseNovel answered, every chapter NOT DOWNLOADED. Pure. The chapters' file
 * and locator come when the downloader writes the novel's EPUB; until
 * then an entry is known by its path at the source, as a Mihon chapter is by
 * its URL, so the importer finds it again when the file arrives.
 */

export type LnChapter = {
	name: string;
	path: string;
	releaseTime?: string | null;
	chapterNumber?: number | null;
};

export type LnNovel = {
	name: string;
	path: string;
	cover?: string | null;
	author?: string | null;
	artist?: string | null;
	status?: string | null;
	genres?: string | null;
	summary?: string | null;
	chapters: LnChapter[];
};

/** A release time as a date, when it reads as one: plugins give ISO strings, mostly. */
export function releasedAt(t: string | null | undefined): number {
	if (!t) return 0;
	const ms = Date.parse(t);
	return Number.isFinite(ms) ? ms : 0;
}

/**
 * The chapters' numbers, in the source's order (oldest first, as LNReader
 * lists them). A number the plugin gave is kept; otherwise it's read from the
 * names as Mihon's are, and an unnumbered one gets -1.
 */
export function novelNumbers(title: string, chapters: LnChapter[]): number[] {
	// chapterNumbers reads newest first, as Mihon lists chapters.
	const newest = [...chapters].reverse().map((c) => ({
		name: c.name,
		number: typeof c.chapterNumber === 'number' && c.chapterNumber >= 0 ? c.chapterNumber : -1
	}));
	return chapterNumbers(title, newest)
		.map((n) => (n.chapter === null ? -1 : toNumber(n.chapter)))
		.reverse();
}

export function planNovel(
	n: LnNovel,
	source: { plugin: string; name: string },
	now: number
): PlannedSeries {
	const numbers = novelNumbers(n.name, n.chapters);
	const seen = new Set<string>();
	const rows: Omit<PlannedEntry, 'position'>[] = [];
	const order: { number: number; order: number }[] = [];
	n.chapters.forEach((c, i) => {
		// A plugin that lists a chapter twice: one entry, as the source has one.
		if (!c.path || seen.has(c.path)) return;
		seen.add(c.path);
		const number = numbers[i];
		order.push({ number, order: i });
		rows.push({
			label: number >= 0 ? `Ch. ${formatNumber(number)}` : c.name || 'Chapter',
			title: number >= 0 ? chapterTitle(c.name) : '',
			sourceUrl: c.path,
			available: false,
			file: '',
			bytes: 0,
			pageCount: 0,
			addedAt: releasedAt(c.releaseTime) || now,
			readAt: null,
			lastPosition: null,
			lastOpenedAt: null,
			history: null
		});
	});
	const pos = positions(order);
	const tags: PlannedTag[] = [];
	const add = (namespace: string, value: string) => {
		const v = value.trim();
		if (
			v &&
			!tags.some((t) => t.namespace === namespace && t.value.toLowerCase() === v.toLowerCase())
		)
			tags.push({ namespace, value: v });
	};
	for (const g of (n.genres ?? '').split(',')) add('genre', g.toLowerCase());
	for (const a of people(n.author ?? '')) add('author', a);
	for (const a of people(n.artist ?? '')) add('artist', a);
	add('source', source.name);
	return {
		originKey: novelKeyOf(source.plugin, n.path),
		source: 'lnreader',
		title: n.name.trim() || n.path,
		kind: 'novel',
		rating: 0,
		favourite: false,
		hidden: false,
		shelves: [],
		tags,
		description: (n.summary ?? '').trim(),
		status: statusOf(n.status ?? ''),
		direction: null,
		addedAt: now,
		sourceUrl: n.path,
		coverUrl: n.cover || undefined,
		path: '',
		entries: rows.map((r, i) => ({ ...r, position: pos[i] }))
	};
}

/**
 * A book tsundoku's device wrote (doc/NOVELS.md, "Downloading"),
 * as the series it belongs to: keyed `lnreader:<plugin>:<path>`, each entry
 * by its path at the source, as ADD made them. A chapter in the book is its
 * document; one the manifest names but the book doesn't hold stays NOT
 * DOWNLOADED. Places and labels are the ones tsundoku had when it wrote the
 * book, so a rescan moves nothing.
 */
export function planNovelBook(
	f: { dir: string; file: string; addedAt: number; sizes: Map<string, number> },
	m: NovelManifest
): PlannedSeries {
	return {
		originKey: novelKeyOf(m.plugin, m.path),
		source: 'lnreader',
		title: m.title.trim() || m.path,
		kind: 'novel',
		rating: 0,
		favourite: false,
		hidden: false,
		shelves: [],
		tags: m.tags,
		description: m.description,
		status: m.status,
		direction: null,
		addedAt: f.addedAt,
		sourceUrl: m.path,
		coverUrl: m.coverUrl || undefined,
		path: f.dir,
		entries: m.chapters.map((c) => {
			const inBook = c.href !== null && f.sizes.has(c.href);
			return {
				position: c.position,
				label: c.label,
				title: c.title,
				sourceUrl: c.path,
				available: inBook,
				file: inBook ? f.file : '',
				bytes: inBook ? (f.sizes.get(c.href!) ?? 0) : 0,
				pageCount: 0,
				locator: inBook ? c.href! : '',
				matter: '',
				addedAt: c.addedAt || f.addedAt,
				readAt: null,
				lastPosition: null,
				lastOpenedAt: null,
				history: null
			};
		})
	};
}
