import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encode, type Msg } from './protobuf-writer';
import { zip } from './zip-writer';

/**
 * A synthetic Mihon folder shaped like the real one (doc/IMPORT-FORMATS.md):
 * two sources, the owner's rating categories with their "+" twins, a series
 * with downloads matched by URL (Weeb Central) and tracked on MAL, one matched only by number
 * (Asura adds a slug hash to its URLs), a hidden "+" series, a browsed-only
 * series, and a download the backup doesn't know.
 */
export const WEEB = 2131019126180322627n;
export const ASURA = 6247824327199706550n;

export const CATEGORIES = [
	'Amazing',
	'Good',
	'Okay',
	'Dropped',
	'IDR',
	'To Read',
	'Amazing+',
	'Good+'
];

const chapter = (n: number, url: string, extra: Msg = []): Msg => [
	[1, url],
	[2, `Chapter ${n}`],
	[7, 1_700_000_000_000 + n],
	[9, { f32: n }],
	[10, 100 - n],
	...extra
];

/** `extra`: more Weeb Central chapters, not downloaded anywhere, for a device that knows more. */
export function backup(extra: number[] = []): Uint8Array {
	const manga: Msg[] = [
		// Weeb Central, in "Good", downloads matched by the chapter URL.
		[
			[1, WEEB],
			[2, '/series/01J76/Drawing'],
			[3, 'Drawing: Saikyou Mangaka'],
			[5, 'KIM Kwang-Hyun, LIM Dall-Young'],
			[6, 'An isekai.'],
			[7, 'Action'],
			[7, 'Manga'],
			[8, 1],
			[13, 1_690_000_000_000],
			[16, chapter(1, '/chapters/AAA1', [[4, true]])],
			[16, chapter(2, '/chapters/AAA2', [[6, 4]])],
			[16, chapter(3, '/chapters/AAA3', [[3, 'Night Owl Scans']])],
			...extra.map((n): [number, Msg] => [16, chapter(n, `/chapters/AAA${n}`)]),
			[17, 1],
			// Tracked on MyAnimeList (tracker 1), scored 9; and on Kitsu (3), which
			// tsundoku doesn't link to.
			[
				18,
				[
					[1, 1],
					[2, 5_000_001n],
					[4, 'https://myanimelist.net/manga/147272'],
					[5, 'Drawing: The Strongest Mangaka'],
					[6, { f32: 2 }],
					[8, { f32: 9 }],
					[9, 1],
					[100, 147272n]
				]
			],
			[
				18,
				[
					[1, 3],
					[5, 'Drawing'],
					[100, 99n]
				]
			],
			[
				104,
				[
					[1, '/chapters/AAA1'],
					[2, 1_750_000_000_000],
					[3, 600_000]
				]
			],
			[
				104,
				[
					[1, '/chapters/AAA2'],
					[2, 1_750_000_100_000],
					[3, 120_000]
				]
			]
		],
		// Asura, "Amazing", no genre but a webtoon reader; matched by number.
		[
			[1, ASURA],
			[2, '/series/academys-undercover-professor'],
			[3, 'Academy’s Undercover Professor'],
			[4, 'Artist A'],
			[8, 2],
			[
				16,
				[
					[1, '/series/academys-undercover-professor/chapter/98'],
					[2, 'Chapter 98 - Lindenborough'],
					[9, { f32: 98 }],
					[10, 1]
				]
			],
			[
				16,
				[
					[1, '/series/academys-undercover-professor/chapter/99'],
					[2, 'Chapter 99'],
					[9, { f32: 99 }],
					[10, 0]
				]
			],
			[
				16,
				[
					[1, '/series/academys-undercover-professor/extra'],
					[2, 'Side story'],
					[10, 2]
				]
			],
			[17, 0],
			[103, 4]
		],
		// "Good+": adult, so hidden, rated 4.
		[
			[1, ASURA],
			[2, '/series/bunk-beds'],
			[3, 'Bunk Beds'],
			[16, chapter(1, '/series/bunk-beds/1')],
			[17, 7]
		],
		// "To Read": unrated, on the shelf.
		[
			[1, ASURA],
			[2, '/series/myst'],
			[3, 'Myst, Might, Mayhem'],
			[16, chapter(1, '/series/myst/1')],
			[17, 5]
		],
		// Mihon's local source (0): a folder it knows, read to the end.
		[
			[1, 0n],
			[2, 'aoi rin - Local Book - [555]'],
			[3, 'aoi rin - Local Book - [555]'],
			[
				16,
				[
					[1, 'aoi rin - Local Book - [555]/chapter_1'],
					[2, 'chapter_1'],
					[4, true],
					[6, 2],
					[10, 0]
				]
			],
			[100, false],
			[
				104,
				[
					[1, 'aoi rin - Local Book - [555]/chapter_1'],
					[2, 1_760_000_000_000],
					[3, 90_000]
				]
			]
		],
		// Browsed only: not in the library.
		[
			[1, ASURA],
			[2, '/series/browsed'],
			[3, 'Only Browsed'],
			[16, chapter(1, '/series/browsed/1')],
			[100, false]
		]
	];
	const msg: Msg = [
		...manga.map((m): [number, Msg] => [1, m]),
		...CATEGORIES.map((name, i): [number, Msg] => [
			2,
			[[1, name], ...(i ? ([[2, i]] as Msg) : []), [3, i + 1]]
		]),
		[
			101,
			[
				[1, 'Weeb Central'],
				[2, WEEB]
			]
		],
		[
			101,
			[
				[1, 'Asura Scans'],
				[2, ASURA]
			]
		]
	];
	return encode(msg);
}

