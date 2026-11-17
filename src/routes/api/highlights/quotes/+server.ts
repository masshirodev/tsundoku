import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import type { AnchorChange, QuoteBody } from '$lib/library/highlights';
import {
	keepQuote,
	quoteHighlights,
	QuoteError,
	setAnchors,
	validQuote
} from '$lib/server/highlights/quotes';

/**
 * A quote from the text reader (doc/HIGHLIGHTS.md, "Quotes"). POST
 * keeps one and answers the highlight: the same place again answers the one
 * already there (`made: false`), which is what lets a queued POST be resent safely.
 * GET `?entry=` is that chapter's quotes, for a chapter opened after the page
 * was. PUT tells the server what the words said when a chapter was read.
 *
 * Incognito makes none and moves none: reading makes nothing, and a
 * page opened before incognito began cannot make one after. Hidden means
 * hidden: a hidden series' entry is the same 404 without reveal.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (isIncognito(cookies)) error(403, 'incognito makes no highlight');
	const raw = (await request.json().catch(() => null)) as Partial<QuoteBody> | null;
	try {
		const out = keepQuote(validQuote(raw), isRevealed(cookies));
		return json(out, { status: out.made ? 201 : 200 });
	} catch (e) {
		if (e instanceof QuoteError) error(e.why === 'bad' ? 400 : 404, e.message);
		throw e;
	}
};

export const GET: RequestHandler = async ({ url, cookies }) => {
	const entry = Number(url.searchParams.get('entry'));
	if (!Number.isInteger(entry) || entry <= 0) error(400, 'an entry');
	return json({ quotes: quoteHighlights(entry, isRevealed(cookies)) });
};

export const PUT: RequestHandler = async ({ request, cookies }) => {
	if (isIncognito(cookies)) error(403, 'reading makes nothing in incognito');
	const raw = (await request.json().catch(() => null)) as {
		entry?: unknown;
		changes?: unknown;
	} | null;
	const entry = Number(raw?.entry);
	if (!Number.isInteger(entry) || entry <= 0 || !Array.isArray(raw?.changes))
		error(400, 'an entry and its changes');
	return json({ n: setAnchors(entry, raw.changes as AnchorChange[], isRevealed(cookies)) });
};
