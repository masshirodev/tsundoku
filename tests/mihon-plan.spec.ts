import { describe, expect, it } from 'vitest';
import { readMessage, Message } from '$lib/import/protobuf';
import { decodeBackup } from '$lib/import/mihon-backup';
import { parseComicInfo } from '$lib/import/comicinfo';
import {
	categoryEffect,
	chapterTitle,
	directionOf,
	kindOf,
	matchChapters,
	mihonFolderName,
	people,
	planMihon,
	statusOf,
	type DownloadedChapter,
	type DownloadedSeries
} from '$lib/import/mihon-plan';
import { encode } from './helpers/protobuf-writer';
import { ASURA, WEEB, backup, comicInfo } from './helpers/mihon-fixture';

describe('protobuf', () => {
	it('reads varints, 64-bit ids, floats, strings and nested messages', () => {
		const m = new Message(
			encode([
				[1, ASURA],
				[2, 'héllo'],
				[3, { f32: 10.5 }],
				[4, [[1, 7]]],
				[5, true]
			])
		);
		expect(m.big(1)).toBe(ASURA);
		expect(m.str(2)).toBe('héllo');
		expect(m.float(3)).toBe(10.5);
		expect(m.messages(4)[0].num(1)).toBe(7);
		expect(m.bool(5)).toBe(true);
		expect(m.bool(6, true)).toBe(true);
	});

	it('reads a chapter number as it was meant, not as float32 stored it', () => {
		const m = new Message(
			encode([
				[9, { f32: 2.1 }],
				[10, { f32: 152.4 }],
				[11, { f32: 2.2 }]
			])
		);
		expect(m.float(9)).toBe(2.1);
		expect(m.float(10)).toBe(152.4);
		expect(m.float(11)).toBe(2.2);
	});

	it('refuses a truncated message rather than reading past it', () => {
		const good = encode([[2, 'abcdef']]);
		expect(() => readMessage(good.subarray(0, good.length - 2))).toThrow(/truncated/);
	});
});

describe('the Mihon backup', () => {
	const b = decodeBackup(backup());

	it('decodes manga, categories and sources', () => {
		expect(b.manga.map((m) => m.title)).toContain('Academy’s Undercover Professor');
		expect(b.sources.get(WEEB.toString())).toBe('Weeb Central');
		expect(b.categories.map((c) => [c.name, c.order]).slice(0, 2)).toEqual([
			['Amazing', 0],
			['Good', 1]
		]);
		const drawing = b.manga[0];
		expect(drawing.chapters[0]).toMatchObject({ url: '/chapters/AAA1', number: 1, read: true });
		expect(drawing.history[1]).toEqual({
			url: '/chapters/AAA2',
			lastRead: 1_750_000_100_000,
			readDuration: 120_000
		});
		expect(drawing.categories).toEqual([1]);
	});

	it('reads an absent favourite as in the library, and a chapter without a number as -1', () => {
		expect(b.manga[0].favorite).toBe(true);
		expect(b.manga.find((m) => m.title === 'Only Browsed')!.favorite).toBe(false);
		const extra = b.manga[1].chapters.find((c) => c.name === 'Side story')!;
		expect(extra.number).toBe(-1);
	});
});

describe('ComicInfo', () => {
	it('reads Mihon’s fields, namespaced ones included, and `_` as empty', () => {
		const info = parseComicInfo(
			comicInfo({
				title: 'Chapter 98 &amp; more',
				series: 'S',
				number: 98,
				web: 'https://a/ch/98',
				source: 'Asura Scans'
			})
		);
		expect(info).toMatchObject({
			title: 'Chapter 98 & more',
			number: 98,
			writer: '',
			source: 'Asura Scans'
		});
		expect(info.web).toEqual(['https://myanimelist.net/manga/1', 'https://a/ch/98']);
		expect(info.genres).toEqual(['Action', 'Manga']);
	});
});

