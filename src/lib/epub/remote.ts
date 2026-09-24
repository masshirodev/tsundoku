import type { ZipReader } from './unzip';

/**
 * A book read file by file from the workstation (doc/TEXT-READER.md): the
 * EPUB stays there, and the reader asks for the few files a chapter needs --
 * its documents and their images -- by name. Each answer is kept for the
 * session, and the device cache keeps the chapters around the one being read
 * (src/lib/cache/device.ts), so the service worker can answer offline.
 */

/** A file the workstation didn't send: offline, and not kept on the tablet. */
export class MemberUnavailable extends Error {}

export type BookFile = { name: string; size: number };

const utf8 = new TextDecoder();

export class RemoteZip implements ZipReader {
	readonly names: string[];
	private readonly sizes: Map<string, number>;
	private readonly got = new Map<string, Promise<Uint8Array>>();

	constructor(
		files: BookFile[],
		/** Where a file of the book is asked for. */
		readonly urlOf: (name: string) => string,
		private readonly fetcher: typeof fetch = (...a) => fetch(...a)
	) {
		this.names = files.map((f) => f.name);
		this.sizes = new Map(files.map((f) => [f.name, f.size]));
	}

	has(name: string): boolean {
		return this.sizes.has(name);
	}

	/** Its size unpacked: what keeping it costs the device cache. */
	sizeOf(name: string): number {
		return this.sizes.get(name) ?? 0;
	}

	bytesOf(name: string): Promise<Uint8Array> {
		let p = this.got.get(name);
		if (!p) {
			p = this.fetcher(this.urlOf(name)).then(
				async (r) => {
					if (!r.ok) throw new MemberUnavailable(`${name} · ${r.status}`);
					return new Uint8Array(await r.arrayBuffer());
				},
				() => {
					throw new MemberUnavailable(name);
				}
			);
			// A failure isn't kept: the next ask tries again.
			p.catch(() => this.got.delete(name));
			this.got.set(name, p);
		}
		return p;
	}

	async textOf(name: string): Promise<string> {
		return utf8.decode(await this.bytesOf(name));
	}
}

/**
 * The book as the reader holds it (doc/TEXT-READER.md, "Opening"): file by
 * file from the workstation at first, and from memory once the whole EPUB,
 * downloading behind the first chapter, has arrived.
 */
export class BookZip implements ZipReader {
	private whole: ZipReader | null = null;

	constructor(private readonly remote: RemoteZip) {}

	get names(): string[] {
		return this.remote.names;
	}

	/** Whether the whole book is here: every chapter then reads with no network. */
	get complete(): boolean {
		return this.whole !== null;
	}

	/** The whole book arrived: read from it from now on. */
	arrived(whole: ZipReader): void {
		this.whole = whole;
	}

	has(name: string): boolean {
		return this.remote.has(name);
	}

	bytesOf(name: string): Promise<Uint8Array> {
		return this.whole ? this.whole.bytesOf(name) : this.remote.bytesOf(name);
	}

	textOf(name: string): Promise<string> {
		return this.whole ? this.whole.textOf(name) : this.remote.textOf(name);
	}
}
