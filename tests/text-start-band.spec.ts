import { describe, expect, it } from 'vitest';
import {
	LEAD_BLOCKS,
	SHORT_LINE,
	bandTitle,
	foldTitle,
	leadLine,
	type LeadBlock
} from '$lib/reader/start-band';

/**
 * The band at a chapter's start (c705; doc/TEXT-READER.md, "A chapter's
 * start"): the table-of-contents title is drawn only where the book does not
 * already print it. Every prefix the card names is here, with a heading that
 * differs, no heading, a first short line, and the fold run on its own output.
 */

const h = (text: string, tag = 'h1'): LeadBlock => ({ tag, text });
const p = (text: string): LeadBlock => ({ tag: 'p', text });
const fig: LeadBlock = { tag: 'figure', text: '' };
const LONG = 'The steward did not sit down. '.repeat(5);

describe('leadLine', () => {
	it('is the first heading, past an illustration or a rule', () => {
		expect(leadLine([fig, { tag: 'hr', text: '' }, h('The Commission', 'h2'), p(LONG)])).toBe(
			'The Commission'
		);
	});
	it('takes a heading after a short line over the short line', () => {
		expect(leadLine([p('Volume One'), h('The Commission'), p(LONG)])).toBe('The Commission');
	});
	it('is the first short line when there is no heading', () => {
		expect(leadLine([p('Chapter 212: The Commission'), p(LONG)])).toBe(
			'Chapter 212: The Commission'
		);
	});
	it('stops at the first long paragraph: a heading after it is not the chapter’s', () => {
		expect(leadLine([p(LONG), h('A scene title')])).toBeNull();
	});
	it('is null for a chapter with no text at its start, or none at all', () => {
		expect(leadLine([])).toBeNull();
		expect(leadLine([fig])).toBeNull();
	});
	it('folds the whitespace of a heading split over lines', () => {
		expect(leadLine([h('  Chapter 1\n  The Article ')])).toBe('Chapter 1 The Article');
	});
	it(`a line of exactly ${SHORT_LINE} characters is short; one more is the text`, () => {
		const at = 'x'.repeat(SHORT_LINE);
		expect(leadLine([p(at)])).toBe(at);
		expect(leadLine([p(at + 'x')])).toBeNull();
	});
	it(`looks at ${LEAD_BLOCKS} blocks with text, and no further`, () => {
		const shorts = Array.from({ length: LEAD_BLOCKS - 1 }, (_, i) => ({ tag: 'li', text: `${i}` }));
		expect(leadLine([...shorts, h('Found')])).toBe('Found');
		expect(leadLine([...shorts, { tag: 'li', text: 'one more' }, h('Too far')])).toBeNull();
	});
});

describe('foldTitle', () => {
	// Every prefix the card names, and their neighbours, each folding to the
	// same rest: "the commission".
	const SAME = [
		'The Commission',
		'the commission',
		'THE COMMISSION!',
		'  The   Commission. ',
		'Chapter 212: The Commission',
		'Chapter 212 - The Commission',
		'chapter212: The Commission',
		'Ch. 212 - The Commission',
		'Ch. 212 – The Commission',
		'Ch 212 — The Commission',
		'CH.212: The Commission',
		'Chap. 212. The Commission',
		'Chapter IV: The Commission',
		'第212話 The Commission',
		'第２１２話　The Commission',
		'第十二章：The Commission',
		'“The Commission”'
	];
	for (const s of SAME)
		it(`"${s}" folds to "thecommission"`, () => expect(foldTitle(s)).toBe('thecommission'));

	it('a title that is only its number folds to the number', () => {
		expect(foldTitle('Chapter 212')).toBe('212');
		expect(foldTitle('Ch. 212')).toBe('212');
		expect(foldTitle('第212話')).toBe('212');
		expect(foldTitle('212')).toBe('212');
		expect(foldTitle('Chapter IV')).toBe('iv');
	});
	it('never reads a word that starts with "ch" as a chapter', () => {
		expect(foldTitle('Child of the Commission')).toBe('childofthecommission');
		expect(foldTitle('Chimera')).toBe('chimera');
		expect(foldTitle('Chapterhouse')).toBe('chapterhouse');
	});
	it('a different number with the same rest is the same title: the rest is what is printed', () => {
		expect(foldTitle('Chapter 3: Home')).toBe(foldTitle('Ch. 4 - Home'));
	});

	const ALL = [
		...SAME,
		'Chapter 212',
		'Ch-2 x',
		'Ch. 1 - Ch. 2 - Home',
		'Chapter 3: chapter 4',
		'第三話',
		'Vol. 1',
		'Afterword',
		'',
		'!!!',
		'212',
		'Child of the Commission',
		'ch2abc',
		'ＣＨＡＰＴＥＲ　５：Ｘ'
	];
	it('holds on its own output', () => {
		for (const s of ALL) expect(foldTitle(foldTitle(s)), s).toBe(foldTitle(s));
	});
});

describe('bandTitle', () => {
	it('leaves the title out when the heading repeats it', () => {
		expect(bandTitle('The Commission', 'The Commission')).toBe(false);
		expect(bandTitle('Vol. 1', 'Vol. 1')).toBe(false);
	});
	it('leaves it out when the heading carries a "Chapter n:" prefix the TOC does not, or the other way', () => {
		expect(bandTitle('The Commission', 'Chapter 212: The Commission')).toBe(false);
		expect(bandTitle('Chapter 212: The Commission', 'The Commission')).toBe(false);
		expect(bandTitle('Ch. 212 - The Commission', '第212話 The Commission')).toBe(false);
		expect(bandTitle('Chapter 1: The Article', 'Chapter 1: The Article')).toBe(false);
	});
	it('draws it when the chapter has no heading', () => {
		expect(bandTitle('The Commission', null)).toBe(true);
	});
	it('draws it when the heading differs', () => {
		expect(bandTitle('The Commission', 'Interlude')).toBe(true);
		expect(bandTitle('Chapter 212: The Commission', 'Chapter 212')).toBe(true);
	});
	it('draws it over a first short line that is not the title', () => {
		expect(bandTitle('The Commission', leadLine([p('"How large?" he asked.'), p(LONG)]))).toBe(
			true
		);
	});
	it('leaves it out over a first short line that is the title', () => {
		expect(bandTitle('The Commission', leadLine([p('Chapter 212: The Commission'), p(LONG)]))).toBe(
			false
		);
	});
	it('a title that folds to nothing is never drawn', () => {
		expect(bandTitle('', null)).toBe(false);
		expect(bandTitle('***', 'Anything')).toBe(false);
	});
	it('on its own output: a title the band draws, printed by the book, is then left out', () => {
		for (const t of ['The Commission', 'Chapter 212: The Commission', '第212話', 'Vol. 1'])
			if (bandTitle(t, null)) expect(bandTitle(t, t)).toBe(false);
	});
});