describe('the rules', () => {
	it('reads the owner’s categories as ratings, shelves and hiding', () => {
		expect(categoryEffect('Amazing')).toEqual({ rating: 10, shelf: null, adult: false });
		expect(categoryEffect('Good+')).toEqual({ rating: 8, shelf: null, adult: true });
		expect(categoryEffect('Okay')).toMatchObject({ rating: 6 });
		expect(categoryEffect('To Read+')).toEqual({ rating: 0, shelf: 'To Read', adult: true });
		expect(categoryEffect('Dropped')).toMatchObject({ rating: 0, shelf: 'Dropped' });
		expect(categoryEffect('Isekai pile')).toMatchObject({ rating: 0, shelf: 'Isekai pile' });
	});

	it('works out the kind from genres, the reader, then webtoon-only sources', () => {
		expect(kindOf(['Action', 'Manhwa'], 0)).toBe('manhwa');
		expect(kindOf(['Manhua'], 0)).toBe('manhwa');
		expect(kindOf(['Manga'], 4)).toBe('manga');
		expect(kindOf([], 4)).toBe('manhwa');
		expect(kindOf([], 0, 'Toonily')).toBe('manhwa');
		expect(kindOf([], 0, 'Mangahere')).toBe('manga');
	});

	it('keeps a direction only when it differs from the kind’s default', () => {
		expect(directionOf(4, 'manhwa')).toBeNull();
		expect(directionOf(2, 'manga')).toBeNull();
		expect(directionOf(1, 'manga')).toBe('ltr');
		expect(directionOf(4, 'manga')).toBe('vertical');
		expect(directionOf(0, 'manga')).toBeNull();
	});

	it('names statuses, people and chapter titles the way the screens want', () => {
		expect([1, 2, 4, 5, 6, 0].map(statusOf)).toEqual([
			'ongoing',
			'completed',
			'completed',
			'cancelled',
			'hiatus',
			''
		]);
		expect(statusOf('Ongoing')).toBe('ongoing');
		expect(people('BK_Moon/ Lee hyunmin, _')).toEqual(['BK_Moon', 'Lee hyunmin']);
		expect(chapterTitle('Chapter 98 - Lindenborough')).toBe('Lindenborough');
		expect(chapterTitle('Chapter 156')).toBe('');
		expect(chapterTitle('Ch.098')).toBe('');
		expect(chapterTitle('Side story')).toBe('Side story');
	});

	it('builds folder names the way Mihon does', () => {
		expect(mihonFolderName('Drawing: Saikyou Mangaka')).toBe('Drawing_ Saikyou Mangaka');
		expect(mihonFolderName(' What?! ')).toBe('What_!');
		expect(mihonFolderName('...')).toBe('(invalid)');
	});
});

const file = (
	name: string,
	info: Partial<ReturnType<typeof parseComicInfo>> | null
): DownloadedChapter => ({
	file: name,
	bytes: 10,
	pages: 3,
	info: info ? { ...parseComicInfo(''), ...info } : null
});

describe('matching files to chapters', () => {
	const chapters = decodeBackup(backup()).manga[1].chapters;

	it('falls back from the URL to the number, which is all Asura leaves', () => {
		const f = file('Chapter 98.cbz', {
			number: 98,
			web: ['https://asuracomic.net/series/academys-undercover-professor-87c66c42/chapter/98']
		});
		expect(matchChapters(chapters, [f]).get(f)?.name).toBe('Chapter 98 - Lindenborough');
	});

	it('matches by name when there is no number, and leaves the unknown unmatched', () => {
		const side = file('side.cbz', { title: 'Side story' });
		const other = file('x.cbz', { number: 500 });
		const m = matchChapters(chapters, [side, other]);
		expect(m.get(side)?.url).toBe('/series/academys-undercover-professor/extra');
		expect(m.get(other)).toBeNull();
	});
});

