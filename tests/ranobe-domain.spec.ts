import { describe, expect, it } from 'vitest';
import {
	chapterOf,
	chooseEdition,
	mapUnits,
	ratingOut,
	suggestedUnits,
	unitNumber,
	unitWants,
	unitsRead,
	volumeOf,
	type EditionSummary,
	type MappedEntry
} from '$lib/library/ranobe';

describe('volumeOf', () => {
	it('reads the volume a one-volume EPUB is, from its title or file', () => {
		expect(volumeOf('Alya Sometimes Hides Her Feelings in Russian, Vol. 1')).toBe('1');
		expect(volumeOf('Eminence in Shadow: Volume 5')).toBe('5');
		expect(volumeOf('The Beginning After the End: Book 10: Retribution')).toBe('10');
		expect(volumeOf('The Beginning After The End 08')).toBe('8');
		expect(volumeOf('Kino no Tabi - Volume 1')).toBe('1');
		expect(volumeOf('No number', 'The Beginning After the End - Book 8 - Ascension.epub')).toBe(
			'8'
		);
	});

	it('takes no span of chapters, and no title without a number, for a volume', () => {
		expect(volumeOf('Lord of the Mysteries: 1-1429')).toBeNull();
		expect(volumeOf('Pick Me Up! c1-591')).toBeNull();
		expect(volumeOf("Omniscient Reader's Viewpoint")).toBeNull();
	});
});

describe('chapterOf', () => {
	it('reads a label that leads with a chapter number', () => {
		expect(chapterOf('254 Hello Darkness')).toBe('254');
		expect(chapterOf('Chapter 12: The Return')).toBe('12');
		expect(chapterOf('Chapter 1.1')).toBe('1.1');
		expect(chapterOf('Ch. 3')).toBe('3');
		expect(chapterOf('Prologue: The Darkness')).toBeNull();
	});

	it('compares numbers as numbers', () => {
		expect(unitNumber('05')).toBe('5');
		expect(unitNumber('12.50')).toBe('12.5');
		expect(unitNumber('Extra')).toBe('Extra');
	});
});

const entry = (
	id: number,
	label: string,
	readAt: number | null = null,
	matter = ''
): MappedEntry => ({
	id,
	label,
	matter,
	readAt
});
const vol = (n: number) => ({ ref: `e9:volume:${n}`, type: 'volume', number: String(n) });
const ch = (n: number) => ({ ref: `e9:chapter:${n}`, type: 'chapter', number: String(n) });

describe('mapUnits', () => {
	it('maps a one-volume EPUB onto its volume, leaving the matter out', () => {
		const m = mapUnits([vol(4), vol(5)], {
			volume: '5',
			entries: [
				entry(1, 'Illustrations', null, 'front'),
				entry(2, 'Prologue'),
				entry(3, 'Chapter 1'),
				entry(4, 'Credits', null, 'back')
			]
		});
		expect([...m]).toEqual([
			[2, 'e9:volume:5'],
			[3, 'e9:volume:5']
		]);
	});

	it('maps a volume per entry, and a chapter per entry', () => {
		expect([
			...mapUnits([vol(1), vol(2)], {
				volume: null,
				entries: [entry(1, 'Vol. 1'), entry(2, 'Vol. 2'), entry(3, 'Vol. 3')]
			})
		]).toEqual([
			[1, 'e9:volume:1'],
			[2, 'e9:volume:2']
		]);
		expect([
			...mapUnits([ch(254), ch(255)], {
				volume: null,
				entries: [
					entry(1, '254 Hello Darkness'),
					entry(2, 'Afterword'),
					entry(3, '255 The Next Message')
				]
			})
		]).toEqual([
			[1, 'e9:chapter:254'],
			[3, 'e9:chapter:255']
		]);
	});

	it('maps nothing the edition does not list', () => {
		expect(mapUnits([], { volume: '5', entries: [entry(1, 'Chapter 1')] }).size).toBe(0);
		// A volume the edition lacks: nothing, never its chapters by accident.
		expect(mapUnits([vol(1)], { volume: '5', entries: [entry(1, 'Chapter 1')] }).size).toBe(0);
	});
});

describe('unitsRead', () => {
	it('reads a unit once every entry on it is, at the last of them', () => {
		const r = unitsRead([
			{ unit: 'v5', readAt: 10 },
			{ unit: 'v5', readAt: 30 },
			{ unit: 'v6', readAt: 10 },
			{ unit: 'v6', readAt: null }
		]);
		expect(r.get('v5')).toBe(30);
		expect(r.get('v6')).toBeNull();
	});

	it('sends a read, takes back only what it sent, and leaves the rest', () => {
		expect(unitWants({ unit: 'u', readAt: 1, sentAt: null })).toBe('read');
		expect(unitWants({ unit: 'u', readAt: null, sentAt: 1 })).toBe('unread');
		expect(unitWants({ unit: 'u', readAt: 1, sentAt: 1 })).toBeNull();
		expect(unitWants({ unit: 'u', readAt: null, sentAt: null })).toBeNull();
	});
});

describe('editions', () => {
	const ed = (ref: string, lang: string, origin: string, format: string): EditionSummary => ({
		ref,
		lang,
		origin,
		format,
		units: {}
	});

	it('picks the series language, licensed before fan, ebook before print', () => {
		const all = [
			ed('e1', 'ja', 'original', 'bunkobon'),
			ed('e2', 'en', 'fan', 'web'),
			ed('e3', 'en', 'licensed', 'paperback'),
			ed('e4', 'en', 'licensed', 'ebook')
		];
		expect(chooseEdition(all, 'en')?.ref).toBe('e4');
		expect(chooseEdition(all, 'pt')).toBeNull();
		expect(chooseEdition([ed('e5', 'pt-BR', 'licensed', 'ebook')], 'pt')?.ref).toBe('e5');
	});

	it('suggests volumes 1 to the highest held', () => {
		expect(suggestedUnits(['5', '6'])).toEqual(
			[1, 2, 3, 4, 5, 6].map((n) => ({ type: 'volume', number: String(n) }))
		);
		expect(suggestedUnits([])).toEqual([]);
	});
});

describe('ratingOut', () => {
	it('sends 1 to 10 as it is, and unrated as null', () => {
		expect(ratingOut(7)).toBe(7);
		expect(ratingOut(0)).toBeNull();
	});
});
