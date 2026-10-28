import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	decodeBackup,
	encodeBackup,
	type MihonBackup,
	type MihonChapter
} from '$lib/import/mihon-backup';
import { comicInfoXml, parseComicInfo } from '$lib/import/comicinfo';
import { zip } from '$lib/server/zip-write';
import { listZip, readMember } from '$lib/server/zip';

// What tsundoku writes as a device of its own (doc/DOWNLOADER.md) has to read
// back through the importer's readers exactly as a phone's or Suwayomi's does.

const chapter = (c: Partial<MihonChapter>): MihonChapter => ({
	url: '/chapters/1',
	name: 'Chapter 1',
	scanlator: '',
	read: false,
	bookmark: false,
	lastPageRead: 0,
	dateFetch: 1_790_000_000_000,
	dateUpload: 1_789_000_000_000,
	number: 1,
	sourceOrder: 0,
	...c
});

const backup: MihonBackup = {
	categories: [
		{ name: 'Good', order: 1 },
		{ name: 'To Read+', order: 4 }
	],
	// A source id past 2^53, as Mihon's are.
	sources: new Map([['6247824327199706550', 'Asura Scans']]),
	manga: [
		{
			source: '6247824327199706550',
			url: '/series/a-series',
			title: 'A Series & Its "Title"',
			artist: 'Someone',
			author: 'Someone Else',
			description: 'Line one\nline two',
			genres: ['Action', 'Manhwa'],
			status: 1,
			thumbnailUrl: 'https://example.org/cover.webp',
			dateAdded: 1_780_000_000_000,
			viewer: 4,
			chapters: [
				chapter({
					url: '/chapters/3',
					name: 'Chapter 2.1',
					number: 2.1,
					sourceOrder: 0,
					read: true
				}),
				chapter({
					url: '/chapters/2',
					name: 'Side story',
					number: -1,
					sourceOrder: 1,
					lastPageRead: 7
				}),
				chapter({
					url: '/chapters/1',
					name: 'Chapter 1',
					scanlator: 'Night Owl Scans',
					sourceOrder: 2
				})
			],
			categories: [1, 4],
			favorite: true,
			history: [{ url: '/chapters/3', lastRead: 1_790_000_100_000, readDuration: 120_000 }],
			trackers: [
				{
					service: 1,
					mediaId: 12345,
					title: 'A Series',
					status: 1,
					score: 8,
					lastChapterRead: 2,
					totalChapters: 0
				}
			]
		},
		{
			source: '6247824327199706550',
			url: '/series/browsed',
			title: 'Only Browsed',
			artist: '',
			author: '',
			description: '',
			genres: [],
			status: 0,
			thumbnailUrl: '',
			dateAdded: null,
			viewer: 0,
			chapters: [],
			categories: [],
			favorite: false,
			history: [],
			trackers: []
		}
	]
};

describe('the backup tsundoku writes', () => {
	it('reads back as it was written', () => {
		expect(decodeBackup(encodeBackup(backup))).toEqual(backup);
	});

	// A library of thousands of chapters: building it by spreading payloads
	// into an array would overflow the arguments a call can take.
	it('writes a backup of tens of thousands of chapters', () => {
		const big: MihonBackup = {
			...backup,
			manga: [
				{
					...backup.manga[0],
					chapters: Array.from({ length: 30_000 }, (_, i) =>
						chapter({ url: `/c/${i}`, name: `Chapter ${i}`, number: i, sourceOrder: i })
					)
				}
			]
		};
		const read = decodeBackup(encodeBackup(big));
		expect(read.manga[0].chapters).toHaveLength(30_000);
		expect(read.manga[0].chapters[29_999]).toMatchObject({ url: '/c/29999', number: 29_999 });
	});
});

describe('the ComicInfo tsundoku writes', () => {
	it('reads back field for field, escaped', () => {
		const info = {
			title: 'Chapter 98 - Ash & <Embers>',
			series: 'A Series & Its "Title"',
			number: 98.5,
			web: ['https://example.org/series/a/chapter/98'],
			summary: 'Two\nlines',
			writer: 'Someone',
			penciller: 'Someone Else',
			translator: 'Night Owl Scans',
			genres: ['Action', 'Fantasy'],
			status: 'Ongoing',
			categories: ['Good'],
			source: 'Asura Scans'
		};
		expect(parseComicInfo(comicInfoXml(info))).toEqual(info);
	});

	it('leaves out what it doesn’t know, and reads that back as empty', () => {
		const xml = comicInfoXml({ title: 'Chapter 1', web: ['https://e.org/c/1'] });
		expect(xml).not.toContain('<Writer>');
		expect(parseComicInfo(xml)).toMatchObject({
			title: 'Chapter 1',
			writer: '',
			number: NaN,
			genres: []
		});
	});
});

describe('the CBZ tsundoku writes', () => {
	const members = [
		{ name: '001.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) },
		{ name: '002.webp', data: Buffer.from('RIFF....WEBPVP8 ') },
		{ name: 'ComicInfo.xml', data: comicInfoXml({ title: 'Chapter 1' }), deflate: true }
	];

	// tsundoku's reader doesn't check CRCs, but other tools reject an archive
	// whose members say 0.
	it('gives every member its CRC-32 and a real date, in both headers', () => {
		const archive = zip(members);
		let at = 0;
		for (const m of members) {
			const raw = Buffer.isBuffer(m.data) ? m.data : Buffer.from(m.data);
			expect(archive.readUInt32LE(at + 14)).toBe(crc32(raw));
			expect(archive.readUInt16LE(at + 12)).toBe((1 << 5) | 1);
			at += 30 + Buffer.byteLength(m.name) + archive.readUInt32LE(at + 18);
		}
		const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		expect(archive.readUInt32LE(central + 16)).toBe(crc32(members[0].data as Buffer));
	});

	it('reads back through the importer’s zip reader', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tsundoku-cbz-'));
		try {
			const path = join(dir, 'c.cbz');
			const archive = zip(members);
			writeFileSync(path, archive);
			const fh = await open(path);
			try {
				const listed = await listZip(fh, archive.length);
				expect(listed.map((m) => m.name)).toEqual(['001.jpg', '002.webp', 'ComicInfo.xml']);
				const xml = (await readMember(fh, listed[2])).toString('utf8');
				expect(parseComicInfo(xml).title).toBe('Chapter 1');
			} finally {
				await fh.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
