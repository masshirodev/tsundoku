import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { refreshCovers } from '$lib/server/covers';
import {
	Unreachable,
	asReviewCandidate,
	link,
	noneOfThese,
	offered,
	queueSearch,
	readPasted,
	reviewItem,
	seriesAccess,
	skip,
	undoLink,
	undoNone,
	unlink,
	unqueueSearch,
	type QueuedFrom
} from '$lib/server/catalogue';
import { parsePasted } from '$lib/library/catalogue';

type Body = {
	series?: number;
	/** LINK: an AniList id the review offered, or a pasted one (`pasted`). */
	link?: number;
	pasted?: boolean;
	none?: boolean;
	skip?: boolean;
	/** SEARCH AGAIN: the title to search in the next pass. */
	search?: string;
	/** PASTE A LINK: read as one candidate; nothing is linked yet. */
	paste?: string;
	unlink?: boolean;
	undo?: 'link' | 'none' | 'search';
	was?: QueuedFrom;
};

/**
 * The link review's decisions (doc/LINKS.md), one series at a time, each
 * carried out at once; UNDO takes the last back. Hidden means hidden: a
 * hidden series is a 404 while reveal is off, and is never searched even
 * with it on -- only a pasted link, which sends nothing but its id.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const b = (await request.json().catch(() => null)) as Body | null;
	const seriesId = Number(b?.series);
	if (!b || !Number.isInteger(seriesId)) error(400, 'which series');
	const reveal = isRevealed(cookies);
	const access = seriesAccess(seriesId, reveal);
	if (!access) error(404, 'not found');
	const recover = (remote: boolean) =>
		void refreshCovers({ ids: [seriesId], remote }).catch(() => undefined);

	try {
		if (b.undo === 'link') {
			undoLink(seriesId);
			recover(false);
			return json({ ok: true });
		}
		if (b.undo === 'none') return json({ ok: undoNone(seriesId) });
		if (b.undo === 'search') {
			unqueueSearch(seriesId, b.was ?? null);
			return json({ ok: true });
		}
		if (b.unlink) {
			unlink(seriesId);
			recover(false);
			return json({ ok: true });
		}
		if (b.none) {
			noneOfThese(seriesId);
			return json({ ok: true });
		}
		if (b.skip) {
			skip(seriesId);
			return json({ ok: true });
		}
		if (typeof b.search === 'string') {
			if (access.hidden) error(409, 'hidden series are never searched');
			return json({ was: queueSearch(seriesId, b.search) });
		}
		if (typeof b.paste === 'string') {
			const p = parsePasted(b.paste);
			if (!p) error(400, 'not an AniList or MAL manga link');
			const item = reviewItem(seriesId, reveal);
			if (!item) error(404, 'not found');
			return json({ candidate: asReviewCandidate(item, await readPasted(p)) });
		}
		if (typeof b.link === 'number') {
			const c = b.pasted
				? await readPasted({ service: 'anilist', id: b.link })
				: offered(seriesId, b.link);
			if (!c) error(409, 'not a candidate');
			link(seriesId, c, b.pasted ? 'pasted' : 'review');
			// The cover follows in the background: the link's, if nothing comes before it.
			recover(true);
			return json({ ok: true, title: c.title, anilistId: c.anilistId, malId: c.malId });
		}
	} catch (e) {
		if (e instanceof Unreachable) error(503, 'AniList unreachable');
		throw e;
	}
	error(400, 'what to do');
};
