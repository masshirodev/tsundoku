import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { libraryRoot } from '$lib/server/import';
import { firstReadExtras, setSkipped } from '$lib/server/start';
import { isRevealed } from '$lib/server/prefs';
import { STEPS, type StepId } from '$lib/library/start';

/**
 * GET STARTED as a page of its own (doc/ONBOARDING.md; card c208): the same
 * list the empty library shows, reachable from HELP's first topic and the
 * sidebar on any install, finished or not. Its SKIP and UNDO are the empty
 * library's too. The view itself comes with the layout.
 */
export const load: PageServerLoad = ({ cookies }) => ({
	libraryRoot: libraryRoot(),
	firstRead: firstReadExtras(isRevealed(cookies))
});

const step = async (request: Request): Promise<StepId | null> => {
	const id = String((await request.formData()).get('step') ?? '');
	return (STEPS as string[]).includes(id) ? (id as StepId) : null;
};

export const actions: Actions = {
	skip: async ({ request }) => {
		const id = await step(request);
		if (!id) return fail(400, { message: 'no such step' });
		setSkipped(id, true);
		return { ok: true };
	},
	unskip: async ({ request }) => {
		const id = await step(request);
		if (!id) return fail(400, { message: 'no such step' });
		setSkipped(id, false);
		return { ok: true };
	}
};
