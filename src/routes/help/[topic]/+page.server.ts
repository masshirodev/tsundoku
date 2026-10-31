import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { updatesOn } from '$lib/server/updates';
import { topicBySlug } from '$lib/help/topics';

/**
 * A HELP topic (doc/HELP.md). 01, GETTING STARTED, is the checklist itself,
 * so it opens /start. A topic that can't apply here still opens, with its
 * band (topics.ts, notHere).
 */
export const load: PageServerLoad = ({ params, locals }) => {
	if (params.topic === 'start') redirect(303, '/start');
	if (!topicBySlug(params.topic)) error(404, 'no such topic');
	return {
		slug: params.topic,
		place: { updater: updatesOn(), overWifi: locals.via === 'lan' }
	};
};
