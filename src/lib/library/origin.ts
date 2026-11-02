/**
 * Where a source's preview was opened from, kept through + ADD (card c262;
 * doc/NAVIGATION.md, "From a source"). The preview knows it came from a
 * source's BROWSE page or from the search, and the series it adds into says
 * ← BROWSE or ← SOURCES back to it instead of ← LIBRARY.
 *
 * The origin travels in a URL parameter, so it is accepted only as an in-app
 * path to one of those two screens: anything else (an absolute URL, `//host`,
 * a path that climbs out with `..`) would make ← an open redirect.
 */

const BASE = 'http://in.app';

/** The origin as a safe in-app path and query, or '' when it isn't one. */
export function sourceOrigin(raw: string | null | undefined): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '';
	let u: URL;
	try {
		u = new URL(raw, BASE);
	} catch {
		return '';
	}
	if (u.origin !== BASE) return '';
	if (!u.pathname.startsWith('/browse/') && u.pathname !== '/downloads/search') return '';
	return u.pathname + u.search;
}

/** What ← says for an origin `sourceOrigin` accepted. */
export const originLabel = (origin: string): 'Browse' | 'Sources' =>
	origin.startsWith('/browse/') ? 'Browse' : 'Sources';

/** The search an origin-less preview goes back to, with its query when it has one. */
export const searchOrigin = (q: string) =>
	q ? `/downloads/search?q=${encodeURIComponent(q)}` : '/downloads/search';

/** `/series/<id>` with the origin kept, plus any other parameters. */
export function seriesWithOrigin(
	seriesId: number,
	origin: string,
	params: Record<string, string> = {}
): string {
	const q = new URLSearchParams(params);
	const safe = sourceOrigin(origin);
	if (safe) q.set('from', safe);
	const s = q.toString();
	return `/series/${seriesId}${s ? `?${s}` : ''}`;
}
