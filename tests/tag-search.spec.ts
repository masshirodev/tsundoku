import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cleanSchema,
	EXCLUDE,
	INCLUDE,
	readFilters,
	type FilterField
} from '$lib/library/browse-filters';
import { lnSchema, type LnFilters } from '$lib/library/lnreader-filters';
import { people } from '$lib/import/mihon-plan';
import {
	libraryTagKey,
	matchFilter,
	backOrigin,
	backOriginLabel,
	extensionsFrom,
	fromExtensions,
	keepOrigin,
	settingsOrigin,
	distinct,
	matchPersonFilter,
	personKey,
	previewPeople,
	splitPeople,
	readTagRoute,
	settleWithin,
	TAG_SCHEMA_WAIT_MS,
	tagRouteHref,
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

describe('a person on the source’s own text filter (card c456)', () => {
	// Written out from the fixtures, not derived: which top-level text field
	// each person's namespace fills, by name, in every real schema.
	const EXPECTED: Record<string, Record<'author' | 'artist' | 'circle', string | null>> = {
		'asura-scans': { author: null, artist: null, circle: null },
		'mangadex-en': { author: null, artist: null, circle: null },
		mangahere: { author: 'Author', artist: 'Artist', circle: null },
		'webtoons-en': { author: null, artist: null, circle: null },
		'weeb-central': { author: 'Author (Case-sensitive)', artist: null, circle: null }
	};

	it('covers every fixture', () => {
		expect(Object.keys(real).sort()).toEqual(Object.keys(EXPECTED).sort());
	});

	for (const name of Object.keys(EXPECTED))
		for (const ns of ['author', 'artist', 'circle'] as const)
			it(`${name}: ${ns} ${EXPECTED[name][ns] ? `fills ${EXPECTED[name][ns]}` : 'is a search'}`, () => {
				const schema = real[name];
				const want = EXPECTED[name][ns];
				const at = matchPersonFilter(schema, ns);
				expect(at === null ? null : schema[at].name).toBe(want);
				const params = tagSearchParams(schema, { namespace: ns, value: ' Aoi Hanamura ' });
				if (!want) {
					expect(params).toEqual([['q', 'Aoi Hanamura']]);
					return;
				}
				const p = new URLSearchParams(params);
				expect(p.get('tab')).toBe('filtered');
				expect(p.has('q')).toBe(false);
				// The page reads back the name in that field, and nothing else moved.
				const form = landed(schema, params);
				expect(form[at!].state).toBe('Aoi Hanamura');
				expect(changes(schema, form)).toEqual([`${want}="Aoi Hanamura"`]);
			});

	it('folds the field’s name as matchFilter does, and sets a bracketed note aside', () => {
		const text = (n: string): FilterField => ({ type: 'text', name: n, state: '' });
		for (const n of [
			'Author',
			'AUTHOR',
			' author ',
			'Au thor',
			'Author (Case-sensitive)',
			'Author ( exact )'
		])
			expect(matchPersonFilter([text(n)], 'author'), n).toBe(0);
		for (const n of ['Authors', 'Author name', 'Co-author', 'Title', '(Author)'])
			expect(matchPersonFilter([text(n)], 'author'), n).toBeNull();
		// The first of two, in the schema's order.
		expect(matchPersonFilter([text('Title'), text('Author'), text('author')], 'author')).toBe(1);
	});

	it('is only ever a person’s, and only ever a text field', () => {
		const schema: FilterField[] = [
			{ type: 'checkbox', name: 'Author', state: false },
			{ type: 'select', name: 'Artist', state: 0, values: ['All', 'X'] },
			tri('Circle')
		];
		for (const ns of ['author', 'artist', 'circle'])
			expect(matchPersonFilter(schema, ns), ns).toBeNull();
		const withText: FilterField[] = [{ type: 'text', name: 'Genre', state: '' }];
		expect(matchPersonFilter(withText, 'genre')).toBeNull();
		expect(tagSearchParams(withText, { namespace: 'genre', value: 'Romance' })).toEqual([
			['q', 'Romance']
		]);
		// A text inside a group is never drawn or sent, so cleanSchema drops it.
		const grouped = cleanSchema([
			{
				type: 'group',
				name: 'People',
				children: [
					{ type: 'text', name: 'Author', state: '' },
					{ type: 'tristate', name: 'Romance', state: 0 }
				]
			}
		]);
		expect(grouped[0].children!.map((c) => c.type)).toEqual(['tristate']);
		expect(matchPersonFilter(grouped, 'author')).toBeNull();
	});

	it('leaves a blank name a search, as before', () => {
		expect(tagSearchParams(real.mangahere, { namespace: 'author', value: '  ' })).toEqual([
			['q', '']
		]);
	});
});

describe('a preview’s people (card c456)', () => {
	it('is one name a link, split on commas', () => {
		expect(splitPeople('Aoi Hanamura, Ren Kisaragi')).toEqual(['Aoi Hanamura', 'Ren Kisaragi']);
		expect(splitPeople('ONE')).toEqual(['ONE']);
		expect(splitPeople(' A ,B,, C ')).toEqual(['A', 'B', 'C']);
		// The importer's own separators, so a link is the tag the series gets once added.
		expect(splitPeople('A / B; C & D')).toEqual(['A', 'B', 'C', 'D']);
		expect(splitPeople('Unknown, _, Aoi')).toEqual(['Aoi']);
		for (const raw of ['Aoi Hanamura, Ren Kisaragi', 'A / B; C & D', 'X,Y', 'Solo'])
			expect(splitPeople(raw), raw).toEqual(people(raw));
	});

	it('keeps a generational suffix with its name', () => {
		expect(splitPeople('Tanaka, Jr.')).toEqual(['Tanaka, Jr.']);
		expect(splitPeople('Tanaka, Jr., Sato')).toEqual(['Tanaka, Jr.', 'Sato']);
		expect(splitPeople('John Smith, III, Jane Doe, sr')).toEqual([
			'John Smith, III',
			'Jane Doe, sr'
		]);
		// A suffix with nobody before it is a name as written.
		expect(splitPeople('Jr., Sato')).toEqual(['Jr.', 'Sato']);
	});

	// c508: the same strings, and the same answers, as tests/tag-search.spec.ts'
	// preview (`splitPeople`) and tests/{mihon,anime}-plan.spec.ts' importers.
	const PEOPLE: [string, string[]][] = [
		['Aoi Hanamura, Ren Kisaragi', ['Aoi Hanamura', 'Ren Kisaragi']],
		['A / B; C & D', ['A', 'B', 'C', 'D']],
		['Unknown, _, Aoi', ['Aoi']],
		['Tanaka, Jr.', ['Tanaka, Jr.']],
		['Tanaka, Jr., Sato', ['Tanaka, Jr.', 'Sato']],
		['John Smith, III, Jane Doe, sr', ['John Smith, III', 'Jane Doe, sr']],
		['Kim / Lee II', ['Kim', 'Lee II']],
		['Ito & Sr', ['Ito, Sr']],
		['Jr., Sato', ['Jr.', 'Sato']],
		['Oda, Eiichiro', ['Oda', 'Eiichiro']]
	];
	it('splits as every importer does, for the same strings (c508)', () => {
		for (const [raw, want] of PEOPLE) {
			expect(splitPeople(raw), raw).toEqual(want);
			expect(people(raw), raw).toEqual(want);
			// A normaliser holds on its own output.
			expect(splitPeople(splitPeople(raw).join(', ')), raw).toEqual(want);
		}
	});

	it('names a person once, case and spacing aside, in the source’s order', () => {
		expect(splitPeople('B, A, b,  a ')).toEqual(['B', 'A']);
		expect(personKey('Aoi  Hanamura')).toBe(personKey('aoi hanamura'));
	});

	it('is nobody for nothing', () => {
		for (const raw of ['', '  ', ',', ' , ', null, undefined]) expect(splitPeople(raw)).toEqual([]);
	});

	it('draws an author line and an artist line, an author who draws once', () => {
		expect(previewPeople('Aoi Hanamura', 'Ren Kisaragi')).toEqual([
			{ ns: 'author', names: ['Aoi Hanamura'] },
			{ ns: 'artist', names: ['Ren Kisaragi'] }
		]);
		// The same person for both, as most sources write it: one line.
		expect(previewPeople('ONE', 'ONE')).toEqual([{ ns: 'author', names: ['ONE'] }]);
		expect(previewPeople('A, B', 'b, C')).toEqual([
			{ ns: 'author', names: ['A', 'B'] },
			{ ns: 'artist', names: ['C'] }
		]);
		expect(previewPeople('', 'Ren')).toEqual([{ ns: 'artist', names: ['Ren'] }]);
		expect(previewPeople(null, undefined)).toEqual([]);
	});

	it('holds on its own output', () => {
		for (const raw of ['Aoi Hanamura, Ren Kisaragi', 'Tanaka, Jr., Sato', 'B, A, b', 'A / B & C']) {
			const once = splitPeople(raw);
			expect(splitPeople(once.join(', ')), raw).toEqual(once);
			for (const n of once) expect(splitPeople(n), n).toEqual([n]);
		}
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
			'downloads/source/1',
			// EXTENSIONS is the settings page's alone (card c727), never a source page's.
			'/browse/extensions',
			'/browse/extensions?tab=installed'
		])
			expect(backOrigin(raw), String(raw)).toBe('');
	});

	it('refuses the encoded spellings of a host, a backslash and a climb (card c727)', () => {
		for (const raw of [
			'/%2F%2Fevil.example/series/1',
			'/%2f%2fevil.example/downloads/source/1',
			'/series/1%5C',
			'/series/1%5cevil',
			'/downloads/source/1%5Cevil.example',
			'/%5Cevil.example/series/1',
			// A climb back into an accepted screen still climbs.
			'/series/1/../2',
			'/series/1/%2e%2e/2',
			'/series/1/%2E%2E/2',
			'/downloads/source/1/./x',
			'/downloads/source/1/%2e/x',
			'/downloads/source/1/.%2e/%2e./series/3'
		])
			expect(backOrigin(raw), raw).toBe('');
	});

	it('still takes an encoded value in an accepted path or query', () => {
		expect(backOrigin('/downloads/source/100~%2Fmanga%2F1')).toBe(
			'/downloads/source/100~%2Fmanga%2F1'
		);
		expect(backOrigin('/series/12?q=a%5Cb')).toBe('/series/12?q=a%5Cb');
		expect(backOrigin('/downloads/source/1~a..b')).toBe('/downloads/source/1~a..b');
	});

	it('holds on its own output', () => {
		const once = backOrigin('/downloads/source/100~abc?q=a%20b');
		expect(backOrigin(once)).toBe(once);
	});
});

