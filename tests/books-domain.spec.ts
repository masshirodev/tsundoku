import { describe, expect, it } from 'vitest';
import {
	bookNumber,
	isPersonNamespace,
	moveItem,
	orderBooks,
	setKey,
	sharedStart,
	stemKey,
	suggestionLabel,
	suggestionSets,
	titleWords
} from '$lib/library/books';

const KM = [
	'Kaori Mama on Bath Duty',
	'Kaori Mama on Laundry Duty',
	'Kaori Mama on Masturbation Duty',
	'Kaori Mama on Night Duty'
];

describe('titles', () => {
	it('splits into lowercase words, dropping punctuation', () => {
		expect(titleWords('Drawing: Saikyou Mangaka!')).toEqual(['drawing', 'saikyou', 'mangaka']);
	});

	it('names a series by the words every title starts with, without a dangling joiner', () => {
		expect(sharedStart(KM)).toBe('Kaori Mama');
		expect(sharedStart(['Onsen Ryokan no Yoru 3', 'Onsen Ryokan no Yoru 4'])).toBe(
			'Onsen Ryokan no Yoru'
		);
	});

	it('falls back to the first title when titles share nothing', () => {
		expect(sharedStart(['Hanabi no Ato de', 'Natsuiro Afterglow'])).toBe('Hanabi no Ato de');
	});
});

describe('suggestions', () => {
	it('keys on the first two words, and only when they carry enough letters', () => {
		expect(stemKey('Kaori Mama on Bath Duty')).toBe('kaori mama');
		expect(stemKey('Ai no Uta')).toBeNull(); // "aino" is too short to mean anything
		expect(stemKey('Lookism')).toBeNull(); // too short to suggest from
	});

	it('suggests singletons that share a stem, two or more to a set', () => {
		const candidates = [
			...KM.map((title, i) => ({ seriesId: i + 1, title })),
			{ seriesId: 9, title: 'Natsuiro Afterglow Summer' }
		];
		const sets = suggestionSets(candidates, []);
		expect(sets).toHaveLength(1);
		expect(sets[0].map((c) => c.seriesId)).toEqual([1, 2, 3, 4]);
		expect(suggestionLabel(sets[0])).toBe('"KAORI MAMA …"');
	});

	it('never brings back a dismissed set, but a later book raises a new one', () => {
		const four = KM.map((title, i) => ({ seriesId: i + 1, title }));
		const dismissed = [setKey([4, 3, 2, 1])];
		expect(suggestionSets(four, dismissed)).toEqual([]);
		// A subset of a dismissed set stays dismissed.
		expect(suggestionSets(four.slice(0, 2), dismissed)).toEqual([]);
		// A new book makes a set that is not inside the dismissed one.
		const withNew = [...four, { seriesId: 7, title: 'Kaori Mama on Holiday Duty' }];
		expect(suggestionSets(withNew, dismissed)[0].map((c) => c.seriesId)).toEqual([1, 2, 3, 4, 7]);
	});
});

describe('order', () => {
	const books = [
		{ id: 1, title: 'Kaori Mama on Laundry Duty', addedAt: 3 },
		{ id: 2, title: 'Kaori Mama on Bath Duty', addedAt: 1 },
		{ id: 3, title: 'Kaori Mama Vol. 10', addedAt: 2 },
		{ id: 4, title: 'Kaori Mama Vol. 2', addedAt: 4 }
	];

	it('orders by date added, by title with numbers in number order, or leaves the hand order', () => {
		expect(orderBooks(books, 'date').map((b) => b.id)).toEqual([2, 3, 1, 4]);
		expect(orderBooks(books, 'title').map((b) => b.id)).toEqual([2, 1, 4, 3]);
		expect(orderBooks(books, 'hand').map((b) => b.id)).toEqual([1, 2, 3, 4]);
	});

	it('moves one item and numbers positions from 01', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 2, 1)).toEqual(['a', 'c', 'b', 'd']);
		expect(moveItem(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
		expect(bookNumber(0)).toBe('01');
		expect(bookNumber(10)).toBe('11');
	});

	it('knows which namespaces are people', () => {
		expect(isPersonNamespace('circle')).toBe(true);
		expect(isPersonNamespace('genre')).toBe(false);
	});
});
