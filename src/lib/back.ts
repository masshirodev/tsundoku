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

import { goto } from '$app/navigation';
import type { ActionResult, SubmitFunction } from '@sveltejs/kit';

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

/**
 * A back link's click, for code that leaves a screen by itself (the player's
 * BACK and Escape): back in history to `href`'s screen when the reader came
 * from it, else open it. Pushed instead, the left screen stays behind it and
 * the next BACK opens it again (the player, from the TV's remote).
 */
export function goBackTo(href: string): void {
	const steps = stepsBackTo(new URL(href, location.href));
	if (steps !== null) history.go(-steps);
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's resolved href
	else void goto(href);
}

/**
 * Follow an action's redirect in place of the screen it was sent from, rather
 * than on top of it. For actions that end what their screen shows (grouping a
 * singleton away, UNGROUP, taking out or moving a series' last book, HIDE,
 * deleting a series' last book): pushed, the old screen stays in history and
 * the system's back lands on a 404 (doc/NAVIGATION.md, "Screens that are gone").
 * Anything but a redirect is handled as `use:enhance` would.
 */
export async function settleReplacing({
	result,
	update
}: {
	result: ActionResult;
	update: () => Promise<void>;
}): Promise<void> {
	if (result.type === 'redirect')
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- our own action's redirect
		await goto(result.location, { replaceState: true, invalidateAll: true });
	else await update();
}

/** `use:enhance={replacing}`: see `settleReplacing`. */
export const replacing: SubmitFunction = () => settleReplacing;
