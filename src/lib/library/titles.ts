/**
 * A title from a series' address at its source, for a source that answers
 * with none (Mangahere's details, 2026-10-29): the last part of the path, its
 * dashes and underscores spaces, each word capitalised.
 * "/manga/love_junkies/" is "Love Junkies".
 */
export function titleFromPath(path: string): string {
	const last = path.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';
	let words = last;
	try {
		words = decodeURIComponent(last);
	} catch {
		// Not percent-encoded after all: the words as they are.
	}
	words = words
		.replace(/\.(html?|php)$/i, '')
		.replace(/[-_+]+/g, ' ')
		.trim();
	// Word by word: \b isn't Unicode-aware, and would capitalise the é in "Café".
	const title = words
		.split(/\s+/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
	return title || 'Untitled';
}
