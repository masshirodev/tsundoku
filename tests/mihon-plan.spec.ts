import { describe, expect, it } from 'vitest';
import { readMessage, Message } from '$lib/import/protobuf';
import {
	decodeBackup,
	type MihonBackup,
	type MihonChapter,
	type MihonManga
} from '$lib/import/mihon-backup';
import { parseComicInfo } from '$lib/import/comicinfo';
import {
	categoryEffect,
	chapterTitle,
	directionOf,
	folderTitleMatches,
	isGallerySource,
	kindOf,
	matchChapters,
	mihonFolderName,
	people,
	planMihon,
	sourceDirMatches,
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
	it('reads the user’s categories as ratings, shelves and hiding', () => {
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

	it('makes a gallery source’s series doujins, whatever their genres say', () => {
		expect(kindOf(['Manga', 'big breasts'], 0, 'NHentai')).toBe('doujin');
		expect(kindOf([], 4, ' HentaiFox ')).toBe('doujin');
		expect(kindOf([], 0, 'Elite Babes')).toBe('doujin');
		expect(isGallerySource('nHentai.com (unoriginal)')).toBe(true);
		// An album there is hundreds of chapters: not a gallery source.
		expect(kindOf([], 0, 'Luscious')).toBe('manga');
		expect(isGallerySource('HentaiRead')).toBe(false);
		expect(isGallerySource()).toBe(false);
	});

	it('keeps a direction only when it differs from the kind’s default', () => {
		expect(directionOf(4, 'manhwa')).toBeNull();
		expect(directionOf(2, 'manga')).toBeNull();
		expect(directionOf(1, 'manga')).toBe('ltr');
		expect(directionOf(4, 'manga')).toBe('vertical');
		expect(directionOf(0, 'manga')).toBeNull();
	});

	// The same strings, and the same answers, as tests/tag-search.spec.ts'
	// preview (`splitPeople`) and tests/{mihon,anime}-plan.spec.ts' importers.
	const PEOPLE: [string, string[]][] = [
		['Aoi Hanamura, Ren Kisaragi', ['Aoi Hanamura', 'Ren Kisaragi']],
		['A / B; C & D', ['A', 'B', 'C', 'D']],
		['Unknown, _, Aoi', ['Aoi']],
		['Tanaka, Jr.', ['Tanaka, Jr.']],
		['Tanaka, Jr., Sato', ['Tanaka, Jr.', 'Sato']],
		['John Smith, III, Jane Doe, sr', ['John Smith, III', 'Jane Doe, sr']],
		['Kim / Lee II', ['Kim', 'Lee II']],
		['Ito & Sr', ['Ito, Sr']],
		['Jr., Sato', ['Jr.', 'Sato']],
		['Oda, Eiichiro', ['Oda', 'Eiichiro']]
	];
	it('splits people as the preview does, a generational suffix kept with its name', () => {
		for (const [raw, want] of PEOPLE) {
			expect(people(raw), raw).toEqual(want);
			expect(people(people(raw).join(', ')), raw).toEqual(want);
		}
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

	it('reads a folder’s own two names against a source and a title', () => {
		expect(sourceDirMatches('Asura Scans (EN)', 'Asura Scans')).toBe(true);
		expect(sourceDirMatches('Asura Scans', 'Asura Scans')).toBe(true);
		expect(sourceDirMatches('Asura Scans (ES)', 'Asura Scans')).toBe(true);
		expect(sourceDirMatches('Asura Scans 2', 'Asura Scans')).toBe(false);
		expect(sourceDirMatches('Weeb Central (EN)', 'Asura Scans')).toBe(false);
		expect(folderTitleMatches('Drawing_ Saikyou Mangaka', 'Drawing: Saikyou Mangaka')).toBe(true);
		expect(folderTitleMatches('Drawing_ Saikyou Mangak', 'Drawing: Saikyou Mangaka')).toBe(false);
		// A title longer than FAT allows: the folder name is its first 240 characters.
		const long = 'x'.repeat(240) + 'the rest';
		expect(mihonFolderName(long)).toBe('x'.repeat(240));
		expect(folderTitleMatches('x'.repeat(240), long)).toBe(true);
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

	it('names the folder a download of the series sits in, whichever key it takes', () => {
		expect(byTitle('Drawing: Saikyou Mangaka').folder).toEqual({
			source: 'Weeb Central',
			title: 'Drawing: Saikyou Mangaka'
		});
		expect(byTitle('Not In The Backup').folder).toEqual({
			source: 'Asura Scans',
			title: 'Not In The Backup'
		});
	});
});

describe('gallery sources', () => {
	const NH = '7309872737163460316';
	const LUSCIOUS = '4625881812440927464';
	const chapter = (c: Partial<MihonChapter>): MihonChapter => ({
		url: '',
		name: 'Chapter',
		scanlator: '',
		read: false,
		bookmark: false,
		lastPageRead: 0,
		dateFetch: 1_750_000_000_000,
		dateUpload: 0,
		number: -1,
		sourceOrder: 0,
		...c
	});
	const manga = (m: Partial<MihonManga>): MihonManga => ({
		source: NH,
		url: '',
		title: '',
		artist: '',
		author: '',
		description: '',
		genres: [],
		status: 2,
		thumbnailUrl: '',
		dateAdded: 1_750_000_000_000,
		viewer: 0,
		chapters: [],
		categories: [],
		favorite: true,
		history: [],
		trackers: [],
		...m
	});
	const b: MihonBackup = {
		categories: [],
		sources: new Map([
			[NH, 'NHentai'],
			[LUSCIOUS, 'Luscious']
		]),
		manga: [
			manga({
				url: '/g/100/',
				title: 'Paper Lanterns',
				author: 'mori',
				artist: 'mori',
				genres: ['big breasts ♀', 'Manga'],
				chapters: [chapter({ url: '/g/100/', read: true })]
			}),
			manga({
				source: LUSCIOUS,
				url: '/albums/x/',
				title: 'An Album',
				chapters: [
					chapter({ url: '/p/2', name: '2 - b', number: 2 }),
					chapter({ url: '/p/1', name: '1 - a', number: 1, sourceOrder: 1 })
				]
			})
		]
	};
	const plan = planMihon(
		b,
		[
			{
				sourceDir: 'HentaiFox (ALL)',
				dir: 'Gallery Not In The Backup',
				path: '/lib/hf',
				chapters: [file('Chapter.cbz', { series: 'Gallery Not In The Backup' })]
			}
		],
		1_800_000_000_000
	);
	const byTitle = (t: string) => plan.series.find((s) => s.title === t)!;

	it('imports a gallery as one book, a ONE-OFF, as Hentoid’s are', () => {
		const g = byTitle('Paper Lanterns');
		expect(g).toMatchObject({ kind: 'doujin', originKey: `mihon:${NH}:/g/100/` });
		expect(g.entries).toHaveLength(1);
		expect(g.entries[0]).toMatchObject({
			label: 'Book',
			title: 'Paper Lanterns',
			position: 1,
			sourceUrl: '/g/100/',
			readAt: 1_750_000_000_000
		});
	});

	it('files a gallery’s genres as Hentoid’s tags, and keeps its people', () => {
		const tags = byTitle('Paper Lanterns').tags;
		expect(tags).toContainEqual({ namespace: 'tag', value: 'big breasts ♀' });
		expect(tags.some((t) => t.namespace === 'genre')).toBe(false);
		expect(tags).not.toContainEqual({ namespace: 'tag', value: 'manga' });
		expect(tags).toContainEqual({ namespace: 'artist', value: 'mori' });
	});

	it('makes a book of a gallery download the backup doesn’t know', () => {
		expect(byTitle('Gallery Not In The Backup')).toMatchObject({
			kind: 'doujin',
			entries: [{ label: 'Book', title: 'Gallery Not In The Backup', position: 1 }]
		});
	});

	it('leaves a source that isn’t one a series of chapters', () => {
		const album = byTitle('An Album');
		expect(album.kind).toBe('manga');
		expect(album.entries.map((e) => e.label).sort()).toEqual(['Ch. 1', 'Ch. 2']);
		expect(album.tags.some((t) => t.namespace === 'tag')).toBe(false);
	});
});
