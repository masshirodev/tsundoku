import { resolve } from '$app/paths';
import {
	EpubError,
	parseContainer,
	parsePackage,
	protectionOf,
	type Package
} from '$lib/epub/epub';
import { UnzipError, Zip } from '$lib/epub/unzip';
import { isVerticalBook } from './text';
import { bookImages, type Images } from './text-dom';

/**
 * A novel's EPUB, open on the tablet (doc/TEXT-READER.md): downloaded once,
 * unzipped in memory, and kept for the session, so moving from one chapter
 * to the next never touches the network. The service worker also answers the
 * download from the device cache once the book is kept there
 * (src/lib/cache/device.ts, `cacheBook`), so a second session opens offline.
 */

export type OpenBook = {
	zip: Zip;
	pkg: Package;
	vertical: boolean;
	images: Images & { revoke(): void };
	bytes: Uint8Array;
};

/** Why a book didn't open: the reader's DID NOT OPEN screen says which. */
export class BookFailure extends Error {
	constructor(
		readonly kind: 'drm' | 'broken' | 'missing' | 'offline',
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
export const bookUrl = (seriesId: number, version: string, file?: string) =>
	`${resolve('/api/series/[id]/epub', { id: String(seriesId) })}?v=${encodeURIComponent(version)}${
		file ? `&f=${encodeURIComponent(file)}` : ''
	}`;

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

async function parse(bytes: Uint8Array): Promise<OpenBook> {
	let zip: Zip;
	try {
		zip = new Zip(bytes);
	} catch (e) {
		throw new BookFailure('broken', e instanceof UnzipError ? e.message : 'NOT A ZIP');
	}
	const protection = protectionOf(
		zip.names,
		zip.has('META-INF/encryption.xml') ? await zip.textOf('META-INF/encryption.xml') : null
	);
	if (protection === 'adobe') throw new BookFailure('drm', 'LOCKED · ADOBE DRM');
	if (protection) throw new BookFailure('drm', 'LOCKED · ENCRYPTED');
	if (!zip.has('META-INF/container.xml'))
		throw new BookFailure('broken', 'CONTAINER.XML NOT FOUND');
	try {
		const opfPath = parseContainer(await zip.textOf('META-INF/container.xml'));
		if (!zip.has(opfPath)) throw new BookFailure('broken', `${opfPath.toUpperCase()} NOT FOUND`);
		const pkg = parsePackage(await zip.textOf(opfPath), opfPath);
		if (pkg.spine.length === 0) throw new BookFailure('broken', 'THE SPINE IS EMPTY');
		return {
			zip,
			pkg,
			vertical: isVerticalBook(pkg.language, pkg.rtl),
			images: bookImages(zip),
			bytes
		};
	} catch (e) {
		if (e instanceof BookFailure) throw e;
		throw new BookFailure(
			'broken',
			e instanceof EpubError ? e.message : 'THE PACKAGE WOULD NOT PARSE'
		);
	}
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
		p = download(url, progress).then(parse);
		// A failure isn't kept: RETRY, or the next open, asks again.
		p.catch(() => open.delete(url));
		open.set(url, p);
	}
	return p;
}
