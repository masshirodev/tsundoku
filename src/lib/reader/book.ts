import { resolve } from '$app/paths';
import {
	EpubError,
	parseContainer,
	parsePackage,
	protectionOf,
	type Package
} from '$lib/epub/epub';
import { BookZip, MemberUnavailable, RemoteZip, type BookFile } from '$lib/epub/remote';
import { UnzipError, Zip, type ZipReader } from '$lib/epub/unzip';
import { isVerticalBook } from './text';
import { bookImages, type Images } from './text-dom';

/**
 * A novel's EPUB, open on the tablet (doc/TEXT-READER.md, "Opening").
 *
 * A book the device already keeps opens from it, whole, as it always did.
 * Otherwise it opens at once, file by file: the reader has the book's list of
 * files and asks for the few a chapter needs, and the chapters either side
 * come right behind. Meanwhile the whole EPUB downloads in the background;
 * once it's here, every chapter reads from memory, and it's kept on the
 * device (src/lib/cache/device.ts, `cacheBook`) for next time.
 */

export type OpenBook = {
	zip: ZipReader & { readonly complete?: boolean };
	pkg: Package;
	vertical: boolean;
	images: Images & { revoke(): void };
	/** The whole EPUB, once it has arrived; null if it never did. */
	whole: Promise<Uint8Array | null>;
};

/** Why a book didn't open: the reader's DID NOT OPEN screen says which. */
export class BookFailure extends Error {
	constructor(
		/** `online`: a chapter read from its source didn't come (doc/READING-ONLINE.md, "Novels online"). */
		readonly kind: 'drm' | 'broken' | 'missing' | 'offline' | 'undownloaded' | 'online',
		readonly detail: string
	) {
		super(detail);
	}
}

/**
 * `file`: one volume, in a novel grouped from several EPUBs (doc/BOOKS.md).
 * Left out for a series of one book, so its URL -- and the copy the device
 * cache already keeps under it -- stays what it was.
 */
const query = (version: string, file?: string) =>
	`?v=${encodeURIComponent(version)}${file ? `&f=${encodeURIComponent(file)}` : ''}`;
export const bookUrl = (seriesId: number, version: string, file?: string) =>
	`${resolve('/api/series/[id]/epub', { id: String(seriesId) })}${query(version, file)}`;
const filesUrl = (seriesId: number, version: string, file?: string) =>
	`${resolve('/api/series/[id]/epub/files', { id: String(seriesId) })}${query(version, file)}`;
const fileUrl = (seriesId: number, version: string, name: string, file?: string) =>
	`${resolve('/api/series/[id]/epub/file', { id: String(seriesId) })}${query(version, file)}&p=${encodeURIComponent(name)}`;

// Module state shared by every reader in the session, never rendered.
const open = new Map<string, Promise<OpenBook>>();

async function download(url: string, progress: (f: number) => void): Promise<Uint8Array> {
	let res: Response;
	try {
		res = await fetch(url);
	} catch {
		throw new BookFailure('offline', 'THE WORKSTATION DID NOT ANSWER');
	}
	if (!res.ok) throw new BookFailure('missing', `THE FILE IS NOT THERE · ${res.status}`);
	const total = Number(res.headers.get('content-length')) || 0;
	if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
	const out = new Uint8Array(total);
	const reader = res.body.getReader();
	let at = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (at + value.length > out.length) throw new BookFailure('broken', 'THE DOWNLOAD RAN LONG');
		out.set(value, at);
		at += value.length;
		progress(at / total);
	}
	return out.subarray(0, at);
}

function unzip(bytes: Uint8Array): Zip {
	try {
		return new Zip(bytes);
	} catch (e) {
		throw new BookFailure('broken', e instanceof UnzipError ? e.message : 'NOT A ZIP');
	}
}

async function listing(url: string): Promise<BookFile[]> {
	let res: Response;
	try {
		res = await fetch(url);
	} catch {
		throw new BookFailure('offline', 'THE WORKSTATION DID NOT ANSWER');
	}
	if (res.status === 422) {
		const why = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
		throw new BookFailure('broken', why || 'NOT A ZIP');
	}
	if (!res.ok) throw new BookFailure('missing', `THE FILE IS NOT THERE · ${res.status}`);
	return ((await res.json()) as { files: BookFile[] }).files;
}

async function parse(zip: OpenBook['zip'], whole: Promise<Uint8Array | null>): Promise<OpenBook> {
	const read = async (name: string) => {
		try {
			return await zip.textOf(name);
		} catch (e) {
			if (e instanceof MemberUnavailable)
				throw new BookFailure('offline', 'THE WORKSTATION DID NOT ANSWER');
			if (e instanceof UnzipError) throw new BookFailure('broken', e.message);
			throw e;
		}
	};
	const protection = protectionOf(
		zip.names,
		zip.has('META-INF/encryption.xml') ? await read('META-INF/encryption.xml') : null
	);
	if (protection === 'adobe') throw new BookFailure('drm', 'LOCKED · ADOBE DRM');
	if (protection) throw new BookFailure('drm', 'LOCKED · ENCRYPTED');
	if (!zip.has('META-INF/container.xml'))
		throw new BookFailure('broken', 'CONTAINER.XML NOT FOUND');
	try {
		const opfPath = parseContainer(await read('META-INF/container.xml'));
		if (!zip.has(opfPath)) throw new BookFailure('broken', `${opfPath.toUpperCase()} NOT FOUND`);
		const pkg = parsePackage(await read(opfPath), opfPath);
		if (pkg.spine.length === 0) throw new BookFailure('broken', 'THE SPINE IS EMPTY');
		return {
			zip,
			pkg,
			vertical: isVerticalBook(pkg.language, pkg.rtl),
			images: bookImages(zip),
			whole
		};
	} catch (e) {
		if (e instanceof BookFailure) throw e;
		throw new BookFailure(
			'broken',
			e instanceof EpubError ? e.message : 'THE PACKAGE WOULD NOT PARSE'
		);
	}
}

/** Is this book kept on the device? Then it opens from there, whole. */
async function kept(url: string): Promise<boolean> {
	try {
		return 'caches' in globalThis && !!(await caches.match(url));
	} catch {
		return false;
	}
}

async function opening(
	seriesId: number,
	version: string,
	progress: (f: number) => void,
	file?: string
): Promise<OpenBook> {
	const url = bookUrl(seriesId, version, file);
	if (await kept(url)) {
		const bytes = await download(url, progress);
		return parse(unzip(bytes), Promise.resolve(bytes));
	}
	const remote = new RemoteZip(await listing(filesUrl(seriesId, version, file)), (name) =>
		fileUrl(seriesId, version, name, file)
	);
	const zip = new BookZip(remote);
	// The whole book, behind the first chapter: from then on nothing waits.
	const whole = download(url, () => {}).then(
		(bytes) => {
			zip.arrived(unzip(bytes));
			return bytes;
		},
		() => null
	);
	progress(1);
	return parse(zip, whole);
}

/** The book at this version, opening it on first use; later calls share it. */
export function openBook(
	seriesId: number,
	version: string,
	progress: (fraction: number) => void = () => {},
	file?: string
): Promise<OpenBook> {
	const url = bookUrl(seriesId, version, file);
	let p = open.get(url);
	if (!p) {
		p = opening(seriesId, version, progress, file);
		// A failure isn't kept: RETRY, or the next open, asks again.
		p.catch(() => open.delete(url));
		open.set(url, p);
	}
	return p;
}
