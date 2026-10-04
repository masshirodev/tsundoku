import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { search } from '$lib/server/library';
import { isRevealed, runCommand } from '$lib/server/prefs';
import { startScan } from '$lib/server/import';
import { isGated } from '$lib/server/unlock';
import { parseSearch } from '$lib/library/search';
import { configured } from '$lib/server/suwayomi';
import { searchSources } from '$lib/server/suwayomi-library';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const q = url.searchParams.get('q') ?? '';
	const input = parseSearch(q);
	// A command is not searched for: `/reveal` must not list what it is about
	// to reveal before Enter is pressed.
	if (input.type !== 'query') return { q, result: null, sources: null };
	const reveal = isRevealed(cookies);
	// SEARCH THE SOURCES after the titles (Download States 1e): how many it would ask.
	const sources = configured()
		? await searchSources(reveal).then(
				(s) => s.length,
				() => null
			)
		: null;
	return { q, result: search(input.text, reveal), sources };
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
			if (input.command === 'words') redirect(303, '/words');
			if (input.command === 'scan') startScan();
			else runCommand(cookies, input.command, url, { gated: isGated() });
			redirect(303, '/');
		}
		if (input.type === 'empty') redirect(303, '/search');
		redirect(303, `/search?q=${encodeURIComponent(input.text)}`);
	}
};
