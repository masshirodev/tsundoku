import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { zip } from './helpers/zip-writer';
import { listZip, readMember, ZipError, type ZipMember } from '$lib/server/zip';
import { readBackup } from '$lib/server/import/mihon';

// An archive's central directory is its own word (zip.ts): a downloaded or
// uploaded CBZ or EPUB can claim any size, and a few kilobytes can inflate to
// gigabytes. Members are read only inside the file, to a limit, and inflate
// to no more than they claim.

const dir = mkdtempSync(join(tmpdir(), 'tsundoku-zip-limits-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** [bytes] as a file, its members as the directory lists them, and a reader. */
async function archive(bytes: Buffer) {
	const path = join(dir, `${n++}.zip`);
	writeFileSync(path, bytes);
	const fh = await open(path, 'r');
	const members = await listZip(fh, bytes.length);
	const read = (m: ZipMember, max?: number) => readMember(fh, m, max);
	return { members, read, close: () => fh.close() };
}

/** The central directory's entry for the first member, to rewrite what it claims. */
function centralOf(bytes: Buffer): number {
	return bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
}

describe('a member of an archive', () => {
	it('reads as it is, stored or deflated', async () => {
		const a = await archive(
			zip([
				{ name: 'stored.txt', data: 'hello' },
				{ name: 'deflated.txt', data: 'hello '.repeat(100), deflate: true }
			])
		);
		expect((await a.read(a.members[0])).toString()).toBe('hello');
		expect((await a.read(a.members[1])).toString()).toBe('hello '.repeat(100));
		await a.close();
	});

	it('inflates to no more than the size its directory claims', async () => {
		// Ten megabytes of zeros deflate to about ten kilobytes; the directory says 100 bytes.
		const bytes = zip([{ name: 'bomb.bin', data: Buffer.alloc(10 * 1024 * 1024), deflate: true }]);
		bytes.writeUInt32LE(100, centralOf(bytes) + 24);
		const a = await archive(bytes);
		await expect(a.read(a.members[0])).rejects.toThrow(/inflates past the 100 bytes/);
		await a.close();
	});

	it('is refused past the largest a member may be, before anything is read', async () => {
		const a = await archive(
			zip([{ name: 'big.bin', data: Buffer.alloc(64 * 1024), deflate: true }])
		);
		await expect(a.read(a.members[0], 1024)).rejects.toBeInstanceOf(ZipError);
		await a.close();
	});

	it('is refused when its compressed bytes would run past the end of the file', async () => {
		const bytes = zip([{ name: 'a.txt', data: 'hello' }]);
		// Four gigabytes, claimed: no buffer of that size is made to find out.
		bytes.writeUInt32LE(0xfffffff0, centralOf(bytes) + 20);
		bytes.writeUInt32LE(0xfffffff0, centralOf(bytes) + 24);
		const a = await archive(bytes);
		await expect(a.read(a.members[0])).rejects.toBeInstanceOf(ZipError);
		await expect(a.read(a.members[0], 0xffffffff)).rejects.toThrow(/past the end of the file/);
		await a.close();
	});

	it('is refused when stored at a size its directory doesn’t give', async () => {
		const bytes = zip([{ name: 'a.txt', data: 'hello' }]);
		bytes.writeUInt32LE(2, centralOf(bytes) + 24);
		const a = await archive(bytes);
		await expect(a.read(a.members[0])).rejects.toThrow(/stored at a size/);
		await a.close();
	});
});

describe('a Mihon backup on the library disk', () => {
	it('inflates to a limit, as an uploaded one does', async () => {
		const path = join(dir, 'bomb.tachibk');
		writeFileSync(path, gzipSync(Buffer.alloc(1024 * 1024)));
		await expect(readBackup(path, 64 * 1024)).rejects.toMatchObject({
			code: 'ERR_BUFFER_TOO_LARGE'
		});
	});
});
