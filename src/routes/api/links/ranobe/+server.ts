import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { Unreachable } from '$lib/server/catalogue';
import { seriesAccess } from '$lib/server/catalogue';
import { Refused, configured, readWork, unlinkSeries } from '$lib/server/ranobe';
import {
	NotACandidate,
	asReviewCandidate,
	linkFromReview,
	linkMany,
	notOnRanobe,
	ranobeItem,
	retryRanobe,
	searchAgain,
	searchableOnRanobe,
	skip,
	undoLink,
	undoMany,
	undoNone,
	undoSearch
} from '$lib/server/ranobe-review';
import { parseRanobeUrl } from '$lib/library/ranobe';
import { CannotSuggest, suggestWork, withdrawWork } from '$lib/server/ranobe-suggest';

type Body = {
	series?: number;
	/** LINK: a work the review offered, or a pasted one (`pasted`). */
	link?: string;
	pasted?: boolean;
	/** LINK N MORE (1b): these series, to `work`. */
	many?: number[];
	work?: string;
	none?: boolean;
	skip?: boolean;
	search?: string;
	/** PASTE A LINK: read as one candidate; nothing is linked yet. */
	paste?: string;
	unlink?: boolean;
	retry?: boolean;
	/** SUGGEST TO RANOBE: the EPUB's work and authors, as a bundle that waits for a person. */
	suggest?: boolean;
	undo?: 'link' | 'none' | 'search' | 'many' | 'suggest';
};

/**
 * The review's decisions for Ranobe (doc/RANOBE.md, "The review"), as
 * /api/links is AniList's. Hidden means hidden: a hidden series is a 404
 * while reveal is off, and never searched with it on -- only a pasted link,
 * which reads nothing but the work's id.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!configured()) error(409, 'no RANOBE_TOKEN');
	const b = (await request.json().catch(() => null)) as Body | null;
	const seriesId = Number(b?.series);
	if (!b || !Number.isInteger(seriesId)) error(400, 'which series');
	const access = seriesAccess(seriesId, isRevealed(cookies));
	if (!access) error(404, 'not found');

	try {
		if (b.retry) {
			await retryRanobe(seriesId);
			return json({ ok: true });
		}
		if (b.undo === 'link') return json({ ok: undoLink(seriesId) });
		if (b.undo === 'many') {
			undoMany((b.many ?? []).filter(Number.isInteger));
			return json({ ok: true });
		}
		if (b.undo === 'none') return json({ ok: undoNone(seriesId) });
		if (b.undo === 'suggest') return json({ ok: await withdrawWork(seriesId) });
		if (b.suggest) {
			if (!searchableOnRanobe(seriesId)) error(409, 'hidden series are never suggested');
			const r = await suggestWork(seriesId);
			return json({ ...r, item: ranobeItem(seriesId) });
		}
		if (b.undo === 'search') {
			undoSearch(seriesId);
			return json({ ok: true });
		}
		if (b.unlink) {
			unlinkSeries(seriesId);
			return json({ ok: true });
		}
		if (b.none) {
			notOnRanobe(seriesId);
			return json({ ok: true });
		}
		if (b.skip) {
			skip(seriesId);
			return json({ ok: true });
		}
		if (typeof b.search === 'string') {
			if (!searchableOnRanobe(seriesId)) error(409, 'hidden series are never searched');
			const r = await searchAgain(seriesId, b.search);
			return json({ ...r, item: ranobeItem(seriesId) });
		}
		if (typeof b.paste === 'string') {
			const ref = parseRanobeUrl(b.paste);
			if (!ref) error(400, 'not a Ranobe work link');
			const item = ranobeItem(seriesId);
			if (!item) error(404, 'not found');
			const c = await readWork(ref);
			if (!c) error(404, 'no such work');
			return json({ candidate: asReviewCandidate(item, c) });
		}
		if (Array.isArray(b.many) && typeof b.work === 'string') {
			const linked = linkMany(b.many.filter(Number.isInteger), b.work);
			return json({ ok: true, linked });
		}
		if (typeof b.link === 'string') {
			const r = await linkFromReview(seriesId, b.link, b.pasted ? 'pasted' : 'review');
			// A hidden series never offers its siblings: nothing about it leaves the page.
			const siblings = access.hidden ? [] : r.siblings;
			// Each sibling as the review now draws it: the work first, chosen just now (1c).
			const items = siblings.map((x) => ranobeItem(x.seriesId)).filter((x) => x !== null);
			return json({ ok: true, title: r.title, siblings, items });
		}
	} catch (e) {
		if (e instanceof Unreachable) error(503, 'Ranobe unreachable');
		if (e instanceof NotACandidate) error(409, 'not a candidate');
		if (e instanceof CannotSuggest) error(409, e.message);
		// Ranobe answered, and said no: not the workstation's silence (the page says which).
		if (e instanceof Refused) {
			console.error(`tsundoku: Ranobe refused (${e.status} ${e.code}):`, JSON.stringify(e.details));
			error(422, `Ranobe refused it: ${e.code}`);
		}
		throw e;
	}
	error(400, 'what to do');
};
