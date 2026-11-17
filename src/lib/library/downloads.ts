import { formatBytes, formatNumber, type SeriesEntry } from './series.ts';
import { m } from '../paraglide/messages.js';
import {
	KEY_PREFIX,
	SOURCE_FAMILIES,
	SOURCE_KINDS,
	type SourceFamily,
	type SourceKind
} from './kinds.ts';

/**
 * Downloading, the rules (doc/DOWNLOADS.md, "From tsundoku"). Pure:
 * `src/lib/server/engine/backend.ts` asks the engine's queue and hands the
 * answers here; the screens read what comes back.
 *
 * A tsundoku series is a source's manga by its key, `mihon:<source>:<url>`,
 * and a chapter is a source's chapter by its URL: the same ids the tablet's
 * backup uses, which is why downloads import as one more device. (The shapes
 * began as Suwayomi's, retired in c129.)
 */

/** A chapter as its source lists it. */
export type SourceChapter = { id: number; url: string; downloaded: boolean };

/** One row of the download queue. */
export type QueueItem = {
	chapterId: number;
	state: 'QUEUED' | 'DOWNLOADING' | 'FINISHED' | 'ERROR';
	/** 0–1 */
	progress: number;
	tries: number;
	/** -1 until the page list has been fetched. */
	pageCount: number;
	number: number;
	name: string;
	/** The manga, as tsundoku keys it: `mihon:<source>:<url>`. */
	key: string;
	mangaId: number;
	mangaTitle: string;
};

/** A chapter's place in downloading, as its row says it. */
export type DownloadState =
	/** On disk: the plain row. */
	| { kind: 'have' }
	/** Downloaded; tsundoku hasn't imported it yet. */
	| { kind: 'importing' }
	| { kind: 'queued'; chapterId: number }
	| { kind: 'downloading'; chapterId: number; page: number; pages: number; fraction: number }
	| { kind: 'failed'; chapterId: number; tries: number }
	/** Not on disk, and nothing under way. `chapterId` null: the source doesn't list it. */
	| { kind: 'none'; chapterId: number | null };

export const keyOf = (sourceId: string, url: string) => `${KEY_PREFIX.mihon}:${sourceId}:${url}`;

const MIHON_KEY = new RegExp(`^${KEY_PREFIX.mihon}:(\\d+):(.+)$`);
const NOVEL_KEY = new RegExp(`^${KEY_PREFIX.lnreader}:([A-Za-z0-9._-]+):(.+)$`);
const ANIME_KEY = new RegExp(`^${KEY_PREFIX.aniyomi}:(\\d+):(.+)$`);

/** `mihon:<source>:<url>` apart; null for any other key (Hentoid, a folder, `mihon-dir:`). */
export function parseKey(key: string | null): { sourceId: string; url: string } | null {
	const m = key ? MIHON_KEY.exec(key) : null;
	return m ? { sourceId: m[1], url: m[2] } : null;
}

/** A novel series' key (doc/NOVELS.md): `lnreader:<plugin>:<path>`, as a Mihon one is `mihon:<source>:<url>`. */
export const novelKeyOf = (plugin: string, path: string) =>
	`${KEY_PREFIX.lnreader}:${plugin}:${path}`;

/** `lnreader:<plugin>:<path>` apart; null for any other key. */
export function parseNovelKey(key: string | null): { plugin: string; path: string } | null {
	const m = key ? NOVEL_KEY.exec(key) : null;
	return m ? { plugin: m[1], path: m[2] } : null;
}

/**
 * An anime series' key (doc/ANIME.md): `aniyomi:<source>:<url>`, an Aniyomi
 * source's anime by its URL, as a Mihon one is `mihon:<source>:<url>`. Its own
 * prefix, so nothing that downloads chapters takes it for a manga.
 */
export const animeKeyOf = (sourceId: string, url: string) =>
	`${KEY_PREFIX.aniyomi}:${sourceId}:${url}`;

/** `aniyomi:<source>:<url>` apart; null for any other key. */
export function parseAnimeKey(key: string | null): { sourceId: string; url: string } | null {
	const m = key ? ANIME_KEY.exec(key) : null;
	return m ? { sourceId: m[1], url: m[2] } : null;
}

