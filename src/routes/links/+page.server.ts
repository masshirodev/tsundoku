import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import {
	asReviewCandidate,
	linkState,
	linkQueue,
	reviewItem,
	seriesAccess,
	type ReviewCandidate
} from '$lib/server/catalogue';
import { configured, suggestConfigured } from '$lib/server/ranobe';
import { ranobeItem, ranobeQueue, ranobeSeries } from '$lib/server/ranobe-review';
import {
	seasonCandidates,
	seasonRelations,
	seasonSearch,
	seriesSeasons,
	type RelationOffer
} from '$lib/server/season-links';
import { account } from '$lib/server/tracking';

/**
 * The link review (Link Review, Ranobe Review; doc/LINKS.md, doc/RANOBE.md):
 * the series a catalogue found, not for certain, one at a time. A novel
 * unsure on both sides comes up twice, Ranobe first: that's where its reads
 * go. `?series=` is one series only, from FIND or CHANGE on its screen,
 * whether or not the pass offered it (`&service=ranobe` for Ranobe's);
 * `&paste` opens on PASTE A LINK.
 *
 * `&season=` is one season of an anime (c240): the review asked in the
 * anime catalogue with that season's own title, and, once it is linked, the
 * rest of the show from the entry's own prequels and sequels.
 */
export const load: PageServerLoad = async ({ cookies, url }) => {
	const reveal = isRevealed(cookies);
	const one = url.searchParams.get('series');
	if (one !== null) {
		const id = Number(one);
		const access = Number.isInteger(id) ? seriesAccess(id, reveal) : null;
		if (!access) error(404, 'not found');
		if (url.searchParams.get('service') === 'ranobe') {
			const item = configured() ? ranobeItem(id) : null;
			const state = ranobeSeries(id);
			if (!item || !state) error(404, 'not found');
			return {
				items: [item],
				single: {
					hidden: access.hidden,
					linked: state.link?.title ?? null,
					wrongKind: false,
					queued: item.queued
				},
				season: null,
				relations: null,
				paste: url.searchParams.has('paste'),
				canSuggest: suggestConfigured()
			};
		}
		const item = reviewItem(id, reveal);
		if (!item) error(404, 'not found');
		// An anime's season: its own title, its own candidates, and the entry its
		// line names (c240).
		const view = item.kind === 'anime' ? seriesSeasons(id) : null;
		const seasonParam = Number(url.searchParams.get('season'));
		const at = view
			? (view.seasons.find((s) => s.season === seasonParam) ??
				view.seasons.find((s) => s.season === view.open) ??
				view.seasons[0] ??
				null)
			: null;
		// The LINK row is the season's own, never the open season's or the
		// series' mirror: a season with no row of its own is not linked (c240).
		const state = linkState(id, at?.season);
		if (!state) error(404, 'not found');
		const season = at
			? {
					no: at.season,
					of: view!.seasons.length,
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
			: null;
		// The season is what a candidate is checked against: its own title, and its
		// own episode count (24 here, 24 there), never the whole show's (c240).
		const seasonItem = at ? { ...item, title: at.searchTitle, chapters: at.aired } : item;
		const candidates: ReviewCandidate[] = at
			? seasonCandidates(id, at.season).map((c) => asReviewCandidate(seasonItem, c))
			: item.candidates;
		// The other seasons, from the entry just linked: only when there is a
		// season left to offer one to, and only for the owner's own AniList.
		const relations = await relationsFor(id, at, view);
		const row = at ? seasonSearch(id, at.season) : null;
		return {
			items: [
				{
					...item,
					service: 'anilist' as const,
					candidates,
					// The season's own search: what the page's copy says it asked, and when.
					...(at
						? {
								query: row?.query ?? at.searchTitle,
								searched: !!row?.searchedAt,
								searchedAt: row?.searchedAt ?? null,
								found: row?.found ?? 0
							}
						: {})
				}
			],
			single: {
				hidden: access.hidden,
				linked: state.linked?.title || state.linked?.ids || null,
				wrongKind: state.linked?.wrongKind ?? false,
				queued: at?.queued ?? state.queued
			},
			season,
			relations,
			paste: url.searchParams.has('paste'),
			canSuggest: suggestConfigured()
		};
	}
	return {
		items: [
			...ranobeQueue(),
			...linkQueue(reveal).map((i) => ({ ...i, service: 'anilist' as const }))
		],
		single: null,
		season: null,
		relations: null,
		paste: false,
		// SUGGEST TO RANOBE needs the app account's token (doc/RANOBE.md).
		canSuggest: suggestConfigured()
	};
};

/**
 * The relation offers for a season just linked, or null when there is none to
 * make: no link yet, nothing else to offer, no AniList sign-in, or AniList out
 * of reach. A page that cannot ask says so rather than failing.
 */
async function relationsFor(
	seriesId: number,
	at: { season: number; link: unknown } | null,
	view: { seasons: { season: number; link: unknown }[] } | null
): Promise<RelationOffer[] | null> {
	if (!at || !at.link || !view) return null;
	// Nothing to offer once every other season has a link of its own.
	if (view.seasons.every((s) => s.season === at.season || s.link)) return null;
	try {
		// AniList's relations are public: no sign-in is needed to walk them (c240).
		const offers = await seasonRelations(
			seriesId,
			at.season,
			account('anilist')?.access_token ?? null
		);
		return offers && offers.length ? offers : null;
	} catch {
		return null;
	}
}
