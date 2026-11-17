import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import { keepPage, KeepError } from '$lib/server/highlights/pages';

/**
 * HIGHLIGHT in the image reader (doc/HIGHLIGHTS.md, "Pages"):
 * `{ entry, page, pageEnd?, rtl? }` keeps the page (or a spread as BOTH) and
 * answers the highlight once its copy is on the workstation, never before.
 * The same page again answers the one already kept (`made: false`), so a
 * retry or a second press never makes two.
 *
 * Incognito makes none (Main 02): refused here as well as dimmed in the
 * reader, so a page opened before incognito began cannot keep one after.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (isIncognito(cookies)) error(403, 'incognito makes no highlight');
	const body = (await request.json().catch(() => null)) as {
		entry?: unknown;
		page?: unknown;
		pageEnd?: unknown;
		rtl?: unknown;
	} | null;
	const entry = Number(body?.entry);
	const page = Number(body?.page);
	const pageEnd =
		body?.pageEnd === null || body?.pageEnd === undefined ? null : Number(body.pageEnd);
	if (!Number.isInteger(entry) || entry <= 0 || !Number.isInteger(page))
		error(400, 'an entry and a page');
	try {
		const { highlight, made } = await keepPage(
			{ entryId: entry, page, pageEnd, rtl: body?.rtl === true },
			isRevealed(cookies)
		);
		return json({ highlight, made }, { status: made ? 201 : 200 });
	} catch (e) {
		if (e instanceof KeepError) {
			if (e.why === 'source') error(502, 'the source did not send this page');
			if (e.why === 'not_an_image') error(422, 'the page is not an image');
			error(404, 'not found');
		}
		throw e;
	}
};
