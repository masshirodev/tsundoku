import { resolve } from '$app/paths';
import { navigating, page } from '$app/state';
import { isReaderPath } from './reader';

/**
 * The path a reader moved the window to in place. It lasts until a real
 * navigation, which the reader reports with `forgetReaderMove`. Not keyed on
 * `page.url`: an invalidation gives that a new object for the same entry, so
 * the record would be lost while the reader was still reading (wave 25, r2).
 */
let moved: string | null = null;

/**
 * Say that a reader moved the window to `path` itself with `replaceState`: the
 * text reader opens the next chapter in place and writes `/read/<its id>`
 * (c565, round 2). Call it right after the write.
 */
export function readerMovedTo(path: string): void {
	moved = path;
}

/** A real navigation happened: `afterNavigate` runs for those alone. */
export function forgetReaderMove(): void {
	moved = null;
}

/** The path the window shows while this reader is still the screen. */
function ownPath(): string {
	return moved ?? page.url.pathname;
}

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
 * The window is read for the moment after the browser moved (a popstate BACK)
 * and before SvelteKit's `navigating` says so. It is another screen when its
 * path is not a reader route at all, or another reader entry than this one
 * (a BACK from one chapter's entry to the last's, where a late write would
 * put this chapter's URL on that entry). "This one" cannot be `page.url`
 * alone: SvelteKit's `replaceState` sets only `page.state` and leaves
 * `page.url` at the last real navigation, and the text reader moves between
 * chapters in place, writing `/read/<next id>` with `replaceState`. Measured
 * against `page.url` alone (round 2 of wave 25): after the first settle in the
 * second chapter every later settle read as leaving, so `?at=` froze and no
 * more progress was sent until the reader was left. So a reader that moves the
 * window itself says so with `readerMovedTo`.
 */
export function leavingReader(): boolean {
	const to = navigating.to;
	if (to && to.route.id !== '/read/[entry]') return true;
	const prefix = resolve('/read/[entry]', { entry: '_' }).slice(0, -1);
	if (!isReaderPath(location.pathname, prefix)) return true;
	return location.pathname !== ownPath();
}
