import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { linkQueue, linkState, reviewItem, seriesAccess } from '$lib/server/catalogue';
import { configured, suggestConfigured } from '$lib/server/ranobe';
import { ranobeItem, ranobeQueue, ranobeSeries } from '$lib/server/ranobe-review';

/**
 * The link review (Link Review, Ranobe Review; doc/LINKS.md, doc/RANOBE.md):
 * the series a catalogue found, not for certain, one at a time. A novel
 * unsure on both sides comes up twice, Ranobe first: that's where its reads
 * go. `?series=` is one series only, from FIND or CHANGE on its screen,
 * whether or not the pass offered it (`&service=ranobe` for Ranobe's);
 * `&paste` opens on PASTE A LINK.
 */
export const load: PageServerLoad = ({ cookies, url }) => {
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
					queued: item.queued
				},
				paste: url.searchParams.has('paste'),
				canSuggest: suggestConfigured()
			};
		}
		const item = reviewItem(id, reveal);
		const state = item ? linkState(id) : null;
		if (!item || !state) error(404, 'not found');
		return {
			items: [{ ...item, service: 'anilist' as const }],
			single: {
				hidden: access.hidden,
				linked: state.linked?.title || state.linked?.ids || null,
				queued: state.queued
			},
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
		paste: false,
		// SUGGEST TO RANOBE needs the app account's token (doc/RANOBE.md).
		canSuggest: suggestConfigured()
	};
};