describe('where a source’s SETTINGS may return (card c727)', () => {
	it('is EXTENSIONS, with its tab and filters, or what backOrigin accepts', () => {
		expect(settingsOrigin('/browse/extensions')).toBe('/browse/extensions');
		expect(settingsOrigin('/browse/extensions?tab=installed&q=open')).toBe(
			'/browse/extensions?tab=installed&q=open'
		);
		expect(settingsOrigin('/browse/extensions?q=a%20b#row')).toBe('/browse/extensions?q=a+b');
		for (const tag of ['/series/12?from=continue', '/downloads/source/100~abc'])
			expect(settingsOrigin(tag)).toBe(backOrigin(tag));
	});

	it('drops a sheet EXTENSIONS had open, so ← lands on the list', () => {
		expect(settingsOrigin('/browse/extensions?q=x&remove=e2e.open')).toBe('/browse/extensions?q=x');
		expect(settingsOrigin('/browse/extensions?removeRepo=2&removeNovelRepo=3&add=x')).toBe(
			'/browse/extensions'
		);
	});

	it('and nothing else: every refusal backOrigin makes, encoded too', () => {
		for (const raw of [
			null,
			undefined,
			'',
			'browse/extensions',
			'https://evil.example/browse/extensions',
			'http://in.app/browse/extensions',
			'//evil.example/browse/extensions',
			'/\\evil.example/browse/extensions',
			'/browse/extensions\\',
			'/%2F%2Fevil.example/browse/extensions',
			'/%2f%2fbrowse/extensions',
			'/browse/extensions%5C',
			'/%5Cevil.example/browse/extensions',
			'/browse/extensions/',
			'/browse/extensions/x',
			'/browse/extensions%2F',
			'/browse/%65xtensions',
			'/browse/x/../extensions',
			'/browse/x/%2e%2e/extensions',
			'/browse/extensions/..',
			'/browse/extensions/%2E%2E/extensions',
			'/browse/./extensions',
			'/browse',
			'/browse/100',
			'/browse/100/settings',
			'/settings'
		])
			expect(settingsOrigin(raw), String(raw)).toBe('');
	});

	it('holds on its own output, and through keepOrigin', () => {
		for (const raw of ['/browse/extensions?tab=installed&q=a%20b', '/series/3']) {
			const once = settingsOrigin(raw);
			expect(settingsOrigin(once)).toBe(once);
			const u = new URL(keepOrigin('/browse/100/settings?/flag', once), 'http://x');
			expect(settingsOrigin(u.searchParams.get('from'))).toBe(once);
		}
	});

	it('tells EXTENSIONS from a tag origin', () => {
		expect(fromExtensions('/browse/extensions')).toBe(true);
		expect(fromExtensions('/browse/extensions?tab=installed')).toBe(true);
		expect(fromExtensions('/browse/extensionsx')).toBe(false);
		expect(fromExtensions('/series/1')).toBe(false);
		expect(fromExtensions('')).toBe(false);
	});

	it('is what EXTENSIONS sends: its own address without a sheet', () => {
		expect(extensionsFrom(new URL('http://h/browse/extensions'))).toBe('/browse/extensions');
		expect(
			extensionsFrom(new URL('http://h/browse/extensions?tab=installed&q=open&remove=e2e.open'))
		).toBe('/browse/extensions?tab=installed&q=open');
		const sent = extensionsFrom(new URL('http://h/browse/extensions?q=a%20b&adult=only'));
		expect(settingsOrigin(sent)).toBe(sent);
	});
});

