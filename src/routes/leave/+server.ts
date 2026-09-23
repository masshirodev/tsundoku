import type { RequestHandler } from './$types';
import { endSessionModes } from '$lib/server/prefs';

/**
 * The app went to the background (doc/PRIVACY.md). Sent as a beacon from
 * the blank screen, so it is a POST that nobody waits for: it ends reveal
 * and incognito, and says whether either was on.
 */
export const POST: RequestHandler = ({ cookies }) => {
	const ended = endSessionModes(cookies);
	return new Response(null, { status: 204, headers: { 'x-ended': ended ? '1' : '0' } });
};
