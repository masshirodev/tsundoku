/**
 * Going back comes back to the screen as it was left (doc/NAVIGATION.md): its
 * tab, its order, the pages it had loaded and the place in them. The browser's
 * history already keeps all that (the library's snapshot, doc/LIBRARY.md,
 * "Pages"), so an in-app ← that points where the reader came from goes back
 * in history rather than opening a fresh copy of that screen.
 *
 * Where each history entry was is noted as the app arrives on it, by
 * SvelteKit's own index in `history.state`.
 */

const KEY = 'tsundoku.history';
const INDEX = 'sveltekit:history';
const KEEP = 200;

function index(): number | null {
	const i = (history.state as Record<string, unknown> | null)?.[INDEX];
	return typeof i === 'number' ? i : null;
}

function load(): Record<number, string> {
	try {
		return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<number, string>;
	} catch {
		return {};
	}
}

/** Note where this history entry is. Called after every navigation. */
export function noteVisit(): void {
	const i = index();
	if (i === null) return;
	const map = load();
	map[i] = location.href;
	for (const k of Object.keys(map).map(Number)) if (k < i - KEEP || k > i) delete map[k];
	try {
		sessionStorage.setItem(KEY, JSON.stringify(map));
	} catch {
		// Private mode or full: links then simply open their page.
	}
}

/** How far to look back for the screen a back link opens. */
const REACH = 10;

/**
 * How many steps back the nearest entry showing `target`'s screen is (the same
 * path), or null. Library → reader → series: the series' ← LIBRARY is two back.
 */
export function stepsBackTo(target: URL): number | null {
	const i = index();
	if (i === null) return null;
	const map = load();
	for (let k = i - 1; k >= Math.max(0, i - REACH); k--) {
		const href = map[k];
		if (!href) return null;
		const u = new URL(href);
		if (u.origin === target.origin && u.pathname === target.pathname) return i - k;
	}
	return null;
}

/**
 * A back link: a plain click goes back in history to the screen the link
 * opens, when the reader came from it; otherwise the link opens it as usual.
 */
export function backLink(a: HTMLAnchorElement) {
	const click = (e: MouseEvent) => {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
			return;
		const steps = stepsBackTo(new URL(a.href, location.href));
		if (steps === null) return;
		e.preventDefault();
		history.go(-steps);
	};
	a.addEventListener('click', click);
	return { destroy: () => a.removeEventListener('click', click) };
}
