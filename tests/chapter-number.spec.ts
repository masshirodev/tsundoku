import { describe, expect, it } from 'vitest';
import {
	chapterNumbers,
	chapterNumberOf,
	toNumber,
	type ChapterNumbering
} from '$lib/import/chapter-number';

// Mihon's own ChapterRecognitionTest (mihonapp/mihon, Apache-2.0), case for
// case, so the port numbers chapters as Mihon does. Names are listed from the
// most to the least recent, as a source gives them.
const n = (volume: string | null, chapter: string | null): ChapterNumbering => ({
	volume,
	chapter
});

function assertNumbers(...args: (string | [string, ChapterNumbering])[]) {
	const [title, expected] =
		typeof args[0] === 'string'
			? [args[0], args.slice(1) as [string, ChapterNumbering][]]
			: ['', args as [string, ChapterNumbering][]];
	const chapters = expected.map(([name]) => ({ name, number: -1 }));
	expect(chapterNumbers(title, chapters)).toEqual(expected.map(([, numbering]) => numbering));
}

describe('chapter recognition (Mihon)', () => {
	it('Basic Ch prefix', () => {
		assertNumbers('Mokushiroku Alice', [
			'Mokushiroku Alice Vol.1 Ch.4: Misrepresentation',
			n('1', '4')
		]);
	});

	it('Basic Ch prefix with space after period', () => {
		assertNumbers('Mokushiroku Alice', [
			'Mokushiroku Alice Vol. 1 Ch. 4: Misrepresentation',
			n('1', '4')
		]);
	});

	it('Basic Ch prefix with decimal', () => {
		assertNumbers('Mokushiroku Alice', [
			'Mokushiroku Alice Vol.1 Ch.4.1: Misrepresentation',
			n('1', '4.1')
		]);
		assertNumbers('Mokushiroku Alice', [
			'Mokushiroku Alice Vol.1 Ch.4.4: Misrepresentation',
			n('1', '4.4')
		]);
	});

	it('Basic Ch prefix with alpha postfix', () => {
		assertNumbers('Mokushiroku Alice', [
			'Mokushiroku Alice Vol.1 Ch.4.a: Misrepresentation',
			n('1', '4a')
		]);
		assertNumbers('Mokushiroku Alice', [
			'Mokushiroku Alice Vol.1 Ch.4.b: Misrepresentation',
			n('1', '4b')
		]);
		assertNumbers('Mokushiroku Alice', [
			'Mokushiroku Alice Vol.1 Ch.4.extra: Misrepresentation',
			n('1', '4.99')
		]);
	});

	it('Name containing one number', () => {
		assertNumbers('Bleach', ['Bleach 567 Down With Snowwhite', n(null, '567')]);
	});

	it('Name containing one number and decimal', () => {
		assertNumbers('Bleach', ['Bleach 567.1 Down With Snowwhite', n(null, '567.1')]);
		assertNumbers('Bleach', ['Bleach 567.4 Down With Snowwhite', n(null, '567.4')]);
	});

	it('Name containing one number and alpha', () => {
		assertNumbers('Bleach', ['Bleach 567.a Down With Snowwhite', n(null, '567a')]);
		assertNumbers('Bleach', ['Bleach 567.b Down With Snowwhite', n(null, '567b')]);
		assertNumbers('Bleach', ['Bleach 567.extra Down With Snowwhite', n(null, '567.99')]);
	});

	it('Chapter containing manga title and number', () => {
		assertNumbers('Solanin', ['Solanin 028 Vol. 2', n('2', '28')]);
	});

	it('Chapter containing manga title and number decimal', () => {
		assertNumbers('Solanin', ['Solanin 028.1 Vol. 2', n('2', '28.1')]);
		assertNumbers('Solanin', ['Solanin 028.4 Vol. 2', n('2', '28.4')]);
	});

	it('Chapter containing manga title and number alpha', () => {
		assertNumbers('Solanin', ['Solanin 028.a Vol. 2', n('2', '28a')]);
		assertNumbers('Solanin', ['Solanin 028.b Vol. 2', n('2', '28b')]);
		assertNumbers('Solanin', ['Solanin 028.extra Vol. 2', n('2', '28.99')]);
	});

	it('Extreme case', () => {
		assertNumbers('Onepunch-Man', ['Onepunch-Man Punch Ver002 028', n(null, '28')]);
	});

	it('Extreme case with decimal', () => {
		assertNumbers('Onepunch-Man', ['Onepunch-Man Punch Ver002 028.1', n(null, '28.1')]);
		assertNumbers('Onepunch-Man', ['Onepunch-Man Punch Ver002 028.4', n(null, '28.4')]);
	});

	it('Extreme case with alpha', () => {
		assertNumbers('Onepunch-Man', ['Onepunch-Man Punch Ver002 028.a', n(null, '28a')]);
		assertNumbers('Onepunch-Man', ['Onepunch-Man Punch Ver002 028.b', n(null, '28b')]);
		assertNumbers('Onepunch-Man', ['Onepunch-Man Punch Ver002 028.extra', n(null, '28.99')]);
	});

	it('Chapter containing dot v2', () => {
		assertNumbers('random', ['Vol.1 Ch.5v.2: Alones', n('1', '5')]);
	});

	it('Number in manga title', () => {
		assertNumbers('Ayame 14', ['Ayame 14 1 - The summer of 14', n(null, '1')]);
	});

	it('Space between ch x', () => {
		assertNumbers('Mokushiroku Alice', [
			'Mokushiroku Alice Vol.1 Ch. 4: Misrepresentation',
			n('1', '4')
		]);
	});

	it('Chapter title with ch substring', () => {
		assertNumbers('Ayame 14', ['Vol.1 Ch.1: March 25 (First Day Cohabiting)', n('1', '1')]);
	});

	it('Chapter containing multiple zeros', () => {
		assertNumbers('random', ["Vol.001 Ch.003: Kaguya Doesn't Know Much", n('1', '3')]);
	});

	it('Chapter with version before number', () => {
		assertNumbers('Onepunch-Man', [
			'Onepunch-Man Punch Ver002 086 : Creeping Darkness [3]',
			n(null, '86')
		]);
	});

	it('Version attached to chapter number', () => {
		assertNumbers('Ansatsu Kyoushitsu', [
			'Ansatsu Kyoushitsu 011v002: Assembly Time',
			n(null, '11')
		]);
	});

	// Case where the chapter title contains the chapter But wait it's not actual the chapter number.
	it('Number after manga title with chapter in chapter title case', () => {
		assertNumbers('Tokyo ESP', ['Tokyo ESP 027: Part 002: Chapter 001', n(null, '27b')]);
	});

	// Case where the chapter title contains the unwanted tag But follow by chapter number.
	it('Number after unwanted tag', () => {
		assertNumbers('One-punch Man', ['Mag Version 195.5', n(null, '195.5')]);
	});

	it('Unparseable chapter', () => {
		assertNumbers('random', ['Foo', n(null, null)]);
	});

	it('Chapter with time in title', () => {
		assertNumbers('random', ['Fairy Tail 404: 00:00', n(null, '404')]);
	});

	it('Chapter with alpha without dot', () => {
		assertNumbers('random', ['Asu No Yoichi 19a', n(null, '19a')]);
	});

	it('Chapter title containing extra and vol', () => {
		assertNumbers('Fairy Tail', ['Fairy Tail 404.extravol002', n(null, '404.99')]);
		assertNumbers('Fairy Tail', ['Fairy Tail 404 extravol002', n(null, '404.99')]);
	});

	it('Chapter title containing omake (japanese extra) and vol', () => {
		assertNumbers('Fairy Tail', ['Fairy Tail 404.omakevol002', n(null, '404.98')]);
		assertNumbers('Fairy Tail', ['Fairy Tail 404 omakevol002', n(null, '404.98')]);
	});

	it('Chapter title containing special and vol', () => {
		assertNumbers('Fairy Tail', ['Fairy Tail 404.specialvol002', n(null, '404.97')]);
		assertNumbers('Fairy Tail', ['Fairy Tail 404 specialvol002', n(null, '404.97')]);
	});

	it('Chapter title containing commas', () => {
		assertNumbers('One Piece', ['One Piece 300,a', n(null, '300a')]);
		assertNumbers('One Piece', ['One Piece Ch,123,extra', n(null, '123.99')]);
		assertNumbers('One Piece', ['One Piece the sunny, goes swimming 024,005', n(null, '24.005')]);
	});

	it('Chapter title containing hyphens', () => {
		assertNumbers('Solo Leveling', ['ch 122-a', n(null, '122a')]);
		assertNumbers('Solo Leveling', ['Solo Leveling Ch.123-extra', n(null, '123.99')]);
		assertNumbers('Solo Leveling', ['Solo Leveling, 024-005', n(null, '24.005')]);
		assertNumbers('Solo Leveling', ['Ch.191-200 Read Online', n(null, '191.2')]);
	});

	it('Chapters containing season', () => {
		assertNumbers('D.I.C.E', ['D.I.C.E[Season 001] Ep. 007', n('1', '7')]);
	});

	it('Chapters in format sx - chapter xx', () => {
		assertNumbers('The Gamer', ['S3 - Chapter 20', n('3', '20')]);
	});

	it('Chapters ending with s', () => {
		assertNumbers('One Outs', ['One Outs 001', n(null, '1')]);
	});

	it('Chapters containing ordinals', () => {
		const mangaTitle = 'The Sister of the Woods with a Thousand Young';

		assertNumbers(mangaTitle, ['The 1st Night', n(null, '1')]);
		assertNumbers(mangaTitle, ['The 2nd Night', n(null, '2')]);
		assertNumbers(mangaTitle, ['The 3rd Night', n(null, '3')]);
		assertNumbers(mangaTitle, ['The 4th Night', n(null, '4')]);
	});

	it('Parts are letters', () => {
		assertNumbers(['Chapter 1.5 Part I', n(null, '1.5a')]);
		assertNumbers(['Chapter 1.5 Part II', n(null, '1.5b')]);
		assertNumbers(['Chapter 12 Part 3', n(null, '12c')]);
		assertNumbers(['Vol.2 Chapter 7 - Part IV', n('2', '7d')]);
		assertNumbers(['Part 3', n(null, '3')]);
	});

	it('Numbers are turned into doubles', () => {
		expect(toNumber('12')).toBe(12.0);
		expect(toNumber('10.5')).toBe(10.5);
		expect(toNumber('19a')).toBe(19.1);
		expect(toNumber('19i')).toBe(19.9);
		expect(toNumber('1.5a')).toBe(1.5);
		expect(toNumber('-2')).toBe(-2.0);
	});

	it('Volume is not taken as the chapter number', () => {
		assertNumbers('Mokushiroku Alice', ['Mokushiroku Alice Vol.3', n('3', null)]);
		assertNumbers('Mokushiroku Alice', ['Vol.3 12', n('3', '12')]);
	});

	it('Seasons are volumes', () => {
		assertNumbers(['Vol-3 Chapter 2', n('3', '2')]);
		assertNumbers(["Mob's 100", n(null, '100')]);
	});

	it('Volumes are only taken from the name', () => {
		assertNumbers(['Vol.2 Ch.5', n('2', '5')], ['Ch.4', n(null, '4')], ['Vol.2 Ch.3', n('2', '3')]);
	});

	it('Numbers every similar name shares are ignored', () => {
		assertNumbers(
			['Group 2 Chapter 387', n(null, '387')],
			['Group 2 Chapter 386', n(null, '386')],
			['Group 2 Chapter 385', n(null, '385')]
		);
	});

	it('Shared numbers after a chapter prefix are kept', () => {
		assertNumbers(
			['Chapter 5 Part 3', n(null, '5c')],
			['Chapter 5 Part 2', n(null, '5b')],
			['Chapter 5 Part 1', n(null, '5a')]
		);
	});

	it('Chapters without a number fill the missing whole numbers', () => {
		assertNumbers(
			['Chapter 4', n(null, '4')],
			['The Return', n(null, '3')],
			['Chapter 2', n(null, '2')]
		);
		assertNumbers(
			['Chapter 5', n(null, '5')],
			['Rain', n(null, '4')],
			['Snow', n(null, '3')],
			['Chapter 2', n(null, '2')]
		);
	});

	it('Chapters without a number go between the chapters around them', () => {
		assertNumbers(
			['Chapter 11', n(null, '11')],
			['Bonus: Beach Episode', n(null, '10.5')],
			['Chapter 10', n(null, '10')]
		);
		assertNumbers(
			['Chapter 13', n(null, '13')],
			['Intermission', n(null, '10.5')],
			['Chapter 10', n(null, '10')]
		);
		assertNumbers(
			['Chapter 11', n(null, '11')],
			['Rain', n(null, '10.6')],
			['Snow', n(null, '10.5')],
			['Chapter 10', n(null, '10')]
		);
		assertNumbers(
			['Chapter 4', n(null, '4')],
			['Side Story', n(null, '2.5')],
			['Chapter 2', n(null, '2')]
		);
		assertNumbers(
			['Chapter 3', n(null, '3')],
			['Extra', n(null, '2.6')],
			['Chapter 2.5', n(null, '2.5')]
		);
		assertNumbers(
			['Chapter 3', n(null, '3')],
			['Extra', n(null, '2.95')],
			['Chapter 2.9', n(null, '2.9')]
		);
	});

	it('Chapters without a number at the ends', () => {
		assertNumbers(['Afterword', n(null, '100.5')], ['Chapter 100', n(null, '100')]);
		assertNumbers(['Hiatus Announcement', n(null, null)], ['Chapter 100', n(null, '100')]);
		assertNumbers(['Chapter 1', n(null, '1')], ['Prologue', n(null, '0')]);
		assertNumbers(['Chapter 1', n(null, '1')], ['Character Profiles', n(null, null)]);
	});

	it('A prologue before chapters in volumes is in volume 0', () => {
		assertNumbers(['Vol.1 Ch.1', n('1', '1')], ['Prologue', n('0', '0')]);
		assertNumbers(['Vol.1 Ch.1', n('1', '1')], ['Vol.2 Prologue', n('2', '0')]);
	});

	it('Chapters without a number are only numbered within a volume', () => {
		assertNumbers(['Vol.1 Ch.3', n('1', '3')], ['Rain', n(null, '2')], ['Vol.1 Ch.1', n('1', '1')]);
		assertNumbers(
			['Vol.2 Ch.3', n('2', '3')],
			['Rain', n(null, null)],
			['Vol.1 Ch.1', n('1', '1')]
		);
		assertNumbers(
			['Vol.2 Ch.3', n('2', '3')],
			['Vol.2 Rain', n('2', null)],
			['Ch.1', n(null, '1')]
		);
		assertNumbers(
			['Vol.2 Ch.3', n('2', '3')],
			['Vol.1 Rain', n('1', null)],
			['Vol.2 Ch.1', n('2', '1')]
		);
		assertNumbers(['Extra', n(null, '10.5')], ['Vol.2 Ch.10', n('2', '10')]);
		assertNumbers(['Vol.2 Extra', n('2', '10.5')], ['Vol.2 Ch.10', n('2', '10')]);
		assertNumbers(['Vol.3 Extra', n('3', null)], ['Vol.2 Ch.10', n('2', '10')]);
	});

	it('Numbers from the source are kept', () => {
		expect(
			chapterNumbers('', [
				{ name: 'Vol.1 Chapter 3', number: 7 },
				{ name: 'Chapter 2', number: -1 }
			])
		).toEqual([n('1', '7'), n(null, '2')]);
	});
});

describe('one chapter on its own', () => {
	it('keeps the source number, reads the name otherwise, and says -1 when there is none', () => {
		expect(chapterNumberOf('', 'Chapter 12', 5)).toBe(5);
		expect(chapterNumberOf('', 'Chapter 12', -2)).toBe(-2);
		expect(chapterNumberOf('Bleach', 'Bleach 567.a Down With Snowwhite')).toBe(567.1);
		expect(chapterNumberOf('', 'Foo')).toBe(-1);
		expect(chapterNumberOf('', 'Foo', -1)).toBe(-1);
	});
});
