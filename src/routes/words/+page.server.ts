import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { candidates, decide, flushPending, kumiko, sentCount } from '$lib/server/japanese/mining';

/**
 * Words (Index Japanese 3a; doc/JAPANESE.md, "Mining"): what was looked up
 * while reading Japanese, waiting for approval. Nothing reaches Kumiko
 * without it. Hidden series' words only with reveal on.
 */
export const load: PageServerLoad = ({ cookies }) => ({
	words: candidates(isRevealed(cookies)),
	sent: sentCount(),
	setUp: kumiko() !== null
});

const lemmas = (v: FormDataEntryValue | null) =>
	String(v ?? '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

export const actions: Actions = {
	/** SEND: the rejected are recorded, the approved go to Kumiko. */
	send: async ({ request }) => {
		const form = await request.formData();
		return decide({ approve: lemmas(form.get('approve')), reject: lemmas(form.get('reject')) });
	},
	/** RETRY SEND: the approved Kumiko didn't take, again. */
	retry: async () => ({ ...(await flushPending()), rejected: 0 })
};
