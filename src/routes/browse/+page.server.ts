import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseList, noteSolvedChecks } from '$lib/server/engine/browse';

/**
 * BROWSE (Index-Browse, sources; doc/BROWSE.md; card c142): every installed
 * source in the owner's languages, RECENT first, then by kind. Read from
 * tsundoku's own tables, so it draws even while the engine isn't answering.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	// Sites the engine has passed a check for since it started, so their lines say so.
	await noteSolvedChecks();
	return { list: browseList(isRevealed(cookies)), now: Date.now() };
};
