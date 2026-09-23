import type { ComicInfo } from './comicinfo';
import type { MihonBackup, MihonChapter, MihonManga } from './mihon-backup';
import { defaultDirection, type Direction } from '../library/series.ts';
import type { Kind, Rating } from '$lib/library/types';

/**
 * What a Mihon import will write, worked out without touching the database
 * or the disk: the backup and a listing of the downloads go in, series with
 * their entries come out. doc/IMPORT-MIHON.md explains every rule here; the
 * owner settled the category ones on 2026-09-23.
 */

// ---- what the disk says ---------------------------------------------------------

export type DownloadedChapter = {
	/** File name inside the series folder. */
	file: string;
	bytes: number;
	/** Images in the archive. */
	pages: number;
	info: ComicInfo | null;
};

export type DownloadedSeries = {
	/** "Weeb Central (EN)" */
	sourceDir: string;
	/** "Drawing_ Saikyou Mangaka wa …": the series folder's name. */
	dir: string;
	/** Absolute path of the series folder. */
	path: string;
	chapters: DownloadedChapter[];
};

// ---- what gets written ---------------------------------------------------------

export type PlannedEntry = {
	position: number;
	label: string;
	title: string;
	sourceUrl: string;
	available: boolean;
	file: string;
	bytes: number;
	pageCount: number;
	addedAt: number;
	readAt: number | null;
	lastPosition: number | null;
	lastOpenedAt: number | null;
	/** Mihon's one history row for this chapter, imported into the reading log. */
	history: { at: number; finished: boolean; page: number | null; durationMs: number } | null;
};

export type PlannedTag = { namespace: string; value: string };

export type PlannedSeries = {
	originKey: string;
	title: string;
	kind: Kind;
	rating: Rating;
	hidden: boolean;
	shelves: string[];
	tags: PlannedTag[];
	description: string;
	status: string;
	direction: Direction | null;
	addedAt: number;
	sourceUrl: string;
	/** The download folder, or '' for a series with nothing on disk. */
	path: string;
	entries: PlannedEntry[];
};

// ---- categories ---------------------------------------------------------------

/**
 * The owner's Mihon categories are a rating scale, each with a "+" twin for
 * adult series: Amazing, Good, Okay rate 5, 4, 3; Dropped, IDR and To Read
 * stay unrated and become shelves; any other category is a shelf too. A "+"
 * hides the series. The category itself is kept as a `mihon:` tag.
 */
export function categoryEffect(name: string): {
	rating: Rating;
	shelf: string | null;
	adult: boolean;
} {
	const adult = name.trim().endsWith('+');
	const base = name.trim().replace(/\+$/, '').trim();
	const rating = ({ amazing: 5, good: 4, okay: 3 } as Record<string, Rating>)[base.toLowerCase()];
	return rating ? { rating, shelf: null, adult } : { rating: 0, shelf: base, adult };
}

// ---- small rules ---------------------------------------------------------------

const KIND_WORDS: Record<string, Kind> = {
	manhwa: 'manhwa',
	webtoon: 'manhwa',
	manhua: 'manhwa',
	manga: 'manga'
};

/** Sources that publish webtoons and nothing else. */
const WEBTOON_SOURCES = new Set([
	'asura scans',
	'toonily',
	'toonily.me',
	'webtoons.com',
	'omega scans',
	'bato.to'
]);

/**
 * What a series says about its own kind: a "Manhwa" or "Manga" genre, then a
 * webtoon reading mode (the owner switched it to scroll). Null when neither.
 */
export function signalledKind(genres: string[], viewer: number): Kind | null {
	for (const g of genres) {
		const k = KIND_WORDS[g.trim().toLowerCase()];
		if (k) return k;
	}
	return viewer === 4 || viewer === 5 ? 'manhwa' : null;
}

/**
 * The kind, when the series doesn't say: a webtoon-only source means
 * manhwa, and anything else is manga. A source's majority was tried and
 * misled -- mixed sources tag only their Korean titles, so the Japanese ones
 * were outvoted. The owner can change a kind.
 */
export function kindOf(genres: string[], viewer: number, source = ''): Kind {
	return (
		signalledKind(genres, viewer) ??
		(WEBTOON_SOURCES.has(source.trim().toLowerCase()) ? 'manhwa' : 'manga')
	);
}

