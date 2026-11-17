import { describe, expect, it } from 'vitest';
import { lnSchema, lnValues, type LnFilters } from '$lib/library/lnreader-filters';
import { readFilters, writeFilters } from '$lib/library/browse-filters';

// LNReader's filters as BROWSE draws them, and back (doc/NOVELS.md).
// Shaped as lnreader-plugins' filter types are (src/types/filters.ts, MIT).
const raw: LnFilters = {
	sort: {
		type: 'Picker',
		label: 'Sort by',
		value: 'popular',
		options: [
			{ label: 'Popular', value: 'popular' },
			{ label: 'Newest', value: 'new' }
		]
	},
	completed: { type: 'Switch', label: 'Completed only', value: false },
	author: { type: 'Text', label: 'Author', value: '' },
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
			{ label: 'Romance', value: 'romance' },
			{ label: 'Horror', value: 'horror' }
		]
	}
};

describe('a plugin’s filters', () => {
	it('become BROWSE’s fields, in the plugin’s order, with its starting values', () => {
		const { keys, schema } = lnSchema(raw);
		expect(keys).toEqual(['sort', 'completed', 'author', 'status', 'genres']);
		expect(schema.map((f) => [f.type, f.name])).toEqual([
			['select', 'Sort by'],
			['checkbox', 'Completed only'],
			['text', 'Author'],
			['group', 'Status'],
			['group', 'Genres']
		]);
		expect(schema[3].children!.map((c) => c.state)).toEqual([true, false]);
		expect(schema[4].children!.map((c) => c.type)).toEqual(['tristate', 'tristate', 'tristate']);
	});

	it('go back as the plugin reads them, unchanged at rest', () => {
		const { keys, schema } = lnSchema(raw);
		expect(lnValues(raw, keys, schema)).toEqual({
			sort: { type: 'Picker', value: 'popular' },
			completed: { type: 'Switch', value: false },
			author: { type: 'Text', value: '' },
			status: { type: 'Checkbox', value: ['ongoing'] },
			genres: { type: 'XCheckbox', value: { include: [], exclude: [] } }
		});
	});

	it('carry the panel’s choices through the URL to the plugin', () => {
		const { keys, schema } = lnSchema(raw);
		const params = new URLSearchParams([
			['f0', '1'],
			['f1', '1'],
			['f2', 'Guiltythree'],
			['f3.1', '1'],
			['f4.0', '1'],
			['f4.2', '2']
		]);
		const back = lnValues(raw, keys, readFilters(schema, params));
		expect(back).toEqual({
			sort: { type: 'Picker', value: 'new' },
			completed: { type: 'Switch', value: true },
			author: { type: 'Text', value: 'Guiltythree' },
			status: { type: 'Checkbox', value: ['hiatus'] },
			genres: { type: 'XCheckbox', value: { include: ['action'], exclude: ['horror'] } }
		});
		// And the URL the panel writes reads back the same.
		expect(
			readFilters(schema, new URLSearchParams(writeFilters(readFilters(schema, params))))
		).toEqual(readFilters(schema, params));
	});

	it('drops what it can’t draw', () => {
		expect(
			lnSchema({
				odd: { type: 'Mystery' },
				empty: { type: 'Picker', label: 'E', value: '', options: [] }
			}).schema
		).toEqual([]);
		expect(lnSchema(null)).toEqual({ keys: [], schema: [] });
	});
});
