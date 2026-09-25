import type { PlannedEntry, PlannedSeries, PlannedTag } from './plan';
import type { Rating } from '$lib/library/types';

/**
 * Hentoid books as tsundoku series (doc/IMPORT-HENTOID.md). Pure: a book's
 * folder listing and its contentV2.json go in, a planned series comes out.
 *
 * Every book is its own series -- a single book, which is how Hentoid thinks
 * of it -- except a multi-chapter book (Hentai2Read), whose chapters become
 * the books of a series of books, split by the pages' `chapterOrder`.
 */

// ---- contentV2.json -----------------------------------------------------------

export type HentoidImage = {
	order: number;
	name: string;
	isCover: boolean;
	status: string;
	pHash: number;
	chapterOrder: number;
};

export type HentoidChapter = { order: number; url: string; name: string };

export type HentoidBook = {
	title: string;
	site: string;
	url: string;
	favourite: boolean;
	rating: number;
	completed: boolean;
	reads: number;
	lastReadDate: number;
	lastReadPageIndex: number;
	downloadDate: number;
	attributes: { type: string; name: string }[];
	images: HentoidImage[];
	chapters: HentoidChapter[];
	groups: string[];
};

const num = (v: unknown, fallback = 0) =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** Tolerant of missing fields: every one of them is optional in practice. */
export function parseContent(json: unknown): HentoidBook {
	const d = obj(json);
	const attributes: HentoidBook['attributes'] = [];
	for (const [type, list] of Object.entries(obj(d.attributes)))
		for (const a of arr(list)) {
			const name = str(obj(a).name).trim();
			if (name) attributes.push({ type: str(obj(a).type) || type, name });
		}
	return {
		title: str(d.title).trim(),
		site: str(d.site),
		url: str(d.url),
		favourite: d.favourite === true,
		rating: num(d.rating),
		completed: d.completed === true,
		reads: num(d.reads),
		lastReadDate: num(d.lastReadDate),
		lastReadPageIndex: num(d.lastReadPageIndex),
		downloadDate: num(d.downloadDate),
		attributes,
		images: arr(d.imageFiles).map((i) => {
			const o = obj(i);
			return {
				order: num(o.order),
				name: str(o.name),
				isCover: o.isCover === true,
				status: str(o.status),
				pHash: num(o.pHash),
				chapterOrder: num(o.chapterOrder, -1)
			};
		}),
		chapters: arr(d.chapters).map((c) => {
			const o = obj(c);
			return { order: num(o.order), url: str(o.url), name: str(o.name) };
		}),
		// Unseen in the samples: accept a name string or an object with one.
		groups: arr(d.groups)
			.map((g) => (typeof g === 'string' ? g : str(obj(g).name)))
			.filter((g) => g.trim() !== '')
	};
}

// ---- the folder -----------------------------------------------------------------

export type HentoidFolder = {
	/** Relative to the Hentoid root: "nhentai2/ - Title - [1002]". */
	folder: string;
	/** Image files in the folder, in natural order. */
	files: string[];
	bytes: number;
	content: HentoidBook | null;
};

// ---- rules ----------------------------------------------------------------------

/** Hentoid's attribute types as tag namespaces; people keep the person namespaces. */
const NAMESPACES: Record<string, string> = {
	ARTIST: 'artist',
	CIRCLE: 'circle',
	TAG: 'tag',
	LANGUAGE: 'language',
	CATEGORY: 'category',
	CHARACTER: 'character',
	SERIE: 'parody',
	UPLOADER: 'uploader'
};

