import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { concealBand, undoConceal } from './conceal.server';
import { addedBand, undoAdded } from './added.server';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseList, noteSolvedChecks } from '$lib/server/engine/browse';

/**
 * BROWSE (Index-Browse, sources; doc/BROWSE.md; card c142): every installed
 * source in the owner's languages, RECENT first, then by kind. Read from
 * tsundoku's own tables, so it draws even while the engine isn't answering.
 */
export const load: PageServerLoad = async ({ cookies, url }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	// Sites the engine has passed a check for since it started, so their lines say so.
	await noteSolvedChecks();
	return {
		list: browseList(isRevealed(cookies)),
		now: Date.now(),
		// CONCEAL ITS SERIES outside reveal (card c523): the source is mostly
		// hidden now, so its settings page is not found and the band is here.
		concealed: concealBand(url.searchParams),
		// ADD outside reveal that left its source mostly hidden (c505): the
		// source's page is not found, so the ADDED band is here, and names no source.
		added: await addedBand(url.searchParams, null)
	};
};

export const actions: Actions = {
	/** UNDO on CONCEAL's band, here: the same UNDO as the settings page's (`undoConceal`). */
	undoConceal: async ({ request }) => {
		const refused = undoConceal(await request.formData());
		if (refused) return fail(409, { message: refused });
		redirect(303, '/browse');
	},
	/** UNDO on the ADDED band, here: the same UNDO as the source page's (`undoAdded`). */
	undoAdd: async ({ request, cookies }) => {
		const r = await undoAdded(await request.formData(), null, isRevealed(cookies));
		if ('to' in r) redirect(303, r.to);
		return fail(r.status, { added: r.message });
	}
};