/** Each family's own parser: the key is the family's only when it parses. */
const PARSES: Record<SourceFamily, (key: string | null) => unknown> = {
	mihon: parseKey,
	lnreader: parseNovelKey,
	aniyomi: parseAnimeKey
};

/**
 * The source family a key is (card c303; `KEY_PREFIX`, kinds.ts): the one
 * family whose parser reads it. Null is a real answer, not a miss: Hentoid's
 * `hentoid:` and `hentoid-dir:` keys, a folder's `mihon-dir:`, an EPUB's
 * `epub:`, a malformed family key and no key at all are no family's, so
 * nothing downloads, follows or moves them.
 */
export function keyFamily(key: string | null): SourceFamily | null {
	return SOURCE_FAMILIES.find((f) => PARSES[f](key) !== null) ?? null;
}

/** What a series from a source is, by its key: which worker downloads it. Null for no family. */
export function keyKind(key: string | null): SourceKind | null {
	const family = keyFamily(key);
	return family ? SOURCE_KINDS[family] : null;
}

/** A novel plugin's source id, `ln:<plugin>`, as against a Mihon source's number. */
export const isNovelSourceId = (id: string) => id.startsWith('ln:');

/**
 * The source a series is from, by the id BROWSE knows it by: a Mihon
 * source's number, or `ln:<plugin>` for a novel's (doc/NOVELS.md). Null for
 * anything not from a source.
 */
export function sourceOfKey(key: string | null): string | null {
	const m = parseKey(key) ?? parseAnimeKey(key);
	if (m) return m.sourceId;
	const n = parseNovelKey(key);
	return n ? `ln:${n.plugin}` : null;
}

/** Where each entry of a series stands. Entries the source can't be asked about are left out. */
export function chapterStates(
	entries: Pick<SeriesEntry, 'id' | 'available'>[],
	urls: Map<number, string>,
	chapters: SourceChapter[],
	queue: QueueItem[]
): Map<number, DownloadState> {
	const byUrl = new Map(chapters.map((c) => [c.url, c]));
	const queued = new Map(queue.map((q) => [q.chapterId, q]));
	const out = new Map<number, DownloadState>();
	for (const e of entries) {
		if (e.available) {
			out.set(e.id, { kind: 'have' });
			continue;
		}
		const url = urls.get(e.id);
		const c = url ? byUrl.get(url) : undefined;
		const q = c ? queued.get(c.id) : undefined;
		if (c?.downloaded || q?.state === 'FINISHED') out.set(e.id, { kind: 'importing' });
		else if (q?.state === 'QUEUED') out.set(e.id, { kind: 'queued', chapterId: q.chapterId });
		else if (q?.state === 'DOWNLOADING') {
			const pages = Math.max(0, q.pageCount);
			out.set(e.id, {
				kind: 'downloading',
				chapterId: q.chapterId,
				pages,
				page: Math.round(q.progress * pages),
				fraction: q.progress
			});
		} else if (q?.state === 'ERROR')
			out.set(e.id, { kind: 'failed', chapterId: q.chapterId, tries: q.tries });
		else out.set(e.id, { kind: 'none', chapterId: c?.id ?? null });
	}
	return out;
}

/**
 * The row's status column for a chapter with no file. Null leaves the row's
 * own word (READ, the page) alone.
 *
 * The mock's FAILED · NOT FOUND isn't there: the queue says a chapter
 * failed and how often it tried, never why (doc/DOWNLOADS.md, "The series
 * screen").
 */
export function downloadStatus(s: DownloadState | undefined, short = false): string | null {
	switch (s?.kind) {
		case 'importing':
			return 'IMPORTING';
		case 'queued':
			return 'QUEUED';
		case 'downloading': {
			const n = s.pages > 0 ? `${s.page} / ${s.pages}` : `${Math.round(s.fraction * 100)}%`;
			return short ? n : `DOWNLOADING · ${n}`;
		}
		case 'failed':
			return short ? 'FAILED' : `FAILED · ${s.tries} ${s.tries === 1 ? 'TRY' : 'TRIES'}`;
		default:
			return null;
	}
}

