import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { linkQueue, reviewItem, seriesAccess } from '$lib/server/catalogue';
import { seasonReview } from './review-state.server';
import { configured, suggestConfigured } from '$lib/server/ranobe';
import { ranobeItem, ranobeQueue, ranobeSeries } from '$lib/server/ranobe-review';
import {
	seasonRelations,
	seasonToLook,
	seriesSeasons,
	type RelationOffer
} from '$lib/server/season-links';
import { account } from '$lib/server/tracking';
import { seasonNamed } from '$lib/library/catalogue';
import { catalogueConfigured } from '$lib/server/catalogues';
import { tmdbLinkState, tmdbQueue, tmdbReviewItem } from '$lib/server/tmdb-links';

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
 * rest of the show from the entry's own prequels and sequels. `&part=2` with
 * it is that season's second part by hand (c350): the same search, its own
 * candidates, and `FROM EP. n`.
 *
 * A film or a show is TMDB's (c989; doc/LINKS.md, "TMDB links"): its item is
 * `service: 'tmdb'`, drawn from lines the workstation prepares, as Ranobe's is.
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
		// A film or a show is TMDB's (c989): one item, the whole series, no seasons.
		const film = tmdbReviewItem(id);
		if (film) {
			if (!catalogueConfigured('tmdb')) error(404, 'TMDB needs a key');
			const state = tmdbLinkState(id);
			return {
				items: [film],
				single: {
					hidden: access.hidden,
					linked: state?.linked?.title ?? null,
					wrongKind: false,
					queued: film.queued
				},
				season: null,
				relations: null,
				paste: url.searchParams.has('paste'),
				canSuggest: false
			};
		}
		// An anime's season: its own title, its own candidates, and the entry its
		// line names (c240). `seriesSeasons` answers only for a kind a catalogue
		// lists a season at a time.
		const view = seriesSeasons(id);
		// Absent is the season that still wants a look -- the open one unless it
		// is linked or settled (`seasonToLook`) -- then the open one; never
		// season 0 (a flat list's, and real) by default.
		const seasonParam = seasonNamed(url.searchParams.get('season'));
		const toLook = view ? seasonToLook(id) : undefined;
		const at = view
			? (view.seasons.find((s) => s.season === seasonParam) ??
				view.seasons.find((s) => s.season === toLook) ??
				view.seasons.find((s) => s.season === view.open) ??
				view.seasons[0] ??
				null)
			: null;
		// `&part=2`: the season's second part by hand (c350, `+ A SECOND PART`),
		// when it can have one; otherwise the season's own page, as without it.
		const second =
			url.searchParams.get('part') === '2' && at
				? (() => {
						const drawn = seasonReview(id, at, view?.seasons.length ?? 0, access.hidden, 2);
						const item = reviewItem(id, reveal, at.season, 2);
						return drawn && item ? { drawn, item } : null;
					})()
				: null;
		// The season's own item: its search, its candidates checked against its
		// own title and episode count (24 here, 24 there), never the whole show's
		// and never the series-level search (c240, wave 17). A season whose only
		// row is part 2 (c592) stands on part 2, and its item is part 2's.
		const item = second?.item ?? reviewItem(id, reveal, at?.season, at?.link?.part ?? 1);
		if (!item) error(404, 'not found');
		// The LINK row is the season's own, never the open season's or the
		// series' mirror: a season with no row of its own is not linked (c240).
		const drawn = second?.drawn ?? seasonReview(id, at, view?.seasons.length ?? 0, access.hidden);
		if (!drawn) error(404, 'not found');
		const { single, season } = drawn;
		// The other seasons, from the entry just linked: only when there is a
		// season left to offer one to, and only for the owner's own AniList. A
		// second part's page offers none: its LINK goes back to the series.
		const relations = second ? null : await relationsFor(id, at, view);
		return {
			items: [{ ...item, service: 'anilist' as const }],
			single,
			season,
			relations,
			paste: url.searchParams.has('paste'),
			canSuggest: suggestConfigured()
		};
	}
	return {
		items: [
			...ranobeQueue(),
			...linkQueue(reveal).map((i) => ({ ...i, service: 'anilist' as const })),
			// Films and shows last: TMDB's, and none without a key (c989).
			...tmdbQueue(reveal)
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
