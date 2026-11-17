/**
 * A reader's own URL, kept in the history entry as well as the address bar.
 *
 * SvelteKit keeps each history entry's own URL in its state under
 * `sveltekit:pageurl` (2.70.3: `constants.js:4`, set by `replaceState` at
 * `client.js:2573`), and a popstate into that entry navigates to the URL it
 * finds there, not to `location` (`client.js:2883`). `replaceState` writes that
 * URL from `page.url`, which stays at the last *real* navigation, so a reader
 * that moves its place — or its chapter — in place leaves history naming the
 * old one. BACK into the entry would then open the first chapter, not the one
 * read on to; and because a popstate navigation never rewrites the entry
 * (`client.js:1873`), the address bar would say the right thing while the
 * page drew the wrong chapter.
 *
 * A full load's first entry has no `sveltekit:pageurl` (SvelteKit writes only
 * its indexes, `client.js:376-381`), and popstate falls back to `location`,
 * which is already right; there is nothing to patch there.
 *
 * Call it straight after `replaceState`, once the address bar shows the URL.
 */
export function keepHistoryUrl(): void {
	const state = history.state as Record<string, unknown> | null;
	if (!state || !('sveltekit:pageurl' in state)) return;
	history.replaceState({ ...state, 'sveltekit:pageurl': location.href }, '');
}