/** A tap on a row with no file: queue it, retry it, or nothing. */
export function rowAction(s: DownloadState | undefined): 'queue' | 'retry' | null {
	if (s?.kind === 'none' && s.chapterId !== null) return 'queue';
	if (s?.kind === 'failed') return 'retry';
	return null;
}

type Entry = Pick<SeriesEntry, 'id' | 'number' | 'readAt' | 'available' | 'bytes' | 'matter'>;

/** Unread, no file, nothing under way, and the source lists it: what NEXT 10 and ALL draw from. */
function wanted(entries: Entry[], states: Map<number, DownloadState>): Entry[] {
	return entries.filter((e) => {
		const s = states.get(e.id);
		return e.readAt === null && !e.matter && s?.kind === 'none' && s.chapterId !== null;
	});
}

/** NEXT 10 (FIRST 10 on a series nothing of which is downloaded): the next unread chapters with no file, in reading order. */
export function nextToDownload(
	entries: Entry[],
	states: Map<number, DownloadState>,
	n = 10
): number[] {
	return wanted(entries, states)
		.slice(0, n)
		.map((e) => e.id);
}

/** ALL N: every unread chapter with no file. Read chapters are never in it. */
export function allToDownload(entries: Entry[], states: Map<number, DownloadState>): number[] {
	return wanted(entries, states).map((e) => e.id);
}

/**
 * ALL N's confirmation (Index Series Download, confirm): the span, the size at
 * this series' own average, the queue it joins, and what's left out.
 */
export function confirmLines(
	entries: Entry[],
	ids: number[],
	queuedElsewhere: number
): { title: string; lines: string[] } {
	const picked = entries.filter((e) => ids.includes(e.id));
	const have = entries.filter((e) => e.available && e.bytes > 0);
	const avg = have.length ? have.reduce((a, e) => a + e.bytes, 0) / have.length : 0;
	const first = picked[0]?.number;
	const last = picked[picked.length - 1]?.number;
	const span =
		first === undefined
			? ''
			: first === last
				? `CH. ${formatNumber(first)}`
				: `CH. ${formatNumber(first)} – ${formatNumber(last!)}`;
	const readMissing = entries.some((e) => e.readAt !== null && !e.available);
	return {
		title: `DOWNLOAD ${picked.length} CHAPTER${picked.length === 1 ? '' : 'S'}?`,
		lines: [
			`${span} · EVERY UNREAD CHAPTER WITH NO FILE`,
			avg > 0
				? `ABOUT ${formatBytes(avg * picked.length)} ON /MNT/HDD2 · ${formatBytes(avg)} A CHAPTER IN THIS SERIES`
				: 'SIZE UNKNOWN · NOTHING OF THIS SERIES IS ON DISK YET',
			queuedElsewhere > 0
				? `QUEUED BEHIND ${queuedElsewhere.toLocaleString('en-US')} CHAPTERS OF OTHER SERIES`
				: 'NOTHING ELSE IS QUEUED',
			...(readMissing ? ['READ CHAPTERS WITH NO FILE ARE LEFT OUT'] : [])
		]
	};
}

export type DownloadCounts = {
	/** Unread chapters with no file, under way or not. */
	missingUnread: number;
	/** Those NEXT 10 and ALL can still queue. */
	queueable: number;
	queued: number;
	failed: number;
	downloading: number;
	/** The first failure, for the row's second line. */
	firstFailed: Entry | null;
};

export function downloadCounts(
	entries: Entry[],
	states: Map<number, DownloadState>
): DownloadCounts {
	let missingUnread = 0;
	let queued = 0;
	let failed = 0;
	let downloading = 0;
	let firstFailed: Entry | null = null;
	for (const e of entries) {
		const s = states.get(e.id);
		if (!s || s.kind === 'have') continue;
		if (e.readAt === null && !e.matter) missingUnread++;
		if (s.kind === 'queued') queued++;
		else if (s.kind === 'downloading') downloading++;
		else if (s.kind === 'failed') {
			failed++;
			firstFailed ??= e;
		}
	}
	return {
		missingUnread,
		queueable: wanted(entries, states).length,
		queued,
		failed,
		downloading,
		firstFailed
	};
}

