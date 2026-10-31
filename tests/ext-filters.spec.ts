import { describe, expect, it } from 'vitest';
import {
	NO_EXT_FILTERS,
	activeExtFilters,
	extFilterParams,
	parseExtFilters,
	searchMatches,
	toggleLang
} from '../src/lib/library/ext-filters';

/** AVAILABLE's filters (doc/BROWSE.md, "Filters"): the URL, LANGUAGE's toggles, the search. */

describe('the URL', () => {
	it('reads what it can, and nothing else', () => {
		expect(parseExtFilters(new URLSearchParams(''))).toEqual(NO_EXT_FILTERS);
		expect(
			parseExtFilters(
				new URLSearchParams('lang=EN,pt-br,x!,ja&installed=no&repo=e2&adult=only&library=1')
			)
		).toEqual({
			langs: ['en', 'pt-br', 'ja'],
			installed: 'no',
			repo: 'e2',
			adult: 'only',
			library: true
		});
		expect(parseExtFilters(new URLSearchParams('lang=&repo=x9&adult=all'))).toMatchObject({
			langs: [],
			repo: null,
			adult: 'any'
		});
	});
	it('writes only what isn’t the default, and reads it back', () => {
		expect(extFilterParams(NO_EXT_FILTERS)).toEqual({
			lang: null,
			installed: null,
			repo: null,
			adult: null,
			library: null
		});
		const f = {
			langs: ['fr'],
			installed: 'yes' as const,
			repo: 'n1',
			adult: 'none' as const,
			library: true
		};
		const p = new URLSearchParams(
			Object.entries(extFilterParams(f)).flatMap(([k, v]) => (v === null ? [] : [[k, v]]))
		);
		expect(parseExtFilters(p)).toEqual(f);
		expect(activeExtFilters(f)).toBe(5);
	});
});

describe('LANGUAGE', () => {
	const mine = ['en', 'ja'];
	it('starts from SETTINGS’ languages and toggles one at a time', () => {
		const a = toggleLang(NO_EXT_FILTERS, mine, 'fr');
		expect(a.langs).toEqual(['en', 'ja', 'fr']);
		expect(toggleLang(a, mine, 'en').langs).toEqual(['ja', 'fr']);
		// Back to exactly SETTINGS’ is SETTINGS’ again: nothing in the URL.
		expect(toggleLang(a, mine, 'fr').langs).toBeNull();
	});
});

describe('the search', () => {
	it('ignores case and spacing, and finds by a source’s name', () => {
		expect(searchMatches('weebcentral', ['Weeb Central'])).toBe(true);
		expect(searchMatches('WEEB central', ['Weeb Central'])).toBe(true);
		expect(searchMatches('mangadex', ['Comick', 'MangaDex (EN)'])).toBe(true);
		expect(searchMatches('', ['anything'])).toBe(true);
		expect(searchMatches('asura', ['Weeb Central'])).toBe(false);
	});
});
