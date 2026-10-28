import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	changedCount,
	cleanSchema,
	EXCLUDE,
	groupCount,
	INCLUDE,
	readFilters,
	toEngine,
	writeFilters,
	type FilterField
} from '$lib/library/browse-filters';

// The schemas five real sources answered on 2026-10-28 (fixtures/filters).
const dir = new URL('./fixtures/filters/', import.meta.url);
const real = readdirSync(dir).map((f) => ({
	name: f,
	schema: cleanSchema(JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
}));

/** Every choice moved off its default: the round trip's hardest case. */
function moved(schema: FilterField[]): FilterField[] {
	const one = (f: FilterField, i: number): FilterField => {
		switch (f.type) {
			case 'select':
				return { ...f, state: ((f.state as number) + 1) % f.values!.length };
			case 'tristate':
				return { ...f, state: i % 2 ? INCLUDE : EXCLUDE };
			case 'checkbox':
				return { ...f, state: !f.state };
			case 'text':
				return { ...f, state: 'Oda Eiichiro' };
			case 'sort':
				return { ...f, state: { index: f.values!.length - 1, ascending: true } };
			case 'group':
				return { ...f, children: f.children!.map(one) };
			default:
				return f;
		}
	};
	return schema.map(one);
}

const params = (pairs: [string, string][]) => new URLSearchParams(pairs);

describe('the real schemas', () => {
	it('are all read, and nothing settable is lost', () => {
		expect(real.map((r) => r.name).sort()).toEqual([
			'asura-scans.json',
			'mangadex-en.json',
			'mangahere.json',
			'webtoons-en.json',
			'weeb-central.json'
		]);
		const mangadex = real.find((r) => r.name === 'mangadex-en.json')!.schema;
		expect(mangadex.map((f) => f.type)).toEqual([
			'checkbox',
			'group',
			'group',
			'group',
			'group',
			'sort',
			'select',
			'group',
			'group',
			'group',
			'group',
			'group'
		]);
		const genre = mangadex.find((f) => f.name === 'Genre')!;
		expect(genre.children!.every((c) => c.type === 'tristate')).toBe(true);
	});

	it.each(real)('$name: the defaults survive the URL unchanged', ({ schema }) => {
		const back = readFilters(schema, params(writeFilters(schema)));
		expect(back).toEqual(schema);
		expect(changedCount(schema, back)).toBe(0);
	});

	it.each(real)('$name: every choice moved survives the URL unchanged', ({ schema }) => {
		const all = moved(schema);
		expect(readFilters(schema, params(writeFilters(all)))).toEqual(all);
	});

	it.each(real)('$name: moving one choice changes one key and one count', ({ schema }) => {
		const i = schema.findIndex((f) => f.type === 'select' || f.type === 'group');
		if (i < 0) return;
		const one = schema.map((f, j) => (j === i ? moved([f])[0] : f));
		const before = new Map(writeFilters(schema));
		const after = new Map(writeFilters(one));
		const differ = [...new Set([...before.keys(), ...after.keys()])].filter(
			(k) => before.get(k) !== after.get(k)
		);
		const first = one[i].type === 'group' ? one[i].children!.length : 1;
		expect(changedCount(schema, one)).toBe(first);
		expect(differ.length).toBe(first);
	});
});

const schema: FilterField[] = cleanSchema([
	{ type: 'header', name: 'Ignored when searching by text' },
	{ type: 'separator', name: '' },
	{ type: 'select', name: 'Status', state: 1, values: ['All', 'Ongoing', 'Completed'] },
	{
		type: 'sort',
		name: 'Sort By',
		state: { index: 0, ascending: false },
		values: ['Latest', 'A-Z']
	},
	{ type: 'checkbox', name: 'Has chapters', state: true },
	{ type: 'text', name: 'Author', state: '' },
	{
		type: 'group',
		name: 'Genre',
		children: [
			{ type: 'tristate', name: 'Action', state: 0 },
			{ type: 'tristate', name: 'Horror', state: 0 }
		]
	}
]);

describe('reading the form', () => {
	it('takes the URL where it speaks, the default where it doesn’t, and an unticked box as off', () => {
		const got = readFilters(
			schema,
			params([
				['f3', '1'],
				['f3.o', 'a'],
				['f6.1', '2']
			])
		);
		expect(got[2].state).toBe(1);
		expect(got[3].state).toEqual({ index: 1, ascending: true });
		expect(got[4].state).toBe(false);
		expect(got[6].children!.map((c) => c.state)).toEqual([0, EXCLUDE]);
		expect(changedCount(schema, got)).toBe(3);
	});

	it('refuses values out of range rather than send them', () => {
		const got = readFilters(
			schema,
			params([
				['f2', '9'],
				['f3', '-1'],
				['f6.0', '7'],
				['f5', 'x'.repeat(500)]
			])
		);
		expect(got[2].state).toBe(0);
		expect(got[3].state).toEqual({ index: 0, ascending: false });
		expect(got[6].children![0].state).toBe(0);
		expect((got[5].state as string).length).toBe(200);
	});
});

describe('sending it to the engine', () => {
	it('writes each type as the engine reads it, a top-level checkbox inside stateList', () => {
		const got = readFilters(
			schema,
			params([
				['f2', '2'],
				['f3', '1'],
				['f3.o', 'd'],
				['f4', '1'],
				['f5', 'Oda'],
				['f6.0', '1']
			])
		);
		expect(toEngine(got)).toEqual([
			{ name: 'Status', type: 'select', stateInt: 2 },
			{ name: 'Sort By', type: 'sort', stateSort: { index: 1, ascending: false } },
			{
				name: 'Has chapters',
				type: 'checkbox',
				stateList: [{ name: 'Has chapters', type: 'checkbox', stateBoolean: true }]
			},
			{ name: 'Author', type: 'text', stateString: 'Oda' },
			{
				name: 'Genre',
				type: 'group',
				stateList: [
					{ name: 'Action', type: 'tristate', stateInt: INCLUDE },
					{ name: 'Horror', type: 'tristate', stateInt: 0 }
				]
			}
		]);
	});

	it('leaves out a sort with nothing chosen', () => {
		const s = cleanSchema([{ type: 'sort', name: 'Order', state: null, values: ['Rating'] }]);
		expect(toEngine(s)).toEqual([]);
		expect(writeFilters(s)).toEqual([]);
	});
});

describe('a schema the engine sent wrong', () => {
	it('drops what it can’t draw truthfully', () => {
		expect(
			cleanSchema([
				null,
				{ type: 'select', name: 'No values', state: 0, values: [] },
				{ type: 'mystery', name: 'Unknown' },
				{ type: 'group', name: 'Empty', children: [{ type: 'text', name: 'Text in a group' }] },
				{ type: 'sort', name: 'Bad index', state: { index: 5, ascending: true }, values: ['A'] },
				{ type: 'tristate', name: 'Bad state', state: 9 }
			])
		).toEqual([
			{ type: 'sort', name: 'Bad index', values: ['A'], state: null },
			{ type: 'tristate', name: 'Bad state', state: 0 }
		]);
		expect(cleanSchema('nope')).toEqual([]);
	});
});

describe('a group’s count', () => {
	it('says IN and OUT for tri-states, ON for checkboxes, nothing at rest', () => {
		const g = readFilters(
			schema,
			params([
				['f6.0', '1'],
				['f6.1', '2']
			])
		)[6];
		expect(groupCount(g)).toBe('1 IN · 1 OUT');
		expect(groupCount(schema[6])).toBe('');
		const boxes = cleanSchema([
			{
				type: 'group',
				name: 'Status',
				children: [
					{ type: 'checkbox', name: 'Ongoing', state: true },
					{ type: 'checkbox', name: 'Hiatus', state: false }
				]
			}
		])[0];
		expect(groupCount(boxes)).toBe('1 ON');
	});
});
