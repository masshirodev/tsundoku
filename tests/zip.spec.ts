import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pageMembers, readMember, withZip } from '$lib/server/zip';
import { zip } from './helpers/zip-writer';

const dir = mkdtempSync(join(tmpdir(), 'tsundoku-zip-'));
const write = (name: string, data: Buffer) => {
	const path = join(dir, name);
	writeFileSync(path, data);
	return path;
};

describe('zip', () => {
	it('lists members and reads stored and deflated ones, past an archive comment', async () => {
		const path = write(
			'a.cbz',
			zip(
				[
					{ name: 'ComicInfo.xml', data: '<ComicInfo/>', deflate: true },
					{ name: '001.png', data: Buffer.alloc(100, 7) }
				],
				'a comment at the end'
			)
		);
		await withZip(path, async (fh, members) => {
			expect(members.map((m) => m.name)).toEqual(['ComicInfo.xml', '001.png']);
			expect((await readMember(fh, members[0])).toString()).toBe('<ComicInfo/>');
			expect((await readMember(fh, members[1])).equals(Buffer.alloc(100, 7))).toBe(true);
		});
	});

	it('orders pages the way Mihon does, images only', async () => {
		const path = write(
			'b.cbz',
			zip(
				[
					'002__002.jpg',
					'003__001.jpg',
					'002__001.jpg',
					'10.webp',
					'9.webp',
					'notes.txt',
					'__MACOSX/._1.jpg'
				].map((name) => ({ name, data: 'x' }))
			)
		);
		const names = await withZip(path, async (_fh, m) => pageMembers(m).map((p) => p.name));
		expect(names).toEqual(['002__001.jpg', '002__002.jpg', '003__001.jpg', '9.webp', '10.webp']);
	});

	it('refuses what is not a zip', async () => {
		const path = write('c.cbz', Buffer.from('not a zip at all'));
		await expect(withZip(path, async () => 0)).rejects.toThrow(/not a zip/);
	});
});
