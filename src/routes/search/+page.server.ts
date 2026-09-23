import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { search } from '$lib/server/library';
import { isRevealed, runCommand } from '$lib/server/prefs';
import { startScan } from '$lib/server/import';
import { parseSearch } from '$lib/library/search';

export const load: PageServerLoad = ({ url, cookies }) => {
	const q = url.searchParams.get('q') ?? '';
	const input = parseSearch(q);
	// A command is not searched for: `/reveal` must not list what it is about
	// to reveal before Enter is pressed.
	if (input.type !== 'query') return { q, result: null };
	return { q, result: search(input.text, isRevealed(cookies)) };
};

export const actions: Actions = {
	/**
	 * Enter in the search field. A command runs and returns to the library;
	 * anything else is a query and stays here.
	 */
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const input = parseSearch(String(form.get('q') ?? ''));
		if (input.type === 'command') {
			// /scan rescans the device copies; the library shows the job.
			if (input.command === 'scan') startScan();
			else runCommand(cookies, input.command, url);
			redirect(303, '/');
		}
		if (input.type === 'empty') redirect(303, '/search');
		redirect(303, `/search?q=${encodeURIComponent(input.text)}`);
	}
};
