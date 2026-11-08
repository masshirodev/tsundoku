import { describe, expect, it } from 'vitest';
import {
	LEAD_BLOCKS,
	SHORT_LINE,
	bandTitle,
	foldTitle,
	leadLine,
	leadLines,
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

describe('leadLines', () => {
	it('is the lead alone when it names more than a number', () => {
		expect(leadLines([h('The Commission'), h('Part one', 'h2'), p(LONG)])).toEqual([
			'The Commission'
		]);
	});
	it('reads the line after a lead that is only a number, and the two joined', () => {
		expect(leadLines([h('Chapter 1'), h('The Article', 'h2'), p(LONG)])).toEqual([
			'Chapter 1',
			'The Article',
			'Chapter 1 The Article'
		]);
		expect(leadLines([p('Chapter 1'), fig, p('The Article'), p(LONG)])).toEqual([
			'Chapter 1',
			'The Article',
			'Chapter 1 The Article'
		]);
	});
	it('takes no second line when the text starts after the number', () => {
		expect(leadLines([h('Chapter 1'), p(LONG), h('A scene title')])).toEqual(['Chapter 1']);
		expect(leadLines([h('Chapter 1'), { tag: 'li', text: 'one' }])).toEqual(['Chapter 1']);
		expect(leadLines([h('Chapter 1')])).toEqual(['Chapter 1']);
	});
	it(`looks for the second line within the ${LEAD_BLOCKS} blocks`, () => {
		const shorts = Array.from({ length: LEAD_BLOCKS - 1 }, (_, i) => ({ tag: 'li', text: `${i}` }));
		expect(leadLines([...shorts, h('Chapter 1'), h('Too far', 'h2')])).toEqual(['Chapter 1']);
	});
	it('is empty where leadLine is null', () => {
		expect(leadLines([])).toEqual([]);
		expect(leadLines([p(LONG), h('Chapter 1')])).toEqual([]);
	});
});

describe('bandTitle over a number and a title in two blocks', () => {
	it('leaves the title out when the book prints it under its number', () => {
		const split = leadLines([h('Chapter 1'), h('The Article', 'h2'), p(LONG)]);
		expect(bandTitle('Chapter 1: The Article', split)).toBe(false);
		expect(bandTitle('The Article', split)).toBe(false);
	});
	it('in two short paragraphs as well', () => {
		expect(
			bandTitle('Chapter 1: The Article', leadLines([p('Chapter 1'), p('The Article'), p(LONG)]))
		).toBe(false);
	});
	it('and in Japanese', () => {
		expect(bandTitle('第一章　旅立ち', leadLines([h('第一章'), h('旅立ち', 'h2')]))).toBe(false);
	});
	it('draws it when the line under the number is something else', () => {
		expect(
			bandTitle('Chapter 1: The Article', leadLines([h('Chapter 1'), h('Interlude', 'h2')]))
		).toBe(true);
	});
	it('on its own output: a title it draws under a bare number is left out once printed under it', () => {
		for (const t of ['The Article', 'Chapter 1: The Article'])
			if (bandTitle(t, leadLines([h('Chapter 1'), p(LONG)])))
				expect(bandTitle(t, leadLines([h('Chapter 1'), h(t, 'h2'), p(LONG)]))).toBe(false);
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
	});
	it('draws it under a heading that is only the number, with the text right after it', () => {
		expect(bandTitle('Chapter 212: The Commission', leadLines([h('Chapter 212'), p(LONG)]))).toBe(
			true
		);
		expect(bandTitle('Chapter 1: The Article', leadLines([h('Chapter 1'), p(LONG)]))).toBe(true);
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

/**
 * c741: five shapes the rule still printed a title for. Each has its case, and
 * a case for a real title that differs, so the rule did not simply widen.
 */
const quote = (text: string): LeadBlock => ({ tag: 'blockquote', text });

describe('a short title line before a number-only heading (c741)', () => {
	it('leaves the title out', () => {
		const lines = leadLines([p('The Article'), h('Chapter 1'), p(LONG)]);
		expect(lines).toEqual(['Chapter 1', 'The Article', 'Chapter 1 The Article']);
		expect(bandTitle('Chapter 1: The Article', lines)).toBe(false);
	});
	it('still draws a title the line before the number is not', () => {
		const lines = leadLines([p('Volume One'), h('Chapter 1'), p(LONG)]);
		expect(bandTitle('Chapter 1: The Article', lines)).toBe(true);
	});
	it('reads the block right before the number, past one without text', () => {
		expect(
			bandTitle('The Article', leadLines([p('The Article'), fig, h('Chapter 1'), p(LONG)]))
		).toBe(false);
		// Not an earlier one: "Volume One" is what stands over this number.
		expect(
			bandTitle(
				'The Article',
				leadLines([p('The Article'), p('Volume One'), h('Chapter 1'), p(LONG)])
			)
		).toBe(true);
	});
	it('reads it only for a number: a heading that names something is the lead alone', () => {
		expect(leadLines([p('The Article'), h('Interlude'), p(LONG)])).toEqual(['Interlude']);
		expect(bandTitle('The Article', leadLines([p('The Article'), h('Interlude')]))).toBe(true);
	});
	it('still reads the line after as well as the line before', () => {
		const lines = leadLines([p('Volume One'), h('Chapter 1'), h('The Article', 'h2'), p(LONG)]);
		expect(bandTitle('Chapter 1: The Article', lines)).toBe(false);
		expect(bandTitle('Chapter 1: Something Else', lines)).toBe(true);
	});
	it('reads the line before a number that is the last of the leading blocks', () => {
		const shorts = Array.from({ length: LEAD_BLOCKS - 2 }, (_, i) => ({
			tag: 'li',
			text: `${i}`
		}));
		const lines = leadLines([...shorts, p('The Article'), h('Chapter 1'), h('Too far', 'h2')]);
		expect(lines).toContain('The Article');
		expect(lines).not.toContain('Too far');
	});
	it('takes a long paragraph before the number for the text, as ever', () => {
		expect(leadLines([p(LONG), h('Chapter 1'), p('The Article')])).toEqual([]);
	});
});

describe('a spelled-out chapter number (c741)', () => {
	const ONES = 'one two three four five six seven eight nine'.split(' ');
	const TEENS =
		'ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
	const TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
	/** 1 to 999 in words, written here rather than asked of the code it checks. */
	const words = (n: number): string => {
		if (n >= 100) {
			const rest = n % 100;
			const head = `${ONES[Math.floor(n / 100) - 1]} hundred`;
			return rest ? `${head} and ${words(rest)}` : head;
		}
		if (n >= 20) {
			const one = n % 10;
			return one ? `${TENS[Math.floor(n / 10) - 2]}-${ONES[one - 1]}` : TENS[n / 10 - 2];
		}
		return n >= 10 ? TEENS[n - 10] : ONES[n - 1];
	};

	it('a number and a title in two blocks, the number in words', () => {
		const lines = leadLines([h('Chapter One'), h('The Article', 'h2')]);
		expect(bandTitle('Chapter 1: The Article', lines)).toBe(false);
		expect(bandTitle('The Article', lines)).toBe(false);
	});
	it('still draws a title the line under the number is not', () => {
		const lines = leadLines([h('Chapter One'), h('Interlude', 'h2')]);
		expect(bandTitle('Chapter 1: The Article', lines)).toBe(true);
		expect(bandTitle('The Article', leadLines([h('Chapter One'), p(LONG)]))).toBe(true);
	});
	it('every number from 1 to 300, in words, is that number', () => {
		for (let n = 1; n <= 300; n++) {
			const w = words(n);
			expect(foldTitle(`Chapter ${w}`), w).toBe(String(n));
			expect(foldTitle(`Chapter ${w}: The Article`), w).toBe('thearticle');
			expect(bandTitle(`Chapter ${n}`, `Chapter ${w}`), w).toBe(false);
		}
	});
	it('takes the other spellings of one number', () => {
		for (const s of [
			'Chapter Twenty One',
			'chapter twenty-one',
			'CHAPTER TWENTY-ONE',
			'Ch. Twenty-One',
			'Chap. Twenty-One',
			'Ch Twenty One'
		])
			expect(foldTitle(s), s).toBe('21');
		expect(foldTitle('Chapter One Hundred Five')).toBe('105');
		expect(foldTitle('Chapter Hundred')).toBe('100');
	});
	it('different numbers in words are different titles', () => {
		expect(bandTitle('Chapter 2', 'Chapter One')).toBe(true);
		expect(bandTitle('Chapter Twenty', 'Chapter Twenty-One')).toBe(true);
	});
	it('counts only in the chapter prefix’s position: a title is not a number', () => {
		for (const s of ['One Piece', 'Seven Seas', 'Twenty', 'Nine Lives', 'One', 'Ten'])
			expect(foldTitle(s), s).toBe(s.toLowerCase().replace(/\s/g, ''));
		expect(leadLines([h('One'), h('Piece', 'h2')])).toEqual(['One']);
		expect(leadLines([h('Seven Seas'), h('Interlude', 'h2')])).toEqual(['Seven Seas']);
		expect(bandTitle('Seven Seas', 'Chapter 7')).toBe(true);
		expect(bandTitle('One Piece', 'Chapter 1')).toBe(true);
	});
	it('a word that starts with a number’s spelling is not one', () => {
		expect(foldTitle('Chapter Oneness')).toBe('chapteroneness');
		expect(foldTitle('Chapter Tenacity')).toBe('chaptertenacity');
		expect(foldTitle('Chapter Sevens')).toBe('chaptersevens');
	});
	it('a separator after the number is not part of it', () => {
		expect(foldTitle('Chapter Twenty - One More Day')).toBe('onemoreday');
	});
});

describe('a title in a blockquote (c741)', () => {
	it('with nothing else to read, the blockquote is the book’s line', () => {
		const blocks = [quote('The Article'), p(LONG)];
		expect(leadLine(blocks)).toBe('The Article');
		expect(bandTitle('The Article', leadLines(blocks))).toBe(false);
		expect(bandTitle('Chapter 1: The Article', leadLines(blocks))).toBe(false);
	});
	it('still draws a title the blockquote is not: an epigraph', () => {
		const blocks = [quote('All happy families are alike.'), p(LONG)];
		expect(bandTitle('The Article', leadLines(blocks))).toBe(true);
	});
	it('a blockquote too long to be a title line is not read', () => {
		const long = 'x'.repeat(SHORT_LINE + 1);
		expect(leadLines([quote(long), p(LONG)])).toEqual([]);
		expect(bandTitle(long, leadLines([quote(long), p(LONG)]))).toBe(true);
	});
	it('does not take the place of a short paragraph or a heading', () => {
		expect(leadLine([quote('An epigraph'), p('The Article'), p(LONG)])).toBe('The Article');
		expect(leadLine([quote('An epigraph'), h('The Article'), p(LONG)])).toBe('The Article');
		expect(
			bandTitle('The Article', leadLines([quote('An epigraph'), p('The Article'), p(LONG)]))
		).toBe(false);
	});
	it('is read beside a first short line that is not the title', () => {
		const blocks = [quote('The Article'), p('"How large?" he asked.'), p(LONG)];
		expect(bandTitle('The Article', leadLines(blocks))).toBe(false);
		expect(bandTitle('Interlude', leadLines(blocks))).toBe(true);
	});
	it('is the line under a number as well', () => {
		expect(
			bandTitle('Chapter 1: The Article', leadLines([h('Chapter 1'), quote('The Article')]))
		).toBe(false);
	});
	it('leaves every other tag out, as ever', () => {
		expect(leadLines([{ tag: 'li', text: 'The Article' }, p(LONG)])).toEqual([]);
	});
});

describe('a bare leading number in the table of contents (c741)', () => {
	for (const toc of ['1. The Article', '1) The Article', '12.  The Article', '１． The Article'])
		it(`"${toc}" is the title without its number`, () => {
			expect(foldTitle(toc)).toBe('thearticle');
			expect(bandTitle(toc, 'The Article')).toBe(false);
			expect(bandTitle(toc, 'Chapter 1: The Article')).toBe(false);
		});
	it('still draws a numbered title the heading is not', () => {
		expect(bandTitle('2. The Party', 'The Article')).toBe(true);
		expect(bandTitle('1) The Article', 'Interlude')).toBe(true);
	});
	it('a number that is the title stays the title', () => {
		expect(foldTitle('1984')).toBe('1984');
		expect(foldTitle('1984 A Novel')).toBe('1984anovel');
		expect(foldTitle('2001: A Space Odyssey')).toBe('2001aspaceodyssey');
		expect(bandTitle('1984', 'The Party')).toBe(true);
		expect(bandTitle('1984', '1984')).toBe(false);
	});
	it('takes the number only where something follows it, and only a dot or a bracket', () => {
		expect(foldTitle('2.')).toBe('2');
		expect(foldTitle('3.14 Pi')).toBe('314pi');
		expect(foldTitle('4: Home')).toBe('4home');
		expect(foldTitle('5 Home')).toBe('5home');
	});
	it('takes only the one leading number', () => {
		expect(foldTitle('1. 2. Home')).toBe('2home');
	});
	it('a number before a chapter prefix leaves the prefix to be read', () => {
		expect(foldTitle('1. Chapter 2: Home')).toBe('home');
	});
});

describe('kanji numerals against Arabic ones (c741)', () => {
	const DIGIT = '一二三四五六七八九'.split('');
	/** 1 to 199 in kanji, written here rather than asked of the code it checks. */
	const kanji = (n: number): string => {
		let s = '';
		if (n >= 100) {
			s += '百';
			n -= 100;
		}
		if (n >= 10) {
			const tens = Math.floor(n / 10);
			s += tens > 1 ? `${DIGIT[tens - 1]}十` : '十';
			n %= 10;
		}
		return n ? s + DIGIT[n - 1] : s;
	};

	it('the card’s case: 第一章 is 第1章', () => {
		expect(bandTitle('第1章', '第一章')).toBe(false);
		expect(bandTitle('第一章', '第1章')).toBe(false);
	});
	it('still draws a different number', () => {
		expect(bandTitle('第2章', '第一章')).toBe(true);
		expect(bandTitle('第十章', '第1章')).toBe(true);
		expect(bandTitle('第二十一章', '第12章')).toBe(true);
	});
	it('every number from 1 to 199 in kanji is that number, in each counter', () => {
		for (let n = 1; n <= 199; n++) {
			const k = kanji(n);
			for (const counter of '話话章回節节') {
				expect(foldTitle(`第${k}${counter}`), k).toBe(String(n));
				expect(bandTitle(`第${n}${counter}`, `第${k}${counter}`), k).toBe(false);
			}
		}
	});
	it('reads the forms a chapter number is written in', () => {
		const FORMS: [string, string][] = [
			['十', '10'],
			['十一', '11'],
			['二十', '20'],
			['二十一', '21'],
			['九十九', '99'],
			['百', '100'],
			['百一', '101'],
			['百十', '110'],
			['百二十', '120'],
			['二百', '200'],
			['三百五', '305'],
			['千', '1000'],
			['千一', '1001'],
			['千二百三十四', '1234'],
			['一千', '1000'],
			['三千', '3000'],
			['九千九百九十九', '9999'],
			// A digit at a time, as a year is written: no 十 to say which place.
			['一二', '12'],
			['二〇二', '202'],
			['二零二', '202'],
			['百〇五', '105'],
			['〇', '0'],
			['零', '0'],
			['〇一', '1']
		];
		for (const [k, n] of FORMS) expect(foldTitle(`第${k}章`), k).toBe(n);
	});
	it('leaves an Arabic number as it was written', () => {
		expect(foldTitle('第212話')).toBe('212');
		expect(foldTitle('第２１２話')).toBe('212');
		expect(foldTitle('第012話')).toBe('012');
	});
	it('a title that merely contains kanji numerals keeps its text', () => {
		expect(foldTitle('二十四の瞳')).toBe('二十四の瞳');
		expect(foldTitle('一期一会')).toBe('一期一会');
		expect(bandTitle('二十四の瞳', '第24章')).toBe(true);
		expect(bandTitle('二十四の瞳', '二十四')).toBe(true);
		expect(bandTitle('一期一会', '一')).toBe(true);
	});
	describe('a line that is only a kanji numeral is that number (round 2)', () => {
		it('against a prefixed form, both ways', () => {
			expect(bandTitle('第一章', '一')).toBe(false);
			expect(bandTitle('一', '第一章')).toBe(false);
			expect(bandTitle('第十二章', '十二')).toBe(false);
			expect(bandTitle('第二十一話', '二十一')).toBe(false);
			expect(bandTitle('第1章', '一')).toBe(false);
			expect(bandTitle('Chapter 1', '一')).toBe(false);
			expect(bandTitle('Chapter One', '一')).toBe(false);
		});
		it('against a bare figure, full-width included', () => {
			expect(bandTitle('一', '1')).toBe(false);
			expect(bandTitle('1', '一')).toBe(false);
			expect(bandTitle('第一章', '1')).toBe(false);
			expect(bandTitle('十二', '１２')).toBe(false);
		});
		it('with punctuation or spaces around it', () => {
			expect(bandTitle('第一章', '一。')).toBe(false);
			expect(bandTitle('第十二章', ' 十二 ')).toBe(false);
		});
		it('still draws another number', () => {
			expect(bandTitle('第2章', '一')).toBe(true);
			expect(bandTitle('一', '第2章')).toBe(true);
			expect(bandTitle('二', '一')).toBe(true);
			expect(bandTitle('2', '一')).toBe(true);
			expect(bandTitle('第十二章', '二十一')).toBe(true);
		});
		it('every number from 1 to 199, bare against 第n章, both ways', () => {
			for (let n = 1; n <= 199; n++) {
				const k = kanji(n);
				expect(foldTitle(k), k).toBe(String(n));
				expect(bandTitle(`第${n}章`, k), k).toBe(false);
				expect(bandTitle(k, `第${n}章`), k).toBe(false);
				expect(bandTitle(`第${n + 1}章`, k), k).toBe(true);
			}
		});
		it('a numeral after a prefix is the same figures as one on its own', () => {
			expect(foldTitle('第一章 二')).toBe('2');
			expect(foldTitle('1. 二')).toBe('2');
		});
		it('holds on its own output', () => {
			const LOTS = '一'.repeat(25);
			for (const s of [
				'一',
				'十二',
				'〇',
				'第一章',
				'千',
				'第一章 二',
				'1. 二',
				LOTS,
				`第${LOTS}章`
			])
				expect(foldTitle(foldTitle(s)), s).toBe(foldTitle(s));
		});
		it('a numeral too long to be a safe number stays as written', () => {
			const LOTS = '一'.repeat(25);
			expect(foldTitle(LOTS)).toBe(LOTS);
			expect(bandTitle(LOTS, LOTS)).toBe(false);
		});
	});
	describe('a bare numeral is number-only, so the lines beside it are read (round 2)', () => {
		it('the line after it', () => {
			const lines = leadLines([h('一'), h('旅立ち', 'h2'), p(LONG)]);
			expect(lines).toEqual(['一', '旅立ち', '一 旅立ち']);
			expect(bandTitle('第一章 旅立ち', lines)).toBe(false);
			expect(bandTitle('第一章 帰郷', lines)).toBe(true);
		});
		it('the short line before it', () => {
			const lines = leadLines([p('旅立ち'), h('一'), p(LONG)]);
			expect(lines).toEqual(['一', '旅立ち', '一 旅立ち']);
			expect(bandTitle('第一章: 旅立ち', lines)).toBe(false);
			expect(bandTitle('第一章: 帰郷', lines)).toBe(true);
		});
		it('a table of contents writing it the same way', () => {
			const lines = leadLines([h('一'), h('旅立ち', 'h2'), p(LONG)]);
			expect(bandTitle('一 旅立ち', lines)).toBe(false);
		});
		it('alone, through leadLines, it is the number', () => {
			const lines = leadLines([h('一'), p(LONG)]);
			expect(lines).toEqual(['一']);
			expect(bandTitle('第一章', lines)).toBe(false);
			expect(bandTitle('第2章', lines)).toBe(true);
		});
		it('a title holding kanji numerals is not number-only', () => {
			expect(leadLines([h('二十四の瞳'), h('旅立ち', 'h2'), p(LONG)])).toEqual(['二十四の瞳']);
		});
	});
	it('with a title after the number', () => {
		expect(bandTitle('第1章 旅立ち', '第一章　旅立ち')).toBe(false);
		expect(bandTitle('第1章 旅立ち', '第一章　帰郷')).toBe(true);
	});
});

describe('the fold holds on its own output, over c741’s shapes', () => {
	const ALL = [
		'Chapter One',
		'chapter twenty-one: x',
		'Chapter One Hundred and Five',
		'Chapter One Chapter Two',
		'Chapter Oneness',
		'chapter-one',
		'One Piece',
		'Seven Seas',
		'1. The Article',
		'1) The Article',
		'1. 2. Home',
		'1) 2',
		'1. Chapter 2',
		'1984',
		'2.',
		'3.14 Pi',
		'第一章',
		'第1章',
		'第百二十話 x',
		'第千章',
		'第〇章',
		'第一章第二章',
		'二十四の瞳',
		'一'
	];
	it('every one', () => {
		for (const s of ALL) expect(foldTitle(foldTitle(s)), s).toBe(foldTitle(s));
	});
});