/** Mihon's reading mode as tsundoku's direction, or null when it is the kind's default anyway. */
export function directionOf(viewer: number, kind: Kind): Direction | null {
	const d: Direction | null =
		viewer === 1 ? 'ltr' : viewer === 2 ? 'rtl' : viewer >= 3 && viewer <= 5 ? 'vertical' : null;
	return d === defaultDirection(kind) ? null : d;
}

export function statusOf(status: number | string): string {
	if (typeof status === 'string') {
		const s = status.trim().toLowerCase();
		return s === 'publishing finished'
			? 'completed'
			: s === 'unknown'
				? ''
				: s.replace(/\s+/g, '-');
	}
	return ['', 'ongoing', 'completed', 'licensed', 'completed', 'cancelled', 'hiatus'][status] ?? '';
}

/** "Kim Hyunsoo", "BK_Moon/ Lee hyunmin" -> people, one each. */
export function people(s: string): string[] {
	return s
		.split(/\s*(?:,|\/|;|\s&\s)\s*/)
		.map((p) => p.trim())
		.filter((p) => p !== '' && p !== '_' && p.toLowerCase() !== 'unknown');
}

/** 98 -> "98", 10.5 -> "10.5", as Mihon shows them. */
export const formatNumber = (n: number) => String(Math.round(n * 1000) / 1000);

/** "Chapter 98 - Lindenborough" -> "Lindenborough"; "Chapter 156" -> "". */
export function chapterTitle(name: string): string {
	const rest = name
		.replace(/^\s*(?:chapter|chap|ch|episode|ep)\.?\s*[\d.]+\s*[-:–—.]?\s*/i, '')
		.trim();
	return rest === name.trim() && /^\s*(?:chapter|ch)/i.test(name) ? '' : rest;
}

/**
 * Mihon's folder name for a title (DiskUtil.buildValidFilename): FAT's
 * illegal characters become `_`, leading and trailing dots and spaces go,
 * and it is cut at 240 characters.
 */