/** "4 QUEUED · 1 FAILED · CH. 395 FAILED", or "NOTHING QUEUED". */
export function underWay(c: DownloadCounts): string {
	const parts = [
		c.downloading ? `${c.downloading} DOWNLOADING` : '',
		c.queued ? `${c.queued} QUEUED` : '',
		c.failed ? `${c.failed} FAILED` : '',
		c.firstFailed ? `CH. ${formatNumber(c.firstFailed.number)} FAILED` : ''
	].filter(Boolean);
	return parts.length ? parts.join(' · ') : 'NOTHING QUEUED';
}

/** The FILE line's addition: ["4 QUEUED", "1 FAILED"]. */
export function fileQueueMeta(c: DownloadCounts): string[] {
	const q = c.queued + c.downloading;
	return [q ? `${q} QUEUED` : '', c.failed ? `${c.failed} FAILED` : ''].filter(Boolean);
}

// ---- the queue ----------------------------------------------------------------------

/** What tsundoku knows of a manga in the queue: its series, if imported, and whether it's hidden. */
export type QueueSeries = {
	id: number;
	title: string;
	hidden: boolean;
	/** `cover_at`, the version in its thumbnail's URL; null without one. */
	cover: number | null;
	hue: number;
};

export type QueueGroup = {
	key: string;
	mangaId: number;
	series: QueueSeries | null;
	title: string;
	/** Its chapters still to download, in the queue's order. */
	chapters: QueueItem[];
	count: number;
	/** "CH. 712 – 1,441" */
	span: string;
	/** Something of it is downloading now. */
	active: boolean;
	/** Episodes, which download in their own lane (doc/ANIME.md, "Downloading"). */
	episodes: boolean;
};

export type QueueView = {
	/** The chapter downloading now; an episode downloads beside it, in its own lane. */
	downloading: (QueueItem & { series: QueueSeries | null }) | null;
	downloadingEpisode: (QueueItem & { series: QueueSeries | null }) | null;
	failures: (QueueItem & { series: QueueSeries | null })[];
	groups: QueueGroup[];
	/** Chapters waiting or downloading, failures not counted. */
	queued: number;
};

/**
 * The queue, by series, failures apart (Index Downloads 8). Hidden means
 * hidden (doc/PRIVACY.md): with reveal off a hidden series' chapters are not
 * listed, named or counted, so a queue of hidden series alone reads as empty.
 * A manga tsundoku hasn't imported yet can't be judged, so it counts as
 * hidden until it has been.
 */
export function queueView(
	items: QueueItem[],
	seriesOf: (key: string) => QueueSeries | null,
	reveal: boolean
): QueueView {
	const known = new Map<string, QueueSeries | null>();
	const lookup = (k: string) => {
		if (!known.has(k)) known.set(k, seriesOf(k));
		return known.get(k)!;
	};
	const shown = items.filter((q) => {
		if (reveal) return true;
		const s = lookup(q.key);
		return s !== null && !s.hidden;
	});
	const groups = new Map<string, QueueGroup>();
	const failures: QueueView['failures'] = [];
	let downloading: QueueView['downloading'] = null;
	let downloadingEpisode: QueueView['downloadingEpisode'] = null;
	let queued = 0;
	for (const q of shown) {
		const series = lookup(q.key);
		if (q.state === 'ERROR') {
			failures.push({ ...q, series });
			continue;
		}
		if (q.state === 'FINISHED') continue;
		queued++;
		const episode = !!parseAnimeKey(q.key);
		if (q.state === 'DOWNLOADING' && episode && !downloadingEpisode)
			downloadingEpisode = { ...q, series };
		else if (q.state === 'DOWNLOADING' && !episode && !downloading) downloading = { ...q, series };
		let g = groups.get(q.key);
		if (!g) {
			g = {
				key: q.key,
				mangaId: q.mangaId,
				series,
				title: series?.title ?? q.mangaTitle,
				chapters: [],
				count: 0,
				span: '',
				active: false,
				episodes: episode
			};
			groups.set(q.key, g);
		}
		g.chapters.push(q);
		g.count++;
		if (q.state === 'DOWNLOADING') g.active = true;
	}
	for (const g of groups.values()) {
		const nums = g.chapters.map((c) => c.number).filter((n) => n >= 0);
		const lo = Math.min(...nums);
		const hi = Math.max(...nums);
		const unit = g.episodes ? 'EP.' : 'CH.';
		g.span = !nums.length
			? ''
			: lo === hi
				? `${unit} ${formatNumber(lo)}`
				: `${unit} ${formatNumber(lo)} – ${formatNumber(hi)}`;
	}
	return { downloading, downloadingEpisode, failures, groups: [...groups.values()], queued };
}

