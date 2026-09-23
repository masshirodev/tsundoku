import { entryDocs, planEntries, type Package, type TocPoint } from '../epub/epub.ts';
import type { PlannedSeries } from './plan.ts';

/**
 * An EPUB as a series (doc/IMPORT-EPUB.md): one book, kind `novel`, whose
 * table of contents entries are its entries. Pure; the disk side
 * (src/lib/server/import/epub.ts) reads the zip and hands over its parts.
 */

export type EpubFile = {
	/** Relative to the library folder: the series' identity across rescans. */
	relPath: string;
	/** The folder it's in, and its own name there. */
	dir: string;
	file: string;
	addedAt: number;
	/** Null when the file couldn't be read as an EPUB at all. */
	pkg: Package | null;
	toc: TocPoint[];
	/** Uncompressed size of each member, for each entry's share of the book. */
	sizes: Map<string, number>;
};

const stem = (file: string) => file.replace(/\.epub$/i, '');

export function planEpub(f: EpubFile): PlannedSeries {
	const pkg = f.pkg;
	const base = {
		originKey: `epub:${f.relPath}`,
		source: 'epub',
		title: pkg?.title || stem(f.file),
		kind: 'novel' as const,
		rating: 0 as const,
		favourite: false,
		hidden: false,
		shelves: [],
		tags: (pkg?.creators ?? []).map((c) => ({ namespace: 'author', value: c })),
		description: '',
		status: '',
		direction: null,
		addedAt: f.addedAt,
		sourceUrl: '',
		path: f.dir
	};
	const entries = pkg ? planEntries(f.toc, pkg.spine) : [];
	// No usable contents (or no package at all): one entry for the whole
	// file, so the book is listed and the reader can say what's wrong with it.
	if (!pkg || entries.length === 0)
		return {
			...base,
			entries: [
				{
					position: 1,
					label: 'Book',
					title: '',
					sourceUrl: `epub:${pkg?.spine[0]?.href ?? ''}`,
					locator: pkg?.spine[0]?.href ?? '',
					matter: '',
					available: true,
					file: f.file,
					bytes: [...f.sizes.values()].reduce((a, b) => a + b, 0),
					pageCount: 0,
					addedAt: f.addedAt,
					readAt: null,
					lastPosition: null,
					lastOpenedAt: null,
					history: null
				}
			]
		};
	const locators = entries.map((e) => e.locator);
	return {
		...base,
		entries: entries.map((e, i) => ({
			position: i + 1,
			label: e.label,
			title: '',
			// The place in the book is the entry's identity: a rescan finds it by it.
			sourceUrl: `epub:${e.locator}`,
			locator: e.locator,
			matter: e.matter,
			available: true,
			file: f.file,
			bytes: entryDocs(pkg.spine, locators, i).reduce((a, d) => a + (f.sizes.get(d.href) ?? 0), 0),
			pageCount: 0,
			addedAt: f.addedAt,
			readAt: null,
			lastPosition: null,
			lastOpenedAt: null,
			history: null
		}))
	};
}
