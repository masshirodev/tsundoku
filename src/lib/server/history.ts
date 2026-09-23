import { getDb } from './db';
import { visibleWhere } from './visibility';
import type { HistoryDay } from '$lib/library/history';
import type { Kind } from '$lib/library/types';

/**
 * History from the reading log (doc/HISTORY.md). Only reading counts -- open,
 * page, finish, close -- not MARK READ, which is bookkeeping rather than
 * reading. Days are the workstation's local calendar days, the same clock the
 * times are shown in.
 *
 * Hidden means hidden: while reveal is off a hidden series has no rows.
 * Incognito reading was never written (see /api/reading), so there is nothing
 * of it to hide.
 */

const READING = `('open', 'page', 'finish', 'close')`;
/** The event's day in the workstation's time, stored when it was written (rung 13). */
const DAY = `re.day`;

function visible(reveal: boolean): string {
	return visibleWhere(reveal);
}

/**
 * Up to `days` days that have rows, newest first, strictly before `before`
 * (a `YYYY-MM-DD`) when given. `older` is the day to continue from, or null
 * at the start of the log.
 */
export function historyDays(
	reveal: boolean,
	opts: { before?: string | null; days?: number } = {}
): { rows: HistoryDay[]; older: string | null } {
	const db = getDb();
	const limit = opts.days ?? 60;
	const before = opts.before ?? '9999-12-31';
	const scope = (join = '') => `
		FROM reading_events re ${join}
		JOIN series s ON s.id = re.series_id JOIN roots r ON r.id = s.root_id
		WHERE re.kind IN ${READING} AND ${visible(reveal)} AND ${DAY} < @before
		AND NOT EXISTS (SELECT 1 FROM history_removed h WHERE h.series_id = re.series_id AND h.day = ${DAY})`;

	const days = (
		db.prepare(`SELECT DISTINCT ${DAY} AS day ${scope()} ORDER BY day DESC LIMIT @n`).all({
			before,
			n: limit + 1
		}) as { day: string }[]
	).map((d) => d.day);
	if (days.length === 0) return { rows: [], older: null };
	const shown = days.slice(0, limit);
	const oldest = shown[shown.length - 1];

	const groups = db
		.prepare(
			`SELECT re.series_id AS seriesId, ${DAY} AS day, MAX(re.at) AS lastAt,
				MIN(e.position) AS firstPos, MAX(e.position) AS lastPos,
				s.title, s.kind, s.hue, s.status,
				(SELECT COUNT(*) FROM entries x WHERE x.series_id = s.id) AS entryCount
			${scope('JOIN entries e ON e.id = re.entry_id')} AND ${DAY} >= @oldest
			GROUP BY re.series_id, day
			ORDER BY day DESC, lastAt DESC`
		)
		.all({ before, oldest }) as {
		seriesId: number;
		day: string;
		lastAt: number;
		firstPos: number;
		lastPos: number;
		title: string;
		kind: Kind;
		hue: number;
		status: string;
		entryCount: number;
	}[];

	const entryAt = db.prepare(
		`SELECT e.id, e.label, e.page_count AS pageCount,
			(SELECT COUNT(*) FROM entries x WHERE x.series_id = e.series_id AND x.position <= e.position) AS rank
		FROM entries e WHERE e.series_id = ? AND e.position = ?`
	);
	const lastSeen = db.prepare(
		`SELECT
			(SELECT page FROM reading_events re WHERE re.entry_id = @entry AND re.page IS NOT NULL
				AND ${DAY} = @day ORDER BY re.at DESC, re.id DESC LIMIT 1) AS page,
			EXISTS (SELECT 1 FROM reading_events re WHERE re.entry_id = @entry AND re.kind = 'finish'
				AND ${DAY} = @day) AS finished`
	);

	const rows = groups.map((g): HistoryDay => {
		const first = entryAt.get(g.seriesId, g.firstPos) as { label: string; rank: number };
		const last = entryAt.get(g.seriesId, g.lastPos) as {
			id: number;
			label: string;
			pageCount: number;
			rank: number;
		};
		const seen = lastSeen.get({ entry: last.id, day: g.day }) as {
			page: number | null;
			finished: number;
		};
		return {
			seriesId: g.seriesId,
			title: g.title,
			kind: g.kind,
			hue: g.hue,
			day: g.day,
			lastAt: g.lastAt,
			entryCount: g.entryCount,
			status: g.status,
			first: { label: first.label, rank: first.rank },
			last: {
				label: last.label,
				rank: last.rank,
				page: seen.page,
				pageCount: last.pageCount,
				finished: seen.finished === 1
			}
		};
	});
	return { rows, older: days.length > limit ? oldest : null };
}

/**
 * Removing a row removes only the row: progress, the log and CONTINUE are
 * untouched. Progress is edited on the series screen with MARK UNREAD.
 */
export function removeHistoryRow(seriesId: number, day: string): void {
	getDb()
		.prepare(`INSERT OR IGNORE INTO history_removed (series_id, day) VALUES (?, ?)`)
		.run(seriesId, day);
}

export function restoreHistoryRow(seriesId: number, day: string): void {
	getDb().prepare(`DELETE FROM history_removed WHERE series_id = ? AND day = ?`).run(seriesId, day);
}

export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
