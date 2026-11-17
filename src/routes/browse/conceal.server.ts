import { forgetSourceUse } from '$lib/server/library-sources';
import { WorkError, setHiddenWhole, undoHideWhole, worksTouched } from '$lib/server/works';
import { concealable, hiddenOf, ofSource, seriesMarks } from '$lib/server/engine/source-flags';

/**
 * CONCEAL ITS SERIES (doc/BROWSE.md, "Conceal its series"): the
 * one-time action on a source's settings page that hides every series from
 * the source the library shows, through `setHiddenWhole`, which keeps a Work
 * whole, with a band that says what changed and UNDO. It is an action,
 * not a switch: nothing is stored in `settings`, and a series added from the
 * source afterwards is not hidden by it (ADDED HIDDEN is that switch).
 *
 * The band is its URL, so it survives a reload: `concealed` is every series
 * the press hid, each as `<id>.<mark>` (`seriesMarks`), and `of` the source.
 * The ids are carried, never "the series from this source", because one
 * added between the press and UNDO is not the press's; and each id carries
 * its mark, because an id is given again once its series is gone.
 */

/** The band's own URL parameters: said once, and never part of another link. */
export const CONCEAL_PARAMS = ['concealed', 'of'] as const;

/**
 * At most this many ids are carried (and read back), so the band's URL stays
 * well under Node's 16 KB for a request's head (about 14 characters an id):
 * a source with more shown series is refused, and says so.
 */
export const CONCEAL_MAX = 600;

/** What the cell and its question say: what the press would hide now. */
export function concealCount(sourceId: string) {
	const { own, others } = concealable(sourceId);
	return { own: own.length, others: others.length, works: worksTouched(own).length };
}

/**
 * The press: hides them, and answers the band's query, or why nothing was
 * hidden: nothing of the source is shown (the cell is disabled then, and a
 * post anyway is refused), or too many to carry.
 */
export function conceal(
	sourceId: string
): { ok: true; query: string } | { ok: false; message: string } {
	const { own, others } = concealable(sourceId);
	if (own.length === 0) return { ok: false, message: 'nothing from it is shown' };
	if (own.length + others.length > CONCEAL_MAX)
		return { ok: false, message: `more than ${CONCEAL_MAX} series: hide them from the library` };
	const facts = setHiddenWhole(own, true);
	// BROWSE's counts (and so `mostlyHidden`) are asked again at once.
	forgetSourceUse();
	if (facts.ids.length === 0) return { ok: false, message: 'nothing from it is shown' };
	const marks = seriesMarks(facts.ids);
	const q = new URLSearchParams({
		concealed: facts.ids.map((id) => `${id}.${marks.get(id)}`).join(','),
		of: sourceId
	});
	return { ok: true, query: q.toString() };
}

/** The ids of a band's `concealed` whose marks still match: the series it may still name. */
function carried(raw: string | null): number[] {
	if (!raw) return [];
	const pairs = raw
		.split(',')
		.slice(0, CONCEAL_MAX)
		.map((p) => /^(\d{1,12})\.([0-9a-f]{6})$/.exec(p))
		.filter((m) => m !== null)
		.map((m) => ({ id: Number(m[1]), mark: m[2] }));
	const now = seriesMarks(pairs.map((p) => p.id));
	return pairs.filter((p) => now.get(p.id) === p.mark).map((p) => p.id);
}

export type ConcealBand = {
	/** The query UNDO posts back. */
	concealed: string;
	of: string;
	/** Series the press hid that are still hidden: what UNDO would show. */
	hidden: number;
	/** Of those, from the source; the rest are parts of their Works. */
	own: number;
	others: number;
	works: number;
};

/** The band, from its URL: null once nothing it hid is hidden any more (UNDO ran, or was shown again). */
export function concealBand(p: URLSearchParams): ConcealBand | null {
	const of = p.get('of') ?? '';
	const raw = p.get('concealed');
	if (!of || !raw) return null;
	const still = hiddenOf(carried(raw));
	if (still.length === 0) return null;
	const own = ofSource(still, of).length;
	return {
		concealed: raw,
		of,
		hidden: still.length,
		own,
		others: still.length - own,
		works: worksTouched(still).length
	};
}

/**
 * UNDO: what the press hid is shown again, through the same rule
 * (`undoHideWhole`): only what it hid and is still hidden, and a Work only
 * while every hidden part of it is one the press hid, so a series hidden
 * before the press, or since, stays hidden. Twice, or after a reload, it
 * shows what is left and nothing else. Answers a refusal's words, or null.
 */
export function undoConceal(form: FormData): string | null {
	const ids = carried(String(form.get('concealed') ?? ''));
	try {
		undoHideWhole({ hidden: hiddenOf(ids), out: [] });
	} catch (e) {
		if (e instanceof WorkError) return e.message;
		throw e;
	}
	forgetSourceUse();
	return null;
}