describe('the plan', () => {
	const downloads: DownloadedSeries[] = [
		{
			sourceDir: 'Weeb Central (EN)',
			dir: 'Drawing_ Saikyou Mangaka',
			path: '/lib/Mihon/downloads/Weeb Central (EN)/Drawing_ Saikyou Mangaka',
			chapters: [
				file('c2.cbz', {
					number: 2,
					web: ['https://weebcentral.com/chapters/AAA2'],
					series: 'Drawing: Saikyou Mangaka'
				})
			]
		},
		{
			sourceDir: 'Asura Scans (EN)',
			dir: 'Not In The Backup',
			path: '/lib/x',
			chapters: [
				file('Chapter 1.cbz', { number: 1, series: 'Not In The Backup', source: 'Asura Scans' })
			]
		}
	];
	const plan = planMihon(decodeBackup(backup()), downloads, 1_800_000_000_000);
	const byTitle = (t: string) => plan.series.find((s) => s.title === t)!;

	it('imports the library, not what was only browsed', () => {
		expect(plan.skipped).toBe(1);
		expect(plan.series.map((s) => s.title)).not.toContain('Only Browsed');
	});

	it('rates, shelves and hides by category, and keeps the category as a tag', () => {
		expect(byTitle('Drawing: Saikyou Mangaka')).toMatchObject({
			rating: 8,
			hidden: false,
			shelves: []
		});
		expect(byTitle('Academy’s Undercover Professor')).toMatchObject({ rating: 10, kind: 'manhwa' });
		expect(byTitle('Bunk Beds')).toMatchObject({ rating: 8, hidden: true });
		expect(byTitle('Myst, Might, Mayhem')).toMatchObject({ rating: 0, shelves: ['To Read'] });
		expect(byTitle('Bunk Beds').tags).toContainEqual({ namespace: 'mihon', value: 'Good+' });
	});

	it('tags genres, people and the source, but not the kind', () => {
		const tags = byTitle('Drawing: Saikyou Mangaka').tags;
		expect(tags).toContainEqual({ namespace: 'genre', value: 'action' });
		expect(tags).not.toContainEqual({ namespace: 'genre', value: 'manga' });
		expect(tags).toContainEqual({ namespace: 'author', value: 'LIM Dall-Young' });
		expect(tags).toContainEqual({ namespace: 'source', value: 'Weeb Central' });
	});

	it('attaches downloads, keeps the rest as not downloaded, and carries read state', () => {
		const e = byTitle('Drawing: Saikyou Mangaka').entries;
		expect(e.map((x) => [x.label, x.available])).toEqual([
			['Ch. 1', false],
			['Ch. 2', true],
			['Ch. 3', false]
		]);
		expect(e[0].readAt).toBe(1_750_000_000_000);
		expect(e[1]).toMatchObject({
			readAt: null,
			lastPosition: 4,
			lastOpenedAt: 1_750_000_100_000,
			file: 'c2.cbz'
		});
		expect(e[1].history).toEqual({
			at: 1_750_000_100_000,
			finished: false,
			page: 4,
			durationMs: 120_000
		});
	});

	it('keeps who translated each chapter, from the backup', () => {
		const e = byTitle('Drawing: Saikyou Mangaka').entries;
		expect(e.map((x) => x.scanlator)).toEqual(['', '', 'Night Owl Scans']);
	});

	it('slots a chapter without a number in by the source’s order', () => {
		const e = byTitle('Academy’s Undercover Professor').entries;
		const order = [...e].sort((a, b) => a.position - b.position).map((x) => x.label);
		expect(order).toEqual(['Side story', 'Ch. 98', 'Ch. 99']);
	});

	it('builds a series from ComicInfo for a download the backup doesn’t know', () => {
		expect(byTitle('Not In The Backup')).toMatchObject({
			originKey: 'mihon-dir:Asura Scans (EN)/Not In The Backup',
			kind: 'manhwa',
			entries: [{ label: 'Ch. 1', available: true }]
		});
	});
});