export function tagsOf(book: HentoidBook): PlannedTag[] {
	const seen = new Set<string>();
	const out: PlannedTag[] = [];
	const add = (namespace: string, value: string) => {
		const key = `${namespace}:${value.toLowerCase()}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ namespace, value });
	};
	for (const a of book.attributes)
		add(NAMESPACES[a.type.toUpperCase()] ?? a.type.toLowerCase(), a.name);
	if (book.site) add('source', book.site.toLowerCase());
	return out;
}

/** "mori - Paper Lanterns - [1003]" -> "Paper Lanterns": for a book without its JSON. */
export function titleFromFolder(folder: string): string {
	const name = folder.split('/').pop() ?? folder;
	const noId = name.replace(/\s*-?\s*\[\d+\]\s*$/, '').trim();
	const dash = noId.indexOf(' - ');
	return (dash >= 0 ? noId.slice(dash + 3) : noId.replace(/^-\s*/, '')).trim() || name;
}

/** "1.5 - Quiet Rooms [Full Color]" -> number 1.5, title after the dash. */
export function parseChapterName(name: string, order: number): { number: number; title: string } {
	const m = /^\s*([\d.]+)\s*[-:–]\s*(.*)$/.exec(name);
	return m && Number.isFinite(Number(m[1]))
		? { number: Number(m[1]), title: m[2].trim() }
		: { number: order, title: name.trim() };
}

const stem = (f: string) => f.replace(/\.[^.]+$/, '');
const hex = (n: number) =>
	n ? BigInt.asUintN(64, BigInt(n)).toString(16).padStart(16, '0') : null;

// ---- the plan -------------------------------------------------------------------

/**
 * The owner's progress, which Hentoid keeps per book as one page index across
 * all its pages: the pages before it are read, the one it points at is where
 * reading stopped, and `completed` means all of it.
 */
function progressFor(
	book: HentoidBook | null,
	start: number,
	count: number,
	isLast: boolean
): Pick<PlannedEntry, 'readAt' | 'lastPosition' | 'lastOpenedAt' | 'history'> {
	const none = { readAt: null, lastPosition: null, lastOpenedAt: null, history: null };
	if (!book || (book.reads === 0 && !book.completed)) return none;
	const at = book.lastReadDate || book.downloadDate;
	const index = book.lastReadPageIndex;
	if (book.completed || index >= start + count) {
		const here = book.completed ? isLast : false;
		return {
			readAt: at,
			lastPosition: null,
			lastOpenedAt: here || index >= start + count ? at : null,
			history: here ? { at, finished: true, page: count - 1, durationMs: 0 } : null
		};
	}
	if (index >= start) {
		const page = index - start;
		return {
			readAt: null,
			lastPosition: page,
			lastOpenedAt: at,
			history: { at, finished: false, page, durationMs: 0 }
		};
	}
	return none;
}

export function planHentoidBook(f: HentoidFolder, rootPath: string, now: number): PlannedSeries {
	const book = f.content;
	const byStem = new Map(f.files.map((file) => [stem(file), file]));
	const cover = book?.images.find((i) => i.isCover) ?? null;
	// Hentoid names its cover thumb.<ext>. Without a JSON to say so, that name
	// is all there is -- and it's never a page: a folder holding only it is a
	// download that failed, not a one-page book (doc/IMPORT-HENTOID.md).
	const coverFile = cover
		? (byStem.get(cover.name) ?? null)
		: (f.files.find((file) => /^thumb\./i.test(file)) ?? null);
	// Pages in Hentoid's order, the cover excluded; files it doesn't list follow.
	const listed = (book?.images ?? [])
		.filter((i) => !i.isCover && i.status !== 'ERROR')
		.sort((a, b) => a.order - b.order)
		.map((i) => ({ file: byStem.get(i.name), chapter: i.chapterOrder }))
		.filter((p): p is { file: string; chapter: number } => p.file !== undefined);
	const known = new Set(listed.map((p) => p.file));
	const pages = [
		...listed,
		...f.files
			.filter((file) => !known.has(file) && file !== coverFile)
			.map((file) => ({ file, chapter: -1 }))
	];
	const title = book?.title || titleFromFolder(f.folder);
	const originKey = book?.url ? `hentoid:${book.site}:${book.url}` : `hentoid-dir:${f.folder}`;
	const addedAt = book?.downloadDate || now;
	const phash = hex(cover?.pHash ?? book?.images.find((i) => i.pHash)?.pHash ?? 0);

	const chapters = (book?.chapters ?? []).slice().sort((a, b) => a.order - b.order);
	const split = chapters.length >= 2 && pages.some((p) => p.chapter >= 0);
	const groups = split
		? chapters.map((c) => ({
				chapter: c,
				pages: pages.filter((p) => p.chapter === c.order).map((p) => p.file)
			}))
		: [{ chapter: null, pages: pages.map((p) => p.file) }];
	// Pages no chapter claims go with the first, so none is lost.
	if (split) {
		const claimed = new Set(groups.flatMap((g) => g.pages));
		groups[0].pages.unshift(...pages.map((p) => p.file).filter((p) => !claimed.has(p)));
	}

	let start = 0;
	const entries: PlannedEntry[] = groups
		.filter((g) => g.pages.length > 0)
		.map((g, i, all) => {
			const c = g.chapter ? parseChapterName(g.chapter.name, g.chapter.order) : null;
			const entry: PlannedEntry = {
				position: c ? c.number : 1,
				label: c ? `Ch. ${c.number}` : 'Book',
				title: c ? c.title || title : title,
				sourceUrl: c ? g.chapter!.url || `${originKey}#${g.chapter!.order}` : originKey,
				available: true,
				file: f.folder,
				bytes: all.length === 1 ? f.bytes : 0,
				pageCount: g.pages.length,
				addedAt,
				...progressFor(book, start, g.pages.length, i === all.length - 1),
				pages: g.pages,
				coverFile: i === 0 ? coverFile : null,
				coverPhash: i === 0 ? phash : null
			};
			start += g.pages.length;
			return entry;
		});
	// The folder's size is counted once, on the first book, so the FILE row adds up.
	if (entries.length > 1) entries[0].bytes = f.bytes;
	// A series of books: each book carries the tags, so person pages find it.
	const tags = book ? tagsOf(book) : [];
	if (entries.length > 1) for (const e of entries) e.tags = tags;

	const rating = Math.max(0, Math.min(5, Math.round(book?.rating ?? 0))) as Rating;
	return {
		originKey,
		source: 'hentoid',
		title,
		kind: 'doujin',
		rating,
		favourite: book?.favourite ?? false,
		// The Hentoid root is hidden; the series itself needn't be.
		hidden: false,
		shelves: book?.groups ?? [],
		tags,
		description: '',
		status: '',
		direction: null,
		addedAt,
		sourceUrl: book?.url ?? '',
		path: rootPath,
		entries
	};
}