/** The QUEUE cell's count and the DOWNLOADS row's: what's waiting, then what failed. */
export function queueCounts(v: QueueView): { queued: number; failed: number; series: number } {
	return { queued: v.queued, failed: v.failures.length, series: v.groups.length };
}

/** "2,316", the cell's second line. */
export const count = (n: number) => n.toLocaleString('en-US');

// ---- the series screen's DOWNLOAD row ---------------------------------------------------

/** One cell of the row: what it does, and how it's drawn. */
export type DownloadCell = {
	label: string;
	/** `cancel` and `retry` are a film's one file's (c992): its row has no NEXT or ALL. */
	which: 'next' | 'all' | 'follow' | 'unfollow' | 'refresh' | 'cancel' | 'retry';
	acc: boolean;
	dim: boolean;
};

export type DownloadRow = { a: string; b: string; cells: DownloadCell[] };

/** What the row is drawn from: the server's answer, flattened. */
export type RowFacts =
	{ kind: 'ok'; states: Map<number, DownloadState> } | { kind: 'down'; since: number };

/**
 * FOLLOW's part: whether it's on, and when its source was last asked for new
 * chapters.
 */
export type FollowFacts = {
	on: boolean;
	checked: number | null;
	/** False: nothing to follow, a group of one-offs (doc/BOOKS.md). The row leaves FOLLOW out. */
	askable?: boolean;
};

/** What the row counts: chapters unread, or an anime's episodes unwatched (doc/ANIME.md). */
export type RowNoun = { one: string; many: string; every: string; arriving: string };
const CHAPTERS: RowNoun = {
	one: 'unread chapter',
	many: 'unread chapters',
	every: 'Every unread chapter',
	arriving: 'NEW CHAPTERS'
};
/**
 * The ADDED TO THE LIBRARY band's line (Download States 1e): how many there
 * are, and what's on its way. `queued` is what ADD AND DOWNLOAD queued (card
 * c205), `down` when the queue didn't answer, null after a plain ADD.
 */
export function addedDetail(n: number, queued: string | null, anime = false): string {
	const all = `${count(n)} ${anime ? (n === 1 ? 'EPISODE' : 'EPISODES') : n === 1 ? 'CHAPTER' : 'CHAPTERS'}`;
	if (queued === 'down') return `${all} · NOT QUEUED · DOWNLOADING ISN’T ANSWERING`;
	if (queued !== null && Number(queued) > 0) return `${all} · ${count(Number(queued))} DOWNLOADING`;
	return `${all} · NONE DOWNLOADED`;
}

export const EPISODES: RowNoun = {
	one: 'unwatched episode',
	many: 'unwatched episodes',
	every: 'Every unwatched episode',
	arriving: 'NEW EPISODES'
};

/**
 * DOWNLOAD on a preview, a series not in the library (card c205): the same
 * row a library series has, counted from what the source lists less what a
 * browsing record has read. Every cell asks first, since a download lives in
 * the library, and ADD alone was too small a button to find it by.
 */
export function previewDownload(unread: number, anime = false, online = true) {
	const noun = anime ? EPISODES : CHAPTERS;
	const cells: { label: string; which: 'next' | 'all'; acc: boolean }[] = [];
	if (unread > 0) cells.push({ label: `FIRST ${Math.min(10, unread)}`, which: 'next', acc: true });
	if (unread > 10) cells.push({ label: `ALL ${count(unread)}`, which: 'all', acc: false });
	return {
		a: unread
			? `${count(unread)} ${unread === 1 ? noun.one : noun.many} not downloaded`
			: `Nothing ${anime ? 'unwatched' : 'unread'} to download`,
		b: online
			? 'ADDS IT TO YOUR LIBRARY FIRST · IT ASKS'
			: '○ OFFLINE · DOWNLOADING NEEDS THE WORKSTATION',
		cells
	};
}

