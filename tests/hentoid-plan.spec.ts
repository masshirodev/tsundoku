import { describe, expect, it } from 'vitest';
import {
	parseChapterName,
	parseContent,
	planHentoidBook,
	tagsOf,
	titleFromFolder,
	type HentoidFolder
} from '$lib/import/hentoid-plan';
import { content } from './helpers/hentoid-fixture';

const files = (n: number) =>
	Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(4, '0')}.jpg`);
const folder = (
	json: object | null,
	list: string[],
	name = 'nhentai/x - Title - [1]'
): HentoidFolder => ({
	folder: name,
	files: list,
	bytes: 1000,
	content: json ? parseContent(json) : null
});
const ROOT = '/lib/H/.Hentoid';

describe('contentV2.json', () => {
	it('reads what is there and defaults what is not', () => {
		const b = parseContent({
			title: ' T ',
			rating: 3,
			attributes: { ARTIST: [{ name: 'a', type: 'ARTIST' }] }
		});
		expect(b).toMatchObject({ title: 'T', rating: 3, favourite: false, images: [], chapters: [] });
		expect(b.attributes).toEqual([{ type: 'ARTIST', name: 'a' }]);
		expect(parseContent(null).title).toBe('');
	});

	it('names tags by Hentoid attribute type, people as people', () => {
		const b = parseContent(
			content({
				title: 't',
				site: 'NHENTAI',
				url: '/g/1/',
				pages: [],
				artist: 'Aoi Rin',
				circle: 'Hakka'
			})
		);
		expect(tagsOf(b)).toEqual([
			{ namespace: 'language', value: 'english' },
			{ namespace: 'tag', value: 'oneshot' },
			{ namespace: 'artist', value: 'Aoi Rin' },
			{ namespace: 'circle', value: 'Hakka' },
			{ namespace: 'source', value: 'nhentai' }
		]);
	});
});

describe('folder and chapter names', () => {
	it('takes the title out of a folder name, empty artist or not', () => {
		expect(titleFromFolder('Hentai2Read/someone - Paper Lanterns - [1003]')).toBe(
			'Paper Lanterns'
		);
		expect(titleFromFolder('nhentai2/ - Morning Tide - [1002]')).toBe(
			'Morning Tide'
		);
		expect(titleFromFolder('x/Nobody - Truncated Title Wi[1005]')).toBe('Truncated Title Wi');
	});

	it('reads a chapter number from its name', () => {
		expect(parseChapterName('1.5 - Laid [Full Color]', 2)).toEqual({
			number: 1.5,
			title: 'Laid [Full Color]'
		});
		expect(parseChapterName('Afterstory', 4)).toEqual({ number: 4, title: 'Afterstory' });
	});
});

describe('a book', () => {
	const single = content({
		title: 'Summer Days',
		site: 'NHENTAI',
		url: '/g/111/',
		pages: files(4).map((f) => ({ name: f.slice(0, 4) })),
		favourite: true,
		rating: 4,
		reads: 1,
		lastReadPageIndex: 2,
		lastReadDate: 9
	});

	it('is a single book with its own rating, FAV, pages and cover', () => {
		const s = planHentoidBook(folder(single, [...files(4), 'thumb.jpg']), ROOT, 0);
		expect(s).toMatchObject({
			originKey: 'hentoid:NHENTAI:/g/111/',
			kind: 'doujin',
			// Hentoid's 4 stars of 5, out of 10 (c67).
			rating: 8,
			favourite: true,
			path: ROOT
		});
		expect(s.entries).toHaveLength(1);
		expect(s.entries[0]).toMatchObject({
			label: 'Book',
			title: 'Summer Days',
			file: 'nhentai/x - Title - [1]',
			pageCount: 4,
			coverFile: 'thumb.jpg',
			lastPosition: 2,
			lastOpenedAt: 9,
			readAt: null
		});
		expect(s.entries[0].pages).toEqual(files(4));
		expect(s.entries[0].coverPhash).toBe((123456789).toString(16).padStart(16, '0'));
	});

	it('marks a finished book read, and an unopened one untouched', () => {
		const done = planHentoidBook(folder({ ...single, completed: true }, files(4)), ROOT, 0)
			.entries[0];
		expect(done).toMatchObject({ readAt: 9, lastPosition: null, history: { finished: true } });
		const fresh = planHentoidBook(folder({ ...single, reads: 0 }, files(4)), ROOT, 0).entries[0];
		expect(fresh).toMatchObject({ readAt: null, lastOpenedAt: null, history: null });
	});

	it('keeps a page Hentoid forgot to list, after the listed ones', () => {
		const s = planHentoidBook(folder(single, [...files(4), '0005.jpg']), ROOT, 0);
		expect(s.entries[0].pages?.at(-1)).toBe('0005.jpg');
	});

	it('is still a book without its JSON, from the folder alone', () => {
		const s = planHentoidBook(
			folder(null, files(2), 'nhentai/someone - Lost Json - [333]'),
			ROOT,
			5
		);
		expect(s).toMatchObject({
			title: 'Lost Json',
			originKey: 'hentoid-dir:nhentai/someone - Lost Json - [333]',
			addedAt: 5
		});
		expect(s.entries[0]).toMatchObject({ pageCount: 2, readAt: null });
	});
});

describe('a multi-chapter book', () => {
	const pages = [
		...files(3).map((f) => ({ name: f.slice(0, 4), chapter: 1 })),
		...files(5)
			.slice(3)
			.map((f) => ({ name: f.slice(0, 4), chapter: 2 }))
	];
	const json = content({
		title: 'Laid',
		site: 'HENTAI2READ',
		url: 'laid/',
		pages,
		chapters: [
			{ order: 1, name: '1 - Laid', url: 'u/1' },
			{ order: 2, name: '1.5 - Laid [Full Color]', url: 'u/1.5' }
		],
		reads: 1,
		lastReadPageIndex: 4,
		lastReadDate: 9,
		artist: 'mori'
	});
	const s = planHentoidBook(folder(json, files(5)), ROOT, 0);

	it('becomes a series of books, one per chapter, split by page', () => {
		expect(s.entries.map((e) => [e.label, e.title, e.pageCount, e.sourceUrl])).toEqual([
			['Ch. 1', 'Laid', 3, 'u/1'],
			['Ch. 1.5', 'Laid [Full Color]', 2, 'u/1.5']
		]);
		expect(s.entries[1].pages).toEqual(['0004.jpg', '0005.jpg']);
	});

	it('spreads the one page index over the chapters', () => {
		expect(s.entries[0]).toMatchObject({ readAt: 9, lastPosition: null });
		expect(s.entries[1]).toMatchObject({ readAt: null, lastPosition: 1, history: { page: 1 } });
	});

	it('gives each book the tags, so person pages find it', () => {
		expect(s.entries[1].tags).toContainEqual({ namespace: 'artist', value: 'mori' });
	});
});
