import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ONLINE_FILE } from '$lib/server/novels/online';
import { isRevealed } from '$lib/server/prefs';
import { epubMember } from '$lib/server/epub';

const TYPES: Record<string, string> = {
	xhtml: 'application/xhtml+xml',
	html: 'text/html; charset=utf-8',
	htm: 'text/html; charset=utf-8',
	xml: 'application/xml',
	opf: 'application/oebps-package+xml',
	ncx: 'application/x-dtbncx+xml',
	css: 'text/css',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml'
};

/**
 * One file of a novel's EPUB, unpacked (doc/TEXT-READER.md, "A chapter at a
 * time"): `p` is its name in the book. Versioned (`v`), so immutable; the
 * reader keeps the chapters around the one being read on the tablet. Hidden
 * means hidden: a 404 while reveal is off.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const name = url.searchParams.get('p');
	if (!name) error(400, 'which file');
	const got = await epubMember(
		Number(params.id),
		isRevealed(cookies),
		name,
		url.searchParams.get('f') ?? undefined
	);
	if (!got) error(404, 'not found');
	const v = url.searchParams.get('v');
	if (v && v !== got.version) error(409, 'the book changed');
	const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
	return new Response(new Uint8Array(got.body), {
		headers: {
			'content-type': TYPES[ext] ?? 'application/octet-stream',
			'content-length': String(got.body.length),
			// A chapter read online is never kept (doc/READING-ONLINE.md, "Novels online").
			'cache-control': ONLINE_FILE.test(url.searchParams.get('f') ?? '')
				? 'private, no-store'
				: v
					? 'private, max-age=31536000, immutable'
					: 'private, no-cache'
		}
	});
};
