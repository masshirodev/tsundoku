import { navigating, page } from '$app/state';

/**
 * Whether the reader is on its way out (c565): a navigation to another screen
 * has begun, or the window already shows another one.
 *
 * A reader stays mounted while the screen it is going to loads, and any timer
 * or late answer that writes the URL meanwhile writes it onto the wrong history
 * entry. BACK to the series is the measured case: the browser's entry is
 * already the series' when the reader's settle timer fired, and its
 * `replaceState` made it `/read/<id>?p=1`, so the series screen was drawn
 * under the reader's URL and its reload, share or BACK went to the reader. A
 * late `goto` is worse: it replaces the navigation away with one back in.
 *
 * Moving between chapters (`/read` to `/read`) is not leaving. The second test,
 * the window's path against the page's, catches the moment after the browser
 * moved and before SvelteKit's `navigating` says so.
 */
export function leavingReader(): boolean {
	const to = navigating.to;
	if (to && to.route.id !== '/read/[entry]') return true;
	return location.pathname !== page.url.pathname;
}