export function mihonFolderName(title: string): string {
	const name = title.replace(/^[. ]+|[. ]+$/g, '');
	if (name === '') return '(invalid)';
	// eslint-disable-next-line no-control-regex -- control characters are exactly what FAT refuses
	return name.replace(/["*/:<>?\\|\x00-\x1f\x7f]/g, '_').slice(0, 240);
}

// ---- matching ------------------------------------------------------------------

function sourceMatches(downloaded: DownloadedSeries, sourceName: string | undefined): boolean {
	if (!sourceName) return false;
	if (downloaded.sourceDir === sourceName || downloaded.sourceDir.startsWith(`${sourceName} (`))
		return true;
	return downloaded.chapters.some((c) => c.info?.source === sourceName);
}

function titleMatches(downloaded: DownloadedSeries, title: string): boolean {
	if (downloaded.chapters.some((c) => c.info?.series === title)) return true;
	const folder = mihonFolderName(title);
	return downloaded.dir === folder || (folder.length >= 200 && folder.startsWith(downloaded.dir));
}

/**
 * Which backup chapter a downloaded file is: the chapter URL in ComicInfo's
 * Web first (Weeb Central's match exactly), then the number (Asura adds a
 * slug hash to its URLs, so only the number matches), then the name.
 */
export function matchChapters(
	chapters: MihonChapter[],
	files: DownloadedChapter[]
): Map<DownloadedChapter, MihonChapter | null> {
	const out = new Map<DownloadedChapter, MihonChapter | null>();
	const taken = new Set<MihonChapter>();
	const pick = (file: DownloadedChapter, test: (c: MihonChapter) => boolean) => {
		const hits = chapters.filter((c) => !taken.has(c) && test(c));
		if (hits.length !== 1) return false;
		taken.add(hits[0]);
		out.set(file, hits[0]);
		return true;
	};
	const passes: ((f: DownloadedChapter) => (c: MihonChapter) => boolean)[] = [
		(f) => (c) =>
			c.url.length > 1 && (f.info?.web ?? []).some((u) => u === c.url || u.endsWith(c.url)),
		(f) => (c) =>
			f.info !== null &&
			Number.isFinite(f.info.number) &&
			c.number >= 0 &&
			c.number === f.info.number,
		(f) => (c) => f.info !== null && f.info.title !== '' && c.name === f.info.title
	];
	for (const pass of passes) for (const f of files) if (!out.has(f)) pick(f, pass(f));
	for (const f of files) if (!out.has(f)) out.set(f, null);
	return out;
}

// ---- positions -----------------------------------------------------------------

/**
 * Reading order. A chapter's number is its position; the few without one
 * slot in after the numbered chapter before them in the source's own order,
 * so they stay where the source listed them.
 */
function positions(chapters: { number: number; order: number }[]): number[] {
	const idx = chapters.map((_, i) => i).sort((a, b) => chapters[a].order - chapters[b].order);
	const out: number[] = new Array(chapters.length);
	let last = 0;
	let step = 0;
	for (const i of idx) {
		const n = chapters[i].number;
		if (Number.isFinite(n) && n >= 0) {
			out[i] = n;
			last = n;
			step = 0;
		} else {
			step += 1;
			out[i] = last + step / 1000;
		}
	}
	return out;
}

/** Rows as entries: the working number and order give way to the position. */
function withPositions(
	rows: (Omit<PlannedEntry, 'position'> & { number?: number; order?: number })[],
	pos: number[]
): PlannedEntry[] {
	return rows.map((r, i) => {
		const e = { ...r, position: pos[i] };
		delete e.number;
		delete e.order;
		return e;
	});
}

// ---- the plan ------------------------------------------------------------------

function tagsFor(p: {
	genres: string[];
	author: string;
	artist: string;
	source: string | undefined;
	categories: string[];
}): PlannedTag[] {
	const seen = new Set<string>();
	const out: PlannedTag[] = [];
	const add = (namespace: string, value: string) => {
		const v = value.trim();
		const key = `${namespace}:${v.toLowerCase()}`;
		if (v === '' || seen.has(key)) return;
		seen.add(key);
		out.push({ namespace, value: v });
	};
	for (const g of p.genres) if (!KIND_WORDS[g.trim().toLowerCase()]) add('genre', g.toLowerCase());
	for (const a of people(p.author)) add('author', a);
	for (const a of people(p.artist)) add('artist', a);
	if (p.source) add('source', p.source);
	for (const c of p.categories) add('mihon', c);
	return out;
}

function fromBackup(
	m: MihonManga,
	backup: MihonBackup,
	downloaded: DownloadedSeries | null,
	now: number
): PlannedSeries {
	const categoryNames = m.categories
		.map((order) => backup.categories.find((c) => c.order === order)?.name)
		.filter((n): n is string => !!n);
	const effects = categoryNames.map(categoryEffect);
	const sourceName = backup.sources.get(m.source);
	const kind = kindOf(m.genres, m.viewer, sourceName);
	const history = new Map(m.history.map((h) => [h.url, h]));

	const files = downloaded ? matchChapters(m.chapters, downloaded.chapters) : new Map();
	const fileFor = new Map<MihonChapter, DownloadedChapter>();
	const extra: DownloadedChapter[] = [];
	for (const [f, c] of files) {
		if (c) fileFor.set(c, f);
		else extra.push(f);
	}

	const addedAt =
		m.dateAdded ?? (Math.min(...m.chapters.map((c) => c.dateFetch || Infinity)) || now);
	const seriesAdded = Number.isFinite(addedAt) ? addedAt : now;

	const rows: (Omit<PlannedEntry, 'position'> & { number: number; order: number })[] = [];
	for (const c of m.chapters) {
		const f = fileFor.get(c) ?? null;
		const h = history.get(c.url) ?? null;
		const readAt = c.read ? h?.lastRead || c.dateFetch || seriesAdded : null;
		rows.push({
			number: c.number,
			order: -c.sourceOrder,
			label: c.number >= 0 ? `Ch. ${formatNumber(c.number)}` : c.name || 'Chapter',
			title: chapterTitle(c.name),
			sourceUrl: c.url,
			available: f !== null,
			file: f?.file ?? '',
			bytes: f?.bytes ?? 0,
			pageCount: f?.pages ?? 0,
			addedAt: c.dateFetch || c.dateUpload || seriesAdded,
			readAt,
			lastPosition: !c.read && (c.lastPageRead > 0 || h) ? c.lastPageRead : null,
			lastOpenedAt: h?.lastRead || (c.read ? readAt : null),
			history: h
				? { at: h.lastRead, finished: c.read, page: c.lastPageRead, durationMs: h.readDuration }
				: null
		});
	}
	// Files on disk the backup doesn't know: a backup older than the downloads.
	const maxOrder = rows.reduce((a, r) => Math.max(a, r.order), 0);
	extra.forEach((f, i) => rows.push(entryFromFile(f, maxOrder + 1 + i, seriesAdded)));

	const pos = positions(rows);
	return {
		originKey: `mihon:${m.source}:${m.url}`,
		title: m.title,
		kind,
		rating: effects.reduce<Rating>((a, e) => (e.rating > a ? e.rating : a), 0),
		hidden: effects.some((e) => e.adult),
		shelves: [...new Set(effects.map((e) => e.shelf).filter((s): s is string => s !== null))],
		tags: tagsFor({
			genres: m.genres,
			author: m.author,
			artist: m.artist,
			source: sourceName,
			categories: categoryNames
		}),
		description: m.description.trim(),
		status: statusOf(m.status),
		direction: directionOf(m.viewer, kind),
		addedAt: seriesAdded,
		sourceUrl: m.url,
		path: downloaded?.path ?? '',
		entries: withPositions(rows, pos)
	};
}

function entryFromFile(
	f: DownloadedChapter,
	order: number,
	addedAt: number
): Omit<PlannedEntry, 'position'> & { number: number; order: number } {
	const number = f.info && Number.isFinite(f.info.number) ? f.info.number : -1;
	const name = f.info?.title || f.file.replace(/\.cbz$/i, '');
	return {
		number,
		order,
		label: number >= 0 ? `Ch. ${formatNumber(number)}` : name,
		title: chapterTitle(name),
		sourceUrl: f.info?.web.at(-1) ?? '',
		available: true,
		file: f.file,
		bytes: f.bytes,
		pageCount: f.pages,
		addedAt,
		readAt: null,
		lastPosition: null,
		lastOpenedAt: null,
		history: null
	};
}

/** A download the backup has no series for: everything comes from ComicInfo. */
function fromDownloadOnly(d: DownloadedSeries, now: number): PlannedSeries {
	const info = d.chapters.find((c) => c.info)?.info ?? null;
	const genres = info?.genres ?? [];
	const sourceGuess = info?.source || d.sourceDir.replace(/\s*\([^)]*\)\s*$/, '');
	const kind = kindOf(genres, 0, sourceGuess);
	const categories = info?.categories ?? [];
	const effects = categories.map(categoryEffect);
	const rows = d.chapters
		.slice()
		.sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }))
		.map((f, i) => entryFromFile(f, i, now));
	const pos = positions(rows);
	const sourceName = info?.source || d.sourceDir.replace(/\s*\([^)]*\)\s*$/, '');
	return {
		originKey: `mihon-dir:${d.sourceDir}/${d.dir}`,
		title: info?.series || d.dir,
		kind,
		rating: effects.reduce<Rating>((a, e) => (e.rating > a ? e.rating : a), 0),
		hidden: effects.some((e) => e.adult),
		shelves: [...new Set(effects.map((e) => e.shelf).filter((s): s is string => s !== null))],
		tags: tagsFor({
			genres,
			author: info?.writer ?? '',
			artist: info?.penciller ?? '',
			source: sourceName,
			categories
		}),
		description: info?.summary ?? '',
		status: statusOf(info?.status ?? ''),
		direction: null,
		addedAt: now,
		sourceUrl: '',
		path: d.path,
		entries: withPositions(rows, pos)
	};
}

export type MihonPlan = {
	series: PlannedSeries[];
	/** Series in the backup that were only browsed, never added: not imported. */
	skipped: number;
};

/**
 * Library series from the backup (with their downloads attached where the
 * disk has them), downloaded series the library doesn't list, and downloads
 * the backup knows nothing about. Browsed-only series are left out unless
 * something of theirs was downloaded.
 */
export function planMihon(
	backup: MihonBackup | null,
	downloads: DownloadedSeries[],
	now = Date.now()
): MihonPlan {
	const series: PlannedSeries[] = [];
	const claimed = new Set<DownloadedSeries>();
	let skipped = 0;
	for (const m of backup?.manga ?? []) {
		const sourceName = backup!.sources.get(m.source);
		const downloaded =
			downloads.find(
				(d) => !claimed.has(d) && sourceMatches(d, sourceName) && titleMatches(d, m.title)
			) ?? null;
		if (!m.favorite && !downloaded) {
			skipped += 1;
			continue;
		}
		if (downloaded) claimed.add(downloaded);
		series.push(fromBackup(m, backup!, downloaded, now));
	}
	for (const d of downloads) if (!claimed.has(d)) series.push(fromDownloadOnly(d, now));
	return { series, skipped };
}