/** ADD AND DOWNLOAD's question (card c205): ours, never the browser's confirm(). */
export function previewConfirm(
	title: string,
	unread: number,
	which: 'next' | 'all',
	anime = false
) {
	const n = which === 'next' ? Math.min(10, unread) : unread;
	const noun = anime ? (n === 1 ? 'EPISODE' : 'EPISODES') : n === 1 ? 'CHAPTER' : 'CHAPTERS';
	const what = anime ? 'UNWATCHED' : 'UNREAD';
	return {
		title: 'DOWNLOADING ADDS IT TO YOUR LIBRARY',
		lines: [
			`${title.toUpperCase()} GOES INTO YOUR LIBRARY, WHERE DOWNLOADS ARE KEPT.`,
			which === 'next'
				? `THEN ITS FIRST ${count(n)} ${what} ${noun} DOWNLOAD.`
				: `THEN ALL ${count(n)} ${what} ${noun} DOWNLOAD.`,
			'UNDO ON ITS PAGE TAKES IT OUT AGAIN, UNTIL ONE HAS DOWNLOADED.'
		],
		confirm: 'ADD AND DOWNLOAD'
	};
}

/**
 * The DOWNLOAD row under CONTINUE (Index Series Download, states top, down,
 * offline, follow, added). NEXT 10 is the accent cell and never asks; ALL N
 * opens its confirmation; REFRESH asks the series' source once for new
 * chapters and downloads nothing (card c220), and FOLLOW ends the row as FAV
 * ends RATING's, turning accent the same way (FOLLOWING ✓). When nothing of
 * the series is on disk yet, NEXT is FIRST. Not answering and offline keep
 * the row and its cells, dimmed, so the screen doesn't jump, and say why in
 * the LINK row's ○ wording.
 */
export function downloadRow(
	entries: Entry[],
	facts: RowFacts,
	online: boolean,
	clock: (at: number) => string,
	follow: FollowFacts | null = null,
	ago: (at: number) => string = clock,
	noun: RowNoun = CHAPTERS,
	/** The series has a source to ask now (REFRESH, card c220), and is in the library. */
	refreshable = false
): DownloadRow {
	const chapters = (n: number) => `${count(n)} ${n === 1 ? noun.one : noun.many} not downloaded`;
	const followCell = (dim: boolean): DownloadCell[] =>
		follow && follow.askable !== false
			? [
					follow.on
						? { label: 'FOLLOWING ✓', which: 'unfollow', acc: true, dim }
						: { label: 'FOLLOW', which: 'follow', acc: false, dim }
				]
			: [];
	// A series with a source can be asked now, whatever FOLLOW is doing; a
	// folder-scanned one has nothing to ask (card c220).
	const refreshCell = (dim: boolean): DownloadCell[] =>
		refreshable ? [{ label: m.series_refresh(), which: 'refresh', acc: false, dim }] : [];
	if (facts.kind === 'down' || !online) {
		const missing = entries.filter((e) => !e.available && e.readAt === null && !e.matter).length;
		return {
			a: missing ? chapters(missing) : `${noun.every} downloaded`,
			b: !online
				? '○ OFFLINE · DOWNLOADING NEEDS THE WORKSTATION'
				: `○ NOT ANSWERING · THE EXTENSION ENGINE ON THE WORKSTATION · SINCE ${clock((facts as { since: number }).since)}`,
			cells: [
				...(missing
					? [
							{
								label: `NEXT ${Math.min(10, missing)}`,
								which: 'next' as const,
								acc: true,
								dim: true
							},
							...(missing > 10
								? [{ label: `ALL ${count(missing)}`, which: 'all' as const, acc: false, dim: true }]
								: [])
						]
					: []),
				...refreshCell(true),
				...followCell(true)
			]
		};
	}
	const c = downloadCounts(entries, facts.states);
	const first = !entries.some((e) => e.available);
	const cells: DownloadCell[] = [];
	if (c.queueable > 0) {
		const n = Math.min(10, c.queueable);
		cells.push({ label: `${first ? 'FIRST' : 'NEXT'} ${n}`, which: 'next', acc: true, dim: false });
		if (c.queueable > 10)
			cells.push({ label: `ALL ${count(c.queueable)}`, which: 'all', acc: false, dim: false });
	}
	cells.push(...refreshCell(false), ...followCell(false));
	const caughtUp = c.missingUnread === 0 || c.queueable === 0;
	return {
		a:
			c.missingUnread > 0 && !(follow?.on && caughtUp)
				? chapters(c.missingUnread)
				: `${noun.every} downloaded or on its way`,
		b:
			follow?.on && caughtUp && !c.failed
				? `FOLLOWING · ${noun.arriving} DOWNLOAD AS THEY APPEAR${follow.checked ? ` · CHECKED ${ago(follow.checked)}` : ''}`
				: underWay(c),
		cells
	};
}

