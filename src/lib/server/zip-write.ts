import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal ZIP writer: stored or deflated members, a central directory, and
 * an optional archive comment (which pushes the end record away from the end
 * of the file, as real archivers sometimes do). The specs build test archives
 * with it, the seed builds its sample EPUBs (pages/sample-epub.ts), and the
 * downloader writes its CBZs (doc/DOWNLOADER.md).
 *
 * Each member carries its CRC-32: tsundoku's reader doesn't check it, but a
 * CBZ in the library has to be a zip that every other tool accepts too.
 */
const DOS_DATE = (1 << 5) | 1;

export function zip(
	members: { name: string; data: Buffer | string; deflate?: boolean }[],
	comment = ''
): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const m of members) {
		const raw = Buffer.isBuffer(m.data) ? m.data : Buffer.from(m.data);
		const data = m.deflate ? deflateRawSync(raw) : raw;
		const name = Buffer.from(m.name, 'utf8');
		const crc = crc32(raw);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x800, 6);
		local.writeUInt16LE(m.deflate ? 8 : 0, 8);
		// 1980-01-01, the earliest DOS date: a fixed one keeps archives byte-identical, and 0 isn't a date.
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, data);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x800, 8);
		central.writeUInt16LE(m.deflate ? 8 : 0, 10);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);
		offset += 30 + name.length + data.length;
	}
	const dir = Buffer.concat(centrals);
	const text = Buffer.from(comment);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(members.length, 8);
	end.writeUInt16LE(members.length, 10);
	end.writeUInt32LE(dir.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(text.length, 20);
	return Buffer.concat([...locals, dir, end, text]);
}
