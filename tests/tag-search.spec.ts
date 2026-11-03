import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	cleanSchema,
	EXCLUDE,
	INCLUDE,
	readFilters,
	type FilterField
} from '$lib/library/browse-filters';
import { lnSchema, type LnFilters } from '$lib/library/lnreader-filters';
import {
	libraryTagKey,
	matchFilter,
	backOrigin,
	backOriginLabel,
	tagSearchHref,
	tagSearchParams
} from '$lib/library/tag-search';

/**
 * A tag searched for in its source (card c313; doc/BROWSE.md, "Arriving from
 * a tag"): the URL a source's page reads back as that genre's filter
 * included, or as a search for the value.
 */

// The schemas five real sources answered on 2026-10-28 (fixtures/filters).
const dir = new URL('./fixtures/filters/', import.meta.url);
const real = Object.fromEntries(
	readdirSync(dir).map((f) => [
		f.replace(/\.json$/, ''),
		cleanSchema(JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
	])
) as Record<string, FilterField[]>;

/** What the source page makes of the URL: the form read back (as +page.server.ts does). */
const landed = (schema: FilterField[], params: [string, string][]) =>
	readFilters(schema, new URLSearchParams(params));

/** Every choice that differs between two forms, by path. */
function changes(a: FilterField[], b: FilterField[]): string[] {
	const out: string[] = [];
	a.forEach((f, i) => {
		if (f.type === 'group')
			f.children!.forEach((c, j) => {
				if (JSON.stringify(c.state) !== JSON.stringify(b[i].children![j].state))
					out.push(`${f.name}/${c.name}=${JSON.stringify(b[i].children![j].state)}`);
			});
		else if (JSON.stringify(f.state) !== JSON.stringify(b[i].state))
			out.push(`${f.name}=${JSON.stringify(b[i].state)}`);
	});
	return out;
}

const tri = (name: string, state = 0): FilterField => ({ type: 'tristate', name, state });
const fold = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const box = (name: string, state = false): FilterField => ({ type: 'checkbox', name, state });

describe('a genre the source’s filters name', () => {
	it('is that tri-state included inside its group, on FILTERED, and nothing else moves', () => {
		const schema = real['mangadex-en'];
		const params = tagSearchParams(schema, { namespace: 'genre', value: 'Comedy' });
		expect(params[0]).toEqual(['tab', 'filtered']);
		expect(params.some(([k]) => k === 'q')).toBe(false);
		expect(changes(schema, landed(schema, params))).toEqual(['Genre/Comedy=1']);
	});

	it('is a checkbox ticked when that is what names it', () => {
		const schema: FilterField[] = [
			{ type: 'select', name: 'Status', state: 0, values: ['All', 'Ongoing'] },
			{ type: 'group', name: 'Genres', children: [box('Action'), box('Romance')] }
		];
		const params = tagSearchParams(schema, { namespace: 'genre', value: 'Romance' });
		expect(changes(schema, landed(schema, params))).toEqual(['Genres/Romance=true']);
	});

	it('matches a top-level filter outside any group', () => {
		const schema: FilterField[] = [tri('Isekai'), box('Webtoon')];
		expect(matchFilter(schema, 'isekai')).toEqual([0]);
		expect(matchFilter(schema, 'WEBTOON')).toEqual([1]);
		expect(
			changes(schema, landed(schema, tagSearchParams(schema, { namespace: '', value: 'Webtoon' })))
		).toEqual(['Webtoon=true']);
	});

	it('ignores case and spacing', () => {
		const schema = real['weeb-central'];
		for (const value of ['action', 'ACTION', '  Action ', 'Act ion'])
			expect(
				changes(schema, landed(schema, tagSearchParams(schema, { namespace: 'genre', value }))),
				value
			).toEqual(['Tags/Action=1']);
		const slice: FilterField[] = [{ type: 'group', name: 'G', children: [tri('Slice of Life')] }];
		expect(matchFilter(slice, 'slice  of life')).toEqual([0, 0]);
		expect(matchFilter(slice, 'SliceOfLife')).toEqual([0, 0]);
		// Folding holds on its own output: a name matches itself.
		expect(matchFilter(slice, 'Slice of Life')).toEqual([0, 0]);
	});

	it('keeps a checkbox the source has on by default on: the URL is the whole form', () => {
		// mangadex's "Has available chapters" is off; a plugin's Status starts ticked.
		const raw: LnFilters = {
			status: {
				type: 'Checkbox',
				label: 'Status',
				value: ['ongoing'],
				options: [
					{ label: 'Ongoing', value: 'ongoing' },
					{ label: 'Hiatus', value: 'hiatus' }
				]
			},
			genres: {
				type: 'XCheckbox',
				label: 'Genres',
				value: {},
				options: [
					{ label: 'Action', value: 'action' },
					{ label: 'Romance', value: 'romance' }
				]
			}
		};
		const schema = lnSchema(raw).schema;
		const params = tagSearchParams(schema, { namespace: 'genre', value: 'romance' });
		expect(changes(schema, landed(schema, params))).toEqual(['Genres/Romance=1']);
	});

	it('prefers a tri-state over a checkbox of the same name', () => {
		const schema: FilterField[] = [
			{ type: 'group', name: 'Status', children: [box('Completed')] },
			{ type: 'group', name: 'Tags', children: [tri('Completed')] }
		];
		expect(matchFilter(schema, 'Completed')).toEqual([1, 0]);
	});

	it('takes the first of two groups naming it, in the schema’s order', () => {
		const schema: FilterField[] = [
			{ type: 'group', name: 'Genre', children: [tri('Action')] },
			{ type: 'group', name: 'Theme', children: [tri('Action')] }
		];
		expect(matchFilter(schema, 'Action')).toEqual([0, 0]);
	});

	it('is never a select, a text or a sort, which name no genre', () => {
		const schema: FilterField[] = [
			{ type: 'select', name: 'Manhwa', state: 0, values: ['All', 'Manhwa'] },
			{ type: 'text', name: 'Author', state: '' },
			{ type: 'sort', name: 'Popular', state: null, values: ['Popular'] }
		];
		for (const value of ['Manhwa', 'Author', 'Popular'])
			expect(tagSearchParams(schema, { namespace: 'genre', value })).toEqual([['q', value]]);
	});
});

describe('everything else is a search for the value', () => {
	it('a genre with no matching filter', () => {
		expect(
			tagSearchParams(real['mangadex-en'], { namespace: 'genre', value: 'Isekai Cooking' })
		).toEqual([['q', 'Isekai Cooking']]);
	});

	it('an author, an artist or a circle, even when a filter shares the name', () => {
		const schema: FilterField[] = [
			{ type: 'group', name: 'Genre', children: [tri('Oda Eiichiro'), tri('Clamp')] }
		];
		expect(tagSearchParams(schema, { namespace: 'author', value: 'Oda Eiichiro' })).toEqual([
			['q', 'Oda Eiichiro']
		]);
		expect(tagSearchParams(schema, { namespace: 'artist', value: 'Clamp' })).toEqual([
			['q', 'Clamp']
		]);
		expect(tagSearchParams(schema, { namespace: 'circle', value: 'Clamp' })).toEqual([
			['q', 'Clamp']
		]);
	});

	it('a source with no schema: an empty one, or none that could be read', () => {
		// The browse world's fake Aniyomi source answers filterSchemaAnime with [].
		expect(tagSearchParams([], { namespace: 'genre', value: 'Fantasy' })).toEqual([
			['q', 'Fantasy']
		]);
		expect(tagSearchParams(cleanSchema(null), { namespace: 'genre', value: 'Fantasy' })).toEqual([
			['q', 'Fantasy']
		]);
		// Asura's and Webtoons' filters are selects, a text and a sort: nothing names a genre.
		for (const name of ['asura-scans', 'webtoons-en'])
			expect(tagSearchParams(real[name], { namespace: 'genre', value: 'Action' }), name).toEqual([
				['q', 'Action']
			]);
	});

	it('trims the value it searches for', () => {
		expect(tagSearchParams([], { namespace: 'tag', value: '  Fantasy ' })).toEqual([
			['q', 'Fantasy']
		]);
	});
});

describe('every real fixture', () => {
	/** Every tri-state and checkbox in a schema, with its path: each must find itself. */
	const pickables = (schema: FilterField[]) =>
		schema.flatMap((f, i) =>
			f.type === 'group'
				? f
						.children!.map((c, j) => ({ f: c, path: [i, j] }))
						.filter(({ f: c }) => c.type === 'tristate' || c.type === 'checkbox')
				: f.type === 'tristate' || f.type === 'checkbox'
					? [{ f, path: [i] }]
					: []
		);
	const at = (schema: FilterField[], path: number[]) =>
		path.length === 1 ? schema[path[0]] : schema[path[0]].children![path[1]];
	for (const name of Object.keys(real))
		it(`${name}: each option it names lands on FILTERED with that one on, nothing else moved`, () => {
			const schema = real[name];
			const all = pickables(schema);
			if (name === 'mangadex-en' || name === 'mangahere' || name === 'weeb-central')
				expect(all.length, name).toBeGreaterThan(0);
			for (const { f } of all) {
				const path = matchFilter(schema, f.name)!;
				// The first option of that name (two groups can share one).
				expect(fold(at(schema, path).name)).toBe(fold(f.name));
				const form = landed(schema, tagSearchParams(schema, { namespace: 'genre', value: f.name }));
				const chosen = at(form, path);
				expect(chosen.state, `${name} ${f.name}`).toBe(chosen.type === 'tristate' ? INCLUDE : true);
				// Everything else is the source's default; one already on by default moves nothing.
				const moved = changes(schema, form);
				expect(moved.length, `${name} ${f.name}: ${moved.join(', ')}`).toBeLessThanOrEqual(1);
				for (const m of moved) expect(m).not.toMatch(new RegExp(`=${EXCLUDE}$`));
			}
		});
});

describe('the URL', () => {
	it('is the source page’s, with from when given', () => {
		const href = tagSearchHref(
			'/browse/100',
			[],
			{ namespace: 'author', value: 'Seo Haram' },
			'/downloads/source/100~abc?from=%2Fbrowse%2F100'
		);
		const u = new URL(href, 'http://x');
		expect(u.pathname).toBe('/browse/100');
		expect(u.searchParams.get('q')).toBe('Seo Haram');
		expect(u.searchParams.get('from')).toBe('/downloads/source/100~abc?from=%2Fbrowse%2F100');
		expect(tagSearchHref('/browse/100', [], { namespace: '', value: 'x' })).toBe('/browse/100?q=x');
	});
});

describe('where a source page’s back cell may return', () => {
	it('is a preview or a series, with its own query', () => {
		expect(backOrigin('/series/12?from=continue')).toBe('/series/12?from=continue');
		expect(backOriginLabel('/series/12')).toBe('Back to the series');
		expect(backOriginLabel('/downloads/source/1~a')).toBe('Back to the preview');
		expect(backOrigin('/downloads/source/100~abc?from=%2Fbrowse%2F100')).toBe(
			'/downloads/source/100~abc?from=%2Fbrowse%2F100'
		);
		expect(backOrigin('/downloads/source/100~abc')).toBe('/downloads/source/100~abc');
	});

	it('and nothing else: never another host or screen', () => {
		for (const raw of [
			null,
			'',
			'https://evil.example/downloads/source/1',
			'//evil.example/downloads/source/1',
			'/\\evil.example',
			'/downloads/source/1/../../settings',
			'/downloads/source/',
			'/downloads/search?q=x',
			'/browse/100',
			'/settings',
			'/series/12/move',
			'/series/abc',
			'downloads/source/1'
		])
			expect(backOrigin(raw), String(raw)).toBe('');
	});

	it('holds on its own output', () => {
		const once = backOrigin('/downloads/source/100~abc?q=a%20b');
		expect(backOrigin(once)).toBe(once);
	});
});

describe('the library’s key for a tag', () => {
	it('is namespace:value, or the bare value', () => {
		expect(libraryTagKey({ namespace: 'artist', value: 'Seo Haram' })).toBe('artist:Seo Haram');
		expect(libraryTagKey({ namespace: '', value: 'isekai' })).toBe('isekai');
	});
});
