import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A synthetic `H/.Hentoid/` shaped like the real one (doc/IMPORT-FORMATS.md):
 * a finished single book, a book read partway, a multi-chapter Hentai2Read
 * book, and a folder with no contentV2.json. Loose images named the way
 * Hentoid names them, a `thumb` cover that is not a page.
 */
type Page = { name: string; chapter?: number };

export function content(o: {
	title: string;
	site: string;
	url: string;
	pages: Page[];
	chapters?: { order: number; name: string; url: string }[];
	favourite?: boolean;
	rating?: number;
	completed?: boolean;
	reads?: number;
	lastReadPageIndex?: number;
	lastReadDate?: number;
	artist?: string;
	circle?: string;
}) {
	const attr = (type: string, name?: string) => (name ? { [type]: [{ name, type, url: '' }] } : {});
	return {
		url: o.url,
		title: o.title,
		qtyPages: o.pages.length,
		downloadDate: 1_700_000_000_000,
		site: o.site,
		favourite: o.favourite ?? false,
		rating: o.rating ?? 0,
		completed: o.completed ?? false,
		reads: o.reads ?? 0,
		lastReadDate: o.lastReadDate ?? 0,
		lastReadPageIndex: o.lastReadPageIndex ?? 0,
		attributes: {
			LANGUAGE: [{ name: 'english', type: 'LANGUAGE', url: '' }],
			TAG: [{ name: 'oneshot', type: 'TAG', url: '' }],
			...attr('ARTIST', o.artist),
			...attr('CIRCLE', o.circle)
		},
		imageFiles: [
			{
				order: 0,
				name: 'thumb',
				isCover: true,
				status: 'DOWNLOADED',
				pHash: 123456789,
				chapterOrder: -1
			},
			...o.pages.map((p, i) => ({
				order: i + 1,
				name: p.name,
				isCover: false,
				status: 'DOWNLOADED',
				pHash: 0,
				chapterOrder: p.chapter ?? -1
			}))
		],
		chapters: o.chapters ?? [],
		groups: []
	};
}

export function book(root: string, folder: string, json: object | null, files: string[]): void {
	const path = join(root, folder);
	mkdirSync(path, { recursive: true });
	for (const f of files) writeFileSync(join(path, f), Buffer.alloc(32, 1));
	if (json) writeFileSync(join(path, 'contentV2.json'), JSON.stringify(json));
}

const names = (n: number, ext = 'jpg', from = 1) =>
	Array.from({ length: n }, (_, i) => `${String(i + from).padStart(4, '0')}.${ext}`);

/** Write `H/.Hentoid/` under `library`; returns the Hentoid root. */
export function writeHentoidFolder(library: string): string {
	const root = join(library, 'H', '.Hentoid');
	book(
		root,
		'nhentai/Aoi Rin - Summer Days - [111]',
		content({
			title: 'Summer Days',
			site: 'NHENTAI',
			url: '/g/111/',
			pages: names(4).map((f) => ({ name: f.replace('.jpg', '') })),
			favourite: true,
			rating: 4,
			completed: true,
			reads: 2,
			lastReadDate: 1_750_000_000_000,
			artist: 'Aoi Rin',
			circle: 'Hakka Kousha'
		}),
		[...names(4), 'thumb.jpg']
	);
	book(
		root,
		'nhentai2/ - Summer Days 2 - [222]',
		content({
			title: 'Summer Days 2',
			site: 'NHENTAI',
			url: '/g/222/',
			pages: names(5).map((f) => ({ name: f.replace('.jpg', '') })),
			reads: 1,
			lastReadPageIndex: 2,
			lastReadDate: 1_750_000_100_000,
			artist: 'Aoi Rin'
		}),
		[...names(5), 'thumb.jpg']
	);
	// Three chapters in one folder: 3 + 2 + 2 pages; read into the second.
	const pages: Page[] = [
		...names(3).map((f) => ({ name: f.replace('.jpg', ''), chapter: 1 })),
		...names(2, 'jpg', 4).map((f) => ({ name: f.replace('.jpg', ''), chapter: 2 })),
		...names(2, 'jpg', 6).map((f) => ({ name: f.replace('.jpg', ''), chapter: 3 }))
	];
	book(
		root,
		'Hentai2Read/mori - Quiet Rooms - [1004]',
		content({
			title: 'Quiet Rooms',
			site: 'HENTAI2READ',
			url: 'quiet_rooms/',
			pages,
			chapters: [
				{ order: 1, name: '1 - Quiet Rooms', url: 'https://h2r/quiet/1/' },
				{ order: 2, name: '1.5 - Quiet Rooms [Full Color]', url: 'https://h2r/quiet/1.5/' },
				{ order: 3, name: '2 - Afterstory', url: 'https://h2r/quiet/2/' }
			],
			reads: 1,
			lastReadPageIndex: 4,
			lastReadDate: 1_750_000_200_000,
			favourite: true,
			artist: 'mori'
		}),
		[...names(7), 'thumb.jpg']
	);
	// No contentV2.json: everything from the folder.
	book(root, 'nhentai/someone - Lost Json - [333]', null, names(3, 'webp'));
	return root;
}