// ---- searching the sources (Download States 1e) -----------------------------------------

/** How much of the library comes from a source, and how much of that is hidden. */
export type SourceUse = { series: number; hidden: number };

/**
 * Which sources a search asks: those with an extension installed that the
 * library already reads from (MangaDex's English source, not its 40 other
 * languages), and those BROWSE lists (`listed`: the owner's languages, and an
 * extension installed with none in them). Without the second, a new library
 * reads from nothing and a search asked no one: "0 OF 0 SOURCES ANSWERED" on
 * a friend's install with a source just added (2026-10-30). A source whose
 * series are mostly hidden here (Toonily: 110 of 124) is asked only while
 * reveal is on, and with reveal off it isn't counted either: its results would
 * put adult covers on a screen that promised none.
 */
export function sourcesToSearch(
	installed: { id: string; name: string }[],
	use: Map<string, SourceUse>,
	reveal: boolean,
	listed: Set<string> = new Set()
): { id: string; name: string }[] {
	return installed.filter((s) => {
		const u = use.get(s.id);
		if (u && u.series > 0) return reveal || !mostlyHidden(u);
		return listed.has(s.id);
	});
}

/** More than half of what the library has from it is hidden. */
export const mostlyHidden = (u: SourceUse) => u.series > 0 && u.hidden * 2 > u.series;

/** A title as compared for "SAME TITLE IN LIBRARY": case, punctuation and spacing aside. */
export const normTitle = (t: string) =>
	t
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

/** The query's first occurrence in a title, for the result's highlight. */
export function highlight(
	title: string,
	query: string
): { pre: string; mid: string; post: string } {
	const q = query.trim().toLowerCase();
	const i = q ? title.toLowerCase().indexOf(q) : -1;
	return i < 0
		? { pre: title, mid: '', post: '' }
		: {
				pre: title.slice(0, i),
				mid: title.slice(i, i + q.length),
				post: title.slice(i + q.length)
			};
}

/** What the library says of a result. */
export type ResultMatch =
	/** This very series is in the library: it opens it. */
	| { kind: 'in-library'; seriesId: number; meta: string; hidden?: boolean }
	/** The same title from another source: said, to head off a twin. */
	/** `source` is '' when reveal doesn't let the viewer see that source's name. */
	| { kind: 'same-title'; source: string }
	| { kind: 'new' };

// ---- FOLLOW (Download States 1d) ----------------------------------------------------------

/**
 * The chapters FOLLOW queues: listed by the source after the series was
 * followed, not downloaded, not queued, and not read here. New chapters
 * only: what was already missing stays ALL N's job. At most `cap` a run, so a
 * source that re-lists its whole catalogue can't queue hundreds at once.
 */
export function followQueue(
	chapters: { id: number; url: string; fetchedAt: number; downloaded: boolean }[],
	followedAt: number,
	queued: Set<number>,
	readUrls: Set<string>,
	cap = 50
): number[] {
	return chapters
		.filter(
			(c) => c.fetchedAt > followedAt && !c.downloaded && !queued.has(c.id) && !readUrls.has(c.url)
		)
		.slice(0, cap)
		.map((c) => c.id);
}
