/**
 * Where to go once signed in: a path in this app, never another site.
 *
 * Prefix checks (`starts with /, not //`) are not enough, because browsers
 * clean a URL before they parse it: a tab or newline is removed (`/\t/evil`
 * becomes `//evil`), and a backslash reads as a slash (`/\evil`). So the
 * value is resolved against this origin the way the browser will resolve the
 * Location header, and kept only if it is still this origin. What is sent
 * back is the path, query and hash of that resolution, so the header never
 * carries a scheme or host for a browser to reinterpret.
 */
export function sameOriginPath(next: string | null | undefined, origin: string): string {
	if (!next) return '/';
	let to: URL;
	try {
		to = new URL(next, origin);
	} catch {
		return '/';
	}
	if (to.origin !== new URL(origin).origin) return '/';
	return `${to.pathname}${to.search}${to.hash}`;
}
