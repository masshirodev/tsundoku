/**
 * EXTENSIONS › AVAILABLE's filters (doc/BROWSE.md, "Filters"): LANGUAGE as a
 * choice of several, INSTALLED, REPOSITORY, 18+ and IN LIBRARY, in the URL so
 * the list works without script. LANGUAGE starts from the languages in
 * SETTINGS and only filters the visit.
 *
 * 18+ is a filter for everyone, never a gate: Keiyoushi flags mainstream
 * sites that carry some adult titles (Weeb Central), and hiding them made
 * them unfindable for a friend with no reveal. Hidden series stay hidden by
 * their own rule, which this doesn't touch.
 */

export type ExtFilters = {
	/** The languages asked for; null is SETTINGS' own. */
	langs: string[] | null;
	installed: 'any' | 'yes' | 'no';
	/** A repository, as `e<id>` (an extension one) or `n<id>` (LNReader's). */
	repo: string | null;
	adult: 'any' | 'only' | 'none';
	/** Only extensions whose sources have series in the library. */
	library: boolean;
};

export const NO_EXT_FILTERS: ExtFilters = {
	langs: null,
	installed: 'any',
	repo: null,
	adult: 'any',
	library: false
};

const LANG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;

export function parseExtFilters(p: URLSearchParams): ExtFilters {
	const langs = p.get('lang');
	const inst = p.get('installed');
	const adult = p.get('adult');
	const repo = p.get('repo');
	return {
		langs:
			langs === null
				? null
				: langs
						.split(',')
						.map((l) => l.trim().toLowerCase())
						.filter((l) => LANG.test(l)),
		installed: inst === 'yes' || inst === 'no' ? inst : 'any',
		repo: repo && /^[en]\d+$/.test(repo) ? repo : null,
		adult: adult === 'only' || adult === 'none' ? adult : 'any',
		library: p.get('library') === '1'
	};
}

/** The URL's parameters for [f]: each one only while it isn't the default. */
export function extFilterParams(f: ExtFilters): Record<string, string | null> {
	return {
		lang: f.langs === null ? null : f.langs.join(','),
		installed: f.installed === 'any' ? null : f.installed,
		repo: f.repo,
		adult: f.adult === 'any' ? null : f.adult,
		library: f.library ? '1' : null
	};
}

/** How many are narrowing, for the FILTER cell's badge (LANGUAGE counts once changed). */
export function activeExtFilters(f: ExtFilters): number {
	return (
		(f.langs !== null ? 1 : 0) +
		(f.installed !== 'any' ? 1 : 0) +
		(f.repo ? 1 : 0) +
		(f.adult !== 'any' ? 1 : 0) +
		(f.library ? 1 : 0)
	);
}

/** LANGUAGE's toggle: one language in or out of what's asked, starting from SETTINGS'. */
export function toggleLang(f: ExtFilters, mine: string[], lang: string): ExtFilters {
	const now = f.langs ?? mine;
	const next = now.includes(lang) ? now.filter((l) => l !== lang) : [...now, lang];
	const same = next.length === mine.length && next.every((l) => mine.includes(l));
	return { ...f, langs: same ? null : next };
}

/**
 * A search's words against a name and its sources' names: case and spacing
 * ignored, so "weebcentral", "Weeb Central" and "WEEB central" all find Weeb
 * Central, and a source's own name finds the extension that holds it.
 */
export const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function searchMatches(q: string, names: string[]): boolean {
	const want = fold(q);
	return !want || names.some((n) => fold(n).includes(want));
}
