import { readTime, sinceDay } from '$lib/library/history';
import { kindLabel } from '$lib/library/labels';
import type { Kind } from '$lib/library/types';

/** `readingTotals`' shape (reading-time.ts), as `historyTotals` gives it. */
export type Totals = {
	ms: number;
	since: string | null;
	kinds: { kind: Kind; ms: number; since: string | null }[];
};

/**
 * The total at the top of HISTORY's first page: everything the
 * viewer may see, and each kind's, with SINCE where it starts, so a total is
 * never read as all the reading there ever was.
 *
 * Every SINCE is a first **timed** day: the total's is
 * the first day anything carried time, and each kind's is that kind's own, so
 * an episode or a novel logged before its time was ever measured does not date
 * hours that only start later. A kind whose first timed day is the total's
 * says nothing more, the total's line having said it; a later one says its
 * own. A kind with no time is no line (the summary has no row for it).
 */
export function historyTotal(t: Totals) {
	if (t.ms <= 0 || !t.since) return null;
	const since = t.since;
	return {
		time: readTime(t.ms),
		since: sinceDay(since),
		kinds: t.kinds
			.filter((k) => k.ms > 0 && k.since)
			.sort((a, b) => b.ms - a.ms)
			.map((k) => ({
				kind: k.kind,
				label: [
					`${kindLabel(k.kind)} ${readTime(k.ms)}`,
					...(k.since === since ? [] : [sinceDay(k.since!)])
				].join(' · ')
			}))
	};
}
