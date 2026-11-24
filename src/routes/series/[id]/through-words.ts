import { num, upper } from '$lib/i18n/format';
import { kindFacts, type Kind } from '$lib/library/kinds';
import { m } from '$lib/paraglide/messages';

/*
 * The words MARK READ THROUGH's two bands print (doc/SERIES.md): the long
 * press on a chapter row, and on an episode row too, so the unit and the verb
 * come from the series' kind. EPISODES and WATCHED on video; CHAPTERS and READ
 * on everything else, a novel's included, as the MOVED band counts
 * (`movedUnit`). Called where the band is drawn, never at import: the
 * language is per request (doc/I18N.md).
 */

const video = (kind: Kind) => kindFacts(kind).medium === 'video';

/** MARKED READ THROUGH's band: `count` rows marked, through `label` (the row's own, `Ch. 5`). */
export function markedWords(kind: Kind, count: number, label: string) {
	const l = upper(label);
	const v = video(kind);
	if (count === 0)
		return {
			title: v ? m.series_through_none_video({ label: l }) : m.series_through_none({ label: l }),
			detail: undefined
		};
	return {
		title: v ? m.series_through_marked_video({ label: l }) : m.series_through_marked({ label: l }),
		detail: v
			? m.series_through_count_video({ count, n: num(count) })
			: m.series_through_count({ count, n: num(count) })
	};
}

/** UNDO's band when some were read or marked since: `undone` put back, `kept` left as they are. */
export function putBackWords(kind: Kind, undone: number, kept: number) {
	const v = video(kind);
	return {
		title: v
			? m.series_through_put_back_video({ count: undone, n: num(undone) })
			: m.series_through_put_back({ count: undone, n: num(undone) }),
		detail: v
			? m.series_through_kept_video({ count: kept, n: num(kept) })
			: m.series_through_kept({ count: kept, n: num(kept) })
	};
}