export function comicInfo(o: {
	title: string;
	series: string;
	number: number;
	web: string;
	source: string;
}): string {
	return `<?xml version='1.0' encoding='UTF-8' ?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>${o.title}</Title>
  <Series>${o.series}</Series>
  <Number>${o.number}</Number>
  <Writer>_</Writer>
  <Genre>Action, Manga</Genre>
  <Web>https://myanimelist.net/manga/1 ${o.web}</Web>
  <mh:SourceMihon xmlns:mh="http://www.w3.org/2001/XMLSchema">${o.source}</mh:SourceMihon>
</ComicInfo>`;
}

export function cbz(info: string, pages = 3): Buffer {
	return zip([
		{ name: 'ComicInfo.xml', data: info },
		...Array.from({ length: pages }, (_, i) => ({
			name: `${String(pages - i).padStart(3, '0')}.png`,
			data: Buffer.alloc(16, i)
		}))
	]);
}

/** Write the whole folder under `dir` and return the path of its `Mihon/`. */
export function writeMihonFolder(dir: string): string {
	const root = join(dir, 'Mihon');
	mkdirSync(join(root, 'autobackup'), { recursive: true });
	writeFileSync(join(root, 'autobackup', 'app.mihon_2026-09-22_19-06.tachibk'), gzipSync(backup()));

	const weeb = join(root, 'downloads', 'Weeb Central (EN)', 'Drawing_ Saikyou Mangaka');
	mkdirSync(weeb, { recursive: true });
	for (const n of [2, 3])
		writeFileSync(
			join(weeb, `Unknown_Chapter ${n}_abc${n}.cbz`),
			cbz(
				comicInfo({
					title: `Chapter ${n}`,
					series: 'Drawing: Saikyou Mangaka',
					number: n,
					web: `https://weebcentral.com/chapters/AAA${n}`,
					source: 'Weeb Central'
				}),
				n + 10
			)
		);
	writeFileSync(join(weeb, '.nomedia'), '');

	const asura = join(root, 'downloads', 'Asura Scans (EN)', 'Academy’s Undercover Professor');
	mkdirSync(asura, { recursive: true });
	writeFileSync(
		join(asura, 'Chapter 98 - Lindenborough.cbz'),
		cbz(
			comicInfo({
				title: 'Chapter 98 - Lindenborough',
				series: 'Academy’s Undercover Professor',
				number: 98,
				web: 'https://asuracomic.net/series/academys-undercover-professor-87c66c42/chapter/98',
				source: 'Asura Scans'
			})
		)
	);

	// The local source: a folder of images per book, and a cover beside it.
	for (const name of ['aoi rin - Local Book - [555]', ' - No Artist Here - [777]']) {
		const book = join(root, 'local', name, 'chapter_1');
		mkdirSync(book, { recursive: true });
		for (const p of ['001.jpg', '002.jpg', '003.jpg'])
			writeFileSync(join(book, p), Buffer.alloc(16, 1));
		writeFileSync(join(root, 'local', name, 'cover.jpg'), Buffer.alloc(16, 2));
	}
	// Android's leftover second downloads folder, with a chapter in it.
	const extra = join(root, 'downloads (1)', 'Weeb Central (EN)', 'Drawing_ Saikyou Mangaka');
	mkdirSync(extra, { recursive: true });

	const orphan = join(root, 'downloads', 'Asura Scans (EN)', 'Not In The Backup');
	mkdirSync(orphan, { recursive: true });
	writeFileSync(
		join(orphan, 'Chapter 1.cbz'),
		cbz(
			comicInfo({
				title: 'Chapter 1',
				series: 'Not In The Backup',
				number: 1,
				web: 'https://x/1',
				source: 'Asura Scans'
			})
		)
	);
	writeFileSync(join(orphan, 'broken.cbz'), 'not a zip');
	return root;
}
