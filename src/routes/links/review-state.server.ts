import { linkState } from '$lib/server/catalogue';
import type { SeasonView } from '$lib/server/season-links';

/**
 * What `/links?series=N` draws of the season it is on (c240): the LINKED row
 * (`single`) and the season's own header and parts (`season`). The page's
 * load draws it once, and LINK N SEASONS answers it again after a partial
 * link (c465), so the page redraws the season as it now stands rather than
 * the review it opened on.
 */
export function seasonReview(
	seriesId: number,
	at: SeasonView | null,
	count: number,
	hidden: boolean
) {
	const state = linkState(seriesId, at?.season);
	if (!state) return null;
	return {
		single: {
			hidden,
			linked: state.linked?.title || state.linked?.ids || null,
			wrongKind: state.linked?.wrongKind ?? false,
			queued: at?.queued ?? state.queued
		},
		season: at
			? {
					no: at.season,
					of: count,
					from: at.from,
					to: at.to,
					count: at.count,
					aired: at.aired,
					/** What the search sends, and what the header says it asked. */
					title: at.searchTitle,
					linked: at.link?.title ?? null,
					/** The part the season's line holds: what LINK, UNLINK and UNDO act on. */
					part: at.link?.part ?? 1,
					parts: at.parts.map((p) => ({ part: p.part, from: p.from, to: p.to, linked: !!p.link }))
				}
			: null
	};
}