describe('a source page’s own links keep the origin (card c453)', () => {
	const origin = '/downloads/source/100~abc?from=%2Fbrowse%2F100';
	it('adds from= to a bare address, to one with a query, and before a fragment', () => {
		for (const href of ['/browse/100', '/browse/100?tab=latest', '/browse/100/settings?/set']) {
			const u = new URL(keepOrigin(href, origin), 'http://x');
			expect(u.searchParams.get('from'), href).toBe(origin);
			expect(backOrigin(u.searchParams.get('from')), href).toBe(origin);
		}
		expect(keepOrigin('/browse/100?tab=latest', origin)).toBe(
			`/browse/100?tab=latest&from=${encodeURIComponent(origin)}`
		);
		expect(keepOrigin('/browse/100#top', origin)).toBe(
			`/browse/100?from=${encodeURIComponent(origin)}#top`
		);
	});
	it('adds nothing when there is no origin, or backOrigin refused it', () => {
		expect(keepOrigin('/browse/100?tab=latest', '')).toBe('/browse/100?tab=latest');
		expect(keepOrigin('/browse/100', backOrigin('https://evil.example/series/1'))).toBe(
			'/browse/100'
		);
	});
	it('leaves the action a settings row posts to readable as that action', () => {
		// SvelteKit reads the action from the parameter that starts with `/`.
		const u = new URL(keepOrigin('/browse/100/settings?/set', origin), 'http://x');
		expect([...u.searchParams.keys()]).toEqual(['/set', 'from']);
	});
});

