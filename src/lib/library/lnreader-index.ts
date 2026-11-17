/**
 * An LNReader plugin repository's index (`plugins.min.json`, doc/NOVELS.md),
 * read into one shape. Pure: what was fetched goes in, listings come out.
 * Unlike a Mihon repository there's no `repo.json` and no signing key: an
 * index is an array of plugins, each a JavaScript file by URL.
 */

export type NovelListing = {
	/** The plugin's own id ("royalroad"): its key, and its sources' ids' tail. */
	id: string;
	name: string;
	site: string;
	/** An ISO code ("en"), from the index's language name ("English"). */
	lang: string;
	version: string;
	url: string;
	iconUrl: string | null;
};

export class NovelRepoError extends Error {}

/**
 * The languages LNReader names in their own words, as codes the reader's
 * languages (SETTINGS) are kept in: every name the LNReader plugin
 * repository uses. One it doesn't know keeps its name, lowercased.
 */
const LANGS: Record<string, string> = {
	english: 'en',
	русский: 'ru',
	العربية: 'ar',
	español: 'es',
	français: 'fr',
	türkçe: 'tr',
	português: 'pt',
	'bahasa indonesia': 'id',
	'中文, 汉语, 漢語': 'zh',
	'tiếng việt': 'vi',
	日本語: 'ja',
	'조선말, 한국어': 'ko',
	ไทย: 'th',
	українська: 'uk',
	বাংলা: 'bn',
	polski: 'pl',
	multi: 'multi'
};

export function langCode(name: string): string {
	// The index marks right-to-left names with a left-to-right mark.
	const key = name.replace(/[‎‏]/g, '').trim().toLowerCase();
	return LANGS[key] ?? key;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A repository's address: https, a JSON file (people paste `plugins.min.json`). */
export function repoUrl(address: string): string {
	let url: URL;
	try {
		url = new URL(address.trim());
	} catch {
		throw new NovelRepoError('That isn’t an address');
	}
	if (url.protocol !== 'https:') throw new NovelRepoError('A repository is served over https');
	if (!url.pathname.endsWith('.json'))
		throw new NovelRepoError('An LNReader repository is a .json file');
	url.hash = '';
	return url.toString();
}

/** Whether an address looks like an LNReader repository rather than a Mihon one. */
export const isNovelRepoAddress = (address: string) =>
	/plugins(\.min)?\.json(\?|#|$)/.test(address.trim());

export function parseIndex(json: unknown): NovelListing[] {
	if (!Array.isArray(json)) throw new NovelRepoError('Not an LNReader plugin index');
	const out: NovelListing[] = [];
	const seen = new Set<string>();
	for (const e of json) {
		if (!e || typeof e !== 'object') continue;
		const r = e as Record<string, unknown>;
		const id = str(r.id);
		const url = str(r.url);
		// An id is a key and a file name: nothing odd gets through.
		if (!/^[A-Za-z0-9._-]{1,100}$/.test(id) || !url.startsWith('https://') || seen.has(id))
			continue;
		seen.add(id);
		out.push({
			id,
			name: str(r.name) || id,
			site: str(r.site),
			lang: langCode(str(r.lang)),
			version: str(r.version),
			url,
			iconUrl: str(r.iconUrl).startsWith('https://') ? str(r.iconUrl) : null
		});
	}
	if (out.length === 0) throw new NovelRepoError('The index lists no plugins');
	return out;
}

/** Whether `a` is a newer version than `b` ("2.3.10" > "2.3.4"). */
export function newer(a: string, b: string): boolean {
	const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
	const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
	}
	return false;
}
