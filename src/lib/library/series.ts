import type { Kind, Rating, SeriesCard } from './types';

/**
 * The series screen's rules, as pure functions. Everything the screen derives
 * -- which rows fold, what the continue button says, what a range selects,
 * where the rail's ticks sit -- is decided here and tested in
 * tests/series-domain.spec.ts, not in markup.
 */

export type Direction = 'rtl' | 'ltr' | 'vertical' | 'paged' | 'scroll';

export type SeriesEntry = {
	id: number;
	/** The entry's number. Fractional numbers (12.5) are real and kept. */
	number: number;
	/** "Ch. 41", "Vol. 13", "Book". */
	label: string;
	/** The entry's own title, without the number: "Ashes at Veyne". May be empty. */
	title: string;
	readAt: number | null;
	/** Last page (0-based) reached, or null when never opened. */
	lastPosition: number | null;
	lastOpenedAt: number | null;
	pageCount: number;
	file: string;
	bytes: number;
	/** A book's own fields, used inside a series of books (doc/BOOKS.md). */
	rating: Rating;
	favourite: boolean;
	addedAt: number;
	coverPage: number | null;
	/**
	 * False for a chapter a backup knows but whose file isn't on disk: read
	 * online, or not copied over yet (doc/IMPORT-MIHON.md).
	 */
	available: boolean;
	/** A novel's place in its EPUB, 'doc.xhtml#anchor' (doc/TEXT-READER.md). */
	locator: string;
	/** Front or back matter: listed apart, never counted as a chapter. */
	matter: '' | 'front' | 'back';
	/** Text: the character in paragraph `lastPosition` the reader stopped at. */
	lastOffset: number | null;
	tags: SeriesTag[];
};

export type SeriesTag = { namespace: string; value: string };

export type SeriesPage = SeriesCard & {
	altTitles: string[];
	source: string;
	status: string;
	description: string;
	/** Null until the owner picks one; see `effectiveDirection`. */
	direction: Direction | null;
	path: string;
	tags: SeriesTag[];
	/** Collection ids this series is on. */
	collections: number[];
	entries: SeriesEntry[];
	/**
	 * One chapter, several scanlators (doc/DUPLICATES.md): how many copies the
	 * list leaves out, who translated the series' chapters, and the owner's
	 * pick among them (null: automatic).
	 */
	duplicates: number;
	scanlators: { name: string; count: number }[];
	scanlator: string | null;
};

// ---- direction -----------------------------------------------------------

/** What a kind reads as until the owner says otherwise. */
export function defaultDirection(kind: Kind): Direction {
	if (kind === 'manhwa') return 'vertical';
	if (kind === 'novel') return 'paged';
	return 'rtl';
}

export function effectiveDirection(series: Pick<SeriesPage, 'kind' | 'direction'>): Direction {
	const options = directionOptions(series.kind).map((o) => o.value);
	return series.direction && options.includes(series.direction)
		? series.direction
		: defaultDirection(series.kind);
}

/** The DIRECTION row for pages, the LAYOUT row for a novel. */
export function directionOptions(kind: Kind): { value: Direction; label: string }[] {
	if (kind === 'novel') {
		return [
			{ value: 'paged', label: 'PAGED' },
			{ value: 'scroll', label: 'SCROLL' }
		];
	}
	return [
		{ value: 'rtl', label: 'R→L' },
		{ value: 'ltr', label: 'L→R' },
		{ value: 'vertical', label: '↓ SCROLL' }
	];
}

export const directionRowLabel = (kind: Kind) => (kind === 'novel' ? 'LAYOUT' : 'DIRECTION');

export function parseDirection(raw: unknown, kind: Kind): Direction | undefined {
	return directionOptions(kind).find((o) => o.value === raw)?.value;
}

// ---- where the reader is ---------------------------------------------------

/**
 * The entry the reader would open: the most recently opened entry that is not
 * finished, else the first unread one. Null when everything is read.
 */
