import { KEEP_DAYS } from './keep.ts';
import { clock as timeAt } from './anime.ts';
import { kindLabel } from './labels.ts';
import { kindFacts } from './kinds.ts';
import type { Kind } from './types.ts';

/**
 * History (Index Addendum): one row per series per day, newest first, built
 * from the append-only reading log (doc/READING-LOG.md, doc/HISTORY.md).
 *
 * A manhwa binge is twenty chapters in one sitting, so a row gives the range
 * read that day and the last time, never a row per chapter.
 */

/** One series' reading on one day, as the server aggregates it. */
export type HistoryDay = {
	seriesId: number;
	title: string;
	kind: Kind;
	hue: number;
	/** The cover thumbnail's version, or null (doc/COVERS.md). */
	cover: number | null;
	/** Local calendar day, `YYYY-MM-DD`. */
	day: string;
	/** The last event that day, epoch ms. */
	lastAt: number;
	/** Time read that day, ms (reading-time.ts; card c443). 0 for none recorded. */
	timeMs?: number;
	/** Entries in the series; 1 for a single book. */
	entryCount: number;
	/** The series' status as imported: 'completed', 'ongoing' or ''. */
	status: string;
	/** False for a browsing record (doc/READING-ONLINE.md): opened from a source, never added. */
	inLibrary?: boolean;
	/** A record forgotten (FORGET) or pruned (not opened for 30 days); its place is gone. */
	pruned?: 'forgotten' | 'unopened' | null;
	/** Its key at the source: where its preview, + ADD and FIND are. */
	originKey?: string | null;
	/** The lowest and highest entry opened that day, by reading order. */
	first: { label: string; rank: number };
	last: {
		label: string;
		rank: number;
		/** The last page seen in that entry, 0-based, or null. */
		page: number | null;
		pageCount: number;
		/** A finish event for it that day. */
		finished: boolean;
	};
};

/** A row ready to draw: the meta line for tablet and phone, and the time. */
export type HistoryRow = HistoryDay & { meta: string; metaShort: string; time: string };

/** "Ch. 380" and "Ch. 388" make "CH. 380 → 388"; unlike labels keep both. */
export function entryRange(first: string, last: string): string {
	const a = first.toUpperCase();
	const b = last.toUpperCase();
	if (a === b) return a;
	const prefix = (s: string) => s.replace(/[\d.]+\s*$/, '');
	const pa = prefix(a);
	return pa !== '' && pa === prefix(b) ? `${a} → ${b.slice(pa.length)}` : `${a} → ${b}`;
}

/**
 * "MANHWA · CH. 380 → 388 · P. 12", "MANGA · CH. 22 · P. 9 OF 31",
 * "NOVEL · VOL. 13 · 41%", "MANGA · CH. 131 → 140 · UP TO DATE",
 * "MANGA · CH. 97 · FINISHED", "DOUJIN · P. 18 OF 30", "ANIME · EP. 3 → 5 · 9:28".
 * A browsing record says so after its kind: "ANIME · NOT IN LIBRARY · EP. 1 · 4:10";
 * the phone's tag is NOT IN LIB. A forgotten one says NOT KEPT and why, and no
 * place: "ANIME · NOT KEPT · NOT OPENED IN 30 DAYS".
 *
 * `short` is the phone's: the page and UP TO DATE drop off a range, which is
 * where the phone runs out of width first.
 */
export function historyMeta(d: HistoryDay, short = false): string {
	const parts = [kindLabel(d.kind)];
	if (d.pruned)
		return [
			...parts,
			'NOT KEPT',
			d.pruned === 'unopened' ? `NOT OPENED IN ${KEEP_DAYS} DAYS` : 'FORGOTTEN'
		].join(' · ');
	if (d.inLibrary === false) parts.push(short ? 'NOT IN LIB' : 'NOT IN LIBRARY');
	const single = d.entryCount <= 1;
	const range = d.first.rank !== d.last.rank;
	if (!single) {
		parts.push(
			kindFacts(d.kind).grouping === 'books'
				? range
					? `BOOK ${d.first.rank} → ${d.last.rank}`
					: `BOOK ${d.last.rank}`
				: entryRange(d.first.label, d.last.label)
		);
	}
	const atEnd = d.last.finished && d.last.rank >= d.entryCount;
	if (atEnd) {
		if (single || d.status === 'completed') parts.push('FINISHED');
		else if (!(short && range)) parts.push('UP TO DATE');
	} else if (kindFacts(d.kind).medium === 'video' && !d.last.finished && d.last.page !== null) {
		// An episode's place is seconds into it (doc/ANIME.md): "EP. 7 · 9:28".
		if (!(short && range)) parts.push(timeAt(d.last.page));
	} else if (!d.last.finished && d.last.page !== null && d.last.pageCount > 0) {
		const page = Math.min(d.last.pageCount, d.last.page + 1);
		if (kindFacts(d.kind).medium === 'text')
			parts.push(`${Math.round((page / d.last.pageCount) * 100)}%`);
		else if (!range) parts.push(`P. ${page} OF ${d.last.pageCount}`);
		else if (!short) parts.push(`P. ${page}`);
	}
	return parts.join(' · ');
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** `YYYY-MM-DD` of a local date. */
export function dayKey(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDay(day: string): Date {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d);
}

/** "WED 23 SEP" */
export function dayName(day: string): string {
	const d = parseDay(day);
	return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * A day's section label, numbered from the top of the history: "01 — TODAY"
 * with the date on the right, "02 — YESTERDAY", then "03 — MON 21 SEP". The
 * right side of an older day carries the year only where the year changes
 * from the day above it (or from today's, for the first one), so a long
 * history says 2025 once, where 2025 begins.
 */
export function dayLabel(
	day: string,
	index: number,
	today: string,
	above: string | null
): { left: string; right: string } {
	const n = String(index).padStart(2, '0');
	const yesterday = dayKey(new Date(parseDay(today).getTime() - 12 * 3600e3));
	if (day === today) return { left: `${n} — TODAY`, right: dayName(day) };
	if (day === yesterday) return { left: `${n} — YESTERDAY`, right: dayName(day) };
	const year = day.slice(0, 4);
	const prev = (above ?? today).slice(0, 4);
	return { left: `${n} — ${dayName(day)}`, right: year !== prev ? year : '' };
}

/** "23:40", in the workstation's local time like the day itself. */
export function clock(at: number): string {
	const d = new Date(at);
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Reading time (card c443), in the house's terms: "12 H 40" from an hour,
 * "40 MIN" under it, "< 1 MIN" for a glance and "0 MIN" for none. Minutes are
 * whole and rounded down, so a total never claims a minute that wasn't read.
 */
export function readTime(ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / 60_000);
	if (minutes === 0) return ms > 0 ? '< 1 MIN' : '0 MIN';
	if (minutes < 60) return `${minutes} MIN`;
	return `${Math.floor(minutes / 60)} H ${String(minutes % 60).padStart(2, '0')}`;
}

/** "SINCE 12 MAY 2023": where a total starts, so it isn't read as everything. */
export function sinceDay(day: string): string {
	const d = parseDay(day);
	return `SINCE ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
