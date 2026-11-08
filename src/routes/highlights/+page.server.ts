import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import {
	deleteHighlight,
	diskUse,
	getHighlight,
	HighlightError,
	listHighlights,
	setColour,
	setNote,
	undoDeleteHighlight
} from '$lib/server/highlights';
import {
	filterHighlights,
	HIGHLIGHT_KINDS,
	kindCounts,
	seriesOf,
	type HighlightKind
} from '$lib/library/highlights';

/**
 * HIGHLIGHTS (doc/HIGHLIGHTS.md; card c701; the handoff's Page board): every
 * highlight newest first by day, or one series' in reading order with
 * `?series=`. The filters, the search and the open item are all in the URL,
 * so a reload, the back button and a link from the series screen land on the
 * same view. Hidden means hidden, by the stored flag, in SQL
 * (src/lib/server/highlights.ts): a hidden series' highlights are not listed,
 * counted or in the disk line without reveal, deleted series included.
 */

const kindOf = (v: string | null): HighlightKind | null =>
	(HIGHLIGHT_KINDS as readonly string[]).includes(v ?? '') ? (v as HighlightKind) : null;

const idOf = (v: string | null): number | null => {
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : null;
};

export const load: PageServerLoad = async ({ url, cookies }) => {
	const reveal = isRevealed(cookies);
	const all = listHighlights(reveal);
	const filter = {
		kind: kindOf(url.searchParams.get('kind')),
		series: idOf(url.searchParams.get('series')),
		lost: url.searchParams.get('lost') === '1',
		q: (url.searchParams.get('q') ?? '').trim().slice(0, 200)
	};
	// The chips count what the other filters leave: ALL 38 · QUOTES 22 of this
	// series and this search, whatever kind is chosen.
	const scope = filterHighlights(all, { ...filter, kind: null, lost: false });
	const items = filterHighlights(all, filter);
	const openId = idOf(url.searchParams.get('open'));
	const open = openId !== null ? getHighlight(openId, reveal) : null;
	// CH. 3 OF 212: the series' own count while it is there.
	const of =
		open?.seriesId != null
			? (
					getDb()
						.prepare(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND shadowed = 0`)
						.get(open.seriesId) as { n: number }
				).n
			: null;
	const seriesList = seriesOf(all);
	return {
		all: all.length,
		items,
		counts: kindCounts(scope),
		filter,
		seriesList,
		// The series set by ?series=, by its name, for the head and EXPORT's file.
		seriesTitle:
			filter.series !== null
				? (seriesList.find((s) => s.id === filter.series)?.title ?? null)
				: null,
		open: open ? { ...open, of } : null,
		disk: diskUse(reveal),
		reveal,
		now: Date.now()
	};
};

const idFrom = (form: FormData) => idOf(String(form.get('id') ?? ''));

/** A refusal says why, never silently (the series screen's rule). */
function refused(e: unknown) {
	if (e instanceof HighlightError) return fail(400, { message: e.message });
	throw e;
}

export const actions: Actions = {
	/** NOTE: a few lines of plain text, saved as typed. */
	note: async ({ request, cookies }) => {
		const form = await request.formData();
		const id = idFrom(form);
		if (id === null) return fail(400, { message: 'no such highlight' });
		try {
			setNote(id, String(form.get('note') ?? ''), isRevealed(cookies));
		} catch (e) {
			return refused(e);
		}
		return { saved: id };
	},

	/** YELLOW, ORANGE, BLUE: a quote's colour. */
	colour: async ({ request, cookies }) => {
		const form = await request.formData();
		const id = idFrom(form);
		if (id === null) return fail(400, { message: 'no such highlight' });
		try {
			setColour(id, String(form.get('colour') ?? ''), isRevealed(cookies));
		} catch (e) {
			return refused(e);
		}
		return { saved: id };
	},

	/** DELETE, at once; the band offers UNDO (Main 02). */
	delete: async ({ request, cookies }) => {
		const id = idFrom(await request.formData());
		if (id === null) return fail(400, { message: 'no such highlight' });
		try {
			deleteHighlight(id, isRevealed(cookies));
		} catch (e) {
			return refused(e);
		}
		return { deleted: id };
	},

	undo: async ({ request, cookies }) => {
		const id = idFrom(await request.formData());
		if (id === null || !undoDeleteHighlight(id, isRevealed(cookies)))
			return fail(400, { message: 'that highlight has gone for good' });
		return { restored: id };
	}
};