describe('the library’s key for a tag', () => {
	it('is namespace:value, or the bare value', () => {
		expect(libraryTagKey({ namespace: 'artist', value: 'Seo Haram' })).toBe('artist:Seo Haram');
		expect(libraryTagKey({ namespace: '', value: 'isekai' })).toBe('isekai');
	});
});

describe('a tag-search route’s address (round 2: the link names the tag, the server finds it)', () => {
	const base = '/series/7/tag-search';

	it('names the tag and where it was tapped, and reads back the same', () => {
		for (const tag of [
			{ namespace: 'genre', value: 'Slice of Life' },
			{ namespace: '', value: 'isekai & co' },
			{ namespace: 'artist', value: 'Ren Kisaragi?' }
		]) {
			const href = tagRouteHref(base, tag, '/series/7?from=%2F');
			const u = new URL(href, 'http://in.app');
			expect(u.pathname).toBe(base);
			expect(readTagRoute(u)).toEqual({ tag, from: '/series/7?from=%2F' });
		}
	});

	it('leaves `from` off when there is none', () => {
		const href = tagRouteHref(base, { namespace: 'genre', value: 'Romance' }, '');
		expect(new URL(href, 'http://in.app').searchParams.has('from')).toBe(false);
	});

	it('refuses a `from` backOrigin refuses, and a tag with no value', () => {
		const u = new URL('http://in.app/x?ns=genre&value=Romance&from=https%3A%2F%2Fevil.example');
		expect(readTagRoute(u)).toEqual({ tag: { namespace: 'genre', value: 'Romance' }, from: '' });
		expect(readTagRoute(new URL('http://in.app/x?ns=genre&value=%20'))).toBeNull();
		expect(readTagRoute(new URL('http://in.app/x?ns=genre'))).toBeNull();
	});

	it('reads a namespace as the library stores it, lower case', () => {
		const u = new URL('http://in.app/x?ns=Author&value=Aoi');
		expect(readTagRoute(u)!.tag).toEqual({ namespace: 'author', value: 'Aoi' });
		// So a person stays a search however the namespace was spelt.
		expect(tagSearchParams([], readTagRoute(u)!.tag)).toEqual([['q', 'Aoi']]);
	});
});

