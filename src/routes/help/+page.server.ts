import type { PageServerLoad } from './$types';
import { updatesOn } from '$lib/server/updates';

/** HELP's list (doc/HELP.md): which topics can't apply on this install. */
export const load: PageServerLoad = ({ locals }) => ({
	place: { updater: updatesOn(), overWifi: locals.via === 'lan' }
});
