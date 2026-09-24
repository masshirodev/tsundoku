/**
 * ZIP in the browser (doc/TEXT-READER.md): the reader downloads an EPUB whole,
 * once, and reads its members from memory. The same format rules as
 * src/lib/server/zip.ts, over an ArrayBuffer instead of a file handle, with
 * the platform's DecompressionStream for deflate, so no library is shipped.
 * Also runs in node (the specs), which has the same stream.
 */

export class UnzipError extends Error {}

/** What the reader reads a book through: a zip in memory, or one on the workstation. */
export interface ZipReader {
	readonly names: string[];
	has(name: string): boolean;
	bytesOf(name: string): Promise<Uint8Array>;
	textOf(name: string): Promise<string>;
}

type Member = { name: string; method: number; compressedSize: number; offset: number };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const utf8 = new TextDecoder();

export class Zip implements ZipReader {
	readonly names: string[];
	private readonly members: Map<string, Member>;
	private readonly view: DataView;

	constructor(private readonly bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const v = this.view;
		let at = -1;
		for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
			if (v.getUint32(i, true) === EOCD) {
				at = i;
				break;
			}
		}
		if (at < 0) throw new UnzipError('NOT A ZIP');
		const count = v.getUint16(at + 10, true);
		let p = v.getUint32(at + 16, true);
		if (count === 0xffff || p === 0xffffffff) throw new UnzipError('ZIP64 IS NOT SUPPORTED');
		this.members = new Map();
		for (let i = 0; i < count; i++) {
			if (p + 46 > bytes.length || v.getUint32(p, true) !== CENTRAL)
				throw new UnzipError('CORRUPT CENTRAL DIRECTORY');
			const nameLen = v.getUint16(p + 28, true);
			const extraLen = v.getUint16(p + 30, true);
			const commentLen = v.getUint16(p + 32, true);
			const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
			this.members.set(name, {
				name,
				method: v.getUint16(p + 10, true),
				compressedSize: v.getUint32(p + 20, true),
				offset: v.getUint32(p + 42, true)
			});
			p += 46 + nameLen + extraLen + commentLen;
		}
		this.names = [...this.members.keys()];
	}

	has(name: string): boolean {
		return this.members.has(name);
	}

	async bytesOf(name: string): Promise<Uint8Array> {
		const m = this.members.get(name);
		if (!m) throw new UnzipError(`${name} NOT FOUND`);
		const v = this.view;
		if (v.getUint32(m.offset, true) !== LOCAL) throw new UnzipError(`CORRUPT ENTRY ${name}`);
		const start =
			m.offset + 30 + v.getUint16(m.offset + 26, true) + v.getUint16(m.offset + 28, true);
		const raw = this.bytes.subarray(start, start + m.compressedSize);
		if (m.method === 0) return raw;
		if (m.method !== 8) throw new UnzipError(`UNSUPPORTED COMPRESSION IN ${name}`);
		const stream = new Blob([raw as BlobPart])
			.stream()
			.pipeThrough(new DecompressionStream('deflate-raw'));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}

	async textOf(name: string): Promise<string> {
		return utf8.decode(await this.bytesOf(name));
	}
}
