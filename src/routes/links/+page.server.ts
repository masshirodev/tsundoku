import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { linkQueue, linkState, reviewItem, seriesAccess } from '$lib/server/catalogue';

/**
 * The link review (Link Review; doc/LINKS.md): the series AniList found, not
 * for certain, one at a time. `?series=` is one series only, from FIND or
 * CHANGE on its screen, whether or not the pass offered it; `&paste` opens
 * on PASTE A LINK.
 */
export const load: PageServerLoad = ({ cookies, url }) => {
	const reveal = isRevealed(cookies);
	const one = url.searchParams.get('series');
	if (one !== null) {
		const id = Number(one);
		const access = Number.isInteger(id) ? seriesAccess(id, reveal) : null;
		const item = access ? reviewItem(id, reveal) : null;
		const state = item ? linkState(id) : null;
		if (!item || !access || !state) error(404, 'not found');
		return {
			items: [item],
			single: {
				hidden: access.hidden,
				linked: state.linked?.title || state.linked?.ids || null,
				queued: state.queued
			},
			paste: url.searchParams.has('paste')
		};
	}
	return { items: linkQueue(reveal), single: null, paste: false };
};