export function currentEntry(entries: SeriesEntry[]): SeriesEntry | null {
	// Front and back matter are never where a book is "at": a new light novel
	// starts on its first chapter, and an unread afterword doesn't keep a
	// finished book open.
	const chapters = entries.some((e) => !e.matter) ? entries.filter((e) => !e.matter) : entries;
	let opened: SeriesEntry | null = null;
	for (const e of chapters) {
		if (e.readAt !== null || e.lastOpenedAt === null) continue;
		if (!opened || e.lastOpenedAt > opened.lastOpenedAt!) opened = e;
	}
	return opened ?? chapters.find((e) => e.readAt === null) ?? null;
}

/** Only the chapters, when a book marks its front and back matter. */
export const chaptersOf = (entries: SeriesEntry[]) => entries.filter((e) => !e.matter);

export const formatNumber = (n: number) => String(n);

/** Page the reader is on, 1-based, and the fraction through the entry. */
export function entryProgress(e: SeriesEntry): { page: number; fraction: number } | null {
	if (e.lastPosition === null || e.pageCount <= 0) return null;
	const page = Math.min(e.pageCount, e.lastPosition + 1);
	return { page, fraction: page / e.pageCount };
}

export type EntryState = 'read' | 'progress' | 'unread';

export function entryState(e: SeriesEntry, current: SeriesEntry | null): EntryState {
	if (e.readAt !== null) return 'read';
	if (current && e.id === current.id && e.lastOpenedAt !== null) return 'progress';
	return 'unread';
}

/** The right-hand status: READ, "P. 12 / 54" (or "P. 12" on a phone), "38%", or nothing. */
export function entryStatus(e: SeriesEntry, state: EntryState, kind: Kind, short = false): string {
	if (state === 'read') return 'READ';
	if (!e.available) return short ? 'NO FILE' : 'NOT DOWNLOADED';
	if (state !== 'progress') return '';
	const p = entryProgress(e);
	if (!p) return '';
	if (kind === 'novel') return `${Math.round(p.fraction * 100)}%`;
	return short ? `P. ${p.page}` : `P. ${p.page} / ${e.pageCount}`;
}

/**
 * "Chapter 388 - Ashes at Veyne"; in a novel's contents "212 — The Commission",
 * or the entry's own label ("Vol. 13") when the table of contents gives no title.
 */
export function entryTitle(e: SeriesEntry, kind: Kind): string {
	const n = formatNumber(e.number);
	if (kind === 'novel') return e.title ? `${n} — ${e.title}` : e.label;
	return e.title ? `Chapter ${n} - ${e.title}` : `Chapter ${n}`;
}

/** A doujin series of two or more books: its contents are a cover grid of books. */
export const isBookSeries = (s: Pick<SeriesPage, 'kind' | 'entries'>) =>
	s.kind === 'doujin' && s.entries.length > 1;

export type BookState = 'read' | 'progress' | 'unread';

/** A book tile's meta line: "28 P · READ", "P. 12 / 30" (in accent, with a bar), or "24 P". */
export function bookMeta(
	e: SeriesEntry,
	current: SeriesEntry | null
): {
	text: string;
	state: BookState;
	progress?: number;
} {
	if (e.readAt !== null) return { text: `${e.pageCount} P · READ`, state: 'read' };
	const p = entryProgress(e);
	if (current && e.id === current.id && p) {
		return { text: `P. ${p.page} / ${e.pageCount}`, state: 'progress', progress: p.fraction };
	}
	return { text: `${e.pageCount} P`, state: 'unread' };
}

/** "6 · 3 READ" for a series of books. */
export function booksCount(entries: SeriesEntry[]): string {
	return `${entries.length} · ${entries.filter((e) => e.readAt !== null).length} READ`;
}

