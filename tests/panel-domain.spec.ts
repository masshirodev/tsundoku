import { describe, expect, it } from 'vitest';
import {
	boxInCrop,
	firstWord,
	inflection,
	ordinal,
	placement,
	posLabel,
	wordCells
} from '$lib/japanese/panel';

describe('where the lookup panel goes', () => {
	const at = (top: number, bottom: number, left = 100, right = 200) => ({
		top,
		bottom,
		left,
		right
	});

	it('takes the half of a portrait screen away from the block', () => {
		expect(placement(at(100, 300), 800, 1280)).toEqual({ kind: 'bottom' });
		expect(placement(at(900, 1100), 800, 1280)).toEqual({ kind: 'top' });
	});

	it('is a column on the far side in landscape', () => {
		expect(placement(at(100, 300, 100, 300), 1280, 800)).toEqual({ kind: 'side', side: 'right' });
		expect(placement(at(100, 300, 900, 1100), 1280, 800)).toEqual({ kind: 'side', side: 'left' });
	});

	it('slides a phone’s page up just enough for the block to clear the panel', () => {
		// 780 tall: the panel takes the bottom 468px, its top at 312.
		expect(placement(at(100, 250), 360, 780)).toEqual({ kind: 'phone', lift: 0 });
		expect(placement(at(400, 520), 360, 780)).toEqual({ kind: 'phone', lift: 224 });
	});
});

describe('the block’s words', () => {
	const tokens = [{ lookupable: false }, { lookupable: true }, { lookupable: true }];
	it('are cells, punctuation muted, the first word selected', () => {
		expect(wordCells(tokens)).toEqual([
			{ i: 0, word: false },
			{ i: 1, word: true },
			{ i: 2, word: true }
		]);
		expect(firstWord(tokens)).toBe(1);
		expect(firstWord([{ lookupable: false }])).toBe(0);
	});
});

describe('the entry', () => {
	it('names JMdict’s parts of speech', () => {
		expect(posLabel(['v5k', 'vt'])).toBe('GODAN VERB · TRANSITIVE');
		expect(posLabel(['n'])).toBe('NOUN');
		expect(posLabel(['v5k', 'v5r'])).toBe('GODAN VERB');
		expect(posLabel(['zz'])).toBe('ZZ');
	});

	it('shows the form met beside the one looked up', () => {
		expect(inflection('描いた', '描く')).toBe('描いた ← 描く');
		expect(inflection('東門', '東門')).toBe('');
	});

	it('counts lookups in words', () => {
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
			'1ST',
			'2ND',
			'3RD',
			'4TH',
			'11TH',
			'12TH',
			'13TH',
			'21ST',
			'22ND',
			'101ST'
		]);
	});
});

describe('a block on a cropped page', () => {
	it('moves with the crop, and vanishes when it’s cropped away', () => {
		expect(boxInCrop([0.2, 0.2, 0.1, 0.1], null)).toEqual([0.2, 0.2, 0.1, 0.1]);
		const inCrop = boxInCrop([0.5, 0.5, 0.1, 0.1], [0.1, 0.1, 0.1, 0.1])!;
		expect(inCrop.map((n) => Math.round(n * 1000) / 1000)).toEqual([0.5, 0.5, 0.125, 0.125]);
		expect(boxInCrop([0, 0, 0.05, 0.05], [0.1, 0.1, 0.1, 0.1])).toBeNull();
	});
});
