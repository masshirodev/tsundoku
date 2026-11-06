import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { concealBand, undoConceal } from './conceal.server';
import { addedBand, standingRefusal, undoAdded } from './added.server';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { engineDownSince } from '$lib/server/engine/client';
import { browseList, noteSolvedChecks } from '$lib/server/engine/browse';

/**
 * BROWSE (Index-Browse, sources; doc/BROWSE.md; card c142): every installed
 * source in the owner's languages, RECENT first, then by kind. Read from
 * tsundoku's own tables, so it draws even while the engine isn't answering.
 */
export const load: PageServerLoad = async ({ cookies, url }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	const reveal = isRevealed(cookies);
	// Sites the engine has passed a check for since it started, so their lines say so.
	await noteSolvedChecks();
	const added = await addedBand(url.searchParams, null, reveal);
	return {
		list: browseList(reveal),
		reveal,
		now: Date.now(),
		// CONCEAL ITS SERIES outside reveal (card c523): the source is mostly
		// hidden now, so its settings page is not found and the band is here.
		concealed: concealBand(url.searchParams),
		// ADD outside reveal that left its source mostly hidden (c505): the
		// source's page is not found, so the ADDED band is here. It names the
		// source only when this viewer may see it (c605).
		added,
		// A refused UNDO from a source's page, which can no longer draw its own
		// band (c605): the refusal's code is the URL's, its words are here --
		// while it still holds, re-asked on every load (c664).
		refused: standingRefusal(url.searchParams.get('refused'), added, engineDownSince() !== null)
	};
};

export const actions: Actions = {
	/** UNDO on CONCEAL's band, here: the same UNDO as the settings page's (`undoConceal`). */
	undoConceal: async ({ request }) => {
		// As the load: off the engine backend this page does not exist, so neither does its action.
		if (downloadsBackend() !== 'engine') error(404, 'not found');
		const refused = undoConceal(await request.formData());
		if (refused) return fail(409, { message: refused });
		redirect(303, '/browse');
	},
	/** UNDO on the ADDED band, here: the same UNDO as the source page's (`undoAdded`). */
	undoAdd: async ({ request, cookies }) => {
		if (downloadsBackend() !== 'engine') error(404, 'not found');
		const r = await undoAdded(await request.formData(), null, isRevealed(cookies));
		if ('to' in r) redirect(303, r.to);
		return fail(r.status, { added: r.message });
	}
};
