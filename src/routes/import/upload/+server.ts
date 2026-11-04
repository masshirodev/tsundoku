import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	cancelUpload,
	CHUNK_BYTES,
	ORIGINS,
	receiveChunk,
	type ImportOrigin
} from '$lib/server/import/backup';

/**
 * IMPORT A BACKUP's upload (c438, doc/IMPORT.md, "The upload"): a file in
 * pieces of at most CHUNK_BYTES, each a plain POST of raw bytes with what the
 * file is in the query. Pieces keep every request under adapter-node's
 * BODY_SIZE_LIMIT, so the release needs no setting for a backup of any size
 * up to the app's own limit, and the limit is refused with a sentence.
 * Behind the session like every route.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const q = url.searchParams;
	const origin = (q.get('from') ?? 'desktop') as ImportOrigin;
	const body = new Uint8Array(await request.arrayBuffer());
	if (body.length > CHUNK_BYTES) error(413, 'a piece larger than the upload sends');
	const answer = receiveChunk(
		{
			token: q.get('token') || null,
			name: (q.get('name') ?? '').slice(0, 300) || 'backup',
			size: Number(q.get('size')),
			offset: Number(q.get('offset')),
			origin: ORIGINS.includes(origin) ? origin : 'desktop'
		},
		body
	);
	return json(answer);
};

/** CANCEL while it uploads: the pieces kept so far go. */
export const DELETE: RequestHandler = ({ url }) => {
	cancelUpload(url.searchParams.get('token') ?? '');
	return new Response(null, { status: 204 });
};
