import { clock as playClock } from './anime.ts';
import { clock, dayKey, dayName } from './history.ts';
import { formatNumber } from './series.ts';

/**
 * A browsing record on its source's preview, the pure part (doc/READING-ONLINE.md;
 * cards c161, c165; Online Calls 1B and 1D): the RECORD row's words, the
 * bar's ▶ CONTINUE, and what each row says it is.
 */

export { KEEP_DAYS } from './keep.ts';

export type RowState = {
	read: boolean;
	/** Seconds into an episode, or a chapter's 0-based page. */
	position: number | null;
	durationS: number | null;
	pageCount: number;
};

export type RowLook =
	| { kind: 'plain'; status: string }
	| { kind: 'read'; status: string }
	| { kind: 'progress'; status: string; share: number };

/** "WATCHED", "14:32 LEFT" with how far, or nothing: a row of the preview's list. */
export function rowLook(s: RowState | null | undefined, anime: boolean): RowLook {
	if (!s) return { kind: 'plain', status: '' };
	if (s.read) return { kind: 'read', status: anime ? 'WATCHED' : 'READ' };
	if (s.position !== null && s.position > 0) {
		if (anime) {
			const left = s.durationS ? Math.max(0, s.durationS - s.position) : null;
			return {
				kind: 'progress',
				status: left !== null ? `${playClock(left)} LEFT` : `AT ${playClock(s.position)}`,
				share: s.durationS ? Math.min(1, s.position / s.durationS) : 0
			};
		}
		const page = s.position + 1;
		return {
			kind: 'progress',
			status: s.pageCount ? `P. ${page} / ${s.pageCount}` : `P. ${page}`,
			share: s.pageCount ? Math.min(1, page / s.pageCount) : 0
		};
	}
	return { kind: 'plain', status: '' };
}

/** The RECORD row's first line: "Not in library · 2 of 12 watched". */
export function recordLine(r: { read: number; total: number }, anime: boolean, short = false) {
	const of = `${formatNumber(r.read)} of ${formatNumber(r.total)}`;
	return `Not in library · ${of}${short ? '' : anime ? ' watched' : ' read'}`;
}

/**
 * Its second line: "LAST OPENED YESTERDAY 23:10 · KEPT UNTIL 27 NOV", or the
 * phone's "KEPT 30 DAYS AFTER THE LAST OPEN".
 */
export function keptLine(
	r: { lastOpenedAt: number; keptUntil: number },
	now: number,
	keepDays: number,
	short = false
): string {
	if (short) return `KEPT ${keepDays} DAYS AFTER THE LAST OPEN`;
	const today = dayKey(new Date(now));
	const day = dayKey(new Date(r.lastOpenedAt));
	const yesterday = dayKey(new Date(new Date(now).setHours(0, 0, 0, 0) - 12 * 3600e3));
	const when = day === today ? 'TODAY' : day === yesterday ? 'YESTERDAY' : dayName(day);
	const until = dayName(dayKey(new Date(r.keptUntil))).replace(/^\w+ /, '');
	return `LAST OPENED ${when} ${clock(r.lastOpenedAt)} · KEPT UNTIL ${until}`;
}

/**
 * The bar's first cell: what it opens, and the line beside it (Online Calls
 * 1A, 1B, 1D). A record continues where it stopped ("▶ EP. 3 · 14:32 LEFT",
 * "▶ CONTINUE · CH. 4 · P. 12"); without one, the first episode or chapter.
 */
export function continueCell(
	next: { label: string; position: number | null; durationS: number | null } | null,
	anime: boolean
): { label: string; meta: string } {
	if (!next)
		return anime ? { label: '▶ EP. 1', meta: '' } : { label: '▶ READ CH. 1', meta: 'ONLINE' };
	const at = next.position !== null && next.position > 0 ? next.position : null;
	if (anime)
		return {
			label: `▶ ${next.label.toUpperCase()}`,
			meta:
				at === null
					? ''
					: next.durationS
						? `${playClock(Math.max(0, next.durationS - at))} LEFT`
						: `AT ${playClock(at)}`
		};
	const ch = next.label.toUpperCase();
	return { label: '▶ CONTINUE', meta: at === null ? ch : `${ch} · P. ${at + 1}` };
}
