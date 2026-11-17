import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	cancelUpload,
	CHUNK_BYTES,
	ORIGINS,
	receiveChunk,
	type ChunkAnswer,
	type ImportOrigin
} from '$lib/server/import/backup';
import { fromTv, TV_REFUSAL } from '$lib/server/import/tv';

/**
 * IMPORT A BACKUP's upload (doc/IMPORT-BACKUP.md, "The upload"): a file in
 * pieces of at most CHUNK_BYTES, each a plain POST of raw bytes with what the
 * file is in the query. Pieces keep every request under adapter-node's
 * BODY_SIZE_LIMIT, so the release needs no setting for a backup of any size
 * up to the app's own limit, and the limit is refused with a sentence.
 * Behind the session like every route.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	// The TV never imports: refused before a byte is kept, as the pick
	// screen draws any refusal.
	if (fromTv(request))
		return json({ state: 'refused', id: null, reason: TV_REFUSAL } satisfies ChunkAnswer, {
			status: 403
		});
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
