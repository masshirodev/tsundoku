import { linkState } from '$lib/server/catalogue';
import { secondPart, seriesSeasons, type SeasonView } from '$lib/server/season-links';
import { idsLine, wrongKind } from '$lib/library/catalogue';

/**
 * What `/links?series=N` draws of the season it is on: the LINKED row
 * (`single`) and the season's own header and parts (`season`). The page's
 * load draws it once, LINK N SEASONS answers it again, and
 * `/links/season` after that link's UNDO, so the page redraws the season as
 * it now stands rather than the review it opened on.
 *
 * `part` 2 is the season's second part by hand (`&part=2`, opened by
 * `+ A SECOND PART`): the LINKED row is part 2's own link, the decisions act
 * on part 2, and `second` says where it starts. Null when the season has no
 * second part to link (`secondPart`'s refusal), so the caller draws part 1.
 */
export function seasonReview(
	seriesId: number,
	at: SeasonView | null,
	count: number,
	hidden: boolean,
	part: 1 | 2 = 1
) {
	const state = linkState(seriesId, at?.season);
	if (!state) return null;
	const second = at ? secondPart(seriesId, at.season) : null;
	const two = second && 'ok' in second ? second.ok : null;
	if (part === 2 && !two) return null;
	const own = part === 2 ? two!.linked : null;
	const kind = seriesSeasons(seriesId)?.kind;
	return {
		single: {
			hidden,
			linked:
				part === 2
					? own
						? own.title || idsLine(own.anilistId, own.malId)
						: null
					: state.linked?.title || state.linked?.ids || null,
			wrongKind:
				part === 2
					? !!own && !!kind && wrongKind(kind, own.format ?? '')
					: (state.linked?.wrongKind ?? false),
			queued: part === 2 ? false : (at?.queued ?? state.queued)
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
					linked: part === 2 ? (own?.title ?? null) : (at.link?.title ?? null),
					/** The part the page acts on: what LINK, UNLINK and UNDO post. */
					part: part === 2 ? 2 : (at.link?.part ?? 1),
					parts: at.parts.map((p) => ({ part: p.part, from: p.from, to: p.to, linked: !!p.link })),
					/**
					 * A second part by hand: where it starts, part 1's entry, and
					 * whether one is linked. Null when the season can have none.
					 */
					second: two
						? { from: two.from, after: two.after, part1: two.part1, linked: !!two.linked }
						: null
				}
			: null
	};
}