describe('waiting for the source’s filters', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('gives the answer when it comes in time', async () => {
		await expect(settleWithin(Promise.resolve(['a']), 1000, [])).resolves.toEqual(['a']);
	});

	it('gives the fallback when the call fails', async () => {
		await expect(settleWithin(Promise.reject(new Error('down')), 1000, [])).resolves.toEqual([]);
	});

	it('gives the fallback when the call has not answered in time, and not before', async () => {
		vi.useFakeTimers();
		let settled: string[] | null = null;
		void settleWithin(new Promise<string[]>(() => {}), TAG_SCHEMA_WAIT_MS, []).then(
			(v) => (settled = v)
		);
		await vi.advanceTimersByTimeAsync(TAG_SCHEMA_WAIT_MS - 1);
		expect(settled).toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toEqual([]);
	});

	it('waits long enough for a slow source, but less than its own SLOW_MS', () => {
		expect(TAG_SCHEMA_WAIT_MS).toBeGreaterThanOrEqual(10_000);
		expect(TAG_SCHEMA_WAIT_MS).toBeLessThan(60_000);
	});
});

describe('a source’s genres, each once', () => {
	it('keeps the first of a repeated value, in order', () => {
		expect(distinct(['Action', 'Comedy', 'Action'])).toEqual(['Action', 'Comedy']);
	});

	it('tells values apart by exact string: two spellings both stay', () => {
		expect(distinct(['Action', 'action', 'Action '])).toEqual(['Action', 'action', 'Action ']);
	});

	it('holds on its own output', () => {
		const once = distinct(['a', 'b', 'a', 'c', 'b']);
		expect(distinct(once)).toEqual(once);
	});
});
