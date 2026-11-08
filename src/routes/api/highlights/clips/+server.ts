import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import { ClipError, clipJobs, keepClip } from '$lib/server/highlights/clips';

/**
 * KEEP in the player (card c704; doc/HIGHLIGHTS.md, "Clips"): starts the job and
 * answers at once, since the episode plays on while it is cut. Incognito makes
 * none, refused here as well as dimmed in the player. GET is the player's poll,
 * and the highlights page's KEEPING.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (isIncognito(cookies)) error(403, 'incognito makes no highlight');
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const entryId = Number(body?.entry);
	if (!Number.isInteger(entryId) || entryId <= 0) error(400, 'an episode and a range');
	try {
		const job = keepClip(
			{
				entryId,
				from: body?.from,
				to: body?.to,
				subtitle: typeof body?.subtitle === 'string' ? body.subtitle : null,
				audio: typeof body?.audio === 'string' ? body.audio : null,
				// A quality with no height sends null, and Number(null) is 0: the worst variant.
				height:
					typeof body?.height === 'number' && Number.isFinite(body.height) && body.height > 0
						? body.height
						: null,
				fresh: body?.fresh === true
			},
			isRevealed(cookies)
		);
		return json(job, { status: 202 });
	} catch (e) {
		if (e instanceof ClipError) error(e.why === 'bad_range' ? 400 : 404, e.message);
		throw e;
	}
};

export const GET: RequestHandler = ({ url, cookies }) => {
	const raw = url.searchParams.get('entry');
	const entry = raw === null ? undefined : Number(raw);
	if (entry !== undefined && (!Number.isInteger(entry) || entry <= 0))
		error(400, 'no such episode');
	return json(clipJobs(isRevealed(cookies), entry));
};
