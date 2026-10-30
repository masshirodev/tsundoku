/**
 * Taking out of a report what a friend wouldn't hand over (report.ts; doc/LOGS.md;
 * card c193). Pure, so it's tested on its own: hidden means hidden.
 */

export type Scrub = {
	/** Exact values never to appear: tokens. */
	secrets: string[];
	/** Hidden series' titles and folders. */
	hidden: string[];
	/** Paths to shorten: [what, what it becomes]. */
	paths: [string, string][];
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text with nothing in it a friend wouldn't hand over. */
export function scrub(text: string, s: Scrub): string {
	let out = text;
	for (const v of s.secrets.filter((x) => x.length >= 6))
		out = out.replace(new RegExp(escape(v), 'g'), '[secret]');
	// Cookies and pairing links, whatever their values: a log line can carry a request.
	out = out
		.replace(/\b(tsundoku_session|tsundoku_paired)=[^;\s]+/g, '$1=[secret]')
		.replace(/\/pair\/[\w-]+/g, '/pair/[code]')
		.replace(/\b(Bearer|token=)\s*[\w.-]{12,}/gi, '$1 [secret]');
	// Longest first, so a folder is replaced whole before a title inside it.
	for (const h of [...new Set(s.hidden)]
		.filter((x) => x.length >= 3)
		.sort((a, b) => b.length - a.length))
		out = out.replace(new RegExp(escape(h), 'gi'), '[hidden]');
	for (const [from, to] of s.paths.filter(([f]) => f.length > 1)) {
		out = out.replace(new RegExp(escape(from), 'gi'), to);
		// Windows paths appear with either slash.
		out = out.replace(new RegExp(escape(from.replaceAll('/', '\\')), 'gi'), to);
	}
	return out;
}
