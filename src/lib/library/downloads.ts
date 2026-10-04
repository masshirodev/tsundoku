import { formatBytes, formatNumber, type SeriesEntry } from './series.ts';

/**
 * Downloading through Suwayomi, the rules (doc/DOWNLOADING.md, "From
 * tsundoku"). Pure: `src/lib/server/suwayomi.ts` asks Suwayomi and hands the
 * answers here; the screens read what comes back.
 *
 * A tsundoku series is a Suwayomi manga by its key, `mihon:<source>:<url>`,
 * and a chapter is a Suwayomi chapter by its URL: the same ids the tablet's
 * backup uses, which is why Suwayomi could be imported as one more device.
 */

/** A chapter as Suwayomi knows it. */
export type SourceChapter = { id: number; url: string; downloaded: boolean };

/** One row of Suwayomi's download queue. */
export type QueueItem = {
	chapterId: number;
	state: 'QUEUED' | 'DOWNLOADING' | 'FINISHED' | 'ERROR';
	/** 0–1 */
	progress: number;
	tries: number;
	/** -1 until Suwayomi has fetched the page list. */
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
	/** Suwayomi has it; tsundoku hasn't imported it yet. */
	| { kind: 'importing' }
	| { kind: 'queued'; chapterId: number }
	| { kind: 'downloading'; chapterId: number; page: number; pages: number; fraction: number }
	| { kind: 'failed'; chapterId: number; tries: number }
	/** Not on disk, and nothing under way. `chapterId` null: Suwayomi doesn't list it. */
	| { kind: 'none'; chapterId: number | null };

export const keyOf = (sourceId: string, url: string) => `mihon:${sourceId}:${url}`;

/** `mihon:<source>:<url>` apart; null for any other key (Hentoid, a folder, `mihon-dir:`). */
export function parseKey(key: string | null): { sourceId: string; url: string } | null {
	const m = key ? /^mihon:(\d+):(.+)$/.exec(key) : null;
	return m ? { sourceId: m[1], url: m[2] } : null;
}

/** Where each entry of a series stands. Entries Suwayomi can't be asked about are left out. */
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
 * The mock's FAILED · NOT FOUND isn't there: Suwayomi's queue says a chapter
 * failed and how often it tried, never why (doc/DOWNLOADING.md, "Where it
 * departs from the handoff").
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

/** Unread, no file, nothing under way, and Suwayomi lists it: what NEXT 10 and ALL draw from. */
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
	/** Its chapters still to download, in Suwayomi's order. */
	chapters: QueueItem[];
	count: number;
	/** "CH. 712 – 1,441" */
	span: string;
	/** Something of it is downloading now. */
	active: boolean;
};

export type QueueView = {
	downloading: (QueueItem & { series: QueueSeries | null }) | null;
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
	let queued = 0;
	for (const q of shown) {
		const series = lookup(q.key);
		if (q.state === 'ERROR') {
			failures.push({ ...q, series });
			continue;
		}
		if (q.state === 'FINISHED') continue;
		queued++;
		if (q.state === 'DOWNLOADING' && !downloading) downloading = { ...q, series };
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
				active: false
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
		g.span = !nums.length
			? ''
			: lo === hi
				? `CH. ${formatNumber(lo)}`
				: `CH. ${formatNumber(lo)} – ${formatNumber(hi)}`;
	}
	return { downloading, failures, groups: [...groups.values()], queued };
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
	which: 'next' | 'all' | 'follow' | 'unfollow';
	acc: boolean;
	dim: boolean;
};

export type DownloadRow = { a: string; b: string; cells: DownloadCell[] };

/** What the row is drawn from: the server's answer, flattened. */
export type RowFacts =
	{ kind: 'ok'; states: Map<number, DownloadState> } | { kind: 'down'; since: number };

/** FOLLOW's part: whether it's on, and when Suwayomi last looked for new chapters. */
export type FollowFacts = { on: boolean; checked: number | null };

const chapters = (n: number) => `${count(n)} unread chapter${n === 1 ? '' : 's'} not downloaded`;

/**
 * The DOWNLOAD row under CONTINUE (Index Series Download, states top, down,
 * offline, follow, added). NEXT 10 is the accent cell and never asks; ALL N
 * opens its confirmation; FOLLOW ends the row as FAV ends RATING's, and turns
 * accent the same way (FOLLOWING ✓). When nothing of the series is on disk
 * yet, NEXT is FIRST. Not answering and offline keep the row and its cells,
 * dimmed, so the screen doesn't jump, and say why in the LINK row's ○ wording.
 */
export function downloadRow(
	entries: Entry[],
	facts: RowFacts,
	online: boolean,
	clock: (at: number) => string,
	follow: FollowFacts | null = null,
	ago: (at: number) => string = clock
): DownloadRow {
	const followCell = (dim: boolean): DownloadCell[] =>
		follow
			? [
					follow.on
						? { label: 'FOLLOWING ✓', which: 'unfollow', acc: true, dim }
						: { label: 'FOLLOW', which: 'follow', acc: false, dim }
				]
			: [];
	if (facts.kind === 'down' || !online) {
		const missing = entries.filter((e) => !e.available && e.readAt === null && !e.matter).length;
		return {
			a: missing ? chapters(missing) : 'Every unread chapter downloaded',
			b: !online
				? '○ OFFLINE · DOWNLOADING NEEDS THE WORKSTATION'
				: `○ NOT ANSWERING · SUWAYOMI ON THE WORKSTATION · SINCE ${clock((facts as { since: number }).since)}`,
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
	cells.push(...followCell(false));
	const caughtUp = c.missingUnread === 0 || c.queueable === 0;
	return {
		a:
			c.missingUnread > 0 && !(follow?.on && caughtUp)
				? chapters(c.missingUnread)
				: 'Every unread chapter downloaded or on its way',
		b:
			follow?.on && caughtUp && !c.failed
				? `FOLLOWING · NEW CHAPTERS DOWNLOAD AS THEY APPEAR${follow.checked ? ` · CHECKED ${ago(follow.checked)}` : ''}`
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
 * languages). A source whose series are mostly hidden here (Toonily: 110 of
 * 124) is asked only while reveal is on, and with reveal off it isn't counted
 * either: its results would put adult covers on a screen that promised none.
 */
export function sourcesToSearch(
	installed: { id: string; name: string }[],
	use: Map<string, SourceUse>,
	reveal: boolean
): { id: string; name: string }[] {
	return installed.filter((s) => {
		const u = use.get(s.id);
		if (!u || u.series === 0) return false;
		return reveal || !mostlyHidden(u);
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
	| { kind: 'in-library'; seriesId: number; meta: string }
	/** The same title from another source: said, to head off a twin. */
	| { kind: 'same-title'; source: string }
	| { kind: 'new' };

// ---- FOLLOW (Download States 1d) ----------------------------------------------------------

/**
 * The chapters FOLLOW queues: fetched by Suwayomi after the series was
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
