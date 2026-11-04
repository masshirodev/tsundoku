import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import {
	historyDays,
	historyTotals,
	isDay,
	removeHistoryRow,
	restoreHistoryRow
} from '$lib/server/history';
import {
	clock,
	dayKey,
	dayLabel,
	historyMeta,
	readTime,
	sinceDay,
	type HistoryRow
} from '$lib/library/history';
import { kindLabel } from '$lib/library/labels';
import { previewIdOf } from '$lib/server/downloads';

/** Days per page; `?before=` continues from the last one shown. */
const PAGE_DAYS = 60;

export const load: PageServerLoad = ({ cookies, url }) => {
	const reveal = isRevealed(cookies);
	const before = url.searchParams.get('before');
	// The index a page's first day carries, so page two carries on from 61.
	const from = Math.max(1, Number(url.searchParams.get('n')) || 1);
	const { rows, older } = historyDays(reveal, {
		before: before && isDay(before) ? before : null,
		days: PAGE_DAYS
	});

	// Days and times are the workstation's, the same clock SQLite grouped by,
	// so both are rendered here rather than in the tablet's time zone.
	const today = dayKey(new Date());
	const days: {
		day: string;
		left: string;
		right: string;
		rows: (HistoryRow & { preview: string | null; spent: string | null })[];
	}[] = [];
	for (const r of rows) {
		let d = days[days.length - 1];
		if (!d || d.day !== r.day) {
			const label = dayLabel(
				r.day,
				from + days.length,
				today,
				d?.day ?? (before && isDay(before) ? before : null)
			);
			d = { day: r.day, ...label, rows: [] };
			days.push(d);
		}
		d.rows.push({
			...r,
			// A browsing record's preview, where + ADD posts (doc/BROWSING.md).
			preview: r.inLibrary === false ? previewIdOf(r.originKey ?? null) : null,
			originKey: undefined,
			meta: historyMeta(r),
			metaShort: historyMeta(r, true),
			time: clock(r.lastAt),
			// The day's time read (card c443): nothing when the log holds none.
			spent: r.timeMs ? readTime(r.timeMs) : null
		});
	}
	return { days, older, next: from + days.length, total: before ? null : total(reveal) };
};

/**
 * The total at the top of the first page (card c443): everything the viewer may
 * see, and each kind's, with SINCE where it starts, so a total is never read as
 * all the reading there ever was. A kind whose log starts with the total's says
 * nothing more; a later one (novels, logged since /api/reading) says its day.
 */
function total(reveal: boolean) {
	// Without the sources kept OFF HISTORY (card c435).
	const t = historyTotals(reveal);
	if (t.ms <= 0 || !t.since) return null;
	return {
		time: readTime(t.ms),
		since: sinceDay(t.since),
		kinds: t.kinds
			.filter((k) => k.ms > 0)
			.sort((a, b) => b.ms - a.ms)
			.map((k) => ({
				kind: k.kind,
				label: [
					`${kindLabel(k.kind)} ${readTime(k.ms)}`,
					...(k.since === t.since ? [] : [sinceDay(k.since)])
				].join(' · ')
			}))
	};
}

function target(form: FormData) {
	const series = Number(form.get('series'));
	const day = String(form.get('day') ?? '');
	return Number.isInteger(series) && series > 0 && isDay(day) ? { series, day } : null;
}

export const actions: Actions = {
	remove: async ({ request }) => {
		const t = target(await request.formData());
		if (!t) return fail(400, { message: 'no such row' });
		removeHistoryRow(t.series, t.day);
		return { removed: t };
	},
	undo: async ({ request }) => {
		const t = target(await request.formData());
		if (!t) return fail(400, { message: 'no such row' });
		restoreHistoryRow(t.series, t.day);
		return { restored: t };
	}
};
