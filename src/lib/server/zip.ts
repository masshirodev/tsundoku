import { open, type FileHandle } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

/**
 * Enough of ZIP to read CBZs: the central directory, and one member at a
 * time, stored or deflated. Mihon stores its pages uncompressed, so reading a
 * chapter's directory is two small reads however large the file is -- which
 * is what makes scanning 130 GB of chapters a matter of minutes.
 *
 * ZIP64 is not handled: a chapter archive is nowhere near 4 GB, and one that
 * claims to be is reported as unreadable rather than guessed at.
 *
 * The central directory is the archive's word, not a fact: an archive comes
 * from a download, an upload or a site, and its sizes can be anything. A
 * member is read only when its compressed bytes lie inside the file, and
 * only up to MAX_MEMBER_BYTES, and it inflates to at most the size the
 * directory gives it, so a few kilobytes that inflate to gigabytes stop at
 * what they claimed to be.
 */

export type ZipMember = {
	name: string;
	method: number;
	compressedSize: number;
	size: number;
	/** Offset of the member's local header. */
	offset: number;
};

export class ZipError extends Error {}

/** The largest member read: a page, a chapter's text, a book's picture are all far below it. */
export const MAX_MEMBER_BYTES = 256 * 1024 * 1024;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
	const buf = Buffer.alloc(length);
	const { bytesRead } = await fh.read(buf, 0, length, position);
	return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

export async function listZip(fh: FileHandle, fileSize: number): Promise<ZipMember[]> {
	// The end record is 22 bytes plus a comment of up to 64 KiB.
	const tailLength = Math.min(fileSize, 22 + 0xffff);
	const tail = await readAt(fh, fileSize - tailLength, tailLength);
	let at = -1;
	for (let i = tail.length - 22; i >= 0; i--) {
		if (tail.readUInt32LE(i) === EOCD) {
			at = i;
			break;
		}
	}
	if (at < 0) throw new ZipError('not a zip: no end of central directory');
	const count = tail.readUInt16LE(at + 10);
	const dirSize = tail.readUInt32LE(at + 12);
	const dirOffset = tail.readUInt32LE(at + 16);
	if (count === 0xffff || dirOffset === 0xffffffff)
		throw new ZipError('ZIP64 archives are not supported');
	if (dirOffset + dirSize > fileSize)
		throw new ZipError('central directory runs past the end of the file');

	const dir = await readAt(fh, dirOffset, dirSize);
	const members: ZipMember[] = [];
	let p = 0;
	for (let i = 0; i < count; i++) {
		if (p + 46 > dir.length || dir.readUInt32LE(p) !== CENTRAL)
			throw new ZipError('corrupt central directory');
		const flags = dir.readUInt16LE(p + 8);
		const nameLength = dir.readUInt16LE(p + 28);
		const extraLength = dir.readUInt16LE(p + 30);
		const commentLength = dir.readUInt16LE(p + 32);
		const raw = dir.subarray(p + 46, p + 46 + nameLength);
		members.push({
			// Bit 11 says UTF-8; without it the name is CP437, which for the
			// ASCII names archivers write in practice reads the same.
			name: raw.toString(flags & 0x800 ? 'utf8' : 'latin1'),
			method: dir.readUInt16LE(p + 10),
			compressedSize: dir.readUInt32LE(p + 20),
			size: dir.readUInt32LE(p + 24),
			offset: dir.readUInt32LE(p + 42)
		});
		p += 46 + nameLength + extraLength + commentLength;
	}
	return members;
}

export async function readMember(
	fh: FileHandle,
	member: ZipMember,
	max = MAX_MEMBER_BYTES
): Promise<Buffer> {
	if (member.size > max || member.compressedSize > max)
		throw new ZipError(`${member.name} is larger than the ${max} bytes a member may be`);
	if (member.method !== 0 && member.method !== 8)
		throw new ZipError(`unsupported compression method ${member.method} for ${member.name}`);
	const header = await readAt(fh, member.offset, 30);
	if (header.length < 30 || header.readUInt32LE(0) !== LOCAL)
		throw new ZipError(`bad local header for ${member.name}`);
	const start = member.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
	// Checked before anything is allocated for it: a size past the end of the
	// file is a lie, and would be a buffer of that size first.
	const { size: fileSize } = await fh.stat();
	if (start + member.compressedSize > fileSize)
		throw new ZipError(`${member.name} runs past the end of the file`);
	const data = await readAt(fh, start, member.compressedSize);
	if (data.length < member.compressedSize)
		throw new ZipError(`${member.name} runs past the end of the file`);
	if (member.method === 0) {
		if (data.length !== member.size)
			throw new ZipError(`${member.name} is stored at a size its directory doesn't give`);
		return data;
	}
	try {
		// zlib needs a limit of at least one byte; an empty member inflates to none.
		return inflateRawSync(data, { maxOutputLength: Math.max(1, member.size) });
	} catch (e) {
		if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
			throw new ZipError(`${member.name} inflates past the ${member.size} bytes it claims`);
		throw new ZipError(`${member.name} doesn't inflate (${(e as Error).message})`);
	}
}

export async function withZip<T>(
	path: string,
	fn: (fh: FileHandle, members: ZipMember[]) => Promise<T>
): Promise<T> {
	const fh = await open(path, 'r');
	try {
		const { size } = await fh.stat();
		return await fn(fh, await listZip(fh, size));
	} finally {
		await fh.close();
	}
}

const IMAGE = /\.(jpe?g|png|webp|gif|avif|jxl)$/i;

/**
 * The pages of a comic archive, in reading order: images only, skipping
 * macOS resource forks, sorted by a natural sort of the full path -- which
 * is what Mihon does, and what orders "002__001.jpg" before "002__002.jpg".
 */
export function pageMembers(members: ZipMember[]): ZipMember[] {
	return members
		.filter((m) => IMAGE.test(m.name) && !m.name.startsWith('__MACOSX/') && !m.name.endsWith('/'))
		.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
}
