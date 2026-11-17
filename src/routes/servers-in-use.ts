/**
 * Which of the TV app's servers is in use (c261's S1 and S2; doc/ANDROID.md,
 * "Servers"): the one this page is served from, whatever the bridge says.
 *
 * The bridge's own `inUse` is the server with the newest `opened`
 * (Servers.kt, `toJson`), and the app writes `opened` only once a page has
 * finished loading (MainActivity's `onPageFinished`). A library mounts during
 * hydration, before that, so on the first library after a switch the bridge
 * still names the server just left. The page knows better: its own origin is
 * the server it is on, in the same form the app stores (the layout tells the
 * app `named(location.origin, …)`). The bridge's flag is the fallback for a
 * page whose origin matches no entry (a test on localhost, a server reached
 * by a name the list does not hold).
 */
export type HasOrigin = { origin: string; inUse: boolean };

/** `origin` as a browser writes it, or null for one it cannot read. */
function clean(origin: string): string | null {
	try {
		const o = new URL(origin).origin;
		return o === 'null' ? null : o;
	} catch {
		return null;
	}
}

/** The server in use: the entry whose origin is `here`, else the bridge's, else none. */
export function inUseOf<T extends HasOrigin>(list: readonly T[], here: string | null): T | null {
	const at = here === null ? null : clean(here);
	return (
		(at === null ? undefined : list.find((s) => clean(s.origin) === at)) ??
		list.find((s) => s.inUse) ??
		null
	);
}

/** The list with `inUse` set on exactly the one `inUseOf` picks, so every reader agrees. */
export function withInUse<T extends HasOrigin>(list: readonly T[], here: string | null): T[] {
	const used = inUseOf(list, here);
	return list.map((s) => ({ ...s, inUse: s === used }));
}

/** The page's own origin, or null outside a browser. */
export const pageOrigin = (): string | null =>
	typeof location === 'undefined' ? null : location.origin;
