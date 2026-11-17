import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { libraryRoot } from '$lib/server/import';
import { tickingImport } from '$lib/server/import/log';
import { firstReadExtras, setSkipped } from '$lib/server/start';
import { isRevealed } from '$lib/server/prefs';
import { STEPS, type StepId } from '$lib/library/start';

/**
 * GET STARTED as a page of its own (doc/ONBOARDING.md): the same
 * list the empty library shows, reachable from HELP's first topic and the
 * sidebar on any install, finished or not. Its SKIP and UNDO are the empty
 * library's too. The view itself comes with the layout.
 */
export const load: PageServerLoad = ({ cookies }) => {
	const reveal = isRevealed(cookies);
	// 03's done row names what ticked it: the import
	// whose job brought the first series 03 counts, else the scan's own line.
	const imported = tickingImport(reveal);
	return { libraryRoot: libraryRoot(), firstRead: firstReadExtras(reveal), imported };
};

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
