import type { PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { importLog } from '$lib/server/import/log';

/** The IMPORT LOG (c438; Import-Log): every import and scan, newest first. */
export const load: PageServerLoad = ({ cookies }) => ({
	entries: importLog(isRevealed(cookies)),
	now: Date.now()
});