/** "2023-05": when a book was added, for the reorder screen and the grouping sheet. */
export function addedMonth(ms: number): string {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The big accent button, and the facts to its right. */
export function continueAction(series: Pick<SeriesPage, 'kind' | 'entries'>): {
	label: string;
	meta: string;
	short: string;
	entry: SeriesEntry | null;
} {
	const { kind, entries } = series;
	const cur = currentEntry(entries);
	if (isBookSeries(series)) {
		if (!cur)
			return { label: 'READ AGAIN', meta: `${entries.length} BOOKS`, short: '', entry: entries[0] };
		const n = entries.indexOf(cur) + 1;
		const p = entryProgress(cur);
		const started = entries.some((e) => e.readAt !== null || e.lastOpenedAt !== null);
		return {
			label: started ? 'CONTINUE' : 'START',
			meta: p ? `BOOK ${n} · P. ${p.page} OF ${cur.pageCount}` : `BOOK ${n}`,
			short: `BOOK ${n}`,
			entry: cur
		};
	}
	if (kind === 'doujin') {
		const book = entries[0] ?? null;
		const pages = book?.pageCount ?? 0;
		if (!book) return { label: 'READ', meta: '', short: '', entry: null };
		if (book.readAt !== null)
			return { label: 'READ AGAIN', meta: `${pages} PAGES`, short: '', entry: book };
		const p = entryProgress(book);
		if (p && p.page > 1) {
			return {
				label: `READ FROM P. ${p.page}`,
				meta: `${pages} PAGES`,
				short: `P. ${p.page}`,
				entry: book
			};
		}
		return { label: 'READ', meta: `${pages} PAGES`, short: '', entry: book };
	}
	if (!cur) {
		const first = entries[0] ?? null;
		return {
			label: 'READ AGAIN',
			meta: first ? first.label.toUpperCase() : '',
			short: '',
			entry: first
		};
	}
	const where = cur.label.toUpperCase();
	const started = entries.some((e) => e.readAt !== null || e.lastOpenedAt !== null);
	const p = entryProgress(cur);
	const detail =
		p && kind === 'novel'
			? `${where} · ${Math.round(p.fraction * 100)}%`
			: p
				? `${where} · P. ${p.page} OF ${cur.pageCount}`
				: where;
	return { label: started ? 'CONTINUE' : 'START', meta: detail, short: where, entry: cur };
}

// ---- the list ----------------------------------------------------------------

export type Row =
	| { type: 'fold'; from: number; to: number; count: number }
	| { type: 'entry'; entry: SeriesEntry; state: EntryState }
	| { type: 'section'; key: 'front' | 'chapters' | 'back'; label: string; detail: string };

/**
 * The chapter list in reading order. Everything read before the last two
 * chapters folds into one row, so the list opens on the chapter in progress
 * with its two predecessors above it for context. Nothing folds when fewer
 * than three entries would be hidden -- a fold of one row saves nothing.
 *
 * `descending` flips one series to newest-first; the fold then sits at the
 * bottom, where the read chapters are.
 */
export function listRows(
	entries: SeriesEntry[],
	opts: { descending?: boolean; expanded?: boolean } = {}
): Row[] {
	// A book with front and back matter lists it apart, under its own labels,
	// around the chapters (Index Text Reader, contentsLN).
	if (entries.some((e) => e.matter)) {
		const cur = currentEntry(entries);
		const front = entries.filter((e) => e.matter === 'front');
		const back = entries.filter((e) => e.matter === 'back');
		const chapters = chaptersOf(entries);
		const row = (entry: SeriesEntry): Row => ({
			type: 'entry',
			entry,
			state: entryState(entry, cur)
		});
		const read = chapters.filter((e) => e.readAt !== null).length;
		const middle = listRows(chapters, opts).filter((r) => r.type !== 'section');
		return [
			...(front.length
				? [
						{ type: 'section', key: 'front', label: 'FRONT MATTER', detail: String(front.length) },
						...front.map(row)
					]
				: []),
			{
				type: 'section',
				key: 'chapters',
				label: 'CHAPTERS',
				detail: `${chapters.length} · ${read} READ`
			},
			...middle,
			...(back.length
				? [
						{ type: 'section', key: 'back', label: 'BACK MATTER', detail: String(back.length) },
						...back.map(row)
					]
				: [])
		] as Row[];
	}
	const cur = currentEntry(entries);
	const rows: Row[] = entries.map((entry) => ({
		type: 'entry',
		entry,
		state: entryState(entry, cur)
	}));
	let foldEnd = 0;
	if (!opts.expanded) {
		const anchor = cur ? entries.indexOf(cur) : entries.length;
		// A leading run of read entries, stopping two short of the anchor.
		let run = 0;
		while (run < entries.length && entries[run].readAt !== null) run++;
		foldEnd = Math.min(run, Math.max(0, anchor - 2));
		if (foldEnd < 3) foldEnd = 0;
	}
	const out: Row[] =
		foldEnd > 0
			? [
					{
						type: 'fold',
						from: entries[0].number,
						to: entries[foldEnd - 1].number,
						count: foldEnd
					},
					...rows.slice(foldEnd)
				]
			: rows;
	return opts.descending ? [...out].reverse() : out;
}

export function listCount(entries: SeriesEntry[]): string {
	const chapters = chaptersOf(entries);
	const read = chapters.filter((e) => e.readAt !== null).length;
	if (chapters.length < entries.length)
		return `${entries.length} ENTRIES · ${chapters.length} CHAPTERS`;
	return `${entries.length} · ${read} READ`;
}

// ---- selection ---------------------------------------------------------------

/** Every entry id between two, inclusive, in list order, whichever way round. */
export function rangeBetween(entries: SeriesEntry[], a: number, b: number): number[] {
	const i = entries.findIndex((e) => e.id === a);
	const j = entries.findIndex((e) => e.id === b);
	if (i < 0 || j < 0) return [];
	const [lo, hi] = i <= j ? [i, j] : [j, i];
	return entries.slice(lo, hi + 1).map((e) => e.id);
}

/** What each bulk action would change: the handoff shows the count under each. */
export function bulkCounts(entries: SeriesEntry[], selected: Set<number>) {
	let unread = 0;
	let read = 0;
	for (const e of entries) {
		if (!selected.has(e.id)) continue;
		if (e.readAt === null) unread++;
		else read++;
	}
	return { markRead: unread, markUnread: read };
}

// ---- jumping -------------------------------------------------------------------

/** The entry a typed number means: exact, else the nearest one at or after it. */
export function findByNumber(entries: SeriesEntry[], n: number): SeriesEntry | null {
	if (!Number.isFinite(n) || entries.length === 0) return null;
	return (
		entries.find((e) => e.number === n) ??
		entries.find((e) => e.number > n) ??
		entries[entries.length - 1]
	);
}

/** The entry at a fraction of the rail, 0 at the top, 1 at the bottom. */
export function entryAtFraction(entries: SeriesEntry[], fraction: number): SeriesEntry | null {
	if (entries.length === 0) return null;
	const f = Math.min(1, Math.max(0, fraction));
	return entries[Math.round(f * (entries.length - 1))];
}

/** Rail ticks: the first and last number, and round hundreds between. */
export function railTicks(entries: SeriesEntry[]): { label: string; fraction: number }[] {
	if (entries.length < 2) return [];
	const first = entries[0].number;
	const last = entries[entries.length - 1].number;
	const span = last - first;
	const step = span > 1000 ? 200 : span > 300 ? 100 : span > 100 ? 50 : 10;
	const marks = [first];
	for (let n = Math.ceil((first + 1) / step) * step; n < last; n += step) {
		if (n - first >= step / 2 && last - n >= step / 2) marks.push(n);
	}
	marks.push(last);
	return marks.map((n) => ({ label: formatNumber(n), fraction: (n - first) / span }));
}

// ---- metadata ------------------------------------------------------------------

/** "MANHWA · MIHON · ONGOING" */
export function seriesMeta(s: Pick<SeriesPage, 'kind' | 'source' | 'status' | 'entries'>): string {
	if (isBookSeries(s)) return `DOUJIN SERIES · ${s.entries.length} BOOKS`;
	const kind = s.kind === 'novel' ? 'WEB NOVEL' : s.kind.toUpperCase();
	const parts = [kind];
	if (s.source) parts.push(s.source.toUpperCase());
	if (s.kind === 'doujin')
		parts.push(s.entries.length === 1 ? '1 BOOK' : `${s.entries.length} BOOKS`);
	else if (s.status) parts.push(s.status.toUpperCase());
	return parts.join(' · ');
}

/**
 * Tags grouped by namespace, values joined with " · ", in a stable order that
 * puts the namespaces a reader looks for first. `limit` namespaces are shown;
 * the rest are counted in `more`.
 */
const NAMESPACE_ORDER = ['genre', 'circle', 'artist', 'language', 'source'];

export function tagGroups(
	tags: SeriesTag[],
	limit = 4
): { groups: { namespace: string; values: string[] }[]; more: number } {
	const by = new Map<string, string[]>();
	for (const t of tags) {
		const ns = t.namespace || 'tag';
		by.set(ns, [...(by.get(ns) ?? []), t.value]);
	}
	const rank = (ns: string) => {
		const i = NAMESPACE_ORDER.indexOf(ns);
		return i < 0 ? NAMESPACE_ORDER.length : i;
	};
	const all = [...by.entries()]
		.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
		.map(([namespace, values]) => ({ namespace, values }));
	const shown = all.slice(0, limit);
	const more = all.slice(limit).reduce((n, g) => n + g.values.length, 0);
	return { groups: shown, more };
}

/** Parse "artist:Seo Haram" into a tag. A bare value has no namespace. */
export function parseTag(raw: string): SeriesTag | null {
	const text = raw.trim().replace(/^\/\s*/, '');
	if (text === '') return null;
	const at = text.indexOf(':');
	if (at < 0) return { namespace: '', value: text };
	const namespace = text.slice(0, at).trim().toLowerCase();
	const value = text.slice(at + 1).trim();
	if (value === '' || !/^[a-z][a-z0-9-]*$/.test(namespace)) return null;
	return { namespace, value };
}

/**
 * "612 CBZ · 9.8 GB" from the entries' files. Files are counted once each, so
 * a novel whose 591 chapters share one EPUB reads "1 EPUB", and an entry with
 * no file name is a folder of loose images (Hentoid's layout).
 */
export function fileMeta(entries: SeriesEntry[]): string {
	const onDisk = entries.filter((e) => e.available);
	if (onDisk.length === 0 && entries.length > 0) return 'NOT DOWNLOADED';
	const byExt = new Map<string, Set<string>>();
	let bytes = 0;
	for (const e of onDisk) {
		bytes += e.bytes;
		const ext = /\.([a-z0-9]+)$/i.exec(e.file)?.[1]?.toUpperCase() ?? 'FOLDER';
		const files = byExt.get(ext) ?? new Set<string>();
		files.add(e.file || `#${e.id}`);
		byExt.set(ext, files);
	}
	const kinds = [...byExt.entries()].map(
		([ext, files]) => `${files.size} ${ext === 'FOLDER' && files.size > 1 ? 'FOLDERS' : ext}`
	);
	const partial =
		onDisk.length < entries.length ? `${onDisk.length} OF ${entries.length} DOWNLOADED` : '';
	return [partial, ...kinds, formatBytes(bytes)].filter(Boolean).join(' · ');
}

export function formatBytes(bytes: number): string {
	if (bytes <= 0) return '';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let v = bytes;
	let u = 0;
	while (v >= 1000 && u < units.length - 1) {
		v /= 1000;
		u++;
	}
	return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}
