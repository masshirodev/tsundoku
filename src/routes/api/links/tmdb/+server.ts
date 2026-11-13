import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { seriesAccess } from '$lib/server/catalogue';
import { catalogueConfigured } from '$lib/server/catalogues';
import { NoTmdbKey } from '$lib/server/tmdb';
import {
	tmdbLinkFromReview,
	tmdbNoneFromReview,
	tmdbPastedCandidate,
	tmdbReviewItem,
	tmdbSearchAgain,
	tmdbUndoLast,
	tmdbUndoSearch,
	tmdbUnlinkFromReview
} from '$lib/server/tmdb-links';
import { parseTmdbUrl } from '$lib/library/tmdb';

type Body = {
	series?: number;
	/** LINK: a TMDB id the review offered, or a pasted one (`pasted`). */
	link?: number | string;
	pasted?: boolean;
	none?: boolean;
	skip?: boolean;
	search?: string;
	/** PASTE A LINK: read as one candidate; nothing is linked yet. */
	paste?: string;
	unlink?: boolean;
	undo?: 'link' | 'none' | 'search' | 'unlink';
};

/**
 * The review's decisions for TMDB (card c989; doc/LINKS.md, "TMDB links"), as
 * /api/links is AniList's and /api/links/ranobe Ranobe's, in Ranobe's body
 * shape so the page posts one way for both. Hidden means hidden: a hidden
 * series is a 404 while reveal is off, and never searched with it on, only
 * read by a pasted link's id. No key is 409, never a failure: the page never
 * offers a TMDB decision without one.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!catalogueConfigured('tmdb')) error(409, 'no TMDB key');
	const b = (await request.json().catch(() => null)) as Body | null;
	const seriesId = Number(b?.series);
	if (!b || !Number.isInteger(seriesId)) error(400, 'which series');
	const access = seriesAccess(seriesId, isRevealed(cookies));
	if (!access) error(404, 'not found');
	if (!tmdbReviewItem(seriesId)) error(404, 'not a film or a show');

	try {
		if (b.undo === 'search') {
			return json({ ok: tmdbUndoSearch(seriesId) });
		}
		if (b.undo) return json({ ok: tmdbUndoLast(seriesId) });
		if (b.unlink) {
			tmdbUnlinkFromReview(seriesId);
			return json({ ok: true });
		}
		if (b.none) {
			tmdbNoneFromReview(seriesId);
			return json({ ok: true });
		}
		// SKIP is this visit's queue order alone: TMDB's pass keeps no skip to write.
		if (b.skip) return json({ ok: true });
		if (typeof b.search === 'string') {
			if (access.hidden) error(409, 'hidden series are never searched');
			const found = await tmdbSearchAgain(seriesId, b.search);
			// The page's shape for a search that ran: TMDB's never waits for a pass.
			return json({ outcome: 'found', found, item: tmdbReviewItem(seriesId) });
		}
		if (typeof b.paste === 'string') {
			const ref = parseTmdbUrl(b.paste);
			if (!ref) error(400, 'not a TMDB link');
			const c = await tmdbPastedCandidate(seriesId, ref);
			if (!c) error(404, 'no such TMDB entry');
			return json({ candidate: c });
		}
		if (b.link !== undefined) {
			const id = Number(b.link);
			if (!Number.isSafeInteger(id) || id <= 0) error(400, 'which entry');
			const title = await tmdbLinkFromReview(seriesId, id, b.pasted ? 'pasted' : 'review');
			return json({ ok: true, title, siblings: [], items: [] });
		}
	} catch (e) {
		if (e instanceof NoTmdbKey) error(409, 'no TMDB key');
		// A network failure or TMDB's 5xx: the page says TMDB DID NOT ANSWER.
		if (e instanceof TypeError || (e instanceof Error && /^TMDB answered 5/.test(e.message)))
			error(503, 'TMDB unreachable');
		if (e instanceof Error && /no such TMDB entry|wrong kind/.test(e.message))
			error(422, e.message);
		throw e;
	}
	error(400, 'what to do');
};
