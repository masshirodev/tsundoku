import { describe, expect, it } from 'vitest';
import {
	baseToEdition,
	between,
	editionToBase,
	langCode,
	onlyIn,
	openingEdition,
	partOfBigger,
	type Edition
} from '$lib/library/editions';

// EN (the base) 29 pages, JA 28: EN's p. 29 is a translator's note JA lacks.
const rows = [
	...Array.from({ length: 28 }, (_, i) => ({ a: i + 1, b: i + 1 })),
	{ a: 29, b: null }
];
// ZH has a credits page first, then EN's pages 1–28.
const zhRows = [
	{ a: null, b: 1 },
	...Array.from({ length: 28 }, (_, i) => ({ a: i + 1, b: i + 2 }))
];
const en: Edition = { entryId: 1, language: 'english', rows: [], base: true };
const ja: Edition = { entryId: 2, language: 'japanese', rows, base: false };
const zh: Edition = { entryId: 3, language: 'chinese', rows: zhRows, base: false };

describe('a page, from one edition to another', () => {
	it('lands on the matched page', () => {
		expect(baseToEdition(rows, 12)).toEqual({ page: 12, exact: true });
		expect(editionToBase(zhRows, 13)).toEqual({ page: 12, exact: true });
	});
	it('lands on the nearest matched page where the other lacks it', () => {
		// EN P. 29 isn't in JA: JA P. 28.
		expect(baseToEdition(rows, 28)).toEqual({ page: 27, exact: false });
		// ZH's credits page (P. 1) isn't in EN: EN P. 1.
		expect(editionToBase(zhRows, 0)).toEqual({ page: 0, exact: false });
	});
	it('goes through the base between two editions', () => {
		expect(between(ja, zh, 12)).toEqual({ page: 13, exact: true });
		expect(between(zh, ja, 13)).toEqual({ page: 12, exact: true });
		expect(between(en, ja, 12)).toEqual({ page: 12, exact: true });
		expect(between(ja, en, 12)).toEqual({ page: 12, exact: true });
	});
});

describe('which edition opens', () => {
	const eds = [en, ja, zh];
	it('the book’s own choice, else the preferred language, else the one last read', () => {
		expect(
			openingEdition(eds, { own: 'japanese', preferred: 'english', lastRead: null }).entryId
		).toBe(2);
		expect(
			openingEdition(eds, { own: null, preferred: 'chinese', lastRead: 'japanese' }).entryId
		).toBe(3);
		expect(
			openingEdition(eds, { own: null, preferred: 'korean', lastRead: 'japanese' }).entryId
		).toBe(2);
		expect(openingEdition(eds, { own: null, preferred: 'korean', lastRead: null }).entryId).toBe(1);
	});
});

describe('the rest', () => {
	it('names languages by code', () => {
		expect(langCode('japanese')).toBe('JA');
		expect(langCode('chinese')).toBe('ZH');
		expect(langCode('klingon')).toBe('KL');
	});
	it('says which pages only one edition has', () => {
		expect(onlyIn(rows, 'a')).toEqual([29]);
		expect(onlyIn(zhRows, 'b')).toEqual([1]);
	});
	it('a 24-page book inside an 83-page collection is part of it, not an edition', () => {
		const part = [
			...Array.from({ length: 22 }, (_, i) => ({ a: i + 1, b: i + 30 })),
			...Array.from({ length: 61 }, (_, i) => ({ a: null, b: i < 29 ? i + 1 : i + 23 }))
		];
		expect(partOfBigger(part, 24, 83)).toBe(true);
		expect(partOfBigger(rows, 29, 28)).toBe(false);
	});
});
