import { getDb } from './db.ts';
import { visibleWhere } from './visibility.ts';
import type { Kind } from '../library/types.ts';

/**
 * Reading time, summarised from the reading log (card c443; doc/READING-LOG.md,
 * "Who reads it"). Every place that shows a time -- the series screen, HISTORY's
 * rows and its total, and later c35's metrics and the graphs -- asks this one
 * function, so they cannot disagree about what counts:
 *
 * - **Only reading.** `open`, `page`, `finish`, `close`; a manual MARK READ is
 *   bookkeeping, and carries no time anyway.
 * - **Hidden means hidden.** The reveal filter (`visibleWhere`, the one rule in
 *   visibility.ts) is applied in SQL at every door, so a hidden series' time is
 *   not in its kind's total, nor HISTORY's, while reveal is off.
 * - **No 1970.** An event dated before `FIRST_PLAUSIBLE_DAY` is a bad clock,
 *   not reading (one live row has `at = 0`), and is left out of every
 *   summary, by series as much as by day, so the totals and the days add up.
 * - A HISTORY row REMOVEd is still reading: removing a row hides the row, and
 *   leaves the log and its time alone (doc/HISTORY.md).
 */

/**
 * The first day a reading event can honestly carry. The oldest history
 * tsundoku can hold comes from Mihon's backups (and Tachiyomi's before it),
 * and Tachiyomi's first release was in 2015; the live log starts 2023-05-12.
 * Anything earlier is a clock that was never set.
 */
export const FIRST_PLAUSIBLE_DAY = '2015-01-01';

const READING = `('open', 'page', 'finish', 'close')`;

export type TimeScope = {
	reveal: boolean;
	/** One series only. */
	seriesId?: number;
	/** Days from this one (`YYYY-MM-DD`), inclusive. */
	from?: string;
	/** Days before this one, exclusive. */
	before?: string;
};

type By = 'series' | 'kind' | 'day' | 'seriesDay';

export type TimeRow<B extends By> = { ms: number; since: string } & (B extends 'series'
	? { seriesId: number }
	: B extends 'kind'
		? { kind: Kind }
		: B extends 'day'
			? { day: string }
			: { seriesId: number; day: string });

const GROUP: Record<By, { cols: string; order: string }> = {
	series: { cols: 're.series_id AS seriesId', order: 're.series_id' },
	kind: { cols: 's.kind AS kind', order: 's.kind' },
	day: { cols: 're.day AS day', order: 're.day DESC' },
	seriesDay: { cols: 're.series_id AS seriesId, re.day AS day', order: 're.day DESC, re.series_id' }
};

/**
 * Time read, grouped `by` series, kind, day, or series and day (a HISTORY row).
 * `since` is the group's first **timed** day, the first with `duration_ms > 0`
 * (card c483, the owner's (b)): where a total could be read as everything, the
 * screen says SINCE it, and a day logged with no time on it (an anime episode
 * before c443's rung, a novel's untimed rows) would date hours that only start
 * later. So a group is a row only where it holds some time: one with none has
 * no total to date, and is no row (every reader takes a missing group as 0).
 */
export function readingTime<B extends By>(by: B, scope: TimeScope): TimeRow<B>[] {
	const where = [
		`re.kind IN ${READING}`,
		`re.day >= @floor`,
		visibleWhere(scope.reveal),
		scope.seriesId !== undefined ? `re.series_id = @series` : '1',
		scope.from !== undefined ? `re.day >= @from` : '1',
		scope.before !== undefined ? `re.day < @before` : '1'
	].join(' AND ');
	const g = GROUP[by];
	return getDb()
		.prepare(
			`SELECT ${g.cols}, SUM(re.duration_ms) AS ms,
				MIN(CASE WHEN re.duration_ms > 0 THEN re.day END) AS since
			FROM reading_events re
			JOIN series s ON s.id = re.series_id JOIN roots r ON r.id = s.root_id
			WHERE ${where}
			GROUP BY ${g.order.replace(/ DESC/g, '')}
			HAVING since IS NOT NULL
			ORDER BY ${g.order}`
		)
		.all({
			floor: FIRST_PLAUSIBLE_DAY,
			series: scope.seriesId ?? null,
			from: scope.from ?? null,
			before: scope.before ?? null
		}) as TimeRow<B>[];
}

/** One series' time read, or 0. */
export function seriesReadingTime(seriesId: number, reveal: boolean): number {
	return readingTime('series', { reveal, seriesId })[0]?.ms ?? 0;
}

/**
 * Everything the viewer may see: the kinds' totals and their sum, each with its
 * first timed day; the sum's is the earliest of the kinds' (c483).
 */
export function readingTotals(reveal: boolean): {
	ms: number;
	since: string | null;
	kinds: TimeRow<'kind'>[];
} {
	const kinds = readingTime('kind', { reveal });
	return {
		ms: kinds.reduce((n, k) => n + k.ms, 0),
		since: kinds.reduce<string | null>((d, k) => (d === null || k.since < d ? k.since : d), null),
		kinds
	};
}
